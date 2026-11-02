# Governing standards: what FloodSim asserts, and who gets to reject it

FloodSim's H&H report module emits most of the shape of a drainage submittal. It also makes several dozen
engineering decisions on the user's behalf — a freeboard, an allowable spread, a runoff coefficient, a design
storm shape — each defensible on its own and each of which a specific reviewer in a specific jurisdiction may
accept, question or reject. These documents write that surface down so a licensed reviewer can check it.

| Document | What it is |
| --- | --- |
| [`design-criteria-matrix.md`](design-criteria-matrix.md) | The durable artefact. Every embedded default: its value, where it is set in the code, each jurisdiction's value with a citation, and a verdict. |
| [`submittal-gap-analysis.md`](submittal-gap-analysis.md) | Section by section through `report.html`: what the standard requires, what FloodSim produces, whether it would be accepted. Scoped to the two target workflows. |
| [`remediation-priority.md`](remediation-priority.md) | Ranked by how likely each item is to get a submittal rejected, not by how hard it is to fix. |

## What these documents are not

**Nothing here is sealed, certified or PE-reviewed, and no FloodSim output ever is.** A seal is a personal legal
attestation by a licensed individual. Both target jurisdictions require one on the work FloodSim feeds:

> "All plans, reports, and calculations must be signed and sealed by a Professional Engineer licensed in the
> Commonwealth of Pennsylvania."
> — PWD SMGM v3.4, Appendix E, Table E-7 (PCSMP Report requirements)

These documents are written to be *checkable by* that engineer: every criterion carries the manual and section
it comes from, so a reviewer can disagree with a reading without having to re-derive it. Where we could not
verify something from a published source, it says so.

## The two standards, and why these two

### 1. Philadelphia Water Department Stormwater Management Guidance Manual (SMGM)

- **Edition cited:** v3.4 (current as of 1 November 2026), published alongside the updated Philadelphia
  Stormwater Regulations.
- **Where:** <https://water.phila.gov/development/stormwater-plan-review/manual/>
- **Companion city codes cited where they govern instead of PWD:** Philadelphia Code Title 4 (Building
  Construction and Occupancy Code), Subcode B §B-1612.2.1 (flood loads / freeboard), and Title 14 §14-704(5)
  (flood plain controls, waterfront setback).

**The case.** This is where the first submittals land. The programme already has live PWD data connections —
the drainage module consumes PWD's published inlet, outfall and combined-sewer-service layers, and the
validation record's most-worked site is South Street with 127 real PWD inlets (see README, "Drainage" and the
South Street verification note). Choosing a jurisdiction whose GIS we already ingest means the gap analysis is
testable against runs that exist today rather than hypothetical ones. PWD is also unusually demanding in a way
that is *useful* to be measured against: it prescribes the rainfall table, the temporal distribution, the loss
method, the model time step and a per-district rate-control mapping, so the comparison produces hard verdicts
instead of judgement calls.

### 2. PennDOT Drainage Manual (Publication 584) with Design Manual Part 2 (Publication 13M)

- **Editions cited:** Pub 584, 2015 Edition, Change #1 (June 2022) — current. Pub 13M (DM-2), 2015 Edition,
  current through Change #14 (December 2025); Chapter 10 pages quoted here are dated Change #9 and were
  distributed in the Change #12 package (December 2024), Chapter 13 pages are dated Change #8.
- **Where:** Pub 584 and Pub 13M title pages at
  `https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/public/pubsforms/publications/pub-584/pub 584 title page.pdf`
  and `.../pub-13m/pub 13m title page.pdf` — each title page hyperlinks the current compiled PDF. Note that the
  numeric design criteria mostly live in **Pub 13M Chapter 10**, not in Pub 584; Pub 584 §13.6.D defers to it
  explicitly. Both must be read together.

**The case.** PennDOT is the right second standard for three reasons beyond regional fit. First, it is the
*other* reviewer on the same Philadelphia sites: any site touching a state route needs a Highway Occupancy
Permit, and the drainage criteria then come from PennDOT, not PWD. Second, PWD's own rainfall table is derived
from it — SMGM Table 3.4-3 states its depths "are taken from the *PennDOT Drainage Manual*, Chapter 7, Appendix
A", so getting PennDOT's rainfall provenance right is a precondition for getting Philadelphia's right. Third,
PennDOT is the only one of the two that publishes explicit **pavement-drainage** criteria (spread, depth at
curb, inlet spacing); PWD reviews inlet *drainage areas*, not spread. Since FloodSim ships a gutter-spread
check as a headline report section, the only standard that can judge it is the DOT one.

**Considered and not chosen.** NJDOT's Roadway Design Manual covers the four New Jersey counties of the DVRPC
region and is more conveniently published, and PA DEP's *Stormwater Best Management Practices Manual* is the
state-level backstop for municipalities without an Act 167 plan. Both were rejected as the primary pair: NJDOT
because no current data connection points there, and PA DEP because PWD supersedes it inside the city and
PennDOT's PCSM chapter already carries the Chapter 102 obligations that DEP's manual elaborates. PA DEP's
Chapter 102 regulations appear in this analysis where PennDOT incorporates them by reference (25 Pa. Code
§102.8), which is the form a reviewer would actually apply them in.

## Scope

In scope: the two target workflows — **off-site adverse-impact screening** and **stormwater detention
compliance** — and the report-module sections and embedded defaults that serve them.

Out of scope, deliberately: NOAA Atlas 15 and Bulletin 17C (separate ticket); any claim about FEMA
accepted-model status; any contact with an agency, reviewer or engineer outside SPARC Labs. Every citation here
comes from a published manual read directly.

## Re-verifying this work

Every criterion in the matrix is traceable two ways: a `file:line` into this repository, and a manual section
number. To re-verify a jurisdiction value, open the manual at the cited section — the PWD manual is published
as HTML per section, and the PennDOT manuals as single compiled PDFs reachable from their title pages. Both
jurisdictions revise on a schedule (PWD with each Regulations update, PennDOT by numbered change package), so
**the matrix carries an edition stamp and should be re-checked whenever either publishes**. A criterion whose
citation no longer resolves should be treated as unverified, not as still true.
