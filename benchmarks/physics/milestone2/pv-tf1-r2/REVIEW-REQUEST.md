# PV-TF1-R2 draft 3a: request for confirmation by the technical reviewer, then independent review

## What is to be reviewed

| File | What it is |
|---|---|
| [`PV-TF1-R2.json`](PV-TF1-R2.json) | proposed spec, draft 3a |
| [`DERIVATION.md`](DERIVATION.md) | the derivation: assumptions, inequalities, proofs, limitations. Section 11 classifies every conclusion |
| [`derive.mjs`](derive.mjs) → [`derived.json`](derived.json) | every derived number, from the declared inputs only |
| [`CHANGELOG.md`](CHANGELOG.md) | every change since draft 3 ("3 → 3a"), then since draft 2 |
| [`drafts/draft3/`](drafts/draft3/), [`drafts/draft2/`](drafts/draft2/) | earlier drafts as reviewed |

The technical review of draft 3 was made from the derivation text alone. **The JSON and the script are attached with this request** so that derived.json and the gate logic can be checked against the text.

## Status

- Nothing here is hashed, registered or run. No execution is authorised.
- The original PV-TF1 (`../../spec/PV-TF1.json`) and run 1 (`../../results/2026-11-12T15-00-21-588Z/`) are unchanged.
- No module for R2 exists yet.

## Rules

- Any change made in response to review is recorded as a new proposed draft.
- No change may use run-1 numbers.
- The spec is copied to `spec/` and hashed only after approval.

## For the technical reviewer: confirmation of the four required items

| Item | Where | What was done |
|---|---|---|
| 1. D4 in the validity logic (blocking) | DERIVATION 4.3–4.5, 5.2; JSON `cycleAveragedEquilibrium.gates`, `classification` | U ≤ τ_U + R_U, proved without assumption. **G-reference** gates R_U ≤ 0.15 mm (β·HEAD_TOLERANCE), else IR-reference; the residual profile is preserved. **E8 no longer inherits the dependency:** the level allowance uses the measured junction redistribution in the exact identity E7, so the level row is independent of E4 and of G-reference |
| 2. Froude | 4.1, 4.5; E8a | Fr ≤ 0.5 at every segment and every step of w1–w3 and the step before, with SWMM's formula. The other correspondence conditions (wet ends, not full, zero offsets) and the exceptions are listed with source lines |
| 3. Depth-endpoint guards | 3.4, 5.1; G-depth | W′ is taken over each segment's complete recorded range at each step, for C_fn and R2. If any depth leaves [0.1·D, 0.9·D], no allowance is computed and the rows are IR-definition (uniformity IR-reference) |
| 4. Section 3.5 | 3.5 | \|V_b(t) − V_in\| ≤ C_fn(t) under the stated hypothesis |

### T7. A consequence of item 1 that needs a decision

Including the residual makes the uniformity row **unable to Fail**, under either form the review allowed. The reason is that U ≤ ½·Σ\|M_s\| = ½·Σ\|P_s + r_s\| holds identically (DERIVATION 4.3).

A persistent hydraulic imbalance therefore appears as R_U > 0.15 mm, and is reported as **IR-reference** with its residual profile. The same class covers a SWMM departure from E4 (the limiter, flow reversal, non-convergence), and this row does not separate the two. The NONE/BOTH comparison (P4) is reported.

Draft 3a adopts this. The alternative would be to score R_U as its own numerical row (a SWMM-against-E4 consistency test). "Failed" would then mean that SWMM's mean heads depart from E4, not that the water is physically unbalanced.

**Is Passed/Insufficient-only acceptable for the uniformity row?**

### T8. The R_U tolerance

R_U ≤ β·1.5 mm = 0.15 mm uses the same β principle as the other gates. Whether SWMM's residual (flow reversal near every reversal, iteration lag) stays below it at 48 h is **not known a priori**; run 1 has no residual record. Is the tolerance acceptable as declared?

## Carried unchanged from draft 3

The review accepted the following, and draft 3a changes none of them:
- R3'' (as representation-volume closure);
- C_fn;
- the withdrawals;
- periods and ε;
- the design;
- the stationarity tiers.

## Questions carried to the independent reviewers

- **The derivations:** the quadrature lemma (3.4), the envelope bound (3.2a), the window identity (4.2), the uniformity bound with residual (4.3), the level identity and measured-redistribution allowance (5.1–5.2), and the corrected leakage lemma (6.2).
- **The SWMM correspondence:** that dwflow.c lines 192–240 are E4's backward-Euler form under the conditions of 4.1, and that the listed exceptions are complete.
- **The N = 1 period:** the derivation of 665.86 s from the registered geometry.
- **The a-priori worst cases** (which assume r_s = 0): do they correctly bound the run-time formulas?
- **Scoring BOTH:** whether BOTH should be scored or only reported.
- **D3:** whether it is useful as designed.
- **T7 and T8,** if the technical reviewer leaves them open.
