// Channel bathymetry tests: the regional curves against Bieger et al. (2015), the flattened water surface found among
// noisy ground, D8 accumulation, and the carved section (centre depth = bankfull depth less the bank height, parabolic
// across the width, volume ≈ ⅔·depth·width·length).
// Usage: node tests/run-bathymetry-tests.mjs
import * as B from '../src/bathymetry.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

{
  const u = B.bankfull(100), p = B.bankfull(756, B.CURVES.AHI);
  check('nationwide curve: W = 2.70·A^0.352, D = 0.30·A^0.213', Math.abs(u.W - 2.70 * 100 ** 0.352) < 1e-12 && Math.abs(u.D - 0.30 * 100 ** 0.213) < 1e-12, `A 100 km²: W ${u.W.toFixed(1)} m, D ${u.D.toFixed(2)} m`);
  check('Appalachian Highlands (Patapsco, 756 km²)', p.W > 30 && p.W < 50 && p.D > 1.5 && p.D < 3, `W ${p.W.toFixed(1)} m, D ${p.D.toFixed(2)} m`);
}

// a valley 200 × 120 cells (1 m) draining east: a flattened river 24 m wide (rows 48–71) stepping down 1 mm per column,
// banks rising 1 m over 4 m then a floodplain with ±1.5 cm lidar noise
const nx = 200, ny = 120, z = new Float64Array(nx * ny), water0 = new Uint8Array(nx * ny);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.03;
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i, off = j < 48 ? 48 - j : j > 71 ? j - 71 : 0, surf = 10 - 0.001 * i;
  if (!off) { z[k] = surf; water0[k] = 1; } else z[k] = surf + Math.min(1, off / 4) + (off > 4 ? 0.002 * (off - 4) + rnd() : rnd() * 0.3);
}
{
  const seeds = []; for (let i = 0; i < nx; i++) seeds.push(60 * nx + i); // the mapped centreline
  const m = B.flatWater(z, nx, ny, seeds);
  let hit = 0, extra = 0, miss = 0; for (let k = 0; k < m.length; k++) { if (m[k] && water0[k]) hit++; else if (m[k]) extra++; else if (water0[k]) miss++; }
  check('flattened surface found, noisy banks left out', miss < 0.002 * hit && extra < 0.01 * hit, `${hit} water cells, ${extra} extra, ${miss} missed`);
  const acc = B.accumulation(z, nx, ny); let mx = 0; for (const v of acc) mx = Math.max(mx, v);
  check('D8 accumulation gathers the valley', mx > 0.3 * nx * ny, `${mx} cells at the outlet of ${nx * ny}`);
  // 20 km² entering from upstream: W ≈ 7.7 m, D ≈ 0.57 m < the 1 m bank → the minimum depth; with 2000 km², D ≈ 1.5 m
  const big = B.carveChannels(z, nx, ny, 1, m, { areaAt: (k) => (k % nx === 0 ? 2000 : 0) }), c = big.comps[0];
  const centre = big.dz[60 * nx + 100], quarter = big.dz[54 * nx + 100], edge = big.dz[48 * nx + 100];
  check('centre depth = bankfull centre depth (1.5 × mean) − bank height', Math.abs(c.bank - 1) < 0.05 && Math.abs(c.dc - (1.5 * c.D - c.bank)) < 1e-9 && Math.abs(centre - c.dc) < 0.05 * c.dc, `A ${c.areaKm2.toFixed(0)} km², D ${c.D.toFixed(2)} m, bank ${c.bank.toFixed(2)} m, centre ${centre.toFixed(2)} m`);
  check('parabolic across the width, shallow at the edge', quarter > 0.6 * centre && quarter < 0.85 * centre && edge < 0.2 * centre, `quarter ${(quarter / centre).toFixed(2)}·centre, edge ${(edge / centre).toFixed(2)}·centre`);
  check('volume ≈ ⅔ · depth · width · length', Math.abs(big.volume / (2 / 3 * c.dc * 24 * nx) - 1) < 0.15, `${big.volume.toFixed(0)} m³`);
  const small = B.carveChannels(z, nx, ny, 1, m, { areaAt: (k) => (k % nx === 0 ? 20 : 0) }).comps[0];
  check('a small river well below its banks: the minimum depth', small.dc === 0.3 && 1.5 * small.D < small.bank, `centre depth ${(1.5 * small.D).toFixed(2)} m vs bank ${small.bank.toFixed(2)} m`);
  check('nothing carved outside the water', [...big.dz].every((v, k) => !v || m[k]));
}

console.log(fails ? `\n${fails} FAILED` : '\nall bathymetry tests passed');
process.exit(fails ? 1 : 0);
