// Validation scorecard: one checklist a reviewer can read, for a run of a real storm. It gathers what the app can check
// against the world and against itself:
//   observations   USGS high-water marks or the user's own (src/calibrate.js scoreRun): level RMSE and bias, and
//                  flooded marks the model left dry; USGS gauges inside the area: the peak water level and its time,
//                  and where a control line is drawn at the gauge, its flow against the gauge's discharge over the
//                  whole storm (volume, peak, Nash–Sutcliffe, KGE);
//                  mapped flooding (src/floodmaps.js: USGS post-event depth maps), cell by cell: hit rate and CSI
//   comparison     another model's flood map (NYC DEP Stormwater Flood Maps): the same scores, not counted in the verdict
//   rain           where the rain came from (gauge-corrected or radar-only), how far the sources disagree, and the rain
//                  against nearby ASOS and CoCoRaHS gauges (src/rainqa.js)
//   integrity      the mass balance (surface, and with the pipes), water clipped by the wet / dry fix
// Each line has a status against a target: 'good', 'fair', 'poor', or 'info' (no target). The targets are this app's
// defaults for an urban flood model at 1 m (TARGETS; a reviewer can hold the run to others), not a published standard.

export const TARGETS = {
  hwmRMSE: [0.15, 0.30],      // m: high-water marks, root-mean-square error of the level (good, fair)
  hwmBias: [0.10, 0.20],      // m: their mean error, either sign
  hitRate: [0.8, 0.6],        // share of flooded marks the model floods (at least)
  mapHit: [0.7, 0.5],         // share of a flood map's flooded cells the model floods (at least)
  mapCSI: [0.5, 0.3],         // critical success index against a flood map, hits / (hits + misses + false alarms) (at least)
  gaugePeak: [0.15, 0.30],    // m: a gauge's peak water level
  gaugeTime: [30, 60],        // min: the time of that peak
  flowNSE: [0.65, 0.5],       // Nash–Sutcliffe efficiency of the flow at a gauge over the storm (at least): Moriasi et al. 2007/2015 "good" and "satisfactory"
  flowVolume: [0.15, 0.25],   // the storm's flow volume at a gauge, |model / observed − 1| (Moriasi's PBIAS bands for streamflow)
  flowPeak: [0.15, 0.30],     // the peak flow at a gauge, |model / observed − 1|
  mass: [1e-4, 1e-3],         // surface mass balance, |error| / all the water in (start, rain, rivers, tide)
  combined: [0.01, 0.05],     // with the pipes (SWMM continuity included)
  clipped: [1e-6, 1e-4],      // water added by the wet / dry clip, / rain
  rainSources: [0.15, 0.30],  // the rain used against another source over the same hours, |ratio − 1|
};
const level = (v, [good, fair], higherIsBetter = false) => (v == null || !Number.isFinite(v) ? 'info'
  : higherIsBetter ? (v >= good ? 'good' : v >= fair ? 'fair' : 'poor') : (v <= good ? 'good' : v <= fair ? 'fair' : 'poor'));

/** Peak of a [t, v] series within [t0, t1] → { t, v, atEnd } (atEnd: the highest value is the last one, still rising). */
export function peakOf(series, t0 = -Infinity, t1 = Infinity) {
  let best = null, last = null;
  for (const [t, v] of series) { if (t < t0 || t > t1 || !Number.isFinite(v)) continue; last = t; if (!best || v > best.v) best = { t, v }; }
  return best && { ...best, atEnd: best.t === last && series.filter(([t]) => t >= t0 && t <= t1).length > 2 };
}

/**
 * A gauge's observed and modelled peaks. obs: [t (ms), level m NAVD88]; model: [t (ms), water surface m] at the gauge.
 * → { obs, model, error (m), lag (min, model − observed), obsAtEnd, modelAtEnd } or null when either is empty.
 */
export function gaugeScore(obs, model) {
  const t0 = model.length ? model[0][0] : -Infinity, t1 = model.length ? model.at(-1)[0] : Infinity;
  const po = peakOf(obs, t0, t1), pm = peakOf(model);
  if (!po || !pm) return null;
  return { obs: po, model: pm, error: pm.v - po.v, lag: (pm.t - po.t) / 60e3, obsAtEnd: po.atEnd, modelAtEnd: pm.atEnd };
}

/** A [t, v] series (t ascending) at time t, linearly between samples; null outside it or across a gap in it. */
export function valueAt(series, t) {
  let lo = 0, hi = series.length - 1;
  if (hi < 0 || t < series[0][0] || t > series[hi][0]) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (series[m][0] <= t) lo = m; else hi = m; }
  const [ta, a] = series[lo], [tb, b] = series[hi];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return tb > ta ? a + (b - a) * (t - ta) / (tb - ta) : a;
}

/**
 * The whole hydrograph at a gauge: the model against the observed series over the hours both cover, sampled at the
 * observed times. obs, model: [[t (ms), v]] (flow, m³/s; or a level, m). → { n, hours, nse (Nash–Sutcliffe: 1 is a
 * perfect fit, 0 no better than the observed mean), kge (Kling–Gupta, 1 perfect) with r (correlation), alpha (spread
 * ratio) and beta (mean ratio), rmse, volumeRatio (∫ model / ∫ observed over the same hours), peakObs, peakModel,
 * peakRatio, lag (min, model peak − observed peak) } or null when they share fewer than 4 samples. For a level the
 * volume and the ratios mean little (an elevation, not a quantity): read nse and rmse.
 */
export function hydrographScore(obs, model) {
  const ok = model.filter(([, v]) => Number.isFinite(v));
  if (ok.length < 2) return null;
  const t0 = ok[0][0], t1 = ok.at(-1)[0], pairs = [];
  for (const [t, o] of obs) { if (t < t0 || t > t1 || !Number.isFinite(o)) continue; const m = valueAt(ok, t); if (m != null) pairs.push([t, o, m]); }
  const n = pairs.length; if (n < 4) return null;
  const mean = (k) => pairs.reduce((s, p) => s + p[k], 0) / n, mo = mean(1), mm = mean(2);
  let so = 0, sm = 0, som = 0, se = 0;
  for (const [, o, m] of pairs) { so += (o - mo) ** 2; sm += (m - mm) ** 2; som += (o - mo) * (m - mm); se += (m - o) ** 2; }
  const r = so > 0 && sm > 0 ? som / Math.sqrt(so * sm) : null, alpha = so > 0 ? Math.sqrt(sm / so) : null, beta = mo !== 0 ? mm / mo : null;
  let vo = 0, vm = 0; // trapezoids over the observed times
  for (let k = 1; k < n; k++) { const dt = (pairs[k][0] - pairs[k - 1][0]) / 1000; vo += dt * (pairs[k][1] + pairs[k - 1][1]) / 2; vm += dt * (pairs[k][2] + pairs[k - 1][2]) / 2; }
  const po = pairs.reduce((a, p) => (p[1] > a[1] ? p : a)), pm = ok.filter(([t]) => t >= pairs[0][0] && t <= pairs[n - 1][0]).reduce((a, p) => (p[1] > a[1] ? p : a), [pairs[0][0], -Infinity]);
  return { n, hours: (pairs[n - 1][0] - pairs[0][0]) / 3600e3, nse: so > 0 ? 1 - se / so : null,
    kge: r != null && alpha != null && beta != null ? 1 - Math.sqrt((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2) : null, r, alpha, beta,
    rmse: Math.sqrt(se / n), volumeRatio: vo > 0 ? vm / vo : null, peakObs: po[1], peakModel: pm[1], peakRatio: po[1] > 0 ? pm[1] / po[1] : null, lag: (pm[0] - po[0]) / 60e3 };
}

/**
 * The STN event that matches a storm: its name (Ida, Sandy…) or its year and month in the event name, else the year.
 * events: [name]; storm: { name, t0 } → name or null.
 */
export function matchEvent(events, storm) {
  if (!storm?.t0 || !events.length) return null;
  const d = new Date(storm.t0), y = String(d.getUTCFullYear()), mon = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const words = String(storm.name ?? '').split(/[^A-Za-z]+/).filter(w => w.length > 2 && !/^(storm|of|the|live|radar|nowcast|utc)$/i.test(w));
  const score = (e) => (e.includes(y) ? 2 : 0) + (words.some(w => new RegExp(`\\b${w}\\b`, 'i').test(e)) ? 3 : 0) + (new RegExp(mon.slice(0, 3), 'i').test(e) ? 1 : 0);
  const best = events.map(e => [e, score(e)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 2 ? best[0] : null; // at least the year
}

/**
 * The scorecard. input: { hwm: scoreRun result | null, gauges: [{ name, site, score: gaugeScore | null, why? }],
 * rain: { source, gauged (share of hours), usedMM, radarMM, siteMM, stations?: src/rainqa.js rainQA result } | null, mass: { surface, combined (relative errors), clipped (m³), rain (m³) },
 * observed: true when the storm is a real one (historic or live) } → { items: [{ group, label, value, unit, target, status, note }],
 * verdict: { status, text } }. unit: 'm', 'min', 'share' (0–1), 'ratio', 'rel' (a fraction of the rain), 'text'; the caller formats them.
 */
export function scorecard(input, T = TARGETS) {
  const items = [], add = (group, label, [value, unit], target, status, note = '') => items.push({ group, label, value, unit, target, status, note });
  const { hwm, gauges = [], floodMaps = [], rain, mass, observed } = input;
  const short = gauges.some(g => g.score?.obsAtEnd); // the river was still rising at the end: the marks record a crest the run never reached
  const shortNote = 'the gauges were still rising when the run ended: marks record the crest, so the model reads low here; run longer (Keep running after the storm)';
  // observations
  if (hwm?.n) {
    add('observations', `High-water marks: RMSE of the level (${hwm.n})`, [hwm.rmse, 'm'], T.hwmRMSE, level(hwm.rmse, T.hwmRMSE), short ? shortNote : '');
    add('observations', 'High-water marks: bias (model − observed)', [hwm.bias, 'm'], T.hwmBias, level(Math.abs(hwm.bias), T.hwmBias), short ? shortNote : '');
    add('observations', 'High-water marks within 15 cm', [hwm.within15, 'share'], null, 'info');
    if (hwm.skipped) add('observations', 'High-water marks not scored', [hwm.skipped, 'text'], null, 'info', 'under a bridge or deck the lidar sees as ground (more than 1 m below it), or indoors or in a basement by the mark’s own description');
  }
  if (hwm?.calls) {
    const wet = hwm.hits + hwm.misses, rate = wet ? hwm.hits / wet : null;
    add('observations', `Flooded marks the model floods (${hwm.hits} of ${wet})`, [rate, 'share'], T.hitRate, level(rate, T.hitRate, true));
  }
  for (const g of gauges) {
    if (!g.score) { add('observations', `Gauge ${g.site} ${g.name}`, [null, ''], null, 'info', g.why ?? 'no comparison'); continue; }
    const s = g.score, end = s.obsAtEnd ? 'the gauge was still rising when the run ended' : s.modelAtEnd ? 'the model was still rising when the run ended' : '';
    add('observations', `Gauge ${g.site} ${g.name}: ${s.obsAtEnd || s.modelAtEnd ? 'highest level in the run' : 'peak level'} (model − observed)`, [s.error, 'm'], T.gaugePeak, level(Math.abs(s.error), T.gaugePeak), end);
    add('observations', `Gauge ${g.site} ${g.name}: peak time (model − observed)`, [s.lag, 'min'], T.gaugeTime, s.obsAtEnd || s.modelAtEnd ? 'info' : level(Math.abs(s.lag), T.gaugeTime), end);
    if (g.levelShape?.nse != null) add('observations', `Gauge ${g.site}: level over the storm, Nash–Sutcliffe (${g.levelShape.hours.toFixed(0)} h)`, [g.levelShape.nse, 'ratio'], null, 'info', `RMSE ${g.levelShape.rmse.toFixed(2)} m over the whole record, not only the peak`);
    const q = g.flow?.score;
    if (q) {
      const at = `flow across ${g.flow.line ?? 'the control line'} against the gauge's discharge`;
      if (q.volumeRatio != null) add('observations', `Gauge ${g.site}: storm flow volume (model / observed)`, [q.volumeRatio, 'ratio'], T.flowVolume, level(Math.abs(q.volumeRatio - 1), T.flowVolume), at);
      if (q.peakRatio != null) add('observations', `Gauge ${g.site}: peak flow (model / observed)`, [q.peakRatio, 'ratio'], T.flowPeak, level(Math.abs(q.peakRatio - 1), T.flowPeak), `${q.peakModel.toFixed(1)} against ${q.peakObs.toFixed(1)} m³/s`);
      if (q.nse != null) add('observations', `Gauge ${g.site}: flow over the storm, Nash–Sutcliffe (${q.hours.toFixed(0)} h)`, [q.nse, 'ratio'], T.flowNSE, level(q.nse, T.flowNSE, true), 'how well the modelled flow follows the gauge hour by hour: 1 is a perfect fit, 0 no better than the storm’s mean flow');
      if (q.kge != null) add('observations', `Gauge ${g.site}: flow, Kling–Gupta efficiency`, [q.kge, 'ratio'], null, 'info', `correlation ${q.r.toFixed(2)}, spread ${q.alpha.toFixed(2)}, mean ${q.beta.toFixed(2)} (each 1 when perfect)`);
    }
  }
  // flood maps, cell by cell at 4 in and over
  for (const m of floodMaps) {
    if (!m.mapped) continue;
    const g = m.observed === false ? 'comparison' : 'observations', who = m.name.split(' (')[0];
    const note = m.observed === false ? 'another model’s map, not an observation' : m.kind === 'depth' && m.name.startsWith('USGS') ? 'made from the high-water marks and the lidar within 250 m of each: not independent of the marks' : '';
    add(g, `${who}: its flooded cells the model floods`, [m.hitRate, 'share'], T.mapHit, level(m.hitRate, T.mapHit, true), note);
    add(g, `${who}: critical success index`, [m.csi, 'share'], T.mapCSI, level(m.csi, T.mapCSI, true), `false-alarm ratio ${m.falseAlarmRatio == null ? '–' : Math.round(m.falseAlarmRatio * 100) + ' %'}; flooded area model / map ${m.areaRatio?.toFixed(2) ?? '–'}`);
    if (m.depth) add(g, `${who}: depth where both flood, bias (model − map)`, [m.depth.bias, 'm'], T.hwmBias, level(Math.abs(m.depth.bias), T.hwmBias), `RMSE ${m.depth.rmse.toFixed(2)} m over ${m.depth.n.toLocaleString()} cells`);
  }
  // rain
  if (rain) {
    add('rain', 'Rain source', [rain.source, 'text'], null, 'info');
    if (rain.gauged != null) add('rain', 'Hours with gauge-corrected totals', [rain.gauged, 'share'], null, rain.gauged >= 1 ? 'good' : rain.gauged > 0 ? 'fair' : 'info');
    if (rain.radarMM > 0 && rain.usedMM != null && rain.gauged > 0) add('rain', 'Gauge-corrected against radar alone', [rain.usedMM / rain.radarMM, 'ratio'], T.rainSources, level(Math.abs(rain.usedMM / rain.radarMM - 1), T.rainSources));
    if (rain.siteMM > 0 && rain.usedMM != null) add('rain', 'Against the site\'s gridded daily record', [rain.usedMM / rain.siteMM, 'ratio'], T.rainSources, level(Math.abs(rain.usedMM / rain.siteMM - 1), T.rainSources), 'a coarse grid: a disagreement here points at the record as often as the radar');
    // nearby point gauges (src/rainqa.js): ASOS hourly and CoCoRaHS daily within 25 km, model / gauge over the storm
    const q = rain.stations, s = q?.summary;
    if (s) {
      const at = q.rows.some(r => r.scored && r.modelAt === 'radar at the gauge') ? 'the radar at each gauge inside the radar window, else the area mean' : 'the area mean';
      add('rain', `Against ${s.n} nearby rain gauge${s.n > 1 ? 's' : ''}: median (model / gauge)`, [s.median, 'ratio'], T.rainSources, level(Math.abs(s.median - 1), T.rainSources),
        `range ${s.min.toFixed(2)}–${s.max.toFixed(2)}; against ${at}; rain varies a lot over 25 km in a convective storm, so read the median, not one gauge`);
      add('rain', `Nearest gauge: ${s.nearest.kind} ${s.nearest.id} ${s.nearest.name}, ${s.nearest.km.toFixed(1)} km (model / gauge)`, [s.nearest.ratio, 'ratio'], T.rainSources, level(Math.abs(s.nearest.ratio - 1), T.rainSources));
    } else if (q) {
      const why = q.error ?? (q.rows?.length ? `none usable (${[...new Set(q.rows.map(r => r.why).filter(Boolean))].slice(0, 3).join('; ')})` : 'no ASOS or CoCoRaHS gauge reported within 25 km');
      add('rain', 'Nearby rain gauges', [why, 'text'], null, 'info');
    }
  }
  // integrity
  if (mass) {
    add('integrity', 'Mass balance, surface (|error| / water in)', [Math.abs(mass.surface), 'rel'], T.mass, level(Math.abs(mass.surface), T.mass));
    if (mass.combined != null) add('integrity', 'Mass balance with the pipes (|error| / water in)', [Math.abs(mass.combined), 'rel'], T.combined, level(Math.abs(mass.combined), T.combined));
    if (mass.rain > 0) add('integrity', 'Water added by the wet / dry clip (/ rain)', [mass.clipped / mass.rain, 'rel'], T.clipped, level(mass.clipped / mass.rain, T.clipped));
  }
  // verdict: from the observations alone (integrity and rain explain it, they do not make it)
  const obs = items.filter(i => i.group === 'observations' && i.status !== 'info'), bad = items.filter(i => i.group === 'integrity' && i.status === 'poor');
  let verdict;
  if (bad.length) verdict = { status: 'poor', text: `The run's own books are off (${bad.map(i => i.label.split(' (')[0].toLowerCase()).join(', ')}): fix that before reading anything else.` };
  else if (!obs.length) verdict = { status: 'info', text: observed ? 'Not validated: no high-water marks or gauges to compare with in this area. Load the event\'s high-water marks (Calibrate) or your own observations.' : 'Not validated: a design storm has nothing observed to compare with. Validate the model on a historic storm at the same site first.' };
  else {
    const n = (s) => obs.filter(i => i.status === s).length, poor = n('poor'), fair = n('fair');
    verdict = poor ? { status: 'poor', text: `${poor} of ${obs.length} observation checks miss their targets: calibrate (roughness, infiltration, inlet clogging) or check the inputs before using this model for design.` }
      : fair ? { status: 'fair', text: `Within reach: ${fair} of ${obs.length} observation checks are fair, none poor.` }
      : { status: 'good', text: `All ${obs.length} observation checks meet their targets.` };
  }
  if (short && verdict.status !== 'info') verdict.text += ' The river was still rising when the run ended: run it past the crest before trusting the levels.';
  return { items, verdict };
}
