// Report sections: flood maps and streets (src/maps.js). Maps from the run's 1 m grids: peak depth, hazard class, when
// the water arrived, how long it stayed over 15 cm, and for a before / after pair the change in peak depth; the area in
// each depth band and hazard class. Streets: per mapped street, how much of it was too deep to drive and for how long
// (rec.analysis.streets, from app/map.js analyzeRecord).
import * as R from '../src/report.js';
import { binnedMapSvg, seqColors, binOf } from '../src/maps.js';
import { diffSvg } from '../src/checks.js';

const DEPTH = [[0.05, 0.15], [0.15, 0.30], [0.30, 0.60], [0.60, 1.00], [1.00, Infinity]];
const ARRIVE = [[0, 15], [15, 30], [30, 60], [60, 120], [120, Infinity]], STAY = [[0, 15], [15, 30], [30, 60], [60, 180], [180, Infinity]]; // minutes
const HZ = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'], HZ_NOTE = ['generally safe', 'unsafe for small vehicles', 'unsafe for vehicles, children, the elderly', 'unsafe for people and vehicles', 'unsafe; buildings need care', 'unsafe for buildings'];
const band = (pairs, fmt, unit) => pairs.map(([lo, hi]) => (hi === Infinity ? `> ${fmt(lo)}` : `${fmt(lo)}–${fmt(hi)}`) + (unit ? ` ${unit}` : ''));

/** The flood maps section, or null when no run has 1 m grids on the current model. */
export function mapsSection({ runs, A, theme, size, u, tag }) {
  const withG = runs.filter(([, r]) => r?.grids?.max_depth && (r.analysis?.geo ?? r.checks?.geo)); if (!withG.length) return null;
  const us = u.len === 'ft', dl = (m) => (us ? `${Math.round(m * 100 / 2.54)}` : `${Math.round(m * 100)}`), dU = us ? 'in' : 'cm', width = size?.width ?? 640, figs = [], rows = [];
  const depthLabels = band(DEPTH, dl, ''), blue = seqColors(DEPTH.length, theme), time = seqColors(5, theme), red = seqColors(6, theme, 'red');
  for (const [role, r] of withG) {
    const g = r.analysis?.geo ?? r.checks.geo, G = r.grids, N = g.nx * g.ny, A1 = (r.geo?.dx ?? 1) ** 2, t = tag(role);
    const dBin = (k) => binOf(DEPTH, G.max_depth[k]), wet15 = (k) => G.max_depth[k] >= 0.15;
    figs.push({ name: `map_depth_${role}`, svg: binnedMapSvg(dBin, blue, depthLabels, g, { width, theme, title: `${t}: peak depth`, unit: `peak depth, ${dU}` }) });
    if (r.hazard) figs.push({ name: `map_hazard_${role}`, svg: binnedMapSvg((k) => (r.hazard[k] >= 1 && r.hazard[k] <= 6 && G.max_depth[k] >= 0.05 ? r.hazard[k] - 1 : -1), red, HZ, g, { width, theme, title: `${t}: worst hazard class (ARR 2019 / AIDR), where over 5 cm`, unit: 'H1 safe … H6 unsafe for buildings' }) });
    if (G.t_wet) figs.push({ name: `map_arrival_${role}`, svg: binnedMapSvg((k) => (wet15(k) && G.t_wet[k] >= 0 ? binOf(ARRIVE, G.t_wet[k] / 60) : -1), [...time].reverse(), band(ARRIVE, (v) => `${v}`, ''), g, { width, theme, title: `${t}: when the water arrived (first over 5 cm), where it reached 15 cm`, unit: 'minutes from the start; the strongest colour is soonest' }) });
    if (G.t_above15) figs.push({ name: `map_duration_${role}`, svg: binnedMapSvg((k) => (G.t_above15[k] > 0 ? binOf(STAY, G.t_above15[k] / 60) : -1), time, band(STAY, (v) => `${v}`, ''), g, { width, theme, title: `${t}: time deeper than 15 cm`, unit: 'minutes' }) });
    const dA = DEPTH.map(() => 0), hA = HZ.map(() => 0);
    for (let k = 0; k < N; k++) { if (g.bld?.[k]) continue; const b = dBin(k); if (b >= 0) dA[b] += A1; const h = r.hazard?.[k]; if (h >= 1 && h <= 6) hA[h - 1] += A1; }
    const sq = (m2) => m2 * u.L(1) ** 2;
    rows.push({ run: t, ...Object.fromEntries(dA.map((a, b) => ['d' + b, sq(a)])), ...Object.fromEntries(hA.map((a, h) => ['h' + h, sq(a)])) });
  }
  const before = withG.find(([role]) => role === 'before')?.[1], after = withG.find(([role]) => role === 'after')?.[1];
  if (A && before && after && before.grids.max_depth.length === after.grids.max_depth.length) {
    figs.push({ name: 'map_depth_change', svg: diffSvg(before.grids.max_depth, after.grids.max_depth, after.analysis?.geo ?? after.checks.geo, { width, theme, title: 'After − before: change in peak depth where either reached 15 cm', unit: 'change in peak depth, cm' }) });
  }
  const aU = `${u.len}²`;
  return {
    id: 'maps', title: 'Flood maps',
    note: `From the 1 m output grids (buildings grey). Peak depth: the deepest the water got in each cell over the run (cells peak at different times). Hazard: the worst ARR 2019 / AIDR class of depth, speed and depth × speed (${HZ.map((h, i) => `${h} ${HZ_NOTE[i]}`).join('; ')}). ` +
      'Arrival: when a cell first got deeper than 5 cm, shown where it went on to reach 15 cm. Duration: the time a cell stayed deeper than 15 cm.' + (A ? ' Change: after − before on the scenario’s ground, red deeper, blue shallower, grey within 3 cm.' : '') +
      ' The grids themselves are in the run folder (grids/) and the export package, to check any cell.',
    figures: figs,
    tables: [{ name: 'flood_extent', title: 'Area by peak depth and by hazard class', cols: [['run', 'run'], ...depthLabels.map((l, b) => ['d' + b, `${aU}_depth_${l.replace(/\s/g, '')}_${dU}`, 0]), ...HZ.map((h, i) => ['h' + i, `${aU}_${h}`, 0])], rows }],
  };
}

/** The streets section, or null when no run has street stats. */
export function streetsSection({ runs, theme, size, u, tag }) {
  const withS = runs.filter(([, r]) => r?.analysis?.streets?.length); if (!withS.length) return null;
  const L = (m) => u.L(m), min = (s) => s / 60, figs = [], rows = [], totals = [];
  for (const [role, r] of withS) {
    const S = r.analysis.streets, t = tag(role), top = S.filter(s => s.wade > 0).slice(0, 12);
    if (top.length) figs.push({ name: `streets_${role}`, svg: R.barChart(top.map(s => ({ label: s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name, value: L(s.stall), text: `${L(s.stall).toFixed(0)} ${u.len} · max ${L(s.maxDepth).toFixed(2)}` })),
      { title: `${t}: street length too deep for most cars (≥ 30 cm)`, unit: u.len, theme, width: size?.width ?? 640 }) });
    for (const s of S.filter(s => s.maxDepth >= 0.05).slice(0, 40)) rows.push({ run: t, name: s.name, kind: s.kind, length: L(s.length), wade: L(s.wade), stall: L(s.stall), share: 100 * s.stall / s.length, max: L(s.maxDepth), arrival: min(s.arrival), over15: min(s.over15), speed: L(s.speed) });
    const T = S.reduce((a, s) => ({ n: a.n + 1, len: a.len + s.length, wade: a.wade + s.wade, stall: a.stall + s.stall, cut: a.cut + (s.stall > 0 ? 1 : 0) }), { n: 0, len: 0, wade: 0, stall: 0, cut: 0 });
    totals.push({ run: t, n: T.n, cut: T.cut, len: L(T.len), wade: L(T.wade), stall: L(T.stall), share: T.len ? 100 * T.stall / T.len : 0 });
  }
  return {
    id: 'streets', title: 'Streets and access',
    note: 'Each mapped street (OpenStreetMap, by name; unnamed ones by kind) sampled every cell along its centreline, where traffic drives. 15 cm: passable only to emergency and high vehicles; 30 cm: most cars float or stall. ' +
      'Arrival: the first time water got deeper than 5 cm on it; longest over 15 cm: the longest any point on it stayed that deep (how long it is cut). Water in the gutter is deeper than at the crown: see Gutter spread for the inlets.',
    figures: figs,
    tables: [
      { name: 'streets', title: 'Flooding along each street', cols: [['run', 'run'], ['name', 'street'], ['kind', 'kind'], ['length', `length_${u.len}`, 0], ['wade', `length_over_15_cm_${u.len}`, 0], ['stall', `length_over_30_cm_${u.len}`, 0], ['share', 'over_30_cm_%', 0], ['max', `deepest_${u.len}`, 2], ['arrival', 'arrival_min', 0], ['over15', 'longest_over_15_cm_min', 0], ['speed', `max_speed_${u.len}/s`, 2]], rows },
      { name: 'street_totals', title: 'Streets in total', cols: [['run', 'run'], ['n', 'streets', 0], ['cut', 'streets_with_30_cm', 0], ['len', `length_${u.len}`, 0], ['wade', `over_15_cm_${u.len}`, 0], ['stall', `over_30_cm_${u.len}`, 0], ['share', 'over_30_cm_%', 1]], rows: totals },
    ],
  };
}
