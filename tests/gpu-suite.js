// Shared GPU verification suite (runs under Dawn/Node or in a browser).
import { GPUSolver } from '../src/solver-gpu.js';
import { CPUSolver } from '../src/solver-cpu.js';
import { damBreak, thackerPlanar } from '../src/analytic.js';
import { cloudburst, dambreak, MMHR } from '../src/scenarios.js';
import { buildSubgrid, fineDepth, cellVolume, CT } from '../src/subgrid.js';
import { settling, bedSize } from '../src/sediment.js';
import { bankFS } from '../src/banks.js';
import { lineFaces } from '../src/compare.js';
import { OutletLinks, rating, stageStorage, modifiedPuls } from '../src/stormwater.js';
import { LinkHub } from '../src/links.js';

export async function runGpuSuite(device, log = console.log, { only } = {}) {
  const results = {};
  if (only === 'lts') { await runLtsSuite(device, log, results); return results; }
  async function both(opts, init, tEnd, rain) {
    const g = new GPUSolver(device, opts), c = new CPUSolver({ ...opts, hdry: g.hdry });
    init(g); init(c);
    if (rain) { g.rainRate = rain.rate; c.rainRate = rain.rate; if (opts.infilRate) c.infil.fill(opts.infilRate); }
    const t0 = performance.now(); await g.advance(tEnd); const gms = performance.now() - t0;
    c.run(tEnd);
    const gs = await g.readState();
    let dmax = 0; const ch = c.field('h');
    for (let k = 0; k < ch.length; k++) dmax = Math.max(dmax, Math.abs(ch[k] - gs.h[k]));
    return { g, c, gs, ch, dmax, gms };
  }

  // Dam breaks
  for (const [name, hR] of [['stoker', 0.5], ['ritter', 0]]) {
    const nx = 400, ny = 3, dx = 100 / nx, x0 = 50, tEnd = 6;
    const r = await both({ nx, ny, dx, z: new Float64Array(nx * ny), manning: 0 }, s => s.setDepth(x => (x < x0 ? 1 : hR)), tEnd);
    const ex = damBreak(1, hR, x0); let e = 0, n = 0;
    for (let i = 0; i < nx; i++) { const he = ex((i + 0.5) * dx, tEnd); e += Math.abs(r.gs.h[nx + i] - he); n += he; }
    results[name] = { L1rel: e / n, maxDiffVsCPU: r.dmax, massRel: r.gs.mass.rel, steps: r.g.steps, cpuSteps: r.c.steps };
    log(`${name}: GPU L1 rel err=${(e / n).toExponential(3)}  max|h_gpu-h_cpu|=${r.dmax.toExponential(2)} m  mass rel=${r.gs.mass.rel.toExponential(2)}  steps gpu/cpu=${r.g.steps}/${r.c.steps}`);
    r.g.destroy();
  }

  // Lake at rest
  for (const [name, bump] of [['lakeSubmerged', 0.8], ['lakeIsland', 1.2]]) {
    const nx = 100, ny = 50, dx = 0.02; const z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 100 + bump * Math.exp(-5 * ((i + 0.5) * dx - 0.9) ** 2 - 50 * ((j + 0.5) * dx - 0.5) ** 2);
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.03 });
    g.setDepth((x, y, zz) => 101 - zz);
    await g.advance(2.0);
    const s = await g.readState(); let umax = 0, deta = 0;
    for (let k = 0; k < nx * ny; k++) {
      if (s.h[k] <= g.hdry) continue;
      umax = Math.max(umax, Math.hypot(s.hu[k], s.hv[k]) / s.h[k]);
      const i = k % nx, j = (k / nx) | 0; deta = Math.max(deta, Math.abs(s.h[k] + g.zh[g.idx(i, j)] + g.zref - 101));
    }
    results[name] = { maxVel: umax, maxEtaDev: deta, steps: g.steps };
    log(`${name} (bed at z≈100 m): max|u|=${umax.toExponential(2)} m/s  max|eta-eta0|=${deta.toExponential(2)} m  steps=${g.steps}`);
    g.destroy();
  }

  // Thacker
  {
    const T = thackerPlanar(), nx = 100, dx = T.L / nx; const z = new Float64Array(nx * nx);
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = T.bed((i + 0.5) * dx, (j + 0.5) * dx);
    const g = new GPUSolver(device, { nx, ny: nx, dx, z, manning: 0, hfront: 1e-4 });
    g.setDepth((x, y) => T.depth(x, y, 0)); g.setVelocity(() => T.vel(0));
    const cps = [];
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const tc = f * T.period; await g.advance(tc); const s = await g.readState(); let e = 0, n = 0;
      for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) { const he = T.depth((i + 0.5) * dx, (j + 0.5) * dx, tc); e += Math.abs(s.h[j * nx + i] - he); n += he; }
      cps.push({ t: tc, L1rel: e / n }); if (f === 1) results.thackerMass = s.mass.rel;
    }
    results.thacker = { nx, checkpoints: cps };
    log(`thacker nx=100: GPU L1 rel err at T/4..T = ${cps.map(c => c.L1rel.toExponential(2)).join(', ')}  mass rel=${results.thackerMass.toExponential(2)}`);
    g.destroy();
  }

  // Rain-on-grid with buildings, open outlet
  {
    const nx = 120, ny = 80, dx = 2; const z = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * dx, y = j * dx;
      z[j * nx + i] = 10 - 0.01 * x + 0.5 * Math.abs(y - 80) / 80 - 0.6 * Math.exp(-((x - 120) ** 2 + (y - 80) ** 2) / 400);
      if ((i % 20 > 6 && i % 20 < 14) && (j % 16 > 3 && j % 16 < 11) && i > 10 && i < 110) mask[j * nx + i] = 0;
    }
    const infilRate = 10 / 1000 / 3600;
    const opts = { nx, ny, dx, z, mask, manning: 0.035, bc: { east: 'open' }, infil: infilRate, infilRate };
    const r = await both(opts, s => s.setDepth(() => 0), 1200, { rate: 100 / 1000 / 3600 });
    const m = r.gs.mass, cm = r.c.massBalance();
    let hmaxDiff = 0; const cmx = r.c.field('maxDepth'); for (let k = 0; k < cmx.length; k++) hmaxDiff = Math.max(hmaxDiff, Math.abs(cmx[k] - r.gs.hmax[k]));
    results.rainMass = { rel: m.rel, clipped: m.clipped, relExClip: m.relExClip, rain: m.rain, infil: m.infil, outflow: m.outflow, stored: m.volume, maxDiffVsCPU: r.dmax, maxDepthDiffVsCPU: hmaxDiff, cpuRain: r.c.vol.rain, cpuOutflow: r.c.vol.outflow, cpuStored: cm.volume };
    log(`rain-on-grid t=1200 s: GPU mass rel=${m.rel.toExponential(2)} (clipped ${m.clipped.toExponential(2)} m3, rel excl. clipping ${m.relExClip.toExponential(2)})  rain=${m.rain.toFixed(2)} infil=${m.infil.toFixed(2)} out=${m.outflow.toFixed(2)} stored=${m.volume.toFixed(2)} m3`);
    log(`   CPU: rain=${r.c.vol.rain.toFixed(2)} infil=${r.c.vol.infil.toFixed(2)} out=${r.c.vol.outflow.toFixed(2)} stored=${cm.volume.toFixed(2)} m3   max|h diff|=${r.dmax.toExponential(2)} m  max|hmax diff|=${hmaxDiff.toExponential(2)} m`);
    r.g.destroy();
  }


  // App scenarios on GPU vs CPU
  for (const [name, sc, rate, tEnd] of [['urban', cloudburst(80), 150 * MMHR, 900], ['valleyDam', dambreak(48), 0, 120]]) {
    const opts = { nx: sc.nx, ny: sc.ny, dx: sc.dx, z: sc.z, mask: sc.mask, manning: sc.manning, infil: sc.infil, bc: sc.bc };
    const g = new GPUSolver(device, opts), c = new CPUSolver({ ...opts, hdry: g.hdry });
    if (sc.infil) for (let j = 0; j < sc.ny; j++) for (let i = 0; i < sc.nx; i++) c.infil[c.idx(i, j)] = sc.infil[j * sc.nx + i];
    sc.init(g); sc.init(c); g.rainRate = rate; c.rainRate = rate;
    await g.advance(tEnd); c.run(tEnd);
    const s = await g.readState(), ch = c.field('h'); let dmax = 0;
    for (let k = 0; k < ch.length; k++) dmax = Math.max(dmax, Math.abs(ch[k] - s.h[k]));
    results[name] = { rel: s.mass.rel, clipped: s.mass.clipped, outflow: s.mass.outflow, cpuOutflow: c.vol.outflow, maxDiffVsCPU: dmax, steps: g.steps };
    log(`${name}: GPU mass rel=${s.mass.rel.toExponential(2)} clipped=${s.mass.clipped.toExponential(2)} m3  outflow gpu/cpu=${s.mass.outflow.toFixed(1)}/${c.vol.outflow.toFixed(1)} m3  max|h diff|=${dmax.toExponential(2)} m  steps=${g.steps}`);
    g.destroy();
  }
  // Drainage inlets: sinks bounded by available water, sources add water, exchanged volume closes the mass balance
  {
    const nx = 60, ny = 40, dx = 2, N = nx * ny, z = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 0.01 * i + 0.002 * (j - 20) ** 2;
    const inlets = [5 * nx + 5, 20 * nx + 2, 30 * nx + 40, 12 * nx + 50]; // two on the low edge, one source, one on a crest
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.02, bc: { west: 'outflow' }, inlets });
    g.setDepth(() => 0); g.rainRate = 60 * MMHR;
    g.setInletRates([0.05, 0.05, -0.002, 0.5]); // m³/s; the last asks far more than its cell will ever hold
    let tot = 0, minH = Infinity;
    for (let t = 60; t <= 900; t += 60) {
      await g.advance(t);
      const r = await g.readInlets(); tot += r.vol.reduce((a, b) => a + b, 0);
      if (t === 480) g.setInletRates([0.05, 0.05, 0, 0.5]);
    }
    const s = await g.readState();
    for (const v of s.h) minH = Math.min(minH, v);
    const m = s.mass;
    results.inlets = { massRel: m.rel, exchanged: m.exchanged, minH };
    log(`inlets: exchanged=${m.exchanged.toFixed(3)} m3 (read back ${tot.toFixed(3)})  rain=${m.rain.toFixed(2)} out=${m.outflow.toFixed(2)} stored=${m.volume.toFixed(2)} m3  mass rel=${m.rel.toExponential(2)}  min h=${minH.toExponential(1)} m`);
    g.destroy();
  }

  // Water-level boundary: still water at the stage stays still; a rising stage floods in through the boundary only
  {
    const nx = 50, ny = 20, dx = 4, N = nx * ny, z = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 98 + 0.08 * i + 0.3 * Math.sin(j); // bed at ~100 m: fp32 test
    const stageCells = []; for (let j = 0; j < ny; j++) stageCells.push(j * nx); // west edge opens to the sea
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.02, bc: { west: 'outflow', east: 'outflow', south: 'outflow', north: 'outflow' }, stageCells });
    const z0 = 99.5; g.setStage(z0); g.setDepth((x, y, zz) => Math.max(0, z0 - zz));
    await g.advance(300);
    let s = await g.readState(), umax = 0;
    for (let k = 0; k < N; k++) if (s.h[k] > 1e-3) umax = Math.max(umax, Math.hypot(s.hu[k], s.hv[k]) / s.h[k]);
    const restOut = s.mass.outflow;
    for (let t = 330; t <= 1800; t += 30) { g.setStage(z0 + 0.8 * Math.min(1, (t - 300) / 900)); await g.advance(t); }
    s = await g.readState();
    let reached = 0; for (let i = 0; i < nx; i++) if (s.h[10 * nx + i] > 0.01) reached = i;
    results.stage = { restUmax: umax, restOutflow: restOut, inflow: -s.mass.outflow, massRel: s.mass.rel };
    log(`stage boundary: at rest max|u|=${umax.toExponential(1)} m/s, boundary flux ${restOut.toExponential(1)} m3;  +0.8 m rise: inflow=${(-s.mass.outflow).toFixed(1)} m3, wet to x=${reached * dx} m, mass rel=${s.mass.rel.toExponential(2)}`);
    g.destroy();
  }

  // Rain on a plane (HEC-RAS RD-52 §4.2.8): outflow hydrograph against the kinematic-wave solution. Per unit width,
  // q = α h^(5/3) with α = √S / n; the outlet rises as q = α (i t)^(5/3) until t_c = (L / (α i^(2/3)))^(3/5), then holds i·L.
  {
    const L = 200, dx = 2, nx = L / dx, ny = 4, S = 0.005, n = 0.03, i = 50 * MMHR, z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let k = 0; k < nx; k++) z[j * nx + k] = (nx - k - 0.5) * dx * S;
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: n, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' } });
    g.setDepth(() => 0); g.rainRate = i;
    const alpha = Math.sqrt(S) / n, tc = Math.pow(L / (alpha * Math.pow(i, 2 / 3)), 3 / 5), W = ny * dx;
    const exact = (t) => (t < tc ? alpha * Math.pow(i * t, 5 / 3) : i * L) * W;
    let prev = 0, tPrev = 0, errs = [], peakErr = 0;
    for (let t = 60; t <= 2.5 * tc; t += 60) {
      await g.advance(t); const s = await g.readState(); const q = (s.mass.outflow - prev) / (t - tPrev); prev = s.mass.outflow; tPrev = t;
      const qe = (exact(t - 30)); errs.push(Math.abs(q - qe)); if (t > 1.5 * tc) peakErr = Math.max(peakErr, Math.abs(q / (i * L * W) - 1));
    }
    const s = await g.readState(); g.destroy();
    const rms = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length) / (i * L * W);
    results.rainPlane = { tc, rmsRel: rms, equilibriumErr: peakErr, massRel: s.mass.rel };
    log(`rain on a plane (RD-52 4.2.8): t_c=${(tc / 60).toFixed(1)} min, outflow RMS error ${(100 * rms).toFixed(1)}% of equilibrium, equilibrium within ${(100 * peakErr).toFixed(2)}%, mass rel=${s.mass.rel.toExponential(2)}`);
  }

  // Green infrastructure: stores fill to capacity, then the cell runs off; CPU parity; tiled = untiled
  {
    const nx = 60, ny = 40, dx = 2, N = nx * ny, z = new Float64Array(N), gi = { rate: new Float64Array(N), cap: new Float64Array(N), drain: new Float64Array(N) };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; z[k] = 0.01 * i; if (i < nx / 2) { gi.rate[k] = 100 * MMHR; gi.cap[k] = 0.02; gi.drain[k] = 5 * MMHR; } }
    const opts = { nx, ny, dx, z, manning: 0.03, bc: { west: 'outflow' }, gi };
    const run = async (tiles) => { const g = new GPUSolver(device, { ...opts, tiles }); g.setDepth(() => 0); g.rainRate = 60 * MMHR; await g.advance(1800); g.rainRate = 0; await g.advance(3600); const s = await g.readState(); g.destroy(); return s; };
    const a = await run(true), b = await run(false);
    const c = new CPUSolver({ ...opts, hdry: 1e-5 }); c.setDepth(() => 0); c.rainRate = 60 * MMHR; c.run(1800); c.rainRate = 0; c.run(3600);
    let dTile = 0, dCpu = 0; const ch = c.field('h'); for (let k = 0; k < N; k++) { dTile = Math.max(dTile, Math.abs(a.h[k] - b.h[k])); dCpu = Math.max(dCpu, Math.abs(a.h[k] - ch[k])); }
    let store = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx / 2; i++) store += c.giStore[c.idx(i, j)];
    store *= dx * dx;
    const giArea = N / 2 * dx * dx, cpuInfil = c.vol.infil;
    results.gi = { maxDiffTiled: dTile, maxDiffCPU: dCpu, massRel: a.mass.rel, gpuStored: a.mass.giStored, cpuStored: store };
    log(`green infrastructure: GI stores hold ${a.mass.giStored.toFixed(2)} m³ (cap ${(0.02 * giArea).toFixed(1)} m³, CPU ${store.toFixed(2)}), infiltrated gpu/cpu ${a.mass.infil.toFixed(2)}/${cpuInfil.toFixed(2)} m³  max|h tiled−untiled|=${dTile.toExponential(1)}  max|h gpu−cpu|=${dCpu.toExponential(1)}  mass rel=${a.mass.rel.toExponential(2)}`);
  }

  // Active tiles: same answer as the untiled solver, less work while most of the domain is dry
  {
    const nx = 640, ny = 480, dx = 2, N = nx * ny, z = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 50 - 0.004 * i * dx + 0.6 * Math.sin(j / 23) * Math.cos(i / 31) + 0.002 * Math.abs(j - ny / 2) * dx;
    const opts = { nx, ny, dx, z, manning: 0.03, bc: { east: 'outflow' } };
    const init = (s) => s.setDepth((x, y, zz) => (Math.hypot(x - 120, y - 480) < 60 ? Math.max(0, 53 - zz) : 0)); // a pond that breaks
    const run = async (tiles) => {
      const g = new GPUSolver(device, { ...opts, tiles }); init(g);
      await g.advance(1); // compile + warm up
      const t0 = performance.now(); await g.advance(240); const ms = performance.now() - t0;
      const ts = await g.tileStats(), s = await g.readState(); g.destroy();
      return { ms, ts, s };
    };
    const a = await run(false), b = await run(true);
    let dmax = 0, wet = 0; for (let k = 0; k < N; k++) { dmax = Math.max(dmax, Math.abs(a.s.h[k] - b.s.h[k])); if (b.s.h[k] > 1e-3) wet++; }
    results.tiles = { tiled: b.ts.tiled, maxDiff: dmax, speedup: a.ms / b.ms, activeFrac: b.ts.tiled ? b.ts.flux / b.ts.tiles : 1, wetFrac: wet / N, massRel: b.s.mass.rel };
    log(`active tiles (${nx}×${ny}, ${b.ts.tiled ? `${b.ts.flux}/${b.ts.tiles} tiles active at the end` : 'NOT tiled on this device'}): max|h_tiled-h_full|=${dmax.toExponential(1)} m  ` +
      `wet ${(100 * wet / N).toFixed(1)}%  untiled ${a.ms.toFixed(0)} ms, tiled ${b.ms.toFixed(0)} ms (×${(a.ms / b.ms).toFixed(2)})  mass rel=${b.s.mass.rel.toExponential(2)}`);
  }

  // More active tiles than one dispatch dimension takes (WebGPU: 65,535 workgroups): rain on all 69,696 tiles of a
  // 2,112 × 2,112 grid. The lists go out in rows; before, the whole dispatch was dropped and the water froze
  {
    const nx = 2112, ny = 2112, dx = 2, N = nx * ny, z = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 30 - 0.002 * i * dx + 0.4 * Math.sin(j / 37) * Math.cos(i / 29);
    const opts = { nx, ny, dx, z, manning: 0.03, bc: { east: 'outflow' } };
    const run = async (tiles) => {
      const g = new GPUSolver(device, { ...opts, tiles }); g.setDepth(() => 0); g.rainRate = 80 * MMHR;
      await g.advance(300); const ts = await g.tileStats(), s = await g.readState(); g.destroy(); return { ts, s };
    };
    const a = await run(false), b = await run(true);
    let dmax = 0, moving = 0; for (let k = 0; k < N; k++) { dmax = Math.max(dmax, Math.abs(a.s.h[k] - b.s.h[k])); if (Math.hypot(b.s.hu[k], b.s.hv[k]) > 1e-6) moving++; }
    results.manyTiles = { tiled: b.ts.tiled, tiles: b.ts.tiles, active: b.ts.update, maxDiff: dmax, movingFrac: moving / N, massRel: b.s.mass.rel };
    log(`many tiles (${nx}×${ny}, ${b.ts.tiled ? `${b.ts.update}/${b.ts.tiles} active` : 'NOT tiled on this device'}): max|h_tiled-h_full|=${dmax.toExponential(1)} m  ` +
      `moving ${(100 * moving / N).toFixed(1)}% of cells  mass rel=${b.s.mass.rel.toExponential(2)}`);
    if (b.ts.tiled && !(dmax < 1e-6 && moving > 0.5 * N && Math.abs(b.s.mass.rel) < 1e-4)) throw new Error('many tiles: the tiled solver lost the flow over 65,535 active tiles');
  }

  // Flood barriers: a wall across a sloping 2D basin with a gap-free diagonal leg, overtopped, then a second barrier
  // raised mid-run; GPU (tiled and untiled) vs CPU depths and barrier books
  {
    const nx = 64, ny = 48, dx = 2, z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 5 - 0.02 * i + 0.01 * Math.sin(j / 3);
    const crest = [];
    for (let j = 0; j < ny; j++) crest.push({ i: 20, j, axis: 0, z: 5.4, C: 1.6, ground: 4.6 });
    for (let i = 36; i < 50; i++) crest.push({ i, j: i - 20, axis: 1, z: 4.9, C: 1.44, ground: 4.3 }, { i: i + 1, j: i - 20, axis: 0, z: 4.9, C: 1.44, ground: 4.3 });
    const opts = { nx, ny, dx, z, manning: 0.03, crest, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' } };
    const lift = crest.map((f, m) => (m < ny ? f.z : f.z + 0.5));
    const init = (s) => s.setDepth((x, y, zz) => (x < 30 ? 6 - zz : 0));
    const run = async (tiles) => { const g = new GPUSolver(device, { ...opts, tiles }); init(g); await g.advance(30); g.setCrestLevels(lift); await g.advance(90); const s = await g.readState(); const b = await g.readBarriers(); g.destroy(); return { s, b }; };
    const c = new CPUSolver({ ...opts, hdry: 1e-5 }); init(c); c.run(30); c.setCrestLevels(lift); c.run(90);
    const [a, t] = [await run(false), await run(true)], ch = c.field('h'), cb = c.readBarriers();
    let dCpu = 0, dTile = 0; for (let k = 0; k < ch.length; k++) { dCpu = Math.max(dCpu, Math.abs(ch[k] - a.s.h[k])); dTile = Math.max(dTile, Math.abs(t.s.h[k] - a.s.h[k])); }
    const tot = (b) => b.plus.reduce((x, y) => x + y, 0) + b.minus.reduce((x, y) => x + y, 0), over = tot(a.b), overCpu = tot(cb);
    let dLevel = 0, dLoad = 0, dOver = 0; for (let m = 0; m < crest.length; m++) {
      if (Number.isFinite(cb.level[m])) dLevel = Math.max(dLevel, Math.abs(cb.level[m] - a.b.level[m])); dLoad = Math.max(dLoad, Math.abs(cb.load[m] - a.b.load[m]));
      if (Number.isFinite(cb.tOver[m]) || Number.isFinite(a.b.tOver[m])) dOver = Math.max(dOver, Math.abs(cb.tOver[m] - a.b.tOver[m]));
    }
    results.barriers = { maxDiffCPU: dCpu, maxDiffTiled: dTile, overVol: over, overVolCPU: overCpu, booksRel: Math.abs(over - overCpu) / Math.max(1e-9, overCpu), maxLevelDiff: dLevel, maxLoadDiff: dLoad, maxFirstOverDiffS: dOver, massRel: a.s.mass.rel, massRelTiled: t.s.mass.rel };
    log(`barriers: over ${over.toFixed(2)} m³ (CPU ${overCpu.toFixed(2)})  max|h_gpu-h_cpu|=${dCpu.toExponential(2)} m  tiled vs untiled ${dTile.toExponential(2)} m  level/load/first-over vs CPU ${dLevel.toExponential(1)} m / ${dLoad.toExponential(1)} kN/m / ${dOver.toFixed(2)} s  mass rel=${a.s.mass.rel.toExponential(2)} / tiled ${t.s.mass.rel.toExponential(2)}`);
  }

  // Hazard products every step: a dam break over a bumpy slope; GPU vs CPU classes, force, d·v, duration, arrival
  {
    const nx = 80, ny = 40, dx = 2, z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 3 - 0.03 * i + 0.2 * Math.sin(i / 5) * Math.cos(j / 4);
    const opts = { nx, ny, dx, z, manning: 0.035, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' } };
    const r = await both(opts, s => s.setDepth((x, y, zz) => (x < 30 ? Math.max(0, 4.5 - zz) : 0)), 240);
    const G = await r.g.readHazard(), C = r.c.readHazard(); let cls = 0, wet = 0, dF = 0, dDV = 0, dDur = 0, dArr = 0, dV = 0, dWet = 0, wetMiss = 0;
    for (let k = 0; k < nx * ny; k++) {
      if (C.cls.arr[k] || G.cls.arr[k]) wet++;
      for (const s of ['arr', 'defra', 'defraUrban']) if (C.cls[s][k] !== G.cls[s][k]) cls++;
      dF = Math.max(dF, Math.abs(C.force[k] - G.force[k])); dDV = Math.max(dDV, Math.abs(C.dv[k] - G.dv[k])); dDur = Math.max(dDur, Math.abs(C.duration[k] - G.duration[k]));
      if (!Number.isNaN(C.arrival[k]) || !Number.isNaN(G.arrival[k])) dArr = Math.max(dArr, Math.abs(C.arrival[k] - G.arrival[k]));
      dV = Math.max(dV, Math.abs(C.vmax[k] - G.vmax[k]));
      if (Number.isNaN(C.tWet[k]) !== Number.isNaN(G.tWet[k])) wetMiss++; else if (!Number.isNaN(C.tWet[k])) dWet = Math.max(dWet, Math.abs(C.tWet[k] - G.tWet[k]));
    }
    results.hazard = { wetCells: wet, classMismatches: cls, maxForceDiff: dF, maxDvDiff: dDV, maxDurationDiffS: dDur, maxArrivalDiffS: dArr, maxSpeedDiff: dV, maxFirstWetDiffS: dWet, firstWetMismatches: wetMiss, maxH: r.dmax };
    log(`hazard every step: ${wet} cells reached, class mismatches vs CPU ${cls} (of ${3 * wet})  max|Δforce| ${dF.toExponential(1)} kN/m  max|Δd·v| ${dDV.toExponential(1)} m²/s  max|Δduration| ${dDur.toFixed(2)} s  max|Δarrival| ${dArr.toFixed(2)} s  max|Δpeak speed| ${dV.toExponential(1)} m/s  max|Δfirst wetting| ${dWet.toFixed(2)} s (${wetMiss} cells wet in one only)`);
    r.g.destroy();
  }

  // Subgrid speed mode vs the 1 m run: the 320 m urban catchment (streets 15 cm down, creek, buildings) at 1 m, a
  // 150 mm/hr cloudburst for 15 min then 15 min of drainage; 4 m subgrid cells with 1 m tables, depth back at 1 m
  for (const F of [4, 8]) {
    const sc = cloudburst(320), N = sc.nx * sc.ny, rate = 150 * MMHR, bc = { east: 'outflow' };
    const ref = new GPUSolver(device, { nx: sc.nx, ny: sc.ny, dx: sc.dx, z: sc.z, mask: sc.mask, manning: sc.manning, infil: sc.infil, bc });
    ref.setDepth(() => 0); await ref.ready; // time the solving, not the shader compilation
    let t0 = performance.now(); ref.rainRate = rate; await ref.advance(900); ref.rainRate = 0; await ref.advance(1800); const msRef = performance.now() - t0;
    const R = await ref.readState(); ref.destroy();
    const fine = { nx: sc.nx, ny: sc.ny, z: sc.z, bld: sc.mask.map(m => 1 - m), manning: sc.manning, infil: sc.infil };
    const sg = buildSubgrid(fine, F);
    const g = new GPUSolver(device, { nx: sg.nx, ny: sg.ny, dx: F * sc.dx, z: sg.z, mask: sg.mask, manning: 0, infil: sg.infil, rainField: sg.phi, bc, subgrid: sg });
    g.setDepth(() => 0); await g.ready;
    t0 = performance.now(); g.rainRate = rate; await g.advance(900); g.rainRate = 0; await g.advance(1800); const msSg = performance.now() - t0;
    const S2 = await g.readState(); g.destroy();
    const d = fineDepth(sg, S2.hmax, fine); // peak level → 1 m peak depth
    let n = 0, ae = 0, se = 0, hit = 0, miss = 0, fa = 0, vr = 0, vs = 0;
    for (let k = 0; k < N; k++) {
      if (!sc.mask[k]) continue;
      const a = R.hmax[k], b = d[k]; vr += a; vs += b;
      if (a > 0.05 || b > 0.05) { n++; ae += Math.abs(a - b); se += (a - b) ** 2; }
      const A = a > 0.15, B = b > 0.15; if (A && B) hit++; else if (A) miss++; else if (B) fa++;
    }
    const r = { F, cellsRef: N, cellsSg: sg.nx * sg.ny, msRef, msSg, speedup: msRef / msSg, maeM: ae / n, rmseM: Math.sqrt(se / n), csi15: hit / (hit + miss + fa),
      peakVolumeRatio: vs / vr, storedRef: R.mass.volume, storedSg: S2.mass.volume, outRef: R.mass.outflow, outSg: S2.mass.outflow, massRel: S2.mass.rel, steps: g.steps, stepsRef: ref.steps };
    results['subgrid' + F] = r;
    log(`subgrid ${F} m vs 1 m (320 m urban, 30 min): ${r.speedup.toFixed(1)}× faster (${msRef.toFixed(0)} → ${msSg.toFixed(0)} ms, ${r.stepsRef}/${r.steps} steps)  peak depth MAE ${(r.maeM * 100).toFixed(1)} cm, RMSE ${(r.rmseM * 100).toFixed(1)} cm  extent >15 cm CSI ${r.csi15.toFixed(2)}  peak volume ratio ${r.peakVolumeRatio.toFixed(2)}  stored ${r.storedSg.toFixed(0)}/${r.storedRef.toFixed(0)} m³, outflow ${r.outSg.toFixed(0)}/${r.outRef.toFixed(0)} m³  mass rel ${r.massRel.toExponential(1)}`);
  }

  // Subgrid water-level boundary: a 1 m sloping shore in 4 m cells, sea to the west; still water at the stage stays
  // still, and a 0.8 m rise fills the basin to the volume the tables say lies between the two levels
  {
    const F = 4, fnx = 200, fny = 80, N = fnx * fny, z = new Float64Array(N);
    for (let j = 0; j < fny; j++) for (let i = 0; i < fnx; i++) z[j * fnx + i] = 98 + 0.02 * (i + 0.5) + 0.3 * Math.sin((j + 0.5) / 4) + 0.15 * Math.sin(i * 1.7 + j);
    const sg = buildSubgrid({ nx: fnx, ny: fny, z, bld: new Uint8Array(N), manning: new Float32Array(N).fill(0.02), infil: new Float32Array(N) }, F);
    const { nx, ny } = sg, stageCells = []; for (let j = 0; j < ny; j++) stageCells.push(j * nx);
    const g = new GPUSolver(device, { nx, ny, dx: F, z: sg.z, mask: sg.mask, manning: 0, infil: sg.infil, bc: { west: 'outflow', east: 'wall', south: 'wall', north: 'wall' }, stageCells, subgrid: sg });
    const z0 = 99.5, tab = (lev) => { let v = 0; for (let K = 0; K < nx * ny; K++) v += cellVolume(sg.ct, K * CT, lev); return v * F * F; };
    g.setStage(z0); g.setDepth((x, y, zz) => Math.max(0, z0 - zz)); // level z0 in every cell below it
    await g.advance(300); let s = await g.readState(); const restOut = Math.abs(s.mass.outflow);
    for (let t = 330; t <= 4800; t += 30) { g.setStage(z0 + 0.8 * Math.min(1, (t - 300) / 900)); await g.advance(t); }
    s = await g.readState(); g.destroy();
    const expected = tab(z0 + 0.8) - tab(z0), inflow = -s.mass.outflow;
    results.subgridStage = { restOut, inflow, expected, rel: inflow / expected - 1, massRel: s.mass.rel };
    log(`subgrid water-level boundary: at rest boundary flux ${restOut.toExponential(1)} m³;  +0.8 m: inflow ${inflow.toFixed(0)} of ${expected.toFixed(0)} m³ (${(100 * (inflow / expected - 1)).toFixed(1)}%, a seiche of ~1% remains)  mass rel ${s.mass.rel.toExponential(1)}`);
  }

  // Green-Ampt infiltration and scour, GPU vs CPU: rain on a slope with two soils (a shallow water table on one), half
  // grass (30 Pa) and half bare loam (2 Pa); infiltrated volume, depths, peak shear and scour potential
  {
    const nx = 60, ny = 30, dx = 2, N = nx * ny, z = new Float64Array(N), K = new Float64Array(N), psiD = new Float64Array(N), fmax = new Float64Array(N), perv = new Float64Array(N);
    const tauC = new Float32Array(N), nn = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; z[k] = 5 - 0.03 * i + 0.06 * Math.abs(j - 14.5); // a valley along j = 14.5 gathers the runoff
      K[k] = i < 30 ? 3e-6 : 1e-6; psiD[k] = i < 30 ? 0.03 : 0.08; fmax[k] = j < 15 ? 0.02 : 1e3; perv[k] = 0.8;
      tauC[k] = i < 30 ? 30 : 2; nn[k] = 0.04; // grass upslope, bare loam downslope
    }
    const opts = { nx, ny, dx, z, manning: 0.04, ga: { psiD, fmax, perv }, scour: { tauC, n: nn }, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' } };
    const g = new GPUSolver(device, { ...opts, infil: K }), c = new CPUSolver({ ...opts, hdry: g.hdry });
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) c.infil[c.idx(i, j)] = K[j * nx + i];
    g.setDepth(() => 0); c.setDepth(() => 0); g.rainRate = c.rainRate = 120 * MMHR;
    await g.advance(1800); c.run(1800); g.rainRate = c.rainRate = 0; await g.advance(2700); c.run(2700);
    const s = await g.readState(), G = await g.readHazard(), C = c.readHazard(), ch = c.field('h'); g.destroy();
    let dh = 0, dShear = 0, dEro = 0, eroMax = 0; for (let k = 0; k < N; k++) {
      dh = Math.max(dh, Math.abs(ch[k] - s.h[k])); dShear = Math.max(dShear, Math.abs(C.shear[k] - G.shear[k]) / Math.max(1, C.shear[k]));
      dEro = Math.max(dEro, Math.abs(C.erosion[k] - G.erosion[k])); eroMax = Math.max(eroMax, C.erosion[k]);
    }
    const infCpu = c.vol.infil;
    results.greenAmptScour = { infilGpu: s.mass.infil, infilCpu: infCpu, infilRel: Math.abs(s.mass.infil / infCpu - 1), maxDiffH: dh, shearRel: dShear, erosionDiff: dEro, erosionMax: eroMax, massRel: s.mass.rel };
    log(`Green-Ampt + scour: infiltrated gpu/cpu ${s.mass.infil.toFixed(1)}/${infCpu.toFixed(1)} m³  max|Δh| ${dh.toExponential(1)} m  peak shear rel diff ${dShear.toExponential(1)}  scour potential ≤ ${(eroMax * 100).toFixed(2)} cm, max|Δ| ${(dEro * 1000).toFixed(3)} mm  mass rel ${s.mass.rel.toExponential(1)}`);
  }

  // Sediment transport in four grain classes: settling of each class in still water against its exact decay; a dam
  // break over an erodible bed (30 cm of cohesive loam; 1 cm of a sand–gravel mix with bedload) conserves solids per
  // class and water while the bed moves, and the scoured mix coarsens (the store is mixed over its depth); then a debris flow down a 20° gully onto a flat fan
  {
    const N0 = 100, sD = 0.2e-3, all = (v) => new Float32Array(N0).fill(v);
    const g0 = new GPUSolver(device, { nx: 10, ny: 10, dx: 2, z: new Float64Array(N0), manning: 0.03, scour: { tauC: all(1e9), n: all(0.03) }, sediment: { erodible: new Float32Array(N0 * 4), dSand: all(sD), dGravel: all(8e-3) } });
    g0.setDepth(() => 1); g0.setSediment(() => [0.001, 0.001, 0.001, 0.001]); await g0.advance(60);
    const s0 = await g0.readSediment(); g0.destroy();
    const ws = [settling(2e-6), settling(30e-6), settling(sD)], left = s0.classes.map(cl => cl.suspended / 400);
    const settleErr = Math.max(...ws.map((w, m) => Math.abs(left[m] / (0.001 * Math.exp(-w * 60)) - 1)));
    const settleSum = Math.max(...s0.classes.map(cl => Math.abs(cl.suspended + 0.6 * cl.change + cl.out - 0.4) / 0.4));
    const runs = {};
    for (const [name, mix, tauC, depth] of [['loam', [0.18, 0.4, 0.42, 0], 2, 0.3], ['sand+gravel', [0.02, 0.08, 0.6, 0.3], 1, 0.01]]) {
      const nx = 100, ny = 20, N = nx * ny, z = new Float64Array(N); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 0.002 * (nx - i);
      const er = new Float32Array(N * 4); for (let k = 0; k < N; k++) for (let m = 0; m < 4; m++) er[4 * k + m] = depth * mix[m];
      const g = new GPUSolver(device, { nx, ny, dx: 2, z, manning: 0.03, bc: { east: 'outflow' }, scour: { tauC: new Float32Array(N).fill(tauC), n: new Float32Array(N).fill(0.03) },
        sediment: { erodible: er, dSand: new Float32Array(N).fill(0.3e-3), dGravel: new Float32Array(N).fill(8e-3), tauSoil: new Float32Array(N).fill(tauC), nSkin: new Float32Array(N).fill(0.016) } });
      g.setDepth((x, y, zz) => (x < 40 ? 2 - zz : 0)); await g.advance(300);
      const sd = await g.readSediment(), st = await g.readState(); g.destroy();
      let lo = 0, coarser = 0, scoured = 0; const d0 = bedSize(mix, 0.3e-3);
      for (let k = 0; k < N; k++) { lo = Math.min(lo, sd.bed[k]); if (sd.bed[k] < -0.001) { scoured++; if (sd.size[k] > d0 * 1.01) coarser++; } }
      let ss = 0, sv = 0, n2 = 0; for (let k = 0; k < N; k++) if (sd.bed[k] < -0.001) { ss += Math.log(sd.size[k]); sv += Math.log(sd.storeSize[k]); n2++; } // surface vs whole store, geometric means
      const bal = Math.max(...sd.classes.map(cl => Math.abs(cl.suspended + 0.6 * cl.change + cl.out) / Math.max(1e-9, 0.6 * sd.totals.eroded)));
      runs[name] = { eroded: sd.totals.eroded, out: sd.out, solidsRel: bal, scourCm: -lo * 100, coarsened: scoured ? coarser / scoured : 0, waterMass: st.mass.rel, surfaceMm: n2 ? Math.exp(ss / n2) * 1000 : NaN, storeMm: n2 ? Math.exp(sv / n2) * 1000 : NaN };
    }
    // debris flow: a 20° gully 80 m long onto a flat fan, 1 m of gravelly sandy soil, a 2 m slurry at 40 % solids released at the top
    const nx = 80, ny = 24, dx = 2, N = nx * ny, z = new Float64Array(N), er = new Float32Array(N * 4);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i, x = i * dx; z[k] = Math.max(0, (80 - x) * Math.tan(20 * Math.PI / 180)) + 0.3 * Math.abs(j - 11.5); [0.05, 0.15, 0.5, 0.3].forEach((v, m) => { er[4 * k + m] = (x < 80 ? 1 : 0.3) * v; }); }
    const fill = (v) => new Float32Array(N).fill(v);
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.05, bc: { east: 'outflow' }, scour: { tauC: fill(3), n: fill(0.05) }, debris: true,
      sediment: { erodible: er, dSand: fill(0.3e-3), dGravel: fill(8e-3), tauSoil: fill(3), nSkin: fill(0.02), cohesion: fill(1000), tanPhi: fill(Math.tan(34 * Math.PI / 180)), soilDepth: fill(1), thetaE: fill(0.35) } });
    const slurry = (x, y) => x < 10 && Math.abs(y / dx - 11.5) < 4;
    g.setDepth((x, y) => (slurry(x, y) ? 2 : 0)); g.setSediment((x, y) => (slurry(x, y) ? [0.04, 0.12, 0.4, 0.24] : 0)); await g.advance(120);
    const sd = await g.readSediment(), st = await g.readState(); g.destroy();
    let cMax = 0, fan = 0, gully = 0; for (let k = 0; k < N; k++) { const h = st.h[k]; if (h > 0.05) cMax = Math.max(cMax, sd.suspended[k] / h); const x = (k % nx) * dx; if (x >= 80) fan += Math.max(0, sd.bed[k]) * dx * dx; else gully -= Math.min(0, sd.bed[k]) * dx * dx; }
    let nSl = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (slurry((i + 0.5) * dx, (j + 0.5) * dx)) nSl++;
    const init = [0.04, 0.12, 0.4, 0.24].map(v => v * nSl * dx * dx), debBal = Math.max(...sd.classes.map((cl, m) => Math.abs(cl.suspended + 0.6 * cl.change + cl.out - init[m]) / (init[0] + init[1] + init[2] + init[3])));
    runs.debris = { gullyEroded: gully, fanDeposit: fan, cMax, solidsRel: debBal, waterMass: st.mass.rel, pore: sd.pore };
    results.sediment = { settleErr, settleSum, ...runs };
    log(`sediment, 4 classes: settling vs exact ${(settleErr * 100).toFixed(3)} % (solids ${settleSum.toExponential(1)})  dam break loam / sand+gravel: eroded ${runs.loam.eroded.toFixed(2)} / ${runs['sand+gravel'].eroded.toFixed(1)} m³, scour ${runs.loam.scourCm.toFixed(2)} / ${runs['sand+gravel'].scourCm.toFixed(1)} cm, scoured beds coarser ${(runs.loam.coarsened * 100).toFixed(0)} / ${(runs['sand+gravel'].coarsened * 100).toFixed(0)} %, solids balance per class ${runs.loam.solidsRel.toExponential(1)} / ${runs['sand+gravel'].solidsRel.toExponential(1)}, water mass ${runs.loam.waterMass.toExponential(1)} / ${runs['sand+gravel'].waterMass.toExponential(1)}`);
    log(`debris flow: gully eroded ${gully.toFixed(1)} m³, fan deposit ${fan.toFixed(1)} m³, peak concentration ${(cMax * 100).toFixed(0)} %, solids balance ${debBal.toExponential(1)}, water (mixture books) ${st.mass.rel.toExponential(1)}, pore water released ${sd.pore.toFixed(1)} m³`);
  }
  // Armouring: a steep steady clear-water flow (≈ 20 Pa: sand winnowed into suspension, 8 mm gravel too heavy to suspend)
  // over a 0.3 m sand–gravel bed for an hour. Just below the clear-water inflow (sand-starved) the surface layer loses sand
  // and gains gravel share; the store beneath, mixed through its 0.3 m, hardly changes (without the active layer the two
  // would be the same)
  {
    const S = 0.01, nx = 100, ny = 12, dx = 2, N = nx * ny, z = new Float64Array(N), mix = [0.02, 0.08, 0.6, 0.3], er = new Float32Array(N * 4);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; z[k] = S * (nx - i) * dx + (j === 0 || j === ny - 1 ? 3 : 0); for (let m = 0; m < 4; m++) er[4 * k + m] = (i > 4 ? 0.3 : 0) * mix[m]; }
    const fill = (v) => new Float32Array(N).fill(v), inlets = []; for (let j = 1; j < ny - 1; j++) inlets.push(j * nx + 1);
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.03, inlets, bc: { east: 'outflow', west: 'wall', north: 'wall', south: 'wall' }, scour: { tauC: fill(0.05), n: fill(0.03) },
      sediment: { erodible: er, dSand: fill(0.3e-3), dGravel: fill(8e-3), tauSoil: fill(0.05), nSkin: fill(0.016) } });
    g.setDepth(() => 0); g.setInletRates(inlets.map(() => -0.28)); // 0.14 m²/s
    const mean = (sd) => { let a = 0, b = 0, n = 0; for (let j = 2; j < ny - 2; j++) for (let i = 6; i < 20; i++) { const k = j * nx + i; a += sd.surfaceGravel[k]; b += sd.storeGravel[k]; n++; } return [a / n, b / n]; };
    await g.advance(1800); const [s30] = mean(await g.readSediment()); await g.advance(3600);
    const sd = await g.readSediment(), [s60, b60] = mean(sd); g.destroy();
    const bal = Math.max(...sd.classes.map(cl => Math.abs(cl.suspended + 0.6 * cl.change + cl.out) / Math.max(1e-9, 0.6 * sd.totals.eroded)));
    results.armour = { surfaceGravel30: s30, surfaceGravel60: s60, storeGravel60: b60, eroded: sd.totals.eroded, solidsRel: bal };
    log(`armouring (steady ~20 Pa over 0.3 m sand+gravel, 1 h): surface gravel share ${(s30 * 100).toFixed(1)} % at 30 min, ${(s60 * 100).toFixed(1)} % at 60 min vs ${(b60 * 100).toFixed(1)} % in the store beneath (30 % at the start), solids balance per class ${bal.toExponential(1)}`);
  }

  // Bank stability every step: a full channel drains through its open end; the banks' water table lags (T = 20 min),
  // so the lowest factor of safety comes after the river has dropped (rapid drawdown); the kernel's FS at the end
  // matches src/banks.js for the same water levels
  {
    const nx = 80, ny = 16, dx = 1, N = nx * ny, z = new Float64Array(N), water = new Uint8Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; z[k] = (j < 6 ? 0 : Math.min(3, (j - 5) * 1.5)) - 0.001 * i; if (j < 6) water[k] = 1; }
    const banks = []; for (let i = 5; i < 75; i += 5) banks.push({ top: 8 * nx + i, toe: 5 * nx + i, L: 3, c: 3000, tanPhi: Math.tan(28 * Math.PI / 180), T: 1200, wt: null });
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.03, banks, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' } });
    g.setDepth((x, y, zz) => (y < 6 ? Math.max(0, 2.4 - zz) : 0));
    const r0 = (await g.advance(1), await g.readBanks()); await g.advance(3600);
    const r = await g.readBanks(), st = await g.readState(); g.destroy();
    const b = 7, top = banks[b].top, toe = banks[b].toe, H = z[top] - z[toe];
    const hb = H, hp = r.table[b] - z[toe], hw = st.h[toe];
    const js = bankFS(hb, 3, 3000, Math.tan(28 * Math.PI / 180), hp, hw);
    results.banks = { fsStart: r0.fsNow[b], minFS: r.minFS[b], tMinFS: r.tMinFS[b], fsEnd: r.fsNow[b], fsJs: js.fs, fsRel: Math.abs(r.fsNow[b] / js.fs - 1), maxPf: r.maxPf[b], hwMax: r.hwMax[b], table: r.table[b], H };
    log(`banks: FS at the start ${r0.fsNow[b].toFixed(2)} (channel full), lowest ${r.minFS[b].toFixed(2)} at ${(r.tMinFS[b] / 60).toFixed(0)} min (rapid drawdown), end ${r.fsNow[b].toFixed(2)} vs src/banks.js ${js.fs.toFixed(2)} (rel ${results.banks.fsRel.toExponential(1)}), peak probability of failure ${(r.maxPf[b] * 100).toFixed(0)} %`);
  }

  // Control lines (site design, phase 2): the volume booked across a line every stage equals the books. A dam break down
  // a walled channel with an outflow end: water past a line across the channel = storage downstream of it + edge
  // outflow. Rain on a tilted basin open on every side: water out across a ring one cell inside the edge = edge
  // outflow + what the outer ring still holds (no rain falls on the ring). Tiled and untiled.
  for (const tiles of [true, false]) {
    const nx = 120, ny = 16, dx = 1, z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 2 - 0.01 * i + 0.05 * Math.sin(i / 7) * Math.cos(j / 3);
    const cut = 80, { faces } = lineFaces([[[cut, ny + 1], [cut, -1]]], nx, ny); // drawn northward: + = eastward
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.03, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' }, lines: faces, tiles });
    g.setDepth((x, y, zz) => (x < 30 ? Math.max(0, 2.6 - zz) : 0));
    await g.advance(240);
    const s = await g.readState(), L = await g.readLines(); let east = 0;
    for (let j = 0; j < ny; j++) for (let i = cut; i < nx; i++) east += s.h[j * nx + i];
    const books = east * dx * dx + s.mass.outflow, rel = (L.net[0] - books) / books;
    results[`lineChannel${tiles ? '' : 'Untiled'}`] = { line: L.net[0], back: L.minus[0], storageDownstream: east * dx * dx, edgeOutflow: s.mass.outflow, rel };
    log(`control line across a channel${tiles ? '' : ' (untiled)'}: ${L.net[0].toFixed(3)} m³ past it (${L.minus[0].toFixed(3)} back) vs downstream storage ${(east * dx * dx).toFixed(3)} + edge outflow ${s.mass.outflow.toFixed(3)} = ${books.toFixed(3)} m³, rel ${rel.toExponential(1)}`);
    g.destroy();
  }
  {
    const nx = 90, ny = 70, dx = 2, N = nx * ny, z = new Float64Array(N), rf = new Float64Array(N).fill(1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      z[j * nx + i] = 5 - 0.02 * Math.abs(i - 40) * dx - 0.015 * Math.abs(j - 30) * dx - 0.3 * Math.exp(-((i - 60) ** 2 + (j - 20) ** 2) / 50); // a dome: water runs off every edge
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) rf[j * nx + i] = 0;
    }
    const { faces } = lineFaces([[[1, 1], [nx - 1, 1], [nx - 1, ny - 1], [1, ny - 1], [1, 1]]], nx, ny);
    const g = new GPUSolver(device, { nx, ny, dx, z, manning: 0.035, rainField: rf, bc: { west: 'outflow', east: 'outflow', south: 'outflow', north: 'outflow' }, lines: faces });
    g.setDepth(() => 0); g.rainRate = 120 * MMHR;
    await g.advance(900);
    const s = await g.readState(), L = await g.readLines(); let ring = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) ring += s.h[j * nx + i];
    const books = s.mass.outflow + ring * dx * dx, rel = (L.net[0] - books) / books;
    results.lineAroundDomain = { line: L.net[0], edgeOutflow: s.mass.outflow, ringStorage: ring * dx * dx, rel, relToEdge: (L.net[0] - s.mass.outflow) / s.mass.outflow, faces: faces.length };
    log(`control line around the domain (${faces.length} faces): ${L.net[0].toFixed(3)} m³ out vs edge outflow ${s.mass.outflow.toFixed(3)} + outer ring ${(ring * dx * dx).toFixed(3)} = ${books.toFixed(3)} m³, rel ${rel.toExponential(1)} (vs the edge outflow alone ${(100 * results.lineAroundDomain.relToEdge).toFixed(2)} %)`);
    g.destroy();
  }

  // Rerunning a run gives Δ = 0: the same inputs and the same stop times give bit-identical depths, peak depths, hazard
  // products and control-line books, whatever the batch size (steps are cut only at the stop times)
  {
    const sc = cloudburst(96), opts = { nx: sc.nx, ny: sc.ny, dx: sc.dx, z: sc.z, mask: sc.mask, manning: sc.manning, infil: sc.infil, bc: sc.bc,
      lines: lineFaces([[[48, -1], [48, 97]]], sc.nx, sc.ny).faces };
    const go = async (K) => {
      const g = new GPUSolver(device, opts); sc.init(g); g.rainRate = 150 * MMHR;
      for (const t of [60, 120, 300, 420, 600]) await g.advance(t, K);
      const s = await g.readState(), hz = await g.readHazard(), L = await g.readLines(); g.destroy();
      return { s, hz, L };
    };
    const a = await go(64), b = await go(64), c = await go(7);
    const cmp = (x, y) => { let n = 0, m = 0; for (const key of ['h', 'hu', 'hv', 'hmax']) for (let k = 0; k < x.s[key].length; k++) { const d = Math.abs(x.s[key][k] - y.s[key][k]); if (d > 0) n++; if (d > m) m = d; }
      for (const key of ['dv', 'force', 'duration', 'vmax']) for (let k = 0; k < x.hz[key].length; k++) { const d = Math.abs(x.hz[key][k] - y.hz[key][k]); if (d > 0) n++; if (d > m) m = d; }
      return { cells: n, max: m, line: Math.abs(x.L.net[0] - y.L.net[0]), out: Math.abs(x.s.mass.outflow - y.s.mass.outflow) }; };
    const same = cmp(a, b), batch = cmp(a, c);
    results.rerun = { same, batch };
    log(`rerun (urban cloudburst, 600 s): Δ between two runs: ${same.cells} values differ (max ${same.max.toExponential(1)}), line Δ ${same.line.toExponential(1)} m³, outflow Δ ${same.out.toExponential(1)} m³;  batch of 7 vs 64 steps: ${batch.cells} differ (max ${batch.max.toExponential(1)}), line Δ ${batch.line.toExponential(1)} m³`);
  }

  // Stormwater (site design, phase 3). A dry pond (a 30 m square bowl, 3:1 sides, 1.5 m deep) full to 1.3 m drains
  // through one 6 in orifice off the model: its stage and outflow follow level-pool (modified Puls) routing done in JS
  // on the same stage–storage, and the surface books close with the outlet's water booked as it leaves. Then the same
  // pond outlet discharging into a ditch downstream (water in transit counts as stored).
  {
    const n = 60, dx = 1, N = n * n, z = new Float64Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const d = Math.min(i + 0.5 - 15, 45 - i - 0.5, j + 0.5 - 15, 45 - j - 0.5); z[j * n + i] = d < 0 ? 10 : Math.max(8.5, 10 - d / 3); } // d: cell centre to the bank top
    for (let j = 26; j < 35; j++) for (let i = 50; i < 58; i++) z[j * n + i] = 7; // a ditch downstream, below the pond
    const inPond = (i, j) => i >= 15 && i < 45 && j >= 15 && j < 45, pondCells = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (inPond(i, j)) pondCells.push(j * n + i);
    const a = 30 * n + 30, h0 = 9.8, o = { orifices: [{ D: 0.1524, inv: 8.5 }] };
    for (const mode of ['offsite', 'surface']) {
      const b = mode === 'surface' ? 30 * n + 55 : -1;
      const g = new GPUSolver(device, { nx: n, ny: n, dx, z, manning: 0.03, inlets: mode === 'surface' ? [a, b] : [a], bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' } });
      g.setDepth((x, y, zz) => (inPond(Math.floor(x), Math.floor(y)) ? Math.max(0, h0 - zz) : 0));
      const L = new OutletLinks([{ a, b, node: -1, mode, structure: o, id: 1 }], z, { cellArea: dx * dx }), hub = new LinkHub(g, [L], 2), track = [];
      const step0 = L.step.bind(L); L.step = (vol, h, iv) => { track.push([hub.tNext, z[a] + h[0]]); return step0(vol, h, iv); };
      const tEnd = 1800; while (hub.tNext <= tEnd) { await g.advance(hub.tNext); await hub.exchange(); }
      const st = await g.readState();
      if (mode === 'offsite') {
        const ss = stageStorage(z, pondCells, dx * dx, 10, 151), puls = modifiedPuls(() => 0, ss, (h) => rating(o, h).q, { h0, dt: 2, tEnd });
        let dmax = 0; for (const [t, H] of track) { const p = puls[Math.round(t / 2)]; if (p) dmax = Math.max(dmax, Math.abs(H - p.h)); }
        const outGPU = L.totals.offsite, Vjs = puls[0].S - puls.at(-1).S;
        results.pondPuls = { maxStageDiff: dmax, outGPU, outJS: Vjs, volRel: (outGPU - Vjs) / Vjs, massRel: st.mass.rel, exchanged: st.mass.exchanged };
        log(`pond, one orifice vs modified Puls (30 min drawdown): max |Δstage| ${(dmax * 1000).toFixed(1)} mm, out ${outGPU.toFixed(2)} vs ${Vjs.toFixed(2)} m³ (${(100 * results.pondPuls.volRel).toFixed(2)} %), surface books ${st.mass.rel.toExponential(1)} (outlet volume booked as exchanged ${st.mass.exchanged.toFixed(2)} m³)`);
      } else {
        const m = st.mass, inTr = L.inTransit;
        // the surface link moves water within the model: stored + in transit = initial (no rain, walls)
        const relS = (m.volume + inTr - g.vol.initial) / g.vol.initial;
        results.pondSurface = { moved: L.totals.moved, inTransit: inTr, rel: relS, booksRel: m.rel };
        log(`pond outlet onto the ground: moved ${L.totals.moved.toFixed(2)} m³ (${inTr.toFixed(3)} in transit), stored + in transit vs the start ${relS.toExponential(1)}`);
      }
      g.destroy();
    }
  }
  // A rain garden with an underdrain: 50 mm/hr media into a 0.21 m store draining 2.5 mm/hr to the soil and 25 mm/hr
  // through the underdrain, under 100 mm/hr of rain for 30 min (walls, no soil infiltration elsewhere): the books
  // close, and the underdrain took its share of what drained
  {
    const n = 40, dx = 1, N = n * n, z = new Float64Array(N), rate = new Float64Array(N), cap = new Float64Array(N), drain = new Float64Array(N), under = new Float64Array(N), cells = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; z[k] = 5 + 0.002 * Math.hypot(i - 20, j - 20); if (Math.abs(i - 20) < 4 && Math.abs(j - 20) < 4) { z[k] -= 0.15; rate[k] = 50 * MMHR; cap[k] = 0.21; drain[k] = 2.5 * MMHR; under[k] = 25 * MMHR; cells.push(k); } }
    const g = new GPUSolver(device, { nx: n, ny: n, dx, z, manning: 0.04, gi: { rate, cap, drain, under }, underdrains: cells });
    g.setDepth(() => 0); g.rainRate = 100 * MMHR; await g.advance(1800); g.rainRate = 0; await g.advance(3600);
    const st = await g.readState(), ud = await g.readUnderdrains(); let U = 0; for (const v of ud) U += v * dx * dx;
    const drained = st.mass.infil - st.mass.giStored, share = U / drained;
    results.bioretention = { massRel: st.mass.rel, infil: st.mass.infil, stored: st.mass.giStored, underdrain: U, share, expectedShare: 25 / 27.5 };
    log(`rain garden + underdrain (1 h): books ${st.mass.rel.toExponential(1)}, into the media ${st.mass.infil.toFixed(2)} m³ = stored ${st.mass.giStored.toFixed(2)} + drained ${drained.toFixed(2)}; underdrain ${U.toFixed(2)} m³ = ${(100 * share).toFixed(2)} % of the drain (expected ${(100 * 25 / 27.5).toFixed(2)} %)`);
    g.destroy();
  }

  await runLtsSuite(device, log, results);
  return results;
}

/**
 * Local time stepping (o.lts): against global stepping on the GPU, against the fp64 CPU reference's own LTS, and
 * against the analytic dam breaks; still water at a stage boundary over a deep channel; a deep channel beside a wide
 * shallow floodplain (steps, wall time, depth differences, books); every per-step book (edges, lines, barriers,
 * inlets, rain, infiltration, hazard) against global stepping; and the modes it refuses. Throws on a failed check.
 */
export async function runLtsSuite(device, log, results) {
  const fails = [], R = results.lts = {};
  const check = (name, ok, detail) => { log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`); if (!ok) fails.push(name); };
  const run = async (opts, init, tEnd, rain = 0) => {
    const g = new GPUSolver(device, opts); init(g); g.rainRate = rain;
    await g.ready; const t0 = performance.now(); await g.advance(tEnd); const s = await g.readState();
    return { g, s, ms: performance.now() - t0 };
  };
  const maxDiff = (a, b, sel = () => true) => { let m = 0; for (let k = 0; k < a.length; k++) if (sel(k)) m = Math.max(m, Math.abs(a[k] - b[k])); return m; };
  const meanDiff = (a, b, sel = () => true) => { let m = 0, n = 0; for (let k = 0; k < a.length; k++) if (sel(k) && (a[k] > 0.01 || b[k] > 0.01)) { m += Math.abs(a[k] - b[k]); n++; } return n ? m / n : 0; };

  // dam breaks: as accurate as global stepping, and close to the CPU reference's LTS
  for (const [name, hR] of [['stoker', 0.5], ['ritter', 0]]) {
    const nx = 400, ny = 3, dx = 100 / nx, opts = { nx, ny, dx, z: new Float64Array(nx * ny), manning: 0 }, init = s => s.setDepth(x => (x < 50 ? 1 : hR));
    const a = await run(opts, init, 6), b = await run({ ...opts, lts: true }, init, 6);
    const c = new CPUSolver({ ...opts, hdry: b.g.hdry, lts: true }); init(c); c.run(6); const ch = c.field('h');
    const ex = damBreak(1, hR, 50), L1 = (h) => { let e = 0, n = 0; for (let i = 0; i < nx; i++) { const he = ex((i + 0.5) * dx, 6); e += Math.abs(h[nx + i] - he); n += he; } return e / n; };
    const r = R[name] = { L1global: L1(a.s.h), L1lts: L1(b.s.h), vsGlobal: maxDiff(a.s.h, b.s.h), vsCPU: maxDiff(ch, b.s.h), mass: b.s.mass.rel, cycles: b.g.steps, steps: a.g.steps };
    log(`LTS ${name}: L1 ${r.L1global.toExponential(3)} global → ${r.L1lts.toExponential(3)} LTS, max |Δh| vs global ${r.vsGlobal.toExponential(1)} m, vs CPU LTS ${r.vsCPU.toExponential(1)} m, mass ${r.mass.toExponential(1)}, ${r.steps} steps → ${r.cycles} cycles`);
    check(`${name} L1`, r.L1lts <= 1.1 * r.L1global, `within 10 % of global`);
    check(`${name} vs CPU LTS`, r.vsCPU < 0.02, `max |Δh| ${r.vsCPU.toExponential(1)} < 0.02 m`);
    check(`${name} mass`, Math.abs(r.mass) < 1e-5, `${r.mass.toExponential(1)}`);
    a.g.destroy(); b.g.destroy();
  }

  // a deep (7 m) channel along x beside a floodplain, bed ~100 m (fp32), cells of 1 m
  const channel = (nx, ny, w, z0 = 100) => {
    const z = new Float64Array(nx * ny), j0 = (ny - w) >> 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = z0 + ((j >= j0 && j < j0 + w) ? -7 : 0.3 - 0.002 * i + 0.01 * Math.sin(j / 5));
    return { z, inCh: (k) => { const j = (k / nx) | 0; return j >= j0 && j < j0 + w; } };
  };
  // still water at a stage boundary (the west edge, channel and floodplain) stays still
  {
    const nx = 128, ny = 96, { z } = channel(nx, ny, 12), stageCells = []; for (let j = 0; j < ny; j++) stageCells.push(j * nx);
    const zs = 100.1, opts = { nx, ny, dx: 1, z, manning: 0.03, bc: { west: 'outflow', east: 'outflow', south: 'wall', north: 'wall' }, stageCells, lts: true };
    const b = await run(opts, s => { s.setStage(zs); s.setDepth((x, y, zz) => Math.max(0, zs - zz)); }, 120);
    let umax = 0; for (let k = 0; k < b.s.h.length; k++) if (b.s.h[k] > 1e-3) umax = Math.max(umax, Math.hypot(b.s.hu[k], b.s.hv[k]) / b.s.h[k]);
    R.stillStage = { umax, boundaryFlux: b.s.mass.outflow, mass: b.s.mass.rel, cycles: b.g.steps };
    log(`LTS still water at a stage boundary over a 7 m channel (120 s): max |u| ${umax.toExponential(1)} m/s, boundary flux ${b.s.mass.outflow.toExponential(1)} m³, mass ${b.s.mass.rel.toExponential(1)}`);
    check('still water at the stage', umax < 1e-3, `max |u| ${umax.toExponential(1)} < 1e-3 m/s (fp32 at z = 100 m)`);
    b.g.destroy();
  }
  // a 0.5 m surge up the channel beside a shallow sheet-flow floodplain, which the channel overtops where the floodplain
  // falls below its 100 m water (east of x = 150 m): LTS vs global, and vs the CPU reference's LTS. The largest depth
  // differences sit on the moving fronts (a timing difference), so the mean over wet cells is checked as well
  for (const [nx, ny, w, T] of [[256, 192, 12, 60], [1024, 768, 24, 60]]) {
    const { z, inCh } = channel(nx, ny, w), opts = { nx, ny, dx: 1, z, manning: 0.03, bc: { east: 'outflow' } };
    const init = s => s.setDepth((x, y, zz) => zz < 96 ? (x < 40 ? 100.5 : 100) - zz : 0.05);
    const a = await run(opts, init, T), b = await run({ ...opts, lts: true }, init, T);
    let at = 0; for (let k = 0; k < a.s.h.length; k++) if (!inCh(k) && Math.abs(a.s.h[k] - b.s.h[k]) > Math.abs(a.s.h[at] - b.s.h[at])) at = k;
    log(`  largest floodplain depth difference at cell (${at % nx}, ${(at / nx) | 0}): ${a.s.h[at].toFixed(4)} m global, ${b.s.h[at].toFixed(4)} m LTS`);
    const r = R[`channel${nx}`] = { cells: nx * ny, T, steps: a.g.steps, cycles: b.g.steps, msGlobal: a.ms, msLTS: b.ms, speedup: a.ms / b.ms,
      dChannel: maxDiff(a.s.h, b.s.h, inCh), dFloodplain: maxDiff(a.s.h, b.s.h, k => !inCh(k)), meanFloodplain: meanDiff(a.s.h, b.s.h, k => !inCh(k)), dMax: maxDiff(a.s.hmax, b.s.hmax), meanMax: meanDiff(a.s.hmax, b.s.hmax),
      massGlobal: a.s.mass.rel, massLTS: b.s.mass.rel };
    log(`LTS deep channel + floodplain ${nx}×${ny}, ${T} s: ${r.steps} steps → ${r.cycles} cycles of 8, wall ${(a.ms / 1000).toFixed(2)} s → ${(b.ms / 1000).toFixed(2)} s (${r.speedup.toFixed(2)}×); max |Δh| channel ${r.dChannel.toExponential(1)}, floodplain ${r.dFloodplain.toExponential(1)} (mean ${r.meanFloodplain.toExponential(1)}), peak depth ${r.dMax.toExponential(1)} (mean ${r.meanMax.toExponential(1)}) m; mass ${r.massGlobal.toExponential(1)} → ${r.massLTS.toExponential(1)}`);
    check(`channel ${nx} channel depth`, r.dChannel < 0.02, `${r.dChannel.toExponential(1)} < 0.02 m`);
    check(`channel ${nx} floodplain depth`, r.dFloodplain < 0.02 && r.meanFloodplain < 1e-3, `max ${r.dFloodplain.toExponential(1)} < 0.02 m, mean ${r.meanFloodplain.toExponential(1)} < 1e-3 m`);
    check(`channel ${nx} peak depth`, r.meanMax < 1e-3, `mean ${r.meanMax.toExponential(1)} < 1e-3 m`);
    check(`channel ${nx} mass`, Math.abs(r.massLTS) < 1e-5, `${r.massLTS.toExponential(1)}`);
    if (nx === 256) {
      const c = new CPUSolver({ ...opts, hdry: b.g.hdry, lts: true }); init(c); c.run(T); const ch = c.field('h');
      r.vsCPU = maxDiff(ch, b.s.h); log(`  CPU LTS vs GPU LTS: max |Δh| ${r.vsCPU.toExponential(1)} m (${c.steps} cycles, ${c.records} records)`);
      check('channel vs CPU LTS', r.vsCPU < 0.02, `${r.vsCPU.toExponential(1)} < 0.02 m`);
    } else check(`channel ${nx} faster`, r.speedup > 1.5, `${r.speedup.toFixed(2)}× > 1.5×`);
    a.g.destroy(); b.g.destroy();
  }

  // every per-step book: rain, Green-Ampt infiltration, a drainage inlet (drawing from the channel at a fixed rate), a
  // weir across the channel, a control line across it, the edge outflow and the hazard products, LTS vs global
  {
    const nx = 128, ny = 96, N = nx * ny, { z } = channel(nx, ny, 12), ga = { psiD: new Float32Array(N).fill(0.05), fmax: new Float32Array(N).fill(0.3), perv: new Float32Array(N).fill(0.5) };
    const crest = []; for (let j = 42; j < 54; j++) crest.push({ i: 90, j, axis: 0, z: 99.8, C: 1.6, ground: z[j * nx + 90] });
    const { faces } = lineFaces([[[64, ny + 1], [64, -1]]], nx, ny), inlet = 47 * nx + 30;
    const opts = { nx, ny, dx: 1, z, manning: 0.03, infil: 5 * MMHR, ga, crest, lines: faces, inlets: [inlet], bc: { east: 'outflow', west: 'wall', south: 'outflow', north: 'outflow' } };
    const init = s => { s.setDepth((x, y, zz) => zz < 96 ? (x < 40 ? 100.5 : 100) - zz : 0); s.setInletRates([0.02]); };
    const a = await run(opts, init, 600, 60 * MMHR), b = await run({ ...opts, lts: true }, init, 600, 60 * MMHR);
    const [La, Lb] = [await a.g.readLines(), await b.g.readLines()], [Ba, Bb] = [await a.g.readBarriers(), await b.g.readBarriers()], [Ha, Hb] = [await a.g.readHazard(), await b.g.readHazard()];
    const [Xa, Xb] = [await a.g.readInlets(), await b.g.readInlets()], sum = (o) => o.plus.reduce((p, q) => p + q, 0) + o.minus.reduce((p, q) => p + q, 0);
    const rel = (x, y) => Math.abs(x - y) / Math.max(1e-9, Math.abs(x));
    const r = R.books = { massGlobal: a.s.mass.rel, massLTS: b.s.mass.rel, line: [La.net[0], Lb.net[0]], barrier: [sum(Ba), sum(Bb)], inlet: [Xa.vol[0], Xb.vol[0]],
      infil: [a.s.mass.infil, b.s.mass.infil], outflow: [a.s.mass.outflow, b.s.mass.outflow], dv: maxDiff(Ha.dv, Hb.dv), dh: maxDiff(a.s.h, b.s.h), meanDh: meanDiff(a.s.h, b.s.h),
      arrival: maxDiff(Ha.arrival.map(v => v || 0), Hb.arrival.map(v => v || 0)), cycles: b.g.steps, steps: a.g.steps };
    log(`LTS books (rain 60 mm/h, Green-Ampt, inlet, barrier, line, 600 s; ${r.steps} steps → ${r.cycles} cycles): mass ${r.massGlobal.toExponential(1)} → ${r.massLTS.toExponential(1)}; line ${r.line.map(v => v.toFixed(2)).join(' → ')} m³, barrier ${r.barrier.map(v => v.toFixed(3)).join(' → ')} m³, inlet ${r.inlet.map(v => v.toFixed(2)).join(' → ')} m³, infiltration ${r.infil.map(v => v.toFixed(1)).join(' → ')} m³, edge out ${r.outflow.map(v => v.toFixed(1)).join(' → ')} m³; max |Δ d·v| ${r.dv.toExponential(1)} m²/s, max |Δh| ${r.dh.toExponential(1)} m (mean ${r.meanDh.toExponential(1)} m), max Δ arrival ${r.arrival.toFixed(1)} s`);
    check('books depth', r.meanDh < 1e-3, `mean |Δh| ${r.meanDh.toExponential(1)} < 1e-3 m`);
    check('books mass', Math.abs(r.massLTS) < 1e-5, `${r.massLTS.toExponential(1)}`);
    check('books line', rel(r.line[0], r.line[1]) < 0.02, `within 2 %`);
    check('books barrier', Math.abs(r.barrier[0] - r.barrier[1]) < 0.05 * Math.max(1, r.barrier[0]), `within 5 % (or 0.05 m³)`);
    check('books inlet', rel(r.inlet[0], r.inlet[1]) < 1e-3, `within 0.1 %`);
    check('books infiltration', rel(r.infil[0], r.infil[1]) < 0.01, `within 1 %`);
    check('books edge outflow', rel(r.outflow[0], r.outflow[1]) < 0.02, `within 2 %`);
    a.g.destroy(); b.g.destroy();
  }

  // the modes it refuses step globally and say why
  {
    const N0 = 100, all = (v) => new Float32Array(N0).fill(v), base = { nx: 10, ny: 10, dx: 2, z: new Float64Array(N0), manning: 0.03, lts: true };
    const sed = new GPUSolver(device, { ...base, scour: { tauC: all(1e9), n: all(0.03) }, sediment: { erodible: new Float32Array(N0 * 4), dSand: all(2e-4), dGravel: all(8e-3) } });
    const unt = new GPUSolver(device, { ...base, tiles: false });
    R.refused = { sediment: sed.ltsOff, untiled: unt.ltsOff };
    check('refuses sediment', sed.lts === 0 && !!sed.ltsOff, sed.ltsOff); check('refuses untiled', unt.lts === 0 && !!unt.ltsOff, unt.ltsOff);
    await sed.ready; await unt.ready; sed.destroy(); unt.destroy();
  }
  if (fails.length) throw new Error(`local time stepping: ${fails.length} check(s) failed: ${fails.join(', ')}`);
}
