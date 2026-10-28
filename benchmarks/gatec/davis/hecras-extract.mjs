// Gate C, Davis: pull the comparison quantities out of a HEC-RAS plan result (DavisStormSystem.p02.hdf) into JSON
// (SI units), benchmarks/gatec/results/gatec-davis-hecras-<variant>.json:
//   t (s from plan start); per 10-minute output: area2 cell water surface, downstream-channel water surface, pump flow,
//   pipe-node water surface; area2 surface volume from HEC-RAS's own cell elevation–volume tables; max water surface per
//   cell; cell centres and ids, so the comparison can map HEC-RAS cells onto FloodSim's terrain grid.
// Usage: node benchmarks/gatec/davis/hecras-extract.mjs <variant: dwe|swe>
import h5wasm from 'h5wasm/node';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const here = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const FT = 0.3048006096012192, CFS = FT ** 3;
const variant = process.argv[2] ?? 'dwe', dir = join(here, 'hecras-run', variant), file = join(dir, 'DavisStormSystem.p02.hdf');
if (!existsSync(file)) throw new Error('no results at ' + file);
await h5wasm.ready;
const f = new h5wasm.File(file, 'r');

/** First existing dataset among candidate paths (result layouts differ slightly between versions). */
const pick = (...paths) => { for (const p of paths) { const d = f.get(p); if (d && d.type === 'Dataset') return { path: p, d }; } return null; };
const mat = (d) => { const v = Array.from(d.value), w = d.shape[1] ?? 1; return Array.from({ length: d.shape[0] }, (_, i) => v.slice(i * w, (i + 1) * w)); };
const TS = '/Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series';

const time = pick(`${TS}/Time`); if (!time) throw new Error('no time series in ' + file);
const t = Array.from(time.d.value, d => Math.round(d * 86400)); const t0 = t[0], ts = t.map(x => x - t0);

// 2D areas: water surface (ft) per output time per cell
const ws2 = pick(`${TS}/2D Flow Areas/area2/Water Surface`);
const wsDS = pick(`${TS}/2D Flow Areas/DS Channel/Water Surface`);
if (!ws2) throw new Error('no area2 water surface');
const geom = '/Geometry/2D Flow Areas/area2';
const centres = mat(f.get(`${geom}/Cells Center Coordinate`)).map(([x, y]) => [x, y]);
const nReal = f.get('/Geometry/2D Flow Areas/Attributes').value.find(a => a[0].trim() === 'area2')[16];
const W = mat(ws2.d).map(row => row.slice(0, nReal));
// surface storage from HEC-RAS's own cell elevation–volume tables
const vInfo = pick(`${geom}/Cells Volume Elevation Info`), vVals = pick(`${geom}/Cells Volume Elevation Values`);
let volume = null;
if (vInfo && vVals) {
  const info = mat(vInfo.d), vals = mat(vVals.d);
  const cellVol = (k, z) => { const [s, n] = info[k]; if (!n) return 0; let prev = vals[s]; if (z <= prev[0]) return 0;
    for (let q = s + 1; q < s + n; q++) { const cur = vals[q]; if (z <= cur[0]) return prev[1] + (cur[1] - prev[1]) * (z - prev[0]) / (cur[0] - prev[0]); prev = cur; }
    const a = vals[s + n - 1], b = vals[s + n - 2]; return a[1] + (a[1] - b[1]) / (a[0] - b[0]) * (z - a[0]); };
  volume = W.map(row => row.reduce((acc, z, k) => acc + cellVol(k, z), 0) * FT ** 3);
}
const minElev = pick(`${geom}/Cells Minimum Elevation`);
// pipes and pump
const nodeWS = pick(`${TS}/Pipe Networks/Davis/Nodes/Water Surface`, `${TS}/Pipe Networks/Davis/Node - Water Surface`);
const nodeNames = (pick('/Geometry/Pipe Nodes/Attributes')?.d.value ?? []).map(a => a[0].trim());
// pump record: Flow (cfs), Stage HW (wet well, ft), Stage TW (downstream channel, ft), pump flow (cfs), pumps on
const pumpSV = pick(`${TS}/Pumping Stations/Pump Station #1/Structure Variables`, `${TS}/Pump Stations/Pump Station #1/Structure Variables`);
const pipeQ = pick(`${TS}/Pipe Networks/Davis/Pipes/Pipe Flow DS`);

const res = {
  variant, source: file.replace(/\\/g, '/'), t: ts, units: 'SI (m, m³, m³/s)',
  cells: { centresFt: centres.slice(0, nReal), minElev: minElev ? Array.from(minElev.d.value).slice(0, nReal).map(v => +(v * FT).toFixed(4)) : null },
  area2WSE: W.map(row => row.map(v => +(v * FT).toFixed(4))),
  area2MaxWSE: W[0].map((_, k) => +(Math.max(...W.map(r => r[k])) * FT).toFixed(4)),
  surfaceVolume: volume?.map(v => +v.toFixed(1)) ?? null,
  dsChannelWSE: wsDS ? mat(wsDS.d).map(r => +(Math.max(...r) * FT).toFixed(4)) : null,
  nodes: nodeNames, nodeWSE: nodeWS ? mat(nodeWS.d).map(r => r.map(v => +(v * FT).toFixed(3))) : null,
  pump: pumpSV ? { flow: mat(pumpSV.d).map(r => +(r[0] * CFS).toFixed(4)), wetWell: mat(pumpSV.d).map(r => +(r[1] * FT).toFixed(4)), tailwater: mat(pumpSV.d).map(r => +(r[2] * FT).toFixed(4)), on: mat(pumpSV.d).map(r => r[4]) } : null,
  pipeFlow: pipeQ ? mat(pipeQ.d).map(r => r.map(v => +(v * CFS).toFixed(4))) : null,
  pipes: (pick('/Geometry/Pipe Conduits/Attributes')?.d.value ?? []).map(a => 'C' + a[0].trim()),
  volumeAccounting: Object.fromEntries(['', '/Volume Accounting 2D/area2', '/Volume Accounting Pipe Networks/Davis'].map(p => [p || 'total', Object.fromEntries(Object.entries(f.get('/Results/Unsteady/Summary/Volume Accounting' + p)?.attrs ?? {}).map(([k, a]) => [k, a.value]))])),
  paths: { ws2: ws2.path, wsDS: wsDS?.path, nodeWS: nodeWS?.path, pump: pumpSV?.path, pipeQ: pipeQ?.path, vol: vInfo?.path },
};
mkdirSync(join(here, '..', 'results'), { recursive: true });
writeFileSync(join(here, '..', 'results', `gatec-davis-hecras-${variant}.json`), JSON.stringify(res));
console.log(`HEC-RAS ${variant}: ${ts.length} outputs to ${ts.at(-1) / 3600} h, ${nReal} cells; found ${Object.entries(res.paths).filter(([, v]) => v).map(([k]) => k).join(', ')}; missing ${Object.entries(res.paths).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'none'}`);
if (volume) console.log(`surface volume peak ${Math.max(...volume).toFixed(0)} m³, end ${volume.at(-1).toFixed(0)} m³`);
f.close();
