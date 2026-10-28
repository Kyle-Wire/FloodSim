// Extract the entries under one folder of a large remote zip with HTTP range requests, without downloading the rest.
// Each entry's CRC-32 is checked against the central directory. Supports zip64 offsets; stored and deflated entries.
// Usage: node tools/zip-range.mjs <url> "<folder prefix inside the zip>" <output dir>
import { inflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32 } from '../src/export.js';

const [url, prefix, out] = process.argv.slice(2);
if (!url || !prefix || !out) { console.error('usage: node tools/zip-range.mjs <url> <prefix> <outdir>'); process.exit(1); }

async function range(a, b) {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, redirect: 'follow' });
  if (r.status !== 206) throw new Error(`range ${a}-${b}: HTTP ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), total: Number(r.headers.get('content-range')?.split('/')[1]) };
}

const { total } = await range(0, 0);
const { buf: tail } = await range(total - 70000, total - 1);
let e = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
let cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
if (cdOff === 0xffffffff) { const z = tail.lastIndexOf(Buffer.from('PK\x06\x06', 'latin1')); cdSize = Number(tail.readBigUInt64LE(z + 40)); cdOff = Number(tail.readBigUInt64LE(z + 48)); }
const { buf: cd } = await range(cdOff, cdOff + cdSize - 1);

let p = 0, n = 0, bytes = 0;
while (p < cd.length && cd.readUInt32LE(p) === 0x02014b50) {
  const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
  let csz = cd.readUInt32LE(p + 20), usz = cd.readUInt32LE(p + 24);
  const fl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
  let off = cd.readUInt32LE(p + 42);
  const name = cd.subarray(p + 46, p + 46 + fl).toString('latin1'), extra = cd.subarray(p + 46 + fl, p + 46 + fl + el);
  // zip64 extra field: the 0xffffffff fields, in order usz, csz, offset
  for (let q = 0; q + 4 <= extra.length;) {
    const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2);
    if (id === 1) { let r = q + 4; if (usz === 0xffffffff) { usz = Number(extra.readBigUInt64LE(r)); r += 8; } if (csz === 0xffffffff) { csz = Number(extra.readBigUInt64LE(r)); r += 8; } if (off === 0xffffffff) off = Number(extra.readBigUInt64LE(r)); }
    q += 4 + len;
  }
  p += 46 + fl + el + cl;
  if (!name.startsWith(prefix) || name.endsWith('/')) continue;
  const { buf: h } = await range(off, off + 29), start = off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  const { buf: raw } = csz ? await range(start, start + csz - 1) : { buf: Buffer.alloc(0) };
  const data = method === 8 ? inflateRawSync(raw) : raw;
  if (data.length !== usz || (crc32(data) >>> 0) !== crc) throw new Error(`${name}: size or CRC mismatch`);
  const dst = join(out, name.slice(prefix.length));
  mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, data);
  n++; bytes += data.length;
}
console.log(`${n} files, ${(bytes / 1e6).toFixed(1)} MB, CRC-32 verified → ${out}`);
