# Infrastructure import and culvert hydraulics: audit (10 Nov 2026)

What the code does today, checked against the review's recommendations. Read from `src/linked.js`,
`src/network-real.js`, `src/infra.js`, `src/drainage.js` (`toINP`), `src/coupler.js`, `src/links.js` and
`src/river.js`, and from METHODS §5.12.1. No runs.

## The finding that changes the plan

**The pipe solver is EPA SWMM 5.2.4 (dynamic wave), and it already has most of the culvert hydraulics the review asks
for.** The vendored build has the `HORIZ_ELLIPSE`, `ARCH` and `FILLED_CIRCULAR` shapes. SWMM 5.2 also takes an FHWA
HDS-5 culvert code per conduit in `[XSECTIONS]`, which applies inlet control. Outlet control, submerged barrels and
reverse flow come from dynamic wave. Overtopping happens on the 2D surface, where the road embankment is in the lidar.

So FloodSim does not need a new culvert solver. It needs to give SWMM the right inputs, and to check the result on
cases with known answers. Every gap below is an input or bookkeeping gap, not missing physics.

## 1. Ingestion (`linked.js` `pipeRecords`, `network-real.js` `realNetwork`)

| Review item | Today | Gap |
|---|---|---|
| Shape preserved | Only `box/rect/rcb` (→ `RECT_CLOSED`) and `arch` (→ an equal-area `RECT_CLOSED` of the rise) are recognised. Everything else, `Elliptical` included, is `CIRCULAR` at the rise. | Map ellipse to `HORIZ_ELLIPSE`/`VERT_ELLIPSE` and arch to `ARCH`, which SWMM handles natively, so no equivalent shape is needed. The Sheffield Dr arch's equal-area rectangle is a real approximation (wrong hydraulic radius, wrong area–depth curve). Switching it to `ARCH` moves a corrected result, so it gets its own experiment. |
| Roughness from material | Not read. Every real pipe gets `opts.n` (0.013). | Read material (`MATL`/`MATERIAL`): CMP about 0.024, concrete 0.013, PVC/HDPE 0.011. Report which pipes defaulted. |
| Direction | Rule 8 flips any length whose recorded inverts rise along its drawn direction. Rule 3a undoes this only for a main arriving at a dead end. | Lengths are flipped one at a time. A culvert digitized in several lengths can come out as outfalls back to back (Edwards Branch). **Caution:** "trust the endpoint inverts" would also get this crossing wrong. Its GPS endwalls are 0.37 m adverse (east 205.13, west 205.50), and the creek runs east to west. A barrel (a run of lengths with the same shape, size and material, endwall to endwall) should be oriented as one unit, by its drawn direction and connectivity. Dynamic wave carries adverse slopes and reverse flow, so the orientation only matters for finding outfalls. |
| Catch basins vs barrel floor | A node takes the inverts the layer gives its pipe ends. Rule 10 bridges a culvert's middle only where no invert is given. | Extend rule 10: inside a barrel, an interior invert that stands above the line between the endwall inverts by more than a set share of the rise is a connection invert. The floor there is interpolated, and the structure stays a node with its own inlet. |
| Provenance survives ingestion | One boolean per pipe (`given`) and counts in `stats`. Whether an invert was bridged, carried at ground slope, repaired from a hump or derived from lidar is lost per pipe. | Add a per-end source (`layer`, `bridged`, `carried`, `repaired`, `derived`), plus `filledSize` and a roughness source. Carry them into the H&H Report so the reader can see which values are assumed. |
| Condition / obstruction | Drawn culverts (`infra.js`): `D·√open`, a smaller circle of the open area. Real-network pipes: none. | A sediment depth per conduit as a scenario. `FILLED_CIRCULAR` covers circles. For other shapes, use a `CUSTOM` shape curve cut at the sediment level, with the invert raised by the same depth. This is exact, not an equivalent shape. Area-scaling a circle gets the hydraulic radius wrong. |

## 2. Culvert hydraulics (`drainage.js` `toINP`, `network-real.js` culvert entrances, `links.js`)

- **No culvert code is written.** `[XSECTIONS]` stops at `Barrels`, so SWMM never applies HDS-5 inlet control. Inlet
  control is approximated instead by the surface exchange at the entrance node: a weir on the barrel width (Cw 0.37 ×
  √2g ≈ 1.64 SI) and an orifice on the barrel area (Co 0.6). Writing the code is a one-column change. The exchange
  then has to be wide enough that it does not become a second, stacked control. The benchmark will show whether it is.
- **No `[LOSSES]` section.** SWMM's entrance and exit losses are zero for every barrel, so outlet control leaves out
  the Ke and exit terms that HDS-5 includes.
- **Two culvert models.** OSM-mapped and drawn culverts go through `CulvertLinks` → `river.js culvertFlow`. That model
  is circular only, takes critical depth as 2/3 of the head (true for a rectangle, not a circle) and uses the area at the
  mean end depth. Real-network culverts go through SWMM. The same crossing can therefore behave differently depending
  on where its data came from. Longer term, route drawn culverts through SWMM as well. In the meantime, keep
  `culvertFlow` as the simple fallback and say so.
- Overtopping is physical: the embankment comes from the lidar. At Charlotte's 2 m grid a narrow road crest may be
  smoothed, and the benchmark should vary the grid to measure this.

## 3. Benchmarks that exist, and the gap

- Unit tests: `culvertFlow` is zero below the invert, rises monotonically with head and matches the full-barrel orifice
  (`run-phase2-tests.mjs`); `CulvertLinks` conserves water; culvert entrance and bridging rules (`run-infra-tests.mjs`).
- Coupled harness: `benchmarks/gatec/coupled/` (A12-010/011/012) runs the real GPU solver, SWMM and the Coupler, with
  mass books. This is the place for culvert cases. No new harness is needed.
- EA Tests 1–8 cover 2D surface behaviour.
- **Gap:** nothing tests a culvert through the coupled path against an independent answer. The review's suite A–D
  (free outlet, submerged outlet, overtopping, obstruction) fits the existing harness: a flume DEM with an embankment
  and one barrel, a steady inflow stepped through several discharges, and headwater compared with HDS-5 inlet- and
  outlet-control calculations at each step. Run it for circle, box and ellipse; at two tailwaters; past the crest; at
  three sediment depths; at two grid sizes and two coupling intervals. Measures: the mass books, monotonic headwater in
  Q, no jump at the inlet/outlet-control switch, and convergence. HDS-5 is the reference for the barrel-only steps, not
  for the coupled overtopping steps, which are checked for continuity and the trend.

## 4. On the Charlotte matrix (C1–C5)

Agreed, with one change of order: **C2 (topology) before C1 (shape)**. While the crossing is two outfalls back to back,
the barrel's shape barely matters, so C1 run first would show almost no effect and could be misread. Proposed order:
C2 → C1 (with material roughness) → C3 → C4 (clear / partly filled / filled to the approach lidar, 0.24 m below the
crown) → C5. The baseline is the corrected extended run, 211.35 m. Hydrology stays frozen. The conditional predictions
in METHODS §5.12.1 stand.

## Proposed build order

1. **Ingestion:** shape mapping, material roughness, orienting a barrel as one unit, connection inverts inside a
   barrel, per-end provenance. Unit tests in `run-infra-tests.mjs`. No change to circular-only networks, so the
   existing cases do not move.
2. **SWMM culvert inputs:** the culvert code column, `[LOSSES]`, sediment as `FILLED_CIRCULAR` or `CUSTOM`. Off by
   default until step 3 passes.
3. **Culvert benchmark A–D** in `benchmarks/gatec/coupled/`, scored like A12.
4. Charlotte C2 → C1 → C3 → C4 → C5, one change per run.
5. Channel and floodplain benchmarks (backwater, contraction, splitting), and multi-event checks (June and August
   have not been rerun since the Sheffield fix).
