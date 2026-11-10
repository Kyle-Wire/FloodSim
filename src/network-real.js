// Data tier 1: a SWMM network from a utility's own pipe layer (linked by the user, or a registered utility that publishes
// mains). Same output shape as synthNetwork, so the coupler, map and .inp writer treat both alike.
//
//   1. pipes clipped to the area; ends within 1.5 m snap to one manhole; where a pipe leaves the area its end is a
//      boundary node (continuation pipe to a normal-depth outlet, as in the synthetic network)
//   2. inverts are used when the layer has them and they are plausible against the lidar ground (metres or feet tried);
//      otherwise derived: `cover` m over the crown at the upstream end, the steeper of ground slope and 0.5 %
//      downstream, never rising at a manhole
//   3. flow direction from inverts, else from ground elevation, else as digitized
//   4. missing sizes come from the nearest sized pipe upstream/downstream, else the layer median (counted and reported)
//   5. inlets: real points (linked layer or registered utility) join the nearest pipe within 30 m, splitting it there
//      (catch-basin laterals meet mains mid-length; ends within 10 m are reused); without inlet data, one grate per
//      manhole at the gutter low point
//   6. outfalls the user placed (`opts.outfalls`, lon/lat) claim the nearest pipe end within 5 m: a boundary outfall
//      continues off-site like a pipe leaving the area, any other is a free outfall that also seeds the flow direction
//   7. an interior pipe end no outfall claims: in a separate storm sewer it discharges where it ends (`openEnd`: an
//      endwall the layer missed, or a gap whose water surfaces nearby); in a combined sewer (`opts.combined`) it may be a
//      gap on the way to the interceptor, so its water leaves the model
//   8. a pipe whose inverts rise along its drawn direction is first taken as drawn backwards. Where that would stop a main
//      dead (water arrives, nothing leaves, no outfall claims the manhole) the inverts are the error (a placeholder), so
//      the pipe keeps its drawn direction and the hump comes out
//   9. a pipe that starts at a placed endwall or flared end, with no grate, is a culvert entrance: surface water goes in
//      through the barrel's own opening
//  10. a culvert in two lengths (a manhole with no invert between two pipes running out to placed endwalls) lies on the
//      straight run between the endwalls' inverts
import { toCells } from './ingest.js';
import { DESIGN_DEFAULTS, addOutlets, exchangePoints } from './drainage.js';

export function realNetwork(fine, f, pipes, sim, opts = {}) {
  const o = { ...DESIGN_DEFAULTS, ...opts }, dx = fine.dx, W = fine.nx, H = fine.ny, eps = 1e-6;

  // ---- 1. clip and snap
  const nodes = [], buckets = new Map(), TOL = 1.5 / dx;
  const nodeAt = (p, edge) => {
    const bi = Math.floor(p[0] / TOL), bj = Math.floor(p[1] / TOL);
    for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++)
      for (const k of buckets.get(i + ',' + j) || []) if (Math.hypot(nodes[k].p[0] - p[0], nodes[k].p[1] - p[1]) <= TOL) { nodes[k].edge ||= edge; return k; }
    nodes.push({ p, edge, grates: [] }); const key = bi + ',' + bj;
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(nodes.length - 1);
    return nodes.length - 1;
  };
  const raw = [];
  for (const r of pipes) {
    const pts = toCells(fine, r.line);
    let cur = null; // current inside run: {pts, startEdge}
    const flush = (endEdge) => {
      if (cur && cur.pts.length > 1) {
        let L = 0; for (let k = 1; k < cur.pts.length; k++) L += Math.hypot(cur.pts[k][0] - cur.pts[k - 1][0], cur.pts[k][1] - cur.pts[k - 1][1]);
        if (L * dx > 0.5) raw.push({ r, pts: cur.pts, a: nodeAt(cur.pts[0], cur.startEdge), b: nodeAt(cur.pts[cur.pts.length - 1], endEdge), L: L * dx });
      }
      cur = null;
    };
    for (let s = 0; s + 1 < pts.length; s++) {
      const a = pts[s], b = pts[s + 1], d = [b[0] - a[0], b[1] - a[1]];
      let t0 = 0, t1 = 1;
      for (const [p, q] of [[-d[0], a[0]], [d[0], W - eps - a[0]], [-d[1], a[1]], [d[1], H - eps - a[1]]]) {
        if (p === 0) { if (q < 0) { t0 = 2; break; } continue; }
        const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      }
      if (t0 >= t1) { flush(true); continue; }
      const at = (t) => [a[0] + t * d[0], a[1] + t * d[1]];
      if (!cur) cur = { pts: [at(t0)], startEdge: t0 > 0 };
      cur.pts.push(at(t1));
      if (t1 < 1) flush(true);
    }
    flush(false);
  }
  if (!raw.length) return null;

  // ---- 1c. placed outfalls: the nearest pipe end within 5 m discharges there
  const userOut = new Set();
  for (const q of o.outfalls ?? []) {
    const p = toCells(fine, [[q.lon, q.lat]])[0]; let bk = -1, bd = Infinity;
    nodes.forEach((n, k) => { const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) * dx; if (d < bd) { bd = d; bk = k; } });
    if (bk < 0 || bd > 5) continue;
    if (q.boundary) nodes[bk].edge = true; else userOut.add(bk);
  }

  // nearest point on any pipe to p (cell coords), optionally skipping pipes that already end at node `skip`
  const nearestPipe = (p, skip = -1) => {
    let best = null;
    raw.forEach((q, qi) => {
      if (q.a === skip || q.b === skip) return;
      let along = 0;
      for (let k = 0; k + 1 < q.pts.length; k++) {
        const a = q.pts[k], b = q.pts[k + 1], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12, seg = Math.sqrt(L2);
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)), d = Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey);
        if (!best || d < best.d) best = { d, qi, k, at: (along + t * seg) * dx, pt: [a[0] + t * ex, a[1] + t * ey] };
        along += seg;
      }
    });
    return best;
  };
  // split pipe best.qi at best.pt (reusing an end within `reuse` m); inverts, if any, interpolate along the length
  const splitAt = (best, reuse, node = null) => {
    const q = raw[best.qi];
    if (best.at < reuse) return q.a; if (q.L - best.at < reuse) return q.b;
    node ??= nodeAt(best.pt, false);
    const f1 = best.at / q.L, mid = Number.isFinite(q.r.upInv) && Number.isFinite(q.r.dnInv) ? q.r.upInv + f1 * (q.r.dnInv - q.r.upInv) : NaN;
    raw.push({ r: { ...q.r, upInv: mid }, pts: [best.pt, ...q.pts.slice(best.k + 1)], a: node, b: q.b, L: q.L - best.at });
    q.r = { ...q.r, dnInv: mid }; q.pts = [...q.pts.slice(0, best.k + 1), best.pt]; q.b = node; q.L = best.at;
    return node;
  };

  // ---- 1a. T-junctions: a pipe end that stops on the side of another pipe (laterals meeting a main) joins it there
  let tees = 0;
  const degree = () => { const d = new Array(nodes.length).fill(0); for (const q of raw) { d[q.a]++; d[q.b]++; } return d; };
  for (const [k, deg] of degree().entries()) {
    if (deg !== 1 || nodes[k].edge) continue;
    const best = nearestPipe(nodes[k].p, k);
    if (best && best.d * dx <= 2) {
      const q = raw[best.qi], at = best.at;
      if (at < 1.5 || q.L - at < 1.5) continue; // already at that pipe's end: the snapping tolerance handles it
      splitAt(best, 0, k); tees++;
    }
  }

  // ---- 1b. real inlets join the nearest pipe (split mid-pipe; reuse an end within 10 m)
  const realInlets = o.realInlets?.length > 0;
  let unconnected = 0;
  if (realInlets) {
    for (const g of o.realInlets) {
      const p = toCells(fine, [[g.lon, g.lat]])[0]; if (p[0] < 0 || p[1] < 0 || p[0] >= W || p[1] >= H) continue;
      p.open = g.open ?? 1; // share of the grate not blocked by debris
      p.crest = g.crest ?? null; // its opening above the street (null: the area's setting)
      p.hyd = g.hyd ?? null; // its own opening, weir length and coefficients (its kind of inlet; null: the area's setting)
      const best = nearestPipe(p);
      if (!best || best.d * dx > 30) { unconnected++; continue; }
      nodes[splitAt(best, 10)].grates.push(p);
    }
  }

  // ground at each manhole: lowest open DEM cell within 2 m
  const lowest = (p, r) => {
    const ci = Math.floor(p[0]), cj = Math.floor(p[1]); let best = Infinity, bk = -1;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue; const k = j * W + i;
      if (!f.bld[k] && f.z[k] < best) { best = f.z[k]; bk = k; }
    }
    return bk >= 0 ? bk : Math.min(H - 1, Math.max(0, cj)) * W + Math.min(W - 1, Math.max(0, ci));
  };
  for (const n of nodes) { n.gutter = lowest(n.p, Math.max(1, Math.round(2 / dx))); n.ground = f.z[n.gutter]; n.inletFine = n.grates.map(g => lowest(g, Math.max(1, Math.round(1 / dx)))); n.grateOpen = n.grates.map(g => g.open ?? 1); n.grateCrest = n.grates.map(g => g.crest ?? null); n.grateHyd = n.grates.map(g => g.hyd ?? null); }

  // ---- 2. inverts from the layer, if plausible (try metres, then feet)
  let invUnits = null;
  const withInv = raw.filter(q => Number.isFinite(q.r.upInv) && Number.isFinite(q.r.dnInv) && q.r.upInv !== 0 && q.r.dnInv !== 0);
  if (withInv.length >= Math.max(3, 0.3 * raw.length)) {
    let best = 0;
    for (const [name, u] of [['m', 1], ['ft', 0.3048]]) {
      const ok = withInv.filter(q => { const c1 = nodes[q.a].ground - q.r.upInv * u, c2 = nodes[q.b].ground - q.r.dnInv * u; return c1 > 0.2 && c1 < 15 && c2 > 0.2 && c2 < 15; }).length / withInv.length;
      if (ok > best) { best = ok; invUnits = ok > 0.6 ? { name, u } : null; }
    }
  }

  // ---- 3. direction: from the layer's inverts when it has them; otherwise the whole network is oriented toward its exits
  //          (Dijkstra from boundary nodes, uphill runs cost extra) so neighbouring pipes agree; a part with no exit in
  //          the area drains to its lowest manhole. Per-pipe ground slope alone leaves sinks on flat streets.
  const adjN = nodes.map(() => []);
  raw.forEach((q, qi) => { adjN[q.a].push([q.b, qi]); adjN[q.b].push([q.a, qi]); });
  const dist = new Float64Array(nodes.length).fill(Infinity), seen = new Uint8Array(nodes.length);
  const flood = (sources) => { // simple O(n²) Dijkstra: networks here are a few hundred manholes
    for (const s0 of sources) dist[s0] = 0;
    for (;;) {
      let v = -1; for (let i = 0; i < nodes.length; i++) if (!seen[i] && dist[i] < Infinity && (v < 0 || dist[i] < dist[v])) v = i;
      if (v < 0) break; seen[v] = 1;
      for (const [u, qi] of adjN[v]) { const rise = Math.max(0, nodes[v].ground - nodes[u].ground), c = dist[v] + raw[qi].L + 20 * rise; if (c < dist[u]) dist[u] = c; }
    }
  };
  flood(nodes.map((n, i) => (n.edge || userOut.has(i) ? i : -1)).filter(i => i >= 0));
  for (;;) { // components with no exit: start from their lowest manhole
    let low = -1; nodes.forEach((n, i) => { if (dist[i] === Infinity && adjN[i].length && (low < 0 || n.ground < nodes[low].ground)) low = i; });
    if (low < 0) break; flood([low]);
  }
  // ---- 4. sizes
  const sized = raw.filter(q => q.r.h > 0).map(q => q.r.h).sort((a, b) => a - b), median = sized.length ? sized[sized.length >> 1] : 0.45;
  // each end on its own: an invert is used when it lies 0.2–30 m under the manhole's ground (deep trunks included); one
  // missing or implausible end is carried from the other at the pipe's ground slope (≥ minSlope). A missing invert is
  // null, never 0: null × u is 0 m, which once put pipe ends 40–65 m under Portland's streets and blew SWMM's books up
  const invAt = (v, i, minCover = 0.2) => { if (!invUnits || v == null || !Number.isFinite(v) || v === 0) return null; const z = v * invUnits.u, c = nodes[i].ground - z; return c > minCover && c < 30 ? z : null; };
  let invPartial = 0, invRejected = 0, invBridged = 0;
  const ends = raw.map(q => [invAt(q.r.upInv, q.a), invAt(q.r.dnInv, q.b)]);
  // a culvert in two lengths: a manhole no pipe gives an invert for, between two pipes that run out to placed endwalls or
  // flared ends. Its invert lies on the straight run between the endwalls' inverts, which stand even with under 20 cm of
  // cover (an endwall sits in the creek, its invert at the bed or over a scour hole). The ground slope would put it near
  // the road (Sheffield Dr, Charlotte: an 8 × 28 ft arch that then carried nothing). Every other pipe is read as before.
  const open = nodes.map(() => []), known = new Uint8Array(nodes.length);
  raw.forEach((q, k) => { [q.a, q.b].forEach((n, e) => { if (ends[k][e] != null) known[n] = 1; else open[n].push([k, e]); }); });
  open.forEach((list, i) => {
    if (known[i] || list.length < 2) return;
    const walls = list.map(([k, e]) => { const q = raw[k], n = e === 0 ? q.b : q.a; return { k, e, z: userOut.has(n) ? invAt(e === 0 ? q.r.dnInv : q.r.upInv, n, -0.3) : null }; })
      .filter(w => w.z != null).sort((x, y) => (raw[y.k].r.h || 0) - (raw[x.k].r.h || 0));
    if (walls.length < 2) return;
    const [A, B] = walls; ends[A.k][1 - A.e] = A.z; ends[B.k][1 - B.e] = B.z;
    const z = A.z + (B.z - A.z) * raw[A.k].L / (raw[A.k].L + raw[B.k].L);
    for (const [k, e] of list) ends[k][e] = z;
    invBridged++;
  });
  raw.forEach((q, k) => {
    let [up, dn] = ends[k];
    if (invUnits && (Number.isFinite(q.r.upInv) && q.r.upInv && invAt(q.r.upInv, q.a) == null || Number.isFinite(q.r.dnInv) && q.r.dnInv && invAt(q.r.dnInv, q.b) == null)) invRejected++;
    if ((up == null) !== (dn == null)) {
      const S = Math.max(o.minSlope, Math.abs(nodes[q.a].ground - nodes[q.b].ground) / q.L);
      if (up == null) up = dn + S * q.L; else dn = up - S * q.L;
      invPartial++;
    }
    const flip = up != null ? dn > up : dist[q.b] > dist[q.a] || (dist[q.b] === dist[q.a] && nodes[q.b].ground > nodes[q.a].ground);
    if (flip) { [q.a, q.b] = [q.b, q.a]; [up, dn] = [dn, up]; }
    Object.assign(q, { D: q.r.h, Wd: q.r.w, shape: q.r.shape, barrels: q.r.barrels, invUp: up, invDn: dn, given: up != null, reversed: flip && up != null });
  });
  const into = nodes.map(() => []), outOf = nodes.map(() => []);
  raw.forEach((q, k) => { into[q.b].push(k); outOf[q.a].push(k); });

  // ---- 3a. a false dead end: a main arrives in the direction it was drawn, no outfall is here, and the pipe drawn onward
  //          was turned round by rising inverts. Those inverts are the error (often a placeholder hump): turn it back and
  //          look again, since the dead end moves one pipe downstream. A run where nothing arrives as drawn may really end
  //          here, so it is left alone.
  const restored = [];
  for (let moved = true; moved;) {
    moved = false;
    for (let i = 0; i < nodes.length; i++) {
      if (!into[i].length || outOf[i].length || nodes[i].edge || userOut.has(i) || !into[i].some(k => !raw[k].reversed)) continue;
      const back = into[i].filter(k => raw[k].reversed).sort((a, b) => (raw[b].r.h || 0) - (raw[a].r.h || 0))[0];
      if (back === undefined) continue;
      const q = raw[back];
      into[i].splice(into[i].indexOf(back), 1); outOf[q.a].splice(outOf[q.a].indexOf(back), 1);
      [q.a, q.b] = [q.b, q.a]; [q.invUp, q.invDn] = [q.invDn, q.invUp]; q.reversed = false;
      into[q.b].push(back); outOf[q.a].push(back);
      restored.push(back); moved = true;
    }
  }
  // the hump: a top end far below the main arriving there is the bad one; otherwise the bottom end is, and it comes down
  // to the top end, carrying on downstream only as far as later pipes stand above it
  for (const k of restored) {
    const q = raw[k], fall = o.minSlope * q.L;
    if (q.invDn <= q.invUp - fall) continue; // already repaired from upstream
    const arrive = Math.min(...into[q.a].filter(j => j !== k && raw[j].given).map(j => raw[j].invDn), Infinity);
    if (arrive < Infinity && arrive - q.invUp > 0.3 && arrive > q.invDn + fall) { q.invUp = arrive; continue; }
    q.invDn = q.invUp - fall;
    const done = new Set([k]), stack = [[q.b, q.invDn]];
    while (stack.length) {
      const [i, z] = stack.pop();
      for (const j of outOf[i]) {
        const r = raw[j]; if (done.has(j) || !r.given || r.invUp <= z) continue;
        done.add(j); r.invUp = z;
        if (r.invDn > z - o.minSlope * r.L) { r.invDn = z - o.minSlope * r.L; stack.push([r.b, r.invDn]); }
      }
    }
  }
  let filled = 0;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (const q of raw) if (!(q.D > 0)) {
      const near = [...into[q.a], ...outOf[q.b]].map(k => raw[k].D).filter(v => v > 0);
      if (near.length) { q.D = Math.max(...into[q.a].map(k => raw[k].D).filter(v => v > 0), Math.min(...near)); q.fill = true; changed = true; }
    }
    if (!changed) break;
  }
  for (const q of raw) if (!(q.D > 0)) { q.D = median; q.fill = true; }
  filled = raw.filter(q => q.fill).length;
  for (const q of raw) if (q.shape === 'RECT_CLOSED' && !(q.Wd > 0)) q.Wd = q.D;

  // derived inverts where missing, then make sure nothing rises at a manhole (bounded passes: networks can loop)
  for (const q of raw) if (!q.given) {
    const S = Math.max(o.minSlope, (nodes[q.a].ground - nodes[q.b].ground) / q.L);
    q.invUp = nodes[q.a].ground - o.cover - q.D; q.invDn = q.invUp - S * q.L;
  }
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    for (const q of raw) {
      if (q.given) continue;
      const cap = Math.min(...into[q.a].map(k => raw[k].invDn), Infinity);
      if (q.invUp > cap + 1e-9) { const drop = q.invUp - cap; q.invUp -= drop; q.invDn -= drop; changed = true; }
      if (q.invDn > q.invUp - o.minSlope * q.L + 1e-9) { q.invDn = q.invUp - o.minSlope * q.L; changed = true; }
    }
    if (!changed) break;
  }

  // ---- culvert entrances: a pipe that starts at a placed endwall or flared end with no grate takes surface water through
  //      its barrels, from the lowest ground within 5 m (inlet control: weir 1.64 SI, orifice 0.6, FHWA HDS-5 headwall range)
  let entrances = 0;
  if (realInlets) nodes.forEach((n, i) => {
    if (into[i].length || !outOf[i].length || n.edge || !userOut.has(i) || n.grates.length) return;
    const q = outOf[i].map(k => raw[k]).sort((a, b) => b.D - a.D)[0], rect = q.shape === 'RECT_CLOSED', b = q.barrels > 1 ? q.barrels : 1, wide = rect ? q.Wd : q.D;
    n.inletFine = [lowest(n.p, Math.max(1, Math.round(5 / dx)))]; n.grateOpen = [1]; n.grateCrest = [0];
    n.grateHyd = [{ inletArea: b * (rect ? wide * q.D : Math.PI / 4 * q.D * q.D), inletPerim: b * wide, Cw: 0.37, Co: 0.6 }];
    entrances++;
  });

  // ---- outfalls: every manhole with no pipe leaving it (boundary ends continue off-site, interior ends are free)
  const outNodes = nodes.map((n, i) => {
    const sink = into[i].length > 0 && outOf[i].length === 0;
    const inv = Math.min(...[...into[i].map(k => raw[k].invDn), ...outOf[i].map(k => raw[k].invUp)]);
    return { name: (sink ? 'O' : 'J') + i, p: n.p, ground: n.ground, invert: inv, depth: Math.max(0.5, n.ground - inv), outfall: sink,
      toStream: false, realOutfall: sink && !n.edge, placed: sink && userOut.has(i), openEnd: sink && !n.edge && !userOut.has(i) && !o.combined, inletFine: sink ? [] : n.inletFine, grateOpen: sink ? [] : n.grateOpen, grateCrest: sink ? [] : n.grateCrest, grateHyd: sink ? [] : n.grateHyd, gutter: n.gutter, fineCell: n.gutter, area: 0, CA: 0, edge: n.edge };
  });
  const outPipes = raw.map((q, k) => ({ name: 'C' + k, from: q.a, to: q.b, L: Math.max(1, q.L), D: q.D, W: q.shape === 'RECT_CLOSED' ? q.Wd : 0, shape: q.shape,
    barrels: q.barrels, n: q.r.n, Q: 0, S: Math.max(1e-4, (q.invUp - q.invDn) / q.L), inOffset: q.invUp - outNodes[q.a].invert, outOffset: q.invDn - outNodes[q.b].invert,
    area: 0, real: true, filledSize: !!q.fill, givenInverts: q.given }));
  const interiorEnds = outNodes.filter(n => n.outfall && !n.edge).length;
  addOutlets(outNodes, outPipes, o, dx);

  // ---- 5. exchange points (grates were attached in 1b; without inlet data, one grate per manhole at the gutter)
  if (!realInlets) for (const n of outNodes) if (!n.outfall) n.inletFine = [n.gutter];
  const inlets = exchangePoints(outNodes, W, sim, realInlets);

  return {
    nodes: outNodes, pipes: outPipes, inlets, opts: o, designIntensity10: 0, tier: 1,
    stats: { junctions: outNodes.filter(n => !n.outfall).length, outfalls: outNodes.filter(n => n.outfall).length, pipes: outPipes.length,
      inlets: inlets.filter(g => g.grates > 0).length, grates: inlets.reduce((s, g) => s + g.grates, 0), lids: inlets.filter(g => !g.grates).length,
      realInlets, unconnectedGrates: unconnected, realOutfalls: 0, offsiteOutlets: outNodes.filter(n => n.offsite).length,
      realPipes: raw.length, tees, filledSizes: filled, inverts: invUnits ? `from layer (${invUnits.name})` : 'derived from lidar', invPartial, invRejected, invBridged, interiorEnds, placedOutfalls: outNodes.filter(n => n.placed).length, openEnds: outNodes.filter(n => n.openEnd).length, restoredPipes: restored.length, culvertEntrances: entrances,
      pipeLength: outPipes.filter(q => !q.offsite).reduce((s, q) => s + q.L, 0), minD: Math.min(...outPipes.map(q => q.D)), maxD: Math.max(...outPipes.map(q => q.D)), served: 0 },
  };
}
