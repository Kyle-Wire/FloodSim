// Run defensibility-check tests (src/checks.js): distance to the model edge on a rectangle and a polygon area against
// hand values, flooding at the edge by side, points near the edge, one run against another cell by cell (fit, changes,
// percentiles), sensitivity rows and elasticities, the checks' statuses at their thresholds, the difference map; the
// report maps (src/maps.js): ramps, binned map SVG, flooding along streets.
//   node tests/run-checks-tests.mjs
import * as K from '../src/checks.js';
import * as M from '../src/maps.js';
import * as B from '../src/batch.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

{ // edge distance
  const nx = 9, ny = 7, d = K.edgeDistance(nx, ny, 2);
  check('edge distance: a border cell is half a cell in', d[0] === 1 && d[3 * nx] === 1 && d[nx - 1] === 1, `${d[0]}, ${d[3 * nx]}`);
  check('edge distance: the centre of a 9 × 7 grid is 3.5 cells from the nearest (N/S) edge', near(d[3 * nx + 4], 3.5 * 2, 1e-6), `${d[3 * nx + 4]}`);
  check('edge distance: diagonal steps cost √2 (the chamfer never beats straight-line distance)', [...d].every((v, k) => { const i = k % nx, j = (k / nx) | 0; return v <= (Math.min(i, j, nx - 1 - i, ny - 1 - j) + 0.5) * 2 + 1e-6; }));
  const inside = new Uint8Array(nx * ny); for (let j = 1; j < 6; j++) for (let i = 1; i < 8; i++) inside[j * nx + i] = 1; // a polygon one cell in from the border
  const p = K.edgeDistance(nx, ny, 1, inside);
  check('edge distance: outside a polygon area is 0; its first row inside is half a cell in', p[0] === 0 && p[nx + 1] === 0.5 && p[3 * nx + 4] === 2.5, `${p[nx + 1]}, ${p[3 * nx + 4]}`);
}

{ // flooding at the edge
  const nx = 20, ny = 10, d = K.edgeDistance(nx, ny, 1), depth = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < 4; i++) depth[j * nx + i] = 0.4; // a pond against the west edge
  for (let j = 4; j < 6; j++) for (let i = 9; i < 11; i++) depth[j * nx + i] = 0.5; // one in the middle
  const e = K.edgeCheck(depth, d, { nx, ny, dx: 1, threshold: 0.15, near: 2 });
  check('edge: flooded area and the share within 2 m of the edge (two west columns, and two rows top and bottom)', e.flooded === 44 && e.nearArea === 2 * ny + 8, `${e.flooded}, ${e.nearArea}`);
  check('edge: sides by the border (north row first, then west); wet length and depth', e.sides.W.wet === ny - 2 && e.sides.N.wet === 4 && e.sides.S.wet === 4 && e.sides.E.wet === 0 && near(e.maxEdgeDepth, 0.4, 1e-6),
    `W ${e.sides.W.wet}, N ${e.sides.N.wet}, S ${e.sides.S.wet}`);
  check('edge: total edge length is the perimeter in cells', e.edgeLength === 2 * nx + 2 * (ny - 2), `${e.edgeLength}`);
}

{ // near the edge
  const nx = 50, ny = 50, d = K.edgeDistance(nx, ny, 1);
  const items = [{ name: 'a', kind: 'HWM', points: [[2, 25]] }, { name: 'b', kind: 'HWM', points: [[25, 25]] }, { name: 'c', kind: 'pond', points: [[25, 25], [48, 10]] }, { name: 'off', kind: 'HWM', points: [[-5, 3]] }];
  const out = K.nearEdge(items, (p) => p, d, nx, ny, 10);
  check('near edge: points within 10 m, nearest first; a feature by its nearest vertex; off the grid counts as at the edge', out.map(o => o.name).join() === 'off,c,a' && near(out[2].dist, 2.5, 1e-6), out.map(o => `${o.name} ${o.dist}`).join(', '));
}

{ // one run against another
  const a = new Float32Array([0, 0.2, 0.4, 0.6, 0.0, 0.1]), b = new Float32Array([0, 0.25, 0.4, 0.3, 0.2, 0.1]);
  const c = K.compareDepths(a, b, { dx: 2, threshold: 0.15 });
  // flooded in a: cells 1,2,3; in b: 1,2,3,4; either: 4, both: 3
  check('compare: areas and fit', c.areaA === 12 && c.areaB === 16 && c.fit === 0.75, `${c.areaA} ${c.areaB} ${c.fit}`);
  check('compare: changes over the cells flooded in either (mean, mean |Δ|, extremes, share over 10 cm)', near(c.bias, (0.05 + 0 - 0.3 + 0.2) / 4, 1e-6) && near(c.meanAbs, 0.55 / 4, 1e-6) && near(c.maxUp, 0.2, 1e-6) && near(c.maxDown, -0.3, 1e-6) && c.over10 === 0.5);
  check('compare: volumes over every cell', near(c.volA, 1.3 * 4, 1e-5) && near(c.volB, 1.25 * 4, 1e-5));
  const big = new Float32Array(1000).map((_, k) => 0.2 + k / 1000), shift = big.map((v, k) => v + (k < 950 ? 0.01 : 0.5));
  check('compare: the 95th percentile of |Δ| ignores the top 5 %', near(K.compareDepths(big, shift).p95Abs, 0.5, 1e-6) && near(K.compareDepths(big, big.map((v, k) => v + (k < 960 ? 0.01 : 0.5))).p95Abs, 0.01, 1e-6));
  const skip = new Uint8Array(6); skip[4] = 1;
  check('compare: skipped cells (buildings) are left out', K.compareDepths(a, b, { dx: 2, skip }).fit === 1);
}

{ // sensitivity rows
  const base = { key: 'base', maxDepth: new Float32Array([0.2, 0.2, 0, 0]), damage: { total: 1000, aboveFloor: 2 } };
  const v = [{ key: 'rain+10', label: 'Rain + 10 %', maxDepth: new Float32Array([0.3, 0.2, 0.2, 0]), damage: { total: 1500, aboveFloor: 3 } }, { key: 'coarse', label: 'Coarser', maxDepth: new Float32Array([0.2, 0.2, 0, 0]), damage: null }];
  const [r, c] = K.sensitivity(base, v);
  check('sensitivity: area +50 % from rain +10 %: elasticity 5; damage +50 %: elasticity 5', near(r.dArea, 0.5, 1e-9) && near(r.eArea, 5, 1e-9) && near(r.dDamage, 0.5, 1e-9) && near(r.eDamage, 5, 1e-9) && r.dAbove === 1);
  check('sensitivity: the cell-size variant has no input step and no elasticity', c.step === null && Number.isNaN(c.eArea) && c.cmp.fit === 1 && Number.isNaN(c.dDamage));
}

{ // the checks
  const edge = { threshold: 0.15, near: 50, flooded: 1000, nearArea: 30, nearShare: 0.03, edgeLength: 400, edgeWet: 4, maxEdgeDepth: 0.2, sides: { N: { length: 100, wet: 4, maxDepth: 0.2 }, E: { length: 100, wet: 0, maxDepth: 0 }, S: { length: 100, wet: 0, maxDepth: 0 }, W: { length: 100, wet: 0, maxDepth: 0 } } };
  const base = { edge, books: { rain: 1000, outflow: 30 }, mass: { surface: 1e-8, combined: null }, watershed: { upstreamArea: 0, studyArea: 1e5, river: false }, left: { peak: 100, final: 20 }, runLength: { stop: 3 * 3600, storm: 3600 }, points: [], features: [], sens: null };
  const st = (x) => Object.fromEntries(K.checkList(x).map(r => [r.check, r.status]));
  const s0 = st(base);
  check('checks: a clean run is OK throughout but sensitivity (not tested)', Object.entries(s0).every(([k, v]) => (k === 'Sensitivity runs' ? v === 'n/a' : v === 'ok')), JSON.stringify(s0));
  const s1 = st({ ...base, edge: { ...edge, nearShare: 0.3, edgeWet: 60 }, books: { rain: 1000, outflow: 300 }, watershed: { upstreamArea: 5e4, studyArea: 1e5, river: true }, left: { peak: 100, final: 90 }, runLength: { stop: 4000, storm: 3600 } });
  check('checks: an area cut across a flow path is flagged (edge, outflow, upstream ground, a river without inflow, the run too short)',
    s1['Flooding within 50 m of the edge'] === 'problem' && s1['Edge flooded ≥ 15 cm'] === 'problem' && s1['Water out across the edge'] === 'problem' && s1['Ground outside that drains in'] === 'problem' && s1['A river enters from a large basin'] === 'problem' && s1['Water left at the end'] === 'problem' && s1['Run past the end of the rain'] === 'problem', JSON.stringify(s1));
  const s2 = st({ ...base, edge: { ...edge, nearShare: 0.1 }, watershed: { upstreamArea: 5e4, studyArea: 1e5, river: false, onWatershed: true }, points: [{ name: 'HWM 3', dist: 12 }] });
  check('checks: in-between values are "check"; on the watershed nothing drains in; a mark near the edge', s2['Flooding within 50 m of the edge'] === 'check' && s2['Ground outside that drains in'] === 'ok' && s2['High-water marks near the edge'] === 'check');
  const cmp = (fit, p95) => ({ key: 'coarse', label: 'Coarser', cmp: { fit, p95Abs: p95 }, dArea: 0, dDamage: NaN });
  const s3 = st({ ...base, sens: [cmp(0.95, 0.03)] }), s4 = st({ ...base, sens: [cmp(0.7, 0.2)] });
  check('checks: grid convergence from the cell-size variant (fit and p95 |Δ depth|)', s3['One cell size coarser: overlap'] === 'ok' && s3['One cell size coarser: depth change'] === 'ok' && s4['One cell size coarser: overlap'] === 'problem' && s4['One cell size coarser: depth change'] === 'problem');
  check('checks: base and variants from different versions are flagged', st({ ...base, sens: [cmp(0.95, 0.03)], sensVersions: true })['Base and variants from one FloodSim version'] === 'check');
  const f = (h) => ({ parts: { storm: 'a', drainage: h, grid: 'g', commit: h } });
  check('variants: only the part a variant changes may differ (commit aside)', K.partsDiffer(f('x'), f('y'), [K.VARIANT_PART['n+20']]).length === 0 && K.partsDiffer(f('x'), f('y'), [K.VARIANT_PART.coarse]).join() === 'drainage');
  check('checks: missing inputs are "not tested"', st({ ...base, watershed: null })['Ground outside that drains in'] === 'n/a');
}

{ // the difference map
  const nx = 40, ny = 20, a = new Float32Array(nx * ny).fill(0.2), b = a.map((v, k) => v + ((k % nx) - 20) / 50), bld = new Uint8Array(nx * ny); bld[5] = 1;
  const svg = K.diffSvg(a, b, { nx, ny, bld }, { title: 'x & y' });
  const cols = K.diffColors('light');
  check('diff map: seven colours, grey midpoint (a step darker, to show the extent), blue arm to red arm', cols.length === 7 && cols[3] === '#c4c1b8' && cols[0] === '#2a78d6' && cols[6] === '#e34948');
  check('diff map: every bin drawn, buildings, a legend and an escaped title', cols.every(c => svg.includes(`fill="${c}"`)) && svg.includes('fill="#dfe2e6"') && svg.includes('> 30') && svg.includes('change in peak depth, cm') && svg.includes('x &amp; y') && svg.startsWith('<svg') && svg.endsWith('</svg>'));
  check('diff map: dark theme from its own poles', K.diffColors('dark')[3] === '#5c5b56' && K.diffSvg(a, b, { nx, ny }, { theme: 'dark' }).includes('#121a24'));
}

{ // report maps and streets (src/maps.js)
  const b = M.seqColors(5, 'light'), d = M.seqColors(5, 'dark');
  check('ramps: five steps, light to dark on light, dark to light on dark', b.length === 5 && b[0] === '#a8c9ef' && b[4] === '#0d3a75' && d[0] === '#2b5583' && d[4] === '#b9d7fb');
  check('bins: [lo, hi), outside or NaN is −1', M.binOf([[0, 1], [1, 2]], 1) === 1 && M.binOf([[0, 1]], 1) === -1 && M.binOf([[0, 1]], NaN) === -1);
  const nx = 10, ny = 4, v = new Float32Array(nx * ny).map((_, k) => (k % nx) / 10), bld = new Uint8Array(nx * ny); bld[9] = 1;
  const cols = M.seqColors(3), svg = M.binnedMapSvg((k) => M.binOf([[0, 0.3], [0.3, 0.6], [0.6, 2]], v[k]), cols, ['a', 'b', 'c'], { nx, ny, bld }, { title: 'T', unit: 'u' });
  const runsOf = (c) => { const m = svg.match(new RegExp(`<path d="([^"]*)" fill="${c}"`)); return m ? m[1].split('M').length - 1 : 0; };
  check('binned map: one row run per bin per row, buildings their own path, legend with a building swatch', runsOf(cols[0]) === ny && runsOf(cols[1]) === ny && runsOf(cols[2]) === ny && runsOf('#dfe2e6') === 1 && svg.includes('>building<') && svg.includes('>u<'), `${runsOf(cols[0])} ${runsOf(cols[2])}`);
  const g = { nx: 6, ny: 3, maxDepth: new Float32Array(18), tWet: new Float32Array(18).fill(NaN), tAbove15: new Float32Array(18), maxSpeed: new Float32Array(18) };
  for (let i = 0; i < 6; i++) { g.maxDepth[6 + i] = i < 3 ? 0.4 : i < 5 ? 0.2 : 0.02; g.tWet[6 + i] = 100 * (6 - i); g.tAbove15[6 + i] = i < 5 ? 300 + i : 0; g.maxSpeed[6 + i] = i / 10; }
  const S = M.streetStats([{ name: 'Main', kind: 'residential', line: [[0, 1.5], [6, 1.5]] }, { name: '', kind: 'service', line: [[0, 0.5], [6, 0.5]] }], g, { dx: 2 });
  const m = S[0];
  check('streets: length, over 15 and 30 cm, deepest, by name; unnamed by kind', m.name === 'Main' && m.length === 12 && m.wade === 10 && m.stall === 6 && Math.abs(m.maxDepth - 0.4) < 1e-6 && S[1].name === 'unnamed service' && S[1].wade === 0, JSON.stringify(m));
  check('streets: arrival is the earliest wetting where 5 cm deep; longest over 15 cm; top speed where 5 cm deep', m.arrival === 200 && m.over15 === 304 && Math.abs(m.speed - 0.4) < 1e-6, `${m.arrival} ${m.over15} ${m.speed}`);
}

{ // batch: a design-storm-only variant is not run on a historic storm (it would change nothing and read as no sensitivity)
  const jobs = B.expandJobs({ storms: [{ label: '10-yr 1 h', stormSrc: 'a14', inputs: { ari: '10' } }, { label: 'Storm as set', stormSrc: 'current', inputs: {} }], variants: [B.VARIANTS.base, B.VARIANTS['rain+10'], B.VARIANTS['n+20']] });
  check('batch: rain + 10 % runs on design storms only', jobs.length === 5 && !jobs.some(j => j.storm.stormSrc === 'current' && j.variant.key === 'rain+10'), jobs.map(j => j.label).join(' | '));
}

console.log(fails ? `\n${fails} FAILED` : '\nall checks tests passed');
process.exit(fails ? 1 : 0);
