// Per-project emulator: a reduced-order surrogate of the solver, trained on a project's own runs.
//
//   study      one scenario (existing conditions or a saved design) and 1–6 parameters with ranges (return period,
//              rain factor, inflow scale, tide offset, soil wetness, design numbers); training points are a maximin
//              Latin hypercube in the unit cube plus its centre, and a few random held-out points the solver also runs
//   fields     each run's 1 m grids on a mask (cells wet in any run, widened): max water surface with dry cells filled
//              with that run's ground (smooth through wetting and drying), √max speed, time above 15 cm
//   model      PCA of the fields from the N×N Gram matrix (Jacobi), one Gaussian process per component and per scalar
//              output (Matérn 5/2, a length scale per parameter, constant mean, nugget; length scales and nugget by
//              maximum concentrated likelihood, multi-start Nelder–Mead in log space)
//   checks     closed-form leave-one-out (Dubrule) per training run, held-out runs, a range check on every request, and
//              a per-cell error estimate √(Σ σₖ²φₖ² + truncation residual)
// The solver stays the source of truth: emulated results are for screening and are confirmed with a solver run.
// Pure functions on typed arrays; parameters in user units go through toUnit / fromUnit.

// ------------------------------------------------------------------ parameters and the training plan

/** Small seeded generator (mulberry32) → () => [0, 1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** User value → [0, 1] on the parameter's scale (log for `log: true`). p: { min, max, log } */
export const toUnit = (p, v) => (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
export const fromUnit = (p, u) => (p.log ? p.min * (p.max / p.min) ** u : p.min + u * (p.max - p.min));
/** Values outside the trained box (a small tolerance for rounding). → [{ key, value, min, max }] */
export function outOfRange(params, values, tol = 1e-9) {
  return params.filter((p) => { const u = toUnit(p, values[p.key]); return !(u >= -tol && u <= 1 + tol); })
    .map(p => ({ key: p.key, value: values[p.key], min: p.min, max: p.max }));
}

/** Smallest distance between any two points. */
export function minDistance(pts) {
  let m = Infinity;
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) { let s = 0; for (let k = 0; k < pts[a].length; k++) s += (pts[a][k] - pts[b][k]) ** 2; m = Math.min(m, s); }
  return Math.sqrt(m);
}
/**
 * Maximin Latin hypercube: n points in [0, 1]^d, one per bin of width 1/n in every dimension (jittered inside it); the
 * best of `tries` random hypercubes by smallest pairwise distance. → [[u1 … ud]]
 */
export function lhs(n, d, { seed = 1, tries = 200 } = {}) {
  const r = rng(seed); let best = null, bestD = -1;
  for (let t = 0; t < tries; t++) {
    const pts = Array.from({ length: n }, () => new Array(d));
    for (let k = 0; k < d; k++) {
      const perm = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      for (let i = 0; i < n; i++) pts[i][k] = (perm[i] + r()) / n;
    }
    const md = minDistance(pts); if (md > bestD) { bestD = md; best = pts; }
  }
  return best;
}
/** Training size for d parameters: 10 per parameter, at least 8, at most 80 (the centre point comes on top). */
export const planSize = (d) => Math.max(8, Math.min(80, 10 * d));
/**
 * The training plan: the LHS points, the centre of the box, and `holdout` uniformly random points the solver also
 * runs to test the emulator honestly. → [{ id, u: [...], role: 'train' | 'holdout' }]
 */
export function trainingPlan(d, { n = planSize(d), holdout = 3, seed = 1 } = {}) {
  const pts = lhs(n, d, { seed }).map((u, i) => ({ id: 't' + i, u, role: 'train' }));
  pts.push({ id: 'c', u: new Array(d).fill(0.5), role: 'train' });
  const r = rng(seed + 7919); for (let i = 0; i < holdout; i++) pts.push({ id: 'h' + i, u: Array.from({ length: d }, () => r()), role: 'holdout' });
  return pts;
}

// ------------------------------------------------------------------ linear algebra (small dense, row-major Float64)

/** Cholesky factor (lower) of an n×n SPD matrix, or null when it is not positive definite. */
export function cholesky(A, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (!(s > 0)) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
  }
  return L;
}
/** Solve L Lᵀ x = b. */
export function cholSolve(L, n, b) {
  const y = Float64Array.from(b);
  for (let i = 0; i < n; i++) { let s = y[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * y[k]; y[i] = s / L[i * n + i]; }
  return y;
}
/** Inverse from a Cholesky factor. */
export function cholInverse(L, n) {
  const inv = new Float64Array(n * n), e = new Float64Array(n);
  for (let j = 0; j < n; j++) { e.fill(0); e[j] = 1; const x = cholSolve(L, n, e); for (let i = 0; i < n; i++) inv[i * n + j] = x[i]; }
  return inv;
}
/** Eigen-decomposition of a symmetric n×n matrix (cyclic Jacobi). → { values (descending), vectors (columns, row-major) } */
export function eigSym(A, n, { tol = 1e-13, sweeps = 100 } = {}) {
  const a = Float64Array.from(A), v = new Float64Array(n * n); for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let s = 0; s < sweeps; s++) {
    let off = 0, diag = 0; for (let i = 0; i < n; i++) { diag += a[i * n + i] ** 2; for (let j = i + 1; j < n; j++) off += a[i * n + j] ** 2; }
    if (off <= tol * tol * Math.max(diag, 1e-300)) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
      const th = (a[q * n + q] - a[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k * n + p], akq = a[k * n + q]; a[k * n + p] = c * akp - sn * akq; a[k * n + q] = sn * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p * n + k], aqk = a[q * n + k]; a[p * n + k] = c * apk - sn * aqk; a[q * n + k] = sn * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = v[k * n + p], vkq = v[k * n + q]; v[k * n + p] = c * vkp - sn * vkq; v[k * n + q] = sn * vkp + c * vkq; }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[y * n + y] - a[x * n + x]);
  const values = new Float64Array(n), vectors = new Float64Array(n * n);
  order.forEach((o, j) => { values[j] = a[o * n + o]; for (let i = 0; i < n; i++) vectors[i * n + j] = v[i * n + o]; });
  return { values, vectors };
}
/** Nelder–Mead minimisation of f over R^m from x0 (initial step `step`). → { x, f } */
export function nelderMead(f, x0, { step = 0.5, maxIter = 400, tol = 1e-8 } = {}) {
  const m = x0.length, S = [x0.slice()]; for (let i = 0; i < m; i++) { const x = x0.slice(); x[i] += step; S.push(x); }
  let F = S.map(f);
  for (let it = 0; it < maxIter; it++) {
    const idx = F.map((_, i) => i).sort((a, b) => F[a] - F[b]); const s2 = idx.map(i => S[i]), f2 = idx.map(i => F[i]); S.splice(0, S.length, ...s2); F = f2;
    if (Math.abs(F[m] - F[0]) <= tol * (Math.abs(F[0]) + 1e-12)) break;
    const c = new Array(m).fill(0); for (let i = 0; i < m; i++) for (let k = 0; k < m; k++) c[k] += S[i][k] / m;
    const at = (t) => c.map((ck, k) => ck + t * (S[m][k] - ck));
    const xr = at(-1), fr = f(xr);
    if (fr < F[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { S[m] = xe; F[m] = fe; } else { S[m] = xr; F[m] = fr; } continue; }
    if (fr < F[m - 1]) { S[m] = xr; F[m] = fr; continue; }
    const xc = fr < F[m] ? at(-0.5) : at(0.5), fc = f(xc);
    if (fc < Math.min(fr, F[m])) { S[m] = xc; F[m] = fc; continue; }
    for (let i = 1; i <= m; i++) { S[i] = S[i].map((v, k) => S[0][k] + 0.5 * (v - S[0][k])); F[i] = f(S[i]); }
  }
  let b = 0; for (let i = 1; i <= m; i++) if (F[i] < F[b]) b = i;
  return { x: S[b], f: F[b] };
}

// ------------------------------------------------------------------ Gaussian process (ordinary kriging)

const S5 = Math.sqrt(5);
/** Matérn 5/2 correlation of two points with length scales ell. */
export function matern52(a, b, ell) {
  let s = 0; for (let k = 0; k < a.length; k++) s += ((a[k] - b[k]) / ell[k]) ** 2;
  const r = Math.sqrt(s); return (1 + S5 * r + 5 * s / 3) * Math.exp(-S5 * r);
}
function corrMatrix(X, ell, nugget) {
  const n = X.length, R = new Float64Array(n * n);
  for (let i = 0; i < n; i++) { R[i * n + i] = 1 + nugget; for (let j = 0; j < i; j++) R[i * n + j] = R[j * n + i] = matern52(X[i], X[j], ell); }
  return R;
}
const ELL = [0.02, 20], NUG = [1e-10, 0.1]; // bounds on length scales (unit cube) and the nugget ratio
const clampLog = (v, [lo, hi]) => Math.min(Math.log(hi), Math.max(Math.log(lo), v));

/**
 * Fixed-hyperparameter fit: the constant mean β, signal variance σ² and weights by generalised least squares.
 * → gp { X, y, ell, nugget, beta, sigma2, alpha = R⁻¹(y − β), L, Ri1, s = 1ᵀR⁻¹1, nll } or null when R is singular
 */
export function gpCondition(X, y, ell, nugget) {
  const n = X.length, R = corrMatrix(X, ell, nugget), L = cholesky(R, n); if (!L) return null;
  const one = new Float64Array(n).fill(1), Ri1 = cholSolve(L, n, one), Riy = cholSolve(L, n, y);
  let s = 0, t = 0; for (let i = 0; i < n; i++) { s += Ri1[i]; t += Riy[i]; }
  const beta = t / s, alpha = new Float64Array(n); for (let i = 0; i < n; i++) alpha[i] = Riy[i] - beta * Ri1[i];
  let q = 0; for (let i = 0; i < n; i++) q += (y[i] - beta) * alpha[i];
  const sigma2 = Math.max(q / n, 1e-300); let logdet = 0; for (let i = 0; i < n; i++) logdet += 2 * Math.log(L[i * n + i]);
  return { X, y: Float64Array.from(y), ell: [...ell], nugget, beta, sigma2, alpha, L, Ri1, s, nll: 0.5 * (n * Math.log(sigma2) + logdet) };
}
/**
 * Fit a GP to (X in the unit cube, y): length scales and nugget by maximum concentrated likelihood. A constant y fits
 * exactly (σ² → 0). opts: { starts, maxIter, ell, nugget } (fixed values skip the search).
 */
export function gpFit(X, y, { starts = 3, maxIter, ell = null, nugget = null, seed = 3 } = {}) {
  const d = X[0].length;
  let ymin = Infinity, ymax = -Infinity; for (const v of y) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
  if (ell && nugget != null) return gpCondition(X, y, ell, nugget);
  if (!(ymax - ymin > 1e-12 * Math.max(1, Math.abs(ymax)))) return gpCondition(X, y, ell ?? new Array(d).fill(1), nugget ?? 1e-8);
  const unpack = (th) => ({ ell: th.slice(0, d).map(v => Math.exp(clampLog(v, ELL))), nug: Math.exp(clampLog(th[d], NUG)) });
  const obj = (th) => { const { ell: e, nug } = unpack(th); const g = gpCondition(X, y, e, nug); return g ? g.nll + 1e-3 * th.reduce((a, v, k) => a + (k < d ? (v - Math.log(0.5)) ** 2 : 0), 0) : 1e30; };
  const r = rng(seed), inits = [[...new Array(d).fill(Math.log(0.3)), Math.log(1e-6)], [...new Array(d).fill(Math.log(1)), Math.log(1e-4)]];
  while (inits.length < starts) inits.push([...Array.from({ length: d }, () => Math.log(0.1) + r() * Math.log(30)), Math.log(1e-8) + r() * Math.log(1e5)]);
  let best = null;
  for (const x0 of inits.slice(0, Math.max(1, starts))) { const o = nelderMead(obj, x0, { maxIter: maxIter ?? 120 * (d + 1) }); if (!best || o.f < best.f) best = o; }
  const { ell: e, nug } = unpack(best.x);
  return gpCondition(X, y, e, nug);
}
/** Prediction at u (unit cube): mean and standard deviation of the noise-free value (ordinary kriging variance). */
export function gpPredict(gp, u) {
  const n = gp.X.length, r = new Float64Array(n); for (let i = 0; i < n; i++) r[i] = matern52(u, gp.X[i], gp.ell);
  let mean = gp.beta; for (let i = 0; i < n; i++) mean += r[i] * gp.alpha[i];
  const Rir = cholSolve(gp.L, n, r); let rRr = 0, oRr = 0; for (let i = 0; i < n; i++) { rRr += r[i] * Rir[i]; oRr += Rir[i]; }
  const v = gp.sigma2 * Math.max(0, 1 - rRr + (1 - oRr) ** 2 / gp.s);
  return { mean, sd: Math.sqrt(v) };
}
/**
 * Leave-one-out residuals and predictions with the hyperparameters held (Dubrule 1983, with the mean re-estimated):
 * e_i = α_i / ([R⁻¹]_ii − (R⁻¹1)_i² / 1ᵀR⁻¹1), ŷ_(−i) = y_i − e_i, var_i = σ² / that denominator (of y_i, with nugget).
 * → { pred, resid, sd }
 */
export function gpLOO(gp) {
  const n = gp.X.length, Ri = cholInverse(gp.L, n), pred = new Float64Array(n), resid = new Float64Array(n), sd = new Float64Array(n);
  for (let i = 0; i < n; i++) { const den = Ri[i * n + i] - gp.Ri1[i] ** 2 / gp.s; resid[i] = gp.alpha[i] / den; pred[i] = gp.y[i] - resid[i]; sd[i] = Math.sqrt(gp.sigma2 / den); }
  return { pred, resid, sd };
}
const gpJSON = (g) => ({ ell: g.ell, nugget: g.nugget, X: g.X, y: Array.from(g.y) });
const gpFromJSON = (o) => gpCondition(o.X, Float64Array.from(o.y), o.ell, o.nugget);

// ------------------------------------------------------------------ PCA of fields

/**
 * PCA of N fields of length M (Float32Array each) from the centred Gram matrix. Keeps components up to `energy` of
 * the variance (at most N − 1). → { mean (Float32 M), basis: [Float32 M] (unit length), scores: [[N per comp]], values, kept, total }
 */
export function pca(fields, { energy = 0.999, maxK = Infinity } = {}) {
  const N = fields.length, M = fields[0].length, mean = new Float64Array(M);
  for (const f of fields) for (let c = 0; c < M; c++) mean[c] += f[c] / N;
  const G = new Float64Array(N * N), ci = new Float64Array(M);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < M; c++) ci[c] = fields[i][c] - mean[c];
    for (let j = 0; j <= i; j++) { const f = fields[j]; let s = 0; for (let c = 0; c < M; c++) s += ci[c] * (f[c] - mean[c]); G[i * N + j] = G[j * N + i] = s; }
  }
  const { values, vectors } = eigSym(G, N); let total = 0; for (const v of values) total += Math.max(0, v);
  let K = 0, acc = 0; const lim = Math.min(N - 1, maxK);
  while (K < lim && values[K] > 1e-12 * Math.max(values[0], 1e-300) && (acc < energy * total || K === 0)) { acc += values[K]; K++; }
  const basis = [], scores = [];
  for (let k = 0; k < K; k++) {
    const phi = new Float64Array(M), sq = Math.sqrt(values[k]);
    for (let i = 0; i < N; i++) { const w = vectors[i * N + k] / sq, f = fields[i]; if (w) for (let c = 0; c < M; c++) phi[c] += w * (f[c] - mean[c]); }
    basis.push(Float32Array.from(phi)); scores.push(Array.from({ length: N }, (_, i) => sq * vectors[i * N + k]));
  }
  return { mean: Float32Array.from(mean), basis, scores, values: Array.from(values), kept: acc / (total || 1), total, K };
}
/** mean + Σ c_k φ_k */
export function reconstruct(mean, basis, c) {
  const out = Float32Array.from(mean);
  for (let k = 0; k < basis.length; k++) { const w = c[k], phi = basis[k]; if (w) for (let m = 0; m < out.length; m++) out[m] += w * phi[m]; }
  return out;
}

// ------------------------------------------------------------------ field and scalar emulators

/** Number of components whose length scales are fitted on their own; the rest share the last fitted ones. */
const OWN_FITS = 8;
/**
 * Field emulator from training fields (masked, Float32Array each) at unit-cube points X.
 * → { kind: 'field', M, mean, basis, gps, resVar (per cell, from the dropped components), K, kept }
 */
export function fitField(fields, X, opts = {}) {
  const P = pca(fields, opts), gps = [];
  let shared = null;
  for (let k = 0; k < P.K; k++) {
    const y = Float64Array.from(P.scores[k]);
    const g = k < OWN_FITS || !shared ? gpFit(X, y, opts) : gpFit(X, y, { ell: shared.ell, nugget: shared.nugget });
    if (k < OWN_FITS) shared = g; gps.push(g);
  }
  // truncation residual: the mean square of what the kept components leave out, per cell, over the training runs
  const M = fields[0].length, resVar = new Float32Array(M);
  if (P.kept < 1 - 1e-12) for (let i = 0; i < fields.length; i++) {
    const rec = reconstruct(P.mean, P.basis, P.scores.map(s => s[i])), f = fields[i];
    for (let m = 0; m < M; m++) resVar[m] += (f[m] - rec[m]) ** 2 / fields.length;
  }
  return { kind: 'field', M, mean: P.mean, basis: P.basis, gps, resVar, K: P.K, kept: P.kept, values: P.values.slice(0, P.K) };
}
/** Field at u: { mean (Float32 M), sd (Float32 M) } */
export function predictField(em, u) {
  const c = [], v = []; for (const g of em.gps) { const p = gpPredict(g, u); c.push(p.mean); v.push(p.sd * p.sd); }
  const mean = reconstruct(em.mean, em.basis, c), sd = new Float32Array(em.M);
  for (let m = 0; m < em.M; m++) { let s = em.resVar[m]; for (let k = 0; k < em.basis.length; k++) s += v[k] * em.basis[k][m] ** 2; sd[m] = Math.sqrt(s); }
  return { mean, sd };
}
/** Leave-one-out field of training run i (the basis keeps run i: slightly optimistic; held-out runs are the honest test). */
export function looFields(em) {
  const loo = em.gps.map(gpLOO), N = em.gps[0]?.X.length ?? 0;
  return Array.from({ length: N }, (_, i) => reconstruct(em.mean, em.basis, loo.map(l => l.pred[i])));
}
/** Scalar emulators: one GP per named output. outputs: { name: [N values] } → { kind: 'scalars', gps: { name: gp } } */
export function fitScalars(outputs, X, opts = {}) {
  const gps = {}; for (const [k, y] of Object.entries(outputs)) if (y.every(Number.isFinite)) gps[k] = gpFit(X, Float64Array.from(y), opts);
  return { kind: 'scalars', gps };
}
export function predictScalars(em, u) { const o = {}; for (const [k, g] of Object.entries(em.gps)) o[k] = gpPredict(g, u); return o; }
export function looScalars(em) { const o = {}; for (const [k, g] of Object.entries(em.gps)) o[k] = gpLOO(g); return o; }

// ------------------------------------------------------------------ flood fields and checks

/**
 * Fill the gaps (NaN) in a grid smoothly from the values around them (pull–push: weighted means up a pyramid of 2×2
 * blocks, then bilinear back down; known values are kept exactly). → Float32Array
 */
export function pullPush(grid, nx, ny) {
  const levels = [{ nx, ny, v: new Float64Array(nx * ny), w: new Float64Array(nx * ny) }];
  for (let k = 0; k < nx * ny; k++) if (Number.isFinite(grid[k])) { levels[0].v[k] = grid[k]; levels[0].w[k] = 1; }
  while (levels.at(-1).nx > 1 || levels.at(-1).ny > 1) {
    const f = levels.at(-1), cx = Math.ceil(f.nx / 2), cy = Math.ceil(f.ny / 2), v = new Float64Array(cx * cy), w = new Float64Array(cx * cy);
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { const k = j * f.nx + i, K = (j >> 1) * cx + (i >> 1); v[K] += f.w[k] * f.v[k]; w[K] += f.w[k]; }
    for (let K = 0; K < cx * cy; K++) { if (w[K] > 0) v[K] /= w[K]; w[K] = Math.min(1, w[K]); }
    levels.push({ nx: cx, ny: cy, v, w });
  }
  if (!(levels.at(-1).w[0] > 0)) return Float32Array.from(grid); // nothing to fill from
  for (let L = levels.length - 2; L >= 0; L--) {
    const f = levels[L], c = levels[L + 1];
    const at = (x, y) => c.v[Math.min(c.ny - 1, Math.max(0, y)) * c.nx + Math.min(c.nx - 1, Math.max(0, x))];
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
      const k = j * f.nx + i; if (f.w[k] >= 1) continue;
      const x = (i + 0.5) / 2 - 0.5, y = (j + 0.5) / 2 - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
      const up = (1 - ty) * ((1 - tx) * at(x0, y0) + tx * at(x0 + 1, y0)) + ty * ((1 - tx) * at(x0, y0 + 1) + tx * at(x0 + 1, y0 + 1));
      f.v[k] = f.w[k] * f.v[k] + (1 - f.w[k]) * up; f.w[k] = 1;
    }
  }
  return Float32Array.from(levels[0].v);
}
/**
 * The field the emulator learns, on the mask: the max water surface where the run was wet, and in dry cells the water
 * surface carried smoothly in from the wet cells around them, capped at the ground (so the depth there stays 0). A lake
 * stays one flat level across a pad that pokes out of it, so the field changes smoothly with the parameters even where
 * the shoreline moves. → Float32Array (masked)
 */
export function fillWse(maxWse, z, mask, nx, ny) {
  const ext = pullPush(maxWse, nx, ny), out = new Float32Array(mask.length); let m = 0;
  for (let k = 0; k < z.length; k++) if (mask[k]) out[m++] = Number.isFinite(maxWse[k]) ? Math.max(maxWse[k], z[k]) : Number.isFinite(ext[k]) ? Math.min(ext[k], z[k]) : z[k];
  return out.subarray(0, m);
}
/** Cells to emulate: wet (finite water surface) in any run and not a wall, widened by `grow` cells (4-neighbours). */
export function fieldMask(wseRuns, nx, ny, { walls = null, grow = 2 } = {}) {
  const N = nx * ny; let m = new Uint8Array(N);
  for (const w of wseRuns) for (let k = 0; k < N; k++) if (Number.isFinite(w[k])) m[k] = 1;
  for (let g = 0; g < grow; g++) {
    const n2 = m.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (m[k]) continue; if ((i > 0 && m[k - 1]) || (i < nx - 1 && m[k + 1]) || (j > 0 && m[k - nx]) || (j < ny - 1 && m[k + nx])) n2[k] = 1; }
    m = n2;
  }
  if (walls) for (let k = 0; k < N; k++) if (walls[k]) m[k] = 0;
  return m;
}
/** Masked vector → full grid (NaN outside the mask). */
export function unmask(vec, mask, fill = NaN) {
  const out = new Float32Array(mask.length).fill(fill); let m = 0; for (let k = 0; k < mask.length; k++) if (mask[k]) out[k] = vec[m++]; return out;
}
/** Full grid → masked vector. */
export function maskOf(grid, mask) { let n = 0; for (const v of mask) n += v; const out = new Float32Array(n); let m = 0; for (let k = 0; k < mask.length; k++) if (mask[k]) out[m++] = grid[k]; return out; }
/** Depth from a (masked) water surface and ground: max(0, wse − z), with depths under `hmin` as dry. */
export function depthFrom(wse, zMasked, hmin = 0.005) { const d = new Float32Array(wse.length); for (let m = 0; m < d.length; m++) { const h = wse[m] - zMasked[m]; d[m] = h > hmin ? h : 0; } return d; }

/**
 * Error of an emulated depth field against the solver's: RMSE / MAE over cells wet in either (> hmin), the worst
 * cell, and the critical success index of the extent deeper than `thr`. → { rmse, mae, maxAbs, kMax, csi, cells }
 */
export function depthError(truth, pred, { thr = 0.15, hmin = 0.005 } = {}) {
  let s2 = 0, s1 = 0, n = 0, mx = 0, kMax = -1, hit = 0, miss = 0, fa = 0;
  for (let m = 0; m < truth.length; m++) {
    const a = truth[m], b = pred[m];
    if (a > hmin || b > hmin) { const e = b - a; s2 += e * e; s1 += Math.abs(e); n++; if (Math.abs(e) > mx) { mx = Math.abs(e); kMax = m; } }
    const A = a > thr, B = b > thr; if (A && B) hit++; else if (A) miss++; else if (B) fa++;
  }
  return { rmse: n ? Math.sqrt(s2 / n) : 0, mae: n ? s1 / n : 0, maxAbs: mx, kMax, csi: hit + miss + fa ? hit / (hit + miss + fa) : 1, cells: n };
}
/** Point of largest mean predictive variance (over the field and the scalars) among `n` random candidates. */
export function leastSure(em, d, { n = 2000, seed = 11, sample = 400 } = {}) {
  const r = rng(seed); let best = null, bv = -1;
  const pick = em.field ? Array.from({ length: Math.min(sample, em.field.M) }, (_, i) => Math.floor(i * em.field.M / Math.min(sample, em.field.M))) : [];
  for (let t = 0; t < n; t++) {
    const u = Array.from({ length: d }, () => r()); let v = 0;
    if (em.field) { const vs = em.field.gps.map(g => gpPredict(g, u).sd ** 2); for (const m of pick) for (let k = 0; k < vs.length; k++) v += vs[k] * em.field.basis[k][m] ** 2; }
    if (v > bv) { bv = v; best = u; }
  }
  return { u: best, variance: bv };
}

// ------------------------------------------------------------------ the project emulator: train, predict, save

/**
 * Train from runs at unit-cube points: runs = [{ u, wse (masked, ground-filled), speed (masked, √), dur (masked),
 * scalars: { name: value } }]. → emulator { field: { wse, speed, dur }, scalars, X }
 */
export function train(runs, opts = {}) {
  const X = runs.map(r => r.u), out = { X, field: null, fields: {}, scalars: null };
  for (const key of ['wse', 'speed', 'dur']) if (runs.every(r => r[key])) out.fields[key] = fitField(runs.map(r => r[key]), X, opts);
  out.field = out.fields.wse ?? null;
  const names = [...new Set(runs.flatMap(r => Object.keys(r.scalars ?? {})))];
  out.scalars = fitScalars(Object.fromEntries(names.map(k => [k, runs.map(r => r.scalars?.[k] ?? NaN)])), X, opts);
  return out;
}
/** Everything at unit-cube point u: { wse, wseSd, speed, dur, scalars } (masked vectors; speed squared back, ≥ 0). */
export function predict(em, u) {
  const o = {};
  if (em.fields.wse) { const p = predictField(em.fields.wse, u); o.wse = p.mean; o.wseSd = p.sd; }
  if (em.fields.speed) { const p = predictField(em.fields.speed, u); o.speed = p.mean.map(v => (v > 0 ? v * v : 0)); }
  if (em.fields.dur) { const p = predictField(em.fields.dur, u); o.dur = p.mean.map(v => Math.max(0, v)); }
  o.scalars = em.scalars ? predictScalars(em.scalars, u) : {};
  return o;
}
/** The emulator as JSON (GP hyperparameters and training data) plus binary blocks for the means, bases and residuals. */
export function serialize(em) {
  const blobs = {}, fields = {};
  for (const [key, f] of Object.entries(em.fields)) {
    fields[key] = { M: f.M, K: f.K, kept: f.kept, values: f.values, gps: f.gps.map(gpJSON) };
    blobs[`${key}_mean`] = f.mean; blobs[`${key}_res`] = f.resVar;
    const B = new Float32Array(f.K * f.M); f.basis.forEach((b, k) => B.set(b, k * f.M)); blobs[`${key}_basis`] = B;
  }
  const scalars = Object.fromEntries(Object.entries(em.scalars?.gps ?? {}).map(([k, g]) => [k, gpJSON(g)]));
  return { json: { X: em.X, fields, scalars }, blobs };
}
export function deserialize(json, blobs) {
  const fields = {};
  for (const [key, f] of Object.entries(json.fields)) {
    const B = blobs[`${key}_basis`], basis = Array.from({ length: f.K }, (_, k) => B.subarray(k * f.M, (k + 1) * f.M));
    fields[key] = { kind: 'field', M: f.M, K: f.K, kept: f.kept, values: f.values, mean: blobs[`${key}_mean`], resVar: blobs[`${key}_res`], basis, gps: f.gps.map(gpFromJSON) };
  }
  const scalars = { kind: 'scalars', gps: Object.fromEntries(Object.entries(json.scalars).map(([k, g]) => [k, gpFromJSON(g)])) };
  return { X: json.X, fields, field: fields.wse ?? null, scalars };
}
