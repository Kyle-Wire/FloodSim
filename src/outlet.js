// River outlet: the level a river leaving the model stands at where it crosses the edge, from a gauge downstream.
// A free outfall lets a deep river pour off the edge as if over a fall, and the water upstream draws down toward it: on
// the Schuylkill at East Falls (Ida 2021) the edge stood 3.6 m under the marks, and the Manayunk gauge 2.4 km upstream
// 1.5 m low. What holds the river up is downstream of the model (Fairmount Dam, 5.5 km on), so the edge needs its level.
//   level   the downstream gauge's recorded water surface (NAVD88)
//   rise    standard step (steady, gradually varied flow) up the reach from the gauge to the edge at the gauge's
//           recorded discharge: Δws = Δx · mean friction slope, S_f = (Q / K)², K = Σ w·d^5/3 / n over the edge's own
//           cross-section (the model cells along the edge), the reach taken as prismatic with a level bed between
// The edge cells then hold that level (the solver's water-level boundary, as a tide). The prismatic reach is the
// weakness: a reach that widens or deepens toward the gauge loses less head than this, one with bridges and islands more.

/** The edge's cross-section: bed elevation and Manning n of each cell, w = cell width (m). → { z: [], n: [], w } */
export function edgeSection(c, cells, w) {
  return { z: cells.map(k => c.z[k]), n: cells.map(k => (typeof c.manning === 'number' ? c.manning : c.manning?.[k]) || 0.035), w };
}

/** Conveyance (m³/s) of a section at water surface ws: Σ w · d^5/3 / n over the wet cells (each cell a wide strip, R ≈ d). */
export function conveyance(sec, ws) {
  let K = 0;
  for (let i = 0; i < sec.z.length; i++) { const d = ws - sec.z[i]; if (d > 0) K += sec.w * d ** (5 / 3) / sec.n[i]; }
  return K;
}

/**
 * Water surface at the upstream end of a prismatic reach of length L (m) carrying Q (m³/s), given the surface wsDown at
 * its downstream end: standard step in `steps` sub-reaches, each solved for its upstream surface by bisection on
 * ws = ws₀ + Δx · ½ (S_f(ws₀) + S_f(ws)). A dry section at the gauge's level (the gauge reads below the edge's bed) is
 * started from the section's lowest wet level. → m
 */
export function backwater(sec, Q, wsDown, L, steps = 20) {
  const bed = Math.min(...sec.z), Sf = (ws) => { const K = conveyance(sec, ws); return K > 0 ? (Q / K) ** 2 : Infinity; };
  let ws = Math.max(wsDown, bed + 0.01);
  if (!(Q > 0) || !(L > 0)) return ws;
  const dx = L / steps;
  for (let s = 0; s < steps; s++) {
    const s0 = Sf(ws), f = (x) => x - ws - dx * 0.5 * (s0 + Sf(x)); // increasing in x; f(ws) < 0
    let lo = ws, hi = ws + 1;
    while (f(hi) < 0 && hi - ws < 1e4) hi = ws + 2 * (hi - ws);
    for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (f(m) < 0) lo = m; else hi = m; }
    ws = 0.5 * (lo + hi);
  }
  return ws;
}

/** Linear interpolation in [[t, v]] (held flat beyond the ends). */
const interp = (s, t) => {
  if (!s.length) return NaN;
  if (t <= s[0][0]) return s[0][1];
  if (t >= s.at(-1)[0]) return s.at(-1)[1];
  let a = 0, b = s.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (s[m][0] <= t) a = m; else b = m; }
  const [t0, v0] = s[a], [t1, v1] = s[b];
  return t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v0;
};

/**
 * The edge's level over time: at each reading of the downstream gauge's level, the backwater rise to the edge at its
 * discharge then (flow: [[t, Q]]; none gives no rise). level: [[t, ws (m NAVD88)]]. → { t: [], v: [], down: [], q: [] }
 */
export function outletSeries(sec, level, flow, L) {
  const out = { t: [], v: [], down: [], q: [] };
  for (const [t, ws] of level) {
    const q = flow?.length ? interp(flow, t) : 0;
    out.t.push(t); out.down.push(ws); out.q.push(q); out.v.push(backwater(sec, q, ws, L));
  }
  return out;
}

/**
 * The model edge facing a point outside it (grid cell coordinates I, J, possibly off the grid): the side the line from
 * the grid's centre to it leaves through. → 'north' | 'south' | 'east' | 'west' (rows run north to south)
 */
export function sideToward(nx, ny, I, J) {
  const dx = (I - nx / 2) / (nx / 2), dy = (J - ny / 2) / (ny / 2);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
}

/** Whether edge cell k lies on that side of an nx × ny grid. */
export const onSide = (k, nx, ny, side) => {
  const i = k % nx, j = (k / nx) | 0;
  return side === 'north' ? j === 0 : side === 'south' ? j === ny - 1 : side === 'west' ? i === 0 : i === nx - 1;
};

// ------------------------------------------------------------------ the reach from lidar cross-sections
// Where the river can be traced to the gauge, the rise comes from the reach itself instead of a prismatic one: the
// NHDPlus main stem up from the gauge (USGS NLDI) to where it enters the model, cross-sections cut from the 3DEP
// lidar across it every `spacing` m, the channel under the lidar's flat water carved as the model carves its own
// (a parabola, its centre depth from the bankfull curve less the bank height), and a standard step up the sections
// with velocity heads, friction on the average conveyance and contraction / expansion losses (HEC-RAS defaults 0.1 /
// 0.3). Bridges and piers are still left out: the lidar's bare earth has no decks.
const G = 9.81;
const NLDI = 'https://api.water.usgs.gov/nldi/linked-data';

/** The main stem up from a USGS gauge, km long, as one [lon, lat] line ordered upstream from the gauge. */
export async function riverPath(site, fetcher, km = 30) {
  const r = await fetcher(`${NLDI}/nwissite/USGS-${site}/navigation/UM/flowlines?distance=${km}&f=json`);
  if (!r.ok) throw new Error(`NLDI ${r.status}`);
  const lines = ((await r.json()).features || []).map(f => f.geometry?.type === 'LineString' ? f.geometry.coordinates : (f.geometry?.coordinates ?? []).flat()).filter(l => l.length > 1);
  const g = await (await fetcher(`${NLDI}/nwissite/USGS-${site}?f=json`)).json(), gp = g.features?.[0]?.geometry?.coordinates;
  if (!lines.length || !gp) throw new Error('no NHDPlus main stem at the gauge');
  // chain the flowlines (each drawn downstream): from the line nearest the gauge, step to the one ending where it begins
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2, near = (l) => Math.min(...l.map(p => d2(p, gp)));
  const cur = lines.reduce((a, b) => (near(b) < near(a) ? b : a)), left = lines.filter(l => l !== cur);
  // the gauge's own line: from the vertex nearest the gauge, upstream
  let k = 0; cur.forEach((p, i) => { if (d2(p, gp) < d2(cur[k], gp)) k = i; });
  const path = [gp, ...cur.slice(0, k + 1).reverse()];
  for (;;) {
    const head = path.at(-1), i = left.findIndex(l => d2(l.at(-1), head) < 1e-9);
    if (i < 0) break;
    path.push(...left[i].slice(0, -1).reverse()); left.splice(i, 1);
  }
  return path;
}

/**
 * The part of a path (UTM [x, y], from the gauge upstream) up to where it first enters `inside(x, y)`, and its length.
 * → { line, length } | null when it never enters
 */
export function pathToEdge(line, inside) {
  let L = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], seg = Math.hypot(bx - ax, by - ay);
    if (inside(bx, by)) {
      let lo = 0, hi = 1; // bisect the crossing
      for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (inside(ax + m * (bx - ax), ay + m * (by - ay))) hi = m; else lo = m; }
      return { line: [...line.slice(0, i), [ax + hi * (bx - ax), ay + hi * (by - ay)]], length: L + hi * seg };
    }
    L += seg;
  }
  return null;
}

/** Conveyance K, flow area A and top width T of a section { s: stations (m), z, n } at water surface ws (trapezoid panels). */
export function sectionHydraulics(sec, ws) {
  let K = 0, A = 0, T = 0;
  for (let i = 1; i < sec.s.length; i++) {
    const b = sec.s[i] - sec.s[i - 1], d0 = ws - sec.z[i - 1], d1 = ws - sec.z[i];
    if (!(b > 0) || (d0 <= 0 && d1 <= 0)) continue;
    // the wet part of the panel and its mean depth
    const both = d0 > 0 && d1 > 0, wet = both ? b : b * Math.max(d0, d1) / (Math.abs(d0) + Math.abs(d1)), dm = both ? (d0 + d1) / 2 : Math.max(d0, d1) / 2;
    A += wet * dm; T += wet; K += wet * dm ** (5 / 3) / ((sec.n[i - 1] + sec.n[i]) / 2);
  }
  return { K, A, T };
}

/**
 * Cross-sections along a UTM line (from the gauge upstream) every `spacing` m, `half` m each side, sampled every
 * `step` m from sample(x, y) → ground (NaN off the data). The lidar's flat water (within 0.15 m of the lowest point
 * near the centre line, contiguous with it) gets a parabolic channel `dc` m deep at its centre. n: { chan, bank }.
 * → [{ x (m from the gauge), s, z, n, ws (the lidar water surface), width (of that water) }]
 */
export function cutSections(line, sample, { spacing = 200, half = 300, step = 4, dc = 2, n = { chan: 0.035, bank: 0.06 } } = {}) {
  const out = [], seg = [];
  let L = 0;
  for (let i = 1; i < line.length; i++) { const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); seg.push([L, l, i]); L += l; }
  for (let x = 0; x <= L + 1e-6; x += spacing) {
    const [L0, l, i] = seg.find(([a, b]) => x <= a + b + 1e-6) ?? seg.at(-1), t = l > 0 ? (x - L0) / l : 0;
    const [ax, ay] = line[i - 1], [bx, by] = line[i], px = ax + t * (bx - ax), py = ay + t * (by - ay);
    const ux = (bx - ax) / (l || 1), uy = (by - ay) / (l || 1), nx = -uy, ny = ux; // across the flow
    const s = [], z = [];
    for (let o = -half; o <= half + 1e-6; o += step) { const v = sample(px + o * nx, py + o * ny); if (Number.isFinite(v)) { s.push(o); z.push(v); } }
    if (s.length < 5) continue;
    const c0 = s.reduce((b, v, j) => (Math.abs(v) < Math.abs(s[b]) ? j : b), 0);
    let lo = c0; for (let j = Math.max(0, c0 - 40); j <= Math.min(s.length - 1, c0 + 40); j++) if (z[j] < z[lo]) lo = j;
    const ws = z[lo]; let a = lo, b = lo;
    while (a > 0 && z[a - 1] <= ws + 0.15) a--;
    while (b < s.length - 1 && z[b + 1] <= ws + 0.15) b++;
    const nn = z.map(() => n.bank), W = s[b] - s[a];
    for (let j = a; j <= b; j++) { nn[j] = n.chan; if (W > 0) { const e = Math.min(s[j] - s[a], s[b] - s[j]) / (W / 2); z[j] = ws - dc * (1 - (1 - e) ** 2); } }
    out.push({ x, s, z, n: nn, ws, width: W });
  }
  return out;
}

/**
 * Standard step up a reach: sections ordered from the gauge upstream (each with x, its distance from the gauge),
 * Q (m³/s), the water surface at the first. Energy between neighbours: ws₂ + V₂²/2g = ws₁ + V₁²/2g + L·S̄f + C·|ΔV²/2g|,
 * S̄f = (2Q / (K₁ + K₂))², C = 0.1 where the flow speeds up, 0.3 where it slows (HEC-RAS defaults). A section where no
 * subcritical surface balances takes its critical depth. → { ws: at the last section, profile: [ws per section], critical }
 */
export function stepUp(sections, Q, wsDown, { cc = 0.1, ce = 0.3 } = {}) {
  const prof = [];
  let ws = Math.max(wsDown, Math.min(...sections[0].z) + 0.01), crit = 0;
  prof.push(ws);
  for (let i = 1; i < sections.length; i++) {
    const s2 = sections[i], bed = Math.min(...s2.z);
    if (!(Q > 0)) { ws = Math.max(ws, bed + 0.01); prof.push(ws); continue; }
    const s1 = sections[i - 1], L = Math.max(0, s2.x - s1.x), h1 = sectionHydraulics(s1, ws), v1 = Q / Math.max(h1.A, 1e-6), e1 = ws + v1 * v1 / (2 * G);
    const F = (x) => {
      const h2 = sectionHydraulics(s2, x); if (!(h2.A > 0)) return -Infinity;
      const v2 = Q / h2.A, sf = (2 * Q / (h1.K + h2.K)) ** 2, dv = (v2 * v2 - v1 * v1) / (2 * G);
      return x + v2 * v2 / (2 * G) - (e1 + L * sf + (dv > 0 ? cc : ce) * Math.abs(dv));
    };
    // critical depth (Froude 1: Q²T = gA³)
    const sub = (x) => { const h = sectionHydraulics(s2, x); return h.A ** 3 >= Q * Q * h.T / G; };
    let a = bed + 1e-3, b = bed + 1;
    while (!sub(b) && b - bed < 1e3) b = bed + 2 * (b - bed);
    for (let it = 0; it < 60; it++) { const m = (a + b) / 2; if (sub(m)) b = m; else a = m; }
    // the subcritical root above critical, where F rises with the surface
    let lo = b, hi = Math.max(lo, ws) + 1;
    if (F(lo) > 0) { ws = b; crit++; prof.push(ws); continue; }
    while (F(hi) < 0 && hi - lo < 1e3) hi = lo + 2 * (hi - lo);
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (F(m) < 0) lo = m; else hi = m; }
    ws = (lo + hi) / 2; prof.push(ws);
  }
  return { ws, profile: prof, critical: crit };
}

/** The edge's level over time through the reach's sections (stepUp at each gauge reading). → as outletSeries */
export function outletSeriesReach(sections, level, flow) {
  const out = { t: [], v: [], down: [], q: [] };
  for (const [t, ws] of level) {
    const q = flow?.length ? interp(flow, t) : 0;
    out.t.push(t); out.down.push(ws); out.q.push(q); out.v.push(stepUp(sections, q, ws).ws);
  }
  return out;
}

/** The model's edge cells as a stepUp section: stations w apart, their bed and n, at distance x from the gauge. */
export const edgeAsSection = (sec, x) => ({ x, s: sec.z.map((_, i) => i * sec.w), z: [...sec.z], n: [...sec.n] });
