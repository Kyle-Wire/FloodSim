// H&H report outputs: the standard plots and tables of a drainage / flood submittal, from what a run records.
//
//   hydrographs      control lines and storm-sewer outfalls, before vs after: peak, time to peak, volume
//   ponds            stage–storage–discharge (from the graded ground and the outlet rating), stage and outflow in time
//   HGL profiles     a pipe path from a manhole to its outfall: rim, crown, invert and the max hydraulic grade line,
//                    with surcharge (HGL above the crown), flooding (above the rim) and a freeboard check
//   WSE profiles     along a drawn profile line: ground, max water surface and depth, before vs after
//   gutter spread    at each inlet, across the street from the curb to where the max depth runs out
// Charts are standalone SVG strings (one y axis each; before dashed, after solid; direct labels and a legend), so the
// same figure shows in the drawer and prints in report.html. Pure functions; SI units in, display units by `fmt`.
import { rating } from './stormwater.js';

// ------------------------------------------------------------------ series

/** Peak, time of peak and volume (trapezoid) of a flow series [[t, q]]. */
export function seriesStats(q) {
  let peak = 0, tPeak = NaN, vol = 0;
  for (let m = 0; m < q.length; m++) {
    const [t, v] = q[m]; if (v > peak) { peak = v; tPeak = t; }
    if (m) vol += 0.5 * (v + q[m - 1][1]) * (t - q[m - 1][0]);
  }
  return { peak, tPeak, volume: vol };
}
/** Linear interpolation of a series [[x, y]] (sorted by x) at x; NaN outside. */
export function at(series, x) {
  if (!series.length || x < series[0][0] || x > series.at(-1)[0]) return NaN;
  let a = 0, b = series.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (series[m][0] <= x) a = m; else b = m; }
  const [x0, y0] = series[a], [x1, y1] = series[b]; return x1 === x0 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}
/** Two series on one x base (the union of their x values) → rows [{ x, a, b }]. */
export function align(a, b) {
  const xs = [...new Set([...a.map(p => p[0]), ...b.map(p => p[0])])].sort((p, q) => p - q);
  return xs.map(x => ({ x, a: at(a, x), b: at(b, x) }));
}

// ------------------------------------------------------------------ profiles along a line

/**
 * Sample grids every `step` m along a polyline in cell coordinates ([[col, row]], cell centres at +0.5). grids: { name:
 * Float32Array } on geo { nx, ny, dx }; the nearest cell is read. → [{ s (m from the start), col, row, k, [name]: value }]
 */
export function sampleProfile(line, grids, geo, step = 1) {
  const out = [], { nx, ny, dx } = geo; let s0 = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], L = Math.hypot(bx - ax, by - ay) * dx, n = Math.max(1, Math.ceil(L / step));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const t = j / n, x = ax + t * (bx - ax), y = ay + t * (by - ay), c = Math.floor(x), r = Math.floor(y);
      const row = { s: s0 + t * L, col: x, row: y, k: c >= 0 && r >= 0 && c < nx && r < ny ? r * nx + c : -1 };
      for (const [name, g] of Object.entries(grids)) row[name] = row.k >= 0 && g ? g[row.k] : NaN;
      out.push(row);
    }
    s0 += L;
  }
  return out;
}

// ------------------------------------------------------------------ storm sewer HGL

/**
 * The pipe path from node `from` downstream to an outfall (or to where the pipes end). net: { nodes: [{ outfall }],
 * pipes: [{ from, to }] } with pipes running from → to (downstream). → { nodes: [i…], pipes: [k…] }
 */
export function hglPath(net, from) {
  const down = new Map(); net.pipes.forEach((p, k) => { if (!down.has(p.from)) down.set(p.from, k); });
  const nodes = [from], pipes = [], seen = new Set([from]);
  let i = from;
  while (!net.nodes[i]?.outfall && down.has(i)) { const k = down.get(i), j = net.pipes[k].to; if (seen.has(j)) break; pipes.push(k); nodes.push(j); seen.add(j); i = j; }
  return { nodes, pipes };
}
/**
 * Profile along a pipe path: stations at each node (cumulative pipe length), the rim (ground), the pipe invert and crown
 * at both ends of each pipe, and the max HGL at each node. Flags per node: flooded (HGL above the rim), surcharged
 * (above the crown of the pipe leaving it), freeboard to the rim below `freeboard`. hgl: { nodes: [{ maxHead }] }.
 * → { stations: [{ node, s, rim, hgl, crown, invert, freeboard, flooded, surcharged, low }], pipes: [{ k, s0, s1, inv0, inv1, D }] }
 */
export function hglProfile(net, path, hgl, { freeboard = 0.3048 } = {}) {
  let s = 0; const pipes = [], stations = [];
  path.pipes.forEach((k, m) => {
    const p = net.pipes[k], L = p.L ?? p.length ?? 0;
    pipes.push({ k, s0: s, s1: s + L, inv0: p.invUp, inv1: p.invDown ?? p.invUp - (p.S ?? 0) * L, D: p.D, name: p.name ?? null });
    if (m === 0) stations.push({ node: path.nodes[0], s });
    s += L; stations.push({ node: path.nodes[m + 1], s });
  });
  if (!path.pipes.length) stations.push({ node: path.nodes[0], s: 0 });
  for (let m = 0; m < stations.length; m++) {
    const st = stations[m], n = net.nodes[st.node], out = pipes[m], into = pipes[m - 1];
    const crown = out ? out.inv0 + out.D : into ? into.inv1 + into.D : NaN, invert = out ? out.inv0 : into ? into.inv1 : n.invert ?? NaN;
    const H = hgl?.nodes?.[st.node]?.maxHead ?? NaN, rim = n.ground ?? NaN;
    Object.assign(st, { name: n.name ?? String(st.node), rim, hgl: H, crown, invert, outfall: !!n.outfall, freeboard: rim - H,
      flooded: !n.outfall && H > rim + 1e-6, surcharged: H > crown + 1e-6, low: !n.outfall && rim - H < freeboard });
  }
  return { stations, pipes };
}

// ------------------------------------------------------------------ ponds

/**
 * Stage–storage–discharge table of a pond: stages from the bottom to the top of the stage–storage table (free outfall),
 * every `n`-th entry thinned to about `rows`. ss: { h, S, area } (stageStorage), structure: the outlet's rating input.
 * → [{ stage, depth, storage, area, q, orifices, weir, spillway }]
 */
export function stageStorageDischarge(ss, structure, { rows = 25 } = {}) {
  const n = ss.h.length, every = Math.max(1, Math.round((n - 1) / (rows - 1))), out = [];
  for (let m = 0; m < n; m += every) push(m);
  if ((n - 1) % every) push(n - 1);
  function push(m) { const r = structure ? rating(structure, ss.h[m]) : { q: 0, parts: {} }; out.push({ stage: ss.h[m], depth: ss.h[m] - ss.h[0], storage: ss.S[m], area: ss.area?.[m] ?? NaN, q: r.q, orifices: r.parts.orifices ?? 0, weir: r.parts.weir ?? 0, spillway: r.parts.spillway ?? 0 }); }
  return out;
}

// ------------------------------------------------------------------ gutter spread

/** Nearest point on polylines (cell coordinates) to (x, y) → { d, px, py, tx, ty (unit tangent) } or null. */
export function nearestOnLines(lines, x, y) {
  let best = null;
  for (const ln of lines) for (let i = 0; i + 1 < ln.length; i++) {
    const [ax, ay] = ln[i], [bx, by] = ln[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy; if (!L2) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)), px = ax + t * vx, py = ay + t * vy, d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, px, py, tx: vx / L, ty: vy / L }; }
  }
  return best;
}
/**
 * Spread at an inlet: from the grate (at the curb) across the street, toward the nearest road centreline, along the
 * perpendicular to it, to the last cell deeper than `thr` (water width measured from the curb, as in HEC-22). depth:
 * the run's max-depth grid; roads: centrelines in cell coordinates. The walk stops at the far curb (twice the distance
 * to the centreline): water that far across has filled the street (`full`).
 * → { spread (m), gutterDepth (m), dir: [dx, dy] (unit, cells), toCentre (m), full } or null when no road is near.
 */
export function gutterSpread(depth, geo, inlet, roads, { thr = 0.003, maxSpan = null, nearRoad = 15 } = {}) {
  const { nx, ny, dx } = geo, x = inlet[0], y = inlet[1], seg = nearestOnLines(roads, x, y);
  if (!seg || seg.d * dx > nearRoad) return null;
  let ux = seg.px - x, uy = seg.py - y, L = Math.hypot(ux, uy);
  if (L < 1e-6) { ux = -seg.ty; uy = seg.tx; L = 1; } // on the centreline: either side
  ux /= L; uy /= L;
  maxSpan ??= Math.max(3, 2 * L * dx); // the far curb
  const val =(px, py) => { const c = Math.floor(px), r = Math.floor(py); return c < 0 || r < 0 || c >= nx || r >= ny ? NaN : depth[r * nx + c]; };
  const g = val(x, y), h = 0.25; // quarter-cell steps
  let last = Number.isFinite(g) && g > thr ? 0.5 : 0, dry = 0;
  for (let s = h; s * dx <= maxSpan; s += h) {
    const v = val(x + ux * s, y + uy * s);
    if (Number.isFinite(v) && v > thr) { last = s + 0.5; dry = 0; } else if (++dry * h >= 1.5) break; // 1.5 cells dry: the water edge
  }
  return { spread: Math.min(maxSpan, last * dx), gutterDepth: Number.isFinite(g) ? g : 0, dir: [ux, uy], toCentre: L * dx, full: last * dx >= maxSpan - 1e-9 };
}

// ------------------------------------------------------------------ SVG charts

/** Validated chart tokens (dataviz reference palette): before = slot 2 (orange, dashed), after = slot 1 (blue, solid). */
export const THEMES = {
  light: { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', after: '#2a78d6', before: '#eb6834', ground: '#52514e', fill: '#e1e0d9', bad: '#d03b3b', good: '#0ca30c' },
  dark: { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', after: '#3987e5', before: '#d95926', ground: '#c3c2b7', fill: '#2c2c2a', bad: '#d03b3b', good: '#0ca30c' },
};
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Round tick values from the tick at or below lo to the one at or above hi, about n of them. */
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / Math.max(1, n), mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag, step = (f >= 7.07 ? 10 : f >= 3.16 ? 5 : f >= 1.41 ? 2 : 1) * mag; // √50, √10, √2 breaks
  const out = []; const end = Math.ceil(hi / step - 1e-9) * step; // the axis runs to the tick at or above the data
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= end + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return { ticks: out, step };
}
const fmtTick = (v, step) => { const dp = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }); };

/**
 * A line chart as a standalone SVG string, one y axis. series: [{ name, pts: [[x, y]], role: 'after' | 'before' | 'ground'
 * | 'line', fillBelow?: bool, label?: bool (direct label at the end, default on) }]; refs: horizontal reference lines
 * [{ y, label }]; markers: [{ x, y, label }] (e.g. finished floors). o: { title, xLabel, yLabel, width, height, theme,
 * yMin?, yMax?, zeroY?, xTicks?: [{ v, label }] (fixed x ticks, e.g. return periods on a log axis) }. NaN gaps break a line.
 */
export function lineChart(series, o = {}) {
  const T = THEMES[o.theme ?? 'light'], W = o.width ?? 640, H = o.height ?? 300, m = { l: 58, r: 96, t: o.title ? 28 : 12, b: 40 };
  const pts = series.flatMap(s => s.pts).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const ys = [...pts.map(p => p[1]), ...(o.refs ?? []).map(r => r.y).filter(Number.isFinite), ...(o.markers ?? []).map(r => r.y).filter(Number.isFinite)];
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = o.yMin ?? Math.min(...ys), y1 = o.yMax ?? Math.max(...ys);
  if (!pts.length) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  if (o.zeroY) y0 = Math.min(0, y0);
  const pad = (y1 - y0) * 0.06 || 0.5; if (o.yMin == null && !o.zeroY) y0 -= pad; if (o.yMax == null) y1 += pad;
  if (o.xTicks) { x0 = Math.min(x0, ...o.xTicks.map(t => t.v)); x1 = Math.max(x1, ...o.xTicks.map(t => t.v)); }
  const X = o.xTicks ? { ticks: o.xTicks.map(t => t.v), step: 1 } : niceTicks(x0, x1, 6), Y = niceTicks(y0, y1, 5); y0 = Math.min(y0, Y.ticks[0]); y1 = Math.max(y1, Y.ticks.at(-1));
  const px = (x) => m.l + (x - x0) / (x1 - x0 || 1) * (W - m.l - m.r), py = (y) => H - m.b - (y - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,Segoe UI,sans-serif" font-size="11" role="img" aria-label="${xmlEsc(o.title ?? 'chart')}">`,
    `<rect width="${W}" height="${H}" fill="${T.surface}"/>`];
  if (o.title) out.push(`<text x="${m.l}" y="17" fill="${T.ink}" font-size="12.5" font-weight="600">${xmlEsc(o.title)}</text>`);
  for (const v of Y.ticks) if (v >= y0 - 1e-9 && v <= y1 + 1e-9) out.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}" stroke="${T.grid}" stroke-width="1"/><text x="${m.l - 6}" y="${(py(v) + 3.5).toFixed(1)}" fill="${T.muted}" text-anchor="end">${fmtTick(v, Y.step)}</text>`);
  for (const v of X.ticks) if (v >= x0 - 1e-9 && v <= x1 + 1e-9) out.push(`<text x="${px(v).toFixed(1)}" y="${H - m.b + 15}" fill="${T.muted}" text-anchor="middle">${o.xTicks ? xmlEsc(o.xTicks.find(t => t.v === v).label) : fmtTick(v, X.step)}</text>`);
  out.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${T.axis}"/>`);
  if (o.xLabel) out.push(`<text x="${(m.l + W - m.r) / 2}" y="${H - 6}" fill="${T.ink2}" text-anchor="middle">${xmlEsc(o.xLabel)}</text>`);
  if (o.yLabel) out.push(`<text transform="translate(13 ${(m.t + H - m.b) / 2}) rotate(-90)" fill="${T.ink2}" text-anchor="middle">${xmlEsc(o.yLabel)}</text>`);
  const colour = (s) => (s.role === 'before' ? T.before : s.role === 'after' ? T.after : s.role === 'ground' ? T.ground : s.colour ?? T.ink2);
  const labels = [];
  for (const s of series) {
    const segs = []; let cur = [];
    for (const [x, y] of s.pts) { if (Number.isFinite(x) && Number.isFinite(y)) cur.push([px(x), py(y)]); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    for (const sg of segs) {
      const d = sg.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join('');
      if (s.fillBelow) out.push(`<path d="${d}L${sg.at(-1)[0].toFixed(1)} ${H - m.b}L${sg[0][0].toFixed(1)} ${H - m.b}Z" fill="${T.fill}" opacity="0.8"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${colour(s)}" stroke-width="${s.role === 'ground' ? 1.5 : 2}" stroke-linejoin="round"${s.role === 'before' || s.dash ? ' stroke-dasharray="6 4"' : ''}/>`);
    }
    const lastSeg = segs.at(-1); if (lastSeg && s.label !== false) labels.push({ y: lastSeg.at(-1)[1], x: lastSeg.at(-1)[0], text: s.name, c: colour(s) });
  }
  for (const r of o.refs ?? []) if (Number.isFinite(r.y)) { const yy = py(r.y).toFixed(1); out.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${r.colour ?? T.ink2}" stroke-width="1" stroke-dasharray="2 3"/>`); labels.push({ y: +yy, x: W - m.r, text: r.label, c: T.ink2 }); }
  for (const k of o.markers ?? []) if (Number.isFinite(k.x) && Number.isFinite(k.y)) out.push(`<path d="M${(px(k.x) - 5).toFixed(1)} ${py(k.y).toFixed(1)}h10" stroke="${T.ink}" stroke-width="2"/><text x="${px(k.x).toFixed(1)}" y="${(py(k.y) - 5).toFixed(1)}" fill="${T.ink2}" text-anchor="middle" font-size="10">${xmlEsc(k.label)}</text>`);
  // direct labels at the right edge, nudged apart (text in ink, a colour tick beside it carries identity)
  labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
  for (const l of labels) out.push(`<line x1="${W - m.r + 4}" x2="${W - m.r + 12}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="${l.c}" stroke-width="2"/><text x="${W - m.r + 15}" y="${(l.y + 3.5).toFixed(1)}" fill="${T.ink}">${xmlEsc(l.text)}</text>`);
  out.push('</svg>');
  return out.join('');
}
/**
 * Horizontal bars (sorted as given) with an allowable line: rows [{ label, value, fail }]. Failing bars carry a ✕ and the
 * word "over" (never colour alone). o: { title, unit, limit, limitLabel, theme, width }
 */
export function barChart(rows, o = {}) {
  const T = THEMES[o.theme ?? 'light'], W = o.width ?? 640, bh = 16, gap = 4, m = { l: 120, r: 90, t: o.title ? 44 : 22, b: 30 }, H = m.t + m.b + rows.length * (bh + gap);
  const vmax = Math.max(o.limit ?? 0, ...rows.map(r => r.value).filter(Number.isFinite), 1e-9), X = niceTicks(0, vmax, 5), xmax = X.ticks.at(-1);
  const px = (v) => m.l + v / xmax * (W - m.l - m.r);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,Segoe UI,sans-serif" font-size="11" role="img" aria-label="${xmlEsc(o.title ?? 'bars')}"><rect width="${W}" height="${H}" fill="${T.surface}"/>`];
  if (o.title) out.push(`<text x="10" y="17" fill="${T.ink}" font-size="12.5" font-weight="600">${xmlEsc(o.title)}</text>`);
  for (const v of X.ticks) out.push(`<line x1="${px(v).toFixed(1)}" x2="${px(v).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" stroke="${T.grid}"/><text x="${px(v).toFixed(1)}" y="${H - m.b + 14}" fill="${T.muted}" text-anchor="middle">${fmtTick(v, X.step)}</text>`);
  if (o.unit) out.push(`<text x="${W - m.r}" y="${H - 4}" fill="${T.ink2}" text-anchor="end">${xmlEsc(o.unit)}</text>`);
  rows.forEach((r, i) => {
    const y = m.t + i * (bh + gap), w = Math.max(0, px(r.value) - m.l);
    out.push(`<text x="${m.l - 6}" y="${y + bh - 4}" fill="${T.ink2}" text-anchor="end">${xmlEsc(r.label)}</text><rect x="${m.l}" y="${y}" width="${w.toFixed(1)}" height="${bh}" rx="2" fill="${T.after}"/>` +
      `<text x="${(m.l + w + 4).toFixed(1)}" y="${y + bh - 4}" fill="${T.ink}">${xmlEsc(r.text ?? '')}${r.fail ? ' ✕ over' : ''}</text>`);
  });
  if (Number.isFinite(o.limit)) out.push(`<line x1="${px(o.limit).toFixed(1)}" x2="${px(o.limit).toFixed(1)}" y1="${m.t - 4}" y2="${H - m.b}" stroke="${T.ink}" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${px(o.limit).toFixed(1)}" y="${m.t - 6}" fill="${T.ink}" text-anchor="middle">${xmlEsc(o.limitLabel ?? 'allowable')}</text>`);
  out.push('</svg>');
  return out.join('');
}
