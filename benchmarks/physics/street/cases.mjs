// Street sandbox case builder: a spec's `parameters.cases` entry → everything a run needs, built with the app's own
// pieces (terrain coarsening, roof routing, the subgrid tables, the synthetic network, the .inp writer, the design
// storm, the lumped drainage rate). Runs in node and in the browser. Nothing here scores anything.
import { coarsen, roofRouting } from '../../../src/terrain.js';
import { buildSubgrid } from '../../../src/subgrid.js';
import { synthNetwork, toINP, lumpedInfil, DESIGN_DEFAULTS } from '../../../src/drainage.js';
import { drawnGI } from '../../../src/stormwater.js';
import { hyetograph, A14_DURATIONS, A14_ARI } from '../../../src/storm.js';
import { GridRef, fromUTM } from '../../../src/geo.js';
import { SCENES } from './terrain.mjs';

export const MMHR = 1 / 3.6e6;
/** The solver settings app/map.js passes (hdry, hfront, dtDry), used for every sandbox run. */
export const APP_SOLVER = { hdry: 1e-5, hfront: 1e-3, dtDry: 2 };
const ALL = (v) => ({ west: v, east: v, south: v, north: v });

/** A made-up depth–duration table in the shape src/storm.js reads (mm): i(t) = a / (t + 10 min)^0.8, a set by the 60 min depth. */
export function madeUpTable(depth60) {
  if (depth60.length !== A14_ARI.length) throw new Error('depth60 needs one value per return period');
  return { median: A14_DURATIONS.map(t => depth60.map(d => d * Math.pow(70, 0.8) / Math.pow(t + 10, 0.8) * t / 60)) };
}

/** Fine layers one step coarser (the app's own coarsening), in the shape of fine layers again. */
export function aggregate(f, F) {
  const c = coarsen(f, F, 1), N = c.nx * c.ny, bld = new Uint8Array(N), road = new Uint8Array(N), rain0 = f.rain0 ? new Uint8Array(N) : null;
  for (let k = 0; k < N; k++) { bld[k] = c.mask[k] ? 0 : 1; road[k] = c.roadFrac[k] > 0 && c.mask[k] ? 1 : 0; }
  if (rain0) for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) { let s = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) s += f.rain0[j * f.nx + i]; rain0[J * c.nx + I] = s * 2 > F * F ? 1 : 0; }
  return { ...f, nx: c.nx, ny: c.ny, dx: f.dx * F, z: c.z, bld, road, manning: c.manning, infil: c.infil, rain0 };
}

/** The solver grid the app builds from fine layers: as they are (F 1), coarsened (F 2, 4), or the subgrid speed mode. */
export function solverGrid(fine, { F = 1, subgrid = false } = {}) {
  let c;
  if (subgrid) { const sg = buildSubgrid(fine, F); c = { ...sg, sg, manning: new Float64Array(sg.nx * sg.ny), rainField: roofRouting(sg.mask, sg.nx, sg.ny, 1).rainField }; }
  else if (F === 1) {
    const N = fine.nx * fine.ny, mask = new Uint8Array(N); for (let k = 0; k < N; k++) mask[k] = fine.bld[k] ? 0 : 1;
    c = { nx: fine.nx, ny: fine.ny, z: Float64Array.from(fine.z), mask, manning: Float64Array.from(fine.manning), infil: Float64Array.from(fine.infil), roadFrac: Float64Array.from(fine.road), rainField: roofRouting(mask, fine.nx, fine.ny, 1).rainField };
  } else c = coarsen(fine, F, 1);
  c.F = F; c.dx = fine.dx * F; c.rainField = Float64Array.from(c.rainField);
  if (fine.rain0) for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) { // cells that take no rain (a rim): their share of the solver cell
    let s = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) s += fine.rain0[j * fine.nx + i];
    c.rainField[J * c.nx + I] *= 1 - s / (F * F);
  }
  return c;
}

/** Fine cells of a probe. kinds: column { x }, box { x0, x1, y0, y1 }, wall { reach, box? } (open cells within reach m of a building). Coordinates in the scene's own metres. */
export function probeCells(fine, p) {
  const { nx, ny, dx } = fine, x0 = fine.x0 ?? 0, out = [];
  const inBox = (x, y, b) => !b || (x >= b.x0 && x < b.x1 && y >= (b.y0 ?? -Infinity) && y < (b.y1 ?? Infinity));
  const R = p.kind === 'wall' ? Math.round(p.reach / dx - 1e-9) : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + (i + 0.5) * dx, y = (j + 0.5) * dx; if (fine.bld[k]) continue;
    if (p.kind === 'column') { if (Math.abs(x - p.x) < dx / 2 + 1e-9) out.push(k); }
    else if (p.kind === 'box') { if (inBox(x, y, p)) out.push(k); }
    else if (p.kind === 'wall') {
      if (!inBox(x, y, p.box)) continue; let near = false;
      for (let b = Math.max(0, j - R); b <= Math.min(ny - 1, j + R) && !near; b++) for (let a = Math.max(0, i - R); a <= Math.min(nx - 1, i + R); a++) if (fine.bld[b * nx + a] && (!p.house || inBox(x0 + (a + 0.5) * dx, (b + 0.5) * dx, p.house))) { near = true; break; }
      if (near) out.push(k);
    } else throw new Error('probe kind ' + p.kind);
  }
  return out;
}
/** Solver cells (open) that overlap any of the given fine cells. */
export function solverCells(fine, cells, c) {
  const r = c.dx / fine.dx, set = new Set();
  for (const k of cells) {
    const i = k % fine.nx, j = (k - i) / fine.nx;
    if (r >= 1) { const K = Math.floor(j / r) * c.nx + Math.floor(i / r); if (c.mask[K]) set.add(K); }
    else { const m = Math.round(1 / r); for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) { const K = (j * m + b) * c.nx + i * m + a; if (c.mask[K]) set.add(K); } }
  }
  return [...set];
}

const rainBlocks = (r, pf) => {
  if (!r) return [];
  if (r.ari) { const h = hyetograph(pf, { ari: r.ari, durationMin: r.minutes, blockMin: 5 }); return h.intensity.map((v, k) => ({ t0: k * 300, t1: (k + 1) * 300, rate: v * MMHR, mmhr: v })); }
  return [{ t0: 0, t1: r.minutes * 60, rate: r.mmhr * MMHR, mmhr: r.mmhr }];
};

/**
 * A case, ready to run. → { id, fine (the app's fine layers, 1 m unless the case runs finer), probeFine (the 1 m
 * layers the probes are on), c (solver grid), opts (solver constructor options), rain [{ t0, t1, rate }], tEnd, every,
 * probes [{ id, fine: [cells on probeFine], cells: [solver cells] }], coupled (or null), keepFields, level0 }
 */
export function buildCase(id, specs) {
  const spec = Object.values(specs).find(s => s.parameters?.cases?.value?.[id]); if (!spec) throw new Error('no such case: ' + id);
  const P = spec.parameters, e = P.cases.value[id], sceneArgs = { ...(P.scenes?.value?.[e.scene] ?? {}), ...(e.sceneArgs ?? {}) }, kind = P.scenes?.value?.[e.scene]?.kind ?? e.scene;
  const base = SCENES[kind](sceneArgs);                              // the scene at its own resolution
  const probeFine = base.dx < 1 ? aggregate(base, Math.round(1 / base.dx)) : base;
  const g = e.grid ?? {}, fine = g.native ? base : probeFine;        // native: run at the scene's own (finer) resolution
  const c = solverGrid(fine, g.native ? {} : { F: g.F ?? 1, subgrid: !!g.subgrid });
  const pf = P.depth60 ? madeUpTable(P.depth60.value) : null, rain = rainBlocks(e.rain, pf);
  const probes = Object.entries(e.probes ?? {}).map(([pid, p]) => { const cells = probeCells(probeFine, p); return { id: pid, fine: cells, cells: solverCells(probeFine, cells, c) }; });
  const N = c.nx * c.ny; let infil = c.infil ? Float64Array.from(c.infil) : new Float64Array(N);
  const d = e.drainage ?? { kind: 'none' };
  if (d.kind === 'lumped') { const extra = lumpedInfil(c, c.roadFrac, d.mmhr); infil = infil.map((v, k) => v + extra[k]); }
  // owner-scale measures (PV-SS12), each through the app's own layer for it
  let gi = null, rainField = c.rainField;
  if (e.measure) { // a drawn rain garden or permeable patch: the drawn-GI store on its cells (src/stormwater.js drawnGI)
    const m = e.measure, cells = probeCells(fine, { kind: 'box', ...m.box });
    gi = drawnGI({ ...fine, drawnGI: [{ id: 1, kind: m.kind, cells, rate: m.rateMmHr * MMHR, store: m.store, under: 0 }] }, c, c.F);
  }
  if (e.soil) for (const k of solverCells(fine, probeCells(fine, { kind: 'box', ...e.soil.box }), c)) infil[k] += e.soil.mmhr * MMHR; // bare soil taking water at a constant rate
  if (e.heldRoof) { // a roof whose rain is held (a cistern that has not filled): src/terrain.js roofRouting with the roof in `held`
    const ids = new Int32Array(N); for (let k = 0; k < N; k++) ids[k] = c.mask[k] ? 0 : 1;
    rainField = Float64Array.from(roofRouting(c.mask, c.nx, c.ny, 1, { ids, roofs: new Map([[1, { roof: 'cistern', retention: e.heldRoof.retention }]]), held: new Set([1]) }).rainField);
  }
  let coupled = null;
  if (d.kind === 'pipe') coupled = onePipe(d, base, c, e);
  else if (d.kind === 'network') coupled = network(d, base, c, e, pf);
  const opts = { nx: c.nx, ny: c.ny, dx: c.dx, z: c.z, mask: c.mask, manning: c.manning, infil, rainField, gi: gi ? { rate: gi.rate, cap: gi.cap, drain: gi.drain } : undefined, inlets: coupled ? coupled.net.inlets.map(q => q.cell) : undefined,
    subgrid: c.sg ?? undefined, bc: { ...ALL('wall'), ...(e.bc === 'app' ? ALL('outflow') : e.bc ?? {}) }, ...APP_SOLVER };
  return { id, spec: spec.id, entry: e, base, fine, probeFine, c, opts, rain, tEnd: e.tEnd, every: e.every ?? 60, probes, coupled, gi, keepFields: !!e.keepFields, level0: e.level0 ?? null, houses: base.houses ?? null };
}

/** One manhole with one grate on one pipe to an outlet outside the surface model. */
function onePipe(d, base, c, e) {
  const cell = Math.floor(d.inlet[1] / c.dx) * c.nx + Math.floor(d.inlet[0] / c.dx), zs = c.z[cell];
  const out = { name: 'O1', p: [c.nx + d.L, d.inlet[1]], ground: zs + d.invOut, invert: zs + d.invOut, depth: 0, outfall: true, outfallType: d.outlet === 'FREE' ? 'FREE' : d.stage == null || d.viaStage ? 'FREE' : `FIXED ${(zs + d.stage).toFixed(4)}`, ...(d.viaStage ? { toStream: true } : {}) };
  const net = { nodes: [{ name: 'J1', p: d.inlet, ground: zs, invert: zs + d.invUp, depth: -d.invUp, outfall: false }, out],
    pipes: [{ name: 'C0', from: 0, to: 1, L: d.L, D: d.D, inOffset: 0, outOffset: 0 }], inlets: [{ node: 0, cell, grates: 1 }], opts: { ...DESIGN_DEFAULTS, ...(d.opts ?? {}) } };
  const ref = { x0: 0, y1: c.ny * c.dx, dx: 1 }, twoWay = d.twoWay !== false;
  return { net, twoWay, interval: 2, inp: toINP(net, ref, { durationS: Math.ceil(e.tEnd / 60) * 60 + 3600, pressurise: twoWay, title: 'Street sandbox: one inlet, one pipe' }), stage: d.viaStage ? zs + d.stage : null, zs };
}

/** The synthetic network the app builds for the scene's streets, sized for the design return period. */
function network(d, base, c, e, pf) {
  if (base.dx !== 1) throw new Error('network cases run on 1 m scenes');
  const zone = 18, ref = new GridRef({ zone, x0: 500000, y0: 4420000, x1: 500000 + base.nx, y1: 4420000 + base.ny, dx: 1 });
  // mapped streets have a vertex every few metres, share one where they cross, and run on past the scene's edge:
  // a vertex every 8 m from 4 m outside one end to 4 m outside the other (none on the edge itself), plus the crossings
  const ll = ([x, y]) => fromUTM(ref.x0 + x, ref.y1 - y, zone), step = 8;
  const cross = (s) => base.streets.filter(o => o !== s).map(o => { const [a, b] = s.line, [c, e] = o.line, d1 = [b[0] - a[0], b[1] - a[1]], d2 = [e[0] - c[0], e[1] - c[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    return den ? ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / den * Math.hypot(...d1) : null; }).filter(v => v != null);
  const roads = base.streets.map(s => { const [a, b] = s.line, L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], at = new Set(cross(s).filter(v => v > 0 && v < L).map(v => +v.toFixed(6)));
    for (let d = -step / 2; d <= L + step / 2 + 1e-9; d += step) at.add(d);
    return { kind: 'residential', name: s.name, width: 8, line: [...at].sort((p, q) => p - q).map(d => ll([a[0] + u[0] * d, a[1] + u[1] * d])) }; });
  const f = { ...base, cls: new Uint8Array(base.nx * base.ny).fill(d.nlcd ?? 23) };
  const net = synthNetwork(ref, f, { roads, waterways: [] }, pf, { nx: c.nx, ny: c.ny, F: c.F, mask: c.mask, z: c.z }, { designARI: d.designARI ?? 10, spacing: d.spacing ?? 60 });
  if (!net) throw new Error('synthNetwork built nothing');
  const twoWay = d.twoWay !== false;
  return { net, twoWay, interval: 2, inp: toINP(net, ref, { durationS: Math.ceil(e.tEnd / 60) * 60 + 3600, pressurise: twoWay, title: 'Street sandbox: synthetic network' }), stage: null };
}

/** Every case id of the given specs, in spec order. */
export const caseIds = (specs) => Object.values(specs).flatMap(s => Object.keys(s.parameters?.cases?.value ?? {}));
