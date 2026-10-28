// Gate C, Davis: run the HEC-RAS plan headless (Ras.exe -c) and extract what FloodSim is compared on.
// Each variant runs in its own copy of the project (the extracted example stays untouched):
//   dwe  the plan as shipped: diffusion-wave 2D equations
//   swe  the same plan with the full shallow-water equations (SWE-ELM) in both 2D areas
// Usage: node benchmarks/gatec/davis/hecras-run.mjs [dwe|swe|extract-dwe|extract-swe] [path to Ras.exe]
import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import h5wasm from 'h5wasm/node';

const here = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const FT = 0.3048006096012192, CFS = FT ** 3;
const [what = 'dwe', rasArg] = process.argv.slice(2);
const variant = what.replace('extract-', ''), dir = join(here, 'hecras-run', variant);

function findRas() {
  if (rasArg) return rasArg;
  for (const base of ['C:/Program Files (x86)/HEC/HEC-RAS', 'C:/Program Files/HEC/HEC-RAS']) {
    if (!existsSync(base)) continue;
    const v = readdirSync(base).filter(d => /^7\.0/.test(d)).sort().pop();
    if (v && existsSync(join(base, v, 'Ras.exe'))) return join(base, v, 'Ras.exe');
  }
  throw new Error('Ras.exe not found; pass its path');
}

if (!what.startsWith('extract')) {
  mkdirSync(dir, { recursive: true });
  cpSync(join(here, 'hecras'), dir, { recursive: true });
  if (variant === 'swe') { // UNET D2 Equation: 0 diffusion wave, 1 SWE-ELM
    const p = join(dir, 'DavisStormSystem.p02');
    writeFileSync(p, readFileSync(p, 'latin1').replace(/UNET D2 Equation= 0/g, 'UNET D2 Equation= 1').replace(/^Plan Title=.*$/m, 'Plan Title=Full System ROM with Pump SWE-ELM'), 'latin1');
  }
  const ras = findRas(), t0 = Date.now();
  console.log(`running ${variant} with ${ras}`);
  // Ras.exe only computes when launched the way Explorer launches it (ShellExecute, from the project folder, quoted
  // paths); started as a plain child process it opens an empty project and waits. PowerShell Start-Process does that.
  const q = (p) => p.replace(/'/g, "''");
  const ps = `Start-Process -FilePath '${q(ras)}' -WorkingDirectory '${q(dir)}' -Wait -ArgumentList '-c "${q(join(dir, 'DavisStormSystem.prj'))}" "${q(join(dir, 'DavisStormSystem.p02'))}"'`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit', timeout: 3 * 3600e3 });
  console.log(`HEC-RAS finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// ---- extract: list the result tree the first time so the paths below can be checked against this version
await h5wasm.ready;
const file = join(dir, 'DavisStormSystem.p02.hdf');
if (!existsSync(file)) throw new Error('no results at ' + file);
const f = new h5wasm.File(file, 'r');
const tree = [];
const walk = (p, d) => { const n = f.get(p); if (!n) return; if (n.type === 'Dataset') { tree.push(`${p} ${JSON.stringify(n.shape)}`); return; } if (d > 9) return; for (const k of n.keys()) walk(p === '/' ? '/' + k : `${p}/${k}`, d + 1); };
walk('/Results', 0);
writeFileSync(join(dir, 'results-tree.txt'), tree.join('\n'));
console.log(`${tree.length} result datasets; tree in ${join(dir, 'results-tree.txt')}`);
f.close();
