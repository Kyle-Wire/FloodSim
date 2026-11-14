// PV-TF1 (spec/PV-TF1.json): transient fill of an empty part-full conduit in a closed system, scored at rest.
// Two 20 m² tanks joined by a horizontal D 1.0 m, 400 m conduit cut into N segments; 180.0 m³ enters T1; the only
// outfall is behind a weir that must never flow. Scored only at rest, against the still-water level from the inputs.
//
// Everything is decided from the complete per-step record: every routing step's state is read into one matrix
// (the raw output, kept whole), and every check below is computed from that matrix after the run.
// Production engine for every scored case. The declared diagnostics are run the same way and are never scored.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { options, swmm } from '../lib/swmm-run.mjs';
import { loadSWMM, SWMM } from '../../../src/swmm.js';
import { row } from '../lib/score.mjs';
import * as V from '../references/volume.mjs';
import { area } from '../references/geometry.mjs';

const B = 'PV-TF1';
const here = path.dirname(fileURLToPath(import.meta.url));
const INSTRUMENTED = path.resolve(here, '../../culvert/instrumented/out/swmm.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// SWMM API codes (swmm5.h)
const G = { NODE_ELEV: 301, NODE_DEPTH: 303, NODE_HEAD: 304, NODE_VOLUME: 305, NODE_LATFLOW: 306, LINK_NODE1: 401, LINK_NODE2: 402, LINK_LENGTH: 403, LINK_SLOPE: 404,
  LINK_FULLDEPTH: 405, LINK_FLOW: 410, LINK_DEPTH: 411, LINK_VELOCITY: 412, LINK_VOLUME: 420 };
const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');

function inp(P, N, o) {
  const Ls = P.pipeLength.value / N, nodes = ['T1', ...Array.from({ length: N - 1 }, (_, k) => `J${k + 1}`), 'T2'];
  const tank = (n) => `${n} 0 ${P.tankDepth.value} 0 FUNCTIONAL 0 0 ${P.tankArea.value} 0 0`;
  return [options({ durationS: P.durationS.value, step: o.step, surcharge: 'EXTRAN', inertial: o.inertial, normalFlowLimited: 'BOTH', minSurfArea: o.minSurfArea }),
    ...(N > 1 ? ['[JUNCTIONS]', ...nodes.slice(1, -1).map(j => `${j} 0 ${P.tankDepth.value} 0 0 0`), ''] : []),
    '[STORAGE]', tank('T1'), tank('T2'), '',
    // SWMM refuses a network with no outfall (ERROR 145): OUT is reached only over a weir crest no level can reach
    '[OUTFALLS]', 'OUT 0 FREE NO', '',
    '[CONDUITS]', ...Array.from({ length: N }, (_, k) => `C${k + 1} ${nodes[k]} ${nodes[k + 1]} ${Ls} ${P.manningN.value} 0 0 0 0`), '',
    '[WEIRS]', `W0 T2 OUT TRANSVERSE ${P.sealCrest.value} 1.84 NO 0 0`, '',
    '[XSECTIONS]', ...Array.from({ length: N }, (_, k) => `C${k + 1} CIRCULAR ${P.pipeDiameter.value} 0 0 0 1`), 'W0 RECT_OPEN 0.3 1 0 0', '',
    '[TIMESERIES]', ...P.inflow.value.map(([t, q]) => `INF ${hms(t)} ${q}`), '',
    '[INFLOWS]', 'T1 FLOW INF FLOW 1.0 1.0', ''].join('\n');
}

/** V1: the offsets as written in the .inp SWMM opens (SWMM has no offset getter). */
function offsetsFromInp(text) {
  const sec = text.split('[CONDUITS]')[1].split('\n[')[0].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
  return sec.map(l => { const f = l.split(/\s+/); return { id: f[0], inOffset: Number(f[5]), outOffset: Number(f[6]) }; });
}

/** One SWMM run, every routing step recorded. Returns the matrix, its columns and the network description. */
async function runCase(engine, text, P, { volumes = false } = {}) {
  const e = engine; e.open(text);
  const gv = (c, i) => e._getValue(c, i);
  const nN = e.count('NODE'), nL = e.count('LINK');
  const nodeIds = Array(nN).fill(null), linkIds = Array(nL).fill(null);
  // names: resolve by probing the declared ids (SWMM's API in this build has no getId)
  const declaredNodes = ['T1', 'T2', 'OUT', ...Array.from({ length: 64 }, (_, k) => `J${k + 1}`)], declaredLinks = ['W0', ...Array.from({ length: 64 }, (_, k) => `C${k + 1}`)];
  for (const n of declaredNodes) { const i = e.index('NODE', n); if (i >= 0) nodeIds[i] = n; }
  for (const n of declaredLinks) { const i = e.index('LINK', n); if (i >= 0) linkIds[i] = n; }
  if (nodeIds.some(x => !x) || linkIds.some(x => !x)) throw new Error('PV-TF1: unresolved node or link name');
  const conduits = linkIds.map((id, i) => ({ id, i })).filter(x => x.id.startsWith('C'));
  const net = {
    nodes: nodeIds.map((id, i) => ({ id, i, elev: gv(G.NODE_ELEV, i) })),
    conduits: conduits.map(({ id, i }) => ({ id, i, node1: nodeIds[gv(G.LINK_NODE1, i)], node2: nodeIds[gv(G.LINK_NODE2, i)], length: gv(G.LINK_LENGTH, i), slope: gv(G.LINK_SLOPE, i), fullDepth: gv(G.LINK_FULLDEPTH, i) })),
    weir: { id: 'W0', i: e.index('LINK', 'W0'), node1: nodeIds[gv(G.LINK_NODE1, e.index('LINK', 'W0'))], node2: nodeIds[gv(G.LINK_NODE2, e.index('LINK', 'W0'))] },
  };
  const cols = ['t', 'dt'];
  for (const id of nodeIds) cols.push(`${id}.depth`, `${id}.head`, `${id}.volume`, `${id}.latflow`);
  for (const id of linkIds) cols.push(`${id}.depth`, `${id}.flow`, `${id}.velocity`, ...(volumes ? [`${id}.volume420`] : []));
  const nc = cols.length, cap = Math.ceil(P.durationS.value / 0.25) + 10;
  let M = new Float64Array(cap * nc), k = 0;
  // one swmm_step per row (src/swmm.js stepTo is not used: it drops the final step, for which swmm_step reports an
  // elapsed time of 0 once the run reaches its duration, swmm5.c lines 446-449). The final step's end time follows
  // SWMM's own rule (execRouting: the step is RouteStep, cut so the run's duration is not exceeded); it is flagged.
  const routeStep = gv(3, 0), Tdur = P.durationS.value; let tPrev = 0, finalStepByRule = null;
  for (;;) {
    e._check(e._step(e.buf), 'step');
    const el = e.M.getValue(e.buf, 'double') * 86400, end = el <= 0, t = end ? Math.min(tPrev + routeStep, Tdur) : el;
    if (k * nc + nc > M.length) throw new Error('PV-TF1: more steps than allocated');
    let o = k * nc; M[o++] = t; M[o++] = t - tPrev;
    for (let i = 0; i < nN; i++) { M[o++] = gv(G.NODE_DEPTH, i); M[o++] = gv(G.NODE_HEAD, i); M[o++] = gv(G.NODE_VOLUME, i); M[o++] = gv(G.NODE_LATFLOW, i); }
    for (let i = 0; i < nL; i++) { M[o++] = gv(G.LINK_DEPTH, i); M[o++] = gv(G.LINK_FLOW, i); M[o++] = gv(G.LINK_VELOCITY, i); if (volumes) M[o++] = gv(G.LINK_VOLUME, i); }
    k++; tPrev = t;
    if (end) { finalStepByRule = { step: k, t, routeStepS: routeStep, rule: 'swmm_step returned elapsed 0 (end of run): t = min(previous t + RouteStep, duration)' }; break; }
  }
  const rpt = e.finish();
  M = M.slice(0, k * nc);
  return { M, cols, steps: k, net, finalStepByRule, rpt, continuity: SWMM.continuity(rpt), version: e.version };
}

// SWMM's slope for a conduit whose end inverts differ by less than MIN_DELTA_Z (link.c conduit_getSlope), internal feet
const nominalSlope = (Lm) => { const Lft = Lm / 0.3048; return 0.001 / Math.sqrt(Lft * Lft - 1e-6); };
const warn04 = (rpt, id) => rpt.split('\n').some(l => l.trim() === `WARNING 04: minimum elevation drop used for Conduit ${id}`);

/** Every check of the spec, from the per-step matrix. */
function analyse(spec, r, N, declaredStep) {
  const P = spec.parameters, C = spec.criteria, D = P.pipeDiameter.value, T = P.durationS.value, nc = r.cols.length;
  const col = Object.fromEntries(r.cols.map((c, j) => [c, j])), at = (s, c) => r.M[s * nc + col[c]];
  const nodes = r.net.nodes.map(n => n.id), cond = r.net.conduits, junctions = nodes.filter(n => n.startsWith('J'));
  const out = { N, routingStepS: declaredStep, steps: r.steps };

  // hard validity conditions V1-V4 (exact for V1-V3; 1e-9 m for V4)
  const offs = offsetsFromInp(r.inpText);
  const v = {
    V1_offsets: offs.every(c => c.inOffset === 0 && c.outOffset === 0), offsets: offs,
    V2_nodeElev: r.net.nodes.every(n => n.elev === 0), nodeElev: r.net.nodes.map(n => [n.id, n.elev]),
    // V3: SWMM never stores 0 for a level conduit: conduit_getSlope (link.c 1257-1299) replaces an end-invert drop below
    // MIN_DELTA_Z (0.001 ft) by 0.001 ft and warns (WARN04). The slope of a conduit SWMM saw as level is therefore exactly
    // 0.001 / sqrt(L_ft^2 - 0.001^2), positive; any other value means SWMM saw a real drop
    V3_slope: cond.every(c => Math.abs(c.slope - nominalSlope(c.length)) <= 1e-12 * nominalSlope(c.length) && warn04(r.rpt, c.id)),
    slopes: cond.map(c => ({ id: c.id, LINK_SLOPE: c.slope, nominalForNoDrop: nominalSlope(c.length), warn04: warn04(r.rpt, c.id) })),
    V4_lengthAndFullDepth: cond.every(c => Math.abs(c.length - P.pipeLength.value / N) <= 1e-9 && Math.abs(c.fullDepth - D) <= 1e-9) && Math.abs(cond.reduce((a, c) => a + c.length, 0) - P.pipeLength.value) <= 1e-9,
    lengths: cond.map(c => [c.id, c.length]), fullDepths: cond.map(c => [c.id, c.fullDepth]), segments: cond.length,
  };
  v.ok = v.V1_offsets && v.V2_nodeElev && v.V3_slope && v.V4_lengthAndFullDepth && cond.length === N;
  out.hardValidity = v;

  // stepping: count and every step's length
  const expectSteps = Math.round(T / declaredStep);
  let worstDt = 0; for (let s = 0; s < r.steps; s++) worstDt = Math.max(worstDt, Math.abs(at(s, 'dt') - declaredStep));
  out.stepping = { finalStepByRule: r.finalStepByRule, expected: expectSteps, actual: r.steps, finalT: at(r.steps - 1, 't'), maxStepLengthDeviationS: worstDt, ok: r.steps === expectSteps && worstDt <= 1e-6 && Math.abs(at(r.steps - 1, 't') - T) <= 1e-6 };

  // full-conduit guard: G-node (both endpoints of every segment, from the API; plus every other node, OUT included), G-link
  const gnode = { max: -1 }, glink = { max: -1 }, perSegment = {}, perNode = {};
  for (const n of nodes) perNode[n] = 0;
  for (const c of cond) perSegment[c.id] = { maxLinkDepthOverD: 0, endpoints: [c.node1, c.node2], maxEndpointDepthOverD: 0 };
  for (let s = 0; s < r.steps; s++) {
    for (const n of nodes) { const d = at(s, `${n}.depth`), x = d / D; if (x > perNode[n]) perNode[n] = x; if (x > gnode.max) Object.assign(gnode, { max: x, depth: d, location: n, step: s + 1, t: at(s, 't') }); }
    for (const c of cond) {
      const d = at(s, `${c.id}.depth`), x = d / c.fullDepth, ps = perSegment[c.id];
      if (x > ps.maxLinkDepthOverD) ps.maxLinkDepthOverD = x;
      if (x > glink.max) Object.assign(glink, { max: x, depth: d, location: c.id, step: s + 1, t: at(s, 't') });
      for (const n of [c.node1, c.node2]) ps.maxEndpointDepthOverD = Math.max(ps.maxEndpointDepthOverD, at(s, `${n}.depth`) / D);
    }
  }
  const endpointNodes = [...new Set(cond.flatMap(c => [c.node1, c.node2]))];
  out.fullConduitGuard = {
    threshold: P.guardDepthFrac.value, conduitThreshold: P.conduitGuardDepthFrac.value,
    gNode: { ...gnode, nodesChecked: nodes, conduitEndpointsFromAPI: cond.map(c => [c.id, c.node1, c.node2]), everyEndpointChecked: endpointNodes.every(n => nodes.includes(n)), outfallChecked: nodes.includes('OUT'), outfallIsAConduitEndpoint: endpointNodes.includes('OUT'), perNodeMaxDepthOverD: perNode },
    gLink: { ...glink, perSegment },
  };
  out.fullConduitGuard.tripped = gnode.max >= P.guardDepthFrac.value || glink.max >= P.conduitGuardDepthFrac.value;

  // the sealing weir, every step: whole run, rest window, integral
  const inWin = (s) => at(s, 't') > T - C.restWindowS + 1e-9;
  let sealMax = 0, sealWin = 0, sealInt = 0, inflowRight = 0, inflowTrap = 0, prevQ = 0, junVolMax = 0, junVolAt = null, nodeVolRel = 0, nodeVolAt = null;
  for (let s = 0; s < r.steps; s++) {
    const q = Math.abs(at(s, 'W0.flow')), dt = at(s, 'dt'); sealMax = Math.max(sealMax, q); if (inWin(s)) sealWin = Math.max(sealWin, q); sealInt += q * dt;
    const lat = at(s, 'T1.latflow'); inflowRight += lat * dt; inflowTrap += 0.5 * (prevQ + lat) * dt; prevQ = lat;
    const jv = Math.abs(junctions.reduce((a, j) => a + at(s, `${j}.volume`), 0)); if (jv > junVolMax) { junVolMax = jv; junVolAt = { step: s + 1, t: at(s, 't') }; }
    for (const tk of ['T1', 'T2']) { const d = at(s, `${tk}.depth`), Ad = V.tankVolume(P.tankArea.value, d), e = Math.abs(at(s, `${tk}.volume`) - Ad) / Math.max(1e-9, Ad); if (e > nodeVolRel) { nodeVolRel = e; nodeVolAt = { tank: tk, step: s + 1, t: at(s, 't'), depth: d }; } }
  }
  out.seal = { maxAbsWholeRunM3s: sealMax, maxAbsRestWindowM3s: sealWin, integralAbsM3: sealInt };
  out.inflow = { declaredM3: P.inflowVolume.value, appliedRightEndpointM3: inflowRight, appliedTrapezoidM3: inflowTrap };
  out.junctionVolume = { junctions: junctions.length, maxAbsSumM3: junVolMax, at: junVolAt };
  out.nodeVolume = { maxRel: nodeVolRel, at: nodeVolAt };

  // rest (last restWindowS): samples every sampleS for the tank levels; every step for flows, weir, internal WSE
  const sIdx = []; for (let s = 0; s < r.steps; s++) { const t = at(s, 't'); if (t >= T - C.restWindowS - 1e-9 && Math.abs(t / P.sampleS.value - Math.round(t / P.sampleS.value)) < 1e-9) sIdx.push(s); }
  const last = r.steps - 1, first = sIdx[0];
  let levelDiff = { max: 0 }, segFlow = { max: 0 }, junWse = { max: 0 }, conWse = { max: 0 }, capBound = 0, winSteps = 0, levelDiffEveryStep = 0;
  for (const s of sIdx) { const x = Math.abs(at(s, 'T1.depth') - at(s, 'T2.depth')); if (x > levelDiff.max) levelDiff = { max: x, step: s + 1, t: at(s, 't') }; }
  const elev = Object.fromEntries(r.net.nodes.map(n => [n.id, n.elev]));
  for (let s = 0; s < r.steps; s++) {
    if (!inWin(s)) continue; winSteps++;
    const tank = 0.5 * (at(s, 'T1.head') + at(s, 'T2.head'));
    levelDiffEveryStep = Math.max(levelDiffEveryStep, Math.abs(at(s, 'T1.depth') - at(s, 'T2.depth')));
    for (const c of cond) {
      const q = Math.abs(at(s, `${c.id}.flow`)); if (q > segFlow.max) segFlow = { max: q, location: c.id, step: s + 1, t: at(s, 't') };
      const y = at(s, `${c.id}.depth`); if (y >= c.fullDepth) capBound++;
      const zMid = 0.5 * (elev[c.node1] + 0 + elev[c.node2] + 0); // horizontal, zero-offset invert assumption (hardValidityConditions)
      const dev = Math.abs(zMid + y - tank); if (dev > conWse.max) conWse = { max: dev, location: c.id, step: s + 1, t: at(s, 't') };
    }
    for (const j of junctions) { const dev = Math.abs(at(s, `${j}.head`) - tank); if (dev > junWse.max) junWse = { max: dev, location: j, step: s + 1, t: at(s, 't') }; }
  }
  const drift = Object.fromEntries(['T1', 'T2'].map(tk => [tk, Math.abs(at(last, `${tk}.depth`) - at(first, `${tk}.depth`))]));
  const cond_ = {
    levelDiff: { ...levelDiff, limit: C.restLevelDiffM, samples: sIdx.length, ok: levelDiff.max <= C.restLevelDiffM },
    levelDrift: { ...drift, from: at(first, 't'), to: at(last, 't'), limit: C.restLevelDriftM, ok: Math.max(drift.T1, drift.T2) <= C.restLevelDriftM },
    segmentFlow: { ...segFlow, limit: C.restSegmentFlowAbsM3s, ok: segFlow.max <= C.restSegmentFlowAbsM3s },
    sealWeir: { maxAbs: sealWin, limit: C.sealFluxAbs, ok: sealWin <= C.sealFluxAbs },
    internalWseJunctions: { ...junWse, limit: C.restInternalWseAbsM, junctions: junctions.length, ok: junWse.max <= C.restInternalWseAbsM },
    internalWseConduits: { ...conWse, limit: C.restInternalWseAbsM, capBoundSteps: capBound, ok: conWse.max <= C.restInternalWseAbsM && capBound === 0 },
  };
  out.rest = { windowS: C.restWindowS, windowSteps: winSteps, levelDiffEveryStepM: levelDiffEveryStep, conditions: cond_, atRest: Object.values(cond_).every(x => x.ok) };

  // the at-rest books (the last routing step)
  const s0 = { shape: 'circle', D }, dEnd = [at(last, 'T1.depth'), at(last, 'T2.depth')], hEnd = 0.5 * (dEnd[0] + dEnd[1]);
  const jv = junctions.reduce((a, j) => a + at(last, `${j}.volume`), 0);
  const tanks = V.tankVolume(P.tankArea.value, dEnd[0]) + V.tankVolume(P.tankArea.value, dEnd[1]), pipe = P.pipeLength.value * area(s0, Math.min(D, hEnd));
  const perSegPipe = cond.reduce((a, c) => a + c.length * area(s0, Math.min(D, at(last, `${c.id}.depth`))), 0);
  out.books = { V0: 0, inflow: P.inflowVolume.value, reference: P.inflowVolume.value, tanksM3: tanks, conduitAtCommonLevelM3: pipe, junctionsM3: jv, totalM3: tanks + pipe + jv,
    reported_conduitFromEachSegmentLinkDepthM3: perSegPipe, hEnd, dEnd, t: at(last, 't') };

  // reported, not scored: the closure in motion at every sample (DIAGNOSTIC ONLY: transientStatement), max depth / D
  const motion = []; let inflow = 0; for (let s = 0; s < r.steps; s++) { inflow += at(s, 'T1.latflow') * at(s, 'dt'); const t = at(s, 't'); if (Math.abs(t / P.sampleS.value - Math.round(t / P.sampleS.value)) > 1e-9) continue;
    const v_ = V.tankVolume(P.tankArea.value, at(s, 'T1.depth')) + V.tankVolume(P.tankArea.value, at(s, 'T2.depth')) + cond.reduce((a, c) => a + c.length * area(s0, Math.min(D, at(s, `${c.id}.depth`))), 0) + junctions.reduce((a, j) => a + at(s, `${j}.volume`), 0);
    motion.push([t, v_ - inflow]); }
  out.reportedNotScored = { swmmContinuity: r.continuity, closureInMotionDiagnosticOnly: { note: 'DIAGNOSTIC ONLY (transientStatement): tanks A d + sum L_i A(LINK_DEPTH_i) + junction volume, minus the applied inflow so far, every sampleS', maxAbsM3: Math.max(...motion.map(x => Math.abs(x[1]))), series: motion } };
  return out;
}

/** The scored rows of one case. */
function rows(spec, caseId, a) {
  const C = spec.criteria, out = [], invalidAll = !a.hardValidity.ok || !a.stepping.ok;
  const invalidRest = invalidAll || a.fullConduitGuard.tripped || a.seal.maxAbsWholeRunM3s > 0;
  const why = [!a.hardValidity.ok && 'a hard validity condition is not met', !a.stepping.ok && 'the routing step count or length is not as declared',
    a.fullConduitGuard.tripped && 'the full-conduit guard tripped', a.seal.maxAbsWholeRunM3s > 0 && 'the sealing weir flowed'].filter(Boolean).join('; ');
  const restStatus = invalidRest ? 'Invalid setup' : a.rest.atRest ? null : 'Insufficient reference data';
  const restNote = invalidRest ? why : a.rest.atRest ? null : `not at rest: ${Object.entries(a.rest.conditions).filter(([, x]) => !x.ok).map(([k]) => k).join(', ')}`;
  const allStatus = invalidAll ? 'Invalid setup' : null;
  out.push(row({ benchmark: B, caseId, quantity: 'volume closure at rest: tanks A d + conduit L A(h) + junction volume, against V0 + 180.0 m³', errorType: 'accounting', ref: a.books.reference, sim: a.books.totalM3, crit: { rel: C.closureRel }, unit: 'm³', status: restStatus, note: restNote }));
  out.push(row({ benchmark: B, caseId, quantity: 'common level at rest, against the still-water level from the inputs', errorType: 'numerical', ref: a.hEq, sim: a.books.hEnd, crit: { abs: C.equilibriumAbsM }, unit: 'm', status: restStatus, note: restNote }));
  if (a.junctionVolume.junctions > 0) out.push(row({ benchmark: B, caseId, quantity: 'junction volume: |sum of NODE_VOLUME over the junctions|, largest at any routing step (R4)', errorType: 'accounting', ref: 0, sim: a.junctionVolume.maxAbsSumM3, crit: { abs: C.junctionVolumeAbsM3 }, unit: 'm³', status: allStatus, note: allStatus ? why : null }));
  for (const [q, v] of [['largest |flow| over the sealing weir, any routing step of the run', a.seal.maxAbsWholeRunM3s], ['largest |flow| over the sealing weir, any routing step of the rest window', a.seal.maxAbsRestWindowM3s]])
    out.push(row({ benchmark: B, caseId, quantity: `boundary flux: ${q}`, errorType: 'accounting', ref: 0, sim: v, crit: { abs: C.sealFluxAbs }, unit: 'm³/s', status: allStatus, note: allStatus ? why : null }));
  out.push(row({ benchmark: B, caseId, quantity: 'boundary flux: integral of |flow| over the sealing weir over the run', errorType: 'accounting', ref: 0, sim: a.seal.integralAbsM3, crit: { abs: C.sealFluxAbs }, unit: 'm³', status: allStatus, note: allStatus ? why : null }));
  out.push(row({ benchmark: B, caseId, quantity: "SWMM's tank node volume against A d, largest relative difference at any routing step (internal consistency)", errorType: 'accounting', ref: 0, sim: a.nodeVolume.maxRel, crit: { abs: C.nodeVolumeRel }, status: allStatus, note: allStatus ? why : 'internal consistency of SWMM storage, not a closure' }));
  return out;
}

function rawFiles(caseId, r, spec, specSha, wasm) {
  const gz = zlib.gzipSync(Buffer.from(r.M.buffer, r.M.byteOffset, r.M.byteLength), { level: 9 });
  const header = { benchmark: B, case: caseId, format: 'little-endian Float64, row-major, one row per routing step (state at the end of the step), gzip', columns: r.cols,
    units: { t: 's (end of step)', dt: 's', depth: 'm', head: 'm (SWMM datum)', volume: 'm³', latflow: 'm³/s', flow: 'm³/s', velocity: 'm/s', volume420: 'm³ (instrumented build only)' },
    rows: r.steps, bytesUncompressed: r.M.byteLength, gzSha256: sha(gz), specFile: 'benchmarks/physics/spec/PV-TF1.json', specSha256: specSha, swmmVersion: r.version, wasm, network: r.net, inp: r.inpText };
  return { [`PV-TF1-raw-${caseId}.f64.gz`]: gz, [`PV-TF1-raw-${caseId}.json`]: JSON.stringify(header, null, 1) };
}

export async function run(spec) {
  const P = spec.parameters, specSha = sha(fs.readFileSync(spec._file)), s0 = { shape: 'circle', D: P.pipeDiameter.value };
  const hEq = V.equilibriumDepth([{ A: P.tankArea.value }, { A: P.tankArea.value }], s0, P.pipeLength.value, P.inflowVolume.value);
  const prodWasm = sha(fs.readFileSync(path.resolve(here, '../../../vendor/swmm-wasm/swmm.wasm')));
  const reference = { hEq, declaredReferenceLevel: P.referenceLevel.value, declaredMinusComputed: P.referenceLevel.value - hEq,
    conduitAtRestM3: P.pipeLength.value * area(s0, hEq), tanksAtRestM3: 2 * P.tankArea.value * hEq };
  const base = { step: P.routingStepS.value, inertial: 'PARTIAL', minSurfArea: P.minSurfArea.value };
  const variants = [
    { key: '', scored: true, o: base },
    { key: '-dt0.5', scored: false, o: { ...base, step: 0.5 }, what: 'diagnostic: routing step 0.5 s' },
    { key: '-msa0.1', scored: false, o: { ...base, minSurfArea: 0.1 }, what: 'diagnostic: MIN_SURFAREA 0.1 m² (separates P2b)' },
    { key: '-inertialNONE', scored: false, o: { ...base, inertial: 'NONE' }, what: 'diagnostic: INERTIAL_DAMPING NONE (relation to F2)' },
  ];
  const out = { rows: [], cases: { reference }, files: {} };
  const prod = await swmm();
  for (const N of P.segments.value) for (const vr of variants) {
    const caseId = `N${N}${vr.key}`, text = inp(P, N, vr.o);
    const r = await runCase(prod, text, P); r.inpText = text;
    const a = analyse(spec, r, N, vr.o.step); a.hEq = hEq;
    a.config = { engine: 'production', wasmSha256: prodWasm, swmmVersion: r.version, options: vr.o, inpSha256: sha(text), scored: vr.scored, what: vr.what ?? 'registered case' };
    a.swmmVersion = r.version;
    out.cases[caseId] = a;
    if (vr.scored) out.rows.push(...rows(spec, caseId, a));
    Object.assign(out.files, rawFiles(caseId, r, spec, specSha, { file: 'vendor/swmm-wasm/swmm.wasm', sha256: prodWasm }));
    console.log(`  ${caseId}: steps ${a.steps}, guard node ${a.fullConduitGuard.gNode.max.toFixed(4)} link ${a.fullConduitGuard.gLink.max.toFixed(4)}, at rest ${a.rest.atRest}, books ${a.books.totalM3.toFixed(4)} m³, h ${a.books.hEnd.toFixed(5)}`);
    // diagnostic: the instrumented build's conduit volume (getter 420), used only if every recorded value of this
    // registered case is identical between the two builds
    if (vr.scored) {
      let d = { caseId: `${caseId}-getter420`, what: 'diagnostic: instrumented build, conduit volume (getter 420) as a decomposition only' };
      if (!fs.existsSync(INSTRUMENTED)) d.status = `not run: ${path.relative(path.resolve(here, '../../..'), INSTRUMENTED)} absent`;
      else {
        const ie = await loadSWMM(pathToFileURL(INSTRUMENTED).href), ri = await runCase(ie, text, P, { volumes: true }); ri.inpText = text; ie.dispose?.();
        const iw = sha(fs.readFileSync(INSTRUMENTED.replace(/\.mjs$/, '.wasm')));
        let maxDiff = 0, compared = 0; const ci = Object.fromEntries(ri.cols.map((c, j) => [c, j]));
        if (ri.steps === r.steps) for (let s = 0; s < r.steps; s++) for (let j = 0; j < r.cols.length; j++) { maxDiff = Math.max(maxDiff, Math.abs(r.M[s * r.cols.length + j] - ri.M[s * ri.cols.length + ci[r.cols[j]]])); compared++; }
        const equal = ri.steps === r.steps && maxDiff === 0, last = ri.steps - 1, nc = ri.cols.length;
        d = { ...d, wasmSha256: iw, steps: ri.steps, valuesCompared: compared, maxAbsDifferenceFromProduction: maxDiff, identical: equal,
          finalLinkVolume420M3: equal ? Object.fromEntries(r.net.conduits.map(c => [c.id, ri.M[last * nc + ci[`${c.id}.volume420`]]])) : 'not used: the builds differ',
          finalLinkVolume420SumM3: equal ? r.net.conduits.reduce((a_, c) => a_ + ri.M[last * nc + ci[`${c.id}.volume420`]], 0) : null };
        Object.assign(out.files, rawFiles(`${caseId}-getter420`, ri, spec, specSha, { file: 'benchmarks/culvert/instrumented/out/swmm.wasm', sha256: iw }));
      }
      out.cases[d.caseId] = d;
    }
  }
  return out;
}
