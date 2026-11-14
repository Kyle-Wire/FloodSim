// B6: silted barrels in SWMM alone, kept apart from the clean-barrel benchmarks. A long uniform barrel, built through
// the production translation (swmmSection with a sediment depth → toINP) as a chain of equal lengths, at a steady
// discharge. The water depth above the fill at a node well inside the chain (node depth − fill, since the conduit
// invert sits on the fill) is compared with the Manning normal depth of the open section, computed independently from
// exact geometry (hds5.mjs normalDepthCut: the fill surface counts as wetted bed). A clean barrel of the same shape
// runs alongside as a control: a bias it shares is the method's, not the sediment's.
//
//   node benchmarks/culvert/b6-sediment.mjs            (exit code 1 if a scored check fails)
import fs from 'node:fs';
import { conduit, swmmEngine, IN } from './model.mjs';
import { normalDepthCut, manningQCut } from './hds5.mjs';
import { swmmSection } from '../../src/swmm-xsect.js';
import { toINP } from '../../src/drainage.js';
import { SWMM } from '../../src/swmm.js';

const swmm = await swmmEngine();
const SEG = 60, N = 24, S = 0.002, PROBE = 12; // 1440 m; the probe node is half way, far from both ends' transitions
const CASES = [
  { id: 'B6-1', name: 'concrete pipe 1.2 m, 0.3 m of sediment as SWMM FILLED_CIRCULAR (circleSediment: filled)', asset: conduit('circle', 1.2, 1.2, 'concrete'), sed: 0.3, shape: 'circle', rise: 1.2, span: 1.2, cfg: { circleSediment: 'filled' } },
  { id: 'B6-1x', name: 'the same silted pipe as an exact CUSTOM section cut at the fill (circleSediment: cut, the default)', asset: conduit('circle', 1.2, 1.2, 'concrete'), sed: 0.3, shape: 'circle', rise: 1.2, span: 1.2, cfg: { circleSediment: 'cut' } },
  { id: 'B6-1c', name: 'the same pipe clean (control)', asset: conduit('circle', 1.2, 1.2, 'concrete'), sed: 0, shape: 'circle', rise: 1.2, span: 1.2 },
  { id: 'B6-2', name: 'concrete box 2 × 3 m, 0.5 m (RECT_CLOSED of the open 1.5 m)', asset: conduit('box', 2, 3, 'concrete'), sed: 0.5, shape: 'box', rise: 2, span: 3 },
  { id: 'B6-3', name: 'h-ellipse 96 × 144 in, 1.0 m (CUSTOM, cut at the fill)', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'concrete'), sed: 1.0, shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN },
  { id: 'B6-3c', name: 'the same ellipse clean (control)', asset: conduit('h-ellipse', 96 * IN, 144 * IN, 'concrete'), sed: 0, shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN },
];

function chainINP(c, durationS) {
  const nodes = [], pipes = [];
  for (let i = 0; i <= N; i++) nodes.push({ name: `N${i}`, invert: 10 - S * SEG * i, depth: 25, p: [i * SEG, 0], ...(i === N ? { outfall: true, outfallType: 'FREE' } : {}) });
  for (let i = 0; i < N; i++) { const x = swmmSection(c.asset, { sed: c.sed, name: `C${i}`, cfg: c.cfg ?? {} }); if (x.error) throw new Error(x.error); pipes.push({ name: `C${i}`, from: i, to: i + 1, L: SEG, n: x.n, inOffset: x.offsetRise, outOffset: x.offsetRise, xs: x }); }
  return { inp: toINP({ nodes, pipes, opts: { n: 0.013, surDepth: 0 } }, { x0: 0, y1: 0, dx: 1 }, { durationS }), x: pipes[0].xs };
}

const rows = [], fails = [];
for (const c of CASES) for (const frac of [0.3, 0.6, 0.8]) {
  // the discharge whose normal depth is `frac` of the open height: Manning forward, then inverted back as a check
  const open = c.rise - c.sed, Q = manningQCut(c.shape, c.rise, c.span, c.sed, frac * open, 0.013, S);
  const want = normalDepthCut(c.shape, c.rise, c.span, c.sed, Q, 0.013, S);
  if (Math.abs(want.y - frac * open) > 1e-4) throw new Error(`${c.id}: normal depth does not invert (${want.y} vs ${frac * open})`);
  const { inp, x } = chainINP(c, 6400);
  swmm.open(inp);
  const iIn = swmm.index('NODE', 'N0'), iP = swmm.index('NODE', `N${PROBE}`), iOut = swmm.index('LINK', `C${N - 1}`);
  let t = 0, d = 0, n = 0, lo = Infinity, hi = -Infinity, vin = 0, vout = 0;
  while (t < 6000) {
    const q = Q * Math.min(1, (t + 5) / 900); swmm.setLatFlow(iIn, q);
    swmm.stepTo(t + 5, (dt) => { vin += q * dt; vout += swmm.link('FLOW', iOut) * dt; }); t += 5;
    if (t > 5400) { const v = swmm.node('DEPTH', iP) - c.sed; d += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  const qOut = swmm.link('FLOW', iOut), rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  const got = d / n, diff = got - want.y, tol = Math.max(0.01, 0.03 * want.y);
  const row = { case: c.id, frac, Q: +Q.toFixed(4), shape: x.shape, writtenOffset: x.offsetRise, normalDepth: +want.y.toFixed(4), swmmDepthAboveFill: +got.toFixed(4), diff: +diff.toFixed(4), tol: +tol.toFixed(4),
    pass: Math.abs(diff) <= tol,
    // the same error as conveyance: the Manning discharge at SWMM's depth against the discharge it carries. Near the crown
    // conveyance flattens, so a small conveyance difference shows as a large depth difference
    conveyanceErrPct: +(100 * (manningQCut(c.shape, c.rise, c.span, c.sed, Math.min(got, open * 0.999), 0.013, S) / Q - 1)).toFixed(2), drift: +(hi - lo).toFixed(5),
    mass: { swmmContinuityErrPct: cont.errorPct, steadyOutflowErrPct: +(100 * (qOut - Q) / Q).toFixed(3), ok: Math.abs(cont.errorPct) < 0.5 && Math.abs(qOut - Q) / Q < 0.005 },
    energy: { note: 'uniform flow: the friction slope equals the bed slope; the open-section hydraulic radius at normal depth', R: +want.R.toFixed(4) } };
  rows.push(row);
  if (!row.pass) fails.push(`${c.id} at ${frac}: SWMM ${got.toFixed(3)} m above the fill vs normal ${want.y.toFixed(3)} m`);
  if (!row.mass.ok) fails.push(`${c.id} at ${frac}: mass ${JSON.stringify(row.mass)}`);
}
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b6-sediment.json', import.meta.url), JSON.stringify({ benchmark: 'B6 sediment, SWMM alone', segment: SEG, segments: N, S, probe: PROBE, cases: CASES.map(c => ({ id: c.id, name: c.name })), rows, fails }, null, 1));
console.log(`B6 silted barrels, SWMM ${swmm.version} alone: depth above the fill half way along a ${N * SEG} m barrel vs the Manning normal depth of the open section (S ${S}, n 0.013)\n`);
for (const r of rows) console.log(`${r.case.padEnd(5)}  ${String(r.frac).padEnd(4)} Q ${r.Q.toFixed(3).padStart(7)}  ${r.shape.padEnd(16)} offset ${String(r.writtenOffset).padEnd(4)} normal ${r.normalDepth.toFixed(3)}  SWMM ${r.swmmDepthAboveFill.toFixed(3)}  ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(3)}  ${r.pass ? 'PASS' : 'FAIL'}  conveyance ${(r.conveyanceErrPct >= 0 ? '+' : '') + r.conveyanceErrPct.toFixed(2)} %  mass ${r.mass.ok ? 'ok' : 'BAD'} (continuity ${r.mass.swmmContinuityErrPct} %, outflow ${r.mass.steadyOutflowErrPct} %)`);
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall scored checks passed');
process.exit(fails.length ? 1 : 0);
