// Gate C: FloodSim against HEC-RAS 2D on the EA benchmark tests whose HEC-RAS results exist as data (Tests 1, 2, 4, 5:
// HEC-RAS 7.0.1 and 6.6, each with the SWE-ELM and SWE-EM equation sets, run by github.com/scott-jeffers/benchmark1d2d
// on the EA inputs; fetched to benchmarks/ea/others/).
//
// For each probe and sample time: water level where FloodSim and the HEC-RAS run are both wet (probe beds differ: cell
// means vs point samples), depth otherwise. To give "agrees" a scale, the same distance is measured between HEC-RAS
// and the other established codes (LISFLOOD-FP ×3, TELEMAC-2D, ANUGA): FloodSim agrees with HEC-RAS when it is no
// further from HEC-RAS than those codes are.
// Usage: node benchmarks/gatec/hecras-ea.mjs → benchmarks/gatec/results/hecras-ea.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const HECRAS = ['hecras', 'hecras-em', 'hecras66', 'hecras66-em'], OTHERS = ['lisflood-acc', 'lisflood-fv1', 'lisflood-dg2', 'telemac', 'anuga'];
const LABEL = { hecras: 'HEC-RAS 7.0.1 SWE-ELM', 'hecras-em': 'HEC-RAS 7.0.1 SWE-EM', hecras66: 'HEC-RAS 6.6 SWE-ELM', 'hecras66-em': 'HEC-RAS 6.6 SWE-EM' };
const load = (t, m) => { const f = here(`../ea/others/A2C-EA${t}/${m}.json`); return existsSync(f) ? JSON.parse(readFileSync(f)).net?.probes : null; };

/** FloodSim results as the same {P1: {t, wl, h}} shape. */
function floodsim(t) {
  const r = JSON.parse(readFileSync(here(`../ea/results/test${t}.json`)));
  return Object.fromEntries(r.probes.map(p => [`P${p.id}`, p]));
}
const sampleAt = (p, t) => { const i = p.t.findIndex(x => x >= t - 1e-6); return i < 0 ? null : { wl: p.wl[i], h: p.h[i] }; };

/** Distance between two probe sets at the reference's sample times: [{probe, n, median, p90, max}] (m). */
function distance(a, ref) {
  const out = [];
  for (const [pid, R] of Object.entries(ref)) {
    const A = a[pid]; if (!A) continue;
    const d = [];
    R.t.forEach((t, i) => {
      if (t <= 0) return;
      const s = sampleAt(A, t); if (!s) return;
      const wet = s.h > 0.01 && R.h[i] > 0.01 && R.wl[i] != null && s.wl != null;
      d.push(Math.abs(wet ? s.wl - R.wl[i] : s.h - R.h[i]));
    });
    if (!d.length) continue;
    d.sort((x, y) => x - y);
    out.push({ probe: pid, n: d.length, median: d[d.length >> 1], p90: d[Math.floor(0.9 * (d.length - 1))], max: d[d.length - 1] });
  }
  return out;
}
const pool = (rows, k) => { const v = rows.map(r => r[k]).sort((x, y) => x - y); return v[v.length >> 1]; };

const report = {};
for (const t of [1, 2, 4, 5]) {
  if (!existsSync(here(`../ea/results/test${t}.json`))) continue;
  const fs = floodsim(t), runs = {};
  for (const h of HECRAS) {
    const ref = load(t, h); if (!ref) continue;
    const ours = distance(fs, ref);
    const others = OTHERS.map(o => load(t, o)).filter(Boolean).map(o => distance(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v])), ref));
    // per probe: FloodSim's distance against the range of the other codes' distances to the same HEC-RAS run
    const probes = ours.map(p => {
      const od = others.map(rows => rows.find(r => r.probe === p.probe)).filter(Boolean);
      const worst = Math.max(...od.map(r => r.median)), best = Math.min(...od.map(r => r.median));
      return { ...p, othersMedian: [best, worst], within: p.median <= worst + 0.005 };
    });
    runs[h] = { label: LABEL[h], probes, medianOfMedians: pool(ours, 'median'), within: probes.filter(p => p.within).length, total: probes.length };
  }
  report[t] = runs;
  console.log(`\nEA Test ${t}`);
  for (const [h, r] of Object.entries(runs)) {
    console.log(`  vs ${r.label.padEnd(22)} median |Δ| ${(100 * r.medianOfMedians).toFixed(1)} cm · ${r.within}/${r.total} probes no further from HEC-RAS than the other codes`);
    for (const p of r.probes.filter(p => !p.within)) console.log(`     ${p.probe}: FloodSim ${(100 * p.median).toFixed(1)} cm, others ${(100 * p.othersMedian[0]).toFixed(1)}–${(100 * p.othersMedian[1]).toFixed(1)} cm`);
  }
}
mkdirSync(here('./results/'), { recursive: true });
writeFileSync(here('./results/hecras-ea.json'), JSON.stringify(report, null, 1));
