// Reference flood maps: polygons of mapped peak depth, scored cell by cell against a run's peak depth on the 1 m grid.
// Two kinds:
//   depth     a depth on each polygon: USGS post-event inundation maps (Ida 2021 in New York City: the surveyed
//             high-water mark's level less the lidar ground, within 250 m of the mark), mapped only inside `mask`.
//             The USGS layers are pixel squares, about 50 MB a mark, too much to fetch in the app: benchmarks/nyc has
//             them merged into 0.25 ft bands for the Forest Hills example, with the 250 m buffers as mask features
//   classes   depth bands: NYC DEP Stormwater Flood Maps (InfoWorks ICM, 1D sewers + 2D surface): Flooding_Category
//             1 = 4 in to 1 ft, 2 = 1 ft and over (3 = future high tides, not rain: skipped); mapped everywhere
// A cell is flooded at `wet` metres and over in both (default 4 in, the DEP maps' floor). Buildings are left out.
// The scores: hit rate (mapped flooded cells the model floods), false-alarm ratio (model-flooded cells the map leaves
// dry), critical success index (hits / (hits + misses + false alarms)), the flooded area model / map, the depth band
// agreement and, for depth maps, the depth error where both are flooded.

export const FT = 0.3048;
export const DEP_CLASSES = { 1: [4 * 0.0254, FT], 2: [FT, Infinity] };

/** Polygon rings of a GeoJSON geometry: [[outer, ...holes], ...] of [lon, lat]; empty polygons dropped. */
const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).filter(p => p?.[0]?.length >= 3);

/**
 * A flood map from GeoJSON polygons. `field` holds a depth (`units` 'ft' or 'm') or a class looked up in `classes`
 * ({ value: [lo, hi] } in metres); features whose class is not listed are skipped. Features with `mask: true` are where
 * the map was made (it says nothing elsewhere); without any, it covers the whole area. → { kind, name, polys, mask }
 */
export function fromGeoJSONMap(gj, { field, units = 'm', classes = null, name = 'imported flood map' } = {}) {
  const polys = [], mask = [];
  for (const f of gj.features || []) {
    if (f.properties?.mask === true) { mask.push(...polysOf(f.geometry)); continue; }
    const v = f.properties?.[field];
    if (classes) { const c = classes[v]; if (!c) continue; for (const rings of polysOf(f.geometry)) polys.push({ rings, band: c }); }
    else if (Number.isFinite(+v)) for (const rings of polysOf(f.geometry)) polys.push({ rings, depth: +v * (units === 'ft' ? FT : 1) });
  }
  return { kind: classes ? 'classes' : 'depth', name, polys, mask: mask.length ? mask : null };
}

/**
 * Fill polygons onto an nx × ny grid: cell (i, j) is inside when its centre is (even-odd per polygon, holes cut out).
 * toCell([lon, lat]) → [ci, cj] in cell units (cell centres at +0.5). value(p) is written for each polygon, in order.
 */
export function rasterize(polys, nx, ny, toCell, out, value = () => 1) {
  for (const p of polys) {
    const rings = (p.rings ?? p).map(r => r.map(toCell)), v = value(p);
    let j0 = Infinity, j1 = -Infinity;
    for (const [, y] of rings[0]) { if (y < j0) j0 = y; if (y > j1) j1 = y; }
    j0 = Math.max(0, Math.floor(j0)); j1 = Math.min(ny - 1, Math.ceil(j1));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const y = j + 0.5; xs.length = 0;
      for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, ya] = r[a], [xb, yb] = r[b];
        if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya));
      }
      xs.sort((u, w) => u - w);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(nx - 1, Math.floor(xs[k + 1] - 0.5));
        for (let i = i0; i <= i1; i++) out[j * nx + i] = v;
      }
    }
  }
  return out;
}

/** Drop 4-connected patches of `wet` (Uint8Array) smaller than `minCells`, in place. → cells dropped */
export function dropSmall(wet, nx, ny, minCells) {
  if (!(minCells > 1)) return 0;
  const seen = new Uint8Array(wet.length), stack = new Int32Array(wet.length), patch = [];
  let dropped = 0;
  for (let k0 = 0; k0 < wet.length; k0++) {
    if (!wet[k0] || seen[k0]) continue;
    let top = 0; stack[top++] = k0; seen[k0] = 1; patch.length = 0;
    while (top) {
      const k = stack[--top]; patch.push(k);
      const i = k % nx, j = (k / nx) | 0;
      if (i > 0 && wet[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack[top++] = k - 1; }
      if (i < nx - 1 && wet[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack[top++] = k + 1; }
      if (j > 0 && wet[k - nx] && !seen[k - nx]) { seen[k - nx] = 1; stack[top++] = k - nx; }
      if (j < ny - 1 && wet[k + nx] && !seen[k + nx]) { seen[k + nx] = 1; stack[top++] = k + nx; }
    }
    if (patch.length < minCells) { for (const k of patch) wet[k] = 0; dropped += patch.length; }
  }
  return dropped;
}

/**
 * Score a run's peak depth against a reference map.
 * @param ref    fetchUsgsInundation / fromGeoJSONMap result
 * @param grid   { nx, ny, dx, toCell, depth (peak depth per cell, m), exclude? (Uint8Array, 1 = leave out: buildings) }
 * @param o      { wet = 4 in, minArea = 0 (m²: model patches smaller than this are not counted, as on the DEP maps),
 *                 bands (m edges for the depth-band table; the classes' own for a class map) }
 * @returns { name, kind, cells, mapped, modelWet, hits, misses, falseAlarms, hitRate, falseAlarmRatio, csi, areaRatio,
 *            bands: [{ lo, hi, cells, modelSame, modelLower, modelHigher, modelMean }], depth: { n, bias, rmse, mae } | null }
 */
export function scoreFloodMap(ref, grid, o = {}) {
  const { nx, ny, dx, toCell, depth, exclude } = grid, N = nx * ny;
  const wet = o.wet ?? 4 * 0.0254, minCells = Math.round((o.minArea ?? 0) / (dx * dx));
  // where the map says anything: its mask, or the whole grid
  const inMap = ref.mask ? rasterize(ref.mask, nx, ny, toCell, new Uint8Array(N)) : new Uint8Array(N).fill(1);
  // the map's depth per cell (NaN: not flooded on the map); a band map stores the band's lower edge and keeps its index
  const refD = new Float64Array(N).fill(NaN), refBand = new Int8Array(N).fill(-1);
  const bandList = ref.kind === 'classes' ? [...new Map(ref.polys.map(p => [p.band.join(), p.band])).values()].sort((a, b) => a[0] - b[0]) : null;
  if (ref.kind === 'classes') {
    for (const [bi, band] of bandList.entries()) rasterize(ref.polys.filter(p => p.band === band || p.band.join() === band.join()), nx, ny, toCell, refBand, () => bi);
    for (let k = 0; k < N; k++) if (refBand[k] >= 0) refD[k] = bandList[refBand[k]][0];
  } else rasterize(ref.polys, nx, ny, toCell, refD, (p) => p.depth);
  const mWet = new Uint8Array(N);
  for (let k = 0; k < N; k++) mWet[k] = inMap[k] && !exclude?.[k] && depth[k] >= wet ? 1 : 0;
  const dropped = dropSmall(mWet, nx, ny, minCells);
  const be = o.bands ?? [wet, FT, 2 * FT, 3 * FT, Infinity], edges = bandList ?? be.slice(0, -1).map((lo, i) => [lo, be[i + 1]]);
  const bands = edges.map(([lo, hi]) => ({ lo, hi, cells: 0, modelSame: 0, modelLower: 0, modelHigher: 0, sum: 0 }));
  const bandOf = (d) => edges.findIndex(([lo, hi]) => d >= lo && d < hi);
  let cells = 0, mapped = 0, modelWet = 0, hits = 0, misses = 0, fa = 0, n = 0, se = 0, sa = 0, sb = 0;
  for (let k = 0; k < N; k++) {
    if (!inMap[k] || exclude?.[k]) continue;
    cells++;
    const r = refD[k] >= wet, m = mWet[k] === 1;
    if (r) mapped++; if (m) modelWet++;
    if (r && m) hits++; else if (r) misses++; else if (m) fa++;
    if (r) {
      const bi = ref.kind === 'classes' ? refBand[k] : bandOf(refD[k]); if (bi < 0) continue;
      const b = bands[bi], md = m ? depth[k] : 0, mb = m ? bandOf(md) : -1;
      b.cells++; b.sum += md; if (mb === bi) b.modelSame++; else if (mb < bi) b.modelLower++; else b.modelHigher++;
      if (ref.kind === 'depth' && m) { const e = depth[k] - refD[k]; n++; se += e * e; sa += Math.abs(e); sb += e; }
    }
  }
  const div = (a, b) => (b > 0 ? a / b : null);
  return {
    name: ref.name, kind: ref.kind, wet, cells, mapped, modelWet, dropped, hits, misses, falseAlarms: fa,
    hitRate: div(hits, hits + misses), falseAlarmRatio: div(fa, hits + fa), csi: div(hits, hits + misses + fa), areaRatio: div(modelWet, mapped),
    area: { mapped: mapped * dx * dx, model: modelWet * dx * dx },
    bands: bands.map(({ sum, ...b }) => ({ ...b, modelMean: div(sum, b.cells) })),
    depth: n ? { n, bias: sb / n, rmse: Math.sqrt(se / n), mae: sa / n } : null,
  };
}
