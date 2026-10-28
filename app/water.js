// Pixel-art water along the bottom of the window: a 1D wave field (springs between columns, damped) under a slow
// ambient swell, drawn at 1/4 resolution in banded 16-bit colours. Moving the pointer through it pushes the surface,
// fast moves and clicks throw droplets. Still under prefers-reduced-motion; pauses with the tab (requestAnimationFrame).
const PX = 4; // screen pixels per water pixel
const BANDS = {
  dark: ['#e8fbff', '#8fe3ff', '#3fb4ea', '#1a78bd', '#0f4f8c', '#0a3466'],
  light: ['#ffffff', '#b9ecff', '#62c3ef', '#2a8fd0', '#1a6aa8', '#134d80'],
};

export function startWater(canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const darkQ = matchMedia('(prefers-color-scheme: dark)');
  let W = 0, H = 0, h, v, img, drops = [], t = 0, last = null;
  const palette = () => {
    const theme = document.documentElement.dataset.theme, dark = theme ? theme === 'dark' : darkQ.matches;
    return (dark ? BANDS.dark : BANDS.light).map(hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  };
  let pal = palette(); darkQ.addEventListener('change', () => { pal = palette(); if (still) draw(); });

  function resize() {
    const w = Math.max(1, Math.ceil(canvas.clientWidth / PX)), hh = Math.max(1, Math.ceil(canvas.clientHeight / PX));
    if (w === W && hh === H) return;
    const old = h; W = w; H = hh; canvas.width = W; canvas.height = H;
    h = new Float32Array(W); v = new Float32Array(W); if (old) h.set(old.subarray(0, W));
    img = ctx.createImageData(W, H);
  }
  const rest = () => H * 0.42;
  const swell = (x) => 1.1 * Math.sin(x * 0.045 + t * 0.9) + 0.6 * Math.sin(x * 0.11 - t * 1.3) + 0.35 * Math.sin(x * 0.23 + t * 2.1);
  const surface = (x) => rest() - h[x] - (still ? 0.6 * Math.sin(x * 0.05) : swell(x));

  function step() {
    for (let i = 0; i < W; i++) { const a = ((h[i - 1] ?? h[i]) + (h[i + 1] ?? h[i]) - 2 * h[i]) * 0.18 - h[i] * 0.004; v[i] = (v[i] + a) * 0.986; }
    for (let i = 0; i < W; i++) h[i] = Math.max(-H * 0.4, Math.min(H * 0.4, h[i] + v[i]));
    for (const d of drops) { d.vy += 0.12; d.x += d.vx; d.y += d.vy; }
    drops = drops.filter(d => {
      const x = Math.round(d.x); if (x < 0 || x >= W) return false;
      if (d.vy > 0 && d.y >= surface(x)) { v[x] -= 0.25 * d.vy; return false; } // lands: a ripple
      return true;
    });
  }
  function draw() {
    const D = img.data; D.fill(0);
    const T = [1, 2.5, H * 0.32, H * 0.55]; // band floors below the surface: crest, light, mid, deep-mid, deep
    for (let x = 0; x < W; x++) {
      const s = surface(x), top = Math.max(0, Math.ceil(s)), churn = Math.abs(v[x]) > 0.35;
      for (let y = top; y < H; y++) {
        const depth = y - s; let k = 0;
        while (k < 4 && depth >= T[k]) k++;
        if (k >= 2 && depth - T[k - 1] < 1 && ((x + y) & 1)) k--; // checker dither along each band boundary
        const c = pal[k === 0 ? (churn ? 0 : 1) : k + 1], q = 4 * (y * W + x); D[q] = c[0]; D[q + 1] = c[1]; D[q + 2] = c[2]; D[q + 3] = 255;
      }
    }
    for (const d of drops) {
      const x = Math.round(d.x), y = Math.round(d.y); if (y < 0 || y >= H) continue;
      const k = 4 * (y * W + x), c = pal[0]; D[k] = c[0]; D[k + 1] = c[1]; D[k + 2] = c[2]; D[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function frame(now) {
    const dt = last == null ? 16 : Math.min(50, now - last); last = now; t += dt / 1000;
    for (let n = Math.max(1, Math.round(dt / 16)); n--;) step();
    draw(); requestAnimationFrame(frame);
  }

  // pointer: the strip is under the page, so watch the window and act when the pointer is over it
  let px = null, py = null;
  addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(), inside = e.clientY >= r.top - 6 && e.clientY <= r.bottom;
    if (!inside || still || !W) { px = py = null; return; }
    const x = Math.floor((e.clientX - r.left) / PX), y = (e.clientY - r.top) / PX;
    if (px != null && x >= 0 && x < W) {
      const speed = Math.hypot(x - px, y - py), under = y > surface(x) - 1;
      if (under) for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++) v[i] += Math.max(-1.6, Math.min(1.6, (y - py) * 0.35 + speed * 0.06));
      if (under && speed > 3 && drops.length < 160) for (let n = 0; n < Math.min(6, speed / 2); n++) drops.push({ x, y: surface(x) - 1, vx: (x - px) * 0.25 + (Math.random() - 0.5), vy: -1 - Math.random() * speed * 0.25 });
    }
    px = x; py = y;
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(); if (still || e.clientY < r.top - 6 || e.clientY > r.bottom) return;
    const x = Math.floor((e.clientX - r.left) / PX);
    for (let i = Math.max(0, x - 2); i <= Math.min(W - 1, x + 2); i++) v[i] += 2.2;
    for (let n = 0; n < 18 && drops.length < 160; n++) drops.push({ x: x + (Math.random() - 0.5) * 3, y: surface(Math.max(0, Math.min(W - 1, x))) - 1, vx: (Math.random() - 0.5) * 1.6, vy: -1.5 - Math.random() * 2.2 });
  }, { passive: true });
  new ResizeObserver(() => { resize(); if (still) draw(); }).observe(canvas);
  resize();
  if (still) draw(); else requestAnimationFrame(frame);
}
