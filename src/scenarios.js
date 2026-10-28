// Scenario generators shared by the app and the test suites. Units: metres, seconds.
import { thackerPlanar } from './analytic.js';

export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export const MMHR = 1 / 1000 / 3600;

// classes: 0 street, 1 lawn, 2 park, 3 channel bed, 4 building, 5 sand, 6 meadow
export function cloudburst(n) {
  const L = 320, nx = n, ny = n, dx = L / n, N = nx * ny;
  const z = new Float64Array(N), mask = new Uint8Array(N).fill(1), man = new Float64Array(N), inf = new Float64Array(N);
  const bld = new Float32Array(N), cls = new Uint8Array(N);
  const rnd = rng(11), sw = 10, streets = [40, 120, 200, 280];
  const creekY = (x) => 160 + 34 * Math.sin(x / 58 + 0.6);
  const edges = [0, ...streets, L];
  const rects = [];
  let parkBlock = null;
  for (let bi = 0; bi < edges.length - 1; bi++) for (let bj = 0; bj < edges.length - 1; bj++) {
    const x0 = edges[bi] + (bi ? sw / 2 + 3 : 3), x1 = edges[bi + 1] - (bi + 1 < edges.length - 1 ? sw / 2 + 3 : 3);
    const y0 = edges[bj] + (bj ? sw / 2 + 3 : 3), y1 = edges[bj + 1] - (bj + 1 < edges.length - 1 ? sw / 2 + 3 : 3);
    if (bi === 1 && bj === 3) { parkBlock = [x0, x1, y0, y1]; continue; }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    for (const [lx0, lx1] of [[x0, mx - 2], [mx + 2, x1]]) for (const [ly0, ly1] of [[y0, my - 2], [my + 2, y1]]) {
      const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2;
      if (Math.abs(cy - creekY(cx)) < 22) continue;
      const ix = 1 + rnd() * 4, iy = 1 + rnd() * 4;
      rects.push([lx0 + ix, lx1 - ix * 0.6, ly0 + iy, ly1 - iy * 0.6, 4 + Math.round(rnd() * 4) * 2.5]);
    }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = (i + 0.5) * dx, y = (j + 0.5) * dx;
    const smooth = 12 - 0.012 * x + 0.000035 * (y - 160) ** 2;
    let zz = smooth + 0.5 * Math.sin(x / 37 + 1.3) * Math.sin(y / 29 + 0.4) + 0.25 * Math.sin(x / 13 + 2) * Math.cos(y / 17);
    let c = 1, nn = 0.035, f = 12 * MMHR;
    if (parkBlock && x > parkBlock[0] && x < parkBlock[1] && y > parkBlock[2] && y < parkBlock[3]) { c = 2; nn = 0.05; f = 25 * MMHR; }
    if (streets.some(s => Math.abs(x - s) < sw / 2 || Math.abs(y - s) < sw / 2)) { zz -= 0.15; c = 0; nn = 0.016; f = 0; }
    const yc = creekY(x), d = Math.abs(y - yc);
    if (d < 7) {
      const bed = 12 - 0.012 * x + 0.000035 * (yc - 160) ** 2 - 1.6;
      zz = Math.min(zz, bed + (zz - bed) * (d / 7) ** 2); c = 3; nn = 0.03; f = 4 * MMHR;
    }
    for (const r of rects) if (x > r[0] && x < r[1] && y > r[2] && y < r[3]) { mask[k] = 0; bld[k] = r[4]; c = 4; break; }
    z[k] = zz; man[k] = nn; inf[k] = f; cls[k] = c;
  }
  return {
    nx, ny, dx, z, mask, manning: man, infil: inf, bld, cls, bc: { east: 'open' }, rain: true,
    init: (s) => s.setDepth(() => 0), speed: 60, exag: 2, hmin: 0.01,
    desc: 'A 320 m urban catchment draining east: streets set 15 cm below their lots, a meandering creek, buildings as walls, and a park that soaks up more rain. Rain falls on every open cell.',
  };
}

export function dambreak(n) {
  const ny = n, nx = 2 * n, Lx = 480, dx = Lx / nx, N = nx * ny;
  const z = new Float64Array(N), mask = new Uint8Array(N).fill(1), man = new Float64Array(N).fill(0.03);
  const bld = new Float32Array(N), cls = new Uint8Array(N).fill(6), rnd = rng(5);
  const rects = [];
  for (let bx = 236; bx < 400; bx += 26) for (let by = 30; by < 214; by += 22) {
    if (Math.abs(by + 5 - 120) < 12) continue;
    if (rnd() < 0.18) continue;
    rects.push([bx, bx + 12 + rnd() * 4, by, by + 9 + rnd() * 3, 4 + Math.round(rnd() * 3) * 2.5]);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = (i + 0.5) * dx, y = (j + 0.5) * dx;
    z[k] = 6 - 0.006 * x + 0.00028 * (y - 120) ** 2 + 0.15 * Math.sin(x / 23) * Math.sin(y / 19);
    if (x < 70) cls[k] = 3;
    if (Math.abs(y - 120) < 6 && x > 200) { cls[k] = 0; man[k] = 0.016; }
    for (const r of rects) if (x > r[0] && x < r[1] && y > r[2] && y < r[3]) { mask[k] = 0; bld[k] = r[4]; cls[k] = 4; break; }
  }
  return {
    nx, ny, dx, z, mask, manning: man, infil: null, bld, cls, bc: { east: 'open' }, rain: false,
    init: (s) => s.setDepth((x, y, zz) => (x < 70 ? 13.5 - zz : 0)), speed: 4, exag: 1.5, hmin: 0.02, tMax: 600,
    desc: 'An 8 m reservoir released instantly into a valley with a small town 160 m downstream. Tests shock capturing, wet/dry fronts, and flow around buildings.',
  };
}

export function thacker(n) {
  const T = thackerPlanar(), nx = n, ny = n, dx = T.L / n, N = nx * ny;
  const z = new Float64Array(N), cls = new Uint8Array(N).fill(5);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = T.bed((i + 0.5) * dx, (j + 0.5) * dx);
  return {
    nx, ny, dx, z, mask: null, manning: 0, infil: null, bld: new Float32Array(N), cls, bc: {}, rain: false, analytic: T,
    init: (s) => { s.setDepth((x, y) => T.depth(x, y, 0)); s.setVelocity(() => T.vel(0)); }, speed: 1, exag: 3, hmin: 0.001, hfront: 1e-4, camPhi: 0.6, camR: 1.1,
    desc: `Thacker's planar surface sloshing in a frictionless paraboloid, period ${T.period.toFixed(2)} s. It has an exact solution with a moving shoreline, so the error readout is a live check.`,
  };
}
export const SCENARIOS = { cloudburst, dambreak, thacker };
