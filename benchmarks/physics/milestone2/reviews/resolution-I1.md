# Resolution of technical review I1 (12 Nov 2026): PV-TF1 draft 3

Nothing was run, hashed, registered or frozen. No existing criterion changed.

## Objection 1: the full-conduit guard (`fullConduitGuard`, `parameters.conduitGuardDepthFrac`)

**Change.**
- **G-node** (draft 2's endpoint guard) is retained unchanged.
- **G-link** is added: at every routing step of the whole run, for every conduit segment C1…CN,
  LINK_DEPTH / LINK_FULLDEPTH < 0.9. LINK_FULLDEPTH must read 1.0 m, or the case is an Invalid setup.
- Either guard reaching 0.9 at any step means Invalid setup for scoring.
- The decision comes from the complete per-step series.
- For each N the record keeps:
  - the maximum ratio and the depth;
  - the segment or node where it occurs;
  - the step index and simulated time;
  - every segment's maximum over the run.

**Source variables.**

| Quantity | API | SWMM source |
|---|---|---|
| Conduit depth | `swmm_getValue(411, link)`, `swmm_LINK_DEPTH` | returns `link->newDepth` (`swmm5.c`), which `dwflow.c` line 287 sets to `MIN(yMid, yFull)`, with `yMid = 0.5·(y1 + y2)` (line 150) |
| Conduit full depth | `swmm_getValue(405, link)`, `swmm_LINK_FULLDEPTH` | `xsect.yFull` |
| Node depth (G-node) | `swmm_getValue(303, node)`, `swmm_NODE_DEPTH` | `node->newDepth` |

### Limitation, stated rather than assumed: what "the maximum water depth in a conduit segment" can mean in SWMM

**SWMM keeps no depth profile along a conduit.** Its dynamic-wave update (`dwflow.c` lines 107–128) forms:
- two end depths, y1 = h1 − z1 and y2 = h2 − z2, from the end nodes' heads and the conduit's invert (node invert plus
  offset);
- each floored at FUDGE and, under EXTRAN, capped at the full depth;
- and their mean, yMid.

**Only yMid (capped) is stored for the link, and it is what LINK_DEPTH returns.**
- y1 and y2 are local variables and are not exposed.
- `Conduit.fullState`, SWMM's full/part-full flag, is stored but has no getter in the production API.
- The crown cutoff acts through `getWidth` on y1, y2 and yMid separately (`dwflow.c` lines 470–472, 602).

So:
1. **G-link uses the actual link-depth variable, as required.** It is SWMM's only stored conduit depth. Because it is a
   mean, a segment can have one end at or above 0.96 D while yMid is below 0.9 D. **G-link alone therefore cannot
   exclude F1.**
2. **SWMM's conduit end depths are, by its own construction, derived from the end nodes.** In PV-TF1's geometry (every
   offset declared 0), `findSurfArea` cannot replace them with a critical or normal depth: `getFlowClass` assigns
   UP_CRITICAL or DN_CRITICAL only when an offset is above 0 (`dwflow.c` lines 297–360). The only possible classes are
   SUBCRITICAL, DRY, UP_DRY and DN_DRY. In those, y1 and y2 are the end nodes' depths (floored at FUDGE, capped at full
   depth), or FUDGE when dry, never larger. So G-node bounds y1 and y2 exactly.
3. **The two guards together cover every depth SWMM uses in a conduit in this geometry:** y1 and y2 through G-node, yMid
   through G-link.
   - This is not an inference of conduit depth from node depth. It is SWMM's definition of the end depths, cited above.
   - Review I1 rejected node depths as a substitute for conduit depth. Whether this source-cited equivalence is
     acceptable is **the reviewer's decision**. I have not assumed it.

**If the equivalence is not acceptable,** the check as specified (the maximum conduit depth from link variables) cannot
be implemented with the production API. The only way to observe y1, y2 and `fullState` directly would be read-only
getters in the instrumented build (`benchmarks/culvert/instrumented/`), which already adds one getter (420). That
would need:
- saving y1 and y2 in the link structure (two assignments), with no change to any computed value;
- the per-case equivalence check against production that is already proposed for getter 420;
- your authorisation, since it is a change to a SWMM copy, and blocker 3 (instrumented values in scored rows) is
  undecided.

None of that is done here.

## Objection 2: rest hydraulic equilibrium (`restHydraulicEquilibrium`, `criteria.restInternalWseAbsM` = 0.001 m)

**Change.**
- At every routing step of the rest window, every intermediate junction's and every conduit segment's water-surface
  elevation must lie within 1 mm of the common tank water-surface elevation.
- The existing flow and weir conditions are retained.
- A violation means Insufficient reference data.
- For each N the record keeps the maximum deviation, its location, the step index and the simulated time, separately for
  junctions and conduits.

**Source variables.** Everything is compared as absolute elevations in SWMM's datum, never as raw depths.

| Quantity | API | SWMM source |
|---|---|---|
| Tank and junction water surface | `swmm_getValue(304, node)`, `swmm_NODE_HEAD` | `newDepth + invertElev` (`swmm5.c`) |
| Common tank water surface | mean of T1's and T2's NODE_HEAD | — |
| Conduit water surface | z_mid + LINK_DEPTH (411) | z_mid = mean of the two ends' NODE_ELEV (`swmm_getValue(301, node)`, `invertElev`) plus the declared offsets, which are 0 |

If LINK_DEPTH equals LINK_FULLDEPTH, the cap binds and the surface is undefined, so the condition is not met. At the
reference level, 0.507 D, it cannot bind.

**Limitation.** As with objection 1, the conduit surface is SWMM's single stored conduit depth. There is no other water
surface inside a conduit to check. In this horizontal, zero-offset geometry it is the mean of its end nodes' heads by
construction. The check is kept so that it observes that equality rather than assuming it.

**Supported as specified: yes.**

## Every routing step (both checks)

- Both checks run in the per-step callback of `SWMM.stepTo` (`src/swmm.js`): one `swmm_step` per call, and
  `swmm5.c` `execRouting` runs exactly one `routing_execute` per `swmm_step`. The getters read the state at the end of
  that step.
- G-node and G-link cover all 43 200 steps of the run. The equilibrium check covers all 3 600 steps of the rest window.
- The step count and each step's length are recorded. A difference from the declared fixed 1 s makes the case an
  Invalid setup, rather than leaving steps unchecked.

## Integrity

**Unchanged:**
- the closure and level criteria (closureRel, equilibriumAbsM, restLevelDiffM, restLevelDriftM);
- restSegmentFlowAbsM3s, sealFluxAbs, junctionVolumeAbsM3, nodeVolumeRel;
- the 180.0 m³ inflow, the geometry and the boundary conditions;
- P1, P2a, P2b and P3.

`restInternalWseAbsM` is the one addition to `criteria`, recorded as criteria draft 3 in `proposedCriteriaHistory`.
The guard is a validity parameter, not a criterion.

## Unresolved

1. **(blocking, for the reviewer)** Is the source-cited equivalence of SWMM's conduit end depths to the end nodes'
   depths, in this zero-offset geometry, acceptable for the end-depth part of the F1 exclusion? If not, the
   instrumented-build getters above need authorisation, and PV-TF1 cannot be approved until they exist and pass an
   equivalence check.
2. **(non-blocking)** The conduit water-surface check is implied by the junction and tank checks in this geometry. It is
   kept as an observation; the reviewer may judge it redundant.
