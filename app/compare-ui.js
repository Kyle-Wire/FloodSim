// Compare drawer (phase 2 of docs/specs/site-design-mode.md): pick two runs that share a forcing fingerprint and see
// what the design changed. Δ maps (max depth, max water surface, time above 15 cm, first wetting, hazard class) with a
// no-change band, newly wet and newly dry cells, the off-site adverse impact (outside the site boundary), the buildings
// near the site, and per control line the peak flow, volume and time to peak. Runs come from this session (kept in
// memory, existing conditions cached per fingerprint) or from the project's runs folder. Export: Δ grids (.asc), CSV
// tables and a one-page summary.
import * as C from '../src/compare.js';
import { zip } from '../src/export.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FT = 0.3048, FT3 = 0.028316846592;
/** Δ maps: grid key, title, unit scale for display, no-change band in grid units, colour cap in grid units. */
const MAPS = [
  { key: 'max_wse', title: 'Max water surface', unit: 'mm', scale: 1000, dp: 0, cap: 0.3 },
  { key: 'max_depth', title: 'Max depth', unit: 'mm', scale: 1000, dp: 0, cap: 0.3 },
  { key: 't_above15', title: 'Time above 15 cm', unit: 'min', scale: 1 / 60, dp: 1, cap: 1800, band: 60 },
  { key: 't_wet', title: 'First wetting (arrival)', unit: 'min', scale: 1 / 60, dp: 1, cap: 1800, band: 60 },
  { key: 'hazard', title: 'Hazard class (ARR)', unit: 'classes', scale: 1, dp: 0, cap: 3, band: 0.5 },
];

export function initCompare(map, api) {
  let cmp = null, view = 'max_wse', busy = false;
  const canvas = document.createElement('canvas');

  async function listRuns() {
    const mem = api.records().map(r => ({ key: 'm:' + r.id, label: r.label, forcing: r.forcing.hash, scenario: r.scenario, saved: r.saved, src: 'this session' }));
    let saved = [];
    try { saved = (await api.savedRuns()).filter(r => r.grids).map(r => ({ key: 's:' + r.dir, label: `${r.scenario} · ${r.dir}`, forcing: r.forcingHash, scenario: r.scenario, saved: r.savedUTC, src: 'project' })); } catch { /* no project */ }
    return [...mem, ...saved];
  }
  async function fillPickers() {
    const runs = await listRuns(), opt = (r) => `<option value="${esc(r.key)}">${esc(r.label)} — ${r.src}, forcing ${esc(r.forcing ?? 'none')}</option>`;
    for (const id of ['cmpA', 'cmpB']) { const v = $(id).value; $(id).innerHTML = '<option value="">Pick a run…</option>' + runs.map(opt).join(''); if (runs.some(r => r.key === v)) $(id).value = v; }
    // default: the latest existing-conditions run before, the latest scenario run with the same forcing after
    if (!$('cmpB').value) { const b = runs.find(r => r.scenario && r.scenario !== 'Existing conditions'); if (b) $('cmpB').value = b.key; }
    if (!$('cmpA').value) { const fb = runs.find(r => r.key === $('cmpB').value)?.forcing; const a = runs.find(r => (!r.scenario || r.scenario === 'Existing conditions') && (!fb || r.forcing === fb)); if (a) $('cmpA').value = a.key; }
    $('cmpNote').textContent = runs.length ? '' : 'No runs yet. Run existing conditions and a scenario with the same storm and settings, or press Run both.';
  }
  const getRun = (key) => (key.startsWith('m:') ? api.records().find(r => 'm:' + r.id === key) : api.loadSaved(key.slice(2)));

  async function compute() {
    const ka = $('cmpA').value, kb = $('cmpB').value, ctx = api.ctx();
    if (!ka || !kb || !ctx) { $('cmpOut').innerHTML = ''; return; }
    if (busy) return; busy = true; $('cmpOut').innerHTML = '<p class="note">Comparing…</p>';
    try {
      const [a, b] = await Promise.all([getRun(ka), getRun(kb)]);
      if (a.geo.nx !== ctx.geo.nx || a.geo.ny !== ctx.geo.ny || b.geo.nx !== ctx.geo.nx || a.geo.x0 !== b.geo.x0 || a.geo.y0 !== b.geo.y0) throw new Error('these runs are on a different model grid than the one built now');
      const ok = C.comparable(a, b);
      if (!ok.ok) { cmp = null; draw(); $('cmpOut').innerHTML = `<p class="iinfo warn"><b>Not comparable.</b> ${esc(ok.reason)}</p>`; return; }
      cmp = analyse(a, b, ctx); draw(); render();
    } catch (e) { console.error(e); $('cmpOut').innerHTML = `<p class="iinfo warn">${esc(e.message)}</p>`; }
    finally { busy = false; }
  }
  /** Everything the panel and the export show, from two run records on the current grid. */
  function analyse(a, b, ctx) {
    const { nx, ny } = ctx.geo, A = ctx.geo.dx ** 2, band = Math.max(0, Number($('cmpBand').value) || 3) / 1000;
    const onsite = ctx.siteRing ? C.polygonMask([ctx.siteRing], nx, ny, ctx.toCell) : null;
    // an emulated run's water level is uncertain by its ±σ per cell: a change smaller than 2σ (both runs' σ combined) is
    // within the emulators' error and counts as no change
    const sdA = a.emulated?.sd, sdB = b.emulated?.sd, emuBand = sdA || sdB ? Float32Array.from({ length: nx * ny }, (_, k) => 2 * Math.hypot(sdA?.[k] || 0, sdB?.[k] || 0)) : null;
    const maps = MAPS.map(m => {
      const ga = m.key === 'hazard' ? a.hazard : a.grids[m.key], gb = m.key === 'hazard' ? b.hazard : b.grids[m.key];
      const { delta, stats } = C.diffGrid(ga, gb, { band: m.band ?? band, bandGrid: ['max_wse', 'max_depth'].includes(m.key) ? emuBand : null });
      return { ...m, delta, stats };
    });
    const wetDry = C.newlyWetDry(a.grids.max_depth, b.grids.max_depth, 0.15);
    // buildings near the site: the site boundary (else the new buildings) plus 100 m
    const newB = [...(b.newBuildings ?? []), ...(a.newBuildings ?? []).filter(x => !(b.newBuildings ?? []).some(y => y.id === x.id))].map(x => ({ ...x, isNew: true }));
    let near = onsite; if (!near && newB.length) { near = new Uint8Array(nx * ny); for (const x of newB) for (const k of x.ring) near[k] = 1; }
    const nearMask = near ? C.dilate(near, nx, ny, 100 / ctx.geo.dx) : null;
    const newCells = new Uint8Array(nx * ny); for (const x of newB) for (const k of x.cells ?? []) newCells[k] = 1;
    const existing = nearMask ? C.existingBuildings(ctx.bld, ctx.z, nx, ny, nearMask, { skip: newCells }) : [];
    const buildings = C.buildingTable([...newB, ...existing], a.grids.max_wse, b.grids.max_wse);
    const dWse = maps.find(m => m.key === 'max_wse');
    const impact = C.adverseImpact(dWse.delta, onsite, A, { newlyWet: wetDry.map, buildings: existing });
    const outlets = C.outletTable(a.lines, b.lines);
    const d = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? y - x : NaN), bk = (r, k) => r.books?.[k];
    const tot = {
      'Δ runoff off the model edge': d(bk(a, 'outflow'), bk(b, 'outflow')), 'Δ to the pipe network outfalls': d(bk(a, 'outfalls'), bk(b, 'outfalls')),
      'Δ infiltration': d(bk(a, 'infil'), bk(b, 'infil')), 'Δ impervious area (m²)': (b.design?.totals?.impAdded ?? 0) - (b.design?.totals?.impRemoved ?? 0) - ((a.design?.totals?.impAdded ?? 0) - (a.design?.totals?.impRemoved ?? 0)),
      'Cut / fill (m³)': b.design?.totals ? `${b.design.totals.cut.toFixed(1)} / ${b.design.totals.fill.toFixed(1)}` : '–',
      'Floodplain fill / compensatory cut (m³)': b.design?.totals && Number.isFinite(b.design.totals.floodFill) ? `${b.design.totals.floodFill.toFixed(1)} / ${b.design.totals.compCut.toFixed(1)}` : '–',
    };
    const totals = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, typeof v === 'number' ? (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}${/m²/.test(k) ? '' : ' m³'}` : '–') : v]));
    return { a, b, band, onsite, site: !!onsite, maps, wetDry, buildings, impact, outlets, totals, ctx, A };
  }

  // ---------------------------------------------------------------- map overlay
  function draw() {
    const ctx = api.ctx(); if (!ctx) return;
    const { nx, ny } = ctx.geo; canvas.width = nx; canvas.height = ny;
    const img = new ImageData(nx, ny), px = img.data;
    if (cmp) {
      if (view === 'wetdry') {
        for (let k = 0; k < nx * ny; k++) { const v = cmp.wetDry.map[k]; if (!v) continue; const c = v > 0 ? [214, 39, 40] : [44, 160, 44]; px.set([...c, 230], 4 * k); }
      } else {
        const m = cmp.maps.find(x => x.key === view);
        for (let k = 0; k < nx * ny; k++) {
          const v = m.delta[k]; if (!v || !Number.isFinite(v)) continue; // 0 = no change, NaN = only one run has a value
          const t = Math.min(1, Math.abs(v) / m.cap), c = v > 0 ? [253 - 75 * t, 174 - 150 * t, 97 - 54 * t] : [171 - 138 * t, 217 - 115 * t, 233 - 61 * t];
          px.set([c[0], c[1], c[2], 120 + 135 * t], 4 * k);
        }
      }
      if (cmp.onsite && $('cmpSiteOnly').checked) for (let k = 0; k < nx * ny; k++) if (cmp.onsite[k]) px[4 * k + 3] = 0;
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
    api.setOverlay(canvas, !!cmp && !$('cmpDrawer').hidden);
    legend();
  }
  function legend() {
    const m = MAPS.find(x => x.key === view);
    $('cmpLegend').innerHTML = view === 'wetdry' ? '<span><i style="background:#d62728"></i>newly wet</span> <span><i style="background:#2ca02c"></i>newly dry</span> (deeper than 15 cm)'
      : `<span>lower</span><i class="ramp"></i><span>higher</span> <span class="muted">±${fmtNum(m.cap * m.scale, m.dp)} ${m.unit}; under ${m.band != null ? fmtNum(m.band * m.scale, m.dp) + ' ' + m.unit : (Number($('cmpBand').value) || 3) + ' mm'}: no change</span>`;
  }
  const fmtNum = (v, dp) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }) : '–');

  // ---------------------------------------------------------------- panel
  function render() {
    const c = cmp, us = api.units() === 'us', L = (m) => (us ? `${fmtNum(m / FT, 2)} ft` : `${fmtNum(m, 2)} m`), V = (m3) => (us ? `${fmtNum(m3 / FT3, 0)} ft³` : `${fmtNum(m3, 1)} m³`);
    const Q = (q) => (us ? `${fmtNum(q / FT3, 2)} cfs` : `${fmtNum(q, 3)} m³/s`), area = (a) => (us ? `${fmtNum(a / FT / FT, 0)} ft²` : `${fmtNum(a, 0)} m²`);
    const imp = c.impact, rows = c.maps.map(m => `<tr><td>${m.title}</td><td>${m.stats.rise.toLocaleString()}</td><td>${m.stats.rise ? fmtNum(m.stats.maxRise * m.scale, m.dp) : '–'}</td><td>${m.stats.fall.toLocaleString()}</td><td>${m.stats.fall ? fmtNum(-m.stats.maxFall * m.scale, m.dp) : '–'}</td><td>${m.unit}</td></tr>`).join('');
    const bRows = [...c.buildings].sort((x, y) => (y.kind === 'new') - (x.kind === 'new') || Math.abs(y.dWse || 0) - Math.abs(x.dWse || 0)).slice(0, 40).map(b =>
      `<tr><td>${esc(b.name ?? (b.kind === 'new' ? 'New ' + b.id : 'Existing'))}</td><td>${L(b.ffe)}${b.estimated ? ' <i>est.</i>' : ''}</td><td>${Number.isFinite(b.wseBefore) ? L(b.wseBefore) : 'dry'}</td><td>${Number.isFinite(b.wseAfter) ? L(b.wseAfter) : 'dry'}</td>` +
      `<td>${b.floodedBefore == null ? '–' : b.floodedBefore ? '<b class="warn">yes</b>' : 'no'} / ${b.floodedAfter ? '<b class="warn">yes</b>' : 'no'}</td></tr>`).join('');
    const oRows = c.outlets.map(o => `<tr><td>${esc(o.name ?? o.id)}</td><td>${Q(o.peakA)}</td><td>${Q(o.peakB)}</td><td>${V(o.volA)}</td><td>${V(o.volB)}</td><td>${fmtNum(o.tPeakA / 60, 0)} / ${fmtNum(o.tPeakB / 60, 0)}</td></tr>`).join('');
    const better = (o) => Number.isFinite(o.peakA) && Number.isFinite(o.peakB) && Math.abs(o.peakB) <= Math.abs(o.peakA) + 1e-9;
    const emulated = [c.a, c.b].filter(r => r.emulated);
    $('cmpOut').innerHTML =
      (emulated.length ? `<p class="iinfo warn"><b>Emulated: screening only.</b> ${emulated.map(r => esc(r.label)).join(' and ')} ${emulated.length > 1 ? 'are' : 'is'} the emulator's estimate, not a solver run. Confirm with a solver run before using these numbers.</p>` : '') +
      `<p class="iinfo">Same forcing <code>${esc(c.a.forcing.hash)}</code>: the runs differ only in the design. Under ${fmtNum(c.band * 1000, 0)} mm: no change.</p>` +
      `<h3>Off-site impact${c.site ? '' : ' <i>no site boundary: everywhere counts</i>'}</h3><p class="iinfo">${imp.cells ? `<span class="warn"><b>${imp.cells.toLocaleString()} cells (${area(imp.area)}) higher</b>, by up to ${fmtNum(imp.maxRise * 1000, 0)} mm</span>` : '<span class="good"><b>No off-site rise</b> above the band</span>'}` +
      `${imp.newlyWet ? `<br>${imp.newlyWet.toLocaleString()} cells newly wet off-site (${area(imp.newlyWetArea)})` : ''}<br>Existing buildings affected: ${imp.affected.length ? imp.affected.map(b => `${esc(b.id)} (+${fmtNum(b.rise * 1000, 0)} mm)`).join(', ') : 'none'}</p>` +
      `<h3>Changes</h3><table class="dtab"><thead><tr><th>Map</th><th>Up</th><th>max</th><th>Down</th><th>max</th><th></th></tr></thead><tbody>${rows}<tr><td>Newly wet / dry (15 cm)</td><td colspan="5">${c.wetDry.wet.toLocaleString()} / ${c.wetDry.dry.toLocaleString()} cells</td></tr></tbody></table>` +
      `<h3>Totals</h3><p class="iinfo">${Object.entries(c.totals).map(([k, v]) => `${esc(k)}: <b>${esc(v)}</b>`).join('<br>')}</p>` +
      `<h3>Buildings near the site <i>${c.buildings.length}</i></h3>${c.buildings.length ? `<table class="dtab"><thead><tr><th>Building</th><th>FFE</th><th>Water before</th><th>after</th><th>Flooded</th></tr></thead><tbody>${bRows}</tbody></table><p class="note">Existing FFE estimated as HAG + 6 in (est.).</p>` : '<p class="note">Draw a site boundary (Site design → Site) to list the buildings near it.</p>'}` +
      `<h3>Control lines</h3>${c.outlets.length ? `<table class="dtab"><thead><tr><th>Line</th><th>Peak out before</th><th>after</th><th>Net volume before</th><th>after</th><th>Peak at, min</th></tr></thead><tbody>${oRows}</tbody></table>` +
        `<p class="iinfo">${c.outlets.map(o => `${esc(o.name ?? o.id)}: post-development peak ${better(o) ? '<span class="good">≤ pre</span>' : '<span class="warn">exceeds pre</span>'}`).join('<br>')}<br>Peak out: flow to the line's + side (right of the line as drawn; out of a closed line), sampled every ${10} s of the run. Net volume: + minus −, booked every step.</p>` : '<p class="note">Draw control lines (Site design → Control line) at the site outlets; every run then books the flow across them.</p>'}` +
      '<div class="row"><button class="btn" id="cmpExport" type="button">Export comparison (.zip)</button></div>';
    $('cmpExport').onclick = () => exportZip().catch(e => { $('cmpNote').textContent = 'Export failed: ' + e.message; });
  }

  // ---------------------------------------------------------------- export
  async function exportZip() {
    const c = cmp; if (!c) return;
    const enc = new TextEncoder(), geo = c.ctx.geo, files = [], prj = c.ctx.prj;
    for (const m of c.maps) files.push({ name: `delta_${m.key}.asc`, data: enc.encode(C.toASC(m.key === 'hazard' ? m.delta : m.delta.map(v => v), geo, m.key.startsWith('t_') ? 0 : 3)) }, { name: `delta_${m.key}.prj`, data: enc.encode(prj) });
    files.push({ name: 'newly_wet_dry.asc', data: enc.encode(C.toASC(Float32Array.from(c.wetDry.map), geo, 0)) }, { name: 'newly_wet_dry.prj', data: enc.encode(prj) });
    files.push({ name: 'buildings.csv', data: enc.encode(C.toCSV(c.buildings, C.BUILDING_COLS)) });
    files.push({ name: 'control_lines.csv', data: enc.encode(C.toCSV(c.outlets, C.OUTLET_COLS)) });
    const hyd = [], lines = [...new Set([...(c.a.lines ?? []), ...(c.b.lines ?? [])].map(l => l.id))];
    for (const id of lines) for (const [run, tag] of [[c.a, 'before'], [c.b, 'after']]) { const l = run.lines?.find(x => x.id === id); if (l) for (const [t, q] of C.hydrograph(l.series)) hyd.push({ line: id, name: l.name, run: tag, t, q }); }
    files.push({ name: 'control_line_hydrographs.csv', data: enc.encode(C.toCSV(hyd, [['line', 'line'], ['name', 'name'], ['run', 'run'], ['t', 'time_s', 0], ['q', 'flow_m3s', 5]])) });
    const summary = { before: meta(c.a), after: meta(c.b), bandM: c.band, site: c.site, impact: { ...c.impact, kMaxRise: undefined }, changes: Object.fromEntries(c.maps.map(m => [m.key, m.stats])), newlyWet: c.wetDry.wet, newlyDry: c.wetDry.dry, totals: c.totals,
      files: { 'delta_*.asc': 'after − before at 1 m; 0 = no change (under the band); NODATA where only one run has a value (newly wet or dry)', 'delta_t_*.asc': 'seconds', 'delta_hazard.asc': 'ARR class change', 'newly_wet_dry.asc': '+1 newly wet, −1 newly dry (15 cm)' } };
    files.push({ name: 'comparison.json', data: enc.encode(JSON.stringify(summary, null, 1)) });
    files.push({ name: 'summary.html', data: enc.encode(C.summaryHTML({ ...c, a: meta(c.a), b: meta(c.b) })) });
    const name = `comparison_${(c.b.scenario ?? 'existing').replace(/[^\w-]+/g, '-')}_vs_${(c.a.scenario ?? 'existing').replace(/[^\w-]+/g, '-')}`;
    await api.exportFiles(files, name, zip(files));
  }
  const meta = (r) => ({ label: r.label, scenario: r.scenario ?? 'Existing conditions', saved: r.saved, forcing: r.forcing, designHash: r.designHash, commit: r.commit, storm: r.storm });

  // ---------------------------------------------------------------- return-period sweep and the detention check
  let sweepRes = [];
  /** Per return period and control line: pre and post peak outflow, post ≤ pre; per pond outlet: peak stage, freeboard, peak outflow. */
  function sweepTables() {
    const rows = [], ponds = [];
    for (const { ari, before, after } of sweepRes) {
      const ids = [...new Set([...(before.lines ?? []), ...(after.lines ?? [])].map(l => l.id))];
      for (const id of ids) {
        const a = before.lines?.find(l => l.id === id), b = after.lines?.find(l => l.id === id);
        rows.push({ ari, line: { id, name: (b ?? a).name }, pre: a ? C.lineStats(a).peak : NaN, post: b ? C.lineStats(b).peak : NaN, preVol: a?.volume ?? NaN, postVol: b?.volume ?? NaN });
      }
      for (const o of after.ponds ?? []) ponds.push({ ari, ...o });
    }
    return { rows: api.detentionTable(rows), ponds };
  }
  function renderSweep() {
    const us = api.units() === 'us', Q = (q) => (us ? `${fmtNum(q / FT3, 2)} cfs` : `${fmtNum(q, 3)} m³/s`), L = (m) => (us ? `${fmtNum(m / FT, 2)} ft` : `${fmtNum(m, 2)} m`);
    const { rows, ponds } = sweepTables();
    $('swOut').innerHTML = (rows.length ? `<table class="dtab"><thead><tr><th>Storm</th><th>Line</th><th>Pre peak</th><th>Post peak</th><th>Check</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${r.ari}-yr</td><td>${esc(r.line.name ?? r.line.id)}</td><td>${Q(r.pre)}</td><td>${Q(r.post)}</td><td>${r.pass == null ? '–' : r.pass ? '<span class="good">post ≤ pre</span>' : `<b class="warn">+${fmtNum((r.ratio - 1) * 100, 0)} %</b>`}</td></tr>`).join('')}</tbody></table>`
      : sweepRes.length ? '<p class="note">No control lines: draw them at the site outlets (Site design → Control line) to fill the detention check.</p>' : '') +
      (ponds.length ? `<table class="dtab"><thead><tr><th>Storm</th><th>Pond outlet</th><th>Peak stage</th><th>To spillway</th><th>Peak out</th></tr></thead><tbody>${ponds.map(o =>
        `<tr><td>${o.ari}-yr</td><td>${esc(o.name ?? o.id)}</td><td>${L(o.peakStage)}</td><td>${o.freeboard == null ? '–' : o.freeboard >= 0 ? L(o.freeboard) : `<b class="warn">over by ${L(-o.freeboard)}</b>`}</td><td>${Q(o.peakQ)}</td></tr>`).join('')}</tbody></table>` : '') +
      (rows.length ? '<div class="row"><button class="btn" id="swCsv" type="button">Detention table (.csv)</button></div>' : '');
    if ($('swCsv')) $('swCsv').onclick = () => {
      const csv = C.toCSV(rows.map(r => ({ ari: r.ari, line: r.line.id, name: r.line.name, pre: r.pre, post: r.post, pass: r.pass, preVol: r.preVol, postVol: r.postVol })),
        [['ari', 'return_period_yr'], ['line', 'line'], ['name', 'name'], ['pre', 'pre_peak_m3s', 4], ['post', 'post_peak_m3s', 4], ['pass', 'post_le_pre'], ['preVol', 'pre_volume_m3', 1], ['postVol', 'post_volume_m3', 1]]) +
        (ponds.length ? '\n' + C.toCSV(ponds, [['ari', 'return_period_yr'], ['id', 'outlet'], ['name', 'name'], ['peakStage', 'peak_stage_m', 3], ['freeboard', 'freeboard_to_spillway_m', 3], ['peakQ', 'peak_outflow_m3s', 4], ['volume', 'volume_out_m3', 1]]) : '');
      api.exportFiles([{ name: 'detention_check.csv', data: new TextEncoder().encode(csv) }], 'detention_check', new TextEncoder().encode(csv), 'text/csv');
    };
  }
  $('swRun').onclick = async () => {
    const aris = $('swAris').value.split(/[,\s]+/).map(Number).filter(v => v > 0);
    if (!aris.length) { $('swNote').textContent = 'List the return periods, e.g. 2, 10, 25, 100.'; return; }
    $('swRun').disabled = true; $('swCancel').disabled = false; sweepRes = []; renderSweep();
    try {
      await api.runSweep(aris, (t) => { $('swNote').textContent = t; }, (r) => { sweepRes.push(r); renderSweep(); fillPickers(); });
      $('swNote').textContent = `Sweep done: ${sweepRes.length} return period${sweepRes.length === 1 ? '' : 's'}.`;
    } catch (e) { $('swNote').textContent = e.message; }
    finally { $('swRun').disabled = false; $('swCancel').disabled = true; }
  };
  $('swCancel').onclick = () => { api.cancelSweep(); $('swNote').textContent = 'Cancelling…'; };

  // ---------------------------------------------------------------- wiring
  $('cmpToggle').onclick = () => toggle(); $('cmpClose').onclick = () => toggle(false);
  function toggle(on = $('cmpDrawer').hidden) {
    $('cmpDrawer').hidden = !on; $('cmpToggle').setAttribute('aria-expanded', on);
    if (on) { for (const id of ['design', 'infra']) if (!$(id).hidden) $(id + 'Close').click(); fillPickers().then(compute); }
    api.setOverlay(canvas, on && !!cmp);
  }
  for (const id of ['design', 'infra']) $(id + 'Toggle').addEventListener('click', () => { if (!$(id).hidden && !$('cmpDrawer').hidden) toggle(false); });
  $('cmpA').onchange = $('cmpB').onchange = () => compute();
  $('cmpBand').onchange = () => compute();
  $('cmpView').onchange = () => { view = $('cmpView').value; draw(); };
  $('cmpSiteOnly').onchange = () => draw();
  $('cmpRefresh').onclick = () => fillPickers().then(compute);
  $('cmpPair').onclick = async () => {
    const b = $('cmpPair'); b.disabled = true; $('cmpNote').textContent = '';
    try { await api.runPair((t) => { $('cmpNote').textContent = t; }); await fillPickers(); $('cmpA').value = ''; $('cmpB').value = ''; await fillPickers(); await compute(); }
    catch (e) { $('cmpNote').textContent = e.message; } finally { b.disabled = false; }
  };
  return {
    /** A run finished or was loaded: refresh the lists (and the comparison if the drawer is open). */
    refresh() { if (!$('cmpDrawer').hidden) fillPickers().then(compute); else fillPickers(); },
    clear() { cmp = null; draw(); $('cmpOut').innerHTML = ''; },
  };
}
