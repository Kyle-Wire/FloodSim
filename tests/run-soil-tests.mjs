// Soil and Green-Ampt tests: USDA texture classes, SSURGO rows → parameters (the real Eastwick "Urban land–Howell
// complex" rows), ponded Green-Ampt infiltration against the analytic solution, the water table capping storage, and
// the cell aggregation.  Usage: node tests/run-soil-tests.mjs
import { textureClass, soilParams, hsgParams, gaCells, WETNESS } from '../src/soil.js';
import { CPUSolver } from '../src/solver-cpu.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{
  const cases = [[92, 3, 'sand'], [82, 5, 'loamy sand'], [65, 10, 'sandy loam'], [40, 20, 'loam'], [20, 15, 'silt loam'], [5, 5, 'silt'],
    [60, 25, 'sandy clay loam'], [30, 33, 'clay loam'], [10, 33, 'silty clay loam'], [50, 40, 'sandy clay'], [5, 45, 'silty clay'], [20, 60, 'clay']];
  const bad = cases.filter(([s, c, t]) => textureClass(s, c) !== t);
  check('USDA texture classes', !bad.length, bad.map(([s, c, t]) => `${s}/${c}: ${textureClass(s, c)} ≠ ${t}`).join('; '));
}
{ // Soil Data Access rows as returned for Eastwick, Philadelphia (Urban land–Howell complex and Water)
  const head = ['mukey', 'wtdepannmin', 'brockdepmin', 'cokey', 'compname', 'comppct_r', 'hzdept_r', 'ksat_r', 'wsatiated_r', 'sandtotal_r', 'claytotal_r', 'kffact'];
  const rows = [
    ['1479572', '91', '138', 'c1', 'Urban land', '50', '0', null, null, null, null, null],
    ['1479572', '91', '138', 'c2', 'Howell', '30', '0', '7.76', '47', '32.1', '12', '.49'],
    ['1479572', '91', '138', 'c2', 'Howell', '30', '23', '2.82', '44', '55.1', '27.5', '.24'],
    ['1479572', '91', '138', 'c2', 'Howell', '30', '107', '2.82', '42', '28.1', '42.5', '.24'],
    ['1478520', null, null, 'c3', 'Water', '100', null, null, null, null, null, null]];
  const p = soilParams([head, ...rows]), h = p.get('1479572');
  check('urban complexes use their soil component, not "Urban land"', h.component === 'Howell' && h.texture === 'silt loam', JSON.stringify({ c: h.component, t: h.texture }));
  check('K = half the most restrictive near-surface Ksat', Math.abs(h.K - 2.82e-6 * 0.5) < 1e-12, `${(h.K * 3.6e6).toFixed(2)} mm/hr`);
  check('water table and bedrock depths in metres', h.wt === 0.91 && h.bedrock === 1.38);
  check('effective porosity from the survey porosity', Math.abs(h.thetaE - (0.47 - (0.501 - 0.486))) < 1e-9, h.thetaE.toFixed(3));
  check('water units have no parameters', !p.get('1478520').K);
  check('hydrologic group fallback', hsgParams('D').texture === 'clay' && hsgParams('A').K > hsgParams('D').K * 50);
}
const column = (o) => { const s = new CPUSolver({ nx: 1, ny: 1, dx: 1, z: new Float64Array(1), manning: 0, ga: { psiD: [o.psiD], fmax: [o.fmax ?? 1e9], perv: [1] } }); s.infil[s.idx(0, 0)] = o.K; return s; };
{ // ponded Green-Ampt: t(F) = (F − ψΔθ·ln(1 + F/ψΔθ)) / K
  const K = 1e-5, psiD = 0.05, s = column({ K, psiD }); s.setDepth(() => 2);
  const F0 = 1e-3; let errMax = 0;
  for (const T of [600, 1800, 3600]) {
    s.run(T); const F = s.gaF[s.idx(0, 0)];
    const tF = (F - psiD * Math.log(1 + F / psiD) - (F0 - psiD * Math.log(1 + F0 / psiD))) / K; // from the 1 mm start
    errMax = Math.max(errMax, Math.abs(tF - T) / T);
  }
  check('ponded Green-Ampt follows the analytic solution', errMax < 0.02, `${(errMax * 100).toFixed(2)} % in time`);
}
{ // the water table: storage of 5 cm, then nothing more
  const s = column({ K: 1e-5, psiD: 0.05, fmax: 0.05 }); s.setDepth(() => 1); s.run(7200);
  const F = s.gaF[s.idx(0, 0)], h = s.h[s.idx(0, 0)];
  check('infiltration stops when the soil is full to the water table', Math.abs(F - 0.05) < 1e-9 && Math.abs(h - 0.95) < 1e-9, `F ${F.toFixed(4)} m, depth ${h.toFixed(4)} m`);
}
{ // aggregation: a 2×2 cell, one pixel paved, one building
  const f = { nx: 2, ny: 2, bld: Uint8Array.from([0, 0, 0, 1]), perv: Float32Array.from([1, 0, 0.5, 0]),
    ga: { K: Float32Array.from([1e-6, 1e-6, 2e-6, 0]), psi: Float32Array.from([0.1, 0.1, 0.2, 0]), thetaE: Float32Array.from([0.4, 0.4, 0.4, 0]), depth: Float32Array.from([1, 1, Infinity, 0]) } };
  const g = gaCells(f, 1, 1, 2, [1], { Se: WETNESS.normal }), s = gaCells(f, 1, 1, 2, [1], { Se: WETNESS.normal, perCellArea: true });
  const dth = 0.4 * 0.6;
  check('cell K averages the pervious parts over the open area (or the whole cell, subgrid)', Math.abs(g.K[0] / ((1e-6 + 0.5 * 2e-6) / 3) - 1) < 1e-6 && Math.abs(s.K[0] / (2e-6 / 4) - 1) < 1e-6);
  check('ψΔθ and storage are pervious-weighted', Math.abs(g.psiD[0] / ((1 * 0.1 * dth + 0.5 * 0.2 * dth) / 1.5) - 1) < 1e-6 && Math.abs(g.fmax[0] / ((1 * dth * 1 + 0.5 * 1e3) / 1.5) - 1) < 1e-6);
}

console.log(fails ? `\n${fails} FAILED` : '\nall soil tests passed');
process.exit(fails ? 1 : 0);
