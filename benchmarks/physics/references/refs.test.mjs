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
