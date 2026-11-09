// Radar fitted to rain gauges (src/raingauge.js): NWIS rain parsed in mm, a gauge's hours, gauges left out (short
// record, too little rain) or capped, the leave-one-out choice (the radar stands when no fit beats it; hour by hour when
// the gauges agree on a core the radar reads low), the factor near and far from the gauges, and the fit applied to the
// frames and totals but not the radar's own grid.
// Usage: node tests/run-raingauge-tests.mjs
import { parseRain, gaugeHours, fitRadar, applyFit, growBox } from '../src/raingauge.js';
import { pixelWindow, sampleWeights } from '../src/mrms.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const H = 3600e3, T0 = Date.UTC(2025, 5, 12, 18), ends = [T0 + H, T0 + 2 * H, T0 + 3 * H];

// ---- NWIS JSON: inches per 5 minutes, the equipment-malfunction value dropped
{
  const ts = (site, lon, lat, vals) => ({ sourceInfo: { siteName: 'CRN-' + site + ' RAINGAGE AT TEST', siteCode: [{ value: site }], geoLocation: { geogLocation: { longitude: lon, latitude: lat } } },
    values: [{ value: vals.map(([t, v]) => ({ dateTime: new Date(t).toISOString(), value: String(v) })) }] });
  const g = parseRain({ value: { timeSeries: [ts('47', -80.76, 35.2, [[T0 + 5 * 60e3, 0.1], [T0 + 10 * 60e3, -999999], [T0 + 15 * 60e3, 0]])] } });
  check('NWIS rain: inches to mm, missing values dropped', g.length === 1 && g[0].mm.length === 2 && near(g[0].mm[0], 2.54, 1e-9) && g[0].site === '47');
  const box = growBox([-80.8, 35.1, -80.7, 35.2], 5);
  check('a box grown by 5 km', near((35.1 - box[1]) * 111.32, 5, 1e-6) && box[0] < -80.8 && box[2] > -80.7);
}

// ---- a gauge's hours: (end − 1 h, end]; an hour with no reading is NaN
{
  const g = { t: [T0 + 60e3, T0 + H, T0 + H + 60e3], mm: [1, 2, 4] };
  const h = gaugeHours(g, ends);
  check('gauge hours: a reading on the hour belongs to the hour it ends', h[0] === 3 && h[1] === 4 && Number.isNaN(h[2]), Array.from(h).join());
}

// a 0.4° window (about 40 km) of radar raining 10 mm an hour for 3 hours: 30 mm everywhere
const win = pixelWindow([-81.0, 35.0, -80.6, 35.4]), N = win.nx * win.ny;
const hours = ends.map(end => { const g = new Float32Array(N).fill(10); return { end, radar: g, total: g }; });
const every5 = (lon, lat, mmPerHour, site, { hoursOn = 3 } = {}) => {
  const t = [], mm = []; for (let k = 1; k <= 12 * hoursOn; k++) { t.push(T0 + k * 5 * 60e3); mm.push(mmPerHour / 12); }
  return { site, name: 'CRN-' + site + ' RAINGAGE AT TEST', lon, lat, t, mm };
};
const cLon = -80.8, cLat = 35.2;

const px = (lon, lat) => Math.round((win.lat0 - lat) / win.step - 0.5) * win.nx + Math.round((lon - win.lon0) / win.step - 0.5);

// ---- gauges left out or capped; one gauge alone cannot be checked, so the radar stands
{
  const short = every5(cLon + 0.05, cLat, 20, 'S', { hoursOn: 1 }); // reported in 1 of 3 wet hours
  const big = every5(cLon - 0.05, cLat, 200, 'B'); // 600 mm against 30: capped
  const F0 = fitRadar(hours.map(h => ({ ...h, total: new Float32Array(N).fill(1) })), win, [every5(cLon, cLat + 0.05, 0, 'D')], sampleWeights);
  check('a gauge with too little rain in both says nothing', F0.n === 0 && F0.factors === null && /under/.test(F0.gauges[0].why), F0.gauges[0].why);
  const F = fitRadar(hours, win, [short, big], sampleWeights);
  const s = F.gauges.find(g => g.site === 'S'), b = F.gauges.find(g => g.site === 'B');
  check('a gauge that missed most wet hours is left out', !s.used && /1 of the 3/.test(s.why), s.why);
  check('a gauge far off the radar is capped at 3×', b.used && /capped at 3×/.test(b.why), b.why);
  check('one usable gauge: nothing to check it against, the radar stands', F.n === 1 && F.factors === null && F.mode === null);
}

// ---- gauges that disagree at random (cells smaller than their spacing): no fit beats the radar, which stands
{
  const g = [every5(cLon, cLat, 20, 'U1'), every5(cLon + 0.03, cLat, 5, 'U2'), every5(cLon, cLat + 0.03, 20, 'U3'), every5(cLon + 0.03, cLat + 0.03, 5, 'U4')];
  const F = fitRadar(hours, win, g, sampleWeights);
  check('gauges that disagree: the radar stands, and the record says how close it was', F.n === 4 && F.factors === null && F.rmse.fitted === F.rmse.radar && F.candidates.length === 12,
    `best candidate ${Math.min(...F.candidates.map(c => c.rmse)).toFixed(1)} mm against radar ${F.rmse.radar.toFixed(1)} mm`);
}

// ---- a cloudburst core the radar reads low in hour 2 only: four gauges around it agree, so the hourly fit wins
{
  const core = (lon, lat, site) => { const t = [], mm = []; for (let k = 1; k <= 36; k++) { t.push(T0 + k * 5 * 60e3); mm.push((k > 12 && k <= 24 ? 30 : 10) / 12); } return { site, name: 'CRN-' + site + ' RAINGAGE AT TEST', lon, lat, t, mm }; };
  const g = [core(cLon, cLat, 'C1'), core(cLon + 0.03, cLat, 'C2'), core(cLon, cLat + 0.03, 'C3'), core(cLon + 0.03, cLat + 0.03, 'C4')];
  const F = fitRadar(hours, win, g, sampleWeights), p = px(cLon + 0.015, cLat + 0.015), far = px(-80.62, 35.02);
  check('a core the radar reads low: fitted hour by hour, chosen by leave-one-out', F.mode === 'hourly' && F.rmse.fitted < F.rmse.radar / 3, `${F.mode}, d0 ${F.d0Km} km: ${F.rmse.fitted.toFixed(2)} against ${F.rmse.radar.toFixed(2)} mm`);
  const r2 = (30 + 1) / (10 + 1);
  check('between the gauges: hour 2 about 2.8×, hours 1 and 3 about 1', near(F.factors[1][p], r2, 0.15) && near(F.factors[0][p], 1, 0.06) && near(F.factors[2][p], 1, 0.06), `${F.factors[1][p].toFixed(2)}, ${F.factors[0][p].toFixed(2)}`);
  check('25 km from the gauges the pull has faded well below theirs', F.factors[1][far] < 1 + (r2 - 1) / 3, `${F.factors[1][far].toFixed(2)} 25 km away`);
  const c1 = F.gauges.find(x => x.site === 'C1');
  check('a gauge’s wettest hour, the radar there and the fit from the others', c1.peak.gaugeMM === 30 && near(c1.peak.radarMM, 10, 1e-4) && c1.peak.looMM > 25, JSON.stringify(c1.peak));
  const rr = { frames: Array.from({ length: 90 }, () => new Float32Array(N).fill(1)), hours: hours.map(h => ({ ...h })) };
  applyFit(rr, F.factors);
  check('each hour’s frames and total take that hour’s field; the radar grid is untouched', near(rr.frames[45][p], F.factors[1][p], 1e-6) && near(rr.frames[10][p], F.factors[0][p], 1e-6) &&
    near(rr.hours[1].total[p], 10 * F.factors[1][p], 1e-4) && rr.hours[1].radar[p] === 10);
}

// ---- a storm the radar misses by a factor everywhere (Charlotte, January 2024): the storm-wide bias first, because the
// hourly factors alone stop at 3×; kept only when it clearly beats the plain fit (the core above stays plain)
{
  const g = [every5(cLon, cLat, 35, 'W1'), every5(cLon + 0.04, cLat, 33, 'W2'), every5(cLon, cLat + 0.04, 37, 'W3'), every5(cLon + 0.04, cLat + 0.04, 35, 'W4'), every5(cLon + 0.02, cLat - 0.03, 34, 'W5')];
  const F = fitRadar(hours, win, g, sampleWeights), p = px(cLon + 0.02, cLat + 0.02);
  check('a radar 3.5× low everywhere: the storm-wide correction is kept and recorded', near(F.bias, 3, 0.01) && F.mode !== null, `bias ${F.bias?.toFixed(2)} (its cap), ${F.mode}, d0 ${F.d0Km}`);
  check('…and the rain among the gauges reaches theirs, past the hourly cap of 3×', near(F.factors[1][p] * 10, 35, 1.5), `${(F.factors[1][p] * 10).toFixed(1)} mm in the hour against 35`);
  const g2 = [every5(cLon, cLat, 22, 'X1'), every5(cLon + 0.04, cLat, 21, 'X2'), every5(cLon, cLat + 0.04, 23, 'X3'), every5(cLon + 0.04, cLat + 0.04, 22, 'X4'), every5(cLon + 0.02, cLat - 0.03, 24, 'X5')];
  const F2 = fitRadar(hours, win, g2, sampleWeights), q = F2.gauges.find(x => x.site === 'X5');
  check('a radar 2.2× low: each gauge predicted from the others and their bias', near(F2.bias ?? 0, 2.2, 0.05) && q.looMM > 55, `bias ${F2.bias?.toFixed(2)}, left-out gauge ${q.looMM.toFixed(1)} mm where it caught 72 and the radar had 30`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall rain-gauge tests passed');
process.exit(fails ? 1 : 0);
