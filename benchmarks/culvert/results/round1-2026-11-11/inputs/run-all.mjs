// Runs every Stage B SWMM-alone benchmark and writes results/MANIFEST.json: the SHA-256 of the translation source, the
// benchmark definitions, the SWMM engine and each result file, with each benchmark's exit code and failure count. Two
// runs with the same manifest inputs give the same results. The first baseline is kept read-only in
// results/baseline-2026-11-11/.
//
//   node benchmarks/culvert/run-all.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const BENCH = ['b1-inlet', 'b1-losses', 'b1-lowflow', 'b2-outlet', 'b6-sediment', 'b7-transition'], DIAGNOSTIC = new Set(['b1-losses', 'b1-lowflow']); // diagnostics report, they do not score
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
for (const b of BENCH) {
  const t0 = Date.now(), r = spawnSync(process.execPath, [path.join(here, `${b}.mjs`)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  fs.writeFileSync(path.join(here, 'results', `${b}.txt`), r.stdout + r.stderr);
  const failed = Number((r.stdout.match(/(\d+) FAILED/) ?? [])[1] ?? 0);
  results[b] = { exit: r.status, failed, seconds: +((Date.now() - t0) / 1000).toFixed(1), json: sha(path.join(here, 'results', `${b}.json`)), txt: sha(path.join(here, 'results', `${b}.txt`)) };
  console.log(`${b.padEnd(14)} exit ${r.status}  ${DIAGNOSTIC.has(b) ? 'diagnostic (not scored)' : failed ? failed + ' failed' : 'all scored checks passed'}  (${results[b].seconds} s)`);
}
const manifest = { written: new Date().toISOString(), node: process.version, inputs: Object.fromEntries(inputs.map(f => [f, sha(path.join(root, f))])), results };
fs.writeFileSync(path.join(here, 'results', 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
console.log('\nresults/MANIFEST.json written');
