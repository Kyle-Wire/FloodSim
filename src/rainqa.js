// Rain QA: the rain a run used against independent point gauges near the site, over the storm's own hours.
//
// Sources (Iowa Environmental Mesonet, public, no keys):
//   • ASOS airport gauges, hourly totals (cgi-bin/request/hourlyprecip.py: the routine METAR's p01i, each row the hour
//     from about :54 before to :54 after `valid`); trace = 0.0001 in, counted as 0; hours with no row are missing
//   • CoCoRaHS volunteer gauges, daily reports (api/1/daily.geojson for a whole state network and one date): `precip`
//     is the 24 h ending at the observer's reading hour (`temp_hour`, local, usually 7 am) on that date
// The station lists come from api/1/networks.json (each network's extent and time zone) and geojson/network/<id>.geojson.
//
// Windows: an hourly gauge sums the hours whose middle falls within the storm ± padMin (gauge and radar clocks differ
// by up to an hour at the edges); a daily gauge sums every report whose 24 h overlaps the storm, so it covers more
// than the storm (the span and its extra hours are kept, and a report that adds a lot of time is flagged). The model's
// rain for the comparison is the area mean it applied (the run's hyetograph), or for a radar storm the radar at the
// gauge when the gauge lies inside the run's radar window. ratio = model / gauge, as T.rainSources in src/validate.js.
import { haversineKm, ewkbBounds } from './history.js';

const IEM = 'https://mesonet.agron.iastate.edu';
const IN = 25.4, H = 3600e3, DAY = 86400e3;

// ------------------------------------------------------------------ time zones (Intl, no tables)

/** Minutes the zone is ahead of UTC at instant ms (EDT → −240). */
export function tzOffsetMin(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(ms).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60e3);
}
/** UTC ms of `hour`:00 local on date 'YYYY-MM-DD' in zone tz. */
export function localToUTC(date, hour, tz) {
  const [y, m, d] = date.split('-').map(Number), guess = Date.UTC(y, m - 1, d, hour);
  let t = guess - tzOffsetMin(tz, guess) * 60e3;
  const off = tzOffsetMin(tz, t); t = guess - off * 60e3; // across a DST change the first guess can be an hour out
  return t;
}
/** The local calendar date 'YYYY-MM-DD' of instant ms in zone tz. */
export const localDate = (ms, tz) => new Date(ms + tzOffsetMin(tz, ms) * 60e3).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00Z') + n * DAY).toISOString().slice(0, 10);

// ------------------------------------------------------------------ stations

/** IEM networks (api/1/networks.json `data`) of `kind` ('ASOS' | 'COCORAHS') whose extent comes within km of the point. */
export function networksNear(networks, lon, lat, km, kind) {
  const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
  return networks.filter(n => new RegExp(`^[A-Z]{2}_${kind}$`).test(n.id) && n.extent).filter(n => {
    const e = ewkbBounds(n.extent); return e && lon >= e[0] - dLon && lon <= e[2] + dLon && lat >= e[1] - dLat && lat <= e[3] + dLat;
  }).map(n => ({ id: n.id, tz: n.tzname || 'UTC' }));
}
/** GeoJSON point features within km of the point, nearest first: [{ id, name, lon, lat, km, props }]. */
export function stationsNear(features, lon, lat, km) {
  return features.filter(f => f?.geometry?.type === 'Point').map(f => {
    const [slon, slat] = f.geometry.coordinates;
    return { id: f.id ?? f.properties?.station, name: f.properties?.sname ?? f.properties?.name ?? '', lon: slon, lat: slat, km: haversineKm(lon, lat, slon, slat), props: f.properties ?? {} };
  }).filter(s => s.km <= km).sort((a, b) => a.km - b.km);
}
/** An ASOS station's archive covers [t0, t1] (archive_begin / archive_end; unknown = yes). */
export const archiveCovers = (p, t0, t1) => (!p.archive_begin || Date.parse(p.archive_begin) <= t0) && (!p.archive_end || Date.parse(p.archive_end) + DAY >= t1);

// ------------------------------------------------------------------ parsers and totals

/** hourlyprecip.py CSV (station,network,valid,precip_in[,…]) → Map station → Map hour start (UTC ms) → { mm, trace }. */
export function parseHourly(csv) {
  const lines = String(csv).trim().split(/\r?\n/), head = lines.shift()?.split(',') ?? [], iS = head.indexOf('station'), iV = head.indexOf('valid'), iP = head.indexOf('precip_in');
  const out = new Map();
  if (iS < 0 || iV < 0 || iP < 0) return out;
  for (const l of lines) {
    const c = l.split(','), v = c[iP]?.trim(), t = Date.parse(c[iV].trim().replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t) || v == null || v === '' || v === 'M') continue;
    const inch = v === 'T' ? 0.0001 : parseFloat(v); if (!Number.isFinite(inch)) continue;
    if (!out.has(c[iS])) out.set(c[iS], new Map());
    out.get(c[iS]).set(t, { mm: inch <= 0.0001 ? 0 : inch * IN, trace: inch > 0 && inch <= 0.0001 });
  }
  return out;
}
/**
 * An hourly gauge over the storm: the hours whose middle lies in [t0 − pad, t1 + pad]. hours: Map hour start → { mm }.
 * → { mm, hours (expected), got, coverage, missing: [hour start ms], span: [first hour start, last hour end] }
 */
export function hourlyTotal(hours, t0, t1, padMin = 60) {
  const a = Math.ceil((t0 - padMin * 60e3 - H / 2) / H) * H, b = Math.floor((t1 + padMin * 60e3 - H / 2) / H) * H;
  let mm = 0, got = 0; const missing = [];
  for (let t = a; t <= b; t += H) { const v = hours?.get(t); if (v) { mm += v.mm; got++; } else missing.push(t); }
  const n = b >= a ? Math.round((b - a) / H) + 1 : 0;
  return { mm, hours: n, got, coverage: n ? got / n : 0, missing, span: [a, b + H] };
}
/** daily.geojson features → Map station → { name, lon, lat, mm (null = missing), trace, obsHour (null = not given) }. */
export function parseDaily(geojson) {
  const out = new Map();
  for (const f of geojson?.features ?? []) {
    const p = f.properties ?? {}, id = p.station ?? f.id; if (!id || f.geometry?.type !== 'Point') continue;
    const v = p.precip, inch = v === 'T' ? 0.0001 : v == null || v === '' || v === 'M' ? null : Number(v);
    out.set(id, { name: p.name ?? '', lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], mm: inch == null || !Number.isFinite(inch) ? null : inch <= 0.0001 ? 0 : inch * IN, trace: inch > 0 && inch <= 0.0001,
      obsHour: Number.isFinite(p.temp_hour) ? p.temp_hour : null });
  }
  return out;
}
/** The report dates (local) a daily gauge needs for a storm [t0, t1]: from the storm's first local day to the day after its last. */
export const dailyDates = (t0, t1, tz) => { const out = []; for (let d = localDate(t0, tz), e = addDays(localDate(t1, tz), 1); d <= e; d = addDays(d, 1)) out.push(d); return out; };
/**
 * A daily gauge over the storm: every report whose 24 h (to its reading hour, local) overlaps [t0, t1]. byDate: Map date →
 * the station's report on that date ({ mm, obsHour } | undefined). A missing report on a date that would be needed counts
 * against coverage; its window is taken at the station's usual hour.
 * → { mm, days: [date], got, needed, coverage, missing: [date], span: [ms, ms], extraH (hours of span beyond the storm), obsHour, assumedHour }
 */
export function dailyTotal(byDate, dates, t0, t1, tz) {
  const seen = dates.map(d => byDate.get(d)?.obsHour).filter(h => h != null), usual = seen.length ? mode(seen) : 7;
  let mm = 0, got = 0, s0 = Infinity, s1 = -Infinity; const days = [], missing = [];
  for (const d of dates) {
    const r = byDate.get(d), hr = r?.obsHour ?? usual, end = localToUTC(d, hr, tz), start = end - DAY;
    if (!(end > t0 && start < t1)) continue;
    days.push(d); s0 = Math.min(s0, start); s1 = Math.max(s1, end);
    if (r && r.mm != null) { mm += r.mm; got++; } else missing.push(d);
  }
  return { mm, days, got, needed: days.length, coverage: days.length ? got / days.length : 0, missing, span: [s0, s1], extraH: days.length ? Math.max(0, (s1 - s0 - (t1 - t0)) / H) : 0, obsHour: usual, assumedHour: !seen.length };
}
const mode = (a) => { const m = new Map(); for (const v of a) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((x, y) => y[1] - x[1])[0][0]; };

// ------------------------------------------------------------------ the storm and the model's rain

/**
 * The storm's wet window and the model's area-mean rain in it. storm: { t0, blockMin, depth (mm per block), radar?: { live?: { observedUntil } } }.
 * Leading and trailing dry blocks (a surge pad) are dropped; a live storm stops at its last observed frame (the nowcast
 * is not checked). → { t0, t1, mm, live } | null (no rain)
 */
export function stormWindow(storm) {
  if (!storm?.t0 || !storm.depth?.length) return null;
  const bs = storm.blockMin * 60e3, until = storm.radar?.live?.observedUntil ?? Infinity;
  let a = 0, b = storm.depth.length;
  while (a < b && !(storm.depth[a] > 0)) a++;
  while (b > a && !(storm.depth[b - 1] > 0)) b--;
  if (a === b) return null;
  const t0 = storm.t0 + a * bs, t1 = Math.min(storm.t0 + b * bs, until);
  if (!(t1 > t0)) return null;
  let mm = 0; for (let i = a; i < b; i++) { const s = storm.t0 + i * bs; if (s < t1) mm += storm.depth[i] * Math.min(1, (t1 - s) / bs); }
  return { t0, t1, mm, live: Number.isFinite(until) };
}
/** Is (lon, lat) inside a radar pixel window (src/mrms.js pixelWindow) with half a pixel to spare? */
export const inWindow = (win, lon, lat) => !!win && lon >= win.lon0 + win.step / 2 && lon <= win.lon0 + (win.nx - 0.5) * win.step && lat <= win.lat0 - win.step / 2 && lat >= win.lat0 - (win.ny - 0.5) * win.step;
/**
 * The radar storm's rain at a point over [t0, t1], from its frames (mm per block over win), bilinear between pixels
 * (weights: src/mrms.js sampleWeights). null when the point is outside the window.
 */
export function radarAt(storm, lon, lat, weights, t0 = -Infinity, t1 = Infinity) {
  const R = storm?.radar; if (!R?.frames || !inWindow(R.win, lon, lat)) return null;
  const w = weights(R.win, lon, lat), bs = storm.blockMin * 60e3; let mm = 0;
  R.frames.forEach((f, i) => { const s = storm.t0 + i * bs; if (!f || s + bs <= t0 || s >= t1) return; const k = Math.min(1, (Math.min(t1, s + bs) - Math.max(t0, s)) / bs); for (const [j, x] of w) mm += k * x * (f[j] || 0); });
  return mm;
}

// ------------------------------------------------------------------ the comparison

/**
 * Gauges against the model. gauges: [{ id, name, kind ('ASOS' | 'CoCoRaHS'), network, lon, lat, km, total: hourlyTotal | dailyTotal }];
 * win: stormWindow; atGauge(g) → the model's rain at the gauge (mm) or null; same(g) → the gauge is the storm's own source.
 * A gauge is scored when it covers the storm (ASOS ≥ 90 % of its hours, CoCoRaHS every report), saw at least minMM, is
 * not the storm's own source, and (daily) its reports add at most maxExtraH hours beyond the storm.
 * → { rows: [{ …gauge, gaugeMM, modelMM, modelAt, ratio, scored, why }], summary: { n, median, min, max, nearest } | null }
 */
export function compareGauges(gauges, win, { atGauge = () => null, same = () => false, minMM = 2.5, maxExtraH = 18 } = {}) {
  const rows = gauges.map(g => {
    const t = g.total, at = atGauge(g), modelMM = at ?? win.mm, gaugeMM = t.mm;
    const why = same(g) ? 'the storm\'s own rain came from this gauge' : g.kind === 'ASOS' && t.coverage < 0.9 ? `${t.hours - t.got} of ${t.hours} hours missing`
      : g.kind === 'CoCoRaHS' && t.coverage < 1 ? `no report for ${t.missing.join(', ')}` : g.kind === 'CoCoRaHS' && t.extraH > maxExtraH ? `its daily reports cover ${t.extraH.toFixed(0)} h beyond the storm`
      : !(gaugeMM >= minMM) ? `under ${minMM} mm at the gauge` : '';
    return { ...g, gaugeMM, modelMM, modelAt: at != null ? 'radar at the gauge' : 'area mean', ratio: gaugeMM > 0 ? modelMM / gaugeMM : NaN, scored: !why, why };
  });
  const ok = rows.filter(r => r.scored), rs = ok.map(r => r.ratio).sort((a, b) => a - b);
  const median = rs.length ? (rs.length % 2 ? rs[rs.length >> 1] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2) : NaN;
  const near = [...ok].sort((a, b) => a.km - b.km)[0];
  return { rows, summary: rs.length ? { n: rs.length, median, min: rs[0], max: rs.at(-1), nearest: { id: near.id, name: near.name, kind: near.kind, km: near.km, ratio: near.ratio } } : null };
}

// ------------------------------------------------------------------ fetching

/**
 * The gauges near (lon, lat) and their totals over the storm window win ({ t0, t1 }). fetcher(url) → Response.
 * At most maxASOS airport gauges and max gauges in all, nearest first. → { gauges, tz, errors: [text] }
 */
export async function nearbyGauges(lon, lat, win, fetcher, { km = 25, max = 12, maxASOS = 4, padMin = 60 } = {}) {
  const errors = [], json = async (u) => { const r = await fetcher(u); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  const nets = (await json(`${IEM}/api/1/networks.json`)).data ?? [];
  const asosNets = networksNear(nets, lon, lat, km, 'ASOS'), cocoNets = networksNear(nets, lon, lat, km, 'COCORAHS');
  const tz = (cocoNets[0] ?? asosNets[0])?.tz ?? 'UTC';
  // ASOS: the stations, then each one's hours (the end date is exclusive)
  const d0 = new Date(win.t0 - padMin * 60e3 - DAY), d1 = new Date(win.t1 + padMin * 60e3 + DAY);
  const ymd = (d, k) => `year${k}=${d.getUTCFullYear()}&month${k}=${d.getUTCMonth() + 1}&day${k}=${d.getUTCDate()}`;
  const asos = [];
  await Promise.all(asosNets.map(async (n) => {
    try { for (const s of stationsNear((await json(`${IEM}/geojson/network/${n.id}.geojson`)).features ?? [], lon, lat, km)) if (archiveCovers(s.props, win.t0, win.t1)) asos.push({ ...s, network: n.id }); }
    catch (e) { errors.push(`${n.id} station list: ${e.message}`); }
  }));
  asos.sort((a, b) => a.km - b.km).splice(maxASOS);
  const gauges = [];
  await Promise.all(asos.map(async (s) => {
    try {
      const r = await fetcher(`${IEM}/cgi-bin/request/hourlyprecip.py?network=${s.network}&station=${s.id}&${ymd(d0, 1)}&${ymd(d1, 2)}&tz=UTC`);
      if (!r.ok) throw new Error(`${r.status}`);
      gauges.push({ id: s.id, name: s.name, kind: 'ASOS', network: s.network, lon: s.lon, lat: s.lat, km: s.km, total: hourlyTotal(parseHourly(await r.text()).get(s.id), win.t0, win.t1, padMin) });
    } catch (e) { errors.push(`ASOS ${s.id}: ${e.message}`); }
  }));
  // CoCoRaHS: each network's reports on each date the storm needs, then the stations near the site that reported
  const dates = dailyDates(win.t0, win.t1, tz), byStation = new Map();
  await Promise.all(cocoNets.flatMap(n => dates.map(async (d) => {
    try {
      for (const [id, r] of parseDaily(await json(`${IEM}/api/1/daily.geojson?network=${n.id}&date=${d}`))) {
        if (!byStation.has(id)) byStation.set(id, { id, name: r.name, network: n.id, lon: r.lon, lat: r.lat, tz: n.tz, byDate: new Map() });
        byStation.get(id).byDate.set(d, r);
      }
    } catch (e) { errors.push(`${n.id} ${d}: ${e.message}`); }
  })));
  const coco = [...byStation.values()].map(s => ({ ...s, km: haversineKm(lon, lat, s.lon, s.lat) })).filter(s => s.km <= km && [...s.byDate.values()].some(r => r.mm != null))
    .map(s => ({ id: s.id, name: s.name, kind: 'CoCoRaHS', network: s.network, lon: s.lon, lat: s.lat, km: s.km, total: dailyTotal(s.byDate, dates, win.t0, win.t1, s.tz) }))
    .filter(g => g.total.needed > 0).sort((a, b) => (b.total.coverage - a.total.coverage) || (a.km - b.km)); // full reports first, then nearest
  gauges.sort((a, b) => a.km - b.km);
  gauges.push(...coco.slice(0, Math.max(0, max - gauges.length)));
  return { gauges: gauges.sort((a, b) => a.km - b.km), tz, dates, errors };
}

/**
 * The whole check for a run's storm at the site: the window, the gauges, the comparison. weights: src/mrms.js
 * sampleWeights (for a radar storm). → the object kept on rec.validation.rain.stations:
 * { window: { t0, t1, padMin, live }, modelMM, tz, rows, summary, errors, sourceGauge } | null (no rain or no time)
 */
export async function rainQA(storm, lon, lat, fetcher, { weights = null, padMin = 60, ...o } = {}) {
  const win = stormWindow(storm); if (!win) return null;
  const src = /ASOS 1-minute gauge (\w+)/.exec(storm.source ?? ''), own = src && !/timed within each hour by/.test(storm.source) ? src[1] : null;
  const { gauges, tz, dates, errors } = await nearbyGauges(lon, lat, win, fetcher, { padMin, ...o });
  const atGauge = (g) => (weights && storm.radar ? radarAt(storm, g.lon, g.lat, weights, g.kind === 'ASOS' ? g.total.span[0] : -Infinity, g.kind === 'ASOS' ? g.total.span[1] : Infinity) : null);
  const cmp = compareGauges(gauges, win, { atGauge, same: (g) => g.kind === 'ASOS' && g.id === own });
  const slim = (r) => ({ id: r.id, name: r.name, kind: r.kind, network: r.network, lon: r.lon, lat: r.lat, km: r.km, gaugeMM: r.gaugeMM, modelMM: r.modelMM, modelAt: r.modelAt, ratio: r.ratio, scored: r.scored, why: r.why,
    coverage: r.total.coverage, missing: r.kind === 'ASOS' ? r.total.missing.length : r.total.missing, span: r.total.span, ...(r.kind === 'ASOS' ? { hours: r.total.hours } : { days: r.total.days, extraH: r.total.extraH, obsHour: r.total.obsHour, assumedHour: r.total.assumedHour }) });
  return { window: { t0: win.t0, t1: win.t1, padMin, live: win.live }, modelMM: win.mm, tz, dates, rows: cmp.rows.map(slim), summary: cmp.summary, errors, sourceGauge: own };
}
