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
// clean: none missing, and their sum within a factor 2 of p1h (an overflowed frame loses most of its rain). A frame
// that reads as missing anywhere is first filled from the raw 16-bit PrecipRate (below) where the archive has it. Still
// unclean, the hour takes the mean shape of the clean wet pixels in the area, or failing that, a uniform rate. Counted.
//
// Gauge-corrected hourly totals, where the archive has them: IEM's raw MRMS archive (mtarchive.geol.iastate.edu,
// YYYY/MM/DD/mrms/ncep/PROD/, GRIB2, gzipped) keeps GaugeCorr_QPE_01H from 6 May 2015 and MultiSensor_QPE_01H_Pass2
// (radar adjusted to gauges, with gauges and precipitation climatology where radar is poor) from 14 October 2020. Same
// grid; PNG packing (template 5.41: a 16-bit grey PNG, value = (R + X·2^E) / 10^D mm, below 0 = no coverage). Those
// totals replace p1h's; p1h still decides whether a pixel's 2-minute frames are clean (they are radar too), and stands
// in for a pixel or an hour the gauge-corrected file lacks. Before May 2015 the rain is radar-only.

export const GRID = { lon0: -130, lat0: 55, step: 0.01, nx: 7000, ny: 3500 };
export const FROM = Date.UTC(2013, 8, 1);
const IEM = 'https://mesonet.agron.iastate.edu/archive/data', MTARCHIVE = 'https://mtarchive.geol.iastate.edu';
/** Gauge-corrected hourly products in the raw archive, newest first: { prod, from (first hour end, ms UTC) }. */
export const GAUGE = [
  { prod: 'MultiSensor_QPE_01H_Pass2', from: Date.UTC(2020, 9, 14, 0), label: 'MRMS MultiSensor QPE Pass 2 (radar adjusted to gauges)' },
  { prod: 'GaugeCorr_QPE_01H', from: Date.UTC(2015, 4, 6, 20), label: 'MRMS gauge-corrected QPE (GaugeCorr)' },
];
const HOUR = 3600e3, FRAMES = 30;

/** Archive URL of a product file for the period ending at t (ms UTC). */
export function fileURL(prod, t) {
  const d = new Date(t).toISOString(), stamp = d.slice(0, 16).replace(/[-T:]/g, '');
  return `${IEM}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/GIS/mrms/${prod}_${stamp}.png`;
}

/** Archive URL of the gauge-corrected hourly total for the hour ending at t (ms UTC), or null before May 2015. */
export function gaugeURL(t) {
  const g = GAUGE.find(g => t >= g.from); if (!g) return null;
  const d = new Date(t).toISOString(), day = d.slice(0, 10).replace(/-/g, '');
  return `${MTARCHIVE}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/mrms/ncep/${g.prod}/${g.prod}_00.00_${day}-${d.slice(11, 13)}0000.grib2.gz`;
}

/** Archive URL of the raw PrecipRate (mm/hr, GRIB2) at t (ms UTC): 16 bits, so no overflow where a2m has one. */
export function rateURL(t) {
  const d = new Date(t).toISOString(), day = d.slice(0, 10).replace(/-/g, '');
  return `${MTARCHIVE}/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}/mrms/ncep/PrecipRate/PrecipRate_00.00_${day}-${d.slice(11, 13)}${d.slice(14, 16)}00.grib2.gz`;
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
 * Pixel values of rows [r0, r1) × columns [c0, c1) of an 8-bit palette PNG (→ Uint8Array of indices) or a 16-bit grey
 * one (→ Uint16Array), not interlaced. Inflates only as far as row r1, so a window near the top of the US costs a
 * fraction of the file.
 */
export async function decodeWindow(bytes, { r0, r1, c0, c1 }) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 8 || dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, W = 0, H = 0, bpp = 1; const idat = [];
  while (p + 8 <= u8.length) {
    const n = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    if (type === 'IHDR') {
      W = dv.getUint32(p + 8); H = dv.getUint32(p + 12);
      const depth = u8[p + 16], ct = u8[p + 17];
      if (!((depth === 8 && ct === 3) || (depth === 16 && ct === 0)) || u8[p + 20] !== 0) throw new Error('expected an 8-bit palette or 16-bit grey PNG, not interlaced');
      bpp = depth / 8;
    } else if (type === 'IDAT') idat.push(u8.subarray(p + 8, p + 8 + n));
    else if (type === 'IEND') break;
    p += 12 + n;
  }
  if (r1 > H || c1 > W) throw new Error(`window outside the ${W} × ${H} image`);
  const ds = new DecompressionStream('deflate'), writer = ds.writable.getWriter(), reader = ds.readable.getReader();
  (async () => { for (const c of idat) await writer.write(c); await writer.close(); })().catch(() => {}); // stops when the reader cancels
  const out = bpp === 1 ? new Uint8Array((r1 - r0) * (c1 - c0)) : new Uint16Array((r1 - r0) * (c1 - c0)), RB = W * bpp;
  let prev = new Uint8Array(RB), cur = new Uint8Array(RB), row = 0, filter = -1, fill = 0;
  while (row < r1) {
    const { value, done } = await reader.read(); if (done) break;
    for (let i = 0; i < value.length && row < r1;) {
      if (filter < 0) { filter = value[i++]; fill = 0; continue; }
      const take = Math.min(RB - fill, value.length - i);
      cur.set(value.subarray(i, i + take), fill); fill += take; i += take;
      if (fill < RB) continue;
      unfilter(filter, cur, prev, bpp);
      if (row >= r0) {
        const o = (row - r0) * (c1 - c0);
        if (bpp === 1) out.set(cur.subarray(c0, c1), o); else for (let c = c0; c < c1; c++) out[o + c - c0] = cur[2 * c] << 8 | cur[2 * c + 1];
      }
      [prev, cur] = [cur, prev]; row++; filter = -1;
    }
  }
  await reader.cancel().catch(() => {});
  if (row < r1) throw new Error('PNG data ended early');
  return out;
}

/** Undo a PNG scanline filter in place (bpp bytes per pixel). */
function unfilter(f, cur, prev, bpp = 1) {
  const W = cur.length;
  if (f === 1) for (let x = bpp; x < W; x++) cur[x] += cur[x - bpp];
  else if (f === 2) for (let x = 0; x < W; x++) cur[x] += prev[x];
  else if (f === 3) { for (let x = 0; x < bpp; x++) cur[x] += prev[x] >> 1; for (let x = bpp; x < W; x++) cur[x] += (cur[x - bpp] + prev[x]) >> 1; }
  else if (f === 4) {
    for (let x = 0; x < bpp; x++) cur[x] += prev[x];
    for (let x = bpp; x < W; x++) {
      const a = cur[x - bpp], b = prev[x], c = prev[x - bpp], q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      cur[x] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
  } else if (f !== 0) throw new Error('bad PNG filter ' + f);
}

/**
 * A gauge-corrected MRMS GRIB2 file (gzipped or not) → mm over the window (Float32Array; NaN = no coverage). Reads
 * only what this module needs and checks it: the 0.01° grid above, PNG packing, no bitmap.
 */
export async function decodeGribWindow(bytes, win) {
  let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), sm32 = (o) => { const v = dv.getUint32(o); return v & 0x80000000 ? -(v & 0x7fffffff) : v; };
  const sm16 = (o) => { const v = dv.getUint16(o); return v & 0x8000 ? -(v & 0x7fff) : v; };
  if (u8.length < 16 || dv.getUint32(0) !== 0x47524942 || u8[7] !== 2) throw new Error('not a GRIB2 file');
  let o = 16, R = 0, E = 0, D = 0, png = null, grid = false;
  while (o + 5 <= u8.length && dv.getUint32(o) !== 0x37373737) {
    const L = dv.getUint32(o), n = u8[o + 4];
    if (n === 3) grid = dv.getUint16(o + 12) === 0 && dv.getUint32(o + 30) === GRID.nx && dv.getUint32(o + 34) === GRID.ny &&
      sm32(o + 46) === Math.round((GRID.lat0 - GRID.step / 2) * 1e6) && dv.getUint32(o + 50) === Math.round((360 + GRID.lon0 + GRID.step / 2) * 1e6) && u8[o + 71] === 0;
    else if (n === 5) {
      if (dv.getUint16(o + 9) !== 41) throw new Error('expected PNG packing (GRIB2 template 5.41)');
      R = dv.getFloat32(o + 11); E = sm16(o + 15); D = sm16(o + 17);
    } else if (n === 6 && u8[o + 5] !== 255) throw new Error('GRIB2 bitmaps are not supported');
    else if (n === 7) png = u8.subarray(o + 5, o + L);
    if (!L) break; o += L;
  }
  if (!grid) throw new Error('GRIB2 grid is not the MRMS 0.01° CONUS grid');
  if (!png) throw new Error('GRIB2 file has no data section');
  const X = await decodeWindow(png, win), e2 = 2 ** E, d10 = 10 ** D;
  return Float32Array.from(X, x => { const v = (R + x * e2) / d10; return v < 0 ? NaN : v; });
}

/**
 * One 2-minute frame (mm) over the window, for the 2 minutes ending at t: a2m, with its overflowed or missing pixels
 * from the raw PrecipRate where the archive has that file (stats.filledFrames counts those). → Float32Array (NaN = no
 * value either way) or null when neither file exists.
 */
export async function frameAt(t, win, getBytes, stats = {}) {
  const b = await getBytes(fileURL('a2m', t));
  let g = b ? Float32Array.from(await decodeWindow(b, win), a2mMM) : null;
  if (g && !g.some(Number.isNaN)) return g;
  const r = await getBytes(rateURL(t)); if (!r) return g;
  const rate = await decodeGribWindow(r, win);
  g ??= new Float32Array(rate.length).fill(NaN);
  for (let p = 0; p < g.length; p++) if (Number.isNaN(g[p]) && Number.isFinite(rate[p])) g[p] = rate[p] / 30; // mm/hr over 2 min
  stats.filledFrames = (stats.filledFrames ?? 0) + 1;
  return g;
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

/**
 * Hourly totals (mm; NaN = no coverage) and the hour's 30 two-minute depths per pixel → 30 depth grids (mm). `ref`:
 * the radar's own hourly total (p1h), which the frames must agree with to be trusted; the totals by default.
 */
export function shapeHour(total, frames, stats, ref = total) {
  const N = total.length, out = Array.from({ length: FRAMES }, () => new Float32Array(N)), clean = new Uint8Array(N);
  // pixel shapes where the frames are clean; their mean is the area's shape for the rest
  const mean = new Float64Array(FRAMES); let nClean = 0;
  for (let p = 0; p < N; p++) {
    const P = ref[p]; if (!(P > 0) || !(total[p] > 0) || !frames) continue;
    let s = 0, ok = true; for (let k = 0; k < FRAMES; k++) { const v = frames[k] ? frames[k][p] : NaN; if (!Number.isFinite(v)) { ok = false; break; } s += v; }
    if (!ok || !(s > 0) || s < P / 2 || s > 2 * P) continue;
    clean[p] = 1; nClean++;
    for (let k = 0; k < FRAMES; k++) { const w = frames[k][p] / s; out[k][p] = total[p] * w; mean[k] += w; }
  }
  const areaShape = nClean ? Array.from(mean, v => v / nClean) : null;
  for (let p = 0; p < N; p++) {
    const P = total[p];
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
 * the file's bytes, or null when the archive has no such file. `isWet(hourGrid)` says whether an hour matters to the
 * model (its 2-minute frames are fetched only then). `gauge`: hourly totals from the gauge-corrected product where
 * there is one. → { win, t0, blockMin: 2, frames: [Float32Array (mm) | null], stats }, one frame per 2 minutes from
 * t0 (null = dry); hours: per hour { end, radar (p1h grid), total (the grid used) }. stats.gaugeHours / radarOnlyHours: which hours had which totals; gaugeGaps: wet pixel-hours the
 * gauge-corrected file had no value for (radar-only there).
 */
export async function radarRain(t0, t1, bbox, getBytes, { isWet = (g) => g.some(v => v > 0), onProgress = () => {}, parallel = 6, gauge = true } = {}) {
  if (t1 < FROM) throw new Error('the MRMS archive at IEM starts in September 2013');
  const win = pixelWindow(bbox), first = Math.floor(t0 / HOUR) * HOUR + HOUR, last = Math.ceil(t1 / HOUR) * HOUR;
  const stats = { hours: 0, wetHours: 0, missingHours: [], missingFrames: 0, wetPixelHours: 0, areaShape: 0, uniform: 0, noCoverage: 0,
    gaugeHours: 0, radarOnlyHours: [], gaugeGaps: 0, products: [], filledFrames: 0 };
  const grid = async (prod, t, conv) => {
    const b = await getBytes(fileURL(prod, t)); if (!b) return null;
    return Float32Array.from(await decodeWindow(b, win), conv);
  };
  const ends = []; for (let e = first; e <= last; e += HOUR) ends.push(e);
  const pool = async (items, fn) => { const res = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, async () => { while (next < items.length) { const i = next++; res[i] = await fn(items[i], i); } })); return res; };
  let done = 0;
  const gaugeGrid = async (e) => {
    const u = gauge ? gaugeURL(e) : null, b = u && await getBytes(u);
    return b ? decodeGribWindow(b, win) : null;
  };
  const hourly = await pool(ends, async (e) => {
    const [ro, gc] = await Promise.all([grid('p1h', e, p1hMM), gaugeGrid(e)]);
    onProgress(++done, ends.length, 'hourly totals'); return { ro, gc };
  });
  const frames = [], totals = [], stamp = (e) => new Date(e).toISOString().slice(0, 16) + 'Z';
  for (let h = 0; h < ends.length; h++) {
    stats.hours++;
    const { ro, gc } = hourly[h];
    let P = ro;
    if (gc) { // gauge-corrected where it has a value, radar-only where it does not
      P = Float32Array.from(gc, (v, p) => { if (!Number.isNaN(v) || !ro) return v; if (ro[p] > 0) stats.gaugeGaps++; return ro[p]; });
      stats.gaugeHours++; const g = GAUGE.find(g => ends[h] >= g.from).prod; if (!stats.products.includes(g)) stats.products.push(g);
    } else if (ro) stats.radarOnlyHours.push(stamp(ends[h]));
    totals.push({ end: ends[h], radar: ro, total: P });
    if (!P) { stats.missingHours.push(stamp(ends[h])); frames.push(...new Array(FRAMES).fill(null)); continue; }
    if (!isWet(P)) { frames.push(...new Array(FRAMES).fill(null)); continue; }
    stats.wetHours++;
    const times = Array.from({ length: FRAMES }, (_, k) => ends[h] - HOUR + (k + 1) * 120e3); done = 0;
    const two = await pool(times, async (t) => { const g = await frameAt(t, win, getBytes, stats); if (!g) stats.missingFrames++; onProgress(++done, FRAMES, `2-minute frames, hour ${h + 1} of ${ends.length}`); return g; });
    frames.push(...shapeHour(P, two, stats, ro ?? P));
  }
  return { win, t0: first - HOUR, blockMin: 2, frames, stats, hours: totals };
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
