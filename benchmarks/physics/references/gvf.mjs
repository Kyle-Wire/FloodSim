// Gradually varied flow in a prismatic channel, two independent methods (Chow 1959 §10):
//   standard step: for each station Δx, solve the energy equation E1 + S0 Δx = E2 + S̄f Δx for the unknown depth;
//   direct step:   for each depth increment Δy, Δx = ΔE / (S̄f − S0) (x measured upstream).
// Both march upstream from a downstream control on a subcritical profile (M1 backwater or M2 drawdown). The two are
// compared by the self-tests; they share only the geometry and Manning's friction slope.
import { area, topWidth } from './geometry.mjs';
import { frictionSlope, G } from './manning.mjs';

const energy = (s, y, Q) => y + (Q / area(s, y)) ** 2 / (2 * G);

/** Standard step upstream from depth y0 at x = 0 (downstream) over distance Lx with step dx. Returns [{ x, y }] with x
 * measured upstream. Each station's depth by bisection on the energy residual within [yc, 50]. */
export function standardStep(s, Q, n, S0, y0, Lx, dx, yc) {
  const out = [{ x: 0, y: y0 }]; let y = y0;
  for (let x = dx; x <= Lx + 1e-9; x += dx) {
    const E1 = energy(s, y, Q), Sf1 = frictionSlope(s, y, Q, n);
    // upstream station 2 lies S0·Δx higher: z2 + E2 = z1 + E1 + S̄f Δx, so E2 − E1 + S0 Δx − S̄f Δx = 0
    const res = (y2) => energy(s, y2, Q) - E1 + S0 * dx - 0.5 * (Sf1 + frictionSlope(s, y2, Q, n)) * dx;
    // the subcritical root lies above critical depth
    let lo = yc * 1.0000001, hi = 50;
    if (res(lo) * res(hi) > 0) { out.push({ x, y: NaN }); break; }
    for (let k = 0; k < 200 && hi - lo > 1e-12; k++) { const m = (lo + hi) / 2; if (res(lo) * res(m) <= 0) hi = m; else lo = m; }
    y = (lo + hi) / 2; out.push({ x, y });
  }
  return out;
}
/** Direct step from y0 towards yEnd in N equal depth increments. Returns [{ x, y }], x measured upstream. */
export function directStep(s, Q, n, S0, y0, yEnd, N) {
  const out = [{ x: 0, y: y0 }]; let x = 0;
  for (let i = 1; i <= N; i++) {
    const ya = y0 + (yEnd - y0) * (i - 1) / N, yb = y0 + (yEnd - y0) * i / N;
    const dE = energy(s, yb, Q) - energy(s, ya, Q), Sf = 0.5 * (frictionSlope(s, ya, Q, n) + frictionSlope(s, yb, Q, n));
    x += dE / (Sf - S0); out.push({ x, y: yb }); // E2 − E1 = (S̄f − S0) Δx, Δx upstream
  }
  return out;
}
/** Linear interpolation of a profile's depth at x (profile sorted by x). */
export function depthAt(profile, x) {
  const p = [...profile].sort((a, b) => a.x - b.x);
  if (x <= p[0].x) return p[0].y; if (x >= p.at(-1).x) return p.at(-1).y;
  const k = p.findIndex(q => q.x >= x); const a = p[k - 1], b = p[k];
  return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
}
export { energy };
