# Street sandbox: handoff (18 Nov 2026)

For the next agent working on FloodSim's urban hydraulics. Written by the session that built the sandbox. The order of
the work below is my recommendation; the decisions marked as Kyle's are his.

## Where things stand

- **Everything is in `main`** (`faf45a9`). Pull requests 9, 10, 11 and 12 are merged. Nothing is waiting to be merged.
- `main` holds the sandbox (13 test families, 108 cases, each with its answer fixed before it ran), three fixes to
  FloodSim made from its findings, and the results on both solvers (CPU and the production GPU path).
- **Climate Home Inspection does not use this code yet.** It pins the main checkout at `C:\Users\kylew\FloodSim` to
  commit `1948126`, which is before the sandbox and the fixes. Moving that pin is task 1 below.
- Nothing here is called validated. The sandbox did not have the three reviews that `../milestone2/` sets for PVM2.

## What we are working towards

Kyle's direction of 17 Nov 2026, in his words where quoted:

1. **Keep the detail.** "we need to make sure that we're maintaining the streets, the curbs, the small hollows." 1 m
   is the baseline grid. A coarser run is acceptable only if a kerb, a crown and a small hollow survive it (PV-SS9).
2. **No drain data means a surface model, said openly.** "If the sewer and drainage data is not available, then we
   just do a surface model, and we tell them that." Most reports will be surface only, so its error has to be known
   and stated (PV-SS11).
3. **What-ifs an owner can act on.** "a French drain, green infrastructure, rain gardens, removing impervious
   surfaces, rain barrels." Each one FloodSim offers needs a case with a known answer; what it cannot represent is
   listed as unsupported, not approximated (PV-SS12).

The aim behind all three: a home buyer's flood report whose depths can be defended, with each limit stated in the
report rather than found later.

## Read first

1. [REPORT.md](REPORT.md): each case with expected and measured, the findings in order, eight recommendations.
2. [FIXES.md](FIXES.md): the three fixes, before and after, and the risks left in the first one.
3. `../../FINDINGS.md`, F12 to F25: evidence, likely cause and proposed fix for each finding.
4. [README.md](README.md): layout, how to run, what changed after registration, what is not covered.

## What is right and what is not

| Part | Verdict | Finding |
|---|---|---|
| Surface flow at 1 m: rain on a street, hollows, gutters, still water | Right, on CPU and GPU | – |
| Storage measures: rain garden, permeable strip, bare soil, held roof | Exact | F24 |
| SWMM heads along a network | Match a hand grade line to 1 cm | F16 |
| Two-way exchange between street and sewer | Fixed 17 Nov (was unstable) | F14 |
| Wall-exposure rule at cell sizes other than 1 m | Fixed 17 Nov | F20 |
| A surcharged pipe | Carries too much: pond 0.150 m against 0.199 m | F14 |
| A grate in a gutter on a grade | Takes 26–40 % where HEC-22 gives 69–91 % | F21 |
| Grate weir coefficient | 0.5 against 0.32 measured in the Sheffield rig | F15 |
| The synthetic "10-yr" network | Carries 1.75 times its design flows | F16 |
| Surface only at a low point a drain serves | A ceiling, not an estimate: 0.42–0.66 m against 3–20 cm | F23 |
| A drainage allowance | Wrong both ways | F17, F23 |
| The model box | Cut across a slope reads 38 %; its edge holds a pond | F13 |
| Plain 2 m and 4 m grids | Close 1 m gaps, lose the crown and small hollows | F12, F22 |
| Subgrid modes (4 m, 8 m) | Keep kerb and crown; read hollows and dips shallow | F22 |
| Rain barrel, French drain, removing paving, one house's green roof | No control exists | F24 |

## What needs to be done, in my order

**1. Run the fixed code the way production runs it, before the product's pin moves.**
The fixes were measured on made-up cases and on the three Gate C coupled cases. They have not been run on a real
network, and the app's own run path (its fallback to SLOT, the node area it passes to the coupler) has not been run
in a browser. Do: one Charlotte Edwards Branch run and one Forest Hills run (`../../validation/`) on `main`, compared
with the same case at the pinned commit; one headless run through `tools/batch.mjs`. Done when the differences are
written down and explained. Whether the pin then moves is Kyle's decision. The Charlotte pipe data stays out of git,
as the repo already handles it.

**2. Make a surface-only result say what it is (F23).**
The finding is settled; the output is not built. At a street low point the report should give a ceiling, and for a
hollow with no way out it can give a depth. That needs FloodSim to tell the two apart: for each pond, its rim level
and whether water can leave over the ground. Register a case first (PV-SS2 and PV-SS11 have the scenes), then build
the output. The report's wording lives in the product repo.

**3. Draw the model box from the terrain, and flag ponds that touch the edge (F13).**
`src/watershed.js` exists. The measure is PV-SS5: the block cut across a slope must read 10.1 mm, and the pond at the
edge must not depend on where the box was cut. This probably explains the 23–35 % of rain leaving the tract's edge.

**4. Fix what a grate takes on a grade (F21), then settle the weir coefficient (F15).**
The exchange uses depth only. On a grade it needs the speed of the water at the grate (HEC-22 Eq. 4-16 to 4-20),
so the change reaches `src/kernels.wgsl.js` and `src/solver-gpu.js`. The measure is PV-SS13 (18 rows fail now; the
gutter depth rows must stay passed). PV-SS13 is not blind, so add a second gutter shape registered before it runs.
Only then touch the coefficient, against PV-SS10. The two findings point opposite ways; do not change one alone.

**5. The rest of F14: SLOT's extra conveyance and SWMM's continuity.**
SLOT adds 2–13 % conveyance in a surcharged pipe (`diagnostics/slot-capacity.mjs`); that is the whole of the
remaining 0.150 against 0.199 m. EXTRAN is not a way out (it fails with two-way exchange and is now refused). The
options are a narrower slot (a SWMM rebuild, `tools/build-swmm.mjs`) or stating the bias. SWMM's own continuity
error on surcharged nodes with return flow (17–19 % of a few cubic metres) is not explained yet.

**6. Controls for the owner's measures that have none (F24).**
A rain barrel or cistern on an existing house (cisterns exist only for buildings drawn in site design; their timing
is in `app/map.js`), a French drain, turning paving into soil, a green roof on one house. For each: write the hand
answer into PV-SS12 first, then build the control. A rain garden and permeable paving can be offered now.

**7. A coarse mode that keeps the detail, if speed is needed (F12, F22).**
Not needed while 1 m is the only grid a buyer reads. If area or speed forces it, the 4 m subgrid mode is the
candidate; it has to stop reading a 3 m hollow 3 cm shallow and a driveway dip 12 % shallow. PV-SS6 and PV-SS9 are
the measures. A plain 2 m or 4 m grid should not be offered for anything a buyer reads.

**8. Smaller items.**
- Stop calling the synthetic network a 10-yr sewer, or size it so that it is one (F16).
- Remove or document the spill-at-the-rim exchange (F18).
- GPU surface books reach 1.4e-5 to 1.9e-5 in three runs against a 1e-5 limit (F25): find the term or justify a limit.
- A true answer for a whole network. The A Coruña street rig (Zenodo 7941067, CC BY 4.0) is the best candidate.
- Look again at the South Street and tract 353.02 runs for F12, F13 and F21. They are in the product repo.
- An independent review of the sandbox itself, if any of it is to be cited outside the project.

## Decisions that are Kyle's

- Whether the product moves to the fixed FloodSim (after task 1).
- Dropping the allowance from the product (REPORT.md recommendation 2). I recommend dropping it.
- The words a report uses where there is no pipe data.
- Whether to spend on the grate fix (task 4) before or after the box (task 3).
- How the synthetic network is described to a buyer.

## How to run

```
node tests/run-all.mjs                                          every CPU test suite (53 pass on main)
node benchmarks/physics/street/score.mjs --expect               every hand answer; reads no result
node benchmarks/physics/street/exec-cpu.mjs --spec PV-SS1       a spec's cases on the CPU solver → street/raw/<stamp>/
node benchmarks/physics/street/run-browser.mjs --spec PV-SS1    the same on the GPU solver, headless Chrome or Edge
node benchmarks/physics/run.mjs --only PV-SS1,PV-SS2            score the latest raw file of each case → ../results/<run-id>/
node benchmarks/physics/street/report.mjs                       RESULTS.md from the latest scored run of each spec
node benchmarks/physics/street/gatec-check.mjs                  the three Gate C coupled cases on this code (GPU)
```

All 108 cases on the GPU took about 45 minutes. The CPU rows take a few minutes per spec.

## Rules that are not obvious

- **Always use `--only`.** A bare `run.mjs` also runs PV-TF1, which is held.
- **Fix the answer and the pass rule before the run.** Criteria are hashed in the spec. A change of setup after
  registration goes in the spec's `definitionRevisions` with a date; a criterion is never changed after a run.
- **Results are never overwritten.** Raw files and results folders are read-only; a rerun gets a new stamp. Rows from
  the CPU and the GPU are kept apart.
- **A failure is a result.** Do not change `src/` to make a case pass. A fix is a separate, measured change with a
  before and an after, as in FIXES.md.
- **Never work in the main checkout** `C:\Users\kylew\FloodSim`. Use a worktree, a branch and a pull request; Kyle
  merges. One pull request at a time, based on `main`: stacked pull requests caused a wrong merge on 17 Nov.
- **Check the GPU is free** before a GPU run: production batches use the same card.
- No Charlotte pipe data, Environment Agency data or laboratory files in git (`lab/data/` is ignored; fetch with
  `node benchmarks/physics/street/lab/fetch.mjs`).
- Ask Kyle before a job over an hour or any paid spend. Write to him short and plain.

## Traps I fell into

- The coupler's exchange interval cannot go below SWMM's routing step: exchanges are dropped without a message.
- The coupler's `nodeArea` must be the minimum node area written into the `.inp`. A value more than about 1.7 times
  too large makes the exchange swing again.
- The subgrid modes run on the GPU only; they have no CPU rows.
- `src/` files have CRLF line ends: multi-line search and replace fails unless that is handled.
- In a shell here, backticks inside `node -e "…"` are run as commands. Write a script file instead.
- A made-up street needs shared vertices, and vertices off the scene's edge, for the app's network builder.
- A hand answer for a hollow needs an exact catchment: cells beside it shed water into it (PV-SS9's two revisions).
- PV-SS10, PV-SS13 and the pipe rows of PV-SS11 are not blind. Their specs say what had been seen.
