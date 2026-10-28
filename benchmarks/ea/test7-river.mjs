// EA Test 7 river data (Upton-upon-Severn): sections, spacing, inflow and rating, shared by the browser case and the
// river-only check below.  Usage (check): node benchmarks/ea/test7-river.mjs
import { parseSections, riverINP } from '../../src/river.js';

/** Downstream rating at M054 (flow m³/s, water level m), decoded from Test7-DSRatingCurve (an .xls despite the name). */
export const RATING_M054 = [[0, 2.02], [0.028, 2.22], [0.046, 2.27], [0.145, 2.37], [0.211, 2.42], [0.448, 2.52], [0.583, 2.57], [0.757, 2.62],
  [0.98, 2.67], [1.219, 2.72], [3.904, 2.97], [13.089, 3.47], [15.45, 3.57], [24.788, 3.92], [34.545, 4.22], [38.181, 4.32], [83.078, 5.27],
  [128.011, 6.02], [134.558, 6.12], [204.77, 7.07], [212.572, 7.17], [246.726, 7.62], [269.22, 7.92], [407.506, 9.12], [538.188, 10.13],
  [554.072, 10.26], [588.533, 10.66], [598.597, 10.75], [616.391, 10.91], [632.851, 11.19], [658.811, 11.38], [712.399, 11.83], [1370.36, 14.83]];

/** River model inputs from the Test 7 files (loader: text(path)). */
export async function test7River(text) {
  const dir = 'Test7_dataset_2010/';
  const secs = parseSections(await text(dir + 'Test7-1DXS.txt'));
  const loc = new Map((await text(dir + 'Test7-1DLoc-Spacing.csv')).split(/\r?\n/).slice(1).filter(Boolean)
    .map(l => l.split(',')).map(([id, x, y, d]) => [id.trim(), { x: +x, y: +y, dist: +d }]));
  const sections = secs.map(s => ({ ...s, ...loc.get(s.name) }));
  if (sections.some(s => s.x == null)) throw new Error('section without a location');
  const inflow = (await text(dir + 'Test7-USInflow.csv')).split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(',').map(Number)).map(([h, q]) => [h * 3600, q]);
  return { sections, inflow, rating: RATING_M054, n: 0.028, initWL: 9.8 };
}

if (globalThis.process?.argv?.[1]?.endsWith('test7-river.mjs')) {
  const { readFileSync } = await import('node:fs');
  const { loadSWMM, SWMM } = await import('../../src/swmm.js');
  const D = new URL('./data/', import.meta.url);
  const r = await test7River(async (p) => readFileSync(new URL(p, D), 'utf8'));
  const inp = riverINP(r.sections, { ...r, durationS: 72 * 3600, wallTop: 25, banks: process.argv[2] !== 'lumped' });
  const swmm = await loadSWMM(); swmm.open(inp);
  const watch = ['M015', 'M025', 'M035', 'M045'].map(n => [n, swmm.index('NODE', n)]), log = {};
  for (const [n] of watch) log[n] = [];
  for (let t = 3600; t <= 72 * 3600; t += 3600) { swmm.stepTo(t); for (const [n, i] of watch) log[n].push(swmm.node('HEAD', i)); }
  const rpt = swmm.finish();
  for (const [n] of watch) { const v = log[n], pk = Math.max(...v); console.log(`${n}: peak ${pk.toFixed(2)} m at ${v.indexOf(pk) + 1} h; 10 h ${v[9].toFixed(2)}, 20 h ${v[19].toFixed(2)}, 30 h ${v[29].toFixed(2)}, 72 h ${v[71].toFixed(2)}`); }
  console.log('SWMM continuity', SWMM.continuity(rpt));
}
