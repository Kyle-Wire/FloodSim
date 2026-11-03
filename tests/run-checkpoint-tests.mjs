// Run checkpoint tests (src/checkpoint.js): object state captured and put back by path (typed arrays in place, shared
// arrays stay shared, series that grew), packing round trip, and a SWMM engine stopped half way, copied into a fresh
// engine and run on: the two finish identically, to the last bit.
//   node tests/run-checkpoint-tests.mjs
import { readFileSync } from 'node:fs';
import { captureState, applyState, pack, unpack, stateParts, partsState, swmmSnapshot, swmmRestore } from '../src/checkpoint.js';
import { loadSWMM, SWMM } from '../src/swmm.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{ // a run-like object: a clock, books, a shared typed array, a growing series, a Map of totals, a function and a skip
  const shared = new Float32Array([1, 2, 3]);
  const mk = () => { const a = new Float32Array(3); return { t: 0, books: { rain: 0, out: NaN }, hmax: a, view: { hmax: a }, series: [[0, 0]], totals: new Map([['in', { v: 0 }]]), fn: () => 1, solver: { device: {} } }; };
  const live = mk(); live.t = 3600; live.books.rain = 12.5; live.books.out = Infinity; live.hmax.set(shared); live.series.push([60, 1.5], [120, 2]); live.totals.get('in').v = 7;
  const st = captureState(live, { skip: new Set(['solver']) });
  const parts = await unpack(await pack({ meta: { at: 1 }, ...stateParts('run', st) }));
  const back = partsState('run', parts), fresh = mk(), keepArr = fresh.hmax, n = applyState(fresh, back.tree, back.blobs);
  check('state: clock, books (with ±∞ / NaN), series that grew, Map totals', fresh.t === 3600 && fresh.books.rain === 12.5 && fresh.books.out === Infinity && fresh.series.length === 3 && fresh.series[2][1] === 2 && fresh.totals.get('in').v === 7, `${n} values`);
  check('state: typed arrays filled in place, so arrays shared between objects stay shared', fresh.hmax === keepArr && fresh.view.hmax === fresh.hmax && fresh.hmax[2] === 3);
  check('state: functions and skipped keys untouched', typeof fresh.fn === 'function' && fresh.solver.device && parts.meta.at === 1);
}

{ // a solver as the root: its class name is one that is skipped inside a state, but its own fields are the state
  class GPUSolver { constructor() { this.t = 0; this.vol = { rain: 0, initial: 0 }; this.acc = null; this.device = { gpu: 1 }; } }
  const live = new GPUSolver(); live.t = 2418; live.vol.rain = 3404.2; live.acc = { inf: 1.5, out: 2, clip: 0 };
  const st = captureState(live, { skip: new Set(['device']) }), parts = await unpack(await pack(stateParts('solver', st)));
  const back = partsState('solver', parts), fresh = new GPUSolver(); applyState(fresh, back.tree, back.blobs);
  check('state: a solver root keeps its clock, volumes and accumulators', fresh.t === 2418 && fresh.vol.rain === 3404.2 && fresh.acc?.inf === 1.5 && fresh.device.gpu === 1);
}

{ // SWMM: stop half way, copy into a fresh engine, run both on
  const inp = readFileSync(new URL('./fixtures/eastwick-synthetic.inp', import.meta.url), 'utf8');
  const section = (s) => inp.split(`[${s}]`)[1].split(/\n\[/)[0].split('\n').filter(l => l.trim() && !l.startsWith(';')).map(l => l.split(/\s+/)[0]);
  const juncs = section('JUNCTIONS');
  const drive = (e, t0, t1) => { // 20 L/s into every junction for the first 30 min, varying; heads after each 2 s
    const ji = juncs.map(n => e.index('NODE', n)), heads = [];
    for (let t = t0; t < t1; t += 2) { const q = t < 1800 ? 0.02 * (1 + 0.5 * Math.sin(t / 300)) : 0; for (const i of ji) e.setLatFlow(i, q); e.stride(2); heads.push(...ji.map(i => e.node('HEAD', i))); }
    return heads;
  };
  const A = await loadSWMM(); A.open(inp); drive(A, 0, 1200);
  const snap = swmmSnapshot(A), packed = await pack({ mem: snap.memory, swmm: { streams: snap.streams, t: snap.t }, ...Object.fromEntries(Object.entries(snap.files).map(([f, b]) => ['file:' + f, b])) });
  const ha = drive(A, 1200, 3600);
  const P = await unpack(packed), snap2 = { memory: P.mem, streams: P.swmm.streams, t: P.swmm.t, files: Object.fromEntries(Object.keys(P).filter(k => k.startsWith('file:')).map(k => [k.slice(5), P[k]])) };
  const B = await loadSWMM(); B.open(inp); swmmRestore(B, snap2);
  const hb = drive(B, 1200, 3600);
  let same = ha.length === hb.length; for (let i = 0; same && i < ha.length; i++) if (!Object.is(ha[i], hb[i])) same = false;
  check('SWMM: a run copied half way into a fresh engine runs on identically', same && B.t === A.t, `${ha.length.toLocaleString()} heads, t ${A.t} s, ${(packed.length / 1e6).toFixed(1)} MB packed of ${(snap.memory.length / 1e6).toFixed(1)} MB`);
  const ea = SWMM.continuity(A.finish()), eb = SWMM.continuity(B.finish());
  check('SWMM: both close with the same continuity', JSON.stringify(ea) === JSON.stringify(eb), JSON.stringify(ea)?.slice(0, 80));
}

console.log(fails ? `\n${fails} FAILED` : '\nall checkpoint tests passed');
process.exit(fails ? 1 : 0);
