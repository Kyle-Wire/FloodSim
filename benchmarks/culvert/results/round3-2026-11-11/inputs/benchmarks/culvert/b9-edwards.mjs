// B9: the Edwards Branch crossing, SWMM alone, as one conduit (T1) and as its three source records.
// Geometry from Charlotte's cached StormPipes records (read 2026-11-11, scratch probe; no network or coupling here):
//   P_39133  L 3.245 m  US_INVERT 673.0 ft  DS_INVERT 679.6 ft
//   P_11307  L 9.598 m  US_INVERT 679.6 ft  DS_INVERT 680.8 ft
//   P_11292  L 2.750 m  US_INVERT 680.8 ft  DS_INVERT 674.2 ft
//   all 96 in rise, metal, recorded as ellipse 96 × 144 in. Total 15.594 m.
// The two ends are the barrel's floor: 673.0 ft (205.130 m) at P_39133's start and 674.2 ft (205.496 m) at P_11292's end.
// The interior values (679.6, 680.8 ft = 207.14, 207.51 m) are the catch-basin connections, not the barrel floor
// (the user, 2026-11-11), so they are not used: the interior floor is the straight line between the ends.
// The record labels put the low end upstream (P_39133's US_INVERT 673.0), which makes the barrel adverse by 0.366 m;
// the fall says the other way. Which way the stream runs through it is a data question this benchmark does not settle,
// so both are run:
//   E-F  falling: inflow at the 205.496 m end, S = +2.35 %. Scored against HDS-5 (inlet control, code 30 coefficients,
//        'h-ellipse/concrete/headwall' as B1-5; outlet control with n 0.024) and one conduit against three records.
//   E-A  as labelled: inflow at the 205.130 m end, adverse. Representation only (one conduit against three records);
//        no adverse-ellipse reference is built here.
// The network as written today does not merge this crossing (T1's rules keep J373, a grate, and J121, a lateral and
// a grate); that is a translation question for the user, not this benchmark. Here the barrel alone is run both ways.
// Bands as B8: inlet max(0.03 m, 3 %) (transition and outlet-governed rows max(0.05 m, 5 %)); outlet control max(5 mm,
// 1 %); representation max(5 mm, 0.5 %).
//
//   node benchmarks/culvert/b9-edwards.mjs            (exit code 1 on a scored failure)
import fs from 'node:fs';
import { runSteady, conduit, swmmEngine, IN } from './model.mjs';
import { inletControlHW, outletControlHW, outletControlFull, fullArea, KU } from './hds5.mjs';

const swmm = await swmmEngine();
const FT = 0.3048, rise = 96 * IN, span = 144 * IN, A = fullArea('h-ellipse', rise, span), key = 'h-ellipse/concrete/headwall';
const recL = { P_39133: 3.245125171913182, P_11307: 9.598239332075481, P_11292: 2.750183145442364 };
const L = recL.P_39133 + recL.P_11307 + recL.P_11292, zLow = 673.0 * FT, zHigh = 674.2 * FT, S = (zHigh - zLow) / L;
const asset = () => conduit('h-ellipse', rise, span, 'metal');
const Qof = (q) => q * A * Math.sqrt(rise) / KU;
const inletBand = (ref, wide) => wide ? Math.max(0.05, 0.05 * ref) : Math.max(0.03, 0.03 * ref);
const rows = [], fails = [];
const push = (row, ok, msg) => { rows.push({ ...row, pass: ok }); if (!ok) fails.push(msg); };
const ref5 = (Q, n, tw = 0) => {
  const h = inletControlHW(key, 'h-ellipse', rise, span, Q, S), out = outletControlHW('h-ellipse', rise, span, Q, n, L, S, tw, { Ke: 0.5, Kx: 1 });
  const outletValid = out >= 0.75 * rise, inlet = h.HW >= out || !outletValid;
  return { ref: inlet ? h.HW : out, regime: h.q < 0.5 ? 'below range' : h.regime, governs: inlet ? 'inlet' : 'outlet' };
};
const F = { asset: asset(), L, S, z0: zHigh, entranceType: 'headwall' }, F3 = { ...F, segL: [recL.P_11292, recL.P_11307, recL.P_39133] };

// ---- E-F falling, inlet control, free outfall
for (const q of [0.5, 1, 2, 3, 4, 5]) {
  const Q = Qof(q), one = runSteady(swmm, F, Q, { holdS: 1800 }), three = runSteady(swmm, F3, Q, { holdS: 1800 }), h = ref5(Q, one.x.n);
  for (const [N, r] of [[1, one], [3, three]]) {
    const d = r.d1 - h.ref, tol = inletBand(h.ref, h.regime === 'transition' || h.governs === 'outlet'), rep = r.d1 - one.d1, repTol = Math.max(0.005, 0.005 * one.d1);
    const row = { group: 'E-F', test: 'falling, inlet control, free outfall', conduits: N, qAD: q, Q: +Q.toFixed(3), code: r.x.culvert, n: r.x.n, swmmHW: +r.d1.toFixed(4), hds5HW: +h.ref.toFixed(4), zone: h.regime, governs: h.governs,
      diff: +d.toFixed(4), tol: +tol.toFixed(3), vsOneConduit: +rep.toFixed(4), steady: r.drift < 0.005, continuityErrPct: r.mass.swmmErrorPct };
    const scored = h.regime !== 'below range';
    push(row, (!scored || Math.abs(d) <= tol) && Math.abs(rep) <= repTol && row.steady,
      `E-F ${N} conduit(s), Q/AD^0.5 ${q}: SWMM ${row.swmmHW} m, HDS-5 ${row.hds5HW} m (${row.diff}), one conduit ${one.d1.toFixed(4)} m (${row.vsOneConduit})${row.steady ? '' : ', not steady'}`);
  }
}
// ---- E-F falling, outlet control, full barrel (tailwater 0.5 m over the outlet crown, EXTRAN as B2)
{
  const routing = { surcharge: 'EXTRAN' };
  for (const V of [1, 2, 3]) {
    const Q = V * A, tw = zLow + rise + 0.5, one = runSteady(swmm, { ...F, routing }, Q, { tw, holdS: 1800 }), three = runSteady(swmm, { ...F3, routing }, Q, { tw, holdS: 1800 });
    const H = outletControlFull('h-ellipse', rise, span, Q, one.x.n, L, { Ke: 0.5, Kx: 1 }).H;
    for (const [N, r] of [[1, one], [3, three]]) {
      const dh = r.h1 - tw, tol = Math.max(0.005, 0.01 * H), rep = r.h1 - one.h1;
      const row = { group: 'E-F', test: 'falling, outlet control, full barrel (EXTRAN)', conduits: N, V, Q: +Q.toFixed(3), swmmHeadLoss: +dh.toFixed(4), hds5HeadLoss: +H.toFixed(4), diff: +(dh - H).toFixed(4), tol: +tol.toFixed(4),
        vsOneConduit: +rep.toFixed(4), continuityErrPct: r.mass.swmmErrorPct };
      push(row, Math.abs(dh - H) <= tol && Math.abs(rep) <= Math.max(0.005, 0.005 * H), `E-F ${N} conduit(s), full barrel V ${V}: head loss ${row.swmmHeadLoss} m vs HDS-5 ${row.hds5HeadLoss} m; one conduit differs by ${row.vsOneConduit} m`);
    }
  }
}
// ---- E-A as labelled (adverse), free outfall: representation only
{
  const Aa = { asset: asset(), L, S: -S, z0: zLow, entranceType: 'headwall' }, A3 = { ...Aa, segL: [recL.P_39133, recL.P_11307, recL.P_11292] };
  for (const q of [0.5, 1, 2, 3, 4, 5]) {
    const Q = Qof(q), one = runSteady(swmm, Aa, Q, { holdS: 1800 }), three = runSteady(swmm, A3, Q, { holdS: 1800 });
    for (const [N, r] of [[1, one], [3, three]]) {
      const rep = r.d1 - one.d1, repTol = Math.max(0.005, 0.005 * one.d1);
      const row = { group: 'E-A', test: 'as labelled (adverse 0.366 m), free outfall; representation only', conduits: N, qAD: q, Q: +Q.toFixed(3), swmmHW: +r.d1.toFixed(4), vsOneConduit: +rep.toFixed(4), steady: r.drift < 0.005, continuityErrPct: r.mass.swmmErrorPct };
      push(row, Math.abs(rep) <= repTol && row.steady, `E-A ${N} conduit(s), Q/AD^0.5 ${q}: SWMM ${row.swmmHW} m; one conduit ${one.d1.toFixed(4)} m (${row.vsOneConduit})${row.steady ? '' : ', not steady'}`);
    }
  }
}

fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b9-edwards.json', import.meta.url), JSON.stringify({ benchmark: 'B9 Edwards Branch crossing, SWMM alone', geometry: { recL, L, zLow, zHigh, S, rise, span, A }, rows, fails }, null, 1));
console.log(`B9 Edwards Branch crossing, SWMM ${swmm.version} alone: L ${L.toFixed(3)} m, ends ${zHigh.toFixed(3)} / ${zLow.toFixed(3)} m, S ${(100 * S).toFixed(2)} %\n`);
for (const r of rows) { const { group, test, pass, ...rest } = r; console.log(`${group}  ${pass ? 'PASS' : 'FAIL'}  ${test}  ${JSON.stringify(rest)}`); }
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall scored checks passed');
process.exit(fails.length ? 1 : 0);
