# Street sandbox: scored results

Written by `report.mjs` from the latest scored run of each spec. Statuses are never merged into one percentage. `cpu` rows are the CPU surface solver (fp64), `gpu` rows the production GPU solver in the browser.

| Spec | What | Passed | Failed | Other | Not yet run |
|---|---|---|---|---|---|
| PV-SS1 | Rain on a tilted street | 12 | 0 | – | 2 case-executor pairs |
| PV-SS2 | A hollow of known volume under rain | 12 | 0 | – | 3 case-executor pairs |
| PV-SS3 | One inlet and one pipe; a synthetic network under storms beyond its design | 22 | 8 | – | 8 case-executor pairs |
| PV-SS4 | An outfall held under water | 6 | 11 | – | 4 case-executor pairs |
| PV-SS5 | The same block in a small box and a large one | 8 | 1 | – | 5 case-executor pairs |
| PV-SS6 | Cell size: a driveway dip and a rear yard | 16 | 4 | – | 12 case-executor pairs |
| PV-SS7 | The wall-exposure rule | 16 | 1 | – | – |
| PV-SS8 | Drainage treatments side by side | 11 | 5 | – | 8 case-executor pairs |
| PV-SS9 | Coarse run then downscale | 2 | 0 | 4 Not independently validated | 4 case-executor pairs |

## PV-SS1  Rain on a tilted street

Run `results/2026-11-17T18-15-21-477Z/`. 12 Passed. Not yet run: SS1-a [gpu], SS1-b [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS1-a [cpu] | steady outflow, last 300 s (m³/s) | 0.0222 | 0.0222 | ± 2.2e-4 | Passed |
| SS1-a [cpu] | steady depth at 50.5 m (m) | 0.0062 | 0.0062 | ± 5.0e-4 | Passed |
| SS1-a [cpu] | steady depth at 75.5 m (m) | 0.0079 | 0.0080 | ± 5.0e-4 | Passed |
| SS1-a [cpu] | time to 50 % of steady outflow (s) | 222.6 | 223.5 | ± 22.262 | Passed |
| SS1-a [cpu] | time to 90 % of steady outflow (s) | 316.8 | 318.8 | ± 31.675 | Passed |
| SS1-a [cpu] | surface books (relative) | 0 | 2.2e-15 | ± 1.0e-9 | Passed |
| SS1-b [cpu] | steady outflow, last 300 s (m³/s) | 0.0067 | 0.0067 | ± 6.7e-5 | Passed |
| SS1-b [cpu] | steady depth at 30.5 m (m) | 0.0026 | 0.0024 | ± 5.0e-4 | Passed |
| SS1-b [cpu] | steady depth at 45.5 m (m) | 0.0033 | 0.0031 | ± 5.0e-4 | Passed |
| SS1-b [cpu] | time to 50 % of steady outflow (s) | 182.5 | 167.2 | ± 18.254 | Passed |
| SS1-b [cpu] | time to 90 % of steady outflow (s) | 259.7 | 258.7 | ± 25.974 | Passed |
| SS1-b [cpu] | surface books (relative) | 0 | -1.9e-15 | ± 1.0e-9 | Passed |

## PV-SS2  A hollow of known volume under rain

Run `results/2026-11-17T18-15-21-477Z/`. 12 Passed. Not yet run: SS2-a [gpu], SS2-b [gpu], SS2-c [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS2-a [cpu] | depth in the hollow at the end (m) | 0.1200 | 0.1200 | ± 0.0030 | Passed |
| SS2-a [cpu] | spilled over the rim (m³) | 0 | -0.0022 | ± 0.3000 | Passed |
| SS2-a [cpu] | surface books (relative) | 0 | -8.0e-16 | ± 1.0e-9 | Passed |
| SS2-b [cpu] | depth in the hollow at the end (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS2-b [cpu] | spilled over the rim (m³) | 12.000 | 11.993 | ± 0.3000 | Passed |
| SS2-b [cpu] | peak depth in the hollow (m) (reference: rim plus the head of frictionless critical flow) | 0.2065 | 0.2120 | ± 0.0080 | Passed |
| SS2-b [cpu] | surface books (relative) | 0 | 8.7e-15 | ± 1.0e-9 | Passed |
| SS2-c [cpu] | depth in the hollow at the end (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS2-c [cpu] | spilled over the rim (m³) | 44.000 | 43.993 | ± 0.8800 | Passed |
| SS2-c [cpu] | peak depth in the hollow (m) (reference: rim plus the head of frictionless critical flow) | 0.2103 | 0.2176 | ± 0.0080 | Passed |
| SS2-c [cpu] | surface books (relative) | 0 | -2.0e-15 | ± 1.0e-9 | Passed |
| SS2-c against SS2-b [cpu] | end depth, a storm twice as large less the smaller one (m) | 0 | 6.2e-8 | ± 0.0030 | Passed |

## PV-SS3  One inlet and one pipe; a synthetic network under storms beyond its design

Run `results/2026-11-17T18-31-16-897Z/`. 8 Failed, 22 Passed. Not yet run: SS3-a [gpu], SS3-b [gpu], SS3-c [gpu], SS3-d [gpu], SS3-e [gpu], SS3-f [gpu], SS3-x2 [gpu], SS3-x4 [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS3-a [cpu] | pond level in the sag at 3600 s (m) | 0.1863 | 0.1251 | ± 0.0056 | **Failed** |
| SS3-a [cpu] | pond level in the sag at 7200 s (m) | 0.1987 | 0.1211 | ± 0.0060 | **Failed** |
| SS3-a [cpu] | pipe flow at 7200 s (m³/s) | 0.0222 | 0.0219 | ± 4.4e-4 | Passed |
| SS3-a [cpu] | water on the street at 1800 s (m³) | 4.814 | 5.278 | ± 0.2407 | **Failed** |
| SS3-a [cpu] | surface books (relative) | 0 | -4.1e-15 | ± 1.0e-9 | Passed |
| SS3-a [cpu] | SWMM continuity error (%) | 0 | 0.7720 | ± 0.5000 | **Failed** |
| SS3-b [cpu] | pond level in the sag at 3600 s (m) | 0.1863 | 0.3926 | ± 0.0056 | **Failed** |
| SS3-b [cpu] | pond level in the sag at 7200 s (m) | 0.1987 | 0.5986 | ± 0.0060 | **Failed** |
| SS3-b [cpu] | pipe flow at 7200 s (m³/s) | 0.0222 | 0.0173 | ± 4.4e-4 | **Failed** |
| SS3-b [cpu] | water on the street at 1800 s (m³) | 4.814 | 11.397 | ± 0.2407 | **Failed** |
| SS3-b [cpu] | surface books (relative) | 0 | 1.9e-14 | ± 1.0e-9 | Passed |
| SS3-b [cpu] | SWMM continuity error (%) | 0 | 0.0140 | ± 0.5000 | Passed |
| SS3-c [cpu] | depth at the grate at the end (m) (free outfall: the pipe carries the rain, the street stands at the grate's weir head) | 0.0293 | 0.0293 | ± 0.0059 | Passed |
| SS3-c [cpu] | surface books (relative) | 0 | -1.4e-14 | ± 1.0e-9 | Passed |
| SS3-c [cpu] | SWMM continuity error (%) | 0 | 0.1430 | ± 0.5000 | Passed |
| SS3-d [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0022 | ± 0.1000 | Passed |
| SS3-d [cpu] | surface books (relative) | 0 | -5.9e-15 | ± 1.0e-9 | Passed |
| SS3-d [cpu] | SWMM continuity error (%) | 0 | -0.0780 | ± 0.5000 | Passed |
| SS3-e [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0077 | ± 0.1000 | Passed |
| SS3-e [cpu] | surface books (relative) | 0 | -2.5e-15 | ± 1.0e-9 | Passed |
| SS3-e [cpu] | SWMM continuity error (%) | 0 | -0.0930 | ± 0.5000 | Passed |
| SS3-f [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0097 | ± 0.1000 | Passed |
| SS3-f [cpu] | surface books (relative) | 0 | -1.9e-14 | ± 1.0e-9 | Passed |
| SS3-f [cpu] | SWMM continuity error (%) | 0 | -0.1340 | ± 0.5000 | Passed |
| SS3-x2 [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | -0.0015 | ± 0.1000 | Passed |
| SS3-x2 [cpu] | surface books (relative) | 0 | -2.9e-15 | ± 1.0e-9 | Passed |
| SS3-x2 [cpu] | SWMM continuity error (%) | 0 | -0.4520 | ± 0.5000 | Passed |
| SS3-x4 [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J0) | 0 | -0.0786 | ± 0.1000 | Passed |
| SS3-x4 [cpu] | surface books (relative) | 0 | 3.8e-15 | ± 1.0e-9 | Passed |
| SS3-x4 [cpu] | SWMM continuity error (%) | 0 | -0.0120 | ± 0.5000 | Passed |

## PV-SS4  An outfall held under water

Run `results/2026-11-17T18-15-21-477Z/`. 11 Failed, 6 Passed. Not yet run: SS4-a [gpu], SS4-b [gpu], SS4-c [gpu], SS4-d [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS4-a [cpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.1445 | ± 0.0050 | **Failed** |
| SS4-a [cpu] | water on the street at 3600 s (m³) | 4.500 | 4.281 | ± 0.2250 | Passed |
| SS4-a [cpu] | surface books (relative) | 0 | 3.3e-15 | ± 1.0e-9 | Passed |
| SS4-a [cpu] | SWMM continuity error (%) | 0 | 12.537 | ± 0.5000 | **Failed** |
| SS4-b [cpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.1401 | ± 0.0050 | **Failed** |
| SS4-b [cpu] | water on the street at 3600 s (m³) | 4.500 | 4.065 | ± 0.2250 | **Failed** |
| SS4-b [cpu] | surface books (relative) | 0 | -3.3e-15 | ± 1.0e-9 | Passed |
| SS4-b [cpu] | SWMM continuity error (%) | 0 | 10.078 | ± 0.5000 | **Failed** |
| SS4-c [cpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.7260 | ± 0.0050 | **Failed** |
| SS4-c [cpu] | water on the street at 3600 s (m³) | 4.500 | 49.645 | ± 0.2250 | **Failed** |
| SS4-c [cpu] | surface books (relative) | 0 | -1.6e-15 | ± 1.0e-9 | Passed |
| SS4-c [cpu] | SWMM continuity error (%) | 0 | 0.0960 | ± 0.5000 | Passed |
| SS4-d [cpu] | pond level in the sag at 3600 s (m) | 0.4862 | 0.4284 | ± 0.0146 | **Failed** |
| SS4-d [cpu] | pond level in the sag at 7200 s (m) | 0.5466 | 0.4705 | ± 0.0164 | **Failed** |
| SS4-d [cpu] | pipe flow at 7200 s (m³/s) | 0.0214 | 0.0222 | ± 4.3e-4 | **Failed** |
| SS4-d [cpu] | surface books (relative) | 0 | 7.3e-16 | ± 1.0e-9 | Passed |
| SS4-d [cpu] | SWMM continuity error (%) | 0 | 1.150 | ± 0.5000 | **Failed** |

## PV-SS5  The same block in a small box and a large one

Run `results/2026-11-17T18-15-21-477Z/`. 8 Passed, 1 Failed. Not yet run: SS5-up-large [gpu], SS5-up-small [gpu], SS5-down-large [gpu], SS5-down-ok [gpu], SS5-down-small [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS5-up-large [cpu] | depth at the block against the true depth (m) | 0.0101 | 0.0101 | ± 5.1e-4 | Passed |
| SS5-up-small [cpu] | depth at the block against this box's own slope length (m) | 0.0039 | 0.0038 | ± 5.0e-4 | Passed |
| SS5-up-small [cpu] | depth at the block against the true depth (m) (the box is cut below the divide) | 0.0101 | 0.0038 | ± 0.0050 | **Failed** |
| SS5-down-large [cpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS5-down-large [cpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2119 | ± 0.0080 | Passed |
| SS5-down-ok [cpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2000 | ± 0.0200 | Passed |
| SS5-down-ok [cpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2119 | ± 0.0206 | Passed |
| SS5-down-small [cpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2094 | ± 0.0200 | Passed |
| SS5-down-small [cpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2094 | ± 0.0206 | Passed |

## PV-SS6  Cell size: a driveway dip and a rear yard

Run `results/2026-11-17T18-15-21-477Z/`. 16 Passed, 4 Failed. Not yet run: SS6-drive-1 [gpu], SS6-drive-2 [gpu], SS6-drive-4 [gpu], SS6-drive-05 [gpu], SS6-drive-4s [gpu], SS6-drive-8s [gpu], SS6-yard-1 [gpu], SS6-yard-2 [gpu], SS6-yard-4 [gpu], SS6-yard-05 [gpu], SS6-yard-4s [gpu], SS6-yard-8s [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS6-drive-1 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.8015 | ± 0.0802 | Passed |
| SS6-drive-1 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.8017 | 0.8015 | ± 0.0100 | Passed |
| SS6-drive-2 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.3632 | ± 0.0802 | **Failed** |
| SS6-drive-2 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0.8017 | 0.8182 | ± 0.0802 | Passed |
| SS6-drive-2 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.3633 | 0.3632 | ± 0.0100 | Passed |
| SS6-drive-4 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.1456 | ± 0.0802 | **Failed** |
| SS6-drive-4 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0.8017 | 0.8431 | ± 0.0802 | Passed |
| SS6-drive-4 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.1456 | 0.1456 | ± 0.0100 | Passed |
| SS6-drive-05 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8392 | 0.8390 | ± 0.0839 | Passed |
| SS6-drive-05 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.8392 | 0.8390 | ± 0.0100 | Passed |
| SS6-yard-1 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 1.0e-5 | ± 0.0200 | Passed |
| SS6-yard-1 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS6-yard-2 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 0.1072 | ± 0.0200 | **Failed** |
| SS6-yard-2 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0 | 0.1159 | ± 0.0200 | **Failed** |
| SS6-yard-2 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.1072 | 0.1072 | ± 0.0100 | Passed |
| SS6-yard-4 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 2.0e-5 | ± 0.0200 | Passed |
| SS6-yard-4 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0 | 0 | ± 0.0200 | Passed |
| SS6-yard-4 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 2.0e-5 | ± 0.0100 | Passed |
| SS6-yard-05 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 1.0e-5 | ± 0.0200 | Passed |
| SS6-yard-05 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |

## PV-SS7  The wall-exposure rule

Run `results/2026-11-17T18-15-21-477Z/`. 16 Passed, 1 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| R1 15 cm at the wall, joined to street water | water counts against the building (1 yes, 0 no) | 1.000 | 1.000 | ± 0 | Passed |
| R1 15 cm at the wall, joined to street water | wall level (m) | 10.150 | 10.150 | ± 1.0e-6 | Passed |
| R2 15 cm pond of 100 m^2 against the wall, not joined to the street | water counts against the building (1 yes, 0 no) | 0 | 0 | ± 0 | Passed |
| R3 15 cm pond of exactly 200 m^2, not joined to the street | water counts against the building (1 yes, 0 no) | 1.000 | 1.000 | ± 0 | Passed |
| R3 15 cm pond of exactly 200 m^2, not joined to the street | wall level (m) | 10.150 | 10.150 | ± 1.0e-6 | Passed |
| R4 15 cm pond of 199 m^2, not joined to the street | water counts against the building (1 yes, 0 no) | 0 | 0 | ± 0 | Passed |
| R5 9.9 cm at the wall, joined to street water | water counts against the building (1 yes, 0 no) | 0 | 0 | ± 0 | Passed |
| R6 exactly 10 cm at the wall, joined to street water | water counts against the building (1 yes, 0 no) | 1.000 | 1.000 | ± 0 | Passed |
| R6 exactly 10 cm at the wall, joined to street water | wall level (m) | 10.100 | 10.100 | ± 1.0e-6 | Passed |
| R7 15 cm joined to the street, 3 m from the wall | water counts against the building (1 yes, 0 no) | 0 | 0 | ± 0 | Passed |
| R8 15 cm joined to the street, on the second cell from the wall (1-2 m) | water counts against the building (1 yes, 0 no) | 1.000 | 1.000 | ± 0 | Passed |
| R8 15 cm joined to the street, on the second cell from the wall (1-2 m) | wall level (m) | 10.150 | 10.150 | ± 1.0e-6 | Passed |
| R9 a 100 m^2 pond that touches street water only corner to corner | water counts against the building (1 yes, 0 no) | 0 | 0 | ± 0 | Passed |
| R10 two street-joined strips at different levels: the higher one | water counts against the building (1 yes, 0 no) | 1.000 | 1.000 | ± 0 | Passed |
| R10 two street-joined strips at different levels: the higher one | wall level (m) | 10.300 | 10.300 | ± 1.0e-6 | Passed |
| R11 50 cm against the wall, linked to the street only by 5 cm of water | water counts against the building (1 yes, 0 no) | 0 | 0 | ± 0 | Passed |
| R12 at 2 m cells: 15 cm joined to the street on the cell 2-4 m from the wall | water counts against the building (1 yes, 0 no) | 0 | 1.000 | ± 0 | **Failed** |

## PV-SS8  Drainage treatments side by side

Run `results/2026-11-17T18-31-16-897Z/`. 11 Passed, 5 Failed. Not yet run: SS8-none-10 [gpu], SS8-none-100 [gpu], SS8-none-500 [gpu], SS8-lump30-10 [gpu], SS8-lump30-100 [gpu], SS8-lump30-500 [gpu], SS8-lump50-100 [gpu], SS8-lump50-500 [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS8-none-10 [cpu] | pond depth at the sag at the end (m) | 0.4853 | 0.4853 | ± 0.0100 | Passed |
| SS8-none-10 [cpu] | surface books (relative) | 0 | -6.3e-15 | ± 1.0e-9 | Passed |
| SS8-none-100 [cpu] | pond depth at the sag at the end (m) | 0.5715 | 0.5715 | ± 0.0100 | Passed |
| SS8-none-100 [cpu] | surface books (relative) | 0 | -2.8e-15 | ± 1.0e-9 | Passed |
| SS8-none-500 [cpu] | pond depth at the sag at the end (m) | 0.6268 | 0.6268 | ± 0.0100 | Passed |
| SS8-none-500 [cpu] | surface books (relative) | 0 | -7.8e-15 | ± 1.0e-9 | Passed |
| SS8-lump30-10 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 296.4 | 343.5 | ± 5.927 | **Failed** |
| SS8-lump30-10 [cpu] | surface books (relative) | 0 | -1.3e-14 | ± 1.0e-9 | Passed |
| SS8-lump30-100 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 615.3 | 679.8 | ± 12.306 | **Failed** |
| SS8-lump30-100 [cpu] | surface books (relative) | 0 | -2.8e-15 | ± 1.0e-9 | Passed |
| SS8-lump30-500 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 921.6 | 975.4 | ± 18.432 | **Failed** |
| SS8-lump30-500 [cpu] | surface books (relative) | 0 | 1.7e-15 | ± 1.0e-9 | Passed |
| SS8-lump50-100 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 461.9 | 536.4 | ± 9.238 | **Failed** |
| SS8-lump50-100 [cpu] | surface books (relative) | 0 | -8.8e-15 | ± 1.0e-9 | Passed |
| SS8-lump50-500 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 708.1 | 806.0 | ± 14.161 | **Failed** |
| SS8-lump50-500 [cpu] | surface books (relative) | 0 | -1.2e-14 | ± 1.0e-9 | Passed |

## PV-SS9  Coarse run then downscale

Run `results/2026-11-17T18-31-16-897Z/`. 2 Passed, 4 Not independently validated. Not yet run: SS9-2 [gpu], SS9-4 [gpu], SS9-4s [gpu], SS9-8s [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS9-2 [cpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5716 | ± 0.0100 | Passed |
| SS9-2 [cpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 3.8e-4 | ± 0.0500 | **Not independently validated** |
| SS9-2 [cpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: inside) | 1.000 | 1.000 | ± 0.1000 | **Not independently validated** |
| SS9-4 [cpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5781 | ± 0.0100 | Passed |
| SS9-4 [cpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 0.0466 | ± 0.0500 | **Not independently validated** |
| SS9-4 [cpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: outside) | 1.000 | 0.8571 | ± 0.1000 | **Not independently validated** |
