// Score table for the coupled cases from the runs run.html saved (benchmarks/gatec/results/gatec-coupled-*.json).
// Usage: node benchmarks/gatec/coupled/score.mjs  → prints the table, writes benchmarks/gatec/coupled/score.md
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dir = new URL('../results/', import.meta.url);
const runs = readdirSync(dir).filter(f => /^gatec-coupled-.*\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(new URL(f, dir))));
const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toFixed(4));
const all = runs.flatMap(r => r.scores);
const md = ['| Case | Exchange | Measure | FloodSim | Exact | Tolerance | |', '|---|---|---|---|---|---|---|',
  ...runs.flatMap(r => r.scores.map(x => `| ${r.case} | ${r.exchange.split(' (')[0]} | ${x.what} | ${f(x.value)} | ${x.expected} | ${x.tol} | ${x.ok ? 'pass' : '**fail**'} |`)), '',
  `${all.filter(x => x.ok).length} of ${all.length} measures pass.`, ''].join('\n');
writeFileSync(new URL('./score.md', import.meta.url), md);
console.log(md);
