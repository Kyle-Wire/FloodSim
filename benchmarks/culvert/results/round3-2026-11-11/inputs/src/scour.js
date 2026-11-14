// Scour potential: which ground the flow can erode, and how readily. Every solver step tracks the bed shear stress
// τ = ρg·n²·v²/h^⅓ per cell (kernels hzRecord, hazard.js), its excess over the ground's critical shear τc, and an
// indicative erosion depth from the excess-shear law ε = k_d·(τ − τc), k_d = 0.2·τc^−½ cm³/(N·s) (Hanson & Simon 2001).
// It is a potential: no sediment supply limit, no deposition, no bed change feeding back into the flow.
//
// Critical shear by surface (planning values; FHWA HEC-15 permissible shear for vegetated and bare linings):
//   paved, roofed, water        not erodible
//   grass and other vegetation  30 Pa (≈ 0.6 lb/ft², HEC-15 class D grass)
//   bare or cropped soil        by texture, 1 Pa (sand) to 10 Pa (clay)
// A solver cell takes the pervious-weighted critical shear of its erodible ground (paved cells are not erodible).

export const NOT_ERODIBLE = 1e9;
export const TAU_GRASS = 30;
export const TAU_SOIL = {
  'sand': 1.0, 'loamy sand': 1.2, 'sandy loam': 1.5, 'loam': 2.0, 'silt loam': 2.0, 'silt': 1.5, 'sandy clay loam': 3.0,
  'clay loam': 5.0, 'silty clay loam': 5.0, 'sandy clay': 6.0, 'silty clay': 8.0, 'clay': 10.0, 'compacted fill': 4.0,
};
const BARE = new Set([0, 31, 82]); // unknown, barren, cultivated crops (NLCD)
export const SCOUR_CLASSES = [
  { label: 'None', text: 'Below the critical shear', color: [200, 225, 205] },
  { label: 'Low', text: 'Up to 2× the critical shear', color: [250, 215, 120] },
  { label: 'Moderate', text: '2–5× the critical shear', color: [235, 140, 60] },
  { label: 'High', text: 'Over 5× the critical shear', color: [170, 40, 40] },
];
/** Class 0–3 from peak shear over critical shear (paved ground: −1, not erodible). */
export const scourClass = (shear, tauC) => (!(tauC < NOT_ERODIBLE) ? -1 : shear <= tauC ? 0 : shear <= 2 * tauC ? 1 : shear <= 5 * tauC ? 2 : 3);

/** Critical shear (Pa) of one fine pixel: pervious share, NLCD class, soil texture. */
export const tauFor = (perv, cls, texture) => (!(perv > 0.2) ? NOT_ERODIBLE : BARE.has(cls ?? 0) ? TAU_SOIL[texture] ?? 2 : TAU_GRASS);

/**
 * Per solver cell: critical shear (pervious-weighted over its erodible pixels, else not erodible) and Manning n for the
 * shear (the cell's, or the open-pixel mean when `n` is not given, as in the subgrid mode). → { tauC, n }
 */
export function scourCells(f, nx, ny, F, mask, n = null) {
  const N = nx * ny, tauC = new Float32Array(N).fill(NOT_ERODIBLE), nn = new Float32Array(N), fnx = f.nx;
  for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    const C = J * nx + I; if (!mask[C]) continue;
    let w = 0, s = 0, open = 0, ns = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const q = j * fnx + i; if (f.bld[q]) continue; open++; ns += f.manning[q];
      if (f.tauC[q] < NOT_ERODIBLE) { w += f.perv[q]; s += f.perv[q] * f.tauC[q]; }
    }
    if (open && w / open >= 0.2) tauC[C] = s / w; // at least a fifth of the open ground erodible
    nn[C] = n ? n[C] : open ? ns / open : 0.03;
  }
  return { tauC, n: nn };
}
