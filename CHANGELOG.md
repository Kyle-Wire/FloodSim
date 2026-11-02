# Changelog

Every FloodSim result is cited by a **version** and a **commit**. The version is what goes in a report, a model
archive or a submittal; the commit is what re-runs it. Both are written into every run's `summary.json`, into the
comparison and report exports, and into the Unreal package metadata. `GET /api/version` returns
`{ version, commit, dirty }` for the running checkout.

## Versioning

Semantic versioning, read for a model rather than a library — the "API" whose compatibility a version promises is
**the numbers the model produces**:

| Change | Bump |
| --- | --- |
| Results change for an unchanged input: solver numerics, defaults, parameter tables, data sources | **major** |
| New capability, new output, new setting, with existing inputs reproducing their previous results | **minor** |
| Fixes and documentation that leave every result bit-identical | **patch** |

A release whose results move is a major release even when the change is a bug fix: a reviewer holding an archived run
has to be able to tell from the version alone whether re-running it should reproduce it.

**Pre-1.0.** FloodSim is `0.x` while its validation record is incomplete. Under `0.x` the table above applies with
minor in place of major (`0.1.0` → `0.2.0` for a result-changing release, `0.1.0` → `0.1.1` otherwise), and no
compatibility is promised across minor versions. `1.0.0` is for when the validation report (Phase 1) is published and
Gate C is passed — not before.

## Tags

- One annotated tag per release, named `v<version>` (`v0.1.0`), on `main`, matching `package.json` at that commit.
- The tag message is the changelog entry for that version.
- Nothing is tagged that the suites do not pass on.
- Results produced between releases cite the version of the last release plus the commit, and `+dirty` when the
  checkout had uncommitted changes — a `+dirty` run is not citable in a submittal.
- Pre-release builds, if they are ever needed, are `v<version>-rc.<n>`; `-rc` builds are not for submittals.

The repository has no tags before `v0.1.0`. Earlier work is identified by commit only, and runs saved before this
release have no `version` field in their `summary.json` at all. When such a run is reloaded the field is read as
absent: the H&H report's provenance row shows `–` and the comparison export records `"version": null`. A run made by
a checkout whose version cannot be read — no `version` in `package.json`, or `/api/version` unreachable — records the
string `"unknown"` instead, which is a distinct case and not citable either.

---

## 0.1.0 — 2026-11-01

First numbered version. Nothing in the model changed: this release puts a citable identifier on the state the
repository was already in, so that work after it can be described against a fixed point.

### Added

- `version` in `package.json`, served by `GET /api/version` alongside the commit and the dirty flag.
- The version in every run output that already carried the commit: `summary.json`, the comparison export's
  `comparison.json`, the H&H report's provenance table, the Unreal package metadata, and the emulator study and its
  validation record.
- This changelog, with the versioning rules and the tag scheme above.
- Four test suites that exist and had npm scripts but were missing from the README's run list
  (`run-design-tests.mjs`, `run-stormwater-tests.mjs`, `run-compare-tests.mjs`, `run-swmm-tests.mjs`).
- **The gates this version is tagged against, by SPA-91** ([#6](https://github.com/Kyle-Wire/FloodSim/pull/6)), not by
  this ticket. `tests/run-tests.mjs` printed its convergence orders and mass errors and exited 0 whatever they were; it
  now asserts 52 checks with thresholds annotated with the value measured and the margin left. `benchmarks/ea/score.mjs`
  likewise exits non-zero when a measure leaves its band or drifts, against a committed `baseline.json`, and the EA
  results now carry the commit, the input archive's SHA-256 and the GPU adapter. CI (`.github/workflows/ci.yml`) runs
  the core suite and all 21 feature suites on every push and pull request, with a guard that fails if a test script
  exists that no workflow runs. The GPU and EA-score gates need a real WebGPU adapter and live in `nightly-gpu.yml`,
  which is committed but does not run: the repository has no self-hosted runner registered.
  The tag rule "nothing is tagged that the suites do not pass on" is only enforceable because of that work, which is
  why `v0.1.0` waits for it to be on `main`.

### Fixed (documentation)

- "Known limits (solver)" claimed infiltration was a constant capacity and not Green-Ampt. Green-Ampt from SSURGO has
  been the default; the constant rate by soil group is the alternative. The same claim was stale in the Numerics list
  and in the Phase 1 source table.
- "No catchment delineation" in the Phase 1 limits, contradicted by the watershed tool in the same README.
- The Phase 1 limit on sampled peak speed did not distinguish the readback-sampled `max_speed.asc` from the per-step
  peak speed the hazard products use.
- The Status section said "seven independently run codes" and quoted "88 of 94" without its qualifications. Both now
  follow the wording the methodology report's claim audit sets: seven third-party runs of four packages within a
  stated margin, and 81 of 94 inside the raw bands.
- A note that the GPU browser runner points at a Playwright install path: it finds Chrome or Edge itself, or takes
  `CHROME_PATH`. Two `localhost:8770` references for a server that serves on 8766.
- The CFL list omitted the subgrid speed mode's 0.5.

### State at this version

What the evidence supports, and does not, is set out in the FloodSim methodology and validation report (draft 0.1,
29 October 2026), whose claim audit governs how these results may be described. In short:

- **Solver.** Browser-native 2D shallow water (finite volume, MUSCL, hydrostatic reconstruction, HLLC, SSP-RK2) as
  a fp64 CPU reference and WGSL compute kernels verified against it.
- **Gate B passed** for the published tests: 88 of 94 EA 2D benchmark measures (Néelz & Pender 2013, SC120002) inside
  the spread of the packages in that report, 81 of 94 inside the raw bands. Tests 8A/8B unrun (the data needs an EA
  request). Test 6A misses the jump position; Test 7 scores 18 of 22.
- **Gate C is not passed.** The combined mass balance closes on four sites with every exchange model on, and the
  surface agrees with HEC-RAS on EA Tests 1, 2, 4, 5; the one storm-sewer comparison (HEC-RAS's Davis example) is
  16 % low on pumped volume and leaves more residual ponding.
- **Not validated against an observed flood.** No comparison with a measured event exists in this repository.
- Sediment, debris flow, bank stability, scour and the soil screening layers are checked against analytical cases,
  the CPU reference or internal conservation only, with no field validation. Treat them as flags, not design inputs.
- All GPU results come from one NVIDIA Blackwell GPU in Chrome.
