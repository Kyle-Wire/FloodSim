// Lists the stream crossings a project's conditioned terrain leaves closed (src/crossings.js): opens the project in a
// headless browser, lets the app build its terrain as it does for a run, and walks every mapped stream. No run is made.
//   node tools/crossings.mjs "<project folder>" [more projects…] [--url http://localhost:8765] [--json]
// Exit code 1 if any project has a closed crossing.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, freePort, waitForOutput, killTree, sleep } from './headless.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2), ui = argv.indexOf('--url'), json = argv.includes('--json');
const projects = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--url');
if (!projects.length) { console.error('usage: node tools/crossings.mjs "<project folder>" [more…] [--url <app url>] [--json]'); process.exit(2); }

let base = ui >= 0 ? argv[ui + 1] : null, server = null;
if (!base) {
  const port = await freePort();
  server = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForOutput(server, b => b.includes('FloodSim at'), 15e3, 'server/server.mjs');
  base = `http://localhost:${port}`;
}
const page = await openBrowser({});
const inPage = `(async () => {
  const { closedCrossings, crossingNote } = await import('/src/crossings.js');
  const { culvertDiameter } = await import('/src/channels.js');
  const { fromUTM } = await import('/src/geo.js');
  const m = window.__floodsim.model, fine = m.fine, f = m.f;
  const ways = m.osm.waterways.filter(w => /river|stream|brook|canal|ditch|drain/.test(w.kind)); // as app/map.js gives breachChannels
  const paths = f.channels.paths.map((p, n) => ({ path: p, line: ways[n]?.line, name: ways[n]?.name, kind: ways[n]?.kind }));
  const culverts = m.osm.culverts.map(c => ({ line: c.line, D: culvertDiameter(c.tags, c.kind), sized: Number.parseFloat(c.tags?.diameter) > 0 || Number.parseFloat(c.tags?.width) > 0 }));
  const r = closedCrossings(fine, f, paths, { culverts });
  const at = (c) => { const [lon, lat] = fromUTM(fine.x0 + (c.i + 0.5) * fine.dx, fine.y1 - (c.j + 0.5) * fine.dx, fine.zone); return { ...c, lon: +lon.toFixed(6), lat: +lat.toFixed(6) }; };
  return { note: crossingNote(r), streams: paths.length, checked: r.checked, uphill: r.uphill, cuts: { road: f.channels.breaches, fill: f.channels.fills }, mappedCulverts: culverts.length, closed: r.closed.map(at), rises: r.rises.map(at), culverts: r.culverts.map(at) };
})()`;
const out = {}; let bad = false;
try {
  for (const p of projects) {
    await page.navigate(`${base}/app/map.html?project=${encodeURIComponent(p)}`);
    for (let i = 0; ; i++) {
      if (await page.evaluate(`!!window.__floodsim?.model?.f?.channels`).catch(() => false)) break;
      if (page.crashed()) throw new Error(`${p}: ${page.crashed()}`);
      if (i > 600) throw new Error(`${p}: the terrain was not built after 10 min`);
      await sleep(1000);
    }
    const r = out[p] = await page.evaluate(inPage); if (r.closed.length) bad = true;
    if (json) continue;
    console.log(`\n${p}: ${r.streams} mapped streams (${r.checked} walked${r.uphill.length ? `, ${r.uphill.length} mapped against the flow` : ''}), ${r.mappedCulverts} mapped culverts, ${r.cuts.road} road embankments and ${r.cuts.fill} humps already cut`);
    console.log(r.note ? `  ${r.note}` : '  no closed crossings');
    const row = (c) => `    ${(c.name ?? c.kind ?? 'stream').padEnd(34).slice(0, 34)} pond ${c.pond.toFixed(2).padStart(5)} m  fill ${String(Math.round(c.length)).padStart(4)} m long  foot ${c.foot.toFixed(2)} crest ${c.crest.toFixed(2)}  ${c.road ? 'road' : 'no road'}  ${c.lat}, ${c.lon}${c.culvert ? `  culvert ${c.culvert.D} m${c.culvert.sized ? '' : ' (assumed)'}` : ''}`;
    for (const c of r.closed) console.log(row(c));
    if (r.rises.length) { console.log('  bed rises under 1.5 m with no road (riffle, bar or ford; listed, not counted):'); for (const c of r.rises) console.log(row(c)); }
    if (r.culverts.length) { console.log('  through a mapped culvert:'); for (const c of r.culverts) console.log(row(c)); }
  }
  if (json) console.log(JSON.stringify(out, null, 1));
} finally { await page.close(); killTree(server); }
process.exit(bad ? 1 : 0);
