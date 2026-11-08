// Groundwater return flow (src/groundwater.js): the store fills from a share of what soaks in and empties into the
// streams as a linear reservoir; the cells it uses along the mapped streams.
// Usage: node tests/run-groundwater-tests.mjs
import { GroundwaterReturn, streamCells } from '../src/groundwater.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// a run of the exchange: every interval, the cells take exactly the rate asked for
const drive = (gw, seconds, dt = 2) => {
  let rate = gw.step(new Float32Array(gw.count), null, dt);
  for (let t = 0; t < seconds; t += dt) rate = gw.step(Float32Array.from(rate, q => q * dt), null, dt);
  return rate;
};

{
  const gw = new GroundwaterReturn([1, 2, 3, 4], { share: 0.2, lagH: 10 });
  gw.recharge(50000); gw.recharge(40000); // a total that drops (a read out of order) feeds nothing
  check('a share of what soaked in fills the store', Math.abs(gw.store - 10000) < 1e-9 && gw.totals.recharge === 10000, `${gw.store}`);
  const q0 = -drive(gw, 0)[0] * 4;
  check('it empties at store / lag', Math.abs(q0 - 10000 / 36000) / q0 < 1e-3, `${q0.toFixed(4)} m³/s`);
  drive(gw, 36000);
  check('after one lag about e⁻¹ is left', Math.abs(gw.store / 10000 - Math.exp(-1)) < 2e-3, (gw.store / 10000).toFixed(4));
  check('what left the store is what the streams got', Math.abs(gw.totals.volume + gw.store - 10000) < 1e-6, `${(gw.totals.volume + gw.store).toFixed(6)}`);
  gw.recharge(90000); // 40,000 more soaked in since the store last saw 50,000
  check('later infiltration feeds it again', Math.abs(gw.totals.recharge - 18000) < 1e-9);
}
{
  const gw = new GroundwaterReturn([7], { share: 0.5, lagH: 2 });
  gw.recharge(100); drive(gw, 30 * 3600);
  check('a short lag empties it within the run', gw.store < 1e-3 && Math.abs(gw.totals.volume + gw.store - 50) < 1e-6, gw.totals.volume.toFixed(6)); // the rates are fp32
  let bad = 0; for (const o of [{ share: -0.1, lagH: 5 }, { share: 1.2, lagH: 5 }, { share: 0.2, lagH: 0 }]) try { new GroundwaterReturn([1], o); } catch { bad++; }
  check('a share outside 0–1 or a lag of 0 is refused', bad === 3);
}
{
  // fine grid 1 m, 100 × 10; solver grid 2 m, 50 × 5; one stream along row 4 of the fine grid, the solver's
  // cell 10 used by another exchange point, and the last 20 m outside the model
  const fine = { nx: 100, ny: 10, dx: 1 }, c = { nx: 50, ny: 5, mask: new Uint8Array(250).fill(1) };
  for (let i = 40; i < 50; i++) c.mask[2 * 50 + i] = 0;
  const path = Array.from({ length: 100 }, (_, i) => 4 * 100 + i);
  const cells = streamCells([path, path], fine, c, 2, new Set([2 * 50 + 0]), { spacing: 10 });
  check('one cell every spacing m along the stream, on the solver grid', cells.join() === [5, 10, 15, 20, 25, 30, 35].map(i => 2 * 50 + i).join(), cells.join());
  check('no streams: no cells', streamCells(undefined, fine, c, 2).length === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall groundwater tests passed');
process.exit(fails ? 1 : 0);
