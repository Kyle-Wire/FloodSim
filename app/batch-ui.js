// Batch drawer: a study of many runs (design storms × scenarios × variants, src/batch.js), run one after another and
// each filed in the project, with checkpoints along the way (src/checkpoint.js). The study is kept in the project as
// batch.json: after a reload, a crash or in a headless runner (tools/batch.mjs, or ?project=<folder>&batch=run on the
// page) it carries on with the first job not done, and the job under way resumes from its last checkpoint.
import * as B from '../src/batch.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FILE = 'batch.json';

export function initBatch(api) {
  let study = null, running = false, stop = false;
  const note = (t) => { $('batNote').textContent = t; };
  const say = (t) => console.log('[batch] ' + t); // the headless runner (tools/batch.mjs) prints these

  // ---------------------------------------------------------------- the form
  function form() {
    const aris = api.aris(), durs = api.durations(), scs = api.scenarios();
    const box = (name, value, label, on) => `<label class="chip"><input type="checkbox" name="${name}" value="${esc(value)}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
    $('batStorms').innerHTML = aris.map(a => box('batAri', a, `${a}-yr`, [2, 10, 100].includes(a))).join('');
    $('batDurs').innerHTML = durs.map(d => box('batDur', d.value, d.label, d.value === 1440)).join('') + box('batCur', 'current', 'The storm as set now (historic, live or custom)', false);
    $('batScen').innerHTML = box('batSc', '', 'Existing conditions', true) + scs.map(n => box('batSc', n, n, true)).join('');
    $('batVar').innerHTML = Object.values(B.VARIANTS).map(v => box('batV', v.key, v.label, v.key === 'base')).join('') + (api.extraVariants?.() ?? []).map(v => box('batV', v.key, v.label, false)).join('');
  }
  const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(e => e.value);
  function plan() {
    const cur = checked('batCur').length > 0, aris = checked('batAri').map(Number), durs = checked('batDur').map(Number);
    const storms = [...(aris.length && durs.length ? B.designStorms(aris, durs) : []), ...(cur ? [{ label: 'Storm as set', stormSrc: 'current', inputs: {} }] : [])];
    const scenarios = checked('batSc').map(v => (v === '' ? null : v)), all = { ...B.VARIANTS, ...Object.fromEntries((api.extraVariants?.() ?? []).map(v => [v.key, v])) };
    const variants = checked('batV').map(k => all[k]).filter(Boolean);
    if (!storms.length) throw new Error('Pick at least one design storm and duration, or the storm as set now.');
    if (!scenarios.length || !variants.length) throw new Error('Pick at least one scenario and one variant.');
    if (storms.some(s => s.stormSrc === 'a14') && api.stormSrc() === 'hist' && !cur) { /* design storms switch the storm source per job */ }
    return { version: 1, created: new Date().toISOString(), base: api.inputs(), jobs: B.expandJobs({ storms, scenarios, variants }) };
  }

  // ---------------------------------------------------------------- the study file
  async function load() { if (!api.project()) return null; try { return JSON.parse(await api.readText(FILE)); } catch { return null; } }
  const save = () => (api.project() ? api.writeFile(FILE, JSON.stringify(study, null, 1)) : Promise.resolve());

  function render() {
    if (!study) { $('batJobs').innerHTML = ''; $('batResume').hidden = true; return; }
    const p = B.progress(study);
    $('batResume').hidden = running || !(p.pending || p.running);
    $('batResume').textContent = `Resume (${(p.pending ?? 0) + (p.running ?? 0)} of ${p.total} left)`;
    const cls = { done: 'ok', failed: 'err', running: 'run', pending: 'muted' };
    $('batJobs').innerHTML = `<table class="ptable"><tr><th>#</th><th>Job</th><th>Status</th><th>Run folder</th></tr>` +
      study.jobs.map((j, i) => `<tr class="${cls[j.status] ?? ''}"><td>${i + 1}</td><td>${esc(j.label)}</td><td>${esc(j.status)}${j.wall ? ` · ${Math.round(j.wall / 60)} min` : ''}${j.error ? ` · ${esc(j.error)}` : ''}</td><td>${esc(j.dir ?? '')}</td></tr>`).join('') + '</table>';
  }

  // ---------------------------------------------------------------- running
  async function go({ resume = false } = {}) {
    if (running) return;
    if (!api.project()) { note('Open or save a project first (Projects): the study, its runs and the checkpoints live in the project folder.'); return; }
    if (!api.ready()) { note('Build the model first.'); return; }
    running = true; stop = false; $('batStart').disabled = true; $('batPause').disabled = false; render();
    try {
      for (let j = B.nextJob(study); j && !stop; j = B.nextJob(study)) {
        const n = study.jobs.indexOf(j) + 1, was = j.status === 'running';
        j.status = 'running'; j.started ??= new Date().toISOString(); await save(); render(); say(`job ${n} of ${study.jobs.length}: ${j.label}${was ? ' (resuming)' : ''}`);
        const t0 = performance.now();
        try {
          const r = await api.runJob(j, (t) => note(`Job ${n} of ${study.jobs.length}: ${t}`), { resume: resume || was, base: study.base });
          Object.assign(j, { status: 'done', dir: r.dir, finished: new Date().toISOString(), wall: (j.wall ?? 0) + (performance.now() - t0) / 1000, error: undefined });
          say(`job ${n} done in ${Math.round((performance.now() - t0) / 1000)} s → runs/${r.dir}`);
        } catch (e) {
          if (stop) { j.status = 'running'; j.wall = (j.wall ?? 0) + (performance.now() - t0) / 1000; break; } // paused: resumes from its checkpoint
          Object.assign(j, { status: 'failed', error: e.message }); api.log(`Batch job ${n} (${j.label}) failed: ${e.message}`, 'warn'); say(`job ${n} FAILED: ${e.message}`);
        }
        resume = false; await save(); render();
      }
      const p = B.progress(study);
      note(stop ? `Paused: ${p.done ?? 0} of ${p.total} done. Resume carries on from the last checkpoint.` : `Study done: ${p.done ?? 0} of ${p.total} runs filed in the project${p.failed ? `, ${p.failed} failed` : ''}.`);
    } finally { running = false; $('batStart').disabled = false; $('batPause').disabled = true; render(); }
  }

  // ---------------------------------------------------------------- wiring
  $('batToggle').onclick = () => toggle(); $('batClose').onclick = () => toggle(false);
  async function toggle(on = $('batDrawer').hidden) {
    $('batDrawer').hidden = !on; $('batToggle').setAttribute('aria-expanded', on);
    if (on) {
      for (const [d, c] of [['design', 'designClose'], ['infra', 'infraClose'], ['cmpDrawer', 'cmpClose'], ['emuDrawer', 'emuClose'], ['repDrawer', 'repClose']]) if ($(d) && !$(d).hidden) $(c).click();
      form(); if (!running) study = (await load()) ?? study; render();
      const ck = await api.checkpointMeta(); $('batCk').textContent = ck ? `Checkpoint in the project: ${ck.label || 'a run'} at ${Math.floor(ck.t / 3600)}:${String(Math.floor(ck.t % 3600 / 60)).padStart(2, '0')} (${new Date(ck.savedUTC).toLocaleString()}).` : '';
    }
  }
  for (const id of ['designToggle', 'infraToggle', 'cmpToggle', 'emuToggle', 'repToggle']) $(id)?.addEventListener('click', () => { if (!$('batDrawer').hidden) toggle(false); });
  $('batPlan').onclick = () => { try { const s = plan(); note(`${s.jobs.length} run${s.jobs.length === 1 ? '' : 's'}: ${s.jobs.slice(0, 4).map(j => j.label).join('; ')}${s.jobs.length > 4 ? '; …' : ''}`); } catch (e) { note(e.message); } };
  $('batStart').onclick = async () => {
    try { const s = plan(); if (study && B.progress(study).done && !confirm('Start a new study? The current study’s list is replaced (its runs stay in the project).')) return; study = s; await save(); render(); go(); }
    catch (e) { note(e.message); }
  };
  $('batPause').onclick = () => { stop = true; note('Pausing: saving a checkpoint…'); api.pause(); };
  $('batResume').onclick = async () => { study = (await load()) ?? study; if (study) go({ resume: true }); };

  return {
    /** A project opened: show its study (and resume it at once with `auto`, the headless runner's page). */
    async opened({ auto = false } = {}) { study = await load(); render(); if (auto && study && B.nextJob(study)) await go({ resume: true }); return study; },
    get study() { return study; },
    get running() { return running; },
  };
}
