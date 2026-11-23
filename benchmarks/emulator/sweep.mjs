// How many solver runs does the emulator need? Runs validate.mjs for several training sizes and tolerances and
// collects the headline numbers: node benchmarks/emulator/sweep.mjs <runsDir> <outDir>
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [dir, out] = process.argv.slice(2), rows = [];
for (const n of [12, 24, 40, 81]) for (const tol of [0.01, 0.02, 0.03]) {
  const o = `${out}/sweep_n${n}_t${tol}`; mkdirSync(o, { recursive: true });
  const r = spawnSync(process.execPath, [new URL('./validate.mjs', import.meta.url).pathname, dir, o, '--ntrain', String(n), '--tol', String(tol)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status) { console.error(r.stderr); continue; }
  const j = JSON.parse(readFileSync(`${o}/cascade.json`, 'utf8'));
  rows.push({ n, tol, k: j.calibration.k, emuMaxMedian: j.emulatorOnly.maxAbs.median, emuMaxWorst: j.emulatorOnly.maxAbs.max, cover: j.emulatorOnly.cover.median,
    solverShare: j.cascade.solverShare, cascadeWorst: j.cascade.maxAbs.max, learnShare: j.learning.solverShare, learnFirst: j.learning.firstHalf, learnSecond: j.learning.secondHalf, learnWorst: j.learning.maxAbs.max });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(`${out}/sweep.json`, JSON.stringify(rows, null, 1));
