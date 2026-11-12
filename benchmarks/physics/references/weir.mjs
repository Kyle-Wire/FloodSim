// Weir and orifice exchange (Stage 4 coupling references; built now, first used in benchmark N).
//   Rectangular sharp-crested weir, free: Q = Cd (2/3) √(2g) b H^(3/2)   (Henderson 1966 §6.2)
//   Orifice, submerged or free: Q = Cd A √(2g Δh)
// Cross-check (self-test): the weir law is the orifice law integrated over horizontal strips of the nappe,
//   ∫0^H Cd b √(2g (H − z)) dz = Cd (2/3) b √(2g) H^(3/2).
import { G } from './manning.mjs';

export const weirQ = (Cd, b, H) => (H > 0 ? Cd * (2 / 3) * Math.sqrt(2 * G) * b * H ** 1.5 : 0);
export const orificeQ = (Cd, A, dh) => Math.sign(dh) * Cd * A * Math.sqrt(2 * G * Math.abs(dh));
/** The weir flow as the sum of orifice strips (midpoint rule, n strips): the self-test's independent route. */
export function weirByStrips(Cd, b, H, n = 100000) {
  let q = 0; const dz = H / n;
  for (let i = 0; i < n; i++) q += orificeQ(Cd, b * dz, H - (i + 0.5) * dz);
  return q;
}
