# Street sandbox: report (17 Nov 2026)

Ten test families, each with its answer and pass rule fixed before it ran. Every row is in [RESULTS.md](RESULTS.md);
the evidence for each finding is in `../../FINDINGS.md` (F12–F21). Nothing here is called validated.

**The GPU rows are not yet run.** Everything below is the CPU surface solver with the production coupler and SWMM. The
GPU was busy with the production batch.

## The short answer

- **The surface solver is right** on every case with a hand answer: rain on a street, a hollow filling and spilling,
  still water in a dip, no drainage, the depth of flow in a gutter.
- **"Too much down the drains" holds only where a pipe is the limit.** At a sag whose pipe is too small, a pond that
  should be 20 cm deep reads 12 cm. Two causes, both found (F14).
- **On a grade it is the other way round.** In a kerbed gutter the default grate takes about half of what the FHWA
  manual gives (F21; a diagnostic, not yet a registered case). The water it misses runs on downhill.
- **The synthetic network is not a 10-yr sewer.** It carries 1.75 times its design flows before a manhole reaches the
  ground, and about 3 times with water standing on the street (F16). SWMM's heads match a hand grade line to 1 cm.
- **The two things most likely to put a wrong depth against a house are not hydraulics.** A 2 m grid closes the 1 m
  gaps between houses (F12), and the model box cuts off water or holds it at its edge (F13).

Put together, for a hillside tract like 353.02: grates miss water, it runs downhill, and it leaves the box. The pipes
are never tested. That reading fits the production numbers; it has not been checked on those runs.

## Each case

| # | Case | Result | Expected | Measured |
|---|---|---|---|---|
| 1 | Rain on a tilted street | **Passed** (12 of 12) | outflow 22.22 l/s; depth 7.92 mm; steady in 317 s | 22.22 l/s; 7.95 mm; 319 s |
| 2 | A hollow under rain | **Passed** (12 of 12) | 0.120 m before it spills; 0.200 m at the rim after, whatever the storm | 0.1200 m; 0.2000 m; a storm twice as large: the same to 6e-8 m |
| 3 | One inlet, one pipe: rain above its capacity | **Failed** | pond 0.199 m | 0.121 m (app default); 0.599 m and rising (spill at the rim) |
| 3 | The same with a free outfall | **Passed** | 29.3 mm at the grate | 29.3 mm |
| 3 | The app's network under 10-, 100-, 500-yr rain | **Passed** its bound | manhole heads no higher than a hand grade line | within 1 cm. It backs up in every storm: sag 0.28 / 0.40 / 0.48 m deep at the peak |
| 4 | An outfall held 0.15 m above the street | **Failed** by 0.5 mm | street at 0.150 m (± 5 mm) | 0.1445 m (0.726 m and rising with spill at the rim) |
| 4 | The same with rain | **Failed** | pond 0.547 m | 0.471 m. With a free outfall: 0.044 m |
| 5 | Small box cut across a slope | **Failed**, as predicted | 10.1 mm | 3.8 mm (38 %) |
| 5 | Small box cut through a hollow | Passed **by accident** | 0.200 m | 0.209 m; 0.105 m and 0.340 m for a storm half and twice the size |
| 5 | Small box cut below the hollow's rim | **Passed** | 0.200 m | 0.200 m |
| 6 | Driveway dip beside a house | **Passed** at 0.5 and 1 m; at 2 and 4 m only on the 1 m map | 0.802 m | 1 m: 0.802; 2 m: 0.363 in its own cells, 0.818 on the 1 m map; 4 m: 0.146, 0.843 |
| 6 | Rear yard draining through a 1 m passage | **Failed** at 2 m | 0 | 0.107 m at 2 m (over the 10 cm threshold); 0.00 at 0.5, 1 and 4 m |
| 7 | The wall-exposure rule | **Passed** 11 of 11 at 1 m; failed at 2 m as predicted | – | at 2 m cells it reaches 4 m, not 2 m; the app only uses 1 m |
| 8 | No drainage | **Passed** | sag 0.485 / 0.572 / 0.627 m | the same to 0.03 mm |
| 8 | An allowance, no pipes | **Failed** its bound | at most 296 m³ on the ground (10-yr, 30 mm/h) | 344 m³: it removes 73–85 % of its nominal rate |
| 9 | 2 m run mapped to 1 m | end level **Passed**; against the 1 m run inside the limits | – | 8 × faster (CPU); houses' wall depths within 0.4 mm; same houses exposed |
| 9 | 4 m run mapped to 1 m | end level **Passed**; against the 1 m run outside one limit | – | 73 × faster (CPU); wall depths 4.7 cm out; 8 houses exposed against 6 |
| 10 | Sheffield rig: water down an open inlet | **Failed** (15 of 15) | 0.69–1.25 l/s measured | 1.13–1.93 l/s: 54–65 % more |
| – | A grate in a gutter on a grade (diagnostic, unscored) | – | HEC-22: 69–92 % of the flow taken | 26–40 % |
| 6, 9 | 4 m and 8 m subgrid modes | not yet run (GPU only) | | |

Cases 3, 4, 5, 6, 8 and 9 are CPU rows. The GPU rows of every case are not yet run.

## Drainage treatments on the same neighbourhood (case 8)

Peak depth at the low crossing, and houses exposed of 14:

| Storm | No drainage | Allowance 30 mm/h | Allowance 50 mm/h | Pipe network |
|---|---|---|---|---|
| 10-yr | 0.485 m, 6 | 0.386 m, 4 | – | 0.279 m, 0 |
| 100-yr | 0.572 m, 6 | 0.500 m, 6 | 0.457 m, 4 | 0.396 m, 4 |
| 500-yr | 0.627 m, 8 | 0.568 m, 6 | 0.531 m, 6 | 0.478 m, 4 |

Without pipes the answer here is 5 to 21 cm deeper and up to 6 more houses of 14 are exposed. Which column is right
cannot be read from this case; only the first is arithmetic. One made-up neighbourhood in a bowl.

## Findings, by how much they matter to a home buyer's report

1. **F12. A 2 m grid closes 1 m gaps between houses.** A yard that drains reads 10.7 cm, over the threshold.
2. **F13. The model box.** Cut across a slope it reads 38 % of the true depth. Its edge holds a pond like a wall.
3. **F21. Grates on a grade take about half of what HEC-22 gives.** A diagnostic; if it holds, hillsides shed too much
   water downhill.
4. **F14. A surcharged pipe carries too much.** SWMM's SLOT method adds 2–13 % by pipe size; the two-way exchange
   wobbles and adds more. Ponds at a sag read 14–39 % shallow.
5. **F16. "Sized for the 10-yr storm" is not a 10-yr sewer.**
6. **F17. The allowance removes less than its rate,** and no drainage is 15–21 cm deeper than pipes in the bowl.
7. **F15. The grate's weir coefficient is 0.5 against 0.32 in the Sheffield rig.** Do not change it until F21 is
   settled: the two point opposite ways.
8. **F18. Two non-default settings fail without limit:** spill at the rim, and EXTRAN with two-way exchange.
9. **F19. Read depths from the 1 m map,** never from coarse cells.
10. **F20. The wall rule's reach is in cells.** Harmless at 1 m.

## What I recommend changing in FloodSim

For you to decide; nothing under `src/` was touched.

1. **Wall exposure from 1 m runs only,** until coarsening keeps passages open. Add a check that counts the 1 m gaps a
   coarse mask closes.
2. **Draw the model box from the terrain,** and flag a house whose pond touches the edge.
3. **Register a grate-in-a-gutter case against HEC-22, then fix capture on a grade.** Leave the weir coefficient
   alone until then.
4. **Stabilise the two-way exchange** (cap the rate so the manhole head cannot pass the street level in one interval,
   or exchange every 0.5 s). Confirm on the GPU first.
5. **Stop calling the synthetic network a 10-yr sewer.** For the nationwide product, decide between a network that
   carries its design flow and no more, and an allowance with the no-drainage run beside it.
6. **Fix the allowance** so its rate is over the whole area, roofs included.
7. **Remove or guard** spill-at-the-rim and EXTRAN-with-two-way.

## Not done

- The GPU rows of every case, and the 4 m and 8 m subgrid modes, which run on the GPU only. One command,
  `node benchmarks/physics/street/run-browser.mjs`, then score.
- A registered grate-in-a-gutter case. The diagnostic is one street shape against a formula for one grate size.
- The Sheffield rig as a full 2D case: the paper does not give the flume's outlet setting.
- The South Street and tract runs were not re-examined; F12, F13 and F21 name the mechanisms to look for there.
