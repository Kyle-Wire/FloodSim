# PV-TF1-R2 draft 3: technical review (12 Nov 2026)

**Disposition:** revise before independent review. The revision is a targeted mathematical closure pass: no redesign, no reopening of the leakage work, and no further 48 h feasibility analysis.

The reviewer read the derivation text. The JSON and JavaScript were not visible to them, so derived.json and the implementation were not independently reproduced.

## Accepted

- **R3'':** the representation volume as the scored closure reference, provided the report calls it **representation-volume closure** throughout, never physical moving-water conservation. The physical-profile bounds stay in D5.
- **C_fn:** the quadrature-based definition sensitivity, with the guards below.
- **Withdrawals:** the physical-profile and multi-mode leakage claims are withdrawn.
- **Periods and ε:** the revised interpretation. The fundamental is the longest period of the reference network only.
- **The design:** NONE primary and BOTH paired (separate tallies); N = 1 separate; N = 4 end-state only; N = 16 vs 32; M = 8; K = 3; β = 0.1; 48 h; the hybrid archive. Insufficient is a legitimate outcome.
- **Stationarity tiers:** the tighter Passed threshold and the separate Qualified tier are preferred. They are not to be tightened further without a mathematical reason.
- **The 2.7 mm figure** is a worst-case calculation, not evidence that the run will pass.

## Required before approval

**1. D4 into the validity logic (blocking).** The relation is M_s = P_s + r_s, so the bound available from the record is

  U ≤ ½·Σ|P_s| + ½·Σ|r_s|.

The allowance cannot rest on P_s while the discrepancy r_s is treated as irrelevant. Include R_U = ½·Σ|r_s| in the allowance, or require it to stay below a predeclared numerical tolerance. If it exceeds that tolerance, the affected rows are Insufficient reference data, not Failed. Preserve the residual profile. E8 inherits the dependency, which must be explicit in the classification logic.

**2. The Froude condition.** The source correspondence holds only at Fr ≤ 0.5. Check it on every relevant link at every scored step. Where it is violated, the correspondence is not established for that interval.

**3. Depth-endpoint guards.** W′(y) is singular at y = 0 and y = D. Return an invalid or Insufficient status if the recorded range reaches a singular endpoint, rather than an infinite or clipped allowance. Take the maximum over the complete recorded depth range for each segment, not at h_eq. The same applies to R2.

**4. Section 3.5 wording.** State the absolute error, |V_b(t) − V_in| ≤ C_fn(t), under the conserving-representation hypothesis.

## Advice

Fix D4, run the final derivation checks, send draft 3 to independent review, and do not keep expanding the scope.
