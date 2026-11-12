// Canonical infrastructure records (src/assets.js) and what survives into the network (src/network-real.js): shapes,
// material and provenance kept from every source, unknowns left unknown, equivalent assets alike whatever their source,
// the legacy solver mapping unchanged, and the opt-in barrel rule (one crossing endwall to endwall, oriented as a unit,
// catch-basin inverts kept as connections rather than read as its floor).
// Usage: node tests/run-assets-tests.mjs
import { GridRef, fromUTM } from '../src/geo.js';
import { toINP } from '../src/drainage.js';
import { realNetwork } from '../src/network-real.js';
import { detectPipeFields, pipeRecords } from '../src/linked.js';
import { layerInputs, feature, toLayer } from '../src/infra.js';
import { fromLinked, fromDrawn, fromOSM, legacySection, sectionArea, physicalKey, shapeOf, materialOf, structureClass, methodClass, joinStructures, detectStructureFields, structureRecords } from '../src/assets.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const IN = 0.0254, FT = 0.3048;

const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
const ll = (x, y) => fromUTM(486000 + x, 4422200 - y, 18);
const ground = (x, y) => 10 + 0.01 * x + 0.005 * (199 - y);
const z = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = ground(i, j);
const f = { z, bld: new Uint8Array(N), road: new Uint8Array(N), cls: null };
const sim = { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) };
const pt = (x, y) => { const [lon, lat] = ll(x, y); return { lon, lat }; };
// a Charlotte-style layer: PI_SHAPE, MATERIAL, PACP_Height / PACP_Width (in), US/DS invert, US/DS structure ids
const FIELDS = ['ITPIPE_ASSETID', 'PI_SHAPE', 'MATERIAL', 'PACP_Height', 'PACP_Width', 'US_ASSETID', 'US_INVERT', 'DS_ASSETID', 'DS_INVERT', 'Active'];
const line = (x0, x1, y = 100) => [ll(x0, y), ll(x1, y)];
const rec = (props, coords = line(0, 9)) => ({ kind: 'line', coords, props: { Active: '1', ...props } });
const M = detectPipeFields(FIELDS, [{ PACP_Height: 18 }, { PACP_Height: 24 }, { PACP_Height: 96 }]);

// ---- field detection and the legacy record: unchanged for an ordinary round pipe; the canonical record rides beside it
{
  check('fields: material, asset id and structure ids are found; size, shape and inverts as before',
    M.material === 'MATERIAL' && M.id === 'ITPIPE_ASSETID' && M.upNode === 'US_ASSETID' && M.dnNode === 'DS_ASSETID' && M.size === 'PACP_Height' && M.width === 'PACP_Width' &&
    M.shape === 'PI_SHAPE' && M.upInvert === 'US_INVERT' && M.dnInvert === 'DS_INVERT' && M.sizeUnits === 'in' && M.roughness === null, JSON.stringify(M));
  const [r] = pipeRecords([rec({ ITPIPE_ASSETID: 'P_1', PI_SHAPE: 'Circular', MATERIAL: 'Concrete', PACP_Height: 18, US_INVERT: 680.2, DS_INVERT: 679.9, US_ASSETID: 'S_1', DS_ASSETID: 'S_2' })], M);
  const { asset, ...legacy } = r;
  check('a round pipe keeps exactly its legacy fields', JSON.stringify(legacy) === JSON.stringify({ line: line(0, 9), h: 18 * IN, w: null, shape: 'CIRCULAR', barrels: 1, upInv: 680.2, dnInv: 679.9, combined: false }), JSON.stringify(legacy));
  check('…and its canonical record: circle, material, ids, inverts as recorded, provenance "record"',
    asset.source.type === 'municipal' && asset.source.id === 'P_1' && asset.section.shape === 'circle' && near(asset.section.rise, 18 * IN, 1e-9) && asset.section.span === asset.section.rise &&
    asset.material === 'concrete' && asset.ends.up.node === 'S_1' && asset.ends.dn.node === 'S_2' && asset.ends.up.invert === 680.2 && asset.ends.invertUnits === 'resolve' &&
    asset.prov.shape === 'record' && asset.prov.upInv === 'record' && asset.prov.material === 'record' && asset.prov.n === 'unknown' && asset.roughness.n === null && asset.profile === 'ends', JSON.stringify(asset.prov));
}

// ---- shapes survive ingestion: ellipse and arch keep their dimensions; the solver still gets the legacy section, flagged
{
  const [e] = pipeRecords([rec({ PI_SHAPE: 'Elliptical', MATERIAL: 'Metal or Steel', PACP_Height: 96, PACP_Width: 144 })], M);
  check('an elliptical 96 × 144 in pipe is a horizontal ellipse of that rise and span (7.0 m²), metal',
    e.asset.section.shape === 'h-ellipse' && near(e.asset.section.rise, 2.4384, 1e-6) && near(e.asset.section.span, 3.6576, 1e-6) && near(sectionArea(e.asset.section), 7.005, 0.005) && e.asset.material === 'metal' && e.asset.materialText === 'Metal or Steel',
    `${sectionArea(e.asset.section).toFixed(3)} m²`);
  const ls = legacySection(e.asset);
  check('…the solver still gets a circle of its rise (unchanged), and the approximation is named', e.shape === 'CIRCULAR' && e.w === null && ls.shape === 'CIRCULAR' && ls.approx === 'h-ellipse as a circle of its rise', ls.approx);
  const [a] = pipeRecords([rec({ PI_SHAPE: 'Arch', MATERIAL: 'Concrete', PACP_Height: 96, PACP_Width: 336 })], M);
  check('an arch 96 × 336 in stays an arch of that rise and span in the canonical record', a.asset.section.shape === 'arch' && near(a.asset.section.rise, 96 * IN, 1e-6) && near(a.asset.section.span, 336 * IN, 1e-6), JSON.stringify(a.asset.section));
  const la = legacySection(a.asset);
  check('…its equal-area rectangle is the legacy solver section, said out loud, not the record', a.shape === 'RECT_CLOSED' && near(a.w, 336 * IN * Math.PI / 4, 1e-6) && la.approx === 'arch as an equal-area rectangle of its rise' && near(la.w, a.w, 1e-12));
  const [v] = pipeRecords([rec({ PI_SHAPE: 'Elliptical', PACP_Height: 60, PACP_Width: 38 })], M);
  const [b] = pipeRecords([rec({ PI_SHAPE: 'Double Box', MATERIAL: 'Concrete', PACP_Height: 48, PACP_Width: 72 })], M);
  check('a taller-than-wide ellipse is vertical; "Double Box" is two box barrels (inferred from the text)', v.asset.section.shape === 'v-ellipse' && b.asset.section.shape === 'box' && b.asset.section.barrels === 2 && b.asset.prov.barrels === 'inferred' && b.barrels === 2);
  check('shape words', shapeOf('HORIZ ELLIPSE') === 'h-ellipse' && shapeOf('Elliptical') === 'ellipse' && shapeOf('Pipe arch') === 'arch' && shapeOf('RCB') === 'box' && shapeOf('Round') === 'circle' && shapeOf('Unknown') === null && shapeOf('') === null);
  check('material words', materialOf('RCP') === 'concrete' && materialOf('CMP') === 'metal' && materialOf('HDPE') === 'plastic' && materialOf('VCP') === 'clay' && materialOf('DIP') === 'iron' && materialOf('Unknown') === null);
}

// ---- unknowns stay unknown in the record; where the network fills one, it says so
{
  const [u] = pipeRecords([rec({ PI_SHAPE: 'Unknown', MATERIAL: 'Unknown', PACP_Height: null })], M);
  check('unknown shape, material, size and inverts are null and "unknown", not a default', u.asset.section.shape === null && u.asset.section.rise === null && u.asset.material === null &&
    ['shape', 'rise', 'span', 'material', 'n', 'upInv', 'dnInv', 'condition'].every(k => u.asset.prov[k] === 'unknown') && u.asset.condition.state === 'unknown' && u.asset.profile === 'unknown', JSON.stringify(u.asset.prov));
  check('…the legacy section still reads it as a circle, and says the shape was unknown', u.shape === 'CIRCULAR' && legacySection(u.asset).approx === null && legacySection({ section: { shape: null, rise: 0.5, span: null } }).approx === 'shape unknown: circle');
  const recs = pipeRecords([rec({ PI_SHAPE: 'Circular', PACP_Height: 18 }, line(20, 60)), rec({ PI_SHAPE: 'Unknown', PACP_Height: null }, line(60, 100)), rec({ PI_SHAPE: 'Circular', PACP_Height: 24 }, line(100, 140))], M);
  const net = realNetwork(g, f, recs, sim, {}), filled = net.pipes.find(p => p.real && p.filledSize);
  check('in the network a filled size says where it came from; the default n is marked default', filled?.prov.size === 'neighbour' && net.pipes.filter(p => p.real).every(p => p.prov.n === 'default' && p.prov.upInv === 'derived'), JSON.stringify(filled?.prov));
}

// ---- the same physical conduit from three sources gives the same canonical geometry and material
{
  const [lk] = pipeRecords([rec({ PI_SHAPE: 'Circular', MATERIAL: 'Concrete', PACP_Height: 1.2 / IN })], M);
  const dr = fromDrawn({ D: 1.2, material: 'concrete' }, 'culvert'), osm = fromOSM({ diameter: '1200', material: 'concrete' }, 'stream');
  check('a 1.2 m concrete culvert: utility layer = drawn = OSM', physicalKey(lk.asset) === physicalKey(dr) && physicalKey(dr) === physicalKey(osm), physicalKey(osm));
  check('…while each keeps its own source and provenance', lk.asset.source.type === 'municipal' && dr.source.type === 'drawn' && osm.source.type === 'osm' && lk.asset.prov.rise === 'record' && dr.prov.rise === 'user' && osm.prov.rise === 'tag' && dr.prov.shape === 'default');
  const [bx] = pipeRecords([rec({ PI_SHAPE: 'Box', MATERIAL: 'Concrete', PACP_Height: 48, PACP_Width: 72 })], M);
  check('a 48 × 72 in box: utility layer = drawn', physicalKey(bx.asset) === physicalKey(fromDrawn({ D: 48 * IN, W: 72 * IN, shape: 'RECT_CLOSED', material: 'RCP' }, 'pipe')));
  // an ellipse imported into the drawer from a file keeps its shape and material (beside the drawer's own round/box field)
  const items = [{ name: 'culverts.shp', kind: 'line', coords: line(0, 9), props: { PI_SHAPE: 'Elliptical', MATERIAL: 'Metal or Steel', PACP_Height: 96, PACP_Width: 144, US_INVERT: 673.0, DS_INVERT: 674.2 } }];
  const { features } = toLayer(items, { as: 'pipe', detectPipeFields }), [imp] = layerInputs({ type: 'FeatureCollection', features }).pipes;
  check('an elliptical pipe imported into the drawer: same canonical record as from the utility layer; model input unchanged',
    physicalKey(imp.asset) === physicalKey(pipeRecords([rec({ PI_SHAPE: 'Elliptical', MATERIAL: 'Metal or Steel', PACP_Height: 96, PACP_Width: 144 })], M)[0].asset) && imp.shape === 'CIRCULAR' && imp.w === null && imp.asset.prov.shape === 'record',
    physicalKey(imp.asset));
  const blocked = fromDrawn({ D: 1, blocked: 0.5 }, 'culvert');
  check('a drawn culvert half blocked is a "partial" scenario the user set; OSM and layer conditions are unknown', blocked.condition.state === 'partial' && blocked.condition.blockedShare === 0.5 && blocked.prov.condition === 'user' && osm.condition.state === 'unknown' && lk.asset.condition.state === 'unknown');
}

// ---- provenance through the network: interpolated at a split, carried, bridged, from a manhole, direction by inverts
{
  // metres are recognised from three surveyed pipes; a fourth, rising, is turned round by its inverts; an inlet splits a fifth
  const recs = [[20, 60, 9.5, 9.4], [60, 100, 9.4, 9.3], [100, 140, 9.3, 9.2]].map(([x0, x1, u, d]) => ({ line: line(x0, x1, 170), h: 0.6, upInv: u, dnInv: d }));
  recs.push({ line: line(40, 80, 40), h: 0.5, upInv: 9.0, dnInv: 9.6 }, { line: line(20, 120, 140), h: 0.45, upInv: 9.6, dnInv: 9.1 }, { line: line(130, 170, 60), h: 0.45, upInv: 9.6, dnInv: null });
  const net = realNetwork(g, f, recs, sim, { realInlets: [pt(70, 141)] });
  const P = (y) => net.pipes.filter(p => p.real && Math.abs(net.nodes[p.from].p[1] - y) < 1.5);
  const [r] = P(40), split = P(140), carried = P(60)[0];
  check('a pipe turned round by rising inverts says so', r.prov.direction === 'inverts' && P(170).every(p => p.prov.direction === 'drawn' && p.prov.upInv === 'record'), r.prov.direction);
  check('an inlet splitting a pipe: the new middle invert is "interpolated", the outer ends stay "record"', split.length === 2 && split.some(p => p.prov.upInv === 'record' && p.prov.dnInv === 'interpolated') && split.some(p => p.prov.upInv === 'interpolated' && p.prov.dnInv === 'record'), JSON.stringify(split.map(p => [p.prov.upInv, p.prov.dnInv])));
  check('a missing end carried from the other at the ground slope is "carried"', carried.prov.upInv === 'record' && carried.prov.dnInv === 'carried', JSON.stringify(carried.prov));
  const box = [{ D: 1, upInv: null, dnInv: null }].map(() => feature('pipe', { type: 'LineString', coordinates: line(20, 60, 30) }, { D: 0.6, upInv: 9.2 }));
  const mh = feature('manhole', { type: 'Point', coordinates: ll(60, 30) }, { invert: 9.0 });
  const [dp] = layerInputs({ type: 'FeatureCollection', features: [...box, mh] }).pipes;
  check('a drawn pipe end filled from a manhole is "manhole"; the typed one is "user"', dp.asset.prov.upInv === 'user' && dp.asset.prov.dnInv === 'manhole' && dp.asset.ends.dn.invert === 9.0, JSON.stringify(dp.asset.prov));
}

// ---- Edwards Branch: one elliptical CMP in three lengths, endwall to endwall, two catch basins on it, adverse 0.37 m
const surveyed = [[20, 60], [60, 100], [100, 140]].map(([x0, x1]) => rec({ PI_SHAPE: 'Circular', MATERIAL: 'Concrete', PACP_Height: 24, US_INVERT: (ground(x0, 170) - 1.5) / FT, DS_INVERT: (ground(x1, 170) - 1.6) / FT }, line(x0, x1, 170)));
const E = { A: 50, B: 70, C: 82, D: 100 }, zA = 8.0, zD = 8.37, cbB = 10.0, cbC = 10.3; // m; endwalls by GPS, catch basins near the crown
const crossing = [[E.A, E.B, zA, cbB], [E.B, E.C, cbB, cbC], [E.C, E.D, cbC, zD]].map(([x0, x1, u, d], i) =>
  rec({ ITPIPE_ASSETID: 'P_' + i, PI_SHAPE: 'Elliptical', MATERIAL: 'Metal or Steel', PACP_Height: 96, PACP_Width: 144, US_INVERT: u / FT, DS_INVERT: d / FT }, line(x0, x1)));
const lateral = rec({ PI_SHAPE: 'Circular', MATERIAL: 'Concrete', PACP_Height: 18, US_INVERT: 11.5 / FT, DS_INVERT: 10.5 / FT }, [ll(E.C, 130), ll(E.C, 100)]);
const recsE = pipeRecords([...surveyed, ...crossing, lateral], M);
const optsE = { outfalls: [pt(E.A, 100), pt(E.D, 100)], realInlets: [pt(E.B, 101), pt(E.C, 101)] };
const nodeAt = (net, x) => net.nodes.findIndex(n => Math.abs(n.p[0] - x) < 1.2 && Math.abs(n.p[1] - 100) < 1.2);
const barrel = (net) => net.pipes.filter(p => p.real && near(p.D, 2.4384, 1e-6));
{
  const off = realNetwork(g, f, recsE, sim, optsE);
  check('without barrelRuns the old reading stands: rising lengths turned round, outfalls at both endwalls', off.nodes[nodeAt(off, E.A)].outfall && off.nodes[nodeAt(off, E.D)].outfall && barrel(off).some(p => p.prov.direction === 'inverts'),
    `outfalls ${off.nodes.filter(n => n.outfall && !n.offsite).map(n => n.name).join(', ')}`);
  const same = (x, y) => JSON.stringify([x.nodes, x.pipes, x.inlets, x.stats]) === JSON.stringify([y.nodes, y.pipes, y.inlets, y.stats]);
  const f0 = realNetwork(g, f, recsE, sim, { ...optsE, barrelRuns: false });
  check('barrelRuns: false is the default, exactly', same(f0, off) && toINP(f0, g) === toINP(off, g));
  const strip = pipeRecords([...surveyed, ...crossing, lateral], M).map(({ asset, ...r }) => r), bare = realNetwork(g, f, strip, sim, optsE);
  check('the canonical record changes nothing the solver is given (same .inp with and without it)', toINP(bare, g) === toINP(off, g));

  const on = realNetwork(g, f, recsE, sim, { ...optsE, barrelRuns: true }), [a, b, c, d] = [E.A, E.B, E.C, E.D].map(x => nodeAt(on, x)), bp = barrel(on);
  const chain = [[a, b], [b, c], [c, d]].every(([u, v]) => bp.some(p => p.from === u && p.to === v));
  check('barrelRuns: the three lengths are one barrel, east endwall to west endwall, as drawn', on.stats.barrels === 1 && chain && bp.every(p => p.prov.direction === 'barrel: as drawn'), JSON.stringify(bp.map(p => [on.nodes[p.from].name, on.nodes[p.to].name])));
  check('…the adverse 0.37 m between the endwalls does not turn it round; one outfall, at the downstream endwall', on.stats.adverseBarrels === 1 && !on.nodes[a].outfall && on.nodes[d].outfall && near(on.nodes[a].invert, zA, 1e-6) && near(on.nodes[d].invert, zD, 1e-6) && on.stats.culvertEntrances === 1,
    `${on.nodes[a].invert.toFixed(2)} → ${on.nodes[d].invert.toFixed(2)} m`);
  const L = bp.reduce((s, p) => s + p.L, 0), lineAt = (x) => zA + (zD - zA) * (x - E.A) / (E.D - E.A);
  check("…the catch basins' elevations are not the barrel's floor: it lies on the line between the endwalls",
    near(on.nodes[b].invert, lineAt(E.B), 0.03) && near(on.nodes[c].invert, lineAt(E.C), 0.03) && on.stats.barrelEnds === 4 && bp.filter(p => p.prov.upInv === 'interpolated').length === 2,
    `floor ${on.nodes[b].invert.toFixed(3)} / ${on.nodes[c].invert.toFixed(3)} m over ${L.toFixed(1)} m`);
  check('…and are kept on the structures as connections, which still take their inlets and the lateral', near(on.nodes[b].connInv, cbB, 1e-6) && near(on.nodes[c].connInv, cbC, 1e-6) &&
    on.inlets.some(e => e.node === b && e.grates > 0) && on.pipes.some(p => p.real && p.to === c && near(p.D, 18 * IN, 1e-6) && p.outOffset > 2), `connections ${on.nodes[b].connInv} / ${on.nodes[c].connInv} m`);
}
// ================================================================== adversarial barrel cases
// Ground that falls toward +x (the way the creeks below run), so the terrain is evidence the right way round. Pipes are
// in feet, like Charlotte's, with US/DS structure ids; structure records are joined by id (joinStructures).
const ground2 = (x) => 15 - 0.02 * x;
const z2 = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z2[j * 200 + i] = ground2(i);
const f2 = { z: z2, bld: new Uint8Array(N), road: new Uint8Array(N), cls: null };
const sid = (x, y) => `S_${x}_${y}`;
// a length from (x0, y) to (x1, y), inverts in m (written in ft), the section in inches
const len = (x0, x1, y, u, d, { H = 96, W = 144, shape = 'Elliptical', mat = 'Metal or Steel', notes = null, x0y = y, x1y = y } = {}) =>
  rec({ ITPIPE_ASSETID: `P_${x0}_${x1}_${y}`, PI_SHAPE: shape, MATERIAL: mat, PACP_Height: H, PACP_Width: W, US_ASSETID: sid(x0, x0y), DS_ASSETID: sid(x1, x1y),
    US_INVERT: u == null ? null : u / FT, DS_INVERT: d == null ? null : d / FT, ...(notes ? { NOTES: notes } : {}) }, [ll(x0, x0y), ll(x1, x1y)]);
const struct = (x, y, type, inv, source = 'Submeter GPS', notes = null) => ({ id: sid(x, y), type, class: structureClass(type), invert: inv == null ? null : inv / FT, rim: null, source, method: methodClass(source), notes, lon: ll(x, y)[0], lat: ll(x, y)[1] });
// three ordinary surveyed pipes elsewhere, so the layer's inverts are read as feet
const base = [[20, 60], [60, 100], [100, 140]].map(([x0, x1]) => len(x0, x1, 190, ground2(x0) - 1.5, ground2(x1) - 1.6, { H: 24, W: null, shape: 'Circular', mat: 'Concrete' }));
const build = (pipes, structs, opts = {}) => {
  const { pipes: joined, report } = joinStructures(pipeRecords([...base, ...pipes], M), structs);
  return { net: realNetwork(g, f2, joined, sim, opts), report, joined };
};
const nodeXY = (net, x, y) => net.nodes.findIndex(n => Math.abs(n.p[0] - x) < 1.2 && Math.abs(n.p[1] - y) < 1.2);
const sameNet = (x, y) => toINP(x, g) === toINP(y, g) && JSON.stringify(x.inlets) === JSON.stringify(y.inlets);
const walls = (pts, y) => pts.map(([x]) => ({ ...pt(x, y) }));

// ---- 1. a genuine adverse barrel: drawn with the creek, the endwall floors rise 0.37 m, two catch basins on it
{
  const y = 100, X = [50, 70, 82, 100], zA = 11.5, zD = 11.87, cb = [12.9, 12.8];
  const pipes = [len(X[0], X[1], y, zA, cb[0]), len(X[1], X[2], y, cb[0], cb[1]), len(X[2], X[3], y, cb[1], zD)];
  const S = [struct(X[0], y, 'Endwall', zA), struct(X[3], y, 'Endwall', zD), struct(X[1], y, 'DCB', cb[0], 'Record Drawing', 'box dumps directly into culvert'), struct(X[2], y, 'DCB', cb[1], 'Record Drawing', 'inlet enters directly into culvert')];
  const { net, report } = build(pipes, S, { outfalls: walls([[X[0]], [X[3]]], y), barrelRuns: true });
  const b = net.barrels.find(r => r.pipes.length === 3), [a, , , d] = X.map(x => nodeXY(net, x, y));
  check('adverse barrel: found with both endwalls, graded high, matched to its four structure records', b?.grade === 'high' && report.matched >= 6 && report.conflicts === 0, JSON.stringify(b && { grade: b.grade, basis: b.basis }));
  check('…oriented as drawn with high confidence: the source and the terrain agree; the 0.37 m adverse fall does not vote', b.direction.toB && b.direction.confidence === 'high' && b.direction.evidence.terrain === 1 && b.direction.evidence.inverts === 0 && net.stats.adverseBarrels === 1 && net.nodes[d].outfall && !net.nodes[a].outfall,
    JSON.stringify(b.direction.evidence));
  check('…the catch basins (structure records say DCB, "enters directly into culvert"; no grates placed) are connections; the floor is the line',
    b.interior.every(r => r.class === 'connection' && r.structure === 'DCB') && b.interior.every(r => near(net.nodes[r.node].invert, r.floor, 1e-6) && near(net.nodes[r.node].connInv, Math.max(...r.given), 1e-6)), JSON.stringify(b.interior.map(r => [r.class, +r.floor.toFixed(3)])));
}

// ---- 2. a high interior invert with nothing to explain it is reported, not rewritten
{
  const y = 100, X = [50, 70, 82, 100], zA = 11.5, zD = 11.87, hi = [12.9, 12.8];
  const pipes = [len(X[0], X[1], y, zA, hi[0]), len(X[1], X[2], y, hi[0], hi[1]), len(X[2], X[3], y, hi[1], zD)];
  const S = [struct(X[0], y, 'Endwall', zA), struct(X[3], y, 'Endwall', zD), struct(X[1], y, 'MH', hi[0], 'Record Drawing'), struct(X[2], y, 'MH', hi[1], 'Record Drawing')];
  const { net } = build(pipes, S, { outfalls: walls([[X[0]], [X[3]]], y), barrelRuns: true }), b = net.barrels.find(r => r.pipes.length === 3);
  check('a hump at manholes with no inlet: "possible connection", flagged, inverts left as recorded',
    b.interior.every(r => r.class === 'possible connection') && b.flags.filter(t => /possible connection|no structure to explain/.test(t)).length === 2 &&
    near(net.nodes[nodeXY(net, X[1], y)].invert, hi[0], 1e-3) && net.stats.barrelEnds === 0, JSON.stringify(b.interior.map(r => r.class)));
}

// ---- 3. a continuously falling, non-linear barrel through a catch basin keeps its recorded floor
{
  const y = 60, pipes = [len(30, 50, y, 12.0, 11.9), len(50, 70, y, 11.9, 11.0), len(70, 90, y, 11.0, 10.9)];
  const S = [struct(30, y, 'Endwall', 12.0), struct(90, y, 'FES', 10.9), struct(50, y, 'CB', 11.9, 'Record Drawing'), struct(70, y, 'DI', 11.0, 'Record Drawing')];
  const { net } = build(pipes, S, { outfalls: walls([[30], [90]], y), barrelRuns: true, realInlets: [pt(50, 61)] }), b = net.barrels.find(r => r.pipes.length === 3);
  check('a falling non-linear barrel: its inlets are "structure on the barrel", its recorded floor stands',
    b?.grade === 'high' && b.interior.every(r => r.class === 'structure on the barrel') && near(net.nodes[nodeXY(net, 50, y)].invert, 11.9, 1e-3) && near(net.nodes[nodeXY(net, 70, y)].invert, 11.0, 1e-3) && net.stats.barrelEnds === 0,
    JSON.stringify(b?.interior.map(r => r.class)));
}

// ---- 4. a missing endwall lowers the grade, it does not hide the run; a named culvert with no endwalls is still found
{
  const y = 40, pipes = [len(30, 60, y, 12.6, 12.4), len(60, 90, y, 12.4, 12.1)];
  const S = [struct(30, y, 'Endwall', 12.6)];
  const on = build(pipes, S, { outfalls: walls([[30]], y), barrelRuns: true }).net, off = build(pipes, S, { outfalls: walls([[30]], y) }).net;
  const b = on.barrels.find(r => r.pipes.length === 2);
  check('one endwall and a dead end: graded low, reported with its flag, nothing changed', b?.grade === 'low' && b.flags.some(t => /one end missing/.test(t)) && sameNet(on, off), JSON.stringify(b && { grade: b.grade, basis: b.basis }));
  const named = [len(110, 140, y, 11.6, 11.4, { notes: 'single metal culvert' }), len(140, 170, y, 11.4, 11.2, { notes: 'single metal culvert' })];
  const n2 = build(named, [], { barrelRuns: true }).net, b2 = n2.barrels.find(r => r.pipes.length === 2);
  check('a run the source calls a culvert, with no endwall on record: graded medium and oriented as a unit', b2?.grade === 'medium' && b2.basis.includes('the source calls it a culvert') && b2.direction.toB && b2.direction.how === 'barrel: as drawn',
    JSON.stringify(b2 && { grade: b2.grade, basis: b2.basis, how: b2.direction.how }));
}

// ---- 5. two culverts end to end with different sizes stay two
{
  const y = 160, pipes = [len(30, 60, y, 12.9, 12.6, { H: 48, W: 48, shape: 'Circular', notes: 'culvert' }), len(60, 90, y, 12.6, 12.2, { H: 60, W: 60, shape: 'Circular', notes: 'culvert' })];
  const S = [struct(30, y, 'Endwall', 12.9), struct(90, y, 'Endwall', 12.2)];
  const { net } = build(pipes, S, { outfalls: walls([[30], [90]], y), barrelRuns: true });
  const c = net.barrels.filter(r => r.basis.includes('the source calls it a culvert'));
  check('adjacent culverts of 48 and 60 in: two candidates of one length each, never merged; the shared node keeps its invert',
    c.length === 2 && c.every(r => r.pipes.length === 1) && new Set(c.flatMap(r => r.pipes)).size === 2 && near(net.nodes[nodeXY(net, 60, y)].invert, 12.6, 1e-3), JSON.stringify(c.map(r => r.pipes)));
}

// ---- 6. three lengths of one section meeting at a junction: no run is carried through the branch
{
  const y = 130, j = [100, y], opt = { H: 36, W: 36, shape: 'Circular', mat: 'Concrete', notes: 'culvert' };
  const branch = rec({ ITPIPE_ASSETID: 'P_branch', PI_SHAPE: 'Circular', MATERIAL: 'Concrete', PACP_Height: 36, PACP_Width: 36, US_ASSETID: sid(100, 165), DS_ASSETID: sid(...j), US_INVERT: 12.75 / FT, DS_INVERT: 12.6 / FT, NOTES: 'culvert' }, [ll(100, 165), ll(...j)]);
  const pipes = [len(60, 100, y, 12.9, 12.6, opt), len(100, 140, y, 12.6, 12.0, opt), branch];
  const S = [struct(60, y, 'Endwall', 12.9), struct(140, y, 'Endwall', 12.0), struct(100, 165, 'Endwall', 12.75)];
  const opts = { outfalls: [pt(60, y), pt(140, y), pt(100, 165)] };
  const on = build(pipes, S, { ...opts, barrelRuns: true }).net, off = build(pipes, S, opts).net, at = nodeXY(on, ...j);
  check('a junction of three equal lengths ends every run there: three single-length candidates, the junction invert unchanged',
    on.barrels.filter(r => r.basis.includes('the source calls it a culvert')).length === 3 && on.barrels.every(r => r.pipes.length === 1) && near(on.nodes[at].invert, off.nodes[nodeXY(off, ...j)].invert, 1e-9), `${on.barrels.length} candidates`);
}

// ---- 7. direction: the source wins unless independent evidence and the inverts both contradict it
{
  const y = 80, run = (pts, o2 = {}) => pts.slice(1).map((p, i) => len(pts[i][0], p[0], y, pts[i][1], p[1], { H: 36, W: 36, shape: 'Circular', mat: 'Concrete', ...o2 }));
  const back = run([[90, 11.0], [60, 11.6], [30, 12.1]]); // drawn from the low end, against the creek and against its inverts
  const S = [struct(90, y, 'Endwall', 11.0), struct(30, y, 'Endwall', 12.1)];
  const b = build(back, S, { outfalls: walls([[30], [90]], y), barrelRuns: true }).net.barrels.find(r => r.pipes.length === 2);
  check('drawn against the terrain and the inverts: turned as a unit, confidence low, flagged', b && !b.direction.toB && b.direction.confidence === 'low' && /turned/.test(b.direction.how) && b.flags.some(t => /turned round/.test(t)), JSON.stringify(b?.direction));
  const flat = run([[90, 11.5], [60, 11.6], [30, 11.65]]); // against the terrain only: the inverts are within a quarter of the rise
  const S2 = [struct(90, y, 'Endwall', 11.5), struct(30, y, 'Endwall', 11.65)];
  const b2 = build(flat, S2, { outfalls: walls([[30], [90]], y), barrelRuns: true }).net.barrels.find(r => r.pipes.length === 2);
  check('…against the terrain alone: kept as drawn, confidence medium, flagged for review', b2 && b2.direction.toB && b2.direction.confidence === 'medium' && b2.flags.some(t => /kept as drawn although the terrain/.test(t)), JSON.stringify(b2?.direction));
  const mixed = [len(30, 60, y, 12.1, 11.6, { H: 36, W: 36, shape: 'Circular', mat: 'Concrete' }), rec({ ...len(60, 90, y, 11.0, 11.6, { H: 36, W: 36, shape: 'Circular', mat: 'Concrete' }).props, US_ASSETID: sid(90, y), DS_ASSETID: sid(60, y), US_INVERT: 11.0 / FT, DS_INVERT: 11.6 / FT }, [ll(90, y), ll(60, y)])];
  const S3 = [struct(30, y, 'Endwall', 12.1), struct(90, y, 'Endwall', 11.0)];
  const b3 = build(mixed, S3, { outfalls: walls([[30], [90]], y), barrelRuns: true }).net.barrels.find(r => r.pipes.length === 2);
  check('…lengths drawn both ways: oriented by the terrain, not by the inverts', b3 && b3.direction.how === 'barrel: by the terrain (lengths drawn both ways)' && b3.direction.toB && b3.from === nodeXY(build(mixed, S3, { outfalls: walls([[30], [90]], y), barrelRuns: true }).net, 30, y), JSON.stringify(b3?.direction));
}

// ---- 8. conflicting records: every value kept, the surveyed one chosen, the conflict visible in the record and the run
{
  const y = 100, X = [50, 70, 82, 100];
  const pipes = [len(X[0], X[1], y, 11.5, 12.9), len(X[1], X[2], y, 12.9, 12.8), len(X[2], X[3], y, 12.8, 11.87)];
  const S = [struct(X[0], y, 'Endwall', 11.2, 'Submeter GPS'), struct(X[3], y, 'Endwall', 11.87), struct(X[1], y, 'DCB', 12.9, 'Record Drawing'), struct(X[2], y, 'DCB', 12.9, 'Record Drawing')];
  const before = JSON.stringify(S);
  const { net, report, joined } = build(pipes, S, { outfalls: walls([[X[0]], [X[3]]], y), barrelRuns: true });
  const e = joined.find(r => r.asset.source.id === `P_${X[0]}_${X[1]}_${y}`).asset.ends.up, e2 = joined.find(r => r.asset.source.id === `P_${X[2]}_${X[3]}_${y}`).asset.ends.up;
  check('an endwall the pipe layer puts 0.3 m above the GPS record: both kept, the surveyed value chosen, the conflict marked',
    e.conflict && e.evidence.length === 2 && near(e.evidence[0].value * FT, 11.5, 1e-6) && near(e.resolved.value * FT, 11.2, 1e-6) && e.resolved.from === 'structure record' && /surveyed structure record/.test(e.resolved.how) && report.conflicts === 3, // the endwall, and both ends at the catch basin they enter below its recorded invert
    `${e.resolved.how}; ${report.conflicts} conflicts`);
  check('…both lengths meeting a catch basin 0.1 m below its recorded invert are conflicts too (a structure invert is its lowest)', e2.conflict && e2.structure.class === 'inlet', e2.resolved.how);
  const b = net.barrels.find(r => r.pipes.length === 3);
  check('…the barrel takes the chosen endwall floor and says so', b && near(net.nodes[nodeXY(net, X[0], y)].invert, 11.2, 1e-3) && b.flags.some(t => /disagree at an endwall/.test(t)), b?.flags.join('; '));
  check('…the structure records are not changed by the join', JSON.stringify(S) === before);
  const agree = joinStructures(pipeRecords([len(X[0], X[1], y, 11.5, 12.9)], M), [struct(X[0], y, 'Endwall', 11.5)]).pipes[0].asset.ends.up;
  check('an endwall whose records agree: the value with its structure method, no conflict', !agree.conflict && agree.resolved.method === 'Submeter GPS' && agree.resolved.how === 'pipe layer and structure record agree');
  const drop = joinStructures(pipeRecords([len(X[0], X[1], y, 11.5, 12.9)], M), [struct(X[1], y, 'MH', 12.0, 'Record Drawing')]).pipes[0].asset.ends.dn;
  check('a pipe entering a manhole above its floor is not a conflict', !drop.conflict && drop.resolved.from === 'pipe layer' && /enters .* above the manhole/.test(drop.resolved.how), drop.resolved.how);
}

// ---- 9. source records are immutable: nothing in the build writes to them
{
  const deep = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deep); } return o; };
  const y = 100, X = [50, 70, 82, 100];
  const recs = deep(pipeRecords([...base, len(X[0], X[1], y, 11.5, 12.9), len(X[1], X[2], y, 12.9, 12.8), len(X[2], X[3], y, 12.8, 11.87)], M));
  const S = deep([struct(X[0], y, 'Endwall', 11.2), struct(X[3], y, 'Endwall', 11.87), struct(X[1], y, 'DCB', 12.9, 'Record Drawing')]);
  let err = null;
  try { const { pipes } = joinStructures(recs, S); realNetwork(g, f2, pipes, sim, { outfalls: walls([[X[0]], [X[3]]], y), realInlets: [pt(X[1], y + 1)], barrelRuns: true }); } catch (e) { err = e; }
  check('frozen source records and structure records go through the join and the network build untouched', err === null, err?.message ?? '');
}

// ---- 10. barrelRuns on Edwards-like ground leaves ordinary networks alone: no candidate in a plain sewer
{
  const y = 140, pipes = [len(20, 60, y, 13.0, 12.7, { H: 18, W: null, shape: 'Circular', mat: 'Concrete' }), len(60, 100, y, 12.7, 12.4, { H: 18, W: null, shape: 'Circular', mat: 'Concrete' }), len(100, 140, y, 12.4, 12.0, { H: 24, W: null, shape: 'Circular', mat: 'Concrete' })];
  const S = [struct(60, y, 'MH', 12.7, 'Record Drawing'), struct(100, y, 'MH', 12.4, 'Record Drawing')];
  const on = build(pipes, S, { barrelRuns: true }).net, off = build(pipes, S, {}).net;
  check('a plain sewer with no endwalls and no culvert in its records: no candidate, the same network', on.barrels.length === 0 && sameNet(on, off), `${on.barrels.length} candidates`);
}

// ---- 11. only a run endwall to endwall has its interior touched; twins are flagged; a lone missing end is not filled
{
  const y = 40, named = [len(110, 140, y, 11.6, null, { notes: 'single metal culvert' }), len(140, 170, y, null, 11.2, { notes: 'single metal culvert' })];
  const on = build(named, [], { barrelRuns: true }).net, off = build(named, [], {}).net, b = on.barrels.find(r => r.pipes.length === 2), at = (n) => n.nodes[nodeXY(n, 140, y)].invert;
  check('a medium run (named culvert, no endwalls) with no invert in its middle: oriented, but the interior is not filled', b?.grade === 'medium' && near(at(on), at(off), 1e-9) && on.stats.barrelEnds === 0 && b.flags.some(t => /not endwall to endwall/.test(t)), `${at(on).toFixed(3)} vs ${at(off).toFixed(3)} m`);
  const yy = 100, X = [50, 70, 100], pipes = [len(X[0], X[1], yy, 11.5, null), len(X[1], X[2], yy, 13.0, 11.87)];
  const S = [struct(X[0], yy, 'Endwall', 11.5), struct(X[2], yy, 'Endwall', 11.87), struct(X[1], yy, 'MH', 13.0, 'Record Drawing')];
  const n1 = build(pipes, S, { outfalls: walls([[X[0]], [X[2]]], yy), barrelRuns: true }).net, b1 = n1.barrels.find(r => r.pipes.length === 2);
  check('a possible connection with one end missing: the missing end is carried as before, not put on the line', b1.interior[0].class === 'possible connection' && n1.stats.barrelEnds === 0 && b1.flags.some(t => /carried as before/.test(t)), JSON.stringify(b1.interior[0].given));
  const one = len(30, 60, 160, 12.9, 12.6, { H: 48, W: 48, shape: 'Circular' }), dup = rec({ ...one.props, ITPIPE_ASSETID: 'P_dup' }, one.coords);
  const n2 = build([one, dup], [struct(30, 160, 'Endwall', 12.9), struct(60, 160, 'Endwall', 12.6)], { outfalls: walls([[30], [60]], 160), barrelRuns: true }).net;
  check('two records with the same ends and section: each flagged as possible twin barrels or a duplicate, neither merged', n2.barrels.length === 2 && n2.barrels.every(r => r.pipes.length === 1 && r.flags.some(t => /twin barrels/.test(t))), n2.barrels.map(r => r.flags.join('; ')).join(' | '));
}

console.log(fails ? `\n${fails} asset test(s) FAILED` : '\nall asset tests passed');
process.exit(fails ? 1 : 0);
