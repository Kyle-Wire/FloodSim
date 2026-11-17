// Fetch the laboratory data the street sandbox uses into lab/data/ (git-ignored) and check each file's MD5 against
// the Zenodo record. Nothing is fetched that is already there with the right checksum.
//   node benchmarks/physics/street/lab/fetch.mjs        then   python -I benchmarks/physics/street/lab/reduce.py benchmarks/physics/street/lab/data
// Sources (both CC BY 4.0):
//   Rubinato et al. (2017) J. Hydrology 552:421–432, doi 10.1016/j.jhydrol.2017.06.024 — Zenodo record 1434156
//   Rubinato et al. (2018) J. Hydroinformatics 20(3):564–576, doi 10.2166/hydro.2018.127 — Zenodo record 1464864 (the paper only)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'), P = 'Experimental calibration and validation of sewer_surface flow exchange equations in steady and unsteady flow conditions';
const FILES = [
  ['rubinato2017-S1-weir.xlsx', 1434156, `${P}_Experimental datasets Weir S1_Paper 2.xlsx`, '4cb2ee35904366cf9e55fa2a5da7a53b'],
  ['rubinato2017-S2-submerged.xlsx', 1434156, `${P}_Experimental datasets Sub S2_Paper 2.xlsx`, '989d46ffedbc68aa226e659da3c6b2df'],
  ['rubinato2017-S3-orifice.xlsx', 1434156, `${P}_Experimental datasets Orifice S3_Paper 2.xlsx`, '602c99ca1519c3eccf074373a13f36b2'],
  ['rubinato2017-S4-orifice.xlsx', 1434156, `${P}_Experimental datasets Orifice S4_Paper 2.xlsx`, 'a3d8c397709ba5158418dadfb5f1cda3'],
  ['rubinato2017-paper.pdf', 1434156, `${P} [2].pdf`, '7daa2a4072b30d4e0854385cc9f12530'],
  ['rubinato2018-grates-paper.pdf', 1464864, 'Surface to sewer flow exchange through circular inlets during urban flood conditions.pdf', '7857bfc5c12e83b45fc270314af4af6e'],
];
fs.mkdirSync(dir, { recursive: true });
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
for (const [name, rec, key, sum] of FILES) {
  const f = path.join(dir, name);
  if (fs.existsSync(f) && md5(fs.readFileSync(f)) === sum) { console.log(`${name}: present, checksum ok`); continue; }
  const r = await fetch(`https://zenodo.org/api/records/${rec}/files/${encodeURIComponent(key)}/content`); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer()); if (md5(b) !== sum) throw new Error(`${name}: checksum ${md5(b)} is not the record's ${sum}`);
  fs.writeFileSync(f, b); console.log(`${name}: ${b.length} bytes, checksum ok`);
}
