# Stage A closure and the physics verification suite: audit and proposal (draft, 11 Nov 2026)

Status (updated 11 Nov 2026, evening): **the approved sequence is implemented, up to the end of milestone 1. It is
awaiting independent review, and nothing is committed.**
- **Stage A closure:** `benchmarks/culvert/README.md`, "Stage A closure".
- **The suite and milestone 1's results:** `benchmarks/physics/README.md` (run `2026-11-11T18-57-58-574Z`).
- **The instrumented build:** `benchmarks/culvert/instrumented/README.md`.

The text below is the proposal as reviewed. It is kept unchanged except for this note. Where the implementation
departs from it, the departure is recorded in those READMEs: a `channels/` family for PV-U1, a `selftest/` family for
PV-X1, and narratives in the spec JSON rather than separate `<ID>.md` files.

---

## Deliverable 1: Stage A audit and closure plan

### 1.1 Working tree

Branch `exp/start-reach`, head `a9a9fdc`. Everything below is uncommitted.

| Kind | Files |
|---|---|
| **Implementation** | `src/network-real.js` (+333 lines: canonical assets, `nativeSections`, culvert chains, `mergeBarrels`), `src/swmm-xsect.js` (new, the translation), `src/assets.js` (new, canonical records and structure evidence), `src/drainage.js`, `src/linked.js`, `src/infra.js`, `src/ingest.js` |
| **App** | `app/map.js`: imports `assets.js`, joins structure records to pipe ends as evidence and gives OSM culverts a canonical asset. **This is app wiring of the canonical-asset layer** (not of `nativeSections`, which stays off). I flag it because the standing rule was "no app wiring"; it predates this session's round 3 and should be reviewed with Stage A |
| **Tests** | `tests/run-xsect-tests.mjs`, `tests/run-assets-tests.mjs` (new), `tests/run-infra-tests.mjs` |
| **Benchmark only** | `benchmarks/culvert/` (all of it) |
| **Documentation** | `docs/specs/swmm-culvert-inputs.md`, `canonical-infrastructure.md`, `infrastructure-audit.md`, `docs/METHODS.md`, `benchmarks/culvert/README.md` |
| Other | `complaints.md` (working notes, not project content) |

### 1.2 Reproducibility (checked)

- `results/baseline-2026-11-11/` and `results/round1-2026-11-11/` verify against their `SHA256SUMS`.
- `results/MANIFEST.json`: all 25+ input hashes and every result, text and trace hash (11 benchmarks) match the files
  on disk.
- Two consecutive `run-all.mjs` runs gave identical hashes for every benchmark that re-ran. B8's result is
  byte-identical to before this session's harness change (`segL`).
- **Gap: rounds 2 and 3 have no immutable snapshot.** `results/` is overwritten by each run. Step 0 of the plan copies
  the current results, inputs and manifest to `results/round3-2026-11-11/` with `SHA256SUMS`, before any change.

### 1.3 T1, barrel consolidation

- **Edwards (decision: keep the real junctions).** The current `mergeBarrels` already keeps J373 (grate) and J121
  (lateral and grate), so the decision needs **no code change**. The falling and city-labelled directions are already
  separate scenarios in B9.
- **Gap: merged-record provenance is thinner than required.** Each record on a merged conduit keeps
  `{pipe, asset, L, invUp, invDn}`. It is missing:
  - the end structure or node ids;
  - the source line geometry;
  - the per-end invert provenance;
  - the merge decision (why each joint was merged).

  To add, with tests.
- **Conflict found: Charlotte's default topology uses the catch-basin elevations as Edwards' barrel floor.**
  - With `barrelRuns` off (the default, and the historical baseline), the network takes the records' interior ends at
    face value. The crossing becomes two branches from J121: J121 → J103, and J121 → J373 → O387.
  - The floor there is 207.51 / 207.14 m at the catch basins, against 205.50 / 205.13 m at the ends. That is the "two
    outfalls" topology already in the Charlotte notes.
  - Your rule separates catch-basin connection elevations from the barrel floor. Only the opt-in `barrelRuns`
    interpolates the floor.
  - **Changing the default would change the Charlotte baseline**, which is frozen. Proposal: leave it, document it as a
    known topology defect of the default path, and treat any change as a new, labelled experiment.
- **Future representation that keeps the junctions without artificial surcharge: research only.** B8-M shows the
  interior junctions of a coded chain surcharge above the crown while the flow should be part full. The mechanism
  inside SWMM (node continuity with `MIN_SURFAREA`, SLOT, the `isFull` switch) is what the instrumented build is for.
  Nothing is implemented until that is understood.

### 1.4 The invert-trust inconsistency

**What the code does** (`network-real.js` §2, lines 184–192, 219):
- Invert *units* are decided for the whole call by statistics. The layer must have at least max(3, 30 %) of its records
  with both inverts, and more than 60 % of those must give 0.2–15 m of cover under either metres or feet.
  Otherwise **no invert is used at all**; every pipe gets inverts derived from the lidar.
- Each end is then accepted only if its cover is 0.2–30 m.

**What is wrong:**
1. **The count is the gate.** One or two records with good inverts are discarded.
2. **All or nothing per call.** A single unit decision covers everything passed in, so mixed sources share it. Drawn
   and OSM assets already declare `invertUnits: 'm'` (`assets.js`), but they go through the same inference as a
   feet layer.
3. **The reasons are not recorded per end.** `prov` says `record` / `derived` / `carried` / `interpolated`, but not why
   an invert was rejected or why a layer's units were not decided.

**Proposed rule:**
- **Units:** declared units first, from the canonical asset's `invertUnits`, a layer-level override, or field-name
  evidence. Only `resolve` units are inferred, per source layer, from the records' own cover evidence, with no minimum
  count.
- **When units are ambiguous:** with one record, metres and feet are both tried. A unit is accepted only if exactly one
  gives plausible cover at both ends. If both or neither do, the layer is flagged **ambiguous** and its inverts are not
  used; the network does not guess.
- **Each end records a status and a reason:** `accepted` (units, cover), `rejected` (cover out of range, unit
  ambiguous, conflicting structure record), `interpolated`, `carried` or `estimated`.
- **Tests, as you listed:**
  - 1, 2 and ≥ 3 records with recorded inverts;
  - one or both end inverts missing;
  - mixed provenance (drawn in metres with a feet layer);
  - conflicting records (pipe layer against structure layer, using `joinStructures`' existing conflict rule);
  - estimated against recorded inverts.
- **Regression:** Charlotte's generated `.inp` must be unchanged (one large feet layer). I'll check that by hash
  before and after, on the cached records. All existing suites must pass.

### 1.5 T2, ellipse semantics

**Conflict with the current translation.** `swmm-xsect.js` 205–209 writes SWMM size code 9 for any concrete ellipse
within 0.5 in of an ASTM C507 size. It also does so **when no material is recorded**, assuming concrete. Your rules
forbid that silent substitution.

**Proposed translation change** (one change, its own tests):

| Source says | Written as | Flag |
|---|---|---|
| rise and span only (any material) | exact custom ellipse | none |
| ASTM C507 profile stated explicitly (an asset field `profile`, e.g. from a spec sheet or a typed attribute) | SWMM size code (SWMM's only representation of the published ASTM section) | **qualified**: SWMM's code-9 part-depth tables are internally inconsistent (review 3) |
| a nominal ASTM size by coincidence of dimensions, no profile stated | exact custom ellipse | **ambiguous profile**: true ellipse used; the ASTM section would have 3.6 % more area |

No hybrid section (ASTM full area with true-ellipse part depths) is built.

**Needs your confirmation:** is SWMM's size code acceptable as "the documented geometry" for an explicit ASTM pipe,
given T2? The alternative is to refuse or flag explicit ASTM pipes until a published part-depth profile is found.
- B1-4 tests code 9 deliberately. It stays as the explicit-ASTM case.
- Charlotte's stats show 3 custom sections. Whether any of its ellipses currently gets code 9 is to be checked, by hash.

**T2 benchmark fixes:**
- The custom row at Q 2.5 m³/s is above that section's full capacity (2.469 m³/s), so SWMM's NORMAL outfall takes
  the upper root and the flow is not uniform.
  - Mark it **invalid setup**, keep its raw values, and run the comparison at Q ≤ 2.4.
- Score A, P, R and Q against the critic's references (kept read-only as `critic3/`, to be copied into
  `benchmarks/culvert/results/`).
- The −2 to −5 % part-full continuity becomes its own finding, **T2-C**, beside B6-C.

### 1.6 B7-S diagnostic: a temporal window

**Reframing first.** The flag identifies a *regime*, not an error.
- Five of the 7 "false positives" are in the regime (both ends full, HDS-5 still under inlet control) with SWMM's
  error 2–18 cm, on the low side and inside the band. The other two are the mild pipe at TW = D (−3 cm).
- Proposal: report *regime* × *error* as a 2 × 2 table, so in-band states inside the regime count as "unsupported
  regime, error within band", not as flag failures.

**Window, fixed before looking at its effect:**
- A state is flagged persistent if the single-step flag holds in at least 50 % of the steps in a window W.
- W = max(60 s, 2 × the barrel's full-flow travel time L/V).
- Also reported, unscored, at W = single step, 30, 60 and 300 s, so the sensitivity is visible.
- Single-step results, uncoded controls and the raw classifications are all kept.

No routing change.

### 1.7 Emscripten isolation (checked; nothing installed)

| Check | Result |
|---|---|
| Tag | `emscripten-core/emsdk` tag **4.0.10 → commit `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`**, 2025-06-07, "Release 4.0.10 (#1565)" |
| Compiler revision | `emscripten-releases-tags.json` at the tag: 4.0.10 → `8103ffedfb0c42d231c6af6859a5a1a832260b43` |
| Downloads (Windows, from `emsdk_manifest.json`) | `storage.googleapis.com/webassembly/emscripten-releases-builds/win/8103ffed…/wasm-binaries.zip`, plus node 22.16.0 x64 and python 3.13.3 from the same bucket's `deps/` |
| Checksums | **emsdk verifies none.** We keep the archives (`EMSDK_KEEP_DOWNLOADS=1`) and record their SHA-256 in the build manifest |
| `.emscripten` | written inside the emsdk folder (`EM_CONFIG_PATH = EMSDK_PATH/.emscripten`, emsdk.py 1406) |
| Environment | `activate` writes the registry or user environment (SETX / HKCU / HKLM) **only with `--permanent` or `--system`** (emsdk.py 2386–2387). Without them, only the shell that sources `emsdk_env` is affected |
| Isolation from production | `tools/build-swmm.mjs` uses whatever `emcc` is on PATH. So the instrumented build runs in its own shell with `EM_CONFIG` set explicitly, writes only to `benchmarks/culvert/instrumented/`, and never touches `vendor/swmm-wasm` |
| A gap | **The production wasm's compiler version is not recorded.** So the instrumented build is first checked against production by running B1 on both and comparing results; any difference is reported before instrumented results are used |

Install command, for your go-ahead:
```
git clone https://github.com/emscripten-core/emsdk.git <tools>/emsdk-4.0.10
git -C <tools>/emsdk-4.0.10 checkout 62a853cd3b3134398ce85cde8bb5cbb2ef0194cb
EMSDK_KEEP_DOWNLOADS=1 <tools>/emsdk-4.0.10/emsdk install 4.0.10
<tools>/emsdk-4.0.10/emsdk activate 4.0.10      (no --permanent)
```

---

## Deliverable 2: the physics verification architecture

### 2.1 What exists and how it maps

| Existing | What it is | Category (your six) | In the suite |
|---|---|---|---|
| `benchmarks/culvert/` | SWMM alone against HDS-5; node; manifest of input and result hashes; immutable rounds | 2 solver benchmarks (+ some 3, 4) | **Kept in place**, registered as the `culverts` family. Moving it would break the immutable rounds' recorded paths |
| `benchmarks/culvert/hds5.mjs`, `b8`'s `backwaterAdverse` | independent HDS-5 and direct-step references | 1 references | Kept; the suite's reference index points to them |
| `src/analytic.js` | dam break (Ritter/Stoker), Thacker planar | 1 references | **Conflict:** a reference inside production source, imported by the app (`scenarios.js`). Re-derived independently under `references/`, cross-checked against it |
| `tests/gpu-suite.js` | analytic surface cases, rain-on-grid mass | 2, 4 | Registered; browser/GPU executor |
| `benchmarks/gatec/coupled/` | benchmark1d2d A12-010/011/012, exact answers; browser runner, node scorer | 5 integration (coupling) | Registered as the `coupling` family; its scorer pattern is reused |
| `benchmarks/gatec/mass-audit.js` | whole-app mass audit | 4 conservation (system) | Registered |
| `benchmarks/ea/` | EA Gate B: within the spread of other codes | inter-code comparison | Registered as a **separate category**: agreement with other codes is not an independent reference |
| `benchmarks/validation/` | real events (Charlotte, Queens, Manayunk) | 6 real-world | Unchanged; never used as a physics reference |
| `tests/` (`run-all.mjs`) | unit and regression tests | not verification | Unchanged |

**Runner support.** `culvert/run-all.mjs` already does what the suite needs in node:
- transitive input hashing;
- a result manifest;
- reuse of long runs;
- separation of diagnostic from scored.

It is generalised, not duplicated. The GPU surface solver runs only in a browser here (Dawn under Node crashes), so
the suite has two executors:
- **node** (SWMM, the CPU surface solver, references);
- **browser** (GPU), which writes result JSON for the same node scorer, as Gate C does.

### 2.2 Directory structure

```
benchmarks/physics/
  README.md              architecture, categories, how to run, status table
  spec/
    TEMPLATE.md          the benchmark specification template (below)
    <ID>.json            one machine-read definition per benchmark (criteria live here, versioned)
    <ID>.md              its narrative: equations, assumptions, limitations, sources
  references/            independent reference implementations, no import from src/ (enforced by a test)
    manning.mjs  gvf.mjs  pipe.mjs  weir.mjs  volume.mjs   (+ self-tests: refs.test.mjs)
  conservation/  pipes/  junctions/  culverts/ (→ ../culvert)  surface/  coupling/ (→ ../gatec/coupled)
  convergence/   integration/
  run.mjs                the runner (generalised from culvert/run-all.mjs)
  results/
    <run-id>/            immutable: results, MANIFEST.json, SHA256SUMS; never overwritten
```

### 2.3 Benchmark specification (`spec/TEMPLATE.md`, `<ID>.json`)

`id`, `title`, `category` (reference / solver / convergence / conservation / integration / validation), `process`,
then:
- the governing equations;
- initial and boundary conditions;
- geometry and materials;
- parameters with units;
- the solver configuration (routing, step, surcharge, grid);
- `reference`: module, function, published source, and its independent cross-check;
- `outputs`: the quantities scored;
- `criteria`: absolute and relative per output, conservation, steady-state;
- `resolution`;
- assumptions and limitations;
- `validRange`: the conditions it covers and nothing beyond;
- `criteriaRevisions`: dated, each with its justification; a change without an entry fails the run.

### 2.4 Result manifest

- **The run:** run id; timestamp; git commit, plus the SHA-256 of `git diff` when dirty; node version; SWMM version
  and wasm SHA-256; GPU adapter (browser runs).
- **Hashes:** every input file (transitive) and each spec and its criteria hash.
- **Per benchmark and per row:** reference value, simulated value, absolute error, relative error, threshold, status,
  mass-balance error, configuration.
- **Transient cases also:** peak error, timing error and integrated volume error.
- **Status counts by category:** never a single pass percentage.

### 2.5 Classification

| Status | Rule |
|---|---|
| Passed | inside every criterion, with an independent reference, in its valid range |
| Failed | outside a criterion |
| Qualified | passes only under a documented qualification (a bias carried, a wider band justified independently) |
| Unsupported | the case enters a regime the model is documented not to represent (e.g. B7-S); reported, not scored as a pass or a fail |
| Not independently validated | the reference is itself an approximation or composite with no independent basis (e.g. reverse flow) |
| Numerically unstable | non-convergence, oscillation beyond the steady criterion, or a step-dependent answer |
| Insufficient reference data | no defensible reference exists yet |
| Invalid setup (proposed addition) | the case does not test what it claims (e.g. T2 custom Q 2.5); kept with its reason |

### 2.6 How references are kept independent

- **Written from the equations and published sources**, in `references/`. They never import `src/`, and a test checks
  that.
- **Each reference is cross-checked by a second method**, for example:
  - Manning normal depth by bisection and by Newton;
  - GVF profiles by standard step and by direct step;
  - the friction factor by Colebrook iteration and by Swamee–Jain;
  - volume as an analytic integral and by quadrature.
- **Checked against published worked examples where they exist**, for example Chow (1959) and Henderson (1966) for GVF.
- **Self-tests run first;** a reference that fails its own checks stops the run.
- **An independent critic computes the values for any new family**, as in review 3.

### 2.7 Conflicts with the current Stage A work

1. **SWMM 5.2.4 exposes no conduit volume** (`swmm5.h`: there is no `LINK_VOLUME`). A closed-system mass benchmark
   needs it, so there are two choices:
   - reconstruct conduit volume from link depth and geometry, an approximation that would be labelled;
   - add a getter in the instrumented build.

   This also bears on B6-C and T2-C.
2. **The pipe friction law.** SWMM gravity conduits use Manning even when full; Darcy–Weisbach applies only to force
   mains. So benchmark D reports two things separately:
   - Manning, which checks the implementation;
   - Darcy–Weisbach with a stated n↔ε equivalence, which is the physics check and labelled model-form.
3. **The CPU surface solver is a second implementation of the GPU scheme.** Node benchmarks on it verify the scheme,
   not the production GPU path; GPU runs go through the browser executor.
4. **Charlotte's default topology** (1.3) conflicts with the Edwards rule and is frozen.
5. **The T2 semantics change** alters the Stage A translation (1.5): its own change, its own tests, and B1-4 redefined
   as the explicit-ASTM case.
6. **Invert trust** (1.4) can change networks built from small or mixed layers. It needs Charlotte's hash check.
7. **Benchmark criteria live in code today** (B1's band rule). In the suite they move to versioned spec files. The
   culvert benchmarks keep theirs until they are next revised.
8. **`app/map.js` structure-evidence wiring** (1.1) is uncommitted app wiring, for your review.

---

## Deliverable 3: the first milestone (proposed, not started)

All node and SWMM-based, with simple geometry and criteria set in the spec before the first run.

| ID | What | Reference | Criteria (proposed now) |
|---|---|---|---|
| **PV-C1 closed-system mass conservation** (first) | (a) two storage units joined by a conduit, unequal initial depths, no inflow or outflow, 6 h; (b) the same with a transient exchange (a gate opening); (c) the CPU surface solver: a closed basin with an initial mound, 1 h | volume constant: initial = final + Σ boundary fluxes (zero); storage from the node volume curves; conduit volume per 2.7 (1) | (a, b) \|ΔV\| ≤ 0.1 % of the initial volume, with SWMM's reported continuity alongside; (c) ≤ 1e-6 relative (fp64 CPU). The 0.1 % is tighter than Gate C's 0.5 % on purpose: a closed system has no throughput to hide error in |
| **PV-U1 uniform open-channel flow** | rectangular (RECT_OPEN) and trapezoidal channels, 2 slopes × 2 n × 3 Q; long reach, FREE outfall; depth read at interior junctions where the standard-step profile says the flow is within 1 mm of normal depth | Manning normal depth (bisection + Newton); the GVF standard step locates the uniform reach | depth max(2 mm, 0.5 %); velocity 0.5 %; steady ≤ 1 mm over 10 min; continuity ≤ 0.5 % |
| **PV-P1 pressurised pipe flow** | circular pipes of 3 diameters × 2 roughnesses, full under a held tailwater over the inlet crown, EXTRAN; and reversed (inflow at the low end) | Manning full-pipe friction (implementation); Darcy–Weisbach + Colebrook with ε from the stated n equivalence (physics, model-form) | Manning: head loss max(5 mm, 1 %); Darcy–Weisbach: reported, scored as "not independently validated" unless the equivalence is the configured law |

Deliverable 3 also builds `references/`:
- Manning normal depth;
- the standard-step GVF, including backwater and drawdown self-tests against a published example;
- Darcy–Weisbach with Colebrook and Swamee–Jain;
- weir and orifice exchange;
- volume accounting.

Weir and orifice are built now but used first in Stage 4 (N).

---

## Deliverable 4: research roadmap

| Stage | Families | Complete when |
|---|---|---|
| 1 Fundamentals | A conservation, B uniform flow, C GVF (backwater, drawdown), D pressurised pipe, E junctions (join, split, unequal D and inverts) | every case has an independent reference; all pass or carry a documented status; the time-step and segmentation convergence of each is shown |
| 2 Structures | F inlet control (circle, box, ellipse, arch), G outlet control (slopes, losses, tailwater, reverse where a reference exists), H transitions (inlet↔outlet, free↔pressurised, crown, steep), I sediment and blockage | the culvert benchmarks re-expressed as specs; B7-S and S8 listed as unsupported with the windowed flag; T2 settled |
| 3 Surface (2D) | J plane and inclined-surface flow, K rain on an idealised catchment, L wetting and drying, M discontinuities (step, jump, contraction) | GPU and CPU agree; grid and time-step convergence shown; mass to round-off; the analytic cases re-derived outside `src/` |
| 4 Coupling | N surface-to-pipe (weir and orifice), O pipe-to-surface surcharge, P a coupled network with a transient hydrograph | the exchange matches the independent weir/orifice references; combined books close; Gate C's A12 cases registered with this scoring |
| Numerical (throughout) | grid, step and solver-tolerance refinement; wet/dry stability; mass across step changes; domain-boundary sensitivity; network segmentation (T1 is the first case) | the direction of convergence and the observed error are reported for every family; "smaller is better" is shown, not assumed |
| System and real-world | Charlotte, Queens, Manayunk, as integration and validation | always last; never used to set physics; existing experiments untouched |

---

## Proposed sequence (small)

0. Snapshot round 3 to `benchmarks/culvert/results/round3-2026-11-11/` (immutable).
1. **Invert trust** (1.4): the rule, its tests, and Charlotte's hash check.
2. **Merged-record provenance** (1.3): its tests.
3. **T2 semantics** (1.5): after your confirmation of the ASTM row. Then the T2 benchmark fixes and T2-C.
4. **B7 windowed flag** (1.6): evaluation only.
5. **Emscripten install and instrumented build** (1.7): after your go-ahead.
6. **The physics suite skeleton** (2.2–2.5): README, template, `run.mjs`, `references/` with self-tests.
7. **PV-C1, then PV-U1, then PV-P1.**

Steps 1–4 are Stage A closure; 6–7 are milestone 1. Each step stays uncommitted until you review it.
