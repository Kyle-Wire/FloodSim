# PV-TF1-R2: request for independent review

**What is to be reviewed**

| File | What it is |
|---|---|
| [`PV-TF1-R2.json`](PV-TF1-R2.json) | proposed spec, draft 2 (answers the provisional verdict, `../reviews/verdict-r2-provisional-2026-11-12.md`) |
| [`DERIVATION.md`](DERIVATION.md) | derivation of the cycle-averaged reference, tolerances, matrix, interpretations, run-1 applicability |
| [`derive.mjs`](derive.mjs) → [`derived.json`](derived.json) | every derived number, from the declared inputs only |

**Status.**
- Nothing here is hashed, registered or run.
- The original PV-TF1 (`../../spec/PV-TF1.json`) and run 1 (`../../results/2026-11-12T15-00-21-588Z/`) are unchanged.
- No module for R2 exists yet.

**Rules for the review**
- Any change to a criterion, a design constant or a hypothesis made in response to the review is recorded as a new proposed draft.
- No such change may use run-1 numbers.
- The spec is copied to `spec/` and hashed only after approval.

## Questions

### Q1. The reference itself

**(a) The leakage bound.** Section 3.4's lemma bounds the leakage of each mode. Section 3.5 leaves the multi-mode sum to an empirical check, W4 (the shifted-window spread). Draft 2 states W4's limits in DERIVATION.md section 3.5: a blind spot for modes whose period divides T_ref/8, and cancellation in a beat. Is W4 adequate as designed, or should its shifts, statistic or threshold be redesigned for the relevant phase relationships? If W4 is not accepted, the reference cannot be justified independently in this form, and DERIVATION.md section 10 gives the two alternatives.

**(b) The monotone-surface assumption in motion.** R3' is PV-C1's bracket assumption. Is it acceptable for a moving surface, given the amplitudes allowed by W1 (≤ 3.99 mm over segments of 12.5–400 m)?

**(c) The expansion.** Is the conservative split E_V = (1 + λ)·B_mean + λ·max B + C2 correct?

### Q2. Design constants

**(a) β = 0.1.** Should the share the residual motion may use be 0.1, the principle of PV-TF1 draft 2, or something else?

**(b) M = 8.** M = 8 is the smallest power of two for which N ≥ 16 is not leakage-limited. Is that a sound basis, or should M follow from a different principle?

**(c) K = 3.**

**(d) ε = 1.5 %.** DERIVATION.md section 4 traces each component to its formula and its `derive.mjs` line, and states the combination rule: a worst-case linear sum. Two components are scaling estimates, not bounds: the amplitude term (1 %, which dominates) and the time-step term. Is that acceptable, or must the amplitude term be derived?

### Q3. N = 1

**(a) The reference period.** *Answered provisionally: yes, this is the intended rigid-column reference. Reviewers are to verify the derivation (registered geometry, cross-section, tank areas), not the label.* Is the two-node lumped period of 665.86 s the intended "rigid-column" reference? The classical full-pipe U-tube value of 143.2 s does not apply to a part-full conduit.

**(b) Feasibility.** *Answered provisionally: accept a possible Insufficient outcome at N = 1. Do not relax the amplitude requirement. Report the IR-motion, IR-basis and Failed classes separately (now in the spec).* N = 1's book allowance is 0.56 mm of node amplitude. That follows from the geometry and β, and is not tuned. Should a likely Insufficient outcome at N = 1 be accepted as is, or should the design change? For example, N = 1's books could become reported-only, with only its level scored. Any change must not use run-1 numbers.

### Q4. Duration and output

**(a) Duration.** 48 h is 4× run 1 and is not chosen by extrapolation. Is that acceptable as a declared design parameter, with Insufficient as the accepted consequence if the bounds are not met?

**(b) Raw output.** *Answered provisionally: the hybrid strategy, now in the spec (`rawOutput`) and in DERIVATION.md section 7.* The raw output is about 1.9 GB. The options were:
- git LFS;
- external archive with SHA256SUMS committed;
- every step only over the last 3 windows?

**(c) How feasibility is settled.** New in draft 2. The 20-run matrix is not authorised. Before it is, how should feasibility at 48 h be established without using run-1 numbers to tune anything? Options:
- an a-priori decay estimate from Manning friction alone, with its limits stated;
- a single unscored pilot case, declared now, whose result can only shorten or cancel the matrix and never change a criterion;
- accepting the risk as it stands.

### Q5. NONE / BOTH

**(a) Scoring BOTH.** BOTH is scored with the same criteria but tallied separately and never pooled. Should BOTH be scored at all, or be reported only?

**(b) Reporting the limiter effect.** Is Δ_N with uncertainty E_V,BOTH + E_V,NONE an adequate reporting rule, stated as "no detectable difference" when within it?

### Q6. Segmentation comparability

Is "lumped modes 1–3 within 2ε of the continuum" an acceptable test? It makes:
- N = 16 and 32 comparable;
- N = 4 comparable in the fundamental only;
- N = 1 a different system.

Is it acceptable to use N = 4 for the end state but not to attribute fill-time differences?

### Q7. The uniformity tiers

**(a) HEAD_TOLERANCE.** Is SWMM's 1.5 mm HEAD_TOLERANCE an appropriate boundary between Qualified and Failed (a persistent imbalance)?

**(b) Set-down.** Is v²/(2g) the right allowance for the mean set-down?

### Q8. The stationarity allowance

DERIVATION.md section 6 keeps the lenient sum E_V,k + E_V,k−1. Should it be the tighter leakage-and-curvature-only form?

### Q9. Dropped diagnostic

INERTIAL_DAMPING NONE is dropped from the matrix. Do you agree?
