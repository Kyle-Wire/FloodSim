// River inflow tests: normal quantiles, log-Pearson III (zero skew = log-normal; rarer floods are bigger), the design
// hydrograph peaks on time, recorded flows interpolate, river entries from a waterway crossing the area, the inflow link
// books the water it adds, a river entering at the edge stays in (the edge closed across it), and the STN high-water-mark import keeps only marks with a usable datum.
// Usage: node tests/run-inflow-tests.mjs  (--live: also fits the Patapsco at Hollofield record through the local server)
import { normInv, lp3, designHydrograph, recordedHydrograph, riverEntries, entryCells, entryEdge, InflowLinks, CFS, polygonAreaKm2, areaRatioScale, basinAreaKm2 } from '../src/inflow.js';
import { CPUSolver } from '../src/solver-cpu.js';
import { fromSTN } from '../src/calibrate.js';
import { GridRef, fromUTM } from '../src/geo.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

check('normal quantiles', Math.abs(normInv(0.99) - 2.326348) < 1e-5 && Math.abs(normInv(0.5)) < 1e-9 && Math.abs(normInv(0.01) + 2.326348) < 1e-5);
{ // symmetric log flows (zero skew): Q2 = median, Q100 = 10^(m + 2.326 s)
  const peaks = []; for (let i = 0; i < 41; i++) peaks.push({ year: 1980 + i, q: 10 ** (2 + 0.3 * normInv((i + 0.5) / 41)) });
  const ys = peaks.map(p => Math.log10(p.q)), m = ys.reduce((a, b) => a + b) / 41, s = Math.sqrt(ys.reduce((a, b) => a + (b - m) ** 2, 0) / 40);
  const q2 = lp3(peaks, 2), q100 = lp3(peaks, 100);
  check('LP3 with zero skew is log-normal', Math.abs(Math.log10(q2) - m) < 1e-3 && Math.abs(Math.log10(q100) - (m + 2.326348 * s)) < 1e-3, `Q2 ${q2.toFixed(1)}, Q100 ${q100.toFixed(1)}`);
  check('rarer floods are bigger', lp3(peaks, 10) > q2 && lp3(peaks, 50) > lp3(peaks, 10) && q100 > lp3(peaks, 50));
  check('too short a record gives no estimate', lp3(peaks.slice(0, 8), 100) === null);
}
{
  const h = designHydrograph(500, 3600);
  check('design hydrograph peaks at its time to peak', Math.abs(h(3600) - 500) < 1e-9 && h(1800) < 500 && h(7200) < 500 && h(0) === 25);
  const r = recordedHydrograph([{ t: 1000, q: 10 }, { t: 61000, q: 70 }], 1000);
  check('recorded flows interpolate in time', Math.abs(r(30) - 40) < 1e-9 && r(-5) === 10 && r(999) === 70);
}
{ // a river running east crosses into a 200 m area at its west edge
  const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), ll = (x, y) => fromUTM(486000 + x, 4422200 - y, 18);
  const ways = [{ kind: 'river', name: 'Test Creek', line: [ll(-300, 100), ll(-50, 102), ll(100, 104), ll(300, 106)] }, { kind: 'ditch', line: [ll(-50, 50), ll(50, 50)] }];
  const e = riverEntries(g, ways, (i, j) => i >= 0 && j >= 0 && i < 200 && j < 200);
  check('a river entering the area is found at the edge, flowing in', e.length === 1 && e[0].at[0] < 2 && Math.abs(e[0].at[1] - 102.7) < 1 && e[0].dir[0] > 0.99 && e[0].name === 'Test Creek', JSON.stringify(e[0]?.at));
}
{
  const L = new InflowLinks([{ cells: [5, 6], flow: (t) => 10 + t }, { cells: [9], flow: () => 4, scale: 0.5 }]);
  const q1 = L.step(new Float64Array(3), new Float32Array(3), 2, 0);
  check('inflow rates: the entry flow split over its cells, negative = in', q1[0] === -5.5 && q1[1] === -5.5 && q1[2] === -2);
  L.step(Float64Array.from([-11, -11, -4]), new Float32Array(3), 2, 2);
  check('inflow books the water that actually came in', L.totals.volume === 26);
}
{
  const marks = fromSTN([
    { latitude: 39.94, longitude: -75.15, elev_ft: 20, vertical_datum_name: 'NAVD88', label: 'A', hwm_quality_name: 'Good: +/- 0.10 ft', event_name: '2021 Ida', height_above_ground: 2, site_number: 'PAPHI1', location_description: 'Seed line on door' },
    { latitude: 39.941, longitude: -75.151, elev_ft: 812, vertical_datum_name: 'local control point', label: 'B', height_above_ground: 1.5, event_name: '2021 Ida' },
    { latitude: 39.942, longitude: -75.152, elev_ft: 30, vertical_datum_name: 'NGVD29', label: 'C', event_name: '2021 Ida' },
    { latitude: 45, longitude: -70, elev_ft: 20, vertical_datum_name: 'NAVD88', label: 'far', event_name: '2021 Ida' }], [-75.16, 39.93, -75.14, 39.95]);
  const a = marks.find(m => m.name === 'A (PAPHI1)'), b = marks.find(m => m.name === 'B');
  check('STN marks: NAVD88 elevations, height above ground otherwise, no other datums, inside the box only', marks.length === 2 && Math.abs(a.wse - 20 * 0.3048) < 1e-9 && b.depth === 1.5 * 0.3048 && b.wse == null, JSON.stringify(marks.map(m => m.name)));
  check('STN marks: named with their site, where they were found kept', a.where === 'Seed line on door' && b.where === '');
}

{ // a river entering across the edge (row 0, a free outfall) into a 24 m channel; the far end is a wall, so whatever
  // leaves the domain went back out through the edge it came in by
  const nx = 40, ny = 60, F = 2, z = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = (i >= 14 && i < 26 ? 0 : 3) - 0.002 * F * j;
  const c = { nx, ny, F, z, mask }, at = [20 * F, 0.1], Q = 30, T = 200;
  const leak = (cells, m) => {
    const s = new CPUSolver({ nx, ny, dx: F, z, mask: m, manning: 0.035, bc: { west: 'outflow', east: 'outflow', south: 'outflow', north: 'wall' } });
    s.rainRate = 1; s.rainField = new Float64Array(s.NX * s.NY);
    for (const k of cells) s.rainField[s.idx(k % nx, (k / nx) | 0)] = Q / cells.length / (F * F);
    s.run(T); return s.vol.outflow / (Q * T);
  };
  const e = entryEdge(c, at), m = mask.slice(); for (const k of e.closed) m[k] = 0;
  check('entry edge: the channel’s width, closed past it, the flow in just inside', e.width === 24 && e.closed.length === 22 && e.cells.length === 24 && e.cells.every(k => ((k / nx) | 0) >= 1 && m[k]), `${e.width} m, ${e.closed.length} closed, ${e.cells.length} cells`);
  const before = leak(entryCells(c, at), mask), after = leak(e.cells, m);
  check('a river put in at a free-outfall edge pours back out; closed across it, it stays in', before > 0.05 && after < 1e-3, `${(100 * before).toFixed(1)}% → ${(100 * after).toFixed(2)}% of the inflow left by the edge`);
  check('entry edge: none away from the edge', entryEdge(c, [20 * F, 30 * F]) === null);
}
if (process.argv.includes('--live')) {
  const fetcher = (url) => fetch('http://localhost:8770/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url }) });
  const { annualPeaks } = await import('../src/inflow.js');
  const p = await annualPeaks('01589000', fetcher);
  console.log(`Patapsco at Hollofield: ${p.length} annual peaks; Q10 ${(lp3(p, 10) / CFS).toFixed(0)} cfs, Q100 ${(lp3(p, 100) / CFS).toFixed(0)} cfs; largest recorded ${(Math.max(...p.map(x => x.q)) / CFS).toFixed(0)} cfs`);
}

{ // drainage-area transfer to an ungauged entry
  const sq = (lat) => ({ type: 'Polygon', coordinates: [[[-76, lat], [-75.9, lat], [-75.9, lat + 0.1], [-76, lat + 0.1], [-76, lat]]] });
  const a = polygonAreaKm2(sq(39)), hole = polygonAreaKm2({ type: 'Polygon', coordinates: [sq(39).coordinates[0], [[-75.98, 39.02], [-75.92, 39.02], [-75.92, 39.08], [-75.98, 39.08], [-75.98, 39.02]]] });
  check('basin area of a 0.1° cell at 39° N', Math.abs(a - 11.132 * Math.cos(39.05 * Math.PI / 180) * 11.0574) < 0.05, `${a.toFixed(2)} km²`);
  check('holes subtract', Math.abs(hole - a * (1 - 0.36)) < 0.05, `${hole.toFixed(2)} km²`);
  const s = areaRatioScale(120, 100, 0.8), far = areaRatioScale(300, 100, 0.8);
  check('drainage-area ratio: Q × (A / A_gauge)^b, flagged outside 0.5–1.5', Math.abs(s.k - 1.2 ** 0.8) < 1e-12 && s.ok && !far.ok && areaRatioScale(100, 100).k === 1);
  const L = new InflowLinks([{ cells: [1, 2], flow: () => 10, scale: 1.25 }]), q = L.step(new Float32Array(2), new Float32Array(2), 2, 0);
  check('the scale multiplies the entry’s inflow', Math.abs(q[0] + 6.25) < 1e-6 && Math.abs(q[1] + 6.25) < 1e-6);
}
if (process.argv.includes('--live')) {
  const fetcher = (url) => fetch('http://localhost:8770/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url }) });
  const b = await basinAreaKm2(-76.7867, 39.3101, fetcher); // the Patapsco just below the Hollofield gauge (01589000: 285 mi²)
  check('live: NLDI basin area below the Hollofield gauge ≈ the gauge’s 285 mi²', b.areaKm2 / 2.589988 > 250 && b.areaKm2 / 2.589988 < 340, `${(b.areaKm2 / 2.589988).toFixed(1)} mi², NHDPlus reach ${b.comid}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall inflow tests passed');
process.exit(fails ? 1 : 0);
