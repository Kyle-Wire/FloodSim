// Sheet-flow tests (FINDINGS F26): steady rain on a uniform plane against the kinematic-wave depth
// h(x) = (i x n / sqrt S)^(3/5). With implicitFriction + stepFlux the film is right on steep ground and coarse cells;
// the default solver is kept as it is (opt-in until the GPU kernels carry the same change) and its known miss is recorded.
// Usage: node tests/run-sheetflow-tests.mjs
import { CPUSolver } from '../src/solver-cpu.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

function plane(dx, S, n, mmh, opts) {
  const L = 120, nx = Math.round(L / dx), ny = 3, z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 100 - S * (i + 0.5) * dx;
  const s = new CPUSolver({ nx, ny, dx, z, manning: n, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' }, ...opts });
  const i_ms = mmh / 1000 / 3600; s.rainRate = i_ms;
  const tc = Math.pow(L * n / Math.sqrt(S), 0.6) / Math.pow(i_ms, 0.4);
  s.run(3 * tc + 300);
  const H = s.field('h'), out = [];
  for (const x of [40, 80, 100]) { const i = Math.floor(x / dx), xc = (i + 0.5) * dx; out.push(H[nx + i] / Math.pow(i_ms * xc * n / Math.sqrt(S), 0.6)); }
  return { ratios: out, mass: s.massBalance().rel };
}

const FIX = { implicitFriction: true, stepFlux: true };
for (const [dx, S, n, mmh] of [[2, 0.05, 0.1, 50], [4, 0.15, 0.1, 50]]) {
  const r = plane(dx, S, n, mmh, FIX);
  check(`F26 fix: dx ${dx} m, slope ${S}: depth within 12 % of kinematic at 40, 80, 100 m`, r.ratios.every((q) => Math.abs(q - 1) <= 0.12), r.ratios.map((q) => q.toFixed(3)).join(', '));
  check(`F26 fix: dx ${dx} m, slope ${S}: mass balance`, Math.abs(r.mass) < 1e-12, r.mass.toExponential(2));
}
{ // the default is unchanged and still has the miss (so a later default flip is a deliberate, visible change)
  const r = plane(2, 0.05, 0.1, 50, {});
  check('default solver: known F26 miss still present (film under 60 % of kinematic at 100 m)', r.ratios[2] < 0.6, r.ratios[2].toFixed(3));
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
