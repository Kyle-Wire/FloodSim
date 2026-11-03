// Run checkpoints: everything a run holds at one moment, so a run that stops (a reload, a crash, a closed laptop)
// resumes where it was instead of starting again. Three parts:
//   GPU      every storage buffer of the solver, byte for byte (the state, the books, the per-cell maxima)
//   SWMM     the engine's WebAssembly memory and its in-memory files (/m.rpt, /m.out) with their stream positions: SWMM
//            has no hotstart for a run under way, so its whole state is copied, as a debugger would
//   JS       the run's own objects (the links' totals, the gauge and line series, the clock), walked by path: a resumed
//            run is rebuilt from the same settings first, so the same paths exist, and each value is put back in place
// A checkpoint is valid only for a run with the same forcing fingerprint (src/compare.js), which the caller checks.

// ------------------------------------------------------------------ JS object state

const SKIP_CTOR = /^(GPU|HTML|SVG|Promise|WeakMap|WeakSet|SWMM|GPUSolver|CPUSolver|Worker|MessagePort|Response|Request|Blob|ImageData|CanvasRenderingContext2D|OffscreenCanvas)/;
const isTA = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);
const skippable = (v) => typeof v === 'function' || (v && typeof v === 'object' && SKIP_CTOR.test(v.constructor?.name ?? ''));

/**
 * The state under `root` as { tree (JSON-able), blobs: [typed array] }. Typed arrays go to blobs; functions, GPU and
 * DOM objects, and keys in `skip` (a Set of key names, or paths 'a.b') are left out; an object reached twice is kept
 * once (later visits are references, not restored).
 */
export function captureState(root, { skip = new Set() } = {}) {
  const blobs = [], seen = new WeakSet();
  const walk = (v, path) => {
    if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return typeof v === 'number' && !Number.isFinite(v) ? { $n: String(v) } : v;
    if (typeof v === 'bigint') return { $big: String(v) };
    if (v !== root && skippable(v)) return undefined; // the root itself may be a solver: its own fields are what is wanted
    if (isTA(v)) { blobs.push(v); return { $ta: blobs.length - 1, type: v.constructor.name, n: v.length }; }
    if (v instanceof ArrayBuffer) { blobs.push(new Uint8Array(v)); return { $ab: blobs.length - 1 }; }
    if (seen.has(v)) return { $seen: 1 };
    seen.add(v);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}.${i}`) ?? null);
    if (v instanceof Map) return { $map: [...v].filter(([k]) => typeof k !== 'object').map(([k, x]) => [k, walk(x, `${path}.${String(k)}`) ?? null]) };
    if (v instanceof Set) return { $set: [...v].filter(x => typeof x !== 'object') };
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (skip.has(k) || skip.has(`${path}.${k}`.slice(1))) continue;
      const w = walk(x, `${path}.${k}`); if (w !== undefined) o[k] = w;
    }
    return o;
  };
  return { tree: walk(root, ''), blobs };
}

const CTORS = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray, BigInt64Array, BigUint64Array };
const restoreTA = (s, blobs) => { const b = blobs[s.$ta], C = CTORS[s.type] ?? Float64Array; return b instanceof C ? b : new C(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

/**
 * Put a captured state back into `root`, by path. Typed arrays are filled in place where the same length is there
 * (so arrays shared between objects stay shared), else replaced; objects are walked into; plain values assigned.
 * Paths missing in `root` get the saved value only when it is plain data. → number of values put back
 */
export function applyState(root, tree, blobs) {
  let n = 0;
  const val = (s) => { // a saved value as a fresh JS value (where there is nothing to fill in place)
    if (s == null || typeof s !== 'object') return s;
    if ('$n' in s) return Number(s.$n);
    if ('$big' in s) return BigInt(s.$big);
    if ('$ta' in s) return restoreTA(s, blobs);
    if ('$ab' in s) { const b = blobs[s.$ab]; return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
    if ('$map' in s) return new Map(s.$map.map(([k, x]) => [k, val(x)]));
    if ('$set' in s) return new Set(s.$set);
    if (Array.isArray(s)) return s.map(val);
    return Object.fromEntries(Object.entries(s).filter(([, x]) => !(x && x.$seen)).map(([k, x]) => [k, val(x)]));
  };
  const put = (obj, key, s) => { // obj[key] ← s
    if (s && s.$seen) return;
    const cur = obj[key];
    if (s && typeof s === 'object' && '$ta' in s) {
      const b = restoreTA(s, blobs);
      if (isTA(cur) && cur.length === b.length && cur.constructor === b.constructor) cur.set(b); else obj[key] = b;
      n++; return;
    }
    if (s && typeof s === 'object' && '$map' in s && cur instanceof Map) {
      for (const [k, x] of s.$map) { const c = cur.get(k); if (c && typeof c === 'object' && x && typeof x === 'object' && !('$ta' in x)) into(c, x); else { cur.set(k, val(x)); n++; } }
      return;
    }
    if (s && typeof s === 'object' && !('$n' in s) && !('$big' in s) && !('$ab' in s) && !('$set' in s) && !('$map' in s) && cur && typeof cur === 'object' && !skippable(cur)) {
      if (Array.isArray(s) && Array.isArray(cur) && cur.length !== s.length) { obj[key] = val(s); n++; return; } // a series that grew
      into(cur, s); return;
    }
    if (skippable(cur)) return;
    obj[key] = val(s); n++;
  };
  const into = (obj, s) => {
    if (Array.isArray(s)) { for (let i = 0; i < s.length; i++) put(obj, i, s[i]); if (Array.isArray(obj)) obj.length = s.length; return; }
    for (const [k, x] of Object.entries(s)) put(obj, k, x);
  };
  into(root, tree);
  return n;
}

// ------------------------------------------------------------------ GPU solver

const NO_COPY = new Set(['params', 'TA']); // the uniforms (rewritten every frame) and the indirect dispatch args (every step)
/** Every storage buffer of a GPUSolver, read back after the queue drains. → { [name]: Uint8Array } */
export async function gpuSnapshot(s) {
  const d = s.device, names = Object.keys(s.buf).filter(k => !NO_COPY.has(k)), enc = d.createCommandEncoder();
  const st = names.map(k => { const b = d.createBuffer({ size: s.buf[k].size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); enc.copyBufferToBuffer(s.buf[k], 0, b, 0, s.buf[k].size); return b; });
  d.queue.submit([enc.finish()]);
  const out = {};
  await Promise.all(st.map(async (b, m) => { await b.mapAsync(GPUMapMode.READ); out[names[m]] = new Uint8Array(b.getMappedRange().slice(0)); b.unmap(); b.destroy(); }));
  return out;
}
/** Write a snapshot back into a GPUSolver built with the same grid and options (buffer sizes must match). */
export function gpuRestore(s, snap) {
  for (const [k, bytes] of Object.entries(snap)) {
    const b = s.buf[k]; if (!b) continue;
    if (b.size !== bytes.byteLength) throw new Error(`checkpoint: solver buffer ${k} is ${b.size} bytes here, ${bytes.byteLength} in the checkpoint (a different grid or options)`);
    s.device.queue.writeBuffer(b, 0, bytes);
  }
}
/** The solver's own JS state (clock, books, stage, rain rate, host mirrors), without its GPU objects. */
export const solverState = (s) => captureState(s, { skip: new Set(['device', 'buf', 'read', 'k', 'pipelines', 'layouts', 'bg', 'module']) });

// ------------------------------------------------------------------ SWMM

const SWMM_FILES = ['/m.inp', '/m.rpt', '/m.out'];
/** A running SWMM engine's state: its linear memory and its files with their open streams' positions. */
export function swmmSnapshot(e) {
  if (!e.memory) throw new Error('checkpoint: this SWMM engine was loaded without its memory');
  const FS = e.M.FS, files = {}, streams = [];
  for (const f of SWMM_FILES) { try { files[f] = FS.readFile(f); } catch { /* not there */ } }
  FS.streams.forEach((st, fd) => { if (st?.path) streams.push({ fd, path: st.path, position: st.position }); });
  return { memory: new Uint8Array(e.memory.buffer.slice(0)), files, streams, t: e.t };
}
/**
 * Put a SWMM state back into an engine that has opened the same .inp (so the same files are open on the same
 * descriptors). Memory grows to the snapshot's size first.
 */
export function swmmRestore(e, snap) {
  const mem = e.memory; if (!mem) throw new Error('checkpoint: this SWMM engine was loaded without its memory');
  const need = snap.memory.byteLength - mem.buffer.byteLength; if (need > 0) mem.grow(Math.ceil(need / 65536));
  if (mem.buffer.byteLength !== snap.memory.byteLength) throw new Error('checkpoint: SWMM memory is larger here than in the checkpoint');
  const FS = e.M.FS;
  for (const [f, bytes] of Object.entries(snap.files)) {
    const node = FS.lookupPath(f).node; node.contents = Uint8Array.from(bytes); node.usedBytes = bytes.length; // MEMFS file in place: the open streams keep pointing at it
  }
  for (const { fd, path, position } of snap.streams) { const st = FS.streams[fd]; if (!st || st.path !== path) throw new Error(`checkpoint: SWMM file ${path} is not open on descriptor ${fd}`); st.position = position; }
  new Uint8Array(mem.buffer).set(snap.memory);
  e.t = snap.t;
}

// ------------------------------------------------------------------ packing

/**
 * One file from parts { name: JSON-able | Uint8Array | typed array }: a JSON header naming each binary part's type,
 * offset and length, then the parts, gzip-compressed (dry cells and empty books compress well). → Uint8Array
 */
export async function pack(parts) {
  const head = { v: 1, parts: {} }, bins = []; let off = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (isTA(v)) { const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); head.parts[k] = { type: v.constructor.name, off, len: u.byteLength }; bins.push(u); off += u.byteLength; off += (8 - off % 8) % 8; bins.push(new Uint8Array((8 - u.byteLength % 8) % 8)); }
    else head.parts[k] = { json: v ?? null }; // (undefined would drop the key, and the part would read back as binary)
  }
  const hj = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(new Uint32Array([hj.length]).buffer);
  const raw = new Blob([len, hj, ...bins]);
  return new Uint8Array(await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
/** The parts of a packed file. */
export async function unpack(bytes) {
  const raw = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const hl = new DataView(raw.buffer).getUint32(0, true), head = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl))), base = 4 + hl, out = {};
  for (const [k, p] of Object.entries(head.parts)) {
    if ('json' in p) { out[k] = p.json; continue; }
    const C = CTORS[p.type] ?? Uint8Array, b = raw.slice(base + p.off, base + p.off + p.len);
    out[k] = new C(b.buffer, 0, p.len / C.BYTES_PER_ELEMENT);
  }
  return out;
}
/** A JS state (captureState) as pack parts and back: the tree as JSON, each blob as its own part. */
export const stateParts = (prefix, st) => ({ [prefix]: st.tree, ...Object.fromEntries(st.blobs.map((b, i) => [`${prefix}#${i}`, b])) });
export function partsState(prefix, parts) {
  const blobs = []; for (let i = 0; `${prefix}#${i}` in parts; i++) blobs.push(parts[`${prefix}#${i}`]);
  return { tree: parts[prefix], blobs };
}
