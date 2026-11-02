// Nowcast tests: storm motion by correlation (whole and part pixels, too little rain), carrying a field along it, and a
// live build on synthetic archive files: a cell moving east that reaches the model only in the forecast, plus the
// 2-minute fill from the raw PrecipRate where a2m overflowed. Usage: node tests/run-nowcast-tests.mjs [--live]
// (--live: the live build for Philadelphia from IEM now; it passes with or without rain there)
import { deflateSync, gzipSync } from 'node:zlib';
import { GRID, fileURL, rateURL, pixelWindow, frameAt } from '../src/mrms.js';
import { motion, advect, liveRain, latestFrame } from '../src/nowcast.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const MIN = 60e3;

/** A W × H field with Gaussian cells [{ x, y, a, s }] (pixel indices). */
const field = (W, H, cells) => { const f = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const c of cells) f[y * W + x] += c.a * Math.exp(-((x - c.x) ** 2 + (y - c.y) ** 2) / (2 * c.s * c.s)); return f; };
const centroid = (f, W, H) => { let s = 0, sx = 0, sy = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { s += f[y * W + x]; sx += x * f[y * W + x]; sy += y * f[y * W + x]; } return [sx / s, sy / s, s]; };

// ---- motion
{
  const W = 160, H = 120, cells = [{ x: 50, y: 60, a: 5, s: 6 }, { x: 90, y: 40, a: 3, s: 4 }, { x: 70, y: 85, a: 8, s: 3 }];
  const a = field(W, H, cells);
  for (const [dx, dy] of [[7, -4], [-12, 9], [0, 0], [6.5, -2.5], [21.3, 3.7]]) {
    const m = motion(a, field(W, H, cells.map(c => ({ ...c, x: c.x + dx, y: c.y + dy }))), W, H, 40);
    check(`motion: shift (${dx}, ${dy})`, m && near(m.dx, dx, 0.35) && near(m.dy, dy, 0.35) && m.score > 0.95, m && `(${m.dx.toFixed(2)}, ${m.dy.toFixed(2)}) r ${m.score.toFixed(3)}`);
  }
  check('motion: too little rain → none', motion(new Float32Array(W * H), a, W, H) === null);
}

// ---- advection
{
  const W = { lon0: -100, lat0: 40, step: 0.01, nx: 80, ny: 60 }, w = { lon0: -99.8, lat0: 39.9, step: 0.01, nx: 30, ny: 20 }; // w starts 20 px east, 10 px south
  const f = field(W.nx, W.ny, [{ x: 25, y: 15, a: 4, s: 3 }]);
  const same = advect(f, W, W, 0, 0, 30);
  check('advect: still field is unchanged', same.every((v, k) => near(v, f[k], 1e-6)));
  const g = advect(f, W, w, 0.5, 0.25, 20), [cx, cy] = centroid(g, w.nx, w.ny);
  check('advect: moved by velocity × time, onto another window', near(cx, 25 + 10 - 20, 0.2) && near(cy, 15 + 5 - 10, 0.2), `(${cx.toFixed(2)}, ${cy.toFixed(2)})`);
  check('advect: from outside the field, none', advect(f, W, w, -5, 0, 30).every(v => v === 0));
}

/** PNG (8-bit palette or 16-bit grey) and GRIB2 writers, as in run-mrms-tests. */
function encodePNG(W, H, data, bits = 8) {
  const bpp = bits / 8, RB = W * bpp, raw = new Uint8Array(H * (RB + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = data[y * W + x], o = y * (RB + 1) + 1 + x * bpp; if (bpp === 1) raw[o] = v; else { raw[o] = v >> 8; raw[o + 1] = v & 255; } }
  const chunk = (type, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(type, 4, 'latin1'); Buffer.from(body).copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = bits; ihdr[9] = bpp === 1 ? 3 : 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...(bpp === 1 ? [chunk('PLTE', Buffer.alloc(768))] : []), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]));
}
function encodeGRIB(png) {
  const sec = (n, len, fill) => { const b = Buffer.alloc(len); b.writeUInt32BE(len, 0); b[4] = n; fill?.(b); return b; };
  const s3 = sec(3, 72, b => { b.writeUInt32BE(GRID.nx, 30); b.writeUInt32BE(GRID.ny, 34); b.writeUInt32BE(54995000, 46); b.writeUInt32BE(230005000, 50); });
  const s5 = sec(5, 21, b => { b.writeUInt16BE(41, 9); b.writeFloatBE(-30, 11); b.writeUInt16BE(1, 17); b[19] = 16; });
  const body = Buffer.concat([sec(1, 21), s3, sec(4, 34), s5, sec(6, 6, b => { b[5] = 255; }), sec(7, 5 + png.length, b => Buffer.from(png).copy(b, 5)), Buffer.from('7777')]);
  const s0 = Buffer.alloc(16); s0.write('GRIB', 0, 'latin1'); s0[7] = 2; s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return new Uint8Array(gzipSync(Buffer.concat([s0, body])));
}

// ---- a live build near the grid's top-left corner: a cell moving east at 0.5 px/min along row 30, from column 40 at
// 13:00 UTC; the model (columns 100–120, rows 20–40) sees it only in the forecast
{
  const IW = 400, IH = 200, T0 = Date.parse('2026-11-02T13:00Z'), latest = Date.parse('2026-11-02T14:26Z');
  const xAt = (t) => 40 + 0.5 * (t - T0) / MIN, files = new Map();
  const a2m = (t) => { const f = field(IW, IH, [{ x: xAt(t - MIN), y: 30, a: 100, s: 4 }]); return encodePNG(IW, IH, Uint8Array.from(f, v => Math.min(254, Math.round(v)))); };
  for (let t = T0 + 2 * MIN; t <= latest; t += 2 * MIN) files.set(fileURL('a2m', t), a2m(t));
  files.set(fileURL('p1h', Date.parse('2026-11-02T14:00Z')), encodePNG(IW, IH, new Uint8Array(IW * IH))); // dry at the model: no frames fetched for it
  const getBytes = async (u) => files.get(u) ?? null;
  check('live: the latest frame at or before now', (await latestFrame(Date.parse('2026-11-02T14:33Z'), getBytes)) === latest);
  const bbox = [GRID.lon0 + 1.0, GRID.lat0 - 0.4, GRID.lon0 + 1.2, GRID.lat0 - 0.2];
  const lr = await liveRain(Date.parse('2026-11-02T14:33Z'), bbox, getBytes, { obsHours: 1, leadMin: 60, gauge: false });
  check('live: one whole hour, the part hour to 14:26, then 60 min of nowcast', lr.t0 === T0 && lr.frames.length === 30 + 13 + 30 && lr.live.observedUntil === latest && lr.stats.partFrames === 13 && lr.stats.forecastFrames === 30, `${lr.frames.length} frames`);
  const M = lr.live.motion;
  check('live: motion 0.5 px/min east', M && near(M.u, 0.5, 0.03) && near(M.v, 0, 0.03) && near(M.toward, 90, 4) && near(M.kmh, 0.5 * 60 * 0.01 * 111.32 * Math.cos(54.7 * Math.PI / 180), 1.5), M && `${M.u.toFixed(3)}, ${M.v.toFixed(3)} px/min; ${M.kmh.toFixed(1)} km/h toward ${M.toward.toFixed(0)}°`);
  const win = lr.win, k = 43 + 25, [cx] = centroid(lr.frames[k], win.nx, win.ny); // forecast frame for 15:16–15:18 UTC: the cell at column xAt(15:17)
  check('live: the forecast cell is where it would be', near(cx + win.c0, xAt(latest + 51 * MIN), 0.8), `column ${(cx + win.c0).toFixed(2)} vs ${xAt(latest + 51 * MIN).toFixed(2)}`);
  check('live: no rain at the model until the cell arrives', lr.frames.slice(0, 43).every(f => !f || f.every(v => v < 1e-3)) && lr.frames[k].some(v => v > 0.5));
}

// ---- an overflowed 2-minute frame filled from the raw PrecipRate
{
  const t = Date.parse('2016-07-30T23:30Z'), win = { r0: 0, r1: 2, c0: 0, c1: 3, nx: 3, ny: 2 }, files = new Map();
  files.set(fileURL('a2m', t), encodePNG(3, 2, Uint8Array.from([10, 255, 0, 255, 20, 30])));
  const X = new Uint16Array(GRID.nx * 2); X[1] = 1830; X[GRID.nx] = 0; // 180 mm/hr at the first; no value at the second
  files.set(rateURL(t), encodeGRIB(encodePNG(GRID.nx, 2, X, 16)));
  const stats = {}, g = await frameAt(t, win, async (u) => files.get(u) ?? null, stats);
  check('fill: overflowed pixel from PrecipRate (180 mm/hr → 6 mm in 2 min), others kept', near(g[1], 6, 1e-4) && near(g[0], 0.21, 1e-6) && Number.isNaN(g[3]) && stats.filledFrames === 1, Array.from(g, v => v.toFixed(2)).join(' '));
  const clean = await frameAt(t, win, async (u) => (u.includes('a2m') ? encodePNG(3, 2, Uint8Array.from([1, 2, 3, 4, 5, 6])) : null), stats);
  check('fill: a clean frame asks for nothing more', clean.every(Number.isFinite) && stats.filledFrames === 1);
  check('rate URL', rateURL(t) === 'https://mtarchive.geol.iastate.edu/2016/07/30/mrms/ncep/PrecipRate/PrecipRate_00.00_20160730-233000.grib2.gz');
}

if (process.argv.includes('--live')) {
  const get = async (u) => { const r = await fetch(u); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; };
  const lr = await liveRain(Date.now(), [-75.25, 39.9, -75.1, 40.0], get, { obsHours: 2, leadMin: 30 });
  const ageMin = (Date.now() - lr.live.observedUntil) / MIN, M = lr.live.motion;
  check('live: Philadelphia now', ageMin < 30 && lr.frames.length === lr.frames.length && lr.stats.forecastFrames === 15,
    `latest frame ${ageMin.toFixed(0)} min old, ${lr.frames.length} frames, motion ${M ? `${M.kmh.toFixed(0)} km/h toward ${M.toward.toFixed(0)}°, r ${M.score.toFixed(2)}` : 'none (too little rain)'}; ${JSON.stringify(lr.stats)}`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall passed');
