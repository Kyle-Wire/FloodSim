// Closed crossings: places where the conditioned terrain still dams a mapped stream.
//
// Bare-earth lidar keeps the road embankments that streams pass under. src/channels.js cuts the short ones (≤ 30 m
// along the stream, ≤ 4 m high) and links the culverts OpenStreetMap maps. What is left is the dangerous case: a
// wide highway fill, a railway, a crossing nobody mapped. The model then ponds the stream behind it until it spills
// over the top or out of the area, and reports a flood that is not there (South Branch Pennsauken Creek, RT-1,
// 16 Nov 2026: a 4 m pool behind a road fill 80 m above the gauge; Briar Creek and the Sheffield culvert before it).
//
// This module changes nothing. It walks each stream's path over the conditioned ground and lists every rise the water
// cannot get past without ponding, so the app can say so before a run, and a test build can refuse the site.
import { mappedCells, spillLevel } from './channels.js';

/**
 * The rises along each stream path that water must pond behind to pass.
 *
 * Walking downstream from each low point to the next point at or below it (within `reach` m), the rise between is a
 * closed crossing when the lowest way past it, over or round within `corridor` m of the path, is at least `minPond`
 * above the low point. A rise the water can get round lower down is terrain and is not listed.
 *
 * @param fine     the fine grid (dx; toCells)
 * @param f        the conditioned fine model: nx, ny, z, bld, road (after breachChannels)
 * @param paths    stream cell paths, downstream (breachChannels().paths), or [{ path, line, name, kind }]. Where the
 *                 mapped lines are given, ways that share an end point are walked as one stream (joinStreams): a
 *                 crossing is often mapped as its own short way lying on top of the fill, with no rise inside any one way
 * @param opts.culverts  mapped culverts [{ line, D, sized }]: a rise with one within `near` m is listed as a culvert
 *                       crossing (the solver links it), with its barrel and whether the size was mapped or assumed
 * @param opts.minPond   m of ponding that makes a rise a closed crossing (default 0.5)
 * @param opts.tol       m a bed may rise without starting a hump (default 0.15, as breachChannels)
 * @param opts.reach     m along the stream searched for the far side of a rise (default 400)
 * @param opts.corridor  m either side of the path searched for a way round (default 30)
 * @param opts.natural   m: a rise lower than this with no road on it is listed under `rises`, not `closed` (default
 *                       1.5). Hydro-flattened lidar holds pools behind riffles, bars and low-water fords: on Cibolo Creek
 *                       (a valid RT-1 reach) three such steps of 0.6-1.0 m are the stream's own bed
 * @returns { closed, rises, culverts, uphill, checked }
 *   closed    [{ stream, name, kind, k (crest cell), i, j, foot, crest, pond (m), length (m), road }] no way through,
 *             under a road or at least `natural` high; deepest first
 *   rises     the same, lower and with no road: most likely the bed
 *   culverts  the same, each with culvert: { D, sized }: passes only through that barrel
 *   uphill    streams whose path rises overall (mapped against the flow, or not a stream): not checked
 *   checked   streams walked (after joining)
 */
/**
 * Chain mapped ways into streams: a way whose last point is another's first continues into it. Each way with nothing
 * flowing into it starts a stream, followed downstream until it ends (or meets itself). A way two streams flow into is
 * walked in both. → [{ path, name, kind, ways: [index…], owner: the way each cell came from }]; entries without a line stay as they are.
 */
export function joinStreams(entries) {
  const E = entries.map((e) => (Array.isArray(e) || ArrayBuffer.isView(e) ? { path: e } : e));
  const key = (p) => (p ? p[0] + ',' + p[1] : null), starts = new Map(), into = new Set();
  E.forEach((e, n) => { const k = key(e.line?.[0]); if (k != null) { if (!starts.has(k)) starts.set(k, []); starts.get(k).push(n); } });
  const next = E.map((e, n) => { const k = key(e.line?.[e.line.length - 1]), c = k == null ? [] : (starts.get(k) ?? []).filter(m => m !== n);
    const m = c.find(q => E[q].name && E[q].name === e.name) ?? c[0]; if (m != null) into.add(m); return m ?? -1; });
  const out = [];
  E.forEach((e, n) => {
    if (into.has(n) || !e.path?.length) return;
    const ways = [], cells = [], owner = []; let name = e.name;
    for (let m = n; m >= 0 && !ways.includes(m); m = next[m]) { ways.push(m); for (const k of E[m].path ?? []) if (cells[cells.length - 1] !== k) { cells.push(k); owner.push(m); } name ??= E[m].name; }
    out.push({ path: cells, name, kind: e.kind, ways, owner, names: E.map(x => x.name), kinds: E.map(x => x.kind) });
  });
  return out;
}

/**
 * Mapped waterways with the ways that continue into each other made one line (joinStreams on their end points), for
 * breachChannels: an embankment whose two sides are on different ways, or whose top is a short way of its own, is then
 * a rise inside one line and can be cut. → [{ line, kind, name, ways }]
 */
export function joinLines(ways) {
  return joinStreams(ways.map((w, n) => ({ path: [n], line: w.line, name: w.name, kind: w.kind }))).map((s) => {
    const line = [];
    for (const n of s.ways) for (const p of ways[n].line) { const q = line[line.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) line.push(p); }
    return { line, kind: ways[s.ways[0]].kind, name: s.name, ways: s.ways };
  });
}

export function closedCrossings(fine, f, paths, { culverts = [], minPond = 0.5, tol = 0.15, reach = 400, corridor = 30, near = 15, natural = 1.5 } = {}) {
  const { nx, z } = f, dx = fine.dx, pad = Math.max(1, Math.round(corridor / dx));
  const span = (p, q) => dx * Math.hypot(p % nx - q % nx, ((p / nx) | 0) - ((q / nx) | 0));
  // cells of each mapped culvert, for the "is there a barrel here" test
  const barrels = culverts.map(c => ({ c, cells: Array.isArray(c.cells) ? c.cells : mappedCells(fine, f, c.line) })).filter(b => b.cells.length);
  const barrelNear = (cells) => {
    const R = near / dx; let best = null;
    for (const b of barrels) for (const p of b.cells) { const pi = p % nx, pj = (p / nx) | 0;
      if (cells.some(k => Math.hypot(k % nx - pi, ((k / nx) | 0) - pj) <= R)) { if (!best || (b.c.D ?? 0) > (best.D ?? 0)) best = b.c; break; } }
    return best;
  };
  const closed = [], rises = [], piped = [], uphill = [], seen = new Set(); let checked = 0;
  // a mapped culvert is its own way between the open ways either side: it joins them, turned round if it was drawn
  // against the flow, so the fill over it is walked and found to have a barrel
  const E = paths.map((e) => (Array.isArray(e) || ArrayBuffer.isView(e) ? { path: e } : e)), key = (p) => p[0] + ',' + p[1];
  const startsAt = new Set(E.filter(e => e.line?.length).map(e => key(e.line[0]))), endsAt = new Set(E.filter(e => e.line?.length).map(e => key(e.line[e.line.length - 1])));
  const links = barrels.filter(b => b.c.line?.length > 1).map(b => {
    const l = b.c.line, fwd = startsAt.has(key(l[l.length - 1])) || endsAt.has(key(l[0])), back = startsAt.has(key(l[0])) || endsAt.has(key(l[l.length - 1]));
    return !fwd && back ? { path: [...b.cells].reverse(), line: [...l].reverse(), link: true } : { path: b.cells, line: l, link: true };
  });
  joinStreams([...E, ...links]).forEach((meta, s) => {
    if (meta.ways.length === 1 && meta.ways[0] >= E.length) return; // a culvert joined to nothing
    const path = meta.path;
    if (!path || path.length < 3) return;
    // a path that ends well above where it starts is not being walked downstream
    if (z[path[path.length - 1]] > z[path[0]] + Math.max(1, minPond)) { uphill.push({ stream: s, name: meta.name, rise: z[path[path.length - 1]] - z[path[0]] }); return; }
    checked++;
    let a = 0;
    while (a < path.length - 1) {
      const za = z[path[a]];
      if (!(z[path[a + 1]] > za + tol)) { a++; continue; }
      let b = a + 1, peak = za, top = a + 1;
      while (b < path.length && z[path[b]] > za + tol && span(path[a], path[b]) <= reach) { if (z[path[b]] > peak) { peak = z[path[b]]; top = b; } b++; }
      if (b >= path.length || z[path[b]] > za + tol || peak - za < minPond) { a++; continue; }
      const crest = spillLevel(f, path, a, b, pad), pond = crest - za;
      if (!(pond >= minPond)) { a = b; continue; } // the water gets round it lower down
      const hump = Array.prototype.slice.call(path, a + 1, b), ck = path[top];
      if (seen.has(ck)) { a = b; continue; } // reached again from another headwater
      seen.add(ck);
      const own = (m) => meta.owner?.[m], nm = meta.names?.[own(a)] ?? meta.names?.[own(top)] ?? meta.names?.[own(b)] ?? (meta.owner ? undefined : meta.name);
      const rec = { stream: s, name: nm, kind: meta.kinds?.[own(a)] ?? meta.kind, k: ck, i: ck % nx, j: (ck / nx) | 0, foot: za, crest, pond, length: span(path[a], path[b]) - dx, road: hump.some(k => f.road?.[k]) };
      const barrel = barrelNear(hump);
      if (barrel) piped.push({ ...rec, culvert: { D: barrel.D, sized: !!barrel.sized } }); else (rec.road || pond >= natural ? closed : rises).push(rec);
      a = b;
    }
  });
  const deep = (p, q) => q.pond - p.pond;
  return { closed: closed.sort(deep), rises: rises.sort(deep), culverts: piped.sort(deep), uphill, checked };
}

/** One line for the log: how many, and the worst. '' when there is nothing to say. */
export function crossingNote(r) {
  const parts = [];
  if (r.closed.length) { const w = r.closed[0];
    parts.push(`${r.closed.length} stream crossing${r.closed.length > 1 ? 's' : ''} closed by the terrain: water must pond up to ${w.pond.toFixed(1)} m to pass${w.name ? ` (${w.name})` : ''}${w.road ? ', under a road with no mapped culvert or bridge opening' : ''}`); }
  // rises (low, no road) are most likely the bed: listed by the tool, not raised here
  const guessed = r.culverts.filter(c => !c.culvert.sized);
  if (guessed.length) { const w = guessed[0];
    parts.push(`${guessed.length} culvert${guessed.length > 1 ? 's' : ''} through a fill with no mapped size (${w.culvert.D} m assumed under ${w.pond.toFixed(1)} m of fill${w.name ? `, ${w.name}` : ''})`); }
  return parts.join(' · ');
}
