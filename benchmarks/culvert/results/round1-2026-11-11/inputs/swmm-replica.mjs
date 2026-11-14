// A diagnostic, not an independent answer: SWMM 5.2.4's culvert.c inlet equation transcribed into JS (US units, its
// 0.95 D unsubmerged limit, its slope factor scf and its linear transition), on exact section geometry. B1 uses it to
// ask one question: at the headwater SWMM reports, does SWMM's own equation give the discharge SWMM passes? If yes,
// a difference from HDS-5 lies in the equation's terms; if no, SWMM evaluated its equation at a head other than the
// pool's (dwflow.c passes h1 after findSurfArea may reset it to the conduit's critical or normal depth).
import { geom, fullArea } from './hds5.mjs';
const FT = 0.3048, g = 32.2;
const P = { 1: [1, 0.0098, 2, 0.0398, 0.67], 5: [1, 0.021, 1.33, 0.0463, 0.75], 6: [1, 0.034, 1.5, 0.0553, 0.54], 10: [1, 0.061, 0.75, 0.04, 0.8], 30: [1, 0.01, 2, 0.0398, 0.67] };
export function swmmInletQ(code, shape, rise, span, hM, S) {
  const D = rise / FT, A = fullArea(shape, rise, span) / FT ** 2, ad = A * Math.sqrt(D), [, K, M, C, Y] = P[code];
  const scf = code === 5 ? -7 * S : 0.5 * S, h = hM / FT, y2 = D * (16 * C + Y - scf);
  const unsub = (hh) => { const hPlus = hh / D + scf; let lo = 0.01 * hh, hi = hh, qc = 0;
    const f = (yc) => { const { A: ac, T } = geom(shape, rise, span, yc * FT); const a = ac / FT ** 2, w = T / FT, yh = a / w; qc = a * Math.sqrt(g * yh); return hPlus - yc / D - yh / 2 / D - K * (qc / ad) ** M; };
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; } f((lo + hi) / 2); return qc; };
  const sub = (hh) => Math.sqrt(Math.max(0, (hh / D - Y + scf) / C)) * ad;
  let q; if (h >= y2) q = sub(h); else if (h <= 0.95 * D) q = unsub(h); else { const q1 = unsub(0.95 * D), q2 = sub(y2); q = q1 + (q2 - q1) * (h - 0.95 * D) / (y2 - 0.95 * D); }
  return q * FT ** 3;
}
