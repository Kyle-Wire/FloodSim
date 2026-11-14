# PVM2 reviews

Three independent reviews of `../REGISTRATION.md` and `../spec-proposed/`.

**What reviewers are asked to challenge:**
- the physical assumptions;
- the independence of each reference;
- the acceptance criteria and their justification;
- whether each test isolates the mechanism it claims to.

A reviewer may reject a test without agreeing to its implementation.

**Files, never edited after they are written:**
- `review-<n>-<date>.md`: each review as received.
- `resolution-<n>.md`: for each objection, the response:
  - accepted, with the revision made;
  - rejected, with the reason;
  - or deferred, to which test.
- Revisions to `../REGISTRATION.md` or to a proposed spec are recorded in that spec's `definitionRevisions`, or in a
  dated "Revisions" section at the end of `REGISTRATION.md`. The earlier text is kept.

**Approval of a test** requires:
1. no unresolved blocking objection;
2. the spec moved to `../../spec/`;
3. `run.mjs --hash` entered as `criteriaRevisions[0]`, with the date and the approving review;
4. then one run, and a review of its result before the next test.

Received:
- `review-5-2026-11-12.md`: the sponsor's second-pass review, which set the changes for draft 2. It is not one of
  the three independent reviews. Its resolution is `resolution-5.md`.

- `review-I1-2026-11-12.md`: technical review I1 (PV-TF1 draft 2): not approved, two blocking objections. Its
  resolution is `resolution-I1.md` (draft 3).

- `approval-2026-11-12.md`: technical review decision: PV-TF1 draft 3 approved, with four documentation
  clarifications (draft 3a). Registered and run once; the next test waits for review of that result.

- `review-run1-2026-11-12.md`: technical review of PV-TF1 run 1: accepted as a valid execution; statuses kept;
  post-run analysis requested. The analysis is `../post-run/pv-tf1-run1/README.md` (findings F10, F11).

- `decision-post-run-2026-11-12.md`: post-run analysis accepted; run 1 unchanged; direction for a new PV-TF1
  registration (cycle-averaged equilibrium, NORMAL_FLOW_LIMITED NONE primary with BOTH paired, N = 1 separate). The
  proposal is `../pv-tf1-r2/`: not hashed, not registered, not run.

- `verdict-r2-provisional-2026-11-12.md`: PV-TF1-R2 approved for independent review only (not registration or
  execution); Q3a, Q3b, Q4b answered; ε audit, W4 and feasibility points; draft 2 of the proposal answers them.

- `resolution-r2-draft2-2026-11-12.md`: draft 2 not approved; draft 3 to be a derivation revision (multi-mode leakage,
  moving-surface volume, period uncertainty); design retained. Draft 3 is `../pv-tf1-r2/` (CHANGELOG.md).

- `review-r2-draft3-2026-11-12.md`: draft 3 to be revised before independent review: D4 residual into the validity
  logic (blocking), Froude check, depth-endpoint guards, absolute-value wording; R3'', C_fn and the design accepted.
  Draft 3a is `../pv-tf1-r2/` (CHANGELOG.md).

The three independent reviews are requested in `REVIEW-REQUEST.md`. They will be filed as
`review-I1-<date>.md`, `review-I2-<date>.md` and `review-I3-<date>.md`, each with its own `resolution-I<n>.md`.
