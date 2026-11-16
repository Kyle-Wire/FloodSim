// Closed-crossing check (src/crossings.js): a stream path over a synthetic valley, with and without a fill across it.
// Usage: node tests/run-crossings-tests.mjs
import { closedCrossings, crossingNote, joinStreams } from '../src/crossings.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// a valley 200 m long falling east at 1 %: a flat floor 110 m wide about row 60, sides rising 0.2 m per m
const nx = 200, ny = 120, J = 60, fine = { dx: 1 };
const bed = (i) => 10 - 0.01 * i, TOP = bed(89) + 4; // a fill 4 m over the bed above it
function valley(edit) {
  const z = new Float32Array(nx * ny), road = new Uint8Array(nx * ny), bld = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = bed(i) + 0.2 * Math.max(0, Math.abs(j - J) - 55);
  const f = { nx, ny, z, road, bld }; edit?.(f); return f;
}
/** A fill across the valley from column i0 to i1, level at `top`, over rows j0..j1 (the whole width by default). */
const fill = (f, i0, i1, top, { j0 = 0, j1 = ny - 1, road = false } = {}) => { for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (f.z[k] < top) f.z[k] = top; if (road) f.road[k] = 1; } };
const path = Array.from({ length: nx }, (_, i) => J * nx + i);

{
  const r = closedCrossings(fine, valley(), [path]);
  check('open valley: nothing listed, one stream walked', r.closed.length === 0 && r.culverts.length === 0 && r.uphill.length === 0 && r.checked === 1 && crossingNote(r) === '');
}
{
  // a 60 m highway fill, 4 m over the bed: too long for breachChannels (≤ 30 m), so it stays in the terrain
  const r = closedCrossings(fine, valley(f => fill(f, 90, 149, TOP, { road: true })), [{ path, name: 'Test Creek', kind: 'stream' }]);
  const c = r.closed[0];
  check('a fill across the whole valley is a closed crossing', r.closed.length === 1 && c.road === true && c.name === 'Test Creek' && c.j === J && c.i >= 90 && c.i <= 149);
  check('its foot is the bed above it, its pond the depth to the crest', Math.abs(c.foot - bed(89)) < 0.01 && Math.abs(c.crest - TOP) < 1e-4 && Math.abs(c.pond - (TOP - bed(89))) < 0.01, `pond ${c.pond.toFixed(2)} m`);
  check('its length is the fill along the stream', c.length >= 59 && c.length <= 62, `${c.length} m`);
  check('the note names the depth, the stream and the road', /^1 stream crossing closed by the terrain: water must pond up to 4\.0 m to pass \(Test Creek\), under a road/.test(crossingNote(r)), crossingNote(r));
}
{
  // the same fill with a 3 m opening at bed level 20 m to one side: water gets round, so it is terrain
  const f = valley(g => { fill(g, 90, 149, TOP); for (let j = J + 19; j <= J + 21; j++) for (let i = 80; i <= 160; i++) g.z[j * nx + i] = bed(i); });
  check('a fill with a way round inside the corridor is not listed', closedCrossings(fine, f, [path]).closed.length === 0);
  // the opening 50 m away is outside the 30 m corridor: the stream as mapped is still dammed
  const far = valley(g => { fill(g, 90, 149, TOP); for (let j = J + 49; j <= J + 51; j++) for (let i = 80; i <= 160; i++) g.z[j * nx + i] = bed(i); });
  check('a way round outside the corridor does not clear it; a wider corridor does', closedCrossings(fine, far, [path]).closed.length === 1 && closedCrossings(fine, far, [path], { corridor: 60 }).closed.length === 0);
}
{
  check('a 0.3 m riffle is not listed', closedCrossings(fine, valley(f => fill(f, 100, 104, bed(100) + 0.3)), [path]).closed.length === 0);
  const low = valley(f => fill(f, 100, 110, bed(100) + 0.8));
  { const a = closedCrossings(fine, low, [path]), b = closedCrossings(fine, low, [path], { minPond: 1 });
    check('a 0.8 m rise with no road is a bed rise, not a closed crossing; not listed at all at 1 m', a.closed.length === 0 && a.rises.length === 1 && crossingNote(a) === '' && b.rises.length === 0);
    const rd = closedCrossings(fine, valley(f => fill(f, 100, 110, bed(100) + 0.8, { road: true })), [path]);
    check('the same rise under a road is a closed crossing', rd.closed.length === 1 && rd.rises.length === 0 && closedCrossings(fine, low, [path], { natural: 0.6 }).closed.length === 1); }
  const two = closedCrossings(fine, valley(f => { fill(f, 40, 60, bed(40) + 1); fill(f, 120, 150, bed(120) + 3); }), [path]);
  check('two fills: the 3 m one closed, the 1 m one a bed rise', two.closed.length === 1 && two.rises.length === 1 && two.closed[0].i >= 120 && two.rises[0].i <= 60);
  check('a fill longer than the reach is terrain, not a crossing', closedCrossings(fine, valley(f => fill(f, 60, 170, 14)), [path], { reach: 80 }).closed.length === 0);
}
{
  // a mapped culvert through the fill: the solver links it, so it is not closed, but its size matters
  const f = valley(g => fill(g, 90, 149, TOP, { road: true })), cells = Array.from({ length: 64 }, (_, n) => J * nx + 88 + n);
  const guess = closedCrossings(fine, f, [path], { culverts: [{ cells, D: 1.2, sized: false }] });
  check('a fill with a mapped culvert is a culvert crossing, not a closed one', guess.closed.length === 0 && guess.culverts.length === 1 && guess.culverts[0].culvert.D === 1.2 && guess.culverts[0].culvert.sized === false);
  check('an assumed barrel is called out', /^1 culvert through a fill with no mapped size \(1\.2 m assumed under 4\.0 m of fill\)$/.test(crossingNote(guess)), crossingNote(guess));
  const sized = closedCrossings(fine, f, [path], { culverts: [{ cells, D: 3, sized: true }] });
  check('a culvert with a mapped size is not', sized.culverts.length === 1 && crossingNote(sized) === '');
  const away = closedCrossings(fine, f, [path], { culverts: [{ cells: cells.map(k => k + 40 * nx), D: 1.2 }] });
  check('a culvert 40 m to the side does not open the crossing', away.closed.length === 1 && away.culverts.length === 0);
}
{
  const r = closedCrossings(fine, valley(f => fill(f, 90, 149, TOP)), [[...path].reverse(), path, [path[0], path[1]]]);
  check('a path mapped against the flow is reported as not checked, not as crossings', r.uphill.length === 1 && r.uphill[0].stream === 0 && r.checked === 1 && r.closed.length === 1 && r.closed[0].stream === 1);
  const b = valley(f => { fill(f, 90, 149, TOP); for (let i = 90; i <= 149; i++) f.bld[(J + 5) * nx + i] = 1; });
  check('typed-array paths work', closedCrossings(fine, b, [Int32Array.from(path)]).closed.length === 1);
}

{
  // the Pennsauken case (16 Nov 2026): the creek is mapped as three ways, and the middle one lies on top of the fill
  const f = valley(g => fill(g, 90, 149, TOP, { road: true })), cut = (i0, i1) => path.slice(i0, i1 + 1);
  const ways = [{ path: cut(0, 89), line: [[0, 0], [1, 0]], name: 'Creek' }, { path: cut(95, 144), line: [[1, 0], [2, 0]], name: 'Creek' }, { path: cut(150, 199), line: [[2, 0], [3, 0]], name: 'Creek' }];
  check('three ways, the middle one on the fill: no single way shows a rise', closedCrossings(fine, f, ways.map(w => w.path)).closed.length === 0);
  const r = closedCrossings(fine, f, ways);
  check('joined at their shared end points they are one stream, and the crossing is found', r.checked === 1 && r.closed.length === 1 && Math.abs(r.closed[0].pond - 4) < 0.02 && r.closed[0].name === 'Creek', `pond ${r.closed[0]?.pond.toFixed(2)} m`);
  const j = joinStreams([...ways].reverse());
  check('join: order given does not matter, one stream of three ways, headwater first', j.length === 1 && j[0].ways.join() === '2,1,0' && j[0].path[0] === path[0] && j[0].path.at(-1) === path[199]);
  // a tributary joining above the fill: both headwaters reach it, and it is listed once
  const trib = { path: Array.from({ length: 30 }, (_, n) => (J - 30 + n) * nx + 60), line: [[1, 5], [1, 0]], name: 'Trib' };
  const t = closedCrossings(fine, f, [...ways, trib]);
  check('a crossing reached from two headwaters is listed once', t.checked === 2 && t.closed.length === 1);
  check('join: ways with no line, and a loop, are left alone', joinStreams([path, { path: cut(0, 9), line: [[0, 0], [0, 0]] }]).length === 2);
}

{
  // the Briar Creek case (14 Nov 2026): open way, mapped culvert, open way. The culvert is its own way, drawn either direction
  const f = valley(g => fill(g, 90, 149, TOP, { road: true })), cut = (i0, i1) => path.slice(i0, i1 + 1);
  const ways = [{ path: cut(0, 88), line: [[0, 0], [1, 0]], name: 'Creek' }, { path: cut(151, 199), line: [[2, 0], [3, 0]], name: 'Creek' }];
  for (const [what, line] of [['with the flow', [[1, 0], [2, 0]]], ['against the flow', [[2, 0], [1, 0]]]]) {
    const cells = what === 'with the flow' ? cut(88, 151) : cut(88, 151).reverse();
    const r = closedCrossings(fine, f, ways, { culverts: [{ cells, line, D: 1.2, sized: false }] });
    check(`a mapped culvert drawn ${what} joins the ways either side, and its fill is found`, r.checked === 1 && r.closed.length === 0 && r.culverts.length === 1 && Math.abs(r.culverts[0].pond - 4) < 0.02 && r.culverts[0].culvert.D === 1.2);
  }
  check('without the culvert the two ways are separate and nothing is found', closedCrossings(fine, f, ways).checked === 2 && closedCrossings(fine, f, ways).closed.length === 0);
  check('a culvert joined to no stream is not walked as one', closedCrossings(fine, f, [], { culverts: [{ cells: cut(88, 151), line: [[7, 7], [8, 8]], D: 1 }] }).checked === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall crossings tests passed');
process.exit(fails ? 1 : 0);
