# PV-TF1 run 1: post-run analysis (12 Nov 2026). UNSCORED

**What this is.** The analysis of the first registered PV-TF1 run (`../../../results/2026-11-12T15-00-21-588Z/`),
requested by the technical review of that run (`../../reviews/review-run1-2026-11-12.md`).

**Inputs.** It reads only:
- the run's immutable per-step raw files (each file's SHA-256 is checked against its header before use);
- `../../../spec/PV-TF1.json`;
- the SWMM 5.2.4 source in `benchmarks/culvert/instrumented/build/src/`, an unmodified copy plus getter 420.

**What it does not do.**
- Nothing was rerun. No SWMM engine was loaded.
- No criterion, status, spec or result file was changed.

**Status of run 1, unchanged:**
- 19 rows Passed;
- 8 at-rest closure and level rows Insufficient reference data;
- accepted as a valid execution of the registered configuration.

Nothing below re-scores any row.

**Files**

| File | Content |
|---|---|
| `analyse.mjs` → `analysis.json` | Limiter evidence, periods, per-cycle envelopes, decay fits, independent linear periods |
| `hf.mjs` → `hf.json` | High-frequency share of segment flow in the rest window, against step and damping |
| `plot.mjs` → `fig1`–`fig5` | Figures (SVG) |

Reproduce with `node analyse.mjs`, then `node hf.mjs`, then `node plot.mjs`, all in this folder. This takes about a
minute.

---

## A. The artificial slope (SWMM WARNING 04)

### A1–A3. Source trace

SWMM 5.2.4 never stores a slope of 0. `conduit_getSlope` (`link.c` lines 1257–1299) replaces an end-invert drop below
`MIN_DELTA_Z` = 0.001 ft with 0.001 ft and writes WARNING 04. The result is stored in `Conduit[k].slope`
(`link.c` line 1078), and `link.c` line 1134 derives from it `Conduit[k].beta = PHI·√|S| / n`. Every place where the
slope or `beta` is read, under the registered settings (DYNWAVE, EXTRAN, PARTIAL, NORMAL_FLOW_LIMITED BOTH,
LENGTHENING_STEP 0, no culvert code, no force main, no street or inlet, no controls):

| Use (source) | What it computes | Under PV-TF1's settings |
|---|---|---|
| `dwflow.c` lines 250–259 → `checkNormalFlow` lines 637–684: `qNorm = beta·a1·r1^(2/3)` | **Normal-flow limiting.** It applies when q > 0, y1 < yFull, the flow class is SUBCRITICAL or SUPCRITICAL, and either y1 < y2 or Fr ≥ 1 at the upstream end. It then sets q = min(q, qNorm) | **Direct effect. Can act.** The only routing calculation the nominal slope enters |
| `dwflow.c` line 217 `dq2 = dt·g·aWtd·(h2 − h1)/L`; line 214 friction `roughFactor` (`link.c` line 1130: g·(n/PHI)², no slope) | Momentum: pressure gradient and friction | **No effect.** These use the node heads and n only |
| `dwflow.c` `getFlowClass` lines 297–360; `link_getFroude` (`link.c` lines 847–871) | Flow classification; Froude number | **No effect.** These use offsets, depths and velocity only |
| `dynwave.c` line 374 → `capacityLimited` | A flag, evaluated only when the upstream end is full (a1 ≥ aFull) | **Not reached** (part full throughout). Read only by `stats.c` line 724 (reporting) |
| `link.c` line 1135 `qFull`, line 1136 `qMax` | Full-flow capacity | **Not used in DW routing here.** Read by `stats.c` and `statsrpt.c` (reporting); `node.c` `storage_getOutflow` and `link.c` lines 558, 798 and 1327 (kinematic-wave and steady routing only); `node.c` line 1042 |
| `link.c` lines 1143–1146 `superCritical` | A deprecated flag | Never read |
| `link.c` line 1244, `conduit_getLengthFactor` | Conduit lengthening | **Not called:** LENGTHENING_STEP 0 (`link.c` lines 1106–1111) |
| `flowrout.c` line 253 | A check for an adverse slope at validation | A positive nominal slope never triggers it |
| `inputrpt.c` line 217; `swmm5.c` line 1085 (LINK_SLOPE) | The input summary and the getter | Reported only |

**Direct effects:** normal-flow limiting only. **Reported or diagnostic only:** LINK_SLOPE, the input report,
`qFull` statistics and `capacityLimited` statistics.

### A4. The artificial slope for each N

The substitution is per conduit. Each segment gets a nominal 0.001 ft (0.3048 mm) drop over its own length. No invert
is moved: `NODE_ELEV` is 0 everywhere (V2), and the heads that drive the momentum equation contain no drop. The
"cumulative drop" therefore exists nowhere in SWMM's state. It acts only through each segment's slope, which rises as
N grows, so the normal-flow cap rises as √N.

| N | Segment length (m) | Nominal slope | Nominal drop summed over segments (not applied to any invert) | qNorm at the still-water level 0.5066 m (m³/s) |
|---|---|---|---|---|
| 1 | 400 | 7.62e-7 | 0.30 mm | 0.0107 |
| 4 | 100 | 3.05e-6 | 1.22 mm | 0.0214 |
| 16 | 25 | 1.22e-5 | 4.88 mm | 0.0428 |
| 32 | 12.5 | 2.44e-5 | 9.75 mm | 0.0605 |

The cap is of the same order as the 0.1 m³/s fill inflow.

**Whether the limiter could have acted.** The trigger conditions were evaluated at every conduit-step from the recorded
end-node depths and flows. Two approximations apply:
- the flow class is approximated by "both ends wet";
- the area and the hydraulic radius come from the exact circle, whereas SWMM uses its tables.

SWMM's `Link.normalFlow` flag has no getter, so whether the limiter actually fired cannot be read. It can only be
bounded.

| N | Fill (0–2 h): conduit-steps with the conditions met | … with q ≥ 0.98·qNorm | After 2 h: largest q / qNorm with the conditions met | Rest window: largest q / qNorm |
|---|---|---|---|---|
| 1 | 1334 of 7200 | 22 | 0.61 | 0.18 |
| 4 | 5747 of 28 800 | 119 | 0.51 | 0.12 |
| 16 | 23 648 of 115 200 | 441 | 0.38 | 0.07 |
| 32 | 49 140 of 230 400 | 1120 | 0.28 | 0.06 |

**During the fill,** the conditions held at about 20 % of the conduit-steps, and flows at or above the cap occurred,
increasingly with N. The recorded flows are under-relaxed trial values (`dwflow.c` lines 262–266), so a recorded
q > qNorm neither confirms nor excludes that the limiter acted in a trial.

**After 2 h,** the recorded flows stay below 0.61·qNorm whenever the conditions hold. The limiter could only have bound
if the unrelaxed trial flow exceeded about 1.6 times its relaxed result, against a smooth oscillation whose period is
the frictionless linear period (B2). It is therefore not a credible factor in the residual oscillation or the rest
window.

### A5. Is it a material confounder for the P2a/P2b segmentation comparison?

**Yes, potentially, and it cannot be quantified from the recorded outputs.**
- P2a and P2b are hypotheses about *fill-time* storage errors and their trend in N.
- The fill is exactly when the limiter's conditions hold and when flows reach its cap.
- The cap depends on N through the nominal slope (×5.7 from N = 1 to N = 32).
- Limiting a link flow does not by itself break continuity, but it changes the fill path, and F3's error is
  path-dependent.

So an N trend in the at-rest books, had they been scorable, could not be attributed to P2a or P2b alone.

**It is not a confounder for whether the rest state is reached.** After 2 h the limiter is not credibly active.

Two further N-dependences matter for the same comparison (B6):
- N = 1 represents a different dynamic mode;
- higher harmonics are resolved only at large N.

---

## B. The 12-hour oscillation

### B1. Figures

| Figure | Shows |
|---|---|
| `fig1-tank-wse.svg` | T1 and T2 water surfaces, full run, per N |
| `fig2-tank-level-difference.svg` | T1 − T2: full run (fill peaks clipped at ±300 mm) and hours 6–12 against the ±1 mm rest condition |
| `fig3-conduit-flows.svg` | First, middle and last segment flows: full run, and the rest window. The 5e-6 m³/s limit is on the zero line at that scale |
| `fig4-junction-wse.svg` | Quarter, mid and three-quarter junction water surfaces minus the tank mean, hours 6–12, against ±1 mm |
| `fig5-decay-envelopes.svg` | Per-cycle maxima of the tank level difference and of the largest segment flow, log–log. Solid = observed; dashed = the quadratic-friction fit extrapolated (**not observed**) |

Every routing step is drawn: the long traces are bucketed by minimum and maximum, so no excursion is lost.

### B2. The dominant period

**Observed** (hours 8–12) comes from zero up-crossings of T1 − T2; the DFT figure is for T1 − T2 over hours 6–12.

**Independent references** use only the declared inputs:
- *Lumped linear:* the eigen-periods of the linearised, frictionless lumped network that SWMM's dynamic-wave scheme
  represents. Each node's surface area is its tank area plus half of each joined conduit's top width × length, and
  each link's inertance is L/(gA). They are computed by Jacobi in `analyse.mjs`.
- *Continuum:* the fundamental of a frictionless channel with end tanks, from kL + 2·atan(A_t·k/W) = π.

| N | Observed T (zero crossing) | Observed T (DFT) | Lumped linear, modes 1 / 2 / 3 | Continuum seiche |
|---|---|---|---|---|
| 1 | 665.0 s | 665.1 s | 665.9 s (single mode) | 444.3 s |
| 4 | 454.8 s | 455.0 s | 455.6 / 245.3 / 185.0 s | 444.3 s |
| 16 | 444.3 s | 444.2 s | 445.0 / 223.2 / 149.5 s | 444.3 s |
| 32 | 443.7 s | 444.2 s | 444.5 / 222.1 / 148.0 s | 444.3 s |

- **The diagnostics do not move the period:** a 0.5 s step, INERTIAL_DAMPING NONE and MIN_SURFAREA 0.1 all agree within
  ±1.5 s.
- **N = 1 has no internal node,** so it cannot carry the seiche. It oscillates in the two-node "rigid column" mode at
  666 s.
- **The end-segment flows at N = 32** are dominated, in the rest window, by periods of 63.4, 73.9, 88.7, 111.0 and
  148.0 s: exactly 444/7, /6, /5, /4 and /3. These are higher harmonics of the same seiche, and they are identical at a
  0.5 s step (`hf.json`).

### B3. Decay envelope and damping

The per-cycle maxima decline monotonically at every N. Two laws were fitted to the envelope after 2 h:

| N | Tank ΔH at 3 h → 11.5 h | max \|Q\| at 3 h → 11.5 h (m³/s) | Exponential e-folding of \|Q\|: fitted 2–12 h → fitted 7–12 h | Fitted d(1/Q)/dt | log-RMS residual, exponential / hyperbolic |
|---|---|---|---|---|---|
| 1 | 5.15 → 1.83 mm | 5.4e-3 → 1.9e-3 | 29.2 ks → 40.0 ks | 0.0110 | 0.056 / 0.00004 |
| 4 | 8.80 → 2.69 mm | 8.1e-3 → 2.5e-3 | 25.0 ks → 36.4 ks | 0.0092 | 0.081 / 0.013 |
| 16 | 9.82 → 2.00 mm | 1.1e-2 → 2.9e-3 | 21.7 ks → 36.0 ks | 0.0085 | 0.115 / 0.043 |
| 32 | 8.10 → 2.68 mm | 1.3e-2 → 3.6e-3 | 22.1 ks → 40.3 ks | 0.0071 | 0.101 / 0.042 |

The hyperbolic law is A(t) = 1/(a + b·t). At every N:
- the apparent exponential rate falls as time goes on;
- 1/amplitude grows linearly in time;
- the hyperbolic law fits the envelope far better.

That is the signature of **quadratic (Manning) friction**, not of a constant-rate damping.

**Independent check of the coefficient**, from Manning's term with no fitted parameter (c_f = g·n²/R^{4/3} at the
still-water level):
- **N = 1:** for the uniform-velocity column, d(1/Q)/dt = (4/3π)·c_f/A = **0.01106**, against **0.0110** fitted
  (within 1 %).
- **Distributed half-wave mode,** with the tanks' energy neglected: (32/9π²)·c_f/A = **0.0094**, against 0.0092 (N = 4),
  0.0085 (N = 16) and 0.0071 (N = 32).

At N = 16 and 32, part of the energy is in harmonics and in the tanks, so the single-mode estimate is an upper bound.

### B4. Declining toward the threshold, or a persistent oscillation?

**Declining, with no floor observed in 12 h.** The decay is algebraic (B3), so the approach to the flow threshold is
extremely slow.

**SWMM's flow-reversal rule.** In `dwflow.c` lines 262–266, when a trial reverses the flow's sign, |q| is set to
0.001 cfs = **2.83e-5 m³/s**, which is 5.7 times the registered 5e-6 limit.
- It never occurred in this run: there are 0 steps at that value, and the smallest non-zero |Q| is about 1e-11 m³/s.
- At the observed amplitudes, about 2e-3 m³/s, it is not active.
- **Untested:** as the amplitude approaches about 1e-5 m³/s, this rule could create a floor above the registered limit
  whenever trials straddle a reversal.

HEAD_TOLERANCE is 1.5 mm (`dynwave.c` line 618), which is coarser than the 1 mm rest conditions. Whether it limits the
approach to rest is also untested.

### B5. Time to meet every rest criterion: **extrapolation, not observation**

Fits from hours 2–12, extrapolated:

| Condition (limit) | N = 1 | N = 4 | N = 16 | N = 32 |
|---|---|---|---|---|
| Tank level difference (1 mm), hyperbolic / exponential | 22 h / 16 h | 32 h / 18 h | 24 h / 15 h | 32 h / 17 h |
| Internal WSE (1 mm), hyperbolic / exponential | — | 11 h / 11 h | 16 h / 13 h | 25 h / 16 h |
| Segment flow (5e-6 m³/s), hyperbolic | **209 d** | **252 d** | **271 d** | **328 d** |
| Segment flow (5e-6 m³/s), exponential | 2.5 d | 2.2 d | 2.0 d | 2.1 d |

The level-drift condition follows the level oscillation. It is already met at N = 4 and 32, and is expected with the
level difference.

**Defensibility:**
- **Level and water-surface conditions:** both laws agree within about ×2, at about 1–1.5 days. The extrapolation spans
  less than one decade of amplitude: **moderately defensible.**
- **Segment-flow condition:** the laws disagree by about 100×. The better-fitting hyperbolic law has an independently
  confirmed coefficient (B3) and puts the threshold at **7–11 months.** The exponential law fits worse and its rate is
  drifting.
- Both laws extrapolate more than two decades of amplitude beyond what was observed, and two untested SWMM mechanisms
  (B4) sit near the threshold. **This is not defensible as a duration estimate.** The defensible statement is that,
  under the governing equations' own friction law, the flow condition is not reached in any practical duration by
  passive decay.

Under the hyperbolic law, the time to reach a flow threshold q* is about 1/(b·q*), about 2×10⁷ s, almost independent of
the initial amplitude. A gentler fill alone would therefore not shorten it much, unless the fill never excites the
seiche above q* in the first place.

### B6. Physical, numerical, or not yet distinguishable?

**It is a physical mode of the governing equations** (the fundamental seiche of the closed tank–channel system),
damped by their Manning friction term. It is not a numerical oscillation:
1. Its period equals the independently computed linear eigen-period of the same lumped system within 0.2 % at every N,
   and the continuum seiche from N = 16.
2. Neither the period nor the decay changes with a 0.5 s step or with INERTIAL_DAMPING NONE.
3. The decay law and its coefficient follow from the Manning term without any fitting at N = 1, and to within the
   single-mode approximation at larger N. There is no sign of numerical dissipation or growth.
4. The high-frequency content at N = 32 consists of exact harmonics of the seiche and is step-independent.

**Qualifications:**
- "Physical" here means *of SWMM's 1-D Saint-Venant equations with Manning friction*. At the residual velocities, about
  7 mm/s with Re about 1900, real flow would be laminar or transitional and Manning is outside its range, so real
  damping could differ. That is a physical-model question, not a numerical one, and this run cannot answer it.
- The *discretisation* sets which modes exist: one mode at N = 1, a seiche and more harmonics as N grows. The
  oscillation's form therefore depends on N, even though the oscillation itself is not numerical noise.

---

## Recommendation

1. **A revised duration alone is not sufficient.**
   - About 1.5 days would probably meet the level, drift and internal-WSE conditions. That is an extrapolation.
   - The per-segment flow condition (5e-6 m³/s, every step) is not reached by passive decay in any practical duration
     under the governing equations (B5). It may also meet SWMM's 2.83e-5 m³/s reversal value (B4).
   - Extending the duration under the same registration would not make the registered rest definition attainable.
2. **A revised experimental design is necessary** before PV-TF1's at-rest books can test P1, P2a or P2b. This needs a
   new registration and review; none of it applies to run 1. The options, each your decision:
   - **a. Do not excite the seiche above the flow threshold.** Use a smooth inflow whose ramps are long compared with
     the 444 s seiche (666 s at N = 1). A dry wetting front may excite it regardless. An unscored feasibility pre-study
     would establish whether the residual can be kept below 5e-6 m³/s at all. This changes a boundary condition.
   - **b. Revise the rest definition** with a justification that is independent of these results: for example, books
     averaged over whole seiche periods, with a stated bound for the non-level surface. This is a criteria change and
     must be justified without reference to run 1's numbers.
   - **c. Neutralise the nominal-slope confounder.** SWMM 5.2.4 accepts `NORMAL_FLOW_LIMITED NONE` (`keywords.c`
     line 70 → `NEITHER`; `dwflow.c` line 255). Under it the nominal slope has no routing effect in this geometry. It
     could be the registered setting (a solver-setting change), or a declared paired diagnostic at every N.
     Production uses BOTH (`src/drainage.js` line 409, `src/river.js` line 51), so its effect on production flat
     conduits would be a separate question.
   - **d. Treat N = 1 as a different dynamic system,** not as the low end of an N trend.
3. **No change** to run 1's statuses, to the registered criteria, to production code or to SWMM. **PV-RV1 is not
   started.**
