// Street sandbox references (PV-SS1 … PV-SS9): hand answers for rain on streets, hollows, one inlet on one pipe, a
// sewer checked by its hydraulic grade line, and the wall-exposure rule. Nothing here imports src/ or anything outside
// references/. Every function has a second route in refs.test.mjs.
//
//   Kinematic wave on a plane (Henderson 1966 §9.6; Woolhiser & Liggett 1967): h_t + (α h^m)_x = i, α = √S0 / n,
//     m = 5/3. Steady depth h(x) = (i x / α)^(1/m); time of concentration t_c = h(L) / i; rising outflow
//     q(L, t) = α (i t)^m for t ≤ t_c. Valid where the kinematic wave number k = S0 L / (h_L Fr²) > 20.
//   Stage–storage: the level a volume V stands at over a set of cells, Σ max(0, η − z_k) A = V (still water).
//   Critical flow over a rim (broad crest, no friction): q = √g y_c^(3/2), upstream head H = 1.5 y_c.
//   One inlet on one full pipe to a held outlet level: pipe h_f = L (Q / K)², K = A R^(2/3) / n (Manning, full);
//     inlet orifice Δh = (Q / (Co A))² / 2g; free inlet Q = min(weir Cw P h^1.5 √2g, orifice Co A √(2g h)).
//   Hydraulic grade line of a sewer tree (FHWA HEC-22 ch. 7, friction only): from the outlet upstream,
//     HGL_up = max(HGL_down + L (Q / K)², invert_up + normal depth); a node floods where HGL > ground.
//   Wall exposure: water counts against a building where it is ≥ minDepth deep on an open cell within `reach` m of
//     the footprint and its 4-connected wet patch touches a street cell or covers ≥ minArea m².
import { G, normalDepthBisect } from './manning.mjs';
import { area as xsArea, perimeter as xsPerimeter } from './geometry.mjs';

// ---------------------------------------------------------------- kinematic wave
const M = 5 / 3;
export const kwAlpha = (n, S0) => Math.sqrt(S0) / n;
/** Steady depth (m) a distance x (m) below the divide under rain i (m/s). */
export const kwDepth = (i, x, n, S0) => Math.pow(i * x / kwAlpha(n, S0), 1 / M);
/** Time of concentration (s) of a plane of length L. */
export const kwTc = (i, L, n, S0) => kwDepth(i, L, n, S0) / i;
/** Outflow at the foot as a share of the steady outflow i·L, at time t after the rain starts (rising limb). */
export const kwRise = (t, tc) => Math.min(1, Math.pow(t / tc, M));
/** Time (s) at which the outflow reaches the share f of steady. */
export const kwTimeTo = (f, tc) => tc * Math.pow(f, 1 / M);
/** Water on the plane at steady state, per metre of width (m²): ∫0^L h dx = (m / (m + 1)) h_L L. */
export const kwStorage = (i, L, n, S0) => (M / (M + 1)) * kwDepth(i, L, n, S0) * L;
/** Kinematic wave number k = S0 L / (h_L Fr²) at the foot (the approximation holds for k > 20). */
export function kwNumber(i, L, n, S0) { const h = kwDepth(i, L, n, S0), u = i * L / h; return S0 * L / (h * (u * u / (G * h))); }
/** Self-test twin: the kinematic wave by an explicit upwind scheme. → { depth(x), t50, t90 } */
export function kwNumeric(i, L, n, S0, { nx = 400, tEnd = null } = {}) {
  const a = kwAlpha(n, S0), dx = L / nx, h = new Float64Array(nx), tc = kwTc(i, L, n, S0), T = tEnd ?? 2.5 * tc;
  let t = 0, t50 = null, t90 = null; const qs = i * L;
  while (t < T) {
    let c = 1e-9; for (let k = 0; k < nx; k++) c = Math.max(c, a * M * Math.pow(h[k], M - 1));
    const dt = Math.min(0.4 * dx / c, 0.25, T - t); let qin = 0;
    for (let k = 0; k < nx; k++) { const q = a * Math.pow(h[k], M); h[k] += dt * (i - (q - qin) / dx); qin = q; }
    t += dt; const f = a * Math.pow(h[nx - 1], M) / qs;
    if (t50 == null && f >= 0.5) t50 = t; if (t90 == null && f >= 0.9) t90 = t;
  }
  return { depth: (x) => h[Math.min(nx - 1, Math.floor(x / dx))], t50, t90 };
}

// ---------------------------------------------------------------- still water on a terrain
/** Volume (m³) below level eta over cells of bed z (array) and plan area A (m², one number). */
export function volumeBelow(z, A, eta) { let v = 0; for (let k = 0; k < z.length; k++) if (eta > z[k]) v += eta - z[k]; return v * A; }
/** The level a volume V stands at over the cells (bisection). */
export function levelForVolume(z, A, V) {
  let lo = Infinity, hi = -Infinity; for (const v of z) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(V > 0)) return lo; hi += V / (A * z.length) + 1;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (volumeBelow(z, A, m) < V) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Self-test twin: the same level from the sorted beds (the storage curve is piecewise linear between them). */
export function levelForVolumeSorted(z, A, V) {
  const s = Float64Array.from(z).sort(); let v = 0;
  for (let k = 0; k < s.length; k++) {
    const next = k + 1 < s.length ? s[k + 1] : Infinity, dv = (next - s[k]) * (k + 1) * A;
    if (v + dv >= V) return s[k] + (V - v) / ((k + 1) * A);
    v += dv;
  }
  return NaN;
}
/** Block mean of a fine grid (nx × ny, row-major) over F × F cells, open cells only (bld = 1 is left out): the bed a
 *  coarser grid of the same terrain has. A block more than half building is a wall (NaN). */
export function blockMean(z, nx, ny, F, bld = null) {
  const cnx = nx / F, cny = ny / F, out = new Float64Array(cnx * cny);
  for (let J = 0; J < cny; J++) for (let I = 0; I < cnx; I++) {
    let s = 0, m = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) if (!bld?.[j * nx + i]) { s += z[j * nx + i]; m++; }
    out[J * cnx + I] = m * 2 > F * F ? s / m : NaN;
  }
  return out;
}
/** Cells reachable from `seed` (4-connected) without crossing a NaN (wall) cell or a bed above `eta`: the pond a
 *  level makes around a point. → indices */
export function pondCells(z, nx, ny, seed, eta) {
  const seen = new Uint8Array(z.length), out = [], st = [seed]; seen[seed] = 1;
  while (st.length) {
    const k = st.pop(); out.push(k); const i = k % nx, j = (k - i) / nx;
    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; if (!seen[q] && z[q] === z[q] && z[q] < eta) { seen[q] = 1; st.push(q); } }
  }
  return out;
}

// ---------------------------------------------------------------- flow over a rim
/** Critical depth (m) of a unit discharge q (m²/s) and the head upstream of a frictionless broad crest. */
export const criticalDepthUnit = (q) => Math.cbrt(q * q / G);
export const rimHead = (q) => 1.5 * criticalDepthUnit(q);

// ---------------------------------------------------------------- one inlet on one pipe
/** Full-pipe conveyance K (m³/s per √slope) of a circular pipe. */
export const pipeK = (D, n) => { const s = { shape: 'circle', D }, A = xsArea(s, D), P = xsPerimeter(s, D); return A * Math.pow(A / P, 2 / 3) / n; };
/** Free inflow of a grate (m³/s) under a depth h over it: the smaller of weir and orifice. */
export const inletFree = (h, { Cw, P, Co, A }) => (h > 0 ? Math.min(Cw * P * Math.pow(h, 1.5) * Math.sqrt(2 * G), Co * A * Math.sqrt(2 * G * h)) : 0);
/** Flow (m³/s, + out of the street) between a street level eta and a held outlet level through a submerged inlet
 *  (orifice) and a full pipe; negative when the outlet stands above the street and water comes back up. */
export const sagSubmergedQ = (eta, Hout, { L, K, Co, A }) => Math.sign(eta - Hout) * Math.sqrt(Math.abs(eta - Hout) / (L / (K * K) + 1 / (2 * G * Co * Co * A * A)));
/** The street's outflow rating at level eta: what the inlet takes freely, no more than the pipe carries on the head. */
export const sagRating = (eta, zs, Hout, o) => (eta >= Hout ? Math.min(inletFree(eta - zs, o), sagSubmergedQ(eta, Hout, o)) : sagSubmergedQ(Math.max(eta, zs), Hout, o));
/** The level at which the rating carries Q (bisection); the closed form when the pipe controls is sagLevelClosed. */
export function sagLevelFor(Q, zs, Hout, o) { let lo = zs, hi = zs + 50; for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (sagRating(m, zs, Hout, o) < Q) lo = m; else hi = m; } return (lo + hi) / 2; }
export const sagLevelClosed = (Q, Hout, { L, K, Co, A }) => Hout + L * (Q / K) ** 2 + (Q / (Co * A)) ** 2 / (2 * G);
/** Pond history: dV/dt = inflow(t) − rating(η(V)), RK4. stage(V) → η. → [{ t, V, eta, Q }] every `every` s. */
export function sagHistory({ inflow, stage, zs, Hout, o, tEnd, dt = 0.5, every = 60, V0 = 0 }) {
  const q = (t, V) => Math.min(sagRating(stage(V), zs, Hout, o), inflow(t) + V / dt), f = (t, V) => inflow(t) - q(t, V), out = []; // never more out than is there
  let V = V0, t = 0, next = 0;
  for (;;) {
    if (t >= next - 1e-9) { const eta = stage(V); out.push({ t, V, eta, Q: q(t, V) }); next += every; }
    if (t >= tEnd - 1e-9) break;
    const k1 = f(t, V), k2 = f(t + dt / 2, Math.max(0, V + dt / 2 * k1)), k3 = f(t + dt / 2, Math.max(0, V + dt / 2 * k2)), k4 = f(t + dt, Math.max(0, V + dt * k3));
    V = Math.max(0, V + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)); t += dt;
  }
  return out;
}

// ---------------------------------------------------------------- hydraulic grade line of a sewer tree
/**
 * HGL by friction only, from each outlet upstream. pipes: [{ from, to, L, D, n, invUp, invDn, Q }] (Q the flow carried,
 * m³/s); nodes: [{ ground }]; outlets: Map(node → tailwater level, or null = the pipe's own depth at the outlet:
 * crown when Q ≥ full capacity, else normal depth). → { hgl[node], over[node] = hgl − ground, flooded: node indices }
 */
export function hglTree(nodes, pipes, outlets) {
  const hgl = new Float64Array(nodes.length).fill(NaN), into = nodes.map(() => []);
  pipes.forEach((p, k) => into[p.to].push(k));
  const ny = (p) => { const S = Math.max(1e-6, (p.invUp - p.invDn) / p.L), Qf = pipeK(p.D, p.n) * Math.sqrt(S); return p.Q >= Qf ? p.D : normalDepthBisect({ shape: 'circle', D: p.D }, p.Q, p.n, S); };
  const st = [];
  for (const [node, tw] of outlets) { const k = into[node][0]; hgl[node] = tw ?? (k == null ? NaN : pipes[k].invDn + (pipes[k].Q > 0 ? ny(pipes[k]) : 0)); st.push(node); }
  while (st.length) {
    const v = st.pop();
    for (const k of into[v]) {
      const p = pipes[k], full = hgl[v] >= p.invDn + p.D;
      const up = full ? Math.max(hgl[v] + p.L * (p.Q / pipeK(p.D, p.n)) ** 2, p.invUp + (p.Q > 0 ? ny(p) : 0)) : Math.max(hgl[v], p.invUp + (p.Q > 0 ? ny(p) : 0));
      hgl[p.from] = Math.max(hgl[p.from] === hgl[p.from] ? hgl[p.from] : -Infinity, up); st.push(p.from);
    }
  }
  const over = Array.from(hgl, (h, i) => (outlets.has(i) ? -Infinity : h - nodes[i].ground)); // an outlet has no rim
  return { hgl, over, flooded: over.map((d, i) => (d > 0 ? i : -1)).filter(i => i >= 0) };
}
/** Rational method: Q = C·A·i (m³/s) from the runoff-weighted area CA (m²) and an intensity (mm/h). */
export const rationalQ = (CA, mmhr) => CA * mmhr / 3.6e6;
/** The largest multiple of the given pipe flows the tree carries with every HGL at or below ground (bisection). */
export function hglCapacityFactor(nodes, pipes, outlets, hi = 64) {
  const ok = (f) => hglTree(nodes, pipes.map(p => ({ ...p, Q: p.Q * f })), outlets).flooded.length === 0;
  if (!ok(1e-6)) return 0; if (ok(hi)) return hi;
  let lo = 1e-6; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

// ---------------------------------------------------------------- a gutter and a grate on a grade (FHWA HEC-22, 3rd ed., §4.3.2, §4.4.4.1)
/** Spread T (m) of a flow Q (m³/s) in a uniform triangular gutter: Q = (0.376 / n) Sx^1.67 SL^0.5 T^2.67 (Eq. 4-2). */
export const gutterSpread = (Q, n, Sx, SL) => Math.pow(Q * n / (0.376 * Math.pow(Sx, 1.67) * Math.sqrt(SL)), 1 / 2.67);
/** Self-test twin: the gutter's flow by integrating Manning's unit discharge (1/n) d^(5/3) √SL across the spread. */
export function gutterFlowByStrips(T, n, Sx, SL, m = 200000) { let q = 0; for (let k = 0; k < m; k++) q += Math.pow(Sx * (k + 0.5) * T / m, 5 / 3) * T / m; return q * Math.sqrt(SL) / n; }
/** Share of a gutter's flow a grate W wide and L long takes (Eq. 4-16, 4-19, 4-20; frontal flow all taken, V below splash-over). */
export function grateEfficiency(Q, n, Sx, SL, W, L) {
  const T = gutterSpread(Q, n, Sx, SL), V = Q / (0.5 * T * T * Sx), Eo = 1 - Math.pow(Math.max(0, 1 - W / T), 2.67), Rs = 1 / (1 + 0.0828 * Math.pow(V, 1.8) / (Sx * Math.pow(L, 2.3)));
  return { T, V, Eo, Rs, E: Eo + Rs * (1 - Eo) };
}
/** Mean depth (m) over the first metre from the kerb of a gutter flowing with spread T: the depth a 1 m kerb cell holds. */
export const kerbCellDepth = (T, Sx, w = 1) => (T >= w ? Sx * (T - w / 2) : Sx * T * T / (2 * w));

// ---------------------------------------------------------------- a storage measure (a rain garden, permeable paving)
/**
 * Depth of water (m, per unit area of the measure) taken in by time T by a store that is under water throughout: it
 * takes water at `rate` until its capacity `cap` is full, loses it to the soil below at `drain`, and once full takes
 * only what drains. → { intake, tFull }
 */
export function storeIntake(rate, cap, drain, T) {
  const tFull = rate > drain ? cap / (rate - drain) : Infinity;
  return { tFull, intake: T <= tFull ? rate * T : rate * tFull + drain * (T - tFull) };
}
/** Self-test twin: the same by stepping the store. */
export function storeIntakeStepped(rate, cap, drain, T, dt = 0.5) {
  let s = 0, taken = 0; for (let t = 0; t < T - 1e-9; t += dt) { const st = Math.max(0, s - drain * dt), g = Math.min(rate * dt, cap - st); s = st + g; taken += g; } return taken;
}

// ---------------------------------------------------------------- the wall-exposure rule
/**
 * Water against a building, by the rule as written. depth, wse, bld (1 = building), road (1 = street), fp (1 = this
 * building's own footprint): arrays nx × ny; dx m. → { counts (boolean), level (highest counted water level within
 * reach, or null), cells (counted cells within reach) }
 * Patches by union–find (4-connected, wet = depth ≥ minDepth on an open cell); reach measured between cell edges.
 */
export function wallExposure({ depth, wse, bld, road, fp, nx, ny, dx, minDepth = 0.10, minArea = 200, reach = 2 }) {
  const N = nx * ny, par = new Int32Array(N).map((_, k) => k), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const wet = (k) => depth[k] >= minDepth && !bld[k];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!wet(k)) continue; if (i + 1 < nx && wet(k + 1)) par[find(k)] = find(k + 1); if (j + 1 < ny && wet(k + nx)) par[find(k)] = find(k + nx); }
  const size = new Map(), street = new Set();
  for (let k = 0; k < N; k++) if (wet(k)) { const r = find(k); size.set(r, (size.get(r) ?? 0) + 1); if (road[k]) street.add(r); }
  const R = Math.round(reach / dx - 1e-9); let level = null, cells = 0; // cells whose near edge is within `reach` of the footprint's edge
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!wet(k)) continue; const r = find(k);
    if (!(street.has(r) || size.get(r) * dx * dx >= minArea)) continue;
    let near = false;
    for (let b = Math.max(0, j - R); b <= Math.min(ny - 1, j + R) && !near; b++) for (let a = Math.max(0, i - R); a <= Math.min(nx - 1, i + R); a++) if (fp[b * nx + a]) { near = true; break; }
    if (near) { cells++; if (level == null || wse[k] > level) level = wse[k]; }
  }
  return { counts: cells > 0, level, cells };
}
