// Runs the three Gate C coupled cases (benchmarks/gatec/coupled: benchmark1d2d A12-010, -011, -012, exact answers) on
// this checkout's code in headless Chrome or Edge, in both exchange modes, and files each result under
// street/gatec-check/<stamp>/. It does not write benchmarks/gatec/results, so the filed Gate C results stay as they are.
//   node benchmarks/physics/street/gatec-check.mjs [--stamp <name>]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBrowser, freePort, waitForOutput, killTree } from '../../../tools/headless.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const args = process.argv.slice(2), opt = (n) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : null);
const port = await freePort(), server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser = null, code = 0;
try {
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  const problems = [];
  browser = await openBrowser({ onConsole: (line) => { if (/GPU error|No WebGPU adapter|PAGE EXCEPTION/.test(line)) { problems.push(line); console.log(line); } } });
  await browser.navigate(`http://localhost:${port}/benchmarks/physics/street/gatec-check.html`);
  await browser.evaluate(`new Promise((ok, fail) => { const until = Date.now() + 60000; (function w() { if (window.__ready) return ok(true); if (Date.now() > until) return fail(new Error('page did not get ready')); setTimeout(w, 100); })(); })`);
  console.log('adapter:', JSON.stringify(await browser.evaluate('window.__adapter()')));
  const stamp = opt('stamp') ?? new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(here, 'gatec-check', stamp); fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  if (args.includes('--diagnostic')) { // unscored: the two-way cases under other coupler settings, filed apart
    for (const id of ['A12-010', 'A12-011', 'A12-012']) for (const [name, o] of [['old-rule', { follow: false }], ['node-area-half', { nodeArea: 0.6 }]]) {
      const r = JSON.parse(await browser.evaluate(`window.__gatec(${JSON.stringify(id)}, true, ${JSON.stringify(o)})`));
      fs.writeFileSync(path.join(dir, `${id.toLowerCase()}-twoway-${name}.json`), JSON.stringify(r));
      console.log(`${id} two-way, ${name}: ` + r.scores.map(x => `${x.id} ${x.value.toFixed(4)}${x.ok ? '' : ' (outside)'}`).join('; ') + `; SWMM continuity ${r.books.swmmErrorPct} %`);
    }
    await browser.close(); killTree(server); process.exit(0);
  }
  for (const id of ['A12-010', 'A12-011', 'A12-012']) for (const twoWay of [false, true]) {
    const r = JSON.parse(await browser.evaluate(`window.__gatec(${JSON.stringify(id)}, ${twoWay})`));
    const file = path.join(dir, `${id.toLowerCase()}${twoWay ? '-twoway' : ''}.json`); fs.writeFileSync(file, JSON.stringify(r)); fs.chmodSync(file, 0o444);
    console.log(`${id} — ${r.exchange} (${r.wallSeconds.toFixed(0)} s)`);
    for (const x of r.scores) { console.log(`  ${x.ok ? 'PASS' : 'FAIL'}  ${x.what}: ${x.value.toFixed(4)} (exact ${x.expected}, ${x.tol})`); rows.push({ case: id, exchange: twoWay ? 'two-way' : 'spill at the rim', ...x }); if (!x.ok) code = 1; }
  }
  fs.writeFileSync(path.join(dir, 'scores.json'), JSON.stringify(rows, null, 1));
  console.log(`${rows.filter(x => x.ok).length} of ${rows.length} measures pass → street/gatec-check/${stamp}/`);
  if (problems.length) code = 1;
} catch (e) { console.error('runner error: ' + (e?.stack ?? e)); code = 1; }
finally { await browser?.close(); killTree(server); }
process.exit(code);
