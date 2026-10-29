// 1D–2D coupling: GPU surface solver ↔ SWMM pipe network, exchanging at drainage inlets every `interval` seconds.
//
// Each interval [t, t+Δ]:
//   1. the surface solver has already run to t+Δ, applying the inlet rates chosen at t (bounded by available water)
//   2. read the volume each inlet actually exchanged and the current inlet depths
//   3. SWMM receives exactly that volume as lateral inflow (negative = returned to the street) and strides Δ
//   4. new rates for [t+Δ, t+2Δ] from weir / orifice hydraulics on (surface depth, node head), minus any node overflow,
//      which SWMM would otherwise discard, so it goes back onto the street
// Water moved between the models is identical on both sides, so the combined balance is
//   surface stored + network stored = rain − infiltration − surface outflow − pipe outfalls (± SWMM continuity error).
import { inletFlow } from './drainage.js';

export class Coupler {
  /**
   * @param solver GPUSolver created with `inlets` = net.inlets.map(i => i.cell) (same order)
   * @param net    network from synthNetwork: nodes, pipes, inlets [{node, cell, grates}]
   * @param swmm   SWMM engine already opened with the network's .inp
   * @param zs     solver bed elevations (absolute, m) to read the surface level at each inlet cell
   */
  constructor(solver, net, swmm, zs, { interval = 2, roofArea = null, twoWay = false } = {}) {
    Object.assign(this, { solver, net, swmm, interval });
    // twoWay: inlet manholes pressurise (give them a large surcharge depth in the .inp) and water returns through the
    // inlet on the head difference, as HEC-RAS does, instead of spilling at the rim. Return flow per manhole is capped by
    // what its pipes deliver, so SWMM is never asked for water a nearly empty node does not hold.
    this.twoWay = twoWay;
    this.roofArea = roofArea; // m² of roof whose downspouts feed each node (rain goes straight into the pipes)
    this.inletNodes = net.inlets.map(g => g.node);
    this.grates = net.inlets.map(g => g.grates);
    this.swIdx = net.nodes.map(n => swmm.index('NODE', n.name));
    if (this.swIdx.some(i => i < 0)) throw new Error('SWMM node lookup failed');
    this.zs = net.inlets.map(g => zs[g.cell]);
    this.perNode = net.nodes.map(() => 0); for (const i of this.inletNodes) this.perNode[i]++; // exchange points per manhole
    this.q = new Float32Array(this.inletNodes.length);
    this.ret = new Float64Array(this.inletNodes.length); // overflow (m³/s) netted out of each inlet's rate this interval
    this.tNext = interval;
    this.stage = null; // observed water level (m) applied to outfalls that discharge to a stream
    this.streamOutfalls = net.nodes.map((n, i) => (n.toStream ? i : -1)).filter(i => i >= 0);
    this.totals = { toNetwork: 0, toSurface: 0, overflowReturned: 0, overflowLost: 0, roofToSewer: 0, backflow: 0, latOut: 0, extra: 0 };
    // lateral inflow (m³/s) other link models add at nodes for the coming interval (pond outlets, underdrains); they
    // step before the coupler in the hub, and it is cleared once given to SWMM
    this.extra = new Float64Array(net.nodes.length);
    this.state = { head: new Float64Array(net.nodes.length), flow: new Float64Array(net.pipes.length), depth: new Float64Array(net.pipes.length), surcharged: 0, flooding: 0 };
  }

  get count() { return this.inletNodes.length; }

  /** Call when the surface solver has reached `this.tNext` (standalone; with other link models use a LinkHub). */
  async exchange() {
    const { vol, h } = await this.solver.readInlets();
    this.solver.setInletRates(this.step(vol, h, this.interval, this.tNext));
    this.tNext += this.interval;
  }

  /** Measured exchange over the interval ending at tNext → SWMM strides to tNext → rates for the next interval. */
  step(vol, h, interval, tNext) {
    const { solver, swmm, net } = this, M = this.inletNodes.length;
    // SWMM gets exactly what the surface gave up (or received) over the interval, summed over each manhole's grates.
    // Overflow that SWMM discarded last interval was handed to the street by netting it out of this rate; it is credited
    // back so SWMM is not charged twice (it already booked it as flooding).
    const lat = new Float64Array(net.nodes.length);
    for (let m = 0; m < M; m++) {
      const v = vol[m]; if (v > 0) this.totals.toNetwork += v; else this.totals.toSurface -= v;
      lat[this.inletNodes[m]] += v / interval + this.ret[m];
      this.totals.overflowReturned += this.ret[m] * interval;
    }
    if (this.roofArea) { // roof rain over the interval (rain is constant within an exchange interval: blocks align with it)
      const r = solver.rainRate;
      for (let i = 0; i < lat.length; i++) if (this.roofArea[i]) { lat[i] += r * this.roofArea[i]; this.totals.roofToSewer += r * this.roofArea[i] * interval; }
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
    swmm.stepTo(tNext, (dt) => { for (const i of junc) { const q = swmm.node('OVERFLOW', this.swIdx[i]); if (q > 0) flood[i] += q * dt; } });
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
        const i = this.inletNodes[m], eta = this.zs[m] + Math.max(0, h[m]), dH = this.state.head[i] - eta;
        if (dH > 0 && this.state.head[i] > this.zs[m]) { back[m] = net.opts.Co * net.opts.inletArea * this.grates[m] * Math.sqrt(2 * 9.81 * dH); want[i] += back[m]; }
      }
      for (let m = 0; m < M; m++) if (back[m] > 0) {
        const i = this.inletNodes[m], pipeIn = Math.max(0, swmm.node('INFLOW', this.swIdx[i]) - swmm.node('LATFLOW', this.swIdx[i]));
        back[m] *= Math.min(1, pipeIn / want[i]);
      }
    }
    for (let m = 0; m < M; m++) {
      const i = this.inletNodes[m], n = net.nodes[i];
      const share = overflow[i] / this.perNode[i]; // a manhole's overflow leaves through all of its grates
      this.q[m] = inletFlow(h[m], this.zs[m], this.state.head[i], this.grates[m], net.opts) - share - (back?.[m] ?? 0); this.ret[m] = share;
      if (back) this.totals.backflow += back[m] * interval;
      flooding += share;
    }
    net.nodes.forEach((n, i) => { if (!this.perNode[i] && overflow[i] > 0) this.totals.overflowLost += overflow[i] * interval; });
    this.state.surcharged = surcharged; this.state.flooding = flooding;
    net.pipes.forEach((p, k) => { this.state.flow[k] = swmm.link('FLOW', k); this.state.depth[k] = swmm.link('DEPTH', k); });
    return this.q;
  }
}
