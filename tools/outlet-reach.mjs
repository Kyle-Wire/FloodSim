// The river outlet's edge level from a downstream gauge, two ways: the prismatic step on a section cut at the edge
// (as runs before the reach was traced) and the standard step through lidar cross-sections from the gauge up to the
// model edge (src/outlet.js). Prints the reach, its sections and the edge level at the gauge's crest.
// Usage: node tools/outlet-reach.mjs --site 01474500 --box -75.262,40.0135,-75.200,40.0445 --from 2021-09-01T18:00Z
//          --to 2021-09-03T06:00Z [--dc 2.74] [--spacing 200] [--half 300] [--bank 0.06]
import { levelGauge, levelSeries } from '../src/waterlevels.js';
import { gaugeFlows } from '../src/inflow.js';
import { fetchDEM } from '../src/ingest.js';
import { toUTM, utmZone, utmEPSG } from '../src/geo.js';
import { riverPath, pathToEdge, cutSections, stepUp, backwater, sectionHydraulics } from '../src/outlet.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const site = arg('site'), box = arg('box').split(',').map(Number), t0 = Date.parse(arg('from')), t1 = Date.parse(arg('to'));
const dc = Number(arg('dc', 2.74)), spacing = Number(arg('spacing', 200)), half = Number(arg('half', 300)), nBank = Number(arg('bank', 0.06));
const fetcher = (url) => fetch(url, { headers: { 'user-agent': 'FloodSim/0.1 (urban flood research prototype)' } });

const g = await levelGauge(site, fetcher), lv = await levelSeries(g, fetcher, t0, t1), flow = (await gaugeFlows(site, t0, t1, fetcher)).map(f => [f.t, f.q]);
const crest = lv.series.reduce((a, b) => (b[1] > a[1] ? b : a)), qAt = (t) => { let b = flow[0]; for (const f of flow) if (Math.abs(f[0] - t) < Math.abs(b[0] - t)) b = f; return b[1]; };
console.log(`${g.name}: crest ${crest[1].toFixed(2)} m NAVD88 at ${new Date(crest[0]).toISOString()}, ${qAt(crest[0]).toFixed(0)} m³/s (${lv.how})`);

const zone = utmZone((box[0] + box[2]) / 2), epsg = utmEPSG(zone);
const [bx0, by0] = toUTM(box[0], box[1], zone), [bx1, by1] = toUTM(box[2], box[3], zone);
const inside = (x, y) => x >= Math.min(bx0, bx1) && x <= Math.max(bx0, bx1) && y >= Math.min(by0, by1) && y <= Math.max(by0, by1);
const path = (await riverPath(site, fetcher)).map(([lon, lat]) => toUTM(lon, lat, zone));
const reach = pathToEdge(path, inside); if (!reach) throw new Error('the main stem never enters the box');
console.log(`reach: ${(reach.length / 1000).toFixed(2)} km along NHDPlus from the gauge to the model edge`);

// ground over the reach at 3 m
const xs = reach.line.map(p => p[0]), ys = reach.line.map(p => p[1]), pad = half + 20, dx = 3;
const grid = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad, dx, epsg };
grid.nx = Math.ceil((grid.x1 - grid.x0) / dx); grid.ny = Math.ceil((grid.y1 - grid.y0) / dx);
const { z } = await fetchDEM(grid, fetcher);
const sample = (x, y) => {
  const fi = (x - grid.x0) / dx - 0.5, fj = (grid.y1 - y) / dx - 0.5, i = Math.floor(fi), j = Math.floor(fj);
  if (i < 0 || j < 0 || i >= grid.nx - 1 || j >= grid.ny - 1) return NaN;
  const a = fi - i, b = fj - j, k = j * grid.nx + i, v = (1 - a) * (1 - b) * z[k] + a * (1 - b) * z[k + 1] + (1 - a) * b * z[k + grid.nx] + a * b * z[k + grid.nx + 1];
  return v > -1000 ? v : NaN;
};
const secs = cutSections(reach.line, sample, { spacing, half, dc, n: { chan: 0.035, bank: nBank } });
// the last section sits on the edge itself
const edge = cutSections([reach.line.at(-2), reach.line.at(-1)], sample, { spacing: 1e9, half, dc, n: { chan: 0.035, bank: nBank } })[0];
edge.x = reach.length; secs.push(edge);
const Q = qAt(crest[0]);
console.log(`${secs.length} sections; lidar water ${Math.min(...secs.map(s => s.ws)).toFixed(2)}–${Math.max(...secs.map(s => s.ws)).toFixed(2)} m, its width ${Math.min(...secs.map(s => s.width)).toFixed(0)}–${Math.max(...secs.map(s => s.width)).toFixed(0)} m`);
const r = stepUp(secs, Q, crest[1]);
console.log(' x (km)   lidar water  width   flood level   top width   mean velocity');
for (const [i, s] of secs.entries()) if (process.argv.includes('--all') || i % 4 === 0 || i === secs.length - 1) { const h = sectionHydraulics(s, r.profile[i]); console.log(`${(s.x / 1000).toFixed(2).padStart(7)} ${s.ws.toFixed(2).padStart(11)} ${s.width.toFixed(0).padStart(7)} ${r.profile[i].toFixed(2).padStart(12)} ${h.T.toFixed(0).padStart(10)} ${(Q / h.A).toFixed(2).padStart(13)}`); }
// the prismatic step on the edge's own section (as cells w apart, n per cell)
const sec = { z: edge.z, n: edge.n, w: edge.s[1] - edge.s[0] };
console.log(`edge level at the crest: cross-sections ${r.ws.toFixed(2)} m (${r.critical} at critical depth); prismatic ${backwater(sec, Q, crest[1], reach.length).toFixed(2)} m`);
