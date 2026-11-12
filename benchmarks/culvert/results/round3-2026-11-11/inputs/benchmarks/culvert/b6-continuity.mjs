// B6-C: the continuity error of offset conduits, accounted on its own (B6 found −0.7 to −1.3 % in silted chains, and a
// clean pipe with offsets showing the same). SWMM alone, no sediment: a clean 1.2 m pipe chain whose conduits sit
// `off` above their nodes (the node inverts lowered, so the conduit inverts, and so the hydraulics, are unchanged).
// Questions:
//   1. Does the error scale with the offset and with the number of offset nodes?
//   2. Is it a fixed volume during filling (the % falls as the run lengthens) or a steady leak (the % holds)?
//   3. Is any water physically lost? → inflow and outflow integrated from the API every routing step, and the
//      steady outflow against the inflow.
//   4. Where does SWMM's balance put it? → SWMM's own terms (inflow, outflow, initial and final stored volume).
//
//   node benchmarks/culvert/b6-continuity.mjs
import fs from 'node:fs';
import { conduit, swmmEngine } from './model.mjs';
import { swmmSection } from '../../src/swmm-xsect.js';
import { toINP } from '../../src/drainage.js';
import { SWMM } from '../../src/swmm.js';

const swmm = await swmmEngine();
const S = 0.002, SEG = 60, asset = conduit('circle', 1.2, 1.2, 'concrete'), Q = 0.8;
function chain(N, off, durationS) {
  const nodes = [], pipes = [];
  for (let i = 0; i <= N; i++) nodes.push({ name: `N${i}`, invert: 10 - S * SEG * i - off, depth: 25, p: [i * SEG, 0], ...(i === N ? { outfall: true, outfallType: 'FREE' } : {}) });
  for (let i = 0; i < N; i++) { const x = swmmSection(asset, { name: `C${i}` }); pipes.push({ name: `C${i}`, from: i, to: i + 1, L: SEG, n: x.n, inOffset: off, outOffset: off, xs: x }); }
  if (off > 0) nodes[N].invert += off; // the outfall at the last conduit's invert: only the junctions carry offsets
  pipes[N - 1].outOffset = 0;
  return toINP({ nodes, pipes, opts: { n: 0.013, surDepth: 0 } }, { x0: 0, y1: 0, dx: 1 }, { durationS: durationS + 60 });
}
function run(N, off, durationS) {
  swmm.open(chain(N, off, durationS));
  const i0 = swmm.index('NODE', 'N0'), iL = swmm.index('LINK', `C${N - 1}`);
  let t = 0, vin = 0, vout = 0, qEnd = 0, k = 0;
  while (t < durationS - 1e-6) {
    const q = Q * Math.min(1, (t + 5) / 300); swmm.setLatFlow(i0, q);
    swmm.stepTo(Math.min(t + 5, durationS), (dt) => { vin += q * dt; vout += swmm.link('FLOW', iL) * dt; });
    t = Math.min(t + 5, durationS);
    if (t > durationS - 300) { qEnd += swmm.link('FLOW', iL); k++; }
  }
  let nodeVol = 0; for (let i = 0; i < N; i++) nodeVol += swmm.node('VOLUME', swmm.index('NODE', `N${i}`));
  const c = SWMM.continuity(swmm.finish());
  const ml = (v) => v == null ? null : +(v * 1000).toFixed(2); // SWMM reports 10^6 L; m³ here
  const err = c.externalInflow * 1000 - c.externalOutflow * 1000 - (c.finalStored - c.initialStored) * 1000; // SWMM's own imbalance, m³
  return { segments: N, offsetM: off, durationS, swmmErrorPct: c.errorPct, swmmImbalanceM3: +err.toFixed(2),
    swmm: { inflowM3: ml(c.externalInflow), outflowM3: ml(c.externalOutflow), initialStoredM3: ml(c.initialStored), finalStoredM3: ml(c.finalStored) },
    api: { inflowM3: +vin.toFixed(2), outflowM3: +vout.toFixed(2), nodeStoredM3: +nodeVol.toFixed(2), impliedStoredM3: +(vin - vout).toFixed(2) },
    steadyOutflowErrPct: +(100 * (qEnd / k - Q) / Q).toFixed(3) };
}
const rows = [];
for (const N of [6, 12, 24]) for (const off of [0, 0.1, 0.3, 0.6]) rows.push(run(N, off, 3600));
for (const dur of [1800, 7200, 14400]) for (const off of [0, 0.3]) rows.push(run(12, off, dur));
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b6-continuity.json', import.meta.url), JSON.stringify({ benchmark: 'B6-C continuity of offset conduits, SWMM alone', Q, S, SEG, rows }, null, 1));
console.log(`B6-C continuity of offset conduits: clean 1.2 m pipe, ${SEG} m lengths, S ${S}, Q ${Q} m³/s, free outfall\n`);
console.log('lengths  offset  run s   SWMM err %  SWMM imbalance m³  SWMM in/out/Δstored m³          API in/out m³      API in−out  steady outflow err %');
for (const r of rows) console.log(`${String(r.segments).padStart(5)}    ${r.offsetM.toFixed(1)}   ${String(r.durationS).padStart(6)}   ${String(r.swmmErrorPct).padStart(7)}     ${String(r.swmmImbalanceM3).padStart(9)}        ${r.swmm.inflowM3}/${r.swmm.outflowM3}/${(r.swmm.finalStoredM3 - r.swmm.initialStoredM3).toFixed(2)}     ${r.api.inflowM3}/${r.api.outflowM3}   ${r.api.impliedStoredM3}       ${r.steadyOutflowErrPct}`);
