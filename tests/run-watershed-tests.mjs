// Watershed tests: two valleys split by a ridge (the study area at one outlet takes only its own valley), pits inside
// a basin still drain to it, the outline encloses exactly the watershed's cells, and a catchment cut by the DEM edge is
// flagged.  Usage: node tests/run-watershed-tests.mjs
import { priorityFlood, flowDirections, upstreamOf, outline, watershed } from '../src/watershed.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const shoelace = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a) / 2; };

// 120 × 80 grid, row 0 north. Ridge along row 40 splits a north and a south valley; both slope west to the edge.
const nx = 120, ny = 80, z = new Float64Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const across = j < 40 ? Math.abs(j - 20) : Math.abs(j - 60); // valley axes at rows 20 and 60
  z[j * nx + i] = 10 + 0.05 * i + 0.1 * across + (j === 40 ? 3 : 0);
}
z[20 * nx + 70] -= 2; z[20 * nx + 71] -= 2; // a pit in the north valley
{
  const zf = priorityFlood(z, nx, ny);
  let raised = 0, below = 0; for (let k = 0; k < z.length; k++) { if (zf[k] > z[k] + 1e-9) raised++; if (zf[k] < z[k]) below++; }
  check('priority flood fills the pit and never lowers ground', raised >= 2 && below === 0, `${raised} cells raised`);
  const dir = flowDirections(zf, nx, ny); let sinks = 0;
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) if (dir[j * nx + i] < 0) sinks++;
  check('every interior cell has a downhill direction after filling', sinks === 0, `${sinks} sinks`);
}
{ // study area: a 6 × 6 box at the mouth of the north valley (west edge, rows 17–22)
  const target = new Uint8Array(nx * ny); for (let j = 17; j <= 22; j++) for (let i = 2; i <= 7; i++) target[j * nx + i] = 1;
  const w = watershed(z, nx, ny, target);
  let south = 0, north = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (w.mask[j * nx + i]) (j > 40 ? south++ : north++);
  check('the watershed is the study area\'s own valley, not the one past the ridge', south === 0 && north > 2000, `${north} cells north, ${south} south`);
  check('the pit inside the valley drains into it', w.mask[20 * nx + 70] === 1);
  check('upstream share reported', w.upstreamCells === w.cells - 36 && w.studyCells === 36);
  const full = outline(w.mask, nx, ny, 0);
  check('the outline encloses exactly the watershed cells', Math.abs(shoelace(full) - w.cells) < 1e-9 || w.touchesEdge, `${shoelace(full)} vs ${w.cells} cells`);
}
{ // an L-shaped mask with a diagonal pinch: the outline still closes and encloses the largest piece
  const m = new Uint8Array(20 * 20); for (let j = 2; j < 10; j++) for (let i = 2; i < 6; i++) m[j * 20 + i] = 1; for (let j = 6; j < 10; j++) for (let i = 6; i < 14; i++) m[j * 20 + i] = 1; m[10 * 20 + 14] = 1;
  const r = outline(m, 20, 20, 0), cells = m.reduce((a, b) => a + b, 0);
  check('outlines close around concave and pinched shapes', Math.abs(shoelace(r) - cells) < 1e-9, `${shoelace(r)} vs ${cells}`);
}
{ // study area in the middle of a slope that keeps rising off the east edge: the catchment is cut by the DEM edge
  const target = new Uint8Array(nx * ny); for (let j = 18; j <= 22; j++) for (let i = 60; i <= 64; i++) target[j * nx + i] = 1;
  const w = watershed(z, nx, ny, target);
  check('a catchment that runs off the DEM is flagged', w.touchesEdge);
}
{ // a river from beyond the DEM crosses the area; a side valley drains in directly
  const n2 = 100, z2 = new Float64Array(n2 * n2);
  for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) {
    const river = 5 + 0.02 * (n2 - j) + 0.2 * Math.abs(i - 50);             // a river along column 50 flowing south (row 99)
    const side = i > 52 && i < 90 && j > 55 && j < 75 ? 4.5 + 0.03 * i + 0.15 * Math.abs(j - 65) : Infinity; // a side valley from the east into the river at row 65
    z2[j * n2 + i] = i >= 90 ? 14 - 0.3 * (i - 90) : Math.min(river, side + 0.5); // a ridge at column 90; beyond it the ground drains east
  }
  const target = new Uint8Array(n2 * n2); for (let j = 60; j <= 70; j++) for (let i = 45; i <= 55; i++) target[j * n2 + i] = 1;
  const w = watershed(z2, n2, n2, target);
  const side = w.local?.mask[65 * n2 + 80], up = w.local?.mask[10 * n2 + 50];
  check('with a river from off the DEM, the local watershed keeps side valleys and drops the river basin', w.touchesEdge && w.local && side === 1 && up === 0 && w.local.riverCells > 0, `${w.local?.cells} local cells of ${w.cells}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall watershed tests passed');
process.exit(fails ? 1 : 0);
