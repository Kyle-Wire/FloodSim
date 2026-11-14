# RT-1 registration

**Registered 14 Nov 2026**, on the main branch at ec6f89d. Nothing has been built or run.

## What is fixed

| Item | Where | Decided |
|---|---|---|
| Protocol, model setup, scoring rows | `README.md` | drafted 14 Nov 2026 |
| Thresholds: high- and mid-flow level \|bias\| ≤ 0.15 m and RMSE ≤ 0.20 m Passed; ≤ 0.30 m Qualified; beyond Failed. Errors inside U_obs count as zero | `README.md`, Scoring | accepted by the user 14 Nov 2026 |
| Shorter upstream length where a structure or tributary lies < 1 km above the gauge, with the inflow row (< 0.02 m when the edge moves 100 m) | `README.md`, Model setup and Scoring | decided by the user 14 Nov 2026 |
| Model read within ±50 m of the gauge bridge | `README.md`, Reference uncertainty | 14 Nov 2026, from the position check |
| Configurations A (default, hydro-flattened lidar) and B (A + `src/bathymetry.js`) | `README.md` | 14 Nov 2026 |
| Sites: eight picks, the reserves and every exclusion with its reason | `sites.md` | 14 Nov 2026 |
| Screening and site-check output | `candidates.json`, `structures.json` | 14 Nov 2026 |

## The sites

| Region | Site | Name |
|---|---|---|
| IA | 05470000 | South Skunk River near Ames |
| IA | 05486000 | North River near Norwalk |
| CO | 06709530 | Plum Creek at Titan Rd near Louviers |
| CO | 06730200 | Boulder Creek at N 75th St |
| PA/NJ | 01481000 | Brandywine Creek at Chadds Ford (short upstream) |
| PA/NJ | 01467081 | S Br Pennsauken Creek at Cherry Hill |
| TX | 08183978 | Cibolo Creek at Specht Rd (short upstream) |
| NC | 0214645022 | Briar Creek above Colony Rd (short upstream) |

All eight are bridge sections. The open-reach class has no site.

A reserve is used only if a pick is **Invalid setup** before any of its results are seen: terrain cannot be fetched, or
the reach cannot be built. The reserves are taken in their `sites.md` order. A pick that runs and scores
**Insufficient** stays in as Insufficient.

## Known limits, stated before the run

- Structures come from OpenStreetMap and the NID only. The USGS station descriptions were not available.
- Pennsauken was cleared for rule 5 from the OSM geometry, not imagery.
- At four sites the NHD line is shorter than the 5 km check window downstream.
- Cibolo has 12 direct measurements, only 1 of them Good.

## Hashes

`SHA256SUMS` in this folder covers `README.md`, `sites.md`, `candidates.json`, `structures.json`, `screen.mjs` and
`check-sites.mjs`. Any change to these files after this date is a revision and is recorded below, with a new hash.

## Revisions

None.
