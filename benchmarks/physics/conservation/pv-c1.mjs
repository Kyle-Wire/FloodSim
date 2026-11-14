// PV-C1 closed-system mass conservation (spec/PV-C1.json). No water enters or leaves; the books must close.
//   C1-a  two prismatic tanks joined by a pipe that stays FULL (both levels above its crown): every volume is exact
//   C1-b  the same tanks at levels that leave the pipe PART FULL: the pipe's volume in motion is an ESTIMATE; the
//         estimate's bracket is reported, and the books are scored only where they are exact (at rest)
//   C1-c  C1-a with a gate (an orifice, closed, opened by a control rule at 1 h): a transient exchange
//   C1-d  the CPU surface solver (src/solver-cpu.js): a closed basin with an initial mound, walls on every side
// Volumes are computed HERE from simulated depths and the geometry (references/volume.mjs). SWMM's own node volumes
// and its continuity report are kept beside them as separate quantities, never merged into the closure.
import { options, simulate } from '../lib/swmm-run.mjs';
import { row } from '../lib/score.mjs';
import * as V from '../references/volume.mjs';
import { area } from '../references/geometry.mjs';

const B = 'PV-C1';

function inp(p, { gate = false, leak = 0 } = {}) {
  const L = [options({ durationS: p.durationS, step: p.step, surcharge: 'EXTRAN' }),
    '[STORAGE]', ...p.tanks.map(t => `${t.name} 0 ${p.tankDepth} ${t.h0} FUNCTIONAL 0 0 ${t.A} 0 0`), '',
    // SWMM refuses a network with no outfall (ERROR 145). The outfall is reached only over a weir whose crest is above
    // any level the tanks can reach, so it never flows; the weir's flow is recorded and must be zero (a row below)
    '[OUTFALLS]', 'OUT 0 FREE NO', '',
    '[CONDUITS]', `C1 ${p.tanks[0].name} ${p.tanks[1].name} ${p.L} ${p.n} 0 0 0 0`, '',
    '[WEIRS]', `W0 ${p.tanks[1].name} OUT TRANSVERSE ${p.sealCrest} 1.84 NO 0 0`, '',
    ...(gate ? ['[ORIFICES]', `G1 ${p.tanks[0].name} ${p.tanks[1].name} SIDE 0 ${p.gate.Cd} NO 0`, ''] : []),
    '[XSECTIONS]', `C1 CIRCULAR ${p.D} 0 0 0 1`, `W0 RECT_OPEN 0.3 1 0 0`, ...(gate ? [`G1 RECT_CLOSED ${p.gate.h} ${p.gate.w} 0 0`] : []), ''];
  // an orifice is open (setting 1) by default: the rule holds it shut until openH hours, then opens it
  if (gate) L.push('[CONTROLS]', 'RULE R1', `IF SIMULATION TIME < ${p.gate.openH}`, 'THEN ORIFICE G1 SETTING = 0', 'ELSE ORIFICE G1 SETTING = 1', '');
  // PV-X1 only: an undeclared inflow for the first hour (then the system can come to rest, so the at-rest books are exact)
  if (leak) L.push('[TIMESERIES]', `LEAK 0 ${leak}`, `LEAK 1 ${leak}`, `LEAK 1.0003 0`, `LEAK ${p.durationS / 3600} 0`, '', '[INFLOWS]', `${p.tanks[0].name} FLOW LEAK FLOW 1.0 1.0`, '');
  return L.join('\n');
}

/** A SWMM tank-pipe case. Returns its rows. `leak` (m³/s) is the deliberate fault of PV-X1, unknown to the books. */
export async function swmmCase(spec, caseId, p, { gate = false, leak = 0, expected = null } = {}) {
  const C = spec.criteria, s = { shape: 'circle', D: p.D }, rows = [], tr = [];
  const V0tanks = p.tanks.reduce((a, t) => a + V.tankVolume(t.A, t.h0), 0);
  // SWMM's stated initial condition (flowrout.c initLinkDepths): the conduit at the mean of its end depths, capped full
  const y0 = Math.min(p.D, 0.5 * (p.tanks[0].h0 + p.tanks[1].h0)), V0 = V0tanks + p.L * area(s, y0);
  const r = await simulate(inp(p, { gate, leak }), p.durationS, { every: p.sampleS, sample: (t, e) => {
    const d = p.tanks.map(tk => e.node('DEPTH', e.index('NODE', tk.name))), sv = p.tanks.map(tk => e.node('VOLUME', e.index('NODE', tk.name)));
    tr.push({ t, d, swmmVol: sv, y: e.link('DEPTH', e.index('LINK', 'C1')), q: e.link('FLOW', e.index('LINK', 'C1')), seal: e.link('FLOW', e.index('LINK', 'W0')) });
  } });
  const tanksAt = (x) => p.tanks.reduce((a, tk, i) => a + V.tankVolume(tk.A, x.d[i]), 0);
  // the pipe: full end to end when both end depths are at or above its crown (exact); otherwise an estimate
  const full = (x) => x.d.every(d => d >= p.D - 1e-9);
  const exact = tr.every(full);
  if (exact) {
    const worst = tr.reduce((w, x) => { const v = tanksAt(x) + V.conduitFullVolume(s, p.L); return Math.abs(v - V0) > Math.abs(w - V0) ? v : w; }, V0);
    rows.push(row({ benchmark: B, caseId, quantity: 'volume closure, worst sample (exact: pipe full throughout)', errorType: 'accounting', ref: V0, sim: worst, crit: { rel: C.closureRel }, unit: 'm³', expected }));
  } else {
    // the estimate and its bracket at every sample; scored only if the bracket itself is inside the criterion
    let worstWidth = 0, worstEst = V0;
    for (const x of tr) {
      const b = V.conduitVolumeBounds(s, p.L, x.d[0], x.d[1]), est = tanksAt(x) + V.conduitVolumeEstimate(s, p.L, Math.min(p.D, x.y));
      worstWidth = Math.max(worstWidth, (b.hi - b.lo) / V0); if (Math.abs(est - V0) > Math.abs(worstEst - V0)) worstEst = est;
    }
    const usable = worstWidth <= C.closureRel;
    rows.push(row({ benchmark: B, caseId, quantity: 'volume closure in motion, worst sample (ESTIMATE: pipe part full, L·A(link depth))', errorType: 'accounting', ref: V0, sim: worstEst,
      crit: { rel: C.closureRel }, unit: 'm³', status: usable ? null : 'Insufficient reference data', expected,
      note: usable ? 'the bracket from the end depths is inside the criterion' : `the pipe volume is known only to within ${(worstWidth * 100).toFixed(2)} % of the system volume (the end-depth bracket) against a ${(C.closureRel * 100).toFixed(2)} % criterion: the estimate cannot score a pass or a fail; reported only`,
      extra: { bracketWidthRel: +worstWidth.toFixed(6) } }));
  }
  // at rest: one level everywhere, so the pipe volume is exact again; and the equilibrium level is known from V0 alone
  const last = tr.at(-1), hourAgo = tr.find(x => x.t >= last.t - C.restWindowS) ?? tr[0];
  const settled = Math.abs(last.d[0] - last.d[1]) <= C.restLevelDiffM && Math.abs(last.d[0] - hourAgo.d[0]) <= C.restLevelDiffM;
  const hEq = V.equilibriumDepth(p.tanks, s, p.L, V0), hEnd = 0.5 * (last.d[0] + last.d[1]);
  const Vend = tanksAt(last) + p.L * area(s, Math.min(p.D, hEnd));
  rows.push(row({ benchmark: B, caseId, quantity: 'volume closure at rest (exact: one level everywhere)', errorType: 'accounting', ref: V0, sim: Vend, crit: { rel: C.closureRel }, unit: 'm³',
    status: settled ? null : 'Insufficient reference data', note: settled ? null : 'not at rest by the end of the run: the at-rest books are not exact', expected }));
  rows.push(row({ benchmark: B, caseId, quantity: 'equilibrium level (from the initial volume alone)', errorType: 'numerical', ref: hEq, sim: hEnd, crit: { abs: C.equilibriumAbsM }, unit: 'm',
    status: settled ? null : 'Insufficient reference data', expected }));
  // the system is closed only if the sealing weir never flowed
  rows.push(row({ benchmark: B, caseId, quantity: 'boundary flux: flow over the sealing weir (largest sample)', errorType: 'accounting', ref: 0, sim: Math.max(...tr.map(x => Math.abs(x.seal))), crit: { abs: 0 }, unit: 'm³/s',
    note: 'SWMM needs an outfall; it is behind a weir crest above every reachable level' }));
  // SWMM's own books, separately: its node volumes against A·d, and its continuity report
  const nodeVolErr = Math.max(...tr.map(x => Math.max(...x.swmmVol.map((v, i) => Math.abs(v - p.tanks[i].A * x.d[i]) / Math.max(1e-9, p.tanks[i].A * x.d[i])))));
  rows.push(row({ benchmark: B, caseId, quantity: "SWMM's node volume against A·d (its own storage curve)", errorType: 'accounting', ref: 0, sim: nodeVolErr, crit: { abs: C.nodeVolumeRel }, expected: null,
    note: 'internal consistency of SWMM storage, not a closure' }));
  rows.push(row({ benchmark: B, caseId, quantity: "SWMM's reported flow-routing continuity error", errorType: 'accounting', ref: 0, sim: r.continuity.errorPct, crit: { abs: C.swmmContinuityPct }, unit: '%',
    note: "SWMM's own accounting, reported apart from the closure above" }));
  return { rows, trace: tr.filter((_, i) => i % 10 === 0), swmmVersion: r.version, V0, hEq, settled };
}

/** C1-d: the CPU surface solver in a closed basin. */
async function cpuCase(spec, caseId, p) {
  const { CPUSolver } = await import('../../../src/solver-cpu.js');
  const N = p.nx * p.ny, z = new Float64Array(N);
  for (let j = 0; j < p.ny; j++) for (let i = 0; i < p.nx; i++) { const x = (i + 0.5) * p.dx - p.cx, y = (j + 0.5) * p.dx - p.cy; z[j * p.nx + i] = p.bowl * (x * x + y * y); }
  const h0 = (x, y) => p.mound.h * Math.exp(-((x - p.mound.x) ** 2 + (y - p.mound.y) ** 2) / (p.mound.r ** 2));
  const sol = new CPUSolver({ nx: p.nx, ny: p.ny, dx: p.dx, z, manning: p.n, bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' } });
  sol.setDepth(h0);
  // the reference: the initial condition's volume, computed here from the same function at the cell centres
  let V0 = 0; for (let j = 0; j < p.ny; j++) for (let i = 0; i < p.nx; i++) V0 += h0((i + 0.5) * p.dx, (j + 0.5) * p.dx) * p.dx * p.dx;
  const Vcont = Math.PI * p.mound.r ** 2 * p.mound.h; // the continuous mound's volume: the IC sampling difference, reported only
  let worst = V0, steps = 0;
  const vol = () => { const h = sol.field('h'); let s = 0; for (let k = 0; k < N; k++) s += h[k]; return s * p.dx * p.dx; };
  while (sol.t < p.durationS - 1e-9) { sol.step(p.durationS - sol.t); steps++; if (steps % p.sampleEvery === 0) { const v = vol(); if (Math.abs(v - V0) > Math.abs(worst - V0)) worst = v; } }
  const vEnd = vol(); if (Math.abs(vEnd - V0) > Math.abs(worst - V0)) worst = vEnd;
  const C = spec.criteria;
  return { rows: [
    row({ benchmark: B, caseId, quantity: 'volume closure, worst sample (CPU surface solver, fp64)', errorType: 'accounting', ref: V0, sim: worst, crit: { rel: C.cpuClosureRel }, unit: 'm³' }),
    row({ benchmark: B, caseId, quantity: 'initial-condition sampling: cell-centre volume against the continuous mound', errorType: 'numerical', ref: Vcont, sim: V0, unit: 'm³', status: 'Qualified',
      note: 'reported, not scored: the mound is cut by the domain only where it is negligible; this is the discretisation of the initial condition, not conservation' }),
  ], steps, V0, solverMassBalance: sol.massBalance() };
}

export async function run(spec) {
  const P = spec.parameters, out = { rows: [], cases: {} };
  const base = { sealCrest: P.sealCrest.value, tanks: P.tanks.value, L: P.pipeLength.value, D: P.pipeDiameter.value, n: P.manningN.value, tankDepth: P.tankDepth.value, durationS: P.durationS.value, step: P.routingStepS.value, sampleS: P.sampleS.value };
  const a = await swmmCase(spec, 'C1-a full pipe', base);
  const b = await swmmCase(spec, 'C1-b part-full pipe', { ...base, tanks: P.tanksPartFull.value });
  const c = await swmmCase(spec, 'C1-c gate opening at 1 h', { ...base, gate: P.gate.value }, { gate: true });
  const d = await cpuCase(spec, 'C1-d CPU closed basin', P.cpuBasin.value);
  for (const [k, v] of Object.entries({ a, b, c, d })) { out.rows.push(...v.rows); out.cases[k] = { ...v, rows: undefined }; }
  return out;
}
