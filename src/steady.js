// Steady-flow test mode (benchmarks/rating, RT-1): a river reach run at a stepped constant discharge with no rain and
// no infiltration, the water surface recorded at a gauge, so the model's level against flow can be checked against
// USGS field measurements. Opt-in only: the project's hidden `steadyTest` input holds the setup as JSON, e.g.
//   { "steps": [[2.1, 90], [5.3, 90], …],   flow m³/s and how long it is held, minutes
//     "ramp": 10,                            minutes of linear change between steps (default 10)
//     "fill": { "q": 32.5, "hours": 5 },     a warm-up at this flow before the steps (app/map.js warmUp), so the
//                                            reach and its floodplain hollows start full (RT-1 Revision 2)
//     "inflow": [lon, lat],                  the river entry nearest this point takes the flow (default the first)
//     "gauge": { "site": "05470000", "name": "…", "lon": …, "lat": … } }
// Nothing here changes a run without that input.

/** The setup, or null when the input is empty or not valid. */
export function parseSteady(text) {
  if (!text || !String(text).trim()) return null;
  let s; try { s = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(s?.steps) || !s.steps.length || !s.steps.every(Array.isArray)) return null;
  const steps = s.steps.map(([q, min]) => [Number(q), Number(min)]);
  if (steps.some(([q, m]) => !(q >= 0) || !(m > 0))) return null;
  const fill = s.fill && Number(s.fill.q) >= 0 && Number(s.fill.hours) > 0 ? { q: Number(s.fill.q), hours: Number(s.fill.hours) } : undefined;
  return { ...s, fill, steps, ramp: Number.isFinite(Number(s.ramp)) ? Math.max(0, Number(s.ramp)) : 10 };
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
