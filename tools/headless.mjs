// Headless Chrome/Edge with WebGPU, driven over the DevTools protocol: the pieces tools/batch.mjs needs (the GPU test
// runner, tests/run-gpu-browser.mjs, has its own copy with its pass/fail rules). No npm dependencies: an installed
// Chromium browser and Node's built-in WebSocket (Node 22+).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));
// Headless Chrome/Edge on Windows gets the real GPU (D3D12) without flags; these keep it so on blocklisted drivers or Linux
export const GPU_FLAGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];

/** CHROME_PATH, else Chrome, else Edge. → path or null */
export function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files', pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || '';
  const candidates = {
    win32: [join(pf, 'Google\\Chrome\\Application\\chrome.exe'), join(pf86, 'Google\\Chrome\\Application\\chrome.exe'), local && join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'), local && join(local, 'Microsoft\\Edge\\Application\\msedge.exe')],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'],
  }[process.platform] ?? [];
  return candidates.find(p => p && existsSync(p)) ?? null;
}

export const freePort = () => new Promise((ok, fail) => {
  const s = createServer(); s.unref(); s.on('error', fail);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/** Resolves when `test(text)` matches the process's accumulated stdout/stderr; rejects if it exits or `ms` passes. */
export function waitForOutput(proc, test, ms, what) {
  return new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => done(new Error(`${what}: no response within ${ms / 1000} s\n${buf}`)), ms);
    const on = (d) => { buf += d; const m = test(buf); if (m) done(null, m); };
    const exit = (code) => done(new Error(`${what} exited (code ${code})\n${buf}`));
    function done(err, m) { clearTimeout(t); proc.stdout?.off('data', on); proc.stderr?.off('data', on); proc.off('exit', exit); err ? fail(err) : ok(m); }
    proc.stdout?.on('data', on); proc.stderr?.on('data', on); proc.on('exit', exit);
  });
}

export function killTree(p) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { p.kill('SIGKILL'); } catch { /* gone */ }
}
/** Edge (and sometimes Chrome) relaunches itself detached: kill whatever still runs with our profile on its command line. */
function killByProfile(profile) {
  if (process.platform !== 'win32') return void spawnSync('pkill', ['-9', '-f', '--', profile], { stdio: 'ignore' });
  const dir = profile.replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${dir}') } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', timeout: 30e3 });
}

/**
 * A browser with one page. → { evaluate(expr), navigate(url), close(), crashed: () => reason | null, onConsole }
 * `onConsole(line, type)` gets the page's console output; page exceptions come through it as type 'exception'.
 */
export async function openBrowser({ exe = findBrowser(), headed = false, flags = GPU_FLAGS, onConsole = () => {} } = {}) {
  if (!exe) throw new Error('No Chromium browser found: install Chrome or Edge, or set CHROME_PATH.');
  const profile = mkdtempSync(join(tmpdir(), 'floodsim-batch-'));
  const args = [...(headed ? [] : ['--headless=new']), `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', ...flags, 'about:blank'];
  const browser = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', crashed = null, ws = null, nextId = 1, closing = false;
  browser.stdout.on('data', () => {}); browser.stderr.on('data', (d) => { if (stderr.length < 1e5) stderr += d; });
  const portFile = join(profile, 'DevToolsActivePort');
  let wsUrl = null;
  for (let i = 0; i < 300 && !wsUrl; i++) {
    await sleep(100);
    wsUrl = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? null;
    try { const [p, path] = readFileSync(portFile, 'utf8').split(/\r?\n/); if (p && path) wsUrl = `ws://127.0.0.1:${p}${path}`; } catch { /* not yet */ }
  }
  const pending = new Map(), listeners = [];
  const cdp = (method, params = {}, sessionId) => {
    const id = nextId++; ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => pending.set(id, { ok, fail, method }));
  };
  async function close() {
    if (closing) return; closing = true;
    if (ws?.readyState === 1) { await Promise.race([cdp('Browser.close').catch(() => {}), sleep(3000)]); await sleep(500); }
    try { ws?.close(); } catch { /* closed */ }
    killTree(browser); killByProfile(profile);
    for (let i = 0; i < 20; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  }
  if (!wsUrl) { await close(); throw new Error('The browser did not open a DevTools port within 30 s.\n' + stderr.slice(-2000)); }
  await new Promise((ok, fail) => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => ok();
    ws.onerror = (e) => fail(new Error('DevTools connection failed: ' + (e.message ?? 'error')));
    ws.onclose = () => { if (!closing) crashed ??= 'the browser closed the DevTools connection (crashed or quit)'; for (const p of pending.values()) p.fail(new Error(`browser closed (during ${p.method})`)); pending.clear(); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id != null) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.fail(new Error(`${p.method}: ${m.error.message}`)) : p.ok(m.result); }
      else for (const l of listeners) l(m);
    };
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const S = (method, params) => cdp(method, params, sessionId);
  const fmtArg = (a) => a.value !== undefined ? String(a.value) : a.unserializableValue ?? a.description ?? a.type;
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') onConsole(m.params.args.map(fmtArg).join(' '), m.params.type);
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; onConsole(`PAGE EXCEPTION: ${d.exception?.description ?? d.text}`, 'exception'); }
    else if (m.method === 'Inspector.targetCrashed') crashed = 'the page crashed (renderer or GPU process)';
  });
  await Promise.all([S('Runtime.enable'), S('Page.enable'), S('Inspector.enable')]);
  const evaluate = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  /** Navigates and resolves on the load event (module scripts have run by then). */
  const navigate = (url) => new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('page did not load within 60 s: ' + url)), 60e3);
    const l = (m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); ok(); } };
    listeners.push(l);
    S('Page.navigate', { url }).then(r => { if (r.errorText) fail(new Error(r.errorText + ': ' + url)); }, fail);
  });
  return { evaluate, navigate, close, crashed: () => crashed };
}
