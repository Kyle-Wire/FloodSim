// Diagnostic (unscored): why PV-SS8's allowance rows stand above their registered bound. No new run: the raw files of
// the scored cases, with the bound recomputed two ways.
//   registered bound    Σ max(0, i − r) Δt × the whole area (roofs included: their rain lands on the ground)
//   open-ground bound   the same with r × (open cells / all cells): src/drainage.js lumpedInfil spreads the allowance
//                       over the open cells only
// And how much of the allowance was used: the volume removed against r × area × the time it rained harder than r.
//   node benchmarks/physics/street/diagnostics/allowance.mjs   → diagnostics/out/allowance.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES } from '../terrain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), raw = path.join(here, '../raw'), b = SCENES.block({}), N = b.nx * b.ny, open = N - b.bld.reduce((a, v) => a + v, 0), out = [];
const latest = (id) => { for (const s of fs.readdirSync(raw).sort().reverse()) { const f = path.join(raw, s, id + '.cpu.json'); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)); } return null; };
for (const [id, r] of [['SS8-lump30-10', 30], ['SS8-lump30-100', 30], ['SS8-lump30-500', 30], ['SS8-lump50-100', 50], ['SS8-lump50-500', 50]]) {
  const d = latest(id); if (!d) continue;
  const sum = (rr) => d.rainBlocks.reduce((a, [t0, t1, mm]) => a + Math.max(0, mm - rr) / 3.6e6 * (t1 - t0), 0) * N;
  const peak = Math.max(...d.series.map(p => p.volume)), tPeak = d.series.find(p => p.volume === peak).t, removedAtPeak = d.series.find(p => p.t === tPeak).infil, rainAtPeak = d.series.find(p => p.t === tPeak).rain;
  const row = { case: id, allowanceMmHr: r, openShare: open / N, peakVolumeM3: peak, registeredBoundM3: sum(r), openGroundBoundM3: sum(r * open / N), removedByPeakM3: removedAtPeak, allowanceTimesAreaByPeakM3: r / 3.6e6 * tPeak * N, shareOfAllowanceUsedByPeak: removedAtPeak / (r / 3.6e6 * tPeak * N), rainByPeakM3: rainAtPeak, tPeakS: tPeak };
  out.push(row);
  console.log(`${id}: peak on the ground ${peak.toFixed(0)} m³; registered bound ${row.registeredBoundM3.toFixed(0)}; open-ground bound ${row.openGroundBoundM3.toFixed(0)}; removed by the peak (t ${tPeak} s) ${removedAtPeak.toFixed(0)} m³ = ${(100 * row.shareOfAllowanceUsedByPeak).toFixed(0)} % of allowance × area × time`);
}
fs.writeFileSync(path.join(here, 'out/allowance.json'), JSON.stringify(out, null, 1));
