// Diagnostic (unscored): why the one-pipe cases under surcharge read low and wobble (PV-SS3 case a, PV-SS4 cases a
// and d). The registered case is re-run on the CPU executor with one thing changed at a time, and every exchange
// between the street and the manhole is recorded: the street depth at the grate, the manhole head, the rate set.
//   as registered · EXTRAN instead of SLOT · exchange every 0.5 s with SWMM stepping at most 0.25 s · both
// (The exchange interval cannot go below SWMM's routing step: the coupler hands SWMM a lateral flow for an interval,
// and an interval SWMM has already stepped past is dropped. A first version of this diagnostic did that; its output
// was discarded.)
//   node benchmarks/physics/street/diagnostics/one-pipe.mjs   → diagnostics/out/one-pipe.json
import fs from 'node:fs';
import { loadSWMM, SWMM } from '../../../../src/swmm.js';
import { Coupler } from '../../../../src/coupler.js';
import { toINP } from '../../../../src/drainage.js';
import { buildCase } from '../cases.mjs';
import { CpuSim, loadSpecs } from '../exec-cpu.mjs';

const specs = loadSpecs(), out = [];
const VARIANTS = [['as registered', {}], ['EXTRAN', { surcharge: 'EXTRAN' }], ['exchange 0.5 s, SWMM 0.25 s', { interval: 0.5, routingStep: 0.25 }], ['EXTRAN, exchange 0.5 s, SWMM 0.25 s', { surcharge: 'EXTRAN', interval: 0.5, routingStep: 0.25 }]];
for (const id of ['SS3-a', 'SS4-d', 'SS4-a']) for (const [name, v] of VARIANTS) {
  const def = buildCase(id, specs), c = def.c, cu = def.coupled, interval = v.interval ?? cu.interval;
  const inp = v.surcharge || v.routingStep ? toINP(cu.net, { x0: 0, y1: c.ny * c.dx, dx: 1 }, { durationS: Math.ceil(def.tEnd / 60) * 60 + 3600, pressurise: cu.twoWay, surcharge: v.surcharge ?? 'SLOT', routingStep: v.routingStep ?? 1 }) : cu.inp;
  const sim = new CpuSim(def.opts); sim.setDepth(() => 0);
  const swmm = await loadSWMM(); swmm.open(inp);
  const cp = new Coupler(sim, cu.net, swmm, c.z, { interval, twoWay: cu.twoWay });
  const rate = (t) => def.rain.find(b => t >= b.t0 - 1e-9 && t < b.t1 - 1e-9)?.rate ?? 0, sag = def.probes.find(p => p.id === 'sag').cells, ex = [];
  while (sim.t < def.tEnd - 1e-9) {
    sim.rainRate = rate(sim.t); await sim.advance(Math.min(def.tEnd, cp.tNext));
    if (sim.t >= cp.tNext - 1e-6) { const { vol, h } = await sim.readInlets(); const q = cp.step(vol, h, interval, cp.tNext); sim.setInletRates(q); cp.tNext += interval; ex.push([sim.t, h[0], cp.state.head[0], q[0], vol[0]]); }
  }
  const s = await sim.readState(), level = sag.reduce((a, k) => a + s.h[k], 0) / sag.length, cont = SWMM.continuity(swmm.finish()); swmm.dispose?.();
  const last = ex.filter(e => e[0] > def.tEnd - 600), mean = (k) => last.reduce((a, e) => a + e[k], 0) / last.length, sd = (k) => { const m = mean(k); return Math.sqrt(last.reduce((a, e) => a + (e[k] - m) ** 2, 0) / last.length); };
  const flips = last.slice(1).filter((e, j) => Math.sign(e[3]) !== Math.sign(last[j][3])).length;
  const r = { case: id, variant: name, sagLevelEndM: level, last600s: { meanHeadM: mean(2), sdHeadM: sd(2), meanRateM3s: mean(3), sdRateM3s: sd(3), rateSignChanges: flips, exchanges: last.length }, toNetworkM3: cp.totals.toNetwork, toSurfaceM3: cp.totals.toSurface, swmmContinuityPct: cont.errorPct, window: ex.filter(e => e[0] > def.tEnd - 40).map(e => e.map(x => +x.toFixed(5))) };
  out.push(r);
  console.log(`${id}  ${name.padEnd(36)} sag level ${level.toFixed(4)} m   manhole head, last 600 s: mean ${r.last600s.meanHeadM.toFixed(4)} sd ${r.last600s.sdHeadM.toFixed(4)} m   rate: mean ${r.last600s.meanRateM3s.toFixed(5)} sd ${r.last600s.sdRateM3s.toFixed(5)} m³/s, ${flips} sign changes in ${last.length}   SWMM continuity ${cont.errorPct} %`);
}
fs.writeFileSync(new URL('./out/one-pipe.json', import.meta.url), JSON.stringify(out, null, 1));
