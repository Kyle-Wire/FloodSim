// Watersheds from elevation: the ground that drains into a study area, so a model can run on its whole contributing
// catchment as a closed system (no inflow across its edge; water leaves only where the terrain does).
//
// Standard terrain analysis on a 3DEP DEM: priority-flood depression filling with an ε gradient (Barnes, Lehman &
// Mulla 2014), D8 flow directions, then every cell whose flow path reaches the study area. The outline is the outer
// boundary of that set, simplified. Surface drainage only: pipes, and water routed past buildings, are not in it, and
// in flat urban terrain the line is approximate. Cells are row-major, row 0 = north.

const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** Priority-flood fill: every cell gets a downhill path to the grid edge (rises by eps across flats). */
export function priorityFlood(z, nx, ny, eps = 1e-4) {
  const N = nx * ny, out = Float64Array.from(z), done = new Uint8Array(N);
  const hz = [], hk = []; // binary min-heap on (elevation, index)
  const push = (v, k) => { let i = hz.length; hz.push(v); hk.push(k); while (i) { const p = (i - 1) >> 1; if (hz[p] <= v) break; hz[i] = hz[p]; hk[i] = hk[p]; i = p; } hz[i] = v; hk[i] = k; };
  const pop = () => {
    const k = hk[0], v = hz.pop(), kk = hk.pop(), n = hz.length;
    if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hz[c + 1] < hz[c]) c++; if (hz[c] >= v) break; hz[i] = hz[c]; hk[i] = hk[c]; i = c; } hz[i] = v; hk[i] = kk; }
    return k;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || i === nx - 1 || j === ny - 1) { const k = j * nx + i; done[k] = 1; push(out[k], k); }
  while (hz.length) {
    const k = pop(), i = k % nx, j = (k / nx) | 0;
    for (const [di, dj] of D8) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const q = jj * nx + ii; if (done[q]) continue;
      done[q] = 1; if (out[q] <= out[k]) out[q] = out[k] + eps; push(out[q], q);
    }
  }
  return out;
}

/** D8 flow direction (index into D8, steepest descent by drop / distance); −1 on the edge or where nothing is lower. */
export function flowDirections(zf, nx, ny) {
  const dir = new Int8Array(nx * ny).fill(-1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let best = -1, bs = 0;
    D8.forEach(([di, dj], d) => {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) return;
      const s = (zf[k] - zf[jj * nx + ii]) / (di && dj ? Math.SQRT2 : 1); if (s > bs) { bs = s; best = d; }
    });
    dir[k] = best;
  }
  return dir;
}

/** Cells whose flow path reaches a seed cell (seeds included). */
export function upstreamOf(dir, nx, ny, seed) {
  const N = nx * ny, inn = Uint8Array.from(seed), st = [];
  for (let k = 0; k < N; k++) if (inn[k]) st.push(k);
  while (st.length) {
    const k = st.pop(), i = k % nx, j = (k / nx) | 0;
    D8.forEach(([di, dj], d) => {
      const ii = i - di, jj = j - dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) return; // neighbour that would point at k
      const q = jj * nx + ii; if (!inn[q] && dir[q] === d) { inn[q] = 1; st.push(q); }
    });
  }
  return inn;
}

/** Outer boundary of the largest 8-connected region of a mask, as a ring of cell corners (cell coords), simplified. */
export function outline(mask, nx, ny, tol = 1) {
  // largest component
  const lab = new Int32Array(nx * ny), st = []; let best = 0, bestN = 0, n = 0;
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k] || lab[k]) continue; n++; let cnt = 0; st.push(k); lab[k] = n;
    while (st.length) { const q = st.pop(), i = q % nx, j = (q / nx) | 0; cnt++; for (const [di, dj] of D8) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const r = jj * nx + ii; if (mask[r] && !lab[r]) { lab[r] = n; st.push(r); } } }
    if (cnt > bestN) { bestN = cnt; best = n; }
  }
  const inside = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && lab[j * nx + i] === best;
  // directed boundary edges between cell corners, clockwise on screen (y down), so the region is on the right
  const out = new Map(), add = (x1, y1, x2, y2) => { const k = x1 + ',' + y1; if (!out.has(k)) out.set(k, []); out.get(k).push([x2, y2]); };
  let si = -1, sj = -1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!inside(i, j)) continue; if (si < 0) { si = i; sj = j; }
    if (!inside(i, j - 1)) add(i, j, i + 1, j); if (!inside(i + 1, j)) add(i + 1, j, i + 1, j + 1);
    if (!inside(i, j + 1)) add(i + 1, j + 1, i, j + 1); if (!inside(i - 1, j)) add(i, j + 1, i, j);
  }
  if (si < 0) return [];
  // the first cell's top edge is on the outer boundary; follow it round
  const take = (x, y, nx2, ny2) => { const l = out.get(x + ',' + y), m = l.findIndex(p => p[0] === nx2 && p[1] === ny2); l.splice(m, 1); };
  const ring = [[si, sj]]; let px = si, py = sj, x = si + 1, y = sj; take(si, sj, x, y);
  for (let guard = 0; guard < 4 * mask.length + 8 && !(x === si && y === sj); guard++) {
    ring.push([x, y]);
    const dx = x - px, dy = y - py, opts = out.get(x + ',' + y) ?? [];
    let next = null;
    // left first: at a diagonal pinch go round the other piece too (the region is 8-connected)
    for (const [tx, ty] of [[dy, -dx], [dx, dy], [-dy, dx]]) { const o = opts.find(p => p[0] - x === tx && p[1] - y === ty); if (o) { next = o; break; } }
    if (!next) break;
    take(x, y, next[0], next[1]); px = x; py = y; x = next[0]; y = next[1];
  }
  return simplify(ring, tol);
}

/** Douglas–Peucker on a closed ring. */
export function simplify(ring, tol) {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = 1; keep[ring.length - 1] = 1;
  const far = ring.reduce((b, p, i) => (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > b.d ? { i, d: Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) } : b), { i: 0, d: -1 }).i;
  keep[far] = 1;
  const rec = (a, b) => {
    const [ax, ay] = ring[a], [bx, by] = ring[b], L = Math.hypot(bx - ax, by - ay) || 1e-9; let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - ring[i][1]) - (ax - ring[i][0]) * (by - ay)) / L; if (d > md) { md = d; m = i; } }
    if (m >= 0) { keep[m] = 1; rec(a, m); rec(m, b); }
  };
  rec(0, far); rec(far, ring.length - 1);
  return ring.filter((_, i) => keep[i]);
}

/**
 * The watershed of a study area on a DEM grid. target: Uint8Array of the study area's cells.
 * → { mask, ring (cell corners), cells, studyCells, upstreamCells, touchesEdge, local } — touchesEdge means the
 *   catchment runs off the DEM (a river from a basin too large to model). Then `local` is the ground that drains in
 *   without coming down that river: the flow paths from the DEM edge to the area are the river, and the search does
 *   not climb past them ({ mask, ring, cells, upstreamCells, riverCells }).
 */
export function watershed(z, nx, ny, target) {
  const zf = priorityFlood(z, nx, ny), dir = flowDirections(zf, nx, ny), mask = upstreamOf(dir, nx, ny, target);
  const count = (m) => { let c = 0, s = 0; for (let k = 0; k < m.length; k++) if (m[k]) { c++; if (target[k]) s++; } return [c, s]; };
  const [cells, studyCells] = count(mask); let touchesEdge = false;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (mask[k] && !target[k] && (!i || !j || i === nx - 1 || j === ny - 1)) touchesEdge = true; }
  const out = { mask, ring: outline(mask, nx, ny, 1.5), cells, studyCells, upstreamCells: cells - studyCells, touchesEdge, local: null };
  if (touchesEdge) {
    // river: every flow path from a watershed cell on the DEM edge down to the area
    const river = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i && j && i < nx - 1 && j < ny - 1) continue;
      let k = j * nx + i; if (!mask[k] || target[k]) continue;
      for (let guard = 0; guard < nx * ny && !target[k] && !river[k]; guard++) {
        river[k] = 1; const d = dir[k]; if (d < 0) break;
        const ii = (k % nx) + D8[d][0], jj = ((k / nx) | 0) + D8[d][1]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) break; k = jj * nx + ii;
      }
    }
    // local: climb from the area, but not up the river or what drains into it
    const lm = Uint8Array.from(target), st = []; for (let k = 0; k < lm.length; k++) if (lm[k]) st.push(k);
    while (st.length) {
      const k = st.pop(), i = k % nx, j = (k / nx) | 0;
      D8.forEach(([di, dj], d) => { const ii = i - di, jj = j - dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) return; const q = jj * nx + ii; if (!lm[q] && !river[q] && dir[q] === d) { lm[q] = 1; st.push(q); } });
    }
    const [lc] = count(lm); let rc = 0; for (const v of river) rc += v;
    out.local = { mask: lm, ring: outline(lm, nx, ny, 1.5), cells: lc, upstreamCells: lc - studyCells, riverCells: rc };
  }
  return out;
}
