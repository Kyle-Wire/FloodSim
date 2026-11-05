// The FloodSim mark: the SPARC Labs wireframe cube with live water floating inside it. The water is a small 2D wave
// model (damped wave equation on a 15 × 15 grid, reflecting edges) over a slow swell; a pointer drags ripples through
// it, a click drops a splash, and it rains while a run is playing. Two looks: 'sheet' (the surface with its dashed mesh,
// as the printed logo) and 'voxel' (the same surface quantized into floating cubes). Canvas 2D, isometric.
//   mountLogo(canvas, { mode, tint, rainWhile, interactive }) → { set({ mode, tint }), drop(u, v, a), frame() }
// Reduced motion: one still frame of the swell, no animation.

const N = 15, A = 0.06, B = 0.94;          // grid points per side; the water spans [A, B] of the cube in x and y
const Z0 = 0.5, AMP = 0.2, THICK = 0.12;  // mid height, wave height, sheet thickness (cube units)
const MESH = 2;                            // a mesh line every MESH grid points (every 7 when small: a cross)
const COS = Math.cos(Math.PI / 6), SIN = 0.5;

/** The swell under the ripples (the printed logo's shape, drifting): height in −1…1 at grid point (i, j), time t (s). */
const swell = (i, j, t) => {
  const u = i / (N - 1), v = j / (N - 1);
  return 0.55 * Math.sin(2 * Math.PI * (0.8 * u + 0.35 * v) - 0.7 * t) + 0.35 * Math.sin(2 * Math.PI * (1.1 * v - 0.3 * u) + 0.5 * t + 1.3);
};

export function mountLogo(canvas, { mode = 'sheet', tint = true, rainWhile = null, interactive = true } = {}) {
  const ctx = canvas.getContext('2d');
  const h = new Float32Array(N * N), vel = new Float32Array(N * N), lap = new Float32Array(N * N);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0, last = performance.now(), raf = 0, W = 0, H = 0, s = 0, cx = 0, cy = 0, lw = 1, dpr = 1;
  const opts = { mode, tint };

  function size() {
    dpr = Math.min(3, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect(); W = Math.max(8, r.width); H = Math.max(8, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    lw = Math.max(1.4, Math.min(W / 1.732, H / 2) * 0.042);
    s = Math.min(W / (2 * COS), H / 2) - lw; cx = W / 2; cy = H / 2;
  }
  const P = (x, y, z) => [cx + (x - y) * s * COS, cy + (x + y) * s * SIN - z * s];
  const ink = () => getComputedStyle(canvas).color || '#1a1416';
  const paper = () => { const c = getComputedStyle(canvas).getPropertyValue('--logo-paper').trim(); return c || '#ffffff'; };

  /** A drop at grid (u, v) in 0…1, amount a (positive pushes the water down). */
  function drop(u, v, a = 1) {
    const ci = u * (N - 1), cj = v * (N - 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d2 = (i - ci) ** 2 + (j - cj) ** 2; if (d2 < 4) vel[j * N + i] -= a * 2.2 * Math.exp(-d2);
    }
  }
  function step(dt) {
    const c2 = 60, damp = Math.exp(-1.6 * dt);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, at = (ii, jj) => h[Math.min(N - 1, Math.max(0, jj)) * N + Math.min(N - 1, Math.max(0, ii))];
      lap[k] = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1) - 4 * h[k];
    }
    for (let k = 0; k < N * N; k++) { vel[k] = (vel[k] + c2 * lap[k] * dt - 6 * h[k] * dt) * damp; h[k] += vel[k] * dt; }
  }
  /** Height of the water at grid point (i, j) in cube units. */
  const zAt = (i, j) => Z0 + AMP * (0.9 * swell(i, j, t) + Math.max(-1.4, Math.min(1.4, h[j * N + i])));
  const gx = (i) => A + (B - A) * i / (N - 1);

  // ---- drawing
  function poly(pts, fill, stroke, width = lw, dash = null) {
    ctx.beginPath(); pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash ?? []); ctx.stroke(); ctx.setLineDash([]); }
  }
  function line(a, b, stroke, width = lw, dash = null) {
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash ?? []); ctx.stroke(); ctx.setLineDash([]);
  }
  /** Water colour lit by a surface normal (from slopes dzdx, dzdy) or a face's own light 0…1. */
  function shade(light, alpha = 1) {
    if (!opts.tint) return paper();
    const l = Math.max(0, Math.min(1, light));
    const r = Math.round(150 + 95 * l), g = Math.round(205 + 45 * l), b = Math.round(235 + 18 * l);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const lightOf = (dzdx, dzdy) => { const nx = -dzdx, ny = -dzdy, n = Math.hypot(nx, ny, 1); return 0.55 + 0.9 * ((-0.5 * nx - 0.35 * ny + 0.8) / n - 0.55); };

  function cube(stroke, front) {
    const C = (x, y, z) => P(x, y, z);
    const edges = front
      ? [[[1, 1, 1], [1, 0, 1]], [[1, 1, 1], [0, 1, 1]], [[1, 1, 1], [1, 1, 0]], // the near corner's three edges, over the water
        [[0, 0, 1], [1, 0, 1]], [[0, 0, 1], [0, 1, 1]], [[1, 0, 1], [1, 0, 0]], [[0, 1, 1], [0, 1, 0]], [[1, 0, 0], [1, 1, 0]], [[0, 1, 0], [1, 1, 0]]]
      : [[[0, 0, 0], [0, 0, 1]], [[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]]]; // the far corner's, behind it
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [a, b] of edges) line(C(...a), C(...b), stroke);
  }

  function sheet(stroke) {
    const Z = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Z[j * N + i] = zAt(i, j);
    const pt = (i, j, dz = 0) => P(gx(i), gx(j), Z[j * N + i] + dz);
    const big = W > 90, M = big ? MESH : 7, thin = big ? Math.max(0.8, lw * 0.32) : 0.6, dash = big ? [lw * 0.9, lw * 0.9] : null;
    // the surface, far quads first (x + y grows toward the viewer); each quad restrokes its own mesh edges
    for (let d = 0; d <= 2 * (N - 2); d++) for (let i = Math.max(0, d - (N - 2)); i <= Math.min(N - 2, d); i++) {
      const j = d - i, k = j * N + i;
      const dzdx = (Z[k + 1] - Z[k] + Z[k + N + 1] - Z[k + N]) / 2 / ((B - A) / (N - 1));
      const dzdy = (Z[k + N] - Z[k] + Z[k + N + 1] - Z[k + 1]) / 2 / ((B - A) / (N - 1));
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      poly(q, shade(lightOf(dzdx, dzdy)), null);
      if (j % M === 0) line(q[0], q[1], stroke, thin, dash);
      if ((j + 1) % M === 0) line(q[3], q[2], stroke, thin, dash);
      if (i % M === 0) line(q[0], q[3], stroke, thin, dash);
      if ((i + 1) % M === 0) line(q[1], q[2], stroke, thin, dash);
    }
    // the far rims, then the two near sides hanging THICK below the surface
    ctx.lineJoin = 'round';
    const rim = (pts) => { ctx.beginPath(); pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.strokeStyle = stroke; ctx.lineWidth = lw * 0.75; ctx.stroke(); };
    rim([...Array(N).keys()].map(i => pt(i, 0))); rim([...Array(N).keys()].map(j => pt(0, j)));
    const side = (at) => { // at(n) → [i, j] along the near edge
      const top = [...Array(N).keys()].map(n => pt(...at(n))), bot = [...Array(N).keys()].map(n => pt(...at(n), -THICK)).reverse();
      poly([...top, ...bot], shade(0.25, 0.97), stroke, lw * 0.75);
    };
    side(n => [N - 1, n]); side(n => [n, N - 1]);
  }

  function voxels(stroke) {
    const M = 6, d = (B - A) / M, thin = Math.max(0.8, lw * 0.4);
    const cols = [];
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const gi = Math.round((i + 0.5) / M * (N - 1)), gj = Math.round((j + 0.5) / M * (N - 1));
      const z = Math.round((zAt(gi, gj) - Z0) / (d * 0.5)) * d * 0.5 + Z0; // the voxel's top, quantized to half a voxel
      cols.push({ i, j, z });
    }
    cols.sort((a, b) => a.i + a.j - (b.i + b.j) || a.z - b.z);
    for (const { i, j, z } of cols) { // one voxel per column: a floating, stepped sheet
      const x0 = A + i * d, y0 = A + j * d, x1 = x0 + d, y1 = y0 + d, z1 = z, z0 = z - d;
      poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], shade(0.95), stroke, thin);        // top
      poly([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], shade(0.55), stroke, thin);        // near left
      poly([P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0)], shade(0.3), stroke, thin);         // near right
    }
  }

  function frame() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const stroke = ink();
    cube(stroke, false);
    (opts.mode === 'voxel' ? voxels : sheet)(stroke);
    cube(stroke, true);
  }
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (rainWhile?.() && Math.random() < dt * 6) drop(Math.random(), Math.random(), 0.5 + Math.random() * 0.5);
    for (let n = 0; n < 2; n++) step(dt / 2);
    frame(); raf = requestAnimationFrame(tick);
  }

  // ---- the pointer: where it crosses the water's mid plane, in grid units
  const toGrid = (e) => {
    const r = canvas.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
    const a = (X - cx) / (s * COS), b = (Y - cy + Z0 * s) / (s * SIN); // a = x − y, b = x + y
    const x = (a + b) / 2, y = (b - a) / 2;
    return [(x - A) / (B - A), (y - A) / (B - A)];
  };
  let lastPt = null;
  if (interactive && !still) {
    canvas.addEventListener('pointermove', (e) => {
      const [u, v] = toGrid(e), now = performance.now();
      if (lastPt && u > -0.1 && u < 1.1 && v > -0.1 && v < 1.1) {
        const speed = Math.hypot(u - lastPt[0], v - lastPt[1]) / Math.max(0.008, (now - lastPt[2]) / 1000);
        drop(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)), Math.min(0.6, speed * 0.05));
      }
      lastPt = [u, v, now];
    });
    canvas.addEventListener('pointerleave', () => { lastPt = null; });
    canvas.addEventListener('pointerdown', (e) => { const [u, v] = toGrid(e); drop(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)), 2.2); });
  }
  new ResizeObserver(() => { size(); frame(); }).observe(canvas);
  size();
  if (still) { t = 2.2; frame(); } else raf = requestAnimationFrame((n) => { last = n; tick(n); });

  return {
    set(o) { Object.assign(opts, o); frame(); },
    drop, frame,
    stop() { cancelAnimationFrame(raf); },
  };
}
