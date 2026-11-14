// PV-X1 deliberately failing cases (spec/PV-X1.json): known-wrong results the scorer must catch. Each injects one fault
// that the reference does not know about, through the same benchmark code as the real case, and records the status the
// scorer gave it against the status expected ('Failed'). These rows are counted apart from the physics: a caught fault
// is a working scorer, not a passing model.
//   X1-a  PV-U1's rectangular case with the SWMM input's Manning n written 25 % high (the reference keeps the true n)
//   X1-b  PV-C1-a with an undeclared constant inflow into one tank (the books do not know it is there)
import { runCase } from '../channels/pv-u1.mjs';
import { swmmCase } from '../conservation/pv-c1.mjs';

export async function run(spec, all) {
  const P = Object.fromEntries(Object.entries(spec.parameters).map(([k, v]) => [k, v.value])), out = { rows: [], cases: {} };
  const u1 = all['PV-U1'], c1 = all['PV-C1'];
  const s = P.u1Case.section, a = await runCase(u1, s, P.u1Case.S, P.u1Case.n, P.u1Case.Q, { nWritten: P.u1Case.n * P.nFactor, expected: 'Failed', label: `X1-a ${s.shape} n written ×${P.nFactor}` });
  out.rows.push(...a.rows.filter(r => /normal depth|velocity/.test(r.quantity)).map(r => ({ ...r, benchmark: 'PV-X1' })));
  const C = c1.parameters, base = { sealCrest: C.sealCrest.value, tanks: C.tanks.value, L: C.pipeLength.value, D: C.pipeDiameter.value, n: C.manningN.value, tankDepth: C.tankDepth.value, durationS: C.durationS.value, step: C.routingStepS.value, sampleS: C.sampleS.value };
  const b = await swmmCase(c1, `X1-b undeclared inflow ${P.leakM3s} m³/s`, base, { leak: P.leakM3s, expected: 'Failed' });
  out.rows.push(...b.rows.filter(r => /^volume closure/.test(r.quantity)).map(r => ({ ...r, benchmark: 'PV-X1' })));
  return out;
}
