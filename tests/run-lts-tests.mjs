// Local time stepping (CPUSolver o.lts): 8×8 tiles step at 2^m times a base step, the GPU's scheme in fp64.
// Checks that it keeps mass exact, keeps still water still over a deep channel next to a shallow floodplain, matches the
// analytic dam breaks as well as global stepping does, and on a deep tidal-style channel beside a wide shallow
// floodplain matches the global-step run closely in a fraction of the cell updates.
// Usage: node tests/run-lts-tests.mjs [--json out.json]
import { CPUSolver } from '../src/solver-cpu.js';
import { damBreak } from '../src/analytic.js';
import { writeFileSync } from 'node:fs';

const g = 9.81, results = {};
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const atMost = (name, v, max) => check(name, Math.abs(v) <= max, `|${v.toExponential(2)}| <= ${max.toExponential(2)}`);
const atLeast = (name, v, min) => check(name, v >= min, `${v.toFixed(2)} >= ${min}`);
const MASS = 1e-12;
// cell updates of a run: global = cells × steps; LTS counts each cell's own steps
const updates = (s) => s.lts ? s.cellSteps : s.steps * s.nx * s.ny;
const maxDiff = (a, b) => { let m = 0; for (let k = 0; k < a.length; k++) m = Math.max(m, Math.abs(a[k] - b[k])); return m; };

// ---------- 1. Dam breaks: LTS as accurate as global stepping ----------
// One wet/dry front and one shock cross tiles of different levels; the L1 error against the exact solution may grow
// by at most 10 % over global stepping's.
for (const [name, hR] of [['stoker', 0.5], ['ritter', 0]]) {
  const run = (lts) => {
    const nx = 400, ny = 3, dx = 100 / nx, s = new CPUSolver({ nx, ny, dx, z: new Float64Array(nx * ny), manning: 0, lts });
    s.setDepth((x) => (x < 50 ? 1 : hR)); s.run(6);
    const ex = damBreak(1, hR, 50, g), h = s.field('h'); let e = 0, n = 0;
    for (let i = 0; i < nx; i++) { const he = ex((i + 0.5) * dx, 6); e += Math.abs(h[nx + i] - he); n += Math.abs(he); }
    return { s, L1: e / n, h };
  };
  const a = run(false), b = run(true);
  results[name] = { L1global: a.L1, L1lts: b.L1, maxDiff: maxDiff(a.h, b.h), updates: [updates(a.s), updates(b.s)], massRel: b.s.massBalance().rel };
  console.log(`\n${name} dam break nx=400: L1 global ${a.L1.toExponential(3)}, LTS ${b.L1.toExponential(3)}; max |Δh| ${results[name].maxDiff.toExponential(2)} m; updates ${updates(a.s)} → ${updates(b.s)}`);
  check(`${name} LTS L1 within 10 % of global`, b.L1 <= 1.1 * a.L1, `${b.L1.toExponential(3)} <= ${(1.1 * a.L1).toExponential(3)}`);
  atMost(`${name} LTS mass balance`, b.s.massBalance().rel, MASS);
}

// ---------- 2. Deep channel beside a shallow floodplain ----------
// 256 × 192 cells of 1 m: a 7 m deep channel 12 cells wide along x (waves ~8 m/s), banks at 0, a floodplain under 5 cm
// of water draining down a 1:500 slope to an open east edge. The channel carries a 0.5 m surge (a tide front) from the
// west. Global stepping takes the channel's 0.03 s step everywhere; LTS lets most of the floodplain take 8× that, with a
// ring of tiles at 2× and 4× either side of the channel.
function channelCase(lts, still = false) {
  const nx = 256, ny = 192, dx = 1, z = new Float64Array(nx * ny), j0 = 90, j1 = 102;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = (j >= j0 && j < j1) ? -7 : 0.3 - 0.002 * i + (still ? 0 : 0.01 * Math.sin(j / 5));
  const s = new CPUSolver({ nx, ny, dx, z, manning: 0.03, lts, bc: still ? {} : { east: 'outflow' } });
  if (still) s.setDepth((x, y, zb) => Math.max(0, 0.1 - zb));
  else s.setDepth((x, y, zb) => zb < -1 ? (x < 40 ? 0.5 : 0) - zb : 0.05);
  return s;
}
{
  const s = channelCase(true, true), t0 = Date.now(); s.run(20);
  let vmax = 0; for (let k = 0; k < s.h.length; k++) if (s.h[k] > 1e-6) vmax = Math.max(vmax, Math.hypot(s.hu[k], s.hv[k]) / s.h[k]);
  console.log(`\nstill water over channel + floodplain, LTS 20 s: max |u| ${vmax.toExponential(2)} m/s, levels ${[...new Set(s.LV)].sort()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  results.still = { vmax, mass: s.massBalance().rel };
  atMost('still water stays still under LTS (max |u|)', vmax, 1e-10);
  atMost('still water LTS mass balance', s.massBalance().rel, MASS);
}
{
  const T = 60, a = channelCase(false), b = channelCase(true);
  let t0 = Date.now(); a.run(T); const wa = (Date.now() - t0) / 1000;
  t0 = Date.now(); b.run(T); const wb = (Date.now() - t0) / 1000;
  const ha = a.field('h'), hb = b.field('h'), nx = 256;
  let dCh = 0, dFp = 0, dMax = 0; for (let k = 0; k < ha.length; k++) { const j = (k / nx) | 0, d = Math.abs(ha[k] - hb[k]); if (j >= 90 && j < 102) dCh = Math.max(dCh, d); else dFp = Math.max(dFp, d); }
  const ma = a.maxDepth, mb = b.maxDepth; for (let k = 0; k < ma.length; k++) dMax = Math.max(dMax, Math.abs(ma[k] - mb[k]));
  const levels = [0, 1, 2, 3].map(m => b.LV.filter(v => v === m).length);
  const r = results.channel = { T, updatesGlobal: updates(a), updatesLTS: updates(b), speedup: updates(a) / updates(b), stepsGlobal: a.steps, cycles: b.steps, records: b.records,
    wallGlobal: wa, wallLTS: wb, maxDiffChannel: dCh, maxDiffFloodplain: dFp, maxDiffMaxDepth: dMax, massGlobal: a.massBalance().rel, massLTS: b.massBalance().rel, tilesPerLevel: levels };
  console.log(`\ndeep channel + floodplain, ${T} s: global ${a.steps} steps, LTS ${b.steps} cycles (${b.records} level steps), tiles per level ${levels.join('/')}`);
  console.log(`  cell updates ${r.updatesGlobal} → ${r.updatesLTS} (${r.speedup.toFixed(2)}× fewer); CPU wall ${wa.toFixed(1)} s → ${wb.toFixed(1)} s (the reference sweeps the whole grid every level step)`);
  console.log(`  max |Δh| channel ${dCh.toExponential(2)} m, floodplain ${dFp.toExponential(2)} m, max depth ${dMax.toExponential(2)} m; mass rel global ${r.massGlobal.toExponential(2)}, LTS ${r.massLTS.toExponential(2)}`);
  atLeast('channel + floodplain: LTS needs ≥ 3× fewer cell updates', r.speedup, 3);
  atMost('channel + floodplain: LTS depth within 2 cm of global in the channel', dCh, 0.02);
  atMost('channel + floodplain: LTS depth within 5 mm of global on the floodplain', dFp, 0.005);
  atMost('channel + floodplain: LTS mass balance', r.massLTS, MASS);
}

const ji = process.argv.indexOf('--json'); if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify(results, null, 1));
console.log(fails ? `\n${fails} FAILED` : '\nall LTS checks passed');
process.exit(fails ? 1 : 0);
