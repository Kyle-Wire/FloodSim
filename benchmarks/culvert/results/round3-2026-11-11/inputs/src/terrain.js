// Terrain conditioning and model assembly on the fine (DEM-resolution) grid, then coarsening to the solver grid.
// All arrays are row-major with row 0 = north. Units: metres, seconds.
import { toCells } from './ingest.js';
import { hsgParams, URBAN_FILL } from './soil.js';
import { tauFor } from './scour.js';
import { TEXTURES, TEXTURE_GRAINS } from './sediment.js';

const MMHR = 1 / 1000 / 3600;

/** Manning's n by NLCD class (overland flow; editable defaults, labelled in every run manifest). */
export const MANNING = {
  0: 0.045, 11: 0.035, 12: 0.035, 21: 0.040, 22: 0.045, 23: 0.050, 24: 0.050, 31: 0.030,
  41: 0.120, 42: 0.120, 43: 0.120, 51: 0.070, 52: 0.070, 71: 0.045, 72: 0.045, 73: 0.045, 74: 0.045,
  81: 0.040, 82: 0.040, 90: 0.100, 95: 0.070,
};
export const MANNING_ROAD = 0.016;
/** Impervious fraction by NLCD class (midpoints of the NLCD developed-class definitions). */
export const IMPERVIOUS = { 21: 0.10, 22: 0.35, 23: 0.65, 24: 0.90 };
/** Constant infiltration capacity by hydrologic soil group, mm/hr (USDA minimum infiltration rates). */
export const HSG_RATE = { A: 10, B: 5, C: 2.5, D: 1 };
export const URBAN_FILL_RATE = 2; // "Urban land" units with no HSG: compacted fill
const SATURATED = new Set([11, 12, 90, 95]); // water and wetlands: no infiltration

/** Scanline even-odd fill of rings given in fractional cell coords; calls set(k) for each cell whose centre is inside. */
export function fillRings(rings, nx, ny, set) {
  let rmin = Infinity, rmax = -Infinity;
  for (const r of rings) for (const p of r) { rmin = Math.min(rmin, p[1]); rmax = Math.max(rmax, p[1]); }
  const j0 = Math.max(0, Math.ceil(rmin - 0.5)), j1 = Math.min(ny - 1, Math.floor(rmax - 0.5));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const yc = j + 0.5; xs.length = 0;
    for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const [xa, ya] = r[a], [xb, yb] = r[b];
      if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) / (yb - ya) * (xb - xa));
    }
    xs.sort((p, q) => p - q);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const i0 = Math.max(0, Math.ceil(xs[m] - 0.5)), i1 = Math.min(nx - 1, Math.floor(xs[m + 1] - 0.5));
      for (let i = i0; i <= i1; i++) set(j * nx + i);
    }
  }
}

/** Cells within width/2 of a polyline (fractional cell coords, width in cells). */
export function strokeLine(line, width, nx, ny, set) {
  const r = width / 2, r2 = r * r;
  for (let s = 0; s + 1 < line.length; s++) {
    const [ax, ay] = line[s], [bx, by] = line[s + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx) + r));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by) + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i + 0.5 - ax, py = j + 0.5 - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      const ex = px - t * dx, ey = py - t * dy;
      if (ex * ex + ey * ey <= r2) set(j * nx + i);
    }
  }
}

/**
 * Fine-grid model layers from ingested data.
 * @returns {{z, bld, bldH, road, cls, manning, infil, hsg, stats}} on the fine grid (fine.dx, usually 1 m)
 */
export function buildFine(fine, dem, osm, nlcd, soils, opts = {}) {
  const { nx, ny } = fine, N = nx * ny;
  const z = Float32Array.from(dem.z);
  const bld = new Uint8Array(N), bldH = new Float32Array(N), road = new Uint8Array(N);
  const hsg = new Uint8Array(N); // 0 unknown/urban, 1..4 = A..D
  const unit = new Int16Array(N).fill(-1); // soil map unit index per pixel (Green-Ampt properties)

  for (const b of osm.buildings) {
    const rings = b.rings.map(r => toCells(fine, r)), h = b.height ?? 0;
    fillRings(rings, nx, ny, (k) => { bld[k] = 1; bldH[k] = Math.max(bldH[k], h); });
  }
  for (const r of osm.roads) strokeLine(toCells(fine, r.line), r.width / fine.dx, nx, ny, (k) => { road[k] = 1; });
  for (const s of soils) {
    const g = (s.hsg || '').toUpperCase(), letter = g.includes('/') ? g.split('/')[1] : g; // dual groups: undrained (conservative)
    const code = { A: 1, B: 2, C: 3, D: 4 }[letter[0]] || 0;
    const si = soils.indexOf(s);
    fillRings(s.rings.map(r => toCells(fine, r)), nx, ny, (k) => { if (code) hsg[k] = code; unit[k] = si; });
  }

  const curb = opts.curb ?? 0; // m; burn streets below their lots so they act as channels
  const manning = new Float32Array(N), infil = new Float32Array(N);
  let roadCells = 0, bldCells = 0;
  for (let k = 0; k < N; k++) {
    const c = nlcd ? nlcd[k] : 0;
    if (bld[k]) { bldCells++; manning[k] = MANNING[c] ?? 0.045; continue; }
    if (road[k]) { roadCells++; z[k] -= curb; manning[k] = MANNING_ROAD; infil[k] = 0; continue; }
    manning[k] = MANNING[c] ?? 0.045;
    const base = hsg[k] ? HSG_RATE['ABCD'[hsg[k] - 1]] : URBAN_FILL_RATE;
    infil[k] = SATURATED.has(c) ? 0 : base * (1 - (IMPERVIOUS[c] ?? 0)) * MMHR;
  }
  // Green-Ampt per pixel: the survey's properties where it has them, else the hydrologic group, else compacted fill;
  // perv = the share of the pixel that takes water in (0 on streets, buildings, water and wetlands)
  const ga = { K: new Float32Array(N), psi: new Float32Array(N), thetaE: new Float32Array(N), depth: new Float32Array(N) }, perv = new Float32Array(N), tauC = new Float32Array(N);
  const texture = new Uint8Array(N), collapse = new Uint8Array(N), swell = new Uint8Array(N), fill = TEXTURES.indexOf('compacted fill');
  // grain classes per pixel (% of the soil: clay, silt, sand, gravel; the texture's typical mix without survey data) and soil depth to bedrock (m, NaN unknown)
  const grains = new Uint8Array(N * 4), bedrock = new Float32Array(N).fill(NaN);
  const params = soils.map(s => (s.props?.K > 0 ? s.props : null));
  for (let k = 0; k < N; k++) {
    const c = nlcd ? nlcd[k] : 0;
    const p = (unit[k] >= 0 && params[unit[k]]) || (hsg[k] ? hsgParams('ABCD'[hsg[k] - 1]) : URBAN_FILL), u = unit[k] >= 0 ? soils[unit[k]].props : null;
    const lim = [u?.wt, u?.bedrock].filter(v => v != null && v >= 0);
    ga.K[k] = p.K; ga.psi[k] = p.psi; ga.thetaE[k] = p.thetaE; ga.depth[k] = lim.length ? Math.max(0.05, Math.min(...lim)) : Infinity;
    perv[k] = bld[k] || road[k] || SATURATED.has(c) ? 0 : 1 - (IMPERVIOUS[c] ?? 0);
    tauC[k] = tauFor(perv[k], c, p.texture); // critical shear for the scour map (src/scour.js)
    const ti = TEXTURES.indexOf(p.texture); texture[k] = ti >= 0 ? ti : fill;
    const gr = p.grains ?? TEXTURE_GRAINS[p.texture] ?? TEXTURE_GRAINS['compacted fill'];
    grains[4 * k] = Math.round(gr.clay); grains[4 * k + 2] = Math.round(gr.sand); grains[4 * k + 3] = Math.round(gr.gravel ?? 0); grains[4 * k + 1] = Math.max(0, 100 - grains[4 * k] - grains[4 * k + 2] - grains[4 * k + 3]);
    if (u?.bedrock != null && u.bedrock >= 0) bedrock[k] = u.bedrock;
    if (!SATURATED.has(c)) { collapse[k] = u?.collapse?.cls ?? 0; swell[k] = u?.swell?.cls ?? 0; } // screening classes (src/soil.js)
  }
  const A = fine.dx * fine.dx;
  return {
    nx, ny, dx: fine.dx, z, bld, bldH, road, cls: nlcd, manning, infil, hsg, ga, perv, tauC, texture, grains, bedrock, collapse, swell, soilUnit: unit,
    stats: { buildings: osm.buildings.length, roads: osm.roads.length, soilUnits: soils.length, buildingArea: bldCells * A, roadArea: roadCells * A, curb },
  };
}

/**
 * Coarsen fine layers by an integer factor F to the solver grid. A coarse cell is a wall if more than half of it is
 * building; its bed is the mean open-ground elevation (volume-consistent for the open part); n and infiltration are
 * open-area means. Roof rain is routed to the open cells bordering each building (connected fraction `roofFrac`).
 */
export function coarsen(fine, F, roofFrac = 1) {
  const fnx = fine.nx, cnx = fnx / F, cny = fine.ny / F;
  if (!Number.isInteger(cnx) || !Number.isInteger(cny)) throw new Error('grid extent must be divisible by the coarsening factor');
  const N = cnx * cny, z = new Float64Array(N), mask = new Uint8Array(N), manning = new Float64Array(N), infil = new Float64Array(N), roadFrac = new Float64Array(N);
  for (let J = 0; J < cny; J++) for (let I = 0; I < cnx; I++) {
    let zo = 0, za = 0, no = 0, fo = 0, nOpen = 0, nRoad = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const k = j * fnx + i; za += fine.z[k];
      if (!fine.bld[k]) { nOpen++; zo += fine.z[k]; no += fine.manning[k]; fo += fine.infil[k]; if (fine.road?.[k]) nRoad++; }
    }
    const K = J * cnx + I;
    mask[K] = nOpen * 2 > F * F ? 1 : 0;
    z[K] = nOpen ? zo / nOpen : za / (F * F);
    manning[K] = nOpen ? no / nOpen : 0.05; infil[K] = nOpen ? fo / nOpen : 0; roadFrac[K] = nRoad / (F * F);
  }
  const bldId = fine.bldId ? coarseIds(fine, F) : null, design = bldId && fine.roofs?.size ? { ids: bldId, roofs: fine.roofs } : null;
  const { rainField, roofLost } = roofRouting(mask, cnx, cny, roofFrac, design);
  return { nx: cnx, ny: cny, F, z, mask, manning, infil, roadFrac, rainField, roofLost, ...(design ? { bldId, roofs: fine.roofs } : {}) };
}

/** Building id per solver cell: the most common id among its building pixels (0 = a mapped building, or none). */
export function coarseIds(fine, F) {
  const fnx = fine.nx, cnx = fnx / F, cny = fine.ny / F, ids = new Int32Array(cnx * cny);
  for (let J = 0; J < cny; J++) for (let I = 0; I < cnx; I++) {
    let best = 0, bn = 0; const n = new Map();
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const k = j * fnx + i; if (!fine.bld[k]) continue;
      const id = fine.bldId[k], c = (n.get(id) ?? 0) + 1; n.set(id, c);
      if (c > bn || (c === bn && id < best)) { best = id; bn = c; }
    }
    ids[J * cnx + I] = best;
  }
  return ids;
}

/**
 * Per-cell rain multiplier: each building blob's roof rain (× roofFrac) spread evenly over its bordering open cells.
 * design (site design mode): { ids: building id per cell (0 = mapped building), roofs: Map(id → { roof, retention }),
 * held: ids whose roofs still hold the rain (green roofs and cisterns before they fill), ground(id, blob, cells): the
 * share of that building's roof rain that lands on the ground (default 1, 0 while held) }. A blob's cells are split by
 * id, so each new building's roof follows its own setting; `roofFrac` sees only the mapped part (blob.cells).
 */
export function roofRouting(mask, nx, ny, roofFrac = 1, design = null) {
  const N = nx * ny, rain = new Float64Array(N).fill(1), seen = new Uint8Array(N);
  let roofLost = 0; const stack = [], blob = [], edge = new Set(), blobs = [];
  const fracOf = typeof roofFrac === 'function' ? roofFrac : () => roofFrac;
  for (let s = 0; s < N; s++) {
    if (mask[s] || seen[s]) continue;
    blob.length = 0; edge.clear(); stack.push(s); seen[s] = 1;
    while (stack.length) {
      const k = stack.pop(); blob.push(k);
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = jj * nx + ii;
        if (mask[q]) edge.add(q); else if (!seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    let ci = 0, cj = 0; for (const k of blob) { ci += k % nx; cj += (k / nx) | 0; }
    const b = { cells: blob.length, ci: ci / blob.length + 0.5, cj: cj / blob.length + 0.5, edgeCells: edge.size };
    if (design) {
      const own = new Map(); let mapped = 0;
      for (const k of blob) { const id = design.ids[k]; if (id && design.roofs.has(id)) own.set(id, (own.get(id) ?? 0) + 1); else mapped++; }
      if (own.size) { // new buildings in the blob: each roof by its own setting
        b.cells = mapped; b.ids = own; blobs.push(b);
        if (!edge.size) { roofLost += blob.length; continue; }
        let wet = mapped ? (b.groundFrac = fracOf(b)) * mapped : 0;
        for (const [id, n] of own) wet += n * (design.ground ? design.ground(id, b, n) : design.held?.has(id) ? 0 : 1);
        for (const q of edge) rain[q] += wet / edge.size;
        continue;
      }
    }
    b.groundFrac = edge.size ? fracOf(b) : 0; // the rest of the roof goes elsewhere (e.g. downspouts into the sewer)
    blobs.push(b);
    if (!edge.size) { roofLost += blob.length; continue; }
    const share = b.groundFrac * blob.length / edge.size;
    for (const q of edge) rain[q] += share;
  }
  return { rainField: rain, roofLost, blobs };
}

/**
 * Downspouts into the sewer: each building's roof rain (share `sewerFrac`) to its nearest manhole within `maxDist` m.
 * Returns the solver-grid rain field for what still lands on the ground, and the roof area (m²) feeding each node.
 * The disconnected share follows `groundFrac` (roof runoff routed to the ground); buildings with no manhole in reach keep it all.
 */
export function roofConnections(c, net, sewerFrac, groundFrac = 1, maxDist = 80, { held = null, toCell = null } = {}) {
  const F = c.F, nodes = net.nodes.map((n, i) => ({ i, x: n.p[0] / F, y: n.p[1] / F })).filter(o => !net.nodes[o.i].outfall);
  const roofArea = new Float64Array(net.nodes.length), A = F * F;
  let connected = 0, total = 0; const links = new Map(); // new building id → node index its roof drains to (null: the ground)
  const nearest = (x, y, lim) => { let best = null, bd = Infinity; for (const o of nodes) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } } return best && bd * F <= lim ? best : null; };
  // new buildings with roof drains (site design mode): all of the roof to the chosen manhole (within 5 m of the point
  // given) or the nearest within 30 m; with none in reach, to the ground
  const design = c.bldId && c.roofs?.size ? { ids: c.bldId, roofs: c.roofs, held, ground: (id, b, n) => {
    const r = c.roofs.get(id); total += n * A;
    if (held?.has(id)) return 0;
    if (r.roof !== 'network') return 1;
    const at = r.to && toCell ? toCell(r.to) : null, o = at ? nearest(at[0] / F, at[1] / F, 5) : nearest(b.ci, b.cj, 30);
    links.set(id, o ? o.i : null); if (!o) return 1;
    roofArea[o.i] += n * A; connected += n * A; return 0;
  } } : null;
  const { rainField, roofLost } = roofRouting(c.mask, c.nx, c.ny, (b) => {
    total += b.cells * A;
    let best = null, bd = Infinity;
    for (const o of nodes) { const d = Math.hypot(o.x - b.ci, o.y - b.cj); if (d < bd) { bd = d; best = o; } }
    if (!best || bd * F > maxDist || sewerFrac <= 0) return groundFrac;
    roofArea[best.i] += sewerFrac * b.cells * A; connected += sewerFrac * b.cells * A;
    return (1 - sewerFrac) * groundFrac;
  }, design);
  return { rainField, roofArea, roofLost, connectedArea: connected, roofTotal: total, links };
}

/** Grey hillshade (RGBA) for a DEM, sun from the north-west at 45°. */
export function hillshade(z, nx, ny, dx, exag = 2) {
  const out = new Uint8ClampedArray(nx * ny * 4), az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
  const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const zz = (ii, jj) => z[Math.min(ny - 1, Math.max(0, jj)) * nx + Math.min(nx - 1, Math.max(0, ii))];
    const gx = (zz(i + 1, j) - zz(i - 1, j)) / (2 * dx) * exag, gy = (zz(i, j - 1) - zz(i, j + 1)) / (2 * dx) * exag; // gy: northward
    const nlen = Math.hypot(gx, gy, 1), v = Math.max(0, (-gx * lx - gy * ly + lz) / nlen);
    const k = 4 * (j * nx + i), c = 255 * v;
    out[k] = out[k + 1] = out[k + 2] = c; out[k + 3] = 255;
  }
  return out;
}
