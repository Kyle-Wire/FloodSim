// T2 controlled experiment (diagnostic, unscored): SWMM's native standard horizontal ellipse (size code 9, 38 × 60 in)
// against the exact custom ellipse of the same rise and span, in regimes where the inlet-control anomaly cannot occur:
// no culvert code, no entrance or exit loss, a long conduit to a NORMAL outfall (part-full uniform flow), and a full
// barrel under a held tailwater (pressurised friction, EXTRAN). The translation is not changed: the standard section is
// what swmmSection writes for this size by default; the custom one is the same asset with ellipseStdTolIn -1 (B1-4c).
//
// Written out, raw, for each section:
//   - SWMM's own Cross Section Summary row (full depth, full area, full hydraulic radius, max width, full flow);
//   - for each steady Q, part full: inflow-node depth (headwater), outfall depth, link depth and velocity, and the area,
//     hydraulic radius and wetted perimeter those imply (A = Q / V; R from Manning, R = (V n / S^0.5)^1.5; P = A / R);
//     the implied values are only as good as the flow is uniform: check headwater ≈ link depth ≈ outfall depth;
//   - full barrel: head loss across the conduit, and the R it implies with SWMM's own full area.
// No reference values are computed here: those are to be calculated independently.
//
//   node benchmarks/culvert/t2-ellipse.mjs
import fs from 'node:fs';
import { buildINP, conduit, swmmEngine, IN } from './model.mjs';
import { SWMM } from '../../src/swmm.js';

const swmm = await swmmEngine();
const L = 400, S = 0.004, n = 0.013, rise = 38 * IN, span = 60 * IN, z0 = 10;
const SECT = { standard: { cfg: {} }, exact: { cfg: { ellipseStdTolIn: -1 } } };
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
  const o = { asset: conduit('h-ellipse', rise, span, 'concrete'), L, S, z0, cfg: s.cfg, outfallType: 'NORMAL' };
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

fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/t2-ellipse.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`T2 standard vs exact ellipse, SWMM ${swmm.version}: 38 × 60 in, L ${L} m, S ${S}, n ${n}, no code, no losses\n`);
for (const [name, r] of Object.entries(out.sections)) {
  console.log(`${name}: ${r.written.xsectLine}\n  summary ${JSON.stringify(r.summary.row)}`);
  for (const p of r.partFull) console.log(`  Q ${p.Q}: HW ${p.headwaterDepth} y ${p.linkDepth} V ${p.velocity} A ${p.impliedArea} R ${p.impliedHydRadius} P ${p.impliedPerimeter} drift ${p.drift}`);
  for (const p of r.full) console.log(`  full Q ${p.Q}: head loss ${p.headLoss} R(implied) ${p.impliedHydRadiusFromSwmmFullArea}`);
}
