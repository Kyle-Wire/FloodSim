// Native SWMM conduit inputs from a canonical conduit record (src/assets.js). OPT-IN: realNetwork uses this only with
// `nativeSections`. Without that option every pipe keeps the legacy section (assets.legacySection), and the .inp is
// unchanged byte for byte.
//
// What it writes, and why each choice was made (docs/specs/swmm-culvert-inputs.md):
//   shape      the canonical shape as SWMM's own shape, where SWMM's shape matches the conduit. Otherwise a CUSTOM
//              shape curve drawn from the conduit's real geometry:
//              - circle: CIRCULAR.
//              - box: RECT_CLOSED.
//              - h-/v-ellipse (T2 decision, 11 Nov 2026), three cases:
//                · the source NAMES the ASTM C507 profile (section.standard) and the axes are one of its sizes:
//                  SWMM's standard ellipse by its size code, qualified. SWMM's code tables are not an ideal ellipse
//                  (code 9: full area +3.7 %, part-full area −7 to +7 %); the designation and the code are both kept
//                  (`designation`) and the discrepancy is listed in `approx`. The two geometries are not interchangeable.
//                · rise and span only: CUSTOM, an exact elliptical width curve of the recorded axes.
//                · rise and span only, but they match a C507 size: the same exact ellipse, flagged as an ambiguous
//                  profile (the pipe may be a C507 pipe whose real section is SWMM's table, not an ellipse).
//                (SWMM's non-standard ellipse takes its area from the minor axis alone, 1.2692 · minor², which B1
//                found 2.3 % off for 38 × 60 in; it is never written.)
//              - arch: ARCH, SWMM's corrugated pipe-arch profile. A record does not give an arch's geometry, so
//                that profile is an assumption, and it is flagged.
//   sediment   a depth (m) from the scenario. A circle becomes FILLED_CIRCULAR. Any other shape becomes CUSTOM, cut at
//              the sediment and drawn from the same geometry. SWMM measures a conduit's depth from the bottom of its
//              open area, so both offsets rise by the sediment depth. A barrel filled to its crown is refused,
//              never squeezed into a thin slot.
//   roughness  the record's own n, else the material table (project-configurable), else the network's default n.
//   culvert    the FHWA HDS-5 inlet-control code (SWMM [XSECTIONS] 8th column) for the barrel's shape, material and
//              entrance. It goes on a culvert's ENTRANCE length only: SWMM applies inlet control at a conduit's
//              upstream node, so a code on an interior length would put a false inlet in the barrel.
//   losses     HDS-5 entrance loss Ke on the entrance length and an exit loss on the exit length ([LOSSES]).
//              Interior lengths get none.
//
// Every value carries its source (`prov`). Every place where the SWMM input is not the conduit as recorded is listed
// in `approx`.

export const ROUGHNESS = Object.freeze({ // Manning n by material: typical design values. Override per project.
  concrete: { n: 0.013, range: [0.011, 0.015], basis: 'concrete pipe or box' },
  metal: { n: 0.024, range: [0.021, 0.027], basis: 'corrugated metal, 2⅔ × ½ in annular corrugations' },
  plastic: { n: 0.012, range: [0.009, 0.024], basis: 'plastic: smooth wall 0.009–0.012, corrugated wall 0.018–0.024', approx: 'plastic wall type not stated' },
  clay: { n: 0.013, range: [0.011, 0.015], basis: 'vitrified clay' },
  brick: { n: 0.015, range: [0.012, 0.017], basis: 'brick or masonry' },
  iron: { n: 0.013, range: [0.011, 0.015], basis: 'ductile or cast iron' },
});

export const ENTRANCES = ['headwall', 'groove-headwall', 'projecting', 'mitered', 'end-section', 'beveled', 'wingwall'];

// HDS-5 entrance loss coefficients Ke. Barrel families: 'pipe' (concrete and other smooth pipe), 'metal' (corrugated
// metal pipe, pipe-arch, ellipse), 'box' (concrete box). A corrugated metal box uses 'metal'.
export const ENTRANCE_LOSS = Object.freeze({
  pipe: { headwall: 0.5, 'groove-headwall': 0.2, projecting: 0.5, mitered: 0.7, 'end-section': 0.5, beveled: 0.2, wingwall: 0.5 },
  metal: { headwall: 0.5, 'groove-headwall': 0.5, projecting: 0.9, mitered: 0.7, 'end-section': 0.5, beveled: 0.2, wingwall: 0.5 },
  box: { headwall: 0.5, 'groove-headwall': 0.5, projecting: 0.7, mitered: 0.7, 'end-section': 0.5, beveled: 0.2, wingwall: 0.4 },
});

// SWMM 5.2 culvert codes (vendor/swmm/src/solver/culvert.c, Params rows 1–57). [code, approximation or null].
const C = (code, approx = null) => [code, approx];
const CODES = {
  'circle/concrete': { headwall: C(1), 'groove-headwall': C(2), projecting: C(3, 'concrete projecting: groove-end projecting code'),
    mitered: C(5, 'no concrete mitered code: corrugated metal mitered'), 'end-section': C(1, 'end section: square-edge headwall code'),
    beveled: C(7), wingwall: C(1, 'pipe with wingwalls: square-edge headwall code') },
  'circle/metal': { headwall: C(4), 'groove-headwall': C(4, 'metal pipe has no groove end: headwall code'), projecting: C(6), mitered: C(5),
    'end-section': C(4, 'end section: headwall code'), beveled: C(7), wingwall: C(4, 'pipe with wingwalls: headwall code') },
  'box/concrete': { headwall: C(10), 'groove-headwall': C(10, 'box: square-edge headwall code'), projecting: C(11, 'box projecting: 0° wingwall (straight sides) code'),
    mitered: C(10, 'box mitered: headwall code'), 'end-section': C(10, 'end section: headwall code'), beveled: C(15), wingwall: C(9) },
  'box/metal': { headwall: C(27), 'groove-headwall': C(27, 'metal box: headwall code'), projecting: C(29), mitered: C(27, 'metal box mitered: headwall code'),
    'end-section': C(27, 'end section: headwall code'), beveled: C(27, 'metal box bevel: headwall code'), wingwall: C(27, 'metal box wingwalls: headwall code') },
  'h-ellipse/concrete': { headwall: C(30), 'groove-headwall': C(31), projecting: C(32), mitered: C(30, 'ellipse mitered: headwall code'),
    'end-section': C(30, 'end section: headwall code'), beveled: C(30, 'ellipse bevel: headwall code'), wingwall: C(30, 'ellipse with wingwalls: headwall code') },
  'v-ellipse/concrete': { headwall: C(33), 'groove-headwall': C(34), projecting: C(35), mitered: C(33, 'ellipse mitered: headwall code'),
    'end-section': C(33, 'end section: headwall code'), beveled: C(33, 'ellipse bevel: headwall code'), wingwall: C(33, 'ellipse with wingwalls: headwall code') },
  'arch/metal': { headwall: C(45), 'groove-headwall': C(45, 'metal arch: headwall code'), projecting: C(47), mitered: C(46),
    'end-section': C(45, 'end section: headwall code'), beveled: C(45, 'arch bevel: headwall code'), wingwall: C(45, 'arch with wingwalls: headwall code') },
};

export const NATIVE_DEFAULTS = Object.freeze({
  roughness: ROUGHNESS, // material → { n }
  entrance: 'headwall', // assumed entrance when no structure record says otherwise
  exitLoss: 1.0, // HDS-5 outlet loss: the full barrel velocity head (see the spec: possible double count at a 2D outfall)
  ellipseStdTolIn: 0.5, // an ellipse designated ASTM C507 within this (in) of a C507 size on both axes takes SWMM's size code (-1: never)
  mergeBarrels: true, // Stage B T1: one conduit per continuous physical barrel (network-real.js mergeBarrels); false = one per record
  curvePoints: 41, // custom shape curves: points, cosine-spaced so the steep ends of an ellipse are drawn finely
  culvertCodes: true, // write inlet-control codes on culvert entrance lengths
  losses: true, // write [LOSSES] on culvert entrance and exit lengths
  circleSediment: 'cut', // a silted circle: 'cut' = an exact CUSTOM section cut at the fill; 'filled' = SWMM's FILLED_CIRCULAR, whose conveyance B6 found 3–6 % high
});

// SWMM's standard elliptical pipe sizes (xsect.dat: ASTM C507 concrete): minor and major axis (in), full area (ft²)
const STD_ELLIPSE = { minor: [14, 19, 22, 24, 27, 29, 32, 34, 38, 43, 48, 53, 58, 63, 68, 72, 77, 82, 87, 92, 97, 106, 116],
  major: [23, 30, 34, 38, 42, 45, 49, 53, 60, 68, 76, 83, 91, 98, 106, 113, 121, 128, 136, 143, 151, 166, 180],
  area: [1.8, 3.3, 4.1, 5.1, 6.3, 7.4, 8.8, 10.2, 12.9, 16.6, 20.5, 24.8, 29.5, 34.6, 40.1, 46.1, 52.4, 59.2, 66.4, 74, 82, 99.2, 118.6] };
/** SWMM's standard-ellipse size code (1…23) for a minor × major axis (m), or 0. */
export function stdEllipseCode(minor, major, tolIn = 0.5) {
  const a = minor / 0.0254, b = major / 0.0254;
  const i = STD_ELLIPSE.minor.findIndex((m, k) => Math.abs(m - a) <= tolIn && Math.abs(STD_ELLIPSE.major[k] - b) <= tolIn);
  return i + 1;
}
const W_ARCH = [0, 0.6272, 0.8521, 0.9243, 0.9645, 0.9846, 0.9964, 0.9988, 0.9917, 0.9811, 0.968, 0.9515, 0.9314, 0.9101, 0.8864,
  0.8592, 0.8284, 0.7917, 0.7527, 0.7065, 0.6544, 0.5953, 0.5231, 0.4355, 0.3195, 0]; // SWMM xsect.dat W_Arch: width/wMax at y/yFull = 0, 0.04 … 1

/** Width (m) of a full section at height y (m) above its invert. */
function widthAt(shape, rise, span, y) {
  const t = Math.min(1, Math.max(0, y / rise));
  if (shape === 'box') return span;
  if (shape === 'circle' || /ellipse/.test(shape)) return span * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  if (shape === 'arch') { const x = t * 25, i = Math.min(24, Math.floor(x)); return span * (W_ARCH[i] + (W_ARCH[i + 1] - W_ARCH[i]) * (x - i)); }
  return null;
}

/** A SWMM SHAPE curve for the open part of a section above `sed` (m): [[depth/open height, width/open height]…]. */
function shapeCurve(shape, rise, span, sed, nPts) {
  const open = rise - sed, pts = [];
  for (let m = 0; m < nPts; m++) {
    const u = (1 - Math.cos(Math.PI * m / (nPts - 1))) / 2; // 0…1 of the open height
    pts.push([u, widthAt(shape, rise, span, sed + u * open) / open]);
  }
  return pts;
}

/** Open area (m², one barrel) of the curve as SWMM integrates it (trapezoids between curve points). */
export function curveArea(pts, open) {
  let a = 0; for (let m = 1; m < pts.length; m++) a += (pts[m][0] - pts[m - 1][0]) * (pts[m][1] + pts[m - 1][1]) / 2;
  return a * open * open;
}

/** Exact open area (m², one barrel) of a canonical section above a sediment depth. */
export function openArea(shape, rise, span, sed = 0) {
  if (!(rise > 0) || !(span > 0) || sed >= rise) return null;
  if (shape === 'box') return span * (rise - sed);
  if (shape === 'circle' || /ellipse/.test(shape)) { // ellipse segment above the cut
    const a = rise / 2, b = span / 2, z = sed / a - 1; // z in [-1, 1]
    const seg = a * b * (Math.acos(z) - z * Math.sqrt(1 - z * z)); // area of the ellipse above height z·a from its centre
    return seg;
  }
  if (shape === 'arch') { let s = 0; const n = 400; for (let m = 0; m < n; m++) { const y = sed + (m + 0.5) * (rise - sed) / n; s += widthAt('arch', rise, span, y); } return s * (rise - sed) / n; }
  return null;
}

/** Where a structure's type text says what kind of entrance the barrel has. */
export function entranceOf(text) {
  const t = String(text ?? '');
  if (/flared|\bfes\b|end ?sect/i.test(t)) return 'end-section';
  if (/miter/i.test(t)) return 'mitered';
  if (/project/i.test(t)) return 'projecting';
  if (/bevel/i.test(t)) return 'beveled';
  if (/wing/i.test(t)) return 'wingwall';
  if (/head ?wall|end ?wall/i.test(t)) return 'headwall';
  return null;
}

const family = (shape, material) => (material === 'metal' ? 'metal' : shape === 'box' ? 'box' : 'pipe');

/**
 * The HDS-5 culvert code for a barrel: { code, approx, key }. `material` null is taken as concrete (or as metal for an
 * arch), and says so.
 */
export function culvertCode(shape, material, entrance) {
  const notes = [];
  let mat = material === 'metal' ? 'metal' : 'concrete';
  if (material == null) notes.push(shape === 'arch' ? 'material unknown: metal arch codes' : 'material unknown: concrete codes');
  else if (!['metal', 'concrete'].includes(material)) notes.push(`${material}: concrete codes`);
  let sh = shape;
  if (shape === 'arch') { if (mat !== 'metal' && material != null) notes.push('no concrete arch code: metal arch'); mat = 'metal'; }
  if (/ellipse/.test(shape ?? '') && mat === 'metal') { notes.push('no corrugated metal ellipse code: concrete ellipse'); mat = 'concrete'; }
  if (shape === 'ellipse') { notes.push('ellipse orientation unknown: horizontal'); sh = 'h-ellipse'; }
  if (shape == null) { notes.push('shape unknown: circular codes'); sh = 'circle'; }
  const row = CODES[`${sh}/${mat}`]?.[entrance];
  if (!row) return { code: 0, approx: [`no culvert code for ${sh}/${mat}/${entrance}`], key: null };
  if (row[1]) notes.push(row[1]);
  return { code: row[0], approx: notes, key: `${sh}/${mat}/${entrance}` };
}

/**
 * SWMM section for one conduit. `role`: { entrance: bool, exit: bool, entranceType, entranceProv } for a culvert's
 * lengths, null for an ordinary pipe. `sed` sediment depth (m). `nDefault` the network's n. Returns
 * { shape, g: [geom1..4], barrels, curve, culvert, loss, n, offsetRise, open, area, prov, approx, error }.
 */
export function swmmSection(asset, { role = null, sed = 0, nDefault = 0.013, cfg = NATIVE_DEFAULTS, name = 'C' } = {}) {
  const c = { ...NATIVE_DEFAULTS, ...cfg };
  const { shape, rise, span: span0, barrels = 1 } = asset.section, approx = [], prov = {};
  let span = shape === 'circle' ? rise : span0;
  if (!(rise > 0)) return { error: 'no rise: section left as built', approx: ['no rise'] };
  if (shape === 'box' && !(span > 0)) { span = rise; approx.push('box span unknown: square'); }
  // roughness: the record, the material table, the network default
  const mat = asset.material, tab = mat ? c.roughness[mat] : null;
  const n = asset.roughness?.n != null ? asset.roughness.n : tab?.n ?? nDefault;
  prov.n = asset.roughness?.n != null ? 'record' : tab ? `material (${mat})` : 'default';
  if (tab?.approx && asset.roughness?.n == null) approx.push(tab.approx);
  // section
  let out;
  const s = sed > 0 ? sed : 0;
  if (s >= rise) return { error: `sediment ${s.toFixed(2)} m fills the ${rise.toFixed(2)} m barrel: refused (a blocked barrel is a scenario of its own)`, approx };
  const custom = (why) => {
    const pts = shapeCurve(shape, rise, span, s, c.curvePoints), open = rise - s;
    if (why) approx.push(why);
    return { shape: 'CUSTOM', g: [open, `SH_${name}`, 0, 0], curve: { name: `SH_${name}`, pts }, open, area: curveArea(pts, open) };
  };
  if (shape == null || shape === 'ellipse' || (shape !== 'circle' && shape !== 'box' && !(span > 0))) { // not drawable: legacy circle of the rise
    approx.push(shape == null ? 'shape unknown: circle of the rise' : `${shape} without both dimensions: circle of the rise`);
    if (s > 0) out = { shape: 'FILLED_CIRCULAR', g: [rise, s, 0, 0], open: rise - s, area: openArea('circle', rise, rise, s) };
    else out = { shape: 'CIRCULAR', g: [rise, 0, 0, 0], open: rise, area: Math.PI / 4 * rise * rise };
    prov.shape = 'legacy';
  } else if (shape === 'circle') {
    if (s > 0 && c.circleSediment === 'cut') { out = custom(null); prov.shape = 'custom'; }
    else { out = s > 0 ? { shape: 'FILLED_CIRCULAR', g: [rise, s, 0, 0], open: rise - s, area: openArea('circle', rise, rise, s) }
      : { shape: 'CIRCULAR', g: [rise, 0, 0, 0], open: rise, area: Math.PI / 4 * rise * rise };
    prov.shape = 'native'; }
  } else if (shape === 'box') {
    out = { shape: 'RECT_CLOSED', g: [rise - s, span, 0, 0], open: rise - s, area: (rise - s) * span }; // a box cut level is still a box
    prov.shape = 'native';
  } else if (shape === 'h-ellipse' || shape === 'v-ellipse') {
    const minor = shape === 'h-ellipse' ? rise : span, major = shape === 'h-ellipse' ? span : rise;
    // T2 decision (11 Nov 2026): SWMM's size code only when the source names ASTM C507 and the size is one of its sizes
    const std = asset.section.standard ?? null, named = std === 'ASTM C507', code = stdEllipseCode(minor, major, c.ellipseStdTolIn);
    const size = `${(minor / 0.0254).toFixed(1)} × ${(major / 0.0254).toFixed(1)} in`;
    const usable = named && code && mat !== 'metal' && mat !== 'plastic';
    if (named && (mat === 'metal' || mat === 'plastic')) approx.push(`designated ${std} (concrete) but recorded as ${mat}: the designation is not used`);
    if (usable && s === 0) {
      out = { shape: shape === 'h-ellipse' ? 'HORIZ_ELLIPSE' : 'VERT_ELLIPSE', g: [rise, span, code, 0], open: rise, area: STD_ELLIPSE.area[code - 1] * 0.3048 ** 2,
        designation: { source: std, sourceProv: asset.prov?.standard ?? 'unknown', solver: `${shape === 'h-ellipse' ? 'HORIZ' : 'VERT'}_ELLIPSE size code ${code}` } };
      approx.push(`${std} ${size}: SWMM's standard-ellipse size code ${code}, whose section tables are not an ideal ellipse (code 9: full area +3.7 %, part-full area −7 to +7 %, T2); qualified`);
      prov.shape = `native standard size ${code}`;
    } else {
      const why = s > 0 ? null : named && !code ? `designated ${std} but ${size} is not one of its sizes: drawn as a true ellipse of the recorded axes`
        : !named && code ? `ambiguous profile: ${size} matches ASTM C507 size ${code}, but the source does not name the standard; drawn as a true ellipse of the recorded axes`
        : 'not a designated standard elliptical pipe: drawn as a true ellipse of the recorded axes';
      out = custom(why); prov.shape = 'custom';
      if (s > 0 && !named && code) approx.push(`ambiguous profile: ${size} matches ASTM C507 size ${code}, but the source does not name the standard`);
      if (std) out.designation = { source: std, sourceProv: asset.prov?.standard ?? 'unknown', solver: 'CUSTOM exact ellipse' };
    }
  } else if (shape === 'arch') {
    if (s > 0) out = custom(null); else out = { shape: 'ARCH', g: [rise, span, 0, 0], open: rise, area: 0.7879 * rise * span };
    approx.push('arch geometry not recorded: SWMM corrugated pipe-arch profile');
    const r = span / rise; if (r < 1.3 || r > 1.8) approx.push(`span/rise ${r.toFixed(2)} is outside the standard pipe-arch range (1.3–1.8)`);
    prov.shape = s > 0 ? 'custom' : 'native';
  }
  if (s > 0) { prov.sediment = 'scenario'; approx.push(`sediment ${s.toFixed(2)} m: open height ${(rise - s).toFixed(2)} m, invert raised by the sediment`); }
  // culvert inlet control and losses, for a culvert's entrance and exit lengths
  let culvert = 0, loss = null;
  if (role) {
    const ent = role.entranceType ?? c.entrance, fam = family(shape, mat);
    prov.entrance = role.entranceType ? role.entranceProv ?? 'record' : 'default';
    if (role.entrance && c.culvertCodes) { const k = culvertCode(shape, mat, ent); culvert = k.code; approx.push(...k.approx); prov.culvert = k.key; }
    if (c.losses && (role.entrance || role.exit)) {
      const ke = role.entrance ? ENTRANCE_LOSS[fam][ent] ?? 0.5 : 0, kx = role.exit ? c.exitLoss : 0;
      loss = { entry: ke, exit: kx, avg: 0 }; prov.loss = `HDS-5 Ke ${fam}/${ent}${role.exit ? `, exit ${kx}` : ''}`;
    }
  }
  // SWMM raises a FILLED_CIRCULAR conduit's offsets by the fill itself (link.c, conduit_validate: offset += yBot), so
  // the network must not raise them again. A cut CUSTOM or RECT_CLOSED section is drawn from the top of the fill, so
  // its offsets are raised here. (Stage B correction, 11 Nov 2026: Stage A raised both, putting a filled circle's
  // invert 2 × the fill above the bed.)
  const offsetRise = out.shape === 'FILLED_CIRCULAR' ? 0 : s;
  return { ...out, barrels: barrels || 1, culvert, loss, n, sediment: s, offsetRise, prov, approx, error: null };
}
