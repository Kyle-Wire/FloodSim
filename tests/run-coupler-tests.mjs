// 1D–2D coupler tests with a stand-in solver and SWMM: which outfalls give their water back to the ground (an outfall
// the data placed inside the area, or one into a mapped stream) and which take it out of the model (the edge, a CSO
// interceptor, an interior pipe end the data does not call an outfall); the water an outfall takes in one interval
// comes back on its cell over the next; the books count what came back, so it is not booked as gone.
// Usage: node tests/run-coupler-tests.mjs
import { outfallCells, returnsHere, inletFlow, DESIGN_DEFAULTS } from '../src/drainage.js';
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
  node('O3', 20, 6, { outfall: true, realOutfall: true }),                     // an interior pipe end, not in the outfall layer, combined sewer: leaves
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

{ // an inlet with a crest above its cell (a gully lip, a kerb inlet): water only above the crest, on the head over it
  const o = DESIGN_DEFAULTS, c = 0.05;
  check('a crest: no inflow while the water is below it, free or submerged', inletFlow(0.04, 0, -5, 1, o, c) === 0 && inletFlow(0.04, 0, 0.02, 1, o, c) === 0);
  check('a crest: free inflow on the head over the crest', Math.abs(inletFlow(0.25, 0, -5, 1, o, c) - inletFlow(0.2, 0, -5, 1, o)) < 1e-12 && inletFlow(0.25, 0, -5, 1, o, c) > 0);
  check('a crest: submerged inflow on the head difference above the crest', Math.abs(inletFlow(0.25, 0, 0.1, 1, o, c) - inletFlow(0.2, 0.05, 0.1, 1, o)) < 1e-12);
  check('no crest: the same as before', inletFlow(0.1, 2, 1, 1, o) === inletFlow(0.1, 2, 1, 1, o, 0) && inletFlow(0, 2, 1, 1, o) === 0 && inletFlow(0.1, 2, 2.05, 1, o) > 0);
}

{ // two-way exchange at a surcharged manhole (benchmarks/FINDINGS.md F14): a manhole of 1.2 m² over a pipe that carries
  // K √(head above the outlet), under 0.2 m of street water. The rate must settle at what the pipe carries with the
  // manhole at the street's level; the orifice law of the moment (follow: false) swings instead
  const K = 0.05, A = 1.2, eta = 10.2, run = (follow) => {
    const net = { nodes: [node('J0', 4, 4), node('O1', 10, 10, { outfall: true })], pipes: [], inlets: [{ node: 0, cell: 0, grates: 1 }], opts: DESIGN_DEFAULTS };
    let H = 9, lat = 0; const Qp = () => K * Math.sqrt(Math.max(0, H - 8));
    const swmm = { index: (k, name) => (k === 'NODE' ? (name === 'J0' ? 0 : 1) : -1), setLatFlow(i, q) { if (i === 0) lat = q; }, setOutfallStage() {},
      stepTo(t, cb) { for (let k = 0; k < 4; k++) { H += (lat - Qp()) * 0.5 / A; cb(0.5); } }, node: (what, i) => (i !== 0 ? 0 : what === 'HEAD' ? H : what === 'INFLOW' ? Math.max(0, lat) + 1 : what === 'LATFLOW' ? lat : 0), link: () => 0 };
    const cp = new Coupler({ rainRate: 0 }, net, swmm, new Float32Array(4).fill(10), { interval: 2, twoWay: true, follow });
    let q = 0; const rates = [];
    for (let n = 1; n <= 300; n++) { q = cp.step(Float64Array.of(q * 2), Float64Array.of(0.2), 2, 2 * n)[0]; rates.push(q); }
    const last = rates.slice(-50);
    return { q: last.at(-1), H, spread: Math.max(...last) - Math.min(...last) };
  };
  const f = run(true), e = run(false), loss = (f.q / (DESIGN_DEFAULTS.Co * DESIGN_DEFAULTS.inletArea)) ** 2 / (2 * 9.81); // the grate's own head loss at the settled rate
  check('two-way exchange follows the street: the rate settles at what the pipe carries, the manhole at the street level less the grate\'s loss', Math.abs(f.q / (K * Math.sqrt(f.H - 8)) - 1) < 1e-3 && f.spread < 1e-4 && Math.abs(eta - loss - f.H) < 1e-3, `rate ${f.q.toFixed(5)}, head ${f.H.toFixed(4)} (street ${eta}, grate loss ${loss.toFixed(4)}), spread ${f.spread.toExponential(1)}`);
  check('the orifice law of the moment (follow: false) swings on the same manhole', e.spread > 0.01, `spread ${e.spread.toFixed(4)} m³/s`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
