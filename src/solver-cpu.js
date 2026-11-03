// FloodSim CPU reference solver
// 2D shallow water equations, finite volume, structured grid.
//   - MUSCL reconstruction of h, eta = h + z, u, v (minmod or van Leer)
//   - Hydrostatic reconstruction (Audusse et al. 2004) for well-balancing and wet/dry
//   - HLLC approximate Riemann solver (Toro 2001)
//   - SSP-RK2 (Heun) time stepping, CFL-limited
//   - Draining-time flux limiter: a cell never exports more water than it holds (positivity, exact mass)
//   - Semi-implicit point-wise Manning friction
//   - Rainfall and infiltration source terms with full mass accounting
//   - Optional local time stepping (o.lts): 8×8 tiles step at 2^m times a base step (see _cycle)
// This file is the ground truth the WGSL kernels are verified against.

export const GH = 2; // ghost layers on each side (MUSCL needs two)
export const LTS_TILE = 8; // local time stepping: tile size (cells), the GPU's active tiles
export const LTS_SAFE = 0.9; // local time stepping: share of its CFL step a tile may take (its speeds are the cycle start's)

function minmod(a, b) {
  if (a * b <= 0) return 0;
  return Math.abs(a) < Math.abs(b) ? a : b;
}
function vanleer(a, b) {
  const p = a * b;
  return p <= 0 ? 0 : (2 * p) / (a + b);
}

import { HazardTracker, VCUT } from './hazard.js';
import { BAR_OVER } from './barriers.js';

export class CPUSolver {
  /**
   * @param {object} o
   *  nx, ny       interior cells
   *  dx           cell size (m), square cells
   *  z            Float64Array(nx*ny) bed elevation, row-major (j*nx+i)
   *  manning      number or Float64Array(nx*ny)
   *  mask         optional Uint8Array(nx*ny), 0 = wall/building cell
   *  bc           {west,east,south,north}: 'wall' | 'open' (transmissive) | 'outflow' (free outfall: normal-depth velocity on the water-surface slope, ≤ critical)
   *  secondOrder  default true
   *  limiter      'minmod' | 'vanleer'
   *  cfl          default 0.48 (2nd order) / 0.9 (1st), applied to lambda_x + lambda_y
   *  hdry         depth below which a cell is dry (m), default 1e-6
   *  hfront       depth below which reconstruction drops to first order, default 1e-3
   *  crest        flood-barrier faces [{ i, j, axis, z, C, ground }] (see GPUSolver); setCrestLevels changes them mid-run
   *  lts          local time stepping: true (3 levels, steps up to 8× the base step) or the number of levels (1–4)
   *  Every step also tracks the hazard products of src/hazard.js per cell (this.hz, readHazard), as the GPU does.
   */
  constructor(o) {
    this.nx = o.nx; this.ny = o.ny; this.dx = o.dx;
    this.NX = o.nx + 2 * GH; this.NY = o.ny + 2 * GH;
    const N = this.NX * this.NY;
    this.g = o.g ?? 9.81;
    this.secondOrder = o.secondOrder ?? true;
    // 2D positivity: dt*(lx+ly)/dx <= 1/2 (second order) or 1 (first order)
    this.cfl = o.cfl ?? (this.secondOrder ? 0.48 : 0.9);
    this.hdry = o.hdry ?? 1e-6;
    this.hfront = o.hfront ?? 1e-3;
    this.dtDry = o.dtDry ?? 1.0;       // time step used while the whole domain is dry (s)
    this.lim = (o.limiter === 'vanleer') ? vanleer : minmod;
    this.bc = Object.assign({ west: 'wall', east: 'wall', south: 'wall', north: 'wall' }, o.bc || {});

    this.h = new Float64Array(N); this.hu = new Float64Array(N); this.hv = new Float64Array(N);
    this.z = new Float64Array(N); this.n = new Float64Array(N); this.M = new Uint8Array(N);
    this.rainRate = 0;                 // m/s, uniform (or set rainField)
    this.rainField = null;             // optional Float64Array(N) multiplier
    this.infil = new Float64Array(N);  // infiltration capacity, m/s
    // green infrastructure: extra infiltration into a store of capacity giCap (m) that drains at giDrain (m/s)
    this.giRate = new Float64Array(N); this.giCap = new Float64Array(N); this.giDrain = new Float64Array(N); this.giStore = new Float64Array(N);
    // Green-Ampt (o.ga, as GPUSolver): ψΔθ, soil storage to the water table, pervious share; F = depth infiltrated
    this.gaPsiD = new Float64Array(N); this.gaFmax = new Float64Array(N); this.gaPerv = new Float64Array(N); this.gaF = new Float64Array(N);

    // primitive + stage buffers
    this.Hp = new Float64Array(N); this.Ep = new Float64Array(N);
    this.Up = new Float64Array(N); this.Vp = new Float64Array(N);
    this.h0 = new Float64Array(N); this.hu0 = new Float64Array(N); this.hv0 = new Float64Array(N);
    this.dh = new Float64Array(N); this.dhu = new Float64Array(N); this.dhv = new Float64Array(N);
    // face arrays: x-faces indexed by right cell, y-faces by upper cell. 9 values each.
    this.FX = new Float64Array(N * 9); this.FY = new Float64Array(N * 9);
    this.maxDepth = new Float64Array(N);
    this.TH = new Float64Array(N);    // draining-time flux scale per donor cell

    const nIn = (i, j) => (j + GH) * this.NX + (i + GH);
    this.idx = nIn;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = nIn(i, j), k = j * this.nx + i;
      this.z[c] = o.z[k];
      this.n[c] = typeof o.manning === 'number' ? o.manning : (o.manning ? o.manning[k] : 0);
      this.M[c] = o.mask ? o.mask[k] : 1;
      if (o.gi && o.gi.cap[k] > 0) { this.giRate[c] = o.gi.rate[k]; this.giCap[c] = o.gi.cap[k]; this.giDrain[c] = o.gi.drain[k]; }
      if (o.ga && o.ga.perv[k] > 0) { this.gaPsiD[c] = o.ga.psiD[k]; this.gaFmax[c] = Math.min(o.ga.fmax[k], 1e6); this.gaPerv[c] = o.ga.perv[k]; }
    }
    // flood barriers: crest (−Infinity = none) and weir coefficient on x-faces (stored at the right cell) and y-faces
    this.CX = new Float64Array(N).fill(-Infinity); this.CY = new Float64Array(N).fill(-Infinity);
    this.WX = new Float64Array(N); this.WY = new Float64Array(N);
    this.crest = (o.crest ?? []).map(f => ({ ...f, c: nIn(f.i, f.j) }));
    const nb = this.crest.length, F64 = (v = 0) => new Float64Array(nb).fill(v);
    this.bar = { plus: F64(), minus: F64(), peak: F64(), level: F64(-Infinity), load: F64(), tPeak: F64(), tLevel: F64(), tLoad: F64(), tOver: F64(NaN) };
    this.hz = new HazardTracker(o.nx * o.ny); this.scour = o.scour ?? null;
    this.setCrestLevels(this.crest.map(f => f.z));
    this.t = 0; this.steps = 0;
    this.vol = { rain: 0, infil: 0, outflow: 0, clipped: 0, initial: 0 };
    this._fillGhostStatic();
    // local time stepping: per padded cell its tile (a ghost takes its edge cell's), per tile its level, per cell the
    // flux its finer neighbours have passed it while it waited (aH…, added at its own step); _lev = level stepping now
    this.lts = o.lts ? (o.lts === true ? 3 : Math.max(1, Math.min(4, o.lts | 0))) : 0; this._lev = -1;
    if (this.lts) {
      const tx = Math.ceil(this.nx / LTS_TILE), ty = Math.ceil(this.ny / LTS_TILE); // tiles that hold cells
      this.tilesX = tx; this.tilesY = ty; this.LV = new Int32Array(tx * ty); this.TI = new Int32Array(N); this._tsp = new Float64Array(tx * ty);
      for (let j = 0; j < this.NY; j++) for (let i = 0; i < this.NX; i++) {
        const ii = Math.min(Math.max(i - GH, 0), this.nx - 1), jj = Math.min(Math.max(j - GH, 0), this.ny - 1);
        this.TI[j * this.NX + i] = Math.floor(jj / LTS_TILE) * tx + Math.floor(ii / LTS_TILE);
      }
      this.aH = new Float64Array(N); this.aHu = new Float64Array(N); this.aHv = new Float64Array(N);
      this.cellSteps = 0; this.records = 0;
    }
  }
  /** Local time stepping: level of padded cell c (its tile's). */
  _lv(c) { return this.LV[this.TI[c]]; }

  setCrestLevels(zs) {
    this.crest.forEach((f, m) => { const z = Number.isFinite(zs[m]) ? zs[m] : -Infinity; if (f.axis) { this.CY[f.c] = z; this.WY[f.c] = f.C ?? 1.6; } else { this.CX[f.c] = z; this.WX[f.c] = f.C ?? 1.6; } });
  }
  readBarriers() { return this.bar; }
  readHazard() { return this.hz; }

  setDepth(fn) { // fn(x, y, z) -> h, x/y at cell centers
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j);
      this.h[c] = this.M[c] ? Math.max(0, fn((i + 0.5) * this.dx, (j + 0.5) * this.dx, this.z[c])) : 0;
    }
    this.vol.initial = this.volume();
  }
  setVelocity(fn) { // fn(x,y) -> [u,v]
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j); const [u, v] = fn((i + 0.5) * this.dx, (j + 0.5) * this.dx);
      this.hu[c] = this.h[c] * u; this.hv[c] = this.h[c] * v;
    }
  }

  volume() {
    let s = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j); if (this.M[c]) s += this.h[c];
    }
    return s * this.dx * this.dx;
  }

  // ---------- ghost cells ----------
  _fillGhostStatic() { // bed, mask, manning into ghosts (zero-gradient)
    const { NX, NY } = this;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      if (i >= GH && i < NX - GH && j >= GH && j < NY - GH) continue;
      const ii = Math.min(Math.max(i, GH), NX - GH - 1), jj = Math.min(Math.max(j, GH), NY - GH - 1);
      const c = j * NX + i, s = jj * NX + ii;
      this.z[c] = this.z[s]; this.n[c] = this.n[s]; this.M[c] = 1;
    }
  }
  _fillGhost(h, hu, hv) {
    const { NX, NY, bc, z, n, M, g: grav, dx, hdry } = this;
    const put = (c, s, su, sv) => { h[c] = h[s]; hu[c] = su * hu[s]; hv[c] = sv * hv[s]; };
    // free outfall: outward velocity = Manning velocity on the water-surface slope toward the edge (beyond 1e-4, so
    // round-off cannot start a drain), capped at critical
    const outVel = (e, i) => {
      const he = h[e]; if (he <= hdry || h[i] <= hdry || !M[i]) return 0; // a dry inner cell (its bed) drives nothing
      const s = ((h[i] + z[i]) - (he + z[e])) / dx - 1e-4; if (s <= 0) return 0;
      const crit = Math.sqrt(grav * he); return n[e] > 0 ? Math.min(crit, Math.pow(he, 2 / 3) * Math.sqrt(s) / n[e]) : crit;
    };
    // walls mirror across the boundary face; open / outflow edges copy the edge cell into every ghost layer
    for (let j = GH; j < NY - GH; j++) for (let g = 0; g < GH; g++) {
      let c = j * NX + (GH - 1 - g), s = j * NX + (bc.west === 'wall' ? GH + g : GH);
      put(c, s, bc.west === 'wall' ? -1 : 1, 1); if (bc.west === 'outflow') hu[c] = -h[c] * outVel(s, s + 1);
      c = j * NX + (NX - GH + g); s = j * NX + (bc.east === 'wall' ? NX - GH - 1 - g : NX - GH - 1);
      put(c, s, bc.east === 'wall' ? -1 : 1, 1); if (bc.east === 'outflow') hu[c] = h[c] * outVel(s, s - 1);
    }
    for (let i = 0; i < NX; i++) for (let g = 0; g < GH; g++) {
      let c = (GH - 1 - g) * NX + i, s = (bc.south === 'wall' ? GH + g : GH) * NX + i;
      put(c, s, 1, bc.south === 'wall' ? -1 : 1); if (bc.south === 'outflow') hv[c] = -h[c] * outVel(s, s + NX);
      c = (NY - GH + g) * NX + i; s = (bc.north === 'wall' ? NY - GH - 1 - g : NY - GH - 1) * NX + i;
      put(c, s, 1, bc.north === 'wall' ? -1 : 1); if (bc.north === 'outflow') hv[c] = h[c] * outVel(s, s - NX);
    }
  }

  // ---------- spatial operator L(U) ----------
  _prims(h, hu, hv) {
    const { Hp, Ep, Up, Vp, z, hdry } = this; const N = h.length;
    for (let c = 0; c < N; c++) {
      const d = h[c]; Hp[c] = d; Ep[c] = d + z[c];
      if (d > hdry) { Up[c] = hu[c] / d; Vp[c] = hv[c] / d; } else { Up[c] = 0; Vp[c] = 0; }
    }
  }

  // reconstruct cell c toward side sg (+1/-1) along stride s; writes into out[o..o+3] = h, eta, un, ut
  _recon(c, s, sg, isX, out, o) {
    const { Hp, Ep, Up, Vp, M, hfront, lim } = this;
    const un = isX ? Up : Vp, ut = isX ? Vp : Up;
    let fo = !this.secondOrder || Hp[c] < hfront;
    const a = c - s, b = c + s;
    const Ma = M[a], Mb = M[b];
    if (!fo && ((Ma && Hp[a] < hfront) || (Mb && Hp[b] < hfront))) fo = true;
    if (fo) { out[o] = Hp[c]; out[o + 1] = Ep[c]; out[o + 2] = un[c]; out[o + 3] = ut[c]; return; }
    const half = 0.5 * sg;
    const sl = (q) => { const qc = q[c]; const qm = Ma ? q[a] : qc; const qp = Mb ? q[b] : qc; return lim(qc - qm, qp - qc); };
    out[o] = Hp[c] + half * sl(Hp);
    out[o + 1] = Ep[c] + half * sl(Ep);
    out[o + 2] = un[c] + half * sl(un);
    out[o + 3] = ut[c] + half * sl(ut);
  }

  // face between cell a (left/below) and b (right/above); writes 9 values to F at offset f
  //  [F0 mass, F1 normal mom, F2 tangential mom, corrL, corrR, hL, zL, hR, zR]
  _face(a, b, s, isX, F, f, zc = -Infinity, cw = 0) {
    const { M, g } = this; const r = this._r || (this._r = new Float64Array(8));
    const Ma = M[a], Mb = M[b];
    if (!Ma && !Mb) { for (let k = 0; k < 9; k++) F[f + k] = 0; return; }
    if (Ma) this._recon(a, s, +1, isX, r, 0);
    if (Mb) this._recon(b, s, -1, isX, r, 4);
    if (!Mb) { r[4] = r[0]; r[5] = r[1]; r[6] = -r[2]; r[7] = r[3]; } // reflective wall
    if (!Ma) { r[0] = r[4]; r[1] = r[5]; r[2] = -r[6]; r[3] = r[7]; }
    const hL = r[0], zL = r[1] - r[0], uL = r[2], vL = r[3];
    const hR = r[4], zR = r[5] - r[4], uR = r[6], vR = r[7];
    const zs = Math.max(zL, zR, zc);
    const hLs = Math.max(0, r[1] - zs), hRs = Math.max(0, r[5] - zs);
    if (Ma && Mb && zc > Math.max(this.z[a], this.z[b])) this._weir(a, b, isX, zc, cw, hLs, hRs, F, f);
    else hllc(hLs, uL, vL, hRs, uR, vR, g, this.hdry, F, f);
    F[f + 3] = 0.5 * g * (hL * hL - hLs * hLs);
    F[f + 4] = 0.5 * g * (hR * hR - hRs * hRs);
    F[f + 5] = hL; F[f + 6] = zL; F[f + 7] = hR; F[f + 8] = zR;
    if (!Mb) { F[f + 4] = 0; } if (!Ma) { F[f + 3] = 0; }
  }

  // flow over a barrier crest: broad-crested weir with Villemonte submergence (as the GPU kernel's weir())
  _weir(a, b, isX, zc, cw, hLs, hRs, F, f) {
    const { Hp, Ep, Up, Vp, g, hdry, dx } = this, left = Ep[a] >= Ep[b], up = left ? a : b, dn = left ? b : a;
    const pres = 0.25 * g * (hLs * hLs + hRs * hRs), H1 = Ep[up] - zc;
    F[f] = 0; F[f + 1] = pres; F[f + 2] = 0;
    if (H1 <= hdry || Hp[up] <= hdry) return;
    const r = Math.max(0, Ep[dn] - zc) / H1; if (r >= 1) return;
    let q = cw * H1 ** 1.5 * (1 - r ** 1.5) ** 0.385;
    if (this._dt > 0) q = Math.min(q, (Ep[up] - Ep[dn]) * dx / (4 * this._dt));
    const un = q / Math.max(2 / 3 * H1, hdry), F0 = left ? q : -q;
    F[f] = F0; F[f + 1] = q * un + pres; F[f + 2] = F0 * (isX ? Vp[up] : Up[up]);
  }

  // computes dU into dh/dhu/dhv; returns boundary outflow rate (m^3/s)
  _L(h, hu, hv, dt) {
    const { NX, NY, FX, FY, M, dx, g, dh, dhu, dhv, bc, CX, CY, WX, WY } = this;
    this._dt = dt;
    this._fillGhost(h, hu, hv);
    this._prims(h, hu, hv);
    // x faces: face (i-1,i) stored at cell i, for i in [GH, NX-GH], j interior
    // local time stepping (lev ≥ 0): only this level's faces (the lower level of their two cells); the rest keep old fluxes
    const lev = this._lev, on = (a, b) => lev < 0 || Math.min(this._lv(a), this._lv(b)) === lev, wf = (a, b) => (on(a, b) ? 1 : 0);
    const near = (c) => lev < 0 || this._lv(c) === lev || this._lv(c) === lev + 1; // cells this level's faces touch
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i <= NX - GH; i++) {
      const b = j * NX + i; if (on(b - 1, b)) this._face(b - 1, b, 1, true, FX, b * 9, CX[b], WX[b]);
    }
    // y faces: face (j-1,j) stored at cell j
    for (let j = GH; j <= NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const b = j * NX + i; if (on(b - NX, b)) this._face(b - NX, b, NX, false, FY, b * 9, CY[b], WY[b]);
    }
    // draining-time limiter: scale each face's flux by its donor cell's theta = min(1, volume / outgoing volume)
    const TH = this.TH; TH.fill(1);
    const area = dx * dx;
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const c = j * NX + i; if (!M[c] || !near(c)) continue;
      const fw = FX[c * 9] * wf(c - 1, c), fe = FX[(c + 1) * 9] * wf(c, c + 1), fs = FY[c * 9] * wf(c - NX, c), fn = FY[(c + NX) * 9] * wf(c, c + NX);
      const out = ((fe > 0 ? fe : 0) - (fw < 0 ? fw : 0) + (fn > 0 ? fn : 0) - (fs < 0 ? fs : 0)) * dx * dt;
      // with local time stepping a cell holds its water plus what its finer neighbours have passed it so far: while it
      // waits (one level coarser), and in the first stage of its own step (the store goes in with the RK start state)
      const vol = lev >= 0 && (this._lv(c) === lev + 1 || !this._stage) ? Math.max(0, h[c] + this.aH[c]) * area : h[c] * area;
      if (out > vol) TH[c] = vol / out;
    }
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i <= NX - GH; i++) {
      const b = j * NX + i, f = b * 9, t = TH[FX[f] > 0 ? b - 1 : b];
      if (t < 1 && on(b - 1, b)) { FX[f] *= t; FX[f + 1] *= t; FX[f + 2] *= t; }
    }
    for (let j = GH; j <= NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const b = j * NX + i, f = b * 9, t = TH[FY[f] > 0 ? b - NX : b];
      if (t < 1 && on(b - NX, b)) { FY[f] *= t; FY[f + 1] *= t; FY[f + 2] *= t; }
    }
    // barrier books (as the GPU barrier kernel): the theta-scaled flux each barrier face passes this stage, booked while
    // the barrier is up and water stands BAR_OVER over its crest; in stage 0 the peak rate, highest water and load
    const wgt = this.secondOrder ? 0.5 : 1, B = this.bar, { Hp, Ep } = this;
    this.crest.forEach((cf, m) => {
      const b = cf.c, a = b - (cf.axis ? NX : 1), crest = (cf.axis ? CY : CX)[b];
      if ((Hp[a] <= 0 && Hp[b] <= 0) || crest === -Infinity || !on(a, b)) return;
      const ea = Hp[a] > 0.005 ? Ep[a] : -Infinity, eb = Hp[b] > 0.005 ? Ep[b] : -Infinity, w = Math.max(ea, eb);
      const q = (cf.axis ? FY : FX)[b * 9], over = w > crest + BAR_OVER;
      if (over) { const v = q * dx * dt * wgt; if (v > 0) B.plus[m] += v; else B.minus[m] -= v; if (Number.isNaN(B.tOver[m]) && v !== 0) B.tOver[m] = this.t; }
      if (this._stage) return;
      if (over && Math.abs(q) > B.peak[m]) { B.peak[m] = Math.abs(q); B.tPeak[m] = this.t; }
      if (w > B.level[m]) { B.level[m] = w; B.tLevel[m] = this.t; }
      const gr = cf.ground ?? -Infinity, dA = Math.max(0, Math.min(ea, crest) - gr), dB = Math.max(0, Math.min(eb, crest) - gr);
      const load = Number.isFinite(gr) ? 0.5 * g * Math.abs(dA * dA - dB * dB) : 0;
      if (load > B.load[m]) { B.load[m] = load; B.tLoad[m] = this.t; }
    });
    let qout = 0;
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const c = j * NX + i;
      if (!M[c] || !near(c)) { dh[c] = dhu[c] = dhv[c] = 0; continue; }
      const w = c * 9, e = (c + 1) * 9, sth = c * 9, nth = (c + NX) * 9;
      // x direction: normal = hu (F1), tangential = hv (F2)
      const hW = FX[w + 7], zW = FX[w + 8], hE = FX[e + 5], zE = FX[e + 6];
      // y direction: normal = hv, tangential = hu
      const hS = FY[sth + 7], zS = FY[sth + 8], hN = FY[nth + 5], zN = FY[nth + 6];
      const inv = 1 / dx;
      if (lev < 0) {
        dh[c] = -inv * (FX[e] - FX[w] + FY[nth] - FY[sth]);
        dhu[c] = -inv * ((FX[e + 1] + FX[e + 3]) - (FX[w + 1] + FX[w + 4]) + 0.5 * g * (hW + hE) * (zE - zW)
          + FY[nth + 2] - FY[sth + 2]);
        dhv[c] = -inv * ((FY[nth + 1] + FY[nth + 3]) - (FY[sth + 1] + FY[sth + 4]) + 0.5 * g * (hS + hN) * (zN - zS)
          + FX[e + 2] - FX[w + 2]);
        continue;
      }
      // local time stepping: this level's faces only, and the cell's centred bed-slope term only when it steps itself
      // (each face's hydrostatic term pairs with it over the cycle, so still water stays still)
      const kw = wf(c - 1, c), ke = wf(c, c + 1), ks = wf(c - NX, c), kn = wf(c, c + NX), own = this._lv(c) === lev ? 1 : 0;
      dh[c] = -inv * (ke * FX[e] - kw * FX[w] + kn * FY[nth] - ks * FY[sth]);
      dhu[c] = -inv * (ke * (FX[e + 1] + FX[e + 3]) - kw * (FX[w + 1] + FX[w + 4]) + own * 0.5 * g * (hW + hE) * (zE - zW)
        + kn * FY[nth + 2] - ks * FY[sth + 2]);
      dhv[c] = -inv * (kn * (FY[nth + 1] + FY[nth + 3]) - ks * (FY[sth + 1] + FY[sth + 4]) + own * 0.5 * g * (hS + hN) * (zN - zS)
        + ke * FX[e + 2] - kw * FX[w + 2]);
    }
    // boundary mass fluxes (only open boundaries carry flow); with local time stepping an edge face steps with its edge cell
    const ek = (c) => (lev < 0 || this._lv(c) === lev ? 1 : 0);
    for (let j = GH; j < NY - GH; j++) {
      qout -= ek(j * NX + GH) * FX[(j * NX + GH) * 9] * dx;
      qout += ek(j * NX + NX - GH - 1) * FX[(j * NX + NX - GH) * 9] * dx;
    }
    for (let i = GH; i < NX - GH; i++) {
      qout -= ek(GH * NX + i) * FY[(GH * NX + i) * 9] * dx;
      qout += ek((NY - GH - 1) * NX + i) * FY[((NY - GH) * NX + i) * 9] * dx;
    }
    return qout;
  }

  computeDt() {
    const { NX, NY, h, hu, hv, M, g, hdry } = this;
    let smax = 0;
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const c = j * NX + i; const d = h[c];
      if (!M[c] || d <= hdry) continue;
      const cel = Math.sqrt(g * d);
      const s = Math.abs(hu[c] / d) + Math.abs(hv[c] / d) + 2 * cel; // lambda_x + lambda_y
      if (s > smax) smax = s;
    }
    return smax > 0 ? this.cfl * this.dx / smax : Infinity;
  }

  _fix(h, hu, hv) {
    const { NX, NY, M, hdry } = this; let clipped = 0;
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const c = j * NX + i; if (!M[c]) continue;
      if (h[c] < 0) { clipped -= h[c]; h[c] = 0; }
      if (h[c] <= hdry) { hu[c] = 0; hv[c] = 0; }
    }
    this.vol.clipped += clipped * this.dx * this.dx;
  }

  step(dtMax = Infinity) {
    if (this.lts) return this._cycle(dtMax);
    const dtc = this.computeDt();
    // fully dry domain: cap the step so rainfall is applied gradually (matches GPU dtDry)
    let dt = Math.min(isFinite(dtc) ? dtc : this.dtDry, dtMax);
    const { h, hu, hv, h0, hu0, hv0, dh, dhu, dhv, NX, NY, M } = this;
    const A = this.dx * this.dx;
    const interior = (fn) => { for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) { const c = j * NX + i; if (M[c]) fn(c); } };
    if (this.secondOrder) {
      h0.set(h); hu0.set(hu); hv0.set(hv);
      this._stage = 0; const q1 = this._L(h, hu, hv, dt);
      interior(c => { h[c] += dt * dh[c]; hu[c] += dt * dhu[c]; hv[c] += dt * dhv[c]; });
      this._fix(h, hu, hv);
      this._stage = 1; const q2 = this._L(h, hu, hv, dt);
      interior(c => {
        h[c] = 0.5 * (h0[c] + h[c] + dt * dh[c]);
        hu[c] = 0.5 * (hu0[c] + hu[c] + dt * dhu[c]);
        hv[c] = 0.5 * (hv0[c] + hv[c] + dt * dhv[c]);
      });
      this._fix(h, hu, hv);
      this.vol.outflow += dt * 0.5 * (q1 + q2);
    } else {
      this._stage = 0; const q = this._L(h, hu, hv, dt);
      interior(c => { h[c] += dt * dh[c]; hu[c] += dt * dhu[c]; hv[c] += dt * dhv[c]; });
      this._fix(h, hu, hv);
      this.vol.outflow += dt * q;
    }
    this._sources(dt, null, this.t + dt);
    this.t += dt; this.steps++;
    return dt;
  }

  /** Semi-implicit friction, rain, infiltration (GI, Green-Ampt), max depth and hazard over dt, in the cells sel picks (null: all), the step ending at tEnd. */
  _sources(dt, sel, tEnd) {
    const { h, hu, hv, NX, NY, M, g, n, hdry, infil, rainField } = this; const r0 = this.rainRate, A = this.dx * this.dx;
    let rv = 0, iv = 0;
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const c = j * NX + i; if (!M[c] || (sel && !sel(c))) continue;
      const d = h[c];
      if (d > hdry && n[c] > 0) {
        const u = hu[c] / d, v = hv[c] / d;
        const k = 1 + dt * g * n[c] * n[c] * Math.sqrt(u * u + v * v) / Math.pow(d, 4 / 3);
        hu[c] /= k; hv[c] /= k;
      }
      const r = r0 * (rainField ? rainField[c] : 1) * dt;
      let cap = infil[c] * dt;
      if (this.gaPerv[c] > 0) cap = this.gaF[c] >= this.gaFmax[c] ? 0 : Math.min(cap * (1 + this.gaPsiD[c] / Math.max(this.gaF[c], 1e-3)), (this.gaFmax[c] - this.gaF[c]) * this.gaPerv[c]);
      let inf = Math.min(cap, d + r);
      if (this.gaPerv[c] > 0) this.gaF[c] += inf / this.gaPerv[c];
      if (this.giCap[c] > 0) {
        const st = Math.max(0, this.giStore[c] - this.giDrain[c] * dt), g2 = Math.min(this.giRate[c] * dt, d + r - inf, this.giCap[c] - st);
        this.giStore[c] = st + Math.max(0, g2); if (g2 > 0) inf += g2;
      }
      h[c] = Math.max(0, d + r - inf); rv += r; iv += d + r - h[c];
      if (h[c] <= hdry) { hu[c] = 0; hv[c] = 0; }
      if (h[c] > this.maxDepth[c]) this.maxDepth[c] = h[c];
    }
    this.vol.rain += rv * A; this.vol.infil += iv * A;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) { // hazard products, as the GPU hazard kernel
      const c = this.idx(i, j); if (!M[c] || (sel && !sel(c))) continue;
      const d = h[c], k = j * this.nx + i; this.hz.cell(k, d, d >= VCUT ? Math.hypot(hu[c], hv[c]) / d : 0, tEnd, dt, this.scour ? this.scour.tauC[k] : Infinity, this.scour ? this.scour.n[k] : 0);
    }
  }

  /**
   * Local time stepping: one cycle of P = 2^L base steps δ (L = this.lts). δ is LTS_SAFE times the domain's CFL step (the
   * dry step / P when all is dry), and the cycle P·δ ends at dtMax at the latest. Each 8×8 tile takes the largest level
   * m ≤ L whose step 2^m·δ is within LTS_SAFE of the CFL step of the fastest water in it and its 8 neighbours at the
   * cycle start (all dry: L): a wave moves under 4 cells a cycle, so it never reaches a tile slower than its CFL step
   * (a front into dry ground, a surge onto a floodplain); then no tile is more than one level above a face neighbour. In base step k every level whose step ends then (2^m divides k + 1) steps, finest
   * first. A level-m step is the usual SSP-RK2 on the level-m faces (the lower level of their two cells), then sources
   * and hazard products, all with dt = 2^m·δ. A cell one level coarser waits frozen while its finer neighbours step
   * against it, gathering the flux they pass it (each RK stage, weighted as the RK average) into a store that joins the
   * RK start state of its own step, while L is taken at the frozen state the neighbours saw: every face's water goes to
   * both sides once, so mass is exact, and the pressure a fine face passed meets the bed-slope term it balances in the
   * same stages, so still water stays still. Draining-time scaling counts a cell's water plus its store (while it waits
   * and in its first stage), so nothing is drained below zero.
   */
  _cycle(dtMax) {
    const { NX, NY, M, h, hu, hv, g, hdry, LV, _tsp: sp } = this, L = this.lts, P = 1 << L, tx = this.tilesX, ty = this.tilesY;
    sp.fill(0); let smax = 0;
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) {
      const c = j * NX + i, d = h[c]; if (!M[c] || d <= hdry) continue;
      const s = Math.abs(hu[c] / d) + Math.abs(hv[c] / d) + 2 * Math.sqrt(g * d), t = this.TI[c];
      if (s > sp[t]) sp[t] = s; if (s > smax) smax = s;
    }
    const D = Math.min(smax > 0 ? P * LTS_SAFE * this.cfl * this.dx / smax : this.dtDry, dtMax), dl = D / P;
    for (let t = 0; t < LV.length; t++) {
      const x = t % tx, y = (t / tx) | 0; let s = 0;
      for (let b = Math.max(0, y - 1); b <= Math.min(ty - 1, y + 1); b++) for (let a = Math.max(0, x - 1); a <= Math.min(tx - 1, x + 1); a++) s = Math.max(s, sp[b * tx + a]);
      LV[t] = s > 0 ? Math.max(0, Math.min(L, Math.floor(Math.log2(LTS_SAFE * this.cfl * this.dx / s / dl)))) : L;
    }
    for (let p = 0; p < L; p++) for (let t = 0; t < LV.length; t++) { // at most one level above a face neighbour
      const x = t % tx, y = (t / tx) | 0;
      if (x > 0) LV[t] = Math.min(LV[t], LV[t - 1] + 1); if (x < tx - 1) LV[t] = Math.min(LV[t], LV[t + 1] + 1);
      if (y > 0) LV[t] = Math.min(LV[t], LV[t - tx] + 1); if (y < ty - 1) LV[t] = Math.min(LV[t], LV[t + tx] + 1);
    }
    const t0 = this.t;
    for (let k = 0; k < P; k++) for (let m = 0; m <= L; m++) if ((k + 1) % (1 << m) === 0) this._record(m, k === P - 1 ? t0 + D : t0 + (k + 1) * dl, dl * (1 << m));
    this.t = t0 + D; this.steps++;
    return D;
  }
  /** One level-m step of a local-time-stepping cycle (see _cycle), dt = 2^m·δ, ending at tEnd. */
  _record(m, tEnd, dt) {
    const { h, hu, hv, h0, hu0, hv0, dh, dhu, dhv, NX, NY, M, aH, aHu, aHv, hdry } = this, A = this.dx * this.dx;
    const cells = [], coarse = [];
    for (let j = GH; j < NY - GH; j++) for (let i = GH; i < NX - GH; i++) { const c = j * NX + i, l = this._lv(c); if (M[c] && l === m) cells.push(c); else if (M[c] && l === m + 1) coarse.push(c); }
    const fix = () => { let cl = 0; for (const c of cells) { if (h[c] < 0) { cl -= h[c]; h[c] = 0; } if (h[c] <= hdry) { hu[c] = 0; hv[c] = 0; } } this.vol.clipped += cl * A; };
    const w = this.secondOrder ? 0.5 * dt : dt, gather = () => { for (const c of coarse) { aH[c] += w * dh[c]; aHu[c] += w * dhu[c]; aHv[c] += w * dhv[c]; } };
    this._lev = m; this.records++; this.cellSteps += cells.length;
    if (this.secondOrder) {
      // what the finer neighbours passed goes in with the RK start state: L is taken at the frozen state the neighbours saw
      for (const c of cells) { h0[c] = h[c] + aH[c]; hu0[c] = hu[c] + aHu[c]; hv0[c] = hv[c] + aHv[c]; }
      this._stage = 0; const q1 = this._L(h, hu, hv, dt); gather();
      for (const c of cells) { h[c] = h0[c] + dt * dh[c]; hu[c] = hu0[c] + dt * dhu[c]; hv[c] = hv0[c] + dt * dhv[c]; }
      fix();
      this._stage = 1; const q2 = this._L(h, hu, hv, dt); gather();
      for (const c of cells) { h[c] = 0.5 * (h0[c] + h[c] + dt * dh[c]); hu[c] = 0.5 * (hu0[c] + hu[c] + dt * dhu[c]); hv[c] = 0.5 * (hv0[c] + hv[c] + dt * dhv[c]); }
      fix();
      this.vol.outflow += dt * 0.5 * (q1 + q2);
    } else {
      this._stage = 0; const q = this._L(h, hu, hv, dt); gather();
      for (const c of cells) { h[c] += aH[c] + dt * dh[c]; hu[c] += aHu[c] + dt * dhu[c]; hv[c] += aHv[c] + dt * dhv[c]; }
      fix();
      this.vol.outflow += dt * q;
    }
    for (const c of cells) aH[c] = aHu[c] = aHv[c] = 0;
    this._lev = -1;
    this._sources(dt, (c) => this._lv(c) === m, tEnd);
  }

  run(tEnd, onStep) {
    while (this.t < tEnd - 1e-12) { const dt = this.step(tEnd - this.t); if (onStep) onStep(this, dt); }
  }

  massBalance() {
    const v = this.volume(), V = this.vol;
    const expected = V.initial + V.rain - V.infil - V.outflow;
    return { volume: v, expected, error: v - expected, rel: (v - expected) / Math.max(1e-30, Math.max(Math.abs(expected), V.initial + V.rain)), clipped: V.clipped };
  }

  // interior field accessors
  field(name) {
    const src = this[name], out = new Float64Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) out[j * this.nx + i] = src[this.idx(i, j)];
    return out;
  }
}

// HLLC flux in the face-normal frame. Writes F0..F2 at F[f..f+2].
export function hllc(hL, uL, vL, hR, uR, vR, g, hdry, F, f) {
  const wetL = hL > hdry, wetR = hR > hdry;
  if (!wetL && !wetR) { F[f] = 0; F[f + 1] = 0; F[f + 2] = 0; return; }
  if (!wetL) { uL = 0; vL = 0; } if (!wetR) { uR = 0; vR = 0; }
  const cL = Math.sqrt(g * hL), cR = Math.sqrt(g * hR);
  let SL, SR;
  if (!wetL) { SL = uR - 2 * cR; SR = uR + cR; }
  else if (!wetR) { SL = uL - cL; SR = uL + 2 * cL; }
  else {
    const us = 0.5 * (uL + uR) + cL - cR;
    const cs = 0.5 * (cL + cR) + 0.25 * (uL - uR);
    SL = Math.min(uL - cL, us - cs); SR = Math.max(uR + cR, us + cs);
  }
  const FL0 = hL * uL, FL1 = hL * uL * uL + 0.5 * g * hL * hL;
  const FR0 = hR * uR, FR1 = hR * uR * uR + 0.5 * g * hR * hR;
  if (SL >= 0) { F[f] = FL0; F[f + 1] = FL1; F[f + 2] = FL0 * vL; return; }
  if (SR <= 0) { F[f] = FR0; F[f + 1] = FR1; F[f + 2] = FR0 * vR; return; }
  const den = SR - SL;
  const H0 = (SR * FL0 - SL * FR0 + SL * SR * (hR - hL)) / den;
  const H1 = (SR * FL1 - SL * FR1 + SL * SR * (hR * uR - hL * uL)) / den;
  const dSM = hR * (uR - SR) - hL * (uL - SL);
  const SM = Math.abs(dSM) > 1e-300 ? (SL * hR * (uR - SR) - SR * hL * (uL - SL)) / dSM : 0;
  F[f] = H0; F[f + 1] = H1; F[f + 2] = H0 * (SM >= 0 ? vL : vR);
}
