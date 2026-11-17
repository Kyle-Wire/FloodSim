// Street sandbox report: the latest scored result of each PV-SS spec (benchmarks/physics/results/<run-id>/) as
// Markdown tables: every row with its expected and measured value, the counts by status, and what has not run.
//   node benchmarks/physics/street/report.mjs            → street/RESULTS.md (rewritten each time; the results it reads are immutable)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), resDir = path.join(here, '../results'), specDir = path.join(here, '../spec');
const fmt = (v) => (v == null ? '–' : typeof v !== 'number' ? String(v) : v === 0 ? '0' : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : Math.abs(v) >= 0.001 ? v.toFixed(4) : v.toExponential(1));
const L = ['# Street sandbox: scored results', '',
  'Written by `report.mjs` from the latest scored run of each spec. Statuses are never merged into one percentage. `cpu` rows are the CPU surface solver (fp64), `gpu` rows the production GPU solver in the browser.', ''];
const summary = [];
for (let k = 1; k <= 10; k++) {
  const id = `PV-SS${k}`, spec = JSON.parse(fs.readFileSync(path.join(specDir, id + '.json')));
  const run = fs.readdirSync(resDir).sort().reverse().find(d => fs.existsSync(path.join(resDir, d, id + '.json')));
  L.push(`## ${id}  ${spec.title}`, '');
  if (!run) { L.push('Not yet run.', ''); summary.push([id, spec.title, {}, 'all']); continue; }
  const r = JSON.parse(fs.readFileSync(path.join(resDir, run, id + '.json'))), by = {};
  for (const x of r.rows) by[x.status] = (by[x.status] ?? 0) + 1;
  L.push(`Run \`results/${run}/\`. ${Object.entries(by).map(([s, n]) => `${n} ${s}`).join(', ') || 'no rows'}.${r.notRun?.length ? ` Not yet run: ${r.notRun.join(', ')}.` : ''}`, '',
    '| Case | Quantity | Expected | Measured | Limit | Status |', '|---|---|---|---|---|---|');
  for (const x of r.rows) L.push(`| ${x.case} | ${x.quantity}${x.note ? ` (${x.note})` : ''} | ${fmt(x.ref)} | ${fmt(x.sim)} | ${x.limit != null ? '± ' + fmt(x.limit) : '–'} | ${x.status === 'Passed' ? 'Passed' : `**${x.status}**`} |`);
  L.push('');
  summary.push([id, spec.title, by, r.notRun ?? []]);
}
L.splice(4, 0, '| Spec | What | Passed | Failed | Other | Not yet run |', '|---|---|---|---|---|---|',
  ...summary.map(([id, title, by, nr]) => `| ${id} | ${title} | ${by.Passed ?? 0} | ${by.Failed ?? 0} | ${Object.entries(by).filter(([s]) => s !== 'Passed' && s !== 'Failed').map(([s, n]) => `${n} ${s}`).join(', ') || '–'} | ${nr === 'all' ? 'all' : nr.length ? nr.length + ' case-executor pairs' : '–'} |`), '');
fs.writeFileSync(path.join(here, 'RESULTS.md'), L.join('\n'));
console.log(L.slice(4, 4 + summary.length + 2).join('\n'));
