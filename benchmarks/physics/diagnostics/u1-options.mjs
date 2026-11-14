// Diagnostic (not scored; a hypothesis test, not a setting for any benchmark or for production): does SWMM's handling of
// the inertial terms near the free outfall account for the PV-U1 steep-trapezoid drawdown? The registered PV-U1 runs
// use INERTIAL_DAMPING PARTIAL and NORMAL_FLOW_LIMITED BOTH (lib/swmm-run.mjs defaults). PARTIAL damping reduces the
// inertial terms as the Froude number rises toward 1, which it does approaching the outfall; the GVF reference keeps
// the full energy equation. Segment refinement (u1-refine.mjs) shrinks the departure only slowly, toward a non-zero
// limit, so the departure is mostly not discretisation. This runs the same case (50 m conduits, as registered) under
// each option and reports SWMM − GVF at fixed distances above the outfall. Writes diagnostics/out/u1-options.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildCase } from '../channels/pv-u1.mjs';
import { simulate } from '../lib/swmm-run.mjs';
import * as gvf from '../references/gvf.mjs';

const spec = JSON.parse(readFileSync(new URL('../spec/PV-U1.json', import.meta.url)));
const P = Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.value]));
const s = { shape: 'trap', b: 2, z: 1.5 }, S = 0.003, n = 0.02, at = [300, 200, 150, 100, 50];
const variants = [['PARTIAL', 'BOTH'], ['NONE', 'BOTH'], ['FULL', 'BOTH'], ['PARTIAL', 'SLOPE'], ['PARTIAL', 'FROUDE'], ['NONE', 'SLOPE']];
const out = [];
for (const Q of [3, 6]) for (const [damp, nfl] of variants) {
  const c = buildCase(P, s, S, n, Q);
  const inp = c.inp.replace(/^INERTIAL_DAMPING .*$/m, `INERTIAL_DAMPING ${damp}`).replace(/^NORMAL_FLOW_LIMITED .*$/m, `NORMAL_FLOW_LIMITED ${nfl}`);
  let prof = null;
  const r = await simulate(inp, P.durationS, { every: 30, sample: (t, e) => { if (t >= P.durationS - 30 - 1e-6) prof = Array.from({ length: c.nSeg }, (_, k) => e.node('DEPTH', e.index('NODE', 'J' + k))); } });
  const m2 = gvf.standardStep(s, Q, n, S, c.yc * 1.001, c.L, P.segmentM / 10, c.yc);
  const diff = Object.fromEntries(at.map(x => { const k = c.nSeg - x / P.segmentM; return [x, prof && Number.isInteger(k) && k >= 0 ? +((prof[k] - gvf.depthAt(m2, x)) * 1000).toFixed(2) : null]; }));
  const scoredWorst = Math.max(...c.scored.map(k => Math.abs(prof[k] - c.yn))) * 1000;
  out.push({ Q, inertialDamping: damp, normalFlowLimited: nfl, diffMmAtXm: diff, scoredWorstAbsMm: +scoredWorst.toFixed(2), continuityPct: r.continuity.errorPct });
  console.log(JSON.stringify(out.at(-1)));
}
mkdirSync(new URL('out/', import.meta.url), { recursive: true });
writeFileSync(new URL('out/u1-options.json', import.meta.url), JSON.stringify({ written: new Date().toISOString(), note: 'SWMM − GVF, mm, at x m above the outfall; 50 m conduits as registered; registered = PARTIAL / BOTH', runs: out }, null, 1));
