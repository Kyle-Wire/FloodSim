// Trains the backyard emulator on all solver runs (train + held out + test + pairs) and writes it as one JSON for the
// what-if page: node benchmarks/emulator/export-whatif.mjs <runsDir> <cascade.json> <out.json>
// Everything the page needs: the serialized emulator (src/emulator.js serialize, blobs base64), the mask, the ground for
// raise = 0 and raise = 0.4 (the page interpolates, as the ground is linear in it), houses, lots, the calibration factor.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as E from '../../src/emulator.js';
import { PARAMS, SCENE, geometry, ground } from './backyard.mjs';
const [dir, casc, out] = process.argv.slice(2);
const { nx, ny } = SCENE, G = geometry(), cal = JSON.parse(readFileSync(casc, 'utf8'));
const f32 = (id, k) => new Float32Array(readFileSync(`${dir}/${id}.${k}.f32`).buffer.slice(0));
const plan = JSON.parse(readFileSync(`${dir}/plan.json`, 'utf8')).filter(p => existsSync(`${dir}/${p.id}.json`));
const SC = ['wallPeak', 'yardVolPeak', 'lowWetHours', 'nbrWallPeak'];
const runs = plan.map(p => ({ ...p, ...JSON.parse(readFileSync(`${dir}/${p.id}.json`, 'utf8')), z: f32(p.id, 'z'), maxWse: f32(p.id, 'maxWse'), dur: f32(p.id, 'dur') }));
const mask = E.fieldMask(runs.filter(r => r.role === 'train').map(r => r.maxWse), nx, ny, { walls: G.house });
const em = E.train(runs.map(r => ({ u: r.u, wse: E.fillWse(r.maxWse, r.z, mask, nx, ny), dur: E.maskOf(r.dur, mask), scalars: Object.fromEntries(SC.map(k => [k, r.scalars[k]])) })));
const { json, blobs } = E.serialize(em);
const b64 = Object.fromEntries(Object.entries(blobs).map(([k, v]) => [k, Buffer.from(Float32Array.from(v).buffer).toString('base64')]));
const r0 = Object.fromEntries(PARAMS.map(p => [p.key, p.min])), z0 = ground({ ...r0, raise: 0 }), z1 = ground({ ...r0, raise: 0.4 });
writeFileSync(out, JSON.stringify({ nx, ny, params: PARAMS, mask: Array.from(mask), house: Array.from(G.house), lot: Array.from(G.lot), home: SCENE.home, neighbor: SCENE.neighbor,
  z0: Array.from(z0, v => +v.toFixed(4)), z1: Array.from(z1, v => +v.toFixed(4)), em: json, blobs: b64, k: cal.calibration.k, tol: cal.tol, runs: runs.length,
  validation: { emulatorOnly: cal.emulatorOnly, cascade: cal.cascade, timing: cal.timing } }));
console.log('wrote', out, (JSON.stringify(json).length / 1e6).toFixed(2), 'MB json +', Object.values(b64).reduce((s, v) => s + v.length, 0) / 1e6, 'MB blobs');
