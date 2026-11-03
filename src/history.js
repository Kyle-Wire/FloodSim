// Historic storms at a site: find the events that hit it (rain record + hurricane tracks), then rebuild each one as a
// replayable hyetograph and, on the coast, an observed water-level boundary.
//
// Sources (all public, no keys):
//   • IEM Reanalysis (IEMRE) daily and hourly precipitation at the point (gridded, gauge-corrected radar), 1995 →
//   • IEM ASOS 1-minute precipitation at the nearest airport (2000 →), aggregated to 5-minute blocks
//   • NOAA NHC HURDAT2 best tracks (Atlantic + NE Pacific)
//   • NOAA CO-OPS observed water levels, NAVD88 (same vertical datum as 3DEP)
import { A14_ARI, A14_DURATIONS } from './storm.js';

const IEM = 'https://mesonet.agron.iastate.edu';
const NHC = 'https://www.nhc.noaa.gov/data/hurdat/';
const COOPS = 'https://api.tidesandcurrents.noaa.gov';
const IN = 25.4;
const day = 86400e3;
const iso = (d) => d.toISOString().slice(0, 10);

export function haversineKm(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ------------------------------------------------------------------ event catalog

/**
 * Daily precipitation (mm) at the point since `start`: the IEM Reanalysis grid where it exists (lower 48), else the
 * nearest airport gauge's daily record (Alaska, Hawaii, Puerto Rico, territories). The array carries `.source`.
 */
export async function fetchDailyRecord(lon, lat, fetcher, start = '1995-01-01', end = iso(new Date(Date.now() - 2 * day))) {
  const r = await fetcher(`${IEM}/iemre/multiday/${start}/${end}/${lat.toFixed(3)}/${lon.toFixed(3)}/json`);
  if (r.ok) {
    const out = (await r.json()).data.filter(d => d.daily_precip_in != null).map(d => ({ date: d.date, mm: d.daily_precip_in * IN }));
    out.source = 'IEM Reanalysis daily precipitation at the site'; return out;
  }
  const st = await nearestASOS(lon, lat, fetcher, 50, '1990-01-01');
  if (!st) throw new Error('no gridded record here and no airport gauge within 50 km');
  const [y1, m1, d1] = start.split('-').map(Number), [y2, m2, d2] = end.split('-').map(Number);
  const csv = await (await fetcher(`${IEM}/cgi-bin/request/daily.py?network=${st.network}&stations=${st.id}&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&var=precip_in&na=blank&format=csv`)).text();
  const out = csv.trim().split('\n').slice(1).map(l => l.split(',')).filter(c => c[2] !== '' && c[2] != null && Number.isFinite(parseFloat(c[2])))
    .map(c => ({ date: c[1], mm: parseFloat(c[2]) * IN }));
  if (!out.length) throw new Error(`no daily record at ${st.id}`);
  out.source = `daily record at airport gauge ${st.id} (${st.name}, ${st.km.toFixed(0)} km)`; out.station = st;
  return out;
}

/** Rain events = runs of wet days (≥ 1 mm), ranked by their wettest day. */
export function rainEvents(daily, top = 12) {
  const ev = []; let cur = null;
  for (const d of daily) {
    if (d.mm >= 1) {
      if (!cur) cur = { start: d.date, end: d.date, total: 0, maxDay: 0, peakDate: d.date };
      cur.end = d.date; cur.total += d.mm; if (d.mm > cur.maxDay) { cur.maxDay = d.mm; cur.peakDate = d.date; }
    } else if (cur) { ev.push(cur); cur = null; }
  }
  if (cur) ev.push(cur);
  return ev.sort((a, b) => b.maxDay - a.maxDay).slice(0, top);
}

/** Latest HURDAT2 files (Atlantic and NE Pacific) parsed into storms with 6-hourly tracks. */
export async function fetchHurdat(fetcher) {
  const idx = await (await fetcher(NHC)).text();
  const pick = (re) => { const all = [...new Set(idx.match(re) || [])]; return all.sort((a, b) => fileStamp(a) - fileStamp(b)).pop(); };
  const files = [pick(/hurdat2-1851-[0-9-]+\.txt/g), pick(/hurdat2-nepac-[0-9-]+\.txt/g)].filter(Boolean);
  const storms = [];
  for (const f of files) storms.push(...parseHurdat(await (await fetcher(NHC + f)).text()));
  return storms;
}
const fileStamp = (f) => { const m = f.match(/-(\d{6,8})\.txt$/); if (!m) return 0; const s = m[1]; return s.length === 8 ? Number(s.slice(4) + s.slice(0, 4)) : Number('20' + s.slice(4) + s.slice(0, 4)); };

export function parseHurdat(text) {
  const out = []; let cur = null;
  for (const line of text.split('\n')) {
    const p = line.split(',').map(s => s.trim());
    if (/^(AL|EP|CP)\d{6}$/.test(p[0])) { cur = { id: p[0], name: p[1], year: Number(p[0].slice(4)), track: [] }; out.push(cur); continue; }
    if (!cur || p.length < 7 || !/^\d{8}$/.test(p[0])) continue;
    const lat = parseFloat(p[4]) * (p[4].endsWith('S') ? -1 : 1), lon = parseFloat(p[5]) * (p[5].endsWith('W') ? -1 : 1);
    const t = Date.UTC(+p[0].slice(0, 4), +p[0].slice(4, 6) - 1, +p[0].slice(6, 8), +p[1].slice(0, 2), +p[1].slice(2, 4));
    cur.track.push({ t, lat, lon, wind: Number(p[6]), status: p[3] });
  }
  return out;
}

/** Tropical cyclones whose track came within `km` of the site (interpolated hourly between best-track fixes). */
export function cyclonesNear(storms, lon, lat, km = 250, sinceYear = 1995) {
  const hits = [];
  for (const s of storms) {
    if (s.year < sinceYear) continue;
    let tIn = null, tOut = null, dmin = Infinity, wmax = 0, tMin = null;
    for (let i = 0; i + 1 < s.track.length; i++) {
      const a = s.track[i], b = s.track[i + 1];
      for (let f = 0; f < 1; f += 1 / 6) {
        const la = a.lat + f * (b.lat - a.lat), lo = a.lon + f * (b.lon - a.lon), t = a.t + f * (b.t - a.t), d = haversineKm(lon, lat, lo, la);
        if (d <= km) { tIn ??= t; tOut = t; wmax = Math.max(wmax, a.wind); if (d < dmin) { dmin = d; tMin = t; } }
      }
    }
    if (tIn != null) hits.push({ id: s.id, name: s.name === 'UNNAMED' ? s.id : titleCase(s.name), year: s.year, start: tIn, end: tOut, closest: tMin, minKm: dmin, maxWindKt: wmax });
  }
  return hits.sort((a, b) => b.start - a.start);
}
const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/** Rain events and cyclone passages merged into one list; a cyclone names the rain event it overlaps (±1 day). */
export function catalog(rain, cyclones) {
  const items = rain.map(e => ({ kind: 'rain', start: e.start, end: e.end, peakDate: e.peakDate, total: e.total, maxDay: e.maxDay, name: null, cyclone: null }));
  for (const c of cyclones) {
    const s = iso(new Date(c.start - day)), e = iso(new Date(c.end + day));
    const hit = items.find(i => i.kind === 'rain' && i.start <= e && i.end >= s);
    if (hit) { hit.name = `${c.name} (${c.year})`; hit.cyclone = c; }
    else items.push({ kind: 'cyclone', start: iso(new Date(c.start)), end: iso(new Date(c.end)), peakDate: iso(new Date(c.closest)), total: null, maxDay: null, name: `${c.name} (${c.year})`, cyclone: c });
  }
  return items;
}

// ------------------------------------------------------------------ rainfall replay

/** Hourly precipitation at the point for [startDate, endDate] (local calendar days). Returns {t0 (UTC ms), stepMin: 60, mm[]}. */
export async function fetchHourly(lon, lat, startDate, endDate, fetcher) {
  const days = []; for (let t = Date.parse(startDate); t <= Date.parse(endDate); t += day) days.push(iso(new Date(t)));
  const parts = await Promise.all(days.map(async (d) => {
    const r = await fetcher(`${IEM}/iemre/hourly/${d}/${lat.toFixed(3)}/${lon.toFixed(3)}/json`);
    if (!r.ok) throw new Error(`IEM hourly ${d} failed (${r.status})`);
    return (await r.json()).data;
  }));
  const rows = parts.flat().filter(x => x.valid_utc).sort((a, b) => a.valid_utc.localeCompare(b.valid_utc));
  // valid_utc marks the END of each hour's accumulation
  return { t0: Date.parse(rows[0].valid_utc) - 3600e3, stepMin: 60, mm: rows.map(x => (x.hourly_precip_in ?? 0) * IN), source: 'IEM Reanalysis hourly precipitation at the site' };
}

/** Nearest ASOS station (1-minute archive from 2000) within `km`, from IEM's network list. */
export async function nearestASOS(lon, lat, fetcher, km = 30, beganBy = '2001-01-01') {
  const nets = (await (await fetcher(`${IEM}/api/1/networks.json`)).json()).data
    .filter(n => /_ASOS$/.test(n.id) && n.extent).filter(n => { const e = ewkbBounds(n.extent); return e && lon >= e[0] - 0.5 && lon <= e[2] + 0.5 && lat >= e[1] - 0.5 && lat <= e[3] + 0.5; });
  let best = null;
  for (const n of nets.slice(0, 6)) {
    const g = await (await fetcher(`${IEM}/geojson/network/${n.id}.geojson`)).json();
    for (const f of g.features) {
      const [slon, slat] = f.geometry.coordinates, d = haversineKm(lon, lat, slon, slat), begin = f.properties.archive_begin;
      if (d <= km && (!best || d < best.km) && begin && begin <= beganBy) best = { id: f.id, name: f.properties.sname, km: d, lon: slon, lat: slat, network: n.id };
    }
  }
  return best;
}

/** [w, s, e, n] of a hex EWKB polygon (PostGIS, little-endian, with SRID), as IEM serves network extents. */
export function ewkbBounds(hex) {
  if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length < 34) return null;
  const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(2 * i, 2), 16);
  const dv = new DataView(b.buffer), le = b[0] === 1, type = dv.getUint32(1, le);
  let o = 5 + (type & 0x20000000 ? 4 : 0);
  if ((type & 0xff) !== 3) return null;
  const rings = dv.getUint32(o, le); o += 4; if (!rings) return null;
  const n = dv.getUint32(o, le); o += 4;
  let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
  for (let i = 0; i < n; i++, o += 16) { const x = dv.getFloat64(o, le), y = dv.getFloat64(o + 8, le); w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); nn = Math.max(nn, y); }
  return [w, s, e, nn];
}

/** ASOS 1-minute precipitation (mm per minute), UTC window. Missing minutes count as 0 and are reported. */
export async function fetchASOS1min(station, startMs, endMs, fetcher) {
  const z = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';
  const r = await fetcher(`${IEM}/cgi-bin/request/asos1min.py?station=${station}&vars=precip&sts=${z(startMs)}&ets=${z(endMs)}&sample=1min&what=view&tz=UTC`);
  if (!r.ok) throw new Error(`ASOS 1-min request failed (${r.status})`);
  const lines = (await r.text()).trim().split('\n').slice(1);
  const n = Math.round((endMs - startMs) / 60e3), mm = new Float64Array(n); let got = 0;
  for (const l of lines) {
    const c = l.split(','), t = Date.parse(c[2].replace(' ', 'T') + 'Z'), v = parseFloat(c[3]);
    const i = Math.round((t - startMs) / 60e3);
    if (i >= 0 && i < n && Number.isFinite(v)) { mm[i] = v * IN; got++; }
  }
  return { t0: startMs, stepMin: 1, mm: Array.from(mm), coverage: got / n, source: `ASOS 1-minute gauge ${station}` };
}

/**
 * Replayable storm from a rainfall series: aggregated to `blockMin`, trimmed to the wettest stretch (dry gaps longer than
 * `gapH` hours split the record). Same shape as Atlas 14 storms, so the run loop treats both alike.
 */
export function seriesStorm(series, { blockMin = series.stepMin, gapH = 6, name = 'Historic storm' } = {}) {
  const k = Math.max(1, Math.round(blockMin / series.stepMin)), blocks = [];
  for (let i = 0; i < series.mm.length; i += k) { let s = 0; for (let j = i; j < Math.min(i + k, series.mm.length); j++) s += series.mm[j]; blocks.push(s); }
  const bMin = k * series.stepMin, gap = Math.ceil(gapH * 60 / bMin);
  // wettest contiguous stretch
  let best = null, s0 = -1, dry = 0, acc = 0;
  const close = (end) => { if (s0 >= 0 && (!best || acc > best.acc)) best = { a: s0, b: end, acc }; };
  blocks.forEach((v, i) => {
    if (v > 0.05) { if (s0 < 0) { s0 = i; acc = 0; } acc += v; dry = 0; }
    else if (s0 >= 0 && ++dry > gap) { close(i - dry); s0 = -1; dry = 0; }
  });
  close(blocks.length - 1 - dry);
  if (!best) return null;
  const depth = blocks.slice(best.a, best.b + 1), intensity = depth.map(d => d * 60 / bMin);
  return { blockMin: bMin, depth, intensity, total: depth.reduce((a, b) => a + b, 0), peakIntensity: Math.max(...intensity), durationMin: depth.length * bMin,
    pattern: 'historic', name, source: series.source, t0: series.t0 + best.a * bMin * 60e3 };
}

/**
 * Site hourly totals with the gauge's timing inside each hour (method of fragments): every hour keeps the site depth
 * exactly; within it, 1-minute fragments follow the gauge (uniform when the gauge was dry but the site was not).
 */
export function blendSeries(hourly, gauge) {
  const n = hourly.mm.length * 60, mm = new Array(n).fill(0);
  for (let h = 0; h < hourly.mm.length; h++) {
    const H = hourly.mm[h]; if (!(H > 0)) continue;
    const t = hourly.t0 + h * 3600e3, g0 = Math.round((t - gauge.t0) / 60e3);
    let gs = 0; for (let m = 0; m < 60; m++) { const v = gauge.mm[g0 + m]; if (v > 0) gs += v; }
    for (let m = 0; m < 60; m++) { const v = gauge.mm[g0 + m]; mm[h * 60 + m] = gs > 0 ? H * (v > 0 ? v : 0) / gs : H / 60; }
  }
  return { t0: hourly.t0, stepMin: 1, mm, source: `${hourly.source}, timed within each hour by ${gauge.source}` };
}

/** Max depth (mm) over a moving window of `min` minutes (null when the window is shorter than the data's blocks). */
export function maxWindow(storm, min) {
  if (min < storm.blockMin) return null;
  const k = Math.max(1, Math.round(min / storm.blockMin)); let best = 0, s = 0;
  for (let i = 0; i < storm.depth.length; i++) { s += storm.depth[i]; if (i >= k) s -= storm.depth[i - k]; best = Math.max(best, s); }
  return best;
}

/** Return period (yr) of `mm` over `min` minutes at the site from the Atlas 14 table (log–log), or a bound. */
export function returnPeriod(pf, min, mm) {
  const r = A14_DURATIONS.indexOf(min); if (r < 0) return null;
  const row = pf.median[r];
  if (mm < row[0]) return { ari: null, label: '< 1-yr' };
  if (mm >= row[row.length - 1]) return { ari: 1000, label: '> 1000-yr' };
  for (let i = 1; i < row.length; i++) if (mm <= row[i]) {
    const t = (Math.log(mm) - Math.log(row[i - 1])) / (Math.log(row[i]) - Math.log(row[i - 1]));
    const ari = Math.exp(Math.log(A14_ARI[i - 1]) + t * (Math.log(A14_ARI[i]) - Math.log(A14_ARI[i - 1])));
    return { ari, label: `≈ ${ari < 10 ? ari.toFixed(1) : Math.round(ari)}-yr` };
  }
  return null;
}

// ------------------------------------------------------------------ coastal water level

/** Nearest NOAA CO-OPS water-level station within `km`. */
export async function nearestTideGauge(lon, lat, fetcher, km = 60) {
  const st = (await (await fetcher(`${COOPS}/mdapi/prod/webapi/stations.json?type=waterlevels`)).json()).stations;
  let best = null;
  for (const s of st) { const d = haversineKm(lon, lat, s.lng, s.lat); if (d <= km && (!best || d < best.km)) best = { id: s.id, name: s.name, km: d, tidal: s.tidal }; }
  return best;
}

/**
 * Observed 6-minute water level for a UTC window (split into ≤ 30-day requests), in NAVD88 where the station has it,
 * else mean sea level (Hawaii and the Pacific islands, where 3DEP elevations are on local MSL datums too).
 */
export async function fetchWaterLevel(station, startMs, endMs, fetcher) {
  try { return await fetchWaterLevelIn('NAVD', station, startMs, endMs, fetcher); }
  catch (e) { if (!/datum/i.test(e.message)) throw e; return fetchWaterLevelIn('MSL', station, startMs, endMs, fetcher); }
}
async function fetchWaterLevelIn(datum, station, startMs, endMs, fetcher, product = 'water_level') {
  const fmt = (t) => iso(new Date(t)).replace(/-/g, '');
  const t = [], v = [];
  for (let a = startMs; a < endMs; a += 30 * day) {
    const b = Math.min(endMs, a + 30 * day - 6e4);
    const r = await fetcher(`${COOPS}/api/prod/datagetter?product=${product}&station=${station}&begin_date=${fmt(a)}&end_date=${fmt(b)}&datum=${datum}&units=metric&time_zone=gmt&format=json&application=floodsim${product === 'predictions' ? '&interval=6' : ''}`);
    const j = await r.json();
    if (j.error) throw new Error(`CO-OPS: ${j.error.message}`);
    for (const d of j.data ?? j.predictions ?? []) { const tt = Date.parse(d.t.replace(' ', 'T') + 'Z'), vv = parseFloat(d.v); if (Number.isFinite(vv) && tt >= startMs && tt <= endMs) { t.push(tt); v.push(vv); } }
  }
  if (!t.length) throw new Error(`no ${product === 'predictions' ? 'tide prediction' : 'water-level data'} for this window`);
  return { t, v, station, datum: datum === 'NAVD' ? 'NAVD88' : 'MSL' };
}

/**
 * The water level for a live run: observed up to `now`, then NOAA's tide prediction plus the surge now (observed −
 * predicted, the mean over the last `span` ms of observations), carried forward unchanged to `endMs`. A station without
 * a harmonic prediction (a river gauge) holds its last observation.
 * → { t, v, station, datum, observedUntil, surge (m, null without a prediction) }
 */
export async function fetchLiveWaterLevel(station, startMs, now, endMs, fetcher) {
  const obs = await fetchWaterLevel(station, startMs, now, fetcher);
  const pred = await fetchWaterLevelIn(obs.datum === 'NAVD88' ? 'NAVD' : 'MSL', station, startMs, endMs, fetcher, 'predictions').catch(() => null);
  return liveLevel(obs, pred, endMs);
}
/** Observations then prediction + surge (see fetchLiveWaterLevel); obs and pred are { t, v } series. */
export function liveLevel(obs, pred, endMs, span = 3600e3) {
  const tEnd = obs.t[obs.t.length - 1], t = [...obs.t], v = [...obs.v];
  let surge = null;
  if (pred?.t.length) {
    const d = obs.t.map((tt, i) => (tt >= tEnd - span ? obs.v[i] - levelAt(pred, tt) : NaN)).filter(Number.isFinite);
    surge = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
    pred.t.forEach((tt, i) => { if (tt > tEnd && tt <= endMs) { t.push(tt); v.push(pred.v[i] + surge); } });
  }
  if (t[t.length - 1] < endMs) { t.push(endMs); v.push(v[v.length - 1]); }
  return { t, v, station: obs.station, datum: obs.datum, observedUntil: tEnd, surge };
}

/** Water level at time `ms` (linear interpolation, held flat beyond the record). */
export function levelAt(wl, ms) {
  const { t, v } = wl; if (ms <= t[0]) return v[0]; if (ms >= t[t.length - 1]) return v[v.length - 1];
  let lo = 0, hi = t.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= ms) lo = m; else hi = m; }
  return v[lo] + (v[hi] - v[lo]) * (ms - t[lo]) / (t[hi] - t[lo]);
}
