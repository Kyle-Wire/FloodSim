// Estimated channel bathymetry under hydro-flattened lidar (opt-in). 3DEP lidar has no returns from water, so rivers
// and lakes are flattened at the water surface on the flight day; the channel below it is missing, and with it most of
// a river's low-flow conveyance. This estimates it from regional hydraulic geometry:
//
//   1. the flattened surface: grown from the mapped river lines over cells that are flat to the millimetre (natural
//      ground carries centimetres of lidar noise; flattened water carries none) and within `tol` of their neighbour
//   2. drainage area per river: USGS NLDI where it enters the model (given), else D8 flow accumulation on the DEM
//   3. bankfull width W and depth D from the regional curves of Bieger et al. (2015, JAWRA 51(3), Supplementary Table 1):
//      W = a·A^b, D = c·A^d (A in km², metres), nationwide or by physiographic division
//   4. depth below the flattened surface at the centre: the bankfull centre depth (1.5 × the curves' mean depth, for a
//      parabolic section) less the bank height above that surface (the flight-day water already filled that part), at
//      least `minDepth`; a parabolic section across the flattened width
// The carved channel starts full to the lidar surface (that water was there when the lidar was flown). An estimate:
// replace it with surveyed sections where they exist.
import { priorityFlood, flowDirections } from './watershed.js';
import { edt } from './design.js';

/** Bieger et al. (2015) bankfull curves: width [a, b], depth [c, d], A in km², W and D in m. */
export const CURVES = {
  USA: { label: 'Nationwide (CONUS)', w: [2.70, 0.352], d: [0.30, 0.213] },
  LUP: { label: 'Laurentian Upland', w: [4.15, 0.308], d: [0.31, 0.202] },
  APL: { label: 'Atlantic Plain (Coastal Plain)', w: [2.22, 0.363], d: [0.24, 0.323] },
  AHI: { label: 'Appalachian Highlands (Piedmont, Blue Ridge, Valley and Ridge…)', w: [3.12, 0.415], d: [0.26, 0.287] },
  IPL: { label: 'Interior Plains', w: [2.56, 0.351], d: [0.38, 0.191] },
  IHI: { label: 'Interior Highlands (Ozarks, Ouachita)', w: [23.23, 0.121], d: [0.27, 0.267] },
  RMS: { label: 'Rocky Mountain System', w: [1.24, 0.435], d: [0.23, 0.225] },
  IMP: { label: 'Intermontane Plateaus', w: [1.11, 0.415], d: [0.07, 0.329] },
  PMS: { label: 'Pacific Mountain System', w: [2.76, 0.399], d: [0.23, 0.294] },
};
/** Bankfull width and depth (m) for a drainage area (km²). */
export function bankfull(areaKm2, curve = CURVES.USA) {
  return { W: curve.w[0] * areaKm2 ** curve.w[1], D: curve.d[0] * areaKm2 ** curve.d[1] };
}

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
/** How many of the 8 neighbours match z[k] within `flat` (a flattened surface: most of them; noisy ground: few). */
function flatNeighbours(z, nx, ny, k, flat) {
  const i = k % nx, j = (k / nx) | 0; let n = 0;
  for (const [di, dj] of N8) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && Math.abs(z[b * nx + a] - z[k]) <= flat) n++; }
  return n;
}
/**
 * The hydro-flattened water surface: grown from seed cells (mapped river lines) over 4-neighbours that are flat (at
 * least 4 of their 8 neighbours within `flat`, so edge cells beside a bank still count) and within `tol` of the cell
 * they are reached from. Seeds on rough ground (a stream too small to be flattened) stay as they are. → Uint8Array mask
 */
export function flatWater(z, nx, ny, seeds, { tol = 0.02, flat = 0.003, maxCells = Infinity } = {}) {
  const m = new Uint8Array(nx * ny), q = [];
  for (const k of seeds) if (k >= 0 && !m[k]) { m[k] = 1; q.push(k); }
  let n = q.length;
  for (let h = 0; h < q.length && n < maxCells; h++) {
    const k = q[h], i = k % nx, j = (k / nx) | 0;
    for (const [di, dj] of N8.slice(0, 4)) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const p = b * nx + a; if (m[p] || Math.abs(z[p] - z[k]) > tol || flatNeighbours(z, nx, ny, p, flat) < 4) continue;
      m[p] = 1; q.push(p); n++;
    }
  }
  return m;
}
/** D8 flow accumulation (cells draining through each cell, itself included) on the depression-filled DEM. */
export function accumulation(z, nx, ny) {
  const zf = priorityFlood(Float64Array.from(z), nx, ny), dir = flowDirections(zf, nx, ny), N = nx * ny;
  const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // the order flowDirections indexes
  const order = Uint32Array.from({ length: N }, (_, k) => k).sort((a, b) => zf[b] - zf[a]), acc = new Float64Array(N).fill(1);
  for (const k of order) { const d = dir[k]; if (d < 0) continue; const i = k % nx + D8[d][0], j = ((k / nx) | 0) + D8[d][1]; acc[j * nx + i] += acc[k]; }
  return acc;
}
/** Connected components of a mask (8-neighbours). → { id: Int32Array (−1 outside), count } */
function labels(mask, nx, ny) {
  const id = new Int32Array(nx * ny).fill(-1); let n = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || id[s] >= 0) continue;
    const st = [s]; id[s] = n;
    while (st.length) { const k = st.pop(), i = k % nx, j = (k / nx) | 0; for (const [di, dj] of N8) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const p = b * nx + a; if (mask[p] && id[p] < 0) { id[p] = n; st.push(p); } } }
    n++;
  }
  return { id, count: n };
}
/** Separable square max filter of radius r (cells). */
function maxFilter(v, nx, ny, r) {
  const tmp = new Float32Array(nx * ny), out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let m = 0; for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) m = Math.max(m, v[j * nx + a]); tmp[j * nx + i] = m; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { let m = 0; for (let b = Math.max(0, j - r); b <= Math.min(ny - 1, j + r); b++) m = Math.max(m, tmp[b * nx + i]); out[j * nx + i] = m; }
  return out;
}

/**
 * Carve the estimated channel. z: the 1 m DEM (not changed); water: the flattened surface (flatWater); areaAt(k) →
 * extra drainage area (km²) entering at water cell k from off the model (NLDI at a river entry), or 0. curve: CURVES
 * entry. → { dz: Float32Array (depth carved below the surface, ≥ 0), comps: [{ cells, areaKm2, W, D, bank, dc, volume }], volume }
 */
export function carveChannels(z, nx, ny, dx, water, { areaAt = () => 0, entries = [], reach = 40, curve = CURVES.USA, minDepth = 0.3, minCells = 20, acc = null } = {}) {
  const N = nx * ny, dz = new Float32Array(N), { id, count } = labels(water, nx, ny);
  acc ??= accumulation(z, nx, ny);
  const cellKm2 = dx * dx / 1e6, comps = Array.from({ length: count }, () => ({ cells: [], areaKm2: 0, ext: 0 }));
  for (let k = 0; k < N; k++) if (id[k] >= 0) { const c = comps[id[k]]; c.cells.push(k); c.areaKm2 = Math.max(c.areaKm2, acc[k] * cellKm2); c.ext = Math.max(c.ext, areaAt(k) || 0); }
  // rivers entering from off the model ([{ x, y } in cells, areaKm2 }]): their area goes to the nearest flattened water
  for (const e of entries) {
    let best = -1, bd = Infinity; const r = Math.ceil(reach / dx), i0 = Math.round(e.x), j0 = Math.round(e.y);
    for (let j = Math.max(0, j0 - r); j <= Math.min(ny - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(nx - 1, i0 + r); i++) { const k = j * nx + i; if (id[k] < 0) continue; const d = Math.hypot(i - e.x, j - e.y); if (d < bd) { bd = d; best = k; } }
    if (best >= 0) comps[id[best]].ext = Math.max(comps[id[best]].ext, e.areaKm2);
  }
  const d2 = edt(Uint8Array.from(water, v => (v ? 0 : 1)), nx, ny).d2, e = Float32Array.from(d2, v => (Number.isFinite(v) ? Math.sqrt(v) : 0)); // cells to the water's edge
  let total = 0;
  for (const c of comps) {
    if (c.cells.length < minCells) { c.skipped = true; continue; }
    c.areaKm2 += c.ext; const { W, D } = bankfull(c.areaKm2, curve); Object.assign(c, { W, D });
    // bank height above the flattened surface: from each edge cell, the highest ground within half the bankfull width
    // walking straight away from the water (the bank top); the median over the edge
    const rises = [], R = Math.max(3, Math.min(15, Math.round(W / 2 / dx)));
    for (const k of c.cells) {
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of N8.slice(0, 4)) {
        const a1 = i + di, b1 = j + dj; if (a1 < 0 || b1 < 0 || a1 >= nx || b1 >= ny || water[b1 * nx + a1]) continue;
        let top = -Infinity; for (let s = 1; s <= R; s++) { const a = i + s * di, b = j + s * dj; if (a < 0 || b < 0 || a >= nx || b >= ny || water[b * nx + a]) break; top = Math.max(top, z[b * nx + a]); }
        if (Number.isFinite(top)) rises.push(top - z[k]);
      }
    }
    rises.sort((p, q) => p - q); c.bank = rises.length ? Math.max(0, rises[rises.length >> 1]) : 0;
    // the curves give the mean bankfull depth; a parabolic section is 1.5 × as deep at its centre
    c.Dmax = 1.5 * D; c.dc = Math.min(c.Dmax, Math.max(minDepth, c.Dmax - c.bank));
    c.volume = 0;
  }
  // parabolic section: depth = dc · (1 − (1 − e/h)²), h the half-width (largest distance to the edge nearby)
  const rMax = Math.max(2, Math.ceil(Math.max(...comps.filter(c => !c.skipped).map(c => c.W ?? 0), 4) / dx));
  const h = maxFilter(e, nx, ny, Math.min(60, rMax));
  for (let k = 0; k < N; k++) {
    if (id[k] < 0) continue; const c = comps[id[k]]; if (c.skipped) continue;
    const t = Math.min(1, e[k] / Math.max(1, h[k])), d = c.dc * (1 - (1 - t) ** 2);
    dz[k] = d; c.volume += d * dx * dx; total += d * dx * dx;
  }
  return { dz, comps: comps.filter(c => !c.skipped).map(({ cells, ...rest }) => ({ ...rest, cells: cells.length })), volume: total };
}
