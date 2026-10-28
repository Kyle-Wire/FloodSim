// Gate C combined mass-balance audit: drives the map app (app/map.html) through complete runs with every exchange
// model switched on and checks that the books close across all of them:
//
//   rain on the surface + roof rain piped to the sewer
//     = infiltration (incl. GI stores) + surface edge outflow + polygon-edge outflow + pipe outfalls
//       + surface storage (incl. water inside culverts) + network storage (incl. tanks) + SWMM flooding not returned
//
// Load in the app tab:  const { runAudit } = await import('/benchmarks/gatec/mass-audit.js'); await runAudit();
// Results: benchmarks/gatec/results/gatec-mass-<id>.json

export const SCENARIOS = [
  { id: 'ellicott', name: 'Ellicott City MD, 2 m: pipes + 50% downspouts + 10 culverts + GI + green roofs + tanks', example: /Ellicott/, dx: 2,
    set: { downspout: 50, giPave: 50, giGarden: 10, giRoof: 50, giTank: 2000 } },
  { id: 'southstreet', name: 'South Street, Philadelphia, 1 m: real PWD inlets, synthetic pipes, 30% downspouts', example: /South Street/, dx: 1,
    set: { downspout: 30 } },
  { id: 'weho', name: 'West Hollywood CA, 2 m: tier 1 linked pipes + rain gardens', example: /West Hollywood/, dx: 2,
    set: { giGarden: 5 } },
  { id: 'seattle-poly', name: 'Seattle WA polygon, 2 m: sink edge, custom 1 h storm (no Atlas 14 here), permeable pavement', dx: 2, storm: 'const',
    poly: [[-122.3150, 47.6120], [-122.3100, 47.6118], [-122.3095, 47.6150], [-122.3125, 47.6160], [-122.3155, 47.6145]], set: { giPave: 30 } },
];

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(cond, ms, what) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out: ' + what); await wait(500); } }

/** One scenario through build → run → books. */
export async function audit(sc, log = console.log, { twoWay = false } = {}) {
  const app = window.__floodsim, { map } = app;
  if (sc.example) { const sel = $('exampleSel'); sel.value = [...sel.options].find(o => sc.example.test(o.textContent)).value; sel.dispatchEvent(new Event('change')); }
  if (sc.poly) {
    map.jumpTo({ center: sc.poly[0], zoom: 16 }); $('polyBtn').click();
    for (const p of sc.poly) map.fire('click', { lngLat: { lng: p[0], lat: p[1] }, point: map.project(p), originalEvent: {} });
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }
  $('dxSel').value = String(sc.dx); $('dxSel').dispatchEvent(new Event('change'));
  for (const id of ['downspout', 'giPave', 'giGarden', 'giRoof', 'giTank']) { $(id).value = sc.set?.[id] ?? 0; $(id).dispatchEvent(new Event('input')); }
  $('buildBtn').click();
  await wait(1000);
  await until(() => !$('runBtn').disabled || /failed/i.test($('log').textContent), 180000, 'build');
  if (/failed/i.test($('log').textContent)) throw new Error('build failed: ' + $('log').textContent);
  // the app keeps the storm choice between builds: set it every time (Atlas 14 design storm unless the scenario says)
  document.querySelector(`button[data-s="${sc.storm ?? 'a14'}"]`).click();
  $('twoWay').checked = twoWay;
  for (const id of ['downspout', 'giPave', 'giGarden', 'giRoof', 'giTank', 'twoWay']) $(id).dispatchEvent(new Event('change')); // reset with the settings applied
  $('speed').value = 100; $('speed').dispatchEvent(new Event('input'));
  const t0 = performance.now();
  $('runBtn').click();
  await until(() => $('runBtn').textContent === 'Done' || [...document.querySelectorAll('#log li.err')].length, 3600000, 'run');
  // 'Done' shows before the final mass read and SWMM's report; wait for both
  await until(() => !app.run.swmm || app.run.swmmClosed || [...document.querySelectorAll('#log li.err')].length, 60000, 'final books');
  await wait(500);
  const run = app.run, m = run.mass, c = run.netMass, ct = run.coupler?.totals;
  if (!m) throw new Error([...document.querySelectorAll('#log li.err')].map(l => l.textContent).join(' '));
  const ML = 1000; // SWMM continuity tables are in 10^6 litres = 1000 m³
  const roofToSewer = ct?.roofToSewer ?? 0, rain = m.rain + roofToSewer;
  // SWMM's external outflow includes water sent back up through inlets (negative lateral flow): that is on the street
  const outfalls = c ? c.externalOutflow * ML - (ct?.latOut ?? 0) : 0, netStored = c ? (c.finalStored - c.initialStored) * ML : 0;
  // SWMM floods only at manholes; overflow at manholes with grates goes back to the street (booked by the coupler),
  // at lid-only manholes it is lost from both models
  const lost = ct?.overflowLost ?? 0;
  const residual = rain - m.infil - m.outflow - outfalls - m.volume - netStored - lost;
  const r = {
    id: sc.id, name: sc.name, simSeconds: run.solver.t, wallSeconds: (performance.now() - t0) / 1000, cells: run.c.nx * run.c.ny,
    surface: { rain: m.rain, infil: m.infil, giStored: m.giStored, outflow: m.outflow, exchanged: m.exchanged, volume: m.volume, culvertInTransit: m.culvertInTransit ?? 0, rel: m.rel },
    network: c ? { ...c, latOut: ct.latOut ?? 0, roofToSewer, toNetwork: ct.toNetwork, toSurface: ct.toSurface, overflowReturned: ct.overflowReturned, overflowLost: lost, tanks: run.tanks } : null,
    culverts: run.culverts ? { count: run.culv.length, moved: run.culverts.totals.moved } : null,
    greenRoofs: run.green ? { share: run.green, fullAt: run.greenFull ?? null } : null,
    combined: { inflow: rain, residual, rel: residual / rain, appCombinedRel: c?.combinedRel ?? null },
    twoWay, storm: $('stormSummary').textContent.slice(0, 120), backflow: ct?.backflow ?? 0, errors: [...document.querySelectorAll('#log li.err')].map(l => l.textContent), swmmClosed: !!run.swmmClosed, coupled: !!run.coupler,
    flooding: (() => { const A = run.F * run.F; let a15 = 0, a30 = 0, mx = 0; for (let k = 0; k < run.hmax.length; k++) { if (run.c.inside && !run.c.inside[k]) continue; const h = run.hmax[k]; if (h > 0.15) a15 += A; if (h > 0.3) a30 += A; if (h > mx) mx = h; } return { areaOver15cm: a15, areaOver30cm: a30, maxDepth: mx, surfaceEnd: m.volume }; })(),
  };
  await fetch(`/api/bench-results?name=gatec-mass-${sc.id}${twoWay ? '-2way' : ''}`, { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify(r) });
  log(`${sc.id}: surface ${m.rel.toExponential(2)}${c ? `, SWMM ${c.errorPct}%` : ''}, combined ${(100 * r.combined.rel).toFixed(4)}% of ${Math.round(rain)} m³ (${r.wallSeconds.toFixed(0)} s)`);
  return r;
}

export async function runAudit(ids = SCENARIOS.map(s => s.id), log = console.log, opts = {}) {
  const out = [];
  for (const sc of SCENARIOS.filter(s => ids.includes(s.id))) {
    try { out.push(await audit(sc, log, opts)); } catch (e) { log(`${sc.id}: ${e.message}`); out.push({ id: sc.id, error: e.message }); }
  }
  return out;
}
