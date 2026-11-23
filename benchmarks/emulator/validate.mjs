// Validates the emulator cascade on the backyard study against the full CPU solver.
//   node benchmarks/emulator/validate.mjs <runsDir> <outDir> [--tol 0.03] [--ntrain N]   (first N training runs only)
// Trains FloodSim's project emulator (src/emulator.js) on the training runs, calibrates its error estimate on the 3
// held-out runs, then answers the 40 test points four ways and scores each against the solver's own run there:
//   emulator only   every request answered by the emulator
//   cascade         src/cascade.js routes each request: the emulator answers when its calibrated 2σ on the home lot is
//                   under the tolerance, else the solver answers (and is exact, by definition here)
//   learning        the same, but each solver answer joins the training set and the emulator is retrained
//   solver only     every request run on the solver (the reference; 0 error, full cost)
// and checks the homeowner question itself (how much a fix changes things) on 12 paired runs with the fixes taken out.
// Writes <outDir>/cascade.json and the maps the figures use.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as E from '../../src/emulator.js';
import * as C from '../../src/cascade.js';
import { PARAMS, SCENE, geometry } from './backyard.mjs';

const [dir, out] = process.argv.slice(2); const tolArg = process.argv.indexOf('--tol');
const nArg = process.argv.indexOf('--ntrain'), NTRAIN = nArg > 0 ? +process.argv[nArg + 1] : Infinity;
const TOL = { depth: tolArg > 0 ? +process.argv[tolArg + 1] : 0.03, scalars: { wallPeak: 0.03 } };
mkdirSync(out, { recursive: true });
const { nx, ny } = SCENE, N = nx * ny, G = geometry();
const f32 = (id, k) => new Float32Array(readFileSync(`${dir}/${id}.${k}.f32`).buffer.slice(0));
const plan = JSON.parse(readFileSync(`${dir}/plan.json`, 'utf8')).filter(p => existsSync(`${dir}/${p.id}.json`));
const load = (p) => { const j = JSON.parse(readFileSync(`${dir}/${p.id}.json`, 'utf8')); return { ...p, ...j, z: f32(p.id, 'z'), maxWse: f32(p.id, 'maxWse'), speed: f32(p.id, 'speed'), dur: f32(p.id, 'dur') }; };
const all = plan.map(load), by = (role) => all.filter(r => r.role === role);
const train = by('train').slice(0, NTRAIN), hold = by('holdout'), test = by('test'), pairs = by('pair');
const SC = ['wallPeak', 'yardVolPeak', 'lowWetHours', 'nbrWallPeak'];
const mask = E.fieldMask(train.map(r => r.maxWse), nx, ny, { walls: G.house });
const toRun = (r) => ({ u: r.u, wse: E.fillWse(r.maxWse, r.z, mask, nx, ny), speed: E.maskOf(r.speed, mask), dur: E.maskOf(r.dur, mask), scalars: Object.fromEntries(SC.map(k => [k, r.scalars[k]])) });
const truthOf = (r) => { const zm = E.maskOf(r.z, mask); return { zm, depth: E.depthFrom(E.fillWse(r.maxWse, r.z, mask, nx, ny), zm), scalars: r.scalars }; };
// the home lot, on the mask
const midx = new Int32Array(N).fill(-1); { let m = 0; for (let k = 0; k < N; k++) if (mask[k]) midx[k] = m++; }
const region = []; for (let k = 0; k < N; k++) if (mask[k] && G.lot[k] === SCENE.home) region.push(midx[k]);

let t0 = performance.now();
let em = E.train(train.map(toRun));
const trainMs = performance.now() - t0;
const cal = C.calibrate(em, hold.map(r => ({ u: r.u, ...truthOf(r) })), { region });
console.log(`trained on ${train.length} runs in ${(trainMs / 1000).toFixed(1)} s; ${em.field.K} wse components; calibration k = ${cal.k.toFixed(2)} (${cal.n} ratios)`);
const ell = C.lengthScales(em);

const score = (a, r) => { const t = truthOf(r); const e = C.errors(a, t.depth, t.scalars, region); let cover = 0, n = 0; for (const m of region) if (t.depth[m] > 0.005 || a.depth[m] > 0.005) { n++; if (Math.abs(a.depth[m] - t.depth[m]) <= 2 * cal.k * a.depthSd[m] + 1e-4) cover++; } return { ...e, cover: n ? cover / n : 1 }; };
const solverSeconds = test.reduce((s, r) => s + r.seconds, 0) / test.length;
const rows = [];
let predMs = 0;
for (const r of test) {
  const zm = E.maskOf(r.z, mask); const tp = performance.now();
  const ro = C.route(em, r.u, { zm, region, tol: TOL, k: cal.k, maxGap: 1.5, ell }); predMs += performance.now() - tp;
  const e = score(ro.answer, r);
  rows.push({ id: r.id, u: r.u, values: r.values, route: ro.route, reasons: ro.reasons, gap: ro.gap, sd2: ro.worstSd2, wallSd2: ro.scalarSd2.wallPeak, err: e,
    wallPred: ro.answer.scalars.wallPeak.mean, wallTrue: r.scalars.wallPeak, volPred: ro.answer.scalars.yardVolPeak.mean, volTrue: r.scalars.yardVolPeak });
}
predMs /= test.length;
// learning cascade: in test order, retrain after every solver answer
let emL = em, learnRoutes = [], retrains = 0;
const trainL = train.map(toRun);
for (const r of test) {
  const zm = E.maskOf(r.z, mask), ro = C.route(emL, r.u, { zm, region, tol: TOL, k: cal.k, maxGap: 1.5, ell: C.lengthScales(emL) });
  const e = ro.route === 'emulator' ? score(ro.answer, r) : { rmse: 0, maxAbs: 0, scalars: { wallPeak: 0 } };
  learnRoutes.push({ id: r.id, route: ro.route, maxAbs: e.maxAbs, wallErr: e.scalars.wallPeak, sd2: ro.worstSd2 });
  if (ro.route === 'solver') { trainL.push(toRun(r)); emL = E.train(trainL); retrains++; }
}
const summ = (sel, f) => { const v = sel.map(f).sort((a, b) => a - b); return { n: v.length, median: v[Math.floor(v.length / 2)] ?? 0, p95: v[Math.min(v.length - 1, Math.floor(0.95 * v.length))] ?? 0, max: v.at(-1) ?? 0 }; };
const emuAns = rows.filter(r => r.route === 'emulator');
const result = {
  scene: { nx, ny, lots: SCENE.nLots, storm: '1-hr Atlas 14, Eastwick Philadelphia', params: PARAMS.map(p => ({ key: p.key, label: p.label, min: p.min, max: p.max, who: p.who })) },
  runs: { train: train.length, holdout: hold.length, test: test.length, pairs: pairs.length }, tol: TOL, calibration: cal,
  timing: { solverSecondsPerRun: solverSeconds, emulatorMsPerAnswer: predMs, trainSeconds: trainMs / 1000, speedup: solverSeconds * 1000 / predMs },
  emulatorOnly: { maxAbs: summ(rows, r => r.err.maxAbs), rmse: summ(rows, r => r.err.rmse), wallErr: summ(rows, r => Math.abs(r.wallPred - r.wallTrue)), cover: summ(rows, r => r.err.cover) },
  cascade: { solverShare: 1 - emuAns.length / rows.length, maxAbs: summ(emuAns, r => r.err.maxAbs), wallErr: summ(emuAns, r => Math.abs(r.wallPred - r.wallTrue)),
    sentToSolverMaxAbsIfEmulated: summ(rows.filter(r => r.route === 'solver'), r => r.err.maxAbs) },
  learning: { solverShare: learnRoutes.filter(r => r.route === 'solver').length / learnRoutes.length, firstHalf: learnRoutes.slice(0, 20).filter(r => r.route === 'solver').length / 20, secondHalf: learnRoutes.slice(20).filter(r => r.route === 'solver').length / Math.max(1, learnRoutes.length - 20), retrains,
    maxAbs: summ(learnRoutes.filter(r => r.route === 'emulator'), r => r.maxAbs) },
  rows, learnRoutes,
};
// the homeowner question: the change a set of fixes makes, emulated vs solver, on the paired runs
result.pairs = pairs.map(p => {
  const x = test.find(r => r.id === p.of); if (!x) return null;
  const a1 = C.answer(em, x.u, E.maskOf(x.z, mask)).scalars, a0 = C.answer(em, p.u, E.maskOf(p.z, mask)).scalars;
  return { id: p.id, of: p.of, fixes: Object.fromEntries(PARAMS.filter(q => q.who === 'you').map(q => [q.key, x.values[q.key]])),
    wall: { solver: x.scalars.wallPeak - p.scalars.wallPeak, emulator: a1.wallPeak.mean - a0.wallPeak.mean, sd2: 2 * cal.k * Math.hypot(a1.wallPeak.sd, a0.wallPeak.sd) },
    vol: { solver: x.scalars.yardVolPeak - p.scalars.yardVolPeak, emulator: a1.yardVolPeak.mean - a0.yardVolPeak.mean, sd2: 2 * cal.k * Math.hypot(a1.yardVolPeak.sd, a0.yardVolPeak.sd) } };
}).filter(Boolean);
writeFileSync(`${out}/cascade.json`, JSON.stringify(result, null, 1));
// maps for the figures: 4 test points (the two with the largest and the two with the smallest emulator error)
const sorted = [...rows].sort((a, b) => b.err.maxAbs - a.err.maxAbs), pick = [sorted[0], sorted[1], sorted.at(-2), sorted.at(-1)];
for (const p of pick) {
  const r = test.find(t => t.id === p.id), zm = E.maskOf(r.z, mask), a = C.answer(em, r.u, zm), t = truthOf(r);
  writeFileSync(`${out}/map_${p.id}.json`, JSON.stringify({ id: p.id, nx, ny, values: r.values, route: p.route, truth: Array.from(E.unmask(t.depth, mask)), emu: Array.from(E.unmask(a.depth, mask)), sd: Array.from(E.unmask(a.depthSd, mask)).map(v => 2 * cal.k * v), house: Array.from(G.house), lot: Array.from(G.lot) }));
}
writeFileSync(`${out}/mask.json`, JSON.stringify({ nx, ny, mask: Array.from(mask), house: Array.from(G.house), lot: Array.from(G.lot) }));
console.log(JSON.stringify({ timing: result.timing, emulatorOnly: result.emulatorOnly, cascade: result.cascade, learning: result.learning }, null, 1));
