// The backyard study plan and a pool that runs it with the CPU solver: node study.mjs <outDir> [jobs]
// Points: FloodSim's own training plan for 8 parameters (80-point maximin Latin hypercube + centre + 3 held out),
// plus 40 uniform random test points (seed 4242) for the cascade, and 12 'as-is' twins of the first test points.
import { existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as E from '../../src/emulator.js';
import { PARAMS } from './backyard.mjs';
export function plan() {
  const d = PARAMS.length, pts = E.trainingPlan(d, { seed: 1 });
  const r = E.rng(4242); for (let i = 0; i < 40; i++) pts.push({ id: 'x' + i, u: Array.from({ length: d }, () => r()), role: 'test' });
  // pairs: the first 12 test points with every homeowner fix taken out (the house as it is), so the change a fix makes
  // can be checked against the solver's own paired runs
  const fixes = PARAMS.map((p, k) => (p.who === 'you' ? k : -1)).filter(k => k >= 0);
  for (let i = 0; i < 12; i++) { const u = pts.find(p => p.id === 'x' + i).u.slice(); for (const k of fixes) u[k] = 0; pts.push({ id: 'p' + i, u, role: 'pair', of: 'x' + i }); }
  return pts;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2], jobs = +(process.argv[3] ?? 4), todo = plan().filter(p => !existsSync(`${out}/${p.id}.json`));
  writeFileSync(`${out}/plan.json`, JSON.stringify(plan()));
  console.log(todo.length, 'runs to do');
  let next = 0, live = 0;
  const go = () => { while (live < jobs && next < todo.length) { const p = todo[next++]; live++;
    const c = spawn(process.execPath, [new URL('./run-one.mjs', import.meta.url).pathname, out, p.id, p.u.join(',')], { stdio: ['ignore', 'inherit', 'inherit'] });
    c.on('exit', () => { live--; go(); }); } };
  go();
}
