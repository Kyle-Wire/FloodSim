# Street sandbox: report (17 Nov 2026)

Thirteen test families, each with its answer and pass rule fixed before it ran. Every row is in
[RESULTS.md](RESULTS.md); the evidence for each finding is in `../../FINDINGS.md` (F12–F24 and the sets appended after
them). Nothing here is called validated.

**Both executors have run.** All 108 cases ran on the production GPU solver as well as on the CPU solver, and the two
agree to three or four digits. The numbers below are with the three fixes of [FIXES.md](FIXES.md) in place; that page
gives each one before and after.

## The short answer

- **The surface solver is right** on every case with a hand answer, on the CPU and on the GPU: rain on a street, a
  hollow filling and spilling, still water in a dip, no drainage, the depth of flow in a gutter.
- **Street detail survives only at 1 m.** A kerb, a crown and a 3 m hollow all hold at 1 m. Mapped from a plain 2 m run
  the crown is lost and the hollow is 2 cm out; from a plain 4 m run the crown is lost and the hollow is gone (F22).
  **The 4 m subgrid mode keeps the kerb and the crown** but reads the hollow 3 cm shallow and a driveway dip 12 %
  shallow; the 8 m mode is worse on each. A plain 2 m grid also closes 1 m gaps between houses (F12); the subgrid
  modes do not.
- **Without pipe data, a surface-only run is an upper bound, not an estimate.** It is exact where nothing drains (a
  hollow, a yard). At a low point a drain serves it reads 0.42–0.66 m where the truth is 3–20 cm. An allowance does
  not fix this: it is still far too deep there and it drains hollows that nothing drains (F23).
- **"Too much down the drains" holds only where a pipe is the limit.** A pond that should be 20 cm read 12 cm; with
  the exchange fixed it reads 15 cm, and what is left is inside SWMM (F14). **On a grade it is the other way round:**
  the default grate takes 26–40 % of the flow where the FHWA manual gives 69–91 % (F21). And the synthetic network is
  not a 10-yr sewer: it carries 1.75 times its design flows before a manhole reaches the ground (F16).
- **The model box** cuts off water upslope and holds a pond at its edge (F13).
- **Owner-scale measures:** a rain garden, permeable paving and bare soil take exactly what their size says. A rain
  barrel on an existing house, a French drain, removing paving and a green roof on one house cannot be represented
  (F24).

## Each case

GPU and CPU rows agree unless both are given.

| # | Case | Result | Expected | Measured |
|---|---|---|---|---|
| 1 | Rain on a tilted street | **Passed** (24 of 24) | outflow 22.22 l/s; depth 7.92 mm; steady in 317 s | 22.22 l/s; 7.95 mm; 319 s |
| 2 | A hollow under rain | **Passed** (23 of 24) | 0.120 m before it spills; 0.200 m at the rim after, whatever the storm | 0.1200 m; 0.2000 m. The one failure is the GPU's surface books in one run: 1.4e-5 against 1e-5 |
| 3 | One inlet, one pipe: rain above its capacity | **Failed** | pond 0.199 m | 0.150 m (0.121 CPU, 0.128 GPU before the fix); 0.599 m and rising with spill at the rim |
| 3 | The same with a free outfall | **Passed** | 29.3 mm at the grate | 29.3 mm |
| 3 | The app's network under 10-, 100-, 500-yr rain | **Passed** its bound | manhole heads no higher than a hand grade line | within 1 cm. It backs up in every storm: sag 0.28 / 0.40 / 0.48 m deep at the peak |
| 4 | An outfall held 0.15 m above the street | **Passed** | street at 0.150 m | 0.1500 m (0.1445 CPU, 0.1465 GPU before the fix) |
| 4 | The same with rain | **Failed** | pond 0.547 m | 0.491 m (0.471 before the fix). With a free outfall: 0.044 m |
| 4 | SWMM's own continuity where water comes back up an inlet | **Failed** | within 0.5 % | 17–19 % of a few cubic metres; 0.8–1.1 % with rain |
| 5 | Small box cut across a slope | **Failed**, as predicted | 10.1 mm | 3.8 mm (38 %) |
| 5 | Small box cut through a hollow | Passed **by accident** | 0.200 m | 0.209 m; 0.105 m and 0.340 m for a storm half and twice the size |
| 5 | Small box cut below the hollow's rim | **Passed** | 0.200 m | 0.200 m |
| 6 | Driveway dip beside a house | **Passed** at 0.5 and 1 m; at 2 and 4 m only on the 1 m map; **Failed** in the subgrid modes | 0.802 m | 1 m: 0.802; 2 m: 0.818 on the 1 m map; 4 m: 0.843; 4 m subgrid: 0.707; 8 m subgrid: 0.614 |
| 6 | Rear yard draining through a 1 m passage | **Failed** at 2 m and at 8 m subgrid | 0 | 2 m: 0.107 m (over the 10 cm threshold); 4 m subgrid: 0.010; 8 m subgrid: 0.030; 0.00 at 0.5, 1 and 4 m |
| 7 | The wall-exposure rule | **Passed** (17 of 17) | – | 12 hand cases; the 2 m case failed before the fix |
| 8 | No drainage, the bowl neighbourhood | **Passed** | sag 0.485 / 0.572 / 0.627 m | the same to 0.03 mm |
| 8 | An allowance, the bowl neighbourhood | **Failed** its bound | at most 296 m³ on the ground (10-yr, 30 mm/h) | 344 m³: it removes 73–85 % of its nominal rate |
| 9 | Kerb, crown and hollow at 1 m | **Passed** (4 of 4) | gutter 0.050 m; lot and far gutter dry; hollow 0.098 m | 0.049; 0.000 and 0.003; 0.098 |
| 9 | The same from a plain 2 m run | kerb **Passed**; crown and hollow **Failed** | as above | gutter 0.060; far gutter 0.045; hollow 0.120 |
| 9 | The same from a plain 4 m run | kerb **Passed**; crown and hollow **Failed** | as above | gutter 0.060; far gutter 0.060; hollow 0.000 |
| 9 | The same in the 4 m subgrid mode | kerb and crown **Passed**; hollow **Failed** | as above | gutter 0.040; far gutter 0.000; hollow 0.069 |
| 9 | The same in the 8 m subgrid mode | kerb **Passed**; crown and hollow **Failed** | as above | gutter 0.047; far gutter 0.010 (the limit); hollow 0.071 |
| 9 | Speed and agreement with the 1 m run, the bowl (GPU) | reported | – | 2 m: 2 × faster. 4 m: 3.5 ×, 8 houses exposed against 6. 4 m subgrid: 5.6 ×, same houses, wall depths within 3 mm. 8 m subgrid: 13 ×, same houses, within 11 mm |
| 10 | Sheffield rig: water down an open inlet | **Failed** (15 of 15) | 0.69–1.25 l/s measured | 1.13–1.93 l/s: 54–65 % more |
| 11 | Pipe network against four known answers | **Passed** 6 of 7 | see below | |
| 11 | Surface only against the same | **Passed** 3 of 10 | | |
| 11 | An allowance (30 and 50 mm/h) against the same | **Passed** 1 of 10 each | | |
| 12 | Rain garden, permeable strip, bare soil, held roof | **Passed** (20 of 20) | 1.752, 0.960, 2.600, 2.520 m³ left on the lot | 1.7520, 0.9600, 2.6000, 2.5200 |
| 12 | Rain barrel on an existing house, French drain, removing paving, one house's green roof | **Unsupported** | | no control for one owner's measure |
| 13 | A gutter on a grade: its depth | **Passed** (18 of 18) | 11.0–35.9 mm (HEC-22) | within 0.7 mm |
| 13 | The grate in that gutter: share of the flow it takes | **Failed** (18 of 18) | 69–91 % (HEC-22) | 26–40 % |

The bowl's speed figures are for a 1.2 ha scene, where run time is mostly overhead; they understate what a large area
gains.

## Where there is no pipe data (case 11)

Four streets whose true answer is worked by hand. Depths in metres; bold is outside the limit (2 cm or 20 %).

| Street | Storm | True | Pipe | Surface only | Allowance 30 mm/h | Allowance 50 mm/h |
|---|---|---|---|---|---|---|
| Sag, drain keeps up | 10-yr | 0.026 | 0.026 | **0.417** | **0.254** | **0.188** |
| | 100-yr | 0.036 | 0.036 | **0.558** | **0.415** | **0.343** |
| | 500-yr | 0.043 | 0.043 | **0.657** | **0.534** | **0.454** |
| Sag, drain cannot keep up | 10-yr | 0.043 | 0.041 | **0.417** | **0.254** | **0.188** |
| | 100-yr | 0.135 | 0.121 | **0.558** | **0.415** | **0.343** |
| | 500-yr | 0.205 | 0.192 | **0.657** | **0.534** | **0.454** |
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

1. **F22. Street detail survives only at 1 m.** A plain coarse run loses the crown at 2 m and the small hollow at 4 m.
   The 4 m subgrid mode keeps the kerb and the crown but not the hollow's depth.
2. **F12. A plain 2 m grid closes 1 m gaps between houses.** A yard that drains reads 10.7 cm, over the threshold.
3. **F23. Surface only is an upper bound; an allowance is wrong both ways.**
4. **F13. The model box.** Cut across a slope it reads 38 % of the true depth. Its edge holds a pond like a wall.
5. **F21. Grates on a grade take under half of what HEC-22 gives,** so hillsides shed too much water downhill. The
   gutter flow itself matches HEC-22 to 0.7 mm.
6. **F14. A surcharged pipe carries too much.** The exchange's wobble is fixed (0.121 → 0.150 m against 0.199 by
   hand). SWMM's SLOT method, which adds 2–13 % conveyance by pipe size, is inside SWMM and remains.
7. **F16. "Sized for the 10-yr storm" is not a 10-yr sewer.**
8. **F24. Four owner-scale measures cannot be represented.** The ones that can are exact.
9. **F17. The allowance removes 73–85 % of its nominal rate.**
10. **F15. The grate's weir coefficient is 0.5 against 0.32 in the Sheffield rig.** Do not change it until F21 is
    settled: the two point opposite ways.
11. **F18. Spill-at-the-rim exchange fails without limit.** It is not the default. EXTRAN with two-way exchange is now
    refused.
12. **F19.** Read depths from the 1 m map, never from coarse cells.
13. **GPU surface books** reach 1.4e-5 to 1.9e-5 in three long or coupled runs, against a 1e-5 limit. Small, and
    recorded.

## What I recommend changing in FloodSim

For you to decide. Items 5 and 8 are done in this branch (FIXES.md).

1. **Keep 1 m as the only grid for anything a buyer reads.** A plain 2 m or 4 m run is unfit for it. The 4 m subgrid
   mode is the only coarse option that keeps kerbs and crowns; it still under-reads small hollows and dips by 3–10 cm.
2. **Where there is no pipe data, run surface only and say so,** in the words above. Drop the allowance from the
   product. Report a street low point's depth as a ceiling.
3. **Draw the model box from the terrain,** and flag a house whose pond touches the edge.
4. **Fix capture on a grade,** against case 13. It needs the speed of the water at the grate, which the exchange does
   not carry, so it touches the GPU kernels. Leave the weir coefficient alone until then.
5. **Done: the two-way exchange is stable.**
6. **Stop calling the synthetic network a 10-yr sewer.**
7. **Owner what-ifs: offer a rain garden and permeable paving now** (both exact here). A rain barrel, a French drain
   and removing paving each need a control built first; until then leave them out and do not approximate them.
8. **Done: EXTRAN with two-way exchange is refused, and the wall rule's reach is in metres.** Spill-at-the-rim is left
   as it is: document it, or remove the option.

## Not done

- A true answer for a whole network: no case has one, so the pipe network is checked only on single streets.
- The fixes have not been run on a real network (Charlotte, Forest Hills), and the app's own run path with them
  (the SLOT fallback and the node area it passes) has not been exercised in a browser run.
- The Sheffield rig as a full 2D case: the paper does not give the flume's outlet setting.
- The South Street and tract runs were not re-examined; F12, F13 and F21 name the mechanisms to look for there.
