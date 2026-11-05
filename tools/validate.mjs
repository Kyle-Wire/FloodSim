// The validation suite: each case in benchmarks/validation/cases.json is a project whose storm was observed (or another
// model's map to compare with). This scores each case's latest finished run filed in its project, the way the app's
// scorecard does (src/validate.js), adds it to benchmarks/validation/history.json and rewrites the summary in
// benchmarks/validation/README.md, so every release can be held to the last one.
// With --run, each case first runs again headless (tools/batch.mjs): its project is installed from
// benchmarks/validation/<id>/project.json when the projects folder does not have it, and a one-job study of the
// project's storm as set is written to its batch.json.
//
// Usage: node tools/validate.mjs [--run [--ensemble]] [--case id,id] [--dir <run folder>] [--url http://localhost:8766] [--note "text"]
//   --run    run each case again before scoring it (hours of GPU time: Manayunk takes about 7 h)
//   --ensemble  with --run, the variants too (roughness ± 20 %, infiltration × 0.5, one cell size coarser): the marks'
//            uncertainty band (src/uncertainty.js) goes in the history with the base run
//   --variants-only  with --run, the variants alone: the band for a base run already filed (made by hand in the app)
//   --case   only these cases
//   --dir    score this filed run (a folder under runs/) instead of the latest: to add an older run to the history
//   --url    a FloodSim server already running (for --run)
//   --note   kept with this round's entries in the history
// Exit code 0 when every case scored, 1 when any run or score failed.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { codeState } from './codestate.mjs';
import { root, here, projectsDir, loadCases, installCase, runStudy, latestRun, runSummary } from './suite.mjs';
import { join } from 'node:path';
import { scorecard } from '../src/validate.js';
import { expandJobs, VARIANTS } from '../src/batch.js';
import { markBands, mapBands } from '../src/uncertainty.js';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const cases = loadCases(), only = opt('case')?.split(',');
const histPath = join(here, 'history.json'), history = existsSync(histPath) ? JSON.parse(readFileSync(histPath, 'utf8')) : [];
const code = codeState(root), commit = code.commit ? code.commit.slice(0, 7) + (code.dirty ? '+dirty' : '') : ''; // tools/codestate.mjs: code files only

/** The batch variants filed beside a base run (the same storm, scenario and design; the newest of each) → [{ dir, summary }].
 *  The base may be a run made by hand: a study of the variants alone then gives it its band. */
function variantsOf(folder, base) {
  const b = base.summary, runs = join(projectsDir, folder, 'runs'), seen = new Set(), out = [];
  if (b.batch && b.batch.variant !== 'base') return out;
  const sameStorm = (sm) => (b.batch ? sm.batch.storm === b.batch.storm : sm.storm?.label === b.storm?.label);
  for (const dir of readdirSync(runs).filter(d => !d.startsWith('_') && d !== base.dir).sort().reverse()) {
    const sm = runSummary(folder, dir), k = sm?.batch?.variant;
    if (!sm?.finished || !k || k === 'base' || seen.has(k) || !sameStorm(sm) || sm.scenario !== b.scenario || sm.designHash !== b.designHash) continue;
    seen.add(k); out.push({ dir, summary: sm });
  }
  return out;
}
/** The marks' and maps' band over a base run and its variants (src/uncertainty.js), as the history keeps it. */
function bandOf(base, variants) {
  const m = (r, key) => ({ key, label: r.summary.batch?.variantLabel ?? key, points: r.summary.validation?.hwm?.points ?? null, floodMaps: r.summary.validation?.floodMaps ?? null });
  const members = [m(base, 'base'), ...variants.map(v => m(v, v.summary.batch.variant))], marks = markBands(members), maps = mapBands(members);
  if (!marks && !maps.length) return null;
  return { members: members.map(x => x.key), runs: variants.map(v => v.dir),
    marks: marks && { n: marks.n, inside: marks.inside, share: marks.share, meanWidth: marks.meanWidth, maxWidth: marks.maxWidth, drivers: marks.drivers.map(d => ({ key: d.key, meanShift: +d.meanShift.toFixed(3) })) },
    maps: maps.map(x => ({ name: x.name, csi: x.csi, hitRate: x.hitRate })) };
}
/** One history entry from a run's summary: the numbers a reviewer compares release to release. */
function entryOf(c, dir, sm, prev) {
  // marks scored in the app after the run was filed, before runs took them into their summary, stay as the history has them
  const v = sm.validation ?? {}, h = v.hwm ?? prev?.marks ?? null, sc = scorecard({ ...v, hwm: h, gauges: (v.gauges ?? []).filter(g => g.score) });
  const n = (s) => sc.items.filter(i => i.status === s && (i.group === 'observations' || i.group === 'comparison')).length;
  return {
    case: c.id, scored: new Date().toISOString(), commit, runCommit: sm.commit ?? null, run: dir, saved: sm.savedUTC, storm: sm.storm?.label?.split(' (')[0] ?? null,
    simulatedH: sm.results?.simulatedS != null ? +(sm.results.simulatedS / 3600).toFixed(2) : null, wallH: sm.results?.wallClockS != null ? +(sm.results.wallClockS / 3600).toFixed(2) : null,
    marks: h?.n ? { n: h.n, rmse: +h.rmse.toFixed(3), bias: +h.bias.toFixed(3), within15: +h.within15.toFixed(3), hits: h.hits ?? null, misses: h.misses ?? null, calls: h.calls ?? null } : null,
    ...(!v.hwm && prev?.marksFrom ? { marksFrom: prev.marksFrom } : {}),
    gauges: (v.gauges ?? []).filter(g => g.score).map(g => ({ site: g.site, name: g.name, error: +g.score.error.toFixed(3), lagMin: Math.round(g.score.lag) })),
    maps: (v.floodMaps ?? []).map(m => ({ name: m.name, observed: m.observed !== false, hitRate: m.hitRate, csi: m.csi, falseAlarmRatio: m.falseAlarmRatio, areaRatio: m.areaRatio, depthBias: m.depth?.bias ?? null, depthRMSE: m.depth?.rmse ?? null })),
    mass: v.mass?.surface ?? null, checks: { good: n('good'), fair: n('fair'), poor: n('poor') }, verdict: sc.verdict.status, ...(opt('note') ? { note: opt('note') } : {}),
  };
}
/** Run a case again headless: install its project if missing, a one-job study of its storm as set (and the variants). */
function rerun(c) {
  installCase(c);
  const ens = ['n-20', 'n+20', 'infil-50', 'coarse'].map(k => VARIANTS[k]), variants = argv.includes('--variants-only') ? ens : [VARIANTS.base, ...(argv.includes('--ensemble') ? ens : [])];
  runStudy(c.project, expandJobs({ storms: [{ label: 'Validation', stormSrc: 'current', inputs: {} }], variants }), { url: opt('url') });
}

let failed = 0;
for (const c of cases.filter(c => !only || only.includes(c.id))) {
  console.log(`${c.id}: ${c.title}`);
  try {
    if (argv.includes('--run')) rerun(c);
    const last = latestRun(c.project, opt('dir'), true); if (!last) throw new Error(`no finished run${opt('dir') ? ' ' + opt('dir') : ''} filed in "${c.project}"`);
    const i = history.findIndex(x => x.case === c.id && x.run === last.dir), e = entryOf(c, last.dir, last.summary, history[i]);
    const band = bandOf(last, variantsOf(c.project, last)); if (band) e.band = band;
    if (i >= 0) history[i] = { ...history[i], ...e }; else history.push(e);
    if (e.band?.marks?.n) console.log(`  band of ${e.band.members.length} runs: ${e.band.marks.inside} of ${e.band.marks.n} marks inside, ${e.band.marks.meanWidth.toFixed(2)} m wide on average`);
    console.log(`  run ${e.run}: ${e.marks ? `marks RMSE ${e.marks.rmse.toFixed(2)} m, bias ${e.marks.bias.toFixed(2)} m (${e.marks.n}); ` : ''}${e.gauges.map(g => `gauge ${g.site} ${g.error.toFixed(2)} m`).join(', ')}${e.maps.map(m => `; ${m.name.split(',')[0]} CSI ${m.csi?.toFixed(2)}`).join('')}`);
  } catch (err) { failed++; console.error(`  FAILED: ${err.message}`); }
}
history.sort((a, b) => (a.case === b.case ? a.saved.localeCompare(b.saved) : cases.findIndex(c => c.id === a.case) - cases.findIndex(c => c.id === b.case)));
writeFileSync(histPath, JSON.stringify(history, null, 1) + '\n');
writeFileSync(join(here, 'README.md'), summary(cases, history));
console.log(`\nhistory: ${history.length} entries; summary in benchmarks/validation/README.md`);
process.exit(failed ? 1 : 0);

/** The summary page: the latest score of each case against its previous one, then each case's history. */
function summary(cases, hist) {
  const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d));
  const u = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d)), pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
  const marks = (e) => (e.marks ? `${u(e.marks.rmse)} / ${f(e.marks.bias)} (${e.marks.n})` : '–');
  const gauges = (e) => (e.gauges.length ? e.gauges.map(g => `${g.site} ${f(g.error)}`).join('; ') : '–');
  const band = (e) => (e.band?.marks?.n ? `${e.band.marks.inside} of ${e.band.marks.n} inside, ${u(e.band.marks.meanWidth)} m wide (${e.band.members.length} runs)` : '–');
  const maps = (e) => (e.maps.length ? e.maps.map(m => `${m.name.replace(/ \(.*| Stormwater Flood Map|, current sea level/g, '')}: hit ${pct(m.hitRate)}, CSI ${pct(m.csi)}`).join('; ') : '–');
  const L = ['# Validation suite', '',
    'Every case is a FloodSim project of a storm with observations (or another model\'s flood map to compare with),',
    'scored from its latest filed run by `node tools/validate.mjs` (add `--run` to run them all again headless first).',
    'The cases are in `cases.json`, every score so far in `history.json`; this page is rewritten each time.',
    'Marks: RMSE / bias of the high-water mark levels (m, model − observed). Gauges: peak level error (m). Maps: cell by',
    'cell at 4 in and over, buildings left out (hit rate: the map\'s flooded cells the model floods; CSI: hits / (hits + misses +',
    'false alarms)). Band: the lowest to the highest level the base run and its batch variants give at each mark (roughness',
    '± 20 %, infiltration × 0.5, one cell size coarser), a sensitivity band, not a probability. See docs/METHODS.md §5 for what',
    'each case shows and what it does not. Calibration studies (tune on one storm, test on storms the tuning never saw) are in',
    '[CALIBRATION.md](CALIBRATION.md).', '',
    '## Latest', '', '| Case | Run | Commit | Marks RMSE / bias (n) | Marks in the variants’ band | Gauges | Maps | Checks good / fair / poor | Change from the run before |', '|---|---|---|---|---|---|---|---|---|'];
  for (const c of cases) {
    const es = hist.filter(e => e.case === c.id); if (!es.length) { L.push(`| ${c.title} | not run yet | | | | | | | |`); continue; }
    const e = es.at(-1), p = es.at(-2);
    const d = p ? [e.marks && p.marks ? `marks RMSE ${f(e.marks.rmse - p.marks.rmse)} m` : '', ...e.gauges.map(g => { const q = p.gauges.find(x => x.site === g.site); if (!q) return ''; const dd = Math.abs(g.error) - Math.abs(q.error); return `${g.site} ${u(Math.abs(dd))} m ${dd <= 0 ? 'closer' : 'further off'}`; })].filter(Boolean).join(', ') : 'first run';
    L.push(`| ${c.title} | ${e.run} | ${e.runCommit ?? e.commit} | ${marks(e)} | ${band(e)} | ${gauges(e)} | ${maps(e)} | ${e.checks.good} / ${e.checks.fair} / ${e.checks.poor} | ${d || '–'} |`);
  }
  for (const c of cases) {
    const es = hist.filter(e => e.case === c.id); if (!es.length) continue;
    L.push('', `## ${c.title}`, '', c.about, '', '| Run | Commit | Storm | Marks RMSE / bias (n) | Gauges | Maps | Note |', '|---|---|---|---|---|---|---|');
    for (const e of es) L.push(`| ${e.run} | ${e.runCommit ?? e.commit} | ${e.storm ?? ''} | ${marks(e)} | ${gauges(e)} | ${maps(e)} | ${[e.note, e.marksFrom].filter(Boolean).join('; ')} |`);
  }
  return L.join('\n') + '\n';
}
