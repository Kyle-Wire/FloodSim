// Channel bathymetry tests: the regional curves against Bieger et al. (2015), the flattened water surface found among
// noisy ground, D8 accumulation, and the carved section (centre depth = bankfull depth less the bank height, parabolic
// across the width, volume ≈ ⅔·depth·width·length); surveyed bathymetry: a tiled, deflated float GeoTIFF read across
// tile edges, sampled onto a model grid, and merged under the flattened water only.
// Usage: node tests/run-bathymetry-tests.mjs
import { deflateSync } from 'node:zlib';
import * as B from '../src/bathymetry.js';
import { parseTiff } from '../src/tiff.js';
import { blueTopoGrid, mergeSurvey } from '../src/topobathy.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{
  const u = B.bankfull(100), p = B.bankfull(756, B.CURVES.AHI);
  check('nationwide curve: W = 2.70·A^0.352, D = 0.30·A^0.213', Math.abs(u.W - 2.70 * 100 ** 0.352) < 1e-12 && Math.abs(u.D - 0.30 * 100 ** 0.213) < 1e-12, `A 100 km²: W ${u.W.toFixed(1)} m, D ${u.D.toFixed(2)} m`);
  check('Appalachian Highlands (Patapsco, 756 km²)', p.W > 30 && p.W < 50 && p.D > 1.5 && p.D < 3, `W ${p.W.toFixed(1)} m, D ${p.D.toFixed(2)} m`);
}

// a valley 200 × 120 cells (1 m) draining east: a flattened river 24 m wide (rows 48–71) stepping down 1 mm per column,
// banks rising 1 m over 4 m then a floodplain with ±1.5 cm lidar noise
const nx = 200, ny = 120, z = new Float64Array(nx * ny), water0 = new Uint8Array(nx * ny);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.03;
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i, off = j < 48 ? 48 - j : j > 71 ? j - 71 : 0, surf = 10 - 0.001 * i;
  if (!off) { z[k] = surf; water0[k] = 1; } else z[k] = surf + Math.min(1, off / 4) + (off > 4 ? 0.002 * (off - 4) + rnd() : rnd() * 0.3);
}
{
  const seeds = []; for (let i = 0; i < nx; i++) seeds.push(60 * nx + i); // the mapped centreline
  const m = B.flatWater(z, nx, ny, seeds);
  let hit = 0, extra = 0, miss = 0; for (let k = 0; k < m.length; k++) { if (m[k] && water0[k]) hit++; else if (m[k]) extra++; else if (water0[k]) miss++; }
  check('flattened surface found, noisy banks left out', miss < 0.002 * hit && extra < 0.01 * hit, `${hit} water cells, ${extra} extra, ${miss} missed`);
  const acc = B.accumulation(z, nx, ny); let mx = 0; for (const v of acc) mx = Math.max(mx, v);
  check('D8 accumulation gathers the valley', mx > 0.3 * nx * ny, `${mx} cells at the outlet of ${nx * ny}`);
  // 20 km² entering from upstream: W ≈ 7.7 m, D ≈ 0.57 m < the 1 m bank → the minimum depth; with 2000 km², D ≈ 1.5 m
  const big = B.carveChannels(z, nx, ny, 1, m, { areaAt: (k) => (k % nx === 0 ? 2000 : 0) }), c = big.comps[0];
  const centre = big.dz[60 * nx + 100], quarter = big.dz[54 * nx + 100], edge = big.dz[48 * nx + 100];
  check('centre depth = bankfull centre depth (1.5 × mean) − bank height', Math.abs(c.bank - 1) < 0.05 && Math.abs(c.dc - (1.5 * c.D - c.bank)) < 1e-9 && Math.abs(centre - c.dc) < 0.05 * c.dc, `A ${c.areaKm2.toFixed(0)} km², D ${c.D.toFixed(2)} m, bank ${c.bank.toFixed(2)} m, centre ${centre.toFixed(2)} m`);
  check('parabolic across the width, shallow at the edge', quarter > 0.6 * centre && quarter < 0.85 * centre && edge < 0.2 * centre, `quarter ${(quarter / centre).toFixed(2)}·centre, edge ${(edge / centre).toFixed(2)}·centre`);
  check('volume ≈ ⅔ · depth · width · length', Math.abs(big.volume / (2 / 3 * c.dc * 24 * nx) - 1) < 0.15, `${big.volume.toFixed(0)} m³`);
  const small = B.carveChannels(z, nx, ny, 1, m, { areaAt: (k) => (k % nx === 0 ? 20 : 0) }).comps[0];
  check('a small river well below its banks: the minimum depth', small.dc === 0.3 && 1.5 * small.D < small.bank, `centre depth ${(1.5 * small.D).toFixed(2)} m vs bank ${small.bank.toFixed(2)} m`);
  check('nothing carved outside the water', [...big.dz].every((v, k) => !v || m[k]));
}

// ---- surveyed bathymetry
/** A little-endian tiled GeoTIFF of float32 samples (deflate), north-up at (x0, y0) with pixel size d, NAD83 / UTM zone + a vertical datum. */
function geoTiff(w, h, tw, th, spp, val, { x0, y0, d, zone = 18, vertical = 'navd88', nodata = 'nan' }) {
  const across = Math.ceil(w / tw), down = Math.ceil(h / th), blocks = [];
  for (let tj = 0; tj < down; tj++) for (let ti = 0; ti < across; ti++) {
    const f = new Float32Array(tw * th * spp);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let s = 0; s < spp; s++) { const c = ti * tw + x, r = tj * th + y; f[(y * tw + x) * spp + s] = c < w && r < h ? val(c, r, s) : NaN; }
    blocks.push(deflateSync(Buffer.from(f.buffer)));
  }
  const cite = `NAD83 / UTM zone ${zone}N + ${vertical}|`, ascii = cite + vertical + '|\0';
  const keys = [1, 1, 0, 5, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 26900 + zone, 4096, 34737, vertical.length + 1, cite.length, 1026, 34737, cite.length, 0];
  const entries = [[256, 4, [w]], [257, 4, [h]], [258, 3, Array(spp).fill(32)], [259, 3, [8]], [277, 3, [spp]], [284, 3, [1]], [317, 3, [1]], [322, 3, [tw]], [323, 3, [th]],
    [324, 4, blocks.map(() => 0)], [325, 4, blocks.map(b => b.length)], [339, 3, Array(spp).fill(3)], [33550, 12, [d, d, 0]], [33922, 12, [0, 0, 0, x0, y0, 0]], [34735, 3, keys], [34737, 2, ascii], [42113, 2, nodata + '\0']];
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 }, ifd = 8;
  let at = ifd + 2 + 12 * entries.length + 4;
  for (const e of entries) { const n = e[2].length, len = n * size[e[1]]; e.push(n, len > 4 ? at : null); if (len > 4) at += len + (len & 1); }
  let off = at; const offs = blocks.map(b => { const o = off; off += b.length; return o; });
  entries.find(e => e[0] === 324)[2] = offs;
  const buf = Buffer.alloc(off), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.write('II', 0, 'latin1'); dv.setUint16(2, 42, true); dv.setUint32(4, ifd, true); dv.setUint16(ifd, entries.length, true);
  const put = (p, type, vals) => { if (type === 2) { buf.write(vals, p, 'latin1'); return; } vals.forEach((v, i) => { const q = p + i * size[type]; if (type === 3) dv.setUint16(q, v, true); else if (type === 4) dv.setUint32(q, v, true); else dv.setFloat64(q, v, true); }); };
  entries.forEach((e, m) => { const p = ifd + 2 + 12 * m; dv.setUint16(p, e[0], true); dv.setUint16(p + 2, e[1], true); dv.setUint32(p + 4, e[3], true); if (e[4] == null) put(p + 8, e[1], e[2]); else { dv.setUint32(p + 8, e[4], true); put(e[4], e[1], e[2]); } });
  blocks.forEach((b, i) => b.copy(buf, offs[i]));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
{
  // 70 × 50 pixels of 4 m in 32 × 32 tiles, 3 samples (elevation, uncertainty, contributor); no data in the north-west
  const bed = (c, r) => (c < 10 && r < 10 ? NaN : -2 - 0.05 * c - 0.01 * r);
  const tif = parseTiff(geoTiff(70, 50, 32, 32, 3, (c, r, s) => (s === 0 ? bed(c, r) : s === 1 ? 0.5 : 7), { x0: 480000, y0: 4425000, d: 4 }));
  check('GeoTIFF: size, georeferencing and vertical datum', tif.width === 70 && tif.height === 50 && tif.geo.x0 === 480000 && tif.geo.y0 === 4425000 && tif.geo.dx === 4 && tif.geo.epsg === 26918 && /navd88/.test(tif.geo.vertical), JSON.stringify(tif.geo));
  const v = await tif.read(25, 5, 20, 40, 0), u = await tif.read(25, 5, 20, 40, 1);
  let ok = true; for (let r = 0; r < 40; r++) for (let c = 0; c < 20; c++) if (Math.abs(v[r * 20 + c] - bed(25 + c, 5 + r)) > 1e-5) ok = false;
  check('GeoTIFF: a window across four tiles, the right sample', ok && u.every(x => x === 0.5));
  const nd = await tif.read(0, 0, 12, 12, 0);
  check('GeoTIFF: no data and outside the image read NaN', Number.isNaN(nd[0]) && !Number.isNaN(nd[11 * 12 + 11]) && (await tif.read(65, 45, 10, 10, 0)).filter(Number.isNaN).length === 75);

  // a model grid at 1 m inside the tile, same zone: bilinear between pixel centres
  const grid = { zone: 18, x0: 480100, y1: 4424900, dx: 1, nx: 60, ny: 40 }, buf = geoTiff(70, 50, 32, 32, 3, (c, r, s) => (s === 0 ? bed(c, r) : 0), { x0: 480000, y0: 4425000, d: 4 });
  const sv = await blueTopoGrid(grid, async () => ({ tiles: [{ tile: 'T1', url: 'u', resolution: '4m', utm: '18', delivered: '2026-09-03' }] }), async () => ({ ok: true, arrayBuffer: async () => buf }));
  // cell (i, j) centre: x = 480100.5 + i, y = 4424899.5 − j → pixel coordinates (x − 480000)/4 − 0.5, (4425000 − y)/4 − 0.5
  const want = (i, j) => -2 - 0.05 * ((100.5 + i) / 4 - 0.5) - 0.01 * ((100.5 + j) / 4 - 0.5);
  let err = 0; for (let j = 0; j < 40; j++) for (let i = 0; i < 60; i++) err = Math.max(err, Math.abs(sv.z[j * 60 + i] - want(i, j)));
  check('survey on the model grid: bilinear, every cell', sv.cells === 2400 && err < 1e-5 && sv.tiles[0].tile === 'T1', `max error ${err.toExponential(1)} m`);
  const mllw = geoTiff(70, 50, 32, 32, 1, () => -3, { x0: 480000, y0: 4425000, d: 4, vertical: 'MLLW' });
  const sk = await blueTopoGrid(grid, async () => ({ tiles: [{ tile: 'T2', url: 'u', utm: '18' }] }), async () => ({ ok: true, arrayBuffer: async () => mllw }));
  check('survey: a tile not on NAVD88 is left out, with the reason', sk.cells === 0 && /MLLW/.test(sk.skipped[0]?.why), sk.skipped[0]?.why);

  // merge: surveyed water takes the survey; a survey above the lidar (a bank in a coarse pixel) carves nothing; the rest keeps the estimate
  const zl = Float64Array.from([0.5, 0.5, 0.5, 3, 0.5]), wat = Uint8Array.from([1, 1, 1, 0, 1]), sur = Float32Array.from([-6, 1.2, NaN, -6, -2]), est = Float32Array.from([1, 1, 1, 0, 1.5]);
  const mg = mergeSurvey(zl, wat, sur, est, 1);
  check('merge: surveyed bed under the water, none above the lidar, the estimate where unsurveyed, land untouched', [...mg.dz].join(',') === '6.5,0,1,0,2.5' && mg.surveyed === 3 && mg.volume.surveyed === 9 && mg.volume.estimated === 1, [...mg.dz].join(','));
}

console.log(fails ? `\n${fails} FAILED` : '\nall bathymetry tests passed');
process.exit(fails ? 1 : 0);
