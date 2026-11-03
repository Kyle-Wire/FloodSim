// GPU verification in headless Chrome/Edge (the browser's own WebGPU), driven over the DevTools protocol.
// No npm dependencies: uses an installed Chromium browser and Node's built-in WebSocket (Node 22+).
//
// Usage: node tests/run-gpu-browser.mjs [--url http://localhost:8766] [--timeout 15] [--json tests/results-gpu.json]
//                                        [--probe] [--headed] [--flags "<browser flags>"]
//   --url      reuse a running FloodSim server (default: start server/server.mjs on a free port)
//   --timeout  minutes before giving up (default 15)
//   --json     where to write the results (default tests/results-gpu.json); written only on a clean run
//   --probe    only print the WebGPU adapter the browser gets, then exit
//   --headed   show the browser window (debugging)
//   --flags    replace the default WebGPU browser flags
//   --only     run one section of the suite (lts: local time stepping); results are then written only with --json
// Browser: CHROME_PATH, else Chrome, else Edge. Exit code 1 on a page exception, a "GPU error" line,
// "No WebGPU adapter", a browser crash or the timeout.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes('--' + name);
const timeoutMin = Number(opt('timeout', 15));
const only = opt('only');
const jsonOut = opt('json', only ? null : join(root, 'tests', 'results-gpu.json'));
// Headless Chrome/Edge on Windows gets the real GPU (D3D12) even without flags; these two keep it so on machines
// whose GPU or driver is blocklisted, or where WebGPU is not yet on by default (Linux).
const GPU_FLAGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
const gpuFlags = opt('flags') != null ? opt('flags').split(/\s+/).filter(Boolean) : GPU_FLAGS;

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = {
    win32: [
      join(pf, 'Google\\Chrome\\Application\\chrome.exe'), join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      local && join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
      local && join(local, 'Microsoft\\Edge\\Application\\msedge.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge',
    ],
  }[process.platform] ?? [];
  return candidates.find(p => p && existsSync(p)) ?? null;
}

const freePort = () => new Promise((ok, fail) => {
  const s = createServer(); s.unref(); s.on('error', fail);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

/** Resolves when `test(text)` matches the process's accumulated stdout/stderr; rejects if it exits or `ms` passes. */
function waitForOutput(proc, test, ms, what) {
  return new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => done(new Error(`${what}: no response within ${ms / 1000} s\n${buf}`)), ms);
    const on = (d) => { buf += d; const m = test(buf); if (m) done(null, m); };
    const exit = (code) => done(new Error(`${what} exited (code ${code})\n${buf}`));
    function done(err, m) {
      clearTimeout(t); proc.stdout?.off('data', on); proc.stderr?.off('data', on); proc.off('exit', exit);
      err ? fail(err) : ok(m);
    }
    proc.stdout?.on('data', on); proc.stderr?.on('data', on); proc.on('exit', exit);
  });
}

// ------------------------------------------------------------------ cleanup
let server = null, browser = null, profile = null, ws = null;
function killTree(p) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { p.kill('SIGKILL'); } catch { /* gone */ }
}
/** Edge (and sometimes Chrome) relaunches itself: the process we spawned exits and a detached browser keeps the
 *  profile. So also kill whatever still runs with our temporary profile on its command line. */
function killByProfile() {
  if (!profile) return;
  if (process.platform !== 'win32') return void spawnSync('pkill', ['-9', '-f', '--', profile], { stdio: 'ignore' });
  const dir = profile.replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${dir}') } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', timeout: 30e3 });
}
async function cleanup() {
  if (ws?.readyState === 1) { // ask the browser to quit, then make sure
    await Promise.race([cdp('Browser.close').catch(() => {}), sleep(3000)]);
    await sleep(500);
  }
  try { ws?.close(); } catch { /* closed */ }
  killTree(browser); killTree(server); killByProfile();
  if (profile) for (let i = 0; i < 20; i++) { // the browser's files can stay locked for a moment after it exits
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); }
  }
}
let exiting = false;
async function finish(code, msg) {
  if (exiting) return; exiting = true;
  if (msg) console.error(msg);
  await cleanup();
  process.exit(code);
}
process.on('SIGINT', () => finish(130, 'interrupted'));
process.on('SIGTERM', () => finish(143, 'terminated'));
process.on('uncaughtException', (e) => finish(1, 'runner error: ' + (e?.stack ?? e)));
process.on('unhandledRejection', (e) => finish(1, 'runner error: ' + (e?.stack ?? e)));

// ------------------------------------------------------------------ DevTools protocol
let nextId = 1;
const pending = new Map(), listeners = [];
function cdp(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, fail) => pending.set(id, { ok, fail, method }));
}
function connect(url) {
  return new Promise((ok, fail) => {
    ws = new WebSocket(url);
    ws.onopen = () => ok();
    ws.onerror = (e) => fail(new Error('DevTools connection failed: ' + (e.message ?? 'error')));
    ws.onclose = () => {
      if (!exiting) setTimeout(() => finish(1, 'FAILED: the browser closed the DevTools connection (crashed or quit)'), 100);
      for (const p of pending.values()) p.fail(new Error(`browser closed the DevTools connection (during ${p.method})`)); pending.clear(); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id != null) {
        const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
        m.error ? p.fail(new Error(`${p.method}: ${m.error.message}`)) : p.ok(m.result);
      } else for (const l of listeners) l(m);
    };
  });
}

// ------------------------------------------------------------------ main
const exe = findBrowser();
if (!exe) await finish(1, 'No Chromium browser found: install Chrome or Edge, or set CHROME_PATH.');

let base = opt('url');
if (base) base = base.replace(/\/+$/, '');
else {
  const port = await freePort();
  server = spawn(process.execPath, [join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  base = `http://localhost:${port}`;
}

profile = mkdtempSync(join(tmpdir(), 'floodsim-gpu-'));
const args = [
  ...(flag('headed') ? [] : ['--headless=new']), `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
  '--disable-sync', '--disable-component-update', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  ...gpuFlags, 'about:blank',
];
console.log(`browser: ${exe}\nflags:   ${gpuFlags.join(' ') || '(none)'}\nserver:  ${base}${server ? ' (started here)' : ''}`);
browser = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
// DevTools URL: from stderr ("DevTools listening on ws://…"), or the DevToolsActivePort file in the profile.
const portFile = join(profile, 'DevToolsActivePort');
// The spawned process may exit at once (Edge relaunches itself detached), so its exit is not an error here.
let stderr = '';
browser.stdout.on('data', () => {}); browser.stderr.on('data', (d) => { if (stderr.length < 1e5) stderr += d; });
browser.on('error', (e) => finish(1, 'could not start the browser: ' + e.message));
let wsUrl = null;
for (let i = 0; i < 300 && !wsUrl; i++) {
  await sleep(100);
  wsUrl = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? null;
  try { const [p, path] = readFileSync(portFile, 'utf8').split(/\r?\n/); if (p && path) wsUrl = `ws://127.0.0.1:${p}${path}`; } catch { /* not yet */ }
}
if (!wsUrl) await finish(1, 'The browser did not open a DevTools port within 30 s.\n' + stderr.slice(-2000));
await connect(wsUrl);

const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const S = (method, params) => cdp(method, params, sessionId);

const failures = [];
let crashed = null;
const fmtArg = (a) => a.value !== undefined ? String(a.value) : a.unserializableValue ?? a.description ?? a.type;
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === 'Runtime.consoleAPICalled') {
    const line = m.params.args.map(fmtArg).join(' ');
    const type = m.params.type;
    console.log(type === 'log' || type === 'info' ? line : `[console.${type}] ${line}`);
    if (/GPU error/.test(line)) failures.push(line);
    if (/No WebGPU adapter/.test(line)) failures.push(line);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const text = `PAGE EXCEPTION: ${d.exception?.description ?? d.text}` + (d.url ? ` (${d.url}:${d.lineNumber + 1})` : '');
    console.log(text); failures.push(text);
  } else if (m.method === 'Log.entryAdded' && /error|warning/.test(m.params.entry.level) && !/\/favicon\.ico$/.test(m.params.entry.url ?? '')) {
    console.log(`[browser ${m.params.entry.level}] ${m.params.entry.text}`);
  } else if (m.method === 'Inspector.targetCrashed') {
    crashed = 'the page crashed (renderer or GPU process)';
  }
});
await Promise.all([S('Runtime.enable'), S('Log.enable'), S('Page.enable'), S('Inspector.enable')]);

const timer = setTimeout(() => finish(1, `TIMEOUT after ${timeoutMin} min`), timeoutMin * 60e3);
const crashWatch = setInterval(() => { if (crashed) finish(1, 'FAILED: ' + crashed); }, 250);

const evaluate = async (expression) => {
  const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

/** Navigates and resolves on the load event (module scripts have run by then), so later evaluations hit the new page. */
const navigate = (url) => new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('page did not load within 60 s: ' + url)), 60e3);
  const l = (m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); ok(); } };
  listeners.push(l);
  S('Page.navigate', { url }).then(r => { if (r.errorText) fail(new Error(r.errorText + ': ' + url)); }, fail);
});

if (flag('probe')) {
  await navigate(base + '/package.json'); // any page on the server: a secure context with navigator.gpu
  const info = await evaluate(`(async () => {
    const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return { adapter: null, gpu: !!navigator.gpu };
    const i = a.info ?? {};
    return { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description,
             isFallbackAdapter: i.isFallbackAdapter ?? a.isFallbackAdapter, maxStorageBuffersPerShaderStage: a.limits.maxStorageBuffersPerShaderStage,
             features: [...a.features].length, userAgent: navigator.userAgent };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  clearTimeout(timer); clearInterval(crashWatch);
  await finish(info?.adapter === null ? 1 : 0);
}

const t0 = Date.now();
await navigate(base + '/tests/gpu-browser.html' + (only ? '?only=' + encodeURIComponent(only) : ''));
// window.__done is set by the page's module script; wait for it, then await the suite's results.
const json = await evaluate(`new Promise((ok, fail) => {
  const until = Date.now() + 60000;
  (function wait() {
    if (window.__done) return window.__done.then(r => ok(JSON.stringify(r)), fail);
    if (Date.now() > until) return fail(new Error('window.__done was never set (did tests/gpu-browser.html load?)'));
    setTimeout(wait, 100);
  })();
})`).catch(e => { failures.push('PAGE EXCEPTION: ' + e.message); return null; });
clearTimeout(timer); clearInterval(crashWatch);
await sleep(200); // let the last console events arrive

const results = json ? JSON.parse(json) : null;
if (results?.error) failures.push('suite error: ' + results.error);
const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (failures.length || !results) {
  await finish(1, `\nFAILED after ${secs} s (${failures.length} problem${failures.length === 1 ? '' : 's'}):\n  ` + failures.join('\n  ') + `\n${jsonOut} not written.`);
}
if (jsonOut) writeFileSync(jsonOut, json);
console.log(`\nGPU suite passed in ${secs} s${jsonOut ? `; results in ${jsonOut}` : ''}`);
await finish(0);
