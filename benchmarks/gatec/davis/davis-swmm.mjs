// Davis pipe network (from model.json) as an EPA SWMM model and the network object the FloodSim coupler expects.
//   junctions   every HEC-RAS pipe node; nodes with a top inlet exchange with the surface, the others are sealed
//               (they pressurise instead of flooding, as HEC-RAS treats a junction without an inlet)
//   conduits    circular, HEC-RAS n, offsets and entrance / exit loss coefficients
//   pump        HEC-RAS head–flow curve, on / off on the wet-well water surface, discharging to an outfall whose stage
//               is the downstream channel's water level (a series from HEC-RAS, or fixed)
const G = 9.81;
const pad = (s, w) => String(s).padEnd(w), f3 = (v) => v.toFixed(3);

/** The surface cells of the inlet nodes, moved off any cell another inlet already uses (exchange cells are unique). */
export function inletCells(model) {
  const { nx, ny } = model.grid, used = new Set(), out = new Map();
  for (const n of model.nodes) {
    if (!n.inlet || n.cell < 0) continue;
    let k = n.cell;
    if (used.has(k) || !model.mask[k]) {
      const i0 = k % nx, j0 = (k / nx) | 0; let best = -1, bd = Infinity;
      for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) {
        const kk = j * nx + i; if (i < 0 || j < 0 || i >= nx || j >= ny || used.has(kk) || !model.mask[kk]) continue;
        const d = Math.hypot(i - i0, j - j0); if (d < bd) { bd = d; best = kk; }
      }
      k = best;
    }
    if (k >= 0) { used.add(k); out.set(n.name, k); }
  }
  return out;
}

/** Network object for src/coupler.js: nodes, pipes (= conduits, same order as the .inp), inlets, inlet hydraulics. */
export function couplerNet(model) {
  const cells = inletCells(model), idx = new Map(model.nodes.map((n, i) => [n.name, i]));
  const t = model.inletTypes['Top Inlet 1'];
  return {
    nodes: [...model.nodes.map(n => ({ name: n.name, invert: n.invert, ground: n.ground, depth: n.depth })), { name: 'DS_CHANNEL', invert: model.pump.outfallInvert, ground: model.pump.outfallInvert, outfall: true }],
    pipes: model.conduits.map(c => ({ name: c.name })),
    inlets: model.nodes.filter(n => cells.has(n.name)).map(n => ({ node: idx.get(n.name), cell: cells.get(n.name), grates: 1 })),
    // HEC-RAS top inlet: Q = C·L·H^1.5 (US C 3.3 → SI ×0.5521) as a weir, Cd·A·√(2gH) as an orifice; the coupler's
    // weir is Cw·P·h^1.5·√(2g), so Cw = C_SI / √(2g)
    opts: { inletArea: t.area, inletPerim: t.weirLength, Cw: t.weirCoefUS * 0.552 / Math.sqrt(2 * G), Co: t.Co },
  };
}

/** SWMM .inp. dsStage: [[t s, water level m]] for the downstream channel, or a number (fixed). */
export function davisINP(model, { dsStage, routingStep = 1, pressurise = false } = {}) {
  const L = [], net = couplerNet(model), inletNodes = new Set(net.inlets.map(i => net.nodes[i.node].name));
  const end = model.durationS, hms = (s) => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:00`;
  L.push('[TITLE]', 'HEC-RAS Davis storm sewer (FloodSim translation)', '', '[OPTIONS]', 'FLOW_UNITS CMS', 'INFILTRATION HORTON', 'FLOW_ROUTING DYNWAVE',
    'LINK_OFFSETS DEPTH', 'ALLOW_PONDING NO', 'START_DATE 01/01/2000', 'START_TIME 00:00:00', 'REPORT_START_DATE 01/01/2000', 'REPORT_START_TIME 00:00:00',
    `END_DATE 01/${String(1 + Math.floor(end / 86400)).padStart(2, '0')}/2000`, `END_TIME ${hms(end)}`, 'REPORT_STEP 00:10:00', 'WET_STEP 00:01:00', 'DRY_STEP 00:01:00',
    `ROUTING_STEP ${routingStep}`, 'VARIABLE_STEP 0.75', `LENGTHENING_STEP ${routingStep}`, 'MIN_SURFAREA ' + f3(model.nodes[0].baseArea),
    'NORMAL_FLOW_LIMITED BOTH', 'INERTIAL_DAMPING PARTIAL', 'SURCHARGE_METHOD SLOT', 'MAX_TRIALS 8', 'HEAD_TOLERANCE 0.0015', 'THREADS 1', '');
  L.push('[JUNCTIONS]', ';;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded');
  for (const n of model.nodes) L.push(`${pad(n.name, 16)} ${pad(f3(n.invert), 10)} ${pad(f3(n.depth), 10)} 0          ${pad(inletNodes.has(n.name) && !pressurise ? 0 : 30, 10)} 0`);
  const stageType = Array.isArray(dsStage) ? 'TIMESERIES DS_STAGE' : `FIXED ${f3(dsStage ?? model.pump.outfallInvert)}`;
  L.push('', '[OUTFALLS]', ';;Name           Elevation  Type       Stage Data       Gated', `${pad('DS_CHANNEL', 16)} ${pad(f3(model.pump.outfallInvert), 10)} ${stageType} NO`);
  L.push('', '[CONDUITS]', ';;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow');
  for (const c of model.conduits) L.push(`${pad(c.name, 16)} ${pad(c.from, 16)} ${pad(c.to, 16)} ${pad(f3(c.length), 10)} ${pad(c.n.toFixed(4), 10)} ${pad(f3(c.inOffset), 10)} ${pad(f3(c.outOffset), 10)} 0          0`);
  const ps = model.pump, wet = model.nodes.find(n => n.name === ps.from);
  L.push('', '[PUMPS]', ';;Name           From Node        To Node          Pump Curve       Status   Sartup Shutoff',
    `${pad('PUMP1', 16)} ${pad(ps.from, 16)} ${pad('DS_CHANNEL', 16)} ${pad('PUMP_HQ', 16)} OFF      ${f3(ps.onWSE - wet.invert)} ${f3(ps.offWSE - wet.invert)}`);
  L.push('', '[XSECTIONS]', ';;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels');
  for (const c of model.conduits) L.push(`${pad(c.name, 16)} ${pad(c.shape === 'Circular' ? 'CIRCULAR' : 'RECT_CLOSED', 12)} ${pad(f3(c.rise), 16)} ${pad(f3(c.shape === 'Circular' ? 0 : c.span), 10)} 0          0          1`);
  L.push('', '[LOSSES]', ';;Link           Kentry     Kexit      Kavg       Flap Gate');
  for (const c of model.conduits) L.push(`${pad(c.name, 16)} ${pad(c.kEntry.toFixed(3), 10)} ${pad(c.kExit.toFixed(3), 10)} 0          NO`);
  // pump curve: flow against the head it lifts (downstream channel level − wet-well level)
  L.push('', '[CURVES]', ';;Name           Type       X-Value    Y-Value');
  ps.headFlow.forEach(([h, q], i) => L.push(`${pad('PUMP_HQ', 16)} ${i ? '          ' : 'Pump3     '} ${pad(f3(h), 10)} ${q.toFixed(4)}`));
  if (Array.isArray(dsStage)) { L.push('', '[TIMESERIES]', ';;Name           Date       Time       Value'); for (const [t, z] of dsStage) L.push(`${pad('DS_STAGE', 16)}            ${pad((t / 3600).toFixed(4), 10)} ${f3(z)}`); }
  L.push('', '[REPORT]', 'INPUT NO', 'CONTROLS NO', 'SUBCATCHMENTS NONE', 'NODES NONE', 'LINKS NONE', '');
  return L.join('\n');
}
