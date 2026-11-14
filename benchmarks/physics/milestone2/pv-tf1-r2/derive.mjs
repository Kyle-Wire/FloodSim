// PV-TF1 revision 2 (PROPOSED, draft 3a): every derived constant of the cycle-averaged reference, from the declared inputs
// and the reference geometry only. No SWMM output and no run-1 result enters this file. Writes derived.json beside it.
//   node benchmarks/physics/milestone2/pv-tf1-r2/derive.mjs
// Draft 3: no scored bound uses modal leakage, the period tolerance eps or the monotone-surface bracket (DERIVATION.md
// sections 3-5). For the scored allowances this file computes only an a-priori WORST CASE at a stated node amplitude
// (feasibility information); at run time each allowance is computed from the recorded state by the formulas declared in
// the spec. The period tolerance, the leakage factor and the physical-profile bounds are kept for diagnostics only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { area, perimeter, topWidth } from '../../references/geometry.mjs';
import { equilibriumDepth } from '../../references/volume.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = 9.81, D = 1.0, L = 400, At = 20, n = 0.013, Vin = 180.0, dt = 1, s = { shape: 'circle', D };
const Ns = [1, 4, 16, 32];
// declared design constants (justified in DERIVATION.md; none is taken from a run)
const K = { closureRel: 0.001, equilibriumAbsM: 0.002, beta: 0.1, M: 8, windows: 3, headTolM: 0.0015, linFrac: 0.01, shiftCount: 8, aPrioriDepthBandM: 0.1, depthGuardFrac: [0.1, 0.9], froudeLimit: 0.5 };

const hEq = equilibriumDepth([{ A: At }, { A: At }], s, L, Vin);
const dWdy = (h) => (D - 2 * h) / Math.sqrt(h * (D - h));          // circle: W = 2 sqrt(h (D - h))
const geo = (h) => { const A = area(s, h), W = topWidth(s, h), P = perimeter(s, h); return { h, A, W, P, R: A / P, yHyd: A / W, c: Math.sqrt(g * A / W), dWdy: dWdy(h) }; };
const G = geo(hEq);

// the lumped linear network that represents the system at resolution N, frictionless, linearised about level h:
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
  const all = B.map((r, i) => ({ w2: r[i], shape: V.map((row, k) => row[i] / Math.sqrt(S[k])) })).sort((a, b) => a.w2 - b.w2);
  const modes = all.filter(x => x.w2 > 1e-12);
  // S-orthogonality of every oscillating mode to the uniform (volume) mode: sum_i S_i phi_mi = 0 (used in DERIVATION 3.3)
  const volumeOfModes = modes.map(x => Math.abs(x.shape.reduce((a, v, i) => a + S[i] * v, 0)) / Math.sqrt(x.shape.reduce((a, v, i) => a + S[i] * v * v, 0) * S.reduce((a, b) => a + b, 0)));
  return { S, Ls, modes: modes.map(x => ({ T: 2 * Math.PI / Math.sqrt(x.w2), shape: x.shape })), maxVolumeCosineOfOscillatingModes: Math.max(...volumeOfModes) };
}
const continuumMode = (h, m) => { const W = topWidth(s, h), A = area(s, h), c = Math.sqrt(g * A / W); let lo = (m - 1) * Math.PI / L + 1e-9, hi = m * Math.PI / L; for (let i = 0; i < 200; i++) { const k = (lo + hi) / 2; if (k * L + 2 * Math.atan(At * k / W) < m * Math.PI) lo = k; else hi = k; } return 2 * Math.PI / (c * (lo + hi) / 2); };
const continuum = (h) => { const W = topWidth(s, h), A = area(s, h), c = Math.sqrt(g * A / W); let lo = 1e-6, hi = Math.PI / L; for (let i = 0; i < 200; i++) { const k = (lo + hi) / 2; if (k * L + 2 * Math.atan(At * k / W) < Math.PI) lo = k; else hi = k; } const k = (lo + hi) / 2; return { T: 2 * Math.PI / (c * k), k, phi: Math.atan(At * k / W) }; };

const out = { draft: '3a', inputs: { g, D, L, At, n, Vin, routingStepS: dt }, constants: K, hEq, geometryAtHeq: G, continuum: continuum(hEq), cases: {} };
out.continuumModePeriodsS = [1, 2, 3].map(m => continuumMode(hEq, m));
// contrast only: a FULL pipe joining the tanks (no free surface in the conduit), the classical U-tube
out.classicalFullPipeUTubePeriodS = 2 * Math.PI / Math.sqrt(g * area(s, D) / L * (2 / At));

const budgetV = K.beta * K.closureRel * Vin;   // m^3: share of the closure criterion the definition sensitivity may use
const budgetH = K.beta * K.equilibriumAbsM;    // m: share of the level criterion the motion allowance may use
const budgetU = K.beta * K.headTolM;           // m: share of the head tolerance the uniformity allowance may use
const WpBand = Math.max(Math.abs(dWdy(hEq - K.aPrioriDepthBandM)), Math.abs(dWdy(hEq + K.aPrioriDepthBandM)));
const Slev = 2 * At + L * G.W;                 // dV_level/dh at h_eq
// G-depth (draft 3a): dW/dy is singular at y = 0 and y = D; the allowances are evaluated only for recorded depths in [0.1 D, 0.9 D]
const WpGuard = Math.max(Math.abs(dWdy(K.depthGuardFrac[0] * D)), Math.abs(dWdy(K.depthGuardFrac[1] * D)));

for (const N of Ns) {
  const lm = lumped(N, hEq), T1 = lm.modes[0].T, Tall = lm.modes.map(m => m.T);
  // ---- period tolerance (diagnostic W3 and the comparability rule only)
  const Tp = lumped(N, hEq + K.equilibriumAbsM).modes[0].T, Tm = lumped(N, hEq - K.equilibriumAbsM).modes[0].T;
  const epsLevel = Math.max(Math.abs(Tp - T1), Math.abs(Tm - T1)) / T1;
  const epsTime = (2 * Math.PI * dt / Tall.at(-1)) ** 2 / 12, epsTime1 = (2 * Math.PI * dt / T1) ** 2 / 12;
  const epsAmp = K.linFrac;
  const aLin = K.linFrac * G.yHyd, vLin = (2 * Math.PI / T1) * aLin * (N === 1 ? (lm.S[0] / G.A) : (G.W * L / 2) / G.A);
  const cf = g * n * n / Math.pow(G.R, 4 / 3), zeta = (8 / (3 * Math.PI)) * cf * vLin / (2 * (2 * Math.PI / T1));
  const epsFric = zeta * zeta / 2, eps = epsLevel + epsTime1 + epsAmp + epsFric, epsDeclared = Math.ceil(eps * 200) / 200;
  const Wsteps = Math.round(K.M * T1 / dt), Wsec = Wsteps * dt, leak = (1 + epsDeclared) / (Math.PI * K.M) * (K.M * T1 / Wsec);
  const sh = lm.modes[0].shape, amax = Math.max(...sh.map(Math.abs)), shN = sh.map(x => x / amax);
  const Sj = lm.S.slice(1, -1).reduce((a, b) => a + b, 0), w1 = 2 * Math.PI / T1;

  // ---- a-priori worst case of the draft-3 allowances at node amplitude a (fundamental shape, max |node amplitude| = a).
  // Reference link equation (lumped St Venant + Manning, DERIVATION.md 4.1):
  //   H_i - H_i+1 = (L_s/(g Abar)) dQ/dt + L_s n^2 Q|Q| / (Abar^2 Rbar^(4/3)) - (1/(g Abar)) [2 L_s v dAbar/dt + v^2 (A_i+1 - A_i)]
  const worst = (a) => { let cum = 0, I = 0, F = 0, C = 0, cfn = 0, frMax = 0;
    for (let i = 0; i < N; i++) {
      cum += lm.S[i] * shN[i] * a;                                   // storage displaced upstream of link i
      const Q = w1 * Math.abs(cum), v = Q / G.A, dAend = G.W * a * Math.abs(shN[i] - shN[i + 1]), dAbarRate = w1 * G.W * a * Math.abs(shN[i] + shN[i + 1]) / 2;
      frMax = Math.max(frMax, v / Math.sqrt(g * G.A / G.W));
      I += (lm.Ls / (g * G.A)) * 2 * Q / Wsec;                       // window ends at opposite phase: the worst case
      F += lm.Ls * n * n * Q * Q / (G.A * G.A * Math.pow(G.R, 4 / 3));
      C += (2 * lm.Ls * v * dAbarRate + v * v * dAend) / (g * G.A);
      cfn += (lm.Ls / 12) * WpBand * (a * Math.abs(shN[i] - shN[i + 1])) ** 2;
    }
    const tauU = 0.5 * (I + F + C), R2 = 0.5 * WpBand * L * a * a;
    return { inertialM: I, frictionM: F, convectiveM: C, tauUM: tauU, EhM: (Sj / Slev) * tauU + R2 / Slev, CfnM3: cfn, R2M3: R2, froudeMax: frMax };
  };
  const allow = (key, lim) => { let lo = 0, hi = 0.5; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (worst(m)[key] <= lim) lo = m; else hi = m; } return lo; };

  // ---- physical-profile sensitivity (reported only)
  const bracketPerAmp = Array.from({ length: N }, (_, i) => lm.Ls * Math.abs(area(s, hEq + 1e-4 * shN[i]) - area(s, hEq + 1e-4 * shN[i + 1])) / 1e-4).reduce((a, b) => a + b, 0);
  const envelopePerAmp = 2 * D * L;                                 // 2 a W_max L_total (W_max = D)
  // ---- comparability with the continuum
  const cont = out.continuum, xs = Array.from({ length: N + 1 }, (_, i) => i * L / N), cshape = xs.map(x => Math.cos(cont.k * x + cont.phi));
  const dot = (a, b) => a.reduce((acc, v, i) => acc + v * b[i], 0), corr = Math.abs(dot(sh, cshape)) / Math.sqrt(dot(sh, sh) * dot(cshape, cshape));

  out.cases[`N${N}`] = {
    N, segmentLengthM: lm.Ls, nodeSurfaceAreasM2: lm.S.map(x => +x.toFixed(4)), junctionStorageM2: Sj, levelStorageM2: Slev,
    referencePeriodS: T1, referenceKind: N === 1 ? 'two-node lumped (rigid conduit column between two lumped storages: tank + half the conduit surface each)' : 'fundamental of the lumped network (N + 1 nodes)',
    modePeriodsS: Tall.slice(0, Math.min(6, Tall.length)), modeCount: Tall.length,
    oscillatingModesCarryNoLinearVolume: { maxCosineWithUniformMode: lm.maxVolumeCosineOfOscillatingModes, note: 'sum_i S_i phi_mi = 0 for every oscillating mode of the reference network' },
    fundamentalVsContinuum: { relPeriodDiff: (T1 - cont.T) / cont.T, nodeShapeCorrelation: corr },
    modes123VsContinuum: out.continuumModePeriodsS.map((Tc, i) => (Tall[i] != null ? (Tall[i] - Tc) / Tc : null)),
    dynamicallyComparableToContinuumWithin2eps: out.continuumModePeriodsS.map((Tc, i) => (Tall[i] != null ? Math.abs(Tall[i] - Tc) / Tc <= 2 * epsDeclared : false)),
    periodTolerance: {
      status: 'a declared TOLERANCE for the W3 diagnostic and the comparability rule; not an a-priori uncertainty bound; no scored bound uses it',
      level: { value: epsLevel, kind: 'computed: lumped model re-solved at h_eq +- 2 mm' },
      amplitude: { value: epsAmp, kind: 'scaling estimate: O(a / y_hyd), coefficient 1 not derived' },
      timeDiscretisationFundamental: { value: epsTime1, kind: 'UNBOUNDED ESTIMATE: (w dt)^2/12 of a generic one-step scheme; SWMM EXTRAN (Picard iteration with under-relaxation 0.5, trapezoidal node continuity, backward-Euler link momentum) is not analysed' },
      timeDiscretisationHighestMode: { value: epsTime, kind: 'unbounded estimate, as above' },
      friction: { value: epsFric, kind: 'computed under linearisation at a_lin' },
      sum: eps, declared: epsDeclared, combination: 'linear sum of the four values, rounded up to the next 0.5 %',
    },
    window: { M: K.M, steps: Wsteps, seconds: Wsec, scoredWindows: K.windows, totalSeconds: K.windows * Wsec, leakageFactorDiagnosticOnly: leak,
      why: 'M reference periods put the window ends nearly in phase, which keeps the computed inertial term small; no validity condition depends on the period' },
    budgets: {
      definitionSensitivityM3: budgetV, levelMotionAllowanceM: budgetH, uniformityMotionAllowanceM: budgetU,
      worstCaseAtLinearityAmplitude: worst(aLin), linearityAmplitudeM: aLin,
      aPrioriAmplitudeForLevelRowM: allow('EhM', budgetH), aPrioriAmplitudeForUniformityRowM: allow('tauUM', budgetU), aPrioriAmplitudeForBooksM: allow('CfnM3', budgetV),
      maxAbsDWdyInAPrioriBandPerM: WpBand, maxAbsDWdyOnDepthGuardPerM: WpGuard,
      levelNote: 'EhM a priori uses tau_U for the junction mean deviations, i.e. assumes r_s = 0; at run time E8 uses the measured redistribution and needs no assumption',
      note: 'worst case: window ends at opposite phase, friction and convection at their amplitude maxima; at run time the terms are computed from the record and are smaller for a decaying oscillation averaged over whole periods',
    },
    physicalProfileSensitivity: { reportedOnly: true, envelopeBoundPerUnitAmplitudeM2: envelopePerAmp, envelopeAmplitudeForBudgetM: budgetV / envelopePerAmp,
      monotoneBracketPerUnitFundamentalAmplitudeM2: bracketPerAmp, monotoneBracketAmplitudeForBudgetM: budgetV / (bracketPerAmp * 2 / Math.PI) },
  };
}
out.secondOrder = {
  draft2C2Superseded: { formula: '0.5 |dW/dy| a^2 L', valueAtLinearityAmplitudeM3: 0.5 * Math.abs(G.dWdy) * (K.linFrac * G.yHyd) ** 2 * L,
    why: 'assumed that the internal deviation from the linear surface is at most a; not proved (technical review of draft 2, item 2); no longer used' },
  definitionSensitivity: 'C_fn = (1/12) max|dW/dy| sum_s L_s (y_i - y_i+1)^2: bounds the difference between the linear-surface volume (the reference) and the trapezoidal (1/12) or midpoint (1/24) volume of the same node depths',
  levelRemainder: 'R2 = 0.5 max|dW/dy| sum_s L_s max(u_i^2, u_i+1^2), u_i = y_i - tank-mean level: Taylor remainder of the representation volume about the level state',
  maxAbsDWdyAtHeqPerM: Math.abs(G.dWdy), depthGuard: { fracOfD: K.depthGuardFrac, maxAbsDWdyPerM: WpGuard, rule: 'outside it, C_fn and the R2 bound are not evaluated: IR-definition' }, froudeLimit: K.froudeLimit, maxAbsDWdyInAPrioriBandPerM: WpBand, aPrioriDepthBandM: K.aPrioriDepthBandM,
};
fs.writeFileSync(path.join(here, 'derived.json'), JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toPrecision(7) : v), 1) + '\n');
for (const [id, c] of Object.entries(out.cases)) console.log(id, 'Tref', c.referencePeriodS.toFixed(1), 'vsCont', (c.fundamentalVsContinuum.relPeriodDiff * 100).toFixed(2) + '%', 'volCos', c.oscillatingModesCarryNoLinearVolume.maxCosineWithUniformMode.toExponential(1),
  '| eps', c.periodTolerance.sum.toPrecision(3), '->', c.periodTolerance.declared, '| W', c.window.seconds, 's',
  '| worst@aLin', JSON.stringify(Object.fromEntries(Object.entries(c.budgets.worstCaseAtLinearityAmplitude).map(([k, v]) => [k, +v.toPrecision(2)]))),
  '| a-priori amplitude: level', (c.budgets.aPrioriAmplitudeForLevelRowM * 1000).toFixed(2), 'mm, uniformity', (c.budgets.aPrioriAmplitudeForUniformityRowM * 1000).toFixed(2), 'mm, books', (c.budgets.aPrioriAmplitudeForBooksM * 1000).toFixed(0), 'mm',
  '| physical: envelope a', (c.physicalProfileSensitivity.envelopeAmplitudeForBudgetM * 1e6).toFixed(1), 'um, monotone a', (c.physicalProfileSensitivity.monotoneBracketAmplitudeForBudgetM * 1e6).toFixed(1), 'um');
console.log('hEq', hEq, 'continuum T', out.continuum.T, 'U-tube', out.classicalFullPipeUTubePeriodS, '|dW/dy| band', WpBand);
