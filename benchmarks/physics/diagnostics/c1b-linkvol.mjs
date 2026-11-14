// Diagnostic (not scored): what the instrumented SWMM build's conduit volume (swmm_LINK_VOLUME = 420, see
// benchmarks/culvert/instrumented/) can and cannot add to PV-C1-b, the part-full pipe in motion.
// SWMM sets a conduit's volume to aMid · L, with aMid the area at the mean of its end depths (dwflow.c line 291), the
// same quantity PV-C1-b's estimate uses: so in motion the getter is a second reading of SWMM's representation, not an
// independent volume. Where the water is level (at rest), L · A(h) is exact, and the getter can be checked there.
// Reports, at every sample: getter against L·A(link depth) (expected equal: the circularity, shown); getter against the
// end-depth bracket; at rest, getter against the exact L·A(h). Writes diagnostics/out/c1b-linkvol.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadSWMM } from '../../../src/swmm.js';
import { options } from '../lib/swmm-run.mjs';
import { area } from '../references/geometry.mjs';
import * as V from '../references/volume.mjs';

const C1 = JSON.parse(readFileSync(new URL('../spec/PV-C1.json', import.meta.url)));
const P = Object.fromEntries(Object.entries(C1.parameters).map(([k, v]) => [k, v.value]));
const tanks = P.tanksPartFull, s = { shape: 'circle', D: P.pipeDiameter }, L = P.pipeLength;
const engPath = new URL('../../culvert/instrumented/out/swmm.mjs', import.meta.url);
const e = await loadSWMM(pathToFileURL(engPath.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);
const inp = [options({ durationS: P.durationS, step: P.routingStepS, surcharge: 'EXTRAN' }),
  '[STORAGE]', ...tanks.map(t => `${t.name} 0 ${P.tankDepth} ${t.h0} FUNCTIONAL 0 0 ${t.A} 0 0`), '',
  '[OUTFALLS]', 'OUT 0 FREE NO', '', '[CONDUITS]', `C1 ${tanks[0].name} ${tanks[1].name} ${L} ${P.manningN} 0 0 0 0`, '',
  '[WEIRS]', `W0 ${tanks[1].name} OUT TRANSVERSE ${P.sealCrest} 1.84 NO 0 0`, '',
  '[XSECTIONS]', `C1 CIRCULAR ${P.pipeDiameter} 0 0 0 1`, `W0 RECT_OPEN 0.3 1 0 0`, ''].join('\n');
e.open(inp);
const iT = tanks.map(t => e.index('NODE', t.name)), iC = e.index('LINK', 'C1');
const rows = [];
let worstCirc = 0, outside = 0, worstOutside = 0;
while (e.t < P.durationS - 1e-6) {
  const t0 = e.t; e.stepTo(Math.min(P.durationS, e.t + 60)); if (e.t <= t0) break;
  const d = iT.map(i => e.node('DEPTH', i)), y = e.link('DEPTH', iC), vGet = e._getValue(420, iC);
  const vEst = V.conduitVolumeEstimate(s, L, Math.min(P.pipeDiameter, y)), b = V.conduitVolumeBounds(s, L, d[0], d[1]);
  worstCirc = Math.max(worstCirc, Math.abs(vGet - vEst) / Math.max(vEst, 1e-12));
  if (vGet < b.lo - 1e-9 || vGet > b.hi + 1e-9) { outside++; worstOutside = Math.max(worstOutside, Math.max(b.lo - vGet, vGet - b.hi)); }
  if (rows.length < 5 || Math.round(e.t) % 3600 === 0) rows.push({ t: Math.round(e.t), d, y, getter: vGet, estimate: vEst, lo: b.lo, hi: b.hi });
}
const last = rows.at(-1), hEnd = 0.5 * (last.d[0] + last.d[1]), exactRest = L * area(s, hEnd);
e.finish();
const out = { written: new Date().toISOString(), engine: 'benchmarks/culvert/instrumented/out/swmm.mjs (getter 420)',
  inMotion: { worstRelGetterVsEstimate: worstCirc, samplesOutsideEndDepthBracket: outside, worstOutsideM3: worstOutside,
    reading: 'getter = L·A(mean end depth): the same quantity as the PV-C1-b estimate; not independent' },
  atRest: { levelDiffM: Math.abs(last.d[0] - last.d[1]), getter: last.getter, exact: exactRest, relErr: (last.getter - exactRest) / exactRest },
  samples: rows };
mkdirSync(new URL('out/', import.meta.url), { recursive: true });
writeFileSync(new URL('out/c1b-linkvol.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ inMotion: out.inMotion, atRest: out.atRest }, null, 1));
