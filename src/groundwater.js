// Groundwater return flow: part of the rain that soaks into the ground comes back out into the streams over the hours
// and days after a storm (shallow groundwater and the flow through the soil above it), which keeps a creek running after
// the storm runoff has passed. Without it, a model drains to nothing within hours of the rain stopping where the gauge
// still shows a slow tail (Edwards Branch, Charlotte, June 2025: 29,000 m³ passed the gauge after the storm against the
// model's 11,500).
//
// One linear reservoir for the whole area: a share of the water infiltrated goes into a store, and the store empties into
// the mapped streams at a rate of (what it holds) / (its lag), so after the rain stops the return falls off by a factor
// e every lag. The rest of the infiltrated water stays in the ground (soil moisture, deeper groundwater, plants) for the
// length of a run. Both are settings to fit to a gauge's recession: they are not measured.
//
// The return enters through the solver's exchange cells (negative rate = water in), spread evenly over cells along the
// mapped streams, so the books count it as inflow.

/**
 * Exchange cells along the mapped streams, one about every `spacing` m: fine-grid paths (src/channels.js breachChannels
 * paths) on the solver grid `c` (cells F m). Cells outside the model, already used by another exchange point, or
 * repeated are skipped. → [cell]
 */
export function streamCells(paths, fine, c, F, used = new Set(), { spacing = 25 } = {}) {
  const out = [], seen = new Set(used), every = Math.max(1, Math.round(spacing / fine.dx));
  for (const path of paths ?? []) {
    for (let m = 0; m < path.length; m += every) {
      const k = path[m], i = Math.floor((k % fine.nx + 0.5) * fine.dx / F), j = Math.floor((Math.floor(k / fine.nx) + 0.5) * fine.dx / F);
      if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) continue;
      const kc = j * c.nx + i; if (!c.mask[kc] || seen.has(kc)) continue;
      seen.add(kc); out.push(kc);
    }
  }
  return out;
}

/** An exchange member (src/links.js LinkHub) giving back a share of the infiltrated water through `cells`. */
export class GroundwaterReturn {
  /**
   * @param cells exchange cells (streamCells)
   * @param share fraction of the infiltrated water that comes back within the run (0–1)
   * @param lagH  hours for the store to empty by a factor e once the rain has stopped
   */
  constructor(cells, { share, lagH }) {
    if (!(share >= 0 && share <= 1)) throw new Error(`groundwater share ${share} is not between 0 and 1`);
    if (!(lagH > 0)) throw new Error(`groundwater lag ${lagH} h is not positive`);
    Object.assign(this, { cells, count: cells.length, share, k: lagH * 3600 });
    this.q = new Float32Array(this.count);
    this.store = 0; this.seen = 0; // m³ in the store; the infiltration total the store has been fed from
    this.totals = { volume: 0, recharge: 0 }; // m³ returned to the streams; m³ that went into the store
  }
  /** The run's infiltration so far (m³, the books' total): what it rose by since the last call feeds the store. */
  recharge(infiltrated) {
    if (!(infiltrated > this.seen)) return;
    const d = (infiltrated - this.seen) * this.share; this.seen = infiltrated;
    this.store += d; this.totals.recharge += d;
  }
  /** What came in over the last interval (vol: m³, negative = in), then the rate (m³/s per cell, negative = in) for the next. */
  step(vol, h, interval) {
    let got = 0; for (let k = 0; k < vol.length; k++) got -= vol[k];
    this.totals.volume += got; this.store = Math.max(0, this.store - got);
    // a linear reservoir's outflow over the interval, exactly: store · (1 − e^(−Δt/k)), as a steady rate
    const rate = this.count ? this.store * -Math.expm1(-interval / this.k) / interval / this.count : 0;
    this.q.fill(-rate);
    return this.q;
  }
}
