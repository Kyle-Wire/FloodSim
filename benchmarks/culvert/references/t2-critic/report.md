# Review 3: T2 reference values (independent critic)

Written by the main session from the critic's hand-back; the critic could not write report files itself. Its scripts
and raw output are alongside: calc.py, extra.py, out.txt, out.json. It edited no repository file.

## Method and sources
- **(1) True ellipse**, a = 0.762 m, b = 0.4826 m:
  - A = ab(φ − sinφ cosφ), W = 2a sinφ, P by adaptive quadrature (tolerance 1e-13);
  - full perimeter 4a·E(1 − b²/a²), which agrees with the quadrature to 1e-9.
- **(2) Standard code 9**, xsect.c 552–577:
  - yFull = 38/12 ft and wMax = 60/12 ft; geom1 and geom2 as written are ignored;
  - aFull = 12.90 ft² and rFull = 0.969 ft (xsect.dat 336–356);
  - sMax = sFull (576); Amax = 0.96 aFull (68);
  - lookups at 898, 984 and 1061; invLookup at 812; lookup 1474–1507, quadratic in the first two intervals; invLookup
    1511–1567, linear;
  - tables at xsect.dat 361–379.
- **(3) Custom**, shape.c 64–185:
  - 51-point resampling, trapezoid areas and chord perimeters, getSmax;
  - section parameters at xsect.c 664–695.
- **Normal depth:**
  - link_getYnorm (link.c 783–803) and generic_getAofS (xsect.c 1359–1400);
  - PHI 1.486; CMS factors 0.3048 and 0.02832;
  - the NORMAL outfall is held at normal depth (node.c 1437–1440).
- **Reported velocity** is Q/A(link depth) (swmm5.c 1095–1097).
- **Full-flow friction** uses aFull and rFull (dwflow.c 623–633).

## Full section
| | A m² | P m | R m | Qfull m³/s | Qmax |
|---|---|---|---|---|---|
| true | 1.15529 | 3.95945 | 0.29178 | 2.4726 | 2.7246 at y/D 0.927 |
| standard | 1.19845 (+3.74%) | 4.05771 (+2.48%) | 0.29535 (+1.22%) | 2.5863 (+4.60%) | 2.5863 (capped) |
| custom | 1.15410 (−0.10%) | 3.95842 (−0.03%) | 0.29156 (−0.08%) | 2.4692 (−0.14%) | 2.7196 |

## Part full, % difference against the true ellipse
| y/D | std ΔA | std ΔP | std ΔR | cus ΔA | cus ΔP | cus ΔR |
|---|---|---|---|---|---|---|
| 0.05 | +17.9 | +24.0 | −4.9 | +0.63 | +1.19 | −0.55 |
| 0.10 | +4.6 | +9.9 | −4.8 | −0.40 | −0.13 | −0.28 |
| 0.15 | −3.5 | +1.9 | −5.3 | −0.15 | +0.02 | −0.17 |
| 0.20 | −5.3 | −3.5 | −1.9 | −0.22 | −0.07 | −0.15 |
| 0.25 | −7.1 | −7.8 | +0.7 | −0.14 | 0.00 | −0.14 |
| 0.30 | −6.5 | −7.5 | +1.1 | −0.15 | −0.05 | −0.10 |
| 0.40 | −1.4 | −3.0 | +1.6 | −0.12 | −0.04 | −0.08 |
| 0.50 | +3.7 | +2.5 | +1.2 | −0.10 | −0.03 | −0.08 |
| 0.60 | +6.8 | +5.0 | +1.8 | −0.09 | −0.01 | −0.08 |
| 0.65 | +7.4 | +6.1 | +1.3 | −0.10 | 0.00 | −0.10 |
| 0.70 | +7.2 | +5.6 | +1.5 | −0.09 | −0.01 | −0.08 |
| 0.80 | +5.2 | +3.1 | +2.1 | −0.08 | 0.00 | −0.08 |
| 0.90 | +3.7 | +0.7 | +3.0 | −0.09 | +0.01 | −0.09 |
| 0.95 | +3.5 | +0.5 | +3.0 | −0.12 | +0.10 | −0.22 |
| 1.00 | +3.7 | +2.5 | +1.2 | −0.10 | −0.03 | −0.08 |

Top width is exact for both sections.

## Normal depth (m)
| Q | true | std calc | SWMM std | cus calc | SWMM cus (HW / link / outfall) |
|---|---|---|---|---|---|
| 0.10 | 0.1382 | 0.1429 | 0.1429 | 0.1384 | 0.1384 |
| 0.25 | 0.2143 | 0.2217 | 0.2217 | 0.2146 | 0.2146 |
| 0.50 | 0.3011 | 0.3094 | 0.3094 | 0.3014 | 0.3014 |
| 1.00 | 0.4299 | 0.4230 | 0.4230 | 0.4303 | 0.4303 |
| 1.50 | 0.5389 | 0.5235 | 0.5235 | 0.5394 | 0.5394 |
| 2.00 | 0.6460 | 0.6125 | 0.6126 | 0.6466 | 0.6466 |
| 2.50 | 0.7727 (upper root 0.9648) | 0.7234 | 0.7234 | lower 0.7738; SWMM uses the upper root 0.9618 | 0.7738 / 0.8678 / 0.9618 |

## Full-flow friction over 400 m (m)
| Q | true | std calc | SWMM std | cus calc | SWMM cus |
|---|---|---|---|---|---|
| 1 | 0.26171 | 0.23929 | 0.23921 | 0.26252 | 0.26243 |
| 2 | 1.04684 | 0.95716 | 0.95684 | 1.05008 | 1.04973 |
| 3 | 2.35538 | 2.15360 | 2.15288 | 2.36268 | 2.36189 |

## Code-9 table consistency
- **Width:** the table is a true ellipse at all 26 points.
- **Area table against integrated width:**
  - y/D 0.04: 0.015 against 0.011; 0.24: 0.165 against 0.183; 0.32: 0.250 against 0.275; 0.64: 0.700 against 0.678.
  - The area table is antisymmetric, so this is not a single typo.
- **Full area:** the integrated width gives 0.7797 of the bounding box (12.35 ft²); the table's Afull is 0.8147
  (12.90 ft²).
- **Full radius:** Rfull is 0.2954 m against 0.2918 m true.
- **The R table:** −13 % at y/D 0.04 and +1 to +2.7 % at 0.8–0.96.
- **Implied perimeter at y/D 0.04:** 2.61 ft against 1.98 ft true.
- **SWMM's own non-standard formula** gives a different section again: 12.73 ft², 0.969 ft.
- **lookup and invLookup are asymmetric:** the round trip at y/D 0.02 returns 0.0167. No run went that shallow.

## Validity of the inferred values
- A = Q/V is exact.
- R and P from Manning match SWMM to about 1e-4 wherever the flow is uniform.
- They break down at custom Q 2.5 (upper root, inside the slot).
- The full-flow implied R is biased by the summary's 2-decimal areas: −0.17 % (standard) and +0.56 % (custom).

## Setup caveats
- Custom Q 2.5 is not uniform flow; use Q ≤ 2.4 m³/s or a FREE outfall.
- "Headwater" is node depth, not energy.
- The part-full runs have continuity errors of −2 % to −5 %. There is no drift and flow = Q, so the steady values look
  unaffected; the cause was not found.
- The standard line's geom1 and geom2 are ignored once a size code is given.
