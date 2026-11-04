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
