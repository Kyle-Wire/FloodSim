// Compound flooding at a tidal site: sea-level rise at the tide gauge, a design tide for design storms, and the joint
// probability of heavy rain and high water.
//
//   SLR          the 2022 Interagency Sea Level Rise Technical Report scenarios (Low … High) at the CO-OPS station, as
//                NOAA serves them (relative to 2005), moved to the station's tidal datum epoch (e.g. 1983–2001, mid-year
//                1992) with NOAA's own offsets, so a rise adds directly to MHHW and the other datums
//   design tide  the downstream water level of a design-storm run: a still level (MHHW + a surge), a tide cycle between
//                MLLW and MHHW (period M2), or NOAA's harmonic prediction for a chosen date; high (or low) water at the
//                rain peak; plus a surge and the rise for a scenario and year. It is a water-level series like an
//                observed one, so it drives the stage boundary exactly as a historic tide does
//   joint        two-sided conditional sampling: each year's wettest day with the highest water within a day of it, and
//                each year's highest water with the most rain within a day of it. Kendall's τ of those events gives a
//                Gumbel copula (independence if τ ≤ 0); the marginals are GEVs (L-moments) of the annual-maximum daily rain
//                and of NOAA's detrended annual-maximum water level above MHHW. The joint return period of an AND event
//                (both exceeded in a year) is 1 / (1 − u − v + C(u, v)), which treats the dependence of those events as
//                the dependence of the annual maxima: a common simplification, stated with the results
// Pure functions apart from the fetch* ones (which take the app's proxy `fetcher`).
import { fitGEV } from './storm.js';

export const COOPS = 'https://api.tidesandcurrents.noaa.gov';
export const ACIS = 'https://data.rcc-acis.org';
export const SLR_SCENARIOS = ['Low', 'Intermediate-Low', 'Intermediate', 'Intermediate-High', 'High'];
export const M2_HOURS = 12.4206012;

// ------------------------------------------------------------------ sea-level rise

/**
 * SLR curves from CO-OPS `slr_projections` and `slr_projectionOffsets` (both in cm), as metres of rise since the tidal
 * datum epoch's mid-year. The projections are 0 in 2005; an offset RSL_OFFSET_a_b is the rise from year a to year b.
 * → { station, name, epochMid, background (m/yr), scenarios: { name: [[year, m]] }, ci: { name: [[year, lo, hi]] }, from2000 (m to add for the report's 2000 baseline) }
 */
export function slrCurves(projections, offsets, epochMid = 1992) {
  const P = projections.SlrProjections ?? projections, O = offsets?.SlrProjectionOffsets ?? offsets ?? [];
  if (!P?.length) throw new Error('no sea-level rise projections for this station');
  const cm = (x) => x / 100;
  // the level at a few anchor years, relative to 2005 (where the projections are 0), from the offsets' chain
  const anchor = new Map([[2005, 0]]);
  for (let pass = 0; pass < 3; pass++) for (const o of O) {
    const m = /RSL_OFFSET_(\d{4})_(\d{4})/.exec(o.offsetName ?? ''); if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]), d = cm(o.offset);
    if (anchor.has(b) && !anchor.has(a)) anchor.set(a, anchor.get(b) - d);
    if (anchor.has(a) && !anchor.has(b)) anchor.set(b, anchor.get(a) + d);
  }
  const background = cm(P[0].backgroundRslPerYear ?? 0);
  const epochLevel = anchor.has(epochMid) ? anchor.get(epochMid) : -(2005 - epochMid) * background; // no offset to the epoch: the background rate
  const pre = [...anchor.entries()].filter(([y]) => y < 2005 && y >= epochMid).sort((a, b) => a[0] - b[0]);
  const scenarios = {}, ci = {};
  for (const name of SLR_SCENARIOS) {
    const rows = P.filter(p => p.scenario === name).sort((a, b) => a.projectionYear - b.projectionYear);
    if (!rows.length) continue;
    scenarios[name] = [[epochMid, 0], ...pre.filter(([y]) => y > epochMid).map(([y, v]) => [y, v - epochLevel]), ...rows.map(p => [p.projectionYear, cm(p.projectionRsl) - epochLevel])];
    ci[name] = rows.map(p => [p.projectionYear, cm(p.projectionCiLow) - epochLevel, cm(p.projectionCiHigh) - epochLevel]);
  }
  return { station: P[0].stationId, name: P[0].stationName, epochMid, background, scenarios, ci, from2000: (anchor.get(2000) ?? -5 * background) - epochLevel, units: 'm since the datum epoch mid-year' };
}

/** Rise (m) since the datum epoch for a scenario and year: linear between the points, the background rate before them. */
export function slrAt(curves, scenario, year) {
  const pts = curves?.scenarios?.[scenario]; if (!pts) return 0;
  if (year <= pts[0][0]) return pts[0][1] - (pts[0][0] - year) * curves.background;
  for (let i = 1; i < pts.length; i++) if (year <= pts[i][0]) { const [y0, v0] = pts[i - 1], [y1, v1] = pts[i]; return v0 + (v1 - v0) * (year - y0) / (y1 - y0); }
  const [ya, va] = pts.at(-2), [yb, vb] = pts.at(-1); return vb + (vb - va) * (year - yb) / (yb - ya); // past the last year: its last decade's rate
}

// ------------------------------------------------------------------ datums and extreme water levels

/** Station datums (CO-OPS mdapi datums.json, metres on the station datum) → levels on NAVD88 (or MSL where it has none). */
export function stationDatums(json) {
  const d = Object.fromEntries((json.datums ?? []).map(x => [x.name, x.value]));
  const ref = Number.isFinite(d.NAVD88) ? 'NAVD88' : 'MSL', z = ref === 'NAVD88' ? d.NAVD88 : d.MSL;
  if (!Number.isFinite(z) || !Number.isFinite(d.MHHW)) throw new Error('the station has no MHHW or reference datum');
  const at = (k) => (Number.isFinite(d[k]) ? d[k] - z : null);
  const ep = /(\d{4})\s*-\s*(\d{4})/.exec(json.epoch ?? '');
  return { datum: ref, mhhw: at('MHHW'), mhw: at('MHW'), msl: at('MSL'), mtl: at('MTL'), dtl: at('DTL'), mlw: at('MLW'), mllw: at('MLLW'),
    gt: d.GT ?? (d.MHHW - d.MLLW), stnd: -z, mhhwStnd: d.MHHW, epoch: json.epoch ?? null, epochMid: ep ? (Number(ep[1]) + Number(ep[2])) / 2 : 1992,
    record: json.max != null ? { max: json.max - z, maxDate: json.maxdate, min: json.min - z } : null };
}

/** NOAA Extreme Water Levels (GEV on the detrended annual maxima), metres above MHHW at the datum epoch. → [{ rp, level, lo, hi }] */
export const ewlLevels = (json) => (json.GEV_HI?.exceedanceLevels ?? []).map(e => ({ rp: e.returnPeriod, p: e.probability, level: e.level, lo: e.lower90CI, hi: e.upper90CI })).sort((a, b) => a.rp - b.rp);
/** Level (m above MHHW) at return period T, log-linear between NOAA's return periods. */
export function ewlAt(levels, T) {
  if (!levels?.length) return null;
  if (T <= levels[0].rp) return levels[0].level;
  for (let i = 1; i < levels.length; i++) if (T <= levels[i].rp) { const a = levels[i - 1], b = levels[i], f = Math.log(T / a.rp) / Math.log(b.rp / a.rp); return a.level + f * (b.level - a.level); }
  return levels.at(-1).level;
}

// ------------------------------------------------------------------ design tide

const levelAt = (wl, ms) => { // linear, held flat beyond the series (as src/history.js levelAt)
  const { t, v } = wl; if (ms <= t[0]) return v[0]; if (ms >= t[t.length - 1]) return v[v.length - 1];
  let lo = 0, hi = t.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= ms) lo = m; else hi = m; }
  return v[lo] + (v[hi] - v[lo]) * (ms - t[lo]) / (t[hi] - t[lo]);
};
/** High (or low) water of a predicted tide nearest `ms`. → ms */
export function tideExtreme(pred, ms, phase = 'high') {
  let best = null, bd = Infinity; const s = phase === 'low' ? -1 : 1;
  for (let i = 1; i + 1 < pred.t.length; i++) {
    const a = s * pred.v[i - 1], b = s * pred.v[i], c = s * pred.v[i + 1];
    if (b >= a && b > c) { const d = Math.abs(pred.t[i] - ms); if (d < bd) { bd = d; best = pred.t[i]; } }
  }
  return best;
}

/**
 * The downstream water level of a design run, as a water-level series with times in ms from the storm's start (the run
 * starts at 0; warm-up reads the level at 0).
 *   datums   stationDatums
 *   mode     'still' (MHHW + surge), 'cycle' (MLLW … MHHW, period M2), 'predicted' (pred: a CO-OPS prediction { t, v })
 *   phase    'high' or 'low' water at peakS (s from the start: the rain peak)
 *   surge    m added throughout (e.g. a NOAA extreme water level, which is a total level above MHHW)
 *   slr      m of sea-level rise since the datum epoch
 * → { t, v, station, datum, name, design: { … what was used } }
 */
export function designTide(datums, { mode = 'still', phase = 'high', peakS = 0, startS = -6 * 3600, endS = 48 * 3600, stepS = 360, surge = 0, slr = 0, pred = null, predAt = null, station = '', name = '', label = '' } = {}) {
  const add = surge + slr, t = [], v = [];
  if (mode === 'still') for (let s = startS; s <= endS + 1e-9; s += stepS) { t.push(s * 1000); v.push(datums.mhhw + add); } // every step, as the others (a chart over the storm sees it)
  else {
    const lo = datums.mllw ?? datums.mhhw - datums.gt, w = 2 * Math.PI / (M2_HOURS * 3600), mean = (datums.mhhw + lo) / 2, amp = (datums.mhhw - lo) / 2; // the diurnal tide level, unrounded
    let ext = null;
    if (mode === 'predicted') { if (!pred?.t?.length) throw new Error('design tide: no tide prediction loaded'); ext = tideExtreme(pred, predAt, phase); if (ext == null) throw new Error('design tide: no high or low water in the prediction'); }
    for (let s = startS; s <= endS + 1e-9; s += stepS) {
      t.push(s * 1000);
      if (mode === 'cycle') v.push(mean + amp * Math.cos(w * (s - peakS) + (phase === 'low' ? Math.PI : 0)) + add);
      else v.push(levelAt(pred, ext + (s - peakS) * 1000) + add);
    }
    if (mode === 'predicted') label ||= new Date(ext).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  return { t, v, station, name, datum: datums.datum, design: { mode, phase, surgeM: surge, slrM: slr, mhhw: datums.mhhw, peakS, ...(label ? { tideAt: label } : {}) } };
}

// ------------------------------------------------------------------ joint probability

/** GEV (Hosking's k, as src/storm.js fitGEV): CDF, quantile at non-exceedance F, density. */
export const gevCdf = ({ xi, alpha, k }, x) => { const z = (x - xi) / alpha; if (Math.abs(k) < 1e-6) return Math.exp(-Math.exp(-z)); const a = 1 - k * z; return a <= 0 ? (k > 0 ? 1 : 0) : Math.exp(-(a ** (1 / k))); };
export const gevInv = ({ xi, alpha, k }, F) => { const y = -Math.log(F); return Math.abs(k) < 1e-6 ? xi - alpha * Math.log(y) : xi + alpha * (1 - y ** k) / k; };
export const gevPdf = ({ xi, alpha, k }, x) => { const z = (x - xi) / alpha; if (Math.abs(k) < 1e-6) return Math.exp(-z - Math.exp(-z)) / alpha; const a = 1 - k * z; if (a <= 0) return 0; const s = a ** (1 / k); return s / a * Math.exp(-s) / alpha; };
export { fitGEV };

/** Kendall's τ-b (ties counted on either side), with the normal-approximation z for τ = 0. */
export function kendallTau(x, y) {
  const n = x.length; let c = 0, d = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]);
    if (a === 0 && b === 0) continue; if (a === 0) { tx++; continue; } if (b === 0) { ty++; continue; }
    if (a === b) c++; else d++;
  }
  const tau = (c - d) / Math.sqrt((c + d + tx) * (c + d + ty) || 1);
  return { tau, n, z: 3 * tau * Math.sqrt(n * (n - 1)) / Math.sqrt(2 * (2 * n + 5)) };
}

/** Gumbel copula θ from Kendall's τ (θ = 1 / (1 − τ); 1 = independence for τ ≤ 0). */
export const gumbelTheta = (tau) => (tau > 0 ? 1 / (1 - tau) : 1);
export function gumbelC(u, v, th) { if (u <= 0 || v <= 0) return 0; const x = -Math.log(u), y = -Math.log(v); return Math.exp(-((x ** th + y ** th) ** (1 / th))); }
/** P(V ≤ v | U = u) = ∂C/∂u. */
export function gumbelCondU(u, v, th) {
  if (v <= 0) return 0; if (v >= 1) return 1;
  const x = -Math.log(u), y = -Math.log(v), s = x ** th + y ** th; return gumbelC(u, v, th) / u * x ** (th - 1) * s ** (1 / th - 1);
}
export function gumbelDensity(u, v, th) {
  const x = -Math.log(u), y = -Math.log(v), s = x ** th + y ** th, r = s ** (1 / th);
  return gumbelC(u, v, th) / (u * v) * (x * y) ** (th - 1) * s ** (1 / th - 2) * (r + th - 1);
}
/** Probability that both are exceeded in a year (AND). */
export const andExceed = (u, v, th) => 1 - u - v + gumbelC(u, v, th);

const bisect = (f, a, b, it = 80) => { let fa = f(a); for (let i = 0; i < it; i++) { const m = 0.5 * (a + b), fm = f(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; } return 0.5 * (a + b); };
/** The AND isoline of return period T in copula space: [[u, v]] for u across (0, 1 − 1/T). */
export function isolineUV(th, T, n = 80) {
  const p = 1 / T, umax = 1 - p, out = [];
  for (let i = 1; i < n; i++) { // denser towards the ends, where the line runs along the marginals
    const f = 0.5 - 0.5 * Math.cos(Math.PI * i / n), u = f * umax;
    const v = bisect(vv => andExceed(u, vv, th) - p, 0, 1); // andExceed falls as v rises
    out.push([u, v]);
  }
  return out;
}

/**
 * A marginal for a sample: GEV by L-moments, with a point mass at 0 when the sample has zeros (rain on a dry day).
 * → { cdf(x), inv(F), pdf(x), p0, gev } (null with fewer than 8 values to fit)
 */
export function fitMarginal(values) {
  const pos = values.filter(x => x > 0), p0 = (values.length - pos.length) / values.length, g = fitGEV(p0 > 0 && values.every(x => x >= 0) ? pos : values);
  if (!g) return null;
  if (!(p0 > 0) || values.some(x => x < 0)) return { p0: 0, gev: g, cdf: (x) => gevCdf(g, x), inv: (F) => gevInv(g, F), pdf: (x) => gevPdf(g, x) };
  return { p0, gev: g, cdf: (x) => (x <= 0 ? p0 : p0 + (1 - p0) * gevCdf(g, x)), inv: (F) => (F <= p0 ? 0 : Math.max(0, gevInv(g, (F - p0) / (1 - p0)))), pdf: (x) => (x <= 0 ? 0 : (1 - p0) * gevPdf(g, x)) };
}

/**
 * One conditional sample: X the annual maximum of its driver (marginal fitted to the whole record), Y the other at the
 * same time (marginal fitted to the sample), a Gumbel copula from Kendall's τ. One event a year, so the AND return period
 * is 1 / P(X > x, Y > y).
 */
function sampleModel(pairs, driverAM, flip) {
  const X = pairs.map(p => (flip ? p[1] : p[0])), Y = pairs.map(p => (flip ? p[0] : p[1]));
  const mx = fitMarginal(driverAM), my = fitMarginal(Y), kt = kendallTau(X, Y);
  if (!mx || !my) throw new Error(`joint analysis: too few events (${pairs.length} pairs, ${driverAM.length} annual maxima)`);
  return { mx, my, tau: kt.tau, z: kt.z, n: kt.n, theta: gumbelTheta(kt.tau) };
}

/**
 * The joint analysis from the two conditional samples (as in Bender and Jensen 2017, Jane et al. 2020): rain-driven
 * events (each year's wettest day, with the highest water within a day of it) and surge-driven events (each year's highest
 * water, with the most rain within a day of it), each with its own copula.
 *   rainAM [mm] the whole rain record's annual maxima, wlAM [m] the water level's (NOAA's detrended series)
 *   pairsRain [[mm, m]] rain-driven events, pairsWL [[mm, m]] surge-driven events
 * → { rain (GEV of rainAM), wl (GEV of wlAM), samples: { rain, wl } (τ, z, n, θ), isolines: { T: { rain: [[mm, m]], wl: [[mm, m]] } },
 *     design: [{ key, sample, label, rainMM, rainT, wlM, wlT, andT }] }   rainT / wlT: each value's own annual-maximum return period
 */
export function jointAnalysis({ rainAM, wlAM, pairsRain, pairsWL }, { Ts = [10, 50, 100], designT = 100 } = {}) {
  const rain = fitGEV(rainAM), wl = fitGEV(wlAM);
  if (!rain || !wl) throw new Error(`joint analysis: too few annual maxima (${rainAM.length} rain, ${wlAM.length} water level)`);
  const S = { rain: sampleModel(pairsRain, rainAM, false), wl: sampleModel(pairsWL, wlAM, true) };
  const toRW = (key, [u, v]) => { const m = S[key], a = m.mx.inv(u), b = m.my.inv(v); return key === 'rain' ? [a, b] : [b, a]; }; // → [rain mm, water m]
  const isolines = Object.fromEntries(Ts.map(T => [T, { rain: isolineUV(S.rain.theta, T).map(uv => toRW('rain', uv)), wl: isolineUV(S.wl.theta, T).map(uv => toRW('wl', uv)) }]));
  const Tam = (F) => 1 / (1 - F), rT = (mm) => Tam(gevCdf(rain, mm)), wT = (m) => Tam(gevCdf(wl, m)), design = [];
  for (const key of ['rain', 'wl']) {
    const m = S[key], what = key === 'rain' ? 'rain-driven' : 'surge-driven';
    // the most likely point on the design isoline: the largest joint density c(u, v)·f(x)·g(y), on the part of the line
    // this sample describes (its driver the rarer of the two by annual-maximum return period; the other sample has the rest)
    let best = null;
    for (const [u, v] of isolineUV(m.theta, designT, 400)) {
      const [mm, w] = toRW(key, [u, v]); if ((key === 'rain' ? rT(mm) < wT(w) : wT(w) < rT(mm))) continue;
      const d = gumbelDensity(u, v, m.theta) * m.mx.pdf(m.mx.inv(u)) * m.my.pdf(m.my.inv(v)); if (d > 0 && (!best || d > best.d)) best = { u, v, d };
    }
    if (best) { const [mm, w] = toRW(key, [best.u, best.v]); design.push({ key: key + '-likely', sample: key, label: `Most likely ${designT}-yr ${what} event`, rainMM: mm, rainT: rT(mm), wlM: w, wlT: wT(w), andT: designT }); }
    // the driver at its T-yr level with the median of the other at the time (the copula's conditional median)
    const u = 1 - 1 / designT, v = bisect(vv => gumbelCondU(u, vv, m.theta) - 0.5, 1e-9, 1 - 1e-12), [mm, w] = toRW(key, [u, v]);
    design.push({ key: key + '-cond', sample: key, label: key === 'rain' ? `${designT}-yr rain with its median water level` : `${designT}-yr high water with its median rain`, rainMM: mm, rainT: rT(mm), wlM: w, wlT: wT(w), andT: 1 / andExceed(u, v, m.theta) });
  }
  const pub = (m) => ({ tau: m.tau, z: m.z, n: m.n, theta: m.theta, concurrent: { ...m.my.gev, p0: m.my.p0 } });
  return { rain, wl, samples: { rain: pub(S.rain), wl: pub(S.wl) }, isolines, design, designT };
}

/**
 * The conditional samples from daily rain [{ date, mm|null }] and daily highest water { 'YYYY-MM-DD': m }: per year with
 * enough days of both, the wettest day with the highest water within ±window days (rain-driven), and the highest water
 * with the most rain within ±window days (surge-driven).
 * → { pairsRain: [[mm, m, date]], pairsWL: [[mm, m, date]], years }
 */
export function conditionalPairs(rainDaily, wlDaily, { window = 1, minDays = 300 } = {}) {
  const rain = new Map(rainDaily.filter(d => d.mm != null).map(d => [d.date, d.mm])), day = 864e5;
  const shift = (date, k) => new Date(Date.parse(date + 'T00:00Z') + k * day).toISOString().slice(0, 10);
  const around = (m, date) => { let best = null; for (let k = -window; k <= window; k++) { const x = m instanceof Map ? m.get(shift(date, k)) : m[shift(date, k)]; if (x != null && (best == null || x > best)) best = x; } return best; };
  const years = new Map(); const yr = (date) => { const y = date.slice(0, 4); if (!years.has(y)) years.set(y, { r: 0, w: 0, rMax: null, wMax: null }); return years.get(y); };
  for (const [date, mm] of rain) { const e = yr(date); e.r++; if (!e.rMax || mm > e.rMax.mm) e.rMax = { mm, date }; }
  for (const [date, m] of Object.entries(wlDaily)) { const e = yr(date); e.w++; if (!e.wMax || m > e.wMax.m) e.wMax = { m, date }; }
  const pairsRain = [], pairsWL = []; let n = 0;
  for (const [, e] of [...years].sort()) {
    if (e.r < minDays || e.w < minDays) continue;
    n++;
    const wAtR = around(wlDaily, e.rMax.date), rAtW = around(rain, e.wMax.date);
    if (wAtR != null) pairsRain.push([e.rMax.mm, wAtR, e.rMax.date]);
    if (rAtW != null) pairsWL.push([rAtW, e.wMax.m, e.wMax.date]);
  }
  return { pairsRain, pairsWL, years: n };
}

/** Annual maxima of daily highs { date: m } over years with at least `minDays` days. → [{ year, m, date }] */
export function annualHighs(highs, minDays = 300) {
  const by = new Map();
  for (const [date, m] of Object.entries(highs)) { const y = date.slice(0, 4), e = by.get(y) ?? { n: 0, m: -Infinity, date: null }; e.n++; if (m > e.m) { e.m = m; e.date = date; } by.set(y, e); }
  return [...by].filter(([, e]) => e.n >= minDays).map(([y, e]) => ({ year: Number(y), m: e.m, date: e.date }));
}

/** Annual-maximum daily rain over the years with at least `minDays` days reported. → [{ year, mm, date }] */
export function annualRain(rainDaily, minDays = 330) {
  const by = new Map();
  for (const d of rainDaily) { if (d.mm == null) continue; const y = d.date.slice(0, 4), e = by.get(y) ?? { n: 0, mm: -1, date: null }; e.n++; if (d.mm > e.mm) { e.mm = d.mm; e.date = d.date; } by.set(y, e); }
  return [...by].filter(([, e]) => e.n >= minDays).map(([y, e]) => ({ year: Number(y), mm: e.mm, date: e.date }));
}

// ------------------------------------------------------------------ data (through the app's proxy)

const getJSON = async (fetcher, url, opts) => { const r = await fetcher(url, opts); if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`); const j = await r.json(); if (j.error) throw new Error(j.error.message ?? String(j.error)); return j; };

/** Datums, SLR curves and NOAA extreme water levels for a CO-OPS station. → { station, datums, slr, ewl, notes } */
export async function fetchTideInfo(station, fetcher) {
  const notes = [];
  const datums = stationDatums(await getJSON(fetcher, `${COOPS}/mdapi/prod/webapi/stations/${station}/datums.json?units=metric`));
  const [proj, off, exc, ann] = await Promise.all([
    getJSON(fetcher, `${COOPS}/dpapi/prod/webapi/product/slr_projections.json?station=${station}&units=metric`).catch(e => { notes.push('SLR projections: ' + e.message); return null; }),
    getJSON(fetcher, `${COOPS}/dpapi/prod/webapi/product/slr_projectionOffsets.json?station=${station}`).catch(() => null),
    getJSON(fetcher, `${COOPS}/dpapi/prod/webapi/product.json?name=extremewaterlevels&station=${station}&details=exceedancelevels&levelType=high&units=metric`).catch(e => { notes.push('extreme water levels: ' + e.message); return null; }),
    getJSON(fetcher, `${COOPS}/dpapi/prod/webapi/product.json?name=extremewaterlevels&station=${station}&extremeType=annuals&levelType=high&units=metric`).catch(() => null),
  ]);
  const slr = proj ? slrCurves(proj, off, datums.epochMid) : null;
  const ewl = exc ? { levels: ewlLevels(exc), annual: (ann?.extremes ?? []).filter(e => Number.isFinite(e.value)).map(e => ({ year: e.year, m: e.value })), trendMmYr: ann?.trend ?? null, datum: 'MHHW (detrended to the datum epoch mid-year)' } : null;
  return { station, datums, slr, ewl, notes };
}

/** NOAA harmonic tide prediction (6 min) on the station's reference datum, for a UTC window. → { t, v } */
export async function fetchPrediction(station, datum, startMs, endMs, fetcher) {
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const j = await getJSON(fetcher, `${COOPS}/api/prod/datagetter?product=predictions&station=${station}&begin_date=${fmt(startMs)}&end_date=${fmt(endMs)}&datum=${datum === 'NAVD88' ? 'NAVD' : 'MSL'}&units=metric&time_zone=gmt&interval=6&format=json&application=floodsim`);
  const t = [], v = []; for (const d of j.predictions ?? []) { t.push(Date.parse(d.t.replace(' ', 'T') + 'Z')); v.push(parseFloat(d.v)); }
  if (!t.length) throw new Error('no tide prediction for this station');
  return { t, v };
}

/** The nearest ACIS precipitation station with a long, current daily record. → { uid, name, ll, km, from, to, years } */
export async function nearestRainStation(lon, lat, fetcher, { minYears = 40, pad = 0.6 } = {}) {
  const j = await getJSON(fetcher, `${ACIS}/StnMeta`, { method: 'POST', contentType: 'application/json', body: JSON.stringify({ bbox: [lon - pad, lat - pad, lon + pad, lat + pad].map(v => v.toFixed(3)).join(','), elems: 'pcpn', meta: 'uid,name,ll,valid_daterange', output: 'json' }) });
  const now = Date.now(), km = (ll) => Math.hypot((ll[0] - lon) * 111.32 * Math.cos(lat * Math.PI / 180), (ll[1] - lat) * 110.57);
  const ok = (j.meta ?? []).map(m => { const r = m.valid_daterange?.[0]; if (!r?.length || !m.ll) return null; const from = Date.parse(r[0]), to = Date.parse(r[1]); return { uid: m.uid, name: m.name, ll: m.ll, km: km(m.ll), from: r[0], to: r[1], years: (to - from) / 3.156e10, current: now - to < 2 * 3.156e10 }; })
    .filter(s => s && s.current && s.years >= minYears);
  if (!ok.length) throw new Error(`no rain gauge with ${minYears} years of daily record within ${(pad * 111).toFixed(0)} km`);
  return ok.sort((a, b) => (a.km - a.years / 10) - (b.km - b.years / 10))[0]; // nearer, and longer: ten years of record worth a km
}
/** Daily rain (mm) at an ACIS station; trace = 0, missing / accumulated / subsequent days = null. → [{ date, mm }] */
export async function fetchDailyRain(uid, fetcher, { from = 'por', to = 'por' } = {}) {
  const j = await getJSON(fetcher, `${ACIS}/StnData`, { method: 'POST', contentType: 'application/json', body: JSON.stringify({ uid, sdate: from, edate: to, elems: 'pcpn' }) });
  return parseAcisDaily(j.data ?? []);
}
export const parseAcisDaily = (rows) => rows.map(([date, s]) => ({ date, mm: s === 'T' ? 0 : /^\d+(\.\d+)?$/.test(s) ? Number(s) * 25.4 : null }));

/**
 * Daily highest water (m above MHHW, detrended to the datum epoch mid-year with the station's trend, as NOAA's annual
 * extremes are) from CO-OPS high / low tides, else hourly heights, one request a year. → { 'YYYY-MM-DD': m }
 */
export async function fetchDailyHighs(station, datums, years, fetcher, { trendMmYr = 0, onYear = () => {} } = {}) {
  const out = {}, mid = datums.epochMid + 0.5;
  for (const y of years) {
    let rows = null;
    for (const product of ['high_low', 'hourly_height']) {
      const j = await getJSON(fetcher, `${COOPS}/api/prod/datagetter?product=${product}&station=${station}&begin_date=${y}0101&end_date=${y}1231&datum=STND&units=metric&time_zone=gmt&format=json&application=floodsim`).catch(() => null);
      if (j?.data?.length) { rows = j.data; break; }
    }
    if (rows) for (const d of rows) {
      const v = parseFloat(d.v); if (!Number.isFinite(v)) continue;
      const date = d.t.slice(0, 10), frac = y + (Date.parse(d.t.replace(' ', 'T') + 'Z') - Date.UTC(y, 0, 1)) / 3.156e10;
      const m = v - datums.mhhwStnd - trendMmYr / 1000 * (frac - mid);
      if (out[date] == null || m > out[date]) out[date] = m;
    }
    onYear(y, !!rows);
  }
  return out;
}

/**
 * The whole joint analysis for a site and tide station: the rain gauge, its daily record, the station's daily highs over
 * the common years, the conditional samples, and the fit. NOAA's detrended annual maxima (the whole record) are the
 * water-level marginal when the station has them.
 */
export async function fetchJoint(lon, lat, info, fetcher, { onProgress = () => {}, maxYears = 60 } = {}) {
  onProgress('Finding a long-record rain gauge (ACIS)…');
  const gauge = await nearestRainStation(lon, lat, fetcher);
  onProgress(`Daily rain at ${gauge.name}…`);
  const rain = await fetchDailyRain(gauge.uid, fetcher);
  const y1 = new Date().getUTCFullYear() - 1, y0 = Math.max(Number(gauge.from.slice(0, 4)), y1 - maxYears + 1), years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  let got = 0;
  const highs = await fetchDailyHighs(info.station, info.datums, years, fetcher, { trendMmYr: info.ewl?.trendMmYr ?? 0, onYear: (y, ok) => { if (ok) got++; onProgress(`Water levels at ${info.station}: ${y} (${got} years with data)…`); } });
  const cp = conditionalPairs(rain, highs), noaa = info.ewl?.annual?.length >= 20;
  const wlAM = noaa ? info.ewl.annual.map(a => a.m) : annualHighs(highs).map(a => a.m);
  const rainAll = annualRain(rain); // every complete rain year, not only those with water levels
  const fit = jointAnalysis({ rainAM: rainAll.map(a => a.mm), wlAM, pairsRain: cp.pairsRain, pairsWL: cp.pairsWL });
  return { ...fit, gauge: { name: gauge.name, uid: gauge.uid, km: gauge.km, from: gauge.from, to: gauge.to }, pairsRain: cp.pairsRain, pairsWL: cp.pairsWL, pairYears: cp.years, rainYears: rainAll.length,
    wlYears: wlAM.length, wlSource: noaa ? `NOAA detrended annual maxima, ${info.ewl.annual[0].year}–${info.ewl.annual.at(-1).year}` : 'annual maxima of the daily highs', station: info.station };
}
