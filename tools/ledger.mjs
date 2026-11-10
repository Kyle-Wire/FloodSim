// Experiment ledger: one row per saved run across project folders, from each run's own record (summary.json,
// network.json), so a genuine physical improvement can be told from an accidental compensation.
// Columns: configuration (project, scenario, variant), hydrology (rain, soil limit, peak flow and volume against the
// gauge), hydraulics (gauge peak, its error and lag, level NSE / RMSE), geometry (the scenario's features, and the big
// pipes near a point: shape, size, inverts), boundary (free outfall, fixed level, river outlet; the model box) and
// integrity (fingerprint, design hash, code, and flags: a named scenario whose ground equals existing conditions, two
// runs with different inputs under one fingerprint and design, uncommitted code).
//
// Usage: node tools/ledger.mjs "<project folder or name>" … [--near lon,lat[,radius m]] [--min-rise m] [--noise m,share,nse] [--out file.md]
//   Folder names resolve under FLOODSIM_PROJECTS or Documents\FloodSim Projects; a name ending in * matches by prefix.
//   --out writes Markdown and a .csv beside it; without it the Markdown goes to stdout.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const near = opt('--near')?.split(',').map(Number), minRise = Number(opt('--min-rise') ?? 1.5), out = opt('--out');
const NOISE = (opt('--noise') ?? '0.03,0.02,0.02').split(',').map(Number); // run pairs, below
const ROOT = process.env.FLOODSIM_PROJECTS || path.join(os.homedir(), 'Documents', 'FloodSim Projects');
const folders = args.flatMap(a => {
  if (fs.existsSync(a)) return [a];
  if (a.endsWith('*')) return fs.readdirSync(ROOT).filter(n => n.startsWith(a.slice(0, -1))).map(n => path.join(ROOT, n));
  return [path.join(ROOT, a)];
});
if (!folders.length) { console.error('usage: node tools/ledger.mjs "<project>" … [--near lon,lat[,r]] [--out ledger.md]'); process.exit(2); }

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const fx = (v, d = 2) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
const R = 6371000, metres = ([a, b], [c, d]) => Math.hypot((c - a) * Math.PI / 180 * R * Math.cos(b * Math.PI / 180), (d - b) * Math.PI / 180 * R);

/** The big pipes near a point in a run's network.json: "rect 6.7×2.4 m 209.06→208.75; …" */
function pipesNear(dir) {
  if (!near) return '';
  const n = read(path.join(dir, 'network.json')); if (!n?.pipes) return '';
  const r = near[2] ?? 40, at = (i) => n.nodes[i]?.ll;
  return n.pipes.filter(p => p.D >= minRise && [at(p.from), at(p.to)].some(ll => ll && metres(ll, near) <= r))
    .map(p => `${p.W > 0 ? `rect ${fx(p.W, 1)}×${fx(p.D, 1)}` : `round ${fx(p.D, 1)}`} m ${fx(p.invUp)}→${fx(p.invDown)}`).sort().join('; ') || 'none';
}

const rows = [];
for (const folder of folders) {
  const runs = path.join(folder, 'runs'); if (!fs.existsSync(runs)) { console.error(`no runs in ${folder}`); continue; }
  for (const d of fs.readdirSync(runs).filter(x => !x.startsWith('_')).sort()) {
    const dir = path.join(runs, d), s = read(path.join(dir, 'summary.json')); if (!s) continue;
    const inp = s.settings?.inputs ?? {}, g = s.validation?.gauges?.[0], f = g?.flow?.score, area = s.extent ?? s.settings?.area;
    const peakQ = g?.flow?.model?.length ? Math.max(...g.flow.model.filter(p => p[1] != null).map(p => p[1])) : null;
    const stage = inp.outStage !== undefined && String(inp.outStage).trim() !== '' ? Number(inp.outStage) : null;
    // requested (the inputs) and applied (what the run recorded it had; runs before 10 Nov 2026 record none)
    const boundary = inp.outGauge ? `river outlet at USGS ${inp.outGauge}` : Number.isFinite(stage) ? `fixed ${fx(stage)} m (${inp.outSide ?? 'west'})` : 'free outfall';
    const b = s.boundary, applied = !b ? '(not recorded)' : b.kind === 'fixed' ? `fixed ${fx(b.level)} m (${b.side}, ${b.cells} cells)` : b.kind === 'river outlet' ? `river outlet at USGS ${b.site} (${b.side}, ${b.cells} cells)` : b.kind;
    const requested = s.batch?.scenario ?? null, scenario = s.scenario ?? 'Existing conditions';
    const status = [requested && requested !== scenario ? `requested scenario not applied` : '', b && !applied.startsWith(boundary.split(' (')[0]) ? 'requested boundary not applied' : ''].filter(Boolean).join('; ') || 'as requested';
    const feats = Object.values(s.design?.features ?? {}).map(x => `${x.type}: ${x.name ?? ''}`.trim()).join('; ');
    rows.push({
      project: path.basename(folder), run: d, saved: s.savedUTC?.slice(0, 16) ?? '', scenario, requestedScenario: requested ?? '(no batch job)', status, variant: s.batch?.variant ?? '', inp, appliedBoundary: applied,
      rain: (s.storm?.label?.match(/(\d+(?:\.\d+)?) mm/)?.[1] ?? '') + (inp.histSrc ? ` ${inp.histSrc}` : ''), soilLimit: inp.wtDepth ?? '',
      peakQ: fx(peakQ), qPeakRatio: fx(f?.peakRatio, 3), qVolRatio: fx(f?.volumeRatio, 3), qNse: fx(f?.nse, 3),
      gaugePeak: fx(g?.score?.model?.v), obsPeak: fx(g?.score?.obs?.v), peakErr: fx(g?.score?.error), lagMin: fx(g?.score?.lag, 0), levelNse: fx(g?.levelShape?.nse, 3), levelRmse: fx(g?.levelShape?.rmse, 3),
      scenarioFeatures: feats, pipesNear: pipesNear(dir),
      boundary, box: Array.isArray(area) ? area.map(v => v.toFixed(4)).join(',') : '',
      forcing: s.forcingHash ?? s.forcing?.hash ?? '', design: s.designHash ?? '', commit: s.commit ?? '', codeChanged: (s.codeChanged ?? []).join(' '),
      inputsKey: JSON.stringify(Object.keys(inp).sort().map(k => [k, inp[k]])) + '|' + (s.scenario ?? ''), flags: [],
      asked: s.batch?.scenario ?? null, result: [g?.score?.model?.v, peakQ, g?.levelShape?.nse],
    });
  }
}
// integrity flags
for (const r of rows) {
  if (/\+dirty/.test(r.commit)) r.flags.push(/\+dirty\.[0-9a-f]{8}/.test(r.commit) ? 'uncommitted code (hashed)' : 'uncommitted code (not hashed: older record)');
  if (r.scenario !== 'Existing conditions' && rows.some(e => e.scenario === 'Existing conditions' && e.box === r.box && e.design === r.design))
    r.flags.push('scenario named but its ground equals existing conditions: not applied?');
  const same = rows.filter(e => e !== r && e.forcing === r.forcing && e.design === r.design && e.commit === r.commit), short = (l) => l.map(e => e.run.slice(0, 17)).join(', ');
  const twins = same.filter(e => e.inputsKey !== r.inputsKey);
  if (twins.length) r.flags.push(`same fingerprint and design as ${short(twins)} with different inputs`);
}

// ---- run pairs: three different findings, kept apart
//   same record (fingerprint, design, commit, inputs), results within noise → reproducible
//   same record, results beyond noise → investigate: something the record does not hold differed
//   different record, results within noise → insensitive to what differs, or changes that compensate
// The noise band is a setting, not a definition of equivalence: --noise peak m,flow share,NSE (default 0.03,0.02,0.02,
// from a repeated Charlotte run that landed within 0.01 m). The pairs a repeat measured are reported beside it.
const gaps = (a, b) => [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]) / Math.max(Math.abs(a[1]), Math.abs(b[1]), 1e-9), Math.abs(a[2] - b[2])];
const within = (a, b) => { if (a.some(v => v == null) || b.some(v => v == null)) return null; const g = gaps(a, b); return g.every((v, i) => v <= NOISE[i]); };
const whatDiffers = (a, b) => {
  const keys = [...new Set([...Object.keys(a.inp), ...Object.keys(b.inp)])].filter(k => JSON.stringify(a.inp[k]) !== JSON.stringify(b.inp[k]) && !['speed', 'opacity', 'basemap', 'frameEvery'].includes(k));
  return [...keys.map(k => `${k} ${a.inp[k] ?? '∅'}→${b.inp[k] ?? '∅'}`), a.scenario !== b.scenario ? `scenario ${a.scenario}→${b.scenario}` : '', a.design !== b.design ? 'ground (design hash)' : '',
    a.commit !== b.commit ? 'code' : '', a.forcing !== b.forcing && !keys.length ? 'forcing (unlisted part)' : ''].filter(Boolean).join(', ');
};
const pairs = [];
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const a = rows[i], b = rows[j], w = within(a.result, b.result); if (w == null) continue;
  const g = gaps(a.result, b.result), gap = `Δpeak ${g[0].toFixed(3)} m, ΔQ ${(g[1] * 100).toFixed(1)} %, ΔNSE ${g[2].toFixed(3)}`;
  const sameRecord = a.forcing === b.forcing && a.design === b.design && a.commit === b.commit && a.inputsKey === b.inputsKey;
  // an older record's "+dirty" does not say which edits ran: within noise is then only "reproducible, unless the code differed"
  const blind = /\+dirty$/.test(a.commit);
  if (sameRecord) pairs.push({ a, b, finding: w ? (blind ? 'reproducible, unless the unhashed uncommitted code differed' : 'reproducible') : 'investigate: same record, different results', gap, differs: blind ? 'nothing recorded (uncommitted code, not hashed in this older record)' : 'nothing recorded' });
  else if (w && a.project === b.project) pairs.push({ a, b, finding: 'different inputs, similar results: insensitive or compensating', gap, differs: whatDiffers(a, b) });
}
for (const p of pairs) if (p.finding.startsWith('investigate')) for (const r of [p.a, p.b]) r.flags.push(`same record as ${(r === p.a ? p.b : p.a).run.slice(0, 17)} but results apart beyond noise`);

const COLS = [
  ['Configuration', [['project', 'project'], ['run', 'run'], ['requestedScenario', 'requested scenario'], ['scenario', 'applied scenario'], ['status', 'execution status'], ['variant', 'variant']]],
  ['Hydrology', [['rain', 'rain mm'], ['soilLimit', 'soil limit m'], ['peakQ', 'peak Q m³/s'], ['qPeakRatio', 'Q peak / USGS'], ['qVolRatio', 'Q volume / USGS'], ['qNse', 'Q NSE']]],
  ['Hydraulics', [['gaugePeak', 'gauge peak m'], ['obsPeak', 'obs peak m'], ['peakErr', 'peak error m'], ['lagMin', 'lag min'], ['levelNse', 'level NSE'], ['levelRmse', 'level RMSE m']]],
  ['Geometry', [['scenarioFeatures', 'scenario features'], ['pipesNear', near ? `pipes ≥ ${minRise} m within ${near[2] ?? 40} m` : 'pipes near']]],
  ['Boundary', [['boundary', 'requested downstream boundary'], ['appliedBoundary', 'applied'], ['box', 'model box W,S,E,N']]],
  ['Integrity', [['forcing', 'forcing'], ['design', 'design'], ['commit', 'commit'], ['codeChanged', 'code changed'], ['flags', 'flags']]],
];
const cols = COLS.flatMap(([grp, cs]) => cs.map(([k, h]) => ({ grp, k, h }))), cell = (r, k) => (Array.isArray(r[k]) ? r[k].join('; ') : String(r[k] ?? ''));
const md = [`# Experiment ledger`, '', `${rows.length} runs from ${folders.length} project folder${folders.length > 1 ? 's' : ''}; written ${new Date().toISOString().slice(0, 16)}Z by tools/ledger.mjs.`, ''];
for (const [grp] of COLS) {
  const cs = cols.filter(c => c.grp === grp || c.k === 'run');
  md.push(`## ${grp}`, '', '| ' + cs.map(c => c.h).join(' | ') + ' |', '|' + cs.map(() => '---').join('|') + '|');
  for (const r of rows) md.push('| ' + cs.map(c => cell(r, c.k).replace(/\|/g, '\\|')).join(' | ') + ' |');
  md.push('');
}
md.push('## Run pairs', '', `Noise band: ${NOISE[0]} m of gauge peak, ${NOISE[1] * 100} % of peak flow, ${NOISE[2]} of level NSE (\`--noise\`). It is a working threshold, not a definition of equivalence.`, '');
const reps = pairs.filter(p => p.finding.startsWith('reproducible'));
if (reps.length) md.push(`Repeats measured: largest ${['Δpeak', 'ΔQ', 'ΔNSE'].map((k, i) => `${k} ${Math.max(...reps.map(p => gaps(p.a.result, p.b.result)[i] * (i === 1 ? 100 : 1))).toFixed(i === 1 ? 1 : 3)}${i === 1 ? ' %' : ''}`).join(', ')} over ${reps.length} pair${reps.length > 1 ? 's' : ''}.`, '');
md.push('| finding | run A | run B | what differs | gap |', '|---|---|---|---|---|');
for (const p of pairs.sort((x, y) => x.finding.localeCompare(y.finding))) md.push(`| ${p.finding} | ${p.a.run} | ${p.b.run} | ${p.differs.replace(/\|/g, '\\|')} | ${p.gap} |`);
md.push('');
const csv = [cols.map(c => `${c.grp}: ${c.h}`), ...rows.map(r => cols.map(c => cell(r, c.k)))].map(l => l.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n');
if (out) { fs.writeFileSync(out, md.join('\n')); fs.writeFileSync(out.replace(/\.md$/i, '') + '.csv', csv); console.log(`${rows.length} runs → ${out} and .csv`); }
else console.log(md.join('\n'));
