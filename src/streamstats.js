// Ungauged river inflow: the T-year peak of a stream with no gauge, from the USGS regional regression equations behind
// StreamStats, shaped as the NRCS dimensionless unit hydrograph and timed by the NRCS lag equation.
//   1  delineate the basin above the point      ss-delineate  GET  /v1/delineate/sshydro/{state}?lat&lon
//                                                (the point must be on StreamStats' stream grid, within ~40 m; a point
//                                                off it returns a 200 m² cell, so the caller retries on the NHDPlus
//                                                flowline nearest it)
//   2  the regression regions the basin lies in  NSS          POST /nssservices/regressionregions/bylocation (the basin)
//   3  their peak-flow equations                 NSS          GET  /nssservices/scenarios?regions&statisticgroups=2
//   4  the basin characteristics they need       ss-hydro     POST /v1/basin-characteristics/calculate (step 1's reply)
//   5  the peaks                                 NSS          POST /nssservices/scenarios/estimate?regions
// This is the published StreamStats flow-statistics workflow (USGS notebook StreamStatsFlowStatisticsWorkflow.ipynb).
// Regression peaks are for rural basins in the state's study; their error is large (average standard errors of
// prediction of 30–40 % are usual), and an urbanised basin peaks higher and sooner than they say.
//
// The hydrograph: q(t) = base + (Qp − base)·DUH((t − t0)/tp), the NRCS dimensionless unit hydrograph (NEH 630 ch. 16,
// table 16-1, peak rate factor 484), tp = D/2 + L with D = 0.133 Tc and L = 0.6 Tc, so tp = 1.11 L. Its volume above the
// base is Qp·tp·1.33 (645.33 / 484), the runoff the peak implies; the caller compares it with the storm's rain.
// L, the lag from the centroid of rain excess to the peak, is the NRCS lag equation (NEH 630 ch. 15):
//   L = l^0.8 (S + 1)^0.7 / (1900 Y^0.5) hours, l hydraulic length (ft), S = 1000 / CN − 10, Y mean basin slope (%)
// with l the longest flow path where StreamStats has it, else 209 A^0.6 (A in acres, ch. 15), and CN from the basin's
// impervious share (98 on impervious, 70 on the rest: open space in fair condition on B/C soils).
import { CFS } from './inflow.js';

export const SS = 'https://streamstats.usgs.gov';
const PRF = 484, K645 = 645.33; // NRCS peak rate factor; cfs per (in · mi² / h)

// ------------------------------------------------------------------ requests

export const delineateUrl = (state, lon, lat) => `${SS}/ss-delineate/v1/delineate/sshydro/${state}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
export const regressionRegionsUrl = () => `${SS}/nssservices/regressionregions/bylocation`;
export const scenariosUrl = (state, codes) => `${SS}/nssservices/scenarios?regions=${state}&statisticgroups=2&regressionregions=${codes.join(',')}`;
export const bcListUrl = (state) => `${SS}/ss-hydro/v1/basin-characteristics/${state}`;
export const bcUrl = () => `${SS}/ss-hydro/v1/basin-characteristics/calculate`;
export const estimateUrl = (state) => `${SS}/nssservices/scenarios/estimate?regions=${state}`;

/** The basin from a delineation reply. → { state, geometry, point: [lon, lat], areaKm2, snapped, warning, huc } */
export function parseDelineation(D) {
  const items = D?.bcrequest?.wsresp?.featurecollection?.[0] ?? [];
  const get = (name) => items.find(it => it.name === name)?.feature?.features ?? [];
  const ws = get('globalwatershed').find(f => f.properties?.GlobalWshd === 1) ?? get('globalwatershed')[0], pt = get('globalwatershedpoint')[0];
  const warning = [ws?.properties?.WarningMsg, pt?.properties?.WarningMsg].filter(Boolean).join(' ').replace(/^[\s,]+/, '').trim();
  const areaKm2 = (ws?.properties?.Shape_Area ?? 0) / 1e6;
  return { state: D?.stateAbbreviation?.toUpperCase() ?? null, geometry: ws?.geometry ?? null, point: pt?.geometry?.coordinates ?? null, areaKm2,
    snapped: !!ws?.geometry && !/not snappable/i.test(warning) && areaKm2 > 0.01, warning, huc: pt?.properties?.HUCID ?? null };
}

/** The NSS peak-flow scenarios with each parameter's value and each region's area weight filled in, ready to POST. */
export function fillScenarios(scenarios, bcs, regions) {
  const v = new Map(bcs.map(b => [String(b.code).toLowerCase(), b.value])), w = new Map(regions.map(r => [r.code, r.percentWeight]));
  return scenarios.map(s => ({ ...s, regressionRegions: s.regressionRegions.map(rg => ({ ...rg, ...(w.has(rg.code) ? { percentWeight: w.get(rg.code) } : {}),
    parameters: rg.parameters.map(p => ({ ...p, value: v.has(String(p.code).toLowerCase()) ? v.get(String(p.code).toLowerCase()) : p.value })) })) }));
}

// basin characteristics the timing uses, most recent first, where the state has them
const IMPERVIOUS = ['LC19IMP', 'LC16IMP', 'LC11IMP', 'IMPNLCD06', 'IMPNLCD01'];
const SLOPE = ['BSLDEM10M', 'BSLDEM30M', 'BSLOPD', 'BSLDEM250', 'BSLOPDRAW'];
const LENGTH = ['LFPLENGTH', 'LFPLNGTH'];
/** Which timing characteristics a state offers (its basin-characteristics list). → { imp, slope, length } as { code, unit } */
export function timingCodes(list) {
  const by = new Map((list ?? []).map(b => [String(b.code).toUpperCase(), b]));
  const pick = (codes) => { const c = codes.find(k => by.has(k)); return c ? { code: c, unit: by.get(c).unit ?? '' } : null; };
  return { imp: pick(IMPERVIOUS), slope: pick(SLOPE), length: pick(LENGTH) };
}

// ------------------------------------------------------------------ the peaks

/** Return period (years) of an NSS peak-flow code: PK1AEP (1 % AEP) → 100, PK0_2AEP → 500, the older PK100 → 100. */
export function returnPeriodOf(code) {
  let m = /^PK(\d+(?:_\d+)?)AEP$/i.exec(code ?? ''); if (m) return Math.round(100 / Number(m[1].replace('_', '.')));
  m = /^PK(\d+)$/i.exec(code ?? ''); return m ? Number(m[1]) : null;
}
const Z90 = 1.6449;
/**
 * A 90 % prediction interval from a standard error: in percent (the usual NSS ASEp / SEp), converted to log10 units as
 * USGS does (Sl = √ln(1 + (SE/100)²) / ln 10), or already in log10 units when 3 or less. It ignores the basin's own
 * leverage, so it is the region's average width, slightly narrower than a site-specific interval. → [lo, hi]
 */
export function interval90(q, se) {
  if (!(se > 0)) return [NaN, NaN];
  const sl = se > 3 ? Math.sqrt(Math.log(1 + (se / 100) ** 2)) / Math.LN10 : se, f = 10 ** (Z90 * sl);
  return [q / f, q * f];
}

/**
 * The peaks from an NSS estimate reply. Several regression regions (a basin across a boundary) are weighted by their
 * share of the basin, as StreamStats does, unless NSS gave an area-averaged region itself.
 * → { peaks: [{ T, code, name, q, lo, hi, se, how }] (m³/s, by T), regions: [{ name, code, weight, citation, params }], warnings }
 */
export function parsePeaks(E) {
  const regions = [], warnings = [];
  for (const s of E ?? []) for (const rg of s.regressionRegions ?? []) {
    const params = (rg.parameters ?? []).map(p => ({ code: p.code, name: p.name, value: p.value, unit: p.unitType?.abbr ?? p.unitType?.unit ?? '', min: p.limits?.min ?? null, max: p.limits?.max ?? null }));
    for (const p of params) {
      p.inRange = !(p.min != null && p.value < p.min) && !(p.max != null && p.value > p.max);
      if (!p.inRange) warnings.push(`${p.name} ${p.value} ${p.unit} is outside the ${rg.name.replace(/_/g, ' ')} equations' range (${p.min}–${p.max}): the estimate is an extrapolation`);
    }
    const peaks = [];
    for (const r of rg.results ?? []) {
      const T = returnPeriodOf(r.code); if (!T || !(r.value > 0)) continue;
      const k = /ft\^?3|cfs|cubic feet/i.test(r.unit?.unit ?? r.unit?.abbr ?? 'cfs') ? CFS : 1, q = r.value * k;
      const lo = r.intervalBounds?.lower ?? r.errors?.find(e => /^PI_?L/i.test(e.code))?.value, hi = r.intervalBounds?.upper ?? r.errors?.find(e => /^PI_?U/i.test(e.code))?.value;
      const se = r.errors?.find(e => /^(A?SEp|SEP|SE|SEE)$/i.test(e.code))?.value ?? null;
      if (lo > 0 && hi > 0) peaks.push({ T, code: r.code, name: r.name, q, lo: lo * k, hi: hi * k, se, how: '90 % prediction interval from NSS' });
      else { const [a, b] = interval90(q, se); peaks.push({ T, code: r.code, name: r.name, q, lo: a, hi: b, se, how: se ? `±1.645 standard errors (${se} %)` : 'no error published' }); }
    }
    regions.push({ name: rg.name, code: rg.code, weight: rg.percentWeight ?? null, citation: rg.citationID ?? null, params, peaks: peaks.sort((a, b) => a.T - b.T), averaged: /area.?averaged/i.test(rg.name) });
  }
  const avg = regions.find(r => r.averaged), real = regions.filter(r => !r.averaged && r.peaks.length);
  let peaks = avg?.peaks ?? real[0]?.peaks ?? [];
  if (!avg && real.length > 1) { // weight by area share
    const tot = real.reduce((a, r) => a + (r.weight ?? 0), 0) || real.length;
    peaks = real[0].peaks.map(p0 => {
      const w = real.map(r => ({ r, p: r.peaks.find(p => p.T === p0.T), f: (r.weight ?? 1) / tot })).filter(x => x.p);
      const sum = (k) => w.reduce((a, x) => a + x.f * x.p[k], 0) / w.reduce((a, x) => a + x.f, 0);
      return { ...p0, q: sum('q'), lo: sum('lo'), hi: sum('hi'), how: `area-weighted over ${w.length} regression regions` };
    });
  }
  return { peaks, regions, warnings };
}
/** The peak for a return period: exact, or log-log between the published ones. → { q, lo, hi, interpolated } | null */
export function peakAt(peaks, T) {
  const ex = peaks.find(p => p.T === T); if (ex) return { ...ex, interpolated: false };
  const a = [...peaks].reverse().find(p => p.T < T), b = peaks.find(p => p.T > T); if (!a || !b) return null;
  const f = (Math.log(T) - Math.log(a.T)) / (Math.log(b.T) - Math.log(a.T)), g = (x, y) => Math.exp(Math.log(x) + f * (Math.log(y) - Math.log(x)));
  return { T, q: g(a.q, b.q), lo: g(a.lo, b.lo), hi: g(a.hi, b.hi), se: null, how: `log-log between the ${a.T}- and ${b.T}-yr`, interpolated: true };
}

// ------------------------------------------------------------------ timing and shape

/** NRCS dimensionless unit hydrograph, NEH 630 ch. 16 table 16-1: [t/tp, q/qp]. */
export const DUH = [[0, 0], [0.1, 0.03], [0.2, 0.1], [0.3, 0.19], [0.4, 0.31], [0.5, 0.47], [0.6, 0.66], [0.7, 0.82], [0.8, 0.93], [0.9, 0.99], [1, 1], [1.1, 0.99], [1.2, 0.93], [1.3, 0.86],
  [1.4, 0.78], [1.5, 0.68], [1.6, 0.56], [1.7, 0.46], [1.8, 0.39], [1.9, 0.33], [2, 0.28], [2.2, 0.207], [2.4, 0.147], [2.6, 0.107], [2.8, 0.077], [3, 0.055], [3.2, 0.04], [3.4, 0.029],
  [3.6, 0.021], [3.8, 0.015], [4, 0.011], [4.5, 0.005], [5, 0]];
/** q/qp at t/tp (linear between the table's points, 0 outside it). */
export function duh(x) {
  if (!(x > 0) || x >= 5) return 0;
  let k = 1; while (DUH[k][0] < x) k++;
  const [x0, y0] = DUH[k - 1], [x1, y1] = DUH[k]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}
/** The area under the table (trapezoids), in units of qp·tp: 1.33 for a peak rate factor of 484. */
export const DUH_AREA = DUH.slice(1).reduce((a, [x, y], i) => a + 0.5 * (y + DUH[i][1]) * (x - DUH[i][0]), 0);
/** Runoff volume (m³) a peak (m³/s) and time to peak (s) imply with the NRCS 484 peak rate factor: Qp·tp·645.33/484. */
export const runoffVolume = (qPeak, tp) => qPeak * tp * K645 / PRF;

/** NRCS curve number from the impervious share (%): 98 on impervious, `cnPervious` on the rest. */
export const cnFromImpervious = (impPct, cnPervious = 70) => 98 * impPct / 100 + cnPervious * (1 - impPct / 100);
/**
 * NRCS lag (h) from the basin. areaKm2; slopePct (mean basin slope, %); cn; lengthFt (hydraulic length; else 209 A^0.6).
 * → { lagH, tcH, tpH, lengthFt, lengthFrom, S, warnings }
 */
export function nrcsLag({ areaKm2, slopePct, cn, lengthFt = null }) {
  const warnings = [], acres = areaKm2 * 247.105, l = lengthFt > 0 ? lengthFt : 209 * acres ** 0.6;
  const Y = Math.max(0.5, slopePct), S = 1000 / Math.min(98, Math.max(40, cn)) - 10;
  const lagH = l ** 0.8 * (S + 1) ** 0.7 / (1900 * Math.sqrt(Y)), tcH = lagH / 0.6;
  if (acres > 2000) warnings.push(`the NRCS lag equation was developed for basins up to about 2,000 acres; this one is ${Math.round(acres).toLocaleString()} acres, so the timing is indicative (shift it with "River peak after the rain peak")`);
  if (cn < 50 || cn > 95) warnings.push(`curve number ${cn.toFixed(0)} is outside the lag equation's range (50–95)`);
  return { lagH, tcH, tpH: 0.5 * 0.133 * tcH + lagH, lengthFt: l, lengthFrom: lengthFt > 0 ? 'longest flow path (StreamStats)' : '209 A^0.6 (NEH 630 ch. 15)', S, warnings };
}
/**
 * The design hydrograph: base + (Qp − base)·DUH((t − tPeak)/tp + 1), peaking at tPeak (s from the start).
 * → flow(t) (m³/s), with .volume (m³ above the base, the DUH's) and .t0 (its start, s; may be before the run)
 */
export function ungaugedHydrograph(qPeak, { tPeak, tp, base = 0.05 * qPeak }) {
  const f = (t) => base + (qPeak - base) * duh((t - tPeak) / tp + 1);
  f.volume = (qPeak - base) * tp * DUH_AREA; f.t0 = tPeak - tp; f.tEnd = tPeak + 4 * tp;
  return f;
}

// ------------------------------------------------------------------ the workflow

/** Nearest point on a lon/lat polyline to a point (equirectangular locally). → [lon, lat, distance m] */
export function nearestOnLine(line, [lon, lat]) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110574;
  let best = [lon, lat, Infinity];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = [(line[i - 1][0] - lon) * kx, (line[i - 1][1] - lat) * ky], [bx, by] = [(line[i][0] - lon) * kx, (line[i][1] - lat) * ky];
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))), px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
    if (d < best[2]) best = [lon + px / kx, lat + py / ky, d];
  }
  return best;
}
/** State (USPS code) at a point, from the US Census geocoder. */
export async function stateAt(lon, lat, fetcher) {
  const r = await fetcher(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=States&format=json`);
  if (!r.ok) throw new Error(`Census geocoder ${r.status}`);
  const s = (await r.json()).result?.geographies?.States?.[0]?.STUSAB; if (!s) throw new Error('no US state at this point'); return s;
}
const json = async (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`); return r.json(); };
const post = (fetcher, url, body) => fetcher(url, { method: 'POST', body: JSON.stringify(body), contentType: 'application/json' });

/**
 * The StreamStats peaks for the basin above a stream point. flowline: the NHDPlus reach near it ([lon, lat] list) to
 * snap to when the point is off StreamStats' stream grid. progress(text) reports each step.
 * → { state, point, areaKm2, delineatedKm2, imperviousPct, slopePct, lengthFt, peaks, regions, warnings, bcs }
 */
export async function streamStatsPeaks(lon, lat, fetcher, { state = null, flowline = null, progress = () => {} } = {}) {
  state ??= await stateAt(lon, lat, fetcher);
  progress(`delineating the basin (StreamStats ${state})…`);
  let D = await json(await fetcher(delineateUrl(state, lon, lat)), 'StreamStats delineation'), b = parseDelineation(D), snap = null;
  if (!b.snapped && flowline?.length > 1) {
    snap = nearestOnLine(flowline, [lon, lat]);
    progress(`the point is off the stream grid: retrying ${Math.round(snap[2])} m away on the NHDPlus flowline…`);
    D = await json(await fetcher(delineateUrl(state, snap[0], snap[1])), 'StreamStats delineation'); b = parseDelineation(D);
  }
  if (!b.snapped) throw new Error(`StreamStats could not place the point on its stream grid (${b.warning || 'no basin'}): the river's mapped line is too far from StreamStats' stream`);
  progress('finding the regression regions…');
  const rr = await json(await post(fetcher, regressionRegionsUrl(), b.geometry), 'NSS regression regions');
  const sc = await json(await fetcher(scenariosUrl(state, rr.map(r => r.code))), 'NSS scenarios');
  const scen = (sc ?? []).filter(s => s.regressionRegions?.length);
  if (!scen.length) throw new Error(`${state} has no peak-flow regression equations for this basin in StreamStats`);
  const need = [...new Set(scen.flatMap(s => s.regressionRegions.flatMap(rg => rg.parameters.map(p => p.code))))];
  const tc = timingCodes(await json(await fetcher(bcListUrl(state)), 'StreamStats basin characteristics list').catch(() => []));
  const codes = [...new Set([...need, 'DRNAREA', tc.imp?.code, tc.slope?.code, tc.length?.code].filter(Boolean))];
  progress(`computing ${codes.length} basin characteristics…`);
  const bcs = await json(await post(fetcher, bcUrl(), { ...D, bcrequest: { ...D.bcrequest, bcLabels: codes.join(';') } }), 'StreamStats basin characteristics');
  const val = (c) => { const x = c && bcs.find(v => String(v.code).toUpperCase() === c.code.toUpperCase())?.value; return Number.isFinite(x) ? x : null; };
  progress('regression estimate…');
  const est = await json(await post(fetcher, estimateUrl(state), fillScenarios(scen, bcs, rr)), 'NSS estimate');
  const out = parsePeaks(est);
  if (!out.peaks.length) throw new Error('the NSS estimate returned no peak flows');
  const da = bcs.find(v => v.code === 'DRNAREA')?.value, slope = val(tc.slope), len = val(tc.length);
  const imp = val(tc.imp);
  if (imp > 10) out.warnings.push(`the basin is ${imp.toFixed(0)} % impervious: regional regressions are fitted mostly to rural basins, so its peak is likely higher than this (check the state report's limits on urbanisation)`);
  return { state, point: b.point ?? [lon, lat], snappedM: snap ? snap[2] : 0, areaKm2: da > 0 ? da * 2.589988 : b.areaKm2, delineatedKm2: b.areaKm2, huc: b.huc,
    imperviousPct: imp, imperviousCode: tc.imp?.code ?? null,
    slopePct: slope == null ? null : /deg/i.test(tc.slope.unit) ? 100 * Math.tan(slope * Math.PI / 180) : slope, slopeCode: tc.slope?.code ?? null,
    lengthFt: len == null ? null : len * 5280, ...out, bcs: bcs.map(v => ({ code: v.code, name: v.name, value: v.value, unit: v.unit })) };
}
