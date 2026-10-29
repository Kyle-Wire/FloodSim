// Stormwater design (phase 3 of docs/specs/site-design-mode.md): pond outlet structures, drawn bioretention and
// permeable pavement, and the detention check.
//
//   outlet structure  a riser in a pond: up to two orifices at set inverts, an overflow weir (riser crest), and an
//                     emergency spillway weir. Its composite rating Q(H, Ht) — H the pond level, Ht the tailwater — runs
//                     as a link from the pond's lowest cell to a downstream surface cell, a network node, or off the model
//                     (OutletLinks, a LinkHub member like the culverts: what a link removes is measured, then delivered,
//                     so mass is exact). Stage–storage is not entered: the pond is in the graded 1 m ground.
//   drawn GI          bioretention and permeable pavement use the solver's GI store kernel on their own cells at 100 %:
//                     intake rate, store (media × porosity), drain to the native soil, and an optional underdrain that
//                     takes part of the drain to a network node (UnderdrainLinks)
//   detention check   post-development peak ≤ pre-development peak at each control line, per return period
import { HSG_RATE, URBAN_FILL_RATE } from './terrain.js';
import { GI } from './gi.js';

const G = 9.81, MMHR = 1 / 3.6e6;
/** Default coefficients: orifice discharge Cd, riser overflow weir and emergency spillway (broad-crested, m^½/s). */
export const COEF = { orifice: 0.61, weir: 1.84, spillway: 1.7 };

/** Villemonte submergence factor for a weir with upstream head h1 and downstream head h2 over its crest. */
const villemonte = (h1, h2) => (h2 <= 0 ? 1 : Math.pow(Math.max(0, 1 - Math.pow(h2 / h1, 1.5)), 0.385));

/**
 * Flow through one orifice of diameter D (m) with its invert at inv: orifice flow on the head over its centre (or over
 * the tailwater when that is higher); while the opening is part full (level h over the invert below D) on the head
 * over the middle of the flowing depth, scaled by (h/D)^1.5 (it then acts as a weir), so the rating is continuous at
 * the crown and starts at the invert. Signed: + from the pond side.
 */
export function orificeQ(H, Ht, D, inv, Cd = COEF.orifice) {
  const up = Math.max(H, Ht), dn = Math.min(H, Ht), s = H >= Ht ? 1 : -1;
  if (!(D > 0) || up <= inv) return 0;
  const A = Math.PI * D * D / 4, centre = up < inv + D ? inv + (up - inv) / 2 : inv + D / 2, head = up - Math.max(centre, dn);
  if (head <= 0) return 0;
  return s * Cd * A * Math.sqrt(2 * G * head) * Math.min(1, (up - inv) / D) ** 1.5;
}
/** Weir flow C·L·h^1.5 over a crest with Villemonte submergence. Signed: + from the pond side. */
export function weirQ(H, Ht, crest, L, C) {
  const up = Math.max(H, Ht), dn = Math.min(H, Ht), s = H >= Ht ? 1 : -1;
  if (!(L > 0) || up <= crest) return 0;
  const h1 = up - crest, h2 = dn - crest;
  return s * C * L * h1 ** 1.5 * villemonte(h1, h2);
}
/**
 * Composite rating of an outlet structure (m³/s, + out of the pond) at pond level H and tailwater Ht (−Infinity =
 * free outfall). o: { orifices: [{ D, inv }], weir: { crest, L } | null, spillway: { crest, L } | null, Cd, Cw, Cs }
 * → { q, parts: { orifices, weir, spillway } }
 */
export function rating(o, H, Ht = -Infinity) {
  const orf = (o.orifices ?? []).reduce((a, x) => a + orificeQ(H, Ht, x.D, x.inv, o.Cd ?? COEF.orifice), 0);
  const w = o.weir ? weirQ(H, Ht, o.weir.crest, o.weir.L, o.Cw ?? COEF.weir) : 0;
  const sp = o.spillway ? weirQ(H, Ht, o.spillway.crest, o.spillway.L, o.Cs ?? COEF.spillway) : 0;
  return { q: orf + w + sp, parts: { orifices: orf, weir: w, spillway: sp } };
}

/**
 * Stage–storage of a pond from the ground: S(h) = Σ max(0, h − z)·A over its cells, at `n` stages from the bottom to
 * `top`. → { h: Float64Array, S: Float64Array, area: Float64Array (wetted area), bottom }
 */
export function stageStorage(z, cells, cellArea, top, n = 60) {
  let bottom = Infinity; for (const k of cells) bottom = Math.min(bottom, z[k]);
  const h = new Float64Array(n), S = new Float64Array(n), area = new Float64Array(n);
  for (let m = 0; m < n; m++) {
    const lv = bottom + (top - bottom) * m / (n - 1); h[m] = lv; let s = 0, a = 0;
    for (const k of cells) if (lv > z[k]) { s += (lv - z[k]) * cellArea; a += cellArea; }
    S[m] = s; area[m] = a;
  }
  return { h, S, area, bottom };
}
const interp = (x, xs, ys) => {
  if (x <= xs[0]) return ys[0]; const n = xs.length; if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]) * (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2] || 1);
  let a = 0, b = n - 1; while (b - a > 1) { const m = (a + b) >> 1; if (xs[m] <= x) a = m; else b = m; }
  return ys[a] + (ys[b] - ys[a]) * (x - xs[a]) / (xs[b] - xs[a] || 1);
};
/**
 * Level-pool routing by the modified Puls (storage-indication) method: inflow I(t) (m³/s), stage–storage { h, S },
 * outflow O(h) (m³/s), initial stage h0, step dt (s), to tEnd. Each step solves
 * 2S₂/dt + O₂ = I₁ + I₂ + 2S₁/dt − O₁ on the storage-indication curve. → [{ t, h, S, O }]
 */
export function modifiedPuls(inflow, ss, outflow, { h0, dt, tEnd }) {
  const O = Array.from(ss.h, outflow), SI = Array.from(ss.S, (s, m) => 2 * s / dt + O[m]);
  let h = h0, S = interp(h0, ss.h, ss.S), o = outflow(h0), t = 0;
  const out = [{ t, h, S, O: o }];
  while (t < tEnd - 1e-9) {
    const i1 = inflow(t), i2 = inflow(t + dt), rhs = i1 + i2 + 2 * S / dt - o;
    h = interp(rhs, SI, ss.h); S = interp(h, ss.h, ss.S); o = outflow(h); t += dt;
    out.push({ t, h, S, O: o });
  }
  return out;
}

// ------------------------------------------------------------------ links

/**
 * Pond outlet structures as surface links (LinkHub members). outlets: [{ a (pond cell), b (surface cell or −1),
 * node (network node index or −1), mode: 'surface' | 'network' | 'offsite', structure (see rating), id, name }];
 * zs: solver bed elevations (absolute). Each interval: the volume each outlet actually removed (measured by the solver)
 * goes downstream — into cell b over the next interval, into SWMM as lateral inflow at its node (coupler.extra, the
 * coupler steps after this), or off the model (booked) — and new rates come from the levels now. Records each outlet's
 * peak stage, peak outflow and the parts of the rating at the peak.
 */
export class OutletLinks {
  constructor(outlets, zs, { cellArea, coupler = null }) {
    this.outlets = outlets; this.area = cellArea; this.coupler = coupler;
    const cells = [...new Set(outlets.flatMap(o => (o.mode === 'surface' ? [o.a, o.b] : [o.a])))];
    this.cells = cells; this.slot = new Map(cells.map((k, i) => [k, i])); this.zs = cells.map(k => zs[k]);
    this.q = new Float32Array(cells.length); this.out = new Float64Array(cells.length); this.inDel = new Float64Array(cells.length);
    this.flow = new Float64Array(outlets.length); this.pending = outlets.map(() => ({ cell: -1, vol: 0 }));
    this.totals = { moved: 0, toNetwork: 0, offsite: 0 };
    this.stats = outlets.map(() => ({ peakStage: -Infinity, tStage: NaN, peakQ: 0, tQ: NaN, parts: null, volume: 0 }));
    this.t = 0;
  }
  get count() { return this.cells.length; }
  /** Water a surface outlet took and has not yet delivered (m³): it counts as stored. */
  get inTransit() { return this.pending.reduce((a, p) => a + p.vol, 0); }

  step(vol, h, interval) {
    const { outlets, slot } = this, n = this.cells.length; this.t += interval;
    const scale = new Float64Array(n); // share of each planned removal the solver could make
    for (let i = 0; i < n; i++) scale[i] = this.out[i] > 0 ? Math.max(0, Math.min(1, (vol[i] + this.inDel[i]) / this.out[i])) : 0;
    outlets.forEach((o, j) => {
      const q = this.flow[j]; this.pending[j] = { cell: -1, vol: 0 }; if (!q) return;
      const src = q > 0 ? o.a : o.b, v = Math.abs(q) * interval * scale[slot.get(src)];
      if (o.mode === 'surface') { this.pending[j] = { cell: q > 0 ? o.b : o.a, vol: v }; this.totals.moved += v; }
      else if (o.mode === 'network' && this.coupler) { this.coupler.extra[o.node] += v / interval; this.totals.toNetwork += v; }
      else this.totals.offsite += v;
      this.stats[j].volume += q > 0 ? v : -v;
    });
    this.q.fill(0); this.out.fill(0); this.inDel.fill(0);
    outlets.forEach((o, j) => {
      const ia = slot.get(o.a), H = this.zs[ia] + Math.max(0, h[ia]);
      let Ht = -Infinity, ib = -1;
      if (o.mode === 'surface') { ib = slot.get(o.b); Ht = this.zs[ib] + Math.max(0, h[ib]); }
      else if (o.mode === 'network' && this.coupler) Ht = this.coupler.state.head[o.node] ?? -Infinity;
      const r = rating(o.structure, H, Ht); let q = r.q;
      if (o.mode === 'surface') { const cap = 0.5 * Math.abs(H - Ht) * this.area / interval; q = Math.max(-cap, Math.min(cap, q)); } // explicit: at most half the level difference
      if (q > 0 && h[ia] <= 1e-4) q = 0; if (q < 0 && (o.mode !== 'surface' || h[ib] <= 1e-4)) q = 0; // reverse flow only from a surface tailwater
      this.flow[j] = q;
      const src = q > 0 ? ia : ib; if (q) { this.q[src] += Math.abs(q); this.out[src] += Math.abs(q) * interval; }
      const p = this.pending[j]; if (p.cell >= 0) { const d = slot.get(p.cell); this.q[d] -= p.vol / interval; this.inDel[d] += p.vol; }
      const s = this.stats[j]; if (H > s.peakStage) { s.peakStage = H; s.tStage = this.t; } if (q > s.peakQ) { s.peakQ = q; s.tQ = this.t; s.parts = r.parts; }
    });
    return this.q;
  }
  /** Per outlet: peak stage, freeboard to the spillway crest (− = the spillway ran), peak outflow, volume out. */
  results() {
    return this.outlets.map((o, j) => {
      const s = this.stats[j], sp = o.structure.spillway?.crest;
      return { id: o.id, name: o.name ?? null, mode: o.mode, peakStage: s.peakStage, tPeakStage: s.tStage, freeboard: Number.isFinite(sp) ? sp - s.peakStage : null, peakQ: s.peakQ, tPeakQ: s.tQ, parts: s.parts, volume: s.volume };
    });
  }
}

/**
 * Underdrains of drawn bioretention to network nodes (a LinkHub member with no exchange cells). The GI kernel books
 * the underdrained depth per cell (GS.w); each interval the increase, per feature, goes into SWMM as lateral inflow
 * at its node (coupler.extra; the coupler steps after this). groups: [{ id, node, cells: [solver cells] }]
 */
export class UnderdrainLinks {
  constructor(solver, groups, { cellArea, coupler }) {
    Object.assign(this, { solver, groups, area: cellArea, coupler });
    this.last = groups.map(g => new Float64Array(g.cells.length)); this.totals = { underdrain: 0 }; this.byGroup = groups.map(() => 0);
  }
  get count() { return 0; }
  async step(vol, h, interval) {
    const d = await this.solver.readUnderdrains();
    let o = 0;
    this.groups.forEach((g, gi) => {
      let v = 0; for (let m = 0; m < g.cells.length; m++, o++) { const x = d[o]; v += Math.max(0, x - this.last[gi][m]); this.last[gi][m] = x; }
      v *= this.area; this.byGroup[gi] += v; this.totals.underdrain += v;
      if (this.coupler && g.node >= 0) this.coupler.extra[g.node] += v / interval;
    });
    return new Float32Array(0);
  }
}

// ------------------------------------------------------------------ drawn GI

/**
 * Solver-grid GI layers of drawn bioretention and permeable pavement (fine.drawnGI from applyDesign: [{ id, kind,
 * cells (fine), rate (m/s), store (m), under (m/s of underdrain), node }]), at 100 % on their cells, added to the
 * area-wide layer `base` (giLayers) when given. The store drains to the native soil at its group's rate (SSURGO groups,
 * else the compacted-fill rate) and, with an underdrain, also at `under`. → { rate, cap, drain, under, pavedArea,
 * gardenArea, drawn: [{ id, kind, area, cells: [solver cells] }] } or base when nothing is drawn
 */
export function drawnGI(f, c, F, base = null) {
  const list = f.drawnGI ?? []; if (!list.length) return base;
  const N = c.nx * c.ny, A = F * F, soil = ['', 'A', 'B', 'C', 'D'];
  const out = { rate: new Float64Array(N), cap: new Float64Array(N), drain: new Float64Array(N), under: new Float64Array(N), pavedArea: base?.pavedArea ?? 0, gardenArea: base?.gardenArea ?? 0, drawn: [] };
  if (base) for (let K = 0; K < N; K++) { out.rate[K] = base.rate[K]; out.cap[K] = base.cap[K]; out.drain[K] = base.drain[K]; }
  for (const g of list) {
    const per = new Map(); // solver cell → fine pixels of this feature in it
    for (const k of g.cells) { if (f.bld[k]) continue; const K = (((k / f.nx) | 0) / F | 0) * c.nx + ((k % f.nx) / F | 0); if (c.mask[K]) per.set(K, (per.get(K) ?? 0) + 1); }
    let area = 0;
    for (const [K, n] of per) {
      const share = n / A, k0 = g.cells[0], h = f.hsg?.[k0] ?? 0, native = (h ? HSG_RATE[soil[h]] : URBAN_FILL_RATE) * MMHR;
      out.rate[K] += share * g.rate; out.cap[K] += share * g.store; out.drain[K] += share * native; out.under[K] += share * (g.under ?? 0);
      area += n * f.dx * f.dx;
    }
    if (g.kind === 'permeable') out.pavedArea += area; else out.gardenArea += area;
    out.drawn.push({ id: g.id, kind: g.kind, area, node: g.node ?? null, cells: [...per.keys()] });
  }
  return out;
}
/** Permeable pavement: the area-wide GI values (src/gi.js), at 100 % on the drawn cells. */
export const PERMEABLE = { rate: GI.pavement.rate * MMHR, store: GI.pavement.store };

// ------------------------------------------------------------------ the detention check

/**
 * The standard detention check from paired runs over the design storms: per control line and return period, the
 * pre- and post-development peak flow and whether post ≤ pre. rows: [{ ari, line: { id, name }, pre, post }] with
 * pre / post the peak outflow (m³/s, NaN when the run is missing). → rows with { pass, ratio }
 */
export function detentionTable(rows, tol = 1e-6) {
  return rows.map(r => ({ ...r, pass: Number.isFinite(r.pre) && Number.isFinite(r.post) ? r.post <= r.pre + tol : null, ratio: r.pre > 0 ? r.post / r.pre : NaN }));
}
