# Resolution of review 5 (12 Nov 2026)

One entry per item in `review-5-2026-11-12.md`. Nothing was run, hashed, registered or committed.

## Decisions

| # | Decision | Resolution | Where |
|---|---|---|---|
| 1 | Milestone 1 not formally closed until the resolutions are recorded | **Recorded.** Milestone 1 is formally closed as *accepted with qualifications*; its open findings stay open | `../../../FINDINGS.md`, "Review 5 resolutions" |
| 2 | F1 Explained, not resolved; keep the EXTRAN evidence and the SLOT question | **Done.** The evidence is unchanged; SLOT is listed as open and untested | the same; PV-TF1 `relationToFindings.F1` |
| 3 | F2 rows stay Failed; prepare a versioned error-type revision | **Prepared, not applied** | `../../spec-revisions/PV-U1-definition-revision-1.md` |
| 4 | F3 Explained, with its T2-C failures; keep the Q 0.5 behaviour | **Done.** The Q 0.5 sign change is kept open within F3; PV-TF1 does not claim to explain it | FINDINGS; PV-TF1 `outcomeInterpretation` |
| 5 | F4 Insufficient reference data | **Unchanged** | FINDINGS |
| 6 | F5 a documented coverage gap | **Unchanged** | FINDINGS |
| 7 | Confirm PVM2 and the prefixes | **Confirmed** | `../REGISTRATION.md`, Revisions |

For decision 3, the revision does more than list the four rows. It sets the error type by a stated rule: a paired
`INERTIAL_DAMPING NONE` diagnostic, run for every case, that moves the scored quantity by more than its criterion.
- It is decided by the mechanism, not by which rows failed.
- The rows' status stays Failed.
- Two questions are left to the reviewer: the threshold, and whether this should be a subtype or its own type.

## PV-TF1 changes (draft 2, `../spec-proposed/PV-TF1.json`)

| Item | Request | Change |
|---|---|---|
| a | Account for effective storage at intermediate junctions, including minimum surface area and node volume | `junctionStorage` J1–J3, with R4 and a new scored row (see below) |
| b | Keep each internal junction's depth and volume in the raw output | `rawOutput`: every 60 s, the depth and NODE_VOLUME of every junction; saved unreduced per N |
| c | Rest = stable tank levels plus a declared low-flow condition in every segment | `criteria.restSegmentFlowAbsM3s` 5×10⁻⁶ m³/s, every segment, every step of the window; `restLevelDriftM` made explicit (see below) |
| d | Boundary flux throughout the rest window | Sealing-weir flow at every routing step: the whole-run maximum, the rest-window maximum, and its integral, each scored at 0 |
| e | Transient closure diagnostic only; disappearance before rest proves nothing | `transientStatement`, repeated in `limitations` and in the first row of `outcomeInterpretation` |

How the items are met:
- **Item a.**
  - **J1, node volume.** SWMM defines a junction's volume as identically 0, from the source: `node.c` sets
    `fullVolume` to 0 at read, and `node_initState` takes it as `node_getVolume(fullDepth)`, which is still 0. That is
    reference assumption R4, made explicit and checked by a new scored row (`junctionVolumeAbsM3` 1×10⁻⁹).
  - **J2, minimum surface area** (`dynwave.c` line 670). It binds only at junctions here, because the tanks' 20 m²
    exceeds 1.167 m². It is not a volume, so it can only appear as an at-rest closure error. Its a-priori bound,
    0 / 1.8 / 8.9 / 18.3 m³ at N = 1 / 4 / 16 / 32, shows the test can see it.
  - **J3, link storage through the end nodes.**
- **Item c.** The threshold is the flow that moves 1 mm of one tank in the window's hour. Held for the whole window it
  moves at most 0.018 m³, a tenth of the closure criterion.

**Criteria.** Items a, c and d each correct a genuine specification defect:
- rest by levels alone would accept two tanks at equal levels with a conduit still exchanging between them;
- a 60 s maximum sample can miss a flux between samples;
- junction storage was not accounted.

Each change *adds* a condition, and none removes or widens one. They are recorded as draft 2 in
`proposedCriteriaHistory`, with draft 1 kept. Nothing is hashed: hashing happens only at approval, as
`criteriaRevisions[0]`.

**One more change, not requested but needed for the predictions to be distinguishable.** P2 is split into:
- **P2a:** link storage, present at N = 1 and falling with N;
- **P2b:** junction minimum surface area, absent at N = 1, growing with N, and reduced by the MIN_SURFAREA 0.1
  diagnostic.

Their opposite trends in N are what let one experiment tell them apart. An `outcomeInterpretation` table limits what
each outcome may be taken to show.

## Objections from review 5 still open

None of review 5's items is left unaddressed. The following are left to the independent reviewers:
1. **R4:** a reference that models junctions with zero plan area agrees with SWMM by construction. Reviewers should say
   whether a manhole with a real plan area should be a separate case.
2. **The rest flow threshold** (5×10⁻⁶ m³/s) is derived from the tank area and the window, not from any observed run.
   Reviewers should test whether it is reachable in 12 h. If it is not, the outcome is Insufficient reference data,
   and a longer duration would need a definition revision.
3. **J2 is not directly observable** through the production API. It is attributed only through the N trend and a
   diagnostic. Reviewers should judge whether that is enough to support P2b.
4. **The F2 revision's two open questions.**
