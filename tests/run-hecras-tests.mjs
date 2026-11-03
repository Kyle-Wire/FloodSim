// HEC-RAS handoff tests: the GeoTIFF writer read back by src/tiff.js (georeferencing, CRS, vertical datum, values, no
// data), the shapefile writer read back by src/infra.js (header, bounding box, records, attributes), a synthetic
// HEC-RAS geometry file parsed (fixed-width numbers that run together, structures left out) and its cross-sections
// interpolated onto a grid (the section profiles at the sections, linear along the reach, by normalised station
// between the bank stations as the channel widens), the bed sources layered, mask outlines, edge runs, and the package.
// Usage: node tests/run-hecras-tests.mjs
import { writeGeoTiff } from '../src/tiff-write.js';
import { parseTiff } from '../src/tiff.js';
import { writeShapefile, prjUTM } from '../src/shapefile.js';
import { parseShp, parseDbf } from '../src/infra.js';
import { parseGeometry, parseProject, xsBed, layerBeds, maskOutline, edgeRuns, runLine, rasPackage } from '../src/hecras.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ---- GeoTIFF
{
  const w = 37, h = 23, d = new Float32Array(w * h).map((_, k) => 3 + 0.01 * (k % w) - 0.02 * Math.floor(k / w));
  d[5] = NaN;
  for (const compress of [true, false]) {
    const t = parseTiff(ab(await writeGeoTiff({ width: w, height: h, data: d, x0: 485000, y0: 4425000, dx: 1, epsg: 26918, vertical: 'NAVD88', citation: 'test', compress })));
    const v = await t.read(0, 0, w, h, 0);
    let ok = true; for (let k = 0; k < w * h; k++) if (k === 5 ? !Number.isNaN(v[k]) : v[k] !== d[k]) ok = false;
    check(`GeoTIFF (${compress ? 'deflate' : 'uncompressed'}): read back, georeferencing, NAD83 / UTM 18N, NAVD88, no data`, ok && t.width === w && t.height === h && t.geo.x0 === 485000 && t.geo.y0 === 4425000 && t.geo.dx === 1 && t.geo.dy === 1 && t.geo.epsg === 26918 && /navd88/i.test(t.geo.vertical), JSON.stringify(t.geo));
  }
  // a 8-bit class raster: the tags say unsigned 8-bit (src/tiff.js reads floats only, so check the IFD directly)
  const u8 = await writeGeoTiff({ width: 4, height: 3, data: Uint8Array.from([11, 21, 22, 23, 24, 41, 42, 43, 254, 255, 0, 90]), x0: 0, y0: 0, dx: 1, epsg: 26918, nodata: 0, compress: false });
  const dv = new DataView(ab(u8)), ifd = dv.getUint32(4, true), tags = {};
  for (let e = 0; e < dv.getUint16(ifd, true); e++) { const p = ifd + 2 + 12 * e; tags[dv.getUint16(p, true)] = dv.getUint16(p + 8, true); }
  const off = dv.getUint32(ifd + 2 + 12 * [...Array(dv.getUint16(ifd, true)).keys()].find(e => dv.getUint16(ifd + 2 + 12 * e, true) === 273) + 8, true);
  check('GeoTIFF 8-bit: unsigned 8-bit samples, the class values in order', tags[258] === 8 && tags[339] === 1 && tags[259] === 1 && u8[off] === 11 && u8[off + 8] === 254 && u8[off + 11] === 90);
  const geo = parseTiff(ab(await writeGeoTiff({ width: 3, height: 2, data: new Float32Array(6).fill(2), x0: -75.2, y0: 39.97, dx: 0.01, epsg: 4326 })));
  check('GeoTIFF geographic (lon/lat): corner and pixel size', Math.abs(geo.geo.x0 + 75.2) < 1e-12 && Math.abs(geo.geo.y0 - 39.97) < 1e-12 && geo.geo.dx === 0.01 && geo.geo.epsg === null);
}

// ---- shapefile
{
  const lines = [{ coords: [[485000, 4425000], [485100, 4425050], [485200, 4424990]], props: { name: 'Schuylkill inflow', bc_type: 'Flow Hydrograph', slope: null } },
    { coords: [[485300, 4424800], [485310, 4424700]], props: { name: 'Tide', bc_type: 'Stage Hydrograph', slope: 0.0012 } }];
  const s = writeShapefile('line', lines, { prj: prjUTM(18) }), g = parseShp(ab(s.shp)), rows = parseDbf(ab(s.dbf)), dv = new DataView(ab(s.shp));
  check('shapefile lines: records, coordinates, attributes', g.length === 2 && g[0].kind === 'line' && g[0].coords[2][0] === 485200 && g[1].coords[1][1] === 4424700 &&
    rows[0].name === 'Schuylkill inflow' && rows[1].bc_type === 'Stage Hydrograph' && Math.abs(rows[1].slope - 0.0012) < 1e-9 && rows[0].slope === null, JSON.stringify(rows));
  check('shapefile header: file length, type, bounding box; .shx and .prj', dv.getInt32(24, false) * 2 === s.shp.length && dv.getInt32(32, true) === 3 && dv.getFloat64(36, true) === 485000 && dv.getFloat64(60, true) === 4425050 &&
    s.shx.length === 100 + 16 && /NAD_1983_UTM_Zone_18N/.test(new TextDecoder().decode(s.prj)) && /Central_Meridian",-75\.0/.test(new TextDecoder().decode(s.prj)));
  const p = writeShapefile('polygon', [{ coords: [[[0, 0], [0, 10], [10, 10], [10, 0]]], props: { name: 'a' } }]), pg = parseShp(ab(p.shp))[0].coords[0];
  let area = 0; for (let k = 0; k + 1 < pg.length; k++) area += pg[k][0] * pg[k + 1][1] - pg[k + 1][0] * pg[k][1];
  check('shapefile polygon: closed, outer ring clockwise', pg.length === 5 && pg[0][0] === pg[4][0] && pg[0][1] === pg[4][1] && area < 0);
}

// ---- geometry file and cross-section interpolation
const f16 = (v) => v.toFixed(3).padStart(16), f8 = (v) => v.toFixed(2).padStart(8);
const rows = (vals, w, per) => { const out = []; for (let i = 0; i < vals.length; i += per) out.push(vals.slice(i, i + per).map(w).join('')); return out.join('\n'); };
const xsText = (rm, cut, se, banks) => [`Type RM Length L Ch R = 1 ,${rm},30,30,30`, 'BEGIN DESCRIPTION:', 'test section', 'END DESCRIPTION:',
  `XS GIS Cut Line=${cut.length}`, rows(cut.flat(), f16, 4), 'Node Last Edited Time=Jan/01/2020 00:00:00', `#Sta/Elev= ${se.length} `, rows(se.flat(), f8, 10),
  '#Mann= 3 , 0 , 0 ', '       0     .06       0      10    .035       0      20     .06       0', `Bank Sta=${banks.join(',')}`, 'XS Rating Curve= 0 ,0', ''].join('\n');
{
  // a reach running east (+x) in grid metres; looking downstream the left bank is north (smaller row). Section 1 at
  // x = 10.5, stations 0–30 on a 30 m cut line; section 2 at x = 40.5, stations 100–160 on the same 30 m (stretched ×½)
  // and a channel twice as wide: banks 110 / 150 against 10 / 20
  const se1 = [[0, 10], [10, 10], [15, 0], [20, 10], [30, 10]], se2 = [[100, 8], [110, 8], [130, -2], [150, 8], [160, 8]];
  const g01 = ['Geom Title=Synthetic reach', 'Program Version=6.30', 'River Reach=Test River     ,Lower          ', 'Reach XY= 2 ', rows([0, 20.5, 60, 20.5], f16, 4), 'Rch Text X Y=1,1',
    xsText('2000', [[10.5, 5.5], [10.5, 35.5]], se1, [10, 20]), 'Type RM Length L Ch R = 3 ,1500,10,10,10', 'BEGIN DESCRIPTION:', 'a bridge', 'END DESCRIPTION:', '',
    xsText('1000', [[40.5, 5.5], [40.5, 35.5]], se2, [110, 150])].join('\n');
  const geom = parseGeometry(g01), r = geom.reaches[0];
  check('geometry: title, reach, two cross-sections, the bridge left out', geom.title === 'Synthetic reach' && geom.reaches.length === 1 && r.river === 'Test River' && r.reach === 'Lower' && r.xs.length === 2 &&
    geom.skipped.structures === 1 && r.xs[1].se[2][1] === -2 && r.xs[1].banks[1] === 150 && r.xs[0].cut[1][1] === 35.5 && r.xy.length === 2, JSON.stringify(geom.skipped));
  const nx = 60, ny = 40, bed = xsBed(geom, { nx, ny }, (x, y) => [x, y]);
  const prof = (se, s) => { for (let m = 1; m < se.length; m++) if (s <= se[m][0]) return se[m - 1][1] + (se[m][1] - se[m - 1][1]) * (s - se[m - 1][0]) / (se[m][0] - se[m - 1][0]); return se.at(-1)[1]; };
  // at section 1 (column 10) the bed is its profile, station = row centre − 5.5
  let e1 = 0; for (let j = 6; j < 35; j++) e1 = Math.max(e1, Math.abs(bed.z[j * nx + 10] - prof(se1, j + 0.5 - 5.5)));
  check('cross-sections: the bed at a section is its profile', e1 < 1e-4, `max error ${e1.toExponential(1)} m`);
  // between them: u along the reach, η by normalised station inside each zone, the banks moving out as the channel widens
  let e2 = 0, n2 = 0;
  for (let i = 11; i < 40; i++) for (let j = 6; j < 35; j++) {
    const x = i + 0.5, y = j + 0.5, u = (x - 10.5) / 30;
    const zones = [[5.5, 15.5, 5.5, 10.5, [0, 10], [100, 110]], [15.5, 25.5, 10.5, 30.5, [10, 20], [110, 150]], [25.5, 35.5, 30.5, 35.5, [20, 30], [150, 160]]];
    for (const [a1, b1, a2, b2, s1, s2] of zones) {
      const a = a1 + u * (a2 - a1), b = b1 + u * (b2 - b1); if (y < a || y > b || b - a < 1e-9) continue;
      const eta = (y - a) / (b - a), want = (1 - u) * prof(se1, s1[0] + eta * (s1[1] - s1[0])) + u * prof(se2, s2[0] + eta * (s2[1] - s2[0]));
      e2 = Math.max(e2, Math.abs(bed.z[j * nx + i] - want)); n2++; break;
    }
  }
  const mid = bed.z[20 * nx + 25];
  check('cross-sections: linear along the reach, by normalised station between the banks', e2 < 1e-3 && n2 > 800 && Math.abs(mid - (0.5 * 0 + 0.5 * -2)) < 1e-3, `max error ${e2.toExponential(1)} m over ${n2} cells; thalweg midway ${mid.toFixed(3)} m`);
  check('cross-sections: nothing outside the pair', Number.isNaN(bed.z[20 * nx + 5]) && Number.isNaN(bed.z[20 * nx + 45]) && Number.isNaN(bed.z[2 * nx + 25]) && bed.pairs === 1 && bed.sections === 2);
  // fixed width: numbers that run together, and scale / shift (feet NGVD29 → m NAVD88)
  const tight = parseGeometry(['River Reach=R,A', xsText('5', [[0, 0], [0, 10]], [[0, 0], [5, -1002.5], [10, 0]], [0, 10])].join('\n'));
  check('geometry: fixed-width fields that run together', tight.reaches[0].xs[0].se[1][0] === 5 && tight.reaches[0].xs[0].se[1][1] === -1002.5);
  const ft = xsBed(geom, { nx, ny }, (x, y) => [x, y], { zScale: 0.3048, zShift: -0.3 });
  check('cross-sections: elevation units and datum shift', Math.abs(ft.z[20 * nx + 10] - (0 * 0.3048 - 0.3)) < 1e-6 && Math.abs(ft.z[6 * nx + 10] - (10 * 0.3048 - 0.3)) < 1e-5);
  check('project file: units', parseProject('Proj Title=Philly\nCurrent Plan=p01\nEnglish Units\n')?.units === 'US' && parseProject('Proj Title=X\nSI Units\n')?.units === 'SI' && parseProject('PROJCS["x"]') === null);
  const lb = layerBeds(Float32Array.from([1, NaN, NaN, 4]), Float32Array.from([9, 2, NaN, 9]), 4);
  check('bed sources: survey first, then cross-sections', [...lb.z].map(v => (Number.isNaN(v) ? 'n' : v)).join(',') === '1,2,n,4' && lb.cells === 3 && lb.fromXS === 1);
}

// ---- outlines, edge runs, the package
{
  const nx = 20, ny = 20, m = new Uint8Array(nx * ny); for (let j = 5; j < 15; j++) for (let i = 5; i < 15; i++) m[j * nx + i] = 1;
  const o = maskOutline(m, nx, ny);
  const xs = o[0].map(p => p[0]), ys = o[0].map(p => p[1]);
  check('mask outline: one closed square, simplified to its corners', o.length === 1 && o[0].length === 5 && Math.min(...xs) === 5 && Math.max(...xs) === 15 && Math.min(...ys) === 5 && Math.max(...ys) === 15, JSON.stringify(o[0]));
  const runs = edgeRuns([3, 4, 5, 9, 19 * 10 + 2, 19 * 10 + 3, 4 * 10], 10, 20);
  check('edge runs: contiguous by side', runs.length === 4 && runs.some(r => r.side === 'north' && r.a === 3 && r.b === 5) && runs.some(r => r.side === 'south' && r.a === 2 && r.b === 3) && runs.some(r => r.side === 'west' && r.a === 4)
    && JSON.stringify(runLine({ side: 'north', a: 3, b: 5 }, 10, 20)) === '[[3,0],[6,0]]');

  const g = { zone: 18, x0: 485000, y1: 4425000, dx: 1, nx: 30, ny: 20 }, N = 600;
  const z = new Float32Array(N).map((_, k) => 5 + 0.01 * (k % 30)), bld = new Uint8Array(N), road = new Uint8Array(N), cls = new Uint8Array(N).fill(22);
  bld[45] = 1; road[100] = 1; cls[300] = 11;
  const files = await rasPackage({ grid: g, z, bld, bldH: new Float32Array(N).fill(12), cls, road, manning: new Float32Array(N).fill(0.045), nTable: { 11: 0.035, 22: 0.045 }, nRoad: 0.016, classNames: { 11: 'Open water', 22: 'Developed, low intensity' },
    perimeter: [[485000, 4425000], [485030, 4425000], [485030, 4424980], [485000, 4424980], [485000, 4425000]],
    bcs: [{ name: 'Test River inflow', kind: 'flow', line: [[485010, 4425000], [485020, 4425000]], series: [[0, 10], [3600, 20]] }, { name: 'South edge', kind: 'normal', line: [[485000, 4424980], [485030, 4424980]], slope: 0.002, series: null }],
    breaklines: [{ name: 'bank', kind: 'channel bank', line: [[485001, 4424990], [485029, 4424990]] }], buildings: [], rain: { t0: Date.UTC(2021, 8, 1, 14), blockMin: 60, depth: [2, 10] },
    meta: { title: 'test', start: Date.UTC(2021, 8, 1, 14), end: Date.UTC(2021, 8, 1, 16) } });
  const by = Object.fromEntries(files.map(f => [f.name, f.data])), dec = (n) => new TextDecoder().decode(by[n]);
  const tz = parseTiff(ab(by['terrain/terrain_model.tif'])), zr = await tz.read(0, 0, 30, 20, 0), zb = await parseTiff(ab(by['terrain/terrain_buildings_raised.tif'])).read(0, 0, 30, 20, 0);
  check('package: terrain read back, buildings raised by their height', zr.every((v, k) => v === z[k]) && Math.abs(zb[45] - (z[45] + 12)) < 1e-6 && zb[44] === z[44] && tz.geo.epsg === 26918);
  check('package: land cover classes with n, BC lines, series in SI and US', /^ID,Name,ManningsN\n11,"Open water",0\.035\n22,.*\n254,"Road \(OSM\)",0\.016\n255,"Building",10\.000/.test(dec('landcover/landcover_classes.csv')) &&
    parseDbf(ab(by['gis/bc_lines.dbf']))[1].bc_type === 'Normal Depth' && /2021-09-01T15:00:00Z,1\.0000,20\.000,706\.293/.test(dec('boundary/test_river_inflow.csv')) &&
    /2021-09-01T16:00:00Z,2\.0000,10\.000,0\.3937,10\.00,12\.00/.test(dec('precip/hyetograph.csv')) && /Normal Depth\s+friction slope 0\.0020/.test(dec('README_HEC-RAS.txt')) && !!by['gis/perimeter.shp'] && !!by['gis/breaklines.shp'] && !!by['gis/projection.prj'], dec('landcover/landcover_classes.csv').split('\n').slice(0, 2).join(' | '));
}

console.log(fails ? `\n${fails} FAILED` : '\nall HEC-RAS tests passed');
process.exit(fails ? 1 : 0);
