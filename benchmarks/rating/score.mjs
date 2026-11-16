// RT-1 scorer (README, Scoring). Reads one filed run of an RT-1 project, and the project's rt1.json (the measurements,
// the steps, the gauge), and writes the rows: each step's steady level at the gauge, the model level at each measured
// discharge, and the high-, mid- and low-flow rows against the registered thresholds.
//
//   node benchmarks/rating/score.mjs "RT-1 0214645022 A" [--run <run folder>] [--out <file.json>]
// The run is the newest finished one in the project unless --run names it.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stepWindows } from '../../src/steady.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectsDir = process.env.FLOODSIM_PROJECTS || path.join(homedir(), 'Documents', 'FloodSim Projects');
const FT = 0.3048, CFS = 0.028316846592;
export const THRESHOLDS = { bias: [0.15, 0.30], rmse: [0.20, 0.30] };   // Passed / Qualified (accepted 14 Nov 2026)
const WINDOW_M = 50;            // the model is read within ±50 m of the gauge (README, Reference uncertainty)
const STEADY_MM = 1, STEADY_MIN = 10, OUTFLOW_TOL = 0.01;
const STEADY_SAMPLES = 5;       // readings needed inside the last 10 min; the app records about one a simulated minute (Revision 4)
const SETUP_FLOW = 0.5;         // the gauge section passing less than this share of the top step: not the reach registered (Revision 4)
const RATING_U = { excellent: 0.02, good: 0.05, fair: 0.08 };

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const rd = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);

/** The gauge level each simulated minute: the median of the wet cells within WINDOW_M of the gauge, and their spread. */
function gaugeLevels(gc) {
  const g = gc.gauges[0], near = g.cells.map((c, m) => (c.distM <= WINDOW_M ? m : -1)).filter(m => m >= 0);
  const t0 = Date.UTC(2000, 0, 1); // the steady-flow test's nominal clock (app/map.js gaugeWatch): samples about once a simulated minute
  return { cells: near.length, series: g.t.map((t, k) => { const v = near.map(m => g.wse[k]?.[m]).filter(x => x != null);
    return { t: (t - t0) / 1000, z: v.length ? median(v) : NaN, lo: v.length ? Math.min(...v) : NaN, hi: v.length ? Math.max(...v) : NaN, n: v.length }; }) };
}

/** Flow through a control line over a window (s): the change of its cumulative net volume. */
function lineFlow(line, a, b) {
  const s = line.samples ?? line.series ?? [];
  const at = (t) => { let p = s[0]; for (const q of s) { if (q[0] > t) break; p = q; } return p; };
  const pa = at(a), pb = at(b); return pa && pb && pb[0] > pa[0] ? Math.abs((pb[1] - pa[1]) / (pb[0] - pa[0])) : NaN;
}

/** Level against log Q between the steps; NaN outside their range or where a bracketing step is not steady or has no level. */
function interp(levels, q) {
  const L = [...levels].sort((a, b) => a.q - b.q); // the steps run from the top down (Revision 2)
  for (let i = 1; i < L.length; i++) if (q >= L[i - 1].q && q <= L[i].q) {
    if (!L[i - 1].steady || !L[i].steady || !Number.isFinite(L[i - 1].z) || !Number.isFinite(L[i].z)) return { z: NaN, why: 'a bracketing step did not reach steady' };
    const f = Math.log(q / L[i - 1].q) / Math.log(L[i].q / L[i - 1].q); return { z: L[i - 1].z + f * (L[i].z - L[i - 1].z) };
  }
  return { z: NaN, why: 'outside the stepped range' };
}

/**
 * A smooth curve through the step levels on log Q (monotone cubic, Fritsch-Carlson), for the interpolation diagnostic
 * only (Revision 4): a straight line between steps reads a curved rating high or low, and the gap to this curve says
 * by about how much. Returns q => level, NaN outside the steps. Not used for any verdict.
 */
export function curve(levels) {
  const L = levels.filter(l => Number.isFinite(l.z)).sort((a, b) => a.q - b.q), n = L.length;
  if (n < 2) return () => NaN;
  const x = L.map(l => Math.log(l.q)), y = L.map(l => l.z), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  // end slopes: the three-point estimate, limited so the curve stays monotone (as SciPy's PchipInterpolator)
  const end = (h0, h1, d0, d1) => { const v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); return v * d0 <= 0 ? 0 : d0 * d1 <= 0 && Math.abs(v) > 3 * Math.abs(d0) ? 3 * d0 : v; };
  m[0] = n > 2 ? end(x[1] - x[0], x[2] - x[1], d[0], d[1]) : d[0]; m[n - 1] = n > 2 ? end(x[n - 1] - x[n - 2], x[n - 2] - x[n - 3], d[n - 2], d[n - 3]) : d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], r = a * a + b * b;
    if (r > 9) { const t = 3 / Math.sqrt(r); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (q) => {
    const X = Math.log(q); if (!(X >= x[0] && X <= x[n - 1])) return NaN;
    let i = 0; while (i < n - 2 && X > x[i + 1]) i++;
    const h = x[i + 1] - x[i], t = (X - x[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** dh/dQ at each measurement from its 5 nearest neighbours in Q (a local straight line through the measured points). */
function dhdq(ms, i) {
  const nb = ms.map((m, k) => [Math.abs(Math.log(m.q / ms[i].q)), k]).sort((a, b) => a[0] - b[0]).slice(0, 5).map(([, k]) => ms[k]);
  const mx = nb.reduce((a, m) => a + m.q, 0) / nb.length, my = nb.reduce((a, m) => a + m.gh, 0) / nb.length;
  const sxx = nb.reduce((a, m) => a + (m.q - mx) ** 2, 0); return sxx > 0 ? Math.max(0, nb.reduce((a, m) => a + (m.q - mx) * (m.gh - my), 0) / sxx) : 0;
}

/**
 * How well the measured points agree with each other (Revision 4): each gage height against a straight line on log Q
 * through its 6 nearest neighbours in Q, itself left out. A stable control gives a few cm. A bed that moves between
 * visits (Plum Creek: 0.6 m at one flow between 2015 and 2020) gives more than the thresholds, and then no model can
 * be judged against the points as one rating. → RMS residual (m), or NaN with fewer than 8 points.
 */
export function referenceScatter(ms) {
  if (ms.length < 8) return NaN;
  let ss = 0;
  ms.forEach((m, i) => {
    const nb = ms.map((o, k) => [Math.abs(Math.log(o.q / m.q)), k]).filter(([, k]) => k !== i).sort((a, b) => a[0] - b[0]).slice(0, 6).map(([, k]) => [Math.log(ms[k].q), ms[k].gh]);
    const mx = nb.reduce((a, b) => a + b[0], 0) / nb.length, my = nb.reduce((a, b) => a + b[1], 0) / nb.length, sxx = nb.reduce((a, b) => a + (b[0] - mx) ** 2, 0);
    const fit = my + (sxx > 1e-12 ? nb.reduce((a, b) => a + (b[0] - mx) * (b[1] - my), 0) / sxx * (Math.log(m.q) - mx) : 0);
    ss += (m.gh - fit) ** 2;
  });
  return Math.sqrt(ss / ms.length);
}

export function verdict(errs) {
  if (errs.length < 3) return { verdict: 'Insufficient', why: `${errs.length} scorable measurement${errs.length === 1 ? '' : 's'} (3 needed)` };
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length, rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
  const v = Math.abs(bias) <= THRESHOLDS.bias[0] && rmse <= THRESHOLDS.rmse[0] ? 'Passed' : Math.abs(bias) <= THRESHOLDS.bias[1] && rmse <= THRESHOLDS.rmse[1] ? 'Qualified' : 'Failed';
  return { verdict: v, n: errs.length, biasM: rd(bias), rmseM: rd(rmse) };
}

export function score(rt1, run) {
  const steps = rt1.steps, W = stepWindows({ steps, ramp: Number.isFinite(Number(rt1.ramp)) ? Number(rt1.ramp) : 10 }), G = gaugeLevels(run.gaugeCells);
  const gaugeLine = run.lines.find(l => /gauge/i.test(l.name ?? '')), outLine = run.lines.find(l => /outlet/i.test(l.name ?? ''));
  const levels = W.map((w) => {
    const hold = G.series.filter(p => p.t > w.t1 - STEADY_MIN * 60 - 1 && p.t <= w.t1 + 1), end = hold.at(-1), zs = hold.map(p => p.z);
    // Revision 4: the change over the window is the range of every reading in it (not the two end readings), and a
    // window with too few readings, or any reading without a level, is not steady.
    const drift = zs.length >= STEADY_SAMPLES && zs.every(Number.isFinite) ? Math.max(...zs) - Math.min(...zs) : NaN;
    const qOut = outLine ? lineFlow(outLine, w.t1 - STEADY_MIN * 60, w.t1) : NaN, qG = gaugeLine ? lineFlow(gaugeLine, w.t1 - STEADY_MIN * 60, w.t1) : NaN;
    // Revision 3: the flow test is on the gauge section, not the outlet. Floodplain storage below the gauge drains for
    // hours after each step and holds the outlet off the inflow without moving the gauge level. The outlet is reported.
    const steadyLevel = drift * 1000 < STEADY_MM, steadyFlow = Number.isFinite(qG) ? Math.abs(qG / w.q - 1) <= OUTFLOW_TOL : false;
    return { q: w.q, z: end?.z ?? NaN, spread: end ? [rd(end.lo), rd(end.hi)] : null, wetCells: end?.n ?? 0, samples: zs.length, driftMm: rd(drift * 1000, 2),
      qGauge: rd(qG), qOutlet: rd(qOut), steady: steadyLevel && steadyFlow, steadyLevel, steadyFlow, rising: true };
  });
  // Revision 4: the level must not rise as the flow falls. The level is the median of the cells that are wet, so at a
  // low step where few are left it can jump to a pool above the channel (Plum Creek A, 15 Nov). Such a step has no
  // usable level: it is not steady, and it is not the base of the rating shape.
  { let above = Infinity; for (const l of [...levels].sort((p, q) => q.q - p.q)) { if (!Number.isFinite(l.z)) continue; if (l.z > above + STEADY_MM / 1000) { l.rising = false; l.steady = false; } else above = l.z; } }
  // Revision 4: is this the reach that was registered? A dry gauge, or a gauge section that most of the top flow
  // does not cross, is an invalid setup (README, Model setup), whatever the rows say.
  const top = levels.reduce((p, q) => (q.q > p.q ? q : p));
  const setup = !(top.wetCells > 0) ? 'invalid: no water at the gauge at the top step'
    : !gaugeLine ? 'invalid: no gauge section recorded'
    : !(top.qGauge >= SETUP_FLOW * top.q) ? `invalid: the gauge section passes ${rd(100 * top.qGauge / top.q, 0)} % of the top step's inflow`
    : 'ok';
  const q2 = rt1.q2Cfs * CFS, qMean = rt1.qMean, smooth = curve(levels.filter(l => l.steady));
  const rows = rt1.measurements.map((m, i) => {
    const obs = m.gh + rt1.datum, mod = interp(levels, m.q);
    const uQ = (RATING_U[(m.rated ?? '').toLowerCase()] ?? 0.08) * m.q * dhdq(rt1.measurements, i);
    const U = Math.sqrt(uQ ** 2 + (0.01 * FT) ** 2 + (rt1.datumAcyM ?? 0) ** 2), e = mod.z - obs;
    return { time: m.time, q: rd(m.q), rated: m.rated ?? 'unrated', obs: rd(obs), model: rd(mod.z), e: rd(e), U: rd(U), eNet: Number.isFinite(e) ? rd(Math.sign(e) * Math.max(0, Math.abs(e) - U)) : null,
      interpM: Number.isFinite(e) ? rd(mod.z - smooth(m.q)) : null, // straight line less smooth curve: + where the line reads high (diagnostic)
      band: m.q >= q2 / 2 ? 'high' : m.q >= qMean ? 'mid' : 'low', ...(mod.why ? { why: mod.why } : {}) };
  });
  const row = (b) => { const r = rows.filter(x => x.band === b && x.eNet != null), ip = r.map(x => x.interpM).filter(v => v != null);
    return { ...verdict(r.map(x => x.eNet)), ...(ip.length ? { interpM: rd(ip.reduce((p, q) => p + q, 0) / ip.length) } : {}) }; };
  // rating shape: slope of log(h − h0) on log Q for Q ≥ Q_mean. Revision 4: each side has its own base. The model's h0
  // is its level at the lowest step that has a usable level; the measured points' h0 is the observed level at the lowest
  // measured flow. Before, both used the model's, so the "measured" slope moved with the model.
  const shape = (pts, h0) => { const p = pts.filter(([q, h]) => q >= qMean && h - h0 > 0.01).map(([q, h]) => [Math.log(q), Math.log(h - h0)]); if (p.length < 3 || !Number.isFinite(h0)) return null;
    const mx = p.reduce((a, b) => a + b[0], 0) / p.length, my = p.reduce((a, b) => a + b[1], 0) / p.length; return rd(p.reduce((a, b) => a + (b[0] - mx) * (b[1] - my), 0) / p.reduce((a, b) => a + (b[0] - mx) ** 2, 0)); };
  // Revision 4: the reference itself. Its scatter, and the measurements whose observed level is under the model's lowest
  // ground among the gauge cells: no roughness can put the water there, so the bed or the gauge position differs.
  const scatter = referenceScatter(rt1.measurements), g0 = run.gaugeCells.gauges[0];
  const beds = g0.cells.filter(c => c.distM <= WINDOW_M).map(c => c.bed ?? c.lidar).filter(Number.isFinite), bedLow = beds.length ? Math.min(...beds) : NaN;
  const under = (b) => rows.filter(r => (!b || r.band === b) && r.obs < bedLow).length;
  const reference = { scatterM: rd(scatter), stable: Number.isFinite(scatter) ? scatter <= THRESHOLDS.bias[0] : null, modelBedLowM: rd(bedLow),
    measuredUnderBed: Number.isFinite(bedLow) ? { all: under(), high: under('high'), mid: under('mid') } : null };
  const usable = levels.filter(l => Number.isFinite(l.z) && l.rising), base = usable.length ? usable.reduce((p, q) => (q.q < p.q ? q : p)) : null;
  const mBase = rt1.measurements.length ? rt1.measurements.reduce((p, q) => (q.q < p.q ? q : p)) : null;
  return {
    revision: 4, site: rt1.site.id, config: rt1.config, setup, reference, q2: rd(q2), qMean: rd(qMean), gaugeCellsWithin50m: G.cells,
    rows: { high: row('high'), mid: row('mid'), low: { ...row('low'), scored: false } },
    shape: { model: base ? shape(usable.map(l => [l.q, l.z]), base.z) : null, measured: mBase ? shape(rt1.measurements.map(m => [m.q, m.gh + rt1.datum]), mBase.gh + rt1.datum) : null,
      h0: { model: base ? { q: base.q, z: rd(base.z) } : null, measured: mBase ? { q: rd(mBase.q), z: rd(mBase.gh + rt1.datum) } : null } },
    steady: levels.every(l => l.steady) ? 'all steps steady' : `${levels.filter(l => !l.steady).length} of ${levels.length} steps not steady`,
    levels, measurements: rows,
  };
}

async function main() {
  const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
  const folder = argv.find((a, i) => !a.startsWith('--') && !['--run', '--out'].includes(argv[i - 1]));
  if (!folder) { console.error('usage: node benchmarks/rating/score.mjs "<RT-1 project folder>" [--run <run folder>] [--out <file.json>]'); process.exit(2); }
  const dir = path.join(projectsDir, folder);
  const rt1 = JSON.parse(fs.readFileSync(path.join(dir, 'rt1.json'), 'utf8'));
  const runs = path.join(dir, 'runs'), runDir = opt('run') ?? fs.readdirSync(runs).filter(d => !d.startsWith('_') && fs.existsSync(path.join(runs, d, 'gauge_cells.json'))).sort().at(-1);
  if (!runDir) throw new Error(`no run with gauge_cells.json in ${runs}`);
  const read = (f, d) => (fs.existsSync(path.join(runs, runDir, f)) ? JSON.parse(fs.readFileSync(path.join(runs, runDir, f), 'utf8')) : d);
  const out = { run: runDir, project: folder, ...score(rt1, { gaugeCells: read('gauge_cells.json'), lines: read('lines.json', []), summary: read('summary.json', {}) }) };
  const file = opt('out') ?? path.join(dir, 'runs', runDir, 'rt1-score.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const r = out.rows; console.log(`${folder} (${runDir}): setup ${out.setup}; reference scatter ${out.reference.scatterM} m${out.reference.stable === false ? ' (NOT STABLE: above the 0.15 m threshold)' : ''}, ${out.reference.measuredUnderBed?.all ?? '?'} measured under the model bed; high ${r.high.verdict} ${r.high.biasM ?? ''}/${r.high.rmseM ?? ''} m, mid ${r.mid.verdict} ${r.mid.biasM ?? ''}/${r.mid.rmseM ?? ''} m, low (reported) ${r.low.biasM ?? ''} m; ${out.steady}; shape model ${out.shape.model} vs measured ${out.shape.measured}\n  → ${file}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
