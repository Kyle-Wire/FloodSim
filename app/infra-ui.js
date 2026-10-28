// Infrastructure drawer: draw, import, or estimate pipes, culverts, manholes, catch basins, outfalls, underground
// storage and flood barriers (walls, levees / berms, deployable barriers) on the map. The layer lives in lon/lat, SI units; the drawer shows US or SI units. Every edit calls
// `onChange`, which rebuilds the model's network (before a run starts).
import { STORAGE_SYSTEMS, DEFAULTS, BARRIERS, feature, summarize, storageCapacity, lineLength, layerInputs, readFiles, toLayer, bumpIds } from '../src/infra.js';
import { detectPipeFields } from '../src/linked.js';

const $ = (id) => document.getElementById(id);
const UNITS = {
  us: { size: ['in', 0.0254, 1], elev: ['ft', 0.3048, 2], len: ['ft', 0.3048, 0], area: ['ft²', 0.09290304, 0], vol: ['ft³', 0.028316846592, 0],
    weir: ['ft½/s', 1 / 1.8114, 2], rate: ['cfs', 0.028316846592, 2], unitq: ['cfs/ft', 0.09290304, 2], load: ['lb/ft', 0.0145939, 0] },
  si: { size: ['mm', 0.001, 0], elev: ['m', 1, 2], len: ['m', 1, 1], area: ['m²', 1, 0], vol: ['m³', 1, 1],
    weir: ['m½/s', 1, 2], rate: ['m³/s', 1, 3], unitq: ['m²/s', 1, 3], load: ['kN/m', 1, 1] },
};
const CONVERT = new Set(['size', 'elev', 'len', 'weir']);
const GAL = 264.172;
const NAMES = { pipe: 'Pipe', culvert: 'Culvert', manhole: 'Manhole', inlet: 'Catch basin', outfall: 'Outfall', storage: 'Underground storage', wall: 'Flood wall', berm: 'Levee / berm', barrier: 'Deployable barrier' };
const LINES = new Set(['pipe', 'culvert', 'wall', 'berm', 'barrier']);
const HINTS = {
  select: 'Click a feature to edit it. Drag a structure to move it (pipes attached to it follow). Delete removes the selection.',
  pipe: 'Click along the pipe from upstream to downstream; ends snap to structures within a few pixels. Double-click or Enter finishes; ends without a structure get a manhole. Esc cancels, Backspace undoes a vertex.',
  culvert: 'Click the upstream opening, any bends, then the downstream opening. Double-click or Enter finishes. Culverts pass water between the two ends on the surface.',
  manhole: 'Click to place a manhole. Pipes that end within a few pixels of it connect to it.',
  inlet: 'Click to place a catch basin. It connects to the nearest pipe within 30 m.',
  outfall: 'Click to place an outfall at the end of a pipe (within 5 m).',
  storage: 'Click the corners of the storage footprint; Enter, double-click, or a click on the first corner finishes. It connects to the nearest manhole.',
  wall: 'Click along the wall; double-click or Enter finishes. Water crosses only over its crest (weir flow). Tie the ends into high ground or a building, or water goes around them.',
  berm: 'Click along the levee centre line; double-click or Enter finishes. Its crest, top width and side slopes are filled into the terrain.',
  barrier: 'Click along the barrier line; double-click or Enter finishes. Choose when it goes up: from the start, at a set time into the storm, or not at all (to compare).',
};
const FILL = { pipe: '#5cc8f2', culvert: '#ff9f43', manhole: '#e8f4f8', inlet: '#f2c94c', outfall: '#ff6b6b', storage: '#a78bfa', wall: '#ff5d8f', berm: '#a3c46c', barrier: '#ff5d8f' };

export function initInfra(map, { onChange, estimate, groundAt, fetcher, ready }) {
  let fc = { type: 'FeatureCollection', features: [] }, tool = 'select', sel = null, draft = null, drag = null, attached = null, barInfo = null, barRes = null;
  let units = 'us';
  try { fc = JSON.parse(localStorage.getItem('floodsim.infra')) ?? fc; units = localStorage.getItem('floodsim.infraUnits') ?? 'us'; } catch { /* storage off */ }
  bumpIds(fc);
  const defaults = structuredClone(DEFAULTS);
  const u = () => UNITS[units];

  // ---------------------------------------------------------------- map layers
  ready.then(() => {
    map.addSource('infra', { type: 'geojson', data: fc });
    map.addSource('infra-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const T = (t) => ['==', ['get', 'type'], t], selW = (a, b) => ['case', ['boolean', ['feature-state', 'sel'], false], b, a];
    map.addLayer({ id: 'infra-storage', type: 'fill', source: 'infra', filter: T('storage'), paint: { 'fill-color': FILL.storage, 'fill-opacity': 0.28 } });
    map.addLayer({ id: 'infra-storage-line', type: 'line', source: 'infra', filter: T('storage'), paint: { 'line-color': FILL.storage, 'line-width': selW(1.5, 3.5) } });
    // barriers: a halo under each one shows its state after a run (red = overtopped, green = held)
    const st = ['feature-state', 'st'];
    map.addLayer({ id: 'infra-barrier-state', type: 'line', source: 'infra', filter: ['in', ['get', 'type'], ['literal', ['wall', 'berm', 'barrier']]], layout: { 'line-cap': 'round' },
      paint: { 'line-color': ['match', ['coalesce', st, ''], 'over', '#ff3b3b', 'held', '#5cd68f', '#000000'], 'line-opacity': ['match', ['coalesce', st, ''], 'over', 0.55, 'held', 0.45, 0], 'line-width': 12, 'line-blur': 2 } });
    map.addLayer({ id: 'infra-berm', type: 'line', source: 'infra', filter: T('berm'), layout: { 'line-cap': 'round' }, paint: { 'line-color': selW(FILL.berm, '#ffffff'), 'line-width': selW(7, 9), 'line-opacity': 0.9 } });
    map.addLayer({ id: 'infra-wall', type: 'line', source: 'infra', filter: T('wall'), layout: { 'line-cap': 'square' }, paint: { 'line-color': selW(FILL.wall, '#ffffff'), 'line-width': selW(3.5, 5.5) } });
    map.addLayer({ id: 'infra-barrier', type: 'line', source: 'infra', filter: T('barrier'), paint: { 'line-color': selW(FILL.barrier, '#ffffff'), 'line-width': selW(3.5, 5.5), 'line-dasharray': [1.2, 0.8] } });
    map.addLayer({ id: 'infra-pipe', type: 'line', source: 'infra', filter: T('pipe'), layout: { 'line-cap': 'round' },
      paint: { 'line-color': selW(FILL.pipe, '#ffffff'), 'line-width': ['+', ['interpolate', ['linear'], ['coalesce', ['get', 'D'], 0.45], 0.3, 2.5, 1.5, 6], selW(0, 2)] } });
    map.addLayer({ id: 'infra-culvert', type: 'line', source: 'infra', filter: T('culvert'), layout: { 'line-cap': 'butt' },
      paint: { 'line-color': selW(FILL.culvert, '#ffffff'), 'line-width': selW(4, 6), 'line-dasharray': [1.5, 1] } });
    map.addLayer({ id: 'infra-points', type: 'circle', source: 'infra', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['match', ['get', 'type'], 'outfall', 6, 'manhole', 4.5, 4],
        'circle-color': ['match', ['get', 'type'], 'outfall', FILL.outfall, 'inlet', ['step', ['coalesce', ['get', 'blocked'], 0], FILL.inlet, 0.01, '#c98a2b', 0.99, '#6b4423'], FILL.manhole],
        'circle-stroke-color': selW('#0c151b', '#ffffff'), 'circle-stroke-width': selW(1.5, 3) } });
    map.addLayer({ id: 'infra-draft-line', type: 'line', source: 'infra-draft', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'infra-draft-pts', type: 'circle', source: 'infra-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 3, 'circle-color': '#ffffff' } });
    refresh(false);
  });
  const LAYERS = ['infra-points', 'infra-pipe', 'infra-culvert', 'infra-wall', 'infra-barrier', 'infra-berm', 'infra-storage-line', 'infra-storage'];

  function save() { try { localStorage.setItem('floodsim.infra', JSON.stringify(fc)); } catch { /* too big or storage off */ } }
  function refresh(changed = true) {
    map.getSource('infra')?.setData(fc);
    if (sel != null) mark(sel, true);
    paintBarriers(); renderSummary();
    if (changed) { save(); attached = null; barInfo = null; barRes = null; onChange(); }
  }
  const byId = (id) => fc.features.find(f => f.id === id);
  const mark = (id, on) => { if (map.getSource('infra')) map.setFeatureState({ source: 'infra', id }, { sel: on }); };

  // ---------------------------------------------------------------- tools
  function setTool(t) {
    cancelDraft(); tool = t;
    for (const b of $('infraTools').children) b.setAttribute('aria-pressed', b.dataset.tool === t);
    map.getContainer().classList.toggle('infra-drawing', t !== 'select');
    if (LINES.has(t) || t === 'storage') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    $('infraHint').textContent = HINTS[t];
    if (t !== 'select') select(null); else renderProps();
  }
  function select(id) {
    if (sel != null) mark(sel, false);
    sel = id; if (sel != null) mark(sel, true);
    renderProps();
  }
  const near = (pt, px = 7) => map.queryRenderedFeatures([[pt.x - px, pt.y - px], [pt.x + px, pt.y + px]], { layers: LAYERS.filter(l => map.getLayer(l)) });
  /** The structure (manhole / inlet / outfall) nearest the cursor within 10 px, for snapping pipe ends (geometric, so it
   *  does not wait for the map to render the last edit). */
  const structureAt = (pt) => {
    let best = null, bd = 10;
    for (const f of fc.features) if (f.geometry.type === 'Point') { const q = map.project(f.geometry.coordinates), d = Math.hypot(q.x - pt.x, q.y - pt.y); if (d < bd) { bd = d; best = f; } }
    return best;
  };

  function cancelDraft() { draft = null; map.getSource('infra-draft')?.setData({ type: 'FeatureCollection', features: [] }); }
  function drawDraft(cursor) {
    if (!draft) return;
    const pts = cursor ? [...draft.pts, cursor] : draft.pts, F = [];
    if (pts.length > 1) F.push({ type: 'Feature', geometry: draft.type === 'storage' && pts.length > 2 ? { type: 'LineString', coordinates: [...pts, pts[0]] } : { type: 'LineString', coordinates: pts }, properties: {} });
    for (const p of draft.pts) F.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} });
    map.getSource('infra-draft')?.setData({ type: 'FeatureCollection', features: F });
  }
  function finishDraft() {
    const d = draft; cancelDraft(); if (!d) return;
    if (d.type === 'storage') {
      if (d.pts.length < 3) return;
      const f = feature('storage', { type: 'Polygon', coordinates: [[...d.pts, d.pts[0]]] }, structuredClone(defaults.storage));
      fc.features.push(f); refresh(); setTool('select'); select(f.id); return;
    }
    if (d.pts.length < 2) return;
    const props = structuredClone(defaults[d.type]);
    const f = feature(d.type, { type: 'LineString', coordinates: d.pts }, props);
    fc.features.push(f);
    if (d.type === 'pipe') for (const end of [d.pts[0], d.pts.at(-1)]) { // every pipe end sits on a structure
      if (!d.snapped.has(end)) fc.features.push(feature('manhole', { type: 'Point', coordinates: end }, structuredClone(defaults.manhole)));
    }
    refresh(); select(f.id); setToolKeep();
  }
  const setToolKeep = () => { $('infraHint').textContent = HINTS[tool]; renderProps(); };

  map.on('click', (e) => {
    if ($('infra').hidden) return;
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (tool === 'select') { const hit = near(e.point)[0]; select(hit ? hit.id : null); return; }
    if (tool === 'manhole' || tool === 'inlet' || tool === 'outfall') {
      const f = feature(tool, { type: 'Point', coordinates: ll }, structuredClone(defaults[tool]));
      fc.features.push(f); refresh(); select(f.id); renderProps(); return;
    }
    // line / polygon tools
    draft ??= { type: tool, pts: [], snapped: new Set() };
    if (tool === 'storage' && draft.pts.length >= 3) { const a = map.project(draft.pts[0]); if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 10) { finishDraft(); return; } }
    let p = ll;
    if (tool === 'pipe') { const s = structureAt(e.point); if (s) { p = s.geometry.coordinates; draft.snapped.add(p); } }
    const last = draft.pts.at(-1), q = last && map.project(last);
    if (!q || Math.hypot(q.x - e.point.x, q.y - e.point.y) > 3) draft.pts.push(p);
    drawDraft();
  });
  map.on('dblclick', (e) => { if (draft) { e.preventDefault(); finishDraft(); } });
  map.on('mousemove', (e) => {
    if ($('infra').hidden) return;
    if (drag) { moveDrag([e.lngLat.lng, e.lngLat.lat]); return; }
    if (draft) drawDraft([e.lngLat.lng, e.lngLat.lat]);
    if (tool === 'select') map.getCanvas().style.cursor = near(e.point).length ? 'pointer' : '';
  });
  // drag a structure in select mode; pipe and culvert ends on it follow
  map.on('mousedown', (e) => {
    if ($('infra').hidden || tool !== 'select') return;
    const hit = structureAt(e.point); if (!hit) return;
    e.preventDefault(); map.dragPan.disable();
    const f = byId(hit.id), from = f.geometry.coordinates.slice();
    const ends = fc.features.filter(g => g.geometry.type === 'LineString').flatMap(g => [0, g.geometry.coordinates.length - 1]
      .filter(k => sameLL(g.geometry.coordinates[k], from)).map(k => [g, k]));
    drag = { f, ends, moved: false }; select(f.id);
  });
  function moveDrag(ll) {
    drag.moved = true; drag.f.geometry.coordinates = ll;
    for (const [g, k] of drag.ends) g.geometry.coordinates[k] = ll;
    map.getSource('infra').setData(fc);
  }
  addEventListener('mouseup', () => { if (!drag) return; const moved = drag.moved; drag = null; map.dragPan.enable(); if (moved) { refresh(); renderProps(); } });
  addEventListener('keydown', (e) => {
    if ($('infra').hidden || e.target.closest?.('input, textarea, select')) return;
    if (draft) {
      if (e.key === 'Enter') { e.preventDefault(); finishDraft(); } else if (e.key === 'Escape') cancelDraft();
      else if (e.key === 'Backspace') { draft.pts.pop(); drawDraft(); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) { e.preventDefault(); remove(sel); }
    if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else select(null); }
  });
  const sameLL = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  function remove(id) { fc.features = fc.features.filter(f => f.id !== id); sel = null; refresh(); renderProps(); }

  // ---------------------------------------------------------------- properties form
  /** Display value (grouped digits) and input value (plain, one more decimal) in the drawer's units. */
  const fmt = (kind, v) => { const [, k, d] = u()[kind]; return v == null || !Number.isFinite(v) ? '' : (v / k).toLocaleString(undefined, { maximumFractionDigits: d }); };
  const fmtIn = (kind, v) => { const [, k, d] = u()[kind]; return v == null || !Number.isFinite(v) ? '' : String(+(v / k).toFixed(d + 1)); };
  const unit = (kind) => u()[kind][0];
  /** Field spec: [key, label, kind ('size'|'elev'|'num'|'int'|'bool'|'select'|'ro'), extra] */
  const SPEC = {
    pipe: [['D', 'Diameter / rise', 'size'], ['shape', 'Shape', 'select', [['CIRCULAR', 'Circular'], ['RECT_CLOSED', 'Box']]], ['W', 'Box span', 'size', { when: p => p.shape === 'RECT_CLOSED' }],
      ['upInv', 'Upstream invert', 'elev'], ['dnInv', 'Downstream invert', 'elev'], ['n', 'Manning’s n', 'num'], ['barrels', 'Barrels', 'int']],
    culvert: [['D', 'Diameter', 'size'], ['upInv', 'Upstream invert', 'elev'], ['dnInv', 'Downstream invert', 'elev'], ['n', 'Manning’s n', 'num'],
      ['blocked', 'Blocked by debris', 'select', [[0, 'Clear'], [0.25, '25 % blocked'], [0.5, '50 % blocked'], [0.75, '75 % blocked'], [1, 'Fully blocked']]]],
    manhole: [['invert', 'Invert', 'elev'], ['rim', 'Rim', 'elev']],
    inlet: [['grates', 'Grates', 'int'], ['blocked', 'Blocked by debris', 'select', [[0, 'Clear'], [0.25, '25 % blocked'], [0.5, '50 % blocked'], [0.75, '75 % blocked'], [1, 'Fully blocked']]]],
    outfall: [['invert', 'Invert', 'elev'], ['boundary', 'Pipe continues off-site (normal-depth outlet)', 'bool']],
    storage: [['system', 'System', 'select', Object.entries(STORAGE_SYSTEMS).map(([k, s]) => [k, `${s.name} (${Math.round(s.voids * 100)}% voids)`])],
      ['voids', 'Void ratio', 'num'], ['depth', 'Storage depth', 'elev'], ['bottom', 'Floor elevation', 'elev'], ['connD', 'Connection pipe', 'size']],
  };
  const CREST = [['name', 'Name', 'text'], ['mode', 'Crest', 'select', [['height', 'Height above the ground under it'], ['elev', 'Fixed crest elevation (NAVD88)']]],
    ['height', 'Height above ground', 'elev', { when: p => p.mode !== 'elev' }], ['crest', 'Crest elevation', 'elev', { when: p => p.mode === 'elev' }]];
  const WEIR = ['C', 'Weir coefficient C (q = C·H^1.5)', 'weir'];
  SPEC.wall = [...CREST, WEIR];
  SPEC.berm = [...CREST, ['topW', 'Top width', 'len'], ['slope', 'Side slopes (horizontal per 1 vertical)', 'num'], WEIR];
  SPEC.barrier = [...CREST, ['deploy', 'Deployed', 'select', [['start', 'From the start'], ['time', 'At a set time into the storm'], ['none', 'Not deployed (to compare)']]],
    ['deployAt', 'Goes up at (minutes)', 'num', { when: p => p.deploy === 'time' }], WEIR];
  function renderProps() {
    const box = $('infraProps'), f = sel != null ? byId(sel) : null;
    const type = f ? f.properties.type : tool !== 'select' ? tool : null;
    if (!type) { box.innerHTML = ''; return; }
    const p = f ? f.properties : defaults[type];
    const rows = SPEC[type].filter(([, , , x]) => !x?.when || x.when(p)).map(([k, label, kind, x]) => {
      const id = 'ip-' + k;
      if (kind === 'select') return `<label class="ifield"><span>${label}</span><select id="${id}" data-k="${k}" data-kind="select">${x.map(([v, t]) => `<option value="${v}"${String(p[k] ?? x[0][0]) === String(v) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
      if (kind === 'text') return `<label class="ifield"><span>${label}</span><input id="${id}" data-k="${k}" data-kind="text" value="${(p[k] ?? '').replace(/"/g, '&quot;')}" placeholder="optional"></label>`;
      if (kind === 'bool') return `<label class="ifield check"><input type="checkbox" id="${id}" data-k="${k}" data-kind="bool"${p[k] ? ' checked' : ''}><span>${label}</span></label>`;
      const v = CONVERT.has(kind) ? fmtIn(kind, p[k]) : p[k] ?? '';
      const ph = kind === 'elev' && (k === 'upInv' || k === 'dnInv' || k === 'invert' || k === 'bottom') ? 'from lidar' : kind === 'size' && k === 'D' && type === 'pipe' ? 'from neighbours' : '';
      return `<label class="ifield"><span>${label}${CONVERT.has(kind) ? ` <i>${unit(kind)}</i>` : ''}</span><input id="${id}" data-k="${k}" data-kind="${kind}" inputmode="decimal" value="${v}" placeholder="${ph}"></label>`;
    });
    const info = [];
    if (f?.geometry.type === 'LineString') info.push(`Length ${fmt('len', lineLength(f.geometry.coordinates))} ${unit('len')}`);
    if (f?.geometry.type === 'Point' && groundAt) { const z = groundAt(f.geometry.coordinates); if (z != null) info.push(`Lidar ground ${fmt('elev', z)} ${unit('elev')} NAVD88`); }
    if (type === 'storage' && f) {
      const c = storageCapacity(p, f.geometry.coordinates[0]), vol = c.volume;
      info.push(`Footprint ${fmt('area', c.area)} ${unit('area')} × ${fmt('elev', c.depth)} ${unit('elev')} deep × ${Math.round(c.voids * 100)}% voids`);
      info.push(`<b>Capacity ${fmt('vol', vol)} ${unit('vol')}</b> (${Math.round(vol * GAL).toLocaleString()} gal · ${Math.round(vol).toLocaleString()} m³)`);
      const a = attached?.find(s => s.id === f.id);
      if (a) info.push(`Joined to manhole ${a.to}, ${fmt('len', a.dist)} ${unit('len')} away`);
      else if (attached) info.push('<span class="warn">Not connected: no manhole within 150 m (draw or estimate pipes first)</span>');
    }
    if (BARRIERS.has(type) && f) info.push(...barrierInfo(f));
    if ((type === 'inlet' || type === 'culvert') && f && p.blocked > 0) info.push(`<span class="warn">${p.blocked >= 1 ? 'Fully blocked: takes no water' : `${Math.round(p.blocked * 100)} % blocked: ${type === 'inlet' ? 'its grates take water through the open share only' : 'flows like a smaller clear barrel'}`}</span>`);
    box.innerHTML = `<h3>${f ? NAMES[type] : 'New ' + NAMES[type].toLowerCase() + ' defaults'}${f?.properties.source ? ` <i>${f.properties.source}</i>` : ''}</h3>${rows.join('')}` +
      (info.length ? `<p class="iinfo">${info.join('<br>')}</p>` : '') + (f ? '<div class="row"><button class="btn" id="ipDelete" type="button">Delete</button></div>' : '');
    for (const el of box.querySelectorAll('[data-k]')) el.addEventListener('change', () => setProp(f, type, el));
    if (f) $('ipDelete').onclick = () => remove(f.id);
  }
  function setProp(f, type, el) {
    const p = f ? f.properties : defaults[type], k = el.dataset.k, kind = el.dataset.kind;
    if (kind === 'bool') p[k] = el.checked;
    else if (kind === 'text') p[k] = el.value.trim() || null;
    else if (kind === 'select') { p[k] = /^[\d.]+$/.test(el.value) ? Number(el.value) : el.value; if (k === 'system') p.voids = STORAGE_SYSTEMS[el.value].voids; }
    else {
      const raw = el.value.trim(), v = Number(raw);
      if (raw === '') p[k] = null; else if (!Number.isFinite(v)) return;
      else p[k] = CONVERT.has(kind) ? v * u()[kind][1] : kind === 'int' ? Math.max(0, Math.round(v)) : v;
    }
    if (f) refresh(); renderProps();
  }

  // ---------------------------------------------------------------- barriers: build facts and run results
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  function barrierInfo(f) {
    const out = [], b = barInfo?.list.find(x => x.id === f.id), r = barRes?.find(x => x.id === f.id), p = f.properties;
    if (barInfo && !b) out.push(barInfo.skipped.includes(f.id) ? '<span class="warn">Outside the model grid or inside buildings: not in the model</span>' : '');
    if (b) {
      out.push(`Crest ${fmt('elev', b.crestMin)}${b.crestMax - b.crestMin > 0.005 ? `–${fmt('elev', b.crestMax)}` : ''} ${unit('elev')} NAVD88 on ${b.faces.length} cell faces`);
      if (b.fill > 0) out.push(`Berm fill ${fmt('vol', b.fill)} ${unit('vol')} filled into the terrain`);
    }
    if (p.type === 'barrier') out.push(p.deploy === 'none' ? 'Not deployed in this run' : p.deploy === 'time' ? `Goes up ${p.deployAt ?? 0} min into the storm` : 'Up from the start');
    if (r) {
      if (r.overtopped) out.push(`<span class="warn"><b>Overtopped</b>${r.tOver != null ? ` from ${mmss(r.tOver)}` : ''}: ${fmt('vol', r.overVol)} ${unit('vol')} (${Math.round(r.overVol * GAL).toLocaleString()} gal) over, peak ${fmt('rate', r.peakRate)} ${unit('rate')}, ${fmt('unitq', r.peakUnitQ)} ${unit('unitq')} at the worst spot</span>`);
      else if (Number.isFinite(r.minFreeboard)) out.push(`<span class="good"><b>Held</b></span>: ${r.minFreeboard > 0 ? `lowest freeboard ${fmt('elev', r.minFreeboard)} ${unit('elev')}` : 'water reached the crest without flowing over'} (water up to ${fmt('elev', r.maxLevel)} ${unit('elev')})`);
      else out.push('No water against it so far');
      if (r.peakLoad >= 0.05) out.push(`Peak hydrostatic load ${fmt('load', r.peakLoad)} ${unit('load')} at ${mmss(r.tLoad)} (½ρg·Δ(d²) per length, water up to the crest)`);
    }
    return out.filter(Boolean);
  }
  function paintBarriers() {
    if (!map.getSource('infra')) return;
    for (const f of fc.features) if (BARRIERS.has(f.properties.type)) {
      const r = barRes?.find(x => x.id === f.id);
      map.setFeatureState({ source: 'infra', id: f.id }, { st: !r ? '' : r.overtopped ? 'over' : Number.isFinite(r.minFreeboard) ? 'held' : '' });
    }
  }

  // ---------------------------------------------------------------- summary, actions
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function renderSummary() {
    const s = summarize(fc), c = s.count;
    $('infraCount').textContent = s.total ? `${s.total}` : '';
    // only the kinds the layer has, drainage first, then storage, then barriers
    const parts = [
      c.pipe && `${pl(c.pipe, 'pipe')} (${fmt('len', s.pipeLen)} ${unit('len')})`, c.manhole && pl(c.manhole, 'manhole'), c.inlet && pl(c.inlet, 'catch basin'),
      c.outfall && pl(c.outfall, 'outfall'), c.culvert && pl(c.culvert, 'culvert'),
      c.storage && `${pl(c.storage, 'storage unit')}` + (s.storage ? ` holding <b>${fmt('vol', s.storage)} ${unit('vol')}</b> (${Math.round(s.storage * GAL).toLocaleString()} gal)` : ''),
      (() => { const b = fc.features.filter(f => (f.properties.type === 'inlet' || f.properties.type === 'culvert') && f.properties.blocked > 0).length; return b ? `${b} blocked by debris` : ''; })(),
      c.wall + c.berm + c.barrier && [c.wall && pl(c.wall, 'flood wall'), c.berm && pl(c.berm, 'levee'), c.barrier && pl(c.barrier, 'deployable barrier')].filter(Boolean).join(', ') + ` (${fmt('len', s.barrierLen)} ${unit('len')} of barrier)`,
    ].filter(Boolean);
    $('infraSummary').innerHTML = s.total
      ? parts.join(' · ') +
        `.<br>${c.pipe ? 'Build uses these pipes (tier 1) instead of the street estimate.' : c.inlet || c.outfall ? 'No pipes drawn: the street estimate is built around these catch basins and outfalls.' : ''}`
      : 'Empty. Draw features, import a GIS file, or start from the street estimate and correct it.';
  }

  $('infraTools').onclick = (e) => { const b = e.target.closest('button'); if (b) setTool(b.dataset.tool); };
  $('infraUnits').value = units;
  $('infraUnits').onchange = () => { units = $('infraUnits').value; try { localStorage.setItem('floodsim.infraUnits', units); } catch { /* storage off */ } renderProps(); renderSummary(); };
  $('infraToggle').onclick = () => toggle(); $('infraClose').onclick = () => toggle(false);
  function toggle(open = $('infra').hidden) {
    $('infra').hidden = !open; $('infraToggle').setAttribute('aria-expanded', open);
    if (!open) { setTool('select'); select(null); map.getContainer().classList.remove('infra-drawing'); map.getCanvas().style.cursor = ''; }
  }
  $('infraEstimate').onclick = async () => {
    const note = $('infraNote');
    try {
      note.textContent = 'Estimating from the streets…';
      const feats = await estimate(); if (!feats) { note.textContent = 'Build a model first: the estimate follows its streets, lidar and design storm.'; return; }
      const replaced = fc.features.filter(f => ['pipe', 'manhole', 'inlet', 'outfall'].includes(f.properties.type)).length;
      if (replaced && !confirm(`Replace the ${replaced} pipes and structures in the layer with the estimate? Culverts and storage are kept.`)) { note.textContent = ''; return; }
      fc.features = [...fc.features.filter(f => !['pipe', 'manhole', 'inlet', 'outfall'].includes(f.properties.type)), ...feats];
      select(null); refresh();
      note.textContent = `Estimated ${feats.filter(f => f.properties.type === 'pipe').length} pipes with sizes and inverts. Edit any of them; Build uses the layer as drawn.`;
    } catch (e) { note.textContent = 'Estimate failed: ' + e.message; }
  };
  $('infraImport').onclick = () => $('infraFile').click();
  $('infraFile').onchange = async () => {
    const files = [...$('infraFile').files]; $('infraFile').value = ''; if (!files.length) return;
    const note = $('infraNote'); note.textContent = 'Reading ' + files.map(f => f.name).join(', ') + '…';
    try {
      const items = await readFiles(files, { fetcher });
      const { features, skipped } = toLayer(items, { as: $('infraAs').value, sizeUnits: $('infraSizeUnits').value, elevUnits: $('infraElevUnits').value, detectPipeFields });
      fc.features.push(...features); refresh();
      const by = {}; for (const f of features) by[f.properties.type] = (by[f.properties.type] || 0) + 1;
      note.textContent = `Imported ${Object.entries(by).map(([t, n]) => `${n} ${NAMES[t].toLowerCase()}${n > 1 ? 's' : ''}`).join(', ') || 'nothing'}` + (skipped.geometry ? `; ${skipped.geometry} features skipped (geometry did not match the type)` : '') + '.';
      fitLayer();
    } catch (e) { note.textContent = 'Import failed: ' + e.message; }
  };
  $('infraExport').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' }));
    a.download = 'floodsim-infrastructure.geojson'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('infraClear').onclick = () => { if (!fc.features.length || !confirm(`Remove all ${fc.features.length} features from the layer?`)) return; fc.features = []; select(null); refresh(); };
  function fitLayer() {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const add = (c) => { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); };
    for (const f of fc.features) { const g = f.geometry; (g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0]).forEach(add); }
    if (w < e || s < n) map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 18 });
  }
  setTool('select'); renderSummary();

  return {
    get layer() { return fc; },
    setLayer(next) { fc = next?.features ? next : { type: 'FeatureCollection', features: [] }; bumpIds(fc); sel = null; refresh(false); save(); renderProps(); },
    inputs: () => layerInputs(fc),
    /** After a build: which storage units joined which manhole (shown in the form). */
    setAttached(list) { attached = list; renderProps(); },
    /** After a build: barrier crests and faces on the grid; during and after a run: their results (map halo, form). */
    setBarriers(list, skipped = []) { barInfo = { list, skipped }; barRes = null; paintBarriers(); renderProps(); },
    select: (id) => select(id),
    setBarrierResults(rs) { barRes = rs; paintBarriers(); if (sel != null && BARRIERS.has(byId(sel)?.properties.type)) renderProps(); },
    hasPipes: () => fc.features.some(f => f.properties.type === 'pipe'),
  };
}
