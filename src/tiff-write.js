// A small GeoTIFF writer for model rasters handed to other tools (HEC-RAS terrain, land cover, Manning's n, gridded
// rain): classic little-endian TIFF, striped, deflate (zlib, through CompressionStream, so the browser and Node both
// run it) or uncompressed, one sample of 32-bit float or 8-bit unsigned. Georeferencing by tie point and pixel scale
// (north-up), the projected or geographic CRS and the vertical datum in the GeoKey directory, GDAL's no-data tag.
// src/tiff.js reads what this writes (the tests check the round trip).

async function deflate(u8) { // zlib stream (TIFF compression 8, "Adobe deflate")
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Vertical CRS and datum codes for the GeoKeys: NAVD88 height (EPSG 5703, datum 5103). */
const VERTICAL = { NAVD88: { cs: 5703, datum: 5103 } };

/**
 * GeoTIFF of one band. data: Float32Array or Uint8Array (width·height, row 0 = north). x0, y0: the outer corner of
 * pixel (0, 0) (the north-west corner), dx and dy the pixel size (dy > 0, rows run south). epsg: a projected CRS
 * (e.g. 26918, NAD83 / UTM 18N) or 4326 (geographic lon/lat). vertical: 'NAVD88' or null; citation: free text.
 * nodata: written as GDAL_NODATA (NaN by default for floats). → Uint8Array (the .tif file)
 */
export async function writeGeoTiff({ width, height, data, x0, y0, dx, dy = dx, epsg, vertical = null, citation = '', nodata, compress = true }) {
  const float = data instanceof Float32Array, bps = float ? 32 : 8, bpp = bps / 8;
  if (!float && !(data instanceof Uint8Array)) throw new Error('writeGeoTiff: Float32Array or Uint8Array data');
  if (data.length !== width * height) throw new Error('writeGeoTiff: data length is not width × height');
  // strips of ~256 KB raw
  const rps = Math.max(1, Math.min(height, Math.floor(262144 / (width * bpp)))), nStrips = Math.ceil(height / rps), strips = [];
  const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); // little-endian on every platform we run
  for (let s = 0; s < nStrips; s++) {
    const a = s * rps * width * bpp, b = Math.min(height, (s + 1) * rps) * width * bpp, part = raw.slice(a, b);
    strips.push(compress ? await deflate(part) : part);
  }
  // GeoKeys (sorted by key id) and their ASCII parameters ('|'-terminated)
  const geographic = epsg === 4326 || (epsg >= 4000 && epsg < 5000), keys = [], ascii = [];
  const text = (id, s) => { const o = ascii.join('').length, v = s + '|'; ascii.push(v); keys.push([id, 34737, v.length, o]); };
  keys.push([1024, 0, 1, geographic ? 2 : 1], [1025, 0, 1, 1]); // model type projected / geographic; pixel is area
  if (citation) text(1026, citation);
  if (geographic) keys.push([2048, 0, 1, epsg]); else keys.push([3072, 0, 1, epsg], [3076, 0, 1, 9001]);
  const v = vertical ? VERTICAL[vertical] : null;
  if (v) { keys.push([4096, 0, 1, v.cs]); text(4097, vertical); keys.push([4098, 0, 1, v.datum], [4099, 0, 1, 9001]); }
  keys.sort((p, q) => p[0] - q[0]);
  const geoDir = [1, 1, 0, keys.length, ...keys.flat()];
  const nd = nodata ?? (float ? NaN : null);
  // tags: [tag, type, values] (3 SHORT, 4 LONG, 2 ASCII, 12 DOUBLE), ascending
  const tags = [[256, 4, [width]], [257, 4, [height]], [258, 3, [bps]], [259, 3, [compress ? 8 : 1]], [262, 3, [1]],
    [273, 4, strips.map(() => 0)], [277, 3, [1]], [278, 4, [rps]], [279, 4, strips.map(b => b.length)], [284, 3, [1]],
    [339, 3, [float ? 3 : 1]], [33550, 12, [dx, dy, 0]], [33922, 12, [0, 0, 0, x0, y0, 0]], [34735, 3, geoDir], [34737, 2, ascii.join('') + '\0']];
  if (nd != null) tags.push([42113, 2, (Number.isNaN(nd) ? 'nan' : String(nd)) + '\0']);
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 }, ifd = 8, nTags = tags.length;
  let at = ifd + 2 + 12 * nTags + 4; // values that do not fit in the entry follow the IFD
  const placed = tags.map(([tag, type, vals]) => {
    const n = type === 2 ? vals.length : vals.length, len = n * size[type], off = len > 4 ? at : null;
    if (len > 4) at += len + (len & 1);
    return { tag, type, vals, n, off };
  });
  const offsets = []; let o = at; for (const b of strips) { offsets.push(o); o += b.length; }
  placed.find(p => p.tag === 273).vals = offsets;
  const out = new Uint8Array(o), dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true); dv.setUint16(ifd, nTags, true);
  const put = (p, type, vals) => {
    if (type === 2) { for (let i = 0; i < vals.length; i++) out[p + i] = vals.charCodeAt(i) & 255; return; }
    vals.forEach((x, i) => { const q = p + i * size[type]; if (type === 3) dv.setUint16(q, x, true); else if (type === 4) dv.setUint32(q, x, true); else dv.setFloat64(q, x, true); });
  };
  placed.forEach((e, m) => {
    const p = ifd + 2 + 12 * m; dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true); dv.setUint32(p + 4, e.n, true);
    if (e.off == null) put(p + 8, e.type, e.vals); else { dv.setUint32(p + 8, e.off, true); put(e.off, e.type, e.vals); }
  });
  dv.setUint32(ifd + 2 + 12 * nTags, 0, true); // no next IFD
  strips.forEach((b, i) => out.set(b, offsets[i]));
  return out;
}
