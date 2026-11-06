# FloodSim User's Manual

This manual tells you how to use FloodSim: how to start it, set up a model, run it, check it and report it. It is
written for a planner or engineer who has not used the app before.

The technical reference is [docs/METHODS.md](METHODS.md). It holds the equations, data sources, verification and
validation, and the limits of the model. This manual points to it as `docs/METHODS.md §x.y` and does not repeat it.

- **Scope.** The app in this repository on branch `main`, November 2026. Where this manual and the code disagree, the
  code governs.
- **Labels.** Text in **bold** is the exact label shown on screen.
- **Units.** Elevations are NAVD88 (the datum of the USGS 3DEP lidar). The rail on the right mostly shows SI units. The
  Infrastructure, Site design and Report drawers can show US units.

## Contents

1. [What FloodSim is for, and what it is not for](#1-what-floodsim-is-for-and-what-it-is-not-for)
2. [Installing and starting FloodSim](#2-installing-and-starting-floodsim)
3. [The screen](#3-the-screen)
4. [Step 1: Area and model](#4-step-1-area-and-model)
5. [Step 2: Storm](#5-step-2-storm)
6. [Step 3: Drainage](#6-step-3-drainage)
7. [Design scenarios and the analysis drawers](#7-design-scenarios-and-the-analysis-drawers)
8. [Step 4: Run, and the run log](#8-step-4-run-and-the-run-log)
9. [Reading results and exporting them](#9-reading-results-and-exporting-them)
10. [Model checks: reading them and acting on them](#10-model-checks-reading-them-and-acting-on-them)
11. [Reproducing a run](#11-reproducing-a-run)
12. [Batch studies and sensitivity variants](#12-batch-studies-and-sensitivity-variants)
13. [The validation suite](#13-the-validation-suite)
14. [Projects](#14-projects)
15. [Troubleshooting](#15-troubleshooting)
16. [Glossary](#16-glossary)

---

## 1. What FloodSim is for, and what it is not for

FloodSim is a two-dimensional shallow-water flood model that runs in the browser on your GPU (WebGPU). It is coupled
to EPA SWMM 5 for storm sewers and 1D rivers. You draw an area anywhere in the United States. FloodSim builds a 1 m
model from national open data (3DEP lidar, OpenStreetMap, NLCD, SSURGO, NOAA, USGS and FEMA) and runs it.

**Intended uses** (summary of docs/METHODS.md §1.2):

- urban rain-on-grid flood mapping at block-to-neighbourhood scale, for Atlas 14 design storms and replayed historic
  storms;
- compound flooding screening at tidal sites (rain with a design tide, surge and sea-level rise);
- design comparisons: existing conditions against a proposed site design under the same forcing;
- screening of drainage capacity, building exposure, damage, expected annual damage and benefit–cost;
- handoff to HEC-RAS 2D and SWMM5 for a reviewer to rebuild the case.

**Do not rely on FloodSim alone for** (summary of docs/METHODS.md §1.3; read that section in full before using results
in a submittal):

1. FEMA regulatory floodplain mapping (FIRM/FIS revisions, LOMR/CLOMR, floodways).
2. Final design of hydraulic structures (culverts, bridges, trunk sewers, pumps, outlet structures, levees, walls).
3. Life-safety decisions based on the emulator or the radar nowcast.
4. Regulatory sewer compliance (CSO long-term control plans, consent decrees).
5. Absolute damage figures for funding applications such as FEMA BCA.
6. Sediment, debris flow, scour and bank collapse outputs as design values.

Before you accept a result, docs/METHODS.md §1.4 asks for: the run's `summary.json` with its fingerprint and commit, a
clean model-checks table, a sensitivity study that includes the one-cell-coarser grid test, and, for any absolute
level, a comparison against observations. Sections 10 to 12 of this manual show how to produce each of these.

How far the model has been validated against real floods is in docs/METHODS.md §5, with what has not been validated in
§5.15. In short: street flooding from rain and river levels are not yet validated (§5.15).

---

## 2. Installing and starting FloodSim

### 2.1 What you need

| Item | Requirement | Source |
|---|---|---|
| Node.js | Needed to run the local server. The launcher stops with "Node.js is not installed" if it is missing. | `Start FloodSim.cmd` |
| Browser | One with WebGPU. The headless tools use Chrome or Edge. | `app/map.js`, `tools/batch.mjs` |
| GPU | WebGPU with 9 storage buffers per shader stage for the fast tiled solver (it runs untiled, and slower, below that); 10 for sediment transport. | docs/METHODS.md §7.11 |
| Internet | Needed the first time an area is built. Responses are cached in `.cache/`, so a rebuild of the same area works offline. | README "Caching" |
| SWMM engine | Shipped built in `vendor/swmm-wasm/`. Rebuild only if you change SWMM: `npm run build:swmm` (needs the Emscripten SDK). | README |

For scale, the README gives about 1 million cells at 1 m running about 45× real time on an RTX 50-series GPU.

### 2.2 Start with the launcher (Windows)

1. Double-click **Start FloodSim.cmd** in the FloodSim folder.
2. On the first run it installs the packages (`npm install`).
3. It starts the server in a minimised window titled "FloodSim server", on port 8770.
4. It opens `http://localhost:8770/app/map.html` in your browser.
5. To stop FloodSim, close the "FloodSim server" window.

If the server is already running, the launcher only opens the page.

### 2.3 Start from a terminal

```bash
npm install
npm start          # node server/server.mjs, port 8766 by default
```

Then open `http://localhost:8766/app/map.html` (the server redirects `/` there). To use another port, set `PORT`, or
give it as an argument: `node server/server.mjs 8770`. The server prints the page address and the projects folder when
it starts.

### 2.4 Check that the GPU is ready

Look at the top bar, to the right of the project name. It starts as **Starting WebGPU…**. When the GPU is ready the dot
turns green and the text names the adapter and its buffer size, for example `WebGPU · … · N MB buffers`. A red dot
means the solver cannot run; see [Troubleshooting](#15-troubleshooting).

---

## 3. The screen

| Part | Where | What it does |
|---|---|---|
| Top bar | Top | **Projects**, the project name (**Unsaved project** until you save), **Save**, the engine status, and the **Solver lab & verification** link (the standalone solver test page). |
| Map | Left | Satellite basemap, your area, the model layers and the flood depths. Hover a cell to see elevation, land cover, depth, speed and max depth. |
| HUD | Top left of the map, during a run | **Sim time**, **Max depth**, **Rain**. |
| Map buttons | Top right of the map | **Design**: **Site design**, **Infrastructure**. **Analyse**: **Compare**, **Emulator**, **Batch**, **Report**. Each opens a drawer over the map. |
| Steps rail | Right | The numbered steps, in run order. One step is open at a time. Closed steps show a short status beside their title. |

The steps in the rail:

| Group | Step | Section of this manual |
|---|---|---|
| Set up and run | **1 Area and model** | [4](#4-step-1-area-and-model) |
| | **2 Storm** | [5](#5-step-2-storm) |
| | **3 Drainage** | [6](#6-step-3-drainage) |
| | **4 Run** | [8](#8-step-4-run-and-the-run-log) |
| | **5 Map view** | [9.1](#91-map-view) |
| Check and hand off | **6 Calibrate** | [10.4](#104-calibrate-score-against-observations) |
| | **7 Data and assumptions** | [9.2](#92-data-and-assumptions) |
| | **8 Export** | [9.6](#96-export-step-3d-and-hec-ras-packages) |

Advanced options inside a step sit behind a **+** heading marked *Advanced* or *Optional*.

---

## 4. Step 1: Area and model

### 4.1 Find the site

1. Type an address or place into **Address or place in the US** and press **Find** (US Census geocoder, with OSM
   Nominatim as fallback).
2. Or pick a site from **Examples…**. An example sets the area and fills (or clears) the linked drainage links under
   **Your own drainage data**.

| Example | Why it is there |
|---|---|
| Eastwick, Philadelphia PA | low-lying, tidal creek, repeatedly flooded |
| South Street, Philadelphia PA | combined sewers, real utility inlets |
| West Hollywood CA | public storm-drain GIS linked in (tier 1) |
| Laurelhurst, Portland OR | combined sewers linked in (tier 1): 12 Sep 2018 cloudburst |
| Manayunk, Philadelphia PA | Schuylkill flood: Ida 2021, 15 USGS high-water marks and a river gauge |
| Forest Hills, Queens NY | Ida 2021 street flooding: USGS high-water marks, USGS depth maps, NYC DEP flood maps |
| Meyerland, Houston TX | flat, bayou-side, flash flooding |
| Ellicott City MD | steep valley, 2016 and 2018 flash floods |
| Miami Beach FL | tidal and storm-surge flooding |
| Waikiki, Honolulu HI | Hawaii: local datums |

### 4.2 Draw the area

**Box:**

1. Click **Draw box**. The button reads **Drag on the map…**.
2. Drag a rectangle. Releasing anywhere finishes it, even over a map control.

**Polygon:**

1. Click **Draw polygon**. The button reads **Click corners… (Enter to finish)**.
2. Click the corners. Backspace removes the last corner.
3. Finish with a double-click, Enter, or a click on the first corner. Esc cancels.

The note under the buttons gives the grid size in km and its UTM zone. The area guidance on screen is "Up to about 3 × 3
km at 1 m". An area above 20 million 1 m cells is refused with "too large for a 1 m model in the browser; draw a smaller
area", and **Build model** stays disabled.

A polygon is modelled on its bounding box. Cells outside the polygon become sinks: no rain falls there, and water that
flows into them leaves the model. The note says "water leaving the polygon is gone (free overfall at its edge)".

**Choose the area with care.** Every model edge is a free outfall: water reaching it leaves, and nothing flows in.
Draw the area well beyond the place you care about (docs/METHODS.md §7.1). The model checks grade this after a run
([section 10](#10-model-checks-reading-them-and-acting-on-them)).

### 4.3 Watershed

**Watershed** traces, from 3DEP elevation, the ground outside your area that drains into it. Build also runs this
trace in the background and writes a **Watershed** line in the build log.

The note then says one of:

- the area is closed (nothing drains in);
- some area outside drains in, with its size, and a **Run on the watershed** button that makes the watershed polygon
  the model area;
- a river runs in from a basin larger than the search. Its flow is missing until you give it an inflow from a stream
  gauge (Storm step, [5.7](#57-upstream-river-inflow-and-river-leaving-the-area)). The button then offers the local
  watershed.

The trace is surface drainage only. Pipes, and water routed around buildings, are not in it.

### 4.4 Solver cell size

**Solver cell size** sets the grid the solver runs on. The DEM is always fetched at 1 m.

| Option | What it does | When to use it |
|---|---|---|
| **1 m (DEM resolution)** | The default and the reference. | Final results. |
| **2 m + downscale to 1 m** | Solves at 2 m; depths are projected onto the 1 m DEM. | Large areas; the grid test of a 1 m run. |
| **4 m + downscale to 1 m** | Solves at 4 m, downscaled. | Larger areas, with care. |
| **Speed mode: 4 m subgrid, depths at 1 m (~15× faster)** | 4 m cells carrying 1 m storage and conveyance tables. Opt-in. | Sweeps and screening. |
| **Screening: 8 m subgrid, depths at 1 m (~35× faster, coarser)** | The same at 8 m. | Screening only. |

The note under it gives the solver cell count and GPU memory. If it reads "exceeds this GPU’s buffer limit; pick a
coarser cell size", choose a coarser option. Downscaling cannot create flow paths the coarse grid missed
(docs/METHODS.md §2.11–2.12, §7.2).

### 4.5 Terrain and channels (Advanced)

| Field | Options | Notes |
|---|---|---|
| **Street curb burn** | **Auto**, **15 cm**, **Off** | Auto burns 15 cm only where the DEM source is coarser than 1 m; 1 m lidar already resolves curbs. |
| **Local time stepping (experimental)** | off by default | Each 8 × 8 tile steps at its own power-of-two step. Off with subgrid cells and sediment. Pays only on large grids (docs/METHODS.md §2.10). |
| **Channel bathymetry** | **Lidar surface (none)**, or an estimate by regional curve: **nationwide curve**, **Atlantic Plain**, **Appalachian Highlands**, **Interior Plains**, **Interior Highlands**, **Laurentian Upland**, **Rocky Mountains**, **Intermontane Plateaus**, **Pacific Mountains** | Lidar flattens rivers at the flight-day water surface. Any option other than **Lidar surface (none)** carves a channel: NOAA BlueTopo survey where it exists, then HEC-RAS sections if loaded, then the curve. The curves are wrong for tidal and dredged reaches (docs/METHODS.md §7.2). |

**HEC-RAS cross-sections (optional).** Where a 1D model exists, its surveyed sections set the bed between them.

1. Pick a **Channel bathymetry** option other than **Lidar surface (none)**.
2. Set **Elevations in** (**Project units (else feet)**, **feet** or **metres**) and **Vertical datum** (**NAVD88** or
   **NGVD29 (shifted to NAVD88)**).
3. Leave **Projection** blank to read it from the `.prj`, or type an EPSG code such as `EPSG:2272`.
4. Click **Load geometry…** and pick the geometry file (`.g01` …) with its project `.prj` or the RAS Mapper projection
   `.prj`.
5. **Clear** removes them. Loaded sections are placed again on every Build.

### 4.6 Your own drainage data (Optional)

Here you link a city's pipe, inlet and outfall layers. Linked pipes make the network **tier 1** (real pipes).

1. Open **Your own drainage data**.
2. Paste links to public ArcGIS layers (`…/FeatureServer/0`, `…/MapServer/1`) or GeoJSON files, one per line, into:
   - **Pipes / mains (lines)**
   - **Inlets / catch basins (points)**
   - **Outfalls (points)**
3. To take part of a layer, add an encoded filter with no spaces, for example
   `…/MapServer/108?where=LAYER_GROUP%3D%27SEWER%20PIPES%27`.
4. Set **Pipe size units** (**Detect**, **inches**, **millimetres**, **feet**, **metres**).
5. If inverts are on a local datum, set **Add to inverts (to NAVD88)** in the inverts' own units (City of Portland:
   +2.10 ft). 0 means already NAVD88.
6. Click **Check links**. The list shows what each link holds and which fields will be used, or an error.
7. Build fetches only the features inside the area.

What Build does with linked layers (README "Your own data"; docs/METHODS.md §3.9):

- pipe ends snap within 1.5 m; catch basins join the nearest pipe within 30 m;
- abandoned and proposed pipes are dropped; sizes over 6 m are treated as placeholders;
- an invert is used only where it lies 0.2–30 m under its manhole's ground, otherwise it is derived;
- a system field reading *Combined* (or a combined unit code) marks a pipe combined. When most linked pipes are
  combined, Build turns on the combined-sewer defaults (see [6.4](#64-combined-sewer)).

The proxy reaches only public https hosts for links (never localhost or private addresses), GET only.

**Built-in utility data.** Inside a registered utility's area, Build pulls its open GIS without links: Philadelphia
Water inlets, outfalls and its combined-sewer area, and NYC DEP catch basins and outfalls. These utilities do not
publish pipes, so the pipes stay synthetic and the network is labelled tier 2+.

### 4.7 Build the model

1. Click **Build model**.
2. Read the build log under the button. Each source gets a line that turns ✓ (done), ! (warning) or × (failed).

| Log line | When done it says | A warning means |
|---|---|---|
| 3DEP bare-earth DEM at 1 m | DEM size, and "native 1 m lidar" | "finest source here is N m, so 1 m is interpolated" |
| OpenStreetMap buildings and roads | counts of buildings and road segments | (no fallback: Build fails) |
| NLCD land cover | land cover → Manning’s n, impervious % | "Land cover unavailable, using urban defaults" |
| SSURGO soils | soil map units → infiltration | "Soils unavailable, using compacted-fill rate" |
| NOAA Atlas 14 rainfall frequency | the site's 100-yr 1-hr depth | "No NOAA Atlas 14 estimates here: design storms come from the site record" |
| FEMA flood zones (NFHL) | share of the area in the 1 % floodplain, BFE range | "FEMA flood zones unavailable" |
| *utility* drainage inlets (where one applies) | real inlets and outfalls | "Utility inlets unavailable, synthetic placement" |
| Your linked drainage data (when links are set) | pipes, inlets, outfalls linked | "Linked data failed" (× ) |
| Conditioning terrain | buildings as walls, streets, culverts linked, embankments breached | — |
| Watershed draining into the area (3DEP) | "closed", or what drains in | a river from a large basin, or ground draining in |

When the build ends, **Run** is enabled and the rail moves to **2 Storm**. The **Data and assumptions** step now lists
every data source and its tier ([9.2](#92-data-and-assumptions)).

**Build sets some site defaults.** In a combined-sewer area (utility area or mostly-combined linked pipes) Build sets
**Roof downspouts connected to the sewer** to 100 % and ticks **Combined sewer area**; elsewhere 0 % and unticked. Make
your own changes to these after Build.

---

## 5. Step 2: Storm

Pick the rain source with the three buttons at the top: **Atlas 14 design**, **Historic storm**, **Custom**. Where Atlas
14 has no estimates (western Washington and Oregon) the first button reads **Site-record design**.

The storm settings lock once a run starts. Press **Reset** (Run step) to change them.

### 5.1 Atlas 14 design storm

| Field | Options | Default |
|---|---|---|
| **Return period** | 1-yr to 1000-yr | **100-yr (1% AEP)** |
| **Duration** | 30 min, 1 hour, 2, 3, 6, 12, 24 hours | **1 hour** |
| **Time pattern** | **Alternating block, centred peak**; **… early peak**; **… late peak**; **Uniform (same depth, no peak)** | centred peak |
| **Estimate** | **Median**, **Upper 90% bound**, **Lower 90% bound** | Median |
| **Climate uplift on depths** | 0 to +50 % in 5 % steps | 0 |

The summary under the hyetograph gives the depth, the Atlas 14 90 % interval, the peak 5-minute intensity and the Atlas
14 volume and location. The storm is uniform over the area, with no areal reduction factor. The alternating-block
pattern is peakier than any observed storm (docs/METHODS.md §3.6, §7.4).

**Site-record design** (no Atlas 14): a GEV fitted to the site's annual-maximum daily rain, shaped like the largest
recorded storm with a real hourly record. The summary says how many years it rests on and that return periods beyond
about twice that are extrapolation.

### 5.2 Historic storm

After a build, **Event** lists the 12 wettest rain events in the site's daily record since 1995, named when a
hurricane track passed within 250 km, plus other hurricane passages within 250 km. The note gives the record length,
the hurricane count and the nearest tide gauge.

1. Pick the **Event**, or **Another date… (a short burst the daily record ranks low)** and then **Date (local)**.
2. Pick the **Rainfall** source (table below).
3. Tick or untick **Observed water level at …** (shown only when a NOAA tide gauge is within 60 km). It drives a water
   level on the open-water model edges.
4. Click **Load event**. The hyetograph, the water level (if any) and the storm summary update.

**Rainfall choices:**

| On screen | What it uses | Notes |
|---|---|---|
| **Site totals, gauge timing (5 min)** | IEM hourly gridded totals at the site, timed within each hour by the nearest ASOS 1-minute gauge | Default where an airport gauge is in reach. |
| **Site rainfall (hourly)** | The gridded hourly series alone | |
| **Airport gauge *ID*, *N* km (5 min)** | The airport gauge alone | Reads **Airport gauge (none within 30 km)** when there is none. |
| **Radar, NOAA MRMS (1 km, 2 min; gauge-corrected from May 2015)** | MRMS per-pixel hourly totals, gauge-corrected where the archive has them, timed by the 2-minute radar rates; rain varies cell by cell | Radar-only stands in before May 2015 or where the corrected total is missing; the summary lists those hours. |
| **Radar only, MRMS not adjusted to gauges (1 km, 2 min)** | The radar's own hourly totals, with no gauge correction | Use as a second rain source, for example where the correcting gauges are far from the storm (docs/METHODS.md §5.12). |
| **Radar fitted to USGS rain gauges in and near the area (1 km, 2 min)** | The radar-only rain fitted to USGS tipping-bucket gauges within 10 km, hour by hour or on storm totals, kept only if it predicts left-out gauges better than the radar alone | With no gauges that reported, the gauge-corrected radar is used instead. Method: docs/METHODS.md §3.6. |

The three radar choices cover the lower 48 only, and are disabled where the site's record is not gridded. Each historic
event is graded against Atlas 14 at the site.

A rain sensitivity for a historic storm needs a second rain source (for example radar against the gauge blend): the
batch **Rain + 10 %** variant runs on design storms only (docs/METHODS.md §6.3).

### 5.3 Live radar and nowcast (screening only)

Under **Historic storm**, **Live radar** runs a storm that starts in the recent past and goes past now.

1. Pick the observed hours: **last 1 h**, **last 3 h** (default), **last 6 h**.
2. Pick the nowcast: **no nowcast**, **+30 min nowcast**, **+60 min nowcast** (default), **+90 min nowcast**.
3. Click **Load live radar**. Click it again to refresh.

The observed part is MRMS radar rain to the latest 2-minute frame. The nowcast moves the last 10 minutes' rain along the
storm's motion with no growth or decay, and is drawn in amber on the hyetograph. The summary gives the storm's speed,
heading and the match's correlation; below 0.6 is flagged as poor. The nowcast answers "if this keeps coming, what
floods next", not "what will happen". Do not base life-safety decisions on it (docs/METHODS.md §1.3).

With a tide gauge in reach, the live water level is the gauge's observations to now, then NOAA's prediction plus the
current surge.

### 5.4 Custom storm

**Rain intensity** (5–200 mm/hr, default 75) for **Storm duration** (5–180 min, default 60). Constant, not tied to a
return period.

### 5.5 Hyetograph and run length

The plot shows rain intensity per block. **Keep running after the storm** (0 to 12 h, default 30 min) sets how long
the run continues after the rain stops. River crests and downstream peaks come after the rain: a run scored against
high-water marks must reach them. The model checks flag a short tail ([10](#10-model-checks-reading-them-and-acting-on-them)).

### 5.6 Tide, surge and sea-level rise

Shown when a NOAA tide gauge was found. The note names the station and its datums.

| Field | Options |
|---|---|
| **Design tide** (design storms) | **None (free outfall at the edges)** (default), **Still water: MHHW + surge**, **Tide cycle, MLLW to MHHW (M2)**, **NOAA tide prediction for a date** |
| **At the rain peak** | **High water**, **Low water** |
| **Prediction date** | for the prediction option |
| **Surge** | **None**, **NOAA 1-yr** to **100-yr high water**, **Custom (m above MHHW)** |
| **Sea-level rise** | **None (MHHW at the datum epoch)**, **Observed trend at the gauge**, **2022 Interagency Low**, **Intermediate-Low**, **Intermediate** (default), **Intermediate-High**, **High** |
| **Year** | 2026 (today) to 2150 |
| **Raise the observed water level to the scenario year** | for a historic storm's observed level |

**Joint rain–surge probability** fetches long daily rain and tide records (a minute or two the first time, cached
after) and gives the 100-yr design pairs. Each pair has a **Use** button that sets it as the storm. The method and its
limits are in docs/METHODS.md §3.8 and §7.5. Waves are not modelled.

### 5.7 Upstream river inflow, and river leaving the area

After a build, every mapped river or stream crossing into the area is listed under **Upstream river inflow (USGS
gauges, or StreamStats where there is none)**. For each entry:

1. Pick the source in the first list: **No inflow**, **Ungauged: USGS StreamStats regression peak**, **Ungauged: your
   own peak flow (e.g. the FIS discharge table)**, or one of the nearby USGS gauges (marked upstream, downstream or
   away).
2. Pick the flow: **Recorded flows (historic storms)**, **Design: the storm's return period**, or **Design: 2-yr** to
   **100-yr peak flow** (default 10-yr).
3. Set **River peak after the rain peak (h)** if needed.
4. Leave **Scale to the drainage area where it enters** ticked to scale the gauge's flow by the drainage-area ratio. The
   note flags ratios outside 0.5–1.5, where the transfer is weak.

Shared fields:

- **Drainage-area exponent b (Q = Q_gauge · (A / A_gauge)^b)**, default 0.8.
- **Baseflow warm-up before the storm (h)**, default 0. Runs the rivers at their starting flow, with no rain, before the
  storm. Skipped in the subgrid speed mode.

Recorded flows need a historic storm. Design flows from a gauge use log-Pearson III on its annual peaks (Bulletin 17B
moments, planning level). Ungauged peaks come from StreamStats or from you; the app does not invent one
(docs/METHODS.md §3.7, §7.5).

**River leaving the area** (historic storms only). Without it, a deep river leaving the model pours off the edge as if
over a fall and draws down upstream.

1. Enter the **Downstream USGS gauge (site number)**.
2. Enter **River length from the edge to it (m; blank: straight line)**.
3. Pick **Reach to the gauge**: **The edge’s own section, all the way** (default) or **Cross-sections cut from the
   lidar**.
4. Optionally enter **Channel depth below the water there (m; blank: the model’s estimate)**. The edge level depends on
   it (about 0.4 m per metre of depth on the Schuylkill).

It is not used with a tide on the edges.

### 5.8 Runoff and soils (Advanced)

| Field | Options | Default |
|---|---|---|
| **Roof runoff routed to ground** | 0–100 % | 100 % |
| **Infiltration** | **Green-Ampt from the soil survey**, **Constant rate by soil group** | Green-Ampt |
| **Soil wetness before the storm** | **Dry**, **Normal**, **Wet (rain in the days before)**, **Saturated** | Normal |
| **Water table depth, m (blank = soil survey)** | a depth overrides the survey for every cell | blank |
| **Rivers, lakes and tidal water start at** | **Gauge levels (at the storm start; latest reading for design storms)**, **The lidar water surface (no extra water)** | Gauge levels |

The note beside the water table names the nearest USGS groundwater well. It is a check, not an input.

### 5.9 Sediment, debris flows and banks (Advanced)

| Field | Default | Notes |
|---|---|---|
| **Sediment transport and bed change** | off | Standard solver only. |
| **Erodible topsoil depth, m** | 0.3 | |
| **Debris flows (with sediment transport)** | off | |
| **Bank collapse probability along rivers, streams and lakes** | on | Standard solver only. |

These outputs are screening values with no field validation (docs/METHODS.md §1.3, §5.15).

---

## 6. Step 3: Drainage

### 6.1 Drainage type

| Button | What it does |
|---|---|
| **None** | No drainage. |
| **Lumped rate** | **Drainage capacity over the area** (0–100 mm/hr, default 30) removed from street cells. Data tier 3. Use when no network data exists. |
| **Pipe network (SWMM)** | Default. Inlets on the surface exchange water with pipes in EPA SWMM every 2 s. |

The drainage settings lock once a run starts.

### 6.2 Data tiers

Every output is labelled with its tier. The **Data and assumptions** step shows it with a pill.

| Tier | Pipes | Inlets | Source |
|---|---|---|---|
| 1 | real (linked or drawn) | real | **Your own drainage data**, or the **Infrastructure** drawer |
| 2+ | synthetic | real utility inlets | Philadelphia Water or NYC DEP layers |
| 2 | synthetic | synthetic, along streets | built by FloodSim |
| 3 | none | none | **Lumped rate** |

With tier 2 or 2+ pipes, HGL and surcharge results are indicative only (docs/METHODS.md §6.4 item 4, §7.6).

### 6.3 Network settings

| Field | Default | Notes |
|---|---|---|
| **Pipes sized for** | **10-yr storm** (2, 5, 10, 25) | Synthetic pipes, rational method. |
| **Inlet spacing along streets** | 60 m (30–120) | Synthetic inlets. |
| **Roof downspouts connected to the sewer** | 0 %; Build sets 100 % in combined-sewer areas | |
| **Two-way inlet exchange** | on | Surcharged manholes push water back out through the inlets. Untick for inlets-in-only coupling. |
| **Show network on map** | on | |

During a run the readouts show **Into pipes**, **Back onto streets**, **Surcharged manholes** and **SWMM / combined
balance**.

**Inlet hydraulics** (Advanced, under the network settings) sets how fast water leaves the street through each inlet.
You do not need to know the equations to use it: pick a **Kind of inlet** and the four grate fields fill in, with a
line under the list saying what that kind is. Change any number and the list shows **Custom**; pick a kind again to go
back. Bigger openings, higher coefficients and a lower crest all take more water off the street.

| Kind of inlet | Open area | Edge | C<sub>w</sub> | C<sub>o</sub> |
|---|---|---|---|---|
| **Typical street grate** (default) | 0.2 m² | 2.0 m | 0.5 | 0.6 |
| **Street grate, FHWA HEC-22 coefficients** | 0.2 m² | 2.0 m | 0.37 | 0.67 |
| **Small yard or alley grate** (about 0.4 × 0.3 m) | 0.1 m² | 1.4 m | 0.5 | 0.6 |
| **Double grate** | 0.4 m² | 3.0 m | 0.5 | 0.6 |
| **Curb opening** (1.5 m long, about 13 cm high) | 0.2 m² | 1.5 m | 0.28 | 0.67 |

A grate works as a weir while the water over it is shallow, C<sub>w</sub>·P·h<sup>1.5</sup>·√(2g), and as an orifice
once it is deep, C<sub>o</sub>·A·√(2gh), whichever is smaller. h is the depth over the crest. When the pipes back up it
is a submerged orifice on the head difference. Each field has a one-line explanation under it and shows its source and
conversions when you hover over it.

| Field | Default | Notes |
|---|---|---|
| **Open area of the grate** | 0.2 m² per grate | The clear opening (A). A 0.6 × 0.35 m grate. HEC-22 grates are about 0.1–0.3 m² clear. |
| **Edge water spills over** | 2.0 m per grate | The weir length (P): the perimeter, less any side against the curb. |
| **Shallow-water efficiency (C<sub>w</sub>)** | 0.5 | In Q = C<sub>w</sub>·P·h<sup>1.5</sup>·√(2g). That is C ≈ 2.2 (SI) or 4.0 (US) in Q = C·P·h<sup>1.5</sup>. HEC-22's grate value, 1.66 SI (3.0 US), is C<sub>w</sub> ≈ 0.37; its curb-opening value, 1.25 SI (2.3 US), is C<sub>w</sub> ≈ 0.28. |
| **Deep-water efficiency (C<sub>o</sub>)** | 0.6 | HEC-22 uses 0.67. |
| **Inlet sits above the street** | 0 cm | The crest, for inlets that do not set their own. Water below it does not drain. |

Changing any of them resets the run. A run made with values other than the defaults records them in its forcing
fingerprint (**drainSettings → inlets**), so two runs with different inlet settings are not taken as the same forcing.
Debris on the grates is set per inlet in the Infrastructure drawer, or area-wide with **Inlet clogging** under
Calibrate.

**Inlet types in the data.** A city's inlet layer often says what each structure is: Charlotte's lists catch basins
(CB), drop inlets (DI), double catch basins (DCB), curb inlets (CI), slab-top drop inlets with one to four open sides
(SlabDI 1–4) and elongated-throat inlets. FloodSim reads the type from the layer (a field such as `STRUCT_TYPE`,
`STRUCTURE_TYPE` or `INLET_TYPE`) and lists the types with how many inlets each has. **Kinds of inlet by type** says
which grate each type gets:

| Choice | What it does |
|---|---|
| **Automatic** (default) | NCDOT standard drawings when the area is in North Carolina; elsewhere, none. |
| **NCDOT standard drawings** | Each recognised type gets the NCDOT grate of its kind (table below). |
| **Generic kinds (FHWA HEC-22)** | Catch basins and drop inlets get the HEC-22 street grate, doubles the double grate, curb and elongated-throat inlets the curb opening, slab-top inlets the small grate. |
| **None** | Every inlet uses the values above, except the types you pick a kind for. |

In the table you can pick another kind for any type, or **Values above** to keep it on the area-wide numbers. A type
the model does not recognise, and an inlet with no type, uses the values above. The crest and the debris share apply
to every inlet. Under the table each kind in use is listed with where its numbers come from; the ones not read off a
standard drawing say **Estimated**.

| NCDOT kind | Open area | Edge | C<sub>w</sub> | C<sub>o</sub> | Source |
|---|---|---|---|---|---|
| **Catch basin, Type E grate** (840.03) | 0.29 m² | 2.1 m | 0.37 | 0.67 | 3.1 ft² clear opening. Edge estimated: three sides of the grate. |
| **Double catch basin** | 0.58 m² | 3.0 m | 0.37 | 0.67 | Two 840.03 grates. Edge estimated. |
| **Drop inlet grate** (840.16) | 0.34 m² | 2.62 m | 0.37 | 0.67 | 3.7 ft² and 8.6 ft, open on all sides. |
| **Open-throat curb inlet, 6" throat** (840.04/.05) | 0.20 m² | 1.4 m | 0.28 | 0.67 | 1.8–2.5 ft² opening; the 1.4 m length is estimated. |
| **Elongated throat curb inlet, 8" throat** | 0.31 m² | 1.5 m | 0.28 | 0.67 | Top of the 2.3–3.3 ft² range; the length is estimated. |
| **Slab-top drop inlet**, per open side | 0.15 m² | 1.0 m | 0.28 | 0.67 | All four estimated, × the number of open sides. |

The open areas are the clear openings in the NCDOT Drainage Box Depths table. NCDOT's own capacities in that table
assume half the grate is blocked; FloodSim uses the clear opening and leaves blockage to **Inlet clogging**. A run whose
types get kinds records them in its forcing fingerprint (**drainSettings → inletTypes**). To see what the kinds do,
run with **None**, then with **Automatic**, and compare the two as a settings test (section 7.2).

**Pipe solver settings** (Advanced, under Inlet hydraulics) controls how SWMM, the pipe model, works out the flow. The
defaults suit most runs. The quickest way to try something is the **Speed or accuracy** list:

| Choice | Longest step | Step shortening | Levels settle to | Tries per step |
|---|---|---|---|---|
| **Balanced** (default) | 1 s | 0.75 | 1.5 mm | 8 |
| **More accurate, slower** | 0.5 s | 0.5 | 0.5 mm | 20 |
| **Faster, rougher** | 2 s | 0.75 | 5 mm | 4 |

Changing a field by hand shows **Custom**. To judge a change, run and read **SWMM / combined balance**: within ±1 %
SWMM kept track of all the water; if it is worse than with Balanced, the change cost accuracy. To see what a setting
did to the flooding, run a **settings test** (section 7.2): run once, change only the inlet or pipe solver settings, run
again, and pick the two runs in Compare or Report.

| Field | SWMM option | Default | What it does |
|---|---|---|---|
| **Longest time step** | ROUTING_STEP | 1 s | 0.1–2 s. Water passes between the pipes and the street every 2 s, so 2 s is the most. |
| **Step shortening** | VARIABLE_STEP | 0.75 | The safety factor on the Courant step of the shortest pipes; 0 keeps a fixed step. |
| **Levels must settle to** | HEAD_TOLERANCE | 1.5 mm | Each step repeats until every node's level changes by less than this. Entered in mm. |
| **Tries per step** | MAX_TRIALS | 8 | The most times a step repeats to settle. |
| **Smallest manhole water area** | MIN_SURFAREA | 1.2 m² | The least surface area at every node. Larger is steadier. |
| **When a pipe runs full** (Methods) | SURCHARGE_METHOD | Preissmann slot | Or EXTRAN. On the surcharged South Street network EXTRAN's continuity error was −4.6 to −6 %, the slot's −0.35 %. |
| **Damping of fast-changing flow** (Methods) | INERTIAL_DAMPING | Partial | Or Full (steadiest) or None. |
| **Limit flow to normal flow** (Methods) | NORMAL_FLOW_LIMITED | Slope or Froude | Or either alone. |
| **Flattest pipe slope** (Methods) | MIN_SLOPE | 0 % | Flatter pipes are steepened to this. |
| **Lengthen very short pipes** (Methods) | LENGTHENING_STEP | On | On sets it to the routing step; off, 0. |

Changing any of them resets the run. Settings other than the defaults go into the forcing fingerprint
(**drainSettings → routing**), and every run's `drainage/network.inp` holds the options it used.

### 6.4 Combined sewer

Open **Combined sewer** (Sanitary, regulators, gates).

| Field | Default |
|---|---|
| **Combined sewer area** | ticked by Build where the utility's area, or most linked pipes, are combined |
| **Dry-weather (sanitary) flow in the pipes** | on |
| **Interceptor capacity at each regulator, × peak dry-weather flow** | 3 |
| **Sanitary flow, L per person per day** | 300 |
| **People per ha of developed land (blank = by land cover)** | blank (8 / 25 / 60 / 120 per ha by NLCD intensity) |
| **Dry hours that separate overflow events** | 6 |
| **Flap gates on outfalls to tidal water** | on |

With it on, each outfall to a stream becomes a regulator: flow up to the interceptor capacity goes on to treatment, and
the rest spills over a weir to the river. The report's **Combined sewer overflows** section gives the overflow per
regulator. Regulators and population are generic planning defaults, not the utility's structures or the census. Do not
use them for compliance work (docs/METHODS.md §1.3, §7.6).

### 6.5 Green infrastructure and storage (area-wide)

| Field | Range | Effect |
|---|---|---|
| **Streets converted to permeable pavement** | 0–100 % | stores 200 mm, takes 1000 mm/hr |
| **Open ground converted to rain gardens** | 0–30 % | stores 300 mm at 100 mm/hr |
| **Roofs with green roofs** | 0–100 % | hold the first 25 mm of rain |
| **Underground storage at the outfalls** | 0–20,000 m³ | SWMM storage at the manholes feeding each outfall (pipe network only) |

For features at real locations, draw them in the **Site design** drawer instead ([7.1](#71-site-design-drawer)).

### 6.6 Infrastructure drawer

Map button **Infrastructure**. Draw, import or estimate the pipe network and flood barriers. Units: **US (in, ft)** or
**SI (mm, m)**.

**Tools:** **Select**, **Pipe**, **Culvert**, **Manhole**, **Catch basin**, **Outfall**, **Underground storage**,
**Flood wall**, **Levee / berm**, **Deployable**. The hint under the tools explains each one. Pipes are drawn upstream
to downstream; double-click or Enter finishes; Esc cancels; Backspace removes a vertex.

**Buttons:**

- **Estimate from streets**: turns the street-following network (or linked pipes) into editable features.
- **Import file…**: GeoJSON, zipped shapefile, or `.shp` + `.dbf` + `.prj`. Under **Import options** set **Import as**
  (or **Detect from geometry and file name**), **Pipe size units** and **Inverts and rims in** (**feet NAVD88** or
  **metres NAVD88**).
- **Export GeoJSON**, **Clear layer**.

**Build precedence:** pipes in this layer replace linked and synthetic pipes. Catch basins and outfalls in it replace
utility ones. Catch basins and culverts take a **Blocked by debris** setting (clear, 25 / 50 / 75 %, fully blocked).
A catch basin also takes a **Crest above the street**: a gully lip or a raised kerb inlet that water must rise over.
Leave it blank for the area's setting under Drainage → Inlet hydraulics. The crest is measured from the model cell's
ground, which on a 2–4 m grid is the cell's mean, not the gutter's lowest point.
Barriers take a crest as a height above ground or a fixed elevation; deployable barriers go up from the start, at a set
time, or not at all.

---

## 7. Design scenarios and the analysis drawers

### 7.1 Site design drawer

Map button **Site design**. Draw a proposed development over a built model. FloodSim applies it to the 1 m layers with
nothing fetched again.

**Scenarios.** The list at the top always holds existing conditions, with no features. **New**, **Copy**, **Rename** and
**×** (delete) manage proposed scenarios. Drawing on existing conditions starts a new scenario. Later features override
earlier ones where they overlap. The active scenario is the one a run uses.

**Design tools:**

| Tool | Draws |
|---|---|
| **Building** | a proposed building from a preset (foundation, finished floor, apron, roof, height) |
| **Pad** | a graded pad: flat, a plane through three spot elevations, or balanced cut and fill |
| **Paved** | driveway, parking, sidewalk or road, optionally graded, with a curb |
| **Demolish** | removes a mapped building |
| **Control line** | a line whose flow is booked every step (shared by all scenarios) |
| **Profile** | a line along a street, swale or channel for a water-surface profile in the Report (shared) |
| **Site** | the site boundary: comparisons split on-site and off-site (one per project) |

**Stormwater tools:** **Pond**, **Outlet**, **Swale**, **Rain garden**, **Permeable**, **Downspout**.

Other controls: **Cut and fill on the map** (red cut, blue fill), the design log (cut, fill, impervious change,
floodplain fill and warnings), and **Scenario settings (BFE, freeboard, slopes)**. Building presets are defaults:
confirm them against the local code. The rules for finished floor, grading and ponds are in the README "Site design"
and docs/METHODS.md §4.7.

After a scenario run, each new building is reported flooded or dry against its finished floor. The run log warns "N of
M new buildings flooded above the FFE".

### 7.2 Compare drawer

Map button **Compare**. Two runs compare when their forcing fingerprints match: they may differ in the design and
nothing else. Two runs of the same design that differ only in the inlet and pipe solver settings also compare, as a
**settings test** (below).

1. Draw control lines at the site outlets and a site boundary first (Site design).
2. Click **Run both**. It runs existing conditions (unless a run with the same fingerprint is cached in this session),
   then the active scenario, with the same storm, gauge readings and settings, at full speed.
3. Or pick **Before (existing)** and **After (proposed)** from this session's runs and the project's saved runs.
   **Refresh list** reloads them.
4. Pick the **Map**: **Δ max water surface**, **Δ max depth**, **Δ time above 15 cm**, **Δ first wetting (arrival)**,
   **Δ hazard class (ARR)**, **Newly wet / newly dry**.
5. Set **No-change band** (default 3 mm). **Hide on-site changes (off-site only)** shows off-site changes alone.
6. Read **Off-site impact**, **Changes**, **Totals**, **Buildings near the site** and **Control lines** (with the
   post ≤ pre check).
7. Click **Export comparison (.zip)**. With a project open, it is also saved under `comparisons/`.

If the runs differ in more than the design, the drawer says **Not comparable** and names the parts that differ.

**Settings test.** To see what an inlet or pipe solver setting does to the flooding:

1. Run with the settings as they are (for example, existing conditions with the defaults).
2. Change only the settings under Drainage → **Inlet hydraulics** or **Pipe solver settings**. Keep the storm, the area
   and the design the same.
3. Run again.
4. In Compare, pick the first run as **Before** and the second as **After**.

The drawer says **Settings test**, lists each setting that differs with its before and after value, and shows the same
Δ maps and tables. The off-site impact heading reads **Where the water is higher**, since no design is being judged.
The export is named `settings-test_…` and its `comparison.json` has `kind: "settings"` and the settings changed.
Runs that differ in both the settings and the design, or in anything else, are refused: change one thing at a time.

**Return-period sweep and detention check.** Enter **Design storms (yr)** (default `2, 10, 25, 100`) and click **Run
sweep**. It runs existing conditions and the active scenario at each Atlas 14 return period. **Cancel** stops it.
**Detention table (.csv)** downloads the result.

**Window reruns** (large models). **Run both in a window** reruns the scenario only on a window around the site plus
**Margin around the site** (default 150 m). **Check the window** reruns existing conditions on the window, so the
difference from the full run is the window's own error. If the edge check says segments changed by more than 5 %, widen
the window.

### 7.3 Emulator drawer (screening only)

Map button **Emulator**. A fast statistical stand-in for the solver, trained on the project's own runs.

1. Choose **Study**, give it a name and scenario, set the parameters and ranges, and click **Create study**.
2. Click **Run training** (it resumes where it stopped; **Cancel** stops it).
3. Click **Train**. The drawer shows the leave-one-out and held-out test errors.
4. Move the sliders to see maps. **Check with the solver** runs the solver at the slider values and reports the error.
   **Add a run where it’s least sure** adds a training run.
5. **Send to Compare** puts the emulated map in Compare, marked emulated. **Export grids** writes `.asc` grids.

It is valid only inside its trained range, for that scenario and that model build. Confirm any number with a solver run
before it goes in a report (docs/METHODS.md §1.3, §7.10).

---

## 8. Step 4: Run, and the run log

### 8.1 Running

1. Open **4 Run**.
2. Click **Run**. The first click fetches gauge readings (start levels, inflows, outlet), builds the solver and starts.
   The button then reads **Pause**.
3. Click **Pause** to pause and **Run** to continue.
4. When the run reaches the end of the storm plus **Keep running after the storm**, the button reads **Done** and is
   disabled.
5. Click **Reset** to set up a new run (and to unlock the storm and drainage settings).

**Speed** sets how fast the simulation runs against real time, from 1× up to 10,000×; at the right end it reads **max**
(as fast as the GPU allows). Speed does not change the result: steps are cut only at fixed simulated times, so a rerun
repeats the same steps (docs/METHODS.md §8.3).

A run keeps going in a background tab. The map redraws when you come back.

### 8.2 Run readouts

| Readout | Meaning |
|---|---|
| **Time step** | the current solver step |
| **Steps** | steps taken |
| **Rain so far** | rain fallen |
| **Flooded > 15 cm** | area deeper than 15 cm now |
| **Water stored** | water on the ground |
| **Outflow / infiltration** | water out across the edge / soaked in |
| **Mass balance error** | the surface books' error, relative to all water in |
| **Speed achieved** | simulated time over wall time |

Notes under the readouts give barrier and hazard results when they apply. **Open the report** opens the Report drawer.

### 8.3 The run log

The log is the list under **Build model** in step 1. It keeps the build lines and adds lines while you run. Symbols:
✓ done, ! warning, × error, … in progress. Read it before and after every run. Warnings that matter most:

- "N exchange points share a cell with another: the surface books will not close".
- "The water books are X % out at T: this run's results are not reliable."
- "River inflow: …" and "River outlet: …" (the run carries on without them).
- "Gauge levels: …" (start levels not applied).

The full list, with what to do, is in [Troubleshooting](#15-troubleshooting).

### 8.4 Filing the run

With a project open and **File every finished run in the project (runs folder)** ticked (the default, in the Projects
dialog), each finished run is saved to `runs/<date_time>/`. **Save run** (in the Run step, shown when a project is open)
saves the current run by hand, including a paused one; its `summary.json` then has `"finished": false`.

A run is filed only if its area is the project's saved area. Otherwise the status reads "This run's area is not
“*project*”'s: save it as a project first (not filed)".

---

## 9. Reading results and exporting them

### 9.1 Map view

| Group | Buttons |
|---|---|
| **Now** | **Depth**, **Velocity**, **Hazard** |
| **Peak over the run** | **Depth**, **Hazard** (worst class), **Force**, **Duration** (time deeper than 15 cm), **Arrival** (first 15 cm), **Scour**, **Bed**, **Collapse**, **Banks**, **Grain** |
| **Physics now** | **Froude**, **Time step**, **Flow** |

Other controls: **Hazard classes** (**ARR 2019 / AIDR H1–H6** default, **UK FD2320, HR = d(v + 0.5)**, **UK FD2320
with urban debris factor**), **Water opacity**, **Basemap** (**USGS orthoimagery (public domain)** or **Esri World
Imagery**), and layer toggles **FEMA flood zones and BFE lines**, **Building footprints**, **Lidar hillshade**, **NLCD
land cover**.

**NEXRAD radar** shows radar on the map for display: **Off**, **This historic storm**, **Live, last hour**, **Rain the
model uses (MRMS, 2 min)**. The slider steps through frames and ▶ loops them. The model's rain still comes from the
Storm step.

**How the engine works** (Physics) summarises the scheme; the detail is docs/METHODS.md §2.

Velocity counts in hazard and force only where water is at least 5 cm deep.

### 9.2 Data and assumptions

Step **7 Data and assumptions** lists, for the built model: terrain source and tier, river inflow, solver grid,
buildings, site design, streets, land cover, soils, ground hazards, drainage tier, boundaries, rivers, green
infrastructure, culverts and channels, and the storm. Copy this into the report's assumptions.

### 9.3 Report drawer

Map button **Report**, or **Open the report** in the Run step.

1. Pick **Run (after)**. For a before / after report, also pick **Before (optional)**. Both lists hold this session's
   runs and the project's saved runs. **Refresh list** reloads them. The pair must share its forcing, or be a settings
   test (section 7.2); a settings test's report lists the settings that differ at the top.
2. Set the report inputs:

| Field | Default |
|---|---|
| **Manhole freeboard** | 1 ft |
| **Allowable gutter spread** | 8 ft |
| **Flooded areas: peak depth at least** | **15 cm (6 in)** (5, 30 or 60 cm) |
| **Damage: least water against a wall** | **10 cm (4 in)** (5, 15 or 30 cm) |
| **Benefit–cost inputs**: **Project cost, $**; **Operation and maintenance, $ a year**; **Real discount rate, %**; **Period of analysis, years** | 0; 0; 3.0; 50 |

3. Read the sections. A section appears only when the run has what it needs.

| Section | Shows |
|---|---|
| **Summary** | water balance: every way water came in and left, and the balance |
| **Validation scorecard** | real storms only: marks, gauges, flood maps, rain and books against targets ([10.3](#103-validation-scorecard)) |
| **Flood maps** | peak depth, worst hazard class, arrival, duration; change for a pair |
| **Hydrographs** | control lines and storm-sewer outfalls |
| **Detention ponds** | stage–storage, stage–discharge, stage and outflow in time |
| **Detention check over the design storms** | from Compare's sweep, this session |
| **FEMA flood zones** | area by zone; new buildings against the BFE |
| **Storm sewer hydraulic grade line** | HGL profile from a manhole (pick one, or click it on the map), manhole and pipe tables |
| **Water surface profiles** | along each profile line |
| **Gutter spread** | per inlet, against the allowable spread |
| **Rain against nearby gauges** | historic and live storms |
| **River inflow** | inflow hydrographs and peak-flow tables |
| **Flooded areas** | connected flooded areas with depth, timing, hazard, streets and buildings |
| **Streets and access** | length over 15 cm and 30 cm per street |
| **Building damage** | NSI structures and USACE depth–damage curves |
| **Expected annual damage and benefit–cost** | from saved runs at several return periods |
| **Combined sewer overflows** | per regulator |
| **Sensitivity** | the batch variants against the base run ([12](#12-batch-studies-and-sensitivity-variants)) |
| **Model checks** | the checks table ([10](#10-model-checks-reading-them-and-acting-on-them)) |
| **Compound flooding and sea-level rise** | tidal sites |

4. Click **Export report (.zip)**. It holds `report.html` (with the runs, storm, fingerprint and commit; prints to
   PDF), every figure as SVG and PNG, and every table as CSV. With a project open it is also saved under `reports/`.

Damage and EAD rest on generic curves and stated exposure filters. Report the band and the filters (docs/METHODS.md
§4.5, §7.9).

### 9.4 Run folder files

Each filed run is `runs/<date_time>/` in the project (batch runs add the job label to the folder name).

| File | Contents |
|---|---|
| `summary.json` | storm, tide, drainage, settings, results, books, hazard areas, validation inputs, `scenario`, `designHash`, `forcingHash`, `forcing`, `commit`, and a `files` dictionary describing each output |
| `max_depth.asc`, `max_speed.asc` (+ `.prj`) | ESRI ASCII grids; open in QGIS or ArcGIS |
| `hazard_arr.asc`, `hazard_fd2320.asc`, `hazard_fd2320_urban.asc`, `max_dv.asc`, `max_force.asc`, `flood_duration_min.asc`, `arrival_min.asc` | hazard and timing grids |
| `grids/*.f32` + `.hdr` | the 1 m comparison grids (max depth, max water surface, max speed, max depth × speed, first wetting, time above 15 cm, final depth, hazard), and `grids/ground.f32` for a scenario |
| `hyetograph.csv` | rain per block |
| `network.inp`, `swmm_report.rpt` | the SWMM model as run, and SWMM's report |
| `network.json`, `hgl.json`, `inlets.json` | the network, its HGL books and the inlets with their spread |
| `infrastructure.geojson`, `design.geojson`, `analysis.geojson` | the layers as run |
| `lines.json`, `control_lines.csv`, `buildings.json` | control-line books and hydrographs; new buildings |
| `barriers.csv`, `calibration.csv`, `banks.csv`, sediment and scour grids | when those features are on |

Two max-speed products exist: `grids/max_speed.f32` is tracked every solver step (where over 5 cm deep);
`max_speed.asc` is sampled at the display frame rate (where over 1 cm). Use the `.f32` grid for analysis
(docs/METHODS.md §7.8). The meaning of every grid is in docs/METHODS.md §4.1.

### 9.5 After a run of a real storm

When a historic or live run finishes, the app fetches the USGS gauge readings and nearby rain gauges for the scorecard
(at most 20 s). Wait for that before you read the Validation scorecard.

### 9.6 Export step: 3D and HEC-RAS packages

| Control | Gives |
|---|---|
| **Save a depth frame every** (**1 min**, **5 min** default, **10 min**, **Off**) | frames for the 3D package; set before the run |
| **Download 3D package (.zip)** | 16-bit heightmap and EXR DEM, buildings as GLB, max depth, a depth/velocity EXR sequence and `metadata.json`, for Unreal Engine or Blender |
| **Download HEC-RAS 2D package (.zip)** | terrain and land-cover GeoTIFFs (NAD83 / UTM, NAVD88), Manning's n by class, perimeter, boundary-condition lines and breaklines as shapefiles, inflow, tide and rain series as CSV, and a README of the RAS Mapper steps |

The HEC-RAS package does not include the storm sewer, culverts, ponds, green infrastructure or starting water levels
(README "HEC-RAS 2D package"). The SWMM network is in each run's `network.inp`.

---

## 10. Model checks: reading them and acting on them

### 10.1 The checks table

The Report's **Model checks** section rates each check:

| Mark | Meaning |
|---|---|
| **✓ OK** | within the threshold |
| **! Check** | look at it, and explain it in the report |
| **✕ Problem** | resolve it, or explain why it does not apply |
| **– Not tested** | no data for this check |
| **i Reported** | a value with no pass mark (sensitivity variants) |

The thresholds and meanings are in docs/METHODS.md §6.1 (from `LIMITS` in `src/checks.js`). A failing row should be
resolved or explained, not ignored.

### 10.2 What to do when a check fails

| Check | Usual cause | What to do |
|---|---|---|
| **Flooding within 50 m of the edge** | the flood reaches the free-outfall edge | Draw the area wider, past the place of interest. Use **Watershed** → **Run on the watershed** so the edge is a ridge. |
| **Edge flooded ≥ 15 cm** | the flood continues past the edge | As above. On a tidal edge this is expected; the table says so. |
| **Water out across the edge** | the area cuts across a flow path | Extend the area downstream. For a river leaving the area in a historic storm, set **River leaving the area** ([5.7](#57-upstream-river-inflow-and-river-leaving-the-area)). |
| **Ground outside that drains in** | runoff from outside is missing | **Run on the watershed**, or add a river inflow. If it reads Not tested, click **Watershed** in step 1. |
| **A river enters from a large basin** | no inflow set | Set the river's source under **Upstream river inflow**. |
| **Surface water books** | a numerical or bookkeeping fault | Do not use the run. Read the run log for "exchange points share a cell" or a mass warning, and the browser console for GPU errors. Rerun. |
| **Surface and sewer books** | usually SWMM's continuity, or bad pipe data | Read `swmm_report.rpt`. For linked pipes, check inverts and **Add to inverts (to NAVD88)**. Open `network.inp` in SWMM5. |
| **Water left at the end** | the run stopped before the flood drained | Raise **Keep running after the storm**. Ponds legitimately hold water. |
| **Run past the end of the rain** | the tail is short | Raise **Keep running after the storm** (30 min or more). |
| **High-water marks near the edge** | marks within 50 m of the edge | Extend the area; treat those marks as a test of the boundary. |
| **Drawn features near the edge** | a design feature within 50 m of the edge | Widen the area so its effect is not cut off. |
| **One cell size coarser: overlap** / **depth change** | results depend on the cell size | Use 1 m. If a 1 m run fails against 2 m, report it: the data do not support cells below 1 m (docs/METHODS.md §6.3). |
| **Base and variants from one FloodSim version** | runs from different commits | Rerun the base and the variants together in one batch. |
| **Sensitivity runs** (Not tested) | no variants saved | Run a batch study with the variants ([12](#12-batch-studies-and-sensitivity-variants)). |

The reviewer's checklist in docs/METHODS.md §6.4 lists what a submitted run should show. Use it as your sign-off list.

### 10.3 Validation scorecard

For runs of real storms (historic or live), the Report's **Validation scorecard** rates each line ✓ good, ~ fair or ✕
poor against FloodSim's default targets for an urban model at 1 m. These are not a published standard; apply your
agency's targets if they differ. The verdict comes from the observations alone, except that books that do not close
make it poor. A design storm, or an area with no marks or gauges, says it is not validated and why. Targets and scoring
rules: docs/METHODS.md §6.2.

If the gauges were still rising at the end of the run, the scorecard says so. Marks record the crest, so a run that
stops early reads low. Lengthen **Keep running after the storm**.

### 10.4 Calibrate: score against observations

Step **6 Calibrate**.

**Observations:**

1. Pick the units (**feet NAVD88** or **metres NAVD88**) and click **Import observations**. The file is a CSV with lat,
   lon and a water surface elevation (wse / elev), a depth, or flooded yes / no; or GeoJSON points with the same
   fields.
2. Or click **USGS high-water marks** and pick an event. With a historic storm loaded, it picks that storm's event.
   Coverage is mostly large river and coastal floods.
3. **Clear** removes them.

**Flood maps:** **Import flood map** takes GeoJSON polygons with a depth, or NYC DEP Stormwater Flood Map categories;
features with `mask: true` limit scoring to where the map was made. **Clear maps** removes them.

Every finished run is then scored, and points on the map turn green, red or amber.

**Parameters:** **Roughness (Manning n) ×** (0.6–1.6), **Infiltration ×** (0.25–2), **Inlet clogging** (0–70 %).

**Sweep:**

1. Leave **Sweep in the 4 m speed mode (then confirm the best at 1 m)** ticked unless you have time for 1 m runs.
2. Pick **2 values each (8 runs)** or **3 values each (27 runs)**.
3. Click **Sweep**. **Stop** stops it. The best combination is applied.
4. Confirm the best settings with a 1 m run.

On sewered, impervious sites, marks may not pin these settings down; the app says so when it happens. The multipliers
are global (docs/METHODS.md §7.10).

---

## 11. Reproducing a run

### 11.1 What each run records

`summary.json` in each run folder holds (docs/METHODS.md §8.1–8.2):

| Field | What it is |
|---|---|
| `forcingHash` and `forcing` | the forcing fingerprint: a hash per part and a hash of the parts |
| `designHash` | a hash of the built 1 m model layers (terrain, buildings, roads, land cover, soils …) |
| `commit` | the app's git commit (12 hex characters), with `+dirty` when code differs from it |
| `settings` | every setting, as `project.json` holds them |
| `scenario` | the design scenario, or `Existing conditions` |

The fingerprint parts, by the names Compare uses when it refuses a pair:

| Part | Covers |
|---|---|
| storm | depth, duration, pattern, or the historic event and its rain source (with a hash of MRMS frames) |
| river inflow | each entry's flow |
| tide and surge | the water-level series |
| start water levels | the gauge readings used |
| antecedent soil moisture and water table | infiltration model, wetness, water table |
| grid size and speed mode | |
| solver settings | |
| run length | stop time and any warm-up |
| sediment, debris and bank options | |
| drainage, green infrastructure, infrastructure layer and calibration | |
| model area | box, polygon, curb burn, bathymetry |
| app commit | the commit, with `+dirty` |

### 11.2 What `+dirty` means

`+dirty` means that, when the page loaded, a file that can change a result differed from the commit. "Can change a
result" means files under `app`, `src`, `server`, `vendor`, `dist` and `tools`, and the package files, including new
untracked files there. Markdown files do not count, so editing docs, or the validation suite's own score pages, does not
make a run dirty (`tools/codestate.mjs`).

A `+dirty` run's `summary.json` lists the changed files as `codeChanged`. A clean run has no such field. The list
names the files, not what changed in them, so archive a copy of the changed files with a `+dirty` run you need to keep,
or commit them first and run again.

The commit is read once, when the page loads. If you commit while the page is open, reload the page before the run so
the record carries the new commit.

A submitted result should come from a commit that is not `+dirty` (docs/METHODS.md §6.4 item 1).

Because the commit is a fingerprint part, Compare refuses to pair runs made with different commits.

### 11.3 Steps to reproduce a run

1. Read `commit`, `forcingHash` and `designHash` from the run's `summary.json`.
2. Check out that commit: `git checkout <commit>` (without the `+dirty` suffix). A `+dirty` run cannot be reproduced
   exactly from the commit alone.
3. Put the project folder in the projects folder, and the `.cache/` folder from the original machine in the FloodSim
   folder (including `.cache/bluetopo/` if BlueTopo was used). Without the cache, the open data are fetched again and
   may have changed (docs/METHODS.md §8.7).
4. Start FloodSim and open the project (**Projects** → **Open**). Opening rebuilds the model from the saved settings and
   reloads a historic event if one was used.
5. Run it. The new run's `designHash` should match: if it differs, the built layers differ (new data or no cache).
6. In **Compare**, pick the old run as **Before** and the new run as **After**. If the fingerprints differ, the drawer
   names the parts. If they match, the Δ maps should show no change: rerunning a run gives Δ = 0 on the same machine
   (docs/METHODS.md §8.3). Determinism across GPUs or drivers is not documented.

### 11.4 What to archive with a submitted result

From docs/METHODS.md §8.7: the project folder, the relevant `.cache/` content, the commit, and the SWMM build
(`vendor/swmm-wasm/`).

---

## 12. Batch studies and sensitivity variants

A batch study runs many jobs one after another, at full speed. Each job is filed in the project as an ordinary run.
The study needs an open project: the study, its runs and the checkpoints live in the project folder.

### 12.1 Plan and run a study in the app

1. Build the model and set the storm, drainage and every other input as you want the base run.
2. Open the **Batch** drawer.
3. Tick the jobs:
   - **Design storms (Atlas 14)**: return periods (2, 10 and 100-yr ticked by default). After a joint rain–surge
     analysis, its design pairs appear here too.
   - **Durations** (24 hours ticked by default), or **The storm as set now (historic, live or custom)**.
   - **Scenarios**: **Existing conditions** and each site-design scenario (all ticked by default).
   - **Variants** (table below; **As set** ticked by default).
4. Set **Checkpoint every** (minutes of wall-clock time, default 10).
5. Click **Count the runs** to see the number of jobs.
6. Click **Start**. The job table shows each job's status, wall time and run folder.
7. **Pause** saves a checkpoint and stops. **Resume (N of M left)** carries on.

Every combination of storm × scenario × variant is one job. Jobs run storm by storm, existing conditions first, so each
with / without pair finishes together. The settings at **Start** are saved with the study as its base, and each job
applies its storm and variant on top.

**Variants:**

| Variant | Changes | Notes |
|---|---|---|
| **As set** | nothing | the base run |
| **Roughness × 0.8**, **Roughness × 1.2** | all Manning's n | |
| **Infiltration × 0.5** | infiltration capacity everywhere | |
| **Rain + 10 % (design storms)** | sets **Climate uplift on depths** to 10 % | design storms only; it sets the uplift to 10 rather than adding to an uplift already set |
| **One cell size coarser** | 1 m → 2 m, 2 m → 4 m, 4 m → 8 m subgrid, 4 m subgrid → 8 m subgrid | the grid-convergence test; from the 8 m subgrid there is no coarser size |
| **SLR Intermediate 2050 / 2100**, **SLR Intermediate-High 2100**, **SLR High 2100** | sea-level rise scenario and year | offered at tidal sites |

The Report's **Sensitivity** section compares each variant with its base over the cells flooded in either run: the fit,
depth changes, changes in area, volume and damage, and elasticities (docs/METHODS.md §6.3). The **Model checks** grade
the cell-size variant. A batch of return periods also fills the **Expected annual damage and benefit–cost** section.

### 12.2 Checkpoints and resuming

During a run under way in a project, a checkpoint is copied to `runs/_checkpoint/` every checkpoint interval. A reload,
a crash or **Pause** loses at most one interval. **Resume** rebuilds the run from the same settings and restores the
checkpoint. It refuses if the forcing fingerprint differs. Export animation frames are not checkpointed
(docs/METHODS.md §8.6).

### 12.3 Headless batch runs

To run a study with the page closed, plan it in the app first (the drawer writes `batch.json` when you click
**Start**), then run:

```bash
npm run batch -- "<project folder>"
```

`<project folder>` is the folder's name in the projects folder. The tool runs the study in headless Chrome or Edge on
the machine's GPU.

| Option | Default | Effect |
|---|---|---|
| `--url http://localhost:8766` | starts its own server on a free port | reuse a running FloodSim server |
| `--retries 3` | 3 | relaunches after a browser or GPU crash; the job under way resumes from its checkpoint |
| `--hours 0` | 0 (no limit) | give up after this many hours |
| `--headed` | off | show the browser window |

It prints each job and, at the end, the run folder of each job done. It exits 0 when every job is done and 1 when any
failed. Ctrl+C stops it; the study resumes from its last checkpoint next time. The page form it uses is
`map.html?project=<folder>&batch=run`.

---

## 13. The validation suite

The validation suite holds FloodSim to observed floods from release to release. Each case is a project of a storm with
observations, or another model's map to compare with. Cases are listed in `benchmarks/validation/cases.json`.

| Case id | Project | What it tests |
|---|---|---|
| `manayunk-ida` | Manayunk Ida 2021 | Schuylkill River flood (docs/METHODS.md §5.8) |
| `forest-hills-ida` | Forest Hills Ida 2021 | street and basement flooding (§5.9) |
| `forest-hills-ida-band` | Forest Hills Ida 2021 band | uncertainty band, 4 m speed mode (§5.11) |
| `forest-hills-dep-moderate` | Forest Hills DEP Moderate | against NYC DEP's model map, a comparison only (§5.10) |
| `edwards-branch-clt` | Edwards Branch Charlotte 2025 | real storm sewers, 12 June 2025 (§5.12) |
| `edwards-branch-clt-2024-01` | Edwards Branch Charlotte 2024-01 | 9 January 2024, winter storm |
| `edwards-branch-clt-2023-08` | Edwards Branch Charlotte 2023-08 | 10 August 2023, summer storm |

### 13.1 Scoring the latest runs

```bash
npm run validate
```

This scores each case's latest finished run filed in its project, with the same scorecard as the app. It adds the
scores to `benchmarks/validation/history.json` and rewrites `benchmarks/validation/README.md` with the latest score of
each case, the change from the run before, and each case's history.

### 13.2 Options

Run as `node tools/validate.mjs [options]`:

| Option | Effect |
|---|---|
| `--run` | runs each case again headless first (hours of GPU time: Manayunk takes about 7 h). A missing project is installed from `benchmarks/validation/<case>/project.json`. |
| `--run --ensemble` | also runs the variants (roughness ± 20 %, infiltration × 0.5, one cell size coarser), giving the marks' uncertainty band |
| `--run --variants-only` | the variants alone, for a base run made by hand in the app |
| `--case id,id` | only these cases |
| `--dir <run folder>` | score this filed run instead of the latest |
| `--url http://localhost:8766` | a running server, for `--run` |
| `--note "text"` | kept with this round's entries in the history |

It exits 0 when every case scored and 1 when any run or score failed.

The band is a sensitivity band, not a probability. A mark inside it is one the model reaches with plausible inputs. A
mark outside it points at something no variant moves: the channel, an edge, the rain or the ground model
(docs/METHODS.md §5.11).

---

## 14. Projects

A project saves the area, every setting, the infrastructure layer, the design scenarios, and every run.

### 14.1 Where projects are saved

Each project is a folder in `Documents\FloodSim Projects`. Set the environment variable `FLOODSIM_PROJECTS` before
starting the server to use another folder. The project API answers only on the local machine (loopback). The Projects
dialog shows the folder path and has **Open the projects folder**.

### 14.2 Save and open

- **Save as new project:** click **Projects**, type a name (for example `2024-117 Main St drainage`) and click **Save as
  new project**. If the folder exists, the app asks before it overwrites the settings.
- **Save:** click **Save**, or press Ctrl+S. The status reads **Saved**.
- **Open:** click **Projects**, then **Open** beside a project. **Folder** shows it in Explorer. Opening rebuilds the
  model from the saved settings and reloads a historic event if one was used.
- **File every finished run in the project (runs folder)**: ticked by default.

### 14.3 Folder layout

```
<project>/
  project.json                  area and every setting
  infrastructure.geojson        Infrastructure drawer layer
  analysis.geojson              control lines, profile lines, site boundary
  batch.json                    batch study: jobs, status, run folder, wall time
  scenarios/<name>/             design.geojson, scenario.json
  runs/<date_time>/             one folder per filed run (section 9.4)
  runs/_checkpoint/             checkpoint of the run under way
  comparisons/<date_time>_…/    exported comparisons
  reports/<date_time>_…/        exported reports
  emulators/<name>/             emulator studies
```

(docs/METHODS.md §8.4.)

---

## 15. Troubleshooting

Messages are quoted as the app shows them. *Italics* stand for a value.

### 15.1 Starting and the GPU

| Message or symptom | Meaning | What to do |
|---|---|---|
| "Node.js is not installed. Get it from https://nodejs.org and run this again." | the launcher found no Node.js | Install Node.js and run **Start FloodSim.cmd** again. |
| "The server did not start. Run "node server/server.mjs" in this folder to see why." | the server did not answer within about 15 s | Run that command in a terminal and read its error. |
| Engine status "WebGPU not available in this browser" | no WebGPU | Use a browser with WebGPU (the tools use Chrome or Edge). |
| "No WebGPU adapter" | the browser found no usable GPU | Check GPU drivers and browser GPU settings. |
| "GPU device lost: *…*" | the GPU reset during work | Reload the page. In a batch, resume; the job carries on from its checkpoint. |
| "WebGPU is required to run the solver" (after Build) | the model built but cannot run | Fix the GPU first; **Run** stays disabled. |
| "Projects unavailable: *…*. Start FloodSim with “Start FloodSim.cmd”." | the page cannot reach the project API | Open the page from the FloodSim server (`localhost`), not from a file or another host. |

### 15.2 Area and Build

| Message | Meaning | What to do |
|---|---|---|
| "too large for a 1 m model in the browser; draw a smaller area." | over 20 million 1 m cells | Draw a smaller area. |
| "exceeds this GPU’s buffer limit; pick a coarser cell size." | the solver grid does not fit the GPU | Pick a coarser **Solver cell size**. |
| "Build failed: *…*" | a required source failed (often OpenStreetMap: public Overpass servers return 429/504 under load) | Build again. Responses already fetched are cached. |
| "finest source here is *N* m, so 1 m is interpolated" | no 1 m lidar here; terrain is tier 2 | Accept and state it, or choose another area. **Street curb burn** **Auto** now burns 15 cm. |
| "Land cover unavailable, using urban defaults" | NLCD did not load | Build again; otherwise state the defaults. |
| "Soils unavailable, using compacted-fill rate" | SSURGO did not load | Build again; otherwise state it. |
| "Utility inlets unavailable, synthetic placement" | the utility's GIS did not load | Build again; the run uses synthetic inlets. |
| "Linked data failed" | a linked layer could not be read | Use **Check links**; links must be public https. |
| "No NOAA Atlas 14 estimates here: design storms come from the site record" | outside Atlas 14 coverage | Use **Site-record design**, and read its extrapolation note. |
| "FEMA flood zones unavailable" | the NFHL did not load | FEMA layers and the FEMA report section are missing. Build again. |
| "Watershed: a river enters from a large basin" / "*area* drains in from outside" | upstream water is missing | See [4.3](#43-watershed) and [10.2](#102-what-to-do-when-a-check-fails). |
| "Watershed failed: *…*" | the trace could not run | Try **Watershed** again. |
| Linked links vanished | choosing an **Examples…** site replaces the links (an example without links clears them) | Paste your links again after picking an example. |
| Downspout or combined settings changed after Build | Build sets them for the site | Set them again after Build ([4.7](#47-build-the-model)). |
| "The SWMM engine is not built yet (run `npm run build:swmm`)" | the SWMM WebAssembly did not load | Rebuild it; until then runs treat the network as absent. |

### 15.3 Storms, rivers and tides

| Message | Meaning | What to do |
|---|---|---|
| "Historic record unavailable: *…*" | the site's rainfall record did not load | Build again. |
| "Could not load this event: *…*" | the event's rain could not be built | Try another **Rainfall** choice. |
| "no hourly rainfall here: no gridded record and no airport gauge with a 1-minute archive within 30 km" | no historic rain source at this site | Use a design or custom storm. |
| "Pick the date of the storm." | **Another date…** with no date | Set **Date (local)**. |
| "No rain over the area in the last *N* h (NOAA MRMS)." | live radar found no rain | Nothing to run; try later or a longer window. |
| "Could not load live radar: *…*" | the live MRMS fetch failed | Click **Load live radar** again. |
| "Live water level unavailable: *…*" | the tide gauge's live data failed | The live run has no tide. |
| "Design tide: *station* has no NAVD88 datum, so the levels are on its MSL; check the DEM datum" | the tide levels are not NAVD88 | Check the offset to NAVD88 before trusting tidal levels. |
| "River inflow: recorded flows need a historic storm (pick one under Storm, or a design peak for *gauge*)" | **Recorded flows** with a design storm | Pick a design flow, or a historic storm. The run continues without the inflow. |
| "River inflow: *gauge* has no 15-minute flows for this storm" | no NWIS record then | Pick another gauge or a design flow. |
| "*gauge*: "the storm's return period" needs a design storm: pick a return period" | design flow by storm with a historic or custom storm | Pick a fixed return period. |
| "*gauge*: too few annual peaks for a frequency estimate" | not enough record for log-Pearson III | Use another gauge, StreamStats, or your own peak. |
| "*river*: the hydrograph carries *N* mm of runoff from the basin, more than the storm's *M* mm of rain…" | an ungauged peak too large for this storm | Check the return period and the peak. |
| "*river*: the river peaks at *N* h, after the run ends…" | the inflow peak is after the run | Raise **Keep running after the storm**. |
| "River outlet: needs a historic storm (the downstream gauge’s record); the edges stay free outfalls" | outlet set with a design storm | Use a historic storm, or clear the gauge. |
| "River outlet: no open water on the *side* edge, toward *gauge*; the edges stay free outfalls" | no river on the edge facing the gauge | Check the gauge and the area. |
| "River outlet: *gauge* has no discharge record over the storm; its level is held at the edge with no rise up the reach" | no flow record | Accept, or use another gauge. |
| "River outlet: no cross-sections (*…*); the edge's own section is held all the way" | the lidar sections failed | The prismatic reach is used instead. |
| "River outlet: not used with a tide on the edges (the solver holds one external level)" | tide and outlet both set | Choose one. |
| "Gauge levels: *…*" | start levels from gauges failed | Rivers start at the lidar surface. |

### 15.4 During and after a run

| Message | Meaning | What to do |
|---|---|---|
| "*N* exchange points share a cell with another: the surface books will not close" | two inlets, culverts, outfalls or inflows share a solver cell | Expect a surface-books Problem. Use a finer cell size or move the drawn feature. |
| "Local time stepping is off with *…*; stepping globally" | LTS cannot run with this setup | None needed; the run uses global steps. |
| "The water books are *X* % out at *T*: this run's results are not reliable. Stop it and check the solver (GPU errors in the console, a stuck river entry)." | the surface books are off by more than 1 % | Stop the run. Check the browser console and the river entries. Do not use the results. |
| "Solver error: *…*" | the solver stopped | Reload and run again; report the message if it repeats. |
| "Checkpoint failed: *…*" | a checkpoint could not be written | The run continues; the next try is one interval later. |
| "*N* of *M* new buildings flooded above the FFE (*scenario*)" | new buildings take water above their floor | Review the design. |
| "USACE NSI structures unavailable: *…*" | no structure data | The damage section says no damage is computed. |
| "Export frames now every *N* min: …" | frames would pass the page's memory limit | Pick a longer **Save a depth frame every** before the next run. |
| "HEC-RAS export: river inflow left out (*…*)" | the inflow could not be prepared for the package | Add the inflow in RAS by hand. |
| "This run's area is not “*project*”'s: save it as a project first (not filed)" | the area differs from the project's | Save as a new project, or reopen the project. |
| "No finished run to save" | nothing to file | Run first. |
| "Not comparable. The runs differ in more than the design: *parts*. Rerun one of them with the other's settings." | fingerprints differ | Rerun with matching settings, or use **Run both**. |
| "these runs are on a different model grid than the one built now" | runs from another build | Open the project the runs belong to. |

### 15.5 Projects, batch and validation

| Message | Meaning | What to do |
|---|---|---|
| "Opened *project*: no area saved yet" | the project has no area | Draw an area and **Save**. |
| "Historic event “*…*” not found in the record search: load it again under Storm" | the saved event did not reappear | Pick it again under **Historic storm**. |
| "Scenario “*…*” could not be read: *…*" | a scenario file is damaged | Check `scenarios/<name>/design.geojson`. |
| "Flood map *…* not loaded: *…*" | a project flood map is missing | Import it again in Calibrate. |
| "Open or save a project first (Projects): the study, its runs and the checkpoints live in the project folder." | Batch needs a project | Save a project. |
| "Build the model first." | Batch with no model | Build. |
| "Pick at least one design storm and duration, or the storm as set now." / "Pick at least one scenario and one variant." | empty study | Tick the jobs. |
| "No study in "*folder*": plan one in the app's Batch drawer and Start it (or save it), then run this again." | headless batch found no `batch.json` | Plan it in the app first. |
| "FAILED: the browser crashed *N* times" | headless runs kept crashing | Check the GPU; run again (it resumes). |
| `validate`: "no finished run filed in "*project*"" | the case has no finished run | Run it, or use `--run`. |
| `validate`: "no project "*project*" and no *…* to install it from" | `--run` cannot install the case | Copy the project into the projects folder. |
| Proxy "host not allowed: *host*" | a request to a host outside the allowlist | Linked layers must be public https. |

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **AEP** | annual exceedance probability: the chance a value is exceeded in a year (1 % for the 100-yr event). |
| **Atlas 14** | NOAA's precipitation-frequency estimates for the US, used for design storms. |
| **BFE** | base flood elevation, from FEMA's flood maps. |
| **Books** | the water balance of a run: every way water came in and left. "Surface books" cover the ground; "combined books" add the pipes. |
| **Checkpoint** | a saved copy of a run under way, so it can resume after a crash or pause. |
| **Combined sewer** | a sewer carrying sanitary flow and storm water together; overflows spill at regulators (CSOs). |
| **Control line** | a drawn line whose flow is booked every solver step; gives hydrographs and the post ≤ pre check. |
| **CSO** | combined sewer overflow. |
| **Design hash** (`designHash`) | a hash of the built 1 m model layers; changes when the data or the design change. |
| **Dry-weather flow** | sanitary flow in a combined sewer. |
| **Edge (free outfall)** | the model boundary: water reaching it leaves, nothing flows in, unless a tide or river outlet holds a level there. |
| **Emulator** | a statistical surrogate trained on a project's runs; screening only. |
| **FFE** | finished floor elevation. |
| **Forcing fingerprint** (`forcingHash`) | a hash of everything about a run that is not the design; two runs compare only when it matches. |
| **Green-Ampt** | the default infiltration model, from SSURGO soil properties. |
| **HAG** | highest adjacent grade around a building footprint. |
| **HGL** | hydraulic grade line in the storm sewer. |
| **Hyetograph** | rain intensity over time. |
| **LTS** | local time stepping (opt-in). |
| **MRMS** | NOAA Multi-Radar Multi-Sensor radar rainfall, about 1 km and 2 minutes. |
| **NAVD88** | the vertical datum used throughout. |
| **Nowcast** | a short forecast moving the latest radar rain along the storm's motion; screening only. |
| **NSI** | USACE National Structure Inventory, used for building damage. |
| **Run log** | the list under **Build model** with build and run messages. |
| **Scenario** | a proposed site design over existing conditions. |
| **STN** | the USGS Short-Term Network of surveyed high-water marks. |
| **Subgrid speed mode** | 4 m or 8 m solver cells carrying 1 m storage and conveyance tables; opt-in. |
| **Tier** | the quality of the drainage (or terrain) data: 1 real, 2+ real inlets with synthetic pipes, 2 synthetic, 3 lumped. |
| **Variant** | a batch job with one input changed, for sensitivity. |
| **`+dirty`** | the run's code differed from its commit in a file that can change a result. |
