# FloodSim

Browser-native 2D urban flood model. Draw an area anywhere in the US, and FloodSim builds a 1 m model from open data,
runs the GPU shallow water solver on it with live depths on a satellite basemap, and exports a 3D package for Unreal.

```bash
npm install
npm start                        # → http://localhost:8766  (static files + cached open-data proxy)
```

## Status

Phase 1 is closed and **Gate B passed** for the published tests: on the UK Environment Agency 2D benchmarks
(Néelz & Pender 2013) 88 of 94 measures fall inside the spread of the established packages, and every probe series in
Tests 1, 2, 4 and 5 sits inside the envelope of seven independently run codes (HEC-RAS, LISFLOOD-FP ×3, TELEMAC-2D,
ANUGA). Test 7 (1D river ↔ 2D floodplains, the first Phase 2 capability) scores 18 of 22. Tests 8A/8B need data the
EA supplies on request. Details, deviations and how to reproduce: [`benchmarks/ea/README.md`](benchmarks/ea/README.md).

**Phase 2 (urban physics) is under way:** rivers, culverts, channel conditioning, storage and green infrastructure
are in (below). **Gate C prep** ([`benchmarks/gatec/README.md`](benchmarks/gatec/README.md)): the combined mass balance
closes on four sites with every exchange model on (surface ≤ 6e-6, combined ≤ 0.26 %, the residual being SWMM's own
continuity); FloodSim matches four HEC-RAS 2D runs on EA Tests 1, 2, 4, 5 to a median 0.1–0.8 cm and HEC-RAS's
rain-on-a-plane case to 1.2 %. The storm-sewer comparison needs HEC-RAS installed.

## Working in the app: infrastructure drawer and projects

**Infrastructure drawer** (map button *Infrastructure*; `app/infra-ui.js`, `src/infra.js`). Draw, import or estimate
pipes, culverts, manholes, catch basins, outfalls and underground storage. The drawer shows US (in, ft) or SI units;
the layer is stored as lon/lat GeoJSON in metres.
- **Draw.** Pipe ends snap to structures, and an end with no structure gets a manhole. Drag a structure to move it;
  attached pipe ends follow.
- **Import.** GeoJSON, zipped shapefiles, or `.shp` + `.dbf` + `.prj`. Projected data is reprojected with proj4. The
  feature type is guessed from geometry and file name; sizes and inverts come from the attribute names, as for linked
  layers.
- **Estimate.** Turns the street-following network (or linked pipes) into editable features, with sizes and inverts.
- **Build precedence.** Pipes in the layer replace linked and synthetic pipes (tier 1, through the same builder as
  linked pipes). Catch basins and outfalls in the layer replace utility ones. A manhole invert fills a missing pipe
  invert at that end. A placed outfall ends the network there, or continues off-site if marked so.
- **Culverts** become surface-to-surface links with their own inverts and roughness.
- **Blocked by debris.** Catch basins and culverts take a blockage (clear, 25 / 50 / 75 %, fully blocked). A blocked
  grate takes water through its open share only (a fully blocked one is a sealed lid); a blocked culvert flows as a
  clear barrel of the same open area (a fully blocked one passes nothing). Blocked features are drawn brown.
- **Storage.** Capacity is footprint × depth × void ratio, with presets for vault, chambers, pipe gallery, crates and
  stone. Each unit becomes a SWMM storage unit joined to the nearest manhole by a connection pipe, so it fills when the
  network surcharges and drains back afterwards. `npm run test:infra` covers this, including a SWMM run.

**Site design** (map button *Site design*; `src/design.js`, `app/design-ui.js`; phase 1 of
[`docs/specs/site-design-mode.md`](docs/specs/site-design-mode.md)). Draw a proposed development on a built model;
FloodSim turns it into edits to the 1 m layers and runs it through the same pipeline, with nothing fetched again.
- **Scenarios.** *Existing conditions* is always there and has no features. A scenario is an ordered list of features
  over it (lon/lat GeoJSON, SI units, ft or m in the drawer). Drawing on existing conditions starts one. Later features
  override earlier ones where they overlap. `applyDesign(fine, design)` is pure: it never writes the baseline arrays
  and copies only the layers it changes. No features gives the baseline model itself, so the run is bit-identical.
- **Buildings** with presets (single-family, townhouse / multifamily, commercial, warehouse, parking garage, elevated
  on piers, shed): foundation, finished floor (FFE), apron, roof and height. Every preset value is copied onto the
  feature, so a later change to a default never changes a saved scenario. Confirm them against the local code.
  - FFE (auto) is the highest of HAG + reveal (0.15 m, IRC R404.1.6), BFE + freeboard (1 ft default; the BFE is a user
    input, per building or per scenario) and a fixed minimum. Warehouses also take truck court + 1.2 m. *Balance* lifts
    the pad to where cut equals fill, never below that minimum. *Fixed* takes a given FFE and warns if it is low.
  - HAG is the highest existing grade on the ring of cells around the footprint. Finished grade at the foundation
    (the pad) is FFE − reveal. The apron falls 0.15 m in the first 3 m (IRC R401.3), 2 % on paved sides.
  - In the footprint: a wall (`bld` 1, its own building id), impervious, no infiltration, NLCD 24, not erodible,
    collapse and swell flags cleared (and reported). Piers: flow passes under, and the ground is left as it is.
  - Roofs: to the ground, to the network (the manhole chosen, else the nearest within 30 m, else the ground), to a
    cistern (holds capacity / roof area, then overflows; no drawdown during the storm) or a green roof (holds 25 mm).
    Roof routing works per building id, so each new roof follows its own setting; mapped buildings keep the slider.
- **Pads** (flat, a plane through three spot elevations, or flat where cut and fill balance), **paved areas**
  (driveway, parking, sidewalk, road: impervious, n 0.014 asphalt / 0.013 concrete, optional target elevation with a
  cross slope or crown, optional curb) and **demolish** (click a mapped building; the lidar under it is bare earth).
- **Grading engine.** A feature sets a target T over its footprint. Outside it the ground daylights to existing grade,
  z′ = clamp(z, Tₑ − d/S_fill, Tₑ + d/S_cut). d is the distance to the footprint edge and Tₑ the target at the nearest
  footprint point, from an exact Euclidean distance transform with the nearest point (Felzenszwalb & Huttenlocher).
  Slopes default to 3:1 fill and 2:1 cut; 0 means a vertical edge (a retaining wall). Graded ground becomes compacted
  lawn: one hydrologic group down (A→B, B→C, C→D), with Green-Ampt for the new group. Placed fill takes the
  compacted-fill rate. The native texture is kept (erodible), and the depth to bedrock and the water table moves with
  the ground.
- **Log** (drawer and `summary.json`). Per feature and in total: cells changed, cut and fill, impervious area added
  and removed, and floodplain fill below the existing-conditions run's max water surface or the BFE (cut below it is
  reported as compensatory storage). Warnings flag fill into open water, slopes steeper than 2:1, grading within 20 m
  of a bank top (`findBanks` re-run on z′) and buildings on collapsible or expansive soil. After a scenario run, each
  new building is reported flooded or dry: the max water surface around it against its FFE (the lowest opening for
  a basement).
- **On the map.** The proposed hillshade, a cut (red) / fill (blue) overlay, and the building layer without
  demolitions. The 3D package exports the proposed DEM with the new buildings.
- **Saved** in the project folder as `scenarios/<name>/design.geojson` plus `scenario.json`. The JSON holds the
  settings, the presets used and every resolved value (each building's HAG, FFE and pad, cut and fill). Opening a
  project keeps each building's saved FFE and pad until that building is edited.
- **Stormwater** (drawer row *Pond*, *Outlet*, *Swale*, *Rain garden*, *Permeable*, *Downspout*; `src/stormwater.js`):
  - **Pond**: the outline is the top of the bank (by default the lowest ground around it, where it would spill). The
    inside slopes (3:1) run down to a flat bottom (1.5 m below by default). An optional permanent pool makes a wet pond:
    runs start with it full. Its stage–storage comes from the graded 1 m ground and is not entered separately.
  - **Outlet structure**: a line from the riser in the pond to where it discharges.
    - The structure has up to two orifices (a 6 in one at the bottom or the pool by default; part-full flow on the
      flowing depth, continuous at the crown), a riser crest as overflow weir (18 in below the bank top, 3.8 m of
      crest) and an emergency spillway (6 in below the top, 10 ft). Weirs use Villemonte submergence.
    - The outlet runs as a link from the pond's lowest cell near the riser to a ground cell at its end, to a manhole of
      the SWMM network (its water goes in as lateral inflow), or off the model. Links measure what they remove and
      deliver exactly that, as the culverts do.
    - Each run reports, per outlet, the peak stage, the freeboard to the spillway crest and the peak outflow (orifices,
      riser and spillway shares).
  - **Swale**: a channel cut along a line, with an invert profile (default: the ground at the ends less the depth),
    bottom width, side slopes and its own Manning's n.
  - **Rain garden (bioretention)**: a depression of the ponding depth over engineered media. It uses the solver's GI
    store kernel at 100 % on the drawn cells: media rate, media depth × porosity as the store, a drain to the native
    soil, and an optional underdrain at its own rate to a manhole.
  - **Permeable pavement**: paved, with all rain through the area-wide pavement store (200 mm at 1000 mm/hr).
  - **Downspout**: a line from a building (new or mapped) to a manhole. The building's roof drains there, overriding its
    roof setting (a mapped building gets its own id for the roof routing).
  - The street-network estimate is still rebuilt on the proposed model; drawn pipes in a scenario are not supported
    yet.
- `npm run test:design`: the distance transform against brute force; a pad on a tilted plane is flat and daylights at
  exactly 3:1 and 2:1; cut and fill match the analytic frustum volumes (within 0.3 %); the apron; the FFE rules (HAG,
  BFE, balanced); demolish; the layer updates; floodplain fill = footprint × depth in a pond; no features → the same
  model and bit-identical solver inputs; roof routing per building id.

**Comparing runs** (map button *Compare*; `src/compare.js`, `app/compare-ui.js`; phase 2 of the site-design spec).
Two runs compare only when they differ in nothing but the design.
- **Forcing fingerprint.** Every run hashes everything that is not the design:
  - the storm (hyetograph, or the historic event and its rain source), river inflow, tide and surge;
  - the gauge readings used for start levels, antecedent soil moisture and the water table;
  - grid size and speed mode, solver settings, run length;
  - sediment, debris and bank options;
  - drainage, green-infrastructure and calibration settings, the infrastructure layer, the area;
  - the app commit (`/api/version`).
  The compare panel refuses two runs with different fingerprints and names the parts that differ.
- **Repeatable runs.** Steps are cut only at multiples of 10 s of simulated time and at the storm's own stop times, never
  at a wall-clock time. Green roofs, cisterns and the tide switch on those quanta. The speed setting only decides how
  far to step per frame. Rerunning a run therefore gives Δ = 0 exactly: in the app, two existing-conditions runs of a
  Meyerland block gave 0 differing cells, and the GPU suite checks it, whatever the batch size.
- **Baseline cache.** Each finished existing-conditions run is kept per fingerprint (this session).
  *Run both* runs existing conditions, unless a run with the same fingerprint is cached, and then the active scenario.
  Both use the same gauge readings, at full speed. A new storm misses the cache; a design change does not.
- **1 m grids per run**, kept in memory and saved in the run folder as `grids/<name>.f32` (float32, little-endian,
  row 0 north) plus an ESRI `.hdr`:
  - max depth, max water surface, max speed and max depth × speed;
  - first wetting (deeper than 5 cm), time above 15 cm, final depth;
  - the worst ARR hazard class.
  Peak speed and first wetting are new every-step GPU products (`hzRecord`), and match the CPU solver.
- **Control lines** (Site design → *Control line*, shared by all scenarios):
  - Faces come from `barrierFaces()`. Kernel `lineFlux` books the volume across each face every stage, both ways and
    compensated, exactly as `edgeOut` books the domain edge.
  - + is water crossing to the right of the line as drawn, or outward for a closed line.
  - Each line's cumulative volumes are sampled every 10 s, giving its hydrograph.
  - Checks: a line across a channel equals the downstream storage plus the edge outflow to 9e-9. A ring around the
    domain equals the edge outflow plus what the outer ring holds to 1e-9.
- **Site boundary** (Site design → *Site*) splits results into on-site and off-site.
- **Compare panel:**
  - Δ maps (after − before) of max water surface, max depth, time above 15 cm, first wetting and hazard class, with a
    no-change band (3 mm; 1 min for times). There is also a newly wet / newly dry map at 15 cm.
  - Off-site adverse impact: cells and area with a higher max water surface, the largest rise, newly wet cells and the
    existing buildings among them.
  - Building table: every building within 100 m of the site. New buildings carry their FFE (the lowest opening for a
    basement); existing ones an FFE estimated as HAG + 6 in, marked est. Each shows the max water surface around it
    before and after, and flooded before / after.
  - Outlet table per control line: peak outflow, net volume and time to peak, pre vs post, with the post ≤ pre check.
  - Totals: Δ runoff off the edge and to the outfalls, Δ infiltration, Δ impervious, cut / fill, floodplain fill.
- **Return-period sweep and the detention check** (Compare → *Return-period sweep*): paired runs over the design storms
  (2, 10, 25, 100-yr by default, editable), one after another in the page. Existing conditions comes from the cache
  when it already ran with the same forcing. *Cancel* stops the run in progress at once. The table gives, per return
  period and control line, the pre- and post-development peak outflow and the check post ≤ pre. Per pond outlet it
  gives the peak stage, freeboard and peak outflow. Both download as CSV.
- **Export:** a zip with the Δ grids (`.asc` + `.prj`), newly wet / dry, `buildings.csv`, `control_lines.csv`, the
  hydrographs, `comparison.json` and a one-page `summary.html`. With a project open, it is also saved under
  `comparisons/`.
- `summary.json` of every saved run gains `scenario`, `designHash` (the grid hash of the model it ran), `forcingHash`
  with the per-part `forcing` hashes, `commit`, the books and the control lines. The compare panel lists the project's
  saved runs (`/api/projects/runs`) next to this session's runs.
- `npm run test:stormwater` covers:
  - the outlet rating (orifice regimes, weirs, submergence, a composite that never steps back);
  - stage–storage and modified Puls (vs an exponential and a Torricelli drawdown, to 3e-5 m);
  - the pond (3:1 sides, storage = the truncated pyramid), swale, rain garden, permeable pavement and outlet defaults;
  - downspouts on new and mapped buildings, the outlet links' books, and the detention check.
- `npm run test:compare` covers:
  - the fingerprint (stable, names the difference, ignores the design);
  - the `.f32` grids, Δ with the band, newly wet / dry, the off-site impact;
  - the building and outlet tables, control-line faces and their signs, the CSV and the summary page.

**H&H report** (map button *Report*; `src/report.js`, `app/report-ui.js`). The standard plots and tables of a drainage
or flood submittal, for one run or for a before / after pair with the same forcing fingerprint (as in Compare). It lists
this session's runs and the project's saved runs.
- **Hydrographs:**
  - each control line: flow out across it, before dashed and after solid;
  - each storm-sewer outfall: SWMM inflow at the outfall node, every 10 s;
  - a table of peak, time to peak and volume.
- **Detention ponds:**
  - stage–storage (from the graded ground) and stage–discharge (from the outlet rating, free outfall), as two panels
    with stage on y, and the stage–storage–discharge table with the orifice, riser-weir and spillway parts;
  - stage in time against the riser crest, spillway and top of bank;
  - outflow in time; a one-run report adds inflow, worked out as outflow + change in storage;
  - peak stage, freeboard to the spillway and peak outflow.
- **Storm sewer HGL:**
  - a profile from a manhole (by default the one with the least freeboard; pick another in the list or click it on the
    map, where manholes show by their check) down to its outfall: rim, crown and invert of each pipe, and the max HGL
    before and after;
  - a manhole table with rim, max HGL, freeboard and flooded volume. Checks: ✕ floods (HGL above the rim), ! low
    freeboard (under the setting, default 1 ft), surcharged (above the crown of the pipe leaving it);
  - a pipe table with max flow, max depth / D and max velocity;
  - from new per-run books: the coupler keeps each node's max head and time, time surcharged and flooded volume, and
    each pipe's peaks, at every 2 s exchange.
- **Water surface profiles:** along each profile line (Site design → *Profile*):
  - the ground (before and after), max water surface and depth every 1 m;
  - marks for the finished floors of buildings within 5 m (existing ones estimated);
  - a table at stations about every 25 ft.
- **Gutter spread:**
  - per inlet: from the grate (at the curb) across the street toward the nearest mapped centreline, to where the max
    depth falls under 3 mm. Water reaching the far curb is reported as the street full;
  - also the gutter depth, and the intercepted peak and volume;
  - checked against an allowable spread (default 8 ft), with map markers and a bar chart of the widest.
- **Detention check over the design storms:** from Compare's return-period sweep (this session): pre vs post peak at
  each control line by return period, with a chart per line, and the pond outlets by storm.
- **FEMA flood zones:** see below.
- **Summary:** the water balance, before / after.
- **Export:** a zip, also saved under `reports/`, holding:
  - `report.html` (header with the runs, storm, fingerprint and commit; a methods note per section; prints to PDF);
  - every figure as SVG and PNG, and every table as CSV.
  Charts are plain SVG with one y axis each and direct labels; the colours are the validated reference palette (blue
  after, orange dashed before).
- **Each saved run** now also holds `network.json` (nodes with rim and invert, pipes with end inverts), `hgl.json`,
  `inlets.json` (with spread), pond stage / outflow series every 10 s in `summary.json`, and `grids/ground.f32` for a
  scenario's designed ground.
- `npm run test:report` covers:
  - series peaks and volumes;
  - a profile through a flat lake;
  - the HGL path and its flags;
  - stage–storage–discharge against hand values;
  - spread on a crowned street (2.75 m vs T = d / Sx = 3 m, at 1 m cells), and the street-full case;
  - the charts and the CSV.
- On the Meyerland design project (25-yr, existing vs proposed), the report's control-line peaks match Compare's
  (49.61 → 41.27 cfs). At that storm most of its streets are full from curb to curb.

**Flooded areas, building damage, EAD and benefit–cost** (Report drawer; `src/areas.js`, `src/damage.js`,
`app/report-areas.js`, `app/report-damage.js`). Three report sections, for one run or a before / after pair:
- **Flooded areas:** the peak depth split into connected areas (15 cm by default; 5, 30 or 60 cm in the drawer),
  ranked by the water they held. Per area:
  - size, peak volume, max and mean depth, and the area in each depth band;
  - first arrival and the longest time over 15 cm;
  - peak speed and depth × velocity, and the worst ARR hazard class;
  - the streets through it (OSM names) with the length deeper than 30 cm;
  - the buildings touching it, the NSI structures with water above the floor, the people there at night, the damage;
  - the share of the water still there at the end, and whether it touches the model edge.
  
  A map figure rings and labels each area, with a bar chart of volumes and CSV tables.
- **Building damage:**
  - **Structures:** the USACE National Structure Inventory (fetched per area): occupancy, foundation, values, people.
  - **Curves:** USACE depth–damage functions per occupancy type, vendored from USACE go-consequences (MIT;
    `tools/build-damage-curves.mjs` regenerates `src/damage-curves.js`). They are EGM 01-03 / 04-01 for
    single-family homes and HEC-FIA for the rest.
  - **Water against a building:** the peak level on the open cells next to its OSM footprint, so a rowhouse sees its
    own front and back, not its neighbour's. Only water at least 10 cm deep counts (set in the drawer), and only in a
    patch that reaches a street or covers 200 m².
  - **First floor:** the median ground there plus the NSI foundation height.
  - **Band:** every curve at its 10th and 90th percentile together.
- **Expected annual damage:**
  - **Runs used:** the project's saved runs of the same scenario, design and settings (the forcing fingerprint less
    the storm) at Atlas 14 return periods of the same duration. A batch study of return periods fills it in.
  - **Integral:** trapezoids over AEP. Damage falls to zero at AEP 1 when the most frequent storm already does
    damage, and the tail beyond the rarest storm is held at its damage. Both are flagged when they matter.
  - **Benefit–cost:** with a pair, the drawer's cost, O&M, real discount rate (default 3 %) and period (default
    50 years) give the present values, net benefits and the BCR.

Why the two exposure filters: on the South Philadelphia test block (10-yr 1-h), counting any water at a wall
(0.5 cm) booked $101 M of damage to 528 of 700 structures. Thin sheet flow next to a house with a basement takes
the basement curve, and rain ponds in 568 enclosed rowhouse yards that have yard drains the model lacks. With both
filters, water reaches 47 structures, 13 have it above the first floor, and damage is $6.3 M. The yard ponds are
listed in the table but not counted.
Damage is buildings only: no vehicles, displacement, emergency costs or life safety.

**Flood maps and streets** (Report drawer; `src/maps.js`, `app/report-maps.js`). Two more report sections:
- **Flood maps** (right after the summary): peak depth, the worst hazard class (H1–H6), when the water arrived and
  how long it stayed over 15 cm, from the 1 m grids with buildings grey. A before / after pair adds the change in
  peak depth. A table gives the area in each depth band and hazard class.
- **Streets and access:** each mapped street sampled along its centreline. Per street: its length over 15 cm (only
  emergency and high vehicles get through) and over 30 cm (most cars float or stall), the deepest point, when the
  water arrived, the longest any point stayed over 15 cm, and the top speed. A bar chart shows the streets with the
  most length over 30 cm.

**Model checks and sensitivity** (Report drawer; `src/checks.js`, `app/report-checks.js`). Two report sections that say
how far to trust a run:
- **Model checks:** one table of what a reviewer would test, each marked OK, Check, Problem or Not tested, with the
  result and what it means. Thresholds are `LIMITS` in `src/checks.js`.
  - **Model edge:** the share of the flooding within 50 m of the edge, and the length of the edge flooded at the
    area threshold, by side (a bar chart). The edge is a free outfall, so a flood against it may continue past it.
    Distance to the edge is a chamfer distance, so a polygon area's edge counts too.
  - **Water out across the edge,** as a share of the rain and inflow.
  - **Inflow:** the ground outside that drains in (from the traced watershed), and a river entering from a large
    basin with or without an inflow.
  - **Books:** the surface and the surface-plus-sewer mass balance.
  - **Run length:** the water still standing at the end as a share of the peak, and the time run after the rain.
  - **Near the edge:** high-water marks and drawn features (the scenario's and the analysis lines) within 50 m.
- **Sensitivity:** the project's saved batch-study runs of the same storm, scenario and design with one input
  changed (roughness ± 20 %, infiltration × 0.5, rain + 10 %, one cell size coarser), each against the base run over
  the cells flooded in either:
  - the fit (flooded in both over flooded in either);
  - the mean, mean absolute and 95th-percentile change in peak depth, and the largest rise and fall;
  - the changes in flooded area, volume, damage and buildings with water above the floor;
  - the elasticities (the relative change in a result over the relative change in the input);
  - a map of the depth change for each variant: red deeper, blue shallower, grey within 3 cm.

  The cell-size variant is the grid-convergence test: below a fit of 0.9, or with 95 % of depths moving more than
  5 cm, the checks table flags it. Plan the variants in the Batch drawer.
On the South Street test block (2 m cells, 10-yr 1-h, the base and four variants run headless as one batch), the
first try found a bug. Every variant showed 37–39 % less damage than the base, rain + 10 % included. One $2.2 M
apartment building hung on one gutter cell: 12 cm peak in the base, 4.5 cm with more rain, 10.6 cm final depth in
both. The cause: coarser than 1 m, the peak and final grids are each downscaled on their own, interpolating the level
over the wet neighbours only, so a neighbour with a film at its peak pulled the cell's peak below its final depth. The
peak is now never below the end, and with the exchange-spike fix (Batch studies above) the same study reads:

| Variant | Flooded area | Fit | 95 % of depths within | Damage | Elasticity (area, damage) |
|---|---|---|---|---|---|
| Rain + 10 % | +13.6 % | 0.86 | 3.7 cm | +1.7 % | 1.36, 0.17 |
| Infiltration × 0.5 | +1.3 % | 0.98 | 0.5 cm | +0.6 % | −0.03, −0.01 |
| Roughness × 1.2 | −0.3 % | 0.98 | 0.4 cm | −0.5 % | −0.02, −0.02 |
| 4 m instead of 2 m | +33 % | 0.41 | 32 cm | −20 % | – |

Damage is $6.27 M with water above the first floor at 13 structures. The grid test fails, and the checks table says
so: on rowhouse blocks with 3–4 m alleys a 4 m (or 2 m) cell does not resolve the flow paths, which is why 1 m is the
default. The model edge check flags 46 % of the flooding within 50 m of the edge, and 8 ha of ground draining in from
outside (36 % of the area).

**FEMA flood zones and base flood elevations** (Data & assumptions → *FEMA flood zones and BFE lines*; `src/fema.js`).
Build reads FEMA's National Flood Hazard Layer for the area:
- **The data:** flood zones (S_FLD_HAZ_AR), the BFE lines (S_BFE) and the cross-sections with their regulatory water
  surface (S_XS). NGVD29 elevations are shifted to NAVD88 by NOAA NCAT at the site; feet become metres.
- **On the map:** the 1 % floodplain in blue (floodway darker), the 0.2 % X zone in orange, and the BFE lines labelled in
  feet. The build log gives the share of the area in each zone and the BFE range.
- **BFE at a point:**
  - AE: interpolated between the two nearest BFE lines or cross-sections of different elevation, inversely to distance
    (linear between two bracketing lines);
  - AH and VE: the zone's own BFE; AO: the ground plus the zone's depth;
  - A zones have no published BFE, and the app says so.
- **In the design:** a building with no BFE of its own (and none in the scenario's settings) takes FEMA's highest BFE over
  its footprint, so its auto finished floor is at least BFE + freeboard. FEMA's BFE also sets the level for floodplain
  fill. A saved floor below the minimum this now gives is warned about. On the Meyerland test project both proposed
  buildings' saved floors (54.73 and 53.19 ft) are below FEMA's BFE there (55.04 and 54.99 ft): the drawer flags them.
- **In the Report:** the area by zone, and each new building's zone, BFE, floor and floor above the BFE against the
  freeboard; profiles draw the BFE along the line.
- Check the effective FIRM and any LOMR before relying on it. `npm run test:fema` (`--live`: Meyerland, zone AE, BFE
  55.0 ft, through the local server).

**NEXRAD radar overlay** (View → *NEXRAD radar*; `src/radar.js`). The US composite base reflectivity from the Iowa
Environmental Mesonet, as map tiles every 5 minutes: N0Q (0.5 dBZ steps) from 15 November 2010, N0R (5 dBZ) back to
1995. Display only: the model's rainfall still comes from the Storm section.
- **This historic storm:** the frames of the loaded event's window, listed from IEM (`json/radar.py`), so archive gaps
  show as gaps. Before a run it opens on the storm's peak block; during a run it follows the simulation clock (event
  start + run time). A frame more than 15 min from the time asked for is not shown.
- **Live, last hour:** the latest 5-minute frames, refreshed every 5 minutes.
- **Rain the model uses (MRMS, 2 min):** for a radar storm (historic or live), not reflectivity but the rain itself in
  mm/hr, one picture per 2-minute block: solid over the model, the exact frames the run puts on its cells
  (gauge-corrected where the archive has them; past the latest frame of a live run, the nowcast, marked NOWCAST); faint
  around it for half a degree, the raw 2-minute radar (a2m) at the same time, so the storm can be watched coming in.
  It sits under the flood depths, follows the run clock, and the next three blocks load ahead.
- A slider steps through the frames and ▶ loops them; the next frame loads unseen, so stepping does not flash. The
  overlay sits over the basemap and under every model layer.
- Ellicott City, 30 July 2016: the peak-rain frame (00:45 UTC on the 31st, 8:45 pm EDT) shows the training storm line
  over the town. `npm run test:radar` (`--live` lists Ida's frames over Philadelphia).

**Radar rainfall** (Storm → Historic storm → Source *Radar, NOAA MRMS*; `src/mrms.js`). The run's rain from radar,
varying cell by cell and every 2 minutes, instead of one gauge or grid point spread evenly over the area. NOAA's
Multi-Radar Multi-Sensor rain at 0.01° (about 1 km), read from the Iowa Environmental Mesonet's archive (September 2013
on, lower 48).
- **What it uses:** each pixel's hourly total, gauge-corrected where the archive has it, timed within the hour by the
  30 two-minute radar rain rates (`PrecipRate`).
  - **Gauge-corrected totals** from IEM's raw MRMS archive (`mtarchive.geol.iastate.edu`, GRIB2 with PNG packing, read
    in the browser): `GaugeCorr_QPE_01H` from 6 May 2015, `MultiSensor_QPE_01H_Pass2` (radar adjusted to gauges, with
    gauges and climatology where radar is poor) from 14 October 2020. Before May 2015, or for an hour or pixel the
    file lacks, the radar-only total (`RadarOnly_QPE_01H`) stands in; the summary lists those hours and counts those
    pixel-hours, and gives the area total from radar alone beside the one used.
  - A pixel whose 2-minute rates are missing, overflowed (the archive stores them in a byte that tops out near
    150 mm/hr) or disagree with the radar's own hourly total by more than 2× takes the area's mean shape, else an even
    spread; the summary counts these, and lists any missing hours (taken as dry).
- **Window:** the site record's wettest stretch of the event, 2 h either side, trimmed to the first and last wet
  2-minute frame. Only wet hours' 2-minute frames are fetched (through the local server's cache).
- **In the run:** each solver cell takes its rain bilinearly from the pixel centres; the solver's per-cell rain
  multiplier (the one roof routing uses) becomes roof routing × cell depth ÷ area mean at each 2-minute block, so no
  kernel changes, and the rain books follow the field exactly. The hyetograph and the Atlas 14 comparison show the
  area mean; the forcing record (and so the run fingerprint) carries a hash of the frames.
- **Radar alone** can read high in hail or bright band and low far from the radar or under beam blockage, which is why
  the gauge-corrected totals come first. The timing within each hour is still radar's. The summary also sets the
  gridded site record over the same hours beside it.
- Ellicott City, 30 July 2016 (GaugeCorr for all 12 hours): 164 mm over the area in about 4 h (radar alone 165 mm),
  peak 134 mm/hr over 2 minutes at 23:36 UTC (7:36 pm EDT); the gridded site record (IEM reanalysis) has 94 mm over
  the same hours. NWS reported about 6.6 in (168 mm), most of it in 2 h. `npm run test:mrms` (`--live`: Ida over
  Philadelphia, all hours MultiSensor Pass 2; one GaugeCorr hour at Ellicott City checked against PIL).
- Downspouts into the sewer take the radar rain at their manhole (the coupler's per-node roof rain), so the pipes see
  the storm cell where it falls. The rain readout and the green-roof and cistern stages count rain fallen as the
  hyetograph's (the area mean), not the books' volume over a rain area that changes as roofs fill.
- Comparison pairs, window reruns and emulator training runs use the same run loop, so they get the radar field too;
  the emulator's rain-depth factor scales it.
- A 2-minute frame that maxed out (or reads as missing) is filled from the raw 16-bit `PrecipRate` (GRIB2) where the
  archive has it, so the cloudburst core keeps its own timing; the summary counts those frames.

**Radar & nowcast** (Storm → *Radar & nowcast*; `src/nowcast.js`). A storm source for rain that is coming in: a run
that starts in the last 1, 3 or 6 hours and goes past now, with the radar rain observed over the area to the latest
2-minute frame, then 0–90 minutes of nowcast (2 or 3 h with NOAA HRRR's forecast rain past 90). Same per-cell rain, books and outputs as a historic radar storm; click
again to refresh. (It was under Historic storm; a project saved with those controls opens with them here.)
- **Observed:** whole hours as above (gauge-corrected once the archive has them, about 1.5 h behind; radar-only p1h
  until then, about 30 min behind), then the current part hour straight from the 2-minute frames (about 6 min behind).
- **Nowcast:** the storm's motion from two 10-minute rain totals 20 minutes apart over a box 1.5° round the area,
  matched by correlation of √rain (coarse to fine, sub-pixel); the last 10 minutes' mean rate then moves at that
  velocity, without growth or decay (Lagrangian persistence). The summary gives the speed, heading and the match's
  correlation (below 0.6 is flagged as poor); with too little rain to match, the latest rain stays where it is. The
  hyetograph draws the nowcast in amber after a marker.
- **Ensemble:** 10, 20 or 40 members plus persistence, each moving the same rain a little faster or slower
  (× e^N(0, 0.2)), turned (N(0, 15°)) and growing or decaying (N(0, 0.5) in ln per hour), on a Latin hypercube with a
  fixed seed. The panel shows the arrival, the depth and the peak over the area as P50 with the members' P10–P90, the
  share of members that bring rain, the motion and its correlation, and a loop of the incoming rain with the motion.
  The run uses persistence or the dry, middle or wet member (nearest the P10, P50, P90 depth); Batch lists all four.
  The spreads are assumed: a sensitivity band, not a probability.
- **Rolling live:** while a run plays, newer frames replace the nowcast blocks it has not reached and the rest is
  nowcast again from the newest frame; *Wait for the radar* holds the run at the latest frame (observed rain only,
  about 6 min behind real time). Replays and batch jobs never roll.
- **HRRR past 90 minutes** (`src/hrrr.js`): for a 2- or 3-hour lead the nowcast fades into NOAA HRRR's forecast rain
  (the 3 km weather model, newest run on AWS; 15-minute rain fields read by byte range from the GRIB2 files) from 60 to
  90 minutes, HRRR alone after. Lower skill still: marked in red on the hyetograph, named in the panel's limits, and
  the HRRR cycle is in the run record. Every member shares the one HRRR run. `npm run test:hrrr`.
- **Replay:** an *Issued at* time in the past rebuilds the nowcast as it was then from the archive and checks it
  against what fell. Ida over South Street, 1 Sep 2021 23:30 UTC: band 1.3–5.8 mm in the next hour, 5.7 mm fell.
- **Screening only:** storms grow, decay and turn, and skill of this kind of nowcast falls off within the hour. It
  answers "if this keeps coming, what floods next", not "what will happen".
- **Tide on a live run:** with a CO-OPS gauge in reach, the water-level boundary takes the gauge's observations up to
  now, then NOAA's tide prediction plus the surge now (observed − predicted, the mean over the last hour), held to the
  end of the run; a gauge without a prediction holds its last reading. Philadelphia, 3 November 2026: observed to
  12:42 UTC, then the prediction + 0.09 m.
- Fort Pierce FL, 2 November 2026, 14:38 UTC: loads in about 7 s; 3 h observed (60 mm over the area) and 60 min of
  nowcast (48 mm), motion 23 km/h toward 323° (r = 0.85). `npm run test:nowcast` (`--live`: Philadelphia now).

**Channel bathymetry (surveyed or estimated)** (Area → *Channel bathymetry*; `src/bathymetry.js`; off by default). Lidar flattens
rivers at the flight-day water surface; the channel below is missing. The estimate:
- **The flattened surface:** grown from the mapped river lines over cells flat to the millimetre (at least 4 of 8
  neighbours within 3 mm). Natural ground carries centimetres of lidar noise; flattened water carries none.
- **Drainage area:** USGS NLDI where a river enters the model, else D8 flow accumulation on the DEM.
- **Bankfull width and mean depth:** the regional curves of Bieger et al. (2015), nationwide (W = 2.70·A^0.352,
  D = 0.30·A^0.213, A in km², metres) or by physiographic division (pick it: Atlantic Plain for Houston, Appalachian
  Highlands for the Piedmont, …).
- **The section:** parabolic across the flattened width, its centre 1.5 × the mean bankfull depth below the bank tops,
  less the bank height above the water (that part was full on the flight day), at least 0.3 m; bank height is the
  median rise from the water's edge to the highest ground within half the bankfull width.
- **In the run:** the carved channel starts full to the lidar surface; gauge start levels rise from that surface (the
  gauge's rise too is measured from the lidar surface, not the carved bed: it was, and started Ida's Fairmount pool
  0.36 m high and the tidal reach 1.3 m high).
- Ellicott City (Appalachian Highlands): the Patapsco drains 292 mi², bankfull 160 ft wide and 5.7 ft deep; its banks
  stand 5.9 ft above the flight-day water, so 2.7 ft is carved below it at the centre. 6,967 m³ of channel, starts full;
  the run's water balance 1.8e-6. An estimate: use surveyed sections where you have them (Rivers, below).
  `npm run test:bathymetry`.
- **Surveyed bed where it exists** (`src/topobathy.js`, `src/tiff.js`). NOAA's National Bathymetric Source publishes
  BlueTopo: gridded hydrographic surveys of navigable water, such as harbours, estuaries and tidal rivers. It comes in
  2–16 m tiles, on NAVD88 in the lower 48.
  - The server finds the tiles under the area in BlueTopo's tile index (`GET /api/bluetopo?bbox=`). The index is a
    GeoPackage, downloaded once into `.cache/bluetopo/` and read with Node's built-in SQLite.
  - The browser fetches the GeoTIFFs through the proxy. A small reader of its own decodes them: tiled or striped,
    deflate, float samples. It samples them bilinearly onto the 1 m grid.
  - On the lidar's flattened water, the surveyed bed replaces the estimate. A survey pixel above the lidar surface (a
    bank caught in a coarse pixel) carves nothing. The estimate carries on where there is no survey.
  - Tiles not on NAVD88 are left out, with the reason given.
  - The regional curves are fitted to non-tidal alluvial streams. At Fairmount they carved the tidal Schuylkill to
    −1.1 m NAVD88; BlueTopo has it surveyed to −8.2 m (median −2.8). On the Ida box, BlueTopo covers 55% of the river
    surface, everything below the dam: 813k m³ of channel, where the estimate alone gave 357k m³ for the whole river.
    The dam crest is untouched (3.02 m both ways).
- **HEC-RAS cross-sections** (Area → *HEC-RAS cross-sections*; `src/hecras.js`). Where a 1D model exists (an effective
  FEMA model, a county study), its surveyed sections beat the curves.
  - Load the geometry file (`.g01` …, plain text) with the project `.prj` (for its units) or the RAS Mapper projection
    `.prj` (PROJCS WKT); or type the EPSG code. NAD83 / WGS84 UTM is converted here; state plane and the rest go
    through proj4. Elevations in feet or metres, NAVD88 or NGVD29 (shifted by NOAA's VERTCON at the sections' centre).
  - Read: each reach's cross-sections (`Type RM … = 1`) with `#Sta/Elev`, `Bank Sta` and the `XS GIS Cut Line`, in
    RAS's fixed-width fields (8 characters for station–elevation, 16 for coordinates; they can run together).
    Bridges, culverts, inline and lateral structures are counted and left out.
  - Between two successive sections of a reach the bed is interpolated the way RAS Mapper does. Stations are stretched
    onto the cut line's length; each section is split into left overbank, channel (between the bank stations) and
    right overbank. Each zone is cut into strips at matching normalised stations, and a cell inside a strip takes
    (1 − u)·z₁ + u·z₂ along it. Reaches are interpolated independently: no junctions, and nothing beyond the first
    and last section.
  - Under the flattened water, BlueTopo's survey comes first, then the cross-sections, then the curve. As with the
    survey, a section above the lidar water surface carves nothing (so the overbanks never raise the ground). The note
    and the log give the share and the volume from the sections; runs record it in their forcing (`bathyXS`).
  - Needs a channel bathymetry option other than *Lidar surface* (that one carves nothing). Loaded sections are placed
    again on every Build. `npm run test:hecras`.

**Window reruns** (Compare → *Run both in a window*, *Check the window*; `src/window.js`; phase 4 of the site-design
spec). On a large model, rerun a design change on a window around the site only.
- **The window:** the site boundary (else the design's features) plus a margin (150 m by default). Cells outside become
  sinks and take no rain, so their tiles stay inactive. Active tiles now count rain only where it falls.
- **The existing run** books the flow across the window's edge in ~20 m segments every step (control-line faces).
- **The window run:**
  - each segment gives back what crossed it inward, into the cells just inside;
  - the segment is shut (a crest, as for deployable barriers) while the existing run's flow there was inward and open
    while it was outward;
  - pipe-network inlets outside the window replay the existing run's exchange.
- **The result** is merged into a full record: the window run inside, the existing run outside, with the existing run's
  forcing, so Compare reads it like a full run and says it is a window rerun.
- **The edge check:** the window run books the same segments. Where its outflow differs from the existing run's by more
  than 5 %, the design reaches the edge: widen the window.
- **Check the window** reruns existing conditions on the window: the difference from the full run is the window's own
  error. On the small Meyerland block (448 × 352 m, 60 m margin, 48 % of the area): depth RMSE 6.4 mm over 90,000 wet
  cells, 683 cells off by more than 3 cm (worst 18 cm, at a building on the edge), Line 1 peak 48.6 vs 49.6 cfs, total
  outflow at the edge within 2 %. No time saved there: on a domain that small the 2 s pipe-network exchanges set the
  pace. The saving comes on large models where the surface solver dominates. Use a margin that keeps the edge well clear
  of what the design changes, and check it. `npm run test:window`.

**Per-project emulator** (map button *Emulator*; `src/emulator.js`, `app/emulator-ui.js`). A fast stand-in for the
solver, trained on the project's own runs. It answers "what if" inside a trained range in a fraction of a second, with
an error estimate. It is for screening: confirm with a solver run before a number goes in a report.
- **A study** is one scenario (existing conditions or a saved design) and 1–6 parameters with ranges. What can vary:
  - the return period of the Atlas 14 design storm, 1–1000 yr on a log scale (`ddf` now interpolates log–log between
    the table's columns; the columns themselves are unchanged);
  - a rain depth factor;
  - a river inflow scale, when the model has river inflow;
  - a tide / surge offset, for a historic storm with a water level;
  - the soil wetness at the start (Green-Ampt Se);
  - design numbers of the scenario's features (`VARIABLE` in `src/design.js`): finished floor, pad and paving
    elevations, pond bottom and side slope, swale depth and width, rain-garden ponding and media depth, and the pond
    outlet's orifice, riser crest, weir length and spillway crest.
  Everything else stays as it is set when the study starts. Every run's forcing fingerprint must match the first one's
  on the parts the study does not vary, or the study stops and names what changed.
- **Training runs** are ordinary solver runs at full speed:
  - the points are a maximin Latin hypercube (10 per parameter by default, at least 8) plus the centre of the box;
  - plus 3 held-out random points the solver also runs, as an honest test;
  - gauge readings are fetched once and reused, as in *Run both*;
  - each run is saved in the project's `runs/` with its ground (`grids/ground.f32`), so a study resumes where it
    stopped and retrains from what is there.
- **What it learns:**
  - the max water surface on the cells wet in any run (widened by 2). In dry cells the surface is carried in smoothly
    from the wet cells around them (pull–push) and capped at the ground. A lake stays one flat level across a pad that
    pokes out of it, so the field changes smoothly with the parameters even where the shoreline moves;
  - max depth = max(0, surface − ground), with the ground of the design values asked for (`applyDesign`);
  - also √(max speed), time above 15 cm, each control line's peak and volume, each new building's water level, and
    the edge outflow and infiltration.
- **How:**
  - PCA of the fields from the N×N Gram matrix (Jacobi), keeping 99.9 % of the variance;
  - one Gaussian process per component and per scalar output: Matérn 5/2 with a length scale per parameter, constant
    mean and a nugget, fitted by maximum likelihood (multi-start Nelder–Mead);
  - the error estimate per cell is √(Σ σₖ²φₖ² + what the dropped components leave out).
- **Validation, shown after every training:**
  - leave-one-out in closed form (Dubrule) for every training run; it keeps the run in the PCA basis, so it is a little
    optimistic;
  - the held-out runs, the honest test: depth RMSE and worst cell over cells wet in either, extent CSI at 15 cm, and
    control-line peak error.
  - *Check with the solver* runs the solver at the slider values and reports the same errors there; that run then joins
    the training. *Add a run where it's least sure* runs the point of largest predicted variance among 1,500 and
    retrains.
- **Use:** sliders give the max depth, speed, time above 15 cm or uncertainty map, the control-line peaks (± 2σ) and
  the new buildings' water against their floors. *Send to Compare* puts the emulated map in the Compare drawer, marked
  emulated everywhere, including the exported summary. Send an existing-conditions study and a design study at the
  same storm values to compare the two. *Export grids* writes `.asc` grids and a README to the study folder.
- **Files:** `emulators/<name>/study.json` (parameters, points, the runs used, the fixed fingerprint), `model.json`,
  the means and bases as `.f32`, `mask.u8`, `nodata.u8` and `validation.json`. A study trained before an app change is
  flagged.
- **Limits:** only inside the trained box, for that scenario and that model build. Drawing a new feature needs a new
  study. Training holds N runs × the wet cells × 3 fields in memory and refuses above about 1 GB.
- **On a Meyerland block** (450 × 350 m at 1 m, the 1-hr Atlas 14 storm, 90-min runs of about 90 s each):
  - existing conditions, return period 2–100 yr × soil wetness 0.15–0.95, 13 training and 3 held-out runs.
    Held out: depth RMSE 0.6–1.2 mm, worst cell 3 cm, extent CSI ≥ 0.993, control-line peak within 0.5 %.
    *Check with the solver* at a new point (37-yr, Se 0.60): RMSE 1 mm, worst cell 2.2 cm, CSI 0.995.
    Training takes under 1 s; a map at new values 13–30 ms.
  - the proposed design (two buildings and a pond), return period × the pond's low orifice (0.24–0.99 ft), 11 + 2
    held out: depth RMSE 0.5–1.0 mm, worst cell 2 cm, CSI ≥ 0.993, peaks within 0.5 %.
  - emulated existing vs emulated proposed at the 25-yr storm, against the solver's paired runs (the same forcing
    fingerprint): control-line peak 49.38 → 40.98 cfs vs 49.61 → 41.27; cells with a higher max water surface 650 vs
    614, lower 12,411 vs 12,401; off-site rises 38 cells up to 7 mm vs 1 cell at 5 mm.
  An emulated comparison widens Compare's no-change band per cell to 2σ of the two emulators combined. Changes under
  about 1 cm in it are still within its error: confirm an off-site impact with the solver.
  Storm and soil sliders snap to round values (1 yr, 0.01), and each has a box for an exact value, so two studies can be
  set to the same storm; design numbers stay continuous.
- `npm run test:emulator` covers:
  - the Latin hypercube (one point per bin, maximin spacing);
  - the GP: through its training points, Branin from 40 points, its ±2σ coverage;
  - closed-form leave-one-out = refitting to 2e-10, the likelihood fit's length scales;
  - PCA with every component rebuilds its fields;
  - a synthetic lake and a tilting flood surface with moving fronts, recovered at held-out points; a design value that
    raises a pad out of the water;
  - Atlas 14 between columns, and a saved emulator predicting exactly what the trained one did.

**Flood barriers** (drawer tools *Flood wall*, *Levee / berm*, *Deployable*; `src/barriers.js`). Each is a line with
a crest, set either as a height above the lidar ground under it (so it follows the ground) or as a fixed elevation
(NAVD88).
- **On the grid.** A barrier sits on the cell faces its line crosses, not in the cells: a 1 ft wall on a 5 m grid stays
  thin. The face set is watertight (any 4-neighbour path across the line crosses one). Faces on the grid edge are
  left as outfalls. Tie barrier ends into high ground or buildings, or water goes around them, as it would.
- **Overtopping.** Water crosses a barrier face only above its crest, as a broad-crested weir, q = C·H^1.5 from the
  higher side, with Villemonte submergence (1 − (H₂/H₁)^1.5)^0.385. That is the same equation HEC-RAS uses for levee
  connections; the coefficient is editable (defaults: wall 1.66, levee 1.44, deployable 1.55 m^½/s = 3.0 / 2.6 /
  2.8 ft^½/s). Water at rest stays at rest below or over a crest. Free overflow matches C·H^1.5 to 2 % in the tests.
- **Berms** also fill their trapezoid (top width, side slopes) into the bed, so a wide levee takes up its room; the fill
  volume is reported.
- **Deployable barriers** go up from the start, at a set time into the storm, or not at all (for with/without runs).
  Crests are on faces, so raising one under water moves no water.
- **Results** (drawer form, Run section, `barriers.csv` and `summary.json` in each run folder):
  - lowest freeboard and highest water against the barrier;
  - whether and when it overtopped, the volume over, the peak rate and the peak rate per metre;
  - peak hydrostatic load per metre of barrier, ½ρg·|d₁² − d₂²| with each side's depth taken up to the crest.
  These are booked every solver step on the GPU. Water counts as over a barrier only while it is up and stands more
  than 2 cm over its crest, so rain running off a berm top is not overtopping. Only the peak total rate over a barrier
  is sampled (volume change between drawn frames); the peak rate per metre is per step. On the map, a red halo marks an overtopped barrier and a green halo one that held.
- **Import.** Line files named like levee / berm / dike become berms, wall files walls, barrier files deployable barriers.
  A crest elevation field (`crest`, `top_el`, `tob`) sets a fixed crest; a `height` field sets the height.
- `npm run test:barriers` covers the rasterisation, at-rest balance, weir rate, drowned flow, mid-run deployment and the
  books. The GPU suite runs a 2D overtopping case against the CPU solver.

**Hazard and intensity** (View → *Now* / *Peak over the run*; `src/hazard.js`). Per solver cell through the run:
- **Hazard class.** ARR 2019 / AIDR H1–H6 (limits on depth, velocity and d·v; default), UK FD2320 HR = d(v + 0.5), or
  FD2320 with its urban debris factor. Classes come from depth and velocity at the same moment and the worst is kept
  (max depth × max speed would overstate it, since they peak at different times).
- **Force** per metre of width, ρ(h·v² + ½g·h²): the load the flow puts on a wall, car or person across it (kN/m).
- **Peak d·v**, **duration** deeper than 15 cm, and **arrival** (first time 15 cm deep).
- Velocity counts only where the water is at least 5 cm deep. Thinner water at wetting fronts can show 4–6 m/s on steep
  curbs, which would otherwise paint spurious H5/H6 cells.
- The hover probe shows each at the cursor; under the run readouts, the area in each class and the peak force.
- Each run folder gets `hazard_arr.asc`, `hazard_fd2320.asc`, `hazard_fd2320_urban.asc`, `max_dv.asc`,
  `max_force.asc`, `flood_duration_min.asc` and `arrival_min.asc` (with `.prj`), and the class areas in `summary.json`.
- All of these are tracked every solver step on the GPU (a hazard kernel after the sources), as max depth is; the GPU
  suite checks them against the CPU solver (no class differences). `npm run test:hazard` covers the class limits,
  force, same-moment classification, duration and arrival.

**Subgrid speed mode** (Solver cell size → *Speed mode: 4 m subgrid* or *Screening: 8 m subgrid*; `src/subgrid.js`,
`sg*` kernels). Opt-in: the 1 m run stays the default and the reference.
- **How it works.** The solver runs on 4 m (or 8 m) cells, but every cell keeps a level → stored-volume table from the 1 m
  lidar inside it, and every face a level → flow depth and conveyance table from the 1 m pixels between the two cell
  centres (curbs block a face until water tops them; buildings are porosity, so a cell is a wall only when it is all
  building). The scheme is local inertial (as SFINCS): q ← (q − gHΔt·∂η/∂x) / (1 + gΔt|q|H/K²). The state is volume,
  so mass is exact; levels come from the tables. Rain, infiltration, inlets, culverts, barriers (weir faces), green
  infrastructure and the hazard products all run in it.
- **Output stays 1 m.** Depth at each 1 m pixel = cell water level − 1 m ground; `max_depth.asc` is written at 1 m.
  Hazard, force, duration and arrival are per cell at its deepest point (conservative), with class areas counted over
  the 1 m pixels that got wet.
- **Accuracy vs the 1 m run.**
  - 320 m synthetic urban catchment, 30-minute cloudburst (GPU suite): 4 m is 15× faster with peak-depth error 2.6 cm
    mean / 4.0 cm RMS, no bias, flood extent (> 15 cm) CSI 0.80. 8 m is 36× faster but 5.6 cm / CSI 0.63: screening only.
  - South Street, Philadelphia (row houses, combined sewer, 60-minute Atlas 14 storm): 4 m gives 3.3 cm mean /
    6.1 cm RMS, 0.1 cm bias, CSI 0.67. The misses are spaces enclosed inside a cell (courtyards in row-house blocks),
    which a 4 m cell connects to the street; that is the method's limit.
- **Speed in the app** is bounded by the pipe-network exchange every 2 s on small coupled sites (South Street: 2.3×
  faster than 1 m); the gain grows with the area and without a pipe network.
- **Tide / surge.** The observed water-level boundary works here too: the edge face runs the same momentum equation
  against the observed level (GPU suite: still water stays still; a 0.8 m rise fills to within 1 % of the tables).
- `npm run test:subgrid` covers the tables; the GPU suite compares 4 m and 8 m with the 1 m run.

**Watershed: upstream water** (Area → *Watershed*; `src/watershed.js`). Build checks, in the background, whether ground
outside the area drains into it, from a 3DEP DEM (5 m, or 10 m for wide searches) around it: priority-flood filling,
D8 flow directions, and every cell whose flow path reaches the area. The search widens until the catchment closes
(up to ~15 km).
- **Closed watershed:** *Run on the watershed* makes the model area the watershed polygon. Its edge is a ridge, so
  nothing flows in and water leaves only where the terrain does: a closed system.
- **A river from a large basin** (the catchment runs off any feasible search, as the Patapsco at Ellicott City): the
  river's own flow comes in from a USGS stream gauge (below). The local watershed, the ground that drains in without
  coming down the river, is offered as the model area (Ellicott City: ~9.5 km² of the Tiber–Hudson valleys).
- Surface drainage only: pipes, and water routed around buildings, are not in the trace; in flat urban terrain the
  line is approximate. `npm run test:watershed`.

**Infiltration: Green-Ampt with soil wetness and the water table** (Storm → *Infiltration*, *Soil wetness before the
storm*, *Water table depth*; `src/soil.js`). The default; *Constant rate by soil group* keeps the old behaviour.
- **Soil properties from SSURGO:** for each map unit, the largest major component with data ("Urban land" components in
  urban complexes have none): K = half the most restrictive saturated conductivity in the top 50 cm (Bouwer), porosity,
  and texture → wetting-front suction (Rawls, Brakensiek & Miller 1983); depth to the seasonal high water table and
  bedrock. Units without horizons fall back to their hydrologic group's texture, else compacted urban fill.
- **Green-Ampt:** capacity K·(1 + ψΔθ/F) on each cell's pervious share (streets, roofs and water take none), F the depth
  infiltrated so far, Δθ = effective porosity × (1 − initial wetness): dry, normal, wet or saturated start. Once the soil
  holds Δθ × (depth to the water table or bedrock), it takes nothing more (saturation excess), so a shallow water table
  floods sooner. A water-table depth typed in overrides the survey for every cell.
- **Groundwater check:** the nearest USGS well with levels since 2000 (Water Data API field measurements) is shown
  beside the setting; wells can tap deeper aquifers than the water table, so it is a check, not an input.
- Tracked every step on the GPU (and the CPU solver); ponded infiltration matches the analytic Green-Ampt solution to
  0.3 %, GPU vs CPU to 1e-7. Ellicott City: 33 of 35 units with data, K 1.7–42 mm/hr, water table 0.1–1.5 m on the
  floodplain. `npm run test:soil`.

**Scour potential** (View → *Peak over the run* → *Scour*; `src/scour.js`). Every step, bed shear τ = ρg·n²·v²/h^⅓ per
cell, its excess over what the ground resists, and an indicative scour depth from the excess-shear law
ε = k_d(τ − τc), k_d = 0.2·τc^−½ cm³/(N·s) (Hanson & Simon 2001). Critical shear: paved, roofed and water not erodible;
grass and vegetation 30 Pa (FHWA HEC-15 class D); bare or cropped soil 1 Pa (sand) to 10 Pa (clay) by SSURGO texture.
Classes by peak shear over critical: none, low (≤ 2×), moderate (2–5×), high (> 5×). Run folders get
`max_bed_shear.asc`, `scour_class.asc` and `scour_potential_cm.asc`. It is a potential: no sediment supply limit, no
deposition, and the ground does not change shape during the run (full morphodynamics is a later step). Ellicott City
with the Patapsco's 10-year flow: 1.8 ha high, mostly floodplain grass along the river, up to 18 cm.

**Sediment transport and bed change** (Storm → *Sediment transport and bed change*, *Erodible topsoil depth*; View →
*Bed*, *Grain*; `src/sediment.js`, kernels `sedAdvect` / `sedSource`). Off by default; the standard solver only (1–4 m
grids, not the subgrid speed mode) and a GPU with 10 storage buffers per shader stage.
- **Four grain classes:** clay (2 µm, settling as flocs at 0.1 mm/s), silt (30 µm), sand (the area's sand size by
  texture, 0.15–0.35 mm) and gravel (8 mm). The mix per cell comes from the soil survey's surface horizon: rock
  fragments (`chfrags.fragvol_r`) as gravel, the fine earth split by its sand and clay (the texture's typical mix where
  the survey has no horizon data).
- **Suspended load:** each class carried with the solver's own face fluxes in each Runge–Kutta stage at the upstream
  cell's concentration, so solids move exactly with the water, and settling at its own Ferguson–Church velocity,
  exactly over each step; at most 10 % solids by volume.
- **Entrainment** by excess shear ε = k_d(τ − τc), k_d = 0.2·τc^−½ cm³/(N·s) (Hanson & Simon 2001), against the soil's
  critical shear by texture, taking the bed's classes in proportion, except a class the flow cannot hold in suspension
  (u* < w_s), which stays behind: fines wash out of a scoured bed and it coarsens.
- **Bedload** of sand and gravel: Wilcock & Crowe (2003), with hiding between the sizes, across each face, upwind by the
  water flux, at most half the water crossing the face (so the bed is never pushed where the water does not go).
- **Shear on the soil** uses the skin (grain) roughness n = d50^⅙/21.1, not the total n with vegetation drag (the
  effective shear of HEC-15 for vegetated linings); the total-shear scour-potential map is unchanged.
- **The bed moves** (Exner, porosity 0.4): scour and deposits change the ground the flow sees during the run. The
  erodible budget is the topsoil depth you set (30 cm default) on erodible ground; paved ground erodes only the loose
  deposits that land on it; mapped water (rivers) takes deposits but does not erode (the survey has no bed material).
  The state keeps each class's store as its change from the start, and the bed as its initial level plus the change,
  so solids balance per class and small bed changes are not lost to fp32 rounding.
- **Armouring (active layer, Hirano).** Each cell's bed has a surface layer two coarse grains thick (at least 1 cm) with
  its own mix:
  - the flow erodes and moves grains in the surface's proportions;
  - deposits join the surface;
  - as the bed lowers the substrate refills the surface, and as it rises the surface's excess is buried.
  So fines and sand are winnowed out and a coarse armour forms even on a thick erodible bed. The Grain view and the
  exports show the surface's size; `readSediment` also gives the store's. GPU suite: a clear-water flow of about 20 Pa
  over 0.3 m of sand and gravel raises the surface's gravel share from 30 to 45 % in an hour, while the store beneath
  stays at 31 %. Armouring builds over hours of strong flow, so a single short storm changes the surface little.
- **Checks** (GPU suite): settling of each class matches its exact decay to 0.001 %; a dam break over loam and over a
  sand–gravel mix conserves solids per class to ~1e-6 and water to ~1e-7, and 45 % of the scoured sand–gravel bed
  ends coarser than it started.
- Run folders get `bed_change_cm.asc`, `suspended_solids_mm.asc`, `bed_grain_size_mm.asc` and
  `sediment_by_grain_class.csv`; the totals go under the run readouts.

**Debris flows** (Storm → *Debris flows*, with sediment transport; kernels `sedSource`, `slopeFail`). Off by default.
- **Mixture flow:** the water depth becomes the mixture depth. Entrained bed brings its pore water, and deposits take
  theirs back, so the flow bulks as it picks up material. The mass books stay of water: the solids in the flow and
  carried out are taken off, and the pore water the bed released is added.
- **Entrainment and deposition** toward the equilibrium slope of Egashira et al. (1997):
  - only once the flow is a debris flow (≥ 20 % solids; thinner flows, such as sheet flow on a steep slope, entrain by
    shear alone, so a debris flow starts from a landslide or from shear erosion building the load);
  - rate i = u·tan(θ − θe), with tan θe = (σ/ρ − 1)C·tan φ′ / ((σ/ρ − 1)C + 1);
  - it erodes on slopes of 10° or more, unsorted (all classes together);
  - it deposits wherever the slope falls below θe;
  - the concentration is capped at 50 % by volume.
- **Rheology:** the quadratic model of O'Brien & Julien (1988), using the Glenwood 1 sample's coefficients:
  - yield stress τy = 0.0345·e^(20.1C) dyn/cm², which stops a plug on its own;
  - viscosity η = 0.0283·e^(23.0C) P, with laminar resistance K = 24, applied implicitly.
- **Settling** is hindered in the mixture (Richardson–Zaki, (1 − C)⁴). Grains whose weight the yield stress holds up do
  not settle.
- **Shallow landslides:** where steeper than 15°, each step tests the infinite-slope factor of safety:
  - at the Green-Ampt wetting front (no suction credit), or at bedrock once the soil is saturated to it (then with
    slope-parallel seepage);
  - strength is the soil's c′ and φ′ plus root cohesion by land cover;
  - a cell with FS < 1 releases its soil (as far as the store goes) into the flow, with its pore water.

  On slopes of 10° or more the whole soil to bedrock is erodible (the survey's depth to bedrock, 1.5 m where it gives
  none, at most 3 m).
- **Check** (GPU suite), a 2 m slurry at 40 % solids released down a 20° gully onto a flat fan:
  - 305 m³ scoured from the gully and 173 m³ laid on the fan;
  - peak concentration 52 %;
  - solids balance per class 1e-7, water books 2e-7.
- Run folders get `slope_failure_min.asc` (when each cell failed).

**Bank collapse probability** (Storm → *Bank collapse probability*, on by default; View → *Banks*; `src/banks.js`,
kernel `bankFS`). The standard solver only.
- **Possible bank tops:** every cell within 20 m of open water (NLCD water or a mapped river or stream) standing at
  least 0.5 m over its nearest water cell (the toe), at a slope of 10° or more.
- **Factor of safety**, every step: a planar failure through the toe (a Culmann wedge), searched over 8 plane angles,
  FS = [c′·Lp + (W·cos α − U + Pw·cos(β − α))·tan φ′] / [W·sin α − Pw·sin(β − α)].
  - Weight uses the saturated unit weight below the bank's water table.
  - U is the pore water force on the plane.
  - Pw is the river against the face, confining it.
- **Strength:** c′ and φ′ by texture (BSTEM-style defaults; gravel raises φ′ toward 36°), plus root cohesion by land
  cover over the top metre (forest 5 kPa, grass 1.5 kPa).
- **Bank water table:** follows the river (and any water standing on the bank) with a lag T = θe·L/K, the Darcy travel
  time through the bank. A quick fall after a long high stage leaves the bank saturated and unconfined: rapid drawdown,
  the usual collapse case.
- **Toe scour:** the toe is the water cell's current bed, so with sediment transport on, toe scour raises the bank.
- **Probability, given the bank stands today:** c′ and tan φ′ are uncertain (normal, coefficients of variation 40 % and
  10 %), but whatever their true values, they hold the bank up at the start with the river at its starting level.
  - The app reports P(the bank fails during the run | it stood at the start). FS is linear in both, so per plane
    this is a 10-point Gauss–Hermite integral over tan φ′ of a difference of normal CDFs in c′; the worst plane counts.
  - A bank that is unchanged does not fail. A bank that could stand only on strength the survey lacks (rock,
    cementation: under 2 % chance of standing from the survey's strength) is shown grey and not rated.
  - Banks more than twice as high as the soil is deep (to bedrock) are left out as rock-controlled.
  - Classes: unlikely (< 5 %), possible (5–25 %), likely (25–60 %), very likely (> 60 %).
  - The readout gives the lowest FS and the highest probability, with their times.
- **Limits:**
  - no bathymetry: the toe is the lidar water surface, so a bank's submerged part is not counted;
  - no tension cracks or matric suction (conservative);
  - one planar mode (no rotational slips).
- **Checks:**
  - `npm run test:banks`: dry sand fails at its friction angle; cohesion and river water hold a bank up; rapid
    drawdown is the worst case; Pf = ½ at FS = 1; an unchanged bank does not fail; the conditional probability matches
    Monte Carlo (98.58 % vs 98.53 %); a cliff that stands only on rock is not rated;
  - GPU suite: the kernel's FS matches `src/banks.js` to 2e-7, and draining a full channel drops a 3 m loam bank from
    FS 1.73 to 0.69 (92 % probability of collapse, given it stood with the channel full).
- Run folders get `bank_collapse_probability.asc` and `banks.csv`: per bank top, its location, height, run, slope,
  strength, lowest FS and highest probability with their times, and the highest water against it.

**Collapsible and expansive soils (screening)** (View → *Collapse*; Data & assumptions → *Ground hazards*;
`src/soil.js`). From the same survey: a collapse (hydrocompaction) score per soil component from loess or eolian /
fan / colluvial parent material, dry density in the top metre, silty texture, a dry moisture regime and gypsum
(soils that lose volume when first wetted under load are low-density, silty, wind- or fan-laid and dry). Without a
primary driver (loess / eolian, aridic, gypsum) humid soils stay low at most. The Collapse view and `collapse_wetted.asc`
show the moderate and high classes where the flood wetted the ground (ponded 5 cm or soaked in 5 cm). Shrink–swell
(expansive clay) from linear extensibility is listed alongside. Flags for geotechnical follow-up (oedometer collapse,
swell tests), not predictions. Iowa loess hills: moderate; Ellicott City: no moderate collapse, 9.4 ha moderate swell.

**Upstream river inflow from USGS gauges** (Storm → *Upstream river inflow*; `src/inflow.js`). After a build, every
mapped river or stream crossing into the area (OSM waterways run downstream) is listed with the USGS discharge gauges
within ~15 km. A gauge on the same river whose datum sits above the river where it enters is picked as upstream
(rivers bend, so direction is no guide; at Ellicott City this picks the Patapsco at Hollofield, not the downstream
Catonsville and Elkridge gauges).
- **Historic storm:** the gauge's recorded 15-minute flows (NWIS instantaneous values, about 2007 on).
- **Design storm:** a hydrograph peaking at the gauge's 2- to 100-year flow, log-Pearson III with the station skew on its
  annual peaks (the Bulletin 17B moments; 17C's EMA and regional skew are not applied, so these are planning numbers;
  Hollofield: Q100 ≈ 58,800 cfs from 69 peaks), NRCS gamma shape, peaking at the rain's peak plus a lag you set.
- The flow enters on the channel's lowest cells at the crossing, through the solver's exchange cells, so the mass
  books include it.
- **Ungauged land between the gauge and the model.** Each entry's flow is scaled by its drainage area against the
  gauge's: Q = Q_gauge · (A / A_gauge)^b, with b = 0.8 by default (editable; USGS practice uses about 0.6–0.8 for peaks,
  1 for mean flows). The entry's area is the upstream basin of the NHDPlus reach nearest it (USGS NLDI); the gauge's is
  its NWIS drainage area. The note flags ratios outside 0.5–1.5, where the transfer is weak. Untick an entry to use its
  gauge's flow as measured. Check: NLDI gives 284.7 mi² just below the Hollofield gauge (published 285 mi²); the
  Patapsco entering Ellicott City drains 292 mi², × 1.019.
- **Baseflow warm-up** (Storm → *Baseflow warm-up before the storm*, hours). Before the storm the rivers run at their flow
  at the storm's start (the design base, or the recorded flow then), with no rain, from the start levels. The storm run
  then starts from that state, so its peaks, arrival times and books all begin with the storm. Skipped in the subgrid
  speed mode. At Ellicott City, 1 h of the Patapsco's 57 cfs base put 5,889 m³ in (57 cfs × 1.019 × 1 h is 5,940 m³),
  3,278 m³ of it still in the channel at the storm's start.
- Check: Ellicott City in the speed mode with the Patapsco's 10-year flow: 1.35 million m³ through the model in 90
  minutes, surface mass error 1.6e-6 of the water that entered. `npm run test:inflow` (`--live` fits Hollofield).

**Ungauged river inflow** (Storm → *Upstream river inflow* → an entry's source *Ungauged: USGS StreamStats regression
peak* or *Ungauged: your own peak flow*; `src/streamstats.js`, report section `app/report-inflow.js`). For a river with
no gauge to transfer from.
- **The peak.** USGS StreamStats, in its published flow-statistics workflow:
  1. delineate the basin above the entry (`ss-delineate`);
  2. find its regression regions (NSS `regressionregions/bylocation`) and their peak-flow equations (NSS `scenarios`,
     statistic group 2);
  3. compute the basin characteristics those equations use (`ss-hydro`);
  4. get the estimate (NSS `scenarios/estimate`): the 2- to 500-year peaks.
  A basin across region boundaries is weighted by area, as StreamStats does. Return periods between the published ones
  are log-log interpolated.
- **The interval.** Each peak carries a 90 % interval: NSS's own where the state publishes one, else ±1.645 average
  standard errors of prediction (Sl = √ln(1 + SE²) / ln 10), which is the region's average width.
- **Snapping.** A point must lie within about 40 m of StreamStats' stream grid. A mapped OSM river that misses it
  returns a 200 m² cell, so the delineation is retried on the nearest point of the NHDPlus flowline (USGS NLDI).
  The note compares the StreamStats and NLDI basin areas.
- **Your own peak** is for a river where StreamStats is unavailable or has no equations, or where you have a better
  number (a FIS discharge table, a study). There is no other fallback: the app does not invent a regional peak.
- **The shape.** The NRCS dimensionless unit hydrograph (NEH 630 ch. 16, table 16-1, peak rate factor 484; the table's
  area is 1.336 qp·tp). It sits on a base of 5 % of the peak, and the runoff it carries is compared with the storm's rain.
- **The timing.** The peak is the NRCS lag after the middle of the rain's peak block, plus the entry's shift:
  L = l^0.8 (S+1)^0.7 / (1900 Y^0.5), tp = 1.11 L.
  - l is the longest flow path where the state has it, else 209 A^0.6.
  - Y is StreamStats' mean basin slope.
  - The CN is 98 on the impervious share (NLCD, from StreamStats) and 70 on the rest.
  - Without those characteristics the defaults are slope 2 % and CN 75, and the note says so.
  - The lag equation was fitted to small basins (up to about 2,000 acres): on larger ones the note says the timing is
    indicative.
- **The return period** defaults to the storm's (*Design: the storm's return period*, also offered for gauges).
- **Warnings** go in the note and the log:
  - a characteristic outside the equations' range;
  - a basin more than 10 % impervious (the equations are fitted to mostly rural basins, so the peak is likely higher);
  - runoff greater than the storm's rain;
  - a peak after the run ends.
- **Saved with the run.** The entry's peak, interval, equations and characteristics go into the forcing fingerprint and
  the saved run (`summary.json` `inflow`). The *River inflow* report section shows every entry's hydrograph, the
  peak-flow table with intervals, and the characteristics with their equation ranges.
- **Check.** Wissahickon Creek at the Philadelphia gauge (01474000; NWIS: 64.0 mi²) gives:
  - StreamStats basin 63.7 mi²;
  - PA SIR 2019-5094 peak-flow region 4 (drainage area, percent carbonate 16.8 %);
  - Q100 12,300 cfs, 90 % 7,400–20,400 cfs (ASEp 31.5 %);
  - 16.2 % impervious, mean slope 2.94°, CN 74.5, NRCS lag 7.7 h (a 40,800-acre basin: indicative).
  `node tests/run-streamstats-tests.mjs` runs on recorded replies; `--live` asks the real services (about 20 s).

**Starting water levels** (Storm → *Rivers, lakes and tidal water start at*; `src/waterlevels.js`). The 3DEP lidar is
hydro-flattened: open water is a flat surface at the level of the day it was flown, so without this the channels and
lakes start at that day's level. With *Gauge levels* (the default), before the run starts the app reads the USGS gauges
nearby and the inflow gauges, at the storm start for a historic storm or their latest reading for a design storm.
- **River gauge:** water surface (gage height + gauge datum, or a NAVD88 water-surface elevation) minus the lidar water
  surface at the gauge gives the rise; the river rises by that much along its length. Inside the model the lidar
  surface at the gauge is the median of the 9 water cells nearest it, not the lowest within reach (above a dam, that
  is the tailwater: Fairmount Dam on the Schuylkill started its pool 2.7 m high); outside it, the 5th-percentile ground
  of a 120 m patch (gauges sit on banks and bridges). Each water cell rises from its own lidar height, unless that
  stands more than 1 m above the lowest water within 60 m and under 30 % of the water around it is at its height: a
  mapped river line runs over bridge decks and 30 m land-cover water pixels cover banks, and a rise from a deck once
  started the railyard below 30th Street under 4 m of water before any rain. A pool above a dam is wide and flat at
  its own height, so it keeps it.
- **Lake or reservoir gauge:** fills its lake flat to the reading.
- **Tidal water** touching the tide-gauge boundary starts at the tide level.
- **Spreading:** water spreads, nearest water first, onto connected ground below its level, so a gauge above bankfull
  starts the floodplain wet.
- **Datums:**
  - gage heights need a surveyed NGVD29 or NAVD88 datum, accurate to within 0.5 ft (datums read off maps are skipped);
  - NGVD29 is converted with NOAA's NCAT/VERTCON.
- **Base flow:** each design inflow hydrograph's base is the gauge's flow at the start (else 5 % of the peak).
- **Not covered:** ungauged water stays at the lidar surface; the channel below it can be estimated (Channel bathymetry, below).
- **Checks:**
  - `npm run test:waterlevels`: parallel rise, flat lake fill, spreading onto connected ground only, datum rules,
    NGVD29 shift, a gauge above a weir, a bridge deck flagged as water;
  - `--live` reads Hollofield: 57.46 m NAVD88, 0.46 m above its lidar water surface at 57 cfs.

**Calibration** (section 6; `src/calibrate.js`). Import observations (CSV or GeoJSON points, feet or metres NAVD88):
high-water marks (water surface elevation), observed depths, or flooded / dry reports (311 complaints, photos).
- Every finished run is scored: a mark is compared with the highest modelled water surface within 3 m (marks sit on
  walls and doors), on ground no higher than the mark's own (+30 cm); a mark left dry scores its ground. Levels: bias, mean error, RMSE, share within 15 cm.
  Reports: flooded in both, missed, false alarms. Points on the map turn green / red / amber.
- Three settings, by hand or by sweep: roughness (Manning n ×), infiltration ×, and inlet clogging (share of each
  grate's opening blocked by debris). The sweep runs every combination (2 or 3 values each: 8 or 27 runs, in the
  4 m speed mode by default), ranks them and applies the best; confirm it at 1 m. The settings and observations are
  saved with the project; each run folder gets `calibration.csv` and the scores in `summary.json`.
- A test that hid known settings (n 1.6×, infiltration 0.25×, clogging 70 %) in synthetic marks on South Street was
  recovered exactly, but levels there move under 1 cm across the whole range: on a sewered, impervious site peak
  ponding is set by volume and topography, so marks there do not pin these settings down. The app says so when it
  happens. `npm run test:calibrate`.
- **USGS high-water marks** (*USGS high-water marks*): the Short-Term Network's surveyed marks in and around the area
  (`api.waterdata.usgs.gov/stnservices`, state from the Census geocoder), grouped by event. NAVD88 marks become water
  levels; marks on local control points keep their height above ground as depths. Coverage is mostly large river and
  coastal floods (Pennsylvania: Lee 2011, Ida 2021, Sandy 2012, historic Ohio River floods); street flash floods rarely
  have any, so they help most for river and surge replays. With a historic storm loaded, the button picks that storm's
  event (by name, else year and month).

**Validation scorecard** (*Report* drawer, first after the summary; `src/validate.js`). Every run of a real storm
(historic or live) gets one checklist, each line rated good / fair / poor against targets that are this app's defaults
for an urban model at 1 m, not a published standard (`TARGETS`):
- observations: high-water marks (RMSE ≤ 0.15 / 0.30 m, bias ± 0.10 / 0.20 m, ≥ 80 / 60 % of flooded marks flooded);
  each USGS level gauge inside the model, its peak water level (± 0.15 / 0.30 m) and the time of that peak (± 30 / 60
  min) against the gauge's record in NAVD88 (an elevation series, or gage height on a surveyed national datum; NGVD29
  through NOAA NCAT). The model's level there is the median water surface of the 9 mapped open-water cells nearest the
  gauge (within 60 m) that are at least 10 cm deep, every simulated minute (a bank wet with rain is not the gauge's
  water), on the water body its first reading is on: the highest flat surface at or below it, so a gauge above a dam
  reads the pool, not the tailwater beside it. A peak the run cut off (still rising at its end) is not scored for timing;
- rain: the source (gauge-corrected or radar-only), the gauge-corrected totals against radar alone, and against the
  site's gridded daily record (a coarse grid: a gap there points at the record as often as the radar); and against the
  independent point gauges within 25 km (below): the median model / gauge (1 ± 0.15 / 0.30) and the nearest gauge's;
- integrity: surface mass balance (≤ 1e-4 / 1e-3 of all the water in: start, rain, rivers, tide), with the pipes
  (≤ 1 / 5 %), water added by the wet / dry clip. The combined books with the pipes now count the water on the ground
  at the start (gauge start levels): before, a run that started with water showed that volume as an error (−53 % on
  Ida at Fairmount; 5e-6 once counted).
The verdict comes from the observations alone (rain and books explain a result, they do not make it), except that
books that do not close make it poor outright. A design storm, or an area with no marks or gauges, says it is not
validated and why. The report shows the gauges' observed and modelled hydrographs and every mark's error; the export
has `scorecard.csv`, `high_water_marks.csv` and the figures; `summary.json` keeps the inputs (`validation`). Gauge
readings are fetched when the run finishes (at most 20 s). `npm run test:validate`.
- A level mark more than 1 m below the lidar ground at its point is not scored, and the table says why: it sits under a
  structure the lidar sees as ground (a bridge or deck), where the model's water is rain on top of it. Nor is a mark
  whose USGS description puts it inside a building or in a basement: its level is below the street, and the model has
  only the street (Forest Hills' basement marks sat 1.6 m under the street water beside them). STN marks are named
  with their site (*HWM-1 (NYQUE31277)*) and keep that description.
- **Flood maps** (`src/floodmaps.js`; Calibrate → *Import flood map*). A map of flooding is
  scored cell by cell at 1 m against the run's peak depth, flooded at 4 in and over, buildings left out: hit rate (the
  map's flooded cells the model floods, ≥ 70 / 50 %), critical success index (hits / (hits + misses + false alarms),
  ≥ 50 / 30 %), the false-alarm ratio, the flooded area model / map, a table by depth band and, for a map with depths,
  the depth error where both flood. It takes GeoJSON polygons with a depth (`depth_m`, or a depth field in the
  observations' units), or the NYC DEP Stormwater Flood Maps' `Flooding_Category` (1: 4 in to 1 ft, 2: over 1 ft;
  3, future high tides, skipped), where model patches under DEP's 0.25-acre floor are dropped. Features with
  `mask: true` are where a map was made, and only cells inside them are scored. The USGS inundation maps of Ida 2021
  in New York City (Capurso and others, 2023) are each surveyed mark's level less the lidar within 250 m of it. They are
  made from the marks, so they are not independent of them, and their layers are pixel squares, about 50 MB a mark,
  too much to fetch in the app: `benchmarks/nyc/` has Forest Hills' 13 mapped marks merged into 0.25 ft bands with
  their buffers as masks. DEP's maps are
  another model (InfoWorks ICM), so they go in the scorecard as a comparison and not in its verdict. Maps load with
  the project (a project can also name a map by `{ "href": "/benchmarks/nyc/….geojson" }`, loaded when it opens), and
  scores added after a run go into its filed `summary.json` too. Clipped DEP maps for the Forest Hills example are in
  `benchmarks/nyc/`.

**Rain against nearby gauges** (*Report* drawer, with the scorecard; `src/rainqa.js`, `app/report-rainqa.js`). When a
run of a historic or live storm finishes, the rain it used is checked against the gauges within 25 km (nearest first, at
most 12), from the Iowa Environmental Mesonet: ASOS airport gauges (at most 4; hourly totals from the routine METAR,
`cgi-bin/request/hourlyprecip.py`, summed over the hours whose middle lies within the storm ± 1 h; trace counts 0, an
hour with no row is missing) and CoCoRaHS volunteer gauges (each state network's reports for a date,
`api/1/daily.geojson`; a report is the 24 h to the observer's reading hour, local, usually 7 am, so the reports whose 24 h
overlap the storm are summed and the hours they add beyond it are listed). The storm's window is its wet blocks (a surge
pad dropped; a live storm stops at its last observed frame, the nowcast is not checked); the model's rain is the area
mean it applied, or for a radar storm the radar at the gauge where the gauge lies inside the run's radar window. A gauge
is scored with ≥ 90 % of its hours (ASOS) or every report (CoCoRaHS), ≥ 2.5 mm, reports adding ≤ 18 h beyond the storm,
and not the storm's own source (a storm replayed from ASOS PHL does not score PHL). The report has a bar per gauge
against the model's rain and a table (station, network, distance, totals, ratio, coverage, window); the results live on
`validation.rain.stations` in `summary.json`, so saved runs report them. Hurricane Ida at 30th Street (the hourly
record's storm, 19:00 UTC 1 Sep → 04:00 UTC 2 Sep, 95 mm over the area): 11 of 12 gauges scored, median model / gauge
1.15 (0.73–1.99), the nearest (CoCoRaHS Philadelphia 2.7 WNW, 7 km, 3.74 in) 1.00; PHL airport had 1.88 in in those
hours (2.37 in that day, 0.5 in of it in the morning), Northeast Philadelphia 3.27 in: the storm's spread over 25 km is
real, so read the median. `npm run test:rainqa` (recorded IEM responses; `--live` against IEM now).
- When the gauges were still rising at the end of the run, the marks and the verdict say so: marks record the crest,
  so a run that stops before it reads low. River crests come hours after the rain: *Keep running after the storm* goes
  to 12 h.
- **Ida 2021 at Fairmount Dam** (Schuylkill, 1.7 × 2.3 km at 2 m, gauge-corrected MRMS rain, recorded inflow at the
  Philadelphia gauge, gauge start levels, run 14:06 UTC 1 Sep to 15:06 UTC 2 Sep, past both crests).
  - On the lidar surface alone the model was 1.6–1.9 m high at both gauges and the marks: the hydro-flattened river
    carried the flood above its channel.
  - The estimated channel (Appalachian Highlands curve, 1.55 m carved at the centre) gave −0.61 m at Fairmount and
    −0.29 m at 30th Street at the crest, marks −0.05 to −0.52 m. Those numbers were wrong for the right-looking
    reason: 1,540 of the river's 3,520 m³/s was pouring back out through the upstream edge (see Boundaries).
  - With the edge closed, the pool holds its level at base flow (3.48 m, observed 3.40). The crest is now 1.98 m high
    at Fairmount and 1.70 m high at 30th Street, still rising when the run ended. The marks are +2.2 to +2.6 m;
    HW Philly-11 is now flooded (−0.15 m). Below the dam the water surface falls 1.8 m in 550 m at 3.4–4.4 m/s: the
    carved channel is far too small there. The reach below Fairmount Dam is the tidal Schuylkill, a dredged estuary,
    and the curves are fitted to non-tidal alluvial streams: they carve it to about −1.1 m NAVD88.
  - With NOAA BlueTopo's surveyed bed below the dam (Channel bathymetry, above), both gauges track within about
    0.15 m from base flow to hour 15. 30th Street follows the ebb before the flood: low tide −0.36 m against −0.41 m
    observed, about 0.1 m high on the falling tide (the boundary is the Philadelphia tide gauge on the Delaware, not
    the Schuylkill's mouth). At the crest, Fairmount is +0.27 m and 30th Street +0.13 m, 22 min early (with the
    tide on only part of the channel: +0.14 m, 66 min late). Both crests are flat for hours, so their times are loose:
    the Fairmount model level is still within 2 cm of its highest at the end of the run.
  - The marks: four of five flooded, bias +0.32 m, RMSE 1.16 m.
    - The three in the pool above the dam read +0.55 to +1.44 m, growing toward the top edge. Philly-7 is 250 m from
      where the river comes in and reads +1.44 m. The flow enters there from rest, over a pool channel that is still
      estimated (BlueTopo stops at the dam), so the surface slopes far more steeply than the river's. Draw the box
      well upstream of the marks you score.
    - HW Philly-11 (a depth mark near Market Street, 1.83 m observed) stays dry in the model. Its observed level
      (5.44 m) is above the 30th Street crest (4.96 m), so it was probably local ponding, not the river.
  - The Cherry Street mark (4 m under the bridge deck) is not scored. The books (tide-edge run): surface 5e-7, with the
    pipes 6e-7. The gauge-corrected rain over the area (53 mm) is well under the radar alone (91 mm) and the gridded
    record (86 mm): not explained yet.

**Projects** (header *Projects* / *Save*, Ctrl+S; `app/projects.js`, `/api/projects` in the server, loopback only).
Each project is a folder in `Documents\FloodSim Projects` (override with `FLOODSIM_PROJECTS`):
- `project.json` holds the area and every setting.
- `infrastructure.geojson` holds the drawer layer.
- `scenarios/<name>/` holds each site-design scenario: `design.geojson` and `scenario.json` (settings, presets used,
  resolved FFE / pad and cut / fill per feature). `analysis.geojson` holds the control lines and the site boundary.
- `comparisons/<date_time>/` gets each exported comparison.
- `runs/<date_time>/` gets one folder per finished run: `summary.json`, `max_depth.asc` and `max_speed.asc` (ESRI ASCII
  + `.prj`, open in QGIS / ArcGIS), the SWMM `.inp` and report, the hyetograph, and the layer as run. Every run also
  saves its 1 m comparison grids (`grids/*.f32` + `.hdr`), its forcing fingerprint and its control lines. A run of a
  design scenario records the scenario, its grid hash and its features (`design.geojson`).

Opening a project rebuilds the model from the saved settings, and reloads a historic event if one was used.

**Batch studies and checkpoints** (map button *Batch*; `src/batch.js`, `src/checkpoint.js`, `app/batch-ui.js`,
`tools/batch.mjs`). A study is many runs, one after another, each filed in the project as an ordinary run:
- **Jobs:** every combination of design storms (Atlas 14 return periods × durations, or the storm as set now),
  scenarios (existing conditions and each site-design scenario), and variants. The variants are: as set,
  roughness × 0.8 or × 1.2, infiltration × 0.5, rain + 10 %, and one cell size coarser. Jobs run storm by storm with
  existing conditions first, so each with / without pair finishes together.
- **The study** is saved as `batch.json` in the project, with each job's status, run folder and wall time.
- **Checkpoints:** a run under way is copied into `runs/_checkpoint/` every few minutes of wall-clock time (default
  10). The copy holds the GPU solver's buffers byte for byte, SWMM's whole WebAssembly memory with its in-memory
  report files, and the run's own books and series, gzip-compressed: a few MB for a block, about 0.5 GB for the
  4.6M-cell Manayunk model (2.7 GB raw). Packing streams in 16 MB pieces, and the copy goes to the server in 64 MB
  pieces (a `.part` file renamed over the old copy at the end), since a browser can fail one upload of several
  hundred MB outright. A checkpoint that fails waits its full interval before the next try.
- **Resume:** a reload, a crash or *Pause* loses at most one checkpoint interval. *Resume* rebuilds the run from the
  same settings and puts the copy back. The forcing fingerprint must match the checkpoint's, or it refuses.
- **Headless:** `npm run batch -- "<project folder>"` runs the project's study in headless Chrome/Edge on the
  machine's GPU. It starts its own server, or reuses one with `--url`. After a browser or GPU crash it relaunches
  the browser (`--retries`, default 3), and the job under way carries on from its checkpoint. The page form is
  `map.html?project=<folder>&batch=run`.

Checked in the app on a 2 m model of 520 × 456 cells (10-yr 1-h storm, 158 inlets on a synthesized combined sewer):
- **Paused and resumed:** a run paused at 0:40, the page reloaded and the run resumed matches the uninterrupted run
  bit for bit. That covers every result grid (peak depth, level, speed, depth × velocity, wet time, time above
  15 cm, final depth, hazard), the inlet and pipe results, and SWMM's books. The surface infiltration book differs
  at 1e-7, the same as between two uninterrupted runs: it depends on when the page reads the GPU totals back.
- **Headless:** the same job run headless by `tools/batch.mjs` matches the in-app run cell for cell.
- **Peak-depth fix:** the test found that peak depth at an inlet giving water back (a surcharged manhole) depended on
  when frames were read back: a frame is read right after the inlet exchange, when the cell still holds that step's
  lump of returned water, before the next step's flux spreads it. The peak grid now comes from the solver's own peak,
  taken every step after the flux, and not from the frames. (A first fix took the peak in the exchange kernel too,
  which booked the lump itself: on the South Street test block one 2 m cell read 12 cm against a 5 cm wet threshold
  never reached, and carried $2.4 M of damage. The sensitivity section found it.)
- **Node tests:** `tests/run-checkpoint-tests.mjs` copies a SWMM engine half way through a run into a fresh engine.
  The two then produce the same 255,600 heads and close with the same continuity.

Not in a checkpoint: the export animation frames (the animation restarts at the resume). The frames held in the page
stop at 1.5 GB: past that, every other frame goes and the interval doubles (Manayunk's frames each 5 minutes came to
8.6 GB, and then a checkpoint could not be allocated).

## Phase 2 — rivers, culverts, storage, green infrastructure

**Rivers** (`src/river.js`). A 1D river from surveyed cross-sections runs in EPA SWMM (dynamic wave): one junction
per section, each reach split at its midpoint so each half takes its nearer section's shape, glass walls above the
banks, an inflow hydrograph upstream and a rating curve (tabulated outlet) downstream. Conveyance is split into channel
and overbanks at bank stations found from the section's shape. The river exchanges water with surface cells through
links: Villemonte-drowned broad-crested weirs along bank crests, openings with their own invert, and culverts. The
surface runs first each interval; SWMM then receives exactly the volume each link cell exchanged, so both models book
identical water. Verified on EA Test 7 (Severn at Upton, 72 h).

**Culverts and channel conditioning** (`src/channels.js`, `src/links.js`). Bare-earth lidar keeps the road
embankments that streams pass under. OpenStreetMap waterways tagged `tunnel=culvert` become culvert links between
their ends (size from `diameter`/`width` tags, else stream 1.2 m, ditch 0.6 m): inlet control part full, barrel
losses when submerged, reverse flow when the tailwater is higher. A culvert delivers downstream exactly what it took
upstream, one 2 s interval later. Mapped streams are first moved onto the 1 m thalweg: the least-cost path within 15 m of
the line, since NHD lines often run along a bank. Along it, two kinds of hump are breached to a straight grade 3 m
wide. One is a road embankment (≤ 30 m long, ≤ 4 m high) where a stream crosses a road with no mapped culvert. The
other is a hump with no road that spans the whole valley floor (crest 0.5–2 m, ≤ 40 m long): a bridge deck the lidar
kept, a culverted driveway or an artefact. Riffles, real ridges and humps the water can get round are left alone.

**Green infrastructure** (`src/gi.js`, Drainage → Green infrastructure and storage). Per solver cell, an extra
infiltration path into a store of fixed capacity that drains to the native soil (SSURGO soil-group rate). Permeable
pavement on a share of the streets stores 200 mm at up to 1000 mm/hr; rain gardens on a share of open ground store
300 mm at up to 100 mm/hr. Green roofs hold the first 25 mm of rain on their share of the roofs, then shed like the rest.
Stores drain between storms; the GPU applies the elapsed drain whenever a tile wakes, so tiled and untiled runs stay
bit-identical (tested), and the CPU reference matches to 1e-7 m.

**Storage** (`addTanks` in `src/drainage.js`). Underground tanks as SWMM storage units at the manholes feeding each
outfall (total volume split evenly). They fill when the last pipe runs full, so they cut surcharge and street flooding
upstream.

**Two-way inlet exchange (default).** When the pipes back up, manholes pressurise and water returns to the street
through the inlet on the head difference, as HEC-RAS does, instead of spilling at the rim; the return is capped per
manhole by what its pipes deliver. (Until Nov 2026 the cap took SWMM's lateral flow off the node inflow even when it was
the negative return itself, which raised the cap each interval on a surcharged network: on the Portland example 70,000 m³
came back up for 38,000 m³ taken in, combined books −183 %. Fixed; Davis moved by under 1 % of the return flow.) On HEC-RAS's Davis storm-sewer example it brought the pump peak, wet-well and node levels
into line with HEC-RAS (the volume pumped over the event is still 16 % under HEC-RAS's: more water stays ponded on the
surface at the end, 52.5k against 31.5k m³; `benchmarks/gatec/results/davis-compare.txt`), and on the mass audit it halved the combined error where the pipes surcharge
([`benchmarks/gatec/README.md`](benchmarks/gatec/README.md)). Untick it under Drainage for the older inlets-in-only coupling.

**Several exchange models at once.** The SWMM network, culverts and rivers share the solver's exchange cells through a
hub that reads them once per interval and hands each model its slice (`LinkHub`).

## Phase 1 — real terrain

**Flow:** Area (drag a box, or click out a polygon around the catchment) → Build model → Storm → Run → View → Export.
Runs continue in a background tab; the map redraws when you come back. The map opens on the whole US (or where you
last left it); the Examples menu holds sites in six states.

**Anywhere in the US.** Nothing is tied to one city. Where a national source has gaps, the app says so and falls back:
- **Design rainfall:** NOAA Atlas 14 covers everything except western Washington and Oregon. There the depth comes from
  a GEV (L-moments) fitted to the site's own annual-maximum rainfall, shaped like the largest recorded storm that has a
  real hourly record (older gridded hours that are just the daily total spread evenly are skipped), and labelled
  "site-record, no Atlas 14".
- **Rainfall record:** IEM Reanalysis (CONUS); in Alaska, Hawaii and Puerto Rico the nearest ASOS gauge's daily record
  (e.g. Honolulu → PHIK, 7 km), with gauge-only historic replays.
- **Land cover:** NLCD 2021 (CONUS), NLCD 2016 Alaska, NLCD 2001 Hawaii and Puerto Rico; elsewhere urban defaults.
- **Tide gauges:** NAVD88 where CO-OPS publishes it, else MSL (labelled; Hawaii).
- **Drainage:** the utility registry is a list (Philadelphia Water is the first entry, used only inside its service
  area); anywhere else, link your own layers or use the synthetic network.

**Polygon areas.** The model grid is the polygon's bounding box; cells outside the polygon become sinks (no rain, and
any water that flows into them leaves the model and is booked as outflow), so the polygon edge acts as a free overfall.
Flooded area and max depth are reported inside the polygon only; the export metadata carries the ring.

| Layer | Source | How it enters the solver |
| --- | --- | --- |
| Terrain | USGS 3DEP bare-earth DEM, requested at 1 m in the local UTM zone | Bed elevation; native source resolution is checked against the 3DEP catalog and labelled (1 m lidar = tier 1) |
| Buildings | OpenStreetMap footprints (Overpass, three mirrors) | Wall cells (reflective); roof rain routed to the open cells around each building (connected fraction slider) |
| Streets | OSM drivable highways, width by class | Manning's n = 0.016, zero infiltration; optional 15 cm curb burn (auto: only when the DEM source is coarser than 1 m, because 1 m lidar already resolves curbs) |
| Land cover | NLCD via MRLC WMS (2021 CONUS; 2016 AK; 2001 HI, PR), colour-matched to classes | Manning's n table and impervious fraction (`src/terrain.js`) |
| Soils | SSURGO via Soil Data Access (dominant hydrologic soil group) | Constant infiltration capacity: A 10, B 5, C 2.5, D 1 mm/hr × (1 − impervious); "Urban land" = compacted fill 2 mm/hr; dual groups use the undrained letter |
| Rainfall | NOAA Atlas 14 PFDS at the domain centre (partial-duration series, median + 90% bounds) | Design-storm hyetograph, uniform in space (see below) |
| Basemap | USGS orthoimagery (public domain) or Esri World Imagery | Display only |

**Resolution and downscaling.** The DEM is always fetched at 1 m. The solver runs at 1, 2 or 4 m (the UI shows cell
count and GPU memory against the adapter's buffer limit; ~1 M cells at 1 m runs ~45× real time on an RTX 50-series GPU,
2 m ~240×). At 2–4 m a solver cell is a wall if more than half of it is building, its bed is the mean open-ground
elevation, and depths are downscaled to the 1 m DEM by water-surface projection (`src/downscale.js`): WSE is interpolated
over wet solver cells and intersected with the fine terrain. This is exact for still water and a good approximation for
gentle surface slopes, but it cannot create flow paths the coarse grid missed — 1 m solves are preferred when they fit.
Synthesising sub-1 m terrain (DEM "super-resolution") is deliberately not done: it isn't reliable enough for hydraulics.

**Design storms** (`src/storm.js`). Pick a return period (1–1000 yr), a duration (30 min–24 h), a time pattern, the
estimate (median or either 90% bound) and an optional climate uplift on depths. Depths between Atlas 14 durations are
log–log interpolated. The default pattern is the alternating block method on 5-minute blocks: the k blocks around the
peak always hold exactly the Atlas 14 depth for k·5 min, so the storm matches the site's depth–duration–frequency curve at
every sub-duration (tested to 1e-13 mm). Peak position can be centred, early (0.375) or late (0.75); "uniform" spreads the
same total evenly. Because every duration's T-year depth is nested in one event, alternating-block storms are peakier
than any single observed storm; for long durations the Atlas 14 quartile temporal distributions or NRCS curves are the
planned alternative. The solver never lets a frame straddle a block change, so delivered rain matches the hyetograph
exactly (100-yr 1-hr at Eastwick: 73.0000 mm delivered vs 73 mm Atlas 14). Atlas 14 doesn't cover western Washington
and Oregon; there the site-record design storm above is used.

**Historic storms** (`src/history.js`). After a build, the Storm panel lists the events that hit the site: the 12 wettest
rain events in the IEM Reanalysis daily record (1995 →), named when a NOAA HURDAT2 hurricane track passed within 250 km
at the time, plus every other hurricane passage within 250 km (surge events like Sandy rain little but matter on the
coast). *Another date…* takes any day since 1995 instead: a short cloudburst (Portland's 0.75 in in 40 minutes on
12 Sep 2018) never ranks among the wettest days, and the ±1 day either side holds a storm that crosses midnight UTC.
Loading an event rebuilds its rainfall at the site from one of:
- **Site totals, gauge timing (default):** IEM hourly gridded precipitation at the site, distributed inside each hour by
  the nearest ASOS 1-minute gauge (method of fragments; site hourly totals preserved exactly). Isaias 2020 at Eastwick:
  150 mm, 177 mm/hr peak 5 min, 1 h ≈ 68-yr and 3 h ≈ 95-yr against the site's Atlas 14.
- **Site rainfall (hourly):** the gridded series alone.
- **Airport gauge (5 min):** the gauge alone (PHL is 4 km away but caught 106 mm to the site's 150 for Isaias).

Each event is graded against Atlas 14 (5 min to 24 h windows). Where a NOAA CO-OPS tide gauge is within 60 km, its
observed water level (NAVD88, the 3DEP datum) drives a **water-level boundary** on the model edge where tidal water
leaves it, and the stage at SWMM outfalls that discharge to streams; the run window is padded to span the surge peak.
The edge cells (`tidalEdgeCells`, `src/waterlevels.js`):
- start from open water on the edge (NLCD water or wetland, or a mapped river within 30 m) whose lidar surface lies
  within the tidal range (at most 0.3 m above the run's highest stage);
- widen along the edge over ground below that highest stage, so the channel holds the level from bank to bank, not
  only the cells land cover calls water;
- leave out a pool above a dam, a stream crossing the edge higher up, and a river's closed inflow edge: those stay a
  free outfall, or a wall, as before.
At Fairmount this is the tidal Schuylkill at the south edge, 62 cells (124 m) bank to bank. Before, it was 35 cells of
the channel (land cover marks only its middle as water), plus 138 cells where the tide never applied: the closed
inflow edge above the dam and a corner 12 m up. The baseflow warm-up holds the tide at its level at the storm's start.
The rest of the edge stays a free outfall.

**Compound flooding and sea-level rise** (Storm → under the design storm; `src/compound.js`, report section
`app/report-compound.js`). Where a tide gauge was found, its NOAA CO-OPS station datums, sea-level rise projections and
extreme water levels load with the model:
- **Datums.** CO-OPS serves them on the station datum; with the station's NAVD88 value they become NAVD88 (MSL, flagged,
  at a station with no NAVD88). Philadelphia 8545240: MHHW 1.094 m, MSL 0.118 m, MLLW −0.945 m NAVD88, epoch 1983–2001.
- **Sea-level rise.** The 2022 Interagency Technical Report scenarios, Low to High, as CO-OPS serves them for the
  station (`slr_projections`, cm, 0 in 2005), moved to the datum epoch's mid-year with NOAA's own offsets
  (`slr_projectionOffsets`: 1992 → 2000 and 2000 → 2005), so a rise adds straight onto MHHW. Philadelphia, Intermediate:
  +0.21 m today (2026), +0.43 m by 2050, +1.21 m by 2100 (High: +2.04 m). "Observed trend" is NOAA's trend at the
  gauge (3.15 mm/yr). Years from today to 2150.
- **Design tide** for a design storm (Atlas 14, site record or custom): the open water on the edges takes
  - still water: MHHW + a surge + the rise, for the whole run;
  - a tide cycle between MLLW and MHHW (period M2, 12.42 h), with high or low water at the rain peak;
  - or NOAA's harmonic prediction for a chosen date, shifted so its high (or low) water nearest noon UTC falls at the
    rain peak;
  each plus the surge and the rise. The surge is none, a custom height, or NOAA's 1- to 100-yr extreme water level (a
  GEV on the detrended annual maxima, metres above MHHW; Philadelphia 100-yr: 1.23 m). The design tide is a
  water-level series like an observed one, so it drives the same tidal edge cells, the warm-up, the starting tidal
  water and the forcing fingerprint exactly as a historic tide does. A historic event's observed level can be raised by
  the scenario's rise from the event's year to the scenario year.
- **Joint rain–surge probability** (button). Two-sided conditional sampling (Bender and Jensen 2017; Jane et al. 2020):
  - each year's wettest day with the highest water within ±1 day (rain-driven), and each year's highest water with
    the most rain within ±1 day (surge-driven);
  - rain from the nearest ACIS gauge with 40 years of current daily record; water from the CO-OPS daily highs,
    detrended to the datum epoch;
  - Kendall's τ per sample gives a Gumbel copula (θ = 1 / (1 − τ); independence for τ ≤ 0);
  - marginals: GEVs by L-moments of the driver's annual maxima (the rain record; NOAA's detrended annual maxima for
    water) and of the concurrent variable in its sample (a point mass at zero rain).
  
  The section reports AND isolines (both exceeded in a year) at 10, 50 and 100 years, and four 100-yr design pairs:
  - the most likely event of each sample, the largest joint density on the part of the isoline where that sample's
    driver is the rarer of the two;
  - the 100-yr rain with its conditional median water;
  - the 100-yr high water with its conditional median rain.

  "Use" sets a pair as the storm: Atlas 14 24 h at the rain's return period (annual maximum converted to partial
  duration, nearest offered), with a still design tide at the pair's water level.
  
  Philadelphia: PHL airport (10 km, 85 years of rain), 36 paired years. τ is 0.10 in the rain-driven sample and 0.37
  in the surge-driven one. The 100-yr design pairs:

  | Pair | Rain | Water above MHHW |
  | --- | --- | --- |
  | 100-yr rain + its median water | 188 mm/day | 0.49 m (1.3-yr) |
  | 100-yr high water + its median rain | 140 mm (25-yr) | 1.26 m |
  | Most likely, rain-driven | 114 mm (10-yr) | 0.92 m (10-yr) |
  | Most likely, surge-driven | 146 mm (30-yr) | 1.17 m (51-yr) |
- **Batch.**
  - Variants SLR Intermediate 2050 and 2100, Intermediate-High 2100 and High 2100. They put a still MHHW tide on a
    design storm when none is set, and raise a historic one.
  - After a joint analysis, the four design pairs appear as storms.

The report section has:
- MHHW in NAVD88 by scenario and year, with rise tables since the epoch and since 2000;
- the datums and NOAA's extreme levels;
- the isolines with the pairs, and the samples' τ;
- each run's downstream water level, with its rain peak.

Limits:
- the dependence of the daily events stands in for that of the annual maxima;
- the daily rain is a calendar-day gauge total, and a design run takes Atlas 14 at the same return period, not this
  depth;
- a still surge is held for the whole run (conservative for a short storm);
- waves, river–tide interaction upstream of the model and the tide's change in range with sea-level rise are not
  included.

**Drainage** (`src/drainage.js`, `src/coupler.js`, `src/swmm.js`). Three tiers, labelled on every output:
- **Tier 2, synthetic network:** manholes with grate inlets every ~60 m along OSM streets (residential and up), outfalls
  at mapped streams and where streets leave the area, a drainage tree by Dijkstra from the outfalls (penalising
  adverse slopes), pipes sized by the rational method for the site's Atlas 14 design storm (10-yr default) with Manning
  full-flow diameters rounded up to standard sizes and never shrinking downstream, 1.2 m cover, ≥ 0.5 % slope.
  Eastwick: 212 manholes, 11 km of 300–1200 mm pipe, 26 outfalls. Simulated by EPA SWMM 5.2.4 (dynamic wave) compiled to
  WebAssembly, coupled every 2 s: the GPU moves water between street and inlet (weir flow when free, orifice flow when
  deep or surcharged, either direction), SWMM receives exactly the volume the surface gave up, and node overflow returns
  to the street. The network is exported as a SWMM `.inp` (with UTM coordinates) for PCSWMM / SWMM5.
- **Tier 3, lumped rate:** a capacity in mm/hr over the area, removed from street cells.
- **None.**

**Coupling design** (each choice was forced by a failed alternative, kept as history in the tests):
- Inlets only take water *in* (weir / orifice / submerged orifice on the head difference, zero once the network is at
  street level). A reverse orifice withdrew water that SWMM's near-zero manhole storage did not hold (−4.6 % continuity).
- Water comes back up only as SWMM node overflow. The coupler advances SWMM one routing step at a time, integrates each
  node's overflow exactly as SWMM books it, returns it to the street over the next interval and credits it back to
  SWMM's inflow. (End-of-interval sampling mis-stated it by 24 %; sealed manholes spiked heads to the surcharge cap.)
- Every manhole without a grate gets a lid point (0 grates) so its overflow still reaches the street.
- SWMM runs with the Preissmann slot surcharge method and conduit lengthening; EXTRAN gave −4.6 to −6 % continuity on
  the surcharged South Street network, SLOT −0.35 %.

Verified on South Street (Philadelphia, 0.46 × 0.42 km, 1 m, 127 real PWD inlets, 100-yr 1-h + 30 min, ~47× real
time): surface balance 9e-5, SWMM continuity −0.35 %, flooding 119 m³ returned 120 m³, combined surface + network
balance −0.21 %.

**Real utility inlets** (`src/utilities.js`). Areas inside a registered utility pull its open GIS during Build: for
Philadelphia, every PWD inlet (85,603 citywide, ~±1 ft), outfalls and the combined-sewer service area. Each grate is
snapped to its street; grates within 12 m share a manhole but keep their own exchange cell; grates > 25 m from a
modelled street get a lateral (≤ 60 m) or are reported unconnected. PWD does not publish its mains, so pipes stay
synthetic and the tier is labelled 2+. Add a city by appending its ArcGIS layer URLs to `UTILITIES`.
New York City (NYC DEP) comes from NYC Open Data (Socrata): catch basins (2w2g-fk3i) and outfalls (8rjn-kpsh). Its
combined-sewer test is the share of the area outside DEP's separate-storm-sewer (MS4) drainage areas, bundled as
`src/nyc-ms4.js` (438 polygons, simplified to 30 m), since that layer is a download only: under half separate counts as
combined. The Forest Hills box is 10 % separate (combined), with 3,534 catch basins and 95 outfalls.

**Your own data** (`src/linked.js`, `src/network-real.js`). Under Area → "Your own drainage data", paste links to public
ArcGIS layers (…/FeatureServer/0, …/MapServer/1) or GeoJSON files for pipes, inlets and outfalls; Check links shows what
each holds and which fields will be used. Build fetches only the features in the area. Pipe links make a **tier 1**
network: ends snap within 1.5 m, laterals that stop on a main's side are joined there, catch basins join the nearest pipe
within 30 m (splitting it), abandoned / proposed pipes are dropped, sizes over 6 m are treated as placeholders and filled
from neighbouring pipes, box and multi-barrel culverts become SWMM RECT_CLOSED with barrels, inverts are used when
plausible against the lidar (metres or feet) and otherwise derived (cover over the crown, ≥ 0.5 %, never rising), and
the whole network is oriented toward its exits so flat streets do not create sinks. Verified with West Hollywood's
public storm drains (mains + laterals + catch basins, inches, no inverts): 100-yr 1-h, SWMM continuity −0.04 %,
combined balance −0.002 %.
- **A filter on a link:** `…/MapServer/108?where=LAYER_GROUP%20IN%20(%27SEWER%20PIPES%27)` takes part of a layer
  (encoded, since links are split on spaces and commas): utility layers often mix mains with service laterals.
- **Inverts on a local datum:** *Add to inverts (to NAVD88)*, in the inverts' own units (City of Portland datum:
  +2.10 ft). An invert of exactly 0 is read as missing, as utility layers leave it.
- **Each invert on its own:** once the layer's units are settled (metres or feet, by how many pipes sit plausibly under
  the lidar), an invert is used only where it lies 0.2–30 m under its manhole's ground; a pipe with one good end gets the
  other at its ground slope (≥ 0.5 %). Before this a missing end became 0 m: on the Portland example 40 pipes had an
  end 40–65 m under the street, heads rose 26 m above it and the combined books were off by 223 % (the model checks
  flagged it as a Problem). The network stats count both (`invPartial`, `invRejected`).
- **Field names:** `FRM_ELEV` / `TO_ELEV` count as up / down inverts and `PIPESHPE` as the shape; ArcGIS's own geometry
  fields (`Shape`, `Shape_Length`) are never taken for the pipe shape.
- **Combined sewers from the layer:** a system field (`UNITTYPE`, `SYSTEM`, `SEWER_TYPE` …) reading *Combined*, `COMB`
  or a combined unit code (Portland's `CSML`) marks a pipe combined. When most linked pipes are, the build sets the
  combined-sewer defaults (roof downspouts 100 % to the sewer, sanitary flow and CSO regulators on), as it does inside
  Philadelphia's combined-sewer area.
- The *Manayunk, Philadelphia PA* example (Ida 2021) is the largest: 5.3 × 3.4 km, 18.4M 1 m cells on a 2 m solver, with
  the Schuylkill (Norristown gauge) and Wissahickon Creek flowing in. The page holds up to 20M 1 m cells
  (`MAX_FINE`), and the readbacks space out with their cost. Scored against 15 USGS marks and the Manayunk gauge
  it was 1.3 m low with the river leaving across a free-outfall edge. With a river outlet held from the Philadelphia
  gauge it is 0.8 m low at the Manayunk gauge and 0.6–1.1 m low at the wet river marks (all 11 scored: bias −0.66 m,
  RMSE 0.85 m), evenly along the reach (docs/METHODS.md §5.8).
- The *Forest Hills, Queens NY* example (Ida 2021) is street flooding from rain alone: 3.6 × 5.2 km, 18.7M 1 m cells
  on a 2 m solver, DEP's real catch basins on a synthesized combined sewer, 20 h of gauge-corrected radar rain in
  2.4 h. Against the 25 outdoor USGS marks the model is low: bias −0.20 m, RMSE 0.62 m, 18 of 25 flooded, 0.5 m low
  on the hill around Austin St and 0.7 m at the low end by the Grand Central Pkwy. It floods 33 % of USGS's mapped
  flooded cells (CSI 14 %). Its rain is 0.8 of the nearby gauges, and its sewer, sized for the 10-yr storm, never
  surcharged, while 311 took 89 sewer-backup calls: both point the same way (docs/METHODS.md §5.9).
- The *Laurelhurst, Portland OR* example links the City of Portland's open combined-sewer mains and inlets with the
  datum offset: 370 mains (335 combined) and 476 inlets in 1.3 km², 446 SWMM conduits (420 surveyed, inverts from the layer). The dev proxy only reaches links on public https hosts (never localhost or private
addresses), GET only, and every request must carry the app's `x-floodsim` header, so other web pages cannot use it.

**Roofs and outlets.** In combined-sewer areas roof downspouts feed the nearest manhole directly (slider in Drainage,
default 100 % where the utility marks combined sewers, 0 % elsewhere); the rest still lands around each building.
Where pipes leave the area they continue 100 m off-site to a normal-depth outlet instead of a free outfall, so
downstream capacity and backwater are felt. South Street, 100-yr 1-h: 6,534 m³ piped from roofs, area flooded
> 15 cm 5,026 → 2,332 m² (yard ponding was the roof-routing artefact), SWMM −0.27 %, combined −0.23 %.

**Combined sewers** (`src/cso.js`; Drainage → Combined sewers, on by default where the utility marks combined sewers).
Each manhole gets sanitary flow from the people it serves: every 4 m block of developed land goes to its nearest
manhole (within 150 m), at 8 / 25 / 60 / 120 people per ha for NLCD open / low / medium / high intensity (or one
density you set), times 300 L per person per day. Census counts are not fetched; these are planning defaults. The
flow follows a typical residential day (low at night, a morning peak 1.43 × the mean) as SWMM `[DWF]` with an hourly
pattern, turned to the local hour the run starts (UTC + longitude / 15, no daylight saving; design storms start at
06:00), and the pipes start full of it. Every outfall to a stream becomes a regulator: an outlet sends flow on to the
interceptor (an outfall of its own, booked separately) up to its capacity, 3 × the peak dry-weather flow above it by
default (at least 5 L/s), and a weir set where the outlet reaches capacity spills the rest to the river. Overflow
outfalls on tidal water carry a flap gate (SWMM `Gated YES`, the stage from the tide boundary) when the run has a
CO-OPS water level. The report's Combined sewer overflows section gives, per regulator, the overflow volume, peak,
hours overflowing and events (overflow above 0.1 L/s; spells less than 6 dry hours apart are one event), the flow to
the interceptor, and capture: interceptor / (interceptor + overflow), and again with the dry-weather volume taken out.
Checked in SWMM: a day of dry-weather flow books 25,917 m³ against the pattern's 25,920; 200 L/s into a 42.8 L/s
regulator sends 42.8 to the interceptor and 157.2 over the weir; a tide 1.5 m up the outfall fills the last manhole
1.0 m without the gate, 0 with it. Pipes leaving the area are not regulated: they still continue off-site.

**Starting from a blank map:** type an address or place into Find (US Census geocoder, OSM Nominatim fallback), click
Draw area, drag a box (releasing anywhere, even over a map control, finishes it), Build model, Run.

Build the SWMM engine once (needs the Emscripten SDK on PATH): `npm run build:swmm` → `vendor/swmm-wasm/`
(452 KB wasm; built here with emsdk 6.0.13). `npm run test:swmm` drives the engine on the Eastwick network fixture.
Without it the network is still generated, drawn and exported, but runs treat it as absent and say so.

**Boundaries.** Real-terrain runs use `outflow` edges, a free outfall: the edge cell discharges at the Manning velocity
on the water-surface slope toward the edge (beyond 1 in 10,000, and only with a wet neighbour), capped at critical
flow. A level or inward-sloping surface gives zero velocity, so ponds touching the edge stay put and nothing flows in.
Two earlier designs failed on real terrain and are kept as tests: plain zero-gradient edges imported water where lidar
slopes into the domain (~3,000 m³ and a 6.8 m mound on the first Philadelphia run), and zero-gradient-with-reflection
edges let still water drain through the boundary from round-off. Open-water edges can instead carry an observed water
level (`stage`), which is well-balanced: still water at the stage stays at rest to the fp32 floor.
A river leaving the area can hold a level too (Storm → River leaving the area, historic storms; `src/outlet.js`):
enter a downstream USGS gauge and the river's length to it. The edge facing the gauge holds the gauge's recorded water
surface plus the backwater rise up that reach at its recorded discharge (standard step on the edge's own
cross-section, taken as prismatic). Without it a deep river pours off the edge as if over a fall and draws down
upstream. At Manayunk it cut the gauge's crest error from −1.51 to −0.80 m; the prismatic reach leaves out the bridges
and islands below, and the edge there still sat about 0.5 m low (docs/METHODS.md §3.7, §5.8).
*Reach → lidar cross-sections* steps up the real river instead: the NHDPlus main stem from the gauge to the edge,
sections every 200 m from the 3 m DEM with a channel carved under the water the lidar sees, velocity heads and
contraction / expansion losses. It needs the channel's depth (*Channel depth*, else the bathymetry's): at Manayunk the
edge level moves 0.4 m per metre of it, so prismatic stays the default where the channel is not surveyed
(`node tools/outlet-reach.mjs` prints both for a gauge and a box).
Where a river enters across the edge, the edge is closed across it, the channel plus 10 m each side. The channel is
the run of edge cells within 1.5 m of the lowest lidar water surface near the entry. The flow goes in over that width,
two rows inside. Before this, the flow went into the 12 lowest cells at the entry point. There it mounded up and poured
back out through the edge's outfall. In a test channel 53% of the inflow left that way. On Ida at Fairmount Dam,
1,540 of the Schuylkill's 3,520 m³/s went straight back out, and the pool ran 0.6 m low at the crest.

**Views** (2D, synced to the map): depth, max depth, velocity, hazard rating HR = d·(v + 0.5) in DEFRA/EA FD2320 classes.
Hover any cell for elevation, land cover, depth, speed and max depth.

**Export** (`.zip`): `terrain/heightmap_16bit.png` (Unreal Landscape, scales in README.txt), `terrain/dem_1m.exr`,
`buildings/buildings.glb` (extruded OSM footprints), `results/max_depth_1m.exr`, `results/frames/*.exr` (R = depth,
G = speed, on the solver grid), and `metadata.json` (CRS, origin, cell sizes, data sources and licences, run parameters,
mass balance).

**HEC-RAS 2D package** (Export → *Download HEC-RAS 2D package*; `src/hecras.js`, `src/tiff-write.js`,
`src/shapefile.js`). The model as inputs for a HEC-RAS 6.x 2D build, so a reviewer can rebuild it in RAS. RAS builds its
own terrain (.hdf) and mesh from these; no RAS project, plan, geometry or unsteady-flow file is written.
- `terrain/terrain_model.tif`: the ground the model ran on, at 1 m. That is the lidar with the channel bathymetry carved,
  the curb burn and any site design. The format is float32 GeoTIFF, deflate, NAD83 / UTM (EPSG 269xx) and NAVD88
  (vertical GeoKeys 5703 / 5103). `terrain_buildings_raised.tif` is the same with the footprints raised by their height
  (at least 3 m).
- `landcover/landcover.tif`: the NLCD class per pixel (uint8), with 254 for an OSM street and 255 for a building.
  `landcover_classes.csv` gives each class its ID, name and Manning's n as FloodSim used it (× the calibration
  multiplier). `mannings_n.tif` is n per pixel.
- `gis/*.shp` (with `.shx`, `.dbf`, `.prj` ESRI WKT):
  - `perimeter`: the box or polygon;
  - `bc_lines`: boundary-condition lines, from the run's own edge treatment:
    - each river entry's closed edge run as a Flow Hydrograph;
    - the tidal edge cells as a Stage Hydrograph;
    - the rest of the edge, FloodSim's free outfall, as Normal Depth, with a friction slope from the ground 20 m inward
      (0.05–5 %: an estimate);
  - `breaklines`: drawn barriers, and the carved channel's banks traced from the carve mask and simplified;
  - `buildings`;
  - `internal_inflows`: rivers that enter inside the area, for a RAS internal BC line.
- `boundary/*.csv`: each series in UTC and hours from the start, in SI and US columns. Flows are sampled every 5 min;
  the tide every 6 min.
- `precip/hyetograph.csv`: the rain over the area. With a radar storm, `precip/grid/*.tif` holds 15-minute MRMS
  totals (lon/lat GeoTIFF), listed in `index.csv`.
- `README_HEC-RAS.txt`: the RAS Mapper steps, and `hecras_package.json`, which has the same as data.
- Not exported: the storm sewer (the 3D package has it as SWMM), culverts, ponds and GI, and starting water levels.

**Caching.** `server/server.mjs` proxies an allowlist of open-data hosts and caches responses in `.cache/`, so rebuilding
an area is instant and works offline. Overpass is the least reliable source (public servers return 429/504 under load).

### Phase 1 known limits

- Without linked pipes, pipes are synthetic even where inlets are real; combined-sewer regulators are generic (an outlet to
  the interceptor at a multiple of peak dry-weather flow, a weir for the rest), not the utility's structures, and
  population comes from land-cover densities, not the census; pipes leaving the area are not regulated
- 1D–2D exchange every 2 s sets the pace on small domains (~47× real time at 190 k cells)
- Design-storm rain is uniform over the domain (no areal reduction factor); historic storms can use MRMS radar (cell by cell); Atlas 14 temporal distributions not yet offered
- Rivers come from hydro-flattened lidar: the channel below the flight-day water surface is missing unless you estimate it
  (Channel bathymetry; NOAA BlueTopo surveys where they exist, mostly navigable and tidal water; regional curves elsewhere)
- Water from upstream of the drawn area is ignored unless the model runs on its watershed (Area → Watershed traces it
  and the model checks grade the share that drains in); the drainage network is built over the polygon's bounding box, so inlets outside the polygon sit in dry sink cells
- Max speed in the .asc exports and the 3D package is sampled at the display frame rate (where over 1 cm); the run
  folder's grids/max_speed.f32 is tracked every solver step (where over 5 cm), so the two can differ slightly
- OSM footprint completeness varies by city; Microsoft/Overture footprints and lidar nDSM heights are the upgrade

## Phase 0 — solver core

Browser-native 2D shallow water solver: the physics core of the urban flood modeling platform.
One scheme, written twice: a fp64 CPU reference (`src/solver-cpu.js`) and WGSL compute kernels
(`src/kernels.wgsl.js`, hosted by `src/solver-gpu.js`) that are verified against it.

## Numerics

- Conservative 2D shallow water equations, finite volume, structured grid, 2 ghost layers
- MUSCL reconstruction of h, η = h + z, u, v (minmod default, van Leer optional); first-order fallback
  where any stencil cell is shallower than `hfront` (1 mm)
- Hydrostatic reconstruction (Audusse et al. 2004): well-balanced, handles wet/dry
- HLLC Riemann solver (Toro), dry-bed wave speeds
- SSP-RK2 (Heun); CFL on λx + λy (0.48 second order, 0.9 first order)
- Draining-time flux limiter: a cell never exports more water than it holds → positivity with exact mass
- Semi-implicit point-wise Manning friction
- Rainfall (with optional per-cell multiplier for roof routing) and constant-capacity infiltration sources;
  buildings as reflective wall cells; wall / open (transmissive) / outflow-only boundaries
- Full mass accounting: rain, infiltration, boundary outflow, storage (and clipped volume, which is now zero). Depth
  carries a Kahan residual and per-cell totals are folded into fp64 on every read, so fp32 round-off in cells that
  exchange water every step for hours does not accumulate. A read copies the depths and totals and restarts the
  totals in one GPU submission, so a save during a run cannot lose or double-count the steps queued around it (before
  this, saving mid-run could leave a mass error of a few 1e-5)
- Boundary outflow is booked per edge face with a Kahan residual (as the inlet books). A plain fp32 total per edge
  cell lost ~1e-5 of the volume when a river carried hundreds of m³/s out through a few cells between reads.
- The mass error is relative to all the water that came in (initial + rain + net inflow through the edge or exchange
  cells), as HEC-RAS reports volume error against starting plus inflow volume.
- GPU batches are sized from the mean length of the last batch's steps. (They used the last step, which is zero when a
  batch ends on its target time, so every batch queued the maximum ~260 steps, mostly empty; fixing it made the 1 m
  South Street run 2.5× faster.)

GPU layout: per step dtReduce, dtFinal, then per RK stage prim → faceX → faceY → theta → update, then sources (and
the inlet exchange). The time step lives on the GPU, so many steps run per submit with no readback.

**Active tiles.** The grid is cut into 8×8 tiles. Each step a pass marks tiles holding any water (h > 0), plus tiles
with inlets or stage cells, and builds two lists on the GPU: wet tiles grown by one tile (update, sources) and by two
(fluxes, theta). Those kernels run through `dispatchWorkgroupsIndirect` on the lists only; water moves less than a cell
per RK stage, so the result is bit-identical to the full grid (tested). While it rains everything is active. 4.3× faster
on a 1600×1600 dam break with ~7% of tiles wet. Needs 9 storage buffers per shader stage (requested from the adapter;
below that the solver runs untiled). A dispatch is at most 65,535 workgroups along a dimension, and a larger indirect
one is dropped whole, so the lists dispatch in rows of 32,768 tiles: above about 4.2M cells the solver otherwise froze
with the river entries still filling (tested on a 2,112 × 2,112 grid, 70,225 tiles, bit-identical to untiled).
Bed elevations are stored relative to the domain minimum for fp32 headroom.

**Local time stepping (opt-in, `lts: true`; the "Local time stepping" box under the cell size).** One global step is
set by the fastest cell: a 7 m tidal Schuylkill (waves ~8 m/s) holds a million shallow 1 m cells to ~0.1 s. With LTS
each 8×8 tile steps at its own power-of-two step. A cycle of length D (the global CFL step × 2^L × 0.9, capped at the
time left in the frame, so exchanges, culvert links and frame ends land on a cycle end) is cut into 2^L base steps δ;
a tile's level is the largest m ≤ L (default 3, so up to 8δ) with its CFL number under 0.9 at 2^m δ, over the fastest
speed in the tile and its eight neighbours (so a wave cannot run into a coarser tile within a cycle), then smoothed so
face neighbours differ by at most one level. The records run finest first: after base step k every level m with
2^m | k+1 takes one full SSP-RK2 step of its cells, over only its faces (a face belongs to the finer of its two cells).
Mass stays exact the usual way for LTS: a cell one level coarser that borders a face of a finer step does not move,
it gathers the flux it was sent (½·dt per RK stage, the stage weight) and the store joins the start state of its own
next step, so both sides see the same integrated flux. (Adding the store before the step instead broke still water:
the momentum flux came in a step before the bed-slope term that balances it.) The draining-time limiter counts only
the record's faces, against the cell's depth plus its store. Sources, rain, Green-Ampt and GI, hazard, inlet exchange
and the edge and barrier and line books follow the cell's (or face's) level and the record's end time; banks run once
per cycle. One cycle counts as one step in `steps`. The fp64 CPU reference (`CPUSolver` `o.lts`) has the same scheme,
and the GPU matches it to 3e-7 m on the dam breaks. Off (stepping globally, the reason in `solver.ltsOff` and the run
log) in the subgrid speed mode, with sediment or debris (their exchange with the bed is not split per level), and
untiled (under 9 storage buffers).

| LTS vs global stepping | |
| --- | --- |
| Stoker / Ritter dam breaks, 400 cells, L1 | 1.599e-3 / 2.529e-3 (global 1.602e-3 / 2.531e-3); GPU vs CPU LTS 3e-7 m |
| Still water at a stage boundary, bed at 100 m, 120 s | max \|u\| 9e-5 m/s (CPU 4e-14) |
| Deep channel (6 m) across a wide shallow floodplain, 256×192, 60 s, CPU | 2.9× fewer cell updates, 38 → 28 s; Δh 9e-4 m channel, 5e-4 m floodplain; mass 7e-13 |
| The same at 1024×768, GPU | 2131 steps → 296 cycles, 7.5 → 2.9 s (2.6×); Δh 8e-4 m channel, mean 7e-6 m floodplain (max 9 mm, on the spilling front); peak depth mean 2e-5 m; mass 4e-9 |
| The same at 256×192, GPU | 1.0 → 1.7 s (0.6×: dispatch-bound) |
| Books, 600 s: rain, Green-Ampt, an inlet, a weir across the channel, a control line, edge outflow | line 367.53 = 367.53, weir 398.864 vs 398.863, inlet 12.00 = 12.00, infiltration 82.8 = 82.8, edge 3574.0 = 3574.0 m³; mean \|Δh\| 3e-4 m |

## Verification (all pass)

| Test | CPU fp64 | GPU fp32 |
| --- | --- | --- |
| Stoker wet dam break, 400 cells, L1 | 1.6e-3 (order 1.0) | 1.6e-3 |
| Ritter dry dam break, 400 cells, L1 | 2.5e-3 (order 1.0) | 2.5e-3 |
| Lake at rest, submerged bump, max \|u\| | 2e-14 m/s | 9e-6 m/s (bed at 100 m) |
| Lake at rest, emergent island, max \|u\| | 2e-14 m/s | 1e-5 m/s |
| Thacker paraboloid, 100 cells, L1 at T | 2.5e-2 (order 1.5) | 2.5e-2 |
| Rain-on-grid mass balance | 4e-15 | 2e-7 |
| Urban cloudburst (app terrain) mass | 5e-15, 0 m³ clipped | 4e-7, 0 m³ clipped |
| Valley dam break (app terrain) mass | 1e-16 | 1e-8 |
| GPU vs CPU, rain case, max \|Δh\| | – | 5e-6 m |
| Active tiles vs full grid, 640×480 dam break, max \|Δh\| | – | 0 (bit-identical) |
| EA 2D benchmarks 1–7, inside the packages' spread | – | 88 / 94 measures (`benchmarks/ea`) |
| Green infrastructure: CPU parity, tiled = untiled | – | 9e-8 m, bit-identical |
| Flood barriers: overtopping vs CPU, books, tiled = untiled | weir rate within 2 % of C·H^1.5 | 2e-5 m, books 4e-7, bit-identical |
| Hazard products every step vs CPU (classes, force, duration, arrival) | – | 0 class differences, force 9e-5 kN/m, times exact |
| Sediment, 4 grain classes: settling vs exact; dam break over loam and sand–gravel (solids per class, water, coarsening) | – | 0.001 %; solids ~1e-6, water ~1e-7, 45 % of scoured cells coarser |
| Debris flow: a 40 % slurry down a 20° gully onto a fan (solids per class, water books of the mixture) | – | solids 1e-7, water 2e-7, peak concentration 52 % |
| Bank stability: kernel FS vs `src/banks.js`; drawdown of a full channel; conditional probability vs Monte Carlo | dry sand fails at φ′ within 3 %; 98.58 % vs 98.53 % | 2e-7; FS 1.73 → 0.69 |
| Starting water levels: parallel rise, flat lake fill, datum rules | exact | – |
| Green-Ampt and scour vs CPU (infiltrated volume, shear, scour depth) | ponded GA within 0.3 % of analytic | 1e-7, 1e-4, 3e-4 mm |
| Subgrid speed mode vs 1 m run, 320 m urban cloudburst (4 m / 8 m) | – | peak depth MAE 2.6 / 5.6 cm, CSI 0.80 / 0.63, 15× / 36× faster |
| Control lines: across a channel vs downstream storage + edge outflow; around the domain vs edge outflow + outer ring | – | 9e-9, 1e-9 (tiled = untiled) |
| Rerun of the same run (urban cloudburst; batches of 7 vs 64 steps): depths, peaks, hazard, line books | – | 0 values differ |
| Peak speed and first wetting (> 5 cm) every step vs CPU | – | 3.6e-6 m/s, 0 s |
| Pond with one orifice vs modified Puls in JS on the same stage–storage (30 min drawdown); surface books with the outlet | – | stage within 4.8 mm, volume out within 0.3 %, books 1e-6 |
| Pond outlet onto the ground downstream: stored + in transit vs the start | – | 5e-7 |
| Rain garden with an underdrain: underdrain share of the drain; books | – | 90.91 % (exact); 3.4e-6 (the GI store path, with or without the underdrain) |
| Emulator vs solver, Meyerland block (held-out runs: return period × soil wetness; return period × pond orifice) | – | depth RMSE 0.5–1.2 mm, worst cell 3 cm, CSI ≥ 0.993, line peaks within 0.5 % |
| Armouring: clear-water ~20 Pa over 0.3 m sand+gravel, 1 h (surface gravel share; solids per class) | – | 30 → 45 % (store 31 %); 8e-7 |
| Window rerun of existing conditions vs the full run, Meyerland block, 60 m margin | – | depth RMSE 6.4 mm, line peak −2 %, edge outflow within 2 % |
| FEMA BFE between two BFE lines; bathymetry centre depth and volume | exact (linear); within 5 % / 15 % | – |
| Local time stepping vs global: dam breaks, still water at a stage boundary, deep channel + floodplain, books | L1 within 0.2 %, 4e-14 m/s, Δh 9e-4 m, mass 7e-13 | GPU = CPU LTS to 3e-7 m, 9e-5 m/s, 2.6× faster at 786k cells, books within 0.01 % |

Full numbers: `tests/results-cpu.json`, `tests/results-gpu.json`.

## Run

```bash
npm install
npm test                         # every CPU suite below, one line each; exits 1 if any fails
node tests/run-tests.mjs         # CPU solver suite (~1 min): fails if accuracy, convergence or mass balance regress
node tests/run-phase1-tests.mjs  # geodesy, terrain, roof routing, downscaling, exports, outflow BC, Atlas 14 storms, historic storms (--live hits the services)
node tests/run-phase2-tests.mjs  # weir and culvert hydraulics, conservative culvert links, channel breaching, bank stations, SWMM river
node tests/run-infra-tests.mjs   # infrastructure layer: capacity, estimate round trip, storage in SWMM, shapefile / zip import
node tests/run-barrier-tests.mjs # flood barriers: watertight faces, at-rest balance, weir overflow, deployment, books
node tests/run-hazard-tests.mjs  # hazard classes (ARR 2019, FD2320), force per width, duration and arrival
node tests/run-lts-tests.mjs     # local time stepping vs global (CPU fp64): dam breaks, still water, deep channel + floodplain (~1.5 min)
node tests/run-subgrid-tests.mjs # subgrid speed mode tables: storage, conveyance, curbs, porosity, level ↔ volume
node tests/run-watershed-tests.mjs # watersheds: depression filling, D8, upstream trace, outlines, rivers from off the DEM
node tests/run-calibrate-tests.mjs # calibration: observation import, scoring, sweep plan
node tests/run-inflow-tests.mjs   # river inflow: LP3, hydrographs, river entries, inflow books, STN marks (--live: a real gauge)
node tests/run-soil-tests.mjs     # soils: texture classes, SSURGO rows, ponded Green-Ampt vs analytic, water table, aggregation, grain classes
node tests/run-waterlevel-tests.mjs # starting water levels: river rise, lake fill, spreading, gauge datums (--live: a real gauge)
node tests/run-outlet-tests.mjs     # river outlet: backwater rise vs the GVF solution; a cut river holds its level, a free outfall draws it down; the cross-section reach
node tests/run-bank-tests.mjs     # bank stability: friction-angle failure, cohesion, confinement, rapid drawdown, probability, bank tops
node tests/run-report-tests.mjs   # report: hydrographs, profiles, HGL flags, stage–storage–discharge, gutter spread, charts
node tests/run-fema-tests.mjs     # FEMA NFHL: zone codes, BFE between lines, zone and BFE grids (--live: Meyerland)
node tests/run-compound-tests.mjs # compound flooding: datums, SLR to the epoch, design tides, GEV, Kendall's τ, Gumbel copula, isolines, design pairs, report (--live: Philadelphia)
node tests/run-bathymetry-tests.mjs # channel bathymetry: regional curves, flattened surface, carved section, GeoTIFF, surveyed bed
node tests/run-hecras-tests.mjs   # HEC-RAS: GeoTIFF and shapefile round trips, .g01 parsing, bed between sections, the 2D package
node tests/run-window-tests.mjs   # window reruns: the window, its edge segments (+ outward), inflow rates, the edge check, merging
node tests/run-emulator-tests.mjs # emulator: Latin hypercube, Gaussian process, leave-one-out, PCA, synthetic floods, Atlas 14 between columns
node tests/run-radar-tests.mjs    # radar overlay: product by date, tile and listing URLs, frame at a time (--live: Ida's frames)
node tests/run-mrms-tests.mjs     # radar rainfall: PNG decoding (8 and 16 bit, all filters), GRIB2, value tables, gauge-corrected totals, timing (--live: Ida)
node tests/run-nowcast-tests.mjs  # live radar: storm motion (whole and part pixels), advection, a live build with a cell arriving in the nowcast, PrecipRate fill
node tests/run-validate-tests.mjs  # validation scorecard: peaks and timing, STN event matching, statuses and verdict, gauge levels in NAVD88, flood-map lines
node tests/run-floodmap-tests.mjs  # flood maps: polygons onto cells, the 0.25-acre floor, hit rate / false alarms / CSI, depth bands and error, masks, DEP classes
node tests/run-uncertainty-tests.mjs # uncertainty bands: marks inside / outside the variants' spread, the variant that moves them most, map-score ranges
npm run validate                   # validation suite: each case's latest run scored into benchmarks/validation (tools/validate.mjs; --run [--ensemble] runs them again)
node tests/run-streamstats-tests.mjs # ungauged inflow: StreamStats replies, snapping retry, 90 % intervals, NRCS lag and unit hydrograph, report section (--live: Wissahickon)
node tests/run-checkpoint-tests.mjs # checkpoints: state by path (typed arrays in place, a solver root), packing, a SWMM run copied half way
node tests/run-damage-tests.mjs   # damage and areas: USACE curves, water against walls (rowhouses, sheet flow, enclosed yards), EAD, BCA, area stats (--live: NSI)
node tests/run-checks-tests.mjs   # model checks: edge distance and flooding by side, points near the edge, run against run, sensitivity, statuses, difference map
node tests/run-rainqa-tests.mjs   # rain against nearby gauges: reading hours across DST, ASOS hours and CoCoRaHS reports in the storm window, scoring rules, Ida at PHL (--live, --record)
npm run batch -- "<project>"     # a project's batch study headless on the GPU (tools/batch.mjs; --url, --retries, --hours, --headed)
node tests/run-cso-tests.mjs      # combined sewers: dry-weather flow vs its pattern, regulator split, flap gate, overflow events, people per manhole
# GPU suite: npm run test:gpu runs tests/gpu-browser.html in headless Chrome or Edge (the browser's own WebGPU, so the
# real GPU) and writes tests/results-gpu.json. No npm packages: it starts its own server on a free port, streams the
# log, and exits non-zero on a GPU error, page exception, missing adapter or timeout. Options: --url http://localhost:8770
# reuses a running server, --timeout 20 (minutes), --probe prints the adapter and exits, --headed shows the window,
# --only lts runs one section (writes no results file unless --json); CHROME_PATH picks a browser.
npm run test:gpu
# or in your own browser: npm start, then open http://localhost:8770/tests/gpu-browser.html
# The old Dawn-for-Node runner (npm run test:gpu:dawn) crashes compiling the solver's shaders on some Windows/NVIDIA setups.

# Gate B: npm start, open http://localhost:8766/benchmarks/ea/run.html, then:
node benchmarks/ea/score.mjs

node app/build.mjs               # bundles dist/floodsim.html (single self-contained page)
```

Note: `tests/run-gpu-browser.mjs` points at a Playwright Chromium install path; edit it for your machine.

## Layout

```
src/solver-cpu.js     fp64 reference solver
src/kernels.wgsl.js   WGSL compute kernels
src/solver-gpu.js     WebGPU host (buffers, pipelines, batched stepping, readback)
src/analytic.js       Stoker/Ritter and Thacker exact solutions
src/scenarios.js      cloudburst, dam break, Thacker scenario generators
src/geo.js            WGS84 ↔ UTM, model grid georeference
src/ingest.js         3DEP DEM, OSM buildings/roads, NLCD, SSURGO fetchers
src/terrain.js        rasterization, street burning, n / infiltration tables, coarsening, roof routing, hillshade
src/downscale.js      water-surface-projection depth downscaling
src/export.js         zip, 16-bit PNG, OpenEXR, buildings GLB writers
src/storm.js          Atlas 14 fetch/parse, DDF, alternating-block hyetographs, rain schedule
src/history.js        event catalog (IEM record + HURDAT2), rainfall replay, ASOS blend, CO-OPS water levels
src/compound.js       compound flooding: CO-OPS datums, 2022 Interagency SLR at the gauge, NOAA extreme water levels, design tides, joint rain–surge (ACIS + CO-OPS, Gumbel copula)
src/radar.js          NEXRAD composite overlay: IEM tile URLs, frame listing, frame at a time
src/mrms.js           MRMS radar rainfall: archive PNG and GRIB2 decoding, gauge-corrected hourly totals timed by 2-minute rates
src/nowcast.js        live radar: recent MRMS rain to the latest frame, storm motion by correlation, nowcast by advection
src/drainage.js       synthetic network, rational-method sizing, SWMM .inp writer, inlet hydraulics, lumped tier
src/coupler.js        1D–2D exchange loop (GPU inlets ↔ SWMM), roof downspout inflow
src/cso.js            combined sewers: people per manhole, dry-weather flow and its daily pattern, regulators and interceptors, overflow books
src/utilities.js      registry of open utility layers (Philadelphia Water is the first entry)
src/linked.js         user-linked ArcGIS / GeoJSON layers: fetch, field detection, pipe records
src/network-real.js   tier 1 network from real pipe layers
src/swmm.js           EPA SWMM WebAssembly wrapper
src/river.js          1D river in SWMM from cross-sections; weir / culvert hydraulics; river ↔ surface coupler
src/links.js          culvert links between surface cells; LinkHub for several exchange models
src/channels.js       OSM culverts → links; mapped streams snapped to the thalweg; breaching embankments and humps
src/barriers.js       flood walls, levees, deployable barriers → crest faces; overtopping and load watch
src/hazard.js         hazard classes (ARR 2019 H1–H6, FD2320), force, d·v, duration, arrival per cell
src/subgrid.js        subgrid speed mode: 1 m storage / conveyance tables per cell and face, 1 m depth output
src/watershed.js      watersheds from 3DEP: priority flood, D8, upstream trace, local watershed past a river
src/calibrate.js      observations (high-water marks, depths, reports, USGS STN), run scoring, parameter sweeps
src/validate.js       validation scorecard: marks, gauge peaks and timing, flood maps, rain sources, books against targets
src/floodmaps.js      reference flood maps (USGS depth maps, NYC DEP Stormwater Flood Maps) scored cell by cell against a run
src/uncertainty.js    uncertainty bands: observations against the spread of a base run and its batch variants
src/outlet.js         river outlet: the downstream gauge's level carried up to the edge (prismatic, or lidar cross-sections along NHDPlus)
src/nyc-ms4.js        NYC DEP separate-storm-sewer (MS4) drainage areas, simplified, for the combined-sewer test
src/rainqa.js         rain QA: ASOS hourly and CoCoRaHS daily gauges within 25 km against the storm's rain, over its own hours
src/inflow.js         upstream river inflow: USGS gauges, recorded and design (LP3) hydrographs, entry cells
src/soil.js           SSURGO soil hydraulics, Green-Ampt parameters per cell (wetness, water table)
src/scour.js          critical shear by surface, scour-potential classes
src/waterlevels.js    starting water levels from USGS gauges: river rise, lake fill, tide, spreading, datums
src/banks.js          bank tops next to water, Culmann bank stability, probability of collapse
src/sediment.js       sediment transport inputs (4 grain classes, settling, erodible stores, skin roughness, soil strength)
src/gi.js             green infrastructure layers (permeable pavement, rain gardens) and green-roof retention
src/design.js         site design: proposed buildings, pads, paved areas, demolitions → edited 1 m layers; grading engine, cut / fill log
src/stormwater.js     outlet structures (rating, links), stage–storage, modified Puls, drawn GI, underdrains, the detention check
src/compare.js        paired-run comparison: forcing fingerprint, .f32 grids, Δ maps, off-site impact, building and outlet tables
src/streamstats.js    ungauged river inflow: USGS StreamStats regression peaks, 90 % intervals, NRCS lag and unit hydrograph
src/batch.js          batch studies: jobs from storms × scenarios × variants, stable job ids, progress
src/checkpoint.js     run checkpoints: GPU buffers, SWMM memory and files, the run's JS state by path; packing
src/areas.js          flooded areas: connected areas of the peak depth with their depth, timing, hazard, streets and buildings; SVG map
src/damage.js         building damage (NSI structures, water against walls, USACE curves), EAD, benefit–cost
src/maps.js           report maps (binned raster SVG, colour ramps) and flooding along each street
src/checks.js         model checks (edge, inflow, books, run length, marks near the edge) and sensitivity of batch variants
src/damage-curves.js  USACE depth–damage functions per occupancy type (generated from USACE go-consequences)
src/report.js         H&H report outputs: hydrograph stats, profiles, HGL path and checks, stage–storage–discharge, gutter spread, SVG charts
src/fema.js           FEMA NFHL: flood zones, BFE lines and cross-sections, zone and BFE grids
src/bathymetry.js     estimated channel bathymetry from regional bankfull curves
src/topobathy.js      surveyed bathymetry (NOAA BlueTopo) on the model grid, merged under the flattened water
src/tiff.js           small GeoTIFF reader (tiled / striped, deflate, float samples, GeoKeys)
src/tiff-write.js     small GeoTIFF writer (striped, deflate, float32 / uint8, projected or lon/lat, NAVD88 GeoKeys)
src/shapefile.js      ESRI shapefile writer (points, lines, polygons; .shx, .dbf, .prj)
src/hecras.js         HEC-RAS handoff: .g01 cross-sections into the channel bed; the 2D package export
src/window.js         window reruns: the window, edge segments, inflow rates, the edge check, merging
src/emulator.js       per-project emulator: Latin hypercube, Gaussian processes, PCA of flood fields, leave-one-out, save / load
tools/batch.mjs       runs a project's batch study headless (tools/headless.mjs: Chrome/Edge over DevTools)
tools/validate.mjs    the validation suite: scores each case in benchmarks/validation, keeps the history, writes its summary
tools/outlet-reach.mjs a river outlet's edge level two ways (prismatic, lidar cross-sections) for a gauge and a box
tools/build-swmm.mjs  compiles vendor/swmm (EPA SWMM 5.2.4 source) with Emscripten
server/server.mjs     dev server + cached open-data proxy
app/map.html, map.js  Phase 1 map app (MapLibre 2D viewer, build/run/export)
app/infra-ui.js       infrastructure drawer; app/design-ui.js site design drawer; app/compare-ui.js compare drawer; app/emulator-ui.js emulator drawer; app/report-ui.js report drawer (sections in app/report-areas.js, report-damage.js, report-checks.js, report-cso.js, report-inflow.js, report-compound.js, report-rainqa.js); app/projects.js project folders
app/                  Phase 0 lab template + voxel shell, build script
tests/                CPU suite, Phase 1 suite, shared GPU suite, browser + Dawn runners, results JSON
benchmarks/ea/        Gate B: EA 2D benchmark cases, browser runner, scorer, results (data/ is the GOV.UK archive)
dist/floodsim.html    built Phase 0 solver lab and verification page
```

## Known limits (solver)

- Uniform grid; porosity and subgrid tables only in the opt-in speed mode (the 1 m run uses buildings as walls)
- Inflow hydrographs go through the inlet exchange (cells on a line); no momentum-carrying inflow boundary
- No turbulence (eddy viscosity) term
- Infiltration is Green-Ampt on each cell's pervious share (the default) or a constant capacity; no recovery between
  storms (single events only, no continuous simulation)
- Local time stepping is opt-in and pays only on large grids: each record is its own set of dispatches (~30–40 µs
  each), so on a 256×192 grid it is 0.6× the global speed even with 7× fewer steps; at 1024×768 it is 2.6× faster. The
  3×3 speed rule and the one-level smoothing keep most of a floodplain beside a deep channel at a finer level than its
  own speed needs (the CPU's cell updates fall 2.9×, not the 3.8× of the bare rule, which let a wave into a coarser tile
  at 1.8× the CFL limit). Moving fronts arrive slightly differently timed than with one global step (up to 9 mm on the
  spilling edge of the test floodplain; means 1e-5 m). Off with the subgrid speed mode, sediment and debris.
