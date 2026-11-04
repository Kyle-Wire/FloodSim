// Uncertainty bands from a small ensemble: the base run and its batch variants (src/batch.js VARIANTS: roughness ± 20 %,
// infiltration × 0.5, one cell size coarser, rain + 10 % on a design storm), each scored against the same observations.
// The spread of the members at a mark is the band that inputs this app cannot pin down leave there. An observation
// inside the band is one the model reaches with plausible inputs; one outside it points at something no variant moves
// (the channel, an edge, the rain, the DEM). This is a sensitivity band, one input at a time and a handful of members,
// not a probability: it says how far the inputs can move the answer, not how likely each answer is.

/**
 * Marks against the members' band. members: [{ key, label, points }] with points as a run record keeps them
 * (validation.hwm.points: { name, lon, lat, kind, observed, model, error }), the base first. A mark counts when every
 * member scored it with a level or a depth. → { members: [key], n, inside, share, meanWidth, maxWidth,
 * rows: [{ name, kind, observed, base, lo, hi, width, inside, below (the observation lies above the band), by: { key: model } }],
 * drivers: [{ key, label, meanShift (m, member − base, signed), meanAbs }] (largest first) } or null without two members.
 */
export function markBands(members, { tol = 0 } = {}) {
  const ms = members.filter(m => m?.points?.length); if (ms.length < 2) return null;
  const id = (p) => `${p.name}|${p.lon?.toFixed?.(6)}|${p.lat?.toFixed?.(6)}`;
  const maps = ms.map(m => new Map(m.points.filter(p => p.error != null && p.model != null && (p.kind === 'level' || p.kind === 'depth')).map(p => [id(p), p])));
  const rows = [];
  for (const [k, p0] of maps[0]) {
    const ps = maps.map(m => m.get(k)); if (ps.some(p => !p)) continue;
    const vals = ps.map(p => p.model), lo = Math.min(...vals), hi = Math.max(...vals), obs = p0.observed;
    rows.push({ name: p0.name, kind: p0.kind, observed: obs, base: p0.model, lo, hi, width: hi - lo, inside: obs >= lo - tol && obs <= hi + tol, below: obs > hi + tol,
      by: Object.fromEntries(ms.map((m, i) => [m.key, vals[i]])) });
  }
  if (!rows.length) return { members: ms.map(m => m.key), n: 0, inside: 0, share: null, meanWidth: null, maxWidth: null, rows, drivers: [] };
  const inside = rows.filter(r => r.inside).length;
  const drivers = ms.slice(1).map(m => {
    const d = rows.map(r => r.by[m.key] - r.base);
    return { key: m.key, label: m.label ?? m.key, meanShift: d.reduce((a, b) => a + b, 0) / d.length, meanAbs: d.reduce((a, b) => a + Math.abs(b), 0) / d.length };
  }).sort((a, b) => b.meanAbs - a.meanAbs);
  return { members: ms.map(m => m.key), n: rows.length, inside, share: inside / rows.length, meanWidth: rows.reduce((a, r) => a + r.width, 0) / rows.length,
    maxWidth: Math.max(...rows.map(r => r.width)), rows, drivers };
}

/**
 * Flood-map scores across the members: members [{ key, floodMaps }] (validation.floodMaps, src/floodmaps.js scores).
 * → [{ name, observed, base: { hitRate, csi }, hitRate: [lo, hi], csi: [lo, hi], areaRatio: [lo, hi] }] for each map the base scored.
 */
export function mapBands(members) {
  const ms = members.filter(m => m?.floodMaps?.length); if (ms.length < 2) return [];
  const span = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
  return ms[0].floodMaps.map(b => {
    const all = ms.map(m => m.floodMaps.find(x => x.name === b.name)).filter(Boolean);
    return { name: b.name, observed: b.observed !== false, members: all.length, base: { hitRate: b.hitRate, csi: b.csi },
      hitRate: span(all.map(x => x.hitRate)), csi: span(all.map(x => x.csi)), areaRatio: span(all.map(x => x.areaRatio)) };
  });
}

/** Cells flooded (peak depth ≥ wet) in how many of the members: depths [Float32Array], one per member → Uint8Array counts. */
export function wetAgreement(depths, wet = 0.15, exclude = null) {
  const N = depths[0].length, out = new Uint8Array(N);
  for (const d of depths) for (let k = 0; k < N; k++) if (d[k] >= wet && !exclude?.[k]) out[k]++;
  return out;
}
