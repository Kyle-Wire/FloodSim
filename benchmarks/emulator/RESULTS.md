# Emulator cascade on the backyard block: results (22–23 Nov 2026)

**What was tested.** Whether the project emulator (`src/emulator.js`) plus a router (`src/cascade.js`) can answer a
homeowner's what-ifs instantly, know when it is not sure, and send those requests to the full solver. Everything here is
a synthetic block, so it says how the method behaves, not how any real property floods.

## Setup
- `backyard.mjs`: four lots, 64 m × 64 m at 1 m, the CPU solver (second order, local time stepping), the 1-hr Atlas 14
  storm at Eastwick, Philadelphia (`tests/fixtures`), 2 hours simulated. The home lot has a 0.22 m low spot behind the
  house; the lot to its east can fill its back yard. Mass balance closed to 4e-14 in every run.
- Eight sliders, all continuous: storm 2–100 yr (log), soil wetness 0–1, neighbour's fill 0–0.4 m; French drain size,
  rain-garden depth 0–0.3 m, rain barrel 0–1000 L, share of back roof sent to the front, tree canopy 0–60 %. How each
  fix is represented is in the header of `backyard.mjs`; they are simple, stated assumptions.
- Runs (`study.mjs`): FloodSim's own training plan for 8 parameters (80-point maximin Latin hypercube + centre),
  3 held-out runs for calibration, 40 random test points, and 12 "fixes off" twins of the first test points. 136 solver
  runs, 111 s each on one CPU core.
- `validate.mjs` trains on the 81 training runs, calibrates on the 3 held-out runs, and scores the 40 test points;
  `sweep.mjs` repeats it for 12, 24, 40 and 81 training runs and tolerances of 1, 2 and 3 cm.

## Results (81 training runs, `results/cascade.json`)
| | |
|---|---|
| Emulator answer time | 2.5 ms (solver 111 s: about 44,000 × faster); training 31 s |
| Worst cell on the home lot, 40 unseen points | median 0.72 cm, 95th pct 1.43 cm, worst 1.49 cm |
| Depth RMSE on the home lot | median 0.14 cm, worst 0.33 cm |
| Water against the back wall | worst miss 0.23 cm |
| Calibration factor k (held-out runs) | 1.12 |
| Calibrated ±2σ covering the real error, per cell | median 98 % of cells per test point |
| Cascade at 3 cm | 1 of 40 sent to the solver; every emulator answer within 1.5 cm |
| Cascade at 2 cm | 13 of 40 sent to the solver; emulator answers within 1.5 cm |
| Cascade at 1 cm | all 40 sent to the solver (the estimate is never that tight here) |
| Fix effects, 12 pairs (fixes on minus off, same storm) | back-wall change: worst miss 0.20 cm; yard volume change: worst miss 0.34 m³ |

Figure 03 shows the calibrated estimate above the real worst error at every test point.

## How many solver runs it needs (`results/sweep.json`, figure 05)
| Training runs | Share sent to the solver at 3 cm | Worst emulator answer that got through |
|---|---|---|
| 12 | 100 % | none got through |
| 24 | 50 % | **3.4 cm, above the 3 cm tolerance (1 of 20)** |
| 40 | 50 % | 1.5 cm |
| 81 | 2.5 % | 1.5 cm |

With 24 runs the calibration (from 3 held-out runs) was too optimistic once. Retraining after each solver answer
("learning") cut the share sent to the solver modestly: at 40 runs and 3 cm, 45 % in the first 20 requests and 25 % in
the last 20. A study should use at least ~5 runs per parameter before the cascade answers anything, and more than 3
held-out runs for calibration.

## What the block itself says (a finding about the scene, not the method)
The low spot fills to its rim in every storm from 2 to 100 yr: water against the back wall ranges only 12.6–15.5 cm
over all 81 training runs. The fixes as modelled lower it by 0.1–1.0 cm and the standing water by up to 1.4 m³ of about
15 m³. In a yard like this the grading sets the answer, and storage-type fixes of these sizes barely move it. That is
also a limit of how simply the fixes are drawn (the trench takes water only where the pond reaches it; the barrel holds
at most 1 m³), and it should be checked on a real lot before anyone quotes it.

## Limits
- Synthetic block, one storm shape, CPU solver without pipes. Not a validation against measurements.
- The emulator is only valid inside the trained box; the router refuses anything outside it.
- 3 held-out runs is a thin calibration set (see the 24-run miss).

## Reproduce
```
node benchmarks/emulator/study.mjs <runs> 4          # 136 solver runs, ~70 min on 4 cores
node benchmarks/emulator/validate.mjs <runs> <out>   # ~1 min
node benchmarks/emulator/sweep.mjs <runs> <out>      # ~15 min
python benchmarks/emulator/figures.py <out> benchmarks/emulator/figures
node benchmarks/emulator/street.mjs <dir>            # the surprise-score test street (gridzip-lab surprise/)
node benchmarks/emulator/export-whatif.mjs <runs> benchmarks/emulator/results/cascade.json whatif.json
node benchmarks/emulator/build-whatif-page.mjs benchmarks/emulator/whatif-template.html index.html
```
