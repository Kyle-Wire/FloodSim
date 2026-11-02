# What to fix first

Ranked by **how likely each item is to get a submittal rejected**, not by effort and not by how interesting the
engineering is. Effort is noted so the sequencing conversation can happen, but it did not set the order.

Severity:

- **R1 — rejects the submittal.** A reviewer in at least one target jurisdiction cannot approve the work with
  this in place, and in several cases the current behaviour reports a *pass* where the jurisdiction's rule
  fails. These are the dangerous ones.
- **R2 — draws a comment and a resubmission.** Defensible but not the jurisdiction's stated criterion; costs a
  review cycle.
- **R3 — would be accepted, but overstates what FloodSim knows.** Labelling and honesty fixes. Cheap, and they
  protect the programme's credibility more than they protect any one submittal.

Fix class: `param` · `preset` · `gap` · `label` as defined in
[`design-criteria-matrix.md`](design-criteria-matrix.md).

---

## R1 — Rejects the submittal

### 1. The detention check implements a test neither jurisdiction uses, and fails unsafe

`src/stormwater.js:216–218` compares post-development peak against pre-development peak at the **same** return
period. PWD Table 3.4-1 pairs *different* storms by Flood Management District — District A pairs 2-yr proposed
against 1-yr predevelopment; District B offsets every storm by one step. A design FloodSim marks "post ≤ pre"
at all six storms can fail all six of District B's rows, in the non-conservative direction every time.

**Why first:** it is the only item on this list where FloodSim actively displays a green pass against a rule it
is not testing. Everything else is an omission; this is an incorrect affirmative statement.

**Fix:** replace the hard-coded comparison with a per-jurisdiction storm-pairing table — a list of
`(proposedARI, predevelopmentARI)` pairs — and require one to be selected. Until it exists, the section should
not be presented as a compliance determination. `param` + `preset`. Small change, high value.

### 2. The design storm is the wrong shape and the depths come from the wrong source

Both jurisdictions mandate the **NRCS Type II 24-hour** distribution for every rate and volume criterion (SMGM
§3.4.3 Table 3.4-5; Pub 584 §7.7.B; Pub 13M §13.7.C), and both mandate a *fixed table* of depths — PWD Table
3.4-3 ("must use the values provided"), PennDOT Pub 584 Appendix 7A regional IDF charts from Atlas 14
Version 3. FloodSim defaults to a 1-hour alternating-block storm from a live NOAA PFDS point query
(`src/storm.js:9`, `:71`; `app/map.html:435`, `:438`).

**Why second:** this is rejected on sight, before a reviewer looks at a single result. The README already
concedes the alternating-block storm is "peakier than any single observed storm" and points at the NRCS curves
as the alternative for long durations.

**Fix:** an NRCS Type II 24-hour distribution and a jurisdiction rainfall table as a selectable forcing.
`gap` for the distribution (the hyetograph machinery exists; the distribution does not), `preset` for the
depths. This is the largest single piece of work on the list and it unblocks items 1, 5, 6 and 8.

### 3. BFE freeboard default is 1 ft; Philadelphia requires 1.5 ft

`src/design.js:79` and `app/map.js:1654` default to 0.3 m. Philadelphia's "above code" requirement elevates all
development to **1-1/2 feet or higher** above BFE per Title 4 Subcode B §B-1612.2.1 and ASCE 24-14, with Zoning
§14-704(5) putting the lowest floor at least 18 in above BFE and the most restrictive of Zoning and Building
Code governing.

**Why third:** a one-line default produces buildings the report marks `ok` that are six inches below the City
minimum, on the single criterion most likely to be checked by someone other than the drainage reviewer.

**Fix:** `preset`. Smallest change on the list.

### 4. Allowable gutter spread is not the governing criterion, and the depth-at-curb criterion is not evaluated

Pub 13M §10.3.A.2: "The maximum encroachment of water on the roadway pavement shall not exceed half of a
through traffic lane during a 10-year storm of 5 min duration. The maximum depth at the curb shall be 25 mm
(1 in) below the top of the curb." FloodSim checks a flat 8 ft allowable (`app/map.html:295`) at whatever storm
was run (default 100-yr/1-hour), and never checks depth at the curb though `gutterDepth` is already computed
and displayed (`src/report.js:143`).

**Fix:** geometry-derived allowable (lane width fraction + shoulder/parking lane), a depth-at-curb comparison
against a curb-height input, and a spread evaluation pinned to the 10-yr/5-min storm. `param` for the
allowable and the curb check; the storm follows from item 2. Separate treatment for shoulder, median and swale
sections is a further `gap` (Pub 13M §10.3.A.1, 3, 4).

### 5. The required minimum Tc is neither enforced nor reportable

PWD: "Total post-development Tc for any path must be no less than six minutes" (§3.4.3). PennDOT: "the designer
should use a minimum time of concentration of 5 minutes" (Pub 584 §7.5.D). FloodSim applies no floor; it uses a
10-min inlet time plus pipe travel at 1.0 m/s (`src/drainage.js:28–29`, `:214`).

The *value* is fine: a 10-min inlet time clears both floors, so the shipped default does not violate either
criterion. The rejection is that **Tc is never reported**, so the floor cannot be verified — and PWD requires
"time of concentration" calculations in the PCSMP appendices and Tc to each inlet on the Inlet Drainage Area
Plan (Table E-7). A mandatory criterion a reviewer cannot check is a mandatory criterion the submittal has not
demonstrated. The latent half becomes live the moment a user shortens the inlet time or a real path is shorter
than the default.

**Fix:** `param` — enforce the floor, and report Tc per path. Overlaps item 10 and should be done with it.

### 6. Volume control and drawdown time are not computed at all

PWD requires Water Quality (1.5 in from DCIA, ≤72 h, ≤0.05 cfs/ac) and Channel Protection (1-yr/24-hr,
≤0.24 cfs/ac, ≤72 h) — §1.2.1. PennDOT requires the net pre-to-post volume difference for the 2-yr/24-hr storm
to be managed at each point of interest (§13.7.C.1), and lists "Time to dewater" as a storage design criterion
(Pub 584 §14.9.A). FloodSim computes volumes but applies no volume criterion, and never computes drawdown.

**Fix:** `gap`, but a cheaper one than it looks: `modifiedPuls()` at `src/stormwater.js:79` already provides
offline reservoir routing, so a 72-hour drawdown can be demonstrated without running the 2D solver for three
days. DCIA accounting and per-acre release rates are `param` work on top.

### 7. Minimum pipe size of 12 in, and no junction invert drop

`src/drainage.js:17` starts the size ladder at 0.30 m. Pub 584 §13.11.E and Pub 13M §10.3.B.2: "The minimum
diameter of storm pipe shall be 450 mm (18 in) … except pipes under a 7.6 m (25 ft) or greater fill height
shall not be less than 600 mm (24 in)", in 75 mm increments to 900 mm then 150 mm — so 825 mm is missing from
the ladder and two sub-minimum sizes are on it. Separately, `src/drainage.js:221–222` sets the outgoing invert
to the lowest incoming invert, where §10.3.B.2 requires "A minimum drop of 50 mm (2 in) … between the lowest
inlet pipe invert elevation and the outlet pipe invert elevation".

**Fix:** `param` for both — a size ladder and a junction drop per jurisdiction preset. Affects any project
where FloodSim's synthetic network is presented as the design rather than as ingested existing infrastructure.

### 8. Pervious runoff coefficient is fixed at 0.20 regardless of soil

`src/drainage.js:336` uses `C = 0.95·imp + 0.20·(1 − imp)`. Pub 13M Table 10.2.1 / Pub 584 Table 7.7 put **clay
soil, bare or light growth at 0.35–0.75**. On HSG C and D soils FloodSim's 0.20 is below the governing minimum,
undersizing pipes in the non-conservative direction — and FloodSim already reads HSG from SSURGO for
Green-Ampt, so the information to do this correctly is in hand. The frequency adjustment factor Cf (1.1 at
25 yr, 1.2 at 50, 1.25 at 100 — Table 7.8) is also not applied, and the 25-yr option is offered in the sizing
UI (`app/map.html:496`).

**Fix:** `param` — a C lookup by cover and HSG, plus Cf by return period.

### 9. Minimum velocity (self-cleansing) is never checked

Pub 584 §13.11.F: "velocities of flow will not be less than 0.9 m/s (3 ft/s) at design flow." The pipe table
reports *maximum* velocity (`app/report-ui.js:170`); the criterion is on the minimum.

**Fix:** `gap`, but small — the quantity is already booked per pipe.

---

## R2 — Draws a comment and a resubmission

### 10. The artefacts PWD actually reviews are not produced, though the data exists

Table E-7 requires a Drainage Area Plan (pre- and post-development areas, POA locations, existing
infrastructure) and an **Inlet Drainage Area Plan** (delineations with roof leaders, calculated areas and **Tc
to each inlet**, impervious and pervious cover). FloodSim computes every one of those: `area`, `CA` and `tc`
per node (`src/drainage.js:208–214`), catchment delineation by nearest-inlet BFS (`:319`), roof routing
(`src/design.js:396`). None reaches the report.

**Why this ranks here and not in R1:** it is an omission a reviewer asks for rather than a wrong number, so it
costs a cycle rather than a rejection. **Fix:** `gap` in reporting only — no new physics, no new capability.
Best effort-to-value ratio on the whole list.

### 11. Off-site adverse-impact screening is missing the artefacts §13.7.N names

Pub 13M §13.7.N requires the flow path from discharge point to surface water with its **soil types, erodibility
factors and vegetative cover**, and a narrative demonstrating no accelerated erosion "for storm events up to
and including the 10-year/24-hour storm". FloodSim already ingests SSURGO K-factor (`src/soil.js:45`, `:78`),
derives critical shear per cell (`src/design.js:410`) and computes peak bed shear against it (`src/scour.js`).
None of it is organised along a flow path or reported.

**Fix:** `gap` in reporting over existing data, plus the 10-yr/24-hr storm from item 2. Also computable and not
computed: whether the MS4/CSO consent trigger is met (any increase in volume or peak rate into a combined
system) — FloodSim already ingests PWD's combined-sewer service area.

### 12. The emergency spillway default is half the required distance below the top of berm

`src/design.js:379` sets the spillway crest 0.152 m (6 in) below the bank top. SMGM §4.7.3 std. 4: "The minimum
allowable distance between the emergency spillway crest elevation and the top-of-berm elevation is one foot."
And the freeboard that *is* reported is measured to the crest over whatever storm ran, where std. 3 wants 1 ft
from the **100-yr/24-hr** peak storage elevation to the spillway **invert**.

**Fix:** `param` for the default and both tests.

### 13. Basin geometry checks do not exist

Min length-to-width 2:1, min width 10 ft, safety benches above 4 ft depth (SMGM §4.7.3 std. 5, 6, 10); PennDOT
caps vegetated embankments at 4.5 m (15 ft) and requires geotechnical stability analysis above 3 m or for
slopes steeper than the tabulated maxima (Pub 584 §14.9.D.1). FloodSim's default pond depth of 1.5 m already
exceeds the bench trigger. **Fix:** `gap`, geometric checks on drawn pond outlines.

### 14. Infiltration rates are HSG surrogates, not measured

`src/terrain.js:20` uses A 10 / B 5 / C 2.5 / D 1 mm/hr. Both jurisdictions require measured rates from a
sealed geotechnical report with boring logs, infiltration test logs and sieve analysis (SMGM Table E-7; Pub 13M
§13.7.J). **Fix:** `param` — accept measured rates as an input and label the HSG default as screening-only.
The capability to *measure* is not FloodSim's to build.

### 15. No Act 167 release-rate mechanism

Where an approved and current Act 167 Stormwater Management Plan exists, its release rates govern instead of
the generic criteria (Pub 13M §13.7.D; Pub 584 §14.9.B). There is no way to enter one. Same mechanism as PWD's
assigned PHS Release Rate. **Fix:** `param` — an assigned-release-rate input, shared with item 1's pairing
table.

### 16. Sag points are not treated as a distinct case

Pub 584 §13.11.C requires an inlet at the low point of a sag vertical curve with flanking inlets within 30 m
(100 ft) or 0.20 ft of grade, and allows a higher design frequency there than on grade (§13.6.A: 10-yr on
grade, 50-yr at a sag). The synthetic network places inlets at a uniform 60 m spacing with no sag logic.
**Fix:** `gap`.

### 17. No POA concept

PWD requires POA locations on the Drainage Area Plan; PennDOT defines POAs at the receiving surface water with
a single POA sufficient for watersheds ≥1.0 mi² and a "10% rule" below that (§13.7.C.6). FloodSim's user-drawn
control lines are a reasonable mechanism with no criterion attached and no place to record the justification.
**Fix:** `label` + `param`.

### 18. Return-period sweep set is wrong for both jurisdictions

`app/map.html:283` defaults to `2, 10, 25, 100`. PennDOT wants 2, 10, **50**, 100 (§13.7.C.2); PWD wants
1 through 100 depending on district, and 1–10 for the PHS Release Rate. **Fix:** `preset`, trivially, once
item 1 exists.

---

## R3 — Would be accepted, but overstates what FloodSim knows

### 19. The 1 ft manhole freeboard is presented as a criterion

Neither manual publishes a manhole-freeboard criterion; PennDOT's acceptance test is HGL below the inlet
elevation (Pub 584 §13.12.G), which FloodSim already implements correctly as `✕ floods`. The `! low freeboard`
flag (`src/report.js:76`, `:90`) is a sensible internal target rendered in the same visual language as a
governing criterion. **Fix:** `label` — call it a user-set target, and name the governing criterion separately.

### 20. Surcharge is reported as a note, not a design exception

Pub 13M §10.3.B.2 expects gravity design "generally" and treats pressure flow as "a special design" for extreme
flat grades. **Fix:** `label`.

### 21. Climate uplift, confidence bounds and ARI interpolation have no standing in either standard

`src/storm.js:48–54`, `:71` offer log–log ARI interpolation, 90% confidence bounds and a depth multiplier. All
three are good engineering tools and none is recognised by either jurisdiction for a compliance computation.
**Fix:** `label` — flag any run using them as non-compliance, and say so in the report header.

### 22. "Runoff off the model edge" reads as off-site discharge

It is a domain-boundary quantity that includes flow which never touched the site. **Fix:** `label` in the water
balance note.

### 23. Estimated existing finished floors sit next to modelled water surfaces

The profile section marks estimated existing FFEs (highest adjacent grade + 6 in) as `est.`, correctly, but a
reviewer reads the gap to the WSE as a clearance. Philadelphia requires surveyed lowest-floor elevations from a
registered design professional or PA professional land surveyor. **Fix:** `label`.

### 24. The reveal citation covers the foundation wall, not the floor

`src/design.js:44` cites IRC R404.1.6 for a 0.15 m reveal. R404.1.6 is correct as read — foundation walls
extend above finished grade "a minimum of 4 inches (102 mm) where masonry veneer is used and a minimum of 6
inches (152 mm) elsewhere" — and 0.15 m is the conservative value. But it governs the wall, and FloodSim uses
it to set the *floor*, applying the same reveal to crawlspace and basement foundations where the relationship
differs. **Fix:** `label`, plus confirmation of the section number against the IRC edition Philadelphia has
adopted in Title 4 Subcode R.

### 25. There is no methods statement a reviewer can accept or reject as a whole

Each report section carries a note, which is more than most tools do. What is missing is the single statement
Table E-7 asks for — "design methodology including rainfall depths, runoff estimation, and flow routing
methods" — and a plain statement of which jurisdiction's criteria the run was configured against, or that it
was configured against none. **Fix:** `label`. This is the item that makes every other `label` fix legible in
one place.

---

## Sequencing note

Three items unblock most of the rest. **Item 2** (NRCS Type II 24-hour distribution + jurisdiction rainfall
tables) is a precondition for items 1, 4, 6, 11 and 18 being *correct* rather than merely *configurable*.
**Item 1** (storm-pairing table) is the mechanism that items 15 and 18 plug into. **Item 10** (report the
drainage-area and inlet data that already exists) is the cheapest substantial gain in the programme and
requires nothing from the other two.

Items 3 and 7 are one-line default changes and should not wait for a sequencing decision.

**None of this constitutes approval to implement.** This document produces the implementation tickets; it does
not open them, and no fix here should be built without the licensed reviewer agreeing the reading of the
standard it rests on.
