# Street sandbox: report (17 Nov 2026)

Twelve test families, each with its answer and pass rule fixed before it ran. Every row is in
[RESULTS.md](RESULTS.md); the evidence for each finding is in `../../FINDINGS.md` (F12–F24). Nothing here is called
validated.

**The GPU rows are not yet run.** Everything below is the CPU surface solver with the production coupler and SWMM. The
GPU was still in use by the production runs.

## The short answer

- **The surface solver is right** on every case with a hand answer: rain on a street, a hollow filling and spilling,
  still water in a dip, no drainage, the depth of flow in a gutter.
- **Street detail survives only at 1 m.** A kerb, a crown and a 3 m hollow all hold at 1 m. Mapped from a 2 m run the
  crown is lost and the hollow is 2 cm out; from a 4 m run the crown is lost and the hollow is gone. The kerb survives
  both (F22). A 2 m grid also closes 1 m gaps between houses (F12).
- **Without pipe data, a surface-only run is an upper bound, not an estimate.** It is exact where nothing drains (a
  hollow, a yard). At a low point a drain serves it reads 0.42–0.66 m where the truth is 3–20 cm. An allowance does
  not fix this: it is still far too deep there and it drains hollows that nothing drains (F23).
- **"Too much down the drains" holds only where a pipe is the limit:** a pond that should be 20 cm reads 12 cm (F14).
  **On a grade it is the other way round:** the default grate takes about half of what the FHWA manual gives (F21,
  a diagnostic). And the synthetic network is not a 10-yr sewer: it carries 1.75 times its design flows before a
  manhole reaches the ground (F16).
- **The model box** cuts off water upslope and holds a pond at its edge (F13).
- **Owner-scale measures:** a rain garden, permeable paving and bare soil take exactly what their size says. A rain
  barrel on an existing house, a French drain, removing paving and a green roof on one house cannot be represented
  (F24).

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
| 8 | No drainage, the bowl neighbourhood | **Passed** | sag 0.485 / 0.572 / 0.627 m | the same to 0.03 mm |
| 8 | An allowance, the bowl neighbourhood | **Failed** its bound | at most 296 m³ on the ground (10-yr, 30 mm/h) | 344 m³: it removes 73–85 % of its nominal rate |
| 9 | Kerb, crown and hollow at 1 m | **Passed** (4 of 4) | gutter 0.050 m; lot and far gutter dry; hollow 0.098 m | 0.049; 0.000 and 0.003; 0.098 |
| 9 | The same from a 2 m run | kerb **Passed**; crown and hollow **Failed** | as above | gutter 0.060; far gutter 0.045; hollow 0.120 |
| 9 | The same from a 4 m run | kerb **Passed**; crown and hollow **Failed** | as above | gutter 0.060; far gutter 0.060; hollow 0.000 |
| 9 | Speed, the bowl neighbourhood | reported | – | 2 m: 8 × faster than 1 m (CPU), same houses exposed. 4 m: 73 × faster, 8 houses exposed against 6 |
| 10 | Sheffield rig: water down an open inlet | **Failed** (15 of 15) | 0.69–1.25 l/s measured | 1.13–1.93 l/s: 54–65 % more |
| 11 | Pipe network against four known answers | **Passed** 6 of 7 | see below | |
| 11 | Surface only against the same | **Passed** 3 of 10 | | |
| 11 | An allowance (30 and 50 mm/h) against the same | **Passed** 1 of 10 each | | |
| 12 | Rain garden, permeable strip, bare soil, held roof | **Passed** (10 of 10) | 1.752, 0.960, 2.600, 2.520 m³ left on the lot | 1.7520, 0.9600, 2.6000, 2.5200 |
| 12 | Rain barrel on an existing house, French drain, removing paving, one house's green roof | **Unsupported** | | no control for one owner's measure |
| – | A grate in a gutter on a grade (diagnostic, unscored) | – | HEC-22: 69–92 % of the flow taken | 26–40 % |
| 6, 9 | 4 m and 8 m subgrid modes | not yet run (GPU only) | | |

All rows are CPU rows.

## Where there is no pipe data (case 11)

Four streets whose true answer is worked by hand. Depths in metres; bold is outside the limit (2 cm or 20 %).

| Street | Storm | True | Pipe | Surface only | Allowance 30 mm/h | Allowance 50 mm/h |
|---|---|---|---|---|---|---|
| Sag, drain keeps up | 10-yr | 0.026 | 0.026 | **0.417** | **0.254** | **0.188** |
| | 100-yr | 0.036 | 0.036 | **0.558** | **0.415** | **0.343** |
| | 500-yr | 0.043 | 0.043 | **0.657** | **0.534** | **0.454** |
| Sag, drain cannot keep up | 10-yr | 0.043 | 0.039 | **0.417** | **0.254** | **0.188** |
| | 100-yr | 0.135 | 0.115 | **0.558** | **0.415** | **0.343** |
| | 500-yr | 0.205 | 0.188 | **0.657** | **0.534** | **0.454** |
| Hollow with no drain | 10-yr | 0.200 | – | 0.200 | **0.064** | **0.007** |
| | 100-yr | 0.200 | – | 0.200 | **0.169** | **0.097** |
| | 500-yr | 0.200 | – | 0.200 | **0.173** | **0.151** |
| Kerbed street on a grade | 100 mm/h | 0.0168 | **0.0219** | **0.0246** | 0.0204 | 0.0168 |

**What a report may say where there are no pipes.** A surface-only run shows where water gathers and how deep it
would stand if no drain took any. For a low point with no way out (a hollow below its rim, a yard) that is the
answer. For a street low point it is a ceiling: the report can say "water gathers here; how deep depends on drains
we have no record of", not "this floods to 40 cm". Do not add an allowance to make it look like an estimate.

The sags here are closed, the worst case for surface only. In an open street the ceiling is the height of the sag's
rim. On the bowl neighbourhood (case 8) no drainage was 15–21 cm deeper at the low crossing than the pipe network.

## Findings, by how much they matter to a home buyer's report

1. **F22. Street detail survives only at 1 m.** A coarse run loses the crown at 2 m and the small hollow at 4 m.
2. **F12. A 2 m grid closes 1 m gaps between houses.** A yard that drains reads 10.7 cm, over the threshold.
3. **F23. Surface only is an upper bound; an allowance is wrong both ways.**
4. **F13. The model box.** Cut across a slope it reads 38 % of the true depth. Its edge holds a pond like a wall.
5. **F21. Grates on a grade take about half of what HEC-22 gives.** A diagnostic; if it holds, hillsides shed too much
   water downhill.
6. **F14. A surcharged pipe carries too much.** SWMM's SLOT method adds 2–13 % by pipe size; the two-way exchange
   wobbles and adds more. Ponds at a sag read 8–39 % shallow.
7. **F16. "Sized for the 10-yr storm" is not a 10-yr sewer.**
8. **F24. Four owner-scale measures cannot be represented.** The ones that can are exact.
9. **F17. The allowance removes 73–85 % of its nominal rate.**
10. **F15. The grate's weir coefficient is 0.5 against 0.32 in the Sheffield rig.** Do not change it until F21 is
    settled: the two point opposite ways.
11. **F18. Two non-default settings fail without limit:** spill at the rim, and EXTRAN with two-way exchange.
12. **F19, F20.** Read depths from the 1 m map, never from coarse cells. The wall rule's reach is in cells.

## What I recommend changing in FloodSim

For you to decide; nothing under `src/` was touched.

1. **Keep 1 m as the only grid for anything a buyer reads.** Treat plain 2 m and 4 m runs as unfit for it. Whether
   the subgrid modes keep the detail is the open question; they run on the GPU and are not yet tested.
2. **Where there is no pipe data, run surface only and say so,** in the words above. Drop the allowance from the
   product. Report a street low point's depth as a ceiling.
3. **Draw the model box from the terrain,** and flag a house whose pond touches the edge.
4. **Register a grate-in-a-gutter case against HEC-22, then fix capture on a grade.** Leave the weir coefficient
   alone until then.
5. **Stabilise the two-way exchange** (cap the rate so the manhole head cannot pass the street level in one interval,
   or exchange every 0.5 s). Confirm on the GPU first.
6. **Stop calling the synthetic network a 10-yr sewer.**
7. **Owner what-ifs: offer a rain garden and permeable paving now** (both exact here). A rain barrel, a French drain
   and removing paving each need a control built first; until then leave them out and do not approximate them.
8. **Remove or guard** spill-at-the-rim and EXTRAN-with-two-way.

## Not done

- The GPU rows of every case, and the 4 m and 8 m subgrid modes, which run on the GPU only. One command,
  `node benchmarks/physics/street/run-browser.mjs`, then score.
- A registered grate-in-a-gutter case. The diagnostic is one street shape against a formula for one grate size.
- A true answer for a whole network: no case has one, so the pipe network is checked only on single streets.
- The Sheffield rig as a full 2D case: the paper does not give the flume's outlet setting.
- The South Street and tract runs were not re-examined; F12, F13 and F21 name the mechanisms to look for there.
