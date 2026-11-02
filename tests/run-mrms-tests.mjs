// MRMS radar rainfall tests: the PNG window decoder (every scanline filter), the IEM lookup tables, pixel windows and
// interpolation, shaping each hour's total by its 2-minute frames (and the fallbacks), and the whole build on synthetic
// archive files, and the gauge-corrected totals (GRIB2 with PNG packing). Usage: node tests/run-mrms-tests.mjs [--live]
// (--live: Hurricane Ida over Philadelphia, and one gauge-corrected hour at Ellicott City, from IEM)
import { deflateSync, gzipSync } from 'node:zlib';
import { GRID, fileURL, gaugeURL, p1hMM, a2mMM, pixelWindow, decodeWindow, decodeGribWindow, sampleWeights, shapeHour, radarRain, areaMean, framesHash } from '../src/mrms.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/** A PNG of W × H values, each row written with filters[row % filters.length]: 8-bit palette, or 16-bit grey (bits 16). */
function encodePNG(W, H, data, filters = [0], bits = 8) {
  const bpp = bits / 8, RB = W * bpp, bytes = new Uint8Array(H * RB);
  for (let k = 0; k < W * H; k++) if (bpp === 1) bytes[k] = data[k]; else { bytes[2 * k] = data[k] >> 8; bytes[2 * k + 1] = data[k] & 255; }
  const raw = new Uint8Array(H * (RB + 1));
  for (let y = 0; y < H; y++) {
    const f = filters[y % filters.length], row = bytes.subarray(y * RB, (y + 1) * RB), up = y ? bytes.subarray((y - 1) * RB, y * RB) : new Uint8Array(RB);
    raw[y * (RB + 1)] = f;
    for (let x = 0; x < RB; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = up[x], c = x >= bpp ? up[x - bpp] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })() : 0;
      raw[y * (RB + 1) + 1 + x] = (row[x] - pred) & 255;
    }
  }
  const chunk = (type, body) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(type, 4, 'latin1'); Buffer.from(body).copy(b, 8); return b; }; // CRC left 0: not checked
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = bits; ihdr[9] = bpp === 1 ? 3 : 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...(bpp === 1 ? [chunk('PLTE', Buffer.alloc(768))] : []), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]));
}
/** A gauge-corrected MRMS GRIB2 file: the CONUS grid, PNG packing (R, E, D), the 16-bit image of X values. */
function encodeGRIB(png, { R = -30, E = 0, D = 1, gzip = true, nx = GRID.nx } = {}) {
  const sec = (n, len, fill) => { const b = Buffer.alloc(len); b.writeUInt32BE(len, 0); b[4] = n; fill?.(b); return b; };
  const sm = (v) => (v < 0 ? 0x8000 | -v : v);
  const s3 = sec(3, 72, b => { b.writeUInt16BE(0, 12); b.writeUInt32BE(nx, 30); b.writeUInt32BE(GRID.ny, 34); b.writeUInt32BE(54995000, 46); b.writeUInt32BE(230005000, 50); b.writeUInt32BE(10000, 63); b.writeUInt32BE(10000, 67); });
  const s5 = sec(5, 21, b => { b.writeUInt32BE(GRID.nx * GRID.ny, 5); b.writeUInt16BE(41, 9); b.writeFloatBE(R, 11); b.writeUInt16BE(sm(E), 15); b.writeUInt16BE(sm(D), 17); b[19] = 16; });
  const s7 = sec(7, 5 + png.length, b => Buffer.from(png).copy(b, 5));
  const body = Buffer.concat([sec(1, 21), s3, sec(4, 34), s5, sec(6, 6, b => { b[5] = 255; }), s7, Buffer.from('7777')]);
  const s0 = Buffer.alloc(16); s0.write('GRIB', 0, 'latin1'); s0[6] = 209; s0[7] = 2; s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  const g = Buffer.concat([s0, body]);
  return new Uint8Array(gzip ? gzipSync(g) : g);
}

// ---- the decoder, every filter, windows anywhere
{
  const W = 37, H = 23, data = new Uint8Array(W * H);
  let seed = 7; for (let k = 0; k < data.length; k++) { seed = (seed * 1103515245 + 12345) >>> 0; data[k] = (seed >>> 16) & 255; }
  for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
    const png = encodePNG(W, H, data, filters);
    for (const [r0, r1, c0, c1] of [[0, H, 0, W], [5, 9, 3, 30], [22, 23, 36, 37]]) {
      const got = await decodeWindow(png, { r0, r1, c0, c1 });
      let ok = got.length === (r1 - r0) * (c1 - c0);
      for (let r = r0; r < r1 && ok; r++) for (let c = c0; c < c1; c++) if (got[(r - r0) * (c1 - c0) + c - c0] !== data[r * W + c]) { ok = false; break; }
      check(`decode, filters ${filters.join('')}, rows ${r0}–${r1} cols ${c0}–${c1}`, ok);
    }
  }
  let threw = false; try { await decodeWindow(encodePNG(W, H, data), { r0: 0, r1: H + 1, c0: 0, c1: W }); } catch { threw = true; }
  check('decode refuses a window outside the image', threw);
  const d16 = new Uint16Array(W * H); for (let k = 0; k < d16.length; k++) { seed = (seed * 1103515245 + 12345) >>> 0; d16[k] = seed >>> 16; }
  for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
    const got = await decodeWindow(encodePNG(W, H, d16, filters, 16), { r0: 4, r1: 20, c0: 1, c1: 36 });
    let ok = got instanceof Uint16Array && got.length === 16 * 35;
    for (let r = 4; r < 20 && ok; r++) for (let c = 1; c < 36; c++) if (got[(r - 4) * 35 + c - 1] !== d16[r * W + c]) { ok = false; break; }
    check(`decode 16-bit grey, filters ${filters.join('')}`, ok);
  }
}

// ---- lookup tables (IEM rasters.php rid 5 and 3: lower bin edges)
{
  const half = (i) => (i < 100 ? 0.125 : i < 180 ? 0.625 : 2.5);
  const table = [[1, 0.25], [99, 24.75], [100, 25], [101, 26.25], [179, 123.75], [180, 125], [181, 130], [254, 495]];
  check('p1h: bin centres of the IEM table', table.every(([i, v]) => near(p1hMM(i) - half(i), v)), table.map(([i]) => p1hMM(i)).join(' '));
  check('p1h: 0 is dry, 255 no coverage, rising', p1hMM(0) === 0 && Number.isNaN(p1hMM(255)) && Array.from({ length: 254 }, (_, i) => p1hMM(i + 1) > p1hMM(i)).every(Boolean));
  check('a2m: 0.02 mm steps, 255 missing', a2mMM(0) === 0 && near(a2mMM(100), 2.01) && near(a2mMM(254), 5.09) && Number.isNaN(a2mMM(255)));
  check('file URL by UTC date', fileURL('p1h', Date.parse('2016-07-31T01:00Z')) === 'https://mesonet.agron.iastate.edu/archive/data/2016/07/31/GIS/mrms/p1h_201607310100.png');
  check('gauge-corrected URL: GaugeCorr from May 2015', gaugeURL(Date.parse('2016-07-30T23:00Z')) === 'https://mtarchive.geol.iastate.edu/2016/07/30/mrms/ncep/GaugeCorr_QPE_01H/GaugeCorr_QPE_01H_00.00_20160730-230000.grib2.gz');
  check('gauge-corrected URL: MultiSensor Pass 2 from 14 Oct 2020, in the file date\'s folder', gaugeURL(Date.parse('2021-09-02T01:00Z')) === 'https://mtarchive.geol.iastate.edu/2021/09/02/mrms/ncep/MultiSensor_QPE_01H_Pass2/MultiSensor_QPE_01H_Pass2_00.00_20210902-010000.grib2.gz' &&
    gaugeURL(Date.parse('2020-10-14T00:00Z')).includes('Pass2') && gaugeURL(Date.parse('2020-10-13T23:00Z')).includes('GaugeCorr'));
  check('gauge-corrected URL: none before May 2015', gaugeURL(Date.parse('2015-05-06T19:00Z')) === null && gaugeURL(Date.parse('2014-06-01T12:00Z')) === null);
}

// ---- gauge-corrected GRIB2 (template 5.41)
{
  const win = { r0: 0, r1: 3, c0: 2, c1: 5 }, H = 3, W = GRID.nx, X = new Uint16Array(W * H);
  [[0, 2, 0], [0, 3, 30], [0, 4, 130], [1, 2, 31], [2, 4, 65535]].forEach(([r, c, v]) => { X[r * W + c] = v; });
  const v = await decodeGribWindow(encodeGRIB(encodePNG(W, H, X, [0, 4], 16)), win);
  check('GRIB2: (R + X·2^E) / 10^D mm, below 0 = no coverage', Number.isNaN(v[0]) && v[1] === 0 && near(v[2], 10, 1e-6) && near(v[3], 0.1, 1e-6) && near(v[8], 6550.5, 1e-3), Array.from(v).join(' '));
  const raw = await decodeGribWindow(encodeGRIB(encodePNG(W, H, X, [0], 16), { gzip: false, R: 0, E: 1, D: 2 }), win);
  check('GRIB2: not gzipped, other scaling', near(raw[1], 0.6, 1e-6) && near(raw[2], 2.6, 1e-6), Array.from(raw.slice(0, 3)).join(' '));
  let threw = false; try { await decodeGribWindow(encodeGRIB(encodePNG(100, H, X.subarray(0, 300), [0], 16), { nx: 100 }), { r0: 0, r1: 1, c0: 0, c1: 2 }); } catch { threw = true; }
  check('GRIB2: another grid is refused', threw);
}

// ---- pixel window and interpolation
{
  const win = pixelWindow([-75.195, 39.905, -75.105, 39.995]); // pixels 5480–5489 × rows 1500–1509, plus one all round
  check('window: 1 px margin around the box', win.c0 === 5479 && win.c1 === 5491 && win.r0 === 1499 && win.r1 === 1511 && near(win.lon0, -75.21) && near(win.lat0, 40.01), JSON.stringify([win.c0, win.c1, win.r0, win.r1]));
  const centre = sampleWeights(win, win.lon0 + 3.5 * win.step, win.lat0 - 2.5 * win.step);
  check('interpolation: a pixel centre takes that pixel', centre.length === 1 && centre[0][0] === 2 * win.nx + 3 && near(centre[0][1], 1), JSON.stringify(centre));
  const mid = sampleWeights(win, win.lon0 + 4 * win.step, win.lat0 - 3 * win.step);
  check('interpolation: between four centres, ¼ each', mid.length === 4 && mid.every(([, w]) => near(w, 0.25)));
  const edge = sampleWeights(win, win.lon0 - 1, win.lat0 + 1);
  check('interpolation: clamped outside the window', edge.length === 1 && edge[0][0] === 0);
  const one = sampleWeights({ ...win, nx: 1, ny: 1 }, win.lon0, win.lat0);
  check('interpolation: a one-pixel window', one.length === 1 && one[0][0] === 0 && near(one[0][1], 1));
}

// ---- shaping an hour
{
  const P = Float32Array.from([10, 20, 0, NaN, 5]); // clean, overflowed frame, dry, no coverage, missing its frames
  const frames = Array.from({ length: 30 }, (_, k) => Float32Array.from([k < 15 ? 0.6 : 0.06, k === 3 ? NaN : 0.7, 0, 0, NaN]));
  const stats = { wetPixelHours: 0, areaShape: 0, uniform: 0, noCoverage: 0 };
  const out = shapeHour(P, frames, stats), tot = (p) => out.reduce((s, f) => s + f[p], 0);
  check('hour: each wet pixel keeps its hourly total', near(tot(0), 10, 1e-4) && near(tot(1), 20, 1e-4) && near(tot(4), 5, 1e-4), [0, 1, 4].map(tot).map(v => v.toFixed(4)).join(' '));
  check('hour: a clean pixel follows its frames', near(out[0][0] / out[29][0], 10, 1e-5));
  check('hour: an overflowed or missing pixel takes the area\'s shape', near(out[0][1] / 20, out[0][0] / 10, 1e-6) && near(out[0][4] / 5, out[0][0] / 10, 1e-6));
  check('hour: dry stays dry, no coverage stays dry and is counted', tot(2) === 0 && tot(3) === 0 && stats.noCoverage === 1);
  check('hour: counts (4 wet pixel-hours, 2 on the area shape)', stats.wetPixelHours === 3 && stats.areaShape === 2 && stats.uniform === 0, JSON.stringify(stats));
  const s2 = { wetPixelHours: 0, areaShape: 0, uniform: 0, noCoverage: 0 }, u = shapeHour(Float32Array.from([6]), null, s2);
  check('hour: no frames at all → uniform', u.every(f => near(f[0], 0.2, 1e-6)) && s2.uniform === 1);
  const s3 = { wetPixelHours: 0, areaShape: 0, uniform: 0, noCoverage: 0 }, wrap = shapeHour(Float32Array.from([30]), Array.from({ length: 30 }, () => Float32Array.from([0.02])), s3);
  check('hour: frames far under the total (overflow wrapped) are not trusted', s3.uniform === 1 && near(wrap[0][0], 1, 1e-6));
}

// ---- the whole build on synthetic archive files near the grid's top-left corner (so the images stay small)
{
  const bbox = [-129.985, 54.975, -129.955, 54.995], win = pixelWindow(bbox), H = win.r1, W = GRID.nx;
  const img = (fill) => { const d = new Uint8Array(W * H); for (let r = win.r0; r < win.r1; r++) for (let c = win.c0; c < win.c1; c++) d[r * W + c] = fill(r, c); return encodePNG(W, H, d, [0, 1, 2, 3, 4]); };
  const t0 = Date.parse('2021-09-01T22:10Z'), t1 = Date.parse('2021-09-01T23:30Z'), asked = [];
  const files = new Map();
  files.set(fileURL('p1h', Date.parse('2021-09-01T23:00Z')), img(() => 40)); // 10.125 mm everywhere
  files.set(fileURL('p1h', Date.parse('2021-09-02T00:00Z')), img(() => 0)); // dry hour: no 2-minute frames asked for
  for (let k = 1; k <= 30; k++) files.set(fileURL('a2m', Date.parse('2021-09-01T22:00Z') + k * 120e3), img((r, c) => (k <= 10 ? 25 : 5) + (c % 2)));
  const getBytes = async (u) => { asked.push(u); return files.get(u) ?? null; };
  const rr = await radarRain(t0, t1, bbox, getBytes); // no gauge-corrected files here: radar-only
  check('build: whole hours from 22:00 to 00:00 UTC, 2-minute frames', rr.t0 === Date.parse('2021-09-01T22:00Z') && rr.frames.length === 60 && rr.blockMin === 2, `${rr.frames.length} frames`);
  check('build: the dry hour fetched no 2-minute frames', asked.filter(u => u.includes('a2m_202109012')).length === 30 && rr.frames.slice(30).every(f => f === null));
  const mean = areaMean(rr.frames, [sampleWeights(rr.win, -129.97, 54.985)]);
  check('build: the hour total survives the shaping', near(mean.reduce((a, b) => a + b, 0), 10.125, 1e-4), mean.reduce((a, b) => a + b, 0).toFixed(4));
  check('build: the first 20 minutes carry the heavy frames', mean[0] > 3 * mean[20], `${mean[0].toFixed(3)} vs ${mean[20].toFixed(3)} mm`);
  check('build: counts', rr.stats.hours === 2 && rr.stats.wetHours === 1 && rr.stats.missingHours.length === 0 && rr.stats.areaShape === 0 && rr.stats.gaugeHours === 0 && rr.stats.radarOnlyHours.length === 2, JSON.stringify(rr.stats));
  // a gauge-corrected total for 23Z: 15 mm, except one pixel the file has no value for (radar-only there); the 2-minute
  // frames still shape it, judged against the radar's own total
  const gx = new Uint16Array(W * H); for (let r = win.r0; r < win.r1; r++) for (let c = win.c0; c < win.c1; c++) gx[r * W + c] = r === win.r0 + 1 && c === win.c0 + 1 ? 0 : 180;
  files.set(gaugeURL(Date.parse('2021-09-01T23:00Z')), encodeGRIB(encodePNG(W, H, gx, [0, 1, 2, 3, 4], 16)));
  const gg = await radarRain(t0, t1, bbox, getBytes), sum = (a) => a.reduce((x, y) => x + y, 0);
  const at = (dc, dr) => [sampleWeights(gg.win, gg.win.lon0 + (dc + 0.5) * gg.win.step, gg.win.lat0 - (dr + 0.5) * gg.win.step)];
  const g15 = areaMean(gg.frames, at(2, 2)), gro = areaMean(gg.frames, at(1, 1));
  check('build: gauge-corrected totals replace the radar\'s, radar-only where they have no value', near(sum(g15), 15, 1e-4) && near(sum(gro), 10.125, 1e-4), `${sum(g15).toFixed(4)} and ${sum(gro).toFixed(4)} mm`);
  check('build: gauge counts', gg.stats.gaugeHours === 1 && gg.stats.radarOnlyHours.join() === '2021-09-02T00:00Z' && gg.stats.gaugeGaps === 1 && gg.stats.products.join() === 'MultiSensor_QPE_01H_Pass2' && gg.stats.areaShape === 0, JSON.stringify(gg.stats));
  const off = await radarRain(t0, t1, bbox, getBytes, { gauge: false }), o15 = areaMean(off.frames, at(2, 2));
  check('build: gauge: false stays radar-only', off.stats.gaugeHours === 0 && near(sum(o15), 10.125, 1e-4));
  check('build: the gauge-corrected hour keeps the radar\'s 2-minute shape', g15.every((v, k) => near(v / 15, o15[k] / 10.125, 1e-6)));
  check('build: a missing hour is reported, not invented', (await radarRain(Date.parse('2021-09-02T01:10Z'), Date.parse('2021-09-02T01:50Z'), bbox, getBytes)).stats.missingHours[0] === '2021-09-02T02:00Z');
  check('hash tells frames apart', framesHash(rr.frames) !== framesHash(rr.frames.map(f => f && f.map(v => v * 1.01))) && framesHash(rr.frames) === framesHash(rr.frames.map(f => f && Float32Array.from(f))));
  let threw = false; try { await radarRain(Date.parse('2010-01-01'), Date.parse('2010-01-02'), bbox, getBytes); } catch { threw = true; }
  check('build: before September 2013 says so', threw);
}

if (process.argv.includes('--live')) {
  const get = async (u) => { const r = await fetch(u); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; };
  const bbox = [-75.25, 39.9, -75.1, 40.0]; // Philadelphia, Hurricane Ida
  const rr = await radarRain(Date.parse('2021-09-01T22:00Z'), Date.parse('2021-09-02T03:00Z'), bbox, get);
  const pts = [[-75.2, 39.95], [-75.15, 39.95], [-75.2, 39.98]].map(([lo, la]) => sampleWeights(rr.win, lo, la));
  const mean = areaMean(rr.frames, pts), total = mean.reduce((a, b) => a + b, 0), peak = Math.max(...mean) * 30;
  check('live: Ida over Philadelphia, 1 Sep 22Z – 2 Sep 03Z', total > 30 && total < 250 && peak > 20 && rr.stats.gaugeHours === rr.stats.hours, `${total.toFixed(0)} mm, peak ${peak.toFixed(0)} mm/hr over 2 min; ${JSON.stringify(rr.stats)}`);
  // one GaugeCorr hour at Ellicott City (16-bit PNG in GRIB2) against the same file read with PIL: 3 × 3 pixels round row 1573, column 5320
  const v = await decodeGribWindow(await get(gaugeURL(Date.parse('2016-07-30T23:00Z'))), { r0: 1572, r1: 1575, c0: 5319, c1: 5322 });
  const pil = [18.0, 21.7, 21.8, 17.8, 19.1, 18.8, 17.4, 13.9, 13.9];
  check('live: GaugeCorr 2016-07-30 23Z at Ellicott City matches PIL', pil.every((x, k) => near(v[k], x, 0.051)), Array.from(v, x => x.toFixed(1)).join(' '));
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
