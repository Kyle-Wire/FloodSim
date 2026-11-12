// Invert trust (realNetwork §2): whether each recorded invert is used, in what units, and why. Since 11 Nov 2026 the
// number of records is not evidence: one record with plausible inverts is used. Units come from the record's own
// declaration, the user's `invertUnits`, or the layer's cover evidence; an ambiguous choice is said on every end.
// Usage: node tests/run-inverts-tests.mjs
import { GridRef, fromUTM } from '../src/geo.js';
import { realNetwork } from '../src/network-real.js';
import { detectPipeFields, pipeRecords } from '../src/linked.js';
import { layerInputs, feature } from '../src/infra.js';
import { joinStructures } from '../src/assets.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const FT = 0.3048;
const g = new GridRef({ zone: 18, x0: 486000, y0: 4422000, x1: 486200, y1: 4422200, dx: 1 }), N = 200 * 200;
const ll = (x, y) => fromUTM(486000 + x, 4422200 - y, 18), pt = (x, y) => { const [lon, lat] = ll(x, y); return { lon, lat }; };
// high ground (100 m): an invert in feet read as metres is far above the ground, so the units are not ambiguous
const make = (ground) => { const z = new Float32Array(N); for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) z[j * 200 + i] = ground(i); return { z, bld: new Uint8Array(N), road: new Uint8Array(N), cls: null }; };
const hi = (x) => 100 - 0.02 * x, low = (x) => 15 - 0.02 * x, F = make(hi), FL = make(low);
const sim = { nx: 200, ny: 200, F: 1, mask: new Uint8Array(N).fill(1) };
const MF = detectPipeFields(['ASSETID', 'DIAMETER', 'US_INVERT', 'DS_INVERT'], [{ DIAMETER: 24 }, { DIAMETER: 18 }]);
// a pipe of a linked layer along y = 100, inverts given in metres (u = 1/FT writes them in feet), 1.5 m of cover
const pipe = (x0, x1, { up = 1.5, dn = 1.6, u = 1 / FT, y = 100, ground = hi, id } = {}) => ({ kind: 'line', coords: [ll(x0, y), ll(x1, y)],
  props: { ASSETID: id ?? `P${x0}_${x1}_${y}`, DIAMETER: 24, US_INVERT: up == null ? null : (ground(x0) - up) * u, DS_INVERT: dn == null ? null : (ground(x1) - dn) * u } });
const net = (fs, opts = {}, f = F) => realNetwork(g, f, pipeRecords(fs, MF), sim, { outfalls: [pt(180, 100)], ...opts });
const inv = (n, p, e) => n.nodes[e ? p.to : p.from].invert + (e ? p.outOffset : p.inOffset);
const real = (n) => n.pipes.filter(p => p.real);

// ---- 1, 2, 3+ records with recorded inverts (feet)
for (const k of [1, 2, 3, 5]) {
  const fs = Array.from({ length: k }, (_, i) => pipe(20 + 30 * i, 50 + 30 * i)), n = net(fs), ps = real(n);
  const allUsed = ps.every(p => p.prov.upInv === 'record' && p.prov.dnInv === 'record' && p.prov.invTrust.every(t => t.status === 'accepted' && t.units === 'ft'));
  // the recorded value itself (the node's ground is the lowest cell within 2 m, so cover alone would not show it)
  const exact = ps.every(p => near(inv(n, p, 0), hi(n.nodes[p.from].p[0]) - 1.5, 1e-3) && near(inv(n, p, 1), hi(n.nodes[p.to].p[0]) - 1.6, 1e-3));
  check(`${k} record(s) with recorded inverts in feet: used as recorded (${n.stats.inverts})`, allUsed && n.stats.inverts === 'from layer (ft)', JSON.stringify(ps[0].prov.invTrust));
  if (k <= 2) check(`…${k} record(s): the inverts are the recorded values (to 1 mm), not ones derived from the ground`, exact, ps.map(p => `${inv(n, p, 0).toFixed(3)} vs ${(hi(n.nodes[p.from].p[0]) - 1.5).toFixed(3)}`).join(', '));
}
{
  const n = net([pipe(20, 50)]), d = n.stats.invertUnits[0];
  check('…the layer\'s unit decision is reported: ft, from 1 record, 100 % plausible in ft and 0 % in m', d.units === 'ft' && d.n === 1 && d.frac.ft === 1 && d.frac.m === 0 && !d.ambiguous, JSON.stringify(d));
}
// ---- missing ends
{
  const n = net([pipe(20, 50, { dn: null }), pipe(50, 80), pipe(80, 110)]), p = real(n).find(q => q.L < 31 && n.nodes[q.from].p[0] < 30);
  check('one end missing: the recorded end is accepted, the other is "missing" and carried at the ground slope', p.prov.upInv === 'record' && p.prov.dnInv === 'carried' && p.prov.invTrust[0].status === 'accepted' && p.prov.invTrust[1].status === 'missing', JSON.stringify(p.prov));
  const m = net([pipe(20, 50, { up: null, dn: null }), pipe(50, 80), pipe(80, 110)]), q = real(m).find(r => n.nodes[r.from] && m.nodes[r.from].p[0] < 30);
  check('both ends missing: both "missing", the inverts derived from the ground', q.prov.invTrust.every(t => t.status === 'missing') && q.prov.upInv === 'derived', JSON.stringify(q.prov));
  const z = net([pipe(20, 50, { up: null, dn: null })]);
  check('a layer with no inverts at all: "derived from lidar", and the layer says why', z.stats.inverts === 'derived from lidar' && z.stats.invertUnits[0].how === 'the layer gives no inverts');
}
// ---- recorded against estimated: an implausible recorded invert is rejected, with its cover, and the end estimated
{
  const n = net([pipe(20, 50, { up: 40 }), pipe(50, 80), pipe(80, 110)]), p = real(n).find(q => n.nodes[q.from].p[0] < 30);
  check('a recorded invert 40 m under the ground: rejected with its cover, the end carried from the other', p.prov.invTrust[0].status === 'rejected' && p.prov.invTrust[0].cover > 30 && /m is outside 0\.2–30 m/.test(p.prov.invTrust[0].reason) && p.prov.upInv === 'carried' && n.stats.invRejected === 1, JSON.stringify(p.prov.invTrust[0]));
}
// ---- mixed provenance: a drawn pipe (metres, declared) and a one-record linked layer (feet) in one call
{
  const fc = { type: 'FeatureCollection', features: [feature('pipe', { type: 'LineString', coordinates: [ll(20, 150), ll(60, 150)] }, { D: 0.6, upInv: hi(20) - 1.5, dnInv: hi(60) - 1.6 })] };
  const drawn = layerInputs(fc).pipes, linked = pipeRecords([pipe(20, 60)], MF);
  const n = realNetwork(g, F, [...drawn, ...linked], sim, { outfalls: [pt(60, 150), pt(180, 100)] });
  const pd = real(n).find(p => near(n.nodes[p.from].p[1], 150, 2)), pl = real(n).find(p => near(n.nodes[p.from].p[1], 100, 2));
  check('mixed sources: the drawn pipe in its declared metres, the linked record in feet, each used', pd?.prov.invTrust.every(t => t.status === 'accepted' && t.units === 'm' && t.unitsFrom === 'declared by the record') &&
    pl?.prov.invTrust.every(t => t.status === 'accepted' && t.units === 'ft'), JSON.stringify([pd?.prov.invTrust[0], pl?.prov.invTrust[0]]));
  check('…the summary names both units', n.stats.inverts === 'from layer (m, ft)' || n.stats.inverts === 'from layer (ft, m)', n.stats.inverts);
}
// ---- conflicting records: the pipe layer against a structure record at the same end
{
  const recs = pipeRecords([pipe(20, 50), pipe(50, 80), pipe(80, 110)], { ...MF, upNode: 'ASSETID' });
  recs[0].asset.ends.up.node = 'MH1';
  const j = joinStructures(recs, [{ id: 'MH1', type: 'endwall', class: 'endwall', invert: recs[0].asset.ends.up.invert + 2, source: 'survey', method: 'surveyed' }]);
  const n = realNetwork(g, F, j.pipes, sim, { outfalls: [pt(180, 100)] }), p = real(n).find(q => n.nodes[q.from].p[0] < 30);
  check('a conflicting structure record: the conflict is kept on the end\'s reason, with how it was resolved', j.report.conflicts === 1 && /conflicts with structure record MH1/.test(p.prov.invTrust[0].reason), p.prov.invTrust[0].reason);
}
// ---- low ground: metres and feet both plausible
{
  const fs = [pipe(20, 50, { u: 1, ground: low }), pipe(50, 80, { u: 1, ground: low }), pipe(80, 110, { u: 1, ground: low })], n = net(fs, {}, FL), d = n.stats.invertUnits[0];
  check('low ground, inverts in metres that would also be plausible in feet: metres taken, as before, and said to be ambiguous', d.units === 'm' && d.ambiguous && real(n).every(p => p.prov.invTrust.every(t => t.status === 'accepted' && /ambiguous/.test(t.unitsFrom))), JSON.stringify(d));
  const o = net(fs, { invertUnits: 'ft' }, FL), p = real(o)[0];
  check('…`invertUnits: \'ft\'` overrides the inference (and its ends say so)', p.prov.invTrust.every(t => t.unitsFrom === 'set by the user' && t.units === 'ft'), JSON.stringify(p.prov.invTrust));
}

console.log(fails ? `\n${fails} FAILED` : '\nall invert-trust tests passed');
process.exit(fails ? 1 : 0);
