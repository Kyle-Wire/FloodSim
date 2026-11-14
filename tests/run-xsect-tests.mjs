// Native SWMM conduit inputs (src/swmm-xsect.js, realNetwork `nativeSections`), Stage A: translation correctness.
// No hydraulics are judged here; Stage B is the coupled culvert benchmarks. What is checked:
//   - shapes: SWMM's native shape where it matches, an exact custom curve where it does not;
//   - roughness from material, with the record's own n first;
//   - HDS-5 culvert codes and entrance/exit losses, on a culvert's entrance and exit lengths only;
//   - unit conversion from a Charlotte-style layer (inches, feet);
//   - sediment, as FILLED_CIRCULAR or a cut section, with the invert raised;
//   - the same culvert from a city layer, OpenStreetMap and the drawer gives the same SWMM section;
//   - SWMM itself reads every record, and its own Cross Section Summary gives the areas we intended;
//   - with the option off, nothing changes.
// Usage: node tests/run-xsect-tests.mjs
import { GridRef, fromUTM } from '../src/geo.js';
import { toINP } from '../src/drainage.js';
import { realNetwork } from '../src/network-real.js';
import { detectPipeFields, pipeRecords } from '../src/linked.js';
import { layerInputs, feature } from '../src/infra.js';
import { fromLinked, fromDrawn, fromOSM, physicalKey } from '../src/assets.js';
import { swmmSection, culvertCode, entranceOf, openArea, curveArea, NATIVE_DEFAULTS } from '../src/swmm-xsect.js';
import { loadSWMM } from '../src/swmm.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const IN = 0.0254, FT = 0.3048;
const conduit = (shape, rise, span, material = null, n = null, barrels = 1, standard = null) => ({ section: { shape, rise, span, barrels, standard }, material, roughness: { n }, condition: { sediment: null } });
const M0 = detectPipeFields(['ITPIPE_ASSETID', 'PI_SHAPE', 'MATERIAL', 'PACP_Height', 'PACP_Width'], [{ PACP_Height: 96 }, { PACP_Height: 18 }, { PACP_Height: 24 }]);
const C507 = (shape, rise, span, material = 'concrete') => conduit(shape, rise, span, material, null, 1, 'ASTM C507'); // a source that names the standard
const ENT = { entrance: true, exit: false }, EXIT = { entrance: false, exit: true }, BOTH = { entrance: true, exit: true };

// ---------------------------------------------------------------- 1. shapes
{
  const c = swmmSection(conduit('circle', 1.2, 1.2, 'concrete'));
  check('circle → CIRCULAR at its diameter, no code or losses on an ordinary pipe', c.shape === 'CIRCULAR' && c.g[0] === 1.2 && c.culvert === 0 && c.loss === null && c.approx.length === 0, JSON.stringify(c.g));
  const b = swmmSection(conduit('box', 1.5, 3.0, 'concrete', null, 2));
  check('box → RECT_CLOSED rise × span, barrels kept', b.shape === 'RECT_CLOSED' && b.g[0] === 1.5 && b.g[1] === 3 && b.barrels === 2 && near(b.area, 4.5, 1e-9));
  const sq = swmmSection(conduit('box', 1.5, null));
  check('box with no span → square, and said', sq.shape === 'RECT_CLOSED' && sq.g[1] === 1.5 && sq.approx.some(a => /square/.test(a)));
  // T2 decision (11 Nov 2026): SWMM's size code only for a source that names ASTM C507
  const he = swmmSection(C507('h-ellipse', 38 * IN, 60 * IN));
  check('designated ASTM C507 38 × 60 in → HORIZ_ELLIPSE by SWMM\'s size code 9 (its tabulated 12.9 ft²), qualified: the table\'s discrepancy is listed',
    he.shape === 'HORIZ_ELLIPSE' && near(he.g[0], 38 * IN, 1e-9) && near(he.g[1], 60 * IN, 1e-9) && he.g[2] === 9 && near(he.area, 12.9 * 0.3048 ** 2, 1e-9) && he.approx.some(a => /not an ideal ellipse/.test(a) && /qualified/.test(a)),
    `SWMM area ${he.area.toFixed(3)} vs true ${(Math.PI / 4 * 38 * 60 * IN * IN).toFixed(3)} m²; ${he.approx.join('; ')}`);
  check('…both the source designation and the solver section are kept', he.designation?.source === 'ASTM C507' && he.designation.solver === 'HORIZ_ELLIPSE size code 9', JSON.stringify(he.designation));
  const hu = swmmSection(conduit('h-ellipse', 38 * IN, 60 * IN, 'concrete'), { name: 'U' });
  check('38 × 60 in with rise and span only (a C507 size, not named) → CUSTOM exact ellipse, flagged as an ambiguous profile',
    hu.shape === 'CUSTOM' && rel(hu.area, Math.PI / 4 * 38 * 60 * IN * IN) < 0.005 && hu.approx.some(a => /ambiguous profile/.test(a) && /size 9/.test(a)) && !hu.designation, hu.approx.join('; '));
  const hn = swmmSection(conduit('h-ellipse', 38 * IN, 60 * IN), { name: 'U' });
  check('…the same with no material: no longer "assumed concrete C507", still the exact ellipse', hn.shape === 'CUSTOM' && !hn.approx.some(a => /material not recorded/.test(a)), hn.approx.join('; '));
  const hb = swmmSection(C507('h-ellipse', 40 * IN, 60 * IN), { name: 'U' });
  check('designated C507 but 40 × 60 in is not one of its sizes → exact ellipse, said; the designation is kept beside it',
    hb.shape === 'CUSTOM' && hb.approx.some(a => /not one of its sizes/.test(a)) && hb.designation?.solver === 'CUSTOM exact ellipse', hb.approx.join('; '));
  const hm = swmmSection(C507('h-ellipse', 38 * IN, 60 * IN, 'metal'), { name: 'U' });
  check('designated C507 (concrete) but recorded as metal → the conflict is said and the designation not used', hm.shape === 'CUSTOM' && hm.approx.some(a => /recorded as metal/.test(a)), hm.approx.join('; '));
  const l1 = fromLinked({ PI_SHAPE: 'Horiz Elliptical (ASTM C507)', MATERIAL: 'RCP', PACP_Height: 38, PACP_Width: 60 }, M0, { u: IN }), l2 = fromLinked({ PI_SHAPE: 'Horiz Elliptical', MATERIAL: 'RCP', PACP_Height: 38, PACP_Width: 60 }, M0, { u: IN });
  check('a layer whose text names C507 → section.standard "ASTM C507" (record); one that does not → null', l1.section.standard === 'ASTM C507' && l1.prov.standard === 'record' && l2.section.standard === null && l2.prov.standard === 'unknown',
    JSON.stringify([l1.section, l2.section]));
  const ed = swmmSection(conduit('h-ellipse', 96 * IN, 144 * IN, 'metal'), { name: 'C7' }); // Edwards Branch: span/rise 1.5
  const exact = Math.PI / 4 * 96 * 144 * IN * IN;
  check('96 × 144 in ellipse (not a standard size) → CUSTOM exact ellipse, flagged as drawn from the recorded axes',
    ed.shape === 'CUSTOM' && near(ed.g[0], 96 * IN, 1e-9) && ed.g[1] === 'SH_C7' && ed.curve.pts.length === NATIVE_DEFAULTS.curvePoints && rel(ed.area, exact) < 0.005 && ed.approx.some(a => /true ellipse/.test(a)),
    `curve area ${ed.area.toFixed(3)} vs exact ${exact.toFixed(3)} m² (${(rel(ed.area, exact) * 100).toFixed(2)} %)`);
  const ve = swmmSection(C507('v-ellipse', 60 * IN, 38 * IN));
  check('designated C507 vertical ellipse (60 × 38 in) → native VERT_ELLIPSE', ve.shape === 'VERT_ELLIPSE' && near(ve.g[0], 60 * IN, 1e-9) && near(ve.g[1], 38 * IN, 1e-9));
  const ar = swmmSection(conduit('arch', 96 * IN, 336 * IN, 'metal'));
  check('arch → native ARCH (rise, span); the assumed pipe-arch profile and the out-of-range proportion are flagged',
    ar.shape === 'ARCH' && near(ar.g[1], 336 * IN, 1e-9) && ar.approx.some(a => /pipe-arch profile/.test(a)) && ar.approx.some(a => /outside the standard/.test(a)), ar.approx.join('; '));
  const un = swmmSection(conduit(null, 0.6, null));
  check('unknown shape → circle of the rise, flagged as legacy', un.shape === 'CIRCULAR' && un.prov.shape === 'legacy' && un.approx.some(a => /shape unknown/.test(a)));
  const half = swmmSection(conduit('ellipse', 1.0, null));
  check('ellipse of unknown orientation / span → circle of the rise, flagged', half.shape === 'CIRCULAR' && half.approx.length > 0);
  check('no rise → refused, section left as built', !!swmmSection(conduit('circle', null, null)).error);
}

// ---------------------------------------------------------------- 2. roughness
{
  const s = (mat, n) => swmmSection(conduit('circle', 1, 1, mat, n), { nDefault: 0.0135 });
  check('roughness: the record\'s own n first', s('metal', 0.02).n === 0.02 && s('metal', 0.02).prov.n === 'record');
  check('…then the material table: corrugated metal 0.024, concrete 0.013', s('metal').n === 0.024 && s('concrete').n === 0.013 && /material/.test(s('metal').prov.n));
  check('…plastic\'s wall type is not stated: 0.012, flagged', s('plastic').n === 0.012 && s('plastic').approx.some(a => /wall type/.test(a)));
  check('…unknown material: the network\'s default n, marked default', s(null).n === 0.0135 && s(null).prov.n === 'default');
  const own = swmmSection(conduit('circle', 1, 1, 'metal'), { cfg: { roughness: { metal: { n: 0.021 } } } });
  check('…the table is configurable per project', own.n === 0.021);
}

// ---------------------------------------------------------------- 3. culvert codes and losses
{
  const k = (shape, mat, ent) => culvertCode(shape, mat, ent);
  check('codes: concrete pipe square edge with headwall 1, groove end projecting 3', k('circle', 'concrete', 'headwall').code === 1 && k('circle', 'concrete', 'groove-headwall').code === 2 && k('circle', 'concrete', 'projecting').code === 3);
  check('codes: CMP headwall 4, mitered 5, projecting 6', k('circle', 'metal', 'headwall').code === 4 && k('circle', 'metal', 'mitered').code === 5 && k('circle', 'metal', 'projecting').code === 6);
  check('codes: concrete box 90° headwall 10, 30–75° wingwalls 9, beveled 15', k('box', 'concrete', 'headwall').code === 10 && k('box', 'concrete', 'wingwall').code === 9 && k('box', 'concrete', 'beveled').code === 15);
  check('codes: horizontal ellipse 30–32, vertical 33–35, metal arch 45–47 (mitered codes 5/46 get SWMM\'s slope correction)',
    k('h-ellipse', 'concrete', 'headwall').code === 30 && k('h-ellipse', 'concrete', 'projecting').code === 32 && k('v-ellipse', 'concrete', 'headwall').code === 33 && k('arch', 'metal', 'headwall').code === 45 && k('arch', 'metal', 'mitered').code === 46 && k('arch', 'metal', 'projecting').code === 47);
  const cmpE = k('h-ellipse', 'metal', 'headwall');
  check('a corrugated metal ellipse has no HDS-5 code: the concrete ellipse code, said', cmpE.code === 30 && cmpE.approx.some(a => /no corrugated metal ellipse/.test(a)), cmpE.approx.join('; '));
  check('unknown material: concrete codes, said', k('circle', null, 'headwall').code === 1 && k('circle', null, 'headwall').approx.some(a => /material unknown/.test(a)));
  const e = swmmSection(conduit('circle', 1.2, 1.2, 'metal'), { role: ENT }), x = swmmSection(conduit('circle', 1.2, 1.2, 'metal'), { role: EXIT }), mid = swmmSection(conduit('circle', 1.2, 1.2, 'metal'), { role: { entrance: false, exit: false } });
  check('entrance length: inlet-control code and Ke (CMP headwall 0.5); the entrance type is the default, marked', e.culvert === 4 && e.loss.entry === 0.5 && e.loss.exit === 0 && e.prov.entrance === 'default');
  check('exit length: no code, exit loss 1.0 (configurable)', x.culvert === 0 && x.loss.entry === 0 && x.loss.exit === 1 && swmmSection(conduit('circle', 1, 1), { role: EXIT, cfg: { exitLoss: 0.5 } }).loss.exit === 0.5);
  check('interior length of a culvert: neither code nor losses', mid.culvert === 0 && mid.loss === null);
  const proj = swmmSection(conduit('circle', 1.2, 1.2, 'metal'), { role: { ...BOTH, entranceType: 'projecting', entranceProv: 'structure S_1 (Projecting)' } });
  check('entrance from a structure record: projecting CMP → code 6, Ke 0.9; a one-length culvert carries both losses', proj.culvert === 6 && proj.loss.entry === 0.9 && proj.loss.exit === 1 && /structure/.test(proj.prov.entrance));
  check('box wingwalls Ke 0.4, beveled 0.2', swmmSection(conduit('box', 1, 2, 'concrete'), { role: { ...ENT, entranceType: 'wingwall' } }).loss.entry === 0.4 && swmmSection(conduit('box', 1, 2, 'concrete'), { role: { ...ENT, entranceType: 'beveled' } }).loss.entry === 0.2);
  check('structure types read as entrances: Endwall → headwall, FES → end section, Mitered → mitered', entranceOf('Endwall') === 'headwall' && entranceOf('FES') === 'end-section' && entranceOf('Flared End Section') === 'end-section' && entranceOf('Mitered end') === 'mitered' && entranceOf('CB') === null);
  check('codes and losses can each be turned off', swmmSection(conduit('circle', 1, 1), { role: BOTH, cfg: { culvertCodes: false } }).culvert === 0 && swmmSection(conduit('circle', 1, 1), { role: BOTH, cfg: { losses: false } }).loss === null);
}

// ---------------------------------------------------------------- 4. sediment
{
  // Stage B change 2 (B6): a silted circle is an exact CUSTOM section cut at the fill by default; SWMM's FILLED_CIRCULAR
  // (conveyance 3–6 % high in B6) stays available as circleSediment: 'filled'
  const c = swmmSection(conduit('circle', 1.2, 1.2), { sed: 0.3 });
  const exact = openArea('circle', 1.2, 1.2, 0.3), full = Math.PI / 4 * 1.44;
  check('circle with 0.3 m of sediment → CUSTOM cut at the fill (default), open height 0.9 m, offsets raised 0.3 m, area exact within 1 %', c.shape === 'CUSTOM' && near(c.g[0], 0.9, 1e-12) && c.sediment === 0.3 && c.offsetRise === 0.3 && rel(c.area, exact) < 0.01 && exact < full && exact > full * 0.7, `${c.area.toFixed(4)} vs ${exact.toFixed(4)} m²`);
  const cf = swmmSection(conduit('circle', 1.2, 1.2), { sed: 0.3, cfg: { circleSediment: 'filled' } });
  // (Stage B correction 1: SWMM raises a FILLED_CIRCULAR conduit's offsets by the fill itself, so offsetRise is 0 for it)
  check('…or, with circleSediment \'filled\', FILLED_CIRCULAR (diameter, fill depth), offsets left to SWMM', cf.shape === 'FILLED_CIRCULAR' && cf.g[0] === 1.2 && cf.g[1] === 0.3 && cf.sediment === 0.3 && cf.offsetRise === 0 && near(cf.open, 0.9, 1e-12));
  check('…its open area is the circle above the chord', near(cf.area, exact, 1e-9), `${exact.toFixed(4)} of ${full.toFixed(4)} m²`);
  const e = swmmSection(conduit('h-ellipse', 96 * IN, 144 * IN, 'metal'), { sed: 2.2, name: 'C9' });
  const eo = openArea('h-ellipse', 96 * IN, 144 * IN, 2.2);
  check('ellipse filled to 2.2 m (the Edwards approach lidar) → CUSTOM cut section: open height 0.24 m, area exact within 1 %',
    e.shape === 'CUSTOM' && near(e.g[0], 96 * IN - 2.2, 1e-9) && e.offsetRise === 2.2 && rel(e.area, eo) < 0.01 && e.curve.pts[0][1] > 0, `${e.area.toFixed(4)} vs ${eo.toFixed(4)} m²`);
  const b = swmmSection(conduit('box', 2, 3), { sed: 0.5 });
  check('box with 0.5 m of sediment → a box 1.5 m high (exact), invert raised', b.shape === 'RECT_CLOSED' && b.g[0] === 1.5 && b.g[1] === 3 && b.offsetRise === 0.5);
  const a = swmmSection(conduit('arch', 2, 3, 'metal'), { sed: 0.5 });
  check('arch with sediment → CUSTOM from SWMM\'s own arch profile, cut at the sediment', a.shape === 'CUSTOM' && near(a.g[0], 1.5, 1e-12) && rel(a.area, openArea('arch', 2, 3, 0.5)) < 0.02);
  check('a barrel filled to its crown is refused, not squeezed', !!swmmSection(conduit('circle', 1, 1), { sed: 1 }).error && !!swmmSection(conduit('h-ellipse', 1, 1.5), { sed: 1.2 }).error);
  check('sediment is marked as a scenario value and named in the approximations', c.prov.sediment === 'scenario' && c.approx.some(t => /sediment/.test(t)));
}

// ---------------------------------------------------------------- 5. units and the same culvert from three sources
{
  const M = detectPipeFields(['ITPIPE_ASSETID', 'PI_SHAPE', 'MATERIAL', 'PACP_Height', 'PACP_Width', 'US_INVERT', 'DS_INVERT', 'NOTES'], [{ PACP_Height: 96 }, { PACP_Height: 18 }, { PACP_Height: 24 }]);
  const city = fromLinked({ ITPIPE_ASSETID: 'P_11292', PI_SHAPE: 'Elliptical', MATERIAL: 'Metal or Steel', PACP_Height: 96, PACP_Width: 144, NOTES: 'single metal culvert' }, M, { u: IN });
  const osm = fromOSM({ tunnel: 'culvert', height: '2.4384', width: '3.6576', 'culvert:shape': 'elliptical', material: 'metal' }, 'stream');
  const drawn = fromDrawn({ D: 96 * IN, W: 144 * IN, shapeRecorded: 'h-ellipse', material: 'corrugated metal' }, 'culvert');
  check('units: 96 × 144 in from the city layer → 2.4384 × 3.6576 m', near(city.section.rise, 2.4384, 1e-9) && near(city.section.span, 3.6576, 1e-9));
  check('three sources, one physical culvert: the canonical records agree', physicalKey(city) === physicalKey(osm) && physicalKey(city) === physicalKey(drawn), physicalKey(city));
  // compared as SWMM reads them (the .inp writes geometry to 4 decimals and curves to 5): OSM's "2.4384" and the
  // city's 96 × 0.0254 differ in the 16th digit, which is not a difference in the culvert
  const w = (v) => (typeof v === 'number' ? +v.toFixed(4) : v);
  const xs = (a) => { const s = swmmSection(a, { role: { ...BOTH, entranceType: 'headwall' }, name: 'X' });
    return JSON.stringify({ shape: s.shape, g: s.g.map(w), curve: s.curve?.pts.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]), culvert: s.culvert, loss: s.loss, n: s.n, barrels: s.barrels }); };
  check('…and give the same SWMM section, curve, culvert code, losses and roughness, as written', xs(city) === xs(osm) && xs(city) === xs(drawn), xs(city).slice(0, 120) + '…');
  const box = fromLinked({ PI_SHAPE: 'Box', MATERIAL: 'RCB', PACP_Height: 48, PACP_Width: 72 }, M, { u: IN }), boxD = fromDrawn({ D: 48 * IN, W: 72 * IN, shape: 'RECT_CLOSED', material: 'concrete' }, 'pipe');
  const bx = (a) => JSON.stringify((({ shape, g, n }) => ({ shape, g, n }))(swmmSection(a)));
  check('…a box from the city layer and the drawer too', bx(box) === bx(boxD), bx(box));
}

// ---------------------------------------------------------------- 6. the network: culvert chains, the option off
const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
const ll = (x, y) => fromUTM(486000 + x, 4422200 - y, 18), pt = (x, y) => { const [lon, lat] = ll(x, y); return { lon, lat }; };
const ground = (x) => 15 - 0.02 * x;
const z = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = ground(i);
const f = { z, bld: new Uint8Array(N), road: new Uint8Array(N), cls: null }, sim = { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) };
const MF = detectPipeFields(['ITPIPE_ASSETID', 'PI_SHAPE', 'MATERIAL', 'PACP_Height', 'PACP_Width', 'US_INVERT', 'DS_INVERT', 'Active'], [{ PACP_Height: 96 }, { PACP_Height: 18 }, { PACP_Height: 24 }]);
const len = (x0, x1, y, u, d, H = 96, W = 144, shape = 'Elliptical', mat = 'Metal or Steel') => ({ kind: 'line', coords: [ll(x0, y), ll(x1, y)],
  props: { Active: '1', ITPIPE_ASSETID: `P_${x0}_${x1}_${y}`, PI_SHAPE: shape, MATERIAL: mat, PACP_Height: H, PACP_Width: W, US_INVERT: u / FT, DS_INVERT: d / FT } });
const sewer = [[20, 60], [60, 100], [100, 140]].map(([a, b]) => len(a, b, 190, ground(a) - 1.5, ground(b) - 1.6, 24, null, 'Circular', 'Concrete'));
const crossing = [len(50, 70, 100, 11.5, 11.4), len(70, 100, 100, 11.4, 11.2)]; // a two-length culvert, endwall to endwall
const recs = pipeRecords([...sewer, ...crossing], MF);
const opts = { outfalls: [pt(50, 100), pt(100, 100)], realInlets: [pt(40, 191)] };
const off = realNetwork(g, f, recs, sim, opts), on = realNetwork(g, f, recs, sim, { ...opts, nativeSections: true });
{
  check('option off: no pipe carries a native section, and no culvert list is returned', off.pipes.every(p => !p.xs) && !off.culverts && !off.stats.native);
  { // the count, said in full: every network pipe is a native section, a refusal, or a link with no source record.
    // `sizeFilled` counts sections whose size the record left blank and the network filled (on Charlotte's records:
    // 595 sections = 582 with a recorded size + 13 filled; Stage A refused those 13, so it reported 582)
    // `sections` counts source records with a native section; merged barrels (T1) make fewer conduits than that
    const st = on.stats.native, bare = on.pipes.filter(p => !p.xs).length, gone = st.merge?.conduitsRemoved ?? 0;
    check(`section count: ${on.pipes.length} pipes = ${st.sections} native sections (${st.sections - st.sizeFilled} with a recorded size, ${st.sizeFilled} with a size the network filled) − ${gone} merged into a barrel + ${st.refused.length} refused + ${bare - st.refused.length} with no source record`,
      st.sections - gone + bare === on.pipes.length && Number.isInteger(st.sizeFilled) && st.sizeFilled <= st.sections);
  }
  const inpOff = toINP(off, g), inpOn = toINP(on, g);
  if (process.env.DEBUG) for (const [k, t] of [['off', inpOff], ['on', inpOn]]) for (const h of ['XSECTIONS', 'LOSSES']) console.log(k, h, JSON.stringify(t.split(`[${h}]`)[1]?.split('\n[')[0]));
  const xsRows = (inp) => inp.split('[XSECTIONS]')[1].split('\n[')[0].split('\n').filter(l => /^C\d/.test(l)).map(l => l.trim().split(/\s+/));
  check('option off: the .inp has no [LOSSES], no shape curves, no culvert column', !/\[LOSSES\]/.test(inpOff) && !/^SH_\w+\s+Shape/m.test(inpOff) && xsRows(inpOff).every(r => r.length === 7));
  // one record per length (mergeBarrels off): the Stage A representation, kept as an option
  const sep = realNetwork(g, f, recs, sim, { ...opts, nativeSections: { mergeBarrels: false } }), cvS = sep.culverts?.[0];
  check('mergeBarrels off: the two-length crossing is one culvert of two conduits, from its entrance endwall to its outfall', sep.culverts?.length === 1 && cvS.pipes.length === 2 && cvS.toOutfall, JSON.stringify(sep.culverts));
  const [s1p, s2p] = cvS.pipes.map(n => sep.pipes.find(p => p.name === n));
  check('…its entrance length has the inlet-control code (concrete-ellipse code 30) and Ke; its exit length the exit loss; no code inside',
    s1p.xs.culvert === 30 && s1p.xs.loss.entry === 0.5 && s1p.xs.loss.exit === 0 && s2p.xs.culvert === 0 && s2p.xs.loss.exit === 1, JSON.stringify([s1p.xs.loss, s2p.xs.loss]));
  check('…only the culvert lengths and the sections differ from the option off: nodes, offsets and the pipe list are the same', JSON.stringify(sep.nodes.map(n => [n.name, n.invert])) === JSON.stringify(off.nodes.map(n => [n.name, n.invert])) && sep.pipes.length === off.pipes.length &&
    sep.pipes.every((p, k) => p.inOffset === off.pipes[k].inOffset && p.outOffset === off.pipes[k].outOffset));
  // the default (T1): the pass-through node between the two lengths is not a junction of the barrel
  const cv = on.culverts?.[0], [p1] = (cv?.pipes ?? []).map(n => on.pipes.find(p => p.name === n));
  check('T1: the two records are one conduit, entrance endwall to outfall, 50 m, on the end floors (11.5 → 11.2)', on.culverts?.length === 1 && cv.pipes.length === 1 && cv.toOutfall && near(p1.L, 50, 0.5) &&
    near(on.nodes[p1.from].invert + p1.inOffset, 11.5, 1e-6) && near(on.nodes[p1.to].invert + p1.outOffset, 11.2, 1e-6), JSON.stringify(on.culverts));
  check('…with the code (30) and Ke 0.5 of its entrance record and the exit loss 1 of its last', p1.xs.culvert === 30 && p1.xs.loss.entry === 0.5 && p1.xs.loss.exit === 1, JSON.stringify(p1.xs.loss));
  check('…and both source records, with their asset ids, lengths and inverts', p1.records?.length === 2 && p1.records.map(r => r.asset).join() === 'P_50_70_100,P_70_100_100' && /2 records as one barrel/.test(p1.xs.prov.merged), JSON.stringify(p1.records));
  check('…the canonical records are untouched (two pipe records, as given)', recs.filter(r => /^P_(50_70|70_100)_100$/.test(r.asset?.source?.id)).length === 2);
  check('…one node fewer than the option off (the pass-through node), every other node and invert the same',
    on.nodes.length === off.nodes.length - 1 && on.pipes.length === off.pipes.length - 1 && on.nodes.every(n => off.nodes.some(m => m.name === n.name && m.invert === n.invert)), `${on.nodes.length} vs ${off.nodes.length}`);
  check('…the merge says what it did, and that it kept no node', on.stats.native.merge.barrels === 1 && on.stats.native.merge.recordsMerged === 2 && on.stats.native.merge.kept.length === 0, JSON.stringify(on.stats.native.merge));
  check('…the barrel is the exact custom ellipse with corrugated-metal n', p1.xs.shape === 'CUSTOM' && p1.n === 0.024);
  check('…the sewer stays round, with concrete n from its material and no culvert code', on.pipes.filter(p => !cv.pipes.includes(p.name) && p.real).every(p => p.xs?.shape === 'CIRCULAR' && p.n === 0.013 && !p.xs.culvert && !p.xs.loss));
  const ent = on.nodes[p1.from], entOff = off.nodes.find(n => n.name === ent.name);
  check('…the entrance\'s surface exchange takes the ellipse\'s real area (7.0 m², was the circle\'s 4.7) and its span',
    near(ent.grateHyd[0].inletArea, Math.PI / 4 * 96 * 144 * IN * IN, 1e-6) && near(ent.grateHyd[0].inletPerim, 144 * IN, 1e-9) && near(entOff.grateHyd[0].inletArea, Math.PI / 4 * (96 * IN) ** 2, 1e-6));
  check('…the .inp: one [LOSSES] row (entry 0.5, exit 1), one shape curve in [CURVES], the culvert code in the 8th column',
    new RegExp(`\\[LOSSES\\][\\s\\S]*${p1.name}\\s+0\\.5\\s+1\\s+0\\s+NO`).test(inpOn) && new RegExp(`${p1.name}\\s+CUSTOM\\s+2\\.4384\\s+SH_${p1.name}\\s+0\\s+0\\s+1\\s+30`).test(inpOn) && (inpOn.match(/^SH_\w+\s+Shape/gm) ?? []).length === 1);
  const inpSep = toINP(sep, g);
  check('…mergeBarrels off writes the Stage A form: two [LOSSES] rows and two shape curves', /\[LOSSES\][\s\S]*C\d+\s+0\.5\s+0\s+0\s+NO/.test(inpSep) && (inpSep.match(/^SH_\w+\s+Shape/gm) ?? []).length === 2);
  const sed = realNetwork(g, f, recs, sim, { ...opts, nativeSections: { sediment: { P_50_70_100: 0.5, P_70_100_100: 0.5 } } });
  const s1 = sed.pipes.find(p => p.name === p1.name);
  check('sediment from the scenario by asset id: offsets raised 0.5 m, open height 1.94 m', near(s1.inOffset - p1.inOffset, 0.5, 1e-9) && near(s1.outOffset - p1.outOffset, 0.5, 1e-9) && near(s1.xs.g[0], 96 * IN - 0.5, 1e-9));
  // the drawer path through the same network gives the same SWMM records
  const fc = { type: 'FeatureCollection', features: [
    ...[[20, 60], [60, 100], [100, 140]].map(([a, b]) => feature('pipe', { type: 'LineString', coordinates: [ll(a, 190), ll(b, 190)] }, { D: 24 * IN, upInv: ground(a) - 1.5, dnInv: ground(b) - 1.6, material: 'concrete' })),
    feature('pipe', { type: 'LineString', coordinates: [ll(50, 100), ll(70, 100)] }, { D: 96 * IN, W: 144 * IN, shapeRecorded: 'h-ellipse', material: 'metal', upInv: 11.5, dnInv: 11.4 }),
    feature('pipe', { type: 'LineString', coordinates: [ll(70, 100), ll(100, 100)] }, { D: 96 * IN, W: 144 * IN, shapeRecorded: 'h-ellipse', material: 'metal', upInv: 11.4, dnInv: 11.2 }),
  ] };
  const dn = realNetwork(g, f, layerInputs(fc).pipes, sim, { ...opts, nativeSections: true });
  // what SWMM reads: the written sections, losses and curves, and each conduit's roughness
  const sec = (inp) => [...['XSECTIONS', 'LOSSES', 'CURVES'].map(h => inp.split(`[${h}]`)[1]?.split('\n[')[0] ?? ''),
    (inp.split('[CONDUITS]')[1] ?? '').split('\n[')[0].split('\n').map(l => l.split(/\s+/).slice(0, 1).concat(l.split(/\s+/).slice(4, 5)).join(' ')).join('\n')].join('\n');
  const inpDn = toINP(dn, g);
  if (process.env.DEBUG) { const a = sec(inpDn).split('\n'), b = sec(inpOn).split('\n'); a.forEach((x, i) => { if (x !== b[i]) console.log(`drawn | ${x}\ncity  | ${b[i]}`); }); }
  check('city layer and drawer, same pipes → the same SWMM sections, codes, losses, curves and roughness as written', sec(inpDn) === sec(inpOn));

  // ---------------------------------------------------------------- 7. SWMM reads it, and computes the areas intended
  const swmm = await loadSWMM();
  const run = (inp) => { swmm.open(inp.replace('INPUT NO', 'INPUT YES')); swmm.stride(60); return swmm.finish(); };
  let rpt = '', err = null; try { rpt = run(inpOn); } catch (e) { err = e; }
  check('SWMM opens the native .inp (custom shapes, culvert codes, losses) without an input error', !err && /Cross Section Summary/.test(rpt), err?.message ?? '');
  const xsum = (rpt.split('Cross Section Summary')[1] ?? '').split('\n').map(l => l.trim().split(/\s+/)).filter(r => /^C\d+$/.test(r[0]));
  const areaOf = (name) => Number(xsum.find(r => r[0] === name)?.[3]);
  check('SWMM\'s own full area for the custom ellipse = the exact ellipse within 1 %', rel(areaOf(p1.name), Math.PI / 4 * 96 * 144 * IN * IN) < 0.01, `SWMM ${areaOf(p1.name)} m² vs ${(Math.PI / 4 * 96 * 144 * IN * IN).toFixed(2)}`);
  const sw = (sects) => { // a one-conduit model per section, to read SWMM's areas back
    const L = ['[TITLE]', 't', '[OPTIONS]', 'FLOW_UNITS CMS', 'FLOW_ROUTING DYNWAVE', 'LINK_OFFSETS DEPTH', 'START_DATE 01/01/2000', 'END_DATE 01/01/2000', 'END_TIME 00:05:00', 'ROUTING_STEP 1',
      // SWMM allows one link per outfall: a junction and an outfall for each conduit
      '[JUNCTIONS]', ...sects.map((s, i) => `J${i} 10 5 0 0 0`), '[OUTFALLS]', ...sects.map((s, i) => `O${i} 9 FREE NO`),
      '[CONDUITS]', ...sects.map((s, i) => `K${i} J${i} O${i} 50 ${s.n} ${s.offsetRise ?? 0} ${s.offsetRise ?? 0} 0 0`),
      '[XSECTIONS]', ...sects.map((s, i) => `K${i} ${s.shape} ${s.g.map(v => (typeof v === 'string' ? v.replace(/SH_\w+/, 'SH_K' + i) : v)).join(' ')} ${s.barrels}${s.culvert ? ' ' + s.culvert : ''}`),
      '[CURVES]', ...sects.flatMap((s, i) => (s.curve ? s.curve.pts.map(([x, y], m) => `SH_K${i} ${m ? '' : 'Shape'} ${x} ${y}`) : [])), '[REPORT]', 'INPUT YES'];
    const r = run(L.join('\n')), rows = (r.split('Cross Section Summary')[1] ?? '').split('\n').map(l => l.trim().split(/\s+/)).filter(x => /^K\d+$/.test(x[0]));
    return sects.map((s, i) => ({ area: Number(rows.find(x => x[0] === 'K' + i)?.[3]), depth: Number(rows.find(x => x[0] === 'K' + i)?.[2]), width: Number(rows.find(x => x[0] === 'K' + i)?.[5]) }));
  };
  const cases = [
    ['circle 1.2 m', swmmSection(conduit('circle', 1.2, 1.2)), Math.PI / 4 * 1.44],
    ['box 1.5 × 3 m', swmmSection(conduit('box', 1.5, 3)), 4.5],
    ['HE 38 × 60 in, designated C507 (standard size code 9)', swmmSection(C507('h-ellipse', 38 * IN, 60 * IN)), 12.9 * 0.3048 ** 2],
    ['HE 38 × 60 in, rise and span only (custom)', swmmSection(conduit('h-ellipse', 38 * IN, 60 * IN), { name: 'Z' }), Math.PI / 4 * 38 * 60 * IN * IN],
    ['HE 40 × 60 in (not standard: custom)', swmmSection(conduit('h-ellipse', 40 * IN, 60 * IN), { name: 'Z' }), Math.PI / 4 * 40 * 60 * IN * IN],
    ['ellipse 96 × 144 in (custom)', swmmSection(conduit('h-ellipse', 96 * IN, 144 * IN), { name: 'Z' }), Math.PI / 4 * 96 * 144 * IN * IN],
    ['filled circle 1.2 m, 0.3 m (FILLED_CIRCULAR)', swmmSection(conduit('circle', 1.2, 1.2), { sed: 0.3, cfg: { circleSediment: 'filled' } }), openArea('circle', 1.2, 1.2, 0.3)],
    ['silted circle 1.2 m, 0.3 m (cut CUSTOM, default)', swmmSection(conduit('circle', 1.2, 1.2), { sed: 0.3, name: 'Z' }), openArea('circle', 1.2, 1.2, 0.3)],
    ['ellipse 96 × 144 in, 2.2 m sediment (custom)', swmmSection(conduit('h-ellipse', 96 * IN, 144 * IN), { sed: 2.2, name: 'Z' }), openArea('h-ellipse', 96 * IN, 144 * IN, 2.2)],
    ['ellipse 96 × 144 in, 1.0 m sediment (custom)', swmmSection(conduit('h-ellipse', 96 * IN, 144 * IN), { sed: 1.0, name: 'Z' }), openArea('h-ellipse', 96 * IN, 144 * IN, 1.0)],
    ['arch 2 × 3 m (native)', swmmSection(conduit('arch', 2, 3, 'metal')), 0.7879 * 6],
  ];
  const got = sw(cases.map(c => c[1]));
  cases.forEach(([name, s, want], i) => check(`SWMM full area, ${name}: ${got[i].area} m² (intended ${want.toFixed(3)}), full depth ${got[i].depth} m`, rel(got[i].area, want) < 0.01 && near(got[i].depth, s.open, 0.006)));
  // the effective invert, as SWMM computes it. SWMM raises a FILLED_CIRCULAR conduit by its fill itself, so the network
  // must not. A trickle into the upstream node ponds to the conduit's effective invert plus a few centimetres of
  // critical depth; a double raise would pond it a whole fill depth higher.
  const pond = (s) => {
    const inp = ['[TITLE]', 't', '[OPTIONS]', 'FLOW_UNITS CMS', 'FLOW_ROUTING DYNWAVE', 'LINK_OFFSETS DEPTH', 'START_DATE 01/01/2000', 'END_DATE 01/01/2000', 'END_TIME 01:00:00', 'ROUTING_STEP 1',
      '[JUNCTIONS]', 'J0 10 5 0 0 0', '[OUTFALLS]', 'O0 9 FREE NO', '[CONDUITS]', `K0 J0 O0 50 ${s.n} ${s.offsetRise} ${s.offsetRise} 0 0`,
      '[XSECTIONS]', `K0 ${s.shape} ${s.g.map(v => (typeof v === 'string' ? 'SH_K0' : v)).join(' ')} 1`,
      '[CURVES]', ...(s.curve ? s.curve.pts.map(([x, y], m) => `SH_K0 ${m ? '' : 'Shape'} ${x} ${y}`) : []), '[DWF]', 'J0 FLOW 0.002'].join('\n');
    swmm.open(inp); swmm.stride(3600); const d = swmm.node('DEPTH', swmm.index('NODE', 'J0')); swmm.finish(); return d;
  };
  for (const [name, s, fill] of [['filled circle 1.2 m, 0.3 m (FILLED_CIRCULAR)', swmmSection(conduit('circle', 1.2, 1.2), { sed: 0.3, cfg: { circleSediment: 'filled' } }), 0.3], ['silted circle 1.2 m, 0.3 m (cut CUSTOM)', swmmSection(conduit('circle', 1.2, 1.2), { sed: 0.3, name: 'Z' }), 0.3], ['box 2 × 3 m, 0.5 m', swmmSection(conduit('box', 2, 3), { sed: 0.5 }), 0.5],
    ['ellipse 96 × 144 in, 1.0 m (custom)', swmmSection(conduit('h-ellipse', 96 * IN, 144 * IN), { sed: 1.0, name: 'Z' }), 1.0]]) {
    const d = pond(s);
    check(`effective invert in SWMM, ${name}: a trickle ponds ${d.toFixed(3)} m deep, just above the fill (not twice the fill)`, d > fill && d < fill + 0.1);
  }
  check('a 96 × 144 in ellipse written as SWMM\'s native ellipse would be 7.7 % too large (why it is custom)', rel(1.2692 * (96 * IN) ** 2, Math.PI / 4 * 96 * 144 * IN * IN) > 0.07);

  // ---------------------------------------------------------------- 8. T1: one physical barrel in 1, 3 or 6 records
  // The same 60 m barrel (96 × 144 in metal ellipse, 11.5 → 11.2 m, straight profile, endwall to endwall, no lateral or
  // grate between) cut into k source records, beside the 3-pipe sewer (a layer needs 3 records with inverts before its
  // inverts are trusted at all: a layer of one record gets derived inverts, which is not a T1 question). With
  // mergeBarrels on, every k must give the same SWMM input and the same headwater; the records survive on the conduit.
  // With it off, the k-record form is kept for comparison.
  const barrel = (k, ns, drop = 0.3) => {
    const x0 = 50, x1 = 110, inv = (x) => 11.5 - drop * (x - x0) / (x1 - x0), cut = Array.from({ length: k + 1 }, (_, i) => x0 + (x1 - x0) * i / k);
    const fs = cut.slice(0, -1).map((a, i) => ({ kind: 'line', coords: [ll(a, 100), ll(cut[i + 1], 100)],
      props: { Active: '1', ITPIPE_ASSETID: `B${k}_${i}`, PI_SHAPE: 'Elliptical', MATERIAL: 'Metal or Steel', PACP_Height: 96, PACP_Width: 144, US_INVERT: inv(a) / FT, DS_INVERT: inv(cut[i + 1]) / FT } }));
    const rs = pipeRecords([...sewer, ...fs], MF), net = realNetwork(g, f, rs, sim, { outfalls: [pt(x0, 100), pt(x1, 100)], realInlets: [pt(5, 195)], nativeSections: ns });
    return { rs, net, inp: toINP(net, g) };
  };
  // what SWMM reads, without the node, conduit and curve names or their column padding (C3 vs C10 is not a difference in the barrel)
  const body = (inp) => ['JUNCTIONS', 'OUTFALLS', 'CONDUITS', 'XSECTIONS', 'LOSSES', 'CURVES'].map(h => (inp.split(`[${h}]`)[1] ?? '').split('\n[')[0]
    .split('\n').filter(l => l.trim() && !l.startsWith(';;')).map(l => l.replace(/\bSH_C\d+\b/g, 'SH').replace(/^C\d+\b/, 'C').replace(/\b[JO]\d+\b/g, 'N').trim().replace(/\s+/g, ' ')).join('\n')).join('\n--\n');
  const head = (inp, Q) => { // steady headwater at the entrance for a constant inflow, 2 h
    const j = inp.split('[CONDUITS]')[1].split('\n').filter(l => /^C\d+/.test(l)).map(l => l.trim().split(/\s+/)).find(r => r[4] === '0.024')[1];
    // the entrance's MaxDepth is raised so a headwater above the ground is read, not lost as flooding
    swmm.open(inp.replace(new RegExp(`^(${j}\\s+\\S+\\s+)\\S+`, 'm'), '$110').replace(/\n\[CONDUITS\]/, `\n[DWF]\n${j} FLOW ${Q}\n\n[CONDUITS]`)); swmm.stride(7200);
    const h = swmm.node('HEAD', swmm.index('NODE', j)); swmm.finish(); return h;
  };
  const B = [1, 3, 6].map(k => ({ k, on: barrel(k, true), sep: barrel(k, { mergeBarrels: false }) }));
  for (const { k, on: o } of B) {
    const cvk = o.net.culverts?.[0], p = o.net.pipes.find(q => q.name === cvk?.pipes[0]);
    check(`T1, ${k} record(s): one conduit, 60 m, code 30, Ke 0.5, exit 1, ${k} source record(s) kept`, o.net.pipes.length === 4 && cvk?.pipes.length === 1 && near(o.net.nodes[p.from].invert + p.inOffset, 11.5, 1e-6) && near(p.L, 60, 0.6) &&
      p.xs.culvert === 30 && p.xs.loss.entry === 0.5 && p.xs.loss.exit === 1 && (k === 1 ? !p.records || p.records.length === 1 : p.records?.length === k), JSON.stringify({ L: p.L, loss: p.xs.loss, rec: p.records?.length }));
    if (k > 1) check(`…the ${k} records' lengths sum to the conduit and their inverts run end to end`, near(p.records.reduce((s, r) => s + r.L, 0), p.L, 0.01) && near(p.records[0].invUp, 11.5, 1e-6) && near(p.records.at(-1).invDn, 11.2, 1e-6), JSON.stringify(p.records));
    check(`…the canonical records are untouched (${k} + 3 sewer records in, as many out)`, o.rs.length === k + 3);
    if (k > 1) {
      const r = p.records, jn = r.slice(0, -1).map(x => x.joint);
      check(`…each of the ${k} records keeps its asset's source geometry, its own two nodes, its invert provenance and trust`, r.every((x, i) => x.line?.length === 2 && x.nodes.length === 2 && (i === 0 || x.nodes[0] === r[i - 1].nodes[1]) &&
        x.invProv?.join() === 'record,record' && x.invTrust?.every(t => t.status === 'accepted')), JSON.stringify(r[0]));
      check(`…and each of the ${k - 1} joint(s) says why it was merged (pass-through, no connection, same section, on the profile); the last record has none`,
        jn.every(j => j && /one length in and one out; no grate/.test(j.merged) && /within 0\.0\d\d m of the line/.test(j.merged)) && r.at(-1).joint === null, JSON.stringify(jn[0]));
    }
  }
  check('T1: 1, 3 and 6 records write the same SWMM input (nodes, conduit, section, losses, curve)', body(B[1].on.inp) === body(B[0].on.inp) && body(B[2].on.inp) === body(B[0].on.inp),
    process.env.DEBUG ? body(B[2].on.inp) : '');
  for (const Q of [3, 6]) {
    const h = B.map(b => head(b.on.inp, Q)), hs = B.map(b => head(b.sep.inp, Q));
    check(`T1, ${Q} m³/s: the same headwater for 1, 3, 6 records (${h.map(v => v.toFixed(3)).join(', ')} m)`, Math.max(...h) - Math.min(...h) < 0.001,
      `per-record form (off): ${hs.map(v => v.toFixed(3)).join(', ')} m`);
  }
  // steep (5 %), headwater below and above the crown. The merged barrel is one conduit whatever the record count. The
  // per-record form is printed for comparison only: through this network (interior junctions as deep as the ground
  // allows) it gives the same heads at these flows, so this test does not reproduce B8-M's 0.27 m; B8-M stays the
  // evidence for that, and the network's own Edwards run is the next check.
  const S5 = [1, 3, 6].map(k => ({ k, on: barrel(k, true, 3), sep: barrel(k, { mergeBarrels: false }, 3) }));
  check('T1, steep: 1, 3 and 6 records write the same SWMM input', body(S5[1].on.inp) === body(S5[0].on.inp) && body(S5[2].on.inp) === body(S5[0].on.inp));
  for (const Q of [15, 25]) {
    const h = S5.map(b => head(b.on.inp, Q)), hs = S5.map(b => head(b.sep.inp, Q)), crown = 11.5 + 96 * IN;
    check(`T1, steep, ${Q} m³/s: the same headwater for 1, 3, 6 records (${h.map(v => v.toFixed(3)).join(', ')} m; crown ${crown.toFixed(2)})`, Math.max(...h) - Math.min(...h) < 0.001,
      `per-record form (off): ${hs.map(v => v.toFixed(3)).join(', ')} m`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
