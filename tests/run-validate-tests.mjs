// Validation scorecard tests: peaks and their timing, gauge scores, matching a storm to its STN event, the scorecard's
// statuses and verdict, and a gauge's level series in NAVD88 from NWIS (a fake fetcher). Usage: node tests/run-validate-tests.mjs
import { TARGETS, peakOf, gaugeScore, hydrographScore, valueAt, matchEvent, scorecard } from '../src/validate.js';
import { levelSeries } from '../src/waterlevels.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const MIN = 60e3, T0 = Date.parse('2021-09-01T18:00Z');

// ---- peaks
{
  const s = [[0, 1], [1, 3], [2, 2], [3, NaN], [4, 2.5]];
  const p = peakOf(s);
  check('peak: highest finite value and its time', p.t === 1 && p.v === 3 && !p.atEnd);
  check('peak: within a window', peakOf(s, 2, 4).v === 2.5 && peakOf(s, 2, 4).atEnd);
  check('peak: empty window → null', peakOf(s, 10, 20) === null);
}

// ---- a gauge: observed every 15 min, the model every minute for 6 h, the model 0.2 m high and 20 min late
{
  const hump = (t, tp, v) => v * Math.exp(-(((t - tp) / (90 * MIN)) ** 2));
  const obs = [], model = [];
  for (let t = T0 - 2 * 3600e3; t <= T0 + 10 * 3600e3; t += 15 * MIN) obs.push([t, 5 + hump(t, T0 + 3 * 3600e3, 2)]);
  for (let t = T0; t <= T0 + 6 * 3600e3; t += MIN) model.push([t, 5.2 + hump(t, T0 + 3 * 3600e3 + 20 * MIN, 2)]);
  const g = gaugeScore(obs, model);
  check('gauge: peak error and lag', near(g.error, 0.2, 1e-6) && near(g.lag, 20, 1e-6) && !g.obsAtEnd && !g.modelAtEnd, `${g.error.toFixed(3)} m, ${g.lag.toFixed(1)} min`);
  const short = model.filter(([t]) => t <= T0 + 2 * 3600e3), gs = gaugeScore(obs, short);
  check('gauge: a run that ends on the rise says so (observed peak looked for in the run only)', gs.modelAtEnd && gs.obsAtEnd);
  check('gauge: no readings → null', gaugeScore([], model) === null);
}

// ---- the whole hydrograph: flow at a gauge over the storm
{
  const hump = (t, tp, v, w = 90) => v * Math.exp(-(((t - tp) / (w * MIN)) ** 2));
  const obs = [], same = [], half = [], late = [];
  for (let t = T0; t <= T0 + 12 * 3600e3; t += 5 * MIN) obs.push([t, 1 + hump(t, T0 + 4 * 3600e3, 60)]);
  for (let t = T0; t <= T0 + 12 * 3600e3; t += MIN) { same.push([t, 1 + hump(t, T0 + 4 * 3600e3, 60)]); half.push([t, 0.5 * (1 + hump(t, T0 + 4 * 3600e3, 60))]); late.push([t, 1 + hump(t, T0 + 4 * 3600e3 + 60 * MIN, 60)]); }
  check('interpolation between samples, null outside', valueAt([[0, 0], [10, 1]], 5) === 0.5 && valueAt([[0, 0], [10, 1]], 11) === null && valueAt([[0, 0], [10, NaN]], 5) === null);
  const a = hydrographScore(obs, same);
  check('hydrograph: a perfect model scores 1', near(a.nse, 1, 1e-9) && near(a.kge, 1, 1e-9) && near(a.volumeRatio, 1, 1e-9) && near(a.peakRatio, 1, 1e-9) && a.lag === 0 && near(a.hours, 12, 1e-9));
  const b = hydrographScore(obs, half);
  check('hydrograph: half the flow → half the volume and peak, KGE mean ratio 0.5', near(b.volumeRatio, 0.5, 1e-9) && near(b.peakRatio, 0.5, 1e-9) && near(b.beta, 0.5, 1e-9) && near(b.r, 1, 1e-9) && b.nse < 0.65, `NSE ${b.nse.toFixed(2)}`);
  const c = hydrographScore(obs, late);
  check('hydrograph: an hour late → the right volume, a 60 min lag, a lower NSE', near(c.volumeRatio, 1, 0.01) && near(c.lag, 60, 1e-9) && c.nse < 0.6, `NSE ${c.nse.toFixed(2)}`);
  const d = hydrographScore(obs, same.filter(([t]) => t <= T0 + 6 * 3600e3));
  check('hydrograph: scored only over the hours both cover', near(d.hours, 6, 1e-9) && near(d.volumeRatio, 1, 1e-9));
  check('hydrograph: too little overlap → null', hydrographScore(obs, same.slice(0, 10)) === null && hydrographScore([], same) === null);
  const card = scorecard({ observed: true, gauges: [{ site: 'x', name: 'Creek', score: gaugeScore(obs, half), flow: { line: 'Line 1', score: b }, levelShape: b }], mass: { surface: 0, combined: null, clipped: 0, rain: 1 } });
  const it = (re) => card.items.find(i => re.test(i.label));
  check('scorecard: flow volume, peak and NSE rated, KGE and the level shape shown', it(/flow volume/).status === 'poor' && it(/peak flow/).status === 'poor' && it(/flow over the storm/).status === 'fair' && it(/Kling/).status === 'info' && it(/level over the storm/).status === 'info');
  const good = scorecard({ observed: true, gauges: [{ site: 'x', name: 'Creek', score: gaugeScore(obs, same), flow: { line: 'Line 1', score: a } }], mass: { surface: 0, combined: null, clipped: 0, rain: 1 } });
  check('scorecard: a perfect flow is good', ['flow volume', 'peak flow', 'flow over the storm'].every(k => good.items.find(i => i.label.includes(k)).status === 'good'));
}

// ---- the STN event for a storm
{
  const events = ['2021 Ida', '2011 Irene', '2012 Sandy', '2021 Henri', 'May 2025 MD Flood'];
  check('event: by name', matchEvent(events, { name: 'Ida remnants, radar', t0: T0 }) === '2021 Ida');
  check('event: by year and month', matchEvent(events, { name: 'Storm of 15 May 2025', t0: Date.parse('2025-05-15T00:00Z') }) === 'May 2025 MD Flood');
  check('event: by year when the name says nothing', matchEvent(['2016 Ellicott', '2018 Ellicott'], { name: 'Historic storm', t0: Date.parse('2018-05-27T18:00Z') }) === '2018 Ellicott');
  check('event: none for another year', matchEvent(events, { name: 'Storm', t0: Date.parse('2019-07-08T00:00Z') }) === null);
  check('event: a design storm has no event', matchEvent(events, { name: '100-yr 24 h' }) === null);
}

// ---- the scorecard
{
  const hwm = { n: 12, bias: -0.05, mae: 0.1, rmse: 0.12, within15: 0.75, calls: 10, hits: 9, misses: 1, falseAlarms: 0 };
  const g = { site: '01474500', name: 'Schuylkill River at Philadelphia', score: { error: 0.25, lag: 20, obsAtEnd: false, modelAtEnd: false } };
  const mass = { surface: 2e-7, combined: 0.004, clipped: 1e-4, rain: 5e5 };
  const rain = { source: 'MRMS gauge-corrected', gauged: 1, usedMM: 120, radarMM: 110, siteMM: 90 };
  const sc = scorecard({ hwm, gauges: [g], rain, mass, observed: true });
  const st = (label) => sc.items.find(i => i.label.startsWith(label))?.status;
  check('scorecard: HWM RMSE 12 cm is good, bias 5 cm good', st('High-water marks: RMSE') === 'good' && st('High-water marks: bias') === 'good');
  check('scorecard: 9 of 10 flooded marks is good', st('Flooded marks') === 'good' && sc.items.find(i => i.label.startsWith('Flooded')).value === 0.9);
  check('scorecard: gauge 25 cm high is fair, 20 min late good', st('Gauge 01474500 Schuylkill River at Philadelphia: peak level') === 'fair' && st('Gauge 01474500 Schuylkill River at Philadelphia: peak time') === 'good');
  check('scorecard: rain against radar alone (1.09) good, against the gridded record (1.33) poor', st('Gauge-corrected against') === 'good' && st('Against the site') === 'poor');
  check('scorecard: books good', st('Mass balance, surface') === 'good' && st('Mass balance with the pipes') === 'good' && st('Water added') === 'good');
  check('scorecard: verdict fair (rain and books do not count)', sc.verdict.status === 'fair', sc.verdict.text);
  const bad = scorecard({ hwm: { ...hwm, rmse: 0.5 }, gauges: [], mass, observed: true });
  check('scorecard: one poor check → poor', bad.verdict.status === 'poor' && /1 of 3/.test(bad.verdict.text), bad.verdict.text);
  const off = scorecard({ hwm, gauges: [], mass: { ...mass, surface: 0.01 }, observed: true });
  check('scorecard: books off → poor whatever the marks say', off.verdict.status === 'poor' && /books/.test(off.verdict.text), off.verdict.text);
  const none = scorecard({ gauges: [{ site: '1', name: 'x', score: null, why: 'gauge datum not on a national datum' }], mass, observed: true });
  check('scorecard: nothing to compare → not validated, with the reason kept', none.verdict.status === 'info' && none.items[0].note.includes('datum'));
  check('scorecard: a design storm is not validated', /design storm/.test(scorecard({ mass, observed: false }).verdict.text));
  const late = scorecard({ gauges: [{ ...g, score: { error: 0.05, lag: -200, obsAtEnd: true, modelAtEnd: false } }], observed: true });
  check('scorecard: a peak cut off by the run end is not scored for timing, and is called the highest level in the run', late.items[1].status === 'info' && late.items[0].note.includes('still rising') && /highest level in the run/.test(late.items[0].label));
  const cut = scorecard({ hwm, gauges: [{ ...g, score: { error: -0.1, lag: 0, obsAtEnd: true, modelAtEnd: false } }], observed: true });
  check('scorecard: marks against a run that stopped before the crest say so', /still rising/.test(cut.items[0].note) && /past the crest/.test(cut.verdict.text), cut.verdict.text);
  check('scorecard: custom targets', scorecard({ hwm }, { ...TARGETS, hwmRMSE: [0.05, 0.1] }).items[0].status === 'poor');
}

// ---- a gauge's series in NAVD88
{
  const FT = 0.3048, iv = (series) => ({ ok: true, json: async () => ({ value: { timeSeries: series.map(([code, vals]) => ({ variable: { variableCode: [{ value: code }] }, values: [{ value: vals.map(([t, v]) => ({ dateTime: new Date(t).toISOString(), value: String(v) })) }] })) } }) });
  const ncat = { ok: true, json: async () => ({ destOrthoht: '99.75' }) }; // NGVD29 → NAVD88: −0.25 m
  const g = { site: '01474500', lon: -75.18, lat: 39.97, datumM: 10 * FT, datum: 'NGVD29', acyM: 0.01 };
  const gageOnly = async (u) => (u.includes('ncat') ? ncat : iv([['00065', [[T0, 5], [T0 + 15 * MIN, 6], [T0 + 30 * MIN, -999999]]]]));
  const a = await levelSeries(g, gageOnly, T0, T0 + 3600e3);
  check('levels: gage height + NGVD29 datum → NAVD88', a.series.length === 2 && near(a.series[1][1], 16 * FT - 0.25, 1e-9) && /NGVD29/.test(a.how), a.series.map(p => p[1].toFixed(3)).join(' '));
  const both = async (u) => iv([['00065', [[T0, 5]]], ['62620', [[T0, 20], [T0 + 15 * MIN, 21]]]]);
  const b = await levelSeries(g, both, T0, T0 + 3600e3);
  check('levels: a NAVD88 elevation series is used as is', near(b.series[1][1], 21 * FT, 1e-9) && b.how.includes('NAVD88'));
  const c = await levelSeries({ ...g, datum: 'COE1912' }, gageOnly, T0, T0 + 3600e3);
  check('levels: a local gauge datum gives a reason, no series', c.series === null && /datum/.test(c.why));
  const d = await levelSeries(g, async () => iv([]), T0, T0 + 3600e3);
  check('levels: no readings', d.series === null && /no level/.test(d.why));
}

// ---- flood maps: an observed map counts in the verdict; another model's map is a comparison only
{
  const m = (o) => ({ name: 'X (y)', kind: 'depth', mapped: 100, hitRate: 0.8, csi: 0.55, falseAlarmRatio: 0.2, areaRatio: 1, depth: { n: 80, bias: -0.05, rmse: 0.2 }, ...o });
  const sc = scorecard({ floodMaps: [m({})], observed: true });
  const lines = sc.items.filter(i => i.label.startsWith('X:'));
  check('flood map: hit rate, CSI and depth bias lines, all good', lines.length === 3 && lines.every(i => i.status === 'good' && i.group === 'observations') && sc.verdict.status === 'good');
  const cmp = scorecard({ floodMaps: [m({ observed: false, csi: 0.1, depth: null })], observed: false });
  check('another model’s map: a comparison, poor CSI not in the verdict', cmp.items.every(i => i.group === 'comparison') && cmp.items.find(i => /critical/.test(i.label)).status === 'poor' && cmp.verdict.status === 'info');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
