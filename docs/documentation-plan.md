# The FloodSim documentation set: outline and split plan

**Owner:** Release, QA & Documentation Engineer · **Version of this plan:** 1, 1 November 2026 · **Ticket:** SPA-97

This is the plan for splitting the README into the three documents a reviewer expects, and the outline of each one
with every section mapped to where its content will come from. **It is not the documentation.** No manual prose is
written here, and most of the content does not exist yet: the manuals are written by watching Phases 1–3 happen, not
reconstructed afterwards from a finished codebase. This document exists so that, as each phase produces something,
there is already a place for it and a known owner.

## Why three documents

`docs/` held one spec file (`specs/site-design-mode.md`), which left a 91 KB README — 1,040 lines, 962 of them
non-blank — serving as theory manual, user manual and release notes at once. Three things follow from that:

- A reviewer cannot find the limit that governs their use case. It is in a bullet list at the bottom of a file whose
  first half is a feature tour.
- The claim audit in the methodology report has no home in the repository. Three of its corrections had been sitting
  in the README unapplied (see the register in Appendix B).
- 44 CFR 65.6(a)(6)(ii) names "source codes and **user's manuals**" as a condition of model acceptance. There is no
  document that answers to that name.

The split is therefore by **question asked**, not by topic:

| Document | The question it answers | Audience | Owner |
| --- | --- | --- | --- |
| **Theory manual** | What does it solve, how, and under what assumptions? | A reviewing engineer checking the method | Release Engineer (editor); Solver Engineer and H&H Engineer (content) |
| **User manual** | How do I produce a defensible result with it? | The engineer or planner running it | Release Engineer |
| **Validation report** | How well does it do it, and where does it fail? | A reviewer deciding whether to accept a result | **Validation Lead** (contents); Release Engineer (shell and house style) |
| **README** (stays) | What is this, is it any good, and how do I start? | Someone who just found the repository | Release Engineer |

Three documents plus a changelog, and the README shrinks to an entry point that links to all four.

## House style

The same template for all three, taken from the methodology report, which already works this way:

1. **Every number carries its provenance.** A number in a manual says where it was measured, on what, and when; or
   it cites the file that holds it. A number with no provenance is removed, not softened.
2. **Limits before results.** Each document states what it does not support before what it does. The methodology
   report's §5 ("Weaknesses in the evidence, stated before the results") is the model.
3. **Misses get equal weight.** A failed check is reported at the same size as a passed one. No aggregate score
   stands in for the measures behind it.
4. **The claim audit governs the wording.** Methodology report §11 fixes the phrasing for the claims that have been
   tested ("88 of 94", "inside the envelope", "validated", "mass-conserving", "agrees with HEC-RAS", "handles storm
   sewers"). No document in the set may describe those results in other words.
5. **Every basis is labelled.** Outputs and features are marked validated / benchmarked / screening / unvalidated,
   the same vocabulary the app already puts on its tiers.
6. **Version and commit on every artefact.** Each document carries the FloodSim version it describes; every figure
   and table says which run produced it, by version, commit and forcing fingerprint.
7. **Markdown in the repository, under `docs/`.** One file per chapter once a chapter exceeds roughly 500 lines.
   Equations in LaTeX-style fenced blocks. No binary document formats in the source tree.
8. **Cross-reference, do not duplicate.** A fact lives in exactly one of the four documents and is linked from the
   others. Duplication is how the README went stale.

### Source legend used in the outlines

| Tag | Meaning |
| --- | --- |
| **R** | Exists in the README now — move it, with the named section as its source |
| **M** | Exists in the methodology and validation report (draft 0.1, 29 October 2026) — named section |
| **C** | Exists elsewhere in the repository (code comments, a spec, a benchmark README) — named file |
| **N** | Does not exist yet, with the owner who will produce it |

---

## 1. Theory manual

**Spine: the methodology report.** §§3, 4, 5 and 10 of that report are already a theory manual with a different cover
on it, and they are better written than the README's equivalent sections because they state their evidence. The work
is not to rewrite them but to add the physics the report deliberately left out of scope — it covered the solver core
and the EA suite, not the eleven other physics modules.

| # | Chapter | Source |
| --- | --- | --- |
| 1 | Purpose, scope, and what this document is not | **N** — Release Engineer |
| 2 | How to read the evidence in this document | **M** §2 |
| 3 | Governing equations | |
| 3.1 | 2D shallow water equations solved, with the terms dropped and why | **M** §3.1 |
| 3.2 | Boundary conditions: wall, open/transmissive, outflow, stage | **M** §3.2; **R** "Boundaries" |
| 3.3 | Source terms: rainfall, roof routing, infiltration, exchange | **R** Numerics list; **C** `src/kernels.wgsl.js` source kernel |
| 3.4 | 1D coupling to EPA SWMM: the exchange law, the 2 s pace, two-way flow | **M** §3.3; **R** "Coupling design", "Two-way inlet exchange" |
| 4 | Numerical scheme | |
| 4.1 | Finite volume, MUSCL reconstruction, limiters, first-order fallback | **M** §4.1; **R** Numerics list |
| 4.2 | Hydrostatic reconstruction and well-balancing | **M** §4.1; **R** Numerics list |
| 4.3 | HLLC Riemann solver, dry-bed wave speeds | **M** §4.1 |
| 4.4 | Time stepping, CFL, the draining-time flux limiter, positivity | **M** §4.1; **R** Numerics list |
| 4.5 | Friction: semi-implicit point-wise Manning | **R** Numerics list |
| 4.6 | Mass accounting: Kahan residuals, per-edge booking, what the error is relative to | **R** Numerics list; **M** §8 |
| 4.7 | GPU implementation: kernel order, active tiles, bit-identity with the full grid | **R** "Active tiles", GPU layout paragraph |
| 4.8 | Two implementations, one scheme: the fp64 CPU reference and how parity is held | **M** §4.2, §4.3 |
| 4.9 | Subgrid speed mode: storage and conveyance tables, what it cannot recover | **R** "Subgrid speed mode"; **M** §4.4 |
| 5 | Hydrology and surface processes | |
| 5.1 | Design storms: DDF, alternating block, why nested storms are peaky | **R** "Design storms" |
| 5.2 | Historic storms and rainfall replay | **R** "Historic storms" |
| 5.3 | Infiltration: Green-Ampt from SSURGO, wetness, water table, saturation excess | **R** "Infiltration: Green-Ampt…" |
| 5.4 | Terrain: DEM, buildings as walls, street burning, roughness and impervious tables | **R** Phase 1 layer table |
| 5.5 | Watersheds: priority flood, D8, the contributing-area trace | **R** "Watershed: upstream water"; **C** `src/watershed.js` header |
| 5.6 | River inflow: LP3 hydrographs, gauge transfer, the drainage-area exponent | **R** "Upstream river inflow…" |
| 5.7 | Starting water levels, tide and surge as a boundary level | **R** "Starting water levels" |
| 5.8 | Channel bathymetry: regional bankfull curves and what they are not | **R** "Channel bathymetry (estimated)" |
| 6 | Drainage and structures | |
| 6.1 | Network tiers 1/2/3 and what each labels | **R** "Drainage" |
| 6.2 | Inlet hydraulics, gutter spread, clogging | **R** "Drainage"; **C** `src/drainage.js` |
| 6.3 | Rivers in SWMM, weirs, culverts, breaching | **R** "Rivers", "Culverts and channel conditioning" |
| 6.4 | Storage, outlet structures, modified Puls level-pool routing | **R** "Storage"; **C** `src/stormwater.js` |
| 6.5 | Green infrastructure and underdrains | **R** "Green infrastructure" |
| 6.6 | Flood barriers: crest faces, overtopping, load | **R** "Flood barriers" |
| 7 | Derived products | |
| 7.1 | Hazard classifications: ARR 2019 H1–H6, FD2320, the velocity cut-off | **R** "Hazard and intensity" |
| 7.2 | Force per width, depth × velocity, duration, arrival | **R** "Hazard and intensity" |
| 7.3 | Scour potential and bed shear | **R** "Scour potential" |
| 8 | Screening physics, and why it is screening | |
| 8.1 | Sediment transport and bed change; armouring | **R** "Sediment transport and bed change" |
| 8.2 | Debris flows: the quadratic rheology, slope failure | **R** "Debris flows" |
| 8.3 | Bank collapse probability | **R** "Bank collapse probability" |
| 8.4 | Collapsible and expansive soils | **R** "Collapsible and expansive soils (screening)" |
| 8.5 | The per-project emulator: what a Gaussian process over PCA fields can and cannot answer | **R** "Per-project emulator" |
| 9 | Site design and the comparison method | |
| 9.1 | The grading engine, pads, daylighting, cut and fill | **R** "Site design"; **C** `docs/specs/site-design-mode.md` |
| 9.2 | The forcing fingerprint: what makes two runs comparable | **R** "Comparing runs"; **C** `src/compare.js` |
| 9.3 | Window reruns and the edge check | **R** "Window reruns" |
| 10 | Verification against analytical solutions and the CPU reference | **M** §4.3; **R** "Verification (all pass)" table |
| 11 | Assumptions, in one list | **N** — Release Engineer, assembled from the chapters above; reviewed by H&H Engineer |
| 12 | Limits: what FloodSim should not be used for | **M** §10 (17 numbered limits), extended as Phase 1 closes limits #1 and #5 |
| 13 | Claims this document supports, and does not | **M** §11 |
| A | Notation and units | **N** — Release Engineer |
| B | Parameter tables and where every constant came from | **N** — Solver Engineer and H&H Engineer; partly in `src/terrain.js`, `src/soil.js`, `src/scour.js` |
| C | References | **M** throughout; **R** scattered citations |

**Known gaps in the spine.** The methodology report covers the solver core and the EA suite. Chapters 5–9 above are
mostly README-sourced and have no equivalent evidence section; they must be labelled screening or unvalidated per
house rule 5 until Phase 1 says otherwise. Chapter 11 (assumptions) does not exist anywhere today and is the single
largest piece of genuinely new writing in this document.

---

## 2. User manual

The user manual is the document 44 CFR 65.6(a)(6)(ii) names, and the one Phase 4's exit criterion tests: a named
external engineer, who has never seen the code, installs FloodSim, completes a worked example, produces a submittal
package, and finds the limit statement that governs their use case — without asking anyone at SPARC.

It is also the document that cannot be written from the codebase. Every settings chapter below can be drafted from
the README and the UI; the workflow, worked-example and troubleshooting chapters cannot, because they describe
decisions that only appear when someone is trying to get an answer out of it.

| # | Chapter | Source |
| --- | --- | --- |
| 1 | Install and run | |
| 1.1 | What you need: a WebGPU browser, a GPU, disk for the cache | **R** opening block, "Caching" |
| 1.2 | Starting it: `npm start`, `Start FloodSim.cmd`, where projects live | **R** "Projects"; **C** `server/server.mjs` header |
| 1.3 | Offline and restricted networks: the proxy allowlist, what is cached | **R** "Caching" |
| 1.4 | The version you are running, and citing it | **C** `CHANGELOG.md`, `GET /api/version` |
| 2 | The workflow, end to end | |
| 2.1 | Area → Build → Storm → Run → View → Export, with what each step commits you to | **R** Phase 1 "Flow" line (one line today) + **N** — Release Engineer |
| 2.2 | Choosing an area: boxes, polygons, and the catchment question | **R** "Polygon areas", "Watershed: upstream water" |
| 2.3 | Choosing a resolution: 1 m vs the subgrid modes, and what it costs | **R** "Resolution and downscaling", "Subgrid speed mode" |
| 2.4 | Reading the build log: what the app is telling you it had to assume | **N** — Release Engineer (the log lines exist; no document reads them) |
| 2.5 | Projects, scenarios and saved runs: the folder layout | **R** "Projects"; **C** `app/projects.js` header |
| 3 | Every setting | |
| 3.1–3.n | One section per panel — Area, Storm, Drainage, Solver, Data & assumptions, View — each setting with its units, default, effect, and when changing it invalidates a comparison | **R** feature blocks (the 22 bold blocks under "Working in the app"); **C** `app/map.html` labels and notes |
| 3.x | The settings that change results and therefore the fingerprint | **C** `src/compare.js` `FORCING_PARTS` |
| 4 | Every output, and what it means | |
| 4.1 | The run folder, file by file | **C** the `files` block in each `summary.json` (already self-documenting) |
| 4.2 | `summary.json` field by field, including version, commit and the fingerprint | **N** — Release Engineer |
| 4.3 | Grids: units, NODATA, row order, projection, which are per-step and which are sampled | **R** Phase 1 known limits; **C** `app/map.js` grid writers |
| 4.4 | The H&H report: what each plot and table is, and what it is not | **R** "H&H report" |
| 4.5 | Comparisons and the off-site impact test | **R** "Comparing runs" |
| 4.6 | Hazard classes and how to quote them | **R** "Hazard and intensity" |
| 4.7 | The mass balance: how to read it and what should worry you | **R** Numerics list; **M** §8 |
| 4.8 | Basis labels: validated / benchmarked / screening / unvalidated | **N** — Release Engineer, from house rule 5 |
| 5 | Worked examples (shipped with the app) | |
| 5.1 | A detention design, with its submittal package | **N** — H&H Engineer runs it; Release Engineer writes it. Phase 4 item 4 |
| 5.2 | A no-rise screening | **N** — as above |
| 5.3 | A road culvert | **N** — as above; depends on the bridge/culvert hydraulics in Phase 3 |
| 5.4 | A planning-scale screening | **N** — as above |
| 5.5 | Ellicott City, as the end-to-end tour | **R** scattered through the feature blocks as the demonstrated site; **N** for the narrative |
| 6 | Producing a defensible result | |
| 6.1 | The model archive: what a reproducible bundle contains | **N** — Release Engineer. Phase 4 item 3 |
| 6.2 | Calibration: observations, scoring, what a score does not license | **R** "Calibration" |
| 6.3 | Sensitivity runs and what to report | **N** — H&H Engineer |
| 6.4 | What to put in a submittal, per jurisdiction | **N** — H&H Engineer (SPA-95's design-criteria matrix) |
| 6.5 | The limits that govern your use case, indexed by use case | **M** §10, re-indexed by what a user is trying to do |
| 7 | Troubleshooting | |
| 7.1 | A source had no data here; what the fallback did | **R** "Anywhere in the US" |
| 7.2 | GPU limits, buffer limits, and the untiled fallback | **R** "Active tiles" |
| 7.3 | Mass error, instability, and what to change | **N** — Solver Engineer |
| 7.4 | Known problems in this version | **N** — Release Engineer, from the issue tracker and `CHANGELOG.md` |
| A | Glossary | **N** — Release Engineer |
| B | File formats | **R** "Export"; **C** `src/export.js` |
| C | Keyboard, API and automation surface | **C** `server/server.mjs` routes |

---

## 3. Validation report

**Contents: Validation Lead. Shell and house style: this role.** What follows is the shell, offered as a template to
be argued with, not a specification of findings. The section list follows the methodology report so that the two read
as one set, and so that the Phase 1 results land directly against the limits they are meant to close.

| # | Chapter | Source |
| --- | --- | --- |
| 1 | Summary, and the one-line answer per case | **N** — Validation Lead |
| 2 | How to read the evidence in this report | **M** §2, adapted |
| 3 | Pre-registration: the metrics and decision rules, recorded before the runs | **N** — Validation Lead. Non-negotiable: the house style treats a metric chosen after seeing results as no evidence |
| 4 | The case set and why each case was chosen | **C** the plan's Phase 1 case table (six events) |
| 5 | Weaknesses in this evidence, stated before the results | **N** — Validation Lead |
| 6 | Per case (×6): site, data, forcing, run provenance, metrics, figures, misses | **N** — Validation Lead |
| 7 | The misses, in full | **N** — Validation Lead |
| 8 | Benchmarks (carried forward): EA 2D suite, Tests 8A/8B when the data arrives | **M** §6, §7; **C** `benchmarks/ea/README.md` |
| 9 | Mass conservation across the campaign | **M** §8 |
| 10 | Cross-package comparison: HEC-RAS, and the Bellinge resolution of the Davis disagreement | **M** §9 |
| 11 | What has not been run | **M** §9, rewritten |
| 12 | Limits after this campaign: which of the methodology report's 17 are closed, narrowed, or unchanged | **M** §10 + **N** — Validation Lead |
| 13 | Claims this report supports, and does not | **M** §11 extended |
| 14 | Reproducing every number in this report | **N** — Validation Lead; depends on the hindcast harness and the model archive |
| A | All measures, per case | **N** — generated, as **M** Appendix A is |
| B | Evidence index: every file, run, version and commit behind every number | **N** — generated |

**What this role owes the Validation Lead, and when.** The shell above, now. The model-archive format, so each case
is a citable bundle rather than a folder (Phase 4 item 3, and the dependency the "reproducing every number" chapter
rests on). The generated-appendix tooling, modelled on the methodology report's `appendix-a.mjs`. And the house style
enforced in review — particularly rules 1, 3 and 4.

---

## 4. What the README keeps

The README becomes an entry point, not a manual. It keeps, and loses:

**Keeps:** what FloodSim is (3 lines) · install and start · Status, with the version and the claim-audit wording ·
a one-paragraph "what the physics is" · the links to the four documents · the repository layout · how to run the test
suites and the benchmarks · the licence and data-source attributions.

**Moves out:** the 22 feature blocks under "Working in the app" → user manual ch. 3 and theory manual chs. 5–9 ·
Numerics → theory manual ch. 4 · the Verification table → theory manual ch. 10 (the numbers stay generated from
`tests/results-*.json`) · Phase 1 and solver known limits → theory manual ch. 12, indexed by use case in user manual
§6.5 · the phase history → `CHANGELOG.md`.

**Target: under 150 lines.** The point is not brevity. It is that a claim can only go stale in one place, and that
place has an owner.

---

## 5. Sequencing

The documentation strand runs with Phase 1, not after it, for the reason the ticket gives: the manuals are written by
watching the other roles work. Concretely:

| When | What | Blocked by |
| --- | --- | --- |
| Now (done, SPA-97) | This plan; the version and changelog; the stale-claim sweep | — |
| Phase 0 close | Theory manual chs. 2–4, 10, 12, 13 — the methodology report re-cut under the shared template. The validation report shell handed to the Validation Lead | The methodology report's open items (its §12.1), which are not mine to answer |
| Phase 1, as cases run | Validation report filled in by the Validation Lead. Theory manual chs. 5–9 drafted as each module is touched, labelled by basis | Each module's owner |
| Phase 3, as settings change | User manual chs. 1–4: every setting and output. Written against the UI as it stabilises, not before | Phases 3a/3c/3e change settings and outputs |
| Phase 4 | User manual chs. 5–7: worked examples, defensible results, troubleshooting. The README cut to its entry-point form | The worked examples need the H&H Engineer to run them, and the model archive to bundle them |

**The dependency that matters most:** user manual ch. 5 (worked examples) and §6.1 (the model archive) are the two
things Phase 4's exit criterion actually tests, and both need work outside this strand. They should be scheduled as
engineering tickets with documentation attached, not as documentation tickets.

---

## Appendix A. What a reviewer is looking for, and where it will be

A cross-reference for the three questions agency reviews ask, since the split should be judged on whether it answers
them without a guided tour:

| The ask | Where it lands |
| --- | --- |
| 44 CFR 65.6(a)(6)(ii): source code and user's manuals | The repository, plus the user manual by that name |
| "What does it solve and how?" | Theory manual chs. 3–4 |
| "How well does it do it?" | Validation report; theory manual ch. 10 for verification as distinct from validation |
| "What may I not use it for?" | Theory manual ch. 12, indexed by use case in user manual §6.5 |
| "Which version produced this result?" | `summary.json` → `version` and `commit`; `CHANGELOG.md` for what that version is |
| "Can you reproduce this run?" | Forcing fingerprint today; the model archive at Phase 4 |

## Appendix B. The stale-claim register

The sweep behind SPA-97. What was corrected is in `CHANGELOG.md` under 0.1.0. What follows is what was found and
**not** changed, with the reason — listed rather than guessed at, as the ticket asks.

### Flagged, not changed: not a documentation fix

| Where | What | Why not here |
| --- | --- | --- |
| `benchmarks/ea/results/score.txt` | Stale: it predates Test 7, so it shows 70 of 72 measures while the README and the methodology report quote 88 of 94 across Tests 1–7. The scorer that writes it is being changed under SPA-91 | Regenerating it is the scorer owner's call, and the file is in SPA-91's working tree now. Methodology report §12.1 item 1 raises it too |
| `app/map.js` — the Data & assumptions source list | Shows `Rivers: hydro-flattened lidar, no bathymetry` unconditionally, including when estimated bathymetry is on and has carved a channel | Fixing it means making a UI label conditional — a code change in the app, not a documentation correction |
| `app/map.js:1916` (`drawFema`) | Observed while driving a fresh run for this ticket: adding the `fema-bfe-label` layer throws `use of "text-field" requires a style "glyphs" property`, so BFE labels do not render. The build continues and the run is unaffected | A real defect, but not documentation, and not this ticket's scope. Reported for triage |

### Flagged, verified as still accurate

Worth recording so the next sweep does not re-audit them: *no turbulence (eddy viscosity) term* (no closure anywhere
in `src/`; the debris-flow mode's O'Brien & Julien quadratic rheology is not one) · *inflow carries no momentum*
(`src/inflow.js` `InflowLinks` applies a volume rate over cells) · *uniform grid, porosity only in the subgrid mode* ·
*rain uniform over the domain, no areal reduction, no radar replay* (the Phase 3e work that changes this has not
landed) · *Atlas 14 temporal distributions not offered* (`src/storm.js` offers alternating block and uniform only) ·
*bank stability has no bathymetry, the toe is the lidar water surface* (`src/banks.js` is explicit, and the estimated
bathymetry does not feed it).

### Not swept

The feature blocks under "Working in the app" were read for claims about defaults and limits, not line by line
against their modules. Four hundred lines of feature description written alongside the code it describes is a
different exercise — it belongs with the user manual chapter that absorbs each block, where the claim and the code
get read together. Specifically **not** verified for this ticket: the per-feature numbers inside the site design,
comparison, report, emulator, sediment, debris, bank and calibration blocks; and the "Verification (all pass)" table,
whose 30-odd rows should be generated from `tests/results-cpu.json` and `tests/results-gpu.json` rather than
hand-maintained — which is theory manual ch. 10's job, and a standing source of exactly this kind of drift.
