// Subgrid speed mode: the solver runs on F-metre cells, but every cell and face carries tables built from the 1 m DEM
// inside it, so storage, flow paths, curbs and buildings at 1 m still shape the flow (after SFINCS's subgrid approach,
// Leijnse et al. 2021; van Ormondt et al. 2025). The 1 m run stays the default; this is the opt-in fast mode.
//
//   cell table   water level ζ → stored volume per cell area v(ζ) = (1/F²)·Σ over open (non-building) pixels of
//                max(0, ζ − z_p). Buildings hold no water (porosity); a cell is a wall only when it is all building.
//   face table   ζ → flow depth H and conveyance K per unit width, over the region between the two cell centres. The
//                region is F parallel strips of F pixels along the flow: a strip is blocked by a building pixel or a
//                pixel above ζ (a curb); otherwise its control depth is its shallowest pixel and its conveyance the
//                series combination K_s = 1 / √(mean over pixels of n_p² / d_p^{10/3}). H and K are the strip means.
// The solver (kernels.wgsl.js, sg*) is local inertial: q ← (q − g·H·Δt·∂η/∂x) / (1 + g·Δt·|q|·H / K²), which is
// Manning flow at the subgrid conveyance in the uniform-flow limit. The state is volume, so mass is exact; the level is
// looked up from the cell table. Depth comes back at 1 m as max(0, η − z_p) per pixel.
//
// Tables hold NL levels evenly spaced between the lowest and highest pixel that matters, and extrapolate above: v and
// H rise with the open fraction, K^0.6 rises in proportion to H (exact for a flat bottom). K is tabulated as K^0.6,
// which is linear in depth over flat ground, so interpolation stays accurate in shallow sheet flow.

export const NL = 16;
export const CT = NL + 3;     // per cell: zmin, dz, open fraction, v_0 … v_{NL−1}
export const FT = 2 * NL + 3; // per face: zmin, dz, open strip fraction, H_0 … H_{NL−1}, K^0.6_0 … K^0.6_{NL−1}
const BLOCKED = 1e30;

/**
 * Subgrid model on the F-metre grid from the fine layers (buildFine: z, bld, manning, infil, road).
 * → { nx, ny, F, z (lowest open ground per cell), mask, phi (open fraction), infil (m/s per cell area), roadFrac,
 *     ct (nx·ny·CT), fx ((nx+1)·ny·FT: x-face i between cells i−1 and i of row j at (j·(nx+1) + i)),
 *     fy (nx·(ny+1)·FT: y-face between rows j−1 and j at (j·nx + i)) }, all elevations absolute.
 */
export function buildSubgrid(f, F, { conveyance = 'blend' } = {}) {
  const fnx = f.nx, fny = f.ny, nx = fnx / F, ny = fny / F;
  if (!Number.isInteger(nx) || !Number.isInteger(ny)) throw new Error('grid extent must be divisible by the subgrid cell size');
  const N = nx * ny, z = new Float64Array(N), mask = new Uint8Array(N), phi = new Float64Array(N), infil = new Float64Array(N), roadFrac = new Float64Array(N);
  const ct = new Float32Array(N * CT), fx = new Float32Array((nx + 1) * ny * FT), fy = new Float32Array(nx * (ny + 1) * FT);
  const n2 = new Float64Array(fnx * fny); for (let k = 0; k < n2.length; k++) n2[k] = (f.manning[k] || 0.03) ** 2;

  // ---- cells
  const zs = new Float64Array(F * F);
  for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    const K = J * nx + I; let m = 0, lo = Infinity, hi = -Infinity, inf = 0, road = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const k = j * fnx + i; if (f.road?.[k]) road++;
      if (f.bld[k]) continue;
      zs[m++] = f.z[k]; lo = Math.min(lo, f.z[k]); hi = Math.max(hi, f.z[k]); inf += f.infil[k];
    }
    const o = K * CT; roadFrac[K] = road / (F * F);
    if (!m) { z[K] = meanZ(f, I, J, F, fnx); ct[o] = BLOCKED; ct[o + 1] = 1; continue; } // all building: a wall cell
    mask[K] = 1; phi[K] = m / (F * F); z[K] = lo; infil[K] = inf / (F * F);
    const dz = hi - lo > 1e-3 ? (hi - lo) / (NL - 1) : 0.1;
    ct[o] = lo; ct[o + 1] = dz; ct[o + 2] = phi[K];
    for (let l = 0; l < NL; l++) {
      const zeta = lo + l * dz; let v = 0;
      for (let p = 0; p < m; p++) if (zeta > zs[p]) v += zeta - zs[p];
      ct[o + 3 + l] = v / (F * F);
    }
  }

  // ---- faces: strips of pixels along the flow, across the region between the two cell centres
  const h = Math.floor(F / 2);
  const face = (out, o, strips) => { // strips: array of arrays of fine indices (each in flow order)
    let lo = Infinity, hi = -Infinity, open = 0;
    const top = strips.map(s => { if (!s.length || s.some(k => f.bld[k])) return null; let t = -Infinity; for (const k of s) t = Math.max(t, f.z[k]); return t; });
    for (const t of top) if (t != null) { open++; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    if (!open) { out[o] = BLOCKED; out[o + 1] = 1; return; }
    const dz = hi - lo > 1e-3 ? (hi - lo) / (NL - 1) : 0.1;
    out[o] = lo; out[o + 1] = dz; out[o + 2] = open / strips.length;
    for (let l = 0; l < NL; l++) {
      const zeta = lo + l * dz; let H = 0, Kc = 0, Hp = 0, Kp = 0, np = 0;
      strips.forEach((s, si) => {
        if (top[si] != null) for (const k of s) { np++; const d = zeta - f.z[k]; if (d > 0) { Hp += d; Kp += d ** (5 / 3) / Math.sqrt(n2[k]); } } // every pixel in parallel
        if (top[si] == null || zeta <= top[si]) return;
        let dmin = Infinity, r = 0;
        for (const k of s) { const d = zeta - f.z[k]; dmin = Math.min(dmin, d); r += n2[k] / d ** (10 / 3); }
        H += dmin; Kc += 1 / Math.sqrt(r / s.length);
      });
      H /= strips.length; Kc /= strips.length;
      if (conveyance !== 'series') { // blend with the region's all-parallel conveyance (water routes around sub-cell bumps)
        const n = Math.max(1, np), Hpar = Hp / n, Kpar = Kp / n;
        if (conveyance === 'parallel') { H = Hpar; Kc = Kpar; } else { H = Math.sqrt(H * Hpar); Kc = Math.sqrt(Kc * Kpar); }
      }
      out[o + 3 + l] = H; out[o + 3 + NL + l] = Kc ** 0.6;
    }
  };
  for (let J = 0; J < ny; J++) for (let I = 0; I <= nx; I++) { // x-faces: strips are rows, pixels run along x
    const c0 = Math.max(0, (I - 1) * F + h), c1 = Math.min(fnx - 1, I * F + h - 1), strips = [];
    for (let j = J * F; j < (J + 1) * F; j++) { const s = []; for (let i = c0; i <= c1; i++) s.push(j * fnx + i); strips.push(s); }
    face(fx, (J * (nx + 1) + I) * FT, strips);
  }
  for (let J = 0; J <= ny; J++) for (let I = 0; I < nx; I++) { // y-faces: strips are columns, pixels run along y
    const r0 = Math.max(0, (J - 1) * F + h), r1 = Math.min(fny - 1, J * F + h - 1), strips = [];
    for (let i = I * F; i < (I + 1) * F; i++) { const s = []; for (let j = r0; j <= r1; j++) s.push(j * fnx + i); strips.push(s); }
    face(fy, (J * nx + I) * FT, strips);
  }
  return { nx, ny, F, z, mask, phi, infil, roadFrac, ct, fx, fy, subgrid: true };
}
const meanZ = (f, I, J, F, fnx) => { let s = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) s += f.z[j * fnx + i]; return s / (F * F); };

// ---- table lookups (the WGSL kernels mirror these)

/** Volume per cell area at level zeta. */
export function cellVolume(ct, o, zeta) {
  const lo = ct[o], dz = ct[o + 1]; if (lo >= BLOCKED || zeta <= lo) return 0;
  const x = (zeta - lo) / dz, l = Math.floor(x);
  if (l >= NL - 1) return ct[o + 3 + NL - 1] + ct[o + 2] * (zeta - lo - (NL - 1) * dz);
  return ct[o + 3 + l] + (x - l) * (ct[o + 4 + l] - ct[o + 3 + l]);
}
/** Level for volume per cell area v (inverse of cellVolume; the lowest ground when dry). */
export function cellLevel(ct, o, v) {
  const lo = ct[o], dz = ct[o + 1]; if (lo >= BLOCKED) return -Infinity; if (v <= 0) return lo;
  const vt = ct[o + 3 + NL - 1];
  if (v >= vt) return lo + (NL - 1) * dz + (v - vt) / Math.max(ct[o + 2], 1e-6);
  let a = 0, b = NL - 1; while (b - a > 1) { const m = (a + b) >> 1; if (ct[o + 3 + m] <= v) a = m; else b = m; }
  const va = ct[o + 3 + a], vb = ct[o + 3 + b];
  return lo + dz * (a + (vb > va ? (v - va) / (vb - va) : 0));
}
/** Flow depth H and conveyance K per unit width at level zeta. */
export function faceFlow(ft, o, zeta) {
  const lo = ft[o], dz = ft[o + 1]; if (lo >= BLOCKED || zeta <= lo) return { H: 0, K: 0 };
  const x = (zeta - lo) / dz, l = Math.floor(x);
  let H, Kp;
  if (l >= NL - 1) {
    const Ht = ft[o + 3 + NL - 1], Kt = ft[o + 3 + 2 * NL - 1]; H = Ht + ft[o + 2] * (zeta - lo - (NL - 1) * dz);
    Kp = Ht > 0 ? Kt * H / Ht : 0;
  } else {
    const t = x - l; H = ft[o + 3 + l] + t * (ft[o + 4 + l] - ft[o + 3 + l]); Kp = ft[o + 3 + NL + l] + t * (ft[o + 4 + NL + l] - ft[o + 3 + NL + l]);
  }
  return { H, K: Kp > 0 ? Kp ** (5 / 3) : 0 };
}

/** 1 m depth from per-cell water levels (absolute; −Infinity / NaN = dry): max(0, η − z_p) on open pixels. */
export function fineDepth(sg, eta, f, target) {
  const { nx, F } = sg, fnx = f.nx, out = target || new Float32Array(fnx * f.ny);
  for (let j = 0; j < f.ny; j++) for (let i = 0; i < fnx; i++) {
    const k = j * fnx + i, e = eta[((j / F) | 0) * nx + ((i / F) | 0)];
    out[k] = f.bld[k] || !(e > f.z[k]) ? 0 : e - f.z[k];
  }
  return out;
}
