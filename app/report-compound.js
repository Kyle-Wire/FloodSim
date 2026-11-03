// Report section: compound flooding at a tidal site (src/compound.js, from the app's station data and each run's
// rec.tide). MHHW at the tide gauge under the 2022 Interagency sea-level rise scenarios; NOAA's extreme water levels; the
// joint rain–surge AND isolines with the design pairs; and the water level each run had on its open-water edges (a
// design tide, or an observed one raised for sea-level rise).
import * as R from '../src/report.js';
import { slrAt, SLR_SCENARIOS } from '../src/compound.js';

const SLR_COLOURS = { Low: '#0ca30c', 'Intermediate-Low': '#2a9d8f', Intermediate: '#3987e5', 'Intermediate-High': '#d9a326', High: '#d03b3b' };
const T_COLOURS = { 10: '#898781', 50: '#d9a326', 100: '#3987e5' };
const LETTERS = 'ABCDEFGH';

/**
 * The section ({ id, title, note, figures, tables }) for app/report-ui.js, or null with no tide gauge and no run with a
 * water level. runs: [[role, record]]; data: the app's compound data ({ station, name, datums, slr, ewl, joint, set }) or
 * null; u: display units ({ len, L, dpL }); tag(role) → 'Before' | 'After' | 'Run'; size: chart size in the drawer.
 */
export function compoundSection({ runs, theme, size, u, tag, data }) {
  const tides = runs.filter(([, r]) => r?.tide?.pts?.length);
  if (!data && !tides.length) return null;
  const D = data?.datums, ref = D?.datum ?? tides[0]?.[1].tide.datum ?? 'NAVD88', L = u.L, len = u.len, dp = u.dpL;
  const us = len === 'ft', rain = (mm) => (us ? mm / 25.4 : mm), rainU = us ? 'in' : 'mm';
  const figures = [], tables = [], notes = [];

  // 1. sea-level rise at the gauge: MHHW by scenario and year
  if (data?.slr && D) {
    const S = data.slr, years = [D.epochMid]; for (let y = Math.ceil((D.epochMid + 1) / 10) * 10; y <= 2150; y += 10) years.push(y);
    const names = SLR_SCENARIOS.filter(n => S.scenarios[n]);
    const set = data.set?.slr, refs = [{ y: L(D.mhhw), label: `MHHW (${D.epoch ?? 'epoch'})` }];
    const marks = set && set.scenario !== 'none' ? [{ x: set.year, y: L(D.mhhw + set.m), label: 'as set' }] : [];
    figures.push({ name: 'slr_mhhw', svg: R.lineChart(names.map(n => ({ name: n, colour: SLR_COLOURS[n], pts: years.map(y => [y, L(D.mhhw + slrAt(S, n, y))]) })),
      { title: `MHHW at ${data.station} ${data.name ?? ''} under the 2022 Interagency SLR scenarios`, xLabel: 'year', yLabel: `MHHW, ${len} ${ref}`, refs, markers: marks, theme, ...size }) });
    const at = (n, y) => L(slrAt(S, n, y)), since2000 = (n, y) => L(slrAt(S, n, y) - S.from2000);
    tables.push({ name: 'slr_scenarios', title: `Relative sea-level rise at ${data.station} (${len}): since the datum epoch mid-year ${D.epochMid}, since 2000, and MHHW (${ref})`,
      cols: [['scenario', 'scenario'], ['r2030', `rise_since_${D.epochMid}_by_2030_${len}`, dp], ['r2050', `by_2050_${len}`, dp], ['r2070', `by_2070_${len}`, dp], ['r2100', `by_2100_${len}`, dp], ['r2150', `by_2150_${len}`, dp],
        ['s2050', `rise_since_2000_by_2050_${len}`, dp], ['s2100', `since_2000_by_2100_${len}`, dp], ['m2050', `MHHW_2050_${len}_${ref}`, dp], ['m2100', `MHHW_2100_${len}_${ref}`, dp]],
      rows: names.map(n => ({ scenario: n, r2030: at(n, 2030), r2050: at(n, 2050), r2070: at(n, 2070), r2100: at(n, 2100), r2150: at(n, 2150), s2050: since2000(n, 2050), s2100: since2000(n, 2100),
        m2050: L(D.mhhw + slrAt(S, n, 2050)), m2100: L(D.mhhw + slrAt(S, n, 2100)) })) });
  }
  if (D) tables.push({ name: 'tidal_datums', title: `Tidal datums at ${data.station} (epoch ${D.epoch ?? '?'}), ${len} ${ref}`, cols: [['datum', 'datum'], ['level', `${len}_${ref}`, dp]],
    rows: [['MHHW', D.mhhw], ['MHW', D.mhw], ['MSL', D.msl], ['MTL', D.mtl], ['MLW', D.mlw], ['MLLW', D.mllw], ...(D.record ? [[`highest observed (${String(D.record.maxDate ?? '').slice(0, 10)})`, D.record.max]] : [])]
      .filter(([, v]) => Number.isFinite(v)).map(([datum, v]) => ({ datum, level: L(v) })) });
  if (data?.ewl?.levels?.length && D) tables.push({ name: 'extreme_water_levels', title: `NOAA extreme water levels at ${data.station}: GEV on ${data.ewl.years || 'the'} detrended annual maxima${data.ewl.trendMmYr != null ? ` (trend ${data.ewl.trendMmYr.toFixed(2)} mm/yr removed)` : ''}`,
    cols: [['rp', 'return_period_yr', 0], ['level', `above_MHHW_${len}`, dp], ['lo', `lower_90pct_${len}`, dp], ['hi', `upper_90pct_${len}`, dp], ['total', `level_${len}_${ref}_at_epoch`, dp]],
    rows: data.ewl.levels.map(e => ({ rp: e.rp, level: L(e.level), lo: L(e.lo), hi: L(e.hi), total: L(D.mhhw + e.level) })) });

  // 2. joint rain–surge probability: AND isolines and the design pairs
  const J = data?.joint;
  if (J) {
    const series = [];
    for (const T of Object.keys(J.isolines).map(Number).sort((a, b) => a - b)) {
      const clip = (pts) => pts.filter(([mm, m]) => Number.isFinite(mm) && Number.isFinite(m) && mm >= 0).map(([mm, m]) => [rain(mm), L(m)]);
      series.push({ name: `${T}-yr, rain-driven`, colour: T_COLOURS[T], pts: clip(J.isolines[T].rain) });
      series.push({ name: `${T}-yr, surge-driven`, colour: T_COLOURS[T], dash: true, pts: clip(J.isolines[T].wl) });
    }
    figures.push({ name: 'joint_isolines', svg: R.lineChart(series, { title: `Rain and high water together: AND isolines (both exceeded in a year), ${J.gauge.name} with ${J.station}`,
      xLabel: `daily rain, ${rainU}`, yLabel: `high water above MHHW, ${len}`, markers: J.design.map((p, k) => ({ x: rain(p.rainMM), y: L(p.wlM), label: LETTERS[k] })), theme, ...size }) });
    tables.push({ name: 'joint_design_pairs', title: `${J.designT}-yr design events (A–D on the chart). Rain: daily at ${J.gauge.name}; high water: above MHHW at the datum epoch, before sea-level rise`,
      cols: [['k', 'mark'], ['label', 'event'], ['rain', `daily_rain_${rainU}`, us ? 2 : 0], ['rainT', 'rain_return_period_yr', 1], ['wl', `high_water_above_MHHW_${len}`, dp], ['wlT', 'high_water_return_period_yr', 1], ['andT', 'joint_AND_return_period_yr', 0]],
      rows: J.design.map((p, k) => ({ k: LETTERS[k], label: p.label, rain: rain(p.rainMM), rainT: p.rainT, wl: L(p.wlM), wlT: p.wlT, andT: p.andT })) });
    const S = J.samples, sig = (s) => (Math.abs(s.z) >= 1.96 ? 'yes' : 'no');
    tables.push({ name: 'joint_samples', title: "The conditional samples: Kendall's τ, its z for τ = 0, and the Gumbel copula's θ",
      cols: [['sample', 'sample'], ['n', 'events', 0], ['tau', 'kendall_tau', 3], ['z', 'z', 2], ['sig', 'significant_5pct'], ['theta', 'gumbel_theta', 3]],
      rows: [['rain-driven: each year’s wettest day, highest water within ±1 day', S.rain], ['surge-driven: each year’s highest water, most rain within ±1 day', S.wl]]
        .map(([sample, s]) => ({ sample, n: s.n, tau: s.tau, z: s.z, sig: sig(s), theta: s.theta })) });
    notes.push(`Joint probability: two-sided conditional sampling (Bender and Jensen 2017; Jane et al. 2020) over ${J.pairYears} years with both records (${J.gauge.name}, ${J.gauge.km.toFixed(0)} km, ACIS daily rain; ${J.station} daily highest water from NOAA CO-OPS, detrended to the epoch). ` +
      `Marginals: GEV by L-moments of the driver's annual maxima (rain ${J.rainYears} years; water ${J.wlSource}) and of the concurrent variable in its sample (with a point mass at zero rain). Copula: Gumbel, θ = 1 / (1 − τ), independence when τ ≤ 0. ` +
      `AND return period 1 / (1 − u − v + C(u, v)) with one event a year. The most likely event is the largest joint density on the ${J.designT}-yr isoline, on the part of it where the sample's driver is the rarer of the two (the other sample has the rest); the conditional events are one variable at ${J.designT} years with the other at its median given it. ` +
      `Each sample's isoline is meaningful where its driver is large (the rain-driven line at high rain, the surge-driven at high water). Daily rain is a calendar-day gauge total; a design run takes Atlas 14 24 h at the same return period (partial-duration), not this depth.`);
  }

  // 3. the water level each run had on its open-water edges
  if (tides.length) {
    const h = (s) => s / 3600, series = [], marks = [], rows = [];
    for (const [role, r] of tides) {
      const t = r.tide, g = t.design;
      series.push({ name: `${tag(role)}${g ? ' design' : ' observed'}`, role: tides.length > 1 ? role : 'after', pts: t.pts.map(([s, v]) => [h(s), L(v)]) });
      if (t.rainPeakS != null) { const near = t.pts.reduce((a, p) => (Math.abs(p[0] - t.rainPeakS) < Math.abs(a[0] - t.rainPeakS) ? p : a), t.pts[0]); marks.push({ x: h(t.rainPeakS), y: L(near[1]), label: 'rain peak' }); }
      rows.push({ run: tag(role), kind: g ? { still: 'design: still water', cycle: 'design: tide cycle (M2)', predicted: `design: NOAA prediction ${g.tideAt ?? g.date ?? ''}` }[g.mode] : 'observed',
        phase: g && g.mode !== 'still' ? `${g.phase} water at the rain peak` : '', surge: g ? `${g.surge}` : '', surgeM: g ? L(g.surgeM) : NaN,
        slr: g ? (g.slr?.scenario === 'none' ? 'none' : `${g.slr?.scenario} ${g.slr?.year}`) : t.slr ? `${t.slr.scenario} ${t.slr.from}–${t.slr.year}` : 'none', slrM: L(g ? g.slrM : t.slr?.m ?? 0),
        mhhw: L(g?.mhhw ?? t.mhhw ?? NaN), peak: L(t.peak), cells: t.edgeCells, station: `${t.station} ${t.name ?? ''}` });
    }
    const mh = tides.map(([, r]) => r.tide.design?.mhhw ?? r.tide.mhhw).find(Number.isFinite);
    figures.push({ name: 'run_water_level', svg: R.lineChart(series, { title: 'Water level on the open-water edges in each run', xLabel: 'hours from the start', yLabel: `water level, ${len} ${tides[0][1].tide.datum ?? ref}`,
      refs: Number.isFinite(mh) ? [{ y: L(mh), label: 'MHHW' }] : [], markers: marks, theme, ...size }) });
    tables.push({ name: 'run_water_level', title: 'The downstream water level of each run', cols: [['run', 'run'], ['kind', 'water_level'], ['phase', 'timing'], ['surge', 'surge'], ['surgeM', `surge_${len}`, dp], ['slr', 'sea_level_rise'], ['slrM', `rise_${len}`, dp],
      ['mhhw', `MHHW_${len}`, dp], ['peak', `peak_${len}`, dp], ['cells', 'edge_cells', 0], ['station', 'station']], rows });
  }

  const note = [
    D ? `Levels in ${len} ${ref} from NOAA CO-OPS station datums (${data.station}, epoch ${D.epoch ?? '?'}). NOAA's extreme water levels are above MHHW at the epoch mid-year (${D.epochMid}). ` +
      `Sea-level rise: the 2022 Interagency Technical Report scenarios as NOAA serves them for the station (relative to 2005), moved to the epoch mid-year with NOAA's offsets, so a rise adds to MHHW directly; "since 2000" is the report's own baseline. ` +
      `A design tide is MHHW + the surge + the rise (still water), a tide between MLLW and MHHW of period M2, or NOAA's harmonic prediction for a date with its high (or low) water moved to the rain peak, each + the surge and rise; it drives the same open-water edge cells an observed tide does.` : 'No tide gauge data loaded this session: only the runs\' water levels are shown.',
    ...notes].join(' ');
  return { id: 'compound', title: 'Compound flooding and sea-level rise', note, figures, tables };
}
