// Gate C, Davis: the pipe network alone. SWMM (FloodSim's translation) driven by HEC-RAS's own inlet flows at every node
// and its pump tailwater, compared with HEC-RAS's pump flow and node levels. Separates the pipe hydraulics from the
// surface capture: if SWMM reproduces HEC-RAS here, differences in the coupled run come from what the inlets catch.
// Usage: node benchmarks/gatec/davis/pipes-only.mjs [dwe]
import { readFileSync } from 'node:fs';
import h5wasm from 'h5wasm/node';
import { loadSWMM, SWMM } from '../../../src/swmm.js';
import { davisINP } from './davis-swmm.mjs';

const variant = process.argv[2] ?? 'dwe';
const here = (p) => new URL(p, import.meta.url), path = (u) => decodeURIComponent(u.pathname).replace(/^\/([A-Z]:)/, '$1');
const model = JSON.parse(readFileSync(here('./model.json'))), ref = JSON.parse(readFileSync(here(`../results/gatec-davis-hecras-${variant}.json`)));
const CFS = 0.3048006096012192 ** 3;
await h5wasm.ready;
const f = new h5wasm.File(path(here(`./hecras-run/${variant}/DavisStormSystem.p02.hdf`)), 'r');
const d = f.get('/Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series/Pipe Networks/Davis/Nodes/Top + Side Inlet Flow');
const nN = d.shape[1], raw = Array.from(d.value), inflow = ref.t.map((_, i) => raw.slice(i * nN, (i + 1) * nN).map(v => v * CFS)); // + = surface into pipes
f.close();

const dsStage = ref.t.map((t, i) => [t, ref.pump.tailwater[i]]);
const pressurised = process.argv.includes('--pressurised'); // let nodes rise above their rims (HEC-RAS behaviour)
let inp = davisINP(model, { dsStage });
if (pressurised) inp = inp.replace(/^(\S+\s+\S+\s+\S+\s+0\s+)0(\s+0)$/gm, '$130$2'); // junction SurDepth 0 → 30 m
const swmm = await loadSWMM(); swmm.open(inp);
const idx = model.nodes.map(n => swmm.index('NODE', n.name)), pump = swmm.index('LINK', 'PUMP1'), wet = swmm.index('NODE', model.pump.from);
const out = { pump: [0], wet: [swmm.node('HEAD', wet)], peak: model.nodes.map(() => -Infinity) };
let pumped = 0, inVol = 0;
for (let i = 1; i < ref.t.length; i++) {
  // HEC-RAS outputs are instantaneous every 10 min: hold the mean of the two ends over the interval
  for (let k = 0; k < idx.length; k++) { const q = (inflow[i - 1][k] + inflow[i][k]) / 2; swmm.setLatFlow(idx[k], q); inVol += q * (ref.t[i] - ref.t[i - 1]); }
  swmm.stepTo(ref.t[i], (dt) => { pumped += swmm.link('FLOW', pump) * dt; for (let k = 0; k < idx.length; k++) out.peak[k] = Math.max(out.peak[k], swmm.node('HEAD', idx[k])); });
  out.pump.push(swmm.link('FLOW', pump)); out.wet.push(swmm.node('HEAD', wet));
}
const cont = SWMM.continuity(swmm.finish());
const hecPeak = model.nodes.map((_, k) => Math.max(...ref.nodeWSE.map(r => r[k])));
const dz = out.peak.map((v, k) => v - hecPeak[k]), abs = dz.map(Math.abs).sort((a, b) => a - b);
let hecPumped = 0; for (let i = 1; i < ref.t.length; i++) hecPumped += (ref.pump.flow[i] + ref.pump.flow[i - 1]) / 2 * (ref.t[i] - ref.t[i - 1]);
console.log(`HEC-RAS inlet inflow given to SWMM: ${Math.round(inVol).toLocaleString()} m³`);
console.log(`pumped: SWMM ${Math.round(pumped).toLocaleString()} vs HEC-RAS ${Math.round(hecPumped).toLocaleString()} m³ (${(100 * (pumped / hecPumped - 1)).toFixed(1)}%) · pump peak ${Math.max(...out.pump).toFixed(2)} vs ${Math.max(...ref.pump.flow).toFixed(2)} m³/s · wet well peak ${Math.max(...out.wet).toFixed(2)} vs ${Math.max(...ref.pump.wetWell).toFixed(2)} m`);
console.log(`node peak levels: median |Δ| ${(100 * abs[abs.length >> 1]).toFixed(0)} cm, 90% ${(100 * abs[Math.floor(abs.length * 0.9)]).toFixed(0)} cm, bias ${(100 * dz.reduce((a, b) => a + b, 0) / dz.length).toFixed(0)} cm · SWMM continuity ${cont.errorPct}% · flooding ${cont.flooding} ML`);
