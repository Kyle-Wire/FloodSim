// User-linked data: any public ArcGIS REST layer (FeatureServer/MapServer …/<id>) or GeoJSON URL. Build fetches the
// features inside the model area and works out what the attribute fields mean (pipe size, shape, inverts, status),
// with units guessed from names and values; the guesses are shown to the user and can be overridden. An ArcGIS link can
// carry a filter, …/MapServer/108?where=LAYER_GROUP IN ('SEWER PIPES'), for a layer that mixes mains with laterals.

const isArcGIS = (u) => /\/(FeatureServer|MapServer)\/\d+\/?$/i.test(u.split('?')[0]);

/** What a link points to: name, geometry kind, fields, and (for ArcGIS) the record limit. Throws a readable error. */
export async function describeSource(url, fetcher) {
  url = url.trim();
  if (!/^https:\/\//i.test(url)) throw new Error('Use an https:// link to an ArcGIS layer (…/FeatureServer/0) or a GeoJSON file');
  if (isArcGIS(url)) {
    const [base, query = ''] = url.split('?'), where = new URLSearchParams(query).get('where') || '1=1';
    const j = await (await fetcher(base.replace(/\/?$/, '') + '?f=json')).json();
    if (j.error) throw new Error(j.error.message || 'ArcGIS error');
    if (!j.geometryType) throw new Error('That is a service, not a layer: add the layer number, e.g. …/MapServer/1');
    const kind = /Point/i.test(j.geometryType) ? 'point' : /Polyline/i.test(j.geometryType) ? 'line' : 'polygon';
    return { type: 'arcgis', url: base.replace(/\/?$/, ''), where, name: j.name + (where !== '1=1' ? ` (${where})` : ''), kind, fields: (j.fields || []).map(f => f.name), maxRecords: j.maxRecordCount || 1000 };
  }
  const gj = await (await fetcher(url)).json();
  if (gj.type !== 'FeatureCollection') throw new Error('Not a GeoJSON FeatureCollection');
  const g = gj.features.find(f => f.geometry)?.geometry?.type || '';
  const kind = /Point/.test(g) ? 'point' : /LineString/.test(g) ? 'line' : 'polygon';
  return { type: 'geojson', url, name: gj.name || url.split('/').pop(), kind, fields: Object.keys(gj.features[0]?.properties || {}), data: gj };
}

/** Features inside a lon/lat box as {kind, coords ([lon,lat] or [[lon,lat],…] per part), props}. */
export async function fetchFeatures(src, [w, s, e, n], fetcher) {
  const out = [];
  if (src.type === 'arcgis') {
    const step = Math.min(1000, src.maxRecords || 1000);
    for (let offset = 0; ; offset += step) {
      const q = `${src.url}/query?where=${encodeURIComponent(src.where ?? '1=1')}&geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
        `&outFields=*&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=${step}&f=json`;
      const j = await (await fetcher(q)).json();
      if (j.error) throw new Error(`${src.name}: ${j.error.message}`);
      for (const f of j.features || []) {
        const gm = f.geometry; if (!gm) continue;
        if (gm.x != null) out.push({ kind: 'point', coords: [gm.x, gm.y], props: f.attributes });
        else if (gm.paths) for (const p of gm.paths) out.push({ kind: 'line', coords: p, props: f.attributes });
      }
      if (!j.exceededTransferLimit && (j.features || []).length < step) break;
    }
    return out;
  }
  const inBox = ([x, y]) => x >= w && x <= e && y >= s && y <= n;
  for (const f of src.data.features) {
    const g = f.geometry; if (!g) continue;
    if (g.type === 'Point' && inBox(g.coordinates)) out.push({ kind: 'point', coords: g.coordinates, props: f.properties || {} });
    if (g.type === 'MultiPoint') for (const c of g.coordinates) if (inBox(c)) out.push({ kind: 'point', coords: c, props: f.properties || {} });
    if (g.type === 'LineString' && g.coordinates.some(inBox)) out.push({ kind: 'line', coords: g.coordinates, props: f.properties || {} });
    if (g.type === 'MultiLineString') for (const l of g.coordinates) if (l.some(inBox)) out.push({ kind: 'line', coords: l, props: f.properties || {} });
  }
  return out;
}

// ------------------------------------------------------------------ field detection for pipe layers

const FIELD_PATTERNS = {
  size: /^(dia|diam|diameter|dia_?hgt|diameter_?in|pipe_?dia(meter)?|pipe_?size|size|height|hgt|rise)$|dia(meter)?|pipesize|_(height|hgt|rise)$/i,
  width: /^(width|wid|span|pipe_?width)$|_(width|span)$/i,
  shape: /shape|shpe|x_?sec|xsec|cross_?sec|sec_?shp|pipe_?type/i,
  upInvert: /(^|_)(us|up|upstr(eam)?|start|from|frm|beg(in)?)_?(inv(ert)?|ie|elev)|inv(ert)?_?(up|us|start|from)|^upinv|^usinv|^inv_?up/i,
  dnInvert: /(^|_)(ds|dn|down|downstr(eam)?|end|to)_?(inv(ert)?|ie|elev)|inv(ert)?_?(dn|ds|down|end|to)|^dninv|^dsinv|^inv_?dn/i,
  status: /aband|status|active|lifecycle|in_?service/i,
  system: /^(unit_?type|system|sys_?type|sewer_?type|swr_?type|flow_?type|sewer_?use|use_?type)$/i,
};
const DEAD = /^(y|yes|true|1|abandoned|removed|inactive|retired|proposed|out of service)$/i;
// a field that says the pipe is in use (Charlotte: Active = 1): there it is the 'no' values that drop a pipe
const LIVE_FIELD = /^(is_?)?active$|in_?service/i, NOT_LIVE = /^(n|no|false|0|inactive|abandoned|removed|retired|proposed)$/i;
/** True when a pipe's status value says it is abandoned, removed or proposed. */
export const isDead = (field, v) => (LIVE_FIELD.test(field) ? NOT_LIVE : DEAD).test(String(v ?? '').trim());
// a combined-sewer pipe by its system field: 'Combined', 'COMB', or a combined unit code (Portland: CSML, a combined main)
const COMBINED = /comb|^cs(ml|o)?$/i;

/** Guess which fields hold pipe size, shape, inverts, status and system (combined / storm / sanitary), and the units of size. */
export function detectPipeFields(fields, sample) {
  const pick = (re, avoid = []) => fields.find(f => re.test(f) && !avoid.includes(f)) ?? null;
  const m = {};
  // an invert field by name (US_INVERT) wins over an elevation one (US_ELEV), which in a layer that has both is the rim
  const inv = (re, avoid = []) => fields.find(f => re.test(f) && /inv|_ie$/i.test(f) && !avoid.includes(f)) ?? pick(re, avoid);
  m.upInvert = inv(FIELD_PATTERNS.upInvert); m.dnInvert = inv(FIELD_PATTERNS.dnInvert, [m.upInvert]);
  m.size = pick(FIELD_PATTERNS.size, [m.upInvert, m.dnInvert]); m.width = pick(FIELD_PATTERNS.width, [m.size]);
  // shape: not ArcGIS's geometry fields (Shape, Shape_Length)
  m.shape = pick(FIELD_PATTERNS.shape, [m.size, ...fields.filter(f => /^shape([._]|$)/i.test(f))]); m.status = pick(FIELD_PATTERNS.status);
  m.system = pick(FIELD_PATTERNS.system);
  const vals = m.size ? sample.map(p => Number(p[m.size])).filter(v => v > 0).sort((a, b) => a - b) : [];
  const med = vals.length ? vals[vals.length >> 1] : 0;
  m.sizeUnits = /mm/i.test(m.size || '') ? 'mm' : /_in|inch/i.test(m.size || '') ? 'in' : /_ft|feet/i.test(m.size || '') ? 'ft' :
    med > 100 ? 'mm' : med >= 4 ? 'in' : 'm';
  return m;
}

const UNIT = { in: 0.0254, mm: 0.001, ft: 0.3048, m: 1 };

/**
 * Pipe records in SI from linked line features: {line: [[lon,lat],…], h (m), w (m) or null, shape: 'CIRCULAR'|'RECT_CLOSED',
 * barrels, upInv, dnInv (raw, units resolved later against the DEM), combined (by the system field, when there is one)}. Abandoned / proposed pipes are dropped.
 * An invert of exactly 0 is missing (how utility GIS layers leave it blank); datum: added to every invert there is, in
 * the inverts' own units, to bring a local datum to NAVD88 (City of Portland datum + 2.10 ft).
 */
export function pipeRecords(features, m, { datum = 0 } = {}) {
  const inv = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) === 0 ? null : Number(v) + datum);
  const u = UNIT[m.sizeUnits] ?? 1, out = [];
  for (const f of features) {
    if (f.kind !== 'line' || f.coords.length < 2) continue;
    const p = f.props;
    if (m.status && isDead(m.status, p[m.status])) continue;
    // sizes beyond 6 m tall / 12 m wide are placeholders (999, 9999 …) in real layers: treat them as unknown
    const hv = Number(p[m.size]) * u, wv = m.width ? Number(p[m.width]) * u : 0;
    const h = hv > 0 && hv <= 6 ? hv : null, w = wv > 0 && wv <= 12 ? wv : null;
    const shp = String(m.shape ? p[m.shape] ?? '' : '');
    const box = /box|rect|square|rcb/i.test(shp) || /rcb|box/i.test(String(p.MATL ?? p.MATERIAL ?? ''));
    const barrels = /double|twin|dual/i.test(shp) ? 2 : /triple/i.test(shp) ? 3 : 1;
    // a wide arch (Charlotte's Sheffield Dr culvert: 8 ft rise, 28 ft span) is a closed rectangle of its rise and the same area (a half-ellipse: π/4 of the span)
    const arch = /arch/i.test(shp) && h && w > h;
    out.push({ line: f.coords, h, w: arch ? w * Math.PI / 4 : box ? (w ?? h) : null, shape: box || arch ? 'RECT_CLOSED' : 'CIRCULAR', barrels,
      upInv: m.upInvert ? inv(p[m.upInvert]) : null, dnInv: m.dnInvert ? inv(p[m.dnInvert]) : null, combined: m.system ? COMBINED.test(String(p[m.system] ?? '').trim()) : false });
  }
  return out;
}

/** Point features as {lon, lat} (inlets, outfalls). */
/** Point records {lon, lat}, with `type` from `typeField` (an inlet's kind of structure, src/inlettypes.js) when given. */
export const pointRecords = (features, typeField = null) => features.filter(f => f.kind === 'point').map(f => {
  const r = { lon: f.coords[0], lat: f.coords[1] }, t = typeField ? f.props?.[typeField] : null;
  if (t != null && String(t).trim() !== '') r.type = String(t).trim();
  return r;
});
