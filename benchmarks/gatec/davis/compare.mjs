// Gate C, Davis: FloodSim against HEC-RAS 7.0.2 (diffusion wave as shipped, and SWE-ELM) on the storm-sewer example.
// Every measure is also taken between the two HEC-RAS runs, so differences read against HEC-RAS's own spread.
//
// HEC-RAS depths are mapped onto FloodSim's grid the way RAS Mapper draws them: a pixel takes the water surface of the
// HEC-RAS cell it lies in (nearest cell centre; the mesh is a Voronoi tessellation of its centres) and its depth is
// that level minus the pixel's own terrain. Both models use the same terrain raster.
// Usage: node benchmarks/gatec/davis/compare.mjs → benchmarks/gatec/results/davis-compare.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const load = (p) => (existsSync(here(p)) ? JSON.parse(readFileSync(here(p))) : null);
const model = load('./model.json'), fs = load('../results/gatec-davis-floodsim.json'), fs2 = load('../results/gatec-davis-floodsim-2way.json');
const runs = { dwe: load('../results/gatec-davis-hecras-dwe.json'), swe: load('../results/gatec-davis-hecras-swe.json') };
if (!model || !fs || !runs.dwe) throw new Error('need model.json, FloodSim results and at least the HEC-RAS dwe results');
const { nx, ny, dx, x0ft, y1ft, resFt } = model.grid, N = nx * ny, A = dx * dx, inside = model.mask;

// ---- pixel → HEC-RAS cell (nearest centre, bucketed)
function pixelCells(centres) {
  const B = 300, buckets = new Map(), key = (x, y) => `${Math.floor(x / B)},${Math.floor(y / B)}`;
  centres.forEach(([x, y], k) => { const kk = key(x, y); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(k); });
  const out = new Int32Array(N).fill(-1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * nx + i; if (!inside[p]) continue;
    const x = x0ft + (i + 0.5) * resFt, y = y1ft - (j + 0.5) * resFt, bx = Math.floor(x / B), by = Math.floor(y / B);
    let best = -1, bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of buckets.get(`${bx + a},${by + b}`) ?? []) {
      const d = (centres[k][0] - x) ** 2 + (centres[k][1] - y) ** 2; if (d < bd) { bd = d; best = k; }
    }
    out[p] = best;
  }
  return out;
}
const depthMap = (wse, cellOf) => { const d = new Float32Array(N); for (let p = 0; p < N; p++) if (cellOf[p] >= 0) d[p] = Math.max(0, wse[cellOf[p]] - model.z[p]); return d; };

// ---- per-model views on the shared grid
const fsView = (r, label) => ({ label, t: r.series.t, volume: r.series.surfaceVolume, area3: r.series.flooded3cm, area15: r.series.flooded15cm, hmax: r.hmax,
  pump: r.series.pump, wetWell: r.series.wetWell, nodeHead: r.series.nodeHead, toNetwork: r.mass.coupler.toNetwork - r.mass.coupler.toSurface });
const views = { floodsim2: fs2 ? fsView(fs2, 'FloodSim two-way inlets') : null, floodsim: { label: 'FloodSim inlets in only', t: fs.series.t, volume: fs.series.surfaceVolume, area3: fs.series.flooded3cm, area15: fs.series.flooded15cm, hmax: fs.hmax,
  pump: fs.series.pump, wetWell: fs.series.wetWell, nodeHead: fs.series.nodeHead, toNetwork: fs.mass.coupler.toNetwork - fs.mass.coupler.toSurface } }; // toSurface already includes manhole overflow put back on the street
for (const [v, r] of Object.entries(runs)) {
  if (!r) continue;
  const cellOf = pixelCells(r.cells.centresFt), areas = r.area2WSE.map(wse => { const d = depthMap(wse, cellOf); let a3 = 0, a15 = 0; for (let p = 0; p < N; p++) { if (d[p] > 0.03) a3 += A; if (d[p] > 0.15) a15 += A; } return [a3, a15]; });
  const acc = r.volumeAccounting['/Volume Accounting 2D/area2'] ?? {}, AF = 1233.48184;
  views[v] = { label: v === 'dwe' ? 'HEC-RAS diffusion wave' : 'HEC-RAS SWE-ELM', t: r.t, volume: r.surfaceVolume, area3: areas.map(a => a[0]), area15: areas.map(a => a[1]),
    hmax: Array.from(depthMap(r.area2MaxWSE, cellOf)), pump: r.pump.flow, wetWell: r.pump.wetWell, nodeHead: r.nodeWSE,
    toNetwork: ((acc['Cum Outflow'] ?? 0) - ((acc['Cum Inflow'] ?? 0) - (acc['Precip Excess (acre feet)'] ?? 0))) * AF, volumeErrorPct: r.volumeAccounting.total?.['Error Percent'] };
}

// ---- measures
const peak = (s) => { let m = -Infinity, at = 0; s.forEach((v, i) => { if (v > m) { m = v; at = i; } }); return { value: m, i: at }; };
const integral = (t, s) => { let v = 0; for (let i = 1; i < t.length; i++) v += (s[i] + s[i - 1]) / 2 * (t[i] - t[i - 1]); return v; };
const nrmse = (a, b) => { const n = Math.min(a.length, b.length); let s = 0; for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / n) / Math.max(1e-9, Math.max(...b.slice(0, n))); };
function compare(a, b) { // a against reference b
  const pa = peak(a.volume), pb = peak(b.volume);
  const hm = [], ext = { both: 0, onlyA: 0, onlyB: 0 };
  for (let p = 0; p < N; p++) if (inside[p]) {
    const da = a.hmax[p], db = b.hmax[p]; if (da > 0.03 || db > 0.03) hm.push(da - db);
    const wa = da > 0.15, wb = db > 0.15; if (wa && wb) ext.both++; else if (wa) ext.onlyA++; else if (wb) ext.onlyB++;
  }
  hm.sort((x, y) => Math.abs(x) - Math.abs(y));
  const nodePeak = (v) => v.nodeHead[0].map((_, k) => Math.max(...v.nodeHead.map(r => r[k])));
  const na = nodePeak(a), nb = nodePeak(b), nd = na.map((v, k) => v - nb[k]).filter(Number.isFinite), ndAbs = nd.map(Math.abs).sort((x, y) => x - y);
  return {
    surfaceVolume: { peak: [pa.value, pb.value], peakRel: pa.value / pb.value - 1, peakTimeH: [a.t[pa.i] / 3600, b.t[pb.i] / 3600], end: [a.volume.at(-1), b.volume.at(-1)], nrmse: nrmse(a.volume, b.volume) },
    flooded15cm: { peak: [Math.max(...a.area15), Math.max(...b.area15)], peakRel: Math.max(...a.area15) / Math.max(...b.area15) - 1, nrmse: nrmse(a.area15, b.area15) },
    flooded3cm: { peak: [Math.max(...a.area3), Math.max(...b.area3)], peakRel: Math.max(...a.area3) / Math.max(...b.area3) - 1 },
    maxDepth: { medianAbs: Math.abs(hm[hm.length >> 1]), p90Abs: Math.abs(hm[Math.floor(hm.length * 0.9)]), bias: hm.reduce((s, v) => s + v, 0) / hm.length, csi15: ext.both / (ext.both + ext.onlyA + ext.onlyB) },
    pump: { peak: [Math.max(...a.pump), Math.max(...b.pump)], volume: [integral(a.t, a.pump), integral(b.t, b.pump)], volumeRel: integral(a.t, a.pump) / integral(b.t, b.pump) - 1 },
    wetWellPeak: [Math.max(...a.wetWell), Math.max(...b.wetWell)],
    nodePeakLevel: { medianAbs: ndAbs[ndAbs.length >> 1], p90Abs: ndAbs[Math.floor(ndAbs.length * 0.9)], bias: nd.reduce((s, v) => s + v, 0) / nd.length },
    netIntoPipes: [a.toNetwork, b.toNetwork],
  };
}
const pairs = [['floodsim2', 'dwe'], ['floodsim2', 'swe'], ['floodsim', 'dwe'], ['swe', 'dwe']].filter(([a, b]) => views[a] && views[b]);
const report = { model: model.source, rainMm: model.rain.totalMm, floodsim: Object.fromEntries([['inletsIn', fs], ['twoWay', fs2]].filter(([, r]) => r).map(([k, r]) => [k, { dsStage: r.dsStageSource, wallSeconds: r.wallSeconds, surfaceMassRel: r.mass.surface.rel, swmmContinuityPct: r.mass.swmm.errorPct, backflow: r.mass.coupler.backflow ?? 0 }])),
  hecras: Object.fromEntries(Object.entries(views).filter(([k, v]) => v && !k.startsWith('floodsim')).map(([k, v]) => [k, { volumeErrorPct: v.volumeErrorPct }])), pairs: {} };
const f0 = (v) => Math.round(v).toLocaleString('en-US'), pc = (v) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}%`;
for (const [a, b] of pairs) {
  const c = compare(views[a], views[b]); report.pairs[`${a}-vs-${b}`] = c;
  console.log(`\n${views[a].label} vs ${views[b].label}`);
  console.log(`  surface volume  peak ${f0(c.surfaceVolume.peak[0])} vs ${f0(c.surfaceVolume.peak[1])} m³ (${pc(c.surfaceVolume.peakRel)}) at ${c.surfaceVolume.peakTimeH[0].toFixed(1)} vs ${c.surfaceVolume.peakTimeH[1].toFixed(1)} h · end ${f0(c.surfaceVolume.end[0])} vs ${f0(c.surfaceVolume.end[1])} m³ · NRMSE ${(100 * c.surfaceVolume.nrmse).toFixed(1)}%`);
  console.log(`  flooded >15 cm  peak ${(c.flooded15cm.peak[0] / 1e4).toFixed(1)} vs ${(c.flooded15cm.peak[1] / 1e4).toFixed(1)} ha (${pc(c.flooded15cm.peakRel)}) · >3 cm ${(c.flooded3cm.peak[0] / 1e4).toFixed(1)} vs ${(c.flooded3cm.peak[1] / 1e4).toFixed(1)} ha`);
  console.log(`  max depth map   median |Δ| ${(100 * c.maxDepth.medianAbs).toFixed(1)} cm, 90% ${(100 * c.maxDepth.p90Abs).toFixed(1)} cm, bias ${(100 * c.maxDepth.bias).toFixed(1)} cm · extent >15 cm CSI ${c.maxDepth.csi15.toFixed(2)}`);
  console.log(`  pump            peak ${c.pump.peak[0].toFixed(2)} vs ${c.pump.peak[1].toFixed(2)} m³/s · pumped ${f0(c.pump.volume[0])} vs ${f0(c.pump.volume[1])} m³ (${pc(c.pump.volumeRel)}) · wet well peak ${c.wetWellPeak[0].toFixed(2)} vs ${c.wetWellPeak[1].toFixed(2)} m`);
  console.log(`  pipe nodes      peak level median |Δ| ${(100 * c.nodePeakLevel.medianAbs).toFixed(0)} cm, 90% ${(100 * c.nodePeakLevel.p90Abs).toFixed(0)} cm, bias ${(100 * c.nodePeakLevel.bias).toFixed(0)} cm · net into pipes ${f0(c.netIntoPipes[0])} vs ${f0(c.netIntoPipes[1])} m³`);
}
writeFileSync(here('../results/davis-compare.json'), JSON.stringify(report, null, 1));
