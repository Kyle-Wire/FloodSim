// RT-1 reach builder (README, Model setup). For each registered site: the measurements (USGS field visits, direct,
// not Poor, since 2010), the main stem from NLDI, the lidar along it (3DEP at 3 m), the water-surface slope and the
// domain lengths, the corridor wide enough to hold the highest measured flow, and the stepped inflow. Writes one
// FloodSim project per site and configuration into the projects folder, plus rt1.json beside it for the scorer.
//
//   node benchmarks/rating/build.mjs --plan                 the geometry and sizes only, nothing written
//   node benchmarks/rating/build.mjs [--site 0214645022] [--config A|B] [--extend 1000] [--shift 100]
//     --extend  m: the downstream edge moved further (the boundary row)
//     --shift   m: the inflow edge moved (+ up, − down; the inflow row, short-upstream sites)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { fetchDEM } from '../../src/ingest.js';
import { toUTM, fromUTM, utmZone, utmEPSG } from '../../src/geo.js';
import { bankfull, CURVES } from '../../src/bathymetry.js';

const here = path.dirname(fileURLToPath(import.meta.url)), CACHE = path.join(here, '.cache');
const projectsDir = process.env.FLOODSIM_PROJECTS || path.join(homedir(), 'Documents', 'FloodSim Projects');
const NLDI = 'https://api.water.usgs.gov/nldi/linked-data', API = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections';
const FT = 0.3048, CFS = 0.028316846592;
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };

// The sites as revised (REGISTRATION.md, Revision 1). up: inflow edge distance above the gauge (m; short where a
// structure or tributary forces it). curve: the Bieger division for configuration B.
export const SITES = [
  { id: '06709530', region: 'CO', up: 1000, curve: 'IPL' },
  { id: '06730200', region: 'CO', up: 1000, curve: 'IPL' },
  { id: '01467081', region: 'PA/NJ', up: 1000, curve: 'APL' },
  { id: '08183978', region: 'TX', up: 500, curve: 'IPL', why: 'Kelly Creek joins at −0.545 km (structures-r1.json)' },
  { id: '05485605', region: 'IA', up: 400, curve: 'IPL', why: 'a split named Fourmile Creek joins at −0.421 km (structures-r1.json)' },
];
// Invalid setup under Revision 1 (the registered downstream length does not fit the app's 20 M-cell limit at 1 m):
// 05470000 South Skunk, 05486000 North River, 05471200 Indian Creek, 05484800 Walnut Creek, 01481000 Brandywine.
// Excluded by the corrected site check: 0214645022 Briar Creek (culvert +249 m).

// ---------------------------------------------------------------- fetching (cached on disk, as screen.mjs)
const cacheFile = (key) => path.join(CACHE, createHash('sha256').update(key).digest('hex') + '.json');
async function cachedJSON(key, url, init) {
  const f = cacheFile(key); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (r.ok) { const d = await r.json(); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); return d; }
    if (i >= 4) throw new Error(`${r.status} ${url.slice(0, 140)}`);
    await new Promise(res => setTimeout(res, 1000 * (+(r.headers.get('retry-after') ?? 0) || 5 * (i + 1))));
  }
}
const usgs = (url) => cachedJSON(url, url, process.env.USGS_API_KEY ? { headers: { 'X-Api-Key': process.env.USGS_API_KEY } } : {});
async function allFeatures(url) { const out = []; for (let u = url; u;) { const d = await usgs(u); out.push(...d.features); u = d.links?.find(l => l.rel === 'next')?.href; } return out; }

/** Direct, paired, not-Poor measurements since 2010 (README, Reference data). → [{ time, q m³/s, gh m, rated }] */
export async function measurements(id) {
  const fm = (await allFeatures(`${API}/field-measurements/items?monitoring_location_id=USGS-${id}&limit=10000&f=json`)).map(f => f.properties);
  const visits = new Map();
  for (const p of fm) {
    if (+p.year < 2010) continue;
    const v = visits.get(p.field_visit_id) ?? {}; visits.set(p.field_visit_id, v);
    if (p.parameter_code === '00060' && p.reading_type === 'Discharge') Object.assign(v, { q: +p.value * CFS, how: p.observing_procedure, rated: p.measurement_rated, time: p.time, visit: p.field_visit_id });
    if (p.parameter_code === '00065' && p.reading_type === 'MeanGageHeight') v.gh = +p.value * FT;
  }
  return [...visits.values()].filter(v => Number.isFinite(v.q) && Number.isFinite(v.gh) && v.q > 0 && /mid-section|acoustic doppler|adcp|current meter|mean-section|velocity/i.test(v.how ?? '') && !/poor/i.test(v.rated ?? ''))
    .sort((a, b) => a.q - b.q);
}

/** Q_mean (README, mid-flow row): the mean of the daily mean discharge since water year 2010 (m³/s). */
export async function meanFlow(id) {
  const d = await allFeatures(`${API}/daily/items?monitoring_location_id=USGS-${id}&parameter_code=00060&statistic_id=00003&time=2009-10-01/2026-09-30&limit=10000&f=json`);
  const v = d.map(f => +f.properties.value).filter(Number.isFinite); return { qMean: v.reduce((a, b) => a + b, 0) / v.length * CFS, days: v.length };
}

// ---------------------------------------------------------------- the main stem
/** Main stem points from `up` m above to `down` m below the gauge, in UTM, with chainage s (0 at the gauge). */
async function mainStem(gauge, zone, upKm, downKm) {
  const pos = await cachedJSON(`nldi-pos ${gauge}`, `${NLDI}/comid/position?f=json&coords=POINT(${gauge[0]} ${gauge[1]})`);
  const comid = pos.features[0].properties.comid;
  const um = await cachedJSON(`nldi UM ${comid} ${upKm}`, `${NLDI}/comid/${comid}/navigation/UM/flowlines?distance=${upKm}&f=json`);
  const dm = await cachedJSON(`nldi DM ${comid} ${downKm}`, `${NLDI}/comid/${comid}/navigation/DM/flowlines?distance=${downKm}&f=json`);
  // NHDPlus flowlines are digitised downstream: chain them end to start (UM and DM share the gauge's own flowline)
  const feats = new Map();
  for (const f of [...um.features, ...dm.features]) {
    const c = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.flat() : f.geometry.coordinates;
    feats.set(c.map(String).join(';'), c);
  }
  const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`, byStart = new Map([...feats.values()].map(c => [key(c[0]), c])), ends = new Set([...feats.values()].map(c => key(c.at(-1))));
  const starts = [...feats.values()].filter(c => !ends.has(key(c[0])));
  if (starts.length !== 1) throw new Error(`${starts.length} upstream ends in the main stem flowlines (expected 1)`);
  const chainLL = []; for (let c = starts[0], n = 0; c && n < 500; c = byStart.get(key(c.at(-1))), n++) chainLL.push(...(chainLL.length ? c.slice(1) : c));
  const g = toUTM(gauge[0], gauge[1], zone), line = chainLL.map(([lon, lat]) => toUTM(lon, lat, zone)), s = [0];
  for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  // chainage 0 at the point of the line nearest the gauge
  let k0 = 0, d0 = Infinity; line.forEach((p, i) => { const d = Math.hypot(p[0] - g[0], p[1] - g[1]); if (d < d0) { d0 = d; k0 = i; } });
  const off = s[k0];
  return { comid, pts: line.map((p, i) => ({ x: p[0], y: p[1], s: s[i] - off })), gaugeOffM: d0 };
}
/** Point on the line at chainage s (clamped to its ends). */
function pos(line, s) {
  const P = line.pts; let i = 1; while (i < P.length - 1 && P[i].s < s) i++;
  const a = P[i - 1], b = P[i], L = b.s - a.s || 1, t = Math.max(0, Math.min(1, (s - a.s) / L));
  return [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)];
}
/** Point and unit direction (downstream) on the line at chainage s; the direction over ±40 m, so a kink in the line
 *  does not swing the section. */
function at(line, s) {
  const [x, y] = pos(line, s), [x0, y0] = pos(line, s - 40), [x1, y1] = pos(line, s + 40), dl = Math.hypot(x1 - x0, y1 - y0) || 1;
  return { x, y, ux: (x1 - x0) / dl, uy: (y1 - y0) / dl };
}

// ---------------------------------------------------------------- a site
export async function planSite(site) {
  const loc = (await usgs(`${API}/monitoring-locations/items/USGS-${site.id}?f=json`));
  const p = loc.properties, gauge = loc.geometry.coordinates, zone = utmZone(gauge[0]), epsg = utmEPSG(zone);
  const ms = await measurements(site.id), datum = p.altitude * FT, { qMean, days } = await meanFlow(site.id);
  const cand = JSON.parse(fs.readFileSync(path.join(here, 'candidates.json'), 'utf8')).rows.find(r => r.id === 'USGS-' + site.id);
  const areaKm2 = p.drainage_area * 2.58999, bf = bankfull(areaKm2, CURVES[site.curve]);
  const extend = Number(opt('extend', 0)), shift = Number(opt('shift', 0));
  const line = await mainStem(gauge, zone, 4, 30);
  const sMin = line.pts[0].s, sMax = line.pts.at(-1).s;
  // lidar at 3 m over the line's box, padded for the floodplain
  const pad = 1600, xs = line.pts.map(q => q.x), ys = line.pts.map(q => q.y), dx = 3;
  const sUp = -(site.up + shift), demBox = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  // only the part of the line that can be in the domain (to 16 km down)
  const keep = line.pts.filter(q => q.s >= sUp - 200 && q.s <= 16000);
  Object.assign(demBox, { x0: Math.min(...keep.map(q => q.x)) - pad, y0: Math.min(...keep.map(q => q.y)) - pad, x1: Math.max(...keep.map(q => q.x)) + pad, y1: Math.max(...keep.map(q => q.y)) + pad });
  const grid = { ...demBox, dx, epsg, nx: Math.ceil((demBox.x1 - demBox.x0) / dx), ny: Math.ceil((demBox.y1 - demBox.y0) / dx) };
  const demKey = cacheFile(`dem ${site.id} ${grid.x0.toFixed(0)},${grid.y0.toFixed(0)},${grid.nx},${grid.ny},${dx}`).replace(/\.json$/, '.f32');
  let z;
  if (fs.existsSync(demKey)) z = new Float32Array(fs.readFileSync(demKey).buffer.slice(0));
  else { z = (await fetchDEM(grid, (u, i) => fetch(u, i))).z; fs.writeFileSync(demKey, Buffer.from(z.buffer)); }
  const zAt = (x, y) => { const i = Math.floor((x - grid.x0) / dx), j = Math.floor((grid.y1 - y) / dx); return i < 0 || j < 0 || i >= grid.nx || j >= grid.ny ? NaN : (z[j * grid.nx + i] > -1000 ? z[j * grid.nx + i] : NaN); };
  // the lowest ground across ±80 m of the line, every 25 m: the lidar water (or bed) surface along the river (the NHD
  // line can sit tens of metres off the channel)
  const prof = [];
  for (let s = Math.max(sMin, sUp - 200); s <= Math.min(sMax, 16000); s += 25) {
    const c = at(line, s); let lo = Infinity;
    for (let o = -80; o <= 80; o += 3) { const v = zAt(c.x - c.uy * o, c.y + c.ux * o); if (v < lo) lo = v; }
    if (Number.isFinite(lo)) prof.push([s, lo]);
  }
  // slope: least squares over the 2 km below the gauge (the reach that sets the gauge's backwater)
  const fit = (lo, hi) => { const q = prof.filter(([s]) => s >= lo && s <= hi), n = q.length, mx = q.reduce((a, b) => a + b[0], 0) / n, my = q.reduce((a, b) => a + b[1], 0) / n;
    return -q.reduce((a, b) => a + (b[0] - mx) * (b[1] - my), 0) / q.reduce((a, b) => a + (b[0] - mx) ** 2, 0); };
  const S = Math.max(1e-4, fit(0, 2000));
  const Lbw = 5 * bf.D / S, Ldn = Math.min(sMax, Math.max(2000, Lbw)) + extend;
  // corridor: each 50 m, out from the line on each side until the ground stands 1.5 m above the highest measured
  // level carried along the slope, plus 30 m; at least 60 m
  const hTop = Math.max(...ms.map(m => m.gh)) + datum, half = [];
  for (let s = sUp; s <= Ldn; s += 50) {
    // centred on the channel the lidar shows (the lowest ground within ±100 m of the NHD line), not on the line,
    // which can run tens of metres off it
    const c0 = at(line, s); let oc = 0, lo = Infinity;
    for (let o = -100; o <= 100; o += 2) { const v = zAt(c0.x - c0.uy * o, c0.y + c0.ux * o); if (v < lo) { lo = v; oc = o; } }
    const c = { ...c0, x: c0.x - c0.uy * oc, y: c0.y + c0.ux * oc }, H = hTop + 1.5 - S * s, w = [];
    for (const side of [1, -1]) { let o = 10; for (; o < 1500; o += 6) { const v = zAt(c.x - side * c.uy * o, c.y + side * c.ux * o); if (!(v < H)) break; } w.push(Math.max(60, o + 30)); }
    half.push({ s, c, l: w[0], r: w[1] });
  }
  // the channel points: a running median over 250 m, so one low spot in a side ditch does not swing the corridor
  { const X = half.map(h => h.c.x), Y = half.map(h => h.c.y), med = (a, i) => [...a.slice(Math.max(0, i - 2), i + 3)].sort((p, q) => p - q)[Math.min(2, Math.floor((a.slice(Math.max(0, i - 2), i + 3).length) / 2))];
    half.forEach((h, i) => { h.c = { ...h.c, x: med(X, i), y: med(Y, i) }; }); }
  // smooth the widths (a running max over 150 m), so a gully does not pinch the corridor
  const sm = half.map((h, i) => ({ ...h, l: Math.max(...half.slice(Math.max(0, i - 3), i + 4).map(q => q.l)), r: Math.max(...half.slice(Math.max(0, i - 3), i + 4).map(q => q.r)) }));
  // the corridor's sides checked every 3 m against the level they must hold: side cells outside the polygon are
  // sinks, so a side on ground below the river drains it (the Cibolo setup check, 14 Nov 2026: the right side at
  // 0.85–0.9 km stood on ground 1.5 m below the highest measured level; the widths are scanned from the channel point
  // before its running median, so a smoothed side can drift onto low ground). Where a side stands less than 0.5 m
  // above the highest measured level (carried along the slope), the two sections beside it widen by 24 m, until none
  // does or the half-width reaches 1500 m. Only ground the river can reach counts (below). edgeLow: what is left.
  // the ground the river can reach at that level: a fill from the channel points over the 3 m lidar, through cells below
  // the level of their nearest section, within 1600 m of the channel. Low ground the fill does not reach (another
  // valley over a ridge) does not count against a side.
  const reach = new Uint8Array(grid.nx * grid.ny), cellXY = (k) => [grid.x0 + (k % grid.nx + 0.5) * dx, grid.y1 - (Math.floor(k / grid.nx) + 0.5) * dx];
  const near = (x, y) => { let b = sm[0], d = Infinity; for (const h of sm) { const e = (h.c.x - x) ** 2 + (h.c.y - y) ** 2; if (e < d) { d = e; b = h; } } return [b, Math.sqrt(d)]; };
  { const q = []; for (const h of sm) { const i = Math.floor((h.c.x - grid.x0) / dx), j = Math.floor((grid.y1 - h.c.y) / dx); if (i >= 0 && j >= 0 && i < grid.nx && j < grid.ny) { reach[j * grid.nx + i] = 1; q.push(j * grid.nx + i); } }
    while (q.length) { const k = q.pop(), i = k % grid.nx;
      for (const n of [i > 0 ? k - 1 : -1, i < grid.nx - 1 ? k + 1 : -1, k - grid.nx, k + grid.nx]) {
        if (n < 0 || n >= reach.length || reach[n]) continue; const v = z[n]; if (!(v > -1000)) continue;
        const [x, y] = cellXY(n), [h, dist] = near(x, y); if (dist > 1600 || v >= hTop + 0.5 - S * h.s) continue;
        reach[n] = 1; q.push(n); } } }
  const reached = (x, y) => { const i = Math.floor((x - grid.x0) / dx), j = Math.floor((grid.y1 - y) / dx); return i >= 0 && j >= 0 && i < grid.nx && j < grid.ny && reach[j * grid.nx + i] === 1; };
  const sideAt = (h, side) => (side === 'left' ? [h.c.x - h.c.uy * h.l, h.c.y + h.c.ux * h.l] : [h.c.x + h.c.uy * h.r, h.c.y - h.c.ux * h.r]);
  let edgeLow = [], widened = 0;
  for (let pass = 0; pass < 80; pass++) {
    edgeLow = []; const bump = new Set();
    for (const side of ['left', 'right']) for (let i = 1; i < sm.length; i++) {
      const [ax, ay] = sideAt(sm[i - 1], side), [bx2, by2] = sideAt(sm[i], side), L = Math.hypot(bx2 - ax, by2 - ay);
      for (let d = 0; d < L; d += 3) { const t = d / L, x = ax + t * (bx2 - ax), y = ay + t * (by2 - ay), s = sm[i - 1].s + t * (sm[i].s - sm[i - 1].s), v = zAt(x, y), lv = hTop + 0.5 - S * s;
        if (v < lv && reached(x, y)) { edgeLow.push({ side, s: Math.round(s), ground: +v.toFixed(2), level: +lv.toFixed(2) }); bump.add(side + ' ' + (i - 1)).add(side + ' ' + i); } }
    }
    if (!bump.size) break;
    let grew = false;
    for (const k of bump) { const [side, i] = k.split(' '), h = sm[+i], key = side === 'left' ? 'l' : 'r'; if (h[key] < 1500) { h[key] += 24; grew = true; widened++; } }
    if (!grew) break;
  }
  const left = sm.map(h => sideAt(h, 'left')), right = sm.map(h => sideAt(h, 'right'));
  // run the corridor 150 m on past the inflow section, so the box cut clips it flush with the box side: a square end
  // set at an angle to the side leaves sinks between them, and the river's entry point then falls more than 8 m inside
  // the box, out of entryEdge's reach (the Cibolo setup check, 14 Nov 2026: all the inflow drained straight out)
  const ux0 = sm[0].c.ux, uy0 = sm[0].c.uy, back = ([x, y]) => [x - ux0 * 150, y - uy0 * 150];
  const r0 = back(right[0]), ringXY = [back(left[0]), ...left, ...[...right].reverse(), r0];
  // the box: the ring's bounds, cut at the inflow section on the side the river enters from, so the river enters
  // across a box side (src/inflow.js entryEdge) and not beside polygon sinks
  const u = { ...at(line, sUp), x: sm[0].c.x, y: sm[0].c.y }, bx = { x0: Math.min(...ringXY.map(q => q[0])), x1: Math.max(...ringXY.map(q => q[0])), y0: Math.min(...ringXY.map(q => q[1])), y1: Math.max(...ringXY.map(q => q[1])) };
  // the side: the river's direction there first, then the others; the first the line never crosses back over (a
  // meander that swings back past the cut would leave the domain)
  const sides = [Math.abs(u.ux) > Math.abs(u.uy) ? (u.ux > 0 ? 'west' : 'east') : (u.uy > 0 ? 'south' : 'north'), Math.abs(u.ux) > Math.abs(u.uy) ? (u.uy > 0 ? 'south' : 'north') : (u.ux > 0 ? 'west' : 'east')];
  const beyond = (side, q) => (side === 'west' ? q.x < u.x : side === 'east' ? q.x > u.x : side === 'south' ? q.y < u.y : q.y > u.y);
  const crossOf = (side) => line.pts.filter(q => q.s > sUp + 100 && q.s < Ldn && beyond(side, q));
  const entrySide = sides.find(sd => !crossOf(sd).length) ?? sides[0];
  if (entrySide === 'west') bx.x0 = u.x; if (entrySide === 'east') bx.x1 = u.x; if (entrySide === 'south') bx.y0 = u.y; if (entrySide === 'north') bx.y1 = u.y;
  const clip = ([x, y]) => [Math.max(bx.x0, Math.min(bx.x1, x)), Math.max(bx.y0, Math.min(bx.y1, y))];
  const crossPts = crossOf(entrySide);
  const crossBack = crossPts.length;
  const ll = (xy) => fromUTM(xy[0], xy[1], zone).map(v => +v.toFixed(6));
  // the ring is not clipped to the box: the app clips it to its own grid, which sits at a slight angle (grid
  // convergence) to this UTM box, so a ring cut exactly at the side would stop short of the app's edge
  const ring = ringXY.map(ll), [w, s0] = ll([bx.x0, bx.y0]), [e, n] = ll([bx.x1, bx.y1]);
  const cells = (bx.x1 - bx.x0) * (bx.y1 - bx.y0), ringArea = Math.abs(ringXY.map(clip).reduce((a, p, i, A) => { const q = A[(i + 1) % A.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  // stepped inflow: 7 levels log-spaced over the measured range; each held for 3 travel times at 1 m/s, at least 60 min
  // (floored at 1/2000 of the top: a reading of 0.00 m³/s cannot be spaced on log Q; the low-flow row is not scored)
  // Revision 2: the reach is first filled for 2 holds at the top flow (the warm-up), then the levels run from the top
  // down, so each step only drains and no floodplain hollow is still filling when a level is read (the Cibolo A run of
  // Revision 1: 117,000 m³ went into dry hollows below the gauge, and the outlet lagged the inflow at 5 of 7 steps)
  const qs = ms.map(m => m.q), qHi = Math.max(...qs), qLo = Math.max(Math.min(...qs), qHi / 2000), nLv = 7;
  const levels = Array.from({ length: nLv }, (_, i) => qLo * (qHi / qLo) ** (i / (nLv - 1)));
  const hold = Math.max(60, Math.ceil((3 * (Ldn - sUp) / 1.0) / 60 / 5) * 5);
  const gaugeXY = toUTM(gauge[0], gauge[1], zone), zg = prof.reduce((a, b) => (Math.abs(b[0]) < Math.abs(a[0]) ? b : a))[1];
  // section lines for the books: at the gauge and 200 m above the downstream edge, across the whole corridor
  const section = (s) => { const h = sm.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a)); return [ll(clip([h.c.x - h.c.uy * (h.l - 5), h.c.y + h.c.ux * (h.l - 5)])), ll(clip([h.c.x + h.c.uy * (h.r - 5), h.c.y - h.c.ux * (h.r - 5)]))]; };
  return {
    site, name: p.monitoring_location_name, gauge, zone, datum, datumAcyM: (p.altitude_accuracy ?? 0) * FT, areaKm2, bankfull: bf, slope: S, backwaterM: Lbw,
    upM: site.up + shift, downM: Ldn, entrySide, crossBack, box: [w, s0, e, n], ring, boxCells: cells, corridorM2: ringArea, maxHalfWidthM: Math.max(...sm.map(h => Math.max(h.l, h.r))),
    measurements: ms, q2Cfs: cand.q2, qMean, qMeanDays: days, hTop, lidarAtGauge: zg, gaugeOffLineM: line.gaugeOffM, steps: levels.map(q => [+q.toFixed(3), hold]).reverse(), fill: { q: +qHi.toFixed(3), hours: +(2 * hold / 60).toFixed(2) }, holdMin: hold, totalH: hold * nLv / 60 + 2 * hold / 60,
    sections: { gauge: section(0), outlet: section(Ldn - 200) }, edgeLow, widened, lidarNearGauge: (() => { let lo = Infinity; for (let a = -60; a <= 60; a += 3) for (let b = -60; b <= 60; b += 3) if (a * a + b * b <= 3600) { const v = zAt(gaugeXY[0] + a, gaugeXY[1] + b); if (v < lo) lo = v; } return lo; })(), ghRange: [Math.min(...ms.map(m => m.gh)) + datum, hTop], comid: line.comid, probe: (() => { const c = at(line, 0); return { c, H: hTop + 1.5, vals: [0, 30, 60, 120, 240, 480, 960].map(o => [o, zAt(c.x - c.uy * o, c.y + c.ux * o), zAt(c.x + c.uy * o, c.y - c.ux * o)]) }; })(), grid: { x0: grid.x0, y1: grid.y1, nx: grid.nx, ny: grid.ny }, widths: sm.map(h => [h.s, h.l, h.r]), crossAt: crossPts.map(q => Math.round(q.s)), inflowAt: ll([u.x, u.y]), gaugeXY,
  };
}

/** The FloodSim project for a site and configuration (A: lidar; B: + estimated bathymetry). */
export function projectFor(pl, config) {
  const tag = [opt('extend') ? `ext${opt('extend')}` : '', opt('shift') ? `shift${opt('shift')}` : ''].filter(Boolean).join(' ');
  const name = `RT-1 ${pl.site.id} ${config}${tag ? ' ' + tag : ''}`;
  const steadyTest = { steps: pl.steps, fill: pl.fill, ramp: 10, inflow: pl.inflowAt, gauge: { site: pl.site.id, name: pl.name, lon: pl.gauge[0], lat: pl.gauge[1] } };
  const inputs = {
    dxSel: '1', bathySel: config === 'B' ? pl.site.curve : 'off', steadyTest: JSON.stringify(steadyTest),
    tail: '0', startWater: 'lidar', infilModel: 'const', roof: '0', bankOn: false, sedOn: false, debrisOn: false, csoOn: false,
    giPave: '0', giGarden: '0', giRoof: '0', giTank: '0', speed: '100', calManning: '1', calInfil: '1', frameEvery: '300',
  };
  const lines = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { type: 'cline', name: 'gauge section' }, geometry: { type: 'LineString', coordinates: pl.sections.gauge } },
    { type: 'Feature', properties: { type: 'cline', name: 'outlet section' }, geometry: { type: 'LineString', coordinates: pl.sections.outlet } },
  ] };
  const project = { version: 1, area: pl.box, poly: pl.ring, place: `${pl.name} (RT-1, configuration ${config})`, stormSrc: 'const', drainSrc: 'none',
    inputs, view: { center: [(pl.box[0] + pl.box[2]) / 2, (pl.box[1] + pl.box[3]) / 2], zoom: 14 }, obs: [], name, app: 'FloodSim', maps: [] };
  return { name, project, lines };
}

async function main() {
  const only = opt('site'), configs = opt('config') ? [opt('config')] : ['A', 'B'];
  const plans = [];
  for (const site of SITES.filter(s => !only || s.id === only)) {
    const pl = await planSite(site); plans.push(pl);
    const f = (v, d = 0) => v.toFixed(d);
    console.log(`${site.id} ${pl.name}\n  ${pl.measurements.length} measurements, Q ${f(pl.steps.at(-1)[0], 2)}–${f(pl.steps[0][0], 1)} m³/s (filled ${pl.fill.hours} h at the top, then stepped down); slope ${pl.slope.toExponential(2)}; bankfull D ${f(pl.bankfull.D, 2)} m (${site.curve}); 5D/S ${f(pl.backwaterM)} m` +
      `\n  domain ${pl.upM} m up, ${f(pl.downM)} m down; entry from the ${pl.entrySide}${pl.crossBack ? ` (WARNING: the line crosses back over the cut at ${pl.crossBack} points)` : ''}; box ${f(pl.boxCells / 1e6, 1)} M cells at 1 m, corridor ${f(pl.corridorM2 / 1e6, 2)} km², widest half ${f(pl.maxHalfWidthM)} m` +
      `\n  gauge ${f(pl.gaugeOffLineM)} m off the NHD line; lidar there ${f(pl.lidarAtGauge, 2)} m, measured top ${f(pl.hTop, 2)} m NAVD88; ${pl.steps.length} levels × ${pl.holdMin} min + the fill = ${f(pl.totalH, 1)} h simulated`);
    if (argv.includes('--plan')) continue;
    if (argv.includes('--rt1-only')) { for (const config of configs) { const dir = path.join(projectsDir, projectFor(pl, config).name); fs.writeFileSync(path.join(dir, 'rt1.json'), JSON.stringify({ made: new Date().toISOString(), config, ...pl, ring: undefined }, null, 1)); console.log(`  rt1.json rewritten in "${projectFor(pl, config).name}"`); } continue; }
    for (const config of configs) {
      const { name, project, lines } = projectFor(pl, config), dir = path.join(projectsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 1));
      fs.writeFileSync(path.join(dir, 'analysis.geojson'), JSON.stringify(lines));
      fs.writeFileSync(path.join(dir, 'rt1.json'), JSON.stringify({ made: new Date().toISOString(), config, ...pl, ring: undefined }, null, 1));
      console.log(`  wrote "${name}"`);
    }
  }
  if (argv.includes('--plan')) fs.writeFileSync(path.join(here, '.cache', 'plan.json'), JSON.stringify(plans.map(p => ({ ...p, ring: undefined, measurements: p.measurements.length })), null, 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
