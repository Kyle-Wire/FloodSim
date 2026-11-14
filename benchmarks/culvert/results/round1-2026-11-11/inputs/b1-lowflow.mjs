// B1-LF: the open B1 finding, unsubmerged inlet control at low discharge (SWMM ±0.07 m from HDS-5). SWMM alone. Before
// any workaround, four questions:
//   1. timestep: does it persist at smaller fixed routing steps?
//   2. downstream boundary: does it change with the outfall (FREE, NORMAL, a fixed stage below the outlet crown)?
//   3. head consistency: is SWMM's pool a hydraulic head (≥ the critical energy the discharge needs) or a depth?
//   4. SWMM's own options that bear on the upstream-end treatment: inertial damping, normal-flow limiting, length.
// The reference stays HDS-5 (hds5.mjs). Nothing is tuned: roughness, coefficients and the reference are untouched.
//
//   node benchmarks/culvert/b1-lowflow.mjs
import fs from 'node:fs';
import { runSteady, conduit, swmmEngine } from './model.mjs';
import { inletControlHW, criticalDepth, criticalEnergy, fullArea, KU } from './hds5.mjs';
import { swmmInletQ } from './swmm-replica.mjs';

const swmm = await swmmEngine();
const CASES = [
  { id: 'pipe', asset: conduit('circle', 1.2, 1.2, 'concrete'), key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2, code: 1, qs: [0.5, 1, 1.5] },
  { id: 'box', asset: conduit('box', 1.5, 2.4, 'concrete'), key: 'box/concrete/headwall', shape: 'box', rise: 1.5, span: 2.4, code: 10, qs: [1, 1.5, 2] },
];
const S = 0.02, L = 20;
const VARIANTS = [
  { id: 'baseline (production routing)', o: {} },
  { id: 'fixed step 1 s', o: { routing: { variableStep: 0 } } },
  { id: 'fixed step 0.25 s', o: { routing: { variableStep: 0, routingStep: 0.25 } } },
  { id: 'fixed step 0.05 s', o: { routing: { variableStep: 0, routingStep: 0.05 } }, holdS: 900 },
  { id: 'outfall NORMAL', o: { outfallType: 'NORMAL' } },
  { id: 'outfall fixed at 0.5 D', twFrac: 0.5 },
  { id: 'outfall fixed at 0.9 D', twFrac: 0.9 },
  { id: 'inertial damping FULL', o: { routing: { inertialDamping: 'FULL' } } },
  { id: 'inertial damping NONE', o: { routing: { inertialDamping: 'NONE' } } },
  { id: 'normal flow limited SLOPE', o: { routing: { normalFlowLimited: 'SLOPE' } } },
  { id: 'barrel 100 m (same slope)', o: { L: 100 } },
];

const rows = [];
for (const c of CASES) for (const qq of c.qs) {
  const A = fullArea(c.shape, c.rise, c.span), D = c.rise, Q = qq * A * Math.sqrt(D) / KU;
  const hds = inletControlHW(c.key, c.shape, c.rise, c.span, Q, S).HW, yc = criticalDepth(c.shape, c.rise, c.span, Q), Ec = criticalEnergy(c.shape, c.rise, c.span, Q);
  for (const v of VARIANTS) {
    const LL = v.o?.L ?? L, tw = v.twFrac ? 10 - S * LL + v.twFrac * D : null;
    const r = runSteady(swmm, { asset: c.asset, L, S, ...(v.o ?? {}) }, Q, { tw, holdS: v.holdS ?? 1500 });
    const qEq = swmmInletQ(c.code, c.shape, c.rise, c.span, r.d1, S);
    rows.push({ case: c.id, qAD: qq, Q: +Q.toFixed(4), variant: v.id, swmmHW: +r.d1.toFixed(4), hds5HW: +hds.toFixed(4), diff: +(r.d1 - hds).toFixed(4),
      criticalDepth: +yc.toFixed(4), criticalEnergy: +Ec.toFixed(4), poolOverCriticalEnergy: +(r.d1 - Ec).toFixed(4),
      // SWMM's own inlet equation at SWMM's own pool head, as a fraction of the discharge it passes: 1 = evaluated at the pool
      eqAtPoolOverQ: +(qEq / Q).toFixed(3), mass: { swmmContinuityErrPct: r.mass.swmmErrorPct, steadyFlowErrPct: +r.mass.steadyFlowErrPct.toFixed(3), drift: +r.drift.toFixed(4) } });
  }
}
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b1-lowflow.json', import.meta.url), JSON.stringify({ benchmark: 'B1-LF low-flow inlet control, SWMM alone', S, L, rows }, null, 1));
console.log('B1-LF unsubmerged inlet control at low discharge, SWMM alone (S 0.02, L 20 m unless stated)\n');
console.log('case  Q/AD^.5  variant                          SWMM HW  HDS-5 HW  diff     pool − Ec  eq@pool/Q  continuity');
for (const r of rows) console.log(`${r.case.padEnd(4)}  ${String(r.qAD).padEnd(7)}  ${r.variant.padEnd(32)} ${r.swmmHW.toFixed(3)}    ${r.hds5HW.toFixed(3)}     ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)}   ${(r.poolOverCriticalEnergy >= 0 ? '+' : '') + r.poolOverCriticalEnergy.toFixed(3)}     ${r.eqAtPoolOverQ.toFixed(3)}      ${r.mass.swmmContinuityErrPct} %${r.mass.drift > 0.005 ? '  NOT STEADY' : ''}`);
