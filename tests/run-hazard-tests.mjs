// Hazard product tests: ARR 2019 H1–H6 and FD2320 classes at their thresholds, force per width, and the tracker
// (worst class at the same moment, not max depth × max speed; duration and arrival).
// Usage: node tests/run-hazard-tests.mjs
import { STANDARDS, HazardTracker, forcePerWidth } from '../src/hazard.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{
  const A = STANDARDS.arr.classify;
  const cases = [[0.2, 1.0, 1], [0.3, 1.0, 1], [0.31, 0.5, 2], [0.2, 2.0, 2], [0.45, 1.2, 2], [1.0, 0.5, 3], [0.6, 1.2, 4], [1.5, 0.5, 4], [0.4, 2.1, 5],
    [2.5, 1.0, 5], [1.0, 3.9, 5], [4.5, 0.2, 6], [1.0, 4.5, 6], [2.0, 2.1, 6]];
  const bad = cases.filter(([d, v, c]) => A(d, v) !== c);
  check('ARR 2019 H1–H6 at and around the curve limits', !bad.length, bad.map(([d, v, c]) => `d ${d} v ${v}: H${A(d, v)} not H${c}`).join('; '));
  const D = STANDARDS.defra.classify, U = STANDARDS.defraUrban.classify;
  check('FD2320 HR = d(v + 0.5) classes', D(0.5, 0.9) === 1 && D(0.5, 1.1) === 2 && D(0.5, 2.0) === 3 && D(1.0, 1.6) === 4, `HR(0.5, 1.1) = ${(0.5 * 1.6).toFixed(2)}`);
  check('FD2320 urban debris factor adds 1 above 0.25 m', U(0.2, 1) === D(0.2, 1) && U(0.3, 0.5) === 3 && D(0.3, 0.5) === 1);
}
{
  check('force per width = ρ(hv² + ½gh²)', Math.abs(forcePerWidth(0.5, 2) - (0.5 * 4 + 0.5 * 9.81 * 0.25)) < 1e-9 && Math.abs(forcePerWidth(1, 0) - 4.905) < 1e-9);
}
{ // deep-and-slow at one time, shallow-and-fast at another: the worst class is from each moment, not the maxima
  const tr = new HazardTracker(1, { thr: 0.15 });
  tr.update(0, [0, 0]); tr.update(60, [1.0, 0.2]); tr.update(120, [0.1, 1.5]); tr.update(180, [0.05, 0.1]);
  const naive = STANDARDS.arr.classify(1.0, 1.5);
  check('hazard comes from simultaneous depth and velocity', tr.cls.arr[0] === 3 && naive === 5, `H${tr.cls.arr[0]} (max d × max v would say H${naive})`);
  check('peak d·v is a same-moment product', Math.abs(tr.dv[0] - 0.2) < 1e-6, `${tr.dv[0].toFixed(3)} m²/s`);
  check('duration counts the intervals deeper than 15 cm', tr.duration[0] === 60 && tr.arrival[0] === 60, `${tr.duration[0]} s from ${tr.arrival[0]} s`);
  check('class areas', tr.classAreas('arr', 4).reduce((a, b) => a + b, 0) === 4);
}
{
  const tr = new HazardTracker(2); tr.update(0, [0.005, 3, 0, 0]); tr.update(10, [0.005, 3, 0, 0]);
  check('films under 1 cm are not classified', tr.cls.arr[0] === 0 && tr.force[0] === 0 && Number.isNaN(tr.arrival[0]));
}

{
  const tr = new HazardTracker(1); tr.update(0, [0.03, 5.5]);
  check('a few cm of fast wetting-front water is classed by depth alone', tr.cls.arr[0] === 1 && tr.dv[0] === 0, `H${tr.cls.arr[0]}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall hazard tests passed');
process.exit(fails ? 1 : 0);
