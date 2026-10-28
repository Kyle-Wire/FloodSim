// Analytical solutions used for verification.

// Dam break (Stoker wet bed if hR > 0, Ritter dry bed if hR == 0).
// Returns h(x, t) for a dam at x0, initially at rest.
export function damBreak(hL, hR, x0, g = 9.81) {
  const cL = Math.sqrt(g * hL);
  let hm = 0, um = 0, S = 0;
  if (hR > 0) {
    const f = (h) => 2 * (cL - Math.sqrt(g * h)) - (h - hR) * Math.sqrt(g * (h + hR) / (2 * h * hR));
    let lo = hR, hi = hL;
    for (let k = 0; k < 200; k++) { const m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
    hm = 0.5 * (lo + hi); um = 2 * (cL - Math.sqrt(g * hm)); S = hm * um / (hm - hR);
  }
  return (x, t) => {
    if (t <= 0) return x < x0 ? hL : hR;
    const xi = (x - x0) / t;
    if (xi <= -cL) return hL;
    if (hR <= 0) {
      if (xi < 2 * cL) { const q = 2 * cL - xi; return q * q / (9 * g); }
      return 0;
    }
    const cm = Math.sqrt(g * hm);
    if (xi < um - cm) { const q = 2 * cL - xi; return q * q / (9 * g); }
    if (xi < S) return hm;
    return hR;
  };
}

// Thacker (1981) planar surface oscillating in a paraboloid (SWASHES 4.2.2).
export function thackerPlanar({ L = 4, a = 1, h0 = 0.1, eta = 0.5, g = 9.81 } = {}) {
  const w = Math.sqrt(2 * g * h0) / a;
  const bed = (x, y) => { const X = x - L / 2, Y = y - L / 2; return -h0 * (1 - (X * X + Y * Y) / (a * a)); };
  const depth = (x, y, t) => {
    const X = x - L / 2, Y = y - L / 2;
    const s = (eta * h0 / (a * a)) * (2 * X * Math.cos(w * t) + 2 * Y * Math.sin(w * t) - eta);
    return Math.max(0, s - bed(x, y));
  };
  const vel = (t) => [-eta * w * Math.sin(w * t), eta * w * Math.cos(w * t)];
  return { omega: w, period: 2 * Math.PI / w, bed, depth, vel, L };
}
