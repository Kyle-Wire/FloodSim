// B7: control-regime transitions, SWMM alone. Does the headwater move continuously as the controlling regime changes
// (inlet control with a free outfall → inlet control with a submerged outlet → outlet control with a full barrel), or
// does SWMM make a step or oscillate where HDS-5's controlling headwater (the greater of inlet and outlet control) is
// smooth? Two sweeps per culvert, in both surcharge methods:
//   T  tailwater sweep at a fixed discharge: outlet depth 0 … D + 1.5 m (mild) or D + 2.5 m (steep)
//   Q  discharge sweep at a fixed tailwater over the outlet crown
//
// Scored per point (round 2; round 1 scored only steps and oscillation, so a large steady error could pass):
//   error      |SWMM − HDS-5| ≤ max(0.05 m, 5 %) of HDS-5's controlling headwater (the transition band of B1)
//   excursion  the largest |headwater − HDS-5| over the last 5 min, on the same band (catches an oscillation's peaks)
//   tailwater  SWMM's outlet head is not below the held tailwater, and equals it within 5 mm when the tailwater is above
//              the barrel's critical depth (below it the outlet falls free at critical depth, in SWMM and in HDS-5)
//   steady     headwater range over the last 5 min ≤ 0.01 m
//   mass       SWMM's continuity error and the steady outflow error each within 0.5 %
//   energy     with both conduit ends at or above the crown (SWMM's own full-barrel condition), the head SWMM
//              dissipates pool to pool, h1 − h2, is at least the full-barrel loss (Ke + Kx + Kf)·V²/2g less
//              max(0.03 m, 3 %): a full barrel cannot pass Q on less energy than its losses
//   step       SWMM moves by more than 0.05 m beyond twice what HDS-5 does between neighbouring points
// Per T sweep, also: the tailwater at which HDS-5 hands control from inlet to outlet, against the tailwater at which
// SWMM first leaves inlet control (by more than the error band) and the one at which both conduit ends first reach the
// crown. Scored: SWMM must not leave inlet control more than one sweep increment before HDS-5 does.
// Every run's full time series (every 5 s) goes to results/b7-transition-traces.json.
//
//   node benchmarks/culvert/b7-transition.mjs            (exit code 1 on any scored failure)
import fs from 'node:fs';
import { runSteady, conduit, swmmEngine, IN } from './model.mjs';
import { inletControlHW, outletControlHW, outletControlFull, fullArea, criticalDepth, KU } from './hds5.mjs';

const swmm = await swmmEngine();
// mild: inlet control gives way to outlet control as the tailwater rises; steep: inlet control can hold with the outlet submerged
const SLOPES = [{ id: 'mild', S: 0.01, L: 40 }, { id: 'steep', S: 0.05, L: 30 }];
const CASES = [
  { id: 'pipe', asset: conduit('circle', 1.2, 1.2, 'concrete'), key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2 },
  { id: 'ellipse', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'concrete'), key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN },
];
const band = (ref) => Math.max(0.05, 0.05 * ref);
const rows = [], fails = [], traces = [], thresholds = [];
for (const { id: slope, S, L } of SLOPES) for (const surcharge of ['SLOT', 'EXTRAN']) for (const c of CASES) {
  const A = fullArea(c.shape, c.rise, c.span), D = c.rise, zOut = 10 - S * L, Qof = (q) => q * A * Math.sqrt(D) / KU;
  const twTop = D + (slope === 'steep' ? 2.5 : 1.5);
  const sweeps = [
    { id: 'T', pts: Array.from({ length: 28 }, (_, i) => ({ Q: Qof(slope === 'steep' ? 4 : 3), twDepth: i * twTop / 27 })) },
    { id: 'Q', pts: Array.from({ length: 23 }, (_, i) => ({ Q: Qof(0.5 + i * 0.25), twDepth: D + (slope === 'steep' ? 0.2 : 0.3) })) },
  ];
  for (const sw of sweeps) {
    const seq = [];
    for (const p of sw.pts) {
      const tw = p.twDepth > 0.01 ? zOut + p.twDepth : null;
      const r = runSteady(swmm, { asset: c.asset, L, S, routing: { surcharge } }, p.Q, { tw, holdS: 1800, trace: true });
      const K = { Ke: r.x.loss?.entry ?? 0.5, Kx: 1 };
      const inlet = inletControlHW(c.key, c.shape, c.rise, c.span, p.Q, S).HW, outlet = outletControlHW(c.shape, c.rise, c.span, p.Q, r.x.n, L, S, p.twDepth, K);
      const ref = Math.max(inlet, outlet), tol = band(ref), diff = r.d1 - ref;
      const excursion = Math.max(Math.abs(r.d1Max - ref), Math.abs(r.d1Min - ref));
      const twErr = tw != null ? r.h2 - tw : null, yc = criticalDepth(c.shape, c.rise, c.span, p.Q);
      const Hfull = outletControlFull(c.shape, c.rise, c.span, p.Q, r.x.n, L, K).H, dissipated = r.h1 - r.h2;
      const barrelFull = r.d1 >= D && r.d2 >= D, energyResidual = dissipated - Hfull;
      const energyOk = !barrelFull || energyResidual >= -Math.max(0.03, 0.03 * Hfull);
      const massOk = Math.abs(r.mass.swmmErrorPct) <= 0.5 && Math.abs(r.mass.steadyFlowErrPct) <= 0.5;
      const steady = r.drift <= 0.01;
      const row = { slope, surcharge, case: c.id, sweep: sw.id, qAD: +(KU * p.Q / (A * Math.sqrt(D))).toFixed(2), Q: +p.Q.toFixed(3), twDepth: +p.twDepth.toFixed(3),
        swmmHW: +r.d1.toFixed(4), hds5HW: +ref.toFixed(4), hds5Inlet: +inlet.toFixed(4), hds5Outlet: +outlet.toFixed(4), governs: inlet >= outlet ? 'inlet' : 'outlet',
        diff: +diff.toFixed(4), tol: +tol.toFixed(3), errorOk: Math.abs(diff) <= tol,
        excursion: +excursion.toFixed(4), excursionOk: excursion <= tol,
        twErr: twErr == null ? null : +twErr.toFixed(4), twOk: twErr == null || (twErr >= -0.005 && (twErr <= 0.005 || p.twDepth < yc)),
        drift: +r.drift.toFixed(4), steady,
        energy: { dissipated: +dissipated.toFixed(4), fullBarrelLoss: +Hfull.toFixed(4), residual: +energyResidual.toFixed(4), barrelFull, ok: energyOk },
        mass: { swmmContinuityErrPct: r.mass.swmmErrorPct, steadyFlowErrPct: +r.mass.steadyFlowErrPct.toFixed(3), ok: massOk } };
      seq.push(row);
      traces.push({ slope, surcharge, case: c.id, sweep: sw.id, Q: row.Q, twDepth: row.twDepth, cols: r.trace.cols, rows: r.trace.rows.map(a => a.map(v => +v.toFixed(4))) });
    }
    for (let i = 1; i < seq.length; i++) {
      const dS = seq[i].swmmHW - seq[i - 1].swmmHW, dH = seq[i].hds5HW - seq[i - 1].hds5HW;
      seq[i].step = Math.abs(dS) > 2 * Math.abs(dH) + 0.05;
      if (seq[i].step) fails.push(`${slope} ${surcharge} ${c.id} ${sw.id}: step between points ${i - 1} and ${i}: SWMM ${dS >= 0 ? '+' : ''}${dS.toFixed(3)} m vs HDS-5 ${dH >= 0 ? '+' : ''}${dH.toFixed(3)} m`);
    }
    const tag = (s) => `${slope} ${surcharge} ${c.id} ${sw.id} (Q/AD^0.5 ${s.qAD}, TW ${s.twDepth} m)`;
    for (const s of seq) {
      if (!s.errorOk) fails.push(`${tag(s)}: headwater ${s.swmmHW} m vs HDS-5 ${s.hds5HW} m (${s.governs} control), off by ${s.diff} m`);
      if (!s.excursionOk && s.errorOk) fails.push(`${tag(s)}: mean within the band but the headwater swings ${s.excursion} m from HDS-5`);
      if (!s.twOk) fails.push(`${tag(s)}: outlet head ${s.twErr} m off the held tailwater`);
      if (!s.steady) fails.push(`${tag(s)}: headwater oscillates over ${s.drift} m`);
      if (!s.energy.ok) fails.push(`${tag(s)}: full barrel dissipates ${s.energy.dissipated} m, less than its losses ${s.energy.fullBarrelLoss} m`);
      if (!s.mass.ok) fails.push(`${tag(s)}: mass ${JSON.stringify(s.mass)}`);
    }
    if (sw.id === 'T') {
      const inc = twTop / 27, hand = seq.find(s => s.governs === 'outlet')?.twDepth ?? null;
      const leaves = seq.find(s => s.swmmHW < s.hds5Inlet - band(s.hds5Inlet))?.twDepth ?? null, full = seq.find(s => s.energy.barrelFull)?.twDepth ?? null;
      const early = leaves != null && (hand == null || leaves < hand - inc - 1e-9);
      thresholds.push({ slope, surcharge, case: c.id, sweepIncrement: +inc.toFixed(3), hds5HandOverTW: hand, swmmLeavesInletTW: leaves, swmmBarrelFullTW: full, early });
      if (early) fails.push(`${slope} ${surcharge} ${c.id} T: SWMM leaves inlet control at TW ${leaves} m; HDS-5 hands over at ${hand ?? 'no point in the sweep'}`);
    }
    rows.push(...seq);
  }
}
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b7-transition.json', import.meta.url), JSON.stringify({ benchmark: 'B7 control-regime transitions, SWMM alone (round 2 scoring)', slopes: SLOPES, thresholds, rows, fails }, null, 1));
fs.writeFileSync(new URL('./results/b7-transition-traces.json', import.meta.url), JSON.stringify(traces));
console.log(`B7 control-regime transitions, SWMM ${swmm.version} alone. mild: S 0.01, L 40 m; steep: S 0.05, L 30 m. T: tailwater sweep at a fixed discharge; Q: discharge sweep, tailwater over the outlet crown\n`);
console.log('slope  surch.  case     sweep  Q/AD^.5  TW depth  SWMM HW  HDS-5 HW  governs  diff    excurs.  range   energy res.  checks');
for (const r of rows) {
  const bad = [!r.errorOk && 'ERR', !r.excursionOk && 'EXC', !r.twOk && 'TW', !r.steady && 'OSC', !r.energy.ok && 'ENERGY', !r.mass.ok && 'MASS', r.step && 'STEP'].filter(Boolean);
  console.log(`${r.slope.padEnd(6)} ${r.surcharge.padEnd(7)} ${r.case.padEnd(8)} ${r.sweep.padEnd(5)}  ${String(r.qAD).padEnd(7)}  ${r.twDepth.toFixed(2).padStart(6)}    ${r.swmmHW.toFixed(3)}    ${r.hds5HW.toFixed(3)}     ${r.governs.padEnd(7)}  ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)}  ${r.excursion.toFixed(3)}    ${r.drift.toFixed(3)}   ${r.energy.barrelFull ? ((r.energy.residual >= 0 ? '+' : '') + r.energy.residual.toFixed(3)).padStart(7) : '   -   '}      ${bad.join(' ') || 'ok'}`);
}
console.log('\nregime thresholds (T sweeps): tailwater depth at which');
console.log('slope  surch.  case      HDS-5 hands to outlet  SWMM leaves inlet  SWMM both ends full  (sweep increment)');
for (const t of thresholds) console.log(`${t.slope.padEnd(6)} ${t.surcharge.padEnd(7)} ${t.case.padEnd(8)}  ${String(t.hds5HandOverTW ?? '-').padStart(10)}            ${String(t.swmmLeavesInletTW ?? '-').padStart(8)}         ${String(t.swmmBarrelFullTW ?? '-').padStart(8)}          ${t.sweepIncrement}${t.early ? '   EARLY' : ''}`);
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall scored checks passed');
process.exit(fails.length ? 1 : 0);
