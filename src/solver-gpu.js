// FloodSim WebGPU solver host. Same physics and API shape as CPUSolver, async where the GPU is involved.
import { KERNELS_WGSL } from './kernels.wgsl.js';
import { CT, FT, cellVolume } from './subgrid.js';

const GH = 2;
const BC = { wall: 0, open: 1, outflow: 2 };
const TILE = 8;
/** Infiltration rate (m/s) that makes a cell a sink: anything flowing into it leaves the model within a step. */
const SINK_RATE = 100;
/** Storage buffers the tiled update binds; below this limit the solver runs untiled. */
export const TILED_STORAGE_BUFFERS = 9;

export class GPUSolver {
  /**
   * Same options as CPUSolver, plus device. Bed elevations are stored relative to their minimum (fp32 headroom).
   * o.sink: interior cells outside the modelled area (polygon areas). They take no rain and remove whatever flows into
   * them, so the area edge behaves as a free overfall; that water is booked as outflow.
   * o.crest: flood-barrier faces [{ i, j, axis, z, C, ground }]: axis 0 = the face between cells (i−1, j) and (i, j),
   * axis 1 = between (i, j−1) and (i, j); z = crest (m, absolute; −Infinity = not deployed), C = weir coefficient
   * (m^½/s), ground = ground under the barrier (m, for the hydrostatic load).
   * Every step the solver also tracks the hazard products of src/hazard.js per cell (readHazard).
   * o.scour: { tauC, n } per cell (src/scour.js): bed shear and scour potential tracked every step (readHazard).
   * o.ga: Green-Ampt infiltration ({ psiD, fmax, perv } per cell from src/soil.js gaCells; o.infil is then K, cell basis).
   * o.subgrid: a buildSubgrid() model (src/subgrid.js) runs the opt-in speed mode: local inertial on these cells with
   * 1 m storage and conveyance tables. Then o.z is each cell's lowest open ground, U.x is stored volume per cell area,
   * the packed depth is the depth at the lowest point, and readState's hmax is the peak water level (absolute).
   * o.tiles: active-tile dispatch (fluxes and updates only on 8×8 tiles near water; identical results). Default: on
   * when the device allows TILED_STORAGE_BUFFERS storage buffers per stage.
   * o.lines: control-line faces [{ i, j, axis, line, sign }] (src/compare.js lineFaces): the volume across each line is
   * booked every step (readLines); sign maps the face's + direction (from cell i−1 / j−1 into i / j) to the line's.
   */
  constructor(device, o) {
    this.device = device;
    this.nx = o.nx; this.ny = o.ny; this.dx = o.dx;
    this.NX = o.nx + 2 * GH; this.NY = o.ny + 2 * GH;
    this.g = o.g ?? 9.81;
    this.sg = o.subgrid ?? null;
    this.cfl = o.cfl ?? (this.sg ? 0.5 : (o.secondOrder ?? true) ? 0.48 : 0.9);
    this.hdry = o.hdry ?? 1e-5; this.hfront = o.hfront ?? 1e-3;
    this.secondOrder = this.sg ? false : o.secondOrder ?? true; // local inertial is a single explicit stage
    this.limiter = o.limiter === 'vanleer' ? 1 : 0;
    this.bc = Object.assign({ west: 'wall', east: 'wall', south: 'wall', north: 'wall' }, o.bc || {});
    this.dtDry = o.dtDry ?? 1.0;
    this.rainRate = 0;
    const N = this.NX * this.NY; this.N = N;

    // host-side padded arrays
    let zmin = Infinity; for (let k = 0; k < o.z.length; k++) if (o.z[k] < zmin) zmin = o.z[k];
    this.zref = zmin;
    this.Sh = new Float32Array(N * 4); // z, n, mask, infil
    this.Uh = new Float32Array(N * 4);
    this.zh = new Float64Array(N);
    this.RFh = new Float32Array(N).fill(1); // optional o.rainField: per-cell rain multiplier (roof routing)
    this.sinkC = new Uint8Array(N);
    let active = 0, rainCells = 0;
    for (let j = 0; j < this.NY; j++) for (let i = 0; i < this.NX; i++) {
      const ii = Math.min(Math.max(i - GH, 0), this.nx - 1), jj = Math.min(Math.max(j - GH, 0), this.ny - 1);
      const k = jj * this.nx + ii, c = j * this.NX + i;
      const interior = i >= GH && i < this.NX - GH && j >= GH && j < this.NY - GH;
      const m = interior ? (o.mask ? o.mask[k] : 1) : 1;
      this.zh[c] = o.z[k] - zmin;
      this.Sh[c * 4] = this.zh[c];
      this.Sh[c * 4 + 1] = typeof o.manning === 'number' ? o.manning : (o.manning ? o.manning[k] : 0);
      this.Sh[c * 4 + 2] = m;
      this.Sh[c * 4 + 3] = o.infil ? (typeof o.infil === 'number' ? o.infil : o.infil[k]) : 0;
      if (interior && o.rainField) this.RFh[c] = o.rainField[k];
      if (interior && o.sink?.[k]) { this.sinkC[c] = 1; this.Sh[c * 4 + 3] = SINK_RATE; this.RFh[c] = 0; }
      if (interior && m && !this.sinkC[c]) { active++; rainCells += this.RFh[c]; }
    }
    // green infrastructure (o.gi: { rate, cap, drain } per interior cell, m/s, m, m/s; omitted = none)
    this.GIh = new Float32Array(N * 4); this.hasGI = !!o.gi;
    if (o.gi) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, c = this.idx(i, j); if (!(o.gi.cap[k] > 0)) continue;
      this.GIh[c * 4] = o.gi.rate[k]; this.GIh[c * 4 + 1] = o.gi.cap[k]; this.GIh[c * 4 + 2] = o.gi.drain[k]; this.GIh[c * 4 + 3] = o.gi.under?.[k] ?? 0;
    }
    // underdrains (o.underdrains: interior cells whose GI store has one, gathered by readUnderdrains)
    this.nUnder = o.underdrains?.length ?? 0; this.UDCh = new Uint32Array(Math.max(1, this.nUnder));
    (o.underdrains ?? []).forEach((k, m) => { this.UDCh[m] = this.idx(k % this.nx, (k / this.nx) | 0); });
    // Green-Ampt (o.ga: { psiD, fmax, perv } per interior cell, src/soil.js gaCells; o.infil is then K on the cell basis)
    this.GAPh = new Float32Array(N * 4); this.hasGA = !!o.ga;
    if (o.ga) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, c = this.idx(i, j); if (this.sinkC[c] || !(o.ga.perv[k] > 0)) continue;
      this.GAPh.set([o.ga.psiD[k], Math.min(o.ga.fmax[k], 1e6), o.ga.perv[k], 1], c * 4);
    }
    // scour (o.scour: { tauC (Pa), n } per interior cell; omitted = no shear tracked)
    this.TCh = new Float32Array(N * 4); for (let c = 0; c < N; c++) this.TCh[4 * c] = 1e9;
    if (o.scour) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) { const k = j * this.nx + i, c = this.idx(i, j); this.TCh[4 * c] = Math.min(1e9, o.scour.tauC[k]); this.TCh[4 * c + 1] = o.scour.n[k]; }
    // sediment transport (o.sediment, per interior cell, from src/sediment.js: erodible (4 per cell: clay, silt, sand,
    // gravel, m of bed), dSand, dGravel (m), tauSoil, nSkin, and for o.debris cohesion (Pa), tanPhi, soilDepth (m),
    // thetaE; with o.scour; not in the subgrid mode). o.debris: the debris-flow mode (mixture flow, slope failures).
    this.sed = !!o.sediment && !this.sg; this.debris = this.sed && !!o.debris;
    // SDh: 5 vec4 per cell: suspended, store change, out, (pore, failure time, bedload out), active (surface) layer
    this.SDh = new Float32Array(this.sed ? N * 20 : 4); this.SDPh = new Float32Array(this.sed ? N * 4 : 4); this.SE0h = new Float32Array(this.sed ? N * 8 : 4);
    if (this.sed) for (let c = 0; c < N; c++) { this.SE0h[8 * c + 4] = this.Sh[4 * c]; this.SDh[20 * c + 13] = -1; } // every cell's initial bed, ghosts too
    if (this.sed) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, c = this.idx(i, j), sd = o.sediment;
      this.TCh[4 * c + 2] = sd.dSand?.[k] ?? 0.15e-3; this.TCh[4 * c + 3] = sd.dGravel?.[k] ?? 8e-3;
      for (let m = 0; m < 4; m++) this.SE0h[8 * c + m] = sd.erodible[4 * k + m];
      // the active (surface) layer starts as the top La of a well-mixed store (kernel sedLa)
      { const e = [0, 1, 2, 3].map(m => sd.erodible[4 * k + m]), tot = e.reduce((p, q) => p + q, 0), La = Math.max(0.01, 2 * (e[3] > 0.05 * tot ? this.TCh[4 * c + 3] : this.TCh[4 * c + 2]));
        if (tot > 0) for (let m = 0; m < 4; m++) this.SDh[20 * c + 16 + m] = e[m] * Math.min(1, La / tot); }
      this.SE0h[8 * c + 5] = sd.soilDepth?.[k] ?? 1.5; this.SE0h[8 * c + 6] = sd.thetaE?.[k] ?? 0.4;
      this.SDPh.set([sd.tauSoil?.[k] ?? this.TCh[4 * c], sd.nSkin?.[k] ?? this.TCh[4 * c + 1], sd.cohesion?.[k] ?? 2000, sd.tanPhi?.[k] ?? 0.58], 4 * c);
    }
    // bank stability (o.banks from src/banks.js findBanks: top, toe as interior indices, L, c, tanPhi, T, wt depth or null)
    const bk = this.sg ? [] : (o.banks ?? []); this.nBank = bk.length;
    this.BKh = new Float32Array(Math.max(8, bk.length * 8)); this.BRh = new Float32Array(Math.max(12, bk.length * 12));
    bk.forEach((q, b) => {
      const top = this.idx(q.top % this.nx, (q.top / this.nx) | 0), toe = this.idx(q.toe % this.nx, (q.toe / this.nx) | 0);
      this.BKh.set([top, toe, q.L, q.c, q.tanPhi, q.T, q.wt != null ? this.zh[top] - q.wt : -1e30, 0], 8 * b);
      this.BRh.set([-1e30, 1e30, 0, -1, 1e30, 0, 0, -1, 0, 0, 1, 0], 12 * b);
    });
    // drainage inlets (o.inlets: interior cell indices k = j*nx+i, unique)
    const ink = o.inlets ? Array.from(o.inlets) : [];
    this.nInlets = ink.length;
    this.INCh = new Uint32Array(Math.max(4, ink.length)); ink.forEach((k, m) => { this.INCh[m] = this.idx(k % this.nx, (k / this.nx) | 0); });
    this.activeArea = active * this.dx * this.dx;
    this.rainArea = rainCells * this.dx * this.dx; // effective area receiving rain, incl. routed roof area
    this.t = 0; this.steps = 0;
    this.vol = { rain: 0, initial: 0, exchanged: 0 };
    // water-level boundary (o.stageCells: interior edge cells k whose outward ghosts see the external stage)
    this.STGh = new Float32Array(N); this.stage = -1e9;
    for (const k of o.stageCells || []) {
      const i = k % this.nx, j = (k / this.nx) | 0;
      for (let g2 = 1; g2 <= GH; g2++) {
        if (i === 0) this.STGh[this.idx(-g2, j)] = 1; if (i === this.nx - 1) this.STGh[this.idx(this.nx - 1 + g2, j)] = 1;
        if (j === 0) this.STGh[this.idx(i, -g2)] = 1; if (j === this.ny - 1) this.STGh[this.idx(i, this.ny - 1 + g2)] = 1;
      }
    }
    // active tiles: tile grid covers the nx+1 / ny+1 faces; inlet and stage-edge tiles are always active
    this.tilesX = Math.ceil((this.nx + 1) / TILE); this.tilesY = Math.ceil((this.ny + 1) / TILE); this.tiles = this.tilesX * this.tilesY;
    this.tiled = (o.tiles ?? true) && device.limits.maxStorageBuffersPerShaderStage >= TILED_STORAGE_BUFFERS;
    this.TSh = new Uint32Array(this.tiles);
    const pin = (k) => { this.TSh[Math.floor(((k / this.nx) | 0) / TILE) * this.tilesX + Math.floor((k % this.nx) / TILE)] = 1; };
    ink.forEach(pin); for (const k of o.stageCells || []) pin(k);
    // flood barriers: crest and weir coefficient on each listed face (see setCrestLevels)
    this.crest = (o.crest ?? []).map(f => ({ ...f, c: this.idx(f.i, f.j) }));
    this.nBar = this.crest.length;
    this.CRh = new Float32Array(N * 4); for (let c = 0; c < N; c++) { this.CRh[c * 4] = -1e30; this.CRh[c * 4 + 2] = -1e30; }
    this.BFh = new Uint32Array(Math.max(4, this.nBar)); this.crest.forEach((f, m) => { this.BFh[m] = f.c * 2 + (f.axis ? 1 : 0); });
    this.BQh = new Float32Array(this.BFh.length * 12); // highest water starts at −1e30, first overtopping at −1 (never)
    this.crest.forEach((f, m) => { this.BQh[12 * m + 5] = -1e30; this.BQh[12 * m + 7] = Number.isFinite(f.ground) ? f.ground - this.zref : -1e30; this.BQh[12 * m + 11] = -1; });
    this._fillCrest(this.crest.map(f => f.z));
    // control lines: faces to book, each with its line and sign
    this.lines = (o.lines ?? []).map(f => ({ ...f, c: this.idx(f.i, f.j) })); this.nLine = this.lines.length;
    this.nLines = this.lines.reduce((n, f) => Math.max(n, f.line + 1), 0);
    this.LFh = new Uint32Array(Math.max(4, this.nLine)); this.lines.forEach((f, m) => { this.LFh[m] = f.c * 2 + (f.axis ? 1 : 0); });
    if (this.sg) this._subgridTables();
    this._build();
  }

  idx(i, j) { return (j + GH) * this.NX + (i + GH); }

  /** Subgrid tables on the padded grid, elevations relative to zref (wall cells and faces stay blocked). */
  _subgridTables() {
    const { sg, N, nx, ny } = this, zr = this.zref;
    const pad = (n, w) => { const a = new Float32Array(n * w); for (let c = 0; c < n; c++) { a[c * w] = 1e30; a[c * w + 1] = 1; } return a; };
    const put = (dst, c, src, o, w) => { for (let q = 0; q < w; q++) dst[c * w + q] = src[o + q]; if (src[o] < 1e29) dst[c * w] = src[o] - zr; };
    this.SGCh = pad(N, CT); this.SGFh = pad(2 * N, FT); // x-faces, then y-faces from padded cell N on
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) put(this.SGCh, this.idx(i, j), sg.ct, (j * nx + i) * CT, CT);
    for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) put(this.SGFh, this.idx(i, j), sg.fx, (j * (nx + 1) + i) * FT, FT);
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) put(this.SGFh, N + this.idx(i, j), sg.fy, (j * nx + i) * FT, FT);
  }

  _build() {
    const d = this.device, N = this.N;
    d.pushErrorScope('validation');
    const SB = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const mk = (size, usage = SB) => d.createBuffer({ size: Math.max(16, size), usage });
    this.buf = {
      params: mk(112, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      U: mk(N * 16), U0: mk(N * 16), S: mk(N * 16), W: mk(N * 16),
      FX: mk(N * 36), FY: mk(N * 36), A: mk(N * 16), DT: mk(16), RED: mk(4),
      OUT: mk(this.nx * this.ny * 8), TH: mk(N * 4), RF: mk(N * 4),
      INC: mk(this.INCh.byteLength), INQ: mk(this.INCh.length * 4), INX: mk(this.INCh.length * 16), STG: mk(N * 4),
      TF: mk(this.tiles * 4), TS: mk(this.tiles * 4), TL: mk(this.tiles * 8), TC: mk(8),
      TA: mk(24, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST),
      GI: mk(N * 16), GS: mk(N * 16), GAP: mk(N * 16),
      CR: mk(N * 16), BF: mk(this.BFh.byteLength), BQ: mk(this.BFh.length * 48), HZ: mk(N * 64), LF: mk(this.LFh.byteLength), CL: mk(this.LFh.length * 16), UDC: mk(this.UDCh.byteLength), UDX: mk(this.UDCh.length * 4), SCR: mk(N * 16), SDA: mk(this.sed ? N * 80 : 16), SDB: mk(this.sed ? N * 80 : 16), SDP: mk(this.sed ? N * 16 : 16), SE0: mk(this.sed ? N * 32 : 16), BK: mk(this.BKh.byteLength), BR: mk(this.BRh.byteLength),
      SGC: mk(this.sg ? N * CT * 4 : 16), SGF: mk(this.sg ? 2 * N * FT * 4 : 16), EO: mk(2 * (this.nx + this.ny) * 8),
    };
    this.read = {
      DT: mk(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
      OUT: mk(this.nx * this.ny * 8, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
      INX: mk(this.INCh.length * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
      BQ: mk(this.BFh.length * 48, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
    };
    d.queue.writeBuffer(this.buf.S, 0, this.Sh);
    d.queue.writeBuffer(this.buf.U, 0, this.Uh);
    d.queue.writeBuffer(this.buf.TH, 0, new Float32Array(N).fill(1));
    d.queue.writeBuffer(this.buf.RF, 0, this.RFh);
    d.queue.writeBuffer(this.buf.INC, 0, this.INCh);
    d.queue.writeBuffer(this.buf.STG, 0, this.STGh);
    d.queue.writeBuffer(this.buf.TS, 0, this.TSh);
    d.queue.writeBuffer(this.buf.GI, 0, this.GIh);
    d.queue.writeBuffer(this.buf.GAP, 0, this.GAPh);
    d.queue.writeBuffer(this.buf.CR, 0, this.CRh);
    d.queue.writeBuffer(this.buf.BF, 0, this.BFh);
    d.queue.writeBuffer(this.buf.BQ, 0, this.BQh);
    if (this.sg) { d.queue.writeBuffer(this.buf.SGC, 0, this.SGCh); d.queue.writeBuffer(this.buf.SGF, 0, this.SGFh); }
    const hz = new Float32Array(N * 16); for (let c = 0; c < N; c++) { hz[16 * c + 3] = -1; hz[16 * c + 13] = -1; } d.queue.writeBuffer(this.buf.HZ, 0, hz);
    d.queue.writeBuffer(this.buf.LF, 0, this.LFh); d.queue.writeBuffer(this.buf.UDC, 0, this.UDCh);
    d.queue.writeBuffer(this.buf.SCR, 0, this.TCh);
    if (this.nBank) { d.queue.writeBuffer(this.buf.BK, 0, this.BKh); d.queue.writeBuffer(this.buf.BR, 0, this.BRh); }
    if (this.sed) { d.queue.writeBuffer(this.buf.SDA, 0, this.SDh); d.queue.writeBuffer(this.buf.SDB, 0, this.SDh); d.queue.writeBuffer(this.buf.SDP, 0, this.SDPh); d.queue.writeBuffer(this.buf.SE0, 0, this.SE0h); }
    this._writeParams(0);

    const mod = d.createShaderModule({ code: KERNELS_WGSL });
    this.module = mod;
    const B = [this.buf.params, this.buf.U, this.buf.U0, this.buf.S, this.buf.W, this.buf.FX, this.buf.FY, this.buf.A, this.buf.DT, this.buf.RED, this.buf.OUT, this.buf.TH, this.buf.RF, this.buf.INC, this.buf.INQ, this.buf.INX, this.buf.STG,
      this.buf.TF, this.buf.TS, this.buf.TL, this.buf.TC, this.buf.TA, this.buf.GI, this.buf.GS, this.buf.CR, this.buf.BF, this.buf.BQ, this.buf.HZ, this.buf.SGC, this.buf.SGF, this.buf.EO, this.buf.GAP, this.buf.SCR, this.buf.SDA, this.buf.SDB, this.buf.SDP, this.buf.SE0, this.buf.BK, this.buf.BR, this.buf.LF, this.buf.CL, this.buf.UDC, this.buf.UDX];
    const uses = {
      prim: [0, 1, 3, 4, 16], faceX: [0, 3, 4, 5, 8, 24], faceY: [0, 3, 4, 6, 8, 24], barrier: [0, 4, 5, 6, 8, 11, 24, 25, 26], hazard: [0, 1, 3, 8, 27, 32], resetTotals: [0, 7], edgeOut: [0, 4, 5, 6, 8, 11, 30],
      sgPrim: [0, 1, 4, 16, 28], sgFluxX: [0, 4, 5, 6, 8, 9, 11, 24, 29], sgFluxY: [0, 4, 5, 6, 8, 9, 11, 24, 29], sgUpdate: [0, 1, 3, 5, 6, 7, 8, 11],
      sgHazard: [0, 1, 5, 6, 7, 8, 27, 28, 32], sgDt: [0, 1, 9, 28], sgPack: [0, 1, 5, 6, 10, 28], sgExchange: [0, 1, 8, 13, 14, 15, 28],
      update: [0, 1, 2, 3, 5, 6, 7, 8, 11], theta: [0, 1, 3, 5, 6, 8, 11], sources: [0, 1, 3, 7, 8, 12, 22, 23, 31],
      dtReduce: [0, 1, 3, 9], dtFinal: [0, 8, 9], pack: [0, 1, 10], exchange: [0, 1, 8, 13, 14, 15],
      tileClear: [0, 17, 20], tileWet: [0, 1, 17], tileList: [0, 17, 18, 19, 20], tileArgs: [20, 21],
    };
    const T = (u) => [...u, 19];
    const make = (entry, binds, constants) => {
      const pipeline = d.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: entry, constants } });
      const bg = d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: binds.map(b => ({ binding: b, resource: { buffer: B[b] } })) });
      return { pipeline, bg };
    };
    this.k = {
      prim: make('prim', uses.prim), faceX: make('faceX', uses.faceX), faceY: make('faceY', uses.faceY),
      theta: make('theta', uses.theta),
      update0: make('update', uses.update, { STAGE: 0 }), update1: make('update', uses.update, { STAGE: 1 }),
      sources: make('sources', uses.sources), dtReduce: make('dtReduce', uses.dtReduce),
      dtFinal: make('dtFinal', uses.dtFinal), pack: make('pack', uses.pack),
      exchange: make('exchange', uses.exchange), barrier0: make('barrier', uses.barrier, { STAGE: 0 }), barrier1: make('barrier', uses.barrier, { STAGE: 1 }),
      hazard: make('hazard', uses.hazard), resetTotals: make('resetTotals', uses.resetTotals), edgeOut: make('edgeOut', uses.edgeOut),
      ...(this.nLine ? { lineFlux: make('lineFlux', [0, 4, 5, 6, 8, 11, 39, 40]) } : {}), ...(this.nUnder ? { udGather: make('udGather', [23, 41, 42]) } : {}),
    };
    if (this.tiled) Object.assign(this.k, {
      tileClear: make('tileClear', uses.tileClear), tileWet: make('tileWet', uses.tileWet),
      tileList: make('tileList', uses.tileList), tileArgs: make('tileArgs', uses.tileArgs),
      faceXT: make('faceXT', T(uses.faceX), { LIST: 2 }), faceYT: make('faceYT', T(uses.faceY), { LIST: 2 }),
      thetaT: make('thetaT', T(uses.theta), { LIST: 2 }), sourcesT: make('sourcesT', T(uses.sources), { LIST: 1 }),
      hazardT: make('hazardT', T(uses.hazard), { LIST: 1 }),
      updateT0: make('updateT', T(uses.update), { STAGE: 0, LIST: 1 }), updateT1: make('updateT', T(uses.update), { STAGE: 1, LIST: 1 }),
    });
    if (this.sg) {
      Object.assign(this.k, {
        sgPrim: make('sgPrim', uses.sgPrim), sgDt: make('sgDt', uses.sgDt), sgPack: make('sgPack', uses.sgPack), sgExchange: make('sgExchange', uses.sgExchange),
        sgFluxX: make('sgFluxX', uses.sgFluxX), sgFluxY: make('sgFluxY', uses.sgFluxY), sgUpdate: make('sgUpdate', uses.sgUpdate), sgHazard: make('sgHazard', uses.sgHazard),
        sgSources: make('sources', uses.sources, { TRACKMAX: false }),
      });
      if (this.tiled) Object.assign(this.k, {
        sgFluxXT: make('sgFluxXT', T(uses.sgFluxX), { LIST: 2 }), sgFluxYT: make('sgFluxYT', T(uses.sgFluxY), { LIST: 2 }),
        sgUpdateT: make('sgUpdateT', T(uses.sgUpdate), { LIST: 1 }), sgHazardT: make('sgHazardT', T(uses.sgHazard), { LIST: 1 }),
        sgSourcesT: make('sourcesT', T(uses.sources), { LIST: 1, TRACKMAX: false }),
      });
    }
    if (this.sed) { // ping-pong: [A → B, B → A]; this.sedPar = which buffer holds the latest state (0 = A)
      // the debris mode compiles its own module with DEBRIS fixed (Dawn has crashed on the override across these pipelines)
      const sm = this.debris ? d.createShaderModule({ code: KERNELS_WGSL.replace('override DEBRIS: bool = false;', 'const DEBRIS: bool = true;') }) : mod;
      const pp = (entry, binds) => {
        const pipeline = d.createComputePipeline({ layout: 'auto', compute: { module: sm, entryPoint: entry } });
        const bg = (inB, outB) => d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: binds.map(b => ({ binding: b, resource: { buffer: b === 33 ? inB : b === 34 ? outB : B[b] } })) });
        return [{ pipeline, bg: bg(this.buf.SDA, this.buf.SDB) }, { pipeline, bg: bg(this.buf.SDB, this.buf.SDA) }];
      };
      this.k.sedAdvect = pp('sedAdvect', [0, 1, 5, 6, 8, 11, 33, 34]); this.k.sedSource = pp('sedSource', [0, 1, 3, 5, 6, 8, 32, 33, 34, 35, 36]); this.sedPar = 0;
      if (this.debris) this.k.slopeFail = pp('slopeFail', [0, 1, 3, 8, 23, 32, 33, 34, 35, 36]);
    }
    if (this.nBank) this.k.bankFS = make('bankFS', [1, 3, 8, 37, 38]);
    // resolves when the pipelines are known good; rejects with the WGSL/validation error otherwise
    this.ready = d.popErrorScope().then((e) => { if (e) throw new Error('GPU pipeline error: ' + e.message); });
  }

  _writeParams(tEnd) {
    const ab = new ArrayBuffer(112), u = new Uint32Array(ab), f = new Float32Array(ab);
    u[0] = this.nx; u[1] = this.ny; u[2] = this.NX; u[3] = this.NY;
    f[4] = this.dx; f[5] = this.g; f[6] = this.hdry; f[7] = this.hfront;
    f[8] = this.cfl; f[9] = this.rainRate; f[10] = tEnd; f[11] = this.dtDry;
    u[12] = this.secondOrder ? 1 : 0; u[13] = this.limiter;
    u[18] = this.nInlets; f[19] = this.stage - this.zref; u[14] = BC[this.bc.west]; u[15] = BC[this.bc.east]; u[16] = BC[this.bc.south]; u[17] = BC[this.bc.north];
    u[20] = this.tilesX; u[21] = this.tilesY; u[22] = this.tiles; u[23] = this.nBar; u[24] = this.nLine;
    this.device.queue.writeBuffer(this.buf.params, 0, ab);
  }

  setDepth(fn) {
    let v = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j);
      const h = this.Sh[c * 4 + 2] ? Math.max(0, fn((i + 0.5) * this.dx, (j + 0.5) * this.dx, this.zh[c] + this.zref)) : 0;
      const vol = this.sg && h > 0 ? cellVolume(this.sg.ct, (j * this.nx + i) * CT, this.zh[c] + this.zref + h) : h; // subgrid: stored volume per area
      this.Uh[c * 4] = vol; v += Math.fround(vol);
    }
    this.vol.initial = v * this.dx * this.dx;
    this.device.queue.writeBuffer(this.buf.U, 0, this.Uh);
  }
  setVelocity(fn) {
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j); const [u, v] = fn((i + 0.5) * this.dx, (j + 0.5) * this.dx);
      this.Uh[c * 4 + 1] = this.Uh[c * 4] * u; this.Uh[c * 4 + 2] = this.Uh[c * 4] * v;
    }
    this.device.queue.writeBuffer(this.buf.U, 0, this.Uh);
  }

  _dispatch(pass, kk, x, y = 1) { pass.setPipeline(kk.pipeline); pass.setBindGroup(0, kk.bg); pass.dispatchWorkgroups(x, y); }
  _indirect(pass, kk, list) { pass.setPipeline(kk.pipeline); pass.setBindGroup(0, kk.bg); pass.dispatchWorkgroupsIndirect(this.buf.TA, list === 1 ? 0 : 12); }

  encodeSteps(pass, K) {
    if (this.sg) return this._encodeSubgrid(pass, K);
    const w = n => Math.ceil(n / 8), { nx, ny, NX, NY, k } = this;
    for (let s = 0; s < K; s++) {
      this._dispatch(pass, k.dtReduce, w(nx), w(ny));
      this._dispatch(pass, k.dtFinal, 1);
      if (this.tiled) { // tile lists from the depths at the start of the step
        const t64 = Math.ceil(this.tiles / 64);
        this._dispatch(pass, k.tileClear, t64); this._dispatch(pass, k.tileWet, w(nx), w(ny));
        this._dispatch(pass, k.tileList, t64); this._dispatch(pass, k.tileArgs, 1);
      }
      const stages = this.secondOrder ? [0, 1] : [0];
      for (const st of stages) {
        this._dispatch(pass, k.prim, w(NX), w(NY));
        if (this.tiled) {
          this._indirect(pass, k.faceXT, 2); this._indirect(pass, k.faceYT, 2); this._indirect(pass, k.thetaT, 2);
          if (this.nBar) this._dispatch(pass, st ? k.barrier1 : k.barrier0, Math.ceil(this.nBar / 64));
          this._dispatch(pass, k.edgeOut, Math.ceil(2 * (this.nx + this.ny) / 64));
          if (this.nLine) this._dispatch(pass, k.lineFlux, Math.ceil(this.nLine / 64));
          if (this.sed) this._sed(pass, k.sedAdvect);
          this._indirect(pass, st ? k.updateT1 : k.updateT0, 1);
        } else {
          this._dispatch(pass, k.faceX, w(nx + 1), w(ny));
          this._dispatch(pass, k.faceY, w(nx), w(ny + 1));
          this._dispatch(pass, k.theta, w(nx), w(ny));
          if (this.nBar) this._dispatch(pass, st ? k.barrier1 : k.barrier0, Math.ceil(this.nBar / 64));
          this._dispatch(pass, k.edgeOut, Math.ceil(2 * (this.nx + this.ny) / 64));
          if (this.nLine) this._dispatch(pass, k.lineFlux, Math.ceil(this.nLine / 64));
          if (this.sed) this._sed(pass, k.sedAdvect);
          this._dispatch(pass, st ? k.update1 : k.update0, w(nx), w(ny));
        }
      }
      if (this.tiled) this._indirect(pass, k.sourcesT, 1); else this._dispatch(pass, k.sources, w(nx), w(ny));
      if (this.tiled) this._indirect(pass, k.hazardT, 1); else this._dispatch(pass, k.hazard, w(nx), w(ny));
      if (this.sed) this._sed(pass, k.sedSource);
      if (this.debris) this._sed(pass, k.slopeFail);
      if (this.nBank) this._dispatch(pass, k.bankFS, Math.ceil(this.nBank / 64));
      if (this.nInlets) this._dispatch(pass, k.exchange, Math.ceil(this.nInlets / 64));
    }
  }
  /** One sediment pass over the whole grid, reading the latest state and writing the other buffer. */
  _sed(pass, pair) { this._dispatch(pass, pair[this.sedPar], Math.ceil(this.nx / 8), Math.ceil(this.ny / 8)); this.sedPar ^= 1; }

  /** Sediment per interior cell: suspended solids per area (m, all classes), bed change (m), bed store left (m), the
   *  bed's geometric mean grain size (m), and slope failures (time, s; −1 none); per class (clay, silt, sand, gravel)
   *  suspended, store and carried out (m³) in `classes`. Solids are conserved per class: Σ suspended
   *  + (1 − porosity)·Σ store change + out = 0 (from a clean start). */
  async readSediment() {
    const a = await this._readBuffer(this.sedPar ? this.buf.SDB : this.buf.SDA, this.N * 80), n = this.nx * this.ny, A = this.dx * this.dx;
    const o = { suspended: new Float32Array(n), bed: new Float32Array(n), erodible: new Float32Array(n), size: new Float32Array(n), storeSize: new Float32Array(n), surfaceGravel: new Float32Array(n), storeGravel: new Float32Array(n), failed: new Float32Array(n), out: 0, pore: 0,
      classes: ['clay', 'silt', 'sand', 'gravel'].map(name => ({ name, suspended: 0, store: 0, change: 0, out: 0 })), totals: { suspended: 0, eroded: 0, deposited: 0, failures: 0 } };
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, c = this.idx(i, j), q = 20 * c, d = [2e-6, 3e-5, this.TCh[4 * c + 2], this.TCh[4 * c + 3]];
      let st = 0, ld = 0, db = 0, at = 0, la = 0;
      for (let m = 0; m < 4; m++) {
        const cl = o.classes[m], e = this.SE0h[8 * c + m] + a[q + 4 + m]; o.suspended[k] += a[q + m]; st += e; db += a[q + 4 + m];
        const out = a[q + 8 + m] + (m >= 2 ? a[q + 12 + m] : 0); // in suspension, plus sand and gravel as bedload
        cl.suspended += a[q + m] * A; cl.store += e * A; cl.change += a[q + 4 + m] * A; cl.out += out * A; o.out += out * A;
        if (e > 0) ld += e * Math.log(d[m]);
        const al = a[q + 16 + m]; if (al > 0) { at += al; la += al * Math.log(d[m]); }
      }
      // size: the bed's surface (the active layer: an armour shows here), storeSize: the whole erodible store
      o.erodible[k] = st; o.bed[k] = db; o.storeSize[k] = st > 0 ? Math.exp(ld / st) : 0; o.size[k] = at > 0 ? Math.exp(la / at) : o.storeSize[k];
      o.storeGravel[k] = st > 0 ? (this.SE0h[8 * c + 3] + a[q + 7]) / st : 0; o.surfaceGravel[k] = at > 0 ? a[q + 19] / at : o.storeGravel[k]; o.failed[k] = a[q + 13]; o.pore += a[q + 12] * A;
      if (a[q + 13] >= 0) o.totals.failures++;
      o.totals.suspended += o.suspended[k] * A; if (o.bed[k] < 0) o.totals.eroded -= o.bed[k] * A; else o.totals.deposited += o.bed[k] * A;
    }
    return o;
  }
  /** Bank stability per bank (in o.banks order): lowest factor of safety and highest probability of failure over the
   *  run (given the bank stood at the start; −1 = not rated), with their times (s; −1 = never), now, the highest channel
   *  water against the bank (m), the bank water table (m), and the start's levels over the toe. */
  async readBanks() {
    const a = this.nBank ? await this._readBuffer(this.buf.BR, this.nBank * 48) : new Float32Array(0), n = this.nBank;
    const o = { minFS: new Float32Array(n), maxPf: new Float32Array(n), tMaxPf: new Float32Array(n), tMinFS: new Float32Array(n), fsNow: new Float32Array(n), pfNow: new Float32Array(n), hwMax: new Float32Array(n), table: new Float32Array(n), start: [], stand: new Float32Array(n) };
    for (let b = 0; b < n; b++) {
      const q = 12 * b; o.table[b] = a[q] + this.zref; o.minFS[b] = a[q + 1]; o.maxPf[b] = a[q + 2]; o.tMaxPf[b] = a[q + 3]; o.fsNow[b] = a[q + 4]; o.pfNow[b] = a[q + 5]; o.hwMax[b] = a[q + 6]; o.tMinFS[b] = a[q + 7];
      o.start.push({ hp: a[q + 8], hw: a[q + 9] }); o.stand[b] = a[q + 10];
    }
    return o;
  }
  /** Initial suspended solids (m per area) by cell, fn(x, y) at cell centres: a number (all clay) or [clay, silt, sand, gravel].
   *  In the debris mode call it after setDepth, whose depth then includes these solids. */
  setSediment(fn) {
    let solids = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const v = fn((i + 0.5) * this.dx, (j + 0.5) * this.dx), q = 20 * this.idx(i, j); this.SDh.set(typeof v === 'number' ? [v, 0, 0, 0] : v, q);
      solids += this.SDh[q] + this.SDh[q + 1] + this.SDh[q + 2] + this.SDh[q + 3];
    }
    if (this.debris) this.vol.initial -= solids * this.dx * this.dx; // the debris mode's depth is the mixture's: the books are of its water
    this.device.queue.writeBuffer(this.sedPar ? this.buf.SDB : this.buf.SDA, 0, this.SDh);
  }

  /** Subgrid step: wave speed, dt, tiles, levels, face momentum, draining limiter, barrier books, continuity, rain and
   *  infiltration, peak level and hazard, inlet exchange. */
  _encodeSubgrid(pass, K) {
    const w = n => Math.ceil(n / 8), { nx, ny, NX, NY, k } = this, t64 = Math.ceil(this.tiles / 64);
    for (let s = 0; s < K; s++) {
      this._dispatch(pass, k.sgDt, w(nx), w(ny)); this._dispatch(pass, k.dtFinal, 1);
      if (this.tiled) { this._dispatch(pass, k.tileClear, t64); this._dispatch(pass, k.tileWet, w(nx), w(ny)); this._dispatch(pass, k.tileList, t64); this._dispatch(pass, k.tileArgs, 1); }
      this._dispatch(pass, k.sgPrim, w(NX), w(NY));
      if (this.tiled) { this._indirect(pass, k.sgFluxXT, 2); this._indirect(pass, k.sgFluxYT, 2); this._indirect(pass, k.thetaT, 2); }
      else { this._dispatch(pass, k.sgFluxX, w(nx + 1), w(ny)); this._dispatch(pass, k.sgFluxY, w(nx), w(ny + 1)); this._dispatch(pass, k.theta, w(nx), w(ny)); }
      if (this.nBar) this._dispatch(pass, k.barrier0, Math.ceil(this.nBar / 64));
      this._dispatch(pass, k.edgeOut, Math.ceil(2 * (nx + ny) / 64));
      if (this.nLine) this._dispatch(pass, k.lineFlux, Math.ceil(this.nLine / 64));
      if (this.tiled) { this._indirect(pass, k.sgUpdateT, 1); this._indirect(pass, k.sgSourcesT, 1); this._indirect(pass, k.sgHazardT, 1); }
      else { this._dispatch(pass, k.sgUpdate, w(nx), w(ny)); this._dispatch(pass, k.sgSources, w(nx), w(ny)); this._dispatch(pass, k.sgHazard, w(nx), w(ny)); }
      if (this.nInlets) this._dispatch(pass, k.sgExchange, Math.ceil(this.nInlets / 64));
    }
  }

  /** Replace the per-cell rain multiplier (interior k = j·nx + i), e.g. once green roofs are full; rain books follow it. */
  setRainField(field) {
    let cells = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j); if (this.sinkC[c]) continue;
      this.RFh[c] = field[j * this.nx + i]; if (this.Sh[c * 4 + 2]) cells += this.RFh[c];
    }
    this.rainArea = cells * this.dx * this.dx;
    this.device.queue.writeBuffer(this.buf.RF, 0, this.RFh);
  }

  _fillCrest(zs) {
    this.crest.forEach((f, m) => {
      const o = f.c * 4 + (f.axis ? 2 : 0), z = zs[m];
      this.CRh[o] = Number.isFinite(z) ? z - this.zref : -1e30; this.CRh[o + 1] = f.C ?? 1.6;
    });
  }
  /** New crest per barrier face (same order as o.crest; −Infinity = not there), e.g. a barrier deployed mid-storm.
   *  Crests sit on faces, not in cells, so raising or dropping one under water moves no water. */
  setCrestLevels(zs) { this._fillCrest(zs); this.device.queue.writeBuffer(this.buf.CR, 0, this.CRh); }

  /** Per barrier face since the start: volume over in the + direction (from cell i−1 / j−1 into i / j) and the −
   *  direction (m³), counted while the barrier is up and water stands over 2 cm above its crest; the peak unit
   *  discharge over it (m²/s), the highest water against it (m, absolute; −Infinity = never wet) and the peak
   *  hydrostatic load (kN/m), each with its time (s), and when it first overtopped (s; NaN = never). */
  async readBarriers() {
    const M = this.nBar, o = Object.fromEntries(['plus', 'minus', 'peak', 'level', 'load', 'tPeak', 'tLevel', 'tLoad', 'tOver'].map(k => [k, new Float64Array(M)]));
    if (!M) return o;
    const a = await this._readBuffer(this.buf.BQ, M * 48);
    for (let m = 0; m < M; m++) {
      const q = 12 * m; o.plus[m] = a[q] - a[q + 2]; o.minus[m] = a[q + 1] - a[q + 3];
      o.peak[m] = a[q + 4]; o.level[m] = a[q + 5] > -1e29 ? a[q + 5] + this.zref : -Infinity; o.load[m] = a[q + 6];
      o.tPeak[m] = a[q + 8]; o.tLevel[m] = a[q + 9]; o.tLoad[m] = a[q + 10]; o.tOver[m] = a[q + 11] >= 0 ? a[q + 11] : NaN;
    }
    return o;
  }

  /** Hazard products per interior cell (k = j·nx + i), tracked every step: peak d·v (m²/s), peak force (kN/m),
   *  duration deeper than 15 cm (s), arrival (s; NaN = never), and the worst class per standard of src/hazard.js. */
  /** Depth infiltrated so far per interior cell under Green-Ampt (m per pervious area; 0 without it). */
  async readInfiltration() {
    const a = await this._readBuffer(this.buf.GS, this.N * 16), n = this.nx * this.ny, F = new Float32Array(n);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) F[j * this.nx + i] = a[4 * this.idx(i, j) + 2];
    return F;
  }

  async readHazard() {
    const a = await this._readBuffer(this.buf.HZ, this.N * 64), n = this.nx * this.ny;
    const o = { dv: new Float32Array(n), force: new Float32Array(n), duration: new Float32Array(n), arrival: new Float32Array(n), vmax: new Float32Array(n), tWet: new Float32Array(n),
      shear: new Float32Array(n), excess: new Float32Array(n), erosion: new Float32Array(n), tShear: new Float32Array(n),
      cls: { arr: new Uint8Array(n), defra: new Uint8Array(n), defraUrban: new Uint8Array(n) } };
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, q = 16 * this.idx(i, j);
      o.dv[k] = a[q]; o.force[k] = a[q + 1]; o.duration[k] = a[q + 2]; o.arrival[k] = a[q + 3] >= 0 ? a[q + 3] : NaN;
      o.cls.arr[k] = a[q + 4]; o.cls.defra[k] = a[q + 5]; o.cls.defraUrban[k] = a[q + 6];
      o.shear[k] = a[q + 8]; o.excess[k] = a[q + 9]; o.erosion[k] = a[q + 10]; o.tShear[k] = a[q + 11];
      o.vmax[k] = a[q + 12]; o.tWet[k] = a[q + 13] >= 0 ? a[q + 13] : NaN;
    }
    return o;
  }

  /** Underdrained depth so far (m, per o.underdrains cell, on the cell basis): what each GI store let out through its
   *  underdrain (part of the books' infiltration). */
  async readUnderdrains() {
    if (!this.nUnder) return new Float32Array(0);
    const enc = this.device.createCommandEncoder(), pass = enc.beginComputePass();
    this._dispatch(pass, this.k.udGather, Math.ceil(this.nUnder / 64)); pass.end(); this.device.queue.submit([enc.finish()]);
    return (await this._readBuffer(this.buf.UDX, this.nUnder * 4)).slice(0, this.nUnder);
  }

  /** Control lines (o.lines) since the start, per line: volume crossing to its + side and to its − side (m³, both
   *  ≥ 0) and the net (plus − minus). Booked every stage on the GPU, compensated; read any time without resetting. */
  async readLines() {
    const n = this.nLines, o = { plus: new Float64Array(n), minus: new Float64Array(n), net: new Float64Array(n) };
    if (!this.nLine) return o;
    const a = await this._readBuffer(this.buf.CL, this.nLine * 16);
    this.lines.forEach((f, m) => {
      const p = a[4 * m] - a[4 * m + 1], q = a[4 * m + 2] - a[4 * m + 3];
      if (f.sign >= 0) { o.plus[f.line] += p; o.minus[f.line] += q; } else { o.plus[f.line] += q; o.minus[f.line] += p; }
    });
    for (let l = 0; l < n; l++) o.net[l] = o.plus[l] - o.minus[l];
    return o;
  }

  /** External water level (m, absolute) on the stage-boundary cells; takes effect from the next submit. */
  setStage(z) { this.stage = z; }

  /** Exchange rates per inlet (m³/s, + = surface into network), held until the next call. */
  setInletRates(q) { this.device.queue.writeBuffer(this.buf.INQ, 0, q instanceof Float32Array ? q : Float32Array.from(q)); }

  /** Volume exchanged per inlet since the last call (m³) and current inlet depths (m); resets the accumulators. */
  async readInlets() {
    const M = this.nInlets, enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buf.INX, 0, this.read.INX, 0, M * 16);
    enc.clearBuffer(this.buf.INX, 0, M * 16);
    this.device.queue.submit([enc.finish()]);
    await this.read.INX.mapAsync(GPUMapMode.READ, 0, M * 16);
    const a = new Float32Array(this.read.INX.getMappedRange(0, M * 16).slice(0)); this.read.INX.unmap();
    const vol = new Float64Array(M), h = new Float32Array(M);
    for (let m = 0; m < M; m++) { vol[m] = a[4 * m] - a[4 * m + 2]; h[m] = a[4 * m + 1]; this.vol.exchanged += vol[m]; }
    return { vol, h };
  }

  async _readDT() {
    await this.read.DT.mapAsync(GPUMapMode.READ);
    const d = new Float32Array(this.read.DT.getMappedRange().slice(0)); this.read.DT.unmap();
    // a batch that reaches its end time finishes with zero-length steps, so the last dt says nothing about the next
    // batch: keep the mean step of the steps that advanced (dtAvg) for sizing batches
    const ds = d[3] - this.steps; if (ds > 0 && d[1] > this.t) this.dtAvg = (d[1] - this.t) / ds;
    this.lastDt = d[0] > 0 ? d[0] : this.lastDt; this.t = d[1]; this.steps = d[3];
    return d;
  }

  /** Advance to tTarget (blocking loop of batched submits). */
  async advance(tTarget, K = 64) {
    const t0 = this.t, goal = Math.fround(tTarget);
    this._writeParams(tTarget);
    await this.ready;
    let stalls = 0;
    while (this.t < goal) {
      const tPrev = this.t;
      const enc = this.device.createCommandEncoder(); const pass = enc.beginComputePass();
      this.encodeSteps(pass, K); pass.end();
      enc.copyBufferToBuffer(this.buf.DT, 0, this.read.DT, 0, 16);
      this.device.queue.submit([enc.finish()]);
      await this._readDT();
      if (this.t <= tPrev && ++stalls > 3) throw new Error('GPU solver made no progress (device error?)');
    }
    this.vol.rain += this.rainRate * (this.t - t0) * this.rainArea;
  }

  /** One render frame: advance up to tEnd using at most K steps, then return packed depth/speed (null if !readOut). */
  async frame(tEnd, K, readOut = true) {
    const t0 = this.t;
    this._writeParams(tEnd);
    const enc = this.device.createCommandEncoder(); const pass = enc.beginComputePass();
    this.encodeSteps(pass, K);
    if (readOut) this._dispatch(pass, this.sg ? this.k.sgPack : this.k.pack, Math.ceil(this.nx / 8), Math.ceil(this.ny / 8));
    pass.end();
    enc.copyBufferToBuffer(this.buf.DT, 0, this.read.DT, 0, 16);
    if (readOut) enc.copyBufferToBuffer(this.buf.OUT, 0, this.read.OUT, 0, this.nx * this.ny * 8);
    this.device.queue.submit([enc.finish()]);
    await this._readDT();
    let out = null;
    if (readOut) { await this.read.OUT.mapAsync(GPUMapMode.READ); out = new Float32Array(this.read.OUT.getMappedRange().slice(0)); this.read.OUT.unmap(); }
    this.vol.rain += this.rainRate * (this.t - t0) * this.rainArea;
    return out;
  }

  /** Active tiles of the last step: [update list, flux list] lengths, and the tile total. */
  async tileStats() {
    if (!this.tiled) return { tiled: false, tiles: this.tiles };
    const a = new Uint32Array((await this._readBuffer(this.buf.TC, 8)).buffer);
    return { tiled: true, tiles: this.tiles, update: a[0], flux: a[1] };
  }

  /** Copy several buffers in one submission (then run `after(pass)` in the same submission); → Float32Arrays. */
  async _snapshot(parts, after, afterCopy) {
    const d = this.device, st = parts.map(([, size]) => d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    const enc = d.createCommandEncoder(); parts.forEach(([src, size], n) => enc.copyBufferToBuffer(src, 0, st[n], 0, size));
    if (afterCopy) afterCopy(enc);
    if (after) { const pass = enc.beginComputePass(); after(pass); pass.end(); }
    d.queue.submit([enc.finish()]);
    const out = await Promise.all(st.map(async (b) => { await b.mapAsync(GPUMapMode.READ); const a = new Float32Array(b.getMappedRange().slice(0)); b.unmap(); b.destroy(); return a; }));
    return out;
  }

  async _readBuffer(src, size) {
    const st = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder(); enc.copyBufferToBuffer(src, 0, st, 0, size);
    this.device.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ); const a = new Float32Array(st.getMappedRange().slice(0)); st.unmap(); st.destroy();
    return a;
  }

  /** Interior fields as Float64Arrays: h, hu, hv, maxDepth, plus mass accounting. */
  async readState() {
    // one submission: copy depths, totals, pending inlet exchange and GI stores, then restart the totals on the GPU, so
    // the snapshot is from one moment and steps queued by a concurrent frame are neither lost nor counted twice
    const nE = 2 * (this.nx + this.ny);
    const parts = [[this.buf.U, this.N * 16], [this.buf.A, this.N * 16], [this.buf.EO, nE * 8], ...(this.nInlets ? [[this.buf.INX, this.nInlets * 16]] : []), ...(this.hasGI ? [[this.buf.GS, this.N * 16]] : []),
      ...(this.debris ? [[this.sedPar ? this.buf.SDB : this.buf.SDA, this.N * 80]] : [])];
    const snap = await this._snapshot(parts, (pass) => this._dispatch(pass, this.k.resetTotals, Math.ceil(this.NX / 8), Math.ceil(this.NY / 8)), (enc) => enc.clearBuffer(this.buf.EO, 0, nE * 8));
    const [U, Ab, E, X, G] = snap, SD = this.debris ? snap.at(-1) : null;
    for (let m = 0; m < nE; m++) (this.acc ??= { inf: 0, out: 0, clip: 0 }).out += E[2 * m] - E[2 * m + 1]; // edge outflow, compensated
    let pending = 0; if (this.nInlets) for (let m = 0; m < this.nInlets; m++) pending += X[4 * m] - X[4 * m + 2];
    const exchanged = this.vol.exchanged + pending;
    let giStored = 0; if (this.hasGI) { const GG = this.nInlets ? G : X; for (let c = 0; c < this.N; c++) giStored += GG[4 * c]; giStored *= this.dx * this.dx; }
    const n = this.nx * this.ny, h = new Float64Array(n), hu = new Float64Array(n), hv = new Float64Array(n), hmax = new Float64Array(n);
    // per-cell infiltration / outflow / clipping totals are fp32 sums of tiny increments: fold them into fp64 books here
    // and restart them from zero, so a GPU total never holds more than the water since the last read
    const A = this.dx * this.dx, acc = this.acc ??= { inf: 0, out: 0, clip: 0 };
    let vol = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const c = this.idx(i, j), k = j * this.nx + i;
      h[k] = U[c * 4]; hu[k] = U[c * 4 + 1]; hv[k] = U[c * 4 + 2]; hmax[k] = this.sg ? Ab[c * 4] + this.zref : Ab[c * 4]; // subgrid: peak level
      if (this.Sh[c * 4 + 2]) {
        vol += h[k] - U[c * 4 + 3]; // depth less its Kahan residual
        if (this.sinkC[c]) acc.out += Ab[c * 4 + 1] * A; else acc.inf += Ab[c * 4 + 1] * A;
        acc.out += Ab[c * 4 + 2]; acc.clip += Ab[c * 4 + 3] * A;
      }
    }
    // debris mode: U holds the water–sediment mixture; the books are of the water: less the solids in the flow and those
    // carried out with it (in suspension; bedload never was in the flow), plus the pore water the bed gave the flow (net of
    // what deposits took back)
    let solids = 0, solidsOut = 0, pore = 0;
    if (SD) for (let c = 0; c < this.N; c++) { const q = 20 * c; solids += SD[q] + SD[q + 1] + SD[q + 2] + SD[q + 3]; solidsOut += SD[q + 8] + SD[q + 9] + SD[q + 10] + SD[q + 11]; pore += SD[q + 12]; }
    const inf = acc.inf / A, out = acc.out - solidsOut * A, clip = acc.clip / A;
    const volume = (vol - solids) * A, infil = inf * A, expected = this.vol.initial + this.vol.rain - infil - out - exchanged + pore * A;
    // relative to all the water that came in: initial, rain, and net inflow through exchange cells (a river) or the edge (a tide)
    const scale = Math.max(1e-30, Math.abs(expected), this.vol.initial + this.vol.rain + Math.max(0, -exchanged) + Math.max(0, -out));
    return {
      h, hu, hv, hmax,
      mass: { volume, rain: this.vol.rain, infil, giStored, outflow: out, exchanged, clipped: clip * A, expected, rel: (volume - expected) / scale, relExClip: (volume - expected - clip * A) / scale },
    };
  }

  destroy() { for (const b of Object.values(this.buf)) b.destroy(); for (const b of Object.values(this.read)) b.destroy(); }
}
