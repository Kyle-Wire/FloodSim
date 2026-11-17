// Diagnostic (unscored, not a registered case): how much of the water running down a street does one of the app's
// default grates take when it is on a continuous grade, not in a sag? The PV-SS1 street (100 × 8 m at 1 %, rain
// 100 mm/h, sheet flow) with one grate at 75 m, on a pipe large enough never to limit it (0.3 m, free outfall).
// Yardsticks, all by hand from the kinematic sheet flow q = i·x at the grate:
//   the flow that passes over a 0.6 m wide grate (its frontal flow; FHWA HEC-22 §4.4.4: with no cross slope a grate
//   on grade takes its frontal flow at most, side flow interception is nil);
//   the flow that passes through the grate's 1 m cell; the whole street's flow at that point.
//   node benchmarks/physics/street/diagnostics/on-grade.mjs   → diagnostics/out/on-grade.json
import fs from 'node:fs';
import { buildCase } from '../cases.mjs';
import { runCase } from '../harness.mjs';
import { CpuSim, loadSpecs } from '../exec-cpu.mjs';
import { kwDepth } from '../../references/street.mjs';

const specs = structuredClone(loadSpecs()), e = specs['PV-SS1'].parameters.cases.value['SS1-a'], s = specs['PV-SS1'].parameters.scenes.value.planeA, out = [];
for (const mmhr of [25, 50, 100, 200]) {
  e.rain.mmhr = mmhr; e.every = 60; e.probes = { grate: { kind: 'box', x0: 75, x1: 76, y0: 4, y1: 5 }, beside: { kind: 'box', x0: 75, x1: 76, y0: 0, y1: 2 } };
  e.drainage = { kind: 'pipe', inlet: [75.5, 4.5], invUp: -1.5, invOut: -1.6, L: 20, D: 0.3, outlet: 'FREE', twoWay: true };
  const r = await runCase(async (o) => new CpuSim(o), buildCase('SS1-a', specs)), S = r.series, a = S.at(-6), b = S.at(-1);
  const taken = (b.toNetwork - a.toNetwork) / (b.t - a.t), i = mmhr / 3.6e6, q = i * 75, hk = kwDepth(i, 75.5, s.n, s.S0);
  const row = { rainMmHr: mmhr, takenM3s: taken, frontalFlowOf06mGrateM3s: 0.6 * q, flowThroughItsCellM3s: q, streetFlowAtGrateM3s: q * s.W, takenOverFrontal: taken / (0.6 * q), takenOverCellFlow: taken / q, shareOfStreetFlow: taken / (q * s.W),
    depthAtGrateM: r.probes.find(p => p.id === 'grate').final.mean, depthBesideM: r.probes.find(p => p.id === 'beside').final.mean, sheetFlowDepthM: hk, maxNodeHeadM: r.coupled.nodes[0].maxHead };
  out.push(row);
  console.log(`rain ${mmhr} mm/h: grate takes ${(1000 * taken).toFixed(2)} l/s = ${row.takenOverFrontal.toFixed(1)} × its frontal flow, ${row.takenOverCellFlow.toFixed(2)} × the flow through its cell, ${(100 * row.shareOfStreetFlow).toFixed(0)} % of the street's flow; depth at the grate ${(1000 * row.depthAtGrateM).toFixed(1)} mm against ${(1000 * hk).toFixed(1)} mm of sheet flow`);
}
fs.writeFileSync(new URL('./out/on-grade.json', import.meta.url), JSON.stringify(out, null, 1));
