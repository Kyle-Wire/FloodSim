// Diagnostic (not scored; the registered PV-U1 spec and its results are not changed): the four PV-U1 failures
// (trapezoid b 2 z 1.5, S 0.003, n 0.02, Q 3 and Q 6) with the conduits cut shorter. In the registered run SWMM matches
// the GVF reference to 0.1 mm over the upper reach and departs from it only in the last 250–300 m, growing toward the
// outfall. If the departure is a discretisation effect, it shrinks as the conduits shorten; if it is SWMM's outfall
// treatment, it stays. Reports, per segment length: the depth difference to the GVF profile at fixed distances above
// the outfall, and the distance at which |SWMM − GVF| first exceeds 1 mm. Writes diagnostics/out/u1-refine.json.
// Usage: node diagnostics/u1-refine.mjs [segment lengths, default 100,50,25,12.5]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runCase } from '../channels/pv-u1.mjs';

const spec0 = JSON.parse(readFileSync(new URL('../spec/PV-U1.json', import.meta.url)));
const segs = (process.argv[2] ?? '100,50,25,12.5').split(',').map(Number);
const s = { shape: 'trap', b: 2, z: 1.5 }, S = 0.003, n = 0.02, at = [400, 300, 200, 150, 100, 50];
const out = [];
for (const Q of [3, 6]) for (const segL of segs) {
  const spec = structuredClone(spec0); spec.parameters.segmentM.value = segL;
  const t0 = Date.now(), r = await runCase(spec, s, S, n, Q, { label: `refine seg ${segL} Q ${Q}` });
  const p = r.vsGVF ?? [];
  const near = Object.fromEntries(at.map(x => { const q = p.find(v => Math.abs(v.x - x) < 1e-6); return [x, q ? +(q.diff * 1000).toFixed(2) : null]; }));
  const firstOver = p.find(v => Math.abs(v.diff) > 0.001); // walking down from the top
  const depthRow = r.rows.find(x => /^normal depth/.test(x.quantity));
  out.push({ Q, segL, conduits: r.c.nSeg, seconds: +((Date.now() - t0) / 1000).toFixed(1), diffMmAtXm: near, departsAtXm: firstOver?.x ?? null,
    gvfDrawdownM: +r.c.m2Len.toFixed(0), scoredWorstMm: depthRow ? +(depthRow.abs * 1000).toFixed(2) : null, continuityPct: r.rows.find(x => /continuity/.test(x.quantity))?.sim,
    steadinessM: r.rows.find(x => /steadiness/.test(x.quantity))?.sim });
  console.log(JSON.stringify(out.at(-1)));
}
mkdirSync(new URL('out/', import.meta.url), { recursive: true });
writeFileSync(new URL('out/u1-refine.json', import.meta.url), JSON.stringify({ written: new Date().toISOString(), note: 'diff = SWMM − GVF at x m above the outfall, mm; scoredWorstMm uses the scored junctions of that segment length', runs: out }, null, 1));
