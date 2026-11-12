# Physics Verification Milestone 2: scope and registration package (PROPOSED)

**Status: proposed, awaiting independent review.** Nothing in this folder has been hashed or run, and no experiment has
started. Written 12 Nov 2026 in response to review 5.

**Repository state at writing:**
- branch `exp/start-reach`, HEAD `02c8a06` (pushed to `origin/exp/start-reach`);
- working tree clean apart from this folder and an untracked personal note (`complaints.md`).

**Naming.** "Milestone 2" already names a different project in `docs/specs/swmm-culvert-inputs.md`: the native SWMM
culvert inputs, whose Stage A and Stage B are the culvert benchmarks. This package is **Physics Verification Milestone 2
(PVM2)**. Its test IDs use prefixes that collide with nothing existing; `T1` and `T2` are culvert-suite names.

| Prefix | Work package | Review 5 name |
|---|---|---|
| PV-TF | transient fill and drain | M2-A |
| PV-ST | structure transitions | M2-B |
| PV-RV | reversing flow | M2-C |
| PV-SX | surface/network exchange | M2-D |
| PV-NW | network interactions | M2-E |

**How this package is reviewed** (`reviews/README.md`):
- Three independent reviews.
- Each reviewer may reject any test without agreeing to its implementation.
- Every review and every revision is kept.
- A test is approved only when its blocking objections are resolved.
- Only then is its spec moved to `../spec/`, its criteria hashed (`run.mjs --hash`) and entered as revision 1, and the
  test run, one at a time.

---

## 1. Milestone 1 closure status

**Milestone 1 is accepted with qualifications (review 4). It is not formally closed.** The closure pass and its register
(`../../FINDINGS.md`) have not yet had their second-pass review.

| Item | State | Formally closed? |
|---|---|---|
| PV-P1, Manning full-pipe friction (12/12, worst 0.034 %) | Passed within the tested domain | Yes, within its `validRange` |
| PV-P1, Darcy–Weisbach rows | Not independently validated (F6) | Closed as a documented limit; outside the validated results |
| PV-X1, fault detection (4/4 caught) | Scorer works | Yes, as a scorer test only |
| PV-X1-b, volume books | Explained (F1): SWMM EXTRAN crown-cutoff surface area | **No**: not evidence that mass accounting is validated |
| PV-C1-a/c, closure, full pipe, closed | Passed | **Qualified** by F5: the exchange is symmetric, so it does not test net inflow |
| PV-C1-b, closure at rest, part full | Passed | Yes, at rest only |
| PV-C1-b, closure in motion | Insufficient reference data (F4) | **No**: open |
| PV-C1-d, CPU surface solver closure | Passed (fp64) | Yes; the CPU path verifies the scheme, not the GPU path |
| PV-U1, 20 of 24 cases | Passed | Yes, within its `validRange` |
| PV-U1, 4 steep-trapezoid cases | Failed, explained (F2: PARTIAL inertial damping) | **No**: rows stay Failed; the error-type reclassification awaits a decision |
| Reference self-tests (70 checks), import guard | Passed | Yes |
| Swamee–Jain at Re 10⁴ | Outside the declared domain (F7) | Closed as a documented limit |

**Culvert suite items that bear on PVM2** (`../../culvert/README.md`):
- **T2-C:** explained (F3), but the registered rows stay Failed.
- **B6-C:** −15 m³ fixed term; open qualification; mechanism not established.
- **B7-S / S8:** unsupported regime, flagged.
- **Reverse flow (B8-R):** provisionally qualified, not independently validated.
- **Round 2:** no snapshot (F8).

## 2. Outstanding findings and their dependencies

No finding is closed or reclassified by this package. Each keeps its status and evidence in `../../FINDINGS.md`.

| Finding | Status (unchanged) | PVM2 tests that depend on it or bear on it | How the dependency is handled |
|---|---|---|---|
| **F1** PV-X1-b: EXTRAN crown-cutoff surface area loses A/(A + w·L/2) of a net inflow | Explained, not resolved | PV-TF1 (kept out of it), PV-TF4, PV-RV1, PV-ST2 | PV-TF1's guard keeps every end depth below 0.9 D. PV-TF4 and PV-RV1 carry F1's quantitative prediction, written before their run. SLOT is tested as its own axis, not substituted |
| **F2** PV-U1: PARTIAL inertial damping, steep near-critical drawdown | Explained, rows Failed; reclassification pending | PV-TF1 (diagnostic axis), PV-TF5, PV-ST1 | PARTIAL stays the registered setting, as production uses it. NONE appears only as a declared, unscored diagnostic. No PVM2 criterion is set to absorb F2 |
| **F3** T2-C: fixed volume during a single-link fill, falls with segmentation | Explained in an open system; rows Failed | **PV-TF1** (first experiment), PV-TF2, PV-TF3 | PV-TF1 asks whether the T2-C volume error survives in a closed system scored at rest. Predictions P1/P2 are registered, but neither is a pass condition |
| **F4** PV-C1-b: no independent volume for a moving part-full pipe | Documented; Insufficient reference data | PV-TF5 (proposed resolution), PV-TF1 (in-motion closure reported only) | PV-TF5 builds the missing reference (uniform flow, L·A(y_n) exact) and checks getter 420 against it before any use of the getter |
| **F5** PV-C1 does not test net inflow | Documented | PV-TF1, PV-TF4 | Both are closed systems with a declared net inflow |
| B6-C −15 m³ fixed term | Open qualification | PV-TF1 (indirectly) | A fixed fill-time term in PV-TF1 would make B6-C's mechanism a testable hypothesis. It would not resolve B6-C |
| B7-S / S8 unsupported regime | Unsupported, flagged | PV-ST1 | PV-ST1 excludes that regime by declaration and reports any entry into it as Unsupported |
| B8-R reverse flow, not independently validated | Qualified | PV-RV1 | PV-RV1 offers the first independent in-motion reference for reversing full-pipe flow (rigid-column ODE) |

## 3. Proposed scope

**Objective:** transient hydraulic behaviour and hydraulic-structure transitions, verified against independent references.
This milestone is not feature work and not calibration.

**In scope:**
- conduits going from dry to part full to full, and back;
- filling and draining;
- inlet↔outlet control transitions;
- changing upstream and downstream head;
- reversal;
- storage and water accounting through those transitions;
- later, surface↔network exchange.

**Out of scope:**
- production solver changes;
- SWMM changes (the instrumented build is a read-only diagnostic);
- roughness, infiltration or rainfall calibration;
- Charlotte-specific work (Charlotte stays an integration and validation case);
- GPU batches;
- relaxing any tolerance;
- treating CPU–GPU agreement as validation.

**Order.** One experiment at a time. A test's failures are reviewed before the next test runs.

| Order | Test | Package | Reference available now? |
|---|---|---|---|
| 1 | **PV-TF1** closed fill, horizontal, at rest | M2-A | **Yes**: `references/volume.mjs` (existing, self-tested) |
| 2 | PV-RV1 U-tube oscillation, full pipe | M2-C | New ODE reference needed (small; analytic frictionless check) |
| 3 | PV-TF5 known moving profile (F4) | M2-A | Yes (Manning; existing) |
| 4 | PV-TF4 fill through the crown, EXTRAN and SLOT | M2-A | Yes at rest (existing) |
| 5 | PV-TF2 sloped fill; PV-TF3 drain to rest | M2-A | New level-pool quadrature (TF2); existing (TF3) |
| 6 | PV-ST1, PV-ST2 structure transitions | M2-B | HDS-5 (`../../culvert/hds5.mjs`): steady only |
| 7 | PV-SX1 one-inlet exchange | M2-D | Weir/orifice (existing), books at rest; feasibility blocker below |
| 8 | PV-NW1 junctions | M2-E | Weak: likely Insufficient reference data |

## 4. Candidate tests

All fields required by `../spec/TEMPLATE.md` are given for **PV-TF1** in machine-read form:
`spec-proposed/PV-TF1.json`.

The other tests are **candidates**. Each has its question, reference, draft criteria and limitations, and each gets its
own full registration (spec JSON plus review) before it runs. Their draft criteria are not approved and carry no hash.

Common to every candidate unless stated:
- **Solver:** SWMM 5.2.4 production wasm via `lib/swmm-run.mjs`; dynamic wave; fixed step.
- **Network:** hand-written `.inp`, no FloodSim translation; a sealed outfall where a closed system is needed.
- **Artifacts:** an immutable `results/<run-id>/` with the spec hash, code identity (git commit plus the diff hash), the
  wasm SHA-256, the raw time series of every scored quantity, and `SHA256SUMS`.
- **Failure classes:** numerical (solver against an exact solution of the same equations), physical-model (equations
  against physics they omit), accounting (books), Invalid setup, Insufficient reference data.

### PV-TF1: closed fill of a dry horizontal conduit, scored at rest (proposed first; full spec)

| Field | Content |
|---|---|
| **Question** | When a dry conduit fills and the water comes to rest, does the system hold exactly the water put in? Does the T2-C fill-time volume error survive without an outfall? |
| **Equations** | Closed-system continuity; still-water hydrostatics at rest. SWMM's dynamic wave is not referenced in motion |
| **Geometry and BCs** | Two 20 m² tanks; a circular D 1.0 m conduit, L 400 m, n 0.013, horizontal, in N = 1/4/16/32 equal segments; inflow 0.1 m³/s trapezoid into T1, exactly 180.0 m³; sealed outfall |
| **Initial state** | Everything dry |
| **Reference** | Bisection on the exact volume function, `equilibriumDepth`: h = 0.50664 m, conduit 159.73 m³ (88.7 % of the system). Computed from the declared inputs only |
| **Metrics** | At rest, per N: volume closure; level against h; sealing-weir flux; node volume against A·d. Reported only: SWMM continuity, applied inflow, closure in motion, max end depth / D, closure against N |
| **Criteria** | **PV-C1's, unchanged:** closure 0.1 % of the system (= 0.113 % of the conduit); level 2 mm; rest = both levels within 1 mm and still within 1 mm over 1 h. Known noise in these books is ≈ 2×10⁻⁴; the criterion is about 5× that |
| **Resolution** | N as above; 1 s fixed step; diagnostic: 0.5 s |
| **Exclusions** | An end depth ≥ 0.9 D at any sample → Invalid setup (keeps the pipe below the crown and away from F1). Not at rest → Insufficient reference data |
| **Diagnostics (declared now, unscored)** | Step 0.5 s; MIN_SURFAREA 0.1 m²; INERTIAL_DAMPING NONE; getter 420 decomposition (an equivalence check of node depths against production precedes its use) |
| **Predictions** | P1: T2-C was the open outfall, so it closes at every N. P2: T2-C lives in SWMM's wetting storage representation, so a fixed error of T2-C's sign remains and falls with N. P3: no F1 |
| **Dependencies** | F3 (tested), F5 (addressed: net inflow), F1 (excluded by the guard), F2 (diagnostic axis only) |
| **Limitations** | End state only; horizontal; part full; one size; one build |

### PV-TF2: closed fill of a sloped conduit, at rest (candidate)

- **Question:** at rest in a sloped conduit the depth varies along it. How far does SWMM's single mid-depth area per
  link (`dwflow.c` line 291) depart from the true level-pool volume?
- **Configuration:** PV-TF1 at S 0.004, with T2 lower.
- **Reference:** a new `levelPoolVolume` = ∫A(h − z(x)) dx, by two quadratures (midpoint and Gauss–Legendre). The
  representation offset L·A(y_mid) − ∫A is computed from geometry alone, before the run.
- **Draft criteria:** closure as PV-TF1. The representation term is reported as physical-model, Qualified.
- **Limitation:** an at-rest sloped pipe that is partly dry at its upper end has no SWMM-equivalent state; that case is
  excluded.

### PV-TF3: closed drain to rest (candidate)

- **Question:** does a part-full conduit draining into a lower tank keep the books?
- **Configuration:** PV-TF1's end state as the initial condition. An orifice to a third tank 0.5 m lower is opened by a
  rule at 1 h.
- **Reference:** the final common level from the total volume alone (bisection, existing functions extended to unequal
  inverts, with a self-test).
- **Draft criteria:** as PV-TF1.
- **Limitation:** end state only.

### PV-TF4: fill through the crown, EXTRAN and SLOT (candidate)

- **Question:** what happens to the books when a conduit goes from part full to full while its storage ends keep rising?
- **Configuration:** as PV-TF1, with an inflow that raises the rest level to 1.5 D. Two runs: EXTRAN and SLOT.
- **Reference:** exact at rest (a full pipe plus the tanks).
- **Registered F1 prediction (EXTRAN):** the volume added while the pipe is full and the tanks are not surcharged is
  kept by each end tank only at the share A/(A + w(0.96 D)·ℓ/2), with ℓ the length of the segment joined to that tank.
  The number is computed from geometry before the run. The interior junctions' behaviour in EXTRAN surcharge is not
  predicted.
- **SLOT:** no prediction (F1's open next action).
- **Draft criteria:** as PV-TF1. An EXTRAN Fail that matches the F1 prediction stays Failed and is reported as F1
  confirmed under fill.

### PV-TF5: a known moving part-full profile (candidate; the proposed route to closing F4)

- **Question:** is there a moving part-full state whose conduit volume is known independently, so that SWMM's link
  volume (getter 420) can be checked before anything uses it?
- **Configuration:** a long chain of circular conduits in uniform flow (the PV-U1 construction, circular); scored only
  beyond the drawdown.
- **Reference:** Manning normal depth (existing, bisection plus Newton). L·A(y_n) per conduit is exact.
- **Draft criteria:** depth as PV-U1; volume 0.1 % per conduit.
- **Instrumented-build rule:** getter rows need the instrumented build, whose agreement with production is shown on B1
  only. A precondition row compares this case's depths between the two builds (identical, or the getter rows are
  Invalid setup).
- **F2:** it applies near the outfall only. Scoring excludes the drawdown by the PV-U1 rule.

### PV-RV1: U-tube oscillation through a full pipe (candidate; proposed second)

- **Question:** do levels and flow follow the right damped oscillation, reversing each half cycle, when two tanks at
  unequal levels are joined by a full pipe?
- **Configuration:** PV-C1-a's geometry: 100 m² tanks, D 0.5 m, L 50 m, levels 3 m and 2 m.
- **Reference:** a new rigid-column ODE:

  L dv/dt = g(h₁ − h₂) − g L S_f(v)

  with Manning friction (the law SWMM applies, so the rows are numerical) and continuity A_i dh_i/dt = ∓a·v.
  - Solved by RK4 with step-halving.
  - Cross-check: the frictionless analytic period T = 2π/√(g a (1/A₁ + 1/A₂)/L) = **226.4 s**.
- **Registered F1 prediction:** EXTRAN's false area (4.90 m² per tank) makes the effective tank area 104.9 m², so the
  period becomes **231.9 s (+2.4 %)** and the level amplitude falls by the same factor. SLOT is run as an axis.
- **Draft criteria:** period 1 %; first-reversal time 1 %; first-peak level 2 mm; closure as PV-C1.
- **Limitations:** a rigid column assumes an incompressible full pipe with no minor losses written; SWMM's surcharge
  representation differs in principle; the entrance and exit losses are zero by construction.

### PV-ST1: inlet↔outlet control transition under a slow hydrograph (candidate)

- **Question:** as Q rises and then falls slowly through the inlet/outlet-control switch, does headwater follow the
  steady HDS-5 answer at each instant, without spurious hysteresis?
- **Reference:** `../../culvert/hds5.mjs` at the instantaneous Q (benchmarks code, not `src/`; HDS-5 published). It is
  quasi-steady, so it is valid only while the barrel's storage time is ≪ the ramp time (declared ratio ≥ 50).
- **Draft criteria:** B1's band, moved into the spec. Rising and falling scored separately.
- **Exclusions:** the B7-S/S8 regime, reported as Unsupported.
- **Limitation:** no independent unsteady culvert reference exists here, so a genuine transient effect cannot be
  separated from error. Rows near the switch would be Insufficient reference data.
- **Also needed:** an independent critic for the re-expressed references (§2.6 of `docs/specs/physics-verification.md`).

### PV-ST2: free↔pressurised transition at the crown (candidate)

- **Question:** does a conduit crossing its crown keep its books and its friction law?
- **Reference:** exact at rest (as PV-TF4). In steady full flow, the PV-P1 Manning full-pipe loss.
- **Draft criteria:** as PV-TF1 and PV-P1.
- **Dependency:** F1. Overlaps PV-TF4 and may merge with it at full registration.

### PV-SX1: one inlet between a surface cell and the network (candidate; blocked on feasibility)

- **Question:** does exchange through one inlet follow the weir and orifice laws, and do the combined surface and network
  books close?
- **Configuration:** the CPU surface solver (`src/solver-cpu.js`) on a closed box, coupled through `src/coupler.js` to one
  manhole, one pipe and a sealed outfall.
- **Reference:**
  - `references/weir.mjs` (existing) evaluated at the simulated heads: an implementation row;
  - books exact at rest: an accounting row.
- **Blocker:** whether `Coupler` runs with the CPU solver under node has not been checked. Gate C runs coupled cases in a
  browser. Any GPU run is out of scope.
- **Limitation:** the CPU path verifies the scheme, not the GPU path.

### PV-NW1: junctions (candidate; deferred)

- **Question:** joins and splits with unequal diameters and inverts.
- **References are weak.** Junction loss formulations are empirical, so most rows would be Not independently validated
  or Insufficient reference data.
- Proposed only after M2-A–C.

## 5. Independent reference sources and their limits

| Reference | Status | Used by | Limits |
|---|---|---|---|
| `references/volume.mjs` (`equilibriumDepth`, `tankVolume`) | Exists, self-tested | TF1, TF3, TF4, RV1, ST2 | At rest only; horizontal conduit at a common invert |
| `references/geometry.mjs` circle area, with a quadrature cross-check | Exists, self-tested | All | SWMM uses tables (≈1×10⁻⁴ difference, F4 evidence) |
| `references/manning.mjs` normal depth (bisection plus Newton) | Exists, self-tested | TF5 | Uniform flow only; beyond the drawdown |
| `references/weir.mjs` weir and orifice | Exists, self-tested | SX1 | Discharge coefficients are inputs, not physics; an implementation check only |
| `levelPoolVolume` (two quadratures) | **New** | TF2 | At rest; the partly-dry upper end is excluded |
| Rigid-column ODE (RK4, step-halving; frictionless analytic) | **New** | RV1 | Incompressible full pipe; no minor losses |
| `../../culvert/hds5.mjs` (HDS-5) | Exists outside `references/` | ST1 | Steady only: a quasi-steady use with a declared ratio; needs re-expression and a critic |
| None for unsteady part-full motion in general | — | TF1–TF4 in motion | **The main limit of M2-A:** motion is reported, never scored, until an independent unsteady reference exists (an independently written 1-D Saint-Venant solver would be its own verification project) |

New references follow the existing rules:
- no import from `src/`;
- a second method for each;
- self-tests that stop a run;
- an independent critic computes the values for any new family before it is scored.

## 6. Recommended first experiment: PV-TF1

Against the five selection criteria:
1. **Scientific importance.** It decides whether T2-C (and possibly B6-C) is a real storage error during wetting or an
   artefact of an open outfall. It also tests conservation under net inflow, which Milestone 1 never did (F5).
2. **An independent reference.** The at-rest state follows from the declared inputs and hydrostatics alone. The
   reference already exists and is self-tested; nothing new has to be written or criticised first.
3. **One mechanism.** A closed system with no outflow, a horizontal conduit and no crown (guarded). Segmentation is the
   one variable.
4. **Relevance to the open findings.** It tests F3 directly and addresses F5. F1 is excluded on purpose, and F2 appears
   only as a diagnostic.
5. **No production change.** Hand-written `.inp`, the production engine, and one new benchmark module.

**What it cannot show.** The transient itself. A fill error that undoes itself before rest is invisible to the scored
rows, so the in-motion closure is reported, labelled Insufficient reference data.

**Next-best if review rejects it: PV-RV1.**
- It has a fully independent in-motion reference, and it carries a quantitative F1 prediction.
- It needs one small new reference and its critic first.

## 7. Blockers

These do **not** block review of this package.
1. **Milestone 1 is not formally closed.** The register's second-pass review is pending.
   - This blocks running PV-TF1 only if review 5's second pass changes F1, F3 or F5.
2. **F2 error-type decision** (numerical → physical-model, by a definition revision of PV-U1). It does not block PV-TF1.
3. **Instrumented build in scored rows** (PV-TF5, and PV-TF1's diagnostic). This needs a decision on whether a
   per-case equivalence check is enough.
4. **The "Milestone 2" name collision.** Confirm PVM2 and the prefixes.
5. **PV-SX1 feasibility:** the coupler with the CPU solver under node. Unchecked.
6. **New references need a critic:** the rigid column (RV1), the level pool (TF2), and HDS-5 re-expressed (ST1).

## 8. Package contents

- `REGISTRATION.md`: this document.
- `spec-proposed/PV-TF1.json`: the full specification in the suite's template.
  - It is outside `../spec/` on purpose: `run.mjs` loads `spec/PV-*.json` and would try to run it.
  - `criteriaRevisions` is empty until approval.
- `reviews/README.md`: the review protocol, and where the three reviews and their resolutions are kept.

**Not touched by this package:** production code, SWMM, the existing specs and results, `FINDINGS.md`, and the culvert
suite.

**Noted from review 5, outside this package's scope:** the three tightening points on Experiment A and the ledger.
- (A) Experiment A shows the category of the problem, not its cause.
- (B) The 0.05 m noise floor is scoped to its gauge and its repeat runs. It is to be split into repeatability,
  extraction, discretisation, parameter and observational uncertainty.
- (C) A canonical raw archive per important experiment.

These touch `docs/METHODS.md` and the experiment ledger, which this task was told not to change. They are a separate
edit for approval.

---

**Recommendation: READY FOR INDEPENDENT REVIEW.**
- Under review: the scope, the PV-TF1 registration, and the candidate list.
- PV-TF1 runs only after its review approves it.
- Every other test needs its own full registration and review.

---

## Revisions

### Revision 1 (12 Nov 2026, after review 5): draft 2 of PV-TF1; naming confirmed

The text above is kept as first proposed. Where it differs from the following, **the following and
`spec-proposed/PV-TF1.json` (draft 2) govern.** Every change and its reason: `reviews/resolution-5.md`.

- **Naming confirmed (review 5, decision 7):** PVM2, with the prefixes TF, ST, RV, SX and NW.
- **Milestone 1 resolutions recorded** in `../../FINDINGS.md`, "Review 5 resolutions". Milestone 1 is formally closed
  as *accepted with qualifications*, and its open findings stay open. This resolves §7 blocker 1. Blocker 2 (F2) now has
  a prepared, unapplied revision: `../spec-revisions/PV-U1-definition-revision-1.md`.
- **Junction storage.** The intermediate junctions are accounted three ways (`junctionStorage`):
  - **J1, node volume:** SWMM defines it as identically 0. This is reference assumption R4, checked by a new scored row.
  - **J2, minimum surface area:** not a volume, so it can only show as an at-rest closure error. Its a-priori bound is
    0 / 1.8 / 8.9 / 18.3 m³ at N = 1 / 4 / 16 / 32, against a 0.18 m³ criterion.
  - **J3, link storage carried by the end nodes.**
- **Raw output** keeps every junction's depth and volume.
- **Rest** = stable, equal tank levels, *and* every segment's |Q| ≤ 5×10⁻⁶ m³/s at every step of the window, *and* zero
  weir flow at every step.
- **Boundary flux** is reported at every routing step: over the whole run, over the rest window, and integrated.
- **Transient statement.** The closure in motion is a diagnostic only. A transient discrepancy that disappears before
  rest does not establish transient correctness.
- **The predictions are split.**
  - P2 becomes P2a (link storage; present at N = 1 and falling with N) and P2b (junction minimum area; absent at N = 1,
    growing with N, and reduced by the MIN_SURFAREA 0.1 diagnostic). Opposite trends in N are what let the test tell
    them apart.
  - An outcome-interpretation table limits each conclusion.
- **Criteria draft 2** adds conditions and removes or widens none. Draft 1 is kept in `proposedCriteriaHistory`, and
  nothing is hashed yet.
