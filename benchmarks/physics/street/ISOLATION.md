# Where the 155 failures come from, and the one fixed here (22 Nov 2026)

The physics verification run of 22 Nov 2026 (`benchmarks/physics/results/2026-11-22T17-45-25-193Z/`) gave 450 passed,
155 failed and 38 other. Every failure is in the street sandbox or in PV-U1. This page sorts them by cause, each
against its finding in `../../FINDINGS.md`, and says which are faults of the model a report uses and which score an
option the product does not use.

## The 155, by cause

| Cause | Rows | Spec | Finding | In the product? | State |
|---|---:|---|---|---|---|
| Surface only and the drainage allowance, scored against pipe answers | 50 | PV-SS11 | F23 | no: F23 drops them | by design: they show why pipes are needed |
| The drainage allowance against its own bound | 10 | PV-SS8 | F17 | no | by design |
| Coarse grids (2 m, 4 m, subgrid 4 and 8 m) | 22 | PV-SS6, PV-SS9 | F12, F22 | no: 1 m is the only grid a buyer reads | by design |
| The model box cut across a slope | 2 | PV-SS5 | F13 | yes | predicted before the run; open (HANDOFF step 3) |
| **A grate on a grade takes too little** | 18 (+2) | PV-SS13 (+ PV-SS11 hill, pipe) | F21 | yes | **fixed here under an option, see below** |
| The grate's weir coefficient on the Sheffield rig | 15 | PV-SS10 | F15 | yes | waits on F21 (they point opposite ways) |
| A pipe that limits: SLOT conveyance, SWMM continuity on return flow | 31 | PV-SS3, PV-SS4 | F14 | yes | open: SLOT explained, SWMM's 17–19 % not |
| SWMM's inertial damping on steep, fast channels | 4 | PV-U1 | F2 | yes, rarely (Fr > 0.7) | open: a SWMM option |
| GPU surface books 1.4e-5 against 1e-5 in one run | 1 | PV-SS2 | F25 | yes | fp32 round-off; reported |
| **Total** | **155** | | | | |

So 82 of the 155 score options the product does not use; they are kept because they are the evidence for that
choice. 73 are in what a report uses. Of those, 20 are F21, fixed below; 15 more (F15) can be settled now that F21 is.

## F21: the grate law that sees moving water

**Cause, isolated.** The exchange (`src/drainage.js` inletFlow) takes water on the depth in the grate's cell alone (a
weir, then an orifice). On a grade the gutter's water arrives moving and most of it runs over the cell before the
depth-only law takes it, so the grate took 26–40 % where FHWA HEC-22 gives 69–91 %. The gutter itself was right
(depth within 1.1 mm).

**Fix (default off).** `capture: 'hec22'` on an inlet's options turns on `grateCapture`: the solver now reports the
flow arriving at each inlet cell (GPU `approachAt` in `src/kernels.wgsl.js`, read by `readInlets` as `app`; CPU twin in
`exec-cpu.mjs`), and the coupler takes the larger of HEC-22's interception of that flow and the depth law. The frontal
cell is read as a gutter section with its bed's cross slope (HEC-22 Eq. 4-16's integral), the share inside the grate's
width is taken at Rf (Eq. 4-18), the rest and the side flow at Rs (Eq. 4-19). With the option off nothing changes: all
53 CPU suites pass, and the new buffer is only written, never read by the solver.

**Measured.** (A separate MDL search over the PV-SS13 errors, gridzip-lab PR 2, found they track grade, r = −0.996: the
depth-only law. The fixed rows show no grade trend left, only a constant 3 to 9 points low.)

 PV-SS14 was registered and pushed (commit 4bbba05) before any run: case a is the PV-SS13 street, case b
a second gutter shape nobody had run (3 % cross slope, 10 m half street, n 0.015, 0.5 to 3 % grades, 60 and 150 mm/h),
case c the same shape without the option.

| Case | Rows (cpu) | Grate share within 10 points of HEC-22 | Gutter depth |
|---|---:|---|---|
| a, PV-SS13 street, option on | 9 | 9 of 9 pass | 9 of 9 pass |
| b, new shape (blind), option on | 6 | 6 of 6 pass | 6 of 6 pass |
| c, new shape, option off (control) | 6 | 0 of 6 (28–39 %, as PV-SS13) | 6 of 6 pass |

With the option the grate takes 60–86 % against HEC-22's 69–94 %: every row passes, but every row is low, by 3 to 9
points (mean 7). The law still lets a little frontal flow past; the 10-point limit holds with little room. GPU rows (production WebGPU solver on SwiftShader, 9 of the 21 cases: 3 of a, all 6 of b): 18 of 18 rows pass and
agree with the CPU to three digits. Results: `benchmarks/physics/results/2026-11-22T18-58-58-079Z/`. `npm run test:gpu`
was not run; the kernel change only writes a new buffer.

An unscored diagnostic (`diagnostics/hill-capture.mjs`, not blind) runs PV-SS11's hill street with the option: the
kerb cell 40 m below the grate reads 17.8 mm against HEC-22's 16.8 mm (limit 5 mm), where the depth law reads 21.9 mm
and fails.

**Not exercised yet.** A sag, a ponded grate, the subgrid speed mode (approach flows are zero there, so the depth law
governs), and real streets. Turning it on by default is a product change: it moves every FloodSim study a report
reads, so CHI would move its pin with a decision line, and PV-SS10 (F15) should be rescored with it on first.

## Next, in order

1. Kyle decides whether `capture: 'hec22'` becomes the default; then rescore PV-SS10 with it on and settle F15.
2. F14's SWMM continuity on return flow (PV-SS4): isolate in a one-manhole SWMM case with no surface.
3. F13: draw the model box from the terrain (`src/watershed.js`, PV-SS5).
