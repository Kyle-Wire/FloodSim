// Report output tests: series peaks and volumes, profile sampling (a flat lake on a tilted plane), the HGL path and its
// flags, stage–storage–discharge against hand values, gutter spread on a crowned street against T = d / Sx, and the
// SVG charts (valid markup, one y axis, labelled series).
// Usage: node tests/run-report-tests.mjs
import * as R from '../src/report.js';
import { stageStorage, orificeQ, weirQ, COEF } from '../src/stormwater.js';
import { toCSV } from '../src/compare.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{ // a triangular hydrograph: peak 2 m³/s at 600 s over 1200 s → volume 1200 m³
  const q = []; for (let t = 0; t <= 1200; t += 10) q.push([t, t <= 600 ? 2 * t / 600 : 2 * (1200 - t) / 600]);
  const s = R.seriesStats(q);
  check('hydrograph peak, time and volume', s.peak === 2 && s.tPeak === 600 && Math.abs(s.volume - 1200) < 1e-9, `${s.volume} m³`);
  const al = R.align([[0, 0], [10, 1]], [[5, 2], [15, 4]]);
  check('two series on one time base', al.length === 4 && al[1].x === 5 && al[1].a === 0.5 && al[1].b === 2 && Number.isNaN(al[0].b) && Number.isNaN(al[3].a));
}

{ // a plane tilting 2 % to the east under a flat lake at 10.5 m
  const nx = 50, ny = 20, geo = { nx, ny, dx: 1 }, z = new Float32Array(nx * ny), wse = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; z[k] = 10 + 0.02 * (i + 0.5); wse[k] = z[k] < 10.5 ? 10.5 : NaN; }
  const p = R.sampleProfile([[0.5, 10.5], [49.5, 10.5]], { ground: z, wse }, geo, 1);
  const wet = p.filter(r => Number.isFinite(r.wse)), groundOk = p.every(r => Math.abs(r.ground - (10 + 0.02 * (Math.floor(r.col) + 0.5))) < 1e-5);
  check('profile: stations every metre, the ground under each', p.length === 50 && Math.abs(p.at(-1).s - 49) < 1e-9 && groundOk);
  check('profile: the lake is flat and stops at its shore', wet.every(r => r.wse === 10.5) && wet.length === 25, `${wet.length} wet stations`);
}

{ // three manholes in a line to an outfall; HGL above the crown at node 1, 0.3 m under the rim at node 2
  const net = { nodes: [{ name: 'MH1', ground: 12 }, { name: 'MH2', ground: 11.5 }, { name: 'MH3', ground: 11 }, { name: 'OF', ground: 10, outfall: true }],
    pipes: [{ from: 0, to: 1, L: 40, D: 0.6, invUp: 10, invDown: 9.8 }, { from: 1, to: 2, L: 50, D: 0.6, invUp: 9.8, invDown: 9.5 }, { from: 2, to: 3, L: 30, D: 0.9, invUp: 9.5, invDown: 9.3 }, { from: 4, to: 2, L: 10, D: 0.3, invUp: 10, invDown: 9.6 }] };
  net.nodes.push({ name: 'side', ground: 12 });
  const path = R.hglPath(net, 0), hgl = { nodes: [{ maxHead: 10.4 }, { maxHead: 10.7 }, { maxHead: 10.7 }, { maxHead: 9.6 }] };
  check('HGL path follows the pipes to the outfall', path.nodes.join() === '0,1,2,3' && path.pipes.join() === '0,1,2');
  const pr = R.hglProfile(net, path, hgl, { freeboard: 0.3048 }), st = pr.stations;
  check('stations at the cumulative pipe length', st.map(s => s.s).join() === '0,40,90,120');
  check('flags: not surcharged in its pipe, surcharged above the crown, low freeboard, the outfall never floods',
    !st[0].surcharged && st[1].surcharged && !st[1].flooded && st[2].low && !st[2].flooded && !st[3].flooded && Math.abs(st[2].freeboard - 0.3) < 1e-9);
  const hgl2 = { nodes: [{ maxHead: 10.4 }, { maxHead: 11.6 }, { maxHead: 11 }, { maxHead: 9.6 }] }, st2 = R.hglProfile(net, path, hgl2).stations;
  check('HGL above the rim floods', st2[1].flooded && st2[1].freeboard < 0);
}

{ // stage–storage–discharge: a 20 m × 20 m flat-bottomed box (bottom 10 m, top 12 m), a 0.3 m orifice at 10 m, a
  // 2 m weir at 11.2 m and a 3 m spillway at 11.8 m
  const nx = 20, z = new Float64Array(nx * nx).fill(10), cells = [...z.keys()], ss = stageStorage(z, cells, 1, 12, 41);
  const structure = { orifices: [{ D: 0.3, inv: 10 }], weir: { crest: 11.2, L: 2 }, spillway: { crest: 11.8, L: 3 } };
  const t = R.stageStorageDischarge(ss, structure, { rows: 41 });
  const at = (h) => t.find(r => Math.abs(r.stage - h) < 1e-9), r1 = at(11), r2 = at(11.5), r3 = at(12);
  check('storage = area × depth', Math.abs(r1.storage - 400) < 1e-9 && Math.abs(r3.storage - 800) < 1e-9);
  check('orifice only below the weir', Math.abs(r1.q - orificeQ(11, -Infinity, 0.3, 10)) < 1e-12 && r1.weir === 0 && r1.spillway === 0);
  check('weir by hand: C·L·h^1.5', Math.abs(r2.weir - COEF.weir * 2 * 0.3 ** 1.5) < 1e-12 && r2.spillway === 0);
  check('spillway by hand, and the total', Math.abs(r3.spillway - weirQ(12, -Infinity, 11.8, 3, COEF.spillway)) < 1e-12 && Math.abs(r3.q - (r3.orifices + r3.weir + r3.spillway)) < 1e-12);
  check('discharge and storage rise with stage', t.every((r, i) => i === 0 || (r.q >= t[i - 1].q && r.storage >= t[i - 1].storage)));
  check('thinned to the rows asked for, ends kept', R.stageStorageDischarge(ss, structure, { rows: 11 }).length === 11 && R.stageStorageDischarge(ss, structure, { rows: 11 }).at(-1).stage === 12);
}

{ // a crowned street: centreline along row 10 (y = 10.5), cross slope 2 % down to curbs 6 m either side, water 6 cm
  // deep at the north curb (rows 4 …); spread T = d / Sx = 3 m
  const nx = 40, ny = 21, geo = { nx, ny, dx: 1 }, depth = new Float32Array(nx * ny), Sx = 0.02, d = 0.06;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const off = Math.abs(j + 0.5 - 10.5); const zc = -Sx * Math.min(off, 6); const wl = -Sx * 6 + d; depth[j * nx + i] = j < 10 && off <= 6 ? Math.max(0, wl - zc) : 0; }
  const roads = [[[0, 10.5], [40, 10.5]]], g = R.gutterSpread(depth, geo, [20.5, 4.5], roads);
  check('gutter spread on a crowned street ≈ d / Sx', g && Math.abs(g.spread - d / Sx) <= 1, g ? `${g.spread.toFixed(2)} m (expected ${(d / Sx).toFixed(2)}), gutter depth ${g.gutterDepth.toFixed(3)} m` : 'none');
  check('the walk goes toward the centreline', g && g.dir[1] > 0.99 && Math.abs(g.toCentre - 6) < 1e-9);
  const full = R.gutterSpread(new Float32Array(nx * ny).fill(0.4), geo, [20.5, 4.5], roads);
  check('water past the far curb: the street is full, spread = its width', full.full && Math.abs(full.spread - 12) < 1e-9 && !g.full, `${full.spread} m`);
  check('no road nearby: no spread', R.gutterSpread(depth, geo, [20.5, 4.5], [[[0, 40], [40, 40]]], { nearRoad: 10 }) === null);
}

{ // charts
  const svg = R.lineChart([{ name: 'Before', role: 'before', pts: [[0, 0], [10, 2], [20, 1]] }, { name: 'After', role: 'after', pts: [[0, 0], [10, 1.5], [20, NaN], [30, 1]] }],
    { title: 'Line 1 hydrograph', xLabel: 'min', yLabel: 'cfs', refs: [{ y: 1.8, label: 'limit' }], markers: [{ x: 5, y: 1, label: 'FFE' }] });
  const ok = svg.startsWith('<svg') && svg.endsWith('</svg>') && (svg.match(/<svg/g) || []).length === 1 && /stroke-dasharray="6 4"/.test(svg) && svg.includes('>Before<') && svg.includes('>After<') && svg.includes('>limit<');
  const yLabels = (svg.match(/rotate\(-90\)/g) || []).length;
  check('line chart: one SVG, before dashed, direct labels, a reference line', ok);
  check('line chart: one y axis', yLabels === 1);
  check('a NaN breaks the line into two', (svg.match(new RegExp('stroke="' + R.THEMES.light.after + '"', 'g')) || []).length >= 3); // 2 path segments + label tick
  const bars = R.barChart([{ label: 'Inlet 3', value: 3.2, text: '10.5 ft', fail: true }, { label: 'Inlet 1', value: 1.1, text: '3.6 ft' }], { title: 'Spread', limit: 2.44, limitLabel: '8 ft allowable' });
  check('bar chart: failing bars carry a mark, not colour alone; the allowable line', bars.includes('✕ over') && bars.includes('8 ft allowable') && (bars.match(/<rect /g) || []).length === 3);
  const t = R.niceTicks(0, 7.3, 5);
  check('round ticks', t.step === 2 && t.ticks.join() === '0,2,4,6,8');
}

{ // CSV of a table with the report's columns
  const csv = toCSV([{ a: 'MH "1"', b: 1.23456, c: NaN }], [['a', 'node'], ['b', 'hgl_m', 2], ['c', 'x']]);
  check('CSV: quoted text, rounded numbers, blanks for no value', csv === 'node,hgl_m,x\n"MH ""1""",1.23,\n');
}

console.log(fails ? `\n${fails} FAILED` : '\nall report tests passed');
process.exit(fails ? 1 : 0);
