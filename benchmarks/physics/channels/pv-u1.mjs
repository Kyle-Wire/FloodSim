// PV-U1 uniform open-channel flow (spec/PV-U1.json). A long prismatic reach of 50 m conduits (RECT_OPEN or TRAPEZOIDAL)
// to a FREE outfall, steady inflow at the top. The outfall's drawdown (an M2 profile from critical depth) is located by
// the independent GVF reference; depths are scored only at junctions where that profile is within 1 mm of normal depth
// and at least two conduits below the inflow. The reference normal depth is Manning's, by bisection and by Newton.
import { options, simulate } from '../lib/swmm-run.mjs';
import { row } from '../lib/score.mjs';
import * as man from '../references/manning.mjs';
import * as gvf from '../references/gvf.mjs';
import { area } from '../references/geometry.mjs';

const B = 'PV-U1';
const xsect = (s, depth) => (s.shape === 'rect' ? `RECT_OPEN ${depth} ${s.b} 0 0 1` : `TRAPEZOIDAL ${depth} ${s.b} ${s.z} ${s.z} 1`);

export function buildCase(P, s, S, n, Q, { nWritten = n } = {}) {
  const yn = man.normalDepthBisect(s, Q, n, S), yN = man.normalDepthNewton(s, Q, n, S), yc = man.criticalDepth(s, Q), Fr = man.froude(s, Q, yn);
  const m2 = gvf.directStep(s, Q, n, S, yc * 1.001, yn - P.uniformTolM, 4000), m2Len = m2.at(-1).x;
  const segL = P.segmentM, nSeg = Math.ceil((m2Len + P.uniformReachM) / segL), L = nSeg * segL;
  const z = (k) => P.z0 + S * segL * (nSeg - k); // junction k from the top (k = 0) to the outfall (k = nSeg)
  const lines = [options({ durationS: P.durationS, step: P.routingStepS, variableStep: P.variableStep, surcharge: 'SLOT' }),
    '[JUNCTIONS]', ...Array.from({ length: nSeg }, (_, k) => `J${k} ${z(k).toFixed(4)} ${P.channelDepth + 1} 0 0 0`), '',
    '[OUTFALLS]', `OUT ${z(nSeg).toFixed(4)} FREE NO`, '',
    '[CONDUITS]', ...Array.from({ length: nSeg }, (_, k) => `C${k} J${k} ${k + 1 < nSeg ? 'J' + (k + 1) : 'OUT'} ${segL} ${nWritten} 0 0 0 0`), '',
    '[XSECTIONS]', ...Array.from({ length: nSeg }, (_, k) => `C${k} ${xsect(s, P.channelDepth)}`), '',
    '[TIMESERIES]', `QIN 0 0`, `QIN ${(P.rampS / 3600).toFixed(4)} ${Q}`, `QIN ${P.durationS / 3600} ${Q}`, '',
    '[INFLOWS]', 'J0 FLOW QIN FLOW 1.0 1.0', ''];
  // scored junctions: x upstream of the outfall beyond the drawdown, and k ≥ 2
  const scored = []; for (let k = 2; k < nSeg; k++) { const x = (nSeg - k) * segL; if (x >= m2Len) scored.push(k); }
  // conduits in the uniform reach: conduit k runs from junction k to k + 1, so its DOWNSTREAM end must be beyond the
  // drawdown. (Harness correction before the first scored run: the first version took the conduit below each scored
  // junction, whose downstream end can lie inside the drawdown, against the spec's "conduits in the uniform reach".)
  const links = []; for (let k = 2; k < nSeg; k++) if ((nSeg - k - 1) * segL >= m2Len) links.push(k);
  // the GVF reference depth at every junction (diagnostic only): the drawdown from critical depth at the outfall
  const m2Profile = gvf.standardStep(s, Q, n, S, yc * 1.001, L, segL / 10, yc);
  const gvfAt = Array.from({ length: nSeg }, (_, k) => gvf.depthAt(m2Profile, (nSeg - k) * segL));
  return { inp: lines.join('\n'), yn, yN, yc, Fr, m2Len, nSeg, L, scored, links, gvfAt, V: Q / area(s, yn) };
}

export async function runCase(spec, s, S, n, Q, { nWritten = n, expected = null, label = null } = {}) {
  const P = Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.value])), C = spec.criteria;
  const c = buildCase(P, s, S, n, Q, { nWritten }), caseId = label ?? `${s.shape} S ${S} n ${n} Q ${Q}`;
  let profile = null; const hist = []; // depths of the scored junctions over the averaging window, to test steadiness
  const r = await simulate(c.inp, P.durationS, { every: 30, sample: (t, e) => {
    if (t < P.durationS - P.averageS - 1e-6) return;
    hist.push({ t, d: c.scored.map(k => e.node('DEPTH', e.index('NODE', 'J' + k))), v: c.links.map(k => e.link('VELOCITY', e.index('LINK', 'C' + k))) });
    if (t >= P.durationS - 30 - 1e-6) profile = Array.from({ length: c.nSeg }, (_, k) => e.node('DEPTH', e.index('NODE', 'J' + k)));
  } });
  const rows = [];
  if (c.Fr >= P.froudeMax) { rows.push(row({ benchmark: B, caseId, quantity: 'normal depth', errorType: 'numerical', ref: c.yn, sim: null, status: 'Invalid setup', note: `Froude ${c.Fr.toFixed(2)} ≥ ${P.froudeMax}: outside the valid range` })); return { rows, c }; }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const dMean = c.scored.map((_, i) => mean(hist.map(h => h.d[i]))), vMean = c.links.map((_, i) => mean(hist.map(h => h.v[i])));
  const drift = Math.max(...c.scored.map((_, i) => Math.max(...hist.map(h => h.d[i])) - Math.min(...hist.map(h => h.d[i]))));
  const steady = drift <= C.steadyAbsM;
  const worstD = dMean.reduce((w, d) => (Math.abs(d - c.yn) > Math.abs(w - c.yn) ? d : w), dMean[0]);
  const worstV = vMean.reduce((w, v) => (Math.abs(v - c.V) > Math.abs(w - c.V) ? v : w), vMean[0]);
  const nonSteady = steady ? null : 'Numerically unstable';
  rows.push(row({ benchmark: B, caseId, quantity: `normal depth, worst of ${c.scored.length} junctions in the uniform reach`, errorType: 'numerical', ref: c.yn, sim: worstD, crit: { abs: C.depthAbsM, rel: C.depthRel }, unit: 'm', status: nonSteady, expected,
    extra: { newtonCheck: +(c.yN - c.yn).toExponential(2), froude: +c.Fr.toFixed(3), reachM: c.L, drawdownM: +c.m2Len.toFixed(0), junctions: c.scored.length } }));
  rows.push(row({ benchmark: B, caseId, quantity: `velocity, worst of ${c.links.length} conduits in the uniform reach`, errorType: 'numerical', ref: c.V, sim: worstV, crit: { rel: C.velocityRel }, unit: 'm/s', status: nonSteady, expected }));
  rows.push(row({ benchmark: B, caseId, quantity: `steadiness: depth range over the last ${P.averageS} s`, errorType: 'numerical', ref: 0, sim: drift, crit: { abs: C.steadyAbsM }, unit: 'm', expected }));
  rows.push(row({ benchmark: B, caseId, quantity: "SWMM's reported flow-routing continuity error", errorType: 'accounting', ref: 0, sim: r.continuity.errorPct, crit: { abs: C.continuityPct }, unit: '%', expected }));
  // diagnostic, unscored: SWMM's depth against the GVF profile at every junction (x upstream of the outfall)
  const vsGVF = profile ? profile.map((d, k) => ({ k, x: (c.nSeg - k) * P.segmentM, swmm: +d.toFixed(5), gvf: +c.gvfAt[k].toFixed(5), diff: +(d - c.gvfAt[k]).toFixed(5), scored: c.scored.includes(k) })) : null;
  return { rows, c: { ...c, inp: undefined, gvfAt: undefined }, dMean, vMean, vsGVF };
}

export async function run(spec) {
  const P = spec.parameters, out = { rows: [], cases: [] };
  for (const s of P.sections.value) for (const S of P.slopes.value) for (const n of P.manningN.value) for (const Q of P.flows.value) {
    const r = await runCase(spec, s, S, n, Q); out.rows.push(...r.rows); out.cases.push({ s, S, n, Q, ...r.c, dMean: r.dMean, vMean: r.vMean, vsGVF: r.vsGVF });
  }
  return out;
}
