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
*Bed*; `src/sediment.js`, kernels `sedAdvect` / `sedSource`). Off by default; the standard solver only (1–4 m grids,
not the subgrid speed mode) and a GPU with 9 storage buffers per shader stage.
- **Suspended load:** carried with the solver's own face fluxes in each Runge–Kutta stage at the upstream cell's
  concentration, so solids move exactly with the water; entrained by excess shear ε = k_d(τ − τc), k_d = 0.2·τc^−½
  cm³/(N·s) (Hanson & Simon 2001), against the soil's critical shear by texture; settling at the Ferguson–Church
  velocity of the median grain, exactly over each step; at most 10 % solids by volume.
- **Bedload** for sand-sized ground (d50 ≥ 0.0625 mm): Meyer-Peter & Müller across each face, upwind by the water flux,
  at most half the water crossing the face (so the bed is never pushed where the water does not go).
- **Shear on the soil** uses the skin (grain) roughness n = d50^⅙/21.1, not the total n with vegetation drag (the
  effective shear of HEC-15 for vegetated linings); the total-shear scour-potential map is unchanged.
- **The bed moves** (Exner, porosity 0.4): scour and deposits change the ground the flow sees during the run. The
  erodible budget is the topsoil depth you set (30 cm default) on erodible ground; paved ground erodes only the loose
  deposits that land on it; mapped water (rivers) takes deposits but does not erode (the survey has no bed material).
- **Checks** (GPU suite): settling matches the exact decay to 0.001 %; a dam break over loam and over sand conserves solids
  to ~1e-6 and water to ~1e-7 (sand moves 26× more, mostly as bedload). Ellicott City at 2 m with the Patapsco's
  10-year flow: 50 m³ eroded, up to 27 cm scour on the sandy-loam floodplain, deposits in the river pools.
- Run folders get `bed_change_cm.asc` and `suspended_solids_mm.asc`; the totals go under the run readouts.

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
  books include it. Flows are used as measured (no drainage-area scaling between gauge and crossing).
- Check: Ellicott City in the speed mode with the Patapsco's 10-year flow: 1.35 million m³ through the model in 90
  minutes, surface mass error 1.6e-6 of the water that entered. `npm run test:inflow` (`--live` fits Hollofield).

**Calibration** (section 6; `src/calibrate.js`). Import observations (CSV or GeoJSON points, feet or metres NAVD88):
high-water marks (water surface elevation), observed depths, or flooded / dry reports (311 complaints, photos).
- Every finished run is scored: a mark is compared with the highest modelled water surface within 3 m (marks sit on
  walls and doors); a mark left dry scores its ground. Levels: bias, mean error, RMSE, share within 15 cm.
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
  have any, so they help most for river and surge replays.

**Projects** (header *Projects* / *Save*, Ctrl+S; `app/projects.js`, `/api/projects` in the server, loopback only).
Each project is a folder in `Documents\FloodSim Projects` (override with `FLOODSIM_PROJECTS`):
- `project.json` holds the area and every setting.
- `infrastructure.geojson` holds the drawer layer.
- `runs/<date_time>/` gets one folder per finished run: `summary.json`, `max_depth.asc` and `max_speed.asc` (ESRI ASCII
  + `.prj`, open in QGIS / ArcGIS), the SWMM `.inp` and report, the hyetograph, and the layer as run.

Opening a project rebuilds the model from the saved settings, and reloads a historic event if one was used.

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
upstream, one 2 s interval later. Where a mapped stream crosses a road with no mapped culvert, the embankment (≤ 30 m
long, ≤ 4 m high) is breached to a straight grade; humps without a road are left alone, because mapped lines wander
onto real banks.

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
manhole by what its pipes deliver. On HEC-RAS's Davis storm-sewer example it brought the pump, wet-well and node levels
into line with HEC-RAS, and on the mass audit it halved the combined error where the pipes surcharge
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
coast). Loading an event rebuilds its rainfall at the site from one of:
- **Site totals, gauge timing (default):** IEM hourly gridded precipitation at the site, distributed inside each hour by
  the nearest ASOS 1-minute gauge (method of fragments; site hourly totals preserved exactly). Isaias 2020 at Eastwick:
  150 mm, 177 mm/hr peak 5 min, 1 h ≈ 68-yr and 3 h ≈ 95-yr against the site's Atlas 14.
- **Site rainfall (hourly):** the gridded series alone.
- **Airport gauge (5 min):** the gauge alone (PHL is 4 km away but caught 106 mm to the site's 150 for Isaias).

Each event is graded against Atlas 14 (5 min to 24 h windows). Where a NOAA CO-OPS tide gauge is within 60 km, its
observed water level (NAVD88, the 3DEP datum) drives a **water-level boundary** on edge cells that meet open water (NLCD
water/wetland or a mapped river within 30 m) and the stage at SWMM outfalls that discharge to streams; the run window is
padded to span the surge peak. The rest of the edge stays a free outfall.

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

**Your own data** (`src/linked.js`, `src/network-real.js`). Under Area → "Your own drainage data", paste links to public
ArcGIS layers (…/FeatureServer/0, …/MapServer/1) or GeoJSON files for pipes, inlets and outfalls; Check links shows what
each holds and which fields will be used. Build fetches only the features in the area. Pipe links make a **tier 1**
network: ends snap within 1.5 m, laterals that stop on a main's side are joined there, catch basins join the nearest pipe
within 30 m (splitting it), abandoned / proposed pipes are dropped, sizes over 6 m are treated as placeholders and filled
from neighbouring pipes, box and multi-barrel culverts become SWMM RECT_CLOSED with barrels, inverts are used when
plausible against the lidar (metres or feet) and otherwise derived (cover over the crown, ≥ 0.5 %, never rising), and
the whole network is oriented toward its exits so flat streets do not create sinks. Verified with West Hollywood's
public storm drains (mains + laterals + catch basins, inches, no inverts): 100-yr 1-h, SWMM continuity −0.04 %,
combined balance −0.002 %. The dev proxy only reaches links on public https hosts (never localhost or private
addresses), GET only, and every request must carry the app's `x-floodsim` header, so other web pages cannot use it.

**Roofs and outlets.** In combined-sewer areas roof downspouts feed the nearest manhole directly (slider in Drainage,
default 100 % where the utility marks combined sewers, 0 % elsewhere); the rest still lands around each building.
Where pipes leave the area they continue 100 m off-site to a normal-depth outlet instead of a free outfall, so
downstream capacity and backwater are felt. South Street, 100-yr 1-h: 6,534 m³ piped from roofs, area flooded
> 15 cm 5,026 → 2,332 m² (yard ponding was the roof-routing artefact), SWMM −0.27 %, combined −0.23 %.

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

**Views** (2D, synced to the map): depth, max depth, velocity, hazard rating HR = d·(v + 0.5) in DEFRA/EA FD2320 classes.
Hover any cell for elevation, land cover, depth, speed and max depth.

**Export** (`.zip`): `terrain/heightmap_16bit.png` (Unreal Landscape, scales in README.txt), `terrain/dem_1m.exr`,
`buildings/buildings.glb` (extruded OSM footprints), `results/max_depth_1m.exr`, `results/frames/*.exr` (R = depth,
G = speed, on the solver grid), and `metadata.json` (CRS, origin, cell sizes, data sources and licences, run parameters,
mass balance).

**Caching.** `server/server.mjs` proxies an allowlist of open-data hosts and caches responses in `.cache/`, so rebuilding
an area is instant and works offline. Overpass is the least reliable source (public servers return 429/504 under load).

### Phase 1 known limits

- Without linked pipes, pipes are synthetic even where inlets are real; combined-sewer dry-weather flow, regulators, interceptors and
  tide gates are not modelled (edge outfalls stand in for the interceptor)
- 1D–2D exchange every 2 s sets the pace on small domains (~47× real time at 190 k cells)
- Rain is uniform over the domain (no areal reduction factor, no MRMS radar replay yet); Atlas 14 temporal distributions not yet offered
- Rivers come from hydro-flattened lidar with no bathymetry; no river inflow hydrographs yet (tide/surge levels are in)
- No catchment delineation: water from upstream of the drawn area is ignored (draw the polygon around the catchment);
  the drainage network is built over the polygon's bounding box, so inlets outside the polygon sit in dry sink cells
- Max speed in exports is sampled at the display frame rate, not every solver step
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
below that the solver runs untiled).
Bed elevations are stored relative to the domain minimum for fp32 headroom.

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
| Sediment: settling vs exact; dam break over loam and sand (solids, water) | – | 0.001 %; solids ~1e-6, water ~1e-7 |
| Green-Ampt and scour vs CPU (infiltrated volume, shear, scour depth) | ponded GA within 0.3 % of analytic | 1e-7, 1e-4, 3e-4 mm |
| Subgrid speed mode vs 1 m run, 320 m urban cloudburst (4 m / 8 m) | – | peak depth MAE 2.6 / 5.6 cm, CSI 0.80 / 0.63, 15× / 36× faster |

Full numbers: `tests/results-cpu.json`, `tests/results-gpu.json`.

## Run

```bash
npm install
node tests/run-tests.mjs         # CPU suite (~2 min)
node tests/run-phase1-tests.mjs  # geodesy, terrain, roof routing, downscaling, exports, outflow BC, Atlas 14 storms, historic storms (--live hits the services)
node tests/run-phase2-tests.mjs  # weir and culvert hydraulics, conservative culvert links, channel breaching, bank stations, SWMM river
node tests/run-infra-tests.mjs   # infrastructure layer: capacity, estimate round trip, storage in SWMM, shapefile / zip import
node tests/run-barrier-tests.mjs # flood barriers: watertight faces, at-rest balance, weir overflow, deployment, books
node tests/run-hazard-tests.mjs  # hazard classes (ARR 2019, FD2320), force per width, duration and arrival
node tests/run-subgrid-tests.mjs # subgrid speed mode tables: storage, conveyance, curbs, porosity, level ↔ volume
node tests/run-watershed-tests.mjs # watersheds: depression filling, D8, upstream trace, outlines, rivers from off the DEM
node tests/run-calibrate-tests.mjs # calibration: observation import, scoring, sweep plan
node tests/run-inflow-tests.mjs   # river inflow: LP3, hydrographs, river entries, inflow books, STN marks (--live: a real gauge)
node tests/run-soil-tests.mjs     # soils: texture classes, SSURGO rows, ponded Green-Ampt vs analytic, water table, aggregation
# GPU suite in your own browser: npm start, then open http://localhost:8766/tests/gpu-browser.html

# GPU suite in headless Chromium (works with software WebGPU):
python3 -m http.server 8766 &
node tests/run-gpu-browser.mjs 8766 --json tests/results-gpu.json
# or under Dawn with a real Vulkan/Metal/D3D driver (webgpu 0.6.2 currently segfaults on the first queue sync on
# Windows; use the browser page):
node tests/run-gpu-tests.mjs

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
src/drainage.js       synthetic network, rational-method sizing, SWMM .inp writer, inlet hydraulics, lumped tier
src/coupler.js        1D–2D exchange loop (GPU inlets ↔ SWMM), roof downspout inflow
src/utilities.js      registry of open utility layers (Philadelphia Water is the first entry)
src/linked.js         user-linked ArcGIS / GeoJSON layers: fetch, field detection, pipe records
src/network-real.js   tier 1 network from real pipe layers
src/swmm.js           EPA SWMM WebAssembly wrapper
src/river.js          1D river in SWMM from cross-sections; weir / culvert hydraulics; river ↔ surface coupler
src/links.js          culvert links between surface cells; LinkHub for several exchange models
src/channels.js       OSM culverts → links; breaching road embankments on mapped streams
src/barriers.js       flood walls, levees, deployable barriers → crest faces; overtopping and load watch
src/hazard.js         hazard classes (ARR 2019 H1–H6, FD2320), force, d·v, duration, arrival per cell
src/subgrid.js        subgrid speed mode: 1 m storage / conveyance tables per cell and face, 1 m depth output
src/watershed.js      watersheds from 3DEP: priority flood, D8, upstream trace, local watershed past a river
src/calibrate.js      observations (high-water marks, depths, reports, USGS STN), run scoring, parameter sweeps
src/inflow.js         upstream river inflow: USGS gauges, recorded and design (LP3) hydrographs, entry cells
src/soil.js           SSURGO soil hydraulics, Green-Ampt parameters per cell (wetness, water table)
src/scour.js          critical shear by surface, scour-potential classes
src/sediment.js       sediment transport inputs (grain size, settling, erodible depth, skin roughness)
src/gi.js             green infrastructure layers (permeable pavement, rain gardens) and green-roof retention
tools/build-swmm.mjs  compiles vendor/swmm (EPA SWMM 5.2.4 source) with Emscripten
server/server.mjs     dev server + cached open-data proxy
app/map.html, map.js  Phase 1 map app (MapLibre 2D viewer, build/run/export)
app/                  Phase 0 lab template + voxel shell, build script
tests/                CPU suite, Phase 1 suite, shared GPU suite, browser + Dawn runners, results JSON
benchmarks/ea/        Gate B: EA 2D benchmark cases, browser runner, scorer, results (data/ is the GOV.UK archive)
dist/floodsim.html    built Phase 0 solver lab and verification page
```

## Known limits (solver)

- Uniform grid; porosity and subgrid tables only in the opt-in speed mode (the 1 m run uses buildings as walls)
- Inflow hydrographs go through the inlet exchange (cells on a line); no momentum-carrying inflow boundary
- No turbulence (eddy viscosity) term
- Infiltration is a constant capacity, not Green-Ampt
