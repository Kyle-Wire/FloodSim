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

## Outcome (22 Nov 2026, 23:10 UTC): the rule is met; capture is the default

Every CPU street case was run at commit 1f74567 (`raw/fixes3-cpu/`, 119 cases), scored in
`benchmarks/physics/results/2026-11-22T23-09-22-725Z/` (with `raw/ss14-cpu/` moved aside during scoring so that
PV-SS14 is read from this run), and compared row by row with the 17:45 run.

| Before → after (CPU rows) | Rows | Which |
|---|---:|---|
| passed → passed | 148 | |
| failed → passed | 10 | the 9 PV-SS13 grate rows, the PV-SS11 hill pipe kerb cell (17.8 mm against 16.8) |
| passed → failed | **0** | |
| failed → failed | 69 | PV-SS10's 15 (F15, Cw 0.5 kept), and the by-design and open rows of ISOLATION.md |
| new rows (PV-SS14, not in the 17:45 run) | 42 | all pass, as expected; SS14-c now has capture on and matches SS14-b exactly, so it is no longer a control |

- (a) met: no row that passed fails. SS3-c (depth over a ponded grate) passes again, as it did before FIXES-2, so the
  sag is unchanged as expected. SS3-x2's SWMM continuity is −0.297 % (seen before, not counted).
- (b) met: 9 of 9 PV-SS13 grate rows, 60–83 % against HEC-22's 69–91 %, all low by 6 to 9 points.
- (c) met: `npm test` 53 of 53 at 1f74567. Gate C's coupled cases pass their own `opts`, without `capture`, so they
  run the depth law as before (`benchmarks/gatec/coupled/coupled.mjs`).

Still not exercised: the subgrid speed mode (approach flow is zero there, so the depth law governs), the GPU on the
whole set (9 PV-SS14 cases agreed with the CPU to three digits), and real streets. Climate Home Inspection moves its
pin only with a decision line.
