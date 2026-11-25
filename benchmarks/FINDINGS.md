# Verification findings register

Covers the culvert suite (`culvert/`, Stage A) and the physics suite (`physics/`, Milestone 1). Written in the Milestone 1
closure pass (11 Nov 2026, after review 4).
- No registered result, criterion, tolerance or benchmark definition was changed in this pass.
- Every new run is a diagnostic under a `diagnostics/` or `results-diagnostics/` folder, and none is scored.
- The registered runs remain the official results:
  - physics `results/2026-11-11T18-57-58-574Z/`;
  - culvert `results/` (MANIFEST 2026-11-11T20:15Z) and the frozen rounds.

**Severity**
- **High:** it could make a validated claim false.
- **Medium:** it biases results that production also produces, or blocks a claim we would like to make.
- **Low:** provenance, or a declared limit of the domain.

**Status**
- **Open:** cause unknown.
- **Explained:** cause identified, with the evidence below.
- **Documented:** a known limit, stated.

Under the registered definitions, an explained finding's rows keep their registered status.

| ID | Finding | Severity | Status | Rows affected (registered status kept) |
|---|---|---|---|---|
| F1 | PV-X1-b: 0.17 m³ of the 3.6 m³ fault missing from the books | Medium | Explained: SWMM accounting | PV-X1-b closure rows: Failed, as expected (the fault is caught) |
| F2 | PV-U1: four steep-trapezoid failures | Medium | Explained: physical model (SWMM's inertial damping) | 4 PV-U1 rows Failed |
| F3 | T2-C: part-full continuity −2.1 to −5.3 % | Low for steady results; Medium for event volumes | Explained: one long link filling | 13 T2 accounting rows Failed |
| F4 | PV-C1-b: the part-full pipe in motion has no independent volume | Medium (blocks a claim) | Documented | C1-b in motion: Insufficient reference data |
| F5 | PV-C1 does not test conservation under a net inflow | Medium (coverage) | Documented (found through F1) | none; a coverage gap |
| F6 | PV-P1 Darcy–Weisbach: +9.6 to −16.5 % | Low | Documented | Not independently validated (outside the validated results) |
| F7 | Swamee–Jain cross-check: 1.8 % at Re 10⁴ | Low | Documented: outside the declared domain | none (Re ≥ 10⁵ only) |
| F8 | Culvert round 2 has no snapshot | Low (provenance) | Documented | none |
| F9 | B7 window: two runs flagged on exactly 50 % of rows | Low | Documented | none (diagnostic, not wired) |

---

## F1. PV-X1-b: the injected volume that the books do not find

**Evidence** (`physics/diagnostics/x1b-books.mjs` → `out/x1b-books.json`).
- **Unfaulted** (C1-a), the books close to 1e-13 m³.
- **With the fault**, the volume is accounted as follows:

  | Term | m³ |
  |---|---|
  | Declared | 3.6000 |
  | Series as written (it includes a 1 s ramp) | 3.6005 |
  | Applied by SWMM (Σ NODE_LATFLOW·dt) | 3.6011 |
  | Gained in the tanks (A·d) | 3.4325 |
  | Pipe (full throughout) | 0 change |
  | Sealing weir | 0 |
  | Residual against the applied inflow | −0.1686 |

- Our books and SWMM's own node volumes agree exactly.
- SWMM's own continuity report shows the same loss: 0.033 % of 513 m³.
- **The loss is a fixed share of the net inflow, 4.68 %:**
  - for 1 h, 2 h, the whole run, and the series without its ramp point;
  - so it is neither the fault's shape nor its duration.

**Cause.** SWMM's EXTRAN crown cutoff (`dwflow.c` `getWidth`; `dynwave.c` `EXTRAN_CROWN_CUTOFF` = 0.96):
- A full closed conduit still adds surface area to each end node: (w₁ + w_mid)·L/4, with w taken at 0.96 D, so 4.90 m²
  for this pipe.
- A storage node that is not surcharged rises by dV / (A + 4.90) rather than dV / A.
- The storage curve holds only A/(A + 4.90) of a net inflow; the rest is stored nowhere.

**Hypothesis test.** The predicted retained share comes from the geometry alone and matches every variant to about
1×10⁻⁴:

| Variant | Predicted | Observed |
|---|---|---|
| As registered | 0.95330 | 0.95319 |
| Pipe 100 m | 0.91076 | 0.91067 |
| Pipe D 1.0 m | 0.91076 | 0.91067 |
| Tanks 1000 m² | 0.99512 | 0.99501 |

- The ~1×10⁻⁴ left over is about the size you'd expect from SWMM interpolating its circle geometry from a table, the
  same order as F4's at-rest check. It is not chased further.
- C1-a closes exactly because the exchange is symmetric: the false area takes equal and opposite errors at the two
  tanks.

**Reading.**
- This is a real SWMM accounting loss, not a reconstruction error.
- The fault-detection result stands: X1-b is caught.
- **PV-X1 is not evidence that mass accounting is validated (F5).**

**Production relevance.**
- Any non-surcharged storage node joined to a full closed conduit, with a net inflow or outflow, under EXTRAN.
- The loss scales with the conduit surface area against the storage area.
- Production defaults to SLOT surcharge, so whether this applies there is **not yet checked**.

**Next action.**
1. Milestone 2 spec: a PV-C1 case with a declared net inflow, scored against these books.
2. A separate check of the same effect under SLOT.
3. No change to production.

## F2. PV-U1: the four steep-trapezoid failures

**Evidence, along the whole conduit.** Saved `vsGVF` profiles, registered run.
- In all three steep-trapezoid configurations at n 0.02 (Q 1, 3, 6), SWMM matches GVF to 0.1 mm over the upper
  1.2–1.4 km.
  - So geometry, hydraulic radius and Manning agree; the gap is not there at the upstream end.
- The difference starts 250–300 m above the outfall and grows steadily toward it (Q 3: −0.4, −1.3, −3.7, −11.2, −31.9 mm
  at 250…50 m).
  - It is a progressive downstream drawdown, not a local step.

**Discretisation test** (`physics/diagnostics/u1-refine.mjs`): conduits of 100, 50, 25 and 12.5 m.

| Q, x above outfall | 50 m (registered) | 25 m | 12.5 m |
|---|---|---|---|
| Q 3, x 100 m | −11.2 mm | −9.5 mm | −8.3 mm |
| Q 6, x 150 m | −12.1 mm | −10.3 mm | −9.2 mm |

- It converges slowly toward a limit that is not zero, so it is mostly not discretisation.

**Equation test** (`physics/diagnostics/u1-options.mjs`): 50 m conduits as registered; only the routing options change.

| INERTIAL_DAMPING | Q 3 worst scored | Q 6 worst scored | Q 3 at 50 m |
|---|---|---|---|
| PARTIAL (registered, and production default) | 12.13 mm | 12.65 mm | −31.9 mm |
| NONE (inertial terms kept) | **0.94 mm** | **1.00 mm** | +0.2 mm |
| FULL (inertial terms dropped) | 18.52 mm | 19.51 mm | −37.6 mm |

- NORMAL_FLOW_LIMITED (BOTH, SLOPE, FROUDE) has no effect.

**Cause.** SWMM's PARTIAL damping reduces the inertial terms as the Froude number rises toward 1, as it does approaching
a free outfall. GVF keeps the full energy equation. With the inertial terms kept, SWMM reproduces GVF within the
registered criterion.

**Reading.**
- This is a **physical-model** difference: the equation SWMM solves.
- The rows are registered as `numerical`, and the Milestone 1 README called this "a numerical finding about SWMM's
  outfall drawdown on 50 m conduits". **The evidence supersedes that reading.**
- The rows stay Failed.
- Reclassifying their error type needs a definition revision, which is the reviewer's decision.

**Production relevance.**
- `src/drainage.js:409` and `src/river.js:51` use PARTIAL.
- Near-critical reaches approaching a free outfall are biased low: here up to 30–50 mm at the last junction, and more
  than 1 mm over the last ~300 m.
- Not acted on.

**Next action.**
1. Reviewer: decide the error-type revision.
2. Milestone 2: make damping an explicit, declared axis in the GVF family (C).
3. No production change without a separate decision.

## F3. T2-C: the part-full continuity error

**Evidence** (`culvert/t2c-books.mjs` → `results-diagnostics/t2c-books.json`).
- **The books,** from the applied inflow, the outfall inflow and the stored volume at the end, reproduce SWMM's
  reported error exactly in all 42 runs.
- **The error is a fixed volume, not a rate.**
  - Standard section, Q 0.1: the residual is −20.69 m³ whether the hold is 1800, 3600 or 7200 s (−9.84 / −5.30 /
    −2.76 %).
  - The same holds at Q 0.5 (−57.4 m³) and Q 1.5 (−140.3 m³), in both sections.
  - The registered percentage is that one-off volume divided by the total throughput.
- **It shrinks as the single 400 m barrel is cut into segments,** while the final stored volume stays the same:

  | Segments | Standard, Q 0.1 | Exact, Q 0.1 | Standard, Q 1.5 | Exact, Q 1.5 |
  |---|---|---|---|---|
  | 1 (registered) | −5.30 % | −5.29 % | −2.40 % | −2.28 % |
  | 4 | −1.29 % | −1.41 % | −0.76 % | −0.58 % |
  | 16 | −0.29 % | −0.44 % | −0.35 % | −0.15 % |
  | 32 | −0.11 % | −0.28 % | −0.28 % | −0.08 % |

  - One irregular case: standard, Q 0.5 crosses zero (+0.12 % at 16 segments, +0.22 % at 32). It is recorded and not
    explained.
- **Geometry, depth by depth** (the critic's tables, with conveyance K = A·R^(2/3)/n computed here):
  - Exact section against the true ellipse: A within 0.63 %, P 1.19 %, R 0.55 %, K 0.58 % at every depth.
  - Standard section: K −7.0 to +14.1 %.
  - Both sections give the same continuity error, so **geometry is ruled out.**

**Cause.** The fill transient on a single long link. SWMM gives the conduit one volume, at its mid-depth area. Outflow
begins at the downstream end before the barrel has filled, so outflow plus final storage exceeds the inflow by about
half the barrel's final volume. Steady depths are unaffected: the implementation rows pass to 0.1 mm.

**Next action.**
1. T2-C stays Failed under T2's registered definition.
2. Test whether B6-C's −15 m³ fixed term is the same mechanism. It is a hypothesis, untested.
3. In production, check the share of long single conduits that fill from dry within an event.

## F4. PV-C1-b: the part-full pipe in motion

**Can validate:**
- the volume closure wherever every volume is exact: the tanks always, a full pipe, any pipe at rest (one level);
- the equilibrium level from the initial volume alone;
- the boundary flux;
- SWMM's node volumes against A·d.

**Cannot validate:** the volume of a part-full pipe while the water moves.

**Evidence** (`physics/diagnostics/c1b-linkvol.mjs` → `out/c1b-linkvol.json`).
- The instrumented build's conduit volume (getter 420) is SWMM's `aMid · L` (`dwflow.c` line 291). It equals the PV-C1-b
  estimate L·A(link depth) to 1.8×10⁻⁴, so it is the same quantity, not an independent one.
- It falls outside the end-depth bracket on 56 samples, by at most 0.0005 m³.
- At rest it matches the exact L·A(h) to 1.1×10⁻⁴.

**Status.** C1-b in motion stays Insufficient reference data. SWMM's continuity is still reported separately.

**Next action (Milestone 2 spec).** A case with a known profile in motion, such as uniform flow in a single part-full
circular pipe, where L·A(y_n) is exact. That checks the getter independently before the getter is used for any
reconstruction.

## F5. PV-C1 coverage: no net inflow

**Finding.** PV-C1's closed cases exchange water symmetrically between the tanks, so an error proportional to net
inflow cancels (F1). PV-C1's Passed rows show closure for a closed, symmetric exchange only.

**Status.** Stated in this register. The PV-C1 rows are unchanged.

**Next action.** The F1 net-inflow case.

## F6–F9 (documented limits)

- **F6. Darcy–Weisbach.**
  - SWMM's Manning loss is +9.6 % to −16.5 % against DW + Colebrook, with k_s from the Strickler equivalence.
  - That is a model-form difference under an assumed equivalence. It stays Not independently validated and is outside the
    validated results.
- **F7. Swamee–Jain.**
  - 1.78 % at Re 10⁴ against Colebrook. The cross-check is declared for Re ≥ 10⁵ only.
  - The low-Re observation stays in `physics/references/refs.test.mjs` as an observation, kept for later transitional
    cases.
- **F8. Round 2.**
  - It was overwritten in place by the round 3 run and has no snapshot. This is stated in
    `culvert/results/round3-2026-11-11/NOTE.md` and in the culvert README.
  - Baseline, round 1 and round 3 verify against their `SHA256SUMS`, re-checked in this pass.
  - Round 2's own files are not recoverable. The claim is "baseline, round 1 and round 3 preserved", not "all rounds".
- **F9. B7 window.**
  - Two misses are caught over 60 s only because the threshold is ≥ 50 %: they are flagged on exactly 50 % of rows.
    With > 50 % the window catches one.
  - Stated in the culvert README, "Stage A closure" §5. Not wired.

## Held

These are held until this register is reviewed:
- Milestone 2 implementation: its specs and reference inventory may be prepared.
- Production wiring.
- Any use of Charlotte other than as an integration test.

## Review 5 resolutions (12 Nov 2026), appended; the text above is unchanged

Review 5's second pass is kept in `physics/milestone2/reviews/review-5-2026-11-12.md`. With this record, **Milestone 1
is accepted with qualifications and formally closed in that form.** The open findings below stay open; closure means
their status is settled and recorded, not that they are resolved.

| Finding | Resolution |
|---|---|
| F1 | **Explained, not resolved.** The evidence is EXTRAN-specific and is kept as is. Whether the loss occurs under SLOT is an open, untested question |
| F2 | **The four PV-U1 rows remain Failed.** A versioned error-type definition revision is *prepared, not applied*: `physics/spec-revisions/PV-U1-definition-revision-1.md`. It classifies the PARTIAL inertial-damping discrepancy as physical-model, with the subtype routing-equation approximation. The registered criteria, spec and results are unchanged |
| F3 | **Explained, with its registered T2-C failures kept.** The unexplained Q 0.5 segmentation behaviour (standard section; +0.12 % at 16 segments, +0.22 % at 32, a sign change) is kept open within F3 |
| F4 | **Insufficient reference data,** unchanged |
| F5 | **A documented coverage gap,** unchanged |
| F6–F9 | Unchanged |
| PVM2 naming | **Confirmed:** Physics Verification Milestone 2 (PVM2), prefixes TF, ST, RV, SX, NW |

Still held:
- PVM2 execution, until its independent reviews approve PV-TF1;
- production wiring;
- production routing settings;
- any use of Charlotte other than as an integration test.

## Post-run findings from PVM2 PV-TF1 run 1 (12 Nov 2026), appended; unscored

These are recorded apart from the run's scored results (`physics/results/2026-11-12T15-00-21-588Z`), whose statuses are
unchanged: 19 Passed, 8 Insufficient reference data. The evidence is in `physics/milestone2/post-run/pv-tf1-run1/`.

### F10. SWMM's nominal slope on level conduits enters normal-flow limiting, per segment

**Mechanism.**
- SWMM replaces an end-invert drop below 0.001 ft with 0.001 ft (WARNING 04).
- Its only routing effect under PV-TF1's settings is the normal-flow cap `qNorm = beta·a1·r1^(2/3)`, with
  `beta ∝ √S` (`dwflow.c` lines 637–684).
- The momentum equation, friction, flow classification and Froude number do not use it.

**Size.** The slope is per segment (0.001 ft / L_seg), so the cap grows as √N: 0.011 / 0.021 / 0.043 / 0.061 m³/s at
the still-water level for N = 1 / 4 / 16 / 32. That is the same order as the 0.1 m³/s fill.

**In run 1.**
- During the fill, the trigger conditions held at about 20 % of conduit-steps, with flows at or above the cap. Whether
  the limiter actually fired is not observable: `Link.normalFlow` has no getter.
- After 2 h it is not credibly active: flows stay below 0.61·qNorm.

**Consequence.** It is a potential, unquantified confounder for any fill-path-dependent N comparison (P2a/P2b). It is
removable with `NORMAL_FLOW_LIMITED NONE`. Production uses BOTH, so flat production conduits carry the same nominal
slope.

**Status: open.**

### F11. PV-TF1's residual motion is the closed system's seiche, decaying by Manning friction

**Period.** The motion still present at 12 h has the period of the linear, frictionless eigen-mode of the lumped
network, independently computed, at every N (within 0.2 %):
- 666 s at N = 1, which has no internal node and so has a single mode;
- 455 s at N = 4;
- 444 s at N = 16 and 32, the continuum seiche.

It is unchanged by a 0.5 s step or by INERTIAL_DAMPING NONE.

**Decay.** The decay is algebraic (1/amplitude linear in time). Its coefficient follows from the Manning term (within
1 % at N = 1).

**Classification:** a physical mode of the governing equations, not a numerical oscillation. At about 7 mm/s, Manning
itself is outside its range of validity, which is a physical-model qualification.

**Consequence:**
- The registered rest flow condition (5e-6 m³/s per segment, every step) is not reached by passive decay in any
  practical duration. By extrapolation it takes 7–11 months, which is **not observed and not a defensible duration
  estimate.**
- SWMM's flow-reversal value of 0.001 cfs (2.83e-5 m³/s) lies above that condition, which is untested.
- A duration revision alone cannot make PV-TF1's rest definition attainable. A design revision is needed (see the
  post-run README).

**Status: open.**

## Street sandbox findings (17 Nov 2026), appended; the text above is unchanged

From the street sandbox, `physics/street/` (specs PV-SS1 to PV-SS10, registered 17 Nov 2026 before any case ran;
`physics/spec/REGISTRATION-2026-11-17.sha256`). Scored results: `physics/street/RESULTS.md`. Diagnostics are unscored
and kept in `physics/street/diagnostics/`. PV-SS10 was registered later the same day and is not a blind test.

Sources opened on 17 Nov 2026: FHWA HEC-22, 3rd ed. (§4.4.4.1, §7.1.5, §7.5); SWMM 5.2.4 `dwflow.c` (getSlotWidth,
getArea, getHydRad); Rubinato et al. 2017 and 2018. The kinematic-wave limit k > 20 of Woolhiser & Liggett (1967) is
as quoted by Morris & Woolhiser (1980); the 1967 paper itself could not be opened.

- The sandbox is not part of PVM2 and did not have PVM2's three reviews. Nothing below is a validation claim.
- **CPU rows only so far.** They use the CPU surface solver with this suite's copy of the GPU inlet rule, the
  production Coupler and SWMM. The GPU rows are not yet run. F14's wobble has to be confirmed on the GPU path before it
  is acted on.
- Severity here is judged for a home-buyer flood report: does it change the depth against a house, or whether the house
  is flagged?

| ID | Finding | Severity | Status | Rows affected (registered status kept) |
|---|---|---|---|---|
| F12 | At 2 m cells a 1 m gap between buildings closes; a yard that drains holds its rain | High | Explained | PV-SS6 yard-2: 2 Failed |
| F13 | The model box: cut across a slope it reads low; cut through a hollow its edge holds water like a wall | High | Explained | PV-SS5 up-small: 1 Failed; down-small: 2 Passed by accident |
| F14 | A surcharged pipe carries too much: SWMM's SLOT method, and the two-way exchange wobbles | High for ponding at a sag | Explained on the CPU path; GPU not yet run | PV-SS3 a: 4 Failed; PV-SS4 a, b, d: 10 Failed |
| F15 | The default grate takes about half as much again as the Sheffield rig measured | Medium | Explained; one rig, 1/6 scale | PV-SS10: 15 Failed |
| F16 | "Sized for the 10-yr storm" understates what the synthetic network carries | Medium (explains a production observation) | Documented | none: PV-SS3 d–f pass their bound |
| F17 | The allowance without pipes removes 73–85 % of its nominal rate | Medium for areas without pipe data | Explained | PV-SS8 allowance: 5 Failed |
| F18 | Spill-at-the-rim exchange, and EXTRAN with two-way exchange, give wrong answers without limit | Medium (neither is the default) | Explained | PV-SS3 b: 4 Failed; PV-SS4 c: 2 Failed |
| F19 | A coarse grid's own cells misread narrow dips; the 1 m map made from it does not | Medium | Documented | PV-SS6 drive-2, drive-4: 2 Failed |
| F20 | The wall rule steps two cells out, not 2 m | Low | Documented | PV-SS7 R12: 1 Failed |
| F21 | A grate in a gutter on a grade takes about half of what HEC-22 gives | High on hillsides, if it holds | **Open: a diagnostic, not a registered case** | none |

What passed is listed at the end.

### F12. At 2 m a gap between houses closes

**Evidence** (PV-SS6, rear yard: a terrace cut by a 1 m passage, the yard behind draining through it to the street).

| Grid | Depth beside the rear wall at the end | True |
|---|---|---|
| 0.5 m | 0.00 m | 0 |
| 1 m | 0.00 m | 0 |
| 2 m, solver cells | **0.107 m** | 0 |
| 2 m, on the 1 m map | **0.116 m** | 0 |
| 4 m | 0.00 m | 0 |

- The 2 m answer equals that grid's own arithmetic (0.1072 m): the yard holding its own 40 mm of rain and half the roof's.
  So the solver is right on the ground it was given; the ground is wrong.
- 0.107 m is over the 10 cm exposure threshold. The house is flagged at 2 m and not at 1 m.

**Cause.** `src/terrain.js` coarsen makes a cell a wall when more than half of it is building. The passage sits across
a 2 m cell boundary, so each 2 m cell along it is half building and half open: not more than half open, so a wall.
Downscaling cannot reopen it. At 4 m the opposite happens: every cell across the house row is under half building, the
row disappears, and the case passes for the wrong reason.

**Production relevance.** South Street: 27 cm in a rear yard at 2 m against 9 cm at 1 m. This is the same mechanism,
not yet checked on that run. Rowhouse blocks are full of 1 m passages.

**Proposed fix (Kyle to decide).**
1. Use 1 m for anything that reads water against a wall. Treat a plain 2 m or 4 m run as unfit for the wall rule.
2. Or keep openings through coarsening: a cell or face is open if a connected path of open 1 m cells crosses it (the
   subgrid mode's face tables may already do this; its cases are GPU only and not yet run).
3. A check the app can run before a coarse run: count 1 m passages the coarse mask closes, and warn.

### F13. The model box

**Evidence** (PV-SS5; `diagnostics/edge-pond.mjs`).
- **Cut across a slope.** A block 150 m below the divide. In a box that starts 120 m below the divide the block reads
  3.8 mm against a true 10.1 mm: 38 % of the truth, the hand answer (30.5 / 150.5)^0.6. In the whole box it reads
  10.1 mm.
- **Cut through a hollow.** The registered row passed (0.209 m against a true 0.200 m), against the prediction written
  with it. The diagnostic shows the pass is an accident:

  | Storm | Small box | True |
  |---|---|---|
  | 40 mm | 0.105 m | 0.160 m |
  | 80 mm (registered) | 0.209 m | 0.200 m |
  | 160 mm | 0.340 m | 0.200 m |

  Under 2 % of the rain left across the edge in all three.
- A box cut 7 m below the rim reads the true depth (0.200 m, peak 0.212 m).

**Cause.**
- The app's edge (`bc: 'outflow'`) lets nothing in, so ground upslope of the box sends no water.
- It passes water only on a water-surface slope toward the edge (beyond 1e-4). A level pond has none, so the edge holds
  it like a wall. The depth is then set by the storm and by how much of the hollow is inside the box, not by the rim.

**Production relevance.** Tract 353.02 lost 23–35 % of its rain across the edge. That water was running downhill off
the box, which is right only if nothing downstream holds it back. And any pond that touches the edge is unreliable in
either direction.

**Proposed fix.**
1. Draw the box from the terrain, not from a fixed size: it must hold everything that drains to the house, and the
   rim of any hollow the house is in.
2. Flag a result as edge-affected when the peak pond at the house touches the model edge, or when the house's
   contributing area (from a wider DEM) crosses it.
3. Do not read the share of rain leaving the edge as a loss: on a slope it is correct.

### F14. A surcharged pipe carries too much

**Evidence** (PV-SS3 a, PV-SS4 a, b, d; `diagnostics/slot-capacity.mjs`, `diagnostics/one-pipe.mjs`). One grate over one
0.15 m pipe that cannot carry the rain; the outlet held at a level; the pond's level by hand from Manning's full-pipe
friction and the grate's orifice.

| Case | By hand | FloodSim (app settings) | Exchange every 0.5 s, SWMM ≤ 0.25 s |
|---|---|---|---|
| Rain above the pipe's capacity, pond at 7200 s | 0.199 m | **0.121 m** | 0.148 m |
| The same with the outlet 0.15 m above the street | 0.547 m | **0.471 m** | 0.489 m |
| No rain, outlet 0.15 m above the street | 0.150 m | 0.1445 m | 0.148 m |

Two causes, separated:

1. **SWMM's SLOT surcharge method (the app's default) counts the slot as flow area.** SWMM alone, a full pipe under a
   held tailwater, loss against Manning's:

   | Pipe | 0.5 m over the crown | 1.0 m | 1.5 m |
   |---|---|---|---|
   | 0.15 m | × 1.051 | × 1.092 | × 1.134 |
   | 0.30 m | × 1.026 | × 1.047 | × 1.068 |
   | 0.375 m | × 1.021 | × 1.038 | × 1.054 |
   | 0.60 m | × 1.013 | × 1.024 | × 1.034 |

   (Conveyance against Manning's.) EXTRAN gives × 1.0002 in every case. The slot is 1 % of the pipe's width, and its
   area above the crown is added to the pipe's; the excess is about 0.9 × (0.01 D h) / (π D² / 4) for a mean
   surcharge h. This answers F1's open question for SLOT in part: SLOT has its own, different, departure.
2. **The two-way exchange wobbles.** With the app's 2 s exchange the rate set for the grate changed sign in 178 of the
   last 300 exchanges; the manhole head swung by 3 cm (standard deviation), and its mean stood 2 cm **above** the
   street water while water was, on average, going in. The pipe is driven harder than the street's level allows. With
   the exchange four times as often the swing falls to 3 mm and the pond rises to the level Manning gives with the
   slot's extra conveyance (0.148 m, 0.489 m).

SWMM's continuity error is 0.8–1.2 % in these runs (limit 0.5 %), and 10–16 % when water comes back up the inlet
(small volumes: about 1 m³).

**Reading.** Both push the same way: too much water down the pipe, too little left on the street. Here the pond is
39 % and 14 % too shallow. The size depends on pipe diameter and surcharge: small pipes under deep surcharge are worst.

**Production relevance.** Any inlet whose pipe is the limit. The production networks rarely surcharge (F16), so this is
not the main reason they flood little; where they do surcharge it biases low. The wobble is a property of the coupling
and should be confirmed on the GPU path (not yet run).

**Proposed fix.**
1. Make the exchange stable: limit the rate set for an interval so the manhole's head cannot pass the street's level
   within it (the rate that closes the head difference over the interval, given the node's storage), or exchange more
   often with SWMM stepping at most half the interval. `diagnostics/one-pipe.mjs` shows the second works.
2. SLOT: either accept a stated bias (the table above) or correct the conveyance when the head is above the crown.
   EXTRAN is exact for the pipe but cannot be used with two-way exchange as it stands (F18).
3. Add SWMM's continuity for surcharged manholes to the run checks: 0.5 % was exceeded in every surcharged case.

### F15. The default grate against the Sheffield rig

**Evidence** (PV-SS10; Rubinato et al. 2017, J. Hydrology 552:421–432, data Zenodo 1434156, CC BY 4.0). Fifteen steady
tests of water leaving a shallow flow (8–11 mm) down an open 0.24 m inlet into a free-flowing sewer.

- FloodSim's law with its default weir coefficient (0.5, no ⅔ factor) on the same weir length gives 1.13–1.93 l/s
  where the rig measured 0.69–1.25 l/s: **54–65 % more** in all fifteen.
- In FloodSim's form the tests fit a coefficient of **0.32**. The paper's own (⅔ × 0.540) is 0.36 (0.33–0.39).
- Ten grated inlets in the same rig (Rubinato et al. 2018, J. Hydroinformatics 20(3):564–576; reported, not scored):
  on the inlet's outer circumference their coefficients are 0.17–0.41, median 0.28.

**Limits.**
- One rig at 1/6 scale; at 8–11 mm the coefficient may be lower than at full scale.
- The depth is the paper's Table 2 value. The raw depth series reads 3.75 mm more in every test, unexplained; with the
  raw depths the fit would be 0.20.
- The surface flow was not modelled: the flume's outlet weir setting is not published.

**Production relevance.** Only where the grate is the limit: shallow water on a grade. In a sag the pond deepens until
the pipe or the grate's orifice sets the flow, and the coefficient moves the depth by a centimetre. On a grade under
sheet flow the default grate took 61–76 % of the water crossing its cell (`diagnostics/on-grade.mjs`), about what
flows over a 0.6 m grate (1.0–1.3 ×), so the default is not far out there either.

**Proposed fix.** Do not change the coefficient on this evidence alone. At the level of the law the default is about
55 % high against the rig. In a model run on a kerbed grade the same grate takes about half of what HEC-22 gives (F21).
The two point opposite ways because the law is applied to the depth in the grate's own cell, which the grate itself
draws down. Settle F21 first, then set the coefficient. Kyle to decide.

### F16. What "sized for the 10-yr storm" means

**Evidence** (PV-SS3 d–f; the bowl neighbourhood, 1.2 ha draining to one crossing).
- The pipe from the sag was sized for 0.070 m³/s. It carried 0.226, 0.232 and 0.236 m³/s in the 10-, 100- and 500-yr
  storms: **3.2–3.4 times its design flow.**
- SWMM's heads agree with a friction grade line worked by hand from those flows to 1 cm (the scored row, passed).
  So the hydraulics are right; the label is what misleads.
- By the grade line alone the network carries **1.75 times** its design flows before any manhole's head reaches the
  ground. The 100- and 500-yr peak intensities are 1.6 and 2.1 times the 10-yr.

**Cause.** Four choices in `src/drainage.js` synthNetwork each add capacity above the design flow:
- full-flow Manning at no less than 0.5 % slope, rounded up to a standard size, never under 0.3 m;
- 1.2 m of cover, all of which is head once the pipe surcharges, plus whatever stands on the street;
- outlets that take any flow (a free outfall, or 100 m of pipe to a normal-depth outfall), with no tailwater;
- no losses at manholes.

And one that takes capacity away at a sag: each pipe is sized for the ground nearest its inlet (2,304 m² here), not for
the ground that drains to it (12,288 m²).

**Production relevance.** Tract 353.02: the sewer took about half the rain in every storm from 10- to 500-yr and SWMM
reported no flooding. A network built this way will seldom flood from its pipes. What it leaves on the ground is water
that never reached an inlet. That is a statement about the synthetic network, not evidence the tract would not flood.

**Proposed fix.** For a screening product, do not present the synthetic network as a 10-yr sewer. Either size it so it
carries its design flow and no more (no rounding up, a tailwater at the outlet, losses at manholes), or drop the pipes
where there is no pipe data and use an allowance (F17). Kyle to decide; PV-SS8 puts numbers on the difference.

### F17. Drainage without pipes

**Evidence** (PV-SS8; `diagnostics/allowance.mjs`). The bowl neighbourhood, 60 min nested storms, CPU rows.

| Storm | No drainage | Allowance 30 mm/h (app default) | Allowance 50 mm/h | Pipe network |
|---|---|---|---|---|
| 10-yr, peak depth at the sag | 0.485 m | 0.386 m | – | 0.279 m |
| 100-yr | 0.572 m | 0.500 m | 0.457 m | 0.396 m |
| 500-yr | 0.627 m | 0.568 m | 0.531 m | 0.478 m |
| Houses exposed of 14 (10 / 100 / 500-yr) | 6 / 6 / 8 | 4 / 6 / 6 | – / 4 / 6 | 0 / 4 / 4 |

- No drainage matches arithmetic to 0.03 mm (passed).
- The allowance stood above its registered bound in all five cases (failed): by the peak it had removed 73–85 % of
  allowance × area × time.

**Cause of the allowance's shortfall.** `lumpedInfil` spreads the rate over open cells only (91 % of this scene; roofs
shed their rain onto the ground but carry no allowance), and takes it only from street cells that have water.

**Reading.**
- Which column is nearest the truth cannot be read from this case. The pipe column itself reads low (F14), and the
  bowl sends everything to one sag.
- Against the pipes, no drainage is 15–21 cm deeper at the sag and an allowance of 50 mm/h 5–6 cm deeper. After the
  storm they part completely: the pipes empty the sag, the allowance drains it slowly, nothing drains it with neither.

**Proposed fix.** If the product is to run where there is no pipe data, make the allowance mean what it says (the rate
over the whole area, roofs included), set it from the local design storm, and report the no-drainage run beside it as
the upper bound. Kyle to decide.

### F18. Two exchange settings that fail without limit

Neither is the app's default (two-way exchange, SLOT). The product's headless runs should be checked to use the
defaults.

- **Spill at the rim** (`twoWay` off). A manhole that spills at its rim cannot feel the water standing over it. With
  rain above the pipe's capacity the pond passed 0.60 m and was still rising at 2 h (by hand: 0.20 m, steady). With the
  outlet 0.15 m above the street and no rain, 49.6 m³ stood on the street after 1 h and was still rising (by hand:
  4.5 m³).
- **EXTRAN with two-way exchange** (`swmmSurcharge` set to EXTRAN). The manhole head swings by 0.8–1.9 m, SWMM's
  continuity error is −23 to −51 %, and water held above the street never came up the inlet (0.9 cm against 15 cm).

**Proposed fix.** Remove both options, or guard them. Low cost.

### F19. Coarse cells and the 1 m map

**Evidence** (PV-SS6, driveway: a 1 m wide ramp dipping 0.9 m to a garage door, holding all the rain of its lot).

| Grid | Solver's own cells | On the 1 m map | True |
|---|---|---|---|
| 0.5 m | 0.839 m | – | 0.839 m |
| 1 m | 0.8015 m | – | 0.8017 m |
| 2 m | **0.363 m** | 0.818 m | 0.802 m |
| 4 m | **0.146 m** | 0.843 m | 0.802 m |

Each grid matches its own arithmetic to 0.2 mm. The coarse cell is a mean bed, so it reads the dip shallow; the water
level is right, and carrying it onto the 1 m ground recovers the depth to 2–4 cm.

**Reading.** Depth against a house must always come from the 1 m map, never from the coarse cells. In the bowl (PV-SS9,
CPU) a 2 m run with downscaling gave the same exposed houses as the 1 m run and wall depths within 0.4 mm, eight
times faster; 4 m gave two more exposed houses of fourteen and wall depths 4.7 cm out, 73 times faster. Those two
rows compare the solver with itself and are Not independently validated. The subgrid modes are GPU only, not yet run.

### F20. The wall rule's reach

`src/damage.js` exposure steps `ring = 2` cells out from the footprint. At 1 m that is the stated 2 m, and the rule
passed all eleven hand cases. At 2 m cells it reaches 4 m (PV-SS7 R12, failed as predicted). The app calls it on the
1 m grid only, so nothing in production is affected. If it is ever called on a coarser grid, pass the reach in metres.

### F21. A grate in a gutter on a grade (diagnostic)

**Evidence** (`physics/street/diagnostics/gutter.mjs`, unscored). Half a street 8 m wide, falling 1, 2 and 4 % along its
length and 2 % toward a kerb; rain 50–200 mm/h, so 8–33 l/s reaches one default grate in the kerb cell. Against FHWA
HEC-22 (3rd ed., §4.4.4.1, Eq. 4-16 to 4-21) for a 0.6 × 0.9 m grate in a uniform gutter:

| Slope along the street | FloodSim takes | HEC-22, the flow over the grate only | HEC-22 with side flow |
|---|---|---|---|
| 1 % | 31–40 % | 54–78 % | 69–88 % |
| 2 % | 29–37 % | 60–83 % | 69–89 % |
| 4 % | 26–33 % | 66–89 % | 71–92 % |

- **The gutter flow itself is right.** The kerb cell 5 m above the grate is as deep as HEC-22's triangular gutter
  averaged over that cell, within 1.1 mm (4 %) in all nine runs (for example 26.1 mm against 36.2 − 10.0).
- On a plane with no kerb (`diagnostics/on-grade.mjs`) the same grate took 61–76 % of the water crossing its cell.

**Cause (likely, not isolated).** The weir law is applied to the depth in the grate's own cell. The grate draws that
cell down (8–18 mm, against 18–37 mm just upstream), and the water crosses the cell at 0.4–1 m/s; the law has no term
for water that arrives moving. HEC-22 takes all the flow that passes over a grate at these speeds.

**Reading.** On a hillside FloodSim's grates take too little, not too much. What they miss runs on down the street;
in a box cut across the slope it then leaves over the edge (F13).

**Production relevance.** Tract 353.02: the sewer took 49–57 % of the rain in every storm and 23–35 % left across the
edge. Both are what under-capture on a grade would give. Not checked on that run.

**Status.** Open. One street shape; the model's 1 m cells against a formula for one grate size; unscored. It is the
main case the sandbox does not yet register.

**Proposed fix.** Register the case with HEC-22 as its reference. Then consider a capture rule for moving water: the
flow crossing the grate's width times HEC-22's efficiency, in place of the weir law. Kyle to decide.

### What passed

- **A gutter's depth** (diagnostic, F21): within 1.1 mm of HEC-22's.
- **Rain on a tilted street** (PV-SS1): outflow = rain × area to 0.004 %; depths within 0.2 mm; time to steady state
  within 1 % at 1 % slope and 8 % at 2 % (limit 10 %).
- **A hollow** (PV-SS2): fills to arithmetic (0.1200 m), spills at its rim, ends at the rim to 0.014 mm; a storm twice
  as large ends at the same depth to 6e-8 m. This is the South Street behaviour (the same depth from 10- to 500-yr),
  and it is right.
- **A free outfall under a sag grate** (PV-SS3 c): the street stands at the grate's weir head, 29.3 mm, exactly.
- **No drainage** (PV-SS8): the pond stands at the level the rain fills, to 0.03 mm.
- **The wall rule at 1 m** (PV-SS7): 11 of 11 hand cases.
- **Surface books:** 1e-13 or better in every CPU run.

## Street sandbox, second set (17 Nov 2026, afternoon), appended

After Kyle's direction relayed by the product session: 1 m stays the baseline and coarse-then-downscale must say whether
street detail survives (PV-SS9 revision 2); surface-only is what most reports will use, so each drainage treatment is
scored against a hand answer (PV-SS11); measures one owner can take get known-answer cases (PV-SS12). All three were
registered before they ran. CPU rows; the GPU rows and the subgrid modes are not yet run.

| ID | Finding | Severity | Status | Rows affected (registered status kept) |
|---|---|---|---|---|
| F22 | A coarse run loses the street crown at 2 m and the small hollow at 4 m; the kerb survives | High for any use of coarse runs | Explained | PV-SS9 detail: 4 Failed at 2 m and 4 m; 4 Passed at 1 m |
| F23 | Surface only is exact where nothing drains and 0.4–0.6 m too deep at a sag a drain serves; an allowance is wrong both ways | High for areas without pipe data | Explained | PV-SS11: 26 Failed, 11 Passed |
| F24 | Rain gardens, permeable paving and soil take exactly what their size says; four owner-scale measures cannot be represented | Medium (product scope) | Documented | PV-SS12: 10 Passed, 4 Unsupported |

### F22. What survives a coarse run

**Evidence** (PV-SS9 revision 2). A street with a 0.08 m crown and 0.15 m kerbs, rain on one side only; a 3 × 3 m hollow
at the low point of a yard. Read on the 1 m map at the end.

| | By hand | 1 m | 2 m, mapped to 1 m | 4 m, mapped to 1 m |
|---|---|---|---|---|
| Kerb: depth in the gutter | 0.050 m | 0.049 | 0.060 | 0.060 |
| Kerb: depth on the lot behind it | 0 | 0.000 | 0.000 | 0.000 |
| Crown: depth in the far gutter | 0 | 0.003 | **0.045** | **0.060** |
| Hollow: depth of water in it | 0.098 m | 0.098 | **0.120** | **0.000** |

- **1 m holds all three.**
- **The kerb survives at 2 m and 4 m,** because the 1 m map puts the water level back on the 1 m ground.
- **The crown does not.** A 2 m cell across the crown has a mean bed below the pond, so the water crosses; at 4 m the
  two gutters stand at one level.
- **The hollow** is 2.2 cm too deep at 2 m (limit 2 cm) and gone at 4 m: a 4 m cell's mean bed has no pit.

**Reading.** Kyle's rule ("maintaining the streets, the curbs, the small hollows") is met at 1 m only. A plain coarse
run is not a way to keep that detail, with or without the 1 m map. The subgrid modes carry 1 m storage in each cell and
may do better; they are GPU only and not yet run.

**Two setups of the hollow case were invalid and are kept.** First the lot's foot was closed and its pond drowned the
hollow (my error). Then, with the foot open, the 1 m run filled the hollow to its rim (0.150 m against a hand 0.110 m):
the cells beside the hollow shed part of their sheet flow sideways into it, which the hand answer did not allow for.
Neither is exact, so the case was rebuilt with a catchment that cannot be argued about. Both are in the spec's
`definitionRevisions`. **Observation, not scored:** on a plain slope a pit one to three cells wide takes water from
the cells beside it as well as from above; how much is right is not known from this case.

### F23. Surface only, an allowance, or pipes, against known answers

**Evidence** (PV-SS11). Four streets whose true answer is worked by hand, 60 min design storms. Depths in metres.

| Street | Storm | True | Pipe (FloodSim) | Surface only | Allowance 30 mm/h | Allowance 50 mm/h |
|---|---|---|---|---|---|---|
| Sag, drain keeps up: peak at the grate | 10-yr | 0.026 | 0.026 | **0.417** | **0.254** | **0.188** |
| | 100-yr | 0.036 | 0.036 | **0.558** | **0.415** | **0.343** |
| | 500-yr | 0.043 | 0.043 | **0.657** | **0.534** | **0.454** |
| Sag, drain cannot keep up: peak pond | 10-yr | 0.043 | 0.039 | **0.417** | **0.254** | **0.188** |
| | 100-yr | 0.135 | 0.115 | **0.558** | **0.415** | **0.343** |
| | 500-yr | 0.205 | 0.188 | **0.657** | **0.534** | **0.454** |
| Hollow with no drain: depth at the end | 10-yr | 0.200 | – | 0.200 | **0.064** | **0.007** |
| | 100-yr | 0.200 | – | 0.200 | **0.169** | **0.097** |
| | 500-yr | 0.200 | – | 0.200 | **0.173** | **0.151** |
| Kerbed street on a grade: kerb cell | 100 mm/h | 0.0168 | **0.0219** | **0.0246** | 0.0204 | 0.0168 |

Bold is outside the limit (2 cm or 20 %; 5 mm or 20 % on the grade).

| Treatment | Inside the limit |
|---|---|
| Pipe network | 6 of 7 |
| Surface only | 3 of 10 |
| Allowance 30 mm/h | 1 of 10 |
| Allowance 50 mm/h | 1 of 10 |

**Reading.**
- **Surface only is exact where nothing drains:** a hollow, a yard, any low ground without an inlet.
- **At a low point that a drain serves it is far too deep:** 0.42–0.66 m where the truth is 3–20 cm. These sags are
  closed, the worst case. In an open street the depth is capped by the height of the sag's rim (PV-SS2), so read a
  surface-only depth as that cap.
- **An allowance is not a better estimate.** It is still 0.15–0.49 m too deep at a served sag, and it drains a hollow
  that nothing drains (0.007–0.173 m against 0.200 m). It is wrong in both directions.
- **On a grade all four are within 8 mm.** Moving water is shallow whichever treatment is used.
- **The pipe rows carry F14 and F21:** 8–14 % low at the failing sag, 5 mm high on the grade (the grate takes too
  little).

**What a report may say where there is no pipe data.** A surface-only run is an upper bound: it shows where water
gathers and how deep it would stand if no drain took any. It cannot say that a low point floods, only that it would
if its drains were absent or blocked. It can say that a low point with no way out (a hollow below its rim, a yard)
holds water, and how much. An allowance should not be used to turn the bound into an estimate.

**Limits.** Four made-up streets. No case has a true answer for a whole network. The true sags assume a clean grate on
a clean pipe.

### F24. Measures one owner can take

**Evidence** (PV-SS12). A 10 × 10 m lot, the measure at its low edge.

| Measure | By hand | FloodSim |
|---|---|---|
| Rain garden 4 m², 1.2 m³ of storage, 1.0 m³ of rain | all of it taken, ground dry | 0.999 m³ taken, 0.001 m³ left |
| The same, 3.0 m³ of rain | 1.752 m³ left at 6 h | 1.7520 |
| Permeable strip 10 m², 2.0 m³ of storage, 3.0 m³ of rain | 0.960 m³ left at 2 h | 0.9600 |
| Bare soil 20 m² at 10 mm/h, 3.0 m³ of rain | 2.600 m³ left at 2 h | 2.6000 |
| A roof whose rain is held, 30 mm of rain | 2.520 m³ on the ground (3.000 without) | 2.5200 (3.0000) |

All ten rows pass. A storage measure holds its storage, plus what drains to the soil below, and no more.

**Not representable as one owner's what-if (listed as Unsupported, not approximated):**
- **A rain barrel or cistern on an existing house.** A cistern exists only for a building drawn in site design, and
  its filling and overflow are timed in `app/map.js`, which a headless run does not reach.
- **A French drain.** The nearest thing is a rain garden's underdrain to a sewer manhole (GPU only).
- **Removing paving.** Site design can add paving or permeable paving; it cannot turn paving into soil. The solver's
  infiltration at a soil's rate, which such a control would use, is exact.
- **A green roof on one house.** Area-wide only.

**Limits.** The rain garden here is storage with an intake rate; the ponding depression that site design digs is not
in these cases. Green-Ampt infiltration is not tested.

## Street sandbox, third set (17 Nov 2026, later), appended

- **F21 is now scored** (PV-SS13, registered after its runs had been made once as a diagnostic; not blind). On the nine
  streets the gutter's depth passes 9 of 9 (within 0.7 mm of FHWA HEC-22) and the grate's share fails 9 of 9: it takes
  26–40 % of the flow reaching it where HEC-22 gives 69–91 %. F21's status: **Explained in part** (the likely cause
  stands as written; not isolated).
- **F14, corrections and a fix.** A fix for the wobble is proposed in pull request 11 (`physics/street/FIXES.md` on
  that branch): the pond goes from 0.121 to 0.150 m (by hand 0.199 m; the rest is SLOT's), the held-outfall level from
  0.1445 to 0.1500 m, the rate stops changing sign, and the answer no longer depends on the exchange interval. CPU
  path only. **Correction:** SWMM's continuity error (0.8–1.2 %, and 10–19 % of a few cubic metres on return flow)
  does not change with the fix, so it is not caused by the wobble as the text above suggests. It is SWMM's own
  bookkeeping of surcharged nodes and return flow, and is open.
- **F18 and F20** have fixes in the same pull request: EXTRAN with two-way exchange is refused, and the wall rule's
  reach is in metres. The new exchange does not make EXTRAN usable.

## Street sandbox, fourth set (17 Nov 2026, evening): the GPU rows and the fixes, appended

**The GPU rows are in.** All 108 cases ran on the production GPU solver (NVIDIA, headless Edge). The GPU and CPU rows
agree to three or four digits. On the code before the fixes four statuses differed: three were the GPU's surface books
(below), and one street level passed on the GPU by 1.5 mm where the CPU failed by 0.5 mm. So the findings above hold
on the production path, F14 included (the pond read 0.128 m on the GPU, 0.121 m on the CPU, 0.199 m by hand).

**F22, extended: the subgrid modes** (GPU only). On the 1 m map at the end:

| | By hand | 4 m subgrid | 8 m subgrid |
|---|---|---|---|
| Kerb: depth in the gutter | 0.050 m | 0.040 | 0.047 |
| Kerb: depth on the lot behind it | 0 | 0.000 | 0.000 |
| Crown: depth in the far gutter | 0 | 0.000 | **0.010** (the limit) |
| Hollow: depth of water in it | 0.098 m | **0.069** | **0.071** |
| Driveway dip beside a house (PV-SS6) | 0.802 m | **0.707** | **0.614** |
| Rear yard through a 1 m passage (PV-SS6) | 0 | 0.010 | **0.030** |
| Bowl: houses' peak wall depths against the 1 m run | – | within 3 mm, same houses exposed | within 11 mm, same houses exposed |

- The 4 m subgrid mode keeps the kerb and the crown, and keeps the passage open, where the plain 2 m and 4 m runs do
  not. It reads the small hollow 3 cm shallow and the driveway dip 12 % shallow.
- The 8 m mode is worse on each and loses the crown at the limit.
- 1 m is still the only grid that passes every detail row.

**F25. GPU surface books reach 1.4e-5 to 1.9e-5 in three runs,** against the 1e-5 limit registered for the GPU (a
hollow spilling for three hours, and two coupled runs). Low; recorded. Three GPU rows Failed. With the exchange fixed
the coupled run that read 1.9e-5 reads 3.3e-6.

**The fixes** (`physics/street/FIXES.md`, which gives every number before and after):
- **F14, the exchange:** fixed. On the GPU and the CPU alike the pond goes to 0.150 m (by hand 0.199 m), the held
  outfall to 0.1500 m (by hand 0.150 m). The existing coupled cases with exact answers pass 22 of 22 on the GPU with
  it. A first version of the fix failed one of those measures by 0.004 points and was changed; both runs are filed.
  **Still open under F14:** SWMM's SLOT conveyance (the remaining 5 cm), and SWMM's continuity error on surcharged
  nodes and return flow (0.8–1.1 % with rain, 17–19 % of a few cubic metres without).
- **F18:** EXTRAN with two-way exchange is refused. Spill at the rim is unchanged.
- **F20:** fixed; PV-SS7 passes 17 of 17.

### F26–F28. Depth audit on planted cases (25 Nov 2026; `benchmarks/physics/depth/`, gridzip-lab PROTOCOL-12)

**F26. Rain sheet flow on a slope is too thin on steep ground and coarse cells.** Steady rain on a uniform plane, CPU
solver, scored against the kinematic-wave depth at x ≥ 20 m (expected within 15 %). At 1 m cells the model gives 0.36
(15 % slope) to 1.00 (1 % slope) of the right depth; at 4 m cells, 0.10 to 0.78. Mass is exact, so the water moves too
fast. The miss follows √(slope × cell size). The likely seat is a film much thinner than the bed step between cells
under hydrostatic reconstruction; not yet traced in the code. Failed; fix candidate, with family R as its check.

**F27. A 2D model has no wall friction, and a drawn channel's width is the cells' width.** Steady flow between walls:
the model equals the 2D answer at its own drawn width to 0.5 % in 96 cases (passes). Against a real walled channel
it is low by −0.6·ln(Wm/W) − 0.4·ln(1 + 2h/W); narrow deep channels come out near half depth. Recorded as model scope.

**F28. A free downstream edge drains a backed-up river for kilometres.** Held edge: exact (0.2 %). Free edge: 0.26 to
0.44 of the true depth at the edge, recovering over about one backwater length (h/S). Wherever a real river is backed
up below the model box, hold the edge (`outStage`); CHI's wall check does this in its plan A11.
