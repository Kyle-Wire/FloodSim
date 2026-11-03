// HEC-RAS handoff, both ways.
//   export   a HEC-RAS 2D package from a built model: the terrain FloodSim ran on (channel bathymetry carved, the curb
//            burn in) as a GeoTIFF on NAD83 / UTM + NAVD88, buildings raised in a second terrain and as polygons, land
//            cover classes with their Manning's n, the 2D flow area perimeter, boundary-condition lines (river inflow,
//            the observed tide, normal-depth outflow) with their series, breaklines along barriers and channel banks,
//            the rain as a hyetograph (and the radar grid as GeoTIFFs), and a README of the RAS Mapper steps. RAS
//            builds its own terrain (.hdf) and mesh from these; nothing here writes RAS's binary or plan files.
//   import   cross-sections of an effective 1D model (.g01 geometry text) interpolated into a channel bed under the
//            hydro-flattened water, the way RAS Mapper interpolates between sections: along the reach from one section
//            to the next, across it by normalised station between matching zones (left overbank, channel between the
//            bank stations, right overbank). Used under BlueTopo's surveys and over the regional-curve estimate.
import { writeGeoTiff } from './tiff-write.js';
import { writeShapefile, prjUTM, PRJ_WGS84 } from './shapefile.js';

// ------------------------------------------------------------------ geometry file (.g01)

/** Fixed-width numbers of a RAS data line (`w` characters each; RAS lets them run together, so never split on spaces). */
function fixed(line, w) {
  const out = [];
  for (let i = 0; i < line.length; i += w) { const s = line.slice(i, i + w).trim(); if (s !== '') out.push(Number(s)); }
  return out;
}
/** `count` numbers from the lines after `i`, `w` characters each. → [values, next line index] */
function block(lines, i, count, w) {
  const v = [];
  while (v.length < count && i < lines.length) { const nums = fixed(lines[i].replace(/\r$/, ''), w); if (nums.some(Number.isNaN)) break; v.push(...nums); i++; }
  return [v.slice(0, count), i];
}

/**
 * Parse a HEC-RAS geometry file. → { title, reaches: [{ river, reach, xy: [[x, y]], xs: [{ rm, cut: [[x, y]],
 * se: [[station, elevation]], banks: [left, right] }] }], skipped: { structures, noCutLine } }
 * Only cross-sections (Type RM … = 1); bridges, culverts and inline / lateral structures are counted and left out.
 * Coordinates and numbers are as written (the project's units; the projection is the RAS Mapper one).
 */
export function parseGeometry(text) {
  const lines = text.split('\n'), reaches = [], skipped = { structures: 0, noCutLine: 0 };
  let title = '', reach = null, xs = null;
  const done = () => { if (xs) { if (xs.cut.length >= 2 && xs.se.length >= 2) reach.xs.push(xs); else skipped.noCutLine++; } xs = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, ''), [k0, ...rest] = l.split('='), key = k0.trim(), val = rest.join('=');
    if (key === 'Geom Title') title = val.trim();
    else if (key === 'River Reach') { done(); const [river, rch] = val.split(','); reach = { river: river.trim(), reach: (rch ?? '').trim(), xy: [], xs: [] }; reaches.push(reach); }
    else if (key === 'Reach XY' && reach) { const n = parseInt(val, 10); const [v, j] = block(lines, i + 1, 2 * n, 16); reach.xy = pairs(v); i = j - 1; }
    else if (key === 'Type RM Length L Ch R' && reach) {
      done(); const f = val.split(',').map(s => s.trim());
      if (Number(f[0]) === 1) xs = { rm: f[1], cut: [], se: [], banks: null }; else skipped.structures++;
    } else if (key === 'XS GIS Cut Line' && xs) { const n = parseInt(val, 10); const [v, j] = block(lines, i + 1, 2 * n, 16); xs.cut = pairs(v); i = j - 1; }
    else if (key === '#Sta/Elev' && xs) { const n = parseInt(val, 10); const [v, j] = block(lines, i + 1, 2 * n, 8); xs.se = pairs(v); i = j - 1; }
    else if (key === 'Bank Sta' && xs) xs.banks = val.split(',').map(Number);
  }
  done();
  for (const r of reaches) for (const x of r.xs) if (!x.banks || x.banks.some(v => !Number.isFinite(v))) x.banks = [x.se[0][0], x.se.at(-1)[0]];
  return { title, reaches: reaches.filter(r => r.xs.length), skipped };
}
const pairs = (v) => { const p = []; for (let k = 0; k + 1 < v.length; k += 2) p.push([v[k], v[k + 1]]); return p; };

/** Units and title of a RAS project file (.prj: "Proj Title=", "English Units" / "SI Units"), or null when the text is not one. */
export function parseProject(text) {
  if (!/^Proj Title=/m.test(text)) return null;
  return { title: (text.match(/^Proj Title=(.*)$/m)?.[1] ?? '').trim(), units: /^SI Units/m.test(text) ? 'SI' : 'US' };
}

// ------------------------------------------------------------------ cross-sections → bed on a grid

/** Point at distance d along a polyline (clamped). */
function along(line, cum, d) {
  if (d <= 0) return line[0]; if (d >= cum.at(-1)) return line.at(-1);
  let a = 0, b = cum.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (cum[m] <= d) a = m; else b = m; }
  const t = (d - cum[a]) / (cum[b] - cum[a] || 1); return [line[a][0] + t * (line[b][0] - line[a][0]), line[a][1] + t * (line[b][1] - line[a][1])];
}
const cumLen = (line) => { const c = [0]; for (let i = 1; i < line.length; i++) c.push(c[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])); return c; };
/** Linear interpolation of a station–elevation profile at station s (clamped to its ends). */
function elevAt(se, s) {
  if (s <= se[0][0]) return se[0][1]; if (s >= se.at(-1)[0]) return se.at(-1)[1];
  let a = 0, b = se.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (se[m][0] <= s) a = m; else b = m; }
  return se[a][1] + (se[b][1] - se[a][1]) * (s - se[a][0]) / (se[b][0] - se[a][0] || 1);
}

/**
 * Bed elevations on a grid from parsed cross-sections. grid: { nx, ny } with cell (i, j) centre at (i + 0.5, j + 0.5);
 * toGrid(x, y) → [i, j] (fractional grid coordinates of a file coordinate); zScale (file elevation units → m) and zShift
 * (m, e.g. NGVD29 → NAVD88). Stations are stretched onto each cut line's length, as RAS Mapper does. Between successive
 * sections of a reach each zone is cut into strips at matching normalised stations; each strip is a quad, and a cell
 * centre inside it takes (1 − u)·z₁(η) + u·z₂(η) (u along the reach, η across the zone, from the inverse bilinear map).
 * → { z: Float32Array (NaN where no section pair covers the cell), cells, pairs, sections }
 */
export function xsBed(geom, grid, toGrid, { zScale = 1, zShift = 0, strip = 1 } = {}) {
  const { nx, ny } = grid, z = new Float32Array(nx * ny).fill(NaN);
  let cells = 0, nPairs = 0, sections = 0;
  const prep = (x) => {
    const cut = x.cut.map(([a, b]) => toGrid(a, b)), cum = cumLen(cut), s0 = x.se[0][0], s1 = x.se.at(-1)[0], L = cum.at(-1);
    const bl = Math.min(Math.max(x.banks[0], s0), s1), br = Math.min(Math.max(x.banks[1], bl), s1);
    const pos = (s) => along(cut, cum, (s - s0) / (s1 - s0 || 1) * L), zone = [[s0, bl], [bl, br], [br, s1]];
    return { pos, zone, el: (s) => elevAt(x.se, s) * zScale + zShift, width: (k) => (zone[k][1] - zone[k][0]) / (s1 - s0 || 1) * L };
  };
  for (const r of geom.reaches) {
    const P = r.xs.map(prep); sections += P.length;
    for (let m = 0; m + 1 < P.length; m++) {
      const A = P[m], B = P[m + 1]; nPairs++;
      for (let k = 0; k < 3; k++) {
        const n = Math.min(400, Math.max(1, Math.ceil(Math.max(A.width(k), B.width(k)) / strip)));
        if (A.zone[k][1] <= A.zone[k][0] && B.zone[k][1] <= B.zone[k][0]) continue;
        const sA = (e) => A.zone[k][0] + e * (A.zone[k][1] - A.zone[k][0]), sB = (e) => B.zone[k][0] + e * (B.zone[k][1] - B.zone[k][0]);
        for (let q = 0; q < n; q++) {
          const ea = q / n, eb = (q + 1) / n;
          const p00 = A.pos(sA(ea)), p01 = A.pos(sA(eb)), p10 = B.pos(sB(ea)), p11 = B.pos(sB(eb));
          const i0 = Math.max(0, Math.floor(Math.min(p00[0], p01[0], p10[0], p11[0]) - 0.5)), i1 = Math.min(nx - 1, Math.ceil(Math.max(p00[0], p01[0], p10[0], p11[0]) - 0.5));
          const j0 = Math.max(0, Math.floor(Math.min(p00[1], p01[1], p10[1], p11[1]) - 0.5)), j1 = Math.min(ny - 1, Math.ceil(Math.max(p00[1], p01[1], p10[1], p11[1]) - 0.5));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const kk = j * nx + i; if (!Number.isNaN(z[kk])) continue;
            const uv = invBilinear(i + 0.5, j + 0.5, p00, p10, p01, p11); if (!uv) continue;
            const e = ea + uv[1] * (eb - ea), u = uv[0];
            z[kk] = (1 - u) * A.el(sA(e)) + u * B.el(sB(e)); cells++;
          }
        }
      }
    }
  }
  return { z, cells, pairs: nPairs, sections };
}

/** (u, v) with p = (1−u)(1−v)·p00 + u(1−v)·p10 + (1−u)v·p01 + uv·p11, inside the quad (Newton), or null. */
export function invBilinear(x, y, p00, p10, p01, p11) {
  let u = 0.5, v = 0.5;
  for (let it = 0; it < 12; it++) {
    const fx = (1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0] + (1 - u) * v * p01[0] + u * v * p11[0] - x;
    const fy = (1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1] + (1 - u) * v * p01[1] + u * v * p11[1] - y;
    const xu = (1 - v) * (p10[0] - p00[0]) + v * (p11[0] - p01[0]), yu = (1 - v) * (p10[1] - p00[1]) + v * (p11[1] - p01[1]);
    const xv = (1 - u) * (p01[0] - p00[0]) + u * (p11[0] - p10[0]), yv = (1 - u) * (p01[1] - p00[1]) + u * (p11[1] - p10[1]);
    const det = xu * yv - xv * yu; if (Math.abs(det) < 1e-12) return null;
    const du = (fx * yv - fy * xv) / det, dv = (fy * xu - fx * yu) / det; u -= du; v -= dv;
    if (Math.abs(du) + Math.abs(dv) < 1e-10) break;
  }
  const e = 1e-6;
  return u >= -e && u <= 1 + e && v >= -e && v <= 1 + e ? [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))] : null;
}

/**
 * The bed sources in order of trust, per cell: BlueTopo's survey, then the cross-sections. survey, xs: Float32Array
 * (NaN where none) or null. → { z (NaN where neither), cells, fromXS (cells the cross-sections supply) }
 */
export function layerBeds(survey, xs, n) {
  const z = new Float32Array(n).fill(NaN); let cells = 0, fromXS = 0;
  for (let k = 0; k < n; k++) {
    const s = survey ? survey[k] : NaN, x = xs ? xs[k] : NaN;
    if (!Number.isNaN(s)) { z[k] = s; cells++; } else if (!Number.isNaN(x)) { z[k] = x; cells++; fromXS++; }
  }
  return { z, cells, fromXS };
}

// ------------------------------------------------------------------ lines from rasters

/**
 * Outline of a cell mask as polylines in grid-corner coordinates ([[i, j]], j down), simplified (Douglas–Peucker,
 * `tol` cells) and without the pieces shorter than `minLen` cells. The banks of a carved channel, for breaklines.
 */
export function maskOutline(mask, nx, ny, { tol = 1, minLen = 10 } = {}) {
  const at = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i];
  const next = new Map(), key = (i, j) => j * (nx + 1) + i; // directed boundary edges, the mask on the left
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) add(next, key(i + 1, j), key(i, j));
    if (!at(i, j + 1)) add(next, key(i, j + 1), key(i + 1, j + 1));
    if (!at(i - 1, j)) add(next, key(i, j), key(i, j + 1));
    if (!at(i + 1, j)) add(next, key(i + 1, j + 1), key(i + 1, j));
  }
  const out = [], pt = (q) => [q % (nx + 1), Math.floor(q / (nx + 1))];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const line = [pt(start)]; let q = start;
      while (next.get(q)?.length) { const r = next.get(q).pop(); line.push(pt(r)); q = r; if (q === start) break; }
      const s = simplify(line, tol); let L = 0; for (let m = 1; m < s.length; m++) L += Math.hypot(s[m][0] - s[m - 1][0], s[m][1] - s[m - 1][1]);
      if (L >= minLen) out.push(s);
    }
  }
  return out;
}
function add(map, a, b) { const l = map.get(a); if (l) l.push(b); else map.set(a, [b]); }
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let dm = 0, im = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay);
    for (let m = a + 1; m < b; m++) { const d = L ? Math.abs((bx - ax) * (ay - pts[m][1]) - (ax - pts[m][0]) * (by - ay)) / L : Math.hypot(pts[m][0] - ax, pts[m][1] - ay); if (d > dm) { dm = d; im = m; } }
    if (dm > tol && im > 0) { keep[im] = 1; st.push([a, im], [im, b]); }
  }
  return pts.filter((_, m) => keep[m]);
}

/** Contiguous runs of edge cells (solver grid) grouped by side → [{ side, a, b }] (a..b along the side, cell units). */
export function edgeRuns(cells, nx, ny) {
  const by = { north: [], south: [], west: [], east: [] };
  for (const k of cells) {
    const i = k % nx, j = (k / nx) | 0;
    if (j === 0) by.north.push(i); else if (j === ny - 1) by.south.push(i); else if (i === 0) by.west.push(j); else if (i === nx - 1) by.east.push(j);
  }
  const out = [];
  for (const [side, v] of Object.entries(by)) {
    v.sort((p, q) => p - q);
    for (let m = 0; m < v.length; m++) { if (m && v[m] === v[m - 1] + 1) out.at(-1).b = v[m]; else out.push({ side, a: v[m], b: v[m] }); }
  }
  return out;
}
/** A run along a side as a line in grid-corner coordinates (cells of size F; the side's outer edge). */
export function runLine({ side, a, b }, nx, ny) {
  if (side === 'north') return [[a, 0], [b + 1, 0]];
  if (side === 'south') return [[b + 1, ny], [a, ny]];
  if (side === 'west') return [[0, b + 1], [0, a]];
  return [[nx, a], [nx, b + 1]];
}

// ------------------------------------------------------------------ the export package

/**
 * Files of the HEC-RAS 2D package. inp:
 *   grid { zone, x0, y1, dx, nx, ny }     the 1 m terrain grid (row 0 north)
 *   z, bld, bldH, cls, road, manning      terrain the model ran on, building mask and heights, NLCD class, road mask, n
 *   nTable { [class]: n }, nRoad          Manning's n by class (FloodSim's table, calibration applied)
 *   perimeter [[x, y]] (UTM, closed)      the 2D flow area
 *   bcs [{ name, kind: 'flow' | 'stage' | 'normal', line: [[x, y]], series: [[t_s, v]] | null, slope, note }]
 *   breaklines [{ name, kind, line }], buildings [{ ring: [[x, y]], height }], inflowPoints [{ name, x, y, series }]
 *   rain { t0 (ms), blockMin, depth: [mm] }, radar [{ t0 (ms), minutes, mm: Float32Array, win: { nx, ny, lon0, lat0, step } }]
 *   meta { …, start (ms), end (ms), units notes }
 * → Promise<[{ name, data: Uint8Array }]>
 */
export async function rasPackage(inp) {
  const { grid: g } = inp, files = [], enc = new TextEncoder(), epsg = 26900 + g.zone, prj = prjUTM(g.zone), N = g.nx * g.ny;
  const tif = (data, o = {}) => writeGeoTiff({ width: g.nx, height: g.ny, data, x0: g.x0, y0: g.y1, dx: g.dx, epsg, ...o });
  const txt = (name, s) => files.push({ name, data: enc.encode(s) });
  const cite = `NAD83 / UTM zone ${g.zone}N + NAVD88 height (FloodSim)`;
  // terrain
  files.push({ name: 'terrain/terrain_model.tif', data: await tif(Float32Array.from(inp.z), { vertical: 'NAVD88', citation: cite }) });
  const zb = new Float32Array(N); for (let k = 0; k < N; k++) zb[k] = inp.z[k] + (inp.bld[k] ? Math.max(3, inp.bldH?.[k] || 9) : 0);
  files.push({ name: 'terrain/terrain_buildings_raised.tif', data: await tif(zb, { vertical: 'NAVD88', citation: cite }) });
  // land cover: NLCD classes, roads 254, buildings 255; and n per pixel as FloodSim used it
  const lc = new Uint8Array(N); for (let k = 0; k < N; k++) lc[k] = inp.bld[k] ? 255 : inp.road?.[k] ? 254 : (inp.cls?.[k] ?? 0);
  files.push({ name: 'landcover/landcover.tif', data: await tif(lc, { nodata: 0, citation: 'NLCD classes; 254 OSM road, 255 building (FloodSim)' }) });
  files.push({ name: 'landcover/mannings_n.tif', data: await tif(Float32Array.from(inp.manning), { citation: "Manning's n as FloodSim ran" }) });
  const seen = new Set(lc), names = inp.classNames ?? {};
  const rows = [...seen].filter(v => v).sort((a, b) => a - b).map(v => [v, v === 254 ? 'Road (OSM)' : v === 255 ? 'Building' : names[v] ?? `NLCD ${v}`,
    v === 254 ? inp.nRoad : v === 255 ? 10 : inp.nTable[v] ?? 0.045]);
  txt('landcover/landcover_classes.csv', 'ID,Name,ManningsN\n' + rows.map(([v, n, m]) => `${v},"${n}",${m.toFixed(3)}`).join('\n') + '\n');
  // GIS layers (UTM metres)
  const shp = (base, kind, recs) => { const s = writeShapefile(kind, recs, { prj }); for (const ext of ['shp', 'shx', 'dbf', 'prj']) files.push({ name: `${base}.${ext}`, data: s[ext] }); };
  shp('gis/perimeter', 'polygon', [{ coords: [inp.perimeter], props: { name: '2D Area 1' } }]);
  shp('gis/bc_lines', 'line', inp.bcs.map(b => ({ coords: b.line, props: { name: b.name, bc_type: { flow: 'Flow Hydrograph', stage: 'Stage Hydrograph', normal: 'Normal Depth' }[b.kind], slope: b.slope ?? null, series: b.series ? `boundary/${slug(b.name)}.csv` : '', note: b.note ?? '' } })));
  if (inp.breaklines.length) shp('gis/breaklines', 'line', inp.breaklines.map(b => ({ coords: b.line, props: { name: b.name, kind: b.kind } })));
  if (inp.buildings?.length) shp('gis/buildings', 'polygon', inp.buildings.map(b => ({ coords: [b.ring], props: { height_m: b.height ?? null } })));
  if (inp.inflowPoints?.length) shp('gis/internal_inflows', 'point', inp.inflowPoints.map(p => ({ coords: [p.x, p.y], props: { name: p.name, series: `boundary/${slug(p.name)}.csv` } })));
  txt('gis/projection.prj', prj);
  // boundary series: SI and US columns
  const t0 = inp.meta.start, iso = (ms) => new Date(ms).toISOString().replace('.000', '');
  for (const b of [...inp.bcs.filter(b => b.series), ...(inp.inflowPoints ?? [])]) {
    const flow = b.kind !== 'stage';
    txt(`boundary/${slug(b.name)}.csv`, (flow ? 'time_utc,hours,flow_m3s,flow_cfs\n' : 'time_utc,hours,stage_m_navd88,stage_ft_navd88\n') +
      b.series.map(([t, v]) => `${iso(t0 + t * 1000)},${(t / 3600).toFixed(4)},${v.toFixed(3)},${(flow ? v / 0.028316846592 : v / 0.3048).toFixed(3)}`).join('\n') + '\n');
  }
  // rain
  if (inp.rain) {
    let cum = 0; const r = inp.rain;
    txt('precip/hyetograph.csv', 'time_utc_end,hours_end,depth_mm,depth_in,intensity_mm_hr,cumulative_mm\n' + r.depth.map((d, i) => { cum += d; const te = (i + 1) * r.blockMin * 60;
      return `${iso(r.t0 + te * 1000)},${(te / 3600).toFixed(4)},${d.toFixed(3)},${(d / 25.4).toFixed(4)},${(d * 60 / r.blockMin).toFixed(2)},${cum.toFixed(2)}`; }).join('\n') + '\n');
  }
  if (inp.radar?.length) {
    const idx = ['file,start_utc,end_utc,minutes'];
    for (const f of inp.radar) {
      const name = `precip/grid/precip_${new Date(f.t0).toISOString().slice(0, 16).replace(/[-:]/g, '')}Z.tif`;
      files.push({ name, data: await writeGeoTiff({ width: f.win.nx, height: f.win.ny, data: f.mm, x0: f.win.lon0, y0: f.win.lat0, dx: f.win.step, epsg: 4326, citation: `NOAA MRMS rain, mm per ${f.minutes} min` }) });
      idx.push(`${name.slice(7)},${iso(f.t0)},${iso(f.t0 + f.minutes * 60e3)},${f.minutes}`);
    }
    txt('precip/grid/index.csv', idx.join('\n') + '\n');
    txt('precip/grid/grid.prj', PRJ_WGS84);
  }
  txt('hecras_package.json', JSON.stringify({ ...inp.meta, startUTC: iso(inp.meta.start), endUTC: iso(inp.meta.end), crs: `EPSG:${epsg} (NAD83 / UTM zone ${g.zone}N), NAVD88 height (EPSG:5703), metres`,
    terrainGrid: { nx: g.nx, ny: g.ny, dx: g.dx, northWest: [g.x0, g.y1] }, boundaries: inp.bcs.map(b => ({ name: b.name, kind: b.kind, slope: b.slope ?? null, note: b.note ?? null, points: b.line.length })),
    landCover: rows.map(([id, name, n]) => ({ id, name, n })) }, null, 2));
  txt('README_HEC-RAS.txt', rasReadme(inp, rows));
  return files;
}
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'series';

/** The RAS Mapper steps for this package. */
export function rasReadme(inp, classes) {
  const m = inp.meta, g = inp.grid, kinds = { flow: 'Flow Hydrograph', stage: 'Stage Hydrograph', normal: 'Normal Depth' };
  const bcs = inp.bcs.map(b => `    ${b.name.padEnd(34)} ${kinds[b.kind].padEnd(17)} ${b.series ? 'boundary/' + slug(b.name) + '.csv' : `friction slope ${b.slope?.toFixed(4)}`}${b.note ? '  (' + b.note + ')' : ''}`).join('\n');
  return `FloodSim -> HEC-RAS 2D package
==============================
${m.title ?? ''}
Exported ${new Date().toISOString().slice(0, 16)}Z by FloodSim (commit ${m.commit ?? '?'}). Simulation window ${new Date(m.start).toISOString().slice(0, 16)}Z to ${new Date(m.end).toISOString().slice(0, 16)}Z.

Coordinate system: NAD83 / UTM zone ${g.zone}N (EPSG:${26900 + g.zone}), metres; elevations NAVD88 metres.
FloodSim computes UTM on the WGS84 ellipsoid from 3DEP's NAD83 lon/lat; the two agree to about a metre, under a
terrain pixel. Everything here is in metres: in a US Customary RAS project, convert on import (below).

What is here
  terrain/terrain_model.tif            the ground FloodSim ran on, ${g.dx} m: 3DEP lidar, the channel bathymetry carved
                                       below the hydro-flattened water${m.bathy ? ` (${m.bathy})` : ' (none: the lidar surface)'}, streets
                                       burned ${m.curb ? m.curb * 100 + ' cm' : 'not at all'}${m.scenario ? `, the site design "${m.scenario}" graded in` : ''}
  terrain/terrain_buildings_raised.tif the same with building footprints raised by their height (min 3 m)
  gis/buildings.*                      the footprints, if you would rather cut them out of the mesh or raise n
  landcover/landcover.tif              NLCD class per pixel; 254 = OSM street, 255 = building
  landcover/landcover_classes.csv      ID, name and Manning's n as FloodSim used them${m.nCal && m.nCal !== 1 ? ` (calibrated x ${m.nCal})` : ''}
  landcover/mannings_n.tif             n per pixel as the model ran (for checking the land cover layer)
  gis/perimeter.*                      the 2D flow area
  gis/bc_lines.*                       boundary-condition lines (attributes name, bc_type, slope, series)
  gis/breaklines.*                     barriers and the banks of the carved channel
  boundary/*.csv                       each BC line's series, UTC and hours from the start, SI and US columns
  precip/hyetograph.csv                the rain over the area, ${inp.rain?.blockMin ?? '-'} min blocks${inp.radar?.length ? `
  precip/grid/*.tif                    the radar rain grid (NOAA MRMS, lon/lat, mm per interval) and index.csv` : ''}
  hecras_package.json                  all of the above as data

Boundary conditions
${bcs || '    (none)'}
${inp.inflowPoints?.length ? `  Rivers entering inside the area (not across its edge): gis/internal_inflows.* with their series. In RAS 6.x,
  draw an internal boundary condition line across the channel there and give it the Flow Hydrograph.\n` : ''}
Steps in HEC-RAS 6.x (RAS Mapper)
  1. New project; units SI (the package is metric) or US Customary (convert in steps 3 and 7).
  2. RAS Mapper > Tools > Set Projection for Project > gis/projection.prj.
  3. Terrains > Create a New RAS Terrain > add terrain/terrain_model.tif (or the buildings-raised one). For a US
     Customary project set the vertical conversion to 3.28084 (m -> ft).
  4. Map Layers > Land Cover > Create a New Land Cover Layer > landcover/landcover.tif, then enter Manning's n from
     landcover/landcover_classes.csv (by ID). Associate it with the geometry (Geometry > Associations).
  5. New geometry > 2D Flow Areas > Perimeters > import gis/perimeter.shp (Edit > Import Features). Pick a cell size
     (FloodSim ran at ${m.solverDx ?? g.dx} m); add gis/breaklines.shp as breaklines, with a finer spacing along the channel banks.
  6. Boundary Condition Lines > import gis/bc_lines.shp; name each line from its "name" attribute.
  7. Unsteady Flow Data: for each BC line its type (bc_type) and series (boundary/*.csv: paste the SI or US column;
     the interval is the CSV's time step); Normal Depth lines take the "slope" attribute as the friction slope
     (FloodSim's free outfall uses the water-surface slope, so these are estimates from the ground near the edge).
     Precipitation: Meteorological Data > Precipitation > point / constant from precip/hyetograph.csv${inp.radar?.length ? `, or gridded from
     precip/grid (GDAL raster files with the times in index.csv; check that your RAS version imports them)` : ''}.
  8. Plan: the simulation window above; FloodSim solves the full shallow water equations (SWE-ELM or SWE-EM in RAS is
     the like-for-like choice; diffusion wave is faster and smoother). Initial conditions: FloodSim started the rivers
     ${m.startLevels ? `at their gauge levels (${m.startLevels})` : 'at the lidar water surface (the carved channel full to it)'}; in RAS use an initial ramp-up or a restart.

Not in this package: the storm-sewer network (drainage/network.inp in the 3D package is EPA SWMM), culverts, ponds and
green infrastructure, which RAS models differently; and no RAS plan, geometry or unsteady-flow files are written.
`;
}
