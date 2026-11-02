# Submittal gap analysis: `report.html` against PWD and PennDOT

Would an engineer sign this? Section by section, this is the answer and the reason.

**Standards:** Philadelphia Water Department *Stormwater Management Guidance Manual* **v3.4**; PennDOT
*Drainage Manual* **Pub 584, 2015 Ed. Change #1 (June 2022)** with *Design Manual Part 2* **Pub 13M, 2015 Ed.**
(Chapter 10 pages Change #9, Chapter 13 pages Change #8). Companion Philadelphia codes cited where they govern
instead of PWD. Compiled 1 November 2026.

**Verdicts** are **Accept** / **Question** / **Reject** as defined in
[`design-criteria-matrix.md`](design-criteria-matrix.md).

---

## Part A — The submittal package, before any section

A reviewer does not start with a hydrograph. They start with a checklist of documents, and FloodSim's
`report.html` is one artefact inside one of them. Mapping that first prevents the rest of this analysis from
being read as more than it is.

### A.1 Philadelphia: the PCSMP Report (SMGM Appendix E, Table E-7)

| Required item | FloodSim | Verdict |
| --- | --- | --- |
| Cover, signed and sealed by a PA-licensed PE | Not produced, and must never be simulated | **n/a** — belongs to the engineer of record |
| Introduction / project description; applicable PWD Regulations; applicable State and Federal permits; existing site and drainage conditions summary | Not produced. `report.html` has a run header (labels, storm, forcing fingerprint, app commit, units, datum) and a methods note per section | **Reject** — narrative absent |
| Project soils: soil survey map, Hydrologic Soil Group discussion | SSURGO is ingested (`src/soil.js`) and drives Green-Ampt per cell, but no soils map or HSG table is emitted in the report | **Reject** — data present, artefact absent |
| Stormwater management design methodology: rainfall depths, runoff estimation, flow routing methods | Partly. Each section carries a methods note; the header records the storm and a forcing fingerprint. Rainfall depths are not tabulated and the routing method is described only in prose | **Question** |
| Stormwater analysis summary and discussion | Not produced | **Reject** |
| Proposed design: SMP summaries, infiltration summary, disconnected impervious cover summaries | Pond stage-storage-discharge tables are produced. No SMP summary table, no DCIA accounting, no disconnection credit | **Reject** |
| Appendices: analysis calculations incl. **static storage**, **time of concentration**, hydrologic modelling | Static storage: **yes** (stage-storage from the graded ground). Tc: computed internally for pipe sizing (`src/drainage.js:208–214`) but **never reported**. Hydrologic model files: the run's `summary.json`, `network.json`, `hgl.json` are saved | **Question** |
| Appendices: **pipe capacity calculations** | Pipe table gives D, max flow, max depth/D, max velocity — results, not the computation sheet | **Question** |
| Drainage Area Plan: predevelopment and post-development drainage areas, **location of POA(s)**, existing stormwater infrastructure | Drainage areas are delineated internally by nearest-inlet BFS (`src/drainage.js:319`) and never drawn or reported. Control lines stand in for POAs with no POA concept or justification | **Reject** |
| Inlet Drainage Area Plan: inlet drainage area delineations with roof leaders, calculated areas and **Tc to each inlet**, impervious and pervious cover data | All four quantities exist in memory (`area`, `CA`, `tc` per node; roof routing in `src/design.js:396`). None reaches the report | **Reject** — this is the single largest "data exists, artefact missing" gap |
| PWD Online Technical Worksheet printout | Not produced; external to FloodSim | **n/a** |
| Geotechnical Report, sealed, with boring logs, infiltration test logs, sieve analysis | Not produced. FloodSim's HSG-derived infiltration rates (`src/terrain.js:20`) are a screening surrogate and cannot substitute | **Reject** for any infiltration SMP |
| Media filter / low-flow device design documentation | Not produced | **n/a** — product documentation |
| SMP Maintenance Guide; Construction Certification Package; proof of permits | Not produced | **n/a** |

**Reading.** FloodSim produces strong *analysis* output and almost no *submittal* output. Of the 14 PCSMP
Report items, it contributes materially to three and fully satisfies none. That is not a criticism of the
report module — it is the correct scope statement to put in front of a client, in place of any suggestion that
`report.html` is a submittal.

### A.2 PennDOT: the Roadway Drainage Report and the PCSM Plan

The Roadway Drainage Report (Pub 584 §4.1.D) must contain:

| Required item | FloodSim | Verdict |
| --- | --- | --- |
| "Complete drainage area map(s)" | Not produced (see above) | **Reject** |
| "Design frequencies" | Recorded in the run header as a storm label; not stated per facility class | **Question** |
| "Information concerning outfalls, existing storm drains and other design considerations" | Outfall hydrographs and the network's outfall nodes are reported; existing-system information is ingested where PWD/utility GIS exists | **Question** |
| "Computations for drainage areas, inlets and storm drains, **including hydraulic grade lines**" | HGL profile and manhole table: **yes, and better than the standard asks for** — a modelled max HGL from a coupled SWMM run rather than a hand-stepped EGL. Drainage-area and inlet computations: absent | **Question** |
| "Standard computation sheet given in Chapter 13 … and Pub 13M Figure 10.3.8" | Not produced in that format | **Reject** |

The PCSM Plan (Pub 584 Ch. 14; obligations in Pub 13M §13.7) is covered in Part C.

**A note on the HGL.** PennDOT's Pub 584 §13.12 procedure is a manual upstream march from the tailwater,
documented on Table 13.5, assuming full flow. FloodSim's HGL is the maximum node head from a dynamic SWMM 5.2
run exchanged with the 2D surface every 2 s. This is a *more* capable calculation than the standard
contemplates, and that is itself a reviewability problem: a reviewer cannot reproduce it on the form. The fix
is not to downgrade the computation but to emit the comparison — the standard's computation sheet alongside the
dynamic result — so the reviewer can check one against the other.

---

## Part B — Workflow 1: off-site adverse-impact screening

### B.1 What the standards actually require

This workflow has the clearest governing text of anything in this analysis, and it is PennDOT's:

> "The Department must evaluate the effect construction and post-construction stormwater discharges may have on
> accelerated erosion to down slope or adjacent properties, **regardless of whether there are increases in the
> volume or peak rate** of stormwater discharges from a project site. Documentation must be provided that
> demonstrates that the discharge will not cause accelerated erosion on the properties along the flow path to a
> surface water."
> — Pub 13M (DM-2) §13.7.N

with three specific deliverables:

1. identify all properties and property owners that will or may receive off-site discharges, until discharges
   reach surface waters;
2. identify the flow path from discharge point to confluence with a surface water, **and its soil types,
   erodibility factors and vegetative cover**;
3. a narrative analysis demonstrating that the proposed volume and peak rate will avoid, minimize or mitigate
   accelerated erosion "for storm events up to and including the **10-year/24-hour** storm".

Pub 13M §13.7.C.6 adds that "the channel pathway below the DP to the nearest stable outflow should be evaluated
for accelerated erosion during a 10-year, 24-hour storm event", and that a significantly higher proposed peak
to an ephemeral stream may warrant evaluating "potential effects of spillover into properties adjacent to the
channel downstream".

And a hard gate that matters for Philadelphia specifically:

> "If stormwater discharges will enter a municipal separate storm sewer system (MS4) or a combined sewer system
> with combined sewer overflows (CSOs), and there will be an increase in runoff volume or peak rate, the
> Department must provide **written consent from the MS4 or CSO permittee** before a Chapter 102 permit can be
> issued."
> — Pub 13M §13.7.N

On the Philadelphia side, PWD's equivalent is narrower and routed through the release-rate requirements: the
Public Health and Safety Release Rate (SMGM §1.2.1) exists precisely because combined-sewer areas with
constrained networks cannot absorb additional flow, and PWD assigns the maximum release rate from its own pipe
capacity analysis for the 1-yr through 10-yr storms. SMGM §4.7.3 adds that an emergency spillway "must not
direct flow toward neighboring properties."

### B.2 What FloodSim produces, and the verdict

| Requirement | FloodSim | Verdict |
| --- | --- | --- |
| Peak and volume change at each off-site receptor | `src/compare.js` produces the paired-run Δ: Δ-depth banded, newly wet / dry cells, and an explicit off-site impact measure; control-line hydrographs give peak, time-to-peak and volume before/after | **Accept** — and this is FloodSim's strongest claim against any requirement in this document. A 2D Δ-depth map answers "which neighbouring property gets wetter" directly, where a lumped method can only answer it by inference |
| Flow path from discharge point to surface water | Not emitted. The solver knows the routing; the report has no flow-path artefact | **Reject** |
| Soil types and **erodibility factors** along the flow path | SSURGO K-factor is already ingested (`H.kffact` → `kf`, `src/soil.js:45`, `:78`) and critical shear is derived per cell (`tauC`, `src/design.js:410`); `src/scour.js` computes peak bed shear against what the ground resists, and the map has a "Scour" view | **Question** — every input the standard names is present; none of it is in the report, and none of it is organised along a flow path |
| Vegetative cover along the flow path | NLCD class and pervious share per cell | **Question** — present, not reported |
| Accelerated-erosion analysis at the **10-yr/24-hr** storm | Possible but not the default: the storm picker defaults to 100-yr, 1-hour alternating block (`app/map.html:434–435`) and the shape is wrong for both standards | **Reject** as configured |
| Receiving-property and owner identification | Out of scope for a model; parcel data is not ingested | **n/a** — but the report should say so, since a reader may assume the Δ-depth map covers it |
| Written MS4/CSO permittee consent where volume or rate increases | External. But FloodSim *can* determine whether the trigger is met, and for Philadelphia it already ingests PWD's combined-sewer service area | **Question** — the trigger test is computable and not computed |
| Downstream channel stability below the discharge point | `src/banks.js` (bank collapse probability), `src/scour.js`, `src/sediment.js` exist | **Question** — physics present, no criterion applied, no report section |

### B.3 The honest summary of workflow 1

FloodSim is *better equipped* for off-site adverse-impact screening than for anything else in this analysis,
and would be **rejected on it anyway** — not because the physics is inadequate but because the artefacts
§13.7.N names (flow path, K-factor along it, cover along it, a 10-yr/24-hr narrative) are not produced, and
because the default storm is wrong. Every one of those is a reporting change over existing data, except the
storm shape. This is the cheapest high-value gap in the programme.

---

## Part C — Workflow 2: stormwater detention compliance

### C.1 Philadelphia: the four requirements

| Requirement | Criterion (SMGM §1.2.1) | FloodSim | Verdict |
| --- | --- | --- | --- |
| **Water Quality** | Infiltrate the first 1.5 in of runoff from all DCIA. Where infiltration is infeasible in combined-sewer areas: route 100% of WQv through an acceptable pollutant-reducing practice, detain ≤72 h, release ≤0.05 cfs/acre | No DCIA accounting, no WQv, no 72-h drawdown, no pollutant-reducing practice representation, no per-acre release rate | **Reject** — the requirement is not addressed at all |
| **Channel Protection** | Detain the **1-yr, 24-hr NRCS Type II** event for all DCIA and release at ≤0.24 cfs/acre in ≤72 h | Not a distinct criterion; 1-yr is not in the default sweep; the storm shape is wrong; drawdown is not computed | **Reject** |
| **Flood Control** | Meet or reduce peak rates per the site's Flood Management District, Table 3.4-1 | `detentionTable()` tests `post ≤ pre` **at the same return period** (`src/stormwater.js:216–218`). Table 3.4-1 pairs *different* storms: District A pairs 2-yr proposed against **1-yr** predevelopment; District B offsets every storm by one step (5→2, 10→5, 25→10, 50→25, 100→50) | **Reject** — see C.2 |
| **PHS Release Rate** | PWD-assigned maximum release rates in cfs/acre for the 1-yr through 10-yr storms where the combined network is constrained | No mechanism to enter an assigned release rate; no per-acre normalisation | **Reject** |

### C.2 The detention check is the wrong test, and it fails unsafe

This is the most consequential finding in the document, so it is worth stating precisely.

`src/stormwater.js:216–218` implements:

```js
pass: Number.isFinite(r.pre) && Number.isFinite(r.post) ? r.post <= r.pre + tol : null
```

— post-development peak at return period *T* compared against pre-development peak at the **same** *T*. This
is the generic textbook detention test and it is what most municipal ordinances ask for. It is not what either
target jurisdiction asks for.

- **PWD District A** requires the 2-yr proposed peak to be held to the **1-yr** predevelopment peak. Since the
  1-yr predevelopment peak is smaller than the 2-yr predevelopment peak, FloodSim's check passes designs that
  PWD rejects. The 5-, 10-, 25-, 50- and 100-yr rows happen to be matched pairs, so District A fails only at
  the 2-yr row.
- **PWD District B** offsets *every* row. A design that FloodSim marks "post ≤ pre" at all six storms can fail
  all six of District B's rows. The error is in the non-conservative direction at every storm.
- **PennDOT** does use a matched-pair test — "post-construction peak rates should be controlled to
  pre-construction peak rates for the 2-, 10-, 50- and 100-year, 24-hour storm events" (Pub 13M §13.7.C.2) —
  so the *test* is right, but the default storm set (`2, 10, 25, 100`, `app/map.html:283`) substitutes 25 for 50
  and the duration and distribution are wrong.

A check that reports **"post ≤ pre"** in a green cell, against a jurisdiction whose rule is not post ≤ pre, is
worse than no check: it invites a designer to stop iterating. The remedy is a per-jurisdiction storm-pairing
table rather than a hard-coded comparison, and until that exists the detention check should not be presented as
a compliance determination for either jurisdiction.

### C.3 PennDOT: the PCSM criteria

| Requirement | Criterion | FloodSim | Verdict |
| --- | --- | --- | --- |
| Runoff volume | "The net difference in runoff volume from pre- to post-construction conditions for the **2-year, 24-hour** storm event should be managed for each point of interest" (§13.7.C.1) | Volume is computed and reported per control line and in the whole-model water balance — but no volume *criterion* is applied, and the governing storm is not run by default | **Reject** on the criterion, **Accept** on the quantity |
| Peak rate | Post ≤ pre for the 2-, 10-, 50- and 100-yr 24-hr events absent an Act 167 plan (§13.7.C.2) | Right test, wrong storm set and shape | **Reject** as configured, `param` to fix |
| Water quality | No net increase in TSS, TP and TN up to the 2-yr/24-hr storm; calculations must be demonstrated in PA DEP's PCSM Spreadsheet (§13.7.C.3) | No water-quality module | **Reject** — genuine capability gap, and one the programme should decline rather than build |
| Thermal impact | Qualitative description of how thermal impacts were avoided, minimised or mitigated (§13.7.C.3) | None | **n/a** — narrative, not model output |
| Predevelopment cover assumption | For volume and water quality on new construction: 20% of disturbed impervious as meadow in good condition, all non-forested disturbed pervious as meadow in good condition (25 Pa. Code §102.8(g)(2) via §13.7.C.4). **"Actual existing cover conditions should always be used for peak rate calculations."** | FloodSim's existing-conditions run uses actual mapped cover | **Accept** for peak rate — this is worth stating explicitly, because the intuitive assumption that FloodSim's baseline is non-regulatory is **wrong for the rate criterion** and right only for the volume criterion |
| Act 167 release rates | Where an approved and current Act 167 Stormwater Management Plan exists, its release rates govern instead (§13.7.D; Pub 584 §14.9.B) | No mechanism for watershed-specific release rates | **Reject** where an Act 167 plan applies |
| Points of analysis | POA at the receiving surface water; single POA sufficient for watersheds ≥1.0 mi²; otherwise the "10% rule" (§13.7.C.6) | User-drawn control lines, no POA concept | **Question** |

### C.4 The method stack is rejected before any number is checked

Both jurisdictions prescribe the computational path for the rate and volume criteria, and FloodSim takes a
different one at every step:

| Step | Required | FloodSim |
| --- | --- | --- |
| Rainfall depths | PWD: Table 3.4-3, mandatory. PennDOT: Pub 584 Appendix 7A regional IDF charts from Atlas 14 **Version 3** | Live Atlas 14 point query to the NOAA PFDS service |
| Temporal distribution | NRCS Type II, 24-hour (PWD §3.4.3 Table 3.4-5; Pub 584 §7.7.B) | Alternating block on 5-min blocks, 1-hour default. The README already notes this is "peakier than any single observed storm" |
| Loss method | PWD: NRCS Curve Number, separate pervious and impervious, no weighted CN. PennDOT: TR-55/TR-20 toolbox | Green-Ampt from SSURGO |
| Minimum Tc | PWD: 6 min. PennDOT: 5 min | No floor; inlet time 10 min |
| Routing | PWD: ≤0.01 h time step, models from §3.4.3's list | 2D shallow-water + SWMM 5.2 at 2 s exchange — well inside the time-step limit, and SWMM is on PWD's acceptable list |

Two of those are negotiable. PWD states that the Curve Number Method is "its preferred runoff estimation
method" and that "additional methods may be used at the designer's discretion with approval from PWD", and its
Table 3.4-8 acknowledges Green-Ampt within EPA SWMM and HEC-HMS. PennDOT requires written justification for an
off-toolbox method (Pub 584 §7.3.G). So **Green-Ampt is a pre-approval conversation, not a rejection** — which
makes it a much smaller problem than the design storm.

The rainfall depths and the temporal distribution are **not** negotiable. PWD says designers "must use the
values provided in Table 3.4-3". A detention compliance submittal computed on a 1-hour alternating-block storm
from live PFDS values is rejected on sight in both jurisdictions, whatever the physics underneath.

---

## Part D — Section-by-section through `report.html`

In the order `app/report-ui.js` emits them.

### D.1 Summary — whole-model water balance

Rain, infiltration, runoff off the model edge, flow to the pipe outfalls, stored at the end; before/after and
change.

Neither standard asks for a water balance, and neither prohibits one. It is good engineering practice and good
evidence of model closure — a reviewer who sees a balanced book trusts the rest more. **Accept**, with one
caution: "Runoff off the model edge" is a *model* quantity, not a site quantity. A reviewer may read it as
off-site discharge, which it is not; it is whatever left the rectangular domain, including flow that never
touched the site. That needs saying in the note.

**Verdict: PWD Accept · PennDOT Accept.** Labelling fix only.

### D.2 Hydrographs — control lines and storm sewer outfalls

Peak, time-to-peak and volume per location, before dashed and after solid; control-line flux booked every
solver step and sampled every 10 s; outfall inflow every 10 s; volume by the trapezoid rule.

This is exactly the right content. The gaps are contextual, not computational:

- The locations are user-drawn control lines, not POAs justified against §13.7.C.6 or located per Table E-7.
- There is no drainage area attached to each location, so the per-acre release rates PWD works in cannot be
  formed.
- Time-to-peak is reported, which is more than either standard requires and genuinely useful for the
  adverse-impact question (a design that holds the peak but shifts it can still cause downstream harm).

**Verdict: PWD Question · PennDOT Question.** Fix class `label` + `param` (attach contributing area).

### D.3 Detention ponds — stage-storage-discharge

Stage-storage from the graded ground, stage-discharge from the outlet rating with a free outfall, the
orifice / riser-weir / spillway split, stage in time against riser crest, spillway and top of bank, outflow in
time, and — for one-run reports — inflow back-computed as outflow + ΔS.

Strengths worth defending to a reviewer: the stage-storage comes from the *actual designed ground surface* cell
by cell, not a truncated-pyramid approximation, which is more defensible than what most submittals contain and
directly satisfies Table E-7's "static storage" requirement. The orifice/weir/spillway decomposition is what
Appendix F.18 (Outlet Controls) asks to see. The Villemonte submergence treatment and the continuous
orifice-to-weir transition (`src/stormwater.js:29–34`) are better than the discontinuous hand method.

Gaps:

- **Freeboard is measured and reported, but not against the governing storm or the governing datum.** PWD
  §4.7.3 std. 3 wants 1 ft between the **100-yr/24-hr** peak storage elevation and the spillway **invert**.
  FloodSim reports peak stage to spillway **crest** over whatever storm was run.
- **The second PWD freeboard test does not exist**: ≥1 ft between spillway crest and top of berm (std. 4). And
  the *default* outlet puts the spillway crest 6 in below the bank top (`src/design.js:379`) — exactly half the
  required distance. A user who accepts the defaults produces a non-compliant basin and the report does not say
  so.
- **No dewatering time.** Both jurisdictions require it (PWD ≤72 h; Pub 584 §14.9.A "Time to dewater"), and the
  pond series only runs as long as the storm simulation.
- **No basin geometry checks** (2:1 length-to-width, 10 ft minimum width, safety benches above 4 ft depth), and
  the default pond depth of 1.5 m exceeds the 4 ft bench trigger.

**Verdict: PWD Reject · PennDOT Question.** The freeboard defaults and tests are `param`; dewatering time is a
`gap`, though `modifiedPuls()` in `src/stormwater.js:79` already provides the offline routing mechanism for a
72-hour drawdown without running the 2D solver for three days.

### D.4 Detention check over the design storms

Covered in full in Part C.2. Short form: right idea, wrong test for PWD, right test and wrong storm set for
PennDOT, and it displays a pass.

**Verdict: PWD Reject · PennDOT Reject.**

### D.5 FEMA flood zones

Model area by zone; each new building's zone, BFE and floor against a required freeboard.

The methods note is unusually careful and should be preserved verbatim as a model for the rest of the report:
it states that zone AE BFE is interpolated between the FIRM's BFE lines and cross-sections by inverse distance,
that A zones publish none, and that the user must "check the effective FIRM and any LOMR before relying on it."

The defect is the number, not the method. The required freeboard defaults to **0.3 m (1 ft)**
(`app/map.js:1654`, `src/design.js:79`), and Philadelphia requires **1.5 ft**:

> "Elevation of all development to the 1-1/2 feet or higher, 'Freeboard' established per Philadelphia Code
> Title 4 Subcode B Section B-1612.2.1 and ASCE 24-14."
> — City of Philadelphia, *Guide for Development in the Floodplain* (Rev. 11/2023), listing the City's
> "above code" requirements

with the zoning provision putting the lowest floor "at least 18" above BFE" and noting that the Building Code
and ASCE 24 may require more, the most restrictive governing. So a building the report marks `ok` can be 6
inches short of the City minimum. This is the clearest single-number rejection in the whole document and the
easiest to fix.

**Verdict: Philadelphia Reject · PennDOT n/a.** Fix class `preset`.

### D.6 Storm sewer hydraulic grade line

Profile from a manhole to its outfall with rim, crown, invert and max HGL before/after; manhole table with rim,
max HGL, freeboard, flooded volume; pipe table with max flow, max depth/D and max velocity.

This is the strongest section in the report. Against PennDOT's actual acceptance criterion — "If the HGL
exceeds an inlet elevation, then adjustments to the trial design must be made" (Pub 584 §13.12.G) — the
`✕ floods` flag is a direct, correct implementation, computed more rigorously than the standard's own method.

Gaps, in order of how likely each is to draw a comment:

1. **No minimum-velocity check.** Pub 584 §13.11.F requires ≥0.9 m/s (3 ft/s) at design flow for
   self-cleansing. Max velocity is reported; minimum is not, and it is the one that fails.
2. **The 1 ft manhole freeboard is our invention.** Neither manual publishes a manhole-freeboard criterion.
   It is a sensible target and it is presented in the same visual language as the criteria that *are* governing
   (`! low freeboard` next to `✕ floods`), which overstates it. It should read as a user-set target.
3. **Surcharge is reported as a note.** PennDOT expects gravity design "generally" and treats pressure flow as
   "a special design" for extreme flat grades (Pub 13M §10.3.B.2). A surcharged pipe is a design exception
   requiring justification, not an informational badge.
4. **The synthetic network's own geometry would be rejected** where it is used as the design rather than as
   ingested existing infrastructure: 12 in minimum pipe (18 in required), no 825 mm size, no 2 in junction
   drop, no sag-point inlet treatment. See matrix §5.
5. **No computation sheet** in the Pub 584 Table 13.5 / Pub 13M Figure 10.3.8 format.

**Verdict: PWD Accept · PennDOT Question** for the reporting; **PennDOT Reject** for the synthetic network's
geometry defaults.

### D.7 Water surface profiles

Ground before/after, max WSE and max depth every 1 m along a drawn profile line; FEMA BFE overlaid; finished
floors of buildings within 5 m marked, existing ones estimated as highest adjacent grade + 6 in; station table
every ~25 ft.

Neither standard prescribes this section — it is a floodplain artefact rather than a drainage one — and it is
the most persuasive thing in the report for the adverse-impact question, because it puts the before and after
water surface, the BFE and the finished floors on one axis.

Two cautions, both labelling:

- Existing finished floors are **estimated** (highest adjacent grade + 6 in). The chart labels them `est.`,
  which is right, but a reviewer comparing an estimated FFE against a modelled WSE is being shown a
  difference of two uncertain numbers as if it were a clearance. Philadelphia requires surveyed lowest-floor
  elevations on the site plan, prepared by a registered design professional or PA professional land surveyor.
- The 1-ft floodway rise test that Philadelphia applies ("will not increase the design flood elevation more
  than 1 foot") is computable from exactly these two profiles and is not computed.

**Verdict: PWD n/a · PennDOT n/a** as a required section; **Question** on the estimated-FFE presentation.

### D.8 Gutter spread

Per inlet: spread walked from the grate across the street to where max depth falls below 3 mm, capped at the
far curb; gutter depth at the grate; intercepted peak and volume; checked against an allowable spread,
defaulting to 8 ft.

This section asserts a criterion neither target jurisdiction states in the form given.

- **PWD publishes no spread criterion.** Philadelphia street geometry and inlet spacing are the Streets
  Department's; what *PWD* reviews is the Inlet Drainage Area Plan — delineations, areas, Tc to each inlet, and
  impervious/pervious cover (Table E-7). FloodSim has every one of those numbers and reports none of them,
  while reporting the one thing PWD does not ask for.
- **PennDOT's criterion is geometric, paired and storm-specific**: "The maximum encroachment of water on the
  roadway pavement shall not exceed half of a through traffic lane during a 10-year storm of 5 min duration.
  The maximum depth at the curb shall be 25 mm (1 in) below the top of the curb" (Pub 13M §10.3.A.2). Three
  mismatches follow:
  1. The allowable is a **fraction of lane width** (plus any shoulder or parking lane), not a flat 8 ft. Eight
     feet is a reasonable stand-in for a parking lane plus half a lane and is wrong by a wide margin for a
     curbed section with no parking.
  2. The **depth-at-curb criterion is not evaluated at all**, though `gutterDepth` is already computed and
     displayed. This is a mandatory criterion sitting one comparison away from being satisfied.
  3. The **storm is wrong**: the criterion is 10-yr / 5-min; the run defaults to 100-yr / 1-hour. At a 100-yr
     storm most streets are full curb to curb — the README records exactly this on the Meyerland project at
     25-yr — so the check reports failures that are not failures of the design.
- The **measurement** is also not the standard's. Pub 584 §13.7 spread comes from the gutter-flow relations at
  the design discharge (Figures 13.1(a)/(b), 13.3). FloodSim's is a wetted-edge walk on a 2D depth grid with a
  3 mm threshold. The repo's own test records spread of 2.75 m against the analytic `T = d/Sx = 3 m` on a
  crowned street at 1 m cells — an ~8% underestimate at the best-case geometry, and cell-size dependent. A
  reviewer recomputing by nomograph will not reproduce it.

Shoulder, median and swale sections have their own criteria (no shoulder encroachment; ≤½ median width;
≤⅔ shoulder width — Pub 13M §10.3.A.1, 3, 4) and are not distinguished at all.

**Verdict: PWD n/a (and reporting the wrong artefact) · PennDOT Reject.**

---

## Part E — What this means for the claim FloodSim can make today

FloodSim's report module is, on this evidence, a **strong analysis instrument and not a submittal generator**.
It computes several things better than the governing standards' own prescribed methods — the HGL from a dynamic
coupled run, stage-storage from the designed ground surface, and a 2D before/after Δ for off-site impact that
no lumped method can produce. It also fails both jurisdictions on the inputs (rainfall table, temporal
distribution), on the compliance tests themselves (storm pairing, release rates, volume, drawdown), and on the
artefacts (drainage area plans, inlet tables, computation sheets, narrative).

The defensible claim is:

> FloodSim produces engineering analysis that a licensed engineer can use to design and check a stormwater
> system, and figures and tables that can be incorporated into a submittal the engineer prepares and seals. It
> does not produce a compliance determination, and the defaults it ships are not the design criteria of any
> particular jurisdiction.

Anything stronger than that is not supportable against either manual as read here.

---

## Limits of this analysis

- **Not audited:** the per-practice SMP design standards in SMGM Chapter 4 and Pub 584 Chapter 14 against
  FloodSim's GI defaults (matrix §8). Those rows are marked **Question**, meaning unverified.
- **Not audited:** PennDOT Pub 15M (DM-4, Structures) for bridge and deck drainage, which Pub 584 §13.6 and
  §10.3.A refer to for spread on structures.
- **Chapter 10 provenance:** Pub 13M Chapter 10 quotations were read from the compiled chapter distributed in
  the December 2024 Change #12 package, with individual pages dated Change #9. Change packages 1–8, 10, 11 and
  13 were not individually diffed for Chapter 10. The reviewer should confirm against the current compiled
  chapter.
- **No agency contact was made**, consistent with the ticket's scope. Where a standard's application depends on
  a reviewer's discretion — PWD's approval of a non-CN loss method, PWD's assigned PHS release rate, whether an
  Act 167 plan governs a given watershed — this document says so rather than guessing the answer.
- **Nothing here is a legal or professional opinion**, and nothing here is sealed. It is prepared for a
  licensed professional engineer to check, disagree with and act on.
