// PV-P1 pressurised pipe flow (spec/PV-P1.json). One circular conduit, full end to end under a tailwater held above
// its inlet crown, steady inflow, EXTRAN surcharge, no entrance or exit losses. Scored twice, never merged:
//   numerical       SWMM's head loss against Manning's full-pipe friction (the law SWMM applies to gravity conduits)
//   physical-model  the same head loss against Darcy–Weisbach + Colebrook, with roughness from the stated Strickler
//                   equivalence: NOT INDEPENDENTLY VALIDATED (the equivalence is an assumption, not a measurement)
// And reversed: the conduit written from its high end, inflow at the low end, the pool at the high end (flow uphill).
import { options, simulate } from '../lib/swmm-run.mjs';
import { row } from '../lib/score.mjs';
import { manningFullPipeLoss } from '../references/manning.mjs';
import { dwLoss, ksFromManning } from '../references/pipe.mjs';

const B = 'PV-P1';

function inp(P, D, n, Q, reversed) {
  const zUp = P.z0, zDn = P.z0 - P.slope * P.L, tw = zUp + D + P.twOverCrownM;
  // forward: J (high end, inflow) → OUT (low end, pool). reversed: inflow at the low end J, the pool at the high end OUT
  const zJ = reversed ? zDn : zUp, zO = reversed ? zUp : zDn;
  return { tw, text: [options({ durationS: P.durationS, step: P.routingStepS, variableStep: 0, surcharge: 'EXTRAN' }),
    '[JUNCTIONS]', `J ${zJ.toFixed(4)} ${(tw - zJ + 20).toFixed(3)} ${(tw - zJ).toFixed(4)} 0 0`, '',
    '[OUTFALLS]', `OUT ${zO.toFixed(4)} FIXED ${tw.toFixed(4)} NO`, '',
    '[CONDUITS]', reversed ? `C1 OUT J ${P.L} ${n} 0 0 0 0` : `C1 J OUT ${P.L} ${n} 0 0 0 0`, '',
    '[XSECTIONS]', `C1 CIRCULAR ${D} 0 0 0 1`, '',
    '[TIMESERIES]', 'QIN 0 0', `QIN ${(P.rampS / 3600).toFixed(4)} ${Q}`, `QIN ${P.durationS / 3600} ${Q}`, '',
    '[INFLOWS]', 'J FLOW QIN FLOW 1.0 1.0', ''].join('\n') };
}

export async function run(spec) {
  const P = Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.value])), C = spec.criteria, out = { rows: [], cases: [] };
  for (const D of P.diameters) for (const n of P.manningN) for (const reversed of [false, true]) {
    const Q = P.velocity * Math.PI * D * D / 4, caseId = `D ${D} n ${n}${reversed ? ' reversed' : ''}`, { tw, text } = inp(P, D, n, Q, reversed);
    const h = [], qs = [], yl = [];
    const r = await simulate(text, P.durationS, { every: 10, sample: (t, e) => { if (t >= P.durationS - P.averageS - 1e-6) { h.push(e.node('HEAD', e.index('NODE', 'J'))); qs.push(e.link('FLOW', e.index('LINK', 'C1'))); yl.push(e.link('DEPTH', e.index('LINK', 'C1'))); } } });
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, hf = mean(h) - tw, drift = Math.max(...h) - Math.min(...h), q = mean(qs);
    const full = Math.min(...yl) >= D - 1e-6, steady = drift <= C.steadyAbsM, flowOk = Math.abs(Math.abs(q) - Q) <= C.flowRel * Q && Math.sign(q) === (reversed ? -1 : 1);
    const pre = !full ? 'Invalid setup' : !steady ? 'Numerically unstable' : null;
    const hm = manningFullPipeLoss(D, Q, n, P.L), ks = ksFromManning(n), dw = dwLoss(D, Q, P.L, ks), dwSJ = dwLoss(D, Q, P.L, ks, { method: 'swamee-jain' });
    out.rows.push(row({ benchmark: B, caseId, quantity: 'head loss against Manning full-pipe friction', errorType: 'numerical', ref: hm, sim: hf, crit: { abs: C.headLossAbsM, rel: C.headLossRel }, unit: 'm', status: pre,
      note: full ? null : 'the conduit was not full end to end: the case does not test pressurised flow' }));
    out.rows.push(row({ benchmark: B, caseId, quantity: 'head loss against Darcy–Weisbach + Colebrook (k_s from Strickler)', errorType: 'physical-model', ref: dw.hf, sim: hf, crit: {}, unit: 'm', status: pre ?? 'Not independently validated',
      note: `k_s ${(ks * 1000).toFixed(2)} mm from n ${n} (Strickler, an assumption); Re ${dw.Re.toExponential(2)}, f ${dw.f.toFixed(5)}; Swamee–Jain gives ${dwSJ.hf.toFixed(4)} m`,
      extra: { dwSwameeJain: dwSJ.hf, manning: hm } }));
    out.rows.push(row({ benchmark: B, caseId, quantity: `flow through the conduit (sign ${reversed ? 'negative: uphill against the drawn direction' : 'positive'})`, errorType: 'accounting', ref: reversed ? -Q : Q, sim: q, crit: { rel: C.flowRel }, unit: 'm³/s' }));
    out.rows.push(row({ benchmark: B, caseId, quantity: "SWMM's reported flow-routing continuity error", errorType: 'accounting', ref: 0, sim: r.continuity.errorPct, crit: { abs: C.continuityPct }, unit: '%' }));
    out.cases.push({ D, n, reversed, Q, tw, hf, drift, full, flowOk });
  }
  return out;
}
