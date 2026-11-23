// Cascade tests: the router sends out-of-range, novel and unsure requests to the solver and answers the rest; the
// calibration factor makes ±2σ hold about 95 % of real errors on unseen runs; a solver answer added to the training set
// makes the emulator surer there. Synthetic floods with a known answer, no solver runs (fast).
// Usage: node tests/run-cascade-tests.mjs
import * as E from '../src/emulator.js';
import * as C from '../src/cascade.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// a tilted pond whose level and tilt depend on two parameters, on a 40 × 30 grid with a bowl-shaped ground
const nx = 40, ny = 30, N = nx * ny, z = new Float32Array(N);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 10 + 0.002 * ((i - 20) ** 2 + (j - 15) ** 2);
const truthWse = ([a, b]) => { const w = new Float32Array(N); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i, l = 10.2 + 0.5 * a + 0.3 * Math.sin(3 * b) + 0.004 * (i - 20) * (b - 0.5); w[k] = l > z[k] + 0.005 ? l : NaN; } return w; };
const plan = E.trainingPlan(2, { n: 14, seed: 4 }), train = plan.filter(p => p.role === 'train');
const mask = E.fieldMask(train.map(p => truthWse(p.u)), nx, ny), zm = E.maskOf(z, mask);
const run = (u) => ({ u, wse: E.fillWse(truthWse(u), z, mask, nx, ny), scalars: { peak: 0.5 * u[0] + 0.3 * Math.sin(3 * u[1]) } });
const truthDepth = (u) => E.depthFrom(E.fillWse(truthWse(u), z, mask, nx, ny), zm);
let em = E.train(train.map(p => run(p.u)));
const r0 = E.rng(17), checks = Array.from({ length: 12 }, () => { const u = [r0(), r0()]; return { u, zm, depth: truthDepth(u), scalars: { peak: run(u).scalars.peak } }; });

{ // calibration
  const cal = C.calibrate(em, checks);
  check('calibration factor is at least 1 and finite', cal.k >= 1 && Number.isFinite(cal.k), `k = ${cal.k.toFixed(2)} from ${cal.n} ratios`);
  const r = E.rng(99); let inside = 0, n = 0;
  for (let t = 0; t < 20; t++) {
    const u = [r(), r()], a = C.answer(em, u, zm), d = truthDepth(u);
    for (let m = 0; m < d.length; m++) if (d[m] > 0.005 || a.depth[m] > 0.005) { n++; if (Math.abs(a.depth[m] - d[m]) <= 2 * cal.k * a.depthSd[m] + 1e-4) inside++; }
  }
  check('calibrated ±2σ holds most real errors at new points', inside / n > 0.85, `${(100 * inside / n).toFixed(1)} % of ${n} cells`);
}

{ // routing
  const cal = C.calibrate(em, checks);
  const out = C.route(em, [0.5, 0.5], { inBox: false, zm, k: cal.k });
  check('a value outside the trained box goes to the solver', out.route === 'solver' && out.reasons[0] === 'out_of_range');
  const easy = C.route(em, train[3].u, { zm, k: cal.k, tol: { depth: 0.05, scalars: { peak: 0.05 } } });
  check('at a training point the emulator answers', easy.route === 'emulator', easy.reasons.join(',') + ` 2σ ${easy.worstSd2.toFixed(4)} m`);
  const strict = C.route(em, [0.37, 0.81], { zm, k: cal.k, tol: { depth: 1e-6, scalars: {} } });
  check('a tolerance tighter than the error estimate sends it to the solver', strict.route === 'solver' && strict.reasons.includes('field_sd'));
  check('distance to the training set is 0 at a training point and grows away from it', C.gap(em, train[0].u) < 1e-9 && C.gap(em, [train[0].u[0] + 0.05, train[0].u[1]]) > 0);
  const nov = C.route(em, [0.5, 0.02], { zm, k: cal.k, maxGap: 0, tol: { depth: 10, scalars: {} } });
  check('a point farther than maxGap from every run is novel', nov.route === 'solver' && nov.reasons.includes('novel'));
}

{ // learning: the solver's answer joins the training and the emulator is surer there
  const u = [0.93, 0.07], before = C.answer(em, u, zm);
  const em2 = E.train([...train.map(p => run(p.u)), run(u)]), after = C.answer(em2, u, zm);
  const mx = (a) => a.depthSd.reduce((s, v) => Math.max(s, v), 0);
  check('after the solver run joins, the emulator is surer at that point', mx(after) < 0.8 * mx(before), `max sd ${mx(before).toFixed(4)} → ${mx(after).toFixed(4)} m`);
  const e = C.errors(after, truthDepth(u), { peak: run(u).scalars.peak }, Array.from(zm.keys()));
  check('and its answer there matches the solver', e.maxAbs < 0.01 && Math.abs(e.scalars.peak) < 1e-3, `worst ${e.maxAbs.toExponential(1)} m`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall cascade tests passed');
process.exit(fails ? 1 : 0);
