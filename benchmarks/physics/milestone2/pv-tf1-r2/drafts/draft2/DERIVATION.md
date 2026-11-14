# PV-TF1-R2: derivation of the cycle-averaged reference

**Status: PROPOSAL for independent review, draft 2.**
- Draft 2 answers the provisional verdict (`../reviews/verdict-r2-provisional-2026-11-12.md`): approved for independent review only, not for registration or execution. Criteria are unchanged from draft 1; the changes are to sections 3.5, 4, 7, 8 and 10.
- This proposal has not been hashed, registered or run.
- The spec is [`PV-TF1-R2.json`](PV-TF1-R2.json).
- Every number below comes from [`derive.mjs`](derive.mjs), which writes [`derived.json`](derived.json). It uses only the declared inputs, `references/geometry.mjs` and `references/volume.mjs`.
- No number from PV-TF1 run 1 enters any reference value, period, window or tolerance.

**The direction followed is the technical review decision of 12 Nov 2026:**
- cycle-averaged equilibrium;
- NORMAL_FLOW_LIMITED NONE as the primary setting, with BOTH paired;
- N = 1 as a separate reference;
- N = 4, 16 and 32 as the comparison.

---

## 1. The question, and what changes

PV-TF1 asked whether SWMM's stored volume closes on 180 m³ once the system is **at rest**. Run 1 found that the system does not come to rest within 12 h (F11). The free motion is the closed system's own seiche, decaying algebraically under Manning friction. The instantaneous rest criteria therefore cannot be met by waiting a practical time.

The revised question asks whether SWMM's stored volume closes on 180 m³, and whether its level is right, **averaged over whole periods of that natural oscillation**. It also asks whether we can tell, from the record alone, these three cases apart:
- a bounded natural oscillation about a correct mean;
- a persistent hydraulic imbalance, meaning a mean state that is not level;
- continuing drift.

The storage mechanisms under test are unchanged:
- **P1**: the open outfall;
- **P2a**: link storage carried by the end-node areas;
- **P2b**: the junction minimum surface area.

The nominal-slope limiter (F10) is moved out of the primary comparison.

## 2. Reference quantities (independent of SWMM)

| Quantity | Value | Source |
|---|---|---|
| Stored volume after the inflow | V_in = 180.0 m³ | the declared hydrograph; closed system |
| Level | h_eq = 0.506637 m | 2·A_t·h + L·A_○(h) = V_in (`equilibriumDepth`) |
| Hydraulic depth at h_eq | y_hyd = A/W = 0.399371 m | geometry |
| Long-wave speed | c = √(g·y_hyd) = 1.97935 m/s | |

**Reference periods.** These are the linearised, frictionless lumped network that SWMM's EXTRAN scheme represents, at h_eq:
- **Node storage:** S_i = A_t (at the tanks) + Σ W·L_s/2 over joined conduits.
- **Link inertance:** L_s/(g·A).
- **Equation:** S·η̈ = −Kᵀ·diag(g·A/L_s)·K·η.
- **Method:** eigenvalues by Jacobi.

| Case | Model | T_ref (s) | Modes 2, 3 (s) | Fundamental vs continuum |
|---|---|---|---|---|
| N = 1 | two nodes, S = 219.98 m² each | **665.86** | none | +49.9 % |
| N = 4 | 5 nodes | **455.64** | 245.33, 185.03 | +2.55 % |
| N = 16 | 17 nodes | **445.02** | 223.16, 149.52 | +0.16 % |
| N = 32 | 33 nodes | **444.50** | 222.12, 147.96 | +0.04 % |
| continuum | kL + 2·atan(A_t·k/W) = mπ | 444.32 | 221.77, 147.45 | |

### On the N = 1 "rigid-column" period

The decision asks that N = 1 keep its separate rigid-column reference period. In SWMM's N = 1 representation:
- the conduit is a single rigid column of inertance L/(g·A);
- the column sits between two storages, each the tank plus half the conduit's free surface (W·L/2 = 200 m²).

That two-node period is 665.86 s.

The classical **full-pipe** U-tube period, with the free surface only in the tanks, is 143.2 s (`classicalFullPipeUTubePeriodS`). It does not apply: the conduit is part-full and its own surface stores most of the oscillating volume.

**The proposal therefore uses 665.86 s for N = 1. Reviewers should confirm that this is the intended meaning of "rigid-column".**

## 3. The cycle-averaged books and their interpretation bound

### 3.1 Books

At each routing step the books are:

  V_b(t) = A_t·d_T1 + A_t·d_T2 + Σ_s V_s(y_i, y_{i+1}) + Σ_j NODE_VOLUME_j

where:
- V_s is the exact volume of a circular segment whose water surface is linear between its recorded end depths (`conduitVolumeLinearSurface`);
- the NODE_VOLUME terms are the junctions' volumes, identically 0 (R4, scored).

No SWMM volume getter enters the books. The cycle average over a window w of M·T_ref is

  ⟨V⟩_w = (1/n) Σ_{t∈w} V_b(t), with n = round(M·T_ref/Δt) steps.

### 3.2 What is uncertain

SWMM carries depths at nodes only; the profile between nodes is not part of its state. Let V_S(t) be the volume SWMM's state represents, and e(t) = V_b(t) − V_S(t) the error of interpreting it with a linear surface.

Under R3' (a monotone surface in each segment, PV-C1's accepted bracket assumption):

  |e(t)| ≤ B(t) = Σ_s L_s·|A(y_i) − A(y_{i+1})|  (`conduitVolumeBounds`)

The closure test is |⟨V_S⟩_w − V_in| ≤ 0.001·V_in. What is observed is ⟨V_b⟩_w = ⟨V_S⟩_w + ⟨e⟩_w.

### 3.3 Separating the mean and the oscillation

Write each node depth as y_i(t) = ȳ_i + δy_i(t), where ȳ is the window mean. Under R1':
- δy is a sum of the closed system's linear modes;
- every mode has period T_m ≤ T_ref·(1 + ε), because T_ref is the network's longest period;
- the amplitudes are monotone in time over a window.

Expanding e about the mean state:

  e(t) = ē + ẽ(t) + r(t)

where:
- ē is the error at the mean surface, bounded by the bracket of the mean surface: |ē| ≤ B_mean = Σ_s L_s·|A(ȳ_i) − A(ȳ_{i+1})|;
- ẽ(t) is linear in δy, so it is a sum of sinusoids at the modal periods;
- r(t) is the second-order remainder.

**Bound on the oscillating part.** Since ẽ = e − ē − r, we have |ẽ(t)| ≤ B(t) + B_mean + |r|, so every modal component of ẽ has amplitude at most max_t B(t) + B_mean.

**Bound on the remainder.** A(y) has curvature dW/dy. Across a segment, the unknown profile can deviate from linear by at most the node amplitude a, so

  |r| ≤ C2 = ½·|dW/dy|·a_max²·L

At the linearity bound a_lin = 3.99 mm this is 8.5e-5 m³, below 0.5 % of the closure criterion.

### 3.4 The leakage lemma

**Lemma.** Let x(t) = a(t)·cos(ωt + φ), where a ≥ 0 is monotone on [0, W] and ω = 2π/T. Then

  |(1/W) ∫₀^W x dt| ≤ (T/(πW))·max(a(0), a(W)).

**Proof.**
1. Let S(t) = ∫₀^t cos(ωs + φ) ds = [sin(ωt + φ) − sin φ]/ω, so |S| ≤ 2/ω.
2. Integrating by parts: ∫₀^W a·cos = a(W)·S(W) − ∫₀^W a′·S dt.
3. Hence |∫| ≤ (2/ω)·[a(W) + ∫|a′|] = (2/ω)·[a(W) + |a(0) − a(W)|] = (2/ω)·max(a(0), a(W)), using the monotonicity of a.
4. Divide by W, and note 2/(ωW) = T/(πW). ∎

For a constant amplitude the exact value is a·|sin(ωW/2)|/(ωW/2), which is 0 when W is an integer number of periods. The lemma's bound covers a period that is wrong by up to ε, and a decaying amplitude.

**Applied to the window.** With W = M·T_ref and T ≤ T_ref·(1 + ε), every modal component leaks at most λ = (1 + ε)/(πM) of its amplitude into the mean. Shorter modes leak less.

**The interpretation bound.** Hence

  **E_V,w = (1 + λ)·B_mean,w + λ·max_{t∈w} B(t) + C2,w**,  with |⟨V_b⟩_w − ⟨V_S⟩_w| ≤ E_V,w.

### 3.5 What the bound does not prove

The lemma bounds each mode's leakage. The sum over modes is bounded by λ·Σ_m (amplitude of mode m), not by λ times the amplitude of the sum. A record with several comparable modes could therefore leak more than λ·max B.

This is not proved away. It is tested at run time by **W4**:
- ⟨V_b⟩ is recomputed over 8 windows of the same length, shifted back by j·T_ref/8, j = 0, …, 7;
- the spread (max − min) must be ≤ 2·E_V,w3.

A leak larger than the bound shows as a phase-dependent mean, and therefore as a spread. If W4 fails, the books are **Insufficient reference data** (sub-class IR-basis); they are not Failed.

**W4 is a diagnostic, not a bound.** It shows that the mean does not depend on the shifts tested. It does not establish a general upper bound:
- The shifts sample mode m at phase steps of 45°·T_ref/T_m. They are blind to a mode whose period divides T_ref/8; at N = 32, mode 8 (about 55 s) is close to that.
- Such a mode leaks at most T_m/(πW) ≈ λ/8 of its amplitude, so the blind spot concerns small terms. It is still a gap, not a proof.
- Two modes in a beat can cancel in the spread statistic at particular phases.

Acceptance of W4 as sufficient is therefore a condition for review (Q1a), not a claim of this proposal.

### 3.6 The level

The tanks are prismatic (R2), so A_t·d is linear in d and the mean tank depth carries no curvature error. The only error in ⟨h_tank⟩ is leakage:

  E_h,w = λ·a_max(T1, T2),w

The level reference h_eq assumes a level surface at V_in. So the level row is interpreted only where the mean state is level within the solver's head tolerance (section 6), and where the books are stationary.

## 4. The period basis and ε

ε is an a-priori bound on |T_actual/T_ref − 1| for the **fundamental**. Every other mode is shorter by construction, so the leakage premise (T ≤ T_ref·(1 + ε)) concerns the fundamental only. Values are in `derived.json` → `cases.N*.eps`; formulas are in `derive.mjs`.

| Part | N = 1 | N = 4 | N = 16 | N = 32 | Kind | Formula | derive.mjs |
|---|---|---|---|---|---|---|---|
| level | 0.2534 % | 0.2532 % | 0.2532 % | 0.2532 % | **computed bound** | max over h = h_eq ± 2 mm (the level criterion) of |T1(h) − T1(h_eq)| / T1(h_eq), lumped model re-solved at each level | lines 45–47 |
| amplitude | 1 % | 1 % | 1 % | 1 % | **scaling estimate** | nonlinear period shift O(a/y_hyd), coefficient taken as 1, with a ≤ 0.01·y_hyd held by W1 | line 52 |
| time step | 0.0007 % | 0.0016 % | 0.0017 % | 0.0017 % | **scaling estimate** | (ω₁Δt)²/12, the phase error of a generic implicit one-step scheme; SWMM's iterated EXTRAN scheme is not analysed | lines 49–50 |
| friction | 0.0047 % | 0.0039 % | 0.0039 % | 0.0039 % | computed bound under linearisation | ζ²/2, ζ = (8/3π)·(g·n²/R^{4/3})·v_lin/(2ω₁), v_lin the conduit velocity amplitude at a = a_lin | lines 53–56 |
| **sum** | **1.259 %** | **1.259 %** | **1.259 %** | **1.259 %** | | | line 57 |
| **declared** | **1.5 %** | | | | | sum rounded up to the next 0.5 % | line 58 |

**Combination rule.** A worst-case **linear sum** of the absolute component bounds, not root-sum-square: the components are not independent random errors, so no statistical combination is claimed.

**What the budget does not cover:**
- **Model form.** The lumped linear network is not SWMM's discrete system. Examples are the node surface-area definition, and INERTIAL_DAMPING PARTIAL at very low Froude number. This is not bounded a priori.
- **The amplitude term**, which dominates the budget (1 of 1.26 %), is a scaling estimate, not a derived bound.

W3 is the run-time guard for both.

**What the leakage factor λ = (1 + ε)/(πM) depends on:**
- (a) ε, as above;
- (b) M = 8;
- (c) a monotone amplitude envelope within each window. This is not tested directly: a beating envelope from two interacting modes is what W4 is meant to expose;
- (d) every mode period ≤ T_ref·(1 + ε), which is true of the lumped model by construction.

**W3** checks the basis at run time. The mean zero up-crossing interval of T1 − T2 over the K windows must be within ε of T_ref. If it is not, the oscillation is not the declared one, the leakage lemma's premise fails, and every cycle-averaged row is Insufficient reference data.

## 5. The design constants and why each has its value

None of these is chosen from a run.

| Constant | Value | Justification |
|---|---|---|
| closureRel | 0.001 | PV-C1's and PV-TF1's closure criterion, unchanged |
| equilibriumAbsM | 0.002 m | PV-C1's and PV-TF1's level criterion, unchanged |
| β (residual-motion share) | 0.1 | The bound on what the residual motion can do may use at most a tenth of a criterion, so that a pass or fail is decided by the solver, not by the interpretation. This is the principle PV-TF1 draft 2 used for its rest-flow threshold, applied here to the books and the level. W2: E_V ≤ 0.018 m³; E_h ≤ 0.2 mm |
| M (periods per window) | 8 | λ = (1 + ε)/(8π) = 0.0404. The constraint is that the oscillating bracket allowance (β·0.18 m³)/λ = 0.446 m³ should admit the amplitudes a linear, small-amplitude record can have: at N ≥ 16 it is linearity-limited (a_lin) rather than leakage-limited. M = 4 would halve that; M = 16 doubles the record needed for the same K. 8 is the smallest power of two for which N ≥ 16 is not leakage-limited |
| K (scored windows) | 3 | the minimum that tests stationarity twice (w1→w2, w2→w3), so a monotone drift and a one-off step can be told apart |
| ε | 0.015 | section 4 |
| a_lin = linFrac·y_hyd | 0.01 → 3.99 mm | 1 % keeps the nonlinear period shift and C2 inside their budgets (section 4; C2 = 8.5e-5 m³) |
| shift count | 8 | phase resolution T_ref/8 = 45°: enough to expose a phase-dependent mean |
| shift factor | 2 | each of two windows can be off by E_V in opposite directions, so 2·E_V is the most a valid record can spread |
| headToleranceM | 0.0015 m | SWMM's own convergence tolerance (dynwave.c line 618, registered as HEAD_TOLERANCE). A mean non-uniformity below it cannot be distinguished from the solver's stopping rule. It is the Qualified/Failed boundary of the uniformity row, never a reference |

### What these imply (derived.json, not criteria)

| N | Window (s) | Bracket per unit amplitude (m²) | Amplitude allowed by W2, books (mm) | Allowed by W2, level (mm) | a_lin (mm) |
|---|---|---|---|---|---|
| 1 | 5327 | 800 | **0.56** | 4.95 | 3.99 |
| 4 | 3645 | 200 | 2.23 | 4.95 | 3.99 |
| 16 | 3560 | 50 | 3.99 (linearity-limited) | 4.95 | 3.99 |
| 32 | 3556 | 25 | 3.99 (linearity-limited) | 4.95 | 3.99 |

**N = 1 is tight.**
- With one 400 m segment, the bracket is 800 m² per metre of node amplitude.
- The books are interpretable only once the node amplitude is below 0.56 mm.
- This follows from the geometry and β; it is not a tuned number.
- Whether a 48 h record reaches it is a feasibility risk (section 7). If it does not, N = 1's books are Insufficient reference data.

## 6. Distinguishing oscillation, imbalance and drift

All three tests are fixed formulas of the recorded state.

| Test | Formula | Meaning |
|---|---|---|
| **Uniformity** (N ≥ 4) | U = max_j \|⟨WSE_j⟩ − ⟨WSE_tank-mean⟩\| over junctions, window w3 | a bounded oscillation about a level mean leaves at most τ_osc = λ·(a_j + a_tanks) + max v²/(2g) in U; the last term is the mean set-down of moving water |
| Uniformity classes | U ≤ τ_osc: **Passed**; ≤ 1.5 mm: **Qualified** (within the solver's tolerance); otherwise **Failed** (numerical) | Failed is a persistent hydraulic imbalance: SWMM's settled mean is not level |
| **Book stationarity** | max_k \|⟨V⟩_wk − ⟨V⟩_wk−1\| ≤ E_V,wk + E_V,wk−1 | Failed (accounting) means continuing drift of the stored volume after the inflow ended, in a closed system |
| **Level drift (W5)** | \|⟨h_tank⟩_wk − ⟨h_tank⟩_wk−1\| ≤ E_h,wk + E_h,wk−1 | a mean level still moving; the level row is Insufficient reference data |

The books do not assume a level surface (section 3), so they remain valid under an imbalance. The level row does assume one, so it is scored only when U ≤ 1.5 mm and W5 holds.

**For review: the stationarity allowance is lenient.** The B_mean part of E_V is common to both windows when the mean state is fixed, and would cancel in the difference. A tighter allowance uses the leakage and curvature terms only. The proposal keeps the sum because the mean state is exactly what stationarity tests; reviewers may prefer the tighter form.

## 7. The experiment, its duration and its size

**Matrix: 20 runs.**

| | NONE (PRIMARY, scored) | BOTH (PAIRED, scored, separate tally) | NONE + Δt 0.5 s | NONE + MIN_SURFAREA 0.1 | NONE on the getter-420 build |
|---|---|---|---|---|---|
| N = 1 (reference) | ✓ | ✓ | unscored | unscored | unscored |
| N = 4 | ✓ | ✓ | unscored | unscored | unscored |
| N = 16 | ✓ | ✓ | unscored | unscored | unscored |
| N = 32 | ✓ | ✓ | unscored | unscored | unscored |

**Configurations:**
- Everything other than the factor named is unchanged from PV-TF1: the inflow, geometry, BCs, seal, guards, V1–V4 and stepping.
- INERTIAL_DAMPING NONE (run 1's F2 diagnostic) is dropped. It does not bear on the storage mechanism.
- **Limiter effect.** Δ_N = ⟨V⟩_BOTH − ⟨V⟩_NONE is reported with uncertainty E_V,BOTH + E_V,NONE.
  - "No detectable difference" is reported as exactly that, never as equivalence.
  - The fill-phase limiter-condition counts under BOTH are reported as in the run-1 post-run analysis.

**Duration: 48 h (172 800 s).** This is a design parameter, declared now and not to be changed after the fact.
- The scored record is the last 3·M·T_ref: 4.4 h (N = 1), 3.0 h (N = 4), 3.0 h (N = 16 and 32).
- The rest of the run is free decay.
- **Feasibility only.** Run 1 used BOTH, the other configuration. It shows that 12 h left node amplitudes of the order of a millimetre (post-run README B3). That says 12 h is too short; it does not say 48 h is enough.
- No decay law is extrapolated to choose 48 h. The value is 4× run 1, a practical ceiling on run time and output size.
- If W1–W4 are not met at 48 h, the outcome is Insufficient reference data. That is a result, not a reason to extend.
- The case most at risk is N = 1, with an allowance of 0.56 mm.

**Feasibility is open.** As the provisional verdict notes, a design that predictably ends as Insufficient across the matrix would be an expensive way to learn something already suspected. How feasibility is settled before the 20-run matrix is authorised is Q4c. Nothing here is run.

**Raw output: the hybrid strategy (provisional verdict, Q4b).**
- **Every step, full 48 h:** every validity, guard, seal and stepping check is evaluated, and the all-step summaries are kept.
- **Kept at full resolution:**
  - every routing step of the scored windows and the shifted windows (the last 3·M·T_ref + T_ref);
  - ± one T_ref around any guard or validity trip;
  - the complete configuration, the generated .inp files and the hashes.
- **Archived outside git:** the full every-step record (about 1.9 GB), with SHA256SUMS committed, if practical.
- **Never decimated:** the scored windows.

## 8. Expected interpretation of each hypothesis

Rows are PRIMARY (NONE) unless stated. "Offset" means ⟨V⟩_w3 − 180 outside the closure criterion with the books valid.

| Hypothesis | Supported if | Contradicted if | Cannot be judged if |
|---|---|---|---|
| **P1** open outfall explains T2-C | NONE closes at N = 4, 16, 32 (and at the N = 1 reference); seal flux 0 | an offset at any N with seal flux 0: the closed system itself does not conserve, so T2-C's error is not only the outfall | W1–W4 fail at that N |
| **P2a** link storage at end-node areas | offset of T2-C's sign at N = 1 and N = 4, smaller at 16 and 32, each difference beyond the sum of the E_V | no offset at N = 1 and 4 | N = 1's books Insufficient (the amplitude risk), or N = 4 not comparable for the quantity (section 9) |
| **P2b** junction minimum area | no offset at N = 1; an offset from N = 16 to 32 within the J2 bound (1.8 / 8.9 / 18.3 m³); smaller in msa0.1 | offsets that do not respond to msa0.1, or exceed the J2 bound | msa0.1 diagnostic invalid |
| **P3** F1 excluded | guards < 0.9 D (G-node, G-link) | any guard exceeded: invalid setup | — |
| **P4** limiter | \|Δ_N\| > E_V,BOTH + E_V,NONE at some N, with an N dependence | — (no difference is not proof of equivalence) | either case's books Insufficient at that N |
| **Imbalance** | U Failed at some N | — | W1–W4 fail |

In every case:
- The statement is limited to this closed, horizontal, part-full configuration and to the end state.
- A cycle-averaged end state that closes does not show that the transient was right (transientStatement).
- T2-C's registered Failed rows stay Failed whatever the outcome.

**Segmentation reading:**
- N = 1 is reported separately.
- N = 16 vs N = 32 is a segmentation effect: they are comparable in modes 1–3 within 2ε.
- N = 4 is comparable in the fundamental only. It enters the comparison for the cycle-averaged end state, but fill-time differences involving N = 4 are reported, not attributed.
- No line or power law in N is fitted, and nothing is extrapolated.
- A direction ("rises", "falls") is stated only where each successive difference exceeds the combined E_V.
- Each case's W3 confirms its own period at run time. A case that fails W3 leaves the comparison.

**Outcome classes in the report.** These are never merged:

| Class | Meaning |
|---|---|
| **IR-motion** | Insufficient: the physical oscillation had not decayed enough (W1 or W2 fails; W3 and W4 hold) |
| **IR-basis** | Insufficient: the period or averaging assumptions failed (W3 or W4 fails) |
| **IR-drift** | Insufficient: the mean level was still moving (W5 fails; level row only) |
| **Failed** | a genuine storage, conservation or level violation, with the reference valid |

**Limiter arms in the findings register.** NONE and BOTH are recorded as separate findings, never pooled.
- NONE answers the storage question without the normal-flow limiter.
- BOTH answers whether production's limiter changes the result.
- A difference within the combined uncertainty is "no detectable difference under this experiment", not "no effect".

## 9. What run 1 does and does not tell us

**Still applicable:**
- **F10 source facts**: what the nominal slope does, only through checkNormalFlow, and that NONE skips it. These are facts about SWMM's source code, not about run 1's numbers.
- **F11's mode structure**: the free motion is the lumped seiche, it is physical, and its decay is quadratic. R2's periods are computed independently in any case; run 1 is the evidence that R1' is a realistic premise.
- **The mechanics**: the stepping rule (the final step kept), V1–V4, the guards, the seal, getter-420 equality and R4. These are carried by construction, and are re-checked.
- **Feasibility only**: that 12 h is too short for the instantaneous definition.

**Not usable to infer the revised outcome:**
- Any closure, level, uniformity or drift value from run 1. Those were BOTH, instantaneous, and taken in motion.
- The size or sign of the limiter's effect. Run 1 has no NONE case.
- Any trend in N.
- Run 1's decay rates, as a prediction of NONE's amplitudes at 48 h. The limiter may change the fill and the starting amplitude.
- Whether W1–W4 will be met. In particular, whether N = 1 reaches 0.56 mm.

Run 1's statuses are unchanged: 19 Passed and 8 Insufficient reference data. PV-TF1-R2 does not re-score them.

## 10. When the cycle-averaged reference is NOT justified

These cases are stated before any run. In each, the experiment reports Insufficient reference data, not a pass or a fail.

1. **Not linear:** the amplitude exceeds a_lin (W1).
2. **Not the declared oscillation:** the observed period departs from T_ref by more than ε (W3). Examples are a mode the lumped model does not have, or a level far from h_eq.
3. **Too much motion for the books:** E_V > 0.018 m³ (W2). This is the expected risk at N = 1.
4. **Multi-mode leakage beyond the bound:** a phase-dependent mean (W4).
5. **A mean level still drifting** (W5). This affects the level row only.
6. **A non-monotone surface within a segment.** This violates R3'. It is not tested at run time; it is the bracket assumption accepted in PV-C1, and reviewers should decide whether it holds in motion.

W4 is a diagnostic with a known blind spot (section 3.5), not a bound. If reviewers do not accept the single-mode leakage lemma with the empirical W4 check as sufficient, then **the cycle-averaged reference cannot be justified independently** in this form. The alternatives are:
- M large enough that λ·Σ_m bound is met under a declared, pessimistic modal content (≈ 2–3× the record length);
- dropping the books as a scored quantity.

## 11. Open points for review

See [`REVIEW-REQUEST.md`](REVIEW-REQUEST.md).
