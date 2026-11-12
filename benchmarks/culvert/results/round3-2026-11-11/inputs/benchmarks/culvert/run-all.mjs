// Runs every Stage B SWMM-alone benchmark and writes results/MANIFEST.json: the SHA-256 of the translation source, the
// benchmark definitions, the SWMM engine and each result file, with each benchmark's exit code and failure count. Two
// runs with the same manifest inputs give the same results. The first baseline is kept read-only in
// results/baseline-2026-11-11/.
//
//   node benchmarks/culvert/run-all.mjs [--reuse-long]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const BENCH = ['b1-inlet', 'b1-losses', 'b1-lowflow', 'b2-outlet', 'b6-sediment', 'b6-continuity', 'b7-transition', 'b7-steep', 'b8-coverage', 'b9-edwards', 't2-ellipse'], DIAGNOSTIC = new Set(['b1-losses', 'b1-lowflow', 'b6-continuity', 'b7-steep', 't2-ellipse']); // diagnostics report, they do not score
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rel = (f) => path.relative(root, f).replace(/\\/g, '/');
// every file the benchmarks load: this script, each benchmark, and everything they import by relative path, transitively
const seen = new Set(), walk = (f) => {
  if (seen.has(f) || !fs.existsSync(f)) return; seen.add(f);
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.resolve(path.dirname(f), m[1]));
};
for (const f of fs.readdirSync(here).filter(f => f.endsWith('.mjs'))) walk(path.join(here, f));
const inputs = [...[...seen].map(rel), 'vendor/swmm-wasm/swmm.wasm', 'vendor/swmm-wasm/swmm.mjs', 'src/network-real.js', 'src/assets.js'].filter((f, i, a) => a.indexOf(f) === i).sort();
const results = {};
// b7-steep runs about an hour (fixed 0.1 s steps over 9 h ramps). --reuse-long keeps its existing results (still hashed,
// and marked reused in the manifest) when its definition has not changed since they were written.
const LONG = new Set(['b7-steep']), reuse = process.argv.includes('--reuse-long');
for (const b of BENCH) {
  const resJ = path.join(here, 'results', `${b}.json`), defF = path.join(here, `${b}.mjs`);
  // newer than its definition AND every file the benchmarks load
  if (reuse && LONG.has(b) && fs.existsSync(resJ) && [defF, ...seen].every(f => fs.statSync(resJ).mtimeMs > fs.statSync(f).mtimeMs)) {
    results[b] = { reused: true, json: sha(resJ), txt: sha(path.join(here, 'results', `${b}.txt`)), traces: sha(path.join(here, 'results', `${b}-traces.json`)) };
    console.log(`${b.padEnd(14)} reused (results newer than the definition)`); continue;
  }
  const t0 = Date.now(), r = spawnSync(process.execPath, [path.join(here, `${b}.mjs`)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  fs.writeFileSync(path.join(here, 'results', `${b}.txt`), r.stdout + r.stderr);
  const failed = Number((r.stdout.match(/(\d+) FAILED/) ?? [])[1] ?? 0);
  results[b] = { exit: r.status, failed, seconds: +((Date.now() - t0) / 1000).toFixed(1), json: sha(path.join(here, 'results', `${b}.json`)), txt: sha(path.join(here, 'results', `${b}.txt`)) };
  const tr = path.join(here, 'results', `${b}-traces.json`); if (fs.existsSync(tr)) results[b].traces = sha(tr); // full time series
  console.log(`${b.padEnd(14)} exit ${r.status}  ${DIAGNOSTIC.has(b) ? 'diagnostic (not scored)' : failed ? failed + ' failed' : 'all scored checks passed'}  (${results[b].seconds} s)`);
}
const manifest = { written: new Date().toISOString(), node: process.version, inputs: Object.fromEntries(inputs.map(f => [f, sha(path.join(root, f))])), results };
fs.writeFileSync(path.join(here, 'results', 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
console.log('\nresults/MANIFEST.json written');
