// Infrastructure layer tests: storage capacity, layer → model inputs, the estimate round trip (street network → editable
// layer → tier-1 builder gives the same network), placed outfalls, storage units in SWMM, shapefile / dbf / zip import.
// Usage: node tests/run-infra-tests.mjs
import { GridRef, fromUTM } from '../src/geo.js';
import { synthNetwork, toINP } from '../src/drainage.js';
import { realNetwork } from '../src/network-real.js';
import { detectPipeFields } from '../src/linked.js';
import { storageCapacity, ringArea, lineLength, layerInputs, networkToLayer, attachStorage, feature, parseShp, parseDbf, unzip, toLayer, summarize } from '../src/infra.js';
import { zip, crc32 } from '../src/export.js';
import { loadSWMM, SWMM } from '../src/swmm.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
const ll = (x, y) => fromUTM(486000 + x, 4422200 - y, 18); // cell coordinates (row 0 = north) → lon/lat
const z = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = 10 + 0.01 * i + 0.005 * (199 - j);
const f = { z, bld: new Uint8Array(N), road: new Uint8Array(N), cls: null };
const sim = { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) };
const fc = (features) => ({ type: 'FeatureCollection', features });

// ---- geometry and capacity
{
  const sq = [ll(50, 50), ll(70, 50), ll(70, 70), ll(50, 70), ll(50, 50)];
  const c = storageCapacity({ depth: 1.5, voids: 0.55 }, sq);
  check('storage footprint area from lon/lat', near(ringArea(sq), 400, 2), `${ringArea(sq).toFixed(1)} m² (20 × 20 m)`);
  check('capacity = area × depth × voids', near(c.volume, ringArea(sq) * 1.5 * 0.55, 1e-9) && near(c.volume, 330, 2), `${c.volume.toFixed(1)} m³`);
  check('line length in metres', near(lineLength([ll(0, 0), ll(30, 40)]), 50, 0.1));
}

// ---- estimate round trip: street network → layer → tier-1 builder reproduces it
{
  const X = ll(100, 100); // a crossroads (shared vertex) with streets leaving the area on all four sides
  const roads = [{ line: [ll(-5, 100), ll(40, 100), X, ll(160, 100), ll(205, 100)], kind: 'residential', width: 8 }, { line: [ll(100, -5), ll(100, 40), X, ll(100, 160), ll(100, 205)], kind: 'residential', width: 8 }];
  const synth = synthNetwork(g, f, { roads, waterways: [] }, null, sim, {});
  const nodeLL = (n) => fromUTM(g.x0 + n.p[0] * g.dx, g.y1 - n.p[1] * g.dx, g.zone);
  const cellLL = (k) => fromUTM(g.x0 + ((k % 200) + 0.5), g.y1 - (((k / 200) | 0) + 0.5), g.zone);
  const layer = fc(networkToLayer(synth, nodeLL, cellLL)), s = summarize(layer);
  const inp = layerInputs(layer);
  const net = realNetwork(g, f, inp.pipes, sim, { realInlets: inp.inlets, outfalls: inp.outfalls });
  const onsite = (n) => n.pipes.filter(p => !p.offsite);
  const len = (n) => onsite(n).reduce((a, p) => a + p.L, 0), sizes = (n) => onsite(n).map(p => p.D).sort((a, b) => a - b).join();
  check('estimate → layer: pipes, structures, inlets, boundary outfalls', s.count.pipe === onsite(synth).length && s.count.inlet === synth.inlets.filter(i => i.grates).length &&
    layer.features.filter(x => x.properties.boundary).length === synth.stats.offsiteOutlets, JSON.stringify(s.count));
  check('layer → tier-1 builder: same pipes, sizes, length, continuations', onsite(net).length === onsite(synth).length && sizes(net) === sizes(synth) &&
    near(len(net), len(synth), 0.5) && net.stats.offsiteOutlets === synth.stats.offsiteOutlets && net.stats.inverts === 'from layer (m)',
    `${onsite(net).length} pipes, ${len(net).toFixed(1)} vs ${len(synth).toFixed(1)} m, inverts ${net.stats.inverts}`);
  const invSynth = Math.min(...synth.nodes.map(n => n.invert)), invNet = Math.min(...net.nodes.filter(n => !n.offsite).map(n => n.invert));
  check('estimated inverts survive the round trip', near(Math.min(...synth.nodes.filter(n => !n.offsite).map(n => n.invert)), invNet, 1e-3), `lowest on-site invert ${invNet.toFixed(3)} m (synthetic ${invSynth.toFixed(3)})`);
}

// ---- a drawn network: manhole inverts fill pipe inverts, a placed outfall ends the network, per-pipe roughness
{
  const pts = { a: ll(40, 100), b: ll(100, 100), c: ll(160, 100), o: ll(180, 100) };
  const L = fc([
    feature('manhole', { type: 'Point', coordinates: pts.a }, { invert: 8.0 }), feature('manhole', { type: 'Point', coordinates: pts.b }, { invert: 7.6 }),
    feature('manhole', { type: 'Point', coordinates: pts.c }, { invert: 7.2 }), feature('outfall', { type: 'Point', coordinates: pts.o }, { invert: 7.0 }),
    feature('pipe', { type: 'LineString', coordinates: [pts.a, pts.b] }, { D: 0.375 }), feature('pipe', { type: 'LineString', coordinates: [pts.b, pts.c] }, { D: 0.45, n: 0.011 }),
    feature('pipe', { type: 'LineString', coordinates: [pts.c, pts.o] }, { D: 0.45, upInv: 7.2, dnInv: 7.0 }),
    feature('inlet', { type: 'Point', coordinates: ll(70, 104) }, { grates: 2 }),
  ]);
  const inp = layerInputs(L);
  check('manhole inverts fill pipe ends', inp.pipes[0].upInv === 8 && inp.pipes[0].dnInv === 7.6 && inp.pipes[1].dnInv === 7.2 && inp.inlets.length === 2);
  const net = realNetwork(g, f, inp.pipes, sim, { realInlets: inp.inlets, outfalls: inp.outfalls });
  const outs = net.nodes.filter(n => n.outfall), text = toINP(net, g, { durationS: 600 });
  check('placed outfall is the network end (free outfall, no continuation)', outs.length === 1 && net.stats.offsiteOutlets === 0 && /FREE/.test(text) && Math.abs(outs[0].invert - 7.0) < 1e-9,
    `${outs.length} outfall at ${outs[0]?.invert.toFixed(2)} m`);
  check('per-pipe Manning n reaches the .inp', /\b0\.011\b/.test(text) && net.stats.grates === 2);

  // ---- storage: capacity from the footprint, joined to the nearest manhole, a SWMM storage unit that fills and drains
  const box = [ll(95, 110), ll(115, 110), ll(115, 130), ll(95, 130), ll(95, 110)];
  const L2 = fc([...L.features, feature('storage', { type: 'Polygon', coordinates: [box] }, { depth: 1.5, voids: 0.95, connD: 0.3 })]);
  const in2 = layerInputs(L2), net2 = realNetwork(g, f, in2.pipes, sim, { realInlets: in2.inlets, outfalls: in2.outfalls });
  const { attached } = attachStorage(net2, in2.storage, g, f), S = net2.nodes.find(n => n.storage), link = net2.pipes.at(-1);
  check('storage joins the nearest manhole with a connection pipe', attached.length === 1 && S && net2.nodes[link.from].name === attached[0].to && link.D === 0.3 &&
    near(S.storageArea * S.depth, in2.storage[0].volume, 1e-6), `${attached[0]?.volume.toFixed(1)} m³ to ${attached[0]?.to}, ${attached[0]?.dist.toFixed(1)} m away`);
  const text2 = toINP(net2, g, { durationS: 7200, routingStep: 1 });
  check('storage unit written as SWMM STORAGE', /\[STORAGE\][\s\S]*\nS0\s/.test(text2));
  // inflow at the upstream manhole beyond what the outfall pipe takes: the tank should take water and give it back
  try {
    const sw = await loadSWMM(); sw.open(text2);
    const iA = sw.index('NODE', net2.nodes[0].name), iS = sw.index('NODE', 'S0'), iO = sw.index('NODE', outs[0] ? net2.nodes.find(n => n.outfall).name : 'O0');
    let maxVol = 0, t = 0;
    for (; t < 1800; t += 10) { sw.setLatFlow(iA, 0.6); sw.stepTo(t + 10); maxVol = Math.max(maxVol, sw.node('VOLUME', iS)); }
    for (; t < 7200; t += 10) { sw.setLatFlow(iA, 0); sw.stepTo(t + 10); }
    const endVol = sw.node('VOLUME', iS), rpt = sw.finish(), cont = SWMM.continuity(rpt);
    check('storage fills in the storm and drains back after', maxVol > 5 && endVol < 0.3 * maxVol && Math.abs(cont.errorPct) < 1,
      `peak ${maxVol.toFixed(1)} m³ stored, ${endVol.toFixed(1)} m³ at 2 h, continuity ${cont.errorPct.toFixed(2)} %`);
    void iO;
  } catch (e) { check('storage SWMM run', false, e.message); }
}

// ---- import: shapefile + dbf (inches, feet), zip (stored and deflated), geometry → type
{
  // a 2-record PolyLineZ shapefile and its dbf
  const lines = [[[0, 0], [10, 0]], [[10, 0], [10, 20]]], recLen = 4 + 32 + 8 + 4 + 2 * 16 + 16 + 16 + 16 + 16;
  const shp = new DataView(new ArrayBuffer(100 + lines.length * (8 + recLen)));
  shp.setInt32(0, 9994, false); shp.setInt32(24, shp.byteLength / 2, false); shp.setInt32(28, 1000, true); shp.setInt32(32, 13, true);
  let o = 100;
  lines.forEach((l, i) => {
    shp.setInt32(o, i + 1, false); shp.setInt32(o + 4, recLen / 2, false); const r = o + 8;
    shp.setInt32(r, 13, true); shp.setInt32(r + 36, 1, true); shp.setInt32(r + 40, 2, true); shp.setInt32(r + 44, 0, true);
    l.forEach((p, k) => { shp.setFloat64(r + 48 + 16 * k, p[0], true); shp.setFloat64(r + 56 + 16 * k, p[1], true); });
    o += 8 + recLen;
  });
  const fields = [['DIA_HGT', 'N', 8], ['US_INV', 'N', 10], ['DS_INV', 'N', 10]], rlen = 1 + 28, hlen = 32 + 32 * fields.length + 1;
  const dbf = new Uint8Array(hlen + 2 * rlen + 1), dv = new DataView(dbf.buffer); dbf[0] = 3; dv.setUint32(4, 2, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true);
  fields.forEach(([n, t, w], i) => { for (let k = 0; k < n.length; k++) dbf[32 + 32 * i + k] = n.charCodeAt(k); dbf[32 + 32 * i + 11] = t.charCodeAt(0); dbf[32 + 32 * i + 16] = w; });
  dbf[hlen - 1] = 0x0d;
  [[24, 30.5, 30.0], [18, 31.5, 30.5]].forEach((row, i) => { let p = hlen + i * rlen; dbf[p++] = 0x20; row.forEach((v, k) => { const s = String(v).padStart(fields[k][2]); for (const ch of s) dbf[p++] = ch.charCodeAt(0); }); });
  const geo = parseShp(shp.buffer), rows = parseDbf(dbf.buffer);
  check('shapefile PolyLineZ and dbf attributes', geo.length === 2 && geo[1].kind === 'line' && geo[1].coords[1][1] === 20 && rows[0].DIA_HGT === 24 && rows[1].US_INV === 31.5, JSON.stringify(rows));
  const items = geo.map((gm, i) => ({ name: 'storm_mains', kind: gm.kind, coords: gm.coords.map(([x, y]) => ll(x, y)), props: rows[i] }));
  const { features } = toLayer(items, { elevUnits: 'ft', detectPipeFields });
  check('import: sizes in inches, inverts in feet → metres', features.every(x => x.properties.type === 'pipe') && near(features[0].properties.D, 0.6096, 1e-9) &&
    near(features[1].properties.upInv, 31.5 * 0.3048, 1e-9), `${features[0].properties.D} m, up invert ${features[1].properties.upInv.toFixed(3)} m`);
  const pts = toLayer([{ name: 'Outfalls_2024', kind: 'point', coords: ll(5, 5), props: { INVERT: 25 } }, { name: 'catch_basins', kind: 'point', coords: ll(6, 6), props: {} }], { elevUnits: 'ft', detectPipeFields }).features;
  check('import: type guessed from file name', pts[0].properties.type === 'outfall' && near(pts[0].properties.invert, 7.62, 1e-9) && pts[1].properties.type === 'inlet');

  const enc = new TextEncoder(), text = enc.encode('{"type":"FeatureCollection","features":[]}'.repeat(20));
  const stored = await unzip(await zip([{ name: 'a/b.geojson', data: text }]).arrayBuffer());
  const def = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const name = enc.encode('c.dbf'), z8 = new DataView(new ArrayBuffer(30 + name.length + def.length + 46 + name.length + 22)), u8 = new Uint8Array(z8.buffer);
  z8.setUint32(0, 0x04034b50, true); z8.setUint16(8, 8, true); z8.setUint32(14, crc32(text), true); z8.setUint32(18, def.length, true); z8.setUint32(22, text.length, true); z8.setUint16(26, name.length, true);
  u8.set(name, 30); u8.set(def, 30 + name.length); const c0 = 30 + name.length + def.length;
  z8.setUint32(c0, 0x02014b50, true); z8.setUint16(c0 + 10, 8, true); z8.setUint32(c0 + 20, def.length, true); z8.setUint32(c0 + 24, text.length, true); z8.setUint16(c0 + 28, name.length, true); u8.set(name, c0 + 46);
  const e0 = c0 + 46 + name.length; z8.setUint32(e0, 0x06054b50, true); z8.setUint16(e0 + 8, 1, true); z8.setUint16(e0 + 10, 1, true); z8.setUint32(e0 + 12, 46 + name.length, true); z8.setUint32(e0 + 16, c0, true);
  const deflated = await unzip(z8.buffer);
  check('zip: stored and deflated entries', stored[0][0] === 'a/b.geojson' && new Uint8Array(stored[0][1]).length === text.length &&
    deflated[0][0] === 'c.dbf' && new TextDecoder().decode(deflated[0][1]) === new TextDecoder().decode(text), `${def.length} B deflated → ${text.length} B`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall infrastructure tests passed');
process.exit(fails ? 1 : 0);
