# EA Tests 8A and 8B: urban rainfall and a surcharging sewer (not run yet)

Tests 8A and 8B are the two urban cases of the Environment Agency benchmark (Néelz & Pender 2013, SC120002, §4.9–4.10
and Appendix A.8–A.9). They are the closest the suite comes to what FloodSim is for: rain on a street grid, and a pipe
that surcharges through a manhole onto it. They are the gap in Gate B (README: 88 / 94 on Tests 1–7).

## Where the data stands (checked 5 Nov 2026)

- The **specification is public**: Appendix A.8–A.9 of `source/SC120002_Report.pdf` (summarised below).
- The **input files are not public**. `source/Benchmarking_Model_Data.zip` (GOV.UK, 52 MB) holds Tests
  1–7 and the Test 5/6 cross-sections only. The open benchmark project
  [benchmark1d2d](https://github.com/scott-jeffers/benchmark1d2d) re-hosts EA Tests 1, 2, 4, 5 and 6A, not 8.
- The other ZIP on the GOV.UK publication page, *LIT 8570* (7.6 MB, checked 5 Nov 2026), holds only the report and its
  two-page summary (`SC120002 report.pdf`, `SC120002 summary.pdf`): no data. So the inputs have to come from the EA.
- **Results are figures, with one table.** Water levels and velocities at the output points are plotted
  (Figures 4.42–4.44, 4.46–4.48), so bands will be read by eye as for Tests 1–7. The one numeric table is Table 4.11,
  the total volume through the 8B manhole: 4,954–5,840 m³ across nine packages.

## The specification (Appendix A.8–A.9)

Both tests: Cockenzie Street, Glasgow, about 0.4 × 0.96 km (0.388 km²); bare-earth LiDAR DTM at 0.5 m, ground 21–37 m;
model grid 2 m (~97,000 cells); all boundaries closed; dry start; run to t = 5 h. Manning's n 0.02 on roads and
pavements, 0.05 elsewhere. Output: peak level and peak depth grids, and level and velocity every 30 s at the output
points. Inflows and rain are linearly interpolated.

| | 8A: rain and a point source | 8B: a surcharging sewer |
|---|---|---|
| Sources | Uniform rain on the modelled area only (peak 400 mm/h, 3 min time base, t ≈ 1–4 min); a point inflow peaking at 5 m³/s about 35 min later (~15 min time base) | A 1,400 mm circular culvert, ~1,070 m long, invert 2 m below ground; inflow at its upstream end; baseflow 1.6 m³/s; free outfall downstream; a 1 m² vertical manhole 467 m down the pipe links it to the 2D grid at one point |
| Buildings | Ignored (bare earth) | Taken into account: outlines provided, roofs at least 1 m above ground |
| Exchange | — | Surface water does not affect the manhole outflow |
| Files | `Test8DEM.asc`, `Test8A-rainfall.csv`, `Test8A-point-inflow.csv`, `Test8A-inflow-location.csv`, `Test8Output.csv`, `Test8Road_Pavement_polyg_region` (shapefile), `Test8RoadPavement.asc` | The same DEM, output points and road/pavement files, plus the upstream pipe inflow and the building outlines (file names not given in the report) |

What the report says the packages agreed on (§4.9.3, §4.10.3), and so what a band can hold FloodSim to:

- 8A: peak depth over 0.5 m at point 1, full-SWE codes within ~5 % of the depth; points 2, 4, 7 peaks within ~0.04 m;
  final level at point 3 (the downstream pond, ~0.8 m deep) within a ~0.07 m range. Points 6, 8, 9 are too shallow for
  the bed differences between codes, as with Test 6A's gauges.
- 8B: point 1 peaks within ~6 % of the depth; point 3 final level within ~0.08 m (~0.7 m deep); manhole volume
  4,954–5,840 m³.
- Velocities differ by 30–100 % between codes in both tests; the report draws no band from them, and nor will this.

## How FloodSim will run them

- **8A** needs two things the Gate B runner (`lib.mjs runCase`) does not have yet: rain on the grid and a per-cell
  Manning's n (roads from `Test8RoadPavement.asc`). The solver has both; the runner passes neither. The point source
  goes in like the other tests' inflows.
- **8B** uses the production coupling, as the map app does: the culvert is a SWMM conduit (1.4 m circular, inflow at
  the top node, baseflow 1.6 m³/s, free outfall), the manhole a SWMM junction at 467 m with a 1 m² surface link on its
  cell, and the coupler exchanges every 2 s. The spec's one-way link (surface water does not drive the manhole) is
  stricter than FloodSim's two-way exchange; the run will report both the scored one-way case and the two-way one, as
  ISIS 2D did (5,075 m³ linked). Buildings become walls (mask), as in the map app.
- Scoring joins `score.mjs` with bands read from the figures, each widened by its reading precision, and the Table 4.11
  volume as given.

Until the data arrives, the coupled analytic cases A12-010, A12-011 and A12-012 of benchmark1d2d test the same
exchange with answers known exactly: a manhole surcharging onto a street (the street's normal depth), a flood draining
into a pipe (the crest level and the volume out), and a surcharge that returns down the manhole (all of it, 180 m³).

## Request to the Environment Agency (draft, not sent)

To: enquiries@environment-agency.gov.uk (the contact the GOV.UK publication page gives for these files)

> Subject: Request for the Test 8A/8B data set, SC120002 2D benchmarking
>
> Dear Environment Agency research team,
>
> I develop FloodSim, a two-dimensional urban flood model coupled to EPA SWMM 5 for storm sewers. We have run Tests 1
> to 7 of *Benchmarking the latest generation of 2D hydraulic modelling packages* (Néelz & Pender, 2013, report
> SC120002) from the data published on GOV.UK and compared our results with the spread of the participating packages.
>
> Appendix A.8–A.9 describe the Test 8A and 8B data sets (Test8DEM.asc, the rainfall and point-inflow tables, the
> output points, the road and pavement outlines, and for 8B the pipe inflow and building outlines), but they are not
> in the public archive. Could you send them, or tell us where to obtain them and on what licence? If the participants'
> result series for Tests 8A and 8B can also be shared, we would use them to score our runs, with credit to the Agency
> and the report.
>
> We would report the results the same way as for Tests 1–7, citing the report and the Open Government Licence or whatever
> terms you set.
>
> Thank you,
> Kyle Wire, FloodSim
</content>
</invoke>
