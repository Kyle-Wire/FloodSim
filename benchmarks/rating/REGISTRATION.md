# RT-1 registration

**Registered 14 Nov 2026**, on the main branch at ec6f89d. Nothing has been built or run.

## What is fixed

| Item | Where | Decided |
|---|---|---|
| Protocol, model setup, scoring rows | `README.md` | drafted 14 Nov 2026 |
| Thresholds: high- and mid-flow level \|bias\| ≤ 0.15 m and RMSE ≤ 0.20 m Passed; ≤ 0.30 m Qualified; beyond Failed. Errors inside U_obs count as zero | `README.md`, Scoring | accepted by the user 14 Nov 2026 |
| Shorter upstream length where a structure or tributary lies < 1 km above the gauge, with the inflow row (< 0.02 m when the edge moves 100 m) | `README.md`, Model setup and Scoring | decided by the user 14 Nov 2026 |
| Model read within ±50 m of the gauge bridge | `README.md`, Reference uncertainty | 14 Nov 2026, from the position check |
| Configurations A (default, hydro-flattened lidar) and B (A + `src/bathymetry.js`) | `README.md` | 14 Nov 2026 |
| Sites: eight picks, the reserves and every exclusion with its reason | `sites.md` | 14 Nov 2026 |
| Screening and site-check output | `candidates.json`, `structures.json` | 14 Nov 2026 |

## The sites

| Region | Site | Name |
|---|---|---|
| IA | 05470000 | South Skunk River near Ames |
| IA | 05486000 | North River near Norwalk |
| CO | 06709530 | Plum Creek at Titan Rd near Louviers |
| CO | 06730200 | Boulder Creek at N 75th St |
| PA/NJ | 01481000 | Brandywine Creek at Chadds Ford (short upstream) |
| PA/NJ | 01467081 | S Br Pennsauken Creek at Cherry Hill |
| TX | 08183978 | Cibolo Creek at Specht Rd (short upstream) |
| NC | 0214645022 | Briar Creek above Colony Rd (short upstream) |

All eight are bridge sections. The open-reach class has no site.

A reserve is used only if a pick is **Invalid setup** before any of its results are seen: terrain cannot be fetched, or
the reach cannot be built. The reserves are taken in their `sites.md` order. A pick that runs and scores
**Insufficient** stays in as Insufficient.

## Known limits, stated before the run

- Structures come from OpenStreetMap and the NID only. The USGS station descriptions were not available.
- Pennsauken was cleared for rule 5 from the OSM geometry, not imagery.
- At four sites the NHD line is shorter than the 5 km check window downstream.
- Cibolo has 12 direct measurements, only 1 of them Good.

## Hashes

`SHA256SUMS` in this folder covers `README.md`, `sites.md`, `candidates.json`, `structures.json`, `screen.mjs` and
`check-sites.mjs`. Any change to these files after this date is a revision and is recorded below, with a new hash.

## Revisions

### Revision 1 (14 Nov 2026, before any scored run; approved by the user the same day)

**Why.** Building the first reach (Briar Creek, an unscored pilot) showed two things the registration got wrong.

1. **The site check put structures on the wrong side of the gauge.** `check-sites.mjs` stitched the NHD flowlines by
   walking to the nearest point from the gauge. The flowline that the upstream and downstream navigations share
   was mixed in, and chainage could run backwards. Briar Creek's culvert, 249 m below the gauge, was listed 324 m
   above it.

   `check-sites-r1.mjs` chains the flowlines in flow order instead (NHDPlus lines are digitised downstream). It is
   otherwise the same check, from the same cached OSM and NID replies, and it writes `structures-r1.json`.

   Under the corrected check:
   - **Briar Creek is excluded** under rule 5: an OSM culvert carries Briar Creek at +249 m. In the pilot, the app's
     default 1.2 m pipe for that culvert ponded the creek through the gauge window. NC has no other site.
   - **Cibolo Creek's inflow edge moves** from −600 m to −500 m: Kelly Creek joins at −545 m, not −646 m.
   - Every other pick and exclusion in `sites.md` stands.

2. **The registered downstream length does not fit at 1 m on the flat rivers.** L_dn ≥ 5 × bankfull depth / slope,
   built with `build.mjs` (slope from 3DEP along the channel, depth from the Bieger curve), needs:
   - South Skunk: 7.5 km, 36 M cells with a clean inflow edge;
   - North River: 33 km, 108 M cells;
   - Brandywine: 24 km, 110 M cells.

   The app's limit is 20 M cells at 1 m. Each of these is **Invalid setup**, and the registered reserve rule applies.

   **Iowa reserves, in their `sites.md` order:**
   - Indian Creek: 9.0 km, 56 M cells. Invalid.
   - **Fourmile Creek near Ankeny (05485605)**: 4.1 km, 7.0 M cells. Taken.
   - Walnut Creek: 26 M cells. Invalid.
   - Beaver Creek: 139 M cells. Invalid.

   Iowa therefore has one site. Fourmile Ankeny's inflow edge is −400 m (a split named Fourmile Creek joins at −421 m),
   under the short-upstream rule. Pennsylvania/New Jersey has no reserve, so it has one site (Pennsauken).

**The sites, as revised:**

| Region | Site | Name | Inflow edge | Downstream | Cells at 1 m |
|---|---|---|---|---|---|
| CO | 06709530 | Plum Creek at Titan Rd | −1000 m | 2000 m | 5.5 M |
| CO | 06730200 | Boulder Creek at N 75th St | −1000 m | 2000 m | 6.7 M |
| PA/NJ | 01467081 | S Br Pennsauken Creek | −1000 m | 3104 m | 5.8 M |
| TX | 08183978 | Cibolo Creek at Specht Rd | −500 m | 3267 m | 2.6 M |
| IA | 05485605 | Fourmile Creek near Ankeny | −400 m | 4060 m | 11.2 M |

**Setup fixed with this revision** (code hashed in `SHA256SUMS-r1`, each file's text with LF line endings as git
stores it: check with `git show HEAD:<path> | sha256sum`. The registered `SHA256SUMS` mixes the two: `sites.md` was
hashed with Windows CRLF endings, the other five with LF. All six match the registered commit, checked 14 Nov 2026):
- **The app's steady-flow test mode** (`src/steady.js`, hooks in `app/map.js`), opt-in through the project only:
  - 7 discharge steps, log-spaced over the measured range (floored at 1/2000 of the top), with 10 min ramps;
  - each step held 3 travel times at 1 m/s (at least 60 min);
  - no rain, no infiltration, rivers starting at the lidar surface;
  - the gauge read on the inflow river's own mapped channel. Not on NLCD water: the pilot's first reading took a pond
    beside the creek.
- **`build.mjs`**: the corridor centred on the lidar channel, not the NHD line, wide enough that the ground stands
  1.5 m above the highest measured level, and cut so the river enters across a box side. The corridor runs 150 m
  past the cut and is not clipped to the box, so the app's own grid clips it flush with the side. A setup-only run on
  Cibolo (unscored, its levels not read) found the river entering 7–12 m inside the box: out of reach of the app's
  edge inflow, so all the flow drained straight back out. The same run found the right side 0.85–0.9 km below the
  inflow standing on ground 1.5 m under the highest measured level: water left through the sinks there. Each side is
  now checked every 3 m. Where it stands less than 0.5 m above the highest measured level (carried along the slope) on
  ground the river can reach (a fill from the channel over the 3 m lidar), the sections beside it widen, to at most
  1500 m. Fourmile Ankeny keeps low reachable ground at that limit, 6.6 m under the level at most. If the river
  gets there at the top steps, the outlet-flow test marks those steps not steady. Cell counts in the table are after
  the widening.
- **`score.mjs`**: the model level is the median of the wet channel cells within 50 m of the gauge, with their spread.
  A step is steady when the level changes < 1 mm over the last 10 min of the hold and the outlet section passes the
  inflow within 1 %. The rows follow `README.md`, Scoring.
- **Q_mean** (mid-flow row): the mean of the daily mean discharge, water years 2010–2026.

**Not changed:** the thresholds, the rows, configurations A and B, and the rule that no site is added or dropped after
a result is seen.

**Side finding (outside RT-1):** an OSM culvert with no size tags is linked at 1.2 m (`app/map.js`,
`culvertDiameter`). On Briar Creek that dams a channel carrying up to 55 m³/s. This is the same class of error as the
Edwards Branch Sheffield culvert.

### Revision 2 (14 Nov 2026, after one Revision 1 run; approved by the user the same day)

**Why.** The first registered run, Cibolo Creek A, ran all seven steps (22.2 simulated hours). At the gauge it settled
from 1.1 m³/s up: the level held within 1 mm, and the gauge section passed the inflow within 0.5 %. Downstream the
model started dry, though, and about 117,000 m³ went into filling floodplain hollows below the gauge. Nothing leaked:
the water leaving the model matched the outlet section. The outlet flow lagged the inflow at 5 of 7 steps:

| Step (m³/s) | Outlet flow (m³/s) |
|---|---|
| 1.1 | 0 |
| 2.4 | 0 |
| 5.3 | 5.17 (2.6 % low) |

Only the top step passed the 1 % outlet test, so the high and mid rows were **Insufficient**. The real creek at a field
visit has those hollows in their usual state, not empty.

**Seen before this revision.** The Cibolo A levels are not scored, but they were read: the model was about 0.29 m
low at 11.6 m³/s, level at 5.4 m³/s, and 0.08 m high at 4.1 m³/s. This revision is made with those numbers known. It
changes only how the reach is brought to steady, not what is compared or the thresholds. Plum Creek A was stopped at
2.3 simulated hours, before any level was read.

**The change** (in `build.mjs`, `src/steady.js` and the app's warm-up, `app/map.js` `warmUp`; hashed in
`SHA256SUMS-r2`):
- The reach is first **filled** at the top step's flow for two holds, through the app's warm-up path. That run is not
  recorded; the stepped run starts from its end state.
- The seven levels then run **from the top down**, so each step only drains. The README asks for each level to be
  "held until steady" and does not fix the order.
- The steps, holds, steady tests (< 1 mm over 10 min; outlet within 1 %) and scoring are unchanged. `score.mjs` sorts
  the levels by flow before interpolating.

**Filed.** The Cibolo A run is kept as `runs/_r1-superseded-2026-11-14_183051` with its `rt1-score.json`. All ten
projects are rebuilt and every site is run again under this revision, Cibolo A included.

### Revision 3 (15 Nov 2026, after the Revision 2 Cibolo A run; chosen by the user)

**Why.** Under Revision 2, Cibolo Creek A still failed the outlet test at 5 of 7 steps, now the other way: once the
flow drops, the floodplain hollows below the gauge drain back slowly and the outlet passes more than the inflow
(2.64 m³/s at the 2.42 step, +9 %; 0.27 at the 0.11 step). At the gauge, the level held within 1 mm at every step, and
the gauge section passed the inflow within 1 % at every step down to 0.51 m³/s. The water still moving is stored below
the gauge and does not move the level being compared.

**Seen before this revision.** The Revision 2 levels were read in full before it: at 11.6 m³/s the model is about
0.29 m low, at 5.4 level, and at 0.5–2.5 m³/s about 0.15–0.3 m high. The user chose this option over holding each step
until the outlet settles, which keeps the registered test but costs many more hours per site.

**The change** (`score.mjs` only; hashed in `SHA256SUMS-r3`): a step is steady when the gauge level changes < 1 mm
over the last 10 min of the hold **and the gauge section** (not the outlet) passes the inflow within 1 %. The outlet
flow is still reported for each step. The model setup, steps, holds, thresholds and rows are unchanged, so the
Revision 2 projects stand and the Revision 2 Cibolo A run is scored under this rule.

### Revision 4 (16 Nov 2026, after seven Revision 3 runs; made by Claude under the user's instruction of the same day to review the work and change what needed changing)

**Why.** A review of the scorer against this README, with a test suite written for it (`tests/run-rating-tests.mjs`,
synthetic reaches with a known answer), found the scorer departing from the written rule in ways that could let a
step through that was not steady, and found three filed results that are not what their rows say.

**Seen before this revision.** Every filed level and row: Cibolo Creek A and B, Plum Creek A and B, Boulder Creek A
and B, Pennsauken A. Pennsauken B was running (it filed before this revision was hashed, and is the first run
scored under it) and Fourmile Creek had not been run. The changes below either make the
steady test stricter or add reported fields. **No filed verdict changes under them** (each run is rescored; its
Revision 3 score is kept beside it as `rt1-score-r3.json`).

**The scorer** (`score.mjs`; hashed in `SHA256SUMS-r4`):

| | Before | Now |
|---|---|---|
| Level steady | the first and last reading of the last 10 min within 1 mm. A level swinging ±5 cm between them passed, and so did a window with one reading | the range of every reading in the window under 1 mm, with at least 5 readings and none dry |
| Level falls with flow | not checked. On Plum Creek A the two lowest steps read 0.4 m above the step over them: the level is the median of the wet cells, and with 2 to 4 left it moved to a pool above the channel | a step whose level is above a higher flow's is not steady, and is not the base of the rating shape |
| Rating shape, measured | log(h − h0) with h0 the **model's** lowest-step level, so the measured slope moved with the model (Boulder Creek: 0.159 under A, 0.222 under B, same measurements) | h0 is the observed level at the lowest measured flow. Both bases are reported |
| Step windows | a copy of `stepWindows` with the ramp fixed at 10 min | `src/steady.js` `stepWindows`, the ramp from `rt1.json` (10 where absent) |
| Missing level | a step with no level was skipped, and the interpolation ran across it | a bracketing step with no level leaves the measurement unscored |

**Reported, new, used by no verdict:**
- **`setup`**: `invalid` when the gauge is dry at the top step, no gauge section was recorded, or the gauge section
  passes under half the top step's inflow. The rows of such a run are Insufficient already. This says why.
- **`interpM`**, per measurement and per row: the scorer's straight line on log Q less a smooth curve (monotone
  cubic) through the same steps. The README's extra mid-level run was never built, and on a power-law rating the
  straight line reads high: 29 mm with steps a factor of 2 apart, in the test suite. On the filed runs it is 0 to 4 mm.
  It needs three steady steps either side to mean anything, so it says nothing yet for Plum Creek.
- **`reference`**: the scatter of the measured points about their own rating (each against a line through its six
  nearest neighbours in Q), and how many measured levels lie under the model's lowest bed among the gauge cells.

**What the filed runs are, under this revision:**

| Run | Rows (unchanged) | Reading |
|---|---|---|
| Cibolo Creek A, B | high Passed (−0.05 m), mid Qualified (+0.17 m) | Valid. The reference scatters 0.14 m about itself, just inside the Passed threshold |
| Plum Creek A, B | high Failed (+0.71 m, 3 measurements) | **Not a finding about the model.** The reference is not one rating: the measured level at 0.3–1.5 m³/s averages 1685.73–1685.85 m in 2010–2016, 1686.20–1686.47 m in 2018–2021, and 1685.75 m again in 2022–2023. Its scatter is 0.25 m, above the Passed threshold. Under A, 135 of 177 measured levels are below the model's lowest gauge-cell ground: the lidar caught the high bed, and the three high-flow measurements are from the low-bed years. The README's window rule foresaw this ("the channel moves") but nothing screened for it |
| Boulder Creek A, B | Insufficient | The gauge section passes 73 % of the top step and about 93 % of the rest: flow goes round the section. The setup needs looking at before any rerun |
| Pennsauken A, B | Insufficient | **Invalid setup.** A road embankment in the 3DEP terrain about 80 m above the gauge has no opening. The creek ponds 3.95 m deep behind it at 6.53 m, 1.2 m over the highest measured level, and the inflow leaves over the corridor side. Under A the gauge stays dry and the gauge section passes 0.2 % of the inflow. B (`2026-11-16_074734`) is the same: the carved channel holds standing water at the gauge, and the section passes 0.3 % |

The rule that no site is dropped after a result is seen stands: Plum Creek stays in the table with its row and this
reading beside it. A site-selection rule on reference scatter belongs in any later registration.

**The app** (`src/steady.js`; hashed in `SHA256SUMS-r4`): `parseSteady` returned null for an invalid setup, as its
comment says, except for a step that was not a pair, where it threw. The app calls it on every storm and every solver
build. It now returns null there too. Nothing changes for a valid setup, so the filed runs and the built projects
stand. This edit was made after the Pennsauken B run was filed, so that run's code stamp matches Pennsauken A's.

**Not changed:** the thresholds, the rows, the sites, configurations A and B, the steps and holds, `build.mjs`,
`app/map.js`, `app/map.html`.

**Open, outside this revision:**
- Boulder Creek's bypass and Pennsauken's embankment are setup faults under the registered rules. Fixing either
  (a wider gauge section; an opening cut through the embankment) is a change made knowing the levels, and needs
  its own revision.
- The Pennsauken embankment is the Briar Creek and Sheffield culvert error again: a crossing the terrain closes.
  FloodSim has no check that a mapped river can pass each road it crosses.
- Fourmile Creek A and B are not run.
