// Starting water-level tests: a gauged river rises parallel to its lidar surface, a lake fills flat and spills onto
// connected low ground only, each water body takes the nearest gauge, gauge datums need to be surveyed, and NGVD29
// readings shift to NAVD88.
// Usage: node tests/run-waterlevel-tests.mjs  (--live: reads the Patapsco at Hollofield gauge and the lidar at it through the local server)
import { startDepths, components, gaugeSurface, waterNear } from '../src/waterlevels.js';

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

console.log(fails ? `\n${fails} FAILED` : '\nall water-level tests passed');
process.exit(fails ? 1 : 0);
