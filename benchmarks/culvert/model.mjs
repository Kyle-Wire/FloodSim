// One culvert in SWMM alone, built through FloodSim's production path: the canonical conduit → swmmSection
// (src/swmm-xsect.js, frozen Stage A translation) → toINP (src/drainage.js). Upstream: a junction (the headwater pool,
// no velocity head). Downstream: an outfall, FREE or held at a tailwater stage with setOutfallStage, as the coupler does
// for stream outfalls. Steady inflow is put on the upstream node with setLatFlow, as the coupler puts surface water in.

import { swmmSection } from '../../src/swmm-xsect.js';
import { toINP } from '../../src/drainage.js';
import { SWMM } from '../../src/swmm.js';

export const IN = 0.0254;
export const conduit = (shape, rise, span, material = null, n = null, barrels = 1, standard = null) =>
  ({ section: { shape, rise, span: shape === 'circle' ? rise : span, barrels, standard }, material, roughness: { n }, condition: { sediment: null } });

/**
 * Build the .inp. o: { asset, L, S, z0 (upstream invert), entrance: bool, exit: bool, entranceType, losses (override
 * { entry, exit }), code (override, 0 = none), sed, reverse (the conduit written from the outlet node to the inlet node) }.
 */
export function buildINP(o) {
  const { asset, L = 30, S = 0.01, z0 = 10, sed = 0, durationS = 3600 } = o;
  // segments > 1: the one culvert as several conduits in a chain, as the network writes a crossing of several records:
  // the code and entrance loss on the first (entrance) length, the exit loss on the last, the middle lengths plain
  // segL: the lengths of the segments, from the inflow end (unequal records, as a real crossing has); default equal
  const N = o.segL?.length ?? o.segments ?? 1, segL = o.segL ?? Array.from({ length: N }, () => L / N), at = segL.map((_, k) => segL.slice(0, k + 1).reduce((a, b) => a + b, 0));
  if (o.segL && Math.abs(at[N - 1] - L) > 1e-6) throw new Error('segL must sum to L');
  const roleOf = (k) => o.role === null ? null : { entrance: (o.entrance ?? true) && k === 0, exit: (o.exit ?? true) && k === N - 1, entranceType: o.entranceType ?? null, entranceProv: 'benchmark' };
  const xs = Array.from({ length: N }, (_, k) => {
    const x = swmmSection(asset, { role: roleOf(k), sed, nDefault: 0.013, name: 'C' + (k + 1), cfg: o.cfg ?? {} });
    if (x.error) throw new Error(x.error);
    if (k === 0 && o.code != null) x.culvert = o.code;
    if (o.losses !== undefined && (k === 0 || k === N - 1)) x.loss = o.losses; // null: no [LOSSES] line at all
    return x;
  });
  const x = xs[0];
  const up = { name: 'HW', invert: z0, depth: o.hwDepth ?? 25, p: [0, 0] }, dn = { name: 'TW', invert: z0 - S * L, depth: 25, outfall: true, outfallType: o.outfallType ?? 'FREE', p: [L, 0] };
  const mids = Array.from({ length: N - 1 }, (_, k) => ({ name: 'J' + (k + 1), invert: z0 - S * at[k], depth: 25, p: [at[k], 0] }));
  const nodes = o.reverse ? [dn, up, ...mids] : [up, dn, ...mids];
  if (o.reverse) { dn.outfall = false; up.outfall = true; } // the receiving pool is upstream: flow comes in at the outlet end
  const iUp = o.reverse ? 1 : 0, iDn = o.reverse ? 0 : 1, chain = [iUp, ...mids.map((_, k) => 2 + k), iDn];
  const pipes = xs.map((xk, k) => ({ name: 'C' + (k + 1), from: chain[k], to: chain[k + 1], L: segL[k], n: xk.n, inOffset: xk.offsetRise, outOffset: xk.offsetRise, xs: xk }));
  if (o.conduitFromLow) { if (N > 1) throw new Error('conduitFromLow is for one length'); pipes[0].from = 1; pipes[0].to = 0; } // drawn backwards: SWMM reverses an adverse conduit itself
  const net = { nodes, pipes, opts: { n: 0.013, surDepth: 0 } };
  let inp = toINP(net, { x0: 0, y1: 0, dx: 1 }, { durationS, routing: o.routing ?? {} });
  // a held tailwater: start the inflow node at that level, so the barrel is not first filled backwards from the
  // outfall (SWMM does not count water an outfall stage pushes in as inflow, and its continuity would show it as error)
  if (o.initElev != null) for (const j of nodes.filter(nd => !nd.outfall)) inp = inp.replace(new RegExp('^(' + j.name + ' +\\S+ +\\S+ +)0 ', 'm'), `$1${Math.max(0, o.initElev - j.invert).toFixed(3)} `);
  // and the outfall FIXED at that stage from the start (the runner also holds it with setOutfallStage, as the coupler does)
  if (o.initElev != null) { const of = nodes.find(nd => nd.outfall); inp = inp.replace(new RegExp('^(' + of.name + ' +\\S+ +)FREE( +)', 'm'), `$1FIXED      ${o.initElev.toFixed(3)}  `); }
  return { inp, x, net };
}

/**
 * Run to steady state at inflow Q (m³/s) and return the means over the last `avgS` seconds.
 * tw: null for a FREE outfall, else the tailwater elevation (m).
 */
export function runSteady(swmm, o, Q, { tw = null, rampS = 300, holdS = 1500, avgS = 300, trace = false } = {}) {
  const { inp, x } = buildINP({ ...o, durationS: rampS + holdS + 60, initElev: tw });
  swmm.open(inp);
  const iIn = swmm.index('NODE', o.reverse ? 'TW' : 'HW'), iOut = swmm.index('NODE', o.reverse ? 'HW' : 'TW'), iL = swmm.index('LINK', 'C1');
  if (tw != null) swmm.setOutfallStage(iOut, tw);
  let t = 0, volIn = 0, volOut = 0, n = 0; const acc = { h1: 0, h2: 0, d1: 0, d2: 0, q: 0, v: 0 }, series = [], ts = [];
  const v0 = swmm.node('VOLUME', iIn);
  while (t < rampS + holdS - 1e-6) {
    const q = Q * Math.min(1, (t + 5) / rampS); swmm.setLatFlow(iIn, q);
    if (tw != null) swmm.setOutfallStage(iOut, tw);
    const t1 = Math.min(t + 5, rampS + holdS);
    swmm.stepTo(t1, (dt) => { volIn += q * dt; volOut += Math.abs(swmm.link('FLOW', iL)) * dt; });
    t = t1;
    if (t > rampS + holdS - avgS) {
      acc.h1 += swmm.node('HEAD', iIn); acc.h2 += swmm.node('HEAD', iOut); acc.d1 += swmm.node('DEPTH', iIn); acc.d2 += swmm.node('DEPTH', iOut);
      acc.q += swmm.link('FLOW', iL); acc.v += swmm.link('VELOCITY', iL); n++;
      series.push(swmm.node('HEAD', iIn));
    }
    // trace: the whole run, every 5 s (time, both node depths and heads, link flow, depth and velocity)
    if (trace) ts.push([t, swmm.node('DEPTH', iIn), swmm.node('DEPTH', iOut), swmm.node('HEAD', iIn), swmm.node('HEAD', iOut), swmm.link('FLOW', iL), swmm.link('DEPTH', iL), swmm.link('VELOCITY', iL)]);
  }
  const z1 = swmm.node('HEAD', iIn) - swmm.node('DEPTH', iIn); // the inflow node's invert
  const stored = swmm.node('VOLUME', iIn) - v0 + 0; // the barrel's own volume is in SWMM's own continuity, below
  const rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  for (const k in acc) acc[k] /= n;
  const drift = Math.max(...series) - Math.min(...series);
  return { ...acc, Q, x, drift, d1Min: Math.min(...series) - z1, d1Max: Math.max(...series) - z1, ...(trace ? { trace: { cols: ['t', 'd1', 'd2', 'h1', 'h2', 'q', 'linkDepth', 'v'], rows: ts } } : {}), mass: { volIn, volOut, storedAtNode: stored, swmmErrorPct: cont.errorPct, steadyFlowErrPct: 100 * (Math.abs(acc.q) - Q) / Q } };
}

// FLOODSIM_SWMM_MJS (benchmarks only): another build of the engine, e.g. instrumented/out/swmm.mjs; unset = production
export async function swmmEngine() { const { loadSWMM } = await import('../../src/swmm.js'); const alt = process.env.FLOODSIM_SWMM_MJS; return alt ? loadSWMM((await import('node:url')).pathToFileURL(alt).href) : loadSWMM(); }
