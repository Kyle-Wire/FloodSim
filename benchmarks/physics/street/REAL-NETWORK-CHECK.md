# Real-network check of the street-sandbox fixes (18 Nov 2026)

Task 1 of the street sandbox handoff ([HANDOFF.md](HANDOFF.md)): run FloodSim's fixed
code the way production runs it, on a real pipe network and on the synthetic one, and say what changes against the
commit Climate Home Inspection pins (`1948126`). Nothing here is validated. Whether the pin moves is Kyle's decision.

**In one sentence:** I see no reason in these runs not to move the pin to `main`. The sustained levels at the Charlotte
gauge and at the Forest Hills marks are the same to within 3 cm. The water that swung between street and sewer fell by
about four fifths, with the net exchange unchanged. And the app falls back to SLOT and passes the node area as it
should. Moving the pin also brings the stream-crossings change (pull request 9), and every run here used the fallback
soil rate (see "How it was run").

## How it was run

- **Code.** Three worktrees, none of them the main checkout: `1948126` (the pin), `418a8a4` (the pin plus the
  stream-crossings change of pull request 9, before the sandbox fixes), and `main` at `faf45a9` (both). Nothing under
  `src/` or `app/` was changed in any of them. `main` has since moved to `bea17bf`, which adds only `HANDOFF.md`, so
  the code is the same.
- **Path.** Every run went through the app's own batch path, as `tools/batch.mjs` and `tools/validate.mjs --run` do:
  that checkout's `server/server.mjs`, the app opened headless with `?batch=run`, and a one-job study of the case's
  storm as set. [`realnet/run-case.mjs`](realnet/run-case.mjs) does this. While the run goes, it reads (and never
  writes) the app's console hook `window.__floodsim.run`, to keep what `summary.json` does not: the coupler's volume
  in each direction, its `nodeArea` and `follow`, the `[OPTIONS]` SWMM was given, and the app's run log.
- **Inputs.** Each run used the case file, unchanged: `../../validation/edwards-branch-clt-2024-01/project.json` and
  `../../validation/forest-hills-ida/project.json`. Runs were filed in a projects folder of their own, not Kyle's.
  All the worktrees read one download cache, so the terrain, buildings, rain, pipes and inlets are the same bytes in
  every run. The forcing record's storm, grid, start, drainage, utility-data and area hashes match within each case.
  The Charlotte pipe data stays in that cache and in the run folders, out of git.
- **Soils.** The USDA Soil Data Access service returned 502 all day, so every run here, before and after alike, used
  the app's fallback "compacted-fill" rate. The before and after numbers compare like with like, but none of them is
  the case as it would run with soils, so they are not comparable with filed validation runs.
- **GPU.** The card was shared with a training job for most of the day, so the wall times are not speed measurements.
- **Repeat runs.** I made no repeat run on the same code, so run-to-run spread is not measured here. The ground, rain
  and inputs are identical.
- **Comparison.** [`realnet/diff_runs.py`](realnet/diff_runs.py) compares two filed runs cell by cell. It maps where
  the maximum level moved, where the ground under the water differs (maximum level − maximum depth: a terrain change
  shows there, a change of exchange rule cannot), each mark's change, and the gauge and its control line.

## Edwards Branch, Charlotte: 9 January 2024, real storm sewers (1,738 linked pipes, 1,319 inlets)

| | Pin `1948126` | `418a8a4` (crossings) | `main` (crossings + fixes) |
|---|---|---|---|
| Gauge 0214643820 peak level, as scored (m) | 210.918 | 210.888 | 210.872 |
| … its 10-minute mean peak | 210.856 | 210.843 | 210.855 |
| … the gauge cells' 30-minute mean peak | 210.754 | 210.759 | 210.756 |
| Flow across the gauge's control line, peak (m³/s) | 12.975 | 12.739 | 11.481 |
| … its 5-minute mean peak | 11.722 | 11.667 | 11.310 |
| … step-to-step swing (sd of 10 s changes, hour around the peak) | 0.313 | 0.335 | **0.087** |
| … volume (m³) | 71,687 | 71,876 | 71,428 |
| Street → sewer (m³) | 267,192 | 266,050 | 264,392 |
| Sewer → street (m³) | 2,142 | 2,189 | **459** |
| Net into the sewer (m³) | 265,050 | 263,861 | 263,933 |
| SWMM continuity error (flow routing) | 0.034 % | 0.029 % | 0.053 % |
| Surface books (limit 1e-5) | 1.1e-5 | 4.6e-6 | 5.0e-6 |
| Combined books, surface and pipes | −0.071 % | −0.120 % | +0.061 % |
| Ground changed under the water (cells wet in both, > 5 mm) | – | 71 m², one patch | none |

The gauge read 211.36 m, and all three runs are 0.44–0.49 m below it. They cannot be compared with the active
inlet-fix baseline (`2026-11-11_001513`), which is a different setup: a box extended west, the "Channel to survey"
scenario, rain source `radarFit` and wetness `auto`, against the case file's `radar` and `normal`. Soils were also
missing here.

## Forest Hills, Queens: Ida 2021, synthetic sewer (3,785 real inlets, pipes synthesised)

| | Pin `1948126` | `main` |
|---|---|---|
| High-water marks, RMSE / bias (n = 25) | 0.620 / −0.176 m | 0.621 / −0.177 m |
| Marks whose level moved 5 mm or more | – | 5 of 25, at 3 places: −1.0, +1.8, −2.7 cm (below) |
| USGS mapped inundation: hit rate / CSI | 34.0 % / 14.06 % | 34.1 % / 14.10 % |
| NYC DEP Moderate / Extreme: CSI | 5.04 % / 9.99 % | 4.99 % / 9.93 % |
| Street → sewer (m³) | 951,652 | 939,680 |
| Sewer → street (m³) | 15,027 | **3,276** |
| Net into the sewer (m³) | 936,625 | 936,404 |
| Roofs piped to the sewer (m³) | 508,196 | 508,196 |
| SWMM continuity error | −0.014 % | −0.012 % |
| Surface books (limit 1e-5) | **−3.5e-5** | −1.8e-5 |
| Combined books | +0.0041 % | +0.0040 % |
| Ground changed under the water | – | none |

There is no `418a8a4` run for Forest Hills. The crossings change shows in the build log: the pin breached "1 channel
hump", while `main` breached none, left "1 fill under a mapped bridge", and warns about the box's only mapped culvert
(Flushing Creek, at its north-east corner). No ground changed under any cell wet in both runs.

## Every difference over 1 cm or 1 %, explained

**1. The Charlotte gauge peak: −3.0 cm with the crossings change, −1.6 cm with the fixes, −4.6 cm in all.**
This is mostly a wobble being taken off the top, not a lower flood. Before the fixes, the flow across the gauge's
control line jumped up and down by about 1 m³/s every 10 s near the peak. With them it is smooth: the swing falls
from 0.335 to 0.087. The scored peak is the highest sample of a per-minute series, so before the fixes it caught a
wobble top. The longer the average, the smaller the difference. At 30 minutes the three runs agree to 0.5 cm
(210.754, 210.759, 210.756 m); at 10 minutes they are within 1.3 cm. The crossings change also reaches the gauge
directly: a mapped Edwards Branch culvert runs under it at Sheffield Dr, and pull request 9 moved culvert links from
the old simple routine to FHWA HDS-5. Its one terrain change is 71 m² cut by up to 78 cm, about 580 m from the gauge.
Neither moves the 30-minute level by more than 0.5 cm. The −3.0 cm between the pin and `418a8a4`, both of which
wobble, is the sample landing on a different part of the wobble. I cannot prove that from these files beyond the
averages above, because the per-minute series is too coarse to resolve a 10 s swing.

**2. The Charlotte gauge-line peak flow: −9.9 % with the fixes.** This is the same wobble. The 5-minute mean peak
falls 3.1 % (11.667 to 11.310 m³/s) and the volume across the line 0.62 %. The 448 m³ less across the line goes with
517 m³ less leaving the box's edge. The combined books move by 492 m³ (0.18 % of the rain) at the same time, from
−327 to +165 m³. So that part sits inside the coupled model's own accounting, not in a change I can point to on the
ground. All of it is under 1 % in volume.

**3. Water sent back up to the street: −79 % at Charlotte (2,189 to 459 m³), −78 % at Forest Hills (15,027 to
3,276 m³).** This is the fix doing what it was made for: the old rule's swinging at surcharged manholes stopped. The
evidence is that the water into the sewer fell by the same amount. At Charlotte, street → sewer fell 1,658 m³ and
sewer → street 1,730 m³; at Forest Hills 11,972 and 11,751 m³. The net into the sewer moved 0.03 % and 0.02 %. So
what went is water that went up and came straight back down, counted once each way. The sandbox showed the same:
sign changes of the rate 178 → 0 in PV-SS3 a (`FIXES.md`).

**4. Street → sewer, gross: −1.05 % at Charlotte (−0.43 % with crossings, −0.62 % with the fixes), −1.26 % at Forest
Hills.** The fixes' share is point 3: the returned water is no longer counted going in again. The crossings' 0.43 %
is under 1 % and was not chased.

**5. Five Forest Hills marks, at three places, moved 1.0–2.7 cm** (NYQUE31441 both marks −1.0 cm; NYQUE31442 both
marks +1.8 cm; NYQUE31432 HWM-1 −2.7 cm). All three places are in one area around 40.716 N, 73.855 W, where the
largest patches of changed maximum level are (10,426 m² at −1.3 cm, 4,234 m² at +3.3 cm, 2,556 m² at +1.8 cm). No
ground changed there. Forest Hills' one culvert, the only other code change in the pair, is on Flushing Creek about
3.6 km away. The 128 inlets within 300 m of those patches (84 marked `full` in the run's `inlets.json`) account for 8,268 m³
of the 11,972 m³ fall in street → sewer (69 %). So the exchange fix moved these marks. Why the level rose at one place
and fell at the others is not explained: the run files keep each inlet's inflow, not its swing.

**6. Forest Hills surface books: −3.5e-5 at the pin.** This is outside the 1e-5 limit, and more than the 1.4–1.9e-5
F25 records for the GPU. `main` reads −1.8e-5, inside F25's range but still outside the limit. Not explained; it
belongs with F25. The Charlotte pin is just over the limit too (1.1e-5).

**Not over the line:** the SWMM continuity error is under 0.06 % in every run, and its changes are a few hundredths
of a per cent. The combined books stay under 0.12 %. The Forest Hills mark RMSE moved 0.5 mm and the map CSIs under
0.1 point. None of these runs showed the 17–19 % continuity error on surcharged nodes with return flow from
`FIXES.md`. That error was measured on small volumes with no rain, and here it is diluted in large storms. These
runs neither confirm it nor rule it out.

## The app's own run path (step 2)

Run: `forest-hills-dep-moderate` (synthetic network, two-way exchange on, 55 mm/hr for 1 h) on `main` through the
app's batch path, with two inputs set: "When a pipe runs full" = EXTRAN (`swmmSurcharge`), and "Smallest manhole
water area" = 2 m² (`swmmMinArea`, not the default 1.2, so the value passed can be told apart from the coupler's own
default).

From the app's run log, as the page showed it:

```
warn | EXTRAN cannot be used with two-way exchange (manhole heads swing by metres): this run uses SLOT
```

From the SWMM input the app wrote (`run.inp`, `[OPTIONS]`):

```
MIN_SURFAREA 2
SURCHARGE_METHOD SLOT
```

From the coupler the app built (`window.__floodsim.run.coupler`):

```
nodeArea: 2, follow: true, twoWay: true, interval: 2
```

Both happen. The app falls back to SLOT with a warning when EXTRAN is chosen with two-way exchange. It passes
`routing.minSurfArea` to the Coupler as `nodeArea`. And the run did not stop at `toINP`'s new refusal of EXTRAN with
two-way, because the fallback happens before `toINP` is called. In the two `main` runs above, with the default
settings, the coupler held `nodeArea: 1.2, follow: true`; in the pin and `418a8a4` runs it has neither.

The run finished: 3 h simulated in 0.50 h of wall time. 346,248 m³ went from street to sewer and 191 m³ came back.
SWMM's continuity error was −0.006 %, the surface books −1.4e-6 and the combined books +0.002 %.

**One thing to know, not a failure of the run:** the filed `summary.json` records the settings as chosen, not as run.
Its `drainSettings` reads `{ routing: { minSurfArea: 2, surcharge: "EXTRAN" } }`, and that part feeds the run's
forcing hash, while the `network.inp` filed beside it says `SURCHARGE_METHOD SLOT`. Someone reading only the summary,
or comparing runs by their forcing record, would take this for an EXTRAN run. The fix is small (record the routing
after the fallback, in `app/map.js`), but this task changes nothing under `app/`, so it is left for Kyle to decide.

The first attempt at this run (08:15) did not build: all three Overpass servers returned 502. It ran again at 15:43.

## What this check does not cover

- Soils were the fallback rate in every run (see "How it was run").
- One storm per case; no repeat runs on the same code.
- Forest Hills has no `418a8a4` run, so its small changes rest on the location evidence in point 5, not on a split.
- The 1 m grid the product uses was not run; both cases are at 2 m, as filed.
- SLOT's 2–13 % extra conveyance in surcharged pipes is in every run, before and after. It is open (handoff task 5).

## Files

- [`realnet/run-case.mjs`](realnet/run-case.mjs): runs one case through a chosen checkout's app path, with the probe.
- [`realnet/diff_runs.py`](realnet/diff_runs.py): compares two filed runs (maximum level, ground, marks, gauge).
- The run folders, probe files and download cache are local (`C:\Users\kylew\FloodSim-realnet-projects`), not in git:
  they hold the City of Charlotte pipe data (CC BY-NC-SA 4.0). Runs, stamped and not overwritten:
  - Charlotte: `rnc-edwards-branch-clt-2024-01-{pin,prefix,main}/runs/2026-11-18_{090935,094740,102826}_Validation-Existing-conditions`
  - Forest Hills: `rnc-forest-hills-ida-{pin,main}/runs/2026-11-18_{131539,154301}_Validation-Existing-conditions`
  - App path: `rnc-forest-hills-dep-moderate-main-extran/runs/2026-11-18_161310_Validation-Existing-conditions`
