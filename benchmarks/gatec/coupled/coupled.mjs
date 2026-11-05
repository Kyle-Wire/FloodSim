// Run a coupled 1D–2D verification case (cases.mjs) on the production pieces: the GPU surface solver, EPA SWMM 5.2
// and the app's Coupler exchanging every 2 s, as a map run does. Each case runs with the manhole spilling at its rim
// (SWMM's overflow handed to the street) or with two-way exchange (the manhole pressurises and water returns on the
// head difference, the app's default), and is scored against the catalog's exact answers. Driven by run.html.
import { GPUSolver } from '../../../src/solver-gpu.js';
import { loadSWMM, SWMM } from '../../../src/swmm.js';
import { Coupler } from '../../../src/coupler.js';
import { CASES, caseINP, inflowVolume } from './cases.mjs';

/** The cells a point falls in: two (or four) when it lies on a face (or corner) between cells, averaged. */
const cellsAt = (c, x, y) => {
  const span = (v, n) => (Number.isInteger(v / c.dx) ? [v / c.dx - 1, v / c.dx] : [Math.floor(v / c.dx)]).filter(i => i >= 0 && i < n);
  return span(y, c.ny).flatMap(j => span(x, c.nx).map(i => j * c.nx + i));
};

export async function runCase(device, id, twoWay) {
  const c = CASES[id], N = c.nx * c.ny, z = new Float64Array(N);
  for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) z[j * c.nx + i] = c.bed((i + 0.5) * c.dx, (j + 0.5) * c.dx);
  const mh = Math.min(c.ny - 1, Math.floor(c.manhole.y / c.dx)) * c.nx + Math.min(c.nx - 1, Math.floor(c.manhole.x / c.dx));
  z[mh] = c.manhole.crest; // the inlet opens at its cell's bed: the cell is the rim (crest)
  const net = {
    nodes: c.nodes.map(n => ({ name: n.name, invert: n.invert, depth: n.depth ?? 0, ground: n.outfall ? n.invert : n.invert + n.depth, outfall: !!n.outfall })),
    pipes: c.pipes.map(p => ({ name: p.name, D: p.D })),
    inlets: [{ node: c.nodes.findIndex(n => n.manhole), cell: mh, grates: 1 }],
    opts: { inletArea: c.manhole.area, inletPerim: c.manhole.perimeter, Cw: c.manhole.cw, Co: c.manhole.co },
  };
  const solver = new GPUSolver(device, {
    nx: c.nx, ny: c.ny, dx: c.dx, z, mask: new Uint8Array(N).fill(1), manning: c.manning, inlets: [mh],
    bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall', ...c.bc }, hdry: 1e-5, hfront: 1e-3, dtDry: 2,
  });
  await solver.ready; solver.setDepth((x, y, zz) => (c.level0 != null ? Math.max(0, c.level0 - zz) : 0));
  const swmm = await loadSWMM(); swmm.open(caseINP(c, { pressurise: twoWay }));
  const cp = new Coupler(solver, net, swmm, z, { interval: 2, twoWay });
  const series = [], wall0 = performance.now();
  const sample = async () => { const s = await solver.readState(); series.push({ t: solver.t, surface: s.mass.volume, ontoSurface: -s.mass.exchanged, edge: s.mass.outflow }); return s; };
  await sample();
  while (solver.t < c.tEnd - 1e-6) {
    await solver.advance(Math.min(c.tEnd, cp.tNext));
    if (solver.t >= cp.tNext - 1e-6) await cp.exchange();
    if (Math.round(solver.t) % 60 === 0 && solver.t - series.at(-1).t >= 59) await sample();
  }
  const s = await sample(), cont = SWMM.continuity(swmm.finish());
  const outNodes = net.nodes.map((n, i) => (n.outfall ? i : -1)).filter(i => i >= 0), outfallVolume = outNodes.reduce((a, i) => a + cp.outVol[i], 0);
  const at = (t) => series.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b));
  const last = series.at(-1), five = at(c.tEnd - 300);
  const probes = c.probes.map(p => { const ks = cellsAt(c, p.x, p.y), h = ks.reduce((a, k) => a + s.h[k], 0) / ks.length; return { ...p, h, wl: h + ks.reduce((a, k) => a + z[k], 0) / ks.length }; });
  const initial = solver.vol.initial, inflow = inflowVolume(c), networkEnd = (cont.finalStored ?? 0) * 1000;
  const balance = (s.mass.volume + networkEnd) - (initial + inflow - s.mass.outflow - outfallVolume);
  const r = {
    case: id, title: c.title, exchange: twoWay ? 'two-way (manhole pressurises)' : 'spill at the rim (SWMM overflow to the street)',
    grid: { nx: c.nx, ny: c.ny, dx: c.dx }, manholeCell: mh, wallSeconds: (performance.now() - wall0) / 1000, steps: solver.steps,
    exchangeLast5: (last.ontoSurface - five.ontoSurface) / (last.t - five.t), outfallVolume, surfaceEnd: s.mass.volume, edgeOutflow: s.mass.outflow, networkEnd, probes,
    books: { initial, inflow, surfaceRel: s.mass.rel, swmmErrorPct: cont.errorPct, combined: balance, combinedRel: balance / Math.max(1e-9, initial + inflow) },
    coupler: cp.totals, series: series.map(p => ({ t: Math.round(p.t), surface: +p.surface.toFixed(3), ontoSurface: +p.ontoSurface.toFixed(3), edge: +p.edge.toFixed(3) })),
  };
  r.scores = [...c.score(r), { id: 'water_balance', what: 'combined books: surface + pipes against what came in and went out (%)', value: 100 * r.books.combinedRel, expected: 0, ok: Math.abs(r.books.combinedRel) <= 0.005, tol: '±0.5 %' }];
  solver.destroy(); swmm.dispose?.();
  return r;
}
