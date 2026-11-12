// B2: outlet control in SWMM alone, against HDS-5's full-barrel energy equation (benchmarks/culvert/hds5.mjs):
//   HW = TW + (Ke + Kx + Kf)·V²/2g,  Kf = 2g·n²·L / R^(4/3),  HDS-5 Kx = 1.
// The tailwater is held above the outlet crown with setOutfallStage (as the coupler holds a stream outfall), so the
// barrel runs full and SWMM's inlet control is off (dwflow.c: only while the barrel is not full). Three loss settings
// on the same culvert, to see what each term contributes: production (Ke from HDS-5, Kx 1.0), no exit loss, no
// [LOSSES] at all. Then the same in reverse (water entering at the outlet end), since SWMM's losses are positional.
// Mass is SWMM's continuity and the steady flow; energy is the head drop against its parts.
//
//   node benchmarks/culvert/b2-outlet.mjs            (exit code 1 if a scored check fails)

import fs from 'node:fs';
import { runSteady, conduit, swmmEngine, IN } from './model.mjs';
import { outletControlFull, fullArea, outletControlHW } from './hds5.mjs';

const swmm = await swmmEngine();
const S = 0.001, L = 60;
const CASES = [
  { id: 'B2-1', name: 'concrete pipe 1.2 m, headwall (Ke 0.5)', asset: conduit('circle', 1.2, 1.2, 'concrete'), shape: 'circle', rise: 1.2, span: 1.2 },
  { id: 'B2-2', name: 'CMP 1.2 m, projecting (Ke 0.9, n 0.024)', asset: conduit('circle', 1.2, 1.2, 'metal'), ent: 'projecting', shape: 'circle', rise: 1.2, span: 1.2 },
  { id: 'B2-3', name: 'concrete box 1.5 × 2.4 m, headwall', asset: conduit('box', 1.5, 2.4, 'concrete'), shape: 'box', rise: 1.5, span: 2.4 },
  { id: 'B2-4', name: 'h-ellipse 96 × 144 in, exact custom section, CMP (n 0.024)', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'metal'), shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN },
];
const VARIANTS = [
  { key: 'production', Kx: 1, losses: undefined },
  { key: 'no exit loss', Kx: 0, cfg: { exitLoss: 0 } },
  { key: 'no [LOSSES]', Kx: 0, Ke0: true, losses: null },
];
const VEL = [0.5, 1, 2, 3]; // barrel velocity, m/s

const rows = [], fails = [];
// surcharge: SLOT is production (toINP's default, a Preissmann slot); EXTRAN tests SWMM's full-pipe energy equation itself
for (const surcharge of ['EXTRAN', 'SLOT']) for (const c of CASES) for (const reverse of [false, true]) for (const v of VARIANTS) for (const V of VEL) {
  const A = fullArea(c.shape, c.rise, c.span), Q = V * A, z0 = 10, zOut = z0 - S * L;
  // the receiving pool: 0.5 m over the crown of the end the water leaves by
  const twElev = (reverse ? z0 : zOut) + c.rise + 0.5;
  const o = { asset: c.asset, L, S, z0, entranceType: c.ent, reverse, cfg: v.cfg, routing: { surcharge }, ...(v.losses !== undefined ? { losses: v.losses } : {}) };
  const r = runSteady(swmm, o, Q, { tw: twElev, holdS: 1500 });
  const Ke = v.Ke0 ? 0 : (r.x.loss?.entry ?? 0);
  // HDS-5 for the same losses. In reverse the water enters at the outlet end: HDS-5 would take that end's own Ke
  // and Kx 1; SWMM keeps each coefficient at its end (findLocalLosses), and both ends are full, so only the sum counts.
  const n = r.x.n, h = outletControlFull(c.shape, c.rise, c.span, Q, n, L, { Ke, Kx: v.Kx });
  const hdsHW = twElev + h.H, swmmHW = r.h1, d = swmmHW - hdsHW, tol = surcharge === 'EXTRAN' ? Math.max(0.005, 0.01 * h.H) : Math.max(0.01, 0.05 * h.H);
  const full = r.d1 >= c.rise && r.d2 >= c.rise;
  const hds5Physical = outletControlFull(c.shape, c.rise, c.span, Q, n, L, { Ke: r.x.loss?.entry ?? 0.5, Kx: 1 });
  const ok = Math.abs(d) <= tol;
  const massOk = Math.abs(r.mass.swmmErrorPct) < 0.5 && Math.abs(r.mass.steadyFlowErrPct) < 0.5 && r.drift < 0.005;
  rows.push({ case: c.id, surcharge, direction: reverse ? 'reverse' : 'forward', variant: v.key, V, Q: +Q.toFixed(4), n, Ke, Kx: v.Kx, Kf: +h.Kf.toFixed(4), hv: +h.hv.toFixed(4),
    swmmHeadDrop: +(swmmHW - twElev).toFixed(4), hds5HeadDrop: +h.H.toFixed(4), diff: +d.toFixed(4), tol: +tol.toFixed(4), pass: ok, barrelFull: full,
    // against the physical answer (HDS-5 with Kx 1 and the entrance's Ke): what each variant gets wrong
    vsHDS5Physical: +(swmmHW - twElev - hds5Physical.H).toFixed(4), energy: { swmmLossOverHv: +((swmmHW - twElev) / h.hv).toFixed(3), hds5LossOverHv: +(Ke + v.Kx + h.Kf).toFixed(3) },
    mass: { swmmContinuityErrPct: r.mass.swmmErrorPct, steadyFlowErrPct: +r.mass.steadyFlowErrPct.toFixed(4), hwDriftM: +r.drift.toFixed(5), ok: massOk } });
  if (!ok) fails.push(`${c.id} ${surcharge} ${reverse ? 'reverse' : 'forward'} ${v.key} V ${V}: SWMM drop ${(swmmHW - twElev).toFixed(4)} vs HDS-5 ${h.H.toFixed(4)} m`);
  if (!full) fails.push(`${c.id} ${surcharge} ${reverse ? 'reverse' : 'forward'} ${v.key} V ${V}: barrel not full (the benchmark's premise)`);
  if (!massOk) fails.push(`${c.id} ${surcharge} ${reverse ? 'reverse' : 'forward'} ${v.key} V ${V}: mass ${JSON.stringify(r.mass)}`);
}

// Reported, not scored: a tailwater below the outlet crown, where HDS-5's h0 = max(TW, (dc + D)/2) is itself an
// approximation of the backwater curve SWMM computes
const part = [];
{ const c = CASES[0], A = fullArea('circle', 1.2, 1.2);
  for (const tw of [0.6, 0.9]) for (const V of [1, 2]) {
    const Q = V * A, zOut = 10 - S * L, r = runSteady(swmm, { asset: c.asset, L, S }, Q, { tw: zOut + tw });
    const hds = outletControlHW('circle', 1.2, 1.2, Q, r.x.n, L, S, tw, { Ke: 0.5, Kx: 1 });
    part.push({ case: 'B2-P', twDepth: tw, V, swmmHW: +r.d1.toFixed(4), hds5HW: +hds.toFixed(4), diff: +(r.d1 - hds).toFixed(4) });
  } }

const result = { benchmark: 'B2 outlet control, SWMM alone', swmm: swmm.version, slope: S, length: L, rows, partlyFull: part, fails };
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b2-outlet.json', import.meta.url), JSON.stringify(result, null, 1));

console.log(`B2 outlet control, SWMM ${swmm.version} alone vs HDS-5 full-barrel energy (S ${S}, L ${L} m, tailwater 0.5 m over the crown)\nscored: EXTRAN within max(5 mm, 1 %) of HDS-5 (SWMM's energy equation); SLOT (production) within max(10 mm, 5 %), its slot bias reported\n`);
console.log('case  surcharge  dir      variant        V    Ke   Kx   Kf      SWMM drop  HDS-5 drop  diff     pass  vs physical  mass');
for (const r of rows) console.log(`${r.case}  ${r.surcharge.padEnd(9)}  ${r.direction.padEnd(7)}  ${r.variant.padEnd(13)}  ${r.V.toFixed(1)}  ${r.Ke.toFixed(1)}  ${r.Kx.toFixed(1)}  ${r.Kf.toFixed(3)}   ${r.swmmHeadDrop.toFixed(4)}     ${r.hds5HeadDrop.toFixed(4)}     ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(4)}  ${r.pass ? 'PASS' : 'FAIL'}  ${(r.vsHDS5Physical >= 0 ? '+' : '') + r.vsHDS5Physical.toFixed(4)}      ${r.mass.ok ? 'ok' : 'BAD'}`);
console.log('\npartly full outlet (reported only):'); for (const p of part) console.log(' ', JSON.stringify(p));
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall scored checks passed');
process.exit(fails.length ? 1 : 0);
