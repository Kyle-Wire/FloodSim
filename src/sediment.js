// Sediment transport inputs (the GPU kernels sedAdvect / sedSource do the transport). Per solver cell:
//   d50        median grain size by soil texture: sand-sized beds (≥ 0.0625 mm) also move as bedload (Meyer-Peter & Müller)
//   ws         settling velocity of that grain (Ferguson & Church 2004), at least 0.1 mm/s (clay settles as flocs)
//   erodible   loose material the flow can take: the topsoil depth you set (default 30 cm), on erodible
//              ground (paved, roofed and water: none; deposits on them become erodible as they arrive)
// Transport: suspended load carried with the water at the upstream concentration, entrained by excess shear
// (k_d = 0.2·τc^−½ cm³/(N·s), Hanson & Simon 2001), settling exactly over each step; bedload across faces; the bed (and
// so the flow) moves by the difference, with porosity 0.4. Limits: suspended solids at most 10 % by volume of the water,
// bedload at most half the water flux across a face (so it goes only where the water goes). Solids are conserved: suspended + (1 − porosity)·bed change
// + carried out of the domain = 0.

import { NOT_ERODIBLE, TAU_SOIL } from './scour.js';

/** Median grain size (m) by USDA texture (representative values; silts and clays as their dispersed size). */
export const D50 = {
  'sand': 0.35e-3, 'loamy sand': 0.2e-3, 'sandy loam': 0.12e-3, 'loam': 0.04e-3, 'silt loam': 0.025e-3, 'silt': 0.02e-3,
  'sandy clay loam': 0.08e-3, 'clay loam': 0.02e-3, 'silty clay loam': 0.012e-3, 'sandy clay': 0.05e-3, 'silty clay': 0.008e-3,
  'clay': 0.005e-3, 'compacted fill': 0.05e-3,
};
export const TEXTURES = Object.keys(D50);
const DEPOSIT_D50 = 0.03e-3; // loose deposits on paved ground

/** Settling velocity (m/s) of a natural grain of size d (m) in water (Ferguson & Church 2004), floor 0.1 mm/s. */
export function settling(d, { R = 1.65, nu = 1.0e-6, g = 9.81, C1 = 18, C2 = 1.0 } = {}) {
  return Math.max(1e-4, (R * g * d * d) / (C1 * nu + Math.sqrt(0.75 * C2 * R * g * d * d * d)));
}

/**
 * Per solver cell: d50, ws and the erodible depth, pervious-weighted over erodible pixels (f.texture: index into
 * TEXTURES per pixel; f.tauC; f.perv). perCellArea for the subgrid mode is not supported (the
 * transport needs the standard solver). Also the soil's own critical shear (by texture, under any vegetation) and its
 * skin roughness n = d50^⅙/21.1 (Strickler), floor 0.010, which the transport uses for the shear on the soil.
 * → { d50, ws, erodible, tauSoil, nSkin }
 */
export function sedimentCells(f, nx, ny, F, mask, { topsoil = 0.3 } = {}) {
  const N = nx * ny, d50 = new Float32Array(N), ws = new Float32Array(N), erodible = new Float32Array(N), tauSoil = new Float32Array(N), nSkin = new Float32Array(N), fnx = f.nx;
  for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    const C = J * nx + I; if (!mask[C]) continue;
    let w = 0, ld = 0, e = 0, open = 0, tc = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const q = j * fnx + i; if (f.bld[q]) continue; open++;
      if (!(f.tauC[q] < NOT_ERODIBLE)) continue;
      const p = f.perv[q], d = D50[TEXTURES[f.texture[q]]] ?? DEPOSIT_D50;
      w += p; ld += p * Math.log(d); e += p * topsoil; tc += p * (TAU_SOIL[TEXTURES[f.texture[q]]] ?? 2);
    }
    const dd = w > 0 ? Math.exp(ld / w) : DEPOSIT_D50; // geometric mean grain size of the erodible ground
    d50[C] = dd; ws[C] = settling(dd); erodible[C] = open ? e / open : 0;
    tauSoil[C] = w > 0 ? tc / w : 1; nSkin[C] = Math.max(0.010, Math.pow(dd, 1 / 6) / 21.1); // loose deposits on pavement: 1 Pa
  }
  return { d50, ws, erodible, tauSoil, nSkin };
}
