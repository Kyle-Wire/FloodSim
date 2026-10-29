// Bank stability tests: a dry cohesionless bank fails at its friction angle (FS → tan φ′ / tan β), cohesion and channel
// water hold a bank up, pore water in it brings it down (rapid drawdown is the worst case), the probability of failure
// is ½ at FS = 1 and grows as FS falls, and bank tops are found next to water with their height and run.
// Usage: node tests/run-bank-tests.mjs
import { bankFS, normCdf, findBanks, bankClass, plane, UNRATED, COV_C, COV_TANPHI } from '../src/banks.js';
import { TEXTURES } from '../src/sediment.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const t30 = Math.tan(30 * Math.PI / 180);

check('normal CDF', Math.abs(normCdf(0) - 0.5) < 1e-7 && Math.abs(normCdf(1.959964) - 0.975) < 1e-6 && Math.abs(normCdf(-1) - 0.158655) < 1e-6);
{ // 3 m bank at 40°, sand (c′ = 0, φ′ = 30°): planar failure as the plane nears the face, FS → tan 30° / tan 40°
  const H = 3, L = H / Math.tan(40 * Math.PI / 180), dry = bankFS(H, L, 0, t30, 0, 0), limit = t30 / Math.tan(40 * Math.PI / 180);
  check('dry sand fails at its friction angle', Math.abs(dry.fs / limit - 1) < 0.03 && dry.fs < 1, `FS ${dry.fs.toFixed(3)} vs ${limit.toFixed(3)}`);
  const gentle = bankFS(H, H / Math.tan(25 * Math.PI / 180), 0, t30, 0, 0);
  check('a bank flatter than its friction angle stands', gentle.fs > 1 && gentle.pf < 0.5, `FS ${gentle.fs.toFixed(2)}`);
}
{ // 3 m loam bank at 60°, c′ 4 kPa, φ′ 28°
  const H = 3, L = H / Math.tan(60 * Math.PI / 180), tp = Math.tan(28 * Math.PI / 180);
  const dry = bankFS(H, L, 4000, tp, 0, 0), noC = bankFS(H, L, 0, tp, 0, 0);
  const full = bankFS(H, L, 4000, tp, 2.5, 2.5), drawdown = bankFS(H, L, 4000, tp, 2.5, 0), wetDry = bankFS(H, L, 4000, tp, 0, 2.5);
  check('cohesion holds a steep bank up', dry.fs > noC.fs && dry.fs > 1, `FS ${dry.fs.toFixed(2)} with c′, ${noC.fs.toFixed(2)} without`);
  check('channel water confines the bank', wetDry.fs > dry.fs, `FS ${wetDry.fs.toFixed(2)} vs dry ${dry.fs.toFixed(2)}`);
  check('rapid drawdown is the worst case', drawdown.fs < full.fs && drawdown.fs < dry.fs && drawdown.pf > dry.pf, `FS full ${full.fs.toFixed(2)}, after drawdown ${drawdown.fs.toFixed(2)}`);
  // FS = 1 → Pf = ½: search the cohesion that puts FS at 1 (by bisection)
  let lo = 0, hi = 20000; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (bankFS(H, L, m, tp, 2.5, 0).fs < 1) lo = m; else hi = m; }
  const one = bankFS(H, L, hi, tp, 2.5, 0);
  check('probability ½ at FS = 1', Math.abs(one.fs - 1) < 1e-4 && Math.abs(one.pf - 0.5) < 0.01, `pf ${one.pf.toFixed(3)}`);
  check('probability classes', bankClass(0.01) === 0 && bankClass(0.1) === 1 && bankClass(0.4) === 2 && bankClass(0.9) === 3);
}
{ // a channel (rows 0–3, z = 0) with a 1:1 bank to 3 m (rows 4–6), flat top beyond; loam soil, forest on the top
  const nx = 20, ny = 20, F = 1, z = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1), water = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; z[k] = j < 4 ? 0 : Math.min(3, j - 3); if (j < 4) water[k] = 1; }
  const tex = TEXTURES.indexOf('loam'), f = { nx, ny, texture: new Uint8Array(nx * ny).fill(tex), grains: null, cls: new Uint8Array(nx * ny).fill(41), bld: new Uint8Array(nx * ny),
    ga: { K: new Float32Array(nx * ny).fill(1e-6), thetaE: new Float32Array(nx * ny).fill(0.4), depth: new Float32Array(nx * ny).fill(Infinity) } };
  const { banks } = findBanks({ nx, ny, z, mask }, F, f, water);
  const at = (j) => banks.find(b => b.top === j * nx + 10);
  check('bank tops found next to the water', !!at(4) && !!at(6) && !banks.some(b => water[b.top]), `${banks.length} bank cells`);
  const b6 = at(6);
  check('bank height and run to the nearest water', b6 && Math.abs(b6.H - 3) < 1e-9 && Math.abs(b6.L - 3) < 1e-9, b6 ? `H ${b6.H}, L ${b6.L}` : '');
  check('roots add cohesion over the top metre', b6 && b6.c > 4000 && b6.c < 4000 + 5000, b6 ? `c′ ${b6.c.toFixed(0)} Pa` : '');
  check('the bank water table lags by the travel time', b6 && Math.abs(b6.T - 0.4 * 3 / 1e-6) < 1, b6 ? `T ${(b6.T / 86400).toFixed(1)} days` : '');
}

{ // given the bank stands at the start: no change, no risk; a drawdown's risk against Monte Carlo on the same plane
  const H = 3, L = H / Math.tan(60 * Math.PI / 180), tp = Math.tan(28 * Math.PI / 180), c = 4000, full = { hp: 2.5, hw: 2.5 };
  const same = bankFS(H, L, c, tp, 2.5, 2.5, full), half = bankFS(H, L, c, tp, 2.5, 1.2, full), down = bankFS(H, L, c, tp, 2.5, 0, full);
  check('a bank that stood, unchanged, does not fail', same.pf < 1e-6, `pf ${same.pf.toExponential(1)}`);
  check('the further the river drops, the likelier the collapse', down.pf > half.pf && half.pf > 0, `half ${(half.pf * 100).toFixed(1)} %, full drawdown ${(down.pf * 100).toFixed(1)} %`);
  let rnd = 12345; const u = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648, nrm = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  const beta = Math.atan2(H, L), p = plane(H, beta, down.alpha, 2.5, 0), q = plane(H, beta, down.alpha, 2.5, 2.5);
  let stood = 0, failed = 0; for (let n = 0; n < 400000; n++) { const cc = c * (1 + COV_C * nrm()), t = tp * (1 + COV_TANPHI * nrm()); if ((cc * q.Lp + q.N * t) / q.D >= 1) { stood++; if ((cc * p.Lp + p.N * t) / p.D < 1) failed++; } }
  check('conditional probability matches Monte Carlo', Math.abs(failed / stood - down.pf) < 0.01, `${(down.pf * 100).toFixed(2)} % vs ${(failed / stood * 100).toFixed(2)} %`);
  const cliff = bankFS(10, 10 / Math.tan(80 * Math.PI / 180), 500, Math.tan(25 * Math.PI / 180), 0, 0, { hp: 0, hw: 0 });
  check('a bank that only stands on rock or cementation is not rated', cliff.pf === UNRATED);
}

// ---- the nearest-water search stays bounded: a float64 distance over its float32-rounded store once counted as an
// improvement every time, so the front grew without end (a winding stream: "Invalid array length" after ~14 s)
{
  const n = 160, N = n * n, z = new Float64Array(N), mask = new Uint8Array(N).fill(1), water = new Uint8Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const d = Math.abs(i - 0.6 * j - 30); if (d < 3 + 2 * Math.sin(j / 7)) water[j * n + i] = 1; z[j * n + i] = water[j * n + i] ? 0 : Math.min(4, 0.5 * d); }
  const f = { nx: n, bld: new Uint8Array(N), texture: new Uint8Array(N).fill(TEXTURES.indexOf('loam')), cls: new Uint8Array(N).fill(41), bedrock: new Float32Array(N).fill(NaN),
    ga: { K: new Float32Array(N).fill(1e-6), thetaE: new Float32Array(N).fill(0.4), depth: new Float32Array(N).fill(Infinity) } };
  const t0 = Date.now(); let r = null, err = null; try { r = findBanks({ nx: n, ny: n, z, mask }, 1, f, water); } catch (e) { err = e.message; }
  check('nearest-water search terminates on a winding stream', r && r.count > 1000 && Date.now() - t0 < 2000, err ?? `${r.count} bank tops in ${Date.now() - t0} ms`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall bank tests passed');
process.exit(fails ? 1 : 0);
