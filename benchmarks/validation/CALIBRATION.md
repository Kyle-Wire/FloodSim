# Calibration studies

Written by `node tools/calibrate.mjs` (records in `calibration.json`). Each study tunes the model on one observed storm,
keeps the values with the smallest RMS level error (high-water marks and gauge peaks, model − observed, m), or with
the best flow at a gauge over the whole storm (Kling–Gupta efficiency, KGE: 1 is perfect), then runs
other storms the tuning never saw, as set and with the values frozen. The target is the usual bar for a mapping model:
levels within 0.5 ft (0.15 m). A model is calibrated when the storms it never saw meet the target with the values
kept, not when the tuning storm does. See docs/METHODS.md §6.4.

## Edwards Branch, Charlotte NC — 10 August 2023, summer storm — 2026-11-09

Commit 2524f63. Every run: histSrc = radarFit, wetness = auto. Target 0.15 m. Sixth study: a shallow limit on soil storage (the water-table depth input, every cell), tuned on the short dry storm, frozen, checked on the two large ones; January on the rain with the storm-wide bias; infiltration x1, wetness from the rain before the storm

| Values | Run | Level errors | RMS (m) | Bias (m) | Flow KGE | Flow NSE | Volume (model / gauge) | Peak flow (model / gauge) |
|---|---|---|---|---|---|---|---|---|
| soil limit depth m 0.05 | 2026-11-09_083715_Calibration-Existing-condition | 1 | 0.01 | −0.01 | 0.49 | 0.72 | 1.45 | 1.35 |
| soil limit depth m 0.1 **(kept)** | 2026-11-09_084940_Calibration-Existing-condition | 1 | 0.33 | −0.33 | 0.71 | 0.61 | 1.05 | 0.83 |
| soil limit depth m 0.2 | 2026-11-09_090147_Calibration-Existing-condition | 1 | 0.63 | −0.63 | 0.39 | 0.54 | 0.66 | 0.51 |

Kept (best flow KGE at the gauge): **soil limit depth m 0.1**, calibration storm 0.33 m RMS (2.2× the target), flow KGE 0.71.

| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n) | Flow KGE as set | calibrated | Against the target |
|---|---|---|---|---|---|
| Edwards Branch, Charlotte NC — 9 January 2024, winter storm | 0.91 / −0.91 (1) | 0.47 / −0.47 (1) | 0.15 | 0.80 | 3.1× the target; the tuning carried over |
| Edwards Branch, Charlotte NC — 12 June 2025, real storm sewers | 0.76 / −0.76 (1) | 0.45 / −0.45 (1) | 0.08 | 0.45 | 3.0× the target; the tuning carried over |

## Edwards Branch, Charlotte NC — 12 June 2025, real storm sewers — 2026-11-08

Commit ddd6339+dirty. Every run: histSrc = radarFit, wetness = auto. Target 0.15 m. Fifth study: starting soil wetness from the rain of the 5 days before each storm (NRCS AMC, USGS rain gauges): June 2025 and August 2023 start dry, January 2024 wet. Groundwater return off.

| Values | Run | Level errors | RMS (m) | Bias (m) | Flow KGE | Flow NSE | Volume (model / gauge) | Peak flow (model / gauge) |
|---|---|---|---|---|---|---|---|---|
| infiltration × 0.1 **(kept)** | 2026-11-08_094514_Calibration-Existing-condition | 1 | 0.44 | −0.44 | 0.43 | 0.71 | 0.61 | 0.55 |
| infiltration × 0.15 | 2026-11-08_104421_Calibration-Existing-condition | 1 | 0.46 | −0.46 | 0.39 | 0.70 | 0.56 | 0.54 |
| infiltration × 0.25 | 2026-11-08_114144_Calibration-Existing-condition | 1 | 0.50 | −0.50 | 0.33 | 0.68 | 0.51 | 0.51 |

Kept (best flow KGE at the gauge): **infiltration × 0.1**, calibration storm 0.44 m RMS (2.9× the target), flow KGE 0.43.

| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n) | Flow KGE as set | calibrated | Against the target |
|---|---|---|---|---|---|
| Edwards Branch, Charlotte NC — 9 January 2024, winter storm | 1.17 / −1.17 (1) | 0.77 / −0.77 (1) | -0.08 | 0.39 | 5.2× the target; the tuning carried over |
| Edwards Branch, Charlotte NC — 10 August 2023, summer storm | 0.63 / −0.63 (1) | 0.00 / +0.00 (1) | 0.38 | 0.50 | meets; the tuning carried over |

## Edwards Branch, Charlotte NC — 12 June 2025, real storm sewers — 2026-11-08

Commit 6d047cc. Every run: histSrc = radarFit, calInfil = 0.25. Target 0.15 m. Fourth study: groundwater return (share of the infiltrated water back to the streams, lag 12 h) with infiltration x0.25 from the third study

| Values | Run | Level errors | RMS (m) | Bias (m) | Flow KGE | Flow NSE | Volume (model / gauge) | Peak flow (model / gauge) |
|---|---|---|---|---|---|---|---|---|
| groundwater return 0.1 | 2026-11-07_221427_Calibration-Existing-condition | 1 | 0.48 | −0.48 | 0.37 | 0.70 | 0.56 | 0.53 |
| groundwater return 0.2 | 2026-11-07_231113_Calibration-Existing-condition | 1 | 0.47 | −0.47 | 0.39 | 0.70 | 0.58 | 0.53 |
| groundwater return 0.3 **(kept)** | 2026-11-08_001033_Calibration-Existing-condition | 1 | 0.47 | −0.47 | 0.41 | 0.70 | 0.61 | 0.53 |

Kept (best flow KGE at the gauge): **groundwater return 0.3**, calibration storm 0.47 m RMS (3.1× the target), flow KGE 0.41.

| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n) | Flow KGE as set | calibrated | Against the target |
|---|---|---|---|---|---|
| Edwards Branch, Charlotte NC — 9 January 2024, winter storm | 0.90 / −0.90 (1) | 0.88 / −0.88 (1) | 0.19 | 0.24 | 5.9× the target; the tuning carried over |
| Edwards Branch, Charlotte NC — 10 August 2023, summer storm | 0.07 / −0.07 (1) | 0.06 / −0.06 (1) | 0.69 | 0.65 | meets; the tuning carried over |

## Edwards Branch, Charlotte NC — 12 June 2025, real storm sewers — 2026-11-08

Commit 62fbcc0. Every run: histSrc = radarFit. Target 0.15 m. Third study: Charlotte with separate storm sewers (combined-sewer mode was on by mistake before 7 Nov 2026); infiltration scored on the gauge's whole hydrograph

| Values | Run | Level errors | RMS (m) | Bias (m) | Flow KGE | Flow NSE | Volume (model / gauge) | Peak flow (model / gauge) |
|---|---|---|---|---|---|---|---|---|
| infiltration × 0.25 **(kept)** | 2026-11-07_175352_Calibration-Existing-condition | 1 | 0.48 | −0.48 | 0.35 | 0.69 | 0.53 | 0.53 |
| infiltration × 0.5 | 2026-11-07_184927_Calibration-Existing-condition | 1 | 0.55 | −0.55 | 0.26 | 0.65 | 0.45 | 0.48 |
| infiltration × 1 | 2026-11-07_194210_Calibration-Existing-condition | 1 | 0.70 | −0.70 | 0.13 | 0.58 | 0.35 | 0.40 |

Kept (best flow KGE at the gauge): **infiltration × 0.25**, calibration storm 0.48 m RMS (3.2× the target), flow KGE 0.35.

| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n) | Flow KGE as set | calibrated | Against the target |
|---|---|---|---|---|---|
| Edwards Branch, Charlotte NC — 9 January 2024, winter storm | 1.28 / −1.28 (1) | 0.90 / −0.90 (1) | -0.16 | 0.19 | 6.0× the target; the tuning carried over |
| Edwards Branch, Charlotte NC — 10 August 2023, summer storm | 0.49 / −0.49 (1) | 0.07 / −0.07 (1) | 0.54 | 0.69 | meets; the tuning carried over |

## Edwards Branch, Charlotte NC — 12 June 2025, real storm sewers — 2026-11-07

Commit a8c1283. Every run: histSrc = radarFit. Target 0.15 m. Roughness and infiltration together, kept by the flow at the gauge (control line below Sheffield Dr) over the whole storm. City data as cached on 5 November 2026. SUPERSEDED: The flow scores in this study are wrong: the case’s gauge line (2026-11-06) spanned only the creek channel, and on these storms part of the flood crossed the floodplain north of it uncounted (a line across the whole valley read 2.0 times the volume on 10 August 2023). The level errors stand. Superseded by the study after it.

| Values | Run | Level errors | RMS (m) | Bias (m) | Flow KGE | Flow NSE | Volume (model / gauge) | Peak flow (model / gauge) |
|---|---|---|---|---|---|---|---|---|
| roughness × 0.6, infiltration × 0.1 **(kept)** | 2026-11-06_154340_Calibration-Existing-condition | 1 | 0.72 | −0.72 | -0.07 | 0.33 | 0.22 | 0.29 |
| roughness × 0.6, infiltration × 0.25 | 2026-11-06_163804_Calibration-Existing-condition | 1 | 0.75 | −0.75 | -0.11 | 0.30 | 0.19 | 0.27 |
| roughness × 0.6, infiltration × 0.5 | 2026-11-06_172956_Calibration-Existing-condition | 1 | 0.80 | −0.80 | -0.15 | 0.27 | 0.16 | 0.25 |
| roughness × 0.8, infiltration × 0.1 | 2026-11-06_183326_Calibration-Existing-condition | 1 | 0.68 | −0.68 | -0.08 | 0.34 | 0.21 | 0.27 |
| roughness × 0.8, infiltration × 0.25 | 2026-11-06_193718_Calibration-Existing-condition | 1 | 0.71 | −0.71 | -0.12 | 0.31 | 0.18 | 0.26 |
| roughness × 0.8, infiltration × 0.5 | 2026-11-06_204041_Calibration-Existing-condition | 1 | 0.76 | −0.76 | -0.15 | 0.28 | 0.16 | 0.24 |
| roughness × 1, infiltration × 0.1 | 2026-11-06_220627_Calibration-Existing-condition | 1 | 0.63 | −0.63 | -0.09 | 0.35 | 0.20 | 0.26 |
| roughness × 1, infiltration × 0.25 | 2026-11-06_230511_Calibration-Existing-condition | 1 | 0.67 | −0.67 | -0.12 | 0.32 | 0.18 | 0.24 |
| roughness × 1, infiltration × 0.5 | 2026-11-07_000446_Calibration-Existing-condition | 1 | 0.73 | −0.73 | -0.16 | 0.28 | 0.15 | 0.22 |

Kept (best flow KGE at the gauge): **roughness × 0.6, infiltration × 0.1**, calibration storm 0.72 m RMS (4.8× the target), flow KGE -0.07.

| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n) | Flow KGE as set | calibrated | Against the target |
|---|---|---|---|---|---|
| Edwards Branch, Charlotte NC — 9 January 2024, winter storm | 1.36 / −1.36 (1) | 0.89 / −0.89 (1) | -0.39 | -0.18 | 5.9× the target; the tuning carried over |
| Edwards Branch, Charlotte NC — 10 August 2023, summer storm | 0.61 / −0.61 (1) | 0.06 / −0.06 (1) | -0.18 | 0.43 | meets; the tuning carried over |

## Edwards Branch, Charlotte NC — 12 June 2025, real storm sewers — 2026-11-06

Commit 7fa115d. Every run: histSrc = radarFit. Target 0.15 m. first split-sample study: infiltration only, gauge-fitted radar

| Values | Run | Level errors | RMS (m) | Bias (m) |
|---|---|---|---|---|
| infiltration × 0.25 **(kept)** | 2026-11-05_110430_Calibration-Existing-condition | 1 | 0.68 | −0.68 |
| infiltration × 0.5 | 2026-11-05_124040_Calibration-Existing-condition | 1 | 0.73 | −0.73 |
| infiltration × 1 | 2026-11-05_133453_Calibration-Existing-condition | 1 | 0.87 | −0.87 |

Kept: **infiltration × 0.25**, calibration storm 0.68 m RMS (4.5× the target).

| Storm it never saw | As set: RMS / bias (n) | Calibrated: RMS / bias (n) | Against the target |
|---|---|---|---|
| Edwards Branch, Charlotte NC — 9 January 2024, winter storm | 1.36 / −1.36 (1) | 0.99 / −0.99 (1) | 6.6× the target; the tuning carried over |
| Edwards Branch, Charlotte NC — 10 August 2023, summer storm | 0.60 / −0.60 (1) | 0.17 / −0.17 (1) | 1.1× the target; the tuning carried over |

