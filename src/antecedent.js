// How wet the soil is before a historic storm, from the rain of the 5 days before it: the NRCS antecedent moisture
// condition (AMC; SCS National Engineering Handbook, section 4 Hydrology, ch. 4, table 4.2). The 5-day total puts the
// storm in AMC I (dry), II (average) or III (wet), with lower bounds in the dormant season, when little of the rain is
// taken up by plants:
//
//               AMC I (dry)    AMC II        AMC III (wet)
//   dormant     < 0.5 in       0.5–1.1 in    > 1.1 in        (November–March)
//   growing     < 1.4 in       1.4–2.1 in    > 2.1 in        (April–October)
//
// The class picks the Green-Ampt starting wetness preset (src/soil.js WETNESS): I dry, II normal, III wet. The months of
// the growing season are this app's reading for the lower 48; the handbook leaves them to local practice.
//
// The rain: the median of the USGS rain gauges (NWIS 00045) within 8 km of the site that reported through the 5 days, or
// with none, the IEM Reanalysis hourly rain at the site. The gridded record can smear one wet day: before the Charlotte
// storm of 9 January 2024 it has 1.10 in at the site, exactly on the AMC II/III line; the 13 gauges within 8 km, a median
// of 1.16 in (AMC III).
import { findRainGauges, growBox } from './raingauge.js';
import { fetchHourly } from './history.js';

const IN = 25.4, DAY = 86400e3, HOUR = 3600e3;
/** NRCS 5-day bounds (inches) between AMC I / II and II / III. */
export const AMC_IN = { dormant: [0.5, 1.1], growing: [1.4, 2.1] };
/** The starting wetness preset each class takes. */
export const AMC_WETNESS = { I: 'dry', II: 'normal', III: 'wet' };
/** April–October (UTC month of t, ms). */
export const growingSeason = (t) => { const m = new Date(t).getUTCMonth() + 1; return m >= 4 && m <= 10; };

/** The class of a 5-day total (mm) before a storm starting at t (ms UTC). → { season, amc, wetness, bounds: [mm, mm] } */
export function amcClass(mm, t) {
  const season = growingSeason(t) ? 'growing' : 'dormant', bounds = AMC_IN[season].map(v => v * IN);
  const amc = mm < bounds[0] ? 'I' : mm > bounds[1] ? 'III' : 'II';
  return { season, amc, wetness: AMC_WETNESS[amc], bounds };
}

/**
 * A gauge's rain over (a, b] (ms UTC), or null when it did not report through the window: its first reading more than
 * `slack` after a, or its last more than `slack` before b.
 */
export function gaugeTotal(g, a, b, slack = 6 * HOUR) {
  let mm = 0, first = Infinity, last = -Infinity;
  g.t.forEach((t, i) => { if (t > a && t <= b) { mm += g.mm[i]; first = Math.min(first, t); last = Math.max(last, t); } });
  return first - a <= slack && b - last <= slack ? mm : null;
}

const median = (v) => { const s = [...v].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const km = ([lon, lat], g) => Math.hypot((g.lon - lon) * Math.cos(lat * Math.PI / 180), g.lat - lat) * 111.32;

/**
 * The rain of the `days` before t0 (ms UTC) at (lon, lat), and its class. → { mm, days, from, to, source, gauges:
 * [{ site, km, mm }] (nearest first; [] for the gridded record), season, amc, wetness, bounds }
 */
export async function antecedentRain(lon, lat, t0, fetcher, { days = 5, radiusKm = 8 } = {}) {
  const a = t0 - days * DAY;
  const found = await findRainGauges(growBox([lon, lat, lon, lat], radiusKm), a, t0, fetcher).catch(() => []);
  const gauges = found.map(g => ({ site: g.site, km: +km([lon, lat], g).toFixed(1), mm: gaugeTotal(g, a, t0) }))
    .filter(g => g.km <= radiusKm && g.mm != null).sort((x, y) => x.km - y.km).map(g => ({ ...g, mm: +g.mm.toFixed(1) }));
  let mm, source;
  if (gauges.length) { mm = median(gauges.map(g => g.mm)); source = `median of ${gauges.length} USGS rain gauge${gauges.length > 1 ? 's' : ''} within ${radiusKm} km`; }
  else {
    const iso = (t) => new Date(t).toISOString().slice(0, 10), h = await fetchHourly(lon, lat, iso(a - DAY), iso(t0), fetcher);
    mm = 0; h.mm.forEach((v, i) => { const t = h.t0 + i * HOUR; if (t >= a && t < t0) mm += v; }); // h.t0: the first hour's start
    source = h.source;
  }
  return { mm: +mm.toFixed(1), days, from: a, to: t0, source, gauges, ...amcClass(mm, t0) };
}
