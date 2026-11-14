// DRAFT 2 COPY, preserved for the draft-3 change log. Identical to the draft-2 derive.mjs except the two import paths,
// which point from this folder. Superseded by ../../derive.mjs (draft 3). Writes derived.json beside this file.
// PV-TF1 revision 2 (PROPOSED): every derived constant of the cycle-averaged reference, from the declared inputs and the
// reference geometry only. No SWMM output and no run-1 result enters this file. Writes derived.json beside it.
//   node benchmarks/physics/milestone2/pv-tf1-r2/derive.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { area, perimeter, topWidth } from '../../../../references/geometry.mjs';
import { equilibriumDepth } from '../../../../references/volume.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = 9.81, D = 1.0, L = 400, At = 20, n = 0.013, Vin = 180.0, dt = 1, s = { shape: 'circle', D };
const Ns = [1, 4, 16, 32];
// declared design constants (justified in DERIVATION.md; none is taken from a run)
const K = { closureRel: 0.001, equilibriumAbsM: 0.002, beta: 0.1, M: 8, windows: 3, headTolM: 0.0015, linFrac: 0.01, shiftCount: 8 };

const hEq = equilibriumDepth([{ A: At }, { A: At }], s, L, Vin);
const geo = (h) => { const A = area(s, h), W = topWidth(s, h), P = perimeter(s, h); return { h, A, W, P, R: A / P, yHyd: A / W, c: Math.sqrt(g * A / W), dWdy: (D - 2 * h) / Math.sqrt(h * (D - h)) }; };
const G = geo(hEq);

// the lumped linear network SWMM's dynamic-wave scheme represents, frictionless, linearised about level h:
// node surface area = tank area + half of each joined conduit's top width x length; link inertance L_s / (g A)
function lumped(N, h) {
  const Ls = L / N, W = topWidth(s, h), A = area(s, h), m = N + 1, S = Array.from({ length: m }, (_, i) => (i === 0 || i === m - 1 ? At : 0) + W * Ls * ((i > 0) + (i < m - 1)) / 2);
  const kc = g * A / Ls, Kmat = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < N; i++) { Kmat[i][i] += kc; Kmat[i + 1][i + 1] += kc; Kmat[i][i + 1] -= kc; Kmat[i + 1][i] -= kc; }
  const B = Kmat.map((r, i) => r.map((v, j) => v / Math.sqrt(S[i] * S[j]))), V = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => +(i === j)));
  for (let sw = 0; sw < 200; sw++) { let off = 0; for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) off += B[p][q] ** 2; if (off < 1e-30) break;
    for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) { if (Math.abs(B[p][q]) < 1e-300) continue; const th = 0.5 * Math.atan2(2 * B[p][q], B[q][q] - B[p][p]), c = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < m; k++) { const a = B[k][p], b = B[k][q]; B[k][p] = c * a - sn * b; B[k][q] = sn * a + c * b; }
      for (let k = 0; k < m; k++) { const a = B[p][k], b = B[q][k]; B[p][k] = c * a - sn * b; B[q][k] = sn * a + c * b; }
      for (let k = 0; k < m; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - sn * b; V[k][q] = sn * a + c * b; } } }
  const modes = B.map((r, i) => ({ w2: r[i], shape: V.map((row, k) => row[i] / Math.sqrt(S[k])) })).filter(x => x.w2 > 1e-12).sort((a, b) => a.w2 - b.w2);
  return { S, Ls, modes: modes.map(x => ({ T: 2 * Math.PI / Math.sqrt(x.w2), shape: x.shape })) };
}
const continuumMode = (h, m) => { const W = topWidth(s, h), A = area(s, h), c = Math.sqrt(g * A / W); let lo = (m - 1) * Math.PI / L + 1e-9, hi = m * Math.PI / L; for (let i = 0; i < 200; i++) { const k = (lo + hi) / 2; if (k * L + 2 * Math.atan(At * k / W) < m * Math.PI) lo = k; else hi = k; } return 2 * Math.PI / (c * (lo + hi) / 2); };
const continuum = (h) => { const W = topWidth(s, h), A = area(s, h), c = Math.sqrt(g * A / W); let lo = 1e-6, hi = Math.PI / L; for (let i = 0; i < 200; i++) { const k = (lo + hi) / 2; if (k * L + 2 * Math.atan(At * k / W) < Math.PI) lo = k; else hi = k; } const k = (lo + hi) / 2; return { T: 2 * Math.PI / (c * k), k, phi: Math.atan(At * k / W) }; };

const out = { inputs: { g, D, L, At, n, Vin, routingStepS: dt }, constants: K, hEq, geometryAtHeq: G, continuum: continuum(hEq), cases: {} };
// contrast only: a FULL pipe joining the tanks (no free surface in the conduit), the classical rigid-column U-tube
out.continuumModePeriodsS = [1, 2, 3].map(m => continuumMode(hEq, m));
out.classicalFullPipeUTubePeriodS = 2 * Math.PI / Math.sqrt(g * area(s, D) / L * (2 / At));

for (const N of Ns) {
  const lm = lumped(N, hEq), T1 = lm.modes[0].T, Tall = lm.modes.map(m => m.T);
  // period sensitivity to the mean level, over the equilibrium tolerance (+-2 mm)
  const Tp = lumped(N, hEq + K.equilibriumAbsM).modes[0].T, Tm = lumped(N, hEq - K.equilibriumAbsM).modes[0].T;
  const epsLevel = Math.max(Math.abs(Tp - T1), Math.abs(Tm - T1)) / T1;
  // time discretisation: an implicit one-step scheme's phase error is O((w dt)^2); bound (w dt)^2 / 12 (stated, not assumed exact)
  const epsTime = (2 * Math.PI * dt / Tall.at(-1)) ** 2 / 12;      // worst at the highest mode; the fundamental's is far smaller
  const epsTime1 = (2 * Math.PI * dt / T1) ** 2 / 12;
  // amplitude nonlinearity: O(a / yHyd), held to linFrac by the linearity bound
  const epsAmp = K.linFrac;
  // friction: the damped frequency w sqrt(1 - zeta^2); zeta from Manning linearised at the linearity bound velocity
  const aLin = K.linFrac * G.yHyd, vLin = (2 * Math.PI / T1) * aLin * (N === 1 ? (lm.S[0] / G.A) : (G.W * L / 2) / G.A) / (N === 1 ? 1 : 1);
  const cf = g * n * n / Math.pow(G.R, 4 / 3), zeta = (8 / (3 * Math.PI)) * cf * vLin / (2 * (2 * Math.PI / T1));
  const epsFric = zeta * zeta / 2;
  const eps = epsLevel + epsTime1 + epsAmp + epsFric;
  const epsDeclared = Math.ceil(eps * 200) / 200; // rounded up to 0.5 %
  const Tref = T1, Wsteps = Math.round(K.M * Tref / dt), Wsec = Wsteps * dt, leak = (1 + epsDeclared) / (Math.PI * K.M) * (K.M * Tref / Wsec);
  // the F4 monotone-surface bracket per unit amplitude of the fundamental (illustration of what the bound means per N)
  const sh = lm.modes[0].shape, amax = Math.max(...sh.map(Math.abs));
  const bracketPerAmp = Array.from({ length: N }, (_, i) => lm.Ls * Math.abs(area(s, hEq + 1e-4 * sh[i] / amax) - area(s, hEq + 1e-4 * sh[i + 1] / amax)) / 1e-4).reduce((a, b) => a + b, 0);
  const budgetV = K.beta * K.closureRel * Vin;               // m^3 available to residual motion in the closure
  const bracketAllow = budgetV / leak;                        // m^3: largest oscillating bracket the bound admits
  const levelAllowA = K.beta * K.equilibriumAbsM / leak;      // m: largest tank-level amplitude the level row admits
  // comparability with the continuum fundamental (shape correlation at the nodes) for the N trend
  const cont = out.continuum, xs = Array.from({ length: N + 1 }, (_, i) => i * L / N), cshape = xs.map(x => Math.cos(cont.k * x + cont.phi));
  const dot = (a, b) => a.reduce((acc, v, i) => acc + v * b[i], 0), corr = Math.abs(dot(sh, cshape)) / Math.sqrt(dot(sh, sh) * dot(cshape, cshape));
  out.cases[`N${N}`] = {
    N, segmentLengthM: lm.Ls, nodeSurfaceAreasM2: lm.S.map(x => +x.toFixed(4)),
    referencePeriodS: Tref, referenceKind: N === 1 ? 'two-node lumped (rigid conduit column between two lumped storages: tank + half the conduit surface each); SWMM\'s N = 1 representation' : 'fundamental of the lumped network (N + 1 nodes)',
    modePeriodsS: Tall.slice(0, Math.min(6, Tall.length)), thetaRssPeriodsS: Math.sqrt(Tall.reduce((a, T) => a + T * T, 0)),
    fundamentalVsContinuum: { relPeriodDiff: (T1 - cont.T) / cont.T, nodeShapeCorrelation: corr },
    modes123VsContinuum: out.continuumModePeriodsS.map((Tc, i) => (Tall[i] != null ? (Tall[i] - Tc) / Tc : null)),
    dynamicallyComparableToContinuumWithin2eps: out.continuumModePeriodsS.map((Tc, i) => (Tall[i] != null ? Math.abs(Tall[i] - Tc) / Tc <= 2 * epsDeclared : false)),
    eps: { level: epsLevel, timeDiscretisationFundamental: epsTime1, timeDiscretisationHighestMode: epsTime, amplitude: epsAmp, friction: epsFric, sum: eps, declared: epsDeclared },
    window: { M: K.M, steps: Wsteps, seconds: Wsec, scoredWindows: K.windows, totalSeconds: K.windows * Wsec, leakageFactor: leak },
    budgets: { residualMotionVolumeM3: budgetV, oscillatingBracketAllowM3: bracketAllow, tankAmplitudeAllowForLevelRowM: levelAllowA,
      linearityAmplitudeM: aLin, bracketPerUnitFundamentalAmplitudeM2: bracketPerAmp, impliedFundamentalAmplitudeAllowM: Math.min(aLin, bracketAllow / bracketPerAmp) },
  };
}
out.secondOrder = {
  curvatureOfAreaPerM2: 0.5 * Math.abs(G.dWdy),
  note: 'the conduit area is evaluated at the recorded node depths and integrated exactly over a linear surface, so the curvature of A(y) enters only through the unknown profile between nodes: bounded by 0.5 |dW/dy| a^2 L',
  curvatureBoundAtLinearityAmplitudeM3: 0.5 * Math.abs(G.dWdy) * (K.linFrac * G.yHyd) ** 2 * L,
  setupPerVelocity: 'v^2 / (2 g): the mean set-down of a moving surface; at 0.05 m/s it is 1.3e-4 m',
};
fs.writeFileSync(path.join(here, 'derived.json'), JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toPrecision(7) : v), 1));
