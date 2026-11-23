// The backyard block: a synthetic suburban block for testing the emulator cascade on homeowner what-ifs.
//
// Four lots (16 m × 54 m) face a street that drains east to a free outfall. Each lot has a 10 m × 10 m house with a
// 3 m side yard on each side, and the back yards slope toward the houses, so water from the back must pass the houses
// through the side yards. The second lot from the west is the HOME: its back yard has a shallow low spot behind the house (the
// "catch basin" yard). The lot to its east is the NEIGHBOR, whose back yard can be raised (a fill that sheds onto the
// home's yard, the case Kyle grew up with).
//
// The homeowner what-ifs, all on the home lot, all continuous so a Gaussian process can learn them, all 0 = not built:
//   french   French drain size (0–1): a gravel trench from the low spot along the west side yard to the front, intake
//            2000 mm/hr, storage up to 0.6 m of water per m² of trench (1 m wide, 1.5 m deep, 40 % voids), emptied by
//            its pipe at up to 500 mm/hr per m² of trench to the street sewer (that water leaves the model).
//   garden   rain-garden storage depth (0–0.3 m) on a 4 m × 5 m garden at the low spot; engineered soil 100 mm/hr,
//            draining to the native soil.
//   barrel   rain-barrel volume on the back downspout (0–1000 L): the first litres of back-roof runoff are kept.
//   redirect share of the back roof sent to the front downspout by a gutter change (0–1).
//   trees    tree canopy share of the home's back yard (0–0.6): 2 mm of interception at full cover, infiltration up
//            by the same share (roots, litter).
// And three conditions the homeowner does not control:
//   ari      return period of the 1-hr Atlas 14 storm at Eastwick, Philadelphia (tests/fixtures), 2–100 yr, log scale.
//   wet      soil wetness at the start (0–1): lawn infiltration (HSG C, 2.5 mm/hr in FloodSim's table... here 10 mm/hr
//            for a short storm on a lawn, see SCENE below) times (1 − 0.8·wet).
//   raise    the neighbor's back-yard fill (0–0.4 m), with a 1 m ramp at the shared fence line.
// Every number here is a stated assumption for a synthetic test, not a calibrated site value.
import { readFileSync } from 'node:fs';
import { CPUSolver } from '../../src/solver-cpu.js';
import { parsePFDS, hyetograph } from '../../src/storm.js';

export const PARAMS = [
  { key: 'ari', label: 'Storm (return period, yr)', min: 2, max: 100, log: true, who: 'weather' },
  { key: 'wet', label: 'Soil wetness at the start', min: 0, max: 1, who: 'weather' },
  { key: 'raise', label: "Neighbor's yard fill (m)", min: 0, max: 0.4, who: 'neighbor' },
  { key: 'french', label: 'French drain size', min: 0, max: 1, who: 'you' },
  { key: 'garden', label: 'Rain garden depth (m)', min: 0, max: 0.3, who: 'you' },
  { key: 'barrel', label: 'Rain barrel (L)', min: 0, max: 1000, who: 'you' },
  { key: 'redirect', label: 'Back roof sent to the front', min: 0, max: 1, who: 'you' },
  { key: 'trees', label: 'Tree canopy in the back yard', min: 0, max: 0.6, who: 'you' },
];

export const SCENE = {
  nx: 64, ny: 64, dx: 1,
  streetY: 10, lotW: 16, lot0: 0, nLots: 4, home: 1, neighbor: 2,
  houseY0: 18, houseY1: 28, side: 3,
  lawnInfil: 10, // mm/hr on dry lawn: a short-storm rate between HSG B and C Green-Ampt early-time rates (assumption)
  nStreet: 0.016, nLawn: 0.05,
  stormMin: 60, afterMin: 60, chunk: 30, // s between barrel / interception updates
};
const MMHR = 1 / 3.6e6;
let PF = null;
const pf = () => PF ?? (PF = parsePFDS(readFileSync(new URL('../../tests/fixtures/atlas14-eastwick-pds-metric.txt', import.meta.url), 'utf8')));

/** Lot index of column i (−1 outside lots). */
const lotOf = (i) => Math.floor((i - SCENE.lot0) / SCENE.lotW);
/** Region tags for cell (i, j) of the home: 'house' | 'back' (home back yard) | null. */
export function geometry() {
  const { nx, ny, streetY, lotW, houseY0, houseY1, side, home, neighbor } = SCENE;
  const N = nx * ny, house = new Uint8Array(N), lot = new Int8Array(N).fill(-1), back = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, L = lotOf(i); if (j < streetY) continue;
    lot[k] = L; const x = i - L * lotW;
    if (j >= houseY0 && j < houseY1 && x >= side && x < lotW - side) house[k] = 1;
    if (j >= houseY1) back[k] = L + 1; // 1-based lot of back yards
  }
  const hx0 = home * lotW, cx = hx0 + lotW / 2, lowJ = houseY1 + 5;
  const garden = [], french = [], wall = [], yard = [], nbrYard = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (i >= cx - 2 && i < cx + 2 && j >= lowJ - 2 && j < lowJ + 3) garden.push(k);
    if (back[k] === home + 1) yard.push(k);
    if (back[k] === neighbor + 1) nbrYard.push(k);
    if (j === houseY1 && i >= hx0 + side && i < hx0 + lotW - side) wall.push(k); // cells against the back wall
  }
  // French drain: from the low spot west to the side-yard centre, then south down the side yard to the front yard
  const sx = hx0 + 1;
  for (let i = sx; i <= cx - 3; i++) french.push(lowJ * nx + i);
  for (let j = streetY + 3; j < lowJ; j++) french.push(j * nx + sx);
  const downBack = houseY1 * nx + Math.round(cx), downFront = (houseY0 - 1) * nx + Math.round(cx); // downspout outlets
  return { N, house, lot, back, garden, french, wall, yard, nbrYard, downBack, downFront, lowSpot: lowJ * nx + Math.round(cx) };
}

/** Ground for a parameter set (only `raise` moves it). */
export function ground(v) {
  const { nx, ny, streetY, lotW, houseY1, neighbor, home } = SCENE, z = new Float64Array(nx * ny);
  const hx0 = home * lotW, cx = hx0 + lotW / 2, lowJ = houseY1 + 5;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (j < streetY) { // crowned street draining east, gutters at the curb line
      const crown = 0.08 * (1 - Math.abs(j - streetY / 2) / (streetY / 2));
      z[k] = 10 + 0.005 * (nx - i) + crown; continue;
    }
    // lots: curb 0.15 m, front yards rise 2 % to the house, back yards rise 1.5 % away from the house
    let e = 10 + 0.005 * (nx - i) + 0.15 + 0.02 * Math.min(j - streetY, 8) + 0.015 * Math.max(0, j - houseY1);
    e += 0.002 * ((i % lotW) - lotW / 2) ** 2 / 8; // lots dished slightly toward their centreline
    const L = lotOf(i);
    if (L === home) e -= 0.22 * Math.exp(-((i + 0.5 - cx) ** 2 + (j + 0.5 - lowJ) ** 2) / (2 * 3.5 ** 2)); // the low spot
    if (L === neighbor && j >= houseY1) e += v.raise * Math.min(1, (i - neighbor * lotW + 0.5) / 1.5); // fill, ramped at the fence
    z[k] = e;
  }
  return z;
}

/** Parameter values from a unit-cube point. */
export function values(u) {
  const o = {}; PARAMS.forEach((p, k) => { o[p.key] = p.log ? p.min * (p.max / p.min) ** u[k] : p.min + u[k] * (p.max - p.min); }); return o;
}

/**
 * One full solver run. → { z, maxWse (NaN dry), speed (√ of peak), dur (s above 15 cm), scalars, seconds, mass }
 * scalars: wallPeak (m, deepest water against the home's back wall), yardVolPeak (m³ ponded in the home's back yard at
 * its peak), lowWetHours (h the low spot is deeper than 2 cm), nbrWallPeak (m, the west neighbor's back wall).
 */
export function run(v, { lts = 3 } = {}) {
  const t0 = performance.now(), G = geometry(), { nx, ny, dx } = SCENE, N = nx * ny, z = ground(v);
  const mask = new Uint8Array(N), manning = new Float64Array(N);
  for (let k = 0; k < N; k++) { mask[k] = G.house[k] ? 0 : 1; manning[k] = G.lot[k] < 0 ? SCENE.nStreet : SCENE.nLawn; }
  const gi = { rate: new Float64Array(N), cap: new Float64Array(N), drain: new Float64Array(N) };
  if (v.french > 0) for (const k of G.french) { gi.rate[k] = 2000 * MMHR; gi.cap[k] = 0.6 * v.french; gi.drain[k] = 500 * MMHR * v.french; }
  if (v.garden > 0) for (const k of G.garden) { gi.rate[k] = 100 * MMHR; gi.cap[k] = v.garden; gi.drain[k] = SCENE.lawnInfil * MMHR * 0.5; }
  const S = new CPUSolver({ nx, ny, dx, z, manning, mask, gi, lts, bc: { east: 'outflow', west: 'wall', south: 'wall', north: 'wall' } });
  const P = (k) => S.idx(k % nx, (k / nx) | 0);
  const yardSet = new Set(G.yard), f0 = SCENE.lawnInfil * MMHR * (1 - 0.8 * v.wet);
  for (let k = 0; k < N; k++) if (G.lot[k] >= 0 && !G.house[k]) S.infil[P(k)] = f0 * (yardSet.has(k) ? 1 + v.trees : 1);
  // roofs: every house sends half its roof to a front and half to a back downspout; the home's back half goes through
  // the barrel and the redirect
  const rf = new Float64Array(S.NX * S.NY); for (let k = 0; k < N; k++) if (mask[k]) rf[P(k)] = 1;
  const roof = (SCENE.houseY1 - SCENE.houseY0) * (SCENE.lotW - 2 * SCENE.side), outlets = [];
  for (let L = 0; L < SCENE.nLots; L++) {
    const cx = Math.round(L * SCENE.lotW + SCENE.lotW / 2);
    outlets.push({ L, front: P((SCENE.houseY0 - 1) * nx + cx), back: P(SCENE.houseY1 * nx + cx) });
  }
  const st = hyetograph(pf(), { ari: v.ari, durationMin: SCENE.stormMin, blockMin: 5 });
  let barrelLeft = v.barrel / 1000, intercept = 0.002 * v.trees; // m³, m
  const yardP = G.yard.map(P), wallP = G.wall.map(P), nbrWallP = G.wall.map(k => P(k - SCENE.lotW)), lowP = P(G.lowSpot);
  let yardVolPeak = 0, wallPeak = 0, nbrWallPeak = 0, lowWet = 0;
  const tEnd = (SCENE.stormMin + SCENE.afterMin) * 60;
  for (let t = 0; t < tEnd; t += SCENE.chunk) {
    const b = Math.floor(t / (st.blockMin * 60)), I = b < st.intensity.length ? st.intensity[b] * MMHR : 0; // m/s
    const field = Float64Array.from(rf);
    // interception: canopy holds rain over the yard until its store fills
    if (intercept > 0 && I > 0) { const take = Math.min(intercept, I * SCENE.chunk); intercept -= take; for (const c of yardP) field[c] = 1 - take / (I * SCENE.chunk); }
    for (const o of outlets) {
      let front = 0.5 * roof, back = 0.5 * roof;
      if (o.L === SCENE.home) {
        front += v.redirect * back; back *= 1 - v.redirect;
        const vol = back * I * SCENE.chunk, kept = Math.min(barrelLeft, vol); barrelLeft -= kept; back *= vol > 0 ? 1 - kept / vol : 1;
      }
      field[o.front] += front; field[o.back] += back;
    }
    S.rainRate = I; S.rainField = field;
    S.run(t + SCENE.chunk);
    let vol = 0; for (const c of yardP) vol += S.h[c]; vol *= dx * dx; if (vol > yardVolPeak) yardVolPeak = vol;
    for (const c of wallP) wallPeak = Math.max(wallPeak, S.h[c]);
    for (const c of nbrWallP) nbrWallPeak = Math.max(nbrWallPeak, S.h[c]);
    if (S.h[lowP] > 0.02) lowWet += SCENE.chunk;
  }
  const maxD = S.field('maxDepth'), maxWse = new Float32Array(N), speed = new Float32Array(N), dur = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    maxWse[k] = mask[k] && maxD[k] > 0.005 ? z[k] + maxD[k] : NaN;
    speed[k] = Math.sqrt(S.hz.vmax[k]); dur[k] = S.hz.duration[k];
  }
  const mb = S.massBalance();
  return { z, mask, maxWse, speed, dur, scalars: { wallPeak, yardVolPeak, lowWetHours: lowWet / 3600, nbrWallPeak }, seconds: (performance.now() - t0) / 1000, mass: mb.rel, rainMm: st.total };
}
