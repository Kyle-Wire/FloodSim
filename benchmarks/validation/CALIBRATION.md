# Calibration studies

Written by `node tools/calibrate.mjs` (records in `calibration.json`). Each study tunes the model on one observed storm,
keeps the values with the smallest RMS level error (high-water marks and gauge peaks, model − observed, m), then runs
other storms the tuning never saw, as set and with the values frozen. The target is the usual bar for a mapping model:
levels within 0.5 ft (0.15 m). A model is calibrated when the storms it never saw meet the target with the values
kept, not when the tuning storm does. See docs/METHODS.md §6.4.

