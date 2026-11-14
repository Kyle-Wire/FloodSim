// Manning's equation (SI): Q = (1/n) A R^(2/3) S^(1/2). Normal depth by two independent root finders (bisection on
// Q(y) − Q; Newton with the analytic derivative), critical depth from Q² T / (g A³) = 1, and full-pipe friction loss.
// Sources: Manning (1891); Chow, Open-Channel Hydraulics (1959) §6, §4. No import from src/.
import { area, perimeter, topWidth, fullDepth } from './geometry.mjs';

export const G = 9.81;
export const manningQ = (s, y, n, S) => { const A = area(s, y), P = perimeter(s, y); return A > 0 ? (A / n) * Math.pow(A / P, 2 / 3) * Math.sqrt(S) : 0; };

/** Normal depth by bisection on [0, yMax]; yMax defaults to 50 m or the depth of maximum flow in a closed section. */
export function normalDepthBisect(s, Q, n, S, { yMax = null, tol = 1e-10 } = {}) {
  let lo = 0, hi = yMax ?? (Number.isFinite(fullDepth(s)) ? qMaxDepth(s, n, S) : 50);
  if (manningQ(s, hi, n, S) < Q) return NaN; // no part-full normal depth
  for (let k = 0; k < 200 && hi - lo > tol; k++) { const m = (lo + hi) / 2; if (manningQ(s, m, n, S) < Q) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Normal depth by Newton's method, dQ/dy = Q (5 T / (3 A) − 2 dP/dy / (3 P)) (open sections only). */
export function normalDepthNewton(s, Q, n, S, { y0 = 1, tol = 1e-12 } = {}) {
  if (s.shape === 'circle') throw new Error('Newton form: open sections only');
  const dP = s.shape === 'rect' ? 2 : 2 * Math.sqrt(1 + s.z * s.z);
  let y = y0;
  for (let k = 0; k < 100; k++) {
    const A = area(s, y), P = perimeter(s, y), T = topWidth(s, y), q = manningQ(s, y, n, S);
    const d = q * (5 * T / (3 * A) - 2 * dP / (3 * P)), step = (q - Q) / d;
    y = Math.max(y / 10, y - step); if (Math.abs(step) < tol) return y;
  }
  return NaN;
}
/** Critical depth: Froude 1, Q² T = g A³, by bisection. */
export function criticalDepth(s, Q, { yMax = 50, tol = 1e-10 } = {}) {
  const f = (y) => Q * Q * topWidth(s, y) - G * area(s, y) ** 3;
  let lo = 1e-9, hi = Math.min(yMax, Number.isFinite(fullDepth(s)) ? fullDepth(s) * 0.999 : yMax);
  for (let k = 0; k < 200 && hi - lo > tol; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export const froude = (s, Q, y) => (Q / area(s, y)) / Math.sqrt(G * area(s, y) / topWidth(s, y));
/** Depth of maximum Manning flow in a closed section (golden-section search). */
export function qMaxDepth(s, n, S) {
  let a = 0.5 * s.D, b = s.D; const r = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 200; k++) { const c = b - r * (b - a), d = a + r * (b - a); if (manningQ(s, c, n, S) > manningQ(s, d, n, S)) b = d; else a = c; }
  return (a + b) / 2;
}
/** Friction slope of a flowing section, S_f = (Q n / (A R^(2/3)))². */
export const frictionSlope = (s, y, Q, n) => { const A = area(s, y), R = A / perimeter(s, y); return (Q * n / (A * Math.pow(R, 2 / 3))) ** 2; };
/** Full-pipe Manning friction loss over L (m): h_f = L (Q n / (A R^(2/3)))², A = πD²/4, R = D/4. */
export const manningFullPipeLoss = (D, Q, n, L) => { const A = Math.PI * D * D / 4, R = D / 4; return L * (Q * n / (A * Math.pow(R, 2 / 3))) ** 2; };
