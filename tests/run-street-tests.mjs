// The street sandbox (benchmarks/physics/street/): every registered case still builds with the app's own pieces
// (coarsening, roof routing, subgrid tables, the synthetic network, the .inp writer, the design storm), and the hand
// answers the specs were registered with have not moved. No solver runs here.
// Usage: node tests/run-street-tests.mjs
import { buildCase, caseIds } from '../benchmarks/physics/street/cases.mjs';
import { loadSpecs } from '../benchmarks/physics/street/exec-cpu.mjs';
import { run } from '../benchmarks/physics/street/score.mjs';
import * as st from '../benchmarks/physics/references/street.mjs';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const specs = loadSpecs(), ids = caseIds(specs), near = (a, b, tol) => Math.abs(a - b) <= tol;

let built = 0; const bad = [];
for (const id of ids) { try { const d = buildCase(id, specs); if (!(d.c.nx > 0 && d.probes.every(p => p.cells.length > 0))) bad.push(id + ': empty probe'); built++; } catch (e) { bad.push(`${id}: ${e.message}`); } }
check(`all ${ids.length} sandbox cases build, each probe on at least one solver cell`, built === ids.length && !bad.length, bad.join('; '));

const net = buildCase('SS3-d', specs).coupled.net;
check('the bowl neighbourhood gets the app\'s synthetic network: 3 grates, pipes of 0.3 and 0.375 m, two off-site outlets', net.stats.grates === 3 && net.stats.minD === 0.3 && net.stats.maxD === 0.375 && net.stats.offsiteOutlets === 2, JSON.stringify(net.stats));
const yard = buildCase('SS6-yard-2', specs).c, pass = [3 * yard.nx + 3, 4 * yard.nx + 3];
// findings are reported, not asserted: a fix in src/ must not fail this suite
console.log(`NOTE  finding F12: at 2 m the rear yard's 1 m passage is ${pass.every(k => yard.mask[k] === 0) ? 'closed' : 'open'} after coarsening`);

// hand answers as registered (benchmarks/physics/street/score.mjs --expect on 17 Nov 2026)
const i = 100 / 3.6e6;
check('PV-SS1: time of concentration 337.4 s, depth at 75.5 m 7.92 mm', near(st.kwTc(i, 100, 0.015, 0.01), 337.42, 0.01) && near(st.kwDepth(i, 75.5, 0.015, 0.01), 0.0079185, 1e-7));
const o = { L: 20, K: st.pipeK(0.15, 0.013), Co: 0.6, A: 0.2, Cw: 0.5, P: 2 };
check('PV-SS3: the pond that carries 22.2 l/s to an outlet held 0.227 m below the sag stands at 0.2006 m', near(st.sagLevelClosed(200 / 3.6e6 * 400, -0.227, o), 0.20058, 1e-5));
check('PV-SS2: the rim head at 80 mm/h over 400 m² and a 10 m rim is 6.5 mm', near(st.rimHead(80 / 3.6e6 * 400 / 10), 0.00648, 1e-5));
const r7 = await run(JSON.parse(JSON.stringify(specs['PV-SS7'])), specs);
check('PV-SS7: the rule as written agrees with every hand answer in the spec; src/damage.js agrees on all twelve cases', r7.rows.every(x => x.status === 'Passed'), `${r7.rows.filter(x => x.status === 'Passed').length} of ${r7.rows.length} rows pass`);
console.log(`NOTE  finding F20: at 2 m cells the wall rule ${r7.rows.filter(x => /^R12 /.test(x.case)).every(x => x.status === 'Passed') ? 'reaches 2 m' : 'reaches 4 m, not 2 m'}`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
