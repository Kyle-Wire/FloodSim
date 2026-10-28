// Calibration tests: observation parsing (CSV in feet, GeoJSON in metres, flooded flags), scoring (levels, depths,
// flooded / dry calls, a missed flood scored at ground), and the sweep plan.  Usage: node tests/run-calibrate-tests.mjs
import { parseObservations, scoreRun, sweepPlan } from '../src/calibrate.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const csv = `HWM_ID,Latitude,Longitude,Elev_ft,notes
HWM-1,39.9420,-75.1550,32.81,"door, west side"
HWM-2,39.9425,-75.1540,,dry
P3,39.9430,-75.1530,33.50,`;
const obs = parseObservations(csv, { units: 'ft' });
check('CSV high-water marks in feet become metres', obs.length === 2 && obs[0].name === 'HWM-1' && Math.abs(obs[0].wse - 10.0005) < 1e-3, JSON.stringify(obs[0]));
const gj = parseObservations(JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-75.15, 39.94] }, properties: { name: 'cellar', depth: 0.4 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-75.151, 39.941] }, properties: { name: '311', flooded: 'yes' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-75.152, 39.942] }, properties: { name: 'dry report', flooded: 'no' } }] }), { units: 'm' });
check('GeoJSON depths and flooded reports', gj.length === 3 && gj[0].depth === 0.4 && gj[0].flooded === true && gj[1].flooded === true && gj[2].flooded === false);

{ // model: ground 9.5 everywhere; water surface 10.1 at the first mark, dry at the second
  const at = (lon) => (lon === -75.1550 ? { ground: 9.5, wse: 10.1 } : lon === -75.1530 ? { ground: 9.5, wse: null } : { ground: 9.5, wse: 9.9 });
  const s = scoreRun([...obs, ...gj], at);
  const m1 = s.points.find(p => p.name === 'HWM-1'), m3 = s.points.find(p => p.name === 'P3');
  check('a level error is model − observed', Math.abs(m1.error - (10.1 - obs[0].wse)) < 1e-9 && m1.call === 'right');
  check('a mark the model leaves dry scores its ground', Math.abs(m3.model - 9.5) < 1e-9 && m3.error < 0 && m3.call === 'missed');
  const dry = s.points.find(p => p.name === 'dry report');
  check('flooded / dry calls: a false alarm', dry.call === 'false alarm' && s.falseAlarms === 1 && s.misses === 1, `${s.hits} hits, ${s.misses} missed, ${s.falseAlarms} false alarms`);
  check('summary statistics', s.n === 3 && s.rmse > 0 && s.within15 != null && s.score > s.rmse, `RMSE ${s.rmse.toFixed(3)} m, score ${s.score.toFixed(3)}`);
}
{
  const plan = sweepPlan(['manning', 'clog'], 3);
  check('sweep plan: a grid over the chosen parameters', plan.length === 9 && plan[0].manning === 0.6 && plan[8].manning === 1.6 && plan[8].clog === 0.7 && plan[4].manning === 1.1);
}

console.log(fails ? `\n${fails} FAILED` : '\nall calibration tests passed');
process.exit(fails ? 1 : 0);
