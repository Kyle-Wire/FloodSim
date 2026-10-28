# Gate C: agrees with HEC-RAS 2D; combined mass balance closes

Gate C closes Phase 2 (urban physics). The build plan sets two criteria:

1. **FloodSim agrees with HEC-RAS 2D** on cases that exercise the Phase 2 physics (buildings, culverts and channels,
   pipes, storage, green infrastructure).
2. **The combined mass balance closes**: surface, pipe network, culverts, rivers, GI stores, tanks and roof
   connections book the same water.

This folder holds the preparation: the mass-balance audit and the HEC-RAS comparison set-up.

## Mass balance

### Criteria

| Books | Criterion | Why |
|---|---|---|
| Surface solver (GPU, fp32) | \|error\| ≤ 1e-5 of throughput | Round-off level; the scheme itself conserves to 1e-15 in fp64 |
| SWMM network continuity | \|error\| ≤ 0.5 % | SWMM's own routing continuity (dynamic wave, SLOT surcharge) |
| Combined, all models | \|error\| ≤ 0.5 % of rain + piped roof rain | Dominated by SWMM's continuity; everything else exchanges exact volumes |

### Fixed while preparing: fp32 drift at heavy-exchange cells

Gate B showed a slow volume drift where cells take in and pass on water every step for hours: −1.2e-4 in EA Test 4
(20 m³/s through four cells), 4e-4 in Test 7 (524 river-bank cells). The scheme conserves exactly in fp64 (the CPU
reference stays at 1e-15 on the same case), so the drift was fp32 round-off. A cell near steady state repeats nearly the
same update each step, so its rounding has the same sign each time and accumulates instead of cancelling.

The fix keeps a Kahan residual for every cell's depth in the spare fourth component of the state vector. Every depth
update goes through one compensated add: both Runge–Kutta stages, rain and infiltration, and the exchange. The per-inlet exchange
totals are compensated the same way. Volumes are booked as depth minus residual. On the Test 4 inflow (2 h) the error
went from −4.7e-5 to −3e-6, and across the GPU suite mass errors fell 10–100× (Stoker dam break 1.3e-8 → 4e-10,
rain-on-grid 2e-7 → 2e-8). Tiled and untiled runs stay bit-identical.

### Audit

`mass-audit.js` drives the map app through complete runs (storm plus 30 min) with every exchange model on and closes:

    rain on the surface + roof rain piped to the sewer
      = infiltration (incl. GI stores) + surface edge outflow (incl. polygon edges) + pipe outfalls
        + surface storage (incl. water inside culverts) + network storage (incl. tanks) + overflow lost at lid-only manholes

Results (25 Oct 2026; storm + 30 min; `results/gatec-mass-*.json`):

| Site | What is on | Rain + piped roof rain | Surface | SWMM continuity | Combined |
|---|---|---|---|---|---|
| Ellicott City MD, 2 m | pipes, 50 % downspouts, 10 OSM culverts, permeable pavement 50 %, rain gardens 10 %, green roofs 50 %, 2,000 m³ tanks | 41,759 m³ | 5.8e-6 | −0.14 % | **−0.0044 %** |
| South Street, Philadelphia, 1 m | 127 real PWD inlets, synthetic pipes, 30 % downspouts | 16,576 m³ | 4.1e-7 | −0.35 % | **−0.26 %** |
| West Hollywood CA, 2 m | tier 1 linked pipes, rain gardens 5 % | 23,799 m³ | −1.1e-6 | −0.08 % | **−0.0075 %** |
| Seattle WA polygon, 2 m | polygon sink edge, permeable pavement 30 %, custom 75 mm/1 h | 12,147 m³ | −2.4e-7 | −0.09 % | **−0.0084 %** |

All four close within the criteria. The combined residual is SWMM's own routing continuity: on South Street the pipes
carried 14,060 m³, most of the water, and the 43 m³ residual is their −0.345 % exactly; every volume exchanged
between the models matches.

**Two-way inlet exchange** (manholes pressurise; water returns through the inlet on the head difference, as in
HEC-RAS), same four sites and storms, against the inlets-in-only coupling:

| Site | Inlets in only: combined / SWMM | Two-way: combined / SWMM | Pipes back up? | Flooding > 15 cm, max depth |
|---|---|---|---|---|
| Ellicott City | −0.0044 % / −0.14 % | −0.0044 % / −0.14 % | no | identical |
| South Street | −0.26 % / −0.35 % (649 m³ spilled at rims) | **−0.12 % / −0.18 %** (224 m³ back up through inlets) | yes | identical (0.39 ha, 1.26 m) |
| West Hollywood | −0.0075 % / −0.08 % | identical | no | identical |
| Seattle polygon | −0.0084 % / −0.09 % | identical | no | identical |

Where the pipes back up, two-way exchange halves the balance error and leaves the flood picture unchanged; elsewhere it
changes nothing. With the Davis comparison (pump, wet well and node levels into line with HEC-RAS) it is now the app
default (Drainage → Two-way inlet exchange). Two bookkeeping points came out of the audit: SWMM books water sent back up
an inlet (negative lateral flow) as external outflow, so the combined balance now subtracts it (coupler
`totals.latOut`); and the audit now sets each scenario's storm explicitly, because the app keeps the storm choice
between builds.

A first pass found the surface books at ~1e-5 after 90 minutes on two sites. The per-cell infiltration, outflow and
clipping totals were fp32 sums of tiny increments. They are now folded into fp64 books and restarted on every state
read, so a GPU total never holds more than a few seconds of water; the surface errors fell 3–25×.

## HEC-RAS 2D comparison

### What reference material exists

USACE publishes no HEC-RAS 2D results as data. The 2D verification and validation report (RD-52) and the EA benchmark
report for HEC-RAS (RD-51) are figures and fit tables only. The example projects (7.0.2, 432 MB) ship inputs without
result files. The only HEC-RAS 2D results available as data are third-party runs: the open benchmark1d2d project ran
HEC-RAS 7.0.1 and 6.6 (SWE-ELM and SWE-EM) on EA Tests 1, 2, 4 and 5 and publishes probe series as JSON
(Apache-2.0). Anything with rain-on-grid over a city or a storm sewer means running HEC-RAS ourselves.

### Done: EA Tests 1, 2, 4, 5 against four HEC-RAS runs

`node benchmarks/gatec/hecras-ea.mjs` compares FloodSim's EA runs with each HEC-RAS run probe by probe (level where
both are wet, depth otherwise). To give "agrees" a scale, the same distance is measured between HEC-RAS and the other
established codes (LISFLOOD-FP ×3, TELEMAC-2D, ANUGA).

| Test | Median distance from HEC-RAS (all four runs) | Probes no further from HEC-RAS than the other codes |
|---|---|---|
| 1 Disconnected pond | 0.3 cm | 2 / 2 in each run |
| 2 Floodplain depressions, 48 h | 0.3 cm | 16 / 16 in each run |
| 4 Flat-plain flood wave | 0.1 cm | 6 / 6 in each run |
| 5 Dam-break valley | 0.8 cm | 7 / 7 in each run |

These cases test the core solver, not the Phase 2 physics, so they are necessary but not sufficient for Gate C.

### Done: rain on a plane (RD-52 §4.2.8)

HEC-RAS's own rain-on-grid verification case has an analytical answer (kinematic wave: the outlet rises as
q = (√S/n)(i t)^(5/3) until the time of concentration, then holds i·L). FloodSim follows the rising limb to about 1 %
at 1 m and reaches equilibrium exactly. The full equations round the corner at t_c, as expected. It is in the GPU suite.

### Done: HEC-RAS "Davis" storm sewer (rain on a city over a 132-pipe network with a pump)

HEC-RAS 7.0.2's own example (`Pipes/Davis`), run headless here, against FloodSim built from the same inputs:
1.2 in of rain over 6 h on a closed 5.76 km² area (Manning's n 0.06, no infiltration), 131 top inlets into a
132-pipe, 133-node network, and one pump into a downstream channel; 36 h. HEC-RAS runs 2,705 cells of 150 ft with
sub-grid tables on the terrain raster. FloodSim runs on that raster's own 8.8 m pixels (74,520 cells), with the pipes
in SWMM translated from HEC-RAS's geometry: same inverts, diameters, n, entry/exit losses, inlet orifice and weir,
pump curve and on/off levels. The pump discharges against the downstream level HEC-RAS computed.

| | FloodSim (two-way inlets) vs HEC-RAS | HEC-RAS SWE-ELM vs diffusion wave |
|---|---|---|
| Peak surface volume | 136,300 vs 128,800 m³ (+5.8 %), both at 6 h | −0.4 % |
| Peak flooded area > 15 cm | 29.7 vs 29.2 ha (+1.8 %) | 0.0 % |
| Maximum-depth map | median \|Δ\| 2.8 cm, 90 % within 6.9 cm, bias −1.0 cm; extent > 15 cm CSI 0.72 | 0.3 cm; CSI 0.95 |
| Pump peak, wet-well peak | 1.95 vs 1.92 m³/s; 12.23 vs 12.16 m | equal |
| Pipe-node peak levels | median \|Δ\| 37 cm | 0 cm |
| Pumped over 36 h | 121,300 vs 144,200 m³ (**−16 %**) | +0.2 % |
| Left on the surface at 36 h | 52,500 vs 31,500 m³ | 31,100 vs 31,500 m³ |
| Mass | surface 2e-6, SWMM −0.03 % | HEC-RAS volume error 0.13–0.14 % |

**What agrees:** where and how deep it floods (the surface criterion: median depth difference 2.8 cm, peak flooded
area within 2 %), and the pump's peak and the wet-well level.

**What differs, and why:**

- **Inlet exchange (fixed).** HEC-RAS lets a surcharged manhole's head rise above the ground and exchanges water through
  the inlet both ways on the head difference. FloodSim's coupler took water in only and spilled at the rim, which
  capped heads at ground level (no FloodSim node ever exceeded its rim, 45 HEC-RAS nodes did, up to 2.8 m) and starved
  the pump: 15 % less pumped, pump peak 1.69 m³/s. Driving FloodSim's SWMM network alone with HEC-RAS's own inlet flows
  isolates this: with manholes allowed to pressurise, SWMM pumps HEC-RAS's volume to −0.4 % (continuity −0.03 %); with
  rim spill, −12 %. The coupler now has a **two-way mode** (`new Coupler(..., { twoWay: true })`, manholes pressurised):
  return flow through the inlet orifice on the head difference, capped per manhole by what its pipes deliver so SWMM
  is never asked for water a node does not hold. It brought the pump peak, wet well and node levels into line and
  improved the depth map (median 3.7 → 2.8 cm). After the mass audit below it is the app default.
- **Residual ponding (open).** FloodSim leaves 21,000 m³ more on the street at 36 h, all of it in 3–30 cm ponds away
  from the inlets (16.7 ha at 10–30 cm against HEC-RAS's 9.9 ha). Running FloodSim on 44 m cells, about HEC-RAS's
  size, does not close it (50,900 m³ left), so it is not grid resolution as such. The likely cause is how HEC-RAS
  treats terrain inside a cell: one water level per 150 ft cell, which drains once it is above the lowest point of a
  face, even where a curb or ridge inside the cell would hold a puddle; FloodSim resolves those ridges at 8.8 m. On
  this flat, impervious example that decides 12 % of the rain. Which is closer to reality needs observations, not
  another model.

Reproduce: `node benchmarks/gatec/davis/model.mjs`; `node benchmarks/gatec/davis/hecras-run.mjs dwe` (and `swe`);
`node benchmarks/gatec/davis/hecras-extract.mjs dwe`; open `/benchmarks/gatec/davis/run.html?twoway=1`;
`node benchmarks/gatec/davis/compare.mjs`. Driving the pipes alone: `node benchmarks/gatec/davis/pipes-only.mjs dwe
[--pressurised]`. HEC-RAS needs its terms accepted at each launch from a plain Ras.exe; the driver launches it through
PowerShell `Start-Process` from the project folder, the only way it would compute.

### Still to do for Gate C

- Decide the residual-ponding question with data: a case with observed levels in the pipes and on the street (the
  Bellinge urban drainage dataset, CC BY 4.0, has gauged levels and rainfall) rather than a second model.
- Two further HEC-RAS cases, with the tools now in place: RD-52 §4.3.3 (rainfall over a model urban layout, Cea 2008, with measured
discharges) built and run headless in HEC-RAS, and the benchmark1d2d surcharge cases (A12-010/011/012), whose
HEC-RAS pipe inputs are published.


**Agreement criterion (proposed):** FloodSim is no further from HEC-RAS than the other established codes are on the
same case, and on surface quantities within the HEC-RAS SWE-ELM/SWE-EM spread plus 5 cm in level or 10 % in flooded
area. On Davis the surface measures meet it; total volume through the pipes does not (−16 %, explained above).
HEC-RAS is a reference, not the truth: benchmark1d2d found its dam-break fronts do not converge with mesh
refinement, and its own volume error on EA Test 2 is +1.4 %.
