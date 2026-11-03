// Report section: the run's rain against nearby rain gauges (src/rainqa.js on the run record, rec.validation.rain.stations):
// ASOS airport gauges (hourly, cut to the storm's hours) and CoCoRaHS volunteer gauges (daily reports, which cover more
// than the storm) within 25 km of the site. A bar per gauge against the model's rain, and a table with each one's
// network, distance, window, coverage and the ratio. Sits with the validation scorecard (its id starts 'validation').
import * as R from '../src/report.js';
import { TARGETS } from '../src/validate.js';

const IN = 25.4;
const utc = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

/** The section, or null when no run of a real storm has nearby gauges. runs: [[role, record]]; u.len 'ft' → inches. */
export function rainQaSection({ runs, A, theme, size, u, tag }) {
  const withQ = runs.filter(([, r]) => r?.validation?.observed && r.validation.rain?.stations); if (!withQ.length) return null;
  const inch = u.len === 'ft', unit = inch ? 'in' : 'mm', P = (mm) => (inch ? mm / IN : mm), dp = inch ? 2 : 0, [good, fair] = TARGETS.rainSources;
  const figs = [], rows = [], notes = [];
  for (const [role, r] of withQ) {
    const q = r.validation.rain.stations, who = tag(role);
    if (q.error || !q.rows?.length) { notes.push(`${who}: ${q.error ?? 'no ASOS or CoCoRaHS gauge reported within 25 km'}.`); continue; }
    const bnd = (x) => (x.bound === 'above' ? '; as an upper bound, the model is above it' : x.bound === 'within' ? '; as an upper bound, the model is within it' : ''),
      mark = (x) => (!x.scored ? '' : Math.abs(x.ratio - 1) <= good ? '✓ good' : Math.abs(x.ratio - 1) <= fair ? '~ fair' : '✕ poor');
    figs.push({ name: `rain_gauges_${role}`, svg: R.barChart(q.rows.map(x => ({ label: `${x.id} ${x.km.toFixed(1)} km`, value: P(x.gaugeMM),
      text: `${P(x.gaugeMM).toFixed(dp)} ${unit} ${x.kind === 'ASOS' ? 'hourly' : 'daily'}${x.scored ? `, model / gauge ${x.ratio.toFixed(2)}` : ` (not scored: ${x.why}${bnd(x)})`}` })),
    { title: `${who}: rain at the gauges within 25 km over the storm (line: the model's ${P(q.modelMM).toFixed(dp)} ${unit}, area mean)`, unit, limit: P(q.modelMM), limitLabel: `model ${P(q.modelMM).toFixed(dp)} ${unit}`, theme, width: size?.width ?? 640 }) });
    for (const x of q.rows) rows.push({ run: who, id: x.id, name: x.name, kind: x.kind, network: x.network, km: x.km, gauge: P(x.gaugeMM), model: P(x.modelMM), at: x.modelAt, ratio: x.ratio, status: x.scored ? mark(x) : `not scored: ${x.why}${bnd(x)}`,
      cover: `${Math.round(100 * x.coverage)} %`, window: x.kind === 'ASOS' ? `${x.hours} h, ${utc(x.span[0])} – ${utc(x.span[1])} UTC` : `report${x.days.length > 1 ? 's' : ''} of ${x.days.join(', ')} at ${x.obsHour}:00 local${x.assumedHour ? ' (hour assumed)' : ''}, +${x.extraH.toFixed(0)} h beyond the storm` });
    const s = q.summary, w = q.window, b = q.bounds;
    notes.push(`${who}: storm ${utc(w.t0)} – ${utc(w.t1)} UTC${w.live ? ' (observed part; the nowcast is not checked)' : ''}, model ${P(q.modelMM).toFixed(dp)} ${unit} over the area. ` +
      (s ? `${s.n} gauge${s.n > 1 ? 's' : ''} scored: median model / gauge ${s.median.toFixed(2)} (range ${s.min.toFixed(2)}–${s.max.toFixed(2)}); nearest ${s.nearest.kind} ${s.nearest.id}, ${s.nearest.km.toFixed(1)} km: ${s.nearest.ratio.toFixed(2)}.` : 'No gauge could be scored.') +
      (b ? ` ${b.n} daily report${b.n > 1 ? 's' : ''} spanning more than the storm, read as upper bounds: the model is above ${b.above} of them by more than 15 %${b.above ? ' (too wet there, unless the gauges under-caught)' : ''}.` : '') +
      (q.sourceGauge ? ` ASOS ${q.sourceGauge} is the storm's own source and is not scored.` : '') + (q.errors?.length ? ` Not reached: ${q.errors.join('; ')}.` : ''));
  }
  return {
    id: 'validation_rain' + (A ? '_pair' : ''), title: 'Rain against nearby gauges',
    note: `${notes.join(' ')} Gauges from the Iowa Environmental Mesonet: ASOS airport gauges (heated tipping buckets, hourly from the routine METAR; they can read low in intense rain and in wind) summed over the hours whose middle lies within the storm ± ${withQ[0][1].validation.rain.stations.window?.padMin ?? 60} min, and CoCoRaHS volunteer gauges (4-inch manual cylinders, read once a day, usually 7 am local) summed over every report whose 24 hours overlap the storm, so a daily total can include rain before or after it (the hours beyond are listed; reports adding more than 18 h are not scored, but a complete one still caps the storm's rain at the gauge, so the model more than 15 % above it is flagged). ` +
      `Ratio = model / gauge against the area mean the model applied, or for a radar storm the radar at the gauge when the gauge lies inside the run's radar window. Scored: an ASOS gauge with at least 90 % of its hours, a CoCoRaHS gauge with every report, and at least 2.5 mm at the gauge. Targets as the scorecard's rain checks: within ${good} (good) or ${fair} (fair) of 1. ` +
      `Point gauges sample a few hundred cm²; in a convective storm the rain varies several-fold over 25 km, so the median says more than any one gauge. MRMS gauge-corrected rain uses hourly gauges, which can include these ASOS: CoCoRaHS are the more independent check.`,
    figures: figs,
    tables: rows.length ? [{ name: 'rain_gauges', title: 'Rain against nearby gauges', cols: [['run', 'run'], ['id', 'station'], ['name', 'name'], ['kind', 'kind'], ['network', 'network'], ['km', 'distance_km', 1], ['gauge', `gauge_${unit}`, dp], ['model', `model_${unit}`, dp], ['at', 'model_rain_at'],
      ['ratio', 'model_over_gauge', 2], ['status', 'status'], ['cover', 'coverage'], ['window', 'window']], rows }] : [],
  };
}
