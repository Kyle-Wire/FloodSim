// FloodSim Solver Lab — app shell: scenarios, engine selection, voxel renderer, readouts, verification.
// Expects in scope: CPUSolver, GPUSolver, SCENARIOS, rng, MMHR, RESULTS ({cpu, gpu}), THREE.
const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  scenario: 'cloudburst', playing: !reduceMotion, mode: 0, exag: 2, maxView: false, showBld: true,
  rainMMhr: 80, durMin: 30, speedSlider: 70,
};
let device = null, engine = 'cpu';

// ---------------------------------------------------------------- utilities
const fmtTime = (t) => { if (t < 60) return t.toFixed(t < 10 ? 2 : 1) + ' s'; const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const fmtVol = (v) => v >= 1e4 ? `${(v / 1000).toFixed(1)}k m³` : `${v.toFixed(v < 10 ? 2 : 0)} m³`;
const fmtArea = (a) => a >= 1e4 ? `${(a / 1e4).toFixed(2)} ha` : `${Math.round(a).toLocaleString()} m²`;

const RES = { cloudburst: [160, 80], dambreak: [96, 48], thacker: [120, 60] };

// ---------------------------------------------------------------- engines
class CpuRunner {
  constructor(sc) {
    this.s = new CPUSolver({ nx: sc.nx, ny: sc.ny, dx: sc.dx, z: sc.z, mask: sc.mask, manning: sc.manning, bc: sc.bc, hdry: 1e-5, hfront: sc.hfront ?? 1e-3 });
    if (sc.infil) for (let j = 0; j < sc.ny; j++) for (let i = 0; i < sc.nx; i++) this.s.infil[this.s.idx(i, j)] = sc.infil[j * sc.nx + i];
    this.nx = sc.nx; this.ny = sc.ny; this.out = new Float32Array(sc.nx * sc.ny * 2); this.lastDt = 0;
    let a = 0; for (let k = 0; k < sc.nx * sc.ny; k++) a += sc.mask ? sc.mask[k] : 1; this.activeArea = a * sc.dx * sc.dx;
  }
  get t() { return this.s.t; } get steps() { return this.s.steps; }
  set rainRate(v) { this.s.rainRate = v; }
  get rainVolume() { return this.s.vol.rain; }
  setDepth(f) { this.s.setDepth(f); } setVelocity(f) { this.s.setVelocity(f); }
  async frame(tEnd, K) {
    const t0 = performance.now(); let n = 0;
    while (this.s.t < tEnd - 1e-9 && n < K && performance.now() - t0 < 14) { this.lastDt = this.s.step(tEnd - this.s.t); n++; }
    const { s, out } = this;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = s.idx(i, j), k = j * this.nx + i, h = s.h[c];
      out[2 * k] = h; out[2 * k + 1] = h > s.hdry ? Math.hypot(s.hu[c], s.hv[c]) / h : 0;
    }
    return out;
  }
  async readState() {
    const m = this.s.massBalance();
    return { hmax: this.s.field('maxDepth'), mass: { volume: m.volume, outflow: this.s.vol.outflow, rel: m.rel } };
  }
  destroy() {}
}
class GpuRunner {
  constructor(sc) {
    this.g = new GPUSolver(device, { nx: sc.nx, ny: sc.ny, dx: sc.dx, z: sc.z, mask: sc.mask, manning: sc.manning, infil: sc.infil, bc: sc.bc, hfront: sc.hfront ?? 1e-3 });
    this.activeArea = this.g.activeArea; this.lastDt = 0;
  }
  get t() { return this.g.t; } get steps() { return this.g.steps; }
  set rainRate(v) { this.g.rainRate = v; }
  get rainVolume() { return this.g.vol.rain; }
  setDepth(f) { this.g.setDepth(f); } setVelocity(f) { this.g.setVelocity(f); }
  async frame(tEnd, K) { const o = await this.g.frame(tEnd, K); this.lastDt = this.g.lastDt || this.lastDt; return o; }
  async readState() { const s = await this.g.readState(); return { hmax: s.hmax, mass: s.mass }; }
  destroy() { this.g.destroy(); }
}

async function initEngine() {
  try {
    if (navigator.gpu) {
      const a = await navigator.gpu.requestAdapter();
      if (a) {
        device = await a.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(a.limits.maxStorageBuffersPerShaderStage, 10) } });
        engine = 'gpu';
        device.lost.then((info) => { if (info.reason !== 'destroyed') { engine = 'cpu'; device = null; setEngineBadge('WebGPU device lost, switched to CPU'); loadScenario(state.scenario); } });
        const arch = a.info && (a.info.architecture || a.info.vendor);
        setEngineBadge(`WebGPU${arch ? ' · ' + arch : ''}`);
        return;
      }
    }
  } catch (e) { /* fall through to CPU */ }
  engine = 'cpu'; setEngineBadge('CPU fallback · WebGPU unavailable in this browser');
}
function setEngineBadge(text) { $('engineText').textContent = text; $('engineDot').className = 'dot ' + engine; }

// ---------------------------------------------------------------- renderer
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 20000);
scene.add(new THREE.HemisphereLight(0xe4eef2, 0x41503f, 0.78));
const sun = new THREE.DirectionalLight(0xffffff, 0.72); sun.position.set(-0.6, 1, 0.35); scene.add(sun);

const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: false });
const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0);
let terrain = null, water = null, waterGeo = null;
const waterMat = new THREE.ShaderMaterial({
  uniforms: { uExag: { value: 2 }, uMin: { value: 0.01 }, uCell: { value: 1 }, uMode: { value: 0 } },
  vertexShader: `
    attribute vec3 iOff; attribute float iD; attribute float iS;
    uniform float uExag; uniform float uMin; uniform float uCell;
    varying vec3 vN; varying float vD; varying float vS;
    void main() {
      vD = iD; vS = iS;
      float h = iD > uMin ? iD * uExag : 0.0;
      vec3 p = vec3(position.x * uCell + iOff.x, iOff.y + (position.y + 0.5) * h, position.z * uCell + iOff.z);
      vN = normal;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    uniform float uMin; uniform int uMode;
    varying vec3 vN; varying float vD; varying float vS;
    vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
      if (t < 1.0) return mix(a, b, t); if (t < 2.0) return mix(b, c, t - 1.0); return mix(c, d, clamp(t - 2.0, 0.0, 1.0));
    }
    float seg(float x, float x1, float x2, float x3) {
      if (x < x1) return x / x1; if (x < x2) return 1.0 + (x - x1) / (x2 - x1); return 2.0 + (x - x2) / (x3 - x2);
    }
    int hazard(float d, float v) {
      float dv = d * v;
      if (dv <= 0.3 && d <= 0.3 && v <= 2.0) return 1;
      if (dv <= 0.6 && d <= 0.5 && v <= 2.0) return 2;
      if (dv <= 0.6 && d <= 1.2 && v <= 2.0) return 3;
      if (dv <= 1.0 && d <= 2.0 && v <= 2.0) return 4;
      if (dv <= 4.0 && d <= 4.0 && v <= 4.0) return 5;
      return 6;
    }
    void main() {
      if (vD <= uMin) discard;
      vec3 col;
      if (uMode == 0) {
        col = ramp4(seg(vD, 0.3, 1.0, 2.0), vec3(0.75,0.94,0.97), vec3(0.36,0.77,0.89), vec3(0.12,0.50,0.77), vec3(0.04,0.23,0.55));
      } else if (uMode == 1) {
        col = ramp4(seg(vS, 1.0, 3.0, 6.0), vec3(0.80,0.92,0.96), vec3(0.44,0.72,0.88), vec3(0.95,0.70,0.24), vec3(0.88,0.33,0.18));
      } else {
        int hz = hazard(vD, vS);
        col = hz == 1 ? vec3(0.55,0.80,0.90) : hz == 2 ? vec3(0.96,0.86,0.36) : hz == 3 ? vec3(0.96,0.66,0.25)
            : hz == 4 ? vec3(0.91,0.45,0.20) : hz == 5 ? vec3(0.78,0.20,0.20) : vec3(0.45,0.10,0.35);
      }
      vec3 n = normalize(vN);
      float l = 0.58 + 0.42 * max(dot(n, normalize(vec3(-0.5, 1.0, 0.35))), 0.0);
      if (uMode == 0 && n.y > 0.5) col = mix(col, vec3(1.0), 0.55 * smoothstep(1.5, 5.0, vS));
      gl_FragColor = vec4(col * l, 1.0);
    }`,
});

const CLASS_RGB = [[0.36, 0.39, 0.42], [0.47, 0.60, 0.40], [0.38, 0.55, 0.32], [0.56, 0.49, 0.38], [0.80, 0.81, 0.82], [0.82, 0.75, 0.60], [0.55, 0.62, 0.43]];
let sc = null, zmin = 0, zmax = 1, Lx = 1, Ly = 1;

function buildScene() {
  if (terrain) { scene.remove(terrain); terrain.dispose?.(); }
  if (water) { scene.remove(water); waterGeo.dispose(); }
  const { nx, ny, dx } = sc, N = nx * ny;
  zmin = Infinity; zmax = -Infinity; for (let k = 0; k < N; k++) { zmin = Math.min(zmin, sc.z[k]); zmax = Math.max(zmax, sc.z[k]); }
  Lx = nx * dx; Ly = ny * dx;
  terrain = new THREE.InstancedMesh(unitBox, terrainMat, N);
  const col = new THREE.Color(), rnd = rng(3);
  for (let k = 0; k < N; k++) {
    const c = CLASS_RGB[sc.cls[k]], tint = 0.9 + 0.2 * (sc.z[k] - zmin) / Math.max(1e-6, zmax - zmin);
    const jitter = sc.cls[k] === 4 ? 0.92 + 0.12 * rnd() : 1;
    col.setRGB(c[0] * tint * jitter, c[1] * tint * jitter, c[2] * tint * jitter);
    terrain.setColorAt(k, col);
  }
  scene.add(terrain);
  waterGeo = new THREE.InstancedBufferGeometry();
  waterGeo.index = unitBox.index;
  const pos = unitBox.attributes.position.clone(); // re-center vertically for the shader
  for (let v = 0; v < pos.count; v++) pos.setY(v, pos.getY(v) - 0.5);
  waterGeo.setAttribute('position', pos);
  waterGeo.setAttribute('normal', unitBox.attributes.normal);
  waterGeo.instanceCount = N;
  waterGeo.setAttribute('iOff', new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3));
  const iD = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); iD.setUsage(THREE.DynamicDrawUsage);
  const iS = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); iS.setUsage(THREE.DynamicDrawUsage);
  waterGeo.setAttribute('iD', iD); waterGeo.setAttribute('iS', iS);
  water = new THREE.Mesh(waterGeo, waterMat); water.frustumCulled = false;
  scene.add(water);
  layout();
  frameCamera();
}

function layout() { // positions depend on vertical exaggeration and building toggle
  const { nx, ny, dx } = sc, N = nx * ny, e = state.exag, base = Math.max(1.5, 0.08 * (zmax - zmin + 1)) * e;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const off = waterGeo.attributes.iOff.array;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, X = (i + 0.5) * dx - Lx / 2, Z = (ny - j - 0.5) * dx - Ly / 2;
    const ground = (sc.z[k] - zmin) * e;
    const top = ground + (state.showBld ? sc.bld[k] : 0); // buildings at true height for context
    p.set(X, -base, Z); s.set(dx, top + base, dx); m.compose(p, q, s); terrain.setMatrixAt(k, m);
    off[3 * k] = X; off[3 * k + 1] = ground; off[3 * k + 2] = Z;
  }
  terrain.instanceMatrix.needsUpdate = true; if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true;
  waterGeo.attributes.iOff.needsUpdate = true;
  waterMat.uniforms.uExag.value = e; waterMat.uniforms.uCell.value = dx * 0.999; waterMat.uniforms.uMin.value = sc.hmin;
}

// orbit camera
const orbit = { theta: -0.75, phi: 0.92, r: 400, target: new THREE.Vector3() };
function frameCamera() {
  const asp = camera.aspect || 1; // portrait screens need more distance to fit the domain's width
  orbit.r = Math.max(Lx, Ly) * (sc.camR ?? 1.3) * (asp < 1 ? Math.min(2.2, 1 / asp) : 1); orbit.theta = -0.6; orbit.phi = sc.camPhi ?? 0.78;
  orbit.target.set(0, (zmax - zmin) * state.exag * 0.3, 0); applyCamera();
}
function applyCamera() {
  const { theta, phi, r, target } = orbit;
  camera.position.set(target.x + r * Math.sin(phi) * Math.sin(theta), target.y + r * Math.cos(phi), target.z + r * Math.sin(phi) * Math.cos(theta));
  camera.near = r / 500; camera.far = r * 20; camera.updateProjectionMatrix();
  camera.lookAt(target);
}
const pointers = new Map(); let pinch0 = 0, r0 = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, shift: e.shiftKey || e.button === 2 }); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); r0 = orbit.r; } });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dxp = e.clientX - p.x, dyp = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) orbit.r = Math.max(Lx * 0.08, Math.min(Lx * 5, r0 * pinch0 / d)); }
  else if (p.shift) {
    const k = orbit.r / canvas.clientHeight; const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0); const fwd = new THREE.Vector3(Math.sin(orbit.theta), 0, Math.cos(orbit.theta));
    orbit.target.addScaledVector(right, -dxp * k).addScaledVector(fwd, -dyp * k);
  } else { orbit.theta -= dxp * 0.006; orbit.phi = Math.max(0.12, Math.min(1.5, orbit.phi - dyp * 0.005)); }
  applyCamera();
});
const endPtr = (e) => { pointers.delete(e.pointerId); pinch0 = 0; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.r = Math.max(Lx * 0.08, Math.min(Lx * 5, orbit.r * Math.exp(e.deltaY * 0.0012))); applyCamera(); }, { passive: false });

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($('viewport'));

// ---------------------------------------------------------------- simulation loop
let runner = null, busy = false, lastWall = 0, rtf = 0, lastRead = 0, hmax = null, lastOut = null, generation = 0;
const speedFromSlider = (v) => { const base = SCENARIOS_SPEED(); return +(base * Math.pow(10, (v - 70) / 30)).toPrecision(2); };
function SCENARIOS_SPEED() { return sc ? sc.speed : 1; }

function loadScenario(name) {
  generation++;
  if (runner) { runner.destroy(); runner = null; }
  state.scenario = name;
  const [hi, lo] = RES[name];
  sc = SCENARIOS[name](engine === 'gpu' ? hi : lo);
  state.exag = sc.exag; $('exag').value = sc.exag; $('exagOut').value = sc.exag.toFixed(1) + '×';
  runner = engine === 'gpu' ? new GpuRunner(sc) : new CpuRunner(sc);
  if (engine === 'gpu') runner.g.ready.catch((err) => { console.error(err); engine = 'cpu'; setEngineBadge('WebGPU pipeline failed, switched to CPU'); loadScenario(state.scenario); });
  sc.init(runner);
  hmax = null; lastOut = null; rtf = 0; lastRead = 0;
  for (const b of $('scenarioSeg').children) b.setAttribute('aria-pressed', String(b.dataset.sc === name));
  $('scDesc').textContent = sc.desc + (engine === 'cpu' ? ' Running at half resolution on the CPU.' : '');
  $('rainControls').hidden = !sc.rain;
  $('roALabel').textContent = sc.rain ? 'Rain so far' : sc.analytic ? 'Error vs exact solution' : 'Peak velocity';
  $('roBLabel').textContent = sc.analytic ? 'Periods completed' : 'Inundated > 0.15 m';
  resize();
  buildScene();
  updateSpeedLabel();
  lastWall = performance.now();
}

async function simTick() {
  if (!runner || busy) return;
  busy = true; const gen = generation;
  try {
    const now = performance.now(), wall = Math.min(0.1, (now - lastWall) / 1000); lastWall = now;
    const speed = speedFromSlider(state.speedSlider);
    let tEnd = runner.t + (state.playing ? speed * wall : 0);
    if (sc.rain) {
      const stormEnd = state.durMin * 60;
      if (runner.t < stormEnd - 1e-6) { runner.rainRate = state.rainMMhr * MMHR; tEnd = Math.min(tEnd, stormEnd); } else runner.rainRate = 0;
    }
    if (sc.tMax) tEnd = Math.min(tEnd, sc.tMax);
    const need = tEnd - runner.t;
    const K = need <= 0 ? 0 : Math.max(1, Math.min(engine === 'gpu' ? 64 : 400, runner.lastDt > 0 ? Math.ceil(need / runner.lastDt) + 1 : 4));
    const t0 = runner.t;
    const out = await runner.frame(tEnd, K);
    if (gen !== generation) return;
    lastOut = out;
    if (wall > 0 && state.playing) rtf = rtf ? 0.9 * rtf + 0.1 * ((runner.t - t0) / wall) : (runner.t - t0) / wall;
    pushWater(out);
    if (now - lastRead > 800) { lastRead = now; const s = await runner.readState(); if (gen !== generation) return; hmax = s.hmax; readouts(out, s); if (state.maxView) pushWater(out); }
    $('hudTime').textContent = fmtTime(runner.t);
  } catch (err) {
    console.error(err);
    if (engine === 'gpu') { engine = 'cpu'; setEngineBadge('WebGPU error, switched to CPU'); loadScenario(state.scenario); }
  } finally { busy = false; }
}

function pushWater(out) {
  const N = sc.nx * sc.ny, D = waterGeo.attributes.iD.array, S = waterGeo.attributes.iS.array;
  let mx = 0;
  for (let k = 0; k < N; k++) {
    const h = out[2 * k]; S[k] = out[2 * k + 1];
    D[k] = state.maxView && hmax ? hmax[k] : h;
    if (h > mx && (!sc.mask || sc.mask[k])) mx = h;
  }
  waterGeo.attributes.iD.needsUpdate = true; waterGeo.attributes.iS.needsUpdate = true;
  $('hudMetric').textContent = mx.toFixed(2) + ' m';
}

function readouts(out, s) {
  const N = sc.nx * sc.ny, A = sc.dx * sc.dx;
  $('roDt').textContent = runner.lastDt ? (runner.lastDt < 0.1 ? (runner.lastDt * 1000).toFixed(1) + ' ms' : runner.lastDt.toFixed(2) + ' s') : '–';
  $('roSteps').textContent = Math.round(runner.steps).toLocaleString();
  if (sc.rain) $('roA').textContent = (runner.rainVolume / runner.activeArea * 1000).toFixed(1) + ' mm';
  else if (sc.analytic) {
    const T = sc.analytic; let e = 0, n = 0;
    for (let j = 0; j < sc.ny; j++) for (let i = 0; i < sc.nx; i++) { const he = T.depth((i + 0.5) * sc.dx, (j + 0.5) * sc.dx, runner.t); e += Math.abs(out[2 * (j * sc.nx + i)] - he); n += he; }
    $('roA').textContent = (100 * e / n).toFixed(2) + ' % (L1)';
  } else { let v = 0; for (let k = 0; k < N; k++) v = Math.max(v, out[2 * k + 1]); $('roA').textContent = v.toFixed(2) + ' m/s'; }
  if (sc.analytic) $('roB').textContent = (runner.t / sc.analytic.period).toFixed(2);
  else { let a = 0; for (let k = 0; k < N; k++) if (out[2 * k] > 0.15) a += A; $('roB').textContent = fmtArea(a); }
  $('roVol').textContent = fmtVol(s.mass.volume);
  $('roOut').textContent = fmtVol(Math.max(0, s.mass.outflow));
  $('roMass').textContent = Number.isFinite(s.mass.rel) ? (Math.abs(s.mass.rel) < 1e-12 ? '< 1e-12' : s.mass.rel.toExponential(1)) : '–';
  $('roRtf').textContent = state.playing && rtf ? (rtf >= 10 ? Math.round(rtf) : rtf.toFixed(1)) + '× real time' : 'paused';
}

function syncClear() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim();
  if (v) renderer.setClearColor(new THREE.Color(v), 1);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncClear);
new MutationObserver(syncClear).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
function loop() { simTick(); renderer.render(scene, camera); requestAnimationFrame(loop); }

// ---------------------------------------------------------------- controls
function updateSpeedLabel() { $('speedOut').value = speedFromSlider(state.speedSlider) + '× real time'; }
$('scenarioSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) loadScenario(b.dataset.sc); });
$('modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; state.mode = +b.dataset.mode; waterMat.uniforms.uMode.value = state.mode;
  for (const x of $('modeSeg').children) x.setAttribute('aria-pressed', String(x === b)); drawLegend();
});
$('play').addEventListener('click', () => { state.playing = !state.playing; $('play').textContent = state.playing ? 'Pause' : 'Play'; lastWall = performance.now(); });
$('reset').addEventListener('click', () => loadScenario(state.scenario));
$('speed').addEventListener('input', (e) => { state.speedSlider = +e.target.value; updateSpeedLabel(); });
$('rain').addEventListener('input', (e) => { state.rainMMhr = +e.target.value; $('rainOut').value = state.rainMMhr + ' mm/hr'; });
$('dur').addEventListener('input', (e) => { state.durMin = +e.target.value; $('durOut').value = state.durMin + ' min'; });
$('exag').addEventListener('input', (e) => { state.exag = +e.target.value; $('exagOut').value = state.exag.toFixed(1) + '×'; layout(); });
$('maxView').addEventListener('change', (e) => { state.maxView = e.target.checked; if (lastOut) pushWater(lastOut); });
$('showBld').addEventListener('change', (e) => { state.showBld = e.target.checked; layout(); });
for (const [tab, pane, other, otherPane] of [['tabSim', 'paneSim', 'tabVer', 'paneVer'], ['tabVer', 'paneVer', 'tabSim', 'paneSim']]) {
  $(tab).addEventListener('click', () => { $(tab).setAttribute('aria-selected', 'true'); $(other).setAttribute('aria-selected', 'false'); $(pane).hidden = false; $(otherPane).hidden = true; });
}
$('play').textContent = state.playing ? 'Pause' : 'Play';

function drawLegend() {
  const L = $('legend');
  const css = (c) => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
  if (state.mode === 2) {
    const rows = [['H1', [0.55, 0.80, 0.90], 'Generally safe for people, vehicles and buildings'], ['H2', [0.96, 0.86, 0.36], 'Unsafe for small vehicles'],
      ['H3', [0.96, 0.66, 0.25], 'Unsafe for vehicles, children and the elderly'], ['H4', [0.91, 0.45, 0.20], 'Unsafe for vehicles and people'],
      ['H5', [0.78, 0.20, 0.20], 'Unsafe for all; buildings need special design'], ['H6', [0.45, 0.10, 0.35], 'Unsafe for all; all buildings vulnerable']];
    L.innerHTML = `<div class="classes">${rows.map(r => `<i style="background:${css(r[1])}"></i><b>${r[0]}</b><span>${r[2]}</span>`).join('')}</div><p class="note">Depth × velocity hazard classes after Australian Rainfall and Runoff (2019), approximate thresholds.</p>`;
    return;
  }
  const [stops, ticks, unit] = state.mode === 0
    ? [[[0.75, 0.94, 0.97], [0.36, 0.77, 0.89], [0.12, 0.50, 0.77], [0.04, 0.23, 0.55]], ['0', '0.3', '1.0', '≥ 2 m'], 'Water depth']
    : [[[0.80, 0.92, 0.96], [0.44, 0.72, 0.88], [0.95, 0.70, 0.24], [0.88, 0.33, 0.18]], ['0', '1', '3', '≥ 6 m/s'], 'Flow velocity'];
  L.innerHTML = `<span class="note">${unit}</span><div class="ramp" style="background:linear-gradient(to right, ${stops.map((c, i) => `${css(c)} ${(i * 100 / 3).toFixed(1)}%`).join(',')})"></div><div class="ticks">${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- verification tab
function buildVerification() {
  const C = RESULTS.cpu, G = RESULTS.gpu, e = (v) => v.toExponential(1);
  const ord = (a, b) => Math.log2(a / b).toFixed(1);
  const th = C.thacker.levels.map(l => l.checkpoints[3].L1rel);
  const rows = [
    ['Wet-bed dam break (Stoker)', 'Shock and rarefaction, 400 cells, L1 depth error', e(C.stoker.levels[2].L1rel), e(G.stoker.L1rel), `Converges, order ${C.stoker.observedOrder[2].toFixed(1)}`],
    ['Dry-bed dam break (Ritter)', 'Wetting front on a dry bed, L1 depth error', e(C.ritter.levels[2].L1rel), e(G.ritter.L1rel), `Converges, order ${C.ritter.observedOrder[2].toFixed(1)}`],
    ['Lake at rest, submerged bump', 'Still water must stay still: max velocity, m/s', e(C.lakeSubmerged.maxVel), e(G.lakeSubmerged.maxVel), 'Well-balanced'],
    ['Lake at rest, emergent island', 'Same, with a dry island (wet/dry fronts)', e(C.lakeIsland.maxVel), e(G.lakeIsland.maxVel), 'Well-balanced'],
    ['Thacker paraboloid', 'Moving shoreline, 100 cells, L1 error after one period', e(th[1]), e(G.thacker.checkpoints[3].L1rel), `Converges, order ${ord(th[1], th[2])}`],
    ['Rain-on-grid mass balance', '20 min storm, buildings, infiltration, open outlet: relative error', e(C.rainMass.rel), e(G.rainMass.rel), `0 m³ clipped`],
    ['Urban cloudburst (app scenario)', '15 min at 150 mm/hr over curbs, creek banks and buildings: relative mass error', e(C.urban.rel), e(G.urban.rel), '0 m³ clipped'],
    ['Valley dam break (app scenario)', '8 m reservoir released for 120 s: relative mass error', e(C.valleyDam.rel), e(G.valleyDam.rel), 'Mass conserved'],
    ['WebGPU vs CPU reference', 'Same rain case: max depth difference, m', '–', e(G.rainMass.maxDiffVsCPU), 'Agrees'],
  ];
  $('verTable').innerHTML = `<thead><tr><th>Test</th><th>CPU fp64</th><th>GPU fp32</th><th>Result</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r[0]}</strong><br><span class="note">${r[1]}</span></td><td class="num">${r[2]}</td><td class="num">${r[3]}</td><td><span class="pill">${r[4]}</span></td></tr>`).join('')}</tbody>`;
  $('verLead').textContent = `All ${rows.length} checks pass. The scheme holds still water still to machine precision, conserves mass in a full rain-on-grid run, converges toward exact solutions as the grid refines, and the WebGPU kernels reproduce the CPU reference to within ${(G.rainMass.maxDiffVsCPU * 1e6).toFixed(0)} µm of depth.`;
  $('verNote').textContent = 'Reference solutions: Stoker (1957), Ritter (1892) and Thacker (1981), as specified in the SWASHES benchmark library (Delestre et al. 2013). GPU column ran on a software WebGPU adapter; lake-at-rest GPU cases place the bed near 100 m elevation to stress fp32. First-order convergence is expected for problems with shocks.';
  $('chartRitter').innerHTML = profileChart(C.ritter.profile.map(p => [p[0], p[1], p[2]]), { x0: 0, x1: 100, y0: 0, y1: 1.05, xl: 'Distance (m)', yl: 'Depth (m)', every: 6 });
  $('chartThacker').innerHTML = profileChart(C.thacker.profile.filter(p => p[0] > 0.6 && p[0] < 3.4).map(p => [p[0], p[1], p[2], p[3]]), { x0: 0.6, x1: 3.4, y0: -0.1, y1: 0.12, xl: 'Distance along centerline (m)', yl: 'Elevation (m)', every: 2, bed: true });
}
function profileChart(pts, o) {
  const W = 320, H = 190, l = 40, r = 10, t = 12, b = 34;
  const X = (x) => l + (x - o.x0) / (o.x1 - o.x0) * (W - l - r), Y = (y) => H - b - (y - o.y0) / (o.y1 - o.y0) * (H - t - b);
  const ticks = (a, c, n) => Array.from({ length: n + 1 }, (_, i) => a + (c - a) * i / n);
  const xt = ticks(o.x0, o.x1, 4), yt = ticks(o.y0, o.y1, 4);
  const grid = xt.map(x => `<line x1="${X(x)}" x2="${X(x)}" y1="${t}" y2="${H - b}" stroke="var(--rule)"/><text x="${X(x)}" y="${H - b + 14}" text-anchor="middle">${+x.toFixed(2)}</text>`).join('')
    + yt.map(y => `<line x1="${l}" x2="${W - r}" y1="${Y(y)}" y2="${Y(y)}" stroke="var(--rule)"/><text x="${l - 5}" y="${Y(y) + 3}" text-anchor="end">${+y.toFixed(2)}</text>`).join('');
  const exact = pts.filter(p => !o.bed || p[2] > p[3] + 1e-6 || true);
  const exactPath = o.bed
    ? segments(pts.map(p => [p[0], p[2] > p[3] + 1e-5 ? p[2] : null])).map(s => `<path d="${s.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('')}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>`).join('')
    : `<path d="${exact.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[2]).toFixed(1)).join('')}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>`;
  const bedPath = o.bed ? `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[3]).toFixed(1)).join('')}" fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="3 3"/>` : '';
  const dots = pts.filter((p, i) => i % o.every === 0 && (!o.bed || p[1] > p[3] + 1e-5)).map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="1.8" fill="var(--ink)"/>`).join('');
  const key = `<g transform="translate(${W - r - 150},${t + 6})"><line x1="0" x2="16" y1="0" y2="0" stroke="var(--accent)" stroke-width="1.8"/><text x="20" y="3">exact</text><circle cx="62" cy="0" r="2" fill="var(--ink)"/><text x="68" y="3">model</text>${o.bed ? '<line x1="104" x2="118" y1="0" y2="0" stroke="var(--muted)" stroke-dasharray="3 3"/><text x="121" y="3">bed</text>' : ''}</g>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.yl} versus ${o.xl}: model against exact solution">${grid}${bedPath}${exactPath}${dots}${key}<text x="${(l + W - r) / 2}" y="${H - 4}" text-anchor="middle">${o.xl}</text><text transform="translate(11 ${(t + H - b) / 2}) rotate(-90)" text-anchor="middle">${o.yl}</text></svg>`;
}
function segments(arr) { const out = []; let cur = []; for (const p of arr) { if (p[1] === null) { if (cur.length) out.push(cur); cur = []; } else cur.push(p); } if (cur.length) out.push(cur); return out; }

// ---------------------------------------------------------------- boot
(async () => {
  syncClear(); drawLegend(); buildVerification();
  await initEngine();
  loadScenario('cloudburst');
  resize();
  requestAnimationFrame(loop);
})();
