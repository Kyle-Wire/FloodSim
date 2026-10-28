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
   * o.subgrid: a buildSubgrid() model (src/subgrid.js) runs the opt-in speed mode: local inertial on these cells with
   * 1 m storage and conveyance tables. Then o.z is each cell's lowest open ground, U.x is stored volume per cell area,
   * the packed depth is the depth at the lowest point, and readState's hmax is the peak water level (absolute).
   * o.tiles: active-tile dispatch (fluxes and updates only on 8×8 tiles near water; identical results). Default: on
   * when the device allows TILED_STORAGE_BUFFERS storage buffers per stage.
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
      this.GIh[c * 4] = o.gi.rate[k]; this.GIh[c * 4 + 1] = o.gi.cap[k]; this.GIh[c * 4 + 2] = o.gi.drain[k];
    }
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
      params: mk(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      U: mk(N * 16), U0: mk(N * 16), S: mk(N * 16), W: mk(N * 16),
      FX: mk(N * 36), FY: mk(N * 36), A: mk(N * 16), DT: mk(16), RED: mk(4),
      OUT: mk(this.nx * this.ny * 8), TH: mk(N * 4), RF: mk(N * 4),
      INC: mk(this.INCh.byteLength), INQ: mk(this.INCh.length * 4), INX: mk(this.INCh.length * 16), STG: mk(N * 4),
      TF: mk(this.tiles * 4), TS: mk(this.tiles * 4), TL: mk(this.tiles * 8), TC: mk(8),
      TA: mk(24, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST),
      GI: mk(N * 16), GS: mk(N * 8),
      CR: mk(N * 16), BF: mk(this.BFh.byteLength), BQ: mk(this.BFh.length * 48), HZ: mk(N * 32),
      SGC: mk(this.sg ? N * CT * 4 : 16), SGF: mk(this.sg ? 2 * N * FT * 4 : 16),
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
    d.queue.writeBuffer(this.buf.CR, 0, this.CRh);
    d.queue.writeBuffer(this.buf.BF, 0, this.BFh);
    d.queue.writeBuffer(this.buf.BQ, 0, this.BQh);
    if (this.sg) { d.queue.writeBuffer(this.buf.SGC, 0, this.SGCh); d.queue.writeBuffer(this.buf.SGF, 0, this.SGFh); }
    const hz = new Float32Array(N * 8); for (let c = 0; c < N; c++) hz[8 * c + 3] = -1; d.queue.writeBuffer(this.buf.HZ, 0, hz);
    this._writeParams(0);

    const mod = d.createShaderModule({ code: KERNELS_WGSL });
    this.module = mod;
    const B = [this.buf.params, this.buf.U, this.buf.U0, this.buf.S, this.buf.W, this.buf.FX, this.buf.FY, this.buf.A, this.buf.DT, this.buf.RED, this.buf.OUT, this.buf.TH, this.buf.RF, this.buf.INC, this.buf.INQ, this.buf.INX, this.buf.STG,
      this.buf.TF, this.buf.TS, this.buf.TL, this.buf.TC, this.buf.TA, this.buf.GI, this.buf.GS, this.buf.CR, this.buf.BF, this.buf.BQ, this.buf.HZ, this.buf.SGC, this.buf.SGF];
    const uses = {
      prim: [0, 1, 3, 4, 16], faceX: [0, 3, 4, 5, 8, 24], faceY: [0, 3, 4, 6, 8, 24], barrier: [0, 4, 5, 6, 8, 11, 24, 25, 26], hazard: [0, 1, 3, 8, 27], resetTotals: [0, 7],
      sgPrim: [0, 1, 4, 16, 28], sgFluxX: [0, 4, 5, 6, 8, 9, 11, 24, 29], sgFluxY: [0, 4, 5, 6, 8, 9, 11, 24, 29], sgUpdate: [0, 1, 3, 5, 6, 7, 8, 11],
      sgHazard: [0, 1, 3, 5, 6, 7, 8, 27, 28], sgDt: [0, 1, 9, 28], sgPack: [0, 1, 5, 6, 10, 28], sgExchange: [0, 1, 8, 13, 14, 15, 28],
      update: [0, 1, 2, 3, 5, 6, 7, 8, 11], theta: [0, 1, 3, 5, 6, 8, 11], sources: [0, 1, 3, 7, 8, 12, 22, 23],
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
      hazard: make('hazard', uses.hazard), resetTotals: make('resetTotals', uses.resetTotals),
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
    // resolves when the pipelines are known good; rejects with the WGSL/validation error otherwise
    this.ready = d.popErrorScope().then((e) => { if (e) throw new Error('GPU pipeline error: ' + e.message); });
  }

  _writeParams(tEnd) {
    const ab = new ArrayBuffer(96), u = new Uint32Array(ab), f = new Float32Array(ab);
    u[0] = this.nx; u[1] = this.ny; u[2] = this.NX; u[3] = this.NY;
    f[4] = this.dx; f[5] = this.g; f[6] = this.hdry; f[7] = this.hfront;
    f[8] = this.cfl; f[9] = this.rainRate; f[10] = tEnd; f[11] = this.dtDry;
    u[12] = this.secondOrder ? 1 : 0; u[13] = this.limiter;
    u[18] = this.nInlets; f[19] = this.stage - this.zref; u[14] = BC[this.bc.west]; u[15] = BC[this.bc.east]; u[16] = BC[this.bc.south]; u[17] = BC[this.bc.north];
    u[20] = this.tilesX; u[21] = this.tilesY; u[22] = this.tiles; u[23] = this.nBar;
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
          this._indirect(pass, st ? k.updateT1 : k.updateT0, 1);
        } else {
          this._dispatch(pass, k.faceX, w(nx + 1), w(ny));
          this._dispatch(pass, k.faceY, w(nx), w(ny + 1));
          this._dispatch(pass, k.theta, w(nx), w(ny));
          if (this.nBar) this._dispatch(pass, st ? k.barrier1 : k.barrier0, Math.ceil(this.nBar / 64));
          this._dispatch(pass, st ? k.update1 : k.update0, w(nx), w(ny));
        }
      }
      if (this.tiled) this._indirect(pass, k.sourcesT, 1); else this._dispatch(pass, k.sources, w(nx), w(ny));
      if (this.tiled) this._indirect(pass, k.hazardT, 1); else this._dispatch(pass, k.hazard, w(nx), w(ny));
      if (this.nInlets) this._dispatch(pass, k.exchange, Math.ceil(this.nInlets / 64));
    }
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
  async readHazard() {
    const a = await this._readBuffer(this.buf.HZ, this.N * 32), n = this.nx * this.ny;
    const o = { dv: new Float32Array(n), force: new Float32Array(n), duration: new Float32Array(n), arrival: new Float32Array(n),
      cls: { arr: new Uint8Array(n), defra: new Uint8Array(n), defraUrban: new Uint8Array(n) } };
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, q = 8 * this.idx(i, j);
      o.dv[k] = a[q]; o.force[k] = a[q + 1]; o.duration[k] = a[q + 2]; o.arrival[k] = a[q + 3] >= 0 ? a[q + 3] : NaN;
      o.cls.arr[k] = a[q + 4]; o.cls.defra[k] = a[q + 5]; o.cls.defraUrban[k] = a[q + 6];
    }
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
  async _snapshot(parts, after) {
    const d = this.device, st = parts.map(([, size]) => d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    const enc = d.createCommandEncoder(); parts.forEach(([src, size], n) => enc.copyBufferToBuffer(src, 0, st[n], 0, size));
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
    const parts = [[this.buf.U, this.N * 16], [this.buf.A, this.N * 16], ...(this.nInlets ? [[this.buf.INX, this.nInlets * 16]] : []), ...(this.hasGI ? [[this.buf.GS, this.N * 8]] : [])];
    const [U, Ab, X, G] = await this._snapshot(parts, (pass) => this._dispatch(pass, this.k.resetTotals, Math.ceil(this.NX / 8), Math.ceil(this.NY / 8)));
    let pending = 0; if (this.nInlets) for (let m = 0; m < this.nInlets; m++) pending += X[4 * m] - X[4 * m + 2];
    const exchanged = this.vol.exchanged + pending;
    let giStored = 0; if (this.hasGI) { const GG = this.nInlets ? G : X; for (let c = 0; c < this.N; c++) giStored += GG[2 * c]; giStored *= this.dx * this.dx; }
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
    const inf = acc.inf / A, out = acc.out, clip = acc.clip / A;
    const volume = vol * A, infil = inf * A, expected = this.vol.initial + this.vol.rain - infil - out - exchanged;
    return {
      h, hu, hv, hmax,
      mass: { volume, rain: this.vol.rain, infil, giStored, outflow: out, exchanged, clipped: clip * A, expected, rel: (volume - expected) / Math.max(1e-30, Math.max(Math.abs(expected), this.vol.initial + this.vol.rain)), relExClip: (volume - expected - clip * A) / Math.max(1e-30, Math.max(Math.abs(expected), this.vol.initial + this.vol.rain)) },
    };
  }

  destroy() { for (const b of Object.values(this.buf)) b.destroy(); for (const b of Object.values(this.read)) b.destroy(); }
}
