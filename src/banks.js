// Bank collapse probability along rivers, streams and lakes (the GPU kernel bankFS evaluates it every step).
// Each land cell within 20 m of open water whose ground stands at least 0.5 m over the nearest water cell (its toe) at a
// slope of 10° or more is a possible bank top; the bank is the slope from the toe up to it. Planar failure through the
// toe (Culmann wedge), searched over 8 plane angles from 0.2β to 0.99β:
//   FS = [c′·Lp + (W·cos α − U + Pw·cos(β − α))·tan φ′] / [W·sin α − Pw·sin(β − α)]
//   W   wedge weight ½H²(cot α − cot β)·γ (saturated unit weight below the bank's water table)
//   U   pore water force on the plane, ½γw·hp²/sin α, hp = bank water table over the toe
//   Pw  the channel water against the face, ½γw·hw²/sin β (confining; it falls away when the river drops)
// The bank's water table follows the river (and water standing on the bank top) with a lag T = θe·L/K (Darcy travel
// time through the bank), so a quick fall after a long high stage leaves the bank saturated and unconfined: rapid
// drawdown. The toe is the water cell's current bed, so toe scour from the sediment transport raises H.
// Probability of failure during the flood, given the bank stands before it: c′ and tan φ′ are uncertain (normal,
// coefficients of variation 0.4 and 0.1), but whatever they are they hold the bank up at the start, with the river at
// its starting level. FS is linear in both, so per plane P(FS < 1 now and FS₀ ≥ 1 at the start) is an integral over
// tan φ′ (10-point Gauss–Hermite) of a difference of normal CDFs in c′; divided by P(FS₀ ≥ 1); the worst plane counts.
// A bank that would stand only on strength the survey lacks (P(FS₀ ≥ 1) < 2 %: rock, cementation) is flagged, not
// rated; so is a bank more than twice as high as the soil is deep (rock-controlled).
// Bank tops without bathymetry: the toe is the lidar water surface, so a submerged bank below it is not counted.
import { strength, ROOTS, TEXTURES } from './sediment.js';

export const COV_C = 0.4, COV_TANPHI = 0.1;
const GW = 9810, GAM = 18e3, GSAT = 20e3, NALPHA = 8;
/** 10-point Gauss–Hermite nodes and weights (positive half; ∫e^(−x²)f(x)dx ≈ Σ w·f(±x)). */
export const GH_X = [0.3429013272, 1.0366108298, 1.7566836493, 2.5327316742, 3.4361591188];
export const GH_W = [0.6108626337, 0.2401386111, 0.0338743945, 0.0013436457, 0.0000076404];
/** A bank that cannot be rated: it stands only on strength the survey lacks. */
export const UNRATED = -1;
export const BANK_CLASSES = [
  { name: 'Unlikely (< 5 %)', max: 0.05, color: [255, 255, 178] },
  { name: 'Possible (5–25 %)', max: 0.25, color: [254, 204, 92] },
  { name: 'Likely (25–60 %)', max: 0.6, color: [253, 141, 60] },
  { name: 'Very likely (> 60 %)', max: 1.01, color: [189, 0, 38] },
];
export const bankClass = (p) => BANK_CLASSES.findIndex(c => p < c.max);

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Forces on the plane at angle a: FS = (c·Lp + N·tan φ′)/D (D ≤ 0: the plane cannot slide). */
export function plane(H, beta, a, hp, hw) {
  const sa = Math.sin(a), ca = Math.cos(a);
  const W = 0.5 * H * H * (1 / Math.tan(a) - 1 / Math.tan(beta)) * (GAM + (GSAT - GAM) * (hp / H) ** 2);
  const U = 0.5 * GW * hp * hp / sa, Pw = 0.5 * GW * hw * hw / Math.sin(beta);
  return { Lp: H / sa, N: Math.max(0, W * ca - U + Pw * Math.cos(beta - a)), D: W * sa - Pw * Math.sin(beta - a) };
}

/**
 * Factor of safety and probability of failure of a bank of height H (m) and horizontal run L (m), cohesion c (Pa),
 * tan φ′, with the bank water table hp (m over the toe) and channel water hw (m over the toe). With `start`
 * ({ hp, hw } at the start) the probability is conditional on the bank standing then (pf = UNRATED when it would
 * stand only on strength the survey lacks); without it, unconditional. → { fs, pf, alpha, stand }
 */
export function bankFS(H, L, c, tanPhi, hp, hw, start = null) {
  const beta = Math.atan2(H, L), cl = (v) => Math.min(Math.max(v, 0), H);
  hp = cl(hp); hw = cl(hw);
  const sc = Math.max(1, COV_C * c), st = COV_TANPHI * tanPhi;
  let best = { fs: Infinity, pf: 0, alpha: 0, stand: 1 }, standMin = 1;
  for (let m = 0; m < NALPHA; m++) {
    const a = beta * (0.2 + 0.79 * m / (NALPHA - 1)); // up to 0.99 β: a cohesionless bank fails along its face
    const p = plane(H, beta, a, hp, hw); if (p.D <= 0) continue;
    const fs = (c * p.Lp + p.N * tanPhi) / p.D;
    let pf, stand = 1;
    if (!start) { const sd = Math.hypot(COV_C * c * p.Lp, st * p.N) / p.D; pf = sd > 0 ? normCdf(-(fs - 1) / sd) : fs < 1 ? 1 : 0; }
    else {
      const q = plane(H, beta, a, cl(start.hp), cl(start.hw));
      if (q.D > 0) { const sd0 = Math.hypot(COV_C * c * q.Lp, st * q.N) / q.D; stand = sd0 > 0 ? normCdf(((c * q.Lp + q.N * tanPhi) / q.D - 1) / sd0) : 1; }
      let joint = 0; // ∫ over tan φ′ of P(c′ < c₁(t)) − P(c′ < c₀(t)), clipped at 0
      for (let g = 0; g < 10; g++) {
        const x = (g < 5 ? 1 : -1) * GH_X[g % 5], w = GH_W[g % 5] / Math.sqrt(Math.PI), t = tanPhi + Math.SQRT2 * st * x;
        const p1 = normCdf(((p.D - p.N * t) / p.Lp - c) / sc), p0 = q.D > 0 ? normCdf(((q.D - q.N * t) / q.Lp - c) / sc) : 0;
        joint += w * Math.max(0, p1 - p0);
      }
      standMin = Math.min(standMin, stand);
      pf = stand > 0.02 ? Math.min(1, joint / stand) : 0;
    }
    if (pf > best.pf || (pf === best.pf && fs < best.fs)) best = { fs, pf, alpha: a, stand };
  }
  if (start && standMin <= 0.02) best.pf = UNRATED; // it must stand on every plane
  return best;
}

/**
 * Possible bank tops on a solver grid c (nx, ny, z, mask) of F-metre cells, next to water cells `water`, with the soil
 * per fine pixel (f.texture, f.grains, f.cls, f.ga.K/thetaE/depth). Strength is the soil's c′ and φ′ plus root cohesion
 * over the top metre (shared out over the bank height). Banks over twice as high as the soil is deep (f.bedrock) are
 * left out as rock-controlled. → { banks: [{ top, toe, L, H, c, tanPhi, T, wt }], count, rock (left out) }
 */
export function findBanks(c, F, f, water, { reach = 20, minH = 0.5, minSlope = Math.tan(10 * Math.PI / 180) } = {}) {
  const { nx, ny, z, mask } = c, N = nx * ny, R = Math.max(1, Math.round(reach / F));
  const toe = new Int32Array(N).fill(-1), dist = new Float32Array(N).fill(Infinity);
  let front = []; for (let k = 0; k < N; k++) if (water[k]) { toe[k] = k; dist[k] = 0; front.push(k); }
  for (let r = 0; r < R && front.length; r++) { // nearest water cell, ring by ring
    const nf = [];
    for (const k of front) { const i = k % nx, j = (k / nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const p = b * nx + a, t = toe[k], d = Math.hypot(a - (t % nx), b - ((t / nx) | 0)) * F;
        if (!mask[p] || water[p] || d >= dist[p] || d > reach) continue;
        dist[p] = d; toe[p] = t; nf.push(p);
      } }
    front = nf;
  }
  const soil = (I, J) => { // the cell's soil, pervious-weighted over its pixels
    let w = 0, cc = 0, tp = 0, K = 0, th = 0, wt = 0, nw = 0, rk = 0, nr = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const q = j * f.nx + i; if (f.bld?.[q]) continue;
      const t = TEXTURES[f.texture[q]], s = strength(t, f.grains ? f.grains[4 * q + 3] : 0);
      w++; cc += s.c; tp += s.tanPhi; K += f.ga?.K?.[q] ?? 1e-6; th += f.ga?.thetaE?.[q] ?? 0.4;
      const d = f.ga?.depth?.[q]; if (Number.isFinite(d)) { wt += d; nw++; }
      if (Number.isFinite(f.bedrock?.[q])) { rk += f.bedrock[q]; nr++; }
    }
    if (!w) return null;
    let root = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) root += 1000 * (ROOTS[f.cls?.[j * f.nx + i]] ?? 0);
    return { c: cc / w, root: root / (F * F), tanPhi: tp / w, K: K / w, thetaE: th / w, wt: nw ? wt / nw : null, rock: nr ? rk / nr : null };
  };
  const banks = []; let rock = 0;
  for (let k = 0; k < N; k++) {
    if (toe[k] < 0 || water[k] || !mask[k]) continue;
    const t = toe[k], H = z[k] - z[t], L = Math.max(F / 2, dist[k]);
    if (H < minH || H / L < minSlope) continue;
    const s = soil(k % nx, (k / nx) | 0); if (!s) continue;
    if (s.rock != null && H > 2 * s.rock) { rock++; continue; } // rock-controlled: the soil is a thin cover
    const cEff = s.c + s.root * Math.min(1, 1 / H); // root cohesion over the top metre, averaged over the failure plane
    banks.push({ top: k, toe: t, L, H, c: cEff, tanPhi: s.tanPhi, T: Math.max(600, s.thetaE * L / Math.max(1e-9, s.K)), wt: s.wt });
  }
  return { banks, count: banks.length, rock };
}
