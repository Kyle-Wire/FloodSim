// B1: inlet control in SWMM alone, against an independent HDS-5 calculation (benchmarks/culvert/hds5.mjs).
// Each culvert is built by FloodSim's production translation (swmmSection → toINP), run to steady state at a series of
// discharges with a free outfall, and its headwater compared with HDS-5's. Clean barrels only; sediment is B6.
//
//   node benchmarks/culvert/b1-inlet.mjs            (exit code 1 if a scored check fails)
//
// Zones are classified from HDS-5 alone (its discharge index Q/AD^0.5, US units), never from SWMM's result:
//   unsubmerged 0.5 ≤ q ≤ 3.5 and submerged q ≥ 4: tolerance max(0.03 m, 3 %);
//   transition 3.5 < q < 4: tolerance max(0.05 m, 5 %) (SWMM interpolates on headwater between 0.95 D and its submerged
//   limit, HDS-5 on discharge; the wider band is for that formulation difference, and the row is still scored);
//   where HDS-5's outlet control exceeds its inlet control the reference is the outlet-control headwater, same wider band.
// Below HDS-5's range (q < 0.5): reported, not scored. Round 1 classified the unsubmerged zone by SWMM's own headwater
// (HW ≤ 0.95 D); that excluded rows on the basis of the result being judged, and is replaced here.

import fs from 'node:fs';
import { runSteady, conduit, swmmEngine, IN } from './model.mjs';
import { swmmInletQ } from './swmm-replica.mjs';
import { inletControlHW, outletControlHW, criticalEnergy, fullArea, KU, INLET } from './hds5.mjs';

const swmm = await swmmEngine();
const S = 0.02, L = 20; // steep and short: inlet control governs
const CASES = [
  { id: 'B1-1', name: 'concrete pipe 1.2 m, square edge, headwall (code 1)', asset: conduit('circle', 1.2, 1.2, 'concrete'), ent: 'headwall', key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2, n: 0.013 },
  { id: 'B1-2', name: 'CMP 1.2 m, projecting (code 6)', asset: conduit('circle', 1.2, 1.2, 'metal'), ent: 'projecting', key: 'circle/metal/projecting', shape: 'circle', rise: 1.2, span: 1.2, n: 0.024 },
  { id: 'B1-3', name: 'concrete box 1.5 × 2.4 m, headwall (code 10)', asset: conduit('box', 1.5, 2.4, 'concrete'), ent: 'headwall', key: 'box/concrete/headwall', shape: 'box', rise: 1.5, span: 2.4, n: 0.013 },
  // a pipe the source designates ASTM C507: SWMM's size code 9. The reference is given the same pipe's geometry
  // (published full area and hydraulic radius, and the standard normalised profiles: hds5.mjs STD_HE), so both describe
  // the same section. Definition revision (11 Nov 2026, T2 decision): the asset now names the standard; without it the
  // translation draws the axes as a true ellipse (B1-4c). The SWMM section is the same as in rounds 1–3.
  { id: 'B1-4', name: 'concrete h-ellipse 38 × 60 in, designated ASTM C507 (size code 9, culvert code 30)', asset: conduit('h-ellipse', 38 * IN, 60 * IN, 'concrete', null, 1, 'ASTM C507'), ent: 'headwall', key: 'h-ellipse/concrete/headwall', shape: 'he-std:9', rise: 38 * IN, span: 60 * IN, n: 0.013,
    note: 'reference geometry: the standard pipe (12.9 ft², tabulated profile), the same section SWMM is given (round 1 used a true ellipse of that area)' },
  // the same axes drawn as a true ellipse (custom section), against a true-ellipse reference: the side-by-side control
  { id: 'B1-4c', name: 'concrete h-ellipse 38 × 60 in, rise and span only: a true ellipse (custom section, code 30): control for B1-4', asset: conduit('h-ellipse', 38 * IN, 60 * IN, 'concrete'), ent: 'headwall', key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 38 * IN, span: 60 * IN, n: 0.013,
    note: 'no standard named, so the translation draws the axes as a true ellipse (flagged: ambiguous profile); rounds 1–3 got the same section by switching size matching off' },
  { id: 'B1-4b', name: 'concrete h-ellipse 40 × 60 in, not a standard size: exact custom section (code 30)', asset: conduit('h-ellipse', 40 * IN, 60 * IN, 'concrete'), ent: 'headwall', key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 40 * IN, span: 60 * IN, n: 0.013 },
  { id: 'B1-5', name: 'h-ellipse 96 × 144 in, exact custom section (code 30, the Edwards Branch barrel)', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'concrete'), ent: 'headwall', key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN, n: 0.013 },
  { id: 'B1-6', name: 'CMP 1.2 m, mitered to slope (code 5)', asset: conduit('circle', 1.2, 1.2, 'metal'), ent: 'mitered', key: 'circle/metal/mitered', shape: 'circle', rise: 1.2, span: 1.2, n: 0.024,
    note: 'HDS-5 adds +0.7 S to HW/D for a mitered inlet; SWMM\'s culvert.c uses scf = −7 S (+7 S to HW/D)' },
];
const QS = [0.3, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3.75, 4, 4.5, 5, 6]; // Q/AD^0.5, US units

const rows = [], fails = [];
for (const c of CASES) {
  const A = fullArea(c.shape, c.rise, c.span), D = c.rise;
  let last = -Infinity, mono = true;
  for (const qq of QS) {
    const Q = qq * A * Math.sqrt(D) / KU;
    const r = runSteady(swmm, { asset: c.asset, L, S, entranceType: c.ent, cfg: c.cfg }, Q, { holdS: 1800 });
    // the same culvert with its code and no [LOSSES]: SWMM's inlet control on its own
    const rc = runSteady(swmm, { asset: c.asset, L, S, entranceType: c.ent, cfg: c.cfg, losses: null }, Q, { holdS: 1800 });
    const qEq = swmmInletQ(r.x.culvert, c.shape, c.rise, c.span, rc.d1, S); // SWMM's own equation at SWMM's own pool head
    const hds = inletControlHW(c.key, c.shape, c.rise, c.span, Q, S);
    const out = outletControlHW(c.shape, c.rise, c.span, Q, c.n, L, S, 0, { Ke: r.x.loss?.entry ?? 0.5 });
    // the same equation with SWMM's mitered slope term, to show what the difference is made of
    const asSwmm = INLET[c.key].Ks === 0.7 ? inletControlHW(c.key, c.shape, c.rise, c.span, Q, S) .HW + (7 - 0.7) * S * D : null;
    const Ec = criticalEnergy(c.shape, c.rise, c.span, Q);
    // HDS-5's free-tailwater outlet control, h0 = (dc + D)/2, is valid only for a headwater of at least 0.75 D (HDS-5
    // §3.x); below that it needs a backwater calculation the reference does not do, so it cannot overrule inlet control
    const outletValid = out >= 0.75 * D, inletGoverns = hds.HW >= out || !outletValid, ref = inletGoverns ? hds.HW : out;
    // HDS-5's own classification from the NOMINAL discharge index, independent of SWMM (recomputing it from Q put q = 3.5
    // on either side of the boundary by rounding)
    const zone = qq < 0.5 ? 'below range' : qq <= 3.5 ? 'unsubmerged' : qq >= 4 ? 'submerged' : 'transition';
    const wide = zone === 'transition' || !inletGoverns;
    const d = r.d1 - ref, tol = wide ? Math.max(0.05, 0.05 * ref) : Math.max(0.03, 0.03 * ref);
    const swmmBand = zone === 'unsubmerged' && hds.HW > 0.95 * D; // from HDS-5's headwater: where SWMM's own equation is already interpolating
    const scored = zone !== 'below range';
    const ok = !scored || Math.abs(d) <= tol;
    const energyOk = r.d1 >= Ec - 0.005; // a pool cannot pass Q with less energy than critical flow needs
    if (r.d1 < last - 1e-4) mono = false; last = r.d1;
    const massOk = Math.abs(r.mass.swmmErrorPct) < 0.5 && Math.abs(r.mass.steadyFlowErrPct) < 0.5 && r.drift < 0.005;
    const row = { case: c.id, qAD: qq, Q: +Q.toFixed(4), code: r.x.culvert, Ke: r.x.loss?.entry, swmmHW: +r.d1.toFixed(4), hds5HW: +ref.toFixed(4), hds5InletHW: +hds.HW.toFixed(4), diff: +d.toFixed(4), tol: +tol.toFixed(3),
      zone, swmmInterpolatingBand: swmmBand, hds5Regime: hds.regime, inletGovernsHDS5: inletGoverns, hds5OutletHW: +out.toFixed(3), hds5OutletValid: outletValid, ...(asSwmm != null ? { hds5WithSwmmSlopeTerm: +asSwmm.toFixed(4) } : {}),
      criticalEnergy: +Ec.toFixed(4), energyOk, swmmHWcodeOnly: +rc.d1.toFixed(4), swmmEqAtPoolHeadQ: Number.isFinite(qEq) ? +qEq.toFixed(4) : null, equationAtPoolHead: Number.isFinite(qEq) ? Math.abs(qEq - Q) / Q < 0.01 : null, lossesAddControl: r.d1 - rc.d1 > 0.01, scored, pass: ok,
      mass: { swmmContinuityErrPct: r.mass.swmmErrorPct, steadyFlowErrPct: +r.mass.steadyFlowErrPct.toFixed(4), hwDriftM: +r.drift.toFixed(5), ok: massOk } };
    rows.push(row);
    if (scored && !ok) fails.push(`${c.id} Q/AD^0.5 ${qq} (${zone}${inletGoverns ? '' : ', outlet governs'}): SWMM ${r.d1.toFixed(3)} m vs HDS-5 ${ref.toFixed(3)} m`);
    if (!massOk) fails.push(`${c.id} Q/AD^0.5 ${qq}: mass ${JSON.stringify(r.mass)}`);
  }
  rows.push({ case: c.id, monotonic: mono }); if (!mono) fails.push(`${c.id}: headwater not monotonic in discharge`);
}

// directions. (a) the conduit drawn from its low end: SWMM reverses an adverse conduit (link.c conduit_reverse), and
// the culvert code goes with it to the physical inlet. (b) flow entering at the outlet end: SWMM applies inlet
// control only to positive flow at node 1 (dwflow.c), so the code is inert; HDS-5 would apply the outlet end's own
// inlet control. Reported as a property of SWMM.
const c1 = CASES[0], Q2 = 2 * fullArea('circle', 1.2, 1.2) * Math.sqrt(1.2) / KU;
const fwd = runSteady(swmm, { asset: c1.asset, L, S }, Q2), back = runSteady(swmm, { asset: c1.asset, L, S, conduitFromLow: true }, Q2);
const dirA = { test: 'conduit drawn from its low end, Q/AD^0.5 = 2', forwardHW: +fwd.d1.toFixed(4), drawnBackwardsHW: +back.d1.toFixed(4), pass: Math.abs(fwd.d1 - back.d1) < 0.005 };
const revCode = runSteady(swmm, { asset: c1.asset, L, S: -S, reverse: false }, Q2), revNone = runSteady(swmm, { asset: c1.asset, L, S: -S, code: 0 }, Q2);
const dirB = { test: 'adverse barrel (flow enters at the end the code is not on after SWMM reverses it): HW with and without the code',
  withCode: +revCode.d1.toFixed(4), withoutCode: +revNone.d1.toFixed(4), codeActive: Math.abs(revCode.d1 - revNone.d1) > 0.005 };
if (!dirA.pass) fails.push('direction: drawn backwards gives a different headwater');

const result = { benchmark: 'B1 inlet control, SWMM alone', swmm: swmm.version, slope: S, length: L, cases: CASES.map(c => ({ id: c.id, name: c.name, note: c.note })), rows, directions: [dirA, dirB], fails };
// FLOODSIM_BENCH_OUT (instrumented comparison only): write elsewhere, so the production results are never overwritten
const OUT = process.env.FLOODSIM_BENCH_OUT ? (await import('node:url')).pathToFileURL(process.env.FLOODSIM_BENCH_OUT + '/') : new URL('./results/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(new URL('b1-inlet.json', OUT), JSON.stringify(result, null, 1));

console.log(`B1 inlet control, SWMM ${swmm.version} alone vs HDS-5 (S ${S}, L ${L} m, free outfall)\n`);
console.log('case   Q/AD^.5  Q m3/s   SWMM HW   HDS-5 HW   diff     zone          scored  E ok  mass  code-only HW  eq@pool');
for (const r of rows) if (r.qAD != null) console.log(`${r.case}  ${String(r.qAD).padEnd(7)}  ${r.Q.toFixed(3).padStart(6)}  ${r.swmmHW.toFixed(3).padStart(7)}   ${r.hds5HW.toFixed(3).padStart(7)}  ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)}   ${(r.zone + (r.swmmInterpolatingBand ? '~' : '')).padEnd(12)}  ${r.scored ? (r.pass ? 'PASS' : 'FAIL') : '-   '}    ${r.energyOk ? 'yes' : 'NO '}   ${r.mass.ok ? 'ok' : 'BAD'}   ${r.swmmHWcodeOnly.toFixed(3)}${r.lossesAddControl ? '*' : ' '}       ${r.equationAtPoolHead == null ? 'n/a' : r.equationAtPoolHead ? 'yes' : 'no '}${r.hds5WithSwmmSlopeTerm ? `   (HDS-5 with SWMM's −7S: ${r.hds5WithSwmmSlopeTerm.toFixed(3)})` : ''}${r.inletGovernsHDS5 ? '' : '  outlet governs in HDS-5'}`);
console.log(`\n~ HDS-5 unsubmerged HW above 0.95 D, where SWMM interpolates its own equation (still scored). * the [LOSSES] line raises the headwater above inlet control alone. eq@pool: SWMM's own equation at its reported pool head gives the discharge it passes.`);
for (const r of rows) if (r.monotonic != null) console.log(`${r.case} headwater monotonic in Q: ${r.monotonic}`);
console.log('\n' + JSON.stringify(dirA) + '\n' + JSON.stringify(dirB));
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall scored checks passed');
process.exit(fails.length ? 1 : 0);
