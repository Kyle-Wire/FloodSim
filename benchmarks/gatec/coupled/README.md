# Coupled 1D–2D cases with exact answers (benchmark1d2d A12-010, A12-011, A12-012)

Three verification cases of the open benchmark project
[benchmark1d2d](https://github.com/scott-jeffers/benchmark1d2d) (`test_catalog/track_a/coupled_1d2d`, "analytic-public"),
run on the production pieces: the GPU surface solver, EPA SWMM 5.2 with the options the app writes, and the app's
Coupler exchanging every 2 s. Each answer follows from continuity or the geometry, so they test the exchange between
the pipes and the ground, and that no water is made or lost on the way. They stand in for EA Test 8B (a surcharging
sewer) until the EA supplies its data (`benchmarks/ea/TEST8.md`).

## Result (5 Nov 2026, NVIDIA Blackwell GPU, Chrome WebGPU)

**20 of 22 measures pass**, in both exchange modes (`score.md` has every row):

| Case | What it tests | Spill at the rim | Two-way (app default) |
|---|---|---|---|
| A12-010 Manhole surcharging onto a sloping street | The manhole passes the whole 0.5 m³/s onto the street; the street carries it at normal depth, 77.68 mm | 0.5000 m³/s; 77.7 mm at both points; books −0.49 % | the same; books −0.49 % |
| A12-011 Flooded yard draining into a pipe | 270 m³ in a walled yard drains through a gully with its crest 5 cm up: the yard settles at the crest, 225 m³ leaves | level 0.0571 m (pass, ±1 cm); **219.4 m³ out (−2.5 %, fail, ±2 %)**; books +0.30 % | 0.0571 m; **219.3 m³ (−2.5 %)**; books +0.26 % |
| A12-012 Surcharge onto a hollow and back | A 180 m³ storm overflows a manhole; all of it returns down the manhole and leaves | 180.4 m³ out; 0.004 m³ left on the surface; books +0.25 % | 180.0 m³; 0.004 m³; books +0.03 % |

Books: surface plus pipes at the end against what came in and went out. The tolerance is 0.5 %, the Gate C criterion
for SWMM's own continuity (README). The surface solver's own books close to round-off in every run. The
`surfaceRel` in A12-012's records reads −3e-3 because it is scaled by the net exchange, which ends near zero; in
absolute terms it is about 10⁻⁵ m³. What is left is
SWMM's continuity error (−0.45 % to +0.55 %), which the combined books carry.

### The one miss: A12-011's last centimetre drains slowly

No water is lost. The 219.3 m³ out plus the 51.4 m³ still in the yard make the 270 m³ it started with. The yard is
7 mm above the crest after two hours, inside the level tolerance, but those 6 m³ have not drained yet. A sharp weir with
the catalog's coefficient, draining 900 m² from the same start, would be about 3 mm above the crest at two hours.
FloodSim drains the last centimetre about half as fast. The cause is the translation: FloodSim's inlet opens at its
cell's bed, so the 5 cm crest is a 1 m cell raised 5 cm. The weir law reads the depth on that cell, and water running
onto the raised cell is shallower than the yard around it. The approach head is about two-thirds of the yard's head,
so the flow is about half of a weir on the full head. In a real model the grate sits in the street's lowest cell,
not on a step, so this case's crest is the unusual part. Treat it as a known limit: an inlet with a crest above the
cell around it under-drains the last few millimetres.

## Translation notes

- 1 m cells, as the catalog's grids. The manhole is an inlet on the cell holding its point (the cell north-east of a
  point on a corner), and that cell's bed is set to the catalog's rim or crest.
- Weir Cw·P·h^1.5·√(2g) and orifice Co·A·√(2gh) with the catalog's Cw 0.5, Co 0.6, P 1.885 m, A 0.283 m².
- A12-010's open street end is FloodSim's free-outfall edge (Manning flow on the surface slope), the default for
  every real model edge. The probe points, 75 and 125 m below the manhole, are where the catalog scores normal depth.
- SWMM options are the app's (`src/drainage.js` toINP), including its 1.2 m² minimum node area. With the manhole's own
  0.28 m² as the minimum area, SWMM's continuity error on A12-011 was −1.0 to −1.4 % and the books failed. The app's
  setting is the one tested.

## Reproduce

Start the server (`npm start`), open `/benchmarks/gatec/coupled/run.html` (or `?cases=A12-011`). Results go to
`benchmarks/gatec/results/gatec-coupled-*.json`. Then `node benchmarks/gatec/coupled/score.mjs` writes `score.md`.
Dawn under Node crashed on this machine (the repo's own `npm run test:gpu:dawn` too), so the runner is a browser page,
as for Gate B and Davis.
