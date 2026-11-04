// Report sections: model checks and sensitivity (src/checks.js on the run record, rec.checks). Checks: one table of
// what was tested and its status (the model edge, inflow from outside, the books, run length, marks and features near
// the edge, the sensitivity runs), and the edge flooded by side. Sensitivity: the project's batch-variant runs of the
// same storm, scenario and design against the base run: flooded area and damage of each, how much the depths move, and
// a map of the depth change.
import * as R from '../src/report.js';
import { diffSvg, fmtRel } from '../src/checks.js';

const STATUS = { ok: '✓ OK', check: '! Check', problem: '✕ Problem', 'n/a': '– Not tested', info: 'i Reported' };

/** The model checks section, or null when no run has them. */
export function checksSection({ runs, theme, size, u, tag }) {
  const withC = runs.filter(([, r]) => r?.checks?.list); if (!withC.length) return null;
  const rows = [], sides = [], figs = [];
  for (const [role, r] of withC) {
    const c = r.checks;
    for (const x of c.list) rows.push({ run: tag(role), group: x.group, check: x.check, status: STATUS[x.status] ?? x.status, value: x.value, means: x.means });
    const e = c.edge;
    for (const s of ['N', 'E', 'S', 'W']) { const d = e.sides[s]; if (d.length) sides.push({ run: tag(role), side: s, length: u.L(d.length), wet: u.L(d.wet), share: d.length ? 100 * d.wet / d.length : 0, max: u.L(d.maxDepth) }); }
    figs.push({ name: `edge_sides_${role}`, svg: R.barChart(['N', 'E', 'S', 'W'].filter(s => e.sides[s].length).map(s => ({ label: { N: 'north', E: 'east', S: 'south', W: 'west' }[s] + ' edge', value: u.L(e.sides[s].wet), text: `${u.L(e.sides[s].wet).toFixed(0)} of ${u.L(e.sides[s].length).toFixed(0)} ${u.len}` })),
      { title: `${tag(role)}: model edge with peak depth ≥ ${Math.round(e.threshold * 100)} cm`, unit: u.len, theme, width: size?.width ?? 640 }) });
  }
  const n = (st) => rows.filter(x => x.status === STATUS[st]).length;
  return {
    id: 'checks', title: 'Model checks',
    note: `What a reviewer would test, run by run: ${n('ok')} OK, ${n('check')} to check, ${n('problem')} problems, ${n('n/a')} not tested. ` +
      'The model edge is a free outfall (water leaves, nothing comes in) except where a river inflow or the tide holds it: flooding against it may continue past it, or be water that would have pooled. Ground outside that drains in is missing unless the model runs on its watershed. ' +
      'The books close the water budget; water left at the end and the time run after the rain say whether the peaks were reached. The sensitivity rows come from the Sensitivity section. Status thresholds are in src/checks.js (LIMITS).',
    figures: figs,
    tables: [
      { name: 'model_checks', title: 'Model checks', cols: [['run', 'run'], ['group', 'group'], ['check', 'check'], ['status', 'status'], ['value', 'result'], ['means', 'what_it_means']], rows },
      { name: 'model_edge', title: 'Model edge by side', cols: [['run', 'run'], ['side', 'side'], ['length', `edge_length_${u.len}`, 0], ['wet', `flooded_${u.len}`, 0], ['share', 'flooded_%', 1], ['max', `deepest_${u.len}`, 2]], rows: sides },
    ],
  };
}

/** The sensitivity section, or null when no run has batch-variant siblings. */
export function sensitivitySection({ runs, theme, size, u, tag }) {
  const withS = runs.filter(([, r]) => r?.checks?.sens?.rows?.length); if (!withS.length) return null;
  const sq = (m2) => m2 * u.L(1) ** 2, aU = `${u.len}²`, money = (v) => (Number.isFinite(v) ? '$' + Math.round(v).toLocaleString() : '–'), figs = [], rows = [], bandRows = [], mapRows = [], bandNotes = [];
  for (const [role, r] of withS) {
    const S = r.checks.sens, th = r.checks.threshold, g = r.checks.geo, base = S.base;
    const all = [{ label: 'As set (base)', area: S.rows[0].cmp.areaA, dmg: base.damage?.total }, ...S.rows.map(x => ({ label: x.label, area: x.cmp.areaB, dmg: S.variants.find(v => v.key === x.key)?.damage?.total, rel: x.dArea, relD: x.dDamage }))];
    figs.push({ name: `sensitivity_area_${role}`, svg: R.barChart(all.map(x => ({ label: x.label, value: sq(x.area), text: `${sq(x.area).toFixed(0)} ${aU}${x.rel != null ? ` (${fmtRel(x.rel)})` : ''}` })), { title: `${tag(role)}: area flooded ≥ ${Math.round(th * 100)} cm by run`, unit: aU, theme, width: size?.width ?? 640 }) });
    if (all.some(x => x.dmg > 0)) figs.push({ name: `sensitivity_damage_${role}`, svg: R.barChart(all.map(x => ({ label: x.label, value: (x.dmg ?? 0) / 1e3, text: `${money(x.dmg)}${x.relD != null ? ` (${fmtRel(x.relD)})` : ''}` })), { title: `${tag(role)}: building damage by run`, unit: '$ thousand', theme, width: size?.width ?? 640 }) });
    for (const x of S.rows) {
      const v = S.variants.find(q => q.key === x.key);
      if (v) figs.push({ name: `sensitivity_map_${role}_${x.key}`, svg: diffSvg(base.maxDepth, v.maxDepth, g, { threshold: th, theme, width: size?.width ?? 640, title: `${tag(role)}: ${x.label} − base, peak depth change (cm)` }) });
      const c = x.cmp;
      rows.push({ run: tag(role), variant: x.label, step: x.step != null ? fmtRel(x.step) : 'cell size', area: sq(c.areaB), dArea: 100 * x.dArea, dVol: 100 * x.dVol, fit: c.fit, bias: u.L(c.bias), meanAbs: u.L(c.meanAbs), p95: u.L(c.p95Abs), up: u.L(c.maxUp), down: u.L(c.maxDown), over10: 100 * c.over10,
        dmg: v?.damage?.total, dDmg: 100 * x.dDamage, above: x.dAbove, eArea: x.eArea, eDmg: x.eDamage, dir: x.dir ?? 'this session' });
    }
    // the observations against the members' band (src/uncertainty.js)
    const B = S.band?.marks, pct = (v) => `${Math.round(v * 100)} %`;
    if (B?.n) {
      bandNotes.push(`${tag(role)}: ${B.inside} of ${B.n} marks (${pct(B.share)}) inside the band of ${B.members.length} runs, ${u.L(B.meanWidth).toFixed(2)} ${u.len} wide on average; ` +
        `the variant that moves the marks most: ${B.drivers[0].label} (${B.drivers[0].meanShift >= 0 ? '+' : '−'}${u.L(Math.abs(B.drivers[0].meanShift)).toFixed(2)} ${u.len} on average).`);
      for (const b of B.rows) bandRows.push({ run: tag(role), mark: b.name, observed: u.L(b.observed), base: u.L(b.base), lo: u.L(b.lo), hi: u.L(b.hi), width: u.L(b.width), where: b.inside ? 'inside' : b.below ? 'above the band (model low)' : 'below the band (model high)' });
    }
    for (const m of S.band?.maps ?? []) mapRows.push({ run: tag(role), map: m.name, members: m.members, hit: `${pct(m.base.hitRate ?? 0)} (${pct(m.hitRate[0])}–${pct(m.hitRate[1])})`, csi: `${pct(m.base.csi ?? 0)} (${pct(m.csi[0])}–${pct(m.csi[1])})` });
  }
  return {
    id: 'sensitivity', title: 'Sensitivity',
    note: 'The project’s saved batch-study runs of this storm, scenario and design with one input changed (Batch drawer, Variants), each against the base run cell by cell over the cells flooded in either. ' +
      'Fit: flooded in both over flooded in either (1 = the same extent). Bias and |Δ|: the change in peak depth, variant − base. Elasticity: the relative change in the result over the relative change in the input (1 = proportional; roughness and infiltration usually well under 1, rain above it). ' +
      'The cell-size variant tests grid convergence; the others give the spread to report with the results. The maps show where depths move: red deeper, blue shallower, grey within 3 cm, buildings in grey.' +
      (withS.some(([, r]) => r.checks.sens.versions) ? ' Check: the base and some variants were run with different FloodSim versions, so code changes are mixed into the differences; rerun them together.' : '') +
      (bandNotes.length ? ' Uncertainty band: the lowest to the highest level the runs give at each observed mark. A mark inside it is one the model reaches with plausible inputs; one outside it points at something no variant moves (the channel, an edge, the rain, the ground model). One input at a time and a handful of runs: a sensitivity band, not a probability. ' + bandNotes.join(' ') : ''),
    figures: figs,
    tables: [{ name: 'sensitivity', title: 'Sensitivity runs against the base', cols: [['run', 'run'], ['variant', 'variant'], ['step', 'input_change'], ['area', `flooded_${aU}`, 0], ['dArea', 'area_change_%', 1], ['dVol', 'volume_change_%', 1], ['fit', 'fit', 3],
      ['bias', `mean_change_${u.len}`, 3], ['meanAbs', `mean_abs_change_${u.len}`, 3], ['p95', `p95_abs_change_${u.len}`, 3], ['up', `max_deeper_${u.len}`, 2], ['down', `max_shallower_${u.len}`, 2], ['over10', 'cells_changed_over_10_cm_%', 1],
      ['dmg', 'damage_usd', 0], ['dDmg', 'damage_change_%', 1], ['above', 'water_above_floor_change', 0], ['eArea', 'elasticity_area', 2], ['eDmg', 'elasticity_damage', 2], ['dir', 'run_folder']], rows },
      ...(bandRows.length ? [{ name: 'uncertainty_band_marks', title: 'Observed marks against the runs’ band', cols: [['run', 'run'], ['mark', 'mark'], ['observed', `observed_${u.len}`, 2], ['base', `base_${u.len}`, 2], ['lo', `band_low_${u.len}`, 2], ['hi', `band_high_${u.len}`, 2], ['width', `band_width_${u.len}`, 2], ['where', 'observation']], rows: bandRows }] : []),
      ...(mapRows.length ? [{ name: 'uncertainty_band_maps', title: 'Flood-map scores across the runs (base, then the range)', cols: [['run', 'run'], ['map', 'map'], ['members', 'runs', 0], ['hit', 'hit_rate'], ['csi', 'csi']], rows: mapRows }] : [])],
  };
}
