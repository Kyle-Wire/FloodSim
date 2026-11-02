// Radar rainfall for historic storms: NOAA MRMS (Multi-Radar Multi-Sensor) from the Iowa Environmental Mesonet (IEM)
// archive, as rain that varies in space (1 km) and time (2 min). September 2013 onward.
//
// IEM files, archive/data/YYYY/MM/DD/GIS/mrms/ (UTC date): 7000 × 3500 8-bit palette PNGs on a 0.01° lon/lat grid whose
// top-left corner is 130° W, 55° N. Index 255 = no radar coverage. From IEM's scripts (akrherz/iem, scripts/mrms):
//   p1h_YYYYMMDDHH00  RadarOnly_QPE_01H, the hour ending at the stamp. mm, truncated into bins of 0.25 mm (index 0–99),
//                     1.25 mm (100–179) and 5 mm (180–254). A missing value is written as 0.
//   a2m_YYYYMMDDHHMI  PrecipRate × 2 min, the 2 minutes ending at the stamp, truncated to 0.02 mm. Stored in 8 bits
//                     with no clamp, so a rate over ~152 mm/hr overflows: to 255 (read as missing) or wrapped to a
//                     small value. That is the cloudburst core, where it matters most.
// So each pixel's hourly total comes from p1h, and a2m only shapes it within the hour, where that hour's 30 frames are
// clean: none missing, and their sum within a factor 2 of p1h (an overflowed frame loses most of its rain). Elsewhere
// the hour takes the mean shape of the clean wet pixels in the area, or failing that, a uniform rate. Both are counted.
// Radar-only: not adjusted to rain gauges.

export const GRID = { lon0: -130, lat0: 55, step: 0.01, nx: 7000, ny: 3500 };
export const FROM = Date.UTC(2013, 8, 1);
const IEM = 'https://mesonet.agron.iastate.edu/archive/data';
const HOUR = 3600e3, FRAMES = 30;

/** Archive URL of a product file for the period ending at t (ms UTC). */
export function fileURL(prod, t) {
  const d = new Date(t).toISOString(), stamp = d.slice(0, 16).replace(/[-T:]/g, '');
  return `${IEM}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/GIS/mrms/${prod}_${stamp}.png`;
}

/** p1h index → mm (bin centre; NaN for no coverage). */
export function p1hMM(i) {
  if (i === 255) return NaN;
  if (i === 0) return 0;
  if (i < 100) return (i + 0.5) * 0.25;
  if (i < 180) return 25 + (i - 100 + 0.5) * 1.25;
  return 125 + (i - 180 + 0.5) * 5;
}
/** a2m index → mm in 2 minutes (bin centre; NaN for missing or overflowed). */
export const a2mMM = (i) => (i === 255 ? NaN : i === 0 ? 0 : (i + 0.5) * 0.02);

/** The grid's pixel window covering a lon/lat box, plus one pixel all round (for interpolation). */
export function pixelWindow([w, s, e, n]) {
  const c0 = Math.max(0, Math.floor((w - GRID.lon0) / GRID.step) - 1), c1 = Math.min(GRID.nx, Math.floor((e - GRID.lon0) / GRID.step) + 2);
  const r0 = Math.max(0, Math.floor((GRID.lat0 - n) / GRID.step) - 1), r1 = Math.min(GRID.ny, Math.floor((GRID.lat0 - s) / GRID.step) + 2);
  return { c0, c1, r0, r1, nx: c1 - c0, ny: r1 - r0, lon0: GRID.lon0 + c0 * GRID.step, lat0: GRID.lat0 - r0 * GRID.step, step: GRID.step };
}

/**
 * Palette indices of rows [r0, r1) × columns [c0, c1) of an 8-bit palette PNG (not interlaced). Inflates only as far
 * as row r1, so a window near the top of the US costs a fraction of the file.
 */
export async function decodeWindow(bytes, { r0, r1, c0, c1 }) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 8 || dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, W = 0, H = 0; const idat = [];
  while (p + 8 <= u8.length) {
    const n = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    if (type === 'IHDR') {
      W = dv.getUint32(p + 8); H = dv.getUint32(p + 12);
      if (u8[p + 16] !== 8 || u8[p + 17] !== 3 || u8[p + 20] !== 0) throw new Error('expected an 8-bit palette PNG, not interlaced');
    } else if (type === 'IDAT') idat.push(u8.subarray(p + 8, p + 8 + n));
    else if (type === 'IEND') break;
    p += 12 + n;
  }
  if (r1 > H || c1 > W) throw new Error(`window outside the ${W} × ${H} image`);
  const ds = new DecompressionStream('deflate'), writer = ds.writable.getWriter(), reader = ds.readable.getReader();
  (async () => { for (const c of idat) await writer.write(c); await writer.close(); })().catch(() => {}); // stops when the reader cancels
  const out = new Uint8Array((r1 - r0) * (c1 - c0));
  let prev = new Uint8Array(W), cur = new Uint8Array(W), row = 0, filter = -1, fill = 0;
  while (row < r1) {
    const { value, done } = await reader.read(); if (done) break;
    for (let i = 0; i < value.length && row < r1;) {
      if (filter < 0) { filter = value[i++]; fill = 0; continue; }
      const take = Math.min(W - fill, value.length - i);
      cur.set(value.subarray(i, i + take), fill); fill += take; i += take;
      if (fill < W) continue;
      unfilter(filter, cur, prev);
      if (row >= r0) out.set(cur.subarray(c0, c1), (row - r0) * (c1 - c0));
      [prev, cur] = [cur, prev]; row++; filter = -1;
    }
  }
  await reader.cancel().catch(() => {});
  if (row < r1) throw new Error('PNG data ended early');
  return out;
}

/** Undo a PNG scanline filter in place (1 byte per pixel). */
function unfilter(f, cur, prev) {
  const W = cur.length;
  if (f === 1) for (let x = 1; x < W; x++) cur[x] += cur[x - 1];
  else if (f === 2) for (let x = 0; x < W; x++) cur[x] += prev[x];
  else if (f === 3) { cur[0] += prev[0] >> 1; for (let x = 1; x < W; x++) cur[x] += (cur[x - 1] + prev[x]) >> 1; }
  else if (f === 4) {
    cur[0] += prev[0];
    for (let x = 1; x < W; x++) {
      const a = cur[x - 1], b = prev[x], c = prev[x - 1], q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      cur[x] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
  } else if (f !== 0) throw new Error('bad PNG filter ' + f);
}

/** Bilinear weights of a point between pixel centres of a window: [index, weight] × up to 4. */
export function sampleWeights(win, lon, lat) {
  const clamp = (v, hi) => Math.min(Math.max(v, 0), hi);
  const fx = clamp((lon - win.lon0) / win.step - 0.5, win.nx - 1), fy = clamp((win.lat0 - lat) / win.step - 0.5, win.ny - 1);
  const i = Math.min(Math.floor(fx), Math.max(0, win.nx - 2)), j = Math.min(Math.floor(fy), Math.max(0, win.ny - 2));
  const ax = fx - i, ay = fy - j, out = [];
  for (const [di, dj, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
    if (w > 1e-9 && i + di < win.nx && j + dj < win.ny) out.push([(j + dj) * win.nx + i + di, w]); // skip round-off slivers
  }
  const s = out.reduce((a, [, w]) => a + w, 0);
  return out.map(([k, w]) => [k, w / s]);
}

/** Hourly totals (p1h, mm; NaN = no coverage) and the hour's 30 two-minute depths per pixel → 30 depth grids (mm). */
export function shapeHour(p1h, frames, stats) {
  const N = p1h.length, out = Array.from({ length: FRAMES }, () => new Float32Array(N)), clean = new Uint8Array(N);
  // pixel shapes where the frames are clean; their mean is the area's shape for the rest
  const mean = new Float64Array(FRAMES); let nClean = 0;
  for (let p = 0; p < N; p++) {
    const P = p1h[p]; if (!(P > 0) || !frames) continue;
    let s = 0, ok = true; for (let k = 0; k < FRAMES; k++) { const v = frames[k] ? frames[k][p] : NaN; if (!Number.isFinite(v)) { ok = false; break; } s += v; }
    if (!ok || !(s > 0) || s < P / 2 || s > 2 * P) continue;
    clean[p] = 1; nClean++;
    for (let k = 0; k < FRAMES; k++) { const w = frames[k][p] / s; out[k][p] = P * w; mean[k] += w; }
  }
  const areaShape = nClean ? Array.from(mean, v => v / nClean) : null;
  for (let p = 0; p < N; p++) {
    const P = p1h[p];
    if (Number.isNaN(P)) { stats.noCoverage++; continue; }
    if (!(P > 0)) continue;
    stats.wetPixelHours++;
    if (clean[p]) continue;
    if (areaShape) stats.areaShape++; else stats.uniform++;
    for (let k = 0; k < FRAMES; k++) out[k][p] = P * (areaShape ? areaShape[k] : 1 / FRAMES);
  }
  return out;
}

/**
 * Radar rain over [t0, t1] (ms UTC) for a lon/lat box: whole hours, ending on the hour. `getBytes(url)` resolves to
 * the file's bytes, or null when the archive has no such file. `isWet(p1hGrid)` says whether an hour matters to the
 * model (its 2-minute frames are fetched only then). → { win, t0, blockMin: 2, frames: [Float32Array (mm) | null],
 * stats }, one frame per 2 minutes from t0 (null = dry).
 */
export async function radarRain(t0, t1, bbox, getBytes, { isWet = (g) => g.some(v => v > 0), onProgress = () => {}, parallel = 6 } = {}) {
  if (t1 < FROM) throw new Error('the MRMS archive at IEM starts in September 2013');
  const win = pixelWindow(bbox), first = Math.floor(t0 / HOUR) * HOUR + HOUR, last = Math.ceil(t1 / HOUR) * HOUR;
  const stats = { hours: 0, wetHours: 0, missingHours: [], missingFrames: 0, wetPixelHours: 0, areaShape: 0, uniform: 0, noCoverage: 0 };
  const grid = async (prod, t, conv) => {
    const b = await getBytes(fileURL(prod, t)); if (!b) return null;
    return Float32Array.from(await decodeWindow(b, win), conv);
  };
  const ends = []; for (let e = first; e <= last; e += HOUR) ends.push(e);
  const pool = async (items, fn) => { const res = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, async () => { while (next < items.length) { const i = next++; res[i] = await fn(items[i], i); } })); return res; };
  let done = 0;
  const hourly = await pool(ends, async (e) => { const g = await grid('p1h', e, p1hMM); onProgress(++done, ends.length, 'hourly totals'); return g; });
  const frames = [];
  for (let h = 0; h < ends.length; h++) {
    stats.hours++;
    const P = hourly[h];
    if (!P) { stats.missingHours.push(new Date(ends[h]).toISOString().slice(0, 16) + 'Z'); frames.push(...new Array(FRAMES).fill(null)); continue; }
    if (!isWet(P)) { frames.push(...new Array(FRAMES).fill(null)); continue; }
    stats.wetHours++;
    const times = Array.from({ length: FRAMES }, (_, k) => ends[h] - HOUR + (k + 1) * 120e3); done = 0;
    const two = await pool(times, async (t) => { const g = await grid('a2m', t, a2mMM); if (!g) stats.missingFrames++; onProgress(++done, FRAMES, `2-minute frames, hour ${h + 1} of ${ends.length}`); return g; });
    frames.push(...shapeHour(P, two, stats));
  }
  return { win, t0: first - HOUR, blockMin: 2, frames, stats };
}

/** Mean depth of each frame over sample points (from sampleWeights) → Float64Array, mm per frame. */
export function areaMean(frames, samples) {
  return Float64Array.from(frames, f => {
    if (!f) return 0;
    let s = 0; for (const ws of samples) for (const [i, w] of ws) s += w * f[i];
    return s / samples.length;
  });
}

/** A short hash of the frames (part of the forcing fingerprint: two radar storms with the same mean still differ). */
export function framesHash(frames) {
  let h = 0x811c9dc5;
  for (const f of frames) {
    if (!f) { h = Math.imul(h ^ 0x2d, 0x01000193); continue; }
    for (let i = 0; i < f.length; i++) h = Math.imul(h ^ Math.round(f[i] * 1000), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
