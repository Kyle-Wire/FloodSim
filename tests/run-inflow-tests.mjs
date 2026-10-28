// River inflow tests: normal quantiles, log-Pearson III (zero skew = log-normal; rarer floods are bigger), the design
// hydrograph peaks on time, recorded flows interpolate, river entries from a waterway crossing the area, the inflow link
// books the water it adds, and the STN high-water-mark import keeps only marks with a usable datum.
// Usage: node tests/run-inflow-tests.mjs  (--live: also fits the Patapsco at Hollofield record through the local server)
import { normInv, lp3, designHydrograph, recordedHydrograph, riverEntries, InflowLinks, CFS } from '../src/inflow.js';
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
    { latitude: 39.94, longitude: -75.15, elev_ft: 20, vertical_datum_name: 'NAVD88', label: 'A', hwm_quality_name: 'Good: +/- 0.10 ft', event_name: '2021 Ida', height_above_ground: 2 },
    { latitude: 39.941, longitude: -75.151, elev_ft: 812, vertical_datum_name: 'local control point', label: 'B', height_above_ground: 1.5, event_name: '2021 Ida' },
    { latitude: 39.942, longitude: -75.152, elev_ft: 30, vertical_datum_name: 'NGVD29', label: 'C', event_name: '2021 Ida' },
    { latitude: 45, longitude: -70, elev_ft: 20, vertical_datum_name: 'NAVD88', label: 'far', event_name: '2021 Ida' }], [-75.16, 39.93, -75.14, 39.95]);
  const a = marks.find(m => m.name === 'A'), b = marks.find(m => m.name === 'B');
  check('STN marks: NAVD88 elevations, height above ground otherwise, no other datums, inside the box only', marks.length === 2 && Math.abs(a.wse - 20 * 0.3048) < 1e-9 && b.depth === 1.5 * 0.3048 && b.wse == null, JSON.stringify(marks.map(m => m.name)));
}

if (process.argv.includes('--live')) {
  const fetcher = (url) => fetch('http://localhost:8770/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url }) });
  const { annualPeaks } = await import('../src/inflow.js');
  const p = await annualPeaks('01589000', fetcher);
  console.log(`Patapsco at Hollofield: ${p.length} annual peaks; Q10 ${(lp3(p, 10) / CFS).toFixed(0)} cfs, Q100 ${(lp3(p, 100) / CFS).toFixed(0)} cfs; largest recorded ${(Math.max(...p.map(x => x.q)) / CFS).toFixed(0)} cfs`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall inflow tests passed');
process.exit(fails ? 1 : 0);
