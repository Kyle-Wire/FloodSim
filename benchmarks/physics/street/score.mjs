// Street sandbox scorer (PV-SS1 … PV-SS9), the module run.mjs loads for each spec. It reads the latest raw file of
// each case and executor from street/raw/ (written by exec-cpu.mjs or the browser page), computes the hand answer
// with references/street.mjs, and builds rows with lib/score.mjs. A case with no raw file is listed under `notRun`
// and has no rows. PV-SS7 is not a simulation: it calls src/damage.js directly.
//   node benchmarks/physics/street/score.mjs --expect     print every hand answer, read no raw file, score nothing
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { row } from '../lib/score.mjs';
import * as st from '../references/street.mjs';
import { SCENES } from './terrain.mjs';
import { buildCase } from './cases.mjs';
import { openWater, exposure, footprintIndex } from '../../../src/damage.js';
import { inletFlow } from '../../../src/drainage.js';

const here = path.dirname(fileURLToPath(import.meta.url)), MMHR = 1 / 3.6e6, EXECS = ['cpu', 'gpu'];
let EXPECT = false;

/** The latest raw file of a case on an executor (raw/<stamp>/<case>.<exec>.json; stamps sort by time). */
function latestRaw(id, exec) {
  if (EXPECT) return null;
  const dir = path.join(here, 'raw'); if (!fs.existsSync(dir)) return null;
  for (const stamp of fs.readdirSync(dir).sort().reverse()) {
    const f = path.join(dir, stamp, `${id}.${exec}.json`);
    if (fs.existsSync(f)) { const buf = fs.readFileSync(f); return { ...JSON.parse(buf), _file: `street/raw/${stamp}/${id}.${exec}.json`, _sha256: crypto.createHash('sha256').update(buf).digest('hex') }; }
  }
  return null;
}
const at = (series, t) => series.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b));
const sceneOf = (spec, e) => ({ ...(spec.parameters.scenes.value[e.scene] ?? {}), ...(e.sceneArgs ?? {}) });
const lim = (abs, rel, ref) => ({ abs: Math.max(abs ?? 0, (rel ?? 0) * Math.abs(ref)) });
const bisect = (f, lo, hi) => { for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } return (lo + hi) / 2; };

/** Shared by every spec: walk its cases and executors, collect rows, hand answers, the raw files used and what has not run. */
function collect(spec, ids, each) {
  const rows = [], cases = {}, notRun = [], raw = {}, hand = {};
  for (const id of ids) for (const exec of EXECS) {
    const e = spec.parameters.cases.value[id];
    if (exec === 'cpu' && e?.grid?.subgrid) continue; // no CPU implementation of the subgrid mode
    const r = latestRaw(id, exec), ctx = { id, exec, e, r, tag: `${id} [${exec}]`, books: exec === 'cpu' ? spec.criteria.booksRelCpu : spec.criteria.booksRelGpu };
    const R = (quantity, errorType, ref, sim, crit, extra = {}) => rows.push(row({ benchmark: spec.id, caseId: ctx.tag, quantity, errorType, ref, sim, crit, ...extra }));
    const out = each(ctx, R, r != null) ?? {};
    if (out.hand && !hand[id]) hand[id] = out.hand;
    if (!r) { notRun.push(ctx.tag); continue; }
    raw[ctx.tag] = { file: r._file, sha256: r._sha256, engine: r.engine ?? null, adapter: r.adapter ?? null, wallSeconds: r.wallSeconds, steps: r.steps, grid: r.grid };
    if (ctx.books != null && r.mass) R('surface books (relative)', 'accounting', 0, r.mass.rel, { abs: ctx.books });
    if (r.coupled && spec.criteria.swmmContinuityPct != null) R('SWMM continuity error (%)', 'accounting', 0, r.coupled.continuity.errorPct, { abs: spec.criteria.swmmContinuityPct });
    cases[ctx.tag] = { ...(out.report ?? {}), swmmVersion: r.coupled?.swmmVersion ?? undefined };
  }
  return { rows, cases, notRun, raw, hand };
}

// ---------------------------------------------------------------- PV-SS1
function ss1(spec) {
  const C = spec.criteria;
  return collect(spec, Object.keys(spec.parameters.cases.value), ({ e, r }, R, ran) => {
    const s = sceneOf(spec, e), i = e.rain.mmhr * MMHR, Q = i * s.L * s.W, tc = st.kwTc(i, s.L, s.n, s.S0), k = st.kwNumber(i, s.L, s.n, s.S0);
    const hand = { steadyOutflowM3s: Q, tcS: tc, t50S: st.kwTimeTo(0.5, tc), t90S: st.kwTimeTo(0.9, tc), kinematicNumber: k, depthM: Object.fromEntries(Object.entries(e.probes).map(([p, q]) => [p, st.kwDepth(i, q.x, s.n, s.S0)])) };
    if (!ran) return { hand };
    const inv = k < C.kinematicNumberMin ? 'Invalid setup' : null, S = r.series, end = S.at(-1), w0 = at(S, end.t - C.steadyWindowS);
    R('steady outflow, last 300 s (m³/s)', 'numerical', Q, (end.outflow - w0.outflow) / (end.t - w0.t), { rel: C.steadyOutflowRel });
    for (const p of r.probes) R(`steady depth at ${e.probes[p.id].x} m (m)`, 'numerical', hand.depthM[p.id], p.final.mean, lim(C.depthAbsM, C.depthRel, hand.depthM[p.id]), { status: inv });
    const rate = S.slice(1).map((p, j) => ({ t: (p.t + S[j].t) / 2, q: (p.outflow - S[j].outflow) / (p.t - S[j].t) })), cross = (f) => { for (let j = 1; j < rate.length; j++) if (rate[j].q >= f * Q) { const a = rate[j - 1], b = rate[j]; return a.t + (f * Q - a.q) / (b.q - a.q) * (b.t - a.t); } return null; };
    R('time to 50 % of steady outflow (s)', 'numerical', hand.t50S, cross(0.5), { rel: C.timeRel }, { status: inv });
    R('time to 90 % of steady outflow (s)', 'numerical', hand.t90S, cross(0.9), { rel: C.timeRel }, { status: inv });
    return { hand, report: { edgeShareOfRain: end.outflow / end.rain } };
  });
}

// ---------------------------------------------------------------- PV-SS2
const hollowHand = (spec, e) => {
  const s = sceneOf(spec, e), P = spec.parameters, Ac = P.catchmentM2?.value ?? 400, Ah = P.hollowAreaM2?.value ?? 100, below = P.belowRimM2?.value ?? 190, Pm = e.rain.mmhr * e.rain.minutes / 60 / 1000, V = Pm * Ac, cap = Ah * s.depth;
  return { rainM: Pm, volumeToHollowM3: V, hollowVolumeM3: cap, spills: V > cap, finalDepthM: V > cap ? s.depth : V / Ah, spillM3: Math.max(0, V - cap), rainBelowRimM3: Pm * below, peakDepthM: V > cap ? s.depth + st.rimHead(e.rain.mmhr * MMHR * Ac / s.W) : V / Ah };
};
function ss2(spec) {
  const C = spec.criteria, finals = {};
  const out = collect(spec, Object.keys(spec.parameters.cases.value), ({ id, exec, e, r }, R, ran) => {
    const hand = hollowHand(spec, e); if (!ran) return { hand };
    const end = r.series.at(-1), p = r.probes.find(q => q.id === 'hollow'), peak = Math.max(...r.series.map(q => q.probes.hollow[0]));
    finals[`${id}/${exec}`] = p.final.mean;
    R('depth in the hollow at the end (m)', 'numerical', hand.finalDepthM, p.final.mean, { abs: C.finalDepthAbsM });
    R('spilled over the rim (m³)', 'numerical', hand.spillM3, end.outflow - hand.rainBelowRimM3, lim(C.spillVolumeAbsM3, C.spillVolumeRel, hand.spillM3));
    if (hand.spills) R('peak depth in the hollow (m)', 'numerical', hand.peakDepthM, peak, { abs: C.peakHeadAbsM }, { note: 'reference: rim plus the head of frictionless critical flow' });
    return { hand, report: { peakDepthM: peak, hmaxMeanM: p.peak.mean, edgeShareOfRain: end.outflow / end.rain } };
  });
  for (const exec of EXECS) if (finals[`SS2-b/${exec}`] != null && finals[`SS2-c/${exec}`] != null)
    out.rows.push(row({ benchmark: spec.id, caseId: `SS2-c against SS2-b [${exec}]`, quantity: 'end depth, a storm twice as large less the smaller one (m)', errorType: 'numerical', ref: 0, sim: finals[`SS2-c/${exec}`] - finals[`SS2-b/${exec}`], crit: { abs: C.stormIndependenceAbsM } }));
  return out;
}

// ---------------------------------------------------------------- PV-SS3, PV-SS4: one inlet on one pipe
function sagHand(spec, e) {
  const s = sceneOf(spec, e), d = e.drainage, g = spec.parameters.grate.value, f = SCENES.sagStreet(s), z = Array.from(f.z), area = s.L * s.W;
  const o = { L: d.L, K: st.pipeK(d.D, spec.parameters.pipeN.value), Co: g.Co, A: g.A, Cw: g.Cw, P: g.P }, Q = (e.rain?.mmhr ?? 0) * MMHR * area, stage = (V) => st.levelForVolume(z, f.dx * f.dx, V);
  if (d.outlet === 'FREE') return { o, Q, free: true, inletDepthM: bisect((h) => st.inletFree(h, o) - Q, 0, 2), pipeFullCapacityAtGroundM3s: o.K * Math.sqrt((0 - (d.invOut + d.D)) / d.L) };
  const hist = st.sagHistory({ inflow: (t) => (t < (e.rain?.minutes ?? 0) * 60 ? Q : 0), stage, zs: 0, Hout: d.stage, o, tEnd: e.tEnd, every: 60 });
  return { o, Q, hist, z, cell: f.dx * f.dx, equilibriumLevelM: Q > 0 ? st.sagLevelClosed(Q, d.stage, o) : d.stage, restVolumeM3: st.volumeBelow(z, f.dx * f.dx, Math.max(0, d.stage)) };
}
function onePipeRows(spec, ctx, R, ran) {
  const C = spec.criteria, { e, r } = ctx, h = sagHand(spec, e), times = spec.parameters.scoreTimesS.value.filter(t => t <= e.tEnd);
  const hand = h.free ? { rainOverAreaM3s: h.Q, inletWeirHeadM: h.inletDepthM, pipeFullCapacityAtGroundM3s: h.pipeFullCapacityAtGroundM3s }
    : { rainOverAreaM3s: h.Q, equilibriumLevelM: h.equilibriumLevelM, restVolumeM3: h.restVolumeM3, levelM: Object.fromEntries(times.map(t => [t, at(h.hist, t).eta])), pipeFlowM3s: Object.fromEntries(times.map(t => [t, at(h.hist, t).Q])), earlyVolumeM3: spec.parameters.earlyTimeS ? at(h.hist, spec.parameters.earlyTimeS.value).V : undefined };
  if (!ran) return { hand };
  const S = r.series, sag = (t) => at(S, t).probes.sag[0];
  if (h.free) R('depth at the grate at the end (m)', 'numerical', h.inletDepthM, r.probes.find(p => p.id === 'inlet')?.final.mean ?? null, lim(C.freeInletDepthAbsM, C.freeInletDepthRel, h.inletDepthM), { note: 'free outfall: the pipe carries the rain, the street stands at the grate\'s weir head' });
  else if (e.rain) {
    for (const t of times) R(`pond level in the sag at ${t} s (m)`, 'physical-model', hand.levelM[t], sag(t), lim(C.pondLevelAbsM ?? C.levelAbsM, C.pondLevelRel ?? C.levelRel, hand.levelM[t]));
    const T = times.at(-1); R(`pipe flow at ${T} s (m³/s)`, 'physical-model', hand.pipeFlowM3s[T], Math.abs(at(S, T).pipeFlow[0]), { rel: C.pipeFlowRel ?? 0.02 });
    if (hand.earlyVolumeM3 != null) { const t = spec.parameters.earlyTimeS.value; R(`water on the street at ${t} s (m³)`, 'physical-model', hand.earlyVolumeM3, at(S, t).volume, { rel: C.streetVolumeRel }); }
  } else {
    const T = e.tEnd; R(`street level in the sag at ${T} s (m)`, 'physical-model', e.drainage.stage, sag(T), lim(C.levelAbsM, C.levelRel, e.drainage.stage));
    R(`water on the street at ${T} s (m³)`, 'physical-model', h.restVolumeM3, at(S, T).volume, { rel: C.volumeRel });
  }
  const c = r.coupled;
  return { hand, report: { exchange: c.twoWay ? 'two-way' : 'spill at the rim', sagDepthEndM: sag(e.tEnd), streetVolumeEndM3: S.at(-1).volume, pipeFlowEndM3s: S.at(-1).pipeFlow[0], nodeHeadEndM: S.at(-1).head[0], maxNodeHeadM: c.nodes[0].maxHead, totals: c.totals, continuity: c.continuity } };
}
function networkRows(spec, ctx, R, ran) {
  if (!ran) return {};
  const C = spec.criteria, { e, r } = ctx, c = r.coupled, S = r.series, end = S.at(-1);
  const outlets = new Map(c.nodes.map((n, i) => [i, n]).filter(([, n]) => n.outfall).map(([i]) => [i, null]));
  const ref = st.hglTree(c.nodes, c.pipes.map(p => ({ ...p, Q: p.maxQ ?? 0 })), outlets);
  let worst = -Infinity, where = null; c.nodes.forEach((n, i) => { if (n.outfall || n.maxHead == null || !(ref.hgl[i] === ref.hgl[i])) return; const d = n.maxHead - Math.max(ref.hgl[i], n.invert); if (d > worst) { worst = d; where = n.name; } });
  R('highest manhole head above the friction grade line from the peak pipe flows (m)', 'physical-model', 0, worst, { abs: C.hglBoundAbsM }, { status: worst <= C.hglBoundAbsM ? 'Passed' : 'Failed', note: `one-sided bound; worst at ${where}` });
  const design = c.pipes.every(p => p.designQ != null) ? st.hglCapacityFactor(c.nodes, c.pipes.map(p => ({ ...p, Q: p.designQ })), outlets) : null;
  const peakVol = Math.max(...S.map(p => p.volume)), sagPeak = Math.max(...S.map(p => p.probes.sag[0]));
  return { report: {
    rainM3: end.rain, sewerShareOfRain: (c.totals.toNetwork - c.totals.toSurface) / end.rain, takenInM3: c.totals.toNetwork, returnedToStreetM3: c.totals.toSurface, swmmFloodingLossM3: (c.continuity.flooding ?? 0) * 1000,
    manholes: c.nodes.filter(n => !n.outfall).length, manholesSurchargedToGround: c.nodes.filter(n => !n.outfall && n.maxHead > n.ground - 0.05).length, highestHeadAboveGroundM: Math.max(...c.nodes.filter(n => !n.outfall).map(n => n.maxHead - n.ground)),
    sagDepthPeakM: sagPeak, sagDepthEndM: end.probes.sag[0], streetVolumePeakM3: peakVol, streetVolumeEndM3: end.volume,
    pipes: c.pipes.map(p => ({ name: p.name, D: p.D, designQ: p.designQ, maxQ: p.maxQ, ratio: p.designQ ? p.maxQ / p.designQ : null, maxDepthOverD: p.maxRatio })),
    designFlowMultipleBeforeGradeLineReachesGround: design, grates: c.inlets.filter(g => g.grates > 0).length, inletVolumesM3: c.inlets.map(g => g.volume), stats: c.stats, designIntensity10: c.designIntensity10,
    housesExposed: r.fields ? housesExposed(r.fields).exposed : undefined,
  } };
}
function ss3(spec) {
  return collect(spec, Object.keys(spec.parameters.cases.value), (ctx, R, ran) => (ctx.e.drainage.kind === 'pipe' ? onePipeRows(spec, ctx, R, ran) : networkRows(spec, ctx, R, ran)));
}
function ss4(spec, specs) {
  const out = collect(spec, Object.keys(spec.parameters.cases.value), (ctx, R, ran) => onePipeRows(spec, ctx, R, ran));
  out.freeOutfallComparison = Object.fromEntries(EXECS.map(x => [x, latestRaw('SS3-c', x)?.series.at(-1).probes.sag[0] ?? null])); // the same street and rain with the app's default outfall
  return out;
}

// ---------------------------------------------------------------- PV-SS5
function ss5(spec, specs) {
  const C = spec.criteria;
  return collect(spec, Object.keys(spec.parameters.cases.value), ({ id, e, r }, R, ran) => {
    const s = sceneOf(spec, e), end = r?.series.at(-1), p = r?.probes[0];
    if (id.startsWith('SS5-up')) {
      const i = e.rain.mmhr * MMHR, x = e.probes.block.x, truth = st.kwDepth(i, x, s.n, s.S0), own = st.kwDepth(i, x - (s.x0 ?? 0), s.n, s.S0), hand = { trueDepthM: truth, thisBoxDepthM: own, shareOfTrue: own / truth };
      if (!ran) return { hand };
      if (s.x0) { R('depth at the block against this box\'s own slope length (m)', 'numerical', own, p.final.mean, lim(C.depthAbsM, C.depthRel, own));
        R('depth at the block against the true depth (m)', 'physical-model', truth, p.final.mean, lim(C.boxChangeAbsM, C.boxChangeRel, truth), { note: 'the box is cut below the divide' }); }
      else R('depth at the block against the true depth (m)', 'numerical', truth, p.final.mean, lim(C.depthAbsM, C.depthRel, truth));
      return { hand, report: { edgeShareOfRain: end.outflow / end.rain } };
    }
    const hand = hollowHand(specs['PV-SS2'], { ...e, scene: 'hollow', sceneArgs: {} }); if (!ran) return { hand: { trueEndDepthM: hand.finalDepthM, truePeakDepthM: hand.peakDepthM } };
    const whole = s.x0 == null && s.x1 == null, peak = Math.max(...r.series.map(q => q.probes.block[0]));
    R('depth at the block at the end against the true depth (m)', whole ? 'numerical' : 'physical-model', hand.finalDepthM, p.final.mean, whole ? { abs: C.finalDepthAbsM } : lim(C.boxChangeAbsM, C.boxChangeRel, hand.finalDepthM));
    R('peak depth at the block against the true peak (m)', whole ? 'numerical' : 'physical-model', hand.peakDepthM, peak, whole ? { abs: C.peakHeadAbsM } : lim(C.boxChangeAbsM, C.boxChangeRel, hand.peakDepthM));
    return { hand: { trueEndDepthM: hand.finalDepthM, truePeakDepthM: hand.peakDepthM }, report: { edgeShareOfRain: end.outflow / end.rain, box: [s.x0 ?? 0, s.x1 ?? 60] } };
  });
}

// ---------------------------------------------------------------- PV-SS6
function ss6(spec, specs) {
  const C = spec.criteria, memo = {};
  const truth = (scene) => memo[scene] ??= (() => { // from the 0.5 m ground alone
    const f = SCENES[scene]({}), open = [], N = f.nx * f.ny; for (let k = 0; k < N; k++) if (!f.bld[k]) open.push(f.z[k]);
    const z1 = st.blockMean(f.z, f.nx, f.ny, 2, f.bld); return { f, open, z1, nx1: f.nx / 2, ny1: f.ny / 2, area: N * f.dx * f.dx };
  })();
  return collect(spec, Object.keys(spec.parameters.cases.value), ({ id, e, r }, R, ran) => {
    const T = truth(e.scene), def = buildCase(id, specs), P = e.rain.mmhr * e.rain.minutes / 60 / 1000, V = P * T.area, probe = def.probes[0], g = e.grid ?? {}, plain = !g.subgrid;
    const minOver = (z, cells) => Math.min(...cells.map(k => z[k]).filter(v => v === v));
    // true depth beside the house: the driveway holds everything; the rear yard drains through its passage
    const level05 = st.levelForVolume(T.open, T.f.dx * T.f.dx, V), true1 = e.scene === 'driveway' ? Math.max(0, level05 - minOver(T.z1, probe.fine)) : 0;
    const true05 = e.scene === 'driveway' ? Math.max(0, level05 - Math.min(...T.open)) : 0;
    // this grid's own answer, from its block-mean ground (built by the reference, not by the app)
    let own = null;
    if (plain) {
      const F = g.native ? 1 : Math.round(def.c.dx / T.f.dx), zc = F === 1 ? Float64Array.from(T.f.z, (v, k) => (T.f.bld[k] ? NaN : v)) : st.blockMean(T.f.z, T.f.nx, T.f.ny, F, T.f.bld), cnx = T.f.nx / F, cny = T.f.ny / F, A = (T.f.dx * F) ** 2;
      const openC = Array.from(zc).filter(v => v === v);
      if (e.scene === 'driveway') own = Math.max(0, st.levelForVolume(openC, A, V) - minOver(zc, probe.cells));
      else { // the yard's own rain (with the roof's share the app routes to it) over the yard's cells; if that pond reaches the street the yard drains
        const rear = []; let Vr = 0; for (let k = 0; k < cnx * cny; k++) { const y = (Math.floor(k / cnx) + 0.5) * T.f.dx * F; if (y >= 10 && zc[k] === zc[k]) { rear.push(k); Vr += def.c.rainField[k] * A * P; } }
        const lv = st.levelForVolume(rear.map(k => zc[k]), A, Vr), seed = rear.reduce((a, k) => (zc[k] < zc[a] ? k : a)), pond = st.pondCells(zc, cnx, cny, seed, lv);
        const drains = pond.some(k => (Math.floor(k / cnx) + 0.5) * T.f.dx * F < 6);
        own = drains ? 0 : Math.max(0, lv - minOver(zc, probe.cells));
      }
    }
    const hand = { rainVolumeM3: V, trueLevelM: e.scene === 'driveway' ? level05 : null, trueDepth1mM: true1, trueDepthHalfMetreM: true05, thisGridOwnAnswerM: own };
    if (!ran) return { hand };
    const p = r.probes[0], tr = g.native ? true05 : true1;
    if (plain) R('depth beside the house at the end, solver cells, against the true depth (m)', 'numerical', tr, p.final.max, lim(C.truthAbsM, C.truthRel, tr), { note: 'resolution: the solver\'s own cells' });
    if (p.final1m) R('depth beside the house at the end, on the 1 m map, against the true depth (m)', 'numerical', true1, p.final1m.max, lim(C.truthAbsM, C.truthRel, true1), { note: g.subgrid ? 'the subgrid tables\' 1 m depth' : 'the app\'s downscaling' });
    if (own != null) R('depth beside the house at the end against this grid\'s own arithmetic (m)', 'numerical', own, p.final.max, { abs: C.gridArithmeticAbsM });
    const pk = p.peak1m?.max ?? p.peak?.max ?? null, fin = p.final1m?.max ?? p.final?.max ?? null;
    return { hand, report: { endDepthM: fin, peakDepthM: pk, exposedAtEnd: fin >= C.exposureThresholdM, exposedAtPeak: pk >= C.exposureThresholdM, trulyExposedAtEnd: true1 >= C.exposureThresholdM } };
  });
}

// ---------------------------------------------------------------- PV-SS7: the wall rule, src/damage.js against the rule as written
function ss7(spec) {
  const P = spec.parameters, L = P.lot.value, rule = P.rule.value, rows = [], cases = {}, hand = {};
  for (const c of P.ruleCases.value) {
    const dx = c.dx ?? L.dx, nx = L.nx / dx, ny = L.ny / dx, N = nx * ny, bld = new Uint8Array(N), road = new Uint8Array(N), depth = new Float64Array(N), wse = new Float64Array(N), z = new Float64Array(N).fill(L.ground);
    const box = ([x0, y0, x1, y1], fn) => { for (let j = Math.round(y0 / dx); j < Math.round(y1 / dx); j++) for (let i = Math.round(x0 / dx); i < Math.round(x1 / dx); i++) fn(j * nx + i); };
    box(L.building, k => { bld[k] = 1; }); box([0, L.streetRows[0], L.nx, L.streetRows[1]], k => { road[k] = 1; });
    for (const [x0, y0, x1, y1, d] of c.water) box([x0, y0, x1, y1], k => { depth[k] = d; });
    for (let k = 0; k < N; k++) wse[k] = L.ground + depth[k];
    const ref = st.wallExposure({ depth, wse, bld, road, fp: bld, nx, ny, dx, minDepth: rule.minDepth, minArea: rule.minArea, reach: rule.reach });
    // the app's calls (app/map.js): openWater on the peak depth, then exposure with that mask and the footprint index
    const [bx0, by0, bx1, by1] = L.building.map(v => v / dx), fp = footprintIndex([[[[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]]]], nx, ny);
    const open = openWater(depth, { nx, ny, dx, bld, road, minDepth: rule.minDepth });
    const ex = exposure([{ id: 'house', cell: [(bx0 + bx1) / 2, (by0 + by1) / 2] }], { nx, ny, z, bld, maxWse: wse, maxDepth: depth }, s => s.cell, { fp, minDepth: rule.minDepth, counts: open.mask })[0];
    const tag = `${c.id} ${c.what}`;
    if (ref.counts !== c.hand.counts || (c.hand.level != null && Math.abs(ref.level - c.hand.level) > 1e-9)) throw new Error(`PV-SS7 ${c.id}: the reference (${JSON.stringify(ref)}) disagrees with the hand answer in the spec (${JSON.stringify(c.hand)})`);
    hand[c.id] = c.hand;
    if (EXPECT) continue;
    rows.push(row({ benchmark: spec.id, caseId: tag, quantity: 'water counts against the building (1 yes, 0 no)', errorType: 'accounting', ref: ref.counts ? 1 : 0, sim: ex.level != null ? 1 : 0, crit: { abs: 0 } }));
    if (ref.counts) rows.push(row({ benchmark: spec.id, caseId: tag, quantity: 'wall level (m)', errorType: 'accounting', ref: ref.level, sim: ex.level, crit: { abs: spec.criteria.levelAbsM } }));
    cases[c.id] = { dx, footprintFound: ex.how, wetCells: ex.wetCells, level: ex.level, referenceCells: ref.cells, enclosed: open.enclosed };
  }
  return { rows, cases, notRun: [], raw: {}, hand };
}

// ---------------------------------------------------------------- PV-SS8, PV-SS9: the bowl neighbourhood
const blockScene = (() => { let b; return () => (b ??= SCENES.block({})); })();
/** Peak wall depth at each house, and which are exposed by the rule as written, from a raw record's 1 m peak map. */
function housesExposed(fields, rule = { minDepth: 0.10, reach: 2, minArea: 200 }) {
  const b = blockScene(), N = b.nx * b.ny, depth = Float64Array.from(fields.peakMm, v => v / 1000), wse = depth.map((d, k) => d + b.z[k]);
  const per = b.houses.map(h => { const fp = new Uint8Array(N); for (let j = h.y0; j < h.y1; j++) for (let i = h.x0; i < h.x1; i++) fp[j * b.nx + i] = 1;
    const r = st.wallExposure({ depth, wse, bld: b.bld, road: b.road, fp, nx: b.nx, ny: b.ny, dx: 1, ...rule }); let d = 0;
    for (let j = Math.max(0, h.y0 - 2); j < Math.min(b.ny, h.y1 + 2); j++) for (let i = Math.max(0, h.x0 - 2); i < Math.min(b.nx, h.x1 + 2); i++) { const k = j * b.nx + i; if (!b.bld[k] && depth[k] > d) d = depth[k]; }
    return { id: h.id, exposed: r.counts, wallDepthM: d }; });
  return { per, exposed: per.filter(p => p.exposed).length, houses: per.length };
}
const blockHand = (spec, e) => {
  const b = blockScene(), open = []; for (let k = 0; k < b.nx * b.ny; k++) if (!b.bld[k]) open.push(b.z[k]);
  const pf = spec.parameters.depth60.value, ari = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000], d60 = pf[ari.indexOf(e.rain.ari)], V = d60 / 1000 * b.nx * b.ny, level = st.levelForVolume(open, 1, V);
  const sagCells = []; for (let j = 46; j < 50; j++) for (let i = 94; i < 98; i++) sagCells.push(j * b.nx + i);
  return { rainM3: V, restLevelM: level, sagMeanBedM: sagCells.reduce((a, k) => a + b.z[k], 0) / sagCells.length, sagDepthM: level - sagCells.reduce((a, k) => a + b.z[k], 0) / sagCells.length, areaM2: b.nx * b.ny };
};
function ss8(spec, specs) {
  const C = spec.criteria;
  const out = collect(spec, Object.keys(spec.parameters.cases.value), ({ e, r }, R, ran) => {
    const h = blockHand(spec, e), d = e.drainage ?? { kind: 'none' }, hand = d.kind === 'none' ? { rainM3: h.rainM3, restLevelM: h.restLevelM, sagDepthAtRestM: h.sagDepthM } : { rainM3: h.rainM3 };
    if (!ran) return { hand };
    const S = r.series, end = S.at(-1), peakVol = Math.max(...S.map(p => p.volume));
    if (d.kind === 'none') R('pond depth at the sag at the end (m)', 'numerical', h.sagDepthM, end.probes.sag[0], { abs: C.noDrainLevelAbsM });
    else { const bound = r.rainBlocks.reduce((a, [t0, t1, mm]) => a + Math.max(0, mm - d.mmhr) * MMHR * (t1 - t0), 0) * h.areaM2; hand.peakVolumeBoundM3 = bound;
      R('highest volume on the ground against its upper bound (m³)', 'physical-model', bound, peakVol, { rel: C.lumpedBoundRel }, { status: peakVol <= bound * (1 + C.lumpedBoundRel) ? 'Passed' : 'Failed', note: 'one-sided bound: Σ max(0, i − allowance) Δt × area' }); }
    const hx = r.fields ? housesExposed(r.fields, spec.parameters.wallRule.value) : null;
    return { hand, report: { treatment: d.kind === 'none' ? 'no drainage' : `allowance ${d.mmhr} mm/h`, returnPeriod: e.rain.ari, sagDepthPeakM: Math.max(...S.map(p => p.probes.sag[0])), sagDepthEndM: end.probes.sag[0], streetVolumePeakM3: peakVol, streetVolumeEndM3: end.volume, removedShareOfRain: end.infil / end.rain, housesExposed: hx?.exposed, houses: hx?.houses } };
  });
  // the pipe network on the same storms (PV-SS3's cases), reported beside the others
  out.pipes = {};
  for (const [T, id] of Object.entries(spec.parameters.pipeCases.value)) for (const exec of EXECS) { const r = latestRaw(id, exec); if (!r) continue; const S = r.series, hx = r.fields ? housesExposed(r.fields, spec.parameters.wallRule.value) : null;
    out.pipes[`${id} [${exec}]`] = { treatment: 'pipe network', returnPeriod: +T, sagDepthPeakM: Math.max(...S.map(p => p.probes.sag[0])), sagDepthEndM: S.at(-1).probes.sag[0], streetVolumePeakM3: Math.max(...S.map(p => p.volume)), streetVolumeEndM3: S.at(-1).volume, sewerShareOfRain: (r.coupled.totals.toNetwork - r.coupled.totals.toSurface) / S.at(-1).rain, housesExposed: hx?.exposed, houses: hx?.houses }; }
  return out;
}
function ss9(spec, specs) {
  const C = spec.criteria, rule = spec.parameters.wallRule.value;
  return collect(spec, Object.keys(spec.parameters.cases.value), ({ exec, e, r }, R, ran) => {
    if (e.scene !== 'block') return detailRows(spec, e, r, R, ran);
    const h = blockHand(spec, e), hand = { restLevelM: h.restLevelM, sagDepthAtRestM: h.sagDepthM }; if (!ran) return { hand };
    const base = latestRaw(spec.parameters.base.value, exec), p = r.probes.find(q => q.id === 'sag');
    R('pond depth at the sag at the end, on the 1 m map (m)', 'numerical', h.sagDepthM, p.final1m.mean, { abs: C.finalLevelAbsM });
    const rep = { cells: r.grid.cells, wallSeconds: r.wallSeconds, steps: r.steps };
    if (base?.fields && r.fields) {
      const a = housesExposed(r.fields, rule), b = housesExposed(base.fields, rule), rmse = Math.sqrt(a.per.reduce((s, q, k) => s + (q.wallDepthM - b.per[k].wallDepthM) ** 2, 0) / a.per.length), agree = a.per.filter((q, k) => q.exposed === b.per[k].exposed).length / a.per.length;
      R('peak wall depth at the houses against the 1 m run, root mean square (m)', 'numerical', 0, rmse, { abs: C.houseDepthRmseM }, { status: 'Not independently validated', note: `the reference is the same solver at 1 m; limit ${C.houseDepthRmseM} m: ${rmse <= C.houseDepthRmseM ? 'inside' : 'outside'}` });
      R('houses given the same exposed / not exposed answer as the 1 m run (share)', 'numerical', 1, agree, { abs: 1 - C.exposureAgreement }, { status: 'Not independently validated', note: `the reference is the same solver at 1 m; limit ${C.exposureAgreement}: ${agree >= C.exposureAgreement ? 'inside' : 'outside'}` });
      Object.assign(rep, { housesExposed: a.exposed, housesExposedAt1m: b.exposed, baseWallSeconds: base.wallSeconds, timesFasterThan1m: base.wallSeconds / r.wallSeconds, baseCells: base.grid.cells,
        peakDepthRmseOverOpenCellsM: Math.sqrt(r.fields.peakMm.reduce((s, v, k) => s + ((v - base.fields.peakMm[k]) / 1000) ** 2, 0) / r.fields.peakMm.length) });
    }
    return { hand, report: rep };
  });
}

/** PV-SS9 revision 2: a kerb, a crown and a small hollow, read on the 1 m map at the end. */
function detailRows(spec, e, r, R, ran) {
  const C = spec.criteria, f = SCENES[e.scene]({}), P = e.rain.mmhr * e.rain.minutes / 60 / 1000, val = (p, k) => (p.final1m ?? p.final)[k];
  if (e.scene === 'kerbStreet') {
    const south = []; let zg = Infinity; for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { const y = (j + 0.5) * f.dx; if (y < 9) south.push(f.z[j * f.nx + i]); if (y >= 5 && y < 6) zg = Math.min(zg, f.z[j * f.nx + i]); }
    const V = P * south.length * f.dx * f.dx, level = st.levelForVolume(south, f.dx * f.dx, V), hand = { rainOnTheSouthSideM3: V, pondLevelM: level, gutterDepthM: level - zg, crownM: 0.08, crownCellM: 0.07, kerbM: 0.15, lotBehindKerbM: 0, farGutterM: 0 };
    if (!ran) return { hand };
    const p = (id) => r.probes.find(q => q.id === id);
    R('kerb: depth in the gutter the rain fell beside (m)', 'numerical', hand.gutterDepthM, val(p('gutterS'), 'max'), { abs: C.detailDepthAbsM });
    R('kerb: depth on the lot behind the kerb (m)', 'numerical', 0, val(p('lotS'), 'max'), { abs: C.detailDryM });
    R('crown: depth in the far gutter (m)', 'numerical', 0, val(p('gutterN'), 'max'), { abs: C.detailDryM });
    return { hand, report: { wallSeconds: r.wallSeconds, cells: r.grid.cells } };
  }
  const V = P * 33, hand = { rainOnItsCatchmentM3: V, depthM: V / 9, capacityM3: 9 * 0.15 };
  if (!ran) return { hand };
  R('hollow: depth of water in it (m)', 'numerical', hand.depthM, val(r.probes[0], 'mean'), { abs: C.detailDepthAbsM });
  return { hand, report: { wallSeconds: r.wallSeconds, cells: r.grid.cells, deepestM: val(r.probes[0], 'max') } };
}

// ---------------------------------------------------------------- PV-SS11: surface only, an allowance, or pipes, against known answers
function ss11(spec, specs) {
  const C = spec.criteria, P = spec.parameters, g = P.grate.value, table = [];
  const out = collect(spec, Object.keys(P.cases.value), ({ id, exec, e, r }, R, ran) => {
    const fam = id.split('-')[1], d = e.drainage ?? { kind: 'none' }, trt = d.kind === 'pipe' ? 'pipe' : d.kind === 'lumped' ? `allowance ${d.mmhr} mm/h` : 'surface only';
    const def = buildCase(id, specs), rateAt = (t) => def.rain.find(b => t >= b.t0 - 1e-9 && t < b.t1 - 1e-9)?.rate ?? 0, depthP = def.rain.reduce((a, b) => a + b.rate * (b.t1 - b.t0), 0);
    let truth, what, sim = null, crit;
    if (fam === 'sagA' || fam === 'sagB') {
      const s = P.scenes.value.sag, area = s.L * s.W, tp = P.truePipes.value[fam], o = { L: tp.L, K: st.pipeK(tp.D, P.pipeN.value), Co: g.Co, A: g.A, Cw: g.Cw, P: g.P };
      if (fam === 'sagA') { const Q = Math.max(...def.rain.map(b => b.rate)) * area; truth = bisect((h) => st.inletFree(h, o) - Q, 0, 2); what = 'peak depth at the grate (m)'; if (ran) sim = Math.max(...r.series.map(q => q.probes.inlet[0])); }
      else { const f = SCENES.sagStreet(s), z = Array.from(f.z), hist = st.sagHistory({ inflow: (t) => rateAt(t) * area, stage: (V) => st.levelForVolume(z, 1, V), zs: 0, Hout: tp.stage, o, tEnd: e.tEnd, every: 10 });
        truth = Math.max(...hist.map(q => q.eta)); what = 'peak pond level in the sag (m)'; if (ran) sim = Math.max(...r.series.map(q => q.probes.sag[0])); }
      crit = lim(C.sagDepthAbsM, C.sagDepthRel, truth);
    } else if (fam === 'hollow') {
      truth = Math.min(P.scenes.value.hollow.depth, depthP * P.hollow.value.catchmentM2 / P.hollow.value.areaM2); what = 'depth in the hollow at the end (m)'; crit = { abs: C.hollowDepthAbsM };
      if (ran) sim = r.probes.find(q => q.id === 'hollow').final.mean;
    } else {
      const s = P.scenes.value.hill, G = P.hec22Grate.value, i = e.rain.mmhr * MMHR, Qg = i * s.W * G.x, E = st.grateEfficiency(Qg, s.n, s.Sx, s.SL, G.W, G.L), Qrem = i * s.W * 90.5 - E.E * Qg;
      truth = st.kerbCellDepth(st.gutterSpread(Qrem, s.n, s.Sx, s.SL), s.Sx); what = 'depth in the kerb cell 40 m below the grate (m)'; crit = lim(C.hillDepthAbsM, C.hillDepthRel, truth);
      if (ran) sim = r.probes.find(q => q.id === 'kerb').final.mean;
    }
    const hand = { trueDepthM: truth };
    if (!ran) return { hand };
    R(what, 'physical-model', truth, sim, crit, { note: trt });
    table.push({ case: id, exec, family: fam, storm: e.rain.ari ?? `${e.rain.mmhr} mm/h`, treatment: trt, trueM: truth, measuredM: sim, errorM: sim - truth, inside: Math.abs(sim - truth) <= crit.abs });
    return { hand, report: { treatment: trt, trueM: truth, measuredM: sim, errorM: sim - truth } };
  });
  out.table = table;
  return out;
}

// ---------------------------------------------------------------- PV-SS12: measures one owner can take
function ss12(spec, specs) {
  const C = spec.criteria, P = spec.parameters;
  const out = collect(spec, Object.keys(P.cases.value), ({ id, e, r }, R, ran) => {
    const def = buildCase(id, specs), f = def.probeFine, A = f.dx * f.dx, N = f.nx * f.ny, Pm = e.rain.mmhr * e.rain.minutes / 60 / 1000, T = e.tEnd;
    let open = 0; for (let k = 0; k < N; k++) if (!f.bld[k]) open++;
    const boxArea = (b) => { let n = 0; for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { const x = (i + 0.5) * f.dx, y = (j + 0.5) * f.dx; if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1 && !f.bld[j * f.nx + i]) n++; } return n * A; };
    const Vr = Pm * (e.heldRoof ? open * A : N * A); let taken = 0, hand = { rainReachingTheGroundM3: Vr };
    if (e.measure) { const Ag = boxArea(e.measure.box), si = st.storeIntake(e.measure.rateMmHr * MMHR, e.measure.store, P.nativeMmHr.value * MMHR, T); taken = Math.min(Vr, Ag * si.intake); Object.assign(hand, { measureAreaM2: Ag, storageM3: Ag * e.measure.store, fullAfterS: si.tFull, canTakeByTheEndM3: Ag * si.intake }); }
    if (e.soil) { const Ap = boxArea(e.soil.box); taken = Math.min(Vr, e.soil.mmhr * MMHR * Ap * T); Object.assign(hand, { soilAreaM2: Ap }); }
    const left = Vr - taken; Object.assign(hand, { takenM3: taken, leftOnTheGroundM3: left });
    if (!ran) return { hand };
    const end = r.series.at(-1);
    if (e.measure || e.soil) {
      R('water left on the ground at the end (m³)', 'numerical', left, end.volume, left > C.dryAbsM3 ? { rel: C.volumeRel } : { abs: C.dryAbsM3 });
      R('water the measure took (m³)', 'numerical', taken, end.infil, { rel: C.volumeRel });
    } else R('water on the ground at the end (m³)', 'numerical', Vr, end.volume, { rel: C.roofRel }, { note: e.heldRoof ? 'the roof holds its rain' : 'the roof sheds onto the ground (control)' });
    return { hand, report: { leftM3: end.volume, takenM3: end.infil, inTheStoreM3: end.giStored, depthAtTheLowEdgeM: r.probes[0].final.mean } };
  });
  if (!EXPECT) for (const u of P.unsupported.value) out.rows.push(row({ benchmark: spec.id, caseId: u.measure, quantity: u.why, errorType: 'physical-model', ref: null, sim: null, status: 'Unsupported' }));
  return out;
}

// ---------------------------------------------------------------- PV-SS10: the exchange law against the Sheffield rig
function ss10(spec) {
  const P = spec.parameters, D = P.inletDiameterM.value, o = { inletPerim: Math.PI * D, inletArea: Math.PI * D * D / 4, ...P.appCoefficients.value }, k = o.inletPerim * Math.sqrt(2 * 9.81), rows = [], T = P.tests.value;
  const fit = (h) => T.reduce((a, t) => a + t.QeRawLs / 1000 / (k * Math.pow(h(t), 1.5)), 0) / T.length;
  const hand = { appWeirCoefficient: o.Cw, paperEquivalent: [P.paperCi.value.lower, P.paperCi.value.expected, P.paperCi.value.upper].map(c => 2 / 3 * c), fittedToTheTests: fit(t => t.hsTableM), fittedWithRawP7Depths: fit(t => t.p7RawMm / 1000),
    grates2018EquivalentOnOuterCircumference: Object.fromEntries(P.grates2018.value.map(([g, cw, pv]) => [g, +(2 / 3 * cw * pv / o.inletPerim).toFixed(3)])) };
  if (!EXPECT) for (const t of T) rows.push(row({ benchmark: spec.id, caseId: `S1 test ${t.test} (h_s ${(1000 * t.hsTableM).toFixed(1)} mm)`, quantity: 'exchange into the sewer (l/s)', errorType: 'physical-model', ref: t.QeRawLs, sim: 1000 * inletFlow(t.hsTableM, 0, -1, 1, o, 0), crit: { rel: spec.criteria.exchangeRel } }));
  return { rows, cases: { coefficients: hand }, notRun: [], raw: {}, hand: { coefficients: hand } };
}

const SCORERS = { 'PV-SS10': ss10, 'PV-SS11': ss11, 'PV-SS12': ss12, 'PV-SS1': ss1, 'PV-SS2': ss2, 'PV-SS3': ss3, 'PV-SS4': ss4, 'PV-SS5': ss5, 'PV-SS6': ss6, 'PV-SS7': ss7, 'PV-SS8': ss8, 'PV-SS9': ss9 };
export async function run(spec, specs) { const f = SCORERS[spec.id]; if (!f) throw new Error('no scorer for ' + spec.id); return f(spec, specs); }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv.includes('--expect')) {
  EXPECT = true;
  const specs = Object.fromEntries(fs.readdirSync(path.join(here, '../spec')).filter(f => /^PV-.*\.json$/.test(f)).map(f => { const s = JSON.parse(fs.readFileSync(path.join(here, '../spec', f))); return [s.id, s]; }));
  const f4 = (v) => (typeof v === 'number' ? +v.toPrecision(5) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, w]) => [k, f4(w)])) : v);
  for (const id of Object.keys(SCORERS)) { const r = await run(specs[id], specs); console.log(`\n${id}  ${specs[id].title}`); for (const [c, h] of Object.entries(r.hand)) console.log('  ' + c.padEnd(16), JSON.stringify(f4(h))); }
}
