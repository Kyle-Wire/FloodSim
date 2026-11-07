// Phase 2 tests: river / culvert hydraulics, conservative culvert bookkeeping, channel breaching, the SWMM river model.
// Usage: node tests/run-phase2-tests.mjs
import { weirFlow, culvertFlow, bankStations, riverINP } from '../src/river.js';
import { CulvertLinks } from '../src/links.js';
import { breachChannels, culvertDiameter, culvertLinks, mappedCells, snapThalweg } from '../src/channels.js';
import { GridRef } from '../src/geo.js';
import { loadSWMM, SWMM } from '../src/swmm.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- weir: free flow C·L·H^1.5, sign by direction, Villemonte drowning, nothing below the crest
{
  const free = weirFlow(11, 9, 10, 20), back = weirFlow(9, 11, 10, 20), drowned = weirFlow(11, 10.9, 10, 20);
  check('weir free flow = 1.7·L·H^1.5', near(free, 1.7 * 20, 1e-9) && near(back, -free, 1e-12), `${free.toFixed(2)} m³/s`);
  check('weir drowned flow reduced, zero below crest', drowned > 0 && drowned < 0.5 * free && weirFlow(9.9, 9, 10, 20) === 0 && weirFlow(10.5, 10.5, 10, 20) === 0, `${drowned.toFixed(2)} m³/s at 90% submergence`);
}

// ---- culvert: zero below the invert, inlet control part full, full-barrel losses when submerged, monotone in head
{
  const c = { inv: 0, D: 1, len: 20, n: 0.015 };
  const q = [0.2, 0.5, 1, 2, 4].map(H => culvertFlow(H, -5, c));
  check('culvert zero below invert', culvertFlow(-0.1, -1, c) === 0 && culvertFlow(1, 1, c) === 0);
  check('culvert flow rises with head', q.every((v, i) => !i || v > q[i - 1]), q.map(v => v.toFixed(2)).join(' → ') + ' m³/s');
  const full = culvertFlow(3, 1.5, c), A = Math.PI / 4, k = 1 + 0.5 + 2 * 9.81 * 0.015 ** 2 * 20 / (0.25) ** (4 / 3);
  check('culvert submerged = orifice with losses', near(full, A * Math.sqrt(2 * 9.81 * 1.5 / k), 1e-9), `${full.toFixed(3)} m³/s on 1.5 m head`);
}

// ---- culvert links: what leaves upstream arrives downstream (one interval later), exactly, even when the source runs dry
{
  const zs = new Float64Array(4).fill(0), L = new CulvertLinks([{ a: 0, b: 3, inv: 0, D: 1, len: 10 }], zs, { cellArea: 100 });
  // a fake surface: cell depths, applying rates with the solver's rule (never take more than the cell holds)
  const h = [2, 0], A = 100, dt = 2; let moved = 0, delivered = 0;
  let q = L.step(new Float64Array(2), Float32Array.from(h), dt);
  for (let it = 0; it < 400; it++) {
    const vol = new Float64Array(2);
    for (let m = 0; m < 2; m++) { const want = q[m] * dt / A, dd = Math.min(want, h[m]); h[m] -= dd; vol[m] = dd * A; if (dd > 0) moved += dd * A; else delivered -= dd * A; }
    q = L.step(vol, Float32Array.from(h), dt);
  }
  const inTransit = L.pending.reduce((a, p) => a + p.vol, 0), total = (h[0] + h[1]) * A + inTransit;
  check('culvert links conserve water', near(total, 200, 1e-6) && near(moved - delivered, inTransit, 1e-6), `stored ${((h[0] + h[1]) * A).toFixed(3)} + in transit ${inTransit.toFixed(3)} = ${total.toFixed(6)} m³`);
  check('culvert links equalise levels', Math.abs(h[0] - h[1]) < 0.05, `upstream ${h[0].toFixed(3)} m, downstream ${h[1].toFixed(3)} m`);
}

// ---- channel breaching: a 6 m embankment hump across a mapped stream is cut, a long ridge is not
{
  const fine = new GridRef({ zone: 18, x0: 0, y0: 0, x1: 100, y1: 20, dx: 1 }), nx = 100, ny = 20;
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 10 - 0.01 * i + (i >= 40 && i < 46 ? 2.5 : 0);
  const f = { nx, ny, z, bld: new Uint8Array(nx * ny), road: new Uint8Array(nx * ny) };
  for (let j = 0; j < ny; j++) for (let i = 40; i < 46; i++) f.road[j * nx + i] = 1; // the hump is a road embankment
  // a line along row 10 from west to east (lon/lat → cells via the grid; build it from UTM points)
  const { fromUTM } = await import('../src/geo.js');
  const line = [[0.5, 9.5], [99.5, 9.5]].map(([x, y]) => fromUTM(x, fine.y1 - y, 18));
  const r = breachChannels(fine, f, [{ line, kind: 'stream' }]);
  const row = Array.from({ length: nx }, (_, i) => z[9 * nx + i]); // the line runs along row 9
  check('road embankment over a stream breached to grade', r.breaches === 1 && row.every((v, i) => !i || v <= row[i - 1] + 1e-4), `${r.cells} cells, ${r.volume.toFixed(1)} m³ cut`);
  check('rows off the stream untouched', z[2 * nx + 42] > 12, `${z[2 * nx + 42].toFixed(2)} m`);
  const z2 = new Float32Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z2[j * nx + i] = 10 - 0.01 * i + (i >= 40 && i < 46 ? 2.5 : 0);
  const r2 = breachChannels(fine, { nx, ny, z: z2, bld: new Uint8Array(nx * ny), road: new Uint8Array(nx * ny) }, [{ line, kind: 'stream' }]);
  check('a 2.5 m hump with no road is left alone', r2.breaches === 0 && r2.fills === 0 && z2[9 * nx + 42] > 12, 'too high for a fill: real terrain');
}
// ---- thalweg: an NHD-style line on the bank snaps into the channel; a full-width hump on the channel is cut, one the
// channel goes round is not
{
  const { fromUTM } = await import('../src/geo.js');
  const nx = 120, ny = 40, fine = new GridRef({ zone: 18, x0: 0, y0: 0, x1: nx, y1: ny, dx: 1 });
  // a valley falling east 0.5 %: a 4 m wide bed (rows 18-21) 1.5 m below a floodplain bank, rising 0.3 m per row beyond
  const valley = () => {
    const z = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const off = Math.max(0, Math.abs(j - 19.5) - 2); z[j * nx + i] = 210 - 0.005 * i + (off ? 1.5 + 0.3 * off : 0); }
    return z;
  };
  const model = (z) => ({ nx, ny, z, bld: new Uint8Array(nx * ny), road: new Uint8Array(nx * ny) });
  const line = [[0.5, 11.5], [119.5, 11.5]].map(([x, y]) => fromUTM(x, fine.y1 - y, 18)); // drawn on the bank, 8 m off
  const f0 = model(valley()), mp = mappedCells(fine, f0, line), s = snapThalweg(fine, f0, mp);
  const rows = s.path.map(k => (k / nx) | 0), inBed = rows.filter(j => j >= 18 && j <= 21).length / rows.length;
  check('a line on the bank snaps into the channel', mp.every(k => ((k / nx) | 0) === 11) && inBed > 0.9 && s.path[0] % nx === 0 && s.path[s.path.length - 1] % nx === nx - 1,
    `${(inBed * 100).toFixed(0)} % of the snapped path in the bed, mean ${s.offset.toFixed(1)} m off the mapped line`);
  // a bridge-deck hump across the whole valley floor (bed and the floodplain beside it, 1.2 m above the bed, 12 m long,
  // no road) at columns 60-71: water cannot get round it in the 15 m corridor
  const humped = () => { const z = valley(); for (let j = 0; j < ny; j++) for (let i = 60; i < 72; i++) z[j * nx + i] = Math.max(z[j * nx + i], 210 - 0.005 * i + 1.2); return z; };
  const z1 = humped();
  const f1 = model(z1), r1 = breachChannels(fine, f1, [{ line, kind: 'stream' }]);
  const bed = Array.from({ length: nx }, (_, i) => Math.min(...[18, 19, 20, 21].map(j => z1[j * nx + i]))); // lowest across the bed
  check('a full-width hump on the snapped path is cut', r1.fills === 1 && r1.breaches === 0 && bed.every((v, i) => !i || v <= bed[i - 1] + 1e-4),
    `${r1.cells} cells, ${r1.volume.toFixed(1)} m³; crest ${r1.cuts[0]?.crest.toFixed(2)} m over a ${r1.cuts[0]?.foot.toFixed(2)} m foot`);
  check('…3 m wide, and the bank under the mapped line untouched', [-1, 0, 1].every(d => z1[(rows[65] + d) * nx + 65] < 210) && z1[11 * nx + 65] > 211, `bank ${z1[11 * nx + 65].toFixed(2)} m`);
  const r0 = breachChannels(fine, model(humped()), [{ line, kind: 'stream' }], { snap: false });
  check('…which the mapped line alone never sees', r0.fills === 0 && r0.breaches === 0, 'on the bank the hump is level ground');
  // the same hump over the bed only, with a side channel round its north end (rows 14-15, bed level): the channel goes
  // round it, so the snapped path does too and the hump stays
  const z2 = valley();
  for (let i = 60; i < 72; i++) { for (let j = 16; j < 24; j++) z2[j * nx + i] = 210 - 0.005 * i + 1.2; for (let j = 14; j <= 17; j++) z2[j * nx + i] = 210 - 0.005 * i; }
  for (let i = 56; i < 76; i++) for (let j = 14; j <= 17; j++) z2[j * nx + i] = Math.min(z2[j * nx + i], 210 - 0.005 * i); // the side channel
  const keep = z2.slice(), f2 = model(z2), r2 = breachChannels(fine, f2, [{ line, kind: 'stream' }]);
  check('a hump the channel goes round is not cut', r2.fills === 0 && r2.breaches === 0 && [18, 19, 20, 21].every(j => z2[j * nx + 65] === keep[j * nx + 65]),
    `path round it on rows ${[...new Set(r2.paths[0].filter(k => k % nx >= 60 && k % nx < 72).map(k => (k / nx) | 0))].join(', ')}`);
  const bedLine = [[0.5, 19.5], [119.5, 19.5]].map(([x, y]) => fromUTM(x, fine.y1 - y, 18)), z5 = keep.slice();
  const r5 = breachChannels(fine, model(z5), [{ line: bedLine, kind: 'stream' }], { snap: false }); // a path forced over it
  check('…even by a path that crosses it', r5.fills === 0 && z5[19 * nx + 65] === keep[19 * nx + 65], 'water gets round it at bed level');
  // a riffle 0.3 m high across the bed, and a 3 m high ridge: terrain, both kept
  const z3 = valley(); for (let j = 0; j < ny; j++) for (let i = 60; i < 66; i++) z3[j * nx + i] += 0.3;
  const z4 = valley(); for (let j = 0; j < ny; j++) for (let i = 50; i < 70; i++) z4[j * nx + i] = Math.max(z4[j * nx + i], 213);
  const r3 = breachChannels(fine, model(z3), [{ line, kind: 'stream' }]), r4 = breachChannels(fine, model(z4), [{ line, kind: 'stream' }]);
  check('riffles and ridges are kept', r3.fills === 0 && r4.fills === 0 && r3.cells === 0 && r4.cells === 0);
}
// ---- culvert ends: a mapped culvert ending on the embankment shoulders takes the creek bed on each side, not the road
{
  const { fromUTM } = await import('../src/geo.js');
  const fine = new GridRef({ zone: 18, x0: 0, y0: 0, x1: 60, y1: 20, dx: 1 }), nx = 30, ny = 10, F = 2; // 2 m solver cells
  const z = new Float32Array(nx * ny), mask = new Uint8Array(nx * ny).fill(1);
  // a creek along row 5 falling east (bed 10 - 0.02 x), 1.5 m banks either side, and a road embankment 4 m high
  // over columns 12-17 (24-36 m) that slopes down to the bed over two cells each side
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const bed = 10 - 0.02 * i * F, emb = i >= 12 && i <= 17 ? 4 : i === 11 || i === 18 ? 2.6 : i === 10 || i === 19 ? 1.2 : 0;
    z[j * nx + i] = bed + Math.max(emb, j === 5 ? 0 : 1.5);
  }
  const line = [[21, 11], [37, 11]].map(([x, y]) => fromUTM(x, fine.y1 - y, 18)); // ends 1-3 m up the embankment slopes
  const [lk] = culvertLinks(fine, { nx, ny, z, mask }, F, [{ line, kind: 'stream', D: 1.2 }]);
  const bedA = z[5 * nx + 9], bedB = z[5 * nx + 20];
  check('culvert ends on the creek bed, not the embankment', lk && lk.a % nx <= 10 && lk.b % nx >= 19 && Math.abs(lk.inv - Math.max(z[lk.a], z[lk.b])) < 1e-6 && lk.inv < bedA + 0.05,
    lk ? `invert ${lk.inv.toFixed(2)} m (bed ${bedA.toFixed(2)} / ${bedB.toFixed(2)} m; embankment ends ${z[5 * nx + 10].toFixed(2)} / ${z[5 * nx + 18].toFixed(2)} m)` : 'no link');
  const [near] = culvertLinks(fine, { nx, ny, z, mask }, F, [{ line, kind: 'stream', D: 1.2 }], new Set(), { reach: 0 });
  check('…which a one-cell search misses', near && near.inv > bedA + 0.5, near ? `invert ${near.inv.toFixed(2)} m searching one cell` : 'no link');
}
check('culvert size from tags', culvertDiameter({ diameter: '600' }) === 0.6 && culvertDiameter({ diameter: '1.5' }) === 1.5 && culvertDiameter({}, 'ditch') === 0.6);

// ---- bank stations: a channel with berms splits at the berm edges
{
  const pts = [[0, 5], [10, 4.9], [20, 4.8], [22, 1], [40, 0], [58, 1], [60, 4.8], [70, 4.9], [80, 5]];
  const [l, r] = bankStations(pts);
  check('bank stations at the berm edges', l >= 20 && l <= 22 && r >= 58 && r <= 60, `${l}–${r} m`);
}

// ---- SWMM river: a prismatic channel at steady flow reaches normal depth, mass closes
{
  const S = 0.0005, n = 0.03, Q = 50, B = 30, secs = [];
  for (let i = 0; i <= 20; i++) secs.push({ name: 'X' + String(i).padStart(2, '0'), dist: 200, x: i * 200, y: 0, pts: [[0, 8 - i * 200 * S], [0.01, -i * 200 * S], [B, -i * 200 * S], [B + 0.01, 8 - i * 200 * S]] });
  // normal depth for a wide rectangular channel (iterate Manning with R = A/P)
  let y = 1; for (let it = 0; it < 60; it++) { const A = B * y, P = B + 2 * y; y = Math.pow(Q * n / (B * Math.sqrt(S)) * Math.pow(P / B, 2 / 3), 3 / 5); }
  const zEnd = -20 * 200 * S, rating = []; for (let d = 0; d <= 6; d += 0.25) { const A = B * d, P = B + 2 * d; rating.push([d ? A * Math.pow(A / P, 2 / 3) * Math.sqrt(S) / n : 0, zEnd + d]); }
  const inp = riverINP(secs, { inflow: [[0, Q], [86400, Q]], rating, n, initWL: null, durationS: 6 * 3600, wallTop: 12 });
  const swmm = await loadSWMM(); swmm.open(inp);
  swmm.stepTo(6 * 3600);
  const i10 = swmm.index('NODE', 'X10'), depth = swmm.node('HEAD', i10) - (-10 * 200 * S);
  const rpt = swmm.finish(), cont = SWMM.continuity(rpt);
  check('SWMM river reaches normal depth', near(depth, y, 0.03), `${depth.toFixed(3)} m vs Manning ${y.toFixed(3)} m`);
  check('SWMM river continuity', Math.abs(cont.errorPct) < 0.5, `${cont.errorPct} %`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
