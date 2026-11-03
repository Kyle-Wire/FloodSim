// Ungauged river inflow tests (src/streamstats.js): the StreamStats replies parsed (recorded for Wissahickon Creek at
// the Philadelphia gauge, 01474000, 2026-11-03), the whole workflow on those replies including the retry on the
// flowline when the point is off the stream grid, the 90 % interval, the NRCS lag, and the hydrograph: its peak, timing
// and volume against the 484 peak rate factor.
//   node tests/run-streamstats-tests.mjs [--live]   (--live: the real services for the same point)
import { readFileSync } from 'node:fs';
import * as SS from '../src/streamstats.js';
import { CFS } from '../src/inflow.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/streamstats/${f}`, import.meta.url), 'utf8'));
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const cfs = (q) => q / CFS;

{ // delineation replies
  const b = SS.parseDelineation(fx('delineate_wissahickon.json')), u = SS.parseDelineation(fx('delineate_unsnapped.json'));
  check('delineation: the basin, its point and HUC', b.snapped && b.state === 'PA' && near(b.areaKm2, 164.91, 1e-3) && b.huc === '02040203' && b.geometry?.type === 'MultiPolygon', `${b.areaKm2.toFixed(2)} km², ${b.state}`);
  check('delineation: a point off the stream grid is not taken as a basin', !u.snapped && /not snappable/.test(u.warning) && u.areaKm2 < 0.01, u.warning.slice(0, 50));
}
{ // characteristics, scenarios and peaks
  const tc = SS.timingCodes(fx('bclist.json'));
  check('timing characteristics the state offers', tc.imp?.code === 'LC11IMP' && tc.slope?.code === 'BSLOPD' && /deg/.test(tc.slope.unit) && tc.length === null);
  const body = SS.fillScenarios(fx('scenarios.json'), fx('bc.json'), fx('regions.json')), rg = body[0].regressionRegions[0], p = Object.fromEntries(rg.parameters.map(x => [x.code, x.value]));
  check('scenarios filled with the basin characteristics and area weight', p.DRNAREA === 63.7 && p.CARBON === 16.76 && rg.percentWeight === 100);
  check('return periods from NSS codes', SS.returnPeriodOf('PK1AEP') === 100 && SS.returnPeriodOf('PK0_2AEP') === 500 && SS.returnPeriodOf('PK50AEP') === 2 && SS.returnPeriodOf('PK100') === 100 && SS.returnPeriodOf('BFAREA') === null);
  const E = SS.parsePeaks(fx('estimate.json')), q100 = E.peaks.find(x => x.T === 100);
  check('peaks: eight return periods, Q100 = 12,300 cfs (PA SIR 2019-5094 region 4)', E.peaks.length === 8 && near(cfs(q100.q), 12300, 1e-9) && E.regions[0].name === 'Peak_Flow_Region_4_SIR_2019_5094' && !E.warnings.length);
  const sl = Math.sqrt(Math.log(1 + 0.315 ** 2)) / Math.LN10, f = 10 ** (1.6449 * sl);
  check('90 % interval from ASEp 31.5 %: × / ÷ 10^(1.645 Sl)', near(q100.hi / q100.q, f, 1e-9) && near(q100.q / q100.lo, f, 1e-9), `${cfs(q100.lo).toFixed(0)}–${cfs(q100.hi).toFixed(0)} cfs`);
  const i20 = SS.peakAt(E.peaks, 20), q10 = E.peaks.find(x => x.T === 10).q, q25 = E.peaks.find(x => x.T === 25).q;
  check('a return period between the published ones: log-log', i20.interpolated && i20.q > q10 && i20.q < q25 && near(Math.log(i20.q), Math.log(q10) + (Math.log(20 / 10) / Math.log(25 / 10)) * Math.log(q25 / q10), 1e-12) && SS.peakAt(E.peaks, 1000) === null);
  const off = SS.parsePeaks(fx('estimate.json').map(s => ({ ...s, regressionRegions: s.regressionRegions.map(r => ({ ...r, parameters: r.parameters.map(x => (x.code === 'DRNAREA' ? { ...x, value: 900 } : x)) })) })));
  check('a characteristic outside the equations\' range is flagged', off.warnings.length === 1 && /Drainage Area 900/.test(off.warnings[0]));
}
{ // timing and the hydrograph
  const L = SS.nrcsLag({ areaKm2: 0.1, slopePct: 4, cn: 80, lengthFt: 1000 });
  check('NRCS lag: l^0.8 (S+1)^0.7 / (1900 Y^0.5)', near(L.lagH, 1000 ** 0.8 * 3.5 ** 0.7 / 3800, 1e-12) && near(L.tcH, L.lagH / 0.6, 1e-12) && !L.warnings.length, `${(L.lagH * 60).toFixed(2)} min`);
  const W = SS.nrcsLag({ areaKm2: 164.98, slopePct: 100 * Math.tan(2.942 * Math.PI / 180), cn: SS.cnFromImpervious(16.2226) });
  check('Wissahickon timing: lag from 209 A^0.6, with the size warning', W.lagH > 5 && W.lagH < 10 && /2,000 acres/.test(W.warnings[0]) && /209/.test(W.lengthFrom), `lag ${W.lagH.toFixed(1)} h, CN ${SS.cnFromImpervious(16.2226).toFixed(1)}`);
  check('the DUH table carries the 484 peak rate factor', near(SS.DUH_AREA, 645.33 / 484, 0.003), SS.DUH_AREA.toFixed(4));
  const qp = 348.3, tp = W.tpH * 3600, tPeak = 12 * 3600 + W.lagH * 3600, base = 0.05 * qp, f = SS.ungaugedHydrograph(qp, { tPeak, tp, base });
  let vol = 0, max = 0, tMax = 0; const dt = 5;
  for (let t = 0; t < tPeak + 6 * tp; t += dt) { const q = f(t); vol += (q - base) * dt; if (q > max) { max = q; tMax = t; } }
  check('hydrograph: the peak reproduced at its time', near(f(tPeak), qp, 1e-12) && Math.abs(tMax - tPeak) <= dt && near(f(0), base, 1e-12));
  check('hydrograph: volume above the base = (Qp − base)·tp·645.33/484', near(vol, SS.runoffVolume(qp - base, tp), 0.003) && near(vol, f.volume, 1e-4), `${(vol / 1e6).toFixed(2)} hm³ = ${(vol / 164.98e6 * 1000).toFixed(1)} mm over the basin`);
}
{ // the whole workflow on the recorded replies: the entry point is off the grid, the flowline snaps it
  const seen = [];
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const fetcher = async (url, o = {}) => {
    seen.push({ url, body: o.body ? JSON.parse(o.body) : null });
    if (url.includes('/delineate/')) return reply(url.includes('lon=-75.206380') ? fx('delineate_unsnapped.json') : fx('delineate_wissahickon.json')); // the entry point is 44 m off the stream
    if (url.includes('regressionregions/bylocation')) return reply(fx('regions.json'));
    if (url.includes('nssservices/scenarios/estimate')) return reply(fx('estimate.json'));
    if (url.includes('nssservices/scenarios')) return reply(fx('scenarios.json'));
    if (url.endsWith('/basin-characteristics/PA')) return reply(fx('bclist.json'));
    if (url.includes('basin-characteristics/calculate')) return reply(fx('bc.json'));
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  };
  const line = [[-75.2069, 40.0145], [-75.2069, 40.0155]], steps = [];
  const r = await SS.streamStatsPeaks(-75.20638, 40.01503, fetcher, { state: 'PA', flowline: line, progress: (t) => steps.push(t) });
  const dels = seen.filter(s => s.url.includes('/delineate/')), bc = seen.find(s => s.url.includes('calculate')), est = seen.find(s => s.url.includes('estimate'));
  check('workflow: off the grid, retried on the flowline', dels.length === 2 && near(r.snappedM, 44, 0.1) && /retrying/.test(steps.join(' ')), `${Math.round(r.snappedM)} m`);
  check('workflow: the characteristics asked for (equations + timing)', bc.body.bcrequest.bcLabels.split(';').sort().join() === 'BSLOPD,CARBON,DRNAREA,LC11IMP' && bc.body.bcrequest.wsresp);
  check('workflow: the estimate posted with the basin\'s values', est.body[0].regressionRegions[0].parameters.find(p => p.code === 'DRNAREA').value === 63.7);
  check('workflow: area, impervious share, slope in percent, peaks', near(r.areaKm2, 63.7 * 2.589988, 1e-9) && near(r.imperviousPct, 16.2226, 1e-9) && near(r.slopePct, 100 * Math.tan(2.942 * Math.PI / 180), 1e-9) && r.peaks.length === 8,
    `${r.areaKm2.toFixed(1)} km², ${r.imperviousPct.toFixed(1)} % impervious, ${r.slopePct.toFixed(2)} % slope`);
  let threw = null; try { await SS.streamStatsPeaks(-75.20638, 40.01503, fetcher, { state: 'PA' }); } catch (e) { threw = e.message; }
  check('workflow: no flowline to snap to, a clear error', /could not place the point/.test(threw ?? ''));
}

{ // the report section (app/report-inflow.js) from a run record's inflow
  const { inflowSection } = await import('../app/report-inflow.js');
  const E = SS.parsePeaks(fx('estimate.json')), pk = E.peaks.find(p => p.T === 100), f = SS.ungaugedHydrograph(pk.q, { tPeak: 6 * 3600, tp: 3 * 3600 });
  const rec = { inflow: [
    { name: 'Wissahickon Creek', label: 'ungauged', site: 'streamstats', scale: 1, series: Array.from({ length: 145 }, (_, k) => [k * 300, f(k * 300)]),
      ungauged: { source: 'USGS StreamStats regression', how: 'USGS StreamStats PA', T: 100, peak: pk.q, lo: pk.lo, hi: pk.hi, areaKm2: 165, lagH: 7.7, runoffMm: 60, rainMm: 210, warnings: ['the basin is 16 % impervious'],
        peaks: E.peaks, regions: E.regions.map(g => ({ name: g.name, code: g.code, weight: 100, params: g.params })) } },
    { name: 'Gauged Run', label: 'gauge', site: '01474000', scale: 0.9, series: [[0, 1], [300, 2]], ungauged: null }] };
  const u = { q: 'm³/s', Q: (v) => v, dpQ: 3 }, sec = inflowSection({ runs: [['after', rec]], A: null, theme: 'light', size: {}, u, tag: () => 'Run' });
  const t = Object.fromEntries(sec.tables.map(x => [x.name, x]));
  check('report: hydrographs, the peak-flow chart and tables', sec.id === 'inflow' && sec.figures.length === 2 && t.inflow_entries.rows.length === 2 && t.inflow_peak_flows.rows.length === 8
    && t.inflow_peak_flows.rows.find(r => r.used).T === 100 && near(t.inflow_entries.rows[0].peak, pk.q, 1e-3) && t.inflow_basin_characteristics.rows.length === 2 && /16 % impervious/.test(sec.note));
  check('report: no inflow, no section', inflowSection({ runs: [['after', { inflow: [] }]], A: null, theme: 'light', size: {}, u, tag: () => 'Run' }) === null);
}

if (process.argv.includes('--live')) {
  const fetcher = (url, o = {}) => fetch(url, { method: o.method ?? 'GET', body: o.body, headers: { 'user-agent': 'FloodSim/0.1 (tests)', ...(o.contentType ? { 'content-type': o.contentType } : {}) }, signal: AbortSignal.timeout(180e3) });
  const t0 = Date.now(), r = await SS.streamStatsPeaks(-75.20694, 40.01483, fetcher, { progress: (t) => console.log('      ' + t) });
  const q = r.peaks.find(p => p.T === 100);
  check('live: Wissahickon Creek at the Philadelphia gauge (01474000, 64.0 mi² in NWIS)', r.state === 'PA' && near(r.areaKm2 / 2.589988, 64, 0.03) && cfs(q.q) > 5000 && cfs(q.q) < 30000,
    `${(r.areaKm2 / 2.589988).toFixed(1)} mi², Q100 ${cfs(q.q).toFixed(0)} cfs (${cfs(q.lo).toFixed(0)}–${cfs(q.hi).toFixed(0)}), ${r.imperviousPct?.toFixed(1)} % impervious, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall streamstats tests passed');
process.exit(fails ? 1 : 0);
