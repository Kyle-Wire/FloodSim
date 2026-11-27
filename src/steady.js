// Steady-flow test mode (benchmarks/rating, RT-1): a river reach run at a stepped constant discharge with no rain and
// no infiltration, the water surface recorded at a gauge, so the model's level against flow can be checked against
// USGS field measurements. Opt-in only: the project's hidden `steadyTest` input holds the setup as JSON, e.g.
//   { "steps": [[2.1, 90], [5.3, 90], …],   flow m³/s and how long it is held, minutes
//     "ramp": 10,                            minutes of linear change between steps (default 10)
//     "fill": { "q": 32.5, "hours": 5 },     a warm-up at this flow before the steps (app/map.js warmUp), so the
//                                            reach and its floodplain hollows start full (RT-1 Revision 2)
//     "inflow": [lon, lat],                  the river entry nearest this point takes the flow (default the first)
//     "gauge": { "site": "05470000", "name": "…", "lon": …, "lat": … },
//     "settle": { "startLevel": true,        the low ground connected to the held outlet edge starts at its level
//                 "change": 0.01,            then, after the fill hours, the fill goes on in 1 h chunks until the 95th
//                 "capHours": 24 } }         percentile of |Δ level| over the hour (cells wet at both ends) is under
//                                            this (m/h), stopping at capHours of run time in all (fill + steps)
// Nothing here changes a run without that input.

/** The setup, or null when the input is empty or not valid. */
export function parseSteady(text) {
  if (!text || !String(text).trim()) return null;
  let s; try { s = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(s?.steps) || !s.steps.length || !s.steps.every(Array.isArray)) return null;
  const steps = s.steps.map(([q, min]) => [Number(q), Number(min)]);
  if (steps.some(([q, m]) => !(q >= 0) || !(m > 0))) return null;
  const fill = s.fill && Number(s.fill.q) >= 0 && Number(s.fill.hours) > 0 ? { q: Number(s.fill.q), hours: Number(s.fill.hours) } : undefined;
  const st = s.settle;
  const settle = st && typeof st === 'object' ? { startLevel: st.startLevel !== false, change: Number(st.change) > 0 ? Number(st.change) : 0.01,
    capHours: Number(st.capHours) > 0 ? Number(st.capHours) : 24, wetMin: Number(st.wetMin) > 0 ? Number(st.wetMin) : 0.05 } : undefined;
  return { ...s, fill, settle, steps, ramp: Number.isFinite(Number(s.ramp)) ? Math.max(0, Number(s.ramp)) : 10 };
}

/** Total length of the stepped hydrograph, minutes. */
export const steadyMinutes = (s) => s.steps.reduce((a, [, m]) => a + m, 0);

/** Start and end (s) of each step's hold, after the ramp into it. → [{ q, t0, t1 }] */
export function stepWindows(s) {
  const out = []; let t = 0;
  for (let i = 0; i < s.steps.length; i++) {
    const [q, m] = s.steps[i], ramp = i ? Math.min(s.ramp, m / 2) * 60 : 0;
    out.push({ q, t0: t + ramp, t1: t + m * 60 }); t += m * 60;
  }
  return out;
}

/** The inflow (m³/s) at model time t (s): each step held, with a linear ramp from the previous step at its start. */
export function steadyFlow(s) {
  const w = stepWindows(s);
  return (t) => {
    for (let i = 0; i < w.length; i++) {
      if (t < w[i].t0) { const a = i ? w[i - 1].t1 : 0, p = (t - a) / (w[i].t0 - a); return w[i - 1].q + (w[i].q - w[i - 1].q) * Math.max(0, Math.min(1, p)); }
      if (t < w[i].t1) return w[i].q;
    }
    return w.at(-1).q;
  };
}

/** Extra fill hours a settle may add: the cap less the fill and the steps (never below 0). */
export const settleBudgetH = (s) => !s?.settle || !s.fill ? 0 : Math.max(0, s.settle.capHours - s.fill.hours - steadyMinutes(s) / 60);

/**
 * Plan A15 start: water depth that fills every cell reachable from `seeds` (8-connected through cells with ground
 * below `level`, inside `mask` when given) up to `level`. z: bed level per cell (nx × ny, row-major). → Float32Array
 */
export function fillToLevel(z, nx, ny, seeds, level, mask) {
  const d = new Float32Array(nx * ny), seen = new Uint8Array(nx * ny), q = new Int32Array(nx * ny); let a = 0, b = 0;
  const ok = (k) => !seen[k] && (!mask || mask[k]) && Number.isFinite(z[k]) && z[k] < level;
  for (const k of seeds ?? []) if (k >= 0 && k < nx * ny && ok(k)) { seen[k] = 1; q[b++] = k; }
  while (a < b) {
    const k = q[a++], i = k % nx, j = (k - i) / nx; d[k] = level - z[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if ((di || dj) && ii >= 0 && jj >= 0 && ii < nx && jj < ny) { const n = jj * nx + ii; if (ok(n)) { seen[n] = 1; q[b++] = n; } }
    }
  }
  return d;
}

/**
 * Plan A15 settle test over one hour: depths h0 and h1 (same grid, bed z fixed, so Δ level = Δ depth) at its two ends.
 * → { p95: 95th percentile of |Δ level| (m) over cells wet (≥ wetMin) at both ends, n: those cells, wet1: cells wet at
 * the end, rise: mean Δ level (m) }; p95 is Infinity when no cell is wet at both ends.
 */
export function settleStat(h0, h1, wetMin = 0.05) {
  const dv = []; let wet1 = 0, sum = 0;
  for (let k = 0; k < h1.length; k++) {
    if (h1[k] >= wetMin) wet1++;
    if (h0[k] >= wetMin && h1[k] >= wetMin) { const x = h1[k] - h0[k]; dv.push(Math.abs(x)); sum += x; }
  }
  if (!dv.length) return { p95: Infinity, n: 0, wet1, rise: 0 };
  const f = Float64Array.from(dv).sort();
  return { p95: f[Math.min(f.length - 1, Math.floor(0.95 * f.length))], n: f.length, wet1, rise: sum / f.length };
}

/** After an hour's settle test m (settleStat) with `extra` hours already added: 'settled', 'cap' or 'more'. */
export function settleNext(s, m, extra) {
  if (m.p95 < s.settle.change) return 'settled';
  return extra + 1 > settleBudgetH(s) ? 'cap' : 'more';
}
