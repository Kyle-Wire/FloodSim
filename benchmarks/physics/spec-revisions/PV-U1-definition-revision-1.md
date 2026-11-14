# PV-U1 definition revision 1: error type of the PARTIAL inertial-damping discrepancy (PREPARED, NOT APPLIED)

**Status:** prepared on 12 Nov 2026 at review 5's request (decision 3). It is not applied:
- `spec/PV-U1.json`, `channels/pv-u1.mjs` and the registered run `results/2026-11-11T18-57-58-574Z/` are unchanged;
- the criteria, and the criteria hash `6ce9c781…`, are unchanged;
- the four rows stay **Failed**.

**Applying it means:**
1. add the `definitionRevisions` entry below to `spec/PV-U1.json`;
2. add the classification rule to `channels/pv-u1.mjs`;
3. run again under a new run id.

The registered run keeps its original labels. This revision annotates it; it does not overwrite it.

## The defect in the definition

`channels/pv-u1.mjs` labels every depth and velocity row `numerical`, meaning the solver against an exact solution of
the same equations. That label assumes SWMM solves the equations the references solve:
- Manning in the uniform reach;
- the full energy equation (GVF) for the drawdown that decides which junctions are scored.

Under the registered routing option `INERTIAL_DAMPING PARTIAL`, SWMM multiplies its inertial terms by
σ = 1 for Fr ≤ 0.5, 2(1 − Fr) for 0.5 < Fr < 1, and 0 for Fr ≥ 1 (`dwflow.c` lines 192–194). The terms affected are
`dq3` and `dq4` (lines 222–225).

In uniform flow those terms vanish, so σ does not matter there. Where the flow varies, SWMM solves a different
equation. A free outfall always raises Fr toward 1, so it always does vary near the outfall.

The evidence is in `../FINDINGS.md` F2 (`diagnostics/u1-options.mjs`):
- with σ forced to 1 (`NONE`), the four failures fall to ≤ 1.00 mm, inside the criterion;
- refining the segments leaves a residual that is not zero.

So the four discrepancies come from a difference in the equation solved, not from a numerical error in solving the same
equation.

## The revision

**Taxonomy.** The three error types are unchanged. An optional `errorSubtype` field is added:

| errorType | errorSubtype (new, optional) | Meaning |
|---|---|---|
| physical-model | **routing-equation approximation** | the solver's routing option replaces or scales terms of the governing equation that the reference keeps (here: PARTIAL inertial damping) |

**Classification rule.** It must be stated before any re-run and applied to every case, not only to the four that
failed. A depth or velocity row is `physical-model / routing-equation approximation` when both:
1. the case's registered routing option is not `NONE`; and
2. a declared paired diagnostic of the same case with `INERTIAL_DAMPING NONE` changes the scored quantity by more than
   its criterion.

Otherwise the row stays `numerical`.

The paired diagnostic becomes part of the definition: it runs with every case and is never scored itself.

**Why this rule rather than listing four rows.**
- It is decided by a declared mechanism test, not by which rows failed.
- A row that passes can also be reclassified, if the damping moves it by more than the criterion, and a failing row whose
  failure the damping does not explain stays `numerical`.
- Expected effect from the closure-pass evidence: the four failing rows become `physical-model` Failed. The other cases
  are not yet known; their paired diagnostics have not been run (rule 2), and this revision runs nothing.

**What does not change:**
- the criteria and their hash;
- the scored-junction rule;
- the registered routing option (PARTIAL, as production uses);
- the statuses: a physical-model row outside its criterion is still **Failed**.

The revision makes the label say why. It does not move the row to a pass.

## The `definitionRevisions` entry to add when applied

```json
{ "date": "<date applied>", "revision": 1,
  "why": "Error type of rows affected by INERTIAL_DAMPING PARTIAL: physical-model / routing-equation approximation when a paired INERTIAL_DAMPING NONE diagnostic of the same case moves the scored quantity by more than its criterion (FINDINGS.md F2; review 5 decision 3). Criteria unchanged (hash 6ce9c781…). Registered run 2026-11-11T18-57-58-574Z keeps its labels." }
```

## Open questions for the reviewer

- **Should rule 2 use the criterion as its threshold, or a fraction of it?** With the criterion, a damping effect just
  under the criterion leaves a row labelled `numerical`.
- **Should "routing-equation approximation" be its own error type**, outside physical-model? It is the model's
  equations, not missing physics. Review 5 asked for it under the current taxonomy, so it is a subtype here.
