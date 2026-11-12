// B1-L: where the [LOSSES] belong. SWMM alone. Four loss settings on a coded culvert (none, entrance only, exit only,
// both), each in three regimes, against HDS-5's controlling headwater (the greater of inlet control and outlet control
// with Ke and Kx = 1):
//   R1 inlet control, free outfall: steep, short barrel (S 0.02, L 20 m)
//   R2 inlet control, outlet submerged: steep barrel (S 0.05, L 30 m), tailwater 0.2 m over the outlet crown
//   R3 outlet control, full barrel: flat barrel (S 0.001, L 60 m), tailwater 0.5 m over the outlet crown
// EXTRAN surcharge, so that the slot bias (B2) does not mix in. The translation is unchanged by this benchmark; it is
// the evidence for a decision on loss placement.
//
//   node benchmarks/culvert/b1-losses.mjs
import fs from 'node:fs';
import { runSteady, conduit, swmmEngine, IN } from './model.mjs';
import { inletControlHW, outletControlFull, outletControlHW, fullArea, KU } from './hds5.mjs';

const swmm = await swmmEngine();
const BARRELS = [
  { id: 'pipe', asset: conduit('circle', 1.2, 1.2, 'concrete'), key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2 },
  { id: 'ellipse', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'concrete'), key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN },
];
const REGIMES = [
  { id: 'R1 inlet, free outfall', S: 0.02, L: 20, tw: null, qs: [1, 2, 3, 4, 4.5, 5, 6] },
  { id: 'R2 inlet, outlet submerged', S: 0.05, L: 30, twOver: 0.2, qs: [2, 3, 4, 5] },
  { id: 'R3 outlet, full barrel', S: 0.001, L: 60, twOver: 0.5, vel: [1, 2, 3] },
];
const SETTINGS = [
  { id: 'none', loss: { entry: 0, exit: 0, avg: 0 } },
  { id: 'entrance only', loss: { entry: 0.5, exit: 0, avg: 0 } },
  { id: 'exit only', loss: { entry: 0, exit: 1, avg: 0 } },
  { id: 'both', loss: { entry: 0.5, exit: 1, avg: 0 } },
];

const rows = [];
for (const surcharge of ['EXTRAN', 'SLOT']) for (const b of BARRELS) for (const R of REGIMES) {
  const A = fullArea(b.shape, b.rise, b.span), D = b.rise, z0 = 10, zOut = z0 - R.S * R.L;
  const Qs = R.qs ? R.qs.map(q => q * A * Math.sqrt(D) / KU) : R.vel.map(v => v * A);
  for (const Q of Qs) {
    const twElev = R.tw === null ? null : zOut + D + R.twOver, twDepth = twElev == null ? 0 : twElev - zOut;
    const inlet = inletControlHW(b.key, b.shape, b.rise, b.span, Q, R.S).HW;
    const outlet = outletControlHW(b.shape, b.rise, b.span, Q, 0.013, R.L, R.S, twDepth, { Ke: 0.5, Kx: 1 });
    const ref = Math.max(inlet, outlet), governs = inlet >= outlet ? 'inlet' : 'outlet';
    const row = { surcharge, barrel: b.id, regime: R.id, Q: +Q.toFixed(3), qAD: +(KU * Q / (A * Math.sqrt(D))).toFixed(2), hds5Inlet: +inlet.toFixed(3), hds5Outlet: +outlet.toFixed(3), governs, ref: +ref.toFixed(3), err: {}, mass: {} };
    for (const s of SETTINGS) {
      const r = runSteady(swmm, { asset: b.asset, L: R.L, S: R.S, z0, losses: s.loss, routing: { surcharge } }, Q, { tw: twElev, holdS: 1800 });
      row.err[s.id] = +(r.d1 - ref).toFixed(3);
      row.steady = (row.steady ?? true) && r.drift < 0.01;
      row.mass[s.id] = { swmmContinuityErrPct: r.mass.swmmErrorPct, steadyFlowErrPct: +r.mass.steadyFlowErrPct.toFixed(3), drift: +r.drift.toFixed(4) };
    }
    rows.push(row);
  }
}
// what each setting does over all rows, by the regime HDS-5 says governs
const summary = {};
for (const sc of ['EXTRAN', 'SLOT']) for (const s of SETTINGS) for (const g of ['inlet', 'outlet']) {
  // steady rows only: an oscillating headwater (R2) has no single value to compare
  const e = rows.filter(r => r.surcharge === sc && r.governs === g && r.steady).map(r => r.err[s.id]);
  summary[`${sc} ${s.id} | ${g} governs`] = { n: e.length, meanErr: +(e.reduce((a, x) => a + x, 0) / e.length).toFixed(3), maxAbs: +Math.max(...e.map(Math.abs)).toFixed(3) };
}
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b1-losses.json', import.meta.url), JSON.stringify({ benchmark: 'B1-L loss placement, SWMM alone', settings: SETTINGS, rows, summary }, null, 1));
console.log('B1-L loss placement on a coded culvert, SWMM alone (EXTRAN and SLOT): SWMM headwater − HDS-5 controlling headwater (m)\n');
console.log('surch.  barrel   regime                       Q/AD^.5  Q        HDS-5 inlet  outlet  governs   none     entrance  exit     both');
for (const r of rows) console.log(`${r.surcharge.padEnd(7)} ${r.barrel.padEnd(8)} ${r.regime.padEnd(28)} ${String(r.qAD).padEnd(7)}  ${r.Q.toFixed(2).padStart(6)}   ${r.hds5Inlet.toFixed(3)}        ${r.hds5Outlet.toFixed(3)}   ${r.governs.padEnd(7)}  ${SETTINGS.map(s => ((r.err[s.id] >= 0 ? '+' : '') + r.err[s.id].toFixed(3)).padEnd(8)).join(' ')}${r.steady ? '' : '  NOT STEADY (headwater oscillates)'}`);
console.log('\nsummary (mean error, max |error|, m):'); for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(40)} n ${v.n}  mean ${v.meanErr >= 0 ? '+' : ''}${v.meanErr.toFixed(3)}  max ${v.maxAbs.toFixed(3)}`);
const worstMass = Math.max(...rows.filter(r => r.steady).flatMap(r => Object.values(r.mass).map(m => Math.abs(m.swmmContinuityErrPct))));
console.log(`\nmass: worst SWMM continuity over the steady runs (the oscillating R2 rows are in the JSON) ${worstMass} %`);
