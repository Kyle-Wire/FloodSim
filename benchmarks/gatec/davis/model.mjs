// Gate C, HEC-RAS "Davis" storm-sewer example → a FloodSim model (SI units), written to davis/model.json.
//
// From the HEC-RAS 7.0.2 example project (inputs only): the geometry HDF (2D areas, pipe network, top inlets, pump
// station), the terrain GeoTIFF (28.8 ft cells, NAD83(HARN) California zone 2, US survey feet) and the flow file
// (rain hyetograph). FloodSim runs on the terrain's own grid; HEC-RAS uses 150 ft cells with sub-grid tables on the
// same terrain.
// Usage: node benchmarks/gatec/davis/model.mjs
import h5wasm from 'h5wasm/node';
import { fromFile } from 'geotiff';
import { readFileSync, writeFileSync } from 'node:fs';
import { insideRing } from '../../../src/geo.js';

const DIR = new URL('./hecras/', import.meta.url), path = (f) => decodeURIComponent(new URL(f, DIR).pathname).replace(/^\/([A-Z]:)/, '$1');
const FT = 0.3048006096012192, CFS = FT ** 3; // US survey foot (the project's SRS unit); cfs → m³/s

await h5wasm.ready;
const f = new h5wasm.File(path('DavisStormSystem.g02.hdf'), 'r');
const rows = (p) => f.get(p).value, arr2 = (p) => { const d = f.get(p), v = Array.from(d.value), w = d.shape[1]; return Array.from({ length: d.shape[0] }, (_, i) => v.slice(i * w, (i + 1) * w)); };

// ---- 2D areas: polygons and Manning's n
const areas = rows('/Geometry/2D Flow Areas/Attributes').map(a => ({ name: a[0].trim(), n: a[2], dx: a[12], cells: a[16] }));
const pinfo = arr2('/Geometry/2D Flow Areas/Polygon Info'), ppts = arr2('/Geometry/2D Flow Areas/Polygon Points');
areas.forEach((a, i) => { const [s, c] = pinfo[i]; a.ring = ppts.slice(s, s + c); });
const area2 = areas.find(a => a.name === 'area2'), dsArea = areas.find(a => a.name === 'DS Channel');

// ---- terrain on its own grid (row 0 = north)
const tif = await (await fromFile(path('Terrain/Terrain (1).Davis_terrain2.tif'))).getImage();
const [W, H] = [tif.getWidth(), tif.getHeight()], [ox, oy] = tif.getOrigin(), res = tif.getResolution()[0];
const ras = (await tif.readRasters({ interleave: true }));
// crop to area2's box (plus one cell)
const xs = area2.ring.map(p => p[0]), ys = area2.ring.map(p => p[1]);
const c0 = Math.max(0, Math.floor((Math.min(...xs) - ox) / res) - 1), c1 = Math.min(W, Math.ceil((Math.max(...xs) - ox) / res) + 1);
const r0 = Math.max(0, Math.floor((oy - Math.max(...ys)) / res) - 1), r1 = Math.min(H, Math.ceil((oy - Math.min(...ys)) / res) + 1);
const nx = c1 - c0, ny = r1 - r0, N = nx * ny, z = new Array(N), mask = new Array(N);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const v = ras[(r0 + j) * W + (c0 + i)], k = j * nx + i, x = ox + (c0 + i + 0.5) * res, y = oy - (r0 + j + 0.5) * res;
  const ok = v > -9000 && insideRing(x, y, area2.ring);
  z[k] = v > -9000 ? +(v * FT).toFixed(4) : 0; mask[k] = ok ? 1 : 0;
}
const grid = { nx, ny, dx: res * FT, x0ft: ox + c0 * res, y1ft: oy - r0 * res, resFt: res, crs: 'NAD83(HARN) / California zone 2 (ftUS), EPSG:2871' };
const cellOf = ([x, y]) => { const i = Math.floor((x - grid.x0ft) / res), j = Math.floor((grid.y1ft - y) / res); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };

// downstream channel area: its lowest terrain is the pump outfall's invert
let dsMin = Infinity;
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const v = ras[r * W + c]; if (v > -9000 && insideRing(ox + (c + 0.5) * res, oy - (r + 0.5) * res, dsArea.ring)) dsMin = Math.min(dsMin, v); }

// ---- pipe network
const inletTypes = Object.fromEntries(rows('/Geometry/Pipe Nodes/Top Inlets/Attributes').map(t => [t[0].trim(), { area: t[1] * FT * FT, Co: t[2], weirLength: t[3] * FT, weirCoefUS: t[4], surchargeOnly: t[5] === 'True' }]));
const nodePts = arr2('/Geometry/Pipe Nodes/Points');
const nodes = rows('/Geometry/Pipe Nodes/Attributes').map((a, i) => {
  const xy = nodePts[i], cell = cellOf(xy);
  return { name: a[0].trim(), type: a[2].trim(), invert: a[5] * FT, baseArea: a[6] * FT * FT, ground: a[7] * FT, depth: a[9] * FT, inlet: a[10].trim() || null, xyFt: xy, cell, inMask: cell >= 0 && mask[cell] === 1 };
});
const conduits = rows('/Geometry/Pipe Conduits/Attributes').map(a => ({
  name: 'C' + a[0].trim(), from: a[2].trim(), to: a[3].trim(), approach: a[4].trim(), length: a[5] * FT, shape: a[7].trim(), rise: a[8] * FT, span: a[9] * FT,
  n: a[10], inOffset: a[11] * FT, outOffset: a[12] * FT, usElev: a[13] * FT, dsElev: a[14] * FT, kEntry: a[16], kExit: a[17],
}));

// ---- pump station: from a pipe node into the downstream channel area
const g = readFileSync(path('DavisStormSystem.g02'), 'utf8');
const ps = g.match(/Pump Station From=.*\[(.+?)\]/)?.[1].trim(), on = g.match(/Pump Station Group Pump=[^,]*,([\d.]+),([\d.]+)/);
const hq = arr2('/Geometry/Pump Stations/Pump Groups/Efficiency Curves Values').map(([head, q]) => [head * FT, q * CFS]);
const pump = { from: ps, onWSE: Number(on[1]) * FT, offWSE: Number(on[2]) * FT, headFlow: hq, toArea: 'DS Channel', outfallInvert: dsMin * FT };

// ---- rain: incremental inches per hour on area2 (flow file), plan start 10 Jan 2000 12:00, end 11 Jan 24:00 (36 h)
const u = readFileSync(path('DavisStormSystem.u01'), 'utf8');
const nRain = Number(u.match(/Precipitation Hydrograph=\s*(\d+)/)[1]);
const rainIn = u.split(/Precipitation Hydrograph=\s*\d+\s*\n/)[1].split('\n').join(' ').trim().split(/\s+/).slice(0, nRain).map(Number);
const model = {
  source: 'HEC-RAS 7.0.2 example project "Pipes/Davis" (DavisStormSystem, plan p02 "Full System ROM with Pump")',
  grid, z, mask, manning: area2.n, hecrasCellFt: area2.dx,
  // HEC-RAS reads each ordinate as the depth that fell in the interval ENDING at its time, so the first (at the plan
  // start) adds nothing: 0.1, 0.1, then 0.25 in for four hours = 1.2 in over 6 h (its own cumulative-precipitation output)
  rain: { blockMin: 60, mmhr: rainIn.slice(1).map(v => +(v * 25.4).toFixed(4)), totalMm: +(rainIn.slice(1).reduce((a, b) => a + b, 0) * 25.4).toFixed(2) },
  durationS: 36 * 3600, nodes, conduits, inletTypes, pump, areas: areas.map(({ ring, ...a }) => a),
};
writeFileSync(new URL('./model.json', import.meta.url), JSON.stringify(model));
// --coarsen F: the same model on cells F× larger (bed = mean of the open fine cells, kept if half are inside area2), to
// test how much of a difference comes from resolution (HEC-RAS uses 150 ft cells with one water level each)
const ci = process.argv.indexOf('--coarsen');
if (ci > 0) {
  const F = Number(process.argv[ci + 1]), cnx = Math.floor(nx / F), cny = Math.floor(ny / F), cz = [], cm = [];
  for (let J = 0; J < cny; J++) for (let I = 0; I < cnx; I++) {
    let s = 0, n = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) { const k = j * nx + i; if (mask[k]) { s += z[k]; n++; } }
    cz.push(n ? +(s / n).toFixed(4) : 0); cm.push(n * 2 >= F * F ? 1 : 0);
  }
  const cgrid = { ...grid, nx: cnx, ny: cny, dx: grid.dx * F, resFt: res * F };
  const ccell = ([x, y]) => { const i = Math.floor((x - grid.x0ft) / (res * F)), j = Math.floor((grid.y1ft - y) / (res * F)); return i < 0 || j < 0 || i >= cnx || j >= cny ? -1 : j * cnx + i; };
  const cmodel = { ...model, grid: cgrid, z: cz, mask: cm, nodes: nodes.map(n => { const cell = ccell(n.xyFt); return { ...n, cell, inMask: cell >= 0 && cm[cell] === 1 }; }), coarsened: F };
  writeFileSync(new URL(`./model-c${F}.json`, import.meta.url), JSON.stringify(cmodel));
  console.log(`coarse model: ${cnx}×${cny} @ ${cgrid.dx.toFixed(1)} m, ${cm.reduce((a, b) => a + b, 0)} cells`);
}
const wet = mask.reduce((a, b) => a + b, 0);
console.log(`grid ${nx}×${ny} @ ${grid.dx.toFixed(2)} m, ${wet} cells in area2 (${(wet * grid.dx ** 2 / 1e6).toFixed(2)} km²), n=${area2.n}`);
console.log(`rain ${model.rain.totalMm} mm over ${model.rain.mmhr.filter(v => v > 0).length} h; ${nodes.length} nodes (${nodes.filter(n => n.inlet).length} with inlets, ${nodes.filter(n => !n.inMask).length} outside area2), ${conduits.length} conduits`);
console.log(`pump ${pump.from}: on ${pump.onWSE.toFixed(2)} m, off ${pump.offWSE.toFixed(2)} m, curve ${hq.map(([h, q]) => `${h.toFixed(2)} m:${q.toFixed(2)}`).join(' ')}; DS channel invert ${pump.outfallInvert.toFixed(2)} m`);
f.close();
