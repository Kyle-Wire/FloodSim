// FloodSim map app: draw an area → fetch open data → build a 1 m model → run the GPU solver → live 2D depth on a
// satellite basemap → export a 3D package. Expects the global `maplibregl` and the dev server's /api/fetch proxy.
import { GPUSolver } from '../src/solver-gpu.js';
import { gridFromLonLatBox, fromUTM, polygonCells, insideRing } from '../src/geo.js';
import { fetchDEM, fetchOSM, fetchNLCD, fetchSoils, NLCD_COLORS, NLCD_NAMES, toCells } from '../src/ingest.js';
import { buildFine, coarsen, coarseIds, hillshade, roofConnections, roofRouting, MANNING_ROAD } from '../src/terrain.js';
import { applyDesign, floodedBuildings, resolvedValues, hashFine } from '../src/design.js';
import { downscaleDepth, volumeRatio } from '../src/downscale.js';
import { zip, png16, exr, buildingsGLB } from '../src/export.js';
import { fetchAtlas14, hyetograph, constantStorm, rainAt, ddf, fitGEV, annualMaxima24h, recordStorm, wettest24, gevQuantile, pdsToAms } from '../src/storm.js';
import { synthNetwork, toINP, lumpedInfil, addTanks } from '../src/drainage.js';
import { giLayers, GI } from '../src/gi.js';
import { loadSWMM, SWMM } from '../src/swmm.js';
import * as H from '../src/history.js';
import { Coupler } from '../src/coupler.js';
import { fetchUtility, utilityFor } from '../src/utilities.js';
import { describeSource, fetchFeatures, detectPipeFields, pipeRecords, pointRecords } from '../src/linked.js';
import { realNetwork } from '../src/network-real.js';
import { breachChannels, culvertLinks, culvertDiameter } from '../src/channels.js';
import { CulvertLinks, LinkHub } from '../src/links.js';
import { attachStorage, networkToLayer } from '../src/infra.js';
import { initInfra } from './infra-ui.js';
import { initDesign } from './design-ui.js';
import { initCompare } from './compare-ui.js';
import * as CMP from '../src/compare.js';
import { initProjects, readBytes, readFile as readProjectFile, writeFile as writeProjectFile, stamp } from './projects.js';
import { buildBarriers, BarrierWatch } from '../src/barriers.js';
import { buildSubgrid, fineDepth, CT as SG_CT, FT as SG_FT } from '../src/subgrid.js';
import { watershed } from '../src/watershed.js';
import { gaCells, WETNESS, COLLAPSE_CLASSES } from '../src/soil.js';
import { sedimentCells } from '../src/sediment.js';
import { findBanks, bankClass, BANK_CLASSES, UNRATED } from '../src/banks.js';
import { scourCells, scourClass, SCOUR_CLASSES, NOT_ERODIBLE } from '../src/scour.js';
import { parseObservations, scoreRun, sweepPlan, PARAMS, fromSTN } from '../src/calibrate.js';
import { findGauges, gaugeFlows, annualPeaks, lp3, designHydrograph, recordedHydrograph, riverEntries, entryCells, InflowLinks, CFS } from '../src/inflow.js';
import { STANDARDS, HazardTracker, WET, VCUT } from '../src/hazard.js';
import { findLevelGauges, readLevels, gaugeSurface, lidarSurfaceNear, waterCells, startDepths, cellAt, waterNear } from '../src/waterlevels.js';

const $ = (id) => document.getElementById(id);
const MMHR = 1 / 1000 / 3600;
const MAX_FINE = 3000 * 3000;           // 1 m DEM cells we are willing to hold in the page
/** Example sites across the US, each exercising something different. `links` pre-fills the linked-data panel. */
const EXAMPLES = [
  { name: 'Eastwick, Philadelphia PA', why: 'low-lying, tidal creek, repeatedly flooded', box: [-75.2475, 39.9055, -75.2355, 39.9145] },
  { name: 'South Street, Philadelphia PA', why: 'combined sewers, real utility inlets', box: [-75.1590, 39.9405, -75.1525, 39.9440] },
  { name: 'West Hollywood CA', why: 'public storm-drain GIS linked in (tier 1)', box: [-118.3800, 34.0855, -118.3720, 34.0915],
    links: { pipes: ['https://gis.weho.org/arcgis/rest/services/DPW/StormDrains/MapServer/1', 'https://gis.weho.org/arcgis/rest/services/DPW/StormDrains/MapServer/2'],
      inlets: ['https://gis.weho.org/arcgis/rest/services/DPW/StormDrains/MapServer/0'] } },
  { name: 'Meyerland, Houston TX', why: 'flat, bayou-side, flash flooding', box: [-95.4740, 29.6790, -95.4620, 29.6880] },
  { name: 'Ellicott City MD', why: 'steep valley, 2016 and 2018 flash floods', box: [-76.8020, 39.2650, -76.7930, 39.2710] },
  { name: 'Miami Beach FL', why: 'tidal and storm-surge flooding', box: [-80.1390, 25.7880, -80.1290, 25.7960] },
  { name: 'Waikiki, Honolulu HI', why: 'Hawaii: local datums, no Atlas 14 gaps', box: [-157.8320, 21.2740, -157.8230, 21.2820] },
];
const fmtTime = (t) => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const fmtVol = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M m³` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k m³` : `${v.toFixed(v < 10 ? 2 : 0)} m³`;
const fmtArea = (a) => a >= 1e4 ? `${(a / 1e4).toFixed(2)} ha` : `${Math.round(a).toLocaleString()} m²`;
const fetcher = (url, o = {}) => fetch('/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url, method: o.method, body: o.body, contentType: o.contentType, linked: o.linked }) });
/** Fetcher for links the user pasted: the proxy lets these reach any public https host (GET only). */
const linkedFetcher = (url) => fetcher(url, { linked: true });

const S = { area: null, poly: null, view: 'depth', opacity: 0.85, hmin: 0.01, obs: [] }; // poly: lon/lat ring of a polygon area (S.area is its box)
let device = null, model = null, run = null;
let runGen = 0; // never reset: stopRun clears `run`, so a fresh run must not reuse a generation an old loop still holds
const ws = { last: null, busy: null }; // the area's watershed, once traced

// ------------------------------------------------------------------ WebGPU
async function initGPU() {
  try {
    if (!navigator.gpu) throw new Error('WebGPU not available in this browser');
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) throw new Error('No WebGPU adapter');
    device = await a.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(a.limits.maxStorageBuffersPerShaderStage, 10), maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxBufferSize: a.limits.maxBufferSize } });
    device.lost.then((i) => { setEngine(false, 'GPU device lost: ' + i.message); });
    const info = a.info || {};
    setEngine(true, `WebGPU · ${info.architecture || info.vendor || 'GPU'} · ${(a.limits.maxStorageBufferBindingSize / 2 ** 20) | 0} MB buffers`);
  } catch (e) { setEngine(false, e.message); }
}
function setEngine(ok, text) { $('engineDot').className = 'dot ' + (ok ? 'gpu' : 'bad'); $('engineText').textContent = text; }
/** Largest solver grid (cells incl. ghosts) the device allows: the 36 B/cell face-flux buffers are the binding limit. */
/** Solver cell size (m) and whether it runs the subgrid speed mode ('4s', '8s'). */
const gridF = () => parseInt($('dxSel').value, 10);
const isSubgrid = () => $('dxSel').value.endsWith('s');
/**
 * Subgrid rain multiplier. Rain falls on the open part of each cell; whole-building cells keep their roof routing from
 * `base` (roofRouting / roofConnections). The roofs of part-building cells, which those do not see, are treated the same
 * way: with downspouts, `sewer` of their rain goes to the nearest manhole within 80 m (added to `roofArea`) and the
 * rest × `ground` onto the cell; without a manhole in reach (or downspouts) `ground` of it lands on the cell.
 */
function sgRain(c, base, ground, net = null, sewer = 0, roofArea = null) {
  const F = c.F, B = Math.max(1, Math.round(80 / F)), buckets = new Map();
  if (net && sewer > 0 && roofArea) net.nodes.forEach((n, i) => {
    if (n.outfall || n.storage || n.offsite) return;
    const x = n.p[0] / F, y = n.p[1] / F, key = Math.floor(x / B) + ',' + Math.floor(y / B);
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push({ i, x, y });
  });
  return base.map((v, k) => {
    if (!c.mask[k]) return v;
    const roof = 1 - c.phi[k]; let g = ground;
    if (roof > 0 && buckets.size) {
      const x = k % c.nx + 0.5, y = ((k / c.nx) | 0) + 0.5, bx = Math.floor(x / B), by = Math.floor(y / B); let best = null, bd = B;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of buckets.get((bx + dx) + ',' + (by + dy)) ?? []) { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } }
      if (best) { roofArea[best.i] += sewer * roof * F * F; g = (1 - sewer) * ground; }
    }
    return v - 1 + c.phi[k] + g * roof;
  });
}
const maxSolverCells = () => device ? Math.floor(Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize) / 36) : 0;

// ------------------------------------------------------------------ map
const BASEMAPS = {
  usgs: { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: 'Imagery: USGS The National Map (NAIP)' },
  esri: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
};
/** Where the map opens: the user's last view, else the whole United States. */
function startView() {
  try { const v = JSON.parse(localStorage.getItem('floodsim.view')); if (v?.center && v.zoom) return v; } catch { /* storage off */ }
  return { center: [-98.5, 39.5], zoom: 3.4 };
}
const map = new maplibregl.Map({
  container: 'map', ...startView(), maxPitch: 0, dragRotate: false, attributionControl: { compact: true },
  style: {
    version: 8,
    sources: Object.fromEntries(Object.entries(BASEMAPS).map(([k, b]) => [k, { type: 'raster', tileSize: 256, ...b }])),
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#1b2a33' } },
      { id: 'usgs', type: 'raster', source: 'usgs' }, { id: 'esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } }],
  },
});
const gpuReady = initGPU();
let appCommit = 'unknown'; // the server's checkout: part of every run's forcing fingerprint
fetch('/api/version', { cache: 'no-store' }).then(r => r.json()).then(v => { if (v.commit) appCommit = v.commit + (v.dirty ? '+dirty' : ''); }).catch(() => {}); // Build awaits it: a project opened at page load can finish building before the GPU is up
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.on('moveend', () => { try { localStorage.setItem('floodsim.view', JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom() })); } catch { /* storage off */ } });
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.touchZoomRotate.disableRotation();

const canvases = { depth: document.createElement('canvas'), shade: document.createElement('canvas'), lc: document.createElement('canvas'), dz: document.createElement('canvas') };
const emptyFC = { type: 'FeatureCollection', features: [] };
// 'style.load' needs no rendered frame, so building works in a background tab ('load' waits for the first paint)
const mapReady = new Promise((resolve) => map.once('style.load', () => setTimeout(resolve, 0)));
map.once('style.load', () => {
  map.addSource('area', { type: 'geojson', data: emptyFC });
  map.addSource('bld', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'bld-fill', type: 'fill', source: 'bld', paint: { 'fill-color': '#e8e2d6', 'fill-opacity': 0.35 } });
  map.addLayer({ id: 'bld-line', type: 'line', source: 'bld', paint: { 'line-color': '#f4efe6', 'line-width': 0.6, 'line-opacity': 0.8 } });
  map.addSource('net', { type: 'geojson', data: emptyFC });
  const use = ['coalesce', ['feature-state', 'use'], 0];
  map.addLayer({ id: 'net-pipes', type: 'line', source: 'net', filter: ['==', ['get', 'kind'], 'pipe'], layout: { 'line-cap': 'round' },
    paint: { 'line-width': ['interpolate', ['linear'], ['get', 'D'], 0.3, 1.5, 1.2, 3.5, 2.4, 5], 'line-color': ['case', ['>=', use, 0.99], '#ef5a4a', ['>=', use, 0.5], '#f2c94c', '#8fdcf5'], 'line-opacity': 0.95 } });
  map.addLayer({ id: 'net-grates', type: 'circle', source: 'net', filter: ['==', ['get', 'kind'], 'grate'],
    paint: { 'circle-radius': 2.2, 'circle-color': '#f2c94c', 'circle-stroke-width': 0.8, 'circle-stroke-color': '#0c151b' } });
  map.addLayer({ id: 'net-nodes', type: 'circle', source: 'net', filter: ['all', ['!=', ['get', 'kind'], 'pipe'], ['!=', ['get', 'kind'], 'grate']],
    paint: { 'circle-radius': ['match', ['get', 'kind'], 'outfall', 4.5, 'storage', 6, 2.5], 'circle-stroke-width': 1, 'circle-stroke-color': '#0c151b',
      'circle-color': ['case', ['==', ['get', 'kind'], 'outfall'], '#ffffff', ['==', ['get', 'kind'], 'storage'], '#a78bfa', ['==', ['coalesce', ['feature-state', 'sur'], 0], 1], '#ef5a4a', '#cfeefa'] } });
  map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#4fb4d6', 'line-width': 2, 'line-dasharray': [3, 2] } });
});

// infrastructure drawer: the user's own pipes, culverts, structures and storage (drawn, imported, or estimated)
const infra = initInfra(map, { onChange: infraChanged, estimate: estimateLayer, groundAt, fetcher, ready: mapReady });
let infraTimer = 0;
function infraChanged() {
  clearTimeout(infraTimer);
  infraTimer = setTimeout(() => {
    if (!model) return;
    if (run?.solver) { $('infraNote').textContent = 'Edits apply to the next run: press Reset.'; return; }
    resetRun();
  }, 300);
}
/** Lidar ground (m NAVD88) under a lon/lat point, or null outside the model. */
function groundAt(ll) {
  if (!model) return null;
  const fine = model.fine, [x, y] = toCells(fine, [ll])[0], i = Math.floor(x), j = Math.floor(y);
  return i < 0 || j < 0 || i >= fine.nx || j >= fine.ny ? null : model.f.z[j * fine.nx + i];
}
// site design drawer: proposed scenarios as edits to the fine model (model.base is existing conditions, model.f the active scenario)
const design = initDesign(map, { onChange: designChanged, onAnalysis: analysisChanged, groundAt: baseGroundAt, ready: mapReady,
  manholes: () => infra.layer.features.filter(f => f.properties.type === 'manhole' || f.properties.type === 'inlet')
    .map(f => ({ ll: f.geometry.coordinates, label: `${f.properties.type === 'inlet' ? 'Catch basin' : 'Manhole'} ${f.id}${Number.isFinite(f.properties.invert) ? `, invert ${(f.properties.invert / 0.3048).toFixed(2)} ft` : ''}` })),
  buildingAt: (pt) => map.getLayer('bld-fill') ? map.queryRenderedFeatures([[pt.x - 2, pt.y - 2], [pt.x + 2, pt.y + 2]], { layers: ['bld-fill'] })[0] ?? null : null });
let designTimer = 0;
/** Control lines or the site boundary changed: lines feed the solver, so the run inputs are rebuilt (before a run). */
function analysisChanged() {
  if (!model) return;
  if (run?.solver) { $('designNote').textContent = 'Control lines apply to the next run: press Reset.'; return; }
  clearTimeout(designTimer); designTimer = setTimeout(() => { if (model && !run?.solver) resetRun(); }, 300);
}
function designChanged() {
  clearTimeout(designTimer);
  designTimer = setTimeout(() => {
    if (!model) return;
    applyScenario(); drawDesign();
    if (run?.solver) { $('designNote').textContent = 'Edits apply to the next run: press Reset.'; return; }
    $('designNote').textContent = ''; resetRun();
  }, 300);
}
/** Lidar ground (existing conditions) under a lon/lat point. */
function baseGroundAt(ll) {
  if (!model) return null;
  const fine = model.fine, [x, y] = toCells(fine, [ll])[0], i = Math.floor(x), j = Math.floor(y);
  return i < 0 || j < 0 || i >= fine.nx || j >= fine.ny ? null : model.base.z[j * fine.nx + i];
}
/** Open water on the fine grid (NLCD open water, mapped streams and rivers): fill into it is warned about. */
function fineWater() {
  if (model.water) return model.water;
  const fine = model.fine, lines = (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line));
  return (model.water = waterCells({ nx: fine.nx, ny: fine.ny, mask: new Uint8Array(fine.nx * fine.ny).fill(1) }, 1, fine, model.nlcd, lines));
}
/** model.f ← the active scenario applied to existing conditions (nothing is fetched again). */
function applyScenario() {
  const sc = design.active;
  if (!sc || !sc.design.features.length) { model.f = model.base; model.design = null; design.setLog(sc ? { features: [], totals: { cut: 0, fill: 0, net: 0, impAdded: 0, impRemoved: 0, floodFill: 0, compCut: 0 }, warnings: [] } : null); return; }
  const t0 = performance.now(), fine = model.fine;
  const r = applyDesign(model.base, { features: sc.design.features, settings: sc.settings, locked: sc.locked }, { toCell: (p) => toCells(fine, [p])[0], wse: model.baseWse ?? null, water: fineWater(), hash: false });
  r.log.floodRef = model.baseWse ? 'the existing-conditions run’s max water surface' + (r.log.settings.bfe != null ? ' or the BFE' : '') : r.log.settings.bfe != null ? `the BFE, ${(r.log.settings.bfe / 0.3048).toFixed(2)} ft` : null;
  model.f = r.fine; model.design = { name: sc.name, log: r.log, ms: performance.now() - t0 };
  design.setLog(r.log);
}
/** Proposed hillshade, cut and fill overlay and building outlines after a design change. */
function drawDesign() {
  const { fine, f, base } = model;
  canvases.shade.getContext('2d').putImageData(new ImageData(hillshade(f.z, fine.nx, fine.ny, fine.dx), fine.nx, fine.ny), 0, 0); refreshCanvas('shade');
  const img = new ImageData(fine.nx, fine.ny), px = img.data;
  if (f !== base) for (let k = 0; k < f.z.length; k++) {
    const d = f.z[k] - base.z[k]; if (Math.abs(d) < 0.01) continue;
    const t = Math.min(1, Math.abs(d) / 1.5), c = d < 0 ? [244 - 66 * t, 165 - 141 * t, 130 - 87 * t] : [146 - 113 * t, 197 - 95 * t, 222 - 50 * t];
    px[4 * k] = c[0]; px[4 * k + 1] = c[1]; px[4 * k + 2] = c[2]; px[4 * k + 3] = 150 + 90 * t;
  }
  canvases.dz.getContext('2d').putImageData(img, 0, 0); refreshCanvas('dz');
  map.getSource('bld')?.setData(buildingsFC());
  if (model && run && !run.solver) setTiers();
}
/** Mapped buildings, less the ones the active scenario demolishes. */
function buildingsFC() {
  const { fine, f, base, osm } = model, W = fine.nx;
  const gone = (b) => { if (f === base) return false; const c = toCells(fine, [b.rings[0].reduce((a, p) => [a[0] + p[0] / b.rings[0].length, a[1] + p[1] / b.rings[0].length], [0, 0])])[0], i = Math.floor(c[0]), j = Math.floor(c[1]);
    return i >= 0 && j >= 0 && i < W && j < fine.ny && base.bld[j * W + i] && !f.bld[j * W + i]; };
  return { type: 'FeatureCollection', features: osm.buildings.filter(b => !gone(b)).map(b => ({ type: 'Feature', properties: { h: b.height }, geometry: { type: 'Polygon', coordinates: b.rings } })) };
}
$('tDz').onchange = () => { if (map.getLayer('ov-dz')) map.setLayoutProperty('ov-dz', 'visibility', $('tDz').checked ? 'visible' : 'none'); };
/** The network Build would make without the layer (linked pipes, else street-following), as editable features. */
async function estimateLayer() {
  if (!model) return null;
  const F = gridF(), c = run?.c ?? coarsen(model.f, F, Number($('roof').value) / 100);
  const net = makeNetwork(c, F, { ignoreLayer: true }); if (!net) throw new Error('no drivable streets in this area');
  const fine = model.fine, W = fine.nx;
  return networkToLayer(net, nodeLL, (k) => fromUTM(fine.x0 + ((k % W) + 0.5) * fine.dx, fine.y1 - (((k / W) | 0) + 0.5) * fine.dx, fine.zone));
}

const pendingLayers = new Map();
function setCanvasLayer(name, canvas, corners, before, visible = true, opacity = 1) {
  const id = 'ov-' + name;
  if (!map.isStyleLoaded()) { // the basemap is still loading: add the overlay once it has (a slow basemap must not stop a run)
    if (!pendingLayers.has(id)) map.once('idle', () => { const a = pendingLayers.get(id); pendingLayers.delete(id); setCanvasLayer(...a); });
    pendingLayers.set(id, [name, canvas, corners, before, visible, opacity]); return;
  }
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  map.addSource(id, { type: 'canvas', canvas, coordinates: corners, animate: false });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }, layout: { visibility: visible ? 'visible' : 'none' } },
    map.getLayer(before) ? before : undefined);
}
/** Push a redrawn canvas to the GPU texture (canvas sources only re-upload while "playing"). */
function refreshCanvas(name) {
  const src = map.getSource('ov-' + name); if (!src) return;
  src.play(); map.triggerRepaint(); map.once('render', () => src.pause());
}

// ------------------------------------------------------------------ area selection
function setArea(box, ring = null) {
  const [w, s, e, n] = box;
  S.area = [Math.min(w, e), Math.min(s, n), Math.max(w, e), Math.max(s, n)]; S.poly = ring;
  const g = gridFromLonLatBox(...S.area, 1);
  showAreaOutline(g);
  const tooBig = g.nx * g.ny > MAX_FINE;
  const inside = ring ? polygonCells(g, ring, 8).reduce((a, b) => a + b, 0) * 64 : 0;
  $('areaDesc').textContent = (ring ? `Polygon of ${(inside / 1e6).toFixed(2)} km² in a ` : '') + `${(g.nx / 1000).toFixed(2)} × ${(g.ny / 1000).toFixed(2)} km grid in UTM ${g.zone}N (EPSG:${g.epsg})` +
    (ring ? '; water leaving the polygon is gone (free overfall at its edge)' : '') + (tooBig ? ' — too large for a 1 m model in the browser; draw a smaller area.' : '');
  $('buildBtn').disabled = tooBig; $('wsBtn').disabled = false;
  if (!S.wsUsing) { ws.last = null; $('wsNote').hidden = true; showWatershed(null); } // a new area: its watershed is not known yet
  S.wsUsing = false;
  updateSizeNote();
}

// ------------------------------------------------------------------ watershed
/**
 * The ground that drains into the area, from 3DEP elevation (5 m, or 10 m for wide searches): the search box grows
 * until the catchment no longer runs off it (up to ~8 km). Running on the watershed makes the model a closed system:
 * nothing flows in across its edge, and water leaves only where the terrain does. Surface drainage only.
 */
async function findWatershed() {
  const area = S.area, ring = S.poly ?? [[area[0], area[1]], [area[2], area[1]], [area[2], area[3]], [area[0], area[3]]];
  const lat = (area[1] + area[3]) / 2, mLat = 111320, mLon = 111320 * Math.cos(lat * Math.PI / 180);
  const ext = Math.max((area[2] - area[0]) * mLon, (area[3] - area[1]) * mLat);
  let margin = Math.max(500, ext), res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = [area[0] - margin / mLon, area[1] - margin / mLat, area[2] + margin / mLon, area[3] + margin / mLat];
    const dx = ext + 2 * margin > 4000 ? 10 : 5, g = gridFromLonLatBox(...box, dx);
    const dem = await fetchDEM(g, fetcher), target = polygonCells(g, ring);
    const w = watershed(dem.z, g.nx, g.ny, target);
    const toLL = (r) => r.map(([x, y]) => fromUTM(g.x0 + x * dx, g.y1 - y * dx, g.zone));
    res = { w, g, dx, cellArea: dx * dx, studyArea: w.studyCells * dx * dx, upstreamArea: w.upstreamCells * dx * dx, searchKm: (ext + 2 * margin) / 1000,
      ring: toLL(w.ring), localRing: w.local ? toLL(w.local.ring) : null };
    if (!w.touchesEdge) break;
    margin *= 3;
  }
  return res;
}
function showWatershed(ringLL) {
  const fc = { type: 'FeatureCollection', features: ringLL ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ringLL, ringLL[0]]] } }] : [] };
  if (!map.getSource('ws')) {
    if (!ringLL) return;
    map.addSource('ws', { type: 'geojson', data: fc });
    map.addLayer({ id: 'ws-fill', type: 'fill', source: 'ws', paint: { 'fill-color': '#3fd0ff', 'fill-opacity': 0.06 } });
    map.addLayer({ id: 'ws-line', type: 'line', source: 'ws', paint: { 'line-color': '#3fd0ff', 'line-width': 2, 'line-dasharray': [3, 2] } });
  } else map.getSource('ws').setData(fc);
}
/** Find the watershed and say what it means for this area; `quiet` logs instead of filling the Area note. */
async function checkWatershed({ quiet = false } = {}) {
  if (!S.area) return null;
  const note = $('wsNote'), l = quiet ? log('Watershed draining into the area (3DEP)') : null;
  if (!quiet) { note.hidden = false; note.textContent = 'Tracing the watershed from 3DEP elevation…'; }
  try {
    ws.busy = findWatershed(); const r = ws.last = await ws.busy; ws.busy = null;
    const river = r.w.touchesEdge, L = r.w.local, useRing = river ? r.localRing : r.ring;
    showWatershed(useRing);
    const cells = river ? L.cells : r.w.cells, up = river ? L.upstreamCells * r.cellArea : r.upstreamArea;
    const share = up / Math.max(1, r.studyArea), big = cells * r.cellArea > MAX_FINE, open = up >= 0.02 * r.studyArea;
    const msg = (river ? `A river runs in from a basin larger than the ${r.searchKm.toFixed(1)} km search: its flow is not in the model until it has an inflow from a stream gauge. Not counting the river, ` : '')
      + (!open ? `${river ? 'nothing' : 'no ground'} outside the area drains into it${river ? ' locally' : ''}: closed (watershed ${fmtArea(cells * r.cellArea)}).`
        : `${fmtArea(up)} outside the area drains into it${river ? ' locally' : ''} (${share >= 2 ? `${share.toFixed(share >= 10 ? 0 : 1)}×` : `${Math.round(share * 100)} % of`} the area's own size). That water is missing unless the model runs on the ${river ? 'local ' : ''}watershed (${fmtArea(cells * r.cellArea)}${big ? ', larger than a 1 m model holds in the browser' : ''}).`);
    if (l) l.set('Watershed: ' + (river ? 'a river enters from a large basin' + (open ? `; ${fmtArea(up)} more drains in locally` : '') : open ? `${fmtArea(up)} drains in from outside` : 'closed'), river || open ? 'warn' : 'ok', 'surface drainage on 3DEP at ' + r.dx + ' m');
    note.hidden = false; r.use = useRing; r.useArea = cells * r.cellArea;
    note.innerHTML = msg + (open && !big ? ` <button class="btn" id="wsUse" type="button">Run on the ${river ? 'local ' : ''}watershed</button>` : '');
    $('wsUse')?.addEventListener('click', useWatershed);
    return r;
  } catch (e) { ws.busy = null; if (l) l.set('Watershed: ' + e.message, 'warn'); if (!quiet) note.textContent = 'Watershed failed: ' + e.message; return null; }
}
/** Make the watershed the model area (a polygon: the edge is a ridge, so nothing flows in). */
function useWatershed() {
  const r = ws.last; if (!r?.use) return;
  const lo = r.use.map(p => p[0]), la = r.use.map(p => p[1]);
  S.wsUsing = true; setArea([Math.min(...lo), Math.min(...la), Math.max(...lo), Math.max(...la)], r.use);
  $('wsNote').innerHTML = `Model area set to the ${r.w.touchesEdge ? 'local ' : ''}watershed (${fmtArea(r.useArea)})` + (r.w.touchesEdge ? ': closed except for the river, which needs a gauge inflow.' : ': a closed system.') + ' Build to model it.';
  map.fitBounds([[Math.min(...lo), Math.min(...la)], [Math.max(...lo), Math.max(...la)]], { padding: 40 });
}
$('wsBtn').onclick = () => checkWatershed();
function updateSizeNote() {
  if (!S.area) return;
  const g = gridFromLonLatBox(...S.area, 1), F = gridF();
  const cells = (g.nx / F) * (g.ny / F), padded = (g.nx / F + 4) * (g.ny / F + 4), mb = padded * (176 + (isSubgrid() ? 4 * (SG_CT + 2 * SG_FT) : 0)) / 2 ** 20;
  const fits = !device || padded <= maxSolverCells();
  $('sizeNote').textContent = `${Math.round(cells).toLocaleString()} solver cells at ${F} m · ~${mb.toFixed(0)} MB GPU memory` + (fits ? '' : ' — exceeds this GPU’s buffer limit; pick a coarser cell size.');
  $('sizeNote').style.color = fits ? '' : 'var(--crit)';
  return fits;
}
$('dxSel').onchange = () => { updateSizeNote(); if (model) resetRun(); };
// ------------------------------------------------------------------ user-linked data
const linkFields = ['linkPipes', 'linkInlets', 'linkOutfalls'];
try { for (const id of linkFields) $(id).value = localStorage.getItem('floodsim.' + id) ?? ''; $('linkUnits').value = localStorage.getItem('floodsim.linkUnits') ?? 'auto'; } catch { /* storage off */ }
for (const id of [...linkFields, 'linkUnits']) $(id).addEventListener('change', () => { try { localStorage.setItem('floodsim.' + id, $(id).value); } catch { /* storage off */ } });
const splitLinks = (s) => s.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
function linkedLinks() { return { pipes: splitLinks($('linkPipes').value), inlets: splitLinks($('linkInlets').value), outfalls: splitLinks($('linkOutfalls').value) }; }
/** Fetch every linked layer inside the box; pipes get their fields detected per layer (units overridable). */
async function loadLinked(links, bounds) {
  const out = { pipes: [], inlets: [], outfalls: [], notes: [], names: { pipes: [], inlets: [], outfalls: [] }, sources: [] };
  for (const [kind, urls] of Object.entries(links)) for (const url of urls) {
    const src = await describeSource(url, linkedFetcher);
    const feats = await fetchFeatures(src, bounds, linkedFetcher);
    out.names[kind].push(src.name); out.sources.push({ kind, url, name: src.name, features: feats.length });
    if (kind === 'pipes') {
      if (src.kind !== 'line') throw new Error(`${src.name} has ${src.kind} features, pipes must be lines`);
      const map = detectPipeFields(src.fields, feats.slice(0, 200).map(f => f.props));
      if ($('linkUnits').value !== 'auto') map.sizeUnits = $('linkUnits').value;
      out.pipes.push(...pipeRecords(feats, map));
      out.notes.push(`${src.name}: size ${map.size ?? 'none'} (${map.sizeUnits})${map.width ? ', width ' + map.width : ''}${map.shape ? ', shape ' + map.shape : ''}${map.upInvert ? `, inverts ${map.upInvert}/${map.dnInvert}` : ', no inverts'}${map.status ? ', drops ' + map.status : ''}`);
    } else {
      if (src.kind !== 'point') throw new Error(`${src.name} has ${src.kind} features, ${kind} must be points`);
      out[kind].push(...pointRecords(feats));
    }
  }
  return out;
}
$('linkCheck').onclick = async () => {
  const ul = $('linkLog'); ul.textContent = '';
  const links = linkedLinks(), all = Object.entries(links).flatMap(([k, us]) => us.map(u => [k, u]));
  if (!all.length) { ul.innerHTML = '<li class="warn"><span>Paste at least one link.</span></li>'; return; }
  const bounds = S.area ? gridFromLonLatBox(...S.area, 1).lonlatBounds(0.0004) : null;
  for (const [kind, url] of all) {
    const li = document.createElement('li'); li.className = 'run'; li.innerHTML = `<span>${kind}: checking…<small>${url}</small></span>`; ul.append(li);
    try {
      const src = await describeSource(url, linkedFetcher);
      let detail = `${src.kind} layer · ${src.fields.length} fields`;
      if (bounds) {
        const feats = await fetchFeatures(src, bounds, linkedFetcher);
        detail += ` · ${feats.length} features in your area`;
        if (kind === 'pipes' && src.kind === 'line') { const mp = detectPipeFields(src.fields, feats.slice(0, 200).map(f => f.props)); detail += ` · size ${mp.size ?? '—'} (${$('linkUnits').value === 'auto' ? mp.sizeUnits : $('linkUnits').value}), inverts ${mp.upInvert ? mp.upInvert + '/' + mp.dnInvert : 'none (derived from lidar)'}`; }
      }
      const okKind = kind === 'pipes' ? src.kind === 'line' : src.kind === 'point';
      li.className = okKind ? 'ok' : 'err'; li.innerHTML = `<span>${kind}: ${src.name}${okKind ? '' : ` — expected ${kind === 'pipes' ? 'lines' : 'points'}`}<small>${detail}</small></span>`;
    } catch (e) { li.className = 'err'; li.innerHTML = `<span>${kind}: ${e.message}<small>${url}</small></span>`; }
  }
};

/** Address (US Census geocoder) or place name (OpenStreetMap Nominatim) → fly there. */
async function findPlace(q) {
  const note = $('findNote'); note.textContent = 'Searching…';
  try {
    let hit = null;
    const c = await (await fetcher(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`)).json().catch(() => null);
    const a = c?.result?.addressMatches?.[0];
    if (a) hit = { lon: a.coordinates.x, lat: a.coordinates.y, label: a.matchedAddress };
    else {
      const n = await (await fetcher(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us,pr,gu,vi,as,mp&q=${encodeURIComponent(q)}`)).json();
      if (n[0]) hit = { lon: Number(n[0].lon), lat: Number(n[0].lat), label: n[0].display_name };
    }
    if (!hit) { note.textContent = 'No match. Try a street address with city and state.'; return; }
    map.jumpTo({ center: [hit.lon, hit.lat], zoom: 17 });
    const u = utilityFor([hit.lon, hit.lat, hit.lon, hit.lat]);
    note.textContent = `${hit.label}. Now draw a box or polygon around it.${u ? ` Real ${u.name} inlets will be used.` : ''}`;
  } catch (e) { note.textContent = 'Search failed: ' + e.message; }
}
$('findForm').onsubmit = (e) => { e.preventDefault(); const q = $('findInput').value.trim(); if (q) findPlace(q); };
$('exampleSel').innerHTML = '<option value="">Examples…</option>' + EXAMPLES.map((e, i) => `<option value="${i}">${e.name} · ${e.why}</option>`).join('');
$('exampleSel').onchange = () => {
  const e = EXAMPLES[Number($('exampleSel').value)]; if (!e) return;
  cancelPoly(); setArea(e.box); map.fitBounds([[e.box[0], e.box[1]], [e.box[2], e.box[3]]], { padding: 40 });
  // the example's own linked data replaces whatever links were there (examples without links clear them)
  for (const [id, k] of [['linkPipes', 'pipes'], ['linkInlets', 'inlets'], ['linkOutfalls', 'outfalls']]) { $(id).value = (e.links?.[k] ?? []).join('\n'); $(id).dispatchEvent(new Event('change')); }
  if (e.links) document.querySelector('details.linked').open = true;
  $('exampleSel').value = '';
};

/** The area outline: the polygon when there is one, else the model grid. */
function showAreaOutline(g) {
  const ring = S.poly ? [...S.poly, S.poly[0]] : [...g.corners(), g.corners()[0]];
  map.getSource('area')?.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } });
}
let drawStart = null, polyPts = null;
$('drawBtn').onclick = () => {
  cancelPoly();
  map.dragPan.disable(); map.boxZoom.disable(); map.getContainer().classList.add('drawing');
  $('drawBtn').textContent = 'Drag on the map…';
};
map.on('mousedown', (e) => { if (!map.getContainer().classList.contains('drawing') || polyPts) return; drawStart = e.lngLat; e.preventDefault(); });
// polygon: click corners; finish on double-click, Enter, or a click on the first corner; Esc cancels
$('polyBtn').onclick = () => {
  if (polyPts) { finishPoly(); return; }
  polyPts = []; map.doubleClickZoom.disable(); map.getContainer().classList.add('drawing');
  $('polyBtn').textContent = 'Click corners… (Enter to finish)';
};
function polyPreview(cursor) {
  const pts = cursor ? [...polyPts, cursor] : polyPts; if (!pts.length) return;
  map.getSource('area')?.setData({ type: 'Feature', geometry: pts.length > 2 ? { type: 'Polygon', coordinates: [[...pts, pts[0]]] } : { type: 'LineString', coordinates: pts } });
}
function cancelPoly() {
  if (!polyPts) return; polyPts = null; map.doubleClickZoom.enable(); map.getContainer().classList.remove('drawing'); $('polyBtn').textContent = 'Draw polygon';
  if (S.area) showAreaOutline(gridFromLonLatBox(...S.area, 1)); else map.getSource('area')?.setData(emptyFC);
}
function finishPoly() {
  const pts = polyPts; polyPts = null;
  map.doubleClickZoom.enable(); map.getContainer().classList.remove('drawing'); $('polyBtn').textContent = 'Draw polygon';
  if (!pts || pts.length < 3) { if (S.area) showAreaOutline(gridFromLonLatBox(...S.area, 1)); return; }
  const lo = pts.map(p => p[0]), la = pts.map(p => p[1]);
  setArea([Math.min(...lo), Math.min(...la), Math.max(...lo), Math.max(...la)], pts);
}
map.on('click', (e) => {
  if (!polyPts) return;
  const p = [e.lngLat.lng, e.lngLat.lat];
  if (polyPts.length >= 3) { const a = map.project(polyPts[0]); if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 10) { finishPoly(); return; } }
  const last = polyPts[polyPts.length - 1];
  const q = last && map.project(last);
  if (!q || Math.hypot(q.x - e.point.x, q.y - e.point.y) > 3) polyPts.push(p); // a double-click's second click repeats the point
  polyPreview();
});
map.on('dblclick', (e) => { if (polyPts) { e.preventDefault(); finishPoly(); } });
addEventListener('keydown', (e) => {
  if (!polyPts || e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'Enter') { e.preventDefault(); finishPoly(); } else if (e.key === 'Escape') cancelPoly(); else if (e.key === 'Backspace') { polyPts.pop(); polyPreview(); }
});
let drawEnd = null;
map.on('mousemove', (e) => {
  if (drawStart) {
    const a = drawStart, b = e.lngLat; drawEnd = b;
    map.getSource('area').setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[a.lng, a.lat], [b.lng, a.lat], [b.lng, b.lat], [a.lng, b.lat], [a.lng, a.lat]]] } });
  } else if (polyPts) polyPreview([e.lngLat.lng, e.lngLat.lat]);
  else probe(e);
});
// finish on any mouse-up, even over a map control or outside the map (MapLibre reports neither), at the release point
// clamped to the map (a fast drag can release before the last mousemove arrives)
addEventListener('mouseup', (e) => {
  if (!drawStart) return;
  const r = map.getCanvas().getBoundingClientRect();
  const x = Math.min(r.width, Math.max(0, e.clientX - r.left)), y = Math.min(r.height, Math.max(0, e.clientY - r.top));
  const a = drawStart, b = Number.isFinite(e.clientX) ? map.unproject([x, y]) : drawEnd; drawStart = drawEnd = null;
  map.dragPan.enable(); map.boxZoom.enable(); map.getContainer().classList.remove('drawing'); $('drawBtn').textContent = 'Draw area';
  if (!b || Math.abs(a.lng - b.lng) < 1e-5 || Math.abs(a.lat - b.lat) < 1e-5) return;
  setArea([a.lng, a.lat, b.lng, b.lat]);
});
map.on('mouseout', () => { $('probe').style.display = 'none'; });

// ------------------------------------------------------------------ build
const logEl = $('log');
function log(text, cls = 'run', detail = '') {
  const li = document.createElement('li'); li.className = cls; li.innerHTML = `<span>${text}${detail ? `<small>${detail}</small>` : ''}</span>`;
  logEl.append(li); return { set: (t, c, d = '') => { li.className = c; li.innerHTML = `<span>${t}${d ? `<small>${d}</small>` : ''}</span>`; } };
}

async function decodeImage(buf) {
  const bmp = await createImageBitmap(new Blob([buf]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, bmp.width, bmp.height);
}

$('buildBtn').onclick = async () => {
  if (!S.area) return;
  stopRun(); model = null; logEl.textContent = '';
  for (const id of ['buildBtn', 'runBtn', 'resetBtn', 'exportBtn']) $(id).disabled = true;
  inflow.entries = []; $('inflowBox').hidden = true; $('hwmEvent').hidden = true; $('hwmBtn').disabled = true; // site-specific: found again after the build
  let built; inflow.ready = new Promise((res) => { built = res; }); // a run waits for the whole build, gauge lists included
  const fine = gridFromLonLatBox(...S.area, 1), bounds = fine.lonlatBounds(0.0004);
  try {
    const lDem = log('3DEP bare-earth DEM at 1 m');
    const lOsm = log('OpenStreetMap buildings and roads');
    const lLc = log('NLCD land cover');
    const lSoil = log('SSURGO soils');
    const lA14 = log('NOAA Atlas 14 rainfall frequency');
    const ut = utilityFor(fine.lonlatBounds()), lUtil = ut ? log(`${ut.name} drainage inlets`) : null;
    const links = linkedLinks(), lLink = (links.pipes.length || links.inlets.length || links.outfalls.length) ? log('Your linked drainage data') : null;
    const [cx, cy] = [(fine.x0 + fine.x1) / 2, (fine.y0 + fine.y1) / 2], [clon, clat] = fromUTM(cx, cy, fine.zone);
    const [dem, osm, nlcd, soils, util, linked, atlas14] = await Promise.all([
      fetchDEM(fine, fetcher, (p) => lDem.set(`3DEP bare-earth DEM at 1 m (${Math.round(p * 100)}%)`, 'run')).then((d) => {
        const native = d.sourceRes != null && d.sourceRes <= 1.01;
        lDem.set(`DEM ${fine.nx.toLocaleString()} × ${fine.ny.toLocaleString()} at 1 m`, native ? 'ok' : 'warn',
          native ? `native 1 m lidar · ${d.sources.slice(0, 2).join(', ')}` : `finest source here is ${d.sourceRes?.toFixed(0) ?? '?'} m, so 1 m is interpolated`);
        return d;
      }),
      fetchOSM(bounds, fetcher).then((o) => { lOsm.set(`${o.buildings.length.toLocaleString()} buildings, ${o.roads.length.toLocaleString()} road segments`, 'ok', 'OpenStreetMap contributors, ODbL'); return o; }),
      fetchNLCD(fine, fetcher, decodeImage).then((c) => { lLc.set(`${c.label} land cover → Manning’s n, impervious %`, 'ok'); return c; })
        .catch((e) => { lLc.set('Land cover unavailable, using urban defaults', 'warn', e.message); return null; }),
      fetchSoils(bounds, fetcher).then((s) => { lSoil.set(`${s.length} soil map units → infiltration`, 'ok', [...new Set(s.map(u => u.hsg || 'urban/none'))].join(', ')); return s; })
        .catch((e) => { lSoil.set('Soils unavailable, using compacted-fill rate', 'warn', e.message); return []; }),
      ut ? fetchUtility(fine.lonlatBounds(), fetcher).then((u) => { lUtil.set(`${u.inlets.length.toLocaleString()} real inlets, ${u.outfalls.length} outfalls nearby`, 'ok', `${u.utility.name} · ${u.combined ? 'combined sewer area' : 'separate storm sewers'} · pipes not published, synthesized`); return u; })
        .catch((e) => { lUtil.set('Utility inlets unavailable, synthetic placement', 'warn', e.message); return null; }) : Promise.resolve(null),
      lLink ? loadLinked(links, bounds).then((d) => { lLink.set(`Linked: ${d.pipes.length} pipes, ${d.inlets.length} inlets, ${d.outfalls.length} outfalls`, 'ok', d.notes.join(' · ')); return d; })
        .catch((e) => { lLink.set('Linked data failed', 'err', e.message); return null; }) : Promise.resolve(null),
      fetchAtlas14(clon, clat, fetcher).then((p) => { lA14.set(`Atlas 14 at site: 100-yr 1-hr ${p.median[4][6]} mm`, 'ok', `Vol. ${p.volume} v${p.version}, ${p.region}`); return p; })
        .catch((e) => { lA14.set('No NOAA Atlas 14 estimates here: design storms come from the site record', 'warn', e.message); return null; }),
    ]);
    const curbSel = $('curbSel').value, curb = curbSel === 'auto' ? (dem.sourceRes > 1.5 ? 0.15 : 0) : Number(curbSel);
    const lCond = log('Conditioning terrain');
    await new Promise(r => setTimeout(r, 0));
    const f = buildFine(fine, dem, osm, nlcd, soils, { curb });
    f.channels = breachChannels(fine, f, osm.waterways.filter(w => /river|stream|brook|canal|ditch|drain/.test(w.kind))); // embankments over unmapped crossings
    lCond.set('Terrain conditioned', 'ok', `${fmtArea(f.stats.buildingArea)} buildings as walls · ${fmtArea(f.stats.roadArea)} streets` + (curb ? ` burned ${curb * 100} cm` : ' (lidar curbs kept as surveyed)')
      + ` · ${osm.culverts.length} mapped culverts linked · ${f.channels.breaches} road embankments breached on mapped streams`);
    model = { fine, f, base: f, dem, osm, nlcd, soils, curb, atlas14, util, linked, site: [clon, clat], poly: S.poly };
    applyScenario(); // the active design scenario, if any (model.base stays existing conditions)
    $('downspout').value = util?.combined ? 100 : 0; $('downspout').dispatchEvent(new Event('input')); // combined-sewer rowhouses: downspouts tie into the sewer
    $('a14Btn').textContent = atlas14 ? 'Atlas 14 design' : 'Site-record design';
    for (const id of ['a14dur', 'pattern', 'which']) $(id).closest('.field').hidden = !atlas14; // site-record storms: 24 h, recorded shape
    if (!atlas14) setStormSource('const'); // until the record has loaded
    loadHistory().catch((e) => { $('histEvent').innerHTML = '<option value="">Unavailable</option>'; $('histNote').textContent = 'Historic record unavailable: ' + e.message; });
    updateStorm();
$('spacing').addEventListener('input', () => { $('spacingOut').textContent = $('spacing').value + ' m'; }); $('spacingOut').textContent = $('spacing').value + ' m';
$('downspout').addEventListener('input', () => { $('downspoutOut').textContent = $('downspout').value + ' %'; }); $('downspoutOut').textContent = $('downspout').value + ' %';
$('lumpRate').addEventListener('input', () => { $('lumpRateOut').textContent = $('lumpRate').value + ' mm/hr'; }); $('lumpRateOut').textContent = $('lumpRate').value + ' mm/hr';
swmmReady.then(updateDrainUI);
    await mapReady; await gpuReady;
    drawStatic();
    setTiers();
    $('runBtn').disabled = !device; $('resetBtn').disabled = false;
    if (!device) log('WebGPU is required to run the solver', 'err');
    resetRun();
    if (!ws.last) checkWatershed({ quiet: true }); // does anything drain in from outside? (background, after the build)
    obsNote(); $('hwmBtn').disabled = false; groundwaterNote(); setupInflow().catch((e) => { $('inflowNote').textContent = 'River inflow unavailable: ' + e.message; }).finally(built);
  } catch (e) {
    built();
    console.error(e); log('Build failed: ' + e.message, 'err');
  } finally { $('buildBtn').disabled = false; }
};

function drawStatic() {
  const { fine, nlcd } = model, corners = fine.corners();
  for (const c of Object.values(canvases)) { c.width = fine.nx; c.height = fine.ny; }
  if (nlcd) {
    const img = new ImageData(fine.nx, fine.ny);
    for (let k = 0; k < nlcd.length; k++) { const c = NLCD_COLORS[nlcd[k]]; if (c) { img.data[4 * k] = c[0]; img.data[4 * k + 1] = c[1]; img.data[4 * k + 2] = c[2]; img.data[4 * k + 3] = 255; } }
    canvases.lc.getContext('2d').putImageData(img, 0, 0);
  }
  canvases.depth.getContext('2d').clearRect(0, 0, fine.nx, fine.ny);
  setCanvasLayer('shade', canvases.shade, corners, 'bld-fill', $('tShade').checked, 0.75);
  setCanvasLayer('lc', canvases.lc, corners, 'bld-fill', $('tLc').checked && !!nlcd, 0.6);
  setCanvasLayer('dz', canvases.dz, corners, 'bld-fill', $('tDz').checked, 0.9);
  setCanvasLayer('depth', canvases.depth, corners, 'area-line', true, S.opacity);
  map.getSource('bld').setData(buildingsFC());
  drawDesign();
  showAreaOutline(fine);
}

function giLabel() {
  const g = run?.gi, parts = [];
  if (g?.pavedArea) parts.push(`${fmtArea(g.pavedArea)} permeable pavement`);
  if (g?.gardenArea) parts.push(`${fmtArea(g.gardenArea)} rain gardens`);
  if (run?.green) parts.push(`green roofs on ${Math.round(run.green * 100)}% of roofs (first ${GI.greenRoofRetention * 1000} mm held)`);
  if (run?.storage?.length) parts.push(`${run.storage.length} drawn underground storage units holding ${fmtVol(run.storage.reduce((a, t) => a + t.volume, 0))}`);
  if (run?.tanks?.length) parts.push(`${run.tanks.reduce((a, t) => a + t.volume, 0).toLocaleString()} m³ of tanks at ${run.tanks.length} outfall manholes`);
  return parts.length ? parts.join(' · ') : 'none (set under Drainage)';
}
function designRow() {
  const d = model.design; if (!d) return design.scenarios.length ? 'Existing conditions (no design applied)' : 'Existing conditions';
  const t = d.log.totals, b = model.f.designBuildings ?? [], w = d.log.warnings.length;
  return `Scenario <b>${d.name.replace(/</g, '&lt;')}</b>: ${d.log.features.length} features${b.length ? `, ${b.length} new building${b.length > 1 ? 's' : ''} (FFE ${b.map(x => (x.ffe / 0.3048).toFixed(2)).join(', ')} ft)` : ''}; ` +
    `cut ${fmtVol(t.cut)}, fill ${fmtVol(t.fill)}; impervious +${fmtArea(t.impAdded)} / −${fmtArea(t.impRemoved)}; applied to the 1 m model, nothing fetched again` + (w ? `<span class="pill warn">${w} warning${w > 1 ? 's' : ''}</span>` : '');
}
function setTiers() {
  const { dem, osm, nlcd, soils, curb, fine } = model, F = gridF();
  const native = dem.sourceRes != null && dem.sourceRes <= 1.01;
  const hsg = [...new Set(soils.map(s => s.hsg || 'none'))];
  const rows = [
    ['Terrain', `USGS 3DEP, ${native ? 'native 1 m lidar' : `${dem.sourceRes?.toFixed(0) ?? '?'} m source resampled to 1 m`}<span class="pill ${native ? 'good' : 'warn'}">${native ? 'tier 1' : 'tier 2'}</span>`],
    ...(inflow.entries.length ? [['River inflow', run?.inflowReady?.length ? run.inflowReady.map(e => e.label).join('; ') : `${inflow.entries.length} river ${inflow.entries.length > 1 ? 'entries' : 'entry'}; set a gauge under Storm`]] : []),
    ['Solver grid', F === 1 ? '1 m, same as DEM' : isSubgrid() ? `${F} m subgrid speed mode: each cell and face carries 1 m storage and conveyance tables, buildings as porosity, depths at 1 m<span class="pill warn">opt-in</span>`
      : `${F} m; depths downscaled to the 1 m DEM by water-surface projection`],
    ['Buildings', `${osm.buildings.length.toLocaleString()} OSM footprints as walls, ${osm.buildings.filter(b => b.height).length} with heights`],
    ['Site design', designRow()],
    ['Streets', `${osm.roads.length.toLocaleString()} OSM segments, n = ${MANNING_ROAD}, ${curb ? `burned ${curb * 100} cm` : 'lidar elevations kept'}`],
    ['Land cover', nlcd ? `${nlcd.label} (30 m) → Manning’s n, impervious %` : 'no NLCD here: urban defaults (n 0.045, compacted-fill infiltration)'],
    ['Soils', soilsRow()],
    ['Ground hazards', groundRow()],
    ['Drainage', drainLabel()],
    ['Boundaries', 'all edges free outfall: water leaves, nothing enters (no upstream inflow yet)'],
    ['Rivers', 'hydro-flattened lidar, no bathymetry'],
    ['Green infrastructure', giLabel()],
    ['Culverts & channels', `${osm.culverts.length} OSM culverts as links (barrel from diameter/width tags, else ${'stream 1.2 m, ditch 0.6 m'}); ${model.f.channels.breaches} road embankments (≤ 30 m long, ≤ 4 m high) breached where mapped streams cross roads with no mapped culvert`],
    ['Storm', stormLabel(currentStorm())],
    ['Extent', `${fine.nx} × ${fine.ny} m, EPSG:${fine.epsg}`],
  ];
  $('tiers').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ------------------------------------------------------------------ storm
const fmtDur = (min) => min < 60 ? `${min} min` : `${+(min / 60).toFixed(2)} h`;
let stormSrc = 'a14';
function setStormSource(s) {
  stormSrc = s;
  for (const b of $('stormSrc').children) b.setAttribute('aria-pressed', b.dataset.s === s);
  $('a14Ctl').hidden = s !== 'a14'; $('constCtl').hidden = s !== 'const'; $('histCtl').hidden = s !== 'hist';
  updateStorm();
}
/** The storm the next run will use (null before Atlas 14 is loaded). */
function currentStorm() {
  if (stormSrc === 'hist') return hist.storm;
  if (stormSrc === 'const') return constantStorm(Number($('rain').value), Number($('dur').value));
  if (!model?.atlas14) return hist.fit && hist.pattern ? recordStorm(hist.fit, hist.pattern, { ari: Number($('ari').value), factor: 1 + Number($('uplift').value) / 100, years: hist.years }) : null;
  const [pattern, peak] = $('pattern').value.split(':');
  return hyetograph(model.atlas14, { ari: Number($('ari').value), durationMin: Number($('a14dur').value), pattern, peak: Number(peak ?? 0.5), which: $('which').value, factor: 1 + Number($('uplift').value) / 100 });
}
function stormLabel(st) {
  if (!st) return 'none';
  if (st.pattern === 'constant') return `custom constant ${st.peakIntensity} mm/hr for ${fmtDur(st.durationMin)} (${st.total.toFixed(0)} mm)`;
  if (st.pattern === 'historic') return `historic: ${st.name}, ${st.total.toFixed(0)} mm over ${fmtDur(st.durationMin)} from ${new Date(st.t0).toISOString().slice(0, 16).replace('T', ' ')} UTC (${st.source})` +
    (st.wl ? `; water level from NOAA CO-OPS ${st.wl.station} (${st.wl.name}), peak ${Math.max(...st.wl.v).toFixed(2)} m ${st.wl.datum} on ${run?.stageCells ?? 0} open-water edge cells` : '');
  if (st.pattern === 'record') return `site-record ${st.ari}-yr 24 h: ${st.total.toFixed(0)} mm from a GEV fitted to ${st.gev.years} annual maxima (${hist.recordSource}), shaped like the largest recorded storm with an hourly record (${hist.patternFrom})` +
    `${st.factor !== 1 ? `, +${Math.round((st.factor - 1) * 100)}% uplift` : ''}<span class="pill warn">no Atlas 14</span>`;
  const p = model.atlas14, est = st.which === 'median' ? '' : `, ${st.which} 90% bound`;
  return `NOAA Atlas 14 ${st.ari}-yr ${fmtDur(st.durationMin)}${est}${st.factor !== 1 ? `, +${Math.round((st.factor - 1) * 100)}% uplift` : ''}: ` +
    `${st.total.toFixed(0)} mm, ${st.pattern === 'uniform' ? 'uniform' : 'alternating block'} (Vol. ${p.volume} v${p.version}, PDS)`;
}
function stormMeta(st) {
  const base = { pattern: st.pattern, durationMin: st.durationMin, blockMin: st.blockMin, totalMM: st.total, peakMMHR: st.peakIntensity, intensityMMHR: st.intensity };
  if (st.pattern === 'constant') return { source: 'custom constant', ...base };
  if (st.pattern === 'record') return { source: 'site-record GEV (L-moments) on annual-maximum daily rainfall × 1.13; pattern of the largest recorded storm with a real hourly record', record: hist.recordSource,
    patternFrom: hist.patternFrom, ari: st.ari, gev: st.gev, climateFactor: st.factor, ...base };
  if (st.pattern === 'historic') return { source: st.source, event: st.name, startUTC: new Date(st.t0).toISOString(), returnPeriods: st.rp, ...base,
    waterLevel: st.wl ? { station: st.wl.station, name: st.wl.name, datum: st.wl.datum, tUTC: st.wl.t.map(t => new Date(t).toISOString()), m: st.wl.v } : null };
  const p = model.atlas14;
  return { source: 'NOAA Atlas 14 (PFDS, partial-duration series)', volume: p.volume, version: p.version, region: p.region, siteLonLat: [p.lon, p.lat],
    ari: st.ari, estimate: st.which, climateFactor: st.factor, peakPosition: st.pattern === 'block' ? st.peak : null, ...base };
}
function updateStorm() {
  const st = currentStorm();
  drawHyeto();
  if (!st) { $('stormTag').textContent = ''; $('stormSummary').textContent = model ? 'Loading the site rainfall record…' : 'Build a model to load the design rainfall for the site.'; return; }
  $('stormTag').textContent = st.pattern === 'constant' ? `${st.total.toFixed(0)} mm` : st.pattern === 'historic' ? `${st.name} · ${st.total.toFixed(0)} mm` : `${st.ari}-yr ${fmtDur(st.durationMin)} · ${st.total.toFixed(0)} mm`;
  if (st.pattern === 'historic') $('stormSummary').textContent = histSummary(st);
  else if (st.pattern === 'record') $('stormSummary').innerHTML = `${st.total.toFixed(0)} mm in 24 h. NOAA Atlas 14 has no estimates here (western Washington and Oregon), so this depth comes from a GEV ` +
    `fitted to ${st.gev.years} years of annual-maximum rainfall at the site (${hist.recordSource}); return periods beyond ~${2 * st.gev.years} years are extrapolation. ` +
    `The hourly pattern is the largest recorded storm with a real hourly record (${hist.patternFrom}), scaled to this depth. Peak ${st.peakIntensity.toFixed(0)} mm/hr.`;
  else if (st.pattern === 'constant') $('stormSummary').textContent = `${st.total.toFixed(0)} mm over ${fmtDur(st.durationMin)}. Not tied to a return period.`;
  else {
    const p = model.atlas14, lo = ddf(p, st.ari, st.durationMin, 'lower') * st.factor, hi = ddf(p, st.ari, st.durationMin, 'upper') * st.factor;
    $('stormSummary').textContent = `${st.total.toFixed(0)} mm in ${fmtDur(st.durationMin)} (Atlas 14 90% interval ${lo.toFixed(0)}–${hi.toFixed(0)} mm` +
      `${st.factor !== 1 ? ', with uplift' : ''}). Peak ${st.peakIntensity.toFixed(0)} mm/hr for 5 min. NOAA Atlas 14 Vol. ${p.volume} v${p.version} (${p.region}) at ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}.`;
  }
  if (model) setTiers();
}
function lockStorm(on) { for (const id of ['stormSrc', 'a14Ctl', 'constCtl', 'histCtl']) $(id).classList.toggle('locked', on); }
$('stormSrc').onclick = (e) => { const b = e.target.closest('button'); if (b) setStormSource(b.dataset.s); };
for (const id of ['ari', 'a14dur', 'pattern', 'which', 'uplift', 'rain', 'dur']) $(id).addEventListener('input', updateStorm);

// ------------------------------------------------------------------ historic storms
const hist = { catalog: null, asos: null, gauge: null, storm: null };
/** Where Atlas 14 has no estimates: GEV on the record's annual maxima + the hourly shape of its largest storm. */
async function fitSiteRecord(daily, lon, lat) {
  const am = annualMaxima24h(daily); hist.fit = fitGEV(am.map(a => a.mm)); hist.years = am.length;
  if (!hist.fit) throw new Error(`only ${am.length} complete years of record`);
  // shape: the largest recorded storm that has a real hourly record. Older gridded hours are often the daily total
  // spread evenly, so a flat 24 h is rejected and the next storm (or the airport gauge) is tried
  const real = (p) => p && Math.max(...p) > 1.5 / 24;
  const gauge = await H.nearestASOS(lon, lat, fetcher, 50).catch(() => null);
  hist.pattern = null;
  for (const top of [...daily].sort((a, b) => b.mm - a.mm).slice(0, 6)) {
    const d0 = new Date(Date.parse(top.date) - 864e5).toISOString().slice(0, 10), d1 = new Date(Date.parse(top.date) + 864e5).toISOString().slice(0, 10);
    for (const get of [() => (daily.station ? null : H.fetchHourly(lon, lat, d0, d1, fetcher)), () => (gauge ? H.fetchASOS1min(gauge.id, Date.parse(d0 + 'T00:00Z'), Date.parse(d1 + 'T23:59Z'), fetcher) : null)]) {
      const series = await Promise.resolve().then(get).catch(() => null), p = series && wettest24(series);
      if (real(p)) { hist.pattern = p; hist.patternFrom = `${top.date}, ${top.mm.toFixed(0)} mm that day, ${series.source ?? 'hourly record'}`; break; }
    }
    if (hist.pattern) break;
  }
  if (!hist.pattern) { hist.pattern = new Array(24).fill(1 / 24); hist.patternFrom = 'no storm with a real hourly record: uniform'; }
  if (stormSrc === 'const') setStormSource('a14'); else updateStorm();
}
async function loadHistory() {
  const [lon, lat] = model.site;
  $('histEvent').innerHTML = '<option value="">Searching the record…</option>'; $('histLoad').disabled = true;
  const [daily, storms, asos, gauge] = await Promise.all([
    H.fetchDailyRecord(lon, lat, fetcher), H.fetchHurdat(fetcher).catch(() => []),
    H.nearestASOS(lon, lat, fetcher).catch(() => null), H.nearestTideGauge(lon, lat, fetcher).catch(() => null)]);
  hist.catalog = H.catalog(H.rainEvents(daily, 12), H.cyclonesNear(storms, lon, lat, 250)); hist.asos = asos; hist.gauge = gauge;
  hist.recordSource = daily.source; hist.gridded = !daily.station;
  if (!model.atlas14) await fitSiteRecord(daily, lon, lat).catch((e) => { $('stormSummary').textContent = 'Site-record design storm unavailable: ' + e.message; });
  const md = (d) => new Date(d + 'T12:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  $('histEvent').innerHTML = hist.catalog.map((e, i) => `<option value="${i}">${e.name ? e.name + ' · ' : ''}${md(e.peakDate)}${e.total != null ? ` · ${e.total.toFixed(0)} mm` : ` · passed ${e.cyclone.minKm.toFixed(0)} km`}</option>`).join('');
  $('histSrc').querySelector('[value=blend]').disabled = $('histSrc').querySelector('[value=gauge]').disabled = !asos;
  if (!asos) $('histSrc').value = 'hourly';
  $('histSrc').querySelector('[value=hourly]').disabled = $('histSrc').querySelector('[value=blend]').disabled = !hist.gridded || $('histSrc').querySelector('[value=blend]').disabled;
  if (!hist.gridded) $('histSrc').value = 'gauge';
  $('histSrc').querySelector('[value=gauge]').textContent = asos ? `Airport gauge ${asos.id}, ${asos.km.toFixed(1)} km (5 min)` : 'Airport gauge (none within 30 km)';
  $('coastRow').hidden = !gauge;
  if (gauge) $('coastLabel').textContent = `Observed water level at ${gauge.name} (${gauge.km.toFixed(0)} km) on open-water edges`;
  $('histNote').textContent = `${daily.length.toLocaleString()} days of rainfall since ${daily[0].date.slice(0, 4)} (${daily.source}), ${hist.catalog.filter(e => e.cyclone).length} hurricane tracks within 250 km (NOAA HURDAT2)` +
    (gauge ? `, tide gauge ${gauge.id} ${gauge.name} ${gauge.km.toFixed(0)} km away.` : '. No tide gauge within 60 km.');
  $('histLoad').disabled = false;
}
$('histLoad').onclick = async () => {
  const e = hist.catalog?.[Number($('histEvent').value)]; if (!e) return;
  const btn = $('histLoad'); btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const [lon, lat] = model.site, pad = 86400e3;
    const d0 = new Date(Date.parse(e.start) - pad).toISOString().slice(0, 10), d1 = new Date(Date.parse(e.end) + pad).toISOString().slice(0, 10);
    const src = hist.gridded ? $('histSrc').value : 'gauge';
    if (!hist.gridded && !hist.asos) throw new Error('no hourly rainfall here: no gridded record and no airport gauge with a 1-minute archive within 30 km');
    const hourly = hist.gridded ? await H.fetchHourly(lon, lat, d0, d1, fetcher) : { t0: Date.parse(d0 + 'T00:00Z'), stepMin: 60, mm: new Array(24 * (1 + (Date.parse(d1) - Date.parse(d0)) / 864e5)).fill(0) };
    let series = hourly, blockMin = 60;
    if (src !== 'hourly' && hist.asos) {
      const g = await H.fetchASOS1min(hist.asos.id, hourly.t0, hourly.t0 + hourly.mm.length * 3600e3, fetcher);
      series = src === 'gauge' ? g : H.blendSeries(hourly, g); blockMin = 5;
    }
    let st = H.seriesStorm(series, { blockMin, name: e.name ?? `Storm of ${e.peakDate}` });
    if (!st) st = { blockMin: 60, depth: [0], intensity: [0], total: 0, peakIntensity: 0, durationMin: 60, pattern: 'historic', name: e.name, source: series.source, t0: Date.parse(e.peakDate + 'T00:00Z') };
    if ($('tCoast').checked && hist.gauge) {
      const wl = await H.fetchWaterLevel(hist.gauge.id, Date.parse(d0 + 'T00:00Z'), Date.parse(d1 + 'T23:59Z'), fetcher);
      wl.name = hist.gauge.name;
      st = padForSurge(st, wl); st.wl = wl;
    }
    st.rp = model.atlas14 ? Object.fromEntries([5, 15, 60, 180, 360, 1440].map(m => [m, H.maxWindow(st, m)]).filter(([, d]) => d != null && d > 0)
      .map(([m, d]) => [m, { mm: d, ...H.returnPeriod(model.atlas14, m, d) }])) : null;
    hist.storm = st; updateStorm(); if (model && !(run?.solver)) resetRun();
  } catch (err) { console.error(err); $('histNote').textContent = 'Could not load this event: ' + err.message; }
  finally { btn.disabled = false; btn.textContent = 'Load event'; }
};
/** Extend a rain window with dry blocks so the run spans the surge peak (12 h before to 6 h after). */
function padForSurge(st, wl) {
  let pk = 0; wl.v.forEach((v, i) => { if (v > wl.v[pk]) pk = i; });
  const bs = st.blockMin * 60e3, a = Math.min(st.t0, wl.t[pk] - 12 * 3600e3), b = Math.max(st.t0 + st.depth.length * bs, wl.t[pk] + 6 * 3600e3);
  const pre = Math.max(0, Math.round((st.t0 - a) / bs)), total = Math.max(pre + st.depth.length, Math.round((b - st.t0) / bs) + pre);
  const depth = [...new Array(pre).fill(0), ...st.depth, ...new Array(total - pre - st.depth.length).fill(0)];
  return { ...st, depth, intensity: depth.map(d => d * 60 / st.blockMin), durationMin: depth.length * st.blockMin, t0: st.t0 - pre * bs };
}
function histSummary(st) {
  const rp = st.rp ? Object.entries(st.rp).map(([m, r]) => `${fmtDur(Number(m))} ${r.mm.toFixed(0)} mm ${r.label}`).join(' · ') : '';
  const wl = st.wl ? ` Water level peaks at ${Math.max(...st.wl.v).toFixed(2)} m NAVD88 (${st.wl.name}).` : '';
  return `${st.name}: ${st.total.toFixed(0)} mm, peak ${st.peakIntensity.toFixed(0)} mm/hr over ${st.blockMin} min. ${rp ? 'Against Atlas 14 at the site: ' + rp + '.' : ''}${wl} Source: ${st.source}.`;
}
/** Water level at simulation time t (s), or null. */
const stageAt = (st, t) => (st?.wl ? H.levelAt(st.wl, st.t0 + t * 1000) : null);

/**
 * Edge cells of the solver grid that meet open water: NLCD open water / wetland under the cell, or a mapped stream or
 * river within 30 m. Only these see the observed water level; the rest of the boundary stays a free outfall.
 */
function waterEdgeCells(c, F) {
  const fine = model.fine, W = fine.nx, lines = (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line));
  const near = (fi, fj) => lines.some(l => { for (let s = 0; s + 1 < l.length; s++) { const [ax, ay] = l[s], [bx, by] = l[s + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((fi - ax) * dx + (fj - ay) * dy) / L2)); if (Math.hypot(fi - ax - t * dx, fj - ay - t * dy) * fine.dx < 30) return true; } return false; });
  const out = [];
  for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) {
    if (I && J && I < c.nx - 1 && J < c.ny - 1) continue;
    const K = J * c.nx + I; if (!c.mask[K]) continue;
    const fi = I * F + F / 2, fj = J * F + F / 2, cls = model.nlcd?.[Math.min(fine.ny - 1, fj | 0) * W + Math.min(W - 1, fi | 0)];
    if (cls === 11 || cls === 90 || cls === 95 || near(fi, fj)) out.push(K);
  }
  return out;
}

/** Water-level chart (single series, m NAVD88) on the hyetograph's time axis. */
function drawWL(t) {
  const st = run?.storm ?? currentStorm(), box = $('wlPlot');
  if (!st?.wl) { $('wlFig').hidden = true; return; }
  $('wlFig').hidden = false; $('wlTitle').textContent = `Observed water level at ${st.wl.name}, m NAVD88`;
  const W = Math.max(240, box.clientWidth || 340), Hh = 96, L = 34, R = 6, T = 8, B = 76, dur = st.durationMin * 60e3;
  const pts = st.wl.t.map((tt, i) => [(tt - st.t0) / dur, st.wl.v[i]]).filter(([f]) => f >= 0 && f <= 1);
  if (!pts.length) { $('wlFig').hidden = true; return; }
  const lo = Math.floor(Math.min(...pts.map(p => p[1])) * 2) / 2, hi = Math.max(lo + 0.5, Math.ceil(Math.max(...pts.map(p => p[1])) * 2) / 2);
  const x = (f) => L + f * (W - L - R), y = (v) => B - (B - T) * (v - lo) / (hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Observed water level">`;
  for (const v of [lo, (lo + hi) / 2, hi]) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`;
  s += `<path class="wl" d="M${pts.map(([f, v]) => `${x(f).toFixed(1)},${y(v).toFixed(1)}`).join('L')}"/>`;
  if (t != null) s += `<line class="now" x1="${x(t * 1000 / dur)}" x2="${x(t * 1000 / dur)}" y1="${T}" y2="${B}"/>`;
  box.innerHTML = s + '</svg>';
}

// Hyetograph chart: one series (intensity per 5-min block), single hue; elapsed blocks solid, upcoming tinted.
let hy = null;
function drawHyeto() {
  const st = run?.storm ?? currentStorm(), box = $('hyeto');
  drawWL(null);
  if (!st) { box.innerHTML = ''; $('hyetoFig').hidden = true; hy = null; return; }
  $('hyetoFig').hidden = false;
  const W = Math.max(240, box.clientWidth || 340), H = 132, L = 34, R = 6, T = 8, B = 112, n = st.intensity.length;
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500].find(s => st.peakIntensity / s <= 4) ?? 1000, ymax = Math.ceil(st.peakIntensity / step) * step;
  const slot = (W - L - R) / n, gap = slot >= 4 ? 2 : slot >= 2 ? 1 : 0, bw = Math.max(0.5, slot - gap), y = (v) => B - (B - T) * v / ymax;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hyetograph: ${stormLabel(st)}">`;
  for (let v = 0; v <= ymax + 1e-9; v += step) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  st.intensity.forEach((v, i) => {
    const x = L + i * slot + gap / 2, top = y(v), r = Math.min(4, bw / 2, B - top);
    s += `<path class="bar" data-i="${i}" d="M${x},${B}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${B}Z"/>`;
  });
  const lab = (min) => min >= 120 ? `${+(min / 60).toFixed(1)} h` : `${min} min`;
  for (const f of [0, 0.5, 1]) s += `<text x="${L + f * (W - L - R)}" y="${B + 14}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${lab(Math.round(f * st.durationMin))}</text>`;
  s += `<line class="now" id="hyNow" x1="0" x2="0" y1="${T}" y2="${B}" visibility="hidden"/><rect id="hyHit" x="${L}" y="${T}" width="${W - L - R}" height="${B - T}" fill="transparent"/></svg>`;
  box.innerHTML = s;
  hy = { st, bars: [...box.querySelectorAll('.bar')], L, slot, W, B, lastBlock: -2 };
  const tip = $('hyetoTip'), hit = box.querySelector('#hyHit');
  hit.onmousemove = (e) => {
    const r = box.querySelector('svg').getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, i = Math.min(n - 1, Math.max(0, Math.floor((x - L) / slot)));
    hy.bars.forEach((b, k) => b.classList.toggle('hot', k === i));
    tip.hidden = false; tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (r.height * y(st.intensity[i]) / H + 18) + 'px';
    tip.textContent = `${i * st.blockMin}–${(i + 1) * st.blockMin} min · ${st.intensity[i].toFixed(0)} mm/hr · ${st.depth[i].toFixed(1)} mm`;
  };
  hit.onmouseleave = () => { tip.hidden = true; hy.bars.forEach(b => b.classList.remove('hot')); };
}
function drawHyetoNow(t) {
  drawWL(t);
  if (!hy || hy.st !== run?.storm) drawHyeto();
  if (!hy) return;
  const block = Math.floor(t / (hy.st.blockMin * 60));
  if (block !== hy.lastBlock) { hy.bars.forEach((b, k) => b.classList.toggle('future', k > block)); hy.lastBlock = block; }
  const now = $('hyNow'), x = hy.L + Math.min(hy.bars.length, t / (hy.st.blockMin * 60)) * hy.slot;
  now.setAttribute('x1', x); now.setAttribute('x2', x); now.setAttribute('visibility', 'visible');
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && run?.out) drawDepth(); });
addEventListener('resize', () => { if ($('hyeto').firstChild) { drawHyeto(); if (run?.solver) drawHyetoNow(run.solver.t); } });

// ------------------------------------------------------------------ drainage
let drainSrc = 'network', swmmEngine = null, swmmError = null;
const swmmReady = loadSWMM().then((e) => { swmmEngine = e; }).catch((e) => { swmmError = e; });
function setDrainSource(d) {
  drainSrc = d;
  for (const b of $('drainSrc').children) b.setAttribute('aria-pressed', b.dataset.d === d);
  $('lumpedCtl').hidden = d !== 'lumped'; $('networkCtl').hidden = d !== 'network';
  if (map.getLayer('net-pipes')) for (const l of ['net-pipes', 'net-nodes', 'net-grates']) map.setLayoutProperty(l, 'visibility', d === 'network' && $('tNet').checked ? 'visible' : 'none');
  if (model) resetRun();
}
$('drainSrc').onclick = (e) => { const b = e.target.closest('button'); if (b && !(run?.solver)) setDrainSource(b.dataset.d); };
for (const id of ['designAri', 'spacing', 'lumpRate', 'downspout', 'giPave', 'giGarden', 'giRoof', 'giTank', 'twoWay']) $(id).addEventListener('change', () => { if (model && !(run?.solver)) resetRun(); });
for (const [id, fmt] of [['giPave', v => v + ' %'], ['giGarden', v => v + ' %'], ['giRoof', v => v + ' %'], ['giTank', v => (v > 0 ? Number(v).toLocaleString() + ' m³' : 'none')]]) {
  const show = () => { $(id + 'Out').textContent = fmt($(id).value); }; $(id).addEventListener('input', show); show();
}
$('tNet').onchange = () => setDrainSource(drainSrc);

/** Network for the current solver grid (inlet cells depend on the cell size). */
function makeNetwork(c, F, { ignoreLayer = false } = {}) {
  // precedence: pipes in the infrastructure layer, then linked pipes, then the street-following estimate; catch basins
  // and outfalls in the layer replace the linked / utility ones
  const lay = ignoreLayer ? null : infra.inputs(), L = model.linked;
  const inlets = lay?.inlets.length ? lay.inlets : L?.inlets.length ? L.inlets : model.util?.inlets;
  const outfalls = lay?.outfalls.length ? lay.outfalls : L?.outfalls.length ? L.outfalls : model.util?.outfalls;
  const withQ = (net) => { if (net) for (const p of net.pipes) p.Qfull = 0.3117 / (p.n ?? net.opts.n) * p.D ** (8 / 3) * Math.sqrt(p.S); return net; };
  if (lay?.pipes.length) { // tier 1: pipes the user drew or imported
    const net = realNetwork(model.fine, model.f, lay.pipes, { ...c, F }, { realInlets: inlets, outfalls: lay.outfalls });
    if (net) { net.drawn = true; return withQ(net); }
  }
  if (L?.pipes.length) { // tier 1: the user's linked pipes
    const net = realNetwork(model.fine, model.f, L.pipes, { ...c, F }, { realInlets: inlets });
    if (net) return withQ(net);
  }
  return withQ(synthNetwork(model.fine, model.f, model.osm, model.atlas14, { ...c, F }, { designARI: Number($('designAri').value), spacing: Number($('spacing').value),
    realInlets: inlets, realOutfalls: outfalls }));
}
const nodeLL = (n) => { const fine = model.fine; return fromUTM(fine.x0 + n.p[0] * fine.dx, fine.y1 - n.p[1] * fine.dx, fine.zone); };
function drawNetwork(net) {
  const src = map.getSource('net'); if (!src) return;
  if (!net) { src.setData(emptyFC); return; }
  const ll = net.nodes.map(nodeLL);
  src.setData({ type: 'FeatureCollection', features: [
    ...net.pipes.map((p, k) => ({ type: 'Feature', id: k, properties: { kind: 'pipe', D: p.D, use: 0 }, geometry: { type: 'LineString', coordinates: [ll[p.from], ll[p.to]] } })),
    ...net.nodes.map((n, i) => ({ type: 'Feature', id: net.pipes.length + i, properties: { kind: n.outfall ? 'outfall' : n.storage ? 'storage' : 'node', state: 0 }, geometry: { type: 'Point', coordinates: ll[i] } })),
    ...net.inlets.filter(g => g.grates > 0).map((g, k) => { const fine = model.fine, W = fine.nx; return { type: 'Feature', id: net.pipes.length + net.nodes.length + k, properties: { kind: 'grate', real: g.real ? 1 : 0 },
      geometry: { type: 'Point', coordinates: fromUTM(fine.x0 + ((g.fineCell % W) + 0.5) * fine.dx, fine.y1 - (((g.fineCell / W) | 0) + 0.5) * fine.dx, fine.zone) } }; }),
  ] });
}
let lastNetDraw = 0;
/** Pipe fill (depth/diameter) and surcharged manholes from the latest SWMM state. */
function drawNetworkState() {
  const cp = run?.coupler; if (!cp || document.hidden || !map.isStyleLoaded() || performance.now() - lastNetDraw < 500) return; // the basemap may still be loading
  lastNetDraw = performance.now();
  const net = run.net, P = net.pipes.length;
  net.pipes.forEach((p, k) => map.setFeatureState({ source: 'net', id: k }, { use: Math.min(1.2, cp.state.depth[k] / p.D) }));
  net.nodes.forEach((n, i) => map.setFeatureState({ source: 'net', id: P + i }, { sur: !n.outfall && cp.state.head[i] > n.ground - 0.05 ? 1 : 0 }));
}
function drainLabel() {
  if (drainSrc === 'none') return 'none: every drop stays on the surface';
  if (drainSrc === 'lumped') return `lumped ${$('lumpRate').value} mm/hr removed from street cells<span class="pill warn">tier 3</span>`;
  const net = run?.net;
  if (!net) return 'synthetic network (not generated)';
  if (net.drawn) return `${net.stats.realPipes} pipes from the infrastructure layer (drawn / imported), inverts ${net.stats.inverts}, ${net.stats.filledSizes} sizes filled from neighbours; ` +
    `${net.stats.grates} ${net.stats.realInlets ? 'catch basins' : 'assumed inlets, one per manhole'}${run?.storage?.length ? `; ${run.storage.length} storage units` : ''}<span class="pill good">tier 1</span>`;
  if (net.tier === 1) return `${net.stats.realPipes} linked pipes (${model.linked.names.pipes.join(', ')}), inverts ${net.stats.inverts}, ${net.stats.filledSizes} sizes filled from neighbours; ` +
    `${net.stats.grates} ${net.stats.realInlets ? 'linked' : 'assumed'} inlets<span class="pill good">tier 1</span>`;
  const u = model.util, realTxt = net.stats.realInlets ? `${net.stats.grates} real ${u.utility.name} inlets (${u.combined ? 'combined sewer' : 'storm sewer'}) on synthetic pipes` : `synthetic network: ${net.stats.inlets} inlets`;
  return `${realTxt}, ${(net.stats.pipeLength / 1000).toFixed(1)} km of pipe (${net.stats.minD ?? 0.3}–${net.stats.maxD} m), ${net.stats.outfalls} outfalls; ` +
    `sized for the ${net.opts.designARI}-yr storm (${net.designIntensity10.toFixed(0)} mm/hr at 10 min) by the rational method<span class="pill ${net.stats.realInlets ? 'good' : 'warn'}">${net.stats.realInlets ? 'tier 2+' : 'tier 2'}</span>` +
    (swmmEngine ? '' : ' — SWMM engine not built, network not simulated');
}
function updateDrainUI() {
  const net = run?.net;
  $('drainTag').textContent = drainSrc === 'network' && net ? `${net.stats.grates} ${net.stats.realInlets ? 'real ' : ''}inlets · ${(net.stats.pipeLength / 1000).toFixed(1)} km` : drainSrc === 'lumped' ? `${$('lumpRate').value} mm/hr` : '';
  if (drainSrc === 'network') {
    if (!model) $('netSummary').textContent = 'Data tier 2: a synthetic network following the streets, sized by the rational method. Build a model to generate it.';
    else if (!run) $('netSummary').textContent = 'Generating the network…';
    else if (!net) $('netSummary').textContent = 'No drivable streets in this area, so no network.';
    else {
      const s = net.stats;
      const u = model.util, head = net.drawn
        ? `Data tier 1: <b>${s.realPipes} pipes from the infrastructure layer</b>, ${(s.pipeLength / 1000).toFixed(2)} km from ${Math.round(s.minD * 1000)} to ${Math.round(s.maxD * 1000)} mm; ` +
          `inverts ${s.inverts}${s.filledSizes ? `, ${s.filledSizes} missing sizes taken from neighbouring pipes` : ''}. ${s.grates} ${s.realInlets ? 'catch basins' : 'inlets assumed, one per manhole'}` +
          `${s.unconnectedGrates ? ` (${s.unconnectedGrates} more than 30 m from any pipe, left out)` : ''}; ${s.offsiteOutlets} pipes continue past the area, ${s.interiorEnds} end inside it` +
          `${run.storage?.length ? `; ${run.storage.length} storage units (${fmtVol(run.storage.reduce((a, t) => a + t.volume, 0))}) joined to manholes` : ''}.`
        : net.tier === 1
        ? `Data tier 1: <b>${s.realPipes} of your pipes</b> (${model.linked.names.pipes.join(', ')}), ${(s.pipeLength / 1000).toFixed(1)} km from ${Math.round(s.minD * 1000)} to ${Math.round(s.maxD * 1000)} mm; ` +
          `inverts ${s.inverts}${s.filledSizes ? `, ${s.filledSizes} missing sizes taken from neighbouring pipes` : ''}. ${s.grates} ${s.realInlets ? 'linked inlets' : 'inlets assumed, one per manhole'}` +
          `${s.unconnectedGrates ? ` (${s.unconnectedGrates} more than 30 m from any pipe, left out)` : ''}; ${s.tees} side connections joined; ${s.offsiteOutlets} pipes continue past the area, ${s.interiorEnds} end inside it.`
        : s.realInlets
        ? `Data tier 2+: <b>${s.grates} real inlets</b> from ${u.utility.name} (${u.utility.license})${s.unconnectedGrates ? `, ${s.unconnectedGrates} too far from a street to connect` : ''}; ` +
          `pipes are synthetic because ${u.utility.name} does not publish its mains. ${s.junctions} manholes, ${(s.pipeLength / 1000).toFixed(1)} km of pipe from ${Math.round(s.minD * 1000)} to ${Math.round(s.maxD * 1000)} mm, ` +
          `${s.outfalls} outfalls${s.realOutfalls ? ` (${s.realOutfalls} real)` : ''}${u.combined ? ' where pipes leave the area (combined sewer: they continue to the interceptor)' : ''}. Sized for`
        : `Data tier 2 (synthetic): ${s.junctions} manholes with inlets every ~${net.opts.spacing} m, ${(s.pipeLength / 1000).toFixed(1)} km of pipe from ${Math.round(s.minD * 1000)} to ${Math.round(s.maxD * 1000)} mm, ` +
          `${s.outfalls} outfalls (streams and where streets leave the area). Sized for`;
      $('netSummary').innerHTML = net.tier === 1 ? head + (swmmEngine ? ` EPA SWMM ${swmmEngine.version} engine ready.` : '') : head + ` the ${net.opts.designARI}-yr storm, ${net.designIntensity10.toFixed(0)} mm/hr at a 10-min time of concentration.` +
        (swmmEngine ? ` EPA SWMM ${swmmEngine.version} engine ready.` : ` <b>The SWMM engine is not built yet</b> (${swmmError ? 'run <code>npm run build:swmm</code>' : 'loading…'}), so the run would treat the network as absent.`);
    }
  }
  if (model) setTiers();
}

// ------------------------------------------------------------------ run
function stopRun() { if (run) { run.playing = false; run.solver?.destroy(); if (run.swmm && !run.swmmClosed) { try { run.swmm.finish(); } catch { /* not started */ } } } run = null; }
function resetRun() {
  stopRun();
  if (!model || !device) return;
  if (!updateSizeNote()) { $('runBtn').disabled = true; return; }
  const F = gridF(), roofF = Number($('roof').value) / 100, lay = infra.inputs();
  let c;
  if (isSubgrid()) { // speed mode: berms go into the 1 m ground, then the cell and face tables are built from it
    const berms = lay.barriers.filter(b => b.type === 'berm'); let f = model.f;
    if (cal().manning !== 1) f = { ...f, manning: f.manning.map(v => v * cal().manning) }; // calibration: the tables carry n
    if (berms.length) { const z = Float64Array.from(model.f.z); buildBarriers(berms, model.fine, model.f, { nx: model.fine.nx, ny: model.fine.ny, z, mask: model.f.bld.map(b => 1 - b) }, 1); f = { ...model.f, z }; }
    const sg = buildSubgrid(f, F);
    c = { ...sg, sg, manning: new Float64Array(sg.nx * sg.ny) };
    if (model.f.roofs?.size) { c.bldId = coarseIds(model.f, F); c.roofs = model.f.roofs; } // new buildings' roofs (site design)
    c.rainField = sgRain(c, roofRouting(c.mask, c.nx, c.ny, roofF, c.roofs ? { ids: c.bldId, roofs: c.roofs } : null).rainField, roofF);
  } else { c = coarsen(model.f, F, roofF); if (cal().manning !== 1) c.manning = c.manning.map(v => v * cal().manning); }
  // infiltration: Green-Ampt from the soil survey (c.infil becomes K; the run carries ψΔθ and the water-table storage)
  const wt = $('wtDepth').value.trim() === '' ? null : Math.max(0.05, Number($('wtDepth').value));
  const ga = $('infilModel').value === 'ga' && model.f.ga ? gaCells(model.f, c.nx, c.ny, F, c.mask, { Se: WETNESS[$('wetness').value], wtOverride: wt, perCellArea: !!c.sg }) : null;
  if (ga) c.infil = ga.K;
  if (cal().infil !== 1) c.infil = c.infil.map(v => v * cal().infil);
  // scour: critical shear of the erodible ground and the n for the shear (the subgrid mode has no per-cell n of its own)
  const scour = model.f.tauC ? scourCells(model.f, c.nx, c.ny, F, c.mask, c.sg ? null : c.manning) : null;
  // sediment transport: the standard solver only, and it needs 9 storage buffers per shader stage (as active tiles)
  const sedOk = $('sedOn').checked && scour && model.f.texture && !c.sg && device?.limits.maxStorageBuffersPerShaderStage >= 10;
  const debris = sedOk && $('debrisOn').checked;
  const sed = sedOk ? sedimentCells(model.f, c.nx, c.ny, F, c.mask, { topsoil: Math.max(0, Number($('topsoil').value) || 0), debris: debris ? { z: c.z, dx: F } : null }) : null;
  if ($('sedOn').checked && !sed) $('sedNote').textContent = c.sg ? 'Sediment transport needs the standard solver: pick a 1–4 m grid without the subgrid speed mode.' : 'This GPU cannot run the sediment kernels (needs 10 storage buffers per shader stage).';
  if ($('debrisOn').checked && !sed) $('debrisNote').textContent = 'Debris flows need sediment transport on (and the standard solver).';
  if (scour && c.sg && cal().manning !== 1) scour.n.forEach((v, k) => { scour.n[k] = v * cal().manning; });
  c.inside = model.poly ? polygonCells(model.fine, model.poly, F) : null; // polygon area: cells outside become sinks
  // control lines (Site design → Control line): their solver faces, booked every step
  const clines = design.analysis.features.filter(f => f.properties.type === 'cline' && f.geometry?.coordinates?.length > 1);
  const lf = clines.length ? CMP.lineFaces(clines.map(f => toCells(model.fine, f.geometry.coordinates).map(([x, y]) => [x / F, y / F])), c.nx, c.ny) : { faces: [], perLine: [] };
  const bars = buildBarriers(lay.barriers, model.fine, model.f, c, F, { fill: !c.sg }); // berms fill the bed: before anything reads c.z
  infra.setBarriers(bars.list, bars.skipped);
  // bank tops next to open water (after the berms fill the bed)
  let banks = null;
  if ($('bankOn').checked && !c.sg && model.f.texture) {
    const fine = model.fine, lines = (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line));
    banks = findBanks(c, F, model.f, waterCells(c, F, fine, model.nlcd, lines));
    $('bankNote').textContent = banks.count ? `${banks.count.toLocaleString()} bank-top cells within 20 m of open water, evaluated every step` + (banks.rock ? ` (${banks.rock.toLocaleString()} more left out: over twice as high as the soil is deep, so rock-controlled).` : '.') : 'No banks of 0.5 m or more within 20 m of open water in this area.';
  } else if ($('bankOn').checked && c.sg) $('bankNote').textContent = 'Bank stability needs the standard solver: pick a 1–4 m grid without the subgrid speed mode.';
  const net = drainSrc === 'network' ? makeNetwork(c, F) : null;
  if (net) net.opts = { ...net.opts, clog: cal().clog };
  const down = Number($('downspout').value) / 100; // downspouts straight into the nearest manhole (needs the SWMM engine)
  const drains = c.roofs && [...c.roofs.values()].some(r => r.roof === 'network'); // new buildings with roof drains (site design)
  const roof = net && swmmEngine && (down > 0 || drains) ? roofConnections(c, net, down, Number($('roof').value) / 100, 80, { toCell: llCell }) : null;
  if (roof) c.rainField = c.sg ? sgRain(c, roof.rainField, roofF, net, down, roof.roofArea) : roof.rainField;
  if (c.roofs) design.setRoofLinks(new Map([...c.roofs].filter(([, r]) => r.roof === 'network').map(([id]) => [id, roof?.links.has(id)
    ? (roof.links.get(id) == null ? 'to the ground: no manhole within 30 m (or within 5 m of the one chosen)' : `to manhole ${roof.links.get(id)} of the network`)
    : !net ? 'to the ground: no pipe network in this run' : 'to the ground: the SWMM engine is not loaded']))); // where new buildings' roof drains go
  const gi = giLayers(model.f, c, F, { pavement: Number($('giPave').value) / 100, rainGarden: Number($('giGarden').value) / 100 });
  const tanks = net ? addTanks(net, Number($('giTank').value)) : [];
  const storage = attachStorage(net, lay.storage, model.fine, model.f).attached; // after addTanks, which clears storage
  infra.setAttached(net ? storage : []);
  drawNetwork(net);
  const green = Number($('giRoof').value) / 100; // green roofs hold the first 25 mm on their share of the roofs
  // until they fill, only the other roofs shed water: downspouts take down·(1 − green), the ground (1 − down)·(1 − green)·roof
  const rf = Number($('roof').value) / 100, roofEarly = green > 0 ? (roof ? roofConnections(c, net, down * (1 - green), (1 - green) * (1 - down) * rf / Math.max(1e-9, 1 - down * (1 - green)), 80, { toCell: llCell })
    : { rainField: roofRouting(c.mask, c.nx, c.ny, rf * (1 - green), c.roofs ? { ids: c.bldId, roofs: c.roofs } : null).rainField }) : null;
  if (roofEarly && c.sg) roofEarly.rainField = roof ? sgRain(c, roofEarly.rainField, (1 - green) * (1 - down) * rf / Math.max(1e-9, 1 - down * (1 - green)), net, down * (1 - green), roofEarly.roofArea)
    : sgRain(c, roofEarly.rainField, rf * (1 - green));
  const roofStages = roofHoldStages(c, net, roof, green);
  const culv = culvertLinks(model.fine, c, F, [...model.osm.culverts.map(cv => ({ ...cv, D: culvertDiameter(cv.tags, cv.kind) })), ...lay.culverts], new Set(net ? net.inlets.map(g => g.cell) : []));
  run = { ga: ga ? { psiD: ga.psiD, fmax: ga.fmax, perv: ga.perv } : null, scour, sed, debris, banks: banks?.count ? banks.banks : null, bars, gi, tanks, storage, green, roofEarly, roofStages, stage: 0, scenario: model.design?.name ?? null, lines: { defs: clines.map((f, l) => ({ id: f.id, name: f.properties.name ?? null, faces: lf.perLine[l] })), faces: lf.faces, samples: clines.map(() => [[0, 0, 0, 0]]) }, culv, roof, net, F, c, solver: null, playing: false, t: 0, out: null, hmax: null, smax: null, view: null, storm: null, frames: [], nextFrame: 0, K: 8, rtf: 0, mass: null, lastRead: 0, gen: ++runGen };
  run.done = new Promise((resolve) => { run.finish = resolve; }); // resolved when the run ends (sweeps wait on it)
  $('runBtn').disabled = false; $('runBtn').textContent = 'Run'; $('exportBtn').disabled = false; $('hud').hidden = false;
  $('runTag').textContent = `${c.nx.toLocaleString()} × ${c.ny.toLocaleString()} @ ${F} m`;
  canvases.depth.getContext('2d').clearRect(0, 0, canvases.depth.width, canvases.depth.height); refreshCanvas('depth');
  for (const id of ['roDt', 'roSteps', 'roRain', 'roArea', 'roVol', 'roOut', 'roMass', 'roRtf']) $(id).textContent = '–';
  $('barNote').hidden = !bars.list.length; $('barNote').textContent = bars.list.length ? `${bars.list.length} flood barrier${bars.list.length > 1 ? 's' : ''} on ${bars.faces.length.toLocaleString()} cell faces` + (bars.list.some(b => b.fill > 0) ? `, ${fmtVol(bars.list.reduce((a, b) => a + b.fill, 0))} of berm fill in the terrain` : '') + '.' : '';
  lockStorm(false); drawHyeto(); updateDrainUI(); $('netReadouts').hidden = true;
  for (const id of ['drainSrc', 'networkCtl', 'lumpedCtl']) $(id).classList.remove('locked');
  $('hudTime').textContent = '0:00'; $('hudMax').textContent = '–'; $('hudRain').textContent = '–';
}
const llCell = (ll) => toCells(model.fine, [ll])[0];
/**
 * Rain fields while new buildings' green roofs and cisterns fill (site design): each holds its roof rain until the rain
 * depth reaches its retention, so the field changes at each distinct retention (and at the area's green-roof retention
 * when that slider is on). → [{ until (m of rain), rainField, roofArea }] for the stages before the last, or null
 */
function roofHoldStages(c, net, roof, green) {
  const holds = c.roofs ? [...c.roofs].filter(([, r]) => r.retention > 0 && r.roof !== 'network') : [];
  if (!holds.length) return null;
  const rf = Number($('roof').value) / 100, down = Number($('downspout').value) / 100;
  const ends = [...new Set([...holds.map(([, r]) => r.retention), ...(green > 0 ? [GI.greenRoofRetention] : [])])].sort((a, b) => a - b);
  return ends.map(until => {
    const held = new Set(holds.filter(([, r]) => r.retention >= until).map(([id]) => id)), g = until <= GI.greenRoofRetention ? green : 0;
    if (roof) {
      const sewer = down * (1 - g), ground = g ? (1 - g) * (1 - down) * rf / Math.max(1e-9, 1 - down * (1 - g)) : rf;
      const r = roofConnections(c, net, sewer, ground, 80, { held, toCell: llCell });
      if (c.sg) r.rainField = sgRain(c, r.rainField, ground, net, sewer, r.roofArea);
      return { until, ...r };
    }
    let field = roofRouting(c.mask, c.nx, c.ny, rf * (1 - g), { ids: c.bldId, roofs: c.roofs, held }).rainField;
    if (c.sg) field = sgRain(c, field, rf * (1 - g));
    return { until, rainField: field };
  });
}
function ensureSolver() {
  if (run.solver) return;
  const { c, F } = run;
  let infil = c.infil;
  if (drainSrc === 'lumped') { const extra = lumpedInfil(c, c.roadFrac, Number($('lumpRate').value)); infil = c.infil.map((v, k) => v + extra[k]); }
  const coupled = drainSrc === 'network' && run.net && swmmEngine;
  const st0 = currentStorm(), stageCells = st0?.wl ? waterEdgeCells(c, F) : undefined;
  run.stageCells = stageCells?.length ?? 0;
  run.culverts = run.culv.length ? new CulvertLinks(run.culv, c.z, { cellArea: F * F }) : null;
  run.watch = run.bars.faces.length ? new BarrierWatch(run.bars, c.z, F) : null;
  const lv0 = run.watch?.levels(0), crest = run.watch ? run.bars.faces.map((q, m) => ({ i: q.i, j: q.j, axis: q.axis, z: lv0[m], C: q.C, ground: q.ground })) : undefined;
  const base = [...(coupled ? run.net.inlets.map(g => g.cell) : []), ...(run.culverts?.cells ?? [])], used = new Set(base);
  const inflows = (run.inflowReady ?? []).map(e => ({ ...e, cells: entryCells(c, e.at, { used }) })).filter(e => e.cells.length);
  inflows.forEach(e => e.cells.forEach(k => used.add(k)));
  run.inflow = inflows.length ? new InflowLinks(inflows) : null;
  const cells = [...base, ...(run.inflow?.cells ?? [])], inletCells = cells.length ? cells : undefined;
  run.solver = new GPUSolver(device, {
    nx: c.nx, ny: c.ny, dx: F, z: c.z, mask: c.mask, manning: c.manning, infil, inlets: inletCells, stageCells, subgrid: c.sg ?? undefined,
    sink: c.inside?.map(v => 1 - v), lines: run.lines.faces.length ? run.lines.faces : undefined, gi: run.gi ?? undefined, crest, ga: run.ga ?? undefined, scour: run.scour ?? undefined, sediment: run.sed ?? undefined, debris: run.debris, banks: run.banks ?? undefined, rainField: run.roofStages ? run.roofStages[0].rainField : run.roofEarly ? run.roofEarly.rainField : c.rainField,
    bc: { west: 'outflow', east: 'outflow', south: 'outflow', north: 'outflow' }, hdry: 1e-5, hfront: 1e-3, dtDry: 2,
  });
  const start = startWater(c, F, stageCells); // rivers, lakes and tidal water from the gauges (or dry: the lidar surface)
  run.solver.setDepth(start ? (x, y) => start.depth[Math.min(c.ny - 1, Math.floor(y / F)) * c.nx + Math.min(c.nx - 1, Math.floor(x / F))] : () => 0);
  run.storm = currentStorm(); lockStorm(true);
  if (coupled) {
    run.swmm = swmmEngine; run.swmmClosed = false;
    run.twoWay = $('twoWay').checked;
    run.inp = toINP(run.net, model.fine, { durationS: Math.ceil(tStop() / 60) * 60 + 3600, title: 'FloodSim synthetic network (data tier 2)', pressurise: run.twoWay });
    run.swmm.open(run.inp);
    run.coupler = new Coupler(run.solver, run.net, run.swmm, c.z, { interval: 2, roofArea: run.roofStages ? run.roofStages[0].roofArea ?? run.roof?.roofArea : run.roofEarly?.roofArea ?? run.roof?.roofArea, twoWay: run.twoWay });
    $('netReadouts').hidden = false;
  }
  const members = [run.coupler, run.culverts, run.inflow].filter(Boolean);
  run.exchanger = members.length > 1 || run.culverts || run.inflow ? new LinkHub(run.solver, members, 2) : run.coupler; // every 2 s
  for (const id of ['drainSrc', 'networkCtl', 'lumpedCtl']) $(id).classList.add('locked');
  setTiers();
  run.hmax = new Float32Array(c.nx * c.ny); run.smax = new Float32Array(c.nx * c.ny);
  run.haz = new HazardTracker(c.nx * c.ny);
}
/** Gauge readings for a run's start levels and river inflow (fetched now, or the ones a paired run already used, so
 *  both runs of a comparison see the same forcing). → false when the run was replaced meanwhile. */
async function prepareRun(r) {
  await inflow.ready; // the gauge lists (they load after the build)
  if (run !== r) return false;
  if (pairPrep) {
    r.levelsReady = pairPrep.levelsReady; r.inflowReady = pairPrep.inflowReady;
    if (r.levelsReady) r.levelSrc = await levelSources(r.levelsReady, r.c, r.F);
    return run === r && !r.solver;
  }
  if ($('startWater').value === 'gauge') {
    try { r.levelsReady = await prepareLevels(); if (r.levelsReady) r.levelSrc = await levelSources(r.levelsReady, r.c, r.F); } catch (e) { log('Gauge levels: ' + e.message, 'warn'); }
  }
  try { r.inflowReady = await prepareInflow(); } catch (e) { log('River inflow: ' + e.message, 'warn'); r.inflowReady = []; }
  return run === r && !r.solver;
}
let pairPrep = null;
$('runBtn').onclick = async () => {
  if (!run) resetRun(); if (!run) return;
  if (!run.solver && !(await prepareRun(run))) return;
  try { ensureSolver(); } catch (e) { log(e.message, 'err'); return; }
  run.playing = !run.playing;
  $('runBtn').textContent = run.playing ? 'Pause' : 'Run';
  if (run.playing) { run.lastWall = performance.now(); run.wall0 ??= run.lastWall; loop(run.gen); }
};
$('resetBtn').onclick = () => resetRun();
$('roof').oninput = () => { $('roofOut').textContent = $('roof').value + ' %'; };
$('roof').onchange = () => { if (model && (!run || !run.solver)) resetRun(); };

/** Yield to the event loop without requestAnimationFrame or setTimeout, both of which browsers throttle in hidden tabs. */
const nextTick = (fn) => { const ch = new MessageChannel(); ch.port1.onmessage = fn; ch.port2.postMessage(0); };
const stormEnd = () => (run?.storm ?? currentStorm()).durationMin * 60;
const tStop = () => stormEnd() + Number($('tail').value) * 60;
const speedMul = () => { const v = Number($('speed').value); return v >= 100 ? Infinity : Math.round(10 ** (v / 25)); }; // 1×…10 000×, then max

/** Steps are cut only at multiples of STEP_QUANTUM s of simulated time (and at the storm's own stop times: hyetograph
 *  blocks, exchanges, barrier deployments, saved frames), never at a wall-clock time, so a rerun repeats the same steps
 *  and gives Δ = 0. The speed setting only decides how far to step per frame. Anything that switches mid-run (green
 *  roofs filling, the tide) switches on a quantum. */
const STEP_QUANTUM = 10;
async function loop(gen) {
  if (!run || run.gen !== gen || !run.playing) return;
  const s = run.solver, now = performance.now(), wall = Math.min(0.25, (now - run.lastWall) / 1000); run.lastWall = now;
  try {
    const Q = STEP_QUANTUM, atQ = Math.abs(s.t - Q * Math.round(s.t / Q)) < 1e-3, pace = speedMul();
    run.paceT = pace === Infinity ? null : Math.min((run.paceT ?? s.t) + pace * wall, s.t + pace * 0.5);
    let tEnd = Math.min(tStop(), (Math.floor(s.t / Q + 1e-6) + 1) * Q);
    if (atQ && run.lines.faces.length && s.t > run.lines.samples[0].at(-1)[0] + 1e-6) { // control lines: cumulative volume on every quantum
      const L = await s.readLines(); if (!run || run.gen !== gen) return;
      run.lines.samples.forEach((sm, l) => sm.push([s.t, L.net[l], L.plus[l], L.minus[l]])); run.lines.last = L;
    }
    if (!atQ) { /* roof stages and the stage boundary switch on quanta only */ } else if (run.roofStages) { // new buildings' green roofs and cisterns (and the area's green roofs) fill one after another
      const depth = s.vol.rain / Math.max(1, s.rainArea);
      while (run.stage < run.roofStages.length && depth >= run.roofStages[run.stage].until) {
        const next = run.roofStages[++run.stage] ?? { rainField: run.c.rainField, roofArea: run.roof?.roofArea };
        s.setRainField(next.rainField); if (run.coupler && next.roofArea) run.coupler.roofArea = next.roofArea;
        if (run.roofEarly && !run.greenFull && depth >= GI.greenRoofRetention) run.greenFull = s.t;
      }
    } else if (run.roofEarly && !run.greenFull && s.vol.rain / Math.max(1, s.rainArea) >= GI.greenRoofRetention) {
      run.greenFull = s.t; s.setRainField(run.c.rainField); if (run.coupler && run.roof) run.coupler.roofArea = run.roof.roofArea;
    }
    const rr = rainAt(run.storm, s.t); // piecewise-constant hyetograph: never let a frame straddle a block change
    s.rainRate = rr.mmhr * MMHR; tEnd = Math.min(tEnd, rr.until);
    const stage = atQ ? stageAt(run.storm, s.t) : null; // observed water level on open-water edges, refreshed every quantum
    if (stage != null) { s.setStage(stage); if (run.coupler) run.coupler.stage = stage; }
    if (run.exchanger) tEnd = Math.min(tEnd, run.exchanger.tNext);          // stop exactly at each 1D–2D / culvert exchange
    if (run.watch) { const lv = run.watch.levels(s.t); if (lv) s.setCrestLevels(lv); tEnd = Math.min(tEnd, run.watch.next(s.t)); } // deployable barriers go up on time
    const every = Number($('frameEvery').value), frameDue = every > 0 && tEnd >= run.nextFrame - 1e-6;
    if (every > 0) tEnd = Math.min(tEnd, Math.max(run.nextFrame, s.t));       // and at each saved export frame
    const need = tEnd - s.t;
    // adaptive batch: aim for ~40 ms of GPU work per submit, but never queue steps past tEnd (they would be dt = 0 work)
    let K = Math.max(1, Math.min(run.K, s.dtAvg > 0 ? Math.ceil(need / s.dtAvg) + 2 : run.K)); // steps past tEnd would be dt = 0 work
    if (need <= 0) K = 0;
    if (run.paceT != null) { const allow = run.paceT - s.t; K = allow <= 0 ? 0 : Math.min(K, Math.max(1, Math.ceil(allow / (s.dtAvg || 1)))); } // the speed setting
    const t0 = s.t, c0 = performance.now();
    const wantOut = frameDue || s.t + need >= tStop() - 1e-3 || !run.out || now - run.lastOut > 150; // full readback only to draw / save
    const out = await s.frame(tEnd, K, wantOut);
    if (!run || run.gen !== gen) return;
    const ms = performance.now() - c0;
    if (K > 0 && K >= run.K) run.K = Math.max(1, Math.min(400, Math.round(run.K * Math.min(2, Math.max(0.5, 40 / Math.max(1, ms))))));
    if (run.exchanger && s.t >= run.exchanger.tNext - 1e-6) { await run.exchanger.exchange(); if (run.coupler) drawNetworkState(); }
    run.t = s.t;
    if (wall > 0) run.rtf = run.rtf ? 0.9 * run.rtf + 0.1 * ((s.t - t0) / wall) : (s.t - t0) / wall;
    if (out) {
      run.out = out; run.lastOut = now;
      const N = run.c.nx * run.c.ny;
      for (let k = 0; k < N; k++) { const h = out[2 * k], v = out[2 * k + 1]; if (h > run.hmax[k]) run.hmax[k] = h; if (h > 0.01 && v > run.smax[k]) run.smax[k] = v; }
      saveFrame(out);
      if (run.watch) { run.watch.books(s.t, await s.readBarriers()); if (!run || run.gen !== gen) return; }
      if (!document.hidden) drawDepth(); // keep solving in the background; draw only when someone can see it
      if (now - run.lastRead > 2500) { run.lastRead = now; await readMass(); if (!run || run.gen !== gen) return; }
      readouts();
    }
    if (s.t >= tStop() - 1e-3) {
      run.playing = false; $('runBtn').textContent = 'Done'; $('runBtn').disabled = true; await readMass();
      if (run.swmm) {
        run.swmmReport = run.swmm.finish(); run.swmmClosed = true; run.netMass = SWMM.continuity(run.swmmReport);
        // combined books: rain − infiltration − edge outflow − pipe outfalls − (surface + network storage), over rain
        // SWMM's external outflow is the outfalls plus any water sent back up through inlets (negative lateral flow)
        const c = run.netMass, m = run.mass, outfalls = c.externalOutflow * 1000 - run.coupler.totals.latOut;
        const rain = m.rain + run.coupler.totals.roofToSewer; // rain on the surface + rain piped straight from roofs
        run.netMass.combinedRel = (rain + (run.inflow?.totals.volume ?? 0) - m.infil - m.outflow - outfalls - m.volume - c.finalStored * 1000) / rain; // + river inflow
      }
      readouts(); run.wall = (performance.now() - run.wall0) / 1000;
      if (S.obs.length) scoreAndShow();
      const done = run; await finishRecord();
      await projects.runFinished(); done.finish?.(); // filed before anyone (Run both) starts the next run
    }
  } catch (e) {
    console.error(e); run.playing = false; log('Solver error: ' + e.message, 'err'); run.finish?.(e); return;
  }
  nextTick(() => loop(gen));
}

// ------------------------------------------------------------------ run records (comparisons)
const records = [], baselines = new Map(); // this session's finished runs; existing-conditions runs by forcing hash
/** Everything that is not the design (src/compare.js fingerprint): two runs compare only when this matches. */
function forcingRecord(r) {
  const st = r.storm ?? currentStorm(), sample = (fn) => { const out = []; for (let t = 0; t <= tStop(); t += 60) out.push(+fn(t).toFixed(6)); return out; };
  const val = (...ids) => Object.fromEntries(ids.map(id => [id, $(id)?.type === 'checkbox' ? $(id).checked : $(id)?.value ?? null]));
  return {
    storm: st ? { ...stormMeta(st), waterLevel: undefined, depth: st.depth, t0: st.t0 ?? null } : null,
    inflow: (r.inflowReady ?? []).map(e => ({ label: e.label, site: e.site ?? null, at: e.at, flow: typeof e.flow === 'function' ? sample(e.flow) : e.flow })),
    tide: st?.wl ? { station: st.wl.station, t: st.wl.t, v: st.wl.v, edges: $('tCoast').checked } : null,
    startLevels: { mode: $('startWater').value, readings: r.levelsReady ? [...r.levelsReady.lv].map(([site, v]) => [site, v]) : null },
    antecedent: val('infilModel', 'wetness', 'wtDepth'),
    grid: { solver: $('dxSel').value, F: r.F },
    solver: { hdry: 1e-5, hfront: 1e-3, dtDry: 2, quantum: STEP_QUANTUM },
    runLength: { stop: tStop() },
    options: { sediment: !!r.sed, debris: !!r.debris, ...val('topsoil'), banks: !!r.banks },
    drainage: { src: drainSrc, ...val('designAri', 'spacing', 'downspout', 'roof', 'lumpRate', 'giPave', 'giGarden', 'giRoof', 'giTank', 'twoWay'), infra: CMP.hashOf(infra.layer), linked: linkedLinks(), cal: cal() },
    area: { box: S.area, poly: S.poly, curb: model.curb, curbSel: $('curbSel').value },
    commit: appCommit,
  };
}
/** Hash of the fine model a run used (the design's grids; existing conditions once per model). */
const gridHash = () => (model.f === model.base ? (model.baseHash ??= hashFine(model.base)) : (model.design.hash ??= hashFine(model.f)));
/**
 * After a run: the 1 m output grids (max depth, max water surface, max speed, max depth × speed, first wetting, time
 * above 15 cm, final depth; the worst ARR hazard class), the control-line books and the new buildings, kept as a
 * record for comparisons. An existing-conditions run is also the baseline for its forcing (its max water surface feeds
 * the floodplain-fill report); a scenario run checks its new buildings against their FFE.
 */
async function finishRecord() {
  const r = run, { c, F } = r, s = r.solver, fine = model.fine, W = fine.nx, Nf = W * fine.ny, z = model.f.z;
  const hz = await s.readHazard(), L = r.lines.faces.length ? await s.readLines() : null;
  if (run !== r) return;
  const maxD = F === 1 && !c.sg ? Float32Array.from(r.hmax) : Float32Array.from(toFine(c, r.hmax, 1));
  const finD = F === 1 && !c.sg ? Float32Array.from({ length: Nf }, (_, k) => r.out[2 * k]) : Float32Array.from(toFine(c, r.out, 2));
  const cellOf = (k) => (F === 1 ? k : (((k / W) | 0) / F | 0) * c.nx + ((k % W) / F | 0));
  const inModel = (K) => c.mask[K] && !(c.inside && !c.inside[K]);
  const wall = (k) => !inModel(cellOf(k)) || (model.f.bld[k] && !c.sg); // outside the model, or a building wall at 1 m
  // a solver-cell value on its 1 m pixels that got wet; `dry` elsewhere (0 for peaks, NaN for times that never came)
  const per = (v, dry) => { const o = new Float32Array(Nf); for (let k = 0; k < Nf; k++) o[k] = wall(k) ? NaN : maxD[k] > 0.005 ? v[cellOf(k)] : dry; return o; };
  const grids = {
    max_depth: maxD.map((v, k) => (wall(k) ? NaN : v)),
    max_wse: maxD.map((v, k) => (v > 0.005 && !wall(k) ? z[k] + v : NaN)),
    max_speed: per(hz.vmax, 0), max_dv: per(hz.dv, 0), t_wet: per(hz.tWet, NaN), t_above15: per(hz.duration, 0),
    final_depth: finD.map((v, k) => (wall(k) ? NaN : v)),
  };
  const hazard = new Float32Array(Nf); for (let k = 0; k < Nf; k++) hazard[k] = wall(k) ? NaN : maxD[k] > 0.005 ? hz.cls.arr[cellOf(k)] : 0;
  if (L) r.lines.samples.forEach((sm, l) => { if (sm.at(-1)[0] < s.t - 1e-6) sm.push([s.t, L.net[l], L.plus[l], L.minus[l]]); });
  const lines = r.lines.defs.map((d, l) => ({ id: d.id, name: d.name, faces: d.faces, volume: L ? L.net[l] : NaN, plus: L ? L.plus[l] : NaN, minus: L ? L.minus[l] : NaN, series: r.lines.samples[l] }));
  const m = r.mass ?? {}, outfalls = r.swmm && r.netMass ? r.netMass.externalOutflow * 1000 - (r.coupler?.totals.latOut ?? 0) : null;
  const newBuildings = (model.f.designBuildings ?? []).map(b => ({ id: b.id, name: b.name, ffe: b.ffe, critical: b.foundation === 'basement' ? b.opening : b.ffe, foundation: b.foundation, cells: b.cells, ring: b.ring }));
  const when = new Date(), forcing = CMP.fingerprint(forcingRecord(r));
  const rec = { id: ++recordSeq, scenario: r.scenario, label: `${r.scenario ?? 'Existing conditions'} · ${$('stormTag').textContent || 'storm'} · ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    saved: when.toISOString(), forcing, commit: appCommit, designHash: gridHash(), storm: stormLabel(r.storm), geo: { nx: W, ny: fine.ny, x0: fine.x0, y0: fine.y1 - fine.ny * fine.dx, dx: fine.dx },
    grids, hazard, lines, newBuildings, books: { rain: m.rain, infil: m.infil, outflow: m.outflow, outfalls, stored: m.volume }, design: model.design ? { name: model.design.name, totals: model.design.log.totals } : null };
  r.record = rec; records.push(rec);
  if (!rec.scenario) { baselines.set(forcing.hash, rec); model.baseWse = grids.max_wse; if (baselines.size > 3) baselines.delete(baselines.keys().next().value); }
  while (records.length > 6) { const i = records.findIndex(x => ![...baselines.values()].includes(x)); records.splice(i < 0 ? 0 : i, 1); }
  design.setLineResults(new Map(lines.map(l => { const st = CMP.lineStats(l); return [l.id, { volume: l.volume, plus: l.plus, minus: l.minus, peak: st.peak, tPeak: st.tPeak }]; })));
  if (rec.scenario) {
    const fl = floodedBuildings(model.f, grids.max_wse); r.flooded = fl; design.setResults(fl);
    if (fl.some(b => b.flooded)) log(`${fl.filter(b => b.flooded).length} of ${fl.length} new buildings flooded above the FFE (${r.scenario})`, 'warn');
  }
  compareUI.refresh();
}
let recordSeq = 0;
/** A record from a saved run folder (summary.json, grids/*.f32, lines.json, buildings.json). */
async function loadSaved(dir) {
  const folder = projects.current?.folder; if (!folder) throw new Error('no project open');
  const path = (p) => `runs/${dir}/${p}`, sm = JSON.parse(await readProjectFile(folder, path('summary.json')));
  if (!sm.grids) throw new Error(`run ${dir} was saved without 1 m grids`);
  const head = CMP.parseHeader(await readProjectFile(folder, path('grids/max_depth.hdr'))), grids = {};
  await Promise.all([...Object.keys(CMP.GRIDS), 'hazard_arr'].map(async k => { grids[k] = CMP.decodeF32(await readBytes(folder, path(`grids/${k}.f32`))); }));
  const json = async (p, d) => { try { return JSON.parse(await readProjectFile(folder, path(p))); } catch { return d; } };
  const lines = await json('lines.json', []), newBuildings = await json('buildings.json', []);
  return { id: 'saved:' + dir, scenario: sm.scenario === 'Existing conditions' ? null : sm.scenario, label: `${sm.scenario} · ${dir}`, saved: sm.savedUTC, forcing: sm.forcing, commit: sm.commit, designHash: sm.designHash,
    storm: sm.storm?.label, geo: head, grids: Object.fromEntries(Object.keys(CMP.GRIDS).map(k => [k, grids[k]])), hazard: grids.hazard_arr, lines, newBuildings, books: sm.books ?? null, design: sm.design ?? null };
}
async function savedRuns() {
  const folder = projects.current?.folder; if (!folder) return [];
  return (await (await fetch('/api/projects/runs?' + new URLSearchParams({ folder }), { headers: { 'x-floodsim': '1' } })).json()).runs;
}
/** Run existing conditions (unless a run with these settings is cached) and then the active scenario, with the same
 *  storm, gauge readings and settings, at full speed. → [before, after] records */
async function runPair(note) {
  if (!model || !device) throw new Error('Build a model first.');
  const sc = design.active; if (!sc || !sc.design.features.length) throw new Error('Pick a proposed scenario with features first (Site design).');
  const speed = $('speed').value; $('speed').value = 100; $('speed').dispatchEvent(new Event('input'));
  const toEnd = async (label) => {
    note(`Running ${label}…`); ensureSolver(); run.playing = true; $('runBtn').textContent = 'Pause'; run.lastWall = performance.now(); run.wall0 ??= run.lastWall; loop(run.gen);
    const e = await run.done; if (e) throw e; return run.record;
  };
  try {
    design.activate(null); applyScenario(); drawDesign(); resetRun();
    if (!(await prepareRun(run))) throw new Error('the run was replaced');
    pairPrep = { levelsReady: run.levelsReady, inflowReady: run.inflowReady };
    const fp = CMP.fingerprint(forcingRecord(run)).hash;
    const before = baselines.get(fp) ?? await toEnd('existing conditions');
    if (before === baselines.get(fp) && !run.record) note('Existing conditions with these settings already ran: reusing it.');
    design.activate(sc.name); applyScenario(); drawDesign(); resetRun();
    if (!(await prepareRun(run))) throw new Error('the run was replaced');
    const after = await toEnd(sc.name);
    note(`Done: ${before.label} and ${after.label}.`);
    return [before, after];
  } finally { pairPrep = null; $('speed').value = speed; $('speed').dispatchEvent(new Event('input')); }
}
const compareUI = initCompare(map, {
  records: () => [...records].reverse(), savedRuns, loadSaved, runPair, units: () => design.units,
  ctx: () => model && { geo: { nx: model.fine.nx, ny: model.fine.ny, x0: model.fine.x0, y0: model.fine.y1 - model.fine.ny * model.fine.dx, dx: model.fine.dx },
    z: model.base.z, bld: model.base.bld, toCell: llCell, prj: utmPRJ(model.fine.zone),
    siteRing: design.analysis.features.find(f => f.properties.type === 'site')?.geometry.coordinates[0] ?? null },
  setOverlay: (canvas, visible) => { if (model) setCanvasLayer('cmp', canvas, model.fine.corners(), 'area-line', visible, 0.9); },
  async exportFiles(files, name, bytes) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); a.download = name + '.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (projects.current) { const dir = `comparisons/${stamp()}_${name.slice(0, 40)}`; for (const f of files) await writeProjectFile(projects.current.folder, `${dir}/${f.name}`, f.data); }
  },
});
/** Surface mass balance plus exact max depths (the GPU tracks them every step). One at a time: each read folds the GPU's
 *  running totals into the books and restarts them, so two overlapping reads (a save during a run) would count twice. */
function readMass() {
  const r = run, p = (r.massQueue ?? Promise.resolve()).then(() => (run === r ? readMassNow() : null));
  r.massQueue = p.catch(() => {});
  return p;
}
async function readMassNow() {
  const st = await run.solver.readState(); run.mass = st.mass;
  if (run.culverts) { // water a culvert took upstream and has not yet delivered downstream counts as stored
    const m = run.mass, inTransit = run.culverts.pending.reduce((a, p) => a + p.vol, 0);
    m.culvertInTransit = inTransit; m.volume += inTransit; m.rel = (m.volume - m.expected) / Math.max(1e-30, Math.abs(m.expected), run.solver.vol.initial + m.rain + Math.max(0, -m.exchanged) + Math.max(0, -m.outflow));
  }
  const zs = run.c.sg ? run.c.z : null; // subgrid: the solver reports the peak level; keep depth at the lowest point
  for (let k = 0; k < st.hmax.length; k++) { const h = zs ? st.hmax[k] - zs[k] : st.hmax[k]; if (h > run.hmax[k]) run.hmax[k] = h; }
  if (run.watch) infra.setBarrierResults(run.watch.results());
  // hazard products are tracked every step on the GPU; reading them back is 32 bytes a cell, so a running large grid
  // refreshes them less often (about 4 MB per second of wall time), and the end of a run always reads them
  const now = performance.now(), every = Math.max(2500, run.c.nx * run.c.ny * 32 / 4e3);
  if (!run.playing || !run.lastHz || now - run.lastHz > every) { run.lastHz = now; run.haz.load(await run.solver.readHazard(), run.solver.t); await readGround(); hazardNote(); }
}
/** Subgrid mode: per solver cell, the area of its 1 m pixels that got at least 1 cm deep (else null: whole cells). */
function wetAreaOf() {
  const c = run.c; if (!c.sg) return null;
  const d = toFine(c, run.hmax, 1), fine = model.fine, wet = new Float64Array(c.nx * c.ny), A = fine.dx ** 2;
  for (let k = 0; k < d.length; k++) if (d[k] >= 0.01) wet[(((k / fine.nx) | 0) / c.F | 0) * c.nx + ((k % fine.nx) / c.F | 0)] += A;
  return (k) => wet[k];
}
/** Area in each peak hazard class (worst class reached) and the peak force, under the run readouts. */
function hazardNote() {
  const std = $('hazStd').value, cl = STANDARDS[std].classes, keep = (k) => run.c.mask[k] && (!run.c.inside || run.c.inside[k]);
  const a = run.haz.classAreas(std, run.F * run.F, keep, wetAreaOf()); let fmax = 0;
  for (let k = 0; k < run.haz.n; k++) if (run.haz.force[k] > fmax && keep(k)) fmax = run.haz.force[k];
  const parts = a.map((v, i) => (v > 0 ? `${cl[i].label} ${fmtArea(v)}` : '')).filter(Boolean);
  $('hazNote').hidden = !parts.length;
  $('hazNote').innerHTML = `Peak hazard (${STANDARDS[std].name}${run.c.sg ? `, speed mode: per ${run.F} m cell at its deepest point` : ''}): ${parts.join(' · ')}. Peak force ${fmax.toFixed(1)} kN/m (${Math.round(fmax * 68.52).toLocaleString()} lb/ft).`;
  if (run.sedState) {
    const sd = run.sedState; let lo = 0, hi = 0; for (let k = 0; k < sd.bed.length; k++) { if (sd.bed[k] < lo) lo = sd.bed[k]; if (sd.bed[k] > hi) hi = sd.bed[k]; }
    $('hazNote').innerHTML += ` Sediment: ${fmtVol(sd.totals.eroded)} eroded, ${fmtVol(sd.totals.deposited)} deposited (bed volume), ${fmtVol(sd.out)} of solids carried out (${sd.classes.filter(cl => cl.out > 0.01).map(cl => `${cl.name} ${fmtVol(cl.out)}`).join(', ') || 'none'}); deepest scour ${(lo * -100).toFixed(1)} cm, thickest deposit ${(hi * 100).toFixed(1)} cm.`
      + (run.debris ? ` Debris flows: ${sd.totals.failures.toLocaleString()} cells failed as shallow landslides (${fmtArea(sd.totals.failures * run.F * run.F)}).` : '');
  }
  if (run.bankState) {
    const n = [0, 0, 0, 0]; let unrated = 0; run.bankState.maxPf.forEach(p => { if (p === UNRATED) unrated++; else n[bankClass(p)]++; });
    $('hazNote').innerHTML += ` Bank collapse during the run, given the bank stood at the start: ${n[3].toLocaleString()} bank cells very likely, ${n[2].toLocaleString()} likely, ${n[1].toLocaleString()} possible (of ${run.banks.length.toLocaleString()} within 20 m of water${unrated ? `; ${unrated.toLocaleString()} grey: they stand only on strength the soil survey lacks (rock, cementation), not rated` : ''}).`;
  }
  if (model.f.collapse && run.hmax) {
    const A = model.fine.dx ** 2, cnt = [0, 0, 0, 0], W = model.fine.nx; run.lastMaxFine = null;
    for (let k = 0; k < model.f.collapse.length; k++) { if (!model.f.collapse[k] || model.f.bld[k]) continue; const n = collapseAt(k, k % W, (k / W) | 0); cnt[n] += A; }
    if (cnt[2] + cnt[3] > 0) $('hazNote').innerHTML += ` Collapsible soils wetted: ${cnt[3] ? fmtArea(cnt[3]) + ' high, ' : ''}${fmtArea(cnt[2])} moderate susceptibility (screening).`;
  }
  if (run.scour) {
    const sc = [0, 0, 0, 0], wa = wetAreaOf(), A = (k) => (wa ? wa(k) : run.F * run.F); let deep = 0;
    for (let k = 0; k < run.haz.n; k++) { if (!keep(k)) continue; const n = scourClass(run.haz.shear[k], run.scour.tauC[k]); if (n > 0) sc[n] += A(k); if (run.haz.erosion[k] > deep) deep = run.haz.erosion[k]; }
    if (sc[1] + sc[2] + sc[3] > 0) $('hazNote').innerHTML += ` Scour potential: ${['', 'low', 'moderate', 'high'].map((l, n) => (n && sc[n] ? `${l} ${fmtArea(sc[n])}` : '')).filter(Boolean).join(' · ')}, up to ${(deep * 100).toFixed(1)} cm (indicative).`;
  }
}

function saveFrame(out) {
  const every = Number($('frameEvery').value);
  if (!every || run.solver.t + 1e-6 < run.nextFrame) return;
  const N = run.c.nx * run.c.ny, d = new Float32Array(N), v = new Float32Array(N);
  for (let k = 0; k < N; k++) { d[k] = out[2 * k]; v[k] = out[2 * k + 1]; }
  run.frames.push({ t: run.solver.t, depth: d, speed: v });
  run.nextFrame = (Math.floor(run.solver.t / every) + 1) * every;
}

function readouts() {
  const s = run.solver, m = run.mass, A = run.F * run.F, out = run.out;
  $('roDt').textContent = s.lastDt ? (s.lastDt < 0.1 ? (s.lastDt * 1000).toFixed(1) + ' ms' : s.lastDt.toFixed(2) + ' s') : '–';
  $('roSteps').textContent = Math.round(s.steps).toLocaleString();
  const rainMM = s.vol.rain / s.rainArea * 1000;
  $('roRain').textContent = `${rainMM.toFixed(1)} of ${run.storm.total.toFixed(0)} mm`; $('hudRain').textContent = rainMM.toFixed(0) + ' mm';
  drawHyetoNow(s.t);
  let a = 0, mx = 0;
  if (run.c.sg && run.lastDraw) { const d = run.lastDraw.depth, Af = model.fine.dx ** 2; for (let k = 0; k < d.length; k++) { if (d[k] > 0.15) a += Af; if (d[k] > mx) mx = d[k]; } } // subgrid: at 1 m
  else for (let k = 0; k < run.c.nx * run.c.ny; k++) { if (run.c.inside && !run.c.inside[k]) continue; const h = out[2 * k]; if (h > 0.15) a += A; if (h > mx && run.c.mask[k]) mx = h; }
  $('roArea').textContent = fmtArea(a); $('hudMax').textContent = mx.toFixed(2) + ' m';
  $('hudTime').textContent = fmtTime(s.t);
  if (m) {
    $('roVol').textContent = fmtVol(m.volume); $('roOut').textContent = `${fmtVol(Math.max(0, m.outflow))} / ${fmtVol(m.infil)}`;
    $('roMass').textContent = Number.isFinite(m.rel) ? m.rel.toExponential(1) : '–';
  }
  if (run.coupler) {
    const tt = run.coupler.totals, sv = run.solver.vol.exchanged;
    $('roNetIn').textContent = fmtVol(tt.toNetwork); $('roNetOut').textContent = fmtVol(tt.toSurface);
    $('roNetSur').textContent = `${run.coupler.state.surcharged} of ${run.net.stats.junctions}`;
    $('roNetMass').textContent = run.netMass ? `${run.netMass.errorPct.toFixed(2)} % (combined ${(run.netMass.combinedRel * 100).toFixed(2)} %)` : 'at end of run';
  }
  if (run.watch) $('barNote').innerHTML = barrierText(run.watch.results());
  $('roRtf').textContent = run.playing && run.rtf ? (run.rtf >= 10 ? Math.round(run.rtf).toLocaleString() : run.rtf.toFixed(1)) + '× real time' : 'paused';
}

/** One line per barrier state: holding (lowest freeboard), overtopped (when, how much), not up yet. */
function barrierText(rs) {
  const held = rs.filter(r => !r.overtopped && Number.isFinite(r.minFreeboard)), over = rs.filter(r => r.overtopped), dry = rs.filter(r => !Number.isFinite(r.minFreeboard) && !r.overtopped);
  const parts = [];
  const fb = Math.min(...held.map(r => r.minFreeboard));
  if (held.length) parts.push(`<b>${held.length} holding</b> (${fb > 0 ? `lowest freeboard ${fb.toFixed(2)} m` : 'water up to a crest'}, peak load ${Math.max(...held.map(r => r.peakLoad)).toFixed(1)} kN/m)`);
  if (over.length) parts.push(`<b class="warn">${over.length} overtopped</b> from ${fmtTime(Math.min(...over.map(r => r.tOver ?? Infinity).filter(Number.isFinite), run.solver.t))}: ${fmtVol(over.reduce((a, r) => a + r.overVol, 0))} over, peak ${Math.max(...over.map(r => r.peakRate)).toFixed(2)} m³/s`);
  if (dry.length) parts.push(`${dry.length} with no water against ${dry.length > 1 ? 'them' : 'it'} yet`);
  return 'Flood barriers: ' + parts.join(' · ') + '. Click one in the drawer for its numbers.';
}

// ------------------------------------------------------------------ drawing
const RAMPS = {
  depth: { stops: [[0, [190, 236, 255]], [0.15, [96, 188, 232]], [0.5, [31, 120, 196]], [1.0, [21, 64, 160]], [2.0, [40, 20, 110]]], max: 2, unit: 'm', ticks: [0, 0.5, 1, 1.5, 2] },
  max: null,
  speed: { stops: [[0, [255, 245, 200]], [0.5, [250, 190, 80]], [1, [235, 110, 40]], [2, [180, 30, 40]], [3, [90, 0, 40]]], max: 3, unit: 'm/s', ticks: [0, 1, 2, 3] },
  hazard: { classes: true }, peakHaz: { classes: true }, scour: { classes: true }, collapse: { classes: true },
  grain: { stops: [[-50, [40, 90, 170]], [-10, [150, 190, 230]], [0, [240, 240, 240]], [10, [225, 190, 140]], [50, [130, 80, 30]]], min: -50, max: 50, unit: '%', ticks: [-50, -25, 0, 25, 50] },
  banks: { classes: true },
  bed: { stops: [[-10, [150, 20, 30]], [-3, [225, 90, 60]], [-0.5, [250, 200, 170]], [0, [240, 240, 240]], [0.5, [190, 215, 245]], [3, [80, 140, 220]], [10, [20, 50, 140]]], min: -10, max: 10, unit: 'cm', ticks: [-10, -5, 0, 5, 10] },
  force: { stops: [[0, [235, 245, 210]], [1, [180, 220, 120]], [3, [250, 190, 70]], [6, [225, 90, 40]], [10, [120, 20, 60]]], max: 10, unit: 'kN/m', ticks: [0, 2, 4, 6, 8, 10] },
  duration: { stops: [[0, [225, 240, 250]], [15, [150, 200, 235]], [45, [70, 130, 200]], [90, [40, 60, 150]], [180, [30, 15, 80]]], max: 180, unit: 'min', ticks: [0, 60, 120, 180] },
  arrival: { stops: [[0, [120, 20, 60]], [15, [215, 60, 45]], [30, [245, 160, 60]], [60, [250, 225, 130]], [120, [240, 245, 225]]], max: 120, unit: 'min', ticks: [0, 30, 60, 90, 120] },
};
RAMPS.max = RAMPS.depth;
const PEAK = new Set(['peakHaz', 'force', 'duration', 'arrival', 'scour', 'bed', 'collapse', 'banks', 'grain']);
const hazStd = () => STANDARDS[$('hazStd').value];
function rampColor(r, v) {
  const st = r.stops; if (v >= st[st.length - 1][0]) return st[st.length - 1][1];
  for (let i = 1; i < st.length; i++) if (v < st[i][0]) { const [a, ca] = st[i - 1], [b, cb] = st[i], t = (v - a) / (b - a); return [0, 1, 2].map(c => ca[c] + t * (cb[c] - ca[c])); }
  return st[0][1];
}
function drawLegend() {
  const r = RAMPS[S.view];
  if (r.classes) {
    const st = S.view === 'banks' ? { classes: BANK_CLASSES.map(c => ({ label: c.name.split(' (')[0], text: 'Probability of bank collapse: ' + c.name, color: c.color })), note: 'Bank collapse: the highest probability over the run that each bank top fails, given it stood at the start (planar failure through the toe, the soil’s c′ and φ′ with roots, river confinement, lagged bank water table; c′ ±40 %, tan φ′ ±10 %). Grey: stands only on strength the survey lacks (rock, cementation), not rated. No bathymetry: the toe is the lidar water surface.' }
      : S.view === 'collapse' ? { classes: COLLAPSE_CLASSES.map((label, i) => ({ label, text: label + ' collapse susceptibility, wetted by the flood', color: [[225, 225, 210], [245, 210, 120], [230, 130, 60], [150, 40, 90]][i] })), note: 'Collapsible soils: SSURGO screening (loess / eolian / fan parent material, low dry density, silty, dry climate, gypsum) where the flood ponded 5 cm or soaked in 5 cm. A flag for geotechnical follow-up, not a prediction.' }
      : S.view === 'scour' ? { classes: SCOUR_CLASSES, note: 'Scour potential: peak bed shear ρg·n²·v²/h^⅓ against the critical shear of the ground (grass 30 Pa, bare soil 1–10 Pa by texture; paved ground not erodible)' } : hazStd(), cl = st.classes, w = 100 / cl.length;
    $('ramp').style.background = `linear-gradient(90deg, ${cl.map((c, i) => `rgb(${c.color}) ${(i * w).toFixed(1)}% ${((i + 1) * w).toFixed(1)}%`).join(',')})`;
    $('ticks').innerHTML = cl.map(c => `<span title="${c.text}">${c.label}</span>`).join('');
    $('ticks').title = st.note + (S.view === 'peakHaz' ? '. Worst class each cell reached, from depth and velocity at the same moment.' : '');
  } else {
    const lo = r.min ?? 0; $('ramp').style.background = `linear-gradient(90deg, ${r.stops.map(([v, c]) => `rgb(${c}) ${((v - lo) / (r.max - lo) * 100).toFixed(0)}%`).join(',')})`;
    $('ticks').innerHTML = r.ticks.map((t, i) => `<span>${t}${i === r.ticks.length - 1 ? '+ ' + r.unit : ''}</span>`).join('');
    $('ticks').title = '';
  }
}

/** Current field on the fine (1 m) grid: depth / max depth / speed / hazard. */
function fineField(kind) {
  const { F, c } = run, fine = model.fine, Nf = fine.nx * fine.ny;
  run.view ??= { depth: new Float32Array(Nf), max: new Float32Array(Nf), lastMax: 0 };
  if (kind === 'max') {
    if (F === 1) return run.hmax;
    if (performance.now() - run.view.lastMax > 1000) { toFine(c, run.hmax, 1, run.view.max); run.view.lastMax = performance.now(); }
    return run.view.max;
  }
  if (F === 1) { const d = run.view.depth; for (let k = 0; k < Nf; k++) d[k] = run.out[2 * k]; return d; }
  return toFine(c, run.out, 2, run.view.depth);
}
/** Solver-grid depths → the 1 m grid: subgrid levels on the 1 m ground, else water-surface downscaling. */
function toFine(c, h, stride, target) {
  if (!c.sg) return downscaleDepth(c, h, stride, model.f, c.F, 0.005, target);
  const eta = new Float64Array(c.nx * c.ny); for (let k = 0; k < eta.length; k++) eta[k] = h[k * stride] > 0.005 ? c.z[k] + h[k * stride] : NaN;
  return fineDepth(c.sg, eta, model.f, target);
}
/** Solver-cell index under fine cell (i, j). */
const ck = (i, j) => ((j / run.F) | 0) * run.c.nx + ((i / run.F) | 0);
/** Solver speed under fine cell (i, j); 0 where the solver cell is dry. */
const speedAt = (i, j) => { const c = ck(i, j); return run.out[2 * c] > 0.005 ? run.out[2 * c + 1] : 0; };

function drawDepth() {
  if (!run?.out) return;
  const fine = model.fine, W = fine.nx, H = fine.ny, ctx = canvases.depth.getContext('2d');
  const img = ctx.createImageData(W, H), px = img.data, view = S.view;
  const peak = PEAK.has(view), depth = fineField(view === 'max' || peak ? 'max' : 'depth'), hmin = S.hmin;
  const r = RAMPS[view], st = hazStd(), hz = run.haz, std = $('hazStd').value;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, d = depth[k];
    if ((!(d > hmin) && view !== 'banks') || (run.c.inside && !run.c.inside[ck(i, j)])) continue; // bank tops show dry too
    let col;
    if (view === 'depth' || view === 'max') col = rampColor(r, d);
    else if (peak) { // per solver cell, shown where the cell ever got wet
      const c = ck(i, j);
      if (view === 'peakHaz') { const n = hz.cls[std][c]; if (!n) continue; col = st.classes[n - 1].color; }
      else if (view === 'force') { if (!(hz.force[c] > 0)) continue; col = rampColor(r, hz.force[c]); }
      else if (view === 'duration') { if (!(hz.duration[c] > 0)) continue; col = rampColor(r, hz.duration[c] / 60); }
      else if (view === 'bed') { const b = run.sedState?.bed[c] ?? 0; if (Math.abs(b) < 0.001) continue; col = rampColor(r, Math.max(-10, Math.min(10, b * 100))); }
      else if (view === 'banks') { const p = run.bankCell?.[c]; if (!(p >= 0) && p !== UNRATED) continue; col = p === UNRATED ? [175, 175, 175] : BANK_CLASSES[bankClass(p)].color; }
      else if (view === 'grain') { const sd = run.sedState, d0 = run.sed?.d50[c]; if (!sd || !(sd.size[c] > 0) || !(d0 > 0) || Math.abs(sd.bed[c]) < 0.001) continue; col = rampColor(r, Math.max(-50, Math.min(50, (sd.size[c] / d0 - 1) * 100))); }
      else if (view === 'collapse') { const n = collapseAt(k, i, j); if (n <= 0) continue; col = r.classes ? [[225, 225, 210], [245, 210, 120], [230, 130, 60], [150, 40, 90]][n] : col; }
      else if (view === 'scour') { const n = run.scour ? scourClass(hz.shear[c], run.scour.tauC[c]) : -1; if (n < 0) continue; col = SCOUR_CLASSES[n].color; }
      else { const a = hz.arrival[c]; if (Number.isNaN(a)) continue; col = rampColor(r, a / 60); }
    } else {
      const v = speedAt(i, j);
      if (view === 'speed') col = rampColor(r, v);
      else { if (d < WET) continue; col = st.classes[st.classify(d, d >= VCUT ? v : 0) - 1].color; }
    }
    const a = Math.min(1, 0.35 + d * 3) * 255;
    px[4 * k] = col[0]; px[4 * k + 1] = col[1]; px[4 * k + 2] = col[2]; px[4 * k + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  run.lastDraw = { depth };
  refreshCanvas('depth');
}

function probe(e) {
  const p = $('probe');
  if (!model) { p.style.display = 'none'; return; }
  const [ci, cj] = model.fine.lonlatToCell(e.lngLat.lng, e.lngLat.lat), i = Math.floor(ci), j = Math.floor(cj);
  if (i < 0 || j < 0 || i >= model.fine.nx || j >= model.fine.ny) { p.style.display = 'none'; return; }
  const k = j * model.fine.nx + i, f = model.f;
  let t = `z ${f.z[k].toFixed(2)} m`;
  if (f.bld[k]) t += ' · building';
  else {
    if (model.nlcd) t += ` · ${NLCD_NAMES[model.nlcd[k]] || 'unclassified'}`;
    if (f.road[k]) t += ' · street';
    if (run?.lastDraw) {
      const d = run.lastDraw.depth[k], v = speedAt(i, j);
      t += ` · depth ${d > 0.005 ? (d * 100).toFixed(0) + ' cm' : 'dry'}` + (d > 0.005 ? ` · ${v.toFixed(2)} m/s` : '');
      const cc = ck(i, j), hm = run.F === 1 ? run.hmax[k] : run.c.sg ? (run.hmax[cc] > 0.005 ? Math.max(0, run.c.z[cc] + run.hmax[cc] - f.z[k]) : 0) : run.hmax[cc];
      if (hm > 0.005) t += ` · max ${(hm * 100).toFixed(0)} cm`;
      const c = run.F === 1 ? k : ck(i, j), hz = run.haz;
      if (hz?.cls.arr[c]) {
        const st = hazStd(), n = hz.cls[$('hazStd').value][c];
        t += ` · peak hazard ${st.classes[n - 1].label} · force ${hz.force[c].toFixed(1)} kN/m`;
        if (hz.duration[c] > 0) t += ` · ${Math.round(hz.duration[c] / 60)} min over 15 cm from ${fmtTime(hz.arrival[c])}`;
        if (run.sedState && Math.abs(run.sedState.bed[c]) > 1e-4) t += ` · bed ${run.sedState.bed[c] > 0 ? '+' : ''}${(run.sedState.bed[c] * 100).toFixed(1)} cm` + (run.sedState.size[c] > 0 ? `, grains ${(run.sedState.size[c] * 1000).toFixed(run.sedState.size[c] < 1e-3 ? 3 : 1)} mm` : '');
        if (run.sedState?.failed[c] >= 0) t += ` · slope failure at ${fmtTime(run.sedState.failed[c])}`;
        if (model.f.collapse?.[k]) t += ` · collapse susceptibility ${COLLAPSE_CLASSES[model.f.collapse[k]].toLowerCase()}`;
        if (hz.shear[c] > 0) t += ` · bed shear ${hz.shear[c].toFixed(1)} Pa` + (run.scour?.tauC[c] < NOT_ERODIBLE ? ` (ground resists ${run.scour.tauC[c].toFixed(1)})` + (hz.erosion[c] > 1e-4 ? `, scour potential ${(hz.erosion[c] * 100).toFixed(1)} cm` : '') : ', paved');
      }
      if (run.bankCell?.[c] >= 0) { const m = run.banks.findIndex(b => b.top === c), bs = run.bankState; if (m >= 0) t += ` · bank ${run.banks[m].H.toFixed(1)} m high: lowest FS ${bs.minFS[m] < 1e29 ? bs.minFS[m].toFixed(2) : '–'}, ${bs.maxPf[m] === UNRATED ? 'not rated (stands only on strength the survey lacks)' : `collapse probability ${(bs.maxPf[m] * 100).toFixed(0)} %${bs.tMaxPf[m] >= 0 && bs.maxPf[m] > 0.05 ? ' at ' + fmtTime(bs.tMaxPf[m]) : ''}`}`; }
    }
  }
  p.textContent = t; p.style.display = 'block'; p.style.left = e.point.x + 'px'; p.style.top = e.point.y + 'px';
}

// ------------------------------------------------------------------ view controls
for (const seg of ['viewSeg', 'viewSeg2']) $(seg).onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.view = b.dataset.v; for (const x of [...$('viewSeg').children, ...$('viewSeg2').children]) x.setAttribute('aria-pressed', x === b);
  drawLegend();
  if (PEAK.has(S.view) && run?.solver) { const r = run; r.haz.load(await r.solver.readHazard(), r.solver.t); await readGround(); if (run !== r) return; } // latest every-step totals
  if (run?.out) { if (run.view) run.view.lastMax = 0; drawDepth(); }
};
$('hazStd').onchange = () => { drawLegend(); if (run?.out) drawDepth(); if (run?.haz?.t != null) hazardNote(); };
$('opacity').oninput = () => { S.opacity = $('opacity').value / 100; $('opacityOut').textContent = $('opacity').value + ' %'; if (map.getLayer('ov-depth')) map.setPaintProperty('ov-depth', 'raster-opacity', S.opacity); };
$('basemap').onchange = () => { for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(k, 'visibility', k === $('basemap').value ? 'visible' : 'none'); };
for (const [id, layer] of [['tShade', 'ov-shade'], ['tLc', 'ov-lc']]) $(id).onchange = () => { if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', $(id).checked ? 'visible' : 'none'); };
$('tBld').onchange = () => { for (const l of ['bld-fill', 'bld-line']) map.setLayoutProperty(l, 'visibility', $('tBld').checked ? 'visible' : 'none'); };
for (const [id, fmt] of [['rain', v => v + ' mm/hr'], ['dur', v => v + ' min'], ['uplift', v => '+' + v + ' %'], ['tail', v => v + ' min'], ['speed', () => speedMul() === Infinity ? 'max' : speedMul().toLocaleString() + '×']]) {
  const upd = () => { $(id + 'Out').textContent = fmt($(id).value); }; $(id).addEventListener('input', upd); upd();
}
$('roofOut').textContent = $('roof').value + ' %'; $('opacityOut').textContent = $('opacity').value + ' %';
updateStorm();
drawLegend();

// ------------------------------------------------------------------ export
$('exportBtn').onclick = async () => {
  if (!model || !run) return;
  const btn = $('exportBtn'); btn.disabled = true; btn.textContent = 'Packaging…';
  try {
    const blob = await buildPackage();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `floodsim_${model.fine.epsg}_${model.fine.x0}_${model.fine.y0}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (e) { console.error(e); log('Export failed: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Download 3D package (.zip)'; }
};

async function buildPackage() {
  const { fine, f, osm } = model, W = fine.nx, H = fine.ny, files = [], enc = new TextEncoder();
  let zmin = Infinity, zmax = -Infinity; for (const v of f.z) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  const hm = new Uint16Array(W * H); for (let k = 0; k < W * H; k++) hm[k] = Math.round((f.z[k] - zmin) / Math.max(1e-6, zmax - zmin) * 65535);
  files.push({ name: 'terrain/heightmap_16bit.png', data: await png16(hm, W, H) });
  files.push({ name: 'terrain/dem_1m.exr', data: exr({ R: f.z }, W, H) });
  const bm = new Float32Array(W * H); for (let k = 0; k < W * H; k++) bm[k] = f.bld[k] ? (f.bldH[k] || 9) : 0;
  files.push({ name: 'terrain/building_mask.exr', data: exr({ R: bm }, W, H) });

  // buildings: local metres from the grid's SW corner
  const { default: earcut } = await import('https://cdn.jsdelivr.net/npm/earcut@3.0.1/+esm');
  const kept = buildingsFC().features.map(g => ({ height: g.properties.h, rings: g.geometry.coordinates })); // less demolitions, plus the scenario's new buildings
  const local = [...kept, ...(f.designBuildings ?? []).map(b => ({ height: b.height, rings: b.rings }))].map(b => ({ height: b.height, rings: b.rings.map(r => toCells(fine, r).map(([ci, cj]) => [ci * fine.dx, (fine.ny - cj) * fine.dx])) }));
  const groundAt = (x, y) => { const i = Math.floor(x / fine.dx), j = Math.floor(fine.ny - y / fine.dx); return (i >= 0 && j >= 0 && i < W && j < H) ? f.z[j * W + i] - zmin : NaN; };
  files.push({ name: 'buildings/buildings.glb', data: buildingsGLB(local, earcut, groundAt) });
  files.push({ name: 'buildings/buildings_local_m.geojson', data: enc.encode(JSON.stringify({ type: 'FeatureCollection', features: local.map(b => ({ type: 'Feature', properties: { height_m: b.height }, geometry: { type: 'Polygon', coordinates: b.rings } })) })) });

  // results
  if (run.solver) {
    const maxFine = run.F === 1 ? run.hmax : toFine(run.c, run.hmax, 1);
    files.push({ name: 'results/max_depth_1m.exr', data: exr({ R: maxFine }, W, H) });
    files.push({ name: `results/max_speed_${run.F}m.exr`, data: exr({ R: run.smax }, run.c.nx, run.c.ny) });
    run.frames.forEach((fr, i) => files.push({ name: `results/frames/depth_speed_${String(i).padStart(4, '0')}.exr`, data: exr({ R: fr.depth, G: fr.speed }, run.c.nx, run.c.ny) }));
  }
  const corners = fine.corners();
  const meta = {
    generator: 'FloodSim Phase 1', created: new Date().toISOString(),
    crs: `EPSG:${fine.epsg}`, utmZone: fine.zone,
    terrainGrid: { ...fine.toJSON(), originSW: [fine.x0, fine.y0], cornersLonLat: { nw: corners[0], ne: corners[1], se: corners[2], sw: corners[3] } },
    solverGrid: run ? { dx: run.F, nx: run.c.nx, ny: run.c.ny } : null,
    greenInfrastructure: run ? { pavementArea_m2: run.gi?.pavedArea ?? 0, rainGardenArea_m2: run.gi?.gardenArea ?? 0, greenRoofShare: run.green, greenRoofRetention_m: GI.greenRoofRetention, greenRoofsFullAt_s: run.greenFull ?? null, tanks: run.tanks, design: GI } : null,
    culverts: run?.culv?.map(c => ({ D: c.D, length: +c.len.toFixed(1), invert: +c.inv.toFixed(2), kind: c.kind })) ?? [],
    area: model.poly ? { type: 'polygon', ringLonLat: model.poly, outside: 'sink cells: water crossing the edge leaves the model (booked as outflow)' } : { type: 'box' },
    heightmap: { file: 'terrain/heightmap_16bit.png', zMin_m: zmin, zMax_m: zmax, encoding: 'z = zMin + v/65535·(zMax−zMin)', unrealZScale: (zmax - zmin) * 100 / 512, unrealXYScale: fine.dx * 100 },
    buildingsLocalFrame: 'metres from terrain SW corner, x east, y north; GLB is Y-up with base at (ground − zMin)',
    rasterOrder: 'row 0 = north', units: { depth: 'm', speed: 'm/s', elevation: 'm NAVD88 (3DEP)' },
    run: run?.solver ? {
      tEnd_s: run.solver.t, storm: stormMeta(run.storm), roofRoutedFraction: Number($('roof').value) / 100,
      downscaled: run.F > 1, mass: run.mass, frames: run.frames.map((fr, i) => ({ i, t_s: fr.t, file: `results/frames/depth_speed_${String(i).padStart(4, '0')}.exr` })),
    } : null,
    sources: {
      terrain: { name: 'USGS 3DEP', nativeRes_m: model.dem.sourceRes, rasters: model.dem.sources, license: 'public domain' },
      buildings_roads: { name: 'OpenStreetMap', license: 'ODbL 1.0, © OpenStreetMap contributors' },
      landcover: { name: model.nlcd?.label ?? 'none', license: 'public domain', used: !!model.nlcd },
      soils: { name: 'USDA NRCS SSURGO', license: 'public domain', units: model.soils.length },
      rainfall: model.atlas14 ? { name: `NOAA Atlas 14 Vol. ${model.atlas14.volume} v${model.atlas14.version}`, license: 'public domain' } : null,
    },
  };
  if (infra.layer.features.length) files.push({ name: 'drainage/infrastructure.geojson', data: enc.encode(JSON.stringify(infra.layer)) });
  if (run?.net) {
    files.push({ name: 'drainage/network.inp', data: enc.encode(run.inp ?? toINP(run.net, fine, { durationS: Math.ceil(tStop() / 60) * 60 + 3600 })) });
    if (run.swmmReport) files.push({ name: 'drainage/swmm_report.rpt', data: enc.encode(run.swmmReport) });
    meta.drainage = { tier: run.net.tier === 1 ? 1 : run.net.stats.realInlets ? '2+' : 2,
      kind: run.net.drawn ? 'infrastructure layer (drawn / imported pipes)' : run.net.tier === 1 ? 'linked utility pipes' : run.net.stats.realInlets && model.util ? `real ${model.util.utility.name} inlets, synthetic pipes` : 'synthetic street-following network',
      storage: run.storage ?? [],
      linked: model.linked ? { sources: model.linked.sources, notes: model.linked.notes } : null,
      utility: model.util ? { ...model.util.utility, combinedSewer: model.util.combined, inlets: model.util.inlets.length, outfalls: model.util.outfalls.length } : null, engine: swmmEngine ? `EPA SWMM ${swmmEngine.version}` : null, coupled: !!run.coupler,
      design: run.net.opts, stats: run.net.stats, exchange: run.coupler ? { intervalS: run.coupler.interval, ...run.coupler.totals } : null, swmmContinuity: run.netMass ?? null };
  } else meta.drainage = drainSrc === 'lumped' ? { tier: 3, lumpedMMHR: Number($('lumpRate').value) } : { tier: null };
  files.push({ name: 'metadata.json', data: enc.encode(JSON.stringify(meta, null, 2)) });
  files.push({ name: 'README.txt', data: enc.encode(README(meta)) });
  return zip(files);
}

const README = (m) => `FloodSim export package
=======================
CRS ${m.crs}. Terrain grid ${m.terrainGrid.nx} x ${m.terrainGrid.ny} at ${m.terrainGrid.dx} m, SW corner at (${m.terrainGrid.x0}, ${m.terrainGrid.y0}).
All rasters are north-up (row 0 = north). Depths are solver output, unmodified${m.run?.downscaled ? ' (max depth downscaled to 1 m by water-surface projection)' : ''}.

Unreal Engine
  1. Landscape > Import from File: terrain/heightmap_16bit.png
     Scale X/Y = ${m.heightmap.unrealXYScale} cm, Scale Z = ${m.heightmap.unrealZScale.toFixed(3)} (UE maps 65535 to 512*Z cm).
  2. Import buildings/buildings.glb (metres; set import uniform scale 100 if your project uses cm). Origin = terrain SW corner at zMin.
  3. Water: a plane over the landscape whose material samples results/frames/depth_speed_####.exr
     (R = depth m, G = speed m/s) and offsets the surface to ground + depth. Drive foam from G only.
  4. For world context, place the scene with Cesium for Unreal at the SW corner (see metadata.json cornersLonLat).

Files
  terrain/dem_1m.exr            float elevation (m), absolute
  terrain/building_mask.exr     building height (m) where a building cell, else 0
  results/max_depth_1m.exr      maximum depth over the run (m)
  results/max_speed_*.exr       maximum speed, sampled at frame rate (m/s), solver grid
  results/frames/*.exr          depth (R) and speed (G) snapshots, solver grid; times in metadata.json
`;

// ------------------------------------------------------------------ start
// ------------------------------------------------------------------ soils, infiltration, groundwater
function soilsRow() {
  const { soils } = model, hsg = [...new Set(soils.map(s => s.hsg || 'none'))];
  if (!soils.length) return 'not available: compacted fill (2 mm/hr)';
  if ($('infilModel').value !== 'ga') return `SSURGO, ${soils.length} units (HSG ${hsg.join(', ')}); constant rates by group, Urban land = compacted fill 2 mm/hr`;
  const p = soils.map(s => s.props).filter(x => x?.K > 0), tex = [...new Set(p.map(x => x.texture))], wts = p.map(x => x.wt).filter(v => v != null);
  return `SSURGO Green-Ampt, ${p.length} of ${soils.length} units with horizon data (${tex.join(', ') || 'none'}; the rest by hydrologic group or compacted fill), ` +
    `K ${p.length ? `${Math.min(...p.map(x => x.K * 3.6e6)).toFixed(1)}–${Math.max(...p.map(x => x.K * 3.6e6)).toFixed(1)} mm/hr` : 'by group'}, ${$('wetness').selectedOptions[0].textContent.toLowerCase()} start, ` +
    ($('wtDepth').value.trim() ? `water table set at ${$('wtDepth').value} m` : wts.length ? `water table ${Math.min(...wts).toFixed(1)}–${Math.max(...wts).toFixed(1)} m (survey)` : 'no shallow water table in the survey') + (p.length ? '<span class="pill good">tier 1</span>' : '<span class="pill warn">defaults</span>');
}
for (const id of ['infilModel', 'wetness', 'wtDepth', 'sedOn', 'topsoil', 'debrisOn', 'bankOn']) $(id).addEventListener('change', () => { if (model) { setTiers(); if (!run || !run.solver) resetRun(); } });
/** The nearest USGS groundwater well with measured levels (Water Data API field measurements since 2000), as a check
 *  on the survey's water table. Depth below land surface; wells can tap deeper aquifers than the water table. */
async function groundwaterNote() {
  const note = $('wtNote'); note.textContent = '';
  try {
    const [w, s, e, n] = model.fine.lonlatBounds(0.05), [lon, lat] = model.site;
    const r = await fetcher(`https://api.waterdata.usgs.gov/ogcapi/v0/collections/field-measurements/items?f=json&bbox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}&parameter_code=72019&datetime=2000-01-01T00:00:00Z/..&limit=1000`);
    if (!r.ok) return;
    const wells = new Map();
    for (const f of (await r.json()).features ?? []) {
      const id = f.properties.monitoring_location_id, v = Number(f.properties.value) * (f.properties.unit_of_measure === 'ft' ? 0.3048 : 1); if (!Number.isFinite(v)) continue;
      if (!wells.has(id)) wells.set(id, { id, xy: f.geometry?.coordinates, v: [] }); wells.get(id).v.push({ t: f.properties.time, m: v });
    }
    const near = [...wells.values()].filter(x => x.xy).map(x => ({ ...x, d: Math.hypot((x.xy[0] - lon) * 111320 * Math.cos(lat * Math.PI / 180), (x.xy[1] - lat) * 111320) })).sort((a, b) => a.d - b.d)[0];
    if (!near) { note.textContent = 'No USGS groundwater wells with levels since 2000 within ~5 km; the soil survey sets the water table.'; return; }
    near.v.sort((a, b) => a.t.localeCompare(b.t)); const last = near.v.at(-1), ms = near.v.map(x => x.m);
    note.textContent = `Nearest USGS well with levels: ${near.id} (${(near.d / 1000).toFixed(1)} km), ${last.m.toFixed(1)} m to water on ${last.t.slice(0, 10)}` +
      (near.v.length > 1 ? ` (${near.v.length} readings since 2000, ${Math.min(...ms).toFixed(1)}–${Math.max(...ms).toFixed(1)} m)` : '') + '. Wells can tap deeper aquifers than the water table; enter a depth above to use it.';
  } catch { /* informational only */ }
}

// ------------------------------------------------------------------ sediment and collapsible soils
/** Latest sediment state and the Green-Ampt depth infiltrated (for the collapse trigger), read on demand. */
async function readGround() {
  if (!run?.solver) return;
  if (run.sed) run.sedState = await run.solver.readSediment();
  if (run.ga) run.gaF = await run.solver.readInfiltration();
  if (run.banks) {
    run.bankState = await run.solver.readBanks();
    const cell = run.bankCell ??= new Float32Array(run.c.nx * run.c.ny).fill(NaN);
    run.banks.forEach((b, m) => { cell[b.top] = run.bankState.maxPf[m]; });
  }
  run.lastMaxFine = null;
}
/** Collapse class (1–3) at fine pixel k if the flood wetted it (ponded ≥ 5 cm or soaked in ≥ 5 cm), else 0. */
function collapseAt(k, i, j) {
  const cls = model.f.collapse?.[k] ?? 0; if (!cls) return 0;
  const c = ck(i, j), maxD = run.F === 1 ? run.hmax[k] : (run.lastMaxFine ??= toFine(run.c, run.hmax, 1))[k];
  return maxD >= 0.05 || (run.gaF?.[c] ?? 0) >= 0.05 ? cls : 0;
}
function groundRow() {
  const f = model.f; if (!f.collapse) return 'not available';
  const A = model.fine.dx ** 2, col = [0, 0, 0, 0], sw = [0, 0, 0, 0];
  for (let k = 0; k < f.collapse.length; k++) { if (f.bld[k]) continue; col[f.collapse[k]] += A; sw[f.swell[k]] += A; }
  const part = (a, what) => (a[2] + a[3] > 0 ? `${what}: ${a[3] ? `${fmtArea(a[3])} high, ` : ''}${fmtArea(a[2])} moderate` : `${what}: none moderate or high`);
  return `${part(col, 'Collapsible soils (screening)')}; ${part(sw, 'shrink–swell clays')}. From the soil survey; flags for geotechnical follow-up<span class="pill warn">screening</span>`;
}

// ------------------------------------------------------------------ upstream river inflow
/**
 * Rivers entering the model area (OSM waterways crossing its edge) and the USGS gauges near them. Each entry gets a gauge
 * (matched by river name, upstream first) and a flow: the recorded hydrograph for a historic storm, or a hydrograph
 * peaking at the gauge's T-year flood (log-Pearson III on its annual peaks) for a design storm.
 */
const inflow = { entries: [], gauges: [], levels: [], peaks: new Map() };

// ------------------------------------------------------------------ starting water levels (src/waterlevels.js)
function startNoteUpdate() {
  const n = inflow.levels.length;
  $('startNote').textContent = $('startWater').value === 'lidar' ? 'Channels and lakes hold only what the lidar surface shows (the level on the day it was flown); river and tide inflows fill them during the run.'
    : `${n ? n + ' USGS level gauge' + (n > 1 ? 's' : '') + ' nearby.' : 'No USGS level gauges nearby.'} A gauged river rises above the lidar water surface by the gauge's rise, a lake fills flat to its gauge, tidal water to the tide level, and the water spreads onto connected ground below that level. Ungauged water stays at the lidar surface. The lidar has no bathymetry: water below its surface is not modelled.`;
}
$('startWater').onchange = () => { startNoteUpdate(); if (model && (!run || !run.solver)) resetRun(); };
/**
 * Gauge readings for the start, fetched before the run: at the storm start (historic) or the latest (design), for the
 * level gauges nearby and the inflow gauges. Also each gauge's flow then, for the design hydrograph's base.
 */
async function prepareLevels() {
  const want = new Map(inflow.levels.map(g => [g.site, g]));
  for (let i = 0; i < inflow.entries.length; i++) {
    const site = $('inGauge' + i)?.value, g = site && inflow.gauges.find(x => x.site === site);
    if (g && !want.has(site)) want.set(site, { ...g, kind: 'ST', datumM: g.altM });
  }
  if (!want.size) return null;
  const at = currentStorm()?.t0 ?? null, lv = await readLevels([...want.keys()], fetcher, at), flows = new Map();
  for (const [site, r] of lv) if (r.q != null) flows.set(site, r.q);
  return { want, lv, flows, at };
}
/** The gauge readings as startDepths sources on the solver grid c (F fine cells per solver cell). */
async function levelSources(prep, c, F) {
  const fine = model.fine, lines = (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line));
  const water = waterCells(c, F, fine, model.nlcd, lines), sources = [], notes = [], R = Math.max(3, Math.ceil(60 / (F * fine.dx)));
  const entryOf = new Map(); inflow.entries.forEach((en, i) => { const s = $('inGauge' + i)?.value; if (s) entryOf.set(s, en); });
  for (const [site, g] of prep.want) {
    let surf; try { surf = await gaugeSurface(g, prep.lv.get(site), fetcher); } catch (e) { surf = { z: null, why: e.message }; }
    if (surf.z == null) { notes.push(`${g.name}: not used (${surf.why})`); continue; }
    const near = waterNear(c, water, cellAt(fine, c, F, g.lon, g.lat), R), en = entryOf.get(site);
    if (near.length && (g.kind === 'LK' || g.kind === 'ES')) { sources.push({ cells: near, level: surf.z }); notes.push(`${g.name}: ${surf.z.toFixed(2)} m NAVD88, flat (${surf.how})`); continue; }
    if (near.length) { // a river gauge in the area: its rise over the lidar water surface right there
      const rise = Math.max(0, surf.z - Math.min(...near.map(q => c.z[q]))); sources.push({ cells: near, rise });
      notes.push(`${g.name}: ${surf.z.toFixed(2)} m NAVD88, ${rise.toFixed(2)} m above the lidar water surface (${surf.how})`); continue;
    }
    if (en) { // an inflow gauge outside the area: its rise over the lidar surface at the gauge, carried down the river
      let zw = null; try { zw = await lidarSurfaceNear(g.lon, g.lat, fetcher); } catch { /* no lidar there */ }
      if (zw == null) { notes.push(`${g.name}: not used (no lidar at the gauge)`); continue; }
      const rise = Math.max(0, surf.z - zw), cells = waterNear(c, water, Math.min(c.ny - 1, Math.floor(en.at[1] / F)) * c.nx + Math.min(c.nx - 1, Math.floor(en.at[0] / F)), R);
      if (cells.length) { sources.push({ cells, rise }); notes.push(`${g.name}: ${rise.toFixed(2)} m above the lidar water surface at the gauge, carried along the river (${surf.how})`); }
    }
  }
  return { water, sources, notes };
}
/** Starting depths for the run (null = start dry): the gauge sources, plus the tide level at t = 0 on tidal water at the edge. */
function startWater(c, F, stageCells) {
  if ($('startWater').value !== 'gauge') return null;
  const ls = run.levelSrc, st = currentStorm(), tide = stageAt(st, 0), sources = [...(ls?.sources ?? [])];
  let water = ls?.water;
  if (tide != null && stageCells?.length) {
    if (!water) { const fine = model.fine; water = waterCells(c, F, fine, model.nlcd, (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line))); }
    const cells = stageCells.filter(k => water[k]); if (cells.length) sources.push({ cells, level: tide });
  }
  if (!sources.length) { $('startNote').textContent = 'No usable gauge level for this run: the water bodies start at the lidar surface.' + (ls?.notes.length ? ' ' + ls.notes.join('; ') + '.' : ''); return null; }
  const s = startDepths(c, water, sources);
  let vol = 0, wet = 0; for (let k = 0; k < s.depth.length; k++) if (s.depth[k] > 0) { vol += s.depth[k]; wet++; }
  const A = (F * model.fine.dx) ** 2, msg = `Starting water: ${fmtVol(vol * A)} on ${(wet * A / 1e4).toFixed(2)} ha.` + (ls?.notes.length ? ' ' + ls.notes.join('; ') + '.' : '') + (tide != null && stageCells?.length ? ` Tidal water at ${tide.toFixed(2)} m NAVD88.` : '');
  $('startNote').textContent = msg; log(msg, 'ok', 'USGS NWIS');
  return s;
}
async function setupInflow() {
  const fine = model.fine, ringC = model.poly ? model.poly.map(([lo, la]) => fine.lonlatToCell(lo, la)) : null;
  const inside = (i, j) => i >= 0 && j >= 0 && i < fine.nx && j < fine.ny && (!ringC || insideRing(i, j, ringC));
  inflow.entries = riverEntries(fine, model.osm.waterways, inside);
  $('inflowBox').hidden = !inflow.entries.length;
  if (!inflow.entries.length) { inflow.gauges = []; inflow.levels = await findLevelGauges(fine.lonlatBounds(0.02), fetcher).catch(() => []); startNoteUpdate(); return; }
  $('inflowNote').textContent = 'Finding USGS stream gauges…';
  const [w, s, e, n] = fine.lonlatBounds(0.15); // ~15 km around the area
  [inflow.gauges, inflow.levels] = await Promise.all([findGauges([w, s, e, n], fetcher), findLevelGauges([w, s, e, n], fetcher).catch(() => [])]);
  startNoteUpdate();
  const ll = (p) => fromUTM(fine.x0 + p[0] * fine.dx, fine.y1 - p[1] * fine.dx, fine.zone);
  $('inflowList').innerHTML = inflow.entries.map((en, i) => {
    const at = ll(en.at), key = (en.name || '').toUpperCase().replace(/\s+(RIVER|CREEK|RUN|BRANCH|STREAM)$/, '');
    const zEntry = model.f.z[Math.min(fine.ny - 1, en.at[1] | 0) * fine.nx + Math.min(fine.nx - 1, en.at[0] | 0)];
    // upstream on the same river = a gauge datum above the river where it enters (rivers bend, so direction says little)
    const ranked = inflow.gauges.map(g => {
      const dx = (g.lon - at[0]) * 111320 * Math.cos(at[1] * Math.PI / 180), dy = (g.lat - at[1]) * 111320, d = Math.hypot(dx, dy);
      return { ...g, d, up: g.altM != null && g.altM > zEntry + 0.3, match: !!key && g.name.toUpperCase().includes(key) };
    }).sort((a, b) => (b.match - a.match) || (b.up - a.up) || (a.d - b.d));
    en.ranked = ranked;
    const pick = ranked.find(g => g.match && g.up) ?? ranked.find(g => g.match);
    return `<div class="inrow"><b>${en.name || 'Unnamed ' + en.kind} enters the area</b>
      <select id="inGauge${i}" aria-label="Gauge"><option value="">No inflow</option>${ranked.slice(0, 12).map(g => `<option value="${g.site}"${g === pick ? ' selected' : ''}>${g.name} (${g.areaMi2 ? g.areaMi2.toLocaleString() + ' mi², ' : ''}${(g.d / 1000).toFixed(1)} km ${g.up ? 'upstream' : g.altM != null ? 'downstream' : 'away'})</option>`).join('')}</select>
      <select id="inFlow${i}" aria-label="Flow"><option value="event">Recorded flows (historic storms)</option>${[2, 10, 25, 50, 100].map(T => `<option value="${T}"${T === 10 ? ' selected' : ''}>Design: ${T}-yr peak flow</option>`).join('')}</select>
      <label class="field" style="margin:0"><span>River peak after the rain peak (h)</span><input id="inLag${i}" type="number" step="0.5" value="0" style="width:5em"></label></div>`;
  }).join('');
  for (let i = 0; i < inflow.entries.length; i++) for (const id of ['inGauge', 'inFlow', 'inLag']) $(id + i).onchange = () => { if (model && (!run || !run.solver)) resetRun(); inflowNoteUpdate(); };
  inflowNoteUpdate();
}
function inflowNoteUpdate() {
  const on = inflow.entries.filter((_, i) => $('inGauge' + i)?.value).length;
  $('inflowNote').textContent = !inflow.gauges.length ? 'No USGS discharge gauges within ~15 km: the river enters dry unless you give it a flow.'
    : `${on} of ${inflow.entries.length} river ${inflow.entries.length > 1 ? 'entries' : 'entry'} with a gauge inflow. A gauge counts the whole basin above it; flows are used as measured (no drainage-area scaling). Recorded flows need a historic storm (15-minute data since about 2007).`;
}
/** Each entry's flow as a function of model time (s), fetched before the run starts. */
async function prepareInflow() {
  const out = [], st = currentStorm();
  for (let i = 0; i < inflow.entries.length; i++) {
    const site = $('inGauge' + i)?.value; if (!site) continue;
    const en = inflow.entries[i], g = en.ranked.find(x => x.site === site), mode = $('inFlow' + i).value, lag = Number($('inLag' + i).value) * 3600;
    let flow, label;
    if (mode === 'event') {
      if (!st?.t0) throw new Error(`recorded flows need a historic storm (pick one under Storm, or a design peak for ${g.name})`);
      const series = await gaugeFlows(site, st.t0 - 3600e3, st.t0 + (tStop() + 3600) * 1000, fetcher);
      if (!series.length) throw new Error(`${g.name} has no 15-minute flows for this storm`);
      flow = recordedHydrograph(series, st.t0); label = `${g.name}, recorded (peak ${(Math.max(...series.map(p => p.q)) / CFS).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs)`;
    } else {
      if (!inflow.peaks.has(site)) inflow.peaks.set(site, await annualPeaks(site, fetcher));
      const peaks = inflow.peaks.get(site), q = lp3(peaks, Number(mode)); if (!q) throw new Error(`${g.name}: too few annual peaks for a frequency estimate`);
      const peakAt = st.intensity.indexOf(Math.max(...st.intensity)) * st.blockMin * 60 + st.blockMin * 30; // middle of the rain's peak block
      // the base: the gauge's flow at the start (latest reading) when known, else 5 % of the peak
      const q0 = run?.levelsReady?.flows?.get(site), base = q0 != null ? Math.min(q0, 0.5 * q) : 0.05 * q;
      flow = designHydrograph(q, Math.max(600, peakAt + lag), { base });
      label = `${g.name}, ${mode}-yr peak ${(q / CFS).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs (log-Pearson III on ${peaks.length} annual peaks), base ${(base / CFS).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs (${q0 != null ? 'gauge reading' : '5 % of the peak'})`;
    }
    out.push({ at: en.at, flow, label, site, name: en.name });
  }
  if (out.length) log('River inflow: ' + out.map(e => e.label).join('; '), 'ok', 'USGS NWIS');
  return out;
}

// ------------------------------------------------------------------ USGS high-water marks
$('hwmBtn').onclick = async () => {
  if (!model) return;
  const note = $('obsNote'); note.textContent = 'Looking up USGS high-water marks…';
  try {
    const [lon, lat] = model.site;
    const g = await (await fetcher(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=States&format=json`)).json();
    const stAbbr = g.result?.geographies?.States?.[0]?.STUSAB; if (!stAbbr) throw new Error('state not found for this site');
    const r = await fetcher(`https://api.waterdata.usgs.gov/stnservices/hwms/filteredhwms/?states=${stAbbr}`); if (!r.ok) throw new Error('STN service ' + r.status);
    const marks = fromSTN(await r.json(), model.fine.lonlatBounds(0.002)), byEvent = new Map();
    for (const m of marks) { const k = m.source; if (!byEvent.has(k)) byEvent.set(k, []); byEvent.get(k).push(m); }
    if (!byEvent.size) { note.textContent = `No USGS high-water marks with a usable datum in this area (${stAbbr} has marks mostly from large river and coastal floods).`; $('hwmEvent').hidden = true; return; }
    const sel = $('hwmEvent'); sel.hidden = false;
    sel.innerHTML = '<option value="">Pick an event…</option>' + [...byEvent].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `<option value="${k}">${k.replace('USGS STN, ', '')}: ${v.length} marks</option>`).join('');
    sel.onchange = () => {
      const v = byEvent.get(sel.value); if (!v) return;
      S.obs = v; drawObs(); obsNote(); if (run?.hmax && !run.playing && run.solver) scoreAndShow();
      note.textContent += ` From ${sel.value}. Load the same storm under Storm → historic to replay it.`;
    };
    note.textContent = `${marks.length} USGS high-water marks in or near the area, from ${byEvent.size} event${byEvent.size > 1 ? 's' : ''}: pick one to use them as observations.`;
  } catch (e) { note.textContent = 'High-water marks unavailable: ' + e.message; }
};

// ------------------------------------------------------------------ calibration
const cal = () => ({ manning: Number($('calManning').value), infil: Number($('calInfil').value), clog: Number($('calClog').value) });
for (const [id, f] of [['calManning', v => `${Number(v).toFixed(2)}×`], ['calInfil', v => `${Number(v).toFixed(2)}×`], ['calClog', v => `${Math.round(v * 100)} %`]]) {
  const upd = () => { $(id + 'Out').textContent = f($(id).value); }; $(id).addEventListener('input', upd); upd();
  $(id).addEventListener('change', () => { if (model && (!run || !run.solver)) resetRun(); });
}
function obsNote() {
  const o = S.obs, lv = o.filter(p => p.wse != null).length, dp = o.filter(p => p.depth != null).length, fl = o.filter(p => p.wse == null && p.depth == null).length;
  $('obsNote').textContent = o.length ? `${o.length} observations: ${lv} water levels, ${dp} depths, ${fl} flooded / dry reports. Each finished run is scored against them.` : $('obsNote').dataset.empty ?? $('obsNote').textContent;
  $('obsNote').dataset.empty ??= 'CSV with lat, lon and a water surface elevation (wse / elev), a depth, or flooded yes / no; or GeoJSON points with the same fields.';
  $('calSweep').disabled = !(o.length && model);
}
$('obsImport').onclick = () => $('obsFile').click();
$('obsFile').onchange = async () => {
  const file = $('obsFile').files[0]; $('obsFile').value = ''; if (!file) return;
  try { S.obs = parseObservations(await file.text(), { units: $('obsUnits').value }); if (!S.obs.length) throw new Error('no points with lat, lon and an observation'); drawObs(); obsNote(); if (run?.hmax && !run.playing && run.solver) scoreAndShow(); }
  catch (e) { $('obsNote').textContent = 'Import failed: ' + e.message; }
};
$('obsClear').onclick = () => { S.obs = []; drawObs(); obsNote(); $('calScore').textContent = ''; $('calTable').textContent = ''; };
/** Observation points on the map, coloured by how the last scored run did (green right, red missed, amber false alarm). */
function drawObs(points = S.obs) {
  const fc = { type: 'FeatureCollection', features: points.map(p => ({ type: 'Feature', properties: { call: p.call ?? '', err: p.error ?? 0, name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
  if (!map.getSource('obs')) {
    if (!points.length) return;
    map.addSource('obs', { type: 'geojson', data: fc });
    map.addLayer({ id: 'obs', type: 'circle', source: 'obs', paint: { 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#0c151b',
      'circle-color': ['match', ['get', 'call'], 'right', '#5cd68f', 'missed', '#ff5d5d', 'false alarm', '#f0b44c', '#ffffff'] } });
  } else map.getSource('obs').setData(fc);
}
/** Peak water surface near a point from the finished run: the highest wet 1 m pixel within r metres. */
function scoreNow() {
  if (!run?.hmax || !model) return null;
  const fine = model.fine, f = model.f, d = run.F === 1 ? run.hmax : toFine(run.c, run.hmax, 1);
  const at = (lon, lat, r) => {
    const [ci, cj] = fine.lonlatToCell(lon, lat), i0 = Math.floor(ci), j0 = Math.floor(cj); if (i0 < 0 || j0 < 0 || i0 >= fine.nx || j0 >= fine.ny) return null;
    const R = Math.ceil(r / fine.dx); let best = null, ground = f.z[j0 * fine.nx + i0];
    for (let j = Math.max(0, j0 - R); j <= Math.min(fine.ny - 1, j0 + R); j++) for (let i = Math.max(0, i0 - R); i <= Math.min(fine.nx - 1, i0 + R); i++) {
      if (Math.hypot(i - i0, j - j0) * fine.dx > r) continue; const k = j * fine.nx + i; if (f.bld[k] || !(d[k] > 0.01)) continue;
      const w = f.z[k] + d[k]; if (best == null || w > best) best = w;
    }
    return { ground, wse: best };
  };
  return scoreRun(S.obs, at);
}
const ftm = (m) => `${m >= 0 ? '+' : '−'}${Math.abs(m / 0.3048).toFixed(2)} ft (${Math.abs(m * 100).toFixed(0)} cm)`;
function scoreAndShow() {
  const sc = scoreNow(); if (!sc) return null;
  drawObs(sc.points);
  const lines = [];
  if (sc.n) lines.push(`<b>Levels and depths (${sc.n}):</b> bias ${ftm(sc.bias)}, mean error ${ftm(sc.mae).slice(1)}, RMSE ${ftm(sc.rmse).slice(1)}, ${Math.round(sc.within15 * 100)} % within 15 cm`);
  if (sc.calls) lines.push(`<b>Flooded / dry:</b> ${sc.hits} flooded in both, ${sc.misses} missed, ${sc.falseAlarms} false alarms of ${sc.calls}`);
  const worst = sc.points.filter(p => p.error != null).sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 5);
  if (worst.length) lines.push('Largest misses: ' + worst.map(p => `${p.name} ${ftm(p.error)}`).join(' · '));
  $('calScore').innerHTML = `Run scored (${PARAMS.manning.label.split(' ×')[0]} ${cal().manning}×, infiltration ${cal().infil}×, clogging ${Math.round(cal().clog * 100)} %): ` + lines.join('<br>');
  return sc;
}
function calCSV(sc) {
  const n = (v, d = 3) => (v == null || !Number.isFinite(v) ? '' : String(+v.toFixed(d)));
  return ['name,lon,lat,kind,observed_m,model_m,error_m,ground_m,model_depth_m,call', ...sc.points.map(p => [JSON.stringify(p.name), p.lon, p.lat, p.kind, n(p.wse ?? p.depth), n(p.model), n(p.error), n(p.ground), n(p.modelDepth), p.call ?? ''].join(','))].join('\n');
}
/** Run every combination of the three settings (in the speed mode unless unticked), score each, keep the best. */
let sweepStop = false;
$('calStop').onclick = () => { sweepStop = true; };
$('calSweep').onclick = async () => {
  if (!model || !S.obs.length) return;
  const plan = sweepPlan(['manning', 'infil', 'clog'], Number($('calLevels').value)), dx0 = $('dxSel').value, sp0 = $('speed').value, rows = [];
  if ($('calSpeed').checked) $('dxSel').value = '4s';
  $('speed').value = 100; $('speed').dispatchEvent(new Event('input'));
  sweepStop = false; $('calSweep').disabled = true; $('calStop').hidden = false;
  const table = () => {
    const best = rows.reduce((b, r) => (!b || r.score < b.score ? r : b), null);
    $('calTable').innerHTML = `<table class="caltab"><tr><th>Run</th><th>n ×</th><th>infil ×</th><th>clog</th><th>RMSE</th><th>bias</th><th>calls</th><th>score</th></tr>` +
      rows.map((r, i) => `<tr${r === best ? ' class="best"' : ''}><td>${i + 1}</td><td>${r.set.manning}</td><td>${r.set.infil}</td><td>${Math.round(r.set.clog * 100)} %</td><td>${r.rmse == null ? '–' : (r.rmse * 1000).toFixed(0) + ' mm'}</td><td>${r.bias == null ? '–' : (r.bias * 1000).toFixed(0) + ' mm'}</td><td>${r.calls ? `${r.calls - r.misses - r.falseAlarms}/${r.calls}` : '–'}</td><td>${r.score.toFixed(3)}</td></tr>`).join('') + '</table>';
    return best;
  };
  try {
    for (const [i, set] of plan.entries()) {
      if (sweepStop) break;
      $('calManning').value = set.manning; $('calInfil').value = set.infil; $('calClog').value = set.clog;
      for (const id of ['calManning', 'calInfil', 'calClog']) $(id).dispatchEvent(new Event('input'));
      $('calScore').textContent = `Sweep run ${i + 1} of ${plan.length}…`;
      resetRun(); if (!run) break;
      $('runBtn').onclick(); const err = await run.done; if (err) throw err;
      const sc = scoreNow(); rows.push({ set, ...sc }); table();
    }
    const best = table();
    if (best) {
      $('calManning').value = best.set.manning; $('calInfil').value = best.set.infil; $('calClog').value = best.set.clog;
      for (const id of ['calManning', 'calInfil', 'calClog']) $(id).dispatchEvent(new Event('input'));
      $('calScore').innerHTML = `Best of ${rows.length} runs applied: n ${best.set.manning}×, infiltration ${best.set.infil}×, clogging ${Math.round(best.set.clog * 100)} %` +
        (best.rmse != null ? `, RMSE ${(best.rmse * 1000).toFixed(0)} mm` : '') + (rows.length > 1 && Math.max(...rows.map(r => r.score)) - best.score < 0.01 ? '. The observations barely change across these settings (under 1 cm), so they do not pin them down: add marks where water moves, or timing' : '') + ($('calSpeed').checked ? '. Run it at 1 m to confirm.' : '.');
    }
  } catch (e) { $('calScore').textContent = 'Sweep stopped: ' + e.message; }
  finally {
    $('dxSel').value = dx0; $('speed').value = sp0; $('speed').dispatchEvent(new Event('input'));
    $('calSweep').disabled = false; $('calStop').hidden = true; resetRun();
  }
};

// ------------------------------------------------------------------ projects
/** Everything needed to rebuild and rerun: area, every sidebar control, storm and drainage choices, map view. */
function captureProject() {
  const inputs = {};
  for (const el of document.querySelectorAll('.rail input[id], .rail select[id], .rail textarea[id]')) {
    if (el.type === 'file' || el.id === 'findInput' || el.id === 'exampleSel') continue;
    inputs[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return { version: 1, area: S.area, poly: S.poly, place: $('findNote').textContent.split('. Now')[0] || '', stormSrc, drainSrc, inputs,
    hist: stormSrc === 'hist' ? { event: $('histEvent').value, label: $('histEvent').selectedOptions[0]?.textContent ?? '' } : null,
    view: { center: map.getCenter().toArray(), zoom: map.getZoom() }, infraUnits: $('infraUnits').value, obs: S.obs,
    activeScenario: design.active?.name ?? null, designUnits: design.units };
}
/**
 * Site-design scenarios for the project folder: the features, plus scenario.json with the settings, presets used and
 * every resolved value (each building's FFE and pad), applied to existing conditions now so they are current.
 */
function scenarioFiles() {
  return design.scenarios.map(s => {
    const json = { settings: s.settings };
    if (model) {
      const r = applyDesign(model.base, { features: s.design.features, settings: s.settings, locked: s.locked }, { toCell: llCell, wse: model.baseWse ?? null, water: fineWater() });
      Object.assign(json, resolvedValues(s.design, r.log));
    } else json.locked = s.locked;
    return { name: s.name, design: s.design, json };
  });
}
/** Scenarios read from a project: each building keeps the FFE and pad it was saved with (until it is edited). */
function loadScenarios(list) {
  return list.map(s => {
    const locked = { ...(s.json?.locked ?? {}) };
    for (const [id, v] of Object.entries(s.json?.features ?? {})) if (v.type === 'building' && Number.isFinite(v.ffe)) locked[id] = { ffe: v.ffe, pad: v.pad };
    return { name: s.name, design: s.design, settings: s.json?.settings ?? {}, locked };
  });
}
function applyInputs(inputs) {
  for (const [id, v] of Object.entries(inputs ?? {})) {
    const el = $(id); if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('input')); // refresh the value labels; 'change' would rebuild on every field
  }
  for (const id of linkFields) $(id).dispatchEvent(new Event('change')); // remember linked URLs
}
async function restoreProject(pj, layer, scenarios = [], analysis = null) {
  stopRun(); model = null; logEl.textContent = '';
  applyInputs(pj.inputs); infra.setLayer(layer); S.obs = pj.obs ?? []; drawObs(); obsNote();
  design.setScenarios(loadScenarios(scenarios), pj.activeScenario); design.setAnalysis(analysis); compareUI.clear();
  setStormSource(pj.stormSrc ?? 'a14'); setDrainSource(pj.drainSrc ?? 'network');
  if (!pj.area) { log(`Opened ${pj.name}: no area saved yet`, 'warn'); return; }
  cancelPoly(); setArea(pj.area, pj.poly);
  map.fitBounds([[pj.area[0], pj.area[1]], [pj.area[2], pj.area[3]]], { padding: 40, duration: 0 });
  await $('buildBtn').onclick();
  if (!model) return;
  // Build sets some defaults for the site (downspouts in combined-sewer areas, the storm source without Atlas 14):
  // put the saved choices back and rebuild the network with them
  applyInputs(pj.inputs); setStormSource(pj.stormSrc ?? 'a14'); setDrainSource(pj.drainSrc ?? 'network'); updateStorm(); resetRun();
  log(`Opened project ${pj.name}`, 'ok', `saved ${pj.saved ? new Date(pj.saved).toLocaleString() : ''}`);
  if (pj.hist?.event) { // historic storms come from the site record: wait for the search, then load the same event
    const t0 = Date.now(); while (![...$('histEvent').options].some(o => o.value === pj.hist.event) && Date.now() - t0 < 90e3) await new Promise(r => setTimeout(r, 500));
    if ([...$('histEvent').options].some(o => o.value === pj.hist.event)) { $('histEvent').value = pj.hist.event; await $('histLoad').onclick(); }
    else log(`Historic event “${pj.hist.label}” not found in the record search: load it again under Storm`, 'warn');
  }
}
const utmPRJ = (zone) => `PROJCS["WGS_1984_UTM_Zone_${zone}N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],` +
  `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],` +
  `PARAMETER["Central_Meridian",${zone * 6 - 183}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
/** ESRI ASCII grid on the solver grid, row 0 = north; walls and cells outside a polygon area are NODATA. */
function ascGrid(v) {
  const { c, F } = run, fine = model.fine, L = [`ncols ${c.nx}`, `nrows ${c.ny}`, `xllcorner ${fine.x0}`, `yllcorner ${fine.y1 - c.ny * F}`, `cellsize ${F}`, 'NODATA_value -9999'];
  for (let j = 0; j < c.ny; j++) {
    const row = new Array(c.nx);
    for (let i = 0; i < c.nx; i++) { const k = j * c.nx + i; row[i] = !c.mask[k] || (c.inside && !c.inside[k]) || !Number.isFinite(v[k]) ? '-9999' : String(Math.round(v[k] * 1000) / 1000); }
    L.push(row.join(' '));
  }
  return L.join('\n') + '\n';
}
/** ESRI ASCII grid at the 1 m DEM resolution; buildings and cells outside a polygon area are NODATA. */
function ascFine(v) {
  const fine = model.fine, { c, F } = run, L = [`ncols ${fine.nx}`, `nrows ${fine.ny}`, `xllcorner ${fine.x0}`, `yllcorner ${fine.y1 - fine.ny * fine.dx}`, `cellsize ${fine.dx}`, 'NODATA_value -9999'];
  for (let j = 0; j < fine.ny; j++) {
    const row = new Array(fine.nx);
    for (let i = 0; i < fine.nx; i++) { const k = j * fine.nx + i, cc = ((j / F) | 0) * c.nx + ((i / F) | 0); row[i] = model.f.bld[k] || (c.inside && !c.inside[cc]) ? '-9999' : String(Math.round(v[k] * 1000) / 1000); }
    L.push(row.join(' '));
  }
  return L.join('\n') + '\n';
}
const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html.replace(/<span class="pill/g, ' · <span class="pill'); return d.textContent; };
/** The finished (or paused) run as files for the project's runs folder. */
async function runFiles() {
  if (!run?.solver || !run.hmax || !model) return null;
  await readMass();
  const { c, F } = run, A = F * F; let peak = 0, flooded = 0, wet = 0;
  const maxFine = c.sg ? toFine(c, run.hmax, 1) : null, fine = model.fine;
  if (maxFine) for (let k = 0; k < maxFine.length; k++) { // subgrid: peak depth, extents at 1 m
    const cc = (((k / fine.nx) | 0) / F | 0) * c.nx + ((k % fine.nx) / F | 0); if (c.inside && !c.inside[cc]) continue;
    const h = maxFine[k]; if (h > peak) peak = h; if (h > 0.15) flooded += fine.dx ** 2; if (h > 0.05) wet += fine.dx ** 2;
  } else for (let k = 0; k < c.nx * c.ny; k++) { if (!c.mask[k] || (c.inside && !c.inside[k])) continue; const h = run.hmax[k]; if (h > peak) peak = h; if (h > 0.15) flooded += A; if (h > 0.05) wet += A; }
  const prj = utmPRJ(model.fine.zone), enc = new TextEncoder();
  const calSc = S.obs.length ? scoreNow() : null;
  const summary = {
    project: projects.current?.name, savedUTC: new Date().toISOString(), finished: !run.playing && $('runBtn').textContent === 'Done',
    site: model.site, extent: S.area, polygon: S.poly, grid: { nx: c.nx, ny: c.ny, cellM: F, epsg: model.fine.epsg, mode: c.sg ? 'subgrid speed mode (1 m tables; max_depth.asc at 1 m, other grids per solver cell)' : 'standard' },
    storm: { label: stormLabel(run.storm), ...stormMeta(run.storm) }, drainage: plain(drainLabel()), greenInfrastructure: plain(giLabel()),
    calibration: { settings: cal(), score: calSc && { n: calSc.n, biasM: calSc.bias, maeM: calSc.mae, rmseM: calSc.rmse, within15cm: calSc.within15, hits: calSc.hits, misses: calSc.misses, falseAlarms: calSc.falseAlarms } },
    scenario: run.scenario ?? 'Existing conditions', designHash: run.record?.designHash ?? gridHash(), forcingHash: (run.record?.forcing ?? CMP.fingerprint(forcingRecord(run))).hash,
    forcing: run.record?.forcing ?? CMP.fingerprint(forcingRecord(run)), commit: appCommit, grids: run.record ? Object.fromEntries(Object.entries(CMP.GRIDS).map(([k, v]) => [`grids/${k}.f32`, v])) : null,
    books: run.record?.books ?? null, controlLines: run.record?.lines.map(l => ({ id: l.id, name: l.name, volumeM3: l.volume, plusM3: l.plus, minusM3: l.minus, faces: l.faces, ...CMP.lineStats(l) })) ?? null,
    design: run.scenario && model.design ? { ...resolvedValues(design.active?.design ?? { features: [] }, model.design.log), newBuildings: run.flooded ?? null } : null,
    infrastructureLayer: infra.layer.features.length, storageUnits: run.storage ?? [], floodBarriers: run.watch?.results() ?? [],
    hazard: Object.fromEntries(Object.entries(STANDARDS).map(([k, st]) => [k, { name: st.name, note: st.note,
      areaM2: Object.fromEntries(run.haz.classAreas(k, A, (q) => c.mask[q] && (!c.inside || c.inside[q]), wetAreaOf()).map((a, i) => [st.classes[i].label, a])) }])),
    results: { simulatedS: run.solver.t, wallClockS: run.wall ?? null, peakDepthM: peak, areaMaxDepthOver15cmM2: flooded, areaMaxDepthOver5cmM2: wet,
      surfaceMass: run.mass, network: run.netMass ?? null, exchange: run.coupler?.totals ?? null, steps: run.solver.steps },
    settings: captureProject(),
    files: { 'max_depth.asc': 'maximum depth (m), ESRI ASCII + .prj: solver grid, or 1 m in the subgrid speed mode', 'max_speed.asc': 'maximum speed (m/s) where deeper than 1 cm', 'hyetograph.csv': 'rain (mm/hr) per block',
      'network.inp': 'EPA SWMM model as run', 'swmm_report.rpt': 'SWMM report', 'infrastructure.geojson': 'drawer layer at run time',
      'barriers.csv': 'per flood barrier: crest, freeboard, overtopping volume and rates, peak hydrostatic load',
      'hazard_arr.asc': 'worst ARR 2019 / AIDR hazard class reached, 1–6 = H1–H6 (0 = never 1 cm deep)', 'hazard_fd2320.asc': 'worst UK FD2320 class, 1–4 = Low…Extreme (debris factor 0)',
      'hazard_fd2320_urban.asc': 'the same with the FD2320 urban debris factor', 'max_dv.asc': 'peak depth × velocity at the same moment (m²/s)',
      'max_force.asc': 'peak force per metre of width ρ(h·v² + ½g·h²) (kN/m)', 'max_bed_shear.asc': 'peak bed shear ρg·n²·v²/h^⅓ (Pa)', 'bed_change_cm.asc': 'sediment transport: bed change (cm, − scour, + deposit)', 'suspended_solids_mm.asc': 'solids still in suspension at the end (mm per area)', 'collapse_wetted.asc': 'collapsible-soil susceptibility (1 low, 2 moderate, 3 high) where the flood wetted the ground, 1 m', 'scour_class.asc': 'scour potential 0 none, 1 low, 2 moderate, 3 high (NODATA = paved)', 'scour_potential_cm.asc': 'indicative scour depth, excess-shear law (cm)', 'flood_duration_min.asc': 'minutes deeper than 15 cm', 'arrival_min.asc': 'minutes from the start until 15 cm deep (NODATA = never)',
      notes: 'Max depth, hazard, force, d·v, duration, arrival and barrier levels, loads and volumes are tracked every solver step; velocity counts in hazard and force only where water is at least 5 cm deep.' },
  };
  const st = run.storm, csv = ['start_min,end_min,mm_per_hr', ...st.intensity.map((v, i) => `${i * st.blockMin},${(i + 1) * st.blockMin},${v}`)].join('\n');
  const files = [
    { path: 'summary.json', data: JSON.stringify(summary, null, 1) },
    { path: 'max_depth.asc', data: maxFine ? ascFine(maxFine) : ascGrid(run.hmax) }, { path: 'max_depth.prj', data: prj },
    { path: 'max_speed.asc', data: ascGrid(run.smax) }, { path: 'max_speed.prj', data: prj },
    { path: 'hyetograph.csv', data: csv }, { path: 'infrastructure.geojson', data: JSON.stringify(infra.layer) },
    ...(run.scenario && design.active ? [{ path: 'design.geojson', data: JSON.stringify(design.active.design) }] : []),
    ...(design.analysis.features.length ? [{ path: 'analysis.geojson', data: JSON.stringify(design.analysis) }] : []),
  ];
  const hz = run.haz, grid = (name, v) => files.push({ path: name + '.asc', data: ascGrid(v) }, { path: name + '.prj', data: prj });
  grid('hazard_arr', hz.cls.arr); grid('hazard_fd2320', hz.cls.defra); grid('hazard_fd2320_urban', hz.cls.defraUrban);
  grid('max_dv', hz.dv); grid('max_force', hz.force);
  if (run.sedState) {
    grid('bed_change_cm', run.sedState.bed.map(v => v * 100)); grid('suspended_solids_mm', run.sedState.suspended.map(v => v * 1000)); grid('bed_grain_size_mm', run.sedState.size.map(v => v * 1000));
    files.push({ path: 'sediment_by_grain_class.csv', data: ['class,suspended_m3,bed_store_change_m3,carried_out_m3', ...run.sedState.classes.map(cl => `${cl.name},${cl.suspended.toFixed(3)},${cl.change.toFixed(3)},${cl.out.toFixed(3)}`)].join('\n') });
    if (run.debris) grid('slope_failure_min', run.sedState.failed.map(v => (v >= 0 ? v / 60 : NaN)));
  }
  if (run.bankState) {
    grid('bank_collapse_probability', run.bankCell.map(v => (v >= 0 ? v : NaN)));
    const bs = run.bankState, ll = (k) => fromUTM(model.fine.x0 + ((k % run.c.nx) + 0.5) * run.F * model.fine.dx, model.fine.y1 - (((k / run.c.nx) | 0) + 0.5) * run.F * model.fine.dx, model.fine.zone);
    files.push({ path: 'banks.csv', data: ['lon,lat,height_m,run_m,slope_deg,cohesion_kpa,friction_deg,lowest_fs,lowest_fs_min,collapse_probability,probability_min,max_water_on_bank_m', ...run.banks.map((b, m) => { const [lo, la] = ll(b.top);
      return [lo.toFixed(6), la.toFixed(6), b.H.toFixed(2), b.L.toFixed(1), (Math.atan2(b.H, b.L) * 180 / Math.PI).toFixed(1), (b.c / 1000).toFixed(1), (Math.atan(b.tanPhi) * 180 / Math.PI).toFixed(1), bs.minFS[m] < 1e29 ? bs.minFS[m].toFixed(3) : '', bs.tMinFS[m] >= 0 ? (bs.tMinFS[m] / 60).toFixed(1) : '', bs.maxPf[m] === UNRATED ? 'not rated' : bs.maxPf[m].toFixed(3), bs.tMaxPf[m] >= 0 ? (bs.tMaxPf[m] / 60).toFixed(1) : '', bs.hwMax[m].toFixed(2)].join(','); })].join('\n') });
  }
  if (model.f.collapse) { const W = model.fine.nx; run.lastMaxFine = null; files.push({ path: 'collapse_wetted.asc', data: ascFine(Float32Array.from(model.f.collapse, (v, k) => collapseAt(k, k % W, (k / W) | 0))) }, { path: 'collapse_wetted.prj', data: prj }); }
  if (run.scour) { grid('max_bed_shear', hz.shear); grid('scour_class', Float32Array.from(hz.shear, (v, k) => scourClass(v, run.scour.tauC[k]) < 0 ? NaN : scourClass(v, run.scour.tauC[k]))); grid('scour_potential_cm', hz.erosion.map(v => v * 100)); } grid('flood_duration_min', hz.duration.map(s => s / 60)); grid('arrival_min', hz.arrival.map(s => s / 60));
  if (run.inp) files.push({ path: 'network.inp', data: run.inp });
  if (run.watch) files.push({ path: 'barriers.csv', data: barrierCSV(run.watch.results()) });
  if (calSc) files.push({ path: 'calibration.csv', data: calCSV(calSc) });
  if (run.swmmReport) files.push({ path: 'swmm_report.rpt', data: run.swmmReport });
  if (run.record) { // the 1 m comparison grids (.f32 + ESRI header), control-line hydrographs, new buildings
    const rec = run.record, hdr = CMP.gridHeader(rec.geo);
    for (const [k, v] of [...Object.entries(rec.grids), ['hazard_arr', rec.hazard]]) files.push({ path: `grids/${k}.f32`, data: CMP.encodeF32(v) }, { path: `grids/${k}.hdr`, data: hdr });
    files.push({ path: 'lines.json', data: JSON.stringify(rec.lines) }, { path: 'buildings.json', data: JSON.stringify(rec.newBuildings) });
    if (rec.lines.length) files.push({ path: 'control_lines.csv', data: CMP.toCSV(rec.lines.flatMap(l => CMP.hydrograph(l.series).map(([t, q], m) => ({ line: l.id, name: l.name, t, q, out: CMP.hydrograph(l.series, 2)[m]?.[1], back: CMP.hydrograph(l.series, 3)[m]?.[1] }))), [['line', 'line'], ['name', 'name'], ['t', 'time_s', 0], ['q', 'net_flow_m3s', 5], ['out', 'flow_to_plus_m3s', 5], ['back', 'flow_to_minus_m3s', 5]]) });
  }
  return files.map(f => ({ path: f.path, data: typeof f.data === 'string' ? enc.encode(f.data) : f.data }));
}
function barrierCSV(rs) {
  const n = (v, d = 3) => (v == null || !Number.isFinite(v) ? '' : String(+v.toFixed(d))), min = (t) => (t == null ? '' : n(t / 60, 2));
  const name = (r) => infra.layer.features.find(f => f.id === r.id)?.properties.name ?? '';
  return ['id,name,type,length_m,crest_min_m,crest_max_m,deployed_at_min,min_freeboard_m,max_water_level_m,overtopped,first_overtop_min,volume_over_m3,peak_rate_m3s,peak_rate_min,peak_unit_q_m2s,peak_load_kN_per_m,peak_load_min,berm_fill_m3',
    ...rs.map(r => [r.id, JSON.stringify(name(r)), r.type, n(r.length, 1), n(r.crestMin), n(r.crestMax), r.deployAt == null ? 'never' : min(r.deployAt), n(r.minFreeboard), n(r.maxLevel), r.overtopped ? 'yes' : 'no',
      min(r.tOver), n(r.overVol, 2), n(r.peakRate), min(r.tPeakRate), n(r.peakUnitQ), n(r.peakLoad, 2), min(r.tLoad), n(r.fill, 1)].join(','))].join('\n');
}
const projects = initProjects({ capture: captureProject, layer: () => infra.layer, restore: restoreProject, runFiles, scenarios: scenarioFiles, analysis: () => design.analysis });

window.__floodsim = { get run() { return run; }, get model() { return model; }, get records() { return records; }, map, infra, design, projects, buildPackage, runFiles }; // console debugging
gpuReady.then(() => updateSizeNote());
