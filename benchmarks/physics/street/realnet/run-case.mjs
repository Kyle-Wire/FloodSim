// Real-network check (task 1 of ../HANDOFF.md): run one validation case through the app's own batch path with the code
// of a chosen checkout, and keep what a run's summary.json does not: the coupler's volumes in each direction, the
// settings the coupler was built with (nodeArea, follow), the [OPTIONS] SWMM was given, and the app's run log.
//
// It does what tools/batch.mjs does (the checkout's own server/server.mjs, its tools/headless.mjs, the app opened with
// ?batch=run), plus a read-only probe of window.__floodsim.run, the app's console-debugging hook. Nothing under src/ or
// app/ is changed, in either checkout.
//
// Usage: node benchmarks/physics/street/realnet/run-case.mjs --case <id> --code <checkout root> --tag <tag>
//          --projects <dir> [--set id=value,id=value] [--retries 1]
//   --case      a case in benchmarks/validation/cases.json; its project.json (and analysis.geojson) is the input
//   --code      the FloodSim checkout whose server, app and solver run (a worktree at the commit to test)
//   --tag       the project folder is rnc-<case>-<tag>
//   --projects  the projects directory (FLOODSIM_PROJECTS for the server): kept apart from the user's own projects
//   --set       inputs changed from the case file (any app input id, e.g. swmmSurcharge=EXTRAN)
// A project folder that already holds a filed run is refused: results are never overwritten; use a new tag.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)), repo = resolve(here, '..', '..', '..', '..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const caseId = opt('case'), code = opt('code') && resolve(opt('code')), tag = opt('tag'), projects = opt('projects') && resolve(opt('projects'));
if (!caseId || !code || !tag || !projects) { console.error('Usage: run-case.mjs --case <id> --code <checkout> --tag <tag> --projects <dir> [--set id=v,…]'); process.exit(1); }
const retries = Number(opt('retries', 1));
const set = Object.fromEntries((opt('set', '') || '').split(',').filter(Boolean).map(kv => { const i = kv.indexOf('='); const v = kv.slice(i + 1); return [kv.slice(0, i), v === 'true' ? true : v === 'false' ? false : v]; }));

const { openBrowser, freePort, waitForOutput, killTree, sleep } = await import(pathToFileURL(join(code, 'tools', 'headless.mjs')).href);
const { expandJobs, VARIANTS } = await import(pathToFileURL(join(code, 'src', 'batch.js')).href);

// ---- the project: the case file, as tools/suite.mjs installCase would install it in an empty projects folder ----
const cas = JSON.parse(readFileSync(join(repo, 'benchmarks', 'validation', 'cases.json'), 'utf8')).find(c => c.id === caseId);
if (!cas) throw new Error(`no case ${caseId}`);
const folder = `rnc-${caseId}-${tag}`, dest = join(projects, folder), runs = join(dest, 'runs');
if (existsSync(runs) && readdirSync(runs).some(d => !d.startsWith('_') && existsSync(join(runs, d, 'summary.json')))) {
  console.error(`${folder} already holds a filed run: results are never overwritten; use a new --tag`); process.exit(1);
}
const pj = JSON.parse(readFileSync(join(repo, 'benchmarks', 'validation', caseId, 'project.json'), 'utf8'));
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, 'project.json'), JSON.stringify({ ...pj, name: folder, inputs: { ...(pj.inputs ?? {}), ...set } }, null, 1));
const an = join(repo, 'benchmarks', 'validation', caseId, 'analysis.geojson'); if (existsSync(an)) copyFileSync(an, join(dest, 'analysis.geojson'));
// the one-job study tools/validate.mjs --run plans (rerun): the project's storm as set, the base variant
const git = (...a) => spawnSync('git', a, { cwd: code, encoding: 'utf8' }).stdout.trim();
const commit = git('rev-parse', 'HEAD'), dirty = git('status', '--porcelain', '--', 'src', 'app', 'server', 'tools') !== '';
const jobs = expandJobs({ storms: [{ label: 'Validation', stormSrc: 'current', inputs: {} }], variants: [VARIANTS.base] });
writeFileSync(join(dest, 'batch.json'), JSON.stringify({ version: 1, created: new Date().toISOString(), base: { ...(pj.inputs ?? {}), ...set }, code: commit.slice(0, 7) + (dirty ? '+' : ''), jobs }, null, 1));

const stampS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), probeDir = join(dest, 'probe');
mkdirSync(probeDir, { recursive: true });
const logPath = join(probeDir, `${stampS}.console.log`), probePath = join(probeDir, `${stampS}.json`);
const lines = [];
const say = (s) => { const l = `${new Date().toLocaleTimeString()}  ${s}`; console.log(l); lines.push(l); writeFileSync(logPath, lines.join('\n') + '\n'); };
say(`case ${caseId} → ${folder}; code ${code} at ${commit.slice(0, 7)}${dirty ? ' (code files edited)' : ''}; set ${JSON.stringify(set)}`);

// ---- the probe: read-only, from the app's own debugging hook ----
const PROBE = `(() => {
  const f = window.__floodsim; if (!f) return { ready: false };
  const r = f.run;
  if (r && r.coupler && window.__rncRun !== r) { window.__rncRun = r; window.__rncSeen = (window.__rncSeen || 0) + 1; }
  const R = window.__rncRun, c = R?.coupler;
  const opts = R?.inp ? (R.inp.match(/\\[OPTIONS\\][\\s\\S]*?(?=\\n\\[)/) || [''])[0] : null;
  return { ready: true, seen: window.__rncSeen || 0, simT: R?.solver?.t ?? R?.s?.t ?? null, finished: !!R?.netMass,
    coupler: c ? { nodeArea: c.nodeArea ?? null, follow: c.follow ?? null, twoWay: c.twoWay ?? null, interval: c.interval, totals: { ...c.totals } } : null,
    inpOptions: opts, netMass: R?.netMass ?? null,
    mass: R?.mass ? Object.fromEntries(Object.entries(R.mass).filter(([, v]) => typeof v === 'number')) : null, wallS: R?.wall ?? null,
    log: [...document.querySelectorAll('#log li')].map(li => (li.className || '') + ' | ' + li.textContent.trim()) };
})()`;
let last = null; const logSeen = [];
const keep = (p) => {
  if (!p?.ready) return;
  for (const l of p.log ?? []) if (!logSeen.includes(l)) logSeen.push(l);
  if (p.coupler) last = p;
  writeFileSync(probePath, JSON.stringify({ case: caseId, folder, code, commit, dirty, set, probe: last, log: logSeen }, null, 1));
};

let server = null, page = null;
async function finish(rc, msg) { if (msg) say(msg); await page?.close().catch(() => {}); killTree(server); process.exit(rc); }
process.on('SIGINT', () => finish(130, 'interrupted'));
const port = await freePort();
server = spawn(process.execPath, [join(code, 'server', 'server.mjs')], { cwd: code, env: { ...process.env, PORT: String(port), FLOODSIM_PROJECTS: projects }, stdio: ['ignore', 'pipe', 'pipe'] });
await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
const base = `http://localhost:${port}`;
say(`server ${base} (projects ${projects})`);

const t0 = Date.now();
for (let attempt = 0; attempt <= retries; attempt++) {
  if (attempt) say(`relaunching the browser (${attempt} of ${retries}): the job resumes from its checkpoint`);
  page = await openBrowser({ onConsole: (line, type) => { if (/^\[batch\]/.test(line) || type === 'error' || type === 'exception' || /GPU error|device lost/i.test(line)) say(line); } });
  await page.navigate(`${base}/app/map.html?project=${encodeURIComponent(folder)}&batch=run`);
  let done = null, n = 0;
  while (!done && !page.crashed()) {
    await sleep(3000);
    keep(await page.evaluate(PROBE).catch(() => null));
    if (++n % 200 === 0 && last) say(`  sim ${last.simT != null ? (last.simT / 3600).toFixed(2) + ' h' : '?'}, to sewer ${Math.round(last.coupler.totals.toNetwork)} m³, back ${Math.round(last.coupler.totals.toSurface)} m³`);
    done = await page.evaluate('window.__batchDone ?? null').catch(() => null);
  }
  keep(await page.evaluate(PROBE).catch(() => null));
  const why = page.crashed();
  await page.close(); page = null;
  if (done) {
    if (!done.ok) await finish(1, `FAILED: ${done.error}`);
    const js = done.study?.jobs ?? [];
    say(`${js.filter(j => j.status === 'done').length} of ${js.length} done in ${((Date.now() - t0) / 3600e3).toFixed(2)} h`);
    for (const j of js) say(`  ${j.label}: ${j.status}${j.dir ? ' → runs/' + j.dir : ''}${j.error ? ' ' + j.error : ''}`);
    await finish(js.length && js.every(j => j.status === 'done') ? 0 : 1);
  }
  say(why ?? 'the page stopped answering');
}
await finish(1, `FAILED: the browser crashed ${retries + 1} times`);
