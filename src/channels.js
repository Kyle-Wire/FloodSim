// Channel and culvert conditioning of the terrain (Phase 2).
//
// Bare-earth lidar removes bridges but keeps the road embankments that streams pass under in culverts, so a mapped
// stream that should flow becomes a dam. Fixes from OpenStreetMap waterways:
//   culverts  ways tagged tunnel=culvert become culvert links between their two ends (src/links.js); the barrel size
//             comes from the diameter / width tags or a default by waterway class
//   snapping  each open waterway is first moved onto the 1 m thalweg: the least-cost path over the DEM within 15 m of
//             the mapped line, cost rising steeply with height above the corridor's floor. NHD-sourced lines often run
//             along a bank 1-2 m above the bed, so the profile along the mapped line misses what is in the channel
//   breaching along the snapped path, a short rise in the bed between two lower points is cut down to a straight grade
//             between them: a road embankment over an unmapped culvert (≤ 30 m, ≤ 4 m), or a short, low hump with no
//             road that spans the whole valley floor (0.5-1.5 m, ≤ 30 m: a bridge deck the lidar kept, a culverted
//             driveway, an artefact). Lower humps (riffles), higher or longer ones (real ridges), and ones the water
//             can get round lower down are terrain and stay
import { toCells } from './ingest.js';

/** Default culvert diameter (m) by waterway class when OSM has no size. */
export const CULVERT_D = { river: 3.0, canal: 2.5, stream: 1.2, brook: 1.0, ditch: 0.6, drain: 0.6 };

/** OSM culvert size: `diameter` (mm when > 20, else m) or `width` (m); else the class default. */
export function culvertDiameter(tags = {}, kind = 'stream') {
  const d = Number.parseFloat(tags.diameter), w = Number.parseFloat(tags.width);
  if (d > 0) return d > 20 ? d / 1000 : d;
  if (w > 0 && w < 15) return w;
  return CULVERT_D[kind] ?? 0.9;
}

/** The fine cells a mapped line passes through, in order, one per step, without repeats. */
export function mappedCells(fine, f, line) {
  const { nx, ny } = f, path = [], pts = toCells(fine, line);
  for (let s = 0; s + 1 < pts.length; s++) {
    const [x0, y0] = pts[s], [x1, y1] = pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let q = 0; q <= n; q++) {
      const i = Math.floor(x0 + (x1 - x0) * q / n), j = Math.floor(y0 + (y1 - y0) * q / n);
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const k = j * nx + i; if (path[path.length - 1] !== k) path.push(k);
    }
  }
  return path;
}

// binary min-heap of (cost, id) with lazy deletion
class Heap {
  constructor() { this.c = new Float64Array(1024); this.v = new Int32Array(1024); this.n = 0; this.top = 0; }
  push(c, v) {
    if (this.n === this.c.length) { const c2 = new Float64Array(this.n * 2), v2 = new Int32Array(this.n * 2); c2.set(this.c); v2.set(this.v); this.c = c2; this.v = v2; }
    let i = this.n++; const C = this.c, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (C[p] <= c) break; C[i] = C[p]; V[i] = V[p]; i = p; }
    C[i] = c; V[i] = v;
  }
  pop() { // → id; this.top = its cost
    const C = this.c, V = this.v, v = V[0]; this.top = C[0];
    const c = C[--this.n], x = V[this.n]; let i = 0;
    for (;;) { let m = 2 * i + 1; if (m >= this.n) break; if (m + 1 < this.n && C[m + 1] < C[m]) m++; if (C[m] >= c) break; C[i] = C[m]; V[i] = V[m]; i = m; }
    C[i] = c; V[i] = x; return v;
  }
}
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Move a mapped line onto the 1 m thalweg: the least-cost 8-connected path over the fine DEM through the corridor of
 * open cells within `corridor` m of the mapped cells, from the cross-section at its first mapped cell to the one at its
 * last. A step costs its length × (exp(h / scale) + pull · d / corridor), h = height above the lowest open ground within
 * the corridor around the nearest mapped cell, d = distance from that cell: a cell 1 m up the bank costs e⁴ ≈ 55 times
 * one on the bed, and the weak pull keeps the path by the mapped line where the bed is flat across.
 * @param path mapped cells (mappedCells), downstream
 * @returns { path, offset } — the snapped cells and their mean distance from the mapped line (m); null if no route
 */
export function snapThalweg(fine, f, path, { corridor = 15, scale = 0.25, pull = 0.1, maxCells = 4e6, from = -1 } = {}) {
  const { nx, ny, z } = f, R = Math.max(1, Math.round(corridor / fine.dx)), R2 = R * R;
  if (path.length < 2) return { path: path.slice(), offset: 0 };
  let i0 = nx, i1 = -1, j0 = ny, j1 = -1;
  for (const k of path) { const i = k % nx, j = (k / nx) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  i0 = Math.max(0, i0 - R); i1 = Math.min(nx - 1, i1 + R); j0 = Math.max(0, j0 - R); j1 = Math.min(ny - 1, j1 + R);
  const W = i1 - i0 + 1, H = j1 - j0 + 1;
  if (W * H > maxCells && path.length > 4 * R) { // a long diagonal line: snap it in halves, the second from where the first ended
    const m = path.length >> 1, o = { corridor, scale, pull, maxCells };
    const a = snapThalweg(fine, f, path.slice(0, m + 1), { ...o, from }); if (!a) return null;
    const b = snapThalweg(fine, f, path.slice(m), { ...o, from: a.path[a.path.length - 1] }); if (!b) return null;
    const n = a.path.length + b.path.length - 1;
    return { path: a.path.concat(b.path.slice(1)), offset: (a.offset * a.path.length + b.offset * (b.path.length - 1)) / n };
  }
  const open = (k) => !f.bld?.[k];
  // the corridor: each cell's nearest mapped cell (owner), distance² to it, and the floor around that mapped cell
  const L = W * H, d2 = new Float32Array(L).fill(Infinity), owner = new Int32Array(L).fill(-1), floor = new Float32Array(L);
  const floorAt = new Float32Array(path.length);
  for (let s = 0; s < path.length; s++) {
    const ci = path[s] % nx, cj = (path[s] / nx) | 0; let lo = Infinity;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ci + di, j = cj + dj; if (di * di + dj * dj > R2 || i < i0 || j < j0 || i > i1 || j > j1) continue;
      const k = j * nx + i; if (open(k) && z[k] < lo) lo = z[k];
    }
    floorAt[s] = lo;
  }
  for (let s = 0; s < path.length; s++) {
    const ci = path[s] % nx, cj = (path[s] / nx) | 0;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ci + di, j = cj + dj, dd = di * di + dj * dj; if (dd > R2 || i < i0 || j < j0 || i > i1 || j > j1) continue;
      const l = (j - j0) * W + (i - i0); if (!open(j * nx + i) || dd >= d2[l]) continue;
      d2[l] = dd; owner[l] = s; floor[l] = floorAt[s];
    }
  }
  const last = path.length - 1, toL = (k) => (((k / nx) | 0) - j0) * W + (k % nx) - i0;
  const cost = new Float64Array(L).fill(Infinity), prev = new Int32Array(L).fill(-1), heap = new Heap();
  // start from the cross-section at the first mapped cell (or the cell the previous half ended on)
  if (from >= 0) { const l = toL(from); if (owner[l] >= 0) { cost[l] = 0; heap.push(0, l); } }
  else for (let l = 0; l < L; l++) if (owner[l] === 0) { cost[l] = 0; heap.push(0, l); }
  let end = -1;
  while (heap.n) {
    const l = heap.pop(); if (heap.top > cost[l]) continue;
    if (owner[l] === last) { end = l; break; }
    const li = l % W, lj = (l / W) | 0;
    for (const [di, dj] of NB) {
      const i = li + di, j = lj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const m = j * W + i; if (owner[m] < 0) continue;
      const h = Math.min(10, Math.max(0, z[(j + j0) * nx + i + i0] - floor[m]));
      const c = cost[l] + (di && dj ? Math.SQRT2 : 1) * (Math.exp(h / scale) + pull * Math.sqrt(d2[m]) / R);
      if (c < cost[m]) { cost[m] = c; prev[m] = l; heap.push(c, m); }
    }
  }
  if (end < 0) return null;
  const out = []; let off = 0;
  for (let l = end; l >= 0; l = prev[l]) { out.push((((l / W) | 0) + j0) * nx + (l % W) + i0); off += Math.sqrt(d2[l]); }
  out.reverse();
  return { path: out, offset: off / out.length * fine.dx };
}

/** Lowest level (m) at which water gets from path cell a to path cell b through open ground within `pad` cells of the
 *  stretch between them: the crest of the lowest way over or round the hump, which the path may cross higher up. */
export function spillLevel(f, path, a, b, pad) {
  const { nx, ny, z } = f;
  let i0 = nx, i1 = -1, j0 = ny, j1 = -1;
  for (let m = a; m <= b; m++) { const i = path[m] % nx, j = (path[m] / nx) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  i0 = Math.max(0, i0 - pad); i1 = Math.min(nx - 1, i1 + pad); j0 = Math.max(0, j0 - pad); j1 = Math.min(ny - 1, j1 + pad);
  const W = i1 - i0 + 1, H = j1 - j0 + 1, lev = new Float64Array(W * H).fill(Infinity), heap = new Heap();
  const toL = (k) => (((k / nx) | 0) - j0) * W + (k % nx) - i0, start = toL(path[a]), goal = toL(path[b]);
  lev[start] = z[path[a]]; heap.push(lev[start], start);
  while (heap.n) {
    const l = heap.pop(); if (heap.top > lev[l]) continue;
    if (l === goal) return lev[l];
    const li = l % W, lj = (l / W) | 0;
    for (const [di, dj] of NB) {
      const i = li + di, j = lj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const m = j * W + i, k = (j + j0) * nx + i + i0; if (f.bld?.[k]) continue;
      const v = Math.max(lev[l], z[k]); if (v < lev[m]) { lev[m] = v; heap.push(v, m); }
    }
  }
  return Infinity;
}

/**
 * Breach short obstructions along open waterways on the fine (1 m) grid, in place, after moving each line onto the
 * thalweg (snapThalweg). Walking downstream from each low point to the next point at or below it, the hump between is
 * graded straight if it has no building and is either
 *   a road embankment  some cell is road; ≤ maxLength long and ≤ maxHeight high; or
 *   a fill             no road; ≤ fill.length long (where it stands more than `tol` above its upstream foot); its crest
 *                      fill.min-fill.max above the foot, the crest being the lowest level at which water gets past it
 *                      within `corridor` m (so it spans the valley floor); and not the top of a ridge the walk has
 *                      climbed onto (no ground more than fill.min below its foot in the fill.length upstream).
 * The cut is `width` m wide (a band of cells around the path): three 1 m cells always hold a whole 2 m solver cell,
 * so the cut survives coarsening (src/terrain.js coarsen averages the 1 m ground), where a 1 m trench would be half lost.
 * @param f     fine model from buildFine (z, bld, road)
 * @param lines [{ line: [[lon, lat]…], kind }] in their mapped (downstream) direction
 * @returns { breaches, fills, cells, volume, snapped, offset, paths, cuts } — road embankments and fills cut, cells
 *          lowered, volume removed (m³), lines snapped, their mean distance from the mapped line (m), the cell paths
 *          walked, and each cut { kind: 'road'|'fill', k (crest cell), foot, crest, length (m) }
 */
export function breachChannels(fine, f, lines, { maxLength = 30, maxHeight = 4, tol = 0.15, fill = { min: 0.5, max: 2, length: 40 }, snap = true, corridor = 15, width = 3 } = {}) {
  const { nx } = f, dx = fine.dx, A = dx * dx, pad = Math.round(corridor / dx), reach = Math.max(maxLength, fill.length);
  const half = Math.max(0, Math.round((width / dx - 1) / 2)); // cells either side of the path in the cut
  const span = (p, q) => dx * Math.hypot(p % nx - q % nx, ((p / nx) | 0) - ((q / nx) | 0)); // m between two cells
  let breaches = 0, fills = 0, cells = 0, volume = 0, snapped = 0, offSum = 0, offN = 0;
  const paths = [], cuts = [];
  for (const w of lines) {
    let path = mappedCells(fine, f, w.line);
    if (snap && path.length > 1) {
      const s = snapThalweg(fine, f, path, { corridor });
      if (s) { path = s.path; snapped++; offSum += s.offset * path.length; offN += path.length; }
    }
    paths.push(path);
    const dist = new Float64Array(path.length); // m along the path
    for (let m = 1; m < path.length; m++) dist[m] = dist[m - 1] + span(path[m], path[m - 1]);
    // walk downstream: from each low point, find the next point at or below it; if the hump between is an
    // obstruction, grade it straight
    let a = 0;
    while (a < path.length - 1) {
      const za = f.z[path[a]];
      if (f.z[path[a + 1]] <= za + tol) { a++; continue; }
      let b = a + 1, peak = za, top = a + 1;
      while (b < path.length && f.z[path[b]] > za + tol && span(path[a], path[b]) <= reach + dx) { if (f.z[path[b]] > peak) { peak = f.z[path[b]]; top = b; } b++; }
      if (b >= path.length || f.z[path[b]] > za + tol || peak - za > maxHeight) { a++; continue; }
      const hump = path.slice(a + 1, b), len = span(path[a], path[b]) - dx; // m above the foot, straight across (the path zig-zags over a crest)
      if (hump.some(k => f.bld[k])) { a++; continue; }
      const road = hump.some(k => f.road?.[k]);
      let crest = peak;
      if (road ? len > maxLength : len > fill.length || peak - za < fill.min) { a++; continue; }
      if (!road) {
        let foot = Infinity; for (let m = a - 1; m >= 0 && dist[a] - dist[m] <= fill.length; m--) foot = Math.min(foot, f.z[path[m]]);
        if (foot < za - fill.min) { a++; continue; }
        crest = spillLevel(f, path, a, b, pad);
        if (crest - za < fill.min || crest - za > fill.max) { a++; continue; }
      }
      const zb = f.z[path[b]];
      for (let m = a + 1; m < b; m++) { // the path's cell and its neighbours within the band, none raised
        const zt = za + (zb - za) * (dist[m] - dist[a]) / (dist[b] - dist[a]), ci = path[m] % nx, cj = (path[m] / nx) | 0;
        for (let dj = -half; dj <= half; dj++) for (let di = -half; di <= half; di++) {
          const i = ci + di, j = cj + dj, k = j * nx + i; if (i < 0 || j < 0 || i >= nx || j >= f.ny || f.bld[k]) continue;
          if (f.z[k] > zt) { volume += (f.z[k] - zt) * A; f.z[k] = zt; cells++; }
        }
      }
      if (road) breaches++; else fills++;
      cuts.push({ kind: road ? 'road' : 'fill', k: path[top], foot: za, crest, length: len });
      a = b;
    }
  }
  return { breaches, fills, cells, volume, snapped, offset: offN ? offSum / offN : 0, paths, cuts };
}

/**
 * Culvert links on the solver grid from OSM culverts.
 * @param c        coarse (solver) model: nx, ny, z, mask
 * @param F        solver cell size (m)
 * @param culverts [{ line, kind, D }]
 * @param taken    Set of solver cells already used for other exchange (inlet grates); culvert ends move off them
 * @param reach    m around each mapped end searched for the lowest ground (only cells nearer that end than the other)
 */
export function culvertLinks(fine, c, F, culverts, taken = new Set(), { reach = 5 } = {}) {
  const out = [], used = new Set(taken);
  const cellOf = ([x, y]) => { const i = Math.floor(x / F), j = Math.floor(y / F); return i < 0 || j < 0 || i >= c.nx || j >= c.ny ? -1 : j * c.nx + i; };
  // Each end takes the lowest open cell within `reach` m of its mapped point, not already an exchange cell: a mapped
  // culvert usually ends at the road's edge or on the embankment, and the barrel's invert is set from these cells.
  // (Ends on the embankment put the Sheffield Dr culvert by the Charlotte gauge 1.9 m above the creek bed and US-74's
  // outlet 9 m up on the highway, so the creek ponded behind them until it overtopped.)
  const R = Math.max(1, Math.ceil(reach / F));
  const free = (k, other) => {
    let best = -1; const i = k % c.nx, j = (k / c.nx) | 0, oi = other % c.nx, oj = (other / c.nx) | 0;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ii = i + di, jj = j + dj, kk = jj * c.nx + ii;
      if (di * di + dj * dj > R * R || (ii - oi) ** 2 + (jj - oj) ** 2 < di * di + dj * dj) continue; // its own side only
      if (ii < 0 || jj < 0 || ii >= c.nx || jj >= c.ny || !c.mask[kk] || used.has(kk)) continue;
      if (best < 0 || c.z[kk] < c.z[best]) best = kk;
    }
    return best;
  };
  for (const cv of culverts) {
    const pts = toCells(fine, cv.line).map(([x, y]) => [x * fine.dx, y * fine.dx]);
    let len = 0; for (let s = 1; s < pts.length; s++) len += Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]);
    const k0 = cellOf(pts[0]), k1 = cellOf(pts[pts.length - 1]); if (k0 < 0 || k1 < 0) continue;
    const a = free(k0, k1); if (a < 0) continue; used.add(a);
    const b = free(k1, k0); if (b < 0 || b === a) { used.delete(a); continue; }
    used.add(b);
    // a drawn culvert may carry its own inverts (the higher governs inlet control) and roughness
    out.push({ a, b, D: cv.D, len: Math.max(len, F), inv: Number.isFinite(cv.inv) ? cv.inv : Math.max(c.z[a], c.z[b]), n: cv.n ?? 0.015, kind: cv.kind });
  }
  return out;
}
