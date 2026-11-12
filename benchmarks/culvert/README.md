# Culvert benchmarks: Stage B, SWMM alone (11 Nov 2026)

These benchmarks check what SWMM does with the culvert inputs Stage A writes (`src/swmm-xsect.js`,
`docs/specs/swmm-culvert-inputs.md`). Every answer comes from an independent calculation (FHWA HDS-5 and Manning), never
from another FloodSim configuration. There is no surface solver, no coupled run, no Charlotte run, no production-default
change and no app wiring. `nativeSections` stays off in production.

```bash
node benchmarks/culvert/run-all.mjs --reuse-long
```

That runs everything except B7-S in about 15 s. B7-S takes about an hour; `--reuse-long` reuses its saved results when
they are newer than its definition, and drop the flag to re-run it. The script writes `results/MANIFEST.json`, which
holds:
- the SHA-256 of every file the benchmarks load (25, followed through imports);
- each benchmark's result, text and time-series files;
- the exit codes and failure counts.

Two consecutive runs gave identical hashes for every result.

Evidence kept read-only, with checksums:
- `results/baseline-2026-11-11/`: round 0, the first B1, B2 and B6;
- `results/round1-2026-11-11/`: round 1 (all six benchmarks, `MANIFEST.json`, and copies of the definitions and the
  translation as they were).

| File | What it is |
|---|---|
| `hds5.mjs` | **The independent reference**, from FHWA HDS-5's published equations: inlet control, full and partly-full outlet control, critical depth and energy, Manning normal depth (clean or silted). Exact geometry; for an ASTM C507 standard elliptical pipe, the standard tabulated geometry (a geometry input; the hydraulics stay independent) |
| `model.mjs` | **One culvert through the production path** (`swmmSection` → `toINP`): one or several lengths (code and entrance loss on the first, exit loss on the last), one or several barrels, a FREE, NORMAL or held outfall. Runs to steady state; optional full time series |
| `swmm-replica.mjs` | SWMM's `culvert.c` inlet equation transcribed. A diagnostic, not a reference |
| `b1-inlet.mjs` | **B1** inlet control, 8 culverts × 13 discharges. Scored |
| `b1-losses.mjs`, `b1-lowflow.mjs` | Diagnostics for B1: loss placement by regime; the low-flow finding under 11 variations |
| `b2-outlet.mjs` | **B2** full-barrel outlet control. Scored |
| `b6-sediment.mjs` | **B6** silted barrels, normal depth. Scored |
| `b6-continuity.mjs` | **B6-C** the continuity error, accounted on its own. A diagnostic |
| `b7-transition.mjs` | **B7** regime transitions, tailwater and discharge sweeps. Scored; time series in `b7-transition-traces.json` |
| `b7-steep.mjs` | **B7-S** the steep-barrel submergence finding: continuous ramps and 1 cm steady sweeps, with timestep and ramp-rate convergence. A diagnostic; time series in `b7-steep-traces.json` |
| `b8-coverage.mjs` | **B8** coverage: several lengths, several barrels, reverse flow, a silted inlet. Scored |
| `b9-edwards.mjs` | **B9** the Edwards Branch crossing from its three records: one conduit against three, both directions. Scored |
| `t2-ellipse.mjs` | **T2** standard against exact ellipse, no inlet control: raw geometry and flow for an independent reference. A diagnostic |
| `regime-flag.mjs` | The proposed flag for the B7-S / S8 regime, evaluated on the saved B7 time series. Not wired into production |

## Stage A closure (11 Nov 2026, after review 3): the decisions applied

Round 3's outputs are frozen in `results/round3-2026-11-11/` (`SHA256SUMS`, read-only). Round 2 is not separately
recoverable: it was overwritten in place (that directory's `NOTE.md`). Nothing below changes a hydraulic parameter,
roughness, runoff, culvert geometry or a tolerance. The Charlotte baseline is untouched, and its generated SWMM input is
byte-identical before and after (default, `nativeSections`, `barrelRuns`, both).

### 1. Invert trust (realNetwork §2)

- **What changed.** The number of records is no longer evidence. Before, a layer's inverts were used only when at
  least max(3, 30 %) of its records carried both. Now one record with a plausible invert is used.
- **Units, per record or layer, in this order:**
  1. the record's own declaration;
  2. the user's `invertUnits`;
  3. the layer's cover evidence: the share of ends with 0.2–15 m of cover in m and in ft. The better is taken if more
     than 60 % are plausible. Metres win a tie, as before.

  When both units are plausible (low ground), metres are taken and every end says the choice is ambiguous.
- **Each end of each record carries its trust** (`prov.invTrust`):
  - accepted, rejected or missing;
  - the units and where they came from;
  - the cover;
  - the reason, including any conflict with a structure record and which value was read.
- **The summary names the units per layer.** `stats.invertUnits`, and `stats.inverts` reads e.g. 'from layer (m, ft)'.
- **Tests:** `tests/run-inverts-tests.mjs` covers:
  - 1, 2, 3 and 5 records;
  - one end missing, and both;
  - a layer with no inverts;
  - an implausible recorded invert, rejected with its cover;
  - drawn (m) and linked (ft) records in one network;
  - a conflicting structure record;
  - the ambiguous low-ground case and the user override.

### 2. Merged-record provenance (T1)

Each merged conduit's `records` now keep, per source record:
- its line, its from and to nodes and its structures;
- its inverts, their provenance and their trust;
- whether it was turned;
- for each joint removed, why it was merged: one length in and one out; no grate, inlet or connection invert; the same
  section, material, n and sediment; the recorded inverts within X m of the floor line (limit Y m).

Tested in `run-xsect-tests.mjs` §8.

### 3. T2: the ellipse rule (a translation change, `swmm-xsect.js`)

**The rule.** A canonical section now has `section.standard`: the product standard the source **names**, never one
inferred from dimensions.

| The source gives | SWMM section | Flag |
|---|---|---|
| ASTM C507 named, and the axes are one of its sizes (within 0.5 in) | `HORIZ_/VERT_ELLIPSE`, size code: **qualified** | the code-9 tables are not an ideal ellipse (full area +3.7 %, part-full area −7 to +7 %); `designation` keeps both the source's standard and the solver section |
| rise and span only | `CUSTOM` exact ellipse | — |
| rise and span only, matching a C507 size | `CUSTOM` exact ellipse | **ambiguous profile**: it may be a C507 pipe, whose real section is the table |
| C507 named, a size it does not have | `CUSTOM` exact ellipse | said; the designation kept |
| C507 named, but metal or plastic | `CUSTOM` exact ellipse | the conflict said; the designation not used |

- **Where `standard` comes from.** A linked layer's shape or material text containing "C507". A drawn feature's
  `standard` property. OSM gives none.
- **The two geometries are not interchangeable.** For 38 × 60 in, the code-9 section's normal depth is −1.6 to −6.4 %
  of the true ellipse's for Q 1–2.5. Its full-barrel friction is −8.6 %. Both are listed under "SWMM against the true
  ellipse" in the table below.
- **Removed:** "material not recorded → taken as an ASTM C507 concrete ellipse". A record with no material now gets the
  exact ellipse, and the ambiguous-profile flag when the size matches.
- **Who sees a change.**
  - No source used today names C507: Charlotte's layer does not, and the Edwards barrel is not a C507 size.
  - So every ellipse a real run writes is the exact one, as it already was for all but code-9-sized pipes.
  - Charlotte's input is byte-identical.

**Benchmark definition revisions (documented, not silent).**
- **B1-4** now names ASTM C507 in its asset. SWMM receives the same section as in rounds 1–3, and the B1 results are
  numerically identical (only names and notes changed).
- **B1-4c** gets the true ellipse by giving rise and span only. It no longer switches size matching off.
- **T2 is now scored:** definition revision 2, criteria revision 1, fixed before the run.
  - The reference is the independent critic's calculation from review 3, preserved unchanged in
    `references/t2-critic/` (`calc.py`, `extra.py`, `out.json`, `out.txt`, `report.md`, `SHA256SUMS`).
  - Three questions are scored separately and never merged:

| Question | What is compared | Criterion | Result |
|---|---|---|---|
| implementation | SWMM against the critic's emulation of the section as written (code-9 tables, or the written curve) | depth ≤ 1 mm, head loss ≤ 0.1 % | **19 / 19 Passed** (both sections, every valid Q) |
| representation, exact section | SWMM against the true ellipse | depth ≤ max(2 mm, 0.5 %), head loss ≤ 1 % | **9 / 9 Passed** (depth +0.08 to +0.15 %, head loss +0.27 to +0.28 %) |
| representation, standard section | SWMM against the true ellipse | none: **Qualified**, the difference reported | depth +3.4 % (Q 0.1) to −6.4 % (Q 2.5); head loss −8.6 % |
| accounting | SWMM continuity error | ≤ 1 % | **13 Failed** (every part-full run, −2.1 to −5.3 %); 6 Passed (full barrel) |

- **Custom Q 2.5 is an invalid setup, not a result, and is excluded from scoring.** It is not uniform flow: the NORMAL
  outfall takes the upper normal-depth root, 0.962 m, inside the section's narrow top. Its raw values are kept.
  (The standard section has no upper root at 2.5, being capped at its full flow, and is scored.)
- **T2-C, the part-full continuity error, is its own finding.** It was unresolved at Stage A closure and is explained
  in the closure pass (`../FINDINGS.md` F3; `t2c-books.mjs`):
  - it is a fixed volume lost while the single 400 m link fills;
  - it shrinks to within ±0.3 % at 32 segments;
  - geometry is ruled out;
  - the registered rows stay Failed.
  - It is −2.1 to −5.3 %, with flow = Q and no drift.
  - It is largest at the smallest flow (−5.3 % at Q 0.1) and in both sections, so it is not the geometry.
  - It is kept beside B6-C as an accounting question. The steady depths are unaffected (implementation rows pass to
    0.1 mm).

### 4. Edwards Branch (decisions applied; no code change was needed)

- **Topology.**
  - The crossing stays three SWMM conduits on the real junctions J373 (a grate) and J121 (a lateral and a grate). T1
    already keeps them.
  - No inflow is moved.
  - B9 keeps both direction scenarios: falling, scored against HDS-5; and as labelled, adverse, representation only.
- **Unsupported above the crown.**
  - With the headwater above the barrel crown, the three-conduit form is 0.36 m low at Q/AD^0.5 4 and 0.20 m low at 5,
    against HDS-5 (B9).
  - This is listed as an unsupported condition (table below). Any result in that regime is not presented as a culvert
    result.
- **Future representations, researched, none implemented.** Each needs its own benchmark before it could be used:
  - (a) one conduit through the barrel, with the grate and lateral as surface or side connections that do not split
    the barrel (SWMM has no side-orifice-into-a-conduit object; it would need an orifice or weir to a node off a
    dummy);
  - (b) the junctions kept, but with SWMM inlet control moved to the barrel's first conduit only and the interior
    nodes' surcharge depth raised (this changes hydraulics: not done);
  - (c) a 2D treatment of the grates over a one-conduit barrel.
- **The Charlotte default topology conflict (documented only; the baseline is frozen).** Without `nativeSections`,
  Charlotte's default network takes the barrel floor from the catch-basin inverts (207.51 and 207.14 m), not the pipe
  records' 205.496 and 205.130 m. The default and the native representations of this crossing therefore differ by about
  2 m of floor. The historical baseline (2026-11-11_001513) was run on the default, and is unchanged.

### 5. B7: the regime flag over time windows (evaluation only)

`b7-window.mjs` → `results/b7-window.json`.
- **Nothing changed:** no routing, no input, no rule, no band. `regime-flag.json`'s single-step results are kept, and
  the script checks it reproduces them (it does).
- **The window rule.** A run is flagged over a window W when at least 50 % of the saved rows (5 s apart) in its last W
  seconds are flagged.
- **The windows:** one step, 30 s, 60 s, 300 s, and the adaptive W = max(60 s, 2 L/V) with V = Q/A_full. For every B7
  case, 2 L/V is under 60 s, so the adaptive window is 60 s throughout.

| Window | flagged, out of band | flagged, in band | not flagged, out of band | not flagged, in band |
|---|---|---|---|---|
| one step (round 3) | 79 | 7 | 4 | 318 |
| 30 s | 81 | 6 | 2 | 319 |
| 60 s (= adaptive) | 81 | 6 | 2 | 319 |
| 300 s | 80 | 6 | 3 | 319 |

**The four single-step misses, examined.** All are steep and SLOT, and HDS-5 is under inlet control in each.
- **Three pipe runs** (Q 2.736 tw 1.37; Q 2.223 tw 1.40; Q 3.25 tw 1.40) **alternate between full and not full.** The
  last step happened to be not full.
  - Over 60 s they are flagged on 50 %, 50 % and 83 % of rows.
  - The window catches two of them only because the threshold is ≥ 50 %. With > 50 %, it catches one.
  - This sensitivity is a finding, not a tuning target: the threshold is not changed.
- **One ellipse run** (Q 19.63, tw 2.64, −0.21 m against a 0.13 m band) **is never full in any row.**
  - It is not the B7-S band (both ends full); its error has another mechanism.
  - No window catches it, and none should under this rule. It stays a documented miss.

**The seven in-band flags, examined.**
- **Five are flagged on every row**, and their errors are large fractions of their bands:
  −0.033 / 0.062, −0.032 / 0.062, −0.176 / 0.215, −0.085 / 0.118 and −0.147 / 0.156 m.
  - They are in the regime. The flag is a regime flag, not an error predictor, so these are correct flags of results
    that happen to land inside the band.
- **Steep SLOT ellipse Q 18.12 is flagged on 33 % of the last 60 s.** The window drops it.
- **Steep EXTRAN ellipse Q 18.12** stays flagged (67 %).

**Uncoded controls (B7-S, no culvert code): 0 flagged at every window.**
- The rest of the condition (both ends full, HDS-5 inlet above outlet) holds on 955 of 7205 rows (SLOT) and 1033 of
  7220 (EXTRAN).
- So the code condition is what excludes them. That is correct: an uncoded barrel has no inlet control to lose.

**Status.**
- The windowed flag is a modest improvement over one step: two more caught, one fewer false alarm.
- Its threshold sits on a knife edge for two runs.
- Recommendation, not implemented: keep the single-step flag as the conservative report, show the 60 s share beside
  it, and do not wire either into production until the coupled benchmarks (Stage C) test it on transient tailwater.

### 6. Supported conditions (updated from round 3 §7; still not frozen)

| Condition | Status | Evidence |
|---|---|---|
| Circle, box and exact (custom) ellipse sections | **Supported** | B1, B2, B8-B; T2 representation 9/9 |
| SWMM's standard ellipse (size code), for a source naming ASTM C507 | **Qualified**: section tables not an ideal ellipse | T2: implementation passes; representation −8.6 % full-barrel friction, −6.4 to +3.4 % normal depth |
| An ellipse of C507 dimensions not named as C507 | **Supported as an exact ellipse, flagged ambiguous** | T2 |
| Recorded inverts, any number of records | **Supported, with per-end trust** | `run-inverts-tests.mjs` |
| Mass balance | **Open qualification** | B6-C −15 m³ fixed term; **T2-C** part-full −2.1 to −5.3 % |
| A barrel kept as several conduits because of a grate or lateral (Edwards) | **Unsupported when its headwater is above the crown** | B9 |
| A coded culvert with both ends full while HDS-5 would still be under inlet control (B7-S, S8) | **Unsupported regime: flag** (single step; the 60 s share reported beside it) | `regime-flag.mjs`, `b7-window.mjs` |

All other rows are as in round 3 §7.

## Round 3 (11 Nov 2026): T1 implemented; Edwards, T2, the regime flag

Your decisions of 11 Nov, in your order. **One translation change (T1), opt-out, with its own tests.** Nothing else in
the translation, the routing defaults or the HDS-5 equations changed. `nativeSections` stays off in production. Nothing
is committed.

### 1. T1: one SWMM conduit per continuous physical barrel

**Where.** `src/network-real.js` `mergeBarrels`, after the native sections are written. The canonical records are not
touched. Switch: `nativeSections.mergeBarrels` (default `true`, in `NATIVE_DEFAULTS`); `false` writes the Stage A
per-record form.

**The aggregation criteria.** A culvert chain (entrance endwall → outfall or stop) is merged across an interior node only
if every one of these holds. Each kept node is recorded with its reason (`stats.native.merge.kept`):

| Kept, and why | Your rule |
|---|---|
| more than one pipe in or out (a lateral or fork) | genuine junction or lateral: preserve |
| an outfall or a domain edge | — |
| another culvert entrance | separate entrance: separate conduits |
| a surface connection (a grate or inlet, a hydraulic inlet, or a recorded connection invert) | a real connection: preserve |
| a change in shape, rise, span, barrels, material, n or sediment | change in section or material: preserve |
| an interior invert off the straight line between the run's ends by more than 0.25 × rise (or a drop at the node) | unknown geometry: not invented |

Twin barrels stay one conduit with `barrels = 2` (as written before); separate barrels with separate inlets stay
separate conduits, since each has its own entrance.

**The merged conduit:** the first record's upstream end and the last record's downstream end, the summed length, the
end inverts, the entrance record's code and Ke, the last record's exit loss. It carries `records`:
`[{ pipe, asset, L, invUp, invDn }]` for every source record, and `prov.merged` says so.

**Tests** (`tests/run-xsect-tests.mjs`, all pass; infra, assets, stormwater, SWMM, inlet-type, outlet, coupler and CSO
suites also pass):
- the two-record test crossing is one 50 m conduit on its end floors, code 30, Ke 0.5, exit 1, both records kept;
  `mergeBarrels: false` reproduces the Stage A two-conduit form;
- **1, 3 and 6 records of one 60 m barrel write the same SWMM input** (nodes, conduit, section, losses, curve, compared
  with names and padding stripped) and give **the same headwater** to 1 mm, at a mild slope (3, 6 m³/s) and a steep one
  (5 %, 15 and 25 m³/s, below and above the crown);
- the section count holds with the merge (`sections − merged + bare = pipes`).
- Found on the way, not a T1 question: a layer needs 3 records with inverts before its inverts are trusted at all;
  a layer of one pipe gets derived inverts. The equivalence test puts a 3-pipe sewer beside the barrel.

**What the merge does on Charlotte's cached records** (scratch probe, read-only): it merges two pure pass-through runs
(J8's chain: C141 + C285, C345 + C52). **It does not merge the Edwards Branch crossing**, under your own rules:
- J373 (between P_39133 and P_11307) has a grate: a surface connection;
- J121 (between P_11307 and P_11292) has a 2 in → 1 out lateral and a grate.

So, as the network writes it today, Edwards stays three conduits. That needs your decision (below).

### 2. B9: the Edwards crossing, SWMM alone

`b9-edwards.mjs`. The three records, 96 × 144 in metal ellipse, 15.594 m; the floor is the straight line between the
two record ends (205.496 and 205.130 m). The catch-basin values (207.14, 207.51 m) are not used.

**Direction is unresolved in the data.** The city's labels put the 205.130 m end upstream (adverse by 0.366 m); the
fall says the other way. Both are run.

| Case | One conduit (T1) | Three records |
|---|---|---|
| Falling, inlet control, Q/AD^0.5 0.5–3 | within 16 mm of HDS-5 | within 16 mm; 0.2–0.3 mm from one conduit |
| Falling, inlet control, 4 (submerged) | +3 mm | **−0.358 m** (−0.361 m against one conduit) |
| Falling, inlet control, 5 | +5 mm | **−0.200 m** (−0.205 m) |
| Falling, full barrel, V 1–3 m/s | head loss within 1.3 mm of HDS-5 | the same, within 0.3 mm of one conduit |
| As labelled (adverse), representation only | — | +16 mm (q 0.5), −2 to −9 mm (1–3), −27 mm (4), **+79 mm (5)** |

The one-conduit form matches HDS-5 everywhere it is scored. The three-record form fails where the headwater is above
the crown, which is the flood case. This is T1 on the real geometry.

### 3. T2: the controlled experiment

`t2-ellipse.mjs` (diagnostic). The 38 × 60 in ellipse, written as SWMM's standard code 9 and as the exact custom curve;
no culvert code, no losses; a 400 m conduit at S 0.004, n 0.013, to a NORMAL outfall (part-full uniform flow), and a
full barrel under a tailwater 0.5 m over the inlet crown (EXTRAN). Raw output in `results/t2-ellipse.json`.

**Reference values were calculated independently by the critic** (review 3), from first principles and from SWMM's
source (xsect.c, xsect.dat, shape.c, link.c). It was given the code, inputs and raw results, not my reading of them.
Its scripts and output are in the session scratchpad (`critic3/`).

| Full section | Area m² | Perimeter m | R m | Q full m³/s |
|---|---|---|---|---|
| True 38 × 60 in ellipse | 1.15529 | 3.95945 | 0.29178 | 2.4726 |
| SWMM standard, code 9 | 1.19845 (+3.74 %) | 4.05771 (+2.48 %) | 0.29535 (+1.22 %) | 2.5863 (+4.60 %; also SWMM's cap) |
| SWMM custom (FloodSim's exact curve) | 1.15410 (−0.10 %) | 3.95842 (−0.03 %) | 0.29156 (−0.08 %) | 2.4692 (−0.14 %) |

- **Part full, standard against the true ellipse:** area −7.1 % at y/D 0.25 and +7.4 % at 0.65; normal depth +3.4 % at
  Q 0.1 and −5.2 % at Q 2.0. **Custom:** area within 0.15 % from y/D 0.10 up (+0.6 % at 0.05, from SWMM's 51-point
  resampling); normal depth within 1.1 mm.
- **Full-barrel friction over 400 m:** standard −8.6 % against the true ellipse; custom +0.31 %.
- **SWMM reproduces its own source exactly for both sections:** normal depths to ≤ 0.1 mm and head loss to 5 digits.
  So routing is not the issue: the difference is the geometry tables alone.
- **The code-9 tables are internally inconsistent.**
  - The width table is a true ellipse to 4 decimals.
  - Integrating the width gives 12.35 ft². The table's full area is 12.90 ft² (the ASTM C507 figure); a true
    38 × 60 in ellipse is 12.435 ft².
  - The area table departs from the integrated width by −10 % at y/D 0.24 and +3.3 % at 0.64.
- **One comparison is invalid:** custom at Q 2.5 m³/s exceeds its full-flow capacity. SWMM's NORMAL outfall then
  takes the upper root (inside the slot), so that row is not uniform flow. The comparison holds for Q ≤ 2.4.
- **"Headwater" here is the inflow node's depth, not its energy,** so the T2 rows are not scored against culvert
  methods (they were not).

**What this settles, and what it does not.**
- T2 is not a routing error and not a translation error. It is SWMM's standard-ellipse data: a full area that matches
  the ASTM pipe, a width that matches a true ellipse, and a part-depth area table that matches neither.
- FloodSim's custom curve is a faithful true ellipse.
- The remaining decision is the source of truth for an ASTM C507 pipe:
  - the published full area (12.9 ft², which only code 9 carries, with inconsistent part-depth tables); or
  - the true ellipse of its axes (consistent, 3.6 % less area).

  The translation is unchanged until you decide.
- **Raised by the critic, not explained:** SWMM reports −2 to −5 % continuity in the T2 part-full runs (steady, flow =
  Q, no drift). It is recorded with B6-C as an accounting question; the steady values look unaffected.

### 4. B7-S: an unsupported regime, and a flag for it

**Documented as unsupported.** In SWMM 5.2.4, a culvert with an inlet-control code whose two conduit ends are both at
or above the crown has no inlet control. Between that point and the tailwater at which HDS-5 hands over to outlet
control, SWMM's headwater is not a hydraulic solution: on a steep barrel it is pinned at the crown (B7-S, 0.34 m low in
the test case); on a mild large ellipse it stays under outlet control (S8, 0.45–0.55 m low). Both are unconservative.
Not fixed by n, geometry or losses.

**The proposed flag** (`regime-flag.mjs`; benchmark side only, not wired into production). From what the coupler can
read at a step (both end depths and the flow):

    flag = code > 0  AND  d1 ≥ D AND d2 ≥ D            (SWMM's own isFull)
           AND  HW_inlet(Q) > d2 + H_full(Q) − S·L + max(0.03 m, 3 %)   (HDS-5 would still be under inlet control)

A flagged step's headwater is outside the supported conditions: FloodSim should report it as such (or restrict the
prediction), not present it as a result.

**Tested on the saved time series** (`results/regime-flag.json`; no new SWMM run):
- **B7, the 408 scored final states:** of the 83 where SWMM is outside B7's error band, the flag catches 79. Of the 325
  inside the band, it flags 7: the mild pipe at TW = D under both methods (−0.03 m), and 5 rows 0.02–0.18 m low (inside
  the band, on the same side).
  - The 4 misses are steep rows where SWMM chatters across the crown: the final 5 s sample happened to be not full.
  - A flag over a window (any flagged step in the last few minutes) would close that gap; not done.
- **B7-S ramps:** every pinned step (both ends full, headwater within 2 cm of the crown) is flagged, in all 14 coded
  runs (every step and ramp rate, SLOT and EXTRAN). This is partly by construction, since the flag's first condition
  is SWMM's isFull; the second condition (HDS-5 still under inlet control) also holds at every one.
- **The uncoded controls:** 0 flagged, as intended (no inlet control to lose).
- **Not tested:** the flag against a coupled run; the margin's size. Both come later.

### 5. Reverse flow: provisionally qualified, not independently validated

The raw errors are kept (`results/b8-coverage.json`, B8-R rows): SWMM is 0.036, 0.052 and 0.075 m low at Q/AD^0.5 1–3,
and −0.033 / +0.045 m at 4–5, against the barrel-profile reference.

**Why 5 %, independently of those results:**
1. **The rule predates B8-R.** B1's band rule (R2-1) gives max(0.05 m, 5 %) to every row whose reference is not an
   HDS-5 inlet-control equation inside its own zone (the transition, and rows where outlet control or the barrel
   governs). B8-R's rows are all barrel-governed, so the rule gives them 5 %. It was not set for them.
2. **The reference is a composite with no reverse-flow basis of its own.** It is the greater of two models (HDS-5 inlet
   control at the reversed end, and a direct-step backwater), and the switch between them is itself uncertain. HDS-5's
   headwall coefficients are applied to an end that is physically an outlet, with no laboratory data for that use.
3. **Its loss is an assumption.** The backwater uses Ke 0.5 at the reversed entrance; SWMM writes Kentry and Kexit by
   position, so in reverse the 1.0 exit loss sits at the reversed entrance. That difference is 0.5 V²/2g, which this
   benchmark does not separate. It is a reason the band could be too narrow, not too wide.

Status: **provisionally qualified, not independently validated.** An independent validation would need reverse-flow
laboratory or field data for a headwall culvert, which this benchmark set does not have.

### 6. B6-C: open qualification

Unchanged and kept visible: a fixed −15 m³ in SWMM's stored-volume term on the 12-length case, about −1 % in a 0.5 h run
and −0.12 % in 4 h. Its origin is located (the stored-volume term) but not established, and it is not yet shown to be
immaterial. Settling both needs per-step mass terms at full precision, from the instrumented build.

### 7. Stage A: supported conditions and known limitations (proposed for the freeze)

**Not frozen.** This is the list a freeze would publish. Two items still need your decision (T2, and the Edwards
catch-basin representation), and T1 needs a review.

| Condition | Status | Evidence |
|---|---|---|
| Circle, box and exact (custom) ellipse sections | **Supported** | B1, B2, B8-B; T2 (custom within 0.15 % of a true ellipse) |
| Sediment, as a cut section | **Supported** | B6, B8-S |
| Several barrels | **Supported** | B8-B |
| A barrel in several records, merged (T1) | **Supported once reviewed** | 1/3/6-record equivalence tests; B9 one conduit within 16 mm of HDS-5 |
| Entrance and exit losses | Supported provisionally | B1-L; the SLOT interaction (+0.16 m worst case) is carried as a bias |
| SWMM's standard ellipse (size codes) | **Investigate: decision needed** | T2: inconsistent part-depth tables, +3.7 % area against a true ellipse |
| Reverse flow | Provisionally qualified, not independently validated | B8-R, 5 % band justified above |
| Mass balance | Open qualification | B6-C −15 m³ fixed term; T2 part-full −2 to −5 % |
| A coded culvert with both ends full while HDS-5 would still be under inlet control (B7-S, S8) | **Unsupported regime: flag, do not present as a result** | B7-S, B7; `regime-flag.mjs` |
| A barrel kept as several conduits because of a catch basin or lateral on it | **Unsupported when its headwater is above the crown** | B9: −0.36 m at Q/AD^0.5 4 |
| Inlet control at low discharge (S1) | Known limitation, about ±0.05 m (box +0.09) | B1, B1-LF |
| Mitered inlets (S3) | Known limitation, +0.15 m at 2 % | B1-6 |
| Full-barrel friction under SLOT (S4) | Known limitation, 3–6 % low | B2 |
| EXTRAN at fixed steps ≤ 0.25 s on steep barrels (S7) | Not supported | B7-S |
| Coupled behaviour (tailwater from the surface, pool head) | Not tested | Stage C |

## Round 2 (11 Nov 2026): what changed

**No change to the translation (`src/swmm-xsect.js`), to any routing default or to the HDS-5 equations.** The changes
are all to the benchmarks:

| # | Change | Why |
|---|---|---|
| R2-1 | **B1 classifies its zones from HDS-5 alone** (its discharge index). The transition (3.5 < q < 4) is now scored, with a wider band, max(0.05 m, 5 %). Where HDS-5's free-tailwater outlet control is outside its validity (HW < 0.75 D), it no longer overrules inlet control | Round 1 picked its "unsubmerged" rows by SWMM's own headwater (HW ≤ 0.95 D). That is selection on the result being judged |
| R2-2 | **B1-4 is referenced on the standard pipe's own geometry**: the published 12.9 ft² area and hydraulic radius, and the standard normalised profiles. Added: **B1-4c**, the same axes drawn as a true ellipse, against a true-ellipse reference | Round 1 gave HDS-5 a true ellipse of the standard area while SWMM had the standard profile: two different sections |
| R2-3 | **B7 scores error size, transient excursion, the held tailwater, energy, mass and the regime threshold**, and keeps every run's full time series | Round 1 scored only steps and oscillation, so a steady 0.5 m error passed |
| R2-4 | New benchmarks: B6-C, B7-S, B8 | Your list |
| R2-5 | Harness, additive only: several lengths and barrels, full traces, headwater min and max. The single-length `.inp` is byte-identical to round 1's, and B2's result file is unchanged | Needed by B7-S and B8 |
| R2-6 | `run-all.mjs` hashes every imported file and the time series. `--reuse-long` reuses B7-S only if its results are newer than its definition and every file it loads | Review 1's reproducibility finding; review 2's stale-result point |
| R2-7 | **After review 2:**<br>- B1's zones come from the nominal discharge index (q = 3.5 had landed on either side of the boundary by rounding, so some culverts got the 5 % band and others 3 %);<br>- B1-4's pool-head diagnostic is back on;<br>- B7-S's header no longer predicts the result it did not get | Review 2 |
| R2-8 | **B8-R's reference:**<br>- the barrel's own direct-step backwater, from critical depth at the free-falling high end, with full-barrel friction from where the profile reaches the crown;<br>- B1's band rule is applied as written: rows where the barrel, not inlet control, governs get the wider band | Review 2: HDS-5's (dc + D)/2 shortcut is not valid for a part-full adverse barrel. **This turns B8-R's three failures into passes**; the sizes are in S5 |

## Status

Findings are grouped by **where they come from**, so a reader can tell an ingestion fault from a translation fault, a
SWMM limitation or a coupling question.

### Translation (FloodSim's inputs to SWMM): decisions needed before Stage A can freeze

| Finding | Evidence | Status |
|---|---|---|
| **T1. A culvert of several records gives a different headwater from the same culvert as one conduit** | B8-M, steady:<br>- **At Q/AD^0.5 = 5:** 1 length matches HDS-5 to 0.1 mm; 3 lengths are −0.269 m and 6 lengths −0.283 m.<br>- **Cause** (corrected after review 2, and checked here): the inlet code makes no difference to the chain (1.717 m with or without it). SWMM surcharges the interior junctions above the crown (1.62–1.75 m deep in a 1.2 m pipe) although the flow should be part full and supercritical (Manning capacity 5.5 m³/s against Q 3.42). That makes the first length full at both ends, and the code goes inert as a consequence. Uncoded, 1 length gives 1.439 m and 3 lengths 1.717 m, so the chain sets its own headwater.<br>- **At low flow:** 6 lengths at Q/AD^0.5 = 1 give 0.611 m (HDS-5 0.609) against 0.554 m for 1 length. The low-flow result (S1) depends on the first conduit's length | **Round 3: decided and implemented** (one conduit per continuous barrel; see Round 3 §1). Edwards is not merged by the rules: a decision remains |
| **T2. SWMM's standard ellipse profile is not self-consistent** | Its area table implies a width up to 1.27 × the span (y/D 0.44), and its area and width tables differ by up to 4.6 % of the full area. B1-4 (standard code) fails irregularly at part depth (−0.045 at q = 1, −0.077 at q = 2, passes at 1.5 and 2.5). B1-4c (true ellipse) is within 11 mm from q = 1 up. **After review 2:** with the pool-head diagnostic back on, B1-4's failing rows (q 0.5, 1, 2) are the rows where SWMM's own equation at its reported pool head gives 11–17 % less than Q. That is S1's signature. So the profile is where S1 shows, not a separate geometry error | **Round 3: investigated** (Round 3 §3: the tables, not routing). Decision on the source of truth remains |
| T3. Silted circle as a cut CUSTOM section; entrance + exit losses | Round 1 (B6, B1-L) | Kept |
| T4. Several barrels | B8-B: 2 barrels at 2Q = 1 barrel at Q to 0.1 mm, inlet and full-barrel outlet control | Closed |
| T5. A silted inlet | B8-S: within 5 mm of HDS-5 applied to the open section from Q/AD^0.5 = 1 up (−0.044 m at 0.5). The reference is an approximation (FHWA's embedded-culvert practice), so the band is 5 % | Qualified |

### SWMM 5.2.4 itself (limitations to document, not to hide)

| Finding | Evidence | Status |
|---|---|---|
| **S1. Inlet control at low discharge** (pipes −0.04 to −0.06 m, the box +0.04 to +0.09 m) | B1 (the box's whole unsubmerged range fails once zones come from HDS-5: round 1 had hidden it). It does not depend on the timestep, the outfall, the damping or the length (B1-LF) | Open. An instrumented build needs the Emscripten SDK; the install was blocked by this session's permission classifier (below) |
| **S2. Inlet control switched off when both conduit ends reach the crown** | B7-S, below: structural, converged, and it sets the headwater at the crown, not at any hydraulic solution | **Critical.** Documented limitation; any treatment is a model change of its own |
| S3. Mitered slope term (−7 S against +0.7 S) | B1-6, +0.151 m at 2 % (6.3 · S · D) | Accepted provisionally |
| S4. SLOT surcharge: full-barrel friction 3–6 % low | B2. In B7 it now also fails the energy check: a full barrel dissipates less than its own losses. B1-5: +0.16 m with both losses | Qualified |
| S5. Reverse flow has no inlet control | B8-R: the code is inert in reverse. Against the corrected reference the barrel's profile governs at every discharge, not inlet control: SWMM is 0.036, 0.052 and 0.075 m low at Q/AD^0.5 1–3 (passes inside the 5 % band, not inside 3 %), and −0.033 / +0.045 m at 4–5. Round 2's first figures (0.10–0.26 m) were against an invalid reference | Documented. SWMM writes Kentry/Kexit by position, so in reverse the 1.0 exit loss sits at the reversed entrance; not separated here |
| S6. Storage accounting: a fixed volume, not a leak | B6-C, below. It is in SWMM's final-stored-volume term; no water is lost | Qualified, explained |
| S7. EXTRAN at small fixed steps is unstable on the steep barrel | B7-S: headwater spikes of 4.6–12.8 m at steps ≤ 0.25 s; the 0.1 s steady sweep gives 9.04 and 5.17 m; 2.1 % continuity | Recorded, not investigated. Production uses SLOT and the variable step; B2 and B8 use EXTRAN at the variable step |
| S8. Mild barrel, large ellipse, high discharge, submerged outlet: SWMM stays under outlet control, 0.45–0.55 m below HDS-5's inlet control | B7 mild Q sweep, EXTRAN and SLOT, steady | Open. Same `isFull` family as S2 |

### Coupling (not tested in this round)

- What tailwater the 2D surface gives a culvert outlet. Today the coupler gives SWMM outfalls none, so S2 cannot yet
  occur in a coupled run. Once it does, S2 will.
- Whether the coupler can supply a pool head (S1). It exchanges flow, not head.

### Ingestion

No new finding. The section-count identity and the three-source test (city layer, OSM, drawer) hold (`tests/run-xsect-tests.mjs`).

## B7-S: the steep-barrel transition, investigated

The case: a 1.2 m concrete pipe, square edge with headwall (code 1), S 0.05, L 30 m, at Q/AD^0.5 = 4. HDS-5's inlet
control is 1.538 m. The tailwater ramps from 0.6 m below the outlet crown to 1.6 m above it and back, and steady runs
step across the crown 1 cm at a time. SWMM's full-barrel condition is inferred from both end depths, which the zero
offsets make equal to the node depths.

**1. The control switch, not the friction.**
- In every run, SWMM leaves inlet control at the tailwater where both conduit ends first reach the crown (TW = 1.20 m).
  HDS-5 hands over to outlet control only at TW 2.47 m.
- After the switch the headwater sits at 1.20 m: the crown itself. It does not depend on the surcharge method (SLOT
  1.20, EXTRAN 1.21), so it is not set by full-barrel friction.
- It is a sliding mode on SWMM's switching surface:
  1. above the crown, both ends are full and inlet control is off;
  2. SWMM's barrel without inlet control passes this flow at about 0.70 m (the uncoded control, steady), so the pool
     falls;
  3. below the crown inlet control returns and pushes it up again.

  The solution is held at the crown. No hydraulic equation sets that level.
- In `dwflow.c`, three things change at once when both ends are full: inlet control off, upstream weighting off
  (`rho` = 1), and inertial terms off (`sigma` = 0). The uncoded control isolates the first: without a code the same
  barrel switches once, cleanly, with no step.

**2. Energy.**
- The pool ends 0.34 m below the head inlet control needs. So the energy grade line is inconsistent at the inlet: the
  barrel passes Q on less energy than its entrance requires.
- Against full-barrel losses it closes under EXTRAN (shortfall ≤ 0.013 m). It does not under SLOT (0.08–0.11 m, the
  slot bias of S4).
- The held tailwater is reproduced exactly (0 mm) above critical depth.

**3. Convergence.**

| Routing step | SLOT: switches up/down | SLOT: largest deficit | EXTRAN: switches up/down | EXTRAN: largest deficit |
|---|---|---|---|---|
| variable (production) | 1131 / 1007 | 0.377 m | 1475 / 1453 | 0.341 m |
| 1 s | 1125 / 1005 | 0.377 m | 1477 / 1453 | 0.341 m |
| 0.5 s | 393 / 467 | 0.351 m | 4505 / 4573 | 0.340 m |
| 0.25 s | 391 / 333 | 0.343 m | 6175 / 8567 | 0.339 m |
| 0.1 s | 15 / 13 | 0.340 m | 1629 / 825 | 0.338 m |

- **The ramp rate makes no difference.** At 1, 0.5 and 0.25 m/h the largest deficit is 0.373–0.378 m (SLOT) and
  0.341 m (EXTRAN).
- **The steady map in 1 cm steps:** the headwater falls 0.33 m between a tailwater of 1.19 and 1.20 m (the crown). It
  does so under both methods and at both the production and the 0.1 s step. The uncoded barrel changes by at most 3 mm
  per centimetre.
- **So the discontinuity is structural and converged:** it is in SWMM's regime formulation.
- **The chatter is numerical:** the number of switches depends on the step and the method, and under EXTRAN it does
  not settle as the step shrinks.

**What it means.** In SWMM, any culvert whose outlet is submerged while its inlet is above the crown loses inlet control
and has its headwater pinned at the crown. That is up to 0.34 m low in this case, and it is unconservative. A coupled
model whose floodplain submerges outlets will produce it. T1 reaches the same full-barrel state another way: a chain's interior junctions surcharge, so the first length is
full without any tailwater.

## B6-C: the continuity error, accounted

Clean 1.2 m pipe, 60 m lengths, S 0.002, Q 0.8 m³/s, conduit offsets 0 to 0.6 m (the node inverts lowered, so the
hydraulics are unchanged):
- **No water is lost.** Inflow and outflow integrated from the API agree with SWMM's own terms to within the report's
  1 m³ rounding. The steady outflow equals the inflow in every row.
- **It is a fixed volume, not a leak.** On 12 lengths, the imbalance is −15 m³ at 0.5, 1, 2 and 4 h, so the
  percentage halves each time the run doubles (−1.07, −0.51, −0.25, −0.12 %).
- **It sits in SWMM's stored-volume term.** SWMM reports 375 m³ stored where inflow − outflow is 360.5 m³, with no
  offsets at all.
- **Offsets add water to the nodes' sumps below the conduits** (the in − out store grows to 370.7 m³ at 0.6 m), but
  SWMM's stored term does not change. So offsets reduce the error and, on 24 lengths at 0.6 m, reverse it (+0.33 %).
- **Review 2 checked the arithmetic.** The units are right. The report's 1 m³ resolution gives about ±1.5 m³ on each
  imbalance, so the 6-length shifts are noise. Water held in the sumps below the conduit inverts (1.2 m² × the offset)
  explains 70–85 % of the offset-dependent part on 12–24 lengths. The fixed −15 m³ is still only located (the
  stored-volume term), not explained. Settling it needs per-step mass terms at full precision.

**The correction.** Round 1 traced the B6 error to conduit offsets. That was wrong. The error is SWMM's stored-volume
accounting, present without offsets. Its percentage depends on the run's length, so B6's 0.5 % mass criterion is a
statement about run length as much as about sediment. B6's scoring is unchanged in this round: it is a definition
change to decide.

## Not done in this round

- **The instrumented SWMM build.** You approved it, isolated and version-pinned. I tried to install the Emscripten SDK
  4.0.10 from github.com/emscripten-core/emsdk into the session scratchpad. This session's auto-mode permission
  classifier blocked it, because it downloads and runs external code. It needs you to allow that command, or to install
  the SDK yourself. The plan, kept apart from `vendor/swmm-wasm`:
  - copy the 5.2.4 solver;
  - log h1, y1, y2, `isFull`, the flow class and `inletControl` at each culvert call;
  - build to `benchmarks/culvert/instrumented/`.
- **B6's mass criterion** given B6-C, and **B7's tolerance on SLOT's energy check**: definition decisions.
- **Checking the real crossings** (slopes, and whether the 2D surface would submerge their outlets) against S2. That
  reads Charlotte's records, so it waits.
- **Freezing Stage A.** Not frozen. Review 2 judged a freeze acceptable with the SWMM limitations written down (they are,
  S1–S8). T1 decides how a crossing is written, which is a translation choice, so it comes first.

## Review 2 (11 Nov 2026)

An agent was given the code, inputs, raw results, traces, references and scoring definitions. It was told not to read
this README or the spec's Stage B sections. It changed no repository file.

**What it verified itself:**
- **The scoring is not tilted toward SWMM.** It diffed against round 1's copies: the translation and four benchmarks
  are byte-identical; B1 now classifies zones from HDS-5; the failures rose from 25 to 37.
- **`STD_HE` is legitimate, not circular:** the same tables SWMM's equation uses, so B1-4 tests the implementation, not
  the tables.
- **B7-S, from the traces:** the switch at TW = D, the pin at the crown until full-barrel control takes over at TW about
  2.5 m (1.73 m against HDS-5's 1.70 m), and convergence with the step and the ramp rate. The mechanism matches
  `dwflow.c` 161–162 and 251–252: neither state is self-consistent, so the solution sits on y1 = yFull. The node-depth
  inference is sound for the regime; the switch counts undercount (isFull is evaluated per iteration).
- **B8-M:** the chain surcharge (taken into T1) and the low-flow length dependence.
- **B8-R:** its own backwater at q 1 gave 1.036 m (now the reference: 1.0355 m).
- **B6-C:** the units, the rounding, the sumps.

| Its finding | Severity | Done |
|---|---|---|
| B8-M is the chain's interior surcharge, not the inlet code | significant | Checked and confirmed here; T1 reworded |
| Decide whether a crossing must be one conduit | significant before coupled tests | T1, your decision |
| Check the real crossings' slopes and outlet submergence | significant before coupled tests | Waits for Charlotte |
| B8-R reference invalid at part full | minor | R2-8 |
| q = 3.5 classified by rounding; B1-4 diagnostic off | minor | R2-7 |
| Promised table-consistency check missing in `hds5.mjs` | minor | Written as a comment with its numbers |
| `--reuse-long` checked only the definition's age | minor | R2-6; B7-S re-run in full |
| B8-S is self-consistency, not validation; its 5 % band hides q 0.5 (−0.044 m) | minor | Agreed; T5 stays qualified |
| The 0.75 D outlet rule's citation is a placeholder; a steep/mild test would not depend on the rule's own output | minor | Not changed; to decide |
| Make B7-S's pin a scored check | minor | Not changed; B7 already scores it (the steep rows fail on error and excursion) |

---

# Round 1 record (kept as written; superseded where round 2 says so)

## Status

| Benchmark | Status | In one line |
|---|---|---|
| B2 outlet control | **Closed, qualified** | EXTRAN: 96 of 96 within 2.3 mm of HDS-5. Production SLOT reads 3–6 % low (slot friction). The pass does not cover SLOT |
| B6 sediment | **Qualified** | The cut box, ellipse and (now) circle are within 1–15 mm of normal depth. SWMM's FILLED_CIRCULAR carries 3–6 % too much flow, so it is no longer the default. Continuity −0.7 to −1.3 % in deep silted chains, traced to conduit offsets |
| B1 inlet control | **Open** | Translation verified (submerged zone to 1 mm, ellipse fixed). Open: the low-flow head (structural), the mitered slope term (accepted provisionally) and SLOT with both losses (+0.16 m) |
| B7 regime transitions | **Open: new finding** | Mild barrel: continuous and steady. Steep barrel with the outlet submerged: SWMM drops inlet control, steps 0.3 m and oscillates (up to 1 m). The large ellipse on a mild barrel reads 0.18–0.55 m low under the wrong control |
| B3–B5 coupled | Not started | Held until B1 and B7 are settled |

## Translation changes in this round (one at a time, each tested)

| # | Change | Why | Test |
|---|---|---|---|
| 1 | **FILLED_CIRCULAR offsets are no longer raised by FloodSim.** SWMM raises them by the fill itself | The invert was at twice the fill: a trickle pooled 0.606 m where it should pool 0.306 m | `run-xsect-tests` effective-invert runs; B6 |
| 2 | **A silted circle is an exact CUSTOM section cut at the fill** (`circleSediment: 'cut'`; `'filled'` keeps SWMM's FILLED_CIRCULAR) | B6, below: the cut section has the more defensible geometry. Continuity is the same either way | `run-xsect-tests`; B6-1 vs B6-1x |
| 3 | **Ellipses:**<br>- a concrete pipe of an ASTM C507 standard size takes SWMM's standard size code (tabulated area and hydraulic radius);<br>- every other ellipse is an exact CUSTOM ellipse;<br>- SWMM's non-standard ellipse (area 1.2692 · minor², up to 5 % allowed before) is no longer written | B1 finding 4. The standard 38 × 60 in pipe is 12.9 ft² (ASTM C507, SWMM's table), 3.7 % more than a true ellipse of those axes. The non-standard formula gave a third value | `run-xsect-tests`; B1-4 (standard), B1-4b (non-standard 40 × 60 in) |

There were no changes to roughness, culvert codes, loss coefficients, loss placement, routing defaults or the HDS-5
reference.

## B1: inlet control

**Translation.** Wherever SWMM evaluates its inlet equation at the pool head, the result matches HDS-5:
- submerged zone (Q/AD^0.5 ≥ 4): within 0–3 mm for codes 1, 6 and 10, the standard ellipse (now exact: it was
  −0.03 to −0.06 m), the non-standard custom ellipse and the 96 × 144 in custom ellipse;
- headwater rises monotonically with discharge in every case;
- a conduit drawn from its low end gives the same headwater.

**Finding 2, mitered inlets (code 5): +0.151 m. Accepted provisionally** as a formulation difference.
- HDS-5's slope term is +0.7 S; SWMM's is −7 S.
- HDS-5 with SWMM's term reproduces SWMM to 1 mm.
- The effect is (7 − 0.7) · S · D: 0.038 m at 0.5 %, 0.076 m at 1 %, 0.151 m at 2 %, 0.38 m at 5 % (all on a 1.2 m
  pipe).
- It is documented, not corrected. No translation workaround.

**Finding 3, unsubmerged inlet at low discharge: open, structural.** `b1-lowflow.mjs` answers your four questions:
- **Timestep:** none. The result is identical at fixed steps of 1, 0.25 and 0.05 s and at the production variable step.
- **Downstream boundary:** none, from FREE, NORMAL or a fixed stage at 0.5 D. A stage at 0.9 D changes the regime (the
  outlet starts to control), not the error.
- **Other SWMM options:** none, from inertial damping (FULL, NONE), normal-flow limiting (SLOPE) or a 100 m barrel.
- **Head consistency:** this is where it lies, and it is two mechanisms.
  - **Pipes at Q/AD^0.5 ≤ 1.** SWMM's pool is below the critical energy the discharge needs (0.353 m against
    E_c 0.421 m). It is also below the head SWMM's own inlet equation needs (0.412 m, which equals HDS-5). So inlet
    control is not what sets the flow: SWMM's dynamic-wave entrance passes the flow at about critical depth plus 4 cm,
    without its velocity head. That creates up to 0.07 m of energy.
  - **The box at Q/AD^0.5 1–2.** The pool is 0.04–0.07 m above the head SWMM's equation needs. SWMM limits the flow at
    a head below its reported pool, consistent with `dwflow.c` handing the culvert routine h1 after `findSurfArea` may
    reset it to the conduit end.

  Confirming exactly which head SWMM uses needs an instrumented SWMM build. The Emscripten SDK is not installed here,
  and installing it is a download that needs your approval.
- **Can the coupler supply the head?** The coupler exchanges flow with the surface by a weir and orifice on the 2D
  water level, so it gives SWMM a discharge, not a head.
  - Inlet control in SWMM then acts on SWMM's own node.
  - The coupler could, in principle, impose the pool head, but only by replacing one of the two controls. That is
    experiment 2's question (B3).
  - Nothing in this round changes that.

**Finding 1, losses: the evidence does not support changing loss placement.** `b1-losses.mjs`, steady rows only:

| Setting | Inlet control (n 15), mean / max error | Outlet control (n 7), EXTRAN mean / max | Outlet control, SLOT mean / max |
|---|---|---|---|
| none | −0.004 / 0.055 | −0.318 / 0.688 | −0.325 / 0.706 |
| entrance only | −0.004 / 0.055 | −0.217 / 0.459 | −0.227 / 0.480 |
| exit only | −0.004 / 0.055 | −0.114 / 0.230 | −0.130 / 0.264 |
| both (current) | −0.004 / 0.055 (EXTRAN), +0.021 / 0.162 (SLOT) | −0.013 / 0.089 | −0.032 / 0.089 |

- **Outlet control:** only "both" is right. Every other setting is short by the missing velocity heads.
- **Inlet control with a free outfall:** the losses make no difference, with one exception: both together under SLOT on
  the large ellipse at Q/AD^0.5 4.5–6 add +0.10 to +0.16 m. Neither loss alone does it, and EXTRAN does not.
- So the B1 "+0.16 m" is a SLOT × losses interaction, not a loss-placement error. Removing either loss would break
  outlet control by 0.11–0.32 m on average.
- Placing losses by regime would need a regime known before the run. These runs show the regime can change during one
  event (B7).

**Recommendation.** Keep "both". Carry the SLOT interaction as a known bias (+0.16 m worst case, large barrels, high
inlet-controlled flow, free outfall). Decide the surcharge method for culvert runs separately, as a production routing
decision, not a culvert input.

## B7: control-regime transitions (new)

**Mild barrel** (S 0.01, L 40 m): no steps and no oscillation.
- **Tailwater sweep:** SWMM follows HDS-5 through the inlet-to-outlet change. The worst point is 0.033 m low, at the
  hand-over. Elsewhere it is within 0.03 m (SLOT −0.01 to −0.02 m from the slot).
- **Discharge sweep at a submerged outlet:**
  - on the pipe: outlet control throughout, within 0.054 m (SLOT bias);
  - on the 96 × 144 in ellipse at Q/AD^0.5 ≥ 4.75: HDS-5 says inlet control governs, but SWMM stays under outlet
    control, 0.18–0.55 m low, smooth and steady.

**Steep barrel** (S 0.05, L 30 m): 74 failures, under both SLOT and EXTRAN.
- At a fixed discharge (Q/AD^0.5 4), the headwater holds at HDS-5's inlet control (1.538 m) until the tailwater reaches
  the outlet crown.
- Then it drops 0.30–0.33 m in one step and oscillates over 0.05–1.0 m in the last 5 min.
- It stays 0.14–0.32 m below inlet control until outlet control truly takes over (tailwater about 2.4 m).
- The discharge sweep at a submerged outlet does the same from Q/AD^0.5 3 up: up to 1.1 m low and oscillating.

**Cause.** In `dwflow.c` inlet control applies only `if (... !isFull)`, and `isFull` means both conduit ends are at or
above the crown. With the inlet submerged and the outlet submerged, SWMM treats the barrel as flowing full and switches
inlet control off. In HDS-5 inlet control can still govern there, because the barrel can run part full with a jump
inside. The switch flips between time steps, hence the oscillation.

This is the regime discontinuity you asked B7 to look for. It matters for the coupled model: a crossing whose outlet the
2D surface submerges (as a flood does) can lose its inlet control in SWMM. Today the coupler gives SWMM outfalls no 2D
tailwater, so the coupled model would not yet see this. That is itself the B4 question.

## B6: sediment

The barrel is a 1,440 m chain of 24 lengths at S 0.002, with the depth read at the middle node minus the fill. The
reference is the Manning normal depth of the open section on exact geometry, with the fill surface as wetted bed.

| Section | 30 % / 60 % / 80 % of the open height | Conveyance error at 80 % |
|---|---|---|
| Silted pipe, cut CUSTOM (default now) | 0 / 0 / −1 mm | −0.14 % |
| Silted pipe, SWMM FILLED_CIRCULAR | +10 / +18 / +31 mm | +3.0 % (+5.6 % at 30 %) |
| Box cut to 1.5 m (RECT_CLOSED) | 0 / −1 / −3 mm | −0.31 % |
| 96 × 144 in ellipse cut at 1.0 m (CUSTOM) | 0 / −1 / −15 mm | −0.92 % |
| Clean controls (pipe, ellipse) | 0 / 0 / −3 mm; +1 / −2 / −29 mm | −0.26 %, −1.53 % |

**Continuity.** It was first attributed to FILLED_CIRCULAR. It is not: the cut circle shows the same −0.9 / −1.3 %.
- A clean pipe with 0.3 m offsets and no sediment gives −1.4 to −2.0 % in a 12-length chain. A clean pipe without
  offsets gives −0.5 %.
- The error grows with the number of offset nodes. It is SWMM's accounting at conduits set above their nodes, which any
  sediment form needs.
- It is carried as a qualification. The steady outflow is exact in every row.

**Method corrections made on the way:**
- **Short chain:** a 720 m chain read the free outfall's drawdown, which biased the clean controls too. Now 1,440 m.
- **Reference capped:** the reference normal depth hit a search cap for silted sections near the crown. It now
  searches only the rising branch of conveyance, and the discharge is found by Manning from the target depth.

## B2: outlet control, closed with a qualification

- **EXTRAN:** all 96 cases are within 2.3 mm of HDS-5's (Ke + Kx + Kf) · V²/2g, in both directions and with all three
  loss settings.
- **SLOT (production):** full-barrel friction reads 4–6 % low (3–6 % in total), because the Preissmann slot widens the
  section.
  - The pass covers EXTRAN only. The SLOT bias stays visible in the results; production defaults are unchanged.
- **Partly full outlet:** within ±0.05 m of HDS-5's approximate h0. Reported, not scored.

## Independent review (11 Nov 2026)

An agent reviewed the code and raw results, not this README's conclusions. It was not allowed to change any file.

**What it checked itself:**
- HDS-5 by hand and with closed-form geometry: B1-1 critical depth and headwater at four discharges, the submerged
  equation (codes 1 and 5), the box, and B2's full barrel. All agree with `hds5.mjs` to 0.1 mm.
- The table coefficients for codes 1, 4, 5, 6, 10 and 30.
- It re-ran B1, B2, B6 and B7 in scratch. The results are byte-identical.
- The baseline's `SHA256SUMS` holds. Between the baseline and now, every HDS-5 value in B1 is unchanged, so the
  reference was not moved toward SWMM.

**What it raised, and what was done:**

| Finding | Severity (its own) | Done |
|---|---|---|
| Submerged-outlet loss of inlet control (B7 steep, B1-L R2) | blocking for coupled work | Agreed. Open item 2 below |
| B7 scores steps and oscillation, not error size, so the mild-ellipse 0.45–0.55 m bias passes | significant | Not changed in this round (it would be a benchmark-definition change). To decide: add an error band |
| SLOT bias: B2-2 at V 3 passes only inside the 5 % band | significant | Agreed. Open item 3 |
| B1 classifies its zones from SWMM's own headwater (`r.d1 <= 0.95 D`), so the transition zone (B1-3 +0.05 to +0.09 m) is never scored | significant | Not changed. To decide: classify from HDS-5 alone and score the transition with a wider band |
| B1-4's reference uses the standard 12.9 ft² with a true-ellipse profile at part depth | minor | To decide: run a custom 38 × 60 side by side |
| Silted-chain continuity, −0.74 to −1.26 %, "unexplained" | — | The clean-pipe-with-offsets control in B6 (above) traces it to offsets. The reviewer had not seen that run, because it is not a scored row. To do: make it a scored control |
| `MANIFEST.json` missed `run-all.mjs` and the imports of `drainage.js` (`ingest.js` among them, which has uncommitted changes) | significant | **Fixed.** The manifest now follows every relative import (25 files). Two runs give identical results |
| `benchmarks/culvert/` is untracked in git | significant | It stays uncommitted until you review it |
| Not yet covered:<br>- multi-length culverts (the code on the entrance length only);<br>- multiple barrels, arch, v-ellipse, groove and bevel codes, a metal box;<br>- unsteady hydrographs;<br>- reverse-flow inlet control;<br>- inlet control on silted barrels | missing | Listed in open item 6 |
| Harness details:<br>- the volIn/volOut tallies are unused;<br>- `normalDepthFilledCircle` is unused;<br>- LENGTHENING_STEP follows the routing step, so the 0.05 s variant also changes lengthening | minor | Noted, not changed |

## Still open, and what each needs

1. **B1 finding 3 (low-flow head).** Needs an instrumented SWMM build (Emscripten SDK, your approval to install) to log
   h1, the flow class and the inlet-control flag at the culvert call. No workaround until then.
2. **B7, the steep barrel with a submerged outlet.** This is SWMM's `isFull` switch. Any treatment, for example a
   FloodSim-side inlet-control limit, would be a model change of its own. It needs your decision and its own benchmark.
3. **SLOT vs EXTRAN for culvert runs.** A production routing decision, not a culvert input. B2, B1-L and B7 hold the
   evidence.
4. **Freeze Stage A.** The translation and benchmark state is fingerprinted in `MANIFEST.json`, but Stage A is not
   declared frozen while B1 and B7 are open.
5. **The review's scoring points:**
   - an error band in B7;
   - B1 zones classified from HDS-5 alone;
   - a custom 38 × 60 control;
   - the offset continuity control scored.

   Each is a change to a benchmark definition, made one at a time with the current results kept.
6. **Coverage still missing before the coupled benchmarks:**
   - multi-length culverts;
   - multiple barrels;
   - arch, v-ellipse, groove and bevel codes;
   - unsteady hydrographs;
   - reverse-flow inlet control;
   - inlet control on silted barrels.
