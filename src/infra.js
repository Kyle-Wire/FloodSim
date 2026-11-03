// Infrastructure layer: drainage features the user draws, imports, or starts from the street-following estimate, kept
// as a lon/lat GeoJSON FeatureCollection in SI units. Build turns it into model inputs:
//
//   pipe     (line)    → a linked-pipe record for realNetwork (tier 1): D, W, shape, inverts (m NAVD88), Manning n
//   culvert  (line)    → a surface-to-surface culvert link (inlet/barrel control), like a mapped OSM culvert
//   manhole  (point)   → structure: its invert fills in missing pipe inverts at that end
//   inlet    (point)   → catch basin: joins the nearest pipe within 30 m (or a synthetic manhole when no pipes are drawn);
//                        `blocked` (0–1) is the share of its grates covered by debris (1 = sealed: no inflow)
//   outfall  (point)   → where the network discharges; `boundary` = the pipe carries on off-site (normal-depth outlet)
//   storage  (polygon) → underground storage: plan area × depth × void ratio = capacity; a SWMM storage unit joined
//                         to the nearest manhole by a connection pipe, so it fills and drains with the network
//   wall     (line)    → flood wall: a crest on the solver faces it crosses (height above ground or fixed elevation)
//   berm     (line)    → levee / berm: the same crest, plus its trapezoid (top width, side slopes) filled into the bed
//   barrier  (line)    → deployable barrier: a wall that goes up at the start, at a set time, or not at all
// (barriers.js turns the three barrier types into solver faces and watches them during a run)
import { toCells } from './ingest.js';
import { WEIR_C } from './barriers.js';

export const TYPES = ['pipe', 'culvert', 'manhole', 'inlet', 'outfall', 'storage', 'wall', 'berm', 'barrier'];
export const BARRIERS = new Set(['wall', 'berm', 'barrier']);

/** Underground storage systems: share of the excavated volume that holds water (stone porosity, chamber geometry). */
export const STORAGE_SYSTEMS = {
  vault: { name: 'Concrete vault / tank', voids: 1.0 },
  chambers: { name: 'Arch chambers in stone', voids: 0.55 },
  pipes: { name: 'Perforated pipe gallery in stone', voids: 0.5 },
  modules: { name: 'Plastic crate modules', voids: 0.95 },
  stone: { name: 'Stone bed / trench', voids: 0.4 },
};

// standard US sizes (18 in pipe, 36 in culvert, 5 ft deep storage, 12 in connection), stored in metres
export const DEFAULTS = {
  pipe: { D: 0.4572, shape: 'CIRCULAR', n: 0.013 },
  culvert: { D: 0.9144, n: 0.015, blocked: 0 },
  manhole: {},
  inlet: { grates: 1, blocked: 0 },
  outfall: { boundary: false },
  storage: { system: 'chambers', voids: 0.55, depth: 1.524, connD: 0.3048 },
  // 3 ft wall, 4 ft berm with a 10 ft top and 3:1 sides, 2 ft deployable barrier up from the start
  wall: { mode: 'height', height: 0.9144, crest: null, C: WEIR_C.wall },
  berm: { mode: 'height', height: 1.2192, crest: null, topW: 3.048, slope: 3, C: WEIR_C.berm },
  barrier: { mode: 'height', height: 0.6096, crest: null, deploy: 'start', deployAt: 30, C: WEIR_C.barrier },
};

const R = 6371008.8;
const rad = Math.PI / 180;
/** Local metres around a reference latitude (accurate to well under 0.1 % over a few km). */
const local = (lat0) => ([lon, lat]) => [lon * rad * R * Math.cos(lat0 * rad), lat * rad * R];

export function lineLength(line) {
  if (!line?.length) return 0;
  const P = local(line[0][1]); let L = 0;
  for (let k = 1; k < line.length; k++) { const a = P(line[k - 1]), b = P(line[k]); L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return L;
}
export function ringArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const P = local(ring[0][1]), q = ring.map(P); let a = 0;
  for (let k = 0, j = q.length - 1; k < q.length; j = k++) a += (q[j][0] + q[k][0]) * (q[j][1] - q[k][1]);
  return Math.abs(a) / 2;
}
export function ringCentroid(ring) {
  let x = 0, y = 0; const pts = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** Capacity of one storage feature (m³) and the numbers behind it. */
export function storageCapacity(props, ring) {
  const area = ringArea(ring), depth = Math.max(0, Number(props.depth) || 0), voids = Math.min(1, Math.max(0.05, Number(props.voids) || 1));
  return { area, depth, voids, volume: area * depth * voids };
}

/** One summary line per type, plus totals. */
export function summarize(fc) {
  const c = Object.fromEntries(TYPES.map(t => [t, 0])); let pipeLen = 0, culvLen = 0, storage = 0, barrierLen = 0;
  for (const f of fc.features) {
    const t = f.properties.type; c[t]++;
    if (t === 'pipe') pipeLen += lineLength(f.geometry.coordinates);
    if (t === 'culvert') culvLen += lineLength(f.geometry.coordinates);
    if (t === 'storage') storage += storageCapacity(f.properties, f.geometry.coordinates[0]).volume;
    if (BARRIERS.has(t)) barrierLen += lineLength(f.geometry.coordinates);
  }
  return { count: c, pipeLen, culvLen, storage, barrierLen, total: fc.features.length };
}

// ------------------------------------------------------------------ layer → model inputs

/**
 * Model inputs from the layer. Pipe inverts missing at an end are taken from a manhole within 2 m that has one;
 * a pipe keeps inverts only when both ends have one (realNetwork derives the rest from the lidar).
 */
export function layerInputs(fc) {
  const F = fc.features, byType = (t) => F.filter(f => f.properties.type === t);
  const P = local(F[0]?.geometry ? firstCoord(F[0].geometry)[1] : 40);
  const holes = byType('manhole').filter(f => Number.isFinite(f.properties.invert)).map(f => ({ xy: P(f.geometry.coordinates), inv: f.properties.invert }));
  const invNear = (ll) => { const q = P(ll); let best = null; for (const m of holes) { const d = Math.hypot(m.xy[0] - q[0], m.xy[1] - q[1]); if (d <= 2 && (!best || d < best.d)) best = { d, inv: m.inv }; } return best?.inv ?? null; };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const pipes = byType('pipe').map(f => {
    const p = f.properties, line = f.geometry.coordinates;
    let up = num(p.upInv) ?? invNear(line[0]), dn = num(p.dnInv) ?? invNear(line.at(-1));
    if (up == null || dn == null) up = dn = null;
    const box = p.shape === 'RECT_CLOSED';
    return { line, h: p.D > 0 ? p.D : null, w: box ? (p.W > 0 ? p.W : p.D) : null, shape: box ? 'RECT_CLOSED' : 'CIRCULAR', barrels: p.barrels || 1, upInv: up, dnInv: dn, n: p.n };
  });
  const pt = (f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
  return {
    pipes,
    // one point per grate; `open` is the share of the grate not blocked by debris (it scales the inlet's opening)
    inlets: byType('inlet').flatMap(f => Array.from({ length: Math.max(1, f.properties.grates | 0) }, () => ({ ...pt(f), open: 1 - Math.min(1, Math.max(0, Number(f.properties.blocked) || 0)) }))),
    outfalls: byType('outfall').map(f => ({ ...pt(f), boundary: !!f.properties.boundary, invert: num(f.properties.invert) })),
    culverts: byType('culvert').map(f => {
      const p = f.properties, inv = [num(p.upInv), num(p.dnInv)].filter(v => v != null);
      // debris in the barrel: the same flow area as a smaller clear pipe (fully blocked passes nothing)
      const open = 1 - Math.min(1, Math.max(0, Number(p.blocked) || 0)), D = (p.D > 0 ? p.D : DEFAULTS.culvert.D) * Math.sqrt(open);
      return { line: f.geometry.coordinates, kind: 'drawn', D, n: p.n ?? DEFAULTS.culvert.n, inv: inv.length ? Math.max(...inv) : null, drawn: true, blocked: 1 - open };
    }).filter(c => c.D > 0), // a fully blocked culvert passes nothing
    storage: byType('storage').map(f => ({ id: f.id, ring: f.geometry.coordinates[0], ...f.properties, ...storageCapacity(f.properties, f.geometry.coordinates[0]) })),
    barriers: F.filter(f => BARRIERS.has(f.properties.type)).map(f => ({ id: f.id, line: f.geometry.coordinates, ...f.properties })),
  };
}
const firstCoord = (g) => (g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]);

/**
 * Storage units into a built network (after addTanks, which clears storage flags). Each joins the nearest manhole
 * within 150 m by a connection pipe; its floor is the given bottom elevation, else that manhole's invert. The pipe runs
 * level from the manhole invert (offset up to the floor when the floor is higher), so water flows in when the network
 * fills and back out as it drains. Returns [{ id, node, to, volume, area, depth, dist }] and skipped ids.
 */
export function attachStorage(net, storage, fine, f) {
  const out = [], skipped = [];
  if (!net || !storage?.length) return { attached: out, skipped };
  for (const s of storage) {
    const p = toCells(fine, [ringCentroid(s.ring)])[0], dx = fine.dx;
    let bi = -1, bd = Infinity;
    net.nodes.forEach((n, i) => { if (n.outfall || n.offsite || n.storage) return; const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) * dx; if (d < bd) { bd = d; bi = i; } });
    if (bi < 0 || bd > 150 || !(s.volume > 0)) { skipped.push(s.id); continue; }
    const to = net.nodes[bi], k = Math.min(fine.ny - 1, Math.max(0, Math.floor(p[1]))) * fine.nx + Math.min(fine.nx - 1, Math.max(0, Math.floor(p[0])));
    const floor = Number.isFinite(s.bottom) ? s.bottom : to.invert;
    const node = { name: 'S' + out.length, p, ground: f.z[k], invert: floor, depth: s.depth, storageArea: s.area * s.voids, storage: true, outfall: false,
      inletFine: [], gutter: k, fineCell: k, area: 0, CA: 0 };
    net.nodes.push(node);
    const D = s.connD > 0 ? s.connD : DEFAULTS.storage.connD;
    net.pipes.push({ name: 'C' + net.pipes.length, from: bi, to: net.nodes.length - 1, L: Math.max(2, bd), D, Q: 0, S: 1e-4,
      inOffset: Math.max(0, floor - to.invert), outOffset: Math.max(0, to.invert - floor), area: 0, storageLink: true, Qfull: 0 });
    out.push({ id: s.id, node: node.name, to: to.name, volume: s.volume, area: s.area, depth: s.depth, dist: bd });
  }
  return { attached: out, skipped };
}

// ------------------------------------------------------------------ estimate → editable layer

/**
 * The street-following (or linked) network as editable features. Off-site continuation pipes are dropped; the manhole
 * they start from becomes a boundary outfall, which rebuilds the same continuation.
 * @param ll  node → [lon, lat]   @param cellLL fine cell index → [lon, lat]
 */
export function networkToLayer(net, ll, cellLL) {
  const feats = [], r3 = (v) => Math.round(v * 1000) / 1000;
  const boundary = new Set(net.pipes.filter(q => q.offsite).map(q => q.from));
  const keep = (i) => !net.nodes[i].offsite;
  net.nodes.forEach((n, i) => {
    if (!keep(i) || n.storage) return;
    const at = ll(n);
    if (n.outfall || boundary.has(i)) feats.push(feature('outfall', { type: 'Point', coordinates: at }, { invert: r3(n.invert), boundary: boundary.has(i) }));
    else feats.push(feature('manhole', { type: 'Point', coordinates: at }, { invert: r3(n.invert), rim: r3(n.ground) }));
  });
  for (const q of net.pipes) {
    if (q.offsite || q.storageLink || !keep(q.from) || !keep(q.to)) continue;
    const a = net.nodes[q.from], b = net.nodes[q.to];
    feats.push(feature('pipe', { type: 'LineString', coordinates: [ll(a), ll(b)] },
      { D: q.D, W: q.W || null, shape: q.shape ?? 'CIRCULAR', n: net.opts.n, upInv: r3(a.invert + q.inOffset), dnInv: r3(b.invert + q.outOffset) }));
  }
  for (const g of net.inlets) if (g.grates > 0) feats.push(feature('inlet', { type: 'Point', coordinates: cellLL(g.fineCell) }, { grates: g.grates }));
  return feats;
}

let seq = 1;
export const nextId = () => seq++;
export const bumpIds = (fc) => { for (const f of fc.features) if (f.id >= seq) seq = f.id + 1; };
export function feature(type, geometry, props = {}) {
  return { type: 'Feature', id: nextId(), geometry, properties: { type, ...structuredClone(DEFAULTS[type]), ...props } };
}

// ------------------------------------------------------------------ import: GeoJSON, shapefile, zip

/** Files from an <input type=file multiple> → [{ name, kind: 'point'|'line'|'polygon', coords, props }] in lon/lat. */
export async function readFiles(files, { fetcher } = {}) {
  const byExt = {}, out = [];
  const take = (name, buf) => { const m = /^(.*)\.([a-z0-9]+)$/i.exec(name); if (!m) return; const base = m[1].split(/[\\/]/).pop(), ext = m[2].toLowerCase(); (byExt[base] ??= {})[ext] = buf; };
  for (const file of files) {
    const buf = await file.arrayBuffer();
    if (/\.zip$/i.test(file.name)) for (const [n, b] of await unzip(buf)) take(n, b);
    else take(file.name, buf);
  }
  for (const [base, parts] of Object.entries(byExt)) {
    for (const ext of ['geojson', 'json']) if (parts[ext]) out.push(...await fromGeoJSON(base, JSON.parse(new TextDecoder().decode(parts[ext])), fetcher));
    if (parts.shp) {
      const geoms = parseShp(parts.shp), props = parts.dbf ? parseDbf(parts.dbf) : [];
      const prj = parts.prj ? new TextDecoder().decode(parts.prj) : null;
      const tf = await transformFor(prj, geoms, fetcher);
      geoms.forEach((g, i) => { if (g) out.push({ name: base, ...mapGeom(g, tf), props: props[i] ?? {} }); });
    }
  }
  if (!out.length) throw new Error('No features found: use GeoJSON, a zipped shapefile, or the .shp + .dbf + .prj files together');
  return out;
}

async function fromGeoJSON(name, gj, fetcher) {
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [];
  const crs = gj.crs?.properties?.name ?? null, code = crs && /EPSG:{1,2}(\d+)/i.exec(crs)?.[1];
  const raw = [];
  for (const f of feats) {
    const g = f.geometry; if (!g) continue;
    const props = f.properties ?? {};
    const push = (kind, coords) => raw.push({ kind, coords, props });
    if (g.type === 'Point') push('point', g.coordinates);
    else if (g.type === 'MultiPoint') g.coordinates.forEach(c => push('point', c));
    else if (g.type === 'LineString') push('line', g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(c => push('line', c));
    else if (g.type === 'Polygon') push('polygon', g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(c => push('polygon', c));
  }
  const tf = await transformFor(code && code !== '4326' && code !== '84' ? `EPSG:${code}` : null, raw.map(r => ({ kind: r.kind, coords: r.coords })), fetcher);
  return raw.map(r => ({ name, ...mapGeom(r, tf), props: r.props }));
}

const mapGeom = (g, tf) => {
  const p = (c) => tf([c[0], c[1]]);
  return { kind: g.kind, coords: g.kind === 'point' ? p(g.coords) : g.kind === 'line' ? g.coords.map(p) : g.coords.map(r => r.map(p)) };
};

/** Coordinate transform to lon/lat: identity when the data already look geographic, else proj4 from the .prj / EPSG code. */
export async function transformFor(prj, geoms, fetcher) {
  const first = geoms.find(Boolean); if (!first) return (c) => c;
  const c0 = first.kind === 'point' ? first.coords : first.kind === 'line' ? first.coords[0] : first.coords[0][0];
  const geographic = Math.abs(c0[0]) <= 180 && Math.abs(c0[1]) <= 90;
  if (!prj && geographic) return (c) => c;
  if (prj && /^GEOGCS/i.test(prj.trim()) && geographic) return (c) => c;
  if (!prj) throw new Error('Coordinates are projected but no .prj (or GeoJSON crs) says which system: include the .prj file');
  const proj4 = await loadProj4();
  let def = prj;
  if (/^EPSG:\d+$/i.test(prj)) {
    if (!fetcher) throw new Error(`Cannot look up ${prj}`);
    def = (await (await fetcher(`https://epsg.io/${prj.split(':')[1]}.proj4`)).text()).trim();
    if (!/^\+proj/.test(def)) throw new Error(`Unknown coordinate system ${prj}`);
  }
  const t = proj4(def, 'EPSG:4326');
  return (c) => t.forward(c);
}
let proj4p = null;
function loadProj4() {
  if (globalThis.proj4) return Promise.resolve(globalThis.proj4);
  return proj4p ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.11.0/proj4.js';
    s.onload = () => res(globalThis.proj4); s.onerror = () => rej(new Error('Could not load the projection library')); document.head.append(s);
  });
}

/** Shapefile geometry (2D, Z and M variants) → [{ kind, coords }] (null for null shapes). */
export function parseShp(buf) {
  const dv = new DataView(buf), out = [];
  for (let o = 100; o + 8 <= buf.byteLength;) {
    const len = dv.getInt32(o + 4, false) * 2, r = o + 8; o = r + len;
    const t = dv.getInt32(r, true), base = t % 10; // 1/11/21 point, 3/13/23 line, 5/15/25 polygon, 8/18/28 multipoint
    if (t === 0) { out.push(null); continue; }
    if (base === 1) { out.push({ kind: 'point', coords: [dv.getFloat64(r + 4, true), dv.getFloat64(r + 12, true)] }); continue; }
    if (base === 8) { const n = dv.getInt32(r + 36, true); out.push({ kind: 'point', coords: [dv.getFloat64(r + 40, true), dv.getFloat64(r + 48, true)], more: n }); continue; }
    const np = dv.getInt32(r + 36, true), npt = dv.getInt32(r + 40, true), p0 = r + 44, pts = p0 + 4 * np, parts = [];
    for (let k = 0; k < np; k++) {
      const a = dv.getInt32(p0 + 4 * k, true), e = k + 1 < np ? dv.getInt32(p0 + 4 * (k + 1), true) : npt, part = [];
      for (let q = a; q < e; q++) part.push([dv.getFloat64(pts + 16 * q, true), dv.getFloat64(pts + 16 * q + 8, true)]);
      parts.push(part);
    }
    if (base === 3) out.push({ kind: 'line', coords: parts[0], extra: parts.slice(1) });
    else out.push({ kind: 'polygon', coords: parts });
  }
  return out;
}

/** dBASE attributes → [{ field: value }]. Numbers parse as numbers. */
export function parseDbf(buf) {
  const dv = new DataView(buf), n = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), u8 = new Uint8Array(buf);
  const dec = new TextDecoder('utf-8'), fields = [];
  for (let o = 32; o < hlen - 1 && u8[o] !== 0x0d; o += 32) fields.push({ name: dec.decode(u8.subarray(o, o + 11)).replace(/\0.*$/, '').trim(), type: String.fromCharCode(u8[o + 11]), len: u8[o + 16] });
  const rows = [];
  for (let i = 0; i < n; i++) {
    let o = hlen + i * rlen + 1; const row = {};
    for (const f of fields) {
      const s = dec.decode(u8.subarray(o, o + f.len)).trim(); o += f.len;
      row[f.name] = /[NF]/.test(f.type) ? (s === '' ? null : Number(s)) : s;
    }
    rows.push(row);
  }
  return rows;
}

/** Entries of a .zip (stored or deflated) as [[name, ArrayBuffer]]. */
export async function unzip(buf) {
  const dv = new DataView(buf), out = [];
  let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip file');
  const n = dv.getUint16(e + 10, true); let o = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true), nlen = dv.getUint16(o + 28, true), xlen = dv.getUint16(o + 30, true), clen = dv.getUint16(o + 32, true), lho = dv.getUint32(o + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, o + 46, nlen)); o += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = buf.slice(start, start + csize);
    if (method === 0) out.push([name, data]);
    else if (method === 8) out.push([name, await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()]);
  }
  return out;
}

// ------------------------------------------------------------------ imported features → layer features

const ELEV = { ft: 0.3048, m: 1 };
const SIZE = { in: 0.0254, mm: 0.001, ft: 0.3048, m: 1 };
const field = (props, re) => Object.keys(props).find(k => re.test(k));
const val = (props, re) => { const k = field(props, re); const v = k ? Number(props[k]) : NaN; return Number.isFinite(v) && v !== 0 ? v : null; };

/** Which layer type a file's features are, from geometry and name. */
export function guessType(name, kind) {
  if (kind === 'polygon') return 'storage';
  if (kind === 'line') return /culv/i.test(name) ? 'culvert' : /levee|berm|dike|dyke|embank/i.test(name) ? 'berm' : /deploy|barrier|tiger|aquadam/i.test(name) ? 'barrier' : /wall/i.test(name) ? 'wall' : 'pipe';
  return /outfall|outlet|discharge/i.test(name) ? 'outfall' : /inlet|catch|cb\b|basin|grate/i.test(name) ? 'inlet' : 'manhole';
}

/**
 * Imported features → layer features. `as` forces a type ('auto' guesses per file); `sizeUnits` for diameters
 * ('auto' detects from the values), `elevUnits` for inverts and rims.
 */
export function toLayer(items, { as = 'auto', sizeUnits = 'auto', elevUnits = 'ft', detectPipeFields } = {}) {
  const feats = [], skipped = { geometry: 0 }, eu = ELEV[elevUnits] ?? 1;
  const groups = new Map(); for (const it of items) { const k = it.name + '|' + it.kind; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  for (const list of groups.values()) {
    const { name, kind } = list[0], type = as === 'auto' ? guessType(name, kind) : as;
    const want = type === 'storage' ? 'polygon' : type === 'pipe' || type === 'culvert' || BARRIERS.has(type) ? 'line' : 'point';
    if (kind !== want) { skipped.geometry += list.length; continue; }
    if (BARRIERS.has(type)) { // crest elevation or height fields when the file has them
      for (const it of list) {
        const crest = val(it.props, /crest|top_?el|tob\b|top_?elev/i), h = val(it.props, /height|hgt/i);
        feats.push(feature(type, { type: 'LineString', coordinates: it.coords }, { ...(crest != null ? { mode: 'elev', crest: crest * eu } : h != null ? { height: h * eu } : {}), source: name }));
      }
    } else if (want === 'line') {
      const fields = Object.keys(list[0].props), m = detectPipeFields(fields, list.slice(0, 200).map(x => x.props));
      const su = SIZE[sizeUnits === 'auto' ? m.sizeUnits : sizeUnits] ?? 1;
      for (const it of list) {
        const p = it.props, D = m.size ? Number(p[m.size]) * su : NaN, W = m.width ? Number(p[m.width]) * su : NaN;
        const shp = String(m.shape ? p[m.shape] ?? '' : ''), box = /box|rect|square|rcb/i.test(shp);
        const up = m.upInvert ? Number(p[m.upInvert]) : NaN, dn = m.dnInvert ? Number(p[m.dnInvert]) : NaN;
        feats.push(feature(type, { type: 'LineString', coordinates: it.coords }, {
          D: D > 0 && D <= 6 ? D : null, ...(box ? { shape: 'RECT_CLOSED', W: W > 0 && W <= 12 ? W : null } : {}),
          upInv: up && Number.isFinite(up) ? up * eu : null, dnInv: dn && Number.isFinite(dn) ? dn * eu : null, source: name }));
      }
    } else if (want === 'point') {
      for (const it of list) {
        const inv = val(it.props, /inv/i), rim = val(it.props, /rim|top|grd|ground/i);
        feats.push(feature(type, { type: 'Point', coordinates: it.coords }, { ...(inv != null ? { invert: inv * eu } : {}), ...(rim != null && type === 'manhole' ? { rim: rim * eu } : {}), source: name }));
      }
    } else for (const it of list) {
      const d = val(it.props, /depth|height|hgt/i), bot = val(it.props, /bot|floor|inv/i);
      feats.push(feature('storage', { type: 'Polygon', coordinates: [it.coords[0]] }, { ...(d != null ? { depth: d * eu } : {}), ...(bot != null ? { bottom: bot * eu } : {}), source: name }));
    }
  }
  return { features: feats, skipped };
}
