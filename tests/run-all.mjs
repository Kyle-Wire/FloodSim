// Runs every CPU test suite (tests/run-tests.mjs and each tests/run-*-tests.mjs), offline, and exits 1 if any fails.
// The GPU suites need a browser and a GPU and are left to `npm run test:gpu`.
// Usage: node tests/run-all.mjs [--verbose]
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');
const suites = ['run-tests.mjs', ...readdirSync(dir).filter(f => /^run-.+-tests\.mjs$/.test(f) && !/gpu/.test(f)).sort()];

const failed = [];
for (const f of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(dir, f)], { cwd: join(dir, '..'), encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(28)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s`);
  if (verbose) console.log(out);
  else if (!ok) console.log(out.split('\n').filter(l => /FAIL|Error|error/.test(l)).slice(0, 20).map(l => '      ' + l).join('\n') || out.slice(-2000));
  if (!ok) failed.push(f);
}
console.log(failed.length ? `\n${failed.length} of ${suites.length} suites FAILED: ${failed.join(', ')}` : `\nall ${suites.length} suites passed`);
process.exit(failed.length ? 1 : 0);
