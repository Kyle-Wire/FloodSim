// Flood map scoring tests: polygons fill the cells whose centres they hold (holes cut out), small model patches drop out
// like the DEP maps' 0.25-acre floor, and the hit rate, false alarms, CSI, depth bands and depth error come out right
// for a reference square and a model square shifted against it.
// Usage: node tests/run-floodmap-tests.mjs
import { rasterize, dropSmall, scoreFloodMap, fromGeoJSONMap, DEP_CLASSES, FT } from '../src/floodmaps.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const nx = 100, ny = 100, id = (p) => p; // coordinates already in cell units
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const count = (a) => a.reduce((s, v) => s + (v ? 1 : 0), 0);
{
  const m = rasterize([[sq(10, 10, 50, 50)]], nx, ny, id, new Uint8Array(nx * ny));
  check('a 40 × 40 square fills 1,600 cells', count(m) === 1600, `${count(m)}`);
  const h = rasterize([[sq(10, 10, 50, 50), sq(20, 20, 30, 30)]], nx, ny, id, new Uint8Array(nx * ny));
  check('a hole is cut out', count(h) === 1500, `${count(h)}`);
  const c = rasterize([[sq(-20, -20, 5, 5)]], nx, ny, id, new Uint8Array(nx * ny));
  check('a polygon past the grid is clipped', count(c) === 25, `${count(c)}`);
}
{
  const w = new Uint8Array(nx * ny);
  rasterize([[sq(0, 0, 3, 3)], [[...sq(50, 50, 70, 70)]]], nx, ny, id, w);
  const dropped = dropSmall(w, nx, ny, 10);
  check('patches under the floor drop, larger ones stay', dropped === 9 && count(w) === 400, `${dropped} dropped, ${count(w)} kept`);
}
{
  // reference: 40 × 40 at 0.5 m; model: the same square 10 cells east at 0.4 m
  const ref = { kind: 'depth', name: 't', polys: [{ rings: [sq(10, 10, 50, 50)], depth: 0.5 }], mask: null };
  const depth = new Float32Array(nx * ny); rasterize([[sq(20, 10, 60, 50)]], nx, ny, id, depth, () => 0.4);
  const s = scoreFloodMap(ref, { nx, ny, dx: 1, toCell: id, depth });
  check('hits, misses and false alarms', s.hits === 1200 && s.misses === 400 && s.falseAlarms === 400, `${s.hits} / ${s.misses} / ${s.falseAlarms}`);
  check('hit rate 0.75, false-alarm ratio 0.25, CSI 0.6', Math.abs(s.hitRate - 0.75) < 1e-9 && Math.abs(s.falseAlarmRatio - 0.25) < 1e-9 && Math.abs(s.csi - 0.6) < 1e-9);
  check('depth error where both flood: −0.10 m', Math.abs(s.depth.bias + 0.1) < 1e-6 && Math.abs(s.depth.rmse - 0.1) < 1e-6 && s.depth.n === 1200);
  const b = s.bands.find(x => x.lo <= 0.5 && x.hi > 0.5);
  check('depth bands: the map\'s 0.5 m band, the model in it where wet', b.cells === 1600 && b.modelSame === 1200 && b.modelLower === 400, JSON.stringify(b));
  // a mask limits the comparison to where the map was made; buildings are left out
  const masked = scoreFloodMap({ ...ref, mask: [[sq(0, 0, 30, 100)]] }, { nx, ny, dx: 1, toCell: id, depth });
  check('the mask limits the cells scored', masked.cells === 3000 && masked.hits === 400 && masked.misses === 400 && masked.falseAlarms === 0, `${masked.cells} cells, ${masked.hits} / ${masked.misses} / ${masked.falseAlarms}`);
  const bld = new Uint8Array(nx * ny); rasterize([[sq(20, 10, 50, 50)]], nx, ny, id, bld);
  const nob = scoreFloodMap(ref, { nx, ny, dx: 1, toCell: id, depth, exclude: bld });
  check('buildings are left out of both', nob.hits === 0 && nob.misses === 400 && nob.falseAlarms === 400);
  const shallow = new Float32Array(nx * ny).fill(0.05);
  check('water under 4 in is not flooded', scoreFloodMap(ref, { nx, ny, dx: 1, toCell: id, depth: shallow }).modelWet === 0);
}
{
  // DEP classes: category 1 (4 in – 1 ft) and 2 (1 ft and over); 3 (future high tides) skipped
  const gj = { type: 'FeatureCollection', features: [
    { properties: { Flooding_Category: 1 }, geometry: { type: 'Polygon', coordinates: [sq(10, 10, 30, 30)] } },
    { properties: { Flooding_Category: 2 }, geometry: { type: 'MultiPolygon', coordinates: [[sq(60, 60, 80, 80)]] } },
    { properties: { Flooding_Category: 3 }, geometry: { type: 'Polygon', coordinates: [sq(0, 80, 20, 100)] } },
  ] };
  const ref = fromGeoJSONMap(gj, { field: 'Flooding_Category', classes: DEP_CLASSES, name: 'DEP' });
  check('class map: categories 1 and 2 kept, 3 skipped', ref.kind === 'classes' && ref.polys.length === 2);
  const depth = new Float32Array(nx * ny);
  rasterize([[sq(10, 10, 30, 30)]], nx, ny, id, depth, () => 0.2);   // right band
  rasterize([[sq(60, 60, 80, 80)]], nx, ny, id, depth, () => 0.2);   // one band low
  const s = scoreFloodMap(ref, { nx, ny, dx: 1, toCell: id, depth, }, { minArea: 0 });
  const [b1, b2] = s.bands;
  check('class map: both patches hit, bands compared', s.hits === 800 && s.misses === 0 && b1.modelSame === 400 && b2.modelLower === 400, `${s.hits}; ${JSON.stringify(s.bands)}`);
  check('class bands are the DEP edges', Math.abs(b1.lo - 0.1016) < 1e-9 && Math.abs(b1.hi - FT) < 1e-9 && b2.hi === Infinity);
}
{
  // a depth map with mask features (USGS: the 250 m buffers): only cells inside the mask are scored
  const gj = { type: 'FeatureCollection', features: [
    { properties: { depth_m: 0.5 }, geometry: { type: 'Polygon', coordinates: [sq(10, 10, 30, 30)] } },
    { properties: { mask: true }, geometry: { type: 'Polygon', coordinates: [sq(0, 0, 40, 40)] } },
  ] };
  const ref = fromGeoJSONMap(gj, { field: 'depth_m' });
  const depth = new Float32Array(nx * ny); rasterize([[sq(60, 60, 90, 90)]], nx, ny, id, depth, () => 1); // flooding outside the mask
  const s = scoreFloodMap(ref, { nx, ny, dx: 1, toCell: id, depth });
  check('mask features: kept apart from the depths, flooding outside them not counted', ref.polys.length === 1 && ref.mask.length === 1 && s.cells === 1600 && s.falseAlarms === 0 && s.misses === 400);
}
{
  // an empty polygon (one is in the DEP Extreme 2080 file) is skipped, not a crash
  const gj = { type: 'FeatureCollection', features: [
    { properties: { Flooding_Category: 1 }, geometry: { type: 'Polygon', coordinates: [] } },
    { properties: { Flooding_Category: 1 }, geometry: { type: 'MultiPolygon', coordinates: [[], [sq(10, 10, 30, 30)]] } },
  ] };
  const ref = fromGeoJSONMap(gj, { field: 'Flooding_Category', classes: DEP_CLASSES });
  let s = null; try { s = scoreFloodMap(ref, { nx, ny, dx: 1, toCell: id, depth: new Float32Array(nx * ny) }); } catch { /* checked below */ }
  check('empty polygons skipped', ref.polys.length === 1 && s?.mapped === 400, `${ref.polys.length} polys, ${s?.mapped}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
