// Street sandbox run loop: one case (cases.mjs buildCase) on one executor. The executor supplies `makeSim(opts)`, a
// surface solver with GPUSolver's interface (the GPU solver itself in the browser; exec-cpu.mjs's CpuSim in node).
// Coupled cases run the production Coupler and SWMM exactly as benchmarks/gatec/coupled does. → the raw record a
// scorer reads: measurements only, no reference values and no pass or fail.
import { loadSWMM, SWMM } from '../../../src/swmm.js';
import { Coupler } from '../../../src/coupler.js';
import { downscaleDepth } from '../../../src/downscale.js';
import { cellLevel, fineDepth, CT } from '../../../src/subgrid.js';

const stat = (a, cells) => { let s = 0, m = 0; for (const k of cells) { s += a[k]; if (a[k] > m) m = a[k]; } return { mean: cells.length ? s / cells.length : null, max: cells.length ? m : null, n: cells.length }; };
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(5));

/** Depths on the 1 m probe grid from a solver state: the solver's own cells (F 1), the app's downscaling (F > 1), or the subgrid tables. `peak`: from the peak grid. */
function fineDepths(def, s, peak) {
  const { c, probeFine: f } = def, N = c.nx * c.ny;
  if (c.sg) { const eta = new Float64Array(N); for (let K = 0; K < N; K++) eta[K] = !c.mask[K] ? -Infinity : peak ? (s.hmax[K] > c.z[K] ? s.hmax[K] : -Infinity) : (s.h[K] > 0 ? cellLevel(c.sg.ct, K * CT, s.h[K]) : -Infinity); return fineDepth(c.sg, eta, f); }
  if (c.dx > f.dx) return downscaleDepth(c, peak ? s.hmax : s.h, 1, f, Math.round(c.dx / f.dx));
  return null; // the solver grid is the probe grid (or finer): read its own cells
}

export async function runCase(makeSim, def, { log = () => {} } = {}) {
  const { c, opts, rain, tEnd, every, probes, coupled } = def, t0 = Date.now();
  const sim = await makeSim(opts); sim.setDepth(def.level0 != null ? (x, y, z) => Math.max(0, def.level0 - z) : () => 0);
  let swmm = null, cp = null;
  if (coupled) {
    swmm = await loadSWMM(); swmm.open(coupled.inp);
    cp = new Coupler(sim, coupled.net, swmm, c.z, { interval: coupled.interval, twoWay: coupled.twoWay });
    if (coupled.stage != null) cp.stage = coupled.stage;
  }
  const rateAt = (t) => rain.find(b => t >= b.t0 - 1e-9 && t < b.t1 - 1e-9)?.rate ?? 0;
  const stops = [...new Set([...rain.flatMap(b => [b.t0, b.t1]), ...Array.from({ length: Math.floor(tEnd / every) + 1 }, (_, k) => k * every), tEnd])].filter(t => t > 0 && t <= tEnd + 1e-9).sort((a, b) => a - b);
  const series = [], sample = async () => {
    const s = await sim.readState(), row = { t: +sim.t.toFixed(3), volume: s.mass.volume, rain: s.mass.rain, outflow: s.mass.outflow, infil: s.mass.infil, giStored: s.mass.giStored ?? 0, exchanged: s.mass.exchanged ?? 0, probes: {} };
    for (const p of probes) { const q = stat(s.h, p.cells); row.probes[p.id] = c.sg ? null : [r4(q.mean), r4(q.max)]; }
    if (cp) { row.pipeFlow = Array.from(cp.state.flow, r4); row.head = Array.from(cp.state.head, r4); row.outVol = Array.from(cp.outVol, r4); row.toNetwork = cp.totals.toNetwork; row.toSurface = cp.totals.toSurface; row.flooding = cp.state.flooding; }
    series.push(row); return s;
  };
  let s = await sample();
  for (const T of stops) {
    sim.rainRate = rateAt(sim.t);
    while (sim.t < T - 1e-4) { // the GPU keeps time in fp32: every stop here is a whole second
      await sim.advance(cp ? Math.min(T, cp.tNext) : T);
      if (cp && sim.t >= cp.tNext - 1e-6) await cp.exchange();
    }
    if (Math.abs(T / every - Math.round(T / every)) < 1e-9 || T === tEnd) { s = await sample(); if (series.length % 20 === 0) log(`  ${def.id} t ${T} s`); }
  }
  // end state: the solver's own cells, and the 1 m product the app would map (downscaled or from the subgrid tables)
  const fd = fineDepths(def, s, false), fp = fineDepths(def, s, true);
  const peakOwn = c.sg ? null : s.hmax; // subgrid: hmax is a level, read through the 1 m product
  const ends = probes.map(p => ({ id: p.id, solverCells: p.cells.length, fineCells: p.fine.length,
    final: c.sg ? null : stat(s.h, p.cells), peak: peakOwn ? stat(peakOwn, p.cells) : null,
    final1m: fd ? stat(fd, p.fine) : null, peak1m: fp ? stat(fp, p.fine) : null }));
  const out = {
    case: def.id, spec: def.spec, grid: { nx: c.nx, ny: c.ny, dx: c.dx, F: c.F, subgrid: !!c.sg, cells: c.nx * c.ny }, tEnd, wallSeconds: (Date.now() - t0) / 1000, steps: sim.steps,
    mass: s.mass, rainBlocks: rain.map(b => [b.t0, b.t1, +(b.mmhr ?? b.rate / (1 / 3.6e6)).toFixed(3)]), series, probes: ends,
  };
  if (def.keepFields) { // 1 m maps (mm) for map comparisons: final and peak depth
    const N = def.probeFine.nx * def.probeFine.ny, pick = (own, fine1) => Array.from({ length: N }, (_, k) => Math.round(1000 * (fine1 ? fine1[k] : own[k])));
    out.fields = { nx: def.probeFine.nx, ny: def.probeFine.ny, finalMm: pick(s.h, fd), peakMm: c.sg ? pick(null, fp) : pick(s.hmax, fp) };
  }
  if (cp) {
    const rep = cp.report(), rpt = swmm.finish(), cont = SWMM.continuity(rpt), net = coupled.net;
    out.coupled = {
      twoWay: coupled.twoWay, stats: net.stats ?? null, continuity: cont, totals: cp.totals, outVol: Array.from(cp.outVol),
      nodes: net.nodes.map((n, i) => ({ name: n.name, ground: n.ground, invert: n.invert, outfall: !!n.outfall, offsite: !!n.offsite, type: n.outfallType ?? null, maxHead: rep?.nodes[i].maxHead ?? null, surchargedS: rep?.nodes[i].surchargedS ?? 0, floodVol: rep?.nodes[i].floodVol ?? 0, area: n.area ?? null })),
      pipes: net.pipes.map((q, k) => ({ name: q.name, from: q.from, to: q.to, L: q.L, D: q.D, n: q.n ?? net.opts.n, invUp: net.nodes[q.from].invert + (q.inOffset ?? 0), invDn: net.nodes[q.to].invert + (q.outOffset ?? 0), designQ: q.Q ?? null, area: q.area ?? null, offsite: !!q.offsite, maxQ: rep?.pipes[k].maxQ ?? null, maxRatio: rep?.pipes[k].maxRatio ?? null })),
      inlets: net.inlets.map((g, m) => ({ node: g.node, cell: g.cell, grates: g.grates, volume: rep?.inlets[m].volume ?? null, peakQ: rep?.inlets[m].peakQ ?? null, maxDepth: rep?.inlets[m].maxDepth ?? null })),
      designIntensity10: net.designIntensity10 ?? null, swmmVersion: swmm.version,
    };
    swmm.dispose?.();
  }
  sim.destroy?.();
  return out;
}
