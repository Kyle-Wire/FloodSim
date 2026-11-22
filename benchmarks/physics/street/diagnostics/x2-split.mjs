// Diagnostic (unscored): PV-SS3 x2 (the app's network, 500-yr rain) under the four combinations of the FIXES-2
// defaults, to see which change moves SWMM's continuity error past 0.5 %.
import { DESIGN_DEFAULTS } from '../../../../src/drainage.js';
import { buildCase } from '../cases.mjs';
import { runCase } from '../harness.mjs';
import { CpuSim, loadSpecs } from '../exec-cpu.mjs';
const specs = loadSpecs(), out = [];
for (const [Cw, capture] of [[0.5, null], [0.32, null], [0.5, 'hec22'], [0.32, 'hec22']]) {
  Object.assign(DESIGN_DEFAULTS, { Cw, capture });
  const r = await runCase(async (o) => new CpuSim(o), buildCase('SS3-x2', specs));
  const c = r.coupled?.continuity;
  out.push({ Cw, capture, continuity: c, toNetwork: r.coupled?.totals?.toNetwork });
  console.log(JSON.stringify(out.at(-1)));
}
