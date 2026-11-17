# Street sandbox: three fixes, measured before and after (17 Nov 2026)

This branch (`claude/street-sandbox-fixes`) sits on the sandbox branch and changes FloodSim itself. The sandbox branch
changes nothing under `src/`; keep the two apart when merging. Each fix answers a finding in `../../FINDINGS.md`. All
rows are the CPU surface solver with the production coupler and SWMM. **The GPU path has not been run** on either
branch: the coupler change is in code both paths share, but the Gate C coupled cases (`../../gatec/coupled/`) need a
GPU run before this is merged.

Kyle said "make the revisions you see as needed". I read that as leave to fix what the sandbox shows is wrong where
the fix is small and can be measured against a known answer, as a separate pull request for him to merge or not. That
reading is mine.

## 1. Two-way exchange follows the street level (F14)

`src/coupler.js`. At a surcharged manhole the old rule set the exchange from the head difference of the moment (an
orifice law). A manhole holds almost no water, so over one 2 s interval that rate moved its head many times the
difference that set it: the rate changed sign most intervals and the manhole's mean head stood above the street.

Now the rate for the coming interval is what the manhole's pipes carried away over the last one, plus half of what
brings its head to the street's level less the grate's own loss, kept between what the grate takes freely and what the
orifice law returns. Below a surcharge that sum always exceeds the free rate, so free inflow is unchanged.
`follow: false` keeps the old rule.

| Case | By hand | Before | After |
|---|---|---|---|
| PV-SS3 a: pond at 7200 s, rain above the pipe's capacity | 0.199 m | 0.121 | 0.150 |
| PV-SS4 a: street level, outlet held 0.15 m above the street | 0.150 m | 0.1445 | **0.1500** |
| PV-SS4 b: the same through the app's stream-level setting | 0.150 m | 0.1401 | **0.1500** |
| PV-SS4 d: pond at 7200 s, rain and the outlet held | 0.547 m | 0.471 | 0.491 |
| PV-SS11 sag whose drain cannot keep up, 10 / 100 / 500-yr peak | 0.043 / 0.135 / 0.205 m | 0.039 / 0.115 / 0.188 | 0.041 / 0.121 / 0.192 |
| Rate sign changes in the last 300 exchanges (PV-SS3 a) | 0 | 178 | 0 |
| Manhole head, standard deviation (PV-SS3 a) | – | 29 mm | 0.1 mm |
| The same case exchanging every 0.5 s instead of 2 s | the same answer | 0.148 (differs) | 0.150 (the same) |
| Bowl network, water sent back up to the street, 10 / 100 / 500-yr | – | 31 / 41 / 13 m³ | 0 / 0 / 0 |
| Bowl network, peak depth at the sag | – | 0.279 / 0.396 / 0.478 m | 0.284 / 0.400 / 0.475 |
| Free inflow: PV-SS3 c, PV-SS11 sag whose drain keeps up, PV-SS13 | exact | exact | unchanged |

PV-SS4 goes from 6 rows passed to 10.

**What is left.** The ponds still read low (0.150 against 0.199 m; 0.491 against 0.547 m). That part is SWMM's SLOT
surcharge method, which adds the slot's area to the pipe's (`diagnostics/slot-capacity.mjs`: 2–13 % more conveyance
by pipe size and surcharge). It is inside SWMM and is not touched here. With SLOT's extra conveyance in the hand
answer the pond is 0.150 m, which is what the model now gives.

**SWMM's continuity error did not change** (0.76 %, 1.15 %, and 17–19 % of a few cubic metres when water comes back up
an inlet). So it is not caused by the swinging, as FINDINGS F14 first suggested; it is SWMM's own bookkeeping of
surcharged nodes and return flow, and it is still open.

**Risks, for review.**
- The rule assumes the manhole's own storage is half SWMM's minimum node area (the app now passes the setting). An
  area taken too small only slows the approach; one taken more than about 1.7 times too large would swing.
- Manholes with several grates share the step equally.
- Not run on the GPU, and not run on a real network (Charlotte, Forest Hills).

## 2. The wall rule's reach is in metres (F20)

`src/damage.js` exposure stepped two cells out from the footprint whatever the cell size. It now takes `reach` (2 m)
and the grid's cell size. On the 1 m grid the app uses, nothing changes. PV-SS7 R12 (2 m cells) now passes: 17 of 17.

## 3. EXTRAN cannot be combined with two-way exchange (F18)

With EXTRAN, sealed manholes that exchange with the street swing by metres and SWMM's continuity error reaches tens
of per cent; the new exchange rule does not cure it (`diagnostics/one-pipe.mjs`). `src/drainage.js` toINP now refuses
the combination, and the app falls back to SLOT with a warning in the run log.

## Not changed, and why

- **Grates on a grade (F21, PV-SS13).** The grate takes 26–40 % where HEC-22 gives 69–91 %. A fix needs the speed of
  the water at the grate, which the exchange does not carry; that touches the GPU kernels and cannot be tested without
  the GPU.
- **Coarsening that keeps passages and crowns (F12, F22).** A design decision, and 1 m is the baseline anyway.
- **The allowance (F17).** F23 recommends dropping it from the product rather than repairing it.
- **The synthetic network's sizing (F16), the model box (F13).** Product decisions.
- **The grate's weir coefficient (F15).** Waits on F21.

All 53 CPU test suites pass.
