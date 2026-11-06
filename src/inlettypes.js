// Kinds of storm drain inlet, and which kind each structure in a utility's inlet layer is from its type code.
//
// A utility layer often says what each structure is (Charlotte's StormStructures STRUCT_TYPE: CB, DI, DCB, CI,
// SlabDI 1–4, Elong Throat). classifyInlet turns such a code into a class; a standard (NCDOT for North Carolina) gives
// each class a kind with its own grate opening, weir length and coefficients, which the coupler uses for that grate
// instead of the area's Inlet hydraulics setting (src/drainage.js inletOptions). Outside a standard's region the types
// are listed but every inlet keeps the area's setting until the user picks a kind for a type.

const FT2 = 0.09290304, FT = 0.3048;
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Kinds of inlet: v = [open area m², weir length m, Cw, Co] for one inlet. `est` marks values not read off a standard
 * drawing (named in `basis`). The first five are the generic kinds the Inlet hydraulics select offers.
 */
export const INLET_KINDS = Object.freeze({
  typical: { label: 'Typical street grate', v: [0.2, 2, 0.5, 0.6], basis: 'A 0.6 × 0.35 m street grate. The model’s default.' },
  hec22: { label: 'Street grate, FHWA HEC-22 coefficients', v: [0.2, 2, 0.37, 0.67], basis: 'The same grate with the FHWA HEC-22 grate coefficients (weir 1.66 SI, orifice 0.67). Takes a little less while the water is shallow.' },
  small: { label: 'Small yard or alley grate', v: [0.1, 1.4, 0.5, 0.6], basis: 'About 0.4 × 0.3 m, as in yards, alleys and parking lots.' },
  large: { label: 'Double grate', v: [0.4, 3, 0.5, 0.6], basis: 'Two street grates side by side.' },
  curb: { label: 'Curb opening (a slot in the curb)', v: [0.2, 1.5, 0.28, 0.67], basis: 'A 1.5 m opening about 13 cm high in the face of the curb, with the HEC-22 curb-opening weir coefficient (1.25 SI).' },
  // NCDOT Roadway Standard Drawings, Drainage Box Depths table (rev. 4/24/2026): total clear orifice opening of each grate
  // and, for drop inlets, the weir length. HEC-22 coefficients: grate weir 1.66 SI (Cw 0.37), curb opening 1.25 SI (0.28), orifice 0.67.
  ncdotCB: { label: 'NCDOT catch basin, Type E grate (840.03)', v: [r2(3.1 * FT2), 2.1, 0.37, 0.67], est: 'weir length',
    basis: 'Clear opening 3.1 ft² (0.29 m²), NCDOT 840.03. The weir length, 2.1 m, is estimated: three sides of the grate, the fourth against the curb.' },
  ncdotDCB: { label: 'NCDOT double catch basin (two Type E grates)', v: [r2(2 * 3.1 * FT2), 3.0, 0.37, 0.67], est: 'weir length',
    basis: 'Two 840.03 grates end to end: 6.2 ft² (0.58 m²). The weir length, 3.0 m, is estimated: the long side and both ends.' },
  ncdotDI: { label: 'NCDOT drop inlet grate (840.16)', v: [r2(3.7 * FT2), r2(8.6 * FT), 0.37, 0.67],
    basis: 'Clear opening 3.7 ft² (0.34 m²) and weir length 8.6 ft (2.62 m), NCDOT 840.16, open on all sides.' },
  ncdotCI: { label: 'NCDOT open-throat curb inlet, 6" throat (840.04/.05)', v: [r2(2.15 * FT2), 1.4, 0.28, 0.67], est: 'opening and weir length',
    basis: 'Throat opening 1.8–2.5 ft² for the 6" throat (NCDOT 840.04/.05); 2.15 ft² (0.20 m²) used. The 1.4 m length of the throat is estimated.' },
  ncdotElong: { label: 'NCDOT elongated throat curb inlet, 8" throat', v: [r2(3.3 * FT2), 1.5, 0.28, 0.67], est: 'opening and weir length',
    basis: 'Throat opening 2.3–3.3 ft² for the 8" throat (NCDOT 840.04/.05); the top of the range, 3.3 ft² (0.31 m²), for the longer throat. The 1.5 m length is estimated.' },
  ncdotSlab: { label: 'NCDOT slab-top drop inlet, per open side', v: [0.15, 1.0, 0.28, 0.67], est: 'all four values', perSide: true,
    basis: 'A slab-top drop inlet takes water through openings in its sides under the slab. Per open side, estimated: 0.15 m² and 1.0 m of opening, with the curb-opening weir coefficient. Multiplied by the number of open sides in the type (SlabDI 1–4).' },
});

/** The generic kinds the area-wide Kind of inlet select offers, in order. */
export const GENERIC_KINDS = ['typical', 'hec22', 'small', 'large', 'curb'];

/**
 * The class of an inlet from a utility type code, or null when it is not recognised. Classes: cb (catch basin, a
 * grate at the curb), double (double catch basin), drop (drop inlet: a grate open on all sides, often in a yard or
 * ditch), curb (curb opening, open throat), elong (elongated throat), slab (slab-top drop inlet with `sides` open sides).
 */
export function classifyInlet(type) {
  if (type == null) return null;
  const t = String(type).trim().toLowerCase();
  if (!t) return null;
  const slab = t.match(/slab\s*-?\s*(?:top\s*)?d\.?i\.?\s*(\d)?/);
  if (slab) return { cls: 'slab', sides: Math.max(1, Math.min(4, Number(slab[1] ?? 1))) };
  if (/^dcb$|double|twin/.test(t)) return { cls: 'double' };
  if (/elong/.test(t)) return { cls: 'elong' };
  if (/^ci$|curb|open\s*throat|kerb|^otcb$/.test(t)) return { cls: 'curb' };
  if (/^di$|drop\s*inlet|yard\s*inlet|^yi$/.test(t)) return { cls: 'drop' };
  if (/^cb$|catch\s*basin|grate|gully|^inlet$/.test(t)) return { cls: 'cb' };
  return null;
}

/** Standards: the kind each class takes. `region(lon, lat)` says where the standard applies (it is picked there by default). */
export const INLET_STANDARDS = Object.freeze({
  ncdot: { label: 'NCDOT standard drawings (North Carolina)', kinds: { cb: 'ncdotCB', double: 'ncdotDCB', drop: 'ncdotDI', curb: 'ncdotCI', elong: 'ncdotElong', slab: 'ncdotSlab' },
    region: (lon, lat) => inNorthCarolina(lon, lat) },
  generic: { label: 'Generic kinds (FHWA HEC-22)', kinds: { cb: 'hec22', double: 'large', drop: 'hec22', curb: 'curb', elong: 'curb', slab: 'small' } },
});

// North Carolina, roughly (about 0.1° near the lines): enough to pick a default standard, which the user can change.
const NC = [[-75.40, 36.55], [-81.68, 36.59], [-81.74, 36.34], [-82.03, 36.12], [-82.62, 35.96], [-83.11, 35.77], [-83.88, 35.52],
  [-84.32, 35.21], [-84.30, 34.99], [-83.11, 35.00], [-82.40, 35.20], [-81.04, 35.15], [-80.93, 35.10], [-80.78, 34.82], [-79.67, 34.80],
  [-78.54, 33.85], [-77.90, 33.80], [-75.40, 35.20]];
export function inNorthCarolina(lon, lat) {
  let inside = false;
  for (let i = 0, j = NC.length - 1; i < NC.length; j = i++) {
    const [xi, yi] = NC[i], [xj, yj] = NC[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The standard picked by default at a site: the first whose region holds it, else 'off' (types listed, not applied). */
export function defaultStandard(lon, lat) {
  for (const [k, s] of Object.entries(INLET_STANDARDS)) if (s.region?.(lon, lat)) return k;
  return 'off';
}

/** The hydraulics {inletArea, inletPerim, Cw, Co} of a kind, × open sides for a per-side kind. */
export function kindHydraulics(kind, sides = 1) {
  const k = INLET_KINDS[kind]; if (!k) return null;
  const n = k.perSide ? sides : 1;
  return { inletArea: r2(k.v[0] * n), inletPerim: r2(k.v[1] * n), Cw: k.v[2], Co: k.v[3] };
}

/**
 * The types in a set of inlet records ({type}), most common first: [{ type, count, cls, sides }]. Records without a
 * type are counted under type null.
 */
export function inletTypeCounts(inlets) {
  const m = new Map();
  for (const g of inlets || []) { const t = g.type == null || g.type === '' ? null : String(g.type); m.set(t, (m.get(t) ?? 0) + 1); }
  return [...m].map(([type, count]) => ({ type, count, ...(classifyInlet(type) ?? { cls: null }) })).sort((a, b) => b.count - a.count);
}

/**
 * The kind each type takes: the user's pick (`picks[type]`: a kind, or 'area' for the area's setting) over the
 * standard's kind for its class. Types with neither take the area's setting (absent from the result).
 */
export function typeKinds(types, standard, picks = {}) {
  const std = INLET_STANDARDS[standard], out = {};
  for (const t of types) {
    if (t.type == null) continue;
    const pick = picks[t.type];
    const kind = pick && pick !== 'auto' ? pick : t.cls ? std?.kinds[t.cls] : null;
    if (kind && kind !== 'area' && INLET_KINDS[kind]) out[t.type] = { kind, sides: t.sides ?? 1 };
  }
  return out;
}

/** Inlet records with their own hydraulics (`hyd`) where their type has a kind; the others unchanged. */
export function applyInletKinds(inlets, kinds) {
  if (!inlets?.length || !kinds || !Object.keys(kinds).length) return inlets;
  return inlets.map(g => { const k = g.type != null ? kinds[String(g.type)] : null; return k ? { ...g, hyd: kindHydraulics(k.kind, k.sides) } : g; });
}

/** Field names that hold an inlet's type, most specific first (matched without case, spaces or underscores). */
const TYPE_FIELDS = ['structtype', 'structuretype', 'inlettype', 'strtype', 'structype', 'basintype', 'cbtype', 'assettype', 'featuretype', 'subtype', 'type'];
/** The field of a point layer that holds the inlet type, from its property names, or null. */
export function detectTypeField(fieldNames) {
  const norm = (s) => String(s).toLowerCase().replace(/[\s_.-]/g, '');
  const byNorm = new Map((fieldNames || []).map(f => [norm(f), f]));
  for (const k of TYPE_FIELDS) if (byNorm.has(k)) return byNorm.get(k);
  return null;
}
