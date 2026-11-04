// Open utility drainage data, by coverage area. When a model area falls inside a registered utility, Build pulls its
// real inlet (and outfall) locations; pipes are still synthesized through them unless the utility publishes mains.
// Add a city by appending to UTILITIES: an ArcGIS FeatureServer/MapServer layer per feature type is enough, or a
// Socrata (SODA) dataset of points (`socrata`, with its point column `geom`).

export const UTILITIES = [
  {
    id: 'pwd', name: 'Philadelphia Water Department', city: 'Philadelphia, PA',
    bbox: [-75.2803, 39.8670, -74.9557, 40.1379],
    license: 'City of Philadelphia License (OpenDataPhilly)',
    inlets: { url: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/INLETS/FeatureServer/0', system: 'system', type: 'inlettype' },
    outfalls: { url: 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhillyWater/MapServer/2', system: 'SYSTEM', type: 'OUTFALL_TY' },
    combinedArea: { url: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Combined_Sewer_Service_Area/FeatureServer/0' },
    mains: null, // not published openly (PWD requires a written data request)
  },
  {
    id: 'nycdep', name: 'NYC Department of Environmental Protection', city: 'New York, NY',
    bbox: [-74.2591, 40.4774, -73.7004, 40.9176],
    license: 'NYC Open Data (NYC Terms of Use)',
    inlets: { socrata: 'https://data.cityofnewyork.us/resource/2w2g-fk3i.json', geom: 'the_geom', system: null, type: null }, // catch basins
    outfalls: { socrata: 'https://data.cityofnewyork.us/resource/8rjn-kpsh.json', geom: 'the_geom', system: 'outfall_ty', type: 'receiving_' },
    // no combined-area layer: DEP maps only the separate (MS4) drainage areas, so the area is combined where most of it
    // lies outside them (src/nyc-ms4.js)
    separateAreas: () => import('./nyc-ms4.js').then(m => m.MS4),
    mains: null, // not published
  },
];

export const utilityFor = ([w, s, e, n]) => UTILITIES.find(u => w >= u.bbox[0] && e <= u.bbox[2] && s >= u.bbox[1] && n <= u.bbox[3]) ?? null;

/** All point features of an ArcGIS layer inside a lon/lat box, paging past the server's record limit. */
async function queryPoints(layer, [w, s, e, n], fetcher, fields) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${layer}/query?geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=${fields.join(',')}&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=1000&f=json`;
    const r = await fetcher(url);
    if (!r.ok) throw new Error(`utility layer request failed (${r.status})`);
    const j = await r.json();
    if (j.error) throw new Error(`utility layer: ${j.error.message}`);
    for (const f of j.features || []) if (f.geometry) out.push({ lon: f.geometry.x, lat: f.geometry.y, a: f.attributes });
    if (!j.exceededTransferLimit && (j.features || []).length < 1000) break;
  }
  return out;
}

/** All points of a Socrata dataset inside a lon/lat box, paging by 50,000. */
async function querySocrata(src, [w, s, e, n], fetcher, fields) {
  const out = [];
  for (let offset = 0; ; offset += 50000) {
    const q = new URLSearchParams({ $where: `within_box(${src.geom},${n},${w},${s},${e})`, $limit: '50000', $offset: String(offset), $order: ':id' });
    const r = await fetcher(`${src.socrata}?${q}`);
    if (!r.ok) throw new Error(`utility dataset request failed (${r.status})`);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error(`utility dataset: ${j.message || 'unexpected reply'}`);
    for (const f of j) { const c = f[src.geom]?.coordinates; if (c) out.push({ lon: c[0], lat: c[1], a: Object.fromEntries(fields.filter(Boolean).map(k => [k, f[k]])) }); }
    if (j.length < 50000) break;
  }
  return out;
}
const points = (src, b, fetcher) => src.socrata ? querySocrata(src, b, fetcher, [src.system, src.type]) : queryPoints(src.url, b, fetcher, [src.system, src.type].filter(Boolean));

/** Share of a lon/lat box inside polygons ([outer, ...holes] rings), on a 40 × 40 grid of points. */
export function shareInside(polys, [w, s, e, n], N = 40) {
  const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
  const near = polys.filter(p => p[0].some(([x, y]) => x >= w - 0.05 && x <= e + 0.05 && y >= s - 0.05 && y <= n + 0.05));
  let k = 0;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const x = w + (a + 0.5) / N * (e - w), y = s + (b + 0.5) / N * (n - s);
    if (near.some(p => inRing(p[0], x, y) && !p.slice(1).some(h => inRing(h, x, y)))) k++;
  }
  return k / (N * N);
}

/**
 * Real drainage features for a lon/lat box from the covering utility, or null when none is registered.
 * @returns {{utility, inlets: {lon,lat,system,type}[], outfalls: {lon,lat,system,type}[], combined: boolean}}
 */
export async function fetchUtility(bounds, fetcher) {
  const u = utilityFor(bounds);
  if (!u) return null;
  const [w, s, e, n] = bounds, pad = 0.0015; // outfalls just beyond the area still receive its pipes
  const [inl, outs, comb] = await Promise.all([
    points(u.inlets, bounds, fetcher),
    u.outfalls ? points(u.outfalls, [w - pad, s - pad, e + pad, n + pad], fetcher).catch(() => []) : [],
    u.combinedArea ? fetcher(`${u.combinedArea.url}/query?geometry=${(w + e) / 2},${(s + n) / 2}&geometryType=esriGeometryPoint&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json`).then(r => r.json()).then(j => j.count > 0).catch(() => false)
      : u.separateAreas ? u.separateAreas().then(p => shareInside(p, bounds) < 0.5).catch(() => false) : false,
  ]);
  return {
    utility: { id: u.id, name: u.name, city: u.city, license: u.license, publishesMains: !!u.mains },
    inlets: inl.map(p => ({ lon: p.lon, lat: p.lat, system: p.a[u.inlets.system], type: p.a[u.inlets.type] })),
    outfalls: outs.map(p => ({ lon: p.lon, lat: p.lat, system: p.a[u.outfalls.system], type: p.a[u.outfalls.type] })),
    combined: comb,
  };
}
