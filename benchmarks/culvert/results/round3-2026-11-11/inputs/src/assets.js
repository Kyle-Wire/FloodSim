// Canonical infrastructure records: one description of a physical conduit, whatever the source (a utility's pipe layer,
// the drawer, OpenStreetMap). It keeps what the source said, what is missing, and where each value came from, before
// any solver sees it. The solver representations (realNetwork → SWMM, CulvertLinks → river.js culvertFlow) are built
// from it later; today they still use the legacy fields each adapter also returns, so nothing a run sees has changed
// (docs/specs/canonical-infrastructure.md).
//
// A conduit:
//   source    { type: 'municipal' | 'drawn' | 'osm', id, layer }
//   role      'pipe' | 'culvert' | null        null: the source does not say; a utility pipe whose text says culvert is
//                                            'culvert' ('inferred'); otherwise connectivity decides (endwall to endwall)
//   section   { shape, rise, span, barrels }  shape: 'circle' | 'h-ellipse' | 'v-ellipse' | 'ellipse' | 'arch' | 'box' | null;
//                                            rise and span in m (span = rise for a circle), null when not known
//   material  'concrete' | 'metal' | 'plastic' | 'clay' | 'brick' | 'iron' | null; materialText: the source's own words
//   roughness { n }                           Manning n the source states, else null (the solver's default applies later)
//   ends      { up: { node, invert }, dn: { node, invert }, invertUnits }   up/dn in the source's drawn order; invert as
//                                            recorded (units 'm', or 'resolve': metres or feet, settled against the lidar)
//   direction 'drawn'                         the canonical record never reorders; orientation is decided in the network
//   profile   'ends' | 'unknown'              inverts known at both ends only, or not at all; nothing is assumed between
//   condition { state: 'clear' | 'partial' | 'blocked' | 'unknown', blockedShare, sediment }   a scenario, not a measurement
//   prov      per attribute: 'record' (stated by the source), 'tag' (an OSM tag), 'user' (drawn or typed in the drawer),
//             'inferred' (read from other text: 'Double' → 2 barrels, RCB material → box), 'default' (FloodSim's value),
//             'unknown' (nothing stated, nothing assumed)

export const SHAPES = ['circle', 'h-ellipse', 'v-ellipse', 'ellipse', 'arch', 'box'];
export const MATERIALS = ['concrete', 'metal', 'plastic', 'clay', 'brick', 'iron'];

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pos = (v, max) => { const x = num(v); return x != null && x > 0 && x <= max ? x : null; };

/** A shape description in a source's words → canonical shape, or null when it says nothing usable. */
export function shapeOf(text, rise = null, span = null) {
  const t = String(text ?? '').trim();
  if (!t || /^(unk|unknown|other|n\/?a|none|-)$/i.test(t)) return null;
  if (/ellip|oval/i.test(t)) {
    if (/horiz|\bhe\b/i.test(t)) return 'h-ellipse';
    if (/vert|\bve\b/i.test(t)) return 'v-ellipse';
    return rise > 0 && span > 0 ? (span > rise ? 'h-ellipse' : span < rise ? 'v-ellipse' : 'circle') : 'ellipse';
  }
  if (/arch/i.test(t)) return 'arch';
  if (/box|rect|square|rcb/i.test(t)) return 'box';
  if (/circ|round|^rcp$|^cmp$/i.test(t)) return 'circle';
  return null;
}

/** A material description → canonical class (null when unknown); the source's text is kept beside it. */
export function materialOf(text) {
  const t = String(text ?? '').trim();
  if (!t || /^(unk|unknown|other|n\/?a|none|-)$/i.test(t)) return null;
  if (/rcp|rcb|concrete|\bconc\b|cement/i.test(t)) return 'concrete';
  if (/cmp|corrugat|metal|steel|alumin/i.test(t)) return 'metal';
  if (/pvc|hdpe|plastic|poly/i.test(t)) return 'plastic';
  if (/clay|vcp|vitrif/i.test(t)) return 'clay';
  if (/brick/i.test(t)) return 'brick';
  if (/dip|ductile|cast iron|^ci$|iron/i.test(t)) return 'iron';
  if (/stone|masonry/i.test(t)) return 'brick';
  return null;
}

/** Barrels written into a shape description ('Double box' → 2), or null. */
const barrelsOf = (text) => (/double|twin|dual/i.test(String(text ?? '')) ? 2 : /triple/i.test(String(text ?? '')) ? 3 : null);

function condition(blocked, given) {
  if (!given) return { state: 'unknown', blockedShare: null, sediment: null };
  const b = Math.min(1, Math.max(0, Number(blocked) || 0));
  return { state: b >= 1 ? 'blocked' : b > 0 ? 'partial' : 'clear', blockedShare: b, sediment: null };
}

function section(shape, shapeProv, rise, riseProv, span, spanProv, barrels, barrelsProv) {
  // a circle's span is its rise, known exactly as well as the rise is
  if (shape === 'circle' && rise != null) { span = rise; spanProv = riseProv; }
  return { section: { shape, rise, span, barrels }, prov: { shape: shapeProv, rise: riseProv, span: spanProv, barrels: barrelsProv } };
}

/**
 * A utility pipe-layer feature → canonical conduit. `m` is detectPipeFields' mapping, `u` the size unit in metres.
 * Inverts stay as recorded (plus the datum shift), in units realNetwork settles against the lidar.
 */
export function fromLinked(props, m, { u = 1, datum = 0, line = null, layer = null } = {}) {
  const p = props ?? {};
  const rise = pos(Number(p[m.size]) * u, 6), span = m.width ? pos(Number(p[m.width]) * u, 12) : null;
  const shapeText = m.shape ? p[m.shape] : null, matText = m.material ? p[m.material] : (p.MATL ?? p.MATERIAL ?? null);
  let shape = shapeOf(shapeText, rise, span), shapeProv = shape ? 'record' : 'unknown';
  if (!shape && /rcb|box/i.test(String(matText ?? ''))) { shape = 'box'; shapeProv = 'inferred'; }
  const b = barrelsOf(shapeText);
  const inv = (v) => { const x = num(v); return x == null || x === 0 ? null : x + datum; }; // 0 is how layers leave it blank
  const up = m.upInvert ? inv(p[m.upInvert]) : null, dn = m.dnInvert ? inv(p[m.dnInvert]) : null;
  const material = materialOf(matText), n = m.roughness ? pos(p[m.roughness], 0.2) : null;
  const s = section(shape, shapeProv, rise, rise != null ? 'record' : 'unknown', span, span != null ? 'record' : 'unknown', b ?? 1, b ? 'inferred' : 'default');
  // a layer that calls the pipe a culvert anywhere in its text (Charlotte's NOTES: "single metal culvert")
  const culvert = Object.values(p).some(v => typeof v === 'string' && /\bculvert/i.test(v));
  return {
    source: { type: 'municipal', id: m.id ? (p[m.id] ?? null) : null, layer }, role: culvert ? 'culvert' : null, line,
    section: s.section, material, materialText: matText == null || matText === '' ? null : String(matText),
    roughness: { n },
    ends: { up: { node: m.upNode ? (p[m.upNode] ?? null) : null, invert: up }, dn: { node: m.dnNode ? (p[m.dnNode] ?? null) : null, invert: dn }, invertUnits: 'resolve' },
    direction: 'drawn', profile: up != null && dn != null ? 'ends' : 'unknown',
    condition: condition(null, false),
    prov: { ...s.prov, role: culvert ? 'inferred' : 'unknown', material: material ? 'record' : 'unknown', n: n != null ? 'record' : 'unknown', upInv: up != null ? 'record' : 'unknown', dnInv: dn != null ? 'record' : 'unknown', direction: 'record', condition: 'unknown' },
  };
}

/**
 * A drawer feature (type 'pipe' or 'culvert', SI properties) → canonical conduit. Missing values stay missing. A feature
 * imported from a file (`source` set) is 'record'; one drawn or typed in the drawer is 'user'. `endProv` overrides an
 * end's provenance ('manhole': filled from a manhole within 2 m, as layerInputs does). `defaults` are the drawer's own
 * values for the type (infra.js DEFAULTS): a roughness equal to the drawer's default is the default, not a value the
 * user stated, so a material-based n can take its place (the legacy field keeps it either way).
 */
export function fromDrawn(props, type, { line = null, id = null, endProv = [null, null], defaults = null } = {}) {
  const p = props ?? {}, said = p.source ? 'record' : 'user';
  const rise = pos(p.D, 6), span = pos(p.W, 12);
  const named = SHAPES.includes(p.shapeRecorded) ? p.shapeRecorded : p.shape === 'RECT_CLOSED' ? 'box' : p.shape === 'CIRCULAR' ? 'circle' : SHAPES.includes(p.shape) ? p.shape : null;
  // a drawn culvert has no shape field: the drawer only draws round ones
  const shape = named ?? (type === 'culvert' && rise != null ? 'circle' : null);
  const shapeProv = named ? said : shape ? 'default' : 'unknown';
  const up = num(p.upInv), dn = num(p.dnInv), material = materialOf(p.material), n0 = pos(p.n, 0.2);
  const nIsDefault = n0 != null && defaults?.n != null && n0 === defaults.n && !p.source, n = nIsDefault ? null : n0;
  const b = Number.isInteger(p.barrels) && p.barrels > 0 ? p.barrels : null;
  const s = section(shape, shapeProv, rise, rise != null ? said : 'unknown', span, span != null ? said : 'unknown', b ?? 1, b ? said : 'default');
  return {
    source: { type: 'drawn', id, layer: p.source ?? null }, role: type === 'culvert' ? 'culvert' : 'pipe', line,
    section: s.section, material, materialText: p.material ?? null, roughness: { n },
    ends: { up: { node: null, invert: up }, dn: { node: null, invert: dn }, invertUnits: 'm' },
    direction: 'drawn', profile: up != null && dn != null ? 'ends' : 'unknown',
    condition: condition(p.blocked, p.blocked != null),
    prov: { ...s.prov, material: material ? said : 'unknown', n: n != null ? said : nIsDefault ? 'default' : 'unknown',
      upInv: up != null ? endProv[0] ?? said : 'unknown', dnInv: dn != null ? endProv[1] ?? said : 'unknown', direction: said, condition: p.blocked != null ? 'user' : 'unknown' },
  };
}

/** An OSM culvert (waterway tagged tunnel=culvert) → canonical conduit. `diameter` mm when > 20, else m (as culvertDiameter). */
export function fromOSM(tags = {}, kind = 'stream', { line = null, id = null } = {}) {
  const d = num(Number.parseFloat(tags.diameter)), w = num(Number.parseFloat(tags.width)), h = num(Number.parseFloat(tags.height));
  const D = d > 0 ? (d > 20 ? d / 1000 : d) : null;
  const rise = D ?? (h > 0 && h < 15 ? h : null), span = D ?? (w > 0 && w < 15 ? w : null);
  const shape = D ? 'circle' : shapeOf(tags['culvert:shape'] ?? tags.profile, rise, span);
  const material = materialOf(tags.material);
  const s = section(shape, shape ? 'tag' : 'unknown', rise, rise != null ? 'tag' : 'unknown', span, span != null ? 'tag' : 'unknown', 1, 'default');
  return {
    source: { type: 'osm', id, layer: kind }, role: 'culvert', line,
    section: s.section, material, materialText: tags.material ?? null, roughness: { n: null },
    ends: { up: { node: null, invert: null }, dn: { node: null, invert: null }, invertUnits: 'm' },
    direction: 'drawn', profile: 'unknown', condition: condition(null, false),
    prov: { ...s.prov, material: material ? 'tag' : 'unknown', n: 'unknown', upInv: 'unknown', dnInv: 'unknown', direction: 'tag', condition: 'unknown' },
  };
}

/**
 * The section the solver is given today, from a canonical conduit: the legacy mapping, unchanged, with what it
 * approximates said out loud. A wide arch is a closed rectangle of its rise and the same area (π/4 of the span); an
 * ellipse, and any shape not known, is a circle of its rise; a box with no span is square.
 */
export function legacySection(a) {
  const { shape, rise, span } = a.section;
  if (shape === 'box') return { shape: 'RECT_CLOSED', h: rise, w: span ?? rise, approx: span == null && rise != null ? 'box span unknown: square' : null };
  if (shape === 'arch' && rise && span > rise) return { shape: 'RECT_CLOSED', h: rise, w: span * Math.PI / 4, approx: 'arch as an equal-area rectangle of its rise' };
  const approx = shape === 'circle' ? null : shape ? `${shape} as a circle of its rise` : rise != null ? 'shape unknown: circle' : null;
  return { shape: 'CIRCULAR', h: rise, w: null, approx };
}

/** Full-barrel flow area (m², all barrels) of a canonical section; null when a dimension is missing. */
export function sectionArea(s) {
  const { shape, rise: r, span: w, barrels = 1 } = s;
  if (!(r > 0)) return null;
  const one = shape === 'circle' ? Math.PI / 4 * r * r : shape === 'box' ? (w > 0 ? r * w : null)
    : /ellipse/.test(shape ?? '') ? (w > 0 ? Math.PI / 4 * r * w : null)
    : shape === 'arch' ? (w > 0 ? Math.PI / 4 * r * w : null) : null; // arch: the half-ellipse area the legacy mapping keeps
  return one == null ? null : one * barrels;
}

/** What makes two records the same physical conduit (geometry and material), whatever source they came from. */
export const physicalKey = (a) => {
  const r = (v) => (v == null ? null : +v.toFixed(3));
  return JSON.stringify({ shape: a.section.shape, rise: r(a.section.rise), span: r(a.section.span), barrels: a.section.barrels, material: a.material });
};

// ------------------------------------------------------------------ structures: the records pipe ends point to by id
//
// A structure record (manhole, catch basin, endwall …) is kept as the source gave it. Joining it to the pipe ends that
// name it (US_ASSETID / DS_ASSETID) adds evidence to each end: every value found, where it came from and how it was
// obtained, and the value chosen, with the rule that chose it. Nothing is overwritten and the inputs are not changed.

/** What a structure is, by its type text: an endwall (endwall, flared end, headwall), an inlet (catch basin, drop or
 *  curb inlet, grate), a manhole or junction, or other. */
export function structureClass(type) {
  const t = String(type ?? '').trim();
  if (/endwall|end ?wall|^fes$|flared|headwall|wingwall|outlet ?structure|outfall/i.test(t)) return 'endwall';
  if (/^(cb|dcb|di|ci|gi)$|basin|inlet|grate|curb|slab ?di|throat|gully|catch/i.test(t)) return 'inlet';
  if (/^(mh|jb|jct)$|manhole|junction|junc|vault|chamber/i.test(t)) return 'manhole';
  return t ? 'other' : null;
}

/** How a value was obtained, by the source's words: surveyed (GPS, survey, as-built, field), record (drawings, plans,
 *  original inventory), estimated (aerial, offset, lidar, other), or unstated. */
export function methodClass(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'unstated';
  if (/gps|survey|as-?built|field|measured|total station/i.test(t)) return 'surveyed';
  if (/record|drawing|plan|inventory|design|construction/i.test(t)) return 'record';
  if (/aerial|photo|offset|lidar|estimat|digitiz|other|unknown/i.test(t)) return 'estimated';
  return 'unstated';
}
/** Which source wins when two values for the same invert disagree (earlier wins). A pipe layer rarely says how its
 *  inverts were obtained, so its values are 'unstated'. */
export const PRECEDENCE = ['surveyed', 'record', 'unstated', 'estimated'];

const STRUCT_FIELDS = {
  id: /asset_?id$|facility_?id$|^struct(ure)?_?id$|^(mh|node)_?id$|^facilityid$/i,
  type: /^(struct(ure)?_?type|type|feat(ure)?_?type|subtype|mh_?type|inlet_?type|asset_?type)$/i,
  invert: /^(invert|inv|inv_?elev|invert_?elev(ation)?|bottom|sump_?elev|ie)$/i,
  rim: /^(rim|rim_?elev|top_?elev(at(ion)?)?|grd_?elev|ground)$/i,
  source: /^(data_?source|source|elev_?source|inv_?source|method|collect(ion)?_?method|accuracy)$/i,
  notes: /^(notes|comments?|remarks|std_?cmmnt)$/i,
};
/** Guess which fields of a structure layer hold its id, type, invert, rim, data source and notes. */
export function detectStructureFields(fields) {
  const m = {};
  for (const [k, re] of Object.entries(STRUCT_FIELDS)) m[k] = fields.find(f => re.test(f) && !/const|date/i.test(f)) ?? null;
  return m;
}
/** Structure records from point features: {id, type, class, invert, rim, source, method, notes, lon, lat}. Inverts as
 *  recorded (+ datum), in the same units as the pipe layer's. */
export function structureRecords(features, m, { datum = 0 } = {}) {
  const v = (x) => { const n = num(x); return n == null || n === 0 ? null : n + datum; };
  return features.filter(f => f.kind === 'point' && m.id && f.props?.[m.id] != null).map(f => {
    const p = f.props, type = m.type ? p[m.type] ?? null : null, source = m.source ? p[m.source] ?? null : null;
    return { id: String(p[m.id]), type, class: structureClass(type), invert: m.invert ? v(p[m.invert]) : null, rim: m.rim ? v(p[m.rim]) : null,
      source, method: methodClass(source), notes: m.notes ? p[m.notes] ?? null : null, lon: f.coords[0], lat: f.coords[1] };
  });
}

/**
 * Join structure records to the pipe ends that name them. Returns new pipe records (the inputs are left as they are)
 * whose `asset.ends.up` / `dn` gain:
 *   structure  { id, type, class, method, notes }       the record the end names
 *   evidence   [{ value, from: 'pipe layer' | 'structure record', method, methodClass }]   every value found
 *   resolved   { value, from, method, how }             the value chosen and the rule that chose it
 *   conflict   true when the values disagree beyond `tol` (source units) in a way the structure's type cannot explain:
 *              an endwall has one pipe, so its invert is that pipe's; a manhole's invert is its lowest, so a pipe may
 *              enter above it but not below it
 * `precedence` orders the method classes; on a conflict the higher one is chosen, and a tie keeps the pipe layer's.
 */
export function joinStructures(pipes, structures, { tol = 0.1, precedence = PRECEDENCE } = {}) {
  const byId = new Map(structures.map(s => [String(s.id), s]));
  const rank = (c) => { const i = precedence.indexOf(c); return i < 0 ? precedence.length : i; };
  let matched = 0, conflicts = 0; const missing = new Set();
  const out = pipes.map(r => {
    if (!r.asset) return r;
    const ends = { ...r.asset.ends };
    for (const e of ['up', 'dn']) {
      const end = ends[e], id = end.node == null ? null : String(end.node);
      if (id == null) continue;
      const s = byId.get(id);
      if (!s) { missing.add(id); continue; }
      matched++;
      const ev = [];
      if (end.invert != null) ev.push({ value: end.invert, from: 'pipe layer', method: null, methodClass: 'unstated' });
      if (s.invert != null) ev.push({ value: s.invert, from: 'structure record', method: s.source, methodClass: s.method });
      let resolved = null, conflict = false;
      const [pl, st] = [ev.find(x => x.from === 'pipe layer'), ev.find(x => x.from === 'structure record')];
      if (pl && st) {
        const d = pl.value - st.value;
        if (Math.abs(d) <= tol) resolved = { value: pl.value, from: 'pipe layer', method: s.source, how: 'pipe layer and structure record agree' };
        else if (s.class !== 'endwall' && d > 0) resolved = { value: pl.value, from: 'pipe layer', method: null, how: `enters ${+d.toFixed(3)} above the ${s.class ?? 'structure'}'s invert` };
        else {
          conflict = true; conflicts++;
          const useSt = rank(st.methodClass) < rank(pl.methodClass);
          const w = useSt ? st : pl;
          resolved = { value: w.value, from: w.from, method: w.method, how: `conflict of ${+Math.abs(d).toFixed(3)}: ${useSt ? `${st.methodClass} structure record over the pipe layer` : 'pipe layer kept (the structure record does not rank higher)'}` };
        }
      } else if (st) resolved = { value: st.value, from: 'structure record', method: s.source, how: 'pipe layer blank' };
      else if (pl) resolved = { value: pl.value, from: 'pipe layer', method: null, how: 'structure record has no invert' };
      ends[e] = { ...end, structure: { id, type: s.type, class: s.class, method: s.source, notes: s.notes }, evidence: ev, resolved, conflict };
    }
    return { ...r, asset: { ...r.asset, ends } };
  });
  return { pipes: out, report: { matched, conflicts, missing: [...missing] } };
}
