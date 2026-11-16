// Structure and tributary check for the eligible gauges in candidates.json (README, site selection rules 5 and 6).
// For each gauge: the NHD main stem 5 km downstream and 2 km upstream (USGS NLDI), then OpenStreetMap features within
// 40 m of that line: dams, weirs, locks, waterway culverts and bridges, and waterways that join it (tributaries).
// Writes structures.json. Distances are along the line from the gauge (− upstream, + downstream). A judgement still
// has to be made per site from this list (sites.md); the script does not decide.
//   node benchmarks/rating/check-sites.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, '.cache');
const NLDI = 'https://api.water.usgs.gov/nldi/linked-data';
const OVERPASS = process.env.OVERPASS ?? 'https://overpass-api.de/api/interpreter';
const NID = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NID_v1/FeatureServer/0/query';

async function cached(key, fn) {
  const f = path.join(CACHE, createHash('sha256').update(key).digest('hex') + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const d = await fn(); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); return d;
}
async function json(url, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (r.ok) return r.json();
    if (i >= 3) throw new Error(`${r.status} ${url.slice(0, 120)}`);
    await new Promise(res => setTimeout(res, 5000 * (i + 1)));
  }
}

const R = 6371000, rad = Math.PI / 180;
const xy = ([lon, lat], lat0) => [lon * rad * R * Math.cos(lat0 * rad), lat * rad * R];

/** Polyline in flow order with chainage (m, 0 at the point nearest the gauge). Revision 1: NHDPlus flowlines are
 *  digitised downstream, so they are chained end to start; the first version walked nearest points from the gauge,
 *  which mixed up the flowline UM and DM share and could put a downstream feature upstream. */
function chain(up, down, gauge) {
  const lat0 = gauge[1], feats = new Map();
  for (const f of [...up, ...down]) { const c = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.flat() : f.geometry.coordinates; feats.set(c.map(String).join(';'), c); }
  const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`, byStart = new Map([...feats.values()].map(c => [key(c[0]), c])), ends = new Set([...feats.values()].map(c => key(c.at(-1))));
  const starts = [...feats.values()].filter(c => !ends.has(key(c[0])));
  if (starts.length !== 1) throw new Error(`${starts.length} upstream ends in the main stem flowlines`);
  const pts = []; for (let c = starts[0], n = 0; c && n < 500; c = byStart.get(key(c.at(-1))), n++) pts.push(...(pts.length ? c.slice(1) : c));
  const P = pts.map(p => xy(p, lat0)), g = xy(gauge, lat0), s = [0];
  for (let i = 1; i < P.length; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  let k0 = 0; P.forEach((p, i) => { if (Math.hypot(p[0] - g[0], p[1] - g[1]) < Math.hypot(P[k0][0] - g[0], P[k0][1] - g[1])) k0 = i; });
  return P.map((p, i) => ({ p, s: s[i] - s[k0] }));
}
function along(line, pt) {           // chainage and offset of pt nearest the line
  let best = { d: Infinity, s: NaN };
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]], dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((pt[0] - a.p[0]) * dx + (pt[1] - a.p[1]) * dy) / L2));
    const d = Math.hypot(a.p[0] + t * dx - pt[0], a.p[1] + t * dy - pt[1]);
    if (d < best.d) best = { d, s: a.s + t * (b.s - a.s) };
  }
  return best;
}

async function site(r) {
  const gauge = [r.lon, r.lat];
  const comid = (await cached(`nldi-pos ${gauge}`, () => json(`${NLDI}/comid/position?f=json&coords=POINT(${r.lon} ${r.lat})`))).features[0].properties.comid;
  const down = await cached(`nldi DM ${comid}`, () => json(`${NLDI}/comid/${comid}/navigation/DM/flowlines?distance=5&f=json`));
  const up = await cached(`nldi UM ${comid}`, () => json(`${NLDI}/comid/${comid}/navigation/UM/flowlines?distance=2&f=json`));
  const line = chain(up.features, down.features, gauge);
  const lat0 = r.lat, pts = [...up.features, ...down.features].flatMap(f => f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.flat() : f.geometry.coordinates);
  const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]), pad = 0.001;
  const bb = [Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad].join(',');
  const q = `[out:json][timeout:60];(
    node["waterway"~"^(dam|weir|lock_gate|waterfall|rapids)$"](${bb}); way["waterway"~"^(dam|weir|lock_gate)$"](${bb});
    way["waterway"]["tunnel"~"culvert|yes"](${bb}); way["bridge"]["bridge"!="no"](${bb});
    way["waterway"~"^(river|stream|canal|ditch|drain)$"](${bb}););out tags geom;`;
  const osm = await cached(`overpass ${bb} v1`, () => json(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FloodSim-benchmark/1.0 (rating-curve site check)' } }));
  const found = [];
  for (const e of osm.elements) {
    const geom = e.type === 'node' ? [[e.lon, e.lat]] : (e.geometry ?? []).map(g => [g.lon, g.lat]);
    if (!geom.length) continue;
    const near = geom.map(g => along(line, xy(g, lat0))).reduce((a, b) => (b.d < a.d ? b : a));
    const t = e.tags ?? {};
    let kind = null;
    if (/^(dam|weir|lock_gate|waterfall|rapids)$/.test(t.waterway ?? '')) kind = t.waterway;
    else if (t.waterway && /culvert|yes/.test(t.tunnel ?? '')) kind = 'culvert';
    else if (t.bridge && t.bridge !== 'no' && !t.waterway) kind = 'bridge';
    else if (t.waterway) kind = 'waterway';
    if (!kind || near.d > 40) continue;
    if (kind === 'waterway') {
      // a tributary touches the line at one end only; the main stem itself runs along it
      const ends = [geom[0], geom[geom.length - 1]].map(g => along(line, xy(g, lat0)));
      const on = geom.filter(g => along(line, xy(g, lat0)).d < 40).length / geom.length;
      if (on > 0.5) continue;
      const j = ends[0].d < ends[1].d ? ends[0] : ends[1];
      if (j.d > 40) continue;
      found.push({ kind: 'joins', name: t.name ?? '', what: t.waterway, s: Math.round(j.s) });
    } else found.push({ kind, name: t.name ?? '', what: t.highway ?? t.railway ?? '', s: Math.round(near.s) });
  }
  // USACE National Inventory of Dams (public HIFLD layer). NID positions are often tens of metres off the channel,
  // so a dam counts within 150 m of the line
  const nidQ = new URLSearchParams({ where: '1=1', geometry: [bb.split(',')[1], bb.split(',')[0], bb.split(',')[3], bb.split(',')[2]].join(','),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', outFields: 'NIDID,NAME,RIVER_OR_STREAM,PRIMARY_DAM_TYPE,NID_HEIGHT,PRIMARY_PURPOSE', f: 'json' });
  const nid = await cached(`nid ${bb} v1`, () => json(`${NID}?${nidQ}`));
  for (const f of nid.features ?? []) {
    const a = f.attributes, near = along(line, xy([f.geometry.x, f.geometry.y], lat0));
    if (near.d <= 150) found.push({ kind: 'NID dam', name: `${a.NAME} (${a.NIDID}, ${a.RIVER_OR_STREAM ?? ''}, ${a.NID_HEIGHT ?? '?'} ft, ${a.PRIMARY_PURPOSE ?? ''}, ${Math.round(near.d)} m off)`, what: '', s: Math.round(near.s) });
  }
  found.sort((a, b) => a.s - b.s);
  return { id: r.id, name: r.name, comid, lineKm: [+(line[0]?.s / 1000).toFixed(2), +(line.at(-1)?.s / 1000).toFixed(2)], found };
}

async function main() {
  const { rows } = JSON.parse(fs.readFileSync(path.join(here, 'candidates.json'), 'utf8'));
  const out = [];
  for (const r of rows.filter(r => r.usable)) {
    try { out.push(await site(r)); } catch (e) { out.push({ id: r.id, name: r.name, error: e.message }); }
    const s = out.at(-1);
    console.log(`\n${s.id} ${s.name}${s.error ? '  ERROR ' + s.error : `  (line ${s.lineKm?.join(' to ')} km)`}`);
    for (const f of s.found ?? []) if (f.kind !== 'bridge' || Math.abs(f.s) <= 300) console.log(`  ${String(f.s).padStart(6)} m  ${f.kind}${f.what ? ' (' + f.what + ')' : ''} ${f.name}`);
  }
  fs.writeFileSync(path.join(here, 'structures-r1.json'), JSON.stringify({ made: new Date().toISOString(), sites: out }, null, 1));
}
main();
