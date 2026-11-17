# Street sandbox: three fixes, measured before and after (17 Nov 2026)

Three changes to FloodSim itself, each answering a finding in `../../FINDINGS.md`, each measured against a known
answer on the CPU solver and on the production GPU solver. Kyle said "make the revisions you see as needed"; I read
that as leave to fix what the sandbox shows is wrong where the fix is small and can be measured. That reading is mine.

| Fix | On the GPU |
|---|---|
| 1. Two-way exchange follows the street level | **Passed**: the existing coupled cases with exact answers, 22 of 22; the sandbox's rows moved toward their hand answers and none went from pass to fail |
| 2. The wall rule's reach is in metres | **Passed** (17 of 17). It runs in node only; no GPU is involved |
| 3. EXTRAN with two-way exchange is refused | **Passed** as a refusal (unit test). Not exercised through the app's own run in a browser |

## 1. Two-way exchange follows the street level (F14)

`src/coupler.js`. At a surcharged manhole the old rule set the exchange from the head difference of the moment (an
orifice law). A manhole holds almost no water, so over one 2 s interval that rate moved its head many times the
difference that set it: the rate changed sign most intervals and the manhole's mean head stood above the street.

Now the rate for the coming interval is what the manhole's pipes carried away over the last one, plus half of what
brings its head to the street's level less the grate's own loss, kept between what the grate takes freely and what the
orifice law returns. Below a surcharge that sum always exceeds the free rate, so free inflow is unchanged.
`follow: false` keeps the old rule.

**The sandbox, before and after.** GPU and CPU agree after the fix to four digits.

| Case | By hand | Before (CPU / GPU) | After (CPU and GPU) |
|---|---|---|---|
| PV-SS3 a: pond at 7200 s, rain above the pipe's capacity | 0.199 m | 0.121 / 0.128 | 0.150 |
| PV-SS4 a: street level, outlet held 0.15 m above the street | 0.150 m | 0.1445 / 0.1465 | **0.1500** |
| PV-SS4 b: the same through the app's stream-level setting | 0.150 m | 0.1401 / 0.1338 | **0.1500** |
| PV-SS4 d: pond at 7200 s, rain and the outlet held | 0.547 m | 0.471 / 0.471 | 0.491 |
| PV-SS11 sag whose drain cannot keep up, 10 / 100 / 500-yr peak | 0.043 / 0.135 / 0.205 m | 0.039 / 0.115 / 0.188 | 0.041 / 0.121 / 0.192 |
| Rate sign changes in the last 300 exchanges (PV-SS3 a, CPU) | 0 | 178 | 0 |
| Manhole head, standard deviation (PV-SS3 a, CPU) | – | 29 mm | 0.1 mm |
| The same case exchanging every 0.5 s instead of 2 s (CPU) | the same answer | 0.148 (differs) | 0.150 (the same) |
| Bowl network, water sent back up to the street, 10 / 100 / 500-yr | – | 31 / 41 / 13 m³ | 0 / 0 / 0 |
| Bowl network, peak depth at the sag | – | 0.279 / 0.396 / 0.478 m | 0.284 / 0.400 / 0.475 |
| Free inflow: PV-SS3 c, PV-SS11 sag whose drain keeps up, PV-SS13 | exact | exact | unchanged |

PV-SS4 goes from 6 rows passed to 10 on each executor. No row on either executor went from pass to fail.

**The existing coupled cases with exact answers** (`../../gatec/coupled`, benchmark1d2d A12-010, -011, -012; run on
the GPU by `gatec-check.mjs`, which files its results under `gatec-check/` and does not rewrite the filed Gate C
results).

| Two-way measure | Exact | Old rule, same day | Fix, first version | Fix, as it is now |
|---|---|---|---|---|
| A12-010 manhole outflow | 0.5 m³/s | 0.5000 | 0.5000 | 0.5000 |
| A12-010 street depth | 77.68 mm | 77.7 | 77.7 | 77.7 |
| A12-010 combined books (limit ± 0.5 %) | 0 | −0.4914 % | **−0.5043 %, outside** | −0.4914 % |
| A12-011 yard level | 0.050 m | 0.0546 | 0.0546 | 0.0546 |
| A12-011 volume out of the outfall | 225 m³ | 220.60 | 220.62 | 220.61 |
| A12-011 combined books | 0 | −0.0871 % | −0.0843 % | −0.0877 % |
| A12-012 volume out of the outfall | 180 m³ | 180.04 | 180.04 | 180.04 |
| A12-012 water left on the surface | 0 | 0.004 m³ | 0.004 | 0.004 |
| A12-012 combined books | 0 | 0.0256 % | 0.0244 % | 0.0244 % |

All 22 measures (both exchange modes) pass with the fix as it is now. Spill at the rim, which the fix does not touch,
reproduces the filed 5 Nov numbers exactly.

**The first version failed one measure, and was changed.** It gave 21 of 22: the A12-010 two-way books read −0.5043 %
against a limit of 0.5 %. The cause was a safety margin of mine: the exchange assumed half of SWMM's minimum node
area, which slows its start, so 0.12 m³ less left the manhole in the first minute. A SWMM node is never smaller than
the minimum, so the full value is safe, and with it the books are what they were before the fix. Both runs are filed
(`gatec-check/2026-11-17T22-05-fixed`, `…T22-30-fixed`), with an unscored run of the old rule the same day. The
sandbox's answers are the same with either value.

**What is left.** The ponds still read low (0.150 against 0.199 m; 0.491 against 0.547 m), so those sandbox rows
still fail. That part is SWMM's SLOT surcharge method, which adds the slot's area to the pipe's
(`diagnostics/slot-capacity.mjs`: 2–13 % more conveyance by pipe size and surcharge). It is inside SWMM and is not
touched here. With SLOT's extra conveyance in the hand answer the pond is 0.150 m, which is what the model now gives.

**SWMM's continuity error is not cured.** 0.76 % and 1.15 % in the two rain cases, as before. Where water comes back
up an inlet with no rain it reads 17–19 % of a few cubic metres (10–20 % before; higher than before on the CPU). So
it is not caused by the swinging; it is SWMM's own bookkeeping of surcharged nodes and return flow, and it is open.

**Risks, for review.**
- The rule takes the manhole's own storage as SWMM's minimum node area. The app now passes its setting. A caller that
  writes a smaller minimum into the `.inp` and does not pass it would overshoot (an area more than about 1.7 times too
  large swings).
- Manholes with several grates share the step equally.
- Not run on a real network (Charlotte, Forest Hills).
- The app's own run path with the fix has not been exercised in a browser run; the coupler it calls has.

## 2. The wall rule's reach is in metres (F20)

`src/damage.js` exposure stepped two cells out from the footprint whatever the cell size. It now takes `reach` (2 m)
and the grid's cell size. On the 1 m grid the app uses, nothing changes. PV-SS7's 2 m case now passes: 17 of 17 rows
(16 before).

## 3. EXTRAN cannot be combined with two-way exchange (F18)

With EXTRAN, sealed manholes that exchange with the street swing by metres and SWMM's continuity error reaches tens
of per cent; the new exchange rule does not cure it. `src/drainage.js` toINP now refuses the combination, and the app
falls back to SLOT with a warning in the run log. The refusal is unit-tested; the app's fallback is a three-line
change that has not been run in a browser.

## Not changed, and why

- **Grates on a grade (F21, PV-SS13).** The grate takes 26–40 % where HEC-22 gives 69–91 %. A fix needs the speed of
  the water at the grate, which the exchange does not carry; that touches the GPU kernels.
- **Coarsening that keeps passages and crowns (F12, F22).** A design decision, and 1 m is the baseline anyway.
- **The allowance (F17).** F23 recommends dropping it from the product rather than repairing it.
- **The synthetic network's sizing (F16), the model box (F13).** Product decisions.
- **The grate's weir coefficient (F15).** Waits on F21.

All 53 CPU test suites pass.
