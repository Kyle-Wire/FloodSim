// Diagnostic (unscored): PV-SS11's hill street with the F21 grate law on (capture: 'hec22'), on the CPU. PV-SS11 scores
// the kerb cell 40 m below the grate against HEC-22; with the depth-only law the pipe row fails (21.9 mm against
// 16.8 mm) because too little is taken at the grate. Not blind: the PV-SS11 answer was known when this was written.
//   node benchmarks/physics/street/diagnostics/hill-capture.mjs   → diagnostics/out/hill-capture.json
import fs from 'node:fs';
import { buildCase } from '../cases.mjs';
import { runCase } from '../harness.mjs';
import { CpuSim, loadSpecs } from '../exec-cpu.mjs';

const specs = loadSpecs(), out = {};
for (const on of [false, true]) {
  const s = structuredClone(specs), e = s['PV-SS11'].parameters.cases.value['SS11-hill-pipe'];
  if (on) e.drainage.opts = { capture: 'hec22', grateW: 0.6, grateL: 0.9 };
  const r = await runCase(async (o) => new CpuSim(o), buildCase('SS11-hill-pipe', s));
  out[on ? 'capture' : 'depthOnly'] = { kerbDepthM: r.probes.find(p => p.id === 'kerb').final.mean, toNetworkM3: r.series.at(-1).toNetwork };
}
out.reference = { kerbDepthM: 0.016761494562718634, limit: 'PV-SS11 limit ±0.005 m' };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('./out/hill-capture.json', import.meta.url), JSON.stringify(out, null, 1));
