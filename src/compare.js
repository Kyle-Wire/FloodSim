// Paired-run comparison (phase 2 of docs/specs/site-design-mode.md): two solver runs that differ only in the design.
//
//   fingerprint   a hash of everything that is not the design (storm, inflow, tide, start levels, antecedent soil,
//                 grid and solver, run length, sediment / debris / bank options, drainage settings, area, app commit);
//                 two runs compare only when their fingerprints match, and a refusal names the parts that differ
//   grids         the 1 m outputs every run keeps (max depth, max water surface, max speed, max depth × speed, first
//                 wetting, time above 15 cm, final depth), as binary .f32 with an ESRI-style .hdr
//   Δ maps        proposed − existing with a no-change band (3 mm default), newly wet and newly dry cells
//   impacts       off-site cells (outside the site boundary) whose max water surface rose above the band
//   tables        buildings near the site (new ones with their FFE, existing ones with an estimated FFE = HAG + reveal)
//                 and control lines (peak flow, volume, time to peak, pre vs post)
// All pure functions on typed arrays: row-major, row 0 = north, NaN = no value.
import { fillRings } from './terrain.js';
import { barrierFaces } from './barriers.js';

// ------------------------------------------------------------------ hashing and the forcing fingerprint

/** JSON with sorted keys; typed arrays as arrays; non-finite numbers as strings (so NaN ≠ null). */
export function stableStringify(v) {
  if (v == null) return 'null';
  if (ArrayBuffer.isView(v)) v = Array.from(v);
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : `"${v}"`;
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
/** FNV-1a (32-bit) of a string, as 8 hex digits. */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ (c & 0xff), 0x01000193); if (c > 0xff) h = Math.imul(h ^ (c >>> 8), 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const hashOf = (v) => fnv1a(stableStringify(v));

/** The parts of the forcing, in the order a refusal lists them, with their names. */
export const FORCING_PARTS = {
  storm: 'storm (depth, duration, pattern, or the historic event and its rain source)',
  inflow: 'river inflow',
  tide: 'tide and surge',
  startLevels: 'start water levels (gauge readings)',
  antecedent: 'antecedent soil moisture and water table',
  grid: 'grid size and speed mode',
  solver: 'solver settings',
  runLength: 'run length',
  options: 'sediment, debris and bank options',
  drainage: 'drainage, green infrastructure, infrastructure layer and calibration',
  area: 'model area',
  commit: 'app commit',
};
/** forcing: { storm, inflow, … } (any JSON-able values) → { hash, parts: { name: hash } } */
export function fingerprint(forcing) {
  const parts = {};
  for (const k of Object.keys(FORCING_PARTS)) parts[k] = hashOf(forcing?.[k] ?? null);
  return { hash: hashOf(parts), parts };
}
/** The names of the forcing parts two fingerprints differ in ([] when they match). */
export function fingerprintDiff(a, b) {
  if (!a?.parts || !b?.parts) return ['fingerprint missing (a run saved before comparisons were recorded)'];
  return Object.keys(FORCING_PARTS).filter(k => a.parts[k] !== b.parts[k]).map(k => FORCING_PARTS[k]);
}
/** Whether two runs may be compared, and why not. a, b: { forcing: fingerprint, scenario } */
export function comparable(a, b) {
  const diff = fingerprintDiff(a.forcing, b.forcing);
  return diff.length ? { ok: false, diff, reason: `The runs differ in more than the design: ${diff.join('; ')}. Rerun one of them with the other's settings.` } : { ok: true, diff: [] };
}

// ------------------------------------------------------------------ 1 m output grids (.f32 + .hdr)

export const NODATA = -9999;
export const GRIDS = {
  max_depth: 'maximum depth (m)',
  max_wse: 'maximum water surface (m NAVD88; NODATA = never wet)',
  max_speed: 'maximum speed (m/s) where at least 5 cm deep',
  max_dv: 'maximum depth × speed at the same moment (m²/s)',
  t_wet: 'time of first wetting, deeper than 5 cm (s from the start; NODATA = never)',
  t_above15: 'time deeper than 15 cm (s)',
  final_depth: 'depth at the end of the run (m)',
};
/** ESRI-style header (as for an .flt grid) for a float32 raster: geo = { nx, ny, x0, y0 (lower-left), dx }. */
export function gridHeader(geo) {
  return [`ncols ${geo.nx}`, `nrows ${geo.ny}`, `xllcorner ${geo.x0}`, `yllcorner ${geo.y0}`, `cellsize ${geo.dx}`, `nodata_value ${NODATA}`, 'byteorder LSBFIRST', 'pixeltype FLOAT', ''].join('\n');
}
export function parseHeader(text) {
  const o = {}; for (const line of text.split(/\r?\n/)) { const [k, v] = line.trim().split(/\s+/); if (k) o[k.toLowerCase()] = v; }
  return { nx: Number(o.ncols), ny: Number(o.nrows), x0: Number(o.xllcorner), y0: Number(o.yllcorner), dx: Number(o.cellsize), nodata: Number(o.nodata_value ?? NODATA) };
}
/** Float32 little-endian bytes, NaN written as NODATA. */
export function encodeF32(a) {
  const out = new Float32Array(a.length); for (let k = 0; k < a.length; k++) out[k] = Number.isFinite(a[k]) ? a[k] : NODATA;
  const dv = new DataView(out.buffer); if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) for (let k = 0; k < out.length; k++) dv.setFloat32(4 * k, out[k], true);
  return new Uint8Array(out.buffer);
}
/** Bytes of an .f32 back to a Float32Array, NODATA as NaN. */
export function decodeF32(bytes, nodata = NODATA) {
  const b = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const dv = new DataView(b), n = b.byteLength / 4, a = new Float32Array(n);
  for (let k = 0; k < n; k++) { const v = dv.getFloat32(4 * k, true); a[k] = v === nodata ? NaN : v; }
  return a;
}
/** ESRI ASCII grid (for export), NaN as NODATA, `dp` decimals. */
export function toASC(a, geo, dp = 3) {
  const L = [`ncols ${geo.nx}`, `nrows ${geo.ny}`, `xllcorner ${geo.x0}`, `yllcorner ${geo.y0}`, `cellsize ${geo.dx}`, `NODATA_value ${NODATA}`], m = 10 ** dp;
  for (let j = 0; j < geo.ny; j++) {
    const row = new Array(geo.nx);
    for (let i = 0; i < geo.nx; i++) { const v = a[j * geo.nx + i]; row[i] = Number.isFinite(v) ? String(Math.round(v * m) / m) : String(NODATA); }
    L.push(row.join(' '));
  }
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------ Δ maps

/**
 * Δ = b − a per cell. Where only one run has a value (a time that never happened, a cell dry in one run) Δ is NaN:
 * those cells are the newly wet and newly dry ones. |Δ| under `band` is no change (0). mask (optional): cells to count.
 * → { delta, stats: { rise, fall, same, onlyA, onlyB, maxRise, maxFall, kMaxRise } } (counts of cells)
 */
export function diffGrid(a, b, { band = 0.003, mask = null } = {}) {
  const n = a.length, delta = new Float32Array(n), s = { rise: 0, fall: 0, same: 0, onlyA: 0, onlyB: 0, maxRise: 0, maxFall: 0, kMaxRise: -1 };
  for (let k = 0; k < n; k++) {
    const x = a[k], y = b[k], fx = Number.isFinite(x), fy = Number.isFinite(y);
    if (!fx || !fy) { delta[k] = NaN; if (mask && !mask[k]) continue; if (fx) s.onlyA++; else if (fy) s.onlyB++; continue; }
    const d = y - x, v = Math.abs(d) < band ? 0 : d; delta[k] = v;
    if (mask && !mask[k]) continue;
    if (v > 0) { s.rise++; if (v > s.maxRise) { s.maxRise = v; s.kMaxRise = k; } } else if (v < 0) { s.fall++; if (v < s.maxFall) s.maxFall = v; } else s.same++;
  }
  return { delta, stats: s };
}
/** +1 newly wet (b deeper than thr, a not), −1 newly dry, 0 otherwise. → { map: Int8Array, wet, dry } */
export function newlyWetDry(depthA, depthB, thr = 0.15, mask = null) {
  const n = depthA.length, map = new Int8Array(n); let wet = 0, dry = 0;
  for (let k = 0; k < n; k++) {
    const a = depthA[k] > thr, b = depthB[k] > thr;
    if (a === b) continue;
    map[k] = b ? 1 : -1; if (mask && !mask[k]) continue; if (b) wet++; else dry++;
  }
  return { map, wet, dry };
}
/** Cells inside lon/lat (or cell-coordinate) rings: toCell maps a point to fractional [col, row]. */
export function polygonMask(rings, nx, ny, toCell = (p) => p) {
  const m = new Uint8Array(nx * ny); fillRings(rings.map(r => r.map(toCell)), nx, ny, (k) => { m[k] = 1; }); return m;
}

/**
 * Off-site adverse impact: cells outside the site whose max water surface rose more than the band.
 * dWse: Δ max water surface (diffGrid with the band), onsite: site mask (null = no site: everything counts as off-site),
 * newlyWet (Int8 map, optional), buildings: [{ id, name, ring }] (rings as cell indices).
 * → { cells, area, maxRise, kMaxRise, newlyWet, buildings: [ids], affected: [{ id, name, rise }] }
 */
export function adverseImpact(dWse, onsite, cellArea, { newlyWet = null, buildings = [] } = {}) {
  let cells = 0, maxRise = 0, kMaxRise = -1, nw = 0;
  const off = (k) => !onsite || !onsite[k];
  for (let k = 0; k < dWse.length; k++) {
    if (!off(k)) continue;
    if (dWse[k] > 0) { cells++; if (dWse[k] > maxRise) { maxRise = dWse[k]; kMaxRise = k; } }
    if (newlyWet?.[k] === 1) nw++;
  }
  const affected = [];
  for (const b of buildings) {
    let r = 0, hit = false; for (const k of b.ring) if (off(k) && (dWse[k] > 0 || newlyWet?.[k] === 1)) { hit = true; if (dWse[k] > r) r = dWse[k]; }
    if (hit && !b.isNew) affected.push({ id: b.id, name: b.name ?? null, rise: r });
  }
  return { cells, area: cells * cellArea, maxRise, kMaxRise, newlyWet: nw, newlyWetArea: nw * cellArea, affected };
}

// ------------------------------------------------------------------ buildings near the site

/** Ring of cells around a set of cells (8-neighbours outside it, inside the grid). */
export function ringOf(cells, nx, ny) {
  const own = new Set(cells), ring = new Set();
  for (const k of cells) {
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a; if (!own.has(q)) ring.add(q);
    }
  }
  return [...ring];
}
/**
 * Mapped buildings (4-connected blobs of bld) with any cell in `near`, each with its ring and an estimated FFE =
 * HAG + reveal (HAG = highest ground on the ring). → [{ id: 'e<n>', cells, ring, hag, ffe, estimated: true }]
 */
export function existingBuildings(bld, z, nx, ny, near, { reveal = 0.15, skip = null } = {}) {
  const seen = new Uint8Array(nx * ny), out = [];
  for (let s = 0; s < bld.length; s++) {
    if (!bld[s] || seen[s] || (skip && skip[s])) continue;
    const cells = [], st = [s]; seen[s] = 1; let touch = false;
    while (st.length) {
      const k = st.pop(); cells.push(k); if (near[k]) touch = true;
      const i = k % nx, j = (k / nx) | 0;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a; if (bld[q] && !seen[q] && !(skip && skip[q])) { seen[q] = 1; st.push(q); }
      }
    }
    if (!touch) continue;
    const ring = ringOf(cells, nx, ny).filter(k => !bld[k]);
    let hag = -Infinity; for (const k of ring) hag = Math.max(hag, z[k]);
    if (!Number.isFinite(hag)) continue;
    out.push({ id: 'e' + out.length, name: null, cells, ring, hag, ffe: hag + reveal, estimated: true, isNew: false });
  }
  return out;
}
/** Cells within `dist` cells of a mask (Chebyshev square around each, for a "near the site" test). */
export function dilate(mask, nx, ny, dist) {
  const out = new Uint8Array(nx * ny), r = Math.max(0, Math.round(dist));
  // separable max filter: rows, then columns
  const tmp = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) { let last = -Infinity; for (let i = 0; i < nx; i++) { if (mask[j * nx + i]) last = i; if (i - last <= r) tmp[j * nx + i] = 1; }
    last = Infinity; for (let i = nx - 1; i >= 0; i--) { if (mask[j * nx + i]) last = i; if (last - i <= r) tmp[j * nx + i] = 1; } }
  for (let i = 0; i < nx; i++) { let last = -Infinity; for (let j = 0; j < ny; j++) { if (tmp[j * nx + i]) last = j; if (j - last <= r) out[j * nx + i] = 1; }
    last = Infinity; for (let j = ny - 1; j >= 0; j--) { if (tmp[j * nx + i]) last = j; if (last - j <= r) out[j * nx + i] = 1; } }
  return out;
}
/** Highest value on a ring (NaN when every cell is NaN: dry). */
export function perimeterMax(grid, ring) { let m = -Infinity; for (const k of ring) if (grid[k] > m) m = grid[k]; return Number.isFinite(m) ? m : NaN; }

/**
 * Building table: max water surface around each building in both runs against its FFE (the lowest opening for a
 * basement). New buildings did not exist before: their "before" water level is where the building will stand, and
 * they are not counted as flooded before. → rows [{ id, name, kind, ffe, estimated, wseBefore, wseAfter, dWse, floodedBefore, floodedAfter }]
 */
export function buildingTable(buildings, wseA, wseB) {
  return buildings.map(b => {
    const a = perimeterMax(wseA, b.ring), c = perimeterMax(wseB, b.ring), crit = b.critical ?? b.ffe;
    return { id: b.id, name: b.name ?? null, kind: b.isNew ? 'new' : 'existing', ffe: b.ffe, estimated: !!b.estimated, wseBefore: a, wseAfter: c,
      dWse: Number.isFinite(a) && Number.isFinite(c) ? c - a : NaN, floodedBefore: b.isNew ? null : a > crit, floodedAfter: c > crit };
  });
}

// ------------------------------------------------------------------ control lines

/**
 * Solver faces of control lines (polylines in solver-cell coordinates), from barrierFaces (watertight: every
 * 4-neighbour path across a line crosses one). Each face gets the sign that makes + mean "crossing to the right of the
 * line as drawn"; a closed line (first point = last) is turned so + is outward. → { faces: [{ i, j, axis, line, sign }], perLine: [count] }
 */
export function lineFaces(lines, nx, ny) {
  const faces = [], perLine = lines.map(() => 0);
  lines.forEach((pts, li) => {
    const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9;
    let turn = 1;
    if (closed) { let a = 0; for (let m = 0; m + 1 < pts.length; m++) a += pts[m][0] * pts[m + 1][1] - pts[m + 1][0] * pts[m][1]; turn = a > 0 ? -1 : 1; } // rows run south: a > 0 is clockwise on the map, so right is inside
    const seen = new Set();
    for (const f of barrierFaces(pts, nx, ny)) {
      const key = f.axis * nx * ny * 4 + f.j * (nx + 1) + f.i; if (seen.has(key)) continue; seen.add(key); // a polyline can cross a face twice: count it once
      const [ax, ay] = pts[f.seg], [bx, by] = pts[f.seg + 1], dx = bx - ax, dy = by - ay;
      const right = f.axis === 0 ? -dy : dx; // the face normal (+x or +y, rows south) against the right-hand normal (−dy, dx)
      faces.push({ i: f.i, j: f.j, axis: f.axis, line: li, sign: (right >= 0 ? 1 : -1) * turn }); perLine[li]++;
    }
  });
  return { faces, perLine };
}
/**
 * Flow (m³/s) from cumulative-volume samples [[t, net, plus?, minus?], …]: one value per interval, at its end. col 1 =
 * net, 2 = the volume to the + side only, 3 = to the − side only.
 */
export function hydrograph(samples, col = 1) {
  const q = [];
  for (let m = 1; m < samples.length; m++) { const dt = samples[m][0] - samples[m - 1][0]; if (dt > 0) q.push([samples[m][0], (samples[m][col] - samples[m - 1][col]) / dt]); }
  return q;
}
/**
 * A line's peak flow to its + side (out of a closed line, or downstream across an outlet drawn with the flow to its
 * right), its time, and the net volume, from its record { volume, plus, minus, series: [[t, net, plus, minus]] }. A
 * closed line around a site has water crossing both ways; the peak counts only what leaves (the gross + flow) when the
 * samples carry it, else the net. → { peak, tPeak, peakBack (largest flow to the − side), volume }
 */
export function lineStats(rec) {
  const s = rec?.series ?? [], gross = s.length > 1 && s[1].length >= 4, q = hydrograph(s, gross ? 2 : 1), back = gross ? hydrograph(s, 3) : q.map(([t, v]) => [t, -v]);
  let peak = 0, tPeak = NaN, peakBack = 0;
  for (const [t, v] of q) if (v > peak) { peak = v; tPeak = t; }
  for (const [, v] of back) if (v > peakBack) peakBack = v;
  return { peak, tPeak, peakBack, volume: rec?.volume ?? NaN };
}
/** Outlet table: per control line (matched by id), pre vs post. → rows [{ id, name, peakA, peakB, dPeak, volA, volB, dVol, tPeakA, tPeakB }] */
export function outletTable(linesA, linesB) {
  const ids = [...new Set([...(linesA ?? []).map(l => l.id), ...(linesB ?? []).map(l => l.id)])];
  return ids.map(id => {
    const a = linesA?.find(l => l.id === id), b = linesB?.find(l => l.id === id), sa = lineStats(a), sb = lineStats(b);
    return { id, name: (b ?? a).name ?? null, inA: !!a, inB: !!b, peakA: a ? sa.peak : NaN, peakB: b ? sb.peak : NaN, dPeak: a && b ? sb.peak - sa.peak : NaN,
      volA: sa.volume, volB: sb.volume, dVol: a && b ? sb.volume - sa.volume : NaN, tPeakA: sa.tPeak, tPeakB: sb.tPeak };
  });
}

// ------------------------------------------------------------------ tables and the one-page summary

/** CSV with a header row; numbers to `dp` decimals, NaN and null empty. cols: [[key, title, dp?]] */
export function toCSV(rows, cols) {
  const cell = (v, dp) => v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : typeof v === 'number' ? String(dp == null ? v : +v.toFixed(dp)) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [cols.map(c => c[1]).join(','), ...rows.map(r => cols.map(([k, , dp]) => cell(r[k], dp)).join(','))].join('\n') + '\n';
}
export const BUILDING_COLS = [['id', 'building'], ['name', 'name'], ['kind', 'new_or_existing'], ['ffe', 'ffe_m', 3], ['estimated', 'ffe_estimated'], ['wseBefore', 'max_wse_before_m', 3],
  ['wseAfter', 'max_wse_after_m', 3], ['dWse', 'change_m', 3], ['floodedBefore', 'flooded_before'], ['floodedAfter', 'flooded_after']];
export const OUTLET_COLS = [['id', 'line'], ['name', 'name'], ['peakA', 'peak_before_m3s', 4], ['peakB', 'peak_after_m3s', 4], ['dPeak', 'peak_change_m3s', 4], ['volA', 'volume_before_m3', 2],
  ['volB', 'volume_after_m3', 2], ['dVol', 'volume_change_m3', 2], ['tPeakA', 'time_to_peak_before_s', 0], ['tPeakB', 'time_to_peak_after_s', 0]];

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** One-page HTML summary of a comparison (cmp from the app: runs, stats, impact, tables, totals). */
export function summaryHTML(cmp) {
  const f = (v, d = 2, u = '') => (Number.isFinite(v) ? v.toFixed(d) + u : '–');
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const imp = cmp.impact, t = cmp.totals ?? {};
  return `<!doctype html><meta charset="utf-8"><title>FloodSim comparison</title>
<style>body{font:13px/1.45 system-ui,sans-serif;max-width:820px;margin:24px auto;color:#111}h1{font-size:18px}h2{font-size:14px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:3px 6px;text-align:left}td.n{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#b00020}.ok{color:#0a6}</style>
<h1>FloodSim comparison: ${esc(cmp.b.label)} vs ${esc(cmp.a.label)}</h1>
<p>Both runs share the forcing fingerprint <code>${esc(cmp.a.forcing.hash)}</code> (storm, inflow, tide, start levels, soil, grid, solver, options, drainage, area, app commit ${esc(cmp.a.commit ?? '?')}); they differ only in the design. Changes under ${(cmp.band * 1000).toFixed(0)} mm are reported as no change.</p>
<table>${row('Before', `${esc(cmp.a.label)} (${esc(cmp.a.saved ?? '')})`)}${row('After', `${esc(cmp.b.label)} (${esc(cmp.b.saved ?? '')}), design ${esc(cmp.b.designHash ?? '–')}`)}${row('Storm', esc(cmp.a.storm ?? ''))}</table>
<h2>Off-site impact${cmp.site ? '' : ' (no site boundary drawn: the whole model counts as off-site)'}</h2>
<table>${row('Cells with a higher max water surface', `<span class="${imp.cells ? 'bad' : 'ok'}">${imp.cells.toLocaleString()} (${f(imp.area, 0, ' m²')})</span>`)}${row('Largest rise', f(imp.maxRise * 1000, 0, ' mm'))}
${row('Newly wet off-site (> 15 cm)', `${imp.newlyWet.toLocaleString()} cells (${f(imp.newlyWetArea, 0, ' m²')})`)}${row('Existing buildings affected', imp.affected.length ? imp.affected.map(b => `${esc(b.name ?? b.id)} (+${f(b.rise * 1000, 0, ' mm')})`).join(', ') : 'none')}</table>
<h2>Changes</h2><table>${cmp.maps.map(m => row(m.title, `${m.stats.rise.toLocaleString()} cells up (max ${f(m.stats.maxRise * m.scale, m.dp, m.unit)}), ${m.stats.fall.toLocaleString()} down (max ${f(-m.stats.maxFall * m.scale, m.dp, m.unit)})`)).join('')}
${row('Newly wet / newly dry (> 15 cm)', `${cmp.wetDry.wet.toLocaleString()} / ${cmp.wetDry.dry.toLocaleString()} cells`)}</table>
<h2>Totals</h2><table>${Object.entries(t).map(([k, v]) => row(k, v)).join('')}</table>
<h2>Buildings near the site</h2><table><tr><th>Building</th><th>FFE m</th><th>Max water before</th><th>after</th><th>Flooded before / after</th></tr>
${cmp.buildings.map(b => `<tr><td>${esc(b.name ?? b.id)} ${b.kind === 'new' ? '(new)' : ''}</td><td class="n">${f(b.ffe, 2)}${b.estimated ? ' est.' : ''}</td><td class="n">${f(b.wseBefore, 2)}</td><td class="n">${f(b.wseAfter, 2)}</td><td>${b.floodedBefore == null ? '–' : b.floodedBefore ? 'yes' : 'no'} / <span class="${b.floodedAfter ? 'bad' : ''}">${b.floodedAfter ? 'yes' : 'no'}</span></td></tr>`).join('') || '<tr><td colspan="5">none</td></tr>'}</table>
<p>Existing buildings' FFE is estimated as the highest adjacent grade + 0.15 m (marked est.).</p>
<h2>Control lines</h2><table><tr><th>Line</th><th>Peak before m³/s</th><th>after</th><th>Volume before m³</th><th>after</th><th>Time to peak before / after</th></tr>
${cmp.outlets.map(o => `<tr><td>${esc(o.name ?? o.id)}</td><td class="n">${f(o.peakA, 3)}</td><td class="n">${f(o.peakB, 3)}</td><td class="n">${f(o.volA, 1)}</td><td class="n">${f(o.volB, 1)}</td><td class="n">${f(o.tPeakA / 60, 0)} / ${f(o.tPeakB / 60, 0)} min</td></tr>`).join('') || '<tr><td colspan="6">no control lines drawn</td></tr>'}</table>
<p style="color:#666">FloodSim ${esc(cmp.a.commit ?? '')} · exported ${esc(new Date().toISOString())}</p>`;
}
