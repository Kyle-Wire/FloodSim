// Made-up terrains for the street sandbox. Pure functions of the spec's parameters: no import from src/ or from the
// references, so the same ground goes to the model and to the hand calculation. Grids are row-major (k = j·nx + i),
// x = (i + ½)·dx east, y = (j + ½)·dx. Each scene returns the fine layers the app's own builders take
// ({ nx, ny, dx, z, bld, road, manning, infil }), plus `rain0` (cells that take no rain) where a scene needs it.
//
// Every bed is the mean of the analytic ground over its cell. The scenes are piecewise linear with their breaks on
// whole metres, so at dx ≤ 1 m the value at the cell centre is that mean.

const layers = (nx, ny, dx, zf, { bld = () => 0, road = () => 1, nRoad = 0.016, nOther = 0.03, rain0 = null } = {}) => {
  const N = nx * ny, f = { nx, ny, dx, z: new Float64Array(N), bld: new Uint8Array(N), road: new Uint8Array(N), manning: new Float64Array(N), infil: new Float64Array(N), rain0: rain0 ? new Uint8Array(N) : null };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = (i + 0.5) * dx, y = (j + 0.5) * dx;
    f.z[k] = zf(x, y); f.bld[k] = bld(x, y) ? 1 : 0; f.road[k] = !f.bld[k] && road(x, y) ? 1 : 0; f.manning[k] = f.road[k] ? nRoad : nOther;
    if (rain0 && rain0(x, y)) f.rain0[k] = 1;
  }
  return f;
};

/** A street as a tilted plane: falls east at S0 from a divide at x = 0 to z = 0 at x = L. Window [x0, x1) of it. */
export function plane({ L, W, S0, n, dx = 1, x0 = 0, x1 = L }) {
  return { ...layers(Math.round((x1 - x0) / dx), Math.round(W / dx), dx, (x) => S0 * (L - (x + x0)), { nRoad: n }), x0 };
}

/**
 * A street with a hollow: falls east at S0 for `up` m, a flat-floored hollow `hollow` m long sunk `depth` below its
 * rim, a level rim `rim` m long at z = 0, then falls east at S0 for `down` m. The rim takes no rain (its film would
 * split both ways), so the hollow's catchment is exactly the ground west of the rim. Window [x0, x1).
 */
export function hollowStreet({ W, S0, n, up, hollow, depth, rim, down, dx = 1, x0 = 0, x1 = up + hollow + rim + down }) {
  const a = up, b = up + hollow, c = b + rim;
  const zf = (x) => { const X = x + x0; return X < a ? S0 * (a - X) : X < b ? -depth : X < c ? 0 : -S0 * (X - c); };
  return { ...layers(Math.round((x1 - x0) / dx), Math.round(W / dx), dx, zf, { nRoad: n, rain0: (x) => x + x0 >= b && x + x0 < c }), x0 };
}

/** A street falling east at S0 into a level sag `sag` m long at z = 0, closed at its east end. */
export function sagStreet({ L, W, S0, n, sag, dx = 1 }) {
  return layers(Math.round(L / dx), Math.round(W / dx), dx, (x) => Math.max(0, S0 * (L - sag - x)), { nRoad: n });
}

/**
 * A terrace with a driveway dip. 16 × 16 m: the house row fills the north 8 m; the front lot (8 m deep) falls at 2 %
 * from both sides toward a 1 m wide driveway at x ∈ [7, 8), which runs level from the south edge to y = 2 m and then
 * dips at 15 % to the garage door in the house wall at y = 8 m. Everything that falls on the scene ends in the dip.
 */
export function driveway({ dx = 0.5, lot = 0.10, cross = 0.02, dip = 0.15 }) {
  const zf = (x, y) => (x >= 7 && x < 8 ? lot - dip * Math.max(0, Math.min(y, 8) - 2) : lot + cross * (x < 7 ? 7 - x : x - 8));
  return layers(16 / dx, 16 / dx, dx, zf, { bld: (x, y) => y >= 8, road: (x) => x >= 7 && x < 8 });
}

/**
 * A terrace with a rear yard that drains through a side passage. 16 × 16 m: a house row y ∈ [6, 10) cut by a 1 m wide
 * passage at x ∈ [7, 8); the rear yard (y ≥ 10) falls at 1 % toward the passage mouth; the passage falls south at 2 %;
 * the front (y < 6) is a street falling west at 1 % and sitting 0.3 m below the yard, where all the water ends.
 */
export function rearYard({ dx = 0.5, yard = 0.30, fall = 0.01, pass = 0.02, street = 0.01 }) {
  const zf = (x, y) => (y >= 10 ? yard + fall * (Math.abs(x - 7.5) + (y - 10)) : y >= 6 ? yard - pass * (10 - y) : street * x);
  return layers(16 / dx, 16 / dx, dx, zf, { bld: (x, y) => y >= 6 && y < 10 && !(x >= 7 && x < 8), road: (x, y) => y < 6 });
}

/**
 * A made-up neighbourhood in a bowl: 128 × 96 m. Main Street runs east–west (8 m wide, y ∈ [44, 52)), West and East
 * Streets north–south (x ∈ [28, 36) and [92, 100)). The ground falls toward the Main / East crossing at `fall`
 * (z = fall·(|x − 96| + |y − 48|)); lots stand `kerb` above the streets; houses are 8 × 10 m blocks set 4 m back
 * from Main Street, 4 m apart. → fine layers plus `houses` [{ id, i0, j0, i1, j1 }] (cell ranges at 1 m).
 */
export function block({ dx = 1, fall = 0.008, kerb = 0.15 }) {
  const NX = 128, NY = 96, onStreet = (x, y) => (y >= 44 && y < 52) || (x >= 28 && x < 36) || (x >= 92 && x < 100);
  const houses = [];
  for (const [y0, y1] of [[30, 40], [56, 66]]) for (let x0 = 2; x0 + 8 <= NX; x0 += 12) {
    if ((x0 < 36 + 2 && x0 + 8 > 28 - 2) || (x0 < 100 + 2 && x0 + 8 > 92 - 2)) continue; // keep 2 m clear of the side streets
    houses.push({ id: houses.length + 1, x0, y0, x1: x0 + 8, y1 });
  }
  const inHouse = (x, y) => houses.some(h => x >= h.x0 && x < h.x1 && y >= h.y0 && y < h.y1);
  const f = layers(NX / dx, NY / dx, dx, (x, y) => fall * (Math.abs(x - 96) + Math.abs(y - 48)) + (onStreet(x, y) ? 0 : kerb), { bld: inHouse, road: onStreet });
  return { ...f, houses, streets: [{ name: 'Main', line: [[0, 48], [NX, 48]] }, { name: 'West', line: [[32, 0], [32, NY]] }, { name: 'East', line: [[96, 0], [96, NY]] }], sag: [96, 48] };
}

/** Half a street with a kerb (diagnostics only; added after registration, no registered case uses it): falls east
 *  at SL and toward the kerb along y = 0 at the cross slope Sx. */
export function gutterStreet({ L, W, SL, Sx, n, dx = 1 }) {
  return layers(Math.round(L / dx), Math.round(W / dx), dx, (x, y) => SL * (L - x) + Sx * y, { nRoad: n });
}

export const SCENES = { plane, hollowStreet, sagStreet, driveway, rearYard, block, gutterStreet };
