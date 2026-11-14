// Cross-section geometry from first principles: flow area A, wetted perimeter P, top width T at depth y (SI).
// Written from the definitions, not from FloodSim or SWMM. Each closed form has a numerical twin (quadrature of the
// width for A, arc length for P) used only by the self-tests to cross-check it.
//
// A section: { shape: 'rect', b } | { shape: 'trap', b, z } (z = horizontal : vertical side slope, both sides)
//            | { shape: 'circle', D }

export function area(s, y) {
  if (y <= 0) return 0;
  if (s.shape === 'rect') return s.b * y;
  if (s.shape === 'trap') return (s.b + s.z * y) * y;
  if (s.shape === 'circle') { const r = s.D / 2, yy = Math.min(y, s.D), th = 2 * Math.acos(1 - yy / r); return r * r * (th - Math.sin(th)) / 2; }
  throw new Error('unknown shape ' + s.shape);
}
export function perimeter(s, y) {
  if (y <= 0) return 0;
  if (s.shape === 'rect') return s.b + 2 * y;
  if (s.shape === 'trap') return s.b + 2 * y * Math.sqrt(1 + s.z * s.z);
  if (s.shape === 'circle') { const r = s.D / 2, yy = Math.min(y, s.D); return r * 2 * Math.acos(1 - yy / r); }
  throw new Error('unknown shape ' + s.shape);
}
export function topWidth(s, y) {
  if (s.shape === 'rect') return s.b;
  if (s.shape === 'trap') return s.b + 2 * s.z * Math.max(0, y);
  if (s.shape === 'circle') { const r = s.D / 2; if (y <= 0 || y >= s.D) return 0; return 2 * Math.sqrt(Math.max(0, r * r - (r - y) ** 2)); }
  throw new Error('unknown shape ' + s.shape);
}
export const hydRadius = (s, y) => (y > 0 ? area(s, y) / perimeter(s, y) : 0);
export const fullDepth = (s) => (s.shape === 'circle' ? s.D : Infinity);

// ---- numerical twins (self-tests only)
/** A(y) = ∫0^y T(η) dη by composite Simpson with n panels. */
export function areaByQuadrature(s, y, n = 20000) {
  if (y <= 0) return 0; const h = y / n; let sum = topWidth(s, 0) + topWidth(s, y);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * topWidth(s, i * h);
  return sum * h / 3;
}
/** P(y): bottom width plus the arc length of both walls, ∑ √(dη² + (dT/2)²), polyline with n pieces. */
export function perimeterByArcLength(s, y, n = 200000) {
  if (y <= 0) return 0;
  // a circle's wall starts horizontal at the invert: parametrise by angle there, by depth for the straight walls
  if (s.shape === 'circle') { const r = s.D / 2, th = Math.acos(1 - Math.min(y, s.D) / r); let L = 0, px = 0, py = -r;
    for (let i = 1; i <= n; i++) { const a = th * i / n, x = r * Math.sin(a), yy = -r * Math.cos(a); L += Math.hypot(x - px, yy - py); px = x; py = yy; } return 2 * L; }
  let L = 0, w0 = topWidth(s, 0) / 2;
  for (let i = 1; i <= n; i++) { const w = topWidth(s, y * i / n) / 2; L += Math.hypot(y / n, w - w0); w0 = w; }
  return topWidth(s, 0) + 2 * L;
}
