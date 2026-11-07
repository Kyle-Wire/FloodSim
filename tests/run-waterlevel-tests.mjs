// Starting water-level tests: a gauged river rises parallel to its lidar surface, a lake fills flat and spills onto
// connected low ground only, each water body takes the nearest gauge, gauge datums need to be surveyed, and NGVD29
// readings shift to NAVD88.
// Usage: node tests/run-waterlevel-tests.mjs  (--live: reads the Patapsco at Hollofield gauge and the lidar at it through the local server)
import { startDepths, components, gaugeSurface, waterNear, nearestCells, surfaceAtGauge, gaugeWater, waterBase, tidalEdgeCells } from '../src/waterlevels.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{ // a river running east down a 1 % slope in a 2 m deep valley, 40 × 20 cells; the river is rows 9–10
  const nx = 40, ny = 20, z = new Float64Array(nx * ny), water = new Uint8Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i, bed = 10 - 0.01 * i; z[k] = bed + (j === 9 || j === 10 ? 0 : Math.min(2, 0.25 * (Math.abs(j - 9.5) - 0.5))); if (j === 9 || j === 10) water[k] = 1; }
  const c = { nx, ny, z, mask };
  const s = startDepths(c, water, [{ cells: [9 * nx + 1], rise: 0.4 }]);
  const river = [9 * nx + 0, 9 * nx + 20, 10 * nx + 39].map(k => s.depth[k]);
  check('a river rises parallel to its lidar surface', river.every(d => Math.abs(d - 0.4) < 1e-6), river.map(d => d.toFixed(3)).join(', '));
  // banks 0.25 m up (rows 8, 11) are below the risen level; 0.5 m (rows 7, 12) are not
  check('water spreads onto banks below its level only', Math.abs(s.depth[8 * nx + 20] - 0.15) < 0.011 && s.depth[7 * nx + 20] === 0 && s.depth[12 * nx + 20] === 0);
  const none = startDepths(c, water, []);
  check('no gauge: no water', none.depth.every(d => d === 0));
  const neg = startDepths(c, water, [{ cells: [9 * nx + 1], rise: -0.3 }]);
  check('a gauge below the lidar surface adds nothing', neg.depth.every(d => d === 0));
  // a mapped line that climbs the north bank at column 20 (rows 11-13, up to 0.75 m): its level must not flood the
  // banks along the valley that sit above the river beside them (Edwards Branch below the Charlotte gauge, Nov 2026)
  const w2 = water.slice(); for (const j of [11, 12, 13]) w2[j * nx + 20] = 1;
  const s2 = startDepths(c, w2, [{ cells: [9 * nx + 1], rise: 0 }], { surfR: 0 });
  let far = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (Math.abs(i - 20) > 3) far += s2.depth[j * nx + i];
  check('a bank cell flagged as water does not flood the valley to its height', far === 0, `${far.toFixed(2)} m of depth summed away from it`);
}
{ // two lakes (west, east) separated by a ridge, a low hollow beyond a ridge, and a gauge in each lake
  const nx = 30, ny = 10, z = new Float64Array(nx * ny).fill(5), water = new Uint8Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 2; j < 8; j++) for (let i = 2; i < 8; i++) { z[j * nx + i] = 1; water[j * nx + i] = 1; }
  for (let j = 2; j < 8; j++) for (let i = 18; i < 24; i++) { z[j * nx + i] = 2; water[j * nx + i] = 1; }
  for (let j = 0; j < ny; j++) z[j * nx + 8] = 1.5; // a shelf east of the west lake, below its level
  z[5 * nx + 12] = 0; // a hollow cut off by the 5 m ground
  const c = { nx, ny, z, mask };
  check('two lakes are two water bodies', components(water, nx, ny).count === 2);
  const s = startDepths(c, water, [{ cells: [4 * nx + 4], level: 2.5 }, { cells: [4 * nx + 20], level: 3 }]);
  check('a lake fills flat to its gauge', Math.abs(s.depth[2 * nx + 2] - 1.5) < 1e-6 && Math.abs(s.depth[7 * nx + 7] - 1.5) < 1e-6);
  check('each lake takes its own gauge', Math.abs(s.depth[4 * nx + 21] - 1) < 1e-6);
  check('connected low ground floods, cut-off hollows do not', Math.abs(s.depth[0 * nx + 8] - 1) < 1e-6 && s.depth[5 * nx + 12] === 0);
  check('water cells near a point', waterNear(c, water, 4 * nx + 10, 3).length > 0 && waterNear(c, water, 4 * nx + 14, 3).length === 0);
}
{ // a gauge 3 cells above a 2 m weir: its lidar surface is the pool's, not the tailwater's within reach
  const nx = 30, ny = 5, z = new Float64Array(nx * ny), water = new Uint8Array(nx * ny).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = i < 15 ? 3 : 1; // pool west, tailwater east of the weir
  const c = { nx, ny, z }, k = 2 * nx + 12, near = waterNear(c, water, k, 6);
  check('nearest cells: nearest first', nearestCells(c, near, k, 1)[0] === k && nearestCells(c, near, k, 5).every(q => Math.hypot(q % nx - 12, ((q / nx) | 0) - 2) <= 1));
  check('the lidar surface at a gauge above a weir is the pool (3 m), not the tailwater (1 m)', surfaceAtGauge(c, near, k) === 3 && Math.min(...near.map(q => z[q])) === 1);
  const bed = Float64Array.from(z, v => v - 1.5); // a carved channel: the bed 1.5 m below the lidar surface
  check('with a carved channel, the surface at a gauge is still the lidar one', surfaceAtGauge({ ...c, z: bed, zSurf: z }, near, k) === 3);
  const s = startDepths({ ...c, mask: new Uint8Array(nx * ny).fill(1) }, water, [{ cells: [k], rise: 0.4 }], { surfR: 6 });
  check('a pool above a weir keeps its own surface: it rises right up to the weir', Math.abs(s.depth[2 * nx + 14] - 0.4) < 1e-6 && Math.abs(s.depth[2 * nx + 15] - 0.4) < 1e-6, `${s.depth[2 * nx + 14].toFixed(2)}, ${s.depth[2 * nx + 15].toFixed(2)}`);
}
{ // a gauge on the lip of a 5 m falls (Wissahickon Creek at its mouth): a sloping face between an 8 m pool and 3 m
  // tailwater, the tailwater and the face nearest it. Its reading (8.46 m) says it reads the pool.
  const nx = 30, ny = 5, z = new Float64Array(nx * ny), water = new Uint8Array(nx * ny).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = i < 10 ? 8 : i < 14 ? 8 - (i - 9) : 3; // pool, face 7–4 m, tailwater
  const c = { nx, ny, z }, k = 2 * nx + 14, near = waterNear(c, water, k, 8);
  check('without a reading, the nearest water at a falls is mostly the tailwater', surfaceAtGauge(c, near, k) < 5);
  const pool = gaugeWater(c, near, 8.46);
  check('with its reading, a gauge above a falls reads the pool', pool.length > 0 && pool.every(q => z[q] > 7) && surfaceAtGauge(c, near, k, 8.46) === 8, `${pool.length} cells`);
  check('a reading below the pool takes the tailwater', gaugeWater(c, near, 3.4).every(q => z[q] <= 3.4) && surfaceAtGauge(c, near, k, 3.4) === 3);
  check('a reading under every water surface falls back to all the cells', gaugeWater(c, near, 1).length === near.length);
}
{ // a river (rows 9–10, surface 1 m) under a bridge deck at 9 m (columns 20–22, flagged water by the river line), with
  // a yard at 3 m beside the deck: a parallel rise of 0.4 m must not start the yard under the deck's level
  const nx = 40, ny = 20, z = new Float64Array(nx * ny).fill(3), water = new Uint8Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 9; j <= 10; j++) for (let i = 0; i < nx; i++) { z[j * nx + i] = i >= 20 && i <= 22 ? 9 : 1; water[j * nx + i] = 1; }
  for (let j = 0; j < 9; j++) for (let i = 18; i <= 24; i++) z[j * nx + i] = 8.9; // the deck's approach ramp north, all of it above the yard
  for (let j = 0; j < 9; j++) for (let i = 21; i <= 21; i++) z[j * nx + i] = 3; // a gap to the yard
  const c = { nx, ny, z, mask };
  const base = waterBase(water, z, nx, ny, 5, 1);
  check('water base: a deck flagged as water takes the river under it', base[9 * nx + 21] === 1 && base[9 * nx + 5] === 1);
  const s = startDepths(c, water, [{ cells: [9 * nx + 1], rise: 0.4 }], { surfR: 5 });
  check('a rise from a deck does not flood the ground beside it', s.depth[4 * nx + 21] === 0 && s.depth[9 * nx + 21] === 0 && Math.abs(s.depth[10 * nx + 5] - 0.4) < 1e-6, `yard ${s.depth[4 * nx + 21].toFixed(2)} m`);
  const old = startDepths(c, water, [{ cells: [9 * nx + 1], rise: 0.4 }], { surfR: 0 });
  check('(without it, the yard starts 6.4 m deep)', Math.abs(old.depth[4 * nx + 21] - 6.4) < 1e-6);
}
{ // gauge datums
  const lv = { gage: 0.5, elev: {} };
  const ok = await gaugeSurface({ datumM: 50, datum: 'NAVD88', acyM: 0.03 }, lv, null);
  check('gage height + NAVD88 datum', Math.abs(ok.z - 50.5) < 1e-9);
  const rough = await gaugeSurface({ datumM: 50, datum: 'NAVD88', acyM: 3 }, lv, null);
  check('a datum read off a map is not used', rough.z === null && /±/.test(rough.why));
  const local = await gaugeSurface({ datumM: 50, datum: 'COE1912', acyM: 0.01 }, lv, null);
  check('a local datum is not used', local.z === null);
  const fake = async () => ({ ok: true, json: async () => ({ destOrthoht: '99.785' }) });
  const ng = await gaugeSurface({ lon: -76.8, lat: 39.3 }, { elev: { NGVD29: 10 } }, fake);
  check('NGVD29 lake levels shift to NAVD88', Math.abs(ng.z - 9.785) < 1e-9);
}

if (process.argv.includes('--live')) {
  const fetcher = (url) => fetch('http://localhost:8770/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url }) });
  const { findLevelGauges, readLevels, lidarSurfaceNear } = await import('../src/waterlevels.js');
  const gs = await findLevelGauges([-76.85, 39.28, -76.75, 39.34], fetcher), g = gs.find(x => x.site === '01589000');
  const lv = await readLevels(['01589000'], fetcher), r = lv.get('01589000'), surf = await gaugeSurface(g, r, fetcher), zw = await lidarSurfaceNear(g.lon, g.lat, fetcher);
  console.log(`Patapsco at Hollofield: ${gs.length} level gauges nearby; latest ${surf.z?.toFixed(2)} m NAVD88 (${surf.how}), flow ${(r.q / 0.0283168).toFixed(0)} cfs; lidar water surface ${zw?.toFixed(2)} m → rise ${(surf.z - zw).toFixed(2)} m`);
  check('live gauge level and lidar surface', surf.z > 50 && zw > 50 && Math.abs(surf.z - zw) < 5);
}

{ // the tide on the edge: a tidal channel leaving south (bed −3 m, lidar surface 0.5 m) whose land cover marks only its
  // middle as water, banks at 5 m; a pool above a dam crossing the north edge (surface 3.2 m); a stream at 12 m on the west
  const nx = 20, ny = 10, N = nx * ny, z = new Float64Array(N).fill(5), zSurf = new Float64Array(N).fill(5), water = new Uint8Array(N), mask = new Uint8Array(N).fill(1);
  for (let i = 6; i <= 13; i++) { const k = (ny - 1) * nx + i; z[k] = -3; zSurf[k] = 0.5; if (i >= 8 && i <= 11) water[k] = 1; }
  for (let i = 8; i <= 11; i++) { z[i] = 1.6; zSurf[i] = 3.2; water[i] = 1; }
  for (let j = 3; j <= 5; j++) { z[j * nx] = zSurf[j * nx] = 12; water[j * nx] = 1; }
  const c = { nx, ny, z, zSurf, mask }, row = (ks) => ks.map(k => `${k % nx},${(k / nx) | 0}`).sort().join(' ');
  const got = tidalEdgeCells(c, mask, water, 2.0), want = [6, 7, 8, 9, 10, 11, 12, 13].map(i => (ny - 1) * nx + i);
  check('tide edge: the whole tidal channel to its banks, not the pool above the dam or the stream up the hill', row(got) === row(want), row(got));
  const m2 = mask.slice(); m2[(ny - 1) * nx + 10] = 0;
  const g2 = tidalEdgeCells(c, m2, water, 2.0);
  check('tide edge: a closed (masked) edge cell is left out', g2.length === 7 && !g2.includes((ny - 1) * nx + 10));
  check('tide edge: the pool takes the tide once the tide stands above it', tidalEdgeCells(c, mask, water, 3.5).filter(k => k < nx).length === 4);
}

console.log(fails ? `\n${fails} FAILED` : '\nall water-level tests passed');
process.exit(fails ? 1 : 0);
