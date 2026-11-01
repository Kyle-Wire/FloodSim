// Fails if package.json declares a test script that no workflow runs.
//
// This exists because the gap it guards is exactly how FloodSim got here: tests/run-tests.mjs was written,
// committed, and then never asserted or run by anything for as long as the repository existed. A merge gate
// that silently stops covering a suite is worse than no gate, because it still reports green.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => { try { return readFileSync(root + p, 'utf8'); } catch { return ''; } };

// Scripts deliberately not run by any workflow, each with the reason it is exempt. Anything not listed here
// and not invoked by a workflow is a failure.
const EXEMPT = {
  'test:live': 'hits the real 3DEP / OSM / SSURGO services: rate-limited, and a third-party outage must not ' +
    'turn a code merge gate red. Run by hand when the ingest paths change.',
};

const scripts = Object.keys(JSON.parse(read('package.json')).scripts ?? {}).filter(s => s === 'test' || s.startsWith('test:'));
const workflows = ['.github/workflows/ci.yml', '.github/workflows/nightly-gpu.yml'].map(read).join('\n');

// Match only whole invocations, so "npm run test" does not appear to be satisfied by "npm run test:phase1".
const invoked = new Set();
for (const m of workflows.matchAll(/^\s*(?:-\s*run:\s*)?npm run ([A-Za-z0-9:_-]+)/gm)) invoked.add(m[1]);
// The core suite is invoked directly as a file rather than through npm, to keep its failure unambiguous.
if (/node tests\/run-tests\.mjs/.test(workflows)) invoked.add('test');

const missing = scripts.filter(s => !invoked.has(s) && !(s in EXEMPT));
if (missing.length) {
  console.error('These test scripts are not run by any workflow:\n  ' + missing.join('\n  '));
  console.error('\nAdd each to .github/workflows/ci.yml (CPU) or nightly-gpu.yml (needs a real GPU),');
  console.error('or add it to EXEMPT in this file with the reason it should never run in CI.');
  process.exit(1);
}

const exempt = scripts.filter(s => s in EXEMPT);
console.log(`${scripts.length} test scripts: ${scripts.length - exempt.length} run by a workflow, ${exempt.length} exempt`);
for (const s of exempt) console.log(`  exempt  ${s} — ${EXEMPT[s]}`);
