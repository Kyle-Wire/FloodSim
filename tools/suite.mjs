// What the validation and calibration tools share: where projects live, the suite's cases, installing a case's project,
// running a study of it headless (tools/batch.mjs), finding its filed runs, and the level errors a run's summary holds.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url)), here = join(root, 'benchmarks', 'validation');
export const projectsDir = process.env.FLOODSIM_PROJECTS || join(homedir(), 'Documents', 'FloodSim Projects');
export const loadCases = () => JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
export const readProject = (folder) => JSON.parse(readFileSync(join(projectsDir, folder, 'project.json'), 'utf8'));

/** The case's project, installed from benchmarks/validation/<id>/project.json when the projects folder lacks it. */
export function installCase(c) {
  const dest = join(projectsDir, c.project), src = join(here, c.id, 'project.json');
  if (!existsSync(join(dest, 'project.json'))) {
    if (!existsSync(src)) throw new Error(`no project "${c.project}" and no ${src} to install it from`);
    mkdirSync(dest, { recursive: true }); copyFileSync(src, join(dest, 'project.json'));
    console.log(`  installed ${c.project} from benchmarks/validation/${c.id}`);
  }
  return readProject(c.project);
}

/**
 * A copy of a case's project with some inputs changed (`set`: { id: value }), as its own project `folder`: a study of it
 * never mixes with the case's own runs. Settings read when the project opens (the storm's rain source) take effect,
 * which a batch variant's inputs, applied after the storm has loaded, cannot do.
 */
export function deriveProject(c, folder, set = {}) {
  const pj = installCase(c), dest = join(projectsDir, folder);
  const out = { ...pj, name: folder, inputs: { ...(pj.inputs ?? {}), ...set } };
  mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, 'project.json'), JSON.stringify(out, null, 1));
  return out;
}

/**
 * Run a project's study headless. `jobs` from src/batch.js expandJobs; a batch.json already there with the same jobs
 * (same ids in the same order) is kept, so a study cut short carries on where it stopped. → the study as batch.mjs left it
 */
export function runStudy(folder, jobs, { url = null } = {}) {
  const pj = readProject(folder), path = join(projectsDir, folder, 'batch.json');
  const old = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null, key = (js) => js.map(j => j.label + '|' + j.variant.key).join(';');
  if (!old || key(old.jobs) !== key(jobs)) writeFileSync(path, JSON.stringify({ version: 1, created: new Date().toISOString(), base: pj.inputs ?? {}, jobs }, null, 1));
  else console.log(`  carrying on the study in ${folder}/batch.json (${old.jobs.filter(j => j.status === 'done').length} of ${jobs.length} jobs done)`);
  const r = spawnSync(process.execPath, [join(root, 'tools', 'batch.mjs'), folder, ...(url ? ['--url', url] : [])], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tools/batch.mjs exited ${r.status}`);
  return JSON.parse(readFileSync(path, 'utf8'));
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
