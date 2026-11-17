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
| PV-SS9 | Coarse run then downscale: do a kerb, a crown and a small hollow survive? | 10 | 4 | 4 Not independently validated | 14 case-executor pairs |
| PV-SS10 | Street-to-sewer exchange against laboratory measurements | 0 | 15 | – | – |
| PV-SS11 | Surface only, an allowance, or pipes: each against a known answer | 11 | 26 | – | 37 case-executor pairs |
| PV-SS12 | Measures one owner can take | 10 | 0 | 4 Unsupported | 6 case-executor pairs |

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

Run `results/2026-11-17T19-16-10-828Z/`. 8 Failed, 22 Passed. Not yet run: SS3-a [gpu], SS3-b [gpu], SS3-c [gpu], SS3-d [gpu], SS3-e [gpu], SS3-f [gpu], SS3-x2 [gpu], SS3-x4 [gpu].

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

Run `results/2026-11-17T19-16-10-828Z/`. 11 Passed, 5 Failed. Not yet run: SS8-none-10 [gpu], SS8-none-100 [gpu], SS8-none-500 [gpu], SS8-lump30-10 [gpu], SS8-lump30-100 [gpu], SS8-lump30-500 [gpu], SS8-lump50-100 [gpu], SS8-lump50-500 [gpu].

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

## PV-SS9  Coarse run then downscale: do a kerb, a crown and a small hollow survive?

Run `results/2026-11-17T19-16-10-828Z/`. 10 Passed, 4 Not independently validated, 4 Failed. Not yet run: SS9-2 [gpu], SS9-4 [gpu], SS9-4s [gpu], SS9-8s [gpu], SS9-kerb-1 [gpu], SS9-hollow-1 [gpu], SS9-kerb-2 [gpu], SS9-hollow-2 [gpu], SS9-kerb-4 [gpu], SS9-hollow-4 [gpu], SS9-kerb-4s [gpu], SS9-hollow-4s [gpu], SS9-kerb-8s [gpu], SS9-hollow-8s [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS9-2 [cpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5716 | ± 0.0100 | Passed |
| SS9-2 [cpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 3.8e-4 | ± 0.0500 | **Not independently validated** |
| SS9-2 [cpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: inside) | 1.000 | 1.000 | ± 0.1000 | **Not independently validated** |
| SS9-4 [cpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5781 | ± 0.0100 | Passed |
| SS9-4 [cpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 0.0466 | ± 0.0500 | **Not independently validated** |
| SS9-4 [cpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: outside) | 1.000 | 0.8571 | ± 0.1000 | **Not independently validated** |
| SS9-kerb-1 [cpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0490 | ± 0.0200 | Passed |
| SS9-kerb-1 [cpu] | kerb: depth on the lot behind the kerb (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS9-kerb-1 [cpu] | crown: depth in the far gutter (m) | 0 | 0.0028 | ± 0.0100 | Passed |
| SS9-hollow-1 [cpu] | hollow: depth of water in it (m) | 0.0978 | 0.0976 | ± 0.0200 | Passed |
| SS9-kerb-2 [cpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0600 | ± 0.0200 | Passed |
| SS9-kerb-2 [cpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-2 [cpu] | crown: depth in the far gutter (m) | 0 | 0.0449 | ± 0.0100 | **Failed** |
| SS9-hollow-2 [cpu] | hollow: depth of water in it (m) | 0.0978 | 0.1200 | ± 0.0200 | **Failed** |
| SS9-kerb-4 [cpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0600 | ± 0.0200 | Passed |
| SS9-kerb-4 [cpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-4 [cpu] | crown: depth in the far gutter (m) | 0 | 0.0600 | ± 0.0100 | **Failed** |
| SS9-hollow-4 [cpu] | hollow: depth of water in it (m) | 0.0978 | 0 | ± 0.0200 | **Failed** |

## PV-SS10  Street-to-sewer exchange against laboratory measurements

Run `results/2026-11-17T18-34-52-775Z/`. 15 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| S1 test 1 (h_s 7.7 mm) | exchange into the sewer (l/s) | 0.6859 | 1.128 | ± 0.0686 | **Failed** |
| S1 test 2 (h_s 8.2 mm) | exchange into the sewer (l/s) | 0.7691 | 1.240 | ± 0.0769 | **Failed** |
| S1 test 3 (h_s 8.5 mm) | exchange into the sewer (l/s) | 0.8281 | 1.309 | ± 0.0828 | **Failed** |
| S1 test 4 (h_s 8.8 mm) | exchange into the sewer (l/s) | 0.8808 | 1.378 | ± 0.0881 | **Failed** |
| S1 test 5 (h_s 9.0 mm) | exchange into the sewer (l/s) | 0.9017 | 1.426 | ± 0.0902 | **Failed** |
| S1 test 6 (h_s 9.2 mm) | exchange into the sewer (l/s) | 0.9327 | 1.474 | ± 0.0933 | **Failed** |
| S1 test 7 (h_s 9.4 mm) | exchange into the sewer (l/s) | 0.9717 | 1.522 | ± 0.0972 | **Failed** |
| S1 test 8 (h_s 9.7 mm) | exchange into the sewer (l/s) | 1.062 | 1.595 | ± 0.1062 | **Failed** |
| S1 test 9 (h_s 9.9 mm) | exchange into the sewer (l/s) | 1.097 | 1.645 | ± 0.1097 | **Failed** |
| S1 test 10 (h_s 10.0 mm) | exchange into the sewer (l/s) | 1.109 | 1.670 | ± 0.1109 | **Failed** |
| S1 test 11 (h_s 10.2 mm) | exchange into the sewer (l/s) | 1.137 | 1.720 | ± 0.1137 | **Failed** |
| S1 test 12 (h_s 10.4 mm) | exchange into the sewer (l/s) | 1.146 | 1.771 | ± 0.1146 | **Failed** |
| S1 test 13 (h_s 10.7 mm) | exchange into the sewer (l/s) | 1.216 | 1.848 | ± 0.1216 | **Failed** |
| S1 test 14 (h_s 10.8 mm) | exchange into the sewer (l/s) | 1.202 | 1.874 | ± 0.1202 | **Failed** |
| S1 test 15 (h_s 11.0 mm) | exchange into the sewer (l/s) | 1.249 | 1.927 | ± 0.1249 | **Failed** |

## PV-SS11  Surface only, an allowance, or pipes: each against a known answer

Run `results/2026-11-17T19-13-18-241Z/`. 11 Passed, 26 Failed. Not yet run: SS11-sagA-10-pipe [gpu], SS11-sagA-10-none [gpu], SS11-sagA-10-lump30 [gpu], SS11-sagA-10-lump50 [gpu], SS11-sagA-100-pipe [gpu], SS11-sagA-100-none [gpu], SS11-sagA-100-lump30 [gpu], SS11-sagA-100-lump50 [gpu], SS11-sagA-500-pipe [gpu], SS11-sagA-500-none [gpu], SS11-sagA-500-lump30 [gpu], SS11-sagA-500-lump50 [gpu], SS11-sagB-10-pipe [gpu], SS11-sagB-10-none [gpu], SS11-sagB-10-lump30 [gpu], SS11-sagB-10-lump50 [gpu], SS11-sagB-100-pipe [gpu], SS11-sagB-100-none [gpu], SS11-sagB-100-lump30 [gpu], SS11-sagB-100-lump50 [gpu], SS11-sagB-500-pipe [gpu], SS11-sagB-500-none [gpu], SS11-sagB-500-lump30 [gpu], SS11-sagB-500-lump50 [gpu], SS11-hollow-10-none [gpu], SS11-hollow-10-lump30 [gpu], SS11-hollow-10-lump50 [gpu], SS11-hollow-100-none [gpu], SS11-hollow-100-lump30 [gpu], SS11-hollow-100-lump50 [gpu], SS11-hollow-500-none [gpu], SS11-hollow-500-lump30 [gpu], SS11-hollow-500-lump50 [gpu], SS11-hill-pipe [gpu], SS11-hill-none [gpu], SS11-hill-lump30 [gpu], SS11-hill-lump50 [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS11-sagA-10-pipe [cpu] | peak depth at the grate (m) (pipe) | 0.0264 | 0.0264 | ± 0.0200 | Passed |
| SS11-sagA-10-none [cpu] | peak depth at the grate (m) (surface only) | 0.0264 | 0.4169 | ± 0.0200 | **Failed** |
| SS11-sagA-10-lump30 [cpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0264 | 0.2541 | ± 0.0200 | **Failed** |
| SS11-sagA-10-lump50 [cpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0264 | 0.1878 | ± 0.0200 | **Failed** |
| SS11-sagA-100-pipe [cpu] | peak depth at the grate (m) (pipe) | 0.0362 | 0.0362 | ± 0.0200 | Passed |
| SS11-sagA-100-none [cpu] | peak depth at the grate (m) (surface only) | 0.0362 | 0.5582 | ± 0.0200 | **Failed** |
| SS11-sagA-100-lump30 [cpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0362 | 0.4151 | ± 0.0200 | **Failed** |
| SS11-sagA-100-lump50 [cpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0362 | 0.3434 | ± 0.0200 | **Failed** |
| SS11-sagA-500-pipe [cpu] | peak depth at the grate (m) (pipe) | 0.0434 | 0.0433 | ± 0.0200 | Passed |
| SS11-sagA-500-none [cpu] | peak depth at the grate (m) (surface only) | 0.0434 | 0.6572 | ± 0.0200 | **Failed** |
| SS11-sagA-500-lump30 [cpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0434 | 0.5335 | ± 0.0200 | **Failed** |
| SS11-sagA-500-lump50 [cpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0434 | 0.4542 | ± 0.0200 | **Failed** |
| SS11-sagB-10-pipe [cpu] | peak pond level in the sag (m) (pipe) | 0.0426 | 0.0394 | ± 0.0200 | Passed |
| SS11-sagB-10-none [cpu] | peak pond level in the sag (m) (surface only) | 0.0426 | 0.4169 | ± 0.0200 | **Failed** |
| SS11-sagB-10-lump30 [cpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.0426 | 0.2541 | ± 0.0200 | **Failed** |
| SS11-sagB-10-lump50 [cpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.0426 | 0.1878 | ± 0.0200 | **Failed** |
| SS11-sagB-100-pipe [cpu] | peak pond level in the sag (m) (pipe) | 0.1347 | 0.1154 | ± 0.0269 | Passed |
| SS11-sagB-100-none [cpu] | peak pond level in the sag (m) (surface only) | 0.1347 | 0.5582 | ± 0.0269 | **Failed** |
| SS11-sagB-100-lump30 [cpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.1347 | 0.4151 | ± 0.0269 | **Failed** |
| SS11-sagB-100-lump50 [cpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.1347 | 0.3434 | ± 0.0269 | **Failed** |
| SS11-sagB-500-pipe [cpu] | peak pond level in the sag (m) (pipe) | 0.2049 | 0.1883 | ± 0.0410 | Passed |
| SS11-sagB-500-none [cpu] | peak pond level in the sag (m) (surface only) | 0.2049 | 0.6572 | ± 0.0410 | **Failed** |
| SS11-sagB-500-lump30 [cpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.2049 | 0.5335 | ± 0.0410 | **Failed** |
| SS11-sagB-500-lump50 [cpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.2049 | 0.4542 | ± 0.0410 | **Failed** |
| SS11-hollow-10-none [cpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2000 | ± 0.0200 | Passed |
| SS11-hollow-10-lump30 [cpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.0642 | ± 0.0200 | **Failed** |
| SS11-hollow-10-lump50 [cpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.0072 | ± 0.0200 | **Failed** |
| SS11-hollow-100-none [cpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2001 | ± 0.0200 | Passed |
| SS11-hollow-100-lump30 [cpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.1693 | ± 0.0200 | **Failed** |
| SS11-hollow-100-lump50 [cpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.0966 | ± 0.0200 | **Failed** |
| SS11-hollow-500-none [cpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2001 | ± 0.0200 | Passed |
| SS11-hollow-500-lump30 [cpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.1728 | ± 0.0200 | **Failed** |
| SS11-hollow-500-lump50 [cpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.1509 | ± 0.0200 | **Failed** |
| SS11-hill-pipe [cpu] | depth in the kerb cell 40 m below the grate (m) (pipe) | 0.0168 | 0.0219 | ± 0.0050 | **Failed** |
| SS11-hill-none [cpu] | depth in the kerb cell 40 m below the grate (m) (surface only) | 0.0168 | 0.0246 | ± 0.0050 | **Failed** |
| SS11-hill-lump30 [cpu] | depth in the kerb cell 40 m below the grate (m) (allowance 30 mm/h) | 0.0168 | 0.0204 | ± 0.0050 | Passed |
| SS11-hill-lump50 [cpu] | depth in the kerb cell 40 m below the grate (m) (allowance 50 mm/h) | 0.0168 | 0.0168 | ± 0.0050 | Passed |

## PV-SS12  Measures one owner can take

Run `results/2026-11-17T19-13-18-241Z/`. 10 Passed, 4 Unsupported. Not yet run: SS12-garden-under [gpu], SS12-garden-over [gpu], SS12-paving [gpu], SS12-soil [gpu], SS12-roof-open [gpu], SS12-roof-held [gpu].

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS12-garden-under [cpu] | water left on the ground at the end (m³) | 0 | 9.6e-4 | ± 0.0300 | Passed |
| SS12-garden-under [cpu] | water the measure took (m³) | 1.000 | 0.9990 | ± 0.0300 | Passed |
| SS12-garden-over [cpu] | water left on the ground at the end (m³) | 1.752 | 1.752 | ± 0.0526 | Passed |
| SS12-garden-over [cpu] | water the measure took (m³) | 1.248 | 1.248 | ± 0.0374 | Passed |
| SS12-paving [cpu] | water left on the ground at the end (m³) | 0.9600 | 0.9600 | ± 0.0288 | Passed |
| SS12-paving [cpu] | water the measure took (m³) | 2.040 | 2.040 | ± 0.0612 | Passed |
| SS12-soil [cpu] | water left on the ground at the end (m³) | 2.600 | 2.600 | ± 0.0780 | Passed |
| SS12-soil [cpu] | water the measure took (m³) | 0.4000 | 0.4000 | ± 0.0120 | Passed |
| SS12-roof-open [cpu] | water on the ground at the end (m³) (the roof sheds onto the ground (control)) | 3.000 | 3.000 | ± 0.0030 | Passed |
| SS12-roof-held [cpu] | water on the ground at the end (m³) (the roof holds its rain) | 2.520 | 2.520 | ± 0.0025 | Passed |
| A rain barrel or cistern on an existing house | no control: a cistern exists only for a building drawn in site design (src/design.js roof 'cistern'), and its filling and overflow are timed in app/map.js (roofHoldStages), which a headless run of src/ does not reach. SS12-roof-held tests only that a held roof sheds nothing | – | – | – | **Unsupported** |
| A French drain | no control: the nearest thing is a rain garden's underdrain to a sewer manhole (src/stormwater.js UnderdrainLinks, GPU kernel only). A trench drain to daylight or to a dry well is not represented | – | – | – | **Unsupported** |
| Removing paving (bare soil in its place) as a what-if | no control: site design can add paving or permeable paving but cannot turn paving into soil. SS12-soil tests the solver's infiltration at a soil's rate, which is what such a control would use | – | – | – | **Unsupported** |
| A green roof on an existing house | area-wide only (a share of all roofs holds the first 25 mm), timed in app/map.js; not one owner's roof | – | – | – | **Unsupported** |
