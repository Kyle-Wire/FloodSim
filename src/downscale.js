// Depth downscaling: solver grid (F·dx) → DEM grid (dx) by projecting the water surface onto the fine terrain.
//
// The water surface elevation (WSE = z + h) varies far more smoothly than depth, so it can be interpolated across
// wet solver cells and intersected with the 1 m DEM: d_fine = max(0, WSE_interp − z_fine). This is the standard
// WSE-projection downscaling (as in LISFLOOD-FP / FwDET post-processing). It is exact for still water and a
// good approximation where the surface slope is gentle; it cannot create flow paths the solver grid did not resolve,
// which is why simulating at the DEM resolution (F = 1) is preferred when the GPU can hold it.
//
// Fine cells only take water from wet solver cells within one cell (no spreading into unconnected dry areas).

/**
 * @param c  coarse {nx, ny, z, mask}, plus h (Float32Array/Float64Array, nx·ny) — or `out` interleaved [h, s, h, s, …] with stride 2
 * @param f  fine {nx, ny, z, bld}
 * @param F  integer factor
 * @param hmin wet threshold on the coarse grid (m)
 * @param target optional Float32Array(fine N) to write into
 */
export function downscaleDepth(c, h, stride, f, F, hmin = 0.005, target) {
  const cnx = c.nx, cny = c.ny, fnx = f.nx, fny = f.ny;
  const out = target || new Float32Array(fnx * fny);
  // coarse WSE, NaN where dry or wall
  const wse = new Float32Array(cnx * cny);
  for (let k = 0; k < cnx * cny; k++) { const d = h[k * stride]; wse[k] = c.mask[k] && d > hmin ? c.z[k] + d : NaN; }
  const inv = 1 / F;
  for (let j = 0; j < fny; j++) {
    const yc = (j + 0.5) * inv - 0.5, J0 = Math.floor(yc), ty = yc - J0;
    for (let i = 0; i < fnx; i++) {
      const k = j * fnx + i;
      if (f.bld[k]) { out[k] = 0; continue; }
      const xc = (i + 0.5) * inv - 0.5, I0 = Math.floor(xc), tx = xc - I0;
      let s = 0, wsum = 0;
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const I = Math.min(cnx - 1, Math.max(0, I0 + a)), J = Math.min(cny - 1, Math.max(0, J0 + b));
        const v = wse[J * cnx + I]; if (v !== v) continue;
        const w = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) + 1e-6; s += w * v; wsum += w;
      }
      if (!wsum) { // stencil all dry: a low spot at the edge of a wet cell still takes its neighbours' surface
        const Ic = Math.min(cnx - 1, (i / F) | 0), Jc = Math.min(cny - 1, (j / F) | 0);
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          const I = Ic + a, J = Jc + b; if (I < 0 || J < 0 || I >= cnx || J >= cny) continue;
          const v = wse[J * cnx + I]; if (v === v) { s += v; wsum += 1; }
        }
      }
      out[k] = wsum > 0 ? Math.max(0, s / wsum - f.z[k]) : 0;
    }
  }
  return out;
}

/** Fine-grid wet volume vs. solver volume (diagnostic shown with every downscaled map). */
export function volumeRatio(fineDepth, fdx, coarseH, stride, cdx, mask) {
  let vf = 0, vc = 0;
  for (let k = 0; k < fineDepth.length; k++) vf += fineDepth[k];
  for (let k = 0; k < mask.length; k++) if (mask[k]) vc += coarseH[k * stride];
  vf *= fdx * fdx; vc *= cdx * cdx;
  return vc > 0 ? vf / vc : 1;
}
