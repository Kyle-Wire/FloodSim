// The validation and calibration tools' shared scoring (tools/suite.mjs): the level errors a run's summary holds, marks
// skipped under decks or indoors left out, gauges' peaks in; and the calibration page with and without validation storms.
// Usage: node tests/run-suite-tests.mjs
import { levelErrors } from '../tools/suite.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{
  const sm = { validation: {
    hwm: { points: [{ name: 'A', kind: 'level', error: 0.3 }, { name: 'B', kind: 'level', error: -0.1 }, { name: 'C', kind: 'level', error: 2, skip: 'under a deck' }, { name: 'D', kind: 'flooded' }] },
    gauges: [{ site: '0214643820', score: { error: -1.2 } }, { site: 'X', score: null }] } };
  const e = levelErrors(sm);
  check('level errors: scored marks and gauge peaks, skipped marks and unscored gauges left out', e.n === 3 && e.errors.map(x => x.id).join() === 'A,B,0214643820', e.errors.map(x => x.id).join());
  check('RMS and bias over them', Math.abs(e.rms - Math.sqrt((0.09 + 0.01 + 1.44) / 3)) < 1e-12 && Math.abs(e.bias - (-1 / 3)) < 1e-12, `${e.rms.toFixed(3)}, ${e.bias.toFixed(3)}`);
  check('a run with nothing to score', levelErrors({}).n === 0 && levelErrors(null).rms === null);
}

// the page, from a calibration.json in a scratch copy of the suite folder (calibrate.mjs --page writes beside it)
{
  const dir = mkdtempSync(join(tmpdir(), 'fs-cal-')), root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  for (const d of ['tools', 'src']) cpSync(join(root, d), join(dir, d), { recursive: true });
  mkdirSync(join(dir, 'benchmarks', 'validation'), { recursive: true }); writeFileSync(join(dir, 'benchmarks', 'validation', 'cases.json'), '[]');
  const st = (validation) => ({ created: '2026-11-05T00:00:00Z', commit: 'abc1234', case: 'c', title: 'Case C', set: { histSrc: 'radarFit' }, vary: { calInfil: ['0.5', '1'] }, target: 0.15,
    points: [{ inputs: { calInfil: '0.5' }, run: 'r1', n: 2, rms: 0.4, bias: -0.3 }, { inputs: { calInfil: '1' }, run: 'r2', n: 2, rms: 0.9, bias: -0.8 }], kept: { calInfil: '0.5' },
    calibration: { n: 2, rms: 0.4, bias: -0.3, run: 'r1' }, validation });
  writeFileSync(join(dir, 'benchmarks', 'validation', 'calibration.json'), JSON.stringify([st([]), st([{ case: 'v', title: 'Storm V', asSet: { n: 1, rms: 0.6, bias: -0.6 }, calibrated: { n: 1, rms: 0.1, bias: -0.1 } }])]));
  const r = spawnSync(process.execPath, [join(dir, 'tools', 'calibrate.mjs'), '--page'], { encoding: 'utf8' });
  const md = r.status === 0 ? readFileSync(join(dir, 'benchmarks', 'validation', 'CALIBRATION.md'), 'utf8') : '';
  check('the page: values kept marked, a study with no other storm called a fit', r.status === 0 && /infiltration × 0\.5 \*\*\(kept\)\*\*/.test(md) && /a fit, not a calibration/.test(md), r.stderr.trim().slice(0, 200));
  check('a storm it never saw: within the target, and the tuning carried over', /\| Storm V \| 0\.60 \/ −0\.60 \(1\) \| 0\.10 \/ −0\.10 \(1\) \| meets; the tuning carried over \|/.test(md));
}

console.log(fails ? `\n${fails} FAILED` : '\nall suite tests passed');
process.exit(fails ? 1 : 0);
