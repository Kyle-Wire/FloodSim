// One culvert in SWMM alone, built through FloodSim's production path: the canonical conduit → swmmSection
// (src/swmm-xsect.js, frozen Stage A translation) → toINP (src/drainage.js). Upstream: a junction (the headwater pool,
// no velocity head). Downstream: an outfall, FREE or held at a tailwater stage with setOutfallStage, as the coupler does
// for stream outfalls. Steady inflow is put on the upstream node with setLatFlow, as the coupler puts surface water in.

import { swmmSection } from '../../src/swmm-xsect.js';
import { toINP } from '../../src/drainage.js';
import { SWMM } from '../../src/swmm.js';

export const IN = 0.0254;
export const conduit = (shape, rise, span, material = null, n = null, barrels = 1) =>
  ({ section: { shape, rise, span: shape === 'circle' ? rise : span, barrels }, material, roughness: { n }, condition: { sediment: null } });

/**
 * Build the .inp. o: { asset, L, S, z0 (upstream invert), entrance: bool, exit: bool, entranceType, losses (override
 * { entry, exit }), code (override, 0 = none), sed, reverse (the conduit written from the outlet node to the inlet node) }.
 */
export function buildINP(o) {
  const { asset, L = 30, S = 0.01, z0 = 10, sed = 0, durationS = 3600 } = o;
  const role = o.role === null ? null : { entrance: o.entrance ?? true, exit: o.exit ?? true, entranceType: o.entranceType ?? null, entranceProv: 'benchmark' };
  const x = swmmSection(asset, { role, sed, nDefault: 0.013, name: 'C1', cfg: o.cfg ?? {} });
  if (x.error) throw new Error(x.error);
  if (o.code != null) x.culvert = o.code;
  if (o.losses !== undefined) x.loss = o.losses; // null: no [LOSSES] line at all
  const up = { name: 'HW', invert: z0, depth: o.hwDepth ?? 25, p: [0, 0] }, dn = { name: 'TW', invert: z0 - S * L, depth: 25, outfall: true, outfallType: o.outfallType ?? 'FREE', p: [L, 0] };
  const nodes = o.reverse ? [dn, up] : [up, dn];
  if (o.reverse) { dn.outfall = false; up.outfall = true; } // the receiving pool is upstream: flow comes in at the outlet end
  const pipe = { name: 'C1', from: o.reverse ? 1 : 0, to: o.reverse ? 0 : 1, L, n: x.n, inOffset: x.offsetRise, outOffset: x.offsetRise, xs: x };
  if (o.conduitFromLow) { pipe.from = 1; pipe.to = 0; } // drawn backwards: SWMM reverses an adverse conduit itself
  const net = { nodes, pipes: [pipe], opts: { n: 0.013, surDepth: 0 } };
  let inp = toINP(net, { x0: 0, y1: 0, dx: 1 }, { durationS, routing: o.routing ?? {} });
  // a held tailwater: start the inflow node at that level, so the barrel is not first filled backwards from the
  // outfall (SWMM does not count water an outfall stage pushes in as inflow, and its continuity would show it as error)
  if (o.initElev != null) { const j = nodes.find(nd => !nd.outfall); inp = inp.replace(new RegExp('^(' + j.name + ' +\\S+ +\\S+ +)0 ', 'm'), `$1${Math.max(0, o.initElev - j.invert).toFixed(3)} `); }
  // and the outfall FIXED at that stage from the start (the runner also holds it with setOutfallStage, as the coupler does)
  if (o.initElev != null) { const of = nodes.find(nd => nd.outfall); inp = inp.replace(new RegExp('^(' + of.name + ' +\\S+ +)FREE( +)', 'm'), `$1FIXED      ${o.initElev.toFixed(3)}  `); }
  return { inp, x, net };
}

/**
 * Run to steady state at inflow Q (m³/s) and return the means over the last `avgS` seconds.
 * tw: null for a FREE outfall, else the tailwater elevation (m).
 */
export function runSteady(swmm, o, Q, { tw = null, rampS = 300, holdS = 1500, avgS = 300 } = {}) {
  const { inp, x } = buildINP({ ...o, durationS: rampS + holdS + 60, initElev: tw });
  swmm.open(inp);
  const iIn = swmm.index('NODE', o.reverse ? 'TW' : 'HW'), iOut = swmm.index('NODE', o.reverse ? 'HW' : 'TW'), iL = swmm.index('LINK', 'C1');
  if (tw != null) swmm.setOutfallStage(iOut, tw);
  let t = 0, volIn = 0, volOut = 0, n = 0; const acc = { h1: 0, h2: 0, d1: 0, d2: 0, q: 0, v: 0 }, series = [];
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
  }
  const stored = swmm.node('VOLUME', iIn) - v0 + 0; // the barrel's own volume is in SWMM's own continuity, below
  const rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  for (const k in acc) acc[k] /= n;
  const drift = Math.max(...series) - Math.min(...series);
  return { ...acc, Q, x, drift, mass: { volIn, volOut, storedAtNode: stored, swmmErrorPct: cont.errorPct, steadyFlowErrPct: 100 * (Math.abs(acc.q) - Q) / Q } };
}

export async function swmmEngine() { const { loadSWMM } = await import('../../src/swmm.js'); return loadSWMM(); }
