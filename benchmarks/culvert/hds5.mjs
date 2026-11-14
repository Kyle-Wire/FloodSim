// Independent culvert hydraulics for the Stage B benchmarks: FHWA HDS-5 (3rd ed., 2012) inlet and outlet control,
// with exact section geometry. SI throughout. Written from the published equations, not from SWMM's code: SWMM's
// culvert.c works in US units and finds critical depth its own way. The inlet-control coefficients are HDS-5's
// Table A.3. SWMM's table copies the same numbers, so B1 checks SWMM's implementation and FloodSim's inputs (code,
// geometry, units, slope), not the coefficients themselves.

export const G = 9.81;
export const KU = 1.811; // HDS-5 unit factor, SI (1.0 in US units)

// HDS-5 Table A.3, inlet-control coefficients: form, K, M, c, Y, and the slope term Ks (−0.5, or +0.7 for mitered)
export const INLET = {
  'circle/concrete/headwall': { form: 1, K: 0.0098, M: 2.0, c: 0.0398, Y: 0.67, Ks: -0.5 }, // square edge with headwall
  'circle/metal/headwall': { form: 1, K: 0.0078, M: 2.0, c: 0.0379, Y: 0.69, Ks: -0.5 },
  'circle/metal/mitered': { form: 1, K: 0.0210, M: 1.33, c: 0.0463, Y: 0.75, Ks: 0.7 }, // mitered to conform to slope
  'circle/metal/projecting': { form: 1, K: 0.0340, M: 1.5, c: 0.0553, Y: 0.54, Ks: -0.5 },
  'box/concrete/headwall': { form: 1, K: 0.061, M: 0.75, c: 0.0400, Y: 0.80, Ks: -0.5 }, // 90° and 15° wingwall flares
  'h-ellipse/concrete/headwall': { form: 1, K: 0.0100, M: 2.0, c: 0.0398, Y: 0.67, Ks: -0.5 }, // square edge with headwall
};

// A standard-size (ASTM C507) horizontal elliptical pipe, shape 'he-std:<code>'. Its geometry is a GEOMETRY INPUT, not
// hydraulics: the published full area and hydraulic radius per size, and the normalised area, width and hydraulic-radius
// profiles at y/D = 0, 0.04 … 1 (the ASCE/WEF tables, as SWMM 5.2.4 holds them in xsect.dat). The reference and the
// simulated section then describe the same pipe; HDS-5's equations stay independent. The tables are not mutually
// consistent (∫W·span dy = 0.956 aFull; the area table runs up to 4.5 % above it at y/D 0.6–0.8): B1-4 tests SWMM's
// implementation on these tables, not whether the tables are true to the pipe.
export const STD_HE = {
  minorIn: [14, 19, 22, 24, 27, 29, 32, 34, 38, 43, 48, 53, 58, 63, 68, 72, 77, 82, 87, 92, 97, 106, 116],
  majorIn: [23, 30, 34, 38, 42, 45, 49, 53, 60, 68, 76, 83, 91, 98, 106, 113, 121, 128, 136, 143, 151, 166, 180],
  aFullFt2: [1.80, 3.30, 4.10, 5.10, 6.30, 7.40, 8.80, 10.20, 12.90, 16.60, 20.50, 24.80, 29.50, 34.60, 40.10, 46.10, 52.40, 59.20, 66.40, 74.00, 82.00, 99.20, 118.60],
  rFullFt: [0.367, 0.490, 0.546, 0.613, 0.686, 0.736, 0.812, 0.875, 0.969, 1.106, 1.229, 1.352, 1.475, 1.598, 1.721, 1.845, 1.967, 2.091, 2.215, 2.340, 2.461, 2.707, 2.968],
  A: [0, .0150, .0400, .0650, .0950, .1300, .1650, .2050, .2500, .3000, .3550, .4150, .4800, .5200, .5850, .6450, .7000, .7500, .7950, .8350, .8700, .9050, .9350, .9600, .9850, 1],
  R: [.0100, .0764, .1726, .2389, .3274, .4191, .5120, .5983, .6757, .7630, .8326, .9114, .9702, 1.030, 1.091, 1.146, 1.185, 1.225, 1.257, 1.274, 1.290, 1.282, 1.274, 1.257, 1.185, 1],
  W: [0, .3919, .5426, .6499, .7332, .8000, .8542, .8980, .9330, .9600, .9798, .9928, .9992, .9992, .9928, .9798, .9600, .9330, .8980, .8542, .8000, .7332, .6499, .5426, .3919, 0],
};
const stdCode = (shape) => (typeof shape === 'string' && shape.startsWith('he-std:') ? +shape.slice(7) : 0);
const tab = (t, a) => { const x = Math.min(Math.max(a, 0), 1) * (t.length - 1), i = Math.min(Math.floor(x), t.length - 2); return t[i] + (t[i + 1] - t[i]) * (x - i); };
/** rise and span (m) of a standard-size elliptical pipe. */
export const stdHE = (code) => ({ rise: STD_HE.minorIn[code - 1] * 0.0254, span: STD_HE.majorIn[code - 1] * 0.0254, aFull: STD_HE.aFullFt2[code - 1] * 0.3048 ** 2, rFull: STD_HE.rFullFt[code - 1] * 0.3048 });

/** Exact geometry of a section at depth y: { A, T, P } (area, top width, wetted perimeter). shape: circle | h-ellipse | box | he-std:<code>. */
export function geom(shape, rise, span, y) {
  y = Math.min(Math.max(y, 0), rise);
  const code = stdCode(shape);
  if (code) { const s = stdHE(code), a = y / s.rise, A = s.aFull * tab(STD_HE.A, a), R = s.rFull * tab(STD_HE.R, a); return { A, T: s.span * tab(STD_HE.W, a), P: R > 0 ? A / R : 0 }; }
  if (shape === 'box') return { A: span * y, T: y < rise ? span : 0, P: span + 2 * y + (y >= rise ? span : 0) };
  // circle and ellipse: integrate the width numerically (an ellipse's perimeter has no closed form)
  const a = rise / 2, b = span / 2, w = (yy) => 2 * b * Math.sqrt(Math.max(0, 1 - ((yy - a) / a) ** 2));
  const n = 2000; let A = 0, P = 0, ylast = 0, wlast = w(0);
  for (let i = 1; i <= n; i++) { const yy = y * i / n, ww = w(yy); A += (ww + wlast) / 2 * (yy - ylast); P += 2 * Math.hypot((ww - wlast) / 2, yy - ylast); ylast = yy; wlast = ww; }
  return { A, T: w(y), P: P + (y >= rise - 1e-9 ? 0 : 0) };
}
export const fullArea = (shape, rise, span) => (stdCode(shape) ? stdHE(stdCode(shape)).aFull : shape === 'box' ? rise * span : Math.PI / 4 * rise * span);
const fullPerim = (shape, rise, span) => { if (stdCode(shape)) { const s = stdHE(stdCode(shape)); return s.aFull / s.rFull; } if (shape === 'box') return 2 * (rise + span); const a = rise / 2, b = span / 2, h = ((a - b) / (a + b)) ** 2; return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h))); }; // Ramanujan

/** Critical depth for discharge Q: Q²/g = A³/T, by bisection. */
export function criticalDepth(shape, rise, span, Q) {
  let lo = 1e-6, hi = rise * 0.999;
  const f = (y) => { const { A, T } = geom(shape, rise, span, y); return Q * Q / G - A ** 3 / Math.max(T, 1e-9); };
  if (f(hi) > 0) return hi; // beyond the crown: the barrel cannot carry Q at critical depth with a free surface
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * HDS-5 inlet-control headwater above the inlet invert (m) for discharge Q (m³/s, per barrel). Returns
 * { HW, regime: 'unsubmerged' | 'submerged' | 'transition', q } where q = Ku·Q/(A·D^0.5). In the transition (3.5 < q < 4.0)
 * HDS-5 interpolates between the two equations at their limits.
 */
export function inletControlHW(key, shape, rise, span, Q, S) {
  const c = INLET[key], A = fullArea(shape, rise, span), D = rise;
  const qf = (QQ) => KU * QQ / (A * Math.sqrt(D));
  const unsub = (QQ) => {
    const q = qf(QQ);
    if (c.form === 2) return D * (c.K * q ** c.M);
    const yc = criticalDepth(shape, rise, span, QQ), { A: Ac } = geom(shape, rise, span, yc), Hc = yc + (QQ / Ac) ** 2 / (2 * G);
    return D * (Hc / D + c.K * q ** c.M + c.Ks * S);
  };
  const sub = (QQ) => D * (c.c * qf(QQ) ** 2 + c.Y + c.Ks * S);
  const q = qf(Q);
  if (q <= 3.5) return { HW: unsub(Q), regime: 'unsubmerged', q };
  if (q >= 4.0) return { HW: sub(Q), regime: 'submerged', q };
  const Q1 = 3.5 * A * Math.sqrt(D) / KU, Q2 = 4.0 * A * Math.sqrt(D) / KU, h1 = unsub(Q1), h2 = sub(Q2);
  return { HW: h1 + (h2 - h1) * (Q - Q1) / (Q2 - Q1), regime: 'transition', q };
}

/**
 * Full-barrel outlet control: the energy equation between the headwater pool and the tailwater pool,
 * H = (Kentry + Kexit + Kf)·V²/2g with Kf = 2g·n²·L / R^(4/3). HDS-5 takes Kexit = 1. Returns the head loss (m),
 * so the headwater elevation is TW + H.
 */
export function outletControlFull(shape, rise, span, Q, n, L, { Ke = 0.5, Kx = 1 } = {}) {
  const A = fullArea(shape, rise, span), R = A / fullPerim(shape, rise, span), V = Q / A, hv = V * V / (2 * G);
  const Kf = 2 * G * n * n * L / R ** (4 / 3);
  return { H: (Ke + Kx + Kf) * hv, hv, Kf, V, R };
}

/** Normal depth in a filled circle (open part above a fill of depth s), Manning, by bisection. */
export function normalDepthFilledCircle(D, s, Q, n, S) {
  const cut = (y) => { // open section between the fill at s and the water at s + y
    const a = D / 2, chord = (h) => 2 * Math.sqrt(Math.max(0, a * a - (h - a) ** 2)); // width at height h
    const N = 2000; let A = 0, P = chord(s), hl = s, wl = chord(s);
    for (let i = 1; i <= N; i++) { const h = s + y * i / N, w = chord(h); A += (w + wl) / 2 * (h - hl); P += 2 * Math.hypot((w - wl) / 2, h - hl); hl = h; wl = w; }
    return { A, P };
  };
  const Qof = (y) => { const { A, P } = cut(y); return A ** (5 / 3) / P ** (2 / 3) * Math.sqrt(S) / n; };
  let lo = 1e-4, hi = (D - s) * 0.93; // below the open part's maximum-conveyance depth
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Qof(m) < Q) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * HDS-5 outlet control with a free or low tailwater (HDS-5 eq. 3.x): HW = h0 + H − S·L above the inlet invert, with
 * h0 = max(TW depth, (dc + D)/2). Used in B1 to confirm inlet control governs; full-barrel loss H from outletControlFull.
 */
export function outletControlHW(shape, rise, span, Q, n, L, S, twDepth, { Ke = 0.5, Kx = 1 } = {}) {
  const dc = Math.min(criticalDepth(shape, rise, span, Q), rise), h0 = Math.max(twDepth, (dc + rise) / 2);
  const { H } = outletControlFull(shape, rise, span, Q, n, L, { Ke, Kx });
  return h0 + H - S * L;
}

/** Specific energy at critical depth, the least energy that carries Q through the section (m above its invert). */
export function criticalEnergy(shape, rise, span, Q) {
  const yc = criticalDepth(shape, rise, span, Q), { A } = geom(shape, rise, span, yc);
  return yc + (Q / A) ** 2 / (2 * G);
}

/**
 * Manning normal depth in a barrel silted to depth s, any shape: the open section between the fill surface (its
 * width counts as wetted bed) and the water at s + y. Exact geometry, bisection. Returns { y, A, P, R }.
 */
export function normalDepthCut(shape, rise, span, s, Q, n, S) {
  const at = (y) => { const lo = geom(shape, rise, span, s), hi = geom(shape, rise, span, s + y); const A = hi.A - lo.A, P = hi.P - lo.P + lo.T; return { A, P, R: A / P }; };
  const Qof = (y) => { const { A, R } = at(y); return A * R ** (2 / 3) * Math.sqrt(S) / n; };
  // a closed section's conveyance peaks below its crown: search the rising branch only, up to that peak
  const open = rise - s; let yMax = open * 0.999, qMax = 0;
  if (shape !== 'box') for (let i = 1; i <= 2000; i++) { const yy = open * i / 2000 * 0.999, q = Qof(yy); if (q > qMax) { qMax = q; yMax = yy; } }
  if (shape !== 'box' && Q > qMax) return { y: NaN, error: "beyond the open section's maximum conveyance" };
  let lo = 1e-4, hi = yMax;
  for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Qof(m) < Q) lo = m; else hi = m; }
  const y = (lo + hi) / 2; return { y, yMaxConveyance: yMax, ...at(y) };
}

/** Manning discharge (m³/s) at depth y above the fill s, in the open section (the forward of normalDepthCut). */
export function manningQCut(shape, rise, span, s, y, n, S) {
  const lo = geom(shape, rise, span, s), hi = geom(shape, rise, span, s + y), A = hi.A - lo.A, P = hi.P - lo.P + lo.T;
  return A * (A / P) ** (2 / 3) * Math.sqrt(S) / n;
}
