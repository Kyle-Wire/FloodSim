// Site design drawer: scenarios of proposed buildings (with presets), pads, paved areas and demolitions drawn on the map.
// Each scenario is a lon/lat GeoJSON FeatureCollection in SI units over the frozen existing-conditions model; the drawer
// shows US or SI units. "Existing conditions" is always there and has no features. Every edit calls `onChange`, which
// applies the active scenario to the fine model (src/design.js applyDesign) and rebuilds the run inputs.
// Control lines and the site boundary are not part of any scenario: they sit in a shared analysis layer, so both runs of
// a comparison book the same lines (`onAnalysis` rebuilds the run inputs).
import { PRESETS, DEFAULTS, SETTINGS, FOUNDATIONS, ROOFS, LEVEL_HEIGHT, designFeature, applyPreset, bumpDesignIds } from '../src/design.js';
import { ringArea, lineLength } from '../src/infra.js';

const $ = (id) => document.getElementById(id);
const UNITS = {
  us: { elev: ['ft', 0.3048, 2], len: ['ft', 0.3048, 1], size: ['in', 0.0254, 1], area: ['ft²', 0.09290304, 0], vol: ['ft³', 0.028316846592, 0], cvol: ['gal', 0.003785411784, 0] },
  si: { elev: ['m', 1, 2], len: ['m', 1, 2], size: ['mm', 0.001, 0], area: ['m²', 1, 0], vol: ['m³', 1, 1], cvol: ['m³', 1, 1] },
};
const CONVERT = new Set(['elev', 'len', 'size', 'cvol']);
const NAMES = { building: 'Building', grade: 'Pad', paved: 'Paved area', demolish: 'Demolish', cline: 'Control line', site: 'Site boundary' };
const ANALYSIS = new Set(['cline', 'site']);
const COLORS = { building: '#f2a65a', grade: '#9ad17b', paved: '#9aa7b1', demolish: '#ff5d5d' };
const HINTS = {
  select: 'Click a feature to edit it. Delete removes the selection. Features apply in list order: later ones override earlier ones where they overlap.',
  building: 'Click the corners of the footprint; Enter, double-click, or a click on the first corner finishes. The preset sets the foundation, apron, roof and height.',
  grade: 'Click the corners of the pad. Flat at an elevation, a plane through three spot elevations (the first three corners), or flat where cut and fill balance.',
  paved: 'Click the corners of the driveway, parking, sidewalk or road. Impervious; optionally graded to an elevation with a cross slope or crown, and a curb.',
  demolish: 'Click a mapped building to remove it (or draw a polygon around several). The lidar is bare earth, so the ground under it is already there.',
  cline: 'Click along a control line (a property line, a site outlet, across a culvert or a street); double-click or Enter finishes. Every run books the flow across it each step; + is water crossing to the right of the line as drawn (outward for a closed line). Shared by all scenarios.',
  site: 'Click the corners of the site boundary; Enter, double-click, or a click on the first corner finishes. Comparisons split results into on-site and off-site with it. One per project, shared by all scenarios.',
};
const PCT = 'pct';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initDesign(map, { onChange, onAnalysis = () => {}, groundAt, manholes, buildingAt, ready }) {
  let scenarios = [], active = -1, tool = 'select', sel = null, draft = null, units = 'us', log = null, results = null, roofLinks = new Map();
  let analysis = { type: 'FeatureCollection', features: [] }; // control lines and the site boundary
  let lineResults = null; // control-line books of the last run: Map(id → { volume, plus, minus, peak, tPeak })
  try {
    const st = JSON.parse(localStorage.getItem('floodsim.design'));
    if (st?.scenarios) { scenarios = st.scenarios; active = st.active ?? -1; }
    analysis = JSON.parse(localStorage.getItem('floodsim.analysis')) ?? analysis;
    units = localStorage.getItem('floodsim.designUnits') ?? 'us';
  } catch { /* storage off */ }
  for (const s of scenarios) bumpDesignIds(s.design);
  bumpDesignIds(analysis);
  const defaults = structuredClone(DEFAULTS);
  const u = () => UNITS[units];
  const cur = () => scenarios[active] ?? null;
  const fc = () => cur()?.design ?? { type: 'FeatureCollection', features: [] };

  // ---------------------------------------------------------------- map layers
  ready.then(() => {
    map.addSource('design', { type: 'geojson', data: fc() });
    map.addSource('design-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const T = (t) => ['==', ['get', 'type'], t], selW = (a, b) => ['case', ['boolean', ['feature-state', 'sel'], false], b, a];
    map.addLayer({ id: 'design-fill', type: 'fill', source: 'design', paint: { 'fill-color': ['match', ['get', 'type'], ...Object.entries(COLORS).flat(), '#ffffff'],
      'fill-opacity': ['match', ['get', 'type'], 'building', 0.6, 'demolish', 0.3, 'paved', 0.45, 0.18] } });
    const lineColor = selW(['match', ['get', 'type'], ...Object.entries(COLORS).flat(), '#ffffff'], '#ffffff');
    map.addLayer({ id: 'design-line', type: 'line', source: 'design', filter: ['!=', ['get', 'type'], 'grade'], paint: { 'line-color': lineColor, 'line-width': selW(1.6, 3.2) } });
    map.addLayer({ id: 'design-grade-line', type: 'line', source: 'design', filter: T('grade'), paint: { 'line-color': lineColor, 'line-width': selW(1.6, 3.2), 'line-dasharray': [2, 1] } });
    map.addSource('analysis', { type: 'geojson', data: analysis });
    map.addLayer({ id: 'analysis-site', type: 'line', source: 'analysis', filter: T('site'), paint: { 'line-color': selW('#f2c94c', '#ffffff'), 'line-width': selW(2, 3.5), 'line-dasharray': [4, 2] } });
    map.addLayer({ id: 'analysis-cline', type: 'line', source: 'analysis', filter: T('cline'), layout: { 'line-cap': 'round' }, paint: { 'line-color': selW('#5ce1e6', '#ffffff'), 'line-width': selW(3, 5) } });
    map.addLayer({ id: 'design-draft-line', type: 'line', source: 'design-draft', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'design-draft-pts', type: 'circle', source: 'design-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 3, 'circle-color': '#ffffff' } });
    refresh(false);
  });
  const LAYERS = ['design-fill', 'design-line', 'design-grade-line', 'analysis-cline', 'analysis-site'];
  const open = () => !$('design').hidden;

  function persist() { try { localStorage.setItem('floodsim.design', JSON.stringify({ scenarios, active })); } catch { /* too big or storage off */ } }
  function refreshAnalysis(changed = true) {
    map.getSource('analysis')?.setData(analysis); if (sel != null) mark(sel, true);
    if (changed) { try { localStorage.setItem('floodsim.analysis', JSON.stringify(analysis)); } catch { /* storage off */ } onAnalysis(); }
  }
  function refresh(changed = true) {
    map.getSource('design')?.setData(fc());
    if (sel != null) mark(sel, true);
    renderScenarios(); renderLog();
    if (changed) { persist(); results = null; onChange(); }
  }
  const byId = (id) => fc().features.find(f => f.id === id) ?? analysis.features.find(f => f.id === id);
  const isAnalysis = (id) => analysis.features.some(f => f.id === id);
  const mark = (id, on) => { const src = isAnalysis(id) ? 'analysis' : 'design'; if (map.getSource(src)) map.setFeatureState({ source: src, id }, { sel: on }); };
  /** An edit drops the FFE / pad a saved scenario locked for that feature. */
  const unlock = (id) => { if (cur()?.locked?.[id]) delete cur().locked[id]; };

  // ---------------------------------------------------------------- scenarios
  function renderScenarios() {
    $('scnSel').innerHTML = `<option value="-1">Existing conditions</option>` + scenarios.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.design.features.length})</option>`).join('');
    $('scnSel').value = String(active);
    $('scnRename').disabled = $('scnDelete').disabled = $('scnCopy').disabled = active < 0;
    $('designCount').textContent = active >= 0 ? cur().name : '';
    renderSettings();
  }
  const uniqueName = (base) => { let n = 1, name = base; while (scenarios.some(s => s.name.toLowerCase() === name.toLowerCase())) name = `${base} ${++n}`; return name; };
  function newScenario(name = uniqueName('Proposed'), design = { type: 'FeatureCollection', features: [] }, settings = {}) {
    scenarios.push({ name, design, settings: { ...settings }, locked: {} }); active = scenarios.length - 1; sel = null; refresh();
    return cur();
  }
  $('scnSel').onchange = () => { active = Number($('scnSel').value); sel = null; cancelDraft(); refresh(); renderProps(); };
  $('scnNew').onclick = () => { const name = prompt('Name of the new scenario', uniqueName('Proposed')); if (name?.trim()) newScenario(uniqueName(name.trim())); renderProps(); };
  $('scnCopy').onclick = () => { const s = cur(); if (!s) return; const c = structuredClone(s); c.name = uniqueName(s.name + ' copy'); scenarios.push(c); active = scenarios.length - 1; refresh(); };
  $('scnRename').onclick = () => { const s = cur(); if (!s) return; const name = prompt('Rename the scenario', s.name)?.trim(); if (name && name !== s.name) { s.name = uniqueName(name); refresh(); } };
  $('scnDelete').onclick = () => { const s = cur(); if (!s || !confirm(`Delete the scenario “${s.name}” (${s.design.features.length} features)?`)) return; scenarios.splice(active, 1); active = -1; sel = null; refresh(); renderProps(); };

  // scenario-wide settings: BFE, freeboard, daylight slopes, reach
  const SET_SPEC = [['bfe', 'Base flood elevation (BFE, NAVD88)', 'elev', 'none'], ['freeboard', 'Freeboard above BFE', 'elev'], ['fillSlope', 'Fill slopes (horizontal per 1 vertical)', 'num'],
    ['cutSlope', 'Cut slopes (horizontal per 1 vertical)', 'num'], ['reach', 'Daylight reach', 'len']];
  function renderSettings() {
    const s = cur(), box = $('designSettings');
    if (!s) { box.innerHTML = '<p class="note">Existing conditions has no design. Draw a feature or press New to start a proposed scenario.</p>'; return; }
    const v = { ...SETTINGS, ...s.settings };
    box.innerHTML = SET_SPEC.map(([k, label, kind, ph]) => `<label class="ifield"><span>${label}${CONVERT.has(kind) ? ` <i>${unit(kind)}</i>` : ''}</span><input data-sk="${k}" data-kind="${kind}" inputmode="decimal" value="${CONVERT.has(kind) ? fmtIn(kind, s.settings[k] ?? (k === 'bfe' ? null : v[k])) : s.settings[k] ?? v[k]}" placeholder="${ph ?? ''}"></label>`).join('') +
      '<p class="note">No FEMA flood zones in the app yet: give the BFE from the FIRM (or per building). Defaults: 1 ft freeboard, 3:1 fill and 2:1 cut. Confirm against the local code.</p>';
    for (const el of box.querySelectorAll('[data-sk]')) el.addEventListener('change', () => {
      const raw = el.value.trim(), x = Number(raw), k = el.dataset.sk;
      if (raw === '') delete s.settings[k]; else if (Number.isFinite(x)) s.settings[k] = CONVERT.has(el.dataset.kind) ? x * u()[el.dataset.kind][1] : x; else return;
      s.locked = {}; refresh(); renderSettings();
    });
  }

  // ---------------------------------------------------------------- tools
  function setTool(t) {
    cancelDraft(); tool = t;
    for (const b of $('designTools').children) b.setAttribute('aria-pressed', b.dataset.tool === t);
    map.getContainer().classList.toggle('infra-drawing', t !== 'select' && open());
    if (t !== 'select') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    $('designHint').textContent = HINTS[t];
    if (t !== 'select') select(null); else renderProps();
  }
  function select(id) { if (sel != null) mark(sel, false); sel = id; if (sel != null) mark(sel, true); renderProps(); }
  const near = (pt, px = 4) => map.queryRenderedFeatures([[pt.x - px, pt.y - px], [pt.x + px, pt.y + px]], { layers: LAYERS.filter(l => map.getLayer(l)) });
  function cancelDraft() { draft = null; map.getSource('design-draft')?.setData({ type: 'FeatureCollection', features: [] }); }
  function drawDraft(cursor) {
    if (!draft) return;
    const pts = cursor ? [...draft.pts, cursor] : draft.pts, F = [];
    if (pts.length > 1) F.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.length > 2 && draft.type !== 'cline' ? [...pts, pts[0]] : pts }, properties: {} });
    for (const p of draft.pts) F.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} });
    map.getSource('design-draft')?.setData({ type: 'FeatureCollection', features: F });
  }
  /** Drawing in existing conditions starts a proposed scenario. */
  const target = () => cur() ?? newScenario();
  function add(type, geometry, props = {}) {
    const s = target(), f = designFeature(type, geometry, { ...structuredClone(defaults[type]), ...props });
    s.design.features.push(f); refresh(); select(f.id); return f;
  }
  function finishDraft() {
    const d = draft; cancelDraft();
    if (d && ANALYSIS.has(d.type)) { // control line (2+ points) or site boundary (3+); one site per project
      if (d.pts.length < (d.type === 'cline' ? 2 : 3)) return;
      if (d.type === 'site') analysis.features = analysis.features.filter(f => f.properties.type !== 'site');
      const n = analysis.features.filter(f => f.properties.type === 'cline').length + 1;
      const f = designFeature(d.type, d.type === 'cline' ? { type: 'LineString', coordinates: d.pts } : { type: 'Polygon', coordinates: [[...d.pts, d.pts[0]]] }, { name: d.type === 'cline' ? `Line ${n}` : 'Site' });
      analysis.features.push(f); refreshAnalysis(); select(f.id); $('designHint').textContent = HINTS[tool]; return;
    }
    if (!d || d.pts.length < 3) return;
    const props = d.type === 'grade' && defaults.grade.mode === 'plane' ? { spots: d.pts.slice(0, 3).map(p => groundAt(p)) } : {};
    add(d.type, { type: 'Polygon', coordinates: [[...d.pts, d.pts[0]]] }, props);
    $('designHint').textContent = HINTS[tool];
  }
  map.on('click', (e) => {
    if (!open()) return;
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (tool === 'select') { const hit = near(e.point)[0]; select(hit ? hit.id : null); return; }
    if (tool === 'demolish' && !draft) {
      const b = buildingAt(e.point);
      if (b) { add('demolish', b.geometry, { name: 'Demolish' + (b.properties?.h ? ` (${Math.round(b.properties.h)} m tall)` : '') }); return; }
    }
    draft ??= { type: tool, pts: [] };
    if (draft.pts.length >= 3 && draft.type !== 'cline') { const a = map.project(draft.pts[0]); if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 10) { finishDraft(); return; } }
    const last = draft.pts.at(-1), q = last && map.project(last);
    if (!q || Math.hypot(q.x - e.point.x, q.y - e.point.y) > 3) draft.pts.push(ll);
    drawDraft();
  });
  map.on('dblclick', (e) => { if (open() && draft) { e.preventDefault(); finishDraft(); } });
  map.on('mousemove', (e) => {
    if (!open()) return;
    if (draft) drawDraft([e.lngLat.lng, e.lngLat.lat]);
    if (tool === 'select') map.getCanvas().style.cursor = near(e.point).length ? 'pointer' : '';
  });
  addEventListener('keydown', (e) => {
    if (!open() || e.target.closest?.('input, textarea, select')) return;
    if (draft) {
      if (e.key === 'Enter') { e.preventDefault(); finishDraft(); } else if (e.key === 'Escape') cancelDraft();
      else if (e.key === 'Backspace') { draft.pts.pop(); drawDraft(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) { e.preventDefault(); remove(sel); }
    if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else select(null); }
  });
  function remove(id) {
    if (isAnalysis(id)) { analysis.features = analysis.features.filter(f => f.id !== id); sel = null; refreshAnalysis(); renderProps(); return; }
    const s = cur(); if (!s) return; s.design.features = s.design.features.filter(f => f.id !== id); unlock(id); sel = null; refresh(); renderProps(); }
  function move(id, by) {
    const F = cur()?.design.features, i = F?.findIndex(f => f.id === id); if (i == null || i < 0) return;
    const j = Math.max(0, Math.min(F.length - 1, i + by)); if (i === j) return;
    const [f] = F.splice(i, 1); F.splice(j, 0, f); refresh(); renderProps();
  }

  // ---------------------------------------------------------------- properties form
  const fmt = (kind, v) => { const [, k, d] = u()[kind]; return v == null || !Number.isFinite(v) ? '' : (v / k).toLocaleString(undefined, { maximumFractionDigits: d }); };
  const fmtIn = (kind, v) => { const [, k, d] = u()[kind]; return v == null || !Number.isFinite(v) ? '' : String(+(v / k).toFixed(d + 1)); };
  const unit = (kind) => u()[kind][0];
  const when = (fn) => ({ when: fn });
  const SLOPES = [['fillSlope', 'Fill slopes (H per 1 V)', 'num', { ph: 'scenario' }], ['cutSlope', 'Cut slopes (H per 1 V)', 'num', { ph: 'scenario' }]];
  const SPEC = {
    building: [['name', 'Name', 'text'], ['preset', 'Building type', 'select', Object.entries(PRESETS).map(([k, p]) => [k, p.label])],
      ['foundation', 'Foundation', 'select', FOUNDATIONS.map(f => [f, f[0].toUpperCase() + f.slice(1)])],
      ['ffeMode', 'Finished floor (FFE)', 'select', [['auto', 'Auto: HAG + reveal, BFE + freeboard, minimum'], ['balance', 'Balance cut and fill (at or above the minimum)'], ['fixed', 'Fixed elevation']]],
      ['ffe', 'FFE', 'elev', when(p => p.ffeMode === 'fixed')], ['minFFE', 'Minimum FFE', 'elev', { ph: 'none' }], ['bfe', 'BFE for this building', 'elev', { ph: 'scenario' }],
      ['freeboard', 'Freeboard', 'elev', { ph: 'scenario' }], ['truckCourt', 'Truck court elevation (dock at + 4 ft)', 'elev', { when: p => p.preset === 'warehouse', ph: 'none' }],
      ['opening', 'Lowest opening (basement)', 'elev', { when: p => p.foundation === 'basement', ph: 'FFE' }],
      ['reveal', 'Reveal (foundation above grade)', 'elev'], ['apronW', 'Apron width', 'len'], ['apronFall', 'Apron fall over its width', 'elev'], ['apronPaved', 'Apron slope on paved sides', PCT],
      ['levels', 'Parking levels', 'int', when(p => p.preset === 'garage')], ['height', 'Height (3D export)', 'len'],
      ['roof', 'Roof water', 'select', [['ground', 'To the ground (downspouts to lawn)'], ['network', 'To the network (roof drains)'], ['cistern', 'To a cistern, overflow to the ground'], ['green', 'Green roof, then the ground']]],
      ['roofTo', 'Roof drains to', 'node', when(p => p.roof === 'network')], ['cisternVol', 'Cistern capacity', 'cvol', when(p => p.roof === 'cistern')], ...SLOPES],
    grade: [['name', 'Name', 'text'], ['mode', 'Surface', 'select', [['flat', 'Flat at an elevation'], ['plane', 'Plane through three spot elevations'], ['balance', 'Flat where cut and fill balance']]],
      ['elev', 'Elevation', 'elev', { when: p => p.mode === 'flat', ph: 'mean ground' }], ['spot0', 'Spot at corner 1', 'elev', when(p => p.mode === 'plane')],
      ['spot1', 'Spot at corner 2', 'elev', when(p => p.mode === 'plane')], ['spot2', 'Spot at corner 3', 'elev', when(p => p.mode === 'plane')], ...SLOPES],
    paved: [['name', 'Name', 'text'], ['use', 'Use', 'select', [['driveway', 'Driveway'], ['parking', 'Parking'], ['sidewalk', 'Sidewalk'], ['road', 'Road']]],
      ['surface', 'Surface', 'select', [['asphalt', 'Asphalt (n 0.014)'], ['concrete', 'Concrete (n 0.013)']]], ['elev', 'Target elevation', 'elev', { ph: 'follow the ground' }],
      ['crossSlope', 'Cross slope', PCT, when(p => p.elev != null)], ['crown', 'Crowned (falls both ways from the long axis)', 'bool', when(p => p.elev != null)],
      ['slopeDir', 'Falls toward (degrees from north)', 'num', when(p => p.elev != null && !p.crown)], ['curb', 'Curb height', 'size'], ...SLOPES],
    demolish: [['name', 'Name', 'text']],
    cline: [['name', 'Name', 'text']],
    site: [['name', 'Name', 'text']],
  };
  function field(p, [k, label, kind, x]) {
    const id = 'dp-' + k, ph = x?.ph ?? '';
    if (kind === 'select') return `<label class="ifield"><span>${label}</span><select id="${id}" data-k="${k}" data-kind="select">${x.map(([v, t]) => `<option value="${v}"${String(p[k] ?? x[0][0]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
    if (kind === 'node') {
      const list = manholes(), v = p.roofTo ? p.roofTo.join(',') : '';
      return `<label class="ifield"><span>${label}</span><select id="${id}" data-k="${k}" data-kind="node"><option value="">Nearest manhole within 30 m</option>${list.map(m => `<option value="${m.ll.join(',')}"${m.ll.join(',') === v ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>`;
    }
    if (kind === 'text') return `<label class="ifield"><span>${label}</span><input id="${id}" data-k="${k}" data-kind="text" value="${esc(p[k] ?? '')}" placeholder="optional"></label>`;
    if (kind === 'bool') return `<label class="ifield check"><input type="checkbox" id="${id}" data-k="${k}" data-kind="bool"${p[k] ? ' checked' : ''}><span>${label}</span></label>`;
    const raw = k.startsWith('spot') ? p.spots?.[Number(k[4])] : p[k];
    const v = CONVERT.has(kind) ? fmtIn(kind, raw) : kind === PCT ? (raw == null ? '' : String(+(raw * 100).toFixed(2))) : raw ?? '';
    const un = CONVERT.has(kind) ? ` <i>${unit(kind)}</i>` : kind === PCT ? ' <i>%</i>' : '';
    return `<label class="ifield"><span>${label}${un}</span><input id="${id}" data-k="${k}" data-kind="${kind}" inputmode="decimal" value="${v}" placeholder="${ph}"></label>`;
  }
  function renderProps() {
    const box = $('designProps'), f = sel != null ? byId(sel) : null;
    const type = f ? f.properties.type : tool !== 'select' ? tool : null;
    if (!type) { box.innerHTML = ''; return; }
    const p = f ? f.properties : defaults[type] ?? {};
    const rows = ANALYSIS.has(type) && !f ? [] : SPEC[type].filter(([, , , x]) => !x?.when || x.when(p)).map(s => field(p, s));
    const info = f ? featureInfo(f) : type === 'building' ? ['Confirm the preset values against the local code.'] : [];
    const an = ANALYSIS.has(type), F = cur()?.design.features ?? [], i = f && !an ? F.indexOf(f) : -1;
    box.innerHTML = `<h3>${f ? (p.name ? esc(p.name) : NAMES[type]) : an ? 'New ' + NAMES[type].toLowerCase() : 'New ' + NAMES[type].toLowerCase() + ' defaults'}${i >= 0 ? ` <i>${i + 1} of ${F.length}</i>` : an && f ? ' <i>all scenarios</i>' : ''}</h3>${rows.join('')}` +
      (info.length ? `<p class="iinfo">${info.join('<br>')}</p>` : '') +
      (f ? `<div class="row">${an ? '' : '<button class="btn" id="dpUp" type="button" title="Apply earlier">↑</button><button class="btn" id="dpDown" type="button" title="Apply later (overrides)">↓</button>'}<button class="btn" id="dpDelete" type="button">Delete</button></div>` : '');
    for (const el of box.querySelectorAll('[data-k]')) el.addEventListener('change', () => setProp(f, type, el));
    if (f) { $('dpDelete').onclick = () => remove(f.id); if (!an) { $('dpUp').onclick = () => move(f.id, -1); $('dpDown').onclick = () => move(f.id, 1); } }
  }
  function setProp(f, type, el) {
    const p = f ? f.properties : defaults[type], k = el.dataset.k, kind = el.dataset.kind;
    if (kind === 'bool') p[k] = el.checked;
    else if (kind === 'text') p[k] = el.value.trim() || null;
    else if (kind === 'node') p.roofTo = el.value ? el.value.split(',').map(Number) : null;
    else if (kind === 'select') {
      p[k] = el.value;
      if (k === 'preset') { const keep = { name: p.name, bfe: p.bfe, minFFE: p.minFFE }; applyPreset(p, el.value); Object.assign(p, keep); if (el.value === 'garage') p.height = (p.levels ?? 3) * LEVEL_HEIGHT; }
    } else {
      const raw = el.value.trim(), v = Number(raw);
      let val;
      if (raw === '') val = null; else if (!Number.isFinite(v)) return;
      else val = CONVERT.has(kind) ? v * u()[kind][1] : kind === PCT ? v / 100 : kind === 'int' ? Math.max(1, Math.round(v)) : v;
      if (k.startsWith('spot')) { p.spots = p.spots ?? [null, null, null]; p.spots[Number(k[4])] = val; } else p[k] = val;
      if (k === 'levels' && val) p.height = val * LEVEL_HEIGHT;
      if (k === 'ffe' && val != null) p.ffeMode = 'fixed';
    }
    if (f && ANALYSIS.has(type)) refreshAnalysis(); else if (f) { unlock(f.id); refresh(); }
    renderProps();
  }
  /** What the model made of a feature: resolved FFE and pad, cut and fill, impervious change, warnings. */
  function featureInfo(f) {
    const p = f.properties, out = [], L = log?.features.find(l => l.id === f.id), r = L?.resolved ?? {};
    if (p.type === 'cline') {
      out.push(`Length ${fmt('len', lineLength(f.geometry.coordinates))} ${unit('len')}. + is water crossing to the right of the line as drawn${f.geometry.coordinates.length > 3 && f.geometry.coordinates[0].join() === f.geometry.coordinates.at(-1).join() ? ' (closed: outward)' : ''}.`);
      const q = lineResults?.get(f.id);
      if (q) out.push(`Last run: <b>${fmt('vol', q.volume)} ${unit('vol')}</b> net (${fmt('vol', q.plus)} +, ${fmt('vol', q.minus)} −), peak ${Number.isFinite(q.peak) ? (q.peak / UNITS[units].vol[1]).toFixed(units === 'us' ? 1 : 3) : '–'} ${unit('vol')}/s${Number.isFinite(q.tPeak) ? ` at ${Math.round(q.tPeak / 60)} min` : ''}`);
      return out;
    }
    const area = ringArea(f.geometry.coordinates[0]);
    out.push(`${p.type === 'site' ? 'Area' : 'Footprint'} ${fmt('area', area)} ${unit('area')}`);
    if (p.type === 'site') { out.push('Comparisons split every result into on-site and off-site with it.'); return out; }
    if (p.type === 'building') {
      out.push(`<span class="muted">${PRESETS[p.preset]?.label ?? 'Custom'}: confirm against the local code.</span>`);
      if (Number.isFinite(r.ffe)) {
        out.push(`<b>FFE ${fmt('elev', r.ffe)} ${unit('elev')}</b> NAVD88 (${r.mode === 'locked' ? 'saved in the scenario' : r.mode === 'balance' ? 'balanced cut and fill' : r.mode === 'fixed' ? 'fixed' : 'auto: ' + r.governs})`);
        out.push(`HAG ${fmt('elev', r.hag)} ${unit('elev')} · minimum ${fmt('elev', r.ffeMin)} ${unit('elev')} (${r.governs})`);
        if (r.pad != null) out.push(`Pad (finished grade at the foundation) ${fmt('elev', r.pad)} ${unit('elev')}`);
      }
      if (p.roof === 'network' && roofLinks.has(f.id)) out.push(`Roof drains ${esc(roofLinks.get(f.id))}`);
      const hit = results?.find(b => b.id === f.id);
      if (hit) out.push(hit.flooded ? `<span class="warn"><b>Flooded</b>: water ${fmt('elev', hit.maxWse)} ${unit('elev')} at the walls, ${fmt('elev', hit.maxWse - hit.critical)} ${unit('elev')} over the ${p.foundation === 'basement' ? 'lowest opening' : 'FFE'}</span>`
        : hit.maxWse != null ? `<span class="good"><b>Dry</b></span>: water up to ${fmt('elev', hit.maxWse)} ${unit('elev')} at the walls, ${fmt('elev', hit.critical - hit.maxWse)} ${unit('elev')} below the ${p.foundation === 'basement' ? 'lowest opening' : 'FFE'}` : 'No water at its walls in the last run');
    }
    if (p.type === 'demolish' && r.removedArea != null) out.push(`Removes ${fmt('area', r.removedArea)} ${unit('area')} of building`);
    if (L && (L.cut || L.fill)) out.push(`Cut ${fmt('vol', L.cut)} ${unit('vol')} · fill ${fmt('vol', L.fill)} ${unit('vol')}${L.floodFill ? ` · floodplain fill ${fmt('vol', L.floodFill)} ${unit('vol')}` : ''}`);
    if (L && (L.impAdded || L.impRemoved)) out.push(`Impervious ${L.impAdded >= L.impRemoved ? '+' : '−'}${fmt('area', Math.abs(L.impAdded - L.impRemoved))} ${unit('area')}`);
    for (const n of L?.notes ?? []) out.push(`<span class="muted">${esc(n)}</span>`);
    for (const w of L?.warnings ?? []) out.push(`<span class="warn">${esc(w)}</span>`);
    return out;
  }

  // ---------------------------------------------------------------- log
  function renderLog() {
    const box = $('designLog'), s = cur();
    if (!s) { box.innerHTML = ''; return; }
    if (!log) { box.innerHTML = s.design.features.length ? '<p class="note">Build a model to apply the design.</p>' : ''; return; }
    const t = log.totals, by = {}; for (const f of s.design.features) by[f.properties.type] = (by[f.properties.type] || 0) + 1;
    const counts = Object.entries(by).map(([k, n]) => `${n} ${NAMES[k].toLowerCase()}${n > 1 ? (k === 'paved' ? ' areas' : 's') : ''}`.replace('paved area areas', 'paved areas')).join(', ');
    const rows = log.features.map(l => `<tr><td>${esc(l.name || NAMES[l.type])}</td><td>${fmt('vol', l.cut)}</td><td>${fmt('vol', l.fill)}</td><td>${l.impAdded - l.impRemoved >= 0 ? '+' : '−'}${fmt('area', Math.abs(l.impAdded - l.impRemoved))}</td></tr>`).join('');
    box.innerHTML = `<h3>Cut and fill</h3><p class="iinfo">${counts || 'No features'}.<br>` +
      `<b>Cut ${fmt('vol', t.cut)} ${unit('vol')} · fill ${fmt('vol', t.fill)} ${unit('vol')}</b> · net ${t.net >= 0 ? 'fill' : 'cut'} ${fmt('vol', Math.abs(t.net))} ${unit('vol')}<br>` +
      `Impervious +${fmt('area', t.impAdded)} / −${fmt('area', t.impRemoved)} ${unit('area')}` +
      (t.floodFill || t.compCut ? `<br>Floodplain fill ${fmt('vol', t.floodFill)} ${unit('vol')} · compensatory cut ${fmt('vol', t.compCut)} ${unit('vol')} (below ${log.floodRef})` : log.floodRef ? '' : '<br><span class="muted">Floodplain fill: give a BFE, or run existing conditions first (its max water surface is used).</span>') + '</p>' +
      (log.features.length ? `<table class="dtab"><thead><tr><th>Feature</th><th>Cut ${unit('vol')}</th><th>Fill ${unit('vol')}</th><th>Imperv. ${unit('area')}</th></tr></thead><tbody>${rows}</tbody></table>` : '') +
      (log.warnings.length ? `<p class="iinfo warn">${log.warnings.map(esc).join('<br>')}</p>` : '');
  }

  // ---------------------------------------------------------------- toggles, units
  $('designTools').onclick = (e) => { const b = e.target.closest('button'); if (b) setTool(b.dataset.tool); };
  $('designUnits').value = units;
  $('designUnits').onchange = () => { units = $('designUnits').value; try { localStorage.setItem('floodsim.designUnits', units); } catch { /* storage off */ } renderProps(); renderLog(); renderSettings(); };
  $('designToggle').onclick = () => toggle(); $('designClose').onclick = () => toggle(false);
  function toggle(on = $('design').hidden) {
    $('design').hidden = !on; $('designToggle').setAttribute('aria-expanded', on);
    if (on && !$('infra').hidden) $('infraClose').click(); // one drawer at a time
    if (!on) { setTool('select'); select(null); map.getContainer().classList.remove('infra-drawing'); map.getCanvas().style.cursor = ''; }
    else setTool(tool);
  }
  $('infraToggle').addEventListener('click', () => { if (!$('infra').hidden && open()) toggle(false); });
  setTool('select'); renderScenarios();

  return {
    /** The active scenario ({ name, design, settings, locked }) or null for existing conditions. */
    get active() { return cur(); },
    get scenarios() { return scenarios; },
    get units() { return units; },
    /** Replace every scenario (project open). list: [{ name, design, settings, locked }] */
    setScenarios(list, activeName = null) {
      scenarios = (list ?? []).map(s => ({ name: s.name, design: s.design?.features ? s.design : { type: 'FeatureCollection', features: [] }, settings: s.settings ?? {}, locked: s.locked ?? {} }));
      for (const s of scenarios) bumpDesignIds(s.design);
      active = scenarios.findIndex(s => s.name === activeName); sel = null; log = null; results = null; refresh(false); persist(); renderProps();
    },
    /** After applyDesign: the log of the active scenario (shown in the drawer and the feature form). */
    setLog(l) { log = l; renderLog(); renderProps(); },
    /** Make a scenario active by name (null: existing conditions) without the change callback (the caller applies it). */
    activate(name) { active = name == null ? -1 : scenarios.findIndex(s => s.name === name); sel = null; refresh(false); persist(); renderProps(); },
    /** Control lines and the site boundary (shared by all scenarios). */
    get analysis() { return analysis; },
    setAnalysis(next) { analysis = next?.features ? next : { type: 'FeatureCollection', features: [] }; bumpDesignIds(analysis); lineResults = null; refreshAnalysis(false); try { localStorage.setItem('floodsim.analysis', JSON.stringify(analysis)); } catch { /* storage off */ } },
    /** After a run: each control line's books (Map id → { volume, plus, minus, peak, tPeak }). */
    setLineResults(m) { lineResults = m; renderProps(); },
    /** After the run inputs are built: where each roof drain goes (id → text). */
    setRoofLinks(m) { roofLinks = m; renderProps(); },
    /** After a run: new buildings flooded or dry. */
    setResults(r) { results = r; renderProps(); },
    select: (id) => select(id),
  };
}
