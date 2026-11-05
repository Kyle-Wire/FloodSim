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
// Ensemble: members that move the same rain a little faster or slower, turned a few degrees, and growing or decaying
// (ensembleMembers), so an incoming storm gets a band (ensembleSummary: arrival, depth and peak over the area) rather
// than one answer. The spreads are typical nowcast errors, not fitted to this storm: a sensitivity band, not a probability.
// Rolling: while a run plays, newer frames replace the nowcast blocks the run has not reached, and the rest is
// nowcast again from the newest frame (newFrames, rollForward).
// Past 90 minutes (leads of 120 and 180 min): NOAA HRRR forecast rain (src/hrrr.js), a numerical model run every hour.
// The nowcast to 60 min, a linear crossfade to HRRR from 60 to 90 (BLEND), HRRR alone after: a blend of the kind
// operational systems such as STEPS and INCA use for the first hours, with fixed weights here rather
// than skill-based ones. HRRR is lower skill still at the scale of a model area; every member shares its one run.
import { GRID, pixelWindow, fileURL, radarRain, frameAt } from './mrms.js';
import { hrrrRain, rainOn } from './hrrr.js';

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

/** Velocity (px/min) at latitude lat → { u, v, kmh, toward (° clockwise from north) }. */
export function velocityInfo(u, v, lat) {
  const east = u * GRID.step * 111.32 * Math.cos(lat * Math.PI / 180) * 60, north = -v * GRID.step * 110.57 * 60; // km/h
  return { u, v, kmh: Math.hypot(east, north), toward: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360 };
}
/** (u, v) px/min with its speed × `speed` and turned `dir` degrees clockwise, in km (pixels are narrower east-west) → [u, v]. */
export function turn(u, v, lat, speed = 1, dir = 0) {
  const kx = Math.cos(lat * Math.PI / 180) * 111.32, ky = 110.57, e = u * kx, n = -v * ky, a = dir * Math.PI / 180;
  const e2 = (e * Math.cos(a) + n * Math.sin(a)) * speed, n2 = (-e * Math.sin(a) + n * Math.cos(a)) * speed;
  return [e2 / kx, -n2 / ky];
}

/**
 * The storm's motion and the rain to carry, from the frames up to `latest`, over a box 1.5° round bbox: two 10-minute
 * totals 20 minutes apart, matched (motion). → { big (its pixel window), rate (mm per 2 min: the last 10 minutes' mean,
 * centred 5 min before latest), u, v (px/min), lat, latest, motion: { u, v, kmh, toward, score } | null }
 */
export async function motionSource(latest, bbox, getBytes) {
  const [w, s, e, n] = bbox, big = pixelWindow([Math.max(GRID.lon0, w - 1.5), Math.max(GRID.lat0 - GRID.ny * GRID.step, s - 1.5), Math.min(GRID.lon0 + GRID.nx * GRID.step, e + 1.5), Math.min(GRID.lat0, n + 1.5)]);
  const sum = async (t1) => {
    const out = new Float32Array(big.nx * big.ny);
    for (let t = t1 - 4 * STEP; t <= t1; t += STEP) { const g = await frameAt(t, big, getBytes); if (g) for (let p = 0; p < out.length; p++) if (g[p] > 0) out[p] += g[p]; }
    return out;
  };
  const [older, recent] = await Promise.all([sum(latest - 10 * STEP), sum(latest)]);
  const m = motion(older, recent, big.nx, big.ny, 40), lat = (s + n) / 2;
  const u = m ? m.dx / 20 : 0, v = m ? m.dy / 20 : 0;
  return { big, rate: recent.map(x => x / 5), u, v, lat, latest, motion: m && { ...velocityInfo(u, v, lat), score: m.score } };
}

/** The unperturbed nowcast (Lagrangian persistence). */
export const CONTROL = Object.freeze({ key: 'ctl', label: 'Persistence', speed: 1, dir: 0, growth: 0 });
/** A member's intensity factor `minutes` after the latest frame: exp(growth · t), growth in ln per hour, kept within ¼–4×. */
export const growthFactor = (growth, minutes) => Math.min(4, Math.max(0.25, Math.exp(growth * minutes / 60)));

/**
 * `leadMin` minutes of nowcast frames (2 min each) on window w from a motionSource, for a member { speed, dir, growth }:
 * the frame for lead L (the 2 minutes from latest + L) is the rate moved by the member's velocity for L + 1 + 5 min
 * (the 5 being the age of the mean) and scaled by its growth over L + 1 min. → [Float32Array]
 */
export function nowcastFrames(src, w, leadMin, member = CONTROL) {
  const [u, v] = turn(src.u, src.v, src.lat, member.speed, member.dir), out = [];
  for (let L = 0; L < leadMin; L += 2) {
    const f = advect(src.rate, src.big, w, u, v, L + 1 + 5), g = growthFactor(member.growth, L + 1);
    if (g !== 1) for (let p = 0; p < f.length; p++) f[p] *= g;
    out.push(f);
  }
  return out;
}

/** Leads (minutes after the latest frame) of the crossfade from the nowcast to HRRR: all nowcast before, all HRRR after. */
export const BLEND = Object.freeze({ from: 60, to: 90 });
/** HRRR's weight at lead L minutes: 0 to `from`, rising linearly to 1 at `to`. */
export const hrrrWeight = (L, { from, to } = BLEND) => Math.min(1, Math.max(0, (L - from) / (to - from)));
/**
 * One forecast frame (the 2 minutes from latest + L, mm) blended with HRRR: (1 − w)·nowcast + w·HRRR, w = hrrrWeight
 * at the frame's middle; where the HRRR pieces cover only part of the 2 minutes, their rate over that part. f is not
 * changed. → { f, w } (w 0: the nowcast frame itself)
 */
export function blendFrame(f, qpf, win, latest, L, blend = BLEND) {
  const wt = qpf ? hrrrWeight(L + 1, blend) : 0; if (!(wt > 0)) return { f, w: 0 };
  const t0 = latest + L * MIN, h = rainOn(qpf, win, t0, t0 + STEP); if (!(h.cover > 0)) return { f, w: 0 };
  const out = new Float32Array(f.length); for (let p = 0; p < f.length; p++) out[p] = (1 - wt) * f[p] + wt * h.f[p] / h.cover;
  return { f: out, w: wt };
}
/** nowcastFrames, blended into HRRR past BLEND.from when there is a run (qpf: hrrrRain's result). → [Float32Array] */
export function forecastFrames(src, w, leadMin, member = CONTROL, qpf = null, blend = BLEND) {
  const nf = nowcastFrames(src, w, leadMin, member);
  return qpf ? nf.map((f, k) => blendFrame(f, qpf, w, src.latest, 2 * k, blend).f) : nf;
}

/** A seeded uniform generator on [0, 1) (mulberry32). */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Standard normal quantile (Abramowitz & Stegun 26.2.23, |error| < 4.5e-4). */
export function probit(p) {
  const q = p < 0.5 ? p : 1 - p, t = Math.sqrt(-2 * Math.log(q));
  const x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return p < 0.5 ? -x : x;
}

/**
 * Nowcast ensemble members: the control, then n members on a Latin hypercube in three independent normal errors:
 * speed × exp(N(0, speedSd)), direction + N(0, dirSd)°, growth N(0, growthSd) in ln per hour (so ±1σ at 1 h is
 * × e^±growthSd). Each error's n values are the normal quantiles at (i + ½) / n, shuffled by `seed`, so a small
 * ensemble still spans the spread evenly and the same seed gives the same members. → [{ key, label, speed, dir, growth }]
 */
export function ensembleMembers(n = 20, { speedSd = 0.2, dirSd = 15, growthSd = 0.5, seed = 1 } = {}) {
  const r = rng(seed), col = () => { const z = Array.from({ length: n }, (_, i) => probit((i + 0.5) / n)); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [z[i], z[j]] = [z[j], z[i]]; } return z; };
  const zs = col(), zd = col(), zg = col();
  return [CONTROL, ...zs.map((_, i) => ({ key: 'm' + (i + 1), label: `Member ${i + 1}`, speed: Math.exp(zs[i] * speedSd), dir: zd[i] * dirSd, growth: zg[i] * growthSd }))];
}

/** Quantile q of xs by linear interpolation (Infinity where it falls on or next to an infinite value). */
export function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b), h = (s.length - 1) * q, i = Math.floor(h), f = h - i;
  if (!s.length) return null;
  if (!Number.isFinite(s[i]) || (f > 0 && !Number.isFinite(s[i + 1]))) return Infinity;
  return f > 0 ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}

/**
 * What a nowcast brings to the area: mean (mm per block over the area), from (the first forecast block). Rain has
 * arrived at a block whose rate reaches `wet` mm/hr; "raining now" when one of the last 3 observed blocks did.
 * → { rainingNow, etaMin (minutes after the latest frame; 0 raining now; null: none within the lead), depthMM (over
 * the lead), peakMMHR, peakAtMin }
 */
export function incoming(mean, from, blockMin, { wet = 1 } = {}) {
  const rate = (i) => mean[i] * 60 / blockMin;
  let rainingNow = false; for (let i = Math.max(0, from - 3); i < from; i++) if (rate(i) >= wet) rainingNow = true;
  let eta = null, depth = 0, peak = 0, peakAt = null;
  for (let i = from; i < mean.length; i++) {
    depth += mean[i]; if (eta == null && rate(i) >= wet) eta = (i - from) * blockMin;
    if (rate(i) > peak) { peak = rate(i); peakAt = (i - from) * blockMin; }
  }
  return { rainingNow, etaMin: rainingNow ? 0 : eta, depthMM: depth, peakMMHR: peak, peakAtMin: peakAt };
}

/**
 * The band across members [{ key, mean }] (area mean per block, the observed blocks the same in each): incoming() for
 * each, their 10th, 50th and 90th percentiles, and per forecast block the band of the area-mean rate. pick: the members
 * whose depth over the lead is nearest each percentile (the ones to run as a dry, middle and wet case).
 * → { n, depth, eta (minutes; Infinity: later than the lead), peak: { p10, p50, p90, min, max }, arriving (share of
 * members with rain within the lead), band: { p10, p50, p90 } (mm/hr per forecast block), pick: { p10, p50, p90 }, by }
 */
export function ensembleSummary(members, from, blockMin, opts = {}) {
  const by = members.map(m => ({ key: m.key, ...incoming(m.mean, from, blockMin, opts) }));
  const stat = (xs) => ({ p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), min: Math.min(...xs), max: Math.max(...xs) });
  const depth = stat(by.map(b => b.depthMM)), eta = stat(by.map(b => b.etaMin ?? Infinity)), peak = stat(by.map(b => b.peakMMHR));
  const nf = members[0].mean.length - from, band = { p10: [], p50: [], p90: [] };
  for (let i = 0; i < nf; i++) { const xs = members.map(m => m.mean[from + i] * 60 / blockMin); for (const q of ['p10', 'p50', 'p90']) band[q].push(quantile(xs, Number(q.slice(1)) / 100)); }
  const near = (d) => by.reduce((a, b) => (Math.abs(b.depthMM - d) < Math.abs(a.depthMM - d) ? b : a)).key;
  return { n: members.length, depth, eta, peak, arriving: by.filter(b => b.etaMin != null).length / by.length, band, pick: { p10: near(depth.p10), p50: near(depth.p50), p90: near(depth.p90) }, by };
}

/**
 * Live rain over a lon/lat box: observed from the hour at or before now − obsHours to the latest frame, then
 * `leadMin` minutes of nowcast. Same shape as radarRain's result ({ win, t0, blockMin: 2, frames, stats, hours }),
 * plus live: { observedUntil (ms UTC), leadMin, motion: { u, v (px/min), kmh, toward (° from north), score } | null }
 * and src (the motionSource, to make ensemble members and refresh the nowcast without fetching again). `now` may be
 * a past time: the nowcast as it would have been issued then, from what the archive holds.
 * Leads past BLEND.to with qpf ({ getBytes(url, range?), replay, cycle? }): the nowcast blended into HRRR (forecastFrames),
 * the run as qpf in the result and live.qpf: { cycle, kinds, pieces, bytes, blend } (or { error } and the nowcast alone).
 */
export async function liveRain(now, bbox, getBytes, { obsHours = 3, leadMin = 60, onProgress = () => {}, isWet, gauge = true, qpf = null } = {}) {
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
  onProgress(0, 1, 'storm motion');
  const src = await motionSource(latest, bbox, getBytes);
  let run = null, info = null;
  if (qpf && leadMin > BLEND.to) {
    const [w, s, e, n] = bbox, pad = 0.8; // the loop shows 0.65° round the area
    try {
      run = await hrrrRain(now, latest + BLEND.from * MIN, latest + leadMin * MIN, [w - pad, s - pad, e + pad, n + pad], qpf.getBytes, { replay: qpf.replay, cycle: qpf.cycle ?? null, onProgress });
      info = { cycle: run.cycle, kinds: run.kinds, pieces: run.pieces.length, bytes: run.bytes, blend: { ...BLEND } };
    } catch (err) { info = { error: err.message }; }
  }
  frames.push(...forecastFrames(src, win, leadMin, CONTROL, run));
  stats.forecastFrames = leadMin / 2;
  return { win, t0: rr.t0, blockMin: 2, frames, stats, hours: rr.hours, src, qpf: run, live: { observedUntil: latest, leadMin, motion: src.motion, ...(info ? { qpf: info } : {}) } };
}

/**
 * The 2-minute frames after `since` up to the latest at or before `now`, over window w. → { latest, frames: [{ t, f }] }
 * (f null where the archive has no file; NaN read as none), or null when there is no newer frame yet.
 */
export async function newFrames(since, now, w, getBytes) {
  const latest = await latestFrame(now, getBytes);
  if (latest == null || latest <= since) return null;
  const frames = [];
  for (let t = since + STEP; t <= latest; t += STEP) { const g = await frameAt(t, w, getBytes); frames.push({ t, f: g && g.map(v => (Number.isNaN(v) ? 0 : v)) }); }
  return { latest, frames };
}

/**
 * Roll a live radar storm forward in place: observed frames [{ t, f }] (each the 2 minutes ending at t) replace the
 * nowcast blocks they cover, and `fresh` (nowcast frames from the newest of them on) the blocks after, to the storm's
 * end. Blocks before `fromK` (the run has already rained them) stay as they were. st: { t0, blockMin, depth,
 * intensity, total, peakIntensity, radar: { frames, mean, live: { observedUntil, forecastFrom } } }; areaMean(frame) → mm.
 * → { replaced (blocks now observed), late (observed but already run), refreshed (nowcast blocks redone) }
 */
export function rollForward(st, observed, fresh, fromK, areaMean) {
  const R = st.radar, bs = st.blockMin * 60e3, n = R.frames.length;
  const put = (k, f) => { R.frames[k] = f; R.mean[k] = f ? areaMean(f) : 0; st.depth[k] = R.mean[k]; st.intensity[k] = R.mean[k] * 60 / st.blockMin; };
  let replaced = 0, late = 0, refreshed = 0, last = R.live.observedUntil;
  for (const { t, f } of observed) {
    const k = Math.round((t - st.t0) / bs) - 1; last = Math.max(last, t);
    if (k < 0 || k >= n) continue;
    if (k < fromK) { late++; continue; }
    put(k, f); replaced++;
  }
  const kf = Math.round((last - st.t0) / bs); // the first block after the newest observed frame: fresh[0]
  for (let k = Math.max(kf, fromK); k < n && k - kf < fresh.length; k++) { put(k, fresh[k - kf]); refreshed++; }
  R.live.observedUntil = last; R.live.forecastFrom = kf;
  st.total = st.depth.reduce((a, b) => a + b, 0); st.peakIntensity = Math.max(...st.intensity);
  return { replaced, late, refreshed };
}
