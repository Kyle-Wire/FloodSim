// Runs one point of the backyard study with the CPU solver and saves its fields: node run-one.mjs <outDir> <id> <u1,...,u8>
import { writeFileSync } from 'node:fs';
import { run, values } from './backyard.mjs';
const [out, id, us] = process.argv.slice(2), u = us.split(',').map(Number), v = values(u), r = run(v);
for (const k of ['z', 'maxWse', 'speed', 'dur']) writeFileSync(`${out}/${id}.${k}.f32`, Buffer.from(Float32Array.from(r[k]).buffer));
writeFileSync(`${out}/${id}.json`, JSON.stringify({ id, u, values: v, scalars: r.scalars, seconds: r.seconds, mass: r.mass, rainMm: r.rainMm }));
console.log(id, r.seconds.toFixed(0) + 's', JSON.stringify(r.scalars));
