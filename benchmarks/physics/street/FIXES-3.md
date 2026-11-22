# Fixes, round 3: grate capture alone (written 22 Nov 2026, before the run)

FIXES-2 turned on two changes together and failed its rule because of one of them (the weir coefficient 0.32; see
its Outcome). This page registers the other alone: **`DESIGN_DEFAULTS.capture = 'hec22'`** (F21), with `Cw` kept at
0.5, `grateW 0.6`, `grateL 0.9`. Curb openings and slab inlets keep the depth law, as in FIXES-2.

## What was seen before this was written

- The FIXES-2 run (both changes) and the 17:45 run (neither), every CPU street row.
- The SS3-x2 diagnostic in FIXES-2: with capture alone its SWMM continuity is −0.297 %. **SS3-x2 is therefore not
  evidence here**; it is reported, not counted.
- PV-SS14 a and b with the option on (ISOLATION.md): all pass. Their rows here are a repeat, not new evidence.

## Measured against

- Every street case on the CPU (`node benchmarks/physics/street/exec-cpu.mjs --stamp fixes3-cpu`), scored against
  the 17:45 run (`results/2026-11-22T17-45-25-193Z/`), row by row.
- `npm test`: all CPU suites.
- Gate C coupled cases: unaffected by construction (own coefficients, no capture); confirmed by grep, not rerun.

Expected: PV-SS13's 9 grate rows and the PV-SS11 hill pipe kerb cell pass; PV-SS10 stays failed (Cw 0.5, F15 open);
ponded grates are unchanged within round-off (a sag has no approach flow, so the depth law governs); PV-SS14 c (the
control) now has capture on and is expected to pass its grate rows, so it no longer serves as a control and is
reported as such.

## Adoption rule, fixed now

Capture becomes the default if (a) **no** row that passed in the 17:45 run fails, with no exceptions; (b) the 9
PV-SS13 grate rows pass; (c) `npm test` passes. Otherwise it goes back to off and this page says why. Nothing reaches
a report until Climate Home Inspection moves its FloodSim pin with a decision line.
