// The soil's starting wetness from the rain of the 5 days before a historic storm (src/antecedent.js): the NRCS classes
// by season, a gauge that stopped reporting left out, the gauges' median, and the gridded record when no gauge reported.
// Usage: node tests/run-antecedent-tests.mjs
import { amcClass, gaugeTotal, antecedentRain, growingSeason } from '../src/antecedent.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const H = 3600e3, D = 24 * H, jan = Date.UTC(2024, 0, 9, 4), jun = Date.UTC(2025, 5, 12, 17);

check('January is dormant, June growing', !growingSeason(jan) && growingSeason(jun) && growingSeason(Date.UTC(2025, 3, 1)) && !growingSeason(Date.UTC(2025, 10, 1)));
{
  const c = (mm, t) => amcClass(mm, t).wetness;
  check('dormant: under 0.5 in dry, 0.5–1.1 in normal, over 1.1 in wet', c(12, jan) === 'dry' && c(13, jan) === 'normal' && c(27.94, jan) === 'normal' && c(29.2, jan) === 'wet');
  check('growing: under 1.4 in dry, 1.4–2.1 in normal, over 2.1 in wet', c(23.1, jun) === 'dry' && c(36, jun) === 'normal' && c(54, jun) === 'wet');
  check('class and bounds reported', amcClass(29.2, jan).amc === 'III' && Math.abs(amcClass(0, jan).bounds[1] - 27.94) < 1e-9);
}
{
  const a = jan - 5 * D, b = jan, hourly = (mmEach, from = a, to = b) => { const t = [], mm = []; for (let x = from + H; x <= to; x += H) { t.push(x); mm.push(mmEach); } return { t, mm }; };
  check('a gauge reporting through the 5 days: its total', Math.abs(gaugeTotal(hourly(0.25), a, b) - 30) < 1e-9);
  check('…one that stopped a day early: left out', gaugeTotal(hourly(0.25, a, b - D), a, b) === null);
  check('…one that started late: left out', gaugeTotal(hourly(0.25, a + D, b), a, b) === null);
}

// the fetches, from canned answers: NWIS gauges first, the gridded record when none reported
{
  const lon = -80.7637, lat = 35.2045, a = jan - 5 * D;
  const series = (site, dLon, mmEach, to = jan) => { const values = []; for (let x = a + H; x <= to; x += H) values.push({ value: String(mmEach / 25.4), dateTime: new Date(x).toISOString() });
    return { sourceInfo: { siteCode: [{ value: site }], siteName: site, geoLocation: { geogLocation: { longitude: lon + dLon, latitude: lat } } }, values: [{ value: values }] }; };
  const nwis = (ts) => async (u) => (u.includes('waterservices') ? { ok: true, json: async () => ({ value: { timeSeries: ts } }) } : { ok: false, status: 500 });
  const r = await antecedentRain(lon, lat, jan, nwis([series('A', 0.001, 0.2), series('B', 0.02, 0.25), series('C', 0.04, 0.3), series('far', 0.2, 1), series('broken', 0.01, 1, jan - 2 * D)]));
  check('gauges: the median of those within 8 km that reported through', r.gauges.map(g => g.site).join() === 'A,B,C' && Math.abs(r.mm - 30) < 0.05 && r.wetness === 'wet' && /3 USGS rain gauges/.test(r.source), `${r.gauges.map(g => g.site)} ${r.mm} ${r.wetness}`);
  const iem = async (u) => {
    if (u.includes('waterservices')) return { ok: true, json: async () => ({ value: { timeSeries: [] } }) };
    const d = u.match(/hourly\/(\d{4}-\d{2}-\d{2})\//)[1], t0 = Date.parse(d + 'T00:00Z'), data = [];
    for (let k = 1; k <= 24; k++) data.push({ valid_utc: new Date(t0 + k * H).toISOString().slice(0, 16) + 'Z', hourly_precip_in: t0 + k * H <= jan - 3 * D && t0 + k * H > jan - 4 * D ? 0.01 : 0 });
    return { ok: true, json: async () => ({ data }) };
  };
  const g = await antecedentRain(lon, lat, jan, iem);
  check('no gauge: the gridded record over the 5 days', g.gauges.length === 0 && Math.abs(g.mm - 24 * 0.254) < 0.06 && g.wetness === 'dry' && /Reanalysis/.test(g.source), `${g.mm} ${g.source}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall antecedent tests passed');
process.exit(fails ? 1 : 0);
