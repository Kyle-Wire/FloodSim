// Self-tests of the independent references. The runner calls selfTest() first and stops if any check fails.
//   node benchmarks/physics/references/refs.test.mjs
// Each check compares two independent routes to the same quantity (closed form against quadrature, bisection against
// Newton, standard step against direct step, Colebrook against Swamee–Jain, weir law against orifice strips), or a
// closed-form textbook result. Also: no reference module imports from src/ (or anything outside references/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as geo from './geometry.mjs';
import * as man from './manning.mjs';
import * as gvf from './gvf.mjs';
import * as pipe from './pipe.mjs';
import * as weir from './weir.mjs';
import * as vol from './volume.mjs';
import * as st from './street.mjs';

export function selfTest() {
  const checks = [], observations = [], check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
  const RECT = { shape: 'rect', b: 3 }, TRAP = { shape: 'trap', b: 2, z: 1.5 }, CIRC = { shape: 'circle', D: 0.9 };

  // geometry: closed form against quadrature / arc length
  for (const [s, ys] of [[RECT, [0.2, 1, 2.5]], [TRAP, [0.2, 1, 2.5]], [CIRC, [0.05, 0.3, 0.45, 0.8, 0.9]]]) for (const y of ys) {
    const a = geo.area(s, y), aq = geo.areaByQuadrature(s, y), p = geo.perimeter(s, y), pq = geo.perimeterByArcLength(s, y);
    check(`geometry ${s.shape} y ${y}: A closed form = quadrature (1e-6)`, rel(a, aq) < 1e-6, `${a} vs ${aq}`);
    check(`geometry ${s.shape} y ${y}: P closed form = arc length (1e-5)`, rel(p, pq) < 1e-5, `${p} vs ${pq}`);
  }
  check('geometry circle: full area πD²/4, full perimeter πD', rel(geo.area(CIRC, 0.9), Math.PI * 0.81 / 4) < 1e-12 && rel(geo.perimeter(CIRC, 0.9), Math.PI * 0.9) < 1e-12);

  // Manning normal depth: bisection against Newton; the root satisfies Manning
  for (const s of [RECT, TRAP]) for (const [Q, n, S] of [[0.5, 0.013, 0.001], [5, 0.013, 0.001], [5, 0.03, 0.005], [20, 0.03, 0.0005]]) {
    const yb = man.normalDepthBisect(s, Q, n, S), yn = man.normalDepthNewton(s, Q, n, S);
    check(`normal depth ${s.shape} Q ${Q} n ${n} S ${S}: bisection = Newton (1e-8 m)`, Math.abs(yb - yn) < 1e-8 && rel(man.manningQ(s, yb, n, S), Q) < 1e-8, `${yb} vs ${yn}`);
  }
  const yc = man.criticalDepth(RECT, 6), ycExact = Math.cbrt((6 / 3) ** 2 / man.G);
  check('critical depth, rectangle: Q²T = gA³ by bisection = (q²/g)^(1/3)', Math.abs(yc - ycExact) < 1e-9, `${yc} vs ${ycExact}`);
  check('Manning full pipe: h_f from the loss formula = L S where Manning full flow = Q', (() => { const D = 0.9, n = 0.013, S = 0.002, Q = man.manningQ({ shape: 'circle', D }, D, n, S); return rel(man.manningFullPipeLoss(D, Q, n, 100), 100 * S) < 1e-12; })());

  // GVF: standard step against direct step, M2 drawdown from critical depth and M1 backwater from a high control
  {
    const Q = 6, n = 0.015, S0 = 0.001, yn = man.normalDepthBisect(RECT, Q, n, S0), ycr = man.criticalDepth(RECT, Q);
    for (const [name, y0, yEnd] of [['M2', ycr * 1.001, yn * 0.999], ['M1', yn * 2, yn * 1.001]]) {
      const ds = gvf.directStep(RECT, Q, n, S0, y0, yEnd, 4000), Lx = ds.at(-1).x, ss = gvf.standardStep(RECT, Q, n, S0, y0, Lx, Lx / 4000, ycr);
      let worst = 0; for (const p of ds.filter((_, i) => i % 200 === 0)) worst = Math.max(worst, Math.abs(gvf.depthAt(ss, p.x) - p.y));
      check(`GVF ${name} (rect, Q ${Q}, n ${n}, S0 ${S0}, ${Lx.toFixed(0)} m): standard step = direct step (1 mm)`, worst < 1e-3 && !ss.some(p => Number.isNaN(p.y)), `worst ${worst.toExponential(2)} m`);
      check(`GVF ${name}: the profile tends to normal depth upstream`, Math.abs(ss.at(-1).y - yn) < 0.002 * yn, `${ss.at(-1).y} vs yn ${yn}`);
    }
  }

  // pipe friction: Colebrook iterate against Swamee–Jain (their stated ±1 %, allowed 1.5 %), and Colebrook's residual
  for (const D of [0.3, 0.9, 1.8]) for (const eps of [1e-5, 1.3e-3]) for (const Re of [1e4, 1e5, 1e6, 1e7]) {
    if (eps / D < 1e-6 || eps / D > 1e-2) continue;
    const fc = pipe.colebrook(eps, D, Re), fs = pipe.swameeJain(eps, D, Re), r = 1 / Math.sqrt(fc) + 2 * Math.log10(eps / (3.7 * D) + 2.51 / (Re * Math.sqrt(fc)));
    // Swamee–Jain is a cross-check only where PV-P1 works (Re ≥ 1e5). Below, it was found 1.8 % off Colebrook (D 0.3,
    // ε 1.3 mm, Re 1e4): reported, not checked, and the band is not widened to hide it.
    if (Re < 1e5) { observations.push({ D, eps, Re, colebrook: fc, swameeJain: fs, relDiff: (fs - fc) / fc }); check(`Colebrook residual D ${D} ε ${eps} Re ${Re} < 1e-10`, Math.abs(r) < 1e-10); continue; }
    check(`friction factor D ${D} ε ${eps} Re ${Re}: Colebrook = Swamee–Jain within 1.5 %; residual < 1e-10`, rel(fs, fc) < 0.015 && Math.abs(r) < 1e-10, `${fc.toFixed(6)} vs ${fs.toFixed(6)}`);
  }
  check('Strickler equivalence: k_s(n = 0.013) is about 1.3 mm (stated assumption)', Math.abs(pipe.ksFromManning(0.013) - 1.28e-3) < 0.05e-3, pipe.ksFromManning(0.013).toExponential(3));

  // weir law against orifice strips
  for (const H of [0.05, 0.3, 1.2]) check(`weir H ${H}: (2/3)Cd b √(2g) H^1.5 = Σ orifice strips (1e-6)`, rel(weir.weirQ(0.62, 2, H), weir.weirByStrips(0.62, 2, H)) < 1e-6);

  // volume: bounds contain the linear-surface integral; equilibrium round trip
  for (const [y1, y2] of [[0.1, 0.6], [0.45, 0.85], [0.9, 0.2]]) {
    const b = vol.conduitVolumeBounds(CIRC, 50, y1, y2), v = vol.conduitVolumeLinearSurface(CIRC, 50, y1, y2);
    check(`conduit volume, linear surface ${y1}→${y2} m: inside the end-depth bracket`, v >= b.lo - 1e-9 && v <= b.hi + 1e-9, `${b.lo.toFixed(4)} ≤ ${v.toFixed(4)} ≤ ${b.hi.toFixed(4)}`);
  }
  { const T = [{ A: 100 }, { A: 60 }], h = 0.37, V0 = 160 * h + 50 * geo.area(CIRC, h), he = vol.equilibriumDepth(T, CIRC, 50, V0);
    check('equilibrium depth: V(h) round trip (1e-9 m)', Math.abs(he - h) < 1e-9, `${he}`); }

  // street sandbox (street.mjs): closed forms against a second route
  {
    const i = 100 / 3.6e6, L = 100, n = 0.015, S0 = 0.01, tc = st.kwTc(i, L, n, S0), num = st.kwNumeric(i, L, n, S0, { nx: 800 });
    check('kinematic wave: steady depth at the foot, closed form = upwind scheme (1 %)', rel(num.depth(L - 1e-6), st.kwDepth(i, L - L / 1600, n, S0)) < 0.01, `${num.depth(L - 1e-6)} vs ${st.kwDepth(i, L, n, S0)}`);
    check('kinematic wave: time to 50 % and 90 % of steady outflow, closed form = upwind scheme (2 %)', rel(num.t50, st.kwTimeTo(0.5, tc)) < 0.02 && rel(num.t90, st.kwTimeTo(0.9, tc)) < 0.02, `${num.t50}, ${num.t90} vs ${st.kwTimeTo(0.5, tc)}, ${st.kwTimeTo(0.9, tc)}`);
    check('kinematic wave: steady storage (m/(m+1)) h_L L = quadrature of the depth profile (1e-4)', (() => { let s = 0; const N = 200000; for (let k = 0; k < N; k++) s += st.kwDepth(i, (k + 0.5) * L / N, n, S0) * L / N; return rel(s, st.kwStorage(i, L, n, S0)) < 1e-4; })());
    check('kinematic wave: Manning carries i·x at the steady depth', rel(st.kwAlpha(n, S0) * Math.pow(st.kwDepth(i, 60, n, S0), 5 / 3), i * 60) < 1e-12);
  }
  {
    const z = [0.3, -0.2, 0.05, -0.2, 0, 0.11, 0.4, -0.05], A = 2.5;
    for (const V of [0.01, 0.4, 1.7, 9]) check(`still water: level for ${V} m³, bisection = sorted beds (1e-9 m) and V(level) round trip`, Math.abs(st.levelForVolume(z, A, V) - st.levelForVolumeSorted(z, A, V)) < 1e-9 && rel(st.volumeBelow(z, A, st.levelForVolume(z, A, V)), V) < 1e-9);
    const bm = st.blockMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 4, 4, 2, [0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    check('block mean: open cells only; a block more than half building is a wall', bm[0] === 3.5 && Number.isNaN(bm[1]) && bm[2] === 11.5 && bm[3] === 13.5, Array.from(bm).join(' '));
    check('rim: head over a frictionless crest is 1.5 critical depths; Froude 1 at the crest', rel(st.rimHead(0.001), 1.5 * Math.cbrt(1e-6 / man.G)) < 1e-12 && rel(0.001 / st.criticalDepthUnit(0.001) / Math.sqrt(man.G * st.criticalDepthUnit(0.001)), 1) < 1e-12);
  }
  {
    const o = { L: 20, K: st.pipeK(0.15, 0.013), Co: 0.6, A: 0.2, Cw: 0.5, P: 2 }, Q = 0.02222;
    check('pipe conveyance: K √S = Manning full flow (1e-12)', rel(st.pipeK(0.15, 0.013) * Math.sqrt(0.005), man.manningQ({ shape: 'circle', D: 0.15 }, 0.15, 0.013, 0.005)) < 1e-12);
    check('one inlet, one pipe: level for Q, closed form = bisection on the rating (1e-9 m)', Math.abs(st.sagLevelClosed(Q, -0.227, o) - st.sagLevelFor(Q, 0, -0.227, o)) < 1e-9, `${st.sagLevelClosed(Q, -0.227, o)} vs ${st.sagLevelFor(Q, 0, -0.227, o)}`);
    check('one inlet, one pipe: pipe loss in the closed form = manningFullPipeLoss', rel(st.sagLevelClosed(Q, 0, { ...o, Co: 1e9 }), man.manningFullPipeLoss(0.15, Q, 0.013, 20)) < 1e-9);
    const hist = st.sagHistory({ inflow: () => Q, stage: (V) => V / 30, zs: 0, Hout: -0.227, o, tEnd: 40000, every: 40000 });
    check('one inlet, one pipe: the pond history settles at the level that carries the inflow (1e-4 m)', Math.abs(hist.at(-1).eta - st.sagLevelClosed(Q, -0.227, o)) < 1e-4, `${hist.at(-1).eta}`);
    { const up = st.sagHistory({ inflow: () => 0, stage: (V) => V / 30, zs: 0, Hout: 0.15, o, tEnd: 20000, every: 20000 });
      check('one inlet, one pipe: an outlet held above a dry street fills it to the outlet level (1e-4 m)', Math.abs(up.at(-1).eta - 0.15) < 1e-4 && rel(st.sagSubmergedQ(0, 0.15, o), -st.sagSubmergedQ(0.15, 0, o)) < 1e-12, String(up.at(-1).eta)); }
    check('free inlet: weir below the crossover depth, orifice above', st.inletFree(0.02, o) === o.Cw * o.P * 0.02 ** 1.5 * Math.sqrt(2 * man.G) && st.inletFree(0.5, o) === o.Co * o.A * Math.sqrt(2 * man.G * 0.5));
  }
  {
    // two pipes in series to an outlet held at the crown: the HGL adds each pipe's full-flow loss
    const nodes = [{ ground: 2 }, { ground: 1.9 }, { ground: 0 }], P = (from, to, invUp, invDn, Q) => ({ from, to, L: 50, D: 0.3, n: 0.013, invUp, invDn, Q });
    const pipes = [P(0, 1, 0.5, 0.25, 0.08), P(1, 2, 0.25, 0, 0.12)], r = st.hglTree(nodes, pipes, new Map([[2, 0.3]]));
    const h1 = 0.3 + man.manningFullPipeLoss(0.3, 0.12, 0.013, 50), h0 = h1 + man.manningFullPipeLoss(0.3, 0.08, 0.013, 50);
    check('HGL: two full pipes in series = the sum of their Manning losses (1e-12 m)', Math.abs(r.hgl[1] - h1) < 1e-12 && Math.abs(r.hgl[0] - h0) < 1e-12, `${r.hgl[0]} vs ${h0}`);
    const f = st.hglCapacityFactor(nodes, pipes, new Map([[2, 0.3]])), at = st.hglTree(nodes, pipes.map(p => ({ ...p, Q: p.Q * f })), new Map([[2, 0.3]]));
    check('HGL capacity factor: at the factor the highest HGL is at the ground (1e-6 m)', Math.abs(Math.max(...at.over)) < 1e-6, `${f} → ${Math.max(...at.over)}`);
    check('HGL: a part-full pipe below a free outlet stands at normal depth', (() => { const q = [P(0, 1, 0.5, 0.25, 0.01)], rr = st.hglTree(nodes, q, new Map([[1, null]])); return Math.abs(rr.hgl[0] - 0.5 - man.normalDepthBisect({ shape: 'circle', D: 0.3 }, 0.01, 0.013, 0.005)) < 1e-9; })());
    check('rational method: 1 ha at C·i = 36 mm/h is 0.1 m³/s', rel(st.rationalQ(1e4, 36), 0.1) < 1e-12);
  }
  {
    // wall rule: a 12 × 8 grid, building on columns 4–7 of rows 2–5, the street along row 7
    const nx = 12, ny = 8, N = nx * ny, bld = new Uint8Array(N), road = new Uint8Array(N), fp = new Uint8Array(N), depth = new Float64Array(N), wse = new Float64Array(N);
    for (let j = 2; j < 6; j++) for (let i = 4; i < 8; i++) { bld[j * nx + i] = 1; fp[j * nx + i] = 1; }
    for (let i = 0; i < nx; i++) road[7 * nx + i] = 1;
    const put = (i, j, d) => { depth[j * nx + i] = d; wse[j * nx + i] = 10 + d; }, ex = () => st.wallExposure({ depth, wse, bld, road, fp, nx, ny, dx: 1 });
    put(5, 6, 0.15); put(5, 7, 0.15);
    const a = ex(); put(5, 7, 0);
    const b = ex(); put(5, 6, 0); put(0, 7, 0.3); put(1, 7, 0.3);
    const c = ex();
    check('wall rule: water at the wall joined to street water counts; cut off from the street it does not; water 3 m away does not', a.counts && Math.abs(a.level - 10.15) < 1e-12 && !b.counts && !c.counts, JSON.stringify([a, b, c]));
  }

  {
    // HEC-22 gutter and grate; a storage measure
    const n = 0.016, Sx = 0.02, SL = 0.02, Q = 0.0167, T = st.gutterSpread(Q, n, Sx, SL), g = st.grateEfficiency(Q, n, Sx, SL, 0.6, 0.9);
    check('gutter: HEC-22 spread carries the flow Manning gives strip by strip (1.5 %: the manual rounds 5/3, 8/3 and 3/8)', rel(st.gutterFlowByStrips(T, n, Sx, SL), Q) < 0.015, `${st.gutterFlowByStrips(T, n, Sx, SL)} vs ${Q}`);
    check('grate: the frontal share is the strip flow over the grate\'s width (0.5 %)', rel(1 - st.gutterFlowByStrips(T - 0.6, n, Sx, SL) / st.gutterFlowByStrips(T, n, Sx, SL), g.Eo) < 0.005, String(g.Eo));
    check('grate: efficiency between its frontal share and 1; side interception falls to nil with the cross slope', g.E > g.Eo && g.E < 1 && st.grateEfficiency(Q, n, 0.001, SL, 0.6, 0.9).Rs < g.Rs && st.grateEfficiency(Q, n, 1e-9, SL, 0.6, 0.9).Rs < 0.02, `${g.Rs}, ${st.grateEfficiency(Q, n, 1e-9, SL, 0.6, 0.9).Rs}`);
    check('kerb cell: mean depth over the first metre of a triangle = quadrature (1e-9)', (() => { let s = 0; const N = 100000; for (let k = 0; k < N; k++) s += Math.max(0, Sx * (T - (k + 0.5) / N)) / N; return Math.abs(s - st.kerbCellDepth(T, Sx)) < 1e-9; })());
    for (const [rate, cap, drain, Tt] of [[100 / 3.6e6, 0.3, 2 / 3.6e6, 21600], [1000 / 3.6e6, 0.2, 2 / 3.6e6, 7200], [100 / 3.6e6, 0.3, 2 / 3.6e6, 3600]])
      check(`storage measure: intake by ${Tt} s, closed form = stepped store (0.1 %)`, rel(st.storeIntakeStepped(rate, cap, drain, Tt), st.storeIntake(rate, cap, drain, Tt).intake) < 1e-3, `${st.storeIntakeStepped(rate, cap, drain, Tt)} vs ${st.storeIntake(rate, cap, drain, Tt).intake}`);
  }

  // independence: no reference imports from outside references/
  const dir = path.dirname(fileURLToPath(import.meta.url)), bad = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs'))) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g))
    if (!/^\.\/[\w.-]+\.mjs$/.test(m[1]) && !/^node:(fs|path|url)$/.test(m[1])) bad.push(`${f}: ${m[1]}`);
  check('independence: no reference module imports src/ or anything outside references/', bad.length === 0, bad.join(', '));

  return { ok: checks.every(c => c.ok), checks, observations };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = selfTest();
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.ok ? '  ' + c.detail : ''}`);
  for (const o of r.observations) console.log(`NOTE  Swamee–Jain outside its checked range: D ${o.D} ε ${o.eps} Re ${o.Re}: ${(o.relDiff * 100).toFixed(2)} % from Colebrook`);
  console.log(r.ok ? `\nall ${r.checks.length} reference self-tests passed` : `\n${r.checks.filter(c => !c.ok).length} FAILED`);
  process.exit(r.ok ? 0 : 1);
}
