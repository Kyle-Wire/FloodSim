// Keeps the RT-1 queue's Chrome page treated as focused and active (CDP focus emulation, web lifecycle "active"), so a
// window out of view is not throttled, and logs model time each minute; brings the page to the front if it stalls.
//   node benchmarks/rating/watchdog.mjs <devtools port>
const port = process.argv[2];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString();
let ws, id = 0, sessionId = null, pending = new Map();
const cdp = (method, params = {}, sid) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); });
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); } };
ws.onclose = () => { console.log(`${stamp()}  browser closed`); process.exit(0); };
let target = null, lastT = -1, still = 0;
for (;;) {
  const { targetInfos } = await cdp('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page' && /map\.html/.test(x.url));
  if (t && t.targetId !== target) {
    target = t.targetId; ({ sessionId } = await cdp('Target.attachToTarget', { targetId: target, flatten: true }));
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
    await cdp('Page.setWebLifecycleState', { state: 'active' }, sessionId).catch(() => {});
    console.log(`${stamp()}  attached to ${decodeURIComponent(t.url.split('project=')[1] ?? '')}`);
  }
  if (sessionId) {
    const r = await cdp('Runtime.evaluate', { expression: 'window.__floodsim?.run?.solver?.t ?? -1', returnByValue: true }, sessionId).catch(() => null);
    const tm = r?.result?.value ?? -1;
    if (tm > 0 && Math.abs(tm - lastT) < 1e-6) { still++; if (still >= 3) { console.log(`${stamp()}  stalled at ${(tm / 3600).toFixed(2)} h: bringing to front`); await cdp('Page.bringToFront', {}, sessionId).catch(() => {}); await cdp('Page.setWebLifecycleState', { state: 'active' }, sessionId).catch(() => {}); still = 0; } }
    else still = 0;
    lastT = tm; console.log(`${stamp()}  model time ${(tm / 3600).toFixed(2)} h`);
  }
  await sleep(60e3);
}
