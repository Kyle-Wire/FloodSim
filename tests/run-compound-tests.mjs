// Compound flooding tests (src/compound.js): SLR curves moved to the tidal datum epoch, station datums on NAVD88, NOAA
// extreme water levels, the design tide (still, tide cycle, predicted), GEV and Kendall's τ, the Gumbel copula (its τ
// from simulation, independence, conditionals), AND isolines, the conditional samples and the joint design events.
//   node tests/run-compound-tests.mjs [--live]   (--live: Philadelphia's SLR, datums, extremes and the joint analysis)
import { readFileSync } from 'node:fs';
import * as C from '../src/compound.js';
import { compoundSection } from '../app/report-compound.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fx = JSON.parse(readFileSync(new URL('./fixtures/coops-8545240.json', import.meta.url), 'utf8'));
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; }; // LCG, reproducible

{ // datums, SLR, extremes from the Philadelphia fixture
  const d = C.stationDatums(fx.datums);
  check('datums: MHHW, MLLW, DTL on NAVD88 (station datum − NAVD88 2.110), epoch 1983–2001', d.datum === 'NAVD88' && near(d.mhhw, 1.094, 1e-9) && near(d.mllw, -0.945, 1e-9) && near(d.dtl, 0.074, 1e-9) && d.epochMid === 1992,
    `MHHW ${d.mhhw.toFixed(3)} m, MLLW ${d.mllw.toFixed(3)} m NAVD88`);
  const s = C.slrCurves(fx.slr_projections, fx.slr_projectionOffsets, d.epochMid);
  // NOAA's projections are 0 in 2005; offsets: 1992 → 2000 3 cm, 2000 → 2005 2 cm, so 2005 is 5 cm above the epoch
  check('SLR: the projections moved to the datum epoch with NOAA\'s offsets (2005 = +5 cm)', near(C.slrAt(s, 'Intermediate', 2005), 0.05, 1e-9) && near(C.slrAt(s, 'Intermediate', 2000), 0.03, 1e-9) && near(C.slrAt(s, 'Intermediate', 1992), 0, 1e-9));
  check('SLR: Intermediate 2050 = 38 + 5 cm, 2100 = 116 + 5 cm; High 2100 = 199 + 5 cm', near(C.slrAt(s, 'Intermediate', 2050), 0.43, 1e-9) && near(C.slrAt(s, 'Intermediate', 2100), 1.21, 1e-9) && near(C.slrAt(s, 'High', 2100), 2.04, 1e-9),
    `Int 2050 ${C.slrAt(s, 'Intermediate', 2050).toFixed(2)} m, 2100 ${C.slrAt(s, 'Intermediate', 2100).toFixed(2)} m`);
  check('SLR: linear between projection years, the background rate before the epoch', near(C.slrAt(s, 'Intermediate', 2040), (0.24 + 0.43) / 2, 1e-9) && near(C.slrAt(s, 'Low', 1982), -10 * s.background, 1e-9),
    `2040 ${C.slrAt(s, 'Intermediate', 2040).toFixed(3)} m (2030 and 2050 kept in the fixture)`);
  check('SLR: the report\'s 2000 baseline is 3 cm above the epoch', near(s.from2000, 0.03, 1e-9));
  const L = C.ewlLevels(fx.extremewaterlevels);
  check('EWL: NOAA levels above MHHW, exact at a listed return period, log-linear between', near(C.ewlAt(L, 100), L.find(e => e.rp === 100).level, 1e-12) && C.ewlAt(L, 70) > C.ewlAt(L, 50) && C.ewlAt(L, 70) < C.ewlAt(L, 100),
    `100-yr ${C.ewlAt(L, 100)} m above MHHW`);
}

{ // design tide
  const d = C.stationDatums(fx.datums), peakS = 6 * 3600;
  const still = C.designTide(d, { mode: 'still', surge: 0.5, slr: 0.2 });
  check('design tide: still level = MHHW + surge + rise, throughout', still.v.every(v => near(v, d.mhhw + 0.7, 1e-12)) && still.datum === 'NAVD88');
  const cyc = C.designTide(d, { mode: 'cycle', peakS, startS: 0, endS: 24 * 3600, stepS: 60 }), at = (wl, s) => wl.v[wl.t.indexOf(s * 1000)];
  const half = Math.round(C.M2_HOURS * 1800 / 60) * 60;
  check('design tide: cycle reaches MHHW at the rain peak and MLLW half an M2 period later', near(at(cyc, peakS), d.mhhw, 1e-9) && near(at(cyc, peakS + half), d.mllw, 1e-4) && Math.max(...cyc.v) <= d.mhhw + 1e-12,
    `${at(cyc, peakS).toFixed(3)} m at the peak, ${at(cyc, peakS + half).toFixed(3)} m at +6.2 h`);
  const low = C.designTide(d, { mode: 'cycle', phase: 'low', peakS, startS: 0, endS: 24 * 3600, stepS: 60, surge: 0.3 });
  check('design tide: low water at the peak, surge added', near(at(low, peakS), d.mllw + 0.3, 1e-9));
  // a prediction: a 12 h sine on NAVD88 with high water at 2021-09-02 03:00 UTC
  const hw = Date.UTC(2021, 8, 2, 3), pred = { t: [], v: [] }; for (let ms = hw - 3 * 864e5; ms <= hw + 3 * 864e5; ms += 36e4) { pred.t.push(ms); pred.v.push(0.1 + Math.cos(2 * Math.PI * (ms - hw) / 432e5)); }
  const pr = C.designTide(d, { mode: 'predicted', pred, predAt: Date.UTC(2021, 8, 2, 5), peakS, startS: 0, endS: 12 * 3600, slr: 0.4 });
  check('design tide: predicted tide shifted so its nearest high water is at the rain peak, plus the rise', near(at(pr, peakS), 1.1 + 0.4, 1e-9) && near(at(pr, peakS + 6 * 3600), -0.9 + 0.4, 1e-9) && pr.design.tideAt === '2021-09-02 03:00 UTC');
}

{ // GEV, Kendall's τ, the Gumbel copula
  const g = { xi: 50, alpha: 15, k: -0.1 };
  check('GEV: quantile and CDF invert each other; density is the CDF\'s slope', [0.1, 0.5, 0.9, 0.99].every(F => near(C.gevCdf(g, C.gevInv(g, F)), F, 1e-12)) && near(C.gevPdf(g, 80), (C.gevCdf(g, 80 + 1e-4) - C.gevCdf(g, 80 - 1e-4)) / 2e-4, 1e-7));
  const xs = Array.from({ length: 4000 }, () => C.gevInv(g, rnd())), f = C.fitGEV(xs);
  check('GEV: L-moment fit recovers the parameters of 4,000 draws', near(f.xi, 50, 1) && near(f.alpha, 15, 0.8) && near(f.k, -0.1, 0.04), `ξ ${f.xi.toFixed(2)} α ${f.alpha.toFixed(2)} k ${f.k.toFixed(3)}`);
  check('Kendall: 1 for a monotone pair, −1 reversed, 2/3 for (1,2,3,4) vs (1,3,2,4)', near(C.kendallTau([1, 2, 3], [4, 5, 9]).tau, 1, 1e-12) && near(C.kendallTau([1, 2, 3], [3, 2, 1]).tau, -1, 1e-12) && near(C.kendallTau([1, 2, 3, 4], [1, 3, 2, 4]).tau, 2 / 3, 1e-12));
  check('Gumbel: θ = 1 is independence (C = uv, the conditional is v, density 1)', near(C.gumbelC(0.3, 0.6, 1), 0.18, 1e-12) && near(C.gumbelCondU(0.3, 0.6, 1), 0.6, 1e-12) && near(C.gumbelDensity(0.3, 0.6, 1), 1, 1e-12) && C.gumbelTheta(-0.2) === 1);
  const th = C.gumbelTheta(0.5), u = 0.7, v = 0.4, e = 1e-6;
  check('Gumbel: θ from τ, the conditional is ∂C/∂u, the density is ∂²C/∂u∂v', th === 2 && near(C.gumbelCondU(u, v, th), (C.gumbelC(u + e, v, th) - C.gumbelC(u - e, v, th)) / (2 * e), 1e-7) &&
    near(C.gumbelDensity(u, v, th), (C.gumbelCondU(u, v + e, th) - C.gumbelCondU(u, v - e, th)) / (2 * e), 1e-5));
  // draws by the conditional method: u, then v from P(V ≤ v | U = u) = w
  const bis = (fn, a, b) => { for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (fn(m) < 0) a = m; else b = m; } return (a + b) / 2; };
  const U = [], V = []; for (let i = 0; i < 1500; i++) { const uu = rnd(), w = rnd(); U.push(uu); V.push(bis(vv => C.gumbelCondU(uu, vv, th) - w, 1e-12, 1 - 1e-12)); }
  const kt = C.kendallTau(U, V).tau;
  check('Gumbel: 1,500 draws with θ = 2 have Kendall\'s τ = 1 − 1/θ = 0.5', near(kt, 0.5, 0.03), `τ ${kt.toFixed(3)}`);
  const iso = C.isolineUV(1, 100);
  check('isoline: AND exceedance 1 % along it; under independence (1 − u)(1 − v) = 0.01', iso.every(([a, b]) => near(C.andExceed(a, b, 1), 0.01, 1e-9) && near((1 - a) * (1 - b), 0.01, 1e-9)));
  check('isoline: dependence moves it out (both higher together)', C.isolineUV(2, 100).every(([a, b]) => b > 1 - 0.01 / (1 - a) - 1e-9));
}

{ // conditional samples and the joint design events
  const days = (y) => Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(y, 0, 1 + i)).toISOString().slice(0, 10));
  const rain = [], wl = {};
  for (const y of [2001, 2002]) for (const date of days(y)) { rain.push({ date, mm: 1 }); wl[date] = 0.1; }
  rain.find(r => r.date === '2001-07-10').mm = 80; wl['2001-07-11'] = 0.6; wl['2001-11-02'] = 0.9; rain.find(r => r.date === '2001-11-01').mm = 20;
  rain.find(r => r.date === '2002-03-03').mm = 60; wl['2002-03-03'] = 1.1;
  const cp = C.conditionalPairs(rain, wl);
  check('conditional samples: wettest day with the highest water within a day; highest water with the most rain within a day',
    cp.years === 2 && JSON.stringify(cp.pairsRain.map(p => p.slice(0, 2))) === JSON.stringify([[80, 0.6], [60, 1.1]]) && JSON.stringify(cp.pairsWL.map(p => p.slice(0, 2))) === JSON.stringify([[20, 0.9], [60, 1.1]]));
  check('ACIS daily: trace = 0, inches → mm, missing and accumulated = null', JSON.stringify(C.parseAcisDaily([['d', 'T'], ['d', '1.00'], ['d', 'M'], ['d', '0.50A']]).map(r => r.mm)) === JSON.stringify([0, 25.4, null, null]));

  // synthetic record: rain AM ~ GEV(60, 20, −0.1), water AM ~ GEV(0.6, 0.18, 0.05); concurrent values from a Gumbel θ = 1.5
  const rG = { xi: 60, alpha: 20, k: -0.1 }, wG = { xi: 0.6, alpha: 0.18, k: 0.05 }, cR = { xi: 0.3, alpha: 0.15, k: 0.05 }, cW = { xi: 15, alpha: 12, k: -0.1 };
  const bis = (fn, a, b) => { for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (fn(m) < 0) a = m; else b = m; } return (a + b) / 2; };
  const draw = (th) => { const uu = rnd(), w = rnd(); return [uu, bis(vv => C.gumbelCondU(uu, vv, th) - w, 1e-12, 1 - 1e-12)]; };
  const mk = (th) => {
    const pairsRain = [], pairsWL = [];
    for (let i = 0; i < 400; i++) { const [a, b] = draw(th); pairsRain.push([C.gevInv(rG, a), C.gevInv(cR, b)]); const [c, d] = draw(th); pairsWL.push([C.gevInv(cW, d), C.gevInv(wG, c)]); }
    return C.jointAnalysis({ rainAM: Array.from({ length: 400 }, () => C.gevInv(rG, rnd())), wlAM: Array.from({ length: 400 }, () => C.gevInv(wG, rnd())), pairsRain, pairsWL });
  };
  const dep = mk(1.5), ind = mk(1);
  const rc = (J) => J.design.find(p => p.key === 'rain-cond');
  check('joint: τ of each sample estimated (θ = 1.5 → τ 0.33)', near(dep.samples.rain.tau, 1 / 3, 0.06) && near(dep.samples.wl.tau, 1 / 3, 0.06), `τ ${dep.samples.rain.tau.toFixed(3)} / ${dep.samples.wl.tau.toFixed(3)}`);
  check('joint: 100-yr rain with its median water: rain at its 100-yr, water above the independent median', near(rc(dep).rainT, 100, 1e-6) && rc(dep).wlM > rc(ind).wlM && near(rc(ind).wlM, C.gevInv(cR, 0.5), 0.03),
    `water ${rc(dep).wlM.toFixed(2)} m (dependent) vs ${rc(ind).wlM.toFixed(2)} m (about independent)`);
  const lk = dep.design.find(p => p.key === 'rain-likely');
  check('joint: the most likely 100-yr event is on the 100-yr isoline, below each marginal 100-yr', lk && lk.andT === 100 && lk.rainMM < C.gevInv(dep.rain, 0.99) && dep.isolines[100].rain.length > 10 && dep.isolines[10].wl.length > 10);

  // the report section (app/report-compound.js) from the fixture's station data, this joint fit and a run with a design tide
  const d = C.stationDatums(fx.datums), slr = C.slrCurves(fx.slr_projections, fx.slr_projectionOffsets, d.epochMid), levels = C.ewlLevels(fx.extremewaterlevels);
  const dt = C.designTide(d, { mode: 'cycle', peakS: 6 * 3600, startS: -3600, endS: 30 * 3600, surge: 0.5, slr: 0.43 });
  const rec = { tide: { station: '8545240', name: 'Philadelphia', datum: 'NAVD88', kind: 'design', design: { ...dt.design, surge: 'surge 0.50 m', slr: { scenario: 'Intermediate', year: 2050, m: 0.43 } }, mhhw: d.mhhw,
    pts: dt.t.map((t, i) => [t / 1000, dt.v[i]]), peak: Math.max(...dt.v), edgeCells: 12, rainPeakS: 6 * 3600 } };
  const data = { station: '8545240', name: 'Philadelphia', datums: d, slr, ewl: { levels, trendMmYr: 3.15, years: 124 }, joint: { ...dep, gauge: { name: 'Synthetic', km: 0 }, station: '8545240', pairYears: 400, rainYears: 400, wlSource: 'synthetic' },
    set: { slr: { scenario: 'Intermediate', year: 2050, m: 0.43 } } };
  const sec = compoundSection({ runs: [['after', rec]], theme: 'light', size: {}, u: { len: 'm', L: (m) => m, dpL: 2 }, tag: () => 'Run', data });
  const svgOK = sec?.figures.every(f => /^<svg[\s\S]*<\/svg>$/.test(f.svg) && !/NaN/.test(f.svg));
  const slrRow = sec?.tables.find(t => t.name === 'slr_scenarios')?.rows.find(r => r.scenario === 'Intermediate');
  check('report: SLR, joint isoline and run water-level figures; the SLR table on MHHW', sec && ['slr_mhhw', 'joint_isolines', 'run_water_level'].every(n => sec.figures.some(f => f.name === n)) && svgOK &&
    near(slrRow.r2050, 0.43, 1e-9) && near(slrRow.m2100, d.mhhw + 1.21, 1e-9) && near(slrRow.s2100, 1.18, 1e-9) && sec.tables.find(t => t.name === 'joint_design_pairs').rows.length === 4,
    `${sec?.figures.length} figures, ${sec?.tables.length} tables`);
  check('report: no section without a tide gauge or a run water level', compoundSection({ runs: [['after', {}]], theme: 'light', size: {}, u: { len: 'm', L: (m) => m, dpL: 2 }, tag: () => 'Run', data: null }) === null);
}

if (process.argv.includes('--live')) {
  const fetcher = (url, o = {}) => fetch(url, { method: o.method ?? 'GET', body: o.body, headers: { 'user-agent': 'FloodSim/0.1 (tests)', ...(o.contentType ? { 'content-type': o.contentType } : {}) } });
  const info = await C.fetchTideInfo('8545240', fetcher), d = info.datums;
  check('live: Philadelphia datums, SLR and extremes', d.datum === 'NAVD88' && info.slr && info.ewl?.levels.length > 10 && info.ewl.annual.length > 100,
    `MHHW ${d.mhhw.toFixed(3)} m NAVD88; SLR Int 2050 ${C.slrAt(info.slr, 'Intermediate', 2050).toFixed(2)} m, 2100 ${C.slrAt(info.slr, 'Intermediate', 2100).toFixed(2)} m since ${d.epochMid}; 100-yr ${C.ewlAt(info.ewl.levels, 100)} m above MHHW`);
  const J = await C.fetchJoint(-75.150, 39.942, info, fetcher);
  check('live: joint analysis (ACIS rain + CO-OPS highs)', J.pairYears >= 20, `${J.gauge.name} ${J.gauge.km.toFixed(1)} km, ${J.rainYears} rain years, ${J.pairYears} paired years; τ rain-driven ${J.samples.rain.tau.toFixed(2)}, surge-driven ${J.samples.wl.tau.toFixed(2)}`);
  for (const p of J.design) console.log(`      ${p.label}: ${p.rainMM.toFixed(0)} mm (${p.rainT.toFixed(1)} yr) with ${p.wlM.toFixed(2)} m above MHHW (${p.wlT.toFixed(1)} yr)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall compound tests passed');
process.exit(fails ? 1 : 0);
