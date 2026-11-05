# Model acceptance: where FloodSim stands against FEMA's criteria

This page maps what FEMA asks of a hydraulic model to the evidence in this repository, says plainly what is missing,
and sets out the path to acceptance through a local agency. It is a working record, rewritten as items close.
Status as of 5 Nov 2026.

## What FEMA asks

**44 CFR 65.6(a)(6).** Any program used for the hydrologic or hydraulic analysis behind a flood map revision must meet
all three criteria:

1. It has been **reviewed and accepted by a governmental agency** responsible for flood control or floodplain
   regulation. An agency that is not federal must certify, through a responsible official, that it has reviewed,
   tested and accepted the program for designing flood control structures or for floodplain land-use regulation.
2. It is **well documented, including source code and user's manuals**.
3. It is **available to FEMA and to every party affected** by maps made with it, now and in future. For a program not
   generally available from a federal agency, the source code and manuals go to FEMA free of charge, with the owner's
   documented permission for FEMA to release them to those parties.

FEMA keeps a list of the models it has found to meet these minimum requirements. Criterion 1 means the route onto it
starts with an agency that has tested the model, not with FEMA.

**FEMA Guidance Document 81** (*Hydraulics: Two-Dimensional Analysis*, Nov 2023) sets what a 2D study must show:
roughness validated by calibration where data allow (§3.4), calibration against observed events (§4, through the
*General Hydraulics Considerations* guidance §4.5), the model's settings and tolerances recorded so a run can be
reproduced, a georeferenced grid, structures documented, and initial conditions and warm-up documented. The usual
accuracy bar for calibration to high-water marks is 0.5 ft (0.15 m), from the superseded 2003 Appendix C. It is used
here as the working target because nothing newer sets a number.

## Criterion by criterion

| Criterion | Evidence in this repository | Status | What is left |
|---|---|---|---|
| (i) Agency review and acceptance | None yet | **Not started** | An agency to review, test and certify it. See the path below |
| (ii) Source code | The full source is here (`app`, `src`, `server`, `tools`); every run records its commit and whether code was changed (`+dirty`, METHODS §8.1) | Met | Nothing, provided the code can be handed over (criterion iii) |
| (ii) Technical reference | `docs/METHODS.md`: equations, numerics, data, outputs, verification and validation, limitations, reproducibility | Met in draft | A review by someone outside the project |
| (ii) User's manual | `docs/USER_GUIDE.md` | Draft | Check it against the app as shipped; add worked examples |
| (iii) Available to FEMA and affected parties | The licence is proprietary (`LICENSE`, SPARC Labs LLC) | **A business decision** | A written release letting FEMA give the code and manuals to affected parties, free, for each version used in a submission. This can sit alongside a commercial licence |

## FEMA Guidance 81 by item

| Item | Evidence | Status |
|---|---|---|
| Verification of the solver | EA 2D benchmarks Tests 1–7: 88 of 94 measures inside the spread of the participating packages, probe series inside seven codes' envelope (METHODS §5.2, `benchmarks/ea`); analytic tests (§5.1); 41 test suites (§5.14) | Strong |
| EA Tests 8A/8B (urban rain, surcharging sewer) | Specification read; data not public (`benchmarks/ea/TEST8.md`, with a request to the EA drafted) | Open, waiting on data |
| Agreement with an accepted model (HEC-RAS 2D) | EA Tests 1, 2, 4, 5 within 0.1–0.8 cm of four HEC-RAS runs; the HEC-RAS Davis storm-sewer example (METHODS §5.3) | Surface agrees; pipe volumes do not yet (−16 % pumped). **Gate C not closed** |
| Mass balance | Combined books within 0.26 % with every exchange model on (METHODS §5.4) | Met |
| Roughness validated by calibration (§3.4) | `tools/calibrate.mjs`: tune on one storm, freeze, score storms it never saw (METHODS §6.4) | Tool built; first study (Charlotte, infiltration) running |
| Calibration and validation against observed events (§4) | Five field cases (METHODS §5.6–5.12, `benchmarks/validation`): RMSE 0.61–0.85 m on marks, −1.10 to −1.39 m at the Charlotte gauge | **Not met**: four to nine times the 0.15 m bar |
| Settings and tolerances recorded for reproducibility | Run records: commit, inputs, forcing fingerprint, design hash, solver settings (METHODS §8) | Met |
| Georeferenced grid | GeoTIFF exports of the ground as run, depths and levels, NAD83/UTM + NAVD88 (METHODS §4.8) | Met |
| Structures documented | Culverts, inlets, pipes, storage and barriers are listed in the run record. **No bridge hydraulics** (METHODS §7) | Partial: bridges are a gap for any river reach that has them |
| Initial conditions and warm-up | Dry start; ungauged water at the lidar surface; optional river baseflow warm-up (METHODS §3.7, §7.5) | Documented |
| Sensitivity and uncertainty | Batch variants (roughness ±20 %, infiltration ×0.5, one cell size coarser) give a band at each mark (METHODS §5.11, §6.3) | Built; bands are narrow (0.16 m), so they do not yet explain the misses |

## What an agency will look for before it signs

A reviewer certifying that the program was "reviewed, tested, and accepted" for floodplain land-use regulation will
want the field accuracy shown, not only the solver. In order:

1. **One case calibrated and validated to the bar.** The Charlotte study tunes on June 2025 and is scored on
   January 2024 and August 2023. Rain is the largest error found so far (METHODS §5.12): the gauge-fitted radar
   (`histSrc = radarFit`) raises the area's peak hour from 48 to 60 mm, still short of the 71 mm at the gauge inside
   the watershed.
2. **Gate C closed**: pipe volumes and node levels against HEC-RAS on Davis, and the coupled surcharge cases
   (benchmark1d2d A12-010 to A12-012, with exact answers) while the EA Test 8 data is awaited.
3. **EA Tests 8A/8B** run and scored, once the EA sends the data.
4. **The user's manual checked** against the release the agency will test, with that release's commit recorded.
5. **The intended-use statement narrowed** to what the agency accepts. METHODS §1.3 lists uses that need a
   calibrated industry-standard model (final structure design among them). The certification will be for floodplain
   land-use regulation in urban drainage areas, which is where the evidence points.

## The local acceptance path

Criterion 1 is met by any governmental agency responsible for flood control or floodplain regulation, including a
city or county. The likeliest first agency is one whose own data and storms are already in the suite, so its staff can
test the model on ground they know:

- **Charlotte-Mecklenburg Storm Water Services.** Runs its own floodplain mapping (it has worked with FEMA as a
  Cooperating Technical Partner; confirm the current status). Its storm-pipe data is the network in the Edwards Branch
  case (§5.12), and USGS gauges and rain gauges cover the watershed. Note that the pipe data is published under
  CC BY-NC-SA 4.0, which does not cover commercial use.
- **Philadelphia Water Department.** Its inlets are in the South Street case (§5.6) and the Schuylkill at Manayunk
  (§5.8) is in its city.
- **NYC DEP.** Publishes the Stormwater Flood Maps the Forest Hills case compares against (§5.9–5.10).

What the agency is asked to do: run the model on its own cases, compare it with its own models and records, and if
satisfied, sign a letter in the words of 65.6(a)(6)(i) for the stated use. What FloodSim provides: the release (commit),
`docs/METHODS.md`, `docs/USER_GUIDE.md`, the validation suite with its cases, the benchmark harnesses, and support while
they test it.

### First note to an agency (draft, not sent)

> Subject: Request to review FloodSim, a 2D urban flood model coupled to SWMM, for floodplain use
>
> FloodSim is a two-dimensional shallow-water model that runs on a GPU and is coupled to EPA SWMM 5 for storm sewers.
> It builds a model from lidar, land cover, soils and your own pipe data, and runs design or historic storms at 1–2 m.
> It reproduces the UK Environment Agency 2D benchmarks (88 of 94 measures inside the spread of the established
> packages) and agrees with HEC-RAS 2D on the surface flooding of HEC's storm-sewer example. Its full technical
> reference, source code and validation record are available for review.
>
> We have built one of our field validation cases on [your watershed], using your storm-pipe data and the USGS gauges
> there. We would value your staff testing the model against your own models and records. If it meets your standard,
> we would ask for a letter that it has been reviewed, tested and accepted for floodplain land-use regulation, as 44 CFR
> 65.6(a)(6)(i) provides. We would also like to know what it would need to show for you to accept it.
>
> We can send the technical reference and validation record, and run a working session with your staff, at your
> convenience.

Send it only once items 1 and 2 above are met, or say plainly in the note that they are not, so the agency is asked
to test the model as it stands.
