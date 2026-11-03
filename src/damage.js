// Flood damage to buildings, expected annual damage and benefit–cost.
//
//   structures  the USACE National Structure Inventory (NSI): per structure its occupancy type, foundation type and
//               height above ground, values of the structure and its contents, people by day and night
//   exposure    a structure's water is the peak level against its walls: buildings are walls in the model, so the level
//               is the highest peak water surface on the open cells next to the building footprint the NSI point falls
//               in (front and back of a rowhouse, not its neighbours), counting only cells where the water stood at
//               least `minDepth` deep (default 10 cm: the sheet flow of rain on pavement does not fill a basement),
//               and only water that is part of a flooded patch reaching a street or larger than 200 m² (`openWater`):
//               rain ponding in an enclosed yard or light well has a yard drain in reality that the model lacks
//               Ground = the median lidar ground of those cells; first floor = ground + the NSI foundation height.
//               Depth above the first floor = level − first floor
//   damage      USACE depth–damage functions per occupancy type (src/damage-curves.js, from USACE go-consequences: EGM
//               01-03 / 04-01 for single-family homes, HEC-FIA for the rest), % of value at the depth above the first
//               floor, linear between the tabulated feet; their standard deviations give a low / high band (mean ± 1.28
//               sd, the 10th and 90th percentiles of each curve, taken together, so the band is wide on purpose)
//   EAD         damage over annual exceedance probability, trapezoids between the storms run (see `ead`)
//   BCA         the present value of the EAD a project avoids over the period of analysis against its cost
// Pure functions: the caller fetches the NSI (`nsiUrl`) and passes the grids.
import { CURVES } from './damage-curves.js';
import { fillRings } from './terrain.js';

const FT = 0.3048;
export const NSI_HOST = 'nsi.sec.usace.army.mil';
/** The NSI structures query for a lon/lat box (GeoJSON FeatureCollection). */
export const nsiUrl = ([w, s, e, n]) => `https://${NSI_HOST}/nsiapi/structures?bbox=${[w, s, e, s, e, n, w, n, w, s].map(v => v.toFixed(6)).join(',')}&fmt=fc`;

/** NSI features → structures (values in $, foundation height in m). */
export function parseNSI(fc) {
  return (fc?.features ?? []).filter(f => f.geometry?.type === 'Point').map((f) => {
    const p = f.properties ?? {};
    return {
      id: String(p.fd_id ?? p.bid ?? ''), lonlat: f.geometry.coordinates.slice(0, 2), occtype: p.occtype ?? '', damcat: p.st_damcat ?? '', foundType: p.found_type ?? '',
      foundHt: Number.isFinite(p.found_ht) ? p.found_ht * FT : null, stories: p.num_story ?? null, sqft: p.sqft ?? null, footprintSqft: p.ftprntsqft ?? null,
      valStruct: p.val_struct ?? 0, valCont: p.val_cont ?? 0, valVehic: p.val_vehic ?? 0, built: p.med_yr_blt ?? null, firmZone: p.firmzone ?? null,
      peopleNight: (p.pop2amu65 ?? 0) + (p.pop2amo65 ?? 0), peopleDay: (p.pop2pmu65 ?? 0) + (p.pop2pmo65 ?? 0), over65Night: p.pop2amo65 ?? 0,
    };
  });
}

/** The depth–damage functions for an NSI occupancy type: exact, else without its suffix, else a family default. */
export function curveFor(occtype) {
  const t = String(occtype ?? '').toUpperCase();
  if (CURVES[t]) return { key: t, ...CURVES[t] };
  const base = t.split('-')[0], fam = { RES1: 'RES1-1SNB', RES3: 'RES3A', COM: 'COM1', IND: 'IND1', GOV: 'GOV1', EDU: 'EDU1', REL: 'REL1', AGR: 'AGR1' };
  const k = CURVES[base] ? base : fam[base] ?? fam[base.replace(/\d+$/, '')] ?? fam[base.slice(0, 3)] ?? 'RES1-1SNB';
  return { key: k, fallback: true, ...CURVES[k] };
}
/** % damage (mean, sd) at a depth above the first floor (ft): linear between the tabulated depths, 0 below the first,
 *  held at the last above it. */
export function pctAt(fn, ft) {
  const { x, mean, sd } = fn; if (!(ft >= x[0])) return { mean: 0, sd: 0 };
  if (ft >= x.at(-1)) return { mean: mean.at(-1), sd: sd.at(-1) };
  let i = 0; while (x[i + 1] < ft) i++;
  const w = (ft - x[i]) / (x[i + 1] - x[i]);
  return { mean: mean[i] + w * (mean[i + 1] - mean[i]), sd: sd[i] + w * (sd[i + 1] - sd[i]) };
}

/**
 * An index of building footprints on the grid: each footprint's id on its cells, so a structure point finds its own
 * footprint. footprints: [[ring of [x, y] fractional cell coords]] (the OSM rings, src/ingest.js toCells).
 */
export function footprintIndex(footprints, nx, ny) {
  const id = new Int32Array(nx * ny).fill(-1), cells = footprints.map(() => []);
  footprints.forEach((rings, f) => fillRings(rings, nx, ny, (k) => { id[k] = f; cells[f].push(k); }));
  return { id, cells };
}

/**
 * Which water counts against buildings: cells at least minDepth deep in a connected patch (4-connected, buildings
 * excluded) that touches a road cell or is at least minArea m². → { mask: Uint8Array (1 counts), enclosed: { cells,
 * patches } } (the rest: ponds in enclosed yards and light wells, reported, not counted)
 */
export function openWater(maxDepth, { nx, ny, dx = 1, bld, road, minDepth = 0.10, minArea = 200 }) {
  const N = nx * ny, mask = new Uint8Array(N), seen = new Uint8Array(N), stack = new Int32Array(N), wet = (k) => maxDepth[k] >= minDepth && !bld?.[k];
  let cells = 0, patches = 0;
  for (let s = 0; s < N; s++) {
    if (seen[s] || !wet(s)) continue;
    const comp = []; let sp = 0, onRoad = false; stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const k = stack[--sp]; comp.push(k); if (road?.[k]) onRoad = true;
      const i = k % nx;
      for (const q of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (q >= 0 && q < N && !seen[q] && wet(q)) { seen[q] = 1; stack[sp++] = q; }
    }
    if (onRoad || comp.length * dx * dx >= minArea) for (const k of comp) mask[k] = 1; else { cells += comp.length; patches++; }
  }
  return { mask, enclosed: { cells, patches, area: cells * dx * dx } };
}

/**
 * Peak water against each structure. → per structure { level, ground, ffe, depthFF (m above the first floor, or null
 * when no water reached it), wetCells, how }.
 * g: { nx, ny, dx, z (ground), bld (building mask), maxWse, maxDepth }; at: structure → [x, y] cell coords;
 * fp: footprintIndex (optional); ring: cells outward from the footprint that count as next to it (default 2);
 * minDepth: the least peak depth (m) on a cell for its water to count against the building (default 0.10);
 * counts: Uint8Array, 1 where water may count (openWater's mask; default all).
 */
export function exposure(structures, g, at, { fp = null, ring = 2, minDepth = 0.10, radius = 5, counts = null } = {}) {
  const { nx, ny, z, bld, maxWse, maxDepth } = g;
  const near = new Map(); // footprint → the open cells next to it
  const ringOf = (f) => {
    if (near.has(f)) return near.get(f);
    const out = new Set();
    for (const k of fp.cells[f]) {
      const i = k % nx, j = (k - i) / nx;
      for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a; if (!bld[q] && fp.id[q] !== f) out.add(q);
      }
    }
    const r = [...out]; near.set(f, r); return r;
  };
  return structures.map((s) => {
    const [x, y] = at(s), i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return { level: null, ground: null, ffe: null, depthFF: null, wetCells: 0, how: 'outside the model' };
    let cells = null, how = 'footprint';
    if (fp) { // the footprint at the point, else one within a cell or two (NSI points sit near the centroid)
      let f = fp.id[j * nx + i];
      for (let r = 1; f < 0 && r <= 3; r++) for (let dj = -r; dj <= r && f < 0; dj++) for (let di = -r; di <= r && f < 0; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny) f = fp.id[b * nx + a]; }
      if (f >= 0) cells = ringOf(f);
    }
    if (!cells?.length) { // no footprint: the open cells within `radius` cells of the point
      how = 'point'; cells = [];
      for (let dj = -radius; dj <= radius; dj++) for (let di = -radius; di <= radius; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && di * di + dj * dj <= radius * radius && !bld[b * nx + a]) cells.push(b * nx + a); }
    }
    if (!cells.length) return { level: null, ground: null, ffe: null, depthFF: null, wetCells: 0, how };
    const zs = cells.map(k => z[k]).filter(Number.isFinite).sort((p, q) => p - q), ground = zs.length ? zs[zs.length >> 1] : null;
    let level = -Infinity, wet = 0;
    for (const k of cells) if (maxDepth[k] >= minDepth && Number.isFinite(maxWse[k]) && (!counts || counts[k])) { wet++; if (maxWse[k] > level) level = maxWse[k]; }
    const ffe = ground == null ? null : ground + (s.foundHt ?? 0.3);
    return { level: wet ? level : null, ground, ffe, depthFF: wet && ffe != null ? level - ffe : null, wetCells: wet, how };
  });
}

/**
 * Damage per structure from its exposure. → { rows: [{ ...structure, ...exposure, depthFt, pctS, pctC, struct, cont,
 * total, low, high, curve }], totals: { struct, cont, total, low, high, flooded, wet, aboveFloor, people, byCat } }
 * A structure is "wet" when water reached its walls, "flooded" when it has damage (water above the curve's first
 * depth, which is below the first floor for homes with basements), "above the floor" when the water is over the floor.
 */
export function damages(structures, expo, { z = 1.2816 } = {}) {
  const rows = [], T = { struct: 0, cont: 0, total: 0, low: 0, high: 0, flooded: 0, wet: 0, aboveFloor: 0, people: { night: 0, day: 0 }, byCat: {} };
  structures.forEach((s, n) => {
    const e = expo[n], c = curveFor(s.occtype), ft = e.depthFF == null ? null : e.depthFF / FT;
    const pS = ft == null ? { mean: 0, sd: 0 } : pctAt(c.structure, ft), pC = ft == null || !c.contents ? { mean: 0, sd: 0 } : pctAt(c.contents, ft);
    const clamp = (v) => Math.min(100, Math.max(0, v));
    const struct = s.valStruct * pS.mean / 100, cont = s.valCont * pC.mean / 100;
    const low = s.valStruct * clamp(pS.mean - z * pS.sd) / 100 + s.valCont * clamp(pC.mean - z * pC.sd) / 100;
    const high = s.valStruct * clamp(pS.mean + z * pS.sd) / 100 + s.valCont * clamp(pC.mean + z * pC.sd) / 100;
    const total = struct + cont;
    rows.push({ ...s, ...e, depthFt: ft, pctS: pS.mean, pctC: pC.mean, struct, cont, total, low, high, curve: c.key, curveFallback: !!c.fallback });
    if (e.depthFF != null) T.wet++;
    if (total > 0) T.flooded++;
    if (e.depthFF > 0) { T.aboveFloor++; T.people.night += s.peopleNight; T.people.day += s.peopleDay; }
    T.struct += struct; T.cont += cont; T.total += total; T.low += low; T.high += high;
    const cat = (T.byCat[s.damcat || '?'] ??= { n: 0, flooded: 0, total: 0, value: 0 }); cat.n++; cat.value += s.valStruct + s.valCont; cat.total += total; if (total > 0) cat.flooded++;
  });
  return { rows, totals: T };
}

/**
 * Expected annual damage: ∫ damage d(AEP) over the storms run. points: [{ aep (1/T for a T-yr storm), damage }].
 * Trapezoids between the points; beyond the rarest storm the damage is held at its value out to AEP 0 (a floor on the
 * tail, no extrapolation); on the frequent side the damage falls linearly to zero at AEP 1 unless the most frequent
 * storm already does no damage (then nothing is added), with a warning to run a more frequent storm.
 * → { ead, parts: { frequent, between, rare }, curve: [[aep, damage]], warnings }
 */
/** Annual exceedance probability of an Atlas 14 return period. Atlas 14's ARIs are partial-duration series (the mean time
 *  between exceedances, any number a year), so AEP = 1 − exp(−1/ARI): 0.39 for the 2-yr, 0.095 for the 10-yr, 0.01 for
 *  the 100-yr. 1/ARI, the annual-maximum reading, overstates the frequent storms (0.50 for the 2-yr) and so the EAD. */
export const aepOfPds = (ari) => 1 - Math.exp(-1 / ari);
export function ead(points) {
  const P = [...points].filter(p => p.aep > 0 && p.aep < 1 && Number.isFinite(p.damage)).sort((a, b) => b.aep - a.aep); // frequent → rare
  const warnings = [];
  if (P.length < 2) return { ead: NaN, parts: null, curve: P.map(p => [p.aep, p.damage]), warnings: ['EAD needs at least two return periods of the same scenario and settings.'] };
  let between = 0;
  for (let i = 0; i + 1 < P.length; i++) between += 0.5 * (P[i].damage + P[i + 1].damage) * (P[i].aep - P[i + 1].aep);
  const f = P[0], r = P.at(-1);
  const frequent = f.damage > 0 ? 0.5 * f.damage * (1 - f.aep) : 0;
  if (f.damage > 0) warnings.push(`The most frequent storm run (${fmtT(1 / f.aep)}) already does damage: damage is assumed to fall linearly to zero at AEP 1. Run a more frequent storm to pin it.`);
  const rare = r.damage * r.aep;
  if (rare > 0.2 * (between + frequent + rare)) warnings.push(`Over 20 % of the EAD is the tail beyond the rarest storm run (${fmtT(1 / r.aep)}), held at its damage: run a rarer storm to narrow it.`);
  if (P.some((p, i) => i && p.damage + 1e-9 < P[i - 1].damage)) warnings.push('Damage falls as the storms get rarer somewhere: check those runs (settings, storm shape, a scenario mix-up).');
  return { ead: frequent + between + rare, parts: { frequent, between, rare }, curve: [[1, 0], ...P.map(p => [p.aep, p.damage])], warnings };
}
const fmtT = (t) => `${Math.round(t)}-yr`;

/** Present-value factor of 1 a year for `years` years at a real discount `rate` (fraction). */
export const pvFactor = (rate, years) => (rate > 0 ? (1 - (1 + rate) ** -years) / rate : years);
/**
 * Benefit–cost: benefits = EAD without − EAD with the project, every year of the period. → { annualBenefit, pvf,
 * pvBenefits, pvCosts, net, bcr }. cost: first cost ($); om: operation and maintenance ($ a year).
 */
export function bca({ eadWithout, eadWith, rate = 0.03, years = 50, cost = 0, om = 0 }) {
  const annualBenefit = eadWithout - eadWith, pvf = pvFactor(rate, years);
  const pvBenefits = annualBenefit * pvf, pvCosts = cost + om * pvf;
  return { annualBenefit, pvf, pvBenefits, pvCosts, net: pvBenefits - pvCosts, bcr: pvCosts > 0 ? pvBenefits / pvCosts : NaN };
}
