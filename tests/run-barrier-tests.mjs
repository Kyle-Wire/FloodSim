// Flood barrier tests: face rasterisation is watertight, water at rest stays at rest behind (and over) a crest, free
// overflow follows the weir equation, drowned flow is stable, volume is conserved through overtopping and a mid-run
// deployment, and the layer → solver builder (crest from height or elevation, berm fill, deployment times).
// Usage: node tests/run-barrier-tests.mjs
import { CPUSolver } from '../src/solver-cpu.js';
import { GridRef, fromUTM } from '../src/geo.js';
import { barrierFaces, buildBarriers, BarrierWatch } from '../src/barriers.js';
import { feature, layerInputs, toLayer, summarize } from '../src/infra.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

/** Cells reachable from (si, sj) by 4-neighbour steps that cross no face in the set. */
function reach(nx, ny, faces, si, sj) {
  const cut = new Set(faces.map(f => `${f.axis},${f.i},${f.j}`)), seen = new Uint8Array(nx * ny), st = [[si, sj]]; seen[sj * nx + si] = 1;
  while (st.length) {
    const [i, j] = st.pop();
    for (const [di, dj, key] of [[1, 0, `0,${i + 1},${j}`], [-1, 0, `0,${i},${j}`], [0, 1, `1,${i},${j + 1}`], [0, -1, `1,${i},${j}`]]) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || seen[jj * nx + ii] || cut.has(key)) continue;
      seen[jj * nx + ii] = 1; st.push([ii, jj]);
    }
  }
  return seen;
}
const insideRing = (r, x, y) => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xa, ya] = r[a], [xb, yb] = r[b]; if ((ya > y) !== (yb > y) && x < xa + (y - ya) / (yb - ya) * (xb - xa)) c = !c; } return c; };

// ---- rasterisation: a closed barrier ring seals its inside from the outside
{
  let leaks = 0, rings = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 200; n++) {
    const cx = 20 + rnd() * 10, cy = 20 + rnd() * 10, k = 3 + Math.floor(rnd() * 8), ring = [];
    for (let m = 0; m < k; m++) { const a = (m + rnd() * 0.8) / k * 2 * Math.PI, r = 4 + rnd() * 12; ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    ring.push(ring[0]); rings++;
    const seen = reach(50, 50, barrierFaces(ring, 50, 50), 0, 0);
    for (let j = 0; j < 50; j++) for (let i = 0; i < 50; i++) if (seen[j * 50 + i] && insideRing(ring, i + 0.5, j + 0.5)) { leaks++; break; }
  }
  check('closed barrier rings are watertight (200 random polygons)', leaks === 0, `${leaks} of ${rings} leaked`);
  const diag = barrierFaces([[-1, -0.3], [21, 20.6]], 20, 20), seen = reach(20, 20, diag, 19, 0);
  let other = 0; for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) if (seen[j * 20 + i] && j + 0.5 > (i + 0.5) * 20.9 / 22 + 0.65) other++;
  check('a diagonal wall has no corner-to-corner leaks', other === 0, `${diag.length} faces, ${other} cells reached across`);
  const ends = [...barrierFaces([[-3, 5.2], [13, 5.7]], 10, 10), ...barrierFaces([[5.3, -3], [5.6, 13]], 10, 10)];
  check('faces on the grid edge are left to the outfalls', ends.length >= 18 && ends.every(f => (f.axis ? f.j >= 1 && f.j <= 9 : f.i >= 1 && f.i <= 9)), `${ends.length} faces`);
}

// ---- solver: a straight wall across a 1D channel (walls N/S), bed 0
const chan = (crest, C = 1.6, nx = 60, ny = 3, dx = 2) => new CPUSolver({
  nx, ny, dx, z: new Float64Array(nx * ny), manning: 0.0, bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' },
  crest: crest == null ? [] : Array.from({ length: ny }, (_, j) => ({ i: nx / 2, j, axis: 0, z: crest, C })),
});
{
  const s = chan(1.0); s.setDepth((x) => (x < 60 ? 0.8 : 0));
  const v0 = s.volume(); s.run(300);
  let umax = 0, right = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 60; i++) { const c = s.idx(i, j); if (s.h[c] > 1e-6) umax = Math.max(umax, Math.abs(s.hu[c] / s.h[c])); if (i >= 30) right += s.h[c]; }
  const bk = s.readBarriers();
  check('lake at rest below the crest stays at rest', umax < 1e-9 && right === 0 && bk.plus[0] + bk.minus[0] === 0, `max |u| ${umax.toExponential(1)} m/s`);
  check('… and its volume is exact', Math.abs(s.volume() - v0) / v0 < 1e-12);
}
{
  const s = chan(1.0); s.setDepth(() => 1.5); s.run(300);
  let umax = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 60; i++) { const c = s.idx(i, j); umax = Math.max(umax, Math.abs(s.hu[c] / s.h[c])); }
  check('water at rest over a drowned crest stays at rest', umax < 1e-9, `max |u| ${umax.toExponential(1)} m/s`);
}
{ // free overflow from a long reservoir: unit discharge vs q = C·H^1.5 (H = upstream level over the crest)
  const C = 1.6, s = chan(1.0, C, 400, 1, 2); s.setDepth((x) => (x < 400 ? 1.5 : 0));
  s.run(60); const b0 = s.readBarriers().plus[0], t0 = s.t;
  let up = 0; for (let i = 180; i < 200; i++) up += s.h[s.idx(i, 0)]; up /= 20;
  s.run(80); const q = (s.readBarriers().plus[0] - b0) / (s.t - t0) / 2; // m³/s over a 2 m face → m²/s
  let up2 = 0; for (let i = 180; i < 200; i++) up2 += s.h[s.idx(i, 0)]; up2 /= 20;
  const H = 0.5 * (up + up2) - 1.0, qw = C * H ** 1.5;
  check('free overflow follows the weir equation', Math.abs(q / qw - 1) < 0.08, `q ${q.toFixed(3)} m²/s vs C·H^1.5 ${qw.toFixed(3)} (H ${H.toFixed(3)} m)`);
}
{ // drowned flow, both sides above the crest, small head difference: no oscillation, monotone approach to level
  const s = chan(1.0, 1.6, 40, 1, 2); s.setDepth((x) => (x < 40 ? 1.52 : 1.48));
  let flips = 0, last = null;
  for (let k = 0; k < 400; k++) { s.step(); const d = s.h[s.idx(19, 0)] - s.h[s.idx(20, 0)]; if (last != null && Math.sign(d) !== Math.sign(last) && Math.abs(d) > 1e-4) flips++; last = d; }
  check('drowned flow over a crest settles without flip-flopping', flips <= 2 && Math.abs(last) < 0.04, `${flips} sign changes, Δη ${last.toExponential(1)} m`);
}
{ // raising a barrier mid-run: nothing passes after it goes up, nothing is booked before, volume conserved
  const s = chan(-Infinity, 1.6, 60, 3, 2); s.setDepth((x) => (x < 40 ? 1.2 : 0)); const v0 = s.volume();
  const right = () => { let v = 0; for (let j = 0; j < 3; j++) for (let i = 30; i < 60; i++) v += s.h[s.idx(i, j)] * 4; return v; };
  s.run(20); const before = right(), booked = s.readBarriers().plus.reduce((a, b) => a + b, 0);
  s.setCrestLevels([5, 5, 5]); s.run(120);
  check('a barrier raised mid-run stops the flow', before > 1 && Math.abs(right() - before) < 1e-9 && booked === 0, `${before.toFixed(2)} m³ crossed while down (booked ${booked}), ${(right() - before).toExponential(1)} after`);
  check('… with the volume conserved', Math.abs(s.volume() - v0) / v0 < 1e-12, `rel ${((s.volume() - v0) / v0).toExponential(1)}`);
}
{ // books match the water that actually crossed
  const s = chan(1.0, 1.6, 60, 3, 2); s.setDepth((x) => (x < 60 ? 1.6 : 0)); s.run(40);
  let right = 0; for (let j = 0; j < 3; j++) for (let i = 30; i < 60; i++) right += s.h[s.idx(i, j)] * 4;
  const bk = s.readBarriers(), over = bk.plus.reduce((a, b) => a + b, 0) - bk.minus.reduce((a, b) => a + b, 0);
  check('barrier books equal the water that crossed', Math.abs(over - right) / right < 1e-9, `${over.toFixed(3)} vs ${right.toFixed(3)} m³`);
}

// ---- builder: layer → faces with crests, berm fill, deployment
{
  const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486100, y1: 4422100, dx: 1 }), nx = 100, ny = 100, N = nx * ny;
  const ll = (x, y) => fromUTM(486000 + x, 4422100 - y, 18);
  const z = new Float32Array(N); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 10 + 0.02 * i; // rising east
  const F = 2, c = { nx: 50, ny: 50, z: new Float64Array(2500), mask: new Uint8Array(2500).fill(1) };
  for (let J = 0; J < 50; J++) for (let I = 0; I < 50; I++) c.z[J * 50 + I] = 10 + 0.02 * (2 * I + 0.5);
  const lay = { type: 'FeatureCollection', features: [
    feature('wall', { type: 'LineString', coordinates: [ll(20, 10), ll(20, 90)] }),                                   // 3 ft above ground
    feature('wall', { type: 'LineString', coordinates: [ll(10, 50), ll(90, 50)] }, { mode: 'elev', crest: 11.5 }),
    feature('berm', { type: 'LineString', coordinates: [ll(60, 10), ll(60, 90)] }, { height: 1.5, topW: 6, slope: 3 }),
    feature('barrier', { type: 'LineString', coordinates: [ll(80, 10), ll(80, 90)] }, { deploy: 'time', deployAt: 30 }),
    feature('barrier', { type: 'LineString', coordinates: [ll(90, 10), ll(90, 90)] }, { deploy: 'none' }),
  ] };
  const inp = layerInputs(lay), z0 = c.z.slice(), b = buildBarriers(inp.barriers, g, { z }, c, F);
  const w0 = b.list[0], f0 = b.faces[w0.faces[0]];
  check('wall crest = lidar ground + height', Math.abs(f0.z - (10 + 0.02 * 20 + 0.9144)) < 0.03, `${f0.z.toFixed(3)} m`);
  check('fixed-elevation crest is level', b.list[1].crestMin === 11.5 && b.list[1].crestMax === 11.5);
  let raised = 0, top = -Infinity; for (let k = 0; k < 2500; k++) if (c.z[k] > z0[k] + 1e-9) { raised++; top = Math.max(top, c.z[k] - z0[k]); }
  check('berm fills its trapezoid into the bed', raised > 0 && top <= 1.5 + 0.1 && b.list[2].fill > 0, `${raised} cells, top ${top.toFixed(2)} m above ground, fill ${b.list[2].fill.toFixed(0)} m³`);
  check('deployment times: walls/berms from the start, set time, not deployed', b.list[0].deployAt === 0 && b.list[3].deployAt === 1800 && b.list[4].deployAt === null);
  const watch = new BarrierWatch(b, c.z);
  const L0 = watch.levels(0), L1 = watch.levels(1800);
  check('a timed barrier is down until its time, then up', L0[b.list[3].faces[0]] === -Infinity && L1[b.list[3].faces[0]] === b.faces[b.list[3].faces[0]].z && L1[b.list[4].faces[0]] === -Infinity);
  check('next deployment time', watch.next(0) === 1800 && watch.next(1800) === Infinity);
  const s = summarize(lay);
  check('summary counts barriers and their length', s.count.wall === 2 && s.count.berm === 1 && s.count.barrier === 2 && Math.abs(s.barrierLen - 400) < 1, `${s.barrierLen.toFixed(1)} m`);
}
{ // per-step books: freeboard, hydrostatic load, overtopping volume, first-overtopping time
  const mk = (z) => ({ i: 30, j: 0, axis: 0, z, C: 1.6, ground: 0 });
  const s = new CPUSolver({ nx: 60, ny: 1, dx: 2, z: new Float64Array(60), manning: 0, bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' }, crest: [mk(1.0)] });
  s.setDepth((x) => (x < 60 ? 0.6 : 0)); s.run(30);
  const built = { faces: [{ ...mk(1.0), bar: 0, a: 29, b: 30 }], list: [{ id: 1, type: 'wall', faces: [0], deployAt: 0, length: 2 }] };
  const watch = new BarrierWatch(built, new Float64Array(60), 2); watch.books(s.t, s.readBarriers()); const r = watch.results()[0];
  check('freeboard = crest − highest water against it (every step)', Math.abs(r.minFreeboard - 0.4) < 0.01 && r.maxLevel > 0.59, `${r.minFreeboard.toFixed(3)} m`);
  check('hydrostatic load ½ρgd² per metre at its peak', Math.abs(r.peakLoad - 0.5 * 9.81 * r.maxLevel ** 2) < 0.02 && !r.overtopped && r.overVol === 0, `${r.peakLoad.toFixed(2)} kN/m at ${r.tLoad?.toFixed(1)} s`);
}
{ // the books count water over the crest only: a drowned-out film and an undeployed barrier book nothing
  const s = new CPUSolver({ nx: 60, ny: 1, dx: 2, z: new Float64Array(60), manning: 0, bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' },
    crest: [{ i: 30, j: 0, axis: 0, z: 1.0, C: 1.6, ground: 0 }, { i: 50, j: 0, axis: 0, z: -Infinity, C: 1.6, ground: 0 }] });
  s.setDepth((x) => (x < 60 ? 1.4 : 0)); s.run(60);
  let right = 0; for (let i = 30; i < 60; i++) right += s.h[s.idx(i, 0)] * 4;
  const bk = s.readBarriers(), over = bk.plus[0] - bk.minus[0];
  check('overtopping volume = water that went over', Math.abs(over - right) / right < 0.01 && bk.tOver[0] >= 0 && bk.tOver[0] < 1 && bk.peak[0] > 0, `${over.toFixed(2)} vs ${right.toFixed(2)} m³ from ${bk.tOver[0].toFixed(2)} s, peak ${bk.peak[0].toFixed(3)} m²/s`);
  check('a barrier that is not up books nothing', bk.plus[1] === 0 && bk.minus[1] === 0 && Number.isNaN(bk.tOver[1]) && bk.level[1] === -Infinity);
}
{ // import: a levee shapefile's lines become berms with their crest elevations
  const items = [{ name: 'county_levees', kind: 'line', coords: [[-75, 40], [-75.001, 40.001]], props: { CREST_EL: 32.5 } }];
  const { features } = toLayer(items, { elevUnits: 'ft' });
  check('imported levee lines become berms with crest elevations', features[0].properties.type === 'berm' && features[0].properties.mode === 'elev' && Math.abs(features[0].properties.crest - 32.5 * 0.3048) < 1e-9);
}

console.log(fails ? `\n${fails} FAILED` : '\nall barrier tests passed');
process.exit(fails ? 1 : 0);
