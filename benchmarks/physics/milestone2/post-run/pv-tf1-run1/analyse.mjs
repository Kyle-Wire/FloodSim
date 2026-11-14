// Post-run analysis of the first PV-TF1 run (results/2026-11-12T15-00-21-588Z). UNSCORED. Reads the registered raw
// per-step outputs only (read-only); nothing is rerun, no SWMM is loaded, no status of the original run is changed.
//   A  the artificial (WARNING 04) slope: its value per N, and whether SWMM's normal-flow limiter, the only routing
//      calculation it enters here, could have acted at any step (from the recorded depths and flows)
//   B  the oscillation still present at 12 h: period, per-cycle envelopes, decay fits, and an independent linear
//      eigen-period of the lumped network, for comparison
// Writes analysis.json beside this file. Fitted values are extrapolations and are labelled as such.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { area, perimeter, topWidth } from '../../../references/geometry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.resolve(here, '../../../results/2026-11-12T15-00-21-588Z');
const spec = JSON.parse(fs.readFileSync(path.resolve(here, '../../../spec/PV-TF1.json')));
const P = spec.parameters, C = spec.criteria, D = P.pipeDiameter.value, n = P.manningN.value, g = 9.81, At = P.tankArea.value, Ltot = P.pipeLength.value;
const s0 = { shape: 'circle', D };
const FT = 0.3048, FUDGE = 0.0001 * FT, CFS = FT ** 3, Q_REVERSAL = 0.001 * CFS; // dwflow.c: q = 0.001 * SGN(q) (cfs)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export function load(caseId) {
  const hdr = JSON.parse(fs.readFileSync(path.join(RUN, `PV-TF1-raw-${caseId}.json`)));
  const gz = fs.readFileSync(path.join(RUN, `PV-TF1-raw-${caseId}.f64.gz`));
  if (sha(gz) !== hdr.gzSha256) throw new Error(`${caseId}: raw file hash does not match its header`);
  const buf = zlib.gunzipSync(gz), M = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const nc = hdr.columns.length, col = Object.fromEntries(hdr.columns.map((c, j) => [c, j]));
  const series = (c) => { const j = col[c], out = new Float64Array(hdr.rows); for (let s = 0; s < hdr.rows; s++) out[s] = M[s * nc + j]; return out; };
  return { hdr, rows: hdr.rows, series, gzSha256: hdr.gzSha256 };
}

// ---------- A: the nominal slope and the normal-flow limiter ----------
const nominalSlope = (Lm) => { const Lft = Lm / FT; return 0.001 / Math.sqrt(Lft * Lft - 1e-6); };
const qNormal = (y, S) => { const a = area(s0, y), r = a / perimeter(s0, y); return (1 / n) * a * Math.pow(r, 2 / 3) * Math.sqrt(S); }; // dwflow.c 678, SI
const froude = (q, y) => { const a = area(s0, y), w = topWidth(s0, y); return y <= FUDGE || D - y <= FUDGE || w <= 0 ? 0 : Math.abs(q / a) / Math.sqrt(g * a / w); }; // link.c 847-871

function limiter(r, N) {
  const cond = r.hdr.network.conduits, T = r.series('t'), S = nominalSlope(Ltot / N);
  const phases = { fill_0_2h: (t) => t <= 7200, after_2h: (t) => t > 7200, restWindow: (t) => t > P.durationS.value - C.restWindowS };
  const out = { segmentLengthM: Ltot / N, nominalSlope: S, nominalDropPerSegmentMm: 0.001 * FT * 1000, cumulativeNominalDropMm: N * 0.001 * FT * 1000,
    qNormalAtReferenceLevelM3s: qNormal(P.referenceLevel.value, S), byPhase: {} };
  for (const k of Object.keys(phases)) out.byPhase[k] = { conduitSteps: 0, checkTriggered: 0, triggeredAndAtOrAboveCap98: 0, maxRatioWhenTriggered: 0, maxRatioWhenTriggeredAt: null };
  for (const c of cond) {
    const Q = r.series(`${c.id}.flow`), d1 = r.series(`${c.node1}.depth`), d2 = r.series(`${c.node2}.depth`);
    for (let s = 0; s < r.rows; s++) {
      const t = T[s], q = Q[s]; let y1 = Math.min(Math.max(d1[s], FUDGE), D), y2 = Math.min(Math.max(d2[s], FUDGE), D);
      // dwflow.c 250-259: only q > 0, y1 below full, both ends wet (approximates the SUBCRITICAL/SUPCRITICAL class
      // requirement: the DRY / UP_DRY / DN_DRY classes are excluded); 661-674: y1 < y2, or Fr >= 1 at the upstream end
      const wet = d1[s] > FUDGE && d2[s] > FUDGE;
      const trig = q > 0 && y1 < D && wet && (y1 < y2 || froude(q, y1) >= 1);
      const ratio = trig ? q / qNormal(y1, S) : 0;
      for (const [k, f] of Object.entries(phases)) { if (!f(t)) continue; const b = out.byPhase[k]; b.conduitSteps++;
        if (trig) { b.checkTriggered++; if (ratio >= 0.98) b.triggeredAndAtOrAboveCap98++; if (ratio > b.maxRatioWhenTriggered) { b.maxRatioWhenTriggered = ratio; b.maxRatioWhenTriggeredAt = { conduit: c.id, t, q, qNormal: q / ratio } } } }
    }
  }
  return out;
}

// ---------- B: oscillation ----------
function crossings(T, x, t0) { const up = []; for (let s = 1; s < x.length; s++) if (T[s] > t0 && x[s - 1] < 0 && x[s] >= 0) up.push(T[s - 1] + (T[s] - T[s - 1]) * (-x[s - 1]) / (x[s] - x[s - 1])); return up; }
/** per-cycle maximum of |x| between successive up-crossings */
function envelope(T, x, ups) { const env = []; let s = 0; for (let k = 0; k + 1 < ups.length; k++) { let m = 0; while (s < T.length && T[s] < ups[k]) s++; let j = s; while (j < T.length && T[j] < ups[k + 1]) { m = Math.max(m, Math.abs(x[j])); j++; } env.push([0.5 * (ups[k] + ups[k + 1]), m]); } return env; }
/** dominant period by a direct DFT over a window, periods 60-3000 s */
function dft(T, x, t0, t1) {
  const idx = []; for (let s = 0; s < T.length; s++) if (T[s] > t0 && T[s] <= t1) idx.push(s);
  const mean = idx.reduce((a, s) => a + x[s], 0) / idx.length; let best = { P: 0, pow: -1 }; const spec = [];
  for (let Pp = 60; Pp <= 3000; Pp *= 1.002) { const w = 2 * Math.PI / Pp; let c = 0, si = 0; for (const s of idx) { const v = x[s] - mean; c += v * Math.cos(w * T[s]); si += v * Math.sin(w * T[s]); } const pw = c * c + si * si; spec.push([Pp, pw]); if (pw > best.pow) best = { P: Pp, pow: pw }; }
  const second = spec.filter(([Pp]) => Math.abs(Math.log(Pp / best.P)) > 0.15).reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
  return { periodS: best.P, secondPeakPeriodS: second[0], secondToFirstPowerRatio: second[1] / best.pow };
}
/** fits on the envelope after tFit: exponential (ln A linear in t) and quadratic-friction (1/A linear in t) */
function fits(env, tFit) {
  const pts = env.filter(([t, a]) => t > tFit && a > 0); if (pts.length < 4) return null;
  const lin = (xs, ys) => { const m = xs.length, mx = xs.reduce((a, b) => a + b) / m, my = ys.reduce((a, b) => a + b) / m; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < m; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } const b = sxy / sxx; return { a: my - b * mx, b, r2: sxy * sxy / (sxx * syy) }; };
  const t = pts.map(p => p[0]), A = pts.map(p => p[1]);
  const e = lin(t, A.map(Math.log)), h = lin(t, A.map(a => 1 / a));
  // residuals of each model in log space (comparable)
  const rmsLog = (f) => Math.sqrt(pts.reduce((s, [tt, a]) => { const m = f(tt); return s + (m > 0 ? Math.log(a / m) ** 2 : 99); }, 0) / pts.length);
  return { window: [t[0], t.at(-1)], cycles: pts.length,
    exponential: { rate1PerS: -e.b, eFoldingS: -1 / e.b, r2LogSpace: e.r2, rmsLogResidual: rmsLog(tt => Math.exp(e.a + e.b * tt)) },
    quadraticFriction: { slopeOf1OverA: h.b, intercept: h.a, r2: h.r2, rmsLogResidual: rmsLog(tt => 1 / (h.a + h.b * tt)) },
    timeTo: (thr) => ({ exponentialS: e.b < 0 ? (Math.log(thr) - e.a) / e.b : null, quadraticFrictionS: h.b > 0 ? (1 / thr - h.a) / h.b : null }) };
}

// independent linear reference: the lumped network SWMM solves, linearised at rest, no friction. Node surface areas:
// tank area + half of each joined conduit's top width x length; junction: the halves of both conduits (dynwave.c
// surface-area rule); link inertance L / (g A). Eigen-periods by Jacobi on the symmetrised matrix.
function lumpedPeriods(N, h) {
  const Ls = Ltot / N, W = topWidth(s0, h), A = area(s0, h), m = N + 1, S = new Array(m).fill(0);
  for (let i = 0; i < m; i++) S[i] = (i === 0 || i === m - 1 ? At : 0) + W * Ls * ((i > 0) + (i < m - 1)) / 2;
  const kc = g * A / Ls; const K = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < N; i++) { K[i][i] += kc; K[i + 1][i + 1] += kc; K[i][i + 1] -= kc; K[i + 1][i] -= kc; }
  const B = K.map((r, i) => r.map((v, j) => v / Math.sqrt(S[i] * S[j])));
  for (let sweep = 0; sweep < 100; sweep++) { let off = 0; for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) off += B[p][q] ** 2; if (off < 1e-30) break;
    for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) { if (Math.abs(B[p][q]) < 1e-300) continue; const th = 0.5 * Math.atan2(2 * B[p][q], B[q][q] - B[p][p]), c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < m; k++) { const bkp = B[k][p], bkq = B[k][q]; B[k][p] = c * bkp - s * bkq; B[k][q] = s * bkp + c * bkq; }
      for (let k = 0; k < m; k++) { const bpk = B[p][k], bqk = B[q][k]; B[p][k] = c * bpk - s * bqk; B[q][k] = s * bpk + c * bqk; } } }
  const w2 = B.map((r, i) => r[i]).filter(v => v > 1e-12).sort((a, b) => a - b);
  return w2.slice(0, 3).map(v => 2 * Math.PI / Math.sqrt(v));
}
/** the continuum channel with end tanks, linear and frictionless: kL + 2 atan(At k / W) = pi */
function continuumPeriod(h) { const W = topWidth(s0, h), A = area(s0, h), c = Math.sqrt(g * A / W); let lo = 1e-6, hi = Math.PI / Ltot; for (let i = 0; i < 200; i++) { const k = (lo + hi) / 2; if (k * Ltot + 2 * Math.atan(At * k / W) < Math.PI) lo = k; else hi = k; } return 2 * Math.PI / (c * (lo + hi) / 2); }

function analyseCase(caseId, N) {
  const r = load(caseId), T = r.series('t'), h1 = r.series('T1.head'), h2 = r.series('T2.head');
  const dH = h1.map((v, i) => v - h2[i]), cond = r.hdr.network.conduits, juncs = r.hdr.network.nodes.filter(x => x.id.startsWith('J')).map(x => x.id).sort((a, b) => +a.slice(1) - +b.slice(1));
  const mid = cond[Math.floor(N / 2)]?.id ?? 'C1', Qmid = r.series(`${mid}.flow`);
  // max |Q| over every segment, and max internal WSE deviation from the tank mean, per step
  const Qmax = new Float64Array(r.rows), wseDev = new Float64Array(r.rows), reversalSteps = { all: 0, restWindow: 0 }; let minNonzeroAbsQ = Infinity;
  for (const c of cond) { const Q = r.series(`${c.id}.flow`); for (let s = 0; s < r.rows; s++) { const a = Math.abs(Q[s]); if (a > Qmax[s]) Qmax[s] = a; if (a > 0 && a < minNonzeroAbsQ) minNonzeroAbsQ = a; if (Math.abs(a - Q_REVERSAL) < 1e-12) { reversalSteps.all++; if (T[s] > P.durationS.value - C.restWindowS) reversalSteps.restWindow++; } } }
  for (const j of juncs) { const H = r.series(`${j}.head`); for (let s = 0; s < r.rows; s++) wseDev[s] = Math.max(wseDev[s], Math.abs(H[s] - 0.5 * (h1[s] + h2[s]))); }
  const t0 = 3600;
  const ups = crossings(T, dH, t0), periods = ups.slice(1).map((u, i) => u - ups[i]);
  const winStats = (a, b) => { const p = periods.filter((_, i) => ups[i] > a && ups[i + 1] <= b).sort((x, y) => x - y); return p.length ? { cycles: p.length, medianS: p[Math.floor(p.length / 2)], minS: p[0], maxS: p.at(-1) } : null; };
  const envDH = envelope(T, dH, ups), envQ = envelope(T, Qmax, ups), envW = juncs.length ? envelope(T, wseDev, ups) : [], envQmid = envelope(T, Qmid, ups);
  const fDH = fits(envDH, 7200), fQ = fits(envQ, 7200), fW = juncs.length ? fits(envW, 7200) : null;
  const fDHlate = fits(envDH.filter(([t]) => t > 25200), 25200), fQlate = fits(envQ.filter(([t]) => t > 25200), 25200);
  const at = (env, t) => env.reduce((b, p) => (Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b), env[0]);
  const thresholds = { levelDiff: C.restLevelDiffM, segmentFlow: C.restSegmentFlowAbsM3s, internalWse: C.restInternalWseAbsM };
  const timeTo = { levelDiff: fDH?.timeTo(thresholds.levelDiff), segmentFlow: fQ?.timeTo(thresholds.segmentFlow), internalWse: fW?.timeTo(thresholds.internalWse) };
  const strip = (f) => (f ? { window: f.window, cycles: f.cycles, exponential: f.exponential, quadraticFriction: f.quadraticFriction } : null);
  return {
    caseId, N, rows: r.rows, gzSha256: r.gzSha256, midSegment: mid,
    period: { zeroCrossingTankDifference: { h1_4: winStats(3600, 14400), h4_8: winStats(14400, 28800), h8_12: winStats(28800, 43200) },
      dftTankDifference_h6_12: dft(T, dH, 21600, 43200), dftMidSegmentFlow_h6_12: dft(T, Qmid, 21600, 43200) },
    envelopeAt: Object.fromEntries([3, 6, 9, 11.5].map(h => [`${h}h`, { tankDiffM: at(envDH, h * 3600)[1], maxSegmentFlowM3s: at(envQ, h * 3600)[1], maxJunctionWseDevM: envW.length ? at(envW, h * 3600)[1] : null }])),
    fits: { tankDiff_after2h: strip(fDH), maxSegmentFlow_after2h: strip(fQ), maxJunctionWse_after2h: strip(fW), tankDiff_after7h: strip(fDHlate), maxSegmentFlow_after7h: strip(fQlate) },
    extrapolatedTimeToThresholdS: timeTo,
    reversalFloor: { qReversalM3s: Q_REVERSAL, stepsAtReversalValue: reversalSteps, minNonzeroAbsQ },
    envelopes: { tankDiff: envDH, maxSegmentFlow: envQ, maxJunctionWse: envW, midSegmentFlow: envQmid },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
function main() {
const out = { source: path.relative(path.resolve(here, '../../../../..'), RUN).replace(/\\/g, '/'), written: new Date().toISOString(), unscored: true,
  references: { continuumPeriodS: continuumPeriod(P.referenceLevel.value), rigidColumnTwoNodePeriodS_N1: lumpedPeriods(1, P.referenceLevel.value)[0] }, cases: {} };
for (const N of P.segments.value) for (const v of ['', '-dt0.5', '-inertialNONE', '-msa0.1']) {
  const id = `N${N}${v}`; const a = analyseCase(id, N);
  if (!v) { const r = load(id); a.limiter = limiter(r, N); }
  a.lumpedLinearPeriodsS = lumpedPeriods(N, P.referenceLevel.value);
  out.cases[id] = a;
  const z = a.period.zeroCrossingTankDifference;
  console.log(id.padEnd(16), 'T(zc 8-12h)', z.h8_12?.medianS?.toFixed(1), 'T(dft)', a.period.dftTankDifference_h6_12.periodS.toFixed(1), 'lumped', a.lumpedLinearPeriodsS.map(x => x.toFixed(1)).join('/'),
    '| env dH 3h/11.5h', (a.envelopeAt['3h'].tankDiffM * 1e3).toFixed(2), (a.envelopeAt['11.5h'].tankDiffM * 1e3).toFixed(2), 'mm',
    '| Q 3h/11.5h', a.envelopeAt['3h'].maxSegmentFlowM3s.toExponential(2), a.envelopeAt['11.5h'].maxSegmentFlowM3s.toExponential(2),
    '| exp efold dH', a.fits.tankDiff_after2h?.exponential.eFoldingS.toFixed(0), 'r2', a.fits.tankDiff_after2h?.exponential.r2LogSpace.toFixed(3), 'hyp r2', a.fits.tankDiff_after2h?.quadraticFriction.r2.toFixed(3),
    '| rev', a.reversalFloor.stepsAtReversalValue.all, a.reversalFloor.stepsAtReversalValue.restWindow);
}
console.log('continuum', out.references.continuumPeriodS.toFixed(1));
fs.writeFileSync(path.join(here, 'analysis.json'), JSON.stringify(out, (k, v) => (typeof v === 'number' ? +v.toPrecision(8) : v), 1));
}
