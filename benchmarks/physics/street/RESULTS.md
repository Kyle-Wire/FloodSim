# Street sandbox: scored results

Written by `report.mjs` from the latest scored run of each spec. Statuses are never merged into one percentage. `cpu` rows are the CPU surface solver (fp64), `gpu` rows the production GPU solver in the browser.

| Spec | What | Passed | Failed | Other | Not yet run |
|---|---|---|---|---|---|
| PV-SS1 | Rain on a tilted street | 24 | 0 | – | – |
| PV-SS2 | A hollow of known volume under rain | 23 | 1 | – | – |
| PV-SS3 | One inlet and one pipe; a synthetic network under storms beyond its design | 43 | 17 | – | – |
| PV-SS4 | An outfall held under water | 12 | 22 | – | – |
| PV-SS5 | The same block in a small box and a large one | 16 | 2 | – | – |
| PV-SS6 | Cell size: a driveway dip and a rear yard | 33 | 11 | – | – |
| PV-SS7 | The wall-exposure rule | 16 | 1 | – | – |
| PV-SS8 | Drainage treatments side by side | 22 | 10 | – | – |
| PV-SS9 | Coarse run then downscale: do a kerb, a crown and a small hollow survive? | 27 | 11 | 12 Not independently validated | – |
| PV-SS10 | Street-to-sewer exchange against laboratory measurements | 0 | 15 | – | – |
| PV-SS11 | Surface only, an allowance, or pipes: each against a known answer | 22 | 52 | – | – |
| PV-SS12 | Measures one owner can take | 20 | 0 | 4 Unsupported | – |
| PV-SS13 | A grate in a gutter on a grade | 18 | 18 | – | – |

## PV-SS1  Rain on a tilted street

Run `results/2026-11-17T21-56-34-566Z/`. 24 Passed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS1-a [cpu] | steady outflow, last 300 s (m³/s) | 0.0222 | 0.0222 | ± 2.2e-4 | Passed |
| SS1-a [cpu] | steady depth at 50.5 m (m) | 0.0062 | 0.0062 | ± 5.0e-4 | Passed |
| SS1-a [cpu] | steady depth at 75.5 m (m) | 0.0079 | 0.0080 | ± 5.0e-4 | Passed |
| SS1-a [cpu] | time to 50 % of steady outflow (s) | 222.6 | 223.5 | ± 22.262 | Passed |
| SS1-a [cpu] | time to 90 % of steady outflow (s) | 316.8 | 318.8 | ± 31.675 | Passed |
| SS1-a [cpu] | surface books (relative) | 0 | 2.2e-15 | ± 1.0e-9 | Passed |
| SS1-a [gpu] | steady outflow, last 300 s (m³/s) | 0.0222 | 0.0222 | ± 2.2e-4 | Passed |
| SS1-a [gpu] | steady depth at 50.5 m (m) | 0.0062 | 0.0062 | ± 5.0e-4 | Passed |
| SS1-a [gpu] | steady depth at 75.5 m (m) | 0.0079 | 0.0080 | ± 5.0e-4 | Passed |
| SS1-a [gpu] | time to 50 % of steady outflow (s) | 222.6 | 223.5 | ± 22.262 | Passed |
| SS1-a [gpu] | time to 90 % of steady outflow (s) | 316.8 | 318.8 | ± 31.675 | Passed |
| SS1-a [gpu] | surface books (relative) | 0 | 7.4e-8 | ± 1.0e-5 | Passed |
| SS1-b [cpu] | steady outflow, last 300 s (m³/s) | 0.0067 | 0.0067 | ± 6.7e-5 | Passed |
| SS1-b [cpu] | steady depth at 30.5 m (m) | 0.0026 | 0.0024 | ± 5.0e-4 | Passed |
| SS1-b [cpu] | steady depth at 45.5 m (m) | 0.0033 | 0.0031 | ± 5.0e-4 | Passed |
| SS1-b [cpu] | time to 50 % of steady outflow (s) | 182.5 | 167.2 | ± 18.254 | Passed |
| SS1-b [cpu] | time to 90 % of steady outflow (s) | 259.7 | 258.7 | ± 25.974 | Passed |
| SS1-b [cpu] | surface books (relative) | 0 | -1.9e-15 | ± 1.0e-9 | Passed |
| SS1-b [gpu] | steady outflow, last 300 s (m³/s) | 0.0067 | 0.0067 | ± 6.7e-5 | Passed |
| SS1-b [gpu] | steady depth at 30.5 m (m) | 0.0026 | 0.0024 | ± 5.0e-4 | Passed |
| SS1-b [gpu] | steady depth at 45.5 m (m) | 0.0033 | 0.0031 | ± 5.0e-4 | Passed |
| SS1-b [gpu] | time to 50 % of steady outflow (s) | 182.5 | 167.2 | ± 18.254 | Passed |
| SS1-b [gpu] | time to 90 % of steady outflow (s) | 259.7 | 258.7 | ± 25.974 | Passed |
| SS1-b [gpu] | surface books (relative) | 0 | 2.2e-9 | ± 1.0e-5 | Passed |

## PV-SS2  A hollow of known volume under rain

Run `results/2026-11-17T21-56-34-566Z/`. 23 Passed, 1 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS2-a [cpu] | depth in the hollow at the end (m) | 0.1200 | 0.1200 | ± 0.0030 | Passed |
| SS2-a [cpu] | spilled over the rim (m³) | 0 | -0.0022 | ± 0.3000 | Passed |
| SS2-a [cpu] | surface books (relative) | 0 | -8.0e-16 | ± 1.0e-9 | Passed |
| SS2-a [gpu] | depth in the hollow at the end (m) | 0.1200 | 0.1200 | ± 0.0030 | Passed |
| SS2-a [gpu] | spilled over the rim (m³) | 0 | -0.0022 | ± 0.3000 | Passed |
| SS2-a [gpu] | surface books (relative) | 0 | -4.3e-7 | ± 1.0e-5 | Passed |
| SS2-b [cpu] | depth in the hollow at the end (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS2-b [cpu] | spilled over the rim (m³) | 12.000 | 11.993 | ± 0.3000 | Passed |
| SS2-b [cpu] | peak depth in the hollow (m) (reference: rim plus the head of frictionless critical flow) | 0.2065 | 0.2120 | ± 0.0080 | Passed |
| SS2-b [cpu] | surface books (relative) | 0 | 8.7e-15 | ± 1.0e-9 | Passed |
| SS2-b [gpu] | depth in the hollow at the end (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS2-b [gpu] | spilled over the rim (m³) | 12.000 | 11.994 | ± 0.3000 | Passed |
| SS2-b [gpu] | peak depth in the hollow (m) (reference: rim plus the head of frictionless critical flow) | 0.2065 | 0.2120 | ± 0.0080 | Passed |
| SS2-b [gpu] | surface books (relative) | 0 | 1.4e-5 | ± 1.0e-5 | **Failed** |
| SS2-c [cpu] | depth in the hollow at the end (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS2-c [cpu] | spilled over the rim (m³) | 44.000 | 43.993 | ± 0.8800 | Passed |
| SS2-c [cpu] | peak depth in the hollow (m) (reference: rim plus the head of frictionless critical flow) | 0.2103 | 0.2176 | ± 0.0080 | Passed |
| SS2-c [cpu] | surface books (relative) | 0 | -2.0e-15 | ± 1.0e-9 | Passed |
| SS2-c [gpu] | depth in the hollow at the end (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS2-c [gpu] | spilled over the rim (m³) | 44.000 | 43.994 | ± 0.8800 | Passed |
| SS2-c [gpu] | peak depth in the hollow (m) (reference: rim plus the head of frictionless critical flow) | 0.2103 | 0.2176 | ± 0.0080 | Passed |
| SS2-c [gpu] | surface books (relative) | 0 | 6.5e-6 | ± 1.0e-5 | Passed |
| SS2-c against SS2-b [cpu] | end depth, a storm twice as large less the smaller one (m) | 0 | 6.2e-8 | ± 0.0030 | Passed |
| SS2-c against SS2-b [gpu] | end depth, a storm twice as large less the smaller one (m) | 0 | 1.0e-7 | ± 0.0030 | Passed |

## PV-SS3  One inlet and one pipe; a synthetic network under storms beyond its design

Run `results/2026-11-17T21-56-34-566Z/`. 17 Failed, 43 Passed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS3-a [cpu] | pond level in the sag at 3600 s (m) | 0.1863 | 0.1251 | ± 0.0056 | **Failed** |
| SS3-a [cpu] | pond level in the sag at 7200 s (m) | 0.1987 | 0.1211 | ± 0.0060 | **Failed** |
| SS3-a [cpu] | pipe flow at 7200 s (m³/s) | 0.0222 | 0.0219 | ± 4.4e-4 | Passed |
| SS3-a [cpu] | water on the street at 1800 s (m³) | 4.814 | 5.278 | ± 0.2407 | **Failed** |
| SS3-a [cpu] | surface books (relative) | 0 | -4.1e-15 | ± 1.0e-9 | Passed |
| SS3-a [cpu] | SWMM continuity error (%) | 0 | 0.7720 | ± 0.5000 | **Failed** |
| SS3-a [gpu] | pond level in the sag at 3600 s (m) | 0.1863 | 0.1225 | ± 0.0056 | **Failed** |
| SS3-a [gpu] | pond level in the sag at 7200 s (m) | 0.1987 | 0.1275 | ± 0.0060 | **Failed** |
| SS3-a [gpu] | pipe flow at 7200 s (m³/s) | 0.0222 | 0.0222 | ± 4.4e-4 | Passed |
| SS3-a [gpu] | water on the street at 1800 s (m³) | 4.814 | 5.227 | ± 0.2407 | **Failed** |
| SS3-a [gpu] | surface books (relative) | 0 | -4.0e-7 | ± 1.0e-5 | Passed |
| SS3-a [gpu] | SWMM continuity error (%) | 0 | 0.7350 | ± 0.5000 | **Failed** |
| SS3-b [cpu] | pond level in the sag at 3600 s (m) | 0.1863 | 0.3926 | ± 0.0056 | **Failed** |
| SS3-b [cpu] | pond level in the sag at 7200 s (m) | 0.1987 | 0.5986 | ± 0.0060 | **Failed** |
| SS3-b [cpu] | pipe flow at 7200 s (m³/s) | 0.0222 | 0.0173 | ± 4.4e-4 | **Failed** |
| SS3-b [cpu] | water on the street at 1800 s (m³) | 4.814 | 11.397 | ± 0.2407 | **Failed** |
| SS3-b [cpu] | surface books (relative) | 0 | 1.9e-14 | ± 1.0e-9 | Passed |
| SS3-b [cpu] | SWMM continuity error (%) | 0 | 0.0140 | ± 0.5000 | Passed |
| SS3-b [gpu] | pond level in the sag at 3600 s (m) | 0.1863 | 0.3926 | ± 0.0056 | **Failed** |
| SS3-b [gpu] | pond level in the sag at 7200 s (m) | 0.1987 | 0.5986 | ± 0.0060 | **Failed** |
| SS3-b [gpu] | pipe flow at 7200 s (m³/s) | 0.0222 | 0.0173 | ± 4.4e-4 | **Failed** |
| SS3-b [gpu] | water on the street at 1800 s (m³) | 4.814 | 11.397 | ± 0.2407 | **Failed** |
| SS3-b [gpu] | surface books (relative) | 0 | 4.6e-7 | ± 1.0e-5 | Passed |
| SS3-b [gpu] | SWMM continuity error (%) | 0 | 0.0140 | ± 0.5000 | Passed |
| SS3-c [cpu] | depth at the grate at the end (m) (free outfall: the pipe carries the rain, the street stands at the grate's weir head) | 0.0293 | 0.0293 | ± 0.0059 | Passed |
| SS3-c [cpu] | surface books (relative) | 0 | -1.4e-14 | ± 1.0e-9 | Passed |
| SS3-c [cpu] | SWMM continuity error (%) | 0 | 0.1430 | ± 0.5000 | Passed |
| SS3-c [gpu] | depth at the grate at the end (m) (free outfall: the pipe carries the rain, the street stands at the grate's weir head) | 0.0293 | 0.0293 | ± 0.0059 | Passed |
| SS3-c [gpu] | surface books (relative) | 0 | 1.5e-5 | ± 1.0e-5 | **Failed** |
| SS3-c [gpu] | SWMM continuity error (%) | 0 | 0.1430 | ± 0.5000 | Passed |
| SS3-d [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0022 | ± 0.1000 | Passed |
| SS3-d [cpu] | surface books (relative) | 0 | -5.9e-15 | ± 1.0e-9 | Passed |
| SS3-d [cpu] | SWMM continuity error (%) | 0 | -0.0780 | ± 0.5000 | Passed |
| SS3-d [gpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0022 | ± 0.1000 | Passed |
| SS3-d [gpu] | surface books (relative) | 0 | 7.6e-7 | ± 1.0e-5 | Passed |
| SS3-d [gpu] | SWMM continuity error (%) | 0 | -0.0770 | ± 0.5000 | Passed |
| SS3-e [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0077 | ± 0.1000 | Passed |
| SS3-e [cpu] | surface books (relative) | 0 | -2.5e-15 | ± 1.0e-9 | Passed |
| SS3-e [cpu] | SWMM continuity error (%) | 0 | -0.0930 | ± 0.5000 | Passed |
| SS3-e [gpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0076 | ± 0.1000 | Passed |
| SS3-e [gpu] | surface books (relative) | 0 | 2.4e-7 | ± 1.0e-5 | Passed |
| SS3-e [gpu] | SWMM continuity error (%) | 0 | -0.0930 | ± 0.5000 | Passed |
| SS3-f [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0097 | ± 0.1000 | Passed |
| SS3-f [cpu] | surface books (relative) | 0 | -1.9e-14 | ± 1.0e-9 | Passed |
| SS3-f [cpu] | SWMM continuity error (%) | 0 | -0.1340 | ± 0.5000 | Passed |
| SS3-f [gpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | 0.0098 | ± 0.1000 | Passed |
| SS3-f [gpu] | surface books (relative) | 0 | 7.1e-8 | ± 1.0e-5 | Passed |
| SS3-f [gpu] | SWMM continuity error (%) | 0 | -0.1320 | ± 0.5000 | Passed |
| SS3-x2 [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | -0.0015 | ± 0.1000 | Passed |
| SS3-x2 [cpu] | surface books (relative) | 0 | -2.9e-15 | ± 1.0e-9 | Passed |
| SS3-x2 [cpu] | SWMM continuity error (%) | 0 | -0.4520 | ± 0.5000 | Passed |
| SS3-x2 [gpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J1) | 0 | -0.0015 | ± 0.1000 | Passed |
| SS3-x2 [gpu] | surface books (relative) | 0 | -5.0e-8 | ± 1.0e-5 | Passed |
| SS3-x2 [gpu] | SWMM continuity error (%) | 0 | -0.4520 | ± 0.5000 | Passed |
| SS3-x4 [cpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J0) | 0 | -0.0786 | ± 0.1000 | Passed |
| SS3-x4 [cpu] | surface books (relative) | 0 | 3.8e-15 | ± 1.0e-9 | Passed |
| SS3-x4 [cpu] | SWMM continuity error (%) | 0 | -0.0120 | ± 0.5000 | Passed |
| SS3-x4 [gpu] | highest manhole head above the friction grade line from the peak pipe flows (m) (one-sided bound; worst at J0) | 0 | -0.0786 | ± 0.1000 | Passed |
| SS3-x4 [gpu] | surface books (relative) | 0 | -8.6e-7 | ± 1.0e-5 | Passed |
| SS3-x4 [gpu] | SWMM continuity error (%) | 0 | -0.0120 | ± 0.5000 | Passed |

## PV-SS4  An outfall held under water

Run `results/2026-11-17T21-56-34-566Z/`. 22 Failed, 12 Passed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS4-a [cpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.1445 | ± 0.0050 | **Failed** |
| SS4-a [cpu] | water on the street at 3600 s (m³) | 4.500 | 4.281 | ± 0.2250 | Passed |
| SS4-a [cpu] | surface books (relative) | 0 | 3.3e-15 | ± 1.0e-9 | Passed |
| SS4-a [cpu] | SWMM continuity error (%) | 0 | 12.537 | ± 0.5000 | **Failed** |
| SS4-a [gpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.1465 | ± 0.0050 | Passed |
| SS4-a [gpu] | water on the street at 3600 s (m³) | 4.500 | 4.361 | ± 0.2250 | Passed |
| SS4-a [gpu] | surface books (relative) | 0 | 1.9e-5 | ± 1.0e-5 | **Failed** |
| SS4-a [gpu] | SWMM continuity error (%) | 0 | 19.542 | ± 0.5000 | **Failed** |
| SS4-b [cpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.1401 | ± 0.0050 | **Failed** |
| SS4-b [cpu] | water on the street at 3600 s (m³) | 4.500 | 4.065 | ± 0.2250 | **Failed** |
| SS4-b [cpu] | surface books (relative) | 0 | -3.3e-15 | ± 1.0e-9 | Passed |
| SS4-b [cpu] | SWMM continuity error (%) | 0 | 10.078 | ± 0.5000 | **Failed** |
| SS4-b [gpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.1338 | ± 0.0050 | **Failed** |
| SS4-b [gpu] | water on the street at 3600 s (m³) | 4.500 | 3.886 | ± 0.2250 | **Failed** |
| SS4-b [gpu] | surface books (relative) | 0 | -7.5e-7 | ± 1.0e-5 | Passed |
| SS4-b [gpu] | SWMM continuity error (%) | 0 | 9.617 | ± 0.5000 | **Failed** |
| SS4-c [cpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.7260 | ± 0.0050 | **Failed** |
| SS4-c [cpu] | water on the street at 3600 s (m³) | 4.500 | 49.645 | ± 0.2250 | **Failed** |
| SS4-c [cpu] | surface books (relative) | 0 | -1.6e-15 | ± 1.0e-9 | Passed |
| SS4-c [cpu] | SWMM continuity error (%) | 0 | 0.0960 | ± 0.5000 | Passed |
| SS4-c [gpu] | street level in the sag at 3600 s (m) | 0.1500 | 0.7260 | ± 0.0050 | **Failed** |
| SS4-c [gpu] | water on the street at 3600 s (m³) | 4.500 | 49.645 | ± 0.2250 | **Failed** |
| SS4-c [gpu] | surface books (relative) | 0 | -1.8e-7 | ± 1.0e-5 | Passed |
| SS4-c [gpu] | SWMM continuity error (%) | 0 | 0.0960 | ± 0.5000 | Passed |
| SS4-d [cpu] | pond level in the sag at 3600 s (m) | 0.4862 | 0.4284 | ± 0.0146 | **Failed** |
| SS4-d [cpu] | pond level in the sag at 7200 s (m) | 0.5466 | 0.4705 | ± 0.0164 | **Failed** |
| SS4-d [cpu] | pipe flow at 7200 s (m³/s) | 0.0214 | 0.0222 | ± 4.3e-4 | **Failed** |
| SS4-d [cpu] | surface books (relative) | 0 | 7.3e-16 | ± 1.0e-9 | Passed |
| SS4-d [cpu] | SWMM continuity error (%) | 0 | 1.150 | ± 0.5000 | **Failed** |
| SS4-d [gpu] | pond level in the sag at 3600 s (m) | 0.4862 | 0.4328 | ± 0.0146 | **Failed** |
| SS4-d [gpu] | pond level in the sag at 7200 s (m) | 0.5466 | 0.4708 | ± 0.0164 | **Failed** |
| SS4-d [gpu] | pipe flow at 7200 s (m³/s) | 0.0214 | 0.0223 | ± 4.3e-4 | **Failed** |
| SS4-d [gpu] | surface books (relative) | 0 | -4.9e-7 | ± 1.0e-5 | Passed |
| SS4-d [gpu] | SWMM continuity error (%) | 0 | 1.158 | ± 0.5000 | **Failed** |

## PV-SS5  The same block in a small box and a large one

Run `results/2026-11-17T21-56-34-566Z/`. 16 Passed, 2 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS5-up-large [cpu] | depth at the block against the true depth (m) | 0.0101 | 0.0101 | ± 5.1e-4 | Passed |
| SS5-up-large [gpu] | depth at the block against the true depth (m) | 0.0101 | 0.0101 | ± 5.1e-4 | Passed |
| SS5-up-small [cpu] | depth at the block against this box's own slope length (m) | 0.0039 | 0.0038 | ± 5.0e-4 | Passed |
| SS5-up-small [cpu] | depth at the block against the true depth (m) (the box is cut below the divide) | 0.0101 | 0.0038 | ± 0.0050 | **Failed** |
| SS5-up-small [gpu] | depth at the block against this box's own slope length (m) | 0.0039 | 0.0038 | ± 5.0e-4 | Passed |
| SS5-up-small [gpu] | depth at the block against the true depth (m) (the box is cut below the divide) | 0.0101 | 0.0038 | ± 0.0050 | **Failed** |
| SS5-down-large [cpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS5-down-large [cpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2119 | ± 0.0080 | Passed |
| SS5-down-large [gpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2000 | ± 0.0030 | Passed |
| SS5-down-large [gpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2119 | ± 0.0080 | Passed |
| SS5-down-ok [cpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2000 | ± 0.0200 | Passed |
| SS5-down-ok [cpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2119 | ± 0.0206 | Passed |
| SS5-down-ok [gpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2000 | ± 0.0200 | Passed |
| SS5-down-ok [gpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2119 | ± 0.0206 | Passed |
| SS5-down-small [cpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2094 | ± 0.0200 | Passed |
| SS5-down-small [cpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2094 | ± 0.0206 | Passed |
| SS5-down-small [gpu] | depth at the block at the end against the true depth (m) | 0.2000 | 0.2094 | ± 0.0200 | Passed |
| SS5-down-small [gpu] | peak depth at the block against the true peak (m) | 0.2065 | 0.2094 | ± 0.0206 | Passed |

## PV-SS6  Cell size: a driveway dip and a rear yard

Run `results/2026-11-17T21-56-34-566Z/`. 33 Passed, 11 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS6-drive-1 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.8015 | ± 0.0802 | Passed |
| SS6-drive-1 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.8017 | 0.8015 | ± 0.0100 | Passed |
| SS6-drive-1 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.8015 | ± 0.0802 | Passed |
| SS6-drive-1 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.8017 | 0.8015 | ± 0.0100 | Passed |
| SS6-drive-2 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.3632 | ± 0.0802 | **Failed** |
| SS6-drive-2 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0.8017 | 0.8182 | ± 0.0802 | Passed |
| SS6-drive-2 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.3633 | 0.3632 | ± 0.0100 | Passed |
| SS6-drive-2 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.3632 | ± 0.0802 | **Failed** |
| SS6-drive-2 [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0.8017 | 0.8182 | ± 0.0802 | Passed |
| SS6-drive-2 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.3633 | 0.3632 | ± 0.0100 | Passed |
| SS6-drive-4 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.1456 | ± 0.0802 | **Failed** |
| SS6-drive-4 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0.8017 | 0.8431 | ± 0.0802 | Passed |
| SS6-drive-4 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.1456 | 0.1456 | ± 0.0100 | Passed |
| SS6-drive-4 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8017 | 0.1456 | ± 0.0802 | **Failed** |
| SS6-drive-4 [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0.8017 | 0.8431 | ± 0.0802 | Passed |
| SS6-drive-4 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.1456 | 0.1456 | ± 0.0100 | Passed |
| SS6-drive-05 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8392 | 0.8390 | ± 0.0839 | Passed |
| SS6-drive-05 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.8392 | 0.8390 | ± 0.0100 | Passed |
| SS6-drive-05 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0.8392 | 0.8390 | ± 0.0839 | Passed |
| SS6-drive-05 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.8392 | 0.8390 | ± 0.0100 | Passed |
| SS6-drive-4s [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the subgrid tables' 1 m depth) | 0.8017 | 0.7067 | ± 0.0802 | **Failed** |
| SS6-drive-8s [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the subgrid tables' 1 m depth) | 0.8017 | 0.6144 | ± 0.0802 | **Failed** |
| SS6-yard-1 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 1.0e-5 | ± 0.0200 | Passed |
| SS6-yard-1 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS6-yard-1 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 1.0e-5 | ± 0.0200 | Passed |
| SS6-yard-1 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS6-yard-2 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 0.1072 | ± 0.0200 | **Failed** |
| SS6-yard-2 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0 | 0.1159 | ± 0.0200 | **Failed** |
| SS6-yard-2 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.1072 | 0.1072 | ± 0.0100 | Passed |
| SS6-yard-2 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 0.1072 | ± 0.0200 | **Failed** |
| SS6-yard-2 [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0 | 0.1159 | ± 0.0200 | **Failed** |
| SS6-yard-2 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0.1072 | 0.1072 | ± 0.0100 | Passed |
| SS6-yard-4 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 2.0e-5 | ± 0.0200 | Passed |
| SS6-yard-4 [cpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0 | 0 | ± 0.0200 | Passed |
| SS6-yard-4 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 2.0e-5 | ± 0.0100 | Passed |
| SS6-yard-4 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 2.0e-5 | ± 0.0200 | Passed |
| SS6-yard-4 [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the app's downscaling) | 0 | 0 | ± 0.0200 | Passed |
| SS6-yard-4 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 2.0e-5 | ± 0.0100 | Passed |
| SS6-yard-05 [cpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 1.0e-5 | ± 0.0200 | Passed |
| SS6-yard-05 [cpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS6-yard-05 [gpu] | depth beside the house at the end, solver cells, against the true depth (m) (resolution: the solver's own cells) | 0 | 1.0e-5 | ± 0.0200 | Passed |
| SS6-yard-05 [gpu] | depth beside the house at the end against this grid's own arithmetic (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS6-yard-4s [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the subgrid tables' 1 m depth) | 0 | 0.0100 | ± 0.0200 | Passed |
| SS6-yard-8s [gpu] | depth beside the house at the end, on the 1 m map, against the true depth (m) (the subgrid tables' 1 m depth) | 0 | 0.0300 | ± 0.0200 | **Failed** |

## PV-SS7  The wall-exposure rule

Run `results/2026-11-17T21-56-34-566Z/`. 16 Passed, 1 Failed.

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

Run `results/2026-11-17T21-56-34-566Z/`. 22 Passed, 10 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS8-none-10 [cpu] | pond depth at the sag at the end (m) | 0.4853 | 0.4853 | ± 0.0100 | Passed |
| SS8-none-10 [cpu] | surface books (relative) | 0 | -6.3e-15 | ± 1.0e-9 | Passed |
| SS8-none-10 [gpu] | pond depth at the sag at the end (m) | 0.4853 | 0.4853 | ± 0.0100 | Passed |
| SS8-none-10 [gpu] | surface books (relative) | 0 | -2.1e-6 | ± 1.0e-5 | Passed |
| SS8-none-100 [cpu] | pond depth at the sag at the end (m) | 0.5715 | 0.5715 | ± 0.0100 | Passed |
| SS8-none-100 [cpu] | surface books (relative) | 0 | -2.8e-15 | ± 1.0e-9 | Passed |
| SS8-none-100 [gpu] | pond depth at the sag at the end (m) | 0.5715 | 0.5715 | ± 0.0100 | Passed |
| SS8-none-100 [gpu] | surface books (relative) | 0 | -4.7e-7 | ± 1.0e-5 | Passed |
| SS8-none-500 [cpu] | pond depth at the sag at the end (m) | 0.6268 | 0.6268 | ± 0.0100 | Passed |
| SS8-none-500 [cpu] | surface books (relative) | 0 | -7.8e-15 | ± 1.0e-9 | Passed |
| SS8-none-500 [gpu] | pond depth at the sag at the end (m) | 0.6268 | 0.6268 | ± 0.0100 | Passed |
| SS8-none-500 [gpu] | surface books (relative) | 0 | 1.1e-7 | ± 1.0e-5 | Passed |
| SS8-lump30-10 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 296.4 | 343.5 | ± 5.927 | **Failed** |
| SS8-lump30-10 [cpu] | surface books (relative) | 0 | -1.3e-14 | ± 1.0e-9 | Passed |
| SS8-lump30-10 [gpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 296.4 | 343.5 | ± 5.927 | **Failed** |
| SS8-lump30-10 [gpu] | surface books (relative) | 0 | -5.0e-7 | ± 1.0e-5 | Passed |
| SS8-lump30-100 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 615.3 | 679.8 | ± 12.306 | **Failed** |
| SS8-lump30-100 [cpu] | surface books (relative) | 0 | -2.8e-15 | ± 1.0e-9 | Passed |
| SS8-lump30-100 [gpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 615.3 | 679.8 | ± 12.306 | **Failed** |
| SS8-lump30-100 [gpu] | surface books (relative) | 0 | -1.4e-7 | ± 1.0e-5 | Passed |
| SS8-lump30-500 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 921.6 | 975.4 | ± 18.432 | **Failed** |
| SS8-lump30-500 [cpu] | surface books (relative) | 0 | 1.7e-15 | ± 1.0e-9 | Passed |
| SS8-lump30-500 [gpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 921.6 | 975.4 | ± 18.432 | **Failed** |
| SS8-lump30-500 [gpu] | surface books (relative) | 0 | 1.9e-7 | ± 1.0e-5 | Passed |
| SS8-lump50-100 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 461.9 | 536.4 | ± 9.238 | **Failed** |
| SS8-lump50-100 [cpu] | surface books (relative) | 0 | -8.8e-15 | ± 1.0e-9 | Passed |
| SS8-lump50-100 [gpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 461.9 | 536.4 | ± 9.238 | **Failed** |
| SS8-lump50-100 [gpu] | surface books (relative) | 0 | -4.7e-7 | ± 1.0e-5 | Passed |
| SS8-lump50-500 [cpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 708.1 | 806.0 | ± 14.161 | **Failed** |
| SS8-lump50-500 [cpu] | surface books (relative) | 0 | -1.2e-14 | ± 1.0e-9 | Passed |
| SS8-lump50-500 [gpu] | highest volume on the ground against its upper bound (m³) (one-sided bound: Σ max(0, i − allowance) Δt × area) | 708.1 | 806.0 | ± 14.161 | **Failed** |
| SS8-lump50-500 [gpu] | surface books (relative) | 0 | -4.1e-7 | ± 1.0e-5 | Passed |

## PV-SS9  Coarse run then downscale: do a kerb, a crown and a small hollow survive?

Run `results/2026-11-17T21-56-34-566Z/`. 27 Passed, 12 Not independently validated, 11 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS9-2 [cpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5716 | ± 0.0100 | Passed |
| SS9-2 [cpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 3.8e-4 | ± 0.0500 | **Not independently validated** |
| SS9-2 [cpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: inside) | 1.000 | 1.000 | ± 0.1000 | **Not independently validated** |
| SS9-2 [gpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5716 | ± 0.0100 | Passed |
| SS9-2 [gpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 3.8e-4 | ± 0.0500 | **Not independently validated** |
| SS9-2 [gpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: inside) | 1.000 | 1.000 | ± 0.1000 | **Not independently validated** |
| SS9-4 [cpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5781 | ± 0.0100 | Passed |
| SS9-4 [cpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 0.0466 | ± 0.0500 | **Not independently validated** |
| SS9-4 [cpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: outside) | 1.000 | 0.8571 | ± 0.1000 | **Not independently validated** |
| SS9-4 [gpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5781 | ± 0.0100 | Passed |
| SS9-4 [gpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 0.0466 | ± 0.0500 | **Not independently validated** |
| SS9-4 [gpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: outside) | 1.000 | 0.8571 | ± 0.1000 | **Not independently validated** |
| SS9-4s [gpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5707 | ± 0.0100 | Passed |
| SS9-4s [gpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 0.0027 | ± 0.0500 | **Not independently validated** |
| SS9-4s [gpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: inside) | 1.000 | 1.000 | ± 0.1000 | **Not independently validated** |
| SS9-8s [gpu] | pond depth at the sag at the end, on the 1 m map (m) | 0.5715 | 0.5707 | ± 0.0100 | Passed |
| SS9-8s [gpu] | peak wall depth at the houses against the 1 m run, root mean square (m) (the reference is the same solver at 1 m; limit 0.05 m: inside) | 0 | 0.0113 | ± 0.0500 | **Not independently validated** |
| SS9-8s [gpu] | houses given the same exposed / not exposed answer as the 1 m run (share) (the reference is the same solver at 1 m; limit 0.9: inside) | 1.000 | 1.000 | ± 0.1000 | **Not independently validated** |
| SS9-kerb-1 [cpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0490 | ± 0.0200 | Passed |
| SS9-kerb-1 [cpu] | kerb: depth on the lot behind the kerb (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS9-kerb-1 [cpu] | crown: depth in the far gutter (m) | 0 | 0.0028 | ± 0.0100 | Passed |
| SS9-kerb-1 [gpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0490 | ± 0.0200 | Passed |
| SS9-kerb-1 [gpu] | kerb: depth on the lot behind the kerb (m) | 0 | 1.0e-5 | ± 0.0100 | Passed |
| SS9-kerb-1 [gpu] | crown: depth in the far gutter (m) | 0 | 0.0028 | ± 0.0100 | Passed |
| SS9-hollow-1 [cpu] | hollow: depth of water in it (m) | 0.0978 | 0.0976 | ± 0.0200 | Passed |
| SS9-hollow-1 [gpu] | hollow: depth of water in it (m) | 0.0978 | 0.0976 | ± 0.0200 | Passed |
| SS9-kerb-2 [cpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0600 | ± 0.0200 | Passed |
| SS9-kerb-2 [cpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-2 [cpu] | crown: depth in the far gutter (m) | 0 | 0.0449 | ± 0.0100 | **Failed** |
| SS9-kerb-2 [gpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0600 | ± 0.0200 | Passed |
| SS9-kerb-2 [gpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-2 [gpu] | crown: depth in the far gutter (m) | 0 | 0.0449 | ± 0.0100 | **Failed** |
| SS9-hollow-2 [cpu] | hollow: depth of water in it (m) | 0.0978 | 0.1200 | ± 0.0200 | **Failed** |
| SS9-hollow-2 [gpu] | hollow: depth of water in it (m) | 0.0978 | 0.1200 | ± 0.0200 | **Failed** |
| SS9-kerb-4 [cpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0600 | ± 0.0200 | Passed |
| SS9-kerb-4 [cpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-4 [cpu] | crown: depth in the far gutter (m) | 0 | 0.0600 | ± 0.0100 | **Failed** |
| SS9-kerb-4 [gpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0600 | ± 0.0200 | Passed |
| SS9-kerb-4 [gpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-4 [gpu] | crown: depth in the far gutter (m) | 0 | 0.0600 | ± 0.0100 | **Failed** |
| SS9-hollow-4 [cpu] | hollow: depth of water in it (m) | 0.0978 | 0 | ± 0.0200 | **Failed** |
| SS9-hollow-4 [gpu] | hollow: depth of water in it (m) | 0.0978 | 0 | ± 0.0200 | **Failed** |
| SS9-kerb-4s [gpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0400 | ± 0.0200 | Passed |
| SS9-kerb-4s [gpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-4s [gpu] | crown: depth in the far gutter (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-hollow-4s [gpu] | hollow: depth of water in it (m) | 0.0978 | 0.0690 | ± 0.0200 | **Failed** |
| SS9-kerb-8s [gpu] | kerb: depth in the gutter the rain fell beside (m) | 0.0500 | 0.0467 | ± 0.0200 | Passed |
| SS9-kerb-8s [gpu] | kerb: depth on the lot behind the kerb (m) | 0 | 0 | ± 0.0100 | Passed |
| SS9-kerb-8s [gpu] | crown: depth in the far gutter (m) | 0 | 0.0100 | ± 0.0100 | **Failed** |
| SS9-hollow-8s [gpu] | hollow: depth of water in it (m) | 0.0978 | 0.0709 | ± 0.0200 | **Failed** |

## PV-SS10  Street-to-sewer exchange against laboratory measurements

Run `results/2026-11-17T21-56-34-566Z/`. 15 Failed.

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

Run `results/2026-11-17T21-56-34-566Z/`. 22 Passed, 52 Failed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS11-sagA-10-pipe [cpu] | peak depth at the grate (m) (pipe) | 0.0264 | 0.0264 | ± 0.0200 | Passed |
| SS11-sagA-10-pipe [gpu] | peak depth at the grate (m) (pipe) | 0.0264 | 0.0263 | ± 0.0200 | Passed |
| SS11-sagA-10-none [cpu] | peak depth at the grate (m) (surface only) | 0.0264 | 0.4169 | ± 0.0200 | **Failed** |
| SS11-sagA-10-none [gpu] | peak depth at the grate (m) (surface only) | 0.0264 | 0.4169 | ± 0.0200 | **Failed** |
| SS11-sagA-10-lump30 [cpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0264 | 0.2541 | ± 0.0200 | **Failed** |
| SS11-sagA-10-lump30 [gpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0264 | 0.2541 | ± 0.0200 | **Failed** |
| SS11-sagA-10-lump50 [cpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0264 | 0.1878 | ± 0.0200 | **Failed** |
| SS11-sagA-10-lump50 [gpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0264 | 0.1878 | ± 0.0200 | **Failed** |
| SS11-sagA-100-pipe [cpu] | peak depth at the grate (m) (pipe) | 0.0362 | 0.0362 | ± 0.0200 | Passed |
| SS11-sagA-100-pipe [gpu] | peak depth at the grate (m) (pipe) | 0.0362 | 0.0362 | ± 0.0200 | Passed |
| SS11-sagA-100-none [cpu] | peak depth at the grate (m) (surface only) | 0.0362 | 0.5582 | ± 0.0200 | **Failed** |
| SS11-sagA-100-none [gpu] | peak depth at the grate (m) (surface only) | 0.0362 | 0.5582 | ± 0.0200 | **Failed** |
| SS11-sagA-100-lump30 [cpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0362 | 0.4151 | ± 0.0200 | **Failed** |
| SS11-sagA-100-lump30 [gpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0362 | 0.4152 | ± 0.0200 | **Failed** |
| SS11-sagA-100-lump50 [cpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0362 | 0.3434 | ± 0.0200 | **Failed** |
| SS11-sagA-100-lump50 [gpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0362 | 0.3434 | ± 0.0200 | **Failed** |
| SS11-sagA-500-pipe [cpu] | peak depth at the grate (m) (pipe) | 0.0434 | 0.0433 | ± 0.0200 | Passed |
| SS11-sagA-500-pipe [gpu] | peak depth at the grate (m) (pipe) | 0.0434 | 0.0434 | ± 0.0200 | Passed |
| SS11-sagA-500-none [cpu] | peak depth at the grate (m) (surface only) | 0.0434 | 0.6572 | ± 0.0200 | **Failed** |
| SS11-sagA-500-none [gpu] | peak depth at the grate (m) (surface only) | 0.0434 | 0.6572 | ± 0.0200 | **Failed** |
| SS11-sagA-500-lump30 [cpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0434 | 0.5335 | ± 0.0200 | **Failed** |
| SS11-sagA-500-lump30 [gpu] | peak depth at the grate (m) (allowance 30 mm/h) | 0.0434 | 0.5335 | ± 0.0200 | **Failed** |
| SS11-sagA-500-lump50 [cpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0434 | 0.4542 | ± 0.0200 | **Failed** |
| SS11-sagA-500-lump50 [gpu] | peak depth at the grate (m) (allowance 50 mm/h) | 0.0434 | 0.4542 | ± 0.0200 | **Failed** |
| SS11-sagB-10-pipe [cpu] | peak pond level in the sag (m) (pipe) | 0.0426 | 0.0394 | ± 0.0200 | Passed |
| SS11-sagB-10-pipe [gpu] | peak pond level in the sag (m) (pipe) | 0.0426 | 0.0399 | ± 0.0200 | Passed |
| SS11-sagB-10-none [cpu] | peak pond level in the sag (m) (surface only) | 0.0426 | 0.4169 | ± 0.0200 | **Failed** |
| SS11-sagB-10-none [gpu] | peak pond level in the sag (m) (surface only) | 0.0426 | 0.4169 | ± 0.0200 | **Failed** |
| SS11-sagB-10-lump30 [cpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.0426 | 0.2541 | ± 0.0200 | **Failed** |
| SS11-sagB-10-lump30 [gpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.0426 | 0.2541 | ± 0.0200 | **Failed** |
| SS11-sagB-10-lump50 [cpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.0426 | 0.1878 | ± 0.0200 | **Failed** |
| SS11-sagB-10-lump50 [gpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.0426 | 0.1878 | ± 0.0200 | **Failed** |
| SS11-sagB-100-pipe [cpu] | peak pond level in the sag (m) (pipe) | 0.1347 | 0.1154 | ± 0.0269 | Passed |
| SS11-sagB-100-pipe [gpu] | peak pond level in the sag (m) (pipe) | 0.1347 | 0.1147 | ± 0.0269 | Passed |
| SS11-sagB-100-none [cpu] | peak pond level in the sag (m) (surface only) | 0.1347 | 0.5582 | ± 0.0269 | **Failed** |
| SS11-sagB-100-none [gpu] | peak pond level in the sag (m) (surface only) | 0.1347 | 0.5582 | ± 0.0269 | **Failed** |
| SS11-sagB-100-lump30 [cpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.1347 | 0.4151 | ± 0.0269 | **Failed** |
| SS11-sagB-100-lump30 [gpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.1347 | 0.4152 | ± 0.0269 | **Failed** |
| SS11-sagB-100-lump50 [cpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.1347 | 0.3434 | ± 0.0269 | **Failed** |
| SS11-sagB-100-lump50 [gpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.1347 | 0.3434 | ± 0.0269 | **Failed** |
| SS11-sagB-500-pipe [cpu] | peak pond level in the sag (m) (pipe) | 0.2049 | 0.1883 | ± 0.0410 | Passed |
| SS11-sagB-500-pipe [gpu] | peak pond level in the sag (m) (pipe) | 0.2049 | 0.1868 | ± 0.0410 | Passed |
| SS11-sagB-500-none [cpu] | peak pond level in the sag (m) (surface only) | 0.2049 | 0.6572 | ± 0.0410 | **Failed** |
| SS11-sagB-500-none [gpu] | peak pond level in the sag (m) (surface only) | 0.2049 | 0.6572 | ± 0.0410 | **Failed** |
| SS11-sagB-500-lump30 [cpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.2049 | 0.5335 | ± 0.0410 | **Failed** |
| SS11-sagB-500-lump30 [gpu] | peak pond level in the sag (m) (allowance 30 mm/h) | 0.2049 | 0.5335 | ± 0.0410 | **Failed** |
| SS11-sagB-500-lump50 [cpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.2049 | 0.4542 | ± 0.0410 | **Failed** |
| SS11-sagB-500-lump50 [gpu] | peak pond level in the sag (m) (allowance 50 mm/h) | 0.2049 | 0.4542 | ± 0.0410 | **Failed** |
| SS11-hollow-10-none [cpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2000 | ± 0.0200 | Passed |
| SS11-hollow-10-none [gpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2000 | ± 0.0200 | Passed |
| SS11-hollow-10-lump30 [cpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.0642 | ± 0.0200 | **Failed** |
| SS11-hollow-10-lump30 [gpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.0642 | ± 0.0200 | **Failed** |
| SS11-hollow-10-lump50 [cpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.0072 | ± 0.0200 | **Failed** |
| SS11-hollow-10-lump50 [gpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.0072 | ± 0.0200 | **Failed** |
| SS11-hollow-100-none [cpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2001 | ± 0.0200 | Passed |
| SS11-hollow-100-none [gpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2001 | ± 0.0200 | Passed |
| SS11-hollow-100-lump30 [cpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.1693 | ± 0.0200 | **Failed** |
| SS11-hollow-100-lump30 [gpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.1693 | ± 0.0200 | **Failed** |
| SS11-hollow-100-lump50 [cpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.0966 | ± 0.0200 | **Failed** |
| SS11-hollow-100-lump50 [gpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.0966 | ± 0.0200 | **Failed** |
| SS11-hollow-500-none [cpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2001 | ± 0.0200 | Passed |
| SS11-hollow-500-none [gpu] | depth in the hollow at the end (m) (surface only) | 0.2000 | 0.2001 | ± 0.0200 | Passed |
| SS11-hollow-500-lump30 [cpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.1728 | ± 0.0200 | **Failed** |
| SS11-hollow-500-lump30 [gpu] | depth in the hollow at the end (m) (allowance 30 mm/h) | 0.2000 | 0.1728 | ± 0.0200 | **Failed** |
| SS11-hollow-500-lump50 [cpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.1509 | ± 0.0200 | **Failed** |
| SS11-hollow-500-lump50 [gpu] | depth in the hollow at the end (m) (allowance 50 mm/h) | 0.2000 | 0.1509 | ± 0.0200 | **Failed** |
| SS11-hill-pipe [cpu] | depth in the kerb cell 40 m below the grate (m) (pipe) | 0.0168 | 0.0219 | ± 0.0050 | **Failed** |
| SS11-hill-pipe [gpu] | depth in the kerb cell 40 m below the grate (m) (pipe) | 0.0168 | 0.0219 | ± 0.0050 | **Failed** |
| SS11-hill-none [cpu] | depth in the kerb cell 40 m below the grate (m) (surface only) | 0.0168 | 0.0246 | ± 0.0050 | **Failed** |
| SS11-hill-none [gpu] | depth in the kerb cell 40 m below the grate (m) (surface only) | 0.0168 | 0.0246 | ± 0.0050 | **Failed** |
| SS11-hill-lump30 [cpu] | depth in the kerb cell 40 m below the grate (m) (allowance 30 mm/h) | 0.0168 | 0.0204 | ± 0.0050 | Passed |
| SS11-hill-lump30 [gpu] | depth in the kerb cell 40 m below the grate (m) (allowance 30 mm/h) | 0.0168 | 0.0204 | ± 0.0050 | Passed |
| SS11-hill-lump50 [cpu] | depth in the kerb cell 40 m below the grate (m) (allowance 50 mm/h) | 0.0168 | 0.0168 | ± 0.0050 | Passed |
| SS11-hill-lump50 [gpu] | depth in the kerb cell 40 m below the grate (m) (allowance 50 mm/h) | 0.0168 | 0.0169 | ± 0.0050 | Passed |

## PV-SS12  Measures one owner can take

Run `results/2026-11-17T21-56-34-566Z/`. 20 Passed, 4 Unsupported.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS12-garden-under [cpu] | water left on the ground at the end (m³) | 0 | 9.6e-4 | ± 0.0300 | Passed |
| SS12-garden-under [cpu] | water the measure took (m³) | 1.000 | 0.9990 | ± 0.0300 | Passed |
| SS12-garden-under [gpu] | water left on the ground at the end (m³) | 0 | 9.6e-4 | ± 0.0300 | Passed |
| SS12-garden-under [gpu] | water the measure took (m³) | 1.000 | 0.9990 | ± 0.0300 | Passed |
| SS12-garden-over [cpu] | water left on the ground at the end (m³) | 1.752 | 1.752 | ± 0.0526 | Passed |
| SS12-garden-over [cpu] | water the measure took (m³) | 1.248 | 1.248 | ± 0.0374 | Passed |
| SS12-garden-over [gpu] | water left on the ground at the end (m³) | 1.752 | 1.753 | ± 0.0526 | Passed |
| SS12-garden-over [gpu] | water the measure took (m³) | 1.248 | 1.247 | ± 0.0374 | Passed |
| SS12-paving [cpu] | water left on the ground at the end (m³) | 0.9600 | 0.9600 | ± 0.0288 | Passed |
| SS12-paving [cpu] | water the measure took (m³) | 2.040 | 2.040 | ± 0.0612 | Passed |
| SS12-paving [gpu] | water left on the ground at the end (m³) | 0.9600 | 0.9605 | ± 0.0288 | Passed |
| SS12-paving [gpu] | water the measure took (m³) | 2.040 | 2.039 | ± 0.0612 | Passed |
| SS12-soil [cpu] | water left on the ground at the end (m³) | 2.600 | 2.600 | ± 0.0780 | Passed |
| SS12-soil [cpu] | water the measure took (m³) | 0.4000 | 0.4000 | ± 0.0120 | Passed |
| SS12-soil [gpu] | water left on the ground at the end (m³) | 2.600 | 2.600 | ± 0.0780 | Passed |
| SS12-soil [gpu] | water the measure took (m³) | 0.4000 | 0.4000 | ± 0.0120 | Passed |
| SS12-roof-open [cpu] | water on the ground at the end (m³) (the roof sheds onto the ground (control)) | 3.000 | 3.000 | ± 0.0030 | Passed |
| SS12-roof-open [gpu] | water on the ground at the end (m³) (the roof sheds onto the ground (control)) | 3.000 | 3.000 | ± 0.0030 | Passed |
| SS12-roof-held [cpu] | water on the ground at the end (m³) (the roof holds its rain) | 2.520 | 2.520 | ± 0.0025 | Passed |
| SS12-roof-held [gpu] | water on the ground at the end (m³) (the roof holds its rain) | 2.520 | 2.520 | ± 0.0025 | Passed |
| A rain barrel or cistern on an existing house | no control: a cistern exists only for a building drawn in site design (src/design.js roof 'cistern'), and its filling and overflow are timed in app/map.js (roofHoldStages), which a headless run of src/ does not reach. SS12-roof-held tests only that a held roof sheds nothing | – | – | – | **Unsupported** |
| A French drain | no control: the nearest thing is a rain garden's underdrain to a sewer manhole (src/stormwater.js UnderdrainLinks, GPU kernel only). A trench drain to daylight or to a dry well is not represented | – | – | – | **Unsupported** |
| Removing paving (bare soil in its place) as a what-if | no control: site design can add paving or permeable paving but cannot turn paving into soil. SS12-soil tests the solver's infiltration at a soil's rate, which is what such a control would use | – | – | – | **Unsupported** |
| A green roof on an existing house | area-wide only (a share of all roofs holds the first 25 mm), timed in app/map.js; not one owner's roof | – | – | – | **Unsupported** |

## PV-SS13  A grate in a gutter on a grade

Run `results/2026-11-17T21-56-34-566Z/`. 18 Failed, 18 Passed.

| Case | Quantity | Expected | Measured | Limit | Status |
|---|---|---|---|---|---|
| SS13-s1-r50 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.78) | 0.8802 | 0.3992 | ± 0.1000 | **Failed** |
| SS13-s1-r50 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0173 | 0.0179 | ± 0.0020 | Passed |
| SS13-s1-r50 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.78) | 0.8802 | 0.3992 | ± 0.1000 | **Failed** |
| SS13-s1-r50 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0173 | 0.0179 | ± 0.0020 | Passed |
| SS13-s1-r100 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.66) | 0.7910 | 0.3650 | ± 0.1000 | **Failed** |
| SS13-s1-r100 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0254 | 0.0261 | ± 0.0025 | Passed |
| SS13-s1-r100 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.66) | 0.7910 | 0.3650 | ± 0.1000 | **Failed** |
| SS13-s1-r100 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0254 | 0.0261 | ± 0.0025 | Passed |
| SS13-s1-r200 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.54) | 0.6893 | 0.3124 | ± 0.1000 | **Failed** |
| SS13-s1-r200 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0359 | 0.0366 | ± 0.0036 | Passed |
| SS13-s1-r200 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.54) | 0.6893 | 0.3124 | ± 0.1000 | **Failed** |
| SS13-s1-r200 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0359 | 0.0366 | ± 0.0036 | Passed |
| SS13-s2-r50 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.83) | 0.8918 | 0.3678 | ± 0.1000 | **Failed** |
| SS13-s2-r50 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0140 | 0.0144 | ± 0.0020 | Passed |
| SS13-s2-r50 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.83) | 0.8918 | 0.3678 | ± 0.1000 | **Failed** |
| SS13-s2-r50 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0140 | 0.0144 | ± 0.0020 | Passed |
| SS13-s2-r100 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.72) | 0.7976 | 0.3358 | ± 0.1000 | **Failed** |
| SS13-s2-r100 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0211 | 0.0215 | ± 0.0021 | Passed |
| SS13-s2-r100 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.72) | 0.7976 | 0.3358 | ± 0.1000 | **Failed** |
| SS13-s2-r100 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0211 | 0.0215 | ± 0.0021 | Passed |
| SS13-s2-r200 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.60) | 0.6904 | 0.2900 | ± 0.1000 | **Failed** |
| SS13-s2-r200 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0303 | 0.0305 | ± 0.0030 | Passed |
| SS13-s2-r200 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.60) | 0.6904 | 0.2900 | ± 0.1000 | **Failed** |
| SS13-s2-r200 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0303 | 0.0305 | ± 0.0030 | Passed |
| SS13-s4-r50 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.89) | 0.9146 | 0.3245 | ± 0.1000 | **Failed** |
| SS13-s4-r50 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0110 | 0.0116 | ± 0.0020 | Passed |
| SS13-s4-r50 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.89) | 0.9146 | 0.3239 | ± 0.1000 | **Failed** |
| SS13-s4-r50 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0110 | 0.0115 | ± 0.0020 | Passed |
| SS13-s4-r100 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.78) | 0.8206 | 0.2925 | ± 0.1000 | **Failed** |
| SS13-s4-r100 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0173 | 0.0174 | ± 0.0020 | Passed |
| SS13-s4-r100 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.78) | 0.8206 | 0.2925 | ± 0.1000 | **Failed** |
| SS13-s4-r100 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0173 | 0.0174 | ± 0.0020 | Passed |
| SS13-s4-r200 [cpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.66) | 0.7106 | 0.2568 | ± 0.1000 | **Failed** |
| SS13-s4-r200 [cpu] | depth in the kerb cell 5 m above the grate (m) | 0.0254 | 0.0251 | ± 0.0025 | Passed |
| SS13-s4-r200 [gpu] | share of the flow reaching the grate that it takes (HEC-22; its frontal share alone is 0.66) | 0.7106 | 0.2568 | ± 0.1000 | **Failed** |
| SS13-s4-r200 [gpu] | depth in the kerb cell 5 m above the grate (m) | 0.0254 | 0.0251 | ± 0.0025 | Passed |
