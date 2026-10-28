// Phase 1 unit tests: geodesy, terrain assembly, roof routing, downscaling, export encoders.
//   node tests/run-phase1-tests.mjs          (add --live to also hit the real 3DEP / OSM / SSURGO services)
import proj4 from 'proj4';
import { inflateSync } from 'node:zlib';
import { toUTM, fromUTM, GridRef, gridFromLonLatBox, insideRing, polygonCells } from '../src/geo.js';
import { fillRings, strokeLine, coarsen, roofRouting, buildFine } from '../src/terrain.js';
import { downscaleDepth } from '../src/downscale.js';
import { zip, crc32, png16, exr, buildingsGLB } from '../src/export.js';
import { parseWKTRings, fetchDEM, fetchOSM, fetchSoils, fillNoData } from '../src/ingest.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// ---- geodesy vs proj4
{
  let maxErr = 0, maxRt = 0;
  for (const [lon, lat] of [[-75.1635, 39.9526], [-122.42, 37.77], [-80.19, 25.76], [-71.1, 42.36], [-95.37, 29.76], [-77.9, 34.2]]) {
    const z = Math.floor((lon + 180) / 6) + 1;
    const [x, y] = toUTM(lon, lat, z), [px, py] = proj4('EPSG:4326', `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`, [lon, lat]);
    maxErr = Math.max(maxErr, Math.hypot(x - px, y - py));
    const [lo2, la2] = fromUTM(x, y, z); maxRt = Math.max(maxRt, Math.hypot((lo2 - lon) * 85000, (la2 - lat) * 111000));
  }
  check('UTM forward matches proj4', maxErr < 0.005, `max ${(maxErr * 1000).toFixed(2)} mm`);
  check('UTM round trip', maxRt < 0.005, `max ${(maxRt * 1000).toFixed(2)} mm`);
  const g = gridFromLonLatBox(-75.2475, 39.9055, -75.2355, 39.9145, 1);
  check('grid extent divisible by 8 m', g.nx % 8 === 0 && g.ny % 8 === 0, `${g.nx} × ${g.ny} m, zone ${g.zone}`);
}

// ---- rasterization
{
  const nx = 20, ny = 20, m = new Uint8Array(nx * ny);
  fillRings([[[2, 2], [12, 2], [12, 12], [2, 12]], [[5, 5], [9, 5], [9, 9], [5, 9]]], nx, ny, (k) => { m[k] = 1; });
  const n = m.reduce((a, b) => a + b, 0);
  check('even-odd fill with hole', n === 100 - 16, `${n} cells (expect 84)`);
  const r = new Uint8Array(nx * ny); strokeLine([[0, 10], [20, 10]], 4, nx, ny, (k) => { r[k] = 1; });
  check('road stroke width', r.reduce((a, b) => a + b, 0) === 20 * 4);
}

// ---- roof routing conserves rain
{
  const nx = 30, ny = 30, mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 10; j < 16; j++) for (let i = 8; i < 20; i++) mask[j * nx + i] = 0;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) mask[j * nx + i] = 0; // corner building
  const { rainField, roofLost } = roofRouting(mask, nx, ny, 1);
  let open = 0, total = 0; for (let k = 0; k < nx * ny; k++) if (mask[k]) { open++; total += rainField[k]; }
  check('roof routing conserves rainfall', Math.abs(total - nx * ny) < 1e-9 && roofLost === 0, `Σfactor ${total.toFixed(6)} vs ${nx * ny} cells`);
  const half = roofRouting(mask, nx, ny, 0.5).rainField.reduce((a, b, k) => a + (mask[k] ? b : 0), 0);
  check('connected fraction 0.5', Math.abs(half - (open + 0.5 * (nx * ny - open))) < 1e-9);
}

// ---- coarsen + downscale: still water must project exactly onto the fine DEM
{
  const fine = { nx: 64, ny: 64 }, N = 64 * 64, F = 4;
  const z = new Float32Array(N), bld = new Uint8Array(N), man = new Float32Array(N).fill(0.03), inf = new Float32Array(N);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) z[j * 64 + i] = 0.05 * Math.abs(i - 32) + 0.3 * Math.sin(i * 1.7) * Math.cos(j * 0.9);
  for (let j = 20; j < 28; j++) for (let i = 40; i < 50; i++) bld[j * 64 + i] = 1;
  const f = { ...fine, z, bld, manning: man, infil: inf };
  const c = coarsen(f, F, 1);
  const level = 0.6, h = new Float32Array(c.nx * c.ny);
  for (let k = 0; k < h.length; k++) h[k] = c.mask[k] ? Math.max(0, level - c.z[k]) : 0;
  const d = downscaleDepth(c, h, 1, f, F, 0.005);
  let err = 0;
  for (let k = 0; k < N; k++) {
    const J = ((k / 64 | 0) / F) | 0, I = ((k % 64) / F) | 0, nearWet = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, b]) => { const q = (J + b) * c.nx + I + a; return J + b >= 0 && J + b < c.ny && I + a >= 0 && I + a < c.nx && h[q] > 0.005; });
    if (!bld[k] && nearWet) err = Math.max(err, Math.abs(d[k] - Math.max(0, level - z[k])));
  }
  check('downscaling reproduces a still water surface', err < 1e-5, `max |Δd| ${err.toExponential(1)} m`);
  check('coarse walls where > half building', c.mask.reduce((a, b) => a + (b ? 0 : 1), 0) > 0);
}

// ---- encoders
{
  const files = [{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }];
  const z = new Uint8Array(await zip(files).arrayBuffer()), dv = new DataView(z.buffer);
  check('zip signature + entries', dv.getUint32(0, true) === 0x04034b50 && dv.getUint16(z.length - 22 + 10, true) === 2);
  check('crc32', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);

  const w = 7, h = 5, v = new Uint16Array(w * h).map((_, i) => i * 1000);
  const p = await png16(v, w, h);
  const idat = (() => { let o = 8; const parts = []; while (o < p.length) { const len = new DataView(p.buffer, p.byteOffset).getUint32(o), t = String.fromCharCode(...p.subarray(o + 4, o + 8)); if (t === 'IDAT') parts.push(p.subarray(o + 8, o + 8 + len)); o += 12 + len; } return Buffer.concat(parts); })();
  const raw = inflateSync(idat); let ok = raw.length === h * (1 + 2 * w);
  for (let j = 0; j < h && ok; j++) for (let i = 0; i < w; i++) if (raw.readUInt16BE(j * (1 + 2 * w) + 1 + 2 * i) !== v[j * w + i]) ok = false;
  check('16-bit PNG decodes to input', ok);

  const R = new Float32Array(w * h).map((_, i) => i * 0.25), G = R.map(x => -x);
  const e = exr({ R, G }, w, h), ev = new DataView(e.buffer);
  const tableOff = e.length - h * (8 + 8 * w) - 8 * h, first = Number(ev.getBigUint64(tableOff, true));
  const y0 = ev.getInt32(first, true), g00 = ev.getFloat32(first + 8, true), r01 = ev.getFloat32(first + 8 + 4 * w + 4, true);
  check('EXR magic, offsets and channel order (G before R)', ev.getUint32(0, true) === 20000630 && y0 === 0 && g00 === -0 && r01 === 0.25, `G[0]=${g00} R[1]=${r01}`);

  const sq = [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]];
  const earcut = (await import('https://cdn.jsdelivr.net/npm/earcut@3.0.1/+esm').catch(() => null))?.default
    ?? ((flat) => { const t = []; for (let i = 1; i + 1 < flat.length / 2; i++) t.push(0, i, i + 1); return t; });
  for (const ring of [sq, [...sq].reverse()]) {
    const glb = buildingsGLB([{ rings: [ring], height: 5 }], earcut, () => 1), gv = new DataView(glb.buffer);
    const jl = gv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl))), bin = glb.subarray(28 + jl);
    const P = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + json.bufferViews[0].byteLength));
    const Nn = new Float32Array(bin.buffer.slice(bin.byteOffset + json.bufferViews[1].byteOffset, bin.byteOffset + json.bufferViews[1].byteOffset + json.bufferViews[1].byteLength));
    const I = new Uint32Array(bin.buffer.slice(bin.byteOffset + json.bufferViews[2].byteOffset, bin.byteOffset + json.bufferViews[2].byteOffset + json.bufferViews[2].byteLength));
    let bad = 0;
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map(i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
      const u = b.map((x, k) => x - a[k]), v2 = c.map((x, k) => x - a[k]);
      const n = [u[1] * v2[2] - u[2] * v2[1], u[2] * v2[0] - u[0] * v2[2], u[0] * v2[1] - u[1] * v2[0]];
      const sn = [Nn[3 * I[t]], Nn[3 * I[t] + 1], Nn[3 * I[t] + 2]];
      if (n[0] * sn[0] + n[1] * sn[1] + n[2] * sn[2] <= 0) bad++;
    }
    check(`GLB faces wound outward (${ring === sq ? 'CCW' : 'CW'} footprint)`, bad === 0 && I.length === 2 * 3 + 4 * 6 && gv.getUint32(0, true) === 0x46546c67, `${I.length / 3} tris, ${bad} inverted`);
  }
}

// ---- outflow boundary: rain on a slope tilting into the domain must never draw water in
{
  const { CPUSolver } = await import('../src/solver-cpu.js');
  const nx = 40, ny = 20, dx = 2, z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 2 - 0.02 * i * dx + 0.3 * Math.sin(j / 3); // falls east, west edge is the high side
  const run = (type) => {
    const s = new CPUSolver({ nx, ny, dx, z, manning: 0.03, bc: { west: type, east: type, south: type, north: type } });
    s.setDepth(() => 0); s.rainRate = 100 / 1000 / 3600;
    let minOut = 0; for (let t = 60; t <= 1200; t += 60) { s.run(t); minOut = Math.min(minOut, s.vol.outflow); }
    return { minOut, out: s.vol.outflow, mass: s.massBalance().rel };
  };
  const open = run('open'), outflow = run('outflow');
  check('outflow BC never imports water', outflow.minOut >= -1e-9 && outflow.out > 0 && Math.abs(outflow.mass) < 1e-10,
    `cum. outflow ${outflow.out.toFixed(2)} m³ (transmissive "open" gives ${open.out.toFixed(2)} m³, min ${open.minOut.toFixed(2)})`);
}

// ---- Atlas 14 design storms (fixture: real PFDS response for Eastwick, Philadelphia)
{
  const { readFileSync } = await import('node:fs');
  const { parsePFDS, ddf, hyetograph, constantStorm, rainAt, A14_DURATIONS } = await import('../src/storm.js');
  const pf = parsePFDS(readFileSync(new URL('./fixtures/atlas14-eastwick-pds-metric.txt', import.meta.url), 'utf8'));
  check('PFDS parse', pf.median.length === 19 && pf.median[4][6] === 73 && pf.upper && pf.lower && pf.volume === '2', `100-yr 1-hr = ${pf.median[4][6]} mm, ${pf.region} vol ${pf.volume} v${pf.version}`);
  check('DDF hits table values', A14_DURATIONS.every((d, i) => Math.abs(ddf(pf, 100, d) - pf.median[i][6]) < 1e-9));
  const d90 = ddf(pf, 100, 90);
  check('DDF log-log between rows', d90 > 73 && d90 < 91, `100-yr 90-min = ${d90.toFixed(1)} mm`);
  let worst = 0;
  for (const [ari, T] of [[100, 60], [10, 180], [500, 1440], [2, 30]]) {
    const h = hyetograph(pf, { ari, durationMin: T });
    const n = h.depth.length;
    worst = Math.max(worst, Math.abs(h.depth.reduce((a, b) => a + b, 0) - ddf(pf, ari, T)));
    for (let k = 1; k <= n; k++) { // the k blocks around the peak are contiguous and hold the Atlas 14 depth for k·Δt
      const idx = h.order.slice(0, k), contiguous = Math.max(...idx) - Math.min(...idx) === k - 1;
      const w = idx.reduce((a, q) => a + h.depth[q], 0);
      worst = Math.max(worst, contiguous ? Math.abs(w - ddf(pf, ari, k * 5)) : Infinity);
    }
  }
  check('alternating block matches the site DDF at every sub-duration', worst < 1e-9, `max error ${worst.toExponential(1)} mm`);
  const c = hyetograph(pf, { ari: 100, durationMin: 120 }), early = hyetograph(pf, { ari: 100, durationMin: 120, peak: 0.25 });
  const argmax = (a) => a.indexOf(Math.max(...a));
  check('peak position', argmax(c.intensity) === 12 && argmax(early.intensity) === 6, `centred block ${argmax(c.intensity)}, early block ${argmax(early.intensity)} of 24`);
  check('5-min peak intensity = Atlas 14 5-min depth ×12', Math.abs(c.peakIntensity - pf.median[0][6] * 12) < 1e-9, `${c.peakIntensity} mm/hr`);
  const up = hyetograph(pf, { ari: 100, durationMin: 60, which: 'upper', factor: 1.2 });
  check('upper bound and climate factor', Math.abs(up.total - pf.upper[4][6] * 1.2) < 1e-9);
  const u = hyetograph(pf, { ari: 25, durationMin: 60, pattern: 'uniform' });
  check('uniform pattern', u.intensity.every(v => Math.abs(v - pf.median[4][4]) < 1e-9));
  const k = constantStorm(75, 60);
  check('rain schedule blocks', rainAt(k, 0).mmhr === 75 && rainAt(k, 299.9).until === 300 && rainAt(k, 3600).mmhr === 0 && Math.abs(k.total - 75) < 1e-12);
}

// ---- historic storms (synthetic inputs; live services are exercised in --live)
{
  const H = await import('../src/history.js');
  const { readFileSync } = await import('node:fs');
  const { parsePFDS } = await import('../src/storm.js');
  const pf = parsePFDS(readFileSync(new URL('./fixtures/atlas14-eastwick-pds-metric.txt', import.meta.url), 'utf8'));
  const hd = `AL182012,              SANDY,     3,\n20121029, 1800,  , EX, 39.5N,  74.5W,  70,  945,\n20121030, 0000,  , EX, 39.8N,  75.4W,  65,  948,\n20121030, 0600,  , EX, 40.1N,  76.9W,  50,  960,\nAL092020,             ISAIAS,     2,\n20200804, 1200,  , TS, 38.0N,  76.5W,  60,  995,\n20200804, 1800,  , TS, 40.2N,  75.3W,  55,  996,\n`;
  const storms = H.parseHurdat(hd), near = H.cyclonesNear(storms, -75.2415, 39.91, 250);
  check('HURDAT2 parse + proximity', storms.length === 2 && near.length === 2 && near.find(c => c.name === 'Sandy').minKm < 20, near.map(c => `${c.name} ${c.minKm.toFixed(0)} km`).join(', '));
  const daily = [['2020-08-03', 3], ['2020-08-04', 147], ['2020-08-05', 0], ['2020-08-06', 12], ['2020-08-07', 0]].map(([date, mm]) => ({ date, mm }));
  const ev = H.rainEvents(daily, 5), cat = H.catalog(ev, near);
  check('rain events + cyclone naming', ev[0].maxDay === 147 && cat[0].name === 'Isaias (2020)' && cat.some(c => c.kind === 'cyclone' && c.name === 'Sandy (2012)'));
  const hourly = { t0: Date.UTC(2020, 7, 4, 0), stepMin: 60, mm: [0, 10, 30, 0, 0], source: 'site' };
  const gauge = { t0: Date.UTC(2020, 7, 4, 0), stepMin: 1, mm: new Array(300).fill(0).map((_, i) => (i >= 70 && i < 75 ? 2 : i >= 120 && i < 180 ? 0.5 : 0)), source: 'gauge' };
  const b = H.blendSeries(hourly, gauge), hrSum = (h) => b.mm.slice(h * 60, h * 60 + 60).reduce((x, y) => x + y, 0);
  check('blend keeps site hourly totals, takes gauge timing', Math.abs(hrSum(1) - 10) < 1e-12 && Math.abs(hrSum(2) - 30) < 1e-12 && b.mm[72] === 2 && b.mm[60] === 0);
  const st = H.seriesStorm(b, { blockMin: 5 });
  check('series storm trims to the wet stretch', st.depth.length > 0 && Math.abs(st.total - 40) < 1e-9 && st.t0 === Date.UTC(2020, 7, 4, 1, 10) && H.maxWindow(st, 1) === null);
  check('return period inverts Atlas 14', Math.abs(H.returnPeriod(pf, 60, 73).ari - 100) < 1e-9 && H.returnPeriod(pf, 60, 5).label === '< 1-yr');
  const wl = { t: [0, 3600e3, 7200e3], v: [1, 2, 0] };
  check('water level interpolation', H.levelAt(wl, 1800e3) === 1.5 && H.levelAt(wl, -5) === 1 && H.levelAt(wl, 1e9) === 0);
  const ewkb = '0103000020E61000000100000005000000DD4BD015DB2054C08D976E1283D04340DD4BD015DB2054C0D7A3703D0A1745404EF38E5374BA52C0D7A3703D0A1745404EF38E5374BA52C08D976E1283D04340DD4BD015DB2054C08D976E1283D04340';
  const bb = H.ewkbBounds(ewkb);
  check('EWKB extent (IEM PA_ASOS)', Math.abs(bb[0] + 80.51) < 0.01 && Math.abs(bb[3] - 42.18) < 0.01, bb.map(v => v.toFixed(2)).join(', '));
}

// ---- real utility inlets snapped into the synthetic network
{
  const { synthNetwork } = await import('../src/drainage.js');
  const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
  const ll = (x, y) => fromUTM(486000 + x, 4422000 + y, 18);
  const z = new Float32Array(N), bld = new Uint8Array(N), road = new Uint8Array(N);
  for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = 10 + 0.01 * i + 0.005 * (199 - j);
  const roads = [{ line: [ll(-5, 100), ll(205, 100)], kind: 'residential', width: 8 }, { line: [ll(100, -5), ll(100, 205)], kind: 'residential', width: 8 }];
  const real = [ll(50, 104), ll(51, 96), ll(150, 104), ll(100, 50.5), ll(140, 140), ll(20, 180)]; // two facing grates, one, one, one 40 m off, one 85 m off
  const sim = { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) };
  const net = synthNetwork(g, { z, bld, road, cls: null }, { roads, waterways: [] }, null, sim, { realInlets: real.map(([lon, lat]) => ({ lon, lat })) });
  const s = net.stats, facing = net.inlets.filter(i => i.grates > 0 && net.nodes[i.node] === net.nodes[net.inlets.find(q => Math.abs((q.fineCell % 200) - 50) < 2)?.node]);
  const outfallLinks = new Map(); net.pipes.forEach(p => { if (net.nodes[p.to].outfall) outfallLinks.set(p.to, (outfallLinks.get(p.to) || 0) + 1); });
  check('real grates snap to streets, facing grates share a manhole', s.realInlets && s.grates === 5 && s.unconnectedGrates === 1 && facing.length === 2,
    `${s.grates} grates on ${net.inlets.filter(i => i.grates).length} exchange cells, ${s.unconnectedGrates} unconnected, ${s.lids} lid points`);
  check('every exchange cell is unique and every outfall has one link', new Set(net.inlets.map(i => i.cell)).size === net.inlets.length && [...outfallLinks.values()].every(n => n === 1));
}

// ---- roofs to sewer, linked pipe layers, tier-1 builder, continuation outlets
{
  const { roofConnections } = await import('../src/terrain.js');
  const { detectPipeFields, pipeRecords } = await import('../src/linked.js');
  const { realNetwork } = await import('../src/network-real.js');
  const { toINP } = await import('../src/drainage.js');
  // roof conservation: ground share + piped share = every roof cell, for any connected fraction
  const nx = 40, ny = 30, mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 5; j < 12; j++) for (let i = 5; i < 15; i++) mask[j * nx + i] = 0;
  for (let j = 18; j < 25; j++) for (let i = 25; i < 35; i++) mask[j * nx + i] = 0;
  const net0 = { nodes: [{ p: [10, 14], outfall: false }, { p: [30, 15], outfall: false }, { p: [0, 0], outfall: true }] };
  let ok = true;
  for (const [s, g] of [[1, 1], [0.6, 1], [0.6, 0.5], [0, 1]]) {
    const rc = roofConnections({ F: 1, nx, ny, mask }, net0, s, g);
    let rf = 0, open = 0; for (let k = 0; k < nx * ny; k++) if (mask[k]) { rf += rc.rainField[k]; open++; }
    const roofs = 140, piped = rc.roofArea.reduce((a, b) => a + b, 0);
    if (Math.abs((rf - open) + piped - roofs * (s * 1 + (1 - s) * g)) > 1e-9) ok = false;
  }
  check('roof downspouts: ground + piped shares conserve roof rain', ok);
  const fields = ['OBJECTID', 'DIA_HGT', 'WIDTH', 'X_SEC_SHP', 'ABAND', 'US_INV', 'DS_INV'];
  const sample = [{ DIA_HGT: 24 }, { DIA_HGT: 36 }, { DIA_HGT: 48 }];
  const mp = detectPipeFields(fields, sample);
  check('pipe field detection', mp.size === 'DIA_HGT' && mp.width === 'WIDTH' && mp.shape === 'X_SEC_SHP' && mp.status === 'ABAND' && mp.upInvert === 'US_INV' && mp.dnInvert === 'DS_INV' && mp.sizeUnits === 'in', JSON.stringify(mp));
  const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
  const ll = (x, y) => fromUTM(486000 + x, 4422000 + y, 18);
  const z = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = 10 + 0.02 * i; // falls west
  const feats = [
    { kind: 'line', coords: [ll(190, 100), ll(100, 100)], props: { DIA_HGT: 24, X_SEC_SHP: 'Round', ABAND: 'No' } },          // main, east half
    { kind: 'line', coords: [ll(100, 100), ll(-20, 100)], props: { DIA_HGT: 9999, X_SEC_SHP: 'Round', ABAND: 'No' } },        // main leaving west (placeholder size; the box tee splits it, so 2 segments get filled)
    { kind: 'line', coords: [ll(140, 160), ll(140, 100.5)], props: { DIA_HGT: 12, X_SEC_SHP: 'Round', ABAND: 'No' } },        // lateral teeing into the main
    { kind: 'line', coords: [ll(60, 40), ll(60, 99.5)], props: { DIA_HGT: 48, WIDTH: 60, X_SEC_SHP: 'Box', ABAND: 'No' } },   // box culvert teeing in
    { kind: 'line', coords: [ll(20, 20), ll(30, 30)], props: { DIA_HGT: 18, X_SEC_SHP: 'Round', ABAND: 'Yes' } },             // abandoned: dropped
  ];
  const recs = pipeRecords(feats, detectPipeFields(fields.slice(0, 5), feats.map(f => f.props)));
  check('placeholder sizes and abandoned pipes', recs.length === 4 && recs[1].h === null && recs[3].shape === 'RECT_CLOSED' && Math.abs(recs[3].w - 1.524) < 1e-9);
  const net = realNetwork(g, { z, bld: new Uint8Array(N), road: new Uint8Array(N) }, recs, { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) },
    { realInlets: [{ lon: ll(170, 103)[0], lat: ll(170, 103)[1] }] });
  const s = net.stats, links = new Map(); net.pipes.forEach(p => { if (net.nodes[p.to].outfall) links.set(p.to, (links.get(p.to) || 0) + 1); });
  const inp = toINP(net, g, { durationS: 600 });
  check('tier-1 builder: tees, mid-pipe inlet, filled size, boundary continuation', s.tees === 2 && s.filledSizes === 2 && s.grates === 1 && s.offsiteOutlets === 1 && s.interiorEnds === 0 &&
    [...links.values()].every(n => n === 1) && /RECT_CLOSED/.test(inp) && /NORMAL/.test(inp), JSON.stringify({ tees: s.tees, filled: s.filledSizes, grates: s.grates, offsite: s.offsiteOutlets, ends: s.interiorEnds }));
}

// ---- site-record design storms (where Atlas 14 has none)
{
  const { fitGEV, gevQuantile, pdsToAms, wettest24, recordStorm, annualMaxima24h } = await import('../src/storm.js');
  const truth = { xi: 50, alpha: 15, k: -0.1 }; let seed = 7; const u = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const sample = Array.from({ length: 4000 }, () => gevQuantile(truth, 1 / (1 - Math.max(1e-9, u()))));
  const fit = fitGEV(sample), q100 = gevQuantile(fit, 100), t100 = gevQuantile(truth, 100);
  check('GEV L-moment fit recovers a known 100-yr value', Math.abs(q100 / t100 - 1) < 0.05, `fit ${q100.toFixed(1)} vs true ${t100.toFixed(1)} mm (k ${fit.k.toFixed(3)})`);
  check('PDS ARI → annual-maximum return period', Math.abs(pdsToAms(100) - 100.5) < 0.01 && Math.abs(pdsToAms(2) - 2.541) < 0.01);
  const pat = wettest24({ stepMin: 60, mm: [0, 0, 1, 2, 10, 30, 5, 0, ...new Array(30).fill(0)] });
  check('storm pattern from the wettest 24 h sums to 1', Math.abs(pat.reduce((a, b) => a + b, 0) - 1) < 1e-12 && pat.length === 24);
  const st = recordStorm(fit, pat, { ari: 100 });
  check('record storm total = GEV depth', Math.abs(st.depth.reduce((a, b) => a + b, 0) - gevQuantile(fit, pdsToAms(100))) < 1e-9 && st.durationMin === 1440);
  const daily = []; for (let y = 2000; y < 2003; y++) for (let d = 0; d < 365; d++) daily.push({ date: `${y}-01-01`, mm: d === 100 ? 40 + y - 2000 : 1 });
  const am = annualMaxima24h(daily);
  check('annual maxima × 1.13', am.length === 3 && Math.abs(am[2].mm - 42 * 1.13) < 1e-9);
}

// ---- WKT, nodata fill
{
  const r = parseWKTRings('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((2 2, 3 2, 3 3, 2 2), (2.2 2.1, 2.5 2.1, 2.5 2.4, 2.2 2.1)))');
  check('WKT multipolygon rings', r.length === 3 && r[1][2][1] === 3);
  const z = new Float32Array([1, -9999, 3, -9999, -9999, -9999, 7, -9999, 9]);
  fillNoData(z, 3, 3, -1000);
  check('DEM void fill', z.every(v => v > 0 && v < 10));
}

// ---- live services (opt-in)
// polygon areas: cells inside a drawn ring (centre test), any UTM zone
{
  check('point in ring (concave)', insideRing(1, 1, [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4]]) && !insideRing(2, 3, [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4]]), 'notch excluded');
  const g = gridFromLonLatBox(-122.36, 47.60, -122.35, 47.607, 1); // Seattle, UTM 10
  const [w, s, e, n] = [-122.36, 47.60, -122.35, 47.607], tri = [[w, s], [e, s], [(w + e) / 2, n]];
  const m = polygonCells(g, tri, 4), frac = m.reduce((a, b) => a + b, 0) / m.length;
  const m1 = polygonCells(g, tri, 1), f1 = m1.reduce((a, b) => a + b, 0) / m1.length;
  check('triangle covers ~half its box', Math.abs(frac - 0.5) < 0.06 && Math.abs(f1 - frac) < 0.01 && m.length === (g.nx / 4) * (g.ny / 4), `${(100 * frac).toFixed(1)}% at 4 m, ${(100 * f1).toFixed(1)}% at 1 m`);
}

if (process.argv.includes('--live')) {
  const fetcher = (url, o = {}) => fetch(url, { method: o.method, body: o.body, headers: { 'user-agent': 'FloodSim/0.1 test', ...(o.contentType ? { 'content-type': o.contentType } : {}) } });
  const g = gridFromLonLatBox(-75.2440, 39.9085, -75.2400, 39.9115, 1);
  const t0 = Date.now();
  const [dem, osm, soils] = await Promise.all([fetchDEM(g, fetcher), fetchOSM(g.lonlatBounds(0.0003), fetcher), fetchSoils(g.lonlatBounds(0.0003), fetcher)]);
  let zmin = Infinity, zmax = -Infinity; for (const v of dem.z) { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); }
  check('live 3DEP DEM', dem.z.length === g.nx * g.ny && zmin > -10 && zmax < 100, `${g.nx}×${g.ny}, z ${zmin.toFixed(2)}…${zmax.toFixed(2)} m, native ${dem.sourceRes} m, ${dem.filled} voids filled`);
  check('live OSM', osm.buildings.length > 10 && osm.roads.length > 3, `${osm.buildings.length} buildings, ${osm.roads.length} roads`);
  check('live SSURGO', soils.length > 0, soils.map(s => `${s.name} (${s.hsg ?? '–'})`).join('; '));
  const f = buildFine(g, dem, osm, null, soils, { curb: 0 });
  check('assembled fine model', f.stats.buildingArea > 0 && f.infil.some(v => v > 0), `${f.stats.buildingArea} m² buildings, ${f.stats.roadArea} m² streets, ${(Date.now() - t0) / 1000}s`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
