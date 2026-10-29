// Comparison tests (docs/specs/site-design-mode.md, phase 2): the forcing fingerprint (stable, names what differs,
// ignores the design), the .f32 grids, Δ maps with the no-change band, newly wet / dry, the off-site impact, the
// building and outlet tables, control-line faces and their signs, and the CSV / summary writers.
// Usage: node tests/run-compare-tests.mjs
import * as C from '../src/compare.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// ---- fingerprint
{
  const base = { storm: { pattern: 'block', ari: 100, depth: [1, 2, 3] }, inflow: [], tide: null, startLevels: { mode: 'dry' }, antecedent: { wetness: 'normal', wt: null },
    grid: { dx: '1' }, solver: { hdry: 1e-5 }, runLength: 5400, options: { sed: false }, drainage: { src: 'network' }, area: [1, 2, 3, 4], commit: 'abc' };
  const a = C.fingerprint(base), b = C.fingerprint(JSON.parse(JSON.stringify({ ...base, storm: { depth: [1, 2, 3], ari: 100, pattern: 'block' } })));
  check('fingerprint: key order does not matter, same forcing → same hash', a.hash === b.hash && C.fingerprintDiff(a, b).length === 0);
  const c = C.fingerprint({ ...base, storm: { ...base.storm, ari: 10 }, grid: { dx: '4s' } });
  const d = C.fingerprintDiff(a, c);
  check('fingerprint: a different storm and grid are named', a.hash !== c.hash && d.length === 2 && /storm/.test(d[0]) && /grid size/.test(d[1]), d.join(' | '));
  const r = C.comparable({ forcing: a }, { forcing: c });
  check('comparable refuses and names the difference', !r.ok && /storm/.test(r.reason) && /grid/.test(r.reason));
  check('a design is not part of the forcing', C.fingerprint({ ...base, design: { features: [1] } }).hash === a.hash);
  check('NaN and null hash differently; typed arrays hash as arrays', C.hashOf(NaN) !== C.hashOf(null) && C.hashOf(new Float32Array([1, 2])) === C.hashOf([1, 2]));
  check('runs saved without a fingerprint are refused', !C.comparable({ forcing: null }, { forcing: a }).ok);
}

// ---- .f32 grids
{
  const geo = { nx: 3, ny: 2, x0: 500000, y0: 4400000, dx: 1 }, a = Float32Array.from([1.5, NaN, -2, 0, 1e-7, 3.25]);
  const bytes = C.encodeF32(a), back = C.decodeF32(bytes), h = C.parseHeader(C.gridHeader(geo));
  check('.f32 round trip (NaN as NODATA)', bytes.length === 24 && back.every((v, k) => Object.is(v, a[k]) || (Number.isNaN(v) && Number.isNaN(a[k]))));
  check('.hdr round trip', h.nx === 3 && h.ny === 2 && h.x0 === 500000 && h.y0 === 4400000 && h.dx === 1 && h.nodata === C.NODATA);
  check('ASCII grid for export', C.toASC(a, geo, 2).split('\n')[6] === '1.5 -9999 -2');
}

// ---- Δ maps
{
  const a = Float32Array.from([1.000, 1.000, 1.000, NaN, 2, 5]), b = Float32Array.from([1.002, 1.010, 0.990, 3, NaN, 5]);
  const { delta, stats } = C.diffGrid(a, b, { band: 0.003 });
  check('Δ under the 3 mm band is no change', delta[0] === 0 && Math.abs(delta[1] - 0.01) < 1e-6 && Math.abs(delta[2] + 0.01) < 1e-6 && delta[5] === 0);
  check('Δ where only one run has a value is NaN, and counted', Number.isNaN(delta[3]) && Number.isNaN(delta[4]) && stats.onlyB === 1 && stats.onlyA === 1);
  check('Δ stats: rises, falls, no change, largest rise', stats.rise === 1 && stats.fall === 1 && stats.same === 2 && Math.abs(stats.maxRise - 0.01) < 1e-6 && stats.kMaxRise === 1);
  const same = C.diffGrid(a, a);
  check('identical grids: Δ = 0 everywhere', same.stats.rise === 0 && same.stats.fall === 0 && same.stats.onlyA === 0);
  const wd = C.newlyWetDry(Float32Array.from([0, 0.2, 0.3, 0.1]), Float32Array.from([0.2, 0.1, 0.3, 0.12]), 0.15);
  check('newly wet and newly dry at 15 cm', wd.wet === 1 && wd.dry === 1 && wd.map[0] === 1 && wd.map[1] === -1 && wd.map[2] === 0);
}

// ---- off-site impact and buildings (a 10 × 10 grid; the site is the left half)
{
  const nx = 10, ny = 10, N = nx * ny, site = C.polygonMask([[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]], nx, ny);
  check('site mask from a polygon', site.reduce((s, v) => s + v, 0) === 50 && site[0] === 1 && site[9] === 0);
  const wseA = new Float32Array(N).fill(10), wseB = new Float32Array(N).fill(10);
  for (let j = 0; j < ny; j++) { wseB[j * nx + 2] = 10.5; wseB[j * nx + 7] = 10.02; wseB[j * nx + 8] = 10.001; } // on-site rise, off-site 2 cm, off-site 1 mm
  const { delta } = C.diffGrid(wseA, wseB, { band: 0.003 });
  const bld = new Uint8Array(N); bld[4 * nx + 8] = bld[4 * nx + 9] = bld[5 * nx + 8] = bld[5 * nx + 9] = 1; // an existing building off-site
  const z = new Float32Array(N).fill(9); z[3 * nx + 7] = 9.4;
  const ex = C.existingBuildings(bld, z, nx, ny, C.dilate(site, nx, ny, 4));
  check('existing building near the site: ring and FFE = HAG + 0.15 (estimated)', ex.length === 1 && ex[0].cells.length === 4 && ex[0].ring.length === 8 && Math.abs(ex[0].ffe - 9.55) < 1e-6 && ex[0].estimated, `${ex.length} buildings, ring ${ex[0]?.ring.length}`);
  check('a building far from the site is left out', C.existingBuildings(bld, z, nx, ny, C.dilate(site, nx, ny, 1)).length === 0);
  const imp = C.adverseImpact(delta, site, 1, { buildings: ex });
  check('off-site impact: only off-site rises over the band count', imp.cells === 10 && Math.abs(imp.maxRise - 0.02) < 1e-5 && imp.area === 10 && imp.affected.length === 1 && Math.abs(imp.affected[0].rise - 0.02) < 1e-5, JSON.stringify({ cells: imp.cells, maxRise: imp.maxRise, affected: imp.affected.length }));
  const none = C.adverseImpact(C.diffGrid(wseA, wseA).delta, site, 1, { buildings: ex });
  check('no change → no impact', none.cells === 0 && none.affected.length === 0);
  const wA = Float32Array.from(wseA), wB = Float32Array.from(wseB); for (const k of ex[0].ring) { wA[k] = 9.5; wB[k] = 9.6; }
  const newB = { id: 7, name: 'House', isNew: true, ffe: 10.2, ring: [2 * nx + 1, 2 * nx + 2] };
  const t = C.buildingTable([...ex, newB], wA, wB);
  check('building table: existing flooded after only, estimated FFE', t[0].kind === 'existing' && t[0].estimated && t[0].floodedBefore === false && t[0].floodedAfter === true && Math.abs(t[0].dWse - 0.1) < 1e-5);
  check('building table: a new building has no "before" flooding, its after against its FFE', t[1].kind === 'new' && t[1].floodedBefore === null && t[1].floodedAfter === true && t[1].wseAfter === Math.fround(10.5));
  const csv = C.toCSV(t, C.BUILDING_COLS);
  check('building CSV', csv.split('\n')[0].startsWith('building,name,new_or_existing,ffe_m') && csv.split('\n')[2].startsWith('7,House,new,10.2'));
}

// ---- control lines
{
  const nx = 20, ny = 12;
  const open = C.lineFaces([[[10, -1], [10, 13]]], nx, ny); // straight down the middle, drawn southward
  check('a line across the grid: one face per row, inner rows only', open.faces.length === ny && open.faces.every(f => f.axis === 0 && f.i === 10));
  check('drawn southward, eastward flow crosses to the left (sign −1)', open.faces.every(f => f.sign === -1));
  const rev = C.lineFaces([[[10, 13], [10, -1]]], nx, ny);
  check('drawn northward, eastward flow crosses to the right (sign +1)', rev.faces.every(f => f.sign === 1));
  const ring = (cw) => { const r = [[2, 2], [18, 2], [18, 10], [2, 10], [2, 2]]; return cw ? r : r.reverse(); };
  for (const cw of [true, false]) {
    const { faces } = C.lineFaces([ring(cw)], nx, ny);
    const out = faces.every(f => (f.axis === 0 ? (f.i === 18 ? f.sign === 1 : f.sign === -1) : (f.j === 10 ? f.sign === 1 : f.sign === -1)));
    check(`a closed line (${cw ? 'clockwise' : 'counter-clockwise'}) is turned so + is outward`, out && faces.length === 2 * 16 + 2 * 8, `${faces.length} faces`);
  }
  const series = [[0, 0], [10, 5], [20, 25], [30, 30]], st = C.lineStats({ volume: 30, series });
  check('hydrograph from cumulative volume: peak 2 m³/s at 20 s', Math.abs(st.peak - 2) < 1e-12 && st.tPeak === 20 && st.volume === 30);
  // a closed line with water through it: 3 m³/s out and 1 m³/s in at the peak; the outlet peak is the outflow
  const g = C.lineStats({ volume: 20, series: [[0, 0, 0, 0], [10, 10, 15, 5], [20, 20, 45, 25], [30, 20, 50, 30]] });
  check('a line with flow both ways: peak = the gross flow to the + side, peak back to the − side', Math.abs(g.peak - 3) < 1e-12 && g.tPeak === 20 && Math.abs(g.peakBack - 2) < 1e-12);
  const tab = C.outletTable([{ id: 1, name: 'Outlet', volume: 30, series }], [{ id: 1, name: 'Outlet', volume: 20, series: [[0, 0], [10, 4], [20, 12], [30, 20]] }, { id: 2, name: 'New', volume: 1, series: [] }]);
  check('outlet table: pre vs post per line, a line only in one run marked', tab.length === 2 && Math.abs(tab[0].dPeak + 1.2) < 1e-12 && tab[0].dVol === -10 && tab[1].inA === false && Number.isNaN(tab[1].dVol));
  check('outlet CSV', C.toCSV(tab, C.OUTLET_COLS).split('\n')[1].startsWith('1,Outlet,2,0.8,-1.2,30,20,-10,20,20'));
}

// ---- summary page
{
  const run = (label) => ({ label, forcing: { hash: 'f00dcafe' }, commit: 'abc123', saved: '2026-10-29', storm: '100-yr 1 h', designHash: 'd1' });
  const html = C.summaryHTML({ a: run('Existing conditions'), b: run('Proposed'), band: 0.003, site: true, impact: { cells: 3, area: 3, maxRise: 0.02, newlyWet: 1, newlyWetArea: 1, affected: [{ id: 'e0', rise: 0.02 }] },
    maps: [{ title: 'Max depth', stats: { rise: 3, fall: 1, maxRise: 0.02, maxFall: -0.01 }, scale: 1000, dp: 0, unit: ' mm' }], wetDry: { wet: 1, dry: 0 }, totals: { 'Δ runoff volume': '+12 m³' }, buildings: [], outlets: [] });
  check('one-page summary names both runs, the fingerprint and the impact', /Proposed vs Existing conditions/.test(html) && /f00dcafe/.test(html) && /\+20 mm/.test(html) && /3 mm/.test(html));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll comparison tests passed');
process.exit(fails ? 1 : 0);
