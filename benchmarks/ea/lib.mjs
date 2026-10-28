// Gate B harness pieces: parsers for the EA benchmark data (ESRI ASCII grids, CSV, shapefiles), resampling to the
// solver grid, and a run loop that drives the production GPU solver with inflow / water-level hydrographs and
// records probes. Grids here are south-up: row j = 0 is the southern edge, y = y0 + (j + 0.5)·dx.
import { insideRing } from '../../src/geo.js';

/** ESRI ASCII grid text → { nx, ny, x0, y0, dx, nodata, z } with z south-up. */
export function parseASC(txt) {
  const lines = txt.split(/\r?\n/), hdr = {}; let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(\S+)$/); if (!m) break;
    hdr[m[1].toLowerCase()] = Number(m[2]);
  }
  const nx = hdr.ncols, ny = hdr.nrows, dx = hdr.cellsize, nodata = hdr.nodata_value ?? -9999;
  const x0 = hdr.xllcorner ?? hdr.xllcenter - dx / 2, y0 = hdr.yllcorner ?? hdr.yllcenter - dx / 2;
  const z = new Float64Array(nx * ny); let n = 0;
  for (const line of lines.slice(i)) for (const s of line.trim().split(/\s+/)) {
    if (!s) continue; const r = Math.floor(n / nx), c = n % nx; if (r >= ny) break;
    z[(ny - 1 - r) * nx + c] = Number(s); n++; // file is north-first
  }
  if (n < nx * ny) throw new Error(`ASC: ${n} values for ${nx}×${ny}`);
  return { nx, ny, x0, y0, dx, nodata, z };
}

/** CSV text with a header row → array of rows (numbers where numeric). */
export function parseCSV(txt) {
  return txt.split(/\r?\n/).filter(l => l.trim()).slice(1)
    .map(l => l.split(',').map(s => { const t = s.trim(), v = Number(t); return t !== '' && Number.isFinite(v) ? v : t; }));
}

/** Shapefile (.shp) polylines / polygons → array of parts, each [[x, y], …]. */
export function parseShp(buf) {
  const dv = new DataView(buf), parts = [];
  let o = 100;
  while (o + 8 <= buf.byteLength) {
    const len = dv.getInt32(o + 4, false) * 2, r = o + 8; o = r + len;
    if (dv.getInt32(r, true) === 0) continue;
    const np = dv.getInt32(r + 36, true), npt = dv.getInt32(r + 40, true), p0 = r + 44, pts = p0 + 4 * np;
    for (let k = 0; k < np; k++) {
      const a = dv.getInt32(p0 + 4 * k, true), e = k + 1 < np ? dv.getInt32(p0 + 4 * (k + 1), true) : npt, part = [];
      for (let q = a; q < e; q++) part.push([dv.getFloat64(pts + 16 * q, true), dv.getFloat64(pts + 16 * q + 8, true)]);
      parts.push(part);
    }
  }
  return parts;
}

/**
 * Bed on the model grid: mean of the DEM cells whose centres fall in each model cell. With `wallAbove`, DEM cells
 * above that height are walls drawn into the DEM: a model cell that is mostly wall is masked out (a vertical wall in
 * the solver), otherwise its bed is the mean of its non-wall samples.
 */
export function resample(dem, { x0, y0, dx, nx, ny }, { wallAbove = Infinity } = {}) {
  const sum = new Float64Array(nx * ny), n = new Uint32Array(nx * ny), nw = new Uint32Array(nx * ny);
  for (let r = 0; r < dem.ny; r++) for (let c = 0; c < dem.nx; c++) {
    const v = dem.z[r * dem.nx + c]; if (v === dem.nodata) continue;
    const i = Math.floor((dem.x0 + (c + 0.5) * dem.dx - x0) / dx), j = Math.floor((dem.y0 + (r + 0.5) * dem.dx - y0) / dx);
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    const k = j * nx + i; if (v > wallAbove) nw[k]++; else { sum[k] += v; n[k]++; }
  }
  const z = new Float64Array(nx * ny), valid = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) if (n[k] && n[k] >= nw[k]) { z[k] = sum[k] / n[k]; valid[k] = 1; }
  return { z, valid };
}

/** Cells (k = j·nx + i) whose centres are inside any of the rings. */
export function cellsInRings(g, rings) {
  const m = new Uint8Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.x0 + (i + 0.5) * g.dx, y = g.y0 + (j + 0.5) * g.dx;
    if (rings.some(r => insideRing(x, y, r))) m[j * g.nx + i] = 1;
  }
  return m;
}

/** Cells crossed by a polyline (sampled every dx/4), unique, optionally only where `valid`. */
export function cellsOnLine(g, line, valid) {
  const out = [], seen = new Set();
  for (let s = 0; s + 1 < line.length; s++) {
    const [ax, ay] = line[s], [bx, by] = line[s + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (g.dx / 4)));
    for (let q = 0; q <= n; q++) {
      const x = ax + (bx - ax) * q / n, y = ay + (by - ay) * q / n;
      const i = Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.x0) / g.dx))), j = Math.min(g.ny - 1, Math.max(0, Math.floor((y - g.y0) / g.dx)));
      const k = j * g.nx + i; if (!seen.has(k) && (!valid || valid[k])) { seen.add(k); out.push(k); }
    }
  }
  return out;
}

/** Piecewise-linear series [[t, v], …] (t in s): value at t, and the exact mean over [t0, t1]. */
export function series(rows) {
  const at = (t) => {
    if (t <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) if (t <= rows[i][0]) { const [ta, va] = rows[i - 1], [tb, vb] = rows[i]; return va + (vb - va) * (t - ta) / (tb - ta); }
    return rows[rows.length - 1][1];
  };
  const mean = (t0, t1) => { // trapezoid on the breakpoints inside [t0, t1]: exact for piecewise-linear data
    const ts = [t0, ...rows.map(r => r[0]).filter(t => t > t0 && t < t1), t1]; let s = 0;
    for (let i = 1; i < ts.length; i++) s += (at(ts[i - 1]) + at(ts[i])) / 2 * (ts[i] - ts[i - 1]);
    return s / (t1 - t0);
  };
  return { at, mean, rows };
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Run a case on the GPU solver.
 * c: { nx, ny, dx, x0, y0, z, mask, manning, bc, h0(x, y, z) → depth, inflows: [{ cells, q: series }],
 *      stage: { cells, wl: series }, tEnd, outDt, chunk, probes: [{ id, x, y }], maps: [t…] }
 */
export async function runCase(device, GPUSolver, c, log = () => {}) {
  const inflows = c.inflows ?? [], inletCells = c.linkCells ?? inflows.flatMap(f => f.cells);
  const solver = new GPUSolver(device, {
    nx: c.nx, ny: c.ny, dx: c.dx, z: c.z, mask: c.mask, manning: c.manning, bc: c.bc, limiter: c.limiter,
    inlets: inletCells.length ? inletCells : undefined, stageCells: c.stage?.cells, hdry: c.hdry ?? 1e-5, hfront: c.hfront ?? 1e-3, dtDry: c.dtDry ?? 1,
  });
  await solver.ready;
  solver.setDepth(c.h0 ? (x, y, z) => c.h0(c.x0 + x, c.y0 + y, z) : () => 0);
  const link = c.couple ? await c.couple(solver) : null; // 1D model exchanging through the inlet cells
  const pk = c.probes.map(p => {
    const i = Math.floor((p.x - c.x0) / c.dx), j = Math.floor((p.y - c.y0) / c.dx);
    return { ...p, k: j * c.nx + i, zb: c.z[j * c.nx + i], t: [], h: [], wl: [], v: [] };
  });
  const record = (s, t) => {
    for (const p of pk) {
      const h = s.h[p.k], sp = h > 1e-3 ? Math.hypot(s.hu[p.k], s.hv[p.k]) / h : 0;
      p.t.push(r4(t)); p.h.push(r4(h)); p.wl.push(h > 1e-4 ? r4(p.zb + h) : null); p.v.push(r4(sp));
    }
  };
  const maps = [], mapTimes = [...(c.maps ?? [])];
  const t0w = performance.now(), chunk = c.chunk ?? c.outDt;
  let s = await solver.readState(); record(s, 0); link?.record(0);
  let inflowVol = 0, nextOut = c.outDt, lastLog = 0;
  for (let t = 0; t < c.tEnd - 1e-9;) {
    const t1 = Math.min(c.tEnd, t + chunk, nextOut, mapTimes[0] ?? Infinity, link?.cp.tNext ?? Infinity);
    if (inflows.length) {
      const q = new Float32Array(inletCells.length); let o = 0;
      for (const f of inflows) { const Q = f.q.mean(t, t1); for (let m = 0; m < f.cells.length; m++) q[o++] = -Q / f.cells.length; inflowVol += Q * (t1 - t); }
      solver.setInletRates(q);
    }
    if (c.stage) solver.setStage(c.stage.wl.mean(t, t1));
    await solver.advance(t1, c.K ?? 64);
    t = t1;
    if (inflows.length) await solver.readInlets();
    if (link && t >= link.cp.tNext - 1e-9) await link.cp.exchange();
    const isOut = t >= nextOut - 1e-9, isMap = mapTimes.length && t >= mapTimes[0] - 1e-9;
    if (isOut || isMap) s = await solver.readState();
    if (isOut) { record(s, t); link?.record(t); nextOut += c.outDt; }
    if (isMap) {
      mapTimes.shift();
      maps.push({ t, h: Array.from(s.h, r4), v: Array.from(s.h, (h, k) => (h > 1e-3 ? r4(Math.hypot(s.hu[k], s.hv[k]) / h) : 0)) });
    }
    if (performance.now() - lastLog > 5000) { lastLog = performance.now(); log(`  t=${t.toFixed(0)} s of ${c.tEnd}`); }
  }
  s = await solver.readState();
  const res = {
    grid: { nx: c.nx, ny: c.ny, dx: c.dx, x0: c.x0, y0: c.y0, cells: c.mask ? c.mask.reduce((a, b) => a + b, 0) : c.nx * c.ny },
    steps: solver.steps, wallSeconds: (performance.now() - t0w) / 1000, tiled: solver.tiled,
    mass: { ...s.mass, inflowVolume: inflowVol }, finalVolume: s.mass.volume,
    probes: pk.map(({ k, ...p }) => p), maps, info: c.info, coupled: link?.finish(),
    hmax: Array.from(s.hmax, r4), hFinal: Array.from(s.h, r4), z: Array.from(c.z, r4), mask: c.mask ? Array.from(c.mask) : null,
  };
  solver.destroy();
  return res;
}
