// Report section: river inflow (the run record's rec.inflow, app/map.js inflowRecord). Each entry's hydrograph as it
// went in, and for ungauged rivers (src/streamstats.js) the peak-flow table with its 90 % intervals, the regression
// equations and the basin characteristics they used, and the NRCS timing.
import * as R from '../src/report.js';

/**
 * The section ({ id, title, note, figures, tables }) for app/report-ui.js, or null when no run has river inflow.
 * runs: [[role, record]]; A: the before run (or null); u: display units ({ q, Q, dpQ }); tag(role) → 'Before' | 'After' | 'Run'.
 */
export function inflowSection({ runs, A, theme, size, u, tag }) {
  const withIn = runs.filter(([, r]) => r?.inflow?.length); if (!withIn.length) return null;
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'river';
  const nm = (e, k) => e.name || `River entry ${k + 1}`, h = (t) => t / 3600, figures = [], entries = [], peaks = [], chars = [];
  const [, last] = withIn.at(-1); // the after run (or the only run): an inflow is forcing, the same in both runs of a pair
  figures.push({ name: 'inflow_hydrographs', svg: R.lineChart(withIn.flatMap(([role, r]) => r.inflow.map((e, k) => ({ name: `${A ? tag(role) + ' · ' : ''}${nm(e, k)}`, role: k ? 'line' : A ? role : 'after', dash: role === 'before',
    pts: e.series.map(([t, q]) => [h(t), u.Q(q)]) }))), { title: 'River inflow at the model edge', xLabel: 'hours from the start', yLabel: `flow, ${u.q}`, zeroY: true, theme, ...size }) });
  last.inflow.forEach((e, k) => {
    const g = e.ungauged, peakIn = Math.max(...e.series.map(p => p[1])), tPk = e.series.find(p => p[1] === peakIn)?.[0] ?? NaN;
    entries.push({ entry: nm(e, k), source: g ? g.source : `USGS gauge ${e.site}`, T: g?.T ?? NaN, peak: u.Q(peakIn), at: h(tPk), lo: g ? u.Q(g.lo) : NaN, hi: g ? u.Q(g.hi) : NaN,
      area: g ? g.areaKm2 : NaN, lag: g?.lagH ?? NaN, runoff: g?.runoffMm ?? NaN, rain: g?.rainMm ?? NaN, scale: e.scale ?? 1, label: e.label });
    if (!g) return;
    for (const p of g.peaks ?? []) peaks.push({ entry: nm(e, k), T: p.T, q: u.Q(p.q), lo: u.Q(p.lo), hi: u.Q(p.hi), se: p.se ?? NaN, used: p.T === g.T ? 'this run' : '' });
    if (g.peaks?.length) figures.push({ name: `peaks_${slug(nm(e, k))}`, svg: R.barChart(g.peaks.map(p => ({ label: `${p.T}-yr`, value: u.Q(p.q),
      text: `${u.Q(p.q).toFixed(u.dpQ > 2 ? 1 : 0)}${Number.isFinite(p.lo) ? ` (90 %: ${u.Q(p.lo).toFixed(0)}–${u.Q(p.hi).toFixed(0)})` : ''} ${u.q}${p.T === g.T ? ' ← this run' : ''}` })),
      { title: `${nm(e, k)}: regression peak flows by return period (${g.how})`, unit: u.q, theme, width: size?.width ?? 640 }) });
    for (const rg of g.regions ?? []) for (const p of rg.params ?? []) chars.push({ entry: nm(e, k), region: rg.name.replace(/_/g, ' '), weight: rg.weight ?? NaN, code: p.code, name: p.name, value: p.value, unit: p.unit,
      range: p.min != null || p.max != null ? `${p.min ?? '–'} to ${p.max ?? '–'}` : '', ok: p.inRange === false ? 'outside: extrapolated' : 'in range' });
  });
  const ung = last.inflow.filter(e => e.ungauged), warn = ung.flatMap(e => e.ungauged.warnings.map(w => `${e.name || 'River'}: ${w}.`));
  return { id: 'inflow', title: 'River inflow',
    note: `Flow into the model where mapped rivers cross its edge, spread over the channel's lowest cells there. ` +
      (ung.length ? `Ungauged rivers: the T-year peak from the state's USGS regional regression equations (StreamStats: the basin delineated above the entry, its characteristics, the National Streamflow Statistics estimate) or as given, ` +
        `shaped as the NRCS dimensionless unit hydrograph (NEH 630 ch. 16, peak rate factor 484), its peak the NRCS lag after the middle of the rain's peak block, on a base of 5 % of the peak. ` +
        `The 90 % interval is NSS's own where it publishes one, else ±1.645 average standard errors of prediction: the region's average width. Regression equations are fitted to mostly rural basins in the state study; ` +
        `the timing uses the NRCS lag equation (hydraulic length, mean basin slope, a curve number from the impervious share), which was developed for small basins. ${warn.join(' ')}` : 'All entries take their flow from USGS gauges (see each entry\'s label).'),
    figures,
    tables: [
      { name: 'inflow_entries', title: 'River entries', cols: [['entry', 'entry'], ['source', 'source'], ['T', 'return_period_yr', 0], ['peak', `peak_in_${u.q}`, u.dpQ], ['at', 'peak_at_h', 2], ['lo', `p90_low_${u.q}`, u.dpQ], ['hi', `p90_high_${u.q}`, u.dpQ],
        ['area', 'basin_km2', 1], ['lag', 'nrcs_lag_h', 2], ['runoff', 'runoff_mm', 0], ['rain', 'storm_rain_mm', 0], ['scale', 'area_scale', 3], ['label', 'how']], rows: entries },
      ...(peaks.length ? [{ name: 'inflow_peak_flows', title: 'Regression peak flows (ungauged rivers)', cols: [['entry', 'entry'], ['T', 'return_period_yr', 0], ['q', `peak_${u.q}`, u.dpQ], ['lo', `p90_low_${u.q}`, u.dpQ], ['hi', `p90_high_${u.q}`, u.dpQ], ['se', 'std_error_pct', 1], ['used', 'used']], rows: peaks }] : []),
      ...(chars.length ? [{ name: 'inflow_basin_characteristics', title: 'Basin characteristics in the regression equations', cols: [['entry', 'entry'], ['region', 'regression_region'], ['weight', 'area_weight_pct', 0], ['code', 'code'], ['name', 'characteristic'], ['value', 'value', 2], ['unit', 'unit'], ['range', 'equation_range'], ['ok', 'check']], rows: chars }] : []),
    ] };
}
