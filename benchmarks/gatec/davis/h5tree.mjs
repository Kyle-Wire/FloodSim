// Print the group / dataset tree of an HDF5 file (HEC-RAS geometry or plan results): path, shape, dtype, attributes.
// Usage: node benchmarks/gatec/davis/h5tree.mjs <file.hdf> [path prefix] [maxDepth]
import h5wasm from 'h5wasm/node';

const [file, prefix = '/', maxDepth = '6'] = process.argv.slice(2);
await h5wasm.ready;
const f = new h5wasm.File(file, 'r');
const show = (v) => { const s = Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v).slice(0, 6) : v; return JSON.stringify(s)?.slice(0, 90); };
function walk(path, depth) {
  const node = f.get(path);
  const attrs = node?.attrs ? Object.keys(node.attrs).map(k => { try { return `${k}=${show(node.attrs[k].value)}`; } catch { return k; } }).join(' ') : '';
  if (node?.type === 'Dataset') { console.log(`${'  '.repeat(depth)}${path}  ${JSON.stringify(node.shape)} ${node.dtype}${attrs ? '  {' + attrs + '}' : ''}`); return; }
  console.log(`${'  '.repeat(depth)}${path}/${attrs ? '  {' + attrs + '}' : ''}`);
  if (depth >= Number(maxDepth)) return;
  for (const k of node.keys()) walk(path === '/' ? '/' + k : `${path}/${k}`, depth + 1);
}
walk(prefix, 0);
f.close();
