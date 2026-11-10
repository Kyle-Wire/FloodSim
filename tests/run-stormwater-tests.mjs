// Stormwater design tests (docs/specs/site-design-mode.md, phase 3): the outlet rating (orifices, weirs, submergence,
// continuity), stage–storage, level-pool routing (modified Puls) against analytic drawdowns, the pond / swale / rain
// garden / permeable pavement features, outlet defaults, downspout overrides, drawn GI layers, the outlet links' books,
// and the detention check.
// Usage: node tests/run-stormwater-tests.mjs
import { buildFine, coarsen, roofConnections } from '../src/terrain.js';
import { hsgParams } from '../src/soil.js';
import { applyDesign, designFeature } from '../src/design.js';
import * as SW from '../src/stormwater.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const G = 9.81;
function model(n, zf, { hsg = 2 } = {}) {
  const dem = { z: new Float32Array(n * n) };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) dem.z[j * n + i] = zf(i + 0.5, j + 0.5);
  const f = buildFine({ nx: n, ny: n, dx: 1 }, dem, { buildings: [], roads: [] }, new Uint8Array(n * n).fill(21), []);
  const p = hsgParams('ABCD'[hsg - 1]); f.hsg.fill(hsg); f.ga.K.fill(p.K); f.ga.psi.fill(p.psi); f.ga.thetaE.fill(p.thetaE);
  return f;
}
const square = (x0, y0, a, b = a) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x0 + a, y0], [x0 + a, y0 + b], [x0, y0 + b], [x0, y0]]] });
const line = (...pts) => ({ type: 'LineString', coordinates: pts });
const fc = (...features) => ({ features });

// ---- the outlet rating
{
  const D = 0.3, inv = 10, A = Math.PI * D * D / 4;
  check('orifice, free: Cd·A·√(2g·head over the centre)', near(SW.orificeQ(11, -Infinity, D, inv), 0.61 * A * Math.sqrt(2 * G * (1 - D / 2)), 1e-12));
  check('orifice, part full: continuous at the crown and 0 at the invert', near(SW.orificeQ(inv + D, -Infinity, D, inv), 0.61 * A * Math.sqrt(2 * G * D / 2), 1e-12) && SW.orificeQ(inv, -Infinity, D, inv) === 0 && SW.orificeQ(inv + 0.1, -Infinity, D, inv) > 0);
  check('orifice, submerged outlet: head over the tailwater; reversed when the tailwater is higher', near(SW.orificeQ(11, 10.6, D, inv), 0.61 * A * Math.sqrt(2 * G * 0.4), 1e-12) && near(SW.orificeQ(10.6, 11, D, inv), -SW.orificeQ(11, 10.6, D, inv), 1e-12));
  check('weir, free: C·L·h^1.5', near(SW.weirQ(12.3, -Infinity, 12, 2, 1.84), 1.84 * 2 * 0.3 ** 1.5, 1e-12));
  check('weir, drowned (Villemonte): less, and 0 at a level tailwater', SW.weirQ(12.3, 12.2, 12, 2, 1.84) < SW.weirQ(12.3, -Infinity, 12, 2, 1.84) && SW.weirQ(12.3, 12.3, 12, 2, 1.84) === 0);
  const o = { orifices: [{ D: 0.15, inv: 10 }, { D: 0.3, inv: 11 }], weir: { crest: 12, L: 3.8 }, spillway: { crest: 12.5, L: 3 } }, r = SW.rating(o, 12.7);
  check('composite rating = orifices + riser + spillway', near(r.q, SW.orificeQ(12.7, -Infinity, 0.15, 10) + SW.orificeQ(12.7, -Infinity, 0.3, 11) + SW.weirQ(12.7, -Infinity, 12, 3.8, 1.84) + SW.weirQ(12.7, -Infinity, 12.5, 3, 1.7), 1e-12) && r.parts.spillway > 0);
  let mono = true, last = -1; for (let h = 9.9; h < 13; h += 0.01) { const q = SW.rating(o, h).q; if (q < last - 1e-12) mono = false; last = q; }
  check('the composite rating rises with the pond level (no steps back)', mono);
}

// ---- stage–storage and level-pool routing
{
  const n = 20, z = new Float32Array(n * n).fill(5), cells = [...z.keys()];
  const ss = SW.stageStorage(z, cells, 1, 7, 41);
  check('stage–storage of a flat-bottomed box: S = A·(h − bottom)', ss.bottom === 5 && ss.S.every((s, m) => near(s, 400 * (ss.h[m] - 5), 1e-6)));
  // a linear reservoir draining with no inflow: h = h0·exp(−k t / A)
  const k = 2, h0 = 1.5, lin = SW.modifiedPuls(() => 0, { h: ss.h.map(h => h - 5), S: ss.S }, (h) => k * h, { h0, dt: 5, tEnd: 600 });
  const err = Math.max(...lin.map(p => Math.abs(p.h - h0 * Math.exp(-k * p.t / 400))));
  check('modified Puls: a linear reservoir decays exponentially', err < 2e-3, `max |Δh| ${err.toExponential(1)} m`);
  // a box draining through an orifice (Torricelli): √H = √H0 − Cd·a·√(2g)·t / (2A), H over the orifice centre
  const D = 0.2, a = Math.PI * D * D / 4, H0 = 1.8, inv = 5, out = SW.modifiedPuls(() => 0, ss, (h) => SW.orificeQ(h, -Infinity, D, inv), { h0: 5 + D / 2 + H0, dt: 2, tEnd: 300 });
  const tor = (t) => (Math.sqrt(H0) - 0.61 * a * Math.sqrt(2 * G) * t / (2 * 400)) ** 2 + 5 + D / 2;
  const e2 = Math.max(...out.map(p => Math.abs(p.h - tor(p.t))));
  check('modified Puls: an orifice drains a box as Torricelli', e2 < 2e-3, `max |Δh| ${e2.toExponential(1)} m`);
}

// ---- the pond feature
{
  const n = 60, f = model(n, () => 10), d = fc(designFeature('pond', square(15, 15, 30), { depth: 1.5, sideSlope: 3, pool: 9 }, 1));
  const { fine, log } = applyDesign(f, d), r = log.features[0].resolved, j = 30;
  check('pond: bank top at the lowest ground around it, bottom 1.5 m down', r.top === 10 && near(r.bottom, 8.5, 1e-9) && fine.z[j * n + 30] === 8.5);
  const steps = []; for (let i = 15; i < 19; i++) steps.push(fine.z[j * n + i] - fine.z[j * n + i + 1]);
  check('pond: inside slopes 3:1 from the top of the bank', steps.every(s => near(s, 1 / 3, 1e-5)) && near(10 - fine.z[j * n + 15], 0.5 / 3, 1e-5), steps.map(s => s.toFixed(3)).join(' '));
  const V = 1.5 / 3 * (30 * 30 + 30 * 21 + 21 * 21);
  check('pond: storage to the top = the truncated pyramid', near(r.volumeAtTop, V, 0.01 * V), `${r.volumeAtTop.toFixed(1)} vs ${V.toFixed(1)} m³`);
  check('pond: wet pond pool volume and the ponds list for the run', r.poolVolume > 0 && fine.ponds.length === 1 && fine.ponds[0].pool === 9 && fine.ponds[0].cells.length === 900);
  check('pond: no outflow from the model through the bank (the ground outside untouched)', fine.z[j * n + 13] === 10 && fine.z[j * n + 46] === 10);
  // outlet from inside the pond: defaults from the pond
  const o = applyDesign(f, fc(designFeature('pond', square(15, 15, 30), { depth: 1.5 }, 1), designFeature('outlet', line([30.5, 30.5], [55.5, 30.5]), {}, 2))).log.features[1].resolved;
  check('outlet: in the pond, orifice at the bottom, riser 18 in and spillway 6 in below the top', o.pond === 1 && near(o.orifices[0].inv, 8.5, 1e-9) && near(o.weir.crest, 10 - 0.457, 1e-9) && near(o.spillway.crest, 10 - 0.152, 1e-9));
  const wet = applyDesign(f, fc(designFeature('pond', square(15, 15, 30), { depth: 1.5, pool: 9 }, 1), designFeature('outlet', line([30.5, 30.5], [55.5, 30.5]), {}, 2))).log.features[1].resolved;
  check('outlet of a wet pond: the orifice at the permanent pool', near(wet.orifices[0].inv, 9, 1e-9));
  const stray = applyDesign(f, fc(designFeature('outlet', line([5.5, 5.5], [8.5, 5.5]), { spillwayCrest: 9, weirCrest: 9.5 }, 2))).log.features[0];
  check('outlet outside a pond and a spillway under the riser are warned about', stray.warnings.some(w => /not start inside a pond/.test(w)) && stray.warnings.some(w => /spillway is below/.test(w)));
}

// ---- swale
{
  const n = 70, f = model(n, (x) => 10 - 0.01 * x), { fine, log } = applyDesign(f, fc(designFeature('swale', line([5, 30.5], [60, 30.5]), { depth: 0.45, bottomW: 0.6, sideSlope: 3, n: 0.035 }, 1)));
  const r = log.features[0].resolved, k = 30 * n + 30;
  check('swale: inverts the depth below the ground at its ends', near(r.invertUp, 10 - 0.01 * 5.5 - 0.45, 1e-5) && near(r.invertDn, 10 - 0.01 * 60.5 - 0.45, 1e-5) && near(r.slope, 0.01, 1e-4), `slope ${r.slope.toFixed(5)}`);
  check('swale: the centre line at the invert, its own n', near(fine.z[k], r.invertUp + (r.invertDn - r.invertUp) * (30.5 - 5) / 55, 1e-3) && near(fine.manning[k], 0.035, 1e-7));
  const side = fine.z[(30 + 1) * n + 30] - fine.z[k];
  check('swale: side slopes 3:1 beyond the bottom width', near(side, (1 - 0.3) / 3, 1e-3), side.toFixed(4));
  // an existing channel set to a surveyed bed: the same cut, the ground's own cover, soil and roughness
  const kept = applyDesign(f, fc(designFeature('swale', line([5, 30.5], [60, 30.5]), { depth: 0.45, bottomW: 0.6, sideSlope: 3, surface: 'keep' }, 1)));
  check("swale with surface 'keep': the same bed, the ground's n, infiltration and class", near(kept.fine.z[k], fine.z[k], 1e-6) && kept.fine.manning[k] === f.manning[k] && kept.fine.infil[k] === f.infil[k] && kept.fine.cls[k] === f.cls[k] && kept.log.features[0].resolved.surface === 'kept',
    `n ${kept.fine.manning[k]} vs ${f.manning[k]}`);
}

// ---- rain garden and permeable pavement, drawn GI layers
{
  const n = 40, f = model(n, () => 5);
  const d = fc(designFeature('bioretention', square(10, 10, 6), { underdrain: true, node: [30, 30] }, 1), designFeature('permeable', square(22, 10, 8), {}, 2), designFeature('bioretention', square(10, 25, 4), { underdrain: true }, 3));
  const { fine, log } = applyDesign(f, d), c = coarsen(fine, 1, 1), gi = SW.drawnGI(fine, c, 1), k = 13 * n + 13, p = 14 * n + 25;
  check('rain garden: a 6 in depression below the ground around it', near(fine.z[k], 5 - 0.15, 1e-6) && near(log.features[0].resolved.pondingVolume, 36 * 0.15, 1e-4));
  check('rain garden: media store 0.6 × 0.35 at 50 mm/hr, native drain of the compacted group (C), underdrain 25 mm/hr', near(gi.cap[k], 0.21, 1e-9) && near(gi.rate[k], 50 / 3.6e6, 1e-15) && near(gi.drain[k], 2.5 / 3.6e6, 1e-15) && near(gi.under[k], 25 / 3.6e6, 1e-15));
  check('permeable pavement: paved, all through the stone store (1000 mm/hr, 0.2 m)', fine.road[p] === 1 && fine.perv[p] === 0 && near(gi.rate[p], 1000 / 3.6e6, 1e-15) && near(gi.cap[p], 0.2, 1e-9) && gi.under[p] === 0);
  check('drawn GI areas and an underdrain without a node warned about', near(gi.gardenArea, 52, 1e-9) && near(gi.pavedArea, 64, 1e-9) && log.features[2].warnings.some(w => /no node/.test(w)) && fine.drawnGI[2].under === 0);
  const base = { rate: new Float64Array(n * n).fill(1e-6), cap: new Float64Array(n * n).fill(0.01), drain: new Float64Array(n * n), pavedArea: 5, gardenArea: 0 };
  const sum = SW.drawnGI(fine, c, 1, base);
  check('drawn GI adds to the area-wide layer', near(sum.cap[k], 0.22, 1e-9) && near(sum.cap[0], 0.01, 1e-12) && near(sum.pavedArea, 69, 1e-9));
}

// ---- downspouts
{
  const n = 50, f = model(n, () => 3); for (let j = 10; j < 20; j++) for (let i = 10; i < 22; i++) f.bld[j * n + i] = 1;
  const d = fc(designFeature('downspout', line([15.5, 15.5], [40.5, 15.5]), {}, 9), designFeature('building', square(30, 30, 6), { preset: 'shed', roof: 'ground' }, 4), designFeature('downspout', line([32.5, 32.5], [44.5, 32.5]), {}, 10));
  const { fine, log } = applyDesign(f, d);
  check('downspout from a mapped building: its blob takes the feature id, its roof drains to the line end', fine.bldId[15 * n + 15] === 9 && fine.roofs.get(9).roof === 'network' && fine.roofs.get(9).to.join() === '40.5,15.5' && log.features[0].cells === 120);
  check('downspout from a new building overrides its roof setting', fine.roofs.get(4).roof === 'network' && fine.roofs.get(4).to.join() === '44.5,32.5');
  const c = coarsen(fine, 1, 1), net = { nodes: [{ p: [40.5, 15.5] }, { p: [44.5, 32.5] }, { p: [5, 5] }] }, r = roofConnections(c, net, 0, 1, 80, { toCell: (pt) => pt });
  check('the roofs drain to the manholes at the downspouts’ ends', r.roofArea[0] === 120 && r.roofArea[1] === 36 && r.roofArea[2] === 0);
  const miss = applyDesign(f, fc(designFeature('downspout', line([2.5, 2.5], [8.5, 2.5]), {}, 11))).log.features[0];
  check('a downspout that does not start in a building is warned about', miss.warnings.some(w => /not start in a building/.test(w)));
}

// ---- outlet links: measured removal, delayed delivery, books
{
  const zs = Float64Array.from([10, 9, 9]), o = { orifices: [{ D: 0.3, inv: 10 }] };
  const L = new SW.OutletLinks([{ a: 0, b: 1, node: -1, mode: 'surface', structure: o, id: 1 }, { a: 2, b: -1, node: -1, mode: 'offsite', structure: o, id: 2 }], [10, 9, 10], { cellArea: 4 });
  let q = L.step(new Float64Array(3), Float64Array.from([1, 0, 1]), 2); // levels: pond 11 over a 10 m invert, tailwater 9
  const want = Math.min(SW.rating(o, 11, 9).q, 0.5 * 2 * 4 / 2);
  check('outlet link: rate from the rating at the levels now (capped at half the level difference)', near(q[L.slot.get(0)], want, 1e-6) && q[L.slot.get(1)] === 0 && near(q[L.slot.get(2)], SW.rating(o, 11).q, 1e-6));
  const v0 = want * 2, v2 = SW.rating(o, 11).q * 2; // the solver removed what was asked
  q = L.step(Float64Array.from([v0, 0, v2]), Float64Array.from([0.9, 0, 0.9]), 2);
  check('outlet link: what the pond lost arrives downstream over the next interval; off-model water is booked', near(q[L.slot.get(1)], -v0 / 2, 1e-6) && near(L.inTransit, v0, 1e-6) && near(L.totals.offsite, v2, 1e-6));
  const res = L.results();
  check('outlet results: peak stage and peak outflow', res[0].peakStage === 11 && near(res[0].peakQ, want, 1e-6) && res[1].freeboard === null);
}

// ---- the detention check
{
  const t = SW.detentionTable([{ ari: 10, line: { id: 1 }, pre: 2, post: 1.9 }, { ari: 100, line: { id: 1 }, pre: 3, post: 3.3 }, { ari: 2, line: { id: 1 }, pre: NaN, post: 1 }]);
  check('detention check: post ≤ pre passes, a higher post fails, a missing run is undecided', t[0].pass === true && t[1].pass === false && Math.abs(t[1].ratio - 1.1) < 1e-12 && t[2].pass === null);
}

console.log(fails ? `\n${fails} FAILED` : '\nAll stormwater tests passed');
process.exit(fails ? 1 : 0);
