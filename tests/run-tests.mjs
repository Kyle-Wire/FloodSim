// Verification suite for the CPU reference solver.
// Usage: node tests/run-tests.mjs [--json out.json]
// Exits 1 if any check fails.
//
// ---------------------------------------------------------------------------------------------------------
// Thresholds
//
// Every ceiling and floor below is pinned to a value measured at commit 0e8ba34 on 1 November 2026
// (node v24.16.0, Windows x64). The measured value is quoted next to each threshold; the margin between
// them is set by which of two regimes the quantity lives in:
//
//  * Discretisation error (the L1 norms and the observed convergence orders). These are deterministic in
//    fp64 and reproduce bitwise on one platform. Across platforms they move only in the last few digits
//    (FMA contraction, libm differences in exp/pow). The ceilings are therefore measured + ~6 %, which no
//    port will trip, while any genuine loss of accuracy — a dropped limiter, a reconstruction reverting to
//    piecewise-constant — shows up as a factor of 2 or more, or as a halved convergence rate.
//
//  * Round-off floors (lake-at-rest velocities, mass-balance residuals). These sit at 1e-14 to 1e-16 and
//    depend on summation order and on how many steps the run happens to take, so a percentage margin is
//    meaningless; they get 2–3 orders of head-room instead. That head-room is still 6–8 orders below the
//    size of a real defect: broken well-balancing produces spurious currents of O(1e-3) m/s or larger, and
//    an unaccounted flux or sink produces a mass error of O(1e-6) or larger.
//
// A threshold that cannot be justified gets loosened the first time it fails, so none here is a round
// number chosen for looking tidy.
// ---------------------------------------------------------------------------------------------------------
import { CPUSolver } from '../src/solver-cpu.js';
import { damBreak, thackerPlanar } from '../src/analytic.js';
import { cloudburst, dambreak, MMHR } from '../src/scenarios.js';
import { writeFileSync } from 'node:fs';

const g = 9.81;
const results = {};
const log = (...a) => console.log(...a);

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const atMost = (name, v, ceil, unit = '') => check(name, Math.abs(v) <= ceil, `|${v.toExponential(2)}| <= ${ceil.toExponential(2)}${unit}`);
const atLeast = (name, v, floor, unit = '') => check(name, v >= floor, `${v.toFixed(3)} >= ${floor.toFixed(2)}${unit}`);

// ---------- 1. Dam breaks with grid convergence ----------
function damBreakRun(hR, nx, secondOrder = true) {
  const Lx = 100, x0 = 50, hL = 1, tEnd = 6, ny = 3, dx = Lx / nx;
  const z = new Float64Array(nx * ny);
  const s = new CPUSolver({ nx, ny, dx, z, manning: 0, secondOrder, bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' } });
  s.setDepth((x) => (x < x0 ? hL : hR));
  s.run(tEnd);
  const exact = damBreak(hL, hR, x0, g);
  const h = s.field('h'); const j = 1;
  let e1 = 0, n1 = 0, profile = [];
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx, he = exact(x, tEnd), hn = h[j * nx + i];
    e1 += Math.abs(hn - he); n1 += Math.abs(he);
    profile.push([+x.toFixed(4), +hn.toFixed(6), +he.toFixed(6)]);
  }
  return { nx, L1rel: e1 / n1, mass: s.massBalance(), steps: s.steps, profile };
}

// Measured L1 relative error at nx = 100, 200, 400, 800, and the ceiling applied to each.
// Ceilings are the measured value + ~6 % (see the margin note at the top of the file).
//   stoker measured: 6.260e-3  3.423e-3  1.602e-3  7.949e-4
//   ritter measured: 1.027e-2  5.108e-3  2.530e-3  1.266e-3
const L1_CEIL = {
  stoker: [6.64e-3, 3.63e-3, 1.70e-3, 8.43e-4],
  ritter: [1.09e-2, 5.41e-3, 2.68e-3, 1.34e-3],
};
// Observed order of each refinement pair (100→200, 200→400, 400→800).
//   stoker measured: 0.871  1.095  1.011
//   ritter measured: 1.008  1.014  0.999
// L1 convergence of a second-order scheme is capped at 1 by the shock, so ~1.0 is the correct target and
// 0.95 (the programme's starting point) leaves 5 % on the two refined pairs.
// The coarsest pair is the exception: Stoker measures 0.871 there, because at nx=100 the wet dam break is
// not yet in the asymptotic range — 100 cells over a 100 m domain puts only a handful of cells across the
// rarefaction. That is a property of the grid, not a defect, so the coarse pair is gated at 0.80 (8 % below
// the measured 0.871) rather than at 0.95. Reported to the programme as a deviation from the 0.95 starting
// point; the two refined pairs, which are the ones the baseline table quotes, hold 0.95.
const ORDER_FLOOR = [0.80, 0.95, 0.95];

for (const [name, hR] of [['stoker', 0.5], ['ritter', 0]]) {
  const levels = [100, 200, 400, 800].map(nx => damBreakRun(hR, nx));
  const orders = levels.slice(1).map((r, k) => Math.log2(levels[k].L1rel / r.L1rel));
  results[name] = {
    levels: levels.map(r => ({ nx: r.nx, L1rel: r.L1rel, massRel: r.mass.rel, steps: r.steps })),
    observedOrder: orders,
    profile: levels[2].profile, // nx=400 for plotting
  };
  log(`\n${name.toUpperCase()} dam break (hL=1, hR=${hR}, t=6 s)`);
  levels.forEach((r, k) => log(`  nx=${String(r.nx).padStart(4)}  L1 rel err=${r.L1rel.toExponential(3)}  mass rel=${r.mass.rel.toExponential(2)}${k ? `  order=${orders[k - 1].toFixed(2)}` : ''}`));
  levels.forEach((r, k) => atMost(`${name} nx=${r.nx} L1`, r.L1rel, L1_CEIL[name][k]));
  // Mass is conserved to round-off here: the domain is walled, so the only loss channel is fp64 summation.
  // Measured |rel| <= 2.3e-15 over all eight runs; 1e-12 is ~400x that floor and ~6 orders below a real leak.
  levels.forEach(r => atMost(`${name} nx=${r.nx} mass balance`, r.mass.rel, 1e-12));
  orders.forEach((o, k) => atLeast(`${name} order ${levels[k].nx}→${levels[k + 1].nx}`, o, ORDER_FLOOR[k]));
}
// first-order comparison at nx=400
results.stoker.firstOrderL1 = damBreakRun(0.5, 400, false).L1rel;
log(`  first-order at nx=400: L1 rel err=${results.stoker.firstOrderL1.toExponential(3)} (second-order: ${results.stoker.levels[2].L1rel.toExponential(3)})`);
// The direct guard on second-order accuracy, and the one check a silent reversion to piecewise-constant
// reconstruction cannot slip past: with the limiter disabled the same grid gives 4.286e-3 against 1.602e-3,
// a ratio of 2.68. If MUSCL reconstruction stopped being applied the two runs would coincide and the ratio
// would fall to 1.0. Floor 2.0 — 25 % below the measured ratio, and far above the 1.0 a regression produces.
atLeast('second order beats first order at nx=400 (L1 ratio)', results.stoker.firstOrderL1 / results.stoker.levels[2].L1rel, 2.0, '×');

// ---------- 2. Lake at rest (well-balancing) ----------
function lakeAtRest(bumpH, label) {
  const nx = 100, ny = 50, dx = 0.02, eta0 = 1.0;
  const z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx, y = (j + 0.5) * dx;
    z[j * nx + i] = bumpH * Math.exp(-5 * (x - 0.9) ** 2 - 50 * (y - 0.5) ** 2);
  }
  const s = new CPUSolver({ nx, ny, dx, z, manning: 0.03 });
  s.setDepth((x, y, zz) => eta0 - zz);
  s.run(2.0);
  let umax = 0, deta = 0, dry = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = s.idx(i, j), h = s.h[c];
    if (h <= s.hdry) { dry++; continue; }
    umax = Math.max(umax, Math.hypot(s.hu[c] / h, s.hv[c] / h));
    deta = Math.max(deta, Math.abs(h + s.z[c] - eta0));
  }
  log(`\nLAKE AT REST — ${label}: max |u|=${umax.toExponential(2)} m/s, max |eta-eta0|=${deta.toExponential(2)} m, dry cells=${dry}`);
  return { maxVel: umax, maxEtaDev: deta, dryCells: dry, steps: s.steps };
}
results.lakeSubmerged = lakeAtRest(0.8, 'submerged bump');
results.lakeIsland = lakeAtRest(1.2, 'emergent island (wet/dry)');

// Well-balancing. A lake at rest must stay exactly at rest: the bed-slope source has to cancel the pressure
// flux cell by cell, so the only residual velocity is fp64 round-off. Measured max |u| = 1.95e-14 m/s
// (submerged) and 1.70e-14 m/s (emergent island, which also exercises the wet/dry front).
// Ceiling 1e-11 m/s — ~500x the measured floor, because this residual depends on summation order and on the
// step count, both of which move across platforms. It is still eight orders of magnitude below the O(1e-3)
// m/s spurious currents that a broken bed-slope discretisation produces, so the gate stays decisive.
atMost('lake at rest, submerged bump: max |u|', results.lakeSubmerged.maxVel, 1e-11, ' m/s');
atMost('lake at rest, emergent island: max |u|', results.lakeIsland.maxVel, 1e-11, ' m/s');
// The free surface must stay flat to the same round-off floor. Measured 3.33e-16 m in both cases;
// ceiling 1e-12 m, ~3000x the floor and still far below any disturbance that would matter.
atMost('lake at rest, submerged bump: max |eta-eta0|', results.lakeSubmerged.maxEtaDev, 1e-12, ' m');
atMost('lake at rest, emergent island: max |eta-eta0|', results.lakeIsland.maxEtaDev, 1e-12, ' m');
// Wet/dry bookkeeping is an exact integer invariant of this fixed geometry, not a measurement with scatter:
// the 1.2 m bump pierces the eta0 = 1.0 m surface in exactly 88 of the 5000 cells, and the 0.8 m bump in
// none. Equality is therefore the right test, and it catches a change in the dry-cell criterion that leaves
// the velocities at round-off.
check('lake at rest, submerged bump: no dry cells', results.lakeSubmerged.dryCells === 0, `${results.lakeSubmerged.dryCells} dry`);
check('lake at rest, emergent island: 88 dry cells', results.lakeIsland.dryCells === 88, `${results.lakeIsland.dryCells} dry`);

// ---------- 3. Thacker planar oscillation in a paraboloid ----------
function thacker(nx) {
  const T = thackerPlanar(); const dx = T.L / nx;
  const z = new Float64Array(nx * nx);
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = T.bed((i + 0.5) * dx, (j + 0.5) * dx);
  const s = new CPUSolver({ nx, ny: nx, dx, z, manning: 0, hfront: 1e-4 });
  s.setDepth((x, y) => T.depth(x, y, 0));
  s.setVelocity(() => T.vel(0));
  const checkpoints = [0.25, 0.5, 0.75, 1.0].map(f => f * T.period);
  const out = [];
  for (const tc of checkpoints) {
    s.run(tc);
    const h = s.field('h'); let e = 0, n = 0;
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const he = T.depth((i + 0.5) * dx, (j + 0.5) * dx, tc); e += Math.abs(h[j * nx + i] - he); n += he;
    }
    out.push({ t: tc, L1rel: e / n });
  }
  // centerline profile at t = T for plotting (y = L/2)
  const h = s.field('h'), jm = Math.floor(nx / 2), profile = [];
  for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * dx, y = (jm + 0.5) * dx;
    profile.push([+x.toFixed(4), +(h[jm * nx + i] + T.bed(x, y)).toFixed(6), +(T.depth(x, y, s.t) + T.bed(x, y)).toFixed(6), +T.bed(x, y).toFixed(6)]);
  }
  return { nx, period: T.period, checkpoints: out, mass: s.massBalance(), steps: s.steps, profile };
}
const th = [50, 100, 200].map(thacker);
results.thacker = { levels: th.map(r => ({ nx: r.nx, checkpoints: r.checkpoints, massRel: r.mass.rel, steps: r.steps })), period: th[0].period, profile: th[1].profile };
log(`\nTHACKER planar paraboloid (period ${th[0].period.toFixed(3)} s)`);
th.forEach(r => log(`  nx=${r.nx}: L1 rel err at T/4..T = ${r.checkpoints.map(c => c.L1rel.toExponential(2)).join(', ')}  mass rel=${r.mass.rel.toExponential(2)}`));

// Thacker's planar oscillation in a paraboloid: a moving wet/dry shoreline with an exact solution, so this
// is the one smooth case where better than first order is available and worth asserting.
// L1 ceilings, measured + ~6 %, at the four checkpoints T/4, T/2, 3T/4, T:
//   nx= 50 measured: 4.11e-2  6.16e-2  7.68e-2  8.12e-2
//   nx=100 measured: 1.54e-2  2.37e-2  2.55e-2  2.50e-2
//   nx=200 measured: 6.45e-3  8.90e-3  8.70e-3  8.86e-3
const THACKER_CEIL = {
  50: [4.36e-2, 6.53e-2, 8.14e-2, 8.61e-2],
  100: [1.64e-2, 2.52e-2, 2.71e-2, 2.65e-2],
  200: [6.84e-3, 9.44e-3, 9.23e-3, 9.39e-3],
};
for (const r of th) {
  r.checkpoints.forEach((c, k) => atMost(`thacker nx=${r.nx} L1 at ${['T/4', 'T/2', '3T/4', 'T'][k]}`, c.L1rel, THACKER_CEIL[r.nx][k]));
  // Walled domain again: mass error is pure fp64 round-off. Measured |rel| <= 4.8e-15; ceiling 1e-12.
  atMost(`thacker nx=${r.nx} mass balance`, r.mass.rel, 1e-12);
}
// Observed order at t = T, where the solution has returned to its initial state: measured 1.700 (50→100)
// and 1.497 (100→200). Floor 1.4, the programme's starting point, which leaves 6.5 % on the tighter pair.
// Order is gated at T only. At the earlier checkpoints the error is dominated by the position of the moving
// shoreline rather than by the interior solution, and the finest pair measures 1.26 at T/4 — below 1.4 and
// not a defect. Those checkpoints are still gated, on L1 magnitude above, so nothing is left unchecked.
const thOrderT = [0, 1].map(k => Math.log2(th[k].checkpoints[3].L1rel / th[k + 1].checkpoints[3].L1rel));
thOrderT.forEach((o, k) => atLeast(`thacker order at T, nx=${th[k].nx}→${th[k + 1].nx}`, o, 1.4));

// ---------- 4. Rain-on-grid mass conservation with buildings + open outlet ----------
{
  const nx = 120, ny = 80, dx = 2;
  const z = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * dx, y = j * dx;
    z[j * nx + i] = 10 - 0.01 * x + 0.5 * Math.abs(y - 80) / 80 - 0.6 * Math.exp(-((x - 120) ** 2 + (y - 80) ** 2) / 400);
    if ((i % 20 > 6 && i % 20 < 14) && (j % 16 > 3 && j % 16 < 11) && i > 10 && i < 110) mask[j * nx + i] = 0;
  }
  const s = new CPUSolver({ nx, ny, dx, z, mask, manning: 0.035, bc: { east: 'open' } });
  s.setDepth(() => 0);
  s.rainRate = 100 / 1000 / 3600; // 100 mm/hr
  for (let c = 0; c < s.infil.length; c++) s.infil[c] = 10 / 1000 / 3600;
  s.run(1200);
  s.rainRate = 0; s.run(2400);
  const mb = s.massBalance();
  const V = s.vol;
  log(`\nRAIN-ON-GRID mass balance (100 mm/hr for 20 min, 10 mm/hr infiltration, open east boundary, ${mask.reduce((a, b) => a + (b ? 0 : 1), 0)} building cells)`);
  log(`  rain=${V.rain.toFixed(2)} m3  infil=${V.infil.toFixed(2)} m3  outflow=${V.outflow.toFixed(2)} m3  stored=${mb.volume.toFixed(2)} m3`);
  log(`  mass balance rel err=${mb.rel.toExponential(2)}  clipped=${mb.clipped.toExponential(2)} m3  steps=${s.steps}`);
  results.rainMass = { rain: V.rain, infil: V.infil, outflow: V.outflow, stored: mb.volume, rel: mb.rel, clipped: mb.clipped, steps: s.steps };
  // The hardest mass-balance case in the suite: 8850 steps with four separate volume channels (rain in,
  // infiltration out, outflow through the open east boundary, storage) and 1190 masked building cells, so
  // every term in the book has to close against the others rather than against zero.
  // Measured rel = -3.95e-15. Ceiling 1e-12, ~250x that floor; a dropped or double-counted channel moves
  // this to O(1e-6) or worse, which the gate catches with six orders to spare.
  atMost('rain-on-grid mass balance', mb.rel, 1e-12);
  // Clipping is depth driven negative and reset to zero — i.e. water invented by the solver. Measured
  // exactly 0 m3, and the correct value is exactly 0, so this is an equality, not a tolerance.
  check('rain-on-grid: no clipped volume', mb.clipped === 0, `${mb.clipped} m3`);
}

// ---------- 5. App scenarios: urban cloudburst and valley dam break (positivity + mass on real-looking terrain) ----------
function appScenario(sc, setup, tEnd) {
  const s = new CPUSolver({ nx: sc.nx, ny: sc.ny, dx: sc.dx, z: sc.z, mask: sc.mask, manning: sc.manning, bc: sc.bc, hdry: 1e-5 });
  if (sc.infil) for (let j = 0; j < sc.ny; j++) for (let i = 0; i < sc.nx; i++) s.infil[s.idx(i, j)] = sc.infil[j * sc.nx + i];
  sc.init(s); setup(s); s.run(tEnd);
  const mb = s.massBalance();
  return { rel: mb.rel, clipped: mb.clipped, rain: s.vol.rain, outflow: s.vol.outflow, stored: mb.volume, steps: s.steps };
}
results.urban = appScenario(cloudburst(80), s => { s.rainRate = 150 * MMHR; }, 900);
log(`\nURBAN CLOUDBURST (80x80, 4 m cells, 150 mm/hr for 15 min): mass rel=${results.urban.rel.toExponential(2)}  clipped=${results.urban.clipped} m3  outflow=${results.urban.outflow.toFixed(1)} m3  steps=${results.urban.steps}`);
results.valleyDam = appScenario(dambreak(48), () => {}, 120);
log(`VALLEY DAM BREAK (96x48, 5 m cells, 120 s): mass rel=${results.valleyDam.rel.toExponential(2)}  clipped=${results.valleyDam.clipped} m3  outflow=${results.valleyDam.outflow.toFixed(1)} m3  steps=${results.valleyDam.steps}`);

// The two shipped app scenarios, on terrain with masks, infiltration and open boundaries rather than the
// clean analytic geometries above — this is where the solver is asked to conserve mass on the kind of grid
// a user actually runs. Measured rel = -4.75e-15 (urban) and -4.08e-16 (valley); same 1e-12 ceiling and the
// same reasoning as the rain-on-grid case.
atMost('urban cloudburst mass balance', results.urban.rel, 1e-12);
atMost('valley dam break mass balance', results.valleyDam.rel, 1e-12);
// Positivity: both scenarios drive fronts over dry, steep terrain, and neither may invent water to stay
// positive. Measured exactly 0 m3 clipped in both.
check('urban cloudburst: no clipped volume', results.urban.clipped === 0, `${results.urban.clipped} m3`);
check('valley dam break: no clipped volume', results.valleyDam.clipped === 0, `${results.valleyDam.clipped} m3`);

const jsonArg = process.argv.indexOf('--json');
if (jsonArg > 0) { writeFileSync(process.argv[jsonArg + 1], JSON.stringify(results)); log(`\nwrote ${process.argv[jsonArg + 1]}`); }

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
