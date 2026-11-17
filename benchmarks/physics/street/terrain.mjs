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

/**
 * A street with kerbs and a crown (added 17 Nov for PV-SS9 revision 2). 24 × 16 m, closed: an 8 m street along x at
 * y ∈ [5, 13) falling at `cross` from its crown (y = 9) to both gutters; lots behind kerbs `kerb` high, falling to
 * the street at `lot`. Rain falls on the south side only (y < 9), so the north gutter's true depth is nil. The kerb
 * lines sit on odd metres: 2 m and 4 m cells straddle them.
 */
export function kerbStreet({ dx = 1, cross = 0.02, kerb = 0.15, lot = 0.02 }) {
  const zf = (x, y) => (y >= 5 && y < 13 ? cross * (4 - Math.abs(y - 9)) : y < 5 ? kerb + lot * (5 - y) : kerb + lot * (y - 13));
  return layers(24 / dx, 16 / dx, dx, zf, { road: (x, y) => y >= 5 && y < 13, rain0: (x, y) => y >= 9 });
}

/**
 * A lot with a small hollow (added 17 Nov for PV-SS9 revision 2). 16 × 16 m, closed, falling south at S; a 3 × 3 m
 * hollow at x, y ∈ [5, 8) with a level floor `depth` below its rim (the ground just downslope of it). Its catchment
 * is the hollow and the 3 m strip upslope of it: 33 m².
 */
export function hollowLot({ dx = 1, S = 0.02, depth = 0.15 }) {
  const rim = S * 4.5, zf = (x, y) => (x >= 5 && x < 8 && y >= 5 && y < 8 ? rim - depth : S * y);
  return layers(16 / dx, 16 / dx, dx, zf, { road: () => false });
}

/**
 * A yard that drains to a small hollow (PV-SS9 revision 2, second setup). 16 × 16 m: above y = 5 the ground falls
 * south at S and toward the line x = 6.5 at Sx; a 3 × 3 m hollow at x, y ∈ [5, 8) has a level floor `depth` below its
 * rim; the row below it (y ∈ [4, 5)) is a berm except over the hollow's width, where it is the rim, and takes no rain.
 * So the hollow's catchment is exactly the ground above y = 5: 176 m². Below the berm the lot falls south to its foot.
 */
export function hollowYard({ dx = 1, S = 0.02, Sx = 0.02, depth = 0.15, berm = 0.30 }) {
  const rim = S * 4.5, inH = (x, y) => x >= 5 && x < 8 && y >= 5 && y < 8;
  const zf = (x, y) => (inH(x, y) ? rim - depth : y >= 5 ? S * y + Sx * Math.abs(x - 6.5) : y >= 4 ? rim + (x >= 5 && x < 8 ? 0 : berm) : S * y);
  return layers(16 / dx, 16 / dx, dx, zf, { road: () => false, rain0: (x, y) => y >= 4 && y < 5 });
}

/**
 * One owner's lot (added 17 Nov for PV-SS12). 10 × 10 m, closed, falling east at S, so everything ends against the
 * east edge; with `house`, a 4 × 4 m building at x ∈ [0, 4), y ∈ [3, 7).
 */
export function lot10({ dx = 1, S = 0.02, house = false }) {
  return layers(10 / dx, 10 / dx, dx, (x) => S * (10 - x), { bld: (x, y) => house && x < 4 && y >= 3 && y < 7, road: () => false });
}

export const SCENES = { plane, hollowStreet, sagStreet, driveway, rearYard, block, gutterStreet, kerbStreet, hollowLot, hollowYard, lot10 };
