// Window rerun tests: the window rectangle, its edge segments (watertight, + outward, the cells just inside), the inflow
// rate from cumulative samples, the edge check, and merging the window run's grids into the existing run's.
// Usage: node tests/run-window-tests.mjs
import * as W from '../src/window.js';
import { lineFaces } from '../src/compare.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const nx = 60, ny = 40, r = W.windowRect([20, 15, 30, 22], 5, nx, ny);
check('window: the box grown by the buffer, kept off the edge', r.i0 === 15 && r.j0 === 10 && r.i1 === 35 && r.j1 === 27 && W.windowRect([0, 0, 59, 39], 5, nx, ny).i0 === 2);
{
  const segs = W.windowSegments(r, nx, 6), lf = lineFaces(segs.map(s => s.line), nx, ny), inside = W.insideMask(r, nx, ny);
  const perim = 2 * (r.i1 - r.i0 + 1) + 2 * (r.j1 - r.j0 + 1);
  check('segments: every edge face once', lf.faces.length === perim && new Set(lf.faces.map(f => `${f.axis},${f.i},${f.j}`)).size === perim, `${segs.length} segments, ${lf.faces.length} faces, perimeter ${perim}`);
  // + outward: for an x-face (between i−1 and i), + is toward +x; outward on the east edge (i = i1 + 1), inward on the west
  const out = lf.faces.every(f => {
    const a = f.axis === 0 ? (f.j) * nx + (f.i - 1) : (f.j - 1) * nx + f.i, b = f.j * nx + f.i; // a: −x / −y side, b: +x / +y side
    const plusSideInside = inside[b] === 1, sign = f.sign; // + flux runs a → b
    return sign > 0 ? !plusSideInside : plusSideInside;
  });
  check('+ is outward on every segment face', out);
  const cells = segs.flatMap(s => s.cells), ring = new Set(); for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (i === r.i0 || i === r.i1 || j === r.j0 || j === r.j1) ring.add(j * nx + i);
  check('the cells just inside: the whole inner ring, each cell once', cells.every(k => ring.has(k)) && [...ring].every(k => cells.includes(k)) && cells.length === ring.size && new Set(cells).size === cells.length, `${cells.length} cells`);
}
{
  const s = [[0, 0, 0, 0], [10, -5, 0, 5], [20, -5, 3, 8], [30, -5, 3, 8]], q = W.rateOf(s, 3), p = W.rateOf(s, 2);
  check('inflow rate from cumulative samples', q(5) === 0.5 && q(15) === 0.3 && q(25) === 0 && q(35) === 0 && p(15) === 0.3 && q(0) === 0);
  check('cumulative volume between samples', W.volumeAt(s, 15, 3) === 6.5 && W.volumeAt(s, 99, 3) === 8 && W.volumeAt(s, -1, 3) === 0);
}
{
  const base = [{ side: 'N', plus: 100 }, { side: 'E', plus: 50 }, { side: 'S', plus: 0.2 }], same = W.checkWindow(base, [{ plus: 101 }, { plus: 49 }, { plus: 0.9 }]);
  const moved = W.checkWindow(base, [{ plus: 100 }, { plus: 70 }, { plus: 0.2 }]);
  check('the check: small differences pass, tiny volumes ignored', same.changed === 0 && same.maxRel < 0.03);
  check('the check: a changed segment is flagged', moved.changed === 1 && moved.segments[1].changed && Math.abs(moved.maxRel - 20 / 70) < 1e-12);
}
{
  const fi = W.fineInside({ i0: 1, j0: 1, i1: 2, j1: 2 }, 8, 8, 2), base = { d: new Float32Array(64).fill(1) }, win = { d: new Float32Array(64).fill(2), extra: new Float32Array(64) };
  const m = W.mergeGrids(base, win, fi);
  check('merge: the window run inside, the existing run outside', m.d[2 * 8 + 2] === 2 && m.d[5 * 8 + 5] === 2 && m.d[0] === 1 && m.d[6 * 8 + 6] === 1 && fi.reduce((a, v) => a + v, 0) === 16 && m.extra === win.extra);
}

console.log(fails ? `\n${fails} FAILED` : '\nall window tests passed');
process.exit(fails ? 1 : 0);
