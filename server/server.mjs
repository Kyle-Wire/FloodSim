// FloodSim dev server: static files from the repo root, plus a cached proxy for the open-data services.
//   node server/server.mjs [port]      → http://localhost:8766/app/map.html
// POST /api/fetch {url, method?, body?, contentType?} → upstream response, cached on disk by request hash.
// Only allowlisted hosts are proxied; responses are cached in .cache/ so re-running an area is offline-fast.
// /api/projects…: project folders on this computer (loopback only), under FLOODSIM_PROJECTS or Documents\FloodSim Projects.
// GET /api/version → { commit, dirty }: the app commit, part of every run's forcing fingerprint.
// GET /api/bluetopo?bbox=w,s,e,n → { scheme, tiles }: NOAA BlueTopo bathymetry tiles under a box (from its tile index).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = join(root, '.cache');
const port = Number(process.env.PORT || process.argv[2] || 8766);

const ALLOW = new Set([
  'elevation.nationalmap.gov',      // USGS 3DEP DEM (ImageServer)
  'nsi.sec.usace.army.mil',         // USACE National Structure Inventory (building damage)
  'overpass-api.de',                // OpenStreetMap buildings, roads, waterways
  'overpass.kumi.systems',          // Overpass mirrors
  'overpass.private.coffee',
  'www.mrlc.gov',                   // NLCD land cover (WMS/WCS)
  'sdmdataaccess.sc.egov.usda.gov', // SSURGO Soil Data Access
  'hdsc.nws.noaa.gov',              // NOAA Atlas 14 precipitation frequency
  'hazards.fema.gov',               // FEMA National Flood Hazard Layer (flood zones, BFEs)
  'mesonet.agron.iastate.edu',      // IEM: historic rainfall (IEMRE, ASOS 1-minute), NEXRAD radar frame listings, MRMS radar rain
  'mtarchive.geol.iastate.edu',     // IEM raw MRMS archive: gauge-corrected hourly rain (GRIB2)
  'www.nhc.noaa.gov',               // NHC HURDAT2 hurricane tracks
  'api.tidesandcurrents.noaa.gov',  // NOAA CO-OPS tide gauges
  'services.arcgis.com',            // city utility layers (e.g. Philadelphia Water inlets, combined-sewer area)
  'mapservices.pasda.psu.edu',      // PASDA (Pennsylvania) utility layers
  'geocoding.geo.census.gov',       // US Census address geocoder
  'nominatim.openstreetmap.org',    // place-name search fallback (OSM; light, cached use only)
  'epsg.io',                        // coordinate-system definitions for imported GIS files
  'api.waterdata.usgs.gov',         // USGS Water Data APIs: STN high-water marks, groundwater levels
  'waterservices.usgs.gov',         // USGS NWIS: stream gauges, instantaneous flows, site lists
  'api.water.usgs.gov',             // USGS NLDI: upstream basins (drainage-area ratio for river inflow)
  'nwis.waterdata.usgs.gov',        // USGS NWIS: annual peak flows
  'streamstats.usgs.gov',           // USGS StreamStats: basins, characteristics and regression peaks (ungauged river inflow)
  'geodesy.noaa.gov',               // NOAA NCAT / VERTCON: NGVD29 → NAVD88 for gauge datums
  'noaa-ocs-nationalbathymetry-pds.s3.amazonaws.com', // NOAA National Bathymetric Source: BlueTopo tiles (surveyed river and harbour beds)
]);
const UA = 'FloodSim/0.1 (urban flood research prototype)';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.wasm': 'application/wasm',
};

/** Loopback, link-local and private-network hosts are never proxied (a linked URL must be public). */
const PRIVATE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f:]*\]?|\[?fe80:.*\]?)$/i;

async function proxy(req, res) {
  // the app always sends this header; a cross-site page cannot without a CORS preflight, which is never granted
  if (req.headers['x-floodsim'] !== '1') return send(res, 403, 'missing x-floodsim header');
  let body = '';
  for await (const chunk of req) body += chunk;
  const q = JSON.parse(body || '{}');
  let u;
  try { u = new URL(q.url); } catch { return send(res, 400, 'bad url'); }
  const host = u.hostname.toLowerCase();
  // built-in sources are allowlisted; links a user pastes (q.linked) may point at any public https host, GET only
  const linkedOK = q.linked === true && (q.method ?? 'GET') === 'GET' && !PRIVATE.test(host);
  if (u.protocol !== 'https:' || !(ALLOW.has(host) || linkedOK)) return send(res, 403, 'host not allowed: ' + u.hostname);
  const method = q.method || 'GET';
  const key = createHash('sha1').update(method + ' ' + u.href + '\n' + (q.body || '')).digest('hex');
  const file = join(cacheDir, key);
  try {
    const [data, meta] = await Promise.all([readFile(file), readFile(file + '.json', 'utf8')]);
    res.writeHead(200, { 'content-type': JSON.parse(meta).type, 'x-cache': 'hit' });
    return res.end(data);
  } catch { /* miss */ }
  // public data services are often briefly overloaded: retry 429 / 5xx / network errors twice with backoff
  let r, data, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(ok => setTimeout(ok, 1500 * attempt));
    try {
      r = await fetch(u, { method, body: q.body, headers: { 'user-agent': UA, ...(q.contentType ? { 'content-type': q.contentType } : {}) }, signal: AbortSignal.timeout(90e3) });
      data = Buffer.from(await r.arrayBuffer());
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { lastErr = e; r = null; }
  }
  if (!r) return send(res, 502, 'upstream error: ' + (lastErr?.message ?? 'unreachable'));
  const type = r.headers.get('content-type') || 'application/octet-stream';
  if (r.ok) {
    await mkdir(cacheDir, { recursive: true });
    await Promise.all([writeFile(file, data), writeFile(file + '.json', JSON.stringify({ url: u.href, type }))]);
  }
  res.writeHead(r.status, { 'content-type': type, 'x-cache': 'miss' });
  res.end(data);
}

async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') { res.writeHead(302, { location: '/app/map.html' }); return res.end(); } // redirect, so relative script paths resolve
  const file = normalize(join(root, p));
  if (!file.startsWith(normalize(root)) || file.includes('.cache')) return send(res, 403, 'forbidden');
  try {
    if ((await stat(file)).isDirectory()) return send(res, 404, 'not found');
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch { send(res, 404, 'not found'); }
}

// ------------------------------------------------------------------ projects
const projectsDir = process.env.FLOODSIM_PROJECTS || join(homedir(), 'Documents', 'FloodSim Projects');
const LOCAL = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
const FOLDER = /^[\w\-()&,' ]{1,80}$/, SEG = /^[\w\-.]{1,80}$/;
/** Absolute path of a file inside a project folder, or null if the names are not plain (no '..', no separators). */
function projectPath(folder, path = '') {
  if (!FOLDER.test(folder ?? '') || /^[ .]|[ .]$/.test(folder)) return null;
  const segs = path ? path.split('/') : [];
  if (segs.length > 4 || segs.some(s => !SEG.test(s) || /^\.+$/.test(s))) return null;
  return join(projectsDir, folder, ...segs);
}
async function projects(req, res, p) {
  if (req.headers['x-floodsim'] !== '1') return send(res, 403, 'missing x-floodsim header');
  if (!LOCAL.test(req.socket.remoteAddress ?? '')) return send(res, 403, 'local only');
  const q = new URL(req.url, 'http://x').searchParams;
  if (p === '/api/projects/runs' && req.method === 'GET') { // a project's saved runs with their summaries' key facts, newest first
    const dir = projectPath(q.get('folder'), 'runs'); if (!dir) return send(res, 400, 'bad project name');
    const runs = [];
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory()) continue;
      try {
        const sm = JSON.parse(await readFile(join(dir, d.name, 'summary.json'), 'utf8'));
        runs.push({ dir: d.name, savedUTC: sm.savedUTC ?? null, scenario: sm.scenario ?? 'Existing conditions', designHash: sm.designHash ?? null, forcingHash: sm.forcingHash ?? null,
          forcing: sm.forcing ?? null, commit: sm.commit ?? null, storm: sm.storm?.label ?? null, ari: sm.storm?.ari ?? null, durationMin: sm.storm?.durationMin ?? null,
          batch: sm.batch ?? null, finished: sm.finished ?? null, grids: !!sm.grids });
      } catch { /* no summary */ }
    }
    runs.sort((a, b) => String(b.dir).localeCompare(String(a.dir)));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ runs }));
  }
  if (p === '/api/projects' && req.method === 'GET') { // list, newest first
    await mkdir(projectsDir, { recursive: true });
    const list = [];
    for (const d of await readdir(projectsDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !FOLDER.test(d.name)) continue;
      try {
        const pj = JSON.parse(await readFile(join(projectsDir, d.name, 'project.json'), 'utf8'));
        const runs = await readdir(join(projectsDir, d.name, 'runs')).catch(() => []);
        list.push({ folder: d.name, name: pj.name ?? d.name, saved: pj.saved ?? null, place: pj.place ?? '', runs: runs.length });
      } catch { /* not a project */ }
    }
    list.sort((a, b) => String(b.saved).localeCompare(String(a.saved)));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ dir: projectsDir, projects: list }));
  }
  const file = !q.get('folder') && p === '/api/projects/reveal' ? projectsDir : projectPath(q.get('folder'), q.get('path') ?? '');
  if (!file) return send(res, 400, 'bad project or file name');
  if (p === '/api/projects/file' && req.method === 'GET') {
    let data; try { data = await readFile(file); } catch { return send(res, 404, 'not found'); }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(data);
  }
  if (p === '/api/projects/file' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, Buffer.concat(chunks)); return send(res, 200, 'saved');
  }
  if (p === '/api/projects/reveal' && req.method === 'POST') { // open the folder in Explorer / Finder
    await mkdir(file, { recursive: true });
    const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); return send(res, 200, 'opened');
  }
  return send(res, 404, 'not found');
}

// ------------------------------------------------------------------ BlueTopo tile index
// NOAA's National Bathymetric Source publishes BlueTopo, gridded surveyed bathymetry of navigable waters (NAVD88 in the
// lower 48), as GeoTIFF tiles on S3. Which tiles cover a box is only in its tile-scheme GeoPackage (an SQLite file
// with an R-tree), re-issued under a new dated name now and then: the latest is found by listing, downloaded once into
// .cache/bluetopo/, and queried with Node's built-in SQLite.
const NBS = 'https://noaa-ocs-nationalbathymetry-pds.s3.amazonaws.com';
let scheme = null; // { name, file, at }
async function blueTopoScheme() {
  if (scheme && Date.now() - scheme.at < 864e5) return scheme;
  const dir = join(cacheDir, 'bluetopo'); await mkdir(dir, { recursive: true });
  let name = null;
  try {
    const r = await fetch(`${NBS}/?list-type=2&prefix=BlueTopo/_BlueTopo_Tile_Scheme/`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30e3) });
    name = [...(await r.text()).matchAll(/<Key>([^<]+\.gpkg)<\/Key>/g)].map(m => m[1]).sort().at(-1) ?? null;
  } catch { /* offline: the newest one already downloaded */ }
  const have = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.gpkg')).sort();
  const base = name ? name.split('/').at(-1) : have.at(-1); if (!base) throw new Error('BlueTopo tile index unavailable');
  const file = join(dir, base);
  if (!have.includes(base)) {
    const r = await fetch(`${NBS}/${name}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180e3) });
    if (!r.ok) throw new Error(`BlueTopo tile index ${r.status}`);
    await writeFile(file, Buffer.from(await r.arrayBuffer()));
  }
  return (scheme = { name: base, file, at: Date.now() });
}
async function blueTopo(req, res) {
  if (req.headers['x-floodsim'] !== '1') return send(res, 403, 'missing x-floodsim header');
  const b = (new URL(req.url, 'http://x').searchParams.get('bbox') ?? '').split(',').map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite) || b[2] <= b[0] || b[3] <= b[1]) return send(res, 400, 'bbox=w,s,e,n');
  const sc = await blueTopoScheme(), { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(sc.file, { readOnly: true });
  try {
    const t = db.prepare('select table_name from gpkg_contents').get().table_name;
    const tiles = db.prepare(`select t.tile as tile, t.GeoTIFF_Link as url, t.Resolution as resolution, t.UTM as utm, t.Delivered_Date as delivered from "${t}" t
      join "rtree_${t}_geom" r on t.fid = r.id where r.minx < ? and r.maxx > ? and r.miny < ? and r.maxy > ? and t.GeoTIFF_Link is not null`).all(b[2], b[0], b[3], b[1]);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ scheme: sc.name, tiles: tiles.map(r => ({ ...r })) }));
  } finally { db.close(); }
}

/** The commit the server's checkout is on, and whether it has uncommitted changes (null outside a git checkout). */
let version = null;
function appVersion() {
  if (version) return version;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const head = git('rev-parse', '--short=12', 'HEAD'), st = git('status', '--porcelain', '--untracked-files=no');
  version = { commit: head.status === 0 ? head.stdout.trim() : null, dirty: st.status === 0 ? st.stdout.trim().length > 0 : null };
  setTimeout(() => { version = null; }, 10000); // re-read now and then: commits made while it runs
  return version;
}

function send(res, code, msg) { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(msg); }

/** POST /api/bench-results?name=test1 (JSON body) → benchmarks/ea/results/test1.json (gatec-* → benchmarks/gatec/results). Names are [a-z0-9-] only. */
async function saveBench(req, res) {
  if (req.headers['x-floodsim'] !== '1') return send(res, 403, 'missing x-floodsim header');
  const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress ?? '')) return send(res, 403, 'local only');
  if (!/^[a-z0-9-]{1,40}$/.test(name)) return send(res, 400, 'bad name');
  let body = ''; for await (const chunk of req) body += chunk;
  JSON.parse(body); // must be JSON
  const dir = join(root, 'benchmarks', name.startsWith('gatec-') ? 'gatec' : 'ea', 'results'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name + '.json'), body); send(res, 200, 'saved');
}

createServer((req, res) => {
  const p = req.url.split('?')[0];
  (req.method === 'POST' && p === '/api/fetch' ? proxy(req, res) : req.method === 'POST' && p === '/api/bench-results' ? saveBench(req, res)
    : p === '/api/version' ? Promise.resolve().then(() => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(appVersion())); })
    : p === '/api/bluetopo' ? blueTopo(req, res) : p.startsWith('/api/projects') ? projects(req, res, p) : serveStatic(req, res))
    .catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, String(e.message)); });
}).listen(port, () => console.log(`FloodSim at http://localhost:${port}/app/map.html
Projects in ${projectsDir}`));
