// Diagnostic (unscored): PV-SS5 case down-small passed, against the prediction registered with it. Is the pass an
// accident? The same box (cut through the hollow, the app's free-outfall edge on all sides) under three storms. The
// true end depth is the rim, 0.200 m, once the storm fills the hollow (0.160 m for the 40 mm storm).
//   node benchmarks/physics/street/diagnostics/edge-pond.mjs   → diagnostics/out/edge-pond.json
import fs from 'node:fs';
import { buildCase } from '../cases.mjs';
import { runCase } from '../harness.mjs';
import { CpuSim, loadSpecs } from '../exec-cpu.mjs';

const specs = loadSpecs(), out = [];
for (const mmhr of [40, 80, 160]) {
  const s = structuredClone(specs); s['PV-SS5'].parameters.cases.value['SS5-down-small'].rain.mmhr = mmhr;
  const r = await runCase(async (o) => new CpuSim(o), buildCase('SS5-down-small', s)), end = r.series.at(-1), truth = Math.min(0.2, mmhr / 1000 * 400 / 100);
  out.push({ stormMm: mmhr, endDepthAtBlockM: r.probes[0].final.mean, trueEndDepthM: truth, edgeShareOfRain: end.outflow / end.rain, rainM3: end.rain, leftAcrossEdgeM3: end.outflow });
  console.log(`storm ${mmhr} mm: end depth at the block ${r.probes[0].final.mean.toFixed(4)} m (true ${truth.toFixed(3)} m); ${(100 * end.outflow / end.rain).toFixed(1)} % of the rain left across the edge`);
}
fs.writeFileSync(new URL('./out/edge-pond.json', import.meta.url), JSON.stringify(out, null, 1));
