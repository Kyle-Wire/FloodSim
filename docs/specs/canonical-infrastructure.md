# Canonical infrastructure records and ingestion corrections (10 Nov 2026)

Follows `infrastructure-audit.md`. Scope: ingestion only. No change to the solver, roughness, runoff, calibration or the
SWMM input written by default. No Charlotte runs. Nothing committed.

## 1. Canonical data model (`src/assets.js`)

One record per physical conduit. It holds what the source said, what is missing, and where each value came from.
The canonical vocabulary is solver-independent: `h-ellipse`, not SWMM's `HORIZ_ELLIPSE`.

| Field | Content | Unknown is |
|---|---|---|
| `source` | `{ type: municipal \| drawn \| osm, id, layer }` | `id: null` |
| `role` | `pipe \| culvert`; null for a utility layer, where connectivity decides (endwall to endwall) | `null` |
| `section` | `{ shape, rise, span, barrels }`, m. Shape: `circle`, `h-ellipse`, `v-ellipse`, `ellipse` (orientation not stated), `arch`, `box`. A circle's span is its rise | `null` |
| `material`, `materialText` | class (`concrete`, `metal`, `plastic`, `clay`, `brick`, `iron`) and the source's own words | `null` |
| `roughness` | `{ n }`, only when the source states one | `null` (the solver default applies later, marked `default`) |
| `ends` | `{ up: { node, invert }, dn: { node, invert }, invertUnits }`, in the source's drawn order. `node` is the structure id when the layer has one (Charlotte `US_ASSETID`). Units are `m`, or `resolve` (metres or feet, settled against the lidar as before) | `invert: null` |
| `direction` | always `drawn`: the record never reorders. Orientation is decided in the network and recorded there | — |
| `profile` | `ends` (inverts at both ends, nothing assumed between) or `unknown` | `unknown` |
| `condition` | `{ state: clear \| partial \| blocked \| unknown, blockedShare, sediment }`, a scenario, never a measurement | `unknown` |
| `prov` | per attribute: `record`, `tag` (OSM), `user` (drawer), `inferred` ("Double" → 2 barrels, RCB material → box), `default`, `unknown`; inverts can also be `manhole` (filled from a drawn manhole within 2 m) | — |

Network pipes (`realNetwork`) gain `prov`. Each end's invert is one of: `record` (the layer's value, accepted against
the lidar), `interpolated` (split by an inlet or tee, or a barrel's floor), `bridged` (rule 10), `carried` (from the
other end at the ground slope), `repaired` (rule 3a hump), or `derived` (cover below the lidar ground). It also
records:

- `direction`: `drawn`, `inverts`, `toward the exits`, `restored (drawn)`, or `barrel: …`.
- `size`: `record`, `neighbour` or `median`.
- `shape` and `material`: the canonical provenance.
- `shapeApprox`: what the legacy solver section approximates, for example "h-ellipse as a circle of its rise".
- `n`: `default` when `opts.n` applies.

Nodes in a barrel keep a structure's connection elevation as `connInv`.

`legacySection(asset)` is today's solver mapping as a function: arch → an equal-area rectangle, ellipse → a circle of
its rise, and so on, each with its approximation named. On Charlotte's 4,623 cached pipes it reproduces the legacy
fields exactly. It is the seam where native SWMM shapes go in the next task.

## 2. Data flow: source → canonical → solver

```
 SOURCE                         CANONICAL (new)                 SOLVER INPUT TODAY                         SOLVER
 ─────────────────────────────  ──────────────────────────────  ─────────────────────────────────────────  ─────────────────
 Utility pipe layer (ArcGIS/    pipeRecords → r.asset           r.{h,w,shape,barrels,inverts} ─┐
  GeoJSON, linked.js)            (fromLinked)                                                  │
 Drawer pipe (drawn or file     layerInputs → asset             {h,w,shape,n,inverts} ─────────┼─ realNetwork ─ toINP ─ EPA SWMM 5.2.4
  import, infra.js toLayer)      (fromDrawn 'pipe')                                            │  (+ prov,         (dynamic wave)
 Street-following estimate      — (synthetic, not an asset)     synthNetwork ──────────────────┘   barrelRuns)
 Drawer culvert                 layerInputs → asset             {D·√open, inv, n} ─────────────┐
                                 (fromDrawn 'culvert')                                         ├─ culvertLinks ─ CulvertLinks ─ river.js
 OSM waterway tunnel=culvert    map.js → asset (fromOSM)        {D from tags or class default} ┘                  culvertFlow (circle only)
```

**Where they diverge today.** The same crossing reaches SWMM if it comes from a utility layer or as a drawn *pipe*.
It reaches the simplified circular `culvertFlow` if it comes as a drawn *culvert* or from OSM. Every source now builds
the same canonical record, and the "1.2 m concrete culvert" test shows the three agree on it.

**Intended convergence point.** The solver section is built from the canonical record, `legacySection` now and native
shapes later. Every closed conduit, culverts included, goes to SWMM, where inlet control, outlet control, losses and
reverse flow all come from one engine. `CulvertLinks`/`culvertFlow` then remains only for crossings no network
reaches: an OSM culvert with no pipe layer, outside any SWMM model. It would also be built from the canonical
section. Not done in this task.

## 3. Ingestion corrections made

- **Shape, span, material, asset and structure ids are read** (`detectPipeFields`: `material`, `roughness`, `id`,
  `upNode`, `dnNode`) into the canonical record. The legacy fields the network uses are unchanged.
- **Elliptical and arch survive.** 96 × 144 in stays a horizontal ellipse (7.0 m²). 96 × 336 in stays an arch. The
  legacy circle or rectangle is still what the solver gets, now named as an approximation in `prov.shapeApprox`.
- **Unknowns stay unknown.** Charlotte's `Unknown` shape and material, a missing size and missing inverts are `null`
  and `unknown`. Where the network fills them (circle, neighbour size, `opts.n`, lidar inverts) the pipe's `prov` says so.
- **A file imported into the drawer** keeps an ellipse or arch as `shapeRecorded` and keeps `material`. This sits
  beside the drawer's round/box `shape` field, which the drawer's form still edits.
- **OSM culverts** keep `material`, `height` and their OSM id.
- **Rule 11, barrels (opt-in, `realNetwork(..., { barrelRuns: true })`).** Lengths of one section (shape, rise, span,
  barrels, material) running endwall to endwall, through structures where only they meet, are one crossing. Smaller
  laterals may join along the way.
  - Orientation is decided for the run as a unit: as drawn when every length agrees. A small adverse fall stands. A
    fall of more than `barrelHump` (0.25) of the rise against the drawing means the run was drawn backwards. Mixed
    drawing falls back to the endwall inverts, then to the direction of the exits. Rising intermediate inverts are
    never used.
  - The floor is known at the endwalls (accepted with little cover, as in rule 10). An interior invert more than
    0.25 of the rise above *both* endwalls is a hump: a catch basin entering near the crown, or a placeholder. The
    floor there is interpolated, and the elevation is kept as the node's `connInv`. A falling profile, straight or
    not, is left as recorded.

**On Charlotte's cached records** (synthetic ground 2.5 m over each recorded end, so the layer's inverts are accepted):

| | East endwall S_16703 | S_47917 (DCB) | S_15969 (DCB) | West endwall S_15970 |
|---|---|---|---|---|
| Default (as before) | **outfall**, 205.13 | 207.14 (flow leaves both ways) | 205.50/207.51 | node, 205.50 |
| `barrelRuns` | culvert entrance, 205.13 | floor 205.19, connection 207.14, grate kept | floor 205.42, connection 207.51, grate kept | outfall, 205.50 |

One barrel east to west, 0.37 m adverse as recorded. The rule found 3 other runs in the area (36 in and 15 in storm
runs between endwalls). It interpolated one placeholder hump there (214.58 m between ends at 213.06 and 212.48 m) and
left the falling profiles as recorded. An earlier draft that compared against the straight line between the endwalls
overwrote a real 36 in profile. That is why the test is now "above both endwalls".

## 4. Tests and results

`tests/run-assets-tests.mjs`, 31 checks, all pass. They cover:

- **Field detection:** material, asset id and structure ids are found; size, shape and inverts are detected as before.
- **Round pipes unchanged:** an ordinary round pipe keeps exactly its legacy fields.
- **Shapes survive:** the ellipse keeps 96 × 144 in and 7.0 m², the arch keeps rise and span, and the legacy
  rectangle or circle is named as an approximation. Vertical ellipse, "Double Box" → 2 barrels, and the shape and
  material word tables are checked too.
- **Unknowns stay unknown:** shape, material, size and inverts stay `unknown`. Where the network fills them it says
  so: `neighbour` size, `default` n, `derived` inverts.
- **Same asset, different sources:** a 1.2 m concrete culvert from the utility layer, the drawer and OSM gives the
  same physical key, as does a 48 × 72 in box from the layer and the drawer, and an ellipse imported into the drawer
  matches the layer's. Each keeps its own provenance. A blocked drawn culvert is a user scenario.
- **Provenance through the network:** `inverts` direction, `interpolated` at an inlet split, `carried`, `manhole`.
- **Defaults untouched:** without the barrel rule the old Edwards reading is reproduced (outfalls at both endwalls);
  `barrelRuns: false` equals the default exactly; the canonical record changes nothing the solver gets (same `.inp`
  with and without it).
- **Barrel rule:**
  - one barrel as drawn, with the adverse 0.37 m not turning it round;
  - one outfall and one culvert entrance;
  - the catch-basin elevations do not become the barrel's floor, which lies on the line between the endwalls;
  - the catch basins are kept as connections with their grates and the lateral;
  - a falling run keeps its recorded inverts;
  - a run drawn backwards is turned as a unit.

Full suite: **46 of 46 suites pass** (45 before, plus this one), including `run-infra-tests.mjs` unchanged.

Regression against HEAD (`git archive HEAD src`), on Charlotte's 4,623 cached pipes, 341 endwalls/FES and 3,475
inlets: `pipeRecords` legacy fields are identical, and the network and `.inp` are byte-identical (with and without
endwalls and inlets). The script is `regress.mjs` in the session scratchpad. It reads `.cache/`, which is not in git.
The app loads in the browser with no console errors.

## 5. Unresolved design decisions (first round; see §7 for what the review decided)

1. **Invert source detail.** Charlotte's structures say "submeter GPS" vs "record drawing, not verified", but that is
   in StormStructures, not on the pipe. Should the importer join structure records to pipe ends by `US_ASSETID` /
   `DS_ASSETID` to get `surveyed` vs `record drawing`? The ids are now kept, so the join is possible. Until then every
   layer value is `record`.
2. **Confidence.** There is provenance, but no confidence grade. Grading needs (1). Is a grade wanted, or is
   provenance alone enough for the report?
3. **`barrelHump` = 0.25 of the rise**, used both for "drawn backwards" and for "hump". It is a judgement and has no
   source. Edwards passes it by a wide margin (humps of 0.7–0.8 of the rise, adverse 0.15). Should it be exposed per
   project?
4. **What a barrel is.** "Same shape, rise, span, barrels and material, endwall to endwall" needs placed endwalls
   (`outfalls`). A culvert whose endwalls are not in the outfall layer is not found. Should a degree-1 end in a
   stream cell count as an endwall?
5. **Material → roughness.** Material is read but not used. A table (concrete 0.013, corrugated metal about 0.024,
   smooth plastic 0.011) would change roughness, which was out of scope. Charlotte's "Metal or Steel" does not say
   corrugated.
6. **Sediment.** `condition.sediment` exists, but nothing fills or uses it. Per the review, sediment profile, open
   geometry, roughness and entrance loss stay separate parameters when it is built.
7. **Drawer shape field.** The drawer's form still offers only round and box. An imported ellipse keeps
   `shapeRecorded`, but the form neither shows nor edits it.
8. **Roles.** A utility-layer pipe has `role: null`. Should the barrel rule set `role: culvert` on the canonical
   record, or keep role a network-only fact?

## 6. Backward-compatibility risks

- **Additive fields:** `asset` on pipe and culvert records, `prov` on network pipes, `connInv` on barrel nodes (opt-in
  only), and `stats.barrels`/`barrelEnds`/`adverseBarrels` (opt-in only). Anything that serializes a network
  (checkpoints, exports, the report) carries more data. Nothing reads them yet.
- `q.fill` is now `'neighbour'`/`'median'` instead of `true`. It is only read as `!!q.fill` (`filledSize`).
- `detectPipeFields` returns five more keys. A layer with a column literally named `n`, `roughness` or `manning` is
  now read as roughness into the canonical record only.
- `toLayer` adds `shapeRecorded`, `W` (for ellipse and arch) and `material` to imported drawer features. Saved
  drawer layers grow, and `layerInputs` ignores the new properties.
- `src/ingest.js` keeps `material`, `height` and `id` on OSM culverts, which changes the in-memory OSM object, not
  the cache.
- Not changed: `dist/floodsim.html` (not rebuilt), METHODS (rule 11 to be added on review), and the default
  behaviour of every run.

**Latent issue seen, then fixed in §7.1:** `realNetwork`'s `splitAt` checks the upstream end first (`best.at < reuse`). On a
pipe shorter than twice the reuse distance (20 m), an inlet at the *downstream* end can join the upstream end instead.
At Edwards Branch the grates land correctly. In a short synthetic test they did not.

## 7. Hardening pass (10 Nov 2026, second round)

Decisions taken from review: join structure records by id, keeping every value. Split barrel direction from hump
detection, and stop using inverts as the deciding evidence. A missing endwall lowers the grade instead of hiding the
run. Material → roughness stays deferred. `barrelRuns` stays off by default.

### 7.1 Short-pipe inlet attachment (a bug fix that changes defaults)

`splitAt` now reuses the *nearer* end within 10 m. It used to check the upstream end first, so on a pipe under 20 m
an inlet near the downstream end joined the upstream manhole. **On Charlotte's cached records, 41 of 402 grates
(10.2 %) move to a different manhole.** The SWMM input is unchanged, because grates set only where surface water
enters. Runs will differ. `realNetwork(..., { legacyInletReuse: true })` reproduces the old attachment exactly (checked
against HEAD on Charlotte: inlets and `.inp` identical). The app does not pass that option yet. Before C2–C5, either
rerun the corrected extended baseline (211.35 m) with the fix, or wire the option into the project. Tests:
`run-infra-tests.mjs` has three new checks (downstream end, upstream end, legacy).

### 7.2 Structure records joined by id (`assets.js`: `structureRecords`, `joinStructures`)

- **The structure layer is read** as `{ id, type, class, invert, rim, source, method, notes }`. `class` is endwall,
  inlet, manhole or other. `method` is surveyed, record, estimated or unstated, from `DATA_SOURCE`.
- **Each pipe end that names a structure** (`US_ASSETID` / `DS_ASSETID`) gains:
  - `structure`: the record it names;
  - `evidence`: every value found, with its source and method;
  - `resolved`: the chosen value, its source, and the rule that chose it;
  - `conflict`.
- **Nothing is overwritten.** The inputs are not modified; a frozen-input test proves it.
- **What counts as a conflict depends on the structure type.** An endwall has one pipe, so its invert must equal
  that pipe's. A manhole or inlet invert is its lowest point, so a pipe may enter above it (`enters 0.9 above the
  manhole's invert`) but not below it.
- **Precedence on a conflict** is `surveyed > record > unstated > estimated`, and configurable. A pipe layer rarely
  says how its inverts were obtained, so its values are `unstated`. A tie keeps the pipe layer's value.
- **App:** `loadLinked` collects structure records from the linked point layers and joins them. It reports the
  matched ends and conflicts in the layer notes. Only the canonical record changes. The legacy fields, and so
  default runs, do not.
- **Charlotte (cached):** 3,816 structures (3,005 surveyed, 441 record, 370 estimated). 6,710 pipe ends matched, 760
  ids absent from the structure layer, 181 conflicts (155 at inlets, 26 at endwalls). The largest are pipe ends 7–25
  ft below an inlet's recorded invert, which are data errors worth showing in the report.
- **Caution:** `DATA_SOURCE` may describe how a structure's *position* was captured, not its invert. A submeter GPS
  fix does not measure an invert. `method` repeats the source's words, and the docs should not call such a value
  "surveyed invert" without that caveat.

### 7.3 Barrel rule, rebuilt (still opt-in)

**Discovery and grade.** Runs of one section through nodes where exactly two such lengths meet are candidates when
they have:

- **`high`:** an endwall at both ends (a placed outfall, or an endwall/FES structure record).
- **`medium`:** a source that calls it a culvert anywhere in its text (Charlotte: "single metal culvert").
- **`low`:** one endwall and a dead end where the other should be. Reported only, never changed.

A plain sewer run with neither is not a candidate. Junctions of three equal lengths end every run, and a change of
section ends it. A second record with the same ends and section is flagged ("twin barrels drawn as two records, or one
pipe recorded twice"), never merged.

**Direction, for `high` and `medium` only.** The evidence:

| Evidence | What it says |
|---|---|
| Source | Each length's own from → to (drawn order, matching its US/DS ids) |
| Connectivity | The end nearer the network's exits is downstream |
| Terrain | Lidar ground at the two ends differs by more than 0.2 m |
| Inverts | The endwall floors differ by more than 0.25 of the rise; supporting only |

- The source direction stands unless connectivity or terrain contradicts it *and* the inverts agree with them, with
  nothing supporting the source. Then the run is turned round, confidence `low`, and flagged.
- A single contradiction keeps the source direction, at confidence `medium`, flagged.
- Mixed drawing falls to connectivity, then terrain, then inverts.
- The inverts never decide alone.

**Interior profile, for `high` only.** Each interior node is classed:

| Class | Evidence | Effect |
|---|---|---|
| `connection` | The invert stands more than 0.25 of the rise above *both* endwall floors, and the node is an inlet (a grate, an inlet structure record, or notes saying it enters the culvert) | The high ends come down to the line between the floors; the recorded value is kept as `connInv` |
| `possible connection` | Elevation alone | Reported; geometry left as recorded |
| `structure on the barrel` | An inlet with a plausible floor | Kept |
| `floor` | Neither | Kept |

A node with no invert at all is put on the line, as rule 10 does. A node where only one end lacks an invert is
carried as before. Medium and low runs never have their interior changed.

Every candidate is returned in `net.barrels` with its grade, basis, direction evidence and confidence, interior
classes and flags.

**On Charlotte's cached records:** 13 candidates (4 high, 6 medium, 3 low). The only geometry changed is Edwards
Branch: its two DCBs are `connection`s, so 4 ends come down to the floor line, and connections 207.14 / 207.51 m are
kept. The rest:

- The 214.58 m hump that the first draft interpolated is now `possible connection`, left as recorded.
- The 36 in run's catch basins are `structure on the barrel`, kept.
- An 8-length run called a culvert, with missing interior inverts, is oriented but its interior is not filled.
- Two pairs of identical "culvert" records near −80.7723, 35.2035 are flagged as twins.

At Edwards the regression ground says the terrain disagrees with the drawn direction. That is an artifact of the
synthetic ground, which sits 2.5 m over the recorded inverts, so the higher west invert has the higher ground. On the
real lidar the east approach is higher (207.33 vs 206.96 m), which agrees with the drawn direction.

### 7.4 Adversarial tests (`tests/run-assets-tests.mjs`, sections 1–11; 52 checks in the file, all pass)

These run on ground that falls the way the creeks run, with Charlotte-style records and structures joined by id:

1. **A genuine adverse barrel**, 0.37 m adverse, with two DCBs. Graded high, oriented as drawn with high
   confidence, the adverse fall not voting. The catch basins are connections from their structure records alone,
   with no grates placed.
2. **A hump at manholes with no inlet:** `possible connection`, flagged, left as recorded.
3. **A falling non-linear barrel through a CB and a DI:** its recorded floor stands.
4. **A missing endwall:** graded low, reported, and the network is identical to `barrelRuns` off. A named culvert
   with no endwalls is graded medium and oriented.
5. **Adjacent 48 and 60 in culverts:** two candidates, never merged; the shared node keeps its invert.
6. **A junction of three equal lengths:** three single-length candidates; the junction invert is unchanged.
7. **Direction:**
   - drawn against both the terrain and the inverts: turned, confidence low;
   - against the terrain only: kept, confidence medium, flagged;
   - lengths drawn both ways: oriented by the terrain, not by the inverts.
8. **Conflicting records:**
   - an endwall 0.3 m apart from its GPS record: both values kept, the surveyed one chosen, marked;
   - pipes entering a catch basin below its invert: conflicts;
   - the barrel uses the chosen floor and says so;
   - the structure records are unchanged;
   - agreeing records give no conflict;
   - a pipe entering a manhole above its floor gives no conflict.
9. **Frozen source and structure records** go through the join and the network build untouched.
10. **A plain sewer:** no candidate, same network.
11. **Limits on what gets changed:**
    - a medium run's interior is not filled;
    - a possible connection with one end missing is carried, not put on the line;
    - duplicate records are flagged as twins.

The short pipe with an inlet at either end is in `run-infra-tests.mjs` (§7.1).

**Full suite:** 46 of 46 suites pass.

### 7.5 Decisions still open

1. **Legacy inlet attachment for baselines.** Rerun the corrected extended baseline with the fix, or add
   `legacyInletReuse` to the project file so that old runs reproduce?
2. **Precedence.** `record > unstated` means a structure's record-drawing invert beats the pipe layer's in a
   conflict, although a pipe layer usually copied its value from those same drawings. A tie is arguably the honest
   answer. Should `record` and `unstated` share a rank?
3. **`barrelHump` 0.25 of the rise and `barrelTerrainTol` 0.2 m** are still judgements. They now gate a
   classification and need structure evidence before any geometry changes. Both are options. Should a project be
   able to set them?
4. **Medium grade from text.** "Culvert" anywhere in a record's text is taken as the source naming it. A field that
   says "not a culvert" would match. Should this be limited to chosen fields (NOTES, TYPE)?
5. **Low grade** needs a dead end. A culvert whose missing endwall sits where another pipe joins is not found. Is
   that acceptable, or should a change of section next to an endwall also count?
6. **Report.** `net.barrels` and the join's conflicts are returned but not shown anywhere. The H&H Report drawer is
   the obvious place.
