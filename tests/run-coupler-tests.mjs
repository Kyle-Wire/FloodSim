// 1D–2D coupler tests with a stand-in solver and SWMM: which outfalls give their water back to the ground (an outfall
// the data placed inside the area, or one into a mapped stream) and which take it out of the model (the edge, a CSO
// interceptor, an interior pipe end the data does not call an outfall); the water an outfall takes in one interval
// comes back on its cell over the next; the books count what came back, so it is not booked as gone.
// Usage: node tests/run-coupler-tests.mjs
import { outfallCells, returnsHere, DESIGN_DEFAULTS } from '../src/drainage.js';
import { Coupler } from '../src/coupler.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// a 20 × 20 solver grid at F = 2 over a 40 × 40 fine grid
const F = 2, nx = 20, ny = 20, W = 40, mask = new Uint8Array(nx * ny).fill(1), sim = { F, nx, ny, mask, z: new Float32Array(nx * ny) };
const node = (name, x, y, o = {}) => ({ name, p: [x, y], ground: 10, invert: 8, depth: 2, outfall: false, ...o });
const nodes = [
  node('J0', 4, 4),
  node('O1', 10, 10, { outfall: true, realOutfall: true, placed: true }),     // an endwall the outfall layer placed: returns
  node('O2', 30, 30, { outfall: true, toStream: true }),                       // synthetic, into a mapped stream: returns
  node('O3', 20, 6, { outfall: true, realOutfall: true }),                     // an interior pipe end, not in the outfall layer: leaves
  node('O4', 0, 20, { outfall: true, edge: true, placed: true }),              // on the model edge: leaves
  node('I5', 10, 10, { outfall: true, interceptor: true, placed: true }),      // a CSO interceptor (to the plant): leaves
];
{
  const sel = nodes.map(returnsHere);
  check('outfalls that return: placed inside the area, or into a stream; not the edge, an unplaced pipe end, an interceptor',
    JSON.stringify(sel) === JSON.stringify([false, true, true, false, false, false]), JSON.stringify(sel));
  const r = outfallCells(nodes, W, sim);
  check('each return on its solver cell (fine cell / F)', r.length === 2 && r[0].cell === 5 * nx + 5 && r[1].cell === 15 * nx + 15 && r[0].at[0] === '10,10', JSON.stringify(r));
  const t = outfallCells(nodes, W, sim, new Set([5 * nx + 5]));
  check('a cell an inlet already uses: the return moves to a free open neighbour', t[0].cell !== 5 * nx + 5 && Math.abs((t[0].cell % nx) - 5) <= 1 && Math.abs(((t[0].cell / nx) | 0) - 5) <= 1, JSON.stringify(t[0]));
}

// the coupler: one inlet at J0 draining to the endwall O1 (returns) and nothing else; SWMM stands in
{
  const net = { nodes, pipes: [], inlets: [{ node: 0, cell: 2 * nx + 2, grates: 1 }], opts: DESIGN_DEFAULTS };
  const Q = { O1: 0.5, O2: 0, O3: 0.2, O4: 0, I5: 0.1 }; // m³/s into each outfall during the stride
  const idx = new Map(nodes.map((n, i) => [n.name, i]));
  const swmm = {
    index: (kind, name) => (kind === 'NODE' ? idx.get(name) ?? -1 : -1),
    setLatFlow() {}, setOutfallStage() {},
    stepTo(t, cb) { for (let k = 0; k < 4; k++) cb(0.5); }, // 2 s in four 0.5 s routing steps
    node: (what, i) => (what === 'INFLOW' ? Q[nodes[i].name] ?? 0 : what === 'HEAD' ? 8 : 0),
    link: () => 0,
  };
  const returns = outfallCells(nodes, W, sim, new Set([2 * nx + 2]));
  const cp = new Coupler({ rainRate: 0 }, net, swmm, new Float32Array(nx * ny).fill(10), { interval: 2, returns });
  check('the coupler owns its inlets then its returns', cp.count === 1 + 2, String(cp.count));
  let q = cp.step(new Float64Array(cp.count), new Float64Array(cp.count), 2, 2);
  check('what flowed into the endwall comes back on its cell next interval (negative: onto the ground)', Math.abs(q[1] + 0.5) < 1e-9 && q[2] === 0, `${q[1]}, ${q[2]}`);
  // the solver then reports what it put back: 1 m³ over the interval (0.5 m³/s × 2 s)
  const vol = new Float64Array(cp.count); vol[1] = -1;
  q = cp.step(vol, new Float64Array(cp.count), 2, 4);
  check('the books count the water the ground received back', Math.abs(cp.totals.outfallReturned - 1) < 1e-9, String(cp.totals.outfallReturned));
  check('outfalls that leave keep their volume booked as gone (interior pipe end, interceptor)', Math.abs(cp.outVol[idx.get('O3')] - 0.8) < 1e-9 && Math.abs(cp.outVol[idx.get('I5')] - 0.4) < 1e-9);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
