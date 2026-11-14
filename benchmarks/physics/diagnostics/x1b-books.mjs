// Diagnostic (not scored, not a benchmark): where PV-X1-b's injected volume goes.
// Review 4 asked for the X1-b books to be decomposed term by term, and for the same case to be run without the fault.
// The planted inflow is 0.001 m³/s for 1 h (3.6 m³ declared in spec/PV-X1.json), but the at-rest books found +3.43 m³.
//
// Terms, each computed separately and never merged:
//   declared      the fault as written in the spec: leak × 3600 s
//   series        the integral of the [TIMESERIES] exactly as written (trapezoid between its points, as SWMM
//                 interpolates them), so a ramp in the series is counted
//   applied       Σ over routing steps of SWMM's own lateral inflow at T1 (NODE_LATFLOW) × dt: the inflow the engine applied,
//                 by the rectangle rule (end of step) and by the trapezoid (mean of the step's ends)
//   tanks         Σ A·d, from simulated depths (the books); pipe A_full·L (full throughout in this case)
//   swmm stored   SWMM's own node volumes (NODE_VOLUME), separately
//   boundary      flow over the sealing weir, integrated (must be 0)
//   residual      (tanks + pipe − V0) − applied
// Variants: the unfaulted case; the registered fault; the fault for 2 h (does the gap scale with duration?); the fault
// with no ramp point at its end (does the series shape matter?). The registered result (results/2026-11-11T18-57-58-574Z)
// is not touched; this writes diagnostics/out/x1b-books.json.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { options, swmm } from '../lib/swmm-run.mjs';
import { SWMM } from '../../../src/swmm.js';

const here = new URL('.', import.meta.url);
const C1 = JSON.parse(readFileSync(new URL('../spec/PV-C1.json', import.meta.url))), X1 = JSON.parse(readFileSync(new URL('../spec/PV-X1.json', import.meta.url)));
const P = Object.fromEntries(Object.entries(C1.parameters).map(([k, v]) => [k, v.value]));
const leak = X1.parameters.leakM3s.value;

// the same network as conservation/pv-c1.mjs inp() (C1-a), with the series given explicitly
function inp(series, P) {
  const t = P.tanks, L = [options({ durationS: P.durationS, step: P.routingStepS, surcharge: 'EXTRAN' }),
    '[STORAGE]', ...t.map(k => `${k.name} 0 ${P.tankDepth} ${k.h0} FUNCTIONAL 0 0 ${k.A} 0 0`), '',
    '[OUTFALLS]', 'OUT 0 FREE NO', '', '[CONDUITS]', `C1 ${t[0].name} ${t[1].name} ${P.pipeLength} ${P.manningN} 0 0 0 0`, '',
    '[WEIRS]', `W0 ${t[1].name} OUT TRANSVERSE ${P.sealCrest} 1.84 NO 0 0`, '',
    '[XSECTIONS]', `C1 CIRCULAR ${P.pipeDiameter} 0 0 0 1`, `W0 RECT_OPEN 0.3 1 0 0`, ''];
  if (series) L.push('[TIMESERIES]', ...series.map(([h, q]) => `LEAK ${h} ${q}`), '', '[INFLOWS]', `${t[0].name} FLOW LEAK FLOW 1.0 1.0`, '');
  return L.join('\n');
}
const seriesIntegral = (s) => s.slice(1).reduce((a, [h, q], i) => a + 0.5 * (q + s[i][1]) * (h - s[i][0]) * 3600, 0);

// SWMM's EXTRAN crown cutoff (dynwave.c EXTRAN_CROWN_CUTOFF; dwflow.c getWidth caps y at 0.96·yFull for a closed
// section): a full conduit still adds (w1 + wMid)·L/4 = w(0.96 D)·L/2 of surface area to each end node, where w(y) is
// the circle's top width 2√(y(D − y)). The hypothesis: each tank rises by dV/(A + that area), so storage keeps only
// A/(A + w·L/2) of a net inflow. Computed here from the geometry alone, not from SWMM.
const ghost = (G) => { const y = 0.96 * G.pipeDiameter; return 2 * Math.sqrt(y * (G.pipeDiameter - y)) * G.pipeLength / 2; };
const predictedRetained = (G) => G.tanks[0].A / (G.tanks[0].A + ghost(G));

const books = (label, series, declared, over = {}) => books1(label, series, declared, { ...P, ...over });
async function books1(label, series, declared, P) {
  const e = await swmm(); e.open(inp(series, P));
  const T = P.tanks, iT = T.map(k => e.index('NODE', k.name)), iW = e.index('LINK', 'W0');
  const tanks = () => T.reduce((a, k, j) => a + k.A * e.node('DEPTH', iT[j]), 0);
  const pipeFull = P.pipeLength * Math.PI * P.pipeDiameter ** 2 / 4;
  const V0 = T.reduce((a, k) => a + k.A * k.h0, 0) + pipeFull;
  let rect = 0, trap = 0, weir = 0, qPrev = 0, firstT = null, lastT = null, steps = 0, minEnd = Infinity;
  const onStep = (dt) => {
    const q = e.node('LATFLOW', iT[0]); rect += q * dt; trap += 0.5 * (q + qPrev) * dt; qPrev = q;
    weir += Math.abs(e.link('FLOW', iW)) * dt; steps++;
    if (q > 0) { firstT ??= e.t + dt; lastT = e.t + dt; }
    minEnd = Math.min(minEnd, ...iT.map(i => e.node('DEPTH', i)));
  };
  while (e.t < P.durationS - 1e-6) { const t0 = e.t; e.stepTo(Math.min(P.durationS, e.t + 60), onStep); if (e.t <= t0) break; }
  const tk = tanks(), swmmStored = iT.reduce((a, i) => a + e.node('VOLUME', i), 0) + pipeFull;
  const rpt = e.finish(), cont = SWMM.continuity(rpt);
  const gained = tk + pipeFull - V0;
  return { label, geometry: { pipeLength: P.pipeLength, pipeDiameter: P.pipeDiameter, tankA: P.tanks[0].A }, ghostAreaPerNode: ghost(P),
    predictedRetainedFraction: predictedRetained(P), observedRetainedFraction: trap > 0 ? gained / trap : null, series, declared, seriesIntegral: series ? seriesIntegral(series) : 0, appliedRect: rect, appliedTrap: trap,
    inflowFirstSeenS: firstT, inflowLastSeenS: lastT, routingSteps: steps, V0, tanksPlusPipeEnd: tk + pipeFull, gained,
    swmmStoredEnd: swmmStored, swmmStoredGained: swmmStored - V0, weirVolume: weir, pipeFullThroughout: minEnd >= P.pipeDiameter,
    residualVsApplied: gained - trap, residualVsDeclared: gained - declared, swmmContinuity: cont };
}

const dur = P.durationS / 3600, runs = [
  await books('unfaulted', null, 0),
  await books('registered fault (0–1 h, ramp to 0 by 1.0003 h)', [[0, leak], [1, leak], [1.0003, 0], [dur, 0]], leak * 3600),
  await books('fault for 2 h (same shape)', [[0, leak], [2, leak], [2.0003, 0], [dur, 0]], leak * 7200),
  await books('fault 0–1 h, no ramp point (1 h → 0 at the end)', [[0, leak], [1, leak], [dur, 0]], null),
  await books('fault constant all run', [[0, leak], [dur, leak]], leak * P.durationS),
  // the hypothesis test: change the pipe, keep the fault; the retained fraction must follow A/(A + w·L/2)
  await books('registered fault, pipe 100 m long', [[0, leak], [1, leak], [1.0003, 0], [dur, 0]], leak * 3600, { pipeLength: 100 }),
  await books('registered fault, pipe D 1.0 m', [[0, leak], [1, leak], [1.0003, 0], [dur, 0]], leak * 3600, { pipeDiameter: 1.0 }),
  await books('registered fault, tanks 1000 m²', [[0, leak], [1, leak], [1.0003, 0], [dur, 0]], leak * 3600, { tanks: P.tanks.map(t => ({ ...t, A: 1000 })) }),
];
mkdirSync(new URL('out/', here), { recursive: true });
writeFileSync(new URL('out/x1b-books.json', here), JSON.stringify({ written: new Date().toISOString(), runs }, null, 1));
const f = (v, d = 4) => v == null ? '—' : (+v).toFixed(d);
for (const r of runs) console.log(`${r.label}\n  declared ${f(r.declared)}  series ∫ ${f(r.seriesIntegral)}  applied rect ${f(r.appliedRect)} trap ${f(r.appliedTrap)}  inflow seen ${f(r.inflowFirstSeenS, 0)}–${f(r.inflowLastSeenS, 0)} s` +
  `\n  retained: observed ${f(r.observedRetainedFraction, 5)}  predicted ${f(r.predictedRetainedFraction, 5)} (ghost area ${f(r.ghostAreaPerNode, 3)} m² per node)` +
  `\n  books gained ${f(r.gained)}  SWMM stored gained ${f(r.swmmStoredGained)}  weir ${f(r.weirVolume, 6)}  pipe full ${r.pipeFullThroughout}  residual vs applied ${f(r.residualVsApplied, 6)}  vs declared ${f(r.residualVsDeclared)}  SWMM cont ${r.swmmContinuity.errorPct} %`);
