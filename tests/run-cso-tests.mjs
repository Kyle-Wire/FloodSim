// Combined-sewer tests (src/cso.js, the .inp sections in src/drainage.js, run in the SWMM WebAssembly engine):
// dry-weather flow equals its pattern's integral, a regulator sends the interceptor no more than its capacity and the
// rest over the weir, a flap gate keeps a high tide out of the pipes, overflow events split on the dry-period rule,
// people per manhole follow the land cover, and the pipe solver settings (Drainage) reach the .inp and keep the books.
// Usage: node tests/run-cso-tests.mjs  (needs vendor/swmm-wasm, `npm run build:swmm`)
import { loadSWMM, SWMM } from '../src/swmm.js';
import { toINP, DESIGN_DEFAULTS } from '../src/drainage.js';
import { DIURNAL, PEAK_FACTOR, rotated, dwfVolume, setDWF, addRegulators, overflowEvents, populationPerNode, csoBooks } from '../src/cso.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const fine = { x0: 0, y1: 0, dx: 1 };
const swmm = await loadSWMM();

/** A straight line of manholes 50 m apart down a 1 % slope to an outfall to a stream. */
function line(n = 3, D = 0.6) {
  const nodes = [], pipes = [];
  for (let i = 0; i <= n; i++) nodes.push({ name: (i === n ? 'O' : 'J') + i, p: [50 * i, 0], ground: 10 - 0.5 * i, invert: 8 - 0.5 * i, depth: 2, outfall: i === n, toStream: i === n, inletFine: [] });
  for (let i = 0; i < n; i++) pipes.push({ name: 'C' + i, from: i, to: i + 1, L: 50, D, S: 0.01, Q: 0, inOffset: 0, outOffset: 0 });
  return { nodes, pipes, inlets: [], opts: { ...DESIGN_DEFAULTS } };
}
/** Run a model for T s with lateral inflow q(t) at node `at`, calling each(t) every stride. → finished report text */
function drive(inp, T, { at = null, q = () => 0, each = null, stage = null } = {}) {
  swmm.open(inp);
  const ai = at ? swmm.index('NODE', at) : -1;
  if (stage) swmm.setOutfallStage(swmm.index('NODE', stage.node), stage.z);
  for (let t = 0; t < T - 1e-6;) {
    if (ai >= 0) swmm.setLatFlow(ai, q(t)); if (stage) swmm.setOutfallStage(swmm.index('NODE', stage.node), stage.z);
    const t1 = swmm.stride(30); if (t1 <= t) break; // the end of the simulation reads 0
    t = t1; each?.(t);
  }
  return swmm.finish();
}

{ // the pattern: mean 1, a morning peak; rotation and the volume integral
  const mean = DIURNAL.reduce((a, b) => a + b, 0) / 24;
  check('diurnal pattern: mean 1, peak factor 1.4–1.5', Math.abs(mean - 1) < 1e-12 && PEAK_FACTOR > 1.4 && PEAK_FACTOR < 1.5, `peak ${PEAK_FACTOR.toFixed(3)}`);
  check('pattern rotated to the local start hour', rotated(7)[0] === DIURNAL[7] && rotated(-1)[0] === DIURNAL[23]);
  check('a whole day of dry-weather flow is base × 86 400 s', Math.abs(dwfVolume(0.003, 86400, 5) - 0.003 * 86400) < 1e-9);
}

{ // dry-weather flow in SWMM: the volume SWMM books is the pattern's integral, from a local start hour
  for (const [T, h] of [[86400, 0], [6 * 3600, 7]]) {
    // SWMM's report gives volumes to 0.001 ML (1 m³): flows large enough for that to be under 0.1 %
    const net = line(); net.nodes[0].dwf = 0.2; net.nodes[1].dwf = 0.1; net.dwfOn = true; net.dwfStartHour = h;
    const rpt = drive(toINP(net, fine, { durationS: T, routingStep: 5 }), T), c = SWMM.continuity(rpt), want = dwfVolume(0.3, T, h);
    check(`DWF volume = the pattern integral (${T / 3600} h from ${h}:00)`, Math.abs(c.dryWeatherInflow * 1000 - want) / want < 0.005 && Math.abs(c.errorPct) < 1,
      `SWMM ${(c.dryWeatherInflow * 1000).toFixed(1)} m³, pattern ${want.toFixed(1)} m³, continuity ${c.errorPct} %`);
    if (h === 7) check('pipes start with the dry-weather flow in them', c.initialStored > 0, `initial stored ${(c.initialStored * 1000).toFixed(2)} m³`);
  }
}

{ // regulator: the interceptor takes up to its capacity, the weir the rest
  const net = line(2); net.nodes[0].dwf = 0.01; // capacity from the dry-weather flow (not injected here)
  const regs = addRegulators(net, { capacity: 3, gates: false }), g = regs[0];
  check('regulator built: outfall → junction, overflow and interceptor outfalls', regs.length === 1 && !net.nodes[g.regulator].outfall && net.nodes[g.overflow].cso && net.nodes[g.interceptor].interceptor,
    `capacity ${(g.qcap * 1000).toFixed(1)} L/s = 3 × ${PEAK_FACTOR.toFixed(2)} × ${(g.dwf * 1000).toFixed(0)} L/s`);
  const inp = toINP(net, fine, { durationS: 7200 });
  for (const Q of [0.2, 0.5 * g.qcap]) {
    let qi = 0, qo = 0;
    drive(inp, 7200, { at: 'J0', q: () => Q, each: () => { qi = swmm.node('INFLOW', swmm.index('NODE', net.nodes[g.interceptor].name)); qo = swmm.node('INFLOW', swmm.index('NODE', net.nodes[g.overflow].name)); } });
    if (Q > g.qcap) check('storm flow: the interceptor runs at its capacity, the rest overflows', Math.abs(qi - g.qcap) / g.qcap < 0.03 && Math.abs(qo - (Q - g.qcap)) / Q < 0.03, `interceptor ${(qi * 1000).toFixed(1)} L/s (cap ${(g.qcap * 1000).toFixed(1)}), overflow ${(qo * 1000).toFixed(1)} L/s of ${(Q * 1000).toFixed(0)}`);
    else check('below capacity: everything to the interceptor, no overflow', Math.abs(qi - Q) / Q < 0.02 && qo < 1e-4, `interceptor ${(qi * 1000).toFixed(2)} L/s of ${(Q * 1000).toFixed(2)}, overflow ${(qo * 1000).toFixed(3)} L/s`);
  }
}

{ // flap gate: a tide 1.5 m above the outfall invert, no flow in the pipes
  const depth = {};
  for (const gated of [false, true]) {
    const net = line(2); net.nodes[2].gated = gated;
    let d = 0; drive(toINP(net, fine, { durationS: 3600 }), 3600, { stage: { node: 'O2', z: net.nodes[2].invert + 1.5 }, each: () => { d = swmm.node('DEPTH', swmm.index('NODE', 'J1')); } });
    depth[gated] = d;
  }
  check('flap gate keeps a high tide out of the pipes', depth[false] > 0.5 && depth[true] < 0.01, `last manhole depth: ungated ${depth[false].toFixed(2)} m, gated ${depth[true].toFixed(3)} m`);
}

{ // events: overflow 1 h, dry 2 h, overflow 1 h (one event under the 6 h rule), dry 8 h, overflow 1 h (a second)
  const s = []; for (let t = 0; t <= 14 * 3600; t += 600) { const h = t / 3600; s.push([t, (h >= 0 && h < 1) || (h >= 3 && h < 4) || (h >= 12 && h < 13) ? 0.05 : 0]); }
  const ev = overflowEvents(s, { interEventH: 6 }), v = ev.reduce((a, e) => a + e.volume, 0);
  check('events split on the 6 h dry-period rule', ev.length === 2 && ev[0].start === 0 && ev[1].start >= 11.8 * 3600, ev.map(e => `${(e.start / 3600).toFixed(1)}–${(e.end / 3600).toFixed(1)} h`).join(', '));
  check('event volume by the trapezoid rule', Math.abs(v - 0.05 * 600 * 17.5) < 1e-9, `${v.toFixed(0)} m³`);
  check('a 1 h dry rule splits the first two', overflowEvents(s, { interEventH: 1 }).length === 3);
  const books = csoBooks([{ name: 'X', overflow: 1, interceptor: 2, qcap: 0.1, dwf: 0.01, crest: 0.2 }], { outfalls: [1, 2], series: s.map(([t, q]) => [t, q, 0.1]), outVol: [0, 540, 5040] }, { T: 14 * 3600, startHour: 0 });
  const dw = dwfVolume(0.01, 14 * 3600, 0);
  check('capture: interceptor over interceptor + overflow, wet weather without the dry-weather volume', Math.abs(books.totals.capture - 5040 / 5580) < 1e-12 && Math.abs(books.totals.wetCapture - (5040 - dw) / (5040 - dw + 540)) < 1e-12 && books.totals.events === 2,
    `${(books.totals.capture * 100).toFixed(1)} %, wet weather ${(books.totals.wetCapture * 100).toFixed(1)} %`);
}

{ // people per manhole: 100 m × 100 m of medium-intensity development (60 / ha) and 100 m of open water, one manhole
  const nx = 200, ny = 100, cls = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cls[j * nx + i] = i < 100 ? 23 : 11;
  const net = { nodes: [{ name: 'J0', p: [50, 50] }, { name: 'O1', p: [199, 50], outfall: true }], pipes: [] };
  const pop = populationPerNode({ nx, ny, dx: 1 }, { cls }, net, { rmax: 400 });
  check('people per manhole from the land cover it serves', Math.abs(pop[0] - 60) < 1e-6 && pop[1] === 0, `${pop[0].toFixed(1)} people`);
  check('dry-weather flow from people × L/person/day', Math.abs(setDWF(net, pop, { perCapita: 300 }) - 60 * 0.3 / 86400) < 1e-15);
}

{ // the report section from the books on a run record
  const { csoSection } = await import('../app/report-cso.js');
  const s = []; for (let t = 0; t <= 7200; t += 600) s.push([t, t >= 1800 && t <= 3600 ? 0.2 : 0, 0.05]);
  const books = csoBooks([{ name: '12', overflow: 1, interceptor: 2, qcap: 0.05, dwf: 0.01, crest: 0.2 }], { outfalls: [1, 2], series: s, outVol: [0, 420, 360] }, { T: 7200 });
  const rec = { cso: { ...books, people: 3000, startHour: 6, settings: { perCapita: 300, capacity: 3, density: 'by land cover', dwf: true, gates: true } } };
  const u = { q: 'm³/s', Q: v => v, vol: 'm³', V: v => v, dpQ: 3 };
  const sec = csoSection({ runs: [['after', rec]], A: null, theme: 'light', size: {}, u, tag: () => 'Run' });
  check('report section: overflow figures and tables', sec?.id === 'cso' && sec.figures.length === 2 && sec.figures.every(f => f.svg.startsWith('<svg')) && sec.tables[0].rows[0].events === 1 && Math.abs(sec.tables[1].rows[0].capture - 100 * 360 / 780) < 1e-9,
    `${sec?.figures.length} figures, ${sec?.tables.map(t => t.rows.length).join(' + ')} rows`);
  check('report section: none without combined-sewer books', csoSection({ runs: [['after', {}]], A: null, theme: 'light', size: {}, u, tag: () => 'Run' }) === null);
}

{ // Drainage → Pipe solver settings: toINP's routing options (the defaults unchanged), and each preset runs in SWMM
  const opt = (inp) => inp.split('[OPTIONS]')[1].split('\n[')[0];
  const base = opt(toINP(line(), fine));
  check('pipe solver defaults write the same options as before',
    ['ROUTING_STEP 1', 'VARIABLE_STEP 0.75', 'LENGTHENING_STEP 1', 'MIN_SURFAREA 1.2', 'NORMAL_FLOW_LIMITED BOTH', 'INERTIAL_DAMPING PARTIAL', 'SURCHARGE_METHOD SLOT', 'MIN_SLOPE 0', 'MAX_TRIALS 8', 'HEAD_TOLERANCE 0.0015'].every(l => base.includes('\n' + l + '\n')));
  const set = opt(toINP(line(), fine, { routing: { routingStep: 0.5, variableStep: 0.5, lengthen: false, minSurfArea: 2.5, headTol: 0.0005, maxTrials: 20, minSlope: 0.1, surcharge: 'EXTRAN', inertialDamping: 'FULL', normalFlowLimited: 'SLOPE' } }));
  check('pipe solver settings reach the .inp',
    ['ROUTING_STEP 0.5', 'VARIABLE_STEP 0.5', 'LENGTHENING_STEP 0', 'MIN_SURFAREA 2.5', 'NORMAL_FLOW_LIMITED SLOPE', 'INERTIAL_DAMPING FULL', 'SURCHARGE_METHOD EXTRAN', 'MIN_SLOPE 0.1', 'MAX_TRIALS 20', 'HEAD_TOLERANCE 0.0005'].every(l => set.includes('\n' + l + '\n')));
  const throws = (r) => { try { toINP(line(), fine, { routing: r }); return false; } catch { return true; } };
  check('a bad method or a zero step is refused', throws({ surcharge: 'SLOTS' }) && throws({ routingStep: 0 }) && throws({ headTol: NaN }) && !throws({ variableStep: 0 }));
  const T = 3600, q = (t) => t < 600 ? 0.5 * t / 600 : t < 1200 ? 0.5 * (1200 - t) / 600 : 0, vin = 0.5 * 1200 / 2;
  for (const [name, routing] of [['Balanced', {}], ['More accurate', { routingStep: 0.5, variableStep: 0.5, headTol: 0.0005, maxTrials: 20 }],
    ['Faster', { routingStep: 2, headTol: 0.005, maxTrials: 4 }], ['EXTRAN, full damping, no lengthening', { surcharge: 'EXTRAN', inertialDamping: 'FULL', lengthen: false }]]) {
    const c = SWMM.continuity(drive(toINP(line(3, 0.45), fine, { durationS: T, routing }), T, { at: 'J0', q }));
    const out = (c.externalOutflow + c.flooding + c.finalStored) * 1000;
    check(`pipe solver "${name}": the water is all accounted for`, Math.abs(c.errorPct) < 1 && Math.abs(out - vin) / vin < 0.02, `continuity ${c.errorPct} %, out + flooded + stored ${out.toFixed(1)} of ${vin} m³`);
  }
}

swmm.dispose();
console.log(fails ? `\n${fails} FAILED` : '\nall combined-sewer tests passed');
process.exit(fails ? 1 : 0);
