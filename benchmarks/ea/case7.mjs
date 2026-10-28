// EA Test 7: River Severn at Upton-upon-Severn. 1D river (SWMM, 42 surveyed sections) linked to three 2D floodplains by
// weirs along the bank breaklines, a 10 m opening (invert 10 m) at M030 and the Pool Brook culvert (D 5 m); the A4104
// causeway is burned in with a 40 m opening at 11.4 m. A floodplain is its bank breakline closed by its outer boundary;
// everywhere else the river has glass walls.
import { parseASC, parseCSV, parseShp } from './lib.mjs';
import { test7River } from './test7-river.mjs';
import { riverINP, RiverCoupler } from '../../src/river.js';
import { insideRing } from '../../src/geo.js';

const breaklines = (txt) => {
  const out = []; let cur = null;
  for (const r of txt.split(/\r?\n/).slice(1)) { const f = r.split(','); if (f[0]) { cur = { name: f[0], pts: [] }; out.push(cur); } else if (f[1]) cur.pts.push([+f[1], +f[2], +f[3]]); }
  return out;
};
/** Points every `ds` m along a 3D polyline: [x, y, z]. */
const along = (pts, ds) => {
  const out = [];
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s], b = pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ds));
    for (let q = 0; q < n; q++) out.push(a.map((v, i) => v + (b[i] - v) * q / n));
  }
  out.push(pts[pts.length - 1]); return out;
};
/** Position of (x, y) along the river centreline through the section points: segment i0 → i1 and weight w. */
function onRiver(sections, x, y) {
  let best = { d: Infinity };
  for (let i = 0; i + 1 < sections.length; i++) {
    const a = sections[i], b = sections[i + 1], vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
    const w = Math.min(1, Math.max(0, ((x - a.x) * vx + (y - a.y) * vy) / L2)), d = Math.hypot(a.x + w * vx - x, a.y + w * vy - y);
    if (d < best.d) best = { d, i0: i, i1: i + 1, w };
  }
  return best;
}
const continuity = (rpt) => Number(((rpt.split('Flow Routing Continuity')[1] ?? '').split('Highest Continuity Errors')[0]).match(/Continuity Error \(%\)[ .]+(-?[\d.]+)/)?.[1] ?? NaN);

export async function case7(L, { loadSWMM }) {
  const dir = 'Test7_dataset_2010/', dem = parseASC(await L.text(dir + 'Test7DEM_10m.asc'));
  const banks = breaklines(await L.text(dir + 'Test7-Bank-bklines.csv')), fpl = breaklines(await L.text(dir + 'Test7-FP-bklines.csv'));
  const outer = parseShp(await L.bin(dir + 'Test7-FP-OuterBoundaries_polyline.shp'));
  const polys = banks.map((b, i) => [...b.pts.map(p => [p[0], p[1]]), ...[...outer[i]].reverse()]); // FP1–3
  const g = { x0: 384000, y0: 237000, dx: 20, nx: 150, ny: 400 }, N = g.nx * g.ny;
  const fpOf = (x, y) => polys.findIndex(r => insideRing(x, y, r)); // which floodplain, −1 if none
  // bed: mean of the 10 m DEM samples inside the same floodplain, so channel samples never leak into bank cells
  const sum = new Float64Array(N), cnt = new Uint32Array(N), fp = new Int8Array(N).fill(-1);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) fp[j * g.nx + i] = fpOf(g.x0 + (i + 0.5) * g.dx, g.y0 + (j + 0.5) * g.dx);
  for (let r = 0; r < dem.ny; r++) for (let c = 0; c < dem.nx; c++) {
    const v = dem.z[r * dem.nx + c]; if (v === dem.nodata) continue;
    const x = dem.x0 + (c + 0.5) * dem.dx, y = dem.y0 + (r + 0.5) * dem.dx, i = Math.floor((x - g.x0) / g.dx), j = Math.floor((y - g.y0) / g.dx);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
    const k = j * g.nx + i; if (fp[k] < 0 || fpOf(x, y) !== fp[k]) continue;
    sum[k] += v; cnt[k]++;
  }
  const z = new Float64Array(N), mask = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (fp[k] >= 0 && cnt[k]) { z[k] = sum[k] / cnt[k]; mask[k] = 1; }
  const cellAt = (x, y) => { const i = Math.floor((x - g.x0) / g.dx), j = Math.floor((y - g.y0) / g.dx); return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i; };
  // embankments and elevated roads: crest elevations burned into the cells they cross. FP breakline 2 closes FP1
  // against the river near M030, so it is a link rather than a burn. The A4104 bridge is a 40 m opening at 11.4 m.
  const BRIDGE = [384917, 240084], burned = new Set();
  fpl.forEach((b, bi) => {
    if (bi === 1) return;
    for (const [x, y, zc] of along(b.pts, 2)) { const k = cellAt(x, y); if (k >= 0 && mask[k]) { z[k] = Math.max(z[k], zc); burned.add(k); } }
  });
  for (const [x, y] of along(fpl[6].pts, 2)) if (Math.hypot(x - BRIDGE[0], y - BRIDGE[1]) <= 20) { const k = cellAt(x, y); if (k >= 0 && mask[k]) z[k] = 11.4; }
  // river, and the links between it and floodplain cells
  const river = await test7River(L.text);
  const nearestCell = (x, y, f, rmax = 30) => {
    let best = -1, bd = Infinity; const i0 = Math.floor((x - g.x0) / g.dx), j0 = Math.floor((y - g.y0) / g.dx);
    for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
      const k = j * g.nx + i; if (!mask[k] || fp[k] !== f || burned.has(k)) continue;
      const d = Math.hypot(g.x0 + (i + 0.5) * g.dx - x, g.y0 + (j + 0.5) * g.dx - y); if (d < bd && d <= rmax) { bd = d; best = k; }
    }
    return best;
  };
  const byCell = new Map();
  const addWeir = (k, l) => {
    const e = byCell.get(k);
    if (!e) { byCell.set(k, { cell: k, ...l }); return; }
    if (e.type !== 'weir' || e.name) return;
    e.crest = (e.crest * e.L + l.crest * l.L) / (e.L + l.L); e.w = e.i0 === l.i0 ? (e.w * e.L + l.w * l.L) / (e.L + l.L) : e.w; e.L += l.L;
  };
  for (const [b, f] of [[banks[0], 0], [banks[1], 1], [banks[2], 2], [{ pts: fpl[1].pts }, 0]]) {
    const pts = along(b.pts, 5);
    for (let s = 0; s + 1 < pts.length; s++) {
      const [x, y, zc] = pts[s].map((v, i) => (v + pts[s + 1][i]) / 2), ds = Math.hypot(pts[s + 1][0] - pts[s][0], pts[s + 1][1] - pts[s][1]);
      const k = nearestCell(x, y, f); if (k < 0) continue;
      const r = onRiver(river.sections, x, y); addWeir(k, { type: 'weir', crest: zc, L: ds, i0: r.i0, i1: r.i1, w: r.w });
    }
  }
  const structure = (x, y, f, l) => {
    const k = nearestCell(x, y, f, 45), r = onRiver(river.sections, x, y);
    if (k < 0) throw new Error(`no floodplain cell near ${l.name}`);
    byCell.set(k, { cell: k, ...l, i0: r.i0, i1: r.i1, w: r.w }); // replaces any bank weir on that cell
  };
  structure(384606, 242489, 0, { type: 'weir', crest: 10, L: 10, name: 'M030 opening' });
  structure(384900, 240893, 2, { type: 'culvert', inv: 6.25, D: 5, len: 10, n: 0.015, name: 'Pool Brook culvert' });
  const links = [...byCell.values()];
  const tEnd = 72 * 3600, nodeNames = river.sections.map(s => s.name), watch = ['M015', 'M025', 'M035', 'M045'];
  return {
    ...g, z, mask, manning: 0.04, bc: { west: 'wall', east: 'wall', south: 'wall', north: 'wall' },
    h0: (x, y, zz) => Math.max(0, 9.8 - zz), tEnd, outDt: 60, linkCells: links.map(l => l.cell),
    probes: parseCSV(await L.text(dir + 'Test7-Output.csv')).map(([id, x, y]) => ({ id: String(id), x, y })),
    info: { links: links.length, bankLength: Math.round(links.reduce((a, l) => a + (l.type === 'weir' ? l.L : 0), 0)), cells: mask.reduce((a, b) => a + b, 0) },
    couple: async (solver) => {
      const swmm = await loadSWMM();
      swmm.open(riverINP(river.sections, { ...river, durationS: tEnd + 3600, wallTop: 25, routingStep: 2 }));
      const cp = new RiverCoupler(solver, swmm, nodeNames, links, z, { interval: 10, cellArea: g.dx * g.dx });
      const wi = watch.map(n => [n, swmm.index('NODE', n), swmm.index('LINK', 'R_' + n)]);
      const series = Object.fromEntries(watch.map(n => [n, { t: [], wl: [], v: [] }]));
      return {
        cp,
        record: (t) => { for (const [n, i, li] of wi) { const s = series[n]; s.t.push(t); s.wl.push(+swmm.node('HEAD', i).toFixed(4)); s.v.push(+Math.abs(swmm.link('VELOCITY', li)).toFixed(4)); } },
        finish: () => ({ river: series, totals: cp.totals, swmmContinuityPct: continuity(swmm.finish()) }),
      };
    },
  };
}
