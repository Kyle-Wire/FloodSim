// Flood barriers: walls, levees / berms and deployable barriers from the infrastructure layer, on the solver grid.
//
// A barrier is a crest on the cell faces its line crosses, not a raised cell: water passes a face only over the crest,
// as a broad-crested weir (solver weir(), Villemonte submergence), so a 0.3 m wall on a 5 m grid stays 0.3 m thick and
// a crest can be raised mid-run (a deployable barrier) without moving any water. A berm also fills its trapezoidal
// footprint into the bed (top width, side slopes), so a wide levee takes up the room it really does.
// Crest: a height above the lidar ground under the line (follows the ground), or a fixed elevation (m NAVD88).
import { toCells } from './ingest.js';

export const BARRIER_TYPES = ['wall', 'berm', 'barrier'];
/** Weir coefficient C (m^½/s) in q = C·H^1.5; ×1.811 for US units (ft^½/s). Broad-crested theory gives 1.70. */
export const WEIR_C = { wall: 1.66, berm: 1.44, barrier: 1.55 };
const RHO_G = 1000 * 9.81;

/**
 * Faces a polyline crosses, in cell coordinates (x = column, y = row, cell centres at +0.5). A face belongs to the link
 * between two neighbouring centres; it is returned when the line crosses that link (half-open rule at vertices, so a
 * polyline never leaves a gap), hence every 4-connected path from one side of the line to the other crosses one.
 * Faces on the grid edge are left out (the edges stay outfalls). → [{ i, j, axis, x, y, seg }]; axis 0 = between
 * (i−1, j) and (i, j), axis 1 = between (i, j−1) and (i, j); x, y = crossing point.
 */
export function barrierFaces(line, nx, ny) {
  const out = new Map();
  const add = (i, j, axis, x, y, seg) => { const key = (axis * (ny + 1) + j) * (nx + 1) + i; if (!out.has(key)) out.set(key, { i, j, axis, x, y, seg }); };
  for (let s = 0; s + 1 < line.length; s++) {
    const [ax, ay] = line[s], [bx, by] = line[s + 1];
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - 0.5)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by)));
    for (let j = j0; j <= j1; j++) { // links along row j (centre line y = j + 0.5) → x-faces
      const yc = j + 0.5; if ((ay <= yc) === (by <= yc)) continue;
      const x = ax + (yc - ay) / (by - ay) * (bx - ax), i = Math.floor(x + 0.5);
      if (i >= 1 && i <= nx - 1) add(i, j, 0, x, yc, s);
    }
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - 0.5)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx)));
    for (let i = i0; i <= i1; i++) { // links along column i → y-faces
      const xc = i + 0.5; if ((ax <= xc) === (bx <= xc)) continue;
      const y = ay + (xc - ax) / (bx - ax) * (by - ay), j = Math.floor(y + 0.5);
      if (j >= 1 && j <= ny - 1) add(i, j, 1, xc, y, s);
    }
  }
  return [...out.values()];
}

/**
 * Barriers onto the solver grid c (coarsened by F from fine). Berms raise c.z in place, so call this before anything
 * reads the coarse bed (fill: false skips that, for the subgrid mode, which fills berms into the 1 m ground instead). → { faces: [{ i, j, axis, z, C, bar, a, b, ground }], list: per barrier, skipped }
 * where a, b are the coarse cells either side (k = j·nx + i) and list[n] = { id, type, faces: [indices], length,
 * crestMin, crestMax, deployAt (s; null = not deployed), fill (m³ of berm) }.
 */
export function buildBarriers(items, fine, f, c, F, { fill: doFill = true } = {}) {
  const faces = [], list = [], skipped = [], cdx = F * fine.dx;
  const groundAt = (x, y) => { // fine-grid ground at coarse-cell coords
    const i = Math.min(fine.nx - 1, Math.max(0, Math.floor(x * F))), j = Math.min(fine.ny - 1, Math.max(0, Math.floor(y * F)));
    return f.z[j * fine.nx + i];
  };
  for (const it of items ?? []) {
    if (!it.line || it.line.length < 2) { skipped.push(it.id); continue; }
    const line = toCells(fine, it.line).map(([x, y]) => [x / F, y / F]);
    const fixed = it.mode === 'elev' && Number.isFinite(it.crest), height = Math.max(0, Number(it.height) || 0);
    const crestAt = (x, y) => (fixed ? it.crest : groundAt(x, y) + height);
    let fill = 0;
    if (it.type === 'berm' && doFill) fill = raiseBerm(c, line, crestAt, Math.max(0, it.topW ?? 0) / cdx, Math.max(0.5, it.slope ?? 3), cdx);
    const fs = barrierFaces(line, c.nx, c.ny), idx = [];
    let lo = Infinity, hi = -Infinity, length = 0;
    for (let s = 1; s < line.length; s++) length += Math.hypot(line[s][0] - line[s - 1][0], line[s][1] - line[s - 1][1]) * cdx;
    for (const q of fs) {
      const z = crestAt(q.x, q.y), ground = groundAt(q.x, q.y);
      const a = q.axis ? (q.j - 1) * c.nx + q.i : q.j * c.nx + q.i - 1, b = q.j * c.nx + q.i;
      if (!c.mask[a] && !c.mask[b]) continue; // inside a building: nothing to hold back
      idx.push(faces.length);
      faces.push({ i: q.i, j: q.j, axis: q.axis, z, C: it.C > 0 ? it.C : WEIR_C[it.type] ?? 1.6, bar: list.length, a, b, ground });
      lo = Math.min(lo, z); hi = Math.max(hi, z);
    }
    if (!idx.length) { skipped.push(it.id); continue; }
    const deployAt = it.type !== 'barrier' || it.deploy === 'start' || !it.deploy ? 0 : it.deploy === 'time' ? Math.max(0, Number(it.deployAt) || 0) * 60 : null;
    list.push({ id: it.id, type: it.type, faces: idx, length, crestMin: lo, crestMax: hi, deployAt, fill });
  }
  return { faces, list, skipped };
}

/** Fill a berm's trapezoid (top width tw cells, side slope s H:1V) into c.z; returns the fill volume (m³). */
function raiseBerm(c, line, crestAt, tw, s, cdx) {
  let fill = 0;
  const reachOf = (z0) => tw / 2 + Math.max(0, z0) * s / cdx; // cells from the centre line to the toe
  for (let n = 0; n + 1 < line.length; n++) {
    const [ax, ay] = line[n], [bx, by] = line[n + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
    const za = crestAt(ax, ay), zb = crestAt(bx, by);
    const R = reachOf(Math.max(za, zb) - Math.min(c.z[cellK(c, ax, ay)], c.z[cellK(c, bx, by)])) + 1;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - R)), i1 = Math.min(c.nx - 1, Math.ceil(Math.max(ax, bx) + R));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - R)), j1 = Math.min(c.ny - 1, Math.ceil(Math.max(ay, by) + R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const K = j * c.nx + i; if (!c.mask[K]) continue;
      const px = i + 0.5 - ax, py = j + 0.5 - ay, t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      const d = Math.hypot(px - t * dx, py - t * dy), top = crestAt(ax + t * dx, ay + t * dy);
      const zb2 = top - Math.max(0, d - tw / 2) * cdx / s;
      if (zb2 > c.z[K]) { fill += (zb2 - c.z[K]) * cdx * cdx; c.z[K] = zb2; }
    }
  }
  return fill;
}
const cellK = (c, x, y) => Math.min(c.ny - 1, Math.max(0, Math.floor(y))) * c.nx + Math.min(c.nx - 1, Math.max(0, Math.floor(x)));

/** Water this far over a crest counts as overtopping (thinner films are rain running off a berm top or a wall cap). */
export const OVER = 0.02;
export const BAR_OVER = OVER;

/**
 * Per-barrier results from the solver's every-step face books (readBarriers): volume over, when it first went over, peak
 * unit discharge, highest water against it, lowest freeboard (crest − that water) and peak hydrostatic load
 * (½ρg·|d₁² − d₂²| per metre, each side's depth up to the crest), with their times. The total rate over a barrier is
 * the change in volume between reads (frames), so its peak is the only sampled number. The solver books water as over
 * only while the barrier is up and water stands more than OVER above its crest.
 */
export class BarrierWatch {
  constructor(built, z, cdx = 1) {
    this.b = built; this.z = z; this.cdx = cdx; this.active = built.list.map(x => x.deployAt === 0);
    this.r = built.list.map(x => ({ id: x.id, type: x.type, length: x.length, crestMin: x.crestMin, crestMax: x.crestMax, deployAt: x.deployAt, fill: x.fill,
      minFreeboard: Infinity, maxLevel: -Infinity, peakLoad: 0, tLoad: null, overVol: 0, tOver: null, peakRate: 0, tPeakRate: null, peakUnitQ: 0, tPeakUnitQ: null }));
    this.last = null;
  }
  /** Crest per face for the solver at time t (−Infinity where a barrier is not up yet); null when nothing changed. */
  levels(t) {
    let changed = !this._lv;
    this.b.list.forEach((x, n) => { const on = x.deployAt != null && t >= x.deployAt - 0.01; if (on !== this.active[n]) { this.active[n] = on; changed = true; } });
    if (!changed) return null;
    return (this._lv = this.b.faces.map(q => (this.active[q.bar] ? q.z : -Infinity)));
  }
  /** Next deployment time after t, or Infinity. */
  next(t) { let n = Infinity; for (const x of this.b.list) if (x.deployAt != null && x.deployAt > t + 0.01) n = Math.min(n, x.deployAt); return n; }
  /** Solver books (readBarriers, since the start) at time t. */
  books(t, bk) {
    const tot = this.b.list.map(() => 0);
    for (const r of this.r) { r.minFreeboard = Infinity; r.maxLevel = -Infinity; r.peakLoad = 0; r.peakUnitQ = 0; r.tOver = null; }
    this.b.faces.forEach((q, m) => {
      const r = this.r[q.bar]; tot[q.bar] += bk.plus[m] + bk.minus[m];
      if (bk.level[m] > -Infinity) { r.maxLevel = Math.max(r.maxLevel, bk.level[m]); r.minFreeboard = Math.min(r.minFreeboard, q.z - bk.level[m]); }
      if (bk.load[m] > r.peakLoad) { r.peakLoad = bk.load[m]; r.tLoad = bk.tLoad[m]; }
      if (bk.peak[m] > r.peakUnitQ) { r.peakUnitQ = bk.peak[m]; r.tPeakUnitQ = bk.tPeak[m]; }
      if (bk.tOver[m] >= 0 && (r.tOver == null || bk.tOver[m] < r.tOver)) r.tOver = bk.tOver[m];
    });
    tot.forEach((v, n) => {
      const r = this.r[n];
      if (this.last && t > this.last.t + 1e-6) { const rate = (v - this.last.tot[n]) / (t - this.last.t); if (rate > r.peakRate) { r.peakRate = rate; r.tPeakRate = t; } }
      r.overVol = v;
    });
    this.last = { t, tot };
  }
  results() { return this.r.map(r => ({ ...r, overtopped: r.overVol > 0.05 || r.minFreeboard < -OVER })); }
}
