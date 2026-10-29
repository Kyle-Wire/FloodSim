// Starting water levels in rivers, lakes and tidal water. The 3DEP lidar is hydro-flattened: open water is a flat
// surface at the level of the day it was flown, so the model's channels and lakes start "full to that day's level" and
// otherwise dry. This puts water on top of that surface from USGS gauges, at the storm start (historic storms) or the
// latest reading (design storms):
//   river   the gauge's water surface (gage height + gauge datum, in NAVD88) minus the lidar water surface near the gauge
//           gives the rise Δ; the whole river rises by Δ (a parallel rise, as along a reach at a steady flow)
//   lake    a lake or reservoir level (NAVD88, or NGVD29 converted with NOAA's VERTCON) fills the lake flat
//   tide    tidal water touching the tide-gauge boundary starts at that gauge's level
// Water spreads from the channel onto any connected ground below its level (height above the nearest water), so a gauge
// above bankfull starts the floodplain wet. Bathymetry below the lidar surface is still not represented.
import { fetchDEM } from './ingest.js';
import { gridFromLonLatBox, toUTM } from './geo.js';

const NWIS = 'https://waterservices.usgs.gov/nwis';
const FT = 0.3048;
/** NWIS level parameters: gage height (above the gauge datum), and water-surface elevations on a vertical datum. */
export const LEVEL_PARAMS = { '00065': 'gage', '62614': 'NGVD29', '62615': 'NAVD88', '62620': 'NAVD88', '63160': 'NAVD88' };

const rdb = (text) => {
  const rows = text.split('\n').filter(l => l && !l.startsWith('#')), head = rows.shift()?.split('\t') ?? []; rows.shift();
  return rows.map(r => Object.fromEntries(r.split('\t').map((v, i) => [head[i], v])));
};

/** Stream, lake and estuary gauges reporting a water level in a lon/lat box. → [{ site, name, kind, lon, lat, datumM, datum, acyM }] */
export async function findLevelGauges([w, s, e, n], fetcher) {
  const r = await fetcher(`${NWIS}/site/?format=rdb&bBox=${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}&siteType=ST,LK,ES&parameterCd=${Object.keys(LEVEL_PARAMS).join(',')}&hasDataTypeCd=iv&siteOutput=expanded`);
  if (!r.ok) return [];
  return rdb(await r.text()).map(o => ({
    site: o.site_no, name: o.station_nm, kind: o.site_tp_cd, lon: Number(o.dec_long_va), lat: Number(o.dec_lat_va),
    datumM: o.alt_va !== '' && Number.isFinite(Number(o.alt_va)) ? Number(o.alt_va) * FT : null, datum: o.alt_datum_cd || null,
    acyM: o.alt_acy_va !== '' && Number.isFinite(Number(o.alt_acy_va)) ? Number(o.alt_acy_va) * FT : null,
  })).filter(g => g.site && Number.isFinite(g.lon));
}

/**
 * Level (and discharge, where gauged) per site at time `at` (ms; the reading nearest it within ±2 h) or the latest
 * reading (at = null). → Map(site → { t, gage (m), elev: { NAVD88 | NGVD29 (m) }, q (m³/s) })
 */
export async function readLevels(sites, fetcher, at = null) {
  const out = new Map(); if (!sites.length) return out;
  const iso = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';
  const span = at == null ? '' : `&startDT=${iso(at - 2 * 3600e3)}&endDT=${iso(at + 2 * 3600e3)}`;
  const r = await fetcher(`${NWIS}/iv/?format=json&sites=${sites.join(',')}&parameterCd=00060,${Object.keys(LEVEL_PARAMS).join(',')}${span}`);
  if (!r.ok) throw new Error(`NWIS levels: ${r.status}`);
  for (const ts of (await r.json()).value?.timeSeries ?? []) {
    const site = ts.sourceInfo?.siteCode?.[0]?.value, code = ts.variable?.variableCode?.[0]?.value;
    const vals = (ts.values?.[0]?.value ?? []).map(v => ({ t: Date.parse(v.dateTime), v: Number(v.value) })).filter(v => Number.isFinite(v.t) && Number.isFinite(v.v) && v.v > -999);
    if (!site || !vals.length) continue;
    const pick = at == null ? vals.at(-1) : vals.reduce((a, b) => (Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a));
    const o = out.get(site) ?? { t: pick.t, elev: {} }; out.set(site, o);
    if (code === '00060') o.q = pick.v * FT ** 3;
    else if (code === '00065') { o.gage = pick.v * FT; o.t = pick.t; }
    else if (LEVEL_PARAMS[code]) { o.elev[LEVEL_PARAMS[code]] ??= pick.v * FT; o.t = pick.t; }
  }
  return out;
}

/** NGVD29 → NAVD88 at a point (NOAA NCAT / VERTCON 3); returns the shift to add (m). */
export async function ngvdToNavd(lon, lat, fetcher) {
  const r = await fetcher(`https://geodesy.noaa.gov/api/ncat/llh?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&inDatum=NAD83(1986)&outDatum=NAD83(1986)&inVertDatum=NGVD29&outVertDatum=NAVD88&orthoHt=100`);
  if (!r.ok) throw new Error(`NCAT ${r.status}`);
  const d = Number((await r.json()).destOrthoht); if (!Number.isFinite(d)) throw new Error('NCAT gave no height');
  return d - 100;
}

/**
 * A gauge's water surface in NAVD88 (m) from a reading, or null with the reason. Gage heights need a surveyed gauge
 * datum (stated accuracy within 0.5 ft; datums read off topographic maps can be several feet out).
 */
export async function gaugeSurface(g, lv, fetcher) {
  if (!lv) return { z: null, why: 'no reading' };
  if (lv.elev.NAVD88 != null) return { z: lv.elev.NAVD88, how: 'water-surface elevation, NAVD88' };
  if (lv.elev.NGVD29 != null) return { z: lv.elev.NGVD29 + await ngvdToNavd(g.lon, g.lat, fetcher), how: 'water-surface elevation, NGVD29 → NAVD88' };
  if (lv.gage == null) return { z: null, why: 'no level reading' };
  if (g.datumM == null || !/NAVD|NGVD/.test(g.datum ?? '')) return { z: null, why: 'gauge datum not on a national datum' };
  if (g.acyM != null && g.acyM > 0.5 * FT) return { z: null, why: `gauge datum only known to ±${(g.acyM / FT).toFixed(1)} ft` };
  const shift = /NGVD/.test(g.datum) ? await ngvdToNavd(g.lon, g.lat, fetcher) : 0;
  return { z: g.datumM + shift + lv.gage, how: `gage height + ${g.datum} datum` };
}

/**
 * The lidar water surface near a gauge: a 1 m 3DEP patch r metres around it, the 5th-percentile height (the river is
 * the lowest ground near its gauge; gauges sit on banks and bridges).
 */
export async function lidarSurfaceNear(lon, lat, fetcher, r = 60) {
  const dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
  const grid = gridFromLonLatBox(lon - dLon, lat - dLat, lon + dLon, lat + dLat, 1);
  const { z } = await fetchDEM(grid, fetcher);
  const v = Array.from(z).filter(x => x > -1000).sort((a, b) => a - b);
  return v.length ? v[Math.floor(0.05 * (v.length - 1))] : null;
}

/** Solver cells that are open water: NLCD open water (class 11) under the cell centre, or a mapped river/stream line through it. */
export function waterCells(c, F, fine, nlcd, lines) {
  const water = new Uint8Array(c.nx * c.ny), W = fine.nx;
  for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) {
    const K = J * c.nx + I; if (!c.mask[K]) continue;
    const fi = Math.min(W - 1, I * F + (F >> 1)), fj = Math.min(fine.ny - 1, J * F + (F >> 1));
    if (nlcd?.[fj * W + fi] === 11) water[K] = 1;
  }
  for (const l of lines ?? []) for (let s = 0; s + 1 < l.length; s++) {
    const [ax, ay] = l[s], [bx, by] = l[s + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / F * 2));
    for (let t = 0; t <= n; t++) {
      const I = Math.floor((ax + (bx - ax) * t / n) / F), J = Math.floor((ay + (by - ay) * t / n) / F);
      if (I >= 0 && J >= 0 && I < c.nx && J < c.ny && c.mask[J * c.nx + I]) water[J * c.nx + I] = 1;
    }
  }
  return water;
}

/** 8-connected components of water cells. → { id (Int32Array, −1 = land), count } */
export function components(water, nx, ny) {
  const id = new Int32Array(nx * ny).fill(-1); let count = 0;
  for (let k0 = 0; k0 < water.length; k0++) {
    if (!water[k0] || id[k0] >= 0) continue;
    const st = [k0]; id[k0] = count;
    while (st.length) {
      const k = st.pop(), i = k % nx, j = (k / nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a; if (water[q] && id[q] < 0) { id[q] = count; st.push(q); }
      }
    }
    count++;
  }
  return { id, count };
}

/**
 * Starting depth per solver cell. sources: [{ cells: [k…] (water cells it applies from), rise (m) | level (m) }] —
 * `rise` lifts the water surface parallel to the lidar surface, `level` sets it flat. Each source claims the water
 * component(s) its cells are in; within a component the nearest source wins. The water then spreads, nearest water
 * first, onto connected land below its level. → { depth (Float32Array), level (Float64Array, NaN = none) }
 */
export function startDepths(c, water, sources, { maxSpread = 300 } = {}) {
  const { nx, ny, z, mask } = c, N = nx * ny, level = new Float64Array(N).fill(NaN), depth = new Float32Array(N);
  const { id } = components(water, nx, ny), owner = new Int32Array(N).fill(-1), dist = new Float32Array(N).fill(Infinity);
  // nearest source within each claimed component (breadth-first over water cells from every source's cells)
  const claimed = new Set(); let q = [];
  sources.forEach((s, m) => s.cells.forEach(k => { if (id[k] < 0) return; claimed.add(id[k]); if (dist[k] > 0) { dist[k] = 0; owner[k] = m; q.push(k); } }));
  const step = (k, fn) => { const i = k % nx, j = (k / nx) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny) fn(b * nx + a, di && dj ? Math.SQRT2 : 1); } };
  while (q.length) { const nq = []; for (const k of q) step(k, (p, w) => { if (id[p] >= 0 && id[p] === id[k] && dist[k] + w < dist[p]) { dist[p] = dist[k] + w; owner[p] = owner[k]; nq.push(p); } }); q = nq; }
  const zs = c.zSurf ?? z; // a rise is above the lidar water surface (not a carved channel bed)
  for (let k = 0; k < N; k++) if (owner[k] >= 0) { const s = sources[owner[k]]; level[k] = s.level ?? zs[k] + Math.max(0, s.rise); }
  // spread onto land below the level, from the nearest water outward (each land cell takes its first-reached level)
  let front = []; for (let k = 0; k < N; k++) if (!Number.isNaN(level[k])) front.push(k);
  for (let r = 0; r < maxSpread && front.length; r++) {
    const nf = [];
    for (const k of front) step(k, (p) => { if (mask[p] && Number.isNaN(level[p]) && z[p] < level[k]) { level[p] = level[k]; nf.push(p); } });
    front = nf;
  }
  for (let k = 0; k < N; k++) if (mask[k] && level[k] > z[k]) depth[k] = level[k] - z[k];
  return { depth, level, claimed: claimed.size };
}

/** Lon/lat → solver cell index (or −1), for a grid with origin x0, y1 (north-up) and cell size F on fine grid `fine`. */
export function cellAt(fine, c, F, lon, lat) {
  const [x, y] = toUTM(lon, lat, fine.zone), I = Math.floor((x - fine.x0) / (fine.dx * F)), J = Math.floor((fine.y1 - y) / (fine.dx * F));
  return I >= 0 && J >= 0 && I < c.nx && J < c.ny ? J * c.nx + I : -1;
}

/** Water cells within r cells of cell k. */
export function waterNear(c, water, k, r = 30) {
  if (k < 0) return [];
  const i0 = k % c.nx, j0 = (k / c.nx) | 0, out = [];
  for (let j = Math.max(0, j0 - r); j <= Math.min(c.ny - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(c.nx - 1, i0 + r); i++) {
    const q = j * c.nx + i; if (water[q] && Math.hypot(i - i0, j - j0) <= r) out.push(q);
  }
  return out;
}
