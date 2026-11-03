// Surveyed bathymetry under hydro-flattened lidar: NOAA's National Bathymetric Source BlueTopo (gridded hydrographic
// surveys of navigable waters: harbours, estuaries, tidal rivers; 2–16 m, NAVD88 in the lower 48). The regional
// hydraulic-geometry curves (src/bathymetry.js) are fitted to non-tidal alluvial streams; a dredged tidal river is
// several metres deeper than they say (the tidal Schuylkill below Fairmount Dam: surveyed to −8 m NAVD88, the curves
// carve −1.1 m). Where BlueTopo has the bed it replaces the estimate; elsewhere the estimate stays.
import { parseTiff } from './tiff.js';
import { fromUTM, toUTM } from './geo.js';

/**
 * BlueTopo bed elevations on a grid (a GridRef: zone, x0, y1, dx, nx, ny), sampled bilinearly from each tile (nearest
 * valid pixel at a coverage edge). tilesAt(bbox [w, s, e, n]) → { tiles: [{ tile, url, resolution, utm, delivered }] }
 * (the server's /api/bluetopo); fetcher(url) → Response. Tiles not on NAVD88 are left out.
 * → { z: Float32Array (NaN where none), cells, tiles: [{ tile, resolution, delivered }], skipped: [{ tile, why }] }
 */
export async function blueTopoGrid(grid, tilesAt, fetcher) {
  const { nx, ny, dx, x0, y1, zone } = grid, z = new Float32Array(nx * ny).fill(NaN);
  const corners = [[x0, y1], [x0 + nx * dx, y1], [x0, y1 - ny * dx], [x0 + nx * dx, y1 - ny * dx]].map(([x, y]) => fromUTM(x, y, zone));
  const bbox = [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))];
  const { tiles = [] } = await tilesAt(bbox), used = [], skipped = [];
  let cells = 0;
  for (const t of tiles) {
    const r = await fetcher(t.url); if (!r.ok) { skipped.push({ tile: t.tile, why: `download ${r.status}` }); continue; }
    const tif = parseTiff(await r.arrayBuffer()), g = tif.geo;
    if (!g || !/navd\s*88|5103/i.test(g.vertical ?? '')) { skipped.push({ tile: t.tile, why: `vertical datum ${g?.vertical ?? 'unknown'}, not NAVD88` }); continue; }
    const tz = g.epsg >= 26901 && g.epsg <= 26923 ? g.epsg - 26900 : g.epsg >= 32601 && g.epsg <= 32660 ? g.epsg - 32600 : Number(t.utm);
    if (!tz) { skipped.push({ tile: t.tile, why: 'not on a UTM grid' }); continue; }
    // each grid cell centre in the tile's UTM zone (NAD83 and WGS84 agree to about a metre: under a quarter pixel)
    const at = (i, j) => { const x = x0 + (i + 0.5) * dx, y = y1 - (j + 0.5) * dx; return tz === zone ? [x, y] : toUTM(...fromUTM(x, y, zone), tz); };
    const P = [at(0, 0), at(nx - 1, 0), at(0, ny - 1), at(nx - 1, ny - 1)];
    const c0 = Math.max(0, Math.floor((Math.min(...P.map(p => p[0])) - g.x0) / g.dx) - 1), c1 = Math.min(tif.width - 1, Math.ceil((Math.max(...P.map(p => p[0])) - g.x0) / g.dx) + 1);
    const r0 = Math.max(0, Math.floor((g.y0 - Math.max(...P.map(p => p[1]))) / g.dy) - 1), r1 = Math.min(tif.height - 1, Math.ceil((g.y0 - Math.min(...P.map(p => p[1]))) / g.dy) + 1);
    if (c1 < c0 || r1 < r0) continue;
    const w = c1 - c0 + 1, h = r1 - r0 + 1, v = await tif.read(c0, r0, w, h, 0);
    let n = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [x, y] = at(i, j), fx = (x - g.x0) / g.dx - 0.5 - c0, fy = (g.y0 - y) / g.dy - 0.5 - r0;
      const a = Math.floor(fx), b = Math.floor(fy), tx = fx - a, ty = fy - b;
      if (a < -1 || b < -1 || a >= w || b >= h) continue;
      const px = (p, q) => (p >= 0 && q >= 0 && p < w && q < h ? v[q * w + p] : NaN);
      const q00 = px(a, b), q10 = px(a + 1, b), q01 = px(a, b + 1), q11 = px(a + 1, b + 1);
      let val = (1 - tx) * (1 - ty) * q00 + tx * (1 - ty) * q10 + (1 - tx) * ty * q01 + tx * ty * q11;
      if (Number.isNaN(val)) val = [[q00, (1 - tx) * (1 - ty)], [q10, tx * (1 - ty)], [q01, (1 - tx) * ty], [q11, tx * ty]].filter(([q]) => !Number.isNaN(q)).sort((p, q) => q[1] - p[1])[0]?.[0] ?? NaN;
      if (Number.isNaN(val)) continue;
      const k = j * nx + i; if (Number.isNaN(z[k])) { cells++; n++; } z[k] = val;
    }
    if (n) used.push({ tile: t.tile, resolution: t.resolution, delivered: t.delivered });
  }
  return { z, cells, tiles: used, skipped };
}

/**
 * The carve below the lidar water surface with surveys in: on flattened water (water[k]) where the survey has the bed,
 * the depth to it (none where the survey is above the lidar: a bank in a coarse survey pixel); elsewhere the estimate.
 * → { dz: Float32Array, surveyed (cells), volume: { surveyed, estimated } (m³) }
 */
export function mergeSurvey(zLidar, water, survey, dzEst, cellArea) {
  const dz = Float32Array.from(dzEst); let surveyed = 0, vs = 0, ve = 0;
  for (let k = 0; k < dz.length; k++) {
    if (water[k] && !Number.isNaN(survey[k])) { dz[k] = Math.max(0, zLidar[k] - survey[k]); surveyed++; vs += dz[k] * cellArea; }
    else ve += dz[k] * cellArea;
  }
  return { dz, surveyed, volume: { surveyed: vs, estimated: ve } };
}
