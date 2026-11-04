// River outlet tests: the backwater rise matches the gradually-varied-flow solution of a wide channel, and a model cut
// off part way down a river holds the level of the full river when its edge stands at the level carried up from a gauge
// downstream, where a free outfall draws it down.
// Usage: node tests/run-outlet-tests.mjs
import { CPUSolver } from '../src/solver-cpu.js';
import { edgeSection, conveyance, backwater, outletSeries, sideToward, onSide } from '../src/outlet.js';
import { tidalEdgeCells } from '../src/waterlevels.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const W = 5, dx = 10, n = 0.03, Q = 200, down = 3; // a 50 m wide channel on a level bed, 200 m³/s, 3 m deep at the gauge
const sec = edgeSection({ z: new Float64Array(W), manning: n }, [0, 1, 2, 3, 4], dx);
{
  check('conveyance of a wide strip: w·d^5/3/n', Math.abs(conveyance(sec, 2) - 50 * 2 ** (5 / 3) / n) < 1e-9);
  check('a dry section conveys nothing', conveyance(sec, -1) === 0);
  // level bed, wide channel, no velocity head: d^13/3 = d0^13/3 + 13/3 (q n)² L
  const L = 800, q = Q / (W * dx), exact = (down ** (13 / 3) + 13 / 3 * (q * n) ** 2 * L) ** (3 / 13), ws = backwater(sec, Q, down, L);
  check('backwater rise matches the gradually-varied-flow solution', Math.abs(ws - exact) < 1e-3, `${ws.toFixed(4)} vs ${exact.toFixed(4)} m`);
  check('no flow or no reach: no rise', backwater(sec, 0, down, L) === down && backwater(sec, Q, down, 0) === down);
  check('a gauge below the bed starts from the bed', backwater(sec, 0, -2, L) > 0);
  const s = outletSeries(sec, [[0, 3], [100, 3.5]], [[0, 0], [100, Q]], L);
  check('outlet series: the gauge level plus the rise at its flow then', s.v[0] === 3 && s.v[1] > 3.5 && s.down[1] === 3.5 && s.q[1] === Q);
}
{
  check('side toward a point south of the grid', sideToward(100, 50, 60, 140) === 'south' && sideToward(100, 50, 160, 30) === 'east' && sideToward(100, 50, -5, 20) === 'west');
  check('edge cells by side', onSide(4 * 10 + 3, 10, 5, 'south') && onSide(3, 10, 5, 'north') && !onSide(3, 10, 5, 'south'));
  // tidal edge cells restricted to one side: water on the south and north edges, only the south one kept
  const nx = 10, ny = 6, z = new Float64Array(nx * ny).fill(5), water = new Uint8Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  for (const k of [5 * nx + 4, 5 * nx + 5, 4, 5]) { z[k] = 0; water[k] = 1; }
  const all = tidalEdgeCells({ nx, ny, z, mask }, mask, water, 2), south = tidalEdgeCells({ nx, ny, z, mask }, mask, water, 2, { side: 'south' });
  check('a river outlet keeps to the side facing its gauge', all.length === 4 && south.length === 2 && south.every(k => ((k / nx) | 0) === ny - 1));
}

/** A channel nx cells long running east, inflow Q into its first column, its east edge a water level or a free outfall; steady level per column. */
function channel(nx, edge, T = 4000) {
  const ny = W, z = new Float64Array(nx * ny), east = Array.from({ length: ny }, (_, j) => j * nx + nx - 1);
  const s = new CPUSolver({ nx, ny, dx, z, manning: n, bc: { west: 'wall', south: 'wall', north: 'wall', east: 'outflow' }, stageCells: edge != null ? east : undefined });
  if (edge != null) s.setStage(edge);
  s.setDepth(() => edge ?? down);
  let t0 = 0;
  s.run(T, (sv) => { const a = Q * (sv.t - t0) / (dx * dx * ny); t0 = sv.t; for (let j = 0; j < ny; j++) sv.h[sv.idx(0, j)] += a; });
  const ws = (i) => { let v = 0; for (let j = 0; j < ny; j++) v += s.h[s.idx(i, j)] + s.z[s.idx(i, j)]; return v / ny; };
  let out = 0; for (let j = 0; j < ny; j++) { const c = s.idx(nx - 1, j); out += s.hu[c] * dx; }
  return { ws, out };
}
{
  // the full river: 1,600 m with its gauge (a level of 3 m) at the east end; the model: the upper 800 m
  const full = channel(160, down), L = 800, edge = backwater(sec, Q, down, L);
  const cut = channel(80, edge), free = channel(80, null);
  check('the full river is steady at the inflow', Math.abs(full.out - Q) / Q < 0.02, `${full.out.toFixed(1)} m³/s out`);
  check('backwater stage at the cut matches the full river there', Math.abs(edge - full.ws(80)) < 0.03, `${edge.toFixed(3)} vs ${full.ws(80).toFixed(3)} m`);
  check('with the outlet the cut model holds the river’s level upstream', Math.abs(cut.ws(20) - full.ws(20)) < 0.03, `${cut.ws(20).toFixed(3)} vs ${full.ws(20).toFixed(3)} m`);
  check('a free outfall draws the same river down', full.ws(20) - free.ws(20) > 0.5, `${free.ws(20).toFixed(3)} vs ${full.ws(20).toFixed(3)} m`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
