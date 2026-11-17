// Street sandbox, browser executor: runs cases on the production GPU solver in headless Chrome or Edge (WebGPU) and
// writes each raw record to street/raw/<stamp>/<case>.gpu.json. No npm dependencies (tools/headless.mjs).
//   node benchmarks/physics/street/run-browser.mjs --cases SS1-a,SS6-drive-4s [--stamp <name>] [--headed] [--timeout 30]
//   node benchmarks/physics/street/run-browser.mjs --spec PV-SS6
//   node benchmarks/physics/street/run-browser.mjs              every case
// Then node benchmarks/physics/run.mjs --only PV-SS1,… scores the latest raw file of each case.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBrowser, freePort, waitForOutput, killTree } from '../../../tools/headless.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const args = process.argv.slice(2), opt = (n) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : null);
const port = await freePort();
const server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser = null, code = 0;
try {
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  const problems = [];
  browser = await openBrowser({ headed: args.includes('--headed'), onConsole: (line, type) => { if (/GPU error|No WebGPU adapter|PAGE EXCEPTION/.test(line)) problems.push(line); if (type !== 'log' || /^\s/.test(line)) console.log(type === 'log' ? line : `[${type}] ${line}`); } });
  await browser.navigate(`http://localhost:${port}/benchmarks/physics/street/run.html`);
  await browser.evaluate(`new Promise((ok, fail) => { const until = Date.now() + 60000; (function w() { if (window.__ready) return ok(true); if (Date.now() > until) return fail(new Error('run.html did not get ready')); setTimeout(w, 100); })(); })`);
  const adapter = await browser.evaluate('window.__adapter()'); if (!adapter) throw new Error('No WebGPU adapter in the browser');
  console.log('adapter:', JSON.stringify(adapter));
  const all = await browser.evaluate('window.__cases()'), spec = opt('spec');
  const ids = opt('cases') ? opt('cases').split(',') : spec ? all.filter(id => id.startsWith(spec.replace('PV-', '') + '-')) : all;
  const stamp = opt('stamp') ?? new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(here, 'raw', stamp); fs.mkdirSync(dir, { recursive: true });
  const timeout = Number(opt('timeout') ?? 30) * 60e3;
  for (const id of ids) {
    const file = path.join(dir, `${id}.gpu.json`); if (fs.existsSync(file)) { console.log(`${id}: ${file} exists, not overwritten`); continue; }
    const json = await Promise.race([browser.evaluate(`window.__runCase(${JSON.stringify(id)})`), new Promise((_, fail) => setTimeout(() => fail(new Error(`${id}: no result in ${timeout / 60e3} min`)), timeout))]).catch(e => { problems.push(`${id}: ${e.message}`); return null; });
    if (browser.crashed()) throw new Error(browser.crashed());
    if (!json) { console.log(`${id}: FAILED ${problems.at(-1)}`); code = 1; continue; }
    const r = JSON.parse(json); fs.writeFileSync(file, json); fs.chmodSync(file, 0o444);
    console.log(`${id}: ${r.grid.nx}×${r.grid.ny} @ ${r.grid.dx} m${r.grid.subgrid ? ' subgrid' : ''}, ${r.steps} steps, ${r.wallSeconds.toFixed(1)} s, surface books ${r.mass.rel.toExponential(1)} → raw/${stamp}/${id}.gpu.json`);
  }
  if (problems.length) { console.log('problems:\n  ' + problems.join('\n  ')); code = 1; }
} catch (e) { console.error('runner error: ' + (e?.stack ?? e)); code = 1; }
finally { await browser?.close(); killTree(server); }
process.exit(code);
