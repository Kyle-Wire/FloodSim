# Calibration studies

Written by `node tools/calibrate.mjs` (records in `calibration.json`). Each study tunes the model on one observed storm,
keeps the values with the smallest RMS level error (high-water marks and gauge peaks, model − observed, m), or with
the best flow at a gauge over the whole storm (Kling–Gupta efficiency, KGE: 1 is perfect), then runs
other storms the tuning never saw, as set and with the values frozen. The target is the usual bar for a mapping model:
levels within 0.5 ft (0.15 m). A model is calibrated when the storms it never saw meet the target with the values
kept, not when the tuning storm does. See docs/METHODS.md §6.4.

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

