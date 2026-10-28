// Phase 2 tests: river / culvert hydraulics, conservative culvert bookkeeping, channel breaching, the SWMM river model.
// Usage: node tests/run-phase2-tests.mjs
import { weirFlow, culvertFlow, bankStations, riverINP } from '../src/river.js';
import { CulvertLinks } from '../src/links.js';
import { breachChannels, culvertDiameter } from '../src/channels.js';
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
  check('a hump with no road is left alone', r2.breaches === 0 && z2[9 * nx + 42] > 12, 'banks the mapped line wanders onto are real terrain');
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
