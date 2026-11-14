# PV-TF1-R2: technical review resolution of draft 2, and draft 3 instructions (12 Nov 2026)

## Decision

**Accepted:**
- the overall cycle-averaged experiment design;
- the N = 1 reference;
- the NONE/BOTH configuration split;
- the segmentation interpretation;
- the 48 h fixed duration.

**Draft 2 is not approved** for registration or execution.

**Draft 3 is to be a derivation revision only.** It must not:
- run SWMM;
- hash or register anything;
- modify production code;
- change the original PV-TF1 registration;
- alter run 1.

## Instructions

**1. Multi-mode leakage.**
- The leakage lemma is valid for a non-increasing envelope, not for arbitrary monotone amplitude. Correct the statement and the proof.
- The individual-mode bounds do not establish draft 2's multi-mode bound. The sum of modal leakages is bounded by λ times the sum of the modal amplitudes, not by λ times the maximum instantaneous bracket.
- Do not claim W4 proves the missing bound. W4 is a diagnostic with known blind spots.
- Develop a conservative multi-mode bound from declared, independently justified modal-amplitude limits. Otherwise, reformulate the scored interpretation bound so that it does not depend on W4.
- Keep W4 as a diagnostic if useful, and state what it can and cannot detect.

**2. Moving-surface volume interpretation.**
- R3' is not established by W1.
- Investigate a conservative volume bound that permits internal extrema within a declared physical amplitude envelope.
- Re-derive C2 from the maximum possible deviation between the internal profile and the linear interpolation, without assuming that deviation equals a_max.
- Otherwise, make monotonicity an explicit reference-validity condition and explain how it can be verified independently.
- Do not imply that PV-C1's acceptance establishes validity for free oscillation.

**3. Period uncertainty.**
- Either derive a conservative nonlinear period correction, or reclassify ε as a tolerance and revise the leakage argument.
- Investigate the time-discretisation term using EXTRAN's actual integration, or classify it as an unbounded estimate.
- Explain why the fundamental's uncertainty bounds the longest period of the complete discrete modal system, distinguishing the reference network from SWMM's system.
- W3 checks the T1 − T2 fundamental only and must not be described as validation of every mode.

**4. Retain the design** unless the derivation shows a necessary change:
- NONE primary; BOTH paired, scored separately;
- N = 1 separate; N = 4, 16 and 32 with the comparability restrictions;
- M = 8 and K = 3, subject to the revised budget;
- the 48 h maximum;
- the closure and level criteria;
- the hybrid raw output;
- PV-TF1 and run 1 unchanged.

Do not weaken criteria to obtain a resolvable result.

**5. Deliverables:**
- the revised JSON;
- the complete derivation;
- the updated script and generated JSON;
- a change log;
- a table of which conclusions are mathematically bounded, empirically diagnosed or assumed.

Return the package for technical review before independent review.

## Where draft 3 answers each point

| Point | Where |
|---|---|
| 1 | `../pv-tf1-r2/DERIVATION.md` sections 3.5, 4.2 and 6.2 |
| 2 | sections 3.2–3.4 |
| 3 | section 6 |
| 4 | sections 1 and 8, and `CHANGELOG.md` |
| 5 | `PV-TF1-R2.json`, `DERIVATION.md`, `derive.mjs`/`derived.json`, `CHANGELOG.md`, and `DERIVATION.md` section 11 |
