// Emulator drawer: the per-project emulator (src/emulator.js). A study is one scenario (existing conditions or a saved
// proposed design) and 1–6 parameters with ranges; its training runs are ordinary solver runs, kept in the project's
// runs folder, so a study resumes where it stopped and retrains from what is already there. Once trained, sliders give
// a flood map at any values inside the box, with an error estimate per cell, the control lines' peaks and the new
// buildings' water levels; leave-one-out and held-out runs say how far to trust it, "Check with the solver" confirms a
// point, and "Add a run where it's least sure" improves it. Emulated maps can go to the Compare drawer, marked as
// emulated (screening only). Files: emulators/<name>/study.json, model.json, *.f32, mask.u8, validation.json.
import * as E from '../src/emulator.js';
import * as C from '../src/compare.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FT = 0.3048, FT3 = 0.028316846592;
const fmtNum = (v, dp) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }) : '–');
/** Which forcing part of the fingerprint each forcing parameter changes (design numbers change none: they are the design). */
const PART = { ari: 'storm', rain: 'storm', inflow: 'inflow', tide: 'tide', se: 'antecedent' };
const MAX_BYTES = 1e9;
const VIEWS = { depth: 'Max depth', speed: 'Max speed', dur: 'Time above 15 cm', sd: 'Uncertainty (±1σ water level)' };

export function initEmulator(map, api) {
  let study = null, em = null, val = null, values = null, pred = null, view = 'depth', busy = false, cancel = false;
  const canvas = document.createElement('canvas');
  const note = (t, cls = '') => { $('emuNote').textContent = t; $('emuNote').className = 'note ' + cls; };
  const us = () => api.units() === 'us';
  const fmtParam = (p, v) => (p.unit === 'm' ? (us() ? `${fmtNum(v / FT, 2)} ft` : `${fmtNum(v, 2)} m`) : p.unit === 'yr' ? `${fmtNum(v, v < 10 ? 1 : 0)}-yr` : p.unit === '×' ? `× ${fmtNum(v, 2)}` : fmtNum(v, 2) + (p.unit ? ' ' + p.unit : ''));
  const dirOf = (name) => 'emulators/' + name.replace(/[^\w\-() ]+/g, ' ').replace(/\s+/g, '-').slice(0, 40);

  // ---------------------------------------------------------------- studies on disk
  async function listStudies() {
    if (!api.project()) return [];
    try { const t = await api.readText('emulators/index.json'); return JSON.parse(t); } catch { return []; }
  }
  async function saveStudy() {
    if (!study || !api.project()) return;
    await api.writeFile(`${dirOf(study.name)}/study.json`, JSON.stringify(study, null, 1));
    const list = await listStudies(); if (!list.includes(study.name)) { list.push(study.name); await api.writeFile('emulators/index.json', JSON.stringify(list)); }
  }
  async function loadStudy(name) {
    study = JSON.parse(await api.readText(`${dirOf(name)}/study.json`)); em = null; val = null; pred = null;
    try {
      const d = dirOf(name), json = JSON.parse(await api.readText(`${d}/model.json`)), blobs = {};
      for (const k of json.blobs) blobs[k] = C.decodeF32(await api.readBytes(`${d}/${k}.f32`), NaN);
      const mask = await api.readBytes(`${d}/mask.u8`), noData = await api.readBytes(`${d}/nodata.u8`);
      em = { ...E.deserialize(json.model, blobs), mask: Uint8Array.from(mask), noData: Uint8Array.from(noData), lines: json.lines, buildings: json.buildings };
      try { val = JSON.parse(await api.readText(`${d}/validation.json`)); } catch { val = null; }
    } catch { em = null; }
    values = Object.fromEntries(study.params.map(p => [p.key, p.value ?? E.fromUnit(p, 0.5)]));
    render(); if (em) await show();
  }
  async function fillStudies(sel = study?.name) {
    const list = await listStudies();
    $('emuStudy').innerHTML = '<option value="">New study…</option>' + list.map(n => `<option>${esc(n)}</option>`).join('');
    $('emuStudy').value = list.includes(sel) ? sel : '';
  }

  // ---------------------------------------------------------------- defining a study
  function renderNew() {
    const box = $('emuNew'); box.hidden = !!study;
    if (study) return;
    if (!api.ready()) { box.innerHTML = '<p class="iinfo">Build a model first.</p>'; return; }
    const scs = api.scenarios(), sc = $('emuScn')?.value ?? api.activeScenario() ?? '';
    const ps = api.params(sc || null);
    box.innerHTML = `<label class="ifield"><span>Name</span><input id="emuName" value="${esc(sc || 'Existing conditions')} study"></label>
      <label class="ifield"><span>Scenario</span><select id="emuScn"><option value="">Existing conditions</option>${scs.map(n => `<option${n === sc ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <p class="hint">Pick what to vary (up to 6) and its range. Everything else stays as it is set now, for every training run.</p>
      <table class="dtab"><thead><tr><th></th><th>Parameter</th><th>from</th><th>to</th></tr></thead><tbody>${ps.map((p, i) => `<tr><td><input type="checkbox" data-i="${i}" ${['ari', 'se'].includes(p.key) || p.key.startsWith('design:') && i < 4 ? 'checked' : ''}></td>
        <td>${esc(p.label)}${p.unit ? ` <i>${esc(p.unit === 'm' && us() ? 'ft' : p.unit)}</i>` : ''}</td><td><input class="emu-num" data-lo="${i}" value="${shown(p, p.min)}"></td><td><input class="emu-num" data-hi="${i}" value="${shown(p, p.max)}"></td></tr>`).join('')}</tbody></table>
      <label class="ifield"><span>Training runs <i>plus the centre</i></span><input id="emuN" inputmode="numeric" value=""></label>
      <label class="ifield"><span>Held-out test runs</span><input id="emuHold" inputmode="numeric" value="3"></label>
      <div class="row"><button class="btn" id="emuCreate" type="button">Create study</button></div>`;
    $('emuScn').onchange = () => renderNew();
    const count = () => box.querySelectorAll('input[type=checkbox]:checked').length, upd = () => { $('emuN').placeholder = String(E.planSize(Math.max(1, count()))); };
    box.querySelectorAll('input[type=checkbox]').forEach(c => { c.onchange = upd; }); upd();
    $('emuCreate').onclick = () => create(ps).catch(e => note(e.message, 'warn'));
  }
  const shown = (p, v) => (p.unit === 'm' && us() ? +(v / FT).toFixed(2) : +v.toFixed(p.unit === 'yr' ? 0 : 3));
  const unshown = (p, v) => (p.unit === 'm' && us() ? v * FT : v);
  /** Slider values on round steps for the forcing (so two studies can be set to the same storm and soil, whose
   *  fingerprints must match to compare); design numbers stay continuous. Type a value for anything else. */
  const snap = (p, v) => {
    const step = p.key === 'ari' ? (v < 10 ? 0.1 : 1) : ['rain', 'inflow', 'se'].includes(p.key) ? 0.01 : p.key === 'tide' ? 0.01 : 0;
    return step ? Math.min(p.max, Math.max(p.min, Math.round(v / step) * step)) : v;
  };
  async function create(ps) {
    if (!api.project()) throw new Error('Save the project first: a study keeps its training runs in the project folder.');
    const box = $('emuNew'), picked = [...box.querySelectorAll('input[type=checkbox]:checked')].map(c => Number(c.dataset.i));
    if (!picked.length || picked.length > 6) throw new Error('Pick 1 to 6 parameters.');
    const params = picked.map(i => {
      const p = ps[i], lo = unshown(p, Number(box.querySelector(`[data-lo="${i}"]`).value)), hi = unshown(p, Number(box.querySelector(`[data-hi="${i}"]`).value));
      if (!(hi > lo)) throw new Error(`${p.label}: the range is empty`);
      if (p.log && !(lo > 0)) throw new Error(`${p.label}: must be above 0`);
      if (p.key === 'ari' && (lo < 1 || hi > 1000)) throw new Error('Return period: Atlas 14 covers 1–1000 yr');
      return { key: p.key, label: p.label, unit: p.unit, kind: p.kind ?? null, min: lo, max: hi, log: !!p.log, value: Math.min(hi, Math.max(lo, p.value)) };
    });
    const name = $('emuName').value.trim() || 'study', list = await listStudies();
    if (list.includes(name)) throw new Error(`A study called "${name}" exists: pick another name.`);
    const n = Number($('emuN').value) || E.planSize(params.length), hold = Math.max(0, Math.min(10, Number($('emuHold').value) || 0));
    study = { name, scenario: $('emuScn').value || null, params, plan: E.trainingPlan(params.length, { n: Math.max(4, Math.min(120, n)), holdout: hold, seed: 1 + list.length }),
      runs: {}, walls: {}, fixed: null, F: null, version: api.version(), commit: api.commit(), created: new Date().toISOString() };
    api.resetPrep(); await saveStudy(); await fillStudies(name); values = Object.fromEntries(params.map(p => [p.key, p.value])); em = null; val = null; render();
    note(`Study created: ${study.plan.length} runs to do. Press Run training.`);
  }

  // ---------------------------------------------------------------- training runs
  /** Parameter values (user units) → the overrides an emulator run reads. */
  function overrides(vals) {
    const o = { design: {} };
    for (const p of study.params) { const v = vals[p.key]; if (p.key.startsWith('design:')) o.design[p.key.slice(7)] = v; else o[p.key] = v; }
    if (!Object.keys(o.design).length) delete o.design;
    return o;
  }
  const valuesAt = (u) => Object.fromEntries(study.params.map((p, i) => [p.key, E.fromUnit(p, u[i])]));
  const varied = () => new Set(study.params.map(p => PART[p.key]).filter(Boolean));
  /** The fingerprint parts that must match across a study's runs (everything the study does not vary). */
  const fixedOf = (fp) => Object.fromEntries(Object.entries(fp?.parts ?? {}).filter(([k]) => !varied().has(k)));
  async function runPoint(pt, label) {
    const r = await api.runAt(study.scenario, overrides(valuesAt(pt.u)), label, () => {});
    const fx = fixedOf(r.record.forcing);
    if (study.fixed && Object.keys(fx).some(k => fx[k] !== study.fixed[k])) {
      const diff = Object.keys(fx).filter(k => fx[k] !== study.fixed[k]).map(k => C.FORCING_PARTS[k]);
      throw new Error(`Settings changed since this study's first run (${diff.join('; ')}). Put them back, or start a new study.`);
    }
    study.fixed ??= fx; study.F ??= r.F; study.runs[pt.id] = r.dir; study.walls[pt.id] = r.wall; await saveStudy();
    return r;
  }
  async function runTraining() {
    if (busy) return; busy = true; cancel = false; $('emuRun').disabled = true; $('emuCancel').disabled = false;
    try {
      const todo = study.plan.filter(p => !study.runs[p.id]);
      if (!todo.length) { note('Every training run is done. Press Train.'); return; }
      const t0 = performance.now();
      for (let i = 0; i < todo.length; i++) {
        if (cancel) { note(`Stopped: ${i} run${i === 1 ? '' : 's'} done this time, ${todo.length - i} left. Run training resumes.`); return; }
        const walls = Object.values(study.walls).filter(Number.isFinite), per = walls.length ? walls.reduce((a, b) => a + b, 0) / walls.length : null;
        note(`Run ${i + 1} of ${todo.length} (${todo[i].role === 'holdout' ? 'held-out test' : 'training'})${per ? ` · about ${fmtDur(per * (todo.length - i))} left` : ''}…`);
        await runPoint(todo[i], `emu-${study.name}-${todo[i].id}`);
      }
      note(`All ${study.plan.length} runs done in ${fmtDur((performance.now() - t0) / 1000)}. Training…`); await train();
    } catch (e) { console.error(e); note(cancel ? 'Stopped.' : 'Training runs stopped: ' + e.message, 'warn'); }
    finally { busy = false; $('emuRun').disabled = false; $('emuCancel').disabled = true; render(); }
  }
  const fmtDur = (s) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

  // ---------------------------------------------------------------- training
  async function readRun(dir) {
    const g = async (k) => C.decodeF32(await api.readBytes(`runs/${dir}/grids/${k}.f32`));
    const js = async (p, d) => { try { return JSON.parse(await api.readText(`runs/${dir}/${p}`)); } catch { return d; } };
    return { g, js };
  }
  async function train() {
    const geo = api.geo(); if (!geo) throw new Error('Build the model first.');
    const { nx, ny } = geo, N = nx * ny, pts = study.plan.filter(p => study.runs[p.id]), tr = pts.filter(p => p.role === 'train'), ho = pts.filter(p => p.role === 'holdout');
    if (tr.length < 4) throw new Error('At least 4 training runs are needed.');
    note('Training: reading the runs…');
    // pass 1: the mask (wet in any run, widened) and the cells no run has (walls, outside the model)
    let wetAny = new Uint8Array(N); const noData = new Uint8Array(N).fill(1);
    for (const p of tr) {
      const { g } = await readRun(study.runs[p.id]), w = await g('max_wse'), sp = await g('max_speed');
      if (w.length !== N) throw new Error('these runs are on a different model grid than the one built now');
      for (let k = 0; k < N; k++) { if (Number.isFinite(w[k])) wetAny[k] = 1; if (Number.isFinite(sp[k])) noData[k] = 0; }
    }
    const mask = E.fieldMask([Float32Array.from(wetAny, v => (v ? 0 : NaN))], nx, ny, { walls: noData });
    let M = 0; for (const v of mask) M += v;
    if (!M) throw new Error('No cell got wet in any training run: nothing to emulate.');
    if (tr.length * M * 4 * 3 > MAX_BYTES) throw new Error(`Too big to train in the browser (${tr.length} runs × ${M.toLocaleString()} cells). Use fewer runs or a smaller model area.`);
    // pass 2: fields and scalars
    const runs = [], lineIds = new Map(), bldRings = new Map(), truth = new Map();
    for (const p of pts) {
      const { g, js } = await readRun(study.runs[p.id]), w = await g('max_wse'), z = await g('ground'), sp = await g('max_speed'), du = await g('t_above15');
      const wse = E.fillWse(w, z, mask, nx, ny), speed = E.maskOf(sp, mask).map(v => (Number.isFinite(v) && v > 0 ? Math.sqrt(v) : 0)), dur = E.maskOf(du, mask).map(v => (Number.isFinite(v) ? v : 0));
      const scalars = {};
      for (const l of await js('lines.json', [])) { const s = C.lineStats(l); lineIds.set(String(l.id), l.name ?? null); scalars[`line:${l.id}:peak`] = s.peak; scalars[`line:${l.id}:volume`] = s.volume; }
      for (const b of await js('buildings.json', [])) {
        bldRings.set(String(b.id), { name: b.name ?? null, ring: b.ring, ffe: b.ffe, critical: b.critical ?? b.ffe });
        let m = -Infinity, zg = -Infinity; for (const k of b.ring ?? []) { if (Number.isFinite(w[k])) m = Math.max(m, w[k]); zg = Math.max(zg, z[k]); }
        scalars[`bld:${b.id}`] = Number.isFinite(m) ? m : zg;
      }
      const sm = await js('summary.json', {}); for (const k of ['outflow', 'infil']) if (Number.isFinite(sm.books?.[k])) scalars[`books:${k}`] = sm.books[k];
      const rec = { u: p.u, wse, speed, dur, scalars, z: E.maskOf(z, mask) };
      if (p.role === 'train') runs.push(rec); else truth.set(p.id, rec);
      note(`Training: read ${runs.length + truth.size} of ${pts.length} runs…`); await new Promise(r => setTimeout(r));
    }
    note(`Training: fitting ${runs.length} runs on ${M.toLocaleString()} cells…`); await new Promise(r => setTimeout(r, 30));
    const t0 = performance.now(), model = E.train(runs);
    // validation: leave-one-out on the training runs, then the held-out runs
    const loo = E.looFields(model.fields.wse), looS = model.scalars ? E.looScalars(model.scalars) : {};
    const rows = runs.map((r, i) => ({ id: tr[i].id, kind: 'leave-one-out', ...E.depthError(E.depthFrom(r.wse, r.z), E.depthFrom(loo[i], r.z)), peakErr: peakErr(r.scalars, (k) => looS[k]?.pred[i]) }));
    for (const p of ho) { const r = truth.get(p.id), pr = E.predict(model, p.u); rows.push({ id: p.id, kind: 'held out', ...E.depthError(E.depthFrom(r.wse, r.z), E.depthFrom(pr.wse, r.z)), peakErr: peakErr(r.scalars, (k) => pr.scalars[k]?.mean) }); }
    const pick = (kind) => rows.filter(r => r.kind === kind), med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
    const basis = ho.length ? pick('held out') : pick('leave-one-out'), worst = basis.reduce((a, r) => (r.rmse > (a?.rmse ?? -1) ? r : a), null);
    val = { rows, summary: { basis: ho.length ? 'held-out runs' : 'leave-one-out (no held-out runs)', typical: med(basis.map(r => r.rmse)), worst: worst?.rmse ?? NaN, worstId: worst?.id ?? null, csi: Math.min(...basis.map(r => r.csi)), peak: ((a) => (a.length ? Math.max(...a) : NaN))(basis.map(r => r.peakErr).filter(Number.isFinite)) },
      components: model.fields.wse.K, kept: model.fields.wse.kept, cells: M, runs: runs.length, ms: performance.now() - t0, trained: new Date().toISOString(), version: api.version(), commit: api.commit() };
    em = { ...model, mask, noData, lines: Object.fromEntries(lineIds), buildings: Object.fromEntries(bldRings) };
    // save
    const d = dirOf(study.name), { json, blobs } = E.serialize(model);
    for (const [k, v] of Object.entries(blobs)) await api.writeFile(`${d}/${k}.f32`, C.encodeF32(v));
    await api.writeFile(`${d}/mask.u8`, mask); await api.writeFile(`${d}/nodata.u8`, noData);
    await api.writeFile(`${d}/model.json`, JSON.stringify({ model: json, blobs: Object.keys(blobs), lines: em.lines, buildings: em.buildings }));
    await api.writeFile(`${d}/validation.json`, JSON.stringify(val, null, 1));
    study.trained = { at: val.trained, version: val.version, commit: val.commit, runs: runs.length, components: val.components }; await saveStudy();
    note(`Trained on ${runs.length} runs in ${(val.ms / 1000).toFixed(1)} s: typical depth error ${fmtLen(val.summary.typical)}, worst ${fmtLen(val.summary.worst)} (${val.summary.basis}).`);
    render(); await show();
  }
  /** Largest relative error of a run's control-line peaks (scalars line:<id>:peak), as a fraction. */
  function peakErr(sc, predOf) {
    let m = NaN; for (const [k, v] of Object.entries(sc)) if (k.endsWith(':peak') && Math.abs(v) > 1e-6) { const p = predOf(k); if (Number.isFinite(p)) m = Math.max(Number.isFinite(m) ? m : 0, Math.abs(p - v) / Math.abs(v)); }
    return m;
  }
  const fmtLen = (m) => (!Number.isFinite(m) ? '–' : us() ? `${fmtNum(m / FT * 12, m < 0.0254 ? 2 : 1)} in` : m < 0.01 ? `${fmtNum(m * 1000, 1)} mm` : `${fmtNum(m * 100, 1)} cm`);

  // ---------------------------------------------------------------- predicting
  const uOf = (vals) => study.params.map(p => E.toUnit(p, vals[p.key]));
  const designValues = (vals) => Object.fromEntries(study.params.filter(p => p.key.startsWith('design:')).map(p => [p.key.slice(7), vals[p.key]]));
  async function show() {
    if (!em || !study) return;
    const bad = E.outOfRange(study.params, values);
    if (bad.length) { pred = null; draw(); $('emuOut').innerHTML = `<p class="iinfo warn">Outside the trained range: ${bad.map(b => esc(study.params.find(p => p.key === b.key).label)).join(', ')}. The emulator only answers inside the box it was trained on.</p>`; return; }
    const t0 = performance.now(), u = uOf(values), pr = E.predict(em, u), { f } = api.designAt(study.scenario, designValues(values)), zm = E.maskOf(f.z, em.mask);
    pred = { ...pr, depth: E.depthFrom(pr.wse, zm), z: zm, f, ms: performance.now() - t0 };
    draw(); renderOut();
  }
  function draw() {
    const geo = api.geo(); if (!geo) return;
    const { nx, ny } = geo; canvas.width = nx; canvas.height = ny;
    const img = new ImageData(nx, ny), px = img.data;
    if (pred && em) {
      const v = view === 'depth' ? pred.depth : view === 'speed' ? pred.speed : view === 'dur' ? pred.dur : pred.wseSd, cap = { depth: 1.5, speed: 2, dur: 3600, sd: 0.3 }[view];
      let m = 0;
      for (let k = 0; k < nx * ny; k++) {
        if (!em.mask[k]) continue; const x = v[m], h = pred.depth[m]; m++;
        if (!(h > 0.01) || !(x > 0)) continue;
        const t = Math.min(1, x / cap), c = view === 'sd' ? [255, 200 - 150 * t, 80 - 60 * t] : [198 - 190 * t, 219 - 160 * t, 239 - 100 * t];
        px.set([c[0], c[1], c[2], 110 + 140 * t], 4 * k);
      }
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
    api.setOverlay(canvas, !!pred && !$('emuDrawer').hidden);
  }
  function renderOut() {
    if (!pred) return;
    const L = (m) => (us() ? `${fmtNum(m / FT, 2)} ft` : `${fmtNum(m, 2)} m`), Q = (q) => (us() ? `${fmtNum(q / FT3, 2)} cfs` : `${fmtNum(q, 3)} m³/s`);
    let peak = 0, wet = 0, sdMax = 0; const A = (api.geo().dx) ** 2;
    for (let m = 0; m < pred.depth.length; m++) { const h = pred.depth[m]; if (h > peak) peak = h; if (h > 0.15) wet += A; if (h > 0.01 && pred.wseSd[m] > sdMax) sdMax = pred.wseSd[m]; }
    const sc = pred.scalars, lines = Object.entries(em.lines ?? {}).map(([id, name]) => sc[`line:${id}:peak`] ? `<tr><td>${esc(name ?? id)}</td><td>${Q(sc[`line:${id}:peak`].mean)}</td><td>± ${Q(2 * sc[`line:${id}:peak`].sd)}</td></tr>` : '').join('');
    const blds = Object.entries(em.buildings ?? {}).map(([id, b]) => { const s = sc[`bld:${id}`]; if (!s) return ''; const crit = b.critical ?? b.ffe, fl = s.mean > crit; return `<tr><td>${esc(b.name ?? 'New ' + id)}</td><td>${L(s.mean)}</td><td>${L(crit)}</td><td>${fl ? '<b class="warn">flooded</b>' : s.mean + 2 * s.sd > crit ? '<span class="warn">close</span>' : 'dry'}</td></tr>`; }).join('');
    $('emuOut').innerHTML = `<p class="iinfo"><b>Emulated: screening only.</b> Peak depth ${L(peak)}, ${us() ? fmtNum(wet / FT / FT, 0) + " ft² deeper than 6 in" : fmtNum(wet, 0) + " m² deeper than 15 cm"}. Largest uncertainty on wet cells ±${fmtLen(sdMax)} (1σ). ${pred.ms.toFixed(0)} ms.</p>` +
      (lines ? `<h3>Control lines</h3><table class="dtab"><thead><tr><th>Line</th><th>Peak</th><th>95 %</th></tr></thead><tbody>${lines}</tbody></table>` : '') +
      (blds ? `<h3>New buildings</h3><table class="dtab"><thead><tr><th>Building</th><th>Water</th><th>Floor</th><th></th></tr></thead><tbody>${blds}</tbody></table>` : '') +
      '<div class="row"><button class="btn" id="emuCheck" type="button" title="Run the solver at these values and compare it with the emulator">Check with the solver</button>' +
      '<button class="btn" id="emuMore" type="button" title="Run the solver where the emulator is least sure, add it to the training and retrain">Add a run where it’s least sure</button>' +
      '<button class="btn" id="emuSend" type="button" title="Send this emulated map to the Compare drawer, marked as emulated">Send to Compare</button>' +
      '<button class="btn" id="emuExport" type="button">Export grids</button></div><div class="props" id="emuCheckOut"></div>';
    $('emuCheck').onclick = () => check().catch(e => note('Check failed: ' + e.message, 'warn'));
    $('emuMore').onclick = () => more().catch(e => note('Adding a run failed: ' + e.message, 'warn'));
    $('emuSend').onclick = () => send().catch(e => note(e.message, 'warn'));
    $('emuExport').onclick = () => exportGrids().catch(e => note('Export failed: ' + e.message, 'warn'));
  }
  /** Full-grid emulated grids for the current values (NaN where no run has data, 0 where dry). */
  function fullGrids() {
    const nd = (vec, dry = 0) => { const g = E.unmask(vec, em.mask, dry); for (let k = 0; k < g.length; k++) if (em.noData[k]) g[k] = NaN; return g; };
    const depth = nd(pred.depth), wseV = pred.wse.map((v, m) => (pred.depth[m] > 0.005 ? v : NaN)), wse = nd(wseV, NaN);
    const speed = nd(pred.speed.map((v, m) => (pred.depth[m] > 0.05 ? v : 0))), dur = nd(pred.dur.map((v, m) => (pred.depth[m] > 0.15 ? v : 0)));
    return { max_depth: depth, max_wse: wse, max_speed: speed, max_dv: depth.map((h, k) => h * speed[k]), t_wet: new Float32Array(depth.length).fill(NaN), t_above15: dur, final_depth: new Float32Array(depth.length).fill(NaN), sd: nd(pred.wseSd, NaN) };
  }
  const valuesText = (vals) => study.params.map(p => `${p.label} ${fmtParam(p, vals[p.key])}`).join(', ');

  async function check() {
    if (busy) return; busy = true;
    try {
      note('Running the solver at these values…');
      const vals = { ...values }, u = uOf(vals), r = await api.runAt(study.scenario, overrides(vals), `emu-${study.name}-check`, () => {});
      const { f } = api.designAt(study.scenario, designValues(vals)), zFull = f.z, geo = api.geo();
      const t = E.fillWse(r.record.grids.max_wse, zFull, em.mask, geo.nx, geo.ny), zm = E.maskOf(zFull, em.mask), p = E.predict(em, u), err = E.depthError(E.depthFrom(t, zm), E.depthFrom(p.wse, zm));
      const id = 'x' + study.plan.filter(q => q.id.startsWith('x')).length; study.plan.push({ id, u, role: 'train' }); study.runs[id] = r.dir; study.walls[id] = r.wall; await saveStudy();
      $('emuCheckOut').innerHTML = `<p class="iinfo">Solver vs emulator at ${esc(valuesText(vals))}: depth RMSE <b>${fmtLen(err.rmse)}</b>, worst cell ${fmtLen(err.maxAbs)}, extent (15 cm) CSI <b>${fmtNum(err.csi, 3)}</b>. The run is in the project and joins the training next time you press Train.</p>`;
      note('Checked. The solver run is the one to report.');
    } finally { busy = false; }
  }
  async function more() {
    if (busy) return; busy = true;
    try {
      const { u } = E.leastSure(em, study.params.length, { n: 1500 }), id = 'a' + study.plan.filter(q => q.id.startsWith('a')).length;
      study.plan.push({ id, u, role: 'train' }); await saveStudy();
      note(`Running the solver where the emulator is least sure (${valuesText(valuesAt(u))})…`);
      await runPoint(study.plan.at(-1), `emu-${study.name}-${id}`);
    } finally { busy = false; }
    await train();
  }
  async function send() {
    const g = fullGrids(), fv = Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith('design:')));
    const forcing = await api.forcingAt(overrides(fv), study.F);
    const { f, log } = api.designAt(study.scenario, designValues(values)), geo = api.geo();
    const lines = Object.entries(em.lines ?? {}).map(([id, name]) => ({ id: isNaN(Number(id)) ? id : Number(id), name, emulated: true, peak: pred.scalars[`line:${id}:peak`]?.mean ?? NaN, volume: pred.scalars[`line:${id}:volume`]?.mean ?? NaN }));
    const newBuildings = (f.designBuildings ?? []).map(b => ({ id: b.id, name: b.name, ffe: b.ffe, critical: b.foundation === 'basement' ? b.opening : b.ffe, foundation: b.foundation, cells: b.cells, ring: b.ring }));
    const when = new Date();
    api.addRecord({ id: 'emu:' + when.getTime(), emulated: { study: study.name, values: { ...values }, error: val ? fmtLen(val.summary.typical) + ' depth RMSE' : null, sd: g.sd }, scenario: study.scenario,
      label: `EMULATED ${study.scenario ?? 'Existing conditions'} · ${valuesText(values)}`, saved: when.toISOString(), forcing, version: api.version(), commit: api.commit(), designHash: null, storm: valuesText(values), geo,
      grids: Object.fromEntries(Object.keys(C.GRIDS).map(k => [k, g[k]])), hazard: new Float32Array(geo.nx * geo.ny).fill(NaN), lines, newBuildings, books: null,
      design: log ? { name: study.scenario, totals: { ...log.totals, ...(api.model().baseWse || log.settings?.bfe != null ? {} : { floodFill: NaN, compCut: NaN }) } } : null }); // floodplain fill needs a flood level
    note('Sent to Compare (marked emulated). Send the other scenario at the same values to compare the two.');
  }
  async function exportGrids() {
    const g = fullGrids(), geo = api.geo(), hdr = C.gridHeader(geo), files = [];
    for (const k of ['max_depth', 'max_wse', 'max_speed', 't_above15', 'sd']) files.push({ name: `emulated_${k}.asc`, data: new TextEncoder().encode(C.toASC(g[k], geo, 3)) });
    files.push({ name: 'README.txt', data: new TextEncoder().encode(`FloodSim emulated grids (screening only): study "${study.name}", ${valuesText(values)}.\nsd = ±1σ of the max water surface (m).\nValidation: ${val ? `typical depth error ${fmtLen(val.summary.typical)}, worst ${fmtLen(val.summary.worst)} (${val.summary.basis})` : 'none'}.\n${hdr}`) });
    const d = `${dirOf(study.name)}/exports/${when()}`; for (const f of files) await api.writeFile(`${d}/${f.name}`, f.data);
    note(`Exported to ${d} in the project folder.`);
  }
  const when = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  // ---------------------------------------------------------------- the panel
  function render() {
    renderNew();
    $('emuStudyBox').hidden = !study;
    if (!study) { $('emuOut').innerHTML = ''; return; }
    const done = study.plan.filter(p => study.runs[p.id]).length, stale = study.trained && study.trained.commit !== api.commit();
    $('emuStatus').innerHTML = `<p class="iinfo"><b>${esc(study.scenario ?? 'Existing conditions')}</b>, ${study.params.length} parameter${study.params.length > 1 ? 's' : ''}: ${done} of ${study.plan.length} runs done` +
      `${study.trained ? `, trained ${new Date(study.trained.at).toLocaleString()} on ${study.trained.runs} runs (${study.trained.components} components)` : ''}.` +
      `${stale ? '<br><span class="warn">The app changed since training: its runs may not match a new run. Rerun the study to be sure.</span>' : ''}</p>` +
      (val ? `<p class="iinfo">Typical depth error <b>${fmtLen(val.summary.typical)}</b>, worst <b>${fmtLen(val.summary.worst)}</b>${val.summary.worstId ? ` (run ${esc(val.summary.worstId)})` : ''}, extent CSI ≥ <b>${fmtNum(val.summary.csi, 2)}</b>` +
        `${Number.isFinite(val.summary.peak) ? `, control-line peaks within <b>${fmtNum(val.summary.peak * 100, 0)} %</b>` : ''} — ${esc(val.summary.basis)}.</p>` +
        `<details><summary>Validation per run</summary><table class="dtab"><thead><tr><th>Run</th><th>Test</th><th>RMSE</th><th>worst</th><th>CSI</th></tr></thead><tbody>${val.rows.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${fmtLen(r.rmse)}</td><td>${fmtLen(r.maxAbs)}</td><td>${fmtNum(r.csi, 3)}</td></tr>`).join('')}</tbody></table></details>` : '');
    $('emuTrain').disabled = done < 4;
    $('emuSliders').innerHTML = em ? study.params.map((p, i) => `<div class="ifield emu-slider"><span>${esc(p.label)} <b id="emuV${i}">${esc(fmtParam(p, values[p.key]))}</b>
      <input class="emu-num" id="emuT${i}" inputmode="decimal" aria-label="${esc(p.label)}, exact value" value="${shown(p, values[p.key])}"></span><input type="range" min="0" max="1" step="0.001" value="${E.toUnit(p, values[p.key])}" data-i="${i}" aria-label="${esc(p.label)}"></div>`).join('') : '<p class="hint">Run the training, then press Train to use the sliders.</p>';
    $('emuSliders').querySelectorAll('input[type=range]').forEach(s => {
      const i = Number(s.dataset.i), p = study.params[i];
      const set = (v) => { values[p.key] = v; $('emuV' + i).textContent = fmtParam(p, v); $('emuT' + i).value = shown(p, v); };
      s.oninput = () => set(snap(p, E.fromUnit(p, Number(s.value))));
      s.onchange = () => show();
      $('emuT' + i).onchange = () => { const v = unshown(p, Number($('emuT' + i).value)); if (!Number.isFinite(v)) return; set(v); s.value = String(Math.min(1, Math.max(0, E.toUnit(p, v)))); show(); };
    });
    $('emuViewBox').hidden = !em;
  }

  // ---------------------------------------------------------------- wiring
  $('emuToggle').onclick = () => toggle(); $('emuClose').onclick = () => toggle(false);
  function toggle(on = $('emuDrawer').hidden) {
    $('emuDrawer').hidden = !on; $('emuToggle').setAttribute('aria-expanded', on);
    if (on) { for (const id of ['design', 'infra', 'cmpDrawer']) if (!$(id).hidden) $(id === 'cmpDrawer' ? 'cmpClose' : id + 'Close').click(); fillStudies().then(render); }
    api.setOverlay(canvas, on && !!pred);
  }
  for (const id of ['designToggle', 'infraToggle', 'cmpToggle']) $(id).addEventListener('click', () => { if (!$('emuDrawer').hidden) toggle(false); });
  $('emuStudy').onchange = () => { const n = $('emuStudy').value; if (n) loadStudy(n).catch(e => note(e.message, 'warn')); else { study = null; em = null; val = null; pred = null; draw(); render(); } };
  $('emuRun').onclick = () => runTraining();
  $('emuCancel').onclick = () => { cancel = true; api.cancelRun(); note('Stopping…'); };
  $('emuTrain').onclick = async () => { if (busy) return; busy = true; try { await train(); } catch (e) { console.error(e); note('Training failed: ' + e.message, 'warn'); } finally { busy = false; } };
  $('emuView').onchange = () => { view = $('emuView').value; draw(); };
  $('emuView').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  return {
    /** The model was rebuilt or a project opened: forget the open study (its runs stay in the project). */
    reset() { study = null; em = null; val = null; pred = null; api.resetPrep(); draw(); if (!$('emuDrawer').hidden) fillStudies().then(render); },
  };
}
