// A small GeoTIFF reader for gridded elevation (NOAA BlueTopo and the like): classic TIFF, either byte order, tiled or
// striped, uncompressed or deflate (zlib, through DecompressionStream, so the browser and Node both run it), no
// predictor or horizontal differencing, 32-bit float samples, chunky or planar. Georeferencing from the tie point and
// pixel scale (a north-up grid), the projected and vertical coordinate systems from the GeoKey directory, and GDAL's
// no-data value. Reads only the internal tiles a window needs.

const TAG = { W: 256, H: 257, BPS: 258, COMP: 259, STRIP_OFF: 273, SPP: 277, ROWS: 278, STRIP_N: 279, PLANAR: 284, PRED: 317,
  TW: 322, TH: 323, TILE_OFF: 324, TILE_N: 325, FMT: 339, SCALE: 33550, TIE: 33922, GEOKEYS: 34735, GEOASCII: 34737, NODATA: 42113 };
const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

/** zlib-wrapped deflate → bytes. */
async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * Parse a GeoTIFF's first image. → { width, height, spp, nodata, geo: { x0, y0, dx, dy, epsg, vertical }, read(c0, r0, w, h, sample) }
 * geo: the outer corner of pixel (0, 0) and the pixel size (dy > 0, rows run south); epsg the projected CRS (or null),
 * vertical the vertical datum's citation / code. read → Float32Array(w·h) row-major, NaN for no data and outside the image.
 */
export function parseTiff(buffer) {
  const dv = new DataView(buffer), le = dv.getUint16(0) === 0x4949;
  if (!le && dv.getUint16(0) !== 0x4d4d) throw new Error('not a TIFF');
  if (dv.getUint16(2, le) === 43) throw new Error('BigTIFF is not supported');
  const tags = new Map(), ifd = dv.getUint32(4, le), n = dv.getUint16(ifd, le);
  for (let e = 0; e < n; e++) {
    const p = ifd + 2 + 12 * e, tag = dv.getUint16(p, le), type = dv.getUint16(p + 2, le), count = dv.getUint32(p + 4, le), sz = SIZE[type] ?? 1;
    const at = sz * count <= 4 ? p + 8 : dv.getUint32(p + 8, le), vals = [];
    if (type === 2) { tags.set(tag, new TextDecoder().decode(new Uint8Array(buffer, at, count)).replace(/\0+$/, '')); continue; }
    for (let i = 0; i < count; i++) {
      const q = at + i * sz;
      vals.push(type === 3 ? dv.getUint16(q, le) : type === 4 || type === 13 ? dv.getUint32(q, le) : type === 8 ? dv.getInt16(q, le) : type === 9 ? dv.getInt32(q, le)
        : type === 11 ? dv.getFloat32(q, le) : type === 12 ? dv.getFloat64(q, le) : type === 16 ? Number(dv.getBigUint64(q, le)) : dv.getUint8(q));
    }
    tags.set(tag, vals);
  }
  const one = (t, d) => (tags.has(t) ? tags.get(t)[0] : d);
  const width = one(TAG.W), height = one(TAG.H), spp = one(TAG.SPP, 1), comp = one(TAG.COMP, 1), planar = one(TAG.PLANAR, 1), pred = one(TAG.PRED, 1);
  const bps = tags.get(TAG.BPS) ?? [32], fmt = tags.get(TAG.FMT) ?? [3];
  if (bps.some(b => b !== 32) || fmt.some(f => f !== 3)) throw new Error('only 32-bit float samples are supported');
  if (comp !== 1 && comp !== 8 && comp !== 32946) throw new Error(`TIFF compression ${comp} is not supported`);
  if (pred !== 1) throw new Error(`TIFF predictor ${pred} is not supported`);
  const tiled = tags.has(TAG.TW), tw = tiled ? one(TAG.TW) : width, th = tiled ? one(TAG.TH) : one(TAG.ROWS, height);
  const offs = tags.get(tiled ? TAG.TILE_OFF : TAG.STRIP_OFF), lens = tags.get(tiled ? TAG.TILE_N : TAG.STRIP_N);
  const across = Math.ceil(width / tw), down = Math.ceil(height / th), perPlane = across * down;
  // georeferencing
  const tie = tags.get(TAG.TIE), scale = tags.get(TAG.SCALE), keys = tags.get(TAG.GEOKEYS), ascii = tags.get(TAG.GEOASCII) ?? '';
  const key = {};
  if (keys) for (let k = 4; k + 3 < keys.length; k += 4) {
    const [id, loc, cnt, off] = keys.slice(k, k + 4);
    key[id] = loc === 0 ? off : loc === TAG.GEOASCII ? ascii.slice(off, off + cnt).replace(/\|$/, '') : null;
  }
  const geo = tie && scale ? { x0: tie[3] - tie[0] * scale[0], y0: tie[4] + tie[1] * scale[1], dx: scale[0], dy: scale[1],
    epsg: key[3072] ?? null, vertical: [key[4096], key[4097], key[1026]].filter(v => v != null && v !== 32767).join(' ') || null } : null;
  const nd = tags.has(TAG.NODATA) ? Number(String(tags.get(TAG.NODATA)).trim()) : NaN;
  const cache = new Map();
  async function block(b) { // one tile or strip, decoded, as floats
    if (cache.has(b)) return cache.get(b);
    let bytes = new Uint8Array(buffer, offs[b], lens[b]);
    if (comp !== 1) bytes = await inflate(bytes);
    const f = new Float32Array(bytes.byteLength / 4), d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < f.length; i++) f[i] = d.getFloat32(4 * i, le);
    cache.set(b, f); return f;
  }
  async function read(c0, r0, w, h, sample = 0) {
    const out = new Float32Array(w * h).fill(NaN), per = planar === 1 ? spp : 1;
    for (let tj = Math.max(0, Math.floor(r0 / th)); tj <= Math.min(down - 1, Math.floor((r0 + h - 1) / th)); tj++) {
      for (let ti = Math.max(0, Math.floor(c0 / tw)); ti <= Math.min(across - 1, Math.floor((c0 + w - 1) / tw)); ti++) {
        const f = await block((planar === 2 ? sample * perPlane : 0) + tj * across + ti), rows = f.length / (tw * per);
        for (let y = 0; y < Math.min(th, rows); y++) {
          const r = tj * th + y - r0; if (r < 0 || r >= h || tj * th + y >= height) continue;
          for (let x = 0; x < tw; x++) {
            const c = ti * tw + x - c0; if (c < 0 || c >= w || ti * tw + x >= width) continue;
            const v = f[(y * tw + x) * per + (planar === 1 ? sample : 0)];
            out[r * w + c] = v === nd || !Number.isFinite(v) ? NaN : v;
          }
        }
      }
    }
    return out;
  }
  return { width, height, spp, nodata: nd, geo, read };
}
