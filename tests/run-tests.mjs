// Verification suite for the CPU reference solver.
// Usage: node tests/run-tests.mjs [--json out.json]
import { CPUSolver } from '../src/solver-cpu.js';
import { damBreak, thackerPlanar } from '../src/analytic.js';
import { cloudburst, dambreak, MMHR } from '../src/scenarios.js';
import { writeFileSync } from 'node:fs';

const g = 9.81;
const results = {};
const log = (...a) => console.log(...a);

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
}
// first-order comparison at nx=400
results.stoker.firstOrderL1 = damBreakRun(0.5, 400, false).L1rel;
log(`  first-order at nx=400: L1 rel err=${results.stoker.firstOrderL1.toExponential(3)} (second-order: ${results.stoker.levels[2].L1rel.toExponential(3)})`);

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

const jsonArg = process.argv.indexOf('--json');
if (jsonArg > 0) { writeFileSync(process.argv[jsonArg + 1], JSON.stringify(results)); log(`\nwrote ${process.argv[jsonArg + 1]}`); }
