// Emulator tests: the Latin hypercube stratifies and spreads its points, the Gaussian process passes through its
// training points and learns a known function, closed-form leave-one-out equals refitting, the likelihood fit finds a
// known length scale, PCA with every component rebuilds its fields, a synthetic flood is recovered at new points
// (including a design parameter that moves the ground), return periods between Atlas 14 columns interpolate, and a
// saved emulator predicts exactly what the trained one did.
// Usage: node tests/run-emulator-tests.mjs
import { readFileSync } from 'node:fs';
import * as E from '../src/emulator.js';
import { parsePFDS, ddf, hyetograph, A14_ARI } from '../src/storm.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{ // Latin hypercube
  const n = 20, d = 3, pts = E.lhs(n, d, { seed: 5 });
  const strat = [...Array(d).keys()].every(k => new Set(pts.map(p => Math.floor(p[k] * n))).size === n);
  let rand = 0; for (let s = 1; s <= 20; s++) rand += E.minDistance(E.lhs(n, d, { seed: 100 + s, tries: 1 })) / 20;
  check('LHS: one point per bin in every dimension', strat);
  check('maximin spreads the points more than a random hypercube', E.minDistance(pts) > 1.2 * rand, `min distance ${E.minDistance(pts).toFixed(3)} vs ${rand.toFixed(3)}`);
  const plan = E.trainingPlan(2, { seed: 2 });
  check('training plan: 10 per parameter (at least 8), the centre, 3 held out', plan.filter(p => p.role === 'train').length === 21 && plan.some(p => p.id === 'c') && plan.filter(p => p.role === 'holdout').length === 3);
  const P = [{ key: 'ari', min: 2, max: 100, log: true }, { key: 'se', min: 0, max: 1 }];
  check('log and linear parameter scales round-trip', Math.abs(E.fromUnit(P[0], E.toUnit(P[0], 10)) - 10) < 1e-9 && Math.abs(E.toUnit(P[0], Math.sqrt(200)) - 0.5) < 1e-12 && E.fromUnit(P[1], 0.25) === 0.25);
  check('values outside the trained box are refused', E.outOfRange(P, { ari: 150, se: 0.5 }).length === 1 && E.outOfRange(P, { ari: 100, se: 0 }).length === 0);
}

{ // linear algebra
  const n = 8, r = E.rng(3), A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) A[i * n + j] = A[j * n + i] = r() - 0.5;
  const { values, vectors } = E.eigSym(A, n); let worst = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += A[i * n + j] * vectors[j * n + k]; worst = Math.max(worst, Math.abs(s - values[k] * vectors[i * n + k])); }
  check('Jacobi eigenvectors: A v = λ v', worst < 1e-10 && values[0] >= values[n - 1], `worst ${worst.toExponential(1)}`);
  const nm = E.nelderMead(([x, y]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2, [-1.2, 1], { maxIter: 4000, tol: 1e-14 });
  check('Nelder–Mead finds the Rosenbrock minimum', Math.hypot(nm.x[0] - 1, nm.x[1] - 1) < 1e-3, `at ${nm.x.map(v => v.toFixed(4)).join(', ')}`);
}

const branin = ([u, v]) => { const x = -5 + 15 * u, y = 15 * v; return (y - 5.1 / (4 * Math.PI ** 2) * x * x + 5 / Math.PI * x - 6) ** 2 + 10 * (1 - 1 / (8 * Math.PI)) * Math.cos(x) + 10; };
{ // Gaussian process on the Branin function (range about 0–300)
  const X = E.lhs(40, 2, { seed: 9 }), y = Float64Array.from(X.map(branin)), gp = E.gpFit(X, y);
  let tr = 0; X.forEach((x, i) => { tr = Math.max(tr, Math.abs(E.gpPredict(gp, x).mean - y[i])); });
  const r = E.rng(17); let s2 = 0, cover = 0; const T = 500;
  for (let t = 0; t < T; t++) { const u = [r(), r()], p = E.gpPredict(gp, u), e = p.mean - branin(u); s2 += e * e; if (Math.abs(e) <= 2 * p.sd) cover++; }
  const rmse = Math.sqrt(s2 / T);
  check('GP passes through its training points', tr < 0.05, `worst ${tr.toExponential(1)} (range ~300)`);
  check('GP learns Branin from 40 points', rmse < 6, `RMSE ${rmse.toFixed(2)} (${(rmse / 3).toFixed(1)} % of the range), length scales ${gp.ell.map(v => v.toFixed(2)).join(', ')}`);
  check('its error estimate covers most errors (±2σ)', cover / T > 0.8, `${(cover / T * 100).toFixed(0)} % of 500 points`);
  // closed-form leave-one-out against refitting without each point (same hyperparameters)
  const loo = E.gpLOO(gp); let worst = 0;
  for (let i = 0; i < X.length; i++) {
    const Xi = X.filter((_, j) => j !== i), yi = Float64Array.from([...y].filter((_, j) => j !== i)), g = E.gpCondition(Xi, yi, gp.ell, gp.nugget);
    worst = Math.max(worst, Math.abs(E.gpPredict(g, X[i]).mean - loo.pred[i]) / 300);
  }
  check('closed-form leave-one-out equals refitting', worst < 1e-9, `worst ${worst.toExponential(1)} of the range`);
}

{ // the likelihood fit finds a known length scale: draws from a GP with ℓ = (0.2, 1.0)
  const X = E.lhs(70, 2, { seed: 21 }), n = X.length, ell = [0.2, 1.0], R = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) R[i * n + j] = E.matern52(X[i], X[j], ell) + (i === j ? 1e-8 : 0);
  const L = E.cholesky(R, n), r = E.rng(4), z = Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()));
  const y = new Float64Array(n); for (let i = 0; i < n; i++) for (let k = 0; k <= i; k++) y[i] += L[i * n + k] * z[k];
  const gp = E.gpFit(X, y, { starts: 4 });
  check('likelihood fit recovers the length scales (loosely)', gp.ell[0] > 0.1 && gp.ell[0] < 0.4 && gp.ell[1] > 1.6 * gp.ell[0], `ℓ ${gp.ell.map(v => v.toFixed(2)).join(', ')} (true 0.20, 1.00)`);
}

{ // PCA with every component rebuilds the training fields
  const r = E.rng(8), fields = Array.from({ length: 10 }, () => Float32Array.from({ length: 500 }, () => r() * 3));
  const P = E.pca(fields, { energy: 1 }); let worst = 0;
  fields.forEach((f, i) => { const rec = E.reconstruct(P.mean, P.basis, P.scores.map(s => s[i])); for (let m = 0; m < f.length; m++) worst = Math.max(worst, Math.abs(rec[m] - f[m])); });
  check('PCA with all components rebuilds its fields', P.K === 9 && worst < 1e-5, `${P.K} components, worst ${worst.toExponential(1)}`);
}

// a synthetic flood: a valley whose lake level is 10 + 0.8 p₁ + 0.5 p₂² m, and a pad raised p₃ × 1.5 m inside it
const nx = 60, ny = 40, N = nx * ny, z0 = new Float32Array(N);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z0[j * nx + i] = 9 + 0.12 * Math.abs(j - 20) + 0.03 * i + 0.3 * Math.sin(i / 5) * Math.cos(j / 7);
const onPad = (k) => { const i = k % nx, j = (k / nx) | 0; return i >= 24 && i < 32 && j >= 16 && j < 24; };
const ground = (u) => z0.map((v, k) => (onPad(k) ? v + 1.5 * u[2] : v));
const truthWse = (u) => { const lv = 10 + 0.8 * u[0] + 0.5 * u[1] ** 2, z = ground(u); return z.map(v => (lv - v > 0.005 ? lv : NaN)); };
{
  const plan = E.trainingPlan(3, { seed: 4 }), train = plan.filter(p => p.role === 'train'), hold = plan.filter(p => p.role === 'holdout');
  const mask = E.fieldMask(train.map(p => truthWse(p.u)), nx, ny);
  const runs = train.map(p => ({ u: p.u, wse: E.fillWse(truthWse(p.u), ground(p.u), mask, nx, ny), scalars: { level: 10 + 0.8 * p.u[0] + 0.5 * p.u[1] ** 2 } }));
  const em = E.train(runs);
  let worst = { rmse: 0, csi: 1, pad: 0 };
  for (const p of hold) {
    const zm = E.maskOf(ground(p.u), mask), pr = E.predict(em, p.u), dPred = E.depthFrom(pr.wse, zm), dTrue = E.depthFrom(E.fillWse(truthWse(p.u), ground(p.u), mask, nx, ny), zm);
    const e = E.depthError(dTrue, dPred); worst.rmse = Math.max(worst.rmse, e.rmse); worst.csi = Math.min(worst.csi, e.csi);
    let m = 0; for (let k = 0; k < N; k++) if (mask[k]) { if (onPad(k)) worst.pad = Math.max(worst.pad, Math.abs(dPred[m] - dTrue[m])); m++; }
  }
  check('synthetic flood recovered at held-out points', worst.rmse < 0.02 && worst.csi > 0.95, `worst depth RMSE ${(worst.rmse * 100).toFixed(2)} cm, worst CSI ${worst.csi.toFixed(3)}, ${em.field.K} components`);
  check('a design parameter that moves the ground changes the depth on it', worst.pad < 0.05, `worst pad-depth error ${(worst.pad * 100).toFixed(1)} cm`);
  const zc = E.maskOf(ground([0.5, 0.5, 1]), mask), dry = E.depthFrom(E.predict(em, [0.5, 0.5, 1]).wse, zc); let padDry = true, m = 0;
  for (let k = 0; k < N; k++) if (mask[k]) { if (onPad(k) && dry[m] > 0.02) padDry = false; m++; } // the pad's top sits above the 10.4 m lake
  check('depth stops at the ground (a raised pad is dry)', padDry);
  const lvl = E.predict(em, hold[0].u).scalars.level, lvTrue = 10 + 0.8 * hold[0].u[0] + 0.5 * hold[0].u[1] ** 2;
  check('scalar outputs emulated', Math.abs(lvl.mean - lvTrue) < 0.01, `level ${lvl.mean.toFixed(3)} vs ${lvTrue.toFixed(3)} m (±${lvl.sd.toFixed(3)})`);
  const loo = E.looFields(em.field); let looW = 0; runs.forEach((r, i) => { const zm = E.maskOf(ground(r.u), mask); looW = Math.max(looW, E.depthError(E.depthFrom(r.wse, zm), E.depthFrom(loo[i], zm)).rmse); });
  check('leave-one-out fields are close too', looW < 0.05, `worst LOO depth RMSE ${(looW * 100).toFixed(2)} cm`);
  const ls = E.leastSure(em, 3, { n: 300 });
  check('"least sure" point is a new one', ls.u && E.minDistance([...train.map(p => p.u), ls.u]) > 0, `variance ${ls.variance.toExponential(1)}`);
  // save and load
  const { json, blobs } = E.serialize(em), back = E.deserialize(JSON.parse(JSON.stringify(json)), Object.fromEntries(Object.entries(blobs).map(([k, v]) => [k, Float32Array.from(v)])));
  const a = E.predict(em, hold[1].u), b = E.predict(back, hold[1].u); let same = a.wse.every((v, m) => v === b.wse[m]) && a.wseSd.every((v, m) => v === b.wseSd[m]);
  same &&= a.scalars.level.mean === b.scalars.level.mean;
  check('a saved emulator predicts exactly what the trained one did', same);
}

{ // a sloping flood surface that tilts with the parameters, down a valley that slopes the other way (moving fronts)
  const lv = (u, i) => 10.4 + 0.6 * u[0] + 0.3 * u[1] ** 2 - 0.02 * i * (1 + 0.5 * u[0]) + 0.1 * Math.sin(3 * u[1]);
  const zz = z0.map((v, k) => v - 0.015 * (k % nx));
  const wse = (u) => zz.map((v, k) => (lv(u, k % nx) - v > 0.005 ? lv(u, k % nx) : NaN));
  const plan = E.trainingPlan(2, { seed: 6 }), train = plan.filter(p => p.role === 'train'), mask = E.fieldMask(train.map(p => wse(p.u)), nx, ny), zm = E.maskOf(zz, mask);
  const em = E.train(train.map(p => ({ u: p.u, wse: E.fillWse(wse(p.u), zz, mask, nx, ny) })));
  let worst = 0, csi = 1;
  for (const p of plan.filter(q => q.role === 'holdout')) { const e = E.depthError(E.depthFrom(E.fillWse(wse(p.u), zz, mask, nx, ny), zm), E.depthFrom(E.predict(em, p.u).wse, zm)); worst = Math.max(worst, e.rmse); csi = Math.min(csi, e.csi); }
  check('a tilting flood surface with moving fronts', worst < 0.02 && csi > 0.95, `worst depth RMSE ${(worst * 100).toFixed(2)} cm, worst CSI ${csi.toFixed(3)}, ${em.field.K} components`);
}

{ // Atlas 14 return periods between table columns
  const pf = parsePFDS(readFileSync(new URL('./fixtures/atlas14-eastwick-pds-metric.txt', import.meta.url), 'utf8'));
  check('table return periods unchanged', A14_ARI.every((a, c) => Math.abs(ddf(pf, a, 60) - pf.median[4][c]) < 1e-9));
  const aris = [1.5, 2, 3, 5, 7, 10, 17, 25, 40, 50, 75, 100, 150, 200, 350, 500, 700]; const d = aris.map(a => ddf(pf, a, 360));
  check('in between, depth rises with the return period', d.every((v, i) => i === 0 || v > d[i - 1]), `6-hr: ${d.map(v => v.toFixed(0)).join(' ')} mm`);
  const h = hyetograph(pf, { ari: 37, durationMin: 360 });
  check('a design storm at a non-table return period', Math.abs(h.total - ddf(pf, 37, 360)) < 1e-9 && h.total > ddf(pf, 25, 360) && h.total < ddf(pf, 50, 360));
  let threw = false; try { ddf(pf, 2000, 60); } catch { threw = true; }
  check('beyond 1000 yr is refused', threw);
}

console.log(fails ? `\n${fails} FAILED` : '\nall emulator tests passed');
process.exit(fails ? 1 : 0);
