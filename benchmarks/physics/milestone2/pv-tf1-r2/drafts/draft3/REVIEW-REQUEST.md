# PV-TF1-R2 draft 3: request for technical review (then independent review)

## What is to be reviewed

| File | What it is |
|---|---|
| [`PV-TF1-R2.json`](PV-TF1-R2.json) | proposed spec, draft 3 |
| [`DERIVATION.md`](DERIVATION.md) | the derivation: assumptions, inequalities, proofs, limitations. Section 11 classifies every conclusion |
| [`derive.mjs`](derive.mjs) → [`derived.json`](derived.json) | every derived number, from the declared inputs only |
| [`CHANGELOG.md`](CHANGELOG.md) | every changed equation, constant and interpretation since draft 2 |
| [`drafts/draft2/`](drafts/draft2/) | draft 2 as reviewed |

## Status

- Nothing here is hashed, registered or run. No execution is authorised.
- The original PV-TF1 (`../../spec/PV-TF1.json`) and run 1 (`../../results/2026-11-12T15-00-21-588Z/`) are unchanged.
- No module for R2 exists yet.

## Rules

- Any change made in response to review is recorded as a new proposed draft.
- No change may use run-1 numbers.
- The spec is copied to `spec/` and hashed only after approval.

## Decisions draft 3 needs from the technical reviewer

### T1. The closure reference (R3'') — the one change of meaning

DERIVATION.md section 3.2 shows that a physical-volume closure in motion is not testable at the 0.1 % criterion from SWMM's state:
- the envelope class needs a_env ≤ 22.5 µm;
- the monotone class is unverifiable from the record.

Draft 3 therefore scores the **representation volume**, the geometric volume implied by the recorded node depths. The physical volume is reported only, as D5.

Is this acceptable as the reference? If it is not, section 12.1 applies: the closure is not testable in motion, and the proposal says so rather than forcing it.

### T2. The reference link equation (E4)

The uniformity and level allowances come from an exact window identity of E4 evaluated on the recorded flows (sections 4.2–4.3 and 5.1–5.2). That SWMM's EXTRAN link update is E4's backward-Euler form is cited as a fact from the source, not used as an input.

Is E4 acceptable as the declared reference model for the motion allowance? Is the 1.5 mm Qualified tier the right home for SWMM's departures from it?

### T3. The multi-mode question

Draft 3 does not provide a multi-mode leakage bound. Section 6.2 gives the corrected lemma, the correct sum, and why an energy-based bound was not adopted. It removes the dependence instead. Does this meet point 1 of the resolution?

### T4. ε

ε is reclassified as a declared tolerance used only by D2 and the comparability rule:
- the amplitude part is a scaling estimate;
- the time-step part is an unbounded estimate.

Section 6.3 explains why the fundamental bounds the longest period of the reference network but not of SWMM's discrete system. Is that adequate?

### T5. New or changed thresholds (not weakenings; see CHANGELOG)

**(a) G-uniformity:** τ_U ≤ β·HEAD_TOLERANCE = 0.15 mm.

**(b) Book stationarity tiers:**
- Passed ≤ C_fn,k + C_fn,k−1;
- Qualified ≤ 0.018 m³ per window;
- Failed beyond.

**(c) W5 with a book-drift term.**

**(d) The uniformity row extended to the tanks,** and therefore to N = 1.

### T6. Retained items

All of these are carried unchanged:
- NONE/BOTH;
- N = 1 separate;
- comparability;
- M 8, K 3, β 0.1;
- 48 h;
- the criteria;
- hybrid output.

Confirm that none should change in the light of the reformulation.

## Questions carried to the independent reviewers (after technical review)

- **The derivations:** the quadrature lemma (3.4), the envelope bound (3.2a), the window identity (4.2), the uniformity bound (4.3), the level identity (5.1) and the corrected leakage lemma (6.2).
- **The SWMM correspondence:** that dwflow.c lines 192–240 are E4's backward-Euler form at Fr ≤ 0.5.
- **The N = 1 period:** the derivation of 665.86 s from the registered geometry.
- **The a-priori worst cases:** do they correctly bound the run-time formulas?
- **Scoring BOTH:** whether BOTH should be scored or only reported.
- **D3:** whether it is useful as designed.
