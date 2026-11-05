// HRRR forecast rain tests: the GRIB2 decoder on synthetic messages (complex packing with spatial differencing of order 1
// and 2, 3-byte descriptors, complex packing with missing values, simple packing), the Lambert conformal projection (the
// real HRRR grid's corners, round trips, 3 km at the true latitude), .idx parsing, the run chosen live and for a replay,
// a whole fetch by byte range from a synthetic AWS bucket (15-minute fields, and the hourly file where the sub-hourly has
// none), regridding onto the MRMS window, and the blend into the nowcast in liveRain and on rolling forward.
// Usage: node tests/run-hrrr-tests.mjs [--live]   (--live: a real Hurricane Ida run, its four 15-minute fields against
// the hourly field packed on its own, and the newest run's files on AWS now)
import { deflateSync } from 'node:zlib';
import { GRID, fileURL as mrmsURL, sampleWeights, areaMean } from '../src/mrms.js';
import * as HR from '../src/hrrr.js';
import { liveRain, nowcastFrames, forecastFrames, blendFrame, hrrrWeight, BLEND, CONTROL, newFrames, motionSource, rollForward } from '../src/nowcast.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const MIN = 60e3, HOUR = 3600e3;

// ---------------------------------------------------------------- a GRIB2 writer (Lambert grid, packing 5.0 / 5.2 / 5.3)
const nbits = (x) => (x > 0 ? x.toString(2).length : 0);
class Bits {
  constructor() { this.a = []; this.cur = 0; this.n = 0; }
  put(v, w) { for (let k = w - 1; k >= 0; k--) { this.cur = (this.cur << 1) | (Math.floor(v / 2 ** k) & 1); if (++this.n === 8) { this.a.push(this.cur); this.cur = 0; this.n = 0; } } }
  align() { while (this.n) this.put(0, 1); }
  bytes() { return Buffer.from(this.a); }
}
const smBytes = (v, n) => { const b = Buffer.alloc(n); let m = Math.abs(v); for (let k = n - 1; k >= 0; k--) { b[k] = m % 256; m = Math.floor(m / 256); } if (v < 0) b[0] |= 0x80; return b; };
/** The real HRRR CONUS grid, or a small one with the same projection. */
const HRRR = { nx: 1799, ny: 1059, la1: 21.138123, lo1: -122.719528, lov: -97.5, latin: 38.5, dx: 3000 };
/**
 * A GRIB2 message of integer values X (value = X / 10^D) on a Lambert grid g, packed as tpl 0, 2 or 3 (order, octets,
 * group length); missing (NaN) only with tpl 2 (miss 1).
 */
function encodeGRIB2(X, g, { tpl = 3, D = 3, order = 2, octets = 3, glen = 10 } = {}) {
  const sec = (n, len, fill) => { const b = Buffer.alloc(len); b.writeUInt32BE(len, 0); b[4] = n; fill?.(b); return b; };
  const lon = (d) => Math.round(((d + 360) % 360) * 1e6), sm32 = (b, v, o) => b.writeUInt32BE(v < 0 ? (0x80000000 | -v) >>> 0 : v, o);
  const s3 = sec(3, 81, b => { b.writeUInt32BE(g.nx * g.ny, 6); b.writeUInt16BE(30, 12); b[14] = 6; b.writeUInt32BE(g.nx, 30); b.writeUInt32BE(g.ny, 34); sm32(b, Math.round(g.la1 * 1e6), 38); b.writeUInt32BE(lon(g.lo1), 42);
    b[46] = 8; b.writeUInt32BE(Math.round(g.latin * 1e6), 47); b.writeUInt32BE(lon(g.lov), 51); b.writeUInt32BE(g.dx * 1000, 55); b.writeUInt32BE(g.dx * 1000, 59); b[64] = 0x40;
    b.writeUInt32BE(Math.round(g.latin * 1e6), 65); b.writeUInt32BE(Math.round(g.latin * 1e6), 69); });
  const n = X.length; let s5, s7;
  if (tpl === 0) {
    const nb = nbits(Math.max(...X)), w = new Bits(); for (const x of X) w.put(x, nb); w.align();
    s5 = sec(5, 21, b => { b.writeUInt32BE(n, 5); b.writeUInt16BE(0, 9); b.writeFloatBE(0, 11); b.writeUInt16BE(D, 17); b[19] = nb; });
    s7 = Buffer.concat([sec(7, 5), w.bytes()]);
  } else {
    let vals = Array.from(X), extra = Buffer.alloc(0);
    if (tpl === 3) { // spatial differences, the first `order` values kept aside, the rest less their minimum
      const d = vals.map((v, i) => (i < order ? 0 : order === 1 ? v - vals[i - 1] : v - 2 * vals[i - 1] + vals[i - 2])), minsd = Math.min(...d.slice(order));
      extra = Buffer.concat([smBytes(vals[0], octets), ...(order === 2 ? [smBytes(vals[1], octets)] : []), smBytes(minsd, octets)]);
      vals = d.map((v, i) => (i < order ? 0 : v - minsd));
    }
    const groups = []; for (let i = 0; i < n; i += glen) groups.push(vals.slice(i, i + glen));
    const miss = vals.some(Number.isNaN) ? 1 : 0;
    const G = groups.map(gr => { const ok = gr.filter(v => !Number.isNaN(v)); if (!ok.length) return { ref: null, w: 0, gr }; const ref = Math.min(...ok), span = Math.max(...ok) - ref; return { ref, w: nbits(span + (miss && gr.some(Number.isNaN) ? 1 : 0)), gr }; });
    const refMax = Math.max(...G.map(x => x.ref ?? 0)), nb = Math.max(1, nbits(refMax + miss)), M1 = 2 ** nb - 1;
    for (const x of G) if (x.ref == null) x.ref = M1; // a group all missing
    const wBits = nbits(Math.max(...G.map(x => x.w))), lens = G.map(x => x.gr.length), lRef = Math.min(...lens), lBits = nbits(Math.max(...lens) - lRef);
    const w = new Bits();
    for (const x of G) w.put(x.ref, nb); w.align();
    for (const x of G) w.put(x.w, wBits); w.align();
    for (const x of G) w.put(x.gr.length - lRef, lBits); w.align();
    for (const x of G) if (x.w) for (const v of x.gr) w.put(Number.isNaN(v) ? 2 ** x.w - 1 : v - x.ref, x.w); w.align();
    s5 = sec(5, tpl === 3 ? 49 : 47, b => { b.writeUInt32BE(n, 5); b.writeUInt16BE(tpl, 9); b.writeFloatBE(0, 11); b.writeUInt16BE(D, 17); b[19] = nb; b[21] = 1; b[22] = miss;
      b.writeUInt32BE(G.length, 31); b[35] = 0; b[36] = wBits; b.writeUInt32BE(lRef, 37); b[41] = 1; b.writeUInt32BE(lens.at(-1), 42); b[46] = lBits; if (tpl === 3) { b[47] = order; b[48] = octets; } });
    s7 = Buffer.concat([sec(7, 5), extra, w.bytes()]);
  }
  s7.writeUInt32BE(s7.length, 0);
  const body = Buffer.concat([sec(1, 21), s3, sec(4, 58), s5, sec(6, 6, b => { b[5] = 255; }), s7, Buffer.from('7777')]);
  const s0 = Buffer.alloc(16); s0.write('GRIB', 0, 'latin1'); s0[7] = 2; s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return new Uint8Array(Buffer.concat([s0, body]));
}

// ---------------------------------------------------------------- the decoder
{
  const g = { ...HRRR, nx: 23, ny: 17 }, n = g.nx * g.ny;
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const X = Array.from({ length: n }, (_, k) => (k % 41 < 9 ? 0 : Math.round(5000 * rnd() ** 3))); // dry runs and showers, like rain
  for (const [label, o] of [['5.3, order 2, 3-byte descriptors', { tpl: 3, order: 2, octets: 3 }], ['5.3, order 1, 2-byte descriptors', { tpl: 3, order: 1, octets: 2 }],
    ['5.3, groups of 1', { tpl: 3, glen: 1 }], ['5.2 (no differencing)', { tpl: 2 }], ['5.0 (simple)', { tpl: 0 }]]) {
    const m = HR.decodeGrib2(encodeGRIB2(X, g, o));
    check(`decode ${label}: every value`, m.values.length === n && X.every((x, k) => near(m.values[k], x / 1000, 1e-6)), `max ${Math.max(...m.values).toFixed(3)} mm`);
  }
  const Xs = X.map(x => x - 2500), m2 = HR.decodeGrib2(encodeGRIB2(Xs.map(x => x + 2500), g, { tpl: 3, order: 2, octets: 2 })); // differences of both signs
  check('decode 5.3: negative first values and differences (sign and magnitude)', Xs.every((x, k) => near(m2.values[k], (x + 2500) / 1000, 1e-6)));
  const Xm = X.map((x, k) => (k % 7 === 3 || (k >= 100 && k < 130) ? NaN : x)), mm = HR.decodeGrib2(encodeGRIB2(Xm, g, { tpl: 2 }));
  check('decode 5.2 with missing values (all bits set; a whole group missing)', Xm.every((x, k) => (Number.isNaN(x) ? Number.isNaN(mm.values[k]) : near(mm.values[k], x / 1000, 1e-6))));
  const G = m2.grid;
  check('decode: the Lambert grid read back', G.nx === 23 && G.ny === 17 && near(G.la1, HRRR.la1, 1e-6) && near(G.lo1, HRRR.lo1, 1e-6) && G.lov === -97.5 && G.latin1 === 38.5 && G.dx === 3000 && G.scan === 64 && G.radius === 6371229);
  let threw = ''; try { const b = Buffer.from(encodeGRIB2(X, g, { tpl: 3 })); b.writeUInt16BE(40, 16 + 21 + 81 + 58 + 9); HR.decodeGrib2(b); } catch (e) { threw = e.message; }
  check('decode: JPEG 2000 packing (5.40) is refused', /5\.40/.test(threw), threw);
  threw = ''; try { HR.decodeGrib2(new Uint8Array(40)); } catch (e) { threw = e.message; }
  check('decode: not GRIB2 is refused', /not a GRIB2/.test(threw));
}

// ---------------------------------------------------------------- the projection
{
  const g = { nx: HRRR.nx, ny: HRRR.ny, la1: HRRR.la1, lo1: HRRR.lo1, lov: HRRR.lov, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, scan: 64, radius: 6371229 }, P = HR.lambert(g);
  const [i0, j0] = P.toIJ(HRRR.lo1, HRRR.la1), ne = P.toLonLat(1798, 1058), nw = P.toLonLat(0, 1058);
  check('Lambert: the first point is (0, 0)', near(i0, 0, 1e-9) && near(j0, 0, 1e-9));
  check('Lambert: HRRR corners as NCEP gives them (NE 60.917° W 47.842° N, NW 134.096° W, SE 72.29° W 21.14° N)', near(ne[0], -60.917, 0.002) && near(ne[1], 47.842, 0.002) && near(nw[0], -134.096, 0.002) && near(P.toLonLat(1798, 0)[0], -72.29, 0.01),
    `NE ${ne.map(v => v.toFixed(4))}, NW ${nw.map(v => v.toFixed(4))}`);
  const rt = [[-75.16, 39.95], [-118.2, 34.05], [-80.84, 35.22], [-97.5, 50]].every(([lo, la]) => { const [a, b] = P.toLonLat(...P.toIJ(lo, la)); return near(a, lo, 1e-9) && near(b, la, 1e-9); });
  check('Lambert: lon/lat → grid → lon/lat round trips', rt);
  const [ia] = P.toIJ(-97.5, 30), [ib] = P.toIJ(-97.5, 45), hav = (a, b) => { const r = Math.PI / 180, d = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2; return 2 * 6371229 * Math.asin(Math.sqrt(d)); };
  const [ic, jc] = P.toIJ(-97.5, 38.5);
  check('Lambert: LoV is a grid column; 3 km between points at the true latitude', near(ia, ib, 1e-9) && near(hav(P.toLonLat(ic, jc), P.toLonLat(ic + 1, jc)), 3000, 0.01), `${hav(P.toLonLat(ic, jc), P.toLonLat(ic + 1, jc)).toFixed(3)} m`);
}

// ---------------------------------------------------------------- .idx, URLs
{
  const idx = HR.parseIdx('83:59949905:d=2026110512:PRATE:surface:3 hour fcst:\n84:60020390:d=2026110512:APCP:surface:0-3 hour acc fcst:\n90:60585223:d=2026110512:APCP:surface:2-3 hour acc fcst:\n91:60600000:d=2026110512:WEASD:surface:2-3 hour acc fcst:\n');
  check('idx: offsets, and each message ends where the next begins', idx.length === 4 && idx[1].offset === 60020390 && idx[1].end === 60585222 && idx[3].end === null && idx[2].desc === '2-3 hour acc fcst');
  const sfc = HR.apcpRecords(idx, 3);
  check('idx: the hourly file\'s APCP for hour 3 (not the total from 0)', sfc.length === 1 && sfc[0].a === 120 && sfc[0].b === 180 && sfc[0].offset === 60585223);
  const subh = HR.apcpRecords(HR.parseIdx(['25:1:d=2026110512:PRATE:surface:135 min fcst:', '26:2000:d=2026110512:APCP:surface:120-135 min acc fcst:', '27:5000:d=2026110512:WEASD:surface:120-135 min acc fcst:',
    '75:9000:d=2026110512:APCP:surface:135-150 min acc fcst:', '76:12000:d=x:FROZR:surface:135-150 min acc fcst:'].join('\n')), 3);
  check('idx: the sub-hourly file\'s 15-minute APCP', subh.length === 2 && subh[0].a === 120 && subh[0].b === 135 && subh[0].end === 4999 && subh[1].a === 135 && subh[1].end === 11999);
  check('idx: interval units', JSON.stringify(HR.accInterval('1-2 hour acc fcst')) === '[60,120]' && JSON.stringify(HR.accInterval('0-1 day acc fcst')) === '[0,1440]' && HR.accInterval('3 hour fcst') === null);
  check('URL: sub-hourly and hourly files on AWS', HR.fileURL(Date.parse('2021-09-01T22:00Z'), 2) === 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20210901/conus/hrrr.t22z.wrfsubhf02.grib2' &&
    HR.fileURL(Date.parse('2026-11-05T03:00Z'), 12, 'sfc') === 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20261105/conus/hrrr.t03z.wrfsfcf12.grib2');
}

// ---------------------------------------------------------------- a synthetic AWS bucket: messages back to back, an .idx each
/** Files for a run: { fh: { subh: [[a, b, X]...], sfc: [[a, b, X]] } } → Map url → bytes (byte ranges served by getBytes). */
function bucket(cycle, hours, g, files = new Map()) {
  const stamp = new Date(cycle).toISOString().slice(0, 13).replace(/[-T]/g, '');
  for (const [fh, kinds] of Object.entries(hours)) for (const [kind, msgs] of Object.entries(kinds)) {
    const parts = [], lines = []; let off = 0, n = 1;
    lines.push(`${n++}:${off}:d=${stamp}:REFC:entire atmosphere:${fh} hour fcst:`); parts.push(Buffer.alloc(100)); off += 100; // a field before
    for (const [a, b, X] of msgs) {
      const m = Buffer.from(encodeGRIB2(X, g)), desc = kind === 'subh' ? `${a}-${b} min acc fcst` : `${a / 60}-${b / 60} hour acc fcst`;
      lines.push(`${n++}:${off}:d=${stamp}:APCP:surface:${desc}:`); parts.push(m); off += m.length;
      lines.push(`${n++}:${off}:d=${stamp}:WEASD:surface:${desc}:`); parts.push(Buffer.alloc(50)); off += 50;
    }
    files.set(HR.fileURL(cycle, Number(fh), kind), new Uint8Array(Buffer.concat(parts))); files.set(HR.fileURL(cycle, Number(fh), kind) + '.idx', new TextEncoder().encode(lines.join('\n') + '\n'));
  }
  return files;
}
const served = (files, log = []) => async (u, range) => { const b = files.get(u); if (!b) return null; log.push(range ? 'range' : 'whole'); return range ? b.subarray(range[0], range[1] == null ? b.length : range[1] + 1) : b; };

// the run chosen
{
  const c13 = Date.parse('2026-11-02T13:00Z'), c14 = c13 + HOUR, files = new Map(), g = { ...HRRR, nx: 3, ny: 3 }, X = new Array(9).fill(0);
  for (const c of [c13, c14]) bucket(c, Object.fromEntries([1, 2, 3].map(fh => [fh, { subh: [[(fh - 1) * 60, (fh - 1) * 60 + 15, X]] }])), g, files);
  const issue = Date.parse('2026-11-02T14:55Z'), toT = issue + 60 * MIN, get = served(files);
  const live = await HR.findRun(issue, toT, get), replay = await HR.findRun(issue, toT, get, { replay: true });
  check('run: live takes the newest cycle at least 50 min old with its files there (14z at 14:55)', live?.cycle === c14 && live.kind === 'subh');
  check('run: a replay takes the newest that was whole by the issue time (13z: 14z was not done until ~15:20)', replay?.cycle === c13);
  const f2 = new Map([...files].filter(([u]) => !u.includes('t14z')));
  check('run: a cycle not on AWS yet → the one before', (await HR.findRun(issue, toT, served(f2)))?.cycle === c13);
  check('run: none within 18 hours of forecast → null', (await HR.findRun(issue, issue + 30 * HOUR, get)) === null);
  check('run: a pinned cycle (a reopened project)', (await HR.findRun(issue, toT, get, { cycle: c13 }))?.cycle === c13 && (await HR.findRun(issue, toT, get, { cycle: c13 - HOUR })) === null);
}

// ---------------------------------------------------------------- liveRain with HRRR past 90 minutes (the nowcast test's storm)
function encodePNG(W, H, data) {
  const raw = new Uint8Array(H * (W + 1)); for (let y = 0; y < H; y++) raw.set(data.subarray(y * W, (y + 1) * W), y * (W + 1) + 1);
  const chunk = (type, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(type, 4, 'latin1'); Buffer.from(body).copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 3;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', Buffer.alloc(768)), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]));
}
const field = (W, H, cells) => { const f = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const c of cells) f[y * W + x] += c.a * Math.exp(-((x - c.x) ** 2 + (y - c.y) ** 2) / (2 * c.s * c.s)); return f; };
{
  // MRMS: a cell moving east at 0.5 px/min along row 30 (as in run-nowcast-tests), observed to 14:26 UTC
  const IW = 400, IH = 200, T0 = Date.parse('2026-11-02T13:00Z'), latest = Date.parse('2026-11-02T14:26Z'), now = Date.parse('2026-11-02T14:33Z');
  const xAt = (t) => 40 + 0.5 * (t - T0) / MIN, files = new Map(), later = new Map(); // files: to 14:26; later: to 14:46
  const a2m = (t) => { const f = field(IW, IH, [{ x: xAt(t - MIN), y: 30, a: 100, s: 4 }]); return encodePNG(IW, IH, Uint8Array.from(f, v => Math.min(254, Math.round(v)))); };
  for (let t = T0 + 2 * MIN; t <= latest + 20 * MIN; t += 2 * MIN) { const b = a2m(t); later.set(mrmsURL('a2m', t), b); if (t <= latest) files.set(mrmsURL('a2m', t), b); }
  for (const m of [files, later]) m.set(mrmsURL('p1h', Date.parse('2026-11-02T14:00Z')), encodePNG(IW, IH, new Uint8Array(IW * IH)));
  const getBytes = async (u) => files.get(u) ?? null, bbox = [GRID.lon0 + 1.0, GRID.lat0 - 0.4, GRID.lon0 + 1.2, GRID.lat0 - 0.2];
  // HRRR: a small Lambert grid round the area, rain linear in the grid indices (so bilinear sampling is exact), cycle 13z
  const P0 = HR.lambert({ ...HRRR, latin1: 38.5, latin2: 38.5, dy: 3000, scan: 64, radius: 6371229 }), [ci, cj] = P0.toIJ(bbox[0] - 1.2, bbox[1] - 1.2);
  const [lo1, la1] = P0.toLonLat(Math.floor(ci), Math.floor(cj)), g = { ...HRRR, lo1, la1, nx: 110, ny: 110 }, gd = { ...g, latin1: 38.5, latin2: 38.5, dy: 3000, scan: 64, radius: 6371229 };
  const lin = (a, b, c) => Array.from({ length: g.nx * g.ny }, (_, k) => a + b * (k % g.nx) + c * Math.floor(k / g.nx)); // X = value × 1000
  const c13 = Date.parse('2026-11-02T13:00Z'), q = (n) => lin(1000 * (n + 1), 10, 20);
  bucket(c13, { 3: { subh: [[120, 135, q(0)], [135, 150, q(1)], [150, 165, q(2)], [165, 180, q(3)]] }, 4: { subh: [], sfc: [[180, 240, lin(8000, 40, 0)]] } }, g, files);
  const log = [], hb = served(files, log);
  const lr = await liveRain(now, bbox, getBytes, { obsHours: 1, leadMin: 120, gauge: false, qpf: { getBytes: hb, replay: false } });
  const win = lr.win, from = 43, Q = lr.live.qpf;
  check('blend: liveRain finds the 13z run and reads forecast hours 3 (15-min) and 4 (hourly)', Q && Q.cycle === c13 && Q.kinds[3] === 'subh' && Q.kinds[4] === 'sfc' && Q.pieces === 4 && lr.qpf.pieces.length === 4 && log.filter(x => x === 'range').length === 4,
    JSON.stringify(Q));
  check('blend: 120 min of forecast frames, the observed ones as before', lr.frames.length === 43 + 60 && lr.stats.forecastFrames === 60);
  const nowcast = nowcastFrames(lr.src, win, 120), P = HR.lambert(lr.qpf.grid);
  const hrrrAt = (x, y, pieceA, b, c) => { const [fi, fj] = P.toIJ(win.lon0 + (x + 0.5) * win.step, win.lat0 - (y + 0.5) * win.step); return (pieceA + b * fi + c * fj) / 1000; };
  check('blend: the nowcast alone to +60 min', nowcast.slice(0, 30).every((f, i) => f.every((v, p) => v === lr.frames[from + i][p])));
  const k90 = from + 45, k100 = from + 50, px = [0, Math.floor(win.nx * win.ny / 2), win.nx * win.ny - 1];
  const okAt = (k, fn) => px.every(p => near(lr.frames[k][p], fn(p % win.nx, Math.floor(p / win.nx)), 1e-5));
  check('blend: HRRR alone from +90 min (15:56–15:58 UTC: the 15:45–16:00 field × 2/15)', okAt(k90, (x, y) => hrrrAt(x, y, 4000, 10, 20) * 2 / 15), `${lr.frames[k90][px[1]].toFixed(5)} vs ${(hrrrAt(px[1] % win.nx, Math.floor(px[1] / win.nx), 4000, 10, 20) * 2 / 15).toFixed(5)}`);
  check('blend: past the hour, the hourly field × 2/60 (16:06–16:08)', okAt(k100, (x, y) => hrrrAt(x, y, 8000, 40, 0) * 2 / 60));
  const k75 = from + 37, h75 = HR.rainOn(lr.qpf, win, latest + 74 * MIN, latest + 76 * MIN).f; // middle of the crossfade: w = 0.5
  check('blend: halfway at +75 min', near(hrrrWeight(75), 0.5, 1e-12) && px.every(p => near(lr.frames[k75][p], 0.5 * nowcast[37][p] + 0.5 * h75[p], 1e-6)));
  check('blend: the weight is 0 to 60, 1 from 90, linear between', hrrrWeight(59) === 0 && hrrrWeight(60) === 0 && hrrrWeight(90) === 1 && hrrrWeight(150) === 1 && near(hrrrWeight(66, BLEND), 0.2, 1e-12));
  const straddle = HR.rainOn(lr.qpf, win, Date.parse('2026-11-02T15:59Z'), Date.parse('2026-11-02T16:01Z')), xs = 3, ys = 2;
  check('rainOn: 2 minutes across 16:00 take a minute of each field', near(straddle.cover, 1, 1e-12) && near(straddle.f[ys * win.nx + xs], hrrrAt(xs, ys, 4000, 10, 20) / 15 + hrrrAt(xs, ys, 8000, 40, 0) / 60, 1e-6));
  check('rainOn: before the first field, nothing covered', HR.rainOn(lr.qpf, win, Date.parse('2026-11-02T14:00Z'), Date.parse('2026-11-02T14:02Z')).cover === 0);
  const bf = blendFrame(nowcast[10], lr.qpf, win, latest, 20), bq = blendFrame(nowcast[50], null, win, latest, 100);
  check('blendFrame: the nowcast frame itself where HRRR has no weight, or with no run', bf.f === nowcast[10] && bf.w === 0 && bq.f === nowcast[50] && bq.w === 0);
  const m = { speed: 1.3, dir: 10, growth: 0.4 }, fm = forecastFrames(lr.src, win, 120, m, lr.qpf);
  check('blend: every member shares HRRR past 90; differs before', fm.slice(45).every((f, i) => f.every((v, p) => near(v, lr.frames[k90 + i][p], 1e-6))) && fm.slice(30, 40).some((f, i) => f.some((v, p) => !near(v, lr.frames[from + 30 + i][p], 1e-4))));
  const sub = lr.qpf.pieces[0].sub;
  check('subset: only the points round the area are kept', sub.ni * sub.nj < 0.6 * g.nx * g.ny && sub.ni > 20, `${sub.ni} × ${sub.nj} of ${g.nx} × ${g.ny}`);

  // no run on AWS: the nowcast alone, and why
  const lr0 = await liveRain(now, bbox, getBytes, { obsHours: 1, leadMin: 120, gauge: false, qpf: { getBytes: async () => null } });
  check('blend: no HRRR → the nowcast alone to the end, with the reason', lr0.qpf === null && /no HRRR run/.test(lr0.live.qpf?.error ?? '') && lr0.frames.slice(from).every((f, i) => f.every((v, p) => v === nowcast[i][p])), lr0.live.qpf?.error);
  const lr90 = await liveRain(now, bbox, getBytes, { obsHours: 1, leadMin: 90, gauge: false, qpf: { getBytes: hb } });
  check('blend: a 90-minute lead asks nothing of HRRR', lr90.qpf === null && lr90.live.qpf === undefined && lr90.frames.length === 43 + 45);

  // rolling forward: frames to 14:40, then the fresh forecast from 14:40 fades into the same run
  const get2 = async (u) => later.get(u) ?? null, more = Date.parse('2026-11-02T14:40Z');
  const samples = []; for (let y = bbox[1] + 0.005; y < bbox[3]; y += 0.01) for (let x = bbox[0] + 0.005; x < bbox[2]; x += 0.01) samples.push(sampleWeights(win, x, y));
  const mean0 = areaMean(lr.frames, samples), st = { t0: lr.t0, blockMin: 2, depth: Array.from(mean0), intensity: Array.from(mean0, d => d * 30), total: 0, peakIntensity: 0,
    radar: { frames: [...lr.frames], mean: Float64Array.from(mean0), live: { observedUntil: latest, forecastFrom: from } } };
  const nf = await newFrames(latest, more + MIN, win, get2), src2 = await motionSource(nf.latest, bbox, get2), kf = Math.round((nf.latest - st.t0) / (2 * MIN));
  const fresh = forecastFrames(src2, win, (st.radar.frames.length - kf) * 2, CONTROL, lr.qpf), res = rollForward(st, nf.frames, fresh, 45, (f) => areaMean([f], samples)[0]);
  const kh = kf + 45; // +90 min from 14:40: 16:10–16:12, HRRR alone (the hourly field)
  check('roll: the refreshed forecast is HRRR alone from +90 min after the newer frame', nf.latest === more && res.refreshed === st.radar.frames.length - kf && px.every(p => near(st.radar.frames[kh][p], hrrrAt(p % win.nx, Math.floor(p / win.nx), 8000, 40, 0) * 2 / 60, 1e-5)));
  check('roll: and the nowcast from the newer frame to +60', near(st.radar.frames[kf + 5][px[1]], nowcastFrames(src2, win, 12)[5][px[1]], 1e-9));
}

if (process.argv.includes('--live')) {
  const get = async (u, r) => { const x = await fetch(u, r ? { headers: { range: `bytes=${r[0]}-${r[1] ?? ''}` } } : {}); return x.ok ? new Uint8Array(await x.arrayBuffer()) : null; };
  const text = async (u) => new TextDecoder().decode(await get(u));
  const c = Date.parse('2021-09-01T22:00Z'), fh = 2; // Hurricane Ida's remnants over Philadelphia and New York
  const quarters = HR.apcpRecords(HR.parseIdx(await text(HR.fileURL(c, fh, 'subh') + '.idx')), fh).filter(r => r.b - r.a === 15);
  const hour = HR.apcpRecords(HR.parseIdx(await text(HR.fileURL(c, fh, 'sfc') + '.idx')), fh).filter(r => r.a === 60);
  const Q = []; for (const r of quarters) Q.push(HR.decodeGrib2(await get(HR.fileURL(c, fh, 'subh'), [r.offset, r.end])).values);
  const H1 = HR.decodeGrib2(await get(HR.fileURL(c, fh, 'sfc'), [hour[0].offset, hour[0].end])), V = H1.values;
  let d = 0; for (let k = 0; k < V.length; k++) d = Math.max(d, Math.abs(Q[0][k] + Q[1][k] + Q[2][k] + Q[3][k] - V[k]));
  const S = HR.subset(V, H1.grid, [-75.4, 39.8, -74.9, 40.1]);
  check('live: Ida 22z +2 h, four 15-minute fields add up to the hourly one, everywhere', quarters.length === 4 && d < 0.01 && Math.max(...S.f) > 50, `max |Σ quarters − hour| ${d.toFixed(4)} mm; ${Math.max(...S.f).toFixed(1)} mm in the hour near Philadelphia`);
  const run = await HR.findRun(Date.now(), Date.now() + 3 * HOUR, get);
  check('live: the newest HRRR run on AWS now', run && Date.now() - run.cycle < 4 * HOUR, run && `${new Date(run.cycle).toISOString().slice(0, 13)}z (${run.kind})`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
