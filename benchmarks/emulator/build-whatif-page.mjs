// Builds the what-if page: node benchmarks/emulator/build-whatif-page.mjs <template.html> <out.html>
// The page runs FloodSim's own emulator code in the browser: the functions it needs are copied out of src/emulator.js at
// build time (not rewritten), so the page predicts exactly what the trained emulator predicts in Node.
import { readFileSync, writeFileSync } from 'node:fs';
const [tpl, out] = process.argv.slice(2);
const src = readFileSync(new URL('../../src/emulator.js', import.meta.url), 'utf8');
const NEED = ['toUnit', 'cholesky', 'cholSolve', 'matern52', 'corrMatrix', 'S5', 'gpCondition', 'gpPredict', 'gpFromJSON', 'reconstruct', 'predictField', 'predictScalars', 'predict', 'deserialize', 'depthFrom'];
const pieces = [];
for (const name of NEED) {
  const re = new RegExp(`^(?:export )?(?:function ${name}\\b|const ${name}\\b)`, 'm'), m = re.exec(src);
  if (!m) throw new Error('not found in emulator.js: ' + name);
  let i = m.index, depth = 0, started = false, j = i;
  if (src.slice(i).replace(/^export /, '').startsWith('const') && !/=>\s*\{|=\s*\(\s*\w*\s*\)\s*=>\s*\{/.test(src.slice(i, src.indexOf('\n', i)))) { j = src.indexOf('\n', i); }
  else for (j = i; j < src.length; j++) { const c = src[j]; if (c === '{') { depth++; started = true; } else if (c === '}') { depth--; if (started && depth === 0) { j++; break; } } }
  pieces.push(src.slice(i, j).replace(/^export /, ''));
}
const js = `// copied from FloodSim src/emulator.js at build time\n${pieces.join('\n')}\n`;
writeFileSync(out, readFileSync(tpl, 'utf8').replace('/*__EMULATOR__*/', js));
console.log('wrote', out);
