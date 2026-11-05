# Gate B — Environment Agency 2D benchmarks

The FloodSim GPU solver (the same WebGPU code the map app runs) on the UK Environment Agency 2D benchmark tests:
Néelz & Pender (2013), *Benchmarking the latest generation of 2D hydraulic modelling packages*, SC120002, with the
May 2010 test specifications.

**Gate B criterion (build plan):** results within the spread of established codes.

## Result (25 Oct 2026, NVIDIA Blackwell GPU, Chrome WebGPU)

| Test | What it tests | Grid | Inside the report's spread | Against 7 codes' probe series | Mass error | Wall time |
|---|---|---|---|---|---|---|
| 1 | Disconnected pond, wetting/drying | 70×10 @ 10 m | **4 / 4** | 100% of samples inside, median 1 mm | 3e-6 | 37 s |
| 2 | Filling floodplain depressions, 48 h | 100×100 @ 20 m | **10 / 10** | 100% inside every probe | −1e-5 | 32 s |
| 3 | Momentum over a hump | 60×20 @ 5 m | **6 / 6** | — | 3e-7 | 11 s |
| 4 | Flood wave over a flat plain | 200×400 @ 5 m | **12 / 12** | 100% inside, median ≤ 7 mm | −5.4e-6 | 54 s |
| 5 | Dam-break valley flood, 17 km | 256×226 @ 50 m | **13 / 13** | 100% inside (±0.1 m), median ≤ 6 cm | −6e-6 | 68 s |
| 6A | Lab dam break past a building | 1010×56 @ 0.1 m | **12 / 14** | — | −4e-7 | 37 s |
| 6B | Same at field scale (×20) | 1010×56 @ 2 m | **13 / 13** | — | −2e-5 | 55 s |
| 7 | 1D river linked to 2D floodplains, 72 h | 150×400 @ 20 m + 42-section river | **18 / 22** | — | −3.8e-5 (river 0.09 %) | 14 min |
| 8A/8B | Urban rainfall, surcharging sewer (Glasgow) | — | not run: inputs not in the public archive; see [TEST8.md](TEST8.md) | | | |

**88 / 94** reported measures fall inside the spread of the participating packages, and every probe series in
Tests 1, 2, 4 and 5 sits inside the envelope of the seven independently run codes.

### Where FloodSim falls outside

- **6A, G2 and G4 at 10–20 s.** In the laboratory (and most packages) the bow jump that forms upstream of the
  building migrates upstream past gauge G2 (x = 2.65 m) between about 12 and 18 s. In FloodSim it holds at
  x ≈ 2.9 m, about 0.25 m short, so G2 stays on the shallow supercritical jet until ~25 s. G4 beside the building is
  correspondingly ~1 cm low at 20 s. Not a resolution or limiter effect: the same at 0.05 m and with van Leer. The
  report saw the same kind of late, softer transition in one package (Ceasg, ~21 s) and concluded that no package
  consistently caught the transitions downstream of the gate. Candidates to examine: no turbulence (eddy viscosity)
  term, and the treatment of masked wall cells in the MUSCL reconstruction.
- **Test 7, four edge misses.** M045 is 8 cm high at 10 h (the downstream river holds its plateau a little above the
  packages while floodplain 3 fills); P6's peak is 6 mm over the band; flooding starts at P11 0.1 h late and at P14
  0.03 h early beyond the reading tolerance. The report found arrival times at these points differing by up to 3 h
  between packages. River peaks (M015–M045), all three floodplains' final levels (12.18 / 12.52 / 11.49 m against the
  report's ~12.13 / ~12.5 / ~11.5 m) and the timing of floodplain 1 and 2 flooding are inside.
- **Fixed: surface mass drift at heavy exchange cells** (was Test 4 −1.2e-4, Test 7 4e-4). fp32 round-off in cells
  that take in and pass on water every step for hours, all rounding the same way. Depth now carries a Kahan residual
  and the per-cell totals are folded into fp64 books (`benchmarks/gatec/README.md`): Test 4 −5.4e-6, Test 7 −3.8e-5,
  scores unchanged.

### Test 7 setup

- **River:** EPA SWMM dynamic wave on the 42 surveyed sections (M013–M054, n = 0.028): one junction per section, each
  reach split at its midpoint so each half takes its nearer section's shape, glass walls above the banks, the
  inflow hydrograph at M013 and the rating curve at M054 as a tabulated outlet. Conveyance is split into channel and
  overbanks at bank stations found where the section's top width grows fastest. River-only check at M015: the
  split lowers the peak 0.28 m against one lumped section, the midpoint split another 0.13 m.
- **Floodplains:** each is its bank breakline closed by its outer boundary; the 20 m bed is the mean of the 10 m DEM
  inside that floodplain, so channel samples do not leak into bank cells. Floodplain breaklines (embankments, roads)
  are burned in at their crest elevations; the A4104 causeway has a 40 m opening at 11.4 m. n = 0.04.
- **Links (524 cells):** Villemonte-drowned broad-crested weirs (C = 1.7) along the bank breaklines (11.9 km) and
  floodplain breakline 2, at each segment's crest; the 10 m opening at M030 (crest 10 m); the Pool Brook culvert
  (D 5 m, 10 m long, invert 6.25 m). Every 10 s the surface runs first, the volume each link cell actually exchanged
  goes to SWMM as lateral inflow over the same interval, then new rates come from both levels (capped at half the
  level difference over one cell per interval).

### Fixed along the way

- Test 6: the DEM draws walls as 10 m cells with interpolated ramps at their edges (1.58 m at the gate). Averaging
  the ramp into the edge cell narrowed the 1 m gate by ~10 % and slowed the reservoir; ramps are now wall. 6B went
  from 11/13 to 13/13.

## Reproduce

1. Data (Open Government Licence v3): `source/Benchmarking_Model_Data.zip` from
   [GOV.UK](https://www.gov.uk/flood-and-coastal-erosion-risk-management-research-reports/2d-benchmarking-evaluating-the-latest-generation-of-the-hydraulic-models-for-fcrm)
   (SHA-256 `388c2789…bc732`), unpacked into `data/`.
2. Run: start the server (`npm start`), open `/benchmarks/ea/run.html?tests=1,2,3,4,5,6a,6b,7`. Results are saved to
   `results/test*.json` (probe series, peak and final depth maps, mass books).
3. Score: `node benchmarks/ea/score.mjs` → `results/score.txt`, `results/score.json`.

## References used for the spread

- **Report bands**: values read from the figures and tables of SC120002, each widened by its reading precision
  (`score.mjs` lists every band). Figures are raster images, so these are readings by eye, not digitised data.
- **Test 7 bands**: river levels and floodplain points read from Figures 4.32–4.36 for the six full-SWE packages
  (ISIS Fast excluded), final floodplain levels from the report text (§4.8.5).
- **Seven codes' probe series** for Tests 1, 2, 4, 5: HEC-RAS 6.x (two versions), LISFLOOD-FP (ACC, FV1, DG2),
  TELEMAC-2D, ANUGA, as run by the open benchmark project
  [benchmark1d2d](https://github.com/scott-jeffers/benchmark1d2d) on the same EA inputs (`others/`). Third-party runs;
  probe sampling is hourly (Tests 1, 4) to 10-minutely (Test 2).
- Water levels are compared where everyone is wet (probe beds differ: FloodSim uses cell means, others point samples),
  depths elsewhere.

## Setup notes

- Grids are the specified resolutions; beds are the mean of the DEM cells in each model cell. Tests 2, 3: DEM clipped
  to the active rectangle; Test 5: the active-area polygon and DEM nodata define the mask.
- Inflows enter through the solver's inlet exchange (the same path SWMM overflow uses), spread evenly over the cells
  on the specified line, as exact time-averages of the hydrograph per output interval. Test 1's water level uses the
  stage boundary (the tide/surge path).
- No eddy viscosity (reported as 0, as the spec asks).
- Test 7 river data: the rating curve file is an Excel 97 workbook despite its .csv name; its values are in
  `test7-river.mjs`. River-only check: `node benchmarks/ea/test7-river.mjs`.
