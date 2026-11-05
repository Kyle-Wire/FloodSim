// The coupled 1D–2D verification cases of benchmark1d2d (github.com/scott-jeffers/benchmark1d2d,
// test_catalog/track_a/coupled_1d2d, "analytic-public"): a manhole surcharging onto a street, a flooded yard draining
// into a pipe, and a surcharge that returns down the manhole. Each answer follows exactly from continuity or the
// geometry, so the cases score the exchange itself: what moves between the pipes and the ground, and that none is
// made or lost on the way. Geometry and scoring thresholds are the catalog's (inputs/coupling.json, manifest.json).
//
// Translation to FloodSim: 1 m cells, as the catalog's surface grids. The manhole is an inlet on the cell holding its
// point (the cell north-east of a point on a cell corner). The catalog's rim or crest above that cell's bed is the
// inlet's crest (A12-011's gully lip, 5 cm above the yard); a rim below the bed (A12-012's cone apex) lowers the cell.
// Weir and orifice as the catalog gives them: Q = Cw·P·h^1.5·√(2g) and Co·A·√(2gh), P 1.885 m, A 0.283 m².

const MH = { perimeter: 1.884956, area: 0.282743, cw: 0.5, co: 0.6 };

export const CASES = {
  'A12-010': {
    title: 'Manhole surcharge onto a sloping street',
    nx: 200, ny: 10, dx: 1, manning: 0.02, bed: (x) => 1.0 - 0.005 * x, bc: { east: 'outflow' }, // free outfall: Manning flow on the surface slope
    manhole: { x: 25, y: 5, crest: 0.875, ...MH }, tEnd: 1800,
    nodes: [{ name: 'J0', invert: -1.0, depth: 10.0 }, { name: 'M1', invert: -1.125, depth: 2.0, manhole: true }, { name: 'CAP', invert: -1.125, outfall: 'FIXED 50 YES' }],
    pipes: [{ name: 'P1', from: 'J0', to: 'M1', length: 50, D: 0.6, n: 0.013 }, { name: 'STUB', from: 'M1', to: 'CAP', length: 1, D: 0.1, n: 0.013 }],
    inflow: { node: 'J0', series: [[0, 0.5], [1800, 0.5]] },
    probes: [{ id: 'P1', x: 100.5, y: 5 }, { id: 'P2', x: 150.5, y: 5 }],
    score: (r) => [
      { id: 'exchange_flow', what: 'manhole outflow onto the street, last 5 min (m³/s)', value: r.exchangeLast5, expected: 0.5, ok: Math.abs(r.exchangeLast5 / 0.5 - 1) <= 0.01, tol: '±1 %' },
      ...r.probes.map(p => ({ id: 'street_depth ' + p.id, what: `street depth at x = ${p.x} m, t = 1800 s (m)`, value: p.h, expected: 0.07768, ok: Math.abs(p.h - 0.07768) <= 0.003, tol: '±3 mm' })),
    ],
  },
  'A12-011': {
    title: 'Flood draining into a pipe',
    nx: 30, ny: 30, dx: 1, manning: 0.02, bed: () => 0, bc: {}, level0: 0.3,
    manhole: { x: 15, y: 15, crest: 0.05, ...MH }, tEnd: 7200,
    nodes: [{ name: 'M1', invert: -2.0, depth: 2.05, manhole: true }, { name: 'O1', invert: -3.0, outfall: 'FREE' }],
    pipes: [{ name: 'P1', from: 'M1', to: 'O1', length: 100, D: 0.3, n: 0.013 }],
    probes: [{ id: 'P1', x: 5, y: 5 }, { id: 'P2', x: 25, y: 25 }],
    score: (r) => [
      ...r.probes.map(p => ({ id: 'final_level ' + p.id, what: `yard level at (${p.x}, ${p.y}), t = 7200 s (m)`, value: p.wl, expected: 0.05, ok: Math.abs(p.wl - 0.05) <= 0.01, tol: '±1 cm' })),
      { id: 'discharged_volume', what: 'volume out of the outfall (m³)', value: r.outfallVolume, expected: 225, ok: Math.abs(r.outfallVolume / 225 - 1) <= 0.02, tol: '±2 %' },
    ],
  },
  'A12-012': {
    title: 'Surcharge onto the surface and back',
    nx: 20, ny: 20, dx: 1, manning: 0.02, bed: (x, y) => 0.01 * Math.hypot(x - 10, y - 10), bc: {},
    manhole: { x: 10, y: 10, crest: 0.0, ...MH }, tEnd: 10800,
    nodes: [{ name: 'J0', invert: -2.0, depth: 10.0 }, { name: 'M1', invert: -2.2, depth: 2.2, manhole: true }, { name: 'O1', invert: -3.2, outfall: 'FREE' }],
    pipes: [{ name: 'P1', from: 'J0', to: 'M1', length: 50, D: 0.5, n: 0.013 }, { name: 'P2', from: 'M1', to: 'O1', length: 100, D: 0.25, n: 0.013 }],
    inflow: { node: 'J0', series: [[0, 0], [600, 0.3], [1200, 0], [10800, 0]] },
    probes: [{ id: 'P1', x: 10, y: 10 }],
    score: (r) => [
      { id: 'discharged_volume', what: 'volume out of the outfall (m³)', value: r.outfallVolume, expected: 180, ok: Math.abs(r.outfallVolume / 180 - 1) <= 0.02, tol: '±2 %' },
      { id: 'surface_empty', what: 'water left on the surface, t = 10800 s (m³)', value: r.surfaceEnd, expected: 0, ok: r.surfaceEnd <= 1.8, tol: '≤ 1.8 m³' },
    ],
  },
};

/** The water entering the pipes from the inflow series (m³), trapezoidal (SWMM interpolates linearly). */
export const inflowVolume = (c) => (c.inflow ? c.inflow.series.reduce((a, [t, q], i, s) => (i ? a + (t - s[i - 1][0]) * (q + s[i - 1][1]) / 2 : 0), 0) : 0);

const pad = (s, n) => String(s).padEnd(n);
const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** SWMM .inp for a case, with the options the app writes (src/drainage.js toINP). pressurise: the manhole can pressurise (two-way exchange) instead of spilling at its rim. */
export function caseINP(c, { pressurise = false } = {}) {
  const L = ['[TITLE]', `${c.title} (benchmark1d2d, FloodSim translation)`, '', '[OPTIONS]', 'FLOW_UNITS CMS', 'FLOW_ROUTING DYNWAVE', 'LINK_OFFSETS DEPTH',
    'ALLOW_PONDING NO', 'START_DATE 01/01/2000', 'START_TIME 00:00:00', 'REPORT_START_DATE 01/01/2000', 'REPORT_START_TIME 00:00:00',
    'END_DATE 01/01/2000', `END_TIME ${hms(c.tEnd)}`, 'REPORT_STEP 00:01:00', 'WET_STEP 00:01:00', 'DRY_STEP 00:01:00', 'ROUTING_STEP 1', 'VARIABLE_STEP 0.75',
    'LENGTHENING_STEP 1', 'MIN_SURFAREA 1.2', 'NORMAL_FLOW_LIMITED BOTH', 'INERTIAL_DAMPING PARTIAL', 'SURCHARGE_METHOD SLOT', 'MIN_SLOPE 0', 'MAX_TRIALS 8',
    'HEAD_TOLERANCE 0.0015', 'THREADS 1', '', '[JUNCTIONS]', ';;Name  Elevation  MaxDepth  InitDepth  SurDepth  Aponded'];
  for (const n of c.nodes.filter(n => !n.outfall)) L.push(`${pad(n.name, 8)} ${n.invert} ${n.depth} 0 ${n.manhole && !pressurise ? 0 : 30} 0`);
  L.push('', '[OUTFALLS]', ';;Name  Elevation  Type  StageData  Gated');
  for (const n of c.nodes.filter(n => n.outfall)) L.push(`${pad(n.name, 8)} ${n.invert} ${n.outfall.startsWith('FIXED') ? n.outfall : 'FREE NO'}`);
  L.push('', '[CONDUITS]', ';;Name  From  To  Length  Roughness  InOffset  OutOffset  InitFlow  MaxFlow');
  for (const p of c.pipes) L.push(`${pad(p.name, 8)} ${pad(p.from, 6)} ${pad(p.to, 6)} ${p.length} ${p.n} 0 0 0 0`);
  L.push('', '[XSECTIONS]', ';;Link  Shape  Geom1  Geom2  Geom3  Geom4  Barrels');
  for (const p of c.pipes) L.push(`${pad(p.name, 8)} CIRCULAR ${p.D} 0 0 0 1`);
  if (c.inflow) {
    L.push('', '[INFLOWS]', ';;Node  Constituent  TimeSeries  Type  Mfactor  Sfactor  Baseline  Pattern', `${c.inflow.node} FLOW TS_IN FLOW 1.0 1.0`);
    L.push('', '[TIMESERIES]', ';;Name  Time(h)  Value', ...c.inflow.series.map(([t, q]) => `TS_IN ${(t / 3600).toFixed(6)} ${q}`));
  }
  L.push('', '[REPORT]', 'INPUT NO', 'CONTROLS NO', 'SUBCATCHMENTS NONE', 'NODES NONE', 'LINKS NONE', '');
  return L.join('\n');
}
