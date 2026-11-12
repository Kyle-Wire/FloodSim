// Volume accounting for closed systems (PV-C1). Two kinds of quantity, never mixed:
//   exact   — volumes that follow from the inputs alone: a prismatic tank's A·d; a conduit that is full end to end,
//             A_full · L; the equilibrium level of a closed system at rest (still water: one level everywhere).
//   estimate — a part-full conduit's volume from a simulated depth: L · A(y). The water surface along a conduit in
//             motion is not level, so this is an ESTIMATE; `conduitVolumeBounds` gives the bracket that the end depths
//             imply (the surface between them is assumed monotone), and its width is what the estimate can claim.
import { area } from './geometry.mjs';

export const tankVolume = (A, d) => A * Math.max(0, d);
export const conduitFullVolume = (s, L) => area(s, s.D ?? Infinity) * L;
/** Estimate: L · A(y) at one representative depth. */
export const conduitVolumeEstimate = (s, L, y) => L * area(s, y);
/** Bracket: L · A(min end depth) ≤ V ≤ L · A(max end depth), for a monotone surface between the conduit's ends. */
export function conduitVolumeBounds(s, L, y1, y2) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); return { lo: L * area(s, lo), hi: L * area(s, hi) }; }
/**
 * Equilibrium level of tanks joined by a horizontal conduit at invert 0, at rest: total volume V0 = Σ A_i h + L A(h).
 * Solved by bisection; h is the common depth above the conduit invert (tank inverts also at 0).
 */
export function equilibriumDepth(tanks, s, L, V0, { hMax = 100 } = {}) {
  const V = (h) => tanks.reduce((a, t) => a + t.A * h, 0) + L * area(s, h);
  let lo = 0, hi = hMax; for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (V(m) < V0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Self-test twin: the volume of a part-full conduit by integrating A over its length for a linear surface y(x). */
export function conduitVolumeLinearSurface(s, L, y1, y2, n = 20000) { let v = 0; for (let i = 0; i < n; i++) v += area(s, y1 + (y2 - y1) * (i + 0.5) / n); return v * L / n; }
