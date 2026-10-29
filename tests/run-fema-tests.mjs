// FEMA NFHL tests: zone codes, BFE interpolation between BFE lines (linear between two bracketing lines), the zone and
// BFE grids (static BFE, interpolated, AO depth, A zones without a BFE, the floodway over AE), a footprint's zone and
// highest BFE, and the zone areas. --live fetches the NFHL at a Meyerland (Houston) block, in zone AE, through the
// local server on port 8770.
// Usage: node tests/run-fema-tests.mjs [--live]
import * as F from '../src/fema.js';
import { gridFromLonLatBox } from '../src/geo.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

check('zone codes: floodway, 500-yr X, plain zones', F.zoneCode('AE', 'FLOODWAY') === 'FW' && F.zoneCode('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD') === 'X500' && F.zoneCode('X', 'AREA OF MINIMAL FLOOD HAZARD') === 'X' && F.zoneCode('AE', null) === 'AE' && F.zoneCode('AE', 'NON-ENCROACHMENT') === 'AE');
{ // two parallel BFE lines, 54 ft at x = 0 and 55 ft at x = 100: linear between
  const L = [{ elev: 54, line: [[0, -50], [0, 50]] }, { elev: 55, line: [[100, -50], [100, 50]] }];
  const at = (x) => F.interpolateBFE(L, x, 0).bfe;
  check('BFE linear between two lines', Math.abs(at(25) - 54.25) < 1e-12 && Math.abs(at(50) - 54.5) < 1e-12 && at(0) === 54 && Math.abs(at(100) - 55) < 1e-12);
  check('beyond the last line: its own BFE pulled toward the other (no extrapolation)', at(150) > 54 && at(150) < 55);
  check('lines out of reach are not used', F.interpolateBFE(L, 1000, 0, { maxDist: 200 }) === null);
}
{ // a 200 m × 100 m grid: an AE zone over the west half with BFE lines across it, a floodway strip inside it, an AO
  // zone (2 ft) and a static-BFE AH zone in the east, an A zone with no BFE
  const g = gridFromLonLatBox(-95.4720, 29.6800, -95.4700, 29.6809, 1), nx = g.nx, ny = g.ny;
  const [w, s, e, n] = [-95.4720, 29.6800, -95.4700, 29.6809], lon = (f) => w + f * (e - w), lat = (f) => s + f * (n - s);
  const box = (a, b, c, d) => [[[lon(a), lat(c)], [lon(b), lat(c)], [lon(b), lat(d)], [lon(a), lat(d)], [lon(a), lat(c)]]];
  const nfhl = { zones: [
    { zone: 'AE', code: 'AE', sfha: true, staticBfe: null, depth: null, polys: [box(0, 0.5, 0, 1)] },
    { zone: 'AE', code: 'FW', sfha: true, staticBfe: null, depth: null, polys: [box(0.2, 0.3, 0, 1)] },
    { zone: 'AO', code: 'AO', sfha: true, staticBfe: null, depth: 2 * 0.3048, polys: [box(0.5, 0.7, 0, 0.5)] },
    { zone: 'AH', code: 'AH', sfha: true, staticBfe: 16.5, depth: null, polys: [box(0.5, 0.7, 0.5, 1)] },
    { zone: 'A', code: 'A', sfha: true, staticBfe: null, depth: null, polys: [box(0.7, 0.9, 0, 1)] },
    { zone: 'X', code: 'X500', sfha: false, staticBfe: null, depth: null, polys: [box(0.9, 1, 0, 1)] },
  ], lines: [{ elev: 16, line: [[lon(0.05), lat(-0.5)], [lon(0.05), lat(1.5)]] }, { elev: 16.3048, line: [[lon(0.45), lat(-0.5)], [lon(0.45), lat(1.5)]] }] };
  const z = new Float32Array(nx * ny).fill(15);
  const G = F.nfhlGrids(nfhl, g, z, { step: 1 }), at = (fx, fy) => { const i = Math.floor(fx * nx), j = Math.floor((1 - fy) * ny); return j * nx + i; };
  const mid = G.bfe[at(0.25, 0.5)], quarter = G.bfe[at(0.15, 0.5)];
  check('zones on the grid, the floodway over the AE zone', F.ZONES[G.code[at(0.1, 0.5)]] === 'AE' && F.ZONES[G.code[at(0.25, 0.5)]] === 'FW' && F.ZONES[G.code[at(0.95, 0.5)]] === 'X500');
  check('AE: interpolated between its BFE lines', Math.abs(mid - 16.1524) < 0.03 && Math.abs(quarter - (16 + 0.3048 * 0.25)) < 0.03 && G.source[at(0.25, 0.5)] === 2, `mid ${mid.toFixed(3)} m, quarter ${quarter.toFixed(3)} m`);
  check('AO: ground + depth; AH: its static BFE', Math.abs(G.bfe[at(0.6, 0.25)] - (15 + 0.6096)) < 1e-5 && G.source[at(0.6, 0.25)] === 3 && G.bfe[at(0.6, 0.75)] === 16.5 && G.source[at(0.6, 0.75)] === 1);
  check('A zone and X: no BFE', Number.isNaN(G.bfe[at(0.8, 0.5)]) && Number.isNaN(G.bfe[at(0.95, 0.5)]));
  const fp = []; for (let j = Math.floor(0.4 * ny); j < Math.floor(0.6 * ny); j++) for (let i = Math.floor(0.4 * nx); i < Math.floor(0.6 * nx); i++) fp.push(j * nx + i);
  const b = F.atCells(G, fp);
  check('a footprint across zones: an SFHA zone and the highest BFE', b.sfha && ['AE', 'AH', 'AO'].includes(b.zone) && b.bfe === 16.5, JSON.stringify(b));
  const areas = F.zoneAreas(G, 1);
  const tot = Object.values(areas).reduce((p, q) => p + q, 0);
  const boxArea = (e - w) * 111320 * Math.cos(29.68045 * Math.PI / 180) * (n - s) * 110860; // m², the zones tile the box
  check('zone areas: the zones tile the box once', Math.abs(tot / boxArea - 1) < 0.03, JSON.stringify(Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, Math.round(v)]))));
}

if (process.argv.includes('--live')) {
  const fetcher = (url) => fetch('http://localhost:8770/api/fetch', { method: 'POST', headers: { 'x-floodsim': '1' }, body: JSON.stringify({ url }) }); // through the local server (npm start)
  const t0 = Date.now(), d = await F.fetchNFHL([-95.4735, 29.6815, -95.4690, 29.6845], fetcher);
  const g = gridFromLonLatBox(-95.4735, 29.6815, -95.4690, 29.6845, 1), G = F.nfhlGrids(d, g, null, { step: 8 });
  const k = ((g.ny / 2) | 0) * g.nx + ((g.nx / 2) | 0), here = F.atCells(G, [k]);
  check('live: Meyerland is in the SFHA with an interpolated BFE', here.sfha && Number.isFinite(here.bfe) && here.bfe > 14 && here.bfe < 20,
    `${d.zones.length} zone polygons, ${d.lines.length} BFE lines / sections, centre: ${here.zone}, BFE ${here.bfe?.toFixed(2)} m (${(here.bfe / 0.3048).toFixed(1)} ft) ${d.datum}, ${Date.now() - t0} ms`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall FEMA tests passed');
process.exit(fails ? 1 : 0);
