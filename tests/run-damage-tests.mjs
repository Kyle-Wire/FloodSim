// Run damage and flooded-area tests (src/damage.js, src/areas.js): the USACE curves as tabulated (EGM 01-03 values),
// interpolation and fallbacks, water against a building's walls (a rowhouse sees its own frontage, not its neighbour's),
// damage totals and the band, EAD by trapezoids against a hand sum, present value against the annuity formula, NSI
// parsing; flooded areas split and described (area, volume, depth bands, timing, buildings and streets touched).
//   node tests/run-damage-tests.mjs [--live]   (--live: the NSI API for a block of South Philadelphia)
import * as D from '../src/damage.js';
import * as AR from '../src/areas.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

{ // curves
  const c = D.curveFor('RES1-1SNB'), w = D.curveFor('RES1-1SWB');
  check('curves: EGM 01-03 one story, no basement: 13.4 % at the first floor, 23.3 % at 1 ft', near(D.pctAt(c.structure, 0).mean, 13.4, 0.01) && near(D.pctAt(c.structure, 1).mean, 23.3, 0.01));
  check('curves: with a basement, damage starts below the first floor (25.5 % at 0 ft, > 0 at −4 ft)', near(D.pctAt(w.structure, 0).mean, 25.5, 0.01) && D.pctAt(w.structure, -4).mean > 0);
  check('curves: linear between feet, 0 below the table, held above it', near(D.pctAt(c.structure, 0.5).mean, (13.4 + 23.3) / 2, 0.01) && D.pctAt(c.structure, -3).mean === 0 && D.pctAt(c.structure, 40).mean === c.structure.mean.at(-1));
  const f1 = D.curveFor('COM4-xyz'), f2 = D.curveFor('RES3'), f3 = D.curveFor('???');
  check('curves: fallbacks (suffix dropped, family default, unknown → one-story home)', f1.key === 'COM4' && f2.key === 'RES3A' && f3.key === 'RES1-1SNB' && f3.fallback === true, `${f1.key}, ${f2.key}, ${f3.key}`);
}

// a 24 × 12 grid at 1 m: ground 10 m; two rowhouses side by side (cells 8–11 and 12–15, rows 4–7); water 0.5 m deep on the
// street west of the first house only (columns 0–7), dry elsewhere
const nx = 24, ny = 12, N = nx * ny, z = new Float32Array(N).fill(10), bld = new Uint8Array(N), maxDepth = new Float32Array(N), maxWse = new Float32Array(N).fill(NaN);
const box = (i0, i1, j0, j1) => [[[i0, j0], [i1, j0], [i1, j1], [i0, j1]]];
const fps = [box(8, 12, 4, 8), box(12, 16, 4, 8)];
for (let j = 4; j < 8; j++) for (let i = 8; i < 16; i++) bld[j * nx + i] = 1;
for (let j = 0; j < ny; j++) for (let i = 0; i < 8; i++) { const k = j * nx + i; maxDepth[k] = 0.5; maxWse[k] = 10.5; }
const g = { nx, ny, dx: 1, z, bld, maxWse, maxDepth }, fp = D.footprintIndex(fps, nx, ny);
const S = [{ id: 'a', occtype: 'RES1-1SNB', foundHt: 0.3, valStruct: 200000, valCont: 100000, peopleNight: 3, peopleDay: 1, damcat: 'RES', p: [10, 6] },
  { id: 'b', occtype: 'RES1-1SNB', foundHt: 0.3, valStruct: 200000, valCont: 100000, peopleNight: 2, peopleDay: 0, damcat: 'RES', p: [14, 6] }];
const ex = D.exposure(S, g, s => s.p, { fp });
{
  check('exposure: water against the first house: level 10.5, ground 10, 0.2 m above a 0.3 m floor', near(ex[0].level, 10.5, 1e-6) && near(ex[0].ground, 10, 1e-6) && near(ex[0].depthFF, 0.2, 1e-6) && ex[0].how === 'footprint');
  check('exposure: the rowhouse next door sees its own (dry) frontage, not its neighbour\'s', ex[1].depthFF === null && ex[1].wetCells === 0);
  const pt = D.exposure([{ foundHt: 0.3, p: [3, 3] }], g, s => s.p, { fp: null })[0];
  check('exposure: a point with no footprint uses the open cells around it', pt.how === 'point' && near(pt.depthFF, 0.2, 1e-6));
}
{
  const r = D.damages(S, ex), ft = 0.2 / 0.3048, c = D.curveFor('RES1-1SNB');
  const want = 200000 * D.pctAt(c.structure, ft).mean / 100 + 100000 * D.pctAt(c.contents, ft).mean / 100;
  check('damage: structure + contents at 0.66 ft above the floor', near(r.totals.total, want, 0.01) && r.totals.flooded === 1 && r.totals.aboveFloor === 1 && r.totals.people.night === 3, `$${r.totals.total.toFixed(0)}`);
  check('damage: the band brackets the mean', r.totals.low <= r.totals.total && r.totals.high >= r.totals.total && r.totals.byCat.RES.n === 2 && r.totals.byCat.RES.flooded === 1);
}
{ // sheet flow: 2 cm of rain on the pavement next to a house with a basement is not a flood of it
  const thin = new Float32Array(N), lvl = new Float32Array(N).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < 8; i++) { const k = j * nx + i; thin[k] = 0.02; lvl[k] = 10.02; }
  const B = [{ occtype: 'RES1-2SWB', foundHt: 0.6, valStruct: 2e5, valCont: 1e5, p: [10, 6] }];
  const e10 = D.exposure(B, { ...g, maxDepth: thin, maxWse: lvl }, s => s.p, { fp }), e0 = D.exposure(B, { ...g, maxDepth: thin, maxWse: lvl }, s => s.p, { fp, minDepth: 0.005 });
  check('exposure: 2 cm of sheet flow does not count (10 cm threshold); with the threshold at 5 mm the basement curve would book damage', e10[0].depthFF === null && D.damages(B, e10).totals.total === 0 && D.damages(B, e0).totals.total > 0);
}
{ // enclosed yards: a pond with no street and under 200 m² does not count against the house; one on the street does
  const nx = 20, ny = 20, N = nx * ny, md = new Float32Array(N), road = new Uint8Array(N), bl = new Uint8Array(N);
  for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) md[j * nx + i] = 0.3;                         // a 16 m² yard pond
  for (let i = 0; i < nx; i++) { md[15 * nx + i] = 0.2; road[15 * nx + i] = 1; }                        // a flooded street
  const o = D.openWater(md, { nx, ny, dx: 1, bld: bl, road });
  check('open water: the street counts, the enclosed yard pond does not (reported)', o.mask[15 * nx + 3] === 1 && o.mask[3 * nx + 3] === 0 && o.enclosed.patches === 1 && o.enclosed.cells === 16);
}
{ // EAD: by hand, frequent end at zero damage
  const e = D.ead([{ aep: 0.5, damage: 0 }, { aep: 0.1, damage: 100 }, { aep: 0.01, damage: 200 }]);
  check('EAD: trapezoids 20 + 13.5, tail 2 → 35.5', near(e.ead, 35.5, 1e-9) && near(e.parts.rare, 2, 1e-12) && e.parts.frequent === 0 && e.warnings.length === 0, JSON.stringify(e.parts));
  const e2 = D.ead([{ aep: 0.1, damage: 100 }, { aep: 0.5, damage: 50 }]);
  check('EAD: damage at the most frequent storm falls to zero at AEP 1 (and says so)', near(e2.parts.frequent, 0.5 * 50 * 0.5, 1e-9) && near(e2.parts.between, 0.5 * 150 * 0.4, 1e-9) && e2.warnings.some(w => /more frequent/.test(w)));
  check('EAD: one storm is not enough', Number.isNaN(D.ead([{ aep: 0.01, damage: 5 }]).ead));
}
{ // benefit–cost
  const pvf = D.pvFactor(0.03, 50), b = D.bca({ eadWithout: 100000, eadWith: 40000, rate: 0.03, years: 50, cost: 1e6, om: 5000 });
  check('BCA: present-value factor (1 − 1.03^−50) / 0.03 = 25.7298', near(pvf, 25.729764, 1e-5));
  check('BCA: benefits, costs, ratio', near(b.pvBenefits, 60000 * pvf, 1e-6) && near(b.pvCosts, 1e6 + 5000 * pvf, 1e-6) && near(b.bcr, b.pvBenefits / b.pvCosts, 1e-12), `BCR ${b.bcr.toFixed(3)}`);
}
{ // NSI parsing
  const fc = { features: [{ geometry: { type: 'Point', coordinates: [-75.1522, 39.9403] }, properties: { fd_id: 1, occtype: 'RES1-2SWB', st_damcat: 'RES', found_type: 'B', found_ht: 2, num_story: 2, val_struct: 283609.3, val_cont: 141804.7, pop2amu65: 2, pop2amo65: 1, pop2pmu65: 1, pop2pmo65: 0 } }] };
  const s = D.parseNSI(fc)[0];
  check('NSI: fields, foundation height in m, people by night', s.id === '1' && near(s.foundHt, 0.6096, 1e-9) && s.peopleNight === 3 && s.peopleDay === 1 && s.occtype === 'RES1-2SWB');
  check('NSI: query URL is a closed lon/lat ring', /bbox=-75\.153000,39\.940000,-75\.147000,39\.940000,.*-75\.153000,39\.940000&fmt=fc$/.test(D.nsiUrl([-75.153, 39.94, -75.147, 39.944])));
}

{ // flooded areas: a 30 × 20 grid with a big pool (west), a small pool (east) and a puddle under the size limit
  const nx = 30, ny = 20, N = nx * ny, md = new Float32Array(N), wse = new Float32Array(N).fill(NaN), tw = new Float32Array(N).fill(NaN), ta = new Float32Array(N), fd = new Float32Array(N), bl = new Uint8Array(N), road = new Uint8Array(N);
  const fill = (i0, i1, j0, j1, d, t) => { for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const k = j * nx + i; md[k] = d + 0.01 * (i - i0); wse[k] = 10 + md[k]; tw[k] = t + i; ta[k] = 600; fd[k] = d / 2; } };
  fill(1, 11, 2, 12, 0.4, 300); fill(18, 24, 5, 10, 0.2, 900); fill(27, 29, 1, 2, 0.5, 100); // 100, 30 and 2 cells
  for (let j = 12; j < 15; j++) for (let i = 3; i < 7; i++) bl[j * nx + i] = 1; // a building on the south side of the big pool
  const fpx = D.footprintIndex([[[[3, 12], [7, 12], [7, 15], [3, 15]]]], nx, ny);
  const R = AR.floodedAreas({ nx, ny, dx: 1, maxDepth: md, maxWse: wse, tWet: tw, tAbove15: ta, finalDepth: fd, bld: bl, road }, { minArea: 10, fp: fpx, roads: [{ name: 'Main St', kind: 'residential', line: [[0, 7.5], [30, 7.5]] }] });
  const [a, b] = R.areas;
  check('areas: two areas over the size limit, largest volume first, named', R.areas.length === 2 && a.name === 'A1' && a.cells === 100 && b.cells === 30);
  check('areas: volume, max and mean depth', near(a.volume, 100 * 0.4 + 10 * 0.01 * 45, 1e-4) && near(a.maxDepth, 0.49, 1e-6) && near(a.meanDepth, a.volume / 100, 1e-9));
  check('areas: arrival, duration, what is left at the end', near(a.arrival, 301, 1e-6) && a.durationMax === 600 && near(a.drained, 1 - 20 / 44.5, 1e-4) && a.bands[1] === 100, `drained ${(100 * a.drained).toFixed(0)} %`);
  check('areas: the building next to the big pool, none at the small one', a.buildings === 1 && b.buildings === 0);
  check('areas: Main St runs 10 m through A1 and 6 m through A2; deep (≥ 30 cm) only in A1', near(a.streetLength, 10, 1e-6) && near(b.streetLength, 6, 1e-6) && a.streets[0].name === 'Main St' && near(a.streetDeep, 10, 1e-6) && b.streetDeep === 0);
  const own = AR.areaOfPoints([{ p: [5, 13] }, { p: [20, 7] }, { p: [15, 18] }], s => s.p, R.label, nx, ny, 2);
  check('areas: points belong to the area they touch', own[0] === 0 && own[1] === 1 && own[2] === -1, JSON.stringify(own));
  const svg = AR.areasSvg(R, { nx, ny, bld: bl }, { colors: ['#2a78d6', '#d0782a'], title: 'Peak depth ≥ 15 cm' });
  check('areas: SVG map with one path per area and labels', svg.startsWith('<svg') && (svg.match(/<path /g) ?? []).length === 3 && svg.includes('>A1<') && svg.includes('>A2<'));
}

if (process.argv.includes('--live')) {
  const r = await fetch(D.nsiUrl([-75.1530, 39.9400, -75.1470, 39.9440]), { headers: { 'user-agent': 'FloodSim tests' } });
  const S = D.parseNSI(await r.json()), cats = [...new Set(S.map(s => s.damcat))];
  check('live NSI: structures in a South Philadelphia block, values and foundation heights', S.length > 100 && S.every(s => s.valStruct > 0 && s.foundHt != null), `${S.length} structures, ${cats.join('/')}, ${S.filter(s => D.curveFor(s.occtype).fallback).length} on fallback curves`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall damage tests passed');
process.exit(fails ? 1 : 0);
