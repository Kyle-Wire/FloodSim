// Projects: a folder per project on this computer (the local server writes them under Documents\FloodSim Projects).
//   project.json             area, every setting, storm and drainage choices (enough to rebuild and rerun)
//   infrastructure.geojson   the drawer layer
//   runs/<date time>/        one folder per saved run: summary, max depth / speed grids (.asc + .prj), SWMM files
//   analysis.geojson         control lines and the site boundary (shared by all scenarios)
//   comparisons/<time>/      exported comparisons (Δ grids, tables, summary)
//   scenarios/<name>/        one folder per site-design scenario: design.geojson (the features, every value on them)
//                            and scenario.json (settings, presets used and every resolved value: FFE, pad, cut / fill)
const $ = (id) => document.getElementById(id);
const H = { 'x-floodsim': '1' };
const api = (path, o = {}) => fetch(path, { ...o, headers: { ...H, ...(o.headers || {}) } }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r; });
const q = (o) => new URLSearchParams(o).toString();

/** Folder name from a project name: letters, digits, spaces and - _ ( ) & , ' only. */
export const folderName = (name) => name.replace(/[^\w\-()&,' ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Project';
export const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

export async function writeFile(folder, path, data) {
  await api('/api/projects/file?' + q({ folder, path }), { method: 'POST', body: typeof data === 'string' ? new TextEncoder().encode(data) : data });
}
export async function readFile(folder, path) { return (await api('/api/projects/file?' + q({ folder, path }))).text(); }
export async function readBytes(folder, path) { return new Uint8Array(await (await api('/api/projects/file?' + q({ folder, path }))).arrayBuffer()); }
/** A file that may not be there: its text, or null. */
export async function readOptional(folder, path) { const r = await api('/api/projects/file?' + q({ folder, path, optional: 1 })); return r.status === 204 ? null : r.text(); }
/** The same as bytes, or null. */
export async function readBytesOptional(folder, path) { const r = await api('/api/projects/file?' + q({ folder, path, optional: 1 })); return r.status === 204 ? null : new Uint8Array(await r.arrayBuffer()); }

/**
 * @param capture  () => project object (settings, area …) without name/saved
 * @param layer    () => infrastructure FeatureCollection
 * @param restore  async (project, layer) => void: apply and rebuild
 * @param runFiles async () => [{ path, data }] for the finished run, or null when there is none
 * @param scenarios () => [{ name, design (FeatureCollection), json (scenario.json object) }] (site design)
 * @param analysis  () => control lines and site boundary FeatureCollection
 */
export function initProjects({ capture, layer, restore, runFiles, scenarios = () => [], analysis = () => null }) {
  let current = null; // { folder, name }
  try { current = JSON.parse(localStorage.getItem('floodsim.project')); } catch { /* storage off */ }
  const show = () => {
    $('projName').textContent = current ? current.name : 'Unsaved project'; $('projName').title = current ? `Documents\\FloodSim Projects\\${current.folder}` : '';
    $('saveRunBtn').hidden = !current;
    try { localStorage.setItem('floodsim.project', JSON.stringify(current)); } catch { /* storage off */ }
  };
  const status = (t, cls = '') => { const el = $('projStatus'); el.textContent = t; el.className = 'pstatus ' + cls; if (t) setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 6000); };

  async function save(target = current) {
    if (!target) { openDialog(true); return false; }
    const sc = scenarios().map(s => ({ ...s, folder: folderName(s.name) }));
    const pj = { ...capture(), name: target.name, saved: new Date().toISOString(), app: 'FloodSim', scenarios: sc.map(s => ({ name: s.name, folder: s.folder })) };
    await writeFile(target.folder, 'project.json', JSON.stringify(pj, null, 1));
    await writeFile(target.folder, 'infrastructure.geojson', JSON.stringify(layer()));
    const an = analysis(); if (an) await writeFile(target.folder, 'analysis.geojson', JSON.stringify(an));
    for (const s of sc) {
      await writeFile(target.folder, `scenarios/${s.folder}/design.geojson`, JSON.stringify(s.design, null, 1));
      await writeFile(target.folder, `scenarios/${s.folder}/scenario.json`, JSON.stringify({ ...s.json, name: s.name, saved: pj.saved }, null, 1));
    }
    current = target; show(); status('Saved', 'ok'); return true;
  }
  async function saveRun(label = '') {
    if (!current) return null;
    const files = await runFiles(); if (!files) { status('No finished run to save', 'warn'); return null; }
    const dir = 'runs/' + stamp() + (label ? '_' + folderName(label).replace(/ /g, '-').slice(0, 30) : '');
    for (const f of files) await writeFile(current.folder, dir + '/' + f.path, f.data);
    status(`Run saved to ${dir}`, 'ok'); return dir;
  }
  async function open(folder) {
    const pj = JSON.parse(await readFile(folder, 'project.json'));
    let lay = null; try { lay = JSON.parse(await readFile(folder, 'infrastructure.geojson')); } catch { /* none saved */ }
    const sc = [];
    for (const s of pj.scenarios ?? []) {
      try {
        const design = JSON.parse(await readFile(folder, `scenarios/${s.folder}/design.geojson`));
        let json = null; try { json = JSON.parse(await readFile(folder, `scenarios/${s.folder}/scenario.json`)); } catch { /* features only */ }
        sc.push({ name: s.name, design, json });
      } catch (e) { status(`Scenario “${s.name}” could not be read: ${e.message}`, 'warn'); }
    }
    let an = null; try { an = JSON.parse(await readFile(folder, 'analysis.geojson')); } catch { /* none saved */ }
    current = { folder, name: pj.name ?? folder }; show(); closeDialog();
    await restore(pj, lay, sc, an);
  }

  // ---------------------------------------------------------------- dialog
  const dlg = $('projDlg');
  async function openDialog(naming = false) {
    dlg.showModal(); $('projList').innerHTML = '<li class="muted">Loading…</li>';
    if (naming) $('projNewName').focus();
    try {
      const { dir, projects } = await (await api('/api/projects')).json();
      $('projDir').textContent = dir;
      $('projList').innerHTML = projects.length ? projects.map(p => `<li${current?.folder === p.folder ? ' class="cur"' : ''}><div><b>${esc(p.name)}</b><small>${esc(p.place || '')}${p.place ? ' · ' : ''}${p.saved ? new Date(p.saved).toLocaleString() : ''} · ${p.runs} run${p.runs === 1 ? '' : 's'}</small></div>` +
        `<button class="btn" data-open="${esc(p.folder)}">Open</button><button class="btn" data-reveal="${esc(p.folder)}" title="Show in Explorer">Folder</button></li>`).join('')
        : '<li class="muted">No projects yet. Name one above to save the current setup.</li>';
    } catch (e) { $('projList').innerHTML = `<li class="muted">Projects unavailable: ${esc(e.message)}. Start FloodSim with “Start FloodSim.cmd”.</li>`; }
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('projList').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.reveal) { api('/api/projects/reveal?' + q({ folder: b.dataset.reveal }), { method: 'POST' }).catch(() => {}); return; }
    if (b.dataset.open) { try { await open(b.dataset.open); } catch (err) { status('Open failed: ' + err.message, 'err'); } }
  };
  $('projNewForm').onsubmit = async (e) => {
    e.preventDefault(); const name = $('projNewName').value.trim(); if (!name) return;
    try {
      const { projects } = await (await api('/api/projects')).json(), folder = folderName(name);
      if (projects.some(p => p.folder.toLowerCase() === folder.toLowerCase()) && !confirm(`A project folder “${folder}” exists. Overwrite its settings?`)) return;
      await save({ folder, name }); $('projNewName').value = ''; closeDialog();
    } catch (err) { status('Save failed: ' + err.message, 'err'); }
  };
  $('projBtn').onclick = () => openDialog();
  $('projClose').onclick = () => closeDialog();
  $('projSave').onclick = () => save().catch(err => status('Save failed: ' + err.message, 'err'));
  $('projReveal').onclick = () => api('/api/projects/reveal', { method: 'POST' }).catch(() => {}); // the projects folder itself
  $('saveRunBtn').onclick = () => saveRun().catch(err => status('Saving the run failed: ' + err.message, 'err'));
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save().catch(err => status('Save failed: ' + err.message, 'err')); } });
  show();

  return {
    get current() { return current; },
    save, saveRun, open,
    /** A run finished: file it in the project when auto-save is on. */
    async runFinished() { if (current && $('projAutoRun').checked) await saveRun().catch(err => status('Saving the run failed: ' + err.message, 'err')); },
    close() { current = null; show(); },
  };
}
