// Surface links (Phase 2): culverts that carry water between two surface cells under an embankment, and a hub that
// lets several exchange models (culverts, the SWMM pipe network, a 1D river) share the solver's exchange cells.
//
// Culverts are conservative by construction: each interval a culvert removes water at its upstream cell at the rate
// its hydraulics give (the solver never removes more than the cell holds), the hub measures what was actually removed,
// and exactly that volume is delivered at the downstream cell over the next interval. Flow reverses when the tailwater
// is higher. The one-interval lag (seconds) is the price of exact mass.
import { culvertFlow } from './river.js';

/**
 * @param culverts [{ a, b, inv, D, len, n }] — surface cell indices of the two ends (a upstream as mapped), the barrel
 *                 invert (m), diameter (m), length (m) and Manning's n
 * @param zs       solver bed elevations (absolute, m)
 */
export class CulvertLinks {
  constructor(culverts, zs, { cellArea }) {
    this.culverts = culverts; this.area = cellArea;
    // one exchange cell per distinct culvert end
    const cells = [...new Set(culverts.flatMap(c => [c.a, c.b]))];
    this.cells = cells; this.slot = new Map(cells.map((k, i) => [k, i]));
    this.zs = cells.map(k => zs[k]);
    this.q = new Float32Array(cells.length);
    this.out = new Float64Array(cells.length);   // planned removal this interval, by cell (m³)
    this.inDel = new Float64Array(cells.length); // deliveries applied this interval, by cell (m³)
    this.flow = new Float64Array(culverts.length); // signed flow a → b chosen for this interval (m³/s)
    this.pending = culverts.map(() => ({ cell: -1, vol: 0 }));
    this.totals = { moved: 0 };
  }
  get count() { return this.cells.length; }

  /** One exchange: measured volumes (m³, + removed) and depths at this model's cells → rates for the next interval. */
  step(vol, h, interval) {
    const { culverts, slot } = this, n = this.cells.length;
    // what culvert outflows actually removed from each cell: net measured removal plus the deliveries made into it
    const scale = new Float64Array(n);
    for (let i = 0; i < n; i++) scale[i] = this.out[i] > 0 ? Math.max(0, Math.min(1, (vol[i] + this.inDel[i]) / this.out[i])) : 0;
    culverts.forEach((c, j) => {
      const q = this.flow[j]; if (!q) { this.pending[j] = { cell: -1, vol: 0 }; return; }
      const src = q > 0 ? c.a : c.b, dst = q > 0 ? c.b : c.a, v = Math.abs(q) * interval * scale[slot.get(src)];
      this.pending[j] = { cell: dst, vol: v }; this.totals.moved += v;
    });
    // next interval: new flows from the levels now, plus last interval's water arriving downstream
    this.q.fill(0); this.out.fill(0); this.inDel.fill(0);
    culverts.forEach((c, j) => {
      const ia = slot.get(c.a), ib = slot.get(c.b), Ha = this.zs[ia] + Math.max(0, h[ia]), Hb = this.zs[ib] + Math.max(0, h[ib]);
      let q = culvertFlow(Ha, Hb, c);
      const cap = 0.5 * Math.abs(Ha - Hb) * this.area / interval; q = Math.max(-cap, Math.min(cap, q)); // explicit: at most half the level difference
      const src = q > 0 ? ia : ib; if ((q > 0 ? h[ia] : h[ib]) <= 1e-4) q = 0;
      this.flow[j] = q; this.q[src] += Math.abs(q); this.out[src] += Math.abs(q) * interval;
      const p = this.pending[j]; if (p.cell >= 0) { const d = slot.get(p.cell); this.q[d] -= p.vol / interval; this.inDel[d] += p.vol; }
    });
    return this.q;
  }
}

/**
 * Several exchange models on one solver. members: [{ count, step(vol, h, interval) → rates (Float32Array, count) }]
 * in the order their cells were given to the solver (solver inlets = concatenation of each member's cells). Members
 * whose step is async (SWMM) are awaited.
 */
export class LinkHub {
  constructor(solver, members, interval) {
    Object.assign(this, { solver, members, interval });
    this.offsets = []; let o = 0; for (const m of members) { this.offsets.push(o); o += m.count; }
    this.q = new Float32Array(o); this.tNext = interval;
  }
  async exchange() {
    const { vol, h } = await this.solver.readInlets();
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i], o = this.offsets[i];
      const r = await m.step(vol.subarray(o, o + m.count), h.subarray(o, o + m.count), this.interval, this.tNext);
      this.q.set(r, o);
    }
    this.solver.setInletRates(this.q);
    this.tNext += this.interval;
  }
}
