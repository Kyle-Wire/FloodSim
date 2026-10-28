// Shared GPU verification suite (runs under Dawn/Node or in a browser).
import { GPUSolver } from '../src/solver-gpu.js';
import { CPUSolver } from '../src/solver-cpu.js';
import { damBreak, thackerPlanar } from '../src/analytic.js';
import { cloudburst, dambreak, MMHR } from '../src/scenarios.js';
import { buildSubgrid, fineDepth, cellVolume, CT } from '../src/subgrid.js';

export async function runGpuSuite(device, log = console.log) {
  const results = {};
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
    const G = await r.g.readHazard(), C = r.c.readHazard(); let cls = 0, wet = 0, dF = 0, dDV = 0, dDur = 0, dArr = 0;
    for (let k = 0; k < nx * ny; k++) {
      if (C.cls.arr[k] || G.cls.arr[k]) wet++;
      for (const s of ['arr', 'defra', 'defraUrban']) if (C.cls[s][k] !== G.cls[s][k]) cls++;
      dF = Math.max(dF, Math.abs(C.force[k] - G.force[k])); dDV = Math.max(dDV, Math.abs(C.dv[k] - G.dv[k])); dDur = Math.max(dDur, Math.abs(C.duration[k] - G.duration[k]));
      if (!Number.isNaN(C.arrival[k]) || !Number.isNaN(G.arrival[k])) dArr = Math.max(dArr, Math.abs(C.arrival[k] - G.arrival[k]));
    }
    results.hazard = { wetCells: wet, classMismatches: cls, maxForceDiff: dF, maxDvDiff: dDV, maxDurationDiffS: dDur, maxArrivalDiffS: dArr, maxH: r.dmax };
    log(`hazard every step: ${wet} cells reached, class mismatches vs CPU ${cls} (of ${3 * wet})  max|Δforce| ${dF.toExponential(1)} kN/m  max|Δd·v| ${dDV.toExponential(1)} m²/s  max|Δduration| ${dDur.toFixed(2)} s  max|Δarrival| ${dArr.toFixed(2)} s`);
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

  return results;
}
