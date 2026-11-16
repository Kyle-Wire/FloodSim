// Steady-flow test mode (src/steady.js) and the RT-1 scorer (benchmarks/rating/score.mjs), on synthetic runs whose
// answer is known: a reach that follows an exact rating must score zero error, an offset must land in the registered
// band, and a step that is not steady must not be scored.
// The cases under "Revision 4" are the departures from the README found on 16 Nov 2026 and fixed in that revision
// (benchmarks/rating/REGISTRATION.md).
// Usage: node tests/run-rating-tests.mjs
import { parseSteady, steadyMinutes, stepWindows, steadyFlow } from '../src/steady.js';
import { score, verdict, curve, referenceScatter, THRESHOLDS } from '../benchmarks/rating/score.mjs';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---- src/steady.js
{
  check('parse: empty, blank, not JSON, no steps → null', [null, '', '   ', '{', '{}', '{"steps":[]}', '{"steps":5}'].every(t => parseSteady(t) === null));
  check('parse: a negative flow or a zero hold → null', parseSteady('{"steps":[[-1,60]]}') === null && parseSteady('{"steps":[[1,0]]}') === null && parseSteady('{"steps":[["x",60]]}') === null);
  const s = parseSteady(JSON.stringify({ steps: [['2.5', '90'], [1, 60]], gauge: { site: 'g' } }));
  check('parse: numbers from strings, ramp defaults to 10 min, other fields kept', s.steps[0][0] === 2.5 && s.steps[0][1] === 90 && s.ramp === 10 && s.gauge.site === 'g' && s.fill === undefined);
  check('parse: ramp given, negative ramp clamped to 0', parseSteady('{"steps":[[1,60]],"ramp":4}').ramp === 4 && parseSteady('{"steps":[[1,60]],"ramp":-3}').ramp === 0);
  check('parse: fill kept only when its flow and hours are valid', parseSteady('{"steps":[[1,60]],"fill":{"q":3,"hours":2}}').fill.hours === 2
    && parseSteady('{"steps":[[1,60]],"fill":{"q":3,"hours":0}}').fill === undefined && parseSteady('{"steps":[[1,60]],"fill":{"q":-1,"hours":2}}').fill === undefined);
  check('parse: a step that is not a pair, or steps that are not a list of pairs → null, never a throw', ['{"steps":[5]}', '{"steps":[null]}', '{"steps":[[1]]}', '{"steps":[{}]}', '{"steps":"abc"}', '[]', '5', 'null'].every(t => { try { return parseSteady(t) === null; } catch { return false; } }));
}
{
  const s = parseSteady(JSON.stringify({ steps: [[8, 60], [2, 60], [4, 10]], ramp: 10 })), w = stepWindows(s), q = steadyFlow(s);
  check('minutes: the sum of the holds', steadyMinutes(s) === 130);
  check('windows: the first step has no ramp; later holds start after it', w[0].t0 === 0 && w[0].t1 === 3600 && w[1].t0 === 4200 && w[1].t1 === 7200);
  check('windows: the ramp is at most half of a short step', w[2].t0 === 7200 + 300 && w[2].t1 === 7800);
  check('flow: held on each step', q(0) === 8 && q(3599) === 8 && q(4200) === 2 && q(7199) === 2 && q(7500) === 4);
  check('flow: linear across the ramp, down and up', near(q(3900), 5) && near(q(3600), 8) && near(q(7350), 3));
  check('flow: the last step holds after the end', q(7800) === 4 && q(1e9) === 4);
  let ok = true, prev = q(0); for (let t = 1; t <= 7800; t++) { const v = q(t); if (!(v >= 2 && v <= 8) || Math.abs(v - prev) > 6 / 600 + 1e-9) ok = false; prev = v; }
  check('flow: continuous, inside the stepped range, never faster than the ramp', ok);
  // the volume delivered: holds plus trapezoid ramps
  let vol = 0; for (let t = 0; t < 7800; t++) vol += (q(t) + q(t + 1)) / 2;
  check('flow: volume in = holds + ramps', near(vol, 8 * 3600 + 5 * 600 + 2 * 3000 + 3 * 300 + 4 * 300, 1e-6), `${vol.toFixed(1)} m³`);
  const z = steadyFlow(parseSteady('{"steps":[[3,30]],"ramp":0}'));
  check('flow: one step, no ramp', z(0) === 3 && z(1799) === 3 && z(5000) === 3);
}

// ---- benchmarks/rating/score.mjs
const T0 = Date.UTC(2000, 0, 1), FT = 0.3048, CFS = 0.028316846592;
const rating = (q) => 100 + 0.6 * Math.log(q);          // the reach's true level (m) at flow q: straight on log Q, so the scorer's interpolation is exact
const power = (q) => 100 + 0.8 * q ** 0.4;              // a power-law rating, as real reaches are nearer to
const STEPS = [[40, 120], [20, 120], [10, 120], [5, 120], [2.5, 120], [1.25, 120], [0.6, 120]];
/** A filed run of a reach that follows `level(q)` exactly, sampled each simulated minute. `opt.mutate(k, t, row)` edits a sample. */
function synthRun({ level = rating, steps = STEPS, dt = 60, gaugeShare = 1, cells = [5, 20, 45, 80], mutate } = {}) {
  const s = parseSteady(JSON.stringify({ steps, ramp: 10 })), q = steadyFlow(s), T = steadyMinutes(s) * 60;
  const t = [], wse = [], series = []; let vol = 0;
  for (let k = 0; k * dt <= T; k++) {
    const tt = k * dt; if (k) for (let u = tt - dt; u < tt; u++) vol += (q(u) + q(u + 1)) / 2 * gaugeShare;
    let row = cells.map(() => level(q(tt))); if (mutate) row = mutate(k, tt, row) ?? row;
    t.push(T0 + tt * 1000); wse.push(row); series.push([tt, vol, vol, 0]);
  }
  return { gaugeCells: { gauges: [{ cells: cells.map(distM => ({ distM })), t, wse }] }, lines: [{ name: 'gauge section', series }, { name: 'outlet section', series: series.map(([a, v]) => [a, v * 0.5, v * 0.5, 0]) }], summary: {} };
}
/** The project's rt1.json: measurements on the true rating, datum 90 m, Q2 = 40 m³/s, Q_mean = 2 m³/s. */
function synthRt1({ qs = [38, 30, 24, 21, 15, 9, 6, 3, 2.2, 1.5, 0.9, 0.7], steps = STEPS, rated = 'Good', datumAcyM = 0 } = {}) {
  return { site: { id: 'TEST' }, config: 'A', steps, datum: 90, datumAcyM, q2Cfs: 40 / CFS, qMean: 2,
    measurements: qs.map((q, i) => ({ time: `2020-01-${String(i + 1).padStart(2, '0')}`, q, gh: rating(q) - 90, rated })) };
}
{
  check('verdict: fewer than 3 errors is Insufficient', verdict([]).verdict === 'Insufficient' && verdict([0, 0]).verdict === 'Insufficient');
  check('verdict: the registered thresholds', THRESHOLDS.bias[0] === 0.15 && THRESHOLDS.bias[1] === 0.30 && THRESHOLDS.rmse[0] === 0.20 && THRESHOLDS.rmse[1] === 0.30);
  check('verdict: Passed at the edge, Qualified past it, Failed beyond', verdict([0.149, 0.149, 0.149]).verdict === 'Passed' && verdict([0.151, 0.151, 0.151]).verdict === 'Qualified'
    && verdict([0.299, 0.299, 0.299]).verdict === 'Qualified' && verdict([0.31, 0.31, 0.31]).verdict === 'Failed' && verdict([-0.31, -0.31, -0.31]).verdict === 'Failed');
  check('verdict: RMSE can fail a row whose bias is zero', verdict([0.35, -0.35, 0.35, -0.35]).verdict === 'Failed' && verdict([0.25, -0.25, 0.25, -0.25]).verdict === 'Qualified');
}
{
  const out = score(synthRt1(), synthRun());
  check('exact reach: every step steady', out.steady === 'all steps steady' && out.levels.every(l => l.steady && l.driftMm === 0), out.steady);
  check('exact reach: the step levels are the rating', out.levels.every(l => near(l.z, rating(l.q), 1e-9)));
  check('exact reach: gauge-section flow is the inflow', out.levels.every(l => Math.abs(l.qGauge / l.q - 1) < 1e-3));
  const worst = Math.max(...out.measurements.map(m => Math.abs(m.e)));
  check('exact reach: no error at any measurement, high and mid rows Passed at zero', worst < 1e-3 && out.rows.high.verdict === 'Passed' && out.rows.mid.verdict === 'Passed' && out.rows.high.biasM === 0 && out.rows.mid.rmseM === 0, `worst ${(worst * 1000).toFixed(1)} mm`);
  check('bands: high from Q2/2, mid from Q_mean, low below (reported, not scored)', out.measurements.filter(m => m.band === 'high').length === 4 && out.measurements.filter(m => m.band === 'mid').length === 5
    && out.measurements.filter(m => m.band === 'low').length === 3 && out.rows.low.scored === false);
  check('observed level = gage height + datum', out.measurements.every((m, i) => near(m.obs, +rating(synthRt1().measurements[i].q).toFixed(3), 1e-9)));
  check('rating shape: the model and the measured points give the same slope on the same reach', out.shape.model != null && Math.abs(out.shape.model - out.shape.measured) < 0.05, `${out.shape.model} vs ${out.shape.measured}`);
}
{
  const rt1 = synthRt1(), U = score(rt1, synthRun()).measurements.map(m => m.U);
  const at = (off) => score(rt1, synthRun({ level: q => rating(q) + off }));
  const hi = at(0.25), lo = at(-0.25), far = at(0.6);
  check('offset +0.25 m: Qualified, bias = offset less U_obs', hi.rows.high.verdict === 'Qualified' && hi.rows.mid.verdict === 'Qualified' && hi.rows.high.biasM > 0.15 && hi.rows.high.biasM < 0.25, `high bias ${hi.rows.high.biasM}`);
  check('offset −0.25 m: the same size, negative', near(lo.rows.high.biasM, -hi.rows.high.biasM, 0.002) && lo.rows.mid.verdict === 'Qualified');
  check('offset +0.6 m: Failed', far.rows.high.verdict === 'Failed' && far.rows.mid.verdict === 'Failed');
  const small = score(rt1, synthRun({ level: q => rating(q) + Math.min(...U) / 2 }));
  check('errors inside U_obs count as zero', small.measurements.every(m => m.eNet === 0) && small.rows.high.biasM === 0);
  check('U_obs: at least the gage-height term, larger with a worse measurement rating', U.every(u => u >= +(0.01 * FT).toFixed(3))
    && score(synthRt1({ rated: 'Fair' }), synthRun()).measurements[0].U > score(synthRt1({ rated: 'Excellent' }), synthRun()).measurements[0].U);
  check('U_obs: the datum accuracy is folded in', score(synthRt1({ datumAcyM: 0.1 }), synthRun()).measurements.every(m => m.U >= 0.1));
}
{
  // the 10 m³/s step still rising 0.5 mm a minute through its hold
  const w = stepWindows(parseSteady(JSON.stringify({ steps: STEPS, ramp: 10 })))[2];
  const out = score(synthRt1(), synthRun({ mutate: (k, t, row) => (t > w.t0 && t <= w.t1 ? row.map(v => v + (t - w.t1) / 60 * 0.0005) : row) }));
  const step = out.levels[2], hit = out.measurements.filter(m => m.q > 5 && m.q < 20);
  check('a drifting step is not steady', step.steady === false && step.steadyLevel === false && step.driftMm >= 1, `drift ${step.driftMm} mm`);
  check('measurements bracketed by it are not scored, and say why', hit.length === 3 && hit.every(m => m.model == null && m.eNet == null && /steady/.test(m.why)));
  check('the others are still scored', out.measurements.filter(m => m.q >= 20).every(m => m.eNet === 0) && out.rows.high.verdict === 'Passed');
}
{
  // 7 % of the flow passing round the gauge section (the Boulder Creek runs of 16 Nov)
  const out = score(synthRt1(), synthRun({ gaugeShare: 0.93 }));
  check('gauge section short of the inflow by 7 %: no step steady, both rows Insufficient', out.levels.every(l => !l.steady && l.steadyLevel && !l.steadyFlow) && out.rows.high.verdict === 'Insufficient' && out.rows.mid.verdict === 'Insufficient');
  const none = score(synthRt1(), { ...synthRun(), lines: [] });
  check('no gauge section recorded: not steady', none.levels.every(l => !l.steady));
}
{
  // a dry gauge (the Pennsauken A run of 16 Nov: a road embankment in the terrain dams the creek above the gauge)
  const out = score(synthRt1(), synthRun({ gaugeShare: 0, mutate: (k, t, row) => row.map(() => null) }));
  check('dry gauge: no level, no step steady, nothing scored', out.levels.every(l => !l.steady && l.wetCells === 0) && out.rows.high.verdict === 'Insufficient' && out.measurements.every(m => m.eNet == null));
  check('measurements outside the stepped range are not scored', score(synthRt1({ qs: [60, 50, 45, 0.3, 0.2, 0.1] }), synthRun()).measurements.every(m => m.eNet == null && /outside/.test(m.why)));
  const far = score(synthRt1(), synthRun({ mutate: (k, t, row) => row.map((v, m) => (m === 3 ? v + 5 : v)) }));
  check('cells beyond 50 m of the gauge are not read', far.gaugeCellsWithin50m === 3 && far.rows.high.biasM === 0);
}

// ---- Revision 4
{
  const W = stepWindows(parseSteady(JSON.stringify({ steps: STEPS, ramp: 10 })));
  // README: "gauge level changes < 1 mm over 10 min": the range of the readings, not the two end readings
  const osc = score(synthRt1(), synthRun({ mutate: (k, t, row) => { const w = W.find(x => t > x.t1 - 600 && t <= x.t1); return w ? row.map(v => v + 0.05 * Math.sin(Math.PI * (t - (w.t1 - 600)) / 300)) : row; } }));
  check('steady: a level swinging ±5 cm inside the last 10 min is not steady, though its end readings agree', osc.levels.every(l => !l.steady && !l.steadyLevel && l.driftMm > 90) && osc.rows.high.verdict === 'Insufficient', `drift ${osc.levels[0].driftMm} mm`);
  const sparse = score(synthRt1(), synthRun({ dt: 1200 }));
  check('steady: too few readings in the window is not steady, even on an exact reach', sparse.levels.every(l => !l.steady && l.samples < 5 && l.driftMm === null));
  const gap = score(synthRt1(), synthRun({ mutate: (k, t, row) => (t === W[1].t1 - 300 ? row.map(() => null) : row) }));
  check('steady: a reading with no water inside the window is not steady', gap.levels[1].steady === false && gap.levels[0].steady === true);
  check('steady: a rise just under 1 mm passes, just over fails', score(synthRt1(), synthRun({ mutate: (k, t, row) => row.map(v => v + t * 0.0009 / 600) })).levels.every(l => l.steady)
    && score(synthRt1(), synthRun({ mutate: (k, t, row) => row.map(v => v + t * 0.0012 / 600) })).levels.every(l => !l.steady));
}
{
  // the level is the median of the wet cells: where few are left it can jump to a pool above the channel (Plum Creek A)
  const W = stepWindows(parseSteady(JSON.stringify({ steps: STEPS, ramp: 10 })));
  const out = score(synthRt1(), synthRun({ mutate: (k, t, row) => (t > W[6].t0 ? row.map(v => v + 0.6) : row) }));
  check('a step whose level is above a higher flow\'s has no usable level', out.levels[6].rising === false && !out.levels[6].steady && out.levels.slice(0, 6).every(l => l.rising && l.steady));
  check('the rating shape starts from the lowest usable step, not from it', out.shape.h0.model.q === STEPS[5][0] && out.shape.model != null);
  check('measurements beside it are not scored; the rest are', out.measurements.filter(m => m.q < STEPS[5][0]).every(m => m.eNet == null) && out.rows.high.verdict === 'Passed' && out.rows.mid.verdict === 'Passed');
}
{
  const a = score(synthRt1(), synthRun()), b = score(synthRt1(), synthRun({ level: q => rating(q) + (q < 1 ? 0.2 : 0.05) }));
  check('rating shape: the measured slope does not move when only the model does', a.shape.measured === b.shape.measured && a.shape.h0.measured.z === b.shape.h0.measured.z && a.shape.model !== b.shape.model, `${a.shape.measured}`);
  check('rating shape: each base is reported', near(a.shape.h0.model.z, +rating(0.6).toFixed(3), 1e-9) && a.shape.h0.model.q === 0.6 && a.shape.h0.measured.q === 0.7);
}
{
  check('setup: an exact reach is ok', score(synthRt1(), synthRun()).setup === 'ok' && score(synthRt1(), synthRun()).revision === 4);
  check('setup: a dry gauge at the top step is invalid (Pennsauken A)', /^invalid: no water/.test(score(synthRt1(), synthRun({ gaugeShare: 0, mutate: (k, t, row) => row.map(() => null) })).setup));
  check('setup: most of the top flow missing the gauge section is invalid', /^invalid: the gauge section passes 30 %/.test(score(synthRt1(), synthRun({ gaugeShare: 0.3 })).setup));
  check('setup: no gauge section is invalid', /^invalid: no gauge section/.test(score(synthRt1(), { ...synthRun(), lines: [] }).setup));
  check('setup: 7 % missing is a steady failure, not an invalid setup', score(synthRt1(), synthRun({ gaugeShare: 0.93 })).setup === 'ok');
}
{
  // README: "One extra mid-level run checks the interpolation (diagnostic)." No project has that level. The scorer's
  // straight line on log Q reads a curved rating high; the smooth curve through the same steps says by about how much.
  const rt1 = { ...synthRt1(), measurements: synthRt1().measurements.map(m => ({ ...m, gh: power(m.q) - 90 })) };
  const pw = score(rt1, synthRun({ level: power })), ms = pw.measurements.filter(m => m.e != null);
  const worst = Math.max(...ms.map(m => m.e));
  check('interpolation: on a power-law rating the straight line reads high everywhere', ms.every(m => m.e >= 0) && worst > 0.02 && worst < 0.04, `up to ${(worst * 1000).toFixed(0)} mm with steps a factor of 2 apart`);
  check('interpolation: the diagnostic finds that gap to within 1 cm at every measurement', ms.every(m => Math.abs(m.interpM - m.e) < 0.01), `largest miss ${(Math.max(...ms.map(m => Math.abs(m.interpM - m.e))) * 1000).toFixed(0)} mm`);
  check('interpolation: reported on each row, and no verdict uses it', pw.rows.high.interpM > 0 && pw.rows.mid.interpM > 0 && near(pw.rows.high.biasM, ms.filter(m => m.band === 'high').reduce((a, m) => a + m.eNet, 0) / 4, 0.002));
  check('interpolation: none on a rating that is straight on log Q', score(synthRt1(), synthRun()).measurements.every(m => m.interpM == null || Math.abs(m.interpM) < 1e-3));
  const c = curve(STEPS.map(([q]) => ({ q, z: power(q) })));
  let mono = true; for (let q = 0.6, prev = -Infinity; q <= 40; q *= 1.01) { const v = c(q); if (!(v >= prev)) mono = false; prev = v; }
  check('curve: through every step, rising between them, nothing outside them', STEPS.every(([q]) => near(c(q), power(q), 1e-9)) && mono && Number.isNaN(c(41)) && Number.isNaN(c(0.5)) && Number.isNaN(curve([{ q: 1, z: 1 }])(1)));
}

{
  // the reference against itself
  const ms = synthRt1({ qs: [38, 30, 24, 21, 15, 9, 6, 3, 2.2, 1.5, 0.9, 0.7, 0.65, 12, 4.5, 1.1] }).measurements;
  check('reference: points on one rating have no scatter', referenceScatter(ms) < 1e-9 && score(synthRt1(), synthRun()).reference.stable === true);
  // a bed that sits 0.6 m higher on every other visit
  const moved = ms.map((m, i) => ({ ...m, gh: m.gh + (i % 2 ? 0.6 : 0) })), sc = referenceScatter(moved);
  check('reference: a bed 0.6 m higher on every other visit is not stable', sc > 0.25 && sc < 0.45 && score({ ...synthRt1(), measurements: moved }, synthRun()).reference.stable === false, `${sc.toFixed(2)} m`);
  check('reference: too few points to say', Number.isNaN(referenceScatter(ms.slice(0, 7))) && score(synthRt1({ qs: [30, 20, 10] }), synthRun()).reference.stable === null);
  const run = synthRun(); run.gaugeCells.gauges[0].cells.forEach((c, m) => { c.lidar = 99 + m; c.bed = 98.5 + m; });
  const u = score({ ...synthRt1(), measurements: synthRt1().measurements.map((m, i) => (i < 2 ? { ...m, gh: 8 } : m)) }, run).reference;
  check('reference: measured levels under the lowest gauge-cell bed of the model are counted, by band', u.modelBedLowM === 98.5 && u.measuredUnderBed.all === 2 && u.measuredUnderBed.high === 2 && u.measuredUnderBed.mid === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall rating tests passed');
process.exit(fails ? 1 : 0);
