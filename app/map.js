// FloodSim map app: draw an area → fetch open data → build a 1 m model → run the GPU solver → live 2D depth on a
// satellite basemap → export a 3D package. Expects the global `maplibregl` and the dev server's /api/fetch proxy.
import { GPUSolver } from '../src/solver-gpu.js';
import { gridFromLonLatBox, fromUTM, polygonCells, insideRing } from '../src/geo.js';
import { fetchDEM, fetchOSM, fetchNLCD, fetchSoils, NLCD_COLORS, NLCD_NAMES, toCells } from '../src/ingest.js';
import { buildFine, coarsen, coarseIds, hillshade, roofConnections, roofRouting, MANNING_ROAD } from '../src/terrain.js';
import { applyDesign, floodedBuildings, resolvedValues, hashFine, withValues, designVariables } from '../src/design.js';
import { downscaleDepth, volumeRatio } from '../src/downscale.js';
import { zip, png16, exr, buildingsGLB } from '../src/export.js';
import { fetchAtlas14, hyetograph, constantStorm, rainAt, rainDepthTo, ddf, fitGEV, annualMaxima24h, recordStorm, wettest24, gevQuantile, pdsToAms } from '../src/storm.js';
import { synthNetwork, toINP, lumpedInfil, addTanks, outfallCells, ROUTING_DEFAULTS } from '../src/drainage.js';
import * as CSO from '../src/cso.js';
import { giLayers, GI } from '../src/gi.js';
import { drawnGI, OutletLinks, UnderdrainLinks, detentionTable } from '../src/stormwater.js';
import { loadSWMM, SWMM } from '../src/swmm.js';
import * as H from '../src/history.js';
import * as R from '../src/radar.js';
import * as MR from '../src/mrms.js';
import * as RG from '../src/raingauge.js';
import * as NC from '../src/nowcast.js';
import { labelImage } from './labels.js';
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
import { initEmulator } from './emulator-ui.js';
import * as CMP from '../src/compare.js';
import { INLET_KINDS, GENERIC_KINDS, INLET_STANDARDS, defaultStandard, inletTypeCounts, typeKinds, applyInletKinds, detectTypeField } from '../src/inlettypes.js';
import * as REP from '../src/report.js';
import { initReport } from './report-ui.js';
import { initProjects, readBytes, readBytesOptional, readOptional, readFile as readProjectFile, writeFile as writeProjectFile, stamp } from './projects.js';
import { buildBarriers, BarrierWatch } from '../src/barriers.js';
import { buildSubgrid, fineDepth, CT as SG_CT, FT as SG_FT } from '../src/subgrid.js';
import { watershed } from '../src/watershed.js';
import { gaCells, WETNESS, COLLAPSE_CLASSES } from '../src/soil.js';
import { sedimentCells } from '../src/sediment.js';
import { findBanks, bankClass, BANK_CLASSES, UNRATED } from '../src/banks.js';
import { scourCells, scourClass, SCOUR_CLASSES, NOT_ERODIBLE } from '../src/scour.js';
import { parseObservations, scoreRun, sweepPlan, PARAMS, fromSTN } from '../src/calibrate.js';
import { fromGeoJSONMap, scoreFloodMap, DEP_CLASSES } from '../src/floodmaps.js';
import { markBands, mapBands } from '../src/uncertainty.js';
import { gaugeScore, hydrographScore, matchEvent } from '../src/validate.js';
import { findGauges, gaugeFlows, annualPeaks, lp3, designHydrograph, recordedHydrograph, riverEntries, entryCells, entryEdge, InflowLinks, CFS, basinAreaKm2, areaRatioScale } from '../src/inflow.js';
import { STANDARDS, HazardTracker, WET, VCUT } from '../src/hazard.js';
import { findLevelGauges, readLevels, gaugeSurface, lidarSurfaceNear, waterCells, startDepths, cellAt, waterNear, ngvdToNavd, levelSeries, nearestCells, surfaceAtGauge, gaugeWater, tidalEdgeCells, levelGauge } from '../src/waterlevels.js';
import { edgeSection, outletSeries, sideToward, riverPath, pathToEdge, cutSections, outletSeriesReach, edgeAsSection } from '../src/outlet.js';
import * as FEMA from '../src/fema.js';
import * as WIN from '../src/window.js';
import { CURVES, flatWater, accumulation, carveChannels } from '../src/bathymetry.js';
import { blueTopoGrid, mergeSurvey } from '../src/topobathy.js';
import * as CK from '../src/checkpoint.js';
import { initBatch } from './batch-ui.js';
import * as DMG from '../src/damage.js';
import * as AR from '../src/areas.js';
import * as CHK from '../src/checks.js';
import * as MAPS from '../src/maps.js';
import * as RAS from '../src/hecras.js'; // HEC-RAS handoff: the 2D package export, 1D cross-sections into the channel bed
import { MANNING } from '../src/terrain.js';
import { layerInputs, transformFor } from '../src/infra.js';
import { toUTM } from '../src/geo.js';
import * as SSX from '../src/streamstats.js'; // ungauged inflows
import * as CPD from '../src/compound.js';
import * as RQ from '../src/rainqa.js';
/**
 * Emulator-run overrides, read where each input is made: { ari (yr, between Atlas 14 columns too), rain (depth
 * factor), inflow (scale on every river hydrograph), tide (m on the observed water level), se (Green-Ampt wetness at
 * the start), design: { '<id>.<prop>': value } }; null for every other run. emuPrep: the gauge readings a study reuses.
 */
let emu = null, emuPrep = null;
/** The next run's window (runWindowPair): { mode: 'record' (existing conditions, booking the window's edge) | 'rerun', rect, base }. */
let windowNext = null;

const $ = (id) => document.getElementById(id);
const MMHR = 1 / 1000 / 3600;
const MAX_FINE = 20e6;                   // 1 m DEM cells we are willing to hold in the page (Manayunk, 5.3 × 3.4 km: 18M)
/** Example sites across the US, each exercising something different. `links` pre-fills the linked-data panel. */
const EXAMPLES = [
  { name: 'Eastwick, Philadelphia PA', why: 'low-lying, tidal creek, repeatedly flooded', box: [-75.2475, 39.9055, -75.2355, 39.9145] },
  { name: 'South Street, Philadelphia PA', why: 'combined sewers, real utility inlets', box: [-75.1590, 39.9405, -75.1525, 39.9440] },
  { name: 'West Hollywood CA', why: 'public storm-drain GIS linked in (tier 1)', box: [-118.3800, 34.0855, -118.3720, 34.0915],
    links: { pipes: ['https://gis.weho.org/arcgis/rest/services/DPW/StormDrains/MapServer/1', 'https://gis.weho.org/arcgis/rest/services/DPW/StormDrains/MapServer/2'],
      inlets: ['https://gis.weho.org/arcgis/rest/services/DPW/StormDrains/MapServer/0'] } },
  { name: 'Laurelhurst, Portland OR', why: 'combined sewers linked in (tier 1): 12 Sep 2018 cloudburst', box: [-122.634, 45.524, -122.619, 45.534],
    // City of Portland BES open data: mains only (the layer mixes in laterals), inlets from the node layer; inverts on the
    // City of Portland datum, NAVD88 = City + 2.10 ft
    links: { pipes: ["https://www.portlandmaps.com/od/rest/services/COP_OpenData_Utilities/MapServer/108?where=LAYER_GROUP%20IN%20(%27SEWER%20PIPES%27%2C%27STORM%20PIPES%27)%20AND%20SERVSTAT%3D%27IN%27"],
      inlets: ["https://www.portlandmaps.com/od/rest/services/COP_OpenData_Utilities/MapServer/105?where=UNITTYPE%3D%27INLET%27"], datum: 2.10 } },
  { name: 'Manayunk, Philadelphia PA', why: 'Schuylkill flood: Ida 2021, 15 USGS high-water marks and a river gauge', box: [-75.262, 40.0135, -75.200, 40.0445] },
  { name: 'Forest Hills, Queens NY', why: 'Ida 2021 street flooding: 31 USGS high-water marks, USGS depth maps, NYC DEP flood maps', box: [-73.870, 40.702, -73.828, 40.748] },
  { name: 'Meyerland, Houston TX', why: 'flat, bayou-side, flash flooding', box: [-95.4740, 29.6790, -95.4620, 29.6880] },
  { name: 'Ellicott City MD', why: 'steep valley, 2016 and 2018 flash floods', box: [-76.8020, 39.2650, -76.7930, 39.2710] },
  { name: 'Miami Beach FL', why: 'tidal and storm-surge flooding', box: [-80.1390, 25.7880, -80.1290, 25.7960] },
  { name: 'Waikiki, Honolulu HI', why: 'Hawaii: local datums, no Atlas 14 gaps', box: [-157.8320, 21.2740, -157.8230, 21.2820] },
];
const fmtTime = (t) => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const fmtVol = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M m³` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k m³` : `${v.toFixed(v < 10 ? 2 : 0)} m³`;
const fmtArea = (a) => a >= 1e4 ? `${(a / 1e4).toFixed(2)} ha` : `${Math.round(a).toLocaleString()} m²`;
const fetcher = (url, o = {}) => fetch('/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url, method: o.method, body: o.body, contentType: o.contentType, linked: o.linked, range: o.range }) });
/** Fetcher for links the user pasted: the proxy lets these reach any public https host (GET only). */
const linkedFetcher = (url) => fetcher(url, { linked: true });

const S = { area: null, poly: null, view: 'depth', opacity: 0.85, hmin: 0.01, obs: [] }; // poly: lon/lat ring of a polygon area (S.area is its box)
let device = null, model = null, run = null;
const radar = { mode: 'off', frames: [], k: -1, key: '', layers: [], follow: true, play: 0, live: 0 }; // NEXRAD overlay (View)
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
let appCommit = 'unknown', appChanged = []; // the server's checkout: part of every run's forcing fingerprint; the code files changed from it
fetch('/api/version', { cache: 'no-store' }).then(r => r.json()).then(v => { if (v.commit) appCommit = v.commit + (v.dirty ? '+dirty' : ''); appChanged = v.changed ?? []; }).catch(() => {}); // Build awaits it: a project opened at page load can finish building before the GPU is up
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.on('moveend', () => { try { localStorage.setItem('floodsim.view', JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom() })); } catch { /* storage off */ } });
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.touchZoomRotate.disableRotation();

const canvases = { rain: document.createElement('canvas'), depth: document.createElement('canvas'), shade: document.createElement('canvas'), lc: document.createElement('canvas'), dz: document.createElement('canvas'), fema: document.createElement('canvas') };
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
/** FEMA NFHL for the design (src/fema.js): zone and BFE over a footprint, and the BFE grid for floodplain fill. */
const femaOpts = () => (model?.fema ? { bfeAt: (cells) => FEMA.atCells(model.fema.grids, cells), bfeGrid: model.fema.grids.bfe } : {});
/** The build-log line for the NFHL: zones by area, the BFE range, the datum. → [text, level, detail] */
function femaSummary(fe, fine) {
  const a = FEMA.zoneAreas(fe.grids, fine.dx ** 2), tot = fine.nx * fine.ny * fine.dx ** 2, sfha = Object.entries(a).filter(([c]) => FEMA.ZONE_INFO[c]?.sfha).reduce((p, [, v]) => p + v, 0);
  let lo = Infinity, hi = -Infinity; for (const v of fe.grids.bfe) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const zones = Object.entries(a).sort((p, q) => q[1] - p[1]).map(([c, v]) => `${c === 'X500' ? 'X (0.2 %)' : c === 'FW' ? 'floodway' : c} ${Math.round(100 * v / tot)} %`).join(', ');
  if (!fe.data.zones.length) return ['FEMA: no mapped flood zones here', 'ok', 'NFHL has no S_FLD_HAZ_AR polygons in the area (unmapped or not yet digital)'];
  return [`FEMA: ${Math.round(100 * sfha / tot)} % of the area in the 1 % floodplain${Number.isFinite(lo) ? `, BFE ${(lo / 0.3048).toFixed(1)}–${(hi / 0.3048).toFixed(1)} ft` : ''}`, sfha ? 'warn' : 'ok',
    `${zones} · ${fe.data.lines.length} BFE lines / cross-sections · ${fe.data.datum}${fe.data.shift ? ` (NGVD29 + ${fe.data.shift.toFixed(3)} m by NOAA NCAT)` : ''} · FEMA NFHL`];
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
  const dsg = { features: sc.design.features, settings: sc.settings, locked: sc.locked };
  const r = applyDesign(model.base, emu?.design ? withValues(dsg, emu.design) : dsg, { ...femaOpts(), toCell: (p) => toCells(fine, [p])[0], wse: model.baseWse ?? null, water: fineWater(), hash: false });
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
try { $('linkDatum').value = localStorage.getItem('floodsim.linkDatum') ?? '0'; } catch { /* storage off */ }
for (const id of [...linkFields, 'linkUnits', 'linkDatum']) $(id).addEventListener('change', () => { try { localStorage.setItem('floodsim.' + id, $(id).value); } catch { /* storage off */ } });
const splitLinks = (s) => s.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
/** The linked layers and their datum for the run's fingerprint: present only when set, so runs without them keep their hashes. */
function linkedPart() { const l = linkedLinks(), d = Number($('linkDatum').value) || 0; return { ...(l.pipes.length || l.inlets.length || l.outfalls.length ? { linked: CMP.hashOf(l) } : {}), ...(d ? { linkDatum: d } : {}) }; }
/**
 * What the utility layers returned, as counts and hashes: the linked pipes, inlets and outfalls, and the built-in
 * utility's inlets and outfalls. The links alone (linkedPart) do not change when a city republishes its data; this does,
 * so two runs on different versions of it never compare as the same drainage. Null without any (older hashes kept).
 */
function utilityData() {
  if (!model) return null;
  if (model.utilityData !== undefined) return model.utilityData;
  const L = model.linked, u = model.util, part = (a) => (a?.length ? { n: a.length, hash: CMP.hashOf(a) } : null), o = {};
  for (const [k, a] of [['pipes', L?.pipes], ['inlets', L?.inlets], ['outfalls', L?.outfalls], ['utilityInlets', u?.inlets], ['utilityOutfalls', u?.outfalls]]) { const p = part(a); if (p) o[k] = p; }
  return (model.utilityData = Object.keys(o).length ? o : null);
}
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
      const datum = Number($('linkDatum').value) || 0;
      const recs = pipeRecords(feats, map, { datum }); out.pipes.push(...recs);
      out.combinedPipes = (out.combinedPipes ?? 0) + recs.filter(r => r.combined).length;
      out.notes.push(`${src.name}: size ${map.size ?? 'none'} (${map.sizeUnits})${map.width ? ', width ' + map.width : ''}${map.shape ? ', shape ' + map.shape : ''}${map.system ? `, system ${map.system} (${recs.filter(r => r.combined).length} of ${recs.length} combined)` : ''}${map.upInvert ? `, inverts ${map.upInvert}/${map.dnInvert}${datum ? ` ${datum > 0 ? '+' : '−'}${Math.abs(datum)} to NAVD88` : ''}` : ', no inverts'}${map.status ? ', drops ' + map.status : ''}`);
    } else {
      if (src.kind !== 'point') throw new Error(`${src.name} has ${src.kind} features, ${kind} must be points`);
      const tf = kind === 'inlets' ? detectTypeField(src.fields) : null; // what each structure is (Inlet hydraulics → Inlet types)
      out[kind].push(...pointRecords(feats, tf));
      if (tf) out.notes.push(`${src.name}: inlet type from ${tf}`);
    }
  }
  out.combined = out.pipes.length > 0 && out.combinedPipes > out.pipes.length / 2; // most of the linked pipes are combined sewers
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
  $('linkDatum').value = e.links?.datum ?? 0; $('linkDatum').dispatchEvent(new Event('change'));
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

let buildError = null; // the last build's failure, so a batch run stops waiting for a model that will not come
$('buildBtn').onclick = async () => {
  buildError = null;
  if (!S.area) return;
  stopRun(); model = null; logEl.textContent = '';
  for (const id of ['buildBtn', 'runBtn', 'resetBtn', 'exportBtn', 'rasBtn']) $(id).disabled = true;
  inflow.entries = []; $('inflowBox').hidden = true; $('hwmEvent').hidden = true; $('hwmBtn').disabled = true; // site-specific: found again after the build
  let built; inflow.ready = new Promise((res) => { built = res; }); // a run waits for the whole build, gauge lists included
  const fine = gridFromLonLatBox(...S.area, 1), bounds = fine.lonlatBounds(0.0004);
  try {
    const lDem = log('3DEP bare-earth DEM at 1 m');
    const lOsm = log('OpenStreetMap buildings and roads');
    const lLc = log('NLCD land cover');
    const lSoil = log('SSURGO soils');
    const lA14 = log('NOAA Atlas 14 rainfall frequency');
    const lFema = log('FEMA flood zones (NFHL)');
    const femaP = FEMA.fetchNFHL(fine.lonlatBounds(0.0004), fetcher, { datumShift: (lo, la) => ngvdToNavd(lo, la, fetcher) }).catch((e) => { lFema.set('FEMA flood zones unavailable', 'warn', e.message); return null; });
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
      + ` · ${osm.culverts.length} mapped culverts linked · ${f.channels.snapped} mapped streams moved onto the 1 m thalweg (mean ${f.channels.offset.toFixed(1)} m off the line)`
      + ` · ${f.channels.breaches} road embankments and ${f.channels.fills} channel humps breached`);
    const nfhl = await femaP;
    model = { fine, f, base: f, dem, osm, nlcd, soils, curb, atlas14, util, linked, site: [clon, clat], poly: S.poly };
    renderInletTypes(); // the types in this area's inlet data, and the standard for where it is
    if (nfhl) { model.fema = { data: nfhl, grids: FEMA.nfhlGrids(nfhl, fine, f.z, { step: 4 }) }; lFema.set(...femaSummary(model.fema, fine)); }
    groundCache.clear(); emulatorUI.reset();
    if (rasXS.geom) loadXS().catch(xsFail); // HEC-RAS cross-sections loaded before this build: placed on the new grid
    applyScenario(); // the active design scenario, if any (model.base stays existing conditions)
    const combined = !!(util?.combined || linked?.combined); // the utility's combined-sewer area, or linked pipes marked combined
    $('downspout').value = combined ? 100 : 0; $('downspout').dispatchEvent(new Event('input')); // combined-sewer rowhouses: downspouts tie into the sewer
    $('csoOn').checked = combined; // combined sewers: sanitary flow and regulators (src/cso.js)
    $('a14Btn').textContent = atlas14 ? 'Atlas 14 design' : 'Site-record design';
    for (const id of ['a14dur', 'pattern', 'which']) $(id).closest('.field').hidden = !atlas14; // site-record storms: 24 h, recorded shape
    if (!atlas14) setStormSource('const'); // until the record has loaded
    loadHistory().catch((e) => { $('histEvent').innerHTML = '<option value="">Unavailable</option>'; $('histNote').textContent = 'Historic record unavailable: ' + e.message; });
    updateStorm();
    await mapReady; await gpuReady;
    drawStatic();
    setTiers();
    $('runBtn').disabled = !device; $('resetBtn').disabled = false;
    if (!device) log('WebGPU is required to run the solver', 'err');
    resetRun();
    if (!ws.last) checkWatershed({ quiet: true }); // does anything drain in from outside? (background, after the build)
    obsNote(); $('hwmBtn').disabled = false; groundwaterNote(); setupInflow().catch((e) => { $('inflowNote').textContent = 'River inflow unavailable: ' + e.message; }).finally(built);
  } catch (e) {
    built(); buildError = e.message;
    console.error(e); log('Build failed: ' + e.message, 'err');
  } finally { $('buildBtn').disabled = false; }
};
// slider readouts, once at load (they sat inside Build, so they ran only after a build, once per build)
$('spacing').addEventListener('input', () => { $('spacingOut').textContent = $('spacing').value + ' m'; }); $('spacingOut').textContent = $('spacing').value + ' m';
$('downspout').addEventListener('input', () => { $('downspoutOut').textContent = $('downspout').value + ' %'; }); $('downspoutOut').textContent = $('downspout').value + ' %';
$('lumpRate').addEventListener('input', () => { $('lumpRateOut').textContent = $('lumpRate').value + ' mm/hr'; }); $('lumpRateOut').textContent = $('lumpRate').value + ' mm/hr';

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
  drawFema(corners);
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
    ['Culverts & channels', `${osm.culverts.length} OSM culverts as links (barrel from diameter/width tags, else ${'stream 1.2 m, ditch 0.6 m'}); mapped streams snapped to the 1 m thalweg (least-cost path within 15 m, ${model.f.channels.snapped} lines, mean ${model.f.channels.offset.toFixed(1)} m off the mapped line); along it, ${model.f.channels.breaches} road embankments (≤ 30 m long, ≤ 4 m high) where streams cross roads with no mapped culvert and ${model.f.channels.fills} channel humps with no road (0.5–2 m crest across the whole valley floor, ≤ 40 m long) breached to grade, 3 m wide`],
    ['Storm', stormLabel(currentStorm())],
    ['Extent', `${fine.nx} × ${fine.ny} m, EPSG:${fine.epsg}`],
  ];
  $('tiers').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---- compound flooding and SLR (src/compound.js)
/**
 * The tide gauge's datums, SLR curves and NOAA extreme water levels (info), the NOAA prediction a 'predicted' design
 * tide is cut from (pred, for predKey = station:date), and the joint rain–surge analysis (joint). A design storm takes a
 * design tide (MHHW + surge + SLR, a tide cycle or a prediction, high or low water at the rain peak) as its water level:
 * the same series an observed tide is, so the stage boundary, warm-up, start levels and fingerprint treat it the same.
 */
const cmpd = { gauge: null, info: null, loading: null, error: null, pred: null, predKey: null, predLoading: null, predError: null, joint: null };
{ const y = new Date().getUTCFullYear(), o = $('slrYear').options[0]; if (y < 2030 && o.value !== String(y)) { o.value = String(y); o.textContent = `${y} (today)`; } }
const cmpdEsc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
/** After the tide gauge is found (loadHistory): its datums, SLR and extreme water levels from NOAA CO-OPS. */
function cmpdLoad(gauge) {
  Object.assign(cmpd, { gauge, info: null, error: null, pred: null, predKey: null, predError: null, joint: null });
  $('cmpdCtl').hidden = !gauge; $('cmpdPairs').innerHTML = '';
  if (!gauge) { cmpd.loading = null; return; }
  $('cmpdStation').textContent = `Tide gauge ${gauge.id} ${gauge.name}: datums, sea-level rise and extreme water levels (NOAA CO-OPS)…`;
  cmpd.loading = CPD.fetchTideInfo(gauge.id, fetcher)
    .then(info => { if (cmpd.gauge === gauge) { cmpd.info = info; if (info.notes.length) log('Tide gauge ' + gauge.id + ': ' + info.notes.join('; '), 'warn'); } },
      e => { if (cmpd.gauge === gauge) cmpd.error = e.message; })
    .finally(() => { if (cmpd.gauge !== gauge) return; cmpd.loading = null; cmpdForm(); updateStorm(); });
}
/** What the compound controls are set to. */
function cmpdSettings() {
  return { mode: $('dtMode').value, phase: $('dtPhase').value, date: $('dtDate').value, surge: surgeM(), slr: { scenario: $('slrScen').value, year: Number($('slrYear').value), m: slrM() } };
}
/** The surge on a design tide, m above MHHW (a NOAA extreme water level is the whole high water above MHHW). → { m, label } | null */
function surgeM() {
  const v = $('dtSurge').value;
  if (v === 'none') return { m: 0, label: 'no surge' };
  if (v === 'custom') { const m = Number($('dtSurgeM').value) || 0; return { m, label: 'custom surge' }; }
  const T = Number(v.split(':')[1]), m = CPD.ewlAt(cmpd.info?.ewl?.levels, T);
  return m == null ? null : { m, T, label: `NOAA ${T}-yr high water` };
}
/** Sea-level rise (m) since the datum epoch for the scenario and year set (or another year: a historic event's). */
function slrM(year = Number($('slrYear').value), scen = $('slrScen').value) {
  const I = cmpd.info; if (!I || scen === 'none') return 0;
  if (scen === 'trend') { const r = I.ewl?.trendMmYr ?? (I.slr ? I.slr.background * 1000 : null); return r == null ? 0 : r / 1000 * (year - I.datums.epochMid); }
  return I.slr ? CPD.slrAt(I.slr, scen, year) : 0;
}
const slrName = () => ({ none: 'no sea-level rise', trend: 'the observed trend' }[$('slrScen').value] ?? `2022 Interagency ${$('slrScen').value}`);
/** The rain peak (s from the start): the centre of the heaviest block, the middle for a uniform storm. */
const peakTime = (st) => { if (!st.depth?.length || st.pattern === 'uniform' || st.pattern === 'constant') return st.durationMin * 30; const k = st.depth.indexOf(Math.max(...st.depth)); return (k + 0.5) * st.blockMin * 60; };
const predKeyNow = () => `${cmpd.info?.station}:${$('dtDate').value}`;
/** The NOAA prediction for the design date ± 4 days (a 'predicted' design tide). */
function cmpdPred() {
  const I = cmpd.info, date = $('dtDate').value; if (!I || $('dtMode').value !== 'predicted' || !date) return Promise.resolve();
  const key = predKeyNow(); if (cmpd.predKey === key && (cmpd.pred || cmpd.predLoading)) return cmpd.predLoading ?? Promise.resolve();
  Object.assign(cmpd, { predKey: key, pred: null, predError: null });
  const noon = Date.parse(date + 'T12:00Z');
  cmpd.predLoading = CPD.fetchPrediction(I.station, I.datums.datum, noon - 4 * 864e5, noon + 4 * 864e5, fetcher)
    .then(p => { if (cmpd.predKey === key) cmpd.pred = p; }, e => { if (cmpd.predKey === key) cmpd.predError = e.message; })
    .finally(() => { if (cmpd.predKey !== key) return; cmpd.predLoading = null; cmpdForm(); updateStorm(); });
  return cmpd.predLoading;
}
/** The storm with its coastal water level: a design storm's design tide, a historic tide raised for SLR. */
function withCoast(st) {
  const I = cmpd.info; if (!st || !I) return st;
  if (st.pattern === 'historic') {
    if (!st.wl || !$('slrHist').checked || $('slrScen').value === 'none') return st;
    const from = new Date(st.t0).getUTCFullYear(), year = Number($('slrYear').value), d = slrM() - slrM(from);
    return { ...st, wl: { ...st.wl, v: st.wl.v.map(v => v + d), slr: { scenario: $('slrScen').value, from, year, m: d } } };
  }
  const mode = $('dtMode').value, sg = surgeM(); if (mode === 'off' || !sg) return st;
  const pred = mode === 'predicted' ? (cmpd.predKey === predKeyNow() ? cmpd.pred : null) : null; if (mode === 'predicted' && !pred) return st;
  const slr = slrM(), year = Number($('slrYear').value);
  // from an hour before the start to a day past the longest tail, so a tide cycle keeps turning however long the run is
  const wl = CPD.designTide(I.datums, { mode, phase: $('dtPhase').value, peakS: peakTime(st), startS: -3600, endS: st.durationMin * 60 + 25 * 3600, surge: sg.m, slr,
    pred, predAt: Date.parse($('dtDate').value + 'T12:00Z'), station: I.station, name: cmpd.gauge.name });
  wl.design = { ...wl.design, surge: sg.label, ...(sg.T ? { surgeT: sg.T } : {}), slr: { scenario: $('slrScen').value, year, m: slr }, epoch: I.datums.epoch, ...(mode === 'predicted' ? { date: $('dtDate').value } : {}) };
  return { ...st, wl };
}
/** Before a run: the station data and a prediction loaded; an error when a design tide is set but cannot be made. */
async function coastReady() {
  if (cmpd.loading) await cmpd.loading;
  const mode = $('dtMode').value; if (stormSrc === 'hist' || stormSrc === 'radar' || mode === 'off') return;
  if (!cmpd.info) throw new Error(`Design tide: ${cmpd.gauge ? `NOAA CO-OPS datums for ${cmpd.gauge.id} did not load (${cmpd.error ?? 'unknown error'})` : 'no tide gauge within 60 km'}. Set Design tide to None to run without one.`);
  if (!surgeM()) throw new Error('Design tide: NOAA has no extreme water levels for this station. Pick another surge.');
  if (mode === 'predicted') { await cmpdPred(); if (!cmpd.pred) throw new Error(`Design tide: no NOAA tide prediction for ${$('dtDate').value} (${cmpd.predError ?? 'no data'}).`); }
  if (cmpd.info.datums.datum !== 'NAVD88') log(`Design tide: ${cmpd.info.station} has no NAVD88 datum, so the levels are on its MSL; check the DEM datum`, 'warn');
}
/** The controls shown and the notes: the station, and what the next run's water level will be. */
function cmpdForm() {
  if ($('cmpdCtl').hidden) return;
  const I = cmpd.info, mode = $('dtMode').value, isHist = stormSrc === 'hist' || stormSrc === 'radar';
  $('dtRows').hidden = isHist; $('slrHistRow').hidden = !isHist;
  $('dtPhaseRow').hidden = mode !== 'cycle' && mode !== 'predicted'; $('dtDateRow').hidden = mode !== 'predicted'; $('dtSurgeMRow').hidden = $('dtSurge').value !== 'custom';
  for (const o of $('slrScen').options) o.disabled = o.value === 'none' ? false : o.value === 'trend' ? !(I?.ewl?.trendMmYr != null || I?.slr) : !I?.slr?.scenarios?.[o.value];
  for (const o of $('dtSurge').options) if (o.value.startsWith('ewl:')) o.disabled = !I?.ewl?.levels?.length;
  $('cmpdJoint').disabled = !I || !model;
  if (!I) { $('cmpdStation').textContent = cmpd.error ? `Tide gauge ${cmpd.gauge?.id}: NOAA CO-OPS datums unavailable (${cmpd.error}).` : $('cmpdStation').textContent; $('cmpdNote').textContent = ''; return; }
  const d = I.datums, D = d.datum, e100 = CPD.ewlAt(I.ewl?.levels, 100);
  $('cmpdStation').innerHTML = `NOAA CO-OPS ${I.station} ${cmpdEsc(cmpd.gauge.name)}: MHHW ${f2(d.mhhw)}, MSL ${f2(d.msl)}, MLLW ${f2(d.mllw)} m ${D} (epoch ${d.epoch ?? '?'})` +
    (e100 != null ? `; NOAA 100-yr high water ${f2(e100)} m above MHHW` : '; no extreme water levels') +
    (I.slr ? `; Intermediate rise since ${d.epochMid} ${f2(CPD.slrAt(I.slr, 'Intermediate', 2050))} m by 2050, ${f2(CPD.slrAt(I.slr, 'Intermediate', 2100))} m by 2100.` : '; no SLR projections.') +
    (D !== 'NAVD88' ? ' <span class="pill warn">no NAVD88: levels on MSL</span>' : '');
  const slr = slrM(), year = $('slrYear').value, sl = $('slrScen').value === 'none' ? 'no sea-level rise' : `${f2(slr)} m of rise (${slrName()}, ${year})`;
  if (isHist) {
    const st = hist.storm, from = st?.t0 ? new Date(st.t0).getUTCFullYear() : null;
    $('cmpdNote').textContent = !$('slrHist').checked ? `Tick to raise the event's observed water level by the rise from its year to ${year} (${slrName()}).` :
      from ? `The observed level is raised ${f2(slrM() - slrM(from))} m: the rise from ${from} to ${year} (${slrName()}).` : `The observed level is raised by the rise from the event's year to ${year} (${slrName()}).`;
    return;
  }
  const sg = surgeM(), st = currentStorm(), pk = st ? peakTime(st) / 3600 : null;
  if (mode === 'off') { $('cmpdNote').textContent = `No design tide: the model edges are free outfalls. With one, the open water on the edges takes MHHW (${f2(d.mhhw)} m ${D}) + a surge + ${sl}.`; return; }
  if (!sg) { $('cmpdNote').textContent = 'NOAA has no extreme water levels here: pick None or a custom surge.'; return; }
  const add = sg.m + slr, at = pk != null ? ` at the rain peak (${pk.toFixed(1)} h)` : '';
  $('cmpdNote').textContent = mode === 'still' ? `Still water at ${f2(d.mhhw + add)} m ${D} throughout = MHHW ${f2(d.mhhw)} + ${sg.label} ${f2(sg.m)} + ${sl}.` :
    mode === 'cycle' ? `A tide between ${f2(d.mllw + add)} and ${f2(d.mhhw + add)} m ${D} (MLLW to MHHW, period ${CPD.M2_HOURS.toFixed(2)} h), ${$('dtPhase').value} water${at}, + ${sg.label} ${f2(sg.m)} + ${sl}.` :
    cmpd.pred && cmpd.predKey === predKeyNow() ? `NOAA's prediction around ${$('dtDate').value}: its ${$('dtPhase').value} water ${st?.wl?.design?.tideAt ?? ''} moved to the rain peak${pk != null ? ` (${pk.toFixed(1)} h)` : ''}, + ${sg.label} ${f2(sg.m)} + ${sl}.` :
    cmpd.predError ? `No NOAA prediction for ${$('dtDate').value}: ${cmpd.predError}.` : `NOAA's tide prediction for ${$('dtDate').value}…`;
}
function cmpdChanged() { if ($('dtMode').value === 'predicted') cmpdPred(); updateStorm(); }
for (const id of ['dtMode', 'dtPhase', 'dtDate', 'dtSurge', 'dtSurgeM', 'slrScen', 'slrYear', 'slrHist']) $(id).addEventListener('input', cmpdChanged);
/** Storm label suffix: the design tide, or the rise added to an observed one. */
function cmpdLabel(st) {
  const w = st?.wl; if (!w) return '';
  if (w.slr && !w.design) return `; observed level raised ${f2(w.slr.m)} m for sea-level rise ${w.slr.from}–${w.slr.year} (${w.slr.scenario})`;
  if (!w.design) return '';
  const g = w.design, how = { still: 'still water', cycle: `tide cycle, ${g.phase} water at the rain peak`, predicted: `NOAA prediction (${g.tideAt ?? g.date}), ${g.phase} water at the rain peak` }[g.mode];
  return `; design tide from NOAA CO-OPS ${w.station} (${w.name}): ${how}, MHHW ${f2(g.mhhw)} m ${w.datum} + ${g.surge} ${f2(g.surgeM)} m + SLR ${f2(g.slrM)} m (${g.slr.scenario === 'none' ? 'none' : `${g.slr.scenario} ${g.slr.year}`}), peak ${f2(Math.max(...w.v))} m on ${run?.stageCells ?? 0} open-water edge cells`;
}
/** The joint analysis: rain at the nearest long-record gauge (ACIS) with the tide gauge's daily highest water. */
$('cmpdJoint').onclick = async () => {
  const I = cmpd.info, gauge = cmpd.gauge; if (!I || !model) return;
  const btn = $('cmpdJoint'); btn.disabled = true; btn.textContent = 'Working…';
  try {
    const [lon, lat] = model.site, J = await CPD.fetchJoint(lon, lat, I, fetcher, { onProgress: (t) => { $('cmpdJointNote').textContent = t; } });
    if (cmpd.gauge !== gauge) return;
    cmpd.joint = J; cmpdJointShow();
    log(`Joint rain–surge: ${J.gauge.name} (${J.gauge.km.toFixed(0)} km, ${J.rainYears} years) with ${I.station}; τ ${J.samples.rain.tau.toFixed(2)} rain-driven, ${J.samples.wl.tau.toFixed(2)} surge-driven`, 'ok', 'ACIS, NOAA CO-OPS');
  } catch (e) { console.error(e); $('cmpdJointNote').textContent = 'Joint analysis unavailable: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = 'Joint rain–surge probability'; }
};
const rainUnit = () => (design.units === 'us' ? { u: 'in', f: (mm) => mm / 25.4, dp: 2 } : { u: 'mm', f: (mm) => mm, dp: 0 });
/** An annual-maximum return period as the nearest Atlas 14 (partial-duration) return period offered. */
function pairAri(T) {
  const pds = Math.max(1, -1 / Math.log(1 - 1 / Math.max(T, 1.0001))), opts = [...$('ari').options].map(o => Number(o.value));
  return { pds, ari: opts.reduce((a, b) => (Math.abs(Math.log(b / pds)) < Math.abs(Math.log(a / pds)) ? b : a)) };
}
function cmpdJointShow() {
  const J = cmpd.joint; if (!J) return;
  const s = J.samples, ru = rainUnit(), sig = (x) => (Math.abs(x.z) >= 1.96 ? 'significant at 5%' : 'not significant at 5%');
  $('cmpdJointNote').textContent = `${J.gauge.name}, ${J.gauge.km.toFixed(0)} km (ACIS daily rain, ${J.rainYears} complete years) with ${J.station} (${J.wlSource}). ` +
    `Rain-driven events: τ ${s.rain.tau.toFixed(2)} (n ${s.rain.n}, ${sig(s.rain)}); surge-driven: τ ${s.wl.tau.toFixed(2)} (n ${s.wl.n}, ${sig(s.wl)}). Gumbel copula; AND = both exceeded in a year.`;
  const rows = J.design.map((p, k) => { const a = pairAri(p.rainT); return `<tr><td>${cmpdEsc(p.label)}</td><td>${ru.f(p.rainMM).toFixed(ru.dp)} ${ru.u}/day (${p.rainT.toFixed(1)}-yr)</td><td>${f2(p.wlM)} m (${p.wlT.toFixed(1)}-yr)</td><td>${p.andT.toFixed(0)}-yr</td>` +
    `<td><button class="btn" data-k="${k}" title="Atlas 14 ${a.ari}-yr 24 h (the rain's ${p.rainT.toFixed(1)}-yr annual maximum is a ${a.pds.toFixed(1)}-yr partial-duration event) with a still design tide at MHHW + ${f2(p.wlM)} m">Use</button></td></tr>`; });
  $('cmpdPairs').innerHTML = `<table><tr><th>${J.designT}-yr design event</th><th>rain</th><th>high water above MHHW</th><th>AND</th><th></th></tr>${rows.join('')}</table>`;
}
$('cmpdPairs').onclick = (e) => { const b = e.target.closest('button[data-k]'); const p = b && cmpd.joint?.design[Number(b.dataset.k)]; if (p) cmpdUse(p); };
/** A design pair as the storm: Atlas 14 24 h at the rain's return period, a design tide at its water level. */
function cmpdUse(p) {
  const { ari, pds } = pairAri(p.rainT);
  if (stormSrc !== 'a14') setStormSource('a14');
  $('ari').value = String(ari); $('a14dur').value = '1440';
  if ($('dtMode').value === 'off') $('dtMode').value = 'still';
  $('dtSurge').value = 'custom'; $('dtSurgeM').value = p.wlM.toFixed(2);
  updateStorm();
  log(`Design pair “${p.label}”: Atlas 14 ${ari}-yr 24 h (the pair's ${p.rainMM.toFixed(0)} mm/day is a ${p.rainT.toFixed(1)}-yr annual maximum, ${pds.toFixed(1)}-yr partial duration) with high water ${f2(p.wlM)} m above MHHW, + ${slrName()}`, 'ok');
}
/** Batch: SLR variants (on a still MHHW tide when none is set) and the design pairs as storms. */
function cmpdVariants() {
  if (!cmpd.info?.slr) return [];
  const dt = $('dtMode').value === 'off' ? { dtMode: 'still' } : {};
  return [['slr-int-2050', 'Intermediate', 2050], ['slr-int-2100', 'Intermediate', 2100], ['slr-ih-2100', 'Intermediate-High', 2100], ['slr-high-2100', 'High', 2100]]
    .map(([key, scen, year]) => ({ key, label: `SLR ${scen} ${year} (+${f2(slrM(year, scen))} m)`, inputs: { slrScen: scen, slrYear: String(year), slrHist: true, ...dt } }));
}
function cmpdStorms() {
  return (cmpd.joint?.design ?? []).map(p => { const { ari } = pairAri(p.rainT);
    return { key: 'jp-' + p.key, label: `${p.label}: ${ari}-yr 24 h + ${f2(p.wlM)} m`, stormSrc: 'a14', inputs: { ari: String(ari), a14dur: '1440', dtMode: $('dtMode').value === 'off' ? 'still' : $('dtMode').value, dtSurge: 'custom', dtSurgeM: p.wlM.toFixed(2) } }; });
}
/** A run's water level for its record (the report's design-tide figure): the series over the run, s from the start. */
function tideRec(r) {
  const st = r.storm, w = st?.wl; if (!w) return null;
  const t0 = st.t0 ?? 0, a = t0 - 36e5, b = t0 + (tStop() + 3600) * 1000, pts = [];
  w.t.forEach((t, i) => { if (t >= a && t <= b) pts.push([(t - t0) / 1000, +w.v[i].toFixed(3)]); });
  return { station: w.station, name: w.name, datum: w.datum, kind: w.design ? 'design' : 'observed', design: w.design ?? null, slr: w.slr ?? null, mhhw: cmpd.info?.datums.mhhw ?? null,
    peak: pts.length ? Math.max(...pts.map(p => p[1])) : null, pts, edgeCells: r.stageCells ?? 0, rainPeakS: peakTime(st) };
}
/** For the report (app/report-compound.js). */
function cmpdReport() {
  const I = cmpd.info; if (!I) return null;
  return { station: I.station, name: cmpd.gauge?.name, datums: I.datums, slr: I.slr, ewl: I.ewl ? { levels: I.ewl.levels, trendMmYr: I.ewl.trendMmYr, years: I.ewl.annual.length } : null, joint: cmpd.joint, set: cmpdSettings() };
}
// end of compound flooding

// ------------------------------------------------------------------ storm
const fmtDur =(min) => min < 60 ? `${min} min` : `${+(min / 60).toFixed(2)} h`;
let stormSrc = 'a14';
function setStormSource(s) {
  stormSrc = s;
  for (const b of $('stormSrc').children) b.setAttribute('aria-pressed', b.dataset.s === s);
  $('a14Ctl').hidden = s !== 'a14'; $('constCtl').hidden = s !== 'const'; $('histCtl').hidden = s !== 'hist'; $('ncCtl').hidden = s !== 'radar';
  updateStorm();
}
/** The storm the next run will use (null before Atlas 14 is loaded). */
function currentStorm() {
  const st = stormBase();
  return withCoast(st && emu?.rain != null && emu.rain !== 1 ? scaleStorm(st, emu.rain) : st); // + the design tide / SLR (compound flooding)
}
function stormBase() {
  if (stormSrc === 'hist') return hist.storm;
  if (stormSrc === 'radar') return nc.storms[$('ncMember').value] ?? nc.storms.ctl ?? null;
  if (stormSrc === 'const') return constantStorm(Number($('rain').value), Number($('dur').value));
  if (!model?.atlas14) return hist.fit && hist.pattern ? recordStorm(hist.fit, hist.pattern, { ari: emu?.ari ?? Number($('ari').value), factor: 1 + Number($('uplift').value) / 100, years: hist.years }) : null;
  const [pattern, peak] = $('pattern').value.split(':');
  return hyetograph(model.atlas14, { ari: emu?.ari ?? Number($('ari').value), durationMin: Number($('a14dur').value), pattern, peak: Number(peak ?? 0.5), which: $('which').value, factor: 1 + Number($('uplift').value) / 100 });
}
function stormLabel(st) { return stormLabel0(st) + cmpdLabel(st); }
function stormLabel0(st) {
  if (!st) return 'none';
  if (st.pattern === 'constant') return `custom constant ${st.peakIntensity} mm/hr for ${fmtDur(st.durationMin)} (${st.total.toFixed(0)} mm)`;
  if (st.pattern === 'historic') return `historic: ${st.name}, ${st.total.toFixed(0)} mm over ${fmtDur(st.durationMin)} from ${new Date(st.t0).toISOString().slice(0, 16).replace('T', ' ')} UTC (${st.source}${st.radar ? '; the radar pattern varies the rain cell by cell, total is the area mean' : ''})` +
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
    waterLevel: st.wl ? { station: st.wl.station, name: st.wl.name, datum: st.wl.datum, tUTC: st.wl.t.map(t => new Date(t).toISOString()), m: st.wl.v,
      ...(st.wl.observedUntil ? { observedUntilUTC: new Date(st.wl.observedUntil).toISOString(), after: st.wl.surge != null ? { method: 'NOAA CO-OPS tide prediction + surge (mean observed − predicted over the last hour, held)', surgeM: st.wl.surge } : { method: 'last reading held' } } : {}) } : null,
    ...(st.radar ? { radar: { product: `NOAA MRMS ${st.radar.gauged ? st.radar.products + ' hourly' : 'RadarOnly_QPE_01H'}${st.radar.fit?.n ? `, fitted to ${st.radar.fit.n} USGS rain gauges (NWIS 00045, src/raingauge.js)` : ''}, timed by PrecipRate (2 min), IEM archive; per cell, bilinear from 0.01° pixels`, hash: st.radar.hash,
      ...(st.radar.fit ? { gaugeFit: st.radar.fit } : {}),
      areaMM: { used: st.radar.hoursMM, radarOnly: st.radar.radarMM },
      ...(st.radar.live ? { live: ncMeta(st.radar.live) } : {}),
      pixelWindow: { c0: st.radar.win.c0, c1: st.radar.win.c1, r0: st.radar.win.r0, r1: st.radar.win.r1 }, areaPixels: st.radar.pixels, siteGriddedMM: st.radar.siteMM, stats: st.radar.stats } } : {}) };
  const p = model.atlas14;
  return { source: 'NOAA Atlas 14 (PFDS, partial-duration series)', volume: p.volume, version: p.version, region: p.region, siteLonLat: [p.lon, p.lat],
    ari: st.ari, estimate: st.which, climateFactor: st.factor, peakPosition: st.pattern === 'block' ? st.peak : null, ...base };
}
function updateStorm() {
  const st = currentStorm();
  drawHyeto(); cmpdForm();
  if (radar.mode === 'storm' || radar.mode === 'model') radarLoad().catch(e => radarNote('Radar unavailable: ' + e.message));
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
function lockStorm(on) { for (const id of ['stormSrc', 'a14Ctl', 'constCtl', 'histCtl', 'ncCtl']) $(id).classList.toggle('locked', on); }
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
  $('histEvent').innerHTML = hist.catalog.map((e, i) => `<option value="${i}">${e.name ? e.name + ' · ' : ''}${md(e.peakDate)}${e.total != null ? ` · ${e.total.toFixed(0)} mm` : ` · passed ${e.cyclone.minKm.toFixed(0)} km`}</option>`).join('') +
    '<option value="date">Another date… (a short burst the daily record ranks low)</option>'; // the catalog is the wettest days: a 40 min cloudburst of 20 mm never makes it
  $('histDateRow').hidden = $('histEvent').value !== 'date';
  $('histSrc').querySelector('[value=blend]').disabled = $('histSrc').querySelector('[value=gauge]').disabled = !asos;
  if (!asos) $('histSrc').value = 'hourly';
  $('histSrc').querySelector('[value=hourly]').disabled = $('histSrc').querySelector('[value=blend]').disabled = !hist.gridded || $('histSrc').querySelector('[value=blend]').disabled;
  if (!hist.gridded) $('histSrc').value = 'gauge';
  $('histSrc').querySelector('[value=radar]').disabled = $('histSrc').querySelector('[value=radarRaw]').disabled = $('histSrc').querySelector('[value=radarFit]').disabled = !hist.gridded; // MRMS covers the lower 48 only, as the gridded record does
  $('histSrc').querySelector('[value=gauge]').textContent = asos ? `Airport gauge ${asos.id}, ${asos.km.toFixed(1)} km (5 min)` : 'Airport gauge (none within 30 km)';
  $('coastRow').hidden = $('ncCoastRow').hidden = !gauge; cmpdLoad(gauge);
  if (gauge) $('coastLabel').textContent = `Observed water level at ${gauge.name} (${gauge.km.toFixed(0)} km) on open-water edges`;
  if (gauge) $('ncCoastLabel').textContent = `Water level at ${gauge.name} (${gauge.km.toFixed(0)} km) on open-water edges: observed, then NOAA's tide prediction + the last hour's surge`;
  $('histNote').textContent = `${daily.length.toLocaleString()} days of rainfall since ${daily[0].date.slice(0, 4)} (${daily.source}), ${hist.catalog.filter(e => e.cyclone).length} hurricane tracks within 250 km (NOAA HURDAT2)` +
    (gauge ? `, tide gauge ${gauge.id} ${gauge.name} ${gauge.km.toFixed(0)} km away.` : '. No tide gauge within 60 km.');
  $('histLoad').disabled = false; $('ncLoad').disabled = !hist.gridded; // MRMS: the lower 48
  if (!nc.storms.ctl) $('ncNote').textContent = hist.gridded ? 'Loads the radar over the area to the latest frame, then the nowcast and its ensemble. About a minute the first time.' : 'NOAA MRMS radar covers the lower 48 only.';
}
$('histEvent').addEventListener('change', () => { $('histDateRow').hidden = $('histEvent').value !== 'date'; });
$('histLoad').onclick = async () => {
  const v = $('histEvent').value, day = $('histDate').value;
  if (v === 'date' && !day) { $('histNote').textContent = 'Pick the date of the storm.'; return; }
  const e = v === 'date' ? { name: `Storm of ${day}`, start: day + 'T00:00Z', end: day + 'T23:59Z', peakDate: day, total: null } : hist.catalog?.[Number(v)]; if (!e) return;
  const btn = $('histLoad'); btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const [lon, lat] = model.site, pad = 86400e3;
    const d0 = new Date(Date.parse(e.start) - pad).toISOString().slice(0, 10), d1 = new Date(Date.parse(e.end) + pad).toISOString().slice(0, 10);
    const src = hist.gridded ? $('histSrc').value : 'gauge';
    if (!hist.gridded && !hist.asos) throw new Error('no hourly rainfall here: no gridded record and no airport gauge with a 1-minute archive within 30 km');
    const hourly = hist.gridded ? await H.fetchHourly(lon, lat, d0, d1, fetcher) : { t0: Date.parse(d0 + 'T00:00Z'), stepMin: 60, mm: new Array(24 * (1 + (Date.parse(d1) - Date.parse(d0)) / 864e5)).fill(0) };
    let series = hourly, blockMin = 60;
    if (src !== 'hourly' && !src.startsWith('radar') && hist.asos) {
      const g = await H.fetchASOS1min(hist.asos.id, hourly.t0, hourly.t0 + hourly.mm.length * 3600e3, fetcher);
      series = src === 'gauge' ? g : H.blendSeries(hourly, g); blockMin = 5;
    }
    let st = src.startsWith('radar') ? await radarStorm(e, hourly, { gauge: src === 'radar', fit: src === 'radarFit' }) : H.seriesStorm(series, { blockMin, name: e.name ?? `Storm of ${e.peakDate}` });
    if (!st) st = { blockMin: 60, depth: [0], intensity: [0], total: 0, peakIntensity: 0, durationMin: 60, pattern: 'historic', name: e.name, source: series.source, t0: Date.parse(e.peakDate + 'T00:00Z') };
    if ($('tCoast').checked && hist.gauge) {
      const wl = await H.fetchWaterLevel(hist.gauge.id, Date.parse(d0 + 'T00:00Z'), Date.parse(d1 + 'T23:59Z'), fetcher);
      wl.name = hist.gauge.name;
      st = padForSurge(st, wl); st.wl = wl;
    }
    st.rp = stormRP(st);
    hist.storm = st; updateStorm(); if (model && !(run?.solver)) resetRun();
  } catch (err) { console.error(err); $('histNote').textContent = 'Could not load this event: ' + err.message; }
  finally { btn.disabled = false; btn.textContent = 'Load event'; }
};
/** Each window's maximum depth in a storm against Atlas 14 at the site. */
const stormRP = (st) => (model.atlas14 ? Object.fromEntries([5, 15, 60, 180, 360, 1440].map(m => [m, H.maxWindow(st, m)]).filter(([, d]) => d != null && d > 0)
  .map(([m, d]) => [m, { mm: d, ...H.returnPeriod(model.atlas14, m, d) }])) : null);
/** Extend a rain window with dry blocks so the run spans the surge peak (12 h before to 6 h after). */
function padForSurge(st, wl) {
  let pk = 0; wl.v.forEach((v, i) => { if (v > wl.v[pk]) pk = i; });
  const bs = st.blockMin * 60e3, a = Math.min(st.t0, wl.t[pk] - 12 * 3600e3), b = Math.max(st.t0 + st.depth.length * bs, wl.t[pk] + 6 * 3600e3);
  const pre = Math.max(0, Math.round((st.t0 - a) / bs)), total = Math.max(pre + st.depth.length, Math.round((b - st.t0) / bs) + pre);
  const pad = (arr, v) => [...new Array(pre).fill(v), ...arr, ...new Array(total - pre - st.depth.length).fill(v)];
  const depth = pad(st.depth, 0);
  const radar = st.radar && { ...st.radar, frames: pad(st.radar.frames, null), mean: Float64Array.from(pad(Array.from(st.radar.mean), 0)) };
  return { ...st, depth, intensity: depth.map(d => d * 60 / st.blockMin), durationMin: depth.length * st.blockMin, t0: st.t0 - pre * bs, ...(radar ? { radar } : {}) };
}
function histSummary(st) {
  const rp = st.rp ? Object.entries(st.rp).map(([m, r]) => `${fmtDur(Number(m))} ${r.mm.toFixed(0)} mm ${r.label}`).join(' · ') : '';
  const wl = st.wl ? ` Water level peaks at ${Math.max(...st.wl.v).toFixed(2)} m ${st.wl.datum} (${st.wl.name})` + (st.wl.observedUntil ? `; observed to ${new Date(st.wl.observedUntil).toISOString().slice(11, 16)} UTC, then ${st.wl.surge != null ? `NOAA's tide prediction ${st.wl.surge >= 0 ? '+' : '−'} ${Math.abs(st.wl.surge).toFixed(2)} m of surge (the last hour's difference, held)` : 'held at the last reading (no tide prediction here)'}.` : '.') : '';
  return `${st.name}: ${st.total.toFixed(0)} mm${st.radar ? ' (mean over the area)' : ''}, peak ${st.peakIntensity.toFixed(0)} mm/hr over ${st.blockMin} min. ${rp ? 'Against Atlas 14 at the site: ' + rp + '.' : ''}${wl} Source: ${st.source}.` +
    (st.radar ? ' ' + radarNoteText(st.radar) : '');
}

/**
 * A historic storm's rain from radar (src/mrms.js): NOAA MRMS radar-only, 1 km and 2 min over the model area, from the
 * IEM archive. Window: the site record's wettest stretch of the event, 2 h either side. The storm's hyetograph is the
 * area mean; `radar` keeps the frames, and the run spreads each one over the solver cells (radarRainField).
 */
/**
 * `gauge`: false keeps the radar's own hourly totals (a check on the gauge correction, which leans on distant gauges).
 * `fit`: the radar-only rain fitted to the USGS rain gauges in and near the area (src/raingauge.js); with none that
 * reported, the gauge-corrected radar, and the note says so.
 */
async function radarStorm(e, hourly, { gauge = true, fit = false } = {}) {
  const site = H.seriesStorm(hourly, { blockMin: 60 });
  const t0 = (site?.t0 ?? Date.parse(e.peakDate + 'T00:00Z')) - 2 * 3600e3, t1 = site ? site.t0 + site.durationMin * 60e3 + 2 * 3600e3 : t0 + 28 * 3600e3;
  const A = radarArea(fit ? RG.FIT.bufferKm : 0), note = $('histNote').textContent;
  try {
    let gauges = [];
    if (fit) { $('histNote').textContent = 'Radar: USGS rain gauges in and near the area…'; gauges = await RG.findRainGauges(A.bbox, t0, t1, fetcher).catch(() => []); }
    const rr = await MR.radarRain(t0, t1, A.bbox, radarBytes, { isWet: A.isWet, onProgress: radarProgress, gauge: fit ? !gauges.length : gauge });
    const F = gauges.length ? RG.fitRadar(rr.hours, rr.win, gauges, MR.sampleWeights) : null;
    if (F?.factors) RG.applyFit(rr, F.factors);
    const st = stormFromRadar(rr, A, { name: e.name ?? `Storm of ${e.peakDate}`, hourly });
    if (st && !gauge && !fit) st.radar.unadjusted = true;
    if (st && fit) { // the gauges nearest the area first, for the note and the record
      const mid = model.site, d = (g) => Math.hypot((g.lon - mid[0]) * Math.cos(mid[1] * Math.PI / 180), g.lat - mid[1]) * 111.32, r1 = (v) => (Number.isFinite(v) ? +v.toFixed(1) : null);
      st.radar.fit = { n: F?.n ?? 0, found: gauges.length, mode: F?.mode ?? null, d0Km: F?.d0Km ?? null, rmse: F?.rmse ?? null, candidates: F?.candidates ?? [], bufferKm: RG.FIT.bufferKm,
        gauges: (F?.gauges ?? []).map(g => ({ ...g, km: +d(g).toFixed(1), gaugeMM: r1(g.gaugeMM), radarMM: r1(g.radarMM), looMM: r1(g.looMM),
          peak: g.peak && { gaugeMM: r1(g.peak.gaugeMM), radarMM: r1(g.peak.radarMM), looMM: r1(g.peak.looMM) } })).sort((a, b) => a.km - b.km) };
    }
    return st;
  } finally { $('histNote').textContent = note; }
}
/** The model area for radar rain: its lon/lat box, sample points inside the polygon (≤ ~2500) and their pixel weights. */
function radarArea(growKm = 0) {
  const fine = model.fine, cs = fine.corners(), box = [Math.min(...cs.map(p => p[0])), Math.min(...cs.map(p => p[1])), Math.max(...cs.map(p => p[0])), Math.max(...cs.map(p => p[1]))];
  const bbox = growKm ? RG.growBox(box, growKm) : box; // grown: the window covers the rain gauges around the area too
  const win = MR.pixelWindow(bbox), ring = model.poly, stride = Math.max(1, Math.round(Math.sqrt(fine.nx * fine.ny / 2500))), samples = [];
  for (let j = stride >> 1; j < fine.ny; j += stride) for (let i = stride >> 1; i < fine.nx; i += stride) {
    const [lon, lat] = fromUTM(fine.x0 + (i + 0.5) * fine.dx, fine.y1 - (j + 0.5) * fine.dx, fine.zone);
    if (!ring || insideRing(lon, lat, ring)) samples.push(MR.sampleWeights(win, lon, lat));
  }
  const used = [...new Set(samples.flat().map(([k]) => k))];
  return { bbox, samples, used, isWet: (g) => used.some(k => g[k] > 0) };
}
const radarBytes = async (u) => { const r = await fetcher(u); if (r.status === 404) return null; if (!r.ok) throw new Error(`IEM radar archive ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
/** HRRR on AWS (src/hrrr.js): a file or one byte range [first, last] of it; null when the file is not there (S3 answers 403 or 404). */
const hrrrBytes = async (u, range) => { const r = await fetcher(u, range ? { range } : {}); if (r.status === 404 || r.status === 403) return null; if (!r.ok) throw new Error(`HRRR on AWS ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
const hrrrStamp = (c) => `${new Date(c).toISOString().slice(0, 13).replace('T', ' ')}z`;
const radarProgress = (i, n, what) => { $('histNote').textContent = `Radar: ${what} ${i} / ${n}…`; };
/**
 * A storm from radar frames (radarRain or liveRain): the area-mean hyetograph, and `radar` for the run to spread over
 * the cells. Leading dry frames are trimmed; trailing ones too, except live (the run should reach the nowcast's end;
 * and a live storm dry throughout is still made, all zeros, since ensemble members built on it may bring rain).
 */
function stormFromRadar(rr, A, { name, hourly = null, live = null }) {
  const { samples, used } = A;
  let mean = MR.areaMean(rr.frames, samples), a = 0, b = mean.length;
  while (a < b && !(mean[a] > 0)) a++;
  if (!live) while (b > a && !(mean[b - 1] > 0)) b--;
  if (a === b && (!live || !b)) return null;
  if (live && a >= mean.length - rr.stats.forecastFrames) a = Math.max(0, mean.length - rr.stats.forecastFrames - 15); // rain only in the nowcast: start half an hour before now
  const frames = rr.frames.slice(a, b); mean = mean.slice(a, b);
  const st0 = rr.t0 + a * rr.blockMin * 60e3, st1 = st0 + frames.length * rr.blockMin * 60e3;
  let siteMM = null; if (hourly) { siteMM = 0; hourly.mm.forEach((v, h) => { const t = hourly.t0 + h * 3600e3; if (t + 3600e3 > st0 && t < st1) siteMM += v; }); } // hours overlapping the radar window
  // area totals over the same whole hours: the radar's own (p1h) beside the totals used (gauge-corrected where there were some)
  const areaMM = (g) => (g ? samples.reduce((a, ws) => a + ws.reduce((b, [i, w]) => b + w * (g[i] || 0), 0), 0) / samples.length : 0);
  const hrs = rr.hours.filter(h => h.end > st0 && h.end - 3600e3 < st1), radarMM = hrs.reduce((a, h) => a + areaMM(h.radar), 0), hoursMM = hrs.reduce((a, h) => a + areaMM(h.total), 0);
  const depth = Array.from(mean), intensity = depth.map(d => d * 60 / rr.blockMin), gauged = rr.stats.gaugeHours > 0;
  const products = MR.GAUGE.filter(g => rr.stats.products.includes(g.prod)).map(g => g.label).join(' and ');
  const src = gauged ? `NOAA ${products}, hourly, timed by the 2-minute radar rain rate; 1 km, IEM archive` : 'NOAA MRMS radar-only (hourly RadarOnly_QPE_01H, timed by the 2-minute PrecipRate), 1 km, IEM archive';
  return { blockMin: rr.blockMin, depth, intensity, total: depth.reduce((x, y) => x + y, 0), peakIntensity: Math.max(...intensity), durationMin: depth.length * rr.blockMin,
    pattern: 'historic', name, t0: st0,
    source: live ? `${src}; then a nowcast: the last 10 minutes' radar rain moved along the storm's motion` +
      (live.qpf?.cycle != null ? `; from +${live.qpf.blend.from} min crossfaded to NOAA HRRR forecast rain (run ${hrrrStamp(live.qpf.cycle)}, 3 km, AWS), HRRR alone from +${live.qpf.blend.to} min` : '') : src,
    radar: { win: rr.win, frames, mean, hash: MR.framesHash(frames), stats: rr.stats, siteMM, radarMM, hoursMM, gauged, products, pixels: used.length,
      ...(live ? { live: { ...live, forecastFrom: Math.round((live.observedUntil - st0) / (rr.blockMin * 60e3)) } } : {}) } };
}
function radarNoteText(R) {
  const s = R.stats, fb = s.areaShape + s.uniform;
  const g = R.gauged ? `Hourly totals adjusted to rain gauges for ${s.gaugeHours} of ${s.hours} whole hours (${R.hoursMM.toFixed(0)} mm over the area in those hours; the radar alone gives ${R.radarMM.toFixed(0)} mm).` +
      (s.radarOnlyHours.length ? ` Radar-only, no gauge-corrected file: ${s.radarOnlyHours.join(', ')}.` : '') + (s.gaugeGaps ? ` ${s.gaugeGaps} wet pixel-hours in the radar window radar-only (no gauge-corrected value).` : '')
    : R.fit ? fitNoteText(R) : R.unadjusted ? 'Radar-only, as chosen: not adjusted to rain gauges.' : `Radar-only (gauge-corrected totals are archived from May 2015): not adjusted to rain gauges.`;
  const L = R.live, M = L?.motion, fc = L ? R.mean.slice(L.forecastFrom).reduce((x, y) => x + y, 0) : 0;
  const lv = !L ? '' : ` Observed to ${new Date(L.observedUntil).toISOString().slice(11, 16)} UTC; ` + (L.leadMin ? `then ${L.leadMin} min of nowcast (${fc.toFixed(1)} mm over the area), ` +
    (M ? `storm motion ${M.kmh.toFixed(0)} km/h toward ${M.toward.toFixed(0)}° (match r = ${M.score.toFixed(2)}${M.score < 0.6 ? ', poor: treat the nowcast as rough' : ''}).` : 'no motion found (too little rain near the area): the latest rain held in place.') +
    (L.member && L.member.key !== 'ctl' ? ` This run takes the ${NC_PICK[L.member.key] ?? L.member.key} member: speed × ${L.member.speed.toFixed(2)}, turned ${L.member.dir >= 0 ? '+' : '−'}${Math.abs(L.member.dir).toFixed(0)}°, intensity × ${NC.growthFactor(L.member.growth, 60).toFixed(2)} an hour on.` : '') +
    (L.qpf?.cycle != null ? ` Past ${L.qpf.blend.from} min it fades into NOAA HRRR's forecast rain (run ${hrrrStamp(L.qpf.cycle)}), HRRR alone from ${L.qpf.blend.to} min: lower skill still.` : L.qpf?.error ? ` HRRR unavailable (${L.qpf.error}): the nowcast alone to the end.` : '') +
    ' A nowcast is screening only: storms grow, decay and turn, and skill falls off within the hour.' : 'no nowcast.');
  return `Rain over ${R.pixels} pixels of 1 km.${lv} ${g}${R.siteMM != null ? ` Site gridded record over the same hours: ${R.siteMM.toFixed(0)} mm.` : ''}` +
    (fb ? ` ${fb} of ${s.wetPixelHours} wet pixel-hours timed by the area's shape or evenly (2-minute frames missing or overflowed).` : '') +
    (s.missingHours.length ? ` Missing hours (no rain assumed): ${s.missingHours.join(', ')}.` : '') + (s.noCoverage ? ` ${s.noCoverage} pixel-hours without radar coverage.` : '');
}

/** The rain-gauge fit in words (radarStorm with `fit`). */
function fitNoteText(R) {
  const f = R.fit, used = f.gauges.filter(g => g.used);
  if (!f.found) return `No USGS rain gauges reported within ${f.bufferKm} km of the area: the gauge-corrected radar is used instead.`;
  if (!f.n) return `${f.found} USGS rain gauge${f.found > 1 ? 's' : ''} within ${f.bufferKm} km, none usable (${f.gauges.map(g => g.why).filter(Boolean)[0] ?? 'too little rain'}): the radar-only rain is used as it is.`;
  const g0 = used[0], nm = (g) => g.name.replace(/ RAIN ?GAGE AT /i, ' at ').replace(/,.*$/, '').slice(0, 40);
  const near = g0 ? ` Nearest, ${nm(g0)} (${g0.km} km): ${g0.gaugeMM.toFixed(0)} mm, wettest hour ${g0.peak.gaugeMM.toFixed(0)} mm, where the radar had ${g0.radarMM.toFixed(0)} and ${g0.peak.radarMM.toFixed(0)} mm` +
    (f.mode ? ` and the fit made from the other gauges ${g0.looMM.toFixed(0)} and ${g0.peak.looMM.toFixed(0)} mm.` : '.') : '';
  const out = f.found > f.n ? ` ${f.found - f.n} other gauge${f.found - f.n > 1 ? 's' : ''} not used (short record or dry).` : '';
  if (!f.mode) return `${f.n} USGS rain gauges within ${f.bufferKm} km, but no fit predicts a left-out gauge better than the radar alone (${f.rmse.radar.toFixed(1)} mm RMS per gauge-hour): the radar-only rain is used as it is; the gauges are too far apart for this storm's cells.${near}${out}`;
  return `Radar-only rain fitted to ${f.n} USGS rain gauges within ${f.bufferKm} km, ${f.mode === 'hourly' ? 'hour by hour' : 'on storm totals'} (d0 ${f.d0Km} km, chosen by leave-one-out): ` +
    `${R.hoursMM.toFixed(0)} mm over the area against ${R.radarMM.toFixed(0)} mm from the radar alone. Each gauge predicted from the others: ${f.rmse.fitted.toFixed(1)} mm RMS per gauge-hour against ${f.rmse.radar.toFixed(1)} mm for the radar alone.${near}${out}`;
}
// ------------------------------------------------------------------ radar and nowcast (src/nowcast.js)
// The storm coming in: MRMS radar over the area to the latest 2-minute frame, then the nowcast and its ensemble
// (members that move the same rain faster or slower, turned, growing or decaying). The panel gives the arrival, the
// depth and the peak over the area as a band, and a loop of the incoming rain with the motion; the run takes one
// member (persistence, or the dry / middle / wet one; Batch lists all four). While a run of a live nowcast plays,
// newer frames replace the nowcast blocks it has not reached (rollLive), or the run waits for them (ncHold).
// An earlier issue time replays the nowcast as it was then, from the archive, and checks it against the rain that fell.
const nc = { rr: null, A: null, src: null, qpf: null, pinCycle: null, members: [], runs: [], sum: null, storms: {}, replay: false, play: 0, k: 0, off: null };
const NC_PICK = { ctl: 'persistence', p10: 'dry case, P10', p50: 'middle case, P50', p90: 'wet case, P90' };
const NC_SPREAD = { speedSd: 0.2, dirSd: 15, growthSd: 0.5 };
const localInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 16); // for a datetime-local field
const compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
const ncProgress = (i, n, what) => { $('ncNote').textContent = `Radar: ${what} ${i} / ${n}…`; };
/** The motion source behind a storm's nowcast (the latest one after rolling), when the storm is this panel's. */
const ncSrc = (st) => (nc.rr && st?.radar?.live && st.radar.win === nc.rr.win ? nc.src : null);
/** A member's nowcast rain `lead` minutes after the source's latest frame, on window w, in mm/hr; past 60 min blended into HRRR. → { f, w (HRRR's weight) } */
function ncFrameOn(src, w, lead, m = NC.CONTROL) {
  const [u, v] = NC.turn(src.u, src.v, src.lat, m.speed, m.dir), f = NC.advect(src.rate, src.big, w, u, v, lead + 1 + 5), g = NC.growthFactor(m.growth, lead + 1);
  for (let p = 0; p < f.length; p++) f[p] *= g;
  const b = NC.blendFrame(f, nc.qpf, w, src.latest, lead);
  for (let p = 0; p < b.f.length; p++) b.f[p] *= 30;
  return b;
}
/** The control storm with its nowcast blocks from a member's frames. */
function memberStorm(st, frames, m, pick) {
  const R = st.radar, from = R.live.forecastFrom, all = [...R.frames.slice(0, from), ...frames], mean = MR.areaMean(all, nc.A.samples);
  const depth = Array.from(mean), intensity = depth.map(d => d * 60 / st.blockMin);
  return { ...st, depth, intensity, total: depth.reduce((x, y) => x + y, 0), peakIntensity: Math.max(0, ...intensity), name: pick === 'ctl' ? st.name : `${st.name}, ${NC_PICK[pick]}`,
    radar: { ...R, frames: all, mean, hash: MR.framesHash(all), live: { ...R.live, member: { key: pick, id: m.key, speed: m.speed, dir: m.dir, growth: m.growth } } } };
}
/** The run record's account of a nowcast (stormMeta). */
function ncMeta(L) {
  const E = L.ensemble, m = L.member, fin = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number.isFinite(v) ? v : null])); // null: later than the lead
  const Q = L.qpf;
  return { observedUntilUTC: new Date(L.observedUntil).toISOString(), nowcastMin: L.leadMin, motion: L.motion, replay: !!L.replay,
    qpf: Q ? (Q.cycle != null ? { source: 'NOAA HRRR (noaa-hrrr-bdp-pds on AWS), APCP: 15-minute where the sub-hourly file has it, else hourly; bilinear from the 3 km Lambert grid to 0.01° pixels',
      cycleUTC: new Date(Q.cycle).toISOString(), forecastHours: Q.kinds, fields: Q.pieces, bytes: Q.bytes, blendMin: Q.blend,
      method: `nowcast to +${Q.blend.from} min, (1 − w)·nowcast + w·HRRR with w rising linearly to 1 at +${Q.blend.to} min, HRRR alone after; one HRRR run shared by every member`, skill: 'lower than the nowcast in its first hour' } : { error: Q.error }) : null,
    method: 'Lagrangian persistence: the last 10 min mean rate moved at the velocity matched between 10-min totals 20 min apart' +
      (m && m.id !== 'ctl' ? `; this member: speed × ${m.speed.toFixed(3)}, direction ${m.dir >= 0 ? '+' : ''}${m.dir.toFixed(1)}°, intensity growth ${m.growth.toFixed(3)} ln per hour` : ''),
    member: m ? { pick: m.key, member: m.id, speedFactor: m.speed, turnDeg: m.dir, growthPerHour: m.growth } : null,
    ensemble: E ? { members: E.n, spreads: NC_SPREAD, depthMM: E.depthMM, etaMin: fin(E.etaMin), peakMMHR: E.peakMMHR, arriving: E.arriving } : null,
    verify: L.verify ? { depthMM: L.verify.depthMM, etaMin: L.verify.etaMin, frames: L.verify.frames, missing: L.verify.missing } : null, rolls: L.rolls ?? [] };
}
/** Batch: the nowcast's persistence, dry, middle and wet members as storms. */
const ncStorms = () => (nc.storms.ctl ? Object.keys(nc.storms).map(k => ({ key: 'nc-' + k, label: `Nowcast ${k === 'ctl' ? 'persistence' : NC_PICK[k]}`, stormSrc: 'radar', inputs: { ncMember: k } })) : []);
/** A replay: the rain that fell over the area in the nowcast's lead, from the 2-minute frames. */
async function ncVerify(st) {
  const L = st.radar.live, n = L.leadMin / st.blockMin, ts = [];
  for (let i = 1; i <= n; i++) { const t = L.observedUntil + i * st.blockMin * 60e3; if (t <= Date.now() - 8 * 60e3) ts.push(t); }
  let done = 0;
  const mean = await Promise.all(ts.map(t => MR.frameAt(t, st.radar.win, radarBytes).catch(() => null).then(g => { ncProgress(++done, ts.length, 'the rain that fell after'); return g ? MR.areaMean([g.map(v => (Number.isNaN(v) ? 0 : v))], nc.A.samples)[0] : null; })));
  const I = NC.incoming([...Array.from(st.radar.mean.slice(0, L.forecastFrom)), ...mean.map(v => v ?? 0)], L.forecastFrom, st.blockMin);
  return { mean, depthMM: I.depthMM, etaMin: I.etaMin, peakMMHR: I.peakMMHR, frames: mean.length, missing: mean.filter(v => v == null).length };
}
async function ncLoad() {
  const btn = $('ncLoad'); btn.disabled = true; btn.textContent = 'Loading…'; ncStop();
  try {
    const obs = Number($('ncObs').value), lead = Number($('ncLead').value), nEns = lead ? Number($('ncEns').value) : 0;
    const typed = $('ncIssue').value, issue = typed ? new Date(typed).getTime() : Date.now();
    if (!Number.isFinite(issue) || issue > Date.now() + 60e3) throw new Error('the issue time is in the future: leave it blank for now');
    if (issue < MR.FROM + 7 * 3600e3) throw new Error('the MRMS archive at IEM starts in September 2013');
    const replay = !!typed && Date.now() - issue > 10 * 60e3, A = radarArea();
    const pin = nc.pinCycle; nc.pinCycle = null; // a reopened project: the HRRR run it used
    const rr = await NC.liveRain(issue, A.bbox, radarBytes, { obsHours: obs, leadMin: lead, isWet: A.isWet, onProgress: ncProgress, qpf: { getBytes: hrrrBytes, replay, cycle: pin } });
    const stamp = new Date(rr.live.observedUntil).toISOString().slice(0, 16).replace('T', ' ');
    const st = stormFromRadar(rr, A, { name: `${replay ? 'Nowcast replay' : 'Live radar'} to ${stamp} UTC${lead ? ` + ${lead} min ${rr.qpf ? 'nowcast & HRRR' : 'nowcast'}` : ''}`, live: { ...rr.live, replay } });
    if (rr.live.qpf?.error) log('HRRR forecast rain unavailable: ' + rr.live.qpf.error, 'warn', `the nowcast alone runs to +${lead} min`);
    if (!st) throw new Error('no radar frames over the area');
    Object.assign(nc, { rr, A, src: rr.src, qpf: rr.qpf, replay, members: nEns ? NC.ensembleMembers(nEns) : [NC.CONTROL], storms: {}, k: 0 });
    // the members: the same observed blocks, each its own nowcast; their area means give the band
    ncProgress(0, 1, `${nc.members.length} nowcast members`);
    const from = st.radar.live.forecastFrom, frames = nc.members.map((m, i) => (i === 0 ? st.radar.frames.slice(from) : NC.forecastFrames(rr.src, rr.win, lead, m, rr.qpf)));
    nc.runs = nc.members.map((m, i) => ({ key: m.key, mean: MR.areaMean([...st.radar.frames.slice(0, from), ...frames[i]], A.samples) }));
    nc.sum = lead ? NC.ensembleSummary(nc.runs, from, st.blockMin) : null;
    if (!(st.total > 0) && !(nc.sum?.depth.max > 0)) { nc.storms = {}; ncShow(); $('ncNote').textContent = `No rain over the area in the last ${obs} h${lead ? ` or the next ${lead} min in any member` : ''} (NOAA MRMS, observed to ${stamp} UTC).`; updateStorm(); return; }
    const ens = nc.sum && nc.members.length > 1 ? { n: nc.sum.n, depthMM: nc.sum.depth, etaMin: nc.sum.eta, peakMMHR: nc.sum.peak, arriving: nc.sum.arriving, band: nc.sum.band } : null;
    for (const [pick, key] of Object.entries({ ctl: 'ctl', ...(ens ? nc.sum.pick : {}) })) {
      const i = nc.members.findIndex(m => m.key === key);
      nc.storms[pick] = memberStorm(st, frames[i], nc.members[i], pick); nc.storms[pick].radar.live.ensemble = ens;
    }
    for (const o of $('ncMember').options) o.disabled = o.value !== 'ctl' && !ens;
    if (!nc.storms[$('ncMember').value]) $('ncMember').value = 'ctl';
    if ($('ncCoast').checked && hist.gauge) { // observed to the issue time, then the tide prediction plus the last hour's surge
      const end = st.t0 + st.durationMin * 60e3 + (Number($('tail').value) + 60) * 60e3;
      const wl = await H.fetchLiveWaterLevel(hist.gauge.id, st.t0 - 36e5, replay ? rr.live.observedUntil : Date.now(), end, fetcher).catch(e => { log('Water level for the nowcast unavailable: ' + e.message, 'warn'); return null; });
      if (wl) { wl.name = hist.gauge.name; for (const s of Object.values(nc.storms)) s.wl = wl; }
    }
    if (replay && lead) { const v = await ncVerify(nc.storms.ctl); for (const s of Object.values(nc.storms)) s.radar.live.verify = v; }
    for (const s of Object.values(nc.storms)) s.rp = stormRP(s);
    ncShow(); updateStorm(); if (model && !(run?.solver)) resetRun();
  } catch (err) { console.error(err); $('ncNote').textContent = 'Could not load the radar: ' + err.message; }
  finally { btn.disabled = !hist.gridded; btn.textContent = 'Load radar & nowcast'; }
}
/** The panel: arrival, depth, peak and motion over the area (P50 with the members' P10–P90), the limits, the loop. */
function ncShow() {
  const st = nc.storms.ctl; $('ncOut').hidden = !st; if (!st) { $('ncCards').innerHTML = ''; return; }
  const L = st.radar.live, S = L.ensemble, M = L.motion, Q = L.qpf, lead = L.leadMin, I0 = NC.incoming(nc.runs[0].mean, L.forecastFrom, st.blockMin);
  const clock = (min) => new Date(L.observedUntil + min * 60e3).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const card = (k, v, b, warn = false) => `<div class="nc-card${warn ? ' warn' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="b">${b}</div></div>`;
  const eta = (m) => (Number.isFinite(m) ? `${Math.round(m)} min` : `> ${lead}`), mm = (v) => v.toFixed(v < 10 ? 1 : 0), band = (o, f) => (S ? `P10–P90 ${f(o.p10)}–${f(o.p90)}` : 'one member: no band');
  const e50 = S ? S.etaMin.p50 : I0.etaMin ?? Infinity, skill = !M ? 'none' : M.score >= 0.8 ? 'good' : M.score >= 0.6 ? 'fair' : 'poor';
  const obsMM = st.radar.mean.slice(0, L.forecastFrom).reduce((a, b) => a + b, 0);
  $('ncCards').innerHTML = !lead ? card('Observed', `${mm(obsMM)} mm`, `over the area to ${clock(0)}`) + card('Nowcast', 'none', 'pick a lead to see what is coming') :
    (I0.rainingNow ? card('Arrival', 'Raining now', `observed to ${clock(0)}${S ? ` · ${Math.round(S.arriving * 100)} % of members keep it wet` : ''}`)
      : card('Arrival', Number.isFinite(e50) ? `in ${Math.round(e50)} min` : `not in ${lead} min`, `${Number.isFinite(e50) ? `≈ ${clock(e50)} · ` : ''}${S ? `${band(S.etaMin, eta)} · ${Math.round(S.arriving * 100)} % of members` : 'one member'}`)) +
    card(`Next ${lead} min`, `${mm(S ? S.depthMM.p50 : I0.depthMM)} mm`, `${band(S?.depthMM, mm)} mm, over the area`) +
    card('Peak rate', `${Math.round(S ? S.peakMMHR.p50 : I0.peakMMHR)} mm/hr`, `${band(S?.peakMMHR, v => Math.round(v))} mm/hr, 2-min area mean`) +
    card('Storm motion', M ? `${M.kmh.toFixed(0)} km/h ${compass(M.toward)}` : 'none found', M ? `toward ${M.toward.toFixed(0)}° · match r = ${M.score.toFixed(2)} (${skill})` : 'too little rain to track: held in place', skill === 'poor' || skill === 'none') +
    (Q?.cycle != null ? card(`HRRR, +${Q.blend.to}–${lead} min`, `${mm(nc.runs[0].mean.slice(L.forecastFrom + Q.blend.to / st.blockMin).reduce((a, b) => a + b, 0))} mm`, `NOAA HRRR run ${hrrrStamp(Q.cycle)} · lower skill · one run for every member`, true)
      : Q?.error ? card('HRRR', 'unavailable', `the nowcast alone to +${lead} min: ${Q.error}`, true) : '');
  const V = L.verify, inBand = V && S && V.depthMM >= S.depthMM.p10 && V.depthMM <= S.depthMM.p90;
  $('ncNote').textContent = `${nc.replay ? 'Replay: the nowcast as issued from the latest frame then. ' : ''}Observed to ${clock(0)} (${new Date(L.observedUntil).toISOString().slice(11, 16)} UTC): ${mm(obsMM)} mm over the area in the observed window` +
    (lead ? `; then ${lead} min of nowcast${S ? `, persistence and ${S.n - 1} members (speed × e^N(0, ${NC_SPREAD.speedSd}), direction ± N(0, ${NC_SPREAD.dirSd}°), growth N(0, ${NC_SPREAD.growthSd}) ln/h)` : ''}.` : '; no nowcast.') +
    (V ? ` What fell (radar, ${V.frames - V.missing} of ${lead / st.blockMin} frames): ${mm(V.depthMM)} mm in the lead, ${V.etaMin == null ? 'no arrival' : V.etaMin ? `arriving at +${V.etaMin} min` : 'raining from the start'}${S ? ` — ${inBand ? 'inside the members’ P10–P90' : V.depthMM < S.depthMM.p10 ? 'drier than their P10' : 'wetter than their P90'}` : ''}. The blue line on the chart is what fell.` : '');
  $('ncLimits').textContent = 'Screening, not a forecast. A nowcast moves the rain on the radar now: it cannot start new storms, and the members’ growth and decay only stand in for what it cannot see. ' +
    `Skill falls off after 30–60 minutes${lead > 60 && Q?.cycle == null ? `: read the last ${lead - 60} minutes here as a rough guide` : ''}. ` +
    (Q?.cycle != null ? `Past ${Q.blend.from} minutes the nowcast fades into NOAA HRRR’s forecast rain (run ${hrrrStamp(Q.cycle)}), and from ${Q.blend.to} minutes it is HRRR alone: a 3 km weather model that can start new storms but, for summer downpours, often places them tens of kilometres and an hour or more off, so its rain over an area this size is lower skill still. Every member shares that one run, so the band past ${Q.blend.to} minutes is narrower than the real uncertainty. ` : '') +
    (M ? `Motion matched at r = ${M.score.toFixed(2)}${M.score < 0.6 ? ': poor, the storm is changing shape or there is little rain to track; treat the nowcast as rough' : ''}. ` : 'No motion could be matched, so the rain is held in place. ') +
    'For warnings, follow the National Weather Service.';
  $('ncT').max = Math.max(0, lead / st.blockMin - 1); $('ncT').value = nc.k = 0; $('ncPlay').disabled = $('ncT').disabled = !lead;
  ncRollText(); ncDraw(0);
}
function ncRollText() {
  const v = $('ncRoll').value, rolls = nc.storms.ctl?.radar.live.rolls;
  $('ncRollNote').textContent = nc.storms.ctl?.radar.live.replay ? 'A replay runs the nowcast as it was issued: no new radar goes in.' :
    (v === 'roll' ? 'Every 2 minutes while the run plays, newer radar replaces the nowcast blocks the run has not reached, and the rest is nowcast again from the newest frame. A fast run gets ahead of the radar and keeps the nowcast; at about 1× (or a large model) it stays behind.'
      : v === 'hold' ? 'The run goes no further than the latest radar frame and waits for the next: a model of what has fallen, about 6 minutes behind real time, to the nowcast’s end.'
        : 'The run uses the nowcast as loaded (repeatable).') + (rolls?.length ? ` Rolled ${rolls.length} time${rolls.length > 1 ? 's' : ''}: observed to ${rolls.at(-1).observedUntilUTC.slice(11, 16)} UTC.` : '');
}
/** The loop: the selected member's nowcast frame k round the model, the area outline and the motion over 30 min. */
function ncDraw(k) {
  const st = nc.storms[$('ncMember').value] ?? nc.storms.ctl, cv = $('ncCanvas'); if (!st || !nc.src) return;
  const L = st.radar.live, w = st.radar.win, src = nc.src, h = 65, cc = Math.round((w.c0 + w.c1) / 2), rc = Math.round((w.r0 + w.r1) / 2);
  const crop = { lon0: MR.GRID.lon0 + (cc - h) * MR.GRID.step, lat0: MR.GRID.lat0 - (rc - h) * MR.GRID.step, step: MR.GRID.step, nx: 2 * h, ny: 2 * h };
  const lead = 2 * k, fb = L.leadMin ? ncFrameOn(src, crop, lead, L.member) : { f: new Float32Array(crop.nx * crop.ny), w: 0 }, f = fb.f;
  const off = nc.off ??= document.createElement('canvas'); off.width = crop.nx; off.height = crop.ny;
  const img = new ImageData(crop.nx, crop.ny), D = img.data;
  for (let p = 0; p < f.length; p++) if (f[p] >= 0.25) { D.set(rainRGBA(f[p]), 4 * p); D[4 * p + 3] = 230; }
  off.getContext('2d').putImageData(img, 0, 0);
  const g = cv.getContext('2d'), S = cv.width / crop.nx, X = (lon) => (lon - crop.lon0) / crop.step * S, Y = (lat) => (crop.lat0 - lat) / crop.step * S;
  g.clearRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, cv.width, cv.height);
  const ink = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#1a1416';
  g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.arc(h * S, h * S, 9, 0, 2 * Math.PI); g.stroke(); // a ring round the model area (about a pixel across), and its outline
  g.beginPath();
  const ring = model?.poly ?? (() => { const [a, b, c, d] = nc.A.bbox; return [[a, b], [c, b], [c, d], [a, d]]; })();
  ring.forEach(([lon, lat], i) => (i ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat)))); g.closePath(); g.stroke();
  const [u, v] = NC.turn(src.u, src.v, src.lat, L.member?.speed ?? 1, L.member?.dir ?? 0), x1 = h * S, y1 = h * S, x0 = x1 - u * 30 * S, y0 = y1 - v * 30 * S;
  if (Math.hypot(u, v) > 1e-3) { // where the rain reaching the area in 30 minutes is now, to the area
    const a = Math.atan2(y1 - y0, x1 - x0); g.strokeStyle = g.fillStyle = ink; g.lineWidth = 2; g.setLineDash([5, 3]);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)); g.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); g.closePath(); g.fill();
    g.beginPath(); g.arc(x0, y0, 3, 0, 2 * Math.PI); g.fill();
  }
  const km10 = 10 / (111.32 * Math.cos(src.lat * Math.PI / 180) * crop.step) * S; // a 10 km bar
  g.fillStyle = ink; g.fillRect(8, cv.height - 10, km10, 3); g.font = '10px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'); g.fillText('10 km', 8, cv.height - 17);
  const t = src.latest + lead * 60e3, mean = st.intensity[L.forecastFrom + k] ?? 0;
  $('ncLoopCap').textContent = L.leadMin ? `+${lead} min · ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${mean.toFixed(1)} mm/hr over the area · ${NC_PICK[L.member?.key ?? 'ctl']}` +
    (fb.w > 0 ? ` · ${fb.w >= 1 ? 'HRRR forecast' : `${Math.round(fb.w * 100)} % HRRR`} (lower skill)` : '') + (Math.hypot(u, v) > 1e-3 ? ' · dashed: 30 min of motion' : '') : 'No nowcast: pick a lead.';
}
function ncStop() { clearInterval(nc.play); nc.play = 0; $('ncPlay').textContent = '▶'; }
$('ncLoad').onclick = ncLoad;
$('ncMember').addEventListener('input', () => { updateStorm(); ncDraw(nc.k); });
$('ncRoll').addEventListener('input', ncRollText);
$('ncT').oninput = () => { ncStop(); nc.k = Number($('ncT').value); ncDraw(nc.k); };
$('ncPlay').onclick = () => {
  if (nc.play) { ncStop(); return; }
  $('ncPlay').textContent = '❚❚';
  nc.play = setInterval(() => { nc.k = (nc.k + 1) % (Number($('ncT').max) + 1); $('ncT').value = nc.k; ncDraw(nc.k); }, 300);
};
$('ncMap').onclick = () => { $('radarMode').value = 'model'; $('radarMode').dispatchEvent(new Event('change')); if (nc.A) map.fitBounds([[nc.A.bbox[0] - 0.4, nc.A.bbox[1] - 0.4], [nc.A.bbox[2] + 0.4, nc.A.bbox[3] + 0.4]], { padding: 20 }); };
$('histToNc').onclick = (e) => { e.preventDefault(); setStormSource('radar'); };
$('ncNow').onclick = () => { $('ncIssue').value = ''; };
/** Live: the run waits for the radar (a live nowcast, not a replay or a batch job, with "Wait for the radar"). */
const ncHold = (r) => !!r?.storm?.radar?.live && !r.storm.radar.live.replay && !r.batchJob && $('ncRoll').value === 'hold' && ncSrc(r.storm) != null;
/**
 * Live: newer radar frames into the run's storm, every 2 minutes while it plays (src/nowcast.js rollForward): they
 * replace the nowcast blocks after the one under way, and the rest is nowcast again from the newest frame, for the
 * run's own member. Not for a replay or a batch job (those stay repeatable).
 */
async function rollLive(r) {
  const st = r?.storm, L = st?.radar?.live;
  if (!r.playing || !L || L.replay || r.batchJob || $('ncRoll').value === 'off' || r.rolling || !ncSrc(st) || !r.solver) return;
  r.rolling = true;
  try {
    const nf = await NC.newFrames(L.observedUntil, Date.now(), st.radar.win, radarBytes); if (!nf || run !== r) return;
    const src = await NC.motionSource(nf.latest, nc.A.bbox, radarBytes); if (run !== r) return;
    const kf = Math.round((nf.latest - st.t0) / (st.blockMin * 60e3)), fresh = NC.forecastFrames(src, st.radar.win, Math.max(0, st.radar.frames.length - kf) * st.blockMin, L.member ?? NC.CONTROL, nc.qpf);
    const res = NC.rollForward(st, nf.frames, fresh, Math.floor(r.solver.t / (st.blockMin * 60) + 1e-9) + 1, (f) => MR.areaMean([f], nc.A.samples)[0]);
    nc.src = src; L.motion = src.motion; st.radar.hash = MR.framesHash(st.radar.frames);
    (L.rolls ??= []).push({ atUTC: new Date().toISOString(), observedUntilUTC: new Date(nf.latest).toISOString(), ...res });
    rain.cache.clear(); hy = null; drawHyeto(); if (radar.mode === 'model') rainLoad();
    ncRollText();
    log(`Radar to ${new Date(nf.latest).toISOString().slice(11, 16)} UTC: ${res.replaced} nowcast block${res.replaced === 1 ? '' : 's'} now observed, ${res.refreshed} nowcast again`, 'ok',
      res.late ? `${res.late} the run had already rained stay nowcast: slow the run (speed 1×) or pick “Wait for the radar” to use observed rain throughout` : '');
  } catch (e) { log('Radar roll-forward failed: ' + e.message, 'warn'); }
  finally { r.rolling = false; }
}
setInterval(() => { if (run?.playing) rollLive(run); }, 60e3);

/** The rain multiplier a run starts with: roof routing (and its green-roof / cistern stages). */
const rainBase0 = (r, c) => (r.roofStages ? r.roofStages[0].rainField : r.roofEarly ? r.roofEarly.rainField : c.rainField);
/** A new roof-routing field mid-run (a roof store filled); with radar rain, the radar pattern goes over it. */
function setRainBase(r, s, field) {
  r.rainBase = field;
  if (r.storm?.radar) { r.radarK = -1; radarRainField(r, s); } else s.setRainField(field);
}
/** Per solver cell, its interpolation weights in the radar window (4 per cell; Float32 weights, Int32 pixel). */
function radarWeights(win, c) {
  const fine = model.fine, cs = fine.dx * fine.nx / c.nx, N = c.nx * c.ny, idx = new Int32Array(4 * N), w = new Float32Array(4 * N);
  for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) {
    const k = j * c.nx + i, [lon, lat] = fromUTM(fine.x0 + (i + 0.5) * cs, fine.y1 - (j + 0.5) * cs, fine.zone);
    MR.sampleWeights(win, lon, lat).forEach(([p, v], m) => { idx[4 * k + m] = p; w[4 * k + m] = v; });
  }
  return { idx, w };
}
/**
 * At each radar block: the solver's rain multiplier becomes roof routing × the radar depth at the cell ÷ the area mean,
 * so s.rainRate (the area mean, scaled by the emulator's rain factor if any) × the multiplier is the radar's own rate
 * at each cell. setRainField re-totals the rain area, so the mass books stay exact.
 */
function radarRainField(r, s) {
  const R = r.storm.radar, k = Math.floor(s.t / (r.storm.blockMin * 60) + 1e-9);
  if (k === r.radarK) return; r.radarK = k;
  const c = r.c, N = c.nx * c.ny, base = r.rainBase, f = R.frames[k], m = R.mean[k];
  if (!f || !(m > 0)) { s.setRainField(base ?? new Float32Array(N).fill(1)); if (r.coupler) r.coupler.roofRain = null; return; }
  const W = r.radarW ??= radarWeights(R.win, c), field = new Float32Array(N);
  for (let q = 0; q < N; q++) {
    const o = 4 * q, v = W.w[o] * f[W.idx[o]] + W.w[o + 1] * f[W.idx[o + 1]] + W.w[o + 2] * f[W.idx[o + 2]] + W.w[o + 3] * f[W.idx[o + 3]];
    field[q] = (base ? base[q] : 1) * v / m;
  }
  s.setRainField(field);
  if (r.coupler?.roofArea) { // downspouts: each manhole's roofs take the radar rain at the manhole
    const fine = model.fine;
    r.radarNodeW ??= r.net.nodes.map(n => MR.sampleWeights(R.win, ...fromUTM(fine.x0 + n.p[0] * fine.dx, fine.y1 - n.p[1] * fine.dx, fine.zone)));
    r.coupler.roofRain = Float64Array.from(r.radarNodeW, ws => ws.reduce((a, [p, w]) => a + w * f[p], 0) / m);
  }
}
/** Water level at simulation time t (s), or null. */
const stageAt = (st, t) => (st?.wl ? H.levelAt(st.wl, (st.t0 ?? 0) + t * 1000) + (emu?.tide ?? 0)
  : run?.outlet ? H.levelAt(run.outlet.series, (st?.t0 ?? 0) + t * 1000) : null); // else a river outlet's level (outletFor)

/**
 * A river leaving the model (River inflow → Downstream gauge): the edge cells facing the gauge where the river crosses
 * (tidalEdgeCells on that side, up to the run's highest level), and their level over the storm, the gauge's recorded
 * water surface carried up the reach to the edge at its recorded discharge (src/outlet.js). Only without a tide: the
 * solver holds one external level. → { cells, series: { t, v, down, q }, L, side, g, how } | null
 */
function outletFor(r, c, F, mask) {
  const o = r.outletReady; if (!o) return null;
  const fine = model.fine, w = F * fine.dx, [gx, gy] = toUTM(o.g.lon, o.g.lat, fine.zone);
  const I = (gx - fine.x0) / w, J = (fine.y1 - gy) / w, side = sideToward(c.nx, c.ny, I, J);
  const lines = (model.osm.waterways || []).filter(l => /river|stream|canal/.test(l.kind)).map(l => toCells(fine, l.line));
  const water = waterCells(c, F, fine, model.nlcd, lines), top = Math.max(...o.level.map(p => p[1]));
  const cells = tidalEdgeCells(c, mask, water, top, { side });
  if (!cells.length) { log(`River outlet: no open water on the ${side} edge, toward ${o.g.name}; the edges stay free outfalls`, 'warn'); return null; }
  // the reach: as entered, else straight from the middle of the edge's cells to the gauge (a river that bends is longer)
  const mid = cells[cells.length >> 1], L = Number($('outLen').value) > 0 ? Number($('outLen').value) : o.reach ? o.reach.length : Math.hypot(I - (mid % c.nx + 0.5), J - (((mid / c.nx) | 0) + 0.5)) * w;
  // through the reach's lidar sections, the edge's own as the last; else the edge's section held all the way
  const sec = edgeSection(c, cells, w), series = o.reach ? outletSeriesReach([...o.reach.sections, edgeAsSection(sec, L)], o.level, o.flow) : outletSeries(sec, o.level, o.flow, L);
  return { cells, series, L, side, g: o.g, how: o.how, entered: Number($('outLen').value) > 0, reach: o.reach ? { sections: o.reach.sections.length, depth: o.reach.depth } : null };
}
/** The downstream gauge's recorded level and discharge over the storm (a historic storm only). → { g, level: [[t, m]], flow: [[t, m³/s]], how } | null */
async function prepareOutlet() {
  const site = $('outGauge').value.trim(), st = currentStorm(); if (!site) return null;
  if (!st?.t0) { log('River outlet: needs a historic storm (the downstream gauge’s record); the edges stay free outfalls', 'warn'); return null; }
  const g = await levelGauge(site, fetcher); if (!g) throw new Error(`no USGS site ${site}`);
  const t0 = st.t0 - 36e5, t1 = st.t0 + (st.durationMin + Number($('tail').value)) * 60e3 + 36e5;
  const lv = await levelSeries(g, fetcher, t0, t1); if (!lv.series?.length) throw new Error(`${g.name}: ${lv.why}`);
  const flow = (await gaugeFlows(site, t0, t1, fetcher).catch(() => [])).map(f => [f.t, f.q]);
  if (!flow.length) log(`River outlet: ${g.name} has no discharge record over the storm; its level is held at the edge with no rise up the reach`, 'warn');
  const reach = $('outReach').value === 'sections' ? await outletReach(site).catch((e) => { log(`River outlet: no cross-sections (${e.message}); the edge's own section is held all the way`, 'warn'); return null; }) : null;
  return { g, level: lv.series, flow, how: lv.how, reach };
}
/** Cross-sections from the lidar along the main stem from the gauge up to where it enters the model (src/outlet.js). */
async function outletReach(site) {
  const fine = model.fine, zone = fine.zone, x1 = fine.x0 + fine.nx * fine.dx, y0 = fine.y1 - fine.ny * fine.dx;
  const path = (await riverPath(site, fetcher)).map(([lon, lat]) => toUTM(lon, lat, zone));
  const reach = pathToEdge(path, (x, y) => x >= fine.x0 && x <= x1 && y >= y0 && y <= fine.y1);
  if (!reach) throw new Error('the river from the gauge never reaches the model');
  // ground over the reach at 3 m; the channel under the water: as entered, else the model's largest carved channel's
  const half = 300, dx = 3, xs = reach.line.map(p => p[0]), ys = reach.line.map(p => p[1]);
  const g = { x0: Math.min(...xs) - half - 20, y0: Math.min(...ys) - half - 20, x1: Math.max(...xs) + half + 20, y1: Math.max(...ys) + half + 20, dx, epsg: fine.epsg };
  g.nx = Math.ceil((g.x1 - g.x0) / dx); g.ny = Math.ceil((g.y1 - g.y0) / dx);
  const { z } = await fetchDEM(g, fetcher);
  const sample = (x, y) => {
    const fi = (x - g.x0) / dx - 0.5, fj = (g.y1 - y) / dx - 0.5, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
    const a = fi - i, b = fj - j, k = j * g.nx + i, v = (1 - a) * (1 - b) * z[k] + a * (1 - b) * z[k + 1] + (1 - a) * b * z[k + g.nx] + a * b * z[k + g.nx + 1];
    return v > -1000 ? v : NaN;
  };
  const big = [...(model.bathy?.comps ?? [])].sort((a, b) => b.areaKm2 - a.areaKm2)[0];
  const depth = Number($('outDepth').value) > 0 ? Number($('outDepth').value) : big?.dc ?? 2;
  const sections = cutSections(reach.line, sample, { half, dc: depth, n: { chan: 0.035, bank: 0.06 } });
  if (sections.length < 2) throw new Error('too few sections');
  log(`River outlet: ${sections.length} cross-sections over ${(reach.length / 1000).toFixed(2)} km of river to the gauge, the channel ${depth.toFixed(1)} m under the lidar water (${Number($('outDepth').value) > 0 ? 'as entered' : 'the model’s estimate'})`);
  return { sections, length: reach.length, depth };
}

/**
 * Edge cells that see the observed water level (tidalEdgeCells): tidal open water on the edge (NLCD open water or
 * wetland under the cell, or a mapped stream or river within 30 m) and the ground beside it below the run's highest
 * stage, out to the banks. A pool above a dam, a closed inflow edge and higher ground stay free outfalls.
 */
function stageEdgeCells(c, F, mask, st) {
  if (!st?.wl) return undefined;
  const fine = model.fine, W = fine.nx, lines = (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line));
  const near = (fi, fj) => lines.some(l => { for (let s = 0; s + 1 < l.length; s++) { const [ax, ay] = l[s], [bx, by] = l[s + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((fi - ax) * dx + (fj - ay) * dy) / L2)); if (Math.hypot(fi - ax - t * dx, fj - ay - t * dy) * fine.dx < 30) return true; } return false; });
  const water = new Uint8Array(c.nx * c.ny);
  for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) {
    if (I && J && I < c.nx - 1 && J < c.ny - 1) continue;
    const K = J * c.nx + I; if (!mask[K]) continue;
    const fi = I * F + F / 2, fj = J * F + F / 2, cls = model.nlcd?.[Math.min(fine.ny - 1, fj | 0) * W + Math.min(W - 1, fi | 0)];
    if (cls === 11 || cls === 90 || cls === 95 || near(fi, fj)) water[K] = 1;
  }
  const t0 = st.t0 ?? 0, t1 = t0 + st.durationMin * 60e3 + Number($('tail').value) * 60e3; // a design tide runs from 0
  const top = Math.max(...st.wl.v.filter((_, i) => st.wl.t[i] >= t0 - 36e5 && st.wl.t[i] <= t1 + 36e5), stageAt(st, 0)) + (emu?.tide ?? 0);
  return tidalEdgeCells(c, mask, water, top);
}

/** Water-level chart (single series, m NAVD88) on the hyetograph's time axis. */
function drawWL(t) {
  const st = run?.storm ?? currentStorm(), box = $('wlPlot');
  if (!st?.wl) { $('wlFig').hidden = true; return; }
  $('wlFig').hidden = false; $('wlTitle').textContent = `${st.wl.design ? 'Design' : 'Observed'} water level at ${st.wl.name}, m ${st.wl.datum ?? 'NAVD88'}`;
  const W = Math.max(240, box.clientWidth || 340), Hh = 96, L = 34, R = 6, T = 8, B = 76, dur = st.durationMin * 60e3;
  const pts = st.wl.t.map((tt, i) => [(tt - (st.t0 ?? 0)) / dur, st.wl.v[i]]).filter(([f]) => f >= 0 && f <= 1);
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
  $('hyetoFig').hidden = false; $('hyetoTitle').textContent = `Rain intensity, mm/hr per ${fmtDur(st.blockMin)}${st.radar ? ' (mean over the area)' : ''}`;
  const W = Math.max(240, box.clientWidth || 340), H = 132, L = 34, R = 6, T = 8, B = 112, n = st.intensity.length;
  const LV = st.radar?.live, band = LV?.ensemble?.band, seen = LV?.verify?.mean;
  const top = Math.max(st.peakIntensity, ...(band ? band.p90 : []), ...(seen ? seen.map(v => (v ?? 0) * 60 / st.blockMin) : []));
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500].find(s => top / s <= 4) ?? 1000, ymax = Math.max(step, Math.ceil(top / step) * step);
  const slot = (W - L - R) / n, gap = slot >= 4 ? 2 : slot >= 2 ? 1 : 0, bw = Math.max(0.5, slot - gap), y = (v) => B - (B - T) * v / ymax;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hyetograph: ${stormLabel(st)}">`;
  for (let v = 0; v <= ymax + 1e-9; v += step) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  const fc = st.radar?.live?.leadMin ? st.radar.live.forecastFrom : Infinity; // live radar: the nowcast's bars
  const QZ = Number.isFinite(fc) && LV.qpf?.cycle != null ? LV.qpf : null, wq = (i) => (QZ ? NC.hrrrWeight((i - fc) * st.blockMin + st.blockMin / 2, QZ.blend) : 0); // HRRR's share of block i
  st.intensity.forEach((v, i) => {
    const x = L + i * slot + gap / 2, top = y(v), r = Math.min(4, bw / 2, B - top);
    s += `<path class="bar${i >= fc ? (wq(i) >= 0.5 ? ' fcst qpf' : ' fcst') : ''}" data-i="${i}" d="M${x},${B}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${B}Z"/>`;
  });
  const lab = (min) => min >= 120 ? `${+(min / 60).toFixed(1)} h` : `${min} min`;
  for (const f of [0, 0.5, 1]) s += `<text x="${L + f * (W - L - R)}" y="${B + 14}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${lab(Math.round(f * st.durationMin))}</text>`;
  if (Number.isFinite(fc)) s += `<line class="obs-end" x1="${L + fc * slot}" x2="${L + fc * slot}" y1="${T}" y2="${B}"/><text class="obs-end-label" x="${L + fc * slot + 3}" y="${T + 9}">nowcast</text>`;
  if (Number.isFinite(fc) && band) { // the members' P10–P90 of the area-mean rate, and their median, over the nowcast blocks
    const xs = band.p10.map((_, i) => L + (fc + i + 0.5) * slot), up = band.p90.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`), dn = band.p10.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`).reverse();
    s += `<path class="band" d="M${up.join('L')}L${dn.join('L')}Z"/><path class="band-mid" d="M${band.p50.map((v, i) => `${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join('L')}"/>`;
  }
  if (Number.isFinite(fc) && seen?.length) s += `<path class="wl" d="M${seen.map((v, i) => `${(L + (fc + i + 0.5) * slot).toFixed(1)},${y((v ?? 0) * 60 / st.blockMin).toFixed(1)}`).join('L')}"/>`; // replay: the rain that fell
  if (Number.isFinite(fc) && QZ) { // HRRR: the crossfade, then HRRR alone, each marked
    const xa = L + (fc + QZ.blend.from / st.blockMin) * slot, xb = L + (fc + QZ.blend.to / st.blockMin) * slot;
    const qlab = `HRRR ${new Date(QZ.cycle).toISOString().slice(11, 13)}z, low skill`, fits = xb + 3 + 6.2 * qlab.length <= W - R; // 10 px mono ≈ 6.2 px a character
    s += `<line class="skill-end" x1="${xa}" x2="${xa}" y1="${T}" y2="${B}"/><text class="halo" x="${xa + 3}" y="${T + 20}">→ HRRR</text>` +
      `<line class="qpf-start" x1="${xb}" x2="${xb}" y1="${T}" y2="${B}"/><text class="qpf-label halo" x="${fits ? xb + 3 : W - R}" y="${T + 31}" text-anchor="${fits ? 'start' : 'end'}">${qlab}</text>`;
  } else if (Number.isFinite(fc) && LV.leadMin > 60) { const x60 = L + (fc + 60 / st.blockMin) * slot; s += `<line class="skill-end" x1="${x60}" x2="${x60}" y1="${T}" y2="${B}"/><text x="${x60 + 3}" y="${T + 9}">low skill</text>`; }
  s += `<line class="now" id="hyNow" x1="0" x2="0" y1="${T}" y2="${B}" visibility="hidden"/><rect id="hyHit" x="${L}" y="${T}" width="${W - L - R}" height="${B - T}" fill="transparent"/></svg>`;
  box.innerHTML = s;
  hy = { st, bars: [...box.querySelectorAll('.bar')], L, slot, W, B, lastBlock: -2 };
  const tip = $('hyetoTip'), hit = box.querySelector('#hyHit');
  hit.onmousemove = (e) => {
    const r = box.querySelector('svg').getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, i = Math.min(n - 1, Math.max(0, Math.floor((x - L) / slot)));
    hy.bars.forEach((b, k) => b.classList.toggle('hot', k === i));
    tip.hidden = false; tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (r.height * y(st.intensity[i]) / H + 18) + 'px';
    tip.textContent = `${i * st.blockMin}–${(i + 1) * st.blockMin} min · ${st.intensity[i].toFixed(0)} mm/hr · ${st.depth[i].toFixed(1)} mm${i >= fc ? (wq(i) >= 1 ? ' · HRRR' : wq(i) > 0 ? ` · nowcast, ${Math.round(wq(i) * 100)} % HRRR` : ' · nowcast') : ''}`;
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
swmmReady.then(updateDrainUI);
function setDrainSource(d) {
  drainSrc = d;
  for (const b of $('drainSrc').children) b.setAttribute('aria-pressed', b.dataset.d === d);
  $('lumpedCtl').hidden = d !== 'lumped'; $('networkCtl').hidden = d !== 'network';
  if (map.getLayer('net-pipes')) for (const l of ['net-pipes', 'net-nodes', 'net-grates']) map.setLayoutProperty(l, 'visibility', d === 'network' && $('tNet').checked ? 'visible' : 'none');
  if (model) resetRun();
}
$('drainSrc').onclick = (e) => { const b = e.target.closest('button'); if (b && !(run?.solver)) setDrainSource(b.dataset.d); };
for (const id of ['designAri', 'spacing', 'lumpRate', 'downspout', 'giPave', 'giGarden', 'giRoof', 'giTank', 'twoWay', 'inletType', 'inletArea', 'inletPerim', 'inletCw', 'inletCo', 'inletCrest', 'inletStd', 'inletTypePicks', 'swmmPreset', 'swmmStep', 'swmmVarStep', 'swmmHeadTol', 'swmmTrials', 'swmmMinArea', 'swmmSurcharge', 'swmmDamping', 'swmmNormal', 'swmmMinSlope', 'swmmLengthen', 'csoOn', 'csoDwf', 'csoCap', 'csoPerCap', 'csoDensity', 'csoGates']) $(id).addEventListener('change', () => { if (model && !(run?.solver)) resetRun(); });
for (const [id, fmt] of [['giPave', v => v + ' %'], ['giGarden', v => v + ' %'], ['giRoof', v => v + ' %'], ['giTank', v => (v > 0 ? Number(v).toLocaleString() + ' m³' : 'none')]]) {
  const show = () => { $(id + 'Out').textContent = fmt($(id).value); }; $(id).addEventListener('input', show); show();
}
$('tNet').onchange = () => setDrainSource(drainSrc);

// ------------------------------------------------------------------ combined sewers (src/cso.js)
/** Local hour at the storm's start (standard time from the longitude; design storms start at 06:00). */
const csoStartHour = (st) => (st?.t0 != null ? (((st.t0 / 3.6e6 + model.site[0] / 15) % 24) + 24) % 24 : 6);
/** In a combined-sewer area: people per manhole, sanitary flow and the regulators, on the run's network. → books setup | null */
function csoSetup(net) {
  if (!$('csoOn').checked) return null;
  // a saved project can carry the setting into an area whose data says separate storm sewers (the Charlotte cases did,
  // 4–7 Nov 2026: pipe ends the outfall layer missed lost their water, and the gauge saw under half the flow)
  if (!(model.util?.combined || model.linked?.combined)) log('Combined-sewer treatment is on, but this area’s drainage data shows separate storm sewers: sanitary flow is added, flow is sent to an interceptor, and pipe ends not in the outfall layer take their water out of the model. Untick “Combined sewer area” unless the pipes really are combined.', 'warn');
  const pop = CSO.populationPerNode(model.fine, model.f, net, { uniform: $('csoDensity').value === '' ? null : Number($('csoDensity').value) });
  const dwfTotal = CSO.setDWF(net, pop, { perCapita: Number($('csoPerCap').value) || CSO.CSO_DEFAULTS.perCapita });
  const regs = CSO.addRegulators(net, { capacity: Number($('csoCap').value) || CSO.CSO_DEFAULTS.capacity, gates: false });
  const people = pop.reduce((a, b) => a + b, 0);
  $('csoNote').textContent = `${Math.round(people).toLocaleString()} people on ${net.nodes.filter(n => n.dwf > 0).length} manholes, ${(dwfTotal * 1000).toFixed(1)} L/s mean sanitary flow (peak ×${CSO.PEAK_FACTOR.toFixed(2)}). ` +
    (regs.length ? `${regs.length} regulator${regs.length > 1 ? 's' : ''} at the outfalls to streams, interceptor capacity ${regs.map(g => (g.qcap * 1000).toFixed(0)).join(' / ')} L/s.` : 'No outfalls to a stream here: all combined flow leaves the area in the sewer (no overflow books).');
  return { regs, dwfTotal, people, dwfOn: $('csoDwf').checked, interEventH: Number($('csoIet').value) || CSO.CSO_DEFAULTS.interEventH, gatesOn: $('csoGates').checked };
}
/** Just before the .inp is written: the pattern's local start hour, and flap gates where the outfalls see the tide. */
function csoBeforeRun(r) {
  const st = currentStorm(), cs = r.cso; cs.startHour = csoStartHour(st); cs.gates = cs.gatesOn && !!st?.wl;
  r.net.dwfOn = cs.dwfOn; r.net.dwfStartHour = cs.startHour;
  for (const g of cs.regs) r.net.nodes[g.overflow].gated = cs.gates;
}
/** The run record's combined-sewer books (src/cso.js csoBooks) from the coupler's outfall volumes and series. */
function csoRecord(r, hgl, T) {
  const cs = r.cso, offsite = r.net.nodes.reduce((a, n, i) => a + (n.outfall && n.offsite ? hgl?.outVol?.[i] ?? 0 : 0), 0);
  return { ...CSO.csoBooks(cs.regs, hgl, { T, startHour: cs.startHour, dwfOn: cs.dwfOn, dwfTotal: cs.dwfTotal, offsite, interEventH: cs.interEventH, gates: cs.gates }),
    people: cs.people, startHour: cs.startHour, settings: { perCapita: Number($('csoPerCap').value), capacity: Number($('csoCap').value), density: $('csoDensity').value || 'by land cover', dwf: cs.dwfOn, gates: cs.gates } };
}
// ------------------------------------------------------------------ end of combined sewers

/** Network for the current solver grid (inlet cells depend on the cell size). */
function makeNetwork(c, F, { ignoreLayer = false } = {}) {
  // precedence: pipes in the infrastructure layer, then linked pipes, then the street-following estimate; catch basins
  // and outfalls in the layer replace the linked / utility ones
  const lay = ignoreLayer ? null : infra.inputs(), L = model.linked;
  const inlets0 = lay?.inlets.length ? lay.inlets : L?.inlets.length ? L.inlets : model.util?.inlets;
  const inlets = applyInletKinds(inlets0, inletKinds(inlets0)); // each grate its own hydraulics where its type has a kind of inlet
  const outfalls = lay?.outfalls.length ? lay.outfalls : L?.outfalls.length ? L.outfalls : model.util?.outfalls;
  const combined = $('csoOn').checked; // combined sewer: interior pipe ends no outfall claims leave the model (src/network-real.js)
  const withQ = (net) => { if (net) for (const p of net.pipes) p.Qfull = 0.3117 / (p.n ?? net.opts.n) * p.D ** (8 / 3) * Math.sqrt(p.S); return net; };
  if (lay?.pipes.length) { // tier 1: pipes the user drew or imported
    const net = realNetwork(model.fine, model.f, lay.pipes, { ...c, F }, { realInlets: inlets, outfalls, combined });
    if (net) { net.drawn = true; return withQ(net); }
  }
  if (L?.pipes.length) { // tier 1: the user's linked pipes
    const net = realNetwork(model.fine, model.f, L.pipes, { ...c, F }, { realInlets: inlets, outfalls, combined });
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
  if (model.bathy) bathyCells(c, F);
  // infiltration: Green-Ampt from the soil survey (c.infil becomes K; the run carries ψΔθ and the water-table storage)
  const wt = $('wtDepth').value.trim() === '' ? null : Math.max(0.05, Number($('wtDepth').value));
  const ga = $('infilModel').value === 'ga' && model.f.ga ? gaCells(model.f, c.nx, c.ny, F, c.mask, { Se: emu?.se ?? WETNESS[$('wetness').value], wtOverride: wt, perCellArea: !!c.sg }) : null;
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
  const win = windowNext; // a window rerun: outside the window becomes sinks; both runs book the window's edge in segments
  if (win?.mode === 'rerun') { const m = WIN.insideMask(win.rect, c.nx, c.ny); c.inside = c.inside ? c.inside.map((v, k) => (v && m[k] ? 1 : 0)) : m; }
  const winSegs = win ? WIN.windowSegments(win.rect, c.nx, Math.max(4, Math.round(20 / (F * model.fine.dx)))) : [];
  // control lines (Site design → Control line): their solver faces, booked every step
  const clines = design.analysis.features.filter(f => f.properties.type === 'cline' && f.geometry?.coordinates?.length > 1);
  const allLines = [...clines.map(f => toCells(model.fine, f.geometry.coordinates).map(([x, y]) => [x / F, y / F])), ...winSegs.map(s => s.line)];
  const lf = allLines.length ? CMP.lineFaces(allLines, c.nx, c.ny) : { faces: [], perLine: [] };
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
  if (net) { // Drainage → Inlet hydraulics: every grate's opening and coefficients; the crest where an inlet sets none
    const ih = inletHydraulics(); net.opts = { ...net.opts, clog: cal().clog, ...ih.opts };
    for (const g of net.inlets) if (g.crest == null) g.crest = ih.crest;
  }
  const down = Number($('downspout').value) / 100; // downspouts straight into the nearest manhole (needs the SWMM engine)
  const drains = c.roofs && [...c.roofs.values()].some(r => r.roof === 'network'); // new buildings with roof drains (site design)
  const roof = net && swmmEngine && (down > 0 || drains) ? roofConnections(c, net, down, Number($('roof').value) / 100, 80, { toCell: llCell }) : null;
  if (roof) c.rainField = c.sg ? sgRain(c, roof.rainField, roofF, net, down, roof.roofArea) : roof.rainField;
  if (c.roofs) design.setRoofLinks(new Map([...c.roofs].filter(([, r]) => r.roof === 'network').map(([id]) => [id, roof?.links.has(id)
    ? (roof.links.get(id) == null ? 'to the ground: no manhole within 30 m (or within 5 m of the one chosen)' : `to manhole ${roof.links.get(id)} of the network`)
    : !net ? 'to the ground: no pipe network in this run' : 'to the ground: the SWMM engine is not loaded']))); // where new buildings' roof drains go
  const gi = drawnGI(model.f, c, F, giLayers(model.f, c, F, { pavement: Number($('giPave').value) / 100, rainGarden: Number($('giGarden').value) / 100 })); // + drawn bioretention and permeable pavement (site design)
  const tanks = net ? addTanks(net, Number($('giTank').value)) : [];
  const storage = attachStorage(net, lay.storage, model.fine, model.f).attached; // after addTanks, which clears storage
  infra.setAttached(net ? storage : []);
  const cso = net ? csoSetup(net) : null; // combined sewers: sanitary flow, regulators to the interceptor (after the tanks)
  drawNetwork(net);
  const green = Number($('giRoof').value) / 100; // green roofs hold the first 25 mm on their share of the roofs
  // until they fill, only the other roofs shed water: downspouts take down·(1 − green), the ground (1 − down)·(1 − green)·roof
  const rf = Number($('roof').value) / 100, roofEarly = green > 0 ? (roof ? roofConnections(c, net, down * (1 - green), (1 - green) * (1 - down) * rf / Math.max(1e-9, 1 - down * (1 - green)), 80, { toCell: llCell })
    : { rainField: roofRouting(c.mask, c.nx, c.ny, rf * (1 - green), c.roofs ? { ids: c.bldId, roofs: c.roofs } : null).rainField }) : null;
  if (roofEarly && c.sg) roofEarly.rainField = roof ? sgRain(c, roofEarly.rainField, (1 - green) * (1 - down) * rf / Math.max(1e-9, 1 - down * (1 - green)), net, down * (1 - green), roofEarly.roofArea)
    : sgRain(c, roofEarly.rainField, rf * (1 - green));
  const roofStages = roofHoldStages(c, net, roof, green);
  const culv = culvertLinks(model.fine, c, F, [...model.osm.culverts.map(cv => ({ ...cv, D: culvertDiameter(cv.tags, cv.kind) })), ...lay.culverts], new Set(net ? net.inlets.map(g => g.cell) : []));
  const sw = stormwaterLinks(c, F, net, new Set([...(net ? net.inlets.map(g => g.cell) : []), ...culv.flatMap(x => [x.a, x.b])]), gi);
  run = { ga: ga ? { psiD: ga.psiD, fmax: ga.fmax, perv: ga.perv } : null, scour, sed, debris, banks: banks?.count ? banks.banks : null, bars, gi, tanks, storage, green, roofEarly, roofStages, stage: 0, scenario: model.design?.name ?? null, sw, lines: { defs: [...clines.map((f, l) => ({ id: f.id, name: f.properties.name ?? null, gauge: f.properties.gauge ?? null, faces: lf.perLine[l], ends: lineEnds(f.geometry.coordinates) })), ...winSegs.map((s, q) => ({ id: 'win:' + q, name: null, side: s.side, faces: lf.perLine[clines.length + q] }))], faces: lf.faces, samples: allLines.map(() => [[0, 0, 0, 0]]) },
    window: win ? { ...win, segs: winSegs } : null, culv, roof, net, cso, F, c, solver: null, playing: false, t: 0, out: null, hmax: null, smax: null, view: null, storm: null, frames: [], nextFrame: 0, K: 8, rtf: 0, mass: null, lastRead: 0, gen: ++runGen };
  run.done = new Promise((resolve) => { run.finish = resolve; }); // resolved when the run ends (sweeps wait on it)
  $('runBtn').disabled = false; $('runBtn').textContent = 'Run'; $('exportBtn').disabled = false; $('rasBtn').disabled = false; $('hud').hidden = false;
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
 * The site design's pond outlets, underdrains and wet-pond pools on the solver grid: each outlet drains its pond's
 * lowest cell near the riser to a free surface cell at its end, a network node (the one within 5 m of the point given,
 * else the nearest within 30 m of the end; with no SWMM network: the surface at the end), or off the model.
 * → { outlets (OutletLinks input), under: [{ id, node, cells }], pools: [{ id, pool, cells }], notes }
 */
function stormwaterLinks(c, F, net, taken, gi) {
  const f = model.f, out = { outlets: [], under: [], pools: [], notes: [] }, used = new Set(taken), W = model.fine.nx;
  const cellAt = (ll) => { const [x, y] = llCell(ll), I = Math.floor(x / F), J = Math.floor(y / F); return I < 0 || J < 0 || I >= c.nx || J >= c.ny ? -1 : J * c.nx + I; };
  const solverCells = (fineCells) => [...new Set(fineCells.map(k => (((k / W) | 0) / F | 0) * c.nx + ((k % W) / F | 0)))].filter(K => c.mask[K]);
  const nodes = net && swmmEngine && drainSrc === 'network' ? net.nodes.map((n, i) => ({ i, x: n.p[0] / F, y: n.p[1] / F })).filter(o => !net.nodes[o.i].outfall) : [];
  const nodeNear = (ll, lim) => { if (!ll || !nodes.length) return -1; const [x, y] = llCell(ll); let best = -1, bd = lim / F; for (const o of nodes) { const d = Math.hypot(o.x - x / F, o.y - y / F); if (d < bd) { bd = d; best = o.i; } } return best; };
  const free = (K) => { if (K >= 0 && c.mask[K] && !used.has(K)) return K; let best = -1; const I = K % c.nx, J = (K / c.nx) | 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = I + di, b = J + dj, q = b * c.nx + a; if (a < 0 || b < 0 || a >= c.nx || b >= c.ny || !c.mask[q] || used.has(q)) continue; if (best < 0 || c.z[q] < c.z[best]) best = q; }
    return best; };
  for (const pd of f.ponds ?? []) if (pd.pool != null) out.pools.push({ id: pd.id, pool: pd.pool, cells: solverCells(pd.cells) });
  for (const o of f.outlets ?? []) {
    const pond = (f.ponds ?? []).find(pd => pd.id === o.pondId), startLL = fromCellLL(o.start), endLL = fromCellLL(o.end);
    // the riser: the lowest pond cell within 5 m of where the line starts (the pond drains to it), else the start cell
    let a = -1; const s0 = cellAt(startLL);
    if (pond) { const [x0, y0] = o.start; for (const K of solverCells(pond.cells)) { const I = K % c.nx, J = (K / c.nx) | 0; if (Math.hypot((I + 0.5) * F - x0, (J + 0.5) * F - y0) > Math.max(5, F * 1.5) || used.has(K)) continue; if (a < 0 || c.z[K] < c.z[a]) a = K; } }
    if (a < 0) a = free(s0); if (a < 0) { out.notes.push(`Outlet ${o.name ?? o.id}: no free cell at the riser`); continue; }
    used.add(a);
    let mode = o.mode, b = -1, node = -1;
    if (mode === 'network') { node = nodeNear(o.node, 5); if (node < 0) node = nodeNear(endLL, 30); if (node < 0) { mode = 'surface'; out.notes.push(`Outlet ${o.name ?? o.id}: no network node in reach (or no SWMM network in this run): it discharges on the surface at its end`); } }
    if (mode === 'surface') { b = free(cellAt(endLL)); if (b < 0 || b === a) { mode = 'offsite'; b = -1; } else used.add(b); }
    out.outlets.push({ id: o.id, name: o.name, a, b, node, mode, structure: o.structure, pondId: o.pondId });
  }
  for (const g of gi?.drawn ?? []) {
    const src = (f.drawnGI ?? []).find(x => x.id === g.id); if (!src?.under) continue;
    const node = nodeNear(src.node, 5) >= 0 ? nodeNear(src.node, 5) : nodeNear(src.node, 30);
    if (node < 0) { out.notes.push(`Rain garden ${g.id}: underdrain node not in this run's network: it drains to the native soil only`); for (const K of g.cells) gi.under[K] = 0; continue; }
    out.under.push({ id: g.id, node, cells: g.cells.filter(K => gi.under[K] > 0) });
  }
  if (!(nodes.length)) for (const K of gi?.under ? gi.under.keys() : []) if (gi.under[K] > 0 && !out.under.some(u => u.cells.includes(K))) gi.under[K] = 0;
  return out;
}
/** Fine-cell coordinates [col, row] → lon/lat. */
const fromCellLL = ([x, y]) => fromUTM(model.fine.x0 + x * model.fine.dx, model.fine.y1 - y * model.fine.dx, model.fine.zone);
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
  run.culverts = run.culv.length ? new CulvertLinks(run.culv, c.z, { cellArea: F * F }) : null;
  run.watch = run.bars.faces.length ? new BarrierWatch(run.bars, c.z, F) : null;
  const lv0 = run.watch?.levels(0); let crest = run.watch ? run.bars.faces.map((q, m) => ({ i: q.i, j: q.j, axis: q.axis, z: lv0[m], C: q.C, ground: q.ground })) : undefined;
  if (run.window?.mode === 'rerun') {
    // the window's edge as crests: shut (a wall) while the existing run's flow across a segment was inward, so its inflow
    // goes in and stays in; open while it was outward, so water leaves to the sinks freely (windowCrests, every exchange)
    const first = run.lines.defs.findIndex(d => String(d.id).startsWith('win:')), wf = run.lines.faces.filter(f => f.line >= first), segs = run.window.base.window.segs;
    run.winCrest = { at: crest?.length ?? 0, seg: wf.map(f => f.line - first), rates: segs.map(sg => ({ in: WIN.rateOf(sg.series, 3), out: WIN.rateOf(sg.series, 2) })), key: '' };
    crest = [...(crest ?? []), ...wf.map(f => ({ i: f.i, j: f.j, axis: f.axis, z: 1e6, C: 1.7, ground: NaN }))];
  }
  run.outlets = run.sw.outlets.length ? new OutletLinks(run.sw.outlets, c.z, { cellArea: F * F }) : null;
  // outfalls that discharge inside the model give their water back to the ground there (an endwall into a creek); not on
  // a cell another exchange point uses (a culvert end sits at the endwall), since two in one cell lose one's water
  run.netReturns = coupled ? outfallCells(run.net.nodes, model.fine.nx, { ...c, F }, new Set([...(run.outlets?.cells ?? []), ...run.net.inlets.map(g => g.cell), ...(run.culverts?.cells ?? [])])) : [];
  if (run.netReturns.length) { const st = run.net.stats, open = (st.interiorEnds ?? 0) - (st.placedOutfalls ?? 0) - (st.openEnds ?? 0);
    log(`${run.netReturns.length} outfall${run.netReturns.length > 1 ? 's' : ''} inside the area put their water back on the ground`, 'ok',
      [st.placedOutfalls ? `${st.placedOutfalls} from the outfall layer` : '', st.openEnds ? `${st.openEnds} other pipe ends (separate storm sewer: water comes out where the pipe ends)` : '',
        open > 0 ? `${open} other pipe ends are not in the outfall layer (combined sewer): their water leaves the model` : ''].filter(Boolean).join('; ')); }
  const base = [...(run.outlets?.cells ?? []), ...(coupled ? [...run.net.inlets.map(g => g.cell), ...run.netReturns.map(r => r.cell)] : []), ...(run.culverts?.cells ?? [])], used = new Set(base);
  let entries = run.inflowReady ?? [];
  const wr = run.window?.mode === 'rerun' ? run.window : null;
  if (wr) { // rivers entering inside the window as before; each edge segment gives back what crossed it inward in the existing run
    const R = wr.rect, inR = (e) => { const I = Math.floor(e.at[0] / F), J = Math.floor(e.at[1] / F); return I >= R.i0 && I <= R.i1 && J >= R.j0 && J <= R.j1; };
    entries = [...entries.filter(inR), ...wr.segs.map((s, q) => ({ label: 'window edge ' + q, site: null, at: null, cells: s.cells.filter(k => c.mask[k] && !used.has(k)), flow: WIN.rateOf(wr.base.window.segs[q]?.series ?? [[0, 0, 0, 0]], 3) }))];
  }
  const { entries: inflows, mask } = edgeEntries(c, entries, used);
  let stageCells = stageEdgeCells(c, F, mask, currentStorm());
  run.outlet = stageCells ? null : outletFor(run, c, F, mask);
  if (run.outlet) {
    stageCells = run.outlet.cells; const o = run.outlet, pk = o.series.v.indexOf(Math.max(...o.series.v));
    log(`River outlet: the ${o.side} edge (${o.cells.length} cells) holds ${o.g.name}'s level carried ${(o.L / 1000).toFixed(2)} km up the river${o.reach ? ` through ${o.reach.sections} lidar cross-sections` : o.entered ? '' : ' (straight-line distance; enter the river length if it bends)'}: ` +
      `${o.series.v[0].toFixed(2)} m NAVD88 at the start, ${o.series.v[pk].toFixed(2)} m at its crest (gauge ${o.series.down[pk].toFixed(2)} m + ${(o.series.v[pk] - o.series.down[pk]).toFixed(2)} m at ${Math.round(o.series.q[pk]).toLocaleString()} m³/s)`, 'ok', 'USGS NWIS');
  } else if (stageCells && run.outletReady) log('River outlet: not used with a tide on the edges (the solver holds one external level)', 'warn');
  run.stageCells = stageCells?.length ?? 0;
  inflows.forEach(e => e.cells.forEach(k => used.add(k)));
  for (const e of inflows.filter(e => e.edgeWidth)) log(`${e.name || e.label}: enters across the model edge over ${e.edgeWidth} m of channel; the edge is closed across it and the flow goes in just inside`, 'ok');
  run.inflow = inflows.length ? new InflowLinks(inflows) : null;
  const cells = [...base, ...(run.inflow?.cells ?? [])], inletCells = cells.length ? cells : undefined;
  const shared = cells.length - new Set(cells).size; // the exchange kernel runs one thread per point: a shared cell loses water
  if (shared) log(`${shared} exchange point${shared > 1 ? 's share a cell' : ' shares a cell'} with another: the surface books will not close`, 'warn');
  run.solver = new GPUSolver(device, {
    nx: c.nx, ny: c.ny, dx: F, z: c.z, mask, manning: c.manning, infil, inlets: inletCells, stageCells, subgrid: c.sg ?? undefined,
    sink: c.inside?.map(v => 1 - v), lines: run.lines.faces.length ? run.lines.faces : undefined, gi: run.gi ?? undefined, underdrains: coupled && run.sw.under.length ? run.sw.under.flatMap(g => g.cells) : undefined, crest, ga: run.ga ?? undefined, scour: run.scour ?? undefined, sediment: run.sed ?? undefined, debris: run.debris, banks: run.banks ?? undefined, rainField: rainBase0(run, c),
    bc: { west: 'outflow', east: 'outflow', south: 'outflow', north: 'outflow' }, hdry: 1e-5, hfront: 1e-3, dtDry: 2,
    // --- local time stepping (opt-in, Solver settings checkbox; off by default) ---
    lts: $('ltsOn')?.checked || undefined,
  });
  if (run.solver.ltsOff) log(`Local time stepping is off with ${run.solver.ltsOff}; stepping globally`, 'warn');
  // --- /local time stepping ---
  const start = startWater(c, F, stageCells); // rivers, lakes and tidal water from the gauges (or dry: the lidar surface)
  run.startDepth = start?.depth ?? null; run.startNote = start ? $('startNote').textContent : null; // filed with the run (start_depth.asc)
  const pool = new Map(); for (const pd of run.sw.pools) for (const K of pd.cells) pool.set(K, Math.max(pool.get(K) ?? 0, pd.pool - c.z[K])); // wet ponds start at their permanent pool
  const at = (x, y) => Math.min(c.ny - 1, Math.floor(y / F)) * c.nx + Math.min(c.nx - 1, Math.floor(x / F));
  const w = run.warm; // the baseflow warm-up's end state (depths and velocities), else the start levels
  const bf = c.bathyFill; // an estimated channel starts full to the lidar surface
  run.solver.setDepth((x, y) => Math.max(w ? w.h[at(x, y)] : start ? start.depth[at(x, y)] : 0, pool.get(at(x, y)) ?? 0, bf ? bf[at(x, y)] : 0));
  if (w) run.solver.setVelocity((x, y) => { const k = at(x, y), h = w.h[k]; return h > 1e-4 && !pool.has(k) ? [w.hu[k] / h, w.hv[k] / h] : [0, 0]; });
  run.storm = currentStorm(); lockStorm(true);
  run.rainBase = rainBase0(run, c); run.radarK = -1; run.radarW = run.radarNodeW = null;
  if (coupled) {
    run.swmm = swmmEngine; run.swmmClosed = false;
    run.twoWay = $('twoWay').checked;
    if (run.cso) csoBeforeRun(run);
    run.inp = toINP(run.net, model.fine, { durationS: Math.ceil(tStop() / 60) * 60 + 3600, title: 'FloodSim synthetic network (data tier 2)', pressurise: run.twoWay, routing: swmmRouting() });
    run.swmm.open(run.inp);
    run.coupler = new Coupler(run.solver, run.net, run.swmm, c.z, { interval: 2, roofArea: run.roofStages ? run.roofStages[0].roofArea ?? run.roof?.roofArea : run.roofEarly?.roofArea ?? run.roof?.roofArea, twoWay: run.twoWay, returns: run.netReturns });
    $('netReadouts').hidden = false;
  }
  if (run.coupler && run.window?.mode === 'record') run.coupler.recordInlets = true;
  if (run.coupler && wr?.base.window?.inlets) { // inlets outside the window: the existing run's exchange, by inlet position
    const bi = wr.base.window.inlets, R = wr.rect, at = new Map(bi.fineCells.map((k, m) => [k, m])), pre = new Map();
    run.net.inlets.forEach((g, m) => { const I = g.cell % c.nx, J = (g.cell / c.nx) | 0; if (I >= R.i0 && I <= R.i1 && J >= R.j0 && J <= R.j1) return; const b = at.get(g.fineCell); if (b == null) return;
      pre.set(m, (t0, t1) => WIN.volumeAt(bi.series, t1, 1 + b) - WIN.volumeAt(bi.series, t0, 1 + b)); });
    run.coupler.prescribe = pre;
  }
  if (run.outlets) run.outlets.coupler = run.coupler ?? null; // network outlets hand their water to SWMM through the coupler
  run.underdrains = coupled && run.sw.under.length ? new UnderdrainLinks(run.solver, run.sw.under, { cellArea: F * F, coupler: run.coupler }) : null;
  // outlets and underdrains step before the coupler, so SWMM gets their water in the same exchange
  const members = [run.outlets, run.underdrains, run.coupler, run.culverts, run.inflow].filter(Boolean);
  run.exchanger = members.length > 1 || run.culverts || run.inflow || run.outlets ? new LinkHub(run.solver, members, 2) : run.coupler; // every 2 s
  for (const id of ['drainSrc', 'networkCtl', 'lumpedCtl']) $(id).classList.add('locked');
  setTiers();
  run.hmax = new Float32Array(c.nx * c.ny); run.smax = new Float32Array(c.nx * c.ny);
  run.haz = new HazardTracker(c.nx * c.ny);
}
/** Gauge readings for a run's start levels and river inflow (fetched now, or the ones a paired run already used, so
 *  both runs of a comparison see the same forcing). → false when the run was replaced meanwhile. */
async function prepareRun(r) {
  try { await coastReady(); } catch (e) { log(e.message, 'err'); return false; } // the design tide's station data (compound flooding)
  await inflow.ready; // the gauge lists (they load after the build)
  if (run !== r) return false;
  r.gaugeWatch = gaugeWatch(r);
  if (pairPrep) {
    r.levelsReady = pairPrep.levelsReady; r.inflowReady = pairPrep.inflowReady; r.outletReady = pairPrep.outletReady ?? null; scaleRunInflow(r);
    if (r.levelsReady) r.levelSrc = await levelSources(r.levelsReady, r.c, r.F);
    await warmUp(r);
    return run === r && !r.solver;
  }
  if ($('startWater').value === 'gauge') {
    try { r.levelsReady = await prepareLevels(); if (r.levelsReady) r.levelSrc = await levelSources(r.levelsReady, r.c, r.F); } catch (e) { log('Gauge levels: ' + e.message, 'warn'); }
  }
  try { r.inflowReady = await prepareInflow(); } catch (e) { log('River inflow: ' + e.message, 'warn'); r.inflowReady = []; }
  try { r.outletReady = await prepareOutlet(); } catch (e) { log('River outlet: ' + e.message + '; the edges stay free outfalls', 'warn'); r.outletReady = null; }
  scaleRunInflow(r);
  await warmUp(r);
  return run === r && !r.solver;
}
let pairPrep = null;
/**
 * USGS level gauges inside the model, for the validation scorecard (a real storm only): each gauge's open-water cells
 * within 60 m, whose highest water surface is recorded every simulated minute.
 */
function gaugeWatch(r) {
  const st = r.storm ?? currentStorm(); if (!st?.t0 || !inflow.levels.length) return null;
  const { c, F } = r, fine = model.fine, R = Math.max(3, Math.ceil(60 / (F * fine.dx)));
  const lines = (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line));
  const water = waterCells(c, F, fine, model.nlcd, lines), gauges = [];
  for (const g of inflow.levels) {
    const k = cellAt(fine, c, F, g.lon, g.lat); if (k < 0 || !c.mask[k] || (c.inside && !c.inside[k])) continue;
    gauges.push({ g, cells: nearestCells(c, waterNear(c, water, k, R), k, 200), series: [], wse: [] });
  }
  return gauges.length ? { t0: st.t0, gauges, next: 0 } : null;
}
/** The level at each gauge: the median water surface of the 9 nearest channel cells at least 10 cm deep (a bank cell
 *  wet with rain is not the gauge's water). Each cell's surface is kept too: once the gauge's readings are in, the
 *  series is taken again from the water body it reads (fillGauges), not the far side of a dam beside it. */
function recordGauges(r, out, t) {
  const w = r.gaugeWatch, z = r.c.z; w.next = t + 60;
  for (const gw of w.gauges) {
    const row = gw.cells.map(q => (out[2 * q] > 0.1 ? Math.round((z[q] + out[2 * q]) * 1000) / 1000 : null));
    gw.wse?.push(row); gw.series.push([w.t0 + t * 1000, median9(row)]);
  }
}
/** The median of the first 9 wet (non-null) of these surfaces, nearest first, or NaN. */
function median9(row, use = null) {
  const v = []; for (let i = 0; i < row.length && v.length < 9; i++) if (row[i] != null && (!use || use[i])) v.push(row[i]);
  v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN;
}
/**
 * The scorecard's inputs from a finished run: the high-water marks (scored now), the rain's sources, the books; the
 * gauges' observed levels are fetched after (filled into rec.validation.gauges, then the report redraws).
 */
function validationOf(r, rec) {
  const st = r.storm, m = r.mass ?? {}, R = st?.radar, s = R?.stats;
  const sc = S.obs.length ? scoreNow() : null;
  return {
    observed: !!st?.t0, event: S.obsEvent ?? null,
    hwm: hwmOf(sc),
    floodMaps: S.maps.length ? scoreMaps() : [],
    rain: st?.t0 ? { source: st.source ?? st.name, gauged: R ? (s.hours ? s.gaugeHours / s.hours : 0) : null, usedMM: R ? R.hoursMM : st.total, radarMM: R ? R.radarMM : null, siteMM: R?.siteMM ?? null } : null,
    mass: { surface: m.rel ?? 0, combined: r.netMass?.combinedRel ?? null, clipped: m.clipped ?? 0, rain: m.rain ?? 0 },
    gauges: r.gaugeWatch ? r.gaugeWatch.gauges.map(gw => ({ site: gw.g.site, name: gw.g.name, model: gw.series, obs: null, score: null, why: gw.cells.length ? 'reading the gauge…' : 'no open water mapped within 60 m of the gauge' })) : [],
  };
}
async function fillGauges(r, v) {
  const w = r.gaugeWatch; if (!w) return;
  await Promise.all(w.gauges.map(async (gw, i) => {
    const out = v.gauges[i]; if (!gw.cells.length) return;
    const t1 = gw.series.at(-1)?.[0] ?? w.t0;
    try {
      const o = await levelSeries(gw.g, fetcher, w.t0 - 3600e3, t1 + 3600e3);
      if (!o.series?.length) { out.why = o.why ?? 'no readings in the run window'; return; }
      const first = o.series.reduce((a, p) => (Math.abs(p[0] - w.t0) < Math.abs(a[0] - w.t0) ? p : a)), mine = new Set(gaugeWater(r.c, gw.cells, first[1]));
      if (gw.wse?.length === gw.series.length && mine.size < gw.cells.length) { // the water body its reading at the start says it reads
        const use = gw.cells.map(q => mine.has(q)); gw.series = gw.series.map(([t], m) => [t, median9(gw.wse[m], use)]); out.model = gw.series;
        const zs = r.c.zSurf ?? r.c.z, top = Math.max(...[...mine].map(q => zs[q]));
        out.reads = `water with its lidar surface at ${(top - 1).toFixed(2)}–${top.toFixed(2)} m, ${mine.size} of the ${gw.cells.length} water cells nearest it (its reading at the start: ${first[1].toFixed(2)} m)`;
      }
      out.obs = o.series; out.how = o.how; out.score = gaugeScore(o.series, gw.series.filter(([, z]) => Number.isFinite(z)));
      out.why = out.score ? '' : 'the model channel stayed dry there';
      out.levelShape = hydrographScore(o.series, gw.series); // the level over the whole storm, not only its peak
      await gaugeFlow(r, w, gw, out, t1);
    } catch (e) { out.why = 'gauge readings unavailable: ' + e.message; }
  }));
}
/**
 * The flow at a gauge over the whole storm: a control line drawn at the gauge (its `gauge` property: the USGS site)
 * against the gauge's discharge record (NWIS 00060). Fills out.flow = { line, obs, model: [[t (ms), m³/s]], score:
 * src/validate.js hydrographScore, why }. The line's own direction does not matter: the flow is counted downstream,
 * the way most of the storm's water crossed it.
 */
async function gaugeFlow(r, w, gw, out, t1) {
  const li = r.lines?.defs.findIndex(d => d.gauge != null && String(d.gauge) === String(gw.g.site)) ?? -1;
  if (li < 0) return;
  const sm = r.lines.samples[li], sign = Math.sign(sm.at(-1)?.[1] ?? 0) || 1;
  const model = CMP.hydrograph(sm).map(([t, q]) => [w.t0 + t * 1000, +(sign * q).toFixed(4)]);
  const obs = (await gaugeFlows(gw.g.site, w.t0 - 3600e3, t1 + 3600e3, fetcher).catch(() => [])).map(f => [f.t, +f.q.toFixed(4)]);
  const score = obs.length ? hydrographScore(obs, model) : null;
  out.flow = { line: r.lines.defs[li].name ?? 'the control line', obs, model, score, why: !obs.length ? 'the gauge has no discharge record over the storm' : score ? '' : 'the line and the record share too few hours',
    ...(r.lines.defs[li].endDepth ? { endDepthM: r.lines.defs[li].endDepth } : {}) };
}
/** A control line's two end cells on the fine grid (index, or null off the grid), to check afterwards that its ends stayed dry. */
function lineEnds(coords) {
  const f = model.fine, p = toCells(f, [coords[0], coords.at(-1)]);
  return p.map(([x, y]) => (x >= 0 && y >= 0 && x < f.nx && y < f.ny ? Math.floor(y) * f.nx + Math.floor(x) : null));
}
// ---- rain QA (src/rainqa.js): the storm's rain against the ASOS and CoCoRaHS gauges within 25 km of the site, over the
// storm's own hours, filled into rec.validation.rain.stations (so summary.json keeps it, and saved runs report it)
async function fillRainQA(r, v) {
  if (!v.rain || !r.storm?.t0) return;
  const [lon, lat] = model.site;
  try { v.rain.stations = await RQ.rainQA(r.storm, lon, lat, fetcher, { weights: MR.sampleWeights }); }
  catch (e) { console.warn('rain QA', e); v.rain.stations = { error: 'nearby gauges unavailable: ' + e.message, rows: [], summary: null }; }
}
// ---- end of rain QA
const hwmOf = (sc) => sc && { n: sc.n, bias: sc.bias, mae: sc.mae, rmse: sc.rmse, within15: sc.within15, calls: sc.calls, hits: sc.hits, misses: sc.misses, falseAlarms: sc.falseAlarms, skipped: sc.skipped ?? 0,
  points: sc.points.map(p => ({ name: p.name, lon: p.lon, lat: p.lat, kind: p.kind, observed: p.wse ?? p.depth ?? null, model: p.model ?? null, error: p.error ?? null, call: p.skip ?? p.call ?? null })) };
/**
 * River entries' cells, and the solver mask: a river entering across the domain edge has the edge closed across it and
 * its flow put in over the channel just inside (entryEdge), else the edge's free outfall sends much of it straight back
 * out; one entering inside the area takes the open cells around its entry point (entryCells). Entries with cells of
 * their own (a window's edge segments) keep them. → { entries (those with cells), mask (c.mask, or a copy with the closures) }
 */
function edgeEntries(c, entries, used) {
  let mask = c.mask;
  const out = entries.map(e => {
    if (e.cells || !e.at) return e;
    const ed = entryEdge(c, e.at, { used });
    if (!ed?.cells.length) return { ...e, cells: entryCells(c, e.at, { used }) };
    if (mask === c.mask) mask = c.mask.slice();
    for (const k of ed.closed) mask[k] = 0;
    return { ...e, cells: ed.cells, edgeWidth: ed.width };
  });
  return { entries: out.map(e => ({ ...e, cells: (e.cells ?? []).filter(k => mask[k]) })).filter(e => e.cells.length), mask };
}
/**
 * Baseflow warm-up: before the storm, the rivers run at their flow at the storm's start (the design base, or the
 * recorded flow then) for the set hours, with no rain, from the start levels; the storm run starts from that state, so
 * its peaks, times and books all start with the storm. Skipped in the subgrid speed mode and without river inflow.
 */
async function warmUp(r) {
  const hours = Number($('warmUp').value) || 0; r.warm = null;
  if (!(hours > 0) || !r.inflowReady?.length || r.c.sg || !device) return;
  const { c, F } = r, T = hours * 3600, t0 = performance.now();
  const { entries, mask } = edgeEntries(c, r.inflowReady.map(e => { const q0 = Math.max(0, typeof e.flow === 'function' ? e.flow(0) : e.flow); return { ...e, flow: () => q0 }; }), new Set());
  if (!entries.length) return;
  const storm = currentStorm(); let stageCells = stageEdgeCells(c, F, mask, storm); // the tide (or a river outlet) held at its level at the storm's start
  if (!stageCells) { r.outlet = outletFor(r, c, F, mask); stageCells = r.outlet?.cells; }
  const s = new GPUSolver(device, { nx: c.nx, ny: c.ny, dx: F, z: c.z, mask, manning: c.manning, inlets: entries.flatMap(e => e.cells), sink: c.inside?.map(v => 1 - v), stageCells,
    bc: { west: 'outflow', east: 'outflow', south: 'outflow', north: 'outflow' }, hdry: 1e-5, hfront: 1e-3, dtDry: 2 });
  if (stageCells?.length) s.setStage(stageAt(storm, 0));
  try {
    const start = startWater(c, F, stageCells), at = (x, y) => Math.min(c.ny - 1, Math.floor(y / F)) * c.nx + Math.min(c.nx - 1, Math.floor(x / F));
    s.setDepth((x, y) => Math.max(start ? start.depth[at(x, y)] : 0, c.bathyFill ? c.bathyFill[at(x, y)] : 0));
    const links = new InflowLinks(entries), hub = new LinkHub(s, [links], 2);
    while (s.t < T - 1e-6) { if (run !== r) return; await s.advance(Math.min(T, hub.tNext)); if (s.t >= hub.tNext - 1e-6) await hub.exchange(); }
    const st = await s.readState();
    r.warm = { hours, h: st.h, hu: st.hu, hv: st.hv, volumeIn: links.totals.volume };
    log(`Baseflow warm-up: ${hours} h of river base flow before the storm${stageCells?.length ? `, the ${r.outlet ? 'river outlet' : 'tide'} held at ${stageAt(storm, 0).toFixed(2)} m on ${stageCells.length} edge cells` : ''} (${Math.round(links.totals.volume).toLocaleString()} m³ in, ${((performance.now() - t0) / 1000).toFixed(1)} s)`, 'ok');
  } finally { s.destroy(); }
}
$('runBtn').onclick = async () => {
  if (model?.bathyJob) await model.bathyJob; // the channel (surveyed bathymetry is fetched) before the run is built
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
  if (run.pauseReq) { // a batch pausing: checkpoint, then stop without a record
    const r = run, done = r.pauseReq; r.pauseReq = null; await saveCheckpoint(r).catch(e => log('Checkpoint failed: ' + e.message, 'warn'));
    r.finish?.(new Error('Batch paused')); if (run === r) { stopRun(); resetRun(); } done(); return;
  }
  const s = run.solver, now = performance.now(), wall = Math.min(0.25, (now - run.lastWall) / 1000); run.lastWall = now;
  try {
    const Q = STEP_QUANTUM, atQ = Math.abs(s.t - Q * Math.round(s.t / Q)) < 1e-3, pace = speedMul();
    run.paceT = pace === Infinity ? null : Math.min((run.paceT ?? s.t) + pace * wall, s.t + pace * 0.5);
    if (ncHold(run)) run.paceT = Math.min(run.paceT ?? Infinity, (run.storm.radar.live.observedUntil - run.storm.t0) / 1000); // live: no further than the latest radar frame
    let tEnd = Math.min(tStop(), (Math.floor(s.t / Q + 1e-6) + 1) * Q);
    if (atQ && run.lines.faces.length && s.t > run.lines.samples[0].at(-1)[0] + 1e-6) { // control lines: cumulative volume on every quantum
      const L = await s.readLines(); if (!run || run.gen !== gen) return;
      run.lines.samples.forEach((sm, l) => sm.push([s.t, L.net[l], L.plus[l], L.minus[l]])); run.lines.last = L;
    }
    if (!atQ) { /* roof stages and the stage boundary switch on quanta only */ } else if (run.roofStages) { // new buildings' green roofs and cisterns (and the area's green roofs) fill one after another
      const depth = rainDepthTo(run.storm, s.t) / 1000; // m of rain so far (the hyetograph's: the solver's rain area changes as roofs fill)
      while (run.stage < run.roofStages.length && depth >= run.roofStages[run.stage].until) {
        const next = run.roofStages[++run.stage] ?? { rainField: run.c.rainField, roofArea: run.roof?.roofArea };
        setRainBase(run, s, next.rainField); if (run.coupler && next.roofArea) run.coupler.roofArea = next.roofArea;
        if (run.roofEarly && !run.greenFull && depth >= GI.greenRoofRetention) run.greenFull = s.t;
      }
    } else if (run.roofEarly && !run.greenFull && rainDepthTo(run.storm, s.t) / 1000 >= GI.greenRoofRetention) {
      run.greenFull = s.t; setRainBase(run, s, run.c.rainField); if (run.coupler && run.roof) run.coupler.roofArea = run.roof.roofArea;
    }
    const rr = rainAt(run.storm, s.t); // piecewise-constant hyetograph: never let a frame straddle a block change
    s.rainRate = rr.mmhr * MMHR; tEnd = Math.min(tEnd, rr.until);
    if (run.storm.radar) radarRainField(run, s); // radar rain: this block's pattern over the cells
    const stage = atQ ? stageAt(run.storm, s.t) : null; // observed water level on open-water edges, refreshed every quantum
    if (stage != null) { s.setStage(stage); if (run.coupler) run.coupler.stage = stage; }
    if (run.exchanger) tEnd = Math.min(tEnd, run.exchanger.tNext);          // stop exactly at each 1D–2D / culvert exchange
    if (run.watch) { const lv = run.watch.levels(s.t); if (lv && !run.winCrest) s.setCrestLevels(lv); tEnd = Math.min(tEnd, run.watch.next(s.t)); } // deployable barriers go up on time
    if (run.winCrest) windowCrests(s);
    const every = frameEvery(), frameDue = every > 0 && tEnd >= run.nextFrame - 1e-6;
    if (every > 0) tEnd = Math.min(tEnd, Math.max(run.nextFrame, s.t));       // and at each saved export frame
    const need = tEnd - s.t;
    // adaptive batch: aim for ~40 ms of GPU work per submit, but never queue steps past tEnd (they would be dt = 0 work)
    let K = Math.max(1, Math.min(run.K, s.dtAvg > 0 ? Math.ceil(need / s.dtAvg) + 2 : run.K)); // steps past tEnd would be dt = 0 work
    if (need <= 0) K = 0;
    if (run.paceT != null) { const allow = run.paceT - s.t; K = allow <= 0 ? 0 : Math.min(K, Math.max(1, Math.ceil(allow / (s.dtAvg || 1)))); } // the speed setting
    const t0 = s.t, c0 = performance.now();
    // full readback only to draw / save, at most every 150 ms, and on a large grid no more than about a fifth of the wall
    // time (Manayunk, 4.6M cells: a frame's readback and its passes over the cells took ~0.3 s, the run crawled at 0.7×)
    const wantOut = frameDue || s.t + need >= tStop() - 1e-3 || !run.out || now - run.lastOut > Math.max(150, 4 * (run.outCost ?? 0));
    const out = await s.frame(tEnd, K, wantOut);
    if (!run || run.gen !== gen) return;
    const ms = performance.now() - c0;
    if (K > 0 && K >= run.K) run.K = Math.max(1, Math.min(400, Math.round(run.K * Math.min(2, Math.max(0.5, 40 / Math.max(1, ms))))));
    if (run.exchanger && s.t >= run.exchanger.tNext - 1e-6) { await run.exchanger.exchange(); if (run.coupler) drawNetworkState(); }
    run.t = s.t; radarClock(run);
    if (atQ && projects.current && performance.now() - (run.lastCkpt ??= performance.now()) > ckEveryMs() && s.t < tStop() - 60) { run.lastCkpt = performance.now(); await saveCheckpoint(run).catch(e => log('Checkpoint failed: ' + e.message, 'warn')); if (!run || run.gen !== gen) return; }
    if (wall > 0) run.rtf = run.rtf ? 0.9 * run.rtf + 0.1 * ((s.t - t0) / wall) : (s.t - t0) / wall;
    if (out) {
      run.out = out; run.lastOut = now; const b0 = performance.now();
      const N = run.c.nx * run.c.ny;
      // peak depth: the solver's own, tracked every step (readMassNow); a frame is read right after the inlet exchange, so
      // its depths at exchange cells hold one step's lump of returned water and would make the peak depend on when frames
      // happen to be read. The subgrid mode tracks the peak level instead, so its live view still takes the frames.
      const sgMax = !!run.c.sg;
      for (let k = 0; k < N; k++) { const h = out[2 * k], v = out[2 * k + 1]; if (sgMax && h > run.hmax[k]) run.hmax[k] = h; if (h > 0.01 && v > run.smax[k]) run.smax[k] = v; }
      saveFrame(out);
      if (run.gaugeWatch && s.t >= run.gaugeWatch.next) recordGauges(run, out, s.t);
      if (run.watch) { run.watch.books(s.t, await s.readBarriers()); if (!run || run.gen !== gen) return; }
      if (!document.hidden) drawDepth(); // keep solving in the background; draw only when someone can see it
      run.outCost = ms + performance.now() - b0;
      // the books and exact peak depths: every 2.5 s, or less often where a full read costs more (≤ ~10 % of the wall time)
      if (now - run.lastRead > Math.max(2500, 10 * (run.readCost ?? 0))) {
        run.lastRead = now; const r0 = performance.now(); await readMass(); if (!run || run.gen !== gen) return; run.readCost = performance.now() - r0;
      }
      readouts();
    }
    if (s.t >= tStop() - 1e-3) {
      run.playing = false; $('runBtn').textContent = 'Done'; $('runBtn').disabled = true; await readMass();
      if (run.swmm) {
        run.swmmReport = run.swmm.finish(); run.swmmClosed = true; run.netMass = SWMM.continuity(run.swmmReport);
        // combined books: rain − infiltration − edge outflow − pipe outfalls − (surface + network storage), over rain
        // SWMM's external outflow is the outfalls plus any water sent back up through inlets (negative lateral flow)
        // what left through outfalls: SWMM's outflow less what came back up through inlets and what outfalls inside the model put back on the ground
        const c = run.netMass, m = run.mass, outfalls = c.externalOutflow * 1000 - run.coupler.totals.latOut - run.coupler.totals.outfallReturned;
        const rain = m.rain + run.coupler.totals.roofToSewer; // rain on the surface + rain piped straight from roofs
        // + river inflow and the water on the ground at the start; underdrains: GI water the books count as infiltrated that
        // went into the pipes; outlets off the model. Over all the water that came in (as the surface books)
        // + sanitary flow and the water it starts the pipes with (combined sewers)
        const initial = run.solver.vol.initial + (c.initialStored ?? 0) * 1000, inflowV = (run.inflow?.totals.volume ?? 0) + (c.dryWeatherInflow ?? 0) * 1000;
        run.netMass.combinedRel = (initial + rain + inflowV + (run.underdrains?.totals.underdrain ?? 0) - (run.outlets?.totals.offsite ?? 0) - m.infil - m.outflow - outfalls - m.volume - c.finalStored * 1000) / Math.max(1e-30, initial + rain + inflowV + Math.max(0, -m.outflow));
      }
      readouts(); run.wall = (performance.now() - run.wall0) / 1000;
      if (S.obs.length) scoreAndShow();
      const done = run; await finishRecord();
      if (!done.emu && !done.batchJob) await projects.runFinished(); done.finish?.(); // filed before anyone (Run both) starts the next run; emulator runs save themselves
    }
  } catch (e) {
    console.error(e); run.playing = false; log('Solver error: ' + e.message, 'err'); run.finish?.(e); return;
  }
  nextTick(() => loop(gen));
}

// ------------------------------------------------------------------ run records (comparisons)
const records = [], baselines = new Map(); // this session's finished runs; existing-conditions runs by forcing hash
/** Everything that is not the design (src/compare.js fingerprint): two runs compare when this matches, or as a settings
 *  test when only drainSettings (the inlet and pipe solver settings) differs and the design is the same. */
function forcingRecord(r) {
  const st = r.storm ?? currentStorm(), sample = (fn) => { const out = []; for (let t = 0; t <= tStop(); t += 60) out.push(+fn(t).toFixed(6)); return out; };
  const val = (...ids) => Object.fromEntries(ids.map(id => [id, $(id)?.type === 'checkbox' ? $(id).checked : $(id)?.value ?? null]));
  return {
    storm: st ? { ...stormMeta(st), waterLevel: undefined, depth: st.depth, t0: st.t0 ?? null } : null,
    inflow: (r.inflowReady ?? []).map(e => ({ label: e.label, site: e.site ?? null, at: e.at, flow: typeof e.flow === 'function' ? sample(e.flow) : e.flow, ...(e.scale != null && e.scale !== 1 ? { scale: e.scale } : {}), ...(e.ungauged ? { ungauged: e.ungauged } : {}) })),
    tide: st?.wl ? { station: st.wl.station, t: st.wl.t, v: st.wl.v, edges: st.wl.design ? true : $('tCoast').checked, ...(st.wl.design ? { design: st.wl.design } : {}), ...(st.wl.slr ? { slr: st.wl.slr } : {}), ...(st.wl.observedUntil ? { observedUntil: st.wl.observedUntil, surge: st.wl.surge } : {}), ...(emu?.tide ? { offset: emu.tide } : {}) } : null,
    startLevels: { mode: $('startWater').value, readings: r.levelsReady ? [...r.levelsReady.lv].map(([site, v]) => [site, v]) : null },
    outlet: r.outletReady ? { site: r.outletReady.g.site, length: Number($('outLen').value) || null, readings: r.outletReady.level.length, flows: r.outletReady.flow.length,
      reach: r.outletReady.reach ? { sections: r.outletReady.reach.sections.length, km: r.outletReady.reach.length / 1000, depth: r.outletReady.reach.depth } : 'prismatic' } : null,
    antecedent: { ...val('infilModel', 'wetness', 'wtDepth'), ...(emu?.se != null && Math.abs(emu.se - WETNESS[$('wetness').value]) > 1e-9 ? { se: emu.se } : {}) },
    grid: { solver: $('dxSel').value, F: r.F },
    solver: { hdry: 1e-5, hfront: 1e-3, dtDry: 2, quantum: STEP_QUANTUM },
    runLength: { stop: tStop(), ...(r.warm ? { warmUpH: r.warm.hours } : {}) },
    options: { sediment: !!r.sed, debris: !!r.debris, ...val('topsoil'), banks: !!r.banks },
    drainage: { src: drainSrc, ...linkedPart(), ...val('designAri', 'spacing', 'downspout', 'roof', 'lumpRate', 'giPave', 'giGarden', 'giRoof', 'giTank', 'twoWay', 'csoOn', 'csoDwf', 'csoCap', 'csoPerCap', 'csoDensity', 'csoGates', 'csoIet'), infra: CMP.hashOf(infra.layer), linked: linkedLinks(), cal: cal() },
    drainSettings: drainSettings(),
    utilityData: utilityData(),
    area: { box: S.area, poly: S.poly, curb: model.curb, curbSel: $('curbSel').value, ...(model.bathy ? { bathy: model.bathy.curve, bathyVol: Math.round(model.bathy.volume), ...(model.bathy.surveyed ? { bathySurveyed: { source: 'NOAA BlueTopo', tiles: model.bathy.surveyed.tiles, volume: Math.round(model.bathy.surveyed.volume) } } : {}), ...(model.bathy.xs ? { bathyXS: { source: model.bathy.xs.source, volume: Math.round(model.bathy.xs.volume) } } : {}) } : {}) },
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
  // the peak is never below the end. Coarser than 1 m, each grid is downscaled on its own, interpolating the level over
  // the wet neighbours only: a neighbour wet at its peak (a film on higher ground) but dry at the end pulls a 1 m low
  // spot's peak under its final depth (a gutter at 4 cm peak and 11 cm final on a 2 m test run, and a building's damage
  // hanging on which neighbour got a film)
  for (let k = 0; k < Nf; k++) if (finD[k] > maxD[k]) maxD[k] = finD[k];
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
  // the deepest water each control line's ends saw: water at an end means flow could pass around the line, uncounted
  for (const d of r.lines.defs) if (d.ends) d.endDepth = d.ends.map(k => (k == null || wall(k) ? null : +(maxD[k] ?? 0).toFixed(3)));
  const allLines = r.lines.defs.map((d, l) => ({ id: d.id, name: d.name, side: d.side, ...(d.gauge ? { gauge: d.gauge } : {}), ...(d.endDepth ? { endDepth: d.endDepth } : {}), faces: d.faces, volume: L ? L.net[l] : NaN, plus: L ? L.plus[l] : NaN, minus: L ? L.minus[l] : NaN, series: r.lines.samples[l] }));
  const isWin = (l) => String(l.id).startsWith('win:'), lines = allLines.filter(l => !isWin(l)), winLines = allLines.filter(isWin);
  const m = r.mass ?? {}, outfalls = r.swmm && r.netMass ? r.netMass.externalOutflow * 1000 - (r.coupler?.totals.latOut ?? 0) - (r.coupler?.totals.outfallReturned ?? 0) : null;
  const ponds = r.outlets?.results() ?? [];
  if (ponds.length) design.setPondResults(ponds);
  const outletLog = new Map((model.design?.log.features ?? []).filter(l => l.type === 'outlet').map(l => [l.id, l.resolved]));
  for (const p of ponds) p.stageStorage = outletLog.get(p.id)?.stageStorage ?? null; // for the stage–storage–discharge table
  const books = reportBooks(r, maxD);
  const newBuildings = (model.f.designBuildings ?? []).map(b => ({ id: b.id, name: b.name, ffe: b.ffe, critical: b.foundation === 'basement' ? b.opening : b.ffe, foundation: b.foundation, cells: b.cells, ring: b.ring }));
  const when = new Date(), forcing = CMP.fingerprint(forcingRecord(r));
  const rec = { id: ++recordSeq, scenario: r.scenario, drainSettings: drainSettings(), label: `${r.scenario ?? 'Existing conditions'} · ${$('stormTag').textContent || 'storm'} · ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    saved: when.toISOString(), forcing, commit: appCommit, ...(appChanged.length ? { codeChanged: appChanged } : {}), designHash: gridHash(), storm: stormLabel(r.storm), stormInfo: { ari: r.storm?.ari ?? null, durationMin: r.storm?.durationMin ?? null }, batch: r.batchInfo ?? null, geo: { nx: W, ny: fine.ny, x0: fine.x0, y0: fine.y1 - fine.ny * fine.dx, dx: fine.dx },
    grids, hazard, lines, newBuildings, ponds, network: books.network, hgl: books.hgl, inlets: books.inlets, ground: r.scenario ? Float32Array.from(model.f.z) : null, books: { rain: m.rain, inflow: r.inflow?.totals.volume ?? 0, infil: m.infil, outflow: m.outflow, outfalls, stored: m.volume, underdrain: r.underdrains?.totals.underdrain ?? 0, outletsOffsite: r.outlets?.totals.offsite ?? 0,
      // the rest of the combined books (line ~1842): rain piped from roofs straight to the sewers (not in `rain`, the rain on the surface), sanitary flow, water at the start, the pipes' storage
      roofs: r.coupler?.totals.roofToSewer ?? 0, sanitary: (r.netMass?.dryWeatherInflow ?? 0) * 1000, initial: s.vol?.initial ?? 0, pipesStart: (r.netMass?.initialStored ?? 0) * 1000, pipesEnd: (r.netMass?.finalStored ?? 0) * 1000 }, design: model.design ? { name: model.design.name, totals: model.design.log.totals } : null };
  rec.wall = r.wall; rec.simulatedS = s.t; rec.tide = tideRec(r);
  rec.inflow = inflowRecord(r); // river inflow hydrographs for the report (ungauged inflows block)
  if (r.gaugeWatch && r.out && r.gaugeWatch.gauges[0].series.at(-1)?.[0] < r.gaugeWatch.t0 + s.t * 1000 - 1) recordGauges(r, r.out, s.t); // the last moment too
  if (r.cso) rec.cso = csoRecord(r, books.hgl, s.t);
  rec.validation = validationOf(r, rec);
  await Promise.race([Promise.all([fillGauges(r, rec.validation), fillRainQA(r, rec.validation)]), new Promise(res => setTimeout(res, 20000))]); // gauge readings and nearby rain gauges, at most 20 s
  if (run !== r) return;
  if (r.window?.mode === 'record') rec.window = { rect: r.window.rect, segs: winLines, inlets: books.hgl?.inletSeries ? { fineCells: (books.inlets ?? []).map(g => g.fineCell), series: books.hgl.inletSeries } : null };
  if (r.window?.mode === 'rerun') { // inside the window this run, outside it the existing run: compares like a full run
    const base = r.window.base, inside = WIN.fineInside(r.window.rect, fine.nx, fine.ny, F), check = WIN.checkWindow(base.window.segs, winLines);
    Object.assign(rec, { grids: WIN.mergeGrids(base.grids, rec.grids, inside), hazard: WIN.mergeGrids({ h: base.hazard }, { h: rec.hazard }, inside).h, forcing: base.forcing, books: null,
      label: 'WINDOW ' + rec.label, windowRun: { rect: r.window.rect, check, wall: r.wall, baseWall: base.wall ?? null, insideFrac: inside.reduce((a, v) => a + v, 0) / inside.length } });
    log(`Window rerun: ${(rec.windowRun.insideFrac * 100).toFixed(0)} % of the area in ${r.wall?.toFixed(0)} s${base.wall ? ` (the full existing run took ${base.wall.toFixed(0)} s)` : ''}; edge check: ${check.changed ? `${check.changed} segment${check.changed > 1 ? 's' : ''} changed by up to ${(check.maxRel * 100).toFixed(0)} % — widen the window` : `outflow at the edge within ${(check.maxRel * 100).toFixed(1)} % of the existing run`}`, check.changed ? 'warn' : 'ok');
  }
  r.record = rec; records.push(rec);
  // the existing-conditions cache (a window rerun of existing conditions, a self-check, is never the baseline)
  if (!rec.scenario && !rec.windowRun) { baselines.set(forcing.hash, rec); model.baseWse = grids.max_wse; if (baselines.size > 3) baselines.delete(baselines.keys().next().value); }
  while (records.length > 6) { const i = records.findIndex(x => ![...baselines.values()].includes(x)); records.splice(i < 0 ? 0 : i, 1); }
  design.setLineResults(new Map(lines.map(l => { const st = CMP.lineStats(l); return [l.id, { volume: l.volume, plus: l.plus, minus: l.minus, peak: st.peak, tPeak: st.tPeak }]; })));
  if (rec.scenario) {
    const fl = floodedBuildings(model.f, grids.max_wse); r.flooded = fl; design.setResults(fl);
    if (fl.some(b => b.flooded)) log(`${fl.filter(b => b.flooded).length} of ${fl.length} new buildings flooded above the FFE (${r.scenario})`, 'warn');
  }
  compareUI.refresh(); reportUI.refresh();
}
let recordSeq = 0;
/**
 * What the report needs from the storm sewer (src/report.js): the network's geometry (nodes with lon/lat, rim and
 * invert; pipes with their end inverts), the coupler's books (max HGL per node, pipe peaks, outfall series) and per
 * inlet its books plus the gutter spread from the run's max depth (1 m) across the nearest street.
 */
function reportBooks(r, maxD) {
  const net = r.net; if (!net) return { network: null, hgl: null, inlets: null };
  const fine = model.fine, geo = { nx: fine.nx, ny: fine.ny, dx: fine.dx }, cellLL = (k) => fromUTM(fine.x0 + ((k % fine.nx) + 0.5) * fine.dx, fine.y1 - (((k / fine.nx) | 0) + 0.5) * fine.dx, fine.zone);
  const network = {
    nodes: net.nodes.map((n, i) => ({ name: n.name ?? 'N' + i, ll: nodeLL(n), p: n.p, ground: n.ground, invert: n.invert, outfall: !!n.outfall, offsite: !!n.offsite, storage: !!n.storage })),
    pipes: net.pipes.map(q => ({ from: q.from, to: q.to, L: q.L ?? q.length ?? Math.hypot(net.nodes[q.to].p[0] - net.nodes[q.from].p[0], net.nodes[q.to].p[1] - net.nodes[q.from].p[1]) * fine.dx, D: q.D, W: q.W ?? null,
      invUp: net.nodes[q.from].invert + (q.inOffset ?? 0), invDown: net.nodes[q.to].invert + (q.outOffset ?? 0), offsite: !!q.offsite, storageLink: !!q.storageLink })),
  };
  const hgl = r.coupler?.report() ?? null;
  const roads = model.roadCells ??= (model.osm.roads ?? []).map(rd => toCells(fine, rd.line));
  const inlets = (net.inlets ?? []).map((g, m) => {
    const k = g.fineCell, col = k % fine.nx, row = (k / fine.nx) | 0, sp = maxD ? REP.gutterSpread(maxD, geo, [col + 0.5, row + 0.5], roads) : null;
    return { node: g.node, fineCell: k, ll: cellLL(k), grates: g.grates, ...(hgl?.inlets[m] ?? {}), spread: sp?.spread ?? null, full: !!sp?.full, gutterDepth: sp?.gutterDepth ?? maxD?.[k] ?? null, toCentre: sp?.toCentre ?? null };
  });
  return { network, hgl, inlets };
}
/** A record from a saved run folder (summary.json, grids/*.f32, lines.json, buildings.json). */
async function loadSaved(dir) {
  const folder = projects.current?.folder; if (!folder) throw new Error('no project open');
  const path = (p) => `runs/${dir}/${p}`, sm = JSON.parse(await readProjectFile(folder, path('summary.json')));
  if (!sm.grids) throw new Error(`run ${dir} was saved without 1 m grids`);
  const head = CMP.parseHeader(await readProjectFile(folder, path('grids/max_depth.hdr'))), grids = {};
  await Promise.all([...Object.keys(CMP.GRIDS), 'hazard_arr'].map(async k => { grids[k] = CMP.decodeF32(await readBytes(folder, path(`grids/${k}.f32`))); }));
  const json = async (p, d) => { try { const t = await readOptional(folder, path(p)); return t == null ? d : JSON.parse(t); } catch { return d; } };
  const lines = await json('lines.json', []), newBuildings = await json('buildings.json', []);
  const [network, hgl, inlets] = await Promise.all([json('network.json', null), json('hgl.json', null), json('inlets.json', null)]);
  const gb = await readBytesOptional(folder, path('grids/ground.f32')).catch(() => null), ground = gb ? CMP.decodeF32(gb) : null; // none: the base DEM (only emulator runs save it)
  return { id: 'saved:' + dir, scenario: sm.scenario === 'Existing conditions' ? null : sm.scenario, label: `${sm.scenario} · ${dir}`, saved: sm.savedUTC, forcing: sm.forcing, drainSettings: sm.drainSettings ?? null, commit: sm.commit, designHash: sm.designHash,
    storm: sm.storm?.label, stormInfo: { ari: sm.storm?.ari ?? null, durationMin: sm.storm?.durationMin ?? null }, batch: sm.batch ?? null, dir, geo: head, grids: Object.fromEntries(Object.keys(CMP.GRIDS).map(k => [k, grids[k]])), hazard: grids.hazard_arr, lines, newBuildings, books: sm.books ?? null, design: sm.design ?? null,
    ponds: sm.ponds ?? null, cso: sm.cso ?? null, network, hgl, inlets, ground, validation: sm.validation ?? null, simulatedS: sm.results?.simulatedS ?? null, inflow: sm.inflow ?? null, tide: sm.tide ?? null };
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
    pairPrep = { levelsReady: run.levelsReady, inflowReady: run.inflowReady, outletReady: run.outletReady };
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
/** A window rerun's edge (run.winCrest): each segment shut or open by the existing run's flow across it now; the
 *  barriers' own crests first. Sets the solver's crests only when something changed. */
function windowCrests(s) {
  const W = run.winCrest, t = s.t + 1, state = W.rates.map(r => (r.in(t) > r.out(t) ? 1 : 0)), key = state.join('') + (run.watch?._lv ?? []).join(',');
  if (key === W.key) return; W.key = key;
  s.setCrestLevels([...(run.watch?._lv ?? []), ...W.seg.map(q => (state[q] ? 1e6 : -Infinity))]);
}
/**
 * Window rerun (src/window.js): existing conditions over the whole model, booking the flow across a window around the
 * site (unless a run with the same forcing and window is cached), then the active scenario on the window only, its
 * edges fed from it. bufferM: the window's margin around the site boundary (else the design's features). → [before, after]
 */
async function runWindowPair(note, bufferM = 150, { self = false } = {}) { // self: existing conditions again in the window (the window's own error)
  if (!model || !device) throw new Error('Build a model first.');
  const sc = design.active; if (!sc || !sc.design.features.length) throw new Error('Pick a proposed scenario with features first (Site design).');
  const F = gridF(), site = design.analysis.features.find(f => f.properties.type === 'site');
  const pts = site ? site.geometry.coordinates[0] : sc.design.features.flatMap(f => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'LineString' ? f.geometry.coordinates : [f.geometry.coordinates]));
  const cells = pts.map(p => llCell(p)).map(([x, y]) => [x / F, y / F]), xs = cells.map(p => p[0]), ys = cells.map(p => p[1]);
  const nx = Math.round(model.fine.nx / F), ny = Math.round(model.fine.ny / F), rect = WIN.windowRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], bufferM / (F * model.fine.dx), nx, ny);
  const same = (a, b) => a && a.i0 === b.i0 && a.j0 === b.j0 && a.i1 === b.i1 && a.j1 === b.j1;
  const speed = $('speed').value; $('speed').value = 100; $('speed').dispatchEvent(new Event('input'));
  const toEnd = async (label) => { note(`Running ${label}…`); ensureSolver(); run.playing = true; $('runBtn').textContent = 'Pause'; run.lastWall = performance.now(); run.wall0 ??= run.lastWall; loop(run.gen); const e = await run.done; if (e) throw e; return run.record; };
  try {
    design.activate(null); applyScenario(); drawDesign(); windowNext = { mode: 'record', rect }; resetRun(); windowNext = null;
    if (!(await prepareRun(run))) throw new Error('the run was replaced');
    pairPrep = { levelsReady: run.levelsReady, inflowReady: run.inflowReady, outletReady: run.outletReady };
    const fp = CMP.fingerprint(forcingRecord(run)).hash, cached = [...records].reverse().find(x => !x.scenario && x.forcing?.hash === fp && same(x.window?.rect, rect));
    const before = cached ?? await toEnd('existing conditions (booking the window’s edge)');
    if (cached) note('Existing conditions with these settings and this window already ran: reusing it.');
    design.activate(self ? null : sc.name); applyScenario(); drawDesign(); windowNext = { mode: 'rerun', rect, base: before }; resetRun(); windowNext = null;
    if (!(await prepareRun(run))) throw new Error('the run was replaced');
    const after = await toEnd(`${self ? 'existing conditions' : sc.name} in the window`);
    const w = after.windowRun;
    note(`Done: ${sc.name} on ${(w.insideFrac * 100).toFixed(0)} % of the area in ${w.wall?.toFixed(0)} s${w.baseWall ? ` (full run ${w.baseWall.toFixed(0)} s)` : ''}. Edge check: ${w.check.changed ? `${w.check.changed} segment(s) changed by up to ${(w.check.maxRel * 100).toFixed(0)} % — widen the window` : 'unchanged at the edge'}.`);
    return [before, after];
  } finally { pairPrep = null; windowNext = null; $('speed').value = speed; $('speed').dispatchEvent(new Event('input')); }
}
/**
 * Return-period sweep: paired runs (existing conditions from the cache when it already ran with the same forcing) over
 * the design storms `aris`, one after another in this page; `cancelled()` is checked between runs and the current run
 * stops at once on cancelSweep(). Calls `each({ ari, before, after })` after each pair. The storm's return period is
 * put back afterwards. → [{ ari, before, after }]
 */
async function runSweep(aris, note, each) {
  if (stormSrc !== 'a14') throw new Error('The sweep varies the design storm’s return period: pick Atlas 14 design (or the site-record design) under Storm.');
  const ari0 = $('ari').value, out = []; sweep.cancel = false;
  try {
    for (const ari of aris) {
      if (sweep.cancel) break;
      if (![...$('ari').options].some(o => o.value === String(ari))) { note(`${ari}-yr is not a design storm here: skipped`); continue; }
      $('ari').value = String(ari); updateStorm();
      const [before, after] = await runPair((t) => note(`${ari}-yr (${out.length + 1} of ${aris.length}): ${t}`));
      out.push({ ari, before, after }); each?.(out.at(-1));
    }
  } finally { $('ari').value = ari0; updateStorm(); sweep.running = false; }
  return out;
}
const sweep = { cancel: false, running: false };
/** Stop a sweep now: the run in progress ends (unfinished, not recorded) and no further run starts. */
function cancelSweep() { sweep.cancel = true; if (run && !run.record) { const r = run; r.finish?.(new Error('Sweep cancelled')); stopRun(); resetRun(); } }
// ------------------------------------------------------------------ checkpoints (src/checkpoint.js)
// A run under way is copied into the project (runs/_checkpoint/) every few minutes of wall-clock time: the solver's
// buffers, SWMM's memory and the run's own books. Resume rebuilds the run from the same settings (the forcing
// fingerprint must match) and puts the copy back, so a reload, a crash or a headless batch carries on where it stopped.
const CK_DIR = 'runs/_checkpoint';
// not copied: the grid and inputs (rebuilt from the same settings), the solver and SWMM (copied separately), the
// export frames (too large: the animation restarts at the resume), and this page's clocks and handles
const RUN_SKIP = new Set(['solver', 'c', 'startDepth', 'net', 'sw', 'storm', 'inflowReady', 'inflowRaw', 'levelsReady', 'levelSrc', 'view', 'frames', 'done', 'finish', 'record', 'gen', 'playing',
  'lastWall', 'wall0', 'paceT', 'lastOut', 'lastRead', 'lastDraw', 'lastHz', 'lastCkpt', 'massWarned', 'pauseReq', 'swmm', 'window', 'batchJob', 'batchInfo', 'emu']);
const ckEveryMs = () => Number($('ckEvery')?.value ?? 10) * 60e3;
const fmtClock = (t) => `${Math.floor(t / 3600)}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}`;
async function saveCheckpoint(r) {
  const folder = projects.current?.folder; if (!folder || !r.solver || r.record) return null;
  const c0 = performance.now(), s = r.solver, gpu = await CK.gpuSnapshot(s);
  if (run !== r) return null;
  const meta = { v: 1, t: s.t, savedUTC: new Date().toISOString(), forcing: CMP.fingerprint(forcingRecord(r)).hash, scenario: r.scenario ?? null, job: r.batchJob ?? null,
    wall: (performance.now() - (r.wall0 ?? performance.now())) / 1000, commit: appCommit, label: $('stormTag').textContent };
  const parts = { meta, ...Object.fromEntries(Object.entries(gpu).map(([k, v]) => ['gpu:' + k, v])), ...CK.stateParts('solver', CK.solverState(s)), ...CK.stateParts('run', CK.captureState(r, { skip: RUN_SKIP })) };
  if (r.swmm && !r.swmmClosed) {
    const sw = CK.swmmSnapshot(r.swmm); parts['swmm:mem'] = sw.memory; parts.swmm = { streams: sw.streams, t: sw.t, files: Object.keys(sw.files) };
    for (const [f, b] of Object.entries(sw.files)) parts['swmm:file:' + f] = b;
  }
  const bytes = await CK.pack(parts);
  await writeProjectFile(folder, CK_DIR + '/state.ckpt', bytes);
  await writeProjectFile(folder, CK_DIR + '/meta.json', JSON.stringify({ ...meta, bytes: bytes.length }));
  r.lastCkpt = performance.now();
  log(`Checkpoint at ${fmtClock(s.t)} of the run: ${(bytes.length / 1e6).toFixed(0)} MB in ${((performance.now() - c0) / 1000).toFixed(1)} s`, 'ok');
  return meta;
}
async function checkpointMeta() {
  const folder = projects.current?.folder; if (!folder) return null;
  try { const t = await readOptional(folder, CK_DIR + '/meta.json'), m = t && JSON.parse(t); return m?.forcing ? m : null; } catch { return null; }
}
async function clearCheckpoint() {
  const folder = projects.current?.folder; if (!folder) return;
  await writeProjectFile(folder, CK_DIR + '/meta.json', JSON.stringify({ cleared: new Date().toISOString() })).catch(() => {});
  await writeProjectFile(folder, CK_DIR + '/state.ckpt', new Uint8Array(0)).catch(() => {});
}
/**
 * Resume the checkpointed run: the run must already be set up from the same settings (resetRun, prepareRun); the solver
 * is built, then the copy goes back in. Throws when the settings differ from the checkpoint's.
 */
async function resumeCheckpoint(r) {
  const folder = projects.current?.folder; if (!folder) throw new Error('no project open');
  const meta = await checkpointMeta(); if (!meta) throw new Error('no checkpoint in this project');
  ensureSolver(); const s = r.solver;
  const fp = CMP.fingerprint(forcingRecord(r)).hash;
  if (fp !== meta.forcing) throw new Error(`the checkpoint is of a run with different settings (forcing ${meta.forcing}, now ${fp}): set them back or start afresh`);
  const P = await CK.unpack(await readBytes(folder, CK_DIR + '/state.ckpt')); if (run !== r) return null;
  CK.gpuRestore(s, Object.fromEntries(Object.keys(P).filter(k => k.startsWith('gpu:')).map(k => [k.slice(4), new Uint8Array(P[k].buffer, P[k].byteOffset, P[k].byteLength)])));
  const sv = CK.partsState('solver', P); CK.applyState(s, sv.tree, sv.blobs);
  const rv = CK.partsState('run', P); CK.applyState(r, rv.tree, rv.blobs);
  if (P.swmm && r.swmm) CK.swmmRestore(r.swmm, { memory: P['swmm:mem'], streams: P.swmm.streams, t: P.swmm.t, files: Object.fromEntries(P.swmm.files.map(f => [f, P['swmm:file:' + f]])) });
  r.wall0 = performance.now() - meta.wall * 1000; r.lastCkpt = performance.now(); r.resumedAt = meta.t;
  r.nextFrame = Math.max(r.nextFrame ?? 0, s.t);
  log(`Resumed at ${fmtClock(s.t)} of the run (checkpoint of ${new Date(meta.savedUTC).toLocaleString()})`, 'ok');
  return meta;
}
/** Start (or carry on) the current run to its end at full speed. → the record */
async function runToEnd(note, label) {
  note?.(`Running ${label}…`); ensureSolver(); run.playing = true; $('runBtn').textContent = 'Pause'; run.lastWall = performance.now(); run.wall0 ??= run.lastWall; loop(run.gen);
  const e = await run.done; if (e) throw e; return run.record;
}
/** Put a batch job's inputs on the page (storm source, fields, scenario). */
function applyJob(job, base) {
  if (job.storm.stormSrc && job.storm.stormSrc !== 'current') setStormSource(job.storm.stormSrc);
  const coarser = { 1: '2', 2: '4', 4: '8s', '4s': '8s', '8s': '8s' };
  const inputs = { ...(base ?? {}), ...job.storm.inputs, ...job.variant.inputs, ...(job.variant.coarser ? { dxSel: coarser[base?.dxSel ?? $('dxSel').value] } : {}) };
  for (const [id, v] of Object.entries(inputs)) { const el = $(id); if (!el) continue; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new Event('input')); }
  updateStorm(); design.activate(job.scenario ?? null); applyScenario(); drawDesign();
}
/**
 * One batch job, start to finish (or from the project's checkpoint when it is this job's): its inputs on top of the
 * study's base inputs, the run, the run filed in the project. → { dir, record }
 */
async function runJob(job, note, { resume = false, base = null } = {}) {
  if (!model || !device) throw new Error('Build a model first.');
  const speed = $('speed').value; $('speed').value = 100; $('speed').dispatchEvent(new Event('input'));
  try {
    applyJob(job, base); resetRun();
    if (!(await prepareRun(run))) throw new Error('the run was replaced');
    run.batchJob = job.id; run.batchInfo = { job: job.id, label: job.label, storm: job.storm.label, variant: job.variant.key, variantLabel: job.variant.label, scenario: job.scenario ?? null };
    if (resume) { const m = await checkpointMeta(); if (m?.job === job.id) { note?.(`${job.label}: resuming at ${fmtClock(m.t)}…`); await resumeCheckpoint(run); } }
    const rec = await runToEnd(note, job.label);
    const dir = await projects.saveRun(job.label);
    await clearCheckpoint();
    return { dir: dir?.replace(/^runs\//, '') ?? null, record: rec };
  } finally { $('speed').value = speed; $('speed').dispatchEvent(new Event('input')); }
}
const batchUI = initBatch({
  scenarios: () => design.scenarios.map(sc => sc.name), aris: () => [...$('ari').options].map(o => Number(o.value)), durations: () => [...$('a14dur').options].map(o => ({ value: Number(o.value), label: o.textContent })),
  project: () => projects.current, readText: (p) => readProjectFile(projects.current.folder, p), writeFile: (p, d) => writeProjectFile(projects.current.folder, p, d),
  runJob, checkpointMeta, inputs: () => ({ dxSel: $('dxSel').value, ari: $('ari').value, a14dur: $('a14dur').value, calManning: $('calManning').value, calInfil: $('calInfil').value, uplift: $('uplift').value,
    ...Object.fromEntries(['dtMode', 'dtPhase', 'dtDate', 'dtSurge', 'dtSurgeM', 'slrScen', 'slrYear', 'slrHist'].map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])) }),
  extraVariants: cmpdVariants, extraStorms: () => [...cmpdStorms(), ...ncStorms()], // compound flooding: SLR variants, joint design pairs; the nowcast's dry / middle / wet members
  stormSrc: () => stormSrc, ready: () => !!(model && device), log,
  // pause at the next frame boundary: a checkpoint first, then the run stops (unrecorded) and resumes from it later
  pause: () => new Promise((res) => { if (!run?.playing || run.record) { res(); return; } run.pauseReq = res; }),
});

const compareUI = initCompare(map, {
  records: () => [...records].reverse(), savedRuns, loadSaved, runPair, runWindowPair, units: () => design.units,
  runSweep: (aris, note, each) => { sweep.running = true; return runSweep(aris, note, each); }, cancelSweep, detentionTable,
  ctx: () => model && { geo: { nx: model.fine.nx, ny: model.fine.ny, x0: model.fine.x0, y0: model.fine.y1 - model.fine.ny * model.fine.dx, dx: model.fine.dx },
    z: model.base.z, bld: model.base.bld, toCell: llCell, prj: utmPRJ(model.fine.zone),
    siteRing: design.analysis.features.find(f => f.properties.type === 'site')?.geometry.coordinates[0] ?? null },
  setOverlay: (canvas, visible) => { if (model) setCanvasLayer('cmp', canvas, model.fine.corners(), 'area-line', visible, 0.9); },
  async exportFiles(files, name, bytes, type = 'application/zip') {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name + (type === 'text/csv' ? '.csv' : '.zip'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (projects.current) { const dir = `comparisons/${stamp()}_${name.slice(0, 40)}`; for (const f of files) await writeProjectFile(projects.current.folder, `${dir}/${f.name}`, f.data); }
  },
});
// ------------------------------------------------------------------ emulator (src/emulator.js, app/emulator-ui.js)
/** A storm with every depth and intensity × f (an emulator run's rain depth factor). */
function scaleStorm(st, f) {
  const x = (a) => (Array.isArray(a) ? a.map(v => v * f) : a);
  return { ...st, depth: x(st.depth), intensity: x(st.intensity), total: st.total * f, peakIntensity: st.peakIntensity * f, factor: (st.factor ?? 1) * f };
}
const scaleInflow = (entries, k) => (entries ?? []).map(e => ({ ...e, label: `${e.label} × ${k.toFixed(3)}`,
  flow: typeof e.flow === 'function' ? ((fn) => (t) => k * fn(t))(e.flow) : typeof e.flow === 'number' ? k * e.flow : Array.isArray(e.flow) ? e.flow.map(v => (typeof v === 'number' ? k * v : v)) : e.flow }));
function scaleRunInflow(r) { r.inflowRaw = r.inflowReady; if (emu?.inflow != null && emu.inflow !== 1) r.inflowReady = scaleInflow(r.inflowReady, emu.inflow); }
/** One emulator training run: the scenario (null = existing conditions) with the overrides, at full speed, saved to the
 *  project with its ground (grids/ground.f32). Gauge readings are fetched once per study and reused. → { record, dir, wall } */
async function runAt(scName, over, label, note) {
  if (!model || !device) throw new Error('Build a model first.');
  if (!projects.current) throw new Error('Save the project first: training runs are kept in its runs folder.');
  const speed = $('speed').value; $('speed').value = 100; $('speed').dispatchEvent(new Event('input'));
  emu = over; pairPrep = emuPrep;
  try {
    design.activate(scName); applyScenario(); drawDesign(); resetRun();
    if (!(await prepareRun(run))) throw new Error('the run was replaced');
    emuPrep ??= { levelsReady: run.levelsReady, inflowReady: run.inflowRaw ?? run.inflowReady, outletReady: run.outletReady };
    note?.('running'); run.emu = true; ensureSolver(); run.playing = true; $('runBtn').textContent = 'Pause'; run.lastWall = performance.now(); run.wall0 ??= run.lastWall; loop(run.gen);
    const e = await run.done; if (e) throw e;
    const r = run, dir = await projects.saveRun(label);
    if (!dir) throw new Error('the run could not be saved');
    await writeProjectFile(projects.current.folder, `${dir}/grids/ground.f32`, CMP.encodeF32(model.f.z));
    return { record: r.record, dir: dir.replace(/^runs\//, ''), wall: r.wall, F: r.F };
  } finally { emu = null; pairPrep = null; $('speed').value = speed; $('speed').dispatchEvent(new Event('input')); }
}
/** The forcing fingerprint a solver run with these overrides would have (for an emulated record). The gauge readings
 *  are the ones this session's study runs used, or fetched now as a run would. */
async function forcingAt(over, F) {
  if (!emuPrep) {
    await inflow.ready;
    let levelsReady = null, inflowReady = [];
    if ($('startWater').value === 'gauge') { try { levelsReady = await prepareLevels(); } catch { /* none nearby */ } }
    try { inflowReady = await prepareInflow(); } catch { /* none */ }
    let outletReady = null; try { outletReady = await prepareOutlet(); } catch { /* none */ }
    emuPrep = { levelsReady, inflowReady, outletReady };
  }
  emu = over;
  try { return CMP.fingerprint(forcingRecord({ storm: currentStorm(), inflowReady: over?.inflow != null && over.inflow !== 1 ? scaleInflow(emuPrep?.inflowReady, over.inflow) : emuPrep?.inflowReady ?? [], levelsReady: emuPrep?.levelsReady, outletReady: emuPrep?.outletReady, F })); }
  finally { emu = null; }
}
const groundCache = new Map();
/** The fine model of a scenario with design numbers set (cached on the last few): { f, log } — existing conditions: the base. */
function designAt(scName, values) {
  if (!scName) return { f: model.base, log: null };
  const sc = design.scenarios.find(s => s.name === scName); if (!sc) throw new Error(`no scenario "${scName}"`);
  const key = CMP.hashOf({ scName, d: sc.design.features, s: sc.settings, l: sc.locked, values: values ?? {} }); if (groundCache.has(key)) return groundCache.get(key);
  const dsg = { features: sc.design.features, settings: sc.settings, locked: sc.locked };
  const r = applyDesign(model.base, values && Object.keys(values).length ? withValues(dsg, values) : dsg, { ...femaOpts(), toCell: llCell, wse: model.baseWse ?? null, water: fineWater(), hash: false });
  groundCache.set(key, { f: r.fine, log: r.log }); if (groundCache.size > 4) groundCache.delete(groundCache.keys().next().value);
  return groundCache.get(key);
}
/** What a study can vary on this model and scenario: forcing parameters that apply here, and the design numbers. */
function emuParams(scName) {
  const out = [];
  if (stormSrc === 'a14' && model.atlas14) out.push({ key: 'ari', label: 'Return period', unit: 'yr', min: 2, max: 100, log: true, value: Number($('ari').value) });
  else if (stormSrc === 'a14' && hist.fit) out.push({ key: 'ari', label: 'Return period (site record)', unit: 'yr', min: 2, max: 100, log: true, value: Number($('ari').value) });
  out.push({ key: 'rain', label: 'Rain depth factor', unit: '×', min: 0.6, max: 1.4, value: 1 });
  if (inflow.entries.length) out.push({ key: 'inflow', label: 'River inflow scale', unit: '×', min: 0.5, max: 1.5, value: 1 });
  if ((stormSrc === 'hist' || stormSrc === 'radar') && currentStorm()?.wl) out.push({ key: 'tide', label: 'Tide / surge offset', unit: 'm', min: -0.3, max: 0.6, value: 0 });
  if ($('infilModel').value === 'ga') out.push({ key: 'se', label: 'Soil wetness at the start (Se)', unit: '', min: 0.15, max: 0.95, value: WETNESS[$('wetness').value] });
  if (scName) { const { log } = designAt(scName, null); const sc = design.scenarios.find(s => s.name === scName); for (const v of designVariables(sc.design, log)) out.push({ key: 'design:' + v.key, label: `${v.featureName}: ${v.label}`, unit: v.kind === 'ratio' ? 'H:V' : 'm', kind: v.kind, min: v.min, max: v.max, value: v.value }); }
  return out;
}
const emulatorUI = initEmulator(map, {
  ready: () => !!model && !!device, model: () => model, project: () => projects.current, scenarios: () => design.scenarios.map(s => s.name), activeScenario: () => design.active?.name ?? null,
  params: emuParams, runAt, forcingAt, designAt, resetPrep: () => { emuPrep = null; }, units: () => design.units, commit: () => appCommit,
  fixedForcing: () => (run?.record?.forcing ?? null), readBytes: (path) => readBytes(projects.current.folder, path), readText: (path) => readProjectFile(projects.current.folder, path),
  writeFile: (path, data) => writeProjectFile(projects.current.folder, path, data), savedRuns, cancelRun: () => { if (run && !run.record) { const r = run; r.finish?.(new Error('Study cancelled')); stopRun(); resetRun(); } },
  addRecord: (rec) => { records.push(rec); while (records.length > 8) records.splice(records.findIndex(x => ![...baselines.values()].includes(x)), 1); compareUI.refresh(); },
  setOverlay: (canvas, visible) => { if (model) setCanvasLayer('emu', canvas, model.fine.corners(), 'area-line', visible, 0.9); },
  geo: () => model && { nx: model.fine.nx, ny: model.fine.ny, x0: model.fine.x0, y0: model.fine.y1 - model.fine.ny * model.fine.dx, dx: model.fine.dx },
  toCell: llCell,
});
// ------------------------------------------------------------------ flooded areas, damages, EAD (src/areas.js, src/damage.js)
// For the report: the USACE NSI structures in the area (fetched once per model), the OSM footprints and streets on the
// 1 m grid, and per run record its flooded areas and building damage (kept on the record). EAD gathers the project's
// saved runs of the same scenario and settings at different return periods.
let dmgAssets = null;
async function damageAssets() {
  if (dmgAssets?.model === model) return dmgAssets;
  const fine = model.fine, toC = (pts) => toCells(fine, pts);
  const fp = DMG.footprintIndex(model.osm.buildings.map(b => b.rings.map(toC)), fine.nx, fine.ny);
  const roads = model.osm.roads.map(r => ({ name: r.name, kind: r.kind, line: toC(r.line) }));
  let structures = [], nsiError = null;
  try { const r = await fetcher(DMG.nsiUrl(fine.lonlatBounds())); if (!r.ok) throw new Error(`NSI ${r.status}`); structures = DMG.parseNSI(await r.json()); }
  catch (e) { nsiError = e.message; log('USACE NSI structures unavailable: ' + e.message, 'warn'); }
  const cells = toC(structures.map(s => s.lonlat)); structures.forEach((s, n) => { s.cell = cells[n]; });
  dmgAssets = { model, structures, fp, roads, nsiError };
  return dmgAssets;
}
const cellLonLat = ([x, y]) => fromUTM(model.fine.x0 + x * model.fine.dx, model.fine.y1 - y * model.fine.dx, model.fine.zone);
/** A record's flooded areas and damage (cached on the record). threshold: depth (m) that makes a cell flooded. */
async function analyzeRecord(rec, { threshold = 0.15, areas = true, wall = 0.10 } = {}) {
  if (!model || !rec?.grids?.max_depth || rec.grids.max_depth.length !== model.fine.nx * model.fine.ny) return null;
  const key = `${threshold}|${areas}|${wall}`;
  if (rec.analysis?.model === model && (rec.analysis.key === key || (!areas && rec.analysis.wall === wall && rec.analysis.damage))) return rec.analysis;
  const a = await damageAssets(), fine = model.fine, G = rec.grids;
  const g = { nx: fine.nx, ny: fine.ny, dx: fine.dx, z: rec.ground ?? model.base.z, bld: model.base.bld, maxWse: G.max_wse, maxDepth: G.max_depth };
  const open = DMG.openWater(G.max_depth, { nx: fine.nx, ny: fine.ny, dx: fine.dx, bld: model.base.bld, road: model.base.road, minDepth: wall }); // not the ponds in enclosed yards
  const damage = DMG.damages(a.structures, DMG.exposure(a.structures, g, s => s.cell, { fp: a.fp, minDepth: wall, counts: open.mask }));
  damage.enclosed = open.enclosed;
  let ar = null;
  if (areas) {
    ar = AR.floodedAreas({ ...g, maxSpeed: G.max_speed, maxDv: G.max_dv, tWet: G.t_wet, tAbove15: G.t_above15, finalDepth: G.final_depth, hazard: rec.hazard, road: model.base.road }, { threshold, fp: a.fp, roads: a.roads });
    const own = AR.areaOfPoints(a.structures, s => s.cell, ar.label, fine.nx, fine.ny);
    for (const x of ar.areas) Object.assign(x, { lonlat: cellLonLat(x.centroid), structures: 0, structuresFlooded: 0, aboveFloor: 0, damage: 0, peopleNight: 0 });
    damage.rows.forEach((row, n) => { const x = ar.areas[own[n]]; if (!x) return; x.structures++; if (row.total > 0) x.structuresFlooded++; if (row.depthFF > 0) { x.aboveFloor++; x.peopleNight += row.peopleNight; } x.damage += row.total; });
  }
  const streets = areas ? MAPS.streetStats(a.roads, { nx: fine.nx, ny: fine.ny, maxDepth: G.max_depth, tWet: G.t_wet, tAbove15: G.t_above15, maxSpeed: G.max_speed }, { dx: fine.dx }) : null; // src/maps.js
  rec.analysis = { key, model, threshold, wall, areas: ar, streets, damage, nsiError: a.nsiError, nStructures: a.structures.length, geo: { nx: fine.nx, ny: fine.ny, bld: model.base.bld } };
  return rec.analysis;
}
/**
 * The return-period family of a record: the project's saved runs of the same scenario, design and settings (forcing
 * parts other than the storm and run length) at Atlas 14 return periods of the same duration, the record itself
 * included, each with its damage. → { points: [{ ari, aep, damage, low, high, dir }], ead, low, high, warnings } or null
 */
async function eadFamily(rec, { wall = 0.10 } = {}) {
  const info = rec?.stormInfo; if (!projects.current || !info?.ari) return null;
  const same = (f) => JSON.stringify(Object.entries(f?.parts ?? {}).filter(([k]) => !['storm', 'runLength', 'commit'].includes(k)));
  const want = same(rec.forcing), runs = (await savedRuns()).filter(r => r.grids && r.ari && r.durationMin === info.durationMin && (r.scenario ?? 'Existing conditions') === (rec.scenario ?? 'Existing conditions') && r.designHash === rec.designHash && same(r.forcing) === want);
  const byAri = new Map(); for (const r of runs) if (!byAri.has(r.ari)) byAri.set(r.ari, r); // newest first: the latest run of each
  const points = [];
  for (const [ari, r] of byAri) {
    const one = r.dir === rec.dir || (ari === info.ari && !rec.dir) ? rec : await loadSaved(r.dir);
    const an = await analyzeRecord(one, { areas: false, wall }); if (!an) continue;
    points.push({ ari, aep: DMG.aepOfPds(ari), damage: an.damage.totals.total, low: an.damage.totals.low, high: an.damage.totals.high, dir: r.dir, flooded: an.damage.totals.flooded });
  }
  if (!byAri.has(info.ari)) { const an = await analyzeRecord(rec, { areas: false, wall }); if (an) points.push({ ari: info.ari, aep: DMG.aepOfPds(info.ari), damage: an.damage.totals.total, low: an.damage.totals.low, high: an.damage.totals.high, dir: rec.dir ?? null, flooded: an.damage.totals.flooded }); }
  points.sort((p, q) => p.ari - q.ari);
  const mid = DMG.ead(points), lo = DMG.ead(points.map(p => ({ aep: p.aep, damage: p.low }))), hi = DMG.ead(points.map(p => ({ aep: p.aep, damage: p.high })));
  return { points, ead: mid.ead, low: lo.ead, high: hi.ead, parts: mid.parts, curve: mid.curve, warnings: mid.warnings, durationMin: info.durationMin, scenario: rec.scenario ?? 'Existing conditions' };
}
// ------------------------------------------------------------------ end of flooded areas, damages, EAD
// ------------------------------------------------------------------ defensibility checks (src/checks.js)
// For the report: a record's checks (the model edge, inflow from outside, the books, run length, marks and features near
// the edge) and its sensitivity family (the project's saved batch-variant runs of the same storm, scenario and design).
const edgeDist = () => (model.edgeDist ??= CHK.edgeDistance(model.fine.nx, model.fine.ny, model.fine.dx, model.poly ? polygonCells(model.fine, model.poly) : null));
const coordsOf = (g) => (!g ? [] : g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' || g.type === 'MultiPoint' ? g.coordinates : g.type === 'Polygon' || g.type === 'MultiLineString' ? g.coordinates.flat() : g.type === 'MultiPolygon' ? g.coordinates.flat(2) : []);
/**
 * The sensitivity family of a record: the base run and the project's saved batch-variant runs of the same scenario and
 * design whose forcing differs from the base's only in the part the variant changes (CHK.VARIANT_PART); the latest of
 * each. → { base, variants: [{ key, label, dir, maxDepth, damage, commit }], versions (FloodSim commits differ) } or null
 */
async function sensitivityFamily(rec, { wall = 0.10 } = {}) {
  if (!projects.current || !rec?.forcing || !model) return null;
  const sc = (r) => r.scenario ?? 'Existing conditions', N = model.fine.nx * model.fine.ny, own = rec.batch?.variant ?? 'base';
  const runs = (await savedRuns()).filter(r => r.grids && r.batch?.variant && r.dir !== rec.dir && sc(r) === sc(rec) && r.designHash === rec.designHash); // newest first
  const ownPart = own === 'base' ? [] : [CHK.VARIANT_PART[own] ?? '?'];
  const baseRow = own === 'base' ? null : runs.find(r => r.batch.variant === 'base' && !CHK.partsDiffer(r.forcing, rec.forcing, ownPart).length);
  if (own !== 'base' && !baseRow) return null;
  const baseF = baseRow ? baseRow.forcing : rec.forcing, byKey = new Map();
  for (const r of runs) {
    const k = r.batch.variant; if (k === 'base' || k === own || byKey.has(k) || !(k in CHK.VARIANT_PART)) continue;
    if (!CHK.partsDiffer(r.forcing, baseF, [CHK.VARIANT_PART[k]]).length) byKey.set(k, r);
  }
  if (own !== 'base') byKey.set(own, null); // the record itself
  if (!byKey.size) return null;
  const member = async (key, r) => {
    const one = r ? await loadSaved(r.dir) : rec; if (one.grids.max_depth.length !== N) return null;
    const an = await analyzeRecord(one, { areas: false, wall });
    return { key, label: one.batch?.variantLabel ?? key, dir: one.dir ?? null, maxDepth: one.grids.max_depth, damage: an?.damage.totals ?? null, commit: one.commit ?? null,
      points: one.validation?.hwm?.points ?? null, floodMaps: one.validation?.floodMaps ?? null }; // for the marks' band (src/uncertainty.js)
  };
  const base = baseRow ? await member('base', baseRow) : await member('base', null); if (!base) return null;
  const variants = [];
  for (const [key, r] of byKey) { const v = await member(key, r); if (v) variants.push(v); }
  return { base, variants, versions: variants.some(v => v.commit !== base.commit) };
}
/** The checks of a record (src/checks.js checkList) with what they were made from. */
async function checksOf(rec, { threshold = 0.15, wall = 0.10 } = {}) {
  if (!model || !rec?.grids?.max_depth || rec.grids.max_depth.length !== model.fine.nx * model.fine.ny) return null;
  const fine = model.fine, dist = edgeDist(), G = rec.grids, bld = model.base.bld;
  const edge = CHK.edgeCheck(G.max_depth, dist, { nx: fine.nx, ny: fine.ny, dx: fine.dx, threshold });
  let peak = 0, final = 0; for (let k = 0; k < G.max_depth.length; k++) if (!bld[k] && dist[k] > 0) { peak += G.max_depth[k] > 0 ? G.max_depth[k] : 0; final += G.final_depth?.[k] > 0 ? G.final_depth[k] : 0; }
  const A1 = fine.dx ** 2, hwm = (rec.validation?.hwm?.points ?? []).filter(p => Number.isFinite(p.lon)).map(p => ({ name: p.name || 'mark', kind: 'HWM', points: [[p.lon, p.lat]] }));
  const feats = [...(design.scenarios.find(s => s.name === rec.scenario)?.design.features ?? []), ...design.analysis.features].map((f, n) => ({ name: f.properties?.name || `${f.properties?.type ?? 'feature'} ${n + 1}`, kind: f.properties?.type ?? 'feature', points: coordsOf(f.geometry) }));
  const W = ws.last, L = W?.w.local, river = !!W?.w.touchesEdge;
  const watershed = W ? { upstreamArea: river ? (L?.upstreamCells ?? 0) * W.cellArea : W.upstreamArea, studyArea: W.studyArea, river, onWatershed: !!S.wsUsing } : null;
  const sens = await sensitivityFamily(rec, { wall }).catch(e => { console.warn('sensitivity', e); return null; });
  const rows = sens ? CHK.sensitivity(sens.base, sens.variants, { dx: fine.dx, threshold, skip: bld }) : null;
  const b = rec.books, stormS = (rec.stormInfo?.durationMin ?? 0) * 60;
  const input = { edge, books: b && { rain: b.rain, outflow: b.outflow, inflow: b.inflow ?? 0 }, mass: rec.validation?.mass ?? null, watershed, inflow: b?.inflow > 0 ? `${Math.round(b.inflow).toLocaleString()} m³ in` : null,
    left: { peak: peak * A1, final: final * A1 }, runLength: rec.simulatedS && stormS ? { stop: rec.simulatedS, storm: stormS } : null,
    points: hwm.length ? CHK.nearEdge(hwm, llCell, dist, fine.nx, fine.ny) : null, features: feats.length ? CHK.nearEdge(feats, llCell, dist, fine.nx, fine.ny) : null, sens: rows, sensVersions: !!sens?.versions, tideEdges: rec.forcing.parts?.tide !== CMP.hashOf(null) && !!$('tCoast')?.checked };
  const members = sens ? [sens.base, ...sens.variants] : [], band = sens ? { marks: markBands(members), maps: mapBands(members) } : null;
  rec.checks = { threshold, list: CHK.checkList(input), edge, sens: sens && { base: sens.base, variants: sens.variants, rows, versions: sens.versions, band }, geo: { nx: fine.nx, ny: fine.ny, bld } };
  return rec.checks;
}
// ------------------------------------------------------------------ end of defensibility checks
const reportUI = initReport(map, {
  records: () => [...records].reverse(), savedRuns, loadSaved, analyze: analyzeRecord, eadFamily, checks: checksOf, units: () => design.units, project: () => projects.current, compound: cmpdReport, sweep: () => compareUI.sweep(), fema: () => model?.fema ?? null, bfeFreeboard: () => design.active?.settings?.freeboard ?? 0.3,
  profiles: () => design.analysis.features.filter(f => f.properties.type === 'profile' && f.geometry?.coordinates?.length > 1),
  ctx: () => model && { geo: { nx: model.fine.nx, ny: model.fine.ny, x0: model.fine.x0, y0: model.fine.y1 - model.fine.ny * model.fine.dx, dx: model.fine.dx }, z: model.base.z, bld: model.base.bld, toCell: llCell },
  async exportFiles(files, name, bytes) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); a.download = name + '.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (projects.current) { const dir = `reports/${stamp()}_${name.slice(0, 40)}`; for (const f of files) await writeProjectFile(projects.current.folder, `${dir}/${f.name}`, f.data); }
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
  if (run.culverts || run.outlets) { // water a culvert or pond outlet took upstream and has not yet delivered downstream counts as stored
    const m = run.mass, inTransit = (run.culverts?.pending.reduce((a, p) => a + p.vol, 0) ?? 0) + (run.outlets?.inTransit ?? 0);
    m.culvertInTransit = inTransit; m.volume += inTransit; m.rel = (m.volume - m.expected) / Math.max(1e-30, Math.abs(m.expected), run.solver.vol.initial + m.rain + Math.max(0, -m.exchanged) + Math.max(0, -m.outflow));
  }
  // books 10× past the scorecard's fail mark while running: say so now, not at the end (a solver that stopped moving
  // water while the river inflow went on put the books 68 % out for two hours of a run before anyone looked)
  if (!run.massWarned && Math.abs(run.mass.rel) > 1e-2) { run.massWarned = true; log(`The water books are ${(run.mass.rel * 100).toFixed(1)} % out at ${fmtClock(run.solver.t)}: this run's results are not reliable. Stop it and check the solver (GPU errors in the console, a stuck river entry).`, 'err'); }
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

// export frames held in the page at most: past it every other frame goes and the interval doubles (Manayunk's 4.6M cells,
// a frame each 5 min over 19.5 h, came to 8.6 GB, and its checkpoints, which carry the frames, could no longer be allocated)
const FRAME_BYTES = 1.5e9;
/** The export frame interval this run keeps, in s (0: off): the chosen one, doubled each time the frames were thinned. */
const frameEvery = () => Number($('frameEvery').value) * (run.frameStep ?? 1);
function saveFrame(out) {
  const every = frameEvery();
  if (!every || run.solver.t + 1e-6 < run.nextFrame) return;
  const N = run.c.nx * run.c.ny, d = new Float32Array(N), v = new Float32Array(N);
  for (let k = 0; k < N; k++) { d[k] = out[2 * k]; v[k] = out[2 * k + 1]; }
  run.frames.push({ t: run.solver.t, depth: d, speed: v });
  if (run.frames.length * 8 * N > FRAME_BYTES) {
    run.frames = run.frames.filter((_, i) => i % 2 === 0); run.frameStep = (run.frameStep ?? 1) * 2;
    log(`Export frames now every ${Math.round(frameEvery() / 60)} min: at the one chosen they would pass ${(FRAME_BYTES / 1e9).toFixed(1)} GB in the page`, 'warn');
  }
  run.nextFrame = (Math.floor(run.solver.t / frameEvery()) + 1) * frameEvery();
}

function readouts() {
  const s = run.solver, m = run.mass, A = run.F * run.F, out = run.out;
  $('roDt').textContent = s.lastDt ? (s.lastDt < 0.1 ? (s.lastDt * 1000).toFixed(1) + ' ms' : s.lastDt.toFixed(2) + ' s') : '–';
  $('roSteps').textContent = Math.round(s.steps).toLocaleString();
  const rainMM = rainDepthTo(run.storm, s.t);
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
// physics now: Froude number, the step a cell allows over the grid's (log2: 0 = this cell sets it), flow per metre width
RAMPS.froude = { stops: [[0, [215, 235, 250]], [0.5, [120, 180, 225]], [0.99, [40, 90, 170]], [1, [245, 170, 60]], [1.5, [220, 80, 40]], [2, [130, 20, 50]]], max: 2, unit: '', ticks: [0, 0.5, 1, 1.5, 2] };
RAMPS.step = { stops: [[0, [120, 15, 60]], [1, [225, 90, 50]], [2, [240, 200, 90]], [3, [95, 175, 120]]], max: 3, unit: '', ticks: ['1×', '2×', '4×', '8×'] };
RAMPS.flow = { stops: [[0, [240, 240, 225]], [0.1, [190, 215, 170]], [0.5, [90, 170, 140]], [1, [30, 110, 120]], [3, [20, 40, 90]]], max: 3, unit: 'm²/s', ticks: [0, 1, 2, 3] };
const PHYS = new Set(['froude', 'step', 'flow']);
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
    $('ticks').title = S.view === 'step' ? 'How many times the grid’s step this cell could take on its own: the darkest cells set the step for every cell (local time stepping lets the rest take up to 8×)' : '';
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
  const phys = PHYS.has(view) ? physicsNow() : null;
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
    } else if (PHYS.has(view)) { // per solver cell, from the frame's depth and speed
      const c = ck(i, j), h = run.out[2 * c], v = run.out[2 * c + 1];
      if (!(h > 0.005)) continue;
      col = rampColor(r, view === 'froude' ? v / Math.sqrt(G * h) : view === 'flow' ? h * v : Math.min(3, Math.log2(phys.dtOf(h, v) / phys.dtMin)));
    } else {
      const v = speedAt(i, j);
      if (view === 'speed') col = rampColor(r, v);
      else { if (d < WET) continue; col = st.classes[st.classify(d, d >= VCUT ? v : 0) - 1].color; }
    }
    const a = Math.min(1, 0.35 + d * 3) * 255;
    px[4 * k] = col[0]; px[4 * k + 1] = col[1]; px[4 * k + 2] = col[2]; px[4 * k + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  if (phys) physNote(phys);
  run.lastDraw = { depth };
  refreshCanvas('depth');
}

const G = 9.81;
/**
 * The engine's state this frame, from the solver grid's depth and speed: the step each wet cell allows, CFL · Δx /
 * (|u| + |v| + 2√(gh)) as the solver takes it (dtReduce; the frame has the speed |V| and not its direction, so |V| stands
 * for |u| + |v|: exact along a grid axis, the velocity part up to √2 low on a diagonal), the one that sets the grid's
 * step, how much of the flow is supercritical, and what local time stepping
 * could save (cells stepping at 2^m of the smallest step, m ≤ 3; the solver also keeps a tile's neighbours within one
 * level, so this is an upper bound).
 */
function physicsNow() {
  const out = run.out, n = run.c.nx * run.c.ny, dx = run.F * model.fine.dx, cfl = run.solver.cfl ?? 0.48;
  const dtOf = (h, v) => cfl * dx / (v + 2 * Math.sqrt(G * h));
  let wet = 0, dtMin = Infinity, kMin = -1, sup = 0;
  for (let k = 0; k < n; k++) {
    const h = out[2 * k]; if (!(h > 0.005) || (run.c.inside && !run.c.inside[k])) continue;
    const v = out[2 * k + 1], dt = dtOf(h, v); wet++;
    if (dt < dtMin) { dtMin = dt; kMin = k; }
    if (v > Math.sqrt(G * h)) sup++;
  }
  let work = 0; const levels = [0, 0, 0, 0];
  for (let k = 0; k < n && wet; k++) {
    const h = out[2 * k]; if (!(h > 0.005) || (run.c.inside && !run.c.inside[k])) continue;
    const m = Math.min(3, Math.floor(Math.log2(dtOf(h, out[2 * k + 1]) / dtMin))); levels[m]++; work += 2 ** -m;
  }
  return { dtOf, dtMin, kMin, wet, sup, levels, gain: work ? wet / work : 1, dx, cfl };
}
function physNote(p) {
  const el = $('physNote'); el.hidden = false;
  if (!p.wet) { el.textContent = 'No water on the grid yet.'; return; }
  const c = p.kMin, h = run.out[2 * c], v = run.out[2 * c + 1], i = c % run.c.nx, j = (c / run.c.nx) | 0;
  const pct = (x) => `${Math.round(100 * x / p.wet)} %`, s = run.solver;
  el.innerHTML = `<b>Step now ${(s.lastDt ?? p.dtMin).toFixed(3)} s</b> (${s.steps.toLocaleString()} so far${s.dtAvg ? `, mean ${s.dtAvg.toFixed(3)} s` : ''}), set by the fastest water: a cell ${h.toFixed(2)} m deep at ${v.toFixed(2)} m/s. Its waves, |u| + |v| + 2√(gh) ≈ ${(v + 2 * Math.sqrt(G * h)).toFixed(1)} m/s across ${p.dx} m cells, allow about ${p.dtMin.toFixed(3)} s at CFL ${p.cfl}. ` +
    `<button class="btn" type="button" id="physGo">Show it</button><br>` +
    `${p.wet.toLocaleString()} wet cells: ${pct(p.sup)} supercritical (Froude over 1). The step they each allow: ${p.levels.map((x, m) => `${2 ** m}×${m === 3 ? '+' : ''} ${pct(x)}`).join(', ')}. ` +
    (s.lts ? 'Local time stepping is on.' : `Local time stepping would do up to ${p.gain.toFixed(1)}× less work per unit of time${p.gain > 2 && p.wet > 1e6 ? ': worth turning on (Area and model → Terrain and channels)' : ''}.`);
  $('physGo').onclick = () => map.flyTo({ center: cellLonLat([(i + 0.5) * run.F, (j + 0.5) * run.F]), zoom: 19 });
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
for (const seg of ['viewSeg', 'viewSeg2', 'viewSeg3']) $(seg).onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.view = b.dataset.v; for (const x of [...$('viewSeg').children, ...$('viewSeg2').children, ...$('viewSeg3').children]) x.setAttribute('aria-pressed', x === b);
  drawLegend(); $('physNote').hidden = !PHYS.has(S.view); if (!run?.out) $('physNote').textContent = 'Shown while a run is on the map.';
  if (PEAK.has(S.view) && run?.solver) { const r = run; r.haz.load(await r.solver.readHazard(), r.solver.t); await readGround(); if (run !== r) return; } // latest every-step totals
  if (run?.out) { if (run.view) run.view.lastMax = 0; drawDepth(); }
};
$('hazStd').onchange = () => { drawLegend(); if (run?.out) drawDepth(); if (run?.haz?.t != null) hazardNote(); };
$('opacity').oninput = () => { S.opacity = $('opacity').value / 100; $('opacityOut').textContent = $('opacity').value + ' %'; if (map.getLayer('ov-depth')) map.setPaintProperty('ov-depth', 'raster-opacity', S.opacity); };
$('basemap').onchange = () => { for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(k, 'visibility', k === $('basemap').value ? 'visible' : 'none'); };

// ---- NEXRAD radar overlay (display only: the model's rain still comes from the Storm section). A historic storm's
// frames follow the run clock; live shows the last hour. Each frame is its own tile source; the next one loads unseen
// (opacity 0), so stepping through frames does not flash.
const RADAR_OPACITY = 0.6, RADAR_KEEP = 4;
const radarID = (f) => 'radar-' + (f.t ?? 'now');
function radarShow(k) {
  if (radar.mode === 'model') { rainShow(k); return; }
  if (!map.isStyleLoaded()) { map.once('idle', () => radarShow(k)); return; }
  radar.k = k;
  const f = radar.frames[k], want = f ? [f, radar.frames[k + 1]].filter(Boolean) : [];
  const ls = map.getStyle().layers, lastBase = ls.findLastIndex(l => l.id in BASEMAPS);
  const above = ls[lastBase + 1]?.id; // over the basemaps, under everything drawn on them
  for (const x of want) {
    const id = radarID(x);
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'raster', tileSize: 256, tiles: [R.tileURL(x.t, x.product)], attribution: 'Radar: NEXRAD composite via Iowa Environmental Mesonet' });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, above);
    }
    radar.layers = [id, ...radar.layers.filter(l => l !== id)];
  }
  const shown = f ? radarID(f) : null;
  for (const id of radar.layers) map.setPaintProperty(id, 'raster-opacity', id === shown ? RADAR_OPACITY : 0);
  for (const id of radar.layers.splice(RADAR_KEEP)) if (!want.some(x => radarID(x) === id)) { map.removeLayer(id); map.removeSource(id); }
  $('radarT').value = Math.max(0, k);
  radarNote(f ? `${f.t == null ? 'Live composite' : new Date(f.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'} · ${f.product} base reflectivity, ` +
    'NEXRAD composite via Iowa Environmental Mesonet. Display only: the model\'s rainfall is set under Storm.' : radar.frames.length ? 'No radar frame within 15 minutes of this time (a gap in the archive).' : '');
}
function radarNote(text) { $('radarNote').hidden = !text; $('radarNote').textContent = text; }
function radarClear() {
  clearInterval(radar.play); radar.play = 0; $('radarPlay').textContent = '▶';
  if (map.isStyleLoaded()) for (const id of radar.layers) { map.removeLayer(id); map.removeSource(id); }
  radar.layers = []; radar.frames = []; radar.k = -1; radar.key = '';
  if (map.getLayer('ov-rain')) map.setLayoutProperty('ov-rain', 'visibility', 'none');
}
function radarFrames(frames) {
  radar.frames = frames; radar.follow = true;
  $('radarCtl').hidden = frames.length < 2; $('radarT').max = Math.max(0, frames.length - 1);
}
/** Load the frames for the current mode: the loaded historic storm's window, or the last hour. */
async function radarLoad() {
  const mode = radar.mode;
  if (mode === 'off') { radarClear(); radarNote(''); $('radarCtl').hidden = true; return; }
  if (mode === 'model') { rainLoad(); return; }
  if (mode === 'live') {
    const now = Date.now(), getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`IEM ${r.status}`); return r.json(); }; // direct: the proxy would cache "now" forever
    let frames = await R.listFrames(now - 65 * 60e3, now, getJSON).catch(() => []);
    if (radar.mode !== mode) return;
    if (!frames.length) frames = [{ t: null, product: 'N0Q' }]; // the listing failed: IEM's always-current composite, untimed
    radarFrames(frames); radarShow(frames.length - 1); return; // frames already on the map stay loaded: no flash on refresh
  }
  const st = currentStorm();
  if (st?.pattern !== 'historic' || st.t0 == null) { radarClear(); $('radarCtl').hidden = true; radarNote('Load a historic storm (2 · Storm) to see its radar.'); return; }
  const t1 = st.t0 + st.durationMin * 60e3, key = `${st.t0}:${t1}`;
  if (radar.key === key && radar.frames.length) return;
  radarNote('Listing the radar frames for this storm…');
  const getJSON = async (u) => { const r = await fetcher(u); if (!r.ok) throw new Error(`IEM ${r.status}`); return r.json(); };
  let frames;
  try { frames = await R.listFrames(st.t0, t1, getJSON); } catch (e) { if (radar.mode === mode) radarNote('Radar listing unavailable: ' + e.message); return; }
  if (radar.mode !== mode || currentStorm()?.t0 !== st.t0) return;
  radarClear(); radar.key = key; radarFrames(frames);
  if (!frames.length) { radarNote('IEM holds no radar frames for this storm\'s window.'); return; }
  let pk = 0; st.depth.forEach((d, i) => { if (d > st.depth[pk]) pk = i; }); // before a run: the frame at the storm's peak block
  radarShow(R.frameAt(frames, run?.storm?.t0 === st.t0 && run.t ? st.t0 + run.t * 1000 : st.t0 + pk * st.blockMin * 60e3));
}
/** During a run of a historic storm, show the frame at the simulation time. */
function radarClock(r) {
  if (radar.mode === 'model' && radar.follow && r.storm?.radar && radar.key === rainKey(r.storm)) { const k = Math.min(r.storm.radar.frames.length - 1, Math.floor(r.t / (r.storm.blockMin * 60))); if (k !== radar.k) rainShow(k); return; }
  if (radar.mode !== 'storm' || !radar.follow || !radar.frames.length || r.storm?.t0 == null || radar.key !== `${r.storm.t0}:${r.storm.t0 + r.storm.durationMin * 60e3}`) return;
  const k = R.frameAt(radar.frames, r.storm.t0 + r.t * 1000);
  if (k !== radar.k) radarShow(k);
}
$('radarMode').onchange = () => {
  radar.mode = $('radarMode').value;
  clearInterval(radar.live); radar.live = radar.mode === 'live' ? setInterval(() => { if (radar.follow) radarLoad(); }, R.FRAME_MIN * 60e3) : 0;
  radarClear(); radarLoad().catch(e => radarNote('Radar unavailable: ' + e.message));
};
$('radarT').oninput = () => { radar.follow = false; radarShow(Number($('radarT').value)); };

// ---- the rain the model used: a radar storm's own 2-minute MRMS frames (gauge-corrected where the archive has them,
// the nowcast past now) over the model, and the raw 2-minute radar (a2m) for half a degree around it, dimmer, so the
// storm can be seen coming. Follows the run clock like the NEXRAD frames; the slider and ▶ step through the blocks.
const rain = { ctx: null, cache: new Map(), want: -1 };
const rainKey = (st) => `model:${st.t0}:${st.radar.frames.length}:${st.radar.hash ?? ''}`;
/** mm/hr → RGBA, the usual radar ramp (light green to magenta). */
function rainRGBA(v) {
  const S = [[2.5, [120, 200, 120]], [10, [40, 160, 60]], [25, [250, 220, 40]], [50, [250, 140, 30]], [100, [230, 40, 40]], [Infinity, [200, 40, 200]]];
  for (const [hi, c] of S) if (v < hi) return c;
}
function rainStorm() { const st = run?.storm?.radar ? run.storm : currentStorm(); return st?.radar ? st : null; }
function rainLoad() {
  const st = rainStorm();
  if (!st) { radarClear(); $('radarCtl').hidden = true; radarNote('Load a radar storm (Storm → Radar & nowcast, or a historic storm with Radar, NOAA MRMS) to see the rain the model uses.'); return; }
  const key = rainKey(st);
  if (radar.key !== key) {
    radarClear(); radar.key = key; rain.cache.clear();
    const w = st.radar.win, pad = 50; // 0.5° of context each side
    const r0 = Math.max(0, w.r0 - pad), r1 = Math.min(MR.GRID.ny, w.r1 + pad), c0 = Math.max(0, w.c0 - pad), c1 = Math.min(MR.GRID.nx, w.c1 + pad);
    rain.ctx = { r0, r1, c0, c1, nx: c1 - c0, ny: r1 - r0, lon0: MR.GRID.lon0 + c0 * MR.GRID.step, lat0: MR.GRID.lat0 - r0 * MR.GRID.step, step: MR.GRID.step };
    const cx = rain.ctx, cv = canvases.rain, W = cx.lon0, E = W + cx.nx * cx.step, N = cx.lat0, Sth = N - cx.ny * cx.step;
    cv.width = cx.nx; cv.height = cx.ny;
    setCanvasLayer('rain', cv, [[W, N], [E, N], [E, Sth], [W, Sth]], 'ov-depth', true, 0.85); // under the flood depths
    radarFrames(st.radar.frames.map((_, k) => k));
    let pk = 0; st.depth.forEach((d, i) => { if (d > st.depth[pk]) pk = i; });
    rainShow(run?.storm === st && run.t ? Math.min(st.radar.frames.length - 1, Math.floor(run.t / (st.blockMin * 60))) : pk);
  } else if (map.getLayer('ov-rain')) map.setLayoutProperty('ov-rain', 'visibility', 'visible');
}
/** The context radar for block k (the 2 minutes ending at its end), mm/hr, fetched once; past the observed radar, the
 *  nowcast's own rain moved on (the run's member), or none without it. */
function rainContext(st, k) {
  if (rain.cache.has(k)) return rain.cache.get(k);
  const t = st.t0 + (k + 1) * st.blockMin * 60e3, live = st.radar.live, src = ncSrc(st);
  const p = live && t > live.observedUntil ? Promise.resolve(src ? ncFrameOn(src, rain.ctx, (t - st.blockMin * 60e3 - src.latest) / 60e3, live.member).f : null)
    : radarBytes(MR.fileURL('a2m', t)).then(b => (b ? MR.decodeWindow(b, rain.ctx) : null)).then(g => g && Float32Array.from(g, v => MR.a2mMM(v) * 30)).catch(() => null);
  rain.cache.set(k, p); if (rain.cache.size > 60) rain.cache.delete(rain.cache.keys().next().value);
  return p;
}
async function rainShow(k) {
  const st = rainStorm(); if (!st || radar.key !== rainKey(st) || k < 0) return;
  radar.k = k; rain.want = k; $('radarT').value = k;
  for (let n = 1; n <= 3 && k + n < st.radar.frames.length; n++) rainContext(st, k + n); // the next ones load while this one shows
  const ctx = await rainContext(st, k);
  if (rain.want !== k || radar.key !== rainKey(st)) return;
  const cx = rain.ctx, w = st.radar.win, f = st.radar.frames[k], per = 60 / st.blockMin, img = new ImageData(cx.nx, cx.ny), D = img.data;
  if (ctx) for (let p = 0; p < ctx.length; p++) { const v = ctx[p]; if (v >= 0.25) { const c = rainRGBA(v); D.set(c, 4 * p); D[4 * p + 3] = 120; } }
  for (let j = 0; j < w.ny; j++) for (let i = 0; i < w.nx; i++) { // the model's own frame, solid, on top (none: a dry block)
    const v = f ? f[j * w.nx + i] * per : 0, p = (j + w.r0 - cx.r0) * cx.nx + i + w.c0 - cx.c0; if (!(v >= 0.25)) { D[4 * p + 3] = 0; continue; }
    D.set(rainRGBA(v), 4 * p); D[4 * p + 3] = 235;
  }
  canvases.rain.getContext('2d').putImageData(img, 0, 0); refreshCanvas('rain');
  const t = st.t0 + k * st.blockMin * 60e3, live = st.radar.live, fc = live && t >= live.observedUntil;
  const iso = (x) => new Date(x).toISOString().slice(0, 16).replace('T', ' ');
  radarNote(`${iso(t)}–${iso(t + st.blockMin * 60e3).slice(11)} UTC${fc ? ' · NOWCAST (forecast)' : ''} · area mean ${(st.intensity[k] ?? 0).toFixed(1)} mm/hr. Solid: the rain the model uses over its area (${st.radar.gauged ? 'gauge-corrected MRMS' : 'MRMS radar-only'}, 1 km); faint: the raw 2-minute radar around it${fc ? (ncSrc(st) ? ' (past the latest frame, the nowcast moving it on)' : ' (none past the latest frame)') : ''}. mm/hr: light green < 2.5, green < 10, yellow < 25, orange < 50, red < 100, magenta ≥ 100. Zoom out to watch the storm come in.`);
}
$('radarPlay').onclick = () => {
  if (radar.play) { clearInterval(radar.play); radar.play = 0; $('radarPlay').textContent = '▶'; return; }
  radar.follow = false; $('radarPlay').textContent = '❚❚';
  radar.play = setInterval(() => radarShow((radar.k + 1) % radar.frames.length), 400);
};
for (const [id, layer] of [['tShade', 'ov-shade'], ['tLc', 'ov-lc']]) $(id).onchange = () => { if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', $(id).checked ? 'visible' : 'none'); };
$('tFema').onchange = () => { const v = $('tFema').checked ? 'visible' : 'none'; for (const l of ['ov-fema', 'fema-bfe', 'fema-bfe-label']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', v); };
/** FEMA flood zones as an overlay, and the BFE lines / cross-sections labelled in feet. */
function drawFema(corners) {
  const fe = model?.fema, fine = model.fine, cv = canvases.fema;
  if (!fe) { if (map.getLayer('ov-fema')) map.setLayoutProperty('ov-fema', 'visibility', 'none'); return; }
  cv.width = fine.nx; cv.height = fine.ny; cv.getContext('2d').putImageData(new ImageData(FEMA.zoneImage(fe.grids, fine.nx, fine.ny), fine.nx, fine.ny), 0, 0);
  setCanvasLayer('fema', cv, corners, 'bld-fill', $('tFema').checked, 0.8);
  const fc = { type: 'FeatureCollection', features: fe.data.lines.map(l => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.line },
    properties: { icon: labelImage(map, `${l.kind === 'xs' ? 'XS ' : ''}${(l.elev / 0.3048).toFixed(1)} ft`, { halo: '#0b2a4a' }) } })) };
  const vis = $('tFema').checked ? 'visible' : 'none';
  if (!map.getSource('fema-bfe')) {
    map.addSource('fema-bfe', { type: 'geojson', data: fc });
    map.addLayer({ id: 'fema-bfe', type: 'line', source: 'fema-bfe', layout: { visibility: vis }, paint: { 'line-color': '#9fd0ff', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'fema-bfe-label', type: 'symbol', source: 'fema-bfe', layout: { visibility: vis, 'symbol-placement': 'line', 'icon-image': ['get', 'icon'],
      'icon-rotation-alignment': 'map', 'icon-keep-upright': true } });
  } else { map.getSource('fema-bfe').setData(fc); for (const l of ['fema-bfe', 'fema-bfe-label']) map.setLayoutProperty(l, 'visibility', vis); }
}
$('tBld').onchange = () => { for (const l of ['bld-fill', 'bld-line']) map.setLayoutProperty(l, 'visibility', $('tBld').checked ? 'visible' : 'none'); };
for (const [id, fmt] of [['rain', v => v + ' mm/hr'], ['dur', v => v + ' min'], ['uplift', v => '+' + v + ' %'], ['tail', v => (v < 60 ? v + ' min' : fmtDur(Number(v)))], ['speed', () => speedMul() === Infinity ? 'max' : speedMul().toLocaleString() + '×']]) {
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
    files.push({ name: 'drainage/network.inp', data: enc.encode(run.inp ?? toINP(run.net, fine, { durationS: Math.ceil(tStop() / 60) * 60 + 3600, routing: swmmRouting() })) });
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

// ------------------------------------------------------------------ HEC-RAS handoff (src/hecras.js)
// Area → Channel bathymetry → HEC-RAS cross-sections (a 1D model's geometry into the channel bed), and Export →
// HEC-RAS 2D package. Kept together here; the logic is in src/hecras.js, src/shapefile.js and src/tiff-write.js.
const rasXS = { geom: null, units: null, proj: null, name: '' };
const xsFail = (err) => { console.error(err); $('xsNote').textContent = 'Cross-sections not used: ' + err.message; };
$('xsFiles').onchange = async (e) => {
  rasXS.geom = null; rasXS.units = null; rasXS.proj = null; rasXS.name = '';
  for (const file of e.target.files) {
    const text = await file.text(), pj = RAS.parseProject(text);
    if (pj) rasXS.units = pj.units;
    else if (/^\s*(PROJCS|GEOGCS|PROJCRS)/i.test(text)) rasXS.proj = text.trim();
    else if (/^River Reach=/m.test(text)) { rasXS.geom = RAS.parseGeometry(text); rasXS.name = file.name; }
  }
  if (!rasXS.geom) { $('xsNote').textContent = 'No HEC-RAS geometry (.g01 … .g99 text with "River Reach=") among those files.'; return; }
  loadXS().catch(xsFail);
};
$('xsImport').onclick = () => $('xsFiles').click();
for (const id of ['xsUnits', 'xsDatum', 'xsCrs']) $(id).onchange = () => loadXS().catch(xsFail);
$('xsClear').onclick = () => { rasXS.geom = null; $('xsFiles').value = ''; $('xsNote').textContent = ''; if (model?.xsBed) { model.xsBed = null; applyBathymetry(); } };
/** File coordinates → UTM in the model's zone: EPSG:269xx / 326xx locally, anything else through proj4 (a .prj's WKT, EPSG codes via epsg.io). */
async function xsTransform(crs, zone, sample) {
  const m = /^EPSG:(269|326)(\d\d)$/i.exec(crs ?? '');
  if (m) { const z = Number(m[2]); return z === zone ? (x, y) => [x, y] : (x, y) => toUTM(...fromUTM(x, y, z), zone); }
  if (!crs) throw new Error('the projection is unknown: add the RAS Mapper projection (.prj with PROJCS) or type its EPSG code');
  const tf = await transformFor(crs, [{ kind: 'point', coords: sample }], fetcher);
  return (x, y) => { const [lon, lat] = tf([x, y]); return toUTM(lon, lat, zone); };
}
async function loadXS() {
  if (!model || !rasXS.geom) return;
  const fine = model.fine, g = rasXS.geom, units = $('xsUnits').value === 'auto' ? rasXS.units ?? 'US' : $('xsUnits').value;
  const pts = g.reaches.flatMap(r => r.xs.flatMap(x => x.cut)); if (!pts.length) throw new Error('no cross-section with a GIS cut line');
  $('xsNote').textContent = 'Placing the cross-sections…';
  const tf = await xsTransform($('xsCrs').value.trim() || rasXS.proj, fine.zone, pts[0]);
  const toGrid = (x, y) => { const [X, Y] = tf(x, y); return [(X - fine.x0) / fine.dx, (fine.y1 - Y) / fine.dx]; };
  const mid = tf(pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length);
  const zShift = $('xsDatum').value === 'NGVD29' ? await ngvdToNavd(...fromUTM(mid[0], mid[1], fine.zone), fetcher) : 0;
  const bed = RAS.xsBed(g, fine, toGrid, { zScale: units === 'US' ? 0.3048 : 1, zShift });
  const n = g.reaches.length, label = `${rasXS.name}: ${bed.sections} section${bed.sections === 1 ? '' : 's'} in ${n} reach${n === 1 ? '' : 'es'}, ${units === 'US' ? 'ft' : 'm'} ${$('xsDatum').value}${zShift ? ` (${zShift >= 0 ? '+' : ''}${zShift.toFixed(2)} m to NAVD88)` : ''}`;
  const had = !!model.xsBed; model.xsBed = bed.cells ? { z: bed.z, label } : null;
  $('xsNote').textContent = (bed.cells ? `${label}; ${Math.round(bed.cells * fine.dx ** 2).toLocaleString()} m² of the model between sections.` : `${label}: none of them falls inside the model area (check the projection and units).`) +
    (g.skipped.structures ? ` ${g.skipped.structures} bridge / culvert / structure record${g.skipped.structures > 1 ? 's' : ''} left out.` : '') +
    (!bed.cells ? '' : $('bathySel').value === 'off' ? ' Pick a channel bathymetry option above to carve them (its curve fills where no section reaches).' : ' They set the bed under the flattened water where BlueTopo has no survey.');
  if ((bed.cells || had) && $('bathySel').value !== 'off') applyBathymetry();
}

$('rasBtn').onclick = async () => {
  if (!model || !run) return;
  const btn = $('rasBtn'); btn.disabled = true; btn.textContent = 'Packaging…';
  try {
    if (model.bathyJob) await model.bathyJob; // the channel being carved
    const blob = zip(await rasFiles());
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `floodsim_hecras_${model.fine.epsg}_${model.fine.x0}_${model.fine.y0}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    log('HEC-RAS 2D package exported (terrain, land cover, perimeter, boundary lines and series, breaklines, rain)', 'ok');
  } catch (e) { console.error(e); log('HEC-RAS export failed: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Download HEC-RAS 2D package (.zip)'; }
};
/** The HEC-RAS package's inputs from the model and the current run settings (RAS.rasPackage). */
async function rasFiles() {
  const { fine, f } = model, W = fine.nx, NY = fine.ny, F = run.F, c = run.c, st = run.storm ?? currentStorm(), T = tStop(), n = cal().manning;
  const cx = (I) => fine.x0 + I * F * fine.dx, cy = (J) => fine.y1 - J * F * fine.dx, ll = ([lon, lat]) => toUTM(lon, lat, fine.zone);
  const lineXY = (r) => RAS.runLine(r, c.nx, c.ny).map(([I, J]) => [cx(I), cy(J)]);
  const sample = (fn, dt) => { const out = []; for (let t = 0; t <= T + 1e-6; t += dt) out.push([t, fn(t)]); return out; };
  const entries = run.inflowReady ?? await prepareInflow().catch(e => { log('HEC-RAS export: river inflow left out (' + e.message + ')', 'warn'); return []; });
  const bcs = [], inflowPoints = [], taken = new Set();
  for (const e of entries) {
    const q = (t) => Math.max(0, typeof e.flow === 'function' ? e.flow(t) : e.flow) * (e.scale ?? 1), name = `${e.name || e.label?.split(',')[0] || 'River'} inflow`;
    const ed = e.at ? entryEdge(c, e.at, { used: new Set() }) : null;
    if (ed?.closed.length) {
      ed.closed.forEach(k => taken.add(k));
      const best = RAS.edgeRuns(ed.closed, c.nx, c.ny).sort((a, b) => b.b - b.a - (a.b - a.a))[0];
      bcs.push({ name, kind: 'flow', line: lineXY(best), series: sample(q, 300), note: `enters across the edge over ${Math.round(ed.width)} m of channel` });
    } else if (e.at) inflowPoints.push({ name, x: fine.x0 + e.at[0] * fine.dx, y: fine.y1 - e.at[1] * fine.dx, series: sample(q, 300) });
  }
  if (st?.wl) {
    const { mask } = edgeEntries(c, entries, new Set()), cells = stageEdgeCells(c, F, mask, st) ?? [];
    cells.forEach(k => taken.add(k));
    RAS.edgeRuns(cells, c.nx, c.ny).forEach((r, i, all) => bcs.push({ name: `Tide ${st.wl.name ?? st.wl.station ?? ''}${all.length > 1 ? ' ' + (i + 1) : ''}`.trim(), kind: 'stage', line: lineXY(r),
      series: sample(t => stageAt(st, t), 360), note: `observed water level${st.wl.station ? ` (NOAA CO-OPS ${st.wl.station})` : ''}, m NAVD88` }));
  } else if (run?.outlet) { // a river outlet: the run's edge level (the downstream gauge carried up the reach)
    const o = run.outlet; o.cells.forEach(k => taken.add(k));
    RAS.edgeRuns(o.cells, c.nx, c.ny).forEach((r, i, all) => bcs.push({ name: `Outlet ${o.g.site}${all.length > 1 ? ' ' + (i + 1) : ''}`, kind: 'stage', line: lineXY(r),
      series: sample(t => stageAt(st, t), 360), note: `USGS ${o.g.site} (${o.g.name}) water surface + backwater over ${Math.round(o.L)} m at its discharge, m NAVD88` }));
  }
  // the rest of the edge: FloodSim's free outfall, as normal depth on the ground slope near the edge (0.05 % to 5 %)
  const free = []; for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) { if (I && J && I < c.nx - 1 && J < c.ny - 1) continue; const k = J * c.nx + I; if (c.mask[k] && !taken.has(k)) free.push(k); }
  const inward = Math.max(1, Math.round(20 / (F * fine.dx)));
  for (const r of RAS.edgeRuns(free, c.nx, c.ny)) {
    if (r.b - r.a < 2) continue;
    let s = 0, m = 0;
    for (let p = r.a; p <= r.b; p++) {
      const [I, J, dI, dJ] = r.side === 'north' ? [p, 0, 0, 1] : r.side === 'south' ? [p, c.ny - 1, 0, -1] : r.side === 'west' ? [0, p, 1, 0] : [c.nx - 1, p, -1, 0];
      const I1 = I + dI * inward, J1 = J + dJ * inward; if (I1 < 0 || J1 < 0 || I1 >= c.nx || J1 >= c.ny) continue;
      const k0 = J * c.nx + I, k1 = J1 * c.nx + I1; if (c.mask[k1]) { s += Math.abs(c.z[k1] - c.z[k0]) / (inward * F * fine.dx); m++; }
    }
    bcs.push({ name: `${r.side[0].toUpperCase() + r.side.slice(1)} edge outflow ${r.a}-${r.b}`, kind: 'normal', line: lineXY(r), series: null, slope: Math.min(0.05, Math.max(0.0005, m ? s / m : 0.001)) });
  }
  const breaklines = layerInputs(infra.layer).barriers.map(b => ({ name: b.name || b.type, kind: b.type, line: b.line.map(ll) }));
  if (model.bathy?.dz) {
    const wet = new Uint8Array(W * NY); for (let k = 0; k < W * NY; k++) wet[k] = model.bathy.dz[k] > 0 ? 1 : 0;
    RAS.maskOutline(wet, W, NY, { tol: 1.5 / fine.dx, minLen: 20 / fine.dx }).forEach((l, i) => breaklines.push({ name: `Channel bank ${i + 1}`, kind: 'channel bank', line: l.map(([i2, j2]) => [fine.x0 + i2 * fine.dx, fine.y1 - j2 * fine.dx]) }));
  }
  const buildings = buildingsFC().features.map(b => ({ ring: b.geometry.coordinates[0].map(ll), height: b.properties.h ?? null }));
  let radar = null;
  if (st?.radar?.frames?.length && st.radar.win) { // 15-minute totals of the 2-minute frames
    const per = Math.max(1, Math.round(15 / st.blockMin)), win = st.radar.win, N = win.nx * win.ny; radar = [];
    for (let a = 0; a < st.radar.frames.length; a += per) {
      const mm = new Float32Array(N); for (let q = a; q < Math.min(st.radar.frames.length, a + per); q++) { const fr = st.radar.frames[q]; if (fr) for (let p = 0; p < N; p++) mm[p] += fr[p] || 0; }
      radar.push({ t0: st.t0 + a * st.blockMin * 60e3, minutes: Math.min(per, st.radar.frames.length - a) * st.blockMin, mm, win });
    }
  }
  const bz = model.bathy, start = st?.t0 ?? Date.now();
  return RAS.rasPackage({
    grid: { zone: fine.zone, x0: fine.x0, y1: fine.y1, dx: fine.dx, nx: W, ny: NY }, z: f.z, bld: f.bld, bldH: f.bldH, cls: f.cls, road: f.road,
    manning: n === 1 ? f.manning : f.manning.map(v => v * n), nTable: Object.fromEntries(Object.entries(MANNING).map(([k, v]) => [k, v * n])), nRoad: MANNING_ROAD * n, classNames: NLCD_NAMES,
    perimeter: model.poly ? [...model.poly.map(ll), ll(model.poly[0])] : [[cx(0), cy(0)], [cx(c.nx), cy(0)], [cx(c.nx), cy(c.ny)], [cx(0), cy(c.ny)], [cx(0), cy(0)]],
    bcs, inflowPoints, breaklines, buildings, radar,
    rain: st ? { t0: start, blockMin: st.blockMin, depth: st.depth } : null,
    meta: { title: `${projects.current?.name ?? 'FloodSim model'} · ${st ? stormLabel(st).replace(/<[^>]+>/g, '') : 'no storm'}`, commit: appCommit, start, end: start + T * 1000, scenario: run.scenario ?? null,
      bathy: bz ? [bz.surveyed ? 'NOAA BlueTopo survey' : null, bz.xs ? `HEC-RAS cross-sections, ${bz.xs.source}` : null, `${CURVES[bz.curve]?.label ?? bz.curve} curve elsewhere`].filter(Boolean).join('; ') : null,
      curb: model.curb, solverDx: F * fine.dx, nCal: n, startLevels: $('startWater').value === 'gauge' ? 'USGS gauge levels at the start' : null },
  });
}
// ------------------------------------------------------------------ end of the HEC-RAS handoff

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
    const k = cellAt(fine, c, F, g.lon, g.lat), near = waterNear(c, water, k, R), en = entryOf.get(site);
    if (near.length && (g.kind === 'LK' || g.kind === 'ES')) { sources.push({ cells: near, level: surf.z }); notes.push(`${g.name}: ${surf.z.toFixed(2)} m NAVD88, flat (${surf.how})`); continue; }
    if (near.length) { // a river gauge in the area: its rise over the lidar water surface right there
      const rise = Math.max(0, surf.z - surfaceAtGauge(c, near, k, surf.z)); sources.push({ cells: gaugeWater(c, near, surf.z), rise }); // its pool, not the tailwater beside it
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
/** NOAA BlueTopo surveyed bed elevations under the model (src/topobathy.js), fetched once per model; { error } if unavailable. */
function surveyOf(m) {
  const tilesAt = async (bbox) => {
    const r = await fetch(`/api/bluetopo?bbox=${bbox.map(v => v.toFixed(5)).join(',')}`, { headers: { 'x-floodsim': '1' } });
    if (!r.ok) throw new Error(`BlueTopo tile index: ${r.status} ${await r.text()}`); return r.json();
  };
  return (m.survey ??= blueTopoGrid(m.fine, tilesAt, fetcher).catch(e => ({ error: e.message })));
}
/**
 * Channel bathymetry carved into the existing-conditions ground below the flattened lidar water surface, or the lidar
 * surface put back. Where NOAA BlueTopo has surveyed the bed (harbours, estuaries, tidal rivers) it is used; elsewhere
 * the estimate from regional curves (src/bathymetry.js). Rivers entering the model carry their NLDI drainage area;
 * streams that start inside it use D8 accumulation on the DEM. Rebuilds the scenario and the run inputs.
 */
function applyBathymetry() {
  if (!model) return;
  const m = model, mode = $('bathySel').value;
  if (mode === 'off') { m.zLidar ??= m.base.z.slice(); m.base.z.set(m.zLidar); m.bathy = null; $('bathyNote').textContent = ''; groundCache.clear(); applyScenario(); drawDesign(); resetRun(); return (m.bathyJob = null); }
  $('bathyNote').textContent = 'Looking for surveyed bathymetry (NOAA BlueTopo)…';
  const job = m.bathyJob = surveyOf(m).then((sv) => { if (model === m && m.bathyJob === job && $('bathySel').value === mode) carveBathymetry(m, mode, sv); });
  return job;
}
function carveBathymetry(m, mode, sv) {
  const fine = m.fine, base = m.base, nx = fine.nx, ny = fine.ny, t0 = performance.now();
  m.zLidar ??= base.z.slice(); base.z.set(m.zLidar); m.bathy = null;
  const seeds = [];
  for (const w of (m.osm.waterways || []).filter(w => /river|stream|canal/.test(w.kind))) {
    const pts = toCells(fine, w.line);
    for (let s = 0; s + 1 < pts.length; s++) { const [ax, ay] = pts[s], [bx, by] = pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let t = 0; t <= n; t++) { const i = Math.floor(ax + (bx - ax) * t / n), j = Math.floor(ay + (by - ay) * t / n); if (i >= 0 && j >= 0 && i < nx && j < ny) seeds.push(j * nx + i); } }
  }
  const water = flatWater(m.zLidar, nx, ny, seeds);
  m.acc ??= accumulation(m.zLidar, nx, ny);
  const r = carveChannels(m.zLidar, nx, ny, fine.dx, water, { entries: inflow.entries.filter(en => en.areaKm2).map(en => ({ x: en.at[0], y: en.at[1], areaKm2: en.areaKm2 })), curve: CURVES[mode], acc: m.acc });
  // the bed's sources in order of trust: BlueTopo's survey, then HEC-RAS cross-sections (Area → Cross-sections), then the curves
  const beds = m.xsBed ? RAS.layerBeds(sv?.cells ? sv.z : null, m.xsBed.z, nx * ny) : sv?.cells ? { z: sv.z } : null;
  const mg = beds ? mergeSurvey(m.zLidar, water, beds.z, r.dz, fine.dx * fine.dx) : null, dz = mg ? mg.dz : r.dz, volume = mg ? mg.volume.surveyed + mg.volume.estimated : r.volume;
  for (let k = 0; k < dz.length; k++) if (dz[k]) base.z[k] = m.zLidar[k] - dz[k];
  let xsCells = 0, xsVol = 0; if (m.xsBed) for (let k = 0; k < dz.length; k++) if (water[k] && !(sv?.cells && !Number.isNaN(sv.z[k])) && !Number.isNaN(m.xsBed.z[k])) { xsCells++; xsVol += dz[k] * fine.dx * fine.dx; }
  const bt = mg ? mg.surveyed - xsCells : 0;
  m.bathy = { curve: mode, dz, comps: r.comps, volume, surveyed: bt ? { cells: bt, volume: mg.volume.surveyed - xsVol, tiles: sv.tiles } : null, ...(xsCells ? { xs: { cells: xsCells, volume: xsVol, source: m.xsBed.label } } : {}) };
  const big = [...r.comps].sort((a, b) => b.areaKm2 - a.areaKm2)[0], nWater = water.reduce((a, b) => a + b, 0);
  const surveyText = (bt ? `Surveyed bed (NOAA BlueTopo ${sv.tiles.map(t => `${t.tile}, ${t.resolution}, ${String(t.delivered).slice(0, 10)}`).join('; ')}) under ${Math.round(100 * bt / Math.max(1, nWater))}% of the river surface: ${fmtVol(mg.volume.surveyed - xsVol)} below it; the rest estimated. `
    : sv?.error ? `No surveyed bathymetry (BlueTopo unavailable: ${sv.error}). ` : 'No surveyed bathymetry here (NOAA BlueTopo). ') +
    (m.xsBed ? `HEC-RAS cross-sections (${m.xsBed.label}) under ${Math.round(100 * xsCells / Math.max(1, nWater))}% of the river surface: ${fmtVol(xsVol)} below it. ` : '');
  $('bathyNote').textContent = surveyText + (r.comps.length ? `${r.comps.length} channel${r.comps.length > 1 ? 's' : ''} below the lidar water surface: ${fmtVol(volume)} of channel (starts full).` +
    (big ? ` Largest: ${(big.areaKm2 / 2.589988).toFixed(big.areaKm2 < 26 ? 2 : 0)} mi² drainage, bankfull ${(big.W / 0.3048).toFixed(0)} ft wide × ${(big.D / 0.3048).toFixed(1)} ft deep, banks ${(big.bank / 0.3048).toFixed(1)} ft above the water → ${(big.dc / 0.3048).toFixed(1)} ft below it at the centre (estimated).` : '') +
    ` ${CURVES[mode].label} curve (Bieger et al. 2015) where not surveyed: an estimate; use surveyed sections where you have them.` : 'No flattened river surface found to carve.');
  if (xsCells) log(`Channel bed from HEC-RAS cross-sections (${m.xsBed.label}): under ${Math.round(xsCells * fine.dx ** 2).toLocaleString()} m² of river, ${fmtVol(xsVol)} below the lidar water surface`, 'ok', 'HEC-RAS geometry, interpolated between sections');
  if (bt) log(`Surveyed bathymetry: NOAA BlueTopo under ${Math.round(bt * fine.dx ** 2).toLocaleString()} m² of river, ${fmtVol(mg.volume.surveyed - xsVol)} below the lidar water surface`, 'ok', 'NOAA National Bathymetric Source (BlueTopo)');
  log(`Channel bathymetry (${CURVES[mode].label} where not surveyed): ${fmtVol(volume)} below the lidar water surface, ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'ok', 'Bieger et al. 2015 regional curves; NLDI drainage areas');
  groundCache.clear(); applyScenario(); drawDesign(); resetRun();
}
$('bathySel').onchange = () => { if (model) applyBathymetry(); };
/** The carved depth on the solver grid (mean over each cell's 1 m pixels) and the lidar surface above the bed. */
function bathyCells(c, F) {
  const fine = model.fine, W = fine.nx, fill = new Float64Array(c.nx * c.ny);
  for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) { let s = 0; for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) s += model.bathy.dz[j * W + i]; fill[J * c.nx + I] = s / (F * F); }
  c.bathyFill = fill; c.zSurf = c.z.map((v, k) => v + fill[k]);
}
function startWater(c, F, stageCells) {
  if ($('startWater').value !== 'gauge') return null;
  const ls = run.levelSrc, st = currentStorm(), tide = stageAt(st, 0), sources = [...(ls?.sources ?? [])];
  let water = ls?.water;
  if (tide != null && stageCells?.length) {
    if (!water) { const fine = model.fine; water = waterCells(c, F, fine, model.nlcd, (model.osm.waterways || []).filter(w => /river|stream|canal|tidal/.test(w.kind)).map(w => toCells(fine, w.line))); }
    const cells = stageCells.filter(k => water[k]); if (cells.length) sources.push({ cells, level: tide });
  }
  if (!sources.length) { $('startNote').textContent = 'No usable gauge level for this run: the water bodies start at the lidar surface.' + (ls?.notes.length ? ' ' + ls.notes.join('; ') + '.' : ''); return null; }
  const s = startDepths(c, water, sources, { surfR: Math.ceil(60 / (F * model.fine.dx)) }); // decks and bank pixels within 60 m take the river under them
  let vol = 0, wet = 0; for (let k = 0; k < s.depth.length; k++) if (s.depth[k] > 0) { vol += s.depth[k]; wet++; }
  const A = (F * model.fine.dx) ** 2, msg = `Starting water: ${fmtVol(vol * A)} on ${(wet * A / 1e4).toFixed(2)} ha.` + (ls?.notes.length ? ' ' + ls.notes.join('; ') + '.' : '') + (tide != null && stageCells?.length ? ` ${run.outlet ? 'River outlet edge' : 'Tidal water'} at ${tide.toFixed(2)} m NAVD88.` : '');
  $('startNote').textContent = msg; log(msg, 'ok', 'USGS NWIS');
  return s;
}
async function setupInflow() {
  const fine = model.fine, ringC = model.poly ? model.poly.map(([lo, la]) => fine.lonlatToCell(lo, la)) : null;
  const inside = (i, j) => i >= 0 && j >= 0 && i < fine.nx && j < fine.ny && (!ringC || insideRing(i, j, ringC));
  inflow.entries = riverEntries(fine, model.osm.waterways, inside);
  $('inflowBox').hidden = !inflow.entries.length;
  if (!inflow.entries.length) { inflow.gauges = []; inflow.levels = await findLevelGauges(fine.lonlatBounds(0.02), fetcher).catch(() => []); startNoteUpdate(); if ($('bathySel').value !== 'off') applyBathymetry(); return; }
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
      <select id="inGauge${i}" aria-label="Gauge"><option value="">No inflow</option>${ungaugedOptions()}${ranked.slice(0, 12).map(g => `<option value="${g.site}"${g === pick ? ' selected' : ''}>${g.name} (${g.areaMi2 ? g.areaMi2.toLocaleString() + ' mi², ' : ''}${(g.d / 1000).toFixed(1)} km ${g.up ? 'upstream' : g.altM != null ? 'downstream' : 'away'})</option>`).join('')}</select>
      <select id="inFlow${i}" aria-label="Flow"><option value="event">Recorded flows (historic storms)</option><option value="storm">Design: the storm's return period</option>${[2, 10, 25, 50, 100].map(T => `<option value="${T}"${T === 10 ? ' selected' : ''}>Design: ${T}-yr peak flow</option>`).join('')}</select>
      <label class="field" style="margin:0"><span>River peak after the rain peak (h)</span><input id="inLag${i}" type="number" step="0.5" value="0" style="width:5em"></label>
      <label class="toggle"><input type="checkbox" id="inScale${i}" checked> Scale to the drainage area where it enters</label> <span class="note" id="inArea${i}"></span>${ungaugedControls(i)}</div>`;
  }).join('');
  for (let i = 0; i < inflow.entries.length; i++) for (const id of ['inGauge', 'inFlow', 'inLag', 'inScale']) $(id + i).onchange = () => { if (model && (!run || !run.solver)) resetRun(); inflowNoteUpdate(); areaNote(i); };
  for (let i = 0; i < inflow.entries.length; i++) ungaugedWire(i);
  for (const id of ['inExp', 'warmUp', 'outGauge', 'outLen', 'outReach', 'outDepth']) $(id).onchange =() => { if (model && (!run || !run.solver)) resetRun(); for (let i = 0; i < inflow.entries.length; i++) areaNote(i); };
  inflowNoteUpdate();
  inflow.entries.forEach((en, i) => { // the drainage area where each river enters (USGS NLDI), in the background
    const [lo, la] = ll(en.at); en.area = basinAreaKm2(lo, la, fetcher).then((a) => { en.areaKm2 = a.areaKm2; areaNote(i); return a; }).catch((e) => { en.areaErr = e.message; areaNote(i); return null; });
  });
  Promise.allSettled(inflow.entries.map(en => en.area)).then(() => { if ($('bathySel').value !== 'off') applyBathymetry(); });
}
/** The entry's drainage area against its gauge's, and the factor its flow is scaled by. → { k, text } */
function entryScale(i) {
  const en = inflow.entries[i], g = en?.ranked?.find(x => x.site === $('inGauge' + i)?.value), b = Number($('inExp').value) || 0.8;
  if (!g) return { k: 1, text: '' };
  if (!$('inScale' + i)?.checked) return { k: 1, text: 'flows as measured at the gauge' };
  if (en.areaKm2 == null) return { k: 1, text: en.areaErr ? `drainage area unavailable (${en.areaErr}): flows as measured` : 'finding the drainage area…' };
  if (!g.areaMi2) return { k: 1, text: 'the gauge has no published drainage area: flows as measured' };
  const s = areaRatioScale(en.areaKm2, g.areaMi2 * 2.589988, b);
  return { k: s.k, text: `enters draining ${(en.areaKm2 / 2.589988).toLocaleString(undefined, { maximumFractionDigits: 1 })} mi² vs the gauge's ${g.areaMi2.toLocaleString()} mi²: × ${s.k.toFixed(3)} (ratio ${s.ratio.toFixed(2)}^${b})${s.ok ? '' : ' — outside 0.5–1.5, where the transfer is weak'}` };
}
function areaNote(i) { const el = $('inArea' + i); if (el) el.textContent = entryScale(i).text; ungaugedNote(i); }
function inflowNoteUpdate() {
  const on = inflow.entries.filter((_, i) => $('inGauge' + i)?.value).length;
  $('inflowNote').textContent = !inflow.gauges.length ? 'No USGS discharge gauges within ~15 km: the river enters dry unless you give it a flow.'
    : `${on} of ${inflow.entries.length} river ${inflow.entries.length > 1 ? 'entries' : 'entry'} with an inflow. A gauge counts the whole basin above it: each entry's flow is scaled by its drainage area against the gauge's (USGS NLDI basins, NWIS areas) unless you untick it. Recorded flows need a historic storm (15-minute data since about 2007). A river with no gauge takes its peak from USGS StreamStats (the state's regression equations) or from you, on the NRCS unit hydrograph.`;
}
/** Each entry's flow as a function of model time (s), fetched before the run starts. */
async function prepareInflow() {
  const out = [], st = currentStorm();
  for (let i = 0; i < inflow.entries.length; i++) {
    const site = $('inGauge' + i)?.value; if (!site) continue;
    if (site in UNGAUGED) { out.push(await ungaugedEntry(i, st)); continue; } // ungauged inflows block
    const en = inflow.entries[i], g = en.ranked.find(x => x.site === site), mode = $('inFlow' + i).value, lag = Number($('inLag' + i).value) * 3600;
    let flow, label;
    if (mode === 'event') {
      if (!st?.t0) throw new Error(`recorded flows need a historic storm (pick one under Storm, or a design peak for ${g.name})`);
      const series = await gaugeFlows(site, st.t0 - 3600e3, st.t0 + (tStop() + 3600) * 1000, fetcher);
      if (!series.length) throw new Error(`${g.name} has no 15-minute flows for this storm`);
      flow = recordedHydrograph(series, st.t0); label = `${g.name}, recorded (peak ${(Math.max(...series.map(p => p.q)) / CFS).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs)`;
    } else {
      if (!inflow.peaks.has(site)) inflow.peaks.set(site, await annualPeaks(site, fetcher));
      const T = entryT(i, st); if (!(T > 0)) throw new Error(`${g.name}: "the storm's return period" needs a design storm: pick a return period`);
      const peaks = inflow.peaks.get(site), q = lp3(peaks, T); if (!q) throw new Error(`${g.name}: too few annual peaks for a frequency estimate`);
      const peakAt = st.intensity.indexOf(Math.max(...st.intensity)) * st.blockMin * 60 + st.blockMin * 30; // middle of the rain's peak block
      // the base: the gauge's flow at the start (latest reading) when known, else 5 % of the peak
      const q0 = run?.levelsReady?.flows?.get(site), base = q0 != null ? Math.min(q0, 0.5 * q) : 0.05 * q;
      flow = designHydrograph(q, Math.max(600, peakAt + lag), { base });
      label = `${g.name}, ${T}-yr peak ${(q / CFS).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs (log-Pearson III on ${peaks.length} annual peaks), base ${(base / CFS).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs (${q0 != null ? 'gauge reading' : '5 % of the peak'})`;
    }
    await en.area; const sc = entryScale(i); // the drainage-area transfer (1 when off or unknown)
    if (sc.k !== 1) label += `, × ${sc.k.toFixed(3)} for the drainage area where it enters`;
    out.push({ at: en.at, flow, label, site, name: en.name, ...(sc.k !== 1 ? { scale: sc.k } : {}) });
  }
  if (out.length) log('River inflow: ' + out.map(e => e.label).join('; '), 'ok', out.some(e => e.ungauged) ? 'USGS NWIS, StreamStats' : 'USGS NWIS');
  return out;
}

// ---- ungauged inflows (src/streamstats.js)
// A river with no gauge to transfer from: its T-year peak from the state's USGS regional regression (StreamStats), or
// a peak the user gives (e.g. the FIS discharge table), shaped as the NRCS dimensionless unit hydrograph and timed by
// the NRCS lag equation from the basin's characteristics (StreamStats), or from its NLDI area with stated defaults.
const UNGAUGED = { ss: 'Ungauged: USGS StreamStats regression peak', custom: 'Ungauged: your own peak flow (e.g. the FIS discharge table)' };
const ungaugedOptions = () => Object.entries(UNGAUGED).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
const ungaugedControls = (i) => `<span id="inUng${i}" hidden><label class="field" style="margin:0"><span>Peak flow (cfs) for the return period</span><input id="inPeak${i}" type="number" step="10" min="0" style="width:7em"></label></span><p class="note" id="inSS${i}" hidden></p>`;
const entryLonLat = (en) => fromUTM(model.fine.x0 + en.at[0] * model.fine.dx, model.fine.y1 - en.at[1] * model.fine.dx, model.fine.zone);
const cfsText = (q) => Math.round(q / CFS).toLocaleString();
/** The NHDPlus reach USGS NLDI puts a point on: StreamStats retries there when the mapped river is off its stream grid. */
async function flowlineNear(lon, lat) {
  const r = await fetcher(`https://api.water.usgs.gov/nldi/linked-data/comid/position?f=json&coords=POINT(${lon.toFixed(6)} ${lat.toFixed(6)})`);
  return r.ok ? (await r.json()).features?.[0]?.geometry?.coordinates ?? null : null;
}
/** The entry's StreamStats peaks: asked once (in the background as soon as the entry is set to it; about 20–40 s). */
function streamStatsFor(i) {
  const en = inflow.entries[i];
  if (!en.ss) {
    const [lon, lat] = entryLonLat(en), say = (t) => { if ($('inGauge' + i)?.value === 'ss') { const el = $('inSS' + i); el.hidden = false; el.textContent = 'StreamStats: ' + t; } };
    en.ssErr = null;
    en.ss = flowlineNear(lon, lat).catch(() => null).then(line => SSX.streamStatsPeaks(lon, lat, fetcher, { flowline: line, progress: say }))
      .then((r) => { en.ssResult = r; ungaugedNote(i); return r; }, (e) => { en.ssErr = e.message; en.ss = null; ungaugedNote(i); throw e; });
    en.ss.catch(() => {});
  }
  return en.ss;
}
/** The return period an entry's flow is for: the storm's, or the one picked. */
function entryT(i, st) {
  const m = $('inFlow' + i).value;
  return m === 'storm' ? (st?.ari > 0 ? st.ari : NaN) : m === 'event' ? NaN : Number(m);
}
/** NRCS lag for an ungauged entry: StreamStats' slope and impervious share where it has them, else stated defaults. */
function ungaugedTiming(en, src) {
  const r = src === 'ss' ? en.ssResult : null, areaKm2 = r?.areaKm2 ?? en.areaKm2; if (!(areaKm2 > 0)) return null;
  const cn = r?.imperviousPct != null ? SSX.cnFromImpervious(r.imperviousPct) : 75, slopePct = r?.slopePct ?? 2;
  const assumed = [r?.imperviousPct == null ? 'CN 75 (no impervious share)' : null, r?.slopePct == null ? 'slope 2 % (no basin slope)' : null].filter(Boolean);
  return { ...SSX.nrcsLag({ areaKm2, slopePct, cn, lengthFt: r?.lengthFt ?? null }), cn, slopePct, areaKm2, assumed };
}
/** The entry's note: the basin, the equation, the peak and its interval, the timing, the warnings. */
function ungaugedNote(i) {
  const el = $('inSS' + i), src = $('inGauge' + i)?.value; if (!el) return;
  $('inUng' + i).hidden = src !== 'custom'; el.hidden = !(src in UNGAUGED); if (el.hidden) return;
  const en = inflow.entries[i], st = currentStorm(), T = entryT(i, st), tm = ungaugedTiming(en, src), out = [];
  if (!(T > 0)) out.push($('inFlow' + i).value === 'event' ? 'An ungauged river has no recorded flows: pick a design return period.' : 'Pick a return period (this storm has none).');
  if (src === 'ss') {
    const r = en.ssResult;
    if (en.ssErr) out.push(`StreamStats failed: ${en.ssErr}. Give a peak yourself (“your own peak flow”), or pick a gauge.`);
    else if (!r) out.push('StreamStats: asking…');
    else {
      const pk = T > 0 ? SSX.peakAt(r.peaks, T) : null, eq = r.regions.filter(g => !g.averaged).map(g => g.name.replace(/_/g, ' ')).join(' + ');
      out.push(`Basin ${(r.areaKm2 / 2.589988).toLocaleString(undefined, { maximumFractionDigits: 1 })} mi² (StreamStats ${r.state}${r.snappedM ? `, snapped ${Math.round(r.snappedM)} m to the stream` : ''})${en.areaKm2 ? `; NLDI says ${(en.areaKm2 / 2.589988).toFixed(1)} mi²` : ''}. Equations: ${eq}.`);
      if (pk) out.push(`${T}-yr peak ${cfsText(pk.q)} cfs${Number.isFinite(pk.lo) ? `, 90 % interval ${cfsText(pk.lo)}–${cfsText(pk.hi)} cfs (${pk.how})` : ''}.`);
      else if (T > 0) out.push(`StreamStats publishes ${r.peaks[0].T}–${r.peaks.at(-1).T}-yr peaks, not ${T}-yr.`);
      if (en.areaKm2 && Math.abs(Math.log(r.areaKm2 / en.areaKm2)) > Math.log(1.3)) out.push('The StreamStats and NLDI basins differ by more than 30 %: check that the entry is on the river you mean.');
      out.push(...r.warnings.map(w => 'Note: ' + w + '.'));
    }
  } else if (!en.areaKm2) out.push(en.areaErr ? `Drainage area unavailable (${en.areaErr}): the timing needs it.` : 'Finding the drainage area (NLDI)…');
  if (tm) out.push(`Timing: NRCS lag ${tm.lagH.toFixed(1)} h (hydraulic length ${(tm.lengthFt / 5280).toFixed(1)} mi from ${tm.lengthFrom}, slope ${tm.slopePct.toFixed(1)} %, CN ${tm.cn.toFixed(0)}${tm.assumed.length ? '; assumed ' + tm.assumed.join(', ') : ''}); the river peaks that long after the rain's peak block, plus the shift set here. ${tm.warnings.map(w => 'Note: ' + w + '.').join(' ')}`);
  el.textContent = out.join(' ');
}
/** Wire an entry's source picker: StreamStats asked in the background, the storm's return period by default. */
function ungaugedWire(i) {
  $('inGauge' + i).addEventListener('change', () => {
    const src = $('inGauge' + i).value;
    if (src in UNGAUGED && ($('inFlow' + i).value === 'event' || currentStorm()?.ari > 0)) $('inFlow' + i).value = 'storm'; // a design storm: its return period (still editable)
    if (src === 'ss') streamStatsFor(i).catch(() => {});
    ungaugedNote(i);
  });
  for (const id of ['inFlow', 'inLag', 'inPeak']) $(id + i).addEventListener('change', () => ungaugedNote(i));
}
/** An ungauged entry's inflow for prepareInflow. */
async function ungaugedEntry(i, st) {
  const en = inflow.entries[i], src = $('inGauge' + i).value, name = en.name || 'Unnamed ' + en.kind, T = entryT(i, st);
  if ($('inFlow' + i).value === 'event') throw new Error(`${name} has no gauge, so no recorded flows: pick a design return period for it`);
  if (!(T > 0)) throw new Error(`${name}: "the storm's return period" needs a design storm (Atlas 14 or the site record): pick a return period`);
  let pk, r = null, how;
  if (src === 'ss') {
    r = await streamStatsFor(i); pk = SSX.peakAt(r.peaks, T);
    if (!pk) throw new Error(`${name}: StreamStats publishes ${r.peaks[0].T}–${r.peaks.at(-1).T}-yr peaks, not ${T}-yr`);
    how = `USGS StreamStats ${r.state}, ${r.regions.filter(g => !g.averaged).map(g => g.name.replace(/_/g, ' ')).join(' + ')}`;
  } else {
    const q = Number($('inPeak' + i).value) * CFS; if (!(q > 0)) throw new Error(`${name}: give the ${T}-yr peak flow (cfs)`);
    await en.area; pk = { T, q, lo: NaN, hi: NaN, se: null, how: 'given' }; how = 'peak given';
  }
  const tm = ungaugedTiming(en, src); if (!tm) throw new Error(`${name}: no drainage area for the timing (USGS NLDI: ${en.areaErr ?? 'not found'})`);
  const rainPeak = (st.intensity.indexOf(Math.max(...st.intensity)) + 0.5) * st.blockMin * 60; // middle of the rain's peak block
  const tPeak = rainPeak + (tm.lagH + Number($('inLag' + i).value)) * 3600, tp = tm.tpH * 3600, base = 0.05 * pk.q;
  const flow = SSX.ungaugedHydrograph(pk.q, { tPeak, tp, base }), runoffMm = flow.volume / (tm.areaKm2 * 1e6) * 1000;
  const warnings = [...(r?.warnings ?? []), ...tm.warnings];
  if (runoffMm > st.total) warnings.push(`the hydrograph carries ${runoffMm.toFixed(0)} mm of runoff from the basin, more than the storm's ${st.total.toFixed(0)} mm of rain: a peak this size comes from a longer or wetter storm than this one`);
  if (tPeak > tStop()) warnings.push(`the river peaks at ${(tPeak / 3600).toFixed(1)} h, after the run ends (${(tStop() / 3600).toFixed(1)} h): lengthen the run to see it`);
  for (const w of warnings) log(`${name}: ${w}`, 'warn');
  const label = `${name}, ungauged: ${T}-yr peak ${cfsText(pk.q)} cfs (${how}${Number.isFinite(pk.lo) ? `; 90 % ${cfsText(pk.lo)}–${cfsText(pk.hi)} cfs` : ''}), NRCS unit hydrograph, lag ${tm.lagH.toFixed(1)} h, base 5 % of the peak`;
  const ungauged = { source: src === 'ss' ? 'USGS StreamStats regression' : 'peak given', how, T, peak: pk.q, lo: pk.lo, hi: pk.hi, se: pk.se, interval: pk.how, interpolated: !!pk.interpolated,
    state: r?.state ?? null, regions: r?.regions.map(g => ({ name: g.name, code: g.code, weight: g.weight, params: g.params })) ?? null, peaks: r?.peaks.map(p => ({ T: p.T, q: p.q, lo: p.lo, hi: p.hi, se: p.se })) ?? null,
    areaKm2: tm.areaKm2, nldiKm2: en.areaKm2 ?? null, imperviousPct: r?.imperviousPct ?? null, slopePct: tm.slopePct, cn: tm.cn, lengthFt: tm.lengthFt, lengthFrom: tm.lengthFrom, assumed: tm.assumed,
    lagH: tm.lagH, tpH: tm.tpH, tPeakS: tPeak, runoffMm, rainMm: st.total, snappedM: r?.snappedM ?? 0, warnings };
  return { at: en.at, flow, label, site: src === 'ss' ? 'streamstats' : 'given', name: en.name, ungauged };
}
/** The run's river inflow for the report and the saved run: each entry's hydrograph (5-minute samples, as it went in). */
function inflowRecord(r) {
  const N = Math.floor(tStop() / 300);
  return (r.inflowReady ?? []).map(e => ({ name: e.name || '', label: e.label, site: e.site ?? null, scale: e.scale ?? 1, ungauged: e.ungauged ?? null,
    series: Array.from({ length: N + 1 }, (_, k) => [k * 300, +((typeof e.flow === 'function' ? e.flow(k * 300) : e.flow) * (e.scale ?? 1)).toFixed(4)]) }));
}
// ---- end of ungauged inflows

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
      S.obs = v; S.obsEvent = sel.value; drawObs(); obsNote(); if (run?.hmax && !run.playing && run.solver) scoreAndShow();
      note.textContent += ` From ${sel.value}.${currentStorm()?.t0 ? '' : ' Load the same storm under Storm → historic to replay it.'}`;
    };
    note.textContent = `${marks.length} USGS high-water marks in or near the area, from ${byEvent.size} event${byEvent.size > 1 ? 's' : ''}: pick one to use them as observations.`;
    const ev = matchEvent([...byEvent.keys()].map(k => k.replace('USGS STN, ', '')), currentStorm() ?? {}); // the loaded historic storm's event
    if (ev) { sel.value = 'USGS STN, ' + ev; sel.onchange(); note.textContent += ` Picked ${ev}, the loaded storm's event.`; }
  } catch (e) { note.textContent = 'High-water marks unavailable: ' + e.message; }
};

// ------------------------------------------------------------------ calibration
const cal = () => ({ manning: Number($('calManning').value), infil: Number($('calInfil').value), clog: Number($('calClog').value) });
/** A number field's value clamped to its range; a blank or bad entry takes the field's default. */
function numField(id) { const el = $(id), x = Number(el.value); return el.value !== '' && Number.isFinite(x) ? Math.min(Number(el.max), Math.max(Number(el.min), x)) : Number(el.defaultValue); }
/** Drainage → Inlet hydraulics. */
function inletHydraulics() {
  const v = numField;
  return { opts: { inletArea: v('inletArea'), inletPerim: v('inletPerim'), Cw: v('inletCw'), Co: v('inletCo') }, crest: v('inletCrest') / 100 };
}
/** The inlet hydraulics for a run's forcing record, only when changed from the defaults: runs made before the fields existed keep their fingerprint. */
const inletRecord = () => {
  const ih = inletHydraulics(), changed = ['inletArea', 'inletPerim', 'inletCw', 'inletCo', 'inletCrest'].some(id => Number($(id).value) !== Number($(id).defaultValue));
  return changed ? { inlets: { ...ih.opts, crestM: ih.crest } } : {};
};
// Kind of inlet: each fills the four grate fields (area, weir length, Cw, Co); the crest stays as set. Editing a field
// shows the kind it now matches, or Custom.
const INLET_FIELDS = ['inletArea', 'inletPerim', 'inletCw', 'inletCo'];
const INLET_TYPES = Object.fromEntries(GENERIC_KINDS.map(k => [k, { v: INLET_KINDS[k].v, hint: INLET_KINDS[k].basis }])); // src/inlettypes.js
function syncInletType(keep) {
  const cur = INLET_FIELDS.map(id => Number($(id).value));
  const k = keep ?? Object.keys(INLET_TYPES).find(t => INLET_TYPES[t].v.every((x, i) => x === cur[i])) ?? 'custom';
  $('inletType').value = k;
  $('inletTypeHint').textContent = INLET_TYPES[k]?.hint ?? 'Your own numbers. Pick a kind of inlet to start again from one.';
}
$('inletType').addEventListener('change', () => {
  const t = INLET_TYPES[$('inletType').value];
  if (t) INLET_FIELDS.forEach((id, i) => { $(id).value = t.v[i]; });
  syncInletType(t ? undefined : 'custom');
});
for (const id of INLET_FIELDS) $(id).addEventListener('input', () => syncInletType());
syncInletType();
// Drainage → Inlet hydraulics → Inlet types in the data (src/inlettypes.js): each type in the area's inlet layer takes a
// kind of inlet from the standard (by default NCDOT in North Carolina, none elsewhere) or the kind picked for it, and its
// grates use that kind's opening, weir length and coefficients. Types without one use the values above.
const escHTML = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inletPicks = () => { try { const p = JSON.parse($('inletTypePicks').value || '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; } };
/** The standard in use: the one picked, or for Automatic the one whose region holds the area ('none' outside them all). */
function inletStandard() { const v = $('inletStd').value; return v === 'auto' ? (model ? defaultStandard(...model.site) : 'none') : v; }
/** The inlet records the network will use (as makeNetwork picks them). */
function typedInlets() { if (!model) return []; const lay = infra.inputs(), L = model.linked; return lay?.inlets.length ? lay.inlets : L?.inlets.length ? L.inlets : model.util?.inlets ?? []; }
const inletKinds = (inlets) => typeKinds(inletTypeCounts(inlets), inletStandard(), inletPicks());
/** The kinds by type for a run's forcing record ({ type: kind }), only when some type has one: other runs keep their fingerprint. */
const inletTypesRecord = () => {
  const k = inletKinds(typedInlets());
  return Object.keys(k).length ? { inletTypes: Object.fromEntries(Object.entries(k).sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => [t, v.kind + (INLET_KINDS[v.kind].perSide ? ' x' + v.sides : '')])) } : {};
};
function renderInletTypes() {
  const tab = $('inletTypeTable'), notes = $('inletKindNotes'), v = $('inletStd').value, std = inletStandard(), S0 = INLET_STANDARDS[std];
  $('inletStdHint').textContent = v === 'auto'
    ? (!model ? 'Picked when the area loads: NCDOT in North Carolina, none elsewhere.' : S0 ? `${S0.label}, as the area is in North Carolina.` : 'No standard for where this area is: each type uses the values above unless you pick a kind for it.')
    : v === 'none' ? 'Each type uses the values above unless you pick a kind for it.' : `Each type takes the ${S0.label.split(' (')[0]} kind for it, unless you pick another.`;
  const types = inletTypeCounts(typedInlets()), named = types.filter(t => t.type != null), untyped = types.find(t => t.type == null);
  if (!named.length) { tab.hidden = true; tab.innerHTML = ''; notes.textContent = model ? 'The inlets here have no type in their data, so every one uses the values above.' : 'Load an area: the types in its inlet data are listed here.'; return; }
  const picks = inletPicks(), kinds = typeKinds(types, std, picks), label = (k, sides) => INLET_KINDS[k].label + (INLET_KINDS[k].perSide ? ` × ${sides}` : '');
  tab.hidden = false;
  tab.innerHTML = '<thead><tr><th>Type</th><th>Inlets</th><th>Kind of inlet</th></tr></thead><tbody>' + named.map(t => {
    const stdKind = t.cls ? S0?.kinds[t.cls] : null, p = picks[t.type] ?? 'auto';
    const auto = stdKind ? 'Standard: ' + label(stdKind, t.sides) : 'Values above';
    const cur = p === 'auto' ? auto : p === 'area' ? 'Values above' : INLET_KINDS[p] ? label(p, t.sides) : auto;
    return `<tr><td>${escHTML(t.type)}</td><td>${t.count.toLocaleString()}</td><td><select data-type="${escHTML(t.type)}" title="${escHTML(cur)}" aria-label="Kind of inlet for type ${escHTML(t.type)}">` +
      `<option value="auto"${p === 'auto' ? ' selected' : ''}>${escHTML(auto)}</option><option value="area"${p === 'area' ? ' selected' : ''}>Values above</option>` +
      Object.keys(INLET_KINDS).map(k => `<option value="${k}"${p === k ? ' selected' : ''}>${escHTML(label(k, t.sides))}</option>`).join('') + '</select></td></tr>';
  }).join('') + (untyped ? `<tr><td><i>no type</i></td><td>${untyped.count.toLocaleString()}</td><td>Values above</td></tr>` : '') + '</tbody>';
  const n = named.filter(t => kinds[t.type]).reduce((s, t) => s + t.count, 0), all = types.reduce((s, t) => s + t.count, 0);
  const used = [...new Set(Object.values(kinds).map(k => k.kind))];
  notes.innerHTML = (n === all ? `All ${all.toLocaleString()} inlets take their own grate from their type.` : `${n.toLocaleString()} of ${all.toLocaleString()} inlets take their own grate from their type; the others use the values above.`) + ` The crest and the debris (Calibration) apply to every inlet.` +
    used.map(k => `<br><b>${escHTML(INLET_KINDS[k].label)}.</b> ${escHTML(INLET_KINDS[k].basis)}${INLET_KINDS[k].est ? ` <i>Estimated: ${escHTML(INLET_KINDS[k].est)}.</i>` : ''}`).join('');
}
$('inletTypeTable').addEventListener('change', (e) => {
  const t = e.target.dataset?.type; if (t == null) return;
  const p = inletPicks(); if (e.target.value === 'auto') delete p[t]; else p[t] = e.target.value;
  $('inletTypePicks').value = JSON.stringify(p); $('inletTypePicks').dispatchEvent(new Event('change')); // resets the run
  renderInletTypes();
});
for (const ev of ['input', 'change']) { $('inletStd').addEventListener(ev, renderInletTypes); $('inletTypePicks').addEventListener(ev, renderInletTypes); }
renderInletTypes();
// Drainage → Pipe solver settings: SWMM's dynamic-wave options (src/drainage.js ROUTING_DEFAULTS), with presets that fill
// every field. The head tolerance is entered in mm.
const SWMM_FIELDS = ['swmmStep', 'swmmVarStep', 'swmmHeadTol', 'swmmTrials', 'swmmMinArea', 'swmmSurcharge', 'swmmDamping', 'swmmNormal', 'swmmMinSlope', 'swmmLengthen'];
const SWMM_BALANCED = { swmmStep: 1, swmmVarStep: 0.75, swmmHeadTol: 1.5, swmmTrials: 8, swmmMinArea: 1.2, swmmSurcharge: 'SLOT', swmmDamping: 'PARTIAL', swmmNormal: 'BOTH', swmmMinSlope: 0, swmmLengthen: true };
const SWMM_PRESETS = {
  balanced: SWMM_BALANCED,
  accurate: { ...SWMM_BALANCED, swmmStep: 0.5, swmmVarStep: 0.5, swmmHeadTol: 0.5, swmmTrials: 20 },
  fast: { ...SWMM_BALANCED, swmmStep: 2, swmmHeadTol: 5, swmmTrials: 4 },
};
const swmmField = (id) => { const el = $(id); return el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value); };
function swmmRouting() {
  return { routingStep: numField('swmmStep'), variableStep: numField('swmmVarStep'), headTol: numField('swmmHeadTol') / 1000, maxTrials: Math.round(numField('swmmTrials')),
    minSurfArea: numField('swmmMinArea'), minSlope: numField('swmmMinSlope'), surcharge: $('swmmSurcharge').value, inertialDamping: $('swmmDamping').value,
    normalFlowLimited: $('swmmNormal').value, lengthen: $('swmmLengthen').checked };
}
/** A run's inlet and pipe solver settings where they differ from the defaults ({ inlets, routing }), else null: the
 *  forcing record's drainSettings part, which a settings test may differ in (src/compare.js comparable). */
const drainSettings = () => { const s = { ...inletRecord(), ...inletTypesRecord(), ...routingRecord() }; return Object.keys(s).length ? s : null; };
/** The SWMM settings for a run's forcing record, only those changed from the defaults (older runs keep their fingerprint). */
const routingRecord = () => {
  const ch = Object.entries(swmmRouting()).filter(([k, x]) => typeof x === 'number' ? Math.abs(x - ROUTING_DEFAULTS[k]) > 1e-12 : x !== ROUTING_DEFAULTS[k]);
  return ch.length ? { routing: Object.fromEntries(ch) } : {};
};
function syncSwmmPreset() {
  $('swmmPreset').value = Object.keys(SWMM_PRESETS).find(k => SWMM_FIELDS.every(id => swmmField(id) === SWMM_PRESETS[k][id])) ?? 'custom';
}
$('swmmPreset').addEventListener('change', () => {
  const pr = SWMM_PRESETS[$('swmmPreset').value]; if (!pr) return;
  for (const id of SWMM_FIELDS) { const el = $(id); if (el.type === 'checkbox') el.checked = pr[id]; else el.value = pr[id]; }
});
for (const id of SWMM_FIELDS) $(id).addEventListener('input', syncSwmmPreset);
syncSwmmPreset();
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
  try { S.obsEvent = 'imported: ' + file.name; S.obs = parseObservations(await file.text(), { units: $('obsUnits').value }); if (!S.obs.length) throw new Error('no points with lat, lon and an observation'); drawObs(); obsNote(); if (run?.hmax && !run.playing && run.solver) scoreAndShow(); }
  catch (e) { $('obsNote').textContent = 'Import failed: ' + e.message; }
};
$('obsClear').onclick = () => { S.obs = []; S.obsEvent = null; drawObs(); obsNote(); $('calScore').textContent = ''; $('calTable').textContent = ''; };
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
/** Peak water surface near a point from the finished run: the highest wet 1 m pixel within r metres whose ground is not
 *  above the point's (+30 cm of lidar noise). Water on higher ground beside a mark, rain running down a wall top or a
 *  steeper street, is not the water that reached it: Manayunk-5 (Ida) took 14.6 m from such a pixel 3 m away, above a
 *  river that crested at 13.2 m there. */
function scoreNow() {
  if (!run?.hmax || !model) return null;
  const fine = model.fine, f = model.f, d = run.F === 1 ? run.hmax : toFine(run.c, run.hmax, 1);
  const at = (lon, lat, r) => {
    const [ci, cj] = fine.lonlatToCell(lon, lat), i0 = Math.floor(ci), j0 = Math.floor(cj); if (i0 < 0 || j0 < 0 || i0 >= fine.nx || j0 >= fine.ny) return null;
    const R = Math.ceil(r / fine.dx); let best = null, ground = f.z[j0 * fine.nx + i0];
    for (let j = Math.max(0, j0 - R); j <= Math.min(fine.ny - 1, j0 + R); j++) for (let i = Math.max(0, i0 - R); i <= Math.min(fine.nx - 1, i0 + R); i++) {
      if (Math.hypot(i - i0, j - j0) * fine.dx > r) continue; const k = j * fine.nx + i; if (f.bld[k] || !(d[k] > 0.01) || f.z[k] > ground + 0.3) continue;
      const w = f.z[k] + d[k]; if (best == null || w > best) best = w;
    }
    return { ground, wse: best };
  };
  return scoreRun(S.obs, at);
}
const ftm = (m) => `${m >= 0 ? '+' : '−'}${Math.abs(m / 0.3048).toFixed(2)} ft (${Math.abs(m * 100).toFixed(0)} cm)`;
/** Scores added after the run was filed in the project (marks picked, maps loaded): its summary.json takes them too. */
async function refileValidation() {
  const ls = projects.lastSaved; if (!ls || ls.run !== run || !run.record?.validation) return;
  try {
    const p = `${ls.dir}/summary.json`, sm = JSON.parse(await readProjectFile(ls.folder, p));
    sm.validation = run.record.validation; await writeProjectFile(ls.folder, p, JSON.stringify(sm, null, 1));
  } catch (e) { console.warn('refiling the scores:', e.message); }
}
// ------------------------------------------------------------------ reference flood maps (src/floodmaps.js)
S.maps = [];
/** Every loaded reference map scored against the finished run's peak depth on the 1 m grid (buildings left out). */
function scoreMaps() {
  if (!run?.hmax || !model) return [];
  const fine = model.fine, d = run.F === 1 ? run.hmax : toFine(run.c, run.hmax, 1), toCell = ([lon, lat]) => fine.lonlatToCell(lon, lat);
  return S.maps.map(ref => ({ ...scoreFloodMap(ref, { nx: fine.nx, ny: fine.ny, dx: fine.dx, toCell, depth: d, exclude: model.f.bld }, { minArea: ref.minArea ?? 0 }), source: ref.source ?? null, observed: ref.observed !== false }));
}
/** Score the maps against the finished run (if any), keep them in its record and show them. */
function mapsShow() {
  const sc = run?.hmax && !run.playing && run.solver ? scoreMaps() : null;
  if (sc && run.record?.validation) { run.record.validation.floodMaps = sc; refileValidation(); }
  mapsNote(sc);
}
function mapsNote(scores = null) {
  const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
  $('mapsNote').innerHTML = !S.maps.length ? $('mapsNote').dataset.empty
    : S.maps.map((m, i) => { const sc = scores?.[i]; return `<b>${m.name}</b>: ${m.polys.length.toLocaleString()} polygons${m.mask ? ', mapped near its marks only' : ''}` +
      (sc ? `. Flooded ≥ 4 in: hit rate ${pct(sc.hitRate)}, false alarms ${pct(sc.falseAlarmRatio)}, CSI ${pct(sc.csi)}; area model / map ${sc.areaRatio?.toFixed(2) ?? '–'}${sc.depth ? `; depth where both flood: bias ${sc.depth.bias >= 0 ? '+' : '−'}${Math.abs(sc.depth.bias).toFixed(2)} m, RMSE ${sc.depth.rmse.toFixed(2)} m` : ''}` : ''); }).join('<br>');
}
$('mapsNote').dataset.empty = $('mapsNote').textContent;
/** A reference map from GeoJSON: NYC DEP Stormwater Flood Maps carry Flooding_Category; anything else needs a depth
 *  field (depth_m in metres, else in the observations' units). DEP maps keep patches of 0.25 acre and up. */
function mapFromGeoJSON(gj, fileName) {
  const props = [...new Set((gj.features ?? []).slice(0, 50).flatMap(f => Object.keys(f.properties ?? {})))];
  const dep = props.includes('Flooding_Category'), field = dep ? 'Flooding_Category' : props.includes('depth_m') ? 'depth_m' : props.find(k => /depth|inundation/i.test(k));
  if (!field) throw new Error('no Flooding_Category or depth field');
  const m = fromGeoJSONMap(gj, dep ? { field, classes: DEP_CLASSES, name: gj.name ?? fileName } : { field, units: field === 'depth_m' || $('obsUnits').value !== 'ft' ? 'm' : 'ft', name: gj.name ?? fileName });
  if (!m.polys.length) throw new Error('no polygons with a usable ' + field);
  return { ...m, source: 'file', observed: !dep, minArea: dep ? 1011.7 : 0 };
}
/** A project's maps: kept whole, or { href } to a GeoJSON file the app serves (the benchmark cases: benchmarks/nyc). */
async function loadMaps(list) {
  const out = [];
  for (const m of list ?? []) {
    if (!m.href) { out.push(m); continue; }
    try { out.push({ ...mapFromGeoJSON(await (await fetch(m.href)).json(), m.href.split('/').pop()), href: m.href }); }
    catch (e) { log(`Flood map ${m.href} not loaded: ${e.message}`, 'warn'); }
  }
  return out;
}
$('mapsImport').onclick = () => $('mapsFile').click();
$('mapsFile').onchange = async () => {
  const file = $('mapsFile').files[0]; $('mapsFile').value = ''; if (!file) return;
  try { S.maps = [...S.maps, mapFromGeoJSON(JSON.parse(await file.text()), file.name)]; mapsShow(); }
  catch (e) { $('mapsNote').textContent = 'Import failed: ' + e.message; }
};
$('mapsClear').onclick = () => { S.maps = []; mapsNote(); };
function scoreAndShow() {
  const sc = scoreNow(); if (!sc) return null;
  drawObs(sc.points);
  if (run.record?.validation) { Object.assign(run.record.validation, { hwm: hwmOf(sc), event: S.obsEvent ?? null }); refileValidation(); } // observations picked after the run
  const lines = [];
  if (sc.n) lines.push(`<b>Levels and depths (${sc.n}):</b> bias ${ftm(sc.bias)}, mean error ${ftm(sc.mae).slice(1)}, RMSE ${ftm(sc.rmse).slice(1)}, ${Math.round(sc.within15 * 100)} % within 15 cm`);
  if (sc.calls) lines.push(`<b>Flooded / dry:</b> ${sc.hits} flooded in both, ${sc.misses} missed, ${sc.falseAlarms} false alarms of ${sc.calls}`);
  if (sc.skipped) lines.push(`Not scored: ${sc.points.filter(p => p.skip).map(p => `${p.name} (${p.skip.replace(': not scored', '')})`).join(' · ')}`);
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
    hist: stormSrc === 'hist' ? { event: $('histEvent').value, label: $('histEvent').selectedOptions[0]?.textContent ?? '', date: $('histEvent').value === 'date' ? $('histDate').value : null } : null,
    nc: stormSrc === 'radar' && nc.storms.ctl ? { observedUntilUTC: new Date(nc.rr.live.observedUntil).toISOString(), member: $('ncMember').value,
      ...(nc.rr.live.qpf?.cycle != null ? { hrrrCycleUTC: new Date(nc.rr.live.qpf.cycle).toISOString() } : {}) } : null, // replayed from the archive on open (the same HRRR run)
    view: { center: map.getCenter().toArray(), zoom: map.getZoom() }, infraUnits: $('infraUnits').value, obs: S.obs, maps: S.maps.map(m => (m.href ? { href: m.href } : m)),
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
      const r = applyDesign(model.base, { features: s.design.features, settings: s.settings, locked: s.locked }, { ...femaOpts(), toCell: llCell, wse: model.baseWse ?? null, water: fineWater() });
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
/** Inputs saved under an earlier id: the live radar controls moved from Historic storm to Radar & nowcast. */
const LEGACY_INPUTS = { liveObs: 'ncObs', liveLead: 'ncLead' };
function applyInputs(inputs) {
  for (const [id0, v] of Object.entries(inputs ?? {})) {
    const id = LEGACY_INPUTS[id0] && !(LEGACY_INPUTS[id0] in inputs) ? LEGACY_INPUTS[id0] : id0, el = $(id); if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('input')); // refresh the value labels; 'change' would rebuild on every field
  }
  for (const id of linkFields) $(id).dispatchEvent(new Event('change')); // remember linked URLs
}
async function restoreProject(pj, layer, scenarios = [], analysis = null) {
  stopRun(); model = null; logEl.textContent = '';
  applyInputs(pj.inputs); infra.setLayer(layer); S.obs = pj.obs ?? []; drawObs(); obsNote(); S.maps = await loadMaps(pj.maps); mapsNote();
  design.setScenarios(loadScenarios(scenarios), pj.activeScenario); design.setAnalysis(analysis); compareUI.clear(); emulatorUI.reset();
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
    if ([...$('histEvent').options].some(o => o.value === pj.hist.event)) { $('histEvent').value = pj.hist.event; if (pj.hist.date) $('histDate').value = pj.hist.date; $('histDateRow').hidden = pj.hist.event !== 'date'; await $('histLoad').onclick(); }
    else log(`Historic event “${pj.hist.label}” not found in the record search: load it again under Storm`, 'warn');
  }
  if (pj.stormSrc === 'radar' && pj.nc?.observedUntilUTC) { // the nowcast as it was issued, from the archive
    const t0 = Date.now(); while ($('ncLoad').disabled && Date.now() - t0 < 90e3) await new Promise(r => setTimeout(r, 500));
    $('ncIssue').value = localInput(Date.parse(pj.nc.observedUntilUTC)); nc.pinCycle = pj.nc.hrrrCycleUTC ? Date.parse(pj.nc.hrrrCycleUTC) : null; await ncLoad(); $('ncMember').value = pj.nc.member ?? 'ctl'; updateStorm();
    log(`Radar & nowcast: replayed the saved nowcast issued ${pj.nc.observedUntilUTC.slice(0, 16).replace('T', ' ')} UTC. Clear “Issued at” and load again for the radar now`, 'ok');
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
    storm: { label: stormLabel(run.storm), ...stormMeta(run.storm) }, tide: run.record?.tide ?? tideRec(run), drainage: plain(drainLabel()), greenInfrastructure: plain(giLabel()),
    calibration: { settings: cal(), score: calSc && { n: calSc.n, biasM: calSc.bias, maeM: calSc.mae, rmseM: calSc.rmse, within15cm: calSc.within15, hits: calSc.hits, misses: calSc.misses, falseAlarms: calSc.falseAlarms } },
    batch: run.batchInfo ?? null, // the batch study job (src/batch.js) this run was, for the sensitivity and EAD sections
    scenario: run.scenario ?? 'Existing conditions', designHash: run.record?.designHash ?? gridHash(), forcingHash: (run.record?.forcing ?? CMP.fingerprint(forcingRecord(run))).hash,
    startWater: run.startNote ?? null, forcing: run.record?.forcing ?? CMP.fingerprint(forcingRecord(run)), utilityData: utilityData(), drainSettings: run.record ? run.record.drainSettings : drainSettings(), commit: run.record?.commit ?? appCommit, ...(run.record ? (run.record.codeChanged ? { codeChanged: run.record.codeChanged } : {}) : appChanged.length ? { codeChanged: appChanged } : {}), grids: run.record ? Object.fromEntries(Object.entries(CMP.GRIDS).map(([k, v]) => [`grids/${k}.f32`, v])) : null,
    books: run.record?.books ?? null, validation: run.record?.validation ?? null, inflow: run.record?.inflow ?? null, ponds: run.record?.ponds ?? null, cso: run.record?.cso ?? null, controlLines: run.record?.lines.map(l => ({ id: l.id, name: l.name, volumeM3: l.volume, plusM3: l.plus, minusM3: l.minus, faces: l.faces, ...(l.endDepth ? { endDepthM: l.endDepth } : {}), ...CMP.lineStats(l) })) ?? null,
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
      'max_force.asc': 'peak force per metre of width ρ(h·v² + ½g·h²) (kN/m)', 'max_bed_shear.asc': 'peak bed shear ρg·n²·v²/h^⅓ (Pa)', 'bed_change_cm.asc': 'sediment transport: bed change (cm, − scour, + deposit)', 'suspended_solids_mm.asc': 'solids still in suspension at the end (mm per area)', 'collapse_wetted.asc': 'collapsible-soil susceptibility (1 low, 2 moderate, 3 high) where the flood wetted the ground, 1 m', 'scour_class.asc': 'scour potential 0 none, 1 low, 2 moderate, 3 high (NODATA = paved)', 'scour_potential_cm.asc': 'indicative scour depth, excess-shear law (cm)', 'flood_duration_min.asc': 'minutes deeper than 15 cm', 'arrival_min.asc': 'minutes from the start until 15 cm deep (NODATA = never)', 'start_depth.asc': 'water depth (m) the run started with, from the USGS gauge levels (Starting water: gauges; NODATA = dry)',
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
  if (run.startDepth) grid('start_depth', run.startDepth.map(v => (v > 0 ? v : NaN))); // the water the run started with (gauge levels)
  if (run.inp) files.push({ path: 'network.inp', data: run.inp });
  if (run.watch) files.push({ path: 'barriers.csv', data: barrierCSV(run.watch.results()) });
  if (calSc) files.push({ path: 'calibration.csv', data: calCSV(calSc) });
  if (run.swmmReport) files.push({ path: 'swmm_report.rpt', data: run.swmmReport });
  if (run.record) { // the 1 m comparison grids (.f32 + ESRI header), control-line hydrographs, new buildings
    const rec = run.record, hdr = CMP.gridHeader(rec.geo);
    for (const [k, v] of [...Object.entries(rec.grids), ['hazard_arr', rec.hazard]]) files.push({ path: `grids/${k}.f32`, data: CMP.encodeF32(v) }, { path: `grids/${k}.hdr`, data: hdr });
    files.push({ path: 'lines.json', data: JSON.stringify(rec.lines) }, { path: 'buildings.json', data: JSON.stringify(rec.newBuildings) });
    // for the report (src/report.js): the storm sewer's geometry and books, inlets with their gutter spread, the designed ground
    if (rec.network) files.push({ path: 'network.json', data: JSON.stringify(rec.network) }, { path: 'hgl.json', data: JSON.stringify(rec.hgl) }, { path: 'inlets.json', data: JSON.stringify(rec.inlets) });
    if (rec.ground) files.push({ path: 'grids/ground.f32', data: CMP.encodeF32(rec.ground) }, { path: 'grids/ground.hdr', data: hdr });
    if (rec.lines.length) files.push({ path: 'control_lines.csv', data: CMP.toCSV(rec.lines.flatMap(l => CMP.hydrograph(l.series).map(([t, q], m) => ({ line: l.id, name: l.name, t, q, out: CMP.hydrograph(l.series, 2)[m]?.[1], back: CMP.hydrograph(l.series, 3)[m]?.[1] }))), [['line', 'line'], ['name', 'name'], ['t', 'time_s', 0], ['q', 'net_flow_m3s', 5], ['out', 'flow_to_plus_m3s', 5], ['back', 'flow_to_minus_m3s', 5]]) });
  }
  return Object.assign(files.map(f => ({ path: f.path, data: typeof f.data === 'string' ? enc.encode(f.data) : f.data })), { run }); // which run (projects.lastSaved: scores added after it was filed)
}
function barrierCSV(rs) {
  const n = (v, d = 3) => (v == null || !Number.isFinite(v) ? '' : String(+v.toFixed(d))), min = (t) => (t == null ? '' : n(t / 60, 2));
  const name = (r) => infra.layer.features.find(f => f.id === r.id)?.properties.name ?? '';
  return ['id,name,type,length_m,crest_min_m,crest_max_m,deployed_at_min,min_freeboard_m,max_water_level_m,overtopped,first_overtop_min,volume_over_m3,peak_rate_m3s,peak_rate_min,peak_unit_q_m2s,peak_load_kN_per_m,peak_load_min,berm_fill_m3',
    ...rs.map(r => [r.id, JSON.stringify(name(r)), r.type, n(r.length, 1), n(r.crestMin), n(r.crestMax), r.deployAt == null ? 'never' : min(r.deployAt), n(r.minFreeboard), n(r.maxLevel), r.overtopped ? 'yes' : 'no',
      min(r.tOver), n(r.overVol, 2), n(r.peakRate), min(r.tPeakRate), n(r.peakUnitQ), n(r.peakLoad, 2), min(r.tLoad), n(r.fill, 1)].join(','))].join('\n');
}
const projects = initProjects({ capture: captureProject, layer: () => infra.layer, restore: restoreProject, runFiles, scenarios: scenarioFiles, analysis: () => design.analysis });

{ // ?project=<folder>[&batch=run]: open a project at load, and with batch=run carry on with its study (tools/batch.mjs)
  const qp = new URLSearchParams(location.search), pf = qp.get('project');
  const built = async () => { // the build's last steps (the watershed) finish after open
    for (let i = 0; i < 3600 && !buildError && !(model && device && !$('runBtn').disabled); i++) await new Promise(r => setTimeout(r, 1000));
    if (buildError && !model) throw new Error('Build failed: ' + buildError); // tools/batch.mjs waits, then opens the project again
  };
  if (pf) projects.open(pf).then(built).then(() => batchUI.opened({ auto: qp.get('batch') === 'run' })).then(st => { window.__batchDone = { ok: true, study: st }; })
    .catch(e => { log('Opening the project failed: ' + e.message, 'err'); window.__batchDone = { ok: false, error: e.message }; });
}
window.__floodsim = { batchUI, analyzeRecord, eadFamily, checksOf, loadSaved, damageAssets, saveCheckpoint: () => saveCheckpoint(run), resumeCheckpoint: () => resumeCheckpoint(run), get run() { return run; }, get model() { return model; }, nc, rollLive, captureProject, get records() { return records; }, map, setArea, infra, design, projects, buildPackage, runFiles, rasFiles, reportUI, compareUI, runWindowPair }; // console debugging
gpuReady.then(() => updateSizeNote());
