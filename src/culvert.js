// Culvert hydraulics by FHWA HDS-5 (Hydraulic Design of Highway Culverts, 3rd ed., 2012): the method HEC-RAS, SWMM
// and HY-8 use. The flow a culvert passes is the smaller of
//   inlet control   what the entrance lets in for the headwater: HDS-5's unsubmerged and submerged equations with the
//                   Table A.3 coefficients for the entrance type, a straight line between them in the transition; and
//   outlet control  what the barrel carries for the head across it: entrance, friction and exit losses on the full
//                   barrel once the inlet or outlet is drowned, on the part-full section otherwise.
// Circular pipes and boxes, one or several barrels, separate inverts at each end. SI throughout.
//
// This is the production routine for culverts linked on the surface (src/links.js). The independent reference it is
// tested against is benchmarks/culvert/hds5.mjs, written separately from the same published equations; nothing here
// imports it. Water over the road is not this routine's business: the 2D solver carries it over the embankment.

export const G = 9.81;
const KU = 1.811; // HDS-5's unit factor for Q/(A·D^0.5) in SI (1.0 in US units)

/**
 * HDS-5 Table A.3 inlet-control coefficients by entrance: form (1 or 2), K, M, c, Y. `ke` is the entrance loss
 * coefficient for outlet control (HDS-5 Table C.2). The slope term Ks is −0.5, +0.7 for a mitered inlet.
 */
export const INLETS = {
  'circle-concrete-headwall':   { form: 1, K: 0.0098, M: 2.0,   c: 0.0398, Y: 0.67, ke: 0.5, shape: 'circle', label: 'concrete pipe, square edge with headwall' },
  'circle-concrete-groove':     { form: 1, K: 0.0018, M: 2.0,   c: 0.0292, Y: 0.74, ke: 0.2, shape: 'circle', label: 'concrete pipe, groove end with headwall' },
  'circle-concrete-projecting': { form: 1, K: 0.0045, M: 2.0,   c: 0.0317, Y: 0.69, ke: 0.2, shape: 'circle', label: 'concrete pipe, groove end projecting' },
  'circle-cmp-headwall':        { form: 1, K: 0.0078, M: 2.0,   c: 0.0379, Y: 0.69, ke: 0.5, shape: 'circle', label: 'corrugated metal pipe, headwall' },
  'circle-cmp-mitered':         { form: 1, K: 0.0210, M: 1.33,  c: 0.0463, Y: 0.75, ke: 0.7, shape: 'circle', label: 'corrugated metal pipe, mitered to the slope', mitered: true },
  'circle-cmp-projecting':      { form: 1, K: 0.0340, M: 1.5,   c: 0.0553, Y: 0.54, ke: 0.9, shape: 'circle', label: 'corrugated metal pipe, projecting' },
  'box-wingwall-30-75':         { form: 1, K: 0.026,  M: 1.0,   c: 0.0347, Y: 0.81, ke: 0.4, shape: 'box', label: 'box, wingwalls flared 30–75°' },
  'box-wingwall-90-15':         { form: 1, K: 0.061,  M: 0.75,  c: 0.0400, Y: 0.80, ke: 0.5, shape: 'box', label: 'box, wingwalls flared 90° or 15°' },
  'box-wingwall-0':             { form: 1, K: 0.061,  M: 0.75,  c: 0.0423, Y: 0.82, ke: 0.7, shape: 'box', label: 'box, straight wingwalls' },
  'box-headwall-chamfer':       { form: 2, K: 0.515,  M: 0.667, c: 0.0375, Y: 0.79, ke: 0.5, shape: 'box', label: 'box, 90° headwall, 3/4 in chamfers' },
};
/** The entrance assumed when nothing says: the square-edged headwall, the commonest and neither best nor worst. */
export const DEFAULT_INLET = { circle: 'circle-concrete-headwall', box: 'box-wingwall-30-75' };

/** Area, top width and wetted perimeter of one barrel at depth y. shape: 'circle' (rise = diameter) | 'box'. */
export function section(shape, rise, span, y) {
  const d = Math.min(Math.max(y, 0), rise);
  if (shape === 'box') return { A: span * d, T: span, P: d >= rise ? 2 * (span + rise) : span + 2 * d };
  if (d <= 0) return { A: 0, T: 0, P: 0 };
  const th = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 2 * d / rise)));
  return { A: rise * rise / 8 * (th - Math.sin(th)), T: rise * Math.sin(th / 2), P: rise * th / 2 };
}
const fullArea = (shape, rise, span) => (shape === 'box' ? rise * span : Math.PI / 4 * rise * rise);

/** Critical depth of one barrel at discharge Q (Q²/g = A³/T), capped at the rise. */
export function criticalDepth(shape, rise, span, Q) {
  if (!(Q > 0)) return 0;
  if (shape === 'box') return Math.min(rise, Math.cbrt((Q / span) ** 2 / G));
  let lo = 0, hi = rise * 0.9999;
  const f = (y) => { const s = section(shape, rise, span, y); return s.A ** 3 / Math.max(s.T, 1e-12) - Q * Q / G; };
  if (f(hi) < 0) return rise;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * Inlet-control headwater depth above the inlet invert (m) for Q through one barrel (HDS-5 Appendix A).
 * @param S barrel slope (m/m); HDS-5's slope correction −0.5·S (+0.7·S mitered)
 */
export function inletHeadwater(inlet, shape, rise, span, Q, S = 0) {
  if (!(Q > 0)) return 0;
  const p = typeof inlet === 'string' ? INLETS[inlet] : inlet, A = fullArea(shape, rise, span), ks = p.mitered ? 0.7 : -0.5, s = Math.max(0, Math.min(S, 0.1));
  const unsub = (Qx) => {
    const q = KU * Qx / (A * Math.sqrt(rise));
    if (p.form === 2) return rise * p.K * q ** p.M;
    const dc = criticalDepth(shape, rise, span, Qx), sc = section(shape, rise, span, dc), Hc = dc + (sc.A > 0 ? (Qx / sc.A) ** 2 / (2 * G) : 0);
    return Math.max(dc, Hc + rise * (p.K * q ** p.M + ks * s));
  };
  const sub = (Qx) => rise * (p.c * (KU * Qx / (A * Math.sqrt(rise))) ** 2 + p.Y + ks * s);
  const q = KU * Q / (A * Math.sqrt(rise)), toQ = (qq) => qq * A * Math.sqrt(rise) / KU;
  if (q <= 3.5) return unsub(Q);
  if (q >= 4.0) return sub(Q);
  const a = unsub(toQ(3.5)), b = sub(toQ(4.0));
  return a + (b - a) * (q - 3.5) / 0.5;
}

/** Normalise a culvert record: { shape, rise, span, barrels, len, invUp, invDn, n, ke, inlet }. Accepts the older
 *  { D, inv } form (a circular pipe with one invert for both ends). */
export function culvertOf(c) {
  const shape = c.shape === 'box' ? 'box' : 'circle', rise = c.rise ?? c.D, span = shape === 'box' ? (c.span ?? rise) : rise;
  const key = c.inlet && INLETS[c.inlet]?.shape === shape ? c.inlet : DEFAULT_INLET[shape], inlet = INLETS[key];
  const invUp = c.invUp ?? c.inv, invDn = c.invDn ?? c.inv ?? invUp;
  return { shape, rise, span, barrels: Math.max(1, Math.round(c.barrels ?? 1)), len: Math.max(c.len ?? 1, 0.1), invUp, invDn, n: c.n ?? 0.015, ke: c.Ke ?? c.ke ?? inlet.ke, inlet, inletKey: key };
}

/** Inlet-control discharge of one barrel for a headwater depth hw above the inlet invert (the inverse of inletHeadwater). */
function inletQ(cv, hw, S) {
  if (!(hw > 0)) return 0;
  const A = fullArea(cv.shape, cv.rise, cv.span);
  let lo = 0, hi = A * Math.sqrt(2 * G * (hw + cv.rise)) * 2 + 1e-6; // far above anything the entrance passes
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (inletHeadwater(cv.inlet, cv.shape, cv.rise, cv.span, m, S) < hw) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * Outlet-control discharge of one barrel for water levels up and dn (m, absolute).
 * Drowned (headwater above 1.2 × rise, or tailwater above the outlet crown): the full barrel, HDS-5 eq. 3.6,
 *   HW = h0 + H with H = (1 + ke + 2g·n²·L/R^4/3)·V²/2g and h0 = max(tailwater, (dc + rise)/2) above the outlet invert.
 * Otherwise the barrel runs part full: the same losses on the section at the mean of the two end depths, the tailwater
 * no lower than critical depth at the outlet.
 */
function outletQ(cv, up, dn) {
  const { shape, rise, span, len, n, ke } = cv, tw = Math.max(0, dn - cv.invDn);
  if (!(up - cv.invUp > 0)) return 0;
  const Af = fullArea(shape, rise, span), Rf = Af / section(shape, rise, span, rise).P;
  const solve = (lvl, full) => { // the discharge whose required headwater level is lvl
    const hu = lvl - cv.invUp;
    const head = (Q) => {
      const dc = criticalDepth(shape, rise, span, Q);
      if (full) { const h0 = Math.max(tw, (dc + rise) / 2), V = Q / Af; return cv.invDn + h0 + (1 + ke + 2 * G * n * n * len / Rf ** (4 / 3)) * V * V / (2 * G); }
      const yd = Math.min(rise, Math.max(tw, dc)), yu = Math.min(rise, Math.max(hu, yd)), sc = section(shape, rise, span, (yu + yd) / 2);
      if (!(sc.A > 0)) return Infinity;
      const R = sc.A / sc.P, V = Q / sc.A; return cv.invDn + yd + (1 + ke + 2 * G * n * n * len / R ** (4 / 3)) * V * V / (2 * G);
    };
    if (head(0) >= lvl) return 0;
    let lo = 0, hi = Af * Math.sqrt(2 * G * (hu + rise + Math.abs(cv.invUp - cv.invDn))) + 1e-6;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (head(m) < lvl) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  if (tw >= rise) return solve(up, true);
  const prime = cv.invUp + 1.2 * rise;
  if (up < prime) return solve(up, false);
  // just past priming the full-barrel equation gives a little less than the part-full barrel did (h0 steps up to
  // (dc + D)/2): the flow holds at its part-full value until the full barrel overtakes it, so it never falls as the
  // headwater rises
  return Math.max(solve(up, true), solve(prime, false));
}

/**
 * Flow through a culvert from level H1 (its `a` end) to H2 (its `b` end), m³/s, signed + from a to b, all barrels.
 * The smaller of inlet and outlet control; with the levels reversed the culvert runs backwards with its ends swapped.
 * Drop-in for the older src/river.js culvertFlow(H1, H2, { inv, D, len, n }).
 * @returns the flow; `culvertState` gives the governing control as well
 */
export function culvertFlow(H1, H2, c) { return culvertState(H1, H2, c).Q; }

/** → { Q (signed, all barrels), control: 'inlet' | 'outlet' | 'none', qInlet, qOutlet (per barrel, unsigned) } */
export function culvertState(H1, H2, c) {
  const base = c.rise !== undefined && c.inlet?.form ? c : culvertOf(c), fwd = H1 >= H2;
  const cv = fwd ? base : { ...base, invUp: base.invDn, invDn: base.invUp }, up = fwd ? H1 : H2, dn = fwd ? H2 : H1;
  if (!(up - cv.invUp > 0) || up - dn <= 0) return { Q: 0, control: 'none', qInlet: 0, qOutlet: 0 };
  const S = (cv.invUp - cv.invDn) / cv.len, qInlet = inletQ(cv, up - cv.invUp, S), qOutlet = outletQ(cv, up, dn);
  const q = Math.min(qInlet, qOutlet);
  return { Q: (fwd ? 1 : -1) * q * cv.barrels, control: q <= 0 ? 'none' : qInlet <= qOutlet ? 'inlet' : 'outlet', qInlet, qOutlet };
}
