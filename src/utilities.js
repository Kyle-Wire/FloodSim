// Open utility drainage data, by coverage area. When a model area falls inside a registered utility, Build pulls its
// real inlet (and outfall) locations; pipes are still synthesized through them unless the utility publishes mains.
// Add a city by appending to UTILITIES: an ArcGIS FeatureServer/MapServer layer per feature type is enough.

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

/**
 * Real drainage features for a lon/lat box from the covering utility, or null when none is registered.
 * @returns {{utility, inlets: {lon,lat,system,type}[], outfalls: {lon,lat,system,type}[], combined: boolean}}
 */
export async function fetchUtility(bounds, fetcher) {
  const u = utilityFor(bounds);
  if (!u) return null;
  const [w, s, e, n] = bounds, pad = 0.0015; // outfalls just beyond the area still receive its pipes
  const [inl, outs, comb] = await Promise.all([
    queryPoints(u.inlets.url, bounds, fetcher, [u.inlets.system, u.inlets.type]),
    u.outfalls ? queryPoints(u.outfalls.url, [w - pad, s - pad, e + pad, n + pad], fetcher, [u.outfalls.system, u.outfalls.type]).catch(() => []) : [],
    u.combinedArea ? fetcher(`${u.combinedArea.url}/query?geometry=${(w + e) / 2},${(s + n) / 2}&geometryType=esriGeometryPoint&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json`).then(r => r.json()).then(j => j.count > 0).catch(() => false) : false,
  ]);
  return {
    utility: { id: u.id, name: u.name, city: u.city, license: u.license, publishesMains: !!u.mains },
    inlets: inl.map(p => ({ lon: p.lon, lat: p.lat, system: p.a[u.inlets.system], type: p.a[u.inlets.type] })),
    outfalls: outs.map(p => ({ lon: p.lon, lat: p.lat, system: p.a[u.outfalls.system], type: p.a[u.outfalls.type] })),
    combined: comb,
  };
}
