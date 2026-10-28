// Calibration against observed flooding: high-water marks (water surface elevation), observed depths, or flooded / dry
// reports, scored against a run's peak water surface; and a parameter sweep over the three knobs that most often need
// tuning in urban models: overland roughness, infiltration, and inlet clogging (debris on grates).
//
// A mark is compared with the highest modelled water surface within `radius` of it (marks are surveyed on walls, poles
// and doors, a metre or two from where the 1 m model has open ground). A point the model leaves dry scores its ground as
// the water surface, which is the right sign of error for a missed flood.

export const PARAMS = {
  manning: { label: 'Roughness (Manning n) ×', min: 0.6, max: 1.6, default: 1, step: 0.05 },
  infil: { label: 'Infiltration ×', min: 0.25, max: 2, default: 1, step: 0.05 },
  clog: { label: 'Inlet clogging', min: 0, max: 0.7, default: 0, step: 0.05, unit: '%' },
};
const FT = 0.3048;

/**
 * Observations from CSV text or GeoJSON. CSV needs lat and lon (or latitude / longitude / y / x in degrees) and one of:
 * a water surface elevation (wse, elev, hwm, elevation, stage), a depth (depth, height above ground), or flooded (yes / no,
 * 1 / 0, true / false); `name` / `id` optional. Elevations and depths in `units` ('ft' or 'm'), NAVD88.
 * → [{ name, lon, lat, wse?, depth?, flooded? }] (metres)
 */
export function parseObservations(text, { units = 'ft' } = {}) {
  const k = units === 'ft' ? FT : 1, out = [];
  const pick = (o, re) => { const key = Object.keys(o).find(x => re.test(x)); return key == null ? undefined : o[key]; };
  const num = (v) => { const n = Number(String(v ?? '').trim()); return v == null || String(v).trim() === '' || !Number.isFinite(n) ? null : n; };
  const bool = (v) => { const s = String(v ?? '').trim().toLowerCase(); return /^(y|yes|1|true|flooded|wet)$/.test(s) ? true : /^(n|no|0|false|dry)$/.test(s) ? false : null; };
  const add = (props, lon, lat, i) => {
    const wse = num(pick(props, /^(wse|elev|elevation|hwm_?(elev|wse|height)|stage|water_?(surface|level|elev)|peak_?(elev|stage))/i));
    const depth = num(pick(props, /^(depth|height_?above_?ground|hag|flood_?depth)/i));
    const flooded = bool(pick(props, /^(flooded|wet|observed)$/i));
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || (wse == null && depth == null && flooded == null)) return;
    out.push({ name: String(pick(props, /^(name|id|site|label|hwm_?id)$/i) ?? `P${i + 1}`), lon, lat,
      ...(wse != null ? { wse: wse * k } : {}), ...(depth != null ? { depth: depth * k } : {}), ...(flooded != null ? { flooded } : depth != null ? { flooded: depth * k > 0.05 } : {}) });
  };
  const t = text.trim();
  if (t.startsWith('{')) {
    const gj = JSON.parse(t), feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
    feats.forEach((f, i) => { if (f.geometry?.type === 'Point') add(f.properties ?? {}, f.geometry.coordinates[0], f.geometry.coordinates[1], i); });
  } else {
    const rows = t.split(/\r?\n/).filter(Boolean).map(splitCSV), head = rows.shift().map(h => h.trim().toLowerCase());
    rows.forEach((r, i) => {
      const o = Object.fromEntries(head.map((h, c) => [h, r[c]]));
      add(o, num(pick(o, /^(lon|long|longitude|x)$/)), num(pick(o, /^(lat|latitude|y)$/)), i);
    });
  }
  return out;
}
function splitCSV(line) { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

/**
 * Score a run. at(lon, lat, radius) → { ground, wse } (wse = highest modelled water surface within radius, or null if
 * dry). → { points: [{ ...obs, ground, model, error, kind }], n, bias, mae, rmse, within15, hits, misses, falseAlarms, score }
 * score: RMSE of levels (m) plus 0.25 m per wrong flooded / dry call, so a sweep can rank runs with mixed observations.
 */
export function scoreRun(obs, at, radius = 3) {
  const pts = [], e = []; let hits = 0, misses = 0, falseAlarms = 0, wrong = 0, calls = 0;
  for (const o of obs) {
    const m = at(o.lon, o.lat, radius); if (!m) continue;
    const depth = m.wse == null ? 0 : Math.max(0, m.wse - m.ground), p = { ...o, ground: m.ground, modelDepth: depth };
    if (o.wse != null) { p.kind = 'level'; p.model = m.wse ?? m.ground; p.error = p.model - o.wse; e.push(p.error); }
    else if (o.depth != null) { p.kind = 'depth'; p.model = depth; p.error = depth - o.depth; e.push(p.error); }
    else p.kind = 'flooded';
    if (o.flooded != null || o.wse != null) {
      const obsWet = o.flooded ?? (o.wse > m.ground + 0.05), modWet = depth > 0.05; calls++;
      if (obsWet && modWet) hits++; else if (obsWet) { misses++; wrong++; } else if (modWet) { falseAlarms++; wrong++; }
      p.call = obsWet === modWet ? 'right' : obsWet ? 'missed' : 'false alarm';
    }
    pts.push(p);
  }
  const n = e.length, bias = n ? e.reduce((a, b) => a + b, 0) / n : null, mae = n ? e.reduce((a, b) => a + Math.abs(b), 0) / n : null;
  const rmse = n ? Math.sqrt(e.reduce((a, b) => a + b * b, 0) / n) : null, within15 = n ? e.filter(x => Math.abs(x) <= 0.15).length / n : null;
  return { points: pts, n, bias, mae, rmse, within15, hits, misses, falseAlarms, calls, score: (rmse ?? 0) + 0.25 * (calls ? wrong / calls : 0) * (n ? 1 : 4) };
}

/** Parameter sets for a sweep: a grid over the chosen parameters (each at `levels` values), at most `max` runs. */
export function sweepPlan(chosen, levels = 3, max = 27) {
  const axes = chosen.map(k => { const p = PARAMS[k]; return Array.from({ length: levels }, (_, i) => +(p.min + (p.max - p.min) * (levels > 1 ? i / (levels - 1) : 0.5)).toFixed(3)).map(v => [k, v]); });
  let sets = [{}];
  for (const ax of axes) sets = sets.flatMap(s => ax.map(([k, v]) => ({ ...s, [k]: v })));
  return sets.slice(0, max);
}

/**
 * USGS Short-Term Network high-water marks (api.waterdata.usgs.gov/stnservices) inside a lon/lat box → observations.
 * NAVD88 elevations become water levels; a mark on any other datum (mostly local control points) keeps its height above
 * ground as a depth when it has one; the rest are left out. Every mark is a flooded point.
 */
export function fromSTN(records, [w, s, e, n]) {
  return records.filter(h => h.longitude >= w && h.longitude <= e && h.latitude >= s && h.latitude <= n).flatMap(h => {
    const base = { name: String(h.label || h.site_number || `HWM ${h.id}`), lon: h.longitude, lat: h.latitude, flooded: true,
      source: `USGS STN, ${h.event_name}`, quality: h.hwm_quality_name ?? '', environment: h.environment ?? '' };
    if (/NAVD\s*88/i.test(h.vertical_datum_name ?? '') && Number.isFinite(h.elev_ft)) return [{ ...base, wse: h.elev_ft * FT }];
    if (h.height_above_ground > 0) return [{ ...base, depth: h.height_above_ground * FT }];
    return [];
  });
}
