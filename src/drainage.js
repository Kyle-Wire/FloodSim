// Stormwater drainage: synthetic street-following pipe network (data tier 2), SWMM .inp writer, inlet exchange
// hydraulics, and the lumped drainage rate (tier 3). Units: metres, seconds, m³/s.
//
// Tier 2 network, when no utility GIS exists:
//   1. Street graph from OSM (residential and up; alleys and parking aisles excluded), clipped to the domain.
//   2. Manholes with inlets at intersections, dead ends, the domain edge, and every `spacing` m along streets.
//      Ground = gutter low point (lowest open DEM cell within 3 m), the inlet sits on that cell.
//   3. Outfalls at nodes near mapped streams, and where streets leave the domain (the network continues off-site).
//   4. Tree: multi-source Dijkstra from the outfalls, penalising pipes that would run against the ground slope.
//   5. Rational method sizing, Q = C·i(tc)·A: drainage areas by nearest inlet, C from imperviousness, i from the site's
//      Atlas 14 design storm at the time of concentration; Manning full-flow diameter rounded up to standard sizes,
//      never shrinking downstream. Inverts keep `cover` m over the crown and at least 0.5 % slope.
import { toCells } from './ingest.js';
import { IMPERVIOUS } from './terrain.js';
import { dwfAbove, rotated } from './cso.js';
import { ddf } from './storm.js';

const SIZES = [0.3, 0.375, 0.45, 0.525, 0.6, 0.675, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0];
const NETWORK_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const G = 9.81;

export const DESIGN_DEFAULTS = {
  spacing: 60,          // m between inlets along a street
  cover: 1.2,           // m of cover over the pipe crown
  minSlope: 0.005,
  n: 0.013,             // concrete pipe
  designARI: 10,        // yr; typical US storm sewer design storm
  inletTime: 10,        // min, overland time to the first inlet
  pipeVel: 1.0,         // m/s, travel-time estimate for tc
  fallbackIntensity: 100, // mm/hr when Atlas 14 is unavailable
  inletArea: 0.2,       // m², one grate opening (≈ 0.6 × 0.35 m clear)
  inletPerim: 2.0,      // m, weir length of one grate
  Cw: 0.5, Co: 0.6,     // weir and orifice coefficients
  continuation: 100,    // m of off-site pipe beyond each boundary outlet (stands in for the downstream sewer)
  grateMerge: 12,       // m: real grates closer than this along a street share a manhole
  surDepth: 0,          // open manholes when the coupler takes water in only: a full node overflows (SWMM 'flooding') and the
                        // coupler returns that volume to the street. With two-way exchange (the app default) toINP's
                        // `pressurise` seals inlet manholes instead and water comes back through the inlet on the head
                        // difference. An uncapped return orifice once turned surcharge pressure into phantom water; the
                        // coupler now caps each manhole's return at what its pipes deliver.
};

/**
 * @param fine   GridRef of the DEM grid
 * @param f      fine layers {z, bld, road, cls}
 * @param osm    {roads, waterways}
 * @param pf     Atlas 14 table (or null)
 * @param sim    {nx, ny, F, mask, z} solver grid (for inlet cells)
 */
export function synthNetwork(fine, f, osm, pf, sim, opts = {}) {
  const o = { ...DESIGN_DEFAULTS, ...opts }, dx = fine.dx, W = fine.nx, H = fine.ny;
  const inside = (p) => p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H;

  // ---- 1. street graph (vertex key = exact OSM coordinate, so shared vertices join ways)
  const vid = new Map(), V = [], adj = [];
  const vertex = (ll, p) => { const k = ll[0] + ',' + ll[1]; let i = vid.get(k); if (i === undefined) { i = V.length; vid.set(k, i); V.push({ p, out: false }); adj.push(new Map()); } return i; };
  // segments are clipped to the area; where a street crosses the boundary, the crossing point becomes an edge vertex
  // (a long segment with both ends outside still drains the strip it crosses)
  const clipVertex = (p) => { const k = 'clip:' + p[0].toFixed(3) + ',' + p[1].toFixed(3); let i = vid.get(k); if (i === undefined) { i = V.length; vid.set(k, i); V.push({ p, edge: true }); adj.push(new Map()); } return i; };
  const eps = 1e-6;
  for (const r of osm.roads) {
    if (!NETWORK_ROADS.has(r.kind)) continue;
    const pts = toCells(fine, r.line);
    for (let s = 0; s + 1 < pts.length; s++) {
      const a = pts[s], b = pts[s + 1], d = [b[0] - a[0], b[1] - a[1]];
      let t0 = 0, t1 = 1; // Liang–Barsky against [0, W−eps] × [0, H−eps]
      for (const [p, q] of [[-d[0], a[0]], [d[0], W - eps - a[0]], [-d[1], a[1]], [d[1], H - eps - a[1]]]) {
        if (p === 0) { if (q < 0) { t0 = 2; break; } continue; }
        const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      }
      if (t0 >= t1) continue;
      const at = (t) => [a[0] + t * d[0], a[1] + t * d[1]];
      const u = t0 > 0 ? clipVertex(at(t0)) : vertex(r.line[s], a), v = t1 < 1 ? clipVertex(at(t1)) : vertex(r.line[s + 1], b);
      const L = Math.hypot(d[0], d[1]) * (t1 - t0) * dx;
      if (L > 0 && u !== v) { adj[u].set(v, L); adj[v].set(u, L); }
    }
  }

  // ---- 1b. real inlets (utility GIS): snap each grate to its street; grates within `grateMerge` m along a street share one
  //          manhole (each keeps its own exchange cell), which keeps conduits long enough for stable dynamic-wave routing;
  //          grates more than 25 m from a modelled street get a lateral to the nearest manhole (≤ 60 m)
  const real = o.realInlets?.length > 0;
  let unconnected = 0;
  if (real) {
    const BK = 25 / dx, buckets = new Map(), bkey = (i, j) => i + ',' + j, edges = [];
    for (let u = 0; u < V.length; u++) for (const [v] of adj[u]) if (u < v) edges.push([u, v]);
    edges.forEach(([u, v], ei) => {
      const a = V[u].p, b = V[v].p;
      for (let j = Math.floor(Math.min(a[1], b[1]) / BK); j <= Math.floor(Math.max(a[1], b[1]) / BK); j++)
        for (let i = Math.floor(Math.min(a[0], b[0]) / BK); i <= Math.floor(Math.max(a[0], b[0]) / BK); i++) { const k = bkey(i, j); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(ei); }
    });
    const perEdge = new Map(), off = [];
    for (const g of o.realInlets) {
      const p = toCells(fine, [[g.lon, g.lat]])[0]; if (!inside(p)) continue;
      p.open = g.open ?? 1; // share of the grate not blocked by debris
      let best = null; const bi = Math.floor(p[0] / BK), bj = Math.floor(p[1] / BK);
      for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++) for (const ei of buckets.get(bkey(i, j)) || []) {
        const [u, v] = edges[ei], a = V[u].p, b = V[v].p, ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)), d = Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey);
        if (!best || d < best.d) best = { ei, t, d };
      }
      if (best && best.d * dx <= 25) { if (!perEdge.has(best.ei)) perEdge.set(best.ei, []); perEdge.get(best.ei).push({ t: best.t, g: p }); }
      else off.push(p);
    }
    const newVertex = (p, grates) => { V.push({ p, grates }); adj.push(new Map()); return V.length - 1; };
    const link = (a, b) => { const L = Math.hypot(V[a].p[0] - V[b].p[0], V[a].p[1] - V[b].p[1]) * dx; if (a !== b && L > 0) { adj[a].set(b, L); adj[b].set(a, L); } };
    for (const [ei, list] of perEdge) {
      const [u, v] = edges[ei], a = V[u].p, b = V[v].p, Lm = Math.hypot(b[0] - a[0], b[1] - a[1]) * dx;
      list.sort((x, y) => x.t - y.t);
      adj[u].delete(v); adj[v].delete(u);
      let prev = u, group = null;
      const flush = () => {
        if (!group) return;
        const t = group.t / group.n;
        if (t * Lm < o.grateMerge) (V[u].grates ??= []).push(...group.g);
        else if ((1 - t) * Lm < o.grateMerge) (V[v].grates ??= []).push(...group.g);
        else { const w = newVertex([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], group.g); link(prev, w); prev = w; }
        group = null;
      };
      for (const it of list) {
        if (group && (it.t - group.t0) * Lm > o.grateMerge) flush();
        if (!group) group = { t0: it.t, t: 0, n: 0, g: [] };
        group.t += it.t; group.n++; group.g.push(it.g);
      }
      flush(); link(prev, v);
    }
    for (const p of off) {
      let bv = -1, bd = Infinity;
      for (let i = 0; i < V.length; i++) if (adj[i].size) { const d = Math.hypot(V[i].p[0] - p[0], V[i].p[1] - p[1]); if (d < bd) { bd = d; bv = i; } }
      if (bv >= 0 && bd * dx <= 60) link(newVertex(p, [p]), bv); else unconnected++;
    }
  }

  // ---- 2. manholes: junctions, ends, edges, inlets, and every `spacing` m along chains (100 m when inlets are real)
  const spacing = real ? Math.max(100, o.spacing) : o.spacing;
  const isKey = V.map((v, i) => adj[i].size > 0 && (adj[i].size !== 2 || v.edge || v.grates?.length > 0));
  const nodes = [], nodeOf = new Map(), pipesRaw = [];
  const addNode = (i) => { if (!nodeOf.has(i)) { nodeOf.set(i, nodes.length); nodes.push({ v: i, p: V[i].p, edge: !!V[i].edge, grates: V[i].grates || [] }); } return nodeOf.get(i); };
  const seen = new Set();
  for (let s = 0; s < V.length; s++) {
    if (!isKey[s]) continue;
    for (const [n1] of adj[s]) {
      const ek = s < n1 ? s + ':' + n1 : n1 + ':' + s; if (seen.has(ek)) continue;
      // walk the chain s → n1 → … until the next key vertex
      let prev = s, cur = n1, acc = adj[s].get(n1), from = s; seen.add(ek);
      while (true) {
        if (isKey[cur] || acc >= spacing) {
          pipesRaw.push([addNode(from), addNode(cur), acc]);
          if (isKey[cur]) break;
          from = cur; acc = 0;
        }
        let next = -1; for (const [nb] of adj[cur]) if (nb !== prev) { next = nb; break; }
        if (next < 0 || (next === s && acc === 0)) break;
        const k2 = cur < next ? cur + ':' + next : next + ':' + cur; if (seen.has(k2)) break; seen.add(k2);
        acc += adj[cur].get(next); prev = cur; cur = next;
      }
    }
  }
  if (!nodes.length) return null;

  // ground and grate cells. Synthetic: one grate at the gutter low point within 3 m. Real: each grate at the lowest
  // open DEM cell within 1 m of its surveyed position (lidar and GIS both carry ~1 m error); ground = lowest grate.
  const lowest = (p, r) => {
    const ci = Math.floor(p[0]), cj = Math.floor(p[1]); let best = Infinity, bk = -1;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue; const k = j * W + i;
      if (!f.bld[k] && f.z[k] < best) { best = f.z[k]; bk = k; }
    }
    if (bk < 0) bk = Math.min(H - 1, Math.max(0, cj)) * W + Math.min(W - 1, Math.max(0, ci));
    return bk;
  };
  for (const n of nodes) {
    const gutter = lowest(n.p, 3);
    n.inletFine = real ? n.grates.map(g => lowest(g, Math.max(1, Math.round(1 / dx)))) : [gutter];
    n.grateOpen = real ? n.grates.map(g => g.open ?? 1) : [1];
    n.fineCell = n.inletFine[0] ?? gutter; n.gutter = gutter;
    n.ground = n.inletFine.length ? Math.min(...n.inletFine.map(k => f.z[k])) : f.z[gutter];
  }

  // ---- 3. outfalls: near a stream, or where a street leaves the domain
  const streams = (osm.waterways || []).filter(w => /stream|river|canal|drain|ditch/.test(w.kind)).map(w => toCells(fine, w.line));
  const nearStream = (p) => streams.some(line => { for (let s = 0; s + 1 < line.length; s++) if (segDist(p, line[s], line[s + 1]) * dx < 30) return true; return false; });
  const nadj = nodes.map(() => []);
  for (const [a, b, L] of pipesRaw) if (a !== b) { nadj[a].push([b, L]); nadj[b].push([a, L]); }
  const realOut = (o.realOutfalls || []).map(q => toCells(fine, [[q.lon, q.lat]])[0]);
  for (const n of nodes) {
    n.stream = nearStream(n.p); n.realOutfall = realOut.some(q => Math.hypot(q[0] - n.p[0], q[1] - n.p[1]) * dx < 50);
    n.outfall = n.edge || n.stream || n.realOutfall;
  }

  // ---- 4. drainage tree (Dijkstra from all outfalls; uphill runs cost extra)
  const dist = new Float64Array(nodes.length).fill(Infinity), parent = new Int32Array(nodes.length).fill(-1), plen = new Float64Array(nodes.length);
  const heap = new MinHeap();
  nodes.forEach((n, i) => { if (n.outfall) { dist[i] = 0; heap.push(0, i); } });
  while (heap.size) {
    const [d, v] = heap.pop(); if (d > dist[v]) continue;
    for (const [u, L] of nadj[v]) { // water would flow u → v
      const rise = Math.max(0, nodes[v].ground - nodes[u].ground), c = d + L * (1 + 20 * rise / L);
      if (c < dist[u]) { dist[u] = c; parent[u] = v; plen[u] = L; heap.push(c, u); }
    }
  }
  const drained = nodes.map((_, i) => dist[i] < Infinity);

  // ---- 5. drainage areas, rational method, sizing, inverts
  const area = new Float64Array(nodes.length), CA = new Float64Array(nodes.length);
  catchments(fine, f, nodes, drained, area, CA, 150);
  const order = nodes.map((_, i) => i).filter(i => drained[i]).sort((a, b) => dist[b] - dist[a]); // upstream first
  const accCA = Float64Array.from(CA), accA = Float64Array.from(area), tc = new Float64Array(nodes.length).fill(o.inletTime);
  const kids = nodes.map(() => []); for (const i of order) if (parent[i] >= 0) kids[parent[i]].push(i);
  const pipes = [];
  const pipeOf = new Int32Array(nodes.length).fill(-1);
  const intensity = (tMin) => pf ? ddf(pf, o.designARI, tMin) / tMin * 60 : o.fallbackIntensity;
  for (const i of order) {
    for (const k of kids[i]) { accCA[i] += accCA[k]; accA[i] += accA[k]; tc[i] = Math.max(tc[i], tc[k] + plen[k] / o.pipeVel / 60); }
    const p = parent[i]; if (p < 0) continue;
    const L = plen[i], S = Math.max(o.minSlope, (nodes[i].ground - nodes[p].ground) / L);
    const Q = accCA[i] * intensity(tc[i]) / 3.6e6;
    let D = Math.pow(Q * o.n / (0.3117 * Math.sqrt(S)), 3 / 8);
    D = SIZES.find(s => s >= D) ?? SIZES[SIZES.length - 1];
    for (const k of kids[i]) if (pipeOf[k] >= 0) D = Math.max(D, pipes[pipeOf[k]].D);
    let invUp = nodes[i].ground - o.cover - D;
    for (const k of kids[i]) if (pipeOf[k] >= 0) invUp = Math.min(invUp, pipes[pipeOf[k]].invDown);
    pipeOf[i] = pipes.length;
    pipes.push({ from: i, to: p, L, S, D, Q, invUp, invDown: invUp - S * L, tc: tc[i], area: accA[i] });
  }
  // node inverts = lowest connected invert; offsets from there
  for (const n of nodes) n.invert = Infinity;
  for (const q of pipes) { nodes[q.from].invert = Math.min(nodes[q.from].invert, q.invUp); nodes[q.to].invert = Math.min(nodes[q.to].invert, q.invDown); }
  const used = new Set(); for (const q of pipes) { used.add(q.from); used.add(q.to); }
  const keep = [...used].sort((a, b) => a - b), remap = new Map(keep.map((v, i) => [v, i]));
  const outNodes = keep.map((i) => {
    const n = nodes[i], isOut = parent[i] < 0;
    return { name: (isOut ? 'O' : 'J') + i, p: n.p, ground: n.ground, invert: n.invert, depth: Math.max(0.5, n.ground - n.invert), outfall: isOut, toStream: isOut && n.stream,
      realOutfall: isOut && n.realOutfall, inletFine: isOut ? [] : n.inletFine, gutter: n.gutter, fineCell: n.fineCell, area: area[i], CA: CA[i] };
  });
  const outPipes = pipes.map((q, k) => ({ name: 'C' + k, from: remap.get(q.from), to: remap.get(q.to), L: Math.max(1, q.L), D: q.D, Q: q.Q, S: q.S,
    inOffset: q.invUp - nodes[q.from].invert, outOffset: q.invDown - nodes[q.to].invert, area: q.area }));

  addOutlets(outNodes, outPipes, o, dx);
  const inlets = exchangePoints(outNodes, W, sim, real);

  let streetLen = 0, drainedLen = 0;
  for (const [a, b, L] of pipesRaw) { streetLen += L; if (drained[a] && drained[b]) drainedLen += L; }
  return {
    nodes: outNodes, pipes: outPipes, inlets, opts: o, designIntensity10: intensity(o.inletTime),
    stats: { junctions: outNodes.filter(n => !n.outfall).length, outfalls: outNodes.filter(n => n.outfall).length, pipes: outPipes.length,
      inlets: inlets.filter(g => g.grates > 0).length, grates: inlets.reduce((s, g) => s + g.grates, 0), lids: inlets.filter(g => !g.grates).length, realInlets: real, unconnectedGrates: unconnected,
      realOutfalls: outNodes.filter(n => n.realOutfall).length, offsiteOutlets: outNodes.filter(n => n.offsite).length,
      pipeLength: outPipes.filter(q => !q.offsite).reduce((s, q) => s + q.L, 0), streetLength: streetLen, drainedFraction: streetLen ? drainedLen / streetLen : 0,
      minD: Math.min(...outPipes.map(q => q.D)), maxD: Math.max(...outPipes.map(q => q.D)), served: outNodes.reduce((s, n) => s + n.area, 0) },
  };
}

/**
 * Outlets (shared by the synthetic and the linked-pipe builders).
 * Outlets. Where pipes leave the area the sewer continues off-site: model that as a 100 m continuation pipe (largest
 * incoming size, mean incoming slope) to a normal-depth outlet, so downstream capacity and backwater are felt, instead of
 * a free outfall that swallows any flow. Stream / real outfalls keep their own outlet (and the observed stage, if any);
 * SWMM allows one link per outfall, so several pipes meeting there get a junction and a short outlet pipe.
 * draw the continuation heading outward along the incoming pipes
 */
export function addOutlets(outNodes, outPipes, o, dx) {
  const nIn = new Map(); outPipes.forEach(q => nIn.set(q.to, (nIn.get(q.to) || 0) + 1));
  for (const [k, cnt] of [...nIn]) {
    const node = outNodes[k]; if (!node.outfall) continue;
    const boundary = !node.toStream && !node.realOutfall;
    if (!boundary && cnt < 2) continue;
    const ins = outPipes.filter(q => q.to === k), Q = ins.reduce((s, q) => s + q.Q, 0);
    const L = boundary ? o.continuation : 10;
    const S = boundary ? Math.max(o.minSlope, ins.reduce((s, q) => s + q.S, 0) / ins.length) : o.minSlope;
    let D = Math.pow(Q * o.n / (0.3117 * Math.sqrt(S)), 3 / 8);
    D = Math.max(Math.max(...ins.map(q => q.D)), boundary ? 0 : SIZES.find(s => s >= D) ?? SIZES[SIZES.length - 1]);
    let ux = 0, uy = 0; for (const q of ins) { const a = outNodes[q.from].p; ux += node.p[0] - a[0]; uy += node.p[1] - a[1]; }
    const ul = Math.hypot(ux, uy) || 1, reach = boundary ? L / dx : 0;
    const out = { ...node, name: node.name + 'X', p: [node.p[0] + ux / ul * reach, node.p[1] + uy / ul * reach], invert: node.invert - S * L,
      depth: Math.max(0.5, node.ground - node.invert + S * L), outfallType: boundary ? 'NORMAL' : 'FREE', offsite: boundary };
    Object.assign(node, { name: 'J' + node.name.slice(1), outfall: false, toStream: false, realOutfall: false, inletFine: [] });
    outNodes.push(out);
    outPipes.push({ name: 'C' + outPipes.length, from: k, to: outNodes.length - 1, L, D, Q, S, inOffset: 0, outOffset: 0, offsite: boundary,
      area: ins.reduce((s, q) => s + q.area, 0) });
  }
}

/**
 * GPU exchange points: one per grate, each on its own solver cell (grates sharing a coarse cell merge into one).
 * A manhole without a grate still gets a lid point (0 grates): it takes nothing in, but returns overflow to the street.
 */
export function exchangePoints(outNodes, W, sim, real) {
  const inlets = [], usedCell = new Map();
  outNodes.forEach((n, i) => {
    if (n.outfall) return;
    n.inletCount = 0;
    // each grate counts by its open share (debris); a fully blocked grate exchanges nothing, like a lid
    const pts = n.inletFine.length ? n.inletFine.map((fk, q) => [fk, n.grateOpen?.[q] ?? 1]) : [[n.gutter, 0]];
    for (const [fk, g] of pts) {
      let sc = (((fk / W) | 0) / sim.F | 0) * sim.nx + ((fk % W) / sim.F | 0);
      if (!sim.mask[sc]) sc = openNeighbour(sim, sc); // a grate on a wall cell (coarse grid, footprint overlap) moves to the lowest open neighbour
      if (sc < 0) continue;
      const m = usedCell.get(sc);
      if (m !== undefined && inlets[m].node === i) { inlets[m].grates += g; continue; }
      if (m !== undefined) continue; // another manhole already exchanges here
      usedCell.set(sc, inlets.length); inlets.push({ node: i, cell: sc, fineCell: fk, grates: g, real: real && g > 0 }); n.inletCount++;
    }
  });
  return inlets;
}

/**
 * Outfalls that discharge inside the model: one the outfall layer placed (an endwall or flared end into a creek) or a
 * synthetic one into a mapped stream. Their water goes back on the ground there (src/coupler.js), not out of the model.
 * In a separate storm sewer an interior pipe end the data does not call an outfall returns too (`openEnd`,
 * src/network-real.js). Outfalls on the edge or off the area, such an end in a combined sewer (a gap on the way to the
 * interceptor as often as a discharge), and a CSO interceptor (to the plant) still take their water away.
 * `taken`: solver cells already exchanging (inlets); a return moves to a free open neighbour, else is left out.
 * → [{ cell, at }] one per cell, `at` the outfall's position key (`${x},${y}` in fine cells) so the coupler finds the
 * node after CSO regulators replace it (the overflow outfall keeps its position).
 */
export function outfallCells(nodes, W, sim, taken = new Set()) {
  const out = [], byCell = new Map();
  for (const n of nodes) {
    if (!returnsHere(n)) continue;
    const fk = Math.floor(n.p[1]) * W + Math.floor(n.p[0]);
    let sc = (((fk / W) | 0) / sim.F | 0) * sim.nx + ((fk % W) / sim.F | 0);
    if (!sim.mask[sc] || taken.has(sc)) sc = freeNeighbour(sim, sc, taken);
    if (sc < 0) continue;
    const at = posKey(n);
    if (byCell.has(sc)) { byCell.get(sc).at.push(at); continue; }
    const r = { cell: sc, at: [at] }; byCell.set(sc, r); out.push(r);
  }
  return out;
}
/** An outfall whose water stays in the model (see outfallCells). */
export const returnsHere = (n) => n.outfall && !n.interceptor && !n.offsite && !n.edge && !!(n.placed || n.toStream || n.openEnd);
export const posKey = (n) => `${Math.floor(n.p[0])},${Math.floor(n.p[1])}`;
function freeNeighbour(sim, k, taken) {
  const i0 = k % sim.nx, j0 = (k / sim.nx) | 0; let best = -1;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = i0 + di, j = j0 + dj, kk = j * sim.nx + i;
    if (i < 0 || j < 0 || i >= sim.nx || j >= sim.ny || !sim.mask[kk] || taken.has(kk)) continue;
    if (best < 0 || (sim.z && sim.z[kk] < sim.z[best])) best = kk;
  }
  return best;
}

/** Lowest open solver cell among the 8 neighbours of `k` (any open one when the grid has no elevations), else −1. */
function openNeighbour(sim, k) {
  const i0 = k % sim.nx, j0 = (k / sim.nx) | 0; let best = -1;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = i0 + di, j = j0 + dj, kk = j * sim.nx + i;
    if ((di || dj) && i >= 0 && j >= 0 && i < sim.nx && j < sim.ny && sim.mask[kk] && (best < 0 || (sim.z && sim.z[kk] < sim.z[best]))) best = kk;
  }
  return best;
}

/** Assign 4 m blocks to the nearest drained node (multi-source BFS, max `rmax` m); fills area (m²) and C·A per node. */
function catchments(fine, f, nodes, drained, area, CA, rmax) {
  const B = Math.max(1, Math.round(4 / fine.dx)), bw = Math.ceil(fine.nx / B), bh = Math.ceil(fine.ny / B), N = bw * bh;
  const owner = new Int32Array(N).fill(-1), d = new Float32Array(N).fill(Infinity), q = [];
  nodes.forEach((n, i) => { if (!drained[i]) return; const b = ((n.fineCell / fine.nx | 0) / B | 0) * bw + ((n.fineCell % fine.nx) / B | 0); if (owner[b] < 0) { owner[b] = i; d[b] = 0; q.push(b); } });
  for (let h = 0; h < q.length; h++) {
    const b = q[h], bi = b % bw, bj = (b / bw) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = bi + di, j = bj + dj; if (i < 0 || j < 0 || i >= bw || j >= bh) continue;
      const c = j * bw + i; if (owner[c] >= 0) continue;
      const nd = d[b] + B * fine.dx; if (nd > rmax) continue;
      owner[c] = owner[b]; d[c] = nd; q.push(c);
    }
  }
  const A = fine.dx * fine.dx;
  for (let j = 0; j < fine.ny; j++) for (let i = 0; i < fine.nx; i++) {
    const n = owner[((j / B) | 0) * bw + ((i / B) | 0)]; if (n < 0) continue;
    const k = j * fine.nx + i, imp = f.bld[k] || f.road[k] ? 1 : (IMPERVIOUS[f.cls?.[k]] ?? 0.1);
    area[n] += A; CA[n] += A * (0.95 * imp + 0.2 * (1 - imp));
  }
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
  pop() {
    const k = this.k, v = this.v, top = [k[0], v[0]], lk = k.pop(), lv = v.pop();
    if (k.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= k.length) break; if (c + 1 < k.length && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
    return top;
  }
}

// ------------------------------------------------------------------ SWMM input file

/** SWMM 5 .inp for the network, metric (CMS), dynamic wave. Coordinates in the grid's UTM CRS. */
export function toINP(net, fine, { durationS = 7200, routingStep = 1, surcharge = 'SLOT', title = 'FloodSim synthetic network', pressurise = false } = {}) {
  // pressurise: manholes surcharge above their rims (30 m) instead of spilling; water comes back up through the inlets on
  // the head difference (Coupler twoWay), as HEC-RAS does
  const surDepth = pressurise ? 30 : (net.opts.surDepth ?? 0);
  const pad = (s, n) => String(s).padEnd(n), f3 = (v) => v.toFixed(3);
  const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const days = Math.floor(durationS / 86400), endDate = `01/${String(1 + days).padStart(2, '0')}/2000`;
  const L = [];
  L.push('[TITLE]', title, '', '[OPTIONS]',
    'FLOW_UNITS CMS', 'INFILTRATION HORTON', 'FLOW_ROUTING DYNWAVE', 'LINK_OFFSETS DEPTH', 'ALLOW_PONDING NO', 'SKIP_STEADY_STATE NO',
    'START_DATE 01/01/2000', 'START_TIME 00:00:00', 'REPORT_START_DATE 01/01/2000', 'REPORT_START_TIME 00:00:00',
    `END_DATE ${endDate}`, `END_TIME ${hms(durationS % 86400)}`, 'REPORT_STEP 00:05:00', 'WET_STEP 00:01:00', 'DRY_STEP 00:01:00',
    `ROUTING_STEP ${routingStep}`, 'VARIABLE_STEP 0.75', `LENGTHENING_STEP ${routingStep}`, // SWMM lengthens any conduit too short for the step
    'MIN_SURFAREA 1.2', 'NORMAL_FLOW_LIMITED BOTH',
    'INERTIAL_DAMPING PARTIAL', `SURCHARGE_METHOD ${surcharge}`, 'MIN_SLOPE 0', 'MAX_TRIALS 8', 'HEAD_TOLERANCE 0.0015', 'THREADS 1', '');
  L.push('[JUNCTIONS]', ';;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded');
  for (const n of net.nodes) if (!n.outfall && !n.storageArea) L.push(`${pad(n.name, 16)} ${pad(f3(n.invert), 10)} ${pad(f3(n.depth), 10)} 0          ${pad(surDepth, 10)} 0`);
  if (net.nodes.some(n => n.storageArea)) { // tanks: constant plan area over the manhole depth (FUNCTIONAL A = 0 + 0·d^0 + C)
    L.push('', '[STORAGE]', ';;Name           Elev.      MaxDepth   InitDepth  Shape      Curve/Params                    SurDepth  Fevap');
    for (const n of net.nodes) if (n.storageArea) L.push(`${pad(n.name, 16)} ${pad(f3(n.invert), 10)} ${pad(f3(n.depth), 10)} 0          FUNCTIONAL 0          0          ${pad(f3(n.storageArea), 10)} ${pad(surDepth, 9)} 0`);
  }
  L.push('', '[OUTFALLS]', ';;Name           Elevation  Type       Stage Data       Gated');
  for (const n of net.nodes) if (n.outfall) L.push(`${pad(n.name, 16)} ${pad(f3(n.invert), 10)} ${pad(n.outfallType ?? 'FREE', 10)}                  ${n.gated ? 'YES' : 'NO'}`);
  // combined sewers (src/cso.js): dry-weather flow at the manholes on the local-time pattern, the pipes starting with it
  const dwf = net.dwfOn && net.nodes.some(n => n.dwf > 0), pat = dwf ? rotated(net.dwfStartHour ?? 0) : null, q0 = dwf ? dwfAbove(net).map(v => v * pat[0]) : null;
  const conduits = net.pipes.filter(q => q.kind == null), weirs = net.pipes.filter(q => q.kind === 'weir'), outlets = net.pipes.filter(q => q.kind === 'outlet');
  L.push('', '[CONDUITS]', ';;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow');
  for (const q of conduits) L.push(`${pad(q.name, 16)} ${pad(net.nodes[q.from].name, 16)} ${pad(net.nodes[q.to].name, 16)} ${pad(f3(q.L), 10)} ${pad(q.n ?? net.opts.n, 10)} ${pad(f3(q.inOffset), 10)} ${pad(f3(q.outOffset), 10)} ${pad(q0 ? (+q0[q.from].toPrecision(4)) : 0, 10)} 0`);
  if (weirs.length) { // regulators: the overflow weir and the interceptor outlet's rating (flow up to its capacity)
    L.push('', '[WEIRS]', ';;Name           From Node        To Node          Type         CrestHt    Qcoeff     Gated    EndCon   EndCoeff   Surcharge');
    for (const q of weirs) L.push(`${pad(q.name, 16)} ${pad(net.nodes[q.from].name, 16)} ${pad(net.nodes[q.to].name, 16)} TRANSVERSE   ${pad(f3(q.crest), 10)} 1.84       NO       0        0          YES`);
  }
  if (outlets.length) {
    L.push('', '[OUTLETS]', ';;Name           From Node        To Node          Offset     Type            QTable/Qcoeff    Qexpon     Gated');
    for (const q of outlets) L.push(`${pad(q.name, 16)} ${pad(net.nodes[q.from].name, 16)} ${pad(net.nodes[q.to].name, 16)} 0          TABULAR/DEPTH   ${pad('CRV_' + q.name, 16)}            NO`);
  }
  L.push('', '[XSECTIONS]', ';;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels');
  for (const q of conduits) L.push(`${pad(q.name, 16)} ${pad(q.shape ?? 'CIRCULAR', 12)} ${pad(+q.D.toFixed(3), 16)} ${pad(+(q.W ?? 0).toFixed(3), 10)} 0          0          ${q.barrels ?? 1}`);
  for (const q of weirs) L.push(`${pad(q.name, 16)} RECT_OPEN    ${pad(+q.D.toFixed(3), 16)} ${pad(+q.W.toFixed(3), 10)} 0          0`);
  if (outlets.length) {
    L.push('', '[CURVES]', ';;Name           Type       X-Value    Y-Value');
    for (const q of outlets) q.curve.forEach(([x, y], m) => L.push(`${pad('CRV_' + q.name, 16)} ${m ? '          ' : 'Rating    '} ${pad(f3(x), 10)} ${(+y.toPrecision(5))}`));
  }
  if (dwf) {
    L.push('', '[DWF]', ';;Node           Constituent      Baseline   Patterns');
    for (const n of net.nodes) if (!n.outfall && n.dwf > 0) L.push(`${pad(n.name, 16)} FLOW             ${pad(+n.dwf.toPrecision(5), 10)} DWF_HOURLY`);
    L.push('', '[PATTERNS]', ';;Name           Type       Multipliers');
    for (let h = 0; h < 24; h += 6) L.push(`${pad('DWF_HOURLY', 16)} ${h ? '          ' : 'HOURLY    '} ${pat.slice(h, h + 6).map(v => v.toFixed(4)).join(' ')}`);
  }
  L.push('', '[REPORT]', 'INPUT NO', 'CONTROLS NO', 'SUBCATCHMENTS NONE', 'NODES NONE', 'LINKS NONE', '');
  L.push('[COORDINATES]', ';;Node           X-Coord            Y-Coord');
  for (const n of net.nodes) L.push(`${pad(n.name, 16)} ${(fine.x0 + n.p[0] * fine.dx).toFixed(2)} ${(fine.y1 - n.p[1] * fine.dx).toFixed(2)}`);
  L.push('');
  return L.join('\n');
}

/**
 * Underground storage tanks: `volume` m³ split evenly over the manholes that discharge to an outfall, each becoming a
 * SWMM storage unit with a constant plan area over its depth. Off-line storage of this kind fills when the last pipe
 * runs full, so it cuts surcharge and street flooding upstream. Returns the tanks [{ node, volume }].
 */
export function addTanks(net, volume) {
  for (const n of net.nodes) delete n.storageArea;
  if (!(volume > 0)) return [];
  const ends = [...new Set(net.pipes.filter(p => net.nodes[p.to].outfall && !net.nodes[p.from].outfall).map(p => p.from))];
  return ends.map((i) => { const n = net.nodes[i], v = volume / ends.length; n.storageArea = v / Math.max(0.5, n.depth); return { node: n.name, volume: v }; });
}

// ------------------------------------------------------------------ inlet hydraulics

/**
 * Surface → network flow at one inlet (m³/s). Weir flow for shallow ponding over a free inlet, orifice flow when deep,
 * and a submerged orifice on the head difference when the network backs up above the inlet; zero once the network head
 * reaches the street water level. Water never comes back up through this formula: a surcharged network returns water
 * only as SWMM node overflow, which the coupler integrates per routing step and puts back on the street (both models
 * then book identical volumes; a reverse orifice withdrew water SWMM's near-zero manhole storage did not hold).
 * @param h  surface depth at the inlet cell (m)   @param zs surface (bed) elevation (m)   @param Hn node hydraulic head (m)
 */
export function inletFlow(h, zs, Hn, nInlets, o = DESIGN_DEFAULTS) {
  if (!nInlets) return 0; // manhole lid: no opening (overflow is handled by the coupler)
  const open = 1 - Math.min(0.95, o.clog ?? 0); // debris on the grates (calibration) closes this share of the opening
  const A = o.inletArea * nInlets * open, P = o.inletPerim * nInlets * open, eta = zs + Math.max(0, h);
  if (Hn < zs) { // node below the street: free inflow
    if (h <= 0) return 0;
    const weir = o.Cw * P * Math.pow(h, 1.5) * Math.sqrt(2 * G), orifice = o.Co * A * Math.sqrt(2 * G * h);
    return Math.min(weir, orifice);
  }
  const dH = eta - Hn; // submerged inlet: inflow on the head difference, none once the network is at street level
  return dH > 0 ? o.Co * A * Math.sqrt(2 * G * dH) : 0;
}

// ------------------------------------------------------------------ tier 3

/** Lumped drainage: a capacity in mm/hr over the whole domain, removed from street cells (where water collects). */
export function lumpedInfil(c, fineRoadFrac, mmhr) {
  let roadArea = 0; for (let k = 0; k < c.nx * c.ny; k++) if (c.mask[k]) roadArea += fineRoadFrac[k];
  let total = 0; for (let k = 0; k < c.nx * c.ny; k++) if (c.mask[k]) total += 1;
  const extra = new Float64Array(c.nx * c.ny);
  if (roadArea <= 0) return extra;
  const rate = mmhr / 1000 / 3600 * total / roadArea; // m/s on a fully-street cell
  for (let k = 0; k < extra.length; k++) extra[k] = c.mask[k] ? rate * fineRoadFrac[k] : 0;
  return extra;
}
