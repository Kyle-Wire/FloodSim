# Coupled 1D–2D cases with exact answers (benchmark1d2d A12-010, A12-011, A12-012)

Three verification cases of the open benchmark project
[benchmark1d2d](https://github.com/scott-jeffers/benchmark1d2d) (`test_catalog/track_a/coupled_1d2d`, "analytic-public"),
run on the production pieces: the GPU surface solver, EPA SWMM 5.2 with the options the app writes, and the app's
Coupler exchanging every 2 s. Each answer follows from continuity or the geometry, so they test the exchange between
the pipes and the ground, and that no water is made or lost on the way. They stand in for EA Test 8B (a surcharging
sewer) until the EA supplies its data (`benchmarks/ea/TEST8.md`).

## Result (5 Nov 2026, NVIDIA Blackwell GPU, Chrome WebGPU)

**22 of 22 measures pass**, in both exchange modes (`score.md` has every row):

| Case | What it tests | Spill at the rim | Two-way (app default) |
|---|---|---|---|
| A12-010 Manhole surcharging onto a sloping street | The manhole passes the whole 0.5 m³/s onto the street; the street carries it at normal depth, 77.68 mm | 0.5000 m³/s; 77.7 mm at both points; books −0.49 % | the same; books −0.49 % |
| A12-011 Flooded yard draining into a pipe | 270 m³ in a walled yard drains through a gully with its crest 5 cm up: the yard settles at the crest, 225 m³ leaves | level 0.0545 m (±1 cm); 220.9 m³ out (−1.8 %, ±2 %); books −0.03 % | 0.0546 m; 220.6 m³ (−1.95 %); books −0.09 % |
| A12-012 Surcharge onto a hollow and back | A 180 m³ storm overflows a manhole; all of it returns down the manhole and leaves | 180.4 m³ out; 0.004 m³ left on the surface; books +0.25 % | 180.0 m³; 0.004 m³; books +0.03 % |

Books: surface plus pipes at the end against what came in and went out. The tolerance is 0.5 %, the Gate C criterion
for SWMM's own continuity (README). The surface solver's own books close to round-off in every run. The
`surfaceRel` in A12-012's records reads −3e-3 because it is scaled by the net exchange, which ends near zero; in
absolute terms it is about 10⁻⁵ m³. What is left is SWMM's continuity error (at most 0.55 %), which the combined
books carry.

### A12-011 and the inlet crest

The first run (b9734c5) passed 20 of 22. FloodSim's inlets then opened at their cell's bed, so the gully's 5 cm
crest was a 1 m cell raised 5 cm. Water running onto the raised cell was shallower than the yard around it, so the weir
read about two-thirds of the yard's head. The last centimetre drained about half as fast as a sharp weir would: 7 mm
above the crest at two hours, 219.3 m³ out (−2.5 %). No water was lost: what had not drained was still in the yard.

Inlets now take a crest (`crest` on the network's inlet, m above the cell's bed; `src/drainage.js` inletFlow,
`src/coupler.js`). The gully cell stays at the yard's level and takes water only above the crest, on the head over
it. The yard ends 4.5 mm above the crest, close to the ~3 mm a sharp weir on the full head would leave, and the outfall
volume is inside the tolerance (the two-way run only just, at −1.95 %).

## Translation notes

- 1 m cells, as the catalog's grids. The manhole is an inlet on the cell holding its point (the cell north-east of a
  point on a corner). The catalog's rim or crest above that cell's bed is the inlet's crest: 5 cm in A12-011,
  2.5 mm in A12-010, where the rim sits at x = 25 m and the cell's centre at 25.5 m. A rim below the cell's bed lowers
  the cell to it (A12-012's cone apex, 7 mm).
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
