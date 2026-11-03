// Report sections: building damage (src/damage.js on the run record, rec.analysis.damage) and expected annual damage
// with benefit–cost (rec.ead: the project's runs of the same scenario and settings at other return periods). Damage:
// totals with their band, by category, the depths above the first floor, the most damaged structures. EAD: the
// damage–frequency curve, the integral and its parts; with a before / after pair, the benefits and the BCA.
import * as R from '../src/report.js';
import { bca } from '../src/damage.js';

const FT = 0.3048;
const money = (v) => (Number.isFinite(v) ? '$' + Math.round(v).toLocaleString() : '–');
const DEPTH_BINS = [[-Infinity, -2, 'below −2 ft'], [-2, 0, '−2 to 0 ft'], [0, 1, '0–1 ft'], [1, 2, '1–2 ft'], [2, 3, '2–3 ft'], [3, 6, '3–6 ft'], [6, Infinity, 'over 6 ft']];

/** The damage section, or null when no run has been analysed. */
export function damageSection({ runs, A, theme, size, tag }) {
  const withD = runs.filter(([, r]) => r?.analysis?.damage); if (!withD.length) return null;
  const an0 = withD.at(-1)[1].analysis, figs = [], totals = [], cats = [], top = [];
  if (!an0.nStructures) return { id: 'damage', title: 'Building damage', note: `No USACE NSI structures for this area${an0.nsiError ? ` (${an0.nsiError})` : ''}, so no damage is estimated.`, figures: [], tables: [] };
  for (const [role, r] of withD) {
    const d = r.analysis.damage, T = d.totals;
    totals.push({ run: tag(role), n: d.rows.length, wet: T.wet, flooded: T.flooded, above: T.aboveFloor, night: T.people.night, day: T.people.day, struct: T.struct, cont: T.cont, total: T.total, low: T.low, high: T.high, encl: d.enclosed ? `${d.enclosed.patches} ponds, ${Math.round(d.enclosed.area)} m²` : '–' });
    for (const [cat, c] of Object.entries(T.byCat)) cats.push({ run: tag(role), cat, n: c.n, flooded: c.flooded, value: c.value, damage: c.total, share: c.value > 0 ? 100 * c.total / c.value : NaN });
    const wet = d.rows.filter(x => x.depthFt != null);
    figs.push({ name: `damage_depths_${role}`, svg: R.barChart(DEPTH_BINS.map(([lo, hi, label]) => { const n = wet.filter(x => x.depthFt >= lo && x.depthFt < hi).length; return { label, value: n, text: `${n}` }; }),
      { title: `${tag(role)}: structures by peak water above the first floor (water reached ${wet.length} of ${d.rows.length})`, unit: 'structures', theme, width: size?.width ?? 640 }) });
    for (const x of [...d.rows].filter(x => x.total > 0).sort((p, q) => q.total - p.total).slice(0, 25)) {
      top.push({ run: tag(role), id: x.id, occ: x.occtype, curve: x.curve + (x.curveFallback ? ' (fallback)' : ''), found: `${x.foundType || '?'} ${x.foundHt != null ? (x.foundHt / FT).toFixed(1) + ' ft' : ''}`, ffe: x.ffe, level: x.level, ft: x.depthFt, pctS: x.pctS, pctC: x.pctC, total: x.total, where: `${x.lonlat[1].toFixed(5)}, ${x.lonlat[0].toFixed(5)}` });
    }
  }
  return {
    id: 'damage', title: 'Building damage',
    note: `Structures from the USACE National Structure Inventory (occupancy, foundation type and height, structure and contents values at the NSI's price level, people by day and night). Water against a building is the highest peak level on the open cells next to its OpenStreetMap footprint (buildings are walls in the model) where it stood at least ${Math.round(an0.wall * 100)} cm deep (thinner sheet flow on pavement is not counted: set above), in a flooded patch that reaches a street or covers 200 m² (rain ponding in an enclosed yard or light well, which has a yard drain the model lacks, is listed but not counted); its first floor is the median ground there plus the NSI foundation height. ` +
      `Damage from the USACE depth–damage function of its occupancy type (from USACE go-consequences: EGM 01-03 / 04-01 for single-family homes, HEC-FIA curves for the rest; homes with basements take damage below the first floor), structure and contents; vehicles are not counted. The band takes every curve at its 10th and 90th percentile together, so it is wide by design. ` +
      `"Water above floor" counts structures with the peak level over the first floor; their occupants are the people at risk. Screening estimates for planning, not an appraisal: NSI values and foundation heights are modelled, not surveyed.`,
    figures: figs,
    tables: [
      { name: 'damage_totals', title: 'Damage in total', cols: [['run', 'run'], ['n', 'structures', 0], ['wet', 'water_reached', 0], ['flooded', 'damaged', 0], ['above', 'water_above_floor', 0], ['night', 'people_above_floor_night', 0], ['day', 'people_above_floor_day', 0], ['struct', 'structure_damage_usd', 0], ['cont', 'contents_damage_usd', 0], ['total', 'total_damage_usd', 0], ['low', 'low_p10_usd', 0], ['high', 'high_p90_usd', 0], ['encl', 'enclosed_yard_ponds_not_counted']], rows: totals },
      { name: 'damage_by_category', title: 'Damage by category', cols: [['run', 'run'], ['cat', 'category'], ['n', 'structures', 0], ['flooded', 'damaged', 0], ['value', 'value_usd', 0], ['damage', 'damage_usd', 0], ['share', 'damage_pct_of_value', 1]], rows: cats },
      { name: 'damage_top', title: 'Most damaged structures', cols: [['run', 'run'], ['id', 'nsi_id'], ['where', 'lat_lon'], ['occ', 'occupancy'], ['curve', 'curve'], ['found', 'foundation'], ['ffe', 'first_floor_m', 2], ['level', 'peak_level_m', 2], ['ft', 'above_floor_ft', 2], ['pctS', 'structure_pct', 1], ['pctC', 'contents_pct', 1], ['total', 'damage_usd', 0]], rows: top },
    ],
  };
}

/** The EAD and benefit–cost section, or null when no run has a return-period family. s: { cost, om, rate, years } */
export function eadSection({ runs, A, theme, size, tag, s }) {
  const withE = runs.filter(([, r]) => r?.ead?.points?.length); if (!withE.length) return null;
  const T = (ari) => Math.log10(ari), ticks = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000].map(t => ({ v: T(t), label: `${t}` })), figs = [], rows = [], eads = [], warn = [];
  const series = withE.map(([role, r]) => ({ name: `${tag(role)} EAD ${money(r.ead.ead)}`, role: A ? role : 'after', pts: [[0, 0], ...r.ead.points.map(p => [T(p.ari), p.damage / 1e3])] }));
  const lo = Math.min(...withE.flatMap(([, r]) => r.ead.points.map(p => p.ari))), hi = Math.max(...withE.flatMap(([, r]) => r.ead.points.map(p => p.ari)));
  figs.push({ name: 'damage_frequency', svg: R.lineChart(series, { title: 'Damage by return period (log scale)', xLabel: 'return period, years', yLabel: 'damage, $ thousand', zeroY: true, xTicks: ticks.filter(t => t.v >= 0 && t.v <= T(Math.max(hi, 2)) + 1e-9 && (t.v >= T(lo) - 0.5 || t.v === 0)), theme, ...size }) });
  for (const [role, r] of withE) {
    const e = r.ead;
    for (const p of e.points) rows.push({ run: tag(role), ari: p.ari, aep: 100 * p.aep, flooded: p.flooded, damage: p.damage, low: p.low, high: p.high, dir: p.dir ?? 'this session' });
    eads.push({ run: tag(role), scenario: e.scenario, dur: e.durationMin, storms: e.points.map(p => p.ari).join(', '), ead: e.ead, low: e.low, high: e.high, frequent: e.parts?.frequent, between: e.parts?.between, rare: e.parts?.rare });
    for (const w of e.warnings) warn.push(`${tag(role)}: ${w}`);
  }
  const tables = [
    { name: 'ead_storms', title: 'Damage at each return period', cols: [['run', 'run'], ['ari', 'return_period_yr', 0], ['aep', 'aep_pct', 2], ['flooded', 'structures_damaged', 0], ['damage', 'damage_usd', 0], ['low', 'low_p10_usd', 0], ['high', 'high_p90_usd', 0], ['dir', 'run_folder']], rows },
    { name: 'ead', title: 'Expected annual damage', cols: [['run', 'run'], ['scenario', 'scenario'], ['dur', 'storm_duration_min', 0], ['storms', 'return_periods_run'], ['ead', 'ead_usd', 0], ['low', 'low_p10_usd', 0], ['high', 'high_p90_usd', 0], ['frequent', 'frequent_end_usd', 0], ['between', 'between_storms_usd', 0], ['rare', 'beyond_rarest_usd', 0]], rows: eads },
  ];
  let bnote = '';
  const before = withE.find(([role]) => role === 'before')?.[1].ead, after = withE.find(([role]) => role === 'after')?.[1].ead;
  if (A && before && after && Number.isFinite(before.ead) && Number.isFinite(after.ead)) {
    const b = bca({ eadWithout: before.ead, eadWith: after.ead, rate: s.rate, years: s.years, cost: s.cost, om: s.om });
    tables.push({ name: 'benefit_cost', title: 'Benefit–cost', cols: [['k', 'item'], ['v', 'value']], rows: [
      { k: 'EAD without the project (before)', v: money(before.ead) }, { k: 'EAD with the project (after)', v: money(after.ead) }, { k: 'Annual benefit (damage avoided)', v: money(b.annualBenefit) },
      { k: `Present-value factor (${(100 * s.rate).toFixed(2)} %, ${s.years} years)`, v: b.pvf.toFixed(3) }, { k: 'Present value of benefits', v: money(b.pvBenefits) },
      { k: 'Project cost', v: money(s.cost) }, { k: 'Operation and maintenance a year', v: money(s.om) }, { k: 'Present value of costs', v: money(b.pvCosts) },
      { k: 'Net benefits', v: money(b.net) }, { k: 'Benefit–cost ratio', v: Number.isFinite(b.bcr) ? b.bcr.toFixed(2) : 'enter the project cost' }] });
    bnote = ` Benefits are the EAD the project avoids (before − after) every year of the period, discounted at the rate set above; costs are the first cost plus the discounted O&M. Damage only: no avoided emergency costs, displacement, life safety or environmental benefits, and no future development or sea-level change in the EAD; set the rate and period your program requires (FEMA BCA, USACE, OMB A-94).`;
  }
  return {
    id: 'ead', title: 'Expected annual damage and benefit–cost',
    note: `The project's saved runs of the same scenario, design and settings (everything in the forcing fingerprint but the storm) at different Atlas 14 return periods of the same duration, each with its building damage. EAD = the area under damage over annual exceedance probability: trapezoids between the storms; damage at the most frequent storm falls linearly to zero at AEP 1 unless that storm does none; beyond the rarest storm damage is held at its value (a floor on the tail). The band integrates the curves' 10th and 90th percentiles.${bnote}` +
      (warn.length ? ` Check: ${warn.join(' ')}` : '') + ' Run a batch study of return periods (Batch drawer) to fill the curve.',
    figures: figs, tables,
  };
}
