// Diagnostic (unscored): does SWMM's SLOT surcharge method (the app's default) carry more than Manning's full-pipe
// flow when a pipe is surcharged well above its crown? SWMM alone, hand-written .inp, no surface model, no coupler.
// A junction takes a constant inflow Q; one circular conduit leads to an outfall held `tw` above the conduit's
// downstream invert. At steady state the junction's head less the held level is the conduit's loss; Manning gives
// L (Q/K)². Run for SLOT and EXTRAN, several diameters and surcharge heads.
//   node benchmarks/physics/street/diagnostics/slot-capacity.mjs   → diagnostics/out/slot-capacity.json
import fs from 'node:fs';
import { options, simulate } from '../../lib/swmm-run.mjs';
import { pipeK } from '../../references/street.mjs';

const n = 0.013, L = 20, S = 0.005, out = [];
for (const D of [0.15, 0.30, 0.375, 0.60]) for (const hs of [0.5, 1.0, 1.5]) for (const surcharge of ['SLOT', 'EXTRAN']) {
  const K = pipeK(D, n), Q = 0.9 * K * Math.sqrt(0.02), tw = D + hs; // a flow that needs a 1.6 % grade: 0.32 m over 20 m
  const inp = [options({ durationS: 3600, step: 1, variableStep: 0.75, surcharge, minSurfArea: 1.2 }),
    '[JUNCTIONS]', `J1 ${S * L} ${D + hs + 5} 0 100 0`, '', '[OUTFALLS]', `O1 0 FIXED ${tw} NO`, '',
    '[CONDUITS]', `C1 J1 O1 ${L} ${n} 0 0 0 0`, '', '[XSECTIONS]', `C1 CIRCULAR ${D} 0 0 0 1`, '',
    '[INFLOWS]', `J1 FLOW "" FLOW 1.0 1.0 ${Q}`, '', '[REPORT]', 'INPUT NO', 'CONTROLS NO', 'NODES NONE', 'LINKS NONE', ''].join('\n');
  let H = [], q = [];
  const r = await simulate(inp, 3600, { every: 10, sample: (t, e) => { if (t > 3000) { H.push(e.node('HEAD', e.index('NODE', 'J1'))); q.push(e.link('FLOW', e.index('LINK', 'C1'))); } } });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, head = mean(H), flow = mean(q), loss = head - tw, manning = L * (flow / K) ** 2;
  out.push({ D, surchargeOverCrownAtOutletM: hs, method: surcharge, Q, flow, headRange: Math.max(...H) - Math.min(...H), lossM: loss, manningLossM: manning, lossOverManning: loss / manning, conveyanceOverManning: Math.sqrt(manning / loss),
    slotAreaShare: 0.01 * D * (hs + (head - tw) / 2 + S * L / 2) / (Math.PI * D * D / 4), continuityPct: r.continuity.errorPct });
  const o = out.at(-1); console.log(`D ${D.toFixed(3)}  surcharge ${hs.toFixed(1)} m  ${surcharge.padEnd(6)}  loss ${loss.toFixed(4)} m  Manning ${manning.toFixed(4)} m  conveyance × ${o.conveyanceOverManning.toFixed(4)}  (slot area at mid-pipe: +${(100 * o.slotAreaShare).toFixed(1)} % of the pipe's)  head range ${o.headRange.toExponential(1)}`);
}
fs.writeFileSync(new URL('./out/slot-capacity.json', import.meta.url), JSON.stringify(out, null, 1));
