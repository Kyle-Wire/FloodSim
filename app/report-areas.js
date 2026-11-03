// Report section: flooded areas (src/areas.js on the run record, rec.analysis.areas). The peak depth split into
// connected areas, each described: where it is (its streets), how big and deep, how much water, when it arrives and how
// long it stays, how fast and how hazardous, the buildings it reaches and their damage, what is left at the end. A map
// of the areas, their volumes, and one table row per area; a before / after pair gets both runs' areas and a totals row.
import * as R from '../src/report.js';
import { areasSvg, BANDS } from '../src/areas.js';

// categorical slots in fixed order (validated: scripts/validate_palette.js, light and dark); areas past the eighth are grey
export const AREA_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] };
const HZ = ['dry', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

/**
 * The section ({ id, title, note, figures, tables }) for app/report-ui.js, or null when no run has been analysed.
 * runs: [[role, record]]; A: the before run (or null); u: display units; tag(role) → 'Before' | 'After' | 'Run'.
 */
export function areasSection({ runs, A, theme, size, u, tag }) {
  const withA = runs.filter(([, r]) => r?.analysis?.areas); if (!withA.length) return null;
  const sq = (m2) => m2 * u.L(1) ** 2, aU = `${u.len}²`, min = (s) => s / 60, figs = [], rows = [], totals = [];
  for (const [role, r] of withA) {
    const an = r.analysis, ar = an.areas, top = ar.areas.slice(0, 12);
    figs.push({ name: `areas_map_${role}`, svg: areasSvg(ar, an.geo, { width: size?.width ?? 640, colors: AREA_COLORS[theme === 'dark' ? 'dark' : 'light'], theme, title: `${tag(role)}: areas with peak depth ≥ ${Math.round(ar.threshold * 100)} cm (buildings grey)` }) });
    if (top.length) figs.push({ name: `areas_volume_${role}`, svg: R.barChart(top.map(a => ({ label: a.name, value: u.V(a.volume), text: `${u.V(a.volume).toFixed(0)} ${u.vol}, max ${u.L(a.maxDepth).toFixed(2)} ${u.len}` })), { title: `${tag(role)}: peak water volume per area`, unit: u.vol, theme, width: size?.width ?? 640 }) });
    for (const a of ar.areas) {
      const st = a.streets.slice(0, 3).map(s => `${s.name}${s.deep > 0 ? ` (${u.L(s.deep).toFixed(0)} ${u.len} ≥ 30 cm)` : ''}`).join('; ');
      rows.push({ run: tag(role), area: a.name, where: `${a.lonlat[1].toFixed(5)}, ${a.lonlat[0].toFixed(5)}`, streets: st || '–', size: sq(a.area), volume: u.V(a.volume), maxD: u.L(a.maxDepth), meanD: u.L(a.meanDepth),
        bands: a.bands.map(b => sq(b).toFixed(0)).join(' / '), arrival: min(a.arrival), dur: min(a.durationMax), speed: u.L(a.speedMax), dv: a.dvMax * u.L(1) ** 2, hazard: HZ[a.hazardMax],
        bld: a.buildings, struct: a.structures ?? 0, above: a.aboveFloor ?? 0, people: a.peopleNight ?? 0, damage: a.damage, left: Number.isFinite(a.drained) ? 100 * (1 - a.drained) : NaN, edge: a.edgeCells ? `yes (${a.edgeCells} cells)` : 'no' });
    }
    const T = ar.areas.reduce((t, a) => ({ n: t.n + 1, area: t.area + a.area, vol: t.vol + a.volume, deep: t.deep + a.streetDeep, bld: t.bld + a.buildings, above: t.above + (a.aboveFloor ?? 0) }), { n: 0, area: 0, vol: 0, deep: 0, bld: 0, above: 0 });
    totals.push({ run: tag(role), n: T.n, area: sq(T.area), vol: u.V(T.vol), deep: u.L(T.deep), bld: T.bld, above: T.above, edge: ar.areas.filter(a => a.edgeCells).map(a => a.name).join(', ') || 'none' });
  }
  const th = withA[0][1].analysis.areas.threshold, bandTxt = BANDS.map(([lo, hi]) => (hi === Infinity ? `≥ ${u.L(lo).toFixed(1)}` : `${u.L(lo).toFixed(1)}–${u.L(hi).toFixed(1)}`)).join(' / ');
  return {
    id: 'areas', title: 'Flooded areas',
    note: `Each area is a connected patch of cells whose peak depth reached ${Math.round(th * 100)} cm (buildings excluded, 4-connected, at least 50 m²), ranked by the water it held at the peak (the sum over its cells of peak depth × area; cells peak at different times, so this is an upper bound on the water there at any one moment). ` +
      `Arrival: the first cell deeper than 5 cm. Duration: the longest time any cell stayed deeper than 15 cm. Hazard: the worst ARR 2019 / AIDR class in the area (H1 safe for all, H6 unsafe for buildings). Speed and depth × velocity: the area's peaks, where at least 5 cm deep. ` +
      `Buildings: OSM footprints touching the area; structures: USACE NSI structures in or next to it, those with water above the first floor, and their damage (the Damages section). Streets: mapped centrelines through the area, with the length deeper than 30 cm (most cars float or stall). Left at the end: water still there when the run stopped, as a share of the peak. ` +
      `An area touching the model edge may continue outside it: check the edge before relying on its size.`,
    figures: figs,
    tables: [
      { name: 'flooded_areas', title: 'Flooded areas', cols: [['run', 'run'], ['area', 'area'], ['where', 'centre_lat_lon'], ['streets', 'streets_deep_length'], ['size', `size_${aU}`, 0], ['volume', `volume_${u.vol}`, 0], ['maxD', `max_depth_${u.len}`, 2], ['meanD', `mean_depth_${u.len}`, 2],
        ['bands', `${aU}_at_${bandTxt}_${u.len}`], ['arrival', 'arrival_min', 0], ['dur', 'longest_over_15_cm_min', 0], ['speed', `max_speed_${u.len}/s`, 2], ['dv', `max_dv_${u.len}²/s`, 2], ['hazard', 'worst_hazard'], ['bld', 'buildings_touched', 0],
        ['struct', 'nsi_structures', 0], ['above', 'water_above_floor', 0], ['people', 'people_there_at_night', 0], ['damage', 'damage_usd', 0], ['left', 'left_at_the_end_%', 0], ['edge', 'at_the_model_edge']], rows },
      { name: 'flooded_area_totals', title: A ? 'Flooded areas, before and after' : 'Flooded areas in total', cols: [['run', 'run'], ['n', 'areas', 0], ['area', `flooded_${aU}`, 0], ['vol', `volume_${u.vol}`, 0], ['deep', `street_length_min_30_cm_${u.len}`, 0], ['bld', 'buildings_touched', 0], ['above', 'water_above_floor', 0], ['edge', 'areas_at_the_edge']], rows: totals },
    ],
  };
}
