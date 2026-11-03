// Run rain-QA tests (src/rainqa.js): local reading hours to UTC across daylight saving, the IEM hourly and daily
// parsers (trace, missing), an hourly gauge's window and coverage, a daily gauge's reports against a storm (morning and
// evening observers), the storm's wet window (surge pad, live nowcast), the radar at a gauge, the comparison and its
// reasons for not scoring, the scorecard rows; then Hurricane Ida at Philadelphia from recorded IEM responses.
//   node tests/run-rainqa-tests.mjs [--live | --record]
//   (--live: the same against IEM now; --record: rewrite tests/fixtures/rainqa-ida-phl.json from IEM)
import { readFileSync, writeFileSync } from 'node:fs';
import * as Q from '../src/rainqa.js';
import { scorecard } from '../src/validate.js';
import { sampleWeights } from '../src/mrms.js';
import { haversineKm } from '../src/history.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const NY = 'America/New_York', H = 3600e3;

{ // time zones
  check('tz: 7 am EDT on 2021-09-02 is 11:00 UTC; 7 am EST on 2021-12-02 is 12:00 UTC', Q.localToUTC('2021-09-02', 7, NY) === Date.parse('2021-09-02T11:00Z') && Q.localToUTC('2021-12-02', 7, NY) === Date.parse('2021-12-02T12:00Z'));
  check('tz: on the spring-forward day 7 am is EDT (11:00 UTC)', Q.localToUTC('2021-03-14', 7, NY) === Date.parse('2021-03-14T11:00Z'));
  check('tz: local date of 02:00 UTC on 2 Sep is 1 Sep in New York', Q.localDate(Date.parse('2021-09-02T02:00Z'), NY) === '2021-09-01' && Q.localDate(Date.parse('2021-09-02T05:00Z'), NY) === '2021-09-02');
}

{ // hourly
  const csv = 'station,network,valid,precip_in\nPHL,PA_ASOS,2021-09-01 20:00,0.13\nPHL,PA_ASOS,2021-09-01 21:00,0.0001\nPHL,PA_ASOS,2021-09-01 22:00,M\nPHL,PA_ASOS,2021-09-01 23:00,1.00\nPNE,PA_ASOS,2021-09-01 20:00,T\n';
  const m = Q.parseHourly(csv), p = m.get('PHL');
  check('hourly: parsed by station; trace counts 0 and is marked; M is missing', p.size === 3 && near(p.get(Date.parse('2021-09-01T20:00Z')).mm, 0.13 * 25.4, 1e-9) && p.get(Date.parse('2021-09-01T21:00Z')).trace && p.get(Date.parse('2021-09-01T21:00Z')).mm === 0 && !p.has(Date.parse('2021-09-01T22:00Z')) && m.get('PNE').size === 1);
  const t = Q.hourlyTotal(p, Date.parse('2021-09-01T20:00Z'), Date.parse('2021-09-02T00:00Z'), 0);
  check('hourly: the hours whose middle is in the storm (20–23 UTC), one missing', t.hours === 4 && t.got === 3 && near(t.coverage, 0.75, 1e-9) && t.missing[0] === Date.parse('2021-09-01T22:00Z') && near(t.mm, 1.13 * 25.4, 1e-9), `${t.hours} h, ${t.got} got`);
  const t2 = Q.hourlyTotal(p, Date.parse('2021-09-01T20:00Z'), Date.parse('2021-09-02T00:00Z'), 60);
  check('hourly: the pad adds an hour each side', t2.hours === 6 && t2.span[0] === Date.parse('2021-09-01T19:00Z') && t2.span[1] === Date.parse('2021-09-02T01:00Z'));
}

{ // daily
  const g = { features: [
    { type: 'Feature', properties: { station: 'X-1', name: 'Morning', precip: 2.5, temp_hour: 7 }, geometry: { type: 'Point', coordinates: [-75.2, 40] } },
    { type: 'Feature', properties: { station: 'X-2', name: 'Evening', precip: 0.0001, temp_hour: 17 }, geometry: { type: 'Point', coordinates: [-75.1, 40] } },
    { type: 'Feature', properties: { station: 'X-3', name: 'Missing', precip: null, temp_hour: null }, geometry: { type: 'Point', coordinates: [-75.1, 40.1] } }] };
  const d = Q.parseDaily(g);
  check('daily: precip in mm, trace 0, missing null, reading hour', near(d.get('X-1').mm, 63.5, 1e-9) && d.get('X-1').obsHour === 7 && d.get('X-2').mm === 0 && d.get('X-2').trace && d.get('X-3').mm === null);
  // a storm 19:00 UTC 1 Sep → 05:00 UTC 2 Sep (3 pm → 1 am EDT)
  const t0 = Date.parse('2021-09-01T19:00Z'), t1 = Date.parse('2021-09-02T05:00Z'), dates = Q.dailyDates(t0, t1, NY);
  check('daily: dates from the storm\'s first local day to the day after its last', dates.join(',') === '2021-09-01,2021-09-02,2021-09-03', dates.join(','));
  const morning = new Map([['2021-09-01', { mm: 5, obsHour: 7 }], ['2021-09-02', { mm: 80, obsHour: 7 }], ['2021-09-03', { mm: 0, obsHour: 7 }]]);
  const a = Q.dailyTotal(morning, dates, t0, t1, NY);
  check('daily: a 7 am observer covers the storm with the 2 Sep report alone (11:00 UTC 1 Sep → 11:00 UTC 2 Sep), 14 h beyond it', a.days.join() === '2021-09-02' && a.mm === 80 && a.coverage === 1 && near(a.extraH, 14, 1e-9), `${a.days} +${a.extraH} h`);
  const evening = new Map([['2021-09-01', { mm: 30, obsHour: 17 }], ['2021-09-02', { mm: 40, obsHour: 17 }]]);
  const b = Q.dailyTotal(evening, dates, t0, t1, NY);
  check('daily: a 5 pm observer needs two reports (to 21:00 UTC 1 Sep and to 21:00 UTC 2 Sep); 3 Sep not needed', b.days.join() === '2021-09-01,2021-09-02' && b.mm === 70 && b.coverage === 1 && near(b.extraH, 38, 1e-9), `${b.days} +${b.extraH} h`);
  const gap = Q.dailyTotal(new Map([['2021-09-01', { mm: 30, obsHour: 17 }]]), dates, t0, t1, NY);
  check('daily: a needed report missing counts against coverage (its window at the usual hour)', gap.needed === 2 && gap.got === 1 && gap.missing[0] === '2021-09-02' && gap.coverage === 0.5);
  const none = Q.dailyTotal(new Map([['2021-09-02', { mm: 10, obsHour: null }]]), dates, t0, t1, NY);
  check('daily: no reading hour given → 7 am assumed and marked', none.assumedHour && none.obsHour === 7 && none.days.join() === '2021-09-02');
}

{ // the storm window and the radar at a gauge
  const st = { t0: Date.parse('2021-09-01T12:00Z'), blockMin: 60, depth: [0, 0, 0, 2, 5, 3, 0, 0] };
  const w = Q.stormWindow(st);
  check('storm: the wet blocks only (a surge pad dropped), and their rain', w.t0 === Date.parse('2021-09-01T15:00Z') && w.t1 === Date.parse('2021-09-01T18:00Z') && w.mm === 10 && !w.live);
  const lv = Q.stormWindow({ ...st, radar: { live: { observedUntil: Date.parse('2021-09-01T16:30Z') } } });
  check('storm: a live storm stops at its last observed minute (the nowcast is not checked)', lv.t1 === Date.parse('2021-09-01T16:30Z') && near(lv.mm, 2 + 2.5, 1e-9) && lv.live);
  check('storm: no rain → null', Q.stormWindow({ ...st, depth: [0, 0] }) === null && Q.stormWindow({ blockMin: 60, depth: [1] }) === null);
  const win = { lon0: -75.3, lat0: 40.1, step: 0.01, nx: 20, ny: 20, c0: 0, r0: 0 }, f = new Float32Array(400).fill(1);
  const rs = { t0: st.t0, blockMin: 60, radar: { win, frames: [f, null, f, f] } };
  check('radar: at a gauge inside the window, the frames summed (null frames dry)', near(Q.radarAt(rs, -75.2, 40.0, sampleWeights), 3, 1e-6));
  check('radar: only the frames in [t0, t1]', near(Q.radarAt(rs, -75.2, 40.0, sampleWeights, st.t0 + 2 * H, st.t0 + 3.5 * H), 1.5, 1e-6));
  check('radar: a gauge outside the window → null', Q.radarAt(rs, -75.5, 40.0, sampleWeights) === null && Q.radarAt(rs, -75.2, 40.2, sampleWeights) === null);
}

{ // comparison and scorecard
  const win = { t0: 0, t1: 10 * H, mm: 50 };
  const hr = (mm, cov = 1) => ({ mm, hours: 12, got: Math.round(12 * cov), coverage: cov, missing: [], span: [0, 12 * H] });
  const dy = (mm, cov = 1, extraH = 14) => ({ mm, days: ['d'], got: cov, needed: 1, coverage: cov, missing: cov < 1 ? ['d'] : [], span: [0, 24 * H], extraH, obsHour: 7, assumedHour: false });
  const gs = [{ id: 'PHL', kind: 'ASOS', km: 10, total: hr(40) }, { id: 'A', name: 'Alpha', kind: 'CoCoRaHS', km: 3, total: dy(100) }, { id: 'B', kind: 'CoCoRaHS', km: 5, total: dy(50) },
    { id: 'LOM', kind: 'ASOS', km: 20, total: hr(1, 0.75) }, { id: 'C', kind: 'CoCoRaHS', km: 6, total: dy(60, 0) }, { id: 'D', kind: 'CoCoRaHS', km: 7, total: dy(55, 1, 40) }, { id: 'E', kind: 'CoCoRaHS', km: 8, total: dy(1) }, { id: 'SRC', kind: 'ASOS', km: 1, total: hr(50) }];
  const c = Q.compareGauges(gs, win, { same: (g) => g.id === 'SRC' });
  const by = Object.fromEntries(c.rows.map(r => [r.id, r]));
  check('compare: ratio = model / gauge against the area mean', near(by.PHL.ratio, 1.25, 1e-12) && near(by.A.ratio, 0.5, 1e-12) && by.A.modelAt === 'area mean');
  check('compare: not scored — missing hours, missing report, a report far beyond the storm, a dry gauge, the storm\'s own gauge',
    !by.LOM.scored && /hours missing/.test(by.LOM.why) && !by.C.scored && /no report/.test(by.C.why) && !by.D.scored && /beyond the storm/.test(by.D.why) && !by.E.scored && /under/.test(by.E.why) && !by.SRC.scored && /own rain/.test(by.SRC.why));
  check('compare: summary over the scored gauges (median of 0.5, 1.0, 1.25), the nearest scored one', c.summary.n === 3 && near(c.summary.median, 1, 1e-12) && c.summary.min === 0.5 && c.summary.max === 1.25 && c.summary.nearest.id === 'A');
  const ub = Q.compareGauges([gs[5], { id: 'F', kind: 'CoCoRaHS', km: 2, total: dy(30, 1, 40) }, { id: 'G', kind: 'CoCoRaHS', km: 1, total: dy(30, 0, 40) }], win);
  const ubBy = Object.fromEntries(ub.rows.map(r => [r.id, r]));
  check('compare: a complete daily report beyond the storm is an upper bound (model 50 above 30 × 1.15, within 55; a missing report is none)',
    ubBy.F.bound === 'above' && ubBy.D.bound === 'within' && ubBy.G.bound === null && !ubBy.F.scored && ub.bounds.n === 2 && ub.bounds.above === 1 && ub.bounds.nearestAbove === 'F' && ub.summary === null && by.A.bound === null);
  const at = Q.compareGauges([gs[1]], win, { atGauge: () => 90 });
  check('compare: the radar at the gauge when given', near(at.rows[0].ratio, 0.9, 1e-12) && at.rows[0].modelAt === 'radar at the gauge');
  const rows = c.rows.map(r => ({ ...r, gaugeMM: r.gaugeMM }));
  const sc = scorecard({ observed: true, rain: { source: 'x', gauged: null, usedMM: 50, stations: { rows, summary: c.summary } } }).items.filter(i => i.group === 'rain');
  const med = sc.find(i => /median/.test(i.label)), nr = sc.find(i => /Nearest gauge/.test(i.label));
  check('scorecard: median and nearest rows, scored against the rain-source target', med?.value === 1 && med.status === 'good' && nr?.value === 0.5 && nr.status === 'poor', `${med?.label} / ${nr?.label}`);
  const none = scorecard({ observed: true, rain: { source: 'x', usedMM: 50, stations: { rows: [], summary: null } } }).items.find(i => /Nearby rain gauges/.test(i.label));
  check('scorecard: no gauges → an info row saying so', none?.status === 'info' && /within 25 km/.test(none.value));
}

// ------------------------------------------------------------------ Hurricane Ida at Philadelphia (30th Street)
// The storm as the app replays it from the site's hourly record: the wettest stretch, 19:00 UTC 1 Sep → 05:00 UTC 2 Sep
// (the morning's rain is split off by a dry gap of more than 6 h). The model total here is a placeholder (60 mm); the
// check is of the gauges' totals and their windows.
const SITE = [-75.18, 39.96], FIX = new URL('./fixtures/rainqa-ida-phl.json', import.meta.url);
const IDA = { t0: Date.parse('2021-09-01T19:00Z'), blockMin: 60, depth: new Array(10).fill(6), source: 'IEM Reanalysis hourly precipitation at the site' };
const mode = process.argv.includes('--record') ? 'record' : process.argv.includes('--live') ? 'live' : 'fixture';
const net = (u) => fetch(u, { headers: { 'user-agent': 'FloodSim tests' } });
let fetcher;
if (mode === 'fixture') {
  const fx = JSON.parse(readFileSync(FIX, 'utf8'));
  fetcher = async (u) => { const b = fx[u]; return b == null ? { ok: false, status: 404, text: async () => '', json: async () => ({}) } : { ok: true, status: 200, text: async () => b, json: async () => JSON.parse(b) }; };
} else if (mode === 'record') {
  // keep the responses small: the state networks near the site, and the stations within 30 km
  const fx = {}, within = (f) => f.geometry?.type === 'Point' && haversineKm(SITE[0], SITE[1], ...f.geometry.coordinates) <= 30;
  fetcher = async (u) => {
    const r = await net(u); if (!r.ok) return r;
    let b = await r.text();
    if (/networks\.json/.test(u)) { const j = JSON.parse(b); j.data = j.data.filter(n => /^(PA|NJ|DE|MD|NY)_(ASOS|COCORAHS)$/.test(n.id)); b = JSON.stringify(j); }
    else if (/geojson/.test(u)) { const j = JSON.parse(b); j.features = j.features.filter(within); b = JSON.stringify(j); }
    fx[u] = b; return { ok: true, status: 200, text: async () => b, json: async () => JSON.parse(b) };
  };
  fetcher.save = () => { writeFileSync(FIX, JSON.stringify(fx)); console.log(`      recorded ${Object.keys(fx).length} responses → tests/fixtures/rainqa-ida-phl.json`); };
} else fetcher = net;

{
  const q = await Q.rainQA(IDA, SITE[0], SITE[1], fetcher);
  const row = (id) => q.rows.find(r => r.id === id), phl = row('PHL'), pne = row('PNE');
  console.log(`      ${mode}: ${q.rows.length} gauges, ${q.summary?.n ?? 0} scored, median ${q.summary?.median.toFixed(2)}; ` + q.rows.map(r => `${r.id} ${r.km.toFixed(1)} km ${(r.gaugeMM / 25.4).toFixed(2)} in${r.scored ? '' : ' (' + r.why + ')'}`).join(', '));
  check('Ida: New York time, report dates 1–3 Sep, nothing unreachable', q.tz === NY && q.dates.join() === '2021-09-01,2021-09-02,2021-09-03' && !q.errors.length, q.errors.join('; '));
  check('Ida: PHL (10 km) 1.88 in over the storm\'s hours ± 1 h, all 12 hours (2.37 in for the day: 0.5 in fell in the morning)', phl && phl.coverage === 1 && phl.hours === 12 && near(phl.gaugeMM / 25.4, 1.88, 0.005) && phl.scored, phl && `${(phl.gaugeMM / 25.4).toFixed(3)} in`);
  check('Ida: Northeast Philadelphia (PNE, 19 km) more than PHL', pne && pne.gaugeMM > phl.gaugeMM && pne.scored, pne && `${(pne.gaugeMM / 25.4).toFixed(2)} in`);
  const coco = q.rows.filter(r => r.kind === 'CoCoRaHS');
  check('Ida: CoCoRaHS gauges in Pennsylvania and New Jersey, each on its 2 Sep 7 am report (14 h beyond the storm)', coco.length >= 6 && coco.some(r => r.network === 'NJ_COCORAHS') && coco.filter(r => r.scored).every(r => r.days.join() === '2021-09-02' && near(r.extraH, 14, 1e-9)), `${coco.length} CoCoRaHS`);
  check('Ida: at most 12 gauges, nearest first, all within 25 km', q.rows.length <= 12 && q.rows.every((r, i) => r.km <= 25 && (!i || r.km >= q.rows[i - 1].km)));
  check('Ida: the gauges disagree several-fold over 25 km (the storm\'s real spread), the median sits between', q.summary.n >= 6 && q.summary.max / q.summary.min > 2 && q.summary.median > q.summary.min && q.summary.median < q.summary.max, `range ${q.summary.min.toFixed(2)}–${q.summary.max.toFixed(2)}`);
  const own = await Q.rainQA({ ...IDA, source: 'ASOS 1-minute gauge PHL' }, SITE[0], SITE[1], fetcher);
  check('Ida: a storm built from the PHL gauge does not score PHL', own.sourceGauge === 'PHL' && !own.rows.find(r => r.id === 'PHL').scored);
  fetcher.save?.();
}

console.log(fails ? `\n${fails} FAILED` : '\nall rain QA tests passed');
process.exit(fails ? 1 : 0);
