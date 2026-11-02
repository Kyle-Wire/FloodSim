// EA 2D benchmark cases (Néelz & Pender 2013; test specifications May 2010) built from the GOV.UK "Benchmarking model
// data" archive (Open Government Licence v3) unpacked in benchmarks/ea/data. Each builder takes a loader
// { text(path), bin(path) } and returns a case for runCase().
import { parseASC, parseCSV, parseShp, resample, cellsInRings, cellsOnLine, series } from './lib.mjs';
import { case7 } from './case7.mjs';

const walls = { west: 'wall', east: 'wall', south: 'wall', north: 'wall' };
const scale = (rows, k) => series(rows.map(([t, v]) => [t * k, v]));
const probes = (rows) => rows.map(([id, x, y]) => ({ id: String(id), x, y }));
const edge = (g, side) => { const a = []; for (let j = 0; j < g.ny; j++) a.push(j * g.nx + (side === 'west' ? 0 : g.nx - 1)); return a; };

/** Test 6 geometry: channel walls, dam and building are 10 m cells in the DEM; they become masked (wall) cells. */
async function test6(L, b) {
  const dir = 'Test6_dataset_2010/Test6 dataset 2010/';
  const dem = parseASC(await L.text(dir + (b ? 'Test6BDEM.asc' : 'Test6ADEM.asc'))), s = b ? 20 : 1, dx = b ? 2 : 0.1;
  const g = { x0: dem.x0, y0: dem.y0, dx, nx: Math.floor(dem.nx * dem.dx / dx), ny: Math.floor(dem.ny * dem.dx / dx) };
  const { z, valid } = resample(dem, g, { wallAbove: 1 }); // walls are 10 m; floor and side slopes ≤ 0.16 m; edge ramps (e.g. 1.58 m at the gate) are wall
  const [up, down] = b ? [8, 0.4] : [0.4, 0.02];
  return {
    ...g, z, mask: valid, manning: b ? 0.05 : 0.01, bc: walls,
    h0: (x, y, zz) => Math.max(0, (x < 0 ? up : down) - zz), // levels; the bed is ~0 apart from the side slopes
    tEnd: b ? 1800 : 120, outDt: b ? 1 : 0.1, maps: (b ? [60, 120, 180, 240, 300, 600, 900, 1200] : [1, 2, 3, 4, 5, 10, 15, 20, 25, 30]),
    probes: probes(parseCSV(await L.text(dir + (b ? 'Test6Boutput.csv' : 'Test6Aoutput.csv')))), lengthScale: s, hfront: b ? 1e-3 : 1e-4,
  };
}

export const CASES = {
  // Test 1: 700 × 100 m strip; water level on the west edge rises 9.7 → 10.35 m and falls back
  '1': async (L) => {
    const dir = 'Test1_dataset_2010/Test1 dataset 2010/', dem = parseASC(await L.text(dir + 'test1DEM.asc'));
    const g = { x0: 0, y0: 0, dx: 10, nx: 70, ny: 10 }, { z } = resample(dem, g);
    return {
      ...g, z, manning: 0.03, bc: walls, stage: { cells: edge(g, 'west'), wl: scale(parseCSV(await L.text(dir + 'Test1BC.csv')), 60) },
      h0: (x, y, zz) => Math.max(0, 9.7 - zz), tEnd: 20 * 3600, outDt: 60, probes: probes(parseCSV(await L.text(dir + 'Test1output.csv'))),
    };
  },
  // Test 2: 2 × 2 km, 4 × 4 depressions; 20 m³/s for ~85 min along 100 m of the west edge at the NW corner
  '2': async (L) => {
    const dir = 'Test2_dataset_2010/Test2 dataset 2010/', dem = parseASC(await L.text(dir + 'test2DEM.asc'));
    const g = { x0: 0, y0: 0, dx: 20, nx: 100, ny: 100 }, { z } = resample(dem, g);
    const line = parseShp(await L.bin(dir + 'Test2BC_polyline.shp'))[0].map(([x, y]) => [Math.max(x, 0.01), y]);
    return {
      ...g, z, manning: 0.03, bc: walls, inflows: [{ cells: cellsOnLine(g, line), q: scale(parseCSV(await L.text(dir + 'Test2_BC.csv')), 60) }],
      tEnd: 48 * 3600, outDt: 300, probes: probes(parseCSV(await L.text(dir + 'Test2output.csv'))),
    };
  },
  // Test 3: 300 × 100 m, two depressions and a hump; 65.5 m³/s pulse along the whole west edge (times in seconds)
  '3': async (L) => {
    const dir = 'Test3_dataset_2010/Test3 dataset 2010/', dem = parseASC(await L.text(dir + 'test3DEM.asc'));
    const g = { x0: 0, y0: 0, dx: 5, nx: 60, ny: 20 }, { z } = resample(dem, g);
    return {
      ...g, z, manning: 0.01, bc: walls, inflows: [{ cells: edge(g, 'west'), q: scale(parseCSV(await L.text(dir + 'Test3BC.csv')), 1) }],
      tEnd: 900, outDt: 2, probes: [{ id: '1', x: 150, y: 50 }, { id: '2', x: 250, y: 50 }],
    };
  },
  // Test 4: flat 1 × 2 km plain, 20 m³/s through a 20 m breach in the middle of the west side
  '4': async (L) => {
    const dir = 'Test4_dataset_2010/Test4 dataset 2010/';
    const g = { x0: 0, y0: 0, dx: 5, nx: 200, ny: 400 }, z = new Float64Array(g.nx * g.ny);
    const cells = []; for (let j = 198; j < 202; j++) cells.push(j * g.nx); // y 990–1010 on x = 0
    return {
      ...g, z, manning: 0.05, bc: walls, inflows: [{ cells, q: scale(parseCSV(await L.text(dir + 'Test4BC.csv')), 60) }],
      tEnd: 5 * 3600, outDt: 20, maps: [1800, 3600, 7200, 10800, 14400], probes: probes(parseCSV(await L.text(dir + 'Test4output.csv'))),
    };
  },
  // Test 5: 17 km valley, dam-break hydrograph peaking at 3000 m³/s at the upstream end, 50 m grid
  '5': async (L) => {
    const dir = 'Test5_dataset_2010/Test5 dataset 2010/', dem = parseASC(await L.text(dir + 'Test5DEM.asc'));
    const ring = parseShp(await L.bin(dir + 'Test5ActiveArea_region.shp'));
    const g = { x0: 232300, y0: 829950, dx: 50, nx: 256, ny: 226 }, { z, valid } = resample(dem, g);
    const inside = cellsInRings(g, ring), mask = valid.map((v, k) => v & inside[k]);
    const line = parseShp(await L.bin(dir + 'Test5BC_polyline.shp'))[0];
    return {
      ...g, z, mask, manning: 0.04, bc: walls, inflows: [{ cells: cellsOnLine(g, line, mask), q: scale(parseCSV(await L.text(dir + 'Test5BC.csv')), 60) }],
      tEnd: 30 * 3600, outDt: 60, probes: probes(parseCSV(await L.text(dir + 'Test5output.csv'))),
    };
  },
  '6a': (L) => test6(L, false),
  '6b': (L) => test6(L, true),
  '7': case7,
};
