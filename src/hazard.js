// Flood hazard and intensity products, tracked per solver cell through a run.
//
// Hazard classes come from the depth and velocity at the same moment (the peak of d·v is not max depth × max speed,
// which occur at different times), so they are classified at every depth readback and the worst class is kept:
//   arr         Australian Rainfall and Runoff 2019 / AIDR Guideline 7-3 hazard vulnerability curves H1–H6
//               (limits on d, v and d·v; the most widely used set of combined curves, also used outside Australia)
//   defra       UK Defra / EA FD2320 hazard rating HR = d·(v + 0.5) + DF, debris factor 0
//   defraUrban  the same with FD2320's urban debris factor (0 up to 0.25 m deep, 1 deeper)
// Intensity:
//   force       peak momentum flux per metre of width, ρ(h·v² + ½g·h²): the hydrostatic plus dynamic load the flow puts
//               on a wall, car or person standing across it (kN/m)
//   d·v         peak depth × velocity (m²/s)
//   duration    time deeper than `thr` (15 cm by default), and arrival = the first time it got that deep
// Velocity counts only where the water is at least VCUT deep. All of these are sampled at the solver's depth readbacks (every frame drawn), not every time step; max depth comes from
// the GPU at every step.

const RHO = 1000, G = 9.81;
export const WET = 0.01;  // m: shallower water is not classified
/** m: below this depth velocities are wetting-front noise (a few cm of water at 4–6 m/s on steep curbs), so hazard and
 *  force use depth alone there; the solver's velocity output is untouched. */
export const VCUT = 0.05;

export const STANDARDS = {
  arr: {
    name: 'ARR 2019 / AIDR H1–H6',
    note: 'Australian Rainfall and Runoff 2019 hazard vulnerability curves (AIDR Guideline 7-3): limits on depth, velocity and depth × velocity',
    classes: [
      { label: 'H1', text: 'Generally safe for people, vehicles and buildings', color: [255, 240, 170] },
      { label: 'H2', text: 'Unsafe for small vehicles', color: [250, 205, 95] },
      { label: 'H3', text: 'Unsafe for vehicles, children and the elderly', color: [245, 150, 60] },
      { label: 'H4', text: 'Unsafe for vehicles and people', color: [225, 85, 45] },
      { label: 'H5', text: 'Unsafe for vehicles and people; buildings need engineered design', color: [175, 30, 50] },
      { label: 'H6', text: 'Unsafe for vehicles and people; all buildings vulnerable to failure', color: [90, 10, 60] },
    ],
    classify(d, v) {
      const dv = d * v;
      if (dv <= 0.3 && d <= 0.3 && v <= 2) return 1;
      if (dv <= 0.6 && d <= 0.5 && v <= 2) return 2;
      if (dv <= 0.6 && d <= 1.2 && v <= 2) return 3;
      if (dv <= 1.0 && d <= 2.0 && v <= 2) return 4;
      if (dv <= 4.0 && d <= 4.0 && v <= 4) return 5;
      return 6;
    },
  },
  defra: {
    name: 'UK FD2320 HR = d(v + 0.5)',
    note: 'Defra / Environment Agency FD2320 flood hazard rating, debris factor 0',
    classes: [
      { label: 'Low', text: 'Caution (HR < 0.75)', color: [250, 230, 120] },
      { label: 'Moderate', text: 'Dangerous for some (0.75–1.25)', color: [245, 160, 60] },
      { label: 'Significant', text: 'Dangerous for most (1.25–2.0)', color: [215, 60, 45] },
      { label: 'Extreme', text: 'Dangerous for all (HR > 2.0)', color: [120, 20, 60] },
    ],
    classify: (d, v) => hrClass(d * (v + 0.5)),
  },
  defraUrban: {
    name: 'UK FD2320, urban debris factor',
    note: 'Defra / Environment Agency FD2320 flood hazard rating with the urban debris factor (0 to 0.25 m deep, 1 deeper)',
    classify: (d, v) => hrClass(d * (v + 0.5) + (d > 0.25 ? 1 : 0)),
  },
};
STANDARDS.defraUrban.classes = STANDARDS.defra.classes;
const KEYS = Object.keys(STANDARDS);
const hrClass = (hr) => (hr < 0.75 ? 1 : hr < 1.25 ? 2 : hr < 2 ? 3 : 4);

/** Bed shear stress (Pa) under Manning friction: ρg·n²·v²/h^⅓. */
export const shearStress = (d, v, n) => RHO * G * n * n * v * v / Math.cbrt(d);

/** Momentum flux per metre of width (kN/m) for depth d (m) and speed v (m/s). */
export const forcePerWidth = (d, v) => RHO * (d * v * v + 0.5 * G * d * d) / 1000;

export class HazardTracker {
  /** n solver cells; thr = depth (m) that counts as flooded for duration and arrival. */
  constructor(n, { thr = 0.15 } = {}) {
    this.n = n; this.thr = thr; this.t = null;
    this.dv = new Float32Array(n); this.force = new Float32Array(n);
    this.duration = new Float32Array(n); this.arrival = new Float32Array(n).fill(NaN);
    this.cls = Object.fromEntries(Object.keys(STANDARDS).map(k => [k, new Uint8Array(n)]));
    this.shear = new Float32Array(n); this.excess = new Float32Array(n); this.erosion = new Float32Array(n); this.tShear = new Float32Array(n);
  }
  /** Packed [depth, speed] per cell at time t (s), for a host-side tracker. Duration counts each interval at the state
   *  seen at its end. */
  update(t, out) {
    const dt = this.t == null ? 0 : Math.max(0, t - this.t); this.t = t;
    for (let k = 0; k < this.n; k++) { const d = out[2 * k]; if (d >= WET) this.cell(k, d, d >= VCUT ? out[2 * k + 1] : 0, t, dt); }
  }
  /** One cell after a step ending at t of length dt: depth d, speed v (already 0 under VCUT); tauC (Pa) and n for scour. */
  cell(k, d, v, t, dt, tauC = Infinity, n = 0) {
    if (!(d >= WET)) return;
    const dv = d * v; if (dv > this.dv[k]) this.dv[k] = dv;
    const f = forcePerWidth(d, v); if (f > this.force[k]) this.force[k] = f;
    if (d > this.thr) { this.duration[k] += dt; if (Number.isNaN(this.arrival[k])) this.arrival[k] = t; }
    for (const s of KEYS) { const c = STANDARDS[s].classify(d, v); if (c > this.cls[s][k]) this.cls[s][k] = c; }
    if (d >= VCUT && n > 0) { // bed shear and scour, as the GPU kernel
      const tau = shearStress(d, v, n);
      if (tau > this.shear[k]) { this.shear[k] = tau; this.tShear[k] = t; }
      if (tau > tauC) { this.excess[k] += (tau - tauC) * dt; this.erosion[k] += 0.2e-6 / Math.sqrt(tauC) * (tau - tauC) * dt; }
    }
    this.t = t;
  }
  /** Take a solver's every-step results (GPUSolver.readHazard / CPUSolver.readHazard) at time t. */
  load(r, t) { Object.assign(this, { dv: r.dv, force: r.force, duration: r.duration, arrival: r.arrival, cls: r.cls, shear: r.shear ?? this.shear, excess: r.excess ?? this.excess, erosion: r.erosion ?? this.erosion, tShear: r.tShear ?? this.tShear, t }); }
  /** Area (m²) in each class of a standard, from the worst class each cell reached; `keep(k)` filters cells, and
   *  `areaOf(k)` replaces the cell area (the subgrid mode counts only the 1 m pixels that got wet). */
  classAreas(std, cellArea, keep = () => true, areaOf = null) {
    const a = new Array(STANDARDS[std].classes.length).fill(0), c = this.cls[std];
    for (let k = 0; k < this.n; k++) if (c[k] && keep(k)) a[c[k] - 1] += areaOf ? areaOf(k) : cellArea;
    return a;
  }
}
