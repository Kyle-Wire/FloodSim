# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FloodSim is a browser-native 2D urban flood model: draw an area in the US, it builds a 1 m model from open data and runs a WebGPU shallow-water solver, coupled to EPA SWMM (compiled to WebAssembly) for pipes, rivers and storage. It is SPARC Labs' flood engine. Climate Home Inspection (`Kyle-Wire/climate-home-inspection`) calls it as a pinned external dependency, so a change here does not reach a report until that repo moves its pin in `docs/product/DEPENDENCIES.md` with a decision line.

## Commands

Node 24 (CI uses it). One npm dependency (`webgpu`), plus dev-only `geotiff`, `h5wasm`, `proj4`. No linter.

```bash
npm install
npm start                          # server/server.mjs: static files + cached open-data proxy, http://localhost:8766
npm test                           # tests/run-all.mjs: every CPU suite, one line each, exit 1 on any failure (this is CI)
node tests/run-tests.mjs           # core CPU solver suite (~1 min): accuracy, convergence, mass balance
node tests/run-<name>-tests.mjs    # one suite, e.g. run-design-tests.mjs; npm run test:<name> is the same
node tests/run-<name>-tests.mjs --live   # suites that have it also hit the real services
npm run test:gpu                   # GPU suite in headless Chrome/Edge (real WebGPU); --only <section>, --probe, --headed
npm run batch -- "<project>"       # a project's batch study headless on the GPU (tools/batch.mjs over tools/headless.mjs)
npm run validate                   # score each case in benchmarks/validation (--run [--ensemble] to re-run them)
node app/build.mjs                 # bundle dist/floodsim.html
npm run build:swmm                 # rebuild vendor/swmm (EPA SWMM 5.2.4) with Emscripten
```

`tests/run-gpu-browser.mjs` points at a Playwright Chromium path; set `CHROME_PATH` for another browser. The old Dawn runner (`test:gpu:dawn`) crashes compiling the shaders on some Windows/NVIDIA setups. GPU suites never run on CI.

## How the pieces fit

- **Two solvers, one physics.** `src/solver-cpu.js` is the fp64 reference; `src/kernels.wgsl.js` + `src/solver-gpu.js` is production. Changes to numerics go in both, and the CPU suite plus `test:gpu` must agree. `src/analytic.js` holds the exact solutions the tests score against.
- **Build pipeline.** `src/ingest.js` fetches 3DEP, OSM, NLCD, SSURGO (through the server's cache proxy) → `src/terrain.js` rasterizes to the 1 m grid (street burning, roughness/infiltration tables, roof routing) → optional layers (`soil`, `channels`, `bathymetry`, `infra`, `design`, `stormwater`, `barriers`, `gi`) edit that grid → the solver runs → `src/coupler.js` exchanges inlets with SWMM (`src/swmm.js`, `src/drainage.js`, `src/river.js`, `src/links.js`).
- **Forcing.** `src/storm.js` (Atlas 14 design storms), `src/history.js` + `src/mrms.js` + `src/radar.js` (historic replays such as Ida), `src/nowcast.js` (live radar), `src/compound.js` (tide and surge), `src/inflow.js` / `src/streamstats.js` (rivers).
- **Projects and scenarios.** A project folder holds the built model; `scenarios/<name>/design.geojson` + `scenario.json` are site-design edits applied by the pure `applyDesign(fine, design)`. No features must give a bit-identical baseline. `src/compare.js` only compares runs whose forcing fingerprints match. `src/batch.js` expands storms × scenarios × variants into jobs with stable ids.
- **Outputs and checks.** `src/report.js`, `src/damage.js`, `src/hazard.js`, `src/checks.js`, `src/validate.js`, `src/floodmaps.js`, `src/uncertainty.js`; `src/emulator.js` is a per-project Gaussian-process emulator.
- **UI.** `app/map.html` + `app/map.js` (MapLibre) and one `app/*-ui.js` drawer per feature. Phase 0 lab is `dist/floodsim.html`.

## Benchmarks and evidence

- `benchmarks/ea/` is Gate B (UK EA 2D benchmarks; `node benchmarks/ea/score.mjs`). `benchmarks/gatec/` is Gate C prep (mass balance, HEC-RAS comparisons). `benchmarks/physics/street/` is the street sandbox: cases with answers fixed before running, `REPORT.md`, `FIXES.md` and `HANDOFF.md` (read it before urban-hydraulics work). `benchmarks/FINDINGS.md` numbers findings (F12, F13, ...).
- `docs/ACCEPTANCE.md` maps FloodSim against FEMA 44 CFR 65.6; `docs/METHODS.md` and `docs/specs/` hold method and feature specs.
- Nothing is called validated unless it passed its stated review. Write the expected answer before a new case runs, and report failures as findings.

## Rules specific to this repo

- `README.md` is long (~1,700 lines) and is the feature-level record: when you change behaviour, update its section and the matching test in the same change.
- A scenario folder name must have no spaces: FloodSim refuses such a path and silently runs existing conditions instead.
- Cite only sources you have opened. Kyle merges; work on a branch and open a PR against `main`.
