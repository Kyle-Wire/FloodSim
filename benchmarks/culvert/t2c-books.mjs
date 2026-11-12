// T2-C diagnostic (not scored; the T2 benchmark, its criteria and results/t2-ellipse.json are not changed).
// Review 4 asked where T2's part-full continuity error (−2.1 to −5.3 %, steady, no drift, both sections) comes from.
// Part 1, the books: the T2 part-full runs repeated as t2-ellipse.mjs runs them (inflow by setLatFlow, a 600 s ramp,
// a 3600 s hold, a NORMAL outfall), with SWMM's whole continuity table and, beside it, the books kept here step by step:
//   applied   Σ NODE_LATFLOW(HW) · dt (what the engine says it applied)
//   outflow   Σ NODE_INFLOW(TW) · dt (what reached the outfall)
//   stored    Σ NODE_VOLUME + L · A(link depth) at the end (the conduit by SWMM's own mid-depth area, the estimate)
// and variants that separate a fixed volume from a rate: hold 1800 / 3600 / 7200 s; the inflow set once with no ramp.
// Part 2, the geometry: area, wetted perimeter, hydraulic radius and conveyance K = A R^(2/3) / n per depth fraction, true
// ellipse against each written section, from the critic's preserved tables (references/t2-critic/out.json), so a
// geometric cause can be ruled in or out profile by profile. Writes results-diagnostics/t2c-books.json.
import fs from 'node:fs';
import { buildINP, conduit, swmmEngine, IN } from './model.mjs';
import { SWMM } from '../../src/swmm.js';

const swmm = await swmmEngine();
const L = 400, S = 0.004, n = 0.013, rise = 38 * IN, span = 60 * IN, z0 = 10;
const SECT = { standard: 'ASTM C507', exact: null };

function run(std, Q, { rampS = 600, holdS = 3600, segments = 1 } = {}) {
  const o = { asset: conduit('h-ellipse', rise, span, 'concrete', null, 1, std), L, S, z0, outfallType: 'NORMAL' };
  const { inp } = buildINP({ ...o, role: null, code: 0, losses: null, durationS: rampS + holdS + 60, initElev: null, segments });
  swmm.open(inp.replace('INPUT NO', 'INPUT YES'));
  const iU = swmm.index('NODE', 'HW'), iD = swmm.index('NODE', 'TW'), iL = swmm.index('LINK', 'C1');
  const nodes = swmm.count('NODE');
  let t = 0, applied = 0, outflow = 0, linkOut = 0;
  const step = (dt) => { applied += swmm.node('LATFLOW', iU) * dt; outflow += swmm.node('INFLOW', iD) * dt; linkOut += swmm.link('FLOW', iL) * dt; };
  while (t < rampS + holdS - 1e-6) {
    swmm.setLatFlow(iU, rampS > 0 ? Q * Math.min(1, (t + 5) / rampS) : Q);
    t = Math.min(t + 5, rampS + holdS); swmm.stepTo(t, step);
  }
  let nodeVol = 0; for (let i = 0; i < nodes; i++) nodeVol += swmm.node('VOLUME', i);
  const y = swmm.link('DEPTH', iL);
  // SWMM's own flow area (Q/V) × length, summed over the barrel's segments
  let linkVol = 0; for (let k = 1; k <= segments; k++) { const j = swmm.index('LINK', 'C' + k), v = swmm.link('VELOCITY', j); if (Math.abs(v) > 1e-9) linkVol += swmm.link('FLOW', j) / v * (L / segments); }
  const rpt = swmm.finish(), c = SWMM.continuity(rpt);
  const block = (rpt.split('Flow Routing Continuity')[1] ?? '').split('Highest')[0].split('\n').filter(l => /\.\.\./.test(l)).map(l => l.trim());
  const stored = nodeVol + linkVol, resid = applied - outflow - stored;
  return { section: std ? 'standard' : 'exact', Q, rampS, holdS, segments, appliedM3: applied, outfallInflowM3: outflow, linkOutflowM3: linkOut, storedEndM3: stored,
    linkDepth: y, ownBooksResidualM3: resid, ownBooksResidualPct: 100 * resid / applied, swmmErrorPct: c.errorPct,
    swmmTable: block, swmmExternalInflowM3: c.externalInflow * 1000, swmmExternalOutflowM3: c.externalOutflow * 1000, swmmFinalStoredM3: c.finalStored * 1000 };
}

const runs = [];
// a: fixed volume or rate (hold length, ramp); b: the barrel cut into 1, 4, 16, 32 segments (registered T2 uses 1)
const plan = [];
for (const [name, std] of Object.entries(SECT)) for (const Q of [0.1, 0.5, 1.5]) {
  for (const [rampS, holdS] of [[600, 3600], [600, 1800], [600, 7200], [0, 3600]]) plan.push([name, std, Q, { rampS, holdS }]);
  for (const segments of [4, 16, 32]) plan.push([name, std, Q, { segments }]);
}
for (const [name, std, Q, opt] of plan) {
  const r = run(std, Q, opt); runs.push(r);
  console.log(`${name.padEnd(8)} Q ${String(Q).padEnd(4)} seg ${String(r.segments).padEnd(3)} ramp ${String(r.rampS).padEnd(4)} hold ${String(r.holdS).padEnd(5)} applied ${r.appliedM3.toFixed(2)} out ${r.outfallInflowM3.toFixed(2)} stored ${r.storedEndM3.toFixed(2)}  own residual ${r.ownBooksResidualM3.toFixed(3)} m³ (${r.ownBooksResidualPct.toFixed(2)} %)  SWMM ${r.swmmErrorPct} %  SWMM ext in ${r.swmmExternalInflowM3.toFixed(0)} out ${r.swmmExternalOutflowM3.toFixed(0)} final ${r.swmmFinalStoredM3.toFixed(0)}`);
}

// Part 2: geometry per depth fraction from the critic's tables (no SWMM)
const critic = JSON.parse(fs.readFileSync(new URL('./references/t2-critic/out.json', import.meta.url)));
// depthTable rows: { f: y/D, true|std|cus: [A m², R m, P m, W m] }; conveyance K = A R^(2/3) / n
const pct = (a, b) => +(100 * (a / b - 1)).toFixed(2), K = ([A, R]) => A * R ** (2 / 3) / n;
const profile = critic.depthTable.map(r => ({ yD: r.f,
  true: { A: r.true[0], P: r.true[2], R: r.true[1], K: K(r.true) },
  dPct: Object.fromEntries(['std', 'cus'].map(k => [k === 'std' ? 'standard' : 'exact', { A: pct(r[k][0], r.true[0]), P: pct(r[k][2], r.true[2]), R: pct(r[k][1], r.true[1]), K: pct(K(r[k]), K(r.true)) }])) }));
const geometry = { source: 'references/t2-critic/out.json depthTable (unchanged); K computed here', n, profile };
fs.mkdirSync(new URL('./results-diagnostics/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results-diagnostics/t2c-books.json', import.meta.url), JSON.stringify({ written: new Date().toISOString(), runs, geometry }, null, 1));
console.log('\ny/D   | standard dA dP dR dK %          | exact dA dP dR dK %');
for (const p of profile) { const s = p.dPct.standard, e = p.dPct.exact; console.log(`${p.yD.toFixed(2)}  | ${[s.A, s.P, s.R, s.K].map(v => String(v).padStart(7)).join('')} | ${[e.A, e.P, e.R, e.K].map(v => String(v).padStart(7)).join('')}`); }
