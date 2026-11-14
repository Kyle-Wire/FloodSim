# PV-TF1-R2: change log

Draft 3 → 3a comes first. Draft 2 → 3 follows unchanged.

## Draft 3 → draft 3a

- **Draft 3** is preserved in [`drafts/draft3/`](drafts/draft3/). Running its `derive.mjs` reproduces draft 3's `derived.json` (checked with cmp).
- **The prompt** is the technical review of draft 3, `../reviews/review-r2-draft3-2026-11-12.md`.
- **Scope:** a targeted closure of its four required items. No redesign, no criterion changed.
- **Nothing was run, hashed or registered.**

| Item | Draft 3 | Draft 3a | Review item |
|---|---|---|---|
| Uniformity bound (E6) | U ≤ τ_U "if M_s = P_s"; r_s diagnostic only | U ≤ τ_U + R_U, R_U = ½·Σ\|r_s\|, an identity with no assumption (DERIVATION 4.3) | 1 |
| Uniformity tiers | Passed ≤ τ_U; Qualified ≤ τ_U + 1.5 mm; Failed beyond | **withdrawn.** Passed when G-uniformity and G-reference hold; otherwise Insufficient (IR-motion, IR-reference). **The row has no Failed status**, because U ≤ ½·Σ\|M_s\| identically | 1 |
| New gate G-reference | none | (a) Fr ≤ 0.5 at every segment and step of w1–w3 and the step before; (b) G-depth; (c) R_U,w3 ≤ β·1.5 mm = 0.15 mm. Else IR-reference, with the residual profile, its cumulative form and the Froude record preserved (4.5) | 1, 2 |
| D4 | reported, "never scored" | still never scored as a physical result; R_U and the Froude record enter through G-reference (4.4) | 1 |
| Level allowance (E8) | [S_J·τ_U + ⟨R2⟩]/(2A_t + L·min W): inherited E4 | [\|Σ_j S_j·⟨u_j⟩\| + ⟨R2⟩]/(2A_t + L·min W), from the **measured** junction deviations in the exact identity E7. No E4, τ_U or residual. The level row does not depend on G-reference or on the uniformity row (5.2) | 1 ("E8 inherits the dependency") |
| G-level | E_h ≤ 0.2 mm (IR-motion); uniformity not Failed (IR-imbalance); W5; Qualified if uniformity Qualified | G-depth (IR-definition); E_h ≤ 0.2 mm (**IR-redistribution**); W5 (IR-drift). IR-imbalance and the Qualified rule retired | 1 |
| New equation E8a | none | Fr_s(t) = \|Q/Ā\|/√(g·Ā/W̄) at ȳ, as link_getFroude (link.c lines 847–871) | 2 |
| Source correspondence R1'' | E4's backward-Euler form "at Fr ≤ 0.5" | conditions listed (Fr ≤ 0.5, both ends wet, not full, zero offsets → SUBCRITICAL, dwflow.c 331–335) and exceptions with lines (q under-relaxation 265, flow reversal 266, limiter 255–258, dry end 280–281) (4.1) | 2 |
| C_fn (E3) | (1/12)·max\|W′\|_w·Σ L_s·Δ_s², W′ over the recorded range | Σ_s (L_s/12)·max\|W′\|_{s,t}·Δ_s², W′ over **each segment's** range at **each step**, never at h_eq (3.4) | 3 |
| R2 bound (E7) | max\|W′\|_w | max\|W′\|_{s,t} over [min(h̄, y_i, y_{i+1}), max(…)] (5.1) | 3 |
| New gate G-depth | none (only the 0.9·D guard) | every recorded depth in [0.1·D, 0.9·D]; else no C_fn or R2 is computed (no infinite, clipped or substituted value): books and level IR-definition, uniformity IR-reference. max\|W′\| on that interval 2.667 | 3 |
| Section 3.5 | "V_b(t) − V_in ≤ C_fn(t)" | \|V_b(t) − V_in\| ≤ C_fn(t) under the stated conserving-representation hypothesis, and \|⟨V_b⟩_w − V_in\| ≤ C_fn,w | 4 |
| Naming | "closure" | "representation-volume closure" in outputs, failure classes and limitations | acceptance condition |

**Insufficient sub-classes:**
- **added:** IR-redistribution and IR-reference;
- **IR-definition** widened to cover G-depth;
- **IR-imbalance** retired.

**Reported outputs** gain, per window: τ_U, R_U, the residual profile, the maximum Froude number per segment, and the depth range against G-depth.

**derive.mjs / derived.json:**
- **New constants:** `depthGuardFrac [0.1, 0.9]` and `froudeLimit 0.5`.
- **New:** `secondOrder.depthGuard` (max\|W′\| 2.667 on the guard interval).
- **New:** `budgets.worstCaseAtLinearityAmplitude[*].froudeMax` (≈ 0.0095–0.0105 at a_lin).
- **New:** `budgets.levelNote`. The a-priori E_h uses τ_U, i.e. it assumes r_s = 0; at run time the measured redistribution is used.
- **Unchanged:** every other number.

**Unchanged:**
- the criteria, M, K, β, the 48 h maximum, the matrix, the hybrid output;
- the stationarity tiers. The review said not to tighten them without a mathematical reason.

---

## Draft 2 → draft 3

- **Draft 2** is preserved in [`drafts/draft2/`](drafts/draft2/): spec, derivation, review request, and `derive.mjs` with its import paths repointed. Running that copy reproduces draft 2's `derived.json`. The reproduction was checked: N = 1 allowance 0.557 mm, C2 8.47e-5 m³.
- **Draft 3's prompt** is the technical review resolution, `../reviews/resolution-r2-draft2-2026-11-12.md`.
- **Nothing was run, hashed or registered.**

### Equations

| Item | Draft 2 | Draft 3 | Why |
|---|---|---|---|
| Books | ⟨V_b⟩ over M·T_ref, compared with the "true" (physical) volume | ⟨V_b⟩ compared with V_in as the **representation volume** (E2, R3'') | the physical volume in motion is not testable from SWMM's state (D3 §3.2) |
| Interpretation bound | E_V = (1 + λ)·B_mean + λ·max B + C2 | **withdrawn**. Replaced by C_fn (E3), the representation-definition sensitivity | E_V applied a modal decomposition to an unknown function e(t), and summed modes incorrectly (review points 1 and 2) |
| C2 | ½·\|W′\|·a²·L, assuming internal deviation ≤ a | **withdrawn**. C_fn = (1/12)·max\|W′\|·Σ L_s·Δ_s², by the quadrature lemma, from recorded depths | review point 2 |
| Leakage lemma | bound (T/(πW))·max(a(0), a(W)) for any monotone a | (T/(πW))·(\|a(W)\| + TV(a)); a(0)·T/(πW) for non-increasing a ≥ 0. **Not used for scoring** | review point 1 |
| Multi-mode leakage | λ·max B, "covered by W4" | λ·Σ_m(amplitude terms) stated correctly. An energy bound was investigated and not used. **No scored row depends on it** | review point 1 |
| Uniformity allowance | τ_osc = λ·(a_j + a_tanks) + max v²/(2g) | τ_U = ½·Σ_s \|P_s\|, with P_s from the exact window identity of the reference link equation E4/E5, on recorded flows | removes leakage and ε from the row |
| Uniformity extent | junctions, N ≥ 4 | every node including both tanks; for N = 1, the tank pair | draft 2 had no balance condition for N = 1's level row |
| Level allowance | E_h = λ·a_max(tanks) | E_h = [S_J·τ_U + ⟨R2 bound⟩]/(2·A_t + L·min W), from the exact level identity E7 | removes leakage |
| Level drift W5 | \|Δh̄\| ≤ E_h,k + E_h,k−1 | + \|Δ⟨V_b⟩\|/(2·A_t + L·min W): level movement beyond what the motion and the (separately scored) book drift explain | consistency with E7 |
| Book stationarity | Passed if ≤ E_V,k + E_V,k−1 (up to ~0.036 m³), else Failed | Passed ≤ C_fn,k + C_fn,k−1; **Qualified** ≤ 0.018 m³; Failed beyond | E_V withdrawn. The new Passed threshold is stricter, and the Qualified ceiling is below draft 2's pass threshold, so this is not a weakening |
| Reference link equation | none | E4: lumped St Venant + Manning; SWMM's EXTRAN link update is its backward-Euler form (fact from source) | basis of τ_U and E_h |
| Periods E10 | basis of the leakage premise | window length and diagnostics only | review point 3 |

### Validity conditions

| Draft 2 | Draft 3 |
|---|---|
| W1 linearity (gate) | **D1**, diagnostic only |
| W2: E_V ≤ 0.018 m³; E_h ≤ 0.2 mm | **G-books:** C_fn ≤ 0.018 m³. **G-level:** E_h ≤ 0.2 mm. **New G-uniformity:** τ_U ≤ β·1.5 mm = 0.15 mm |
| W3 period basis (gate) | **D2**, diagnostic only. Described as checking the T1 − T2 fundamental only |
| W4 shifted-window spread ≤ 2·E_V (gate) | **D3**, diagnostic only, with its blind spots stated |
| W5 level drift | W5, revised as above |
| none | **New D4** momentum residual, **D5** physical-profile sensitivity, **D6** modal projection (all reported) |

### Constants

| Constant | Draft 2 | Draft 3 |
|---|---|---|
| closureRel, equilibriumAbsM, sealFluxAbs, junctionVolumeAbsM3, nodeVolumeRel | 0.001, 0.002, 0, 1e-9, 1e-6 | **unchanged** |
| M, K, β, headToleranceM | 8, 3, 0.1, 1.5 mm | **unchanged** |
| ε | a-priori period uncertainty bound, 1.5 % | **reclassified as a declared tolerance** for D2 and the comparability rule. Components classified: level computed; amplitude a scaling estimate; time step an unbounded estimate; friction computed under linearisation |
| linFrac 0.01, shifts 8 | gate constants | diagnostic tolerances |
| a-priori depth band | none | h_eq ± 0.1 m, used only for the a-priori max\|W′\| in derived.json. Run time uses the recorded range |

### Interpretation

| Item | Draft 2 | Draft 3 |
|---|---|---|
| Meaning of the closure row | physical stored volume (in motion, via a bound) | **volume of SWMM's N-segment representation**. Physical in motion reported as D5. At rest identical. **Needs explicit acceptance** |
| Insufficient sub-classes | IR-motion, IR-basis, IR-drift | IR-motion, IR-drift, **IR-imbalance**, **IR-definition**. IR-basis retired (no scored row depends on the period or averaging assumptions) |
| Imbalance-within-tolerance class | uniformity Qualified, level Qualified | the same; the level row is Qualified because the redistribution may exceed E_h |
| P4 | Δ_N with uncertainty E_V sum | Δ_N with uncertainty C_fn sum + D3 spreads; **and** the D4 residual under BOTH and not under NONE |
| Trend rule | differences beyond the sum of E_V | differences beyond the C_fn sum + D3 spreads. A case flagged by D2 is not used for a direction statement; its scores stand |
| N = 1 feasibility | books needed amplitude ≤ 0.56 mm (bracket 800 m²) | the bracket is no longer used. The binding gate is G-uniformity at about 2.7 mm (worst case) |
| relationToFindings F4 | "bounded, not removed" | removed for the scored closure by R3''; the physical in-motion volume remains unresolved (D5) |

### derive.mjs / derived.json

**Removed:**
- `budgets.oscillatingBracketAllowM3`;
- `tankAmplitudeAllowForLevelRowM`;
- `impliedFundamentalAmplitudeAllowM`;
- `secondOrder.curvatureBoundAtLinearityAmplitudeM3`. It is kept as `draft2C2Superseded`, with the reason.

**Renamed:**
- `eps` → `periodTolerance`, with a classification per component;
- `window.leakageFactor` → `leakageFactorDiagnosticOnly`.

**Added:**
- `oscillatingModesCarryNoLinearVolume`;
- `junctionStorageM2` and `levelStorageM2`;
- `budgets.worstCaseAtLinearityAmplitude` (I, F, C, τ_U, E_h, C_fn, R2);
- the a-priori amplitudes for each gate;
- `physicalProfileSensitivity`;
- `secondOrder` definitions for C_fn and R2.

**Unchanged:** T_ref, the mode periods, the comparability results and the window steps.
