// Gate B scoring: FloodSim results (benchmarks/ea/results/test*.json) against
//  (a) the spread of the packages in Néelz & Pender (2013, EA SC120002): values read by eye from its figures and
//      tables, each band widened by the stated reading precision, and
//  (b) where available, probe series from seven established codes run on the same cases (HEC-RAS 6.x ×2,
//      LISFLOOD-FP ACC / FV1 / DG2, TELEMAC-2D, ANUGA; github.com/scott-jeffers/benchmark1d2d, fetched to others/).
// Usage: node benchmarks/ea/score.mjs  → prints the table, writes results/score.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const load = (id) => (existsSync(here(`./results/test${id}.json`)) ? JSON.parse(readFileSync(here(`./results/test${id}.json`))) : null);
const H = 3600, MIN = 60;

// ---- measures on one probe series
const P = (r, id) => r.probes.find(p => p.id === String(id) || p.id === 'G' + id);
const at = (p, t, k = 'wl') => { const i = p.t.findIndex(x => x >= t - 1e-6); const v = p[k][i]; return v ?? (k === 'wl' ? p.zb : 0); };
const peak = (p, k = 'wl', t0 = 0, t1 = Infinity) => { let m = -Infinity; p.t.forEach((t, i) => { if (t >= t0 && t <= t1 && p[k][i] != null) m = Math.max(m, p[k][i]); }); return m; };
const arrival = (p, dh = 0.005) => { const i = p.h.findIndex(h => h > dh); return i < 0 ? Infinity : p.t[i]; };
const firstAbove = (p, v, k = 'wl') => { const i = p[k].findIndex(x => x != null && x >= v); return i < 0 ? Infinity : p.t[i]; };

// [label, measure(r), lo, hi, reading precision, units, scale for display]
const BANDS = {
  1: [
    ['P1 level reaches 10.345 m', r => firstAbove(P(r, 1), 10.345) / H, 3.1, 4.0, 0.1, 'h'],
    ['P1 level at 10 h (hold)', r => at(P(r, 1), 10 * H), 10.345, 10.352, 0.005, 'm'],
    ['P1 level at 20 h', r => at(P(r, 1), 20 * H), 10.25, 10.262, 0.005, 'm'],
    ['P2 level at 20 h', r => at(P(r, 2), 20 * H), 10.25, 10.262, 0.005, 'm'],
  ],
  2: [
    ['final volume (Table 4.3, full-SWE range)', r => r.finalVolume, 97162, 97393, 0, 'm³'],
    ['P4 peak level', r => peak(P(r, 4)), 9.72, 9.775, 0.01, 'm'],
    ['P4 level at 24 h', r => at(P(r, 4), 24 * H), 9.535, 9.55, 0.01, 'm'],
    ['P3 peak level', r => peak(P(r, 3)), 9.33, 9.35, 0.01, 'm'],
    ['P3 level at 24 h', r => at(P(r, 3), 24 * H), 9.205, 9.22, 0.01, 'm'],
    ['P1 arrival', r => arrival(P(r, 1)) / H, 2.5, 3.7, 0.25, 'h'],
    ['P1 level at 48 h', r => at(P(r, 1), 48 * H), 8.575, 8.595, 0.01, 'm'],
    ['P5 arrival', r => arrival(P(r, 5)) / H, 3.7, 12, 0.25, 'h'],
    ['P5 level at 48 h', r => at(P(r, 5), 48 * H), 8.15, 8.25, 0.01, 'm'],
    ['P13–16 stay dry (max depth)', r => Math.max(...[13, 14, 15, 16].map(i => peak(P(r, i), 'h'))), 0, 0.01, 0, 'm'],
  ],
  3: [
    ['P1 arrival', r => arrival(P(r, 1)), 60, 95, 5, 's'],
    ['P1 level at 150 s', r => at(P(r, 1), 150), 9.97, 9.99, 0.005, 'm'],
    ['P1 level at 600 s', r => at(P(r, 1), 600), 9.975, 9.99, 0.005, 'm'],
    ['P1 peak velocity', r => peak(P(r, 1), 'v'), 1.65, 2.2, 0.05, 'm/s'],
    ['P2 rise (+1 cm)', r => arrival(P(r, 2), 0.01), 145, 200, 5, 's'],
    ['P2 level at 600 s', r => at(P(r, 2), 600), 9.805, 9.828, 0.005, 'm'],
  ],
  4: [
    ['P1 arrival', r => arrival(P(r, 1)) / MIN, 8, 11, 3, 'min'],
    ['P1 peak depth', r => peak(P(r, 1), 'h'), 0.295, 0.333, 0.005, 'm'],
    ['P1 peak velocity', r => peak(P(r, 1), 'v', 30 * MIN), 0.37, 0.48, 0.01, 'm/s'],
    ['P3 arrival', r => arrival(P(r, 3)) / MIN, 25, 32, 3, 'min'],
    ['P3 peak depth', r => peak(P(r, 3), 'h'), 0.21, 0.228, 0.005, 'm'],
    ['P3 peak velocity', r => peak(P(r, 3), 'v', 40 * MIN), 0.15, 0.172, 0.01, 'm/s'],
    ['P5 arrival', r => arrival(P(r, 5)) / MIN, 52, 62, 3, 'min'],
    ['P5 peak depth', r => peak(P(r, 5), 'h'), 0.168, 0.182, 0.005, 'm'],
    ['P5 peak velocity', r => peak(P(r, 5), 'v', 65 * MIN), 0.095, 0.118, 0.01, 'm/s'],
    ['P6 arrival', r => arrival(P(r, 6)) / MIN, 54, 66, 3, 'min'],
    ['P6 peak depth', r => peak(P(r, 6), 'h'), 0.164, 0.178, 0.005, 'm'],
    ['P6 peak velocity', r => peak(P(r, 6), 'v', 65 * MIN), 0.096, 0.119, 0.01, 'm/s'],
  ],
  5: [
    ['P1 arrival', r => arrival(P(r, 1)) / H, 0.4, 0.45, 0.05, 'h'],
    ['P1 peak level', r => peak(P(r, 1)), 174.6, 175.05, 0.05, 'm'],
    ['P1 level at 10 h', r => at(P(r, 1), 10 * H), 172.25, 172.35, 0.05, 'm'],
    ['P1 peak velocity', r => peak(P(r, 1), 'v'), 1.9, 2.7, 0.1, 'm/s'],
    ['P3 arrival', r => arrival(P(r, 3)) / H, 0.85, 0.95, 0.05, 'h'],
    ['P3 peak level', r => peak(P(r, 3)), 155.8, 156.0, 0.05, 'm'],
    ['P3 level at 20 h', r => at(P(r, 3), 20 * H), 152.6, 152.75, 0.05, 'm'],
    ['P3 peak velocity', r => peak(P(r, 3), 'v'), 1.8, 2.45, 0.1, 'm/s'],
    ['P4 peak velocity', r => peak(P(r, 4), 'v'), 1.5, 2.2, 0.1, 'm/s'],
    ['P5 level at 20 h', r => at(P(r, 5), 20 * H), 148.5, 148.8, 0.05, 'm'],
    ['P7 peak level', r => peak(P(r, 7)), 155.5, 155.85, 0.05, 'm'],
    ['P7 level at 16 h', r => at(P(r, 7), 16 * H), 152.8, 153.0, 0.05, 'm'],
    ['P7 peak velocity', r => peak(P(r, 7), 'v'), 1.2, 1.6, 0.1, 'm/s'],
  ],
  '6a': [
    ['G2 peak level after the jump (10–20 s)', r => peak(P(r, 2), 'wl', 10, 20), 0.12, 0.17, 0.005, 'm'],
    ['G2 level at 30 s', r => at(P(r, 2), 30), 0.05, 0.10, 0.005, 'm'],
    ['G2 level at 60 s', r => at(P(r, 2), 60), 0.044, 0.072, 0.005, 'm'],
    ['G2 velocity, mean 3–9 s', r => { const p = P(r, 2), v = p.v.filter((_, i) => p.t[i] >= 3 && p.t[i] <= 9); return v.reduce((a, b) => a + b, 0) / v.length; }, 2.0, 2.3, 0.05, 'm/s'],
    ['G4 peak level', r => peak(P(r, 4)), 0.10, 0.145, 0.005, 'm'],
    ['G4 level at 20 s', r => at(P(r, 4), 20), 0.075, 0.095, 0.005, 'm'],
    ['G4 level at 60 s', r => at(P(r, 4), 60), 0.043, 0.068, 0.005, 'm'],
    ['G4 peak velocity', r => peak(P(r, 4), 'v', 0, 10), 1.27, 1.57, 0.05, 'm/s'],
    ['G5 peak level', r => peak(P(r, 5)), 0.09, 0.122, 0.005, 'm'],
    ['G5 level at 30 s', r => at(P(r, 5), 30), 0.04, 0.09, 0.005, 'm'],
    ['G6 level at 12 s', r => at(P(r, 6), 12), 0.265, 0.28, 0.005, 'm'],
    ['G6 level at 20 s', r => at(P(r, 6), 20), 0.20, 0.225, 0.005, 'm'],
    ['G6 level at 30 s', r => at(P(r, 6), 30), 0.155, 0.175, 0.005, 'm'],
    ['G6 level at 60 s', r => at(P(r, 6), 60), 0.084, 0.102, 0.005, 'm'],
  ],
  '6b': [
    ['G2 peak level', r => peak(P(r, 2)), 2.8, 3.25, 0.05, 'm'],
    ['G2 level at 200 s', r => at(P(r, 2), 200), 1.85, 2.03, 0.05, 'm'],
    ['G2 level at 400 s', r => at(P(r, 2), 400), 1.45, 1.55, 0.05, 'm'],
    ['G2 level at 600 s', r => at(P(r, 2), 600), 1.25, 1.35, 0.05, 'm'],
    ['G2 peak velocity', r => peak(P(r, 2), 'v'), 4.6, 5.4, 0.1, 'm/s'],
    ['G4 peak level', r => peak(P(r, 4)), 2.05, 2.53, 0.05, 'm'],
    ['G4 peak velocity', r => peak(P(r, 4), 'v'), 3.9, 4.9, 0.1, 'm/s'],
    ['G5 peak level', r => peak(P(r, 5)), 1.92, 2.43, 0.05, 'm'],
    ['G6 level at 60 s', r => at(P(r, 6), 60), 5.3, 5.55, 0.05, 'm'],
    ['G6 level at 100 s', r => at(P(r, 6), 100), 3.9, 4.3, 0.05, 'm'],
    ['G6 level at 200 s', r => at(P(r, 6), 200), 2.35, 2.6, 0.05, 'm'],
    ['G6 level at 300 s', r => at(P(r, 6), 300), 1.75, 1.9, 0.05, 'm'],
    ['G6 level at 600 s', r => at(P(r, 6), 600), 1.27, 1.35, 0.05, 'm'],
  ],
};

// Test 7: full-SWE packages (InfoWorks ICM, ISIS 2D, MIKE FLOOD, SOBEK, TUFLOW, XPSTORM; ISIS Fast excluded) read from
// Figures 4.32 (river) and 4.34–4.36 (floodplains), plus final levels the report states in its text (§4.8.5)
const RV = (r, n) => r.coupled.river[n];
BANDS['7'] = [
  ['M015 peak level', r => peak(RV(r, 'M015')), 14.5, 14.85, 0.05, 'm'],
  ['M015 level at 20 h', r => at(RV(r, 'M015'), 20 * H), 12.85, 13.3, 0.05, 'm'],
  ['M025 peak level', r => peak(RV(r, 'M025')), 13.22, 13.55, 0.05, 'm'],
  ['M025 level at 20 h', r => at(RV(r, 'M025'), 20 * H), 12.4, 12.75, 0.05, 'm'],
  ['M035 peak level', r => peak(RV(r, 'M035')), 12.55, 12.65, 0.05, 'm'],
  ['M035 level at 10 h', r => at(RV(r, 'M035'), 10 * H), 12.2, 12.4, 0.05, 'm'],
  ['M045 peak level', r => peak(RV(r, 'M045')), 12.02, 12.3, 0.05, 'm'],
  ['M045 level at 10 h', r => at(RV(r, 'M045'), 10 * H), 11.45, 11.6, 0.05, 'm'],
  ['M045 level at 30 h', r => at(RV(r, 'M045'), 30 * H), 8.6, 8.85, 0.05, 'm'],
  ['P2 (FP1) flooding starts', r => arrival(P(r, 2), 0.05) / H, 5.8, 7.5, 0.25, 'h'],
  ['P2 peak level', r => peak(P(r, 2)), 13.15, 13.4, 0.05, 'm'],
  ['P2 level at 40 h', r => at(P(r, 2), 40 * H), 11.57, 11.68, 0.05, 'm'],
  ['P6 (FP1) peak level (~13.20 ± 0.1, text)', r => peak(P(r, 6)), 13.1, 13.3, 0.05, 'm'],
  ['P1 final level (~12.13, text)', r => at(P(r, 1), 72 * H), 12.08, 12.18, 0.02, 'm'],
  ['P8 (FP2) flooding starts', r => arrival(P(r, 8), 0.05) / H, 9.3, 10.5, 0.25, 'h'],
  ['P8 peak level', r => peak(P(r, 8)), 12.8, 12.93, 0.05, 'm'],
  ['P8 final level (~12.5, text)', r => at(P(r, 8), 72 * H), 12.42, 12.56, 0.02, 'm'],
  ['P11 (FP3) flooding starts', r => arrival(P(r, 11), 0.05) / H, 5.8, 8.0, 0.25, 'h'],
  ['P11 peak level', r => peak(P(r, 11)), 12.62, 12.9, 0.05, 'm'],
  ['P14 (FP3) flooding starts', r => arrival(P(r, 14), 0.05) / H, 8.0, 9.0, 0.25, 'h'],
  ['P14 peak level', r => peak(P(r, 14)), 12.48, 12.62, 0.05, 'm'],
  ['P14 final level (~11.5 ± 0.05, text)', r => at(P(r, 14), 72 * H), 11.45, 11.55, 0.02, 'm'],
];

// ---- (b) envelope of the seven codes' depth series at their sample times
const CODES = ['hecras', 'hecras66', 'lisflood-acc', 'lisflood-fv1', 'lisflood-dg2', 'telemac', 'anuga'];
function envelope(id, r, tol) {
  const dir = here(`./others/A2C-EA${id}/`); if (!existsSync(dir)) return null;
  const runs = CODES.map(m => (existsSync(new URL(m + '.json', dir)) ? JSON.parse(readFileSync(new URL(m + '.json', dir))).net?.probes : null)).filter(Boolean);
  const out = [];
  for (const [pid, ref] of Object.entries(runs[0])) {
    const ours = P(r, pid.slice(1)); if (!ours) continue;
    let n = 0, inside = 0, dev = [];
    ref.t.forEach((t, i) => {
      if (t <= 0 || t > r.probes[0].t.at(-1) + 1) return;
      // water level where everyone is wet (probe beds differ: cell means vs point samples), else depth
      const wet = at(ours, t, 'h') > 0.01 && runs.every(q => q[pid]?.wl[i] != null && q[pid].h[i] > 0.01), k = wet ? 'wl' : 'h';
      const vals = runs.map(q => q[pid]?.[k][i]).filter(v => v != null).sort((a, b) => a - b); if (vals.length < 3) return;
      const h = at(ours, t, k), med = vals[vals.length >> 1];
      n++; if (h >= vals[0] - tol && h <= vals.at(-1) + tol) inside++; dev.push(Math.abs(h - med));
    });
    dev.sort((a, b) => a - b);
    out.push({ probe: pid, samples: n, inside: inside / n, medianDev: dev[dev.length >> 1], p90Dev: dev[Math.floor(dev.length * 0.9)] });
  }
  return { codes: runs.length, tol, probes: out };
}

const report = {};
for (const id of Object.keys(BANDS)) {
  const r = load(id); if (!r) { console.log(`Test ${id}: no results`); continue; }
  const checks = BANDS[id].map(([label, f, lo, hi, prec, units]) => {
    const v = f(r), pass = v >= lo - prec && v <= hi + prec;
    return { label, value: v, lo, hi, prec, units, pass };
  });
  const env = envelope(id, r, id === '5' ? 0.1 : 0.02);
  report[id] = { grid: r.grid, steps: r.steps, wallSeconds: r.wallSeconds, massRel: r.mass.rel, inflow: r.mass.inflowVolume, finalVolume: r.finalVolume, checks, envelope: env, passed: checks.filter(c => c.pass).length, total: checks.length };
  console.log(`\nTest ${id}  (${r.grid.nx}×${r.grid.ny} @ ${r.grid.dx} m, ${r.steps} steps, ${r.wallSeconds.toFixed(1)} s, mass rel ${r.mass.rel.toExponential(1)})  ${report[id].passed}/${report[id].total} inside the report's spread`);
  for (const c of checks) console.log(`  ${c.pass ? 'in ' : 'OUT'}  ${c.label.padEnd(42)} ${Number.isFinite(c.value) ? c.value.toFixed(c.units === 'm³' ? 0 : 3) : String(c.value)} ${c.units}   [${c.lo}–${c.hi} ±${c.prec}]`);
  if (env) console.log(`  vs ${env.codes} codes (level where wet, else depth; ±${env.tol} m): ` + env.probes.map(p => `${p.probe} ${(100 * p.inside).toFixed(0)}% in, median |Δ| ${(p.medianDev * 100).toFixed(1)} cm`).join(' · '));
}
writeFileSync(here('./results/score.json'), JSON.stringify(report, null, 1));
