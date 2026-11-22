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

## Outcome (22 Nov 2026, 21:40 UTC): the rule is not met; the defaults go back to off/0.5

Every street case on the CPU was run again with the change set (`raw/fixes2-cpu/`, scored in
`benchmarks/physics/results/2026-11-22T21-37-17-739Z/`) and compared row by row with the 17:45 run.

| Before → after (CPU rows) | Rows | Which |
|---|---:|---|
| passed → passed | 146 | |
| failed → passed | 25 | PV-SS10 × 15 (calibration: 0.32 was fitted on them), PV-SS13 grate rows × 9, PV-SS11 hill pipe kerb cell |
| passed → failed | 2 | see below |

- **SS3-c, depth over the grate:** 0.0293 → 0.0395 m. A ponded grate whose hand answer was worked with Cw 0.5 (0.0293 ×
  1.35 = 0.0394, as predicted above). Allowed by (a).
- **SS3-x2, SWMM continuity:** −0.424 → −0.584 % against the 0.5 % limit. Not a ponded-grate row, so **(a) fails**.

(b) passes (9 of 9 PV-SS13 grate rows). (c) passes: `npm test` 53 of 53; Gate C sets its own coefficients and no
capture, so it is not moved.

**Which change moves SS3-x2.** An unscored diagnostic (`diagnostics/x2-split.mjs`, run after the result above was
seen) ran the case under the four combinations:

| Cw | capture | to the network (m³) | SWMM continuity |
|---|---|---:|---:|
| 0.5 | off | 496.6 | −0.424 % |
| 0.32 | off | 470.9 | **−0.584 %** |
| 0.5 | hec22 | 493.6 | −0.297 % |
| 0.32 | hec22 | 470.9 | **−0.584 %** |

The weir coefficient alone moves it past the limit; the grate capture alone moves it the other way. It is a SWMM
bookkeeping figure (no flooding, no return flow: the same 0.025 ML stored, about 26 m³ less taken in), so it says
nothing direct about the grate, but the rule was fixed before the run and is applied as written: **`Cw` goes back to
0.5 and `capture` back to off.** F15 stays open: the Sheffield excess is real, and the next step is to find why less
inflow to this network raises SWMM's routing error (with F14). Capture alone is registered as a new candidate in
`FIXES-3.md`; the diagnostic above was seen before that registration, so SS3-x2 is not evidence there.
