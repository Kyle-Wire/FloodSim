// T2 controlled experiment (diagnostic, unscored): SWMM's native standard horizontal ellipse (size code 9, 38 × 60 in)
// against the exact custom ellipse of the same rise and span, in regimes where the inlet-control anomaly cannot occur:
// no culvert code, no entrance or exit loss, a long conduit to a NORMAL outfall (part-full uniform flow), and a full
// barrel under a held tailwater (pressurised friction, EXTRAN).
// Definition revision 2 (11 Nov 2026, the T2 decision): the standard section is the asset designated ASTM C507
// (section.standard), the only case swmmSection now gives SWMM's size code; the exact one is the same axes with rise and
// span only, which the translation now draws as a true ellipse (flagged as an ambiguous profile).
//
// Written out, raw, for each section:
//   - SWMM's own Cross Section Summary row (full depth, full area, full hydraulic radius, max width, full flow);
//   - for each steady Q, part full: inflow-node depth (headwater), outfall depth, link depth and velocity, and the area,
//     hydraulic radius and wetted perimeter those imply (A = Q / V; R from Manning, R = (V n / S^0.5)^1.5; P = A / R);
//     the implied values are only as good as the flow is uniform: check headwater ≈ link depth ≈ outfall depth;
//   - full barrel: head loss across the conduit, and the R it implies with SWMM's own full area.
// No reference values are computed here. The references are the independent critic's (review 3), preserved unchanged
// in references/t2-critic/ (calc.py, extra.py, out.json, report.md, SHA256SUMS), and scored below against criteria
// fixed before this revision was run (CRITERIA). Three questions are kept apart and never merged into one score:
//   implementation  does SWMM compute what its declared section implies? (SWMM against the critic's emulation of the
//                   section as written: code-9 tables or the written curve)
//   representation  how far is each written section from the real 38 × 60 in ellipse? (SWMM against the true ellipse)
//                   the standard section is Qualified: its tables are known not to be an ellipse, so it is reported, not
//                   passed or failed; the exact section has a criterion
//   accounting      SWMM's own continuity error (finding T2-C, kept separate: flow = Q and no drift, cause not found)
// Custom Q 2.5 is an invalid setup, not a result: it is not uniform flow (SWMM's NORMAL outfall takes the upper
// normal-depth root, 0.962 m, inside the custom section's narrow top; headwater 0.774, link 0.868). Its raw values
// are kept, and it is excluded from scoring.
//
//   node benchmarks/culvert/t2-ellipse.mjs
import fs from 'node:fs';
import { buildINP, conduit, swmmEngine, IN } from './model.mjs';
import { SWMM } from '../../src/swmm.js';

const swmm = await swmmEngine();
const L = 400, S = 0.004, n = 0.013, rise = 38 * IN, span = 60 * IN, z0 = 10;
const SECT = { standard: { standard: 'ASTM C507' }, exact: { standard: null } };
const out = { experiment: 'T2 standard vs exact ellipse, no inlet control', inputs: { L, S, n, rise, span, z0, riseIn: 38, spanIn: 60 }, sections: {} };

function run(o, Q, { tw = null, rampS = 600, holdS = 3600, avgS = 600 } = {}) {
  const { inp, x } = buildINP({ ...o, role: null, code: 0, losses: null, durationS: rampS + holdS + 60, initElev: tw });
  swmm.open(inp.replace('INPUT NO', 'INPUT YES'));
  const iU = swmm.index('NODE', 'HW'), iD = swmm.index('NODE', 'TW'), iL = swmm.index('LINK', 'C1');
  if (tw != null) swmm.setOutfallStage(iD, tw);
  let t = 0, k = 0; const a = { d1: 0, d2: 0, h1: 0, h2: 0, q: 0, v: 0, y: 0 }, hs = [];
  while (t < rampS + holdS - 1e-6) {
    swmm.setLatFlow(iU, Q * Math.min(1, (t + 5) / rampS)); if (tw != null) swmm.setOutfallStage(iD, tw);
    t = Math.min(t + 5, rampS + holdS); swmm.stepTo(t);
    if (t > rampS + holdS - avgS) {
      a.d1 += swmm.node('DEPTH', iU); a.d2 += swmm.node('DEPTH', iD); a.h1 += swmm.node('HEAD', iU); a.h2 += swmm.node('HEAD', iD);
      a.q += swmm.link('FLOW', iL); a.v += swmm.link('VELOCITY', iL); a.y += swmm.link('DEPTH', iL); k++; hs.push(swmm.node('HEAD', iU));
    }
  }
  const rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  for (const key in a) a[key] /= k;
  const row = (rpt.split('Cross Section Summary')[1] ?? '').split('\n').map(l => l.trim().split(/\s+/)).find(r => r[0] === 'C1');
  return { ...a, drift: Math.max(...hs) - Math.min(...hs), x, summary: row, continuityErrPct: cont.errorPct, inp };
}

for (const [name, s] of Object.entries(SECT)) {
  const o = { asset: conduit('h-ellipse', rise, span, 'concrete', null, 1, s.standard), L, S, z0, outfallType: 'NORMAL' };
  const rec = { written: null, summary: null, partFull: [], full: [] };
  for (const Q of [0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 2.5]) {
    const r = run(o, Q);
    if (!rec.written) {
      rec.written = { shape: r.x.shape, g: r.x.g, curve: r.x.curve?.pts ?? null, xsectLine: r.inp.split('[XSECTIONS]')[1].split('\n').find(l => /^C1\s/.test(l))?.trim() };
      rec.summary = { cols: ['link', 'shape', 'fullDepth', 'fullArea', 'hydRad', 'maxWidth', 'barrels', 'fullFlow'], row: r.summary };
    }
    const A = Q / r.v, R = (r.v * n / Math.sqrt(S)) ** 1.5;
    rec.partFull.push({ Q, swmmFlow: +r.q.toFixed(5), headwaterDepth: +r.d1.toFixed(5), outfallDepth: +r.d2.toFixed(5), linkDepth: +r.y.toFixed(5), velocity: +r.v.toFixed(5),
      impliedArea: +A.toFixed(5), impliedHydRadius: +R.toFixed(5), impliedPerimeter: +(A / R).toFixed(5), drift: +r.drift.toFixed(5), continuityErrPct: r.continuityErrPct });
  }
  // full barrel: tailwater 0.5 m over the INLET crown (the barrel falls S L = 1.6 m, so it is full end to end), EXTRAN
  for (const Q of [1.0, 2.0, 3.0]) {
    const tw = z0 + rise + 0.5, r = run({ ...o, outfallType: 'FREE', routing: { surcharge: 'EXTRAN' } }, Q, { tw });
    const Af = Number(rec.summary.row?.[3]), V = Q / Af, hf = r.h1 - tw, Rimpl = (Q * n / (Af * Math.sqrt(hf / L))) ** 1.5;
    rec.full.push({ Q, tailwater: +tw.toFixed(4), headwater: +r.h1.toFixed(5), headLoss: +hf.toFixed(5), swmmFlow: +r.q.toFixed(5), velocityLink: +r.v.toFixed(5),
      impliedHydRadiusFromSwmmFullArea: +Rimpl.toFixed(5), note: 'head loss includes no entrance or exit loss (none written); the velocity head at the pool is not counted by SWMM', continuityErrPct: r.continuityErrPct, drift: +r.drift.toFixed(5) });
  }
  out.sections[name] = rec;
}

// ---- scoring (criteria revision 1, fixed 11 Nov 2026 before this revision's run)
const CRITERIA = { revision: 1, fixed: '2026-11-11',
  implementation: { depthAbsM: 0.001, headLossRel: 0.001, why: 'SWMM against an emulation of the same section: only rounding should differ (input written to 5 dp, summary areas to 2 dp)' },
  representation: { depthAbsM: 0.002, depthRel: 0.005, headLossRel: 0.01, why: 'the exact section is a 41-point curve of the true ellipse: B1 and the critic put its area and R within 0.15 %' },
  accounting: { continuityAbsPct: 1.0, why: 'SWMM continuity error, reported as its own finding' } };
const REF = JSON.parse(fs.readFileSync(new URL('./references/t2-critic/out.json', import.meta.url)));
const INVALID = { exact: { 2.5: 'invalid setup: not uniform flow (the NORMAL outfall takes the upper normal-depth root inside the custom section); raw values kept, not scored' } };
const rows = [], verdict = (ok) => (ok ? 'Passed' : 'Failed');
for (const [name, r] of Object.entries(out.sections)) {
  const key = name === 'standard' ? 'std' : 'cus';
  for (const p of r.partFull) {
    const ref = REF.normal.find(x => x.Q === p.Q), inv = INVALID[name]?.[p.Q];
    if (inv) { rows.push({ section: name, Q: p.Q, kind: 'normal depth', status: 'Invalid setup', note: inv, raw: p }); continue; }
    if (!ref) { rows.push({ section: name, Q: p.Q, kind: 'normal depth', status: 'Insufficient reference data' }); continue; }
    const yi = ref[`y_${key}`], yt = ref.y_true, sim = p.linkDepth;
    rows.push({ section: name, Q: p.Q, kind: 'normal depth', question: 'implementation', ref: yi, sim, abs: +(sim - yi).toFixed(5), status: verdict(Math.abs(sim - yi) <= CRITERIA.implementation.depthAbsM) });
    const lim = Math.max(CRITERIA.representation.depthAbsM, CRITERIA.representation.depthRel * yt);
    rows.push({ section: name, Q: p.Q, kind: 'normal depth', question: 'representation', ref: yt, sim, abs: +(sim - yt).toFixed(5), rel: +((sim - yt) / yt).toFixed(5), threshold: name === 'standard' ? null : +lim.toFixed(5),
      status: name === 'standard' ? 'Qualified' : verdict(Math.abs(sim - yt) <= lim) });
    rows.push({ section: name, Q: p.Q, kind: 'continuity', question: 'accounting', sim: p.continuityErrPct, threshold: CRITERIA.accounting.continuityAbsPct, status: verdict(Math.abs(p.continuityErrPct) <= CRITERIA.accounting.continuityAbsPct), finding: 'T2-C' });
  }
  for (const p of r.full) {
    const ref = REF.fullflow.find(x => x.Q === p.Q), hi = ref[`${key}_swmmunits`], ht = ref.true, sim = p.headLoss;
    rows.push({ section: name, Q: p.Q, kind: 'full-barrel head loss', question: 'implementation', ref: hi, sim, rel: +((sim - hi) / hi).toFixed(5), status: verdict(Math.abs(sim - hi) / hi <= CRITERIA.implementation.headLossRel) });
    rows.push({ section: name, Q: p.Q, kind: 'full-barrel head loss', question: 'representation', ref: ht, sim, rel: +((sim - ht) / ht).toFixed(5), threshold: name === 'standard' ? null : CRITERIA.representation.headLossRel,
      status: name === 'standard' ? 'Qualified' : verdict(Math.abs(sim - ht) / ht <= CRITERIA.representation.headLossRel) });
    rows.push({ section: name, Q: p.Q, kind: 'continuity', question: 'accounting', sim: p.continuityErrPct, threshold: CRITERIA.accounting.continuityAbsPct, status: verdict(Math.abs(p.continuityErrPct) <= CRITERIA.accounting.continuityAbsPct), finding: 'T2-C' });
  }
}
const counts = {};
for (const x of rows) { const k = `${x.question ?? 'setup'}/${x.status}`; counts[k] = (counts[k] ?? 0) + 1; }
out.definitionRevision = 2; out.criteria = CRITERIA; out.reference = 'references/t2-critic (review 3, independent critic; SHA256SUMS alongside)'; out.scores = rows; out.counts = counts;

fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/t2-ellipse.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`T2 standard vs exact ellipse, SWMM ${swmm.version}: 38 × 60 in, L ${L} m, S ${S}, n ${n}, no code, no losses\n`);
for (const [name, r] of Object.entries(out.sections)) {
  console.log(`${name}: ${r.written.xsectLine}\n  summary ${JSON.stringify(r.summary.row)}`);
  for (const p of r.partFull) console.log(`  Q ${p.Q}: HW ${p.headwaterDepth} y ${p.linkDepth} V ${p.velocity} A ${p.impliedArea} R ${p.impliedHydRadius} P ${p.impliedPerimeter} drift ${p.drift}`);
  for (const p of r.full) console.log(`  full Q ${p.Q}: head loss ${p.headLoss} R(implied) ${p.impliedHydRadiusFromSwmmFullArea}`);
}
console.log(`\nscores (criteria revision ${CRITERIA.revision}; reference: the critic's independent calculation)`);
for (const x of rows) console.log(`  ${x.status.padEnd(28)} ${x.section.padEnd(8)} Q ${String(x.Q).padEnd(4)} ${(x.question ?? '').padEnd(14)} ${x.kind.padEnd(22)} ${x.ref != null ? `ref ${x.ref.toFixed(5)} ` : ''}sim ${x.sim ?? '—'}${x.abs != null ? ` Δ ${x.abs}` : ''}${x.rel != null ? ` (${(x.rel * 100).toFixed(2)} %)` : ''}${x.note ? ' — ' + x.note : ''}`);
console.log(`counts: ${JSON.stringify(counts)}`);
