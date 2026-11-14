# RT-1: USGS rating reaches (registered 14 Nov 2026, nothing run; see REGISTRATION.md)

**Question.** At a natural gauged river reach, built the way FloodSim builds every site, does the model put the water at the
level USGS measured for the flow USGS measured?

This is a test against measured reality, not against another model or an exact solution of the same equations. It is
the first of the component tests asked for on 14 Nov 2026: each H&H component against measured lab or field data, and
then the historic floods.

## What it tests and what it does not

| Tested | Not tested |
|---|---|
| Channel and floodplain geometry, as FloodSim builds it from 3DEP lidar (hydro-flattened: no bed under the flight-day water) and, in a second configuration, with the estimated bathymetry (`src/bathymetry.js`, opt-in) | Rain, infiltration and runoff: the flow is given at the gauge |
| Roughness from the default land-cover table and channel n | Sewers, inlets, culverts (sites with a controlling structure are excluded or kept apart; see below) |
| The 2D solver at steady flow over real terrain | Unsteady effects: hysteresis, attenuation |

Steady stage against discharge separates the hydraulic part of the historic-flood errors. Charlotte's level-against-flow
curve came out too flat (METHODS 5.12.1), and nothing has yet tested whether that is a Charlotte problem or a FloodSim
one.

## Reference data

All reference data comes from the public USGS Water Data API (`api.waterdata.usgs.gov/ogcapi/v0`):

- **`field-measurements`**: the discharge (00060) and mean gage height (00065) taken at each field visit. Only **direct**
  measurements are used: mid-section current meter, mean-section, ADCP. Indirect, estimated, flume, dilution and
  unspecified methods are excluded. The rating curve itself is *not* the reference: it is USGS's fit through these
  points.
- **`channel-measurements`**: the measured width, area and mean velocity for the same visits. Diagnostics only.
- **`monitoring-locations`**: the gauge datum (`altitude`, `vertical_datum`, `altitude_accuracy`) and position.
- **`peaks`**: annual peaks since water year 1990, giving Q2 (median annual peak), used only to say how high the
  measurements reach.

**Observed water surface** = gage height + datum (ft → m), NAVD88 only.

**Window:** measurements from 2010 on, the lidar era. Older gage heights can sit on an earlier datum, and the channel
moves. A datum change recorded inside the window splits or excludes the site.

### Reference uncertainty, per measurement

| Source | Value |
|---|---|
| Discharge | USGS rating of the measurement: Excellent 2 %, Good 5 %, Fair 8 %, Poor excluded. Turned into level through the local slope of the measured points, dh/dQ |
| Gage height | 0.01 ft |
| Datum | the site's `altitude_accuracy` |
| Position | the gauge is placed at its named bridge, which fixes it better than the USGS accuracy code (±0.01 s to ±1 min on the picks). The model is read along the channel within ±50 m, and the spread is reported (the Charlotte lesson, METHODS 5.12.1 Experiment A) |

U_obs is the root sum of squares of the first three. The position term is reported, not folded in.

## Site selection: rules fixed before any model run

`screen.mjs` lists candidates in eight regions chosen for different physiography:
- NC Piedmont;
- PA Piedmont;
- TX Hill Country;
- CO Front Range plains;
- Iowa agricultural;
- OR Willamette;
- GA Coastal Plain;
- WV/VA Appalachian.

A site is eligible if all of these hold:
1. NAVD88 datum, surveyed altitude;
2. drainage area 5–400 mi²;
3. at least 10 direct, paired measurements since 2010;
4. at least 3 of them at or above Q2/2, and the highest direct one at least Q2/2;
5. no dam, weir or culvert controls the gauge: none within the downstream reach (OSM, NID and the station description);
6. no major tributary joins between the inflow edge and the gauge.

**Bridge-section gauges** (most gauges hang on a bridge) are kept, but scored as a separate class from open reaches.
FloodSim has no bridge model; the bare-earth lidar removes the deck and keeps the opening.

**Choice:**
- at most two sites per region;
- ranked by how high the direct measurements reach (max direct Q / Q2), then by count;
- the ranked list and every exclusion, with its reason, are written to `sites.md` **before** any site is built.
- No site is added or dropped after a result is seen.

## Model setup (production defaults; nothing tuned per site)

- **Domain:** the gauge plus at least 1 km upstream and a downstream length L_dn of at least 5 × (bankfull depth /
  bed slope), and at least 2 km. The downstream edge uses the app's normal outlet. A **boundary row** (below) checks
  the edge does not reach the gauge.
- **Shorter upstream length (decided 14 Nov 2026):** where a weir, culvert or tributary lies less than 1 km above the
  gauge, the inflow edge goes just below it (at least 100 m above the gauge), with the inflow spread across the
  section. An **inflow row** then checks the edge does not reach the gauge: see Scoring.
- **Grid:** 1 m, the default.
- **Terrain:** 3DEP as the app fetches it, with the app's stream conditioning.
- **Roughness:** the default land-cover table.
- **Inflow:** discharge at the upstream edge, through the app's river-inflow path. Steady **levels** of
  Q = 6–8 values spaced on log Q across the measured range, each held until steady:
  - gauge level changes < 1 mm over 10 min;
  - edge outflow within 1 % of inflow.

  Model level at each measured Q is interpolated on log Q between levels. One extra mid-level run checks the
  interpolation (diagnostic).
- **Off:** rain and infiltration. The flow is given at the gauge, and infiltration over a long steady run would remove
  part of it. This is the one departure from the app's defaults, and it is stated.
- **Two configurations, both pre-registered:**
  - **A:** default (hydro-flattened lidar);
  - **B:** A + estimated bathymetry (`src/bathymetry.js`, regional curves for the site's physiographic division).

  B against A is a finding either way. Neither is tuned.

## Scoring (thresholds accepted by the user 14 Nov 2026)

For each measurement i: e_i = WSE_model(Q_i) − WSE_obs,i. Rows per site and configuration:

| Row | What | Passed / Qualified / Failed |
|---|---|---|
| High-flow level | bias and RMSE of e_i for Q_i ≥ Q2/2 | \|bias\| ≤ 0.15 m and RMSE ≤ 0.20 m / ≤ 0.30 m / beyond. Errors inside U_obs count as zero |
| Mid-flow level | the same, for Q_mean ≤ Q_i < Q2/2 | the same thresholds |
| Low-flow level | the same, for Q_i < Q_mean | reported, not scored: under hydro-flattened lidar it measures the flight-day water surface, not the model |
| Rating shape | the slope of the model's log(h − h0) against log Q, compared with the measured points' | reported. It is the direct check of the Charlotte "too flat" curve |
| Boundary | gauge level at the top Q with the downstream edge moved 1 km further | changes < 0.02 m, or the site is **Insufficient** (domain) |
| Inflow (short-upstream sites only) | gauge level at the top Q with the inflow edge moved 100 m further up or down | changes < 0.02 m, or the site is **Insufficient** (domain) |
| Steady | every level reached its steady criterion | otherwise that level is **Insufficient** |

**Basis for 0.15 m:** FEMA *General Hydraulics Considerations*, Guidance Document 52 (Nov 2022), §4.5: calibrated
models "should match known high-water marks reflective of the studied recurrence interval within 0.5 feet" (0.152 m).
That standard is for a model *calibrated* to the marks. RT-1 tunes nothing, so meeting it is a strong result, and
Qualified (to 0.30 m) is the realistic band for an untuned build.

USGS OSW Technical Memorandum 2015.03 (flood-inundation map standards) asks for calibration to every USGS streamgage
in the reach, but sets no number. It is the precedent for using gauge stage at known flow as calibration and
validation data. Both documents were checked 14 Nov 2026.

**Diagnostics (unscored):**
- model width, wetted area and mean velocity at the gauge section at each measured Q, against `channel-measurements`;
- Froude number;
- the model level spread within the ±1 s window;
- the lidar water surface against the low-flow measured stage. This is the size of the missing bed.

**Classification:** every row is a validation row (the model against the world). A failure is not assigned to geometry
or roughness by this test. B against A, and the width and area diagnostics, are what point to one or the other.

## Rules

- Thresholds, sites and configurations are fixed and hashed before the first run, as in the physics suite.
- Results go to an immutable `results/<run-id>/`.
- No roughness or geometry change in response to a result, inside this test. A change found to be needed becomes a new
  configuration, registered and run on all sites.

## Files

| File | |
|---|---|
| `screen.mjs` | candidate screening from the USGS API; cached replies in `.cache/` (git-ignored) |
| `candidates.json` | the screening output |
| `check-sites.mjs` | rules 5 and 6: OSM structures and joins, and NID dams, along the NHD main stem (USGS NLDI) |
| `structures.json` | its output |
| `sites.md` | the chosen sites and every exclusion, before any build |
