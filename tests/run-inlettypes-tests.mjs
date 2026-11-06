// Kinds of inlet by type tests: a utility's type codes (Charlotte's STRUCT_TYPE) give classes, a standard (NCDOT in
// North Carolina) gives each class a kind with its own grate, each grate carries it through the network to the
// coupler, grates of different kinds on one cell add up, and a network without types is the same as before.
// Usage: node tests/run-inlettypes-tests.mjs
import { INLET_KINDS, INLET_STANDARDS, classifyInlet, inNorthCarolina, defaultStandard, kindHydraulics, inletTypeCounts, typeKinds, applyInletKinds, detectTypeField } from '../src/inlettypes.js';
import { inletFlow, inletOptions, exchangePoints, DESIGN_DEFAULTS, synthNetwork } from '../src/drainage.js';
import { realNetwork } from '../src/network-real.js';
import { pointRecords } from '../src/linked.js';
import { settingsChanges } from '../src/compare.js';
import { Coupler } from '../src/coupler.js';
import { GridRef, fromUTM } from '../src/geo.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- type codes → classes
{
  const cls = (t) => { const c = classifyInlet(t); return c ? c.cls + (c.sides ? c.sides : '') : null; };
  const clt = ['CB', 'DI', 'DCB', 'CI', 'SlabDI 1', 'SlabDI 2', 'SlabDI 3', 'SlabDI 4', 'Elong Throat'].map(cls);
  check('Charlotte STRUCT_TYPE codes: catch basin, drop inlet, double, curb, slab-top with 1–4 sides, elongated throat',
    JSON.stringify(clt) === JSON.stringify(['cb', 'drop', 'double', 'curb', 'slab1', 'slab2', 'slab3', 'slab4', 'elong']), JSON.stringify(clt));
  const words = ['Catch Basin', 'Curb Inlet', 'Drop Inlet', 'Yard inlet', 'Double Catch Basin', 'Open Throat', 'Grate'].map(cls);
  check('written-out names', JSON.stringify(words) === JSON.stringify(['cb', 'curb', 'drop', 'drop', 'double', 'curb', 'cb']), JSON.stringify(words));
  check('not inlets, or nothing: no class', ['Endwall', 'FES', 'Manhole', '', null, undefined].every(t => classifyInlet(t) === null));
}

// ---- where a standard applies
{
  check('North Carolina: Charlotte, Raleigh, Asheville, Wilmington', [[-80.76, 35.2], [-78.64, 35.78], [-82.55, 35.6], [-77.95, 34.23]].every(p => inNorthCarolina(...p)));
  check('not North Carolina: Philadelphia, Columbia SC, Knoxville, Norfolk, Queens', [[-75.16, 39.95], [-81.03, 34.0], [-83.92, 35.96], [-76.29, 36.85], [-73.85, 40.72]].every(p => !inNorthCarolina(...p)));
  check('Automatic picks NCDOT in North Carolina, none elsewhere', defaultStandard(-80.76, 35.2) === 'ncdot' && defaultStandard(-75.16, 39.95) === 'off');
  check('every standard names a kind that exists, for every class', Object.values(INLET_STANDARDS).every(s => ['cb', 'double', 'drop', 'curb', 'elong', 'slab'].every(c => INLET_KINDS[s.kinds[c]])));
}

// ---- kinds: the NCDOT values from the standard drawings, estimates marked
{
  const di = kindHydraulics('ncdotDI'), cb = kindHydraulics('ncdotCB');
  check('NCDOT drop inlet 840.16: 3.7 ft² and 8.6 ft', near(di.inletArea, 3.7 * 0.0929, 0.005) && near(di.inletPerim, 8.6 * 0.3048, 0.005) && di.Cw === 0.37 && di.Co === 0.67, JSON.stringify(di));
  check('NCDOT catch basin 840.03: 3.1 ft²', near(cb.inletArea, 3.1 * 0.0929, 0.005), JSON.stringify(cb));
  check('slab-top drop inlet: per open side', near(kindHydraulics('ncdotSlab', 3).inletArea, 3 * INLET_KINDS.ncdotSlab.v[0], 1e-9) && near(kindHydraulics('ncdotSlab', 3).inletPerim, 3 * INLET_KINDS.ncdotSlab.v[1], 1e-9));
  check('estimated values say so', ['ncdotCB', 'ncdotDCB', 'ncdotCI', 'ncdotElong', 'ncdotSlab'].every(k => INLET_KINDS[k].est && /estimated/i.test(INLET_KINDS[k].basis)) && !INLET_KINDS.ncdotDI.est);
  check('the generic kinds keep the values the Kind of inlet select had', JSON.stringify(INLET_KINDS.typical.v) === '[0.2,2,0.5,0.6]' && JSON.stringify(INLET_KINDS.curb.v) === '[0.2,1.5,0.28,0.67]');
  check('the typical kind is the model default', INLET_KINDS.typical.v.join() === [DESIGN_DEFAULTS.inletArea, DESIGN_DEFAULTS.inletPerim, DESIGN_DEFAULTS.Cw, DESIGN_DEFAULTS.Co].join());
}

// ---- types in a layer → kinds; picks over the standard
{
  const recs = [...Array(5)].map(() => ({ type: 'CB' })).concat([{ type: 'DI' }, { type: 'DI' }, { type: 'SlabDI 4' }, { type: 'Weird' }, {}]);
  const types = inletTypeCounts(recs);
  check('types counted, most common first, untyped as null', types[0].type === 'CB' && types[0].count === 5 && types.find(t => t.type === null)?.count === 1 && types.find(t => t.type === 'SlabDI 4').sides === 4);
  const k = typeKinds(types, 'ncdot');
  check('NCDOT: each recognised type its kind; unknown and untyped keep the values above', k.CB.kind === 'ncdotCB' && k.DI.kind === 'ncdotDI' && k['SlabDI 4'].kind === 'ncdotSlab' && k['SlabDI 4'].sides === 4 && !k.Weird && Object.keys(k).length === 3, JSON.stringify(k));
  const p = typeKinds(types, 'ncdot', { CB: 'area', Weird: 'small', DI: 'auto' });
  check('picks: values above, a kind for an unknown type, automatic', !p.CB && p.Weird.kind === 'small' && p.DI.kind === 'ncdotDI');
  check('no standard: only picks', Object.keys(typeKinds(types, 'none')).length === 0 && typeKinds(types, 'off', { DI: 'large' }).DI.kind === 'large');
  check('a pick of a kind that does not exist is ignored', !typeKinds(types, 'none', { DI: 'nonsense' }).DI);
  const a = applyInletKinds(recs, k);
  check('records get their own hydraulics; the others are the same objects', a[0].hyd.inletArea === kindHydraulics('ncdotCB').inletArea && a[8] === recs[8] && a[9] === recs[9] && !recs[0].hyd);
  check('no kinds: the same array', applyInletKinds(recs, {}) === recs);
}

// ---- the type field of a point layer, and the records keep it
{
  check('type field: Charlotte STRUCT_TYPE, Philadelphia inlettype, a plain Type, none', detectTypeField(['OBJECTID', 'FACILITYID', 'STRUCT_TYPE', 'Shape']) === 'STRUCT_TYPE' &&
    detectTypeField(['system', 'inlettype']) === 'inlettype' && detectTypeField(['ID', 'Type']) === 'Type' && detectTypeField(['ID', 'RIM']) === null);
  check('the more specific field wins over a plain Type', detectTypeField(['TYPE', 'STRUCTURE_TYPE']) === 'STRUCTURE_TYPE');
  const feats = [{ kind: 'point', coords: [1, 2], props: { STRUCT_TYPE: ' CB ' } }, { kind: 'point', coords: [3, 4], props: { STRUCT_TYPE: '' } }, { kind: 'line', coords: [], props: {} }];
  const r = pointRecords(feats, 'STRUCT_TYPE');
  check('point records keep a type, trimmed; a blank one is left out', r.length === 2 && r[0].type === 'CB' && !('type' in r[1]));
  check('without a type field: lon and lat only, as before', JSON.stringify(pointRecords(feats)) === JSON.stringify([{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }]));
}

// ---- grates of different kinds: one equivalent grate per exchange point
{
  const base = { ...DESIGN_DEFAULTS, clog: 0 }, di = kindHydraulics('ncdotDI'), cb = kindHydraulics('ncdotCB');
  check('no parts, or parts without hydraulics: the area setting itself', inletOptions(undefined, base) === base && inletOptions([[1, null], [1, null]], base) === base);
  const one = inletOptions([[1, di]], base);
  check('one grate of a kind: its values', one.inletArea === di.inletArea && one.inletPerim === di.inletPerim && one.Cw === di.Cw && one.Co === di.Co);
  // shallow water: every grate is weir-limited, so the merged point takes the sum of what each grate would
  const mix = inletOptions([[1, di], [1, cb], [1, null]], base), h = 0.02;
  const sum = inletFlow(h, 0, -5, 1, { ...base, ...di }) + inletFlow(h, 0, -5, 1, { ...base, ...cb }) + inletFlow(h, 0, -5, 1, base);
  check('three grates on one cell (two kinds and the area setting), weir flow: the sum of the three', near(inletFlow(h, 0, -5, 3, mix), sum, 1e-12), `${inletFlow(h, 0, -5, 3, mix).toFixed(6)} vs ${sum.toFixed(6)} m³/s`);
  const H = 1.5, sumO = [di, cb, null].reduce((s, x) => s + inletFlow(H, 0, -5, 1, x ? { ...base, ...x } : base), 0);
  check('deep water, orifice flow: the sum of the three', near(inletFlow(H, 0, -5, 3, mix), sumO, 1e-12));
  check('a half-blocked grate counts half', near(inletFlow(h, 0, -5, 1.5, inletOptions([[1, di], [0.5, cb]], base)), inletFlow(h, 0, -5, 1, { ...base, ...di }) + 0.5 * inletFlow(h, 0, -5, 1, { ...base, ...cb }), 1e-12));
  check('debris (clog) is kept from the area setting', inletOptions([[1, di]], { ...base, clog: 0.3 }).clog === 0.3);
}

// ---- through the network: real inlets with and without kinds
{
  const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
  const ll = (x, y) => fromUTM(486000 + x, 4422200 - y, 18);
  const z = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = 10 + 0.01 * i + 0.005 * (199 - j);
  const f = { z, bld: new Uint8Array(N), road: new Uint8Array(N), cls: null };
  const sim = { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) };
  const pipes = [{ line: [ll(20, 100), ll(100, 100)], D: 0.45 }, { line: [ll(100, 100), ll(180, 100)], D: 0.6 }];
  const inl = [{ ...Object.fromEntries([['lon', ll(40, 103)[0]], ['lat', ll(40, 103)[1]]]), type: 'DI' }, { lon: ll(140, 103)[0], lat: ll(140, 103)[1], type: 'CB' }];
  const plain = realNetwork(g, f, pipes, sim, { realInlets: inl.map(({ lon, lat }) => ({ lon, lat })) });
  const untyped = realNetwork(g, f, pipes, sim, { realInlets: inl });
  check('types but no kinds: the same exchange points as before (no parts)', plain && JSON.stringify(plain.inlets) === JSON.stringify(untyped.inlets) && plain.inlets.every(p => !p.parts), plain ? JSON.stringify(plain.inlets.map(p => p.grates)) : 'no network');
  const typed = realNetwork(g, f, pipes, sim, { realInlets: applyInletKinds(inl, typeKinds(inletTypeCounts(inl), 'ncdot')) });
  const withParts = typed.inlets.filter(p => p.parts);
  check('with kinds: each grate carries its own hydraulics to its exchange point', withParts.length === 2 && withParts.some(p => p.parts[0][1].inletPerim === kindHydraulics('ncdotDI').inletPerim) &&
    withParts.some(p => p.parts[0][1].inletArea === kindHydraulics('ncdotCB').inletArea), JSON.stringify(typed.inlets.map(p => p.parts ?? null)));
  check('the same cells and grate counts either way', JSON.stringify(typed.inlets.map(p => [p.cell, p.grates])) === JSON.stringify(plain.inlets.map(p => [p.cell, p.grates])));
  const roads = [{ line: [ll(-5, 100), ll(205, 100)], kind: 'residential', width: 8 }];
  const s0 = synthNetwork(g, f, { roads, waterways: [] }, null, sim, { realInlets: inl.map(({ lon, lat }) => ({ lon, lat, open: 0.5, crest: 0.05 })) });
  check('synthetic network with real grates: each keeps its open share and crest (were dropped before)', s0.inlets.filter(p => p.grates > 0).every(p => p.grates === 0.5 && p.crest === 0.05), JSON.stringify(s0.inlets.map(p => [p.grates, p.crest])));
  const s1 = synthNetwork(g, f, { roads, waterways: [] }, null, sim, { realInlets: applyInletKinds(inl, typeKinds(inletTypeCounts(inl), 'ncdot')) });
  check('synthetic network: grates carry their kind', s1.inlets.filter(p => p.parts).length === s1.inlets.filter(p => p.grates > 0).length && s1.inlets.some(p => p.parts));
}

// ---- the coupler takes each point's own grate
{
  const nodes = [{ name: 'J0', p: [4, 4], ground: 10, invert: 8, depth: 2, outfall: false }];
  const swmm = { index: (kind) => (kind === 'NODE' ? 0 : -1), setLatFlow() {}, setOutfallStage() {}, stepTo(t, cb) { for (let k = 0; k < 4; k++) cb(0.5); },
    node: (what) => (what === 'HEAD' ? 8 : 0), link: () => 0 };
  const di = kindHydraulics('ncdotDI'), h = new Float64Array(1).fill(0.03);
  const run = (inlet) => {
    const net = { nodes, pipes: [], inlets: [inlet], opts: { ...DESIGN_DEFAULTS, clog: 0 } };
    const cp = new Coupler({ rainRate: 0 }, net, swmm, new Float32Array(400).fill(10), { interval: 2, returns: [] });
    return cp.step(new Float64Array(cp.count), h, 2, 2)[0];
  };
  const qa = run({ node: 0, cell: 42, grates: 1 }), qb = run({ node: 0, cell: 42, grates: 1, parts: [[1, di]] });
  check('a point without parts: the area setting', near(qa, inletFlow(0.03, 10, 8, 1, DESIGN_DEFAULTS), 1e-7), qa.toFixed(6));
  check('a point with its kind: that grate (the NCDOT drop inlet, HEC-22 weir coefficient: a little less while shallow)', near(qb, inletFlow(0.03, 10, 8, 1, { ...DESIGN_DEFAULTS, ...di }), 1e-7) && qb < qa, `${qa.toFixed(5)} → ${qb.toFixed(5)} m³/s`);
}

// ---- a settings test names the types whose kind changed
{
  const ch = settingsChanges(null, { inletTypes: { CB: 'ncdotCB', DI: 'ncdotDI' } });
  check('settings test: one row per type whose kind changed', ch.length === 2 && ch[0].label === 'Kind of inlet for type CB' && ch[0].before === 'values above' && ch[0].after === 'ncdotCB', JSON.stringify(ch));
  check('the same kinds: no rows', settingsChanges({ inletTypes: { CB: 'ncdotCB' } }, { inletTypes: { CB: 'ncdotCB' } }).length === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
