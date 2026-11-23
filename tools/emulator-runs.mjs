// Run an emulator study's solver runs headless: a list of points, each a scenario and the emulator-run overrides of
// app/map.js (ari, rain, inflow, tide, se, design: { '<id>.<prop>': value }), run one after another in one page with the
// machine's GPU, each saved to the project's runs folder with its ground (grids/ground.f32), as the Emulator drawer's own
// training runs are. A study cut short carries on where it stopped: done points are kept in <points>.done.json.
//
// Usage: node tools/emulator-runs.mjs "<project folder>" <points.json> [--url http://localhost:8766] [--retries 3] [--headed] [--dry]
//   points.json  [{ id, scenario: null | "<scenario name>", over: { ari, se, design: { … } }, label }]
//   --dry        open the project, print the parameters on offer and each scenario's build log (warnings), run nothing
// After each run, the run's summary.json must name the point's scenario (a scenario that could not be read runs
// existing conditions under its label); a run that does not is a failure, not a result.
// Exit code 0 when every point is done, 1 otherwise.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, freePort, waitForOutput, killTree, sleep } from './headless.mjs';
import { projectsDir } from './suite.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const VALUED = new Set(['--url', '--retries']), pos = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
const [folder, pointsFile] = pos;
if (!folder || !pointsFile) { console.error('Usage: node tools/emulator-runs.mjs "<project folder>" <points.json> [--url …] [--retries 3] [--headed] [--dry]'); process.exit(1); }
const retries = Number(opt('retries', 3)), headed = argv.includes('--headed'), dry = argv.includes('--dry');
const points = JSON.parse(readFileSync(pointsFile, 'utf8')), doneFile = pointsFile.replace(/\.json$/, '') + '.done.json';
const done = existsSync(doneFile) ? JSON.parse(readFileSync(doneFile, 'utf8')) : {};
const stamp = () => new Date().toLocaleTimeString();

let server = null, page = null;
async function finish(code, msg) { if (msg) console.error(msg); await page?.close().catch(() => {}); killTree(server); process.exit(code); }
process.on('SIGINT', () => finish(130, 'interrupted (done points are kept; run again to carry on)'));
let base = opt('url')?.replace(/\/+$/, '');
if (!base) {
  const port = await freePort();
  server = spawn(process.execPath, [join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  base = `http://localhost:${port}`;
}
console.log(`${stamp()}  project "${folder}" on ${base}: ${points.length} points, ${Object.keys(done).length} done`);

const t0 = Date.now();
for (let attempt = 0; attempt <= retries; attempt++) {
  const todo = points.filter(p => !done[p.id]);
  if (!todo.length) break;
  if (attempt) console.log(`${stamp()}  relaunching the browser (${attempt} of ${retries})`);
  page = await openBrowser({ headed, onConsole: (line, type) => { if (type === 'error' || type === 'exception' || /GPU error|device lost/i.test(line)) console.log(`${stamp()}  ${line}`); } });
  await page.navigate(`${base}/app/map.html?project=${encodeURIComponent(folder)}`);
  let opened = null;
  while (!opened && !page.crashed()) { await sleep(2000); opened = await page.evaluate('window.__batchDone ?? null').catch(() => null); }
  if (!opened?.ok) { const why = page.crashed() ?? opened?.error; await page.close(); page = null; console.log(`${stamp()}  opening failed: ${why}`); if (/^Build failed/.test(why ?? '')) await sleep(600e3); continue; }
  if (dry) {
    const scs = [...new Set(points.map(p => p.scenario))];
    for (const sc of scs) {
      const info = await page.evaluate(`(() => { const F = window.__floodsim, sc = ${JSON.stringify(sc)}; const log = sc ? F.designLog(sc, null) : null;
        return { params: F.emuParams(sc), log: log && { features: log.features.map(l => ({ id: l.id, type: l.type, name: l.name, cells: l.cells, warnings: l.warnings, notes: l.notes, resolved: l.resolved })), totals: log.totals } }; })()`);
      console.log(`scenario ${sc ?? '(existing conditions)'}:\n${JSON.stringify(info, null, 1)}`);
    }
    await finish(0);
  }
  for (const p of todo) {
    if (page.crashed()) break;
    const t = Date.now();
    const key = '__emuRun_' + p.id;
    await page.evaluate(`window[${JSON.stringify(key)}] = null; window.__floodsim.runAt(${JSON.stringify(p.scenario ?? null)}, ${JSON.stringify(p.over ?? {})}, ${JSON.stringify(p.label ?? p.id)})
      .then(r => { window[${JSON.stringify(key)}] = { ok: true, dir: r.dir, wall: r.wall }; }, e => { window[${JSON.stringify(key)}] = { ok: false, error: String(e?.message ?? e) }; }); true`);
    let r = null;
    while (!r && !page.crashed()) { await sleep(2000); r = await page.evaluate(`window[${JSON.stringify(key)}]`).catch(() => null); }
    if (!r) break; // crashed: relaunch and carry on
    if (!r.ok) { console.log(`${stamp()}  ${p.id} FAILED: ${r.error}`); continue; }
    const summary = JSON.parse(readFileSync(join(projectsDir, folder, 'runs', r.dir, 'summary.json'), 'utf8'));
    const ran = summary.scenario?.name ?? summary.scenario ?? null;
    if ((ran ?? null) !== (p.scenario ?? null)) { console.log(`${stamp()}  ${p.id} FAILED: ran as scenario ${JSON.stringify(ran)}, not ${JSON.stringify(p.scenario)}`); continue; }
    done[p.id] = { dir: r.dir, wall: r.wall, seconds: (Date.now() - t) / 1000, scenario: ran, storm: summary.storm?.label ?? null, commit: summary.commit ?? null };
    writeFileSync(doneFile, JSON.stringify(done, null, 1));
    console.log(`${stamp()}  ${p.id} → runs/${r.dir} (${((Date.now() - t) / 1000).toFixed(0)} s; ${Object.keys(done).length} of ${points.length})`);
  }
  await page.close(); page = null;
}
const left = points.filter(p => !done[p.id]).length;
console.log(`${stamp()}  ${points.length - left} of ${points.length} points done in ${((Date.now() - t0) / 3600e3).toFixed(2)} h`);
await finish(left ? 1 : 0);
