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
//  11. (opt-in, `barrelRuns`) barrels: a run of lengths of one section (shape, size, barrels, material) through nodes
//      where only they meet (smaller laterals may join) is graded as a possible single crossing: 'high' with an endwall
//      (a placed outfall or an endwall/FES structure record) at both ends, 'medium' when the source calls it a culvert,
//      'low' with one endwall and a dead end where the other may be missing (reported only). High and medium runs are
//      oriented as a unit: the source's own direction, kept unless the connectivity or the terrain contradicts it and
//      the inverts agree with them; the inverts never decide alone. Between two known endwall floors an interior invert
//      is replaced only when it stands more than `barrelHump` (0.25) of the rise above both endwalls and the node is an
//      inlet (a grate, an inlet structure record, or notes that say it enters the culvert): a connection, kept on the
//      node as `connInv`. An invert that is only high is reported as a possible connection and left as recorded.
//      Every candidate, its grade, the evidence for its direction and each interior node's reading are in `barrels`.
// Every pipe end carries where its invert came from (`prov`: record, interpolated, bridged, carried, repaired, derived),
// and every pipe how its direction was decided.
import { toCells } from './ingest.js';
import { DESIGN_DEFAULTS, addOutlets, exchangePoints } from './drainage.js';
import { legacySection } from './assets.js';
import { swmmSection, entranceOf, openArea, NATIVE_DEFAULTS } from './swmm-xsect.js';

/** Where each value a network pipe carries came from: its ends' inverts, direction, size, shape, material, roughness. */
function pipeProv(q) {
  const a = q.r.asset, ap = a?.prov ?? {}, sec = a ? legacySection(a) : null;
  // invTrust: [upstream, downstream] as the network runs the pipe: whether each recorded invert was used, and why
  return { upInv: q.ps[0], dnInv: q.ps[1], invTrust: q.trust ?? null, direction: q.how, size: q.fill || ap.rise || 'record', shape: ap.shape ?? 'record',
    shapeApprox: sec?.approx ?? null, material: ap.material ?? 'unknown', n: q.r.n != null ? (ap.n ?? 'record') : 'default' };
}

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
        const ev = (e, cut) => (cut ? null : r.asset?.ends?.[e] ?? null), eu = ev('up', cur.startEdge), ed = ev('dn', endEdge);
        if (L * dx > 0.5) raw.push({ r, pts: cur.pts, a: nodeAt(cur.pts[0], cur.startEdge), b: nodeAt(cur.pts[cur.pts.length - 1], endEdge), L: L * dx,
          es: [eu?.structure ?? null, ed?.structure ?? null], res: [eu?.resolved ?? null, ed?.resolved ?? null], cf: [!!eu?.conflict, !!ed?.conflict] });
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
  // pipe heads opened by hand (o.openHeads, [{lon, lat}]): the nearest node within 5 m with a pipe leaving it becomes a
  // culvert entrance like an endwall's, even where smaller pipes also drain into it. Opt-in, one structure at a time.
  const openHeads = new Set();
  for (const q of o.outfalls ?? []) {
    const p = toCells(fine, [[q.lon, q.lat]])[0]; let bk = -1, bd = Infinity;
    nodes.forEach((n, k) => { const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) * dx; if (d < bd) { bd = d; bk = k; } });
    if (bk < 0 || bd > 5) continue;
    if (q.boundary) nodes[bk].edge = true; else userOut.add(bk);
  }
  for (const q of o.openHeads ?? []) {
    const p = toCells(fine, [[q.lon, q.lat]])[0]; let bk = -1, bd = Infinity;
    nodes.forEach((n, k) => { const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) * dx; if (d < bd) { bd = d; bk = k; } });
    if (bk >= 0 && bd <= 5) openHeads.add(bk);
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
  const srcOf = (r) => r.invSrc ?? ['record', 'record'];
  // split pipe best.qi at best.pt (reusing an end within `reuse` m); inverts, if any, interpolate along the length
  const splitAt = (best, reuse, node = null) => {
    const q = raw[best.qi];
    // reuse the nearer end within `reuse` m. (Checking the upstream end first sent an inlet at the downstream end of a
    // pipe shorter than 2 × reuse to the wrong manhole.)
    // `legacyInletReuse` keeps the old order, to reproduce runs made before 10 Nov 2026 (it moves ~10 % of Charlotte's grates)
    const toA = best.at, toB = q.L - best.at;
    if (o.legacyInletReuse) { if (toA < reuse) return q.a; if (toB < reuse) return q.b; }
    else if (Math.min(toA, toB) < reuse) return toA <= toB ? q.a : q.b;
    node ??= nodeAt(best.pt, false);
    const f1 = best.at / q.L, mid = Number.isFinite(q.r.upInv) && Number.isFinite(q.r.dnInv) ? q.r.upInv + f1 * (q.r.dnInv - q.r.upInv) : NaN;
    const s0 = srcOf(q.r);
    raw.push({ r: { ...q.r, upInv: mid, invSrc: ['interpolated', s0[1]] }, pts: [best.pt, ...q.pts.slice(best.k + 1)], a: node, b: q.b, L: q.L - best.at,
      es: [null, q.es?.[1] ?? null], res: [null, q.res?.[1] ?? null], cf: [false, !!q.cf?.[1]] });
    q.es = [q.es?.[0] ?? null, null]; q.res = [q.res?.[0] ?? null, null]; q.cf = [!!q.cf?.[0], false];
    q.r = { ...q.r, dnInv: mid, invSrc: [s0[0], 'interpolated'] }; q.pts = [...q.pts.slice(0, best.k + 1), best.pt]; q.b = node; q.L = best.at;
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

  // ---- 2. inverts: their units, then each end on its own evidence
  // Units come from what the record declares (a drawn or OSM asset: metres), from `o.invertUnits` ('m' | 'ft', the
  // user's override), or, for a layer that leaves them to be settled ('resolve'), from that layer's own records: the
  // unit under which its inverts lie 0.2–15 m under the ground. There is no minimum count: one record is evidence. The
  // unit that explains more of the records is taken if it explains over 60 % of them (metres on a tie, as before).
  // Where both units explain over 60 % (low ground: an invert of 8 is plausible as 8 m or 8 ft), the choice is said to
  // be ambiguous on every end that uses it, and `invertUnits` overrides it. Below 60 % in both, the layer's inverts are
  // not used and the reason is kept. (Until 11 Nov 2026 a call needed 3 records with inverts, and 30 % of all its
  // pipes, before any invert was used, and one unit decision covered every source passed in.)
  const UNITS = { m: 1, ft: 0.3048 };
  const good = (v) => v != null && Number.isFinite(v) && v !== 0;
  const declared = (q) => { const u = q.r.asset?.ends?.invertUnits; return UNITS[u] ? u : null; };
  const groupOf = (q) => String(q.r.asset?.source?.layer ?? q.r.layer ?? '');
  const unitDecision = new Map(); // layer → { units, how, n, frac }
  {
    const groups = new Map();
    for (const q of raw) { if (declared(q) || UNITS[o.invertUnits]) continue; const g = groupOf(q); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(q); }
    for (const [g, qs] of groups) {
      // records with both inverts are the evidence; a layer with none such uses its single ends
      const both = qs.filter(q => good(q.r.upInv) && good(q.r.dnInv));
      const use = both.length ? both.map(q => [[q.a, q.r.upInv], [q.b, q.r.dnInv]]) : qs.flatMap(q => [[q.a, q.r.upInv], [q.b, q.r.dnInv]].filter(([, v]) => good(v)).map(e => [e]));
      if (!use.length) { unitDecision.set(g, { units: null, how: 'the layer gives no inverts', n: 0 }); continue; }
      const frac = {};
      for (const [name, u] of Object.entries(UNITS)) frac[name] = use.filter(es => es.every(([n, v]) => { const c = nodes[n].ground - v * u; return c > 0.2 && c < 15; })).length / use.length;
      const [best, other] = frac.m >= frac.ft ? ['m', 'ft'] : ['ft', 'm'], ok = frac[best] > 0.6, ambiguous = ok && frac[other] > 0.6;
      const said = `cover plausible for ${Math.round(100 * frac.m)} % in m and ${Math.round(100 * frac.ft)} % in ft (${use.length} record${use.length > 1 ? 's' : ''})`;
      unitDecision.set(g, { units: ok ? best : null, ambiguous, n: use.length, frac,
        how: !ok ? `units not settled: ${said}` : ambiguous ? `units ambiguous, ${best} taken: ${said}; set invertUnits to override` : `inferred from the layer's cover: ${said}` });
    }
  }
  const unitOf = (q) => {
    const d = declared(q); if (d) return { name: d, u: UNITS[d], how: 'declared by the record' };
    if (UNITS[o.invertUnits]) return { name: o.invertUnits, u: UNITS[o.invertUnits], how: 'set by the user' };
    const dec = unitDecision.get(groupOf(q)); return dec?.units ? { name: dec.units, u: UNITS[dec.units], how: dec.how } : null;
  };

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
  const invAt = (q, v, i, minCover = 0.2) => { const un = unitOf(q); if (!un || !good(v)) return null; const z = v * un.u, c = nodes[i].ground - z; return c > minCover && c < 30 ? z : null; };
  let invPartial = 0, invRejected = 0, invBridged = 0;
  // why each recorded end was or was not used, in the record's drawn order [up, dn]; later steps add how a missing end
  // was filled (prov upInv / dnInv: carried, interpolated, bridged, derived)
  const trust = raw.map(q => [[q.r.upInv, q.a, 'up'], [q.r.dnInv, q.b, 'dn']].map(([v, n, e]) => {
    const un = unitOf(q), ae = q.r.asset?.ends?.[e];
    const conflict = ae?.conflict ? `; conflicts with structure record ${ae.structure?.id ?? ''} (${ae.resolved?.how ?? 'unresolved'}): the pipe layer's value is the one read here` : '';
    if (!good(v)) return { status: 'missing', reason: 'no invert recorded' + conflict };
    if (!un) return { status: 'rejected', reason: (unitDecision.get(groupOf(q))?.how ?? 'units unknown') + conflict };
    const z = v * un.u, c = nodes[n].ground - z;
    return c > 0.2 && c < 30 ? { status: 'accepted', units: un.name, unitsFrom: un.how, cover: +c.toFixed(3), reason: 'recorded; cover 0.2–30 m' + conflict }
      : { status: 'rejected', units: un.name, unitsFrom: un.how, cover: +c.toFixed(3), reason: `cover ${c.toFixed(2)} m is outside 0.2–30 m` + conflict };
  }));
  const ends = raw.map(q => [invAt(q, q.r.upInv, q.a), invAt(q, q.r.dnInv, q.b)]);
  const invertsSaid = () => { // as before for one source ('from layer (ft)' / 'derived from lidar'); several units are listed
    const used = [...new Set(trust.flatMap((t, k) => t.filter(x => x.status === 'accepted').map(() => unitOf(raw[k]).name)))];
    return used.length ? `from layer (${used.join(', ')})` : 'derived from lidar';
  };
  const src = raw.map((q, k) => ends[k].map((v, e) => (v != null ? srcOf(q.r)[e] : null)));
  // a culvert in two lengths: a manhole no pipe gives an invert for, between two pipes that run out to placed endwalls or
  // flared ends. Its invert lies on the straight run between the endwalls' inverts, which stand even with under 20 cm of
  // cover (an endwall sits in the creek, its invert at the bed or over a scour hole). The ground slope would put it near
  // the road (Sheffield Dr, Charlotte: an 8 × 28 ft arch that then carried nothing). Every other pipe is read as before.
  const open = nodes.map(() => []), known = new Uint8Array(nodes.length);
  raw.forEach((q, k) => { [q.a, q.b].forEach((n, e) => { if (ends[k][e] != null) known[n] = 1; else open[n].push([k, e]); }); });
  open.forEach((list, i) => {
    if (known[i] || list.length < 2) return;
    const walls = list.map(([k, e]) => { const q = raw[k], n = e === 0 ? q.b : q.a; return { k, e, z: userOut.has(n) ? invAt(q, e === 0 ? q.r.dnInv : q.r.upInv, n, -0.3) : null }; })
      .filter(w => w.z != null).sort((x, y) => (raw[y.k].r.h || 0) - (raw[x.k].r.h || 0));
    if (walls.length < 2) return;
    const [A, B] = walls; ends[A.k][1 - A.e] = A.z; ends[B.k][1 - B.e] = B.z; src[A.k][1 - A.e] = src[B.k][1 - B.e] = 'record';
    const z = A.z + (B.z - A.z) * raw[A.k].L / (raw[A.k].L + raw[B.k].L);
    for (const [k, e] of list) { ends[k][e] = z; src[k][e] = 'bridged'; }
    invBridged++;
  });
  // ---- 11. barrels (opt-in): runs of one section that may be one physical crossing, found, graded and, where the
  //          evidence is strong enough, oriented and profiled as a unit. Everything found is reported in `barrels`.
  const barrelDir = new Array(raw.length).fill(null), connInv = new Map(), barrelList = [];
  let barrels = 0, barrelEnds = 0, adverse = 0;
  if (o.barrelRuns) {
    const r3 = (v) => (v > 0 ? +v.toFixed(3) : null);
    const sect = (q) => {
      const a = q.r.asset;
      const k = a ? [a.section.shape, r3(a.section.rise), r3(a.section.span), a.section.barrels, a.material] : [q.r.shape, r3(q.r.h), r3(q.r.w), q.r.barrels ?? 1];
      return k[1] == null ? null : JSON.stringify(k);
    };
    const keys = raw.map(sect), at = nodes.map(() => []), deg = nodes.map(() => 0);
    raw.forEach((q, k) => { deg[q.a]++; deg[q.b]++; if (keys[k]) { at[q.a].push(k); at[q.b].push(k); } });
    // what each node is, from the structure records its pipe ends name (joinStructures), and its grates
    const struct = nodes.map(() => null);
    raw.forEach(q => [q.a, q.b].forEach((n, e) => { struct[n] ??= q.es?.[e] ?? null; }));
    const isWall = (i) => userOut.has(i) || struct[i]?.class === 'endwall';
    const isInlet = (i) => nodes[i].grates.length > 0 || struct[i]?.class === 'inlet' || /culvert/i.test(String(struct[i]?.notes ?? ''));
    const hump = o.barrelHump ?? 0.25, terrainTol = o.barrelTerrainTol ?? 0.2;
    const used = new Uint8Array(raw.length);
    for (let k0 = 0; k0 < raw.length; k0++) {
      if (used[k0] || !keys[k0]) continue;
      // grow the run both ways through nodes where exactly two lengths of this section meet (laterals may join)
      const through = (i) => !isWall(i) && !nodes[i].edge && at[i].filter(k => keys[k] === keys[k0]).length === 2;
      const run = [k0], via = [raw[k0].a, raw[k0].b];
      for (const side of [0, 1]) for (;;) {
        const end = side ? via[via.length - 1] : via[0], last = side ? run[run.length - 1] : run[0];
        if (!through(end)) break;
        const nx = at[end].find(k => keys[k] === keys[k0] && k !== last);
        if (nx === undefined || run.includes(nx)) break;
        const far = raw[nx].a === end ? raw[nx].b : raw[nx].a;
        if (side) { run.push(nx); via.push(far); } else { run.unshift(nx); via.unshift(far); }
      }
      run.forEach(k => { used[k] = 1; });
      const A = via[0], B = via[via.length - 1];
      if (A === B) continue; // a loop
      // how sure: both ends endwalls (known culvert structures) > the source calls it a culvert > one endwall and a
      // dead end where the other should be. Anything else is an ordinary pipe run and is not a candidate.
      const walls = [A, B].filter(isWall).length, named = run.some(k => raw[k].r.asset?.role === 'culvert');
      const deadEnd = [A, B].some(i => !isWall(i) && deg[i] === 1);
      const basis = [walls === 2 ? 'endwall at both ends' : walls === 1 ? 'endwall at one end' : null, named ? 'the source calls it a culvert' : null, deadEnd ? 'a dead end where an endwall may be missing' : null].filter(Boolean);
      const grade = walls === 2 ? 'high' : named ? 'medium' : walls === 1 && deadEnd ? 'low' : null;
      if (!grade) continue;
      const rec = { pipes: run.map(k => 'C' + k), from: A, to: B, grade, basis, direction: null, interior: [], flags: [] };
      barrelList.push(rec);
      // another record with the same ends and section: twin barrels drawn as two features, or the same pipe twice
      const twin = raw.findIndex((q, k) => !run.includes(k) && keys[k] === keys[k0] && run.some(j => (raw[j].a === q.a && raw[j].b === q.b) || (raw[j].a === q.b && raw[j].b === q.a)));
      if (twin >= 0) rec.flags.push(`C${twin} has the same ends and section: twin barrels drawn as two records, or one pipe recorded twice (not merged)`);
      if (grade === 'low') { rec.flags.push('a possible barrel with one end missing: reported, not changed'); continue; }

      // the floor at each end: the structure record's invert where it was chosen over the pipe layer, else the pipe
      // end's (endwalls stand with little cover, as in rule 10)
      const floorAt = (k, n) => {
        const q = raw[k], e = q.a === n ? 0 : 1, res = q.res?.[e];
        const v = res?.value ?? (e === 0 ? q.r.upInv : q.r.dnInv);
        return { z: invAt(q, v, n, isWall(n) ? -0.3 : 0.2), from: res ? `${res.from}${res.method ? ' (' + res.method + ')' : ''}` : 'pipe layer', conflict: !!q.cf?.[e] };
      };
      const fA = floorAt(run[0], A), fB = floorAt(run[run.length - 1], B), zA = fA.z, zB = fB.z, rise = raw[k0].r.h || 0;
      if (fA.conflict || fB.conflict) rec.flags.push('the pipe layer and the structure record disagree at an endwall: ' + [fA, fB].filter(x => x.conflict).map(x => x.from).join(', ') + ' chosen');

      // direction, from evidence other than the inverts first. Each votes +1 (A → B), −1 or 0.
      const srcFwd = run.map((k, i) => raw[k].a === via[i]); // the source's own from → to (the drawn order, which follows its US/DS ids)
      const ev = {
        source: srcFwd.every(Boolean) ? 1 : srcFwd.some(Boolean) ? 0 : -1,
        connectivity: Math.abs(dist[A] - dist[B]) > 1 ? (dist[A] > dist[B] ? 1 : -1) : 0, // the end nearer the network's exits is downstream
        terrain: Math.abs(nodes[A].ground - nodes[B].ground) > terrainTol ? (nodes[A].ground > nodes[B].ground ? 1 : -1) : 0,
        inverts: zA != null && zB != null && Math.abs(zA - zB) > hump * rise ? (zA > zB ? 1 : -1) : 0, // supporting only
      };
      let dir, how, conf;
      if (ev.source) {
        const against = ['connectivity', 'terrain'].filter(x => ev[x] === -ev.source), support = ['connectivity', 'terrain'].filter(x => ev[x] === ev.source);
        if (against.length && !support.length && ev.inverts === -ev.source) {
          dir = -ev.source; how = 'barrel: turned (the source direction is contradicted by the ' + against.join(' and ') + ' and the inverts)'; conf = 'low';
          rec.flags.push('drawn against the ' + against.join(' and ') + ' and the inverts: turned round; check the record');
        } else {
          dir = ev.source; how = 'barrel: as drawn'; conf = against.length ? 'medium' : support.length ? 'high' : 'medium';
          if (against.length) rec.flags.push('kept as drawn although the ' + against.join(' and ') + ' disagree');
        }
      } else {
        const by = ['connectivity', 'terrain', 'inverts'].find(x => ev[x]);
        dir = by ? ev[by] : (srcFwd[0] ? 1 : -1); how = by ? `barrel: by the ${by} (lengths drawn both ways)` : 'barrel: as the first length is drawn (no evidence)';
        conf = by === 'inverts' || !by ? 'low' : 'medium';
        rec.flags.push(`lengths drawn both ways: oriented by ${by ?? 'nothing better than the first length'}`);
      }
      rec.direction = { toB: dir > 0, how, confidence: conf, evidence: ev };
      run.forEach((k, i) => { barrelDir[k] = { flip: raw[k].a !== (dir > 0 ? via[i] : via[i + 1]), how }; });
      barrels++;
      if (zA != null && zB != null && (dir > 0 ? zB > zA : zA > zB)) adverse++;

      // the floor between the endwalls. An interior invert is changed only when the elevation and the structure agree it
      // is a connection; elevation alone is reported, not acted on.
      if (zA == null || zB == null) { rec.flags.push('an endwall floor is unknown: the interior profile is left as recorded'); continue; }
      if (grade !== 'high') { if (via.length > 2) rec.flags.push('not endwall to endwall: the interior profile is left as recorded'); continue; }
      for (const [e, k] of [[0, run[0]], [1, run[run.length - 1]]]) { const q = raw[k], n = e ? B : A, ee = q.a === n ? 0 : 1; ends[k][ee] = e ? zB : zA; src[k][ee] = 'record'; }
      const Ltot = run.reduce((t, k) => t + raw[k].L, 0), top = Math.max(zA, zB) + hump * rise;
      let sAt = 0;
      for (let i = 1; i < via.length - 1; i++) {
        const n = via[i], kIn = run[i - 1], kOut = run[i]; sAt += raw[kIn].L;
        const z = zA + (zB - zA) * sAt / Ltot;
        const endsHere = [[kIn, raw[kIn].a === n ? 0 : 1], [kOut, raw[kOut].a === n ? 0 : 1]];
        const given = endsHere.map(([k, e]) => { const v = e === 0 ? raw[k].r.upInv : raw[k].r.dnInv, un = unitOf(raw[k]); return un && good(v) ? v * un.u : null; });
        const high = given.some(v => v != null && v > top), inlet = isInlet(n), missing = given.some(v => v == null);
        const cls = high && inlet ? 'connection' : high ? 'possible connection' : inlet ? 'structure on the barrel' : 'floor';
        rec.interior.push({ node: n, class: cls, given, floor: z, structure: struct[n]?.type ?? (nodes[n].grates.length ? 'grate' : null) });
        if (cls === 'possible connection') rec.flags.push(`an invert above both endwalls with no structure to explain it (node ${n}): left as recorded`);
        endsHere.forEach(([k, e], j) => {
          // a connection's high ends come down to the floor; elsewhere only a node with no invert at all is filled (rule 10)
          if (cls === 'connection' ? given[j] != null && given[j] > top : given.every(v => v == null)) {
            if (given[j] != null) connInv.set(n, Math.max(connInv.get(n) ?? -Infinity, given[j]));
            ends[k][e] = z; src[k][e] = 'interpolated'; barrelEnds++;
          }
        });
        if (missing && cls !== 'connection') rec.flags.push(given.every(v => v == null) ? `no invert at node ${n}: on the line between the endwalls` : `one end at node ${n} has no invert: carried as before`);
      }
    }
  }
  raw.forEach((q, k) => {
    let [up, dn] = ends[k];
    if (unitOf(q) && (good(q.r.upInv) && invAt(q, q.r.upInv, q.a) == null || good(q.r.dnInv) && invAt(q, q.r.dnInv, q.b) == null)) invRejected++;
    if ((up == null) !== (dn == null)) {
      const S = Math.max(o.minSlope, Math.abs(nodes[q.a].ground - nodes[q.b].ground) / q.L);
      if (up == null) { up = dn + S * q.L; src[k][0] = 'carried'; } else { dn = up - S * q.L; src[k][1] = 'carried'; }
      invPartial++;
    }
    const bar = barrelDir[k];
    const flip = bar ? bar.flip : up != null ? dn > up : dist[q.b] > dist[q.a] || (dist[q.b] === dist[q.a] && nodes[q.b].ground > nodes[q.a].ground);
    const how = bar ? bar.how : up != null ? (flip ? 'inverts' : 'drawn') : 'toward the exits';
    let ps = src[k];
    let tr = trust[k];
    if (flip) { [q.a, q.b] = [q.b, q.a]; [up, dn] = [dn, up]; ps = [ps[1], ps[0]]; tr = [tr[1], tr[0]]; }
    Object.assign(q, { D: q.r.h, Wd: q.r.w, shape: q.r.shape, barrels: q.r.barrels, invUp: up, invDn: dn, given: up != null, reversed: !bar && flip && up != null, turned: !!flip, ps, how, trust: tr });
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
      [q.a, q.b] = [q.b, q.a]; [q.invUp, q.invDn] = [q.invDn, q.invUp]; q.ps = [q.ps[1], q.ps[0]]; q.reversed = false; q.how = 'restored (drawn)';
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
    if (arrive < Infinity && arrive - q.invUp > 0.3 && arrive > q.invDn + fall) { q.invUp = arrive; q.ps[0] = 'repaired'; continue; }
    q.invDn = q.invUp - fall; q.ps[1] = 'repaired';
    const done = new Set([k]), stack = [[q.b, q.invDn]];
    while (stack.length) {
      const [i, z] = stack.pop();
      for (const j of outOf[i]) {
        const r = raw[j]; if (done.has(j) || !r.given || r.invUp <= z) continue;
        done.add(j); r.invUp = z; r.ps[0] = 'repaired';
        if (r.invDn > z - o.minSlope * r.L) { r.invDn = z - o.minSlope * r.L; r.ps[1] = 'repaired'; stack.push([r.b, r.invDn]); }
      }
    }
  }
  let filled = 0;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (const q of raw) if (!(q.D > 0)) {
      const near = [...into[q.a], ...outOf[q.b]].map(k => raw[k].D).filter(v => v > 0);
      if (near.length) { q.D = Math.max(...into[q.a].map(k => raw[k].D).filter(v => v > 0), Math.min(...near)); q.fill = 'neighbour'; changed = true; }
    }
    if (!changed) break;
  }
  for (const q of raw) if (!(q.D > 0)) { q.D = median; q.fill = 'median'; }
  filled = raw.filter(q => q.fill).length;
  for (const q of raw) if (q.shape === 'RECT_CLOSED' && !(q.Wd > 0)) q.Wd = q.D;

  // derived inverts where missing, then make sure nothing rises at a manhole (bounded passes: networks can loop)
  for (const q of raw) if (!q.given) {
    const S = Math.max(o.minSlope, (nodes[q.a].ground - nodes[q.b].ground) / q.L);
    q.invUp = nodes[q.a].ground - o.cover - q.D; q.invDn = q.invUp - S * q.L; q.ps = ['derived', 'derived'];
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
  let entrances = 0; const entranceAt = new Set();
  if (realInlets) nodes.forEach((n, i) => {
    if (!outOf[i].length || n.edge || n.grates.length) return;
    if (!openHeads.has(i) && (into[i].length || !userOut.has(i))) return;
    const q = outOf[i].map(k => raw[k]).sort((a, b) => b.D - a.D)[0], rect = q.shape === 'RECT_CLOSED', b = q.barrels > 1 ? q.barrels : 1, wide = rect ? q.Wd : q.D;
    n.inletFine = [lowest(n.p, Math.max(1, Math.round(5 / dx)))]; n.grateOpen = [1]; n.grateCrest = [0];
    n.grateHyd = [{ inletArea: b * (rect ? wide * q.D : Math.PI / 4 * q.D * q.D), inletPerim: b * wide, Cw: 0.37, Co: 0.6 }];
    entrances++; entranceAt.add(i);
  });

  // ---- outfalls: every manhole with no pipe leaving it (boundary ends continue off-site, interior ends are free)
  const outNodes = nodes.map((n, i) => {
    const sink = into[i].length > 0 && outOf[i].length === 0;
    const inv = Math.min(...[...into[i].map(k => raw[k].invDn), ...outOf[i].map(k => raw[k].invUp)]);
    return { ...(connInv.has(i) ? { connInv: connInv.get(i) } : {}), name: (sink ? 'O' : 'J') + i, p: n.p, ground: n.ground, invert: inv, depth: Math.max(0.5, n.ground - inv), outfall: sink,
      toStream: false, realOutfall: sink && !n.edge, placed: sink && userOut.has(i), openEnd: sink && !n.edge && !userOut.has(i) && !o.combined, inletFine: sink ? [] : n.inletFine, grateOpen: sink ? [] : n.grateOpen, grateCrest: sink ? [] : n.grateCrest, grateHyd: sink ? [] : n.grateHyd, gutter: n.gutter, fineCell: n.gutter, area: 0, CA: 0, edge: n.edge };
  });
  const outPipes = raw.map((q, k) => ({ name: 'C' + k, from: q.a, to: q.b, L: Math.max(1, q.L), D: q.D, W: q.shape === 'RECT_CLOSED' ? q.Wd : 0, shape: q.shape,
    barrels: q.barrels, n: q.r.n, Q: 0, S: Math.max(1e-4, (q.invUp - q.invDn) / q.L), inOffset: q.invUp - outNodes[q.a].invert, outOffset: q.invDn - outNodes[q.b].invert,
    area: 0, real: true, filledSize: !!q.fill, givenInverts: q.given, prov: pipeProv(q) }));
  const interiorEnds = outNodes.filter(n => n.outfall && !n.edge).length;
  const native = o.nativeSections ? nativeSections(raw, outPipes, outNodes, outOf, into, entranceAt, o) : null;
  addOutlets(outNodes, outPipes, o, dx);

  // ---- 5. exchange points (grates were attached in 1b; without inlet data, one grate per manhole at the gutter)
  if (!realInlets) for (const n of outNodes) if (!n.outfall) n.inletFine = [n.gutter];
  const inlets = exchangePoints(outNodes, W, sim, realInlets);

  return {
    nodes: outNodes, pipes: outPipes, inlets, opts: o, designIntensity10: 0, tier: 1, ...(o.barrelRuns ? { barrels: barrelList } : {}), ...(native ? { culverts: native.culverts } : {}),
    stats: { junctions: outNodes.filter(n => !n.outfall).length, outfalls: outNodes.filter(n => n.outfall).length, pipes: outPipes.length,
      inlets: inlets.filter(g => g.grates > 0).length, grates: inlets.reduce((s, g) => s + g.grates, 0), lids: inlets.filter(g => !g.grates).length,
      realInlets, unconnectedGrates: unconnected, realOutfalls: 0, offsiteOutlets: outNodes.filter(n => n.offsite).length,
      ...(o.barrelRuns ? { barrels, barrelEnds, adverseBarrels: adverse, barrelCandidates: barrelList.length } : {}), ...(native ? { native: native.stats } : {}), realPipes: raw.length, tees, filledSizes: filled, inverts: invertsSaid(), invertUnits: [...unitDecision].map(([layer, d]) => ({ layer: layer || null, ...d })), invPartial, invRejected, invBridged, interiorEnds, placedOutfalls: outNodes.filter(n => n.placed).length, openEnds: outNodes.filter(n => n.openEnd).length, restoredPipes: restored.length, culvertEntrances: entrances, openedHeads: [...openHeads].filter(i => outOf[i].length).length,
      pipeLength: outPipes.filter(q => !q.offsite).reduce((s, q) => s + q.L, 0), minD: Math.min(...outPipes.map(q => q.D)), maxD: Math.max(...outPipes.map(q => q.D)), served: 0 },
  };
}

/**
 * Opt-in (`nativeSections`): each conduit with a canonical record gets its SWMM section from src/swmm-xsect.js. That is
 * the native shape or an exact custom curve, roughness from the material, sediment from the scenario, and, on culvert
 * lengths, HDS-5 inlet-control codes and losses. A culvert here is the chain of lengths from a culvert entrance (a
 * pipe head at an endwall or flared end that takes surface water) through nodes with one pipe in and one out, to an
 * outfall. Inlet control goes on its first length, the exit loss on its last. The entrance's surface exchange takes
 * the barrel's real open area and span. Returns { stats, culverts }; changes outPipes and outNodes in place.
 */
function nativeSections(raw, outPipes, outNodes, outOf, into, entranceAt, o) {
  const cfg = { ...NATIVE_DEFAULTS, ...(o.nativeSections === true ? {} : o.nativeSections) };
  const sedOf = (a) => { const id = a.source?.id; const v = typeof cfg.sediment === 'function' ? cfg.sediment(a) : cfg.sediment?.[id]; return Number(v ?? a.condition?.sediment ?? 0) || 0; };
  const role = new Map(), culverts = [];
  for (const i of entranceAt) {
    // the barrel runs on through a node where one length of the same section leaves; laterals may join there (a catch
    // basin entering the culvert), but a fork or a change of section ends it
    const sec = (q) => { const s = q.r.asset?.section; return s ? [s.shape, s.rise?.toFixed(3), s.span?.toFixed(3), s.barrels].join() : [q.shape, q.D, q.Wd, q.barrels].join(); };
    const chain = []; let at = i;
    for (let guard = 0; guard < 500; guard++) {
      const outs = outOf[at]; if (outs.length !== 1) break;
      const k = outs[0]; if (chain.includes(k) || (chain.length && sec(raw[k]) !== sec(raw[chain.at(-1)]))) break;
      chain.push(k); at = raw[k].b;
      if (outNodes[at].outfall) break;
    }
    if (!chain.length) continue;
    const q0 = raw[chain[0]], st = q0.turned ? q0.es?.[1] : q0.es?.[0], ent = entranceOf(st?.type);
    const ends = outNodes[at].outfall && !outNodes[at].edge; // an edge outfall is a cut, not the barrel's outlet
    chain.forEach((k, m) => role.set(k, { entrance: m === 0, exit: ends && m === chain.length - 1, entranceType: ent, entranceProv: ent ? `structure ${st?.id ?? ''} (${st?.type})`.trim() : null }));
    culverts.push({ pipes: chain.map(k => 'C' + k), chain, from: outNodes[i].name, to: outNodes[at].name, toOutfall: ends, entrance: ent ?? cfg.entrance, entranceFrom: ent ? 'structure' : 'default' });
  }
  const stats = { sections: 0, sizeFilled: 0, custom: 0, filled: 0, culvertCodes: 0, losses: 0, nMaterial: 0, approximated: 0, refused: [] };
  outPipes.forEach((p, k) => {
    let a = raw[k].r.asset; if (!a) return;
    // a size the record left blank and the network filled (rule 2): that size, said so
    const filledRise = !(a.section.rise > 0) && raw[k].fill && p.D > 0;
    if (filledRise) a = { ...a, section: { ...a.section, rise: p.D, span: a.section.shape === 'box' ? (p.W > 0 ? p.W : p.D) : a.section.span } };
    const x = swmmSection(a, { role: role.get(k) ?? null, sed: sedOf(a), nDefault: o.n, cfg, name: p.name });
    if (filledRise && !x.error) x.approx.unshift(`size not recorded: ${p.D.toFixed(2)} m from the ${raw[k].fill === 'median' ? 'network median' : 'neighbouring pipes'}`);
    if (x.error) { stats.refused.push(`${p.name}: ${x.error}`); return; }
    p.xs = { shape: x.shape, g: x.g, barrels: x.barrels, culvert: x.culvert, curve: x.curve ?? null, loss: x.loss, prov: x.prov, approx: x.approx, area: x.area, open: x.open };
    p.n = x.n; if (x.offsetRise > 0) { p.inOffset += x.offsetRise; p.outOffset += x.offsetRise; }
    stats.sections++; if (x.shape === 'CUSTOM') stats.custom++; if (x.sediment > 0) stats.filled++; if (filledRise) stats.sizeFilled++; if (x.culvert) stats.culvertCodes++; if (x.loss) stats.losses++;
    if (/^material/.test(x.prov.n)) stats.nMaterial++; if (x.approx.length) stats.approximated++;
    const r = role.get(k); // the entrance exchange takes the barrel's real opening
    if (r?.entrance && entranceAt.has(raw[k].a)) {
      const n = outNodes[raw[k].a], sec = a.section, span = sec.shape === 'circle' ? sec.rise : sec.span ?? sec.rise;
      const area = openArea(sec.shape ?? 'circle', sec.rise, span, x.sediment) ?? x.area;
      if (n.grateHyd?.length && area > 0) n.grateHyd = [{ ...n.grateHyd[0], inletArea: x.barrels * area, inletPerim: x.barrels * span }];
    }
  });
  stats.merge = cfg.mergeBarrels ? mergeBarrels(raw, outPipes, outNodes, outOf, into, entranceAt, culverts, sedOf) : null;
  for (const c of culverts) delete c.chain;
  return { stats, culverts };
}

/**
 * One SWMM conduit per continuous physical barrel (Stage B, T1). The canonical records stay as they are; this is the
 * hydraulic translation only. A culvert chain is cut into runs at every node that has to survive as a junction:
 *   - a lateral or a fork (not exactly one length in and one out);
 *   - a surface connection (a grate or other exchange point, or an inlet's connection invert);
 *   - an outfall, an area edge, or another culvert's entrance;
 *   - a change of section, material, roughness or sediment;
 *   - recorded inverts at the node that leave the straight line between the run's end floors by more than
 *     `mergeInvertTol` × rise (0.25), or a drop at the node of more than that: a profile the records say is not uniform.
 *     The merged conduit never takes its floor from an interior node; it runs between the end floors.
 * Each run of two or more lengths becomes its first conduit, carried to the run's last node: its length is the sum, its
 * inlet code and entrance loss those of its first length, its exit loss that of its last. The interior nodes and the
 * other conduits are removed. Each merged conduit lists its source records (`records`) and every chain node kept, with
 * why (`stats.merge.kept`). Why: SWMM surcharges a chain's pass-through junctions above the crown on a steep barrel, so
 * the first length runs full, its inlet code goes inert and the headwater differs from the same barrel as one conduit
 * (B8-M: −0.27 m at Q/AD^0.5 = 5). Twin barrels are separate records with separate chains and stay separate conduits.
 */
function mergeBarrels(raw, outPipes, outNodes, outOf, into, entranceAt, culverts, sedOf) {
  const tolF = 0.25;
  const key = (k) => { const a = raw[k].r.asset, s = a?.section; return JSON.stringify(s ? [s.shape, s.rise?.toFixed(3), s.span?.toFixed(3), s.barrels, a.material, outPipes[k].n, sedOf(a)] : [raw[k].shape, raw[k].D, raw[k].Wd, raw[k].barrels, outPipes[k].n]); };
  const why = (i, kIn, kOut) => {
    const n = outNodes[i];
    if (into[i].length !== 1 || outOf[i].length !== 1) return `a lateral or fork (${into[i].length} in, ${outOf[i].length} out)`;
    if (n.outfall || n.edge) return n.edge ? 'the area edge' : 'an outfall';
    if (entranceAt.has(i)) return 'a culvert entrance';
    if (n.inletFine?.length || n.grateHyd?.length || n.connInv != null) return 'a surface connection (grate or inlet)';
    if (key(kIn) !== key(kOut)) return 'a change of section, material, roughness or sediment';
    return null;
  };
  const kept = [], records = [], dropPipe = new Set(), dropNode = new Set();
  for (const c of culverts) {
    const ch = c.chain, runs = [[ch[0]]];
    for (let m = 1; m < ch.length; m++) {
      const i = raw[ch[m - 1]].b, r = why(i, ch[m - 1], ch[m]);
      if (r) { kept.push({ node: outNodes[i].name, culvert: c.from, reason: r }); runs.push([ch[m]]); } else runs.at(-1).push(ch[m]);
    }
    // the profile: a run whose interior recorded inverts leave the end-to-end line is cut there too
    const final = [];
    for (const run of runs) {
      // the straight line between this run's end floors, and each interior node's two recorded ends against it
      const z0 = raw[run[0]].invUp, z1 = raw[run.at(-1)].invDn, Lrun = run.reduce((t, k) => t + raw[k].L, 0), tol = tolF * (raw[run[0]].D || 0);
      let cur = [run[0]], s = raw[run[0]].L;
      for (let m = 1; m < run.length; m++) {
        const line = z0 + (z1 - z0) * s / Lrun, zIn = raw[run[m - 1]].invDn, zOut = raw[run[m]].invUp;
        if (Math.abs(zIn - line) > tol || Math.abs(zOut - line) > tol || Math.abs(zIn - zOut) > tol) {
          kept.push({ node: outNodes[raw[run[m]].a].name, culvert: c.from, reason: `the recorded inverts (${zIn.toFixed(2)} / ${zOut.toFixed(2)} m) leave the line between the end floors (${line.toFixed(2)} m) by more than ${tol.toFixed(2)} m` });
          final.push(cur); cur = [run[m]];
        } else cur.push(run[m]);
        s += raw[run[m]].L;
      }
      final.push(cur);
    }
    const names = [];
    for (const run of final) {
      const p0 = outPipes[run[0]], pl = outPipes[run.at(-1)];
      names.push(p0.name);
      if (run.length === 1) continue;
      // each source record as it was before the merge: its asset id and source geometry, its two nodes and the
      // structures its ends name (in the direction the network runs it), its inverts with their provenance and trust,
      // and, for every joint after it, why that node was not kept
      const z0 = raw[run[0]].invUp, z1 = raw[run.at(-1)].invDn, Lrun = run.reduce((t, k) => t + raw[k].L, 0);
      let sAt = 0;
      const recs = run.map((k, m) => {
        const q = raw[k], a = q.r.asset, ends = a?.ends ? (q.turned ? [a.ends.dn, a.ends.up] : [a.ends.up, a.ends.dn]) : [null, null];
        sAt += q.L;
        const joint = m < run.length - 1 ? (() => {
          const line = z0 + (z1 - z0) * sAt / Lrun, dev = Math.max(Math.abs(q.invDn - line), Math.abs(raw[run[m + 1]].invUp - line));
          return { node: outNodes[q.b].name, merged: `one length in and one out; no grate, inlet or connection invert; the same section, material, n and sediment; recorded inverts within ${dev.toFixed(3)} m of the line between the end floors (limit ${(tolF * (q.D || 0)).toFixed(2)} m)` };
        })() : null;
        return { pipe: outPipes[k].name, asset: a?.source?.id ?? null, layer: a?.source?.layer ?? null, line: a?.line ?? null, L: +q.L.toFixed(2),
          nodes: [outNodes[q.a].name, outNodes[q.b].name], structures: ends.map(e => e?.structure?.id ?? e?.node ?? null),
          invUp: +q.invUp.toFixed(3), invDn: +q.invDn.toFixed(3), invProv: q.ps ?? null, invTrust: q.trust ?? null, turned: !!q.turned, joint };
      });
      const L = run.reduce((t, k) => t + outPipes[k].L, 0), le = p0.xs.loss?.entry ?? 0, lx = pl.xs.loss?.exit ?? 0;
      Object.assign(p0, { to: pl.to, L, outOffset: pl.outOffset, S: Math.max(1e-4, (raw[run[0]].invUp - raw[run.at(-1)].invDn) / L), records: recs });
      p0.xs = { ...p0.xs, loss: le || lx ? { entry: le, exit: lx, avg: 0 } : null, prov: { ...p0.xs.prov, merged: `${run.length} records as one barrel (${recs.map(r => r.asset ?? r.pipe).join(', ')})` } };
      for (const k of run.slice(1)) dropPipe.add(k);
      for (const k of run.slice(0, -1)) dropNode.add(raw[k].b);
      records.push({ conduit: p0.name, culvert: c.from, records: recs });
    }
    c.pipes = names;
  }
  if (dropPipe.size) {
    const map = new Map(), keepN = outNodes.filter((n, i) => !dropNode.has(i));
    outNodes.forEach((n, i) => { if (!dropNode.has(i)) map.set(i, keepN.indexOf(n)); });
    const keepP = outPipes.filter((p, k) => !dropPipe.has(k));
    for (const p of keepP) { p.from = map.get(p.from); p.to = map.get(p.to); }
    outNodes.splice(0, outNodes.length, ...keepN); outPipes.splice(0, outPipes.length, ...keepP);
  }
  return { barrels: records.length, recordsMerged: records.reduce((t, r) => t + r.records.length, 0), conduitsRemoved: dropPipe.size, nodesRemoved: dropNode.size, merged: records, kept };
}

