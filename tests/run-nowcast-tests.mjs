// Nowcast tests: storm motion by correlation (whole and part pixels, too little rain), carrying a field along it, and a
// live build on synthetic archive files: a cell moving east that reaches the model only in the forecast; the ensemble on it
// (members, the band, faster members first) and rolling it forward as newer frames arrive; plus the
// 2-minute fill from the raw PrecipRate where a2m overflowed. Usage: node tests/run-nowcast-tests.mjs [--live]
// (--live: the live build for Philadelphia from IEM now; it passes with or without rain there)
import { deflateSync, gzipSync } from 'node:zlib';
import { GRID, fileURL, rateURL, pixelWindow, frameAt, sampleWeights, areaMean } from '../src/mrms.js';
import { motion, advect, liveRain, latestFrame, nowcastFrames, ensembleMembers, ensembleSummary, incoming, quantile, probit, turn, velocityInfo, growthFactor,
  CONTROL, newFrames, motionSource, rollForward } from '../src/nowcast.js';

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

  // ---- the ensemble on the same storm: members from lr.src, the area mean over the model box
  const samples = []; for (let y = bbox[1] + 0.005; y < bbox[3]; y += 0.01) for (let x = bbox[0] + 0.005; x < bbox[2]; x += 0.01) samples.push(sampleWeights(win, x, y));
  const obsFrames = lr.frames.slice(0, 43), from = 43;
  check('ensemble: the control member is the nowcast liveRain made', nowcastFrames(lr.src, win, 60).every((f, i) => f.every((v, p) => v === lr.frames[from + i][p])));
  const grow = nowcastFrames(lr.src, win, 60, { speed: 1, dir: 0, growth: Math.log(2) }), ctl = lr.frames.slice(from);
  check('ensemble: growth scales the rain by e^(g·t) (2× an hour)', [0, 10, 29].every(i => grow[i].every((v, p) => near(v, ctl[i][p] * 2 ** ((2 * i + 1) / 60), 1e-5))));
  const ms = ensembleMembers(20, { seed: 7 }), runs = ms.map(m => ({ key: m.key, mean: Array.from(areaMean([...obsFrames, ...nowcastFrames(lr.src, win, 60, m)], samples)) }));
  const S = ensembleSummary(runs, from, 2), east = (m) => turn(lr.src.u, lr.src.v, lr.src.lat, m.speed, m.dir)[0];
  const fast = ms.reduce((a, b) => (east(b) > east(a) ? b : a)), slow = ms.reduce((a, b) => (east(b) < east(a) ? b : a)), eta = (k) => S.by.find(b => b.key === k).etaMin ?? Infinity;
  check('ensemble: the cell arrives within the hour, faster members first', eta('ctl') > 5 && eta('ctl') < 40 && eta(fast.key) <= eta('ctl') && eta('ctl') <= eta(slow.key), `ETA fast ${eta(fast.key)}, control ${eta('ctl')}, slow ${eta(slow.key)} min`);
  const ordered = (o) => o.p10 <= o.p50 && o.p50 <= o.p90;
  check('ensemble: a band, P10 ≤ P50 ≤ P90, in depth, arrival and every block', ordered(S.depth) && ordered(S.eta) && ordered(S.peak) && S.band.p10.every((v, i) => v <= S.band.p50[i] + 1e-9 && S.band.p50[i] <= S.band.p90[i] + 1e-9) && S.band.p50.length === 30 && S.depth.p90 > S.depth.p10,
    `depth ${S.depth.p10.toFixed(1)}–${S.depth.p90.toFixed(1)} mm, ETA ${S.eta.p10}–${S.eta.p90} min, ${(S.arriving * 100).toFixed(0)} % arriving`);
  const dOf = (k) => S.by.find(b => b.key === k).depthMM;
  check('ensemble: the picked dry / middle / wet members are in depth order', dOf(S.pick.p10) <= dOf(S.pick.p50) && dOf(S.pick.p50) <= dOf(S.pick.p90));

  // ---- rolling forward: frames to 14:40 arrive while the run is in the block 14:30–14:32
  const files2 = new Map(files), more = Date.parse('2026-11-02T14:40Z');
  for (let t = latest + 2 * MIN; t <= more; t += 2 * MIN) files2.set(fileURL('a2m', t), a2m(t));
  const get2 = async (u) => files2.get(u) ?? null, mean0 = areaMean(lr.frames, samples);
  const st = { t0: lr.t0, blockMin: 2, depth: Array.from(mean0), intensity: Array.from(mean0, d => d * 30), total: 0, peakIntensity: 0,
    radar: { frames: [...lr.frames], mean: Float64Array.from(mean0), live: { observedUntil: latest, forecastFrom: from } } };
  check('roll: no newer frame yet → nothing', (await newFrames(latest, Date.parse('2026-11-02T14:33Z'), win, getBytes)) === null);
  const nf = await newFrames(latest, Date.parse('2026-11-02T14:41Z'), win, get2), src2 = await motionSource(nf.latest, bbox, get2);
  const res = rollForward(st, nf.frames, nowcastFrames(src2, win, 60), 45, (f) => areaMean([f], samples)[0]);
  check('roll: 7 new frames; 2 already run, 5 replace the nowcast, the 23 after are nowcast again', nf.latest === more && nf.frames.length === 7 && res.late === 2 && res.replaced === 5 && res.refreshed === 23 && st.radar.live.forecastFrom === 50 && st.radar.live.observedUntil === more, JSON.stringify(res));
  check('roll: blocks before the run are untouched, observed ones are the frames', st.radar.frames[44] === lr.frames[44] && st.radar.frames[47].every((v, p) => v === nf.frames[4].f[p]) && near(st.total, st.depth.reduce((a, b) => a + b, 0), 1e-9));
  const [cx2] = centroid(st.radar.frames[68], win.nx, win.ny);
  check('roll: the new nowcast follows the cell from the newer frame', near(cx2 + win.c0, xAt(st.t0 + 69 * 2 * MIN - MIN), 0.8), `column ${(cx2 + win.c0).toFixed(2)} vs ${xAt(st.t0 + 69 * 2 * MIN - MIN).toFixed(2)}`);
}

// ---- ensemble pieces
{
  check('probit: 0.5 → 0, 0.975 → 1.96, symmetric', near(probit(0.5), 0, 1e-6) && near(probit(0.975), 1.96, 1e-3) && near(probit(0.1), -probit(0.9), 1e-9));
  const a = ensembleMembers(20), b = ensembleMembers(20), c = ensembleMembers(20, { seed: 2 });
  const ln = a.slice(1).map(m => Math.log(m.speed)), mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length, sd = (xs) => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
  check('members: the control first, then 20; the same seed the same members', a.length === 21 && a[0] === CONTROL && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c));
  check('members: the spreads are centred and about as asked', near(mean(ln), 0, 1e-9) && near(sd(ln), 0.2, 0.02) && near(mean(a.slice(1).map(m => m.dir)), 0, 1e-9) && near(sd(a.slice(1).map(m => m.dir)), 15, 1.5) && near(sd(a.slice(1).map(m => m.growth)), 0.5, 0.05),
    `ln speed σ ${sd(ln).toFixed(3)}, dir σ ${sd(a.slice(1).map(m => m.dir)).toFixed(1)}°`);
  check('members: the growth factor is held within ¼–4×', growthFactor(5, 60) === 4 && growthFactor(-5, 60) === 0.25 && near(growthFactor(Math.log(2), 30), Math.SQRT2, 1e-12));
  const [u, v] = turn(1, 0, 40, 1.5, 90), V = velocityInfo(u, v, 40);
  check('turn: east × 1.5 turned 90° clockwise → south, 1.5× as fast', near(V.toward, 180, 1e-6) && near(V.kmh, 1.5 * velocityInfo(1, 0, 40).kmh, 1e-6), `${V.toward.toFixed(1)}°, ${V.kmh.toFixed(1)} km/h`);
  check('quantile: linear, and infinite past the members that arrive', quantile([4, 1, 3, 2], 0.5) === 2.5 && quantile([1, 2, Infinity], 0.5) === 2 && quantile([1, Infinity, Infinity], 0.5) === Infinity);
  const m = [0, 0, 0.01, 0, 0, 0.05, 0.2, 0.3, 0];
  const I = incoming(m, 4, 2), W = incoming([0, 0, 0.1, 0.2, 0, 0], 4, 2);
  check('incoming: the first block at 1 mm/hr after now, the depth and peak over the lead', I.etaMin === 2 && !I.rainingNow && near(I.depthMM, 0.55, 1e-12) && near(I.peakMMHR, 9, 1e-9) && I.peakAtMin === 6 && W.rainingNow && W.etaMin === 0 && incoming([0, 0, 0], 1, 2).etaMin === null);
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
process.exit(fails ? 1 : 0);
