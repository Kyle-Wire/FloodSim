// Gate C, Davis: run the FloodSim translation (GPU surface + SWMM pipes, coupled at the 131 top inlets) over the
// HEC-RAS plan (36 h, rain 33 mm in 7 h) and record what HEC-RAS reports every 10 minutes.
import { GPUSolver } from '../../../src/solver-gpu.js';
import { loadSWMM, SWMM } from '../../../src/swmm.js';
import { Coupler } from '../../../src/coupler.js';
import { davisINP, couplerNet } from './davis-swmm.mjs';

/** opts.dsStage: downstream channel level for the pump outlet, [[t s, m]] (from HEC-RAS) or a number. */
export async function runDavis(device, model, { dsStage, interval = 2, outDt = 600, twoWay = false, log = () => {} } = {}) {
  const { nx, ny, dx } = model.grid, N = nx * ny, net = couplerNet(model);
  const solver = new GPUSolver(device, {
    nx, ny, dx, z: model.z, mask: model.mask, manning: model.manning, inlets: net.inlets.map(i => i.cell),
    bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' }, hdry: 1e-5, hfront: 1e-3, dtDry: 2,
  });
  await solver.ready; solver.setDepth(() => 0);
  const swmm = await loadSWMM(); swmm.open(davisINP(model, { dsStage: dsStage ?? model.pump.outfallInvert + 0.5, pressurise: twoWay }));
  const cp = new Coupler(solver, net, swmm, model.z, { interval, twoWay });
  const pumpIdx = swmm.index('LINK', 'PUMP1'), wetIdx = swmm.index('NODE', model.pump.from);
  const nodeIdx = model.nodes.map(n => swmm.index('NODE', n.name)), linkIdx = model.conduits.map(c => swmm.index('LINK', c.name));
  const out = { t: [], surfaceVolume: [], flooded3cm: [], flooded15cm: [], maxDepth: [], toNetwork: [], toSurface: [], pump: [], wetWell: [], nodeHead: [], linkFlow: [], massRel: [] };
  const A = dx * dx, t0w = performance.now();
  let pumped = 0;
  const record = async (t) => {
    const s = await solver.readState();
    let a3 = 0, a15 = 0, mx = 0; for (let k = 0; k < N; k++) { if (!model.mask[k]) continue; const h = s.h[k]; if (h > 0.03) a3 += A; if (h > 0.15) a15 += A; if (h > mx) mx = h; }
    out.t.push(t); out.surfaceVolume.push(+s.mass.volume.toFixed(2)); out.flooded3cm.push(Math.round(a3)); out.flooded15cm.push(Math.round(a15)); out.maxDepth.push(+mx.toFixed(4));
    out.toNetwork.push(+cp.totals.toNetwork.toFixed(2)); out.toSurface.push(+(cp.totals.toSurface + cp.totals.overflowReturned).toFixed(2));
    out.pump.push(+swmm.link('FLOW', pumpIdx).toFixed(4)); out.wetWell.push(+swmm.node('HEAD', wetIdx).toFixed(4));
    out.nodeHead.push(nodeIdx.map(i => +swmm.node('HEAD', i).toFixed(3))); out.linkFlow.push(linkIdx.map(i => +swmm.link('FLOW', i).toFixed(4)));
    out.massRel.push(s.mass.rel);
    return s;
  };
  await record(0);
  const block = model.rain.blockMin * 60;
  let nextOut = outDt;
  while (solver.t < model.durationS - 1e-6) {
    const t = solver.t, b = Math.floor(t / block + 1e-9);
    solver.rainRate = (model.rain.mmhr[b] ?? 0) / 3.6e6;
    const tEnd = Math.min(model.durationS, cp.tNext, nextOut, (b + 1) * block);
    await solver.advance(tEnd);
    if (solver.t >= cp.tNext - 1e-6) { await cp.exchange(); pumped += swmm.link('FLOW', pumpIdx) * interval; }
    if (solver.t >= nextOut - 1e-6) { await record(solver.t); nextOut += outDt; if (Math.round(solver.t) % 7200 === 0) log(`  t=${(solver.t / 3600).toFixed(0)} h, surface ${out.surfaceVolume.at(-1).toFixed(0)} m³, pump ${out.pump.at(-1).toFixed(2)} m³/s`); }
  }
  const s = await solver.readState();
  const rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  const res = {
    model: model.source, grid: model.grid, cells: model.mask.reduce((a, b) => a + b, 0), wallSeconds: (performance.now() - t0w) / 1000, steps: solver.steps,
    series: out, nodes: model.nodes.map(n => n.name), links: model.conduits.map(c => c.name),
    hmax: Array.from(s.hmax, v => +v.toFixed(3)), hFinal: Array.from(s.h, v => +v.toFixed(3)),
    mass: { surface: s.mass, swmm: cont, coupler: cp.totals, pumpedApprox: pumped },
  };
  solver.destroy();
  return res;
}
