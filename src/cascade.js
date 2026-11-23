// Emulator cascade: answer a what-if from the project emulator when it is sure enough, and send it to the solver when
// it is not. The solver stays the source of truth; the cascade decides, per request, whether a solver run is needed.
//
//   route      a request at parameter values goes to the solver when any of these hold, else the emulator answers:
//                out_of_range  a value outside the trained box (the emulator never extrapolates)
//                novel         the point is farther than `maxGap` from every training run, in the GPs' own length
//                              scales (the mean over the field's first components): an empty corner of the box
//                field_sd      the calibrated sd of the max water depth on the cells of interest (`region`, e.g. the
//                              home's lot) is above `tol.depth` at any cell (the error estimate of src/emulator.js,
//                              multiplied by the calibration factor k)
//                scalar_sd     a named scalar's calibrated sd (2σ) is above its tolerance in `tol.scalars`
//   calibrate  the emulator's sd is a model of its error, not a measurement of it. k is fitted on runs the emulator
//              did not train on (held-out runs, or the closed-form leave-one-out when there are none): the 95th
//              percentile of |error| / sd over the region's wet cells and the scalars, divided by 1.96, never below 1.
//              So a calibrated ±2σ band holds about 95 % of the real errors on those runs.
//   learn      a request the solver answered is returned as a new training run; the caller retrains with it, so the
//              cascade sends fewer requests to the solver as it goes (src/emulator.js `train`).
// Pure functions on the emulator object of src/emulator.js (train / predict) and plain arrays.
import { predict, predictField, depthFrom, maskOf } from './emulator.js';

/** Mean of the first `n` field components' length scales (unit cube), or 1s. */
export function lengthScales(em, n = 4) {
  const gps = em.field?.gps ?? []; const d = em.X[0].length, ell = new Array(d).fill(0); const m = Math.min(n, gps.length);
  if (!m) return new Array(d).fill(1);
  for (let k = 0; k < m; k++) for (let j = 0; j < d; j++) ell[j] += gps[k].ell[j] / m;
  return ell;
}
/** Distance from u to the nearest training point, in length-scale units (clipped length scales: at most 2). */
export function gap(em, u, ell = lengthScales(em)) {
  let best = Infinity;
  for (const x of em.X) { let s = 0; for (let j = 0; j < u.length; j++) s += ((u[j] - x[j]) / Math.min(ell[j], 2)) ** 2; best = Math.min(best, s); }
  return Math.sqrt(best);
}

/**
 * Emulated answer at unit point u with error estimates: depth on the masked cells (with the requested ground zm,
 * masked), its sd (the water-surface sd where wet), and the scalars { name: { mean, sd } }.
 */
export function answer(em, u, zm) {
  const p = predict(em, u), depth = depthFrom(p.wse, zm), sd = new Float32Array(depth.length);
  for (let m = 0; m < sd.length; m++) sd[m] = depth[m] > 0 || p.wse[m] - zm[m] > -2 * p.wseSd[m] ? p.wseSd[m] : 0;
  return { depth, depthSd: sd, wse: p.wse, scalars: p.scalars };
}

/**
 * Calibration factor from checks the emulator did not train on: checks = [{ u, zm (masked ground), depth (masked
 * truth), scalars: { name: value } }]. region: masked indices to judge on (null = all). → { k, ratios, n }
 */
export function calibrate(em, checks, { region = null, hmin = 0.005, q = 0.95 } = {}) {
  const ratios = [];
  for (const c of checks) {
    const a = answer(em, c.u, c.zm), cells = region ?? a.depth.map((_, m) => m);
    for (const m of cells) if (c.depth[m] > hmin || a.depth[m] > hmin) ratios.push(Math.abs(a.depth[m] - c.depth[m]) / Math.max(a.depthSd[m], 1e-4));
    for (const [k, v] of Object.entries(c.scalars ?? {})) { const s = a.scalars[k]; if (s && Number.isFinite(v)) ratios.push(Math.abs(s.mean - v) / Math.max(s.sd, 1e-6)); }
  }
  ratios.sort((a, b) => a - b);
  const qv = ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))] : 1.96;
  return { k: Math.max(1, qv / 1.96), n: ratios.length, q, quantile: qv };
}

/**
 * Route one request. u: unit point; inBox: false when a value is outside the trained box (from outOfRange);
 * zm: masked ground for the request; region: masked indices of interest; tol: { depth (m, 2σ), scalars: { name: 2σ } };
 * k: calibration factor; maxGap: novelty limit in length-scale units.
 * → { route: 'emulator' | 'solver', reasons: [...], answer (when the emulator could answer), worstSd2 (m) }
 */
export function route(em, u, { inBox = true, zm, region = null, tol = { depth: 0.03, scalars: {} }, k = 1, maxGap = 1.0, ell } = {}) {
  const reasons = [];
  if (!inBox) return { route: 'solver', reasons: ['out_of_range'], answer: null };
  const g = gap(em, u, ell); if (g > maxGap) reasons.push('novel');
  const a = answer(em, u, zm), cells = region ?? Array.from(a.depth.keys());
  let worst = 0; for (const m of cells) worst = Math.max(worst, 2 * k * a.depthSd[m]);
  if (worst > tol.depth) reasons.push('field_sd');
  const sc = {};
  for (const [name, t] of Object.entries(tol.scalars ?? {})) { const s = a.scalars[name]; if (!s) continue; sc[name] = 2 * k * s.sd; if (2 * k * s.sd > t) reasons.push('scalar_sd:' + name); }
  return { route: reasons.length ? 'solver' : 'emulator', reasons, answer: a, gap: g, worstSd2: worst, scalarSd2: sc };
}

/** Errors of an answer against the solver on the region: { rmse, maxAbs, wallErr... } (depth m; scalars as given). */
export function errors(a, truthDepth, truthScalars, region, hmin = 0.005) {
  let s2 = 0, n = 0, mx = 0;
  for (const m of region) { const t = truthDepth[m], p = a.depth[m]; if (t > hmin || p > hmin) { s2 += (p - t) ** 2; n++; mx = Math.max(mx, Math.abs(p - t)); } }
  const sc = {}; for (const [k, v] of Object.entries(truthScalars ?? {})) if (a.scalars[k]) sc[k] = a.scalars[k].mean - v;
  return { rmse: n ? Math.sqrt(s2 / n) : 0, maxAbs: mx, cells: n, scalars: sc };
}
export { maskOf, predictField };
