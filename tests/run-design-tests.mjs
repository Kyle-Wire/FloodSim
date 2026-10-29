// Site design mode tests (docs/specs/site-design-mode.md, phase 1): the distance transform, the grading engine (a pad on
// a tilted plane is flat, daylights at exactly 3:1 and 2:1, and its cut and fill match the analytic frustum volumes),
// the apron, the FFE rules (HAG, BFE, balanced), demolish, the layer updates, floodplain fill, the baseline left
// untouched (no features → identical grids and solver inputs), and roof routing per building id.
// Usage: node tests/run-design-tests.mjs
import { buildFine, coarsen, roofRouting, roofConnections } from '../src/terrain.js';
import { hsgParams, URBAN_FILL } from '../src/soil.js';
import { NOT_ERODIBLE, TAU_GRASS } from '../src/scour.js';
import { applyDesign, designFeature, edt, hashFine, floodedBuildings, resolvedValues, PRESETS } from '../src/design.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** A fine model on an n × n grid of 1 m cells with ground z(i, j) (cell centres), loam (group B) under lawn. */
function model(n, zf, { cls = 22, hsg = 2 } = {}) {
  const dem = { z: new Float32Array(n * n) };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) dem.z[j * n + i] = zf(i + 0.5, j + 0.5);
  const f = buildFine({ nx: n, ny: n, dx: 1 }, dem, { buildings: [], roads: [] }, new Uint8Array(n * n).fill(cls), []);
  const p = hsgParams('ABCD'[hsg - 1]);
  f.hsg.fill(hsg); f.ga.K.fill(p.K); f.ga.psi.fill(p.psi); f.ga.thetaE.fill(p.thetaE); f.ga.depth.fill(2); f.bedrock.fill(3);
  return f;
}
const square = (x0, y0, a) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x0 + a, y0], [x0 + a, y0 + a], [x0, y0 + a], [x0, y0]]] });
const fc = (...features) => ({ type: 'FeatureCollection', features });
/** Every typed array of a fine model, copied (to check the baseline is never written). */
function snapshot(f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) if (ArrayBuffer.isView(v)) out[k] = v.slice();
  for (const [k, v] of Object.entries(f.ga)) if (ArrayBuffer.isView(v)) out['ga.' + k] = v.slice();
  return out;
}
const sameAs = (f, snap) => Object.entries(snap).every(([k, v]) => { const a = k.startsWith('ga.') ? f.ga[k.slice(3)] : f[k]; return a.length === v.length && a.every((x, i) => Object.is(x, v[i])); });

// ---- the distance transform is exact (against brute force), with the nearest point
{
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let bad = 0;
  for (let t = 0; t < 20; t++) {
    const w = 5 + Math.floor(rnd() * 40), h = 5 + Math.floor(rnd() * 40), s = new Uint8Array(w * h), pts = [];
    for (let k = 0; k < w * h; k++) if (rnd() < 0.02 + 0.1 * rnd()) { s[k] = 1; pts.push(k); }
    const e = edt(s, w, h);
    for (let k = 0; k < w * h; k++) {
      let best = Infinity; for (const q of pts) best = Math.min(best, (k % w - q % w) ** 2 + (((k / w) | 0) - ((q / w) | 0)) ** 2);
      const q = e.near[k], dq = q < 0 ? Infinity : (k % w - q % w) ** 2 + (((k / w) | 0) - ((q / w) | 0)) ** 2;
      if (e.d2[k] !== best || (pts.length && (!s[q] || dq !== best))) bad++;
    }
  }
  check('distance transform: exact squared distances and a nearest feature cell (20 random grids)', bad === 0, `${bad} cells wrong`);
}

// ---- a pad on a tilted plane
{
  const n = 120, g = 0.05, f = model(n, (x) => 100 + g * x), snap = snapshot(f);
  const a = 20, x0 = 50, P = 100 + g * (x0 + a / 2); // pad at the plane's level at its centre: cut on the high side, fill on the low
  const { fine, log } = applyDesign(f, fc(designFeature('grade', square(x0, x0, a), { mode: 'flat', elev: P }, 1)));
  const zp = fine.z, at = (i, j) => zp[j * n + i];
  let flat = 0; for (let j = x0; j < x0 + a; j++) for (let i = x0; i < x0 + a; i++) flat = Math.max(flat, Math.abs(at(i, j) - P));
  check('pad on a tilted plane: flat at its elevation', flat < 1e-4, `max |z − P| ${flat.toExponential(1)} m`);
  // along the centre row of a raised pad the ground falls 1 in 3 from the edge on both sides; of a sunken pad it rises 1 in 2
  const j = x0 + a / 2, fillD = [], cutD = [];
  const hi = applyDesign(f, fc(designFeature('grade', square(x0, x0, a), { elev: P + 1.5 }, 1))).fine.z, lo = applyDesign(f, fc(designFeature('grade', square(x0, x0, a), { elev: P - 2 }, 1))).fine.z;
  const daylit = (zz, i) => zz[j * n + i] !== f.z[j * n + i];
  for (let i = x0 - 2; i > 0; i--) if (daylit(hi, i)) fillD.push(hi[j * n + i + 1] - hi[j * n + i]);
  for (let i = x0 + a + 1; i < n; i++) if (daylit(hi, i)) fillD.push(hi[j * n + i - 1] - hi[j * n + i]);
  for (let i = x0 - 2; i > 0; i--) if (daylit(lo, i)) cutD.push(lo[j * n + i] - lo[j * n + i + 1]);
  for (let i = x0 + a + 1; i < n; i++) if (daylit(lo, i)) cutD.push(lo[j * n + i] - lo[j * n + i - 1]);
  const fillOk = fillD.length >= 6 && fillD.every(d => near(d, 1 / 3, 2e-4)), cutOk = cutD.length >= 6 && cutD.every(d => near(d, 1 / 2, 2e-4));
  check('daylight fill slope is exactly 3:1', fillOk, `${fillD.length} steps of ${[...new Set(fillD.map(d => d.toFixed(4)))].join(', ')} m`);
  check('daylight cut slope is exactly 2:1', cutOk, `${cutD.length} steps of ${[...new Set(cutD.map(d => d.toFixed(4)))].join(', ')} m`);
  // the edge of the pad: first daylight cell centre is ½ m out, so 1/6 m (fill) and 1/4 m (cut) from the pad level
  check('daylight starts at the pad edge', near(P - at(x0 - 1, j), 0.5 / 3, 2e-4) && near(at(x0 + a, j) - P, 0.5 / 2, 2e-4));
  // cut and fill against the continuous geometry (the square, distance to its edge), integrated at 10 × 10 points per cell
  let cut = 0, fill = 0;
  for (let j2 = 0; j2 < n * 10; j2++) for (let i2 = 0; i2 < n * 10; i2++) {
    const x = (i2 + 0.5) / 10, y = (j2 + 0.5) / 10, zg = 100 + g * x;
    const dx = Math.max(x0 - x, 0, x - x0 - a), dy = Math.max(x0 - y, 0, y - x0 - a), d = Math.hypot(dx, dy);
    const zn = d === 0 ? P : Math.min(Math.max(zg, P - d / 3), P + d / 2);
    if (zn > zg) fill += (zn - zg) / 100; else cut += (zg - zn) / 100;
  }
  const L = log.features[0];
  check('cut and fill match the continuous grading within 2 %', near(L.cut, cut, 0.02 * cut) && near(L.fill, fill, 0.02 * fill),
    `cut ${L.cut.toFixed(2)} vs ${cut.toFixed(2)} m³, fill ${L.fill.toFixed(2)} vs ${fill.toFixed(2)} m³`);
  check('totals equal the feature (one feature)', near(log.totals.cut, L.cut, 1e-6) && near(log.totals.fill, L.fill, 1e-6));
  check('applyDesign leaves every baseline array unchanged', sameAs(f, snap));
}

// ---- analytic frustum volumes on flat ground: V = a²h + 2a·s·h² + π s² h³ / 3
{
  const n = 80, f = model(n, () => 50), a = 20, h = 1, x0 = 30;
  const frust = (s) => a * a * h + 2 * a * s * h * h + Math.PI * s * s * h ** 3 / 3;
  const up = applyDesign(f, fc(designFeature('grade', square(x0, x0, a), { elev: 50 + h }, 1))).log.features[0];
  const dn = applyDesign(f, fc(designFeature('grade', square(x0, x0, a), { elev: 50 - h }, 1))).log.features[0];
  check('fill pad on flat ground: frustum volume (3:1)', near(up.fill, frust(3), 0.01 * frust(3)) && up.cut === 0, `${up.fill.toFixed(2)} vs ${frust(3).toFixed(2)} m³`);
  check('cut pad on flat ground: frustum volume (2:1)', near(dn.cut, frust(2), 0.01 * frust(2)) && dn.fill === 0, `${dn.cut.toFixed(2)} vs ${frust(2).toFixed(2)} m³`);
}

// ---- the apron falls 0.15 m in 3 m (single-family preset)
{
  const n = 60, f = model(n, () => 20), { fine, log } = applyDesign(f, fc(designFeature('building', square(20, 20, 10), { preset: 'sfr' }, 7)));
  const r = log.features[0].resolved, zp = fine.z, j = 25, at = (i) => zp[j * n + i];
  check('single-family on flat ground: FFE = HAG + 0.15 m, finished grade at the foundation = HAG', near(r.ffe, 20.15, 1e-5) && near(r.pad, 20, 1e-5) && r.governs === 'HAG + reveal');
  const a0 = at(19), a1 = at(18), a2 = at(17); // apron cells ½, 1½, 2½ m out
  check('apron falls 0.15 m in 3 m (0.05 m per m from the foundation)', near(r.pad - a0, 0.025, 1e-4) && near(a0 - a1, 0.05, 1e-4) && near(a1 - a2, 0.05, 1e-4) && near(r.pad - (a2 - 0.025), 0.15, 1e-4),
    `${(r.pad - a0).toFixed(3)} ${(r.pad - a1).toFixed(3)} ${(r.pad - a2).toFixed(3)} m below the pad`);
  check('beyond the apron the ground is untouched (cut back up at 2:1 within half a metre)', at(16) === 20 && at(14) === 20);
  const comm = applyDesign(f, fc(designFeature('building', square(20, 20, 10), { preset: 'commercial' }, 8)));
  const zc = comm.fine.z;
  check('commercial apron: 1.5 m at 2 %', near(20 - zc[j * n + 19], 0.01, 1e-4) && near(zc[j * n + 19] - zc[j * n + 18], 0.02, 1e-4) && zc[j * n + 17] === 20);
  // paved sides fall at 2 %
  const fr = model(n, () => 20); for (let k = 0; k < n * n; k++) if (k % n < 20) fr.road[k] = 1;
  const pv = applyDesign(fr, fc(designFeature('building', square(20, 20, 10), { preset: 'sfr' }, 9))).fine.z;
  check('apron on a paved side falls at 2 %', near(20 - pv[j * n + 19], 0.01, 1e-4) && near(pv[j * n + 19] - pv[j * n + 18], 0.02, 1e-4));
}

// ---- FFE rules: HAG, BFE + freeboard, balanced cut and fill
{
  const n = 80, f = model(n, (x, y) => 10 + 0.04 * x + 0.02 * y);
  const hag = applyDesign(f, fc(designFeature('building', square(30, 30, 12), { preset: 'sfr' }, 1))).log.features[0].resolved;
  // ring around the footprint: highest at (42.5, 42.5)
  check('FFE (auto), HAG case: highest grade on the ring + 0.15 m', near(hag.hag, 10 + 0.04 * 42.5 + 0.02 * 42.5, 1e-4) && near(hag.ffe, hag.hag + 0.15, 1e-5), `HAG ${hag.hag.toFixed(3)}, FFE ${hag.ffe.toFixed(3)}`);
  const bfe = applyDesign(f, fc(designFeature('building', square(30, 30, 12), { preset: 'sfr' }, 1)), {}).log.features[0].resolved;
  const withBfe = applyDesign(f, { features: [designFeature('building', square(30, 30, 12), { preset: 'sfr' }, 1)], settings: { bfe: 14 } }).log.features[0].resolved;
  check('FFE (auto), BFE case: BFE + 1 ft freeboard governs', near(withBfe.ffe, 14.3, 1e-6) && withBfe.governs === 'BFE + freeboard' && bfe.governs === 'HAG + reveal');
  const fixedLow = applyDesign(f, fc(designFeature('building', square(30, 30, 12), { preset: 'sfr', ffeMode: 'fixed', ffe: 11 }, 1))).log.features[0];
  check('a fixed FFE below the minimum is used and warned about', fixedLow.resolved.ffe === 11 && fixedLow.warnings.some(w => /below the minimum/.test(w)));
  // balanced: a building over a mound inside its footprint (the ring is low, the middle high), so cut exceeds fill at the minimum
  const k = model(n, (x, y) => 10 + 6 * Math.max(0, 1 - Math.hypot(x - 40, y - 40) / 8));
  const bal = applyDesign(k, fc(designFeature('building', square(30, 30, 20), { preset: 'sfr', ffeMode: 'balance' }, 1))).log.features[0];
  check('FFE balanced case: above the minimum, |cut − fill| ≈ 0', bal.resolved.ffe > bal.resolved.ffeMin + 0.1 && Math.abs(bal.cut - bal.fill) < 0.002 * bal.cut,
    `FFE ${bal.resolved.ffe.toFixed(3)} (min ${bal.resolved.ffeMin.toFixed(3)}), cut ${bal.cut.toFixed(1)} fill ${bal.fill.toFixed(1)} m³`);
  const balLow = applyDesign(f, fc(designFeature('building', square(30, 30, 12), { preset: 'sfr', ffeMode: 'balance' }, 1))).log.features[0].resolved;
  check('FFE balanced on a plane: fill already exceeds cut at the minimum, so the minimum', near(balLow.ffe, hag.ffe, 1e-6));
  const gb = applyDesign(f, fc(designFeature('grade', square(30, 30, 12), { mode: 'balance' }, 1))).log.features[0];
  check('balanced pad (grade, no FFE): cut = fill, near the plane at the centre', Math.abs(gb.cut - gb.fill) < 0.002 * gb.cut && near(gb.resolved.elev, 10 + 0.06 * 36, 0.05), `elev ${gb.resolved.elev.toFixed(3)}`);
  const tc = applyDesign(f, fc(designFeature('building', square(30, 30, 12), { preset: 'warehouse', truckCourt: 13 }, 1))).log.features[0].resolved;
  check('warehouse: FFE at least truck court + 1.2 m', near(tc.ffe, 14.2, 1e-6));
}

// ---- demolish clears bld and leaves z
{
  const n = 40, f = model(n, (x) => 5 + 0.01 * x);
  for (let j = 10; j < 20; j++) for (let i = 10; i < 20; i++) { const k = j * n + i; f.bld[k] = 1; f.bldH[k] = 8; f.perv[k] = 0; }
  const snap = snapshot(f), { fine, log } = applyDesign(f, fc(designFeature('demolish', square(9, 9, 12), {}, 3)));
  let left = 0, moved = 0; for (let k = 0; k < n * n; k++) { if (fine.bld[k]) left++; if (fine.z[k] !== f.z[k]) moved++; }
  check('demolish clears bld and leaves z', left === 0 && moved === 0 && log.features[0].cells === 100);
  check('demolish: removed footprint is pervious lawn, impervious area removed', fine.perv[15 * n + 15] > 0.85 && near(log.totals.impRemoved, 90, 1e-3) && sameAs(f, snap));
}

// ---- layer updates: impervious footprint, HSG shift on graded lawn, collapse flag to the log
{
  const n = 60, f = model(n, (x) => 30 + 0.03 * x);
  for (let k = 0; k < n * n; k++) { f.collapse[k] = 2; f.swell[k] = 0; }
  const { fine, log } = applyDesign(f, fc(designFeature('building', square(20, 20, 10), { preset: 'sfr', height: 8 }, 42)));
  const k = 25 * n + 25;
  check('footprint: building wall, impervious, no infiltration, cls 24, not erodible, own id',
    fine.bld[k] === 1 && fine.bldH[k] === 8 && fine.perv[k] === 0 && fine.infil[k] === 0 && fine.ga.K[k] === 0 && fine.cls[k] === 24 && fine.tauC[k] === NOT_ERODIBLE && fine.bldId[k] === 42 && fine.collapse[k] === 0);
  let lawn = null; for (let q = 0; q < n * n; q++) if (!fine.bld[q] && fine.z[q] < f.z[q] - 0.01) { lawn = q; break; }
  const C = hsgParams('C');
  check('graded lawn (cut): hydrologic group B → C, Green-Ampt of group C, lawn n, erodible',
    lawn != null && fine.hsg[lawn] === 3 && fine.ga.K[lawn] === Math.fround(C.K) && near(fine.ga.psi[lawn], C.psi, 1e-6) && fine.cls[lawn] === 21 && fine.tauC[lawn] === TAU_GRASS && fine.texture[lawn] === f.texture[lawn]);
  let fillCell = null; for (let q = 0; q < n * n; q++) if (!fine.bld[q] && fine.z[q] > f.z[q] + 0.01) { fillCell = q; break; }
  check('placed fill takes the compacted-fill rate', fillCell != null && fine.ga.K[fillCell] === Math.fround(URBAN_FILL.K) && fine.hsg[fillCell] === 3);
  check('collapsible soil under the building is carried to the log', log.features[0].warnings.some(w => /collapsible/.test(w)));
  check('impervious added = footprint (lawn at 10 % impervious replaced by the building) less lawn regained', log.totals.impAdded > 0.64 * 100 && log.features[0].impAdded > 0);
  check('only the changed layers are copied', fine.grains === f.grains && fine.texture === f.texture && fine.soilUnit === f.soilUnit && fine.bld !== f.bld);
  check('ground depth follows the grading', fine.ga.depth[fillCell] > 2 && fine.bedrock[fillCell] > 3);
  check('the resolved values hold the preset and FFE', resolvedValues(fc(designFeature('building', square(20, 20, 10), { preset: 'sfr' }, 42)), log).features[42].ffe === log.features[0].resolved.ffe);
}

// ---- paved areas
{
  const n = 40, f = model(n, () => 3);
  const { fine, log } = applyDesign(f, fc(designFeature('paved', square(5, 5, 10), { use: 'parking', surface: 'concrete', curb: 0.15 }, 1), designFeature('paved', square(20, 5, 10), { use: 'driveway' }, 2)));
  const a = 10 * n + 10, b = 10 * n + 25;
  check('paved: road, impervious, no infiltration, concrete n 0.013 / asphalt 0.014', fine.road[a] === 1 && fine.perv[a] === 0 && fine.infil[a] === 0 && near(fine.manning[a], 0.013, 1e-7) && near(fine.manning[b], 0.014, 1e-7));
  check('paved: the curb burns the parking below its surroundings', near(fine.z[a], 2.85, 1e-5) && fine.z[b] === 3 && near(log.features[0].resolved.area, 100, 1e-9));
  const t = applyDesign(f, fc(designFeature('paved', square(5, 5, 10), { elev: 3.5, crossSlope: 0.02, slopeDir: 90 }, 1))).fine.z;
  check('paved: target elevation with a 2 % cross slope falling east', near(t[10 * n + 6] - t[10 * n + 7], 0.02, 1e-5) && near((t[10 * n + 9] + t[10 * n + 10]) / 2, 3.5, 1e-5));
}

// ---- floodplain fill: a pad in a flat pond of known level gives fill = footprint × depth
{
  const n = 50, f = model(n, () => 2, { cls: 11 }), level = 2.8, wse = new Float32Array(n * n).fill(level);
  const d = fc(designFeature('grade', square(20, 20, 8), { elev: 3.5, fillSlope: 0 }, 1));
  const { log } = applyDesign(f, d, { wse });
  check('floodplain fill = footprint × depth (pad in a pond, vertical sides)', near(log.totals.floodFill, 64 * 0.8, 1e-3) && log.totals.compCut === 0, `${log.totals.floodFill.toFixed(3)} m³`);
  check('fill into open water is warned about', log.features[0].warnings.some(w => /open water/.test(w)));
  check('a vertical edge (0 slope: retaining wall) is warned about as steeper than 2:1', log.features[0].warnings.some(w => /2:1/.test(w)));
  const bfe = applyDesign(f, { features: d.features, settings: { bfe: level } });
  check('floodplain fill below a user BFE (no run)', near(bfe.log.totals.floodFill, 64 * 0.8, 1e-3));
  const cut = applyDesign(f, fc(designFeature('grade', square(20, 20, 8), { elev: 1.5, cutSlope: 0 }, 1)), { wse });
  check('cut below the flood level is reported as compensatory storage', near(cut.log.totals.compCut, 64 * 0.5, 1e-3));
}

// ---- no features: the same model, the same solver inputs
{
  const n = 64, f = model(n, (x, y) => 7 + 0.02 * x - 0.01 * y);
  for (let j = 20; j < 30; j++) for (let i = 20; i < 34; i++) f.bld[j * n + i] = 1;
  const none = applyDesign(f, fc()), ignored = applyDesign(f, { features: [] });
  check('no features: the baseline model itself, identical hash', none.fine === f && ignored.fine === f && hashFine(none.fine) === hashFine(f));
  const c0 = coarsen(f, 4, 0.7), c1 = coarsen(none.fine, 4, 0.7);
  const same = ['z', 'mask', 'manning', 'infil', 'roadFrac', 'rainField'].every(key => c0[key].every((v, k) => Object.is(v, c1[key][k])));
  check('no features: bit-identical solver inputs (coarsen)', same && !c1.bldId);
  const one = applyDesign(f, fc(designFeature('grade', square(5, 5, 6), { elev: 9 }, 1)));
  check('a feature changes the hash', one.log.hash !== hashFine(f));
  // a feature that does nothing (outside the grid) still leaves the grids equal
  const out = applyDesign(f, fc(designFeature('grade', square(500, 500, 6), { elev: 9 }, 1)));
  check('a feature outside the grid: equal grids, warned', out.log.hash === hashFine(f) && out.log.features[0].warnings.length === 1);
}

// ---- roof routing per building id
{
  const n = 40, f = model(n, () => 1);
  // two new buildings sharing a wall (one blob): A drains to the ground, B is a green roof (held at first)
  const d = fc(designFeature('building', square(10, 10, 6), { preset: 'shed', roof: 'ground' }, 1), designFeature('building', square(16, 10, 6), { preset: 'shed', roof: 'green' }, 2));
  const { fine } = applyDesign(f, d), c = coarsen(fine, 1, 0.5);
  const sum = (r) => r.reduce((a, v, k) => a + (c.mask[k] ? v - 1 : 0), 0);
  check('coarsen carries building ids and roofs', c.bldId && c.bldId[13 * n + 12] === 1 && c.bldId[13 * n + 18] === 2 && c.roofs.get(2).retention === 0.025);
  check('each new building\'s roof follows its own setting, not the area slider', near(sum(c.rainField), 72, 1e-9), `${sum(c.rainField)} m² of roof on the ground (both roofs, 72 m²)`);
  const held = roofRouting(c.mask, c.nx, c.ny, 0.5, { ids: c.bldId, roofs: c.roofs, held: new Set([2]) }).rainField;
  check('a green roof holds its rain until full', near(sum(held), 36, 1e-9));
  // a mapped building next to them: the area slider applies to its part of the blob only
  const g = model(n, () => 1); for (let j = 10; j < 16; j++) for (let i = 4; i < 10; i++) g.bld[j * n + i] = 1;
  const gd = applyDesign(g, d), cg = coarsen(gd.fine, 1, 0.5);
  check('a blob of mapped and new buildings: mapped part × roof slider, new part by its setting', near(cg.rainField.reduce((a, v, k) => a + (cg.mask[k] ? v - 1 : 0), 0), 72 + 0.5 * 36, 1e-9));
  // roof drains to the network: the nearest manhole within 30 m
  const nd = fc(designFeature('building', square(10, 10, 6), { preset: 'commercial' }, 5));
  const nf = applyDesign(f, nd).fine, cn = coarsen(nf, 1, 1);
  const net = { nodes: [{ p: [20, 13] }, { p: [39, 39] }, { p: [13, 13.5], outfall: true }] };
  const r = roofConnections(cn, net, 0, 1);
  check('commercial roof drains to the nearest manhole within 30 m', r.roofArea[0] === 36 && r.roofArea[1] === 0 && near(cn.rainField.reduce((a, v, k) => a + (cn.mask[k] ? v - 1 : 0), 0), 36, 1e-9) && near(r.rainField.reduce((a, v, k) => a + (cn.mask[k] ? v - 1 : 0), 0), 0, 1e-9));
  const far = roofConnections(cn, { nodes: [{ p: [39, 39] }] }, 0, 1);
  check('no manhole within 30 m: the roof drains to the ground', far.roofArea[0] === 0 && near(far.rainField.reduce((a, v, k) => a + (cn.mask[k] ? v - 1 : 0), 0), 36, 1e-9));
  const to = roofConnections(cn, net, 0, 1, 80, { toCell: (p) => p });
  check('without a chosen manhole the nearest is used', to.roofArea[0] === 36);
  const pick = applyDesign(f, fc(designFeature('building', square(10, 10, 6), { preset: 'commercial', roofTo: [39, 39] }, 5))).fine, cp = coarsen(pick, 1, 1);
  check('a roof drain to a chosen manhole', roofConnections(cp, net, 0, 1, 80, { toCell: (p) => p }).roofArea[1] === 36);
}

// ---- elevated on piers, flooded check, presets
{
  const n = 40, f = model(n, () => 4);
  const { fine, log } = applyDesign(f, { features: [designFeature('building', square(10, 10, 8), { preset: 'elevated' }, 1), designFeature('building', square(24, 10, 8), { preset: 'sfr' }, 2)], settings: { bfe: 5 } });
  check('elevated: flow passes under (bld 0), ground untouched, lowest member at BFE + freeboard', fine.bld[14 * n + 14] === 0 && fine.z[14 * n + 14] === 4 && near(log.features[0].resolved.ffe, 5.3, 1e-6) && log.features[0].notes.some(t => /pier/.test(t)));
  const wse = new Float32Array(n * n).fill(5.2), fl = floodedBuildings(fine, wse);
  check('flooded check: water at 5.2 m stays below FFE 5.3 m', fl.length === 2 && fl.every(b => !b.flooded));
  check('flooded check: water at 5.4 m floods both', floodedBuildings(fine, wse.fill(5.4)).every(b => b.flooded));
  check('every preset has a foundation, apron, roof and height', Object.values(PRESETS).every(p => p.foundation && p.apronW >= 0 && p.roof && p.height > 0));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll design tests passed');
process.exit(fails ? 1 : 0);
