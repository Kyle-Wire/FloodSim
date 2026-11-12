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
