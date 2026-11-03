// Report maps and street access from a run's 1 m grids. A binned raster map as compact SVG (row runs of the cells in
// each bin, buildings grey, a legend under it), the colour ramps for it (sequential: one hue, light to dark; ordinal
// hazard classes), and per street the flooding along its mapped centreline (how much of it a car can't use, for how long).

const SURF = { light: { bg: '#ffffff', bld: '#dfe2e6', fg: '#1d2733' }, dark: { bg: '#121a24', bld: '#353d49', fg: '#e8eef4' } }; // buildings recede: the water is the subject
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
// sequential ramps: light → dark on the light surface, dark → light on the dark one (magnitude moves away from the surface)
const RAMPS = { blue: { light: ['#a8c9ef', '#0d3a75'], dark: ['#2b5583', '#b9d7fb'] }, red: { light: ['#f4b9a3', '#8a1c17'], dark: ['#6a2c25', '#f8c1b4'] } };
/** n steps of a sequential ramp ('blue' depth and time, 'red' hazard). */
export const seqColors = (n, theme = 'light', hue = 'blue') => { const [a, b] = RAMPS[hue][theme === 'dark' ? 'dark' : 'light']; return Array.from({ length: n }, (_, i) => mix(a, b, n > 1 ? i / (n - 1) : 1)); };
/** Bins as [lo, hi) pairs → the bin of a value, or -1 outside them all. */
export const binOf = (bins, v) => (Number.isFinite(v) ? bins.findIndex(([lo, hi]) => v >= lo && v < hi) : -1);

/**
 * A raster map: bin(k) → a bin index (or -1 to leave the cell blank), colours and legend labels per bin, buildings grey.
 * geo: { nx, ny, bld }. → svg string (width wide, a legend strip under the map)
 */
export function binnedMapSvg(bin, colors, labels, { nx, ny, bld = null }, { width = 640, theme = 'light', title = '', unit = '' } = {}) {
  const P = SURF[theme === 'dark' ? 'dark' : 'light'], st = Math.max(1, Math.ceil(Math.max(nx, ny) / 480)), W = Math.ceil(nx / st), H = Math.ceil(ny / st), sc = width / W;
  const cls = (k) => (bld?.[k] ? -2 : bin(k)), paths = colors.map(() => []), bp = [];
  for (let J = 0; J < H; J++) {
    let I = 0;
    while (I < W) {
      const c = cls(J * st * nx + I * st); if (c === -1) { I++; continue; }
      const s0 = I; I++;
      while (I < W && cls(J * st * nx + I * st) === c) I++;
      (c === -2 ? bp : paths[c])?.push(`M${s0} ${J}h${I - s0}v1h${s0 - I}z`);
    }
  }
  const legH = (unit ? 42 : 30) / sc, fs = 11 / sc, esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), Ht = (H + legH).toFixed(2);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Ht}" width="${width}" height="${Math.round((H + legH) * sc)}" shape-rendering="crispEdges" font-family="system-ui, sans-serif" role="img" aria-label="${esc(title || 'map')}">`,
    `<rect width="${W}" height="${Ht}" fill="${P.bg}"/>`];
  if (bp.length) out.push(`<path d="${bp.join('')}" fill="${P.bld}"/>`);
  paths.forEach((d, c) => { if (d.length) out.push(`<path d="${d.join('')}" fill="${colors[c]}"><title>${esc(labels[c])}${unit ? ' ' + esc(unit) : ''}</title></path>`); });
  const n = labels.length + (bld ? 1 : 0), bw = (W - 8 / sc) / Math.max(n, 5);
  [...labels.map((l, c) => [l, colors[c]]), ...(bld ? [['building', P.bld]] : [])].forEach(([l, col], c) => {
    const x = 4 / sc + c * bw, y = H + 5 / sc;
    out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.94).toFixed(1)}" height="${(8 / sc).toFixed(1)}" fill="${col}" stroke="${P.fg}" stroke-opacity="0.25" stroke-width="${(0.5 / sc).toFixed(2)}"/>`);
    out.push(`<text x="${(x + bw * 0.47).toFixed(1)}" y="${(y + 19 / sc).toFixed(1)}" font-size="${(fs * 0.9).toFixed(1)}" fill="${P.fg}" text-anchor="middle">${esc(l)}</text>`);
  });
  if (unit) out.push(`<text x="${(4 / sc).toFixed(1)}" y="${(H + legH - 3 / sc).toFixed(1)}" font-size="${(fs * 0.85).toFixed(1)}" fill="${P.fg}" fill-opacity="0.75">${esc(unit)}</text>`);
  if (title) out.push(`<text x="${(4 / sc).toFixed(1)}" y="${(14 / sc).toFixed(1)}" font-size="${(12 / sc).toFixed(1)}" fill="${P.fg}" stroke="${P.bg}" stroke-width="${(3 / sc).toFixed(2)}" paint-order="stroke">${esc(title)}</text>`);
  out.push('</svg>');
  return out.join('');
}

/**
 * Flooding along each street: its mapped centreline sampled every cell, by name (unnamed ones by kind). Per street the
 * length, the length deeper than `wade` (15 cm: emergency vehicles only) and `stall` (30 cm: most cars float or stall),
 * the deepest point, the first time water got there (t_wet), the longest it stayed over 15 cm (t_above15), the top
 * speed. roads: [{ name, kind, line: [[x, y]] in cells }]. → [{ name, kind, length, wade, stall, maxDepth, arrival,
 * over15, speed }] by stall length, then wade length
 */
export function streetStats(roads, g, { dx = 1, wade = 0.15, stall = 0.30 } = {}) {
  const { nx, ny, maxDepth, tWet = null, tAbove15 = null, maxSpeed = null } = g, acc = new Map();
  for (const r of roads) {
    const L = r.line; if (!L || L.length < 2) continue;
    const name = r.name || `unnamed ${r.kind || 'street'}`;
    const e = acc.get(name) ?? { name, kind: r.kind ?? '', length: 0, wade: 0, stall: 0, maxDepth: 0, arrival: Infinity, over15: 0, speed: 0 }; acc.set(name, e);
    for (let s = 0; s + 1 < L.length; s++) {
      const [xa, ya] = L[s], [xb, yb] = L[s + 1], len = Math.hypot(xb - xa, yb - ya), m = Math.max(1, Math.ceil(len)), seg = len / m * dx;
      for (let t = 0; t < m; t++) {
        const i = Math.floor(xa + (xb - xa) * (t + 0.5) / m), j = Math.floor(ya + (yb - ya) * (t + 0.5) / m);
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i, d = maxDepth[k] > 0 ? maxDepth[k] : 0;
        e.length += seg; if (d >= wade) e.wade += seg; if (d >= stall) e.stall += seg; if (d > e.maxDepth) e.maxDepth = d;
        if (tWet && Number.isFinite(tWet[k]) && tWet[k] >= 0 && d >= 0.05 && tWet[k] < e.arrival) e.arrival = tWet[k];
        if (tAbove15 && tAbove15[k] > e.over15) e.over15 = tAbove15[k];
        if (maxSpeed && d >= 0.05 && maxSpeed[k] > e.speed) e.speed = maxSpeed[k];
      }
    }
  }
  return [...acc.values()].filter(e => e.length > 0).map(e => ({ ...e, arrival: Number.isFinite(e.arrival) ? e.arrival : NaN }))
    .sort((p, q) => q.stall - p.stall || q.wade - p.wade || q.maxDepth - p.maxDepth);
}
