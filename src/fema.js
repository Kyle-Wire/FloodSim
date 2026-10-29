// FEMA flood zones and base flood elevations from the National Flood Hazard Layer (NFHL, hazards.fema.gov).
//
//   zones      S_FLD_HAZ_AR (layer 28): zone (A, AE, AH, AO, VE, X …), subtype (0.2 % annual chance, floodway …),
//              SFHA flag, a static BFE (ponding and coastal zones) and an AO depth
//   BFE lines  S_BFE (layer 16): whole-foot base flood elevations across the floodplain
//   sections   S_XS (layer 14): cross-sections with the regulatory water surface (WSEL_REG, to 0.1 ft)
// The BFE at a point inside the SFHA is the zone's static BFE when it has one; in a riverine AE zone it is interpolated
// between the two nearest BFE lines / cross-sections of different elevation, inversely to distance (the usual reading
// of a FIRM between its BFE lines); in an AO zone it is the ground + the zone's depth; an A zone has no published BFE.
// Elevations come in feet and NAVD88 or NGVD29; everything here is metres NAVD88 (NGVD29 shifted by NOAA's NCAT at
// the site). Pure functions apart from fetchNFHL.
import { fillRings } from './terrain.js';
import { toCells } from './ingest.js';

export const NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer';
const FT = 0.3048;
/** Zone codes on the grid (index), with what each means. SFHA: the 1 % annual chance (100-yr) floodplain. */
export const ZONES = ['', 'A', 'AE', 'AH', 'AO', 'A99', 'AR', 'V', 'VE', 'X500', 'X', 'D', 'FW'];
export const ZONE_INFO = {
  A: { sfha: true, label: 'A: 1 % annual chance, no BFE published' },
  AE: { sfha: true, label: 'AE: 1 % annual chance, with BFEs' },
  AH: { sfha: true, label: 'AH: 1 % ponding, 1–3 ft, BFE given' },
  AO: { sfha: true, label: 'AO: 1 % sheet flow, 1–3 ft, depth given' },
  A99: { sfha: true, label: 'A99: protected by a levee under construction' },
  AR: { sfha: true, label: 'AR: restoring levee protection' },
  V: { sfha: true, label: 'V: coastal high hazard, no BFE published' },
  VE: { sfha: true, label: 'VE: coastal high hazard, with BFEs' },
  FW: { sfha: true, label: 'Regulatory floodway (within AE)' },
  X500: { sfha: false, label: 'X shaded: 0.2 % annual chance (500-yr)' },
  X: { sfha: false, label: 'X: minimal flood hazard' },
  D: { sfha: false, label: 'D: undetermined' },
};
/** Map colours: SFHA blues, floodway darker, 500-yr orange, others clear. */
export const ZONE_COLORS = { A: [72, 145, 220], AE: [42, 120, 214], AH: [80, 160, 230], AO: [100, 175, 235], A99: [140, 180, 220], AR: [140, 180, 220], V: [120, 90, 200], VE: [98, 80, 214], FW: [20, 70, 160], X500: [235, 150, 60] };

/** A zone record's grid code: the floodway subtype and the 0.2 % X zone get their own. */
export function zoneCode(z, subtype) {
  const s = String(subtype ?? '').toUpperCase();
  if (/FLOODWAY/.test(s) && !/FUTURE|NON/.test(s)) return 'FW';
  if (z === 'X' && /0\.2|500/.test(s)) return 'X500';
  return ZONES.includes(z) ? z : z?.startsWith('A') ? 'A' : z?.startsWith('V') ? 'V' : z ? 'X' : '';
}
const ftToM = (v, unit) => (v == null || v <= -9000 ? null : /met/i.test(unit ?? '') ? v : v * FT);

/**
 * Fetch zones, BFE lines and cross-sections inside lon/lat bounds [w, s, e, n] (widened by `pad` degrees so BFE lines
 * just outside the area still bracket it). datumShift(lon, lat) → NAVD88 − NGVD29 (m), called only when NGVD29 data
 * appear. → { zones: [{ zone, code, subtype, sfha, staticBfe, depth, rings }], lines: [{ elev, kind: 'bfe' | 'xs', line, name }], datum, shift }
 */
export async function fetchNFHL([w, s, e, n], fetcher, { pad = 0.006, datumShift = null } = {}) {
  const q = (layer, fields, b, extra = '') => `${NFHL}/${layer}/query?geometry=${b.map(v => v.toFixed(6)).join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&outSR=4326&f=geojson${extra}`;
  const get = async (url) => { const r = await fetcher(url); if (!r.ok) throw new Error(`NFHL ${r.status}`); const j = await r.json(); if (j.error) throw new Error('NFHL: ' + (j.error.message ?? 'error')); return j.features ?? []; };
  const big = [w - pad, s - pad, e + pad, n + pad];
  const [zf, bf, xf] = await Promise.all([
    get(q(28, 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,DEPTH,LEN_UNIT', [w, s, e, n], '&maxAllowableOffset=0.000005')),
    get(q(16, 'ELEV,V_DATUM,LEN_UNIT', big)).catch(() => []),
    get(q(14, 'WSEL_REG,V_DATUM,LEN_UNIT,WTR_NM,STREAM_STN,XS_LTR', big)).catch(() => []),
  ]);
  let shift = 0, datum = 'NAVD88';
  if ([...zf, ...bf, ...xf].some(f => /29/.test(f.properties?.V_DATUM ?? ''))) {
    datum = 'NGVD29 → NAVD88'; shift = datumShift ? await datumShift((w + e) / 2, (s + n) / 2) : 0;
  }
  const lift = (v, d) => (v == null ? null : v + (/29/.test(d ?? '') ? shift : 0));
  const rings = (g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);
  const lines = (g) => (g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []);
  const zones = zf.map(f => { const p = f.properties, code = zoneCode(p.FLD_ZONE, p.ZONE_SUBTY);
    return { zone: p.FLD_ZONE, code, subtype: p.ZONE_SUBTY ?? null, sfha: p.SFHA_TF === 'T', staticBfe: lift(ftToM(p.STATIC_BFE, p.LEN_UNIT ?? 'Feet'), p.V_DATUM), depth: ftToM(p.DEPTH, p.LEN_UNIT ?? 'Feet'), polys: rings(f.geometry) }; });
  const out = [];
  for (const f of bf) { const p = f.properties, v = lift(ftToM(p.ELEV, p.LEN_UNIT ?? 'Feet'), p.V_DATUM); if (v != null && v > -100) for (const ln of lines(f.geometry)) out.push({ elev: v, kind: 'bfe', line: ln, name: `BFE ${p.ELEV} ft` }); }
  for (const f of xf) { const p = f.properties, v = lift(ftToM(p.WSEL_REG, p.LEN_UNIT ?? 'Feet'), p.V_DATUM); if (v != null && v > -100) for (const ln of lines(f.geometry)) out.push({ elev: v, kind: 'xs', line: ln, name: `XS ${p.XS_LTR ?? ''} ${p.WTR_NM ?? ''}`.trim() }); }
  return { zones, lines: out, datum, shift };
}

// ------------------------------------------------------------------ grids

/** Distance from (x, y) to a polyline (same units). */
export function distToLine(line, x, y) {
  let d = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * vx, y - ay - t * vy));
  }
  return d;
}
/**
 * BFE at a point from lines [{ elev, line }] (same coordinates): the nearest line, and the nearest one with a different
 * elevation, weighted inversely to distance (linear between two bracketing BFE lines). → { bfe, a, b } or null
 */
export function interpolateBFE(lines, x, y, { maxDist = Infinity } = {}) {
  const ds = lines.map(l => ({ l, d: distToLine(l.line, x, y) })).filter(o => o.d <= maxDist).sort((p, q) => p.d - q.d);
  if (!ds.length) return null;
  const a = ds[0], b = ds.find(o => Math.abs(o.l.elev - a.l.elev) > 1e-6);
  if (!b || a.d < 1e-9) return { bfe: a.l.elev, a: a.l, b: null };
  const wa = 1 / a.d, wb = 1 / b.d;
  return { bfe: (a.l.elev * wa + b.l.elev * wb) / (wa + wb), a: a.l, b: b.l };
}
/**
 * Zones and BFEs on the fine grid (`grid` with toCells' fields: x0, y1, dx, zone, nx, ny). z: ground (for AO zones).
 * The BFE is worked out on a `step`-cell lattice and filled to the cells (it changes slowly), only inside the SFHA.
 * → { code: Uint8Array (index into ZONES), bfe: Float32Array (m NAVD88, NaN outside the SFHA or with no BFE), source: Uint8Array (1 static, 2 lines, 3 AO depth) }
 */
export function nfhlGrids(nfhl, grid, z, { step = 4, maxLineDist = 1500 } = {}) {
  const { nx, ny } = grid, N = nx * ny, code = new Uint8Array(N), zi = new Int32Array(N).fill(-1);
  // larger zones first, so a floodway or small zone drawn later wins where they overlap
  const order = nfhl.zones.map((zn, i) => i).sort((a, b) => (nfhl.zones[a].code === 'FW') - (nfhl.zones[b].code === 'FW'));
  for (const i of order) { const zn = nfhl.zones[i], c = ZONES.indexOf(zn.code); for (const poly of zn.polys) fillRings(poly.map(r => toCells(grid, r)), nx, ny, (k) => { if (zn.code === 'FW' && !ZONE_INFO[ZONES[code[k]]]?.sfha) return; code[k] = c; zi[k] = i; }); }
  const lines = nfhl.lines.map(l => ({ ...l, line: toCells(grid, l.line) })), bfe = new Float32Array(N).fill(NaN), source = new Uint8Array(N);
  const coarse = new Map(), maxD = maxLineDist / grid.dx;
  const lineBfe = (i, j) => { const key = ((j / step) | 0) * 1e6 + ((i / step) | 0); if (!coarse.has(key)) { const x = (((i / step) | 0) + 0.5) * step, y = (((j / step) | 0) + 0.5) * step; coarse.set(key, interpolateBFE(lines, x, y, { maxDist: maxD })?.bfe ?? NaN); } return coarse.get(key); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (zi[k] < 0) continue;
    const zn = nfhl.zones[zi[k]]; if (!(zn.sfha || zn.code === 'FW')) continue;
    if (zn.staticBfe != null) { bfe[k] = zn.staticBfe; source[k] = 1; }
    else if (zn.code === 'AO' && zn.depth != null && z) { bfe[k] = z[k] + zn.depth; source[k] = 3; }
    else if (['AE', 'FW', 'VE', 'AH'].includes(zn.code) && lines.length) { const v = lineBfe(i, j); if (Number.isFinite(v)) { bfe[k] = v; source[k] = 2; } }
  }
  return { code, bfe, source };
}
/** Zone and BFE over a set of cells (a building footprint): the most hazardous zone and the highest BFE. */
export function atCells(g, cells) {
  let best = 0, bfe = -Infinity, src = 0;
  const rank = (c) => (c === 'FW' ? 9 : c === 'VE' || c === 'V' ? 8 : ZONE_INFO[c]?.sfha ? 6 : c === 'X500' ? 2 : c === 'X' ? 1 : 0);
  for (const k of cells) { const c = ZONES[g.code[k]]; if (rank(c) > rank(ZONES[best])) best = g.code[k]; if (g.bfe[k] > bfe) { bfe = g.bfe[k]; src = g.source[k]; } }
  return { zone: ZONES[best] || null, sfha: !!ZONE_INFO[ZONES[best]]?.sfha, bfe: Number.isFinite(bfe) ? bfe : null, source: ['', 'static BFE of the zone', 'interpolated between BFE lines / cross-sections', 'ground + AO depth'][src] || null };
}
/** Area (m²) per zone code on the grid. */
export function zoneAreas(g, cellArea, mask = null) {
  const a = {}; for (let k = 0; k < g.code.length; k++) { if (mask && !mask[k]) continue; const c = ZONES[g.code[k]]; if (c) a[c] = (a[c] ?? 0) + cellArea; }
  return a;
}
/** RGBA overlay of the zones (SFHA blue, floodway darker, 500-yr orange). */
export function zoneImage(g, nx, ny) {
  const px = new Uint8ClampedArray(nx * ny * 4);
  for (let k = 0; k < nx * ny; k++) { const c = ZONE_COLORS[ZONES[g.code[k]]]; if (!c) continue; px[4 * k] = c[0]; px[4 * k + 1] = c[1]; px[4 * k + 2] = c[2]; px[4 * k + 3] = ZONES[g.code[k]] === 'X500' ? 90 : 120; }
  return px;
}
