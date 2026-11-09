// What the validation and calibration tools share: where projects live, the suite's cases, installing a case's project,
// running a study of it headless (tools/batch.mjs), finding its filed runs, and the level errors a run's summary holds.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codeState, CODE_PATHS } from './codestate.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url)), here = join(root, 'benchmarks', 'validation');
export const projectsDir = process.env.FLOODSIM_PROJECTS || join(homedir(), 'Documents', 'FloodSim Projects');
export const loadCases = () => JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
export const readProject = (folder) => JSON.parse(readFileSync(join(projectsDir, folder, 'project.json'), 'utf8'));

/**
 * The case's project, installed from benchmarks/validation/<id>/project.json when the projects folder lacks it or holds
 * a copy whose inputs differ from it. The
 * case's control lines (analysis.geojson: a line at a gauge records its flow, scored against the gauge's discharge)
 * are copied whenever the case has them, so a project installed before them gains them.
 */
export function installCase(c) {
  const dest = join(projectsDir, c.project), src = join(here, c.id, 'project.json');
  if (!existsSync(join(dest, 'project.json'))) {
    if (!existsSync(src)) throw new Error(`no project "${c.project}" and no ${src} to install it from`);
    mkdirSync(dest, { recursive: true }); copyFileSync(src, join(dest, 'project.json'));
    console.log(`  installed ${c.project} from benchmarks/validation/${c.id}`);
  } else if (existsSync(src)) {
    // the case file is the record: an installed copy whose inputs differ from it (a case fixed in the repo after it was
    // installed, or an edit made in the app) is replaced, the old copy kept beside it
    const changed = staleInputs(JSON.parse(readFileSync(src, 'utf8')), readProject(c.project));
    if (changed.length) {
      const bak = `project.before-${new Date().toISOString().slice(0, 10)}.json`;
      copyFileSync(join(dest, 'project.json'), join(dest, bak)); copyFileSync(src, join(dest, 'project.json'));
      console.log(`  updated ${c.project} from benchmarks/validation/${c.id} (${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` and ${changed.length - 6} more` : ''} differed; the old copy is ${bak})`);
    }
  }
  copyAnalysis(c, dest);
  return readProject(c.project);
}
/** Input ids whose value in the installed project differs from the case file's. */
export const staleInputs = (cas, inst) => Object.keys(cas.inputs ?? {}).filter(k => JSON.stringify(cas.inputs[k]) !== JSON.stringify(inst.inputs?.[k]));
/** The case's control lines and site boundary (benchmarks/validation/<id>/analysis.geojson), into a project folder. */
function copyAnalysis(c, dest) { const a = join(here, c.id, 'analysis.geojson'); if (existsSync(a)) copyFileSync(a, join(dest, 'analysis.geojson')); }

/**
 * A copy of a case's project with some inputs changed (`set`: { id: value }), as its own project `folder`: a study of it
 * never mixes with the case's own runs. Settings read when the project opens (the storm's rain source) take effect,
 * which a batch variant's inputs, applied after the storm has loaded, cannot do.
 */
export function deriveProject(c, folder, set = {}) {
  const pj = installCase(c), dest = join(projectsDir, folder);
  const out = { ...pj, name: folder, inputs: { ...(pj.inputs ?? {}), ...set } };
  mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, 'project.json'), JSON.stringify(out, null, 1)); copyAnalysis(c, dest);
  return out;
}

/**
 * Run a project's study headless. `jobs` from src/batch.js expandJobs; a batch.json already there with the same jobs
 * from the same inputs (sameStudy) is kept, so a study cut short carries on where it stopped, its failed jobs tried
 * again; otherwise the study starts afresh and an earlier study's checkpoint is set aside. → the study as batch.mjs left it
 */
export function runStudy(folder, jobs, { url = null, headed = false } = {}) {
  const pj = readProject(folder), path = join(projectsDir, folder, 'batch.json');
  const old = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const code = codeVersion();
  if (!sameStudy(old, jobs, pj.inputs, code)) {
    writeFileSync(path, JSON.stringify({ version: 1, created: new Date().toISOString(), base: pj.inputs ?? {}, code, jobs }, null, 1));
    setAsideCheckpoint(folder);
  } else {
    // a job that failed is tried again (from the start: a failed job's checkpoint is not its own)
    const failed = old.jobs.filter(j => j.status === 'failed');
    for (const j of failed) Object.assign(j, { status: 'pending', error: undefined, started: undefined });
    if (failed.length) { writeFileSync(path, JSON.stringify(old, null, 1)); setAsideCheckpoint(folder); }
    console.log(`  carrying on the study in ${folder}/batch.json (${old.jobs.filter(j => j.status === 'done').length} of ${jobs.length} jobs done${failed.length ? `, ${failed.length} that failed tried again` : ''})`);
  }
  const r = spawnSync(process.execPath, [join(root, 'tools', 'batch.mjs'), folder, ...(url ? ['--url', url] : []), ...(headed ? ['--headed'] : [])], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tools/batch.mjs exited ${r.status}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Whether a batch.json already in a project is this study: the same jobs (ids and labels in order) from the same project
 * inputs. A study of the same jobs made before the project's settings changed is not (the Charlotte cases, Nov 2026: a
 * validation study started with combined sewers on was carried on after they were turned off). Nor is one made with other
 * model code (`code`: a study repeated after a fix would hand back the old runs as its results).
 */
export const sameStudy = (old, jobs, inputs = {}, code) => !!old && old.jobs?.map(j => j.id + '|' + j.label).join(';') === jobs.map(j => j.id + '|' + j.label).join(';')
  && JSON.stringify(old.base ?? {}) === JSON.stringify(inputs ?? {}) && (code === undefined || old.code === code);
/** The last commit that touched anything that can change a result (+ when such files are also edited but not committed). */
function codeVersion() {
  const r = spawnSync('git', ['log', '-1', '--format=%h', '--', ...CODE_PATHS], { cwd: root, encoding: 'utf8' });
  return (r.status === 0 ? r.stdout.trim() : '') + (codeState(root).dirty ? '+' : '');
}
/**
 * A checkpoint left in the project by an earlier study, moved to runs/_checkpoint.set-aside-<time> before a new study
 * starts: job ids repeat between studies of the same storms, and the headless runner resumes a job whose id the
 * checkpoint names, which fails when the settings differ (7 Nov 2026, January 2024 Charlotte storm).
 */
function setAsideCheckpoint(folder) {
  const ck = join(projectsDir, folder, 'runs', '_checkpoint'), meta = join(ck, 'meta.json');
  if (!existsSync(meta)) return;
  let m = null; try { m = JSON.parse(readFileSync(meta, 'utf8')); } catch { /* unreadable: set it aside too */ }
  if (m && !m.forcing) return; // cleared
  const to = `${ck}.set-aside-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  renameSync(ck, to); console.log(`  set aside an earlier study's checkpoint (${m?.label ?? 'a run'}) as runs/${to.split(/[\/]/).pop()}`);
}

/** A filed run's summary (runs/<dir>/summary.json) or null. */
export function runSummary(folder, dir) {
  const p = join(projectsDir, folder, 'runs', dir, 'summary.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** The latest finished run filed in a project (or the run `only`) → { dir, summary } or null; `base`: batch base runs and runs made by hand only. */
export function latestRun(folder, only = null, base = false) {
  const runs = join(projectsDir, folder, 'runs'); if (!existsSync(runs)) return null;
  for (const dir of readdirSync(runs).filter(d => !d.startsWith('_') && (!only || d === only)).sort().reverse()) {
    const summary = runSummary(folder, dir); if (summary?.finished && (!base || !summary.batch || summary.batch.variant === 'base')) return { dir, summary };
  }
  return null;
}

/**
 * The flow at each gauge a control line is drawn at, over the whole storm (src/validate.js hydrographScore), and the
 * gauge's level over the storm. → { site, nse, kge, volumeRatio, peakRatio, lag, levelNSE } for the first such gauge, or null.
 */
export function flowScores(sm) {
  for (const g of sm?.validation?.gauges ?? []) {
    const q = g.flow?.score; if (!q) continue;
    return { site: g.site, nse: q.nse, kge: q.kge, volumeRatio: q.volumeRatio, peakRatio: q.peakRatio, lag: q.lag, levelNSE: g.levelShape?.nse ?? null };
  }
  return null;
}

/**
 * Every level error a run's summary scores (model − observed, m): each high-water mark scored (not skipped) and each
 * gauge's peak. → { errors: [{ kind: 'mark' | 'gauge', id, error }], n, rms, bias }
 */
export function levelErrors(sm) {
  const v = sm?.validation ?? {}, errors = [];
  for (const p of v.hwm?.points ?? []) if (!p.skip && p.kind === 'level' && Number.isFinite(p.error)) errors.push({ kind: 'mark', id: p.name, error: p.error });
  for (const g of v.gauges ?? []) if (Number.isFinite(g.score?.error)) errors.push({ kind: 'gauge', id: g.site, error: g.score.error });
  const n = errors.length;
  return { errors, n, rms: n ? Math.sqrt(errors.reduce((a, e) => a + e.error ** 2, 0) / n) : null, bias: n ? errors.reduce((a, e) => a + e.error, 0) / n : null };
}
