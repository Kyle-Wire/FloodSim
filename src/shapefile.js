// A minimal ESRI shapefile writer (points, polylines, polygons; 2D) with its .shx index, a dBASE III attribute table
// and a .prj, for handing model geometry to GIS and HEC-RAS. src/infra.js parses what this writes (parseShp,
// parseDbf; the tests check the round trip).

const TYPE = { point: 1, line: 3, polygon: 5 };

/** ESRI WKT for NAD83 / UTM zone `zone` north (EPSG 269xx), the horizontal datum of 3DEP and of US engineering work. */
export function prjUTM(zone) {
  const cm = (zone - 1) * 6 - 180 + 3;
  return `PROJCS["NAD_1983_UTM_Zone_${zone}N",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],` +
    `PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],` +
    `PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${cm.toFixed(1)}],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
}
/** ESRI WKT for geographic NAD83 / WGS84 lon/lat. */
export const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/**
 * kind: 'point' | 'line' | 'polygon'. records: [{ coords, props }]: a point [x, y]; a line [[x, y]…] (or several
 * parts [[[x, y]…]…]); a polygon's rings [[[x, y]…]…] (outer clockwise, as the format wants: rings are reoriented).
 * Attribute fields come from the props: strings as C (up to 254), numbers as N (19.6). prj: WKT text.
 * → { shp, shx, dbf, prj } (Uint8Array each; prj omitted without one)
 */
export function writeShapefile(kind, records, { prj } = {}) {
  const t = TYPE[kind]; if (!t) throw new Error(`shapefile: unknown kind ${kind}`);
  const parts = records.map(r => partsOf(kind, r.coords));
  const bb = (pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const contents = parts.map(ps => (t === 1 ? 20 : 44 + 4 * ps.length + 16 * ps.reduce((a, p) => a + p.length, 0)));
  const shpLen = 100 + contents.reduce((a, c) => a + 8 + c, 0), shp = new Uint8Array(shpLen), shx = new Uint8Array(100 + 8 * records.length);
  const all = bb(parts.flat(2)), box = records.length ? all : [0, 0, 0, 0];
  for (const [u8, len] of [[shp, shpLen], [shx, shx.length]]) {
    const dv = new DataView(u8.buffer); dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, t, true);
    box.forEach((v, i) => dv.setFloat64(36 + 8 * i, v, true));
  }
  const dv = new DataView(shp.buffer), dx = new DataView(shx.buffer);
  let o = 100;
  parts.forEach((ps, m) => {
    dx.setInt32(100 + 8 * m, o / 2, false); dx.setInt32(104 + 8 * m, contents[m] / 2, false);
    dv.setInt32(o, m + 1, false); dv.setInt32(o + 4, contents[m] / 2, false); const r = o + 8; dv.setInt32(r, t, true);
    if (t === 1) { dv.setFloat64(r + 4, ps[0][0][0], true); dv.setFloat64(r + 12, ps[0][0][1], true); }
    else {
      bb(ps.flat()).forEach((v, i) => dv.setFloat64(r + 4 + 8 * i, v, true));
      const npt = ps.reduce((a, p) => a + p.length, 0); dv.setInt32(r + 36, ps.length, true); dv.setInt32(r + 40, npt, true);
      let q = 0; ps.forEach((p, k) => { dv.setInt32(r + 44 + 4 * k, q, true); q += p.length; });
      let w = r + 44 + 4 * ps.length; for (const p of ps) for (const [x, y] of p) { dv.setFloat64(w, x, true); dv.setFloat64(w + 8, y, true); w += 16; }
    }
    o += 8 + contents[m];
  });
  const out = { shp, shx, dbf: writeDbf(records.map(r => r.props ?? {})) };
  if (prj) out.prj = new TextEncoder().encode(prj);
  return out;
}

function partsOf(kind, coords) {
  if (kind === 'point') return [[coords]];
  if (kind === 'line') return typeof coords[0][0] === 'number' ? [coords] : coords;
  return coords.map((ring, i) => { // closed rings; outer clockwise, holes counter-clockwise
    const r = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring : [...ring, ring[0]];
    let a = 0; for (let k = 0; k + 1 < r.length; k++) a += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1];
    const cw = a < 0; return (i === 0) === cw ? r : [...r].reverse();
  });
}

/** dBASE III table: one field per prop name seen (first 10 characters), strings C, numbers N(19,6). */
export function writeDbf(rows) {
  const names = [...new Set(rows.flatMap(r => Object.keys(r)))].slice(0, 254), enc = new TextEncoder();
  const fields = names.map(n => {
    const num = rows.every(r => r[n] == null || typeof r[n] === 'number');
    const len = num ? 19 : Math.min(254, Math.max(1, ...rows.map(r => enc.encode(String(r[n] ?? '')).length)));
    return { name: n.slice(0, 10), key: n, num, len, dec: num ? 6 : 0 };
  });
  const hlen = 32 + 32 * fields.length + 1, rlen = 1 + fields.reduce((a, f) => a + f.len, 0), u8 = new Uint8Array(hlen + rlen * rows.length + 1), dv = new DataView(u8.buffer);
  const now = new Date(); u8[0] = 3; u8[1] = now.getFullYear() - 1900; u8[2] = now.getMonth() + 1; u8[3] = now.getDate();
  dv.setUint32(4, rows.length, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true);
  fields.forEach((f, i) => { const o = 32 + 32 * i; u8.set(enc.encode(f.name), o); u8[o + 11] = (f.num ? 'N' : 'C').charCodeAt(0); u8[o + 16] = f.len; u8[o + 17] = f.dec; });
  u8[hlen - 1] = 0x0d;
  rows.forEach((r, m) => {
    let o = hlen + m * rlen; u8[o++] = 0x20;
    for (const f of fields) {
      const v = r[f.key];
      const s = f.num ? (v == null || !Number.isFinite(v) ? '' : v.toFixed(6)).padStart(f.len).slice(-f.len) : String(v ?? '');
      const b = enc.encode(s).slice(0, f.len); u8.fill(0x20, o, o + f.len); u8.set(b, o); o += f.len;
    }
  });
  u8[u8.length - 1] = 0x1a;
  return u8;
}
