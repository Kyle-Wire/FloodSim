// Flooded areas: the run's peak depth split into connected areas (4-connected cells at least `threshold` deep, buildings
// excluded), each described as a planner would ask about it: how big, how deep, how much water, when it arrives and
// how long it stays, how fast it moves and how hazardous it is, which streets and buildings it reaches, what is left at
// the end. Pure functions over the 1 m result grids (src/compare.js GRIDS) and the model's building / road masks.

/** Depth bands for the area tables (m). */
export const BANDS = [[0.15, 0.3], [0.3, 0.6], [0.6, 1.0], [1.0, Infinity]];

/**
 * Connected flooded areas. g: { nx, ny, dx, maxDepth, maxWse?, maxSpeed?, maxDv?, tWet?, tAbove15?, finalDepth?, hazard?,
 * bld? (building mask), road? (road mask) }. → { label: Int32Array (area index or -1), areas: [...] } sorted by volume,
 * largest first, named A1, A2, …; areas under `minArea` m² are left out (and unlabelled).
 */
export function floodedAreas(g, { threshold = 0.15, minArea = 50, roads = null, fp = null, roadDeep = 0.3 } = {}) {
  const { nx, ny, dx, maxDepth } = g, N = nx * ny, A1 = dx * dx;
  const lab = new Int32Array(N).fill(-1), comps = [], stack = new Int32Array(N);
  const wet = (k) => maxDepth[k] >= threshold && !(g.bld?.[k]);
  for (let s = 0; s < N; s++) {
    if (lab[s] !== -1 || !wet(s)) continue;
    const id = comps.length, cells = []; let sp = 0; stack[sp++] = s; lab[s] = id;
    while (sp) {
      const k = stack[--sp]; cells.push(k);
      const i = k % nx, j = (k - i) / nx;
      if (i > 0 && lab[k - 1] === -1 && wet(k - 1)) { lab[k - 1] = id; stack[sp++] = k - 1; }
      if (i < nx - 1 && lab[k + 1] === -1 && wet(k + 1)) { lab[k + 1] = id; stack[sp++] = k + 1; }
      if (j > 0 && lab[k - nx] === -1 && wet(k - nx)) { lab[k - nx] = id; stack[sp++] = k - nx; }
      if (j < ny - 1 && lab[k + nx] === -1 && wet(k + nx)) { lab[k + nx] = id; stack[sp++] = k + nx; }
    }
    comps.push(cells);
  }
  const fin = (a) => a.filter(Number.isFinite);
  const lo = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity), hi = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity); // (spread would overflow the stack on big areas)
  const pct = (a, p) => { const s = fin(a).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  let areas = comps.map((cells, id) => {
    const area = cells.length * A1; if (area < minArea) return null;
    let vol = 0, dmax = 0, kmax = cells[0], sx = 0, sy = 0, i0 = nx, i1 = 0, j0 = ny, j1 = 0, vFinal = 0, aFinal = 0, roadCells = 0, edge = 0;
    const bands = BANDS.map(() => 0), haz = new Array(7).fill(0);
    for (const k of cells) {
      const d = maxDepth[k], i = k % nx, j = (k - i) / nx;
      vol += d * A1; if (d > dmax) { dmax = d; kmax = k; }
      sx += i + 0.5; sy += j + 0.5; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      BANDS.forEach(([lo, hi], b) => { if (d >= lo && d < hi) bands[b] += A1; });
      if (g.hazard) { const h = g.hazard[k]; if (h >= 0 && h <= 6) haz[h | 0] += A1; }
      if (g.finalDepth?.[k] > 0.005) { vFinal += g.finalDepth[k] * A1; if (g.finalDepth[k] >= threshold) aFinal += A1; }
      if (g.road?.[k]) roadCells++;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) edge++;
    }
    const pick = (grid) => (grid ? cells.map(k => grid[k]) : []);
    const tWet = fin(pick(g.tWet)), above = fin(pick(g.tAbove15)), speed = fin(pick(g.maxSpeed)), dv = fin(pick(g.maxDv));
    return {
      id, cells: cells.length, area, volume: vol, maxDepth: dmax, meanDepth: vol / area, p90Depth: pct(pick(maxDepth), 0.9), deepest: kmax,
      peakLevel: g.maxWse ? g.maxWse[kmax] : NaN, centroid: [sx / cells.length, sy / cells.length], bbox: [i0, j0, i1 + 1, j1 + 1],
      bands, hazard: haz, hazardMax: haz.reduce((m, a, c) => (a > 0 ? c : m), 0),
      arrival: tWet.length ? lo(tWet) : NaN, arrivalMedian: pct(tWet, 0.5),
      durationMax: above.length ? hi(above) : NaN, durationMedian: pct(above, 0.5),
      speedMax: speed.length ? hi(speed) : NaN, speedP90: pct(speed, 0.9), dvMax: dv.length ? hi(dv) : NaN,
      finalVolume: vFinal, finalArea: aFinal, drained: vol > 0 ? 1 - vFinal / vol : NaN, roadArea: roadCells * A1, edgeCells: edge,
      buildings: 0, streets: [], streetLength: 0, streetDeep: 0,
    };
  }).filter(Boolean);
  // buildings next to each area: footprints with a cell within one cell of it
  if (fp) {
    const touch = areas.map(() => new Set()), byId = new Map(areas.map((a, n) => [a.id, n]));
    for (let k = 0; k < N; k++) {
      const f = fp.id[k]; if (f < 0) continue;
      const i = k % nx, j = (k - i) / nx;
      for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]) {
        if (q < 0) continue; const n = byId.get(lab[q]); if (n != null) touch[n].add(f);
      }
    }
    areas.forEach((a, n) => { a.buildings = touch[n].size; a.footprints = [...touch[n]]; });
  }
  // streets through each area: the mapped centrelines sampled every cell, by name (or kind), with the length deeper than roadDeep
  if (roads) {
    const byId = new Map(areas.map((a, n) => [a.id, n])), acc = areas.map(() => new Map());
    for (const r of roads) {
      const L = r.line; if (!L || L.length < 2) continue;
      const name = r.name || r.kind || 'street';
      for (let s = 0; s + 1 < L.length; s++) {
        const [xa, ya] = L[s], [xb, yb] = L[s + 1], len = Math.hypot(xb - xa, yb - ya), m = Math.max(1, Math.ceil(len));
        for (let t = 0; t < m; t++) {
          const x = xa + (xb - xa) * (t + 0.5) / m, y = ya + (yb - ya) * (t + 0.5) / m, i = Math.floor(x), j = Math.floor(y);
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
          const k = j * nx + i, n = byId.get(lab[k]); if (n == null) continue;
          const e = acc[n].get(name) ?? { name, kind: r.kind, length: 0, deep: 0, maxDepth: 0 }; acc[n].set(name, e);
          const seg = len / m * dx; e.length += seg; if (maxDepth[k] >= roadDeep) e.deep += seg; e.maxDepth = Math.max(e.maxDepth, maxDepth[k]);
        }
      }
    }
    areas.forEach((a, n) => { a.streets = [...acc[n].values()].sort((p, q) => q.length - p.length); a.streetLength = a.streets.reduce((s, e) => s + e.length, 0); a.streetDeep = a.streets.reduce((s, e) => s + e.deep, 0); });
  }
  areas.sort((p, q) => q.volume - p.volume);
  const remap = new Int32Array(comps.length).fill(-1); areas.forEach((a, n) => { remap[a.id] = n; a.id = n; a.name = `A${n + 1}`; });
  for (let k = 0; k < N; k++) if (lab[k] >= 0) lab[k] = remap[lab[k]];
  return { label: lab, areas, threshold };
}

/** The area each structure is in or next to (its point within `reach` cells of an area cell), or -1. at: s → [x, y]. */
export function areaOfPoints(points, at, label, nx, ny, reach = 4) {
  return points.map((p) => {
    const [x, y] = at(p), i0 = Math.floor(x), j0 = Math.floor(y);
    let best = -1, bd = Infinity;
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const a = label[j * nx + i], d = di * di + dj * dj; if (a >= 0 && d < bd) { bd = d; best = a; }
    }
    return best;
  });
}

/**
 * An SVG map of the areas: each area one path of row runs (compact), buildings in grey, a label at each centroid.
 * colors: [css colour] by area rank (the rest grey). → svg string
 */
export function areasSvg({ label, areas }, { nx, ny, bld }, { width = 640, colors = [], theme = 'light', step = null, title = '' } = {}) {
  const st = step ?? Math.max(1, Math.ceil(Math.max(nx, ny) / 480)), W = Math.ceil(nx / st), H = Math.ceil(ny / st), sc = width / W, hgt = Math.round(H * sc);
  const fg = theme === 'dark' ? '#e8eef4' : '#1d2733', bgB = theme === 'dark' ? '#4a5563' : '#c9ced6', grey = theme === 'dark' ? '#7d8794' : '#9aa3ad';
  const runs = (test) => { // row runs of the coarse cells where test(k) holds for the cell's top-left fine cell
    let d = '';
    for (let J = 0; J < H; J++) {
      let I = 0;
      while (I < W) {
        if (!test(J * st * nx + I * st)) { I++; continue; }
        const s0 = I; while (I < W && test(J * st * nx + I * st)) I++;
        d += `M${s0} ${J}h${I - s0}v1h${s0 - I}z`;
      }
    }
    return d;
  };
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${width}" height="${hgt}" shape-rendering="crispEdges" font-family="system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="${theme === 'dark' ? '#121a24' : '#ffffff'}"/>`];
  if (bld) parts.push(`<path d="${runs(k => bld[k])}" fill="${bgB}"/>`);
  areas.forEach((a, n) => { const d = runs(k => label[k] === n); if (d) parts.push(`<path d="${d}" fill="${colors[n] ?? grey}" fill-opacity="0.85"><title>${a.name}</title></path>`); });
  const fs = Math.max(4, 11 / sc);
  for (const a of areas.slice(0, Math.max(colors.length, 12))) {
    const [cx, cy] = [a.centroid[0] / st, a.centroid[1] / st], n = areas.indexOf(a), col = colors[n] ?? grey;
    const rr = Math.max(Math.hypot(a.bbox[2] - a.bbox[0], a.bbox[3] - a.bbox[1]) / 2 / st, 9 / sc); // a ring makes a small area findable at map scale
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(2 / sc).toFixed(2)}"/>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - rr - fs * 0.7).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="600" fill="${fg}" stroke="${theme === 'dark' ? '#121a24' : '#ffffff'}" stroke-width="${(fs / 4).toFixed(2)}" paint-order="stroke" text-anchor="middle" dominant-baseline="middle">${a.name}</text>`);
  }
  if (title) parts.push(`<text x="${(4 / sc).toFixed(1)}" y="${(14 / sc).toFixed(1)}" font-size="${(12 / sc).toFixed(1)}" fill="${fg}">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  parts.push('</svg>');
  return parts.join('');
}
