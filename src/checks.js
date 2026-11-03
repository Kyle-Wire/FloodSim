// Defensibility checks on a finished run, for the report. The model edge: how much of the flooding reaches it (a free
// outfall there lets water leave that might have pooled, and ground beyond it that drains in is missing), and which
// observed marks and drawn features sit close to it. Sensitivity: a batch study's variants (roughness, infiltration,
// rain, cell size) against the base run, cell by cell. And the list of checks with a status each, so a reviewer sees in
// one table what was tested and what needs a look.

import { binnedMapSvg, binOf } from './maps.js';
const SIDES = ['N', 'E', 'S', 'W'];

/**
 * Distance (m) from each cell centre to the model edge: the grid's border, or a cell outside the area (inside[k] = 0,
 * a polygon area's outside). Two-pass chamfer (1, √2); outside cells are 0, a cell on the border is half a cell in.
 */
export function edgeDistance(nx, ny, dx, inside = null) {
  const N = nx * ny, d = new Float32Array(N), R2 = Math.SQRT2;
  for (let k = 0; k < N; k++) d[k] = inside && !inside[k] ? 0 : 1e9;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : d[j * nx + i]); // beyond the border is outside
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (d[k] === 0) continue;
    d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + R2, at(i + 1, j - 1) + R2);
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; if (d[k] === 0) continue;
    d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + R2, at(i - 1, j + 1) + R2);
  }
  for (let k = 0; k < N; k++) d[k] = d[k] === 0 ? 0 : (d[k] - 0.5) * dx;
  return d;
}

/**
 * Flooding at the model edge. The edge cells are the inside cells next to the outside (or on the border); each is put on
 * a side (N, E, S, W): by the border it is on, else by its bearing from the area's centre. → { threshold, near, flooded
 * (m² ≥ threshold), nearArea (of it within `near` m of the edge), nearShare, edgeLength, edgeWet (m of edge ≥ threshold),
 * maxEdgeDepth, sides: { N: { length, wet, maxDepth } … } }
 */
export function edgeCheck(maxDepth, dist, { nx, ny, dx, threshold = 0.15, near = 50 } = {}) {
  const A1 = dx * dx, sides = Object.fromEntries(SIDES.map(s => [s, { length: 0, wet: 0, maxDepth: 0 }]));
  let cx = 0, cy = 0, n = 0;
  for (let k = 0; k < nx * ny; k++) if (dist[k] > 0) { cx += k % nx; cy += (k / nx) | 0; n++; }
  cx /= n || 1; cy /= n || 1;
  let flooded = 0, nearArea = 0, edgeLength = 0, edgeWet = 0, maxEdgeDepth = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, e = dist[k]; if (!(e > 0)) continue;
    const d = maxDepth[k], wet = d >= threshold;
    if (wet) { flooded += A1; if (e <= near) nearArea += A1; }
    if (e > 0.5 * dx + 1e-6) continue; // not an edge cell
    const side = j === 0 ? 'N' : j === ny - 1 ? 'S' : i === 0 ? 'W' : i === nx - 1 ? 'E' : bearingSide(i - cx, cy - j);
    const s = sides[side]; s.length += dx; edgeLength += dx;
    if (wet) { s.wet += dx; edgeWet += dx; }
    if (d > s.maxDepth) s.maxDepth = d;
    if (d > maxEdgeDepth) maxEdgeDepth = d;
  }
  return { threshold, near, flooded, nearArea, nearShare: flooded > 0 ? nearArea / flooded : 0, edgeLength, edgeWet, maxEdgeDepth, sides };
}
const bearingSide = (x, y) => { const a = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; return a < 45 || a >= 315 ? 'N' : a < 135 ? 'E' : a < 225 ? 'S' : 'W'; };

/**
 * Points (high-water marks, drawn features' vertices) within `near` m of the edge. items: [{ name, kind, points:
 * [[lon, lat]] }]; toCell([lon, lat]) → [x, y] on the grid (cells) or a cell index. → [{ name, kind, dist }] nearest first
 */
export function nearEdge(items, toCell, dist, nx, ny, near = 50) {
  const out = [];
  for (const it of items) {
    let best = Infinity;
    for (const p of it.points ?? []) {
      const c = toCell(p), k = Array.isArray(c) ? (c[0] >= 0 && c[1] >= 0 && c[0] < nx && c[1] < ny ? Math.floor(c[1]) * nx + Math.floor(c[0]) : -1) : c;
      const e = k >= 0 && k < nx * ny ? dist[k] : 0; // off the grid: at (or past) the edge
      if (e < best) best = e;
    }
    if (best <= near) out.push({ name: it.name, kind: it.kind, dist: best });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/**
 * One run against another on the same 1 m grid (a variant against the base). Cells flooded (peak depth ≥ threshold) in
 * either: their overlap (the fit F = both / either), the area and peak-water volume of each, and the change in peak
 * depth over them (mean, mean absolute, 95th percentile absolute, largest up and down, the share changed by more than
 * 10 cm). → { areaA, areaB, volA, volB, fit, bias, meanAbs, p95Abs, maxUp, maxDown, over10, maxA, maxB }
 */
export function compareDepths(a, b, { dx = 1, threshold = 0.15, skip = null } = {}) {
  const A1 = dx * dx, dd = [];
  let nA = 0, nB = 0, both = 0, volA = 0, volB = 0, maxA = 0, maxB = 0, sum = 0, sumAbs = 0, maxUp = 0, maxDown = 0, over10 = 0;
  for (let k = 0; k < a.length; k++) {
    if (skip?.[k]) continue;
    const x = a[k] > 0 ? a[k] : 0, y = b[k] > 0 ? b[k] : 0;
    volA += x * A1; volB += y * A1; if (x > maxA) maxA = x; if (y > maxB) maxB = y;
    const wa = x >= threshold, wb = y >= threshold; if (!wa && !wb) continue;
    if (wa) nA++; if (wb) nB++; if (wa && wb) both++;
    const d = y - x; dd.push(Math.abs(d)); sum += d; sumAbs += Math.abs(d);
    if (d > maxUp) maxUp = d; if (d < maxDown) maxDown = d; if (Math.abs(d) > 0.10) over10++;
  }
  const n = dd.length, s = Float32Array.from(dd).sort();
  return { areaA: nA * A1, areaB: nB * A1, volA, volB, fit: n ? both / n : 1, bias: n ? sum / n : 0, meanAbs: n ? sumAbs / n : 0, p95Abs: n ? s[Math.min(n - 1, Math.floor(0.95 * n))] : 0, maxUp, maxDown, over10: n ? over10 / n : 0, maxA, maxB };
}

/** How much an output moves for a move in an input: (Δout / out) / (Δin / in). NaN when either base is 0. */
export const elasticity = (out0, out1, dIn) => (out0 > 0 && dIn ? (out1 / out0 - 1) / dIn : NaN);
/** The relative change of the input each batch variant makes (src/batch.js VARIANTS); null when it is not a number. */
export const VARIANT_STEP = { 'n-20': -0.2, 'n+20': 0.2, 'infil-50': -0.5, 'rain+10': 0.1, coarse: null };
/** The forcing part (src/compare.js FORCING_PARTS) each variant changes: a variant run may differ from its base there only. */
export const VARIANT_PART = { 'n-20': 'drainage', 'n+20': 'drainage', 'infil-50': 'drainage', 'rain+10': 'storm', coarse: 'grid' };
/** The forcing parts that differ between two fingerprints ({ parts: { name: hash } }), leaving out `except` and the commit. */
export const partsDiffer = (fa, fb, except = []) => Object.keys({ ...fa?.parts, ...fb?.parts }).filter(k => k !== 'commit' && !except.includes(k) && fa?.parts?.[k] !== fb?.parts?.[k]);

/**
 * The sensitivity table: base and variants (each { key, label, maxDepth, damage: totals or null }) → per variant the
 * compareDepths result, the changes in flooded area, volume, damage and buildings with water above the floor, and
 * the elasticities. → [{ key, label, step, cmp, dArea, dVol, dDamage, dAbove, eArea, eDamage }]
 */
export function sensitivity(base, variants, { dx = 1, threshold = 0.15, skip = null } = {}) {
  return variants.map(v => {
    const cmp = compareDepths(base.maxDepth, v.maxDepth, { dx, threshold, skip }), step = VARIANT_STEP[v.key] ?? null;
    const rel = (p, q) => (p > 0 ? q / p - 1 : NaN), D0 = base.damage, D1 = v.damage;
    return { key: v.key, label: v.label, dir: v.dir ?? null, step, cmp, dArea: rel(cmp.areaA, cmp.areaB), dVol: rel(cmp.volA, cmp.volB),
      dDamage: D0 && D1 ? rel(D0.total, D1.total) : NaN, dAbove: D0 && D1 ? D1.aboveFloor - D0.aboveFloor : NaN,
      eArea: step ? elasticity(cmp.areaA, cmp.areaB, step) : NaN, eDamage: step && D0 && D1 ? elasticity(D0.total, D1.total, step) : NaN };
  });
}

// thresholds for the checks' status (fractions unless named)
export const LIMITS = {
  edgeShare: [0.05, 0.20],     // flooded area within `near` m of the edge, of all flooded
  edgeWet: [0.02, 0.10],       // edge length flooded, of the edge
  outflow: [0.05, 0.25],       // water out across the edge, of the rain (and inflow)
  upstream: [0.02, 0.25],      // ground outside that drains in, of the area
  mass: [1e-3, 1e-2],          // |surface books| relative
  left: [0.5, 0.8],            // water left at the end, of the peak volume
  fit: [0.9, 0.75],            // sensitivity: the fit of the cell-size variant (lower is worse)
  p95: [0.05, 0.15],           // sensitivity: 95th percentile |Δ depth| (m) of the cell-size variant
};
const grade = (v, [ok, bad], lowerIsWorse = false) => (!Number.isFinite(v) ? 'n/a' : lowerIsWorse ? (v >= ok ? 'ok' : v >= bad ? 'check' : 'problem') : (v <= ok ? 'ok' : v <= bad ? 'check' : 'problem'));
const pct = (v, dp = 0) => `${(100 * v).toFixed(dp)} %`;

/**
 * The checks for one run, each { group, check, status: 'ok' | 'check' | 'problem' | 'n/a' | 'info' (reported, no pass mark), value, means }.
 * input: { edge (edgeCheck), books ({ rain, outflow, inflow? }), mass ({ surface, combined }), watershed ({ upstreamArea,
 * studyArea, river, onWatershed } or null), left ({ final, peak } m³), points (nearEdge of the HWMs), features (nearEdge of
 * the drawn features), sens (sensitivity rows or null), sensVersions (their commits differ), runLength ({ stop, storm } s), tideEdges }
 */
export function checkList(x, L = LIMITS) {
  const rows = [], add = (group, check, status, value, means) => rows.push({ group, check, status, value, means });
  const e = x.edge;
  if (e) {
    const worst = SIDES.filter(s => e.sides[s].wet > 0).sort((p, q) => e.sides[q].wet - e.sides[p].wet).map(s => `${s} ${Math.round(e.sides[s].wet)} m`).join(', ');
    add('Model edge', `Flooding within ${e.near} m of the edge`, grade(e.nearShare, L.edgeShare), `${pct(e.nearShare)} of ${Math.round(e.flooded).toLocaleString()} m² flooded`,
      'Water near a free-outfall edge may leave the model where it would have pooled, or be fed by ground beyond the edge; a large share means move or widen the area.');
    add('Model edge', `Edge flooded ≥ ${Math.round(e.threshold * 100)} cm`, grade(e.edgeLength > 0 ? e.edgeWet / e.edgeLength : 0, L.edgeWet), `${Math.round(e.edgeWet)} of ${Math.round(e.edgeLength)} m${worst ? ` (${worst})` : ''}, deepest ${e.maxEdgeDepth.toFixed(2)} m`,
      x.tideEdges ? 'The tide boundary holds the water level on the tidal edges: wet edge there is expected; elsewhere the flood may continue past the edge.' : 'The flood may continue past the edge here: its extent and depth beyond it are not modelled.');
  }
  if (x.books && x.books.rain > 0) {
    const inn = x.books.rain + (x.books.inflow ?? 0), share = (x.books.outflow ?? 0) / inn;
    add('Model edge', 'Water out across the edge', grade(share, L.outflow), `${pct(share, 1)} of the water in (${Math.round(x.books.outflow ?? 0).toLocaleString()} m³)`,
      'Free outfall at the edge: the share leaving the model without being routed further. Large where the area cuts across a flow path.');
  }
  const w = x.watershed;
  if (w) {
    const share = w.onWatershed ? 0 : w.upstreamArea / Math.max(1, w.studyArea);
    add('Inflow', 'Ground outside that drains in', grade(share, L.upstream), w.onWatershed ? 'none: the model runs on its watershed' : `${Math.round(w.upstreamArea / 1e4).toLocaleString()} ha (${pct(share)} of the area)`,
      'Surface runoff from outside the area is not in the model unless it runs on the watershed or has an inflow (River inflow: a gauged river, or an ungauged one from StreamStats); a large share understates the flooding.');
    if (w.river) add('Inflow', 'A river enters from a large basin', x.inflow ? 'ok' : 'problem', x.inflow ? `inflow set: ${x.inflow}` : 'no inflow set', 'Its flow is in the model only with a gauged or ungauged river inflow.');
  } else add('Inflow', 'Ground outside that drains in', 'n/a', 'watershed not traced', 'Trace the watershed (Area) to see whether ground outside drains into the area.');
  if (x.mass) {
    add('Mass balance', 'Surface water books', grade(Math.abs(x.mass.surface ?? 0), L.mass), `${((x.mass.surface ?? 0) * 100).toExponential(1)} %`, 'Rain + inflow − infiltration − outflow − storage, over the water in: should be near round-off.');
    if (x.mass.combined != null) add('Mass balance', 'Surface and sewer books', grade(Math.abs(x.mass.combined), L.mass), `${(x.mass.combined * 100).toFixed(3)} %`, 'The same with the pipe network’s storage and outfalls.');
  }
  if (x.left && x.left.peak > 0) {
    const f = x.left.final / x.left.peak;
    add('Run length', 'Water left at the end', grade(f, L.left), `${pct(f)} of the peak water volume`, 'Much water still standing (ponds aside) can mean the run stopped before the flood peaked or drained; run longer to be sure of the peaks.');
  }
  if (x.runLength?.stop && x.runLength.storm) {
    const after = x.runLength.stop - x.runLength.storm;
    add('Run length', 'Run past the end of the rain', after >= 3600 ? 'ok' : after >= 1800 ? 'check' : 'problem', `${(after / 60).toFixed(0)} min`, 'Peaks downstream come after the rain stops; give the water time to arrive.');
  }
  if (x.points) add('Observations', 'High-water marks near the edge', x.points.length ? 'check' : 'ok', x.points.length ? x.points.map(p => `${p.name} (${Math.round(p.dist)} m)`).join(', ') : 'none within 50 m', 'A mark near the edge scores the boundary as much as the model.');
  if (x.features) add('Design', 'Drawn features near the edge', x.features.length ? 'check' : 'ok', x.features.length ? x.features.map(p => `${p.name} (${Math.round(p.dist)} m)`).join(', ') : 'none within 50 m', 'A feature near the edge has its effect cut off there: widen the area to see its full impact.');
  if (x.sens?.length) {
    for (const s of x.sens) {
      if (s.key === 'coarse') {
        add('Sensitivity', 'One cell size coarser: overlap', grade(s.cmp.fit, L.fit, true), `fit ${s.cmp.fit.toFixed(2)}`, 'Flooded cells in both runs over flooded in either: below 0.9 the results depend on the cell size.');
        add('Sensitivity', 'One cell size coarser: depth change', grade(s.cmp.p95Abs, L.p95), `95 % of cells within ${s.cmp.p95Abs.toFixed(2)} m`, 'A grid-converged model changes little with the cell size.');
      } else add('Sensitivity', s.label, 'info', `area ${fmtRel(s.dArea)}, damage ${fmtRel(s.dDamage)}, |Δ depth| p95 ${s.cmp.p95Abs.toFixed(2)} m`, 'How much the results move with this input: report the spread with the results.');
    }
    if (x.sensVersions) add('Sensitivity', 'Base and variants from one FloodSim version', 'check', 'the runs were made with different commits', 'A code change between the runs is mixed into the differences: rerun the base and the variants together.');
  } else add('Sensitivity', 'Sensitivity runs', 'n/a', 'none saved for this storm and inputs', 'Run a batch study with the variants (roughness ± 20 %, infiltration × 0.5, rain + 10 %, cell size) and every other input as in this run (tide, sewers, inflow) to fill this.');
  return rows;
}
export const fmtRel = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(100 * v).toFixed(1)} %` : '–');

// ---- the difference map (SVG): Δ peak depth, variant − base, on a diverging scale with buildings grey
export const DIFF_BINS = [[-Infinity, -0.30], [-0.30, -0.10], [-0.10, -0.03], [-0.03, 0.03], [0.03, 0.10], [0.10, 0.30], [0.30, Infinity]];
// arms from the palette's neutral to its blue and red poles; the no-change bin a step darker than that neutral, so the
// extent still shows on the map's white (or dark) ground
const POLES = { light: { neutral: '#f0efec', mid: '#c4c1b8', low: '#2a78d6', high: '#e34948' }, dark: { neutral: '#383835', mid: '#5c5b56', low: '#3987e5', high: '#e66767' } };
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
/** The seven colours of DIFF_BINS: shallower (blue) through no change (grey) to deeper (red), three steps an arm. */
export const diffColors = (theme = 'light') => { const P = POLES[theme === 'dark' ? 'dark' : 'light']; return [1, 2 / 3, 1 / 3].map(t => mix(P.neutral, P.low, t)).concat([P.mid], [1 / 3, 2 / 3, 1].map(t => mix(P.neutral, P.high, t))); };

/** The map of b − a over the cells flooded (≥ threshold) in either, buildings grey, with its legend (src/maps.js). */
export function diffSvg(a, b, geo, { threshold = 0.15, width = 640, theme = 'light', title = '', unit = 'change in peak depth, cm' } = {}) {
  const bin = (k) => (a[k] >= threshold || b[k] >= threshold ? binOf(DIFF_BINS, (b[k] > 0 ? b[k] : 0) - (a[k] > 0 ? a[k] : 0)) : -1);
  return binnedMapSvg(bin, diffColors(theme), ['< −30', '−30…−10', '−10…−3', '±3', '3…10', '10…30', '> 30'], geo, { width, theme, title, unit });
}
