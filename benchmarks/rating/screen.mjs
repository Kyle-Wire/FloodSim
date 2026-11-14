// Screens USGS stream gauges for the rating-curve test (benchmarks/rating/README.md).
// For each gauge in the regions below: how many direct (meter or ADCP) discharge measurements since 2010 pair with a
// gage height, how high they reach against the gauge's 2-year flood, how good they are, and the datum.
// Reads only the public USGS Water Data OGC API. Writes candidates.json and prints the ranked table.
//   node benchmarks/rating/screen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const API = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections';
const here = path.dirname(fileURLToPath(import.meta.url));
const SINCE = 2010;                    // lidar era; older gage heights may sit on an older datum
const AREA = [5, 400];                 // drainage area, mi²: a channel the 1–2 m grid resolves, a reach that runs in hours
const DIRECT = /mid-section|acoustic doppler|adcp|current meter|mean-section|velocity/i;

export const REGIONS = {
  'NC Piedmont (Charlotte)':      [-81.2, 34.9, -80.5, 35.5],
  'PA Piedmont (Philadelphia)':   [-75.8, 39.8, -75.0, 40.3],
  'TX Hill Country':              [-98.5, 29.4, -97.6, 30.5],
  'CO Front Range plains':        [-105.3, 39.5, -104.6, 40.2],
  'IA agricultural':              [-93.9, 41.4, -93.2, 42.1],
  'OR Willamette (Portland)':     [-123.3, 44.8, -122.5, 45.6],
  'GA Coastal Plain':             [-82.5, 31.0, -81.5, 32.0],
  'WV/VA Appalachian':            [-80.6, 37.8, -79.8, 38.6],
};

// Every reply is cached on disk (benchmarks/rating/.cache, git-ignored): the keyless API allows 1,000 requests an
// hour, so a rerun must not ask again. Requests go one at a time, at most one every GAP ms, and a 429 waits out
// Retry-After.
const CACHE = path.join(here, '.cache');
const GAP = 400;
let last = 0;
async function get(url) {
  const file = path.join(CACHE, createHash('sha256').update(url).digest('hex') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  // USGS_API_KEY (optional, from api.waterdata.usgs.gov): sent as a header, never in the URL or the cache name
  const apiKey = process.env.USGS_API_KEY;
  for (let i = 0; ; i++) {
    const wait = last + GAP - Date.now(); if (wait > 0) await new Promise(res => setTimeout(res, wait));
    last = Date.now();
    const r = await fetch(url, apiKey ? { headers: { 'X-Api-Key': apiKey } } : {});
    if (r.ok) { const d = await r.json(); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d)); return d; }
    if (i >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`${r.status} ${url}`);
    const after = +(r.headers.get('retry-after') ?? 0);
    process.stderr.write(`  ${r.status}: waiting ${after || 5 * (i + 1)} s
`);
    await new Promise(res => setTimeout(res, 1000 * (after || 5 * (i + 1)) + 1000));
  }
}

async function all(url) {                 // follows the OGC "next" links
  const out = [];
  for (let u = url; u;) { const d = await get(u); out.push(...d.features); u = d.links?.find(l => l.rel === 'next')?.href; }
  return out;
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : NaN; };

export async function screenSite(id) {
  const fm = (await all(`${API}/field-measurements/items?monitoring_location_id=${id}&limit=10000&f=json`)).map(f => f.properties);
  const visits = new Map();
  for (const p of fm) {
    if (+p.year < SINCE) continue;
    const v = visits.get(p.field_visit_id) ?? {}; visits.set(p.field_visit_id, v);
    if (p.parameter_code === '00060' && p.reading_type === 'Discharge') Object.assign(v, { q: +p.value, how: p.observing_procedure, rated: p.measurement_rated, time: p.time });
    if (p.parameter_code === '00065' && p.reading_type === 'MeanGageHeight') v.gh = +p.value;
  }
  const pairs = [...visits.values()].filter(v => Number.isFinite(v.q) && Number.isFinite(v.gh) && v.q > 0);
  // Poor-rated measurements (> 8 %) are excluded (README, reference uncertainty); unrated ones are kept and counted
  const direct = pairs.filter(v => DIRECT.test(v.how ?? '') && !/poor/i.test(v.rated ?? ''));
  const unrated = direct.filter(v => !/excellent|good|fair/i.test(v.rated ?? '')).length;
  if (direct.length < 10) return { pairs: pairs.length, direct: direct.length };   // not a candidate: spare the peaks request
  const peaks = (await all(`${API}/peaks/items?monitoring_location_id=${id}&parameter_code=00060&limit=1000&f=json`))
    .map(f => f.properties).filter(p => +p.water_year >= 1990 && Number.isFinite(+p.value)).map(p => +p.value);
  const q2 = peaks.length >= 10 ? median(peaks) : NaN;
  const qmax = Math.max(0, ...direct.map(v => v.q));
  const good = direct.filter(v => /good|excellent/i.test(v.rated ?? '')).length;
  return { pairs: pairs.length, direct: direct.length, good, unrated, qmax, q2, nPeaks: peaks.length,
    reach: q2 > 0 ? qmax / q2 : NaN, aboveHalfQ2: q2 > 0 ? direct.filter(v => v.q >= 0.5 * q2).length : 0 };
}

async function main() {
  const rows = [];
  for (const [region, bb] of Object.entries(REGIONS)) {
    const sites = (await all(`${API}/monitoring-locations/items?bbox=${bb.join(',')}&site_type_code=ST&limit=1000&f=json`))
      .map(f => ({ ...f.properties, lon: f.geometry?.coordinates[0], lat: f.geometry?.coordinates[1] }))
      .filter(s => s.drainage_area >= AREA[0] && s.drainage_area <= AREA[1]);
    // only sites with a discharge record: one request per region instead of two per site
    const ts = await all(`${API}/time-series-metadata/items?bbox=${bb.join(',')}&parameter_code=00060&limit=1000&f=json`);
    const withQ = new Set(ts.map(f => f.properties?.monitoring_location_id).filter(Boolean));
    if (!withQ.size) throw new Error(`time-series-metadata gave no monitoring_location_id (keys: ${Object.keys(ts[0]?.properties ?? {}).join(', ')})`);
    sites.splice(0, sites.length, ...sites.filter(s => withQ.has(s.id)));
    process.stderr.write(`${region}: ${sites.length} stream sites in the area range\n`);
    for (const s of sites) {
      try {
        const m = await screenSite(s.id);
        if (m.direct >= 10) rows.push({ region, id: s.id, name: s.monitoring_location_name, areaMi2: s.drainage_area,
          datum: s.vertical_datum, altitudeFt: s.altitude, lon: s.lon, lat: s.lat, ...m });
      } catch (e) { process.stderr.write(`  ${s.id}: ${e.message}\n`); }
    }
  }
  // usable: gauged datum, measured at least to Q2/2, several high measurements
  for (const r of rows) r.usable = r.datum === 'NAVD88' && r.reach >= 0.5 && r.aboveHalfQ2 >= 3;
  rows.sort((a, b) => b.usable - a.usable || b.reach - a.reach);
  fs.writeFileSync(path.join(here, 'candidates.json'), JSON.stringify({ made: new Date().toISOString(), since: SINCE, areaMi2: AREA, rows }, null, 1));
  const f = (x, d = 0) => Number.isFinite(x) ? x.toFixed(d) : '–';
  console.log('usable | region | site | name | mi² | datum | direct (good) | max direct Q / Q2 | n ≥ Q2/2');
  for (const r of rows) console.log([r.usable ? 'yes' : 'no', r.region, r.id, r.name, f(r.areaMi2, 1), r.datum, `${r.direct} (${r.good})`,
    `${f(r.qmax)} / ${f(r.q2)} = ${f(r.reach, 2)}`, r.aboveHalfQ2].join(' | '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
