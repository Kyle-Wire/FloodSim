// Calibration the way a reviewer expects it: tune on one observed storm, freeze, and score other storms the tuning never
// saw. FEMA's hydraulics guidance asks that roughness and loss parameters be checked against historic floods; the
// usual bar for a mapping model is levels within 0.5 ft (0.15 m) of the marks. A model tuned and scored on the same
// storm proves little, so the split matters as much as the number.
//
//   1. the calibration case's project is copied (with `--set` inputs, e.g. the rain source) to "<project> (calibration)",
//      so the sweep never mixes with the suite's own runs; every combination of the `--vary` values runs there headless
//   2. each run is scored by every level error its summary holds: the high-water marks scored and each gauge's peak
//      (tools/suite.mjs levelErrors), as RMS and bias; and, where the case draws a control line at a gauge, by the
//      flow there over the whole storm against the gauge's discharge (tools/suite.mjs flowScores: Kling–Gupta,
//      Nash–Sutcliffe, volume, peak). The objective picks the combination kept: the smallest level RMS
//      (--objective level, the default) or the highest flow KGE (--objective flow)
//   3. each `--validate` case is copied the same way and run twice: as set, and with the kept values frozen; both scored
//   4. the study goes in benchmarks/validation/calibration.json, and benchmarks/validation/CALIBRATION.md is rewritten:
//      the sweep, the values kept, and the validation storms against the target, as set and calibrated
// Studies carry on where they stopped (tools/suite.mjs runStudy), so the tool can be run again after a crash.
//
// Usage: node tools/calibrate.mjs --case <id> --vary calInfil=0.25,0.5,1 [--vary calManning=0.8,1,1.2]
//          [--validate <id>,<id>] [--set histSrc=radarFit] [--target 0.15] [--objective level|flow] [--url http://localhost:8766]
//          [--headed] [--note "text"]
//   --headed show the app's window while the study runs (tools/batch.mjs --headed)
//        node tools/calibrate.mjs --page    (rewrite CALIBRATION.md from calibration.json only)
//   --vary   an input id from the app's Calibration section (calManning, calInfil, calClog) and its values
//   --set    an input id and value for every run of the study (the cases' own projects are not changed)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { codeState } from './codestate.mjs';
import { root, here, loadCases, deriveProject, runStudy, runSummary, levelErrors, flowScores } from './suite.mjs';
import { expandJobs } from '../src/batch.js';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const all = (k) => argv.flatMap((a, i) => (a === '--' + k && i + 1 < argv.length ? [argv[i + 1]] : []));
const pairs = (list) => Object.fromEntries(list.map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const path = join(here, 'calibration.json'), studies = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
export const LABELS = { calManning: 'roughness ×', calInfil: 'infiltration ×', calClog: 'inlet clogging', gwShare: 'groundwater return', gwLag: 'groundwater lag h', wtDepth: 'soil limit depth m' };

if (!argv.includes('--page')) {
  const cases = loadCases(), byId = (id) => cases.find(c => c.id === id) ?? fail(`no case "${id}" in cases.json`);
  const cal = byId(opt('case') ?? fail('--case is required')), set = pairs(all('set')), target = Number(opt('target', 0.15));
  const objective = opt('objective', 'level'); if (!['level', 'flow'].includes(objective)) fail('--objective is level or flow');
  const runOpts = { url: opt('url'), headed: argv.includes('--headed') };
  const axes = Object.entries(pairs(all('vary'))).map(([k, v]) => [k, v.split(',')]); if (!axes.length) fail('--vary is required');
  let grid = [{}]; for (const [k, vs] of axes) grid = grid.flatMap(g => vs.map(v => ({ ...g, [k]: v })));
  const name = (inputs) => Object.entries(inputs).map(([k, v]) => `${LABELS[k] ?? k} ${v}`).join(', ') || 'as set';
  const variant = (inputs) => ({ key: 'cal:' + Object.entries(inputs).map(([k, v]) => `${k}=${v}`).join(','), label: name(inputs), inputs });
  const folder = (c) => `${c.project} (calibration)`;
  const score = (f, job) => { const sm = job.status === 'done' && job.dir ? runSummary(f, job.dir.replace(/^runs[\\/]/, '')) : null, e = levelErrors(sm);
    const q = flowScores(sm), r3 = (v) => (v == null ? null : +v.toFixed(3));
    return { run: job.dir?.replace(/^runs[\\/]/, '') ?? null, n: e.n, rms: e.rms, bias: e.bias, errors: e.errors.map(x => ({ ...x, error: +x.error.toFixed(3) })),
      ...(q ? { flow: { site: q.site, kge: r3(q.kge), nse: r3(q.nse), volumeRatio: r3(q.volumeRatio), peakRatio: r3(q.peakRatio), lag: q.lag == null ? null : +q.lag.toFixed(1), levelNSE: r3(q.levelNSE) } } : {}) }; };
  const storms = [{ label: 'Calibration', stormSrc: 'current', inputs: {} }];

  // 1–2. the sweep on the calibration storm
  console.log(`calibration on ${cal.id}: ${grid.length} runs (${axes.map(([k, vs]) => `${LABELS[k] ?? k} ${vs.join(' / ')}`).join('; ')})`);
  deriveProject(cal, folder(cal), set);
  const sweep = runStudy(folder(cal), expandJobs({ storms, variants: grid.map(variant) }), runOpts);
  const points = grid.map((inputs, i) => ({ inputs, ...score(folder(cal), sweep.jobs[i]) }));
  for (const p of points) console.log(`  ${name(p.inputs)}: ${p.rms == null ? 'no score' : `RMS ${p.rms.toFixed(2)} m, bias ${p.bias.toFixed(2)} m (${p.n})`}${flowText(p.flow)}`);
  const better = objective === 'flow' ? (p, a) => p.flow.kge > a.flow.kge : (p, a) => p.rms < a.rms;
  const best = points.filter(p => (objective === 'flow' ? p.flow?.kge != null : p.rms != null)).reduce((a, p) => (!a || better(p, a) ? p : a), null) ?? fail(`no run of the sweep scored on ${objective}`);
  console.log(`  kept: ${name(best.inputs)}`);

  // 3. the validation storms, as set and with the kept values
  const validation = [];
  for (const id of (opt('validate') ?? '').split(',').filter(Boolean)) {
    const v = byId(id); console.log(`validation on ${v.id}`);
    deriveProject(v, folder(v), set);
    const st = runStudy(folder(v), expandJobs({ storms: [{ label: 'Validation', stormSrc: 'current', inputs: {} }], variants: [variant({}), variant(best.inputs)] }), runOpts);
    const asSet = score(folder(v), st.jobs[0]), calibrated = score(folder(v), st.jobs[1]);
    console.log(`  as set: ${asSet.rms?.toFixed(2) ?? '–'} m RMS${flowText(asSet.flow)}; calibrated: ${calibrated.rms?.toFixed(2) ?? '–'} m RMS${flowText(calibrated.flow)}`);
    validation.push({ case: v.id, title: v.title, asSet, calibrated });
  }

  // 4. the record
  const code = codeState(root);
  studies.push({ created: new Date().toISOString(), commit: code.commit ? code.commit.slice(0, 7) + (code.dirty ? '+dirty' : '') : null, case: cal.id, title: cal.title, set, vary: Object.fromEntries(axes),
    target, objective, points, kept: best.inputs, calibration: { n: best.n, rms: best.rms, bias: best.bias, run: best.run, ...(best.flow ? { flow: best.flow } : {}) }, validation, ...(opt('note') ? { note: opt('note') } : {}) });
  writeFileSync(path, JSON.stringify(studies, null, 1) + '\n');
}
writeFileSync(join(here, 'CALIBRATION.md'), page(studies));
console.log('calibration studies: benchmarks/validation/calibration.json; summary in benchmarks/validation/CALIBRATION.md');

function fail(msg) { console.error(msg); process.exit(1); }
/** A run's flow at the gauge for the log: "; flow KGE 0.41, NSE 0.20, volume ×0.62, peak ×0.55" (empty without one). */
function flowText(q) { const f = (v) => (v == null ? '–' : v.toFixed(2)); return q ? `; flow KGE ${f(q.kge)}, NSE ${f(q.nse)}, volume ×${f(q.volumeRatio)}, peak ×${f(q.peakRatio)}` : ''; }

/** The summary page: each study's sweep, the values kept, and the storms it never saw, against the target. */
function page(list) {
  const m = (v) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(2)), s = (v) => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2));
  const name = (inputs) => Object.entries(inputs).map(([k, v]) => `${LABELS[k] ?? k} ${v}`).join(', ') || 'as set';
  const L = ['# Calibration studies', '',
    'Written by `node tools/calibrate.mjs` (records in `calibration.json`). Each study tunes the model on one observed storm,',
    'keeps the values with the smallest RMS level error (high-water marks and gauge peaks, model − observed, m), or with',
    'the best flow at a gauge over the whole storm (Kling–Gupta efficiency, KGE: 1 is perfect), then runs',
    'other storms the tuning never saw, as set and with the values frozen. The target is the usual bar for a mapping model:',
    'levels within 0.5 ft (0.15 m). A model is calibrated when the storms it never saw meet the target with the values',
    'kept, not when the tuning storm does. See docs/METHODS.md §6.4.', ''];
  for (const st of [...list].reverse()) {
    const met = (r) => (r?.rms == null ? '–' : r.rms <= st.target ? 'meets' : `${(r.rms / st.target).toFixed(1)}× the target`);
    L.push(`## ${st.title} — ${st.created.slice(0, 10)}`, '',
      `Commit ${st.commit ?? '–'}. Every run: ${Object.entries(st.set).map(([k, v]) => `${k} = ${v}`).join(', ') || 'the case as set'}. Target ${st.target} m.${st.note ? ' ' + st.note : ''}`, '',
      ...(st.points.some(p => p.flow) ? [
        '| Values | Run | Level errors | RMS (m) | Bias (m) | Flow KGE | Flow NSE | Volume (model / gauge) | Peak flow (model / gauge) |', '|---|---|---|---|---|---|---|---|---|',
        ...st.points.map(p => `| ${name(p.inputs)}${JSON.stringify(p.inputs) === JSON.stringify(st.kept) ? ' **(kept)**' : ''} | ${p.run ?? 'not run'} | ${p.n} | ${m(p.rms)} | ${s(p.bias)} | ${m(p.flow?.kge)} | ${m(p.flow?.nse)} | ${m(p.flow?.volumeRatio)} | ${m(p.flow?.peakRatio)} |`)]
      : ['| Values | Run | Level errors | RMS (m) | Bias (m) |', '|---|---|---|---|---|',
        ...st.points.map(p => `| ${name(p.inputs)}${JSON.stringify(p.inputs) === JSON.stringify(st.kept) ? ' **(kept)**' : ''} | ${p.run ?? 'not run'} | ${p.n} | ${m(p.rms)} | ${s(p.bias)} |`)]), '',
      `Kept${st.objective === 'flow' ? ' (best flow KGE at the gauge)' : ''}: **${name(st.kept)}**, calibration storm ${m(st.calibration.rms)} m RMS (${met(st.calibration)})${st.calibration.flow ? `, flow KGE ${m(st.calibration.flow.kge)}` : ''}.`, '');
    if (st.validation.length) {
      const fl = st.validation.some(v => v.asSet.flow || v.calibrated.flow), kg = (r) => (fl ? ` | ${m(r.flow?.kge)}` : '');
      L.push(`| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n)${fl ? ' | Flow KGE as set | calibrated' : ''} | Against the target |`, `|---|---|---${fl ? '|---|---' : ''}|---|`,
        ...st.validation.map(v => `| ${v.title} | ${m(v.asSet.rms)} / ${s(v.asSet.bias)} (${v.asSet.n}) | ${m(v.calibrated.rms)} / ${s(v.calibrated.bias)} (${v.calibrated.n})${kg(v.asSet)}${kg(v.calibrated)} | ${met(v.calibrated)}${v.asSet.rms != null && v.calibrated.rms != null ? (v.calibrated.rms < v.asSet.rms ? '; the tuning carried over' : '; the tuning did not carry over') : ''} |`), '');
    } else L.push('No storm it never saw has been run: this study is a fit, not a calibration.', '');
  }
  return L.join('\n') + '\n';
}
