// The physics verification runner (generalised from benchmarks/culvert/run-all.mjs).
//   node benchmarks/physics/run.mjs              run every spec; write results/<run-id>/ (new, then read-only)
//   node benchmarks/physics/run.mjs --only PV-C1 run one spec (and what it depends on)
//   node benchmarks/physics/run.mjs --hash       print each spec's criteria hash (for a revision entry), run nothing
// Order: the reference self-tests (a failure stops the run); spec validation (a criteria change without a revision
// entry stops the run); each benchmark; then the result files, MANIFEST.json and SHA256SUMS, made read-only. A run
// directory is never overwritten. Statuses are counted by status and by error type, never merged into one percentage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selfTest } from './references/refs.test.mjs';
import { criteriaHash, tally, STATUSES } from './lib/score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex'), shaF = (f) => sha(fs.readFileSync(f));
const relp = (f) => path.relative(root, f).replace(/\\/g, '/');
const REQUIRED = ['id', 'title', 'category', 'process', 'module', 'executor', 'equations', 'initialConditions', 'boundaryConditions', 'geometry', 'parameters', 'solver', 'reference', 'outputs', 'criteria', 'conservation', 'resolution', 'assumptions', 'limitations', 'validRange', 'scoring', 'criteriaRevisions'];

const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const specs = Object.fromEntries(fs.readdirSync(path.join(here, 'spec')).filter(f => /^PV-.*\.json$/.test(f)).map(f => { const s = JSON.parse(fs.readFileSync(path.join(here, 'spec', f))); return [s.id, { ...s, _file: path.join(here, 'spec', f) }]; }));
if (args.includes('--hash')) { for (const s of Object.values(specs)) console.log(s.id, criteriaHash(s.criteria)); process.exit(0); }

// 1. references
const st = selfTest();
if (!st.ok) { for (const c of st.checks.filter(c => !c.ok)) console.log('FAIL ', c.name, c.detail); console.log('reference self-tests failed: run stopped'); process.exit(2); }
console.log(`references: ${st.checks.length} self-tests passed${st.observations.length ? `, ${st.observations.length} observations recorded` : ''}`);

// 2. specs
let bad = 0;
for (const s of Object.values(specs)) {
  const missing = REQUIRED.filter(k => s[k] == null); if (missing.length) { console.log(`${s.id}: missing ${missing.join(', ')}`); bad++; }
  for (const [k, v] of Object.entries(s.parameters ?? {})) if (v.value === undefined || v.unit === undefined) { console.log(`${s.id}: parameter ${k} needs value and unit`); bad++; }
  const last = s.criteriaRevisions?.at(-1), h = criteriaHash(s.criteria);
  if (!last || last.hash !== h) { console.log(`${s.id}: criteria hash ${h} does not match its latest revision entry (${last?.hash || 'none'}): add a dated revision with its justification`); bad++; }
}
if (bad) { console.log('spec validation failed: run stopped'); process.exit(3); }

// 3. benchmarks (dependencies first)
const order = []; const add = (id) => { if (order.includes(id)) return; for (const d of specs[id].dependsOn ?? []) add(d); order.push(id); };
for (const id of only ? [only] : Object.keys(specs).sort()) add(id);
const results = {}, timing = {};
for (const id of order) {
  const s = specs[id], t0 = Date.now();
  const mod = await import(pathToFileURL(path.join(here, s.module)).href);
  results[id] = await mod.run(s, specs);
  timing[id] = +((Date.now() - t0) / 1000).toFixed(1);
  const t = tally(results[id].rows);
  console.log(`${id.padEnd(6)} ${s.title}  (${timing[id]} s)  ${JSON.stringify(t.byStatus)}${t.deliberateFaults.rows ? `  faults caught ${t.deliberateFaults.caught}/${t.deliberateFaults.rows}` : ''}`);
}

// 4. results, manifest, hashes
const runId = new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(here, 'results', runId);
if (fs.existsSync(dir)) { console.log('run directory exists: refusing to overwrite'); process.exit(4); }
fs.mkdirSync(dir, { recursive: true });
const seen = new Set(), walk = (f) => { if (seen.has(f) || !fs.existsSync(f)) return; seen.add(f); for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.resolve(path.dirname(f), m[1])); };
walk(fileURLToPath(import.meta.url)); for (const id of order) walk(path.join(here, specs[id].module));
const inputs = [...seen].map(relp).concat(['vendor/swmm-wasm/swmm.wasm', 'vendor/swmm-wasm/swmm.mjs']).filter((f, i, a) => a.indexOf(f) === i).sort();
const git = (a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return null; } };
const status = git(['status', '--porcelain']) ?? '';
const all = order.flatMap(id => results[id].rows), rowsBad = all.filter(r => !STATUSES.includes(r.status));
const summary = { runId, order, timing, counts: Object.fromEntries(order.map(id => [id, tally(results[id].rows)])), overall: tally(all), invalidStatuses: rowsBad.length };
const manifest = {
  runId, written: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`,
  git: { commit: git(['rev-parse', 'HEAD'])?.trim() ?? null, dirty: status.trim().length > 0, diffSha256: sha(git(['diff', 'HEAD']) ?? ''), statusSha256: sha(status) },
  swmm: { version: Object.values(results).flatMap(r => Object.values(r.cases ?? {})).find(c => c?.swmmVersion)?.swmmVersion ?? null, wasmSha256: shaF(path.join(root, 'vendor/swmm-wasm/swmm.wasm')) },
  specs: Object.fromEntries(order.map(id => [id, { file: relp(specs[id]._file), sha256: shaF(specs[id]._file), criteriaSha256: criteriaHash(specs[id].criteria), criteriaRevision: specs[id].criteriaRevisions.at(-1).revision }])),
  references: { selfTests: st.checks.length, observations: st.observations },
  inputs: Object.fromEntries(inputs.map(f => [f, shaF(path.join(root, f))])),
};
for (const id of order) fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, spec: relp(specs[id]._file), ...results[id] }, null, 1));
fs.writeFileSync(path.join(dir, 'SUMMARY.json'), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
const files = fs.readdirSync(dir).sort();
fs.writeFileSync(path.join(dir, 'SHA256SUMS'), files.map(f => `${shaF(path.join(dir, f))} *${f}`).join('\n') + '\n');
for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o444);

console.log(`\nresults/${runId}/ written (read-only)`);
console.log('by status:', JSON.stringify(summary.overall.byStatus));
console.log('by error type:', JSON.stringify(summary.overall.byErrorTypeAndStatus));
console.log(`deliberate faults caught: ${summary.overall.deliberateFaults.caught}/${summary.overall.deliberateFaults.rows}`);
for (const r of all) console.log(`  ${r.status.padEnd(28)} ${r.benchmark.padEnd(6)} ${String(r.case).padEnd(32)} ${r.errorType.padEnd(15)} ${r.quantity}: ref ${fmt(r.ref)} sim ${fmt(r.sim)}${r.limit != null ? ` |Δ| ${fmt(Math.abs(r.abs))} ≤ ${fmt(r.limit)}?` : ''}${r.expected ? ` [expected ${r.expected}: ${r.caught ? 'caught' : 'NOT CAUGHT'}]` : ''}`);
function fmt(v) { return v == null ? '—' : typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : v.toFixed(4); }
const notCaught = summary.overall.deliberateFaults.rows - summary.overall.deliberateFaults.caught;
process.exit(notCaught || rowsBad.length ? 1 : 0); // a scorer that misses a deliberate fault fails the run; physics failures are results, not a runner error
