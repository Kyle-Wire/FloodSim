// 1D rivers and their links to the 2D surface (Phase 2).
//
// The river is an EPA SWMM dynamic-wave model built from surveyed cross-sections: one junction per section, one
// IRREGULAR conduit per reach (the upstream section's transect), an inflow hydrograph at the top and a rating curve at
// the bottom (an outlet whose flow is tabulated against depth). Sections are extended with vertical "glass walls" so
// the river can rise above its banks where no floodplain is modelled.
//
// The river exchanges water with surface cells through links, each a surface cell tied to a point along the river
// (between two sections, weight w):
//   weir     lateral overflow along a bank or embankment crest, or an opening with its own invert (Villemonte
//            submergence on the broad-crested weir formula)
//   culvert  a barrel between the river and a floodplain cell (inlet control part-full, barrel losses when full)
// Every interval the surface solver runs first with the link rates chosen at its start; the volume each link cell
// actually exchanged is then given to SWMM as lateral flow over the same interval, so both models book identical
// volumes. New rates come from the heads at the end of the interval.

const G = 9.81;

/** Cross-sections in the EA/ISIS text layout: "SECTION", name, a datum line, the point count, then rows starting
 *  chainage, elevation (further columns ignored). → [{ name, pts: [[station, z], …], xy: [[x, y], …] }] */
export function parseSections(text) {
  const t = text.split(/\r?\n/), out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].trim() !== 'SECTION') continue;
    const name = t[i + 1].trim(), n = Number(t[i + 3]), pts = [], xy = [];
    for (let k = 0; k < n; k++) {
      const f = t[i + 4 + k].trim().split(/\s+/).map(Number);
      pts.push([f[0], f[1]]); if (f.length >= 6) xy.push([f[f.length - 2], f[f.length - 1]]);
    }
    out.push({ name, pts, xy });
  }
  return out;
}

/**
 * SWMM .inp for a river reach.
 * @param sections  [{ name, pts: [[station, z]], dist: m to the next section, x, y }] upstream → downstream
 * @param o.inflow  [[t s, Q m³/s]] at the top section   @param o.rating [[Q, water level m]] at the bottom section
 * @param o.n       Manning's n   @param o.initWL initial water level (m)   @param o.wallTop glass-wall top (m)
 */
export function riverINP(sections, { inflow, rating, n = 0.03, initWL = null, durationS, routingStep = 2, wallTop = null, normalFlowLimited = 'BOTH', banks = true, title = 'FloodSim river' }) {
  const pad = (s, w) => String(s).padEnd(w), f3 = (v) => v.toFixed(3);
  const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const inv = sections.map(s => Math.min(...s.pts.map(p => p[1])));
  const top = wallTop ?? Math.max(...sections.flatMap(s => s.pts.map(p => p[1]))) + 5;
  const days = Math.floor(durationS / 86400), L = [];
  L.push('[TITLE]', title, '', '[OPTIONS]', 'FLOW_UNITS CMS', 'INFILTRATION HORTON', 'FLOW_ROUTING DYNWAVE', 'LINK_OFFSETS DEPTH',
    'ALLOW_PONDING NO', 'START_DATE 01/01/2000', 'START_TIME 00:00:00', 'REPORT_START_DATE 01/01/2000', 'REPORT_START_TIME 00:00:00',
    `END_DATE 01/${String(1 + days).padStart(2, '0')}/2000`, `END_TIME ${hms(durationS % 86400)}`, 'REPORT_STEP 00:15:00',
    'WET_STEP 00:01:00', 'DRY_STEP 00:01:00', `ROUTING_STEP ${routingStep}`, 'VARIABLE_STEP 0.75', 'LENGTHENING_STEP 0',
    'INERTIAL_DAMPING PARTIAL', `NORMAL_FLOW_LIMITED ${normalFlowLimited}`, 'MIN_SURFAREA 1.2', 'MAX_TRIALS 8', 'HEAD_TOLERANCE 0.0015', 'THREADS 1', '');
  // each reach is two half-conduits through a midpoint junction, each shaped like its nearer section: the reach's
  // conveyance then blends both ends, as 1D river codes do, instead of taking the upstream section throughout
  const last = sections.length - 1, mid = (i) => sections[i].name + '_m';
  const junction = (name, z) => L.push(`${pad(name, 16)} ${pad(f3(z), 10)} ${pad(f3(top - z), 10)} ${pad(f3(initWL == null ? 0 : Math.max(0, initWL - z)), 10)} 0          0`);
  L.push('[JUNCTIONS]', ';;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded');
  sections.forEach((s, i) => { junction(s.name, inv[i]); if (i < last) junction(mid(i), (inv[i] + inv[i + 1]) / 2); });
  L.push('', '[OUTFALLS]', ';;Name           Elevation  Type       Stage Data       Gated', `${pad('RIVER_OUT', 16)} ${pad(f3(inv[last] - 1), 10)} FREE                        NO`);
  L.push('', '[CONDUITS]', ';;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow');
  const conduit = (name, a, b, len) => L.push(`${pad(name, 16)} ${pad(a, 16)} ${pad(b, 16)} ${pad(f3(len), 10)} ${pad(n, 10)} 0          0          0          0`);
  for (let i = 0; i < last; i++) { conduit('R_' + sections[i].name, sections[i].name, mid(i), sections[i].dist / 2); conduit('R_' + sections[i].name + '_b', mid(i), sections[i + 1].name, sections[i].dist / 2); }
  // rating curve: flow tabulated against depth above the bottom section's invert
  L.push('', '[OUTLETS]', ';;Name           From Node        To Node          Offset     Type            QTable/Qcoeff    Qexpon     Gated',
    `${pad('RATING', 16)} ${pad(sections[last].name, 16)} ${pad('RIVER_OUT', 16)} 0          TABULAR/DEPTH   RATING_CURVE     NO`);
  L.push('', '[XSECTIONS]', ';;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels');
  const xsec = (name, t) => L.push(`${pad(name, 16)} IRREGULAR    ${pad('T_' + t, 16)} 0          0          0          1`);
  for (let i = 0; i < last; i++) { xsec('R_' + sections[i].name, sections[i].name); xsec('R_' + sections[i].name + '_b', sections[i + 1].name); }
  L.push('', '[TRANSECTS]'); // each transect opens with its own NC line: SWMM finalises the previous one there
  for (let i = 0; i <= last; i++) {
    const s = sections[i], pts = []; let prev = -Infinity;
    for (const [st, z] of s.pts) { const x = Math.max(st, prev + 0.001); pts.push([x, z]); prev = x; } // strictly increasing stations
    const [bl, br] = banks ? bankStations(pts) : [pts[0][0], pts[pts.length - 1][0]];
    pts.unshift([pts[0][0] - 0.001, top]); pts.push([pts[pts.length - 1][0] + 0.001, top]); // glass walls
    // SWMM splits conveyance at the bank stations only where the overbank n differs from the channel n
    const nb = banks ? +(n * (1 + 1e-6)).toPrecision(9) : n;
    L.push(`NC ${nb} ${nb} ${n}`, `X1 ${pad('T_' + s.name, 14)} ${pts.length} ${f3(bl)} ${f3(br)} 0 0 0 1 1 0`);
    for (let k = 0; k < pts.length; k += 5) L.push('GR ' + pts.slice(k, k + 5).map(([x, z]) => `${f3(z)} ${f3(x)}`).join('  '));
  }
  const rows = rating.map(([q, wl]) => [wl - inv[last], q]).filter(([d]) => d > 0).sort((a, b) => a[0] - b[0]);
  if (!rows.length || rows[0][0] > 1e-3) rows.unshift([0, 0]);
  L.push('', '[CURVES]', ';;Name           Type       X-Value    Y-Value');
  rows.forEach(([d, q], k) => L.push(`${pad('RATING_CURVE', 16)} ${k ? '          ' : 'Rating    '} ${pad(f3(d), 10)} ${q.toFixed(3)}`));
  L.push('', '[TIMESERIES]', ';;Name           Date       Time       Value');
  for (const [t, q] of inflow) L.push(`${pad('RIVER_IN', 16)}            ${pad((t / 3600).toFixed(4), 10)} ${q}`);
  L.push('', '[INFLOWS]', ';;Node           Constituent      Time Series      Type     Mfactor  Sfactor  Baseline Pattern',
    `${pad(sections[0].name, 16)} FLOW             RIVER_IN         FLOW     1.0      1.0`);
  L.push('', '[REPORT]', 'INPUT NO', 'CONTROLS NO', 'SUBCATCHMENTS NONE', 'NODES NONE', 'LINKS NONE', '', '[COORDINATES]', ';;Node           X-Coord            Y-Coord');
  sections.forEach(s => { if (s.x != null) L.push(`${pad(s.name, 16)} ${s.x.toFixed(2)} ${s.y.toFixed(2)}`); });
  L.push('');
  return L.join('\n');
}

/**
 * Bank stations of a surveyed section: where the bankfull level meets the ground either side of the thalweg. Bankfull
 * is the level at which the top width grows fastest (the break from channel to berm or floodplain), searched from
 * 1.5 m above the bed. SWMM then computes conveyance separately for the channel and each overbank instead of with one
 * lumped hydraulic radius, which understates the conveyance of shallow berms beside a deep channel.
 */
export function bankStations(pts) {
  const zmin = Math.min(...pts.map(p => p[1])), zmax = Math.min(pts[0][1], pts[pts.length - 1][1]);
  const width = (z) => { let w = 0; for (let k = 0; k + 1 < pts.length; k++) { const [x0, z0] = pts[k], [x1, z1] = pts[k + 1]; if (z0 <= z && z1 <= z) w += x1 - x0; else if (z0 <= z || z1 <= z) w += (x1 - x0) * (z - Math.min(z0, z1)) / Math.abs(z1 - z0); } return w; };
  let best = null, gain = 0;
  for (let z = zmin + 1.5; z < zmax - 0.2; z += 0.1) { const g = width(z + 0.3) - width(z); if (g > gain) { gain = g; best = z; } }
  if (best == null) return [pts[0][0], pts[pts.length - 1][0]];
  const t = pts.reduce((m, p, k) => (p[1] < pts[m][1] ? k : m), 0);
  let l = t; while (l > 0 && pts[l - 1][1] <= best) l--;
  let r = t; while (r < pts.length - 1 && pts[r + 1][1] <= best) r++;
  return [pts[Math.max(0, l - 1)][0], pts[Math.min(pts.length - 1, r + 1)][0]];
}

/** Broad-crested weir flow from level H1 to H2 (m³/s, negative = from 2 to 1), crest z, length L; Villemonte submergence. */
export function weirFlow(H1, H2, crest, L, Cw = 1.7) {
  const s = H1 >= H2 ? 1 : -1, up = Math.max(H1, H2), dn = Math.min(H1, H2), hu = up - crest;
  if (hu <= 0 || L <= 0) return 0;
  const r = Math.max(0, dn - crest) / hu;
  return s * Cw * L * hu ** 1.5 * Math.pow(Math.max(0, 1 - r ** 1.5), 0.385);
}

/** Wetted area of a circular barrel of diameter D at depth y. */
const circArea = (D, y) => { const yy = Math.min(Math.max(y, 0), D), th = 2 * Math.acos(1 - 2 * yy / D); return D * D / 8 * (th - Math.sin(th)); };

/**
 * Flow through a circular culvert from level H1 to H2 (m³/s, signed). The smaller of inlet control (critical flow at
 * 2/3 of the upstream head, area capped at the barrel) and barrel control (entrance + exit + friction losses on the
 * head difference, area at the mean of the end depths, full once either end is submerged).
 */
export function culvertFlow(H1, H2, { inv, D, len, n = 0.015, Ke = 0.5 }) {
  const s = H1 >= H2 ? 1 : -1, up = Math.max(H1, H2), dn = Math.min(H1, H2), hu = up - inv;
  if (hu <= 0) return 0;
  const yc = Math.min((2 / 3) * hu, D), inlet = circArea(D, yc) * Math.sqrt(2 * G * Math.max(0, hu - yc));
  const yd = Math.max(0, dn - inv), y = hu >= D || yd >= D ? D : Math.min(D, (hu + yd) / 2), A = circArea(D, y);
  const th = 2 * Math.acos(1 - 2 * Math.min(y, D * 0.9999) / D), R = y >= D ? D / 4 : A / (D * th / 2);
  const k = 1 + Ke + 2 * G * n * n * len / R ** (4 / 3);
  const barrel = A * Math.sqrt(2 * G * (up - Math.max(dn, inv)) / k);
  return s * Math.min(inlet, barrel);
}

/**
 * River ↔ surface exchange. links: [{ cell, type: 'weir' | 'culvert', crest, L (weir) | inv, D, len (culvert),
 * i0, i1, w }] — surface cell index, river point between sections i0 and i1 (weight w toward i1).
 * The solver must have been created with inlets = links.map(l => l.cell) (unique cells, same order).
 */
export class RiverCoupler {
  constructor(solver, swmm, nodeNames, links, zs, { interval = 10, cellArea } = {}) {
    Object.assign(this, { solver, swmm, links, interval });
    this.idx = nodeNames.map(n => swmm.index('NODE', n));
    if (this.idx.some(i => i < 0)) throw new Error('river node lookup failed');
    this.zs = links.map(l => zs[l.cell]);
    this.area = cellArea; this.q = new Float32Array(links.length);
    this.head = new Float64Array(nodeNames.length);
    this.tNext = interval;
    this.totals = { toRiver: 0, toSurface: 0 };
    this.flows = new Float64Array(links.length); // last rates (m³/s, + = surface → river)
  }

  /** River head at a link's position along the reach. */
  riverHead(l) { return (1 - l.w) * this.head[l.i0] + l.w * this.head[l.i1]; }

  get count() { return this.links.length; }

  /** Call when the surface solver has reached `this.tNext` (standalone; with other link models use a LinkHub). */
  async exchange() {
    const { vol, h } = await this.solver.readInlets();
    this.solver.setInletRates(this.step(vol, h, this.interval, this.tNext));
    this.tNext += this.interval;
  }

  /** Measured exchange over the interval ending at tNext → SWMM strides to tNext → rates for the next interval. */
  step(vol, h, interval, tNext) {
    const { swmm, links } = this;
    const lat = new Float64Array(this.idx.length);
    for (let m = 0; m < links.length; m++) {
      const v = vol[m], l = links[m]; if (v > 0) this.totals.toRiver += v; else this.totals.toSurface -= v;
      lat[l.i0] += (1 - l.w) * v / interval; lat[l.i1] += l.w * v / interval;
    }
    for (let i = 0; i < lat.length; i++) swmm.setLatFlow(this.idx[i], lat[i]);
    swmm.stepTo(tNext);
    for (let i = 0; i < this.idx.length; i++) this.head[i] = swmm.node('HEAD', this.idx[i]);
    for (let m = 0; m < links.length; m++) {
      const l = links[m], hs = h[m] > 1e-4 ? this.zs[m] + h[m] : this.zs[m], hr = this.riverHead(l);
      let Q = l.type === 'culvert' ? culvertFlow(hs, hr, l) : weirFlow(hs, hr, l.crest, l.L);
      // explicit exchange: never move more than half the level difference over one surface cell in one interval
      const cap = 0.5 * Math.abs(hs - hr) * this.area / interval; Q = Math.max(-cap, Math.min(cap, Q));
      if (Q > 0 && h[m] <= 1e-4) Q = 0;
      this.q[m] = Q; this.flows[m] = Q;
    }
    return this.q;
  }
}
