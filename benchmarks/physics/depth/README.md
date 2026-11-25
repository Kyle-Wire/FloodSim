# Depth audit: planted cases with known answers

Protocol: gridzip-lab `physics/PROTOCOL-12.md` (written before the full set ran; amendments A1, A2 there).
`node benchmarks/physics/depth/cases.mjs [C|B|R|all] [--quick] [--free-edge]` writes JSON to stdout
(`CW=<widths>` / `BK=<setting indices>` split C and B across processes). Results are in `results/`.

| Family | Case | Result (25 Nov 2026) |
|---|---|---|
| C | steady flow between walls, W 2.5 to 20 m, dx 0.5 to 4 m | Equals the 2D answer at the model's drawn width to 0.5 % in all 96 cases. Against the real channel it is low by two causes: the drawn width (−0.6·ln(Wm/W)) and no wall friction (−0.4·ln(1 + 2h/W)); narrow deep channels come out near half depth. |
| B | backwater from a held downstream level | Held edge: exact (0.2 %). Free edge: the river drains to 0.26 to 0.44 of its depth at the edge, recovering over km (the Lumber River miss). |
| R | steady rain on a plane | **Fails**: sheet flow is too thin on steep ground and big cells (1 m: 0.36 to 1.00 of kinematic depth; 4 m: 0.10 to 0.78), with exact mass. A fix candidate in the solver's thin-film handling. |

`mass_rel` in C and B counts the harness's injected inflow as a gain; it is not a solver imbalance.
