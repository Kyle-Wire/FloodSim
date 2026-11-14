// Behavioural agreement of the instrumented build with production, on B1 ONLY.
// Runs b1-inlet.mjs with the instrumented engine (FLOODSIM_SWMM_MJS), writing to ./b1/ (FLOODSIM_BENCH_OUT), and
// with the production engine, writing to ./b1-production/ (so results/b1-inlet.json is never touched), then compares
// every number in the two result files. Also checks the instrumentation itself: the link-volume getter on a pipe held
// full, against (π D²/4) L.
// What this establishes, and what it does not: identical B1 numbers mean the two engines behave the same ON B1. They
// do not show the builds are identical (the production compiler version was never recorded), nor agreement elsewhere.
//
//   node benchmarks/culvert/instrumented/compare-b1.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), b1 = path.resolve(here, '../b1-inlet.mjs');
const run = (outDir, engine) => {
  const env = { ...process.env, FLOODSIM_BENCH_OUT: outDir }; if (engine) env.FLOODSIM_SWMM_MJS = engine; else delete env.FLOODSIM_SWMM_MJS;
  const r = spawnSync(process.execPath, [b1], { env, encoding: 'utf8', maxBuffer: 1 << 26 });
  fs.writeFileSync(path.join(outDir, 'stdout.txt'), r.stdout + r.stderr); return r.status;
};
const I = path.join(here, 'b1'), P = path.join(here, 'b1-production');
for (const d of [I, P]) fs.mkdirSync(d, { recursive: true });
const ei = run(I, path.join(here, 'out', 'swmm.mjs')), ep = run(P, null);
const a = JSON.parse(fs.readFileSync(path.join(I, 'b1-inlet.json'))), b = JSON.parse(fs.readFileSync(path.join(P, 'b1-inlet.json')));
// every leaf, by path
const leaves = (o, p = '', acc = {}) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) leaves(v, `${p}/${k}`, acc); else acc[p] = o; return acc; };
const la = leaves(a), lb = leaves(b), keys = new Set([...Object.keys(la), ...Object.keys(lb)]), diffs = [];
let numbers = 0, maxAbs = 0;
for (const k of keys) {
  if (/\/swmm$|version/i.test(k)) continue; // the engine's own version stamp is compared separately
  const x = la[k], y = lb[k];
  if (typeof x === 'number' && typeof y === 'number') { numbers++; const d = Math.abs(x - y); maxAbs = Math.max(maxAbs, d); if (d !== 0) diffs.push({ k, instrumented: x, production: y }); }
  else if (x !== y) diffs.push({ k, instrumented: x, production: y });
}
// the getter: a 0.9 m pipe, 100 m long, held full under a pool on both ends
const { loadSWMM } = await import('../../../src/swmm.js');
const eng = await loadSWMM((await import('node:url')).pathToFileURL(path.join(here, 'out', 'swmm.mjs')).href);
const inp = ['[OPTIONS]', 'FLOW_UNITS CMS', 'FLOW_ROUTING DYNWAVE', 'START_DATE 01/01/2000', 'START_TIME 00:00:00', 'END_DATE 01/01/2000', 'END_TIME 00:10:00', 'ROUTING_STEP 1', 'SURCHARGE_METHOD EXTRAN', '',
  '[STORAGE]', 'T1 0 5 2 FUNCTIONAL 0 0 50 0 0', '', '[OUTFALLS]', 'O 0 FIXED 2 NO', '', '[CONDUITS]', 'C1 T1 O 100 0.013 0 0 0 0', '', '[XSECTIONS]', 'C1 CIRCULAR 0.9 0 0 0 1', ''].join('\n');
eng.open(inp); eng.stepTo(300); const vol = eng._getValue(420, eng.index('LINK', 'C1')); // property 420: the instrumented LINK_VOLUME (src/swmm.js has no name for it, and is not changed) eng.finish();
const want = Math.PI / 4 * 0.81 * 100;
const report = { written: new Date().toISOString(), exit: { instrumented: ei, production: ep }, swmmVersion: { instrumented: a.swmm, production: b.swmm },
  numbersCompared: numbers, differing: diffs.length, maxAbsDiff: maxAbs, diffs: diffs.slice(0, 50),
  getter: { linkVolumeFullPipe: vol, expected: want, relErr: (vol - want) / want },
  scope: 'behavioural agreement on B1 only; not evidence that the builds are identical, nor of agreement on any other benchmark' };
fs.writeFileSync(path.join(here, 'COMPARE-B1.json'), JSON.stringify(report, null, 1));
console.log(`B1, instrumented against production: ${numbers} numbers compared, ${diffs.length} differ (max |Δ| ${maxAbs}); exit ${ei} / ${ep}`);
console.log(`getter: link volume of a full 0.9 m × 100 m pipe ${vol} m³ (π D²/4 L = ${want.toFixed(4)})`);
console.log(report.scope);
