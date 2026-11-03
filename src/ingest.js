// Open-data ingest onto a UTM model grid: USGS 3DEP DEM, OSM buildings/roads, NLCD land cover, SSURGO soils.
// Every fetch goes through `fetcher(url, {method, body, contentType})` → Response, so the browser can use the
// caching proxy (server/server.mjs) and tests can stub it. Rasters come back row-major, row 0 = north.
import { toUTM } from './geo.js';
import { soilPropsQuery, soilParams } from './soil.js';

const DEP = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const NLCD_WMS = 'https://www.mrlc.gov/geoserver/mrlc_display/wms';
/** NLCD layer covering a point: the lower 48 (2021), Alaska (2016), Hawaii and Puerto Rico (2001; the latest NLCD there). */
export function nlcdLayer(lon, lat) {
  if (lat > 51 && (lon < -129 || lon > 170)) return { layer: 'NLCD_2016_Land_Cover_AK', label: 'NLCD 2016 Alaska' };
  if (lat > 18 && lat < 23 && lon > -161 && lon < -154) return { layer: 'NLCD_2001_Land_Cover_HI', label: 'NLCD 2001 Hawaii' };
  if (lat > 17.5 && lat < 18.7 && lon > -67.5 && lon < -65.1) return { layer: 'NLCD_2001_Land_Cover_PR', label: 'NLCD 2001 Puerto Rico' };
  if (lat > 24 && lat < 50 && lon > -125 && lon < -66) return { layer: 'NLCD_2021_Land_Cover_L48', label: 'NLCD 2021' };
  return null; // Guam, American Samoa, the Virgin Islands, …: no NLCD; land-cover defaults apply
}
const SDA = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';

// ------------------------------------------------------------------ DEM

/**
 * Bare-earth DEM from the 3DEP dynamic mosaic, in the grid's UTM CRS, at grid.dx.
 * Also reports the finest native source under the box: 1 m means real lidar; 10/30 m means the
 * service is interpolating, and nothing finer than the source can be trusted.
 */
export async function fetchDEM(grid, fetcher, onProgress = () => {}) {
  const { nx, ny, x0, y1, dx, epsg } = grid;
  const tile = 2000, z = new Float32Array(nx * ny);
  const jobs = [];
  for (let r0 = 0; r0 < ny; r0 += tile) for (let c0 = 0; c0 < nx; c0 += tile) jobs.push([c0, r0, Math.min(tile, nx - c0), Math.min(tile, ny - r0)]);
  let done = 0;
  await Promise.all(jobs.map(async ([c0, r0, w, h]) => {
    const bx0 = x0 + c0 * dx, by1 = y1 - r0 * dx, bbox = [bx0, by1 - h * dx, bx0 + w * dx, by1].join(',');
    const url = `${DEP}/exportImage?bbox=${bbox}&bboxSR=${epsg}&imageSR=${epsg}&size=${w},${h}&format=bsq&pixelType=F32` +
      `&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image`;
    const r = await fetcher(url);
    if (!r.ok) throw new Error(`3DEP DEM request failed (${r.status})`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength < w * h * 4) throw new Error('3DEP DEM response too short');
    const f = new Float32Array(buf, 0, w * h); // bsq: band data, then a 1-bit validity mask we ignore
    for (let j = 0; j < h; j++) z.set(f.subarray(j * w, (j + 1) * w), (r0 + j) * nx + c0);
    onProgress(++done / jobs.length);
  }));
  const filled = fillNoData(z, nx, ny, -1000);

  // native resolution of the best source raster under the box
  const env = [grid.x0, grid.y0, grid.x1, grid.y1].join(',');
  let sourceRes = null, sources = [];
  try {
    const q = await fetcher(`${DEP}/query?geometry=${env}&geometryType=esriGeometryEnvelope&inSR=${epsg}&spatialRel=esriSpatialRelIntersects` +
      `&outFields=Name,LowPS,Category&returnGeometry=false&f=json`);
    const feats = (await q.json()).features.map(f => f.attributes).filter(a => a.Category === 1);
    sourceRes = Math.min(...feats.map(a => a.LowPS));
    sources = feats.filter(a => a.LowPS <= sourceRes * 1.01).map(a => a.Name);
  } catch { /* catalog is informational only */ }
  return { z, filled, sourceRes, sources };
}

/** Replace values below `bad` by repeated 4-neighbour averaging (edges of coverage, voids). Returns count. */
export function fillNoData(z, nx, ny, bad) {
  let missing = []; for (let k = 0; k < z.length; k++) if (!(z[k] > bad)) missing.push(k);
  const total = missing.length;
  if (total === z.length) throw new Error('No DEM coverage for this area (3DEP returned no data)');
  while (missing.length) {
    const next = [], upd = [];
    for (const k of missing) {
      const i = k % nx, j = (k / nx) | 0; let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const v = z[jj * nx + ii]; if (v > bad) { s += v; n++; }
      }
      if (n) upd.push([k, s / n]); else next.push(k);
    }
    for (const [k, v] of upd) z[k] = v;
    if (next.length === missing.length) break;
    missing = next;
  }
  return total;
}

// ------------------------------------------------------------------ OpenStreetMap

const ROAD_WIDTH = { // carriageway width in metres by OSM highway class (kerb to kerb, typical US)
  motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 9, unclassified: 7, residential: 8,
  living_street: 6, service: 5, motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6,
};

/** Buildings (polygons with heights), drivable roads, waterways and culverts (waterways tagged tunnel) inside a lon/lat box. ODbL. */
export async function fetchOSM([w, s, e, n], fetcher) {
  const b = `${s},${w},${n},${e}`;
  const ql = `[out:json][timeout:120];(way["building"](${b});relation["building"]["type"="multipolygon"](${b});` +
    `way["highway"](${b});way["waterway"](${b}););out geom;`;
  let r, why = [];
  for (const endpoint of OVERPASS) { // public Overpass servers are often busy (429/5xx); fall through the mirrors
    try {
      r = await fetcher(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(ql), contentType: 'application/x-www-form-urlencoded' });
      if (r.ok) break;
      why.push(`${new URL(endpoint).hostname} ${r.status}`);
    } catch (e) { why.push(`${new URL(endpoint).hostname} ${e.message}`); }
    r = null;
  }
  if (!r) throw new Error(`Overpass unavailable (${why.join(', ')})`);
  const els = (await r.json()).elements;
  const buildings = [], roads = [], waterways = [], culverts = [];
  const ring = (g) => g.map(p => [p.lon, p.lat]);
  for (const el of els) {
    const t = el.tags || {};
    if (t.building && el.type === 'way' && el.geometry?.length > 3) buildings.push({ rings: [ring(el.geometry)], height: bldHeight(t), id: el.id });
    else if (t.building && el.type === 'relation') {
      const rings = stitch(el.members.filter(m => m.type === 'way' && m.geometry).map(m => ring(m.geometry)));
      if (rings.length) buildings.push({ rings, height: bldHeight(t), id: el.id });
    } else if (t.highway && el.geometry && ROAD_WIDTH[t.highway] && !t.bridge && !t.tunnel && t.covered !== 'yes') {
      roads.push({ line: ring(el.geometry), width: Number.parseFloat(t.width) || ROAD_WIDTH[t.highway], kind: t.highway, ...(t.name ? { name: t.name } : {}) });
    } else if (t.waterway && el.geometry && !t.tunnel) waterways.push({ line: ring(el.geometry), kind: t.waterway, name: t.name });
    else if (t.waterway && el.geometry && /culvert|yes/.test(t.tunnel) && el.geometry.length > 1) culverts.push({ line: ring(el.geometry), kind: t.waterway, tags: { diameter: t.diameter, width: t.width } });
  }
  return { buildings, roads, waterways, culverts };
}

function bldHeight(t) {
  const h = Number.parseFloat(t.height); if (h > 0) return h;
  const lv = Number.parseFloat(t['building:levels']); if (lv > 0) return lv * 3.2 + 1;
  return null; // unknown; exporters fall back to a default and say so
}

/** Join open member ways of a multipolygon into closed rings (inner and outer alike; even-odd fill sorts them out). */
function stitch(parts) {
  const rings = [], open = [];
  for (const p of parts) (same(p[0], p[p.length - 1]) ? rings : open).push(p.slice());
  while (open.length) {
    let cur = open.pop(), grown = true;
    while (!same(cur[0], cur[cur.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i], end = cur[cur.length - 1];
        if (same(end, o[0])) cur = cur.concat(o.slice(1));
        else if (same(end, o[o.length - 1])) cur = cur.concat(o.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1); grown = true; break;
      }
    }
    if (cur.length > 3) rings.push(cur);
  }
  return rings;
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// ------------------------------------------------------------------ NLCD

/** NLCD 2021 legend: class → [r,g,b] as served by the MRLC WMS. */
export const NLCD_COLORS = {
  11: [70, 107, 159], 12: [209, 222, 248], 21: [222, 197, 197], 22: [217, 146, 130], 23: [235, 0, 0], 24: [171, 0, 0],
  31: [179, 172, 159], 41: [104, 171, 95], 42: [28, 95, 44], 43: [181, 197, 143], 51: [175, 150, 60], 52: [204, 184, 121],
  71: [223, 223, 194], 72: [209, 209, 130], 73: [163, 204, 81], 74: [130, 186, 158], 81: [220, 217, 57], 82: [171, 108, 40],
  90: [184, 217, 235], 95: [108, 159, 184],
};
export const NLCD_NAMES = {
  11: 'Open water', 12: 'Ice/snow', 21: 'Developed, open space', 22: 'Developed, low', 23: 'Developed, medium', 24: 'Developed, high',
  31: 'Barren', 41: 'Deciduous forest', 42: 'Evergreen forest', 43: 'Mixed forest', 52: 'Shrub', 71: 'Grassland',
  81: 'Pasture', 82: 'Cultivated crops', 90: 'Woody wetlands', 95: 'Herbaceous wetlands',
};

/**
 * NLCD classes on the grid. The WMS is asked for the map in the grid's own UTM CRS (nearest-neighbour), then
 * colours are matched back to classes. `decodeImage(ArrayBuffer) → {width, height, data: RGBA}`.
 */
export async function fetchNLCD(grid, fetcher, decodeImage, maxPx = 2048) {
  const [w0, s0, e0, n0] = grid.lonlatBounds(), L = nlcdLayer((w0 + e0) / 2, (s0 + n0) / 2);
  if (!L) throw new Error('no NLCD land cover for this location');
  const s = Math.max(1, Math.ceil(Math.max(grid.nx, grid.ny) / maxPx));
  const w = Math.ceil(grid.nx / s), h = Math.ceil(grid.ny / s);
  const url = `${NLCD_WMS}?service=WMS&version=1.1.1&request=GetMap&layers=${L.layer}&styles=&srs=EPSG:${grid.epsg}` +
    `&bbox=${grid.x0},${grid.y1 - h * s * grid.dx},${grid.x0 + w * s * grid.dx},${grid.y1}&width=${w}&height=${h}&format=image/png&transparent=true`;
  const r = await fetcher(url);
  if (!r.ok || !(r.headers.get('content-type') || '').includes('image')) throw new Error(`NLCD request failed (${r.status})`);
  const img = await decodeImage(await r.arrayBuffer());
  const codes = Object.keys(NLCD_COLORS).map(Number), cache = new Map();
  const small = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    const R = img.data[4 * k], G = img.data[4 * k + 1], B = img.data[4 * k + 2], A = img.data[4 * k + 3];
    if (A < 128) { small[k] = 0; continue; }
    const key = (R << 16) | (G << 8) | B;
    let c = cache.get(key);
    if (c === undefined) {
      let best = 1e9; for (const code of codes) { const [r2, g2, b2] = NLCD_COLORS[code]; const d = (R - r2) ** 2 + (G - g2) ** 2 + (B - b2) ** 2; if (d < best) { best = d; c = code; } }
      cache.set(key, c);
    }
    small[k] = c;
  }
  const cls = new Uint8Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) cls[j * grid.nx + i] = small[Math.min(h - 1, (j / s) | 0) * w + Math.min(w - 1, (i / s) | 0)];
  cls.label = L.label;
  return cls;
}

// ------------------------------------------------------------------ SSURGO

/** Soil map units (dominant hydrologic soil group) clipped to a lon/lat box, from USDA Soil Data Access. */
export async function fetchSoils([w, s, e, n], fetcher) {
  const wkt = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  const g = `geometry::STGeomFromText('${wkt}',4326)`;
  const query = `SELECT P.mukey, M.hydgrpdcd, M.muname, P.mupolygongeo.STIntersection(${g}).STAsText() AS wkt ` +
    `FROM mupolygon P JOIN muaggatt M ON M.mukey = P.mukey WHERE P.mupolygongeo.STIntersects(${g}) = 1`;
  const r = await fetcher(SDA, { method: 'POST', body: JSON.stringify({ query, format: 'JSON+COLUMNNAME' }), contentType: 'application/json' });
  if (!r.ok) throw new Error(`Soil Data Access request failed (${r.status})`);
  const t = (await r.json()).Table || [];
  const units = t.slice(1).map(([mukey, hsg, name, wktOut]) => ({ mukey, hsg, name, rings: parseWKTRings(wktOut) }));
  // Green-Ampt properties (conductivity, porosity, texture, water table) for the same map units; optional
  try {
    const keys = [...new Set(units.map(u => u.mukey))];
    if (keys.length) {
      const q = await fetcher(SDA, { method: 'POST', body: JSON.stringify({ query: soilPropsQuery(keys), format: 'JSON+COLUMNNAME' }), contentType: 'application/json' });
      if (q.ok) { const props = soilParams((await q.json()).Table || [[]]); for (const u of units) u.props = props.get(String(u.mukey)) ?? null; }
    }
  } catch { /* the hydrologic group alone still drives infiltration */ }
  return units;
}

/** All rings of a WKT POLYGON / MULTIPOLYGON / GEOMETRYCOLLECTION as [[lon,lat],...] (even-odd fill). */
export function parseWKTRings(wkt) {
  const rings = [];
  for (const m of (wkt || '').matchAll(/\(([^()]+)\)/g)) {
    const pts = m[1].split(',').map(p => p.trim().split(/\s+/).map(Number)).filter(p => p.length >= 2 && Number.isFinite(p[0]));
    if (pts.length > 2) rings.push(pts);
  }
  return rings;
}

// ------------------------------------------------------------------ projection helper

/** lon/lat rings or lines → fractional grid cell coordinates [col, row]. */
export function toCells(grid, pts) {
  return pts.map(([lo, la]) => { const [x, y] = toUTM(lo, la, grid.zone); return [(x - grid.x0) / grid.dx, (grid.y1 - y) / grid.dx]; });
}
