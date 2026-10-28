// Upstream river inflow from USGS stream gauges: rivers whose basin is too large to model (the watershed check says
// so) bring their flow in across the model edge as a hydrograph.
//   historic storm  the gauge's recorded 15-minute discharge (NWIS instantaneous values) over the event
//   design storm    a hydrograph peaking at the T-year flow from the gauge's annual peaks, log-Pearson III with the
//                   station skew (method of moments on log10 flows, as Bulletin 17B; 17C's EMA adds regional skew and
//                   low-outlier tests, so treat these as planning numbers), shaped as the NRCS gamma unit hydrograph
// The flow enters at the river's crossing of the model edge (OSM waterways are drawn downstream), spread over the
// channel's lowest cells there, through the solver's exchange cells (negative rate = water in), so the books include it.
import { toCells } from './ingest.js';

export const CFS = 0.028316846592; // m³/s per ft³/s
const NWIS = 'https://waterservices.usgs.gov/nwis';

const rdb = (text) => {
  const rows = text.split('\n').filter(l => l && !l.startsWith('#')), head = rows.shift()?.split('\t') ?? []; rows.shift(); // column widths line
  return rows.map(r => Object.fromEntries(r.split('\t').map((v, i) => [head[i], v])));
};

/** Stream gauges with discharge data in a lon/lat box. → [{ site, name, lon, lat, areaMi2, altM (gauge datum, m), datum, acyM (its accuracy, m) }] */
export async function findGauges([w, s, e, n], fetcher) {
  const r = await fetcher(`${NWIS}/site/?format=rdb&bBox=${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}&siteType=ST&parameterCd=00060&hasDataTypeCd=iv&siteOutput=expanded`);
  if (!r.ok) return [];
  return rdb(await r.text()).map(o => ({ site: o.site_no, name: o.station_nm, lon: Number(o.dec_long_va), lat: Number(o.dec_lat_va), areaMi2: Number(o.drain_area_va) || null,
    altM: o.alt_va !== '' && Number.isFinite(Number(o.alt_va)) ? Number(o.alt_va) * 0.3048 : null, datum: o.alt_datum_cd || null,
    acyM: o.alt_acy_va !== '' && Number.isFinite(Number(o.alt_acy_va)) ? Number(o.alt_acy_va) * 0.3048 : null }))
    .filter(g => g.site && Number.isFinite(g.lon));
}

/** Recorded discharge between two times (ms). → [{ t (ms), q (m³/s) }] */
export async function gaugeFlows(site, t0, t1, fetcher) {
  const iso = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';
  const r = await fetcher(`${NWIS}/iv/?format=json&sites=${site}&parameterCd=00060&startDT=${iso(t0)}&endDT=${iso(t1)}`);
  if (!r.ok) throw new Error(`NWIS flows for ${site}: ${r.status}`);
  const ts = (await r.json()).value?.timeSeries?.[0]?.values?.[0]?.value ?? [];
  return ts.map(v => ({ t: Date.parse(v.dateTime), q: Number(v.value) * CFS })).filter(v => v.q >= 0 && Number.isFinite(v.t));
}

/** Annual peak flows. → [{ year, q (m³/s) }] */
export async function annualPeaks(site, fetcher) {
  const r = await fetcher(`https://nwis.waterdata.usgs.gov/nwis/peak?site_no=${site}&agency_cd=USGS&format=rdb`);
  if (!r.ok) throw new Error(`NWIS peaks for ${site}: ${r.status}`);
  return rdb(await r.text()).map(o => ({ year: Number(o.peak_dt?.slice(0, 4)), q: Number(o.peak_va) * CFS })).filter(p => p.q > 0 && p.year > 0);
}

/** Standard normal quantile (Acklam's rational approximation, |error| < 1.2e-9). */
export function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (pp) => { const r = Math.sqrt(-2 * Math.log(pp)); return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); };
  if (p < 0.02425) return tail(p);
  if (p > 1 - 0.02425) return -tail(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** T-year flood (m³/s) from annual peaks by log-Pearson III with the station skew (Wilson–Hilferty frequency factor). */
export function lp3(peaks, T) {
  const y = peaks.map(p => Math.log10(p.q)), n = y.length; if (n < 10) return null;
  const m = y.reduce((a, b) => a + b, 0) / n, s = Math.sqrt(y.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const g = n * y.reduce((a, b) => a + (b - m) ** 3, 0) / ((n - 1) * (n - 2) * s ** 3);
  const z = normInv(1 - 1 / T), K = Math.abs(g) < 1e-6 ? z : (2 / g) * ((1 + g * z / 6 - g * g / 36) ** 3 - 1);
  return 10 ** (m + K * s);
}

/** NRCS gamma-shaped hydrograph: base + (peak − base)·(t/tp)^m·e^{m(1 − t/tp)}, t in s from the start, tp > 0. */
export function designHydrograph(qPeak, tp, { base = 0.05 * qPeak, m = 3.7 } = {}) {
  return (t) => (t <= 0 ? base : base + (qPeak - base) * (t / tp) ** m * Math.exp(m * (1 - t / tp)));
}

/** Piecewise-linear flow from recorded values, held flat outside them; t in s from t0 (ms). */
export function recordedHydrograph(series, t0) {
  const v = series.map(p => ({ t: (p.t - t0) / 1000, q: p.q }));
  return (t) => {
    if (!v.length) return 0; if (t <= v[0].t) return v[0].q; if (t >= v.at(-1).t) return v.at(-1).q;
    let a = 0, b = v.length - 1; while (b - a > 1) { const k = (a + b) >> 1; if (v[k].t <= t) a = k; else b = k; }
    return v[a].q + (v[b].q - v[a].q) * (t - v[a].t) / (v[b].t - v[a].t || 1);
  };
}

/**
 * Where mapped rivers and streams enter the model: the first vertex inside the area after one outside (OSM waterways run
 * downstream). inside(i, j) on the fine grid. → [{ name, kind, at: [fi, fj] (fine cells), dir: [dx, dy] (downstream) }]
 */
export function riverEntries(fine, waterways, inside) {
  const out = [];
  for (const w of waterways ?? []) {
    if (!/river|stream|canal/.test(w.kind)) continue;
    const pts = toCells(fine, w.line);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (inside(a[0], a[1]) || !inside(b[0], b[1])) continue;
      // walk the segment to the first inside point
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L)); let p = b;
      for (let s = 1; s <= steps; s++) { const t = s / steps, q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; if (inside(q[0], q[1])) { p = q; break; } }
      const e = { name: w.name ?? '', kind: w.kind, at: p, dir: [(b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)] };
      if (!out.some(o => Math.hypot(o.at[0] - p[0], o.at[1] - p[1]) < 40 / fine.dx)) out.push(e);
    }
  }
  return out;
}

/** Solver cells that take an entry's flow: the open cells within r metres of the entry point, lowest first, up to `max`. */
export function entryCells(c, at, { r = 8, max = 12, used = new Set() } = {}) {
  const F = c.F, I = at[0] / F, J = at[1] / F, R = Math.max(1, r / F), cand = [];
  for (let j = Math.floor(J - R); j <= Math.ceil(J + R); j++) for (let i = Math.floor(I - R); i <= Math.ceil(I + R); i++) {
    if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) continue; const k = j * c.nx + i;
    if (!c.mask[k] || used.has(k) || (c.inside && !c.inside[k]) || Math.hypot(i + 0.5 - I, j + 0.5 - J) > R) continue;
    cand.push(k);
  }
  cand.sort((a, b) => c.z[a] - c.z[b]);
  const lo = c.z[cand[0]] ?? 0;
  return cand.filter(k => c.z[k] <= lo + 1.5).slice(0, max); // the channel, not the banks
}

/** A LinkHub member: each entry's flow at the middle of the next interval, spread over its cells (negative = in). */
export class InflowLinks {
  constructor(entries) {
    this.entries = entries; this.cells = entries.flatMap(e => e.cells); this.count = this.cells.length;
    this.q = new Float32Array(this.count); this.totals = { volume: 0 };
  }
  step(vol, h, interval, t) {
    for (let k = 0; k < vol.length; k++) this.totals.volume -= vol[k]; // what actually came in last interval
    let o = 0;
    for (const e of this.entries) { const q = Math.max(0, e.flow(t + interval / 2)) * (e.scale ?? 1); for (let k = 0; k < e.cells.length; k++) this.q[o + k] = -q / e.cells.length; o += e.cells.length; }
    return this.q;
  }
}
