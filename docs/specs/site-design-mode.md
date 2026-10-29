# Site design mode: proposed buildings, grading and stormwater, compared against existing conditions

Status: phases 1–3 built (`src/design.js`, `src/compare.js`, `src/stormwater.js`, the Site design and Compare
drawers; `npm run test:design`, `test:compare`, `test:stormwater`, GPU browser suite); phase 4 built too: the emulator
(`src/emulator.js`) and window reruns (`src/window.js`, Compare → Run both in a window / Check the window). Not yet:
drawn pipes and storage in a scenario (the network is still estimated on the proposed model). Written against main at
`bd26a32`.

## Goal

An engineer draws a proposed development on a built FloodSim model: buildings with foundation pads, driveways and
parking, grading, and the stormwater system that serves them. FloodSim turns the drawing into edits to the 1 m DEM and
the other fine layers, runs the same storm on the existing and proposed conditions, and reports what changed: depths,
water levels, runoff leaving the site, peak flows at the outlets, buildings that flood, and off-site impacts.

The comparison is the product. Every number in it must come from two solver runs that differ only in the design.

## How the model is built today (what this plugs into)

- `src/terrain.js` `buildFine()` makes the 1 m fine layers from 3DEP bare-earth lidar, OSM, NLCD and SSURGO:
  `z, bld, bldH, road, cls, manning, infil, perv, hsg, ga {K, thetaE, depth, …}, tauC, texture, grains, bedrock,
  collapse, swell`. The lidar is bare earth, so `z` under existing buildings is already interpolated ground.
- Buildings are walls. `coarsen()` makes a solver cell a wall when more than half of it is building. The subgrid speed
  mode treats buildings as porosity instead. Either way, `fine.bld` is the input.
- Roof rain: `roofRouting()` spreads each building blob's roof rain over the open cells around it. `roofConnections()`
  sends a share to the nearest manhole. Both work per blob of wall cells, with no building id.
- The infrastructure drawer (`src/infra.js`, `app/infra-ui.js`) keeps a lon/lat GeoJSON FeatureCollection in SI units:
  - pipes, culverts, manholes, inlets (with `blocked`), outfalls;
  - underground storage;
  - walls, berms and deployable barriers (barriers are crests on solver faces: `src/barriers.js` `barrierFaces()`).
- Green infrastructure (`src/gi.js`) is area shares of permeable pavement and rain gardens per solver cell. It is not
  drawn.
- Projects (`app/projects.js`) save `project.json` and `infrastructure.geojson`. Each saved run goes in
  `runs/<stamp>/` with `summary.json` and `max_depth.asc` / `max_speed.asc`.
- Nothing compares two runs yet. There is no emulator yet.

## 1. Design layer and scenarios

- A scenario is the existing-conditions model plus an ordered list of design features. Each feature is a lon/lat
  GeoJSON feature, like the infrastructure layer.
- Store each scenario in the project folder:
  - `scenarios/<name>/design.geojson`;
  - `scenarios/<name>/scenario.json`, holding the presets used and every resolved value (each building's computed
    FFE and pad elevation). An old scenario must not change when a preset default changes later.
- "Existing conditions" is the scenario with no features. It is always present.
- `applyDesign(fine, design) → { fine, log }` is a pure function in a new `src/design.js`:
  - It never mutates the baseline arrays. It copies only the layers it changes.
  - `log` lists, per feature: the cells changed, cut and fill volumes, impervious area added or removed, and any
    warnings.
  - Everything downstream (`coarsen` or subgrid tables, roof routing, GI, network, banks, sediment) then runs on the
    edited fine model exactly as it does now. Nothing is fetched again.
- Hash the edited fine grids. A design with no features must give a bit-identical model and run to the baseline (this
  is a test).

## 2. Buildings

A polygon with these properties:

- `preset`: a building type (table below).
- `foundation`: `slab`, `crawlspace`, `basement` or `piers`.
- `ffe`: finished floor elevation. Either `auto` or a fixed elevation in m NAVD88.
- `height`: for the 3D export.
- `roof`: where roof water goes:
  - `ground` (splash to the ground around it);
  - `network` (to a drawn node, or the nearest within 30 m);
  - `cistern` (capacity m³ and drawdown, then overflow to the ground);
  - `green` (retains `GI.greenRoofRetention`).
- `demolish`: true marks an existing OSM building to remove. Clear `bld` in its footprint; `z` is already ground.

### Finished floor and pad

- **HAG**: the highest existing grade along the footprint perimeter, from the baseline DEM.
- **Reveal**: foundation height above finished grade. Default 0.15 m (6 in), after IRC R404.1.6.
- **FFE (auto)** = the highest of:
  - HAG + reveal;
  - BFE + freeboard, when the user gives a BFE. There is no FEMA flood-zone data in the app yet, so BFE is a user
    input per building or per scenario. Default freeboard 0.3 m (1 ft), configurable to the local ordinance or
    ASCE 24;
  - a fixed minimum set by the user.
- **Finished grade at the foundation** = FFE − reveal.
- **Apron**: the ground falls away from the building. Default 0.15 m in the first 3 m (6 in in 10 ft, IRC R401.3 /
  IBC 1804.4). Paved sides use 2%.
- **Optional "balance cut and fill"**: search the pad elevation, at or above the FFE minimums, that minimises |cut −
  fill|. It's a 1-D search over a cheap function.
- **Flooded check**: report a building as flooded when the max water surface along its perimeter exceeds FFE, or exceeds
  the lowest opening for a basement.

### Effect on the fine layers

**Inside the footprint**

| Layer | Value |
|---|---|
| `bld` | 1 (`piers`: 0, so flow passes under the building) |
| `bldH` | `height` |
| `z` | pad elevation |
| `perv`, `infil` | 0 |
| `ga.K` | 0 |
| `cls` | 24 (developed, high intensity) |
| erodible sediment, `tauC` | none (non-erodible) |
| `collapse` / `swell` | cleared; carried in the log as "building on collapsible soil" |

**Apron and graded areas**

- Compacted lawn. HSG drops one group (A→B, B→C, C→D), a common post-construction assumption. GA params follow the
  new group.
- Sediment: graded soil is erodible and keeps the native texture.
- Fill: placed fill uses `URBAN_FILL_RATE`.

**Roof routing**

`roofRouting` needs a building id per blob, so each new building's `roof` setting applies to its own roof. Map blobs to
building ids by cell membership.

### Building presets

All presets are editable defaults. Every one shows "confirm against local code".

| Preset | Foundation | FFE (auto) | Apron | Roof | Height |
|---|---|---|---|---|---|
| Single-family | slab | HAG + 0.15 m, or BFE + freeboard | 3 m falling 0.15 m | ground (downspouts to lawn) | 7.5 m |
| Townhouse / multifamily | slab | same | 3 m; 2% on paved sides | network | 12 m |
| Commercial / retail | slab | same | 1.5 m at 2% (entrances ≤ 2% cross slope) | network (internal drains) | 6 m |
| Warehouse / industrial | slab | same; dock side at truck court + 1.2 m | 2% | network | 10 m |
| Parking garage | slab | same | 2% | network | per levels |
| Elevated | piers | lowest member ≥ BFE + freeboard | none | ground at the drip line | 9 m |
| Accessory / shed | slab | HAG + 0.1 m | none | ground | 3 m |

- Elevated buildings ignore pier blockage. Say so in the log.

### Paved areas

Polygon types `driveway`, `parking`, `sidewalk`, `road`:

- `road = 1`, `perv = 0`, `infil = 0`.
- Manning n 0.014 (asphalt) or 0.013 (concrete).
- Optional cross slope or crown, curb height (reuse the curb burn in `buildFine`), and a target elevation surface.

## 3. Grading engine (one core for pads, aprons, ponds and swales)

Every grading feature defines a target surface T over its footprint:

- **Pad**: flat at the pad elevation.
- **Apron**: T falls with distance from the building.
- **Plane**: three spot elevations.
- **Swale or channel**: a line with an invert profile, bottom width and side slopes.
- **Pond**: bottom elevation, side slopes, top elevation.

Outside the footprint, the surface daylights to existing grade:

```
z' = T                                                  inside the footprint
z' = clamp(z, T_e − d / S_fill, T_e + d / S_cut)        outside, within reach
```

- `d` = distance to the footprint edge.
- `T_e` = T at the nearest footprint point. Use an exact Euclidean distance transform with a feature (nearest-point)
  transform.
- `S_fill`, `S_cut` = horizontal-to-vertical ratios. Default 3:1 fill and 2:1 cut, editable.
- Features apply in list order, so later features override earlier ones where they overlap.

Report:

- **Cut and fill**: Σ max(0, z − z′)·A and Σ max(0, z′ − z)·A.
- **Floodplain fill**: fill placed below the baseline run's max water surface, or below a user BFE. Cut below that level
  is reported too, as compensatory storage.
- **Warnings**:
  - fill into an open water body (the `water` mask used by `src/waterlevels.js`);
  - grading within 20 m of a bank (re-run `findBanks` on z′);
  - slopes steeper than 2:1.

## 4. Stormwater in the design

Reuse the infrastructure types (pipe, culvert, manhole, inlet, outfall, storage). In a scenario they live in the design
layer, added to the baseline layer for that scenario only. Never re-estimate the baseline street network for the
proposed run: proposed network = baseline layer + design features.

New features:

- **Detention / retention pond**: a pond grading feature plus an outlet structure. The outlet is a riser with orifices
  at set stages, an overflow weir and an emergency spillway weir, discharging to a pipe, an outfall or a downstream
  cell.
  - The pond stores water on the 2D grid in the graded DEM. Stage–storage comes from z′; don't enter it separately.
  - The outlet is a surface-to-network or surface-to-surface link, like the existing culvert links, with the outlet's
    composite rating.
  - Report peak stage, freeboard to the spillway, and peak outflow.
- **Bioretention / rain garden**, drawn: ponding depth, media depth and porosity, media rate, and an underdrain to a
  node or none. Use the existing GI store kernel (GI / GS buffers) with the drawn cells' shares at 100%, instead of an
  area-wide share.
- **Permeable pavement**, drawn: the same kernel with the pavement values from `GI`.
- **Swale**: a grading feature with its own Manning n.
- **Downspout connection**: a line from a building to a node. It overrides that building's `roof` routing.

## 5. Tracking changes: paired runs against a cached baseline

### Forcing fingerprint

Hash everything that is not the design:

- storm (depth, duration, distribution, or the historic event and its rain source);
- river inflow, tide and surge, start water levels (the gauge readings used);
- antecedent soil moisture and water table;
- grid size and speed mode, solver settings, run length;
- sediment, debris and bank options;
- app commit.

Two runs compare only when their fingerprints match. Otherwise the compare panel refuses and names the difference.

### Baseline cache

- Run existing conditions once per fingerprint and keep its outputs.
- Each proposed design iteration then costs one run.
- Changing the storm invalidates the cache. Changing the design does not.

### Outputs every run keeps (exact per step where practical)

- **Grids, at 1 m** (binary `.f32` plus a header; `.asc` for export only): max depth, max water surface, max speed,
  max depth×speed, time of first wetting (> 0.05 m), time above 0.15 m, final depth.
- **Control lines**, drawn by the user (property line, site outlets, a culvert, a street):
  - Faces come from `barrierFaces()`.
  - Each step, accumulate the flux across the faces on the GPU (q·Δt per line). This gives an exact volume and a
    hydrograph sampled every frame. A control line around the whole domain must equal the edge outflow books; that is a
    test.
- **Water-level points**: a water-surface hydrograph at each point, every new and existing building included (its
  perimeter max).
- **Books**: rain, infiltration, runoff leaving through each boundary segment and each control line, network outfall
  volume, peak storage in each pond and tank.

### Comparison products

- **Δ maps (proposed − existing)**: max depth, max water surface, duration, arrival time, hazard class.
  - Below a no-change band, show "no change". Default band 3 mm (0.01 ft).
  - First measure the noise floor by running the baseline twice. The solver's atomics are order-independent maxes and
    tile lists, so a rerun should give Δ = 0 exactly; verify.
- **Newly wet and newly dry cells**, at a depth threshold (default 0.15 m).
- **Site boundary** polygon (a new feature): splits every result into on-site and off-site.
  - Adverse impact: off-site cells with Δ water surface above the band.
  - Report their count, area, largest rise, and the buildings among them.
- **Building table**: every building near the site, existing and new.
  - Columns: max water surface before and after, FFE, flooded before / after.
  - Existing buildings use HAG + reveal as an estimated FFE, marked as estimated.
- **Outlet table**, per control line: peak flow, volume and time to peak, pre vs post.
- **Return-period sweep**: queue runs of both scenarios over the design storms (e.g. 2, 10, 25, 100-yr). Fill in the
  standard detention check: post-development peak ≤ pre-development peak at each outlet, per return period.
- **Totals**: Δ impervious area, Δ runoff volume, Δ infiltration, cut and fill, floodplain fill and compensatory cut.

### Saving and versioning

- `runs/<stamp>/summary.json` gains `scenario`, `designHash`, `forcingHash` and `commit`.
- The compare panel lists the runs that share a forcing hash and lets the user pick two.
- Export a comparison package: Δ grids (`.asc` / GeoTIFF), the tables as CSV, and a one-page summary.

## 6. The emulator's role (later, per the standing priority)

- An emulator trained on the first run cannot do the second. It has learnt how this terrain responds to this storm.
  A new pad, pond or pipe is outside anything it has seen, so it would mostly return the baseline map. It can't stand
  in for the proposed run in a before/after comparison that someone will sign.
- **What the baseline run is for**: context and a reference. It is not a substitute for the proposed run.
- **How an emulator does help**: as a fast screening tool once there is a design space to explore.
  - Train it on solver runs of the same site with the design varied: pad elevations, pond volume and outlet size,
    impervious share, pipe sizes, across the design storms.
  - Make it predict the change from baseline. Inputs are the design-change rasters (Δz, Δimpervious, storage,
    connections) plus the baseline run's outputs. Outputs are Δ fields and outlet hydrographs.
  - Learning only the difference keeps it small and accurate near the trained range.
  - Every emulator result shows an in-range check. The chosen design is always confirmed with a solver run before it
    goes in a report.
- **A speed-up that is exact and needs no learning**: rerun only a window. Run the proposed design on a window around
  the site and downstream reach, with boundary flows and stages taken from the baseline run along the window edge each
  step.
  - This is valid while the design does not change the flow at the window edge.
  - Check it after the run: Δ at the edge below the band. If it fails, widen the window and rerun.
  - This is later work. It needs baseline edge time series recorded every step.

## Phasing

1. **Design layer, buildings, paved areas, grading engine, cut/fill.**
   - Proposed DEM, hillshade and 3D view.
   - Scenario save and load.
   - No comparison yet.
2. **Comparison.**
   - Fingerprint, baseline cache, binary output grids, control lines (GPU flux accumulation), water-level points.
   - Δ maps, building table, site boundary and adverse-impact check, outlet table.
3. **Stormwater design.**
   - Ponds with outlet structures, drawn bioretention and permeable pavement, swales, downspout connections.
   - Return-period sweep and detention check.
4. **Later.** Window reruns, then the emulator.

## Tests (match the existing suites)

Node: a new `tests/run-design-tests.mjs` with `npm run test:design`.

- A pad on a tilted plane:
  - flat at its elevation;
  - the daylight slopes are exactly 3:1 and 2:1;
  - cut and fill match the analytic frustum volumes.
- The apron falls 0.15 m in 3 m.
- `applyDesign` leaves every baseline array unchanged. No features gives identical grids.
- FFE auto rule: the HAG case, the BFE case and the balanced case.
- Demolish clears `bld` and leaves `z`.
- Layer updates: impervious footprint, HSG shift on graded lawn, collapse flag carried to the log.
- Floodplain fill: a pad in a flat pond of known level gives fill = footprint × depth.

GPU browser suite (`tests/gpu-browser.html`; Node's GPU runner currently crashes on this machine's driver):

- A control line across a channel matches the outflow books.
- A control line around the domain matches the edge outflow.
- Rerunning the baseline gives Δ = 0.
- A pond with one orifice matches level-pool (modified Puls) routing done in JS on the same stage–storage.
- A new building in a sheet flow shows a rise upstream and a shadow downstream. Its roof rain arrives at its own
  outlet node.

App check: a real site with a single-family lot and a commercial pad with a pond, compared at the 10-yr and 100-yr
storms. Read the outlet table and the adverse-impact numbers by eye.
