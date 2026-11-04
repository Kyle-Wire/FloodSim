# Validation suite

Every case is a FloodSim project of a storm with observations (or another model's flood map to compare with),
scored from its latest filed run by `node tools/validate.mjs` (add `--run` to run them all again headless first).
The cases are in `cases.json`, every score so far in `history.json`; this page is rewritten each time.
Marks: RMSE / bias of the high-water mark levels (m, model − observed). Gauges: peak level error (m). Maps: cell by
cell at 4 in and over, buildings left out (hit rate: the map's flooded cells the model floods; CSI: hits / (hits + misses +
false alarms)). Band: the lowest to the highest level the base run and its batch variants give at each mark (roughness
± 20 %, infiltration × 0.5, one cell size coarser), a sensitivity band, not a probability. See docs/METHODS.md §5 for what
each case shows and what it does not.

## Latest

| Case | Run | Commit | Marks RMSE / bias (n) | Marks in the variants’ band | Gauges | Maps | Checks good / fair / poor | Change from the run before |
|---|---|---|---|---|---|---|---|---|
| Manayunk, Philadelphia — Ida 2021, Schuylkill River flood | 2026-11-04_134609 | f5e2632c5db6+dirty | 0.85 / −0.66 (11) | – | 01473800 −0.80; 01474000 +0.93 | – | 3 / 0 / 4 | marks RMSE −0.51 m, 01473800 0.71 m closer, 01474000 0.45 m closer |
| Forest Hills, Queens — Ida 2021, street and basement flooding | 2026-11-04_182532 | 1adcf35a90c1+dirty | 0.61 / −0.20 (25) | – | – | USGS mapped inundation, Ida 2021, Forest Hills: hit 33 %, CSI 14 %; NYC DEP, Moderate: hit 31 %, CSI 5 %; NYC DEP, Extreme: hit 16 %, CSI 9 % | 0 / 1 / 9 | first run |
| Forest Hills, Queens — Ida 2021, uncertainty band (4 m speed mode) | not run yet | | | | | | | |
| Forest Hills, Queens — against the NYC DEP Moderate Stormwater Flood Map | not run yet | | | | | | | |

## Manayunk, Philadelphia — Ida 2021, Schuylkill River flood

The Schuylkill through Manayunk crested 13.0 m at the Manayunk gauge on 2 Sept 2021. 11 USGS high-water marks scored (3 under bridge decks are not), the Manayunk and Wissahickon gauges inside the model; the river outlet holds the Philadelphia gauge (Fairmount Dam) carried up the river. docs/METHODS.md §5.8.

| Run | Commit | Storm | Marks RMSE / bias (n) | Gauges | Maps | Note |
|---|---|---|---|---|---|---|
| 2026-11-04_034702 | 33794a1d85c9+dirty | historic: Ida | 1.36 / −0.88 (11) | 01473800 −1.51; 01474000 −1.38 | – | scored in the app after the run (docs/METHODS.md §5.8) |
| 2026-11-04_134609 | f5e2632c5db6+dirty | historic: Ida | 0.85 / −0.66 (11) | 01473800 −0.80; 01474000 +0.93 | – | river outlet (91b0845); scored in the app after the run (docs/METHODS.md §5.8) |

## Forest Hills, Queens — Ida 2021, street and basement flooding

72 mm fell in one hour at about 9 pm on 1 Sept 2021 over a combined-sewer area. USGS high-water marks (flash flooding), the USGS depth maps made from them, and NYC 311 street-flooding reports. docs/METHODS.md §5.9.

| Run | Commit | Storm | Marks RMSE / bias (n) | Gauges | Maps | Note |
|---|---|---|---|---|---|---|
| 2026-11-04_182532 | 1adcf35a90c1+dirty | historic: Ida | 0.61 / −0.20 (25) | – | USGS mapped inundation, Ida 2021, Forest Hills: hit 33 %, CSI 14 %; NYC DEP, Moderate: hit 31 %, CSI 5 %; NYC DEP, Extreme: hit 16 %, CSI 9 % | indoor and basement marks not scored (USGS descriptions), rescored from the filed levels |
