// Batch runs: a study is a list of jobs, each a set of app inputs (a storm, a scenario, a variant), run one after
// another and filed in the project. The whole study lives in the project as batch.json, so a reload, a crash or a
// headless runner (tools/batch.mjs) carries on from the first job not done, and the job under way resumes from its
// last checkpoint (src/checkpoint.js).
//
//   storms     [{ label, stormSrc, inputs: { id: value } }]   e.g. Atlas 14 100-yr 24 h: { stormSrc: 'a14', inputs: { ari: '100', a14dur: '1440' } }
//   scenarios  [null (existing conditions) | scenario name]
//   variants   [{ key, label, inputs: { id: value } }]          e.g. roughness × 0.8: { key: 'n-20', inputs: { calManning: '0.8' } }
// Every combination is a job; jobs are ordered storm by storm, existing conditions first, so a with / without pair is
// always adjacent (and comparable as soon as it is done).

/** Standard variants for a sensitivity study (src/checks.js reads them back by key). designOnly: the variant works through
 *  a design-storm input (the rain uplift), so it is not run on a historic, live or custom storm, where it would change nothing. */
export const VARIANTS = {
  base: { key: 'base', label: 'As set', inputs: {} },
  'n-20': { key: 'n-20', label: 'Roughness × 0.8', inputs: { calManning: '0.8' } },
  'n+20': { key: 'n+20', label: 'Roughness × 1.2', inputs: { calManning: '1.2' } },
  'infil-50': { key: 'infil-50', label: 'Infiltration × 0.5', inputs: { calInfil: '0.5' } },
  'rain+10': { key: 'rain+10', label: 'Rain + 10 % (design storms)', designOnly: true, inputs: { uplift: '10' } },
  coarse: { key: 'coarse', label: 'One cell size coarser', coarser: true, inputs: {} },
};

/** The jobs of a study, in run order. → [{ id, label, storm, scenario, variant, status: 'pending' }] */
export function expandJobs({ storms, scenarios = [null], variants = [VARIANTS.base] }) {
  const jobs = [];
  for (const st of storms) for (const v of variants) for (const sc of scenarios) {
    if (v.designOnly && st.stormSrc !== 'a14') continue;
    const label = [st.label, sc ?? 'Existing conditions', v.key === 'base' ? null : v.label].filter(Boolean).join(' · ');
    jobs.push({ id: jobId(st, sc, v), label, storm: st, scenario: sc, variant: v, status: 'pending' });
  }
  return jobs;
}
/** A stable id for a job (the same storm, scenario and variant always get the same id). */
export function jobId(st, sc, v) {
  const s = JSON.stringify([st.stormSrc, st.inputs ?? {}, sc ?? '', v.key, v.inputs ?? {}, !!v.coarser]);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'j' + (h >>> 0).toString(36);
}
/** Atlas 14 design storms from a list of return periods (yr) and durations (min). */
export const designStorms = (aris, durs = [1440]) => durs.flatMap(d => aris.map(a => ({ label: `${a}-yr ${d >= 60 ? d / 60 + ' h' : d + ' min'}`, stormSrc: 'a14', inputs: { ari: String(a), a14dur: String(d) } })));
/** The next job to run (the one under way first, then the first pending), or null. */
export const nextJob = (study) => study.jobs.find(j => j.status === 'running') ?? study.jobs.find(j => j.status === 'pending') ?? null;
/** Counts by status. */
export const progress = (study) => study.jobs.reduce((o, j) => { o[j.status] = (o[j.status] ?? 0) + 1; return o; }, { total: study.jobs.length });
