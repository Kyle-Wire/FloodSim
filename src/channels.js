// Channel and culvert conditioning of the terrain (Phase 2).
//
// Bare-earth lidar removes bridges but keeps the road embankments that streams pass under in culverts, so a mapped
// stream that should flow becomes a dam. Two fixes, both from OpenStreetMap waterways:
//   culverts  ways tagged tunnel=culvert become culvert links between their two ends (src/links.js); the barrel size
//             comes from the diameter / width tags or a default by waterway class
//   breaching where an open (non-culvert) waterway crosses a road, a short rise in the bed between two lower points —
//             an embankment over an unmapped culvert — is cut down to a straight grade between them, if it is short
//             and low enough to be an obstruction rather than real terrain
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

/**
 * Breach short obstructions along open waterways on the fine (1 m) grid, in place.
 * @param f     fine model from buildFine (z, bld)
 * @param lines [{ line: [[lon, lat]…], kind }] in their mapped (downstream) direction
 * @returns { breaches, cells, volume } — obstructions cut, cells lowered, volume removed (m³)
 */
export function breachChannels(fine, f, lines, { maxLength = 30, maxHeight = 4, tol = 0.15 } = {}) {
  const { nx, ny } = f, A = fine.dx * fine.dx;
  let breaches = 0, cells = 0, volume = 0;
  for (const w of lines) {
    // the cells the line passes through, in order, one per step, without repeats
    const path = [], pts = toCells(fine, w.line);
    for (let s = 0; s + 1 < pts.length; s++) {
      const [x0, y0] = pts[s], [x1, y1] = pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
      for (let q = 0; q <= n; q++) {
        const i = Math.floor(x0 + (x1 - x0) * q / n), j = Math.floor(y0 + (y1 - y0) * q / n);
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i; if (path[path.length - 1] !== k) path.push(k);
      }
    }
    // walk downstream: from each low point, find the next point at or below it; if the hump between is short and
    // low, grade it straight
    let a = 0;
    while (a < path.length - 1) {
      const za = f.z[path[a]];
      if (f.z[path[a + 1]] <= za + tol) { a++; continue; }
      let b = a + 1, peak = za;
      while (b < path.length && f.z[path[b]] > za + tol && b - a <= maxLength / fine.dx + 1) { peak = Math.max(peak, f.z[path[b]]); b++; }
      // only road embankments: mapped lines wander off the 1 m thalweg onto banks, and those humps are real terrain
      const hump = path.slice(a + 1, b);
      if (b >= path.length || f.z[path[b]] > za + tol || peak - za > maxHeight || hump.some(k => f.bld[k]) || !hump.some(k => f.road[k])) { a++; continue; }
      const zb = f.z[path[b]];
      for (let m = a + 1; m < b; m++) { const zt = za + (zb - za) * (m - a) / (b - a), k = path[m]; if (f.z[k] > zt) { volume += (f.z[k] - zt) * A; f.z[k] = zt; cells++; } }
      breaches++; a = b;
    }
  }
  return { breaches, cells, volume };
}

/**
 * Culvert links on the solver grid from OSM culverts.
 * @param c        coarse (solver) model: nx, ny, z, mask
 * @param F        solver cell size (m)
 * @param culverts [{ line, kind, D }]
 * @param taken    Set of solver cells already used for other exchange (inlet grates); culvert ends move off them
 */
export function culvertLinks(fine, c, F, culverts, taken = new Set()) {
  const out = [], used = new Set(taken);
  const cellOf = ([x, y]) => { const i = Math.floor(x / F), j = Math.floor(y / F); return i < 0 || j < 0 || i >= c.nx || j >= c.ny ? -1 : j * c.nx + i; };
  const free = (k) => { // the cell itself, or the lowest open neighbour not already an exchange cell
    if (k >= 0 && c.mask[k] && !used.has(k)) return k;
    let best = -1; const i = k % c.nx, j = (k / c.nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj, kk = jj * c.nx + ii;
      if (ii < 0 || jj < 0 || ii >= c.nx || jj >= c.ny || !c.mask[kk] || used.has(kk)) continue;
      if (best < 0 || c.z[kk] < c.z[best]) best = kk;
    }
    return best;
  };
  for (const cv of culverts) {
    const pts = toCells(fine, cv.line).map(([x, y]) => [x * fine.dx, y * fine.dx]);
    let len = 0; for (let s = 1; s < pts.length; s++) len += Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]);
    const k0 = cellOf(pts[0]), k1 = cellOf(pts[pts.length - 1]); if (k0 < 0 || k1 < 0) continue;
    const a = free(k0); if (a < 0) continue; used.add(a);
    const b = free(k1); if (b < 0 || b === a) { used.delete(a); continue; }
    used.add(b);
    // a drawn culvert may carry its own inverts (the higher governs inlet control) and roughness
    out.push({ a, b, D: cv.D, len: Math.max(len, F), inv: Number.isFinite(cv.inv) ? cv.inv : Math.max(c.z[a], c.z[b]), n: cv.n ?? 0.015, kind: cv.kind });
  }
  return out;
}
