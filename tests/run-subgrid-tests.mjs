// Subgrid table tests: flat ground gives exact storage and Manning conveyance, buildings act as porosity, curbs block
// a face until water tops them, level ↔ volume lookups invert each other, 1 m depth from cell levels.
// Usage: node tests/run-subgrid-tests.mjs   (the GPU solver is checked against the 1 m run in tests/gpu-suite.js)
import { buildSubgrid, cellVolume, cellLevel, faceFlow, fineDepth, CT, FT } from '../src/subgrid.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const fine = (nx, ny, zf, bldf = () => 0, n = 0.03) => {
  const N = nx * ny, z = new Float32Array(N), bld = new Uint8Array(N), manning = new Float32Array(N).fill(n), infil = new Float32Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { z[j * nx + i] = zf(i, j); bld[j * nx + i] = bldf(i, j); }
  return { nx, ny, z, bld, manning, infil };
};

{ // flat open ground
  const sg = buildSubgrid(fine(16, 16, () => 10), 4), o = 5 * CT;
  check('flat cell: volume per area = depth', Math.abs(cellVolume(sg.ct, o, 10.37) - 0.37) < 1e-6 && Math.abs(cellVolume(sg.ct, o, 12.5) - 2.5) < 1e-5);
  const ff = faceFlow(sg.fx, (1 * 5 + 2) * FT, 10.5), Km = 0.5 ** (5 / 3) / 0.03;
  check('flat face: H = depth, K = h^5/3 / n (Manning)', Math.abs(ff.H - 0.5) < 1e-6 && Math.abs(ff.K / Km - 1) < 1e-4, `K ${ff.K.toFixed(3)} vs ${Km.toFixed(3)}`);
  const sh = faceFlow(sg.fx, (1 * 5 + 2) * FT, 10.03), Ks = 0.03 ** (5 / 3) / 0.03;
  check('shallow sheet flow conveyance stays exact (K^0.6 tabulated)', Math.abs(sh.K / Ks - 1) < 1e-3, `${(sh.K / Ks).toFixed(4)}`);
}
{ // half the cell is building: porosity
  const sg = buildSubgrid(fine(8, 8, () => 5, (i) => (i % 4 < 2 ? 1 : 0)), 4, { conveyance: 'series' });
  check('a part-building cell stores water only in its open part', sg.mask[0] === 1 && Math.abs(sg.phi[0] - 0.5) < 1e-9 && Math.abs(cellVolume(sg.ct, 0, 6) - 0.5) < 1e-6);
  const all = buildSubgrid(fine(8, 8, () => 5, (i, j) => (i < 4 && j < 4 ? 1 : 0)), 4);
  check('an all-building cell is a wall', all.mask[0] === 0 && all.mask[1] === 1);
  const ffy = faceFlow(sg.fy, (1 * 2 + 0) * FT, 6); // y-face crossing two building columns of four
  check('buildings block their strips of a face', Math.abs(ffy.H - 0.5) < 1e-6, `H ${ffy.H.toFixed(3)} at 1 m of water`);
}
{ // a 15 cm curb across the flow: blocked until water tops it
  const curb = fine(16, 4, (i) => (i === 6 ? 10.15 : 10)); // curb in the region of x-face 2 (columns 6..9)
  const sg = buildSubgrid(curb, 4, { conveyance: 'series' });
  const below = faceFlow(sg.fx, 2 * FT, 10.14), above = faceFlow(sg.fx, 2 * FT, 10.25);
  check('a curb blocks the face until water tops it (series)', below.K === 0 && below.H === 0 && above.K > 0 && Math.abs(above.H - 0.1) < 1e-3, `H over the curb ${above.H.toFixed(3)} m`);
  const bl = buildSubgrid(curb, 4), b0 = faceFlow(bl.fx, 2 * FT, 10.14), b1 = faceFlow(bl.fx, 2 * FT, 10.25);
  check('the default blend still blocks below the curb, and conveys between series and parallel above it', b0.K === 0 && b1.K > above.K && b1.H > above.H && b1.H < 0.25, `H ${b1.H.toFixed(3)} m`);
}
{ // level ↔ volume round trip on rough ground
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sg = buildSubgrid(fine(32, 32, () => 10 + 2 * rnd(), () => (rnd() < 0.2 ? 1 : 0)), 8); let err = 0;
  for (let K = 0; K < 16; K++) { if (!sg.mask[K]) continue; for (const v of [0.001, 0.05, 0.4, 1.3, 3]) err = Math.max(err, Math.abs(cellVolume(sg.ct, K * CT, cellLevel(sg.ct, K * CT, v)) - v)); }
  check('level and volume lookups invert each other', err < 1e-5, `max error ${err.toExponential(1)} m`);
  const eta = new Float64Array(16).fill(11), d = fineDepth(sg, eta, { nx: 32, ny: 32, z: Float32Array.from({ length: 1024 }, () => 10.5), bld: new Uint8Array(1024) });
  check('1 m depth = level − 1 m ground', Math.abs(d[100] - 0.5) < 1e-6);
}

console.log(fails ? `\n${fails} FAILED` : '\nall subgrid table tests passed');
process.exit(fails ? 1 : 0);
