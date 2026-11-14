// Soil hydraulics for Green-Ampt infiltration, from the SSURGO soil survey (Soil Data Access): per map unit, the major
// component's near-surface horizons give saturated conductivity, porosity and texture; the map unit gives the depth to
// the seasonal high water table and to bedrock. Texture gives the wetting-front suction head (Rawls, Brakensiek &
// Miller 1983). Where the survey has nothing (Urban land, water), the hydrologic soil group stands in, and compacted
// urban fill below that.
//
// Green-Ampt: infiltration capacity f = K·(1 + ψ·Δθ / F), F = depth infiltrated so far, Δθ = the room left in the pores
// (effective porosity × (1 − initial wetness)). K is half the survey's saturated conductivity (the wetted zone holds
// entrapped air; Bouwer 1966, as Rawls et al. use), from the most restrictive horizon starting in the top 50 cm. The
// ground can hold only Δθ × (depth to the water table or bedrock) before the wetting front reaches it; after that the
// soil is full and takes nothing more (saturation excess), which is where a shallow water table matters.

/** Rawls et al. (1983) Green-Ampt parameters by USDA texture: K (mm/hr), ψ (mm), total and effective porosity. */
export const RAWLS = {
  'sand': [117.8, 49.5, 0.437, 0.417], 'loamy sand': [29.9, 61.3, 0.437, 0.401], 'sandy loam': [10.9, 110.1, 0.453, 0.412],
  'loam': [3.4, 88.9, 0.463, 0.434], 'silt loam': [6.5, 166.8, 0.501, 0.486], 'silt': [6.5, 166.8, 0.501, 0.486],
  'sandy clay loam': [1.5, 218.5, 0.398, 0.330], 'clay loam': [1.0, 208.8, 0.464, 0.309], 'silty clay loam': [1.0, 273.0, 0.471, 0.432],
  'sandy clay': [0.6, 239.0, 0.430, 0.321], 'silty clay': [0.5, 292.2, 0.479, 0.423], 'clay': [0.3, 316.3, 0.475, 0.385],
};
/** Texture standing in for a hydrologic soil group when the survey has no horizon data. */
const HSG_TEXTURE = { A: 'loamy sand', B: 'loam', C: 'sandy clay loam', D: 'clay' };
/** Compacted urban fill (no survey data, no group): the app's 2 mm/hr fill rate with a sandy clay loam's suction. */
export const URBAN_FILL = { K: 2 / 3.6e6, psi: 0.2185, thetaE: 0.33, texture: 'compacted fill', source: 'urban fill default' };
/** Initial wetness (effective saturation before the storm). */
export const WETNESS = { dry: 0.15, normal: 0.4, wet: 0.7, saturated: 0.95 };

/** USDA texture class from sand and clay percent. */
export function textureClass(sand, clay) {
  const silt = 100 - sand - clay;
  if (silt + 1.5 * clay < 15) return 'sand';
  if (silt + 2 * clay < 30) return 'loamy sand';
  if ((clay >= 7 && clay < 20 && sand > 52) || (clay < 7 && silt < 50)) return 'sandy loam';
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'loam';
  if (silt >= 80 && clay < 12) return 'silt';
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && clay < 12)) return 'silt loam';
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'sandy clay loam';
  if (clay >= 27 && clay < 40 && sand > 20) return 'clay loam';
  if (clay >= 27 && clay < 40) return 'silty clay loam';
  if (clay >= 35 && sand > 45) return 'sandy clay';
  if (clay >= 40 && silt >= 40) return 'silty clay';
  return 'clay';
}

/** SQL for the properties of a list of map units (major components, all horizons). */
export const soilPropsQuery = (mukeys) => 'SELECT M.mukey, A.wtdepannmin, A.brockdepmin, C.cokey, C.compname, C.comppct_r, H.hzdept_r, H.ksat_r, H.wsatiated_r, H.sandtotal_r, H.claytotal_r, H.kffact, ' +
  'H.dbovendry_r, H.gypsum_r, H.lep_r, (SELECT SUM(R.fragvol_r) FROM chfrags R WHERE R.chkey = H.chkey) AS fragvol, (SELECT TOP 1 T.taxmoistcl FROM cotaxmoistcl T WHERE T.cokey = C.cokey) AS moist, ' +
  "(SELECT TOP 1 PM.pmkind FROM copmgrp G JOIN copm PM ON PM.copmgrpkey = G.copmgrpkey WHERE G.cokey = C.cokey AND G.rvindicator = 'Yes' ORDER BY PM.pmorder) AS pmkind " +
  `FROM mapunit M JOIN muaggatt A ON A.mukey = M.mukey LEFT JOIN component C ON C.mukey = M.mukey AND C.majcompflag = 'Yes' LEFT JOIN chorizon H ON H.cokey = C.cokey ` +
  `WHERE M.mukey IN (${mukeys.map(k => `'${String(k).replace(/\D/g, '')}'`).join(',')})`;

/**
 * Green-Ampt parameters per map unit from Soil Data Access rows (JSON+COLUMNNAME table, header first).
 * → Map(mukey → { K (m/s), psi (m), thetaE, wt (m or null), bedrock (m or null), texture, kf, source })
 */
export function soilParams(table) {
  const [head, ...rows] = table, col = Object.fromEntries(head.map((h, i) => [h, i])), num = (v) => (v == null || v === '' ? null : Number(v));
  const byUnit = new Map();
  for (const r of rows) {
    const mk = String(r[col.mukey]); if (!byUnit.has(mk)) byUnit.set(mk, { wt: num(r[col.wtdepannmin]), bed: num(r[col.brockdepmin]), comps: new Map() });
    const u = byUnit.get(mk), ck = r[col.cokey]; if (ck == null) continue;
    if (!u.comps.has(ck)) u.comps.set(ck, { name: r[col.compname], pct: num(r[col.comppct_r]) ?? 0, hz: [], moist: col.moist != null ? r[col.moist] : null, pm: col.pmkind != null ? r[col.pmkind] : null });
    if (r[col.hzdept_r] != null) u.comps.get(ck).hz.push({ top: num(r[col.hzdept_r]), ks: num(r[col.ksat_r]), sat: num(r[col.wsatiated_r]), sand: num(r[col.sandtotal_r]), clay: num(r[col.claytotal_r]), kf: num(r[col.kffact]),
      frag: col.fragvol != null ? num(r[col.fragvol]) : null, db: col.dbovendry_r != null ? num(r[col.dbovendry_r]) : null, gyp: col.gypsum_r != null ? num(r[col.gypsum_r]) : null, lep: col.lep_r != null ? num(r[col.lep_r]) : null });
  }
  const out = new Map();
  for (const [mk, u] of byUnit) {
    // the largest major component with conductivity data ("Urban land" components in urban complexes have none)
    const comp = [...u.comps.values()].filter(c => c.hz.some(h => h.ks > 0)).sort((a, b) => b.pct - a.pct)[0];
    const wt = u.wt != null ? u.wt / 100 : null, bedrock = u.bed != null ? u.bed / 100 : null;
    if (!comp) { out.set(mk, { wt, bedrock, source: 'no horizon data' }); continue; }
    const hz = comp.hz.sort((a, b) => a.top - b.top), top = hz[0], near = hz.filter(h => h.top < 50 && h.ks > 0);
    const tex = top.sand != null && top.clay != null ? textureClass(top.sand, top.clay) : null, R = RAWLS[tex] ?? null;
    const ks = near.length ? Math.min(...near.map(h => h.ks)) * 1e-6 * 0.5 : R ? R[0] / 3.6e6 : null; // µm/s → m/s, Bouwer's half
    const thetaE = top.sat != null && R ? Math.max(0.05, top.sat / 100 - (R[2] - R[3])) : R ? R[3] : null;
    if (ks == null || thetaE == null) { out.set(mk, { wt, bedrock, source: 'incomplete horizon data' }); continue; }
    // grain classes of the surface horizon (% of the whole soil): rock fragments (> 2 mm) as gravel, the fine earth's sand and clay
    const g = Math.min(90, Math.max(0, top.frag ?? 0)), grains = top.sand != null && top.clay != null ? { gravel: g, sand: top.sand * (1 - g / 100), clay: top.clay * (1 - g / 100) } : null;
    out.set(mk, { K: ks, psi: (R ? R[1] : 110) / 1000, thetaE, wt, bedrock, texture: tex ?? 'unknown', kf: top.kf, component: comp.name, source: 'SSURGO', grains,
      collapse: collapseScreen(comp), swell: swellClass(comp) });
  }
  return out;
}

/** Parameters for a hydrologic soil group letter (fallback when the survey lacks horizons). */
export function hsgParams(hsg) {
  const R = RAWLS[HSG_TEXTURE[hsg]]; if (!R) return URBAN_FILL;
  return { K: R[0] / 3.6e6, psi: R[1] / 1000, thetaE: R[3], texture: HSG_TEXTURE[hsg], source: `hydrologic group ${hsg}` };
}

/**
 * Per solver cell Green-Ampt inputs from the fine layers (f.ga: K, psi, thetaE, depth per pixel; f.perv: pervious share
 * of each pixel, 0 on streets, buildings and water). Se = initial wetness. `perCellArea` (the subgrid mode) averages over
 * the whole cell, else over its open pixels (as coarsen does). → { K (m/s, cell basis, = infiltration capacity at
 * saturation), psiD (m: ψ·Δθ, pervious-weighted), fmax (m per pervious area), perv }
 */
export function gaCells(f, nx, ny, F, mask, { Se = WETNESS.normal, wtOverride = null, perCellArea = false } = {}) {
  const N = nx * ny, K = new Float64Array(N), psiD = new Float64Array(N), fmax = new Float64Array(N), perv = new Float64Array(N), fnx = f.nx;
  for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    const C = J * nx + I; if (!mask[C]) continue;
    let n = 0, k = 0, p = 0, pd = 0, fm = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const q = j * fnx + i; if (f.bld[q]) continue; n++;
      const w = f.perv[q]; if (!(w > 0)) continue;
      const dth = f.ga.thetaE[q] * (1 - Se), depth = wtOverride ?? f.ga.depth[q];
      k += w * f.ga.K[q]; p += w; pd += w * f.ga.psi[q] * dth; fm += w * (Number.isFinite(depth) ? dth * depth : 1e3);
    }
    const area = perCellArea ? F * F : Math.max(1, n);
    K[C] = k / area; perv[C] = p / area; psiD[C] = p > 0 ? pd / p : 0; fmax[C] = p > 0 ? fm / p : 0;
  }
  return { K, psiD, fmax, perv };
}

// ------------------------------------------------------------------ collapsible and expansive soils (screening)

export const COLLAPSE_CLASSES = ['None', 'Low', 'Moderate', 'High'];
/**
 * Collapse (hydrocompaction) susceptibility of a soil component, a screening score from the survey: soils that lose
 * volume when first wetted under load are low-density, silty, wind- or fan-deposited and dry (Houston, Houston & Lewis
 * 2001; USBR Earth Manual); gypsum dissolves. Points: loess or eolian parent material +2, alluvial fan / debris flow /
 * mudflow / colluvium +1; dry bulk density in the top metre < 1.4 g/cm³ +2, < 1.6 +1; silt ≥ 40 % with clay ≤ 25 % +1,
 * clay > 35 % −2 (clays swell instead); aridic / torric moisture regime +2, ustic / xeric +1; gypsum ≥ 3 % in the top
 * 1.5 m +2. Class: ≥ 5 high, 3–4 moderate, 1–2 low; without a primary driver (loess / eolian, aridic, gypsum), low at
 * most. A flag for geotechnical follow-up (oedometer collapse tests), not
 * a prediction. → { score, cls (0–3), reasons }
 */
export function collapseScreen(comp) {
  const hz = comp.hz.filter(h => h.top < 150), top = comp.hz[0] ?? {}, reasons = []; let score = 0, primary = false;
  const pm = String(comp.pm ?? '').toLowerCase(), moist = String(comp.moist ?? '').toLowerCase();
  if (/loess|eolian|aeolian/.test(pm)) { score += 2; primary = true; reasons.push(`${comp.pm} parent material`); }
  else if (/fan|debris|mudflow|colluvi/.test(pm)) { score += 1; reasons.push(`${comp.pm} parent material`); }
  const db = Math.min(...hz.filter(h => h.top < 100 && h.db > 0).map(h => h.db));
  if (db < 1.4) { score += 2; reasons.push(`dry density ${db.toFixed(2)} g/cm³`); } else if (db < 1.6) { score += 1; reasons.push(`dry density ${db.toFixed(2)} g/cm³`); }
  if (top.sand != null && top.clay != null) {
    const silt = 100 - top.sand - top.clay;
    if (top.clay > 35) { score -= 2; } else if (silt >= 40 && top.clay <= 25) { score += 1; reasons.push(`silty (${Math.round(silt)} % silt)`); }
  }
  if (/aridic|torric/.test(moist)) { score += 2; primary = true; reasons.push(`${comp.moist} (dry climate)`); } else if (/ustic|xeric/.test(moist)) { score += 1; reasons.push(`${comp.moist} moisture regime`); }
  const gyp = Math.max(0, ...hz.map(h => h.gyp ?? 0));
  if (gyp >= 3) { score += 2; primary = true; reasons.push(`gypsum ${gyp} % (dissolves)`); }
  // without a primary driver (wind-laid silt, a dry climate, gypsum) humid soils rarely collapse: at most low
  const cls = score >= 5 ? 3 : score >= 3 ? 2 : score >= 1 ? 1 : 0;
  return { score, cls: primary ? cls : Math.min(cls, 1), reasons };
}
/** Shrink–swell (expansive clay) class from the linear extensibility of the top metre: ≥ 6 % high, 3–6 % moderate, else low. */
export function swellClass(comp) {
  const lep = Math.max(0, ...comp.hz.filter(h => h.top < 100).map(h => h.lep ?? 0));
  return { lep, cls: lep >= 6 ? 3 : lep >= 3 ? 2 : lep > 0 ? 1 : 0 };
}
