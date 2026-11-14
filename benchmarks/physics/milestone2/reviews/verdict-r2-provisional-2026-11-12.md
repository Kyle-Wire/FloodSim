# PV-TF1-R2: provisional verdict of the technical reviewer (12 Nov 2026)

This verdict was given on the design summary, before the reviewer had the files.

**Verdict:** approved for independent review. **Not** approved for registration or execution. The 20-run matrix is not authorised.

## Points raised, and where draft 2 answers them

1. **W4 is a diagnostic, not a proof.** It shows insensitivity to the shifts tested. It is not a general upper bound unless the shifts, the statistic and the threshold are designed for the relevant phase relationships.
   - Draft 2 states this explicitly in DERIVATION.md sections 3.5 and 10.
   - Reviewer acceptance remains a condition (Q1a).
2. **48 h is a feasibility question, not a settled design choice.** N = 1's 0.56 mm requirement is demanding. A design that predictably ends as Insufficient across the matrix would be an expensive way to learn something already suspected.
   - Draft 2 adds Q4c on how feasibility is to be settled before the matrix is authorised.
3. **The ε budget must be auditable:** each component, and the combination rule.
   - Draft 2 adds the formula and source line for each component in DERIVATION.md section 4.
   - The combination rule is a worst-case linear sum.
   - It also states which component is a scaling estimate rather than a computed bound, and which assumptions the leakage bound depends on.

## Answers to the review questions

**Q3a.** Yes. The rigid-column reference is the pipe's water as one inertial column coupled to the two lumped storage surfaces. It is not the full-pipe U-tube.
- 665.9 s is the appropriate kind of reference, provided the derivation uses the registered geometry, cross-section and tank areas.
- Independent reviewers are to verify the derivation, not accept the label.

**Q3b.** Accept that N = 1 may end as Insufficient reference data. Do not relax its amplitude requirement. The report must distinguish three outcomes:
- insufficient because the physical oscillation did not decay enough;
- insufficient because the period or averaging assumptions failed;
- failed because a genuine storage or conservation criterion was violated.

Draft 2 adds these as reporting sub-classes.

**Q4b.** Use a hybrid archive:
- Every-step checks run for the full 48 h.
- Full-resolution raw series are kept for the scored windows, together with:
  - the complete configuration, the input files and the hashes;
  - all-step guard and validity summaries;
  - the raw interval around any guard trip.
- The full record is archived externally with checksums, if practical.
- Auditability of the scored windows is not to be sacrificed for repository size.

## Additional direction

Keep the two limiter arms completely separate in the findings register.
- NONE answers the storage question without the limiter.
- BOTH answers whether production's limiter changes the result.
- A difference within the combined uncertainty means "no detectable difference under this experiment", not "no effect".
