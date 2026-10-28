// Export package for Unreal Engine (and any DCC tool): heightmap + EXR rasters + buildings GLB + georeference JSON,
// bundled as an uncompressed .zip. Depth values are solver output, unmodified (integrity rule in the build plan).

// ------------------------------------------------------------------ zip (store only)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8, crc = 0) { crc = ~crc >>> 0; for (let i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8); return ~crc >>> 0; }

/** files: [{name, data: Uint8Array}] → Blob (zip, stored, zip64 not supported: keep each file < 4 GB) */
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

// ------------------------------------------------------------------ 16-bit greyscale PNG (Unreal Landscape heightmap)
async function deflate(u8) { // zlib stream, as PNG IDAT requires
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function png16(values, w, h) {
  const raw = new Uint8Array(h * (1 + 2 * w));
  for (let j = 0; j < h; j++) { const o = j * (1 + 2 * w); for (let i = 0; i < w; i++) { const v = values[j * w + i]; raw[o + 1 + 2 * i] = v >> 8; raw[o + 2 + 2 * i] = v & 255; } }
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8); dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length))); return b;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ OpenEXR, uncompressed scanline, 32-bit float channels
/** channels: {R: Float32Array, G?: ...} (w·h each, row 0 = top/north) */
export function exr(channels, w, h) {
  const names = Object.keys(channels).sort(), enc = new TextEncoder(), hdr = [];
  const attr = (name, type, bytes) => { const n = enc.encode(name + '\0' + type + '\0'), s = new Uint8Array(4); new DataView(s.buffer).setInt32(0, bytes.length, true); hdr.push(n, s, bytes); };
  const ints = (...v) => { const b = new Uint8Array(4 * v.length), d = new DataView(b.buffer); v.forEach((x, i) => d.setInt32(4 * i, x, true)); return b; };
  const flts = (...v) => { const b = new Uint8Array(4 * v.length), d = new DataView(b.buffer); v.forEach((x, i) => d.setFloat32(4 * i, x, true)); return b; };
  const ch = []; for (const n of names) { ch.push(enc.encode(n + '\0'), ints(2), new Uint8Array(4), ints(1, 1)); } ch.push(new Uint8Array(1));
  attr('channels', 'chlist', cat(ch)); attr('compression', 'compression', new Uint8Array([0]));
  attr('dataWindow', 'box2i', ints(0, 0, w - 1, h - 1)); attr('displayWindow', 'box2i', ints(0, 0, w - 1, h - 1));
  attr('lineOrder', 'lineOrder', new Uint8Array([0])); attr('pixelAspectRatio', 'float', flts(1));
  attr('screenWindowCenter', 'v2f', flts(0, 0)); attr('screenWindowWidth', 'float', flts(1));
  const head = cat([new Uint8Array([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]), ...hdr, new Uint8Array(1)]);
  const lineBytes = 8 + 4 * w * names.length, tableOff = head.length, dataOff = tableOff + 8 * h;
  const out = new Uint8Array(dataOff + h * lineBytes); out.set(head);
  const dv = new DataView(out.buffer);
  for (let y = 0; y < h; y++) {
    const o = dataOff + y * lineBytes; dv.setBigUint64(tableOff + 8 * y, BigInt(o), true);
    dv.setInt32(o, y, true); dv.setInt32(o + 4, 4 * w * names.length, true);
    names.forEach((n, c) => { const src = channels[n], base = o + 8 + 4 * w * c; for (let x = 0; x < w; x++) dv.setFloat32(base + 4 * x, src[y * w + x], true); });
  }
  return out;
}
function cat(parts) { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }

// ------------------------------------------------------------------ buildings as binary glTF (extruded footprints)
/**
 * rings in local metres (x east, y north, origin at the grid's SW corner), glTF is Y-up: (x, height, −y).
 * `earcut(flatCoords, holeIndices)` triangulates each footprint. Base at local ground (`groundAt(x,y)`).
 */
export function buildingsGLB(buildings, earcut, groundAt, defaultHeight = 9) {
  const pos = [], nor = [], idx = [];
  const push = (x, y, z, nx, ny, nz) => { pos.push(x, z, -y); nor.push(nx, nz, -ny); return pos.length / 3 - 1; };
  for (const b of buildings) {
    const rings = b.rings.filter(r => r.length > 3).map(r => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r);
    if (!rings.length) continue;
    const H = b.height ?? defaultHeight;
    let gmin = Infinity; for (const r of rings) for (const p of r) gmin = Math.min(gmin, groundAt(p[0], p[1]));
    if (!Number.isFinite(gmin)) continue;
    const top = gmin + H, flat = [], holes = [];
    rings.forEach((r, ri) => { if (ri) holes.push(flat.length / 2); for (const p of r) flat.push(p[0], p[1]); });
    const base = pos.length / 3;
    for (let i = 0; i < flat.length; i += 2) push(flat[i], flat[i + 1], top, 0, 0, 1);
    const tri = earcut(flat, holes.length ? holes : null);
    for (let t = 0; t < tri.length; t += 3) { // roof faces up: counter-clockwise seen from above
      const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
      const s = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * c] - flat[2 * a]) * (flat[2 * b + 1] - flat[2 * a + 1]);
      if (s >= 0) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
    for (const r of rings) {
      let area = 0; for (let a = 0, p = r.length - 1; a < r.length; p = a++) area += (r[p][0] * r[a][1] - r[a][0] * r[p][1]);
      const ccw = area > 0;
      for (let a = 0; a < r.length; a++) {
        const p = r[a], q = r[(a + 1) % r.length], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey) || 1;
        const nx = (ccw ? ey : -ey) / L, ny = (ccw ? -ex : ex) / L;
        const v0 = push(p[0], p[1], gmin, nx, ny, 0), v1 = push(q[0], q[1], gmin, nx, ny, 0), v2 = push(q[0], q[1], top, nx, ny, 0), v3 = push(p[0], p[1], top, nx, ny, 0);
        if (ccw) idx.push(v0, v1, v2, v0, v2, v3); else idx.push(v0, v2, v1, v0, v3, v2); // outward-facing (tested)
      }
    }
  }
  const P = new Float32Array(pos), Nn = new Float32Array(nor), I = new Uint32Array(idx);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
  const bin = cat([new Uint8Array(P.buffer), new Uint8Array(Nn.buffer), new Uint8Array(I.buffer)]);
  const json = {
    asset: { version: '2.0', generator: 'FloodSim' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'buildings' }],
    meshes: [{ name: 'buildings', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'building', pbrMetallicRoughness: { baseColorFactor: [0.82, 0.8, 0.76, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: Nn.byteLength, target: 34962 },
      { buffer: 0, byteOffset: P.byteLength + Nn.byteLength, byteLength: I.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: Nn.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: I.length, type: 'SCALAR' }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json)); const jpad = (4 - js.length % 4) % 4; js = cat([js, new TextEncoder().encode(' '.repeat(jpad))]);
  const bpad = (4 - bin.length % 4) % 4, binP = cat([bin, new Uint8Array(bpad)]);
  const total = 12 + 8 + js.length + 8 + binP.length, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  dv.setUint32(20 + js.length, binP.length, true); dv.setUint32(24 + js.length, 0x004e4942, true); out.set(binP, 28 + js.length);
  return out;
}
