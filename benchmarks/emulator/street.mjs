// A synthetic street of 16 lots with three planted oddities, for testing the surprise score with a known answer.
//   node benchmarks/emulator/street.mjs <outDir>
// The lots follow the backyard block (benchmarks/emulator/backyard.mjs): 16 m wide, a 10 m × 10 m house, side yards of
// 3 m, back yards rising away from the house, a street draining east to a free outfall. Each lot gets ordinary random
// variation (seed 5): a height offset (sd 8 cm, carried by the whole lot and its curb), back-yard slope 1.0–2.0 %, a
// dish across the lot of 0–4 mm/m². Three lots are planted:
//   lot 4   a low spot in the back yard behind the house (−0.22 m, sigma 3.5 m): Kyle's catch-basin yard
//   lot 9   its eastern neighbour (lot 10) has filled its back yard by 0.30 m, ramped at the fence, shedding onto lot 9
//   lot 13  the whole lot sits 0.25 m lower than its neighbours (the oddity its height alone explains)
// Runs the 2-, 10- and 100-yr 1-hr storms and writes, per lot, the 90th-percentile max depth in the 2 m ring around the
// house (the surprise score's reading), plus the lot's median ring ground and the maps.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CPUSolver } from '../../src/solver-cpu.js';
import { parsePFDS, hyetograph } from '../../src/storm.js';
import { rng } from '../../src/emulator.js';

const L = 16, W = 16, ny = 64, nx = L * W, streetY = 10, hy0 = 18, hy1 = 28, side = 3, MMHR = 1 / 3.6e6;
export const PLANTED = { low_spot: 4, neighbour_fill: 9, low_lot: 13 };
const r = rng(5), lots = Array.from({ length: L }, () => ({ off: 0.08 * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()), slope: 0.01 + 0.01 * r(), dish: 0.004 * r() }));
lots[PLANTED.low_lot].off -= 0.25;
const lotOf = (i) => Math.floor(i / W);
function ground() {
  const z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (j < streetY) { z[k] = 10 + 0.003 * (nx - i) + 0.08 * (1 - Math.abs(j - streetY / 2) / (streetY / 2)); continue; }
    const q = lotOf(i), p = lots[q], x = i - q * W;
    let e = 10 + 0.003 * (nx - i) + 0.15 + p.off + 0.02 * Math.min(j - streetY, 8) + p.slope * Math.max(0, j - hy1) + p.dish * (x - W / 2) ** 2 / 8;
    if (q === PLANTED.low_spot) e -= 0.22 * Math.exp(-((i + 0.5 - (q * W + W / 2)) ** 2 + (j + 0.5 - (hy1 + 5)) ** 2) / (2 * 3.5 ** 2));
    if (q === PLANTED.neighbour_fill + 1 && j >= hy1) e += 0.30 * Math.min(1, (x + 0.5) / 1.5);
    z[k] = e;
  }
  // smooth the curb offsets between lots over 1 m so lot steps are ramps, not walls
  return z;
}
function run(ari, z) {
  const N = nx * ny, mask = new Uint8Array(N).fill(1), manning = new Float64Array(N), house = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i, x = i % W; if (j >= hy0 && j < hy1 && x >= side && x < W - side) { house[k] = 1; mask[k] = 0; } manning[k] = j < streetY ? 0.016 : 0.05; }
  const S = new CPUSolver({ nx, ny, dx: 1, z, manning, mask, lts: 3, bc: { east: 'outflow' } }), P = (k) => S.idx(k % nx, (k / nx) | 0);
  for (let k = 0; k < N; k++) if (mask[k] && ((k / nx) | 0) >= streetY) S.infil[P(k)] = 10 * MMHR * 0.6;
  const rf = new Float64Array(S.NX * S.NY); for (let k = 0; k < N; k++) if (mask[k]) rf[P(k)] = 1;
  for (let q = 0; q < L; q++) { const cx = q * W + W / 2; rf[P((hy0 - 1) * nx + cx)] += 50; rf[P(hy1 * nx + cx)] += 50; }
  S.rainField = rf;
  const pf = parsePFDS(readFileSync(new URL('../../tests/fixtures/atlas14-eastwick-pds-metric.txt', import.meta.url), 'utf8'));
  const st = hyetograph(pf, { ari, durationMin: 60, blockMin: 5 });
  for (let b = 0; b < st.intensity.length + 6; b++) { S.rainRate = b < st.intensity.length ? st.intensity[b] * MMHR : 0; S.run((b + 1) * 300); }
  return { depth: S.field('maxDepth'), house };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2]; mkdirSync(out, { recursive: true });
  const z = ground(), res = { lots: L, planted: PLANTED, lotParams: lots, storms: [], ring: [], ringGround: [] };
  let house;
  for (const ari of [2, 10, 100]) {
    const t0 = Date.now(), o = run(ari, z); house = o.house; res.storms.push(`${ari}-yr 1-hr`);
    const ring = [];
    for (let q = 0; q < L; q++) {
      const cells = [];
      for (let j = hy0 - 2; j < hy1 + 2; j++) for (let i = q * W + side - 2; i < q * W + W - side + 2; i++) { const k = j * nx + i; if (!house[k]) cells.push(k); }
      const d = cells.map(k => o.depth[k]).sort((a, b) => a - b); ring.push(d[Math.floor(0.9 * (d.length - 1))]);
      if (res.ringGround.length < L) { const g = cells.map(k => z[k]).sort((a, b) => a - b); res.ringGround.push(g[Math.floor(g.length / 2)]); }
    }
    res.ring.push(ring);
    writeFileSync(`${out}/street_${ari}yr.f32`, Buffer.from(Float32Array.from(o.depth).buffer));
    console.log(`${ari}-yr done in ${((Date.now() - t0) / 1000).toFixed(0)} s`, ring.map(v => (100 * v).toFixed(1)).join(' '));
  }
  writeFileSync(`${out}/street.json`, JSON.stringify({ ...res, nx, ny, W, z: Array.from(z), house: Array.from(house) }));
}
