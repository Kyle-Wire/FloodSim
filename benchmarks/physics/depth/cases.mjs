// Depth audit (planted synthetic cases with known answers; protocol: gridzip-lab physics/PROTOCOL-12.md).
// Three families, each aimed at a miss seen on the wall check (CHI docs/validation/FLOOD-WALLS-PLAN.md):
//   C  walled channel on coarse cells (Highland Falls marks 44719/44724, +2.7 m): steady flow down a rectangular
//      channel between walls (mask 0), true width W, cell size dx; answer = Manning normal depth.
//   B  backwater from a downstream level (Lumber River, ~1 m low): steady flow, downstream edge either held at a level
//      (stageCells) or a free outfall; answer = the gradually-varied-flow profile from the held level (direct step).
//   R  rain sheet flow on a plane (Highland Falls hillside film): steady rain on a uniform slope; answer = the
//      kinematic-wave steady depth h(x) = (i x n / sqrt S)^(3/5).
// Usage: node benchmarks/physics/depth/cases.mjs [C|B|R|all] [--quick] [--free-edge] > out.json
import { CPUSolver } from '../../../src/solver-cpu.js';

const g = 9.81;
const OPTS = process.env.FS_OPTS ? JSON.parse(process.env.FS_OPTS) : {}; // solver options under test, e.g. {"stepFlux":true,"implicitFriction":true} (F26)
const normalDepth = (q, n, S, R = (h) => h) => { // per unit width q (m2/s); R(h) hydraulic radius
  let lo = 1e-6, hi = 50;
  for (let k = 0; k < 200; k++) { const h = 0.5 * (lo + hi); (h * Math.pow(R(h), 2 / 3) * Math.sqrt(S) / n > q) ? hi = h : lo = h; }
  return 0.5 * (lo + hi);
};

/** Steady flow in a channel along x: Q m3/s enters the west end across the channel cells, leaves east. */
function channelRun({ W, dx, S, n, Q, L = 240, wallH = 20, east = 'outflow', stage = null, Wfield = null, tMax = null }) {
  const width = Wfield ?? W, pad = 2 * dx;                     // walls of at least one cell each side
  const ny = Math.ceil((width + 2 * pad) / dx), nx = Math.round(L / dx);
  const y0 = (ny * dx - width) / 2;                              // channel from y0 to y0 + width (true edges)
  const z = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny);
  let ncell = 0;
  for (let j = 0; j < ny; j++) {
    const yc = (j + 0.5) * dx, inside = yc > y0 && yc < y0 + width; // a cell is channel when its centre is inside
    if (inside) ncell++;
    for (let i = 0; i < nx; i++) { const k = j * nx + i; z[k] = 100 - S * (i + 0.5) * dx; mask[k] = inside ? 1 : 0; }
  }
  const Wm = ncell * dx;                                         // the width the model actually has
  if (!Wm) return { W, dx, Wm: 0, skipped: 'no cell centre inside the channel' };
  const stageCells = []; if (stage != null) for (let j = 0; j < ny; j++) if (mask[j * nx + nx - 1]) stageCells.push(j * nx + nx - 1);
  const s = new CPUSolver({ ...OPTS, nx, ny, dx, z, manning: n, mask, bc: { west: 'wall', east: stage != null ? 'wall' : east, south: 'wall', north: 'wall' }, stageCells });
  if (stage != null) s.setStage(stage);
  const hn = normalDepth(Q / Wm, n, S), u0 = Q / (Wm * hn);
  s.setDepth((x, y, zz) => hn); s.setVelocity(() => [u0, 0]);
  const inlet = []; for (let j = 0; j < ny; j++) if (mask[j * nx]) inlet.push(s.idx(0, j));
  const A = dx * dx, T = tMax ?? Math.max(600, 6 * L / Math.max(0.2, u0));
  let added = 0;
  s.run(T, (sv, dt) => {
    const dV = Q * dt / inlet.length / A; added += Q * dt;
    for (const c of inlet) { const h = sv.h[c]; sv.h[c] += dV; sv.hu[c] += dV * (h > 1e-6 ? sv.hu[c] / h : u0); }
  });
  const H = s.field('h'), prof = [];
  for (let i = 0; i < nx; i++) { let a = 0, m = 0; for (let j = 0; j < ny; j++) if (mask[j * nx + i]) { a += H[j * nx + i]; m++; } prof.push(a / m); }
  return { nx, ny, Wm, hn_model_width: hn, profile: prof, T, mass_rel: s.massBalance().rel };
}

const modelWidth = (W, dx) => { const ny = Math.ceil((W + 4 * dx) / dx), y0 = (ny * dx - W) / 2; let m = 0;
  for (let j = 0; j < ny; j++) { const yc = (j + 0.5) * dx; if (yc > y0 && yc < y0 + W) m++; } return m * dx; };
const freeEdge = process.argv.includes('--free-edge');

function famC(quick) {
  const out = [];
  const Ws = process.env.CW ? process.env.CW.split(',').map(Number) : quick ? [3, 6] : [2.5, 3, 4, 5, 6, 8, 12, 20], dxs = quick ? [1, 2] : [0.5, 1, 2, 4];
  for (const W of Ws) for (const dx of dxs) for (const [S, n, Q] of (quick ? [[0.01, 0.04, 6]] : [[0.01, 0.04, 6], [0.003, 0.035, 15], [0.02, 0.05, 3]])) {
    // East edge held at the model-width normal depth (free outfall drags a 160 m reach toward critical depth when
    // Lb = h/S is long, which is family B's question, not C's; seen in the first 13 free-edge cases, PROTOCOL-12 A1).
    const Wm0 = modelWidth(W, dx), L = 160, nxC = Math.round(L / dx);
    const stage = freeEdge || !Wm0 ? null : 100 - S * (nxC - 0.5) * dx + normalDepth(Q / Wm0, n, S);
    const r = channelRun({ W, dx, S, n, Q, L, stage });
    if (r.skipped) { out.push({ fam: 'C', W, dx, S, n, Q, skipped: r.skipped }); continue; }
    const mid = r.profile.slice(Math.floor(r.nx * 0.4), Math.floor(r.nx * 0.7)), h = mid.reduce((a, b) => a + b, 0) / mid.length;
    const hTrue2D = normalDepth(Q / W, n, S);                                    // 2D physics (bed friction only), true width
    const hTrueWalls = normalDepth(Q / W, n, S, (hh) => W * hh / (W + 2 * hh)); // with wall friction (Manning on R = A/P)
    out.push({ fam: 'C', edge: stage == null ? 'free' : 'held', W, dx, S, n, Q, Wm: r.Wm, cells_across: r.Wm / dx, h_model: h, h_true_2d: hTrue2D, h_true_walls: hTrueWalls,
      h_model_width: r.hn_model_width, mass_rel: r.mass_rel });
    console.error(`C W=${W} dx=${dx} S=${S}: model ${h.toFixed(3)} true2d ${hTrue2D.toFixed(3)} walls ${hTrueWalls.toFixed(3)} (Wm ${r.Wm})`);
  }
  return out;
}

/** Direct-step GVF profile up from a held downstream level, rectangular wide channel (R = h). Returns h(xFromEdge). */
function gvf(q, n, S, hDown, Lmax) {
  const pts = [[0, hDown]]; let x = 0, h = hDown; const hn = normalDepth(q, n, S), dhs = (hDown - hn) / 400;
  while (x < Lmax && Math.abs(h - hn) > 1e-4) {
    const f = (hh) => { const Sf = n * n * q * q / Math.pow(hh, 10 / 3), Fr2 = q * q / (g * hh ** 3); return (1 - Fr2) / (S - Sf); };
    const h2 = h - dhs; x += 0.5 * (f(h) + f(h2)) * (h - h2); h = h2; pts.push([x, h]);
  }
  pts.push([Lmax * 2, hn]);
  return (xe) => { for (let k = 1; k < pts.length; k++) if (pts[k][0] >= xe) { const [x0, h0] = pts[k - 1], [x1, h1] = pts[k]; return h0 + (h1 - h0) * (xe - x0) / Math.max(1e-9, x1 - x0); } return hn; };
}

function famB(quick) {
  const out = [];
  const setsB = quick ? [[0.0005, 0.04, 2, 1.0]] : [[0.0005, 0.04, 2, 1.0], [0.0005, 0.04, 2, 2.0], [0.001, 0.035, 4, 1.0], [0.0002, 0.05, 1, 0.5], [0.002, 0.04, 3, 1.5]];
  for (const [S, n, q, rise] of (process.env.BK ? process.env.BK.split(',').map((k) => setsB[+k]) : setsB)) {
    const W = 20, dx = 2, Q = q * W, hn = normalDepth(q, n, S), L = quick ? 1200 : Math.min(4000, Math.max(1500, 3 * (hn + rise) / S));
    const zEdge = 100 - S * (L - dx / 2), hDown = hn + rise, prof = gvf(q, n, S, hDown, L);
    for (const mode of ['held', 'free']) {
      const r = channelRun({ W, dx, S, n, Q, L, east: 'outflow', stage: mode === 'held' ? zEdge + hDown : null, tMax: quick ? 3000 : 8000 });
      const rows = [];
      for (let i = 0; i < r.nx; i += Math.max(1, Math.round(25 / dx))) {
        const xe = L - (i + 0.5) * dx; if (i < Math.round(60 / dx)) continue;  // skip the inlet reach
        rows.push({ x_from_edge: xe, h_model: r.profile[i], h_true: prof(xe) });
      }
      out.push({ fam: 'B', mode, S, n, q, hn, hDown, rise, L, Lb: hDown / S, rows, mass_rel: r.mass_rel });
      console.error(`B ${mode} S=${S} rise=${rise}: at 1 Lb/4 model ${rows.find(x => x.x_from_edge < hDown / S / 4)?.h_model?.toFixed(3)} true ${rows.find(x => x.x_from_edge < hDown / S / 4)?.h_true?.toFixed(3)}`);
    }
  }
  return out;
}

function famR(quick) {
  const out = [];
  for (const dx of (quick ? [1] : [1, 2, 4])) for (const [S, n, mmh] of (quick ? [[0.05, 0.1, 50]] : [[0.05, 0.1, 50], [0.15, 0.1, 50], [0.05, 0.03, 50], [0.05, 0.1, 150], [0.01, 0.06, 80]])) {
    const L = 120, nx = Math.round(L / dx), ny = Math.max(3, Math.round(8 / dx)), z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 100 - S * (i + 0.5) * dx;
    const s = new CPUSolver({ nx, ny, dx, z, manning: n, bc: { west: 'wall', east: 'outflow', south: 'wall', north: 'wall' }, ...OPTS });
    const i_ms = mmh / 1000 / 3600; s.rainRate = i_ms;
    const tc = Math.pow(L * n / Math.sqrt(S), 0.6) / Math.pow(i_ms, 0.4);  // kinematic time of concentration (s)
    s.run(3 * tc + 300);
    const H = s.field('h'), rows = [];
    for (let i = 0; i < nx; i++) { const x = (i + 0.5) * dx; if (x < 10) continue; let a = 0; for (let j = 0; j < ny; j++) a += H[j * nx + i]; rows.push({ x, h_model: a / ny, h_true: Math.pow(i_ms * x * n / Math.sqrt(S), 0.6) }); }
    out.push({ fam: 'R', dx, S, n, mmh, tc, rows: rows.filter((_, k) => k % Math.max(1, Math.round(10 / dx)) === 0), mass_rel: s.massBalance().rel });
    const r = rows.find(x => x.x >= 100); console.error(`R dx=${dx} S=${S} n=${n} ${mmh}mm/h: at 100 m model ${r.h_model.toFixed(4)} true ${r.h_true.toFixed(4)}`);
  }
  return out;
}

const which = process.argv[2] ?? 'all', quick = process.argv.includes('--quick');
const res = {};
if (which === 'C' || which === 'all') res.C = famC(quick);
if (which === 'B' || which === 'all') res.B = famB(quick);
if (which === 'R' || which === 'all') res.R = famR(quick);
console.log(JSON.stringify(res));
