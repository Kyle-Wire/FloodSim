// Combined sewers: sanitary (dry-weather) flow, regulators that send flow to the interceptor up to its capacity and the
// rest over a weir to the overflow (CSO) outfall, flap gates on outfalls to tidal water, and the overflow books.
//
//   dry-weather flow  people per manhole from the land cover it serves (developed NLCD classes, people per ha) ×
//                     litres per person per day, on a 24-hour pattern (mean 1); SWMM [DWF] + [PATTERNS], and the pipes
//                     start with that flow in them (each conduit's initial flow is the dry-weather flow above it)
//   regulator         at each outfall to a stream or a real outfall: the outfall becomes a junction; an OUTLET link with
//                     a rating curve (flow rising with depth to the interceptor capacity, then flat) leads to an
//                     interceptor outfall, and a transverse WEIR at the depth where the curve reaches capacity spills the
//                     rest to the overflow outfall. Capacity: a multiple of the peak dry-weather flow above it
//   flap gate         the overflow outfall is gated (SWMM Gated YES): a tide above the pipe cannot back into it
//   books             per overflow outfall: events (overflow above minQ, separated by at least interEventH dry hours),
//                     volume, peak and time overflowing; interceptor volume; capture = interceptor / (interceptor + CSO)
// SWMM's dynamic wave treats flow dividers as plain junctions, hence the outlet-and-weir regulator.

export const CSO_DEFAULTS = {
  perCapita: 300,                                // L per person per day (about 80 US gal: sanitary flow, no groundwater infiltration)
  density: { 21: 8, 22: 25, 23: 60, 24: 120 },   // people per ha of NLCD developed open / low / medium / high intensity
  capacity: 3,                                   // interceptor capacity at each regulator, × the peak dry-weather flow above it
  minCapacity: 0.005,                            // m³/s: a regulator above very few people still takes 5 L/s
  interEventH: 6,                                // dry hours that separate two overflow events
  minQ: 1e-4,                                    // m³/s (0.1 L/s): below this an outfall is not overflowing
};

// Typical residential diurnal pattern (illustrative: low at 3–4 am, morning peak 8–9 am, evening peak 7 pm), mean 1
const RAW = [0.60, 0.45, 0.38, 0.35, 0.36, 0.45, 0.75, 1.15, 1.40, 1.40, 1.30, 1.20, 1.15, 1.10, 1.05, 1.05, 1.10, 1.20, 1.35, 1.40, 1.35, 1.20, 1.00, 0.80];
export const DIURNAL = RAW.map(v => v * 24 / RAW.reduce((a, b) => a + b, 0));
export const PEAK_FACTOR = Math.max(...DIURNAL);

/** The pattern rotated so its first hour is local hour `startHour` (SWMM's hourly pattern runs on the simulation clock). */
export const rotated = (startHour) => { const h = ((Math.round(startHour) % 24) + 24) % 24; return DIURNAL.map((_, i) => DIURNAL[(i + h) % 24]); };
/** Dry-weather volume (m³) of base flow q (m³/s) from simulation time 0 to t (s), on the pattern rotated to startHour. */
export function dwfVolume(q, t, startHour = 0) {
  const p = rotated(startHour); let v = 0;
  for (let s = 0; s < t; s += 3600) v += q * p[Math.floor(s / 3600) % 24] * Math.min(3600, t - s);
  return v;
}

/**
 * People served by each junction: every fine cell goes to the nearest junction (4 m blocks, within rmax m along the
 * grid, as the rational-method catchments) and adds its NLCD class's density. → Float64Array per node (0 at outfalls)
 */
export function populationPerNode(fine, f, net, { density = CSO_DEFAULTS.density, uniform = null, rmax = 150 } = {}) {
  const nodes = net.nodes, pop = new Float64Array(nodes.length);
  const B = Math.max(1, Math.round(4 / fine.dx)), bw = Math.ceil(fine.nx / B), bh = Math.ceil(fine.ny / B);
  const owner = new Int32Array(bw * bh).fill(-1), d = new Float32Array(bw * bh).fill(Infinity), q = [];
  nodes.forEach((n, i) => {
    if (n.outfall || n.regulator) return;
    const i0 = Math.max(0, Math.min(fine.nx - 1, Math.floor(n.p[0]))), j0 = Math.max(0, Math.min(fine.ny - 1, Math.floor(n.p[1])));
    const b = ((j0 / B) | 0) * bw + ((i0 / B) | 0); if (owner[b] < 0) { owner[b] = i; d[b] = 0; q.push(b); }
  });
  for (let h = 0; h < q.length; h++) {
    const b = q[h], bi = b % bw, bj = (b / bw) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = bi + di, j = bj + dj; if (i < 0 || j < 0 || i >= bw || j >= bh) continue;
      const c = j * bw + i; if (owner[c] >= 0) continue;
      const nd = d[b] + B * fine.dx; if (nd > rmax) continue;
      owner[c] = owner[b]; d[c] = nd; q.push(c);
    }
  }
  const ha = fine.dx * fine.dx / 1e4;
  for (let j = 0; j < fine.ny; j++) for (let i = 0; i < fine.nx; i++) {
    const n = owner[((j / B) | 0) * bw + ((i / B) | 0)]; if (n < 0) continue;
    const cls = f.cls?.[j * fine.nx + i], dens = density[cls] ?? 0;
    pop[n] += ha * (uniform != null ? (dens > 0 ? uniform : 0) : dens);
  }
  return pop;
}

/** Base (mean) dry-weather flow per node, m³/s, from people and litres per person per day; set as n.dwf. → total m³/s */
export function setDWF(net, pop, { perCapita = CSO_DEFAULTS.perCapita } = {}) {
  let total = 0;
  net.nodes.forEach((n, i) => { const q = (pop[i] || 0) * perCapita / 1000 / 86400; n.dwf = q > 0 ? q : 0; total += n.dwf; });
  return total;
}

/** Each node's mean dry-weather flow from above (itself and every node draining to it), m³/s. */
export function dwfAbove(net) {
  const acc = net.nodes.map(n => n.dwf ?? 0), down = net.nodes.map(() => []), indeg = net.nodes.map(() => 0);
  for (const p of net.pipes) if (p.kind == null) { down[p.from].push(p.to); indeg[p.to]++; }
  const ready = net.nodes.map((_, i) => i).filter(i => !indeg[i]), seen = new Uint8Array(net.nodes.length);
  while (ready.length) { const i = ready.pop(); seen[i] = 1; for (const k of down[i]) { acc[k] += acc[i]; if (!--indeg[k]) ready.push(k); } }
  return acc;
}

/**
 * Regulators at every outfall to a stream (or a real outfall): the outfall node becomes junction R; R → interceptor
 * outfall (OUTLET, rating curve to the capacity) and R → overflow outfall (WEIR at the capacity depth), the overflow
 * outfall keeping the stream / tide stage, gated when `gates`. Capacity = capacity × PEAK_FACTOR × dwf above R.
 * → [{ name, regulator (node index), interceptor, overflow, qcap, dwf, crest }]
 */
export function addRegulators(net, { capacity = CSO_DEFAULTS.capacity, minCapacity = CSO_DEFAULTS.minCapacity, gates = true } = {}) {
  const above = dwfAbove(net), out = [];
  const targets = net.nodes.map((n, i) => (n.outfall && (n.toStream || n.realOutfall) ? i : -1)).filter(i => i >= 0);
  for (const k of targets) {
    const n = net.nodes[k], into = net.pipes.filter(p => p.to === k); if (!into.length) continue;
    const D = Math.max(...into.map(p => p.D ?? 0.3)), qcap = Math.max(minCapacity, capacity * PEAK_FACTOR * above[k]);
    const crest = Math.max(0.1, Math.min(0.5 * D, 1)), base = n.name.replace(/^[OJ]/, '');
    const reg = { ...n, name: 'R' + base, outfall: false, toStream: false, realOutfall: false, regulator: true, depth: Math.max(n.depth ?? 0, crest + D + 0.5), inletFine: [] };
    const ovf = { ...n, name: 'O' + base + 'C', outfall: true, outfallType: n.outfallType ?? 'FREE', gated: !!gates, cso: true, depth: 0.5, inletFine: [] };
    const icp = { ...n, name: 'I' + base, outfall: true, outfallType: 'FREE', toStream: false, realOutfall: false, interceptor: true, invert: n.invert - 0.3, depth: 0.5, inletFine: [] };
    net.nodes[k] = reg; net.nodes.push(ovf, icp);
    const io = net.nodes.length - 2, ii = net.nodes.length - 1;
    // the curve: flow in proportion to depth up to the crest, then the capacity whatever the depth
    net.pipes.push({ name: 'W' + base, kind: 'weir', from: k, to: io, crest, D, W: Math.max(1, 2 * D), L: 1, S: 0, Q: 0, inOffset: crest, outOffset: 0 });
    net.pipes.push({ name: 'U' + base, kind: 'outlet', from: k, to: ii, curve: [[0, 0], [crest, qcap], [crest + 50, qcap]], D, L: 1, S: 0, Q: qcap, inOffset: 0, outOffset: 0 });
    out.push({ name: base, regulator: k, interceptor: ii, overflow: io, qcap, dwf: above[k], crest });
  }
  return out;
}

/**
 * Overflow events in a flow series [[t (s), q (m³/s)]]: spans with q > minQ, merged when apart by less than
 * interEventH hours. → [{ start, end, volume (m³, trapezoid), peak, overflowS (time above minQ) }]
 */
export function overflowEvents(series, { interEventH = CSO_DEFAULTS.interEventH, minQ = CSO_DEFAULTS.minQ } = {}) {
  const ev = []; let cur = null;
  for (let m = 1; m < series.length; m++) {
    const [t0, q0] = series[m - 1], [t1, q1] = series[m], on = q1 > minQ || q0 > minQ;
    if (!on) continue;
    if (!cur || t0 - cur.end >= interEventH * 3600) { cur = { start: t0, end: t1, volume: 0, peak: 0, overflowS: 0 }; ev.push(cur); }
    cur.end = t1; cur.volume += 0.5 * (q0 + q1) * (t1 - t0); cur.peak = Math.max(cur.peak, q0, q1);
    cur.overflowS += (q0 > minQ && q1 > minQ) ? t1 - t0 : (t1 - t0) / 2;
  }
  return ev;
}

/**
 * Books for the run record. regs: addRegulators' list; hgl: Coupler.report() (outfalls, series every 10 s, outVol per
 * node index, m³). T: the run length (s); startHour: local hour at its start; dwfOn: dry-weather flow was in the pipes.
 * Wet-weather capture takes each regulator's own dry-weather volume over the run out of its interceptor volume.
 * → { regulators: [{ name, qcap, dwf, cso: { volume, peak, overflowS, events }, interceptor: { volume, peak }, series }],
 *     totals: { cso, interceptor, offsite, dwf, events, capture, wetCapture }, rule: { interEventH, minQ } }
 */
export function csoBooks(regs, hgl, { T = 0, startHour = 0, dwfOn = true, dwfTotal = 0, offsite = 0, interEventH = CSO_DEFAULTS.interEventH, minQ = CSO_DEFAULTS.minQ, gates = true } = {}) {
  const col = (i) => { const j = hgl?.outfalls?.indexOf(i) ?? -1; return j < 0 ? [] : hgl.series.map(r => [r[0], r[1 + j]]); };
  const vol = (i) => hgl?.outVol?.[i] ?? 0, mx = (s) => s.reduce((a, p) => Math.max(a, p[1]), 0);
  const rows = regs.map(g => {
    const s = col(g.overflow), si = col(g.interceptor), ev = overflowEvents(s, { interEventH, minQ });
    return { name: g.name, qcap: g.qcap, dwf: g.dwf, crest: g.crest, gated: gates, dwfVolume: dwfOn ? dwfVolume(g.dwf, T, startHour) : 0,
      cso: { volume: vol(g.overflow), peak: mx(s), overflowS: ev.reduce((a, e) => a + e.overflowS, 0), events: ev },
      interceptor: { volume: vol(g.interceptor), peak: mx(si) }, series: { cso: s, interceptor: si } };
  });
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0), cso = sum(r => r.cso.volume), icp = sum(r => r.interceptor.volume);
  const wet = Math.max(0, icp - sum(r => r.dwfVolume));
  return { regulators: rows, rule: { interEventH, minQ },
    totals: { cso, interceptor: icp, offsite, dwf: dwfTotal, events: sum(r => r.cso.events.length),
      capture: icp + cso > 0 ? icp / (icp + cso) : null, wetCapture: wet + cso > 0 ? wet / (wet + cso) : null } };
}
