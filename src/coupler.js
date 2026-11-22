// 1D–2D coupling: GPU surface solver ↔ SWMM pipe network, exchanging at drainage inlets every `interval` seconds.
//
// Each interval [t, t+Δ]:
//   1. the surface solver has already run to t+Δ, applying the inlet rates chosen at t (bounded by available water)
//   2. read the volume each inlet actually exchanged and the current inlet depths
//   3. SWMM receives exactly that volume as lateral inflow (negative = returned to the street) and strides Δ
//   4. new rates for [t+Δ, t+2Δ] from weir / orifice hydraulics on (surface depth, node head), minus any node overflow,
//      which SWMM would otherwise discard, so it goes back onto the street
//   5. outfalls that discharge inside the model (`returns`, src/drainage.js outfallCells: an endwall into a creek)
//      put what flowed into them over the interval back on the ground at their cell over the next one
// Water moved between the models is identical on both sides, so the combined balance is
//   surface stored + network stored = rain − infiltration − surface outflow − pipe outfalls leaving the model
//   (± SWMM continuity error).
//
// Two-way exchange at a surcharged manhole (`follow`, the default with twoWay). A grate's own resistance is a few
// millimetres of head; the pipe below it is the real limit, and a manhole holds almost no water (SWMM's minimum node
// area, 1.2 m²). So a rate set from the head difference of the moment (an orifice law, as before) is stiff: over one
// 2 s interval it moves the manhole's head many times the difference that set it, the head swings past the street's
// level and back, its mean stands above the street, and the pipe is driven harder than the street can drive it
// (benchmarks/FINDINGS.md F14: a pond that should stand at 0.20 m read 0.12 m). Instead the rate for the coming
// interval is what the manhole's pipes carried away over the last one (its lateral inflow less what its own level
// took up) plus half of what would bring its head to the street's level less the grate's own loss, kept between
// what the grate takes freely and what the orifice law returns. At rest that is exactly the pipes' flow with the
// manhole at the street's level. Below a surcharge the sum always exceeds the free rate, so nothing changes there.
// The node area assumed is SWMM's minimum node area (MIN_SURFAREA, which the caller passes): a node is never smaller
// than that. An area taken too small only slows the approach; one taken more than about 1.7 times too large would
// swing, so a caller that sets a smaller MIN_SURFAREA in the .inp must pass it here. (A first version took half the
// minimum for safety; its slower start left the A12-010 books 0.004 points outside their limit.)
import { inletFlow, inletOptions, grateCapture, returnsHere, posKey } from './drainage.js';

const FOLLOW_GAIN = 0.5;   // share of the head gap closed each interval

export class Coupler {
  /**
   * @param solver GPUSolver created with `inlets` = net.inlets.map(i => i.cell) (same order)
   * @param net    network from synthNetwork: nodes, pipes, inlets [{node, cell, grates, crest?}] (crest: the opening above
   *               its cell's bed, m; 0 when not given)
   * @param swmm   SWMM engine already opened with the network's .inp
   * @param zs     solver bed elevations (absolute, m) to read the surface level at each inlet cell
   */
  constructor(solver, net, swmm, zs, { interval = 2, roofArea = null, twoWay = false, returns = [], follow = true, nodeArea = 1.2 } = {}) {
    Object.assign(this, { solver, net, swmm, interval });
    // follow: with twoWay, a manhole's exchange follows the street level (see the top of this file); false = the
    // orifice law on the head difference of the moment, as before. nodeArea: SWMM's MIN_SURFAREA (m²)
    this.follow = twoWay && follow;
    this.nodeArea = nodeArea; // m²: the manhole's own storage, the least a SWMM node has (see the top of this file)
    this.Hprev = new Float64Array(net.nodes.length).fill(NaN);
    // twoWay: inlet manholes pressurise (give them a large surcharge depth in the .inp) and water returns through the
    // inlet on the head difference, as HEC-RAS does, instead of spilling at the rim. Return flow per manhole is capped by
    // what its pipes deliver, so SWMM is never asked for water a nearly empty node does not hold.
    this.twoWay = twoWay;
    this.roofArea = roofArea; // m² of roof whose downspouts feed each node (rain goes straight into the pipes)
    this.roofRain = null;     // per node, × the solver's rain rate: the rain on those roofs over the area mean (radar rain); null = 1
    this.inletNodes = net.inlets.map(g => g.node);
    this.grates = net.inlets.map(g => g.grates);
    this.crest = net.inlets.map(g => g.crest ?? 0);
    // each point's grate hydraulics: the area's setting, or the equivalent of its grates' own kinds (drainage.js inletOptions)
    this.opt = net.inlets.map(g => inletOptions(g.parts, net.opts));
    // F21 (opt capture: 'hec22', default off): each inlet cell's bed slope (x, y), from in-domain neighbours less than
    // 0.3 m away (a kerb face or a wall is not the street's slope), for grateCapture's cross slope
    this.capture = this.opt.some(o => o.capture === 'hec22');
    if (this.capture) {
      const nx = solver.nx, ny = zs.length / nx, dx = solver.dx ?? 1;
      const sl = (k, di, dj) => { const i = k % nx, j = (k / nx) | 0, d = []; for (const s of [-1, 1]) { const ii = i + s * di, jj = j + s * dj; if (ii >= 0 && ii < nx && jj >= 0 && jj < ny) { const dz = zs[jj * nx + ii] - zs[k]; if (Math.abs(dz) < 0.3) d.push(s * dz / dx); } } return d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0; };
      this.bedSlope = net.inlets.map(g => [sl(g.cell, 1, 0), sl(g.cell, 0, 1)]);
      this.dx = dx;
    }
    this.swIdx = net.nodes.map(n => swmm.index('NODE', n.name));
    if (this.swIdx.some(i => i < 0)) throw new Error('SWMM node lookup failed');
    this.lkIdx = net.pipes.map(p => swmm.index('LINK', p.name)); // by name: regulator weirs and outlets follow the conduits in the .inp
    this.outNodes = net.nodes.map((n, i) => (n.outfall ? i : -1)).filter(i => i >= 0);
    this.outVol = new Float64Array(net.nodes.length); // m³ into each outfall, integrated per routing step
    this.zs = net.inlets.map(g => zs[g.cell]);
    this.perNode = net.nodes.map(() => 0); for (const i of this.inletNodes) this.perNode[i]++; // exchange points per manhole
    // exchange points after the inlets: each outfall-return cell and the outfall nodes (by position) that discharge there
    this.returns = returns.map(r => ({ cell: r.cell, nodes: net.nodes.map((n, i) => (returnsHere(n) && r.at.includes(posKey(n)) ? i : -1)).filter(i => i >= 0) }));
    this.retQ = new Float64Array(this.returns.length); // m³/s each return puts back over the coming interval
    this.q = new Float32Array(this.inletNodes.length + this.returns.length);
    this.ret = new Float64Array(this.inletNodes.length); // overflow (m³/s) netted out of each inlet's rate this interval
    this.tNext = interval;
    this.stage = null; // observed water level (m) applied to outfalls that discharge to a stream
    this.streamOutfalls = net.nodes.map((n, i) => (n.toStream ? i : -1)).filter(i => i >= 0);
    this.totals = { toNetwork: 0, toSurface: 0, overflowReturned: 0, overflowLost: 0, roofToSewer: 0, backflow: 0, latOut: 0, extra: 0, outfallReturned: 0 };
    // lateral inflow (m³/s) other link models add at nodes for the coming interval (pond outlets, underdrains); they
    // step before the coupler in the hub, and it is cleared once given to SWMM
    this.extra = new Float64Array(net.nodes.length);
    this.state = { head: new Float64Array(net.nodes.length), flow: new Float64Array(net.pipes.length), depth: new Float64Array(net.pipes.length), surcharged: 0, flooding: 0 };
  }

  get count() { return this.inletNodes.length + this.returns.length; }

  /** Call when the surface solver has reached `this.tNext` (standalone; with other link models use a LinkHub). */
  async exchange() {
    const { vol, h, app } = await this.solver.readInlets();
    this.solver.setInletRates(this.step(vol, h, this.interval, this.tNext, app));
    this.tNext += this.interval;
  }

  /** Measured exchange over the interval ending at tNext → SWMM strides to tNext → rates for the next interval. */
  step(vol, h, interval, tNext, app = null) {
    const { solver, swmm, net } = this, M = this.inletNodes.length;
    // F21: what each grate could take of the water arriving moving (0 without capture or the solver's approach flows)
    const cap = (m) => {
      if (!this.capture || !app || this.opt[m].capture !== 'hec22') return 0;
      const a = app.subarray(4 * m, 4 * m + 4), [gx, gy] = this.bedSlope[m];
      return grateCapture(a, Math.abs(a[3] ? gx : gy), this.dx, this.grates[m], this.opt[m]);
    };
    // SWMM gets exactly what the surface gave up (or received) over the interval, summed over each manhole's grates.
    // Overflow that SWMM discarded last interval was handed to the street by netting it out of this rate; it is credited
    // back so SWMM is not charged twice (it already booked it as flooding).
    const lat = new Float64Array(net.nodes.length);
    for (let r = 0; r < this.returns.length; r++) this.totals.outfallReturned += Math.max(0, -vol[M + r]); // what the ground received
    // a window rerun: inlets outside the window replay what the existing run exchanged (prescribe: Map inlet → (t0, t1) ⇒ m³)
    if (this.prescribe) for (const [m, f] of this.prescribe) vol[m] = f(tNext - interval, tNext);
    for (let m = 0; m < M; m++) {
      const v = vol[m]; if (v > 0) this.totals.toNetwork += v; else this.totals.toSurface -= v;
      lat[this.inletNodes[m]] += v / interval + this.ret[m];
      this.totals.overflowReturned += this.ret[m] * interval;
    }
    if (this.roofArea) { // roof rain over the interval (rain is constant within an exchange interval: blocks align with it)
      const r = solver.rainRate;
      for (let i = 0; i < lat.length; i++) if (this.roofArea[i]) { const q = r * (this.roofRain ? this.roofRain[i] : 1) * this.roofArea[i]; lat[i] += q; this.totals.roofToSewer += q * interval; }
    }
    // SWMM books a negative lateral flow (water back up through an inlet) as external outflow; keep the total so the
    // combined balance can take it out of SWMM's outflow (it is on the street, not gone through an outfall)
    for (let i = 0; i < lat.length; i++) if (this.extra[i]) { lat[i] += this.extra[i]; this.totals.extra += this.extra[i] * interval; (this.extraNodes ??= new Set()).add(i); }
    this.extra.fill(0);
    for (let i = 0; i < lat.length; i++) if (lat[i] < 0 && (this.perNode[i] || this.roofArea?.[i])) this.totals.latOut += -lat[i] * interval;
    for (let i = 0; i < lat.length; i++) if (this.perNode[i] || this.roofArea?.[i] || this.extraNodes?.has(i)) swmm.setLatFlow(this.swIdx[i], lat[i]);
    if (this.stage != null) for (const i of this.streamOutfalls) swmm.setOutfallStage(this.swIdx[i], Math.max(this.stage, net.nodes[i].invert));
    // advance SWMM step by step, integrating each node's overflow (flooding) volume exactly as SWMM books it
    const flood = new Float64Array(net.nodes.length), junc = this.junctions ??= net.nodes.map((n, i) => (n.outfall ? -1 : i)).filter(i => i >= 0);
    const into = new Float64Array(net.nodes.length); // m³ into each outfall this interval
    swmm.stepTo(tNext, (dt) => {
      for (const i of junc) { const q = swmm.node('OVERFLOW', this.swIdx[i]); if (q > 0) flood[i] += q * dt; }
      for (const i of this.outNodes) { const v = swmm.node('INFLOW', this.swIdx[i]) * dt; this.outVol[i] += v; into[i] += v; }
    });
    this.returns.forEach((r, k) => { let v = 0; for (const i of r.nodes) v += Math.max(0, into[i]); this.retQ[k] = v / interval; });
    // network state → next interval's exchange: flooded volume goes back on the street over the next interval
    let surcharged = 0, flooding = 0;
    const overflow = flood.map(v => v / interval);
    net.nodes.forEach((n, i) => {
      const H = swmm.node('HEAD', this.swIdx[i]); this.state.head[i] = H;
      if (!n.outfall && H > n.ground - 0.05) surcharged++;
    });
    let back = null;
    if (this.twoWay) { // orifice flow out of pressurised manholes, capped per node by its pipe inflow
      back = new Float64Array(M); const want = new Float64Array(net.nodes.length);
      for (let m = 0; m < M; m++) {
        // water leaves over the crest, or against the street water above it
        const i = this.inletNodes[m], eta = this.zs[m] + Math.max(this.crest[m], h[m]), dH = this.state.head[i] - eta;
        if (dH > 0 && this.state.head[i] > this.zs[m] + this.crest[m]) { back[m] = this.opt[m].Co * this.opt[m].inletArea * this.grates[m] * Math.sqrt(2 * 9.81 * dH); want[i] += back[m]; }
      }
      for (let m = 0; m < M; m++) if (back[m] > 0) {
        // SWMM's node INFLOW holds a lateral flow only when it is positive (a negative one is booked as outflow,
        // dynwave.c), so take only a positive one off: subtracting last interval's negative return added it back to
        // the cap, which grew interval by interval on a surcharged network (Portland: 70k m³ returned for 38k taken in)
        const i = this.inletNodes[m], pipeIn = Math.max(0, swmm.node('INFLOW', this.swIdx[i]) - Math.max(0, swmm.node('LATFLOW', this.swIdx[i])));
        back[m] *= Math.min(1, pipeIn / want[i]);
      }
    }
    // follow: per manhole, what its pipes carried away over the interval just ended (its lateral inflow less what its
    // own level took up), and the part of its lateral inflow that did not come through its grates (roofs, underdrains)
    const carried = this.follow ? new Float64Array(net.nodes.length) : null, grateIn = this.follow ? new Float64Array(net.nodes.length) : null;
    if (this.follow) {
      for (let m = 0; m < M; m++) grateIn[this.inletNodes[m]] += vol[m] / interval + this.ret[m];
      for (let i = 0; i < carried.length; i++) if (this.perNode[i]) {
        const H = this.state.head[i]; carried[i] = Number.isFinite(this.Hprev[i]) ? lat[i] - (H - this.Hprev[i]) * this.nodeArea / interval : lat[i];
        this.Hprev[i] = H;
      }
    }
    for (let m = 0; m < M; m++) {
      const i = this.inletNodes[m], n = net.nodes[i];
      const share = overflow[i] / this.perNode[i]; // a manhole's overflow leaves through all of its grates
      const cm = cap(m); // free inflow only: a submerged grate keeps the orifice law on the head difference
      let take = inletFlow(h[m], this.zs[m], this.state.head[i], this.grates[m], this.opt[m], this.crest[m]), bk = back?.[m] ?? 0;
      if (cm > 0 && this.state.head[i] < this.zs[m] + this.crest[m]) take = Math.max(take, cm);
      if (this.follow && this.grates[m] > 0) {
        const o = this.opt[m], kA = o.Co * o.inletArea * this.grates[m] * (1 - Math.min(0.95, o.clog ?? 0));
        const free = Math.max(cm, inletFlow(h[m], this.zs[m], -Infinity, this.grates[m], o, this.crest[m])), eta = this.zs[m] + Math.max(this.crest[m], h[m]);
        const qm = vol[m] / interval + this.ret[m];                 // what went through this grate over the interval just ended
        const loss = Math.sign(qm) * (qm / kA) ** 2 / (2 * 9.81);  // the grate's own head loss at that rate
        const want = (carried[i] - (lat[i] - grateIn[i])) / this.perNode[i] + FOLLOW_GAIN * (eta - loss - this.state.head[i]) * this.nodeArea / interval / this.perNode[i];
        const qn = Math.min(free, Math.max(-bk, want));
        take = Math.max(0, qn); bk = Math.max(0, -qn);
      }
      this.q[m] = take - share - bk; this.ret[m] = share;
      if (this.prescribe?.has(m)) { this.q[m] = 0; this.ret[m] = 0; } // replayed: no surface exchange (the cell is outside the window)
      if (back) this.totals.backflow += bk * interval;
      flooding += share;
    }
    for (let k = 0; k < this.returns.length; k++) this.q[M + k] = -this.retQ[k]; // negative: onto the ground
    net.nodes.forEach((n, i) => { if (!this.perNode[i] && overflow[i] > 0) this.totals.overflowLost += overflow[i] * interval; });
    this.state.surcharged = surcharged; this.state.flooding = flooding;
    net.pipes.forEach((p, k) => { this.state.flow[k] = swmm.link('FLOW', this.lkIdx[k]); this.state.depth[k] = swmm.link('DEPTH', this.lkIdx[k]); });
    this.record(vol, h, interval, tNext, flood);
    return this.q;
  }

  /**
   * Report books every exchange: per node the max head (HGL) and its time, time surcharged (head within 5 cm of the rim
   * or above, as `surcharged` counts) and flooded volume; per pipe max flow, max depth / D and max velocity; per inlet the
   * volume taken in, the peak rate and the peak depth at its grate; outfall inflows every 10 s.
   */
  record(vol, h, interval, t, flood) {
    const { swmm, net } = this, N = net.nodes.length, P = net.pipes.length, M = this.inletNodes.length;
    const r = this.rec ??= {
      nodes: Array.from({ length: N }, () => ({ maxHead: -Infinity, tMax: NaN, surchargedS: 0, floodVol: 0 })),
      pipes: Array.from({ length: P }, () => ({ maxQ: 0, tMaxQ: NaN, maxRatio: 0, maxV: 0 })),
      inlets: Array.from({ length: M }, () => ({ volume: 0, peakQ: 0, tPeakQ: NaN, maxDepth: 0 })),
      outfalls: net.nodes.map((n, i) => (n.outfall ? i : -1)).filter(i => i >= 0), series: [], tLast: -Infinity,
    };
    for (let i = 0; i < N; i++) {
      const H = this.state.head[i], s = r.nodes[i];
      if (H > s.maxHead) { s.maxHead = H; s.tMax = t; }
      if (!net.nodes[i].outfall && H > net.nodes[i].ground - 0.05) s.surchargedS += interval;
      s.floodVol += flood[i];
    }
    for (let k = 0; k < P; k++) {
      const s = r.pipes[k], q = Math.abs(this.state.flow[k]), D = net.pipes[k].D;
      if (q > s.maxQ) { s.maxQ = q; s.tMaxQ = t; }
      if (D > 0) s.maxRatio = Math.max(s.maxRatio, this.state.depth[k] / D);
      s.maxV = Math.max(s.maxV, Math.abs(swmm.link('VELOCITY', this.lkIdx[k])));
    }
    for (let m = 0; m < M; m++) {
      const s = r.inlets[m], v = vol[m]; if (v > 0) s.volume += v;
      const q = v / interval; if (q > s.peakQ) { s.peakQ = q; s.tPeakQ = t; }
      if (h[m] > s.maxDepth) s.maxDepth = h[m];
    }
    if (this.recordInlets) { r.cum ??= new Float64Array(M); for (let m = 0; m < M; m++) r.cum[m] += vol[m]; } // for window reruns: each inlet's exchange so far
    if (t - r.tLast >= 10 - 1e-9) { r.series.push([t, ...r.outfalls.map(i => swmm.node('INFLOW', this.swIdx[i]))]); if (r.cum) (r.inletSeries ??= []).push([t, ...r.cum]); r.tLast = t; }
  }
  /** The report books (see record), JSON-ready: infinities as null. */
  report() {
    const r = this.rec; if (!r) return null;
    const fin = (v) => (Number.isFinite(v) ? v : null);
    return { nodes: r.nodes.map(s => ({ maxHead: fin(s.maxHead), tMax: fin(s.tMax), surchargedS: s.surchargedS, floodVol: s.floodVol })), pipes: r.pipes.map(s => ({ ...s, tMaxQ: fin(s.tMaxQ) })),
      inlets: r.inlets.map(s => ({ ...s, tPeakQ: fin(s.tPeakQ) })), outfalls: r.outfalls, series: r.series, outVol: Array.from(this.outVol), ...(r.inletSeries ? { inletSeries: r.inletSeries } : {}) };
  }
}
