// The B7-S / S8 regime, detected: a proposed flag, not wired into production.
//
// The unsupported regime: SWMM 5.2.4 turns inlet control off when both conduit ends are at or above the crown
// (dwflow.c 161–162, 251–252). HDS-5 keeps inlet control while its inlet-control headwater exceeds the full-barrel
// outlet-control headwater. Between the two, SWMM's headwater is pinned at the crown (steep, B7-S) or held under outlet
// control (mild, large ellipse, S8), below what HDS-5 requires. The flag says, from what the coupler can read from SWMM
// at a step (both end depths above the conduit inverts and the flow), that SWMM is in that band:
//
//   flag = code > 0  AND  d1 ≥ D AND d2 ≥ D (SWMM's own isFull)
//          AND  HW_inlet(Q) > d2 + H_full(Q) − S·L + margin       (HDS-5 would still be under inlet control)
//
// HW_inlet and H_full are HDS-5's (hds5.mjs). margin = max(0.03 m, 3 %) of HW_inlet. Nothing here changes a result:
// a flagged step is one whose headwater FloodSim should report as outside the supported conditions.
//
//   node benchmarks/culvert/regime-flag.mjs    evaluates the flag on the saved B7 and B7-S time series
import fs from 'node:fs';
import { inletControlHW, outletControlFull } from './hds5.mjs';

/** c: { code, key, shape, rise, span, n, L, S, Ke, Kx }; s: { d1, d2, q } (depths above each conduit end's invert, m; m³/s) */
export function unsupportedRegime(c, s) {
  const D = c.rise, isFull = s.d1 >= D && s.d2 >= D;
  if (!(c.code > 0) || !isFull || !(s.q > 0)) return { flag: false, isFull };
  const inlet = inletControlHW(c.key, c.shape, c.rise, c.span, s.q, c.S).HW, H = outletControlFull(c.shape, c.rise, c.span, s.q, c.n, c.L, { Ke: c.Ke ?? 0.5, Kx: c.Kx ?? 1 }).H;
  const outlet = s.d2 + H - c.S * c.L, margin = Math.max(0.03, 0.03 * inlet);
  return { flag: inlet > outlet + margin, isFull, inletHW: inlet, outletHW: outlet };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('regime-flag.mjs')) {
  const IN = 0.0254, res = (f) => new URL('./results/' + f, import.meta.url);
  const GEOM = {
    pipe: { key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2, code: 1, n: 0.013 },
    ellipse: { key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN, code: 30, n: 0.013 },
  };
  const SL = { mild: { S: 0.01, L: 40 }, steep: { S: 0.05, L: 30 } };
  const out = { b7: [], b7s: [] };
  // B7: each run's final state (its last trace row) against SWMM's error from b7-transition.json's scored row
  const b7 = JSON.parse(fs.readFileSync(res('b7-transition.json'))), tr = JSON.parse(fs.readFileSync(res('b7-transition-traces.json')));
  const tally = { flaggedErr: 0, flaggedOk: 0, unflaggedErr: 0, unflaggedOk: 0 };
  for (const t of Object.values(tr)) {
    const c = { ...GEOM[t.case], ...SL[t.slope] }, last = t.rows.at(-1), col = Object.fromEntries(t.cols.map((k, i) => [k, i]));
    const f = unsupportedRegime(c, { d1: last[col.d1], d2: last[col.d2], q: last[col.q] });
    const row = b7.rows.find(r => r.slope === t.slope && r.surcharge === t.surcharge && r.case === t.case && r.sweep === t.sweep && Math.abs(r.Q - t.Q) < 1e-3 && Math.abs((r.twDepth ?? 0) - t.twDepth) < 1e-3);
    const err = row ? Math.abs(row.diff ?? row.error ?? NaN) > (row.tol ?? row.band ?? Infinity) : null;
    if (err != null) tally[(f.flag ? 'flagged' : 'unflagged') + (err ? 'Err' : 'Ok')]++;
    out.b7.push({ slope: t.slope, surcharge: t.surcharge, case: t.case, sweep: t.sweep, Q: t.Q, twDepth: t.twDepth, flag: f.flag, isFull: f.isFull, swmmErrOutOfBand: err, diff: row?.diff ?? null });
  }
  // B7-S: the share of each continuous ramp's pinned steps (both ends full, headwater within 2 cm of the crown) flagged
  const ts = JSON.parse(fs.readFileSync(res('b7-steep-traces.json'))), s7 = [];
  for (const t of Object.values(ts)) {
    if (!t.rows) continue;
    const col = Object.fromEntries(t.cols.map((k, i) => [k, i])), c = { ...GEOM.pipe, ...SL.steep, code: t.code ?? 1 };
    let pinned = 0, pinnedFlag = 0, flagged = 0, n = 0;
    for (const r of t.rows) {
      const d1 = r[col.d1], d2 = r[col.d2], q = r[col.q]; n++;
      const f = unsupportedRegime(c, { d1, d2, q }); if (f.flag) flagged++;
      if (d1 >= 1.2 && d2 >= 1.2 && d1 < 1.22) { pinned++; if (f.flag) pinnedFlag++; }
    }
    s7.push({ surcharge: t.surcharge, step: t.step, rate: t.rate, code: t.code, steps: n, flagged, pinned, pinnedFlagged: pinnedFlag });
  }
  out.b7s = s7;
  out.b7tally = tally;
  fs.writeFileSync(res('regime-flag.json'), JSON.stringify(out, null, 1));
  console.log('B7 final states: flag against SWMM out of band', JSON.stringify(tally));
  for (const r of out.b7.filter(r => r.flag || r.swmmErrOutOfBand)) console.log(`  ${r.slope} ${r.surcharge} ${r.case} ${r.sweep} Q ${r.Q} tw ${(+r.twDepth).toFixed(2)}: flag ${r.flag}, out of band ${r.swmmErrOutOfBand}, diff ${r.diff}`);
  console.log('B7-S ramps:'); for (const r of s7) console.log(' ', JSON.stringify(r));
}
