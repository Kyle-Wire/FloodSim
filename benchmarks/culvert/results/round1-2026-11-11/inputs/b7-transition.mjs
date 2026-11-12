// B7: control-regime transitions, SWMM alone. Does the headwater move continuously as the controlling regime changes
// (inlet control with a free outfall → inlet control with a submerged outlet → outlet control with a full barrel), or
// does SWMM make a step or oscillate where HDS-5's controlling headwater (the greater of inlet and outlet control) is
// smooth? Two sweeps per culvert, in both surcharge methods:
//   T  tailwater sweep at a fixed discharge: outlet depth 0 … D + 1.5 m
//   Q  discharge sweep at a fixed tailwater 0.3 m over the outlet crown
// Reported per point: SWMM − HDS-5, steadiness (headwater range over the last 5 min), and a step test between
// neighbouring points: SWMM's change against HDS-5's change.
//
//   node benchmarks/culvert/b7-transition.mjs            (exit code 1 on an unsteady point or a step)
import fs from 'node:fs';
import { runSteady, conduit, swmmEngine, IN } from './model.mjs';
import { inletControlHW, outletControlHW, fullArea, KU } from './hds5.mjs';

const swmm = await swmmEngine();
// mild: inlet control gives way to outlet control as the tailwater rises; steep: inlet control can hold with the outlet submerged
const SLOPES = [{ id: 'mild', S: 0.01, L: 40 }, { id: 'steep', S: 0.05, L: 30 }];
const CASES = [
  { id: 'pipe', asset: conduit('circle', 1.2, 1.2, 'concrete'), key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2 },
  { id: 'ellipse', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'concrete'), key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN },
];
const rows = [], fails = [];
for (const { id: slope, S, L } of SLOPES) for (const surcharge of ['SLOT', 'EXTRAN']) for (const c of CASES) {
  const A = fullArea(c.shape, c.rise, c.span), D = c.rise, zOut = 10 - S * L, Qof = (q) => q * A * Math.sqrt(D) / KU;
  const sweeps = [
    { id: 'T', pts: Array.from({ length: 28 }, (_, i) => ({ Q: Qof(slope === 'steep' ? 4 : 3), twDepth: i * (D + (slope === 'steep' ? 2.5 : 1.5)) / 27 })) },
    { id: 'Q', pts: Array.from({ length: 23 }, (_, i) => ({ Q: Qof(0.5 + i * 0.25), twDepth: D + (slope === 'steep' ? 0.2 : 0.3) })) },
  ];
  for (const sw of sweeps) {
    const seq = [];
    for (const p of sw.pts) {
      const tw = p.twDepth > 0.01 ? zOut + p.twDepth : null;
      const r = runSteady(swmm, { asset: c.asset, L, S, routing: { surcharge } }, p.Q, { tw, holdS: 1800 });
      const inlet = inletControlHW(c.key, c.shape, c.rise, c.span, p.Q, S).HW, outlet = outletControlHW(c.shape, c.rise, c.span, p.Q, r.x.n, L, S, p.twDepth, { Ke: r.x.loss?.entry ?? 0.5, Kx: 1 });
      const ref = Math.max(inlet, outlet);
      seq.push({ slope, surcharge, case: c.id, sweep: sw.id, qAD: +(KU * p.Q / (A * Math.sqrt(D))).toFixed(2), Q: +p.Q.toFixed(3), twDepth: +p.twDepth.toFixed(3), swmmHW: +r.d1.toFixed(4), hds5HW: +ref.toFixed(4),
        governs: inlet >= outlet ? 'inlet' : 'outlet', diff: +(r.d1 - ref).toFixed(4), drift: +r.drift.toFixed(4), steady: r.drift < 0.01,
        mass: { swmmContinuityErrPct: r.mass.swmmErrorPct, steadyFlowErrPct: +r.mass.steadyFlowErrPct.toFixed(3) } });
    }
    // a step: SWMM moves by more than 0.05 m beyond twice what HDS-5 does between neighbouring points
    for (let i = 1; i < seq.length; i++) {
      const dS = seq[i].swmmHW - seq[i - 1].swmmHW, dH = seq[i].hds5HW - seq[i - 1].hds5HW;
      seq[i].step = Math.abs(dS) > 2 * Math.abs(dH) + 0.05;
      if (seq[i].step) fails.push(`${slope} ${surcharge} ${c.id} sweep ${sw.id}: step between points ${i - 1} and ${i}: SWMM ${dS >= 0 ? '+' : ''}${dS.toFixed(3)} m vs HDS-5 ${dH >= 0 ? '+' : ''}${dH.toFixed(3)} m`);
    }
    for (const s of seq) if (!s.steady) fails.push(`${slope} ${surcharge} ${c.id} sweep ${sw.id} (Q/AD^0.5 ${s.qAD}, TW ${s.twDepth} m): headwater oscillates over ${s.drift} m`);
    rows.push(...seq);
  }
}
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b7-transition.json', import.meta.url), JSON.stringify({ benchmark: 'B7 control-regime transitions, SWMM alone', slopes: SLOPES, rows, fails }, null, 1));
console.log(`B7 control-regime transitions, SWMM ${swmm.version} alone. mild: S 0.01, L 40 m; steep: S 0.05, L 30 m. T: tailwater sweep at a fixed discharge; Q: discharge sweep, tailwater over the outlet crown\n`);
console.log('slope  surch.  case     sweep  Q/AD^.5  TW depth  SWMM HW  HDS-5 HW  governs  diff     range    step');
for (const r of rows) console.log(`${r.slope.padEnd(6)} ${r.surcharge.padEnd(7)} ${r.case.padEnd(8)} ${r.sweep.padEnd(5)}  ${String(r.qAD).padEnd(7)}  ${r.twDepth.toFixed(2).padStart(6)}    ${r.swmmHW.toFixed(3)}    ${r.hds5HW.toFixed(3)}     ${r.governs.padEnd(7)}  ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)}   ${r.drift.toFixed(3)}${r.steady ? '  ' : '* '}   ${r.step ? 'STEP' : ''}`);
console.log('\n* not steady: the headwater ranges over more than 0.01 m in the last 5 min');
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nno steps, no oscillation');
process.exit(fails.length ? 1 : 0);
