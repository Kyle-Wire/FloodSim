// B8: infrastructure coverage, SWMM alone. Does the translation give the same hydraulics when the same physical culvert
// arrives in the forms real networks have? Four groups, each against the independent reference (hds5.mjs) and, where
// the question is representation, against the one-length, one-barrel form of the same culvert:
//   B8-M  several lengths: one 30 m pipe as 1, 3 and 6 conduits in a chain, the code and entrance loss on the first,
//         the exit loss on the last (as the network writes a crossing of several records). Inlet control (free outfall,
//         S 0.02) and full-barrel outlet control (tailwater 0.5 m over the crown, S 0.002, EXTRAN).
//   B8-B  several barrels: 2 × 1.2 m pipes carrying 2Q against HDS-5 per barrel at Q, and against one barrel at Q.
//   B8-R  reverse flow: water entering at the outlet end (backwater, tide). The outlet end becomes the inlet, on an
//         adverse slope. Reference: the greater of HDS-5 inlet control at that end (the same headwall) and the barrel's
//         own profile: a direct-step backwater from critical depth at the free-falling high end, Manning friction, full-
//         barrel friction from wherever the profile reaches the crown, and the entrance loss (Ke 0.5) at the reversed
//         entrance. (Round 2 first used HDS-5's (dc + D)/2 outlet approximation here; the review showed it is not valid
//         for a part-full adverse barrel.) SWMM applies inlet control only to positive flow at the conduit's first node
//         (dwflow.c), so the code is expected to be inert in reverse.
//   B8-S  silt at the inlet: the barrel silted to 25 % of its rise, so the inlet face is the open section. HDS-5 has no
//         silted-inlet table; the reference is HDS-5's equations on the OPEN section (its rise, area and critical depth)
//         with the parent shape's coefficients, the usual practice for embedded culverts (FHWA-HRT-07-032). An
//         approximation, so a wider band, and marked as such.
// Bands: inlet control as B1 (max(0.03 m, 3 %); transition and outlet-governed rows max(0.05 m, 5 %)); outlet control as
// B2 (max(5 mm, 1 %)); representation (same culvert, different records) max(5 mm, 0.5 %).
//
//   node benchmarks/culvert/b8-coverage.mjs            (exit code 1 on a scored failure)
import fs from 'node:fs';
import { runSteady, conduit, swmmEngine } from './model.mjs';
import { inletControlHW, outletControlHW, outletControlFull, fullArea, geom, criticalDepth, KU, INLET, G } from './hds5.mjs';

const swmm = await swmmEngine();
const pipe = (barrels = 1) => conduit('circle', 1.2, 1.2, 'concrete', null, barrels), key = 'circle/concrete/headwall', D = 1.2, A = fullArea('circle', D, D);
const Qof = (q) => q * A * Math.sqrt(D) / KU;
const inletBand = (ref, wide) => wide ? Math.max(0.05, 0.05 * ref) : Math.max(0.03, 0.03 * ref);
const rows = [], fails = [];
const ref5 = (Q, S, L, n, tw = 0, Ke = 0.5) => {
  const h = inletControlHW(key, 'circle', D, D, Q, S), out = outletControlHW('circle', D, D, Q, n, L, S, tw, { Ke, Kx: 1 });
  const outletValid = out >= 0.75 * D, inlet = h.HW >= out || !outletValid;
  return { ref: inlet ? h.HW : out, regime: h.q < 0.5 ? 'below range' : h.regime, governs: inlet ? 'inlet' : 'outlet' };
};
const push = (row, ok, msg) => { rows.push({ ...row, pass: ok }); if (!ok) fails.push(msg); };

// ---- B8-M several lengths ---------------------------------------------------------------------------------------------
{
  const S = 0.02, L = 30;
  for (const q of [0.5, 1, 2, 3, 4, 5]) {
    const Q = Qof(q), h = ref5(Q, S, L, 0.013), one = runSteady(swmm, { asset: pipe(), L, S }, Q, { holdS: 1800 });
    for (const N of [1, 3, 6]) {
      const r = N === 1 ? one : runSteady(swmm, { asset: pipe(), L, S, segments: N }, Q, { holdS: 1800 });
      const d = r.d1 - h.ref, tol = inletBand(h.ref, h.regime === 'transition' || h.governs === 'outlet'), rep = r.d1 - one.d1, repTol = Math.max(0.005, 0.005 * one.d1);
      const row = { group: 'B8-M', test: 'inlet control, free outfall', segments: N, qAD: q, Q: +Q.toFixed(3), swmmHW: +r.d1.toFixed(4), hds5HW: +h.ref.toFixed(4), zone: h.regime, governs: h.governs, diff: +d.toFixed(4), tol: +tol.toFixed(3),
        vsOneLength: +rep.toFixed(4), steady: r.drift < 0.005, continuityErrPct: r.mass.swmmErrorPct };
      const scored = h.regime !== 'below range';
      push(row, (!scored || Math.abs(d) <= tol) && Math.abs(rep) <= repTol && row.steady,
        `B8-M ${N} lengths, Q/AD^0.5 ${q}: SWMM ${row.swmmHW} m, HDS-5 ${row.hds5HW} m (${row.diff}), one length ${one.d1.toFixed(4)} m (${row.vsOneLength})${row.steady ? '' : ', not steady'}`);
    }
  }
  const S2 = 0.002, routing = { surcharge: 'EXTRAN' };
  for (const V of [1, 2, 3]) {
    const Q = V * A, tw = 10 - S2 * L + D + 0.5, one = runSteady(swmm, { asset: pipe(), L, S: S2, routing }, Q, { tw, holdS: 1800 });
    for (const N of [1, 3, 6]) {
      const r = N === 1 ? one : runSteady(swmm, { asset: pipe(), L, S: S2, routing, segments: N }, Q, { tw, holdS: 1800 });
      const H = outletControlFull('circle', D, D, Q, r.x.n, L, { Ke: 0.5, Kx: 1 }).H, dh = r.h1 - tw, tol = Math.max(0.005, 0.01 * H), rep = r.h1 - one.h1;
      const row = { group: 'B8-M', test: 'outlet control, full barrel (EXTRAN)', segments: N, V, Q: +Q.toFixed(3), swmmHeadLoss: +dh.toFixed(4), hds5HeadLoss: +H.toFixed(4), diff: +(dh - H).toFixed(4), tol: +tol.toFixed(4), vsOneLength: +rep.toFixed(4), continuityErrPct: r.mass.swmmErrorPct };
      push(row, Math.abs(dh - H) <= tol && Math.abs(rep) <= Math.max(0.005, 0.005 * H), `B8-M ${N} lengths, full barrel V ${V}: head loss ${row.swmmHeadLoss} m vs HDS-5 ${row.hds5HeadLoss} m; one length differs by ${row.vsOneLength} m`);
    }
  }
}

// ---- B8-B several barrels ---------------------------------------------------------------------------------------------
{
  const S = 0.02, L = 20;
  for (const q of [0.5, 1, 2, 3, 4, 5]) {
    const Q = Qof(q), h = ref5(Q, S, L, 0.013);
    const two = runSteady(swmm, { asset: pipe(2), L, S }, 2 * Q, { holdS: 1800 }), one = runSteady(swmm, { asset: pipe(1), L, S }, Q, { holdS: 1800 });
    const d = two.d1 - h.ref, tol = inletBand(h.ref, h.regime === 'transition' || h.governs === 'outlet'), rep = two.d1 - one.d1;
    const row = { group: 'B8-B', test: '2 barrels at 2Q, inlet control', qADperBarrel: q, Qtotal: +(2 * Q).toFixed(3), barrels: two.x.barrels, swmmHW: +two.d1.toFixed(4), hds5HW: +h.ref.toFixed(4), zone: h.regime, diff: +d.toFixed(4), tol: +tol.toFixed(3), vsOneBarrelAtQ: +rep.toFixed(4), steady: two.drift < 0.005 };
    const scored = h.regime !== 'below range';
    push(row, (!scored || Math.abs(d) <= tol) && Math.abs(rep) <= Math.max(0.005, 0.005 * one.d1), `B8-B 2 barrels, Q/AD^0.5 ${q}: SWMM ${row.swmmHW} m vs HDS-5 ${row.hds5HW} m (${row.diff}); one barrel at Q differs by ${row.vsOneBarrelAtQ} m`);
  }
  const S2 = 0.002, L2 = 30, routing = { surcharge: 'EXTRAN' };
  for (const V of [1, 2, 3]) {
    const Q = V * A, tw = 10 - S2 * L2 + D + 0.5, r = runSteady(swmm, { asset: pipe(2), L: L2, S: S2, routing }, 2 * Q, { tw, holdS: 1800 });
    const H = outletControlFull('circle', D, D, Q, r.x.n, L2, { Ke: 0.5, Kx: 1 }).H, dh = r.h1 - tw, tol = Math.max(0.005, 0.01 * H);
    push({ group: 'B8-B', test: '2 barrels at 2Q, full barrel (EXTRAN)', V, swmmHeadLoss: +dh.toFixed(4), hds5HeadLoss: +H.toFixed(4), diff: +(dh - H).toFixed(4), tol: +tol.toFixed(4) }, Math.abs(dh - H) <= tol,
      `B8-B 2 barrels full, V ${V}: head loss ${dh.toFixed(4)} m vs HDS-5 ${H.toFixed(4)} m`);
  }
}

/** Headwater (m above the low end's invert) for flow up an adverse barrel of slope S, length L, free fall at the high end. */
function backwaterAdverse(Q, n, S, L, Ke) {
  const Af = A, Rf = A / (Math.PI * D), Vf = Q / Af, SfFull = (n * Vf) ** 2 / Rf ** (4 / 3);
  const E = (y) => { const { A: a } = geom('circle', D, D, y); return y + (Q / a) ** 2 / (2 * G); };
  const Sf = (y) => { const { A: a, P } = geom('circle', D, D, y); return (n * Q / a) ** 2 / (a / P) ** (4 / 3); };
  let y = criticalDepth('circle', D, D, Q) * 1.001, x = 0; const N = 400, dx = L / N;
  for (let i = 0; i < N; i++) { // step from the high (exit) end toward the entrance: the bed drops S·dx each step
    const target = (yy) => E(yy) - (E(y) + S * dx + 0.5 * (Sf(y) + Sf(yy)) * dx);
    let lo = y, hi = D * 0.9999;
    if (target(hi) < 0) { // the profile reaches the crown: full-barrel friction for the rest, to the entrance
      // the specific energy at the point the profile fills (D + Vf²/2g above its invert), carried down to the entrance:
      // + the bed drop S·(L − x) + full-barrel friction over the same length; then the entrance loss
      const H = D + Vf * Vf / (2 * G) + (S + SfFull) * (L - x);
      return { HW: H + Ke * Vf * Vf / (2 * G), full: true, xFullFromExit: +x.toFixed(2) };
    }
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (target(m) < 0) lo = m; else hi = m; }
    y = (lo + hi) / 2; x += dx;
  }
  const { A: a } = geom('circle', D, D, y), V = Q / a;
  return { HW: y + (1 + Ke) * V * V / (2 * G), full: false };
}

// ---- B8-R reverse flow ------------------------------------------------------------------------------------------------
{
  const S = 0.02, L = 20;
  for (const q of [1, 2, 3, 4, 5]) {
    const Q = Qof(q), inl = inletControlHW(key, 'circle', D, D, Q, -S); // the outlet end is now the inlet, on an adverse slope
    const bw = backwaterAdverse(Q, 0.013, S, L, 0.5), h = { ref: Math.max(inl.HW, bw.HW), regime: inl.regime, governs: inl.HW >= bw.HW ? 'inlet' : 'barrel' };
    const r = runSteady(swmm, { asset: pipe(), L, S, reverse: true }, Q, { holdS: 1800 }), nc = runSteady(swmm, { asset: pipe(), L, S, reverse: true, code: 0 }, Q, { holdS: 1800 });
    const fw = runSteady(swmm, { asset: pipe(), L, S: -S }, Q, { holdS: 1800 }); // the same adverse barrel drawn in the flow direction, code on its entrance
    // B1's rule: where the barrel (not inlet control) governs, the reference is the approximate one, so the wider band
    const d = r.d1 - h.ref, tol = inletBand(h.ref, h.regime === 'transition' || h.governs !== 'inlet');
    const row = { group: 'B8-R', test: 'flow entering at the outlet end', qAD: q, Q: +Q.toFixed(3), swmmHW: +r.d1.toFixed(4), hds5HW: +h.ref.toFixed(4), zone: h.regime, governs: h.governs, diff: +d.toFixed(4), tol: +tol.toFixed(3),
      backwaterHW: +bw.HW.toFixed(4), barrelReachesCrown: bw.full, codeActiveInReverse: Math.abs(r.d1 - nc.d1) > 0.005, adverseDrawnInFlowDirectionHW: +fw.d1.toFixed(4), steady: r.drift < 0.005 };
    push(row, Math.abs(d) <= tol, `B8-R reverse, Q/AD^0.5 ${q}: SWMM ${row.swmmHW} m vs reference (${row.governs} governs) ${row.hds5HW} m (${row.diff}); code active in reverse: ${row.codeActiveInReverse}`);
  }
}

// ---- B8-S silt at the inlet -------------------------------------------------------------------------------------------
{
  const s = 0.3, S = 0.02, L = 20, c = INLET[key], open = D - s;
  const cut = (y) => { const lo = geom('circle', D, D, s), hi = geom('circle', D, D, s + y); return { A: hi.A - lo.A, T: hi.T }; };
  const Aopen = cut(open).A;
  const yc = (Q) => { let lo = 1e-6, hi = open * 0.999; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2, { A: a, T } = cut(m); if (Q * Q / G - a ** 3 / Math.max(T, 1e-9) > 0) lo = m; else hi = m; } return (lo + hi) / 2; };
  const inletOpen = (Q) => { // HDS-5 form 1 / submerged on the open section (rise = open height, area = open area)
    const qq = KU * Q / (Aopen * Math.sqrt(open)), un = (QQ) => { const y = yc(QQ), a = cut(y).A; return open * ((y + (QQ / a) ** 2 / (2 * G)) / open + c.K * (KU * QQ / (Aopen * Math.sqrt(open))) ** c.M + c.Ks * S); }, sub = (QQ) => open * (c.c * (KU * QQ / (Aopen * Math.sqrt(open))) ** 2 + c.Y + c.Ks * S);
    if (qq <= 3.5) return { HW: un(Q), q: qq }; if (qq >= 4) return { HW: sub(Q), q: qq };
    const Q1 = 3.5 * Aopen * Math.sqrt(open) / KU, Q2 = 4 * Aopen * Math.sqrt(open) / KU; return { HW: un(Q1) + (sub(Q2) - un(Q1)) * (Q - Q1) / (Q2 - Q1), q: qq };
  };
  for (const q of [0.5, 1, 2, 3, 4, 5]) {
    const Q = q * Aopen * Math.sqrt(open) / KU, h = inletOpen(Q);
    const r = runSteady(swmm, { asset: pipe(), L, S, sed: s }, Q, { holdS: 1800 }), hwAboveFill = r.d1 - s, tol = Math.max(0.05, 0.05 * h.HW), d = hwAboveFill - h.HW;
    const row = { group: 'B8-S', test: 'barrel silted 0.3 m, inlet control on the open section (approximate reference)', qADopen: q, Q: +Q.toFixed(3), section: r.x.shape, code: r.x.culvert, swmmHWaboveFill: +hwAboveFill.toFixed(4), refHW: +h.HW.toFixed(4), diff: +d.toFixed(4), tol: +tol.toFixed(3), steady: r.drift < 0.005, continuityErrPct: r.mass.swmmErrorPct };
    push(row, Math.abs(d) <= tol, `B8-S silted inlet, open Q/AD^0.5 ${q}: SWMM ${row.swmmHWaboveFill} m above the fill vs open-section HDS-5 ${row.refHW} m (${row.diff})`);
  }
}

fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/b8-coverage.json', import.meta.url), JSON.stringify({ benchmark: 'B8 infrastructure coverage, SWMM alone', rows, fails }, null, 1));
console.log(`B8 infrastructure coverage, SWMM ${swmm.version} alone\n`);
for (const r of rows) { const { group, test, pass, ...rest } = r; console.log(`${group}  ${pass ? 'PASS' : 'FAIL'}  ${test}  ${JSON.stringify(rest)}`); }
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall scored checks passed');
process.exit(fails.length ? 1 : 0);
