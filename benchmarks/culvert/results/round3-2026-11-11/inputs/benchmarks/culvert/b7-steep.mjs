// B7-S: the steep-barrel submergence finding of B7, investigated on its own. SWMM alone. One culvert (concrete pipe
// 1.2 m, square edge with headwall, code 1; S 0.05, L 30 m) at a fixed inflow, Q/AD^0.5 = 4 (inlet control, HDS-5), while
// the tailwater rises through the outlet crown and falls back. Three questions:
//   1. Is the jump caused by the control switch itself, or by the full-barrel friction that follows it?
//      → the same culvert with no inlet code (SWMM has no inlet control at all), and SLOT against EXTRAN (two different
//        full-barrel treatments). (Round 2 result: the coded run does NOT drop onto the uncoded one, which sits near 0.7 m; it
//        drops to the crown and stays there, a sliding mode on SWMM's switching surface. See results/b7-steep.txt.) If the
//        coded run dropped onto the uncoded one exactly when SWMM's full-barrel condition
//        turns on, the switch is the cause.
//   2. Does the energy grade line stay physically consistent? → at every step: SWMM's pool head against the two heads
//      HDS-5 says Q needs (inlet control, and full-barrel outlet control at that tailwater), and the head a full barrel
//      dissipates against its own losses.
//   3. Does it converge? → routing step from production's variable step down to a fixed 0.1 s; tailwater ramp from
//      1 m/h to 0.25 m/h; and a steady sweep in 1 cm tailwater steps across the crown.
// SWMM's full-barrel condition (dwflow.c: isFull = y1 >= yFull && y2 >= yFull, inlet control only when !isFull) is not
// readable through the API; it is inferred from both node depths (the offsets are zero, so they are the conduit ends).
// Nothing is tuned. The reference is hds5.mjs.
//
//   node benchmarks/culvert/b7-steep.mjs
import fs from 'node:fs';
import { buildINP, runSteady, conduit, swmmEngine } from './model.mjs';
import { inletControlHW, outletControlHW, outletControlFull, fullArea, criticalDepth, KU } from './hds5.mjs';
import { SWMM } from '../../src/swmm.js';

const swmm = await swmmEngine();
const c = { asset: conduit('circle', 1.2, 1.2, 'concrete'), key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2 };
const S = 0.05, L = 30, D = 1.2, z0 = 10, zOut = z0 - S * L, A = fullArea('circle', D, D), Q = 4 * A * Math.sqrt(D) / KU;
// the tailwater ramps across the window that matters: from 0.6 m below the outlet crown (inlet control, outlet free)
// to 1.6 m above it (past nothing yet: HDS-5 hands over to outlet control at about D + 1.3 m)
const TWLO = D - 0.6, TWTOP = D + 1.6, YC = criticalDepth('circle', D, D, Q);
const inletHW = inletControlHW(c.key, c.shape, c.rise, c.span, Q, S).HW;
const K = { Ke: 0.5, Kx: 1 };

/** One continuous run: spin up at a low tailwater, raise it at `rate` (m/h) to D + 2.5 m, hold, lower it again. */
function ramp({ surcharge = 'SLOT', step = null, rate = 0.5, code = undefined }) {
  const routing = { surcharge, ...(step ? { variableStep: 0, routingStep: step } : {}) };
  const spin = 1200, rise = (TWTOP - TWLO) / rate * 3600, hold = 600, dur = spin + 2 * rise + 2 * hold;
  const o = { asset: c.asset, L, S, routing, code, durationS: dur + 60, initElev: zOut + TWLO };
  const { inp, x } = buildINP(o);
  swmm.open(inp);
  const iIn = swmm.index('NODE', 'HW'), iOut = swmm.index('NODE', 'TW'), iL = swmm.index('LINK', 'C1');
  const twAt = (t) => t < spin ? TWLO : t < spin + rise ? TWLO + (t - spin) / rise * (TWTOP - TWLO) : t < spin + rise + hold ? TWTOP : t < spin + 2 * rise + hold ? TWTOP - (t - spin - rise - hold) / rise * (TWTOP - TWLO) : TWLO;
  const Hfull = outletControlFull(c.shape, c.rise, c.span, Q, x.n, L, K).H;
  let t = 0, nSteps = 0, prevFull = null; const flips = [], trace = [], stats = { maxDeficit: 0, maxDeficitTW: null, maxEnergyShortfall: 0, maxTwErr: 0 };
  const outletAt = (tw) => outletControlHW(c.shape, c.rise, c.span, Q, x.n, L, S, tw, K);
  while (t < dur - 1e-6) {
    const tw = twAt(t), qIn = Q * Math.min(1, (t + 1) / 300);
    swmm.setLatFlow(iIn, qIn); swmm.setOutfallStage(iOut, zOut + tw);
    swmm.stepTo(Math.min(t + 1, dur), () => {
      nSteps++;
      const d1 = swmm.node('DEPTH', iIn), d2 = swmm.node('DEPTH', iOut), h1 = swmm.node('HEAD', iIn), h2 = swmm.node('HEAD', iOut), q = swmm.link('FLOW', iL);
      const full = d1 >= D && d2 >= D;
      if (t > spin) {
        if (prevFull != null && full !== prevFull) flips.push({ t: +t.toFixed(2), tw: +tw.toFixed(4), to: full ? 'full' : 'not full', hw: +d1.toFixed(4) });
        const need = Math.max(inletHW, outletAt(tw)), deficit = need - d1; // how far the pool is below what HDS-5 says Q needs
        if (deficit > stats.maxDeficit) { stats.maxDeficit = deficit; stats.maxDeficitTW = tw; }
        if (full) stats.maxEnergyShortfall = Math.max(stats.maxEnergyShortfall, Hfull - (h1 - h2));
        if (tw > YC + 0.05) stats.maxTwErr = Math.max(stats.maxTwErr, Math.abs(h2 - (zOut + tw)));
      }
      prevFull = full;
      trace.push([+t.toFixed(2), +tw.toFixed(4), +d1.toFixed(4), +d2.toFixed(4), +(h1 - h2).toFixed(4), +q.toFixed(4), full ? 1 : 0]);
    });
    t = Math.min(t + 1, dur);
  }
  const rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  // the headwater just before and just after SWMM's first full-barrel switch on the way up
  const up = flips.find(f => f.to === 'full'), at = (tt) => trace.reduce((b, r) => Math.abs(r[0] - tt) < Math.abs(b[0] - tt) ? r : b);
  let jump = null;
  if (up) {
    const before = trace.filter(r => r[0] > up.t - 60 && r[0] < up.t - 1), after = trace.filter(r => r[0] >= up.t && r[0] < up.t + 120);
    const hb = before.reduce((s, r) => s + r[2], 0) / Math.max(1, before.length);
    jump = { tw: up.tw, hwBefore: +hb.toFixed(4), hwMinAfter: +Math.min(...after.map(r => r[2])).toFixed(4), hwMaxAfter: +Math.max(...after.map(r => r[2])).toFixed(4) };
  }
  const upFlips = flips.filter(f => f.t < spin + rise), downFlips = flips.filter(f => f.t > spin + rise + hold);
  // thin the trace for the file: every 5 s, and every step within 120 s of a switch
  const near = (tt) => flips.some(f => Math.abs(f.t - tt) <= 120);
  const kept = trace.filter((r, i) => i % Math.max(1, Math.round(5 * nSteps / dur)) === 0 || near(r[0]));
  return { surcharge, step: step ?? 'variable (production)', rate, code: code ?? x.culvert, steps: nSteps, meanStepS: +(dur / nSteps).toFixed(3),
    switchesRising: upFlips.length, switchesFalling: downFlips.length, firstFullTW: up?.tw ?? null, lastNotFullTWfalling: downFlips.at(-1)?.tw ?? null, jump,
    maxDeficit: +stats.maxDeficit.toFixed(4), maxDeficitTW: stats.maxDeficitTW == null ? null : +stats.maxDeficitTW.toFixed(3), maxEnergyShortfall: +stats.maxEnergyShortfall.toFixed(4), fullBarrelLoss: +Hfull.toFixed(4),
    maxTwErr: +stats.maxTwErr.toFixed(4), continuityErrPct: cont.errorPct, trace: { cols: ['t', 'tw', 'd1', 'd2', 'h1-h2', 'q', 'full'], rows: kept } };
}

const runs = [];
const log = (r) => { runs.push(r); const j = r.jump; console.log(`${r.surcharge.padEnd(6)} ${String(r.step).padEnd(22)} ${String(r.rate).padEnd(5)} code ${String(r.code).padEnd(2)} mean dt ${String(r.meanStepS).padEnd(6)} switches up/down ${String(r.switchesRising).padStart(4)}/${String(r.switchesFalling).padEnd(4)} first full at TW ${r.firstFullTW ?? '-'}  ${j ? `HW ${j.hwBefore} → ${j.hwMinAfter}…${j.hwMaxAfter}` : ''}  max deficit ${r.maxDeficit} m (TW ${r.maxDeficitTW})  energy shortfall ${r.maxEnergyShortfall} m  TW err ${r.maxTwErr}  continuity ${r.continuityErrPct} %`); };
console.log(`B7-S steep barrel through submergence. Pipe 1.2 m code 1, S ${S}, L ${L} m, Q ${Q.toFixed(3)} m³/s (Q/AD^0.5 4). HDS-5 inlet-control HW ${inletHW.toFixed(3)} m\n`);
console.log('1-3. continuous tailwater ramp (rate m/h), rising and falling');
for (const surcharge of ['SLOT', 'EXTRAN']) {
  for (const step of [null, 1, 0.5, 0.25, 0.1]) log(ramp({ surcharge, step, rate: 0.5 }));
  for (const rate of [1, 0.25]) log(ramp({ surcharge, rate }));
  log(ramp({ surcharge, rate: 0.5, code: 0 })); // no inlet code: SWMM's dynamic-wave barrel alone
}

// 3b. the steady map in 1 cm tailwater steps across the crown: is there a discontinuity in the steady solution itself?
console.log('\n3b. steady runs, tailwater 1 cm apart across the outlet crown (production routing step; then fixed 0.1 s)');
const fine = [];
for (const surcharge of ['SLOT', 'EXTRAN']) for (const step of [null, 0.1]) for (const code of [undefined, 0]) {
  for (let i = 0; i <= 30; i++) {
    const twd = D - 0.1 + i * 0.01, routing = { surcharge, ...(step ? { variableStep: 0, routingStep: step } : {}) };
    const r = runSteady(swmm, { asset: c.asset, L, S, routing, code }, Q, { tw: zOut + twd, holdS: 1200 });
    const need = Math.max(inletHW, outletControlHW(c.shape, c.rise, c.span, Q, r.x.n, L, S, twd, K));
    fine.push({ surcharge, step: step ?? 'variable', code: code ?? r.x.culvert, twDepth: +twd.toFixed(3), hwMean: +r.d1.toFixed(4), hwMin: +r.d1Min.toFixed(4), hwMax: +r.d1Max.toFixed(4), outletDepth: +r.d2.toFixed(4), hds5: +need.toFixed(4), barrelFull: r.d1 >= D && r.d2 >= D, continuityErrPct: r.mass.swmmErrorPct });
  }
}
for (const g of ['SLOT variable', 'SLOT 0.1', 'EXTRAN variable', 'EXTRAN 0.1']) for (const code of [1, 0]) {
  const s = fine.filter(f => `${f.surcharge} ${f.step}` === g && f.code === code);
  let big = { d: 0 }; for (let i = 1; i < s.length; i++) { const d = s[i].hwMean - s[i - 1].hwMean; if (Math.abs(d) > Math.abs(big.d)) big = { d, from: s[i - 1].twDepth, to: s[i].twDepth }; }
  console.log(`${g.padEnd(16)} code ${code}: TW ${s[0].twDepth}…${s.at(-1).twDepth} m. HW ${s.map(f => f.hwMean.toFixed(2)).join(' ')}`);
  console.log(`${''.padEnd(24)} largest change between 1 cm steps: ${big.d.toFixed(3)} m (TW ${big.from} → ${big.to}); widest last-5-min range ${Math.max(...s.map(f => f.hwMax - f.hwMin)).toFixed(3)} m`);
}

fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b7-steep.json', import.meta.url), JSON.stringify({ benchmark: 'B7-S steep barrel through submergence, SWMM alone', Q, S, L, D, inletHW, runs: runs.map(({ trace, ...r }) => r), fine }, null, 1));
fs.writeFileSync(new URL('./results/b7-steep-traces.json', import.meta.url), JSON.stringify(runs.map(r => ({ surcharge: r.surcharge, step: r.step, rate: r.rate, code: r.code, ...r.trace }))));
