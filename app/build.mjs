// Inlines solver modules, app shell and verification results into one self-contained page: dist/floodsim.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const mod = (path, exports) => {
  const body = read(path).replace(/^import .*$/mg, '').replace(/^export (const|function|class|async function) /mg, '$1 ');
  return `const { ${exports.join(', ')} } = (() => {\n${body}\nreturn { ${exports.join(', ')} };\n})();\n`;
};
const cpu = JSON.parse(read('tests/results-cpu.json')), gpu = JSON.parse(read('tests/results-gpu.json'));
const js = [
  mod('src/kernels.wgsl.js', ['KERNELS_WGSL']),
  mod('src/solver-cpu.js', ['CPUSolver']),
  mod('src/analytic.js', ['damBreak', 'thackerPlanar']),
  mod('src/solver-gpu.js', ['GPUSolver']),
  mod('src/scenarios.js', ['rng', 'MMHR', 'cloudburst', 'dambreak', 'thacker', 'SCENARIOS']),
  `const RESULTS = ${JSON.stringify({ cpu, gpu })};\n`,
  read('app/app.js'),
].join('\n');
const html = read('app/template.html').replace('<!--APP-->', `<script type="module">\n${js}\n</script>`);
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/floodsim.html', html);
console.log('dist/floodsim.html', (html.length / 1024).toFixed(0), 'KB');
