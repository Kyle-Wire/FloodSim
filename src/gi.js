// Green infrastructure scenarios (Phase 2) as solver layers.
//
// Distributed GI is represented per solver cell as an extra infiltration path into a store of fixed capacity that
// drains to the native soil (kernel: GI / GS buffers). A cell's GI is the share of its street area converted to
// permeable pavement plus the share of its open ground converted to rain gardens, so the effect scales with how much
// of the area is treated. Typical design values (EPA SWMM LID manual ranges):
//   permeable pavement  surface intake 1000 mm/hr; 500 mm stone reservoir at 40% voids = 200 mm of storage
//   rain garden         engineered soil 100 mm/hr; 150 mm ponding + 600 mm soil at 25% = 300 mm of storage
//   both drain to the native soil at its SSURGO soil-group rate (A 10, B 5, C 2.5, D 1, urban fill 2 mm/hr)
// Green roofs retain the first 25 mm of rain on the share of roofs that carry them (substrate field capacity); after
// that their runoff joins the rest (src/terrain.js roof routing).
import { HSG_RATE, URBAN_FILL_RATE } from './terrain.js';

export const GI = {
  pavement: { rate: 1000, store: 0.2 },    // mm/hr, m
  rainGarden: { rate: 100, store: 0.3 },
  greenRoofRetention: 0.025,               // m of rain held per storm
};
const MMHR = 1 / 3.6e6;

/**
 * Solver-grid GI layers.
 * @param f  fine model (bld, road, hsg)   @param c coarse model (nx, ny, mask, roadFrac)   @param F cell size (m)
 * @param o  { pavement: share of street area (0–1), rainGarden: share of open ground (0–1) }
 * @returns null when no GI, else { rate, cap, drain } (m/s, m, m/s per cell) and treated areas (m²)
 */
export function giLayers(f, c, F, { pavement = 0, rainGarden = 0 }) {
  if (!(pavement > 0 || rainGarden > 0)) return null;
  const N = c.nx * c.ny, rate = new Float64Array(N), cap = new Float64Array(N), drain = new Float64Array(N);
  let pavedArea = 0, gardenArea = 0;
  const soil = ['', 'A', 'B', 'C', 'D'];
  for (let J = 0; J < c.ny; J++) for (let I = 0; I < c.nx; I++) {
    const K = J * c.nx + I; if (!c.mask[K]) continue;
    let road = 0, open = 0, soilRate = 0;
    for (let j = J * F; j < (J + 1) * F; j++) for (let i = I * F; i < (I + 1) * F; i++) {
      const k = j * f.nx + i; if (f.bld[k]) continue;
      if (f.road[k]) road++; else open++;
      soilRate += f.hsg[k] ? HSG_RATE[soil[f.hsg[k]]] : URBAN_FILL_RATE;
    }
    const n = F * F, pv = pavement * road / n, rg = rainGarden * open / n; // treated shares of the cell
    if (pv + rg <= 0) continue;
    rate[K] = (pv * GI.pavement.rate + rg * GI.rainGarden.rate) * MMHR;
    cap[K] = pv * GI.pavement.store + rg * GI.rainGarden.store;
    drain[K] = (pv + rg) * (soilRate / Math.max(1, road + open)) * MMHR;
    pavedArea += pv * n; gardenArea += rg * n;
  }
  return { rate, cap, drain, pavedArea, gardenArea };
}
