// Sediment transport inputs (the GPU kernels sedAdvect / sedSource / slopeFail do the transport). Four grain classes:
//   clay     2 µm, settling as flocs at 0.1 mm/s
//   silt     30 µm
//   sand     the area's sand size (by texture, 0.15–0.35 mm)
//   gravel   8 mm, the survey's rock fragments (> 2 mm)
// Per solver cell: the erodible store of each class (the topsoil depth you set, default 30 cm, split by the soil's
// grain mix; paved, roofed and water: none, deposits on them become erodible as they arrive), the soil's critical
// shear and skin roughness, and for the debris-flow mode its strength (c′, φ′ with root cohesion by land cover), depth
// to bedrock and effective porosity.
// Transport: each class carried with the water at the upstream concentration and settling exactly over each step at its
// own velocity (Ferguson & Church 2004); entrainment by excess shear (k_d = 0.2·τc^−½ cm³/(N·s), Hanson & Simon 2001)
// takes the bed's classes in proportion, except those the flow cannot hold in suspension (u* < w_s), which stay behind
// (so a scoured bed coarsens); sand and gravel also move as bedload (Wilcock & Crowe 2003, with hiding between sizes);
// the bed (and so the flow) moves by the difference, with porosity 0.4. Limits: suspended solids at most 10 % by volume
// of the water (50 % in the debris-flow mode), bedload at most half the water flux across a face. Solids are conserved
// per class: suspended + (1 − porosity)·bed change + carried out of the domain = 0.

import { NOT_ERODIBLE, TAU_SOIL } from './scour.js';

/** Median grain size (m) by USDA texture (representative values; silts and clays as their dispersed size). */
export const D50 = {
  'sand': 0.35e-3, 'loamy sand': 0.2e-3, 'sandy loam': 0.12e-3, 'loam': 0.04e-3, 'silt loam': 0.025e-3, 'silt': 0.02e-3,
  'sandy clay loam': 0.08e-3, 'clay loam': 0.02e-3, 'silty clay loam': 0.012e-3, 'sandy clay': 0.05e-3, 'silty clay': 0.008e-3,
  'clay': 0.005e-3, 'compacted fill': 0.05e-3,
};
export const TEXTURES = Object.keys(D50);
/** Typical grain mix by texture (% clay, sand, gravel; silt the rest): the texture triangle's class centres. */
export const TEXTURE_GRAINS = {
  'sand': { clay: 3, sand: 92 }, 'loamy sand': { clay: 6, sand: 82 }, 'sandy loam': { clay: 10, sand: 65 }, 'loam': { clay: 18, sand: 42 },
  'silt loam': { clay: 15, sand: 20 }, 'silt': { clay: 5, sand: 7 }, 'sandy clay loam': { clay: 27, sand: 60 }, 'clay loam': { clay: 34, sand: 32 },
  'silty clay loam': { clay: 34, sand: 10 }, 'sandy clay': { clay: 42, sand: 52 }, 'silty clay': { clay: 47, sand: 6 }, 'clay': { clay: 60, sand: 20 },
  'compacted fill': { clay: 20, sand: 45, gravel: 15 },
};
/** Size of the sand fraction (m) by texture. */
const SAND_SIZE = { 'sand': 0.35e-3, 'loamy sand': 0.25e-3, 'sandy loam': 0.2e-3, 'compacted fill': 0.3e-3 };
export const CLASSES = [{ name: 'clay', d: 2e-6 }, { name: 'silt', d: 30e-6 }, { name: 'sand', d: null }, { name: 'gravel', d: 8e-3 }];
export const GRAVEL_D = 8e-3;
/** Drained strength by texture: c′ (kPa), φ′ (degrees); typical values (BSTEM defaults for sand, silt, clay; loams between). */
export const STRENGTH = {
  'sand': [0, 32], 'loamy sand': [0.5, 31], 'sandy loam': [2, 30], 'loam': [4, 28], 'silt loam': [3.5, 27], 'silt': [3, 27],
  'sandy clay loam': [5, 27], 'clay loam': [7, 25], 'silty clay loam': [6, 25], 'sandy clay': [8, 25], 'silty clay': [8, 23], 'clay': [10, 22],
  'compacted fill': [5, 30],
};
/** Root cohesion (kPa) by NLCD class over the top metre (Pollen & Simon 2005 ranges, mid values). */
export const ROOTS = { 21: 1.5, 41: 5, 42: 5, 43: 5, 52: 3, 71: 1.5, 81: 1.5, 82: 1, 90: 5, 95: 3 };
const DEPOSIT_D50 = 0.03e-3; // loose deposits on paved ground
const DEFAULT_SOIL_DEPTH = 1.5; // m, where the survey gives no bedrock depth

/** Settling velocity (m/s) of a natural grain of size d (m) in water (Ferguson & Church 2004), floor 0.1 mm/s. */
export function settling(d, { R = 1.65, nu = 1.0e-6, g = 9.81, C1 = 18, C2 = 1.0 } = {}) {
  return Math.max(1e-4, (R * g * d * d) / (C1 * nu + Math.sqrt(0.75 * C2 * R * g * d * d * d)));
}

/** Strength of a soil: c′ (Pa) and tan φ′, with gravel raising φ′ toward 36°. */
export function strength(texture, gravelPct = 0) {
  const [c, phi] = STRENGTH[texture] ?? STRENGTH['compacted fill'];
  return { c: c * 1000, tanPhi: Math.tan((phi + (36 - phi) * Math.min(1, gravelPct / 50)) * Math.PI / 180) };
}

/**
 * Per solver cell, pervious-weighted over erodible pixels (f.texture: index into TEXTURES; f.grains: % clay, silt, sand,
 * gravel per pixel; f.tauC; f.perv; f.cls NLCD; f.bedrock; f.ga.thetaE). The transport needs the standard solver.
 * debris: { z (cell beds), dx } — on slopes of 10° and more the whole soil to bedrock is erodible (debris flows scour
 * channels to rock), not just the topsoil.
 * → { erodible (4 per cell, m of bed per class), dSand, dGravel, d50, tauSoil, nSkin, cohesion (Pa), tanPhi, soilDepth (m), thetaE }
 */
export function sedimentCells(f, nx, ny, F, mask, { topsoil = 0.3, debris = null } = {}) {
  const N = nx * ny, fnx = f.nx, out = {
    erodible: new Float32Array(N * 4), dSand: new Float32Array(N), dGravel: new Float32Array(N).fill(GRAVEL_D), d50: new Float32Array(N),
    tauSoil: new Float32Array(N), nSkin: new Float32Array(N), cohesion: new Float32Array(N), tanPhi: new Float32Array(N), soilDepth: new Float32Array(N), thetaE: new Float32Array(N),
  };
  // one sand size for the area (geometric mean over its erodible ground), so the class settles alike everywhere
  let sw = 0, sl = 0;
  for (let q = 0; q < f.perv.length; q++) if (!f.bld[q] && f.tauC[q] < NOT_ERODIBLE && f.perv[q] > 0) { const t = TEXTURES[f.texture[q]]; sw += f.perv[q]; sl += f.perv[q] * Math.log(SAND_SIZE[t] ?? 0.15e-3); }
  const dSand = sw > 0 ? Math.exp(sl / sw) : 0.15e-3; out.dSand.fill(dSand);
  const sizes = [CLASSES[0].d, CLASSES[1].d, dSand, GRAVEL_D];
  for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    const C = J * nx + I; if (!mask[C]) continue;
    let w = 0, e = 0, open = 0, tc = 0, ld = 0, coh = 0, tp = 0, dep = 0, th = 0; const fr = [0, 0, 0, 0];
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const q = j * fnx + i; if (f.bld[q]) continue; open++;
      if (!(f.tauC[q] < NOT_ERODIBLE)) continue;
      const p = f.perv[q], t = TEXTURES[f.texture[q]], g = f.grains ? [f.grains[4 * q], f.grains[4 * q + 1], f.grains[4 * q + 2], f.grains[4 * q + 3]] : null;
      w += p; e += p * topsoil; tc += p * (TAU_SOIL[t] ?? 2);
      if (g) for (let m = 0; m < 4; m++) fr[m] += p * g[m] / 100; else ld += p * Math.log(D50[t] ?? DEPOSIT_D50);
      const s = strength(t, g ? g[3] : 0); coh += p * (s.c + 1000 * (ROOTS[f.cls?.[q]] ?? 0)); tp += p * s.tanPhi;
      dep += p * Math.min(3, Number.isFinite(f.bedrock?.[q]) ? Math.max(0.2, f.bedrock[q]) : DEFAULT_SOIL_DEPTH); th += p * (f.ga?.thetaE?.[q] ?? 0.4);
    }
    const sum = fr[0] + fr[1] + fr[2] + fr[3];
    if (w > 0 && sum <= 0) { const d = Math.exp(ld / w); fr[d >= 6.25e-5 ? 2 : d >= 4e-6 ? 1 : 0] = w; } // no grain data: all in the class of its d50
    const S = fr[0] + fr[1] + fr[2] + fr[3], share = S > 0 ? fr.map(v => v / S) : [0.2, 0.5, 0.3, 0]; // deposits on pavement: a silty mix
    let depth = open ? e / open : 0;
    out.soilDepth[C] = w > 0 ? dep / w : DEFAULT_SOIL_DEPTH; out.thetaE[C] = w > 0 ? th / w : 0.4;
    if (debris && depth > 0) { // the slope of the cell's bed (central differences)
      const zz = debris.z, dx = debris.dx, at = (a, b) => zz[Math.max(0, Math.min(ny - 1, b)) * nx + Math.max(0, Math.min(nx - 1, a))];
      const gx = (at(I + 1, J) - at(I - 1, J)) / (2 * dx), gy = (at(I, J + 1) - at(I, J - 1)) / (2 * dx);
      if (Math.hypot(gx, gy) >= Math.tan(10 * Math.PI / 180)) depth = Math.max(depth, out.soilDepth[C] * (w / Math.max(1, open)));
    }
    for (let m = 0; m < 4; m++) out.erodible[4 * C + m] = depth * share[m];
    out.d50[C] = Math.exp(share.reduce((a, v, m) => a + v * Math.log(sizes[m]), 0)); // geometric mean size of the bed
    out.tauSoil[C] = w > 0 ? tc / w : 1; out.nSkin[C] = Math.max(0.010, Math.pow(out.d50[C], 1 / 6) / 21.1); // loose deposits on pavement: 1 Pa
    out.cohesion[C] = w > 0 ? coh / w : 2000; out.tanPhi[C] = w > 0 ? tp / w : Math.tan(30 * Math.PI / 180);
  }
  return out;
}

/** Geometric mean grain size (m) of a bed store (4 classes, m), or 0 when empty. */
export function bedSize(e, dSand, dGravel = GRAVEL_D) {
  const s = e[0] + e[1] + e[2] + e[3]; if (s <= 0) return 0;
  const d = [CLASSES[0].d, CLASSES[1].d, dSand, dGravel];
  return Math.exp(e.reduce((a, v, m) => a + (v / s) * Math.log(d[m]), 0));
}
