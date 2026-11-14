// Design storms from NOAA Atlas 14 precipitation frequency estimates at the site, and the hyetographs that drive the
// solver. Depths in mm, durations in minutes, intensities in mm/hr.
//
// The site's depth–duration–frequency (DDF) curve comes straight from the NOAA PFDS service (partial-duration series,
// median estimate plus 90% confidence bounds). A design storm of duration T and return period R is laid out with the
// alternating block method: every window of k blocks around the peak holds exactly the Atlas 14 depth for k·Δt, so
// the storm is consistent with the local DDF at every sub-duration, not only the total.

const PFDS = 'https://hdsc.nws.noaa.gov/cgi-bin/new/cgi_readH5.py';

/** Atlas 14 table rows (minutes) and columns (average recurrence interval, years). */
export const A14_DURATIONS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 5760, 10080, 14400, 28800, 43200, 64800, 86400];
export const A14_ARI = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000];

/** Parse the PFDS JavaScript-ish response into numeric tables plus metadata. */
export function parsePFDS(text) {
  const arr = (name) => {
    const m = text.match(new RegExp(`^${name}\\s*=\\s*(\\[[\\s\\S]*?\\]\\]);`, 'm'));
    return m ? JSON.parse(m[1].replace(/'/g, '"')).map(row => row.map(Number)) : null;
  };
  const str = (name) => text.match(new RegExp(`^${name}\\s*=\\s*'([^']*)'`, 'm'))?.[1] ?? null;
  const median = arr('quantiles');
  if (!median || median.length !== A14_DURATIONS.length || median[0].length !== A14_ARI.length) {
    throw new Error(str('result') && str('result') !== 'values' ? `Atlas 14: ${str('result')}` : 'Atlas 14 has no estimates for this location');
  }
  return {
    median, upper: arr('upper'), lower: arr('lower'),
    lat: Number(str('lat')), lon: Number(str('lon')), region: str('region'), volume: str('volume'), version: str('version'),
    series: str('ser'), units: str('unit'),
  };
}

/** Atlas 14 PDS depths (mm) at a point. Not available everywhere (e.g. parts of the Pacific Northwest). */
export async function fetchAtlas14(lon, lat, fetcher) {
  const url = `${PFDS}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&type=pf&data=depth&units=metric&series=pds`;
  const r = await fetcher(url);
  if (!r.ok) throw new Error(`Atlas 14 request failed (${r.status})`);
  const pf = parsePFDS(await r.text());
  if (pf.units !== 'metric') throw new Error('Atlas 14 returned non-metric depths');
  return pf;
}

/**
 * Depth (mm) for duration tMin at return period `ari`, log–log interpolated between table durations. A return period
 * between two table columns (1–1000 yr) is log–log interpolated between them too (the emulator varies it smoothly);
 * table columns are exact. `which`: 'median' | 'upper' | 'lower' (90% confidence bounds).
 */
export function ddf(pf, ari, tMin, which = 'median') {
  const col = A14_ARI.indexOf(ari);
  if (col < 0) {
    if (!(ari > A14_ARI[0] && ari < A14_ARI.at(-1))) throw new Error('return period outside the Atlas 14 table (1–1000 yr): ' + ari);
    const hi = A14_ARI.findIndex(a => a > ari), lo = hi - 1, t = Math.log(ari / A14_ARI[lo]) / Math.log(A14_ARI[hi] / A14_ARI[lo]);
    return Math.exp((1 - t) * Math.log(ddf(pf, A14_ARI[lo], tMin, which)) + t * Math.log(ddf(pf, A14_ARI[hi], tMin, which)));
  }
  const tab = pf[which], D = A14_DURATIONS;
  if (tMin <= D[0]) return tab[0][col] * tMin / D[0]; // below 5 min: constant 5-min intensity
  for (let i = 1; i < D.length; i++) if (tMin <= D[i]) {
    const a = Math.log(D[i - 1]), b = Math.log(D[i]), t = (Math.log(tMin) - a) / (b - a);
    return Math.exp(Math.log(tab[i - 1][col]) + t * (Math.log(tab[i][col]) - Math.log(tab[i - 1][col])));
  }
  return tab[D.length - 1][col];
}

/**
 * Hyetograph as blocks of constant intensity.
 * @param o.pattern 'block' (alternating block) | 'uniform'
 * @param o.peak    peak position as a fraction of the storm (0.5 = centred; 0.375 ≈ typical observed advance ratio)
 * @param o.factor  multiplier on all depths (climate uplift), default 1
 * @returns {blockMin, intensity: mm/hr per block, depth: mm per block, total, peakIntensity}
 */
export function hyetograph(pf, { ari, durationMin, blockMin = 5, pattern = 'block', peak = 0.5, which = 'median', factor = 1 }) {
  const n = Math.max(1, Math.round(durationMin / blockMin));
  const total = ddf(pf, ari, n * blockMin, which) * factor;
  let depth, order = null;
  if (pattern === 'uniform') depth = new Array(n).fill(total / n);
  else {
    // increments of the DDF curve, placed in duration order (not re-sorted): then the first k blocks placed, which are
    // contiguous around the peak, always sum to exactly D(k·Δt)
    const inc = []; let prev = 0;
    for (let k = 1; k <= n; k++) { const Dk = ddf(pf, ari, k * blockMin, which) * factor; inc.push(Dk - prev); prev = Dk; }
    depth = new Array(n).fill(0); order = [];
    const p = Math.min(n - 1, Math.max(0, Math.floor(peak * n)));
    let L = p - 1, R = p + 1, k = 1; depth[p] = inc[0]; order.push(p);
    while (k < n) { // alternate right/left of the peak; when one side runs out, keep filling the other
      const at = (R < n && (k % 2 === 1 || L < 0)) ? R++ : L >= 0 ? L-- : R++;
      depth[at] = inc[k++]; order.push(at);
    }
  }
  const intensity = depth.map(d => d * 60 / blockMin);
  return { blockMin, depth, intensity, order, total, peakIntensity: Math.max(...intensity), ari, durationMin: n * blockMin, pattern, peak, which, factor };
}

/** A constant-intensity storm in the same shape (custom mode). */
export function constantStorm(mmhr, durationMin, blockMin = 5) {
  const n = Math.max(1, Math.round(durationMin / blockMin));
  return { blockMin, depth: new Array(n).fill(mmhr * blockMin / 60), intensity: new Array(n).fill(mmhr), total: mmhr * n * blockMin / 60, peakIntensity: mmhr, durationMin: n * blockMin, pattern: 'constant' };
}

// ------------------------------------------------------------------ site-record design storms (where Atlas 14 has no estimates)

const lnGamma = (z) => { // Lanczos
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};

/** GEV fitted to annual maxima by L-moments (Hosking 1990): x(F) = ξ + α/k·(1 − (−ln F)^k). */
export function fitGEV(maxima) {
  const s = [...maxima].sort((a, b) => a - b), n = s.length;
  if (n < 8) return null;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) { b0 += s[i]; b1 += i / (n - 1) * s[i]; b2 += i * (i - 1) / ((n - 1) * (n - 2)) * s[i]; }
  b0 /= n; b1 /= n; b2 /= n;
  const l1 = b0, l2 = 2 * b1 - b0, l3 = 6 * b2 - 6 * b1 + b0, t3 = l3 / l2;
  const c = 2 / (3 + t3) - Math.log(2) / Math.log(3), k = 7.8590 * c + 2.9554 * c * c, g = Math.exp(lnGamma(1 + k));
  const alpha = l2 * k / ((1 - 2 ** -k) * g), xi = l1 - alpha * (1 - g) / k;
  return { xi, alpha, k, n, l1, l2, t3 };
}
/** Depth with annual-maximum return period T (yr). */
export const gevQuantile = ({ xi, alpha, k }, T) => { const y = -Math.log(1 - 1 / T); return Math.abs(k) < 1e-6 ? xi - alpha * Math.log(y) : xi + alpha * (1 - y ** k) / k; };
/** Partial-duration ARI (Atlas 14's convention) → equivalent annual-maximum return period (Langbein). */
export const pdsToAms = (ari) => 1 / (1 - Math.exp(-1 / ari));

/** Annual maxima of daily rainfall (mm), converted to a sliding 24-hour depth (× 1.13), years with ≥ 330 days only. */
export function annualMaxima24h(daily) {
  const by = new Map();
  for (const d of daily) { const y = d.date.slice(0, 4), e = by.get(y) ?? { n: 0, max: 0 }; e.n++; e.max = Math.max(e.max, d.mm); by.set(y, e); }
  return [...by.entries()].filter(([, e]) => e.n >= 330).map(([y, e]) => ({ year: Number(y), mm: e.max * 1.13 }));
}

/**
 * Design storm where NOAA Atlas 14 has no estimates (western Washington and Oregon): 24-hour depth from a GEV fitted
 * to the site's own record, time pattern from the site's largest recorded storm (hourly fractions of its wettest 24 h).
 */
export function recordStorm(fit, pattern, { ari, factor = 1, years }) {
  const total = gevQuantile(fit, pdsToAms(ari)) * factor;
  const depth = pattern.map(f => f * total), intensity = depth.map(d => d);
  return { blockMin: 60, depth, intensity, total, peakIntensity: Math.max(...intensity), ari, durationMin: 1440, pattern: 'record', factor,
    gev: { xi: fit.xi, alpha: fit.alpha, k: fit.k, years: fit.n }, years };
}

/** Hourly fractions of a series' wettest 24 hours (sums to 1). */
export function wettest24(series) {
  const k = Math.max(1, Math.round(60 / series.stepMin)), hours = [];
  for (let i = 0; i < series.mm.length; i += k) { let s = 0; for (let j = i; j < Math.min(i + k, series.mm.length); j++) s += series.mm[j]; hours.push(s); }
  let best = 0, at = 0, run = 0;
  for (let i = 0; i < hours.length; i++) { run += hours[i]; if (i >= 24) run -= hours[i - 24]; if (run > best) { best = run; at = Math.max(0, i - 23); } }
  const win = hours.slice(at, at + 24); while (win.length < 24) win.push(0);
  const sum = win.reduce((a, b) => a + b, 0);
  return sum > 0 ? win.map(v => v / sum) : new Array(24).fill(1 / 24);
}

/** Rain fallen by time t (s), mm: the hyetograph's depth to t (over the area: with radar rain, its mean). */
export function rainDepthTo(storm, t) {
  const bs = storm.blockMin * 60, n = Math.min(storm.intensity.length, Math.floor(t / bs + 1e-9));
  let d = 0; for (let i = 0; i < n; i++) d += storm.intensity[i] * bs / 3600; // as the solver applies it (rainAt)
  return n < storm.intensity.length ? d + storm.intensity[n] * Math.max(0, t - n * bs) / 3600 : d;
}

/** Rain rate (mm/hr) at time t (s), and the end of the block containing t (s) so a solver frame never straddles a change. */
export function rainAt(storm, t) {
  const bs = storm.blockMin * 60, i = Math.floor(t / bs + 1e-9);
  if (i >= storm.intensity.length) return { mmhr: 0, until: Infinity };
  return { mmhr: storm.intensity[i], until: (i + 1) * bs };
}
