// UNSCORED: share of end- and mid-segment flow variance at periods below ~120 s in the rest window (11-12 h),
// for the registered cases and the 0.5 s and NONE diagnostics. High-pass = series minus its centred 120 s mean.
import { load } from './analyse.mjs';
import fs from 'node:fs';
const res = {};
for (const N of [4, 16, 32]) for (const v of ['', '-dt0.5', '-inertialNONE']) {
  const r = load(`N${N}${v}`), t = r.series('t'), ids = r.hdr.network.conduits.map(c => c.id);
  for (const id of [ids[0], ids[Math.floor(N / 2)], ids.at(-1)]) {
    const q = r.series(`${id}.flow`), idx = []; for (let s = 0; s < q.length; s++) if (t[s] > 39600) idx.push(s);
    const dt = t[idx[1]] - t[idx[0]], w = Math.round(60 / dt); let tot = 0, hf = 0, maxHf = 0; const m0 = idx.reduce((a, s) => a + q[s], 0) / idx.length;
    for (const s of idx) { let a = 0, k = 0; for (let j = s - w; j <= s + w; j++) if (j >= 0 && j < q.length) { a += q[j]; k++; } const lo = a / k, h = q[s] - lo; hf += h * h; tot += (q[s] - m0) ** 2; maxHf = Math.max(maxHf, Math.abs(h)); }
    (res[`N${N}${v}`] ??= {})[id] = { hfVarianceShare: +(hf / tot).toPrecision(3), maxAbsHighPassM3s: +maxHf.toPrecision(3) };
  }
}
console.log(JSON.stringify(res, null, 0).replace(/\},"N/g, '},\n"N'));
fs.writeFileSync(new URL('./hf.json', import.meta.url), JSON.stringify(res, null, 1));
