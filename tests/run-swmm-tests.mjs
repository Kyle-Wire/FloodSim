// SWMM WebAssembly engine tests (needs `npm run build:swmm` first).
//   node tests/run-swmm-tests.mjs
// Drives the synthetic Eastwick network through the same API the coupler uses: lateral inflow in, stride, heads,
// overflow and link flows out, then SWMM's own continuity report.
import { readFileSync } from 'node:fs';
import { loadSWMM } from '../src/swmm.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const swmm = await loadSWMM();
check('engine loads', swmm.version >= 52000, `EPA SWMM ${swmm.version}`);

const inp = readFileSync(new URL('./fixtures/eastwick-synthetic.inp', import.meta.url), 'utf8');
swmm.open(inp);
const nNodes = swmm.count('NODE'), nLinks = swmm.count('LINK');
const section = (s) => inp.split(`[${s}]`)[1].split(/\n\[/)[0].split('\n').filter(l => l.trim() && !l.startsWith(';')).map(l => l.split(/\s+/)[0]);
const juncs = section('JUNCTIONS'), outs = section('OUTFALLS');
check('model opened', nNodes === juncs.length + outs.length && nLinks > 0, `${nNodes} nodes, ${nLinks} links`);

// 20 L/s into every junction for 30 min, then 30 min of draining
const ji = juncs.map(n => swmm.index('NODE', n)), oi = outs.map(n => swmm.index('NODE', n));
let vin = 0, maxHeadRise = 0, peakOut = 0, t = 0;
const inv = ji.map(i => swmm.node('HEAD', i));
while (t < 3600) {
  const q = t < 1800 ? 0.02 : 0;
  for (const i of ji) swmm.setLatFlow(i, q);
  t = swmm.stride(2); vin += q * ji.length * 2;
  ji.forEach((i, k) => { maxHeadRise = Math.max(maxHeadRise, swmm.node('HEAD', i) - inv[k]); });
  peakOut = Math.max(peakOut, oi.reduce((s, i) => s + swmm.node('INFLOW', i), 0));
}
check('strides reach the requested time', Math.abs(t - 3600) < 1e-6, `t = ${t.toFixed(1)} s`);
check('water routes to the outfalls', peakOut > 0.5 * 0.02 * ji.length, `peak outfall inflow ${peakOut.toFixed(2)} m³/s of ${(0.02 * ji.length).toFixed(2)} m³/s injected`);
check('pipes fill', maxHeadRise > 0.05, `max head rise ${maxHeadRise.toFixed(2)} m`);

// negative lateral inflow (water returned to the street) is accepted and mass-balanced
swmm.setLatFlow(ji[0], -0.001); swmm.stride(2); swmm.setLatFlow(ji[0], 0);
const mb = swmm.massBalance();
check('SWMM flow continuity', Math.abs(mb.flow) < 1, `${mb.flow.toFixed(3)} % (injected ${vin.toFixed(0)} m³)`);

// outfall stage (tidal backwater)
swmm.setOutfallStage(oi[0], 50); swmm.stride(2);
check('outfall stage accepted', Math.abs(swmm.node('HEAD', oi[0]) - 50) < 1e-6, `head ${swmm.node('HEAD', oi[0]).toFixed(2)} m`);

const rpt = swmm.finish();
const cont = rpt.match(/Continuity Error \(%\)\s*\.+\s*(-?[\d.]+)/g) || [];
check('report written', /Flow Routing Continuity/.test(rpt), cont.join(' | '));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
