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

The three independent reviews are requested in `REVIEW-REQUEST.md`; none has been received yet. They will be filed as
`review-I1-<date>.md`, `review-I2-<date>.md` and `review-I3-<date>.md`, each with its own `resolution-I<n>.md`.
