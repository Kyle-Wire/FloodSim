// Uncertainty band tests: marks against the spread of a base run and its variants (inside, above the band, below it),
// the variant that moves the levels most, marks a member did not score left out, and flood-map score ranges.
// Usage: node tests/run-uncertainty-tests.mjs
import { markBands, mapBands, wetAgreement } from '../src/uncertainty.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

// three marks at 10 m observed: the base reads 9.8, 9.0 and 10.5; roughness + 20 % raises every mark 0.3 m, − 20 % lowers it 0.2 m
const pt = (name, model, kind = 'level') => ({ name, lon: -75, lat: 40 + name.length * 1e-4, kind, observed: 10, model, error: model - 10 });
const shift = (pts, d) => pts.map(p => ({ ...p, model: p.model + d, error: p.error + d }));
const base = [pt('A', 9.8), pt('BB', 9.0), pt('CCC', 10.5)];
const members = [{ key: 'base', points: base }, { key: 'n+20', label: 'Roughness × 1.2', points: shift(base, 0.3) }, { key: 'n-20', label: 'Roughness × 0.8', points: shift(base, -0.2) }];
{
  const b = markBands(members);
  check('three marks, all members', b.n === 3 && b.members.join() === 'base,n+20,n-20');
  const [A, B, C] = b.rows;
  check('a mark inside the band', A.inside && near(A.lo, 9.6) && near(A.hi, 10.1) && near(A.width, 0.5));
  check('a mark above the band: the model low whatever the inputs', !B.inside && B.below && near(B.hi, 9.3));
  check('a mark below the band', !C.inside && !C.below && near(C.lo, 10.3));
  check('share inside and the band width', near(b.share, 1 / 3) && near(b.meanWidth, 0.5) && near(b.maxWidth, 0.5));
  check('the variant that moves the levels most comes first', b.drivers[0].key === 'n+20' && near(b.drivers[0].meanShift, 0.3) && near(b.drivers[1].meanShift, -0.2));
  check('a tolerance widens the band', markBands(members, { tol: 0.31 }).inside === 2);
}
{
  // a mark one member skipped (under a bridge there) or called flooded / dry only is not in the band
  const m2 = members.map((m, i) => ({ ...m, points: i === 2 ? m.points.map(p => (p.name === 'A' ? { ...p, model: null, error: null } : p)) : m.points }));
  check('a mark a member did not score is left out', markBands(m2).n === 2);
  const m3 = members.map(m => ({ ...m, points: [...m.points, { name: 'D', lon: -75, lat: 41, kind: 'flooded', observed: null, model: null, error: null }] }));
  check('flooded / dry calls are not in the band', markBands(m3).n === 3);
  check('one member is no band', markBands([members[0]]) === null);
}
{
  const fm = (csi, hit) => [{ name: 'USGS', observed: true, csi, hitRate: hit, areaRatio: 1 }];
  const r = mapBands([{ key: 'base', floodMaps: fm(0.5, 0.7) }, { key: 'n+20', floodMaps: fm(0.55, 0.8) }, { key: 'n-20', floodMaps: fm(0.45, 0.6) }]);
  check('flood-map score ranges', r.length === 1 && r[0].members === 3 && near(r[0].csi[0], 0.45) && near(r[0].csi[1], 0.55) && near(r[0].hitRate[1], 0.8) && r[0].base.csi === 0.5);
  const a = wetAgreement([new Float32Array([0, 0.2, 0.3]), new Float32Array([0.2, 0.1, 0.3])], 0.15, new Uint8Array([0, 0, 1]));
  check('cells wet in how many members (buildings left out)', a[0] === 1 && a[1] === 1 && a[2] === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
