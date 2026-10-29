// Window reruns (phase 4 of docs/specs/site-design-mode.md): rerun a design change on a window around the site only,
// with the edges fed from the existing-conditions run.
//
//   the window   a rectangle of solver cells around the site (its boundary, else the design's features) plus a buffer;
//                cells outside it become sinks (as outside a polygon area), take no rain, and stay inactive
//   the edges    the existing-conditions run books the flow across the window's edge in segments of ~20 m, every step
//                (control-line faces, + outward); the window run puts each segment's inflow back into the cells just
//                inside it as it came, and lets outflow leave freely
//   the network  inlets outside the window replay the existing run's exchange (so the pipes carry what they did)
//   the check    the window run books the same segments: where its outflow differs from the existing run's, the design
//                changed the flow at the edge, and the window should be wider (backwater does not reach upstream)
// Results outside the window are the existing run's: the merged record compares like a full one inside the window.
// Pure functions; solver-cell coordinates (x east, y south, cell centres at +0.5).

/** The window around a box of solver cells [i0, j0, i1, j1] (inclusive), grown by `buffer` cells, kept 2 cells off the edge. */
export function windowRect([i0, j0, i1, j1], buffer, nx, ny) {
  const b = Math.max(0, Math.round(buffer));
  return { i0: Math.max(2, Math.floor(i0) - b), j0: Math.max(2, Math.floor(j0) - b), i1: Math.min(nx - 3, Math.ceil(i1) + b), j1: Math.min(ny - 3, Math.ceil(j1) + b) };
}
/** 1 inside the window, 0 outside (solver grid). */
export function insideMask(r, nx, ny) {
  const m = new Uint8Array(nx * ny);
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) m[j * nx + i] = 1;
  return m;
}
/**
 * The window's edge in segments of about `seg` cells, each a polyline on the cell boundary drawn so that + (to its
 * right, src/compare.js lineFaces) is outward, with the cells just inside it (where its inflow goes back in; each
 * corner cell in one of its two segments).
 * → [{ side: 'N' | 'E' | 'S' | 'W', line: [[x, y], [x, y]], cells: [k…] }]
 */
export function windowSegments(r, nx, seg = 20) {
  const out = [], n = (len) => Math.max(1, Math.round(len / seg)), split = (a, b, k) => Array.from({ length: k }, (_, s) => [a + (b - a) * s / k, a + (b - a) * (s + 1) / k]);
  const W = r.i0, E = r.i1 + 1, N = r.j0, S = r.j1 + 1; // boundary lines in cell coordinates
  const cellsX = (x0, x1, j) => { const c = []; for (let i = Math.ceil(Math.min(x0, x1) - 1e-9); i < Math.max(x0, x1) - 1e-9; i++) c.push(j * nx + i); return c; };
  const cellsY = (y0, y1, i) => { const c = []; for (let j = Math.ceil(Math.min(y0, y1) - 1e-9); j < Math.max(y0, y1) - 1e-9; j++) c.push(j * nx + i); return c; };
  // right of the direction (dx, dy) is (−dy, dx): north edge westward, west edge southward, south edge eastward, east edge northward
  for (const [a, b] of split(E, W, n(E - W))) out.push({ side: 'N', line: [[a, N], [b, N]], cells: cellsX(a, b, r.j0) });
  for (const [a, b] of split(N, S, n(S - N))) out.push({ side: 'W', line: [[W, a], [W, b]], cells: cellsY(a, b, r.i0) });
  for (const [a, b] of split(W, E, n(E - W))) out.push({ side: 'S', line: [[a, S], [b, S]], cells: cellsX(a, b, r.j1) });
  for (const [a, b] of split(S, N, n(S - N))) out.push({ side: 'E', line: [[E, a], [E, b]], cells: cellsY(a, b, r.i1) });
  const seen = new Set(); for (const o of out) o.cells = o.cells.filter(k => !seen.has(k) && seen.add(k)); // a corner cell in one segment only (one inlet per cell)
  return out;
}
/**
 * A rate function (m³/s) from a line's cumulative samples [[t, net, plus, minus], …]: column 3 = the volume to its −
 * side (inward for a window segment), 2 = to its + side. Constant over each sampling interval, 0 outside them.
 */
export function rateOf(samples, col = 3) {
  const t = samples.map(s => s[0]), v = samples.map(s => s[col]);
  return (x) => {
    if (!(x > t[0]) || x > t.at(-1)) return 0;
    let a = 0, b = t.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (t[m] < x) a = m; else b = m; }
    return t[b] > t[a] ? Math.max(0, (v[b] - v[a]) / (t[b] - t[a])) : 0;
  };
}
/** Cumulative volume at time x from samples [[t, v…]] (column `col`), linear between samples. */
export function volumeAt(samples, x, col = 1) {
  if (!samples.length || x <= samples[0][0]) return samples[0]?.[col] ?? 0;
  if (x >= samples.at(-1)[0]) return samples.at(-1)[col];
  let a = 0, b = samples.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (samples[m][0] <= x) a = m; else b = m; }
  const [ta, tb] = [samples[a][0], samples[b][0]]; return samples[a][col] + (samples[b][col] - samples[a][col]) * (x - ta) / (tb - ta || 1);
}
/**
 * The check: per segment, the outflow (+) volume and peak of the window run against the existing run's. A segment is
 * changed when the volume differs by more than `tol` of the larger, and at least `minVol` m³.
 * → { segments: [{ k, side, baseVol, winVol, rel, changed }], changed, maxRel, baseOut, winOut }
 */
export function checkWindow(base, win, { tol = 0.05, minVol = 1 } = {}) {
  let bo = 0, wo = 0, maxRel = 0;
  const segments = base.map((b, k) => {
    const w = win[k], bv = b.plus ?? 0, wv = w?.plus ?? 0, big = Math.max(bv, wv), rel = big > 0 ? Math.abs(wv - bv) / big : 0;
    bo += bv; wo += wv; if (big >= minVol) maxRel = Math.max(maxRel, rel);
    return { k, side: b.side ?? null, baseVol: bv, winVol: wv, rel, changed: big >= minVol && rel > tol };
  });
  return { segments, changed: segments.filter(s => s.changed).length, maxRel, baseOut: bo, winOut: wo };
}
/** Merged 1 m grids: the window run's inside the window (`inside`, fine cells), the existing run's elsewhere. */
export function mergeGrids(base, win, inside) {
  const out = {};
  for (const [k, g] of Object.entries(win)) { const b = base[k]; if (!b) { out[k] = g; continue; } const m = Float32Array.from(b); for (let p = 0; p < m.length; p++) if (inside[p]) m[p] = g[p]; out[k] = m; }
  return out;
}
/** Fine (1 m) cells inside a solver-cell window (cell factor F). */
export function fineInside(r, fnx, fny, F) {
  const m = new Uint8Array(fnx * fny);
  for (let j = r.j0 * F; j < Math.min(fny, (r.j1 + 1) * F); j++) for (let i = r.i0 * F; i < Math.min(fnx, (r.i1 + 1) * F); i++) m[j * fnx + i] = 1;
  return m;
}
