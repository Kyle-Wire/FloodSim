// Live radar rain for a run that starts in the past few hours and runs past now: the observed MRMS rain up to the
// latest 2-minute frame (src/mrms.js), then a nowcast, the latest rain carried forward along the storm's motion
// (Lagrangian persistence: no growth or decay).
//
// Observed: whole hours as for a historic storm (gauge-corrected totals once the archive has them, about 1.5 h behind;
// radar-only p1h until then, about 30 min behind), then the current part hour straight from the 2-minute frames
// (a2m, filled from the raw PrecipRate where it overflowed; about 6 min behind).
// Motion: two 10-minute rain totals 20 minutes apart over a box 1.5° round the model, matched by correlation of
// √rain (so the cores do not decide alone), coarse to fine with a sub-pixel peak. The latest 10 minutes' mean rate
// then moves at that velocity: a forecast frame at lead L samples it at x − v·(L + 5 min), the 5 minutes being the
// age of that mean. Rain that would come from outside the box counts as none.
// A nowcast of this kind is screening, not a forecast: storms grow, decay and turn within the hour, and skill falls
// off quickly after 30–60 minutes. The motion's correlation is reported with it.
import { GRID, pixelWindow, fileURL, radarRain, frameAt } from './mrms.js';

const MIN = 60e3, STEP = 2 * MIN, HOUR = 3600e3;

/** Pearson correlation of a and b shifted by (sx, sy) pixels (b(x + s) against a(x)) over their overlap. */
function corrAt(a, b, nx, ny, sx, sy) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const x0 = Math.max(0, -sx), x1 = Math.min(nx, nx - sx), y0 = Math.max(0, -sy), y1 = Math.min(ny, ny - sy);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = a[y * nx + x], q = b[(y + sy) * nx + x + sx];
    n++; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q;
  }
  if (n < 16) return -1;
  const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return va > 0 && vb > 0 ? (sab - sa * sb / n) / Math.sqrt(va * vb) : -1;
}
/** Block mean by k. */
function coarsen(f, nx, ny, k) {
  const cx = Math.floor(nx / k), cy = Math.floor(ny / k), out = new Float32Array(cx * cy);
  for (let y = 0; y < cy * k; y++) for (let x = 0; x < cx * k; x++) out[Math.floor(y / k) * cx + Math.floor(x / k)] += f[y * nx + x] / (k * k);
  return { f: out, nx: cx, ny: cy };
}

/**
 * The shift that carries field a onto field b (both nx × ny, rain), in pixels: b(x) ≈ a(x − (dx, dy)), y down.
 * → { dx, dy, score } (score: the correlation at the peak), or null with too little rain to tell.
 */
export function motion(a, b, nx, ny, maxShift = 40) {
  const wet = (f) => f.reduce((n, v) => n + (v > 0.1 ? 1 : 0), 0);
  if (wet(a) < 30 || wet(b) < 30) return null;
  const A = a.map(v => Math.sqrt(Math.max(0, v))), B = b.map(v => Math.sqrt(Math.max(0, v)));
  const k = 4, ca = coarsen(A, nx, ny, k), cb = coarsen(B, nx, ny, k), cm = Math.ceil(maxShift / k);
  let best = { sx: 0, sy: 0, r: -2 };
  for (let sy = -cm; sy <= cm; sy++) for (let sx = -cm; sx <= cm; sx++) {
    const r = corrAt(ca.f, cb.f, ca.nx, ca.ny, sx, sy); if (r > best.r) best = { sx, sy, r };
  }
  const fx = best.sx * k, fy = best.sy * k, R = new Map();
  let fine = { sx: fx, sy: fy, r: -2 };
  for (let sy = fy - k; sy <= fy + k; sy++) for (let sx = fx - k; sx <= fx + k; sx++) {
    if (Math.abs(sx) > maxShift || Math.abs(sy) > maxShift) continue;
    const r = corrAt(A, B, nx, ny, sx, sy); R.set(sx + ',' + sy, r); if (r > fine.r) fine = { sx, sy, r };
  }
  // sub-pixel: a parabola through the peak and its neighbours, each axis
  const at = (x, y) => R.get(x + ',' + y) ?? corrAt(A, B, nx, ny, x, y);
  const vertex = (m, c, p) => { const d = m - 2 * c + p; return d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (m - p) / d)) : 0; };
  const ox = vertex(at(fine.sx - 1, fine.sy), fine.r, at(fine.sx + 1, fine.sy)), oy = vertex(at(fine.sx, fine.sy - 1), fine.r, at(fine.sx, fine.sy + 1));
  return { dx: fine.sx + ox, dy: fine.sy + oy, score: fine.r };
}

/**
 * Field f on window W moved by (u, v) pixels per minute for `minutes`, sampled on window w (same grid step) → Float32Array.
 * Bilinear; from outside W, none.
 */
export function advect(f, W, w, u, v, minutes) {
  const out = new Float32Array(w.nx * w.ny), ox = Math.round((w.lon0 - W.lon0) / W.step), oy = Math.round((W.lat0 - w.lat0) / W.step);
  const val = (x, y) => (x < 0 || y < 0 || x >= W.nx || y >= W.ny ? 0 : f[y * W.nx + x]);
  for (let j = 0; j < w.ny; j++) for (let i = 0; i < w.nx; i++) {
    const x = i + ox - u * minutes, y = j + oy - v * minutes, x0 = Math.floor(x), y0 = Math.floor(y), ax = x - x0, ay = y - y0;
    out[j * w.nx + i] = (1 - ax) * (1 - ay) * val(x0, y0) + ax * (1 - ay) * val(x0 + 1, y0) + (1 - ax) * ay * val(x0, y0 + 1) + ax * ay * val(x0 + 1, y0 + 1);
  }
  return out;
}

/** The latest 2-minute frame time at or before `now` that the archive has (looks back 30 min) → ms UTC, or null. */
export async function latestFrame(now, getBytes) {
  for (let t = Math.floor(now / STEP) * STEP, k = 0; k < 15; k++, t -= STEP) if (await getBytes(fileURL('a2m', t))) return t;
  return null;
}

/**
 * Live rain over a lon/lat box: observed from the hour at or before now − obsHours to the latest frame, then
 * `leadMin` minutes of nowcast. Same shape as radarRain's result ({ win, t0, blockMin: 2, frames, stats, hours }),
 * plus live: { observedUntil (ms UTC), leadMin, motion: { u, v (px/min), kmh, toward (° from north), score } | null }.
 */
export async function liveRain(now, bbox, getBytes, { obsHours = 3, leadMin = 60, onProgress = () => {}, isWet, gauge = true } = {}) {
  const latest = await latestFrame(now, getBytes);
  if (latest == null) throw new Error('no MRMS radar frame in the last 30 minutes at IEM');
  // the last whole hour with a radar-only total (p1h lags the hour by ~30 min)
  let hEnd = Math.floor(latest / HOUR) * HOUR;
  for (let k = 0; k < 2 && !(await getBytes(fileURL('p1h', hEnd))); k++) hEnd -= HOUR;
  const S = Math.min(hEnd, Math.floor((latest - obsHours * HOUR) / HOUR) * HOUR);
  const rr = hEnd > S ? await radarRain(S, hEnd, bbox, getBytes, { onProgress, gauge, ...(isWet ? { isWet } : {}) })
    : { win: pixelWindow(bbox), t0: hEnd, blockMin: 2, frames: [], hours: [], stats: { hours: 0, wetHours: 0, missingHours: [], missingFrames: 0, wetPixelHours: 0, areaShape: 0, uniform: 0, noCoverage: 0, gaugeHours: 0, radarOnlyHours: [], gaugeGaps: 0, products: [], filledFrames: 0 } };
  const { win, stats } = rr, frames = [...rr.frames];
  // the part hour, frame by frame
  const part = []; for (let t = hEnd + STEP; t <= latest; t += STEP) part.push(t);
  let done = 0;
  for (const t of part) {
    const g = await frameAt(t, win, getBytes, stats); onProgress(++done, part.length, 'the last hour, 2-minute frames');
    if (!g) stats.missingFrames++;
    frames.push(g && g.map(v => (Number.isNaN(v) ? 0 : v)));
  }
  stats.partFrames = part.length;
  // motion and the latest rain over a wider box
  const [w, s, e, n] = bbox, big = pixelWindow([Math.max(GRID.lon0, w - 1.5), Math.max(GRID.lat0 - GRID.ny * GRID.step, s - 1.5), Math.min(GRID.lon0 + GRID.nx * GRID.step, e + 1.5), Math.min(GRID.lat0, n + 1.5)]);
  const sum = async (t1) => {
    const out = new Float32Array(big.nx * big.ny);
    for (let t = t1 - 4 * STEP; t <= t1; t += STEP) { const g = await frameAt(t, big, getBytes); if (g) for (let p = 0; p < out.length; p++) if (g[p] > 0) out[p] += g[p]; }
    return out;
  };
  onProgress(0, 1, 'storm motion');
  const [older, recent] = await Promise.all([sum(latest - 10 * STEP), sum(latest)]);
  const m = motion(older, recent, big.nx, big.ny, 40);
  const u = m ? m.dx / 20 : 0, v = m ? m.dy / 20 : 0;
  const lat = (s + n) / 2, east = u * GRID.step * 111.32 * Math.cos(lat * Math.PI / 180) * 60, north = -v * GRID.step * 110.57 * 60; // km/h
  const rate = recent.map(x => x / 5); // mm per 2 min, the last 10 minutes' mean, centred 5 min before `latest`
  for (let L = 0; L < leadMin; L += 2) frames.push(advect(rate, big, win, u, v, L + 1 + 5));
  stats.forecastFrames = leadMin / 2;
  return { win, t0: rr.t0, blockMin: 2, frames, stats, hours: rr.hours,
    live: { observedUntil: latest, leadMin, motion: m && { u, v, kmh: Math.hypot(east, north), toward: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360, score: m.score } } };
}
