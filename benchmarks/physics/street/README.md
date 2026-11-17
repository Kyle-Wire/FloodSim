# Street sandbox (PV-SS1 … PV-SS12)

Made-up street cases whose answers are known before the model runs: by hand arithmetic, a closed form, or a
laboratory measurement. A family of the physics suite (`../README.md`), built 17 Nov 2026 at Kyle's instruction to
test the urban hydraulics behind the home-buyer flood report.

- **Short report:** [REPORT.md](REPORT.md). **Every scored row:** [RESULTS.md](RESULTS.md). **Findings:**
  `../../FINDINGS.md`, F12–F24.
- This family did not go through the three reviews `../milestone2/` sets for PVM2 tests, and it does not touch PVM2's
  held items (PV-TF1-R2, PV-RV1, production wiring). Its results are sandbox results. **Nothing here is called
  validated.**

```
node benchmarks/physics/street/score.mjs --expect            every hand answer; reads no result
node benchmarks/physics/street/exec-cpu.mjs --spec PV-SS1    run a spec's cases on the CPU solver → street/raw/<stamp>/
node benchmarks/physics/street/run-browser.mjs --spec PV-SS1 the same on the GPU solver in headless Chrome or Edge
node benchmarks/physics/run.mjs --only PV-SS1,PV-SS2         score the latest raw file of each case → ../results/<run-id>/
node benchmarks/physics/street/report.mjs                    RESULTS.md from the latest scored run of each spec
```

Run the sandbox with `--only`: a bare `run.mjs` runs every spec in the suite, PV-TF1 included.

## The cases

| Spec | Kyle's case | What is known in advance |
|---|---|---|
| PV-SS1 | 1 Rain on a tilted street | outflow = rain × area; steady depth and time to steady state from the kinematic wave |
| PV-SS2 | 2 A hollow under rain | depth = rain volume / floor area; it spills at the rim and ends at the rim, whatever the storm |
| PV-SS3 | 3 One inlet, one pipe; the app's synthetic network at 10-, 100-, 500-yr | the pond's level from Manning's full-pipe friction and the grate's orifice; the network's heads against a friction grade line worked by hand |
| PV-SS4 | 4 An outfall held under water | the street stands at the outlet's level; with rain, the PV-SS3 pond with that level |
| PV-SS5 | 5 The same block in a small box and a large one | the true answer is the whole terrain's; the small box's own answer from the slope length inside it |
| PV-SS6 | 6 A driveway dip and a rear yard at 0.5, 1, 2, 4 m, 4 m and 8 m subgrid | the level a rain volume stands at on the 0.5 m ground; each grid's own answer from its mean ground |
| PV-SS7 | 7 The wall-exposure rule | twelve hand-made depth grids |
| PV-SS8 | 8 Pipes, an allowance, no drainage | no drainage is arithmetic; the allowance has an upper bound; the pipes are reported beside them |
| PV-SS9 | 9 Coarse run then downscale: do a kerb, a crown and a small hollow survive? (revision 2) | a gutter pond below its kerb and crown; a hollow holding its yard's rain; the bowl's end level |
| PV-SS10 | laboratory | 15 steady tests of the Sheffield rig (Rubinato et al. 2017): the exchange into the sewer at a measured depth |
| PV-SS11 | 8, made thorough: surface only, an allowance, or pipes, each against a known answer | a sag whose drain keeps up, a sag whose drain cannot, a hollow with no drain, a kerbed street on a grade (FHWA HEC-22) |
| PV-SS12 | measures one owner can take | a rain garden, a permeable strip, bare soil and a held roof take the volume their size says; four measures FloodSim cannot represent are listed as Unsupported |

Kyle's nine cases are all here; none was dropped. PV-SS9 revision 2, PV-SS11 and PV-SS12 follow his direction of the
same afternoon, relayed by the product session: keep the detail (1 m is the baseline), surface only is what most
reports will use, and what-ifs at the scale of one owner. Merged: case 3's free-outfall run doubles as case 4's comparison,
and case 8's pipe runs are case 3's network runs. What the existing suite already covers and is not repeated:
manhole-to-street surcharge with exact answers (`../../gatec/coupled/`, 22 of 22), and full-pipe friction (PV-P1).

## Layout

| Path | What |
|---|---|
| `../spec/PV-SS*.json` | the specs: every case, every parameter, the criteria (hashed) |
| `../references/street.mjs` | the hand answers; no import from `src/`; a second route for each in `../references/refs.test.mjs` |
| `terrain.mjs` | the made-up ground, shared by the model and the hand calculation; no import from `src/` |
| `cases.mjs` | a case built with the app's own pieces: coarsening, roof routing, subgrid tables, the synthetic network, the `.inp` writer, the design storm, the allowance |
| `harness.mjs` | the run loop, the same for both executors; the production Coupler and SWMM for coupled cases |
| `exec-cpu.mjs` | node executor: the CPU surface solver behind the GPU solver's interface |
| `run.html`, `run-browser.mjs` | browser executor: the production GPU solver in headless Chrome or Edge |
| `raw/<stamp>/` | raw measurements, one file per case and executor, read-only, never overwritten |
| `score.mjs` | the scorer `../run.mjs` loads; `report.mjs` writes `RESULTS.md` |
| `diagnostics/` | unscored runs that explain a result; output in `diagnostics/out/` |
| `lab/` | the laboratory data: `fetch.mjs` (downloads to `lab/data/`, git-ignored, MD5 checked), `reduce.py`, `rubinato2017-steady.json` |

## Registration, and what changed after it

- **Registered 17 Nov 2026, 13:11 EST,** commit `56698a8`, before any case ran on any solver: nine specs with their
  criteria hashes, the references, the scorer and the run code. Hashes of those files:
  `../spec/REGISTRATION-2026-11-17.sha256` (of the files with LF line ends).
- Before registration the cases were built, never run. Two setup slips were fixed then: the driveway scene's size, and
  the made-up streets needing shared vertices for the app's network builder. The rear yard's storm was set to 40 mm so
  that a yard holding its own rain stands above the 10 cm threshold; this is in the spec's notes.
- **After registration:**
  - **PV-SS3, definition revision** (in the spec): a probe on the grate's own cell was added for cases a–c. The
    registered output for case c is the depth at the grate; the first setup recorded only the mean over the sag, which
    had been seen (0.044 m) when this was fixed. Case c was run again; the first raw file is kept. Criteria unchanged.
  - **`harness.mjs`:** the stop tolerance of the run loop went from 1e-9 s to 1e-4 s, for the GPU's fp32 clock. No
    effect on CPU results (every stop is a whole second).
  - **PV-SS10 was added and registered later the same day** (commit before its run). It is **not blind**: the
    spreadsheets' means and the paper's coefficient had been read, and a hand estimate made, before its criteria were
    fixed. Its spec says so.
  - **`terrain.mjs`** gained one scene (`gutterStreet`) for the gutter diagnostic. No registered case uses it and the
    registered scenes are unchanged.
  - **PV-SS9 revision 2, PV-SS11 and PV-SS12** were registered at 14:06 EST (commit `f7a8d63`), before any of their
    cases ran. PV-SS9 gained two criteria for its detail cases; its three earlier criteria and its bowl results are
    unchanged. PV-SS11 is not blind for its pipe treatment (its spec says what had been seen).
  - **PV-SS9, two definition revisions to the hollow cases** (in the spec). First the lot's foot was closed and its
    pond drowned the hollow: my setup error. Then the hand answer turned out to be arguable (the cells beside the
    hollow shed water into it), so the hollow was moved to the low point of a bermed yard where its catchment is
    exact. Both earlier sets of raw files are kept; their rows are in `results/2026-11-17T19-13-18-241Z` and
    `…T19-14-04-695Z`. Criteria unchanged.
  - **Two stray raw folders** (`raw/2026-11-17T19-06-39-084Z`, `…-190Z`) are from a launch with a shell slip that cut
    some runs short. The complete runs of the same cases are in `raw/2026-11-17T19-07-cpu`, which the scorer uses.
- No criterion was changed after a run.
- The grade line of PV-SS3 follows HEC-22 §7.5 for friction (from the outlet upstream, Manning full flow) but starts
  from the pipe's own depth at the outlet, as SWMM's normal-depth outfall does, not from HEC-22's (d_c + D) / 2, and has
  no junction losses.

## Executors

- **cpu:** `src/solver-cpu.js` (fp64), the implementation the GPU kernels are verified against. The inlet exchange is
  this folder's copy of the GPU kernel's rule (the held rate over the step, never more water than the cell holds).
  The subgrid modes have no CPU implementation.
- **gpu:** `src/solver-gpu.js` in the browser, the production path.

Rows are kept apart by executor and never merged.

## Diagnostics (unscored)

| Script | Question | Answer |
|---|---|---|
| `slot-capacity.mjs` | Does SWMM's SLOT method carry more than Manning in a surcharged pipe? | Yes: × 1.01 to × 1.13 by diameter and surcharge; EXTRAN × 1.0002 |
| `one-pipe.mjs` | Why do the one-pipe cases read low and wobble? | The exchange rate flips sign most intervals at 2 s; at 0.5 s (SWMM ≤ 0.25 s) the pond matches Manning with SLOT's extra conveyance. EXTRAN with two-way exchange is unusable |
| `edge-pond.mjs` | Was PV-SS5 down-small's pass an accident? | Yes: 0.105 / 0.209 / 0.340 m for 40 / 80 / 160 mm against a true 0.160 / 0.200 / 0.200 m |
| `allowance.mjs` | Why do the allowance rows stand above their bound? | The allowance is spread over open cells only and taken only from wet street cells: 73–85 % of its nominal rate |
| `on-grade.mjs` | How much does a default grate take on a plane with no kerb? (not a registered case) | 61–76 % of the water crossing its cell, 1.0–1.3 × what flows over a 0.6 m grate |
| `gutter.mjs` | And in a kerbed gutter on a grade, against FHWA HEC-22? (not a registered case) | 26–40 % of the flow reaching it, where HEC-22 gives 69–92 %. The gutter's depth matches HEC-22 within 1.1 mm |

The first version of `one-pipe.mjs` set the exchange interval below SWMM's routing step. The coupler then drops
exchanges, so that output was discarded and the script says so.

## Laboratory level

Four candidates were opened (17 Nov 2026):

| Candidate | What it is | Used? |
|---|---|---|
| Zenodo 7941067, A Coruña street rig (Sañudo et al. 2023, CC BY 4.0) | 100 m² street junction, rain, inlets, sewer; DEM, SWMM geometry and a test database included | No: its inlets were never at capacity, so it tests rain-to-outfall, not the exchange. The best next rig for an end-to-end case |
| Zenodo 1464864 (CC BY 4.0) | not a dataset: the accepted manuscript of Rubinato et al. 2018 (ten grates, 80 steady tests) | Its Tables 1 and 3 are reported in PV-SS10; its raw series are a publisher supplement, not in the record |
| Zenodo 4596731 (CC BY 4.0) | one velocity field over a closed manhole | No: no exchange |
| SWASHES (Delestre et al. 2013, CeCILL-V2) | analytic shallow-water solutions; its rain cases are steady 1D channel flows with rain | No: PV-SS1 already has a rain case with a closed form; none of its wet/dry cases has rain |
| **Zenodo 1434156**, found while checking (Rubinato et al. 2017, CC BY 4.0) | the Sheffield rig with an open inlet: 15 steady surface-to-sewer tests, 21 more with a surcharged sewer, raw series | **Yes: PV-SS10** |

I opened each Zenodo record (title, licence, file list) and the two Sheffield papers. What the A Coruña paper and the SWASHES
paper say beyond their records is from a research pass that read them the same day; I did not re-read those two.

PV-SS10 is at the level of the exchange law, at the measured depth. The rig's surface flow could not be set up as a 2D
case from the paper: the flume's outlet weir setting is not published.

## Not covered

- **A grate in a gutter on a grade** as a registered case (FHWA HEC-22 §4.4.4.1). `gutter.mjs` and `on-grade.mjs` are
  first looks, unscored. This is the main missing case: Tract 353.02's sewer share is set by it (F21).
- **Kerbs, crowns and gutters** in any case: every street here is a plane or a bowl.
- **EA Tests 8A and 8B:** the inputs are still not public (`../../ea/TEST8.md`).
- **The laboratory's unsteady tests and its sewer-to-surface tests** (S3, S4): in a coupled run the manhole head is a
  result, so they need the rig's surface, which the paper does not fix.
- **The product's own copy of the wall rule** (`Climate Inspection/tools/gate2/wall.py`): not tested here.
- **The subgrid modes on the detail cases:** whether a 4 m or 8 m subgrid run keeps a kerb, a crown and a hollow is the
  open question of F22. GPU only.
- **A true answer for a whole network.** PV-SS11's pipe rows are single streets.
- **Green-Ampt infiltration, roofs to the sewer, real DEMs, real storms.**
