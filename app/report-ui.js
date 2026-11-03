// Report drawer: the standard H&H outputs of a run, or of a before / after pair with the same forcing, as figures and
// tables (src/report.js): hydrographs at control lines and storm-sewer outfalls, pond stage–storage–discharge and
// stage in time, storm-sewer HGL profiles with surcharge and freeboard checks, water surface profiles along drawn
// profile lines, gutter spread at the inlets against an allowable spread, and for a real storm the validation scorecard
// (src/validate.js: high-water marks, USGS gauge peaks, rain sources, the books). Export: report.html (prints to PDF),
// every figure as SVG and PNG, every table as CSV; with a project open, also under reports/<stamp>/.
import * as R from '../src/report.js';
import * as C from '../src/compare.js';
import { zip } from '../src/export.js';
import * as FEMA from '../src/fema.js';
import * as V from '../src/validate.js';
import { labelImage } from './labels.js';
import { areasSection } from './report-areas.js';
import { damageSection, eadSection } from './report-damage.js';
import { checksSection, sensitivitySection } from './report-checks.js';
import { mapsSection, streetsSection } from './report-maps.js';
import { csoSection } from './report-cso.js';
import { inflowSection } from './report-inflow.js';
import { compoundSection } from './report-compound.js';
import { rainQaSection } from './report-rainqa.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FT = 0.3048, CF = 0.028316846592;
const fmtNum = (v, dp) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }) : '–');

export function initReport(map, api) {
  let A = null, B = null, busy = false, hglFrom = null, last = null;
  const us = () => api.units() === 'us';
  // display units: length, elevation, flow, volume, spread
  const U = () => (us() ? { len: 'ft', L: (m) => m / FT, q: 'cfs', Q: (v) => v / CF, vol: 'ft³', V: (v) => v / CF, dpL: 2, dpQ: 2 } : { len: 'm', L: (m) => m, q: 'm³/s', Q: (v) => v, vol: 'm³', V: (v) => v, dpL: 2, dpQ: 3 });
  const settings = () => ({ freeboard: (Number($('repFb').value) || (us() ? 1 : 0.3)) * (us() ? FT : 1), spread: (Number($('repSpread').value) || (us() ? 8 : 2.4)) * (us() ? FT : 1), bfeFreeboard: api.bfeFreeboard?.() ?? 0.3048,
    areaTh: Number($('repAreaTh')?.value) || 0.15, wall: Number($('repWall')?.value) || 0.10, bca: { cost: Number($('repCost')?.value) || 0, om: Number($('repOM')?.value) || 0, rate: (Number($('repRate')?.value) || 0) / 100, years: Number($('repYears')?.value) || 50 } });

  // ---------------------------------------------------------------- runs
  async function listRuns() {
    const mem = api.records().filter(r => !r.emulated).map(r => ({ key: 'm:' + r.id, label: r.label, forcing: r.forcing?.hash, scenario: r.scenario, src: 'this session' }));
    let saved = []; try { saved = (await api.savedRuns()).filter(r => r.grids).map(r => ({ key: 's:' + r.dir, label: `${r.scenario} · ${r.dir}`, forcing: r.forcingHash, scenario: r.scenario, src: 'project' })); } catch { /* no project */ }
    return [...mem, ...saved];
  }
  async function fillPickers() {
    const runs = await listRuns(), opt = (r) => `<option value="${esc(r.key)}">${esc(r.label)} — ${r.src}</option>`;
    const va = $('repA').value, vb = $('repB').value;
    $('repA').innerHTML = '<option value="">None (one run)</option>' + runs.map(opt).join('');
    $('repB').innerHTML = '<option value="">Pick a run…</option>' + runs.map(opt).join('');
    if (runs.some(r => r.key === va)) $('repA').value = va;
    if (runs.some(r => r.key === vb)) $('repB').value = vb; else { const b = runs.find(r => r.scenario && r.scenario !== 'Existing conditions') ?? runs[0]; if (b) $('repB').value = b.key; }
    if (!$('repA').value && $('repB').value) { const fb = runs.find(r => r.key === $('repB').value); const a = runs.find(r => r.key !== fb?.key && (!r.scenario || r.scenario === 'Existing conditions') && r.forcing === fb?.forcing); if (a) $('repA').value = a.key; }
    $('repNote').textContent = runs.length ? '' : 'No runs yet: run the model (or Run both in Compare) first.';
  }
  const getRun = async (key) => (!key ? null : key.startsWith('m:') ? api.records().find(r => 'm:' + r.id === key) : api.loadSaved(key.slice(2)));

  async function compute() {
    if (busy) return; busy = true; $('repOut').innerHTML = '<p class="note">Building the report…</p>';
    try {
      const [a, b] = await Promise.all([getRun($('repA').value), getRun($('repB').value)]);
      if (!b) { $('repOut').innerHTML = ''; return; }
      if (a && a.forcing?.hash !== b.forcing?.hash) { const ok = C.comparable(a, b); if (!ok.ok) { $('repOut').innerHTML = `<p class="iinfo warn"><b>Not a before / after pair.</b> ${esc(ok.reason)} Pick “None” for a one-run report.</p>`; A = null; B = b; return; } }
      // flooded areas and building damage per run, and the return-period family for EAD (app/map.js analyzeRecord, eadFamily)
      if (api.analyze) { $('repOut').innerHTML = '<p class="note">Flooded areas, streets, building damage, expected annual damage, model checks and sensitivity…</p>';
        for (const r of [a, b].filter(Boolean)) { await api.analyze(r, { threshold: settings().areaTh, wall: settings().wall }).catch(e => console.warn('analysis', e)); r.ead = await api.eadFamily?.(r, { wall: settings().wall }).catch(e => { console.warn('EAD', e); return null; }) ?? null;
          await api.checks?.(r, { threshold: settings().areaTh, wall: settings().wall }).catch(e => console.warn('checks', e)); } } // app/map.js checksOf: model checks and sensitivity
      A = a; B = b; render();
    } catch (e) { console.error(e); $('repOut').innerHTML = `<p class="iinfo warn">${esc(e.message)}</p>`; }
    finally { busy = false; }
  }

  // ---------------------------------------------------------------- sections (theme: 'dark' in the drawer, 'light' in report.html)
  /** Every section as { id, title, note, figures: [{ name, svg }], tables: [{ name, title, cols, rows }] }. */
  function sections(theme) {
    const size = theme === 'dark' ? { width: 380, height: 240 } : {}; // the drawer draws at its own width (text stays legible)
    const u = U(), s = settings(), out = [], runs = [['before', A], ['after', B]].filter(([, r]) => r), tag = (role) => (A ? (role === 'before' ? 'Before' : 'After') : 'Run');
    const min = (t) => t / 60;

    // 1. hydrographs: control lines and outfalls
    {
      const figs = [], rows = [];
      const lineIds = [...new Set(runs.flatMap(([, r]) => (r.lines ?? []).map(l => l.id)))];
      for (const id of lineIds) {
        const series = [], name = runs.map(([, r]) => r.lines?.find(l => l.id === id)?.name).find(Boolean) ?? `Line ${id}`;
        for (const [role, r] of runs) {
          const l = r.lines?.find(x => x.id === id); if (!l) continue;
          const gross = l.series?.length > 1 && l.series[1].length >= 4, q = C.hydrograph(l.series ?? [], gross ? 2 : 1), st = R.seriesStats(q);
          series.push({ name: tag(role), role: A ? role : 'after', pts: q.map(([t, v]) => [min(t), u.Q(v)]) });
          rows.push({ where: name, run: tag(role), peak: u.Q(st.peak), tPeak: min(st.tPeak), volume: u.V(st.volume) });
        }
        figs.push({ name: `hydrograph_${slug(name)}`, svg: R.lineChart(series, { title: `${name}: flow out across the line`, xLabel: 'time, min', yLabel: `flow, ${u.q}`, zeroY: true, theme, ...size }) });
      }
      const outNames = new Map();
      for (const [, r] of runs) (r.hgl?.outfalls ?? []).forEach((i) => outNames.set(r.network?.nodes[i]?.name ?? 'O' + i, true));
      for (const nm of outNames.keys()) {
        const series = [];
        for (const [role, r] of runs) {
          const j = (r.hgl?.outfalls ?? []).findIndex(i => (r.network?.nodes[i]?.name ?? 'O' + i) === nm); if (j < 0) continue;
          const q = r.hgl.series.map(row => [row[0], row[1 + j]]), st = R.seriesStats(q); if (!(st.peak > 1e-6)) continue;
          series.push({ name: tag(role), role: A ? role : 'after', pts: q.map(([t, v]) => [min(t), u.Q(v)]) });
          rows.push({ where: `Outfall ${nm}`, run: tag(role), peak: u.Q(st.peak), tPeak: min(st.tPeak), volume: u.V(st.volume) });
        }
        if (series.length) figs.push({ name: `outfall_${slug(nm)}`, svg: R.lineChart(series, { title: `Storm sewer outfall ${nm}`, xLabel: 'time, min', yLabel: `flow, ${u.q}`, zeroY: true, theme, ...size }) });
      }
      if (figs.length) out.push({ id: 'hydro', title: 'Hydrographs', note: 'Control lines: flow out across the line (to its right as drawn, out of a closed line), booked every solver step and sampled every 10 s. Outfalls: SWMM inflow at each outfall node, every 10 s. Volume by the trapezoid rule.',
        figures: figs, tables: [{ name: 'hydrograph_summary', title: 'Peak, time to peak and volume', cols: [['where', 'location'], ['run', 'run'], ['peak', `peak_${u.q}`, u.dpQ], ['tPeak', 'time_to_peak_min', 0], ['volume', `volume_${u.vol}`, 0]], rows }] });
    }

    // 2. ponds
    {
      const figs = [], rows = [], tables = [];
      const ids = [...new Set(runs.flatMap(([, r]) => (r.ponds ?? []).map(p => p.id)))];
      for (const id of ids) {
        const pb = B.ponds?.find(p => p.id === id) ?? A?.ponds?.find(p => p.id === id), name = pb?.name ?? `Pond outlet ${id}`;
        if (pb?.stageStorage && pb.structure) {
          const t = R.stageStorageDischarge(pb.stageStorage, pb.structure, { rows: 30 });
          figs.push({ name: `pond_storage_${slug(name)}`, svg: R.lineChart([{ name: 'storage', role: 'after', pts: t.map(r => [u.V(r.storage), u.L(r.stage)]), label: false }], { title: `${name}: stage–storage`, xLabel: `storage, ${u.vol}`, yLabel: `stage, ${u.len}`, theme, ...(theme === 'dark' ? size : { width: 320, height: 260 }) }) });
          figs.push({ name: `pond_discharge_${slug(name)}`, svg: R.lineChart([{ name: 'discharge', role: 'after', pts: t.map(r => [u.Q(r.q), u.L(r.stage)]), label: false }], { title: `${name}: stage–discharge`, xLabel: `outflow, ${u.q}`, yLabel: `stage, ${u.len}`, theme, ...(theme === 'dark' ? size : { width: 320, height: 260 }) }) });
          tables.push({ name: `ssd_${slug(name)}`, title: `${name}: stage–storage–discharge (free outfall)`, cols: [['stage', `stage_${u.len}`, 2], ['depth', `depth_${u.len}`, 2], ['storage', `storage_${u.vol}`, 0], ['q', `outflow_${u.q}`, u.dpQ], ['orifices', `orifices_${u.q}`, u.dpQ], ['weir', `riser_weir_${u.q}`, u.dpQ], ['spillway', `spillway_${u.q}`, u.dpQ]],
            rows: t.map(r => ({ stage: u.L(r.stage), depth: u.L(r.depth), storage: u.V(r.storage), q: u.Q(r.q), orifices: u.Q(r.orifices), weir: u.Q(r.weir), spillway: u.Q(r.spillway) })) });
        }
        const stageS = [], flowS = [], refs = [];
        if (pb?.structure?.weir) refs.push({ y: u.L(pb.structure.weir.crest), label: 'riser crest' });
        if (pb?.structure?.spillway) refs.push({ y: u.L(pb.structure.spillway.crest), label: 'spillway' });
        if (pb?.stageStorage?.h?.length) refs.push({ y: u.L(pb.stageStorage.h.at(-1)), label: 'top of bank' });
        for (const [role, r] of runs) {
          const p = r.ponds?.find(x => x.id === id); if (!p?.series?.length) continue;
          stageS.push({ name: `${tag(role)} stage`, role: A ? role : 'after', pts: p.series.map(x => [min(x[0]), u.L(x[1])]) });
          flowS.push({ name: `${tag(role)} outflow`, role: A ? role : 'after', pts: p.series.map(x => [min(x[0]), u.Q(x[2])]) });
          if (!A && p.stageStorage) flowS.push({ name: 'inflow (from storage)', role: 'line', dash: true, pts: pondInflow(p).map(([t, q]) => [min(t), u.Q(q)]) });
          rows.push({ pond: name, run: tag(role), peakStage: u.L(p.peakStage), freeboard: p.freeboard == null ? NaN : u.L(p.freeboard), peakQ: u.Q(p.peakQ), tPeak: min(p.tPeakQ), volume: u.V(p.volume) });
        }
        if (stageS.length) figs.push({ name: `pond_stage_${slug(name)}`, svg: R.lineChart(stageS, { title: `${name}: stage in time`, xLabel: 'time, min', yLabel: `stage, ${u.len}`, refs, theme, ...size }) });
        if (flowS.length) figs.push({ name: `pond_flow_${slug(name)}`, svg: R.lineChart(flowS, { title: `${name}: ${A ? 'outflow' : 'inflow and outflow'}`, xLabel: 'time, min', yLabel: `flow, ${u.q}`, zeroY: true, theme, ...size }) });
      }
      if (ids.length) out.push({ id: 'ponds', title: 'Detention ponds', note: 'Stage–storage from the graded ground (sum of depth × area over the pond cells); discharge from the outlet rating (orifices, riser weir, emergency spillway) with a free outfall. Stage and outflow as the run computed them every 10 s. Inflow (one-run reports) = outflow + change in storage.',
        figures: figs, tables: [{ name: 'pond_summary', title: 'Peak stage, freeboard to the spillway, peak outflow', cols: [['pond', 'pond'], ['run', 'run'], ['peakStage', `peak_stage_${u.len}`, 2], ['freeboard', `freeboard_${u.len}`, 2], ['peakQ', `peak_outflow_${u.q}`, u.dpQ], ['tPeak', 'time_of_peak_min', 0], ['volume', `volume_out_${u.vol}`, 0]], rows }, ...tables] });
    }

    // 2b. the detention check over the design storms (Compare → Return-period sweep, this session)
    {
      const sw = api.sweep?.() ?? { rows: [], ponds: [] }, figs = [];
      const lines = [...new Map(sw.rows.map(r => [r.line.id, r.line.name ?? `Line ${r.line.id}`])).entries()];
      for (const [id, name] of lines) {
        const rs = sw.rows.filter(r => r.line.id === id).sort((x, y) => x.ari - y.ari);
        figs.push({ name: `detention_${slug(name)}`, svg: R.lineChart([{ name: 'Pre', role: 'before', pts: rs.map(r => [r.ari, u.Q(r.pre)]) }, { name: 'Post', role: 'after', pts: rs.map(r => [r.ari, u.Q(r.post)]) }],
          { title: `${name}: peak outflow by return period`, xLabel: 'return period, yr', yLabel: `peak, ${u.q}`, zeroY: true, theme, ...size }) });
      }
      if (sw.rows.length || sw.ponds.length) out.push({ id: 'sweep', title: 'Detention check over the design storms', note: 'From Compare → Return-period sweep (this session): existing and proposed at each design storm with the same settings. The check: post-development peak ≤ pre-development peak at each control line.',
        figures: figs, tables: [
          { name: 'detention_check', title: 'Pre vs post peak outflow', cols: [['ari', 'return_period_yr', 0], ['name', 'line'], ['pre', `pre_peak_${u.q}`, u.dpQ], ['post', `post_peak_${u.q}`, u.dpQ], ['check', 'check']],
            rows: sw.rows.map(r => ({ ari: r.ari, name: r.line.name ?? r.line.id, pre: u.Q(r.pre), post: u.Q(r.post), check: r.pass == null ? '–' : r.pass ? 'post ≤ pre' : `✕ +${fmtNum((r.ratio - 1) * 100, 0)} %` })) },
          ...(sw.ponds.length ? [{ name: 'detention_ponds', title: 'Pond outlets by design storm', cols: [['ari', 'return_period_yr', 0], ['name', 'outlet'], ['peakStage', `peak_stage_${u.len}`, 2], ['freeboard', `freeboard_${u.len}`, 2], ['peakQ', `peak_outflow_${u.q}`, u.dpQ]],
            rows: sw.ponds.map(o => ({ ari: o.ari, name: o.name ?? o.id, peakStage: u.L(o.peakStage), freeboard: o.freeboard == null ? NaN : u.L(o.freeboard), peakQ: u.Q(o.peakQ) })) }] : [])] });
    }

    // 2c. FEMA flood zones: the model area by zone, and each new building's zone, BFE and floor against it
    {
      const fe = api.fema?.(), ctx = api.ctx();
      if (fe && ctx) {
        const A2 = ctx.geo.dx ** 2, areas = FEMA.zoneAreas(fe.grids, A2), req = settings().bfeFreeboard;
        const rows = Object.entries(areas).sort((p, q) => q[1] - p[1]).map(([c, a]) => ({ zone: FEMA.ZONE_INFO[c]?.label ?? c, area: us() ? a / 4046.8564224 : a / 1e4, share: 100 * a / (ctx.geo.nx * ctx.geo.ny * A2) }));
        const bl = (B.newBuildings ?? []).map(b => { const at = FEMA.atCells(fe.grids, b.cells ?? b.ring ?? []), fb = at.bfe != null ? b.ffe - at.bfe : NaN;
          return { building: b.name ?? `New ${b.id}`, zone: at.zone ?? '–', bfe: at.bfe == null ? NaN : u.L(at.bfe), ffe: u.L(b.ffe), above: u.L(fb), check: !at.sfha ? 'outside the 1 % floodplain' : at.bfe == null ? '! no BFE published' : fb >= req - 1e-6 ? 'ok' : fb >= 0 ? '! under the freeboard' : '✕ below the BFE' }; });
        out.push({ id: 'fema', title: 'FEMA flood zones', note: `FEMA National Flood Hazard Layer (${fe.data.datum}). BFE in zone AE interpolated between the FIRM's BFE lines and cross-sections (inverse distance between the two nearest of different elevation); AH / VE: the zone's BFE; AO: ground + depth; A zones publish none. Check the effective FIRM and any LOMR before relying on it. Required freeboard above the BFE: ${fmtNum(u.L(req), 1)} ${u.len}.`, figures: [],
          tables: [{ name: 'fema_zones', title: 'Model area by flood zone', cols: [['zone', 'zone'], ['area', us() ? 'area_ac' : 'area_ha', 2], ['share', 'share_pct', 0]], rows },
            ...(bl.length ? [{ name: 'fema_buildings', title: 'New buildings: floor against the BFE', cols: [['building', 'building'], ['zone', 'zone'], ['bfe', `bfe_${u.len}`, 2], ['ffe', `ffe_${u.len}`, 2], ['above', `ffe_above_bfe_${u.len}`, 2], ['check', 'check']], rows: bl }] : [])] });
      }
    }

    // 3. storm sewer HGL
    if (B.network && B.hgl) {
      const net = B.network, nodes = net.nodes.map((n, i) => i).filter(i => !net.nodes[i].outfall && !net.nodes[i].offsite && !net.nodes[i].storage);
      const pr = (r, from) => { const nm = net.nodes[from].name, i = r.network?.nodes.findIndex(n => n.name === nm) ?? -1; return i < 0 || !r.hgl ? null : R.hglProfile(r.network, R.hglPath(r.network, i), r.hgl, { freeboard: s.freeboard }); };
      // default: the manhole with the least freeboard, whose path to the outfall is drawn
      if (hglFrom == null || !net.nodes[hglFrom]) { let best = nodes[0], fb = Infinity; for (const i of nodes) { const f = net.nodes[i].ground - (B.hgl.nodes[i]?.maxHead ?? -Infinity); if (f < fb) { fb = f; best = i; } } hglFrom = best; }
      const pb = pr(B, hglFrom), pa = A ? pr(A, hglFrom) : null, figs = [];
      if (pb) {
        const st = pb.stations, pipePts = (top) => pb.pipes.flatMap(p => [[u.L(p.s0), u.L(p.inv0 + top * p.D)], [u.L(p.s1), u.L(p.inv1 + top * p.D)], [NaN, NaN]]); // each pipe on its own
        const series = [{ name: 'rim / ground', role: 'ground', pts: st.map(x => [u.L(x.s), u.L(x.rim)]) }, { name: 'crown', role: 'line', pts: pipePts(1) }, { name: 'invert', role: 'line', pts: pipePts(0) }];
        if (pa) series.push({ name: 'HGL before', role: 'before', pts: pa.stations.map(x => [u.L(x.s), u.L(x.hgl)]) });
        series.push({ name: A ? 'HGL after' : 'max HGL', role: 'after', pts: st.map(x => [u.L(x.s), u.L(x.hgl)]) });
        figs.push({ name: `hgl_${slug(net.nodes[hglFrom].name)}`, svg: R.lineChart(series, { title: `Max HGL from ${net.nodes[hglFrom].name} to the outfall`, xLabel: `distance along the pipes, ${u.len}`, yLabel: `elevation, ${u.len}`, theme, ...size }) });
      }
      const rows = nodes.map(i => {
        const n = net.nodes[i], H = B.hgl.nodes[i]?.maxHead ?? NaN, nm = n.name, ia = A?.network?.nodes.findIndex(x => x.name === nm) ?? -1, Ha = ia >= 0 ? A.hgl?.nodes[ia]?.maxHead ?? NaN : NaN;
        const fb = n.ground - H, outPipe = net.pipes.find(p => p.from === i), crown = outPipe ? outPipe.invUp + outPipe.D : NaN;
        return { node: nm, rim: u.L(n.ground), hglBefore: u.L(Ha), hgl: u.L(H), freeboard: u.L(fb), surcharged: H > crown + 1e-6, flooded: H > n.ground + 1e-6, low: fb < s.freeboard, floodVol: u.V(B.hgl.nodes[i]?.floodVol ?? 0), check: H > n.ground + 1e-6 ? '✕ floods' : fb < s.freeboard ? '! low freeboard' : H > crown + 1e-6 ? 'surcharged' : 'ok' };
      }).sort((x, y) => x.freeboard - y.freeboard);
      const pipes = net.pipes.map((p, k) => ({ pipe: `${net.nodes[p.from].name} → ${net.nodes[p.to].name}`, D: u.L(p.D), maxQ: u.Q(B.hgl.pipes[k]?.maxQ ?? NaN), ratio: B.hgl.pipes[k]?.maxRatio ?? NaN, maxV: u.L(B.hgl.pipes[k]?.maxV ?? NaN) })).sort((x, y) => y.ratio - x.ratio);
      out.push({ id: 'hgl', title: 'Storm sewer hydraulic grade line', note: `Max HGL at each manhole over the run (SWMM node head, every 2 s exchange). Checks: HGL above the rim floods (✕); freeboard to the rim under ${fmtNum(u.L(s.freeboard), 2)} ${u.len} (!); HGL above the crown of the pipe leaving the manhole is surcharged.`,
        figures: figs, pick: { nodes: nodes.map(i => ({ i, name: net.nodes[i].name })), sel: hglFrom },
        nodesMap: nodes.map(i => ({ i, ll: net.nodes[i].ll, check: rows.find(r => r.node === net.nodes[i].name)?.check ?? 'ok', sel: i === hglFrom })),
        tables: [{ name: 'hgl_manholes', title: 'Manholes, least freeboard first', cols: [['node', 'manhole'], ['rim', `rim_${u.len}`, 2], ...(A ? [['hglBefore', `max_hgl_before_${u.len}`, 2]] : []), ['hgl', `max_hgl_${u.len}`, 2], ['freeboard', `freeboard_${u.len}`, 2], ['floodVol', `flooded_${u.vol}`, 0], ['check', 'check']], rows },
          { name: 'hgl_pipes', title: 'Pipes, fullest first', cols: [['pipe', 'pipe'], ['D', `diameter_${u.len}`, 2], ['maxQ', `max_flow_${u.q}`, u.dpQ], ['ratio', 'max_depth_over_D', 2], ['maxV', `max_velocity_${u.len}_per_s`, 2]], rows: pipes }] });
    }

    // 4. water surface profiles
    {
      const ctx = api.ctx(), profiles = api.profiles(), figs = [], tables = [];
      for (const f of profiles) {
        const line = f.geometry.coordinates.map(ctx.toCell), sample = (r) => R.sampleProfile(line, { ground: r.ground ?? ctx.z, wse: r.grids.max_wse, depth: r.grids.max_depth }, ctx.geo, ctx.geo.dx);
        const sb = sample(B), sa = A ? sample(A) : null, series = [];
        if (sa) series.push({ name: 'ground before', role: 'line', dash: true, pts: sa.map(x => [u.L(x.s), u.L(x.ground)]) });
        series.push({ name: A ? 'ground after' : 'ground', role: 'ground', fillBelow: true, pts: sb.map(x => [u.L(x.s), u.L(x.ground)]) });
        if (sa) series.push({ name: 'WSE before', role: 'before', pts: sa.map(x => [u.L(x.s), u.L(x.wse)]) });
        series.push({ name: A ? 'WSE after' : 'max WSE', role: 'after', pts: sb.map(x => [u.L(x.s), u.L(x.wse)]) });
        const fe = api.fema?.(); if (fe) series.push({ name: 'FEMA BFE', role: 'line', dash: true, pts: R.sampleProfile(line, { b: fe.grids.bfe }, ctx.geo, ctx.geo.dx).map(x => [u.L(x.s), u.L(x.b)]) });
        const markers = floorsNear(line, sb, ctx, B).map(m => ({ x: u.L(m.s), y: u.L(m.ffe), label: m.label }));
        const name = f.properties.name ?? 'Profile';
        figs.push({ name: `profile_${slug(name)}`, svg: R.lineChart(series, { title: `${name}: max water surface`, xLabel: `station, ${u.len}`, yLabel: `elevation, ${u.len}`, markers, theme, ...size }) });
        const every = Math.max(1, Math.round((us() ? 25 * FT : 10) / ctx.geo.dx));
        tables.push({ name: `profile_${slug(name)}`, title: `${name}: stations about every ${fmtNum(u.L(every * ctx.geo.dx), 0)} ${u.len}`, cols: [['s', `station_${u.len}`, 0], ...(A ? [['g0', `ground_before_${u.len}`, 2]] : []), ['g', `ground_${u.len}`, 2], ...(A ? [['w0', `max_wse_before_${u.len}`, 2]] : []), ['w', `max_wse_${u.len}`, 2], ['d', `max_depth_${u.len}`, 2], ...(A ? [['dw', `change_${u.len}`, 2]] : [])],
          rows: sb.filter((_, i) => i % every === 0).map((x, j) => { const y = sa?.[j * every]; return { s: u.L(x.s), g0: y ? u.L(y.ground) : NaN, g: u.L(x.ground), w0: y ? u.L(y.wse) : NaN, w: u.L(x.wse), d: u.L(x.depth), dw: y && Number.isFinite(y.wse) && Number.isFinite(x.wse) ? u.L(x.wse - y.wse) : NaN }; }) });
      }
      out.push({ id: 'profiles', title: 'Water surface profiles', note: profiles.length ? 'Along each profile line every 1 m: the ground the run used (the designed ground for a scenario), the max water surface (blank where dry) and the max depth. Bars mark the finished floors of buildings within 5 m (existing ones estimated as the highest adjacent grade + 6 in).' : 'Draw a profile line (Site design → Profile) along a street, swale or channel to add its profile here.', figures: figs, tables });
    }

    // 5. gutter spread
    if (B.inlets?.length) {
      const rows = B.inlets.map((g, m) => {
        const a = A?.inlets?.find(x => x.fineCell === g.fineCell);
        return { m, inlet: `${B.network?.nodes[g.node]?.name ?? 'node ' + g.node} #${m + 1}`, spreadBefore: a ? u.L(a.spread ?? NaN) : NaN, spread: u.L(g.spread ?? NaN), depth: u.L(g.gutterDepth ?? NaN), peakQ: u.Q(g.peakQ ?? NaN), volume: u.V(g.volume ?? NaN), fail: g.spread != null && g.spread > s.spread + 1e-9, check: g.spread == null ? 'no street found' : g.full ? '✕ street full' : g.spread > s.spread + 1e-9 ? '✕ over' : 'ok', full: !!g.full, ll: g.ll };
      }).sort((x, y) => (Number.isFinite(y.spread) ? y.spread : -1) - (Number.isFinite(x.spread) ? x.spread : -1));
      const top = rows.filter(r => Number.isFinite(r.spread)).slice(0, 25);
      const lim = u.L(s.spread), fig = R.barChart(top.map(r => ({ label: r.inlet, value: r.spread, text: `${fmtNum(r.spread, 1)} ${u.len}${r.full ? ' (street full)' : ''}`, fail: r.fail })), { title: `Gutter spread at the inlets (the ${top.length} widest)`, unit: `spread, ${u.len}`, limit: lim, limitLabel: `${fmtNum(lim, 1)} ${u.len} allowable`, theme, ...size });
      out.push({ id: 'spread', title: 'Gutter spread', note: `Spread: from the inlet at the curb, across the street toward the nearest mapped centreline, to where the run's max depth falls under 3 mm (HEC-22 measures spread from the curb); water reaching the far curb is reported as the street full. Gutter depth: max depth at the grate. Intercepted: the inlet's peak rate and volume into the pipes. Allowable spread ${fmtNum(lim, 1)} ${u.len} (set above; many cities use half a lane or one lane).`,
        figures: [{ name: 'gutter_spread', svg: fig }], markers: rows,
        tables: [{ name: 'gutter_spread', title: 'Inlets, widest spread first', cols: [['inlet', 'inlet'], ...(A ? [['spreadBefore', `spread_before_${u.len}`, 1]] : []), ['spread', `spread_${u.len}`, 1], ['depth', `gutter_depth_${u.len}`, 2], ['peakQ', `intercepted_peak_${u.q}`, u.dpQ], ['volume', `intercepted_${u.vol}`, 0], ['check', 'check']], rows }] });
    }

    // 6. summary books
    {
      // every term of the combined books (app/map.js: rain on the ground and from roofs into the sewers, river and sanitary
      // inflow, water at the start, the pipes' storage), so the table closes; a term neither run has is left out
      const bk = (r, k) => r?.books?.[k], IN = [['In: rain on the ground', 'rain'], ['In: rain from roofs piped to the sewers', 'roofs'], ['In: river inflow', 'inflow'], ['In: sanitary flow into the combined sewers', 'sanitary'],
        ['In: water on the ground at the start', 'initial'], ['In: water in the pipes at the start', 'pipesStart'], ['In: infiltrated water the underdrains took to the pipes', 'underdrain']],
        OUT = [['Out: infiltration', 'infil'], ['Out: runoff off the model edge', 'outflow'], ['Out: to the pipe outfalls', 'outfalls'], ['Out: pipe outlets off the model', 'outletsOffsite'], ['Out: on the ground at the end', 'stored'], ['Out: in the pipes at the end', 'pipesEnd']];
      const always = new Set(['rain', 'infil', 'outflow', 'stored']), has = (k) => always.has(k) || [A, B].some(r => Number(bk(r, k)) > 0);
      const sum = (r, list) => list.reduce((a, [, k]) => a + (Number(bk(r, k)) || 0), 0), closes = (r) => r?.books && (bk(r, 'roofs') !== undefined || bk(r, 'outfalls') == null); // older runs lack the roof and sewer terms
      const bal = (r) => (closes(r) ? sum(r, IN) - sum(r, OUT) : NaN), row = (item, f) => ({ item, before: u.V(f(A) ?? NaN), after: u.V(f(B) ?? NaN), change: u.V((f(B) ?? NaN) - (f(A) ?? NaN)) });
      const rows = [...IN, ...OUT].filter(([, k]) => has(k)).map(([label, k]) => row(label, (r) => bk(r, k))).concat([row('Total in', (r) => (closes(r) ? sum(r, IN) : NaN)), row('Balance: in − out', bal)]);
      out.unshift({ id: 'summary', title: 'Summary', note: 'Water balance of the whole model over the run, surface and pipes together: every way water came in and left. The balance is the books’ error (the model checks grade it). Rain from roofs piped to the sewers never reaches the ground, so the rain on the ground alone is less than the storm’s total.', figures: [],
        tables: [{ name: 'water_balance', title: 'Water balance', cols: [['item', 'item'], ...(A ? [['before', `before_${u.vol}`, 0]] : []), ['after', `${A ? 'after' : 'run'}_${u.vol}`, 0], ...(A ? [['change', `change_${u.vol}`, 0]] : [])], rows }] });
    }

    // 7. validation scorecard: each run of a real storm, against what was observed (after the summary)
    for (const [role, r] of runs) {
      const v = r.validation; if (!v?.observed) continue;
      const sc = V.scorecard({ ...v, gauges: v.gauges.filter(g => g.score || !/reading the gauge/.test(g.why)) }), who = A ? ` (${tag(role).toLowerCase()})` : '', key = A ? '_' + role : '';
      const signed = (x, dp) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtNum(Math.abs(x), dp)}`;
      const value = (it) => (it.value == null || (typeof it.value === 'number' && !Number.isFinite(it.value)) ? '–' : it.unit === 'm' ? `${/RMSE/.test(it.label) ? fmtNum(u.L(it.value), 2) : signed(u.L(it.value), 2)} ${u.len}`
        : it.unit === 'min' ? `${signed(it.value, 0)} min` : it.unit === 'share' ? `${fmtNum(it.value * 100, 0)} %` : it.unit === 'ratio' ? fmtNum(it.value, 2) : it.unit === 'rel' ? it.value.toExponential(1) : String(it.value));
      const target = (it) => { const t = it.target; if (!t) return ''; const [g, f] = t;
        return it.unit === 'm' ? `${/RMSE/.test(it.label) ? '≤' : '±'} ${fmtNum(u.L(g), 2)} / ${fmtNum(u.L(f), 2)} ${u.len}` : it.unit === 'min' ? `± ${g} / ${f} min` : it.unit === 'share' ? `≥ ${g * 100} / ${f * 100} %`
          : it.unit === 'ratio' ? `1 ± ${g} / ${f}` : `≤ ${g.toExponential(0)} / ${f.toExponential(0)}`; };
      const mark = { good: '✓ good', fair: '~ fair', poor: '✕ poor', info: '' };
      const rows = sc.items.map(it => ({ group: it.group, check: it.label, value: value(it), target: target(it), status: mark[it.status], note: it.note }));
      const tables = [{ name: 'scorecard' + key, title: 'Checks (target: good / fair)', cols: [['group', 'group'], ['check', 'check'], ['value', 'value'], ['target', 'target_good_fair'], ['status', 'status'], ['note', 'note']], rows }];
      if (v.hwm?.points?.length) tables.push({ name: 'high_water_marks' + key, title: `Observations${v.event ? ': ' + v.event.replace('USGS STN, ', 'USGS high-water marks, ') : ''}`,
        cols: [['name', 'mark'], ['kind', 'kind'], ['observed', `observed_${u.len}`, 2], ['model', `model_${u.len}`, 2], ['error', `error_${u.len}`, 2], ['call', 'flooded_call_or_note']],
        rows: v.hwm.points.map(p => ({ name: p.name, kind: p.kind ?? 'flooded / dry', observed: p.observed == null ? NaN : u.L(p.observed), model: p.model == null ? NaN : u.L(p.model), error: p.error == null ? NaN : u.L(p.error), call: p.call ?? '' }))
          .sort((a, b) => (Number.isFinite(b.error) ? Math.abs(b.error) : -1) - (Number.isFinite(a.error) ? Math.abs(a.error) : -1)) });
      const figures = [];
      for (const g of v.gauges) {
        if (!g.obs?.length || !g.model?.length) continue;
        const t0 = g.model[0][0], h = (t) => (t - t0) / 3600e3, t1 = g.model.at(-1)[0];
        figures.push({ name: `gauge_${g.site}${key}`, svg: R.lineChart([
          { name: 'observed', role: 'before', pts: g.obs.filter(([t]) => t >= t0 - 1800e3 && t <= t1 + 1800e3).map(([t, z]) => [h(t), u.L(z)]) },
          { name: 'model', role: 'after', pts: g.model.map(([t, z]) => [h(t), u.L(z)]) }],
          { title: `USGS ${g.site} ${g.name}: water level`, xLabel: 'hours from the storm start', yLabel: `water surface, ${u.len} NAVD88`, theme, ...size }) });
      }
      const how = v.gauges.filter(g => g.how).map(g => `${g.site}: ${g.how}`).join('; ');
      out.push({ id: 'validation' + key, title: `Validation scorecard${who}`, figures, tables,
        note: `${mark[sc.verdict.status] ? mark[sc.verdict.status].toUpperCase() + ': ' : ''}${sc.verdict.text} Targets are this app's defaults for an urban flood model at 1 m (good / fair), not a published standard. High-water marks: the highest wet 1 m pixel within 3 m of each mark. Gauges: the median water surface of the 9 mapped open-water cells nearest the gauge (within 60 m) at least 10 cm deep, every simulated minute${how ? ` (observed levels: ${how})` : ''}. Rain and books explain a result; the verdict comes from the observations alone.` });
    }
    for (const sec of [rainQaSection({ runs, A, theme, size, u, tag }), mapsSection({ runs, A, theme, size, u, tag }), inflowSection({ runs, A, theme, size, u, tag }), areasSection({ runs, A, theme, size, u, tag }), streetsSection({ runs, theme, size, u, tag }), damageSection({ runs, A, theme, size, tag }), eadSection({ runs, A, theme, size, tag, s: s.bca }), csoSection({ runs, A, theme, size, u, tag }), sensitivitySection({ runs, theme, size, u, tag }), checksSection({ runs, theme, size, u, tag }), compoundSection({ runs, theme, size, u, tag, data: api.compound?.() ?? null })]) if (sec) out.push(sec); // app/report-rainqa.js, report-maps.js, report-inflow.js, report-areas.js, report-damage.js, report-cso.js, report-checks.js, report-compound.js
    const vs = out.filter(sec => sec.id.startsWith('validation') || sec.id === 'maps'); // right after the summary
    if (vs.length) { const rest = out.filter(sec => !vs.includes(sec)); out.length = 0; out.push(rest[0], ...vs, ...rest.slice(1)); }
    return out;
  }
  /** A pond's inflow from its stage series and stage–storage: I = O + ΔS/Δt. */
  function pondInflow(p) {
    const ss = p.stageStorage, S = (h) => R.at(ss.h.map((x, i) => [x, ss.S[i]]), Math.min(ss.h.at(-1), Math.max(ss.h[0], h))), s = p.series, out = [];
    for (let m = 1; m < s.length; m++) { const dt = s[m][0] - s[m - 1][0]; if (dt > 0) out.push([s[m][0], Math.max(0, 0.5 * (s[m][2] + s[m - 1][2]) + (S(s[m][1]) - S(s[m - 1][1])) / dt)]); }
    return out;
  }
  /** Finished floors of buildings within 5 m of a profile line: new ones (their FFE) and existing ones (estimated). */
  function floorsNear(line, samples, ctx, r) {
    const { nx, ny, dx } = ctx.geo, near = new Uint8Array(nx * ny), reach = Math.ceil(5 / dx);
    for (const x of samples) { const c = Math.floor(x.col), w = Math.floor(x.row); for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) { const a = c + i, b = w + j; if (a >= 0 && b >= 0 && a < nx && b < ny) near[b * nx + a] = 1; } }
    const out = [], stationOf = (cells) => { let best = null; for (const k of cells) { const ci = k % nx + 0.5, cj = ((k / nx) | 0) + 0.5; for (const x of samples) { const d = Math.hypot(x.col - ci, x.row - cj); if (!best || d < best.d) best = { d, s: x.s }; } } return best?.s ?? NaN; };
    for (const b of r.newBuildings ?? []) if ((b.ring ?? []).some(k => near[k])) out.push({ s: stationOf(b.ring), ffe: b.ffe, label: `FFE ${b.name ?? 'new'}` });
    const newCells = new Uint8Array(nx * ny); for (const b of r.newBuildings ?? []) for (const k of b.cells ?? []) newCells[k] = 1;
    for (const b of C.existingBuildings(ctx.bld, ctx.z, nx, ny, near, { skip: newCells }).slice(0, 12)) out.push({ s: stationOf(b.ring), ffe: b.ffe, label: 'est.' });
    return out.filter(m => Number.isFinite(m.s));
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'x';

  // ---------------------------------------------------------------- drawer
  function tableHTML(t) {
    const cell = (v, dp) => (typeof v === 'number' ? fmtNum(v, dp ?? 2) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : esc(v));
    return `<table class="dtab"><thead><tr>${t.cols.map(c => `<th>${esc(c[1].replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, 60).map(r => `<tr>${t.cols.map(([k, , dp]) => `<td>${cell(r[k], dp)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.rows.length > 60 ? `<p class="hint">${t.rows.length - 60} more rows in the CSV.</p>` : ''}`;
  }
  function render() {
    const secs = sections('dark'); last = secs;
    $('repOut').innerHTML = `<p class="iinfo">${A ? `Before: <b>${esc(A.label)}</b><br>After: <b>${esc(B.label)}</b>` : `Run: <b>${esc(B.label)}</b>`}</p>` + secs.map(sec => `<h3>${esc(sec.title)}</h3><p class="hint">${esc(sec.note)}</p>` +
      (sec.pick ? `<label class="ifield"><span>From manhole <i>or click one on the map</i></span><select id="repHglFrom">${sec.pick.nodes.map(n => `<option value="${n.i}"${n.i === sec.pick.sel ? ' selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>` : '') +
      sec.figures.map(f => `<div class="rep-fig">${f.svg}</div>`).join('') + sec.tables.map(t => `<details${sec.id === 'summary' ? ' open' : ''}><summary>${esc(t.title)}</summary>${tableHTML(t)}</details>`).join('')).join('') +
      '<div class="row"><button class="btn" id="repExport" type="button">Export report (.zip)</button></div>';
    $('repExport').onclick = () => exportReport().catch(e => { console.error(e); $('repNote').textContent = 'Export failed: ' + e.message; });
    if ($('repHglFrom')) $('repHglFrom').onchange = () => { hglFrom = Number($('repHglFrom').value); render(); };
    drawMarkers(secs.find(s => s.id === 'spread')?.markers ?? []);
    drawNodes(secs.find(s => s.id === 'hgl')?.nodesMap ?? []);
  }
  function drawMarkers(rows) {
    if (!map.isStyleLoaded()) return;
    const fc = { type: 'FeatureCollection', features: rows.filter(r => r.ll).map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: r.ll },
      properties: { fail: r.fail ? 1 : 0, ...(Number.isFinite(r.spread) ? { icon: labelImage(map, fmtNum(r.spread, 1)) } : {}) } })) };
    if (!map.getSource('rep-inlets')) {
      map.addSource('rep-inlets', { type: 'geojson', data: fc });
      map.addLayer({ id: 'rep-inlets', type: 'circle', source: 'rep-inlets', paint: { 'circle-radius': 5, 'circle-color': ['case', ['==', ['get', 'fail'], 1], '#d03b3b', '#0ca30c'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'rep-inlets-label', type: 'symbol', source: 'rep-inlets', filter: ['has', 'icon'], layout: { 'icon-image': ['get', 'icon'], 'icon-anchor': 'top', 'icon-offset': [0, 6] } });
    } else map.getSource('rep-inlets').setData(fc);
    const vis = $('repDrawer').hidden ? 'none' : 'visible'; for (const id of ['rep-inlets', 'rep-inlets-label']) map.setLayoutProperty(id, 'visibility', vis);
  }

  /** Manholes on the map, by their HGL check; a click on one draws its profile to the outfall. */
  function drawNodes(nodes) {
    if (!map.isStyleLoaded()) return;
    const fc = { type: 'FeatureCollection', features: nodes.filter(n => n.ll).map(n => ({ type: 'Feature', geometry: { type: 'Point', coordinates: n.ll }, properties: { i: n.i, sel: n.sel ? 1 : 0, c: n.check.startsWith('✕') ? 2 : n.check.startsWith('!') || n.check === 'surcharged' ? 1 : 0 } })) };
    if (!map.getSource('rep-nodes')) {
      map.addSource('rep-nodes', { type: 'geojson', data: fc });
      map.addLayer({ id: 'rep-nodes', type: 'circle', source: 'rep-nodes', paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 8, 5.5], 'circle-color': ['match', ['get', 'c'], 2, '#d03b3b', 1, '#fab219', '#ffffff'],
        'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#2a78d6', '#1a1a19'], 'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 3, 1.5] } });
      map.on('click', 'rep-nodes', (e) => { if ($('repDrawer').hidden) return; const i = e.features?.[0]?.properties.i; if (i != null) { hglFrom = Number(i); render(); } });
      map.on('mouseenter', 'rep-nodes', () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', 'rep-nodes', () => { map.getCanvas().style.cursor = ''; });
    } else map.getSource('rep-nodes').setData(fc);
    map.setLayoutProperty('rep-nodes', 'visibility', $('repDrawer').hidden ? 'none' : 'visible');
  }

  // ---------------------------------------------------------------- export
  async function svgToPNG(svg, scale = 2) {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('figure did not render')); img.src = url; });
      const cv = document.createElement('canvas'); cv.width = img.width * scale; cv.height = img.height * scale;
      const g = cv.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
      return new Uint8Array(await (await new Promise(res => cv.toBlob(res, 'image/png'))).arrayBuffer());
    } finally { URL.revokeObjectURL(url); }
  }
  async function exportReport() {
    const secs = sections('light'), enc = new TextEncoder(), files = [], stampTxt = new Date().toISOString();
    for (const sec of secs) {
      for (const f of sec.figures) { files.push({ name: `figures/${f.name}.svg`, data: enc.encode(f.svg) }); try { files.push({ name: `figures/${f.name}.png`, data: await svgToPNG(f.svg) }); } catch { /* SVG only */ } }
      for (const t of sec.tables) files.push({ name: `tables/${t.name}.csv`, data: enc.encode(C.toCSV(t.rows, t.cols)) });
    }
    files.push({ name: 'report.html', data: enc.encode(reportHTML(secs, stampTxt)) });
    const name = `floodsim_report_${slug(B.label)}`;
    await api.exportFiles(files, name, zip(files));
    $('repNote').textContent = `Exported ${files.length} files${api.project() ? ' (also in the project folder under reports/)' : ''}. Open report.html and print it to PDF.`;
  }
  function reportHTML(secs, when) {
    const tbl = (t) => `<h4>${esc(t.title)}</h4><table><thead><tr>${t.cols.map(c => `<th>${esc(c[1].replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${t.cols.map(([k, , dp]) => `<td>${typeof r[k] === 'number' ? fmtNum(r[k], dp ?? 2) : typeof r[k] === 'boolean' ? (r[k] ? 'yes' : 'no') : esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FloodSim H&amp;H report</title>
<style>:root{--ink:#0b0b0b;--ink2:#52514e;--rule:#e1e0d9}body{font:13px/1.45 system-ui,Segoe UI,sans-serif;color:var(--ink);background:#fcfcfb;max-width:900px;margin:24px auto;padding:0 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 4px;border-bottom:1px solid var(--rule);padding-bottom:3px;break-after:avoid}h4{font-size:12.5px;margin:14px 0 4px}p.note{color:var(--ink2);margin:4px 0 10px}table{border-collapse:collapse;width:100%;font-size:11.5px;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid var(--rule);padding:2px 6px;text-align:right}th:first-child,td:first-child{text-align:left}th{color:var(--ink2);font-weight:600}.fig{margin:10px 0;break-inside:avoid}.fig svg{max-width:100%;height:auto}.meta td{text-align:left}@media print{body{margin:0;max-width:none}h2{break-before:auto}}</style></head><body>
<h1>H&amp;H results</h1><p class="note">FloodSim ${esc(api.project()?.name ?? '')} · exported ${esc(when)}</p>
<table class="meta"><tbody>${A ? `<tr><td>Before</td><td>${esc(A.label)}</td></tr>` : ''}<tr><td>${A ? 'After' : 'Run'}</td><td>${esc(B.label)}</td></tr><tr><td>Storm</td><td>${esc(B.storm ?? '')}</td></tr><tr><td>Forcing fingerprint</td><td>${esc(B.forcing?.hash ?? '–')}${A ? ' (both runs)' : ''}</td></tr><tr><td>App commit</td><td>${esc(B.commit ?? '–')}</td></tr><tr><td>Units</td><td>${us() ? 'US customary (ft, cfs, ft³), elevations NAVD88' : 'SI (m, m³/s, m³), elevations NAVD88'}</td></tr></tbody></table>
${secs.map(sec => `<h2>${esc(sec.title)}</h2><p class="note">${esc(sec.note)}</p>${sec.figures.map(f => `<div class="fig">${f.svg}</div>`).join('')}${sec.tables.map(tbl).join('')}`).join('\n')}
<p class="note" style="margin-top:28px">2D surface: FloodSim GPU shallow-water solver at the run's grid; storm sewer: EPA SWMM 5.2 coupled every 2 s. Results depend on the inputs listed in each run's summary.json.</p></body></html>`;
  }

  // ---------------------------------------------------------------- wiring
  $('repToggle').onclick = () => toggle(); $('repClose').onclick = () => toggle(false);
  function toggle(on = $('repDrawer').hidden) {
    $('repDrawer').hidden = !on; $('repToggle').setAttribute('aria-expanded', on);
    if (on) { for (const [d, c] of [['design', 'designClose'], ['infra', 'infraClose'], ['cmpDrawer', 'cmpClose'], ['emuDrawer', 'emuClose']]) if ($(d) && !$(d).hidden) $(c).click(); $('repFbUnit').textContent = us() ? 'ft' : 'm'; $('repSpreadUnit').textContent = us() ? 'ft' : 'm'; fillPickers().then(compute); }
    else for (const id of ['rep-inlets', 'rep-inlets-label', 'rep-nodes']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
  for (const id of ['designToggle', 'infraToggle', 'cmpToggle', 'emuToggle']) $(id)?.addEventListener('click', () => { if (!$('repDrawer').hidden) toggle(false); });
  $('repA').onchange = $('repB').onchange = () => { hglFrom = null; compute(); };
  $('repRefresh').onclick = () => fillPickers().then(compute);
  $('repFb').onchange = $('repSpread').onchange = () => { if (B) render(); };
  for (const id of ['repCost', 'repOM', 'repRate', 'repYears']) if ($(id)) $(id).onchange = () => { if (B) render(); };
  for (const id of ['repAreaTh', 'repWall']) if ($(id)) $(id).onchange = () => compute();
  return {
    refresh() { if (!$('repDrawer').hidden) fillPickers(); },
    /** For the console and tests: the sections of the current report. */
    get sections() { return last; },
  };
}
