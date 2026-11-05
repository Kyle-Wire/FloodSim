// Radar rain fitted to the rain gauges in and near the area. MRMS's own gauge correction leans on whatever gauges its
// network has, which in a cloudburst can be kilometres from the storm cell, and radar reads the core of a cloudburst low
// (Charlotte, 12 June 2025: the USGS gauge inside the watershed caught 71 mm in its wettest hour, the radar at its pixel
// 42 mm; docs/METHODS.md §5.12). Many cities run dense tipping-bucket networks with USGS (NWIS parameter 00045), so
// the radar can be fitted to the gauges around the site:
//
//   1. each gauge's rain per hour G against the radar-only rain R at its pixel (bilinear) in the same hour; a gauge that
//      reported in under 90 % of the hours the radar had rain there, or caught and saw under `minMM` all storm, is left
//      out
//   2. log ratios ln((G + reg) / (R + reg)), clamped to a factor of 3 either way (a blocked or misplaced gauge), either
//      per hour or over the whole storm
//   3. a factor field over the radar window: inverse-distance weights 1 / (d² + d0²) on the log ratios, plus a neutral
//      weight 1 / R0² on ln 1 = 0, so far from every gauge the radar stands as it is
//   4. leave-one-out: each gauge's hours predicted from the field the other gauges make. Every candidate (per hour or per
//      storm, d0 of 1, 3 or 8 km) is scored by its RMS error over the gauge-hours, and the best is kept only if it
//      beats the radar alone; otherwise the radar stands, and the record says so
//   5. every 2-minute frame and hourly total times its hour's field: the radar keeps its pattern in space and within the
//      hour, the gauges set the amount around them
// Per hour fixes the cloudburst core the radar reads low; per storm only the total. Which one the gauges support
// depends on how far apart they are against the size of the storm cells, hence the leave-one-out choice.

const NWIS = 'https://waterservices.usgs.gov/nwis', IN = 25.4, HOUR = 3600e3;
export const FIT = { bufferKm: 10, minMM: 5, maxFactor: 3, reg: 1, neutralKm: 10, minCover: 0.9, d0s: [1, 3, 8], modes: ['hourly', 'storm'] };

/** NWIS instantaneous precipitation (00045, inches per interval) for a lon/lat box and window (ms UTC). */
export const rainURL = ([w, s, e, n], t0, t1) =>
  `${NWIS}/iv/?format=json&bBox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}&parameterCd=00045&startDT=${new Date(t0).toISOString().slice(0, 16)}Z&endDT=${new Date(t1).toISOString().slice(0, 16)}Z`;

/** A lon/lat box grown by km on every side. */
export function growBox([w, s, e, n], km) {
  const dLat = km / 111.32, dLon = km / (111.32 * Math.cos(((s + n) / 2) * Math.PI / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/** NWIS IV JSON → [{ site, name, lon, lat, t: [ms], mm: [] }] (increments; missing and negative values dropped). */
export function parseRain(json) {
  const out = [];
  for (const ts of json?.value?.timeSeries ?? []) {
    const g = ts.sourceInfo?.geoLocation?.geogLocation, vals = ts.values?.[0]?.value ?? [];
    const t = [], mm = [];
    for (const v of vals) { const x = Number(v.value), at = Date.parse(v.dateTime); if (Number.isFinite(x) && x >= 0 && Number.isFinite(at)) { t.push(at); mm.push(x * IN); } }
    if (g && t.length) out.push({ site: ts.sourceInfo.siteCode?.[0]?.value ?? '', name: ts.sourceInfo.siteName ?? '', lon: Number(g.longitude), lat: Number(g.latitude), t, mm });
  }
  return out;
}

/** Rain gauges reporting in a box over [t0, t1]. → parseRain's list, [] when NWIS has none or does not answer. */
export async function findRainGauges(bbox, t0, t1, fetcher) {
  const r = await fetcher(rainURL(bbox, t0, t1));
  if (!r.ok) return [];
  return parseRain(await r.json());
}

/** A gauge's rain in each hour ending at `ends` (ms UTC): mm, or NaN for an hour it sent no reading in. */
export function gaugeHours(g, ends) {
  const out = new Float64Array(ends.length).fill(NaN);
  for (let k = 0; k < g.t.length; k++) {
    const h = Math.ceil((g.t[k] - ends[0]) / HOUR); // the hour ending at ends[h] holds (end − 1 h, end]
    if (h < 0 || h >= ends.length) continue;
    out[h] = (Number.isNaN(out[h]) ? 0 : out[h]) + g.mm[k];
  }
  return out;
}

const pixelLL = (win, p) => [win.lon0 + ((p % win.nx) + 0.5) * win.step, win.lat0 - (((p / win.nx) | 0) + 0.5) * win.step];
const km = (a, b) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * 111.32);
const at = (grid, ws) => { let s = 0; for (const [i, w] of ws) s += w * (grid[i] || 0); return s; };
const sum = (a) => a.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

/**
 * The fit (steps 1–4 above). `hours`: radarRain's [{ end, total }] (radar-only totals); `sampleWeights(win, lon, lat)`
 * from src/mrms.js. → { factors: [Float32Array per pixel] per hour | null (the radar stands), mode, d0Km, n,
 * rmse: { radar, fitted } (mm per gauge-hour, leave-one-out), candidates: [{ mode, d0Km, rmse }], gauges: [{ site,
 * name, lon, lat, gaugeMM, radarMM, looMM, peak: { gaugeMM, radarMM, looMM }, used, why }] }
 */
export function fitRadar(hours, win, gauges, sampleWeights, o = {}) {
  const P = { ...FIT, ...o }, H = hours.length, cap = Math.log(P.maxFactor), rows = [];
  const lr = (G, R) => Math.max(-cap, Math.min(cap, Math.log((G + P.reg) / (R + P.reg))));
  for (const g of gauges) {
    const gh = gaugeHours(g, hours.map(h => h.end)), ws = sampleWeights(win, g.lon, g.lat);
    const rh = hours.map(h => (h.total ? at(h.total, ws) : NaN));
    const row = { site: g.site, name: g.name, lon: g.lon, lat: g.lat, gh, rh, gaugeMM: 0, radarMM: 0, looMM: null, peak: null, used: false, why: '' };
    rows.push(row);
    let wet = 0, cover = 0;
    for (let h = 0; h < H; h++) {
      if (!Number.isFinite(rh[h])) continue;
      if (rh[h] > 0) { wet++; if (!Number.isNaN(gh[h])) cover++; }
      if (!Number.isNaN(gh[h])) { row.gaugeMM += gh[h]; row.radarMM += rh[h]; }
    }
    if (wet && cover / wet < P.minCover) { row.why = `reported in ${cover} of the ${wet} hours the radar had rain there`; continue; }
    if (row.gaugeMM < P.minMM && row.radarMM < P.minMM) { row.why = `under ${P.minMM} mm in both`; continue; }
    row.used = true;
    row.storm = lr(row.gaugeMM, row.radarMM);
    if (Math.abs(Math.log((row.gaugeMM + P.reg) / (row.radarMM + P.reg))) > cap) row.why = `storm total ${(row.gaugeMM / Math.max(row.radarMM, 0.1)).toFixed(1)}× the radar's, capped at ${P.maxFactor}×`;
  }
  const used = rows.filter(r => r.used), ll = (r) => [r.lon, r.lat];
  // the log field at a point for hour h (mode 'hourly') or the storm, from the used gauges but `skip`
  const logAt = (pt, h, mode, d0, skip = null) => {
    let s = 0, w = 1 / P.neutralKm ** 2;
    for (const r of used) {
      if (r === skip) continue;
      const v = mode === 'storm' ? r.storm : Number.isNaN(r.gh[h]) || !Number.isFinite(r.rh[h]) ? null : lr(r.gh[h], r.rh[h]);
      if (v === null) continue;
      const wi = 1 / (km(pt, ll(r)) ** 2 + d0 ** 2); s += wi * v; w += wi;
    }
    return s / w;
  };
  // leave-one-out over the gauge-hours with rain in either
  const score = (mode, d0) => {
    let e2 = 0, e2r = 0, n = 0;
    for (const r of used) {
      const sf = mode === 'storm' ? Math.exp(logAt(ll(r), 0, 'storm', d0, r)) : 0;
      r.loo = r.rh.map((R, h) => (Number.isFinite(R) ? R * (mode === 'storm' ? sf : Math.exp(logAt(ll(r), h, mode, d0, r))) : NaN));
      for (let h = 0; h < H; h++) {
        const G = r.gh[h], R = r.rh[h];
        if (Number.isNaN(G) || !Number.isFinite(R) || !(G + R > 0.5)) continue;
        e2 += (r.loo[h] - G) ** 2; e2r += (R - G) ** 2; n++;
      }
    }
    return { rmse: n ? Math.sqrt(e2 / n) : Infinity, radar: n ? Math.sqrt(e2r / n) : Infinity, n };
  };
  const candidates = [];
  for (const mode of P.modes) for (const d0 of P.d0s) { const s = score(mode, d0); candidates.push({ mode, d0Km: d0, rmse: s.rmse, radar: s.radar, n: s.n }); }
  const best = candidates.reduce((a, c) => (c.rmse < a.rmse ? c : a), { rmse: Infinity });
  const radarRmse = candidates[0]?.radar ?? null, keep = used.length && best.rmse < radarRmse;
  // the gauges' leave-one-out under the kept fit (or the radar), their totals and wettest hours
  if (used.length) score(keep ? best.mode : 'storm', keep ? best.d0Km : 1);
  for (const r of used) {
    const loo = keep ? r.loo : r.rh; let k = 0;
    for (let h = 0; h < H; h++) if (r.gh[h] > (r.gh[k] || 0) || Number.isNaN(r.gh[k])) k = h;
    r.looMM = sum(r.gh.map((G, h) => (Number.isNaN(G) ? NaN : loo[h])));
    r.peak = { gaugeMM: r.gh[k], radarMM: r.rh[k], looMM: loo[k] };
  }
  let factors = null;
  if (keep) {
    const pts = Array.from({ length: win.nx * win.ny }, (_, p) => pixelLL(win, p));
    const one = (h) => Float32Array.from(pts, pt => Math.exp(logAt(pt, h, best.mode, best.d0Km)));
    if (best.mode === 'storm') { const f = one(0); factors = hours.map(() => f); } else factors = hours.map((_, h) => one(h));
  }
  return { factors, mode: keep ? best.mode : null, d0Km: keep ? best.d0Km : null, n: used.length,
    rmse: used.length ? { radar: radarRmse, fitted: keep ? best.rmse : radarRmse } : null,
    candidates: candidates.map(({ mode, d0Km, rmse }) => ({ mode, d0Km, rmse })),
    gauges: rows.map(({ gh, rh, loo, storm, ...r }) => r) };
}

/** Step 5: each hour's frames (30 per hour, in step with `hours`) and total times that hour's field (in place). */
export function applyFit(rr, factors) {
  const per = rr.frames.length / rr.hours.length;
  rr.frames.forEach((f, k) => { if (f) { const F = factors[Math.floor(k / per)]; for (let p = 0; p < f.length; p++) f[p] *= F[p]; } });
  rr.hours.forEach((h, i) => { if (h.total) h.total = Float32Array.from(h.total, (v, p) => v * factors[i][p]); });
  return rr;
}
