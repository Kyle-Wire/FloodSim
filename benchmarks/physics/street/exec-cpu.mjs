// Street sandbox, node executor: the CPU surface solver (src/solver-cpu.js, the fp64 implementation the GPU kernels
// are verified against) behind GPUSolver's interface, so the production Coupler drives it unchanged.
//   node benchmarks/physics/street/exec-cpu.mjs --cases SS1-a,SS2-b      → street/raw/<stamp>/<case>.cpu.json
//   node benchmarks/physics/street/exec-cpu.mjs --spec PV-SS1            every case of a spec
//   node benchmarks/physics/street/exec-cpu.mjs --list                   the case ids
// A raw file is measurements only; node benchmarks/physics/run.mjs scores the latest raw file of each case.
//
// What this executor is not: the GPU path. The inlet exchange below is this file's copy of the GPU kernel's rule
// (exchangeAt: the held rate over the step, never more water than the cell holds), and the subgrid speed mode has no
// CPU implementation. Rows from it are labelled `cpu`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CPUSolver } from '../../../src/solver-cpu.js';
import { buildCase, caseIds } from './cases.mjs';
import { runCase } from './harness.mjs';

export class CpuSim {
  constructor(o) {
    if (o.subgrid) throw new Error('the subgrid speed mode runs on the GPU only');
    const s = this.s = new CPUSolver({ nx: o.nx, ny: o.ny, dx: o.dx, z: o.z, manning: o.manning, mask: o.mask, bc: o.bc, hdry: o.hdry, hfront: o.hfront, dtDry: o.dtDry, gi: o.gi });
    this.nx = o.nx; this.ny = o.ny; this.dx = o.dx;
    for (let j = 0; j < o.ny; j++) for (let i = 0; i < o.nx; i++) { const k = j * o.nx + i, c = s.idx(i, j); if (o.infil) s.infil[c] = typeof o.infil === 'number' ? o.infil : o.infil[k]; }
    if (o.rainField) { s.rainField = new Float64Array(s.NX * s.NY).fill(1); for (let j = 0; j < o.ny; j++) for (let i = 0; i < o.nx; i++) s.rainField[s.idx(i, j)] = o.rainField[j * o.nx + i]; }
    this.inC = (o.inlets ?? []).map(k => s.idx(k % o.nx, (k / o.nx) | 0));
    this.inQ = new Float64Array(this.inC.length); this.inV = new Float64Array(this.inC.length); this.exchanged = 0;
    this.vol = s.vol;
  }
  get t() { return this.s.t; } get steps() { return this.s.steps; }
  get rainRate() { return this.s.rainRate; } set rainRate(v) { this.s.rainRate = v; }
  setDepth(fn) { this.s.setDepth(fn); }
  setInletRates(q) { for (let m = 0; m < this.inQ.length; m++) this.inQ[m] = q[m]; }
  async readInlets() {
    const vol = Float64Array.from(this.inV), h = Float32Array.from(this.inC, c => this.s.h[c]); this.inV.fill(0);
    // as the GPU's approachAt (F21): each interior neighbour's discharge toward the inlet cell; the largest is frontal
    const s = this.s, NX = s.NX, app = new Float32Array(4 * this.inC.length);
    this.inC.forEach((c, m) => {
      const i = c % NX - (s.NX - this.nx) / 2, j = Math.floor(c / NX) - (s.NY - this.ny) / 2;
      const f = [i > 0 ? Math.max(0, s.hu[c - 1]) : 0, i < this.nx - 1 ? Math.max(0, -s.hu[c + 1]) : 0, j > 0 ? Math.max(0, s.hv[c - NX]) : 0, j < this.ny - 1 ? Math.max(0, -s.hv[c + NX]) : 0];
      let k = 0; for (let q = 1; q < 4; q++) if (f[q] > f[k]) k = q;
      const fm = f[k], nb = [c - 1, c + 1, c - NX, c + NX][k];
      app.set([fm * this.dx, (f[0] + f[1] + f[2] + f[3] - fm) * this.dx, fm > 0 ? s.h[nb] : 0, k >= 2 ? 1 : 0], 4 * m);
    });
    return { vol, h, app };
  }
  async advance(tTarget) {
    const s = this.s, A = s.dx * s.dx;
    while (s.t < tTarget - 1e-12) {
      const dt = s.step(tTarget - s.t);
      for (let m = 0; m < this.inC.length; m++) { // as the GPU's exchangeAt: the held rate over the step, never more than the cell holds
        const c = this.inC[m], dd = Math.min(this.inQ[m] * dt / A, Math.max(s.h[c], 0));
        s.h[c] -= dd; if (s.h[c] <= 0) s.h[c] = 0; if (s.h[c] <= s.hdry) { s.hu[c] = 0; s.hv[c] = 0; }
        this.inV[m] += dd * A; this.exchanged += dd * A;
      }
    }
  }
  async readState() {
    const s = this.s, V = s.vol, volume = s.volume(), expected = V.initial + V.rain - V.infil - V.outflow - this.exchanged;
    const scale = Math.max(1e-30, Math.abs(expected), V.initial + V.rain + Math.max(0, -this.exchanged));
    let giStored = 0; for (let c = 0; c < s.giStore.length; c++) giStored += s.giStore[c]; giStored *= s.dx * s.dx;
    return { h: s.field('h'), hmax: s.field('maxDepth'), mass: { giStored, volume, rain: V.rain, infil: V.infil, outflow: V.outflow, exchanged: this.exchanged, clipped: V.clipped, expected, rel: (volume - expected) / scale } };
  }
  destroy() {}
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadSpecs = () => Object.fromEntries(fs.readdirSync(path.join(here, '../spec')).filter(f => /^PV-SS\d+\.json$/.test(f)).sort().map(f => { const s = JSON.parse(fs.readFileSync(path.join(here, '../spec', f))); return [s.id, s]; }));

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), opt = (n) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : null), specs = loadSpecs();
  const cpuOk = (id) => { const e = Object.values(specs).find(s => s.parameters.cases.value[id]).parameters.cases.value[id]; return !e.grid?.subgrid && !e.gpuOnly; };
  if (args.includes('--list')) { for (const id of caseIds(specs)) console.log(id, cpuOk(id) ? '' : '(GPU only)'); process.exit(0); }
  const ids = opt('cases') ? opt('cases').split(',') : opt('spec') ? Object.keys(specs[opt('spec')].parameters.cases.value) : caseIds(specs);
  const stamp = opt('stamp') ?? new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(here, 'raw', stamp);
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ids) {
    if (!cpuOk(id)) { console.log(`${id}: GPU only, skipped`); continue; }
    const file = path.join(dir, `${id}.cpu.json`); if (fs.existsSync(file)) { console.log(`${id}: ${file} exists, not overwritten`); continue; }
    const def = buildCase(id, specs), r = await runCase(async (o) => new CpuSim(o), def, { log: (m) => console.log(m) });
    r.executor = 'cpu'; r.engine = `CPUSolver fp64 (src/solver-cpu.js), node ${process.version}`; r.written = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(r)); fs.chmodSync(file, 0o444);
    console.log(`${id}: ${r.grid.nx}×${r.grid.ny} @ ${r.grid.dx} m, ${r.steps} steps, ${r.wallSeconds.toFixed(1)} s, surface books ${r.mass.rel.toExponential(1)} → raw/${stamp}/${id}.cpu.json`);
  }
}
