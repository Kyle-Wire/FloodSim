// NOAA HRRR forecast rain (QPF) for leads past the radar nowcast: the High-Resolution Rapid Refresh, a 3 km numerical
// weather model run every hour, on AWS (noaa-hrrr-bdp-pds, NOAA Open Data Dissemination; from July 2014).
//
// Files: hrrr.YYYYMMDD/conus/hrrr.tHHz.wrfsubhfFF.grib2 (sub-hourly: four 15-minute APCP accumulations in forecast
// hour FF, from HRRR v4, December 2020) and hrrr.tHHz.wrfsfcfFF.grib2 (hourly: APCP over hour FF−1 to FF, all
// versions), each with a .idx listing every message's byte offset, so one field is one byte-range request of ~0.3 MB.
// The run used: the newest whose files exist when the nowcast is issued; for a replay, the newest that would have been
// complete by then (the whole 18-hour run is posted about 75 minutes after its cycle time; 80 allowed).
// GRIB2: Lambert conformal grid (template 3.30: 1799 × 1059, 3 km, true at 38.5° N, LoV 262.5°, sphere of 6371.229 km),
// complex packing with spatial differencing (template 5.3; 5.0 and 5.2 read too), no bitmap. APCP is kg/m², i.e. mm.
// Only the points round the model are kept (subset), and they are sampled bilinearly onto the MRMS 0.01° window, so a
// 3 km field becomes 1 km pixels without new detail: HRRR places storms, it does not resolve them at 1 km.
// HRRR is a forecast of a different kind from the nowcast and, for convective storms, of lower skill at the scale of a
// model area: it starts new storms and decays old ones, but places them tens of kilometres and an hour or so off.

export const BUCKET = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com';
export const FROM = Date.UTC(2014, 6, 30);
const MIN = 60e3, HOUR = 3600e3;
/** Minutes after the cycle by which a whole 18-hour run is on AWS (a replay takes the newest run complete by then). */
export const RUN_LAG_MIN = 80;
/** Minutes after the cycle before which no file of the run exists (live: try only cycles at least this old). */
export const FIRST_LAG_MIN = 50;

/** URL of a run's file: cycle (ms UTC, whole hour), forecast hour fh, kind 'subh' | 'sfc'; '.idx' for its index. */
export function fileURL(cycle, fh, kind = 'subh') {
  const d = new Date(cycle).toISOString();
  return `${BUCKET}/hrrr.${d.slice(0, 10).replace(/-/g, '')}/conus/hrrr.t${d.slice(11, 13)}z.wrf${kind}f${String(fh).padStart(2, '0')}.grib2`;
}

/** A .idx text → [{ n, offset, end (last byte, inclusive; null for the last message), var, level, desc }]. */
export function parseIdx(text) {
  const recs = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(':'); return { n: Number(p[0]), offset: Number(p[1]), var: p[3], level: p[4], desc: p[5] ?? '' }; })
    .filter(r => Number.isFinite(r.offset));
  recs.forEach((r, i) => { r.end = i + 1 < recs.length ? recs[i + 1].offset - 1 : null; });
  return recs;
}
/** An accumulation's interval from its .idx description ("60-75 min acc fcst", "1-2 hour acc fcst") → [a, b] minutes, or null. */
export function accInterval(desc) {
  const m = /^(\d+)-(\d+) (min|hour|day) acc/.exec(desc); if (!m) return null;
  const k = m[3] === 'min' ? 1 : m[3] === 'hour' ? 60 : 1440;
  return [Number(m[1]) * k, Number(m[2]) * k];
}
/**
 * The surface APCP messages of a forecast hour's index that tile hour fh: four 15-minute ones (sub-hourly file), or
 * the hour from fh − 1 to fh (hourly file; it also has the total from 0, not wanted). → [{ offset, end, a, b }] (minutes after the cycle)
 */
export function apcpRecords(idx, fh) {
  return idx.filter(r => r.var === 'APCP' && r.level === 'surface').map(r => ({ offset: r.offset, end: r.end, iv: accInterval(r.desc) }))
    .filter(r => r.iv && r.iv[0] >= (fh - 1) * 60 && r.iv[1] <= fh * 60 && r.iv[1] > r.iv[0]).map(r => ({ offset: r.offset, end: r.end, a: r.iv[0], b: r.iv[1] }))
    .sort((p, q) => p.a - q.a);
}

/** Bit reader over u8 from byte `at`: read(n) (n ≤ 32, MSB first), align() to the next byte. */
function bitReader(u8, at) {
  let pos = at * 8;
  return {
    read(n) {
      let v = 0;
      while (n > 0) { const off = pos & 7, take = Math.min(8 - off, n); v = v * (1 << take) + ((u8[pos >>> 3] >> (8 - off - take)) & ((1 << take) - 1)); pos += take; n -= take; }
      return v;
    },
    align() { pos = Math.ceil(pos / 8) * 8; },
  };
}

/**
 * One GRIB2 message → { grid, values (Float32Array in scan order, NaN = missing) }. grid (template 3.30, Lambert
 * conformal): { nx, ny, la1, lo1 (°, lo1 in −180–180), lov, latin1, latin2, dx, dy (m), scan, radius (m) }.
 * Packing: templates 5.0 (simple), 5.2 (complex) and 5.3 (complex with spatial differencing); no bitmap.
 */
export function decodeGrib2(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const sm = (o, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + u8[o + k]; const top = 2 ** (8 * n - 1); return n && v >= top ? -(v - top) : v; }; // sign and magnitude, n bytes
  if (u8.length < 16 || dv.getUint32(0) !== 0x47524942 || u8[7] !== 2) throw new Error('not a GRIB2 message');
  let o = 16, grid = null, drs = null, data = null, npts = 0;
  while (o + 5 <= u8.length && dv.getUint32(o) !== 0x37373737) {
    const L = dv.getUint32(o), n = u8[o + 4];
    if (!L) break;
    if (n === 3) {
      if (dv.getUint16(o + 12) !== 30) throw new Error('expected a Lambert conformal grid (GRIB2 template 3.30)');
      const shape = u8[o + 14], radius = shape === 6 ? 6371229 : shape === 0 ? 6367470 : shape === 1 ? dv.getUint32(o + 16) / 10 ** u8[o + 15] : NaN;
      if (!Number.isFinite(radius)) throw new Error('GRIB2 earth shape ' + shape + ' (an ellipsoid) is not supported');
      const lon = (v) => { const d = v / 1e6; return d > 180 ? d - 360 : d; };
      grid = { nx: dv.getUint32(o + 30), ny: dv.getUint32(o + 34), la1: sm(o + 38, 4) / 1e6, lo1: lon(dv.getUint32(o + 42)), lov: lon(dv.getUint32(o + 51)),
        dx: dv.getUint32(o + 55) / 1e3, dy: dv.getUint32(o + 59) / 1e3, scan: u8[o + 64], latin1: sm(o + 65, 4) / 1e6, latin2: sm(o + 69, 4) / 1e6, radius };
      if (u8[o + 63] & 0x80) throw new Error('GRIB2 Lambert grid with the south pole on the projection plane is not supported');
      if (grid.scan & 0x30) throw new Error('GRIB2 scanning mode ' + grid.scan + ' is not supported');
    } else if (n === 5) {
      npts = dv.getUint32(o + 5);
      const tpl = dv.getUint16(o + 9);
      if (tpl !== 0 && tpl !== 2 && tpl !== 3) throw new Error(`GRIB2 packing template 5.${tpl} is not supported`);
      drs = { tpl, R: dv.getFloat32(o + 11), E: sm(o + 15, 2), D: sm(o + 17, 2), nbits: u8[o + 19] };
      if (tpl >= 2) Object.assign(drs, { miss: u8[o + 22], NG: dv.getUint32(o + 31), wRef: u8[o + 35], wBits: u8[o + 36], lRef: dv.getUint32(o + 37), lInc: u8[o + 41], lLast: dv.getUint32(o + 42), lBits: u8[o + 46],
        order: tpl === 3 ? u8[o + 47] : 0, octets: tpl === 3 ? u8[o + 48] : 0 });
    } else if (n === 6 && u8[o + 5] !== 255) throw new Error('GRIB2 bitmaps are not supported');
    else if (n === 7) data = o + 5;
    o += L;
  }
  if (!grid) throw new Error('GRIB2 message has no grid');
  if (!drs || data == null) throw new Error('GRIB2 message has no data');
  if (npts !== grid.nx * grid.ny) throw new Error('GRIB2 point count does not match the grid');
  const X = drs.tpl === 0 ? unpackSimple(u8, data, npts, drs) : unpackComplex(u8, data, npts, drs, sm);
  const e2 = 2 ** drs.E, d10 = 10 ** drs.D, values = new Float32Array(npts);
  for (let k = 0; k < npts; k++) values[k] = Number.isNaN(X[k]) ? NaN : (drs.R + X[k] * e2) / d10;
  return { grid, values };
}
/** Template 5.0: npts values of nbits each (none: all the reference value). */
function unpackSimple(u8, at, npts, { nbits }) {
  const X = new Float64Array(npts); if (!nbits) return X;
  const br = bitReader(u8, at); for (let k = 0; k < npts; k++) X[k] = br.read(nbits);
  return X;
}
/**
 * Templates 5.2 / 5.3 (WMO Manual on Codes, after NCEP g2clib comunpack): NG groups, each a reference, a bit width and
 * a length; values reference + width bits; missing (miss 1, 2) where all bits are set (or one less, secondary); then,
 * for 5.3, the spatial differences of order 1 or 2 integrated from the first values and the minimum difference.
 */
function unpackComplex(u8, at, npts, d, sm) {
  let p = at, ival1 = 0, ival2 = 0, minsd = 0;
  if (d.tpl === 3) {
    if (d.order !== 1 && d.order !== 2) throw new Error('GRIB2 spatial differencing of order ' + d.order);
    ival1 = sm(p, d.octets); p += d.octets;
    if (d.order === 2) { ival2 = sm(p, d.octets); p += d.octets; }
    minsd = sm(p, d.octets); p += d.octets;
  }
  const br = bitReader(u8, p), NG = d.NG, ref = new Float64Array(NG), wid = new Uint8Array(NG), len = new Uint32Array(NG);
  for (let g = 0; g < NG; g++) ref[g] = br.read(d.nbits); br.align();
  for (let g = 0; g < NG; g++) wid[g] = d.wRef + br.read(d.wBits); br.align();
  for (let g = 0; g < NG; g++) len[g] = d.lRef + br.read(d.lBits) * d.lInc; br.align();
  if (NG) len[NG - 1] = d.lLast;
  const X = new Float64Array(npts), M1 = 2 ** d.nbits - 1, M2 = M1 - 1;
  let k = 0, any = false;
  for (let g = 0; g < NG; g++) {
    const w = wid[g], r = ref[g], n = Math.min(len[g], npts - k);
    if (w === 0) {
      const miss = (d.miss >= 1 && r === M1) || (d.miss === 2 && r === M2);
      for (let i = 0; i < n; i++) X[k++] = miss ? NaN : r; any ||= miss;
    } else {
      const m1 = 2 ** w - 1, m2 = m1 - 1;
      for (let i = 0; i < n; i++) { const v = br.read(w); const miss = (d.miss >= 1 && v === m1) || (d.miss === 2 && v === m2); X[k++] = miss ? NaN : r + v; any ||= miss; }
    }
  }
  if (k !== npts) throw new Error('GRIB2 groups do not add up to the point count');
  if (d.tpl === 3) {
    const idx = any ? [] : null; if (any) for (let i = 0; i < npts; i++) if (!Number.isNaN(X[i])) idx.push(i);
    const N = any ? idx.length : npts, at2 = (i) => (any ? idx[i] : i);
    if (N > 0) X[at2(0)] = ival1;
    if (d.order === 2 && N > 1) X[at2(1)] = ival2;
    for (let i = d.order; i < N; i++) {
      const c = at2(i);
      X[c] += minsd + (d.order === 1 ? X[at2(i - 1)] : 2 * X[at2(i - 1)] - X[at2(i - 2)]);
    }
  }
  return X;
}

/**
 * Lambert conformal on a sphere for a grid → { toIJ(lon, lat) → [i, j] (fractional grid indices, i east, j along the
 * scan: north for HRRR), toLonLat(i, j) → [lon, lat] }.
 */
export function lambert(g) {
  const rad = Math.PI / 180, p1 = g.latin1 * rad, p2 = g.latin2 * rad, t = (p) => Math.tan(Math.PI / 4 + p / 2);
  const n = Math.abs(p1 - p2) < 1e-10 ? Math.sin(p1) : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
  const F = Math.cos(p1) * t(p1) ** n / n, rho = (lat) => g.radius * F / t(lat * rad) ** n;
  const wrap = (d) => ((d + 540) % 360) - 180;
  const xy = (lon, lat) => { const r = rho(lat), th = n * wrap(lon - g.lov) * rad; return [r * Math.sin(th), -r * Math.cos(th)]; };
  const [x1, y1] = xy(g.lo1, g.la1), si = g.scan & 0x80 ? -1 : 1, sj = g.scan & 0x40 ? 1 : -1;
  return {
    toIJ(lon, lat) { const [x, y] = xy(lon, lat); return [si * (x - x1) / g.dx, sj * (y - y1) / g.dy]; },
    toLonLat(i, j) {
      const x = x1 + si * i * g.dx, y = y1 + sj * j * g.dy, r = Math.sign(n) * Math.hypot(x, y), th = Math.atan2(Math.sign(n) * x, -Math.sign(n) * y);
      return [wrap(g.lov + th / n / rad), (2 * Math.atan((g.radius * F / r) ** (1 / n)) - Math.PI / 2) / rad];
    },
  };
}

/**
 * The grid points round a lon/lat box (its edges mapped, plus `pad` points all round) → { i0, j0, ni, nj, f
 * (Float32Array, row j then i) }, so a stored field is a few hundred points, not two million.
 */
export function subset(values, grid, [w, s, e, n], pad = 3) {
  const P = lambert(grid); let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (let k = 0; k <= 8; k++) for (const [lon, lat] of [[w + (e - w) * k / 8, s], [w + (e - w) * k / 8, n], [w, s + (n - s) * k / 8], [e, s + (n - s) * k / 8]]) {
    const [i, j] = P.toIJ(lon, lat); i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  }
  i0 = Math.max(0, Math.floor(i0) - pad); j0 = Math.max(0, Math.floor(j0) - pad);
  i1 = Math.min(grid.nx - 1, Math.ceil(i1) + pad); j1 = Math.min(grid.ny - 1, Math.ceil(j1) + pad);
  if (i1 < i0 || j1 < j0) return { i0: 0, j0: 0, ni: 0, nj: 0, f: new Float32Array(0) };
  const ni = i1 - i0 + 1, nj = j1 - j0 + 1, f = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) f[j * ni + i] = values[(j0 + j) * grid.nx + i0 + i];
  return { i0, j0, ni, nj, f };
}

/**
 * A subset sampled at the pixel centres of an MRMS-style window (lon0, lat0 top-left, step, nx, ny) → Float32Array
 * (bilinear between grid points; 0 outside the subset or where a corner is missing).
 */
export function sample(sub, grid, win) {
  const P = lambert(grid), out = new Float32Array(win.nx * win.ny);
  for (let y = 0; y < win.ny; y++) for (let x = 0; x < win.nx; x++) {
    const [fi, fj] = P.toIJ(win.lon0 + (x + 0.5) * win.step, win.lat0 - (y + 0.5) * win.step), i = fi - sub.i0, j = fj - sub.j0, a = Math.floor(i), b = Math.floor(j);
    if (a < 0 || b < 0 || a + 1 >= sub.ni || b + 1 >= sub.nj) continue;
    const ax = i - a, ay = j - b, q = (u, v) => sub.f[(b + v) * sub.ni + a + u];
    const val = (1 - ax) * (1 - ay) * q(0, 0) + ax * (1 - ay) * q(1, 0) + (1 - ax) * ay * q(0, 1) + ax * ay * q(1, 1);
    out[y * win.nx + x] = Number.isFinite(val) && val > 0 ? val : 0;
  }
  return out;
}

/**
 * The HRRR run to use for rain from `issue` to `toT` (ms UTC): the newest cycle at least FIRST_LAG_MIN old (a replay:
 * RUN_LAG_MIN) whose file for the last hour needed is there, looking back up to `back` cycles (and only within the
 * 18 hours every cycle runs to). getBytes(url, range?) → Uint8Array, or null when there is no such file.
 * → { cycle, kind ('subh' | 'sfc' for the last hour's file) } or null.
 */
export async function findRun(issue, toT, getBytes, { replay = false, back = 6, cycle = null } = {}) {
  const c0 = cycle ?? Math.floor((issue - (replay ? RUN_LAG_MIN : FIRST_LAG_MIN) * MIN) / HOUR) * HOUR;
  for (let k = 0; k < (cycle != null ? 1 : back); k++) {
    const c = c0 - k * HOUR, fh = Math.ceil((toT - c) / HOUR); if (fh > 18) break;
    for (const kind of ['subh', 'sfc']) if (await getBytes(fileURL(c, fh, kind) + '.idx')) return { cycle: c, kind };
  }
  return null;
}

/**
 * HRRR rain over bbox for [fromT, toT] (ms UTC) from the run findRun picks (or `cycle`): for each forecast hour, the
 * sub-hourly file's 15-minute APCP where it has them, else the hourly file's. → { cycle, pieces: [{ t0, t1, sub }]
 * (each an accumulation in mm over the subset), grid, kinds: { fh: 'subh' | 'sfc' }, bytes } or throws.
 */
export async function hrrrRain(issue, fromT, toT, bbox, getBytes, { replay = false, cycle = null, onProgress = () => {} } = {}) {
  if (issue < FROM) throw new Error('HRRR on AWS starts in July 2014');
  const run = await findRun(issue, toT, getBytes, { replay, cycle });
  if (!run) throw new Error(cycle != null ? `HRRR run ${new Date(cycle).toISOString().slice(0, 13)}z not on AWS` : `no HRRR run on AWS covers to ${new Date(toT).toISOString().slice(11, 16)} UTC`);
  const c = run.cycle, f0 = Math.max(1, Math.floor((fromT - c) / HOUR) + 1), f1 = Math.ceil((toT - c) / HOUR), pieces = [], kinds = {};
  const text = (b) => (b ? new TextDecoder().decode(b) : null);
  let grid = null, bytes = 0, done = 0;
  for (let fh = f0; fh <= f1; fh++) {
    let recs = [], kind = null;
    for (const k of ['subh', 'sfc']) {
      const idx = text(await getBytes(fileURL(c, fh, k) + '.idx')); if (!idx) continue;
      recs = apcpRecords(parseIdx(idx), fh);
      if (k === 'subh') recs = recs.filter(r => r.b - r.a === 15);
      else recs = recs.filter(r => r.a === (fh - 1) * 60 && r.b === fh * 60);
      if (recs.length) { kind = k; break; }
    }
    if (!kind) throw new Error(`HRRR ${new Date(c).toISOString().slice(0, 13)}z: no rain (APCP) for forecast hour ${fh}`);
    kinds[fh] = kind;
    for (const r of recs) {
      const t0 = c + r.a * MIN, t1 = c + r.b * MIN; if (t1 <= fromT || t0 >= toT) continue;
      const b = await getBytes(fileURL(c, fh, kind), [r.offset, r.end]); onProgress(++done, null, `HRRR ${new Date(c).toISOString().slice(11, 13)}z forecast rain`);
      if (!b) throw new Error(`HRRR file missing: ${fileURL(c, fh, kind)}`);
      bytes += b.length;
      const m = decodeGrib2(b); grid ??= m.grid;
      pieces.push({ t0, t1, sub: subset(m.values, m.grid, bbox) });
    }
  }
  return { cycle: c, pieces, grid, kinds, bytes };
}

/**
 * The HRRR rain in [t0, t1] (ms) on window win, from a run's pieces (each spread evenly over its interval) → { f (mm),
 * cover (share of [t0, t1] the pieces cover) }.
 */
export function rainOn(run, win, t0, t1) {
  const f = new Float32Array(win.nx * win.ny); let cover = 0;
  for (const p of run.pieces) {
    const ov = Math.min(t1, p.t1) - Math.max(t0, p.t0); if (ov <= 0) continue;
    const g = (p.cache ??= new Map()), key = `${win.lon0},${win.lat0},${win.nx},${win.ny}`;
    let s = g.get(key); if (!s) { s = sample(p.sub, run.grid, win); g.set(key, s); }
    const k = ov / (p.t1 - p.t0); for (let i = 0; i < f.length; i++) f[i] += s[i] * k;
    cover += ov / (t1 - t0);
  }
  return { f, cover: Math.min(1, cover) };
}
/** Total HRRR rain (mm over the subset's mean) per piece: a quick check and the run record's per-piece totals. */
export const pieceMeans = (run) => run.pieces.map(p => ({ t0: p.t0, t1: p.t1, meanMM: p.sub.f.length ? p.sub.f.reduce((a, b) => a + (b > 0 ? b : 0), 0) / p.sub.f.length : 0 }));
