# Fixes, round 2: protocol (written 22 Nov 2026, before any run with these defaults)

Kyle asked (22 Nov 2026) for the models to be fixed from what testing found. Two FloodSim findings bear on what a
report reads, and they point opposite ways (HANDOFF step 4), so they change together and are measured together.

## The change set

1. **F21, default on.** `DESIGN_DEFAULTS.capture = 'hec22'` with `grateW 0.6`, `grateL 0.9` m (a 2 × 3 ft grate, as
   PV-SS13 assumes). Curb openings and slab inlets (`inlettypes.js` curb, ncdotCI, ncdotElong, ncdotSlab) keep the
   depth law: HEC-22's grate equations do not describe them.
2. **F15, Cw 0.5 → 0.32.** The weir law's shape (h^1.5) fits the Sheffield rig; its size is 1.55 times too large.
   0.32 is F15's own fit to the 15 tests (`PV-SS10` hand `fittedToTheTests`), and the code-length search of
   gridzip-lab physics/FINDINGS-2.md found that one factor beats every other formula. HEC-22's grate weir
   coefficient is 0.37 in the same units. `INLET_KINDS.typical` (the model's default kind) follows.

## What it is measured against, and what counts

PV-SS10 is the rig 0.32 was fitted on, so its rows passing after are **calibration, not evidence**, and are reported
as such. The evidence is everything else:

- **Every street sandbox case on the CPU** (PV-SS1 to PV-SS14), before (main at 4e2e3c4 settings, the 22 Nov run
  `results/2026-11-22T17-45-25-193Z/`) and after. Expected:
  - PV-SS13: the 9 grate rows pass (as PV-SS14 a did with the option); the gutter depth rows stay passed.
  - PV-SS11 hill, pipe: the kerb cell below the grate passes (diagnostic `hill-capture.mjs` read 17.8 mm against 16.8).
  - Ponded grates (PV-SS11 sags, PV-SS3 free outfall, PV-SS2, PV-SS4): a lower Cw holds water about
    0.64^(−2/3) = 1.35 times deeper over a grate that is the limit. Where a hand answer was worked with Cw 0.5, the
    row may now fail; it is reported as such and the answer is not reworked after seeing it.
  - Rows that score options the product does not use (surface only, allowance, coarse grids) are not affected.
- **`npm test`**: all 53 CPU suites pass, with tests that pin the old default (0.5) updated to read the default.
- **Gate C coupled cases** (`benchmarks/gatec/coupled`, 22 of 22 before) must stay passed.

**Adoption rule, fixed now.** The defaults are kept if (a) no row that passed before fails after, other than
ponded-grate rows whose hand answer assumed Cw 0.5, and each of those is listed; (b) the PV-SS13 grate rows pass;
(c) npm test and Gate C pass. Otherwise the defaults go back to off/0.5 and this page says why.

Nothing reaches a report until Climate Home Inspection moves its FloodSim pin with a decision line.
