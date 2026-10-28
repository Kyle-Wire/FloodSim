// Print compound dataset fields and the first rows. Usage: node h5peek.mjs <file> <path> [rows]
import h5wasm from 'h5wasm/node';
const [file, path, rows = '3'] = process.argv.slice(2);
await h5wasm.ready;
const f = new h5wasm.File(file, 'r'), d = f.get(path);
if (d.type !== 'Dataset') { console.log('group:', [...d.keys()].join(', ')); for (const k of Object.keys(d.attrs)) console.log('  @', k, JSON.stringify(d.attrs[k].value)?.slice(0, 200)); process.exit(0); }
const names = d.metadata.compound_type?.members?.map(m => m.name);
console.log(path, JSON.stringify(d.shape), names ? 'fields: ' + names.join(' | ') : d.dtype);
const v = d.value;
for (let i = 0; i < Number(rows); i++) console.log('  ', JSON.stringify(names ? v[i] : (d.shape.length > 1 ? Array.from(v).slice(i * d.shape[1], (i + 1) * d.shape[1]) : v[i])));
f.close();
