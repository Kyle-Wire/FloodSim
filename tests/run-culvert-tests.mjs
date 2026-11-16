// Culvert hydraulics (src/culvert.js) against the independent FHWA HDS-5 reference written for the culvert benchmarks
// (benchmarks/culvert/hds5.mjs): inlet control across the unsubmerged, transition and submerged ranges, drowned
// outlet control, the round trip from levels to flow, and the behaviour a link needs (sign, zero, monotone, barrels).
// Usage: node tests/run-culvert-tests.mjs
import { culvertFlow, culvertState, culvertOf, inletHeadwater, criticalDepth, section, INLETS } from '../src/culvert.js';
import * as REF from '../benchmarks/culvert/hds5.mjs';
import { culvertFlow as oldFlow } from '../src/river.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// the entrances both modules hold: [production key, reference key, shape, rise, span]
const SHARED = [
  ['circle-concrete-headwall', 'circle/concrete/headwall', 'circle', 1.2, 1.2],
  ['circle-cmp-headwall', 'circle/metal/headwall', 'circle', 0.9, 0.9],
  ['circle-cmp-mitered', 'circle/metal/mitered', 'circle', 1.5, 1.5],
  ['circle-cmp-projecting', 'circle/metal/projecting', 'circle', 0.6, 0.6],
  ['box-wingwall-90-15', 'box/concrete/headwall', 'box', 1.5, 2.4],
];
const fullA = (shape, rise, span) => (shape === 'box' ? rise * span : Math.PI / 4 * rise * rise);
const QS = [0.5, 1, 2, 3, 3.4, 3.6, 3.75, 3.9, 4.1, 5, 7, 9]; // as Ku·Q/(A·D^0.5): unsubmerged, transition, submerged

{
  let worst = 0, n = 0, regimes = new Set();
  for (const [key, refKey, shape, rise, span] of SHARED) for (const S of [0, 0.01, 0.03]) for (const q of QS) {
    const Q = q * fullA(shape, rise, span) * Math.sqrt(rise) / REF.KU, r = REF.inletControlHW(refKey, shape, rise, span, Q, S), hw = inletHeadwater(key, shape, rise, span, Q, S);
    worst = Math.max(worst, rel(hw, r.HW)); n++; regimes.add(r.regime);
  }
  check('inlet control: headwater equals the reference at every entrance, slope and discharge', worst < 1e-5 && regimes.size === 3, `${n} cases, worst ${(worst * 100).toExponential(1)} %`);
  check('geometry: critical depth and section agree with the reference', ['circle', 'box'].every(sh => [0.2, 1, 3].every(Q => rel(criticalDepth(sh, 1.2, 1.8, Q), REF.criticalDepth(sh, 1.2, sh === 'box' ? 1.8 : 1.2, Q)) < 1e-5))
    && rel(section('circle', 1.2, 1.2, 0.5).A, REF.geom('circle', 1.2, 1.2, 0.5).A) < 1e-5 && rel(section('box', 1.2, 1.8, 0.5).P, REF.geom('box', 1.2, 1.8, 0.5).P) < 1e-9);
}
{
  // levels → flow, inlet control: a short steep barrel with a free outfall, so the entrance governs
  let worst = 0, all = true;
  for (const [key, refKey, shape, rise, span] of SHARED) for (const q of [1, 2.5, 3.75, 5, 8]) {
    const Q = q * fullA(shape, rise, span) * Math.sqrt(rise) / REF.KU, len = 12, S = 0.03, invUp = 10, invDn = invUp - S * len;
    const hw = REF.inletControlHW(refKey, shape, rise, span, Q, S).HW, st = culvertState(invUp + hw, invDn - 5, { shape, rise, span, len, invUp, invDn, inlet: key, n: 0.012 });
    worst = Math.max(worst, rel(st.Q, Q)); if (st.control !== 'inlet') all = false;
  }
  check('round trip under inlet control: the reference headwater gives back its discharge', worst < 1e-4 && all, `worst ${(worst * 100).toFixed(4)} %`);
}
{
  // drowned outlet: tailwater over the crown, a long flat barrel, so the barrel governs (HDS-5 eq. 3.6)
  let worst = 0, all = true;
  for (const [key, , shape, rise, span] of SHARED) for (const V of [0.5, 1.5, 3]) {
    const Q = V * fullA(shape, rise, span), len = 60, n = 0.024, inv = 10, tw = inv + rise + 0.5, ke = INLETS[key].ke;
    const H = REF.outletControlFull(shape, rise, span, Q, n, len, { Ke: ke }).H, st = culvertState(tw + H, tw, { shape, rise, span, len, invUp: inv, invDn: inv, inlet: key, n });
    worst = Math.max(worst, rel(st.Q, Q)); if (st.control !== 'outlet') all = false;
  }
  check('round trip under drowned outlet control: tailwater + the reference loss gives back its discharge', worst < 1e-4 && all, `worst ${(worst * 100).toFixed(4)} %`);
  // low tailwater, headwater well over the crown: h0 = (dc + D)/2 (HDS-5), against the reference's outletControlHW
  const shape = 'circle', D = 1.2, len = 80, n = 0.024, S = 0.002, invUp = 10, invDn = invUp - S * len, Q = 2.2;
  const hw = REF.outletControlHW(shape, D, D, Q, n, len, S, 0.1, { Ke: 0.5 }), st = culvertState(invUp + hw, invDn + 0.1, { D, len, invUp, invDn, n });
  check('outlet control with a low tailwater uses h0 = (dc + D)/2', hw > 1.2 * D && st.control === 'outlet' && rel(st.Q, Q) < 1e-4, `HW/D ${(hw / D).toFixed(2)}, Q ${st.Q.toFixed(3)} against ${Q}`);
}
{
  const c = { D: 1.2, len: 20, inv: 10, n: 0.013 };
  check('no flow: level under the invert, or level on both sides', culvertFlow(9.9, 9.5, c) === 0 && culvertFlow(11, 11, c) === 0 && culvertState(9.9, 9.5, c).control === 'none');
  check('reverse flow: the same size, the other sign', culvertFlow(10.8, 12, c) < 0 && rel(-culvertFlow(10.8, 12, c), culvertFlow(12, 10.8, c)) < 1e-9);
  let mono = true, prev = 0; for (let h = 10.12; h < 16; h += 0.02) { const q = culvertFlow(h, 10.1, c); if (q < prev - 1e-6) mono = false; prev = q; }
  check('flow never falls as the headwater rises (through part-full, drowned and both controls)', mono);
  let monoT = true; prev = Infinity; for (let t = 9.5; t < 13; t += 0.02) { const q = culvertFlow(13, t, c); if (q > prev + 1e-6) monoT = false; prev = q; }
  check('flow never rises as the tailwater rises', monoT);
  let jump = 0; prev = culvertFlow(10.02, 10.01, c); for (let h = 10.03; h < 16; h += 0.01) { const q = culvertFlow(h, 10.01, c); jump = Math.max(jump, q - prev); prev = q; }
  check('no step in the flow larger than 5 % of the full-barrel flow per cm of headwater', jump < 0.05 * culvertFlow(16, 10.01, c), `largest ${jump.toFixed(3)} m³/s`);
  check('barrels multiply the flow', rel(culvertFlow(12, 10.5, { ...c, barrels: 3 }), 3 * culvertFlow(12, 10.5, c)) < 1e-12);
  const cv = culvertOf(c);
  check('the older { D, inv } record is a circular pipe with one invert and the default entrance', cv.shape === 'circle' && cv.rise === 1.2 && cv.span === 1.2 && cv.invUp === 10 && cv.invDn === 10 && cv.inletKey === 'circle-concrete-headwall' && cv.ke === 0.5 && cv.barrels === 1);
  check('an entrance of the wrong shape falls back to the shape\'s default', culvertOf({ shape: 'box', rise: 1, span: 2, inlet: 'circle-cmp-projecting', inv: 0 }).inletKey === 'box-wingwall-30-75');
  check('a rougher entrance passes less at the same levels', culvertFlow(13, 9, { ...c, inlet: 'circle-cmp-projecting' }) < culvertFlow(13, 9, c) && culvertFlow(13, 9, { ...c, inlet: 'circle-concrete-groove' }) > culvertFlow(13, 9, c));
}
{
  // what changes for a run: the older routine (critical flow at 2/3 of the head through the full area, no entrance
  // contraction) against HDS-5, a 1.2 m concrete pipe 20 m long with a free outfall
  const c = { D: 1.2, len: 20, inv: 10, n: 0.013 }, at = (r) => [oldFlow(10 + r * 1.2, 9, c), culvertFlow(10 + r * 1.2, 9, c)];
  const [o1, n1] = at(1), [o3, n3] = at(3);
  check('at HW/D = 1 the older routine and HDS-5 are within 15 %', rel(o1, n1) < 0.15, `${o1.toFixed(2)} against ${n1.toFixed(2)} m³/s`);
  check('at HW/D = 3 the older routine passed over 30 % more than HDS-5 allows', o3 > 1.3 * n3, `${o3.toFixed(2)} against ${n3.toFixed(2)} m³/s`);
  // HDS-5 Chart 1B check value: a 1200 mm concrete pipe, square edge with headwall, at HW/D = 2.0 carries about 4.0 m³/s
  const [, n2] = at(2);
  check('HDS-5 inlet-control nomograph value: 1200 mm concrete headwall at HW/D = 2 is about 4 m³/s', n2 > 3.6 && n2 < 4.4, `${n2.toFixed(2)} m³/s`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall culvert tests passed');
process.exit(fails ? 1 : 0);
