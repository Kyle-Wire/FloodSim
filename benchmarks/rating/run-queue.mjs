// Runs RT-1 projects one after another in a visible Chrome/Edge window (tools/headless.mjs, headed, no background
// throttling), clicking Run once per project, printing the app's log as it goes, and scoring each run when it is filed.
//   node benchmarks/rating/run-queue.mjs "RT-1 08183978 B" "RT-1 06709530 A" … [--url http://localhost:8768]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openBrowser, freePort, waitForOutput, killTree, sleep } from '../../tools/headless.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const projectsDir = process.env.FLOODSIM_PROJECTS || path.join(homedir(), 'Documents', 'FloodSim Projects');
const argv = process.argv.slice(2), ui = argv.indexOf('--url');
let base = ui >= 0 ? argv[ui + 1] : null;
const queue = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--url');
const stamp = () => new Date().toLocaleTimeString();
const say = (s) => console.log(`${stamp()}  ${s}`);

let server = null;
if (!base) {
  const port = await freePort();
  server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  base = `http://localhost:${port}`;
}
const page = await openBrowser({ headed: true, onConsole: (line, type) => { if (type === 'error' || type === 'exception' || /GPU error|device lost/i.test(line)) say(`[page] ${line}`); } });
const runsOf = (p) => { const d = path.join(projectsDir, p, 'runs'); return fs.existsSync(d) ? fs.readdirSync(d).filter(x => /^2/.test(x)) : []; };

for (const p of queue) {
  const before = new Set(runsOf(p));
  say(`${p}: opening`);
  await page.navigate(`${base}/app/map.html?project=${encodeURIComponent(p)}`);
  // Configuration B carves the channel after the project opens, and that resets the run: a click before it is lost.
  const carves = / B$/.test(p);
  for (let i = 0; ; i++) {
    if (await page.evaluate(`!!(window.__floodsim?.run && document.getElementById('runBtn') && !document.getElementById('runBtn').disabled)
      && (${!carves} || [...document.getElementById('log').children].some(e => /^Channel bathymetry/.test(e.textContent)))`)) break;
    if (i > 600) throw new Error(`${p}: not ready after 10 min`);
    await sleep(1000);
  }
  await sleep(5000);
  await page.evaluate(`document.getElementById('runBtn').click(), 1`);
  say(`${p}: Run clicked`);
  // the run must show it started within 10 min: a fill line (one per simulated hour) or the clock running
  const started = async () => page.evaluate(`window.__floodsim.run?.playing || [...document.getElementById('log').children].some(e => /^Fill: /.test(e.textContent))`).catch(() => false);
  for (let i = 0; i < 20 && !(await started()); i++) await sleep(30e3);
  if (!(await started())) throw new Error(`${p}: no fill progress or running clock 10 min after Run`);
  let seen = 0, filed = null;
  for (;;) {
    await sleep(30e3);
    if (page.crashed()) throw new Error(`${p}: ${page.crashed()}`);
    const log = await page.evaluate(`[...document.getElementById('log').children].map(e => e.textContent.slice(0, 220))`).catch(() => []);
    for (const l of log.slice(seen)) if (/Fill|steady|River inflow|error|failed|Saved|filed|run/i.test(l)) say(`  ${l}`);
    seen = Math.max(seen, log.length);
    const t = await page.evaluate(`window.__floodsim.run?.t ?? 0`).catch(() => 0);
    if (t > 0 && Math.floor(t / 3600) !== Math.floor((t - 30 * 40) / 3600)) say(`  model time ${(t / 3600).toFixed(1)} h`);
    const fresh = runsOf(p).filter(d => !before.has(d)).sort().at(-1);
    if (fresh) {
      const d = path.join(projectsDir, p, 'runs', fresh), s = path.join(d, 'summary.json');
      if (fs.existsSync(path.join(d, 'gauge_cells.json')) && fs.existsSync(s) && Date.now() - fs.statSync(s).mtimeMs > 15e3) { filed = fresh; break; }
    }
  }
  say(`${p}: filed ${filed}`);
  const r = spawnSync(process.execPath, [path.join(root, 'benchmarks', 'rating', 'score.mjs'), p, '--run', filed], { encoding: 'utf8' });
  console.log(r.stdout + r.stderr);
}
say('queue done');
await page.close(); killTree(server); process.exit(0);
