// Run a project's batch study headless: the study planned in the app's Batch drawer (batch.json in the project folder)
// runs job after job in headless Chrome/Edge with the machine's GPU, each run filed in the project as the app files it.
// A crash (the browser, the GPU process, the machine) loses at most the last checkpoint interval: run this again, or let
// it relaunch the browser itself (--retries), and the study carries on with the job under way from its checkpoint.
//
// Usage: node tools/batch.mjs "<project folder>" [--url http://localhost:8766] [--retries 3] [--hours 0] [--headed]
//   <project folder>  the folder's name under the projects directory (Documents/FloodSim Projects, or FLOODSIM_PROJECTS)
//   --url      reuse a running FloodSim server (default: start server/server.mjs on a free port)
//   --retries  relaunches after a browser or GPU crash (default 3)
//   --hours    give up after this many hours (default 0: no limit)
//   --headed   show the browser window
// Exit code 0 when every job is done, 1 when any failed or the study could not finish.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, freePort, waitForOutput, killTree, sleep } from './headless.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const VALUED = new Set(['--url', '--retries', '--hours']), folder = argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
if (!folder) { console.error('Usage: node tools/batch.mjs "<project folder>" [--url …] [--retries 3] [--hours 0] [--headed]'); process.exit(1); }
const retries = Number(opt('retries', 3)), hours = Number(opt('hours', 0)), headed = argv.includes('--headed');

let server = null, page = null;
const stamp = () => new Date().toLocaleTimeString();
async function finish(code, msg) { if (msg) console.error(msg); await page?.close().catch(() => {}); killTree(server); process.exit(code); }
process.on('SIGINT', () => finish(130, 'interrupted (the study resumes from its last checkpoint next time)'));
if (hours > 0) setTimeout(() => finish(1, `gave up after ${hours} h (the study resumes from its last checkpoint next time)`), hours * 3600e3).unref();

let base = opt('url')?.replace(/\/+$/, '');
if (!base) {
  const port = await freePort();
  server = spawn(process.execPath, [join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  base = `http://localhost:${port}`;
}
console.log(`${stamp()}  project "${folder}" on ${base}${server ? ' (server started here)' : ''}`);

const t0 = Date.now();
for (let attempt = 0; attempt <= retries; attempt++) {
  if (attempt) console.log(`${stamp()}  relaunching the browser (${attempt} of ${retries}): the job under way resumes from its checkpoint`);
  page = await openBrowser({ headed, onConsole: (line, type) => { if (/^\[batch\]/.test(line) || type === 'error' || type === 'exception' || /GPU error|device lost/i.test(line)) console.log(`${stamp()}  ${line}`); } });
  await page.navigate(`${base}/app/map.html?project=${encodeURIComponent(folder)}&batch=run`);
  let done = null;
  while (!done && !page.crashed()) {
    await sleep(2000);
    done = await page.evaluate('window.__batchDone ?? null').catch(() => null);
  }
  const why = page.crashed();
  await page.close(); page = null;
  if (done) {
    if (!done.ok) await finish(1, `FAILED: ${done.error}`);
    if (!done.study) await finish(1, `No study in "${folder}": plan one in the app's Batch drawer and Start it (or save it), then run this again.`);
    const jobs = done.study.jobs, n = (s) => jobs.filter(j => j.status === s).length, h = ((Date.now() - t0) / 3600e3).toFixed(2);
    console.log(`\n${stamp()}  ${n('done')} of ${jobs.length} runs done in ${h} h${n('failed') ? `, ${n('failed')} failed:` : ''}`);
    for (const j of jobs.filter(j => j.status === 'failed')) console.log(`  ${j.label}: ${j.error}`);
    for (const j of jobs.filter(j => j.status === 'done')) console.log(`  ${j.label} → runs/${j.dir}`);
    await finish(n('done') === jobs.length ? 0 : 1);
  }
  console.log(`${stamp()}  ${why}`);
}
await finish(1, `FAILED: the browser crashed ${retries + 1} times`);
