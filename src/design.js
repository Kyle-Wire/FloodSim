// Site design mode (phase 1 of docs/specs/site-design-mode.md): a proposed development as pure edits to the fine
// (1 m) layers. A scenario is the existing-conditions model plus an ordered list of design features (lon/lat GeoJSON,
// SI units, every value stored on the feature so a later change to a preset default never changes an old scenario):
//
//   building  (polygon)  new building on a level pad: finished floor (FFE), pad, apron falling away, daylight slopes;
//                        presets for the building type; roof water to the ground, the network, a cistern or a green roof
//   demolish  (polygon)  removes mapped buildings in its footprint (the lidar is bare earth: z is already ground)
//   paved     (polygon)  driveway, parking, sidewalk or road: impervious, asphalt or concrete n, optional target
//                        elevation with a cross slope or crown, optional curb
//   grade     (polygon)  a pad: flat at an elevation, a plane through three spot elevations, or flat at the elevation
//                        that balances cut and fill
//
// One grading engine serves all of them: a feature defines a target surface T over its footprint, and outside it the
// ground daylights to the existing grade, z′ = clamp(z, Tₑ − d/S_fill, Tₑ + d/S_cut), d the distance to the
// footprint's edge and Tₑ the target at the nearest footprint point (exact Euclidean distance transform with the
// nearest point, Felzenszwalb & Huttenlocher 2012). Features apply in list order; later ones override earlier ones.
// The baseline arrays are never written: a layer is copied the first time a feature changes it.
import { fillRings, MANNING, IMPERVIOUS, HSG_RATE, URBAN_FILL_RATE } from './terrain.js';
import { hsgParams, URBAN_FILL } from './soil.js';
import { tauFor, NOT_ERODIBLE } from './scour.js';
import { findBanks } from './banks.js';
import { TEXTURES } from './sediment.js';
import { GI } from './gi.js';

const MMHR = 1 / 1000 / 3600;
export const DESIGN_TYPES = ['building', 'demolish', 'paved', 'grade'];
export const FOUNDATIONS = ['slab', 'crawlspace', 'basement', 'piers'];
export const ROOFS = ['ground', 'network', 'cistern', 'green'];

/**
 * Building presets: editable defaults, confirm against the local code. FFE (auto) = the highest of HAG + reveal,
 * BFE + freeboard (when a BFE is given) and a fixed minimum. Reveal 0.15 m after IRC R404.1.6; the apron falls 0.15 m in
 * the first 3 m (IRC R401.3 / IBC 1804.4); paved sides of the apron fall at 2 %.
 */
export const PRESETS = {
  sfr: { label: 'Single-family', foundation: 'slab', reveal: 0.15, apronW: 3, apronFall: 0.15, roof: 'ground', height: 7.5 },
  multi: { label: 'Townhouse / multifamily', foundation: 'slab', reveal: 0.15, apronW: 3, apronFall: 0.15, roof: 'network', height: 12 },
  commercial: { label: 'Commercial / retail', foundation: 'slab', reveal: 0.15, apronW: 1.5, apronFall: 0.03, roof: 'network', height: 6 },
  warehouse: { label: 'Warehouse / industrial', foundation: 'slab', reveal: 0.15, apronW: 1.5, apronFall: 0.03, roof: 'network', height: 10 },
  garage: { label: 'Parking garage', foundation: 'slab', reveal: 0.15, apronW: 1.5, apronFall: 0.03, roof: 'network', height: 9, levels: 3 },
  elevated: { label: 'Elevated (piers)', foundation: 'piers', reveal: 0.15, apronW: 0, apronFall: 0, roof: 'ground', height: 9 },
  shed: { label: 'Accessory / shed', foundation: 'slab', reveal: 0.1, apronW: 0, apronFall: 0, roof: 'ground', height: 3 },
};
export const LEVEL_HEIGHT = 3; // m per parking level
/** A preset's values for a building's properties (without its label). */
const presetValues = (key) => { const { label, ...v } = PRESETS[key]; return structuredClone(v); };
/** Defaults every new feature carries (the preset's values are copied over the building ones). */
export const DEFAULTS = {
  building: { preset: 'sfr', ffeMode: 'auto', ffe: null, minFFE: null, bfe: null, freeboard: null, truckCourt: null, opening: null,
    apronPaved: 0.02, cisternVol: 10, fillSlope: null, cutSlope: null, roofTo: null, ...presetValues('sfr') },
  demolish: {},
  paved: { use: 'driveway', surface: 'asphalt', elev: null, crossSlope: 0.02, slopeDir: 0, crown: false, curb: 0, fillSlope: null, cutSlope: null },
  grade: { mode: 'flat', elev: null, spots: null, fillSlope: null, cutSlope: null },
};
/** Scenario-wide settings: BFE (m NAVD88, a user input: no FEMA data in the app yet), freeboard, daylight slopes (H:V), reach (m). */
export const SETTINGS = { bfe: null, freeboard: 0.3, fillSlope: 3, cutSlope: 2, reach: 50 };
export const N_PAVED = { asphalt: 0.014, concrete: 0.013 };
const PAVED_USES = ['driveway', 'parking', 'sidewalk', 'road'];

/** A new design feature with the defaults (and preset) filled in. */
export function designFeature(type, geometry, props = {}, id = null) {
  const base = structuredClone(DEFAULTS[type]);
  if (type === 'building' && props.preset && PRESETS[props.preset]) Object.assign(base, presetValues(props.preset));
  return { type: 'Feature', id: id ?? nextDesignId(), geometry, properties: { type, ...base, ...props } };
}
let seq = 1;
export const nextDesignId = () => seq++;
export const bumpDesignIds = (fc) => { for (const f of fc?.features ?? []) if (f.id >= seq) seq = f.id + 1; };
/** Apply a preset to a building's properties (keeps the geometry, name and user-set levels / BFE). */
export function applyPreset(props, key) {
  if (!PRESETS[key]) return props;
  Object.assign(props, presetValues(key), { preset: key });
  return props;
}

// ------------------------------------------------------------------ distance transform

/**
 * Exact Euclidean distance transform with the nearest feature point (Felzenszwalb & Huttenlocher 2012), on a w × h
 * grid of unit cells. seed[k] truthy marks feature cells. → { d2: squared distance in cells (Infinity without any
 * feature), near: index of the nearest feature cell (−1 without) }
 */
export function edt(seed, w, h) {
  const N = w * h, INF = 1e20, g = new Float64Array(N), nr = new Int32Array(N);
  for (let i = 0; i < w; i++) { // columns: the nearest feature row
    let last = -1;
    for (let j = 0; j < h; j++) { const k = j * w + i; if (seed[k]) last = j; g[k] = last < 0 ? INF : (j - last) ** 2; nr[k] = last; }
    last = -1;
    for (let j = h - 1; j >= 0; j--) { const k = j * w + i; if (seed[k]) last = j; if (last >= 0) { const d = (last - j) ** 2; if (d < g[k]) { g[k] = d; nr[k] = last; } } }
  }
  const d2 = new Float64Array(N).fill(Infinity), near = new Int32Array(N).fill(-1);
  const v = new Int32Array(w), z = new Float64Array(w + 1), f = new Float64Array(w);
  for (let j = 0; j < h; j++) { // rows: lower envelope of the parabolas (q − p)² + g(p)
    const row = j * w; let k = -1;
    for (let q = 0; q < w; q++) {
      f[q] = g[row + q]; if (f[q] >= INF) continue;
      if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k])); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    if (k < 0) continue;
    for (let q = 0, m = 0; q < w; q++) {
      while (z[m + 1] < q) m++;
      const p = v[m]; d2[row + q] = (q - p) ** 2 + f[p]; near[row + q] = nr[row + p] * w + p;
    }
  }
  return { d2, near };
}

// ------------------------------------------------------------------ hashing

const HASH_KEYS = ['z', 'bld', 'bldH', 'road', 'cls', 'manning', 'infil', 'hsg', 'perv', 'tauC', 'texture', 'grains', 'bedrock', 'collapse', 'swell', 'ga.K', 'ga.psi', 'ga.thetaE', 'ga.depth', 'bldId'];
const get = (f, key) => key.split('.').reduce((o, k) => o?.[k], f);
/** FNV-1a (32-bit) over the bytes of every fine layer, in a fixed order: equal hashes ⇔ (practically) equal grids. */
export function hashFine(f) {
  let h = 0x811c9dc5;
  for (const key of HASH_KEYS) {
    const a = get(f, key); if (!a?.buffer) continue;
    for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ applyDesign

/**
 * Proposed fine model from the baseline and a design.
 * @param f       baseline fine model (src/terrain.js buildFine): never written
 * @param design  { features: [GeoJSON features, lon/lat], settings?: SETTINGS overrides, locked?: { [id]: { ffe, pad } } }
 * @param opts    { toCell: ([lon, lat]) → [col, row] fractional cells (default: coordinates are cells already),
 *                  wse: baseline run's max water surface per fine cell (NaN dry) for the floodplain-fill report,
 *                  water: fine-grid open-water mask (default NLCD open water), hash: false skips hashing the grids }
 * @returns { fine, log }  fine shares every layer the design does not change; log per feature: cells, cut, fill,
 *                         impervious added / removed, floodplain fill, warnings, resolved values; totals; hash
 */
export function applyDesign(f, design, opts = {}) {
  const feats = (design?.features ?? []).filter(x => DESIGN_TYPES.includes(x?.properties?.type));
  const S = { ...SETTINGS, ...Object.fromEntries(Object.entries(design?.settings ?? {}).filter(([, v]) => v != null)) };
  if (!feats.length) return { fine: f, log: { features: [], totals: emptyTotals(), warnings: [], settings: S, hash: null } };
  const { nx, ny } = f, N = nx * ny, dx = f.dx ?? 1, A = dx * dx;
  const toCell = opts.toCell ?? ((p) => p);
  const out = {}; // copies of the layers written so far
  const W = (key) => {
    if (out[key]) return out[key];
    const src = get(f, key);
    return (out[key] = src ? src.slice() : key === 'cls' ? new Uint8Array(N) : key === 'bldId' ? new Int32Array(N) : null);
  };
  const R = (key) => out[key] ?? get(f, key);
  const z0 = f.z, z = W('z');
  const touched = new Int32Array(N).fill(-1); // index of the last feature that changed the cell
  const graded = new Uint8Array(N), footprint = new Uint8Array(N); // ground to become compacted lawn; new building pads
  const water = opts.water ?? (f.cls ? Uint8Array.from(f.cls, c => (c === 11 ? 1 : 0)) : new Uint8Array(N));
  const level = (k) => { const w = opts.wse?.[k], lv = [Number.isFinite(w) ? w : null, S.bfe].filter(v => v != null); return lv.length ? Math.max(...lv) : null; };
  const roofs = new Map(), buildings = [], logs = [];

  feats.forEach((feat, idx) => {
    const p = feat.properties, L = { id: feat.id, type: p.type, name: p.name ?? null, preset: p.preset ?? null, cells: 0, cut: 0, fill: 0,
      impAdded: 0, impRemoved: 0, floodFill: 0, compCut: 0, warnings: [], notes: [], resolved: {} };
    logs.push(L);
    const rings = polyRings(feat.geometry).map(r => r.map(toCell)), cells = [];
    if (rings.length) fillRings(rings, nx, ny, (k) => cells.push(k));
    if (!cells.length) { L.warnings.push('Outside the model grid or smaller than a cell: no effect'); return; }
    const zBefore = new Map(); // z before this feature, for its own cut and fill
    const setZ = (k, v) => { if (v === z[k]) return; if (!zBefore.has(k)) zBefore.set(k, z[k]); z[k] = v; touched[k] = idx; };
    const fillS = num(p.fillSlope) ?? S.fillSlope, cutS = num(p.cutSlope) ?? S.cutSlope;
    const bld = () => R('bld');

    if (p.type === 'demolish') {
      let n = 0;
      for (const k of cells) if (bld()[k]) { W('bld')[k] = 0; W('bldH')[k] = 0; if (R('bldId')) W('bldId')[k] = 0; graded[k] = 1; footprint[k] = 0; touched[k] = idx; n++; }
      L.cells = n; L.resolved = { removedArea: n * A };
      if (!n) L.warnings.push('No mapped building inside: nothing removed');
      else L.notes.push('Ground under the removed building is the lidar bare earth; it becomes compacted lawn');
    } else if (p.type === 'building') {
      const win = windowOf(cells, nx, ny, Math.ceil(((num(p.apronW) ?? 0) + S.reach) / dx) + 2);
      const inFp = new Uint8Array(win.w * win.h); for (const k of cells) inFp[win.local(k)] = 1;
      const eF = edt(inFp, win.w, win.h);
      // HAG: the highest existing (baseline) grade on the ring of cells around the footprint
      let hag = -Infinity, ring = [];
      for (let l = 0; l < inFp.length; l++) if (eF.d2[l] > 0 && eF.d2[l] <= 2) { const k = win.global(l); ring.push(k); hag = Math.max(hag, z0[k]); }
      if (!Number.isFinite(hag)) hag = Math.max(...cells.map(k => z0[k]));
      const reveal = num(p.reveal) ?? 0.15, bfe = num(p.bfe) ?? S.bfe, fb = num(p.freeboard) ?? S.freeboard;
      const mins = [{ v: hag + reveal, why: 'HAG + reveal' }];
      if (bfe != null) mins.push({ v: bfe + fb, why: 'BFE + freeboard' });
      if (num(p.minFFE) != null) mins.push({ v: p.minFFE, why: 'fixed minimum' });
      if (p.preset === 'warehouse' && num(p.truckCourt) != null) mins.push({ v: p.truckCourt + 1.2, why: 'truck court + 1.2 m (dock height)' });
      const gov = mins.reduce((a, b) => (b.v > a.v ? b : a)), ffeMin = gov.v, piers = p.foundation === 'piers';
      const apronW = piers ? 0 : Math.max(0, num(p.apronW) ?? 0), apronFall = num(p.apronFall) ?? 0, paved = num(p.apronPaved) ?? 0.02;
      // target: the pad at finished grade (FFE − reveal) inside, the apron falling away outside
      const region = new Uint8Array(inFp.length), T = new Float64Array(inFp.length), Te = new Float64Array(inFp.length), drop = new Float64Array(inFp.length), dropE = new Float64Array(inFp.length);
      for (let l = 0; l < inFp.length; l++) {
        if (inFp[l]) { region[l] = 1; continue; }
        const d = (Math.sqrt(eF.d2[l]) - 0.5) * dx; if (!(apronW > 0 && d <= apronW + 1e-9)) continue; // cells whose centre is on the apron
        const k = win.global(l); if (bld()[k] && !inFp[l]) continue;
        const pv = R('road')?.[k] === 1; region[l] = 1; drop[l] = pv ? paved * d : apronFall * d / apronW; dropE[l] = pv ? paved * apronW : apronFall;
      }
      const eR = edt(region, win.w, win.h), keep = protectMask(win, bld(), inFp);
      // daylight starts from the apron's outer edge (g − its full fall), or from the pad where there is no apron
      const surface = (g) => { for (let l = 0; l < T.length; l++) if (region[l]) { T[l] = g - drop[l]; Te[l] = inFp[l] ? g : g - dropE[l]; } return daylight(z, win, region, T, Te, eR, fillS, cutS, dx, keep); };
      let ffe, g, mode = p.ffeMode ?? 'auto';
      const lock = design.locked?.[feat.id];
      if (lock && Number.isFinite(lock.ffe)) { ffe = lock.ffe; g = Number.isFinite(lock.pad) ? lock.pad : ffe - reveal; mode = 'locked'; L.notes.push('FFE and pad from the saved scenario'); }
      else if (mode === 'fixed' && num(p.ffe) != null) { ffe = p.ffe; g = ffe - reveal; if (ffe < ffeMin - 1e-6) L.warnings.push(`Fixed FFE ${ffe.toFixed(2)} m is below the minimum ${ffeMin.toFixed(2)} m (${gov.why})`); }
      else if (mode === 'balance' && !piers) { g = balance((gg) => volumes(z, win, surface(gg), dx), ffeMin - reveal, win, z); ffe = g + reveal; }
      else { ffe = ffeMin; g = ffe - reveal; mode = mode === 'fixed' ? 'auto (no fixed FFE given)' : mode; }
      if (piers) {
        L.notes.push('Elevated on piers: flow passes under the building (pier blockage ignored); roof rain lands on the ground at the drip line; ground left as it is');
        L.cells = cells.length;
      } else {
        const zw = surface(g);
        for (let l = 0; l < zw.length; l++) { const k = win.global(l); setZ(k, zw[l]); if (zw[l] !== z0[k] && !inFp[l]) graded[k] = 1; }
        const id = feat.id;
        let overlap = 0, coll = 0, sw = 0;
        for (const k of cells) {
          if (R('bld')[k] && !footprint[k]) overlap++;
          if (f.collapse?.[k] > 0) coll = Math.max(coll, f.collapse[k]);
          if (f.swell?.[k] >= 2) sw = Math.max(sw, f.swell[k]);
          W('bld')[k] = 1; W('bldH')[k] = num(p.height) ?? 0; W('bldId')[k] = id; W('road')[k] = 0; W('perv')[k] = 0; W('infil')[k] = 0; W('ga.K')[k] = 0;
          W('cls')[k] = 24; W('manning')[k] = MANNING[24]; W('tauC')[k] = NOT_ERODIBLE; if (f.collapse) W('collapse')[k] = 0; if (f.swell) W('swell')[k] = 0;
          footprint[k] = 1; graded[k] = 0; touched[k] = idx;
        }
        if (overlap) L.warnings.push(`Overlaps ${overlap * A} m² of a mapped building: demolish it first (drawn after it, the new building replaces it)`);
        if (coll) L.warnings.push(`Building on collapsible soil (${['', 'low', 'moderate', 'high'][coll]} susceptibility): geotechnical follow-up`);
        if (sw) L.warnings.push(`Building on expansive (shrink–swell) soil, ${sw === 3 ? 'high' : 'moderate'}`);
        const retention = p.roof === 'green' ? GI.greenRoofRetention : p.roof === 'cistern' ? Math.max(0, num(p.cisternVol) ?? 0) / (cells.length * A) : 0;
        roofs.set(id, { roof: p.roof ?? 'ground', retention, to: p.roofTo ?? null, area: cells.length * A, name: p.name ?? null });
        if (p.roof === 'cistern') L.notes.push(`Cistern holds the first ${(retention * 1000).toFixed(0)} mm of roof rain (no drawdown during the storm), then overflows to the ground`);
        L.cells = cells.length + [...zBefore.keys()].filter(k => !inFp[win.local(k)]).length;
      }
      buildings.push({ id: feat.id, name: p.name ?? null, preset: p.preset, foundation: p.foundation, ffe, pad: piers ? null : g, opening: p.foundation === 'basement' ? (num(p.opening) ?? ffe) : ffe,
        height: num(p.height) ?? 0, rings: polyRings(feat.geometry), cells, ring });
      L.resolved = { hag, ffeMin, governs: gov.why, ffe, pad: piers ? null : g, mode, reveal, bfe, freeboard: bfe != null ? fb : null, apronW, apronFall, foundation: p.foundation, roof: p.roof, height: num(p.height) ?? 0, footprintArea: cells.length * A };
      if (bfe == null) L.notes.push('No BFE given: FFE from the ground only');
    } else if (p.type === 'paved') {
      const n = N_PAVED[p.surface] ?? N_PAVED.asphalt, curb = Math.max(0, num(p.curb) ?? 0), elev = num(p.elev);
      const own = cells.filter(k => !R('bld')[k]); if (own.length < cells.length) L.warnings.push(`${(cells.length - own.length) * A} m² under buildings left out`);
      if (elev != null && own.length) {
        const win = windowOf(own, nx, ny, Math.ceil(S.reach / dx) + 2), region = new Uint8Array(win.w * win.h); for (const k of own) region[win.local(k)] = 1;
        const T = new Float64Array(region.length), tilt = pavedTilt(own, nx, p, dx);
        for (let l = 0; l < region.length; l++) if (region[l]) T[l] = elev - tilt(win.global(l));
        const zw = daylight(z, win, region, T, T, edt(region, win.w, win.h), fillS, cutS, dx, protectMask(win, R('bld'), region));
        for (let l = 0; l < zw.length; l++) { const k = win.global(l); setZ(k, zw[l]); if (zw[l] !== z0[k] && !region[l]) graded[k] = 1; }
        L.resolved.elev = elev;
      }
      for (const k of own) {
        if (curb > 0) setZ(k, z[k] - curb);
        W('road')[k] = 1; W('perv')[k] = 0; W('infil')[k] = 0; W('manning')[k] = n; W('tauC')[k] = NOT_ERODIBLE; graded[k] = 0; footprint[k] = 0; touched[k] = idx;
      }
      const ownSet = new Set(own); L.cells = own.length + [...zBefore.keys()].filter(k => !ownSet.has(k)).length;
      Object.assign(L.resolved, { use: PAVED_USES.includes(p.use) ? p.use : 'driveway', surface: p.surface, n, curb, area: own.length * A });
    } else if (p.type === 'grade') {
      const own = cells.filter(k => !R('bld')[k]); if (own.length < cells.length) L.warnings.push(`${(cells.length - own.length) * A} m² under buildings left out`);
      if (own.length) {
        const win = windowOf(own, nx, ny, Math.ceil(S.reach / dx) + 2), region = new Uint8Array(win.w * win.h); for (const k of own) region[win.local(k)] = 1;
        const eR = edt(region, win.w, win.h), keep = protectMask(win, R('bld'), region), T = new Float64Array(region.length);
        const surface = (g, plane = null) => { for (let l = 0; l < T.length; l++) if (region[l]) T[l] = plane ? plane(win.global(l)) : g; return daylight(z, win, region, T, T, eR, fillS, cutS, dx, keep); };
        let zw;
        const spots = Array.isArray(p.spots) ? p.spots.map(num) : null, verts = rings[0] ?? [];
        if (p.mode === 'plane' && spots?.length >= 3 && spots.slice(0, 3).every(v => v != null) && verts.length >= 3) {
          const pl = planeThrough(verts.slice(0, 3).map((q, m) => [q[0], q[1], spots[m]]), nx);
          if (!pl) { L.warnings.push('The three spots are in a line: no plane'); zw = null; } else { zw = surface(0, pl.at); L.resolved = { plane: pl.coef }; }
        } else if (p.mode === 'balance') {
          const g = balance((gg) => volumes(z, win, surface(gg), dx), Math.min(...own.map(k => z[k])), win, z); zw = surface(g); L.resolved = { elev: g, mode: 'balance' };
        } else if (num(p.elev) != null) { zw = surface(p.elev); L.resolved = { elev: p.elev, mode: 'flat' }; }
        else { const g = own.reduce((a, k) => a + z[k], 0) / own.length; zw = surface(g); L.resolved = { elev: g, mode: 'flat at the mean ground (no elevation given)' }; }
        if (zw) for (let l = 0; l < zw.length; l++) { const k = win.global(l); setZ(k, zw[l]); if (zw[l] !== z0[k]) graded[k] = 1; }
      }
      L.cells = new Set([...own, ...zBefore.keys()]).size;
    }
    // this feature's own cut and fill (against the ground before it), and checks on the ground it changed
    for (const [k, zb] of zBefore) { const dz = z[k] - zb; if (dz > 0) L.fill += dz * A; else L.cut -= dz * A; }
    if (zBefore.size) checks(L, [...zBefore.keys()], z, z0, f, water, nx, ny, dx, idx, touched);
  });

  // graded ground becomes compacted lawn: one hydrologic group down (A→B, B→C, C→D), Green-Ampt of the new group (placed
  // fill: the compacted-fill rate); native texture kept (erodible); lawn n and pervious share
  const lawnPerv = 1 - IMPERVIOUS[21];
  for (let k = 0; k < N; k++) {
    if (!graded[k] || R('bld')[k] || R('road')?.[k]) continue;
    const h0 = f.hsg?.[k] ?? 0, h = h0 ? Math.min(4, h0 + 1) : 0, fillHere = z[k] > z0[k] + 0.005;
    const gp = fillHere || !h ? URBAN_FILL : hsgParams('ABCD'[h - 1]);
    W('hsg')[k] = h; W('ga.K')[k] = gp.K; W('ga.psi')[k] = gp.psi; W('ga.thetaE')[k] = gp.thetaE;
    W('cls')[k] = 21; W('manning')[k] = MANNING[21]; W('perv')[k] = lawnPerv;
    W('infil')[k] = (fillHere || !h ? URBAN_FILL_RATE : HSG_RATE['ABCD'[h - 1]]) * lawnPerv * MMHR;
    const tx = f.texture ? texName(f.texture[k]) : 'compacted fill'; W('tauC')[k] = tauFor(lawnPerv, 21, tx);
  }
  // soil depth to bedrock and to the water table move with the ground
  const totals = emptyTotals(), bldA = R('bld'), pervA = R('perv');
  for (let k = 0; k < N; k++) {
    const dz = z[k] - z0[k];
    if (dz !== 0) {
      if (f.bedrock && Number.isFinite(f.bedrock[k])) W('bedrock')[k] = Math.max(0, f.bedrock[k] + dz);
      if (f.ga?.depth && Number.isFinite(f.ga.depth[k])) W('ga.depth')[k] = Math.max(0.05, f.ga.depth[k] + dz);
      if (dz > 0) totals.fill += dz * A; else totals.cut -= dz * A;
      const lv = level(k);
      if (lv != null) {
        const ff = Math.max(0, Math.min(z[k], lv) - z0[k]) * A, cc = Math.max(0, Math.min(z0[k], lv) - z[k]) * A;
        totals.floodFill += ff; totals.compCut += cc;
        if (touched[k] >= 0) { logs[touched[k]].floodFill += ff; logs[touched[k]].compCut += cc; }
      }
    }
    if (touched[k] < 0) continue; // never touched: unchanged
    const d = (bldA[k] ? 1 : 1 - pervA[k]) - baseImpervious(f, k);
    if (d !== 0) { if (d > 0) totals.impAdded += d * A; else totals.impRemoved -= d * A; if (touched[k] >= 0) { if (d > 0) logs[touched[k]].impAdded += d * A; else logs[touched[k]].impRemoved -= d * A; } }
  }
  totals.net = totals.fill - totals.cut;

  const ga = out['ga.K'] || out['ga.psi'] || out['ga.thetaE'] || out['ga.depth'] ? { ...f.ga, K: R('ga.K'), psi: R('ga.psi'), thetaE: R('ga.thetaE'), depth: R('ga.depth') } : f.ga;
  const fine = { ...f, ga, bldId: R('bldId') ?? null, roofs, designBuildings: buildings };
  for (const [key, a] of Object.entries(out)) if (!key.startsWith('ga.')) fine[key] = a;
  let bldCells = 0, roadCells = 0; const fb = fine.bld, fr = fine.road; for (let k = 0; k < N; k++) { if (fb[k]) bldCells++; else if (fr?.[k]) roadCells++; }
  fine.stats = { ...f.stats, buildingArea: bldCells * A, roadArea: roadCells * A, design: totals };
  const log = { features: logs, totals, warnings: logs.flatMap(l => l.warnings.map(w => `${label(l)}: ${w}`)), settings: S, hash: opts.hash === false ? null : hashFine(fine) };
  return { fine, log };
}

const emptyTotals = () => ({ cut: 0, fill: 0, net: 0, impAdded: 0, impRemoved: 0, floodFill: 0, compCut: 0 });
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const label = (l) => l.name || `${l.type} ${l.id}`;
const texName = (i) => TEXTURES[i] ?? 'compacted fill';
/** Impervious share of a baseline pixel (buildings count as impervious). */
const baseImpervious = (f, k) => (f.bld[k] ? 1 : 1 - f.perv[k]);
const polyRings = (g) => (g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates.flat() : []);

/** A window around a set of cells, padded by `pad` cells and clipped to the grid. */
function windowOf(cells, nx, ny, pad) {
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const k of cells) { const i = k % nx, j = (k / nx) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  i0 = Math.max(0, i0 - pad); j0 = Math.max(0, j0 - pad); i1 = Math.min(nx - 1, i1 + pad); j1 = Math.min(ny - 1, j1 + pad);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  return { i0, j0, w, h, nx, ny, local: (k) => (((k / nx) | 0) - j0) * w + (k % nx) - i0, global: (l) => (j0 + ((l / w) | 0)) * nx + i0 + (l % w),
    edge: (l) => { const i = l % w, j = (l / w) | 0; return (i === 0 && i0 > 0) || (j === 0 && j0 > 0) || (i === w - 1 && i1 < nx - 1) || (j === h - 1 && j1 < ny - 1); } };
}
/** Cells the daylight slopes leave alone: buildings outside the feature's own footprint. */
function protectMask(win, bld, own) {
  const keep = new Uint8Array(win.w * win.h);
  for (let l = 0; l < keep.length; l++) if (bld[win.global(l)] && !own[l]) keep[l] = 1;
  return keep;
}

/**
 * The grading engine on a window: region cells take T; the rest daylight to the current ground with
 * z′ = clamp(z, Tₑ − d/S_fill, Tₑ + d/S_cut), d = (distance to the nearest region cell centre − ½ cell) = the distance
 * to the region's edge, Tₑ the edge value at that nearest cell. A slope ratio of 0 is vertical (a retaining wall: no
 * daylight). Cells in `keep` stay as they are. → Float64Array z′ over the window
 */
function daylight(z, win, region, T, Te, eR, sFill, sCut, dx, keep) {
  const zw = new Float64Array(region.length);
  for (let l = 0; l < zw.length; l++) {
    const k = win.global(l), zk = z[k];
    if (region[l]) { zw[l] = keep[l] ? zk : T[l]; continue; }
    if (keep[l] || eR.near[l] < 0) { zw[l] = zk; continue; }
    const d = (Math.sqrt(eR.d2[l]) - 0.5) * dx, te = Te[eR.near[l]];
    const lo = sFill > 0 ? te - d / sFill : -Infinity, hi = sCut > 0 ? te + d / sCut : Infinity;
    zw[l] = zk < lo ? lo : zk > hi ? hi : zk;
  }
  return zw;
}
/** Cut and fill (m³) of a graded window against the current ground. */
function volumes(z, win, zw, dx) {
  let cut = 0, fill = 0;
  for (let l = 0; l < zw.length; l++) { const d = zw[l] - z[win.global(l)]; if (d > 0) fill += d; else cut -= d; }
  return { cut: cut * dx * dx, fill: fill * dx * dx };
}
/**
 * The level at or above `lo` that balances cut and fill: cut − fill falls as the level rises, so bisection on its root
 * (at `lo` when fill already exceeds cut there).
 */
function balance(vol, lo, win, z) {
  const diff = (g) => { const v = vol(g); return v.cut - v.fill; };
  if (diff(lo) <= 0) return lo;
  let zmax = -Infinity; for (let l = 0; l < win.w * win.h; l++) zmax = Math.max(zmax, z[win.global(l)]);
  let a = lo, b = Math.max(lo + 0.01, zmax + 0.01);
  while (diff(b) > 0) b += Math.max(1, b - a);
  for (let it = 0; it < 60 && b - a > 1e-5; it++) { const m = (a + b) / 2; if (diff(m) > 0) a = m; else b = m; }
  return (a + b) / 2;
}
/** Plane z = a + b·col + c·row through three [col, row, z] points (null when they are in a line). */
function planeThrough(P, nx) {
  const [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]] = P, det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (Math.abs(det) < 1e-9) return null;
  const b = ((z2 - z1) * (y3 - y1) - (z3 - z1) * (y2 - y1)) / det, c = ((x2 - x1) * (z3 - z1) - (x3 - x1) * (z2 - z1)) / det, a = z1 - b * x1 - c * y1;
  return { coef: { a, b, c }, at: (k) => a + b * (k % nx + 0.5) + c * (((k / nx) | 0) + 0.5) };
}
/**
 * Fall below the target elevation of a paved area: a cross slope falling toward the azimuth `slopeDir` (degrees from
 * north), or a crown falling both ways from the long axis through the centroid. → (cell) → metres below `elev`
 */
function pavedTilt(cells, nx, p, dx) {
  const s = Math.max(0, num(p.crossSlope) ?? 0); if (!s) return () => 0;
  let cx = 0, cy = 0; for (const k of cells) { cx += k % nx + 0.5; cy += ((k / nx) | 0) + 0.5; } cx /= cells.length; cy /= cells.length;
  if (p.crown) { // minor axis of the footprint (principal axes of its cells)
    let sxx = 0, syy = 0, sxy = 0; for (const k of cells) { const x = k % nx + 0.5 - cx, y = ((k / nx) | 0) + 0.5 - cy; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = -Math.sin(th), uy = Math.cos(th); // normal to the long axis
    return (k) => s * Math.abs((k % nx + 0.5 - cx) * ux + (((k / nx) | 0) + 0.5 - cy) * uy) * dx;
  }
  const az = (num(p.slopeDir) ?? 0) * Math.PI / 180, ux = Math.sin(az), uy = -Math.cos(az); // rows run south
  return (k) => s * ((k % nx + 0.5 - cx) * ux + (((k / nx) | 0) + 0.5 - cy) * uy) * dx;
}

/** Warnings on the ground a feature changed: fill into open water, slopes over 2:1, grading within 20 m of a bank. */
function checks(L, changed, z, z0, f, water, nx, ny, dx, idx, touched) {
  const A = dx * dx;
  let wet = 0; for (const k of changed) if (water[k] && z[k] > z0[k] + 0.005) wet++;
  if (wet) L.warnings.push(`Fill placed in open water on ${(wet * A).toLocaleString()} m²`);
  let steep = 0;
  for (const k of changed) {
    if (f.bld[k] || touched[k] !== idx) continue;
    const i = k % nx, j = (k / nx) | 0;
    for (const [a, b] of [[i + 1, j], [i, j + 1], [i - 1, j], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a, s1 = Math.abs(z[q] - z[k]) / dx, s0 = Math.abs(z0[q] - z0[k]) / dx;
      if (s1 > 0.5 + 1e-3 && s1 > s0 + 1e-3) { steep++; break; }
    }
  }
  if (steep) L.warnings.push(`Slopes steeper than 2:1 on ${steep} cells${steep > 3 ? ' (retaining wall or a vertical edge)' : ''}`);
  if (!f.texture || !changed.length) return;
  const win = windowOf(changed, nx, ny, Math.ceil(20 / dx) + 1), M = win.w * win.h;
  const wl = new Uint8Array(M); let anyWater = false; for (let l = 0; l < M; l++) if (water[win.global(l)]) { wl[l] = 1; anyWater = true; }
  if (!anyWater) return;
  const pick = (a, n = 1) => { if (!a) return null; const o = new a.constructor(M * n); for (let l = 0; l < M; l++) { const k = win.global(l); for (let m = 0; m < n; m++) o[l * n + m] = a[k * n + m]; } return o; };
  const zw = new Float64Array(M), mask = new Uint8Array(M), bld = pick(f.bld);
  for (let l = 0; l < M; l++) { zw[l] = z[win.global(l)]; mask[l] = bld[l] ? 0 : 1; }
  const sub = { nx: win.w, bld, texture: pick(f.texture), grains: pick(f.grains, 4), cls: pick(f.cls), bedrock: pick(f.bedrock), ga: { K: pick(f.ga?.K), thetaE: pick(f.ga?.thetaE), depth: pick(f.ga?.depth) } };
  const { banks } = findBanks({ nx: win.w, ny: win.h, z: zw, mask }, 1, sub, wl, { reach: 20 / dx });
  if (!banks.length) return;
  const ch = new Uint8Array(M); for (const k of changed) ch[win.local(k)] = 1;
  const e = edt(ch, win.w, win.h), lim = (20 / dx) ** 2, near = banks.filter(b => e.d2[b.top] <= lim).length;
  if (near) L.warnings.push(`Grading within 20 m of ${near} bank-top cells (on the graded ground): check bank stability`);
}

/**
 * Buildings flooded in a run: the max water surface on the ring of cells around each new building against its FFE (the
 * lowest opening for a basement). wse: max water surface per fine cell (NaN dry). → [{ id, name, maxWse, ffe, flooded }]
 */
export function floodedBuildings(fine, wse) {
  return (fine.designBuildings ?? []).map(b => {
    let m = -Infinity; for (const k of b.ring) if (Number.isFinite(wse[k])) m = Math.max(m, wse[k]);
    const crit = b.foundation === 'basement' ? b.opening : b.ffe;
    return { id: b.id, name: b.name, maxWse: Number.isFinite(m) ? m : null, ffe: b.ffe, critical: crit, flooded: Number.isFinite(m) && m > crit };
  });
}

/** Values to keep in scenario.json: presets used and every resolved value, per feature. */
export function resolvedValues(design, log) {
  const used = new Set((design.features ?? []).map(f => f.properties.preset).filter(Boolean));
  return {
    presets: Object.fromEntries([...used].map(k => [k, PRESETS[k]])),
    settings: log.settings,
    features: Object.fromEntries(log.features.map(l => [l.id, { type: l.type, name: l.name, ...l.resolved, cut_m3: l.cut, fill_m3: l.fill, warnings: l.warnings }])),
    totals: log.totals, hash: log.hash,
  };
}
