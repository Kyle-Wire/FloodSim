// Diagnostic (unscored, not a registered case): a grate in a gutter on a continuous grade, the case the sandbox does
// not yet register. Half a street 100 × 8 m falling along its length and toward a kerb at 2 %, rain everywhere, one of
// the app's default grates in the kerb cell at 75 m on a pipe that never limits it. At steady state the flow reaching
// the grate is rain × the area above it. Compared with FHWA HEC-22 (3rd ed., ch. 4) for a 0.6 m wide, 0.9 m long
// grate in a uniform gutter section:
//   spread            T = (Q n / (0.376 Sx^1.67 SL^0.5))^0.375
//   frontal share     Eo = 1 − (1 − W/T)^2.67           (all of it taken: the velocities here are below splash-over)
//   side interception Rs = 1 / (1 + 0.0828 V^1.8 / (Sx L^2.3)),  V = Q / (½ T² Sx)
//   efficiency        E = Eo + Rs (1 − Eo)
// The model has 1 m cells: it cannot hold the gutter's triangular section, only a mean bed per cell.
//   node benchmarks/physics/street/diagnostics/gutter.mjs   → diagnostics/out/gutter.json
import fs from 'node:fs';
import { buildCase } from '../cases.mjs';
import { runCase } from '../harness.mjs';
import { CpuSim, loadSpecs } from '../exec-cpu.mjs';

const base = loadSpecs(), out = [], Sx = 0.02, n = 0.016, Wst = 8, xg = 75, Wg = 0.6, Lg = 0.9;
for (const SL of [0.01, 0.02, 0.04]) for (const mmhr of [50, 100, 200]) {
  const specs = structuredClone(base), P = specs['PV-SS1'].parameters;
  P.scenes.value.gutter = { kind: 'gutterStreet', L: 100, W: Wst, SL, Sx, n };
  P.cases.value['SS1-a'] = { scene: 'gutter', bc: { east: 'outflow' }, rain: { mmhr, minutes: 20 }, tEnd: 1200, every: 60, probes: { grate: { kind: 'box', x0: 75, x1: 76, y0: 0, y1: 1 }, above: { kind: 'box', x0: 70, x1: 71, y0: 0, y1: 1 } },
    drainage: { kind: 'pipe', inlet: [75.5, 0.5], invUp: -1.5, invOut: -1.6, L: 20, D: 0.45, outlet: 'FREE', twoWay: true } };
  const r = await runCase(async (o) => new CpuSim(o), buildCase('SS1-a', specs)), S = r.series, a = S.at(-6), b = S.at(-1);
  const taken = (b.toNetwork - a.toNetwork) / (b.t - a.t), Q = mmhr / 3.6e6 * xg * Wst;
  const T = Math.pow(Q * n / (0.376 * Math.pow(Sx, 1.67) * Math.sqrt(SL)), 0.375), V = Q / (0.5 * T * T * Sx), Eo = 1 - Math.pow(Math.max(0, 1 - Wg / T), 2.67), Rs = 1 / (1 + 0.0828 * Math.pow(V, 1.8) / (Sx * Math.pow(Lg, 2.3))), E = Eo + Rs * (1 - Eo);
  const row = { SL, rainMmHr: mmhr, approachFlowLs: 1000 * Q, takenLs: 1000 * taken, efficiency: taken / Q, hec22: { spreadM: T, velocityMs: V, Eo, Rs, efficiency: E, depthAtKerbM: T * Sx }, modelOverHec22: taken / Q / E, depthInGrateCellM: r.probes.find(p => p.id === 'grate').final.mean, depthInKerbCellAboveM: r.probes.find(p => p.id === 'above').final.mean };
  out.push(row);
  console.log(`slope ${(100 * SL).toFixed(0)} %, rain ${mmhr} mm/h: ${row.approachFlowLs.toFixed(1)} l/s reaches the grate; FloodSim takes ${(100 * row.efficiency).toFixed(0)} %, HEC-22 ${(100 * E).toFixed(0)} % (spread ${T.toFixed(2)} m, ${V.toFixed(2)} m/s); kerb cell 5 m above: ${(1000 * row.depthInKerbCellAboveM).toFixed(1)} mm deep (HEC-22 at the kerb ${(1000 * T * Sx).toFixed(1)} mm)`);
}
fs.writeFileSync(new URL('./out/gutter.json', import.meta.url), JSON.stringify(out, null, 1));
