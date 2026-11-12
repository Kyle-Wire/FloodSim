// Pressurised pipe friction, Darcy–Weisbach: h_f = f (L/D) V² / (2g). Friction factor two independent ways:
//   Colebrook–White (1939), 1/√f = −2 log10(ε/(3.7 D) + 2.51/(Re √f)), by fixed-point iteration;
//   Swamee–Jain (1976), f = 0.25 / [log10(ε/(3.7 D) + 5.74/Re^0.9)]², explicit (stated accuracy ±1 % of Colebrook
//   for 1e-6 ≤ ε/D ≤ 1e-2, 5e3 ≤ Re ≤ 1e8).
// The Manning ↔ roughness-height equivalence is a MODEL ASSUMPTION, stated here and in the spec, not a physical law:
//   Strickler: n = k_s^(1/6) / (8.1 √g), so k_s = (8.1 √g n)^6 (fully rough flow; coefficient 8.1, Henderson 1966 §4.4).
import { G } from './manning.mjs';

export const NU_20C = 1.004e-6; // kinematic viscosity of water at 20 °C (m²/s)
export function colebrook(eps, D, Re, { tol = 1e-14 } = {}) {
  let x = 0.02 ** -0.5; // x = 1/√f
  for (let k = 0; k < 200; k++) { const nx = -2 * Math.log10(eps / (3.7 * D) + 2.51 * x / Re); if (Math.abs(nx - x) < tol) { x = nx; break; } x = nx; }
  return 1 / (x * x);
}
export const swameeJain = (eps, D, Re) => 0.25 / Math.log10(eps / (3.7 * D) + 5.74 / Re ** 0.9) ** 2;
export const ksFromManning = (n) => (8.1 * Math.sqrt(G) * n) ** 6;
/** Darcy–Weisbach friction loss (m) for Q in a full circular pipe of diameter D, length L, roughness height eps. */
export function dwLoss(D, Q, L, eps, { nu = NU_20C, method = 'colebrook' } = {}) {
  const A = Math.PI * D * D / 4, V = Q / A, Re = V * D / nu, f = method === 'colebrook' ? colebrook(eps, D, Re) : swameeJain(eps, D, Re);
  return { hf: f * (L / D) * V * V / (2 * G), f, Re, V };
}
