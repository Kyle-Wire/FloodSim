# Physics verification suite

Independent physics references, benchmark specifications with pre-registered criteria, and a runner that writes
immutable, hashed results. The architecture and its reasoning are in `docs/specs/physics-verification.md`.

```
node benchmarks/physics/references/refs.test.mjs   the reference self-tests alone
node benchmarks/physics/run.mjs                    every benchmark → results/<run-id>/ (new, read-only)
node benchmarks/physics/run.mjs --only PV-U1       one benchmark (and what it depends on)
node benchmarks/physics/run.mjs --hash             each spec's criteria hash, for a revision entry
```

## Layout

| Path | What |
|---|---|
| `references/` | Independent references: `geometry`, `manning`, `gvf`, `pipe`, `weir`, `volume`. They never import `src/` or anything outside `references/`; `refs.test.mjs` checks that, and cross-checks every reference by a second method. |
| `spec/` | One `<ID>.json` per benchmark, holding every field of `TEMPLATE.md`. The criteria live there, and are hashed. |
| `lib/score.mjs` | The row scorer, statuses, error types, the tally. |
| `lib/swmm-run.mjs` | The SWMM executor: hand-written `.inp`, the production engine, no FloodSim translation in the loop. |
| `conservation/` `channels/` `pipes/` `selftest/` | The milestone 1 benchmarks. |
| `results/<run-id>/` | Per run: `<ID>.json`, `SUMMARY.json`, `MANIFEST.json`, `SHA256SUMS`, all read-only. Never overwritten. |

**The run order:**
1. The reference self-tests. Any failure stops the run.
2. Spec validation:
   - every template field is present;
   - every parameter has a value and a unit;
   - the criteria's SHA-256 equals the latest `criteriaRevisions` entry.

   A criteria change without a dated revision stops the run.
3. The benchmarks, dependencies first.
4. The results and the manifest. The manifest records:
   - the git commit, plus the diff and status hashes (the tree is dirty);
   - the node version;
   - the SWMM version and the wasm SHA-256;
   - each spec's hash and criteria hash;
   - every input file, transitively.

**The exit code** is non-zero if a deliberate fault is not caught, or a status is unknown. A physics failure is a
result, not a runner error.

## Statuses and error types

Statuses are never merged into one percentage:
- Passed
- Failed
- Qualified
- Unsupported
- Not independently validated
- Numerically unstable
- Insufficient reference data
- Invalid setup

Every row has one error type:

| Error type | Meaning |
|---|---|
| **numerical** | the solver against an exact solution of the same equations |
| **physical-model** | the model's equations against physics they do not contain |
| **accounting** | the volume books and SWMM's continuity |

Deliberate-fault rows (PV-X1) are counted apart. A caught fault is a working scorer, not a passing model.

## Milestone 1: run `2026-11-11T18-57-58-574Z`

**Pre-registration.**
- The criteria were fixed and their hashes written into the specs at 13:54 local time, before any benchmark ran. The
  spec files' hashes at that moment are in `spec/REGISTRATION-2026-11-11.sha256`.
- Two harness corrections came after registration and before the scored run. Both are recorded in each spec's
  `definitionRevisions`, and neither changes a criterion or its hash:
  - **PV-C1:** SWMM would not open a network without an outfall (ERROR 145). A sealed outfall was added behind a weir
    crest at 4.5 m, above any reachable level, and its flow is a scored row that must be zero.
  - **PV-U1:** the velocity rows took the conduit below each scored junction. The fix takes conduits whose downstream
    end is beyond the drawdown, as the spec's outputs field said.

  A smoke run of one PV-U1 case had shown this case failing before the fix. The junction rule that makes it fail was
  not changed.

| Benchmark | Passed | Failed | Other | Notes |
|---|---|---|---|---|
| **PV-C1** closed-system mass | 18 | 0 | 1 Insufficient reference data, 1 Qualified | below |
| **PV-U1** uniform open-channel flow | 92 | **4** | — | below |
| **PV-P1** pressurised pipe | 36 | 0 | 12 Not independently validated | below |
| **PV-X1** deliberate faults | — | — | **4 / 4 caught** | n × 1.25: depth +17 %, velocity −15 %; a 3.6 m³ hidden inflow: closure +0.67 % against 0.1 % |

**By error type** (physics rows only):

| Error type | Passed | Failed | Other |
|---|---|---|---|
| numerical | 83 | 4 | 1 Qualified |
| accounting | 63 | 0 | 1 Insufficient reference data |
| physical-model | 0 | 0 | 12 Not independently validated |

### PV-C1: closed-system mass conservation

- **Pipe full throughout, and with a gate opening at 1 h (C1-a, C1-c).**
  - The books close to 2e-13 m³ in 510 m³ at every sample and at rest.
  - The equilibrium level, computed from the initial volume alone, is matched to 1e-15 m.
  - The sealing weir never flowed.
  - SWMM's node volumes equal A·d to 1e-16, and its continuity error is 0.000 %.
- **Part-full pipe (C1-b).**
  - At rest, the books close and the equilibrium level is exact.
  - **In motion, the closure is Insufficient reference data, as registered.** The end depths bracket the pipe's volume
    only to within 16 % of the system volume, against a 0.1 % criterion.
  - **The estimate is circular here, and is not evidence.** SWMM's link depth stayed exactly at the mean of the tank
    depths (0.2500 m) throughout. So L·A(link depth) is SWMM's own conduit book, and it reproduces the initial volume to
    1e-14 for that reason alone.
  - This is the limit of decision 2: with no conduit-volume getter, a part-full pipe's water in motion cannot be
    independently booked. The instrumented build's link-volume getter (step 7) would expose SWMM's book. That is
    still not an independent volume.
- **The CPU surface solver (C1-d), fp64:**
  - closure 8e-15 relative over 600 s, worst sample;
  - its own mass balance −2.7e-15, nothing clipped.
  - This checks the CPU implementation of the scheme, not the GPU path.

### PV-U1: uniform open-channel flow

- **20 of 24 cases pass every row.**
  - Depth within 4.0 mm against limits of max(2 mm, 0.5 %), velocity within 0.30 %.
  - Every case was steady: each scored depth's range over the last 600 s was at most 0.05 mm.
  - Continuity −0.05 to −0.09 %.
- **The 4 failures are the two steepest trapezoidal cases** (S 0.003, n 0.02, Q 3 and Q 6; Froude 0.73 and 0.76):
  - depth −12.1 and −12.6 mm;
  - velocity +1.7 and +1.4 %.
- **Why they fail.**
  - In both, the worst junction is the first one above the outfall that the registered rule scores. The GVF reference
    puts that junction within 1 mm of normal depth.
  - SWMM's drawdown from the FREE outfall reaches further upstream than the GVF profile's.

    | Q | x (m above the outfall) | SWMM against GVF |
    |---|---|---|
    | 3 | 100 | −11 mm |
    | 3 | 150 | −3.7 mm |
    | 3 | 200 | −1.3 mm |
    | 6 | 150 | −12 mm |
    | 6 | 200 | −5.6 mm |
    | 6 | 250 | −2.6 mm |

  - Upstream of that, SWMM is at normal depth to 0.1 mm.
  - So this is a **numerical finding about SWMM's outfall drawdown on 50 m conduits**, where the M2 profile is only
    100–130 m long. It is not a uniform-flow error, and not tuned away.
  - The junction rule stays as registered. Scoring the drawdown itself against GVF is a later family (C, GVF).
  - **Superseded by the closure pass (`../FINDINGS.md` F2).**
    - Refining the conduits only slowly shrinks the gap, toward a limit that is not zero.
    - With `INERTIAL_DAMPING NONE`, SWMM matches GVF within 1 mm.
    - The cause is SWMM's PARTIAL inertial damping near Froude 1: a physical-model difference, not discretisation.
    - The rows stay Failed, as registered.
- **The unscored SWMM-against-GVF profile** for every case is in `PV-U1.json` (`cases[].vsGVF`).

### PV-P1: pressurised pipe flow

- **Against Manning full-pipe friction, all 12 head losses pass**, forward and reversed. Worst 0.034 %.
- **Flow equals Q to 1e-15, with the right sign** (negative, uphill, when reversed). Continuity is 0.
- **Against Darcy–Weisbach + Colebrook**, with k_s from the Strickler equivalence, SWMM's Manning loss is +9.6 % to
  −16.5 % (+0.1 / +9.6 % for D 0.3 m; −9.5 / +6.9 % for 0.9 m; −16.5 / +2.5 % for 1.8 m).
  - This is the model-form difference of Manning's law under an assumed equivalence. It is **Not independently
    validated**, and carries no criterion.
  - SWMM uses Darcy–Weisbach only for force mains.

## Milestone 1 closure pass (11 Nov 2026, after review 4)

- Findings, evidence and next actions are in `../FINDINGS.md`: F1–F5 concern this suite.
- The diagnostics are in `diagnostics/` (unscored; output in `diagnostics/out/`):
  - `x1b-books.mjs`: the PV-X1-b books, term by term;
  - `c1b-linkvol.mjs`: the instrumented conduit volume against PV-C1-b;
  - `u1-refine.mjs` and `u1-options.mjs`: the PV-U1 profile, refinement and inertial terms.
- The registered run `results/2026-11-11T18-57-58-574Z/` is unchanged.

## What milestone 1 does not cover

- GVF profiles as their own scored family (C).
- Junctions (E).
- Structures, re-expressed from `../culvert` (F–I).
- The GPU surface path (browser executor).
- Coupling (N–P).
- Time-step and segmentation convergence (numerical, throughout).

These are the roadmap in `docs/specs/physics-verification.md` §4, not started.
