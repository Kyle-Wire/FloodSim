// The physics verification suite's reference self-tests (benchmarks/physics/references/refs.test.mjs), run with the
// unit tests so a change that breaks a reference, or a reference that starts importing src/, is caught at once.
// Usage: node tests/run-physicsrefs-tests.mjs
import { selfTest } from '../benchmarks/physics/references/refs.test.mjs';

const r = selfTest();
for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.ok ? '  ' + c.detail : ''}`);
console.log(r.ok ? `\nall ${r.checks.length} reference self-tests passed` : `\n${r.checks.filter(c => !c.ok).length} FAILED`);
process.exit(r.ok ? 0 : 1);
