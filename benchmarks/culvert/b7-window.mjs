// B7 temporal diagnostic for the proposed regime flag (regime-flag.mjs). EVALUATION ONLY: nothing here changes routing,
// a SWMM input, the flag's rule or any tolerance, and regime-flag.json's single-step results are kept as they are.
//
// The question: does the flag say the same thing when it must hold over a window of time instead of at one step?
// A step's flag (unsupportedRegime) is evaluated on every saved trace row (5 s apart). A run is flagged over a window
// W when at least half the rows in the run's last W seconds are flagged (persistence ≥ 50 %). The windows:
//   single step (the last row: regime-flag.json's rule), 30 s, 60 s, 300 s, and the adaptive
//   W = max(60 s, 2 L / V), V = Q / A_full (twice the barrel's transit time at full-barrel velocity).
// For each window: the regime × error 2 × 2 table (flagged or not, against SWMM's B7 error out of its band or not).
// Then the four out-of-band runs the single-step flag missed, and the seven in-band runs it flagged, each examined.
// Uncoded controls: the B7-S traces with no culvert code. The flag is false there by its first condition; the table
// also counts how often the rest of its condition (both ends full, HDS-5 inlet above outlet) holds, as a control on
// what the code condition alone excludes.
//
//   node benchmarks/culvert/b7-window.mjs   → results/b7-window.json
import fs from 'node:fs';
import { unsupportedRegime } from './regime-flag.mjs';

const IN = 0.0254, res = (f) => new URL('./results/' + f, import.meta.url);
const GEOM = {
  pipe: { key: 'circle/concrete/headwall', shape: 'circle', rise: 1.2, span: 1.2, code: 1, n: 0.013, Afull: Math.PI / 4 * 1.2 ** 2 },
  ellipse: { key: 'h-ellipse/concrete/headwall', shape: 'h-ellipse', rise: 96 * IN, span: 144 * IN, code: 30, n: 0.013, Afull: Math.PI / 4 * 96 * 144 * IN * IN },
};
const SL = { mild: { S: 0.01, L: 40 }, steep: { S: 0.05, L: 30 } };
const WINDOWS = ['step', 30, 60, 300, 'adaptive'];
const PERSIST = 0.5;

const b7 = JSON.parse(fs.readFileSync(res('b7-transition.json'))), tr = JSON.parse(fs.readFileSync(res('b7-transition-traces.json')));
const single = JSON.parse(fs.readFileSync(res('regime-flag.json')));
const runs = [];
for (const t of Object.values(tr)) {
  const c = { ...GEOM[t.case], ...SL[t.slope] }, col = Object.fromEntries(t.cols.map((k, i) => [k, i]));
  const row = b7.rows.find(r => r.slope === t.slope && r.surcharge === t.surcharge && r.case === t.case && r.sweep === t.sweep && Math.abs(r.Q - t.Q) < 1e-3 && Math.abs((r.twDepth ?? 0) - t.twDepth) < 1e-3);
  const err = row ? Math.abs(row.diff) > row.tol : null;
  const steps = t.rows.map(r => ({ t: r[col.t], ...unsupportedRegime(c, { d1: r[col.d1], d2: r[col.d2], q: r[col.q] }) }));
  const tEnd = steps.at(-1).t, V = t.Q / c.Afull, Wad = Math.max(60, 2 * c.L / V);
  const share = (W) => { const s = W === 'step' ? steps.slice(-1) : steps.filter(x => x.t >= tEnd - W + 1e-9); return s.filter(x => x.flag).length / s.length; };
  const w = {};
  for (const W of WINDOWS) { const sh = share(W === 'adaptive' ? Wad : W); w[W] = { share: +sh.toFixed(3), flag: W === 'step' ? sh === 1 : sh >= PERSIST }; }
  const last = steps.at(-1);
  runs.push({ slope: t.slope, surcharge: t.surcharge, case: t.case, sweep: t.sweep, Q: t.Q, twDepth: t.twDepth, outOfBand: err, diff: row?.diff ?? null, tol: row?.tol ?? null,
    governs: row?.governs ?? null, adaptiveW: +Wad.toFixed(1), windows: w, last: { isFull: last.isFull, inletHW: last.inletHW ?? null, outletHW: last.outletHW ?? null } });
}
// the single-step result must be regime-flag.json's (same rule, same rows): a check that nothing drifted
const sameAsSingle = runs.every((r, i) => r.windows.step.flag === single.b7[i].flag);
const tables = {};
for (const W of WINDOWS) {
  const T = { flaggedErr: 0, flaggedOk: 0, unflaggedErr: 0, unflaggedOk: 0 };
  for (const r of runs) if (r.outOfBand != null) T[(r.windows[W].flag ? 'flagged' : 'unflagged') + (r.outOfBand ? 'Err' : 'Ok')]++;
  tables[W] = T;
}
const misses = runs.filter(r => r.outOfBand && !r.windows.step.flag), inBand = runs.filter(r => !r.outOfBand && r.windows.step.flag);
// uncoded controls (B7-S traces with no culvert code)
const ts = JSON.parse(fs.readFileSync(res('b7-steep-traces.json'))), controls = [];
for (const t of Object.values(ts)) {
  if (!t.rows || t.code) continue;
  const col = Object.fromEntries(t.cols.map((k, i) => [k, i])), c = { ...GEOM.pipe, ...SL.steep };
  let n = 0, flag = 0, condWithoutCode = 0;
  for (const r of t.rows) {
    const s = { d1: r[col.d1], d2: r[col.d2], q: r[col.q] }; n++;
    if (unsupportedRegime({ ...c, code: 0 }, s).flag) flag++;
    if (unsupportedRegime({ ...c, code: 1 }, s).flag) condWithoutCode++;
  }
  controls.push({ surcharge: t.surcharge, step: t.step, rate: t.rate, steps: n, flagged: flag, conditionHoldsIgnoringCode: condWithoutCode });
}
const out = { diagnostic: 'B7 regime flag over time windows (evaluation only)', persistence: PERSIST, windows: WINDOWS, adaptive: 'W = max(60 s, 2 L / V), V = Q / A_full', traceStepS: 5,
  sameAsSingleStep: sameAsSingle, tables, misses, inBandFlags: inBand, uncodedControls: controls, runs };
fs.writeFileSync(res('b7-window.json'), JSON.stringify(out, null, 1));

console.log(`B7 regime flag over windows (persistence ≥ ${PERSIST * 100} %); single step equals regime-flag.json: ${sameAsSingle}`);
console.log('window      flagged&err  flagged&ok  unflagged&err  unflagged&ok');
for (const W of WINDOWS) { const T = tables[W]; console.log(`${String(W).padEnd(10)}  ${String(T.flaggedErr).padStart(11)}  ${String(T.flaggedOk).padStart(10)}  ${String(T.unflaggedErr).padStart(13)}  ${String(T.unflaggedOk).padStart(12)}`); }
const show = (r) => `${r.slope} ${r.surcharge} ${r.case} ${r.sweep} Q ${r.Q} tw ${(+r.twDepth).toFixed(2)}: diff ${r.diff} (band ${r.tol}), HDS-5 ${r.governs}; full ${r.last.isFull}` +
  `${r.last.inletHW != null ? `, inlet ${r.last.inletHW.toFixed(3)} vs outlet ${r.last.outletHW.toFixed(3)}` : ''}; shares ${WINDOWS.map(W => `${W}:${r.windows[W].share}`).join(' ')} (W ${r.adaptiveW} s)`;
console.log(`\nout of band, missed by the single-step flag (${misses.length}):`); for (const r of misses) console.log('  ' + show(r));
console.log(`\nin band, flagged by the single-step flag (${inBand.length}):`); for (const r of inBand) console.log('  ' + show(r));
console.log('\nuncoded controls (B7-S):'); for (const c of controls) console.log('  ' + JSON.stringify(c));
