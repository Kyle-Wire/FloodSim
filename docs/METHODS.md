# FloodSim — Technical Reference: Methods, Verification and Limitations

This document is for an engineer at an agency or consultancy who has to decide whether to accept results produced
with FloodSim. It states what the model is for, the equations and numerics as implemented, where each input comes
from and how good it is, what the outputs mean, what has been verified and validated, which checks to read on a
submitted run, and the limitations and assumptions behind every result.

- **Scope.** The code in this repository at the time of writing (branch `main`, November 2026; written at commit
  `08a4162` and updated for the fixes that followed it).
  Where this document and the code disagree, the code governs; file paths are given so that each statement can be
  checked.
- **Sources.** `README.md`, `benchmarks/ea/README.md`, `benchmarks/gatec/README.md`, and the source files named in each
  section. Numbers in the verification sections are copied from those READMEs and from the result files under
  `benchmarks/` and `tests/`; they are not re-derived here.
- **Conventions.** SI units unless stated. Elevations are NAVD88 (the 3DEP datum). Grids are row-major with row 0 =
  north. "Unverified" marks a statement that could not be confirmed from the code or the READMEs.

---

## 1. Purpose and intended use

### 1.1 What FloodSim is

FloodSim is a browser-native two-dimensional (2D) shallow water flood model. The solver runs on the GPU through
WebGPU (`src/kernels.wgsl.js`, hosted by `src/solver-gpu.js`); an fp64 CPU implementation of the same scheme
(`src/solver-cpu.js`) is the reference the GPU kernels are verified against. For a user-drawn area anywhere in the
United States, the application builds a model from national open data. That data is 3DEP lidar terrain, OpenStreetMap
buildings and streets, NLCD land cover, SSURGO soils, NOAA rainfall, USGS gauges and NOAA tide gauges, plus utility
GIS where it is published. The model runs at 1 m by default, coupled to EPA SWMM 5.2.4 (compiled to WebAssembly) for
storm sewers and 1D rivers. Results are reported as 1 m grids, report sections and exports.

### 1.2 Intended uses

FloodSim is built for planning-level work in which the comparison between runs and the spatial pattern of flooding
matter more than an absolute regulatory number:

- **Urban pluvial (rain-on-grid) flood mapping** at the block-to-neighbourhood scale: peak depth, water surface, speed,
  hazard class, arrival and duration, for Atlas 14 design storms and replayed historic storms (gauge or MRMS radar
  rainfall).
- **Compound flooding screening** at tidal sites: design rainfall combined with a design tide, surge and sea-level rise
  scenario, and the joint rain–surge probability (`src/compound.js`).
- **Design comparisons**: existing conditions against proposed site designs (buildings, grading, ponds, green
  infrastructure, barriers) under an identical forcing fingerprint (`src/compare.js`). This covers off-site impact,
  detention checks (post ≤ pre peak at control lines) and floodplain fill.
- **Screening** of drainage capacity (HGL, surcharge, gutter spread), building exposure and damage, expected annual
  damage (EAD) and benefit–cost ratio (BCR) for alternatives analysis.
- **Handoff to an industry model**: the HEC-RAS 2D input package (`src/hecras.js`) and the SWMM `.inp` let a reviewer
  rebuild the case in HEC-RAS or PCSWMM/SWMM5.

### 1.3 Uses for which FloodSim results should not be relied on without a calibrated industry-standard model

FloodSim results should not be used, on their own, for any of the following:

1. **FEMA regulatory floodplain mapping** (FIRM/FIS revisions, LOMR/CLOMR submittals, floodway determinations). FloodSim
   makes no claim of FEMA model acceptance. It reads the NFHL for context (`src/fema.js`) but does not reproduce the
   regulatory hydrology or hydraulics. The README itself says to check the effective FIRM and any LOMR before relying on
   FEMA data.
2. **Final design of hydraulic structures**: culverts, bridges, storm-sewer trunk sizing, pump stations, detention
   outlet structures, levees and flood walls. Synthesized pipes, generic inlet coefficients, the broad-crested weir
   barrier model and the absence of bridge hydraulics (§7) make it a sizing-check and alternatives tool, not a design
   tool.
3. **Life-safety decisions** (evacuation, warning thresholds, road closures) based on the **emulator** (`src/emulator.js`)
   or the **radar nowcast** (`src/nowcast.js`) alone. Both are labelled screening-only in the code and README. The
   emulator is a statistical surrogate valid only inside its trained parameter box for one scenario and one model build.
   The nowcast is Lagrangian persistence; its ensemble perturbs motion and intensity with assumed, not fitted, spreads;
   past 90 min it is one HRRR run, shared by every member.
4. **Regulatory sewer-system compliance** (CSO long-term control plans, consent decrees). Combined-sewer regulators,
   population and dry-weather flow are generic planning defaults, not the utility's structures or census data (§3.8),
   and the model is single-event (no continuous simulation).
5. **Absolute damage figures for funding applications** (e.g. FEMA BCA). FloodSim's damage and EAD use NSI structures and
   USACE generic curves with known sensitivities (§3.10, §7.9). They are suitable for ranking alternatives, not as a
   substitute for a BCA Toolkit analysis.
6. **Sediment transport, debris flow, scour and bank collapse outputs** as design values. These modules are verified
   against analytic cases and internal consistency only (§5.1). The README labels scour and collapsible soils as
   potentials and screening flags.

### 1.4 What a reviewer should require before accepting a result

At minimum: the run's `summary.json` with its forcing fingerprint and commit (§8), a clean model-checks table (§6.1),
a sensitivity study including the one-cell-coarser grid variant (§6.3), and, for any result used as an absolute level,
comparison against observations (high-water marks, gauges) through the validation scorecard (§6.2).

---

## 2. Governing equations and numerics

### 2.1 Equations

The solver integrates the conservative 2D shallow water equations on a uniform Cartesian grid of square cells
(README "Numerics"; `src/solver-cpu.js` header):

```
∂h/∂t  + ∂(hu)/∂x + ∂(hv)/∂y                          = r − f − e
∂(hu)/∂t + ∂(hu² + ½gh²)/∂x + ∂(huv)/∂y = −gh ∂z/∂x − g n² u |u| / h^(1/3)
∂(hv)/∂t + ∂(huv)/∂x + ∂(hv² + ½gh²)/∂y = −gh ∂z/∂y − g n² v |u| / h^(1/3)
```

with h the depth, (u, v) the depth-averaged velocity, z the bed, n Manning's coefficient, g = 9.81 m/s², r the rain
rate (times a per-cell multiplier), f infiltration and e the exchange with sub-models (inlets, culverts, rivers, pond
outlets). There is no turbulence (eddy viscosity) term and no wind or Coriolis forcing.

### 2.2 Spatial discretisation (standard mode)

`src/solver-cpu.js` `_recon`, `_face`, `hllc`; `src/kernels.wgsl.js` `recon`, `face`, `hllc`:

- **Finite volume, cell-centred**, structured grid with 2 ghost layers on each side.
- **MUSCL reconstruction** of h, η = h + z, u and v, with the minmod limiter by default (van Leer optional). The
  reconstruction drops to first order where the cell, or either stencil neighbour, is shallower than `hfront` = 1 mm.
  Wall (building) neighbours are excluded from the slope.
- **Hydrostatic reconstruction** (Audusse et al. 2004) at every face: z* = max(z_L, z_R), h*_L,R = max(0, η_L,R − z*),
  with the pressure correction ½g(h² − h*²) on each side. This makes the scheme well-balanced (lake at rest) and
  positivity-preserving at wet/dry fronts.
- **HLLC approximate Riemann solver** (Toro 2001) in the face-normal frame, with dry-bed wave-speed estimates
  (S_L = u_R − 2c_R when the left state is dry, and so on). The tangential momentum is upwinded by the contact wave.
- **Bed slope term**: centred, −½g(h_W + h_E)(z_E − z_W)/Δx using the reconstructed face values. Together with the
  hydrostatic correction this balances still water exactly.
- **Buildings** are mask cells (`mask = 0`) treated as reflective walls: the face state is mirrored with the normal
  velocity reversed.
- **Flood-barrier faces** (`src/barriers.js`): a face whose crest lies above both beds is computed as a broad-crested
  weir, q = C·H₁^1.5 with Villemonte submergence (1 − (H₂/H₁)^1.5)^0.385, instead of a Riemann flux. The rate is capped
  so that one stage cannot more than half-close the level difference (`weir()` in both solvers).

### 2.3 Time integration and time step

- **SSP-RK2 (Heun)** two-stage scheme. A first-order (forward Euler) option exists (`secondOrder: false`).
- **CFL** on the sum of the directional wave speeds: Δt = CFL · Δx / max(|u| + |v| + 2√(gh)), with CFL = 0.48 for
  second order and 0.9 for first order (2D positivity bound), and 0.5 in the subgrid mode (`src/solver-gpu.js` line 41).
  While the whole domain is dry the step is `dtDry` = 1 s.
- The time step is computed on the GPU (a workgroup max and a global atomic max of the wave speed) so that many steps
  run per submission without readback. GPU batches are sized from the mean step length of the previous batch.
- **Step cutting for repeatability.** Steps are cut only at multiples of 10 s of simulated time and at the storm's own
  block changes, never at wall-clock times (README "Repeatable runs"). The solver never lets a step straddle a
  hyetograph block change, so delivered rain matches the hyetograph exactly (README: 100-yr 1-hr at Eastwick, 73.0000 mm
  delivered vs 73 mm Atlas 14).
- **Order of operations per step** (README "GPU layout"): `dtReduce`, `dtFinal`; then for each RK stage `prim` →
  `faceX` → `faceY` → `theta` → `update`; then `sources` (friction, rain, infiltration, GI, peak depth), the hazard
  kernel and the inlet exchange.

### 2.4 Wetting and drying

- A cell is dry below `hdry`. The GPU default is **1e-5 m** (`src/solver-gpu.js` line 42) and the CPU reference
  default is **1e-6 m** (`src/solver-cpu.js` line 55). Velocities are set to zero in dry cells.
- **Draining-time flux limiter** (`theta` kernel; `_L` in the CPU solver). Each face flux is scaled by its donor
  cell's θ = min(1, cell volume / volume the cell would export this stage). A cell therefore never exports more water
  than it holds, which gives positivity with exact mass. Any negative depth left by round-off is clipped and the
  clipped volume booked (`A.w`, `vol.clipped`). It is zero in the verification cases (README "Verification").
- Thin films (any h > 0) still carry HLLC flux. Water thinner than 5 cm is excluded from the velocity used in hazard,
  force and peak-speed products (`HZ_VCUT`, `src/hazard.js` `VCUT`), because wetting fronts on steep curbs show
  spurious 4–6 m/s velocities.

### 2.5 Friction

Semi-implicit, point-wise Manning friction applied once per time step after the RK update, in the `sources` kernel
(`src/kernels.wgsl.js` `sourcesAt`; `src/solver-cpu.js` `_sources`):

```
(hu, hv) ← (hu, hv) / (1 + Δt · g n² |u| / h^(4/3))
```

This is operator splitting: friction is not inside the RK stages. The implicit form is unconditionally stable for
shallow, rough flow. Manning's n is constant in time per cell and does not vary with depth (§3.3).

### 2.6 Source terms

- **Rain**: a uniform rate times a per-cell multiplier (`RF`), which carries roof routing (roof rain moved to the open
  cells around each building), cistern and green-roof retention, and, for MRMS radar storms, the cell's depth over the
  area mean in each 2-minute block (README "Radar rainfall"). Rain on building (wall) cells is moved to the bordering
  open cells (the connected fraction), or piped to the sewer where downspouts are connected (`src/terrain.js`
  `roofRouting`, `roofConnections`).
- **Infiltration**: a constant capacity per cell, or Green-Ampt (the default; §3.4), on the cell's pervious share.
  Green-Ampt capacity is K·(1 + ψΔθ/F), and is zero once the soil column to the water table or bedrock is full.
- **Green infrastructure stores** (`src/gi.js`, `src/stormwater.js`): an extra infiltration path into a store of fixed
  capacity that drains linearly to the native soil (and optionally through an underdrain).
- **Exchange cells**: drainage inlets, culvert ends, river link cells, pond outlets and river inflow entries
  (negative rates). Each takes at most the water the cell holds, and is booked with a compensated sum.

### 2.7 Boundary conditions

`src/solver-cpu.js` `_fillGhost`; `src/kernels.wgsl.js` `primAt`, `outVel`; README "Boundaries":

| Type | Implementation | Used for |
|---|---|---|
| `wall` | Ghost mirrors the edge cell with normal velocity reversed | Closed edges, a river's closed inflow edge |
| `open` | Ghost copies the edge cell (transmissive) | Test cases |
| `outflow` (free outfall) | Ghost velocity = Manning velocity on the water-surface slope toward the edge, minus a threshold slope of 1e-4, capped at critical √(gh); zero if the surface is level or slopes inward, or if the inner neighbour is dry | **Default for every real-terrain model edge** |
| `stage` (water level) | Ghost surface held at the observed or design level (tide/surge); velocity zero-gradient | Open-water edge cells touching a CO-OPS gauge boundary (`tidalEdgeCells`, `src/waterlevels.js`) |
| River outlet (`stage`) | The same water-level ghost, at a downstream USGS gauge's recorded water surface carried up the river to the edge by a backwater calculation at its recorded discharge (§3.7) | The edge cells where a river leaves, on the side facing the gauge, when a downstream gauge is set and there is no tide (historic storms) |
| Fixed downstream level (`stage`) | The same water-level ghost, held at one entered level (m NAVD88) all storm; a free outfall where the ground is above it | Open-water edge cells on the chosen side, widened over ground below the level, when a level is entered with no downstream gauge and no tide (any storm) |
| Polygon sink | Cells outside a drawn polygon are sinks that take no rain; water entering them leaves the model and is booked as outflow (a free overfall at the polygon edge) | Polygon areas |

- Where a river enters across the edge, the edge is closed across the channel plus 10 m each side. The channel is the
  run of edge cells within 1.5 m of the lowest lidar water surface near the entry. The inflow is added two rows inside
  through the exchange cells. This is not a momentum-carrying boundary.
- The README records two rejected designs: zero-gradient edges imported about 3,000 m³ and built a 6.8 m mound on the
  first Philadelphia run, and zero-gradient-with-reflection let still water drain from round-off.

### 2.8 Floating-point precision

The GPU solver runs in **fp32**. The README and the kernels describe the measures that keep fp32 round-off from
accumulating:

- Bed elevations are stored relative to the domain minimum, for fp32 headroom.
- **Kahan residual on depth.** Each cell's depth carries a compensation term in the spare fourth component of the
  state vector. Every depth update (both RK stages, rain, infiltration, exchange) is one compensated add (`kadd`).
  Volumes are booked as depth minus residual. This was added after Gate B showed −1.2e-4 (EA Test 4) and 4e-4 (EA
  Test 7) mass drift at heavy-exchange cells (`benchmarks/gatec/README.md`).
- Per-cell running totals of infiltration, outflow and clipping are folded into **fp64** books on every read and then
  restarted. Copy, fold and restart happen in one GPU submission, so a save during a run cannot lose or double-count
  steps.
- Boundary outflow is booked per edge face with a Kahan residual (`edgeOut`), as are the inlet, control-line and
  barrier books.
- GPU against CPU agreement is in §5.1 (e.g. rain case max |Δh| 5e-6 m; lake at rest max |u| 9e-6 m/s with the bed at
  100 m).

### 2.9 Active tiles

The grid is cut into 8×8 tiles. Each step marks tiles holding any water, plus tiles holding inlets or stage cells.
Fluxes run on wet tiles grown by two tiles and updates on wet tiles grown by one, through indirect dispatch. Water moves
less than one cell per RK stage and everything is active while it rains, so the result is **bit-identical** to the
untiled solver (tested, §5.1). This needs 9 storage buffers per shader stage; below that the solver runs untiled.
A tile list goes out as rows of at most 32,768 workgroups, because WebGPU allows 65,535 per dimension and the browser
drops a larger indirect dispatch whole. Before this was fixed, a grid of more than about 4.2 million solver cells (65,535
tiles) froze once rain made every tile active. The faces, the update and the sources stopped, while the time step, the
edge books and the inlet exchange ran on. The first Manayunk run (§5.8) hit this: its river entries piled up 9.9 km deep
and its books went 68 % out. The GPU suite now runs a 2,112 × 2,112 grid in rain, with 70,225 active tiles, against
the untiled solver, and a run logs an error as soon as its books are 1 % out.

### 2.10 Local time stepping (LTS, opt-in, off by default)

README "Local time stepping"; `src/solver-cpu.js` `_cycle` / `_record`:

- Each 8×8 tile steps at a power-of-two multiple 2^m of a base step δ, with m ≤ L (default L = 3, so up to 8δ). The
  cycle length is the global CFL step × 2^L × 0.9 (`LTS_SAFE`), capped at the time left in the frame.
- A tile's level is the largest m whose step stays within 0.9 of the CFL limit over the fastest speed in the tile and
  its eight neighbours. Levels are then smoothed so that face neighbours differ by at most one level.
- **Mass is exact.** A cell one level coarser than a stepping neighbour stays frozen and gathers the flux it is sent
  (RK-weighted), which joins the start state of its own next step.
- **Turned off** (with the reason in `solver.ltsOff`) in the subgrid mode, with sediment or debris, and when running
  untiled.
- Accuracy against global stepping is in the README table: e.g. GPU = CPU LTS to 3e-7 m on dam breaks; moving fronts
  arrive slightly differently timed, up to 9 mm on the spilling edge of the test floodplain (mean 1e-5 m). LTS pays only
  on large grids: 2.6× faster at 1024×768, but 0.6× (slower) at 256×192.
- **On a real coupled storm** (Forest Hills, Queens, the DEP Moderate design storm, §5.10; each run alone on the GPU):
  6.4× fewer global steps (20,122 against 128,994) and 1.6× faster overall (1,088 s against 1,733 s). The rest of the
  time is SWMM, the 2-second exchange and the outputs, which LTS does not shorten. The results match: 376,395 wet cells
  against 376,622 (CSI 0.999), depth differences RMS 0.9 mm and at most 8 cm.

### 2.11 Subgrid speed mode (opt-in; 1 m remains the default and the reference)

`src/subgrid.js`, `sg*` kernels; README "Subgrid speed mode":

- The solver runs on 4 m (or 8 m "screening") cells. Each cell keeps a table of water level → stored volume built from
  the 1 m lidar inside it, and each face a table of level → flow depth H and conveyance K built from the 1 m pixels
  between the two cell centres. Curbs block a face strip until water tops them. Buildings act as porosity: a cell is a
  wall only when it is entirely building. The approach follows SFINCS (Leijnse et al. 2021; van Ormondt et al. 2025).
- The scheme is **local inertial**, not full SWE: q ← (q − gHΔt·∂η/∂x) / (1 + gΔt|q|H/K²), with |q| capped at critical
  flow and no flow out of a dry cell. The state is volume, so mass is exact.
- Output depth at each 1 m pixel = cell water level − 1 m ground. Hazard, force, duration and arrival are taken at the
  cell's deepest point (conservative).
- No baseflow warm-up and no sediment in this mode; LTS is off.
- Accuracy against the 1 m run is in §5.5. The method cannot represent spaces enclosed inside a cell, such as courtyards
  in rowhouse blocks, which a 4 m cell connects to the street.

### 2.12 Coarse solver grids (2–4 m) and downscaling to 1 m

`src/terrain.js` `coarsen`; `src/downscale.js`; `app/map.js` `finishRecord`, `toFine`:

- **Coarsening** (standard mode at F = 2 or 4): a solver cell is a wall if more than half of its 1 m pixels are
  building. Its bed is the mean open-ground elevation, and n and infiltration are open-area means. Roof routing is
  recomputed on the coarse mask.
- **Downscaling** (water-surface projection, as in LISFLOOD-FP / FwDET post-processing): the water surface elevation
  (WSE = z + h) of wet solver cells (h > 5 mm) is bilinearly interpolated using **wet neighbours only**. Fine depth is
  max(0, WSE − z_fine), and building pixels are 0. A fine pixel whose bilinear stencil is all dry takes the mean WSE of
  any wet cell in the surrounding 3×3, so a low spot at the edge of a wet cell still fills. This is exact for still
  water and approximate on sloping surfaces. **It cannot create flow paths the coarse grid did not resolve.**
- **Peak never below final.** The peak and final grids are downscaled independently, so a neighbour that was wet only
  at its peak could pull a 1 m low spot's peak below its final depth. After downscaling, `max_depth` is therefore
  forced to be ≥ `final_depth` cell by cell (`app/map.js` line 1894). The README records the bug this fixed (a gutter at
  4 cm peak and 11 cm final, and a $2.2 M building's damage depending on which neighbour had a film).
- The peak grid is the per-cell maximum over time, downscaled. The resulting "peak water surface" is not a single
  instant's surface; this is the usual convention, but a reviewer should not read it as one.
- At 1 m (F = 1) no downscaling is applied: the solver grid is the output grid.

### 2.13 Mass-balance bookkeeping

- **Surface books** (`massBalance` in the CPU solver; fp64 books on the GPU): error = stored − (initial + rain + net
  inflow − infiltration − edge outflow − net exchange). It is reported relative to all water that came in (initial +
  rain + net inflow through the edge or exchange cells), as HEC-RAS reports volume error against starting plus inflow
  volume.
- **Combined books** (`benchmarks/gatec/mass-audit.js`):

  ```
  rain on the surface + roof rain piped to the sewer
    = infiltration (incl. GI stores) + surface edge outflow (incl. polygon edges) + pipe outfalls
      + surface storage (incl. water inside culverts) + network storage (incl. tanks) + overflow lost at lid-only manholes
  ```

  Water sent back up an inlet is counted as SWMM external outflow and subtracted (coupler `totals.latOut`). The
  combined books count the water on the ground at the start (gauge start levels).
- **Exchange conservation.** Every coupled model (SWMM network, culverts, river, pond outlets) is given exactly the
  volume the surface gave up over the interval. The combined residual is therefore SWMM's own routing continuity
  (`benchmarks/gatec/README.md`).
- Gate C criteria: surface |error| ≤ 1e-5 of throughput; SWMM continuity ≤ 0.5 %; combined ≤ 0.5 % of rain + piped roof
  rain. Results are in §5.4.

### 2.14 1D–2D coupling

`src/coupler.js`, `src/drainage.js`, `src/swmm.js`, `src/river.js`, `src/links.js`:

- **SWMM 5.2.4** (dynamic wave, Preissmann slot surcharge, conduit lengthening) is stepped in lockstep with the surface
  solver, exchanging every **2 s**. EXTRAN surcharge gave −4.6 to −6 % continuity on the surcharged South Street network
  against −0.35 % with SLOT (README "Coupling design"). The SWMM options (`ROUTING_DEFAULTS`: routing step 1 s,
  variable step 0.75, lengthening on, MIN_SURFAREA 1.2 m², head tolerance 0.0015 m, 8 trials, MIN_SLOPE 0, SLOT, partial
  inertial damping, normal flow limited by slope or Froude) are set per run under **Drainage → Pipe solver settings**,
  with three presets (Balanced = the defaults; More accurate: 0.5 s, 0.5, 0.0005 m, 20 trials; Faster: 2 s, 0.005 m,
  4 trials). The routing step is capped at the 2 s exchange interval. Non-default values go into the forcing record
  (`drainSettings.routing`). On a test line of manholes all three presets and EXTRAN keep SWMM continuity within 0.03 %
  (`tests/run-cso-tests.mjs`); on a real network the choice of preset has not yet been scored.
- **Inlet hydraulics** (`inletFlow`): with the node head below the street, inflow is min(weir, orifice) with weir
  C_w·P·h^1.5·√(2g) and orifice C_o·A·√(2gh). With the node above the street it is a submerged orifice on the head
  difference. Defaults (`DESIGN_DEFAULTS`): grate opening 0.2 m², weir length 2.0 m, C_w 0.5, C_o 0.6, and an optional
  clogging share (at most 95 %). An inlet can have a crest above its cell's bed (a gully lip, a kerb inlet): it takes water only
  above the crest, on the head over it, and in two-way exchange water leaves over the crest. Grates merged on one cell
  take the lowest crest. **Drainage → Inlet hydraulics** sets the grate area, weir length, C<sub>w</sub>, C<sub>o</sub>
  and an area-wide crest (default 0), directly or from a kind of inlet (typical grate; HEC-22 grate, C<sub>w</sub> 0.37,
  C<sub>o</sub> 0.67; small grate; double grate; curb opening, C<sub>w</sub> 0.28 from HEC-22's 1.25 SI). An inlet drawn in the Infrastructure layer can set its own crest. Non-default
  values go into the run's forcing record (`drainSettings.inlets`). Inlets from utility GIS take the area-wide crest.
- **Kinds of inlet by type** (`src/inlettypes.js`). A linked or utility inlet layer's type field (detected by name:
  `STRUCT_TYPE`, `STRUCTURE_TYPE`, `INLET_TYPE`, …, then `TYPE`) is kept on each inlet record. `classifyInlet` maps a
  type code to a class (catch basin, double, drop inlet, curb opening, elongated throat, slab-top with 1–4 open sides).
  A standard gives each class a kind: NCDOT (picked by default when the area's centre is inside a rough outline of
  North Carolina) or generic HEC-22 kinds; the user can pick a kind per type. Each grate then carries its own
  {A, P, C_w, C_o} through the network builders to its exchange point. Grates merged on one solver cell become one
  equivalent grate (`inletOptions`): A and P averaged over the grates by open share, C_w weighted by P and C_o by A, so
  the weir and orifice terms are the sums of the grates' own. The NCDOT open areas are the clear openings in the
  Drainage Box Depths table (840.03 catch basin 3.1 ft²; 840.16 drop inlet 3.7 ft² and 8.6 ft weir; open-throat
  catch basins 1.8–2.5 ft² for a 6" throat, 2.3–3.3 ft² for 8"); weir lengths not in the table, and every slab-top
  value, are estimates and say so in the app. Without any kind (no types, no standard, no picks) the network and
  results are exactly as before, and the forcing record has no `inletTypes` part. With kinds, `drainSettings.inletTypes`
  records the kind of each type, and a settings test lists the types whose kind changed. Before this change the
  synthetic (street-following) network dropped each real grate's open share and crest on the way to the exchange
  points; it now keeps them. On Charlotte's three storms the NCDOT kinds move the gauge under 1 cm and take up to 3 %
  more street water into the pipes (settings test, §6.4).
- **Two-way exchange (app default).** Inlet manholes are pressurised and water returns to the street through the inlet
  orifice on the head difference, as HEC-RAS does. The return is capped per manhole by what its pipes deliver (SWMM node
  inflow less any positive lateral inflow; SWMM books a negative lateral flow as outflow, so the return itself is not
  in the inflow and must not be subtracted), so SWMM is never asked for water a node does not hold. The older mode (inlets take water in only, node overflow returned to
  the street over the next interval) remains selectable.
- **Culverts** (`src/channels.js`, `src/links.js`): links between surface cells with inlet control when part full,
  barrel losses when submerged and reverse flow when the tailwater is higher. A culvert delivers downstream exactly what
  it took upstream, one 2 s interval later.
- **1D rivers** (`src/river.js`): from surveyed cross-sections, in SWMM, linked to the surface through
  Villemonte-drowned broad-crested weirs along bank crests, openings and culverts. Verified on EA Test 7.
- Several exchange models share the exchange cells through `LinkHub`.

### 2.15 Optional physics (off by default unless noted)

These modules are present and have verification tests (§5.1). They have no field validation documented in the
repository:

- **Sediment transport** (`src/sediment.js`): 4 grain classes, Exner bed update and Hirano active layer. Bedload by
  Wilcock & Crowe (2003), entrainment by excess shear (Hanson & Simon 2001), settling by Ferguson & Church. Standard
  solver only, needs 10 storage buffers.
- **Debris flows**: mixture flow toward the Egashira et al. (1997) equilibrium, O'Brien & Julien (1988) quadratic
  rheology, and infinite-slope shallow landslides.
- **Bank collapse probability** (`src/banks.js`, **on by default**): Culmann planar wedge through the toe and the
  probability of failure during the run given that the bank stood at the start. Its README limits: no bathymetry at the
  toe, no tension cracks or matric suction, one planar mode.
- **Scour potential** (`src/scour.js`): indicative scour depth from excess shear; no supply limit, no deposition, and
  the ground does not change.
- **Collapsible and expansive soils**: screening flags for geotechnical follow-up, not predictions.

---

## 3. Data sources and model build

### 3.1 Grid and coordinate reference

- The model grid is UTM on the WGS84 ellipsoid (EPSG 326xx; `src/geo.js` `utmEPSG`), at 1 m. The DEM, NLCD and other
  rasters are requested in that CRS. WGS84 ↔ UTM uses the Snyder (1987) series.
- Run-folder `.prj` files declare WGS84 / UTM (`app/map.js` `utmPRJ`). The HEC-RAS package declares NAD83 / UTM
  (EPSG 269xx; `src/hecras.js`). Its README notes that FloodSim computes UTM on WGS84 from 3DEP's NAD83 lon/lat and
  that the two agree to about a metre. Treat horizontal positions as good to about 1 m on top of the source data's own
  accuracy.
- Vertical datum: NAVD88 throughout. NGVD29 inputs (gauge datums, FEMA BFEs, HEC-RAS sections) are shifted with NOAA
  NCAT/VERTCON at the site.

### 3.2 Summary of data sources

| Input | Source | How it is used | Accuracy and caveats |
|---|---|---|---|
| Terrain | USGS 3DEP bare-earth DEM, dynamic mosaic, requested at 1 m (`src/ingest.js`) | Bed elevation | The native source resolution is checked against the 3DEP catalog and labelled (1 m lidar = tier 1). Lidar is **hydro-flattened**: open water is a flat surface at the flight-day level and the channel below it is missing (§3.4). Bare earth keeps road embankments over streams (§3.5). |
| Buildings | OSM footprints via Overpass (three mirrors) | Wall cells at 1 m; roof rain routed to bordering open cells | OSM completeness varies by city (Phase 1 known limits). Heights are from OSM tags where present. |
| Streets | OSM drivable highways, width by class | n = 0.016, zero infiltration; optional 15 cm curb burn | Curb burn is automatic only where the DEM source is coarser than 1 m. Widths are by class, not surveyed. |
| Land cover | NLCD via MRLC WMS: 2021 (CONUS), 2016 (AK), 2001 (HI, PR) | Manning's n and impervious fraction by class (`src/terrain.js`) | 30 m classification sampled to 1 m by colour matching. Elsewhere urban defaults apply. |
| Soils | SSURGO via Soil Data Access (`src/soil.js`) | Green-Ampt K, ψ, porosity, water table and bedrock depth per map unit; or constant rate by hydrologic group | "Urban land" components have no data, so the group's or compacted fill's parameters stand in. Dual groups use the undrained letter. |
| Design rainfall | NOAA Atlas 14 PFDS at the domain centre (`src/storm.js`) | Alternating-block hyetograph, uniform in space | No areal reduction factor. Western WA/OR have no Atlas 14 and use a site-record GEV fit (labelled). |
| Historic rainfall | IEM Reanalysis (gridded, 1995 on), ASOS 1-minute gauges, NOAA HURDAT2 for naming (`src/history.js`) | Replayed hyetograph, uniform in space | Gridded record is coarse; nearest ASOS can differ greatly from the site (Isaias: PHL 106 mm against the site's 150 mm). |
| Radar rainfall | NOAA MRMS via the IEM archive: gauge-corrected QPE (2015 on), MultiSensor Pass 2 (Oct 2020 on), radar-only otherwise (`src/mrms.js`) | Rain varying cell by cell every 2 min | Radar-only reads high in hail or bright band and low far from radar. Timing within each hour is radar's. |
| Rain QA | IEM ASOS hourly and CoCoRaHS daily gauges within 25 km (`src/rainqa.js`) | Independent check of the rain used | CoCoRaHS reports are 24 h totals and cover more than the storm. |
| River inflow, gauged | USGS NWIS instantaneous flows and annual peaks (`src/inflow.js`) | Recorded hydrograph, or a design hydrograph (LP3, NRCS gamma shape) | Bulletin 17B moments with station skew; 17C EMA and regional skew are not applied, so these are planning numbers. |
| River inflow, ungauged | USGS StreamStats / NSS regression peaks (`src/streamstats.js`) | Peak with 90 % interval, NRCS dimensionless unit hydrograph | Regression equations are rural; average standard errors of 30–40 % are usual. Lag equation fitted to basins up to about 2,000 acres. |
| Starting water levels | USGS gauges (`src/waterlevels.js`) | River rise, lake fill, tidal start level, spreading onto connected ground | Ungauged water stays at the lidar surface. Gauge datums must be surveyed to within 0.5 ft. |
| Channel bed | Regional bankfull curves (Bieger et al. 2015), NOAA BlueTopo surveys, HEC-RAS `.g01` sections (`src/bathymetry.js`, `src/topobathy.js`, `src/hecras.js`) | Carved below the flattened water | Off by default. Curves are fitted to non-tidal alluvial streams. BlueTopo covers mostly navigable/tidal water. |
| Tides | NOAA CO-OPS gauges within 60 km: observed levels, datums, extreme water levels, 2022 Interagency SLR scenarios (`src/history.js`, `src/compound.js`) | Water-level boundary on tidal edge cells; SWMM outfall stage | NAVD88 where CO-OPS publishes it, else MSL (flagged). The gauge may not sit at the model's tidal edge. |
| Joint rain–surge | ACIS daily gauge (40+ years) and CO-OPS daily highs (`src/compound.js`) | Gumbel copula design pairs | Daily-event dependence stands in for annual-maximum dependence. |
| Drainage, real | Registered utility GIS (Philadelphia Water inlets, outfalls, combined-sewer area; `src/utilities.js`); user-linked ArcGIS/GeoJSON pipes (`src/linked.js`, `src/network-real.js`); drawn or imported infrastructure (`src/infra.js`) | Tier 1 (real pipes) or tier 2+ (real inlets, synthetic pipes) SWMM network | PWD does not publish mains: pipes in Philadelphia stay synthetic unless linked. |
| Drainage, synthetic | Street-following network sized by the rational method (`src/drainage.js`) | Tier 2 SWMM network | An estimate of a plausible network, not the real one. |
| FEMA | NFHL: S_FLD_HAZ_AR, S_BFE, S_XS (`src/fema.js`) | Zones and BFE on the map, design floor checks, floodplain fill level, report | Check the effective FIRM and any LOMR (README). |
| Structures | USACE National Structure Inventory (`src/damage.js`) | Occupancy, foundation height, values, population | NSI points are modelled inventories; foundation heights and values are estimates. |
| Damage curves | USACE depth–damage functions vendored from go-consequences: EGM 01-03 / 04-01 single-family, HEC-FIA others (`src/damage-curves.js`) | % damage at depth above first floor | Generic national curves. |
| Upstream area | 3DEP 5 m / 10 m DEM (`src/watershed.js`) | Watershed trace; "run on the watershed" | Surface drainage only; approximate in flat urban terrain. |
| Groundwater check | USGS Water Data API well levels | Shown beside the water-table setting; not an input | Wells may tap deeper aquifers. |

All requests go through the local proxy (`server/server.mjs`), which caches responses in `.cache/` (§8.7).

### 3.3 Terrain, buildings and streets

- **DEM.** The DEM is always fetched at 1 m in the local UTM zone. The solver runs at 1, 2 or 4 m (or the 4/8 m subgrid
  mode). Sub-1 m terrain is deliberately not synthesised ("DEM super-resolution is not reliable enough for
  hydraulics", README).
- **Buildings** (`buildFine` in `src/terrain.js`). OSM footprint pixels become walls: no water, reflective faces,
  impervious. At 2–4 m a solver cell is a wall when more than half of it is building (§2.12); in the subgrid mode
  buildings are porosity. Roof rain is routed to the open cells bordering each building blob (`roofRouting`), with a
  connected-fraction slider. In combined-sewer areas downspouts feed the nearest manhole directly (default 100 % where
  the utility marks combined sewers, 0 % elsewhere), and site-design buildings carry their own roof setting.
- **Streets.** OSM drivable roads are stroked at a width by class, with n = 0.016 and zero infiltration. The optional
  curb burn lowers street pixels by 15 cm. It is applied automatically only where the DEM source is coarser than 1 m,
  because 1 m lidar already resolves curbs.
- **Culverts and embankments** (`src/channels.js`). OSM waterways tagged `tunnel=culvert` become culvert links between
  their ends. Each end takes the lowest ground within 5 m of the mapped point on its own side, and the invert is the
  higher of the two: mapped culverts usually end at a road's edge or on the embankment slope. Before November 2026 the
  end cell itself set the invert, which put the Sheffield Dr culvert at the Charlotte gauge 1.9 m above the creek bed.
  A culvert mapped far from where it runs is beyond this: OSM ends the US-74 culvert below that gauge on the highway,
  300 m from its outlet in the city's pipe layer, so its invert is still 212 m over a 206.5 m bed and it passes
  nothing; draw such culverts with their real ends and inverts (drawn culverts keep theirs). Size comes from the
  `diameter`/`width` tags, else 1.2 m for a stream and 0.6 m for a ditch.
  Open mapped streams are first moved onto the 1 m thalweg (`snapThalweg`), because NHD-sourced lines often run along
  a bank 1–2 m above the bed. The snapped line is the least-cost 8-connected path through the open cells within 15 m of
  the mapped line, from the cross-section at its first cell to the one at its last. Each step costs its length ×
  (e^(h/0.25 m) + 0.1·d/15 m), where h is the height above the lowest ground in the corridor around the nearest mapped
  cell and d is the distance from that cell. A cell 1 m up the bank costs 55 times a bed cell, and the weak pull keeps
  the path by the mapped line where the bed is flat across. The breaching below then walks the snapped path. From each
  low point it finds the next point at or below it, and grades the hump between to a straight line, 3 m wide (a 1 m
  trench would be half lost when the 1 m ground is averaged to 2 m solver cells). Two kinds of hump are cut:
  - a road embankment (some cell is road, ≤ 30 m long, ≤ 4 m high) where a stream crosses a road with no mapped
    culvert;
  - a fill: no road, ≤ 40 m long, with a crest 0.5–2 m above its upstream foot. The crest is the lowest level at which
    water gets past within 15 m, so the hump spans the whole valley floor. It must also not be the top of a ridge the
    walk has climbed onto: no ground more than 0.5 m below the foot in the 40 m upstream. These are bridge decks the
    lidar kept, culverted driveways and lidar artefacts. Riffles (under 0.5 m), real ridges (higher or longer), and
    humps the water can get round lower down are left alone.
  
  Edwards Branch 250 m below the Charlotte gauge (way 47617228) is the case this was built for. A rise with no road
  spans the whole valley floor, and its NHD line runs beside it on the bank at about 210 m. Snapped, the line is a
  mean 2.1 m off the mapped one. The hump on it is a 210.19 m crest over a 208.66 m foot, 35 m long, so the 1.5 m and
  30 m limits first proposed would have missed it. The gauge falls below that crest after storms, so the creek passes
  it. Seven smaller bed humps on the same line are also cut (0.5–1.1 m, 8–22 m long). Three are between the gauge and
  the big hump, with crests of 209.24–209.41 m. The gauge reading of 209.19 m after the storm is below those crests too,
  so they are not what holds the creek up. Over the whole box (August 2023 storm, 2 m solver cells), 36 lines are
  snapped, a mean 5.0 m off their mapped lines. The run cuts 41 humps (median 0.85 m high, 13 m long; 1,624 m³), one of
  them a road embankment. The creek now drains after the peak. At the gauge 4 h in, the model reads 209.47 m (before:
  210.24 m; observed: 209.18 m), and it levels off at 209.42 m against 209.14 m. The peak is +0.05 m (before +0.11 m).
  The 0.2–0.3 m still left after the storm is not traced; one candidate is the 3 m cut being narrower than the bed.
  Before November 2026 breaching walked the mapped line's own cells and cut road embankments only, so this hump was
  never seen and held the modelled creek about 1 m above the gauge after the storm. A rule that breached humps with no
  road along the mapped line was tried and dropped. With the line on the bank, it cut five trenches along the bank and
  missed the hump.
- **Channel bathymetry** (off by default; `src/bathymetry.js`). The flattened water surface is grown from mapped river
  lines over cells flat to the millimetre. Drainage area comes from USGS NLDI or D8 accumulation. The bankfull width and
  depth come from Bieger et al. (2015) regional curves (nationwide or by physiographic division), carved as a parabolic
  section to 1.5 × mean bankfull depth below the bank tops (less the bank height above the water, at least 0.3 m).
  Where available, NOAA BlueTopo surveyed beds (`src/topobathy.js`) and HEC-RAS cross-sections (`src/hecras.js`,
  interpolated between sections as RAS Mapper does) take precedence. A survey or section above the lidar water surface
  carves nothing. README example: at Fairmount the curves carved the tidal Schuylkill to −1.1 m NAVD88 where BlueTopo
  has it surveyed to −8.2 m (median −2.8 m).
- **Starting water levels** (`src/waterlevels.js`). With *Gauge levels* (the default), river water rises in parallel by
  the gauge's level minus the lidar water surface at the gauge: the median of the 9 nearest water cells on the water
  body its reading is on, the highest flat surface at or below it (a gauge above a dam reads the pool, §5.8). Lakes fill flat
  to the reading, tidal water starts at the tide level, and water then spreads onto connected ground below its level.
  Each patch of ground takes the level of the water nearest it, and ground above that level stays dry and holds back
  water from further away. Before November 2026 ground above the nearest water could still take a higher level from
  further off: a mapped stream line up on a bank 1.4 m above Edwards Branch flooded 600 m of the valley below the
  Charlotte gauge to 210.5 m at the start (42,000 m³ that ran back past the gauge and held it 0.5 m high all storm).
  Each run files its starting water as `start_depth.asc` and the note in `summary.json` (`startWater`).
  Rules guard against bridge decks and 30 m land-cover pixels mapped as water. Ungauged water stays at the lidar
  surface.

### 3.4 Land cover → Manning's n and imperviousness

Manning's n by NLCD class (`src/terrain.js` `MANNING`; streets 0.016, `MANNING_ROAD`):

| NLCD | Class | n | | NLCD | Class | n |
|---|---|---|---|---|---|---|
| 11 | Open water | 0.035 | | 51/52 | Shrub | 0.070 |
| 21 | Developed, open space | 0.040 | | 71–74 | Herbaceous | 0.045 |
| 22 | Developed, low | 0.045 | | 81/82 | Pasture / crops | 0.040 |
| 23 | Developed, medium | 0.050 | | 90 | Woody wetland | 0.100 |
| 24 | Developed, high | 0.050 | | 95 | Herbaceous wetland | 0.070 |
| 31 | Barren | 0.030 | | — | Unknown | 0.045 |
| 41–43 | Forest | 0.120 | | — | OSM street | 0.016 |

Impervious fraction by class: 21 → 0.10, 22 → 0.35, 23 → 0.65, 24 → 0.90 (`IMPERVIOUS`, the midpoints of the NLCD
developed-class definitions). Water and wetland classes (11, 12, 90, 95) take no infiltration. These are editable
defaults and are recorded with each run. They are not calibrated to any site; the calibration multiplier (§6.3) scales
all n together.

### 3.5 Soils → infiltration

- **Constant rate** (*Constant rate by soil group*): A 10, B 5, C 2.5, D 1 mm/hr × (1 − impervious fraction); "Urban
  land" with no group 2 mm/hr; streets, buildings, water and wetlands 0 (`HSG_RATE`, `URBAN_FILL_RATE`).
- **Green-Ampt (the default)** (`src/soil.js`). For each SSURGO map unit, the largest major component with data
  supplies:
  - K = half the most restrictive saturated conductivity of horizons starting in the top 50 cm (Bouwer 1966);
  - porosity, and texture → wetting-front suction (Rawls, Brakensiek & Miller 1983);
  - depth to the seasonal high water table and to bedrock.

  Capacity is K·(1 + ψΔθ/F) on the cell's pervious share, with Δθ = effective porosity × (1 − Se). The initial wetness
  presets are Se = 0.15 / 0.40 / 0.70 / 0.95 (dry / normal / wet / saturated; `WETNESS`). For a historic storm the
  preset can come from the rain of the 5 days before it (*From the rain before the storm*, `src/antecedent.js`): the
  NRCS antecedent moisture condition (SCS NEH-4 ch. 4, table 4.2), AMC I below 0.5 in, III above 1.1 in in the dormant
  season (November–March), 1.4 and 2.1 in in the growing season (April–October, this app's reading for the lower 48),
  maps to dry / normal / wet. The 5-day rain is the median of the USGS rain gauges (NWIS 00045) within 8 km that
  reported through the 5 days, else the IEM Reanalysis hourly rain at the site. Once the soil holds
  Δθ × (depth to the water table or bedrock), infiltration stops (saturation excess). A typed water-table depth
  overrides the survey for every cell. Units without horizons fall back to their hydrologic group's texture, else
  compacted urban fill.
- Verified: ponded Green-Ampt matches the analytic solution to 0.3 %; GPU against CPU to 1e-7 (README).
- **Groundwater return (opt-in, off by default)** (`src/groundwater.js`; Calibrate: *Groundwater return*, *Groundwater
  lag*). A share of the water infiltrated goes into one store for the area, and the store empties into the mapped
  streams as a linear reservoir: rate = store / lag, so once the rain stops the return falls by a factor e every lag.
  It enters through exchange cells about every 25 m along the snapped stream paths (§3.3), so the books count it as
  inflow (`books.groundwater`, with what is left in the store as `books.groundwaterStore`). The rest of the infiltrated
  water stays in the ground for the run. Neither setting is measured: they are fitted to a stream gauge's recession
  after the storm (§6.4). Verified: the store, its emptying and its books (`tests/run-groundwater-tests.mjs`).
- Not represented: interception, depression storage other than what the terrain holds, evaporation, recovery of
  infiltration capacity between rain bursts, and lateral subsurface flow (other than the lumped groundwater return).

### 3.6 Rainfall

- **Design storms** (`src/storm.js`). Atlas 14 PFDS (partial-duration series, median and 90 % bounds) is fetched at the
  domain centre. Return periods run 1–1000 yr and durations 30 min–24 h; depths between Atlas 14 durations and return
  periods are log–log interpolated. The default pattern is the **alternating block method on 5-minute blocks**: every
  window of k blocks around the peak holds exactly the Atlas 14 depth for k·5 min (tested to 1e-13 mm). The peak can be
  centred, early (0.375) or late (0.75); "uniform" spreads the total evenly. There is an optional climate uplift factor
  on depths. **The storm is uniform over the domain** with no areal reduction factor. Because it nests every duration's
  T-year depth, an alternating-block storm is peakier than any observed storm. Atlas 14 temporal distributions and NRCS
  curves are listed in the README as planned, not available.
- **No Atlas 14** (western Washington and Oregon). A GEV fitted by L-moments (Hosking 1990) to the site's
  annual-maximum rainfall, shaped like the largest recorded storm with a real hourly record, labelled "site-record, no
  Atlas 14".
- **Historic storms** (`src/history.js`). The 12 wettest events in the IEM Reanalysis daily record (1995 on), named
  when a HURDAT2 track passed within 250 km. Options: IEM hourly gridded totals distributed within each hour by the
  nearest ASOS 1-minute gauge (method of fragments; the default), the gridded series alone, or the airport gauge alone.
  Each event is graded against Atlas 14.
- **MRMS radar** (`src/mrms.js`). Per-pixel hourly totals (gauge-corrected where the archive has them), timed within
  the hour by the 30 two-minute rate frames. Overflowed or missing frames are filled from raw 16-bit `PrecipRate` where
  available, else shaped by the area's mean pattern, and counted. Each solver cell takes its rain bilinearly from the
  0.01° pixels. The forcing record carries a hash of the frames. A second choice keeps the radar's own hourly totals
  (radar-only, not adjusted to gauges).
- **MRMS fitted to rain gauges** (`src/raingauge.js`, Rainfall "Radar fitted to USGS rain gauges"). The radar-only
  rain is fitted to the USGS tipping-bucket gauges (NWIS 00045, 5-minute) within 10 km of the area, for cities whose
  networks are denser than MRMS's correction can use. Each gauge's hourly rain is set against the radar at its pixel
  (bilinear). A gauge that reported in under 90 % of the hours the radar had rain there, or with under 5 mm in both, is
  left out. Log ratios ln((G + 1) / (R + 1)), capped at 3× either way, are spread by inverse distance 1 / (d² + d0²)
  with a neutral weight 1 / (10 km)² on no change. They are taken either hour by hour or on storm totals. Each
  candidate (hourly or storm; d0 = 1, 3 or 8 km; with or without a storm-wide radar bias taken out first, for storms
  the radar misses by a factor) predicts every gauge's hours from the other gauges, and the one with the
  smallest RMS error per gauge-hour is kept, but only if it beats the radar alone; otherwise the radar-only rain stands.
  The 2-minute frames and hourly totals take their hour's field. The run record keeps every gauge (totals, wettest
  hour, the leave-one-out prediction) and every candidate's score. With no gauges that reported, the gauge-corrected
  radar is used instead. `tests/run-raingauge-tests.mjs`.
- **Radar and nowcast** (Storm → *Radar & nowcast*; `src/nowcast.js`). A storm source of its own for rain that is
  coming in. **Screening only.**
  - *Observed:* MRMS over the area for the last 1, 3 or 6 h to the latest 2-minute frame (about 6 min old), as for a
    historic radar storm (gauge-corrected whole hours where the archive has them, then the part hour from the frames).
  - *Nowcast* (0–90 min): the storm's motion from the correlation of two 10-minute totals 20 min apart over a box 1.5°
    round the area (√rain, coarse to fine, sub-pixel); the last 10 minutes' mean rate is moved at that velocity
    (Lagrangian persistence). The frame for lead L is the rate moved for L + 1 + 5 min, the 5 being the age of the mean.
    The match's correlation r is shown; below 0.6 it is flagged as poor; with too little rain to match, the rain stays
    in place.
  - *Ensemble* (10, 20 or 40 members plus persistence): each member moves the same rain with speed × e^(0.2·z₁),
    direction + 15°·z₂ (turned in km, not in pixels) and intensity × e^(0.5·z₃·t), t in hours after the latest frame,
    the factor held within ¼–4×. z₁, z₂, z₃ are independent standard normals on a Latin hypercube (the quantiles at
    (i + ½)/n, shuffled by a fixed seed), so a small ensemble spans the spread evenly and a reload gives the same
    members. The spreads stand for typical nowcast errors in motion and for growth and decay that persistence cannot
    see; they are assumed, not fitted to the storm, so the band is a sensitivity band, not a probability.
  - *Over the area* (`incoming`, `ensembleSummary`): for each member, the area-mean rain per 2-minute block; arrival is
    the first block at ≥ 1 mm/hr after the latest frame ("raining now" when one of the last three observed blocks
    was); the depth and the peak over the lead. The panel gives the members' 10th, 50th and 90th percentiles (an
    arrival past the lead counts as later than every arrival), the share of members with rain in the lead, and draws
    the P10–P90 of the rate over the nowcast on the hyetograph. With the 1 mm/hr threshold on the area mean, a cell
    clipping one corner of a large area "arrives" later than it does at that corner.
  - *The rain a run uses:* persistence, or the members whose depth over the lead is nearest the P10, P50 and P90 (dry,
    middle and wet case). Batch lists the four as storms, so the flood band is the batch's runs side by side.
  - *Rolling live:* while a run of a live nowcast plays, every minute the page asks for newer 2-minute frames. They
    replace the nowcast blocks after the one under way (`rollForward`); the motion is matched again at the newest frame
    and the blocks after it are nowcast afresh for the run's member. Blocks the run has already rained stay as they were
    and are counted in the log and the run record. *Wait for the radar* holds the run's clock at the latest frame, so it
    uses observed rain throughout, about 6 minutes behind real time. A rolled run's frames hash changes, so it cannot be
    resumed from a checkpoint; batch jobs and replays never roll.
  - *Replay:* an issue time in the past rebuilds the nowcast as it would have been issued then (from the latest frame
    at or before it) from the IEM archive, and sums the frames that followed over the lead as a check against the band.
    The observed part uses what the archive holds now, so hours a live run would have had radar-only may be
    gauge-corrected. A saved project with a radar storm reopens as a replay of the same issue time.
  - *HRRR past 90 min* (`src/hrrr.js`; leads of 2 and 3 h). NOAA's High-Resolution Rapid Refresh, a 3 km numerical
    weather model run every hour, from the NOAA Open Data bucket on AWS (`noaa-hrrr-bdp-pds`, July 2014 on). Each
    forecast hour's rain is read from the sub-hourly file's four 15-minute APCP fields (HRRR v4, December 2020 on), or
    else the hourly file's APCP for that hour; one field is one byte-range request (~0.3 MB) found through the file's
    `.idx`. GRIB2 decoding: Lambert conformal grid (template 3.30: 1799 × 1059 points, true at 38.5° N, LoV 262.5°,
    sphere of radius 6 371 229 m) and complex packing with second-order spatial differencing (template 5.3; 5.0 and 5.2
    also read). Checked on a real run: the four 15-minute fields of Ida's 22z +2 h add up to the hourly field, packed on
    its own, within 0.006 mm at all 1.9 million points. Only the points round the area are kept, and they are sampled
    bilinearly at the 0.01° pixel centres (3 km to 1 km: no new detail); each field is spread evenly over its 15 minutes
    (or hour). *The run:* the newest cycle at least 50 min old whose files for the lead are on AWS; a replay takes the
    newest that would have been complete at the issue time (cycle + 80 min: the whole 18-h run is posted about 75 min
    after its cycle), and a reopened project the run it used. *Blend* (`blendFrame`): the frame for lead L is
    (1 − w)·nowcast + w·HRRR, w = 0 to 60 min, rising linearly to 1 at 90 min (at the frame's middle), HRRR alone after:
    fixed weights in the manner of extrapolation–model blends such as STEPS or INCA, not weights fitted to skill. Each
    member's own nowcast fades into the same HRRR run, so past 90 min the band holds only what is left of the nowcast
    members: narrower than the real uncertainty. Rolling forward, the fresh nowcast from the newest frame fades into the
    same run on the same schedule. With no run on AWS the nowcast alone runs to the end, and the panel and log say why.
    The run record gives the cycle, the file used for each forecast hour, the weights and the bytes read
    (`storm.radar.live.qpf`); the hyetograph marks the crossfade and draws the HRRR part in red.
  - *Limits:* a nowcast moves existing rain; it does not start new cells, and skill of this kind falls off after
    30–60 min (the hyetograph marks 60 min on a 90-min lead). HRRR can start and end storms, but for convective rain it
    often places them tens of kilometres and an hour or more off, so over an area of a few square kilometres it is
    lower skill still; the 2- and 3-h leads are for "what if the forecast is right", not timing. Example: Ida over South Street, Philadelphia, issued
    1 September 2021 23:30 UTC with a 60-min lead: motion 58 km/h toward 41° (r = 0.85); members' P10–P90 1.3–5.8 mm
    over the area (persistence 2.8 mm); 5.7 mm fell.
- **Rain QA** (`src/rainqa.js`). After a historic or live run, the rain used is compared with up to 12 independent
  gauges within 25 km: at most 4 ASOS hourly and the rest CoCoRaHS daily. Scoring rules: ≥ 90 % of hours (ASOS) or every
  report (CoCoRaHS), ≥ 2.5 mm, reports adding ≤ 18 h beyond the storm, and never the storm's own source gauge. The
  median model/gauge ratio is reported.

### 3.7 River inflows

- **Gauged** (`src/inflow.js`). Every mapped river crossing into the area is listed with USGS discharge gauges within
  about 15 km, and an upstream gauge on the same river is picked by datum. A historic run uses recorded 15-minute flows
  (NWIS IV, about 2007 on). A design run uses log-Pearson III on the annual peaks (Bulletin 17B moments, station skew;
  not 17C EMA or regional skew) with an NRCS gamma shape peaking at the rain peak plus a set lag. Flow is transferred to
  the entry by Q = Q_gauge·(A/A_gauge)^b with b = 0.8 by default; ratios outside 0.5–1.5 are flagged. Entry areas come
  from USGS NLDI.
- **Ungauged** (`src/streamstats.js`). The StreamStats flow-statistics workflow (delineate, NSS regression regions and
  peak equations, basin characteristics, estimate) gives 2–500-yr peaks with a 90 % interval: NSS's own interval, or
  ±1.645 average standard errors of prediction. The hydrograph is the NRCS dimensionless unit hydrograph (NEH 630
  ch. 16, peak rate factor 484) on a base of 5 % of the peak. Timing is the NRCS lag L = l^0.8(S+1)^0.7/(1900Y^0.5),
  tp = 1.11L, with CN 98 on the impervious share and 70 elsewhere. The default without characteristics is slope 2 %,
  CN 75. Warnings cover characteristics outside the equations' range, a basin more than 10 % impervious (the peak is
  likely higher), runoff greater than rain, and a peak after the run ends. There is no fallback beyond the user's own
  peak: the app does not invent a regional peak.
- **Baseflow warm-up**: optionally, rivers run at their start flow for set hours before the storm (not in the subgrid
  mode).
- Inflow enters through exchange cells and is included in the mass books (§2.7).
- **Fixed downstream level** (River leaving the area → "Or a fixed level at the edge", and the edge). With no
  downstream gauge, the open water on the chosen edge (`tidalEdgeCells` with that side, up to the level) is held at
  one entered level for the whole storm, on any storm. It is a boundary sensitivity test, or a pond or lake the stream
  runs into; a constant level also ponds the channel at baseflow, so the rising and falling limbs are not a fit test.
  The level and side are a fingerprint part (`outlet`, §8.2). Used for the Charlotte boundary test (§5.12).
- **River outlet** (`src/outlet.js`; Storm → River leaving the area). A free outfall drains a deep river off the edge
  as if over a fall, and the river upstream draws down toward it (Manayunk, §5.8: 3.6 m at the edge). When the user
  sets a downstream USGS gauge on a historic storm, the edge facing the gauge holds a level instead:
  - **Cells.** Open water on that side of the edge, widened along the edge over ground below the run's highest level
    (`tidalEdgeCells` with a side). The side is the one the line from the area's centre to the gauge leaves through.
  - **Level.** At each reading, the gauge's water surface (NAVD88, from its datum as for start levels) plus the
    backwater rise to the edge at its discharge then. The rise is a standard step in 20 sub-reaches:
    Δws = Δx · ½(S_f,up + S_f,down), with S_f = (Q/K)² and K = Σ w·d^5/3/n over the edge's own cells. The reach length
    is entered (the river's length along its channel), or else the straight line from the edge to the gauge.
  - **Assumptions.** The reach is prismatic, with the edge's cross-section and a level bed, and velocity head is
    ignored. A reach that widens toward the gauge loses less head than this; bridges, islands and bends lose more.
    The flow is steady at each reading, and there is no travel time between gauge and edge.
  - **Check.** `tests/run-outlet-tests.mjs` compares a 1.6 km channel with its downstream end held at 3 m against the
    same channel cut off halfway, with the outlet level at the cut. The backwater rise matches the gradually-varied-flow
    solution to 0.1 mm. The cut model holds the full river's level 600 m upstream of the cut to 1 cm, where a free
    outfall draws it down 0.96 m.
  - **Reach from lidar cross-sections** (an option: Reach → lidar cross-sections). The river's path from the gauge to
    the edge is the NHDPlus main stem upstream of the gauge (USGS NLDI). Sections are cut across it every 200 m,
    300 m to each side, from the 3 m 3DEP DEM. The water the lidar sees (ground within 0.15 m of the lowest point near
    the centreline) gets a parabolic channel carved under it. Its depth is the one entered, else the channel depth the
    bathymetry step used, else 2 m. A standard step through the sections carries the gauge's level to the edge, with
    velocity heads, the friction slope from the mean conveyance and contraction / expansion losses of 0.1 / 0.3 of the
    change in velocity head. A section too tight for the flow takes its critical depth. The tests check normal depth on
    a slope (2.226 m against 2.226 m), a level bed against the prismatic step (3.27 against 3.26 m), a reach twice as
    wide as its edge against a hand step (3.01 against 2.99 m), a choke at critical depth, and the carved area (80 m²
    against 2/3 · 40 · 3).
  - **Which to use: the channel depth decides it.** At Manayunk (`tools/outlet-reach.mjs`; the Philadelphia gauge's
    crest, 6.37 m and 3,540 m³/s), the cross-section reach puts the edge 0.4 m higher for each metre of the channel
    depth the lidar cannot see. With the regional curve's 2.74 m it gives 11.91 m, about 1.2 m above the marks near
    the edge; a 5–6 m channel matches them. The prismatic step gives 10.03 m on the app's edge section, which crosses
    the river at a slant, and 11.50 m on one square to the river. Neither is tuned to the marks. Prismatic stays the
    default, and the cross-section reach is for a river whose channel depth is known (a survey, BlueTopo, a HEC-RAS
    model): without one, the choice moves the edge level by more than the error it is meant to fix.
  - The solver holds one external level, so a run with a tide on its edges does not use the outlet.

### 3.8 Tides and compound flooding

- **Observed levels.** A historic event uses the observed level of a CO-OPS gauge within 60 km (NAVD88). It drives
  the stage boundary on tidal edge cells, chosen as open water on the edge within the tidal range and widened bank to
  bank (`tidalEdgeCells`), and the stage at SWMM outfalls that discharge to streams. The run window is padded to span
  the surge peak.
- **Datums and SLR** (`src/compound.js`). Station datums converted to NAVD88, or MSL where no NAVD88 exists (flagged).
  The 2022 Interagency SLR scenarios (Low … High) are moved to the datum epoch with NOAA's offsets so that a rise adds
  directly to MHHW. The observed trend is also available.
- **Design tide** for a design storm: still water at MHHW + surge + rise; a tide cycle (M2, 12.42 h) between MLLW and
  MHHW; or NOAA's harmonic prediction for a date. High or low water is placed at the rain peak. The surge is none,
  custom, or NOAA's 1- to 100-yr extreme water level (GEV on detrended annual maxima).
- **Joint probability**: two-sided conditional sampling (Bender and Jensen 2017; Jane et al. 2020), Kendall's τ →
  Gumbel copula (θ = 1/(1 − τ); independence for τ ≤ 0), GEV marginals by L-moments. The method reports AND isolines and
  four 100-yr design pairs.
- **Stated limits** (README): daily-event dependence stands in for annual maxima; daily rain is a calendar-day gauge
  total and a design run uses Atlas 14 at the same return period, not that depth; a still surge is held for the whole
  run (conservative for a short storm); waves, river–tide interaction upstream of the model and SLR-driven change in
  tidal range are not included.

### 3.9 Drainage

Three tiers, labelled on every output (README "Drainage"):

- **Tier 1, real pipes** (`src/network-real.js`). From user-linked layers (`src/linked.js`: any public ArcGIS layer or
  GeoJSON; an ArcGIS link can carry a `where` filter to take the mains out of a layer that mixes in laterals; fields
  for size, shape, inverts, status and system are detected and shown; when most pipes are marked combined (*Combined*,
  `COMB`, Portland's `CSML`) the combined-sewer defaults apply: roof downspouts to the sewer, sanitary flow, CSO regulators; an invert of exactly 0 is read as missing; a datum offset
  brings inverts on a local datum to NAVD88, e.g. City of Portland datum + 2.10 ft) or a utility publishing mains. Each
  invert is used only where it lies 0.2–30 m under its manhole's ground, and a pipe with one good end gets the other at
  its ground slope (≥ 0.5 %); the network stats count both (`invPartial`, `invRejected`). Ends snap
  within 1.5 m; catch basins join the nearest pipe within 30 m; abandoned/proposed pipes are dropped. Sizes over 6 m are
  treated as placeholders and filled from neighbours. Box and multi-barrel culverts become SWMM RECT_CLOSED. Inverts are
  used when plausible against the lidar, else derived (cover over the crown, ≥ 0.5 %, never rising). The network is
  oriented toward its exits.
- **Tier 2, synthetic network** (`src/drainage.js`), when no pipes are published:
  - manholes with grate inlets every 60 m along OSM streets (residential and up), at intersections and dead ends;
  - outfalls at mapped streams and where streets leave the area;
  - a tree by multi-source Dijkstra from the outfalls, penalising adverse slopes;
  - pipes sized by the rational method Q = C·i(tc)·A, with C = 0.95·imp + 0.2·(1 − imp) and i from the site's Atlas 14
    10-yr storm at tc (inlet time 10 min + travel at 1 m/s);
  - Manning full-flow diameters (pipe n = 0.013) rounded up to standard sizes (0.3–3.0 m) and never shrinking
    downstream;
  - 1.2 m cover and ≥ 0.5 % slope.

  Where a registered utility publishes inlets (Philadelphia), real grates are snapped to streets and the tier is
  labelled **2+**: real inlets, synthetic pipes.
- **Tier 3, lumped rate**: a capacity in mm/hr removed from street cells. **None** is also an option.
- **Pipes leaving the area** continue 100 m off-site to a normal-depth outlet, so downstream capacity and backwater are
  felt. They are not regulated.
- **Infrastructure drawer** (`src/infra.js`): drawn or imported pipes, culverts, manholes, catch basins, outfalls and
  storage replace linked and synthetic elements. Debris blockage of 25/50/75/100 % can be set on grates and culverts.
- **Storage**: underground tanks as SWMM storage units (`addTanks`), and drawn storage connected to the nearest
  manhole.
- **Combined sewers** (`src/cso.js`; on by default where the utility marks combined sewers):
  - sanitary flow from land-cover population densities (8/25/60/120 people per ha for NLCD 21–24) × 300 L/person/day,
    on a residential diurnal pattern (morning peak 1.43 × mean) set to the local solar hour;
  - pipes start full of dry-weather flow;
  - each outfall to a stream becomes a regulator: an outlet to the interceptor up to 3 × peak dry-weather flow (at least
    5 L/s), and a weir spilling the rest;
  - flap gates on outfalls to tidal water when a CO-OPS level is in the run;
  - census counts are not fetched; these are planning defaults.

### 3.10 FEMA NFHL

`src/fema.js` reads zones (layer 28), BFE lines (16) and cross-sections with WSEL_REG (14), and shifts NGVD29 to
NAVD88 by NCAT. The BFE at a point is:

- **AE zone**: interpolated between the two nearest BFE lines or sections of different elevation, inversely to
  distance;
- **AH and VE zones**: the zone's static BFE;
- **AO zone**: ground + the zone's depth;
- **A zone**: none (the app says so).

FEMA data is used for design floor checks, the floodplain-fill level and the report. It is not used as a model input
or calibration target.

### 3.11 Structures and damage

`src/damage.js`:

- **Structures** come from the USACE NSI, fetched per area: occupancy, foundation type and height, structure and
  content values, population by day and night.
- **Water against a building** is the highest peak water surface on the open cells next to the OSM footprint containing
  the NSI point. Only cells at least 10 cm deep count (adjustable), and only in a flooded patch that reaches a street or
  covers 200 m². Ground is the median lidar ground of those cells, and first floor = ground + NSI foundation height.
- **Curves**: USACE depth–damage functions per occupancy type, linear between tabulated feet. The low/high band is all
  curves at their 10th and 90th percentiles together (mean ± 1.28 sd), so the band is wide on purpose.
- **Sensitivity to the exposure rules** (README, South Philadelphia test block, 10-yr 1-h). Counting any water at a
  wall (0.5 cm) booked $101 M of damage to 528 of 700 structures. With both filters, water reaches 47 structures, 13
  have it above the first floor, and damage is $6.3 M.
- Damage covers buildings only: no vehicles, displacement, emergency costs or life safety.

### 3.12 Watershed trace

`src/watershed.js`: priority-flood depression filling (Barnes, Lehman & Mulla 2014), D8 flow directions and an
upstream trace on a 3DEP 5 m (or 10 m) DEM, widening until the catchment closes (up to about 15 km). *Run on the
watershed* replaces the model area with the watershed polygon, so nothing flows in across the edge. For a river from a
large basin, the river's flow comes in from a gauge or StreamStats and the local watershed is offered as the area. The
trace is surface-only: pipes and routing around buildings are not included, and the line is approximate in flat urban
terrain.

---

## 4. Outputs and post-processing

### 4.1 Per-run grids

Saved in each run folder as `grids/<name>.f32` (float32, little-endian, row 0 north) with an ESRI `.hdr`, always at
1 m (`app/map.js` `finishRecord`; `src/compare.js` `GRIDS`):

| Grid | Definition | Notes |
|---|---|---|
| `max_depth` | Peak depth over the run | At 1 m from the solver's every-step peak. At 2–4 m, downscaled (§2.12) and forced ≥ `final_depth`. NaN on walls and outside the area. |
| `max_wse` | Ground + `max_depth` where `max_depth` > 5 mm | Not a single-instant surface |
| `max_speed` | Peak speed where depth > 5 cm, every step (`hzRecord`) | At 2–4 m, a solver-cell value painted on its wet 1 m pixels |
| `max_dv` | Peak depth × velocity at the same moment | |
| `t_wet` | First time deeper than 5 cm (s) | NaN if never |
| `t_above15` | Time deeper than 15 cm (s) | |
| `final_depth` | Depth at the end of the run | |
| hazard | Worst ARR 2019 class | 0 where never wet |

The run folder also holds ESRI ASCII grids with `.prj` (README "Hazard and intensity", "Projects"):

- `max_depth.asc`, on the solver grid, or 1 m in the subgrid mode;
- `max_speed.asc`, sampled at the display frame rate where depth > 1 cm. This is **not** the every-step `max_speed`
  grid;
- `hazard_arr.asc`, `hazard_fd2320.asc`, `hazard_fd2320_urban.asc`, `max_dv.asc`, `max_force.asc`,
  `flood_duration_min.asc` and `arrival_min.asc`;
- scour, sediment and bank grids when those modules are on.

### 4.2 Hazard classes

`src/hazard.js`, kernel `arrClass`. Classes are computed from depth and velocity **at the same moment**, every solver
step, and the worst is kept; max depth × max speed would overstate the hazard. No class is assigned below 1 cm depth,
and velocity counts only from 5 cm.

ARR 2019 / AIDR Guideline 7-3 (default):

| Class | Limits (all must hold) | Meaning (`STANDARDS.arr`) |
|---|---|---|
| H1 | d·v ≤ 0.3, d ≤ 0.3 m, v ≤ 2.0 m/s | Generally safe for people, vehicles and buildings |
| H2 | d·v ≤ 0.6, d ≤ 0.5, v ≤ 2.0 | Unsafe for small vehicles |
| H3 | d·v ≤ 0.6, d ≤ 1.2, v ≤ 2.0 | Unsafe for vehicles, children and the elderly |
| H4 | d·v ≤ 1.0, d ≤ 2.0, v ≤ 2.0 | Unsafe for vehicles and people |
| H5 | d·v ≤ 4.0, d ≤ 4.0, v ≤ 4.0 | Unsafe for vehicles and people; buildings need engineered design |
| H6 | otherwise | All buildings vulnerable to failure |

UK FD2320: HR = d(v + 0.5) + DF, with classes < 0.75, 0.75–1.25, 1.25–2.0 and > 2.0. DF = 0 for the plain rating;
the urban variant uses DF = 1 for depths over 0.25 m.

Force per metre of width is ρ(h·v² + ½g·h²) in kN/m. With the scour module on, the run also records bed shear
τ = ρg·n²·v²/h^⅓.

### 4.3 Arrival and duration

Arrival is the first time a cell exceeded 15 cm (hazard set) or 5 cm (`t_wet` grid); duration is the time above 15 cm.
Both are recorded every solver step on the GPU and checked against the CPU solver (times exact, README "Verification").

### 4.4 Flooded areas, streets and access

- **Flooded areas** (`src/areas.js`): 4-connected cells above a threshold (15 cm default; 5, 30, 60 cm selectable),
  ranked by volume. Each area reports its size, peak volume, depth bands, arrival and duration, peak speed and d·v,
  worst hazard class, the streets in it (length deeper than 30 cm), buildings and NSI structures with water above the
  floor, night population, damage, the share of water left at the end, and whether it touches the model edge.
- **Streets and access** (`src/maps.js` `streetStats`): each mapped centreline sampled for length over 15 cm (only
  emergency and high vehicles pass) and over 30 cm (most cars float or stall), deepest point, arrival, longest time over
  15 cm, and top speed.

### 4.5 Damage, EAD and benefit–cost

- **Damage per run**: as in §3.11, with a low/high band.
- **EAD** (`ead` in `src/damage.js`; `eadFamily` in `app/map.js`):
  - The input runs are the project's saved runs of the same scenario, design and forcing (other than storm and run
    length), at Atlas 14 return periods of the same duration.
  - Damage is integrated by trapezoids over AEP. Damage falls linearly to zero at AEP 1 when the most frequent storm
    already does damage, and the tail beyond the rarest storm is held at its damage. Both are flagged when they matter
    (> 20 % of EAD in the tail), as is damage that falls as storms get rarer.
  - **AEP = 1 − exp(−1/ARI)** (`aepOfPds` in `src/damage.js`): Atlas 14's ARIs are partial-duration (the mean time
    between exceedances), so the annual exceedance probability of the 2-yr storm is 0.39, the 10-yr 0.095 and the
    100-yr 0.00995. Before commit `2535d75` FloodSim used 1/ARI, which overstated the frequent storms (2-yr: 0.50) and
    so the EAD; EADs from earlier versions should be recomputed. The 1-yr storm (AEP 0.63) is now included.
- **Benefit–cost** (`bca`): annual benefit = EAD without − EAD with; present values over the period (default 50 years)
  at a real discount rate (default 3 %); net benefits and BCR.

### 4.6 Hydraulic report outputs

`src/report.js`; README "H&H report":

- **Hydrographs**: each control line (flow across it, booked per face every stage, §5.1) and each storm-sewer outfall,
  with peak, time to peak and volume.
- **Detention ponds**: stage–storage from the graded 1 m ground, stage–discharge from the outlet rating (orifices,
  riser weir, spillway with Villemonte submergence; free outfall), stage and outflow in time, and peak stage and
  freeboard.
- **HGL**: a profile from a manhole to its outfall (rim, crown, invert, max HGL), from the coupler's per-node max head,
  time surcharged and flooded volume at every 2 s exchange. Flags: floods (HGL above the rim), low freeboard (default
  1 ft), surcharged (above the crown of the leaving pipe).
- **Gutter spread**: per inlet, from the grate across the street toward the nearest mapped centreline to where the max
  depth falls under 3 mm, checked against an allowable spread (default 8 ft). Water reaching the far curb is reported
  as street full. The test case (2.75 m against T = d/Sx = 3 m at 1 m cells) shows that spread resolution is one cell.
- **Water surface profiles** along drawn lines, with nearby finished floors.
- **FEMA zones**, CSO overflow books (per regulator: volume, peak, hours, events, capture), river inflow and compound
  flooding sections.

### 4.7 Design comparisons

`src/compare.js`. Δ maps (after − before) of max WSE, max depth, time above 15 cm, first wetting and hazard class, with
a no-change band of 3 mm (1 min for times). Also newly wet / newly dry at 15 cm, off-site adverse impact (cells with a
higher max WSE outside the site boundary), a building table within 100 m (existing FFE estimated as HAG + 6 in, marked
"est."), and an outlet table per control line with the post ≤ pre check. Two runs compare only when their forcing
fingerprints match (§8.2).

### 4.8 Exports

| Export | Content | Source |
|---|---|---|
| Run folder | `summary.json`, `.f32` grids, `.asc` grids + `.prj`, SWMM `.inp` and report, hyetograph, infrastructure layer, `network.json`, `hgl.json`, `inlets.json`, `barriers.csv`, `calibration.csv` | `app/map.js`, `app/projects.js` |
| HEC-RAS 2D package | `terrain/terrain_model.tif` (the ground as run: lidar + carved channel + curb burn + design, float32, NAD83/UTM + NAVD88), a buildings-raised terrain, NLCD class and Manning's n rasters, shapefiles (perimeter, BC lines, breaklines, buildings, internal inflows), boundary series CSV, hyetograph or MRMS 15-min grids, `README_HEC-RAS.txt` | `src/hecras.js`, `src/tiff-write.js`, `src/shapefile.js` |
| SWMM | `.inp` with UTM coordinates, for PCSWMM / SWMM5 | `src/drainage.js` |
| 3D (Unreal) | 16-bit heightmap PNG, DEM and max-depth EXR, buildings GLB, frame EXRs, `metadata.json` | `src/export.js` |
| Comparison zip | Δ grids (`.asc` + `.prj`), buildings, control lines, hydrographs, `comparison.json`, `summary.html` | `src/compare.js` |
| Report zip | `report.html` (methods note per section), every figure as SVG/PNG, every table as CSV | `app/report-ui.js` |

The HEC-RAS package does **not** contain the storm sewer, culverts, ponds and GI, or the starting water levels. Its
normal-depth BC slopes are estimated from the ground 20 m inward (0.05–5 %). RAS builds its own mesh and terrain HDF,
so a RAS rebuild is an independent model, not a copy.

### 4.9 Emulator outputs (screening only)

`src/emulator.js`: Latin-hypercube training runs, PCA of the max-WSE, speed and duration fields, one Gaussian process
(Matérn 5/2) per component and per scalar output, leave-one-out (Dubrule) and held-out validation. Emulated maps are
marked "emulated" everywhere, including exports. Valid only inside the trained box, for that scenario and model build.
Changes under about 1 cm are within its error, so an off-site impact must be confirmed with the solver (README).

---

## 5. Verification and validation

**Verification** (does the code solve the equations correctly) is extensive. **Validation** against observed floods
in the repository is limited (§5.6–5.13, §5.15).

### 5.1 Code verification (analytic and internal-consistency tests)

From README "Verification (all pass)"; full numbers in `tests/results-cpu.json` and `tests/results-gpu.json`:

| Test | CPU fp64 | GPU fp32 |
|---|---|---|
| Stoker wet dam break, 400 cells, L1 | 1.6e-3 (order 1.0) | 1.6e-3 |
| Ritter dry dam break, 400 cells, L1 | 2.5e-3 (order 1.0) | 2.5e-3 |
| Lake at rest, submerged bump, max \|u\| | 2e-14 m/s | 9e-6 m/s (bed at 100 m) |
| Lake at rest, emergent island, max \|u\| | 2e-14 m/s | 1e-5 m/s |
| Thacker paraboloid, 100 cells, L1 at T | 2.5e-2 (order 1.5) | 2.5e-2 |
| Rain-on-grid mass balance | 4e-15 | 2e-7 |
| Urban cloudburst (app terrain) mass | 5e-15, 0 m³ clipped | 4e-7, 0 m³ clipped |
| Valley dam break (app terrain) mass | 1e-16 | 1e-8 |
| GPU vs CPU, rain case, max \|Δh\| | – | 5e-6 m |
| Active tiles vs full grid, 640×480 dam break | – | 0 (bit-identical) |
| Green infrastructure: CPU parity, tiled = untiled | – | 9e-8 m, bit-identical |
| Flood barriers: overtopping vs CPU, books, tiled = untiled | weir rate within 2 % of C·H^1.5 | 2e-5 m, books 4e-7, bit-identical |
| Hazard products every step vs CPU | – | 0 class differences, force 9e-5 kN/m, times exact |
| Green-Ampt and scour vs CPU | ponded GA within 0.3 % of analytic | 1e-7, 1e-4, 3e-4 mm |
| Control lines: across a channel; around the domain | – | 9e-9, 1e-9 (tiled = untiled) |
| Rerun of the same run (batches of 7 vs 64 steps) | – | 0 values differ |
| Peak speed and first wetting every step vs CPU | – | 3.6e-6 m/s, 0 s |
| Pond with one orifice vs modified Puls (30 min drawdown) | – | stage within 4.8 mm, volume out within 0.3 %, books 1e-6 |
| Rain garden with underdrain | – | 90.91 % (exact); books 3.4e-6 |
| Local time stepping vs global | L1 within 0.2 %, 4e-14 m/s, Δh 9e-4 m, mass 7e-13 | GPU = CPU LTS to 3e-7 m, 9e-5 m/s, 2.6× faster at 786k cells, books within 0.01 % |
| Sediment (4 classes), debris flow, armouring, bank stability | see README table | solids ~1e-6 to 1e-7 per class; bank FS 2e-7 vs `src/banks.js` |

Also in the GPU suite (`tests/gpu-suite.js`): the water-level boundary (still water stays still; a rising stage floods
in through the boundary only), drainage inlets (sinks bounded by available water; exchanged volume closes the books),
and **rain on a plane** (HEC-RAS RD-52 §4.2.8). On the plane, FloodSim follows the kinematic-wave rising limb to about
1 % at 1 m and reaches equilibrium exactly (`benchmarks/gatec/README.md`).

The CPU suite (`tests/run-tests.mjs`) fails if accuracy, convergence order or mass balance regress: L1 errors may not
exceed the value measured on 2 November 2026 by more than 10 %.

### 5.2 UK Environment Agency 2D benchmarks (Gate B)

`benchmarks/ea/README.md`. FloodSim's GPU solver (the code the app runs) on Néelz & Pender (2013), SC120002, with the
May 2010 specifications. Run 25 Oct 2026 on an NVIDIA Blackwell GPU in Chrome WebGPU:

| Test | What it tests | Grid | Inside the report's spread | Against 7 codes' probe series | Mass error |
|---|---|---|---|---|---|
| 1 | Disconnected pond, wetting/drying | 70×10 @ 10 m | 4 / 4 | 100 % inside, median 1 mm | 3e-6 |
| 2 | Filling floodplain depressions, 48 h | 100×100 @ 20 m | 10 / 10 | 100 % inside every probe | −1e-5 |
| 3 | Momentum over a hump | 60×20 @ 5 m | 6 / 6 | — | 3e-7 |
| 4 | Flood wave over a flat plain | 200×400 @ 5 m | 12 / 12 | 100 % inside, median ≤ 7 mm | −5.4e-6 |
| 5 | Dam-break valley flood, 17 km | 256×226 @ 50 m | 13 / 13 | 100 % inside (±0.1 m), median ≤ 6 cm | −6e-6 |
| 6A | Lab dam break past a building | 1010×56 @ 0.1 m | 12 / 14 | — | −4e-7 |
| 6B | Same at field scale (×20) | 1010×56 @ 2 m | 13 / 13 | — | −2e-5 |
| 7 | 1D river linked to 2D floodplains, 72 h | 150×400 @ 20 m + 42-section river | 18 / 22 | — | −3.8e-5 (river 0.09 %) |
| 8A/8B | Urban rainfall, surcharging sewer (Glasgow) | — | not run (data supplied by the EA on request) | | |

**88 / 94** reported measures fall inside the spread of the participating packages. Every probe series in Tests 1, 2,
4 and 5 sits inside the envelope of seven independently run codes: HEC-RAS 6.x (two versions), LISFLOOD-FP (ACC, FV1,
DG2), TELEMAC-2D and ANUGA, as run by the open benchmark1d2d project.

Where FloodSim falls outside (from the README):

- **6A, G2 and G4 at 10–20 s.** The bow jump upstream of the building holds about 0.25 m short of where the laboratory
  saw it migrate. This is unchanged at 0.05 m and with van Leer. The candidates are the missing eddy viscosity term and
  masked-wall treatment in MUSCL. The report saw a similar late transition in one package.
- **Test 7, four edge misses**: M045 8 cm high at 10 h; P6 peak 6 mm over the band; flooding at P11 0.1 h late and at
  P14 0.03 h early, beyond the reading tolerance. The report found arrival times differing by up to 3 h between
  packages.

Caveats on the scoring:

- The report bands were read by eye from raster figures and widened by the reading precision (`score.mjs` lists each).
- Test 8 (urban rain with a surcharging sewer), the closest EA analogue to FloodSim's main use, has not been run.
- The mass-error column above is the README's, after the Kahan fix. `benchmarks/ea/results/score.txt` still shows the
  pre-fix values for Test 4 (−1.2e-4) and Test 2 (−1.2e-5); the README states the scores were unchanged by the fix.

### 5.3 Comparisons with HEC-RAS 2D

`benchmarks/gatec/README.md`. USACE publishes no HEC-RAS 2D results as data, so the comparisons use third-party RAS
runs (benchmark1d2d) and RAS runs made here.

**EA Tests 1, 2, 4, 5 against four HEC-RAS runs** (`node benchmarks/gatec/hecras-ea.mjs`):

| Test | Median distance from HEC-RAS (all four runs) | Probes no further from HEC-RAS than the other codes |
|---|---|---|
| 1 Disconnected pond | 0.3 cm | 2 / 2 in each run |
| 2 Floodplain depressions, 48 h | 0.3 cm | 16 / 16 in each run |
| 4 Flat-plain flood wave | 0.1 cm | 6 / 6 in each run |
| 5 Dam-break valley | 0.8 cm | 7 / 7 in each run |

These test the core solver, not the urban physics.

**HEC-RAS "Davis" storm-sewer example** (HEC-RAS 7.0.2, run headless here). 1.2 in of rain over 6 h on a closed
5.76 km² area, n = 0.06, no infiltration; 131 inlets, a 132-pipe network and a pump; 36 h. HEC-RAS runs 2,705 cells of
150 ft with subgrid tables; FloodSim runs 74,520 cells of 8.8 m with the pipes translated to SWMM:

| | FloodSim (two-way inlets) vs HEC-RAS | HEC-RAS SWE-ELM vs diffusion wave |
|---|---|---|
| Peak surface volume | 136,300 vs 128,800 m³ (+5.8 %), both at 6 h | −0.4 % |
| Peak flooded area > 15 cm | 29.7 vs 29.2 ha (+1.8 %) | 0.0 % |
| Maximum-depth map | median \|Δ\| 2.8 cm, 90 % within 6.9 cm, bias −1.0 cm; extent > 15 cm CSI 0.72 | 0.3 cm; CSI 0.95 |
| Pump peak, wet-well peak | 1.95 vs 1.92 m³/s; 12.23 vs 12.16 m | equal |
| Pipe-node peak levels | median \|Δ\| 37 cm | 0 cm |
| Pumped over 36 h | 121,300 vs 144,200 m³ (−16 %) | +0.2 % |
| Left on the surface at 36 h | 52,500 vs 31,500 m³ | 31,100 vs 31,500 m³ |
| Mass | surface 2e-6, SWMM −0.03 % | HEC-RAS volume error 0.13–0.14 % |

- **What agrees**: the flooding pattern and depth (median 2.8 cm), the peak flooded area (within 2 %), and the pump peak
  and wet-well level.
- **What differs**: FloodSim leaves 21,000 m³ more in 3–30 cm ponds away from the inlets at 36 h, and pumps 16 % less
  over the event. This is not grid resolution: it persists at 44 m cells. The README's likely explanation is HEC-RAS's
  one-level-per-cell drainage across sub-cell ridges that FloodSim resolves. Which is closer to reality "needs
  observations, not another model". Pipe-node peak levels differ by a median 37 cm.
- **Proposed agreement criterion** (README, not yet met in full): no further from HEC-RAS than the other established
  codes, and on surface quantities within the HEC-RAS SWE-ELM/SWE-EM spread plus 5 cm in level or 10 % in flooded area.
  On Davis the surface measures meet it; total volume through the pipes does not.
- **Still to do** (README): a case with observed pipe and street levels (the Bellinge dataset is proposed); RD-52 §4.3.3
  (Cea 2008 urban layout with measured discharges); and the benchmark1d2d surcharge cases in HEC-RAS. **Gate C is not closed.**

**Coupled cases with exact answers** (benchmark1d2d A12-010 to A12-012, `benchmarks/gatec/coupled/README.md`; 5 Nov
2026). The GPU solver, SWMM with the app's options and the Coupler, both exchange modes. 22 of 22 measures pass:

- A manhole surcharging onto a street passes the full 0.5 m³/s, and the street runs at normal depth (77.7 mm, exact
  77.68 mm).
- A storm that overflows a manhole all returns and leaves (180.0–180.4 m³ of 180).
- A flooded yard settles 4.5 mm above its gully crest (tolerance 1 cm) and 220.6–220.9 m³ of 225 leave (tolerance 2 %).
  The first run modelled the crest as a raised cell. It drained the last centimetre half as fast as a sharp weir and was
  2.5 % short, which is why inlets now take a crest (§2.14).
- The combined books close within 0.5 % in every run. What remains is SWMM's own continuity error, and the surface
  solver's books close to round-off.
- With the manhole's 0.28 m² as SWMM's minimum node area, in place of the app's 1.2 m², SWMM's error on the yard
  case was −1.0 to −1.4 %.

### 5.4 Mass balance with every exchange model on

Results (25 Oct 2026; storm + 30 min; `benchmarks/gatec/results/gatec-mass-*.json`):

| Site | What is on | Rain + piped roof rain | Surface | SWMM continuity | Combined |
|---|---|---|---|---|---|
| Ellicott City MD, 2 m | pipes, 50 % downspouts, 10 OSM culverts, permeable pavement 50 %, rain gardens 10 %, green roofs 50 %, 2,000 m³ tanks | 41,759 m³ | 5.8e-6 | −0.14 % | −0.0044 % |
| South Street, Philadelphia, 1 m | 127 real PWD inlets, synthetic pipes, 30 % downspouts | 16,576 m³ | 4.1e-7 | −0.35 % | −0.26 % |
| West Hollywood CA, 2 m | tier 1 linked pipes, rain gardens 5 % | 23,799 m³ | −1.1e-6 | −0.08 % | −0.0075 % |
| Seattle WA polygon, 2 m | polygon sink edge, permeable pavement 30 %, custom 75 mm/1 h | 12,147 m³ | −2.4e-7 | −0.09 % | −0.0084 % |

With two-way inlet exchange (the default), South Street improves to combined −0.12 % / SWMM −0.18 %, with the flood
picture unchanged (0.39 ha > 15 cm, max 1.26 m). The other three sites are identical. All four close within the Gate C
criteria (§2.13).

### 5.5 Other demonstrations reported in the README

| Demonstration | Result (README) |
|---|---|
| Subgrid 4 m / 8 m vs 1 m, 320 m synthetic urban catchment, 30-min cloudburst | 4 m: 15× faster, peak depth 2.6 cm mean / 4.0 cm RMS error, no bias, CSI 0.80 (> 15 cm). 8 m: 36× faster, 5.6 cm, CSI 0.63 (screening only) |
| Subgrid 4 m vs 1 m, South Street (rowhouses, combined sewer, 60-min Atlas 14) | 3.3 cm mean / 6.1 cm RMS, 0.1 cm bias, CSI 0.67 |
| Window rerun vs full run, Meyerland block, 60 m margin | depth RMSE 6.4 mm over 90,000 wet cells, 683 cells off by > 3 cm (worst 18 cm), line peak 48.6 vs 49.6 cfs, edge outflow within 2 % |
| Emulator held-out runs, Meyerland (return period × soil wetness) | depth RMSE 0.6–1.2 mm, worst cell 3 cm, CSI ≥ 0.993, control-line peak within 0.5 % |
| Paused/resumed batch run vs uninterrupted, 2 m, 520 × 456 cells | bit for bit on every result grid, inlet and pipe results and SWMM books (infiltration book 1e-7) |
| Calibration recovery, South Street synthetic marks (n 1.6×, infiltration 0.25×, clogging 70 %) | recovered exactly, but levels move < 1 cm across the whole range, so marks there do not constrain these settings |
| South Street pipes (100-yr 1-h, 127 PWD inlets) | surface balance 9e-5, SWMM −0.35 %, combined −0.21 % |
| West Hollywood public storm drains (tier 1) | SWMM −0.04 %, combined −0.002 % |
| Starting levels, Hollofield gauge (`--live`) | 57.46 m NAVD88, 0.46 m above its lidar water surface |
| StreamStats, Wissahickon Creek at 01474000 | basin 63.7 mi² (NWIS 64.0); Q100 12,300 cfs, 90 % 7,400–20,400 cfs |

### 5.6 Historic event validation — Hurricane Ida remnants, Philadelphia, 1 Sept 2021

Run on 3 November 2026 at commit `08a4162` (+ the water-balance fix of `2535d75`), in the app, as a user would.

- **Model.** The South Street block of the README (520 × 456 m, 2 m solver downscaled to 1 m): 1,329 buildings as
  walls, combined sewers with 158 real PWD inlets and synthesized pipes (tier 2+), sanitary flow on, 18.5 h run.
- **Rain.** NOAA MRMS MultiSensor QPE Pass 2 (gauge-adjusted), hourly, timed by the 2-min radar rate, 1 km: 68.7 mm over
  the area between 20:06 and 03:50 UTC. Over the same hours the radar alone gives 102.7 mm and the IEM gridded site
  record 86.4 mm. Observed Delaware River level (CO-OPS 8545240, 1 km) on the open-water edges.
- **Rain QA against independent gauges** (`src/rainqa.js`, report section *Rain against nearby gauges*). Of 12 gauges
  within 25 km, 11 were scored (one ASOS missing 3 of 10 hours). Model ÷ gauge: median **0.83**, range 0.53–1.44;
  the nearest, CoCoRaHS NJ-CN-24 at 8.2 km, **1.04**; Philadelphia International (ASOS, 10 km) 1.44; Wyndmoor
  (CoCoRaHS, 13 km, 130 mm) 0.53. Ida's totals ranged from 48 to 130 mm across 25 km, so no single gauge is decisive;
  the median sits in the scorecard's *fair* band (|ratio − 1| = 0.17). The gauge-adjusted product being 33 % under
  radar-only matches the Fairmount run of §5.13 and is not yet explained.
- **Books.** Surface −7e-6, surface + sewers +3e-4. The report's water balance closes to 187 ft³ of 596,380 ft³ in:
  rain on the ground 310,917; roof rain piped to the combined sewers 264,097; sanitary flow 21,048; to the pipe
  outfalls 518,101; infiltration 26,814; off the model edge 15,301; standing at the end 35,870. (This run found the
  report's earlier table, which omitted the piped roof rain and sanitary flow and so showed more water leaving than
  rain falling; fixed in `2535d75`.)
- **Depths: not validated at this site.** USGS STN holds 262 Ida marks in Pennsylvania, 43 around Philadelphia, all on
  the Schuylkill (Fairmount to Manayunk); none falls in this block, and no street-flooding observations are published
  for it. Peak depth in the model: 0.76 m. The marks that exist are riverine; the Fairmount run of
  §5.13 used five of them, and the Manayunk reach has 15 (§5.8).

What this shows: the rain QA, water books and report work end to end on a real storm, and the rain the model used is
consistent with the gauge network to within its spread. It does not show that the modelled depths are right.

### 5.7 Historic event with a real combined sewer — Laurelhurst, Portland OR, 12 Sept 2018

Run on 3 November 2026, in the app, from the *Laurelhurst, Portland OR* example (the commit that adds this section).
Chosen because the City of Portland publishes its sewer mains with surveyed inverts, and a short cloudburst
(about 0.75 in in 40 minutes, Laurelhurst and Hollywood) hit the area on 12 Sept 2018.

- **Model.** 1.3 km² box, 2 m solver: buildings as walls, tier 1 pipes linked from Portland BES open data (mains with
  `SERVSTAT = 'IN'`, inlets from the node layer, inverts + 2.10 ft City datum → NAVD88). 446 SWMM conduits, 420 from
  the layer with their own inverts (40 with one end carried at the ground slope, 8 implausible inverts not used),
  380 real inlets, 26 pipes continuing off-site to normal-depth outlets. 335 of 370 mains are marked combined
  (`UNITTYPE = CSML`), so roof downspouts go to the sewer, with sanitary flow and one CSO regulator. Two-way inlet
  exchange.
- **Rain.** *Another date…* 2018-09-12, MRMS gauge-corrected, timed by the 2-min radar rate: 26.3 mm over the area,
  peak 65 mm/h over 2 min (radar-only: 33 mm).
- **Books.** Surface 2.4e-6, surface + sewers −0.48 %, SWMM continuity −0.79 %. In: rain on the ground 26,833 m³,
  roof rain piped 8,306, sanitary 514. Out: pipe outfalls 17,042 (16,970 of it through the off-site outlets),
  infiltration 12,353, model edge 3,508, standing at the end 2,814. Inlets took 14,412 m³; 6,254 m³ came back up
  through inlets where the pipes surcharged. CSO: 49 m³ at the one regulator in the box. Peak depth 1.16 m.
- **Rain QA.** Three ASOS gauges scored: Portland International (7 km) model ÷ gauge 1.40, Pearson Field (10 km)
  3.23, Troutdale (17 km) 4.70. None of the nine CoCoRaHS gauges within 9 km could be scored, because each daily
  report covers 20 h beyond the storm. A complete daily report still caps the storm's rain at the gauge, though. The
  model is more than 15 % above 8 of the 9 caps. The five within 3 km read 6.3–21.1 mm for the whole day against
  26.3 mm. So the gauge-corrected MRMS rain is probably too high here, by about a third or more. That is
  consistent with the cell being smaller than MRMS's 1 km hourly product can resolve. Rain QA now reports these
  upper bounds (`bounds` in `src/rainqa.js`).
- **Model checks.** Two Problems, both correct for this box: 1,067 ha of ground outside it drains in (822 % of the
  area), and 29 % of the flooding lies within 50 m of the edge. The box sits mid-catchment, so the street depths are
  not usable without a larger area or the upstream inflow.

What the runs found and fixed (each run in the app, as a user would):

1. A missing invert read as 0 put 40 pipe ends 40–65 m below the street, with SWMM heads 26 m above it. The
   combined books were off by −223 %. Inverts are now taken end by end (§3.9).
2. The two-way return cap took SWMM's negative lateral flow, which is the return itself, off the node inflow. This
   raised the cap every interval: 70,000 m³ came back up for 38,000 m³ taken in (combined −183 %, SWMM −172 %).
   Fixed (§2.14). Rerunning Davis moved its return flow by 0.8 % and left every reported number unchanged.
3. Combined sewers were recognised only inside Philadelphia's utility area, so a linked combined system got no roof
   connections. The pipes' system field is now read (§3.9).
4. Rain QA left every daily gauge unscored on a short storm, which hid that the rain was too high. Complete daily
   reports are now read as upper bounds.

What this shows: a real public sewer layer on a local datum can be linked, built and run, and the books close. Rain QA
and the model checks both catch what is wrong with the setup. It does not validate depths: no depth or flow
observations were found for this storm, and the box would need the upstream catchment first.

### 5.8 Historic river flood — the Schuylkill at Manayunk, Ida, 1–2 Sept 2021

Run on 3–4 November 2026 at commit `33794a1`, in the app, from the *Manayunk, Philadelphia PA* example: the
first validation here against a full set of surveyed high-water marks and a gauge inside the model. Rerun on 4 November
with the river outlet code of `91b0845` (the run record says `f5e2632+dirty`: the page loaded before that commit) and a river outlet on the south edge (§3.7), everything else the same; the rerun is at the end.

- **Model.** 5.3 × 3.4 km (Flat Rock Dam to East Falls, with Roxborough and the lower Wissahickon), 18.4M 1 m DEM
  cells, a 2 m solver (4.6M cells, 72,044 active tiles at the peak). Buildings as walls, no drainage, gauge start
  levels. Channel: no BlueTopo above Fairmount Dam, so the Appalachian Highlands regional curve (104 m × 2.9 m
  bankfull for the Schuylkill), 1.12M m³ carved under the lidar water.
- **Inflow.** Schuylkill at Norristown (01473500) × 1.017 for the drainage area at the north edge: peak 3,428 m³/s
  (121,000 cfs) at hour 14.7, not lagged for the 20 km between. Wissahickon Creek at its mouth (01474000) × 0.950
  where it enters the north edge and × 0.991 where it comes back in on the east edge (it leaves the area between).
- **Rain.** MRMS gauge-corrected, timed by the 2-min radar rate: 98 mm over the area (radar alone 142 mm). Rain QA: 11
  of 12 gauges within 25 km scored, model ÷ gauge median 0.97 (0.62–2.06), the nearest (CoCoRaHS Wyndmoor, 2 km)
  0.81. Rain is under 1 % of the water in: the river carried 201M m³.
- **Books.** 4.2e-7 after 70,320 s (19.5 h of storm, 7.4 h of computing). In: river 201.2M m³, rain 1.80M, at the
  start 1.82M; out: the edge 198.0M, infiltration 0.92M, standing at the end 5.88M.

**Result of the first run: the river is about 1.3 m low through Manayunk.**

| Observation | Observed | Model | Error |
|---|---|---|---|
| Manayunk gauge (01473800), crest | 13.01 m, 12:15 UTC | 11.50 m, 11:52 UTC | −1.51 m, 23 min early |
| 9 river high-water marks (levels) | 11.70–13.53 m | | −0.31 to −1.85 m, mean −1.29 m |
| All 11 scored marks | | | bias −0.88 m, RMSE 1.36 m, 1 within 15 cm; 8 of 11 flooded calls right |
| Wissahickon gauge (01474000), its pool, peak | 11.07 m | 12.46 m | +1.39 m |

Three marks sit under the lidar's bridge decks (1.7–6.6 m below its ground) and are not scored. The eleventh mark,
East Falls-1, lies 20 m from the edge, in the water ponded at the Wissahickon's mouth (below); the model checks flag
it. The gauge follows the rise to within about 0.5 m until 01:00 UTC, early because the inflow is not lagged. After
that it falls behind and stays 1.0–1.5 m under the record to the crest.

**Why: the south edge draws the river down.** The Schuylkill leaves the model across its south edge at East Falls,
which is a free outfall (§2.7, §7.1). In a 10 m deep flood, the Manning velocity on the surface slope toward the edge
runs close to critical, so the edge behaves like a waterfall. The model's crest profile steepens toward it. It falls
1.2 m per km above the gauge, 2.7 per km over the last 1.4 km, and stands near 7 m at the edge. The marks show about
1 m per km all the way to East Falls (10.6 m), where the Fairmount pool holds the river up. The error grows downstream
the same way: −0.3 to −1.7 m at the marks around the gauge, about −3 m at the river beside Philly-19, 250 m from the
edge. Philly-19 itself is dry in the model, and its score (−0.65 m) is its ground. The channel estimate and the
roughness may add to the error, but they cannot be separated from the edge in this run. The fix needs a river outlet
that does not draw the water down: an area that reaches the Fairmount pool, or a normal-depth or stage edge for a
river leaving the model. Neither was in this run, and the edge checks did not catch it: they measure flooding at the
edge, not how the water surface slopes toward it. The rerun below adds the stage edge.

**The Wissahickon ponds at its mouth.** Above the 5 m falls at Ridge Avenue, the model's creek peaks at 12.5 m, 1.4 m
over the gauge's crest, and spreads over Ridge Avenue. The DEM there, the falls with the road and its bridge, passes
less water than the creek carried. This was not diagnosed further.

What the run found and fixed:

1. More than 65,535 active tiles froze the solver. The first run's river entries piled up 9.9 km deep, and its books
   were 68 % out at hour 4. Dispatches are now two-dimensional (§2.9).
2. Checkpoints failed. A 4.6M-cell checkpoint is 2.7 GB raw; packing it whole built a Blob the browser could not read
   back, and the desktop app's browser pane dropped single uploads of about 300 MB. The packing now streams, and uploads
   go in 64 MB pieces (§8.6). A failed checkpoint was also retried every step (66 tries in 15 minutes), which slowed the
   run; it now waits its interval.
3. The export depth frames grew without bound: 235 frames of 37 MB, 8.6 GB in the page. Late in the run that left no
   room to allocate a checkpoint. Past 1.5 GB, every other frame now goes and the interval doubles.
4. The Wissahickon gauge was scored against the wrong water. Its nine nearest water cells were mostly the tailwater
   below the falls at 3 m, not the pool at 8 m that it reads. That gave −1.38 m at the crest, when the pool was
   +1.39 m. The same cells set the starting level, 4.25 m over the tailwater, which started East Falls about 0.7M m³
   too full; it drained in the first hour. A gauge now reads the highest flat water surface at or below its reading
   (`gaugeWater` in `src/waterlevels.js`), both for the starting level and in the scorecard.
5. A high-water mark took water from higher ground beside it. Manayunk-5 scored +1.39 m from a pixel 3 m away whose
   water stood at 14.6 m, above a river that crested at 13.2 m there; its own pixel was dry. Marks now take water only
   from ground no higher than their own, plus 30 cm.

**Rerun with the river outlet.** The south edge's 104 river cells held the Philadelphia gauge (01474500, Fairmount
Dam: crest 6.37 m NAVD88 and 3,540 m³/s at 13:30 UTC) carried 6.7 km up the river by the backwater step: 3.49 m at the
start, 9.96 m at the Manayunk crest (12:15) and 10.03 m at Philadelphia's. Books 2.8e-7 after the same 70,320 s, in 6.8 h
of computing. In: river 201.2M m³, rain 1.80M, at the start 1.47M (the gauge pool fix, item 4 above); out: the edge
196.9M, infiltration 0.92M, standing at the end 6.64M.

| Observation | Observed | First run | With the outlet |
|---|---|---|---|
| Manayunk gauge (01473800), crest | 13.01 m, 12:15 UTC | −1.51 m, 23 min early | **−0.80 m** (12.21 m), 7 min early |
| The same 9 river marks | 10.97–13.53 m | −0.31 to −1.85 m, mean −1.29 m | **−0.32 to −1.10 m, mean −0.84 m** |
| 7 of them wet in the model | | mean −1.52 m | **mean −0.94 m** (−0.61 to −1.10) |
| East Falls-1, 20 m from the edge | 10.64 m | +1.82 m (Wissahickon ponding) | **−0.51 m** |
| All 11 scored marks | | bias −0.88 m, RMSE 1.36 m; 8 of 11 flooded right | **bias −0.66 m, RMSE 0.85 m**, none within 15 cm; 9 of 11 flooded right |
| Wissahickon gauge (01474000), its pool, peak | 11.07 m | +1.39 m | +0.93 m |

The drawdown toward the edge is gone: the error no longer grows downstream. Philly-20, 1 km above the edge, went from
−1.85 to −0.82 m, and the wet marks now sit within 0.5 m of one another (−0.61 to −1.10 m) along the 3 km reach. Two
marks are still dry in the model, Manayunk-10 and Philly-19, and score at their ground (−0.32 and −0.66 m).

**The river is still about 0.9 m low, evenly.** Two parts can be told apart:

- **The edge is about 0.5 m low.** East Falls-1, beside the edge, is −0.51 m. The outlet's reach is prismatic: the
  edge's own section, unchanged for 6.7 km, on a level bed, with no bridges or islands (§3.7). The reach down to
  Fairmount has bridges, Peters Island and the bends below East Falls; each holds water back that the step
  leaves out.
- **The rest, about 0.4 m, is in the model.** Above the edge the slope is also low. The channel is the regional
  curve, not a survey (BlueTopo stops at Fairmount Dam), and the roughness comes from land cover; either would do it,
  and this run cannot separate them. The Norristown inflow is not lagged for the 20 km between, which puts the gauge's
  crest early but does not lower it.

Nothing was tuned to the marks. A surveyed channel, or a HEC-RAS reach from East Falls to Fairmount for the edge
level, would be the next test.

What this shows: the solver, checkpoints and books hold for a 4.6M-cell, 19.5-hour river flood, and the scorecard now
reads the right water. The river outlet removes the edge drawdown that put the first run 1.3 m low; the levels are now
0.6–1.1 m low along the whole reach, about half the first run's error. That is not yet a validation of river levels:
for planning, read a Schuylkill-type river's flood levels here as likely low by up to about 1 m.

### 5.9 Street flooding in a combined-sewer area — Forest Hills, Queens, Ida, 1 Sept 2021

The first validation here of street flooding from rain alone, with no river, against observed depths. Run on
4 November 2026 in the app from the *Forest Hills, Queens NY* example.

- **Model.** 3.6 × 5.2 km (Forest Hills, Rego Park, Kew Gardens and the edge of Flushing Meadows), 18.7M 1 m cells, a
  2 m solver (4.7M cells), 30,049 buildings as walls.
- **Drainage.** NYC DEP's 3,785 real catch basins in and around the box (NYC Open Data), 3,631 of them in the model,
  on a synthesized combined sewer (DEP does not publish its pipes): 217 km of pipe, 0.3–2.7 m, to 171 outfalls, sized
  by the rational method for the 10-yr storm. The box is 10 % separate storm sewer by DEP's MS4 drainage areas, so
  combined. Roof downspouts 100 % to the sewer, sanitary flow and CSO regulators on.
- **Rain.** MRMS gauge-corrected, timed by the 2-min radar rate, over an 18 h window from 13:06 UTC on 1 Sept: 135 mm
  over the area, 72 mm of it in the hour from 21:34 local time (2.8 in/hr, above DEP's 10-yr design storm of
  2.13 in/hr and below its 100-yr, 3.66 in/hr). A 2 h tail after the window.
- **Observations.** USGS high-water marks from the STN *2021 Ida* event, *Flash flooding* (mostly heights above
  ground at doors, walls and cars); the USGS depth maps made from 13 of them (`benchmarks/nyc/`); and NYC 311 reports
  from 6 pm on 1 Sept to noon on 2 Sept: 16 *Street Flooding*, 4 flooded catch basins and 89 *Sewer Backup*. A 311
  report sits at the address the caller gave, not at the water, so it is scored against the highest peak depth within
  15 and 30 m, against the same at 3,000 random open cells.

**The run.** 72,000 s in 2.4 h of computing; books 5.7e-5 at the surface, 3.0e-5 with the pipes, nothing added by the
wet / dry clip. Of 2.53M m³ of rain (0.51M of it on roofs, piped to the sewer), the sewer took 1.44M (57 %), the ground
0.37M (14 %), the edges 0.08M; 0.67M (27 %) stood on the ground at the end. The sewer never surcharged onto the
streets (SWMM's flooding: 0), on a night when 311 took 89 sewer-backup calls from the box. The rain QA reads the model low: 135 mm over the area against LaGuardia's 171 mm (6.6 km away) and
Central Park's 179 mm; the 12 gauges within 14 km give a median model / gauge of 0.83 (0.56–2.05; JFK and Wall
Street had 66 mm). MRMS radar alone gave 168 mm; its gauge correction took the area to 135 mm.

**Marks.** 31 marks at 15 sites. Six are not scored. USGS found four of them inside buildings or on a basement door:
*seed line on basement wall of building* (NYQUE31277), *bottom of ramp inside delivery door* (NYQUE31276) and *outside
of basement door* (NYQUE31290). Their levels are below the street, and the model has only the street. The two at
NYQUE31277 had scored +1.56 and +1.59 m: the street water beside a basement. The scorer now skips a mark whose USGS
description puts it inside or in a basement (`INDOORS` in `src/calibrate.js`). The first scoring, with them, was bias
−0.07 m and RMSE 0.73 m over 27 marks.

| Where (height above NAVD88) | Marks | Model − observed | What the marks show |
|---|---|---|---|
| Grand Central Pkwy service road at 62nd Dr, the low end toward Flushing Meadows (3.7–3.8 m) | 5 | −0.62 to −0.83 m, 2 dry in the model | 0.7 m of water on fences and walls |
| Forest Hills' hill, Austin St, Ascan Ave, Continental Ave, Tennis Pl (18.8–25.7 m) | 10 | −0.17 to −0.85 m, mean −0.50 m, 5 dry | 0.4–0.8 m against posts, poles and shop fronts |
| Juno St, Ingram St, 69th Ave (12.0–13.9 m) | 6 | −0.40 to +0.16 m, mean −0.01 m | |
| Alleys to the garages behind 64th Rd and 68th Ave (9.9–10.1 m) | 4 | +0.56, +0.56, +1.26, +1.23 m | 0.2–0.3 m up garage doors and an alley wall, in alleys a few metres wide |
| **All 25 scored** | | **bias −0.20 m, RMSE 0.62 m, MAE 0.52 m; 4 within 15 cm; 18 of 25 flooded** | |

**The USGS depth maps.** USGS mapped 13 of the sites: each mark's level less the lidar ground, within 250 m of it.
Inside those buffers (1.38M open 1 m cells), the map floods 14.3 ha at 4 in and over and the model 23.3 ha. The model
floods 33 % of the map's flooded cells; 80 % of what it floods there the map has dry (CSI 14 %). Where both flood, the
model is 0.37 m shallower (RMSE 0.47 m), and in every 1 ft band most of the map's cells are shallower in the model.
The map is a flat plane at one mark's level carried 250 m over the ground. On Forest Hills' slopes that is not how water
stands, so part of the extent disagreement is the map's. The depth bias agrees with the marks: the model is shallow.

**NYC DEP's maps, against Ida.** Ida's peak hour (2.8 in/hr) lies between DEP's Moderate (2.13 in/hr) and Extreme
(3.66 in/hr) design storms. Counted as DEP counts (4 in and over, patches of 0.25 acre and over, buildings out), the
model floods 136 ha of the box: 5.5 times Moderate's 25 ha and 0.86 times Extreme's 159 ha. In extent, it sits
between them, as the storm does. But the places differ: the model floods 31 % of Moderate's flooded cells and 16 % of
Extreme's (CSI 5 % and 9 %). The like-for-like test is §5.10.

**311 reports.** All 20 street-flooding and catch-basin reports have 10 cm or more within 15 m in the model, and
11 of them 30 cm. But so do 97 % and 46 % of 3,000 random open cells. Of the 89 sewer backups, 40 % have 30 cm within
15 m. In this run the model floods some cell within 15 m of almost everywhere, so a report's address cannot tell
the model right from wrong. The 311 test as built has no power here, and it is not in the scorecard.

**What this shows.** The solver, sewer coupling and books hold for an 18.7M-cell, 20-hour pluvial run with 3,631
inlets. Against observed street depths the model is low: 0.2 m on average over the 25 outdoor marks, 0.5 m on the hill
and 0.7 m at the low end, with 7 of 25 flooded places dry. It also floods different places from both USGS's and
DEP's maps. Nothing was tuned. Two inputs could each explain much of the low bias: the rain, 0.8 of the nearby gauges,
and the sewer. The sewer here is synthesized, sized for a 10-yr storm at 10 min (138 mm/hr) by the rational method,
and it never surcharged. NYC's own was mostly built for about 1.75 in/hr (44 mm/hr) and backed up into basements
across the box, so the model's drains take water the real ones could not.
Pipes sized for the 5-yr storm are the next test (§5.11). For planning in a combined-sewer area like this one, read
the model's street depths as likely low by 0.2–0.7 m in a storm well past the sewer's design, until a run with the
real network or the city's design capacity says otherwise.

### 5.10 Against another model's map — NYC DEP Stormwater Flood Maps

NYC DEP mapped where its *Moderate Stormwater Flood* (2.13 in/hr, at current sea level) puts 4 in and over, with
InfoWorks ICM on its own sewer network (1D) and the surface (2D), and kept patches of 0.25 acre and over. DEP does not
publish the hyetograph or the network. The FloodSim run gives the same box a constant 55 mm/hr for 1 h (the input's
nearest step to 54.1 mm/hr) with a 2 h tail, at 2 m, the drainage as in §5.9, and scores it against DEP's map the way
DEP drew it (`benchmarks/validation`, case *forest-hills-dep-moderate*). Two models of one design storm: agreement
would not make either right, and disagreement says where they differ, not which is wrong.

**Result** (run 2026-11-04_185733, 0.48 h of compute for 3 h simulated). FloodSim floods 3.7 times the area DEP maps,
yet only 15 % of DEP's flooded cells (CSI 3 %; 96 % of the cells FloodSim floods, DEP does not). The two models put the
water in different places, not just in different amounts. DEP keeps only patches of a quarter acre and over where its
real sewer surcharges, so its map is the low points its pipes cannot drain. FloodSim's synthetic sewer drains the
streets evenly, so 4 in collects in every dip on a 2 m grid. Against Ida (§5.9) FloodSim reads low at the marks, and
here it floods widely: both point at the drainage, which is synthetic here, rather than at the surface model. A case
with a real sewer is §5.12.

### 5.11 The validation suite and its uncertainty bands

`node tools/validate.mjs` scores every case in `benchmarks/validation/cases.json` from the latest finished run filed
in its project. It uses the same scorecard as the app (`src/validate.js`), adds each score to
`benchmarks/validation/history.json`, and rewrites `benchmarks/validation/README.md`: the latest score of each case,
the change from the run before, and each case's history. `--run` runs every case again headless first
(`tools/batch.mjs`, one job of the project's storm as set), so a release can be held to the one before it. A case's
project is installed from `benchmarks/validation/<case>/project.json` when the projects folder lacks it.

- **Cases.** Manayunk (§5.8), Forest Hills under Ida (§5.9) and its band (below), Forest Hills against DEP's
  Moderate map (§5.10, a comparison only), and Edwards Branch in Charlotte with the city's own storm sewer (§5.12).
- **History so far.** The two Manayunk runs: marks RMSE 1.36 → 0.85 m and the Manayunk gauge −1.51 → −0.80 m with the
  river outlet. Their marks were scored in the app after each run was filed, before scores added after a run went into
  its `summary.json` (they do now); the history says so.
- **Uncertainty bands** (`src/uncertainty.js`). `--run --ensemble` adds the batch variants (roughness × 0.8 and × 1.2,
  infiltration × 0.5, one cell size coarser), and `--variants-only` runs them beside a base run made by hand. At each
  mark the band runs from the lowest to the highest level the runs give. The history keeps how many marks fall inside
  it, its mean width, and the mean shift each variant makes. The report's Sensitivity section has the same table per
  mark, and the flood-map scores' range across the runs. A mark inside the band is one the model reaches with
  plausible inputs. A mark outside it points at something no variant moves: the channel, an edge, the rain, the ground
  model. With one input changed at a time and four or five runs, this is a sensitivity band, not a probability.
  `tests/run-uncertainty-tests.mjs` checks marks inside, above and below a band, the variant that moves the levels
  most, marks a member did not score, and the map-score ranges.
- **The first band: Forest Hills under Ida** (case *forest-hills-ida-band*, 4 m speed mode, 5 runs, 1.9 h). Base run:
  marks RMSE 0.67 m, bias −0.15 m (25 marks). Only 1 of 25 marks falls inside the band. The band is 0.16 m wide on
  average (0.72 m at most), and no variant moves the levels much: one cell size coarser +0.04 m, infiltration × 0.5
  +0.03 m, roughness ± 20 % under 0.01 m. The map scores hardly move either (CSI against the USGS map 12–13 %). So
  plausible changes to roughness, soil and grid do not reach the marks. What is left is what the variants hold fixed:
  the rain (0.8 of the nearby gauges, §5.9) and the drainage (a synthetic sewer sized for the 10-year storm that never
  surcharged). Roughness hardly matters here because in a pluvial flood the water stands in low spots and its level is
  set by volume, not by how fast it flows.

### 5.12 Real storm sewers — Edwards Branch, Charlotte NC, 12 June 2025

The first case where the drainage is the city's own network rather than one FloodSim builds (case *edwards-branch-clt*).
Edwards Branch drains 2.5 km² of east Charlotte (USGS StreamStats; NWIS gives 1.03 mi²) to USGS 0214643820 at
Sheffield Drive, which set its record on 12 June 2025: 9.90 ft on a datum of 685.18 ft NAVD88 (211.86 m) and
2,560 cfs at 8:50 pm EDT. The stage rose 7.8 ft in 50 minutes.

- **Area.** The watershed's box with 120 m beyond the gauge to the west, so the creek leaves across a free-outfall
  edge below the gauge rather than at it. 2 m.
- **Drainage.** The City of Charlotte's storm pipes, inlets and outfalls, linked live
  (`gis.charlottenc.gov/arcgis/rest/services/STM`): 1,738 pipes with surveyed inverts (`US_INVERT` / `DS_INVERT`, feet
  NAVD88, on over 90 % of pipes) and sizes (`PACP_Height`, inches; 1,447 circular, 9 box), 1,319 inlets (catch basins
  and drop inlets: `STRUCT_TYPE` CB, DCB, DI, CI, slab and elongated-throat inlets) and 129 outfalls (endwalls and
  flared end sections). The model keeps 1,161 inlets on 40.6 km of pipe. Reading this layer needed three fixes to the
  field detection (`src/linked.js`): an invert field by name wins over a rim elevation (`US_ELEV`), a `*_Height` field
  is a size, and a field named `Active` keeps the pipes whose value is 1. The data is CC BY-NC-SA 4.0: free for
  validation, not for a commercial product.
- **Rain.** NOAA MRMS radar, gauge-corrected hourly totals timed by the 2-minute rate: 77 mm over the area in 28 hours
  of radar, 45 mm in the peak hour (about the 2.6-year hour at the site, Atlas 14). The radar alone gives 92 mm.
- **Scored on** the gauge's peak level and its time (§5.11's scorecard). No USGS high-water marks were filed for this
  storm.

**First run** (2026-11-04_215715, 1.07 h of compute for 25.6 h simulated). The model starts at the gauge's own level
(209.07 m against 209.07 m) and peaks 14 minutes early, but it rises 0.61 m where the creek rose 2.79 m: the peak is
2.18 m low. The books show why. Of 329,000 m³ of rain, 203,000 m³ soaked in (62 %), 134,000 m³ went into the pipes'
outfalls (with 40,000 m³ of roof water piped in directly), and 24,700 m³ went down the creek past the gauge. Over the
same hours USGS measured about 220,000 m³ past the gauge. Until then a pipe outfall took its water out of the model
wherever it was: right on the edge, wrong here, where every endwall empties into Edwards Branch above the gauge. Outfalls
the outfall layer places inside the area (and synthetic ones into a mapped stream) now put their water back on the
ground at their cell (`src/coupler.js`, `src/drainage.js` `outfallCells`; `tests/run-coupler-tests.mjs`). The second
suspect is the soil: 62 % infiltrated is a lot for an urban watershed whose gauge passed about two-thirds of the rain.

**Second run** (2026-11-04_230914): unchanged, 2.18 m low, and no water returned. The linked-pipes branch of the network
build never handed the outfall layer to `realNetwork`, so no endwall was placed. Fixed (`app/map.js` `makeNetwork`):
77 of the 112 endwalls and flared ends in the box lie within the 5 m snap of a pipe end. The other interior pipe ends
(about 290) now return their water too, in a separate storm sewer like this one: an end the outfall layer missed is
still a discharge, almost always into the creek. In a combined sewer such an end may be a gap on the way to the
interceptor, so it still takes its water away (`openEnd`, `src/network-real.js`; `tests/run-infra-tests.mjs`).

**Third run** (2026-11-05_000408, with the outfall layer): 1.49 m low (210.37 m against 211.86 m), and the peak now
comes at the gauge's minute. The outfalls took 85,600 m³ and gave 64,700 m³ back to the ground. The water past the
gauge went from 24,700 m³ to 61,700 m³. The surface books, though, came out 1.2 % short: 4,070 m³ of the returned
water never arrived. Two exchange points shared cells. The endwalls sit at culvert ends, the returns avoided inlet cells
but not culvert cells, and the exchange kernel runs one thread per point, so where two share a cell one write is lost
and both are booked. Returns now keep off culvert cells, and the run log warns if any exchange points share a cell.

**How much water there was to find.** The gauge's discharge record gives 224,000 m³ past Sheffield Drive in the model's
25.6 hours, nearly all storm runoff (baseflow 0.06 cfs). That is 110–120 % of the radar rain on the watershed (77 mm on
2.5–2.7 km² is 193,000–205,000 m³). So even with no infiltration the model could not match the gauge on this rain. Two
things can explain it: the rain was heavier over the watershed than the gauge-corrected radar says (the radar alone
gives 92 mm, and the correcting gauges are far from the storm), or the storm sewers bring in water from beyond the
topographic divide, which is common in cities. Either way, the 63 % the model soaks in is too much, but it is not the
whole gap. Next: the run on radar-only rain, Mecklenburg County's own rain gauges (a dense network), and the area the
pipes actually drain to the gauge.

**Fourth run** (2026-11-05_005525, returns off the culvert cells): the surface books close again (+0.005 %; combined
−0.35 %), and the gauge reads 1.39 m low (210.47 m against 211.86 m), peaking 2 minutes early. 64,900 m³ came back
from the outfalls and 65,700 m³ went past the gauge, against the 224,000 m³ USGS measured. The drainage now does what
it should, so what remains is the water put in (the rain) and taken out (infiltration, 206,000 m³).

**Radar-only rain** (project "Edwards Branch Charlotte 2025 radar-only", run 2026-11-05_083228; the new Rainfall choice
"Radar only, MRMS not adjusted to gauges"). 92 mm over the area in place of 77 mm, 52 mm in the peak hour in place of
45 mm: 20 % more water (395,000 m³). The gauge reads 1.10 m low (210.76 m), peaking 6 minutes early. 94,700 m³ went
past it (USGS: 224,000 m³), 58 % soaked in, and the books close (−0.001 %; combined −0.29 %).

**What a rain gauge in the watershed saw.** USGS and Charlotte-Mecklenburg run a dense network of tipping-bucket gauges
(NWIS parameter 00045). CRN-47 at Winterfield Elementary, 0.4 km from the middle of the watershed, caught 111 mm, 71 mm
of it in one hour: about the 20-year hour here (Atlas 14), against the 2.6-year (gauge-corrected) and 5-year
(radar-only) hours the model was given. The storm was patchy. The 16 other gauges within 10 km caught 41–112 mm (peak
hours 18–83 mm), so a gauge correction 5 km off the cell can as easily pull the radar down as up. At 111 mm on 2.5–2.7 km² the
creek's 224,000 m³ is a runoff ratio of 75–80 %, plausible for a paved watershed in a cloudburst.

That paragraph set the gauge against the area's mean. Set against the radar at its own pixel over the model's hours,
CRN-47 caught 106 mm where the radar had 88 mm, 20 % more. The real difference is the wettest hour: 71 mm at the
gauge, 42 mm in the radar there. The radar's storm total was nearly right. It read the cloudburst core 40 % low, and a
2.5 km² paved watershed floods on its peak intensity. So the rain explains part of the gap, through the peak hour more
than the total. The infiltration (58–63 % of the rain) and the area the pipes drain to the gauge remain open.

**The radar fitted to the gauges** (`src/raingauge.js`, §3.6). The 27 USGS gauges within 10 km all pass the record
checks. Fitted on storm totals, no smoothing predicts a left-out gauge better than the radar does (5.1–5.3 mm RMS per
gauge-hour against 5.1): the gauges are 3–5 km apart and this storm's cells were smaller. Fitted hour by hour with
d0 = 1 km, the error falls to 3.8 mm, so that fit is kept. Over the model area the storm total barely moves (89 to
90 mm, radar-only base), but the wettest hour goes from 48 to 60 mm. The gauges' own leave-one-out also shows the
limit: from the other gauges alone, CRN-47's wettest hour is predicted at 41 mm. A cell as small as this one is found
only by a gauge inside it.

**Run on the fitted rain** (project "Edwards Branch Charlotte 2025 gauge-fit", run 2026-11-05_094828, commit dd23fa4).
The run's own fit record: 27 gauges, hourly, d0 = 1 km, leave-one-out 3.6 mm per gauge-hour against the radar's 4.8.
94 mm over the model area (radar alone 92 mm), and the wettest hour 62 mm, about the 14-year hour. The gauge reads
0.87 m low (210.99 m against 211.86 m), peaking 6 minutes early: 0.23 m closer than radar-only, and 1.31 m closer
than the first run. 112,000 m³ left over the outlet edge (USGS: 224,000 m³ past the gauge), 53 % of the rain soaked in,
and the combined books close to −0.31 %. Fitting the rain to the gauges closed a fifth of what radar-only left. The
rest is still the cloudburst core no gauge but CRN-47 saw, the infiltration and the piped drainage area. The split-sample
calibration study (§6.4) uses this rain. With infiltration × 0.25, the value it kept, the gauge reads 0.68 m low here,
0.99 m low in January 2024 and 0.17 m low in August 2023.

**Combined-sewer mode was on in every run above** (found 7 November 2026). The three Charlotte case files carried
*Combined sewer area* ticked and downspouts at 100 % to the sewer, although Charlotte's storm sewers are separate (the
city's data says so, and a saved project's settings override what the build reads from the data). So every run added
sanitary flow, sent pipe flow to an interceptor that leaves the model, and, worst, let the interior pipe ends the
outfall layer missed take their water out of the model (the `openEnd` rule above). On 12 June 2025, with infiltration
× 0.1 and roughness × 0.6, about 115,000 m³ was lost that way, and the gauge saw under half the flow. The case files
now have it off and downspouts at 0 % (commit c99d92c). The app warns when combined-sewer treatment is on in an area
whose drainage data shows separate sewers (`app/map.js` `csoSetup`). The study tools replace an installed case project
whose settings differ from the case file (`tools/suite.mjs` `installCase`, commit d6f02cc). They also start a study
afresh when the project's settings have changed since it began, and set aside a checkpoint an earlier study left
(commit 62fbcc0: the January 2024 rerun first resumed a combined-sewer checkpoint). The level errors above, and the
first two studies in §6.4, are of the combined-sewer model. With separate sewers and infiltration × 0.25, June 2025
reads 0.48 m low (it was 0.68 m), and the flow past the gauge is 53 % of USGS's volume (§6.4, third study).

### 5.13 Earlier observation comparisons recorded in the README

These are recorded in the README as development history. A reviewer should treat them as partial validation:

- **Ida 2021 at Fairmount Dam (Schuylkill, 1.7 × 2.3 km at 2 m).** Gauge-corrected MRMS rain, recorded inflow, gauge
  start levels and BlueTopo bed below the dam. Both USGS gauges track within about 0.15 m from base flow to hour 15. At
  the crest Fairmount is +0.27 m and 30th Street +0.13 m (22 min early). The five high-water marks give four of five
  flooded, bias +0.32 m and RMSE 1.16 m. The three marks in the pool above the dam read +0.55 to +1.44 m high, growing
  toward the inflow edge, where the pool channel is still estimated. The README notes that the gauge-corrected rain over
  the area (53 mm) is well under radar-only (91 mm) and the gridded record (86 mm), and that this is not yet explained.
  The result depended strongly on bathymetry: lidar alone ran 1.6–1.9 m high, and the regional-curve channel was far
  too small in the tidal reach.
- **Rain QA, Ida at 30th Street**: 11 of 12 gauges scored, median model/gauge 1.15 (0.73–1.99), nearest gauge 1.00.
- **Ellicott City, 30 July 2016, MRMS**: 164 mm over the area in about 4 h against NWS-reported about 6.6 in (168 mm).
  This is a rainfall check, not a flood-depth validation.

### 5.14 Test suites

`npm test` (`tests/run-all.mjs`) runs every CPU suite offline: `tests/run-tests.mjs` and each
`tests/run-*-tests.mjs` except the GPU runners, 38 suites in all. The GPU suite (`npm run test:gpu`,
`tests/gpu-suite.js` in headless Chrome/Edge on the machine's GPU) is separate and writes `tests/results-gpu.json`.
Suites with `--live` also hit the real services; the default runs use recorded responses and fixtures. All 38 CPU suites
passed when this document was written (`node tests/run-all.mjs`). The GPU suite passed on 3 November 2026, with its
new 2,112 × 2,112 many-tiles case (§2.9).

| Suite | Verifies |
|---|---|
| `run-tests.mjs` | CPU solver: dam breaks, lake at rest, Thacker, rain mass balance; fails on regression in accuracy, convergence or mass |
| `run-phase1-tests.mjs` | Geodesy, terrain, roof routing, downscaling, exports, outflow BC, Atlas 14 storms, historic storms |
| `run-phase2-tests.mjs` | Weir and culvert hydraulics, conservative culvert links, thalweg snapping, channel breaching (road embankments, full-width humps), bank stations, SWMM river |
| `run-swmm-tests.mjs` | SWMM WebAssembly engine on the Eastwick network: lateral inflow, stride, heads, overflow, continuity |
| `run-inlettypes-tests.mjs` | Kinds of inlet by type: Charlotte type codes, the North Carolina outline, NCDOT values, picks, type field detection, grates of different kinds merged on one cell (weir and orifice sums), the kinds carried through both network builders and the coupler, no change without kinds |
| `run-infra-tests.mjs` | Infrastructure layer: capacity, estimate round trip, storage in SWMM, shapefile/zip import |
| `run-barrier-tests.mjs` | Flood barriers: watertight faces, at-rest balance, weir overflow, deployment, books |
| `run-hazard-tests.mjs` | Hazard classes (ARR 2019, FD2320), force per width, same-moment classification, duration, arrival |
| `run-lts-tests.mjs` | Local time stepping vs global (CPU fp64): dam breaks, still water, deep channel + floodplain |
| `run-subgrid-tests.mjs` | Subgrid tables: storage, conveyance, curbs, porosity, level ↔ volume |
| `run-watershed-tests.mjs` | Depression filling, D8, upstream trace, outlines, rivers from off the DEM |
| `run-calibrate-tests.mjs` | Observation import, run scoring, marks under a deck or indoors not scored, sweep plan |
| `run-inflow-tests.mjs` | LP3, hydrographs, river entries, inflow books, STN marks (datums, names with their site, where found) |
| `run-streamstats-tests.mjs` | StreamStats replies, snapping retry, 90 % intervals, NRCS lag and unit hydrograph, report |
| `run-soil-tests.mjs` | Texture classes, SSURGO rows, ponded Green-Ampt vs analytic, water table, aggregation, grain classes |
| `run-waterlevel-tests.mjs` | River rise, lake fill, spreading onto connected ground only, datum rules, NGVD29 shift, weir and bridge-deck cases |
| `run-outlet-tests.mjs` | River outlet: backwater rise against the gradually-varied-flow solution, edge side, a channel cut off halfway holding the full river's level (a free outfall draws it down); the reach through cross-sections: normal depth, a widening reach against a hand step, a choke at critical depth, sections cut from a ground model |
| `run-bathymetry-tests.mjs` | Regional curves, flattened surface, carved section, GeoTIFF, surveyed bed |
| `run-hecras-tests.mjs` | GeoTIFF and shapefile round trips, `.g01` parsing, bed between sections, the 2D package |
| `run-bank-tests.mjs` | Friction-angle failure, cohesion, confinement, rapid drawdown, probability vs Monte Carlo |
| `run-design-tests.mjs` | Distance transform, grading (daylighting at 3:1 / 2:1, cut/fill vs analytic frustum within 0.3 %), FFE rules, no features → bit-identical inputs |
| `run-stormwater-tests.mjs` | Outlet rating, stage–storage, modified Puls vs analytic drawdowns (3e-5 m), ponds, swales, GI, detention check |
| `run-compare-tests.mjs` | Forcing fingerprint (stable, names differences, ignores design), settings tests (accepted only with the same design; old hashes kept), republished utility data refused and named, `.f32` grids, Δ maps, off-site impact, tables |
| `run-report-tests.mjs` | Hydrograph stats, profiles, HGL path and flags, stage–storage–discharge, gutter spread, charts |
| `run-damage-tests.mjs` | USACE curves, water against walls (rowhouses, sheet flow, enclosed yards), EAD, BCA, area stats |
| `run-checks-tests.mjs` | Edge distance and flooding by side, points near the edge, run against run, sensitivity, statuses, difference map |
| `run-validate-tests.mjs` | Gauge peaks and timing, the whole hydrograph (NSE, KGE, volume, peak, lag; only the hours both cover), flow lines in the scorecard, STN event matching, statuses and verdict, gauge levels in NAVD88, flood-map lines (another model's map not in the verdict) |
| `run-floodmap-tests.mjs` | Flood maps: polygons onto cells (holes, clipping), the 0.25-acre floor, hits / misses / false alarms, CSI, depth bands and error, masks, buildings left out, DEP classes, empty polygons skipped |
| `run-uncertainty-tests.mjs` | Marks against the variants' band (inside, above, below), the variant that moves them most, unscored marks left out, flood-map score ranges |
| `run-rainqa-tests.mjs` | Gauge reading hours across DST, ASOS hours and CoCoRaHS reports in the storm window, scoring rules, Ida at PHL |
| `run-fema-tests.mjs` | NFHL zone codes, BFE between lines, zone and BFE grids |
| `run-compound-tests.mjs` | Datums, SLR to the epoch, design tides, GEV, Kendall's τ, Gumbel copula, isolines, design pairs |
| `run-cso-tests.mjs` | Dry-weather flow vs its pattern, regulator split, flap gate, overflow events, people per manhole |
| `run-checkpoint-tests.mjs` | State capture by path, packing, a SWMM run copied half way (same 255,600 heads, same continuity) |
| `run-emulator-tests.mjs` | Latin hypercube, GP, closed-form LOO vs refitting (2e-10), PCA, synthetic floods, Atlas 14 between columns |
| `run-window-tests.mjs` | Window, edge segments, inflow rates, edge check, merging |
| `run-radar-tests.mjs`, `run-mrms-tests.mjs`, `run-nowcast-tests.mjs` | Radar overlay frames; MRMS PNG/GRIB2 decoding, gauge-corrected totals, timing; storm motion and advection; the nowcast ensemble (members, band, arrival order) and rolling new frames in |
| `run-hrrr-tests.mjs` | HRRR GRIB2 decoding (packing 5.0, 5.2 with missing values, 5.3 of order 1 and 2), the Lambert projection against NCEP's grid corners, `.idx` byte ranges, the run chosen live, for a replay and pinned, regridding, the 60–90 min crossfade in a live build and on rolling forward (`--live`: Ida's 15-minute fields against its hourly one) |

### 5.15 What has not been validated

- **Street flooding from rain** has one observed case, Forest Hills under Ida (§5.9), and it is not passed: the
  model is 0.2 m low on average over 25 outdoor marks (0.5–0.7 m on the hill and at the low end), and it floods
  different places from USGS's and DEP's maps. Its sewer is synthesized and its rain is 0.8 of the nearby gauges;
  neither has been replaced by the real thing. Marks indoors or in basements cannot be compared at all. The Davis
  comparison is model to model; Ida at South Street (§5.6) and Portland (§5.7) have no observed street depths.
- **River levels.** Manayunk (§5.8) was 1.3 m low against 9 river marks and its gauge from the free-outfall edge.
  With the river outlet it is 0.84 m low against those marks (RMSE 0.85 m over all 11) and −0.80 m at the gauge,
  evenly along the reach: about 0.5 m from the outlet's prismatic reach and the rest from the estimated channel or
  roughness. River levels are not yet validated.
- **EA Tests 8A/8B** (urban rain with a surcharging sewer) have not been run: the specification is public but the input files are not (`benchmarks/ea/TEST8.md`, with a request to the EA drafted). Where the model stands against FEMA's acceptance criteria: `docs/ACCEPTANCE.md`.
- **No observed pipe flows or pipe levels** have been compared (the Bellinge dataset is proposed).
- **Synthetic sewer networks** have not been compared with real networks for the same area.
- **Damage and EAD** have not been compared with claims or observed losses.
- **Sediment, debris flow, bank collapse and scour** have no field validation.
- **The emulator** is validated only against the solver, never against observations.

---

## 6. Model checks a reviewer should look at

### 6.1 The model-checks table (`src/checks.js` `checkList`)

Each row is marked OK, Check, Problem, Not tested (n/a) or info. Thresholds are `LIMITS` (`src/checks.js` lines
122–131). For "lower is worse" rows the order is reversed.

| Group | Check | Metric | OK if | Check if | Problem if | What a fail means |
|---|---|---|---|---|---|---|
| Model edge | Flooding within 50 m of the edge | Flooded area (≥ 15 cm) within 50 m of the edge ÷ all flooded | ≤ 5 % | ≤ 20 % | > 20 % | The edge is a free outfall: water there may leave where it would have pooled, or be fed from ground beyond the edge. Move or widen the area. |
| Model edge | Edge flooded ≥ 15 cm | Edge length with max depth ≥ 15 cm ÷ edge length, by side | ≤ 2 % | ≤ 10 % | > 10 % | The flood may continue past the edge; its extent and depth beyond are not modelled. Expected on tidal-stage edges (the table says so). |
| Model edge | Water out across the edge | Edge outflow ÷ water in (rain + river inflow) | ≤ 5 % | ≤ 25 % | > 25 % | The area cuts across a flow path; water leaves without being routed further. |
| Inflow | Ground outside that drains in | Traced upstream area outside the model ÷ model area (0 if run on the watershed) | ≤ 2 % | ≤ 25 % | > 25 % | Runoff from outside is missing: flooding is understated. n/a if the watershed was not traced. |
| Inflow | A river enters from a large basin | Whether an inflow (gauged or StreamStats) is set | inflow set | — | no inflow | The river's flow is absent. |
| Mass balance | Surface water books | \|surface error\| (relative) | ≤ 1e-4 | ≤ 1e-3 | > 1e-3 | Books should be at round-off; a large value means a numerical or bookkeeping fault. |
| Mass balance | Surface and sewer books | \|combined error\| | ≤ 1 % | ≤ 5 % | > 5 % | As above with pipe storage and outfalls; dominated by SWMM's own continuity. |
| Run length | Water left at the end | Final ÷ peak water volume | ≤ 50 % | ≤ 80 % | > 80 % | The run may have stopped before the flood peaked or drained; run longer. Ponds legitimately hold water. |
| Run length | Run past the end of the rain | Run stop − storm end | ≥ 30 min | ≥ 15 min | < 15 min | Downstream peaks come after the rain (the default tail is 30 min, `app/map.html` `tail`). A large area or a river needs longer: the *water left at the end* row says whether the run got past the peak. |
| Observations | High-water marks near the edge | Marks within 50 m of the edge | none | any | — | A mark near the edge tests the boundary as much as the model. |
| Design | Drawn features near the edge | Feature vertices within 50 m | none | any | — | The feature's effect is cut off at the edge; widen the area. |
| Sensitivity | One cell size coarser: overlap | Fit = cells flooded in both ÷ flooded in either | ≥ 0.90 | ≥ 0.75 | < 0.75 | Results depend on the cell size (not grid-converged). |
| Sensitivity | One cell size coarser: depth change | 95th percentile \|Δ peak depth\| | ≤ 0.05 m | ≤ 0.15 m | > 0.15 m | As above. |
| Sensitivity | Other variants | Δ area, Δ damage, p95 \|Δ depth\| | info | — | — | Report the spread with the results. |
| Sensitivity | Base and variants from one FloodSim version | Commits differ | — | differ | — | A code change is mixed into the differences; rerun together. |
| Sensitivity | Sensitivity runs | None saved | n/a | — | — | No sensitivity evidence for this run. |

Notes on reading the table:

- Distance to the edge is a chamfer distance (`edgeDistance`), so the edge of a polygon area counts as edge.
- The README's South Street example (2 m, 10-yr 1-h) flags 46 % of the flooding within 50 m of the edge (Problem) and
  8 ha of ground draining in from outside, 36 % of the area (Problem). Real cases can and do fail these checks, and a
  failing row should be resolved or explained, not ignored.
- The mass-balance marks are the validation scorecard's (`LIMITS` takes them from `TARGETS`, §6.2), so the two tables
  grade a run the same way. The Gate C criteria (§2.13: surface ≤ 1e-5, combined ≤ 0.5 %) are stricter release gates
  for the code, not for a single run.
- The water-balance table in the report's Summary lists every term of these books (rain on the ground, roof rain piped
  to the sewers, sanitary flow, river inflow, water at the start, pipe storage, outfalls) with the total in and the
  balance, so a reviewer can close it by hand.

### 6.2 Validation scorecard (`src/validate.js` `TARGETS`)

For runs of real storms (historic or live). The targets are FloodSim's defaults for an urban model at 1 m, not a
published standard, and a reviewer can apply others:

| Line | Good | Fair | Otherwise |
|---|---|---|---|
| High-water mark level RMSE | ≤ 0.15 m | ≤ 0.30 m | poor |
| High-water mark bias (either sign) | ≤ 0.10 m | ≤ 0.20 m | poor |
| Flooded marks the model floods | ≥ 80 % | ≥ 60 % | poor |
| USGS gauge peak water level | ± 0.15 m | ± 0.30 m | poor |
| Time of that peak | ± 30 min | ± 60 min | poor |
| Surface mass balance | ≤ 1e-4 | ≤ 1e-3 | poor |
| With the pipes | ≤ 1 % | ≤ 5 % | poor |
| Water added by the wet/dry clip, ÷ rain | ≤ 1e-6 | ≤ 1e-4 | poor |
| Rain against another source, \|ratio − 1\| | ≤ 0.15 | ≤ 0.30 | poor |

The verdict comes from the observations alone; books that do not close make it poor outright. Scoring rules:

- A mark is compared with the highest modelled water surface within 3 m, on ground no higher than the mark's own
  (+30 cm): water on a wall top or a steeper street beside it is not the water that reached it. A mark left dry
  scores against its ground.
- A level mark more than 1 m below the lidar ground (under a bridge or deck) is not scored.
- The model's level at a gauge is the median water surface of the 9 nearest mapped open-water cells (within 60 m) at
  least 10 cm deep, every simulated minute, on the water body the gauge's first reading is on: the highest flat water
  surface at or below that reading (a pool above a dam, not the tailwater beside it).
- A peak the run cut off (still rising at the end) is not scored for timing. Marks record the crest, so a run that
  stops early reads low.

### 6.3 Sensitivity study (`src/batch.js`, `src/checks.js` `sensitivity`)

**Variants** (`VARIANTS` in `src/batch.js`), each run as an ordinary saved run in a batch study:

| Key | Variant | Input changed | Relative step used in the elasticity |
|---|---|---|---|
| `base` | As set | — | — |
| `n-20` | Roughness × 0.8 | `calManning` = 0.8 (all n) | −0.2 |
| `n+20` | Roughness × 1.2 | `calManning` = 1.2 | +0.2 |
| `infil-50` | Infiltration × 0.5 | `calInfil` = 0.5 | −0.5 |
| `rain+10` | Rain + 10 % (design storms) | `uplift` = 10 (climate uplift on depths) | +0.1 |
| `coarse` | One cell size coarser | solver cell size one step up | none (grid test) |

There are also SLR variants (Intermediate 2050 and 2100, Intermediate-High 2100, High 2100) supplied by the app
(`extraVariants`). Jobs run storm by storm, existing conditions first, so with/without pairs finish together.

**Metrics** for each variant against the base, over cells flooded (≥ 15 cm) in either run (`compareDepths`):

- fit = both ÷ either;
- mean, mean absolute and 95th-percentile absolute change in peak depth;
- largest rise and fall, and the share changed by more than 10 cm;
- changes in flooded area, volume, damage and buildings with water above the floor;
- a difference map (red deeper, blue shallower, grey within ±3 cm).

**Elasticity** is (Δoutput/output) ÷ (Δinput/input) (`elasticity`), for flooded area and damage:

- **|e| ≪ 1**: the result is insensitive to that input, so uncertainty in the input matters little. Example from the
  README: roughness × 1.2 gave area elasticity −0.02.
- **|e| ≈ 1**: the result scales roughly in proportion to the input.
- **|e| > 1**: the result amplifies the input's uncertainty. The README's South Street rain + 10 % gave area elasticity
  1.36: a 10 % rainfall error gives about a 14 % flooded-area error.
- The sign gives the direction: e.g. more roughness → slightly less area.
- An elasticity from a single ±step is a finite-difference estimate at one point. It can be non-linear, and is NaN when
  the base value is zero.

**Grid convergence.** The `coarse` variant is the grid-convergence test: fit below 0.9, or a p95 depth change above
5 cm, flags the run. In the README's South Street study, 4 m against 2 m gave fit 0.41 and p95 32 cm. The README
concludes that on rowhouse blocks with 3–4 m alleys neither 4 m nor 2 m resolves the flow paths, which is why 1 m is
the default. A 1 m run's coarse variant is a 2 m run, so this test shows whether 1 m is converged relative to 2 m; it
does not show convergence below 1 m, which the data cannot support.

Caveats (from the code):

- **`rain+10` sets `uplift` to 10** rather than adding 10 % to any uplift already set. With a non-zero base uplift, the
  variant's real step is not +10 % and the reported elasticity is wrong.
- **Uplift is applied only to design storms** (the Atlas 14 and site-record paths in `app/map.js` `stormBase`), so
  `rain+10` is `designOnly`: `expandJobs` does not run it on a historic, live or custom storm, where it would equal
  the base and read as zero sensitivity. A rain sensitivity for a historic storm needs a second rain source instead
  (radar against gauge-blend; §3.6).
- **Roughness variants scale all n**, including streets and channels. Infiltration × 0.5 scales the capacity (constant
  or Green-Ampt K-based) everywhere.
- **Sensitivity rows are informational.** Only the grid test has pass marks.

### 6.4 Calibration and split-sample validation (`tools/calibrate.mjs`)

FEMA's two-dimensional guidance (Guidance Document 81, Nov 2023, §3.4 and §4) asks that 2D roughness be "validated
through calibration" against historic floods. The usual bar for a mapping model is levels within 0.5 ft (0.15 m) of
the high-water marks. A model tuned and scored on the same storm shows only that it can be fitted, so FloodSim
calibrates by split sample:

1. **Tune.** The calibration case's project is copied to "<project> (calibration)" with any study-wide inputs
   (`--set`, e.g. the rain source), so the sweep never mixes with the suite's own runs. Every combination of the
   `--vary` values runs headless (`--headed` shows the app's window while it runs). The knobs are the app's
   Calibration inputs: `calManning` (all n ×), `calInfil` (infiltration capacity ×, 0.1–2) and `calClog` (inlet
   clogging).
2. **Score.** Each run is scored by every level error its summary holds: each high-water mark scored (marks under
   decks or indoors are skipped, §6.2) and each gauge's peak level, model − observed (`tools/suite.mjs`
   `levelErrors`). Where the case draws a control line at a gauge (a line whose `gauge` property is the USGS site, in
   the case's `analysis.geojson`), the run also records the flow across it, and the scorecard sets it against the
   gauge's discharge record (NWIS 00060) over the whole storm (`src/validate.js` `hydrographScore`): the volume and the
   peak flow (model / observed), Nash–Sutcliffe efficiency, Kling–Gupta efficiency (correlation, spread and mean
   ratio), the peak's lag, and the Nash–Sutcliffe of the level record. The run also records the deepest water at each
   end of every control line (`endDepthM`), and the scorecard rates a gauge line's wetter end (under 2 cm good, 5 cm
   fair): water at an end means flow could pass around the line uncounted, and the flow scores would read low. The scorecard rates NSE ≥ 0.65 good and ≥ 0.5
   fair, and volume within 15 % good and 25 % fair (Moriasi et al. 2007 and 2015, for streamflow). The objective picks
   the values kept: the smallest level RMS (`--objective level`, the default) or the highest flow KGE
   (`--objective flow`). KGE scores the timing, the shape and the volume of the whole hydrograph, so it can tell
   apart two changes that raise the peak level by the same amount: more water (less infiltration) and slower water
   (more roughness).
3. **Freeze and test.** Each validation case (storms the tuning never saw, at the same site) runs twice, as set and
   with the kept values, and both are scored the same way.
4. **Record.** The study goes in `benchmarks/validation/calibration.json`, and `benchmarks/validation/CALIBRATION.md`
   lists the sweep, the values kept and the validation storms against the target. A study with no validation storm is
   labelled a fit, not a calibration.

The knobs are physical and the same everywhere (all n, all infiltration). The forcing is not tuned: rain is an input
to get right (§3.6), not a parameter to fit. A tuned value that does not carry over to the other storms, for example
infiltration tuned in summer and tested on a winter storm on wet ground, is a finding about the model's soil
physics, not a calibration.

**First study: Charlotte, infiltration only** (2026-11-06, commit 7fa115d, gauge-fitted radar `histSrc = radarFit`
on every run; `benchmarks/validation/CALIBRATION.md`). Tuned on 12 June 2025 (§5.12), scored on 9 January 2024 and
10 August 2023 at the same USGS gauge (0214643820). Each storm has one level error, the gauge's peak, so its RMS is
the size of that error.

| Storm | Infiltration × 1 (as set) | × 0.5 | × 0.25 (kept) |
|---|---|---|---|
| 12 June 2025 (tuning) | −0.87 m | −0.73 m | **−0.68 m** |
| 9 January 2024 (never seen) | −1.36 m | | **−0.99 m** |
| 10 August 2023 (never seen) | −0.60 m | | **−0.17 m** |

What it shows:

- **The tuning carried over.** Both storms the sweep never saw moved toward the gauge by 0.37 and 0.44 m, more than
  the tuning storm itself (0.19 m). August 2023 ends 0.02 m outside the 0.15 m bar. January 2024 stays 6.6 times
  outside it.
- **Every run is low, on every storm.** The kept value is the lowest one tried, so the best infiltration may be lower
  still. But less infiltration alone cannot close the gap: × 0.25 already soaks in a quarter of what the soils say, and
  the June and January peaks are still 0.7–1.0 m short. What remains points at the rest of the open list in §5.12:
  the cloudburst core the gauges miss, the area the pipes drain to the gauge, and the channel's roughness.
- **One gauge per storm.** One level error per storm is a thin score, and the sweep tuned one knob. The next study
  fits roughness and infiltration together and scores the gauge's whole hydrograph (peak, volume, timing), not only
  its peak.

The Charlotte case is not yet calibrated to the bar. These runs used the area-wide inlet setting. Charlotte's inlets
by type (NCDOT kinds, §2.14) came after them.

**Settings test: Charlotte's inlets by type** (2026-11-06, commit 9728fd0, the kept calibration on every run). Each
storm ran twice, identical but for the inlets: the area-wide setting, then NCDOT kinds by `STRUCT_TYPE`.

| Storm | Gauge, area-wide inlets | Gauge, NCDOT kinds | Street water into pipes | Street area over 15 cm deep |
|---|---|---|---|---|
| 12 June 2025 | −0.668 m | −0.662 m | +3.0 % | −2.3 % (−3,900 m²) |
| 9 January 2024 | −0.971 m | −0.972 m | −0.2 % | 0.0 % |
| 10 August 2023 | −0.151 m | −0.144 m | +1.5 % | −1.0 % (−1,350 m²) |

- **The gauge cannot judge the inlets.** Charlotte's catch basins and drop inlets have larger NCDOT openings than the
  area-wide setting, so they take a little more street water into the pipes. That water reaches the creek either way,
  and the gauge moves under 1 cm on every storm.
- **The effect is on the streets.** On 12 June 2025, 12,500 m² of street ends at least 5 cm shallower (up to 0.33 m
  at one place), 160 m² ends deeper, and water pushed back up through the grates doubles (2,800 to 5,400 m³) as the
  pipes fill sooner. No street observations exist for these storms, so this shows what the setting does, not that it
  is more accurate.
- **The kinds stay on by default in North Carolina.** They follow the state's own standard drawings and leave the
  validation where it was.

These runs read 0.01–0.02 m higher than the same settings in the study above. That gap is the city's data, not the
change: Charlotte republished its storm pipe and structure layers between 5 and 6 November 2026 (every record a new
ID; a few inlets added, removed or retyped, 1,160 linked inlets became 1,163). The study above ran on the copy the
fetch cache held from 5 November. Rerun on that copy with inlet kinds off, the new code gives the study's August 2023
run to the last digit (gauge −0.171 m, the same steps, pipe exchange and peak depth). A linked layer is fetched live,
and the run's forcing record then held its address, not what came back, so runs on two versions of the city's data
looked like the same drainage to Compare. It now also holds a count and hash of what each layer returned
(`utilityData`, §7.11), and Compare refuses such a pair and names the reason.

**Both studies above ran a combined sewer by mistake** (§5.12, end): their level errors and the second study's flow
scores are superseded by the two studies below. The second study also stopped partway on 7 November 2026, unrecorded:
it had the same fault.

**Third study: Charlotte with separate storm sewers, infiltration on the whole hydrograph** (2026-11-08, commit
62fbcc0, `--objective flow`, gauge-fitted radar, roughness as set).

| Storm | Infiltration × 1 (as set) | × 0.5 | × 0.25 (kept) |
|---|---|---|---|
| 12 June 2025 (tuning): level / NSE / volume | −0.70 m / 0.58 / 35 % | −0.55 m / 0.65 / 45 % | **−0.48 m / 0.69 / 53 %** |
| 9 January 2024 (never seen) | −1.28 m / 0.19 / 17 % | | **−0.90 m / 0.61 / 41 %** |
| 10 August 2023 (never seen) | −0.49 m / 0.67 / 74 % | | **−0.07 m / 0.88 / 126 %** |

- **Separate sewers moved every storm toward the gauge.** With the kept value the flow's Kling–Gupta efficiency is
  0.19–0.69 over the three storms, against −0.18 to 0.43 in the second study (whose gauge line also missed the
  floodplain).
- **One infiltration value does not fit summer and winter.** August 2023 meets the 0.15 m bar but now makes 26 % too
  much water. January 2024 makes 41 % of the gauge's. In January the model gave no flow at all for the storm's first
  12 hours, while the gauge had already passed 6,600 m³: the soil soaked up everything. All three storms start at
  *Normal* wetness (Se = 0.40). A winter storm on wet ground is the case the paragraph above warned of, and the
  kept value is again the lowest tried. So the next change is the soil's starting wetness, set from the rain of the
  days before each storm (an antecedent-rain rule), not a lower infiltration everywhere.

**Fourth study: groundwater return** (2026-11-08, commit 6d047cc, infiltration × 0.25 on every run, lag 12 h; §3.5).
After the storm the June 2025 model drained to 0.04 m³/s where the gauge still ran at 0.10, and passed 12,100 m³ from
two hours after the peak to the run's end against the gauge's 30,400.

| Storm | No return | 10 % | 20 % | 30 % (kept) |
|---|---|---|---|---|
| 12 June 2025 (tuning): level / KGE / volume | −0.48 m / 0.35 / 53 % | −0.48 m / 0.37 / 56 % | −0.47 m / 0.39 / 58 % | **−0.47 m / 0.41 / 61 %** |
| 9 January 2024 (never seen) | −0.90 m / 0.19 / 41 % | | | **−0.88 m / 0.24 / 47 %** |
| 10 August 2023 (never seen) | −0.07 m / 0.69 / 126 % | | | **−0.06 m / 0.65 / 131 %** |

- **It fixes the tail it was meant for.** At 30 %, the June recession passes 27,400 m³ against the gauge's 30,400 (no
  return: 12,100), and January's 8,800 m³ against 11,800 (5,000). 30,100 m³ came back in June, and 11,600 m³ was still
  in the store at the end. The surface books close (+0.001 %), and the combined books are unchanged at −1.0 %.
- **It does not touch the peak.** Peak flow and peak level barely move: the return is slow water, and the shortfall in
  June and January is at the peak. June's flow at the run's end is now 0.18 m³/s against the gauge's 0.10, so 30 %
  with a 12 h lag returns a little too much, too soon. August, already too wet, gets slightly worse.
- **So it stays off by default.** It is a fitted setting for matching a gauge's recession, worth turning on for
  long-duration runs or baseflow checks. It is not a fix for low peaks.

**Fifth study: starting wetness from the rain before the storm** (2026-11-08, ddd6339 with `src/antecedent.js`; groundwater
return off). The five-day rain at the USGS gauges within 8 km, by the NRCS rule (§3.5): June 2025 20 mm, growing season,
AMC I, starts *dry*; January 2024 29.5 mm, dormant, AMC III, *wet*; August 2023 23 mm, growing, AMC I, *dry*. Infiltration
tuned again on June over × 0.1 / 0.15 / 0.25, with the other two storms checked at the kept value. Each cell is peak-level error at the
gauge / flow volume against the gauge's / flow NSE.

| Storm | Third study: *Normal*, × 0.25 | Control: *Normal*, × 0.1 | Rule, × 0.1 (kept) |
|---|---|---|---|
| 12 June 2025 (tuning; *dry*) | −0.48 m / 53 % / 0.69 | | **−0.44 m / 61 % / 0.71** |
| 9 January 2024 (never seen; *wet*) | −0.90 m / 41 % / 0.61 | −0.80 m / 54 % / 0.72 | **−0.77 m / 58 % / 0.75** |
| 10 August 2023 (never seen; *dry*) | −0.07 m / 126 % / 0.88 | +0.03 m / 146 % / 0.79 | **0.00 m / 141 % / 0.82** |

- **The rule moves the two storms it was not tuned on the right way, and only a little.** At × 0.1, against *Normal*, January
  gains 4 points of volume and August loses 5; the flow's Kling–Gupta efficiency rises from 0.34 to 0.39 and from 0.43 to
  0.50. In January's first 12 hours the model passes 3,500 m³ (*Normal*: 1,950; the gauge: 12,700). June at × 0.25 runs the
  other way, as a dry start should (53 % to 51 %). Most of the change from the third study is the lower infiltration, not
  the starting wetness.
- **The gap between the storms is not winter against summer.** January and June now fall short by the same share (58 %,
  61 %), but June and August, both summer and both *dry*, are 61 % and 141 %. August's level error of 0.00 m is not a good
  result: the model reaches the level with 37 % too much peak flow.
- **× 0.1 is again the lowest value tried, and it is not adopted.** The case files stay at × 1 and the default wetness at
  *Normal*. A value that keeps falling at the edge of its range is compensating for something else.
- **Soil cannot close June or January.** Over the 2.5 km² watershed the gauge passed 91 mm in June, 66 mm in January and
  16 mm in August. Against the model's rain (the mean over the model box: 94, 68 and 41 mm) that is 97 %, 97 % and 39 %.
  The model, with almost no infiltration, passes 59 % in June and 56 % in January: about 23 % of its rain still soaks in,
  and 12–13 % is still held in the model at the end. USGS rain gauge 351229080460245, at the centre of the box, caught
  110 mm in June and 87 mm in January over the same windows (17 % and 27 % above the box mean) and 40 mm in August (the
  same). One gauge is a point and the box mean an area, but the rain is short in exactly the two
  storms that fall short and matches in the one that does not. With that gauge's rain the stream gauge's share would be 83 %, 77 % and
  40 %: still very high for June and January. What is left is the gauge's rating in large floods and pipes bringing
  water across the mapped divide.

**What those checks found** (8 November 2026; analysis of the data, no new model runs).

- **January's rain is short, and the cause is the radar fit.** The MRMS radar-only total over the area is 37 mm. All 27
  USGS rain gauges within 10 km caught more, 1.5 to 2.9 times the radar at their own pixels (2.25 times over all of them),
  and the five nearest the area caught 77–90 mm (mean 83). The fit (§3.6) takes the area to 68 mm: it is right to raise the
  radar, but it stops short. Left-out gauges average 63 mm where they caught 80. The hourly factor cap of 3 is part of it
  (at a cap of 6: 76 mm); removing the pull toward the radar is not (69 mm). A storm-wide radar bias taken out first, the
  fit then working on what is left, gives **86.5 mm** over the watershed, cuts the leave-one-out error from 3.38 to 2.45 mm
  per gauge-hour, and brings the left-out gauges to 82 mm against 80. It barely moves June (94.1 to 92.9 mm; 3.61 to
  3.64 mm) or August (40.8 to 41.3 mm; 3.38 mm both), where the radar's storm-wide bias is 0.91 and 1.26. The left-out
  gauges had a small say in that bias (one part in 27). With 86.5 mm, January's creek passed 76 % of the rain, not 96 %.
  The fit now tries this step and keeps it only if it beats the plain fit by more than 5 % on the left-out gauges; the
  bias fades away from the gauges as the local factors do. As built, January comes to 85.8 mm over the watershed (left-out
  gauges 80.7 mm against 79.9) and June and August keep the plain fit.
- **June's rain cannot be settled.** Basin mean 94 mm. The gauge in the watershed caught 110 mm, but the four others
  within 4.7 km of the area's centre caught 41–82 mm: a storm cell only one gauge saw. The true mean is somewhere from
  about 94 to 110 mm.
- **The watershed mean is the box mean.** StreamStats' outline (2.54 km²) gives 94.1, 68.4 and 40.8 mm, the same as the
  box in every storm to within 0.2 mm. The difference is not the shape of the area.
- **The gauge's rating is poorly anchored in floods but shows no sign of reading high.** USGS's flow measurements at this
  site (177 visits): the largest made by wading or by acoustic profiler is 72.8 cfs, and only four exceed that, three of
  them indirect (from flood marks after the event) and rated Poor, and the fourth 225 cfs of unspecified method. Against
  the annual peaks' stage–discharge pairs, which lie on one curve for 2004–2024, the indirect values are 1,100 cfs at
  8.67 ft (peak record 959), 820 at 8.64 ft (953) and 2,930 at 9.90 ft (2,560 published). They fall on both sides of the
  curve, by 13–16 %. 75–80 % of each storm's volume passed above 225 cfs, and 58 % of June's above 881 cfs, so a
  flood-range error of ±15 % moves the storm volumes by roughly ±10 %. It is a real uncertainty but it does not explain
  a 40 % shortfall, and nothing here says its sign. The level error is not affected by the rating at all.
- **Pipes across the divide are about even.** Charlotte's pipe layer, 10,015 pipes around the site, traced by their
  upstream and downstream structures against StreamStats' outline: 38 pipes from outside drain in (0.20 km² by the
  100 m squares they pass through), and 52 inside drain out (0.18 km²). These are rough areas (a pipe's direction taken
  from its drawn order), but both are under a tenth of the watershed and they offset.
- **August is the opposite problem and remains open.** The rain agrees (41 mm against nearby gauges of 27–44 mm) and the
  creek passed 39 % of it. The model passes more than the gauge at any infiltration tried (126–146 %). A short storm on
  dry ground that runs off this little points away from the rain and toward how much of the paved area really reaches the
  creek.

**Sixth study: a shallow limit on what the soil can take** (9 November 2026, commit 2524f63; projects "… (calibration)").
The creek loses a nearly constant depth per storm: about 25 mm in August, 20–25 mm in January and 9–25 mm in June. Green-Ampt's
only limit is the water table or bedrock, so the model's loss grows with the storm. The water-table depth input, applied to
every cell, stands in for a shallow layer that fills (*soil limit* below). Tuned on the short dry storm, August (5, 10, 20 cm;
flow objective), then frozen and run on the two large storms. Infiltration × 1, rain fitted to the gauges (January with the
storm-wide bias, 86 mm), wetness from the rain before the storm.

| Storm | No limit: level / volume / peak / NSE | Soil limit 10 cm: level / volume / peak / NSE |
|---|---|---|
| 10 August 2023 (tuned; 5 cm: 0.01 m low / 145 % / 135 %; 20 cm: 0.63 m low / 66 % / 51 %) | not run in this study | −0.33 m / 105 % / 83 % / 0.61 |
| 9 January 2024 (never seen) | −0.91 m / 38 % / 45 % / 0.57 | **−0.47 m / 95 % / 83 % / 0.93** |
| 12 June 2025 (never seen) | −0.76 m / 32 % / 37 % / 0.55 | −0.45 m / 68 % / 54 % / 0.73 |

- **The limit does what the bucket predicts, on storms it was not tuned on.** Over the 2.54 km² watershed the model now
  carries about 40 %, 72 % and 64 % of the rain (August, January, June); the creek carried 38 %, 77 % and 95 % (June's rain
  uncertain, about 80 % at the in-watershed gauge's 110 mm). Earlier the model's share was 55–59 % in all three.
- **It still is not good enough.** Every level is 0.3–0.5 m low against a target of 0.15 m. Peak flow is 83 %, 83 % and 54 %
  of the gauge's. August reads better on level with the 5 cm limit, which carries 145 % of the volume: volume and level
  cannot both be matched there, so the water arrives too spread out, or the channel at the gauge carries it too easily.
- **Not adopted.** The case files and defaults do not change. A 10 cm layer has not been measured here, the input applies to
  every cell including deep undisturbed soil, the sweep had three values, and the model still strands 13 % of the rain in
  January and June at the end of the run.

**Seventh study: the sewer's false outlets removed** (9 November 2026, commits 46510b2 and 5cbcb70; projects "… (calibration)").
The sixth study's runs still stranded water in pools, and the largest (35.1977, −80.7666; 2 ha, about 24,000 m³ in January) had no
pond on the USGS imagery. The cause was the network builder. A pipe whose inverts rise along its drawn direction was always
turned round, so a placeholder invert (Charlotte's P_130098: 719.8 → 733 ft, "Pipe-DS point is assumed") stopped a main dead
and its whole flow came out of the ground at that manhole. Now, where a main arrives as drawn, no outfall is there and the
pipe drawn onward was turned round by its inverts, that pipe keeps its drawn direction and the hump comes out (46 pipes
at Charlotte). A lone pipe with rising inverts is still taken as drawn backwards. Separately, pipe heads at a placed endwall or
flared end with no grate were closed; they now take surface water through the barrels (22 heads, up to 72 in).

Storm-wide water returned to the ground from pipe ends (m³) and water left standing over 30 cm at the end of the run:

| Storm (same limit, 10 cm, for August; else old 10 cm against new 20 cm) | Returned where no endwall exists: before → after | Over 30 cm at the end: before → after | The false pool: before → after |
|---|---|---|---|
| August 2023 | 187,652 → 11,840 | 23,614 → 12,391 | 8,445 → 81 |
| January 2024 | 579,187 → 39,730 | 44,207 → 14,202 | 24,469 → 83 |
| June 2025 | 958,679 → 37,875 | 47,124 → 13,810 | 26,788 → 83 |

The same study as the sixth then ran again (level error at the gauge / volume / peak / NSE):

| Storm | Soil limit | Before the fix | After the fix |
|---|---|---|---|
| August 2023 (tuned) | 5 cm | −0.01 m* / 145 % / 135 % | +0.04 m / 177 % / 152 % / 0.46 |
| | 10 cm | −0.33 m / 105 % / 83 % / 0.61 | −0.21 m / 132 % / 103 % / 0.58 |
| | 20 cm | −0.63 m / 66 % / 51 % | **−0.44 m / 90 % / 72 % / 0.68 (kept)** |
| January 2024 (never seen) | none | −0.91 m / 38 % / 45 % / 0.57 | −0.82 m / 48 % / 54 % / 0.72 |
| | kept value (10 cm before, 20 cm after) | −0.47 m / 95 % / 83 % / 0.93 | **−0.41 m / 104 % / 93 % / 0.95** |
| June 2025 (never seen) | none | −0.76 m / 32 % / 37 % / 0.55 | −0.69 m / 41 % / 42 % / 0.63 |
| | kept value (10 cm before, 20 cm after) | −0.45 m / 68 % / 54 % / 0.73 | −0.68 m / 65 % / 43 % / 0.66 |

\* as reported in the sixth study's sweep.

- **The fault is gone and the books are honest.** The false pool is empty in all three storms, and 93–96 % of the water that
  came back up at places with no outlet now stays in the pipes. 61 pipe ends with no endwall remain; the city layer shows
  nothing carrying on past them, and they return 4–7 % of what they did.
- **At a like-for-like soil limit, flow at the gauge rises by 9–32 points of volume and the level by 0.05–0.19 m.** The water
  that was stranded or sent back reaches the creek.
- **The tuning moved.** More water now reaches the creek, so August picks a 20 cm limit instead of 10 cm by flow score. That
  choice is what makes June's level look worse here (−0.68 against −0.45 m): 20 cm is a thirstier limit. The 10 cm limit
  was not rerun on June or January after the fix.
- **It still is not good enough.** Levels are 0.4–0.7 m low against a 0.15 m target. January's flow is now close (volume 104 %,
  peak 93 %, NSE 0.95). June's peak is 43 % and its volume 65 %, which points back at June's rain, already known to be
  short (94 mm over the box against 110 mm at the in-watershed gauge). The soil limit stays off by default.
- The direction and entrance changes apply to every network built from a real pipe layer and are on by default. Other cases
  with real pipes (Portland, §5.7) have not been rerun.

### 6.5 A reviewer's checklist

1. Commit and fingerprint recorded in `summary.json`; commit not `+dirty` for a submitted result.
2. Model checks: no Problem rows unexplained, and edge rows in particular.
3. Grid test (`coarse` variant) run and passing, or the failure explained.
4. Drainage tier as labelled: tier 2 means synthetic pipes, and HGL and surcharge results are then indicative only.
5. Inflow: the watershed traced; upstream area either modelled or covered by a river inflow.
6. Rain: for historic storms, the rain QA ratio near 1, or the difference explained; radar-only hours listed.
7. Run long enough: the run-length rows OK, and gauges not still rising at the end.
8. Validation scorecard where observations exist.
9. For design comparisons: identical forcing fingerprints (enforced), off-site Δ outside the 3 mm band, and the
   control-line post ≤ pre check.
10. For damage and EAD: the exposure filters stated, the band reported, the warnings on the EAD tails read, and the
    AEP convention in §4.5 noted.

---

## 7. Limitations and assumptions

Each entry gives the effect on results, where the direction can be stated, and a mitigation. Sources: README "Phase 1
known limits", "Known limits (solver)" and section caveats, and the code as cited.

### 7.1 Domain and boundaries

| Limitation | Effect on results | Mitigation |
|---|---|---|
| Model edges are free outfalls (Manning on the surface slope, ≤ critical) | Water reaching the edge leaves. Depth and extent near the edge are **underestimated** where water would pond or back up beyond it; nothing flows in from outside. A deep river leaving the model draws down toward the edge like a waterfall: at Manayunk (§5.8), 3.6 m at the edge and 1.5 m at a gauge 2.4 km upstream. | Draw the area well beyond the area of interest; read the edge checks (§6.1); use a tidal stage edge where applicable, and where a river leaves, a river outlet held from a downstream gauge (§3.7; historic storms, a prismatic backwater reach: at Manayunk it cut the gauge error to −0.80 m and left the edge about 0.5 m low). |
| Upstream runoff is excluded unless the model runs on its watershed or has an inflow | Flooding **underestimated** wherever ground outside drains in. | Trace the watershed and run on it, or add gauged or StreamStats inflow. |
| Polygon areas: the network is built over the bounding box, so inlets outside the polygon sit in dry sink cells | Minor: those inlets receive nothing. | Use a box, or accept. |
| River inflow enters through exchange cells two rows inside a closed edge, with no momentum-carrying boundary | Near-entry water surface can be distorted. README: Ida at Fairmount, the mark 250 m from the inflow read +1.44 m high. | Draw the box well upstream of the reach of interest. |
| Tide boundary uses the nearest CO-OPS gauge (within 60 km), not the local water level | Tidal levels can be offset by the gauge's distance (README: Delaware gauge vs Schuylkill mouth, about 0.1 m). | Use a closer gauge or a local stage record where available. |
| Window reruns depend on the margin | Window error: RMSE 6.4 mm, worst 18 cm at an edge building (Meyerland). | Use *Check the window*; widen if the edge check (> 5 % outflow change) fails. |

### 7.2 Terrain and buildings

| Limitation | Effect | Mitigation |
|---|---|---|
| Hydro-flattened lidar: channels below the flight-day water surface are missing | River conveyance **underestimated**, levels **overestimated**. README: Ida at Fairmount ran 1.6–1.9 m high on lidar alone. | Channel bathymetry: BlueTopo, HEC-RAS sections, or regional curves (an estimate; curves are wrong for tidal and dredged reaches). |
| Buildings are OSM footprints as solid walls (1 m); no flow through buildings, no basements, no doors | Flow concentrated in streets and gaps. Depths around buildings can be higher than with porosity. Incomplete OSM footprints let flow through missing buildings. | Check footprint completeness; add buildings in the design drawer. Microsoft/Overture footprints are a README-planned upgrade, not implemented. |
| Coarse grids (2–4 m): a cell is a wall if > 50 % building; the bed is the open-ground mean | Narrow alleys and gaps can close or open. South Street grid test: fit 0.41 at 4 m vs 2 m. | Use 1 m (default). Run the grid test. |
| Downscaling cannot create flow paths the solver grid missed | At 2–4 m, 1 m depth detail is interpolated, not solved. | Use 1 m. |
| Bridges and decks: the lidar bare earth may include or exclude decks; no bridge hydraulics | Local blockage or false conveyance at crossings. | Inspect crossings; check marks under decks (excluded from scoring). |
| Culverts only where OSM tags them; size from tags or defaults (1.2 m stream, 0.6 m ditch); mapped streams snapped to the 1 m thalweg; unmapped crossings breached to grade (embankments ≤ 30 m long, ≤ 4 m high) and full-width channel humps with no road (crest 0.5–2 m, ≤ 40 m long) cut | Breaching can **overstate** conveyance where the real culvert is small or blocked, or where a cut hump is a real weir or sewer crossing that holds the creek up at low flow; untagged larger culverts are under-sized. | Draw or import culverts with real sizes and inverts; use the blockage setting. |
| Curb burn is automatic only on DEMs coarser than 1 m | Depends on lidar resolving curbs at 1 m. | Check the street cross-sections in the profile tool. |
| Ground is static in the standard run (no morphology unless the sediment module is on) | — | — |

### 7.3 Hydrology

| Limitation | Effect | Mitigation |
|---|---|---|
| Green-Ampt parameters from SSURGO by texture (Rawls et al.); K halved; "Urban land" uses group or fill defaults | Infiltration uncertain by factors of several. On impervious urban sites the effect on peak ponding is small (South Street infiltration × 0.5: area +1.3 %). | Infiltration × 0.5 sensitivity variant; set initial wetness to match antecedent conditions. |
| Initial wetness is a single preset per run | Over- or under-infiltration early in the storm. | Dry/normal/wet/saturated runs; emulator over Se; for a historic storm, the preset from the 5-day rain before it (§3.5). |
| No interception, evaporation, or infiltration recovery between bursts | Slight **overestimate** of runoff for long or multi-burst events. | — |
| Impervious fraction is the NLCD class midpoint, not mapped imperviousness | Local over- or under-estimate of runoff. | — |
| Manning's n from NLCD class tables, not calibrated; constant with depth | Shallow sheet-flow resistance is not depth-dependent. Timing and peak speeds uncertain; peak depths at ponds insensitive (South Street roughness × 1.2: area −0.3 %). | Roughness ± 20 % variants; calibrate to marks where they constrain it. |
| The 1 m model uses no porosity or subgrid tables (opt-in only in the speed mode) | — | — |
| Single-event only: no continuous simulation | Antecedent conditions must be assumed; no long-term statistics (e.g. CSO frequency per year). | Use the antecedent presets; do not use for long-term control plans. |

### 7.4 Rainfall

| Limitation | Effect | Mitigation |
|---|---|---|
| Design storms are uniform in space with no areal reduction factor | **Overestimates** rain on larger areas (ARF < 1); appropriate for small urban catchments. | Keep areas small. No ARF option is implemented. |
| Alternating-block pattern nests every duration's T-year depth | Peakier than real storms: conservative for peaks, and long-duration volumes are realistic but sub-durations all at T-year. | Use uniform or late/early peaks for sensitivity. Atlas 14 temporal distributions are planned, not implemented. |
| Atlas 14 at the domain centre | Small error for large domains. | — |
| Historic rainfall from the gridded record or the nearest ASOS gauge | Site rain can differ greatly (Isaias: PHL 106 mm vs the site's 150 mm). | Use MRMS; read the rain QA. |
| MRMS: radar-only before May 2015 or where gauge-corrected totals are missing; 8-bit rate overflow above about 150 mm/hr | Radar-only can be biased high or low. Overflow handling changes the within-hour timing at the cloudburst core. | Summary lists radar-only hours and filled frames; check rain QA. |
| Gauge-corrected MRMS can disagree strongly with other sources (Ida at Fairmount: 53 mm vs radar-only 91 mm and gridded 86 mm; unexplained in the README) | Rain volume uncertainty of tens of percent for some events. | Compare sources; report the range. |
| Nowcast is persistence advection; the ensemble's motion and growth spreads are assumed, not fitted to the storm | Skill falls within the hour; a new cell forming over the area is missed by every member; the P10–P90 is not a calibrated probability. | Screening only; the panel shows the motion correlation and flags past 60 min; replay past storms to see how the band does there. |
| Past 90 min the rain is one HRRR run with fixed blend weights | Convective storms misplaced by tens of km or an hour; the band past 90 min leaves out HRRR's own error (every member shares the run). | Flagged in the panel, the hyetograph and the run record; a time-lagged HRRR ensemble (earlier cycles as members) would widen the band. |

### 7.5 Rivers, tides and compound flooding

| Limitation | Effect | Mitigation |
|---|---|---|
| Gauged design flows use Bulletin 17B moments with station skew, not 17C EMA or regional skew | Planning-level frequency flows. | Use published 17C/FIS flows as "your own peak". |
| Drainage-area transfer Q ∝ A^0.8 | Weak when the area ratio is outside 0.5–1.5 (flagged). | Use a closer gauge or a study discharge. |
| StreamStats regression equations are rural; errors 30–40 % are usual; the lag equation is for small basins | Urbanised basins peak higher and sooner (**underestimate** of the peak). Timing is indicative for large basins. | Use the 90 % interval in sensitivity; supply a study peak. |
| Starting water levels: ungauged water starts at the lidar surface | Ungauged channels may start too low or too high. | Baseflow warm-up; check start levels. |
| Joint rain–surge: daily-event dependence stands in for annual maxima; a still surge is held for the whole run; no waves, no river–tide interaction upstream, no change in tidal range with SLR | Still surge is conservative for short storms. Waves and wave set-up are absent (**underestimate** on exposed coasts). | Not for coastal V-zone or wave-runup assessment. |
| Bank collapse and toe: no bathymetry, so the toe is the lidar water surface; no tension cracks or matric suction; one planar mode | Indicative only. | Geotechnical assessment. |

### 7.6 Drainage

| Limitation | Effect | Mitigation |
|---|---|---|
| **Synthesized pipes where none are published** (tier 2, 2+): rational-method sizing for a 10-yr storm, street-following tree, generic cover and slope | Network capacity, connectivity and outfalls are assumed. Street flooding can be over- or under-estimated depending on the real system's capacity and condition. HGL and surcharge results are indicative only. | Link the utility's pipe layer (tier 1) or draw/import pipes; report the tier with results. |
| Generic inlet hydraulics: one grate = 0.2 m² opening, 2.0 m weir, C_w 0.5, C_o 0.6, 60 m spacing for synthetic inlets | Inlet capture uncertain; real inlets vary widely in type and condition. | Clogging setting; calibration sweep where marks constrain it (they may not, §5.5). |
| No yard drains, area drains or private systems | Ponding in enclosed rowhouse yards is **overestimated** (README: 568 enclosed yards on South Philadelphia). Damage filters exclude it. | Read damage with the exposure filters. |
| Combined-sewer regulators are generic (outlet at 3 × peak DWF, weir for the rest); population from land-cover densities, not the census; pipes leaving the area are not regulated | CSO volumes and capture are illustrative. | Not for LTCP or compliance. |
| 1D–2D exchange every 2 s | Sets the pace on small coupled domains (about 47× real time at 190k cells). | — |
| Residual ponding vs HEC-RAS (Davis): FloodSim holds 21,000 m³ more in shallow ponds and pumps 16 % less | Either FloodSim resolves real ridges that RAS drains, or it over-holds water; unresolved. | Treat volumes into pipes on flat impervious sites as uncertain by this order. |
| SWMM continuity is the combined residual (−0.35 % on South Street with inlets-in-only; −0.18 % two-way) | Small. | Read the combined books. |

### 7.7 Numerics and precision

| Limitation | Effect | Mitigation |
|---|---|---|
| fp32 GPU arithmetic | Mitigated by bed offset, Kahan residuals and fp64 books (§2.8). Lake-at-rest velocities of 1e-5 m/s remain. | Mass books in every run. GPU = CPU fp64 to about 5e-6 m in the rain case. |
| No turbulence (eddy viscosity) term | Recirculation and hydraulic jumps around obstacles may be misplaced (EA 6A: bow jump 0.25 m short). | Not for detailed local velocity fields around structures. |
| Friction is operator-split (applied once per step after the RK update) and point-wise | Standard practice; first-order splitting error at large steps. | — |
| Uniform grid; no local refinement (LTS changes time step, not cell size) | Resolution is set globally by memory: about 1 M cells at 1 m runs about 45× real time on an RTX 50-series GPU. | Subgrid mode for larger areas (with its accuracy limits). |
| Subgrid mode is local inertial, with cell-scale storage connectivity | CSI 0.67–0.80 against 1 m at 4 m; enclosed spaces connect to the street. | Use 1 m for final results; subgrid is opt-in speed mode. |
| LTS: moving fronts timed slightly differently; slower on small grids | Up to 9 mm on spilling fronts in tests. | Off by default. |
| Wet/dry thresholds: hdry 1e-5 m (GPU), first order below 1 mm; velocity ignored below 5 cm in hazard/speed products | Thin-film velocities excluded from hazard by design. | — |

### 7.8 Outputs and post-processing

| Limitation | Effect | Mitigation |
|---|---|---|
| Peak grids are per-cell maxima over time, not a single surface | `max_wse` can be steeper than any instantaneous surface. | — |
| Downscaling at 2–4 m interpolates WSE over wet neighbours; the peak is forced ≥ final | Can create or remove thin films at the margins; `volumeRatio` is reported as a diagnostic. | Use 1 m. |
| Two max-speed products: `grids/max_speed.f32` (every step, > 5 cm) and `max_speed.asc` / 3D export EXR (frame-sampled, > 1 cm) | The `.asc` and EXR can miss short peaks or include thin-film speeds. | Use the `.f32` grid for analysis. |
| Gutter spread resolves to one cell (1 m) | ± 1 m on spread. | — |
| Hazard classes assume the ARR/FD2320 curves apply | They are generic vulnerability curves. | — |

### 7.9 Damage, EAD and benefit–cost

| Limitation | Effect | Mitigation |
|---|---|---|
| USACE generic depth–damage curves (EGM 01-03/04-01, HEC-FIA) | Damage uncertain by the curves' spread; the reported band (all curves at p10/p90 together) is deliberately wide. | Report the band. |
| NSI structure data quality: modelled points, estimated foundation heights and values; points matched to OSM footprints | First-floor elevation errors of decimetres change damage strongly at shallow depths. | Survey FFEs for key structures; check NSI points. |
| Exposure rules (≥ 10 cm on adjacent open cells, patch reaching a street or ≥ 200 m²) | Results are sensitive to them: $101 M vs $6.3 M on the South Philadelphia block. | State the filters; run with alternatives. |
| **The T-year rain is taken to give the T-year flood** (EAD integrates over the design storms' AEP, 1 − exp(−1/ARI)) | Ignores antecedent wetness, storm shape and joint rain–tide probability, each of which can make the flood rarer or more frequent than its rain. | Treat EAD as comparative; for tidal sites use the compound joint-probability pairs (§3.8). |
| EAD tails: damage falls linearly to zero at AEP 1 and is held constant beyond the rarest storm | Both are flagged when they matter (> 20 % in the tail). | Run more return periods (batch). |
| Buildings only: no contents beyond NSI values, vehicles, displacement, emergency costs or life safety | Total flood losses **underestimated**. | — |
| BCA: a simple PV of avoided EAD at a constant discount rate | Not FEMA BCA Toolkit compliant. | Use for ranking only. |

### 7.10 Emulator, calibration and observation scoring

| Limitation | Effect | Mitigation |
|---|---|---|
| Emulator: valid only inside the trained box, one scenario and one model build; leave-one-out slightly optimistic; memory limit about 1 GB | Extrapolation is unreliable; changes under about 1 cm are within its error. | Screening only; confirm with a solver run before a number goes in a report. |
| Calibration multipliers are global (one n ×, one infiltration ×, one clogging) | Cannot fix spatially varying errors. On sewered impervious sites marks may not constrain them. | The app reports when marks do not move. |
| Scorecard targets are FloodSim's defaults, not a standard | — | Apply the reviewing agency's targets. |
| USGS STN marks cover mostly large river and coastal floods | Street flash floods rarely have marks. | Use local observations (311, photos) as flooded/dry reports. |

### 7.11 Software, data and environment

| Limitation | Effect | Mitigation |
|---|---|---|
| Open-data services change (3DEP, NLCD, OSM edits, NWIS revisions); Overpass is unreliable under load | A rebuild on another machine or date may differ. | The model layers are hashed (`designHash`, §8.2); the local cache (`.cache/`) makes a rebuild repeatable on one machine. Archive the project folder and cache with submitted results. |
| Linked utility layers (a city's pipes and inlets) are fetched live, and cities republish them (Charlotte, 5 → 6 November 2026: 1,160 → 1,163 linked inlets, 0.01–0.02 m at the gauge, §6.4) | A rebuild on another date may differ. | The forcing record holds a count and hash of what each layer returned (`utilityData`: linked pipes, inlets and outfalls, and a built-in utility's inlets and outfalls), so Compare and settings tests refuse two runs on different versions and name the reason. The per-checkout cache keeps one machine on one version; archive it with the project. |
| GPU requirements: WebGPU with 9 storage buffers per stage for tiling (10 for sediment) | Untiled fallback is slower; results identical (tiling is bit-identical). | — |
| Results depend on the app commit | Recorded in every fingerprint; `+dirty` flags uncommitted code. | Require a clean commit. |
| The CPU reference is not practical for full-size models | GPU results are verified against it on test cases only. | — |

---

## 8. Reproducibility

### 8.1 Run records

Every finished run in a project is saved as `runs/<date_time>/` (`app/projects.js`; `app/map.js`). It contains:

- `summary.json`:
  - the storm, the inflows with their peaks, intervals, equations and characteristics, the tide;
  - the settings snapshot (`captureProject()`) and the results (simulated and wall time, peak depth, flooded areas,
    surface mass, network continuity and exchange totals, steps);
  - the hazard class areas, the barrier and pond results;
  - `scenario`, `designHash`, `forcingHash` with per-part `forcing` hashes, `commit`, the books, the control lines,
    the validation inputs and the calibration scores;
  - a `files` dictionary describing each output.
- 1 m grids (`grids/*.f32` + `.hdr`), and `grids/ground.f32` for a design scenario's ground.
- ESRI ASCII grids with `.prj` (§4.1).
- The SWMM `.inp` as run and SWMM's report, `network.json`, `hgl.json` and `inlets.json`.
- The hyetograph CSV, the infrastructure layer at run time, and `design.geojson` for a scenario.

### 8.2 Forcing fingerprint and design hash

`src/compare.js` `fingerprint`, `FORCING_PARTS`; `src/design.js` `hashFine`:

- **Forcing fingerprint.** A 32-bit FNV-1a hash of a key-sorted JSON of each forcing part, and a hash of the part
  hashes. The parts are: storm (depth, duration, pattern, or the historic event and its rain source, including a hash
  of MRMS frames); river inflow; tide and surge; start water levels (the gauge readings used); antecedent soil moisture
  and water table; grid size and speed mode; solver settings; run length; sediment, debris and bank options; drainage,
  green infrastructure, infrastructure layer and calibration; inlet and pipe solver settings (`drainSettings`: only the
  values that differ from the defaults, and the part is left out when there are none, so runs made before it existed
  keep their hashes); model area; and **app commit** (from `/api/version`, with
  `+dirty` when code that can change a result differs from that commit: `app`, `src`, `server`, `vendor`, `dist`,
  `tools` and the package files, untracked files included, Markdown not; `tools/codestate.mjs`). The changed files are
  listed in the record as `codeChanged`. Docs and the validation suite's own score files do not make a run dirty.
- **Design hash** (`designHash`). An FNV-1a hash over the bytes of the built 1 m model layers: z, buildings and
  heights, roads, land cover, n, infiltration, soil group, pervious share, critical shear, texture, grains, bedrock,
  collapse/swell classes, Green-Ampt parameters and building ids. It therefore captures the downloaded terrain, land
  cover and soils, not only the settings.
- **Uses.**
  - Compare refuses two runs whose fingerprints differ, and names the parts. The exception is a **settings test**:
    two runs with the same `designHash` whose fingerprints differ only in `drainSettings` compare and report as
    one, labelled as such, with the changed settings listed (`comparable` → `kind: 'settings'`, `settingsChanges`).
  - Checkpoints refuse to resume under a different fingerprint.
  - EAD families require matching parts other than storm and run length, plus a matching `designHash`.
  - Emulator studies require every run to match on the parts the study does not vary.
- **Caveat.** These are 32-bit non-cryptographic hashes, adequate for detecting accidental mismatch but not proof
  against deliberate tampering. The fingerprint hashes settings and gauge readings; it does not hash the raw downloaded
  files (the design hash covers the built layers).

### 8.3 Determinism

Steps are cut only at 10 s multiples and storm block changes; green roofs, cisterns and the tide switch on those
quanta, and the speed setting only decides how far to step per frame. Rerunning a run gives Δ = 0 (README: two
existing-conditions runs of a Meyerland block gave 0 differing cells; the GPU suite checks it for batch sizes of 7 and
64 steps). Active tiles are bit-identical to untiled stepping. Determinism across different GPU hardware or drivers is
not documented (unverified).

### 8.4 Project folder layout

Each project is a folder in `Documents\FloodSim Projects` (override with `FLOODSIM_PROJECTS`; `/api/projects`,
loopback only):

```
<project>/
  project.json                  area and every setting
  infrastructure.geojson        drawer layer
  analysis.geojson              control lines, site boundary
  batch.json                    batch study: jobs, status, run folder, wall time
  scenarios/<name>/             design.geojson, scenario.json (settings, presets, resolved FFE / pad, cut / fill)
  runs/<date_time>/             one folder per finished run (§8.1)
  runs/_checkpoint/             checkpoint of the run under way
  comparisons/<date_time>/      exported comparisons
  reports/                      exported H&H reports
  emulators/<name>/             study.json, model.json, bases (.f32), masks, validation.json
```

Opening a project rebuilds the model from the saved settings and reloads a historic event if one was used.

### 8.5 Batch tool

`src/batch.js`, `app/batch-ui.js`, `tools/batch.mjs`:

- A study expands every combination of storms (Atlas 14 return periods × durations, or the storm as set),
  scenarios and variants into jobs with stable ids (an FNV hash of storm, scenario and variant). Jobs are ordered storm
  by storm, existing conditions first. The study is saved in `batch.json`, and every job is filed as an ordinary run.
- Headless: `npm run batch -- "<project folder>"` runs the study in headless Chrome or Edge on the machine's GPU, and
  relaunches after a browser or GPU crash (`--retries`, default 3). The README reports the headless run matching the
  in-app run cell for cell.

### 8.6 Checkpoints

`src/checkpoint.js`. Every few minutes of wall time (default 10) the run under way is copied to `runs/_checkpoint/`.
The copy holds every GPU storage buffer byte for byte, SWMM's whole WebAssembly memory with its in-memory report
files, and the run's JS state by path, gzip-compressed. That is a few MB for a small area and about 0.5 GB for a
4.6-million-cell run (2.7 GB before compression). The parts go through the compressor 16 MB at a time and come back a
part at a time, because one buffer of the whole run cannot be read back in a browser. The file goes to the local server
in 64 MB pieces and replaces the previous checkpoint only after the last piece. A failed checkpoint is logged and tried
again after the full interval. *Resume* rebuilds the run from the same settings,
restores the copy, and refuses if the fingerprint differs. The README reports a run paused, reloaded and resumed
matching the uninterrupted run bit for bit (infiltration book 1e-7, the same as between two uninterrupted runs). Export
animation frames are not checkpointed.

### 8.7 Data caching and what to archive

`server/server.mjs` proxies an allowlist of open-data hosts and caches responses in `.cache/`, so a rebuild on the same
machine is instant and offline-capable. To make a submitted result reproducible elsewhere, archive:

- the project folder;
- the relevant `.cache/` content (including `.cache/bluetopo/` if used);
- the commit;
- the SWMM build (`vendor/swmm-wasm/`, built with emsdk 6.0.13 per the README).

---

## 9. References

Only works cited in the README, benchmark READMEs or source code are listed.

**Numerical methods and verification**
- Audusse et al. (2004): hydrostatic reconstruction for well-balancing and wet/dry (cited in `src/solver-cpu.js`,
  `src/kernels.wgsl.js`, README).
- Toro (2001): the HLLC approximate Riemann solver (cited in `src/solver-cpu.js`).
- Thacker, W. C. (1981). Planar surface oscillating in a paraboloid (via SWASHES 4.2.2; `src/analytic.js`).
- Leijnse, T. et al. (2021); van Ormondt, M. et al. (2025). SFINCS subgrid approach (`src/subgrid.js`).
- Snyder, J. P. (1987). Map projections, transverse Mercator series (`src/geo.js`).
- Felzenszwalb, P. and Huttenlocher, D. (2012). Exact Euclidean distance transform (`src/design.js`).
- Barnes, R., Lehman, C. and Mulla, D. (2014). Priority-flood depression filling (`src/watershed.js`).
- Dubrule, O. (1983). Closed-form leave-one-out cross-validation for kriging/GPs (`src/emulator.js`).

**Benchmarks**
- Néelz, S. and Pender, G. (2013). *Benchmarking the latest generation of 2D hydraulic modelling packages*.
  Environment Agency report SC120002 (with the May 2010 test specifications).
- USACE HEC. HEC-RAS 2D verification and validation (RD-52; §4.2.8 rain on a plane; §4.3.3 Cea 2008 urban layout) and
  the EA benchmark report for HEC-RAS (RD-51); HEC-RAS 7.0.2 example project `Pipes/Davis`.
- Cea, L. (2008). Rainfall over a model urban layout (as cited in RD-52 §4.3.3).
- benchmark1d2d open benchmark project (third-party HEC-RAS, LISFLOOD-FP, TELEMAC-2D and ANUGA runs of EA Tests 1, 2, 4,
  5).
- Bellinge urban drainage dataset (CC BY 4.0; proposed).

**Hydrology and hydraulics**
- NOAA Atlas 14 precipitation frequency estimates (PFDS).
- Langbein: partial-duration to annual-maximum return period conversion (`src/storm.js` `pdsToAms`).
- Hosking, J. R. M. (1990). L-moments (GEV fitting; `src/storm.js`).
- Rawls, W. J., Brakensiek, D. L. and Miller, N. (1983). Green-Ampt infiltration parameters from soils data.
- Bouwer, H. (1966). Entrapped air: K = ½ K_sat for Green-Ampt.
- USDA NRCS National Engineering Handbook Part 630, Chapter 16 (dimensionless unit hydrograph, lag equation).
- USGS Bulletin 17B (log-Pearson III, method of moments); Bulletin 17C (EMA; cited as not applied).
- USGS StreamStats / NSS; Pennsylvania SIR 2019-5094 (peak-flow regression, Wissahickon check).
- Bieger, K. et al. (2015). Regional hydraulic geometry curves for the conterminous US.
- Villemonte submergence for weirs.
- EPA SWMM 5.2.4 (dynamic wave, Preissmann slot); EPA SWMM LID manual (GI design values).

**Coastal and compound**
- NOAA CO-OPS station datums, extreme water levels and SLR projections; 2022 Interagency Sea Level Rise Technical
  Report.
- Bender, J. and Jensen, J. (2017); Jane, R. et al. (2020). Two-sided conditional sampling and copula joint
  probability.
- NOAA NHC HURDAT2.

**Hazard and damage**
- Australian Rainfall and Runoff 2019 / AIDR Guideline 7-3, hazard vulnerability curves H1–H6.
- Defra / Environment Agency FD2320, flood hazard rating HR = d(v + 0.5) + DF.
- USACE Economic Guidance Memoranda EGM 01-03 and 04-01 (single-family depth–damage); HEC-FIA curves; USACE
  go-consequences (MIT); USACE National Structure Inventory.
- International Residential Code R404.1.6 and R401.3 (finished floor reveal and grading; site design).
- FEMA National Flood Hazard Layer.

**Sediment, scour, soils and banks**
- Hanson, G. J. and Simon, A. (2001). Excess-shear erodibility, k_d = 0.2·τc^−½.
- FHWA HEC-15. Critical shear for vegetated linings (class D) and effective shear.
- Wilcock, P. R. and Crowe, J. C. (2003). Surface-based transport model for mixed-size sediment.
- Ferguson, R. I. and Church, M. (2004). Settling velocity.
- Richardson–Zaki hindered settling; Hirano active-layer model.
- Egashira, S. et al. (1997). Debris-flow equilibrium slope.
- O'Brien, J. S. and Julien, P. Y. (1988). Quadratic rheology of mud and debris flows (Glenwood sample coefficients).
- Culmann planar wedge; BSTEM default strengths; Pollen, N. and Simon, A. (2005). Root cohesion.
