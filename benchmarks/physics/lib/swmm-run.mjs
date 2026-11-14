// The SWMM executor for physics benchmarks: hand-written .inp text (no FloodSim translation in the loop), stepped
// through the production engine (src/swmm.js, vendor/swmm-wasm). Benchmarks may use the solver; references may not.
import { loadSWMM, SWMM } from '../../../src/swmm.js';

let engine = null;
export async function swmm() { engine ??= await loadSWMM(); return engine; }
export const continuity = (rpt) => SWMM.continuity(rpt);
const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');

/** [OPTIONS] block, CMS / metres, dynamic wave. o: { durationS, step, variableStep, surcharge, inertial, normalFlowLimited, minSurfArea } */
export function options(o) {
  return ['[OPTIONS]', 'FLOW_UNITS CMS', 'FLOW_ROUTING DYNWAVE', 'LINK_OFFSETS DEPTH', 'ALLOW_PONDING NO', 'SKIP_STEADY_STATE NO',
    'START_DATE 01/01/2000', 'START_TIME 00:00:00', 'REPORT_START_DATE 01/01/2000', 'REPORT_START_TIME 00:00:00',
    `END_DATE 01/0${1 + Math.floor(o.durationS / 86400)}/2000`, `END_TIME ${hms(o.durationS % 86400)}`, 'REPORT_STEP 00:15:00', 'WET_STEP 00:01:00', 'DRY_STEP 00:01:00',
    `ROUTING_STEP ${o.step ?? 1}`, `VARIABLE_STEP ${o.variableStep ?? 0}`, 'LENGTHENING_STEP 0', `MIN_SURFAREA ${o.minSurfArea ?? 1.167}`,
    `NORMAL_FLOW_LIMITED ${o.normalFlowLimited ?? 'BOTH'}`, `INERTIAL_DAMPING ${o.inertial ?? 'PARTIAL'}`, `SURCHARGE_METHOD ${o.surcharge ?? 'EXTRAN'}`,
    'MIN_SLOPE 0', 'MAX_TRIALS 8', 'HEAD_TOLERANCE 0.0015', 'THREADS 1', ''].join('\n');
}
/** Open an .inp, step to tEnd calling sample(t, e) at least every `every` s; returns { rpt, continuity, version }. */
export async function simulate(inp, tEnd, { every = 60, beforeStep = null, sample = null } = {}) {
  const e = await swmm();
  e.open(inp);
  let t = 0, next = 0;
  while (t < tEnd - 1e-6) {
    beforeStep?.(t, e);
    const target = Math.min(tEnd, t + Math.min(every, 5));
    t = e.stepTo(target);
    if (t >= next - 1e-6) { sample?.(t, e); next += every; }
    if (t < target - 1e-6) break; // SWMM ended
  }
  const rpt = e.finish();
  return { rpt, continuity: SWMM.continuity(rpt), version: e.version };
}
