# Radar coverage and QPE product assessment for the six Phase 1 hindcast cases

**Task:** SPA-93 · Radar & Precipitation (QPE) Specialist · **Date:** 1–2 November 2026 · **Revision 3**
**Status:** deliverable. Sits ahead of Phase 1 pre-registration; no Phase 1 case should be pre-registered until the per-case gates in §9 have been run.
**Amended by [Addendum A](SPA-93_addendum_A_ingestion_response.md)** (1 November 2026), which responds to the Phase 3e ingestion findings on SPA-94. Three statements below are corrected there — §1.1 and §8.1 on the availability of a dBZ display layer, §2.4 trap 2 on whether the no-coverage sentinel had been observed, and §5.5 on how the duplicate-frame guard must be specified. Each carries a pointer in place.
**Scope of my verdicts:** rainfall only. A "go" below means *the rainfall field can be built honestly for this catchment and event*. It says nothing about the DEM, the drainage network, the tide boundary or the verification data, which belong to other roles.

> **Revision 2** incorporates the seven changes requested in review of revision 1, and what fixing them turned up. Everything here is measured; §12 is a per-item index of what changed and where. The headline items, because three of them correct revision 1's own numbers against itself:
>
> - **§4.1 — the peak-attenuation figure was overstated and is withdrawn.** Revision 1's "−83.9 %, a factor of six" came from a synthetic single cell. On the real 2016 storm the number is **−33.4 %**, and **−38.9 %** for Harvey. The conclusion — force from the 2-minute rate field — survives, but the claim is now the one the data supports.
> - **§2.4 trap 4 — the hourly QPE products are stamped with the END of their accumulation window.** New, measured to 0.07 mm, and it is the reason revision 1's Ida rate census started an hour late and missed that storm's peak hour. It also cross-validates `PrecipRate` against `RadarOnly_QPE_01H` to ~1 %. A new merge gate **G10** asserts the alignment.
> - **§5.5.1 — my own "effective refresh 2.0–2.3 min" was too generous.** On the correct metric the Ellicott City 2016 interval is **2.96 min** and one frame pair in three is a weak update, not one in seven. Advection correction still ranks third; the duplicate-frame guard ranks higher than I said.
> - **§8.1.1 — the pre-2020 replay layer is `SeamlessHSR`**, native GRIB2 at 0.1 dBZ, present on every case date. This supersedes both revision 1 ("no dBZ layer possible") and Addendum A ("use IEM's `mrms_lcref`"), and it is the field `PrecipRate` is derived from — measured, not assumed.
> - **§6.5 — hourly gauge–radar ratios are not an estimate of bias.** The ratio's log-SD collapses from 1.145 to 0.139 (Norfolk) and 0.700 to 0.132 (Charleston) between 1 h and 12 h aggregation, while the median barely moves. Charleston also has a genuine one-hour timing offset and Norfolk does not. Bias is an event-level quantity on both coastal cases, and the event-level ratios the case-6 recommendation rests on are **lag-invariant to 0.5 %**; new gate **G11** decides which per case.
> - **§7.4 and §7.6 — both outstanding rate-cap censuses are run and both pass**, Harvey at 189.4 mm/h and Matthew at 180.9 mm/h, each with no clamping at any value and 89 % / 99.4 % tropical classification. That closes revision 1's §10 item 6 and leaves **no unrun gate that I can run from the archive**. The cap mechanism is now a four-case comparison: tropical → uncapped at 152–189 mm/h, convective-and-hail → clamped at exactly 103.8.
> - **§7.5 — Ida's census window was truncated too**, by the same hour-labelling error, and I found it while fixing the 2018 one. Re-censused: peak pixel **161.4 mm/h** rather than 121.7, peak box-mean 96.0 rather than 39.6. The verdict holds and the "no saturation at all" finding is stronger. It also makes Ida the **worst case in the set for hourly forcing, at −58.9 %**.
> - **§11.1 — the per-host transfer cap is now enforced in code**, not intended.

> **Revision 3** answers the SPA-94 revision-2 reconciliation comment (2 November 2026, 02:07Z) and fixes one piece of drift that comment would otherwise have been implemented against. No verdict changes. §14 indexes it. Three substantive items:
>
> - **§8.1.1 — the reflectivity layer carries *two* negative sentinels, and conflating them is the display-side twin of the −3.0 trap.** Measured from cache: `SeamlessHSR` reports **−999.0 for no radar coverage** and **−99.0 for no echo**, and the no-echo set is *pixel-for-pixel identical* to `PrecipRate == 0` (21,393 of 21,393 over a 50,000-pixel Maryland box). A ramp that renders −999 at its bottom paints a radar outage as clear sky. New legend requirement, and it is the one genuinely new specification in this revision.
> - **Addendum A §A.1's per-case `displayProduct` column still named the withdrawn `mrms_lcref`** for cases 1a, 1b, 4 and 6, three sections after §8.1.1 superseded it. That table is what the Geospatial Engineer would have built from. **Corrected to `mrms_seamless_hsr`**, and this is the explicit answer to their question of which layer those three cases render.
> - **§5.5.1 — the duplicate-frame guard's threshold is now a named parameter with its metric defined**, because SPA-94 §7 holds it with no default and a run cannot start until I set it. `dedupe.threshold = 0.25`, `dedupe.wetThreshold = 1.0 mm/h`. **It gates the motion estimate only; a weak-update frame is never dropped from the forcing integration** — the name "dedupe" invites exactly that error and it would lose real rainfall.

---

## 0. Verdicts

| # | Case | Verdict on **radar rainfall** | The reason, in one line |
|---|------|------------------------------|--------------------------|
| 1a | **Ellicott City, MD — 30 July 2016** | **GO, conditional** | The 2-minute rate field reaches 152.3 mm/h and integrates to 168.8 mm at the wettest pixel against a reported 167.6 mm, so the storm is representable — but 10.4 % of pixel-frames were hail-flagged and 7.8 % of wet pixel-frames sit exactly at the 53.8 mm/h hail cap, and MRMS's gauge correction did **nothing** over this catchment (ratio 0.992), so the field has no independent absolute scale until external gauges are brought in. |
| 1b | **Ellicott City, MD — 27 May 2018** | **NO-GO as a solver validation** | The observed 2-hour *mean* intensity (8.40 in / 2 h = 106.7 mm/h) **exceeds the pre-v12 convective rate cap of 103.8 mm/h**. Re-censused over the whole storm in revision 2 (§7.1): the rate field reaches exactly 103.8 mm/h and **never exceeds it across 4,831 wet pixel-frames**, 15.5 % of wet pixel-frames sit exactly at the 53.8 mm/h hail cap, and `PrecipFlag` is 47 % convective, 21 % hail, **0 % tropical**. The event total at the wettest pixel is 172.2 mm against a reported 213.4 mm — **19.3 % low by construction** — and renormalising to the hourly gauge-merged product cannot repair it, because that product is itself radar-only here (ratio 1.005) and carries the same clamp. |
| 2 | **Bellinge, Denmark** | **NO-GO on radar — and that is the right answer** | Outside the MRMS domain entirely, and a 1.72 km² catchment with two 1-minute gauges *inside* it is better sampled by its gauges than by any 1 km radar product. Force from the supplied gauges. |
| 3 | **EA Tests 8A/8B (Glasgow)** | **NOT APPLICABLE — confirmed no-op** | Rainfall is specified and spatially uniform by the test definition. Nothing for me to supply, and the radar layer must be switched off for these runs so no one screenshots a synthetic test under a radar legend. |
| 4 | **Meyerland / Brays Bayou, Houston — Harvey 2017** | **GO** | Best beam geometry in the set: 43.5 km, beam centre 501 m over the catchment, 0.70 km sample. But MRMS's two own products disagree by **21 %** over this catchment across the event and the disagreement **changes sign mid-event**, so hourly bias reporting is mandatory, not optional. |
| 5 | **Philadelphia — Ida 2021** | **GO on coverage — with a pre-registration blocker** | Best-instrumented case in the archive: MRMS v12 dual-pol, peak **161.4 mm/h** with **no saturation signature at all** (re-censused over the corrected window in revision 2; §7.5), and the full diagnostic product set. But the two candidate hourly normalisers differ by **40 %** over Center City (Pass 2 / radar-only = 0.599), so which one forces the run must be decided against independent gauges *before* pre-registration, not after. It is also the case most damaged by hourly forcing, at **−58.9 %** of peak intensity (§4.1). |
| 6 | **Norfolk / Hampton Roads — Hurricane Matthew, 8–9 October 2016** | **GO — my recommendation for case 6** | Rain and water level peak together, which is what makes it compound; KAKQ at 65.1 km, 869 m beam height, no blockage, complete 2-minute archive on both days; and the gauge-merged field (8.97 in box-mean, 11.0 in at the wettest pixel) lands inside the reported 6–11 in. Charleston's radar is 24 % **low** in the same storm from a 1621 m beam — measured, and **invariant to the one-hour timing offset** in Charleston's hourly merge (§6.5). The rate-cap census ran in revision 2 and **passes: 180.9 mm/h peak with no clamping, 99.4 % tropical** (§7.6), so this verdict is now measured on every dimension this role owns. |

Three things in this table are revisions to what the plan assumed. All three are measured rather than argued, and the second one is a correction to a hypothesis of my own that the measurement did not support.

1. **The thing that will break a radar-forced hindcast is temporal, not spatial.** Forcing from an hourly QPE product under-predicts the peak catchment-average intensity by **between a third and three fifths** — measured on all four storms that have a 2-minute series: **−30.4 %** (Ellicott City 2018), **−33.4 %** (Ellicott City 2016), **−38.9 %** (Harvey), **−58.9 %** (Ida) — while reproducing the event volume *exactly* (§4.1). That is the worst class of error available: invisible to a water-balance check and damaging to a flash-flood peak. The requirement with teeth is "force from the 2-minute rate product", not "spatialise the rainfall". *Revision 1 put this at 83 % and called it a factor of six, from a synthetic cell rather than from data; §4.1 withdraws that figure, and the measured range turns out to be wider than the single −33 % the review suggested.*

2. **Advection correction is worth building, but not for the reason the ticket gives, and the correct ranking of effort puts it third.** With 2-minute frames, in-place interpolation is already within **0.0 % on catchment volume, 0.8 % on peak 10-minute catchment intensity and 7.9 % on peak 2-minute single-pixel intensity** (§5.3) — not the error that decides a 9 km² hindcast. I suspected the 2-minute cadence was a publication cadence masking a 4–6 minute volume scan, which would have made the gap twice as large and the penalty an order of magnitude worse; I measured it and **that hypothesis is refuted, but my replacement number was also wrong.** The completed census (§5.5.1) puts the effective new-observation interval over the Ellicott City 2016 catchment at **2.96 minutes**, not the 2.34 revision 1 quoted — so 2.7 km of cell motion between genuinely new observations rather than 1.8 km. Not 4–6 minutes, but half a pixel worse than the ticket assumed rather than better. What advection correction does buy, decisively, is the **instantaneous field**: in-place blending recovers only 59–86 % of the true peak at the mid-frame instant and can place the field maximum 0.69 km from truth, and that is precisely what Phase 3e's replay exit criterion is about. Build it, with a global cross-correlation vector and a cubic resampler, in that modest form — and **do not build dense optical flow**, which §5.1-R6 shows is unnecessary. The ranking is unchanged; the **duplicate-frame guard** inside it moves up, because one pair in three is a weak update rather than one in seven.

3. **"Gauge-corrected" means something different in every case, and nothing at all in two of them.** The ratio of MRMS's gauge-merged product to its radar-only product over the catchment, measured: Ellicott City 2016 **0.992**, Ellicott City 2018 **1.008**, Harvey/Brays **0.827**, Matthew/Norfolk **0.798**, Matthew/Charleston **1.240**, Ida/Philadelphia **0.599**. A programme that applied the gauge-merged product as though it were a corrected field would be silently changing its rainfall volume by anything from 0 % to 40 % depending on the case, in both directions. This is the whole argument for §6.

---

## 1. The two established facts, verified

### 1.1 Archive start — confirmed, with a sourcing finding that changes the build

**Confirmed.** MRMS began operational GRIB2 production at NCEP on 29 September 2014 and the public archive begins **1 November 2014 UTC**. Case 6 therefore cannot be Sandy (October 2012); MYRORSS covers 2000–2011 and is reflectivity-derived, leaving 2012 to late 2014 with no MRMS QPE. Nothing in that needs re-deriving.

**What I found on top of it, and it is a build-affecting surprise.** I enumerated both public sources (`research/radar_qpe/archive_probe.py`, output in `out/archive_probe.json`):

| Source | Earliest data | What it carries |
|---|---|---|
| **NOAA Open Data, `s3://noaa-mrms-pds`** | **14 October 2020** for *every one of the 13 products I probed* | The full ~240-product CONUS set, 2-minute, with all diagnostics |
| **IEM MTArchive**, `mtarchive.geol.iastate.edu/YYYY/MM/DD/mrms/ncep/` | 1 November 2014 | **3 to 7 fields only** before October 2020 |

14 October 2020 is the MRMS v12.0 operational date. The NODD bucket is a v12-onwards archive, not an archive of MRMS.

**Measured field availability on the event dates** (`out/archive_probe.json`):

| Event date | Fields in MTArchive | `PrecipRate` frames |
|---|---|---|
| 2014-11-01 (archive day 1) | 3: `PrecipRate`, `RadarOnly_QPE_01H`, `RadarOnly_QPE_24H` | 720 / 720 |
| 2015-10-03 (Charleston, Oct 2015 SC flood) | 5 — **no `PrecipFlag`** | 720 / 720 |
| 2016-07-30 (Ellicott City 2016) | 6 — **no `RadarQualityIndex`** | **719 / 720** (missing 00:06:00Z) |
| 2016-07-31 (Ellicott City 2016, peak) | 6 | 720 / 720 |
| 2016-10-08, 2016-10-09 (Matthew, Hampton Roads) | 6 — **no `RadarQualityIndex`** | 720 / 720 both days |
| 2017-08-26, 2017-08-27 (Harvey, Brays Bayou) | 7 | 720 / 720 both days |
| 2018-05-27 (Ellicott City 2018) | 7 | 720 / 720 |
| 2021-09-01, 2021-09-02 (Ida, Philadelphia) | 15 | **718 / 720** each; gaps at 04:24Z and 14:24Z on the 1st, 08:24Z and 10:24Z on the 2nd |

Consequences the Geospatial Engineer has to plan for:

- **Cases 1, 4 and 6 cannot be fetched from NODD at all.** They come from MTArchive, over HTTP, as `.grib2.gz`, at one file per field per 2 minutes. URL pattern, verified: `https://mtarchive.geol.iastate.edu/YYYY/MM/DD/mrms/ncep/<Field>/<Field>_00.00_YYYYMMDD-HHMMSS.grib2.gz`. NODD keys carry an extra prefix: `CONUS/<Field>_00.00/YYYYMMDD/MRMS_<Field>_00.00_YYYYMMDD-HHMMSS.grib2.gz`. The two differ in both path shape and filename; write one resolver with two backends, not one path template.
- **`MergedReflectivityQCComposite` does not exist in the archive before October 2020.** The display layer the board asked for is unavailable for Ellicott City, Harvey and Matthew. For those three the replay layer must be built from `PrecipRate` in mm/h — which changes what the legend says (§8). Do not let this become an argument for decoding NEXRAD Level II: that is a radial-sweep decoder and a separate project, and it buys nothing for the forcing.

  > **Corrected twice; the second correction is the answer.** First, by [Addendum A §A.3](SPA-93_addendum_A_ingestion_response.md#a3-the-display-layer--i-was-wrong-and-the-correction-is-good-news): the sentence above is right about the `MergedReflectivityQC*` family and I wrongly generalised it to "no dBZ layer exists", when IEM's `mrms_lcref` raster is present 720/720 frames on every case date. Then by **[§8.1.1](#811-the-pre-2020-replay-layer--seamlesshsr-and-this-supersedes-two-earlier-answers)**, which is where this now rests: **`SeamlessHSR` is native NCEP GRIB2 reflectivity in dBZ and is present on every pre-2020 case date**, so cases 1, 4 and 6 get a dBZ replay from the same decoder and the same host as their forcing. **Both the claim that those three can have no dBZ layer and the conclusion that their replay must be built from `PrecipRate` in mm/h are withdrawn.** SPA-94 identified this sentence as the false premise their M16 overturns, and they are right that it was still standing here.
- **IEM's rolling real-time cache was cut to 30 days in August 2026.** MTArchive is the durable copy; the rolling cache is not. Do not build the historic path against `mrms.agron.iastate.edu`.
- **`RadarQualityIndex` is not archived for 2016.** For Ellicott City 2016 and Matthew 2016 the per-pixel QPE quality field cannot be retrieved, so the coverage statement for those two rests on computed geometry plus an RQI sample from a modern date over the same catchment. Say that in the pre-registration rather than quietly omitting it.

### 1.2 Reflectivity is not rainfall — confirmed, and here is the boundary in product names

| Layer | Products | What it is |
|---|---|---|
| **Display only** | `MergedReflectivityQCComposite_00.50`, `MergedBaseReflectivityQC`, `SeamlessHSR` | Quality-controlled reflectivity, dBZ. Column-maximum or hybrid-scan. A picture of where the storm is. |
| **Forcing** | `PrecipRate_00.00` (2-min, mm/h), `RadarOnly_QPE_*`, `MultiSensor_QPE_*_Pass1/Pass2` (v12+), `GaugeCorr_QPE_01H` (pre-v12) | Quantitative precipitation estimate, mm/h or mm |
| **Diagnostic — fetch, record, never force with** | `PrecipFlag`, `SyntheticPrecipRateID`, `RadarQualityIndex`, `RadarAccumulationQualityIndex_*`, `SeamlessHSRHeight`, `BrightBandTopHeight`/`BottomHeight`, `Model_0degC_Height`, `GaugeInflIndex_*`, `WarmRainProbability` | Why the QPE says what it says, and how much to trust it |

The diagnostic column is the part of this that is usually skipped, and it is where most of my per-case evidence below came from. `PrecipFlag` tells you which of the six Z–R relations was applied at each pixel; `GaugeInflIndex` tells you whether the gauge correction actually touched your catchment; `RadarQualityIndex` is MRMS's own per-pixel statement of blockage and beam-height quality. These are cheap, they are in the archive, and they turn "the radar coverage looks adequate" into a number.

---

## 2. Product and pass selection — the specification

### 2.1 The forcing recipe

**Force from the 2-minute rate field, and use the hourly gauge-merged product only to set its scale.** In order:

1. **Fetch** `PrecipRate_00.00` at native 2-minute cadence for the event window plus one hour either side, over the model domain plus a **motion-estimation halo** (§5.2).
2. **Advection-correct and integrate** to the model forcing step (§5), producing a per-pixel depth series.
3. **Sum** that to clock hours, per pixel.
4. **Form the renormalisation field** `K(x, hour) = Q_hourly(x, hour) / A_rate(x, hour)` where `Q_hourly` is `MultiSensor_QPE_01H_Pass2` (v12+) or `GaugeCorr_QPE_01H` (pre-v12). **The hourly file stamped `T` is the accumulation for `[T−1h, T)`, not `[T, T+1h)`** — measured in §2.4 trap 4 — so the rate frames that must be summed against it are the ones from `T−1h` up to but excluding `T`. Getting this backwards shifts every `K` by one hour, which moves rainfall volume between hours while leaving the event total untouched, and therefore will not show up in a water-balance check. Assert the alignment in a unit test: an hour of `PrecipRate` integrated against its own hourly file should give `K ≈ 1` where no gauge correction applies, and §2.4 measures it at 1 % on two independent cases.
5. **Smooth `K` spatially** with a Gaussian of 5 km σ and **clip it to [0.5, 2.0]**. Report the clipped fraction. Rationale: `K` is a bias field, not a rainfall field; it should vary smoothly. An unsmoothed per-pixel ratio injects 1 km-scale discontinuities into the forcing that are artefacts of two products' different accumulation logic, not of the weather.
6. **Apply `K`** multiplicatively to the sub-hourly series within each hour.
7. **Record** `K`'s mean, spatial standard deviation, min, max and clipped fraction per hour in the run provenance.

Step 5's smoothing and clipping are both choices, and both get reported, because a reader must be able to see how much the renormalisation moved the field.

**The clip bound is not a matter of taste — it is there because of a measured hour.** Over the Norfolk box during Matthew, the hour beginning 2016-10-09 00:00Z has a radar-only box mean of 19.06 mm and a gauge-merged box mean of **0.16 mm**: a ratio of **0.009** in the middle of the storm, surrounded by hours at 0.58 and 1.18. That is a gauge-QC or merge artefact, not weather. Unclipped, step 6 would multiply that hour's sub-hourly rates by 0.008 and delete 19 mm of rain from the heart of the event. The clip catches it; the reported clipped fraction is what makes it visible.

**Where an hour's `Q_hourly` is missing:** fall back to `Pass1`, and record the fallback. If neither exists, **do not normalise that hour and flag it**. Never interpolate `K` across a missing hour — that silently extends one hour's bias over another.

**And the recipe has a limit that must be stated per case.** Renormalising the rate field to the hourly product only adds information where the hourly product *has* independent information. Measured (§6.3): over the Tiber catchment the gauge-merged product differs from radar-only by 0.8 %, so it is radar-only in all but name and inherits the same rate-cap clamp. For Ellicott City the recipe therefore fixes nothing — which is why case 1b is a no-go (§7.1) rather than a conditional go. **Run gate G4 before assuming step 4 helps.**

### 2.2 Pass selection

| Use | Hourly normaliser | Why |
|---|---|---|
| **Hindcast** (all Phase 1) | `MultiSensor_QPE_01H_Pass2` / `GaugeCorr_QPE_01H` | Latency is irrelevant to a hindcast and Pass 2 has the most gauges. **Pass 1 must never be used for a hindcast.** |
| **Live mode** (Phase 5, internal) | `PrecipRate` radar-only at the leading edge; Pass 1 applied retrospectively at ~20 min; Pass 2 at ~60 min | This means a live run's forcing is *revised behind the leading edge as passes land*. That is acceptable, and it must be recorded: the snapshot has to say which pass was in force over which hours at the moment each frame was displayed, or the live run is not reproducible as it was seen. |
| **Bias denominator, every run** | `RadarOnly_QPE_01H` | Always fetched, never forced with. It is the gauge-independent arm of §6. |

### 2.3 The v11 / v12 discontinuity, and what it does to the case set

MRMS v12.0 went operational **14 October 2020**. It replaced the single-polarisation Z–R family with a dual-polarimetric synthetic QPE, added evaporation correction, and renamed the gauge-merged products from `GaugeCorr_QPE_*` to `MultiSensor_QPE_*_Pass1/Pass2`. The rate ceilings differ substantially:

| | pre-v12 (single-pol Z–R) | v12+ (dual-pol) |
|---|---|---|
| Stratiform | 48.6 mm/h | — |
| Convective | **103.8 mm/h** — confirmed in the data: across **4,831 wet pixel-frames** over the whole 27 May 2018 storm (§7.1, re-censused in revision 2) the Ellicott City rate field reaches exactly 103.8 mm/h and never exceeds it | R(K_DP) 150 mm/h; convective/hail branch 5.9 in/h ≈ 150 mm/h |
| Hail | **53.8 mm/h** — confirmed twice over, by two unrelated methods. From rate histograms: 7.8 % (2016) and **15.5 %** (2018, whole storm) of wet pixel-frames over the Tiber catchment sit at exactly this value. And from reflectivity: pushing `SeamlessHSR` through the published convective Z–R predicts up to **2.1× more rain than the product reports on hail-flagged pixels, and never less**, with the reported rate topping out at exactly 53.8 (§8.1.1) | — |
| Tropical | not capped at 103.8 — the 2016 Ellicott City field, flagged 78 % tropical, reaches **152.3 mm/h** | — |
| Light/steady rain | — | R(A) 200 mm/h |

The tropical row is the one that decides case 1. The two Ellicott City storms are similar in depth and 22 months apart, and MRMS classified them differently: 2016 as **46.4 % tropical convective + 31.5 % tropical stratiform**, which selects the generous `R_trop = 0.010 Z^0.833` and reached 152.3 mm/h; 2018 as **22.2 % convective + 17.4 % hail**, which clamped at 103.8 and 53.8 mm/h. Nothing about the catchment, the geometry or the range differs. The product's own precipitation classification is what separates a usable rainfall field from an unusable one, and `PrecipFlag` is archived, so **this is checkable before pre-registration rather than discoverable afterwards** (gate G3).

Phase 1 splits across this boundary: **cases 1, 4 and 6 are pre-v12; case 5 is v12.** Four consequences:

- Product names differ, so the fetch layer needs a version-aware product map keyed on date, with 2020-10-14 as the switch. **Keyed on the declared date, never on which product happens to exist** — and SPA-94's M15 measured why that distinction has teeth rather than being a style preference. The 2020-10-13 and 2020-10-14 MTArchive trees each carry **both** `GaugeCorr_QPE_01H` and `MultiSensor_QPE_01H_Pass2`; 2016-07-30 carries only the former and 2021-09-02 only the latter. So a resolver that picks "whichever exists" is deterministic at both ends of the archive and **ambiguous exactly across the version boundary**, which is the one place a silent choice corrupts a cross-era comparison — and it would be ambiguous in the direction nobody would notice, because both answers decode cleanly. No Phase 1 case sits on 13–14 October 2020, so this cannot bite us now; it would bite the first person to add a case that does.
- Case 5's rainfall is from a materially better algorithm than cases 1, 4 and 6's. **Cross-case bias comparisons are not like-for-like and must not be aggregated into a single "radar rainfall accuracy" number for the validation report.**
- The pre-v12 caps bite hardest exactly where the plan most wants radar: a convective flash flood. §7.1 measures how hard.
- v12.1 (24 February 2021) reduced Multi-Sensor Pass 1 latency 60→20 min and Pass 2 120→60 min, and v12.2 (22 April 2022) added the Canadian S-band radars. Neither changes a Phase 1 case, but the live-mode latency figures in the plan are v12.1-onwards figures and should be labelled as such.

### 2.4 Reading the files — four traps I hit, so the engineer does not have to

I wrote a minimal reader (`research/radar_qpe/mrms_read.py`) to do the measurements in this document. Four things about the actual bytes. Traps 1 and 2 are corrected from the first revision, and trap 4 is new and is the one that cost me real numbers.

1. **The data section is PNG-packed.** Section 5 carries data representation template **5.41**, not simple packing. Physical value = `(R + X·2^E) / 10^D` with, for `PrecipRate`, `R = −30.0`, `E = 0`, `D = 1`, 16-bit samples. **Corrected:** the first revision said this gives "a floor of −30". It does not. `R` is the section-5 reference value, but the decimal scale factor `D = 1` divides it, so the floor is **`R / 10^D` = −3.0 mm/h** and the step is 0.1 mm/h. −30 is a number that appears in the header, not a value the field can take. Grid template 0, 7000 × 3500 at 0.01°, first point 54.995 N / 230.005 E, scanning north to south. Read out of a real message by `seamless_hsr_probe.py`:

   | Product | `R` | `E` | `D` | bits | Min representable | Step | Max representable |
   |---|---|---|---|---|---|---|---|
   | `PrecipRate` | −30.0 | 0 | 1 | 16 | **−3.0** | 0.1 | 6550.5 |
   | `PrecipFlag` | −3.0 | 0 | 0 | 8 | **−3.0** | 1 | 252 |
   | `SeamlessHSR` | −9990.0 | 0 | 1 | 16 | **−999.0** | 0.1 | 5554.5 |

2. **Negative values are not zero, and the sentinel set is per-product.** **Corrected:** the first revision said MRMS's conventions are "−3 for no radar coverage and −999 for missing" and that `PrecipRate` "can represent the former but not the latter". The first half of that is right and the second half was right for the wrong reason. `PrecipRate` cannot encode −999 because its floor is −3.0 — so for that product, −3.0 is the *only* negative value there is, and a decoder testing for −999 on a rate field is testing for something that cannot occur. But `SeamlessHSR` has `R = −9990`, `D = 1`, so **−999.0 is representable there and is its no-data value.** A single global no-data rule across products is therefore wrong in both directions. Each product in the §7 registry must carry its own sentinel list, taken from its own section 5.

   **Treating −3 as 0 mm/h turns a radar outage into a dry spell**, which is the single most dangerous decoding bug available here. *Any* negative value over the model domain must flag the run rather than be filled.

   > **Updated by [Addendum A §A.5](SPA-93_addendum_A_ingestion_response.md#a5-the-no-coverage-sentinel-i-expected-the-raster-to-lose-it-and-it-does-not--but-gate-g2-now-has-a-positive-control).** Now observed rather than inferred: `-3.0` on 1600/1600 pixels over a no-coverage patch at 54 N. That makes G2 testable instead of vacuous, and **G2b** adds the positive control — assert the pipeline reports *no coverage*, not 0 mm/h, over a window where the answer is known.
3. **Decode cost is dominated by PNG unfiltering of whole scanlines**, so a small window still costs you every row above it. Decoding rows 0–1590 of 3500 for a Maryland window took ~3 s per frame in Python. A four-hour event at 2-minute cadence is 121 frames per field. Budget for it; cache aggressively; the files are ~1 MB each compressed.
4. **The hourly accumulation products are stamped with the END of their accumulation window, not the start.** This is new in this revision and it is the trap that cost me the most. `hour_label_test.py` integrates the 2-minute `PrecipRate` box-mean over `[T−1h, T)` and over `[T, T+1h)` and asks which reproduces the hourly file stamped `T`:

   | Case | Hours fully covered both ways | Mean abs error, **end**-of-window reading | Mean abs error, **start**-of-window reading |
   |---|---|---|---|
   | Ida / Philadelphia 2021 | 4 | **0.07 mm** | 6.91 mm |
   | Ellicott City 2016 | 3 | **1.40 mm** | 34.98 mm |

   Ida's four hours agree to 0.07 mm: the file stamped `2021-09-02T00:00Z` carries 15.07 mm and the rate frames from 23:00Z to 00:00Z integrate to 15.08 mm. So `RadarOnly_QPE_01H_00.00_20210902-000000` is the accumulation for **23:00–00:00Z**.

   **A measurement that looks like it settles this does not.** SPA-94's M14 establishes that the archived hourly products are *clock*-hourly — 24 files per day, spaced exactly 60 minutes, on both hosts and in both eras — which is genuinely useful, because it means §2.1 step 3 needs no reconstruction from running sums. But **file spacing says nothing about which hour a file covers**, and the two measurements are complementary rather than redundant: M14 fixes the *grid*, trap 4 fixes the *offset*. A reader who had only M14 would reasonably take the file stamped `T` to cover `[T, T+1h)`, which is the reading measured wrong here by 6.91 mm against 0.07 mm over four Ida hours. Both facts have to travel together.

   Two consequences, and both bit this document. First, it is a free and strong cross-validation: `PrecipRate` integrated over an hour reproduces `RadarOnly_QPE_01H` to about 1 %, which means my reader, the 2-minute product and the hourly product all agree, and §4's renormalisation `K` is therefore a correction for gauges rather than for a product inconsistency. Second, **a one-hour alignment error reads an event's peak hour off by one hour**, which is exactly how the Ida rate census in the first revision came to start at 23:00Z and miss the 22:00–23:00Z peak hour entirely (§7.5). Any pipeline that aligns an accumulation product to the start of its stamp will mis-time every hyetograph it builds, and will do it silently, because the volume still looks right.

### 2.5 What must never be the forcing

| Never force with | Measured consequence |
|---|---|
| `MergedReflectivityQCComposite` or any dBZ field | It is not rainfall. MRMS itself chooses among six Z–R relations plus two dual-pol relations per pixel; a single Marshall–Palmer conversion contradicts the product. |
| `MultiSensor_QPE_01H_*` / `GaugeCorr_QPE_01H` **directly** | **Measured on four real storms: peak 2-min catchment intensity −30.4 % to −58.9 %, peak 10-min −21.6 % to −55.9 %, peak single pixel −54.0 % to −75.6 %; event volume exact in every case.** On an idealised isolated cell the same comparison reaches −83 % / −93 %, which is an upper bound and not the expected error. (§4.1, §4.2) |
| `RadarOnly_QPE_15M` | Peak 10-min catchment intensity: **−34 to −48 %**. Peak 2-min single-pixel: **−71 %**. (§4) |
| `PrecipRate` **sub-sampled** to 5 minutes to save bandwidth | Peak-pixel accumulation **+22 %**, catchment accumulation **−9 %**, peak 10-min intensity **−9 to −20 %**, peak 2-min single-pixel **−59 %**, all without advection correction; advection correction recovers them (§4). Tested at 5 minutes; coarser sub-sampling will be worse. |
| An areal reduction factor applied on top of a radar field | Double-counting. ARFs exist to convert a *point* design depth into an areal one. A radar field is already areal. ARF belongs to the Atlas 14/15 design-storm path only, and the two paths must not share that code. |

---

## 3. Beam geometry and coverage, computed per case

`research/radar_qpe/geometry.py`. Great-circle range and azimuth; beam height under the standard 4/3 effective-earth refraction model, `h = sqrt(r² + (k a)² + 2 r (k a) sin θ) − k a + h_feed`, `k a = 8494.7 km`; lowest WSR-88D tilt 0.5° with a 0.925° half-power beamwidth, TDWR 0.3° and 0.55°. Radar coordinates and tower heights from the NWS/NCEI WSR-88D site table (NAD83).

| Catchment | Radar | Range km | Az ° | Beam centre above catchment, m | Beam bottom, m | Sample width km | Sample depth km |
|---|---|---|---|---|---|---|---|
| **Ellicott City** (Tiber outlet) | **KLWX** Sterling VA | **67.2** | 061 | **850** | 308 | **1.08** | 1.08 |
| | TBWI BWI TDWR | 24.3 | 324 | 163 | 46 | 0.23 | 0.23 |
| | KDOX Dover AFB | 127.0 | 293 | 1971 | 946 | 2.05 | 2.05 |
| | KCCX State College | 210.8 | 150 | 5098 | 3397 | 3.40 | 3.40 |
| **Meyerland / Brays Bayou** | **KHGX** League City TX | **43.5** | 302 | **501** | 150 | **0.70** | 0.70 |
| | THOU Hobby TDWR | 27.9 | 311 | 232 | 99 | 0.27 | 0.27 |
| | TIAH Intercontinental TDWR | 44.0 | 166 | 427 | 215 | 0.42 | 0.42 |
| **Philadelphia** (Center City) | **KDIX** Mount Holly NJ | **63.9** | 270 | **851** | 335 | **1.03** | 1.03 |
| | TPHL Philadelphia TDWR | 7.8 | 265 | 99 | 62 | 0.07 | 0.07 |
| **Norfolk** (Sewells Point) | **KAKQ** Wakefield VA | **65.1** | 103 | **869** | 343 | **1.05** | 1.05 |
| | KDOX Dover AFB | 232.5 | 199 | 5229 | 3354 | 3.75 | 3.75 |
| | KMHX Morehead City NC | 236.2 | 013 | 5357 | 3452 | 3.81 | 3.81 |
| **Charleston** (peninsula) | **KCLX** Grays SC | **105.0** | 082 | **1621** | 774 | **1.69** | 1.69 |
| | KMHX Morehead City NC | 359.0 | 233 | 10729 | 7834 | 5.80 | 5.79 |

Four readings of this table matter.

**A 1 km product is not a 1 km measurement.** At 67 km from KLWX the beam is 1.08 km across and 1.08 km deep. The Tiber Branch watershed is 3.7 mi² = **9.6 km²**, about 3.1 km across. So the radar's sampling volume cross-section is roughly a ninth of the catchment area, and the 1 km grid is at the edge of over-resolving its own observation. Spatialising rainfall over Ellicott City is worth doing, but the gain is in getting the *intensity and timing* right rather than in resolving structure within the catchment; there is not much structure a 1.08 km sample can resolve across 3.1 km.

**The TDWRs look tempting and should not be counted on.** TBWI at 24.3 km and TPHL at 7.8 km would transform the geometry. Two reasons not to assume them: TDWR is **C-band**, which attenuates severely in exactly the >100 mm/h cores at issue in cases 1 and 5; and while MRMS's reflectivity mosaic ingests 15–19 TDWRs, I could **not** confirm from the published documentation that TDWR enters the *QPE* seamless hybrid-scan reflectivity, which is built on the WSR-88D and Canadian networks. **Treat TDWR as not contributing to the QPE until the Geospatial Engineer confirms it from the MRMS source or configuration.** If it does contribute, that is good news to be documented, not assumed.

**Charleston is a poor radar site for coastal rain.** KCLX sits 105 km inland-southwest of the peninsula, so the lowest beam centre is **1621 m above the catchment** — nearly twice Norfolk's 869 m — in a 1.69 km sample, with the next nearest radar 359 km away. For shallow tropical and warm-rain showers with low echo tops, a 0.5° beam centred at 1.6 km is close to sampling above the layer producing the rain. This is the main reason case 6 should be Norfolk and not Charleston.

**Norfolk has no radar redundancy.** KAKQ at 65.1 km is good; the next radar is 232 km away at 5.2 km beam height, which is useless for QPE. A KAKQ outage or a volume-coverage-pattern change during 8–9 October 2016 would therefore hit the whole event with no fallback. That is a named pre-registration check in §9, not a reason to reject the case.

On blockage: KLWX→Ellicott City (azimuth 061°) and KAKQ→Norfolk (103°) both cross low, flat terrain — Piedmont and coastal plain respectively — with no ridge line intersecting a beam whose bottom is already 308 m and 343 m above the surface. KLWX's known blocked sector is west-northwest toward the Blue Ridge, away from Ellicott City. KHGX→Meyerland and KDIX→Philadelphia are over flat coastal plain. I regard terrain blockage as a non-issue for all five CONUS catchments, and for 2017, 2018 and 2021 that judgement is checkable against the archived `RadarQualityIndex` field; for 2016 it is not (§1.1).

On bright band: the melting layer sits near 4–5 km in all the relevant seasons (late July, late May, late August, early September, early October) — that figure is seasonal climatology, not an event sounding, and the margin below is large enough that it does not need to be better than that. The lowest-tilt beam top is 1.4 km MSL at Ellicott City, 0.9 km at Meyerland, 1.4 km at Philadelphia and Norfolk, and 2.5 km at Charleston. **No case samples the bright band at the lowest tilt.** Bright-band contamination is not a live failure mode for this case set — which is worth saying plainly, because it is the failure mode people reach for first. Where it would matter is a cool-season event, and there is none in Phase 1. For v12 cases, `BrightBandTopHeight`/`BottomHeight` are archived and this is directly verifiable; for the pre-v12 cases it rests on the geometry above plus `Model_0degC_Height`, which is not in the pre-2020 MTArchive subset either.

---

## 4. Forcing cadence — the measured requirement with the largest number attached

### 4.1 The measured number, on real storms

**This subsection is new in revision 2 and it replaces the headline the first revision led with.** The first revision quoted **−83.9 %** for the peak-intensity cost of hourly forcing and called it "a factor of six". That number is from an idealised single Gaussian cell (§4.2), not from data, and it is too large. Here is the same comparison measured on **all four storms** for which a 2-minute series exists, by `review_followups.py`. Both Ellicott City 2018 and Ida use the census windows corrected in revision 2 (§7.1, §7.5).

| Case | Peak 2-min box-mean | Peak 10-min box-mean | Peak 60-min box-mean | Peak hour, `RadarOnly_QPE_01H` | **Hourly forcing vs peak 2-min** | vs peak 10-min | vs peak single pixel |
|---|---|---|---|---|---|---|---|
| **Ida / Philadelphia 2021** (120 km²) | 96.0 mm/h | 89.4 mm/h | 48.5 mm/h | 39.5 mm/h | **−58.9 %** | **−55.9 %** | −75.6 % |
| **Harvey / Brays Bayou 2017** (150 km²) | 130.7 mm/h | 121.6 mm/h | 79.9 mm/h | 79.9 mm/h † | **−38.9 %** | −34.3 % | −57.8 % |
| **Ellicott City 2016** (36 km²) | 105.2 mm/h | 89.4 mm/h | 74.1 mm/h | 70.1 mm/h | **−33.4 %** | −21.6 % | −54.0 % |
| **Ellicott City 2018** (36 km²) | 61.2 mm/h | 58.2 mm/h | 42.7 mm/h | 42.6 mm/h | **−30.4 %** | −26.8 % | −59.0 % |

† For Harvey the 60-min rolling mean of the 2-minute series stands in for the hourly product, which was not pulled over this box.

**The honest figure is a range, not a single number: hourly forcing costs between 30 % and 59 % of peak catchment intensity, median about 36 %.** The reviewer's estimate of −33 % was right for the case it was computed on, and that case turns out to be the *mildest* of the four. Ida is the worst by a wide margin at **−58.9 %**, and it is worth seeing why: its peak hour is 39.5 mm as a box mean while its peak two minutes run at 96 mm/h, so the storm delivered its rain in short bursts inside an otherwise moderate hour — exactly the structure an hourly product destroys and exactly the structure a combined-sewer case exists to test.

So the conclusion is unchanged and the margin is **wider than the reviewer's single figure implied**, while still well short of the synthetic −83.9 %. The "factor of six" line is withdrawn; "between a third and three fifths of the peak" is what the data supports.

Two caveats stated rather than buried. The error depends on what you compare against: against peak *10-minute* intensity, closer to the response time of a small catchment, it ranges −21.6 % to −55.9 %. Against peak *single-pixel* 2-minute intensity it is **−54 % to −76 %**, because an hourly box mean averages away the spatial peak as well as the temporal one. The row to quote depends on which the hindcast is sensitive to, and the pre-registration should say which. And note that the four cases do not rank by storm severity — they rank by **burstiness relative to the hour**, which is not something you can predict from an event's depth, so this has to be measured per case rather than assumed.

### 4.2 The idealised bound, labelled as idealised

`research/radar_qpe/advection_test.py`, full output in `out/advection.txt`. A Gaussian rain cell of 100 mm/h peak and 1.5 km σ translates across a 1 km grid at a known velocity. Truth is the analytic field, so errors are exact, not relative to a reference implementation. The integrator is checked against the closed-form accumulation on the track line, `A = R₀ σ √(2π) / V`, and agrees to **0.000 %** in all eleven configurations — so the harness itself is not the source of any error below.

**These are synthetic numbers and they are an upper bound, not an expectation.** A single 1.5 km σ cell crossing a 9 km² catchment is the most temporally peaked forcing that can physically occur there, so hourly averaging destroys proportionally more of it than it destroys of a real storm with multiple cells and a broader envelope. Read §4.1 for what to expect and this table for what the worst case looks like.

Signed error against truth, per cent. `HOLD` = hold each frame until the next; `LIN` = in-place linear blend; `ADV3` = advection-corrected with a cubic resampler.

| Forcing source | Event volume on 9 km² | Peak 10-min intensity on 9 km² | Peak 2-min intensity on 1 km² |
|---|---|---|---|
| 2-min **rate** frames, `LIN` | 0.0 | −0.8 | −7.9 |
| 2-min **rate** frames, `ADV3` | 0.0 | +0.1 | −0.5 |
| 5-min rate frames (sub-sampled), `LIN` | **−9.4** | **−19.8** | **−58.9** |
| 5-min rate frames, `ADV3` | −0.0 | +0.1 | −0.5 |
| 5-min **accumulation** product, `ADV3` | 0.0 | −29.6 | −32.9 |
| **15-min accumulation** (`RadarOnly_QPE_15M`), `ADV3` | 0.0 | **−33.9** | **−70.5** |
| **60-min accumulation** (`MultiSensor_QPE_01H`), `ADV3` | 0.0 | **−83.9** | **−92.7** |

Read the first column and the last two together. **Accumulation products get the volume exactly right and the peak intensity wrong, and no amount of interpolation recovers it, because the information is not in the file.** An hourly-forced run of Ellicott City would close its water balance to round-off, print a plausible event depth, and under-predict the peak catchment intensity by **a third on the measured storm (§4.1)**, up to the −83.9 % above for an idealised isolated cell. If that run then under-predicted the flood, the miss would land on the solver.

This is the single most important line in this document: **the forcing must be driven from `PrecipRate` at its native cadence.** Everything else in §5 is a refinement on top of it. Note that it survives the correction in §4.1 comfortably: the requirement never depended on the synthetic figure being right, only on the error being large compared with everything else in the error budget, and a third of peak intensity is.

---

## 5. Advection correction — specification and acceptance tests

### 5.1 What the motion estimation has to do, before anyone builds the interpolation

Requirements, in the order they bind:

- **R1. It must produce a displacement, not a velocity.** The interpolator needs `(Δx, Δy)` in kilometres for the specific frame pair `(k, k+1)` and its specific time gap, including when that gap is not 120 s because a frame is missing from the archive (§1.1 shows this happens). Publish `(u, v)` in m/s **and** the gap in seconds used, and let the interpolator multiply. A pipeline that assumes 120 s will silently mis-advect across every archive gap.
- **R2. It must be estimated over a window far larger than the model domain.** A FloodSim domain of 5 km × 5 km is **25 MRMS pixels**. Cross-correlation or optical flow on 25 pixels is not an estimate of anything. Specify a motion-estimation halo of **±75 km** around the domain centre (a 150 km box, ~150 × 150 pixels), masked to the precipitating area. The forcing field stays domain-sized; only the motion estimate uses the halo.
- **R3. It must be temporally smoothed and gated.** Median-filter the estimate over ±3 frame pairs (±6 min). Reject any estimate with speed > 40 m/s or with a correlation peak below a stated threshold, fall back to the smoothed previous estimate, and **flag the frame pair in the run provenance.** A silent fallback is how a motion field becomes wrong without anyone noticing.
- **R4. It must report its own residual, per frame pair.** Advect frame `k` forward by the full frame interval and compare with the observed frame `k+1`. That residual needs no truth field, so it works on real data, and it is the estimator's own confession. Report its RMSE as a percentage of the frame peak, per pair, and its distribution per run. On a pure translation my implementation achieves 0.03–0.18 % of peak (§5.4); on real data, growth, decay, rotation and splitting will make it far larger, and *how much larger* is the number that tells you whether a single translation vector was an adequate model for this storm.
- **R5. It must not extrapolate.** No motion estimate may be used to produce a field later than the newest observed frame. This is the board's live-mode decision and it belongs in the motion module, not only in the UI.
- **R6. Its accuracy requirement is modest, and here is the measurement.** A ±50 % speed error (15 → 22.5 m/s) costs 0.1 % of the peak 10-min catchment intensity and 3.0 % of the peak 2-min single-pixel intensity. A 20° direction error costs 1.1 % and 2.1 %; 45° costs 4.4 % and 6.8 %. **Specification: direction within ±20°, speed within ±50 %.** That is an undemanding target, and it has a direct consequence: **a single domain-wide translation vector is sufficient, and dense optical flow is not required for the forcing.**

### 5.2 Method

**Build this.** Normalised cross-correlation (block matching) of successive `PrecipRate` frames over the §5.1-R2 halo, on `log(1 + rate)` to stop the brightest core dominating, with a search radius of ±25 pixels, integer-pixel search followed by **parabolic sub-pixel refinement** on the correlation peak, yielding one `(Δx, Δy)` per frame pair. Then **semi-Lagrangian advection-corrected interpolation**: for a target time `t` between `t_k` and `t_{k+1}`, forward-advect frame `k` by `U·(t − t_k)`, backward-advect frame `k+1` by `−U·(t_{k+1} − t)`, and blend linearly in `t`. This is the standard Anagnostou–Krajewski advection correction with a Bowler-style motion estimate.

**Resample with a cubic (Catmull–Rom) kernel, clamped at zero, not bilinear.** Measured: at the mid-frame instant with 2-minute frames and a 1.5 km cell, the cubic recovers 98.4 % of the true peak against bilinear's 96.8 %, and for a 0.75 km core 98.0 % against 94.0 %. On the hydrological metrics cubic beats bilinear by a factor of three or more on peak 2-minute single-pixel intensity in every configuration tested. The cost is one extra kernel tap each way.

**Do not build optical flow yet.** By R6 it is not needed for the forcing. The condition under which it becomes necessary is measurable and should be a follow-up ticket, not a guess: **if R4's one-frame-ahead residual on real case data exceeds 15 % of the frame peak for more than a quarter of the frame pairs in an event, the single-vector model is inadequate for that event and a dense field (pyramidal Lucas–Kanade or Farnebäck on the same log-rate field) is justified.** Measure first.

**Order of operations is not negotiable.** Advect and integrate *first*, then renormalise to the hourly product (§2.1). Renormalising first and advecting second moves gauge-corrected mass between pixels and breaks the hourly totals the correction was there to impose.

### 5.3 What advection correction does not do

With true 2-minute independent frames, in-place linear interpolation is already within **0.0 % on 9 km² event volume, 0.8 % on peak 10-minute catchment intensity, and 7.9 % on peak 2-minute single-pixel intensity.** On a 9 km² catchment with a ~20-minute response time, that is not the error that decides a hindcast.

So advection correction is **not** justified by the forcing metrics at a 2-minute cadence, and §5.5 shows the cadence is not masking a 4–6 minute volume scan. *Revision 2 qualification:* §5.5.1's completed census puts the **effective new-observation interval at 2.96 min** over the Ellicott City 2016 catchment, not the 2.0–2.3 min §5.5 first reported, so the real gap is nearer 3 minutes than 2 and the in-place penalty is correspondingly nearer §4.2's 5-minute row than its 2-minute row — still much nearer the latter. The ranking below is unchanged; point 3 gains weight. It is justified by three things that are real, and I would rather the programme build it for those than for a reason that does not survive a measurement:

1. **The instantaneous field — the main reason.** At the mid-frame instant, in-place blending renders a cell as two half-weighted copies 1.8 km apart. It recovers only **59 % of the true peak for a 0.75 km core, 74 % for a 1.0 km core and 86 % for 1.5 km**, and for the 0.75 km core it places the field maximum **0.69 km from the truth**. Holding the previous frame instead displaces the whole field by **0.81–0.89 km**, about half a frame's travel, every time. Advection correction with a cubic kernel brings both to **≥ 98 % of peak and ≤ 0.14 km**. Phase 3e's exit criterion is "the replay shows the cell tracking across the catchment in the right place at the right time" — that criterion is a statement about the instantaneous field, and this is the thing that satisfies it. A reviewer watching the replay will see a cell stutter between two positions, and will be right to.
2. **Peak intensity on small, fast-responding areas.** 7.9 % on the peak 2-minute single-pixel intensity, rising to 21.5 % at 25 m/s cell motion. For a 9 km² catchment at 10-minute resolution this is noise; for an inlet-scale or single-block question — which is what case 5's 127 PWD grates are — it is not.
3. **Robustness to gaps, to coarser cadence, and to the weak-update runs §5.5.1 measures.** When a frame is missing (§1.1 shows this happens) the gap doubles, and at a 5-minute effective interval the in-place penalty is **−19.8 % on peak 10-minute catchment intensity and −58.9 % on peak 2-minute single-pixel intensity**, which advection correction recovers to +0.1 % and −0.5 %. This point gained weight in revision 2: **32.5 % of frame pairs over the 2016 Ellicott City catchment carry less than a quarter of a field's worth of new information** (§5.5.1), so the "effective gap doubles" case is not a rare archive accident on the pre-v12 cases — it is one pair in three. Advection correction plus the duplicate guard turns those into non-events and makes the pipeline robust to a cadence it does not control.

**And the ranking matters more than the verdict.** Against the measured **−33 %** error in §4.1, advection correction is a second-order effect on the forcing. If there is effort to spend on rainfall before Phase 1, spend it in this order: force from the 2-minute rate product (§4); run the cap and gauge-influence censuses (G3, G4) so the per-case verdicts are evidence-based; then build advection correction in the modest form of §5.2. The ticket's worry that an Ellicott City hindcast could fail on a rainfall error and have the miss blamed on the solver is exactly right — but the error it would fail on is the rate cap (§7.1), not the smearing.

### 5.4 Acceptance tests — four, and the controls are part of the test

`advection_test.py` implements all four and prints controls beside the method under test. **A test that the naive control also passes has no power over what it claims to test**, so no threshold below is acceptable without its control value reported next to it.

**T1 — Resampler self-test (must run first; it is the one that catches the bug that matters).** Shift a delta function by an integer `(+3, +2)` pixels and assert the maximum lands exactly at `(+3, +2)` **in the right direction**; assert bilinear is exact on a linear ramp. *This is not a formality.* My first implementation had the shift sign inverted, which advected frame `k` backwards and frame `k+1` forwards, tripling the effective separation. The result was that the "advection-corrected" field recovered only 57 % of the mid-frame peak against the naive method's 86 % — **advection correction measurably worse than doing nothing** — and every aggregate metric looked merely disappointing rather than broken. An integer-shift assertion catches it in one line. Make it a merge gate.

**T2 — Synthetic translating cell against the analytic solution.** The sweeps in §4 and §5.1-R6. Acceptance on the method under test, each reported with its `LIN` control:

| Metric | Threshold on \|error\| | `LIN` control for comparison |
|---|---|---|
| Domain-total volume | ≤ 0.5 % | 0.0 % |
| 9 km² catchment accumulation | ≤ 1.0 % | 0.0 % |
| Peak 10-min 9 km² intensity | ≤ 2.0 % | −0.8 % |
| Peak 2-min 1 km² intensity | ≤ 2.0 % | −7.9 % |
| Mid-frame peak ratio | ≥ 0.97 | 0.86 |
| Mid-frame field-maximum displacement | ≤ 0.25 km | 0.00–0.69 km |

The last two rows are where the method has to earn its place; the first four are there to prove it did not break anything on the way.

**T3 — Frame-holdout on real case data.** Take the real `PrecipRate` sequence over a case, drop two of every three frames to simulate a 6-minute cadence, reconstruct the withheld frames, and score against them. Required: the advection-corrected reconstruction must beat in-place interpolation on field RMSE, on peak-pixel rate, and on catchment-mean accumulation, **and the improvement must be reported as a number for each Phase 1 case in its pre-registration.** This is the test that uses the data the pipeline already has and makes no assumption about cell shape.

**T4 — One-frame-ahead residual, every run.** §5.1-R4. Not a pass/fail gate but a per-run reported distribution, and the trigger for the optical-flow decision in §5.2.

### 5.5 Is the 2-minute cadence real? A hypothesis of mine, measured, and refuted

Reading the 2016 Ellicott City frames I noticed consecutive 2-minute fields that were bit-identical over the catchment, and formed a hypothesis: MRMS publishes a mosaic every 2 minutes, but the reflectivity behind any pixel comes from a WSR-88D volume scan that takes ~4.2 min on VCP 12, ~4.5 on VCP 212 and ~6 on VCP 21. If the publication cadence were masking a volume-scan observation cadence, the real gap to be bridged would be 3.5–4.5 km of cell motion rather than 1.8 km, and the in-place penalty would jump from §5.3's "within 1 %" to §4's "−19.8 % and −58.9 %" row. That would have made advection correction mandatory on forcing grounds.

**I measured it and the hypothesis is wrong.** `refresh_probe.py` counts bit-identical consecutive frame pairs over each catchment window, restricted to pairs where there is rain to compare:

| Window | Frames | Pairs scored | Bit-identical | % identical | Mean effective refresh | Run lengths |
|---|---|---|---|---|---|---|
| Ellicott City, 2016-07-30 22:00Z – 07-31 02:00Z | 121 | 117 | 17 | **14.5 %** | **2.34 min** *(superseded: 2.96 min, §5.5.1)* | 84 × 1, 17 × 2 |
| Ellicott City, 2018-05-27 17:30Z – 21:00Z | 106 | 93 | 5 | **5.4 %** | **2.11 min** | 86 × 1, 1 × 2, 2 × 3 |
| Philadelphia, 2021-09-02 00:00Z – 04:00Z | 121 | 118 | 0 | **0.0 %** | **2.00 min** | 119 × 1 |

*(The "2.0–2.3 minutes" conclusion in this paragraph is corrected to 2.0–3.0 minutes by §5.5.1 below, on a better metric. The refutation of the 4–6 minute hypothesis stands; read the two together.)*

The effective refresh is **2.0–2.3 minutes**, not 4–6. Runs of identical frames are almost all of length 2, none longer than 3, and over Philadelphia in 2021 there is not a single duplicate pair in 118. **The 2-minute cadence is substantially real**, the frames do carry new information, and §5.3's conclusion stands as measured: with 2-minute frames, in-place interpolation is adequate for catchment-scale forcing and advection correction earns its place on the instantaneous field instead. The duplicate fraction is also worse in the older, single-polarisation era (14.5 % in 2016, 5.4 % in 2018, 0 % in 2021), which is worth knowing when reasoning about the pre-v12 cases but does not change the conclusion for any of them.

`refresh_probe.py` also defines the Harvey and Matthew windows; I stopped it after three to free archive bandwidth for the rate-field measurements in §7, so those two rows are unmeasured. The three above are enough to settle the question, and gate G7 runs the remaining ones per case anyway.

I am recording the refuted hypothesis rather than deleting it because it is the kind of thing that gets asserted confidently in a design review, and the measurement is four lines of code.

**One requirement does survive, and it is now justified by a number.** 14.5 % of frame pairs over the Ellicott City 2016 catchment are bit-identical. Cross-correlating two identical frames returns **zero displacement with a perfect correlation score** — a confidently wrong answer that passes every peak-quality gate R3 could impose, on one pair in seven. **Specification: detect duplicate frames, exclude them from the motion estimate, and carry the previous displacement across the duplicate run using the real elapsed time.** This is §5.1-R1 again, and this measurement is the concrete reason R1 exists.

> **Superseded by [Addendum A §A.7](SPA-93_addendum_A_ingestion_response.md#a7-frames-are-not-duplicated--and-spa-94s-intuition-was-better-than-my-measurement).** Bit-identity is too strict a test for "carries new information" — one pixel moving 0.1 mm/h makes a frame non-identical while 98 % of the field is stale, and measured pairs exist that changed only 2 % of their wet pixels and were *not* counted as duplicates here. The guard must key on the **fraction of wet pixels changed**, with a low-information threshold of 0.25, not on byte-equality. The conclusion that the publication cadence is not masking a 4–6 minute volume scan survives; the claim that the frames are therefore substantially independent does not.

#### 5.5.1 The census finished, and it moves my own number — "2.0–2.3 min" was too generous

I told the board this census would decide whether advection correction moves from third priority to second. It has finished (`update_census.py`, `out/measured_update_census.json`) and the answer is **no, it stays third — but the margin is narrower than §5.5 claimed and the duplicate-frame guard matters more than I said.**

Scoring on the *fraction of wet pixels changed* rather than byte-equality, with a weak-update threshold of 0.25:

| Window | Pairs | Bit-identical | **Weak updates (<25 % of wet pixels changed)** | Pairs >90 % changed | **Implied new-observation interval** |
|---|---|---|---|---|---|
| Ellicott City 2016, 22:00Z–02:00Z | 117 | 17 (14.5 %) | **32.5 %** | 53.8 % | **2.96 min** |
| Ellicott City 2018, 17:30Z–21:00Z | 93 | 5 (5.4 %) | **19.4 %** | 39.8 % | **2.48 min** |
| Ida / Philadelphia, 00:00Z–04:00Z | 118 | 0 (0.0 %) | **0.0 %** | 97.5 % | **2.00 min** |

**So §5.5's headline figure of "2.0–2.3 minutes" was wrong, and wrong in the direction that flattered my conclusion.** The honest range is **2.0 to 3.0 minutes**: the proper metric more than doubles the weak-update fraction for 2016 (14.5 % → 32.5 %) and pushes the effective interval to 2.96 min. At 15 m/s that is **2.7 km of cell motion between genuinely new observations rather than 1.8 km** — half a pixel further than the ticket's premise assumed, not less.

Three things follow, and I am separating them because they point in different directions.

- **The original hypothesis is still refuted.** 2.96 min is not 4–6 min. The publication cadence is not a thin veneer over a volume scan, and §5.3's conclusion — that in-place interpolation is adequate for *catchment-aggregate* forcing at this cadence — survives. Interpolating from §4.2's table, a 3-minute effective gap sits between the 2-minute row (−0.8 % on peak 10-min) and the 5-minute row (−19.8 %), nearer the former.
- **Advection correction stays third in priority**, behind 2-minute forcing and the per-case censuses, for the reason §5.3 gives: it earns its place on the *instantaneous* field for the replay, not on the forcing aggregates. Nothing in this census changes that ordering. I am recording that explicitly because I promised the board a decision from it.
- **The duplicate-frame guard moves up, and its threshold is now justified by a number.** On the 2016 Ellicott City window **one pair in three** carries less than a quarter of a field's worth of new information. Cross-correlating such a pair returns a displacement near zero with a high correlation score — a confidently wrong answer that passes any peak-quality gate R3 could impose, on 32.5 % of pairs rather than the 14.5 % §5.5 claimed. The guard in §5.5's closing specification is therefore load-bearing, and the `frac_wet_changed < 0.25` criterion from Addendum A §A.7 is the right test. Gate **G7** now reports both metrics per case.

Note the era dependence, which is sharper on the corrected metric than on the old one: 32.5 % weak pairs in 2016, 19.4 % in 2018, **0.0 % in 2021**. The pre-v12 single-polarisation cases are the ones that need the guard; the v12 case does not. That is the opposite of convenient, because the pre-v12 cases are also the ones with the rate caps.

#### 5.5.2 The guard as a named parameter — values, metric, and the scope error the name invites

SPA-94 §7 holds the weak-update threshold as a run parameter with **no default**, so a run cannot start until this role sets it. Setting it, with the metric defined precisely enough that it cannot be implemented as a different statistic from the one measured above (`update_census.py`):

| Parameter | Value | Definition |
|---|---|---|
| `dedupe.wetThreshold` | **1.0 mm/h** | A pixel is *wet* for this test if **either** frame of the pair is ≥ 1.0 mm/h. Below that a pixel carries no information an advection scheme can use, and including the near-zero field would let a large dry area dilute the statistic to meaninglessness. |
| `dedupe.threshold` | **0.25** | A frame pair is a *weak update* if the fraction of wet pixels whose value changed is **< 0.25**. "Changed" is exact inequality of the decoded physical value, i.e. a change of one 0.1 mm/h quantum counts. |
| scoring window | the **motion-estimation halo** (§5.1-R2), not the model domain | A 25-pixel domain gives a fraction with no resolution; the measurements above used a catchment box and are therefore, if anything, conservative. |

**The value is not a guess.** 0.25 is the threshold at which the three measured windows separate cleanly: at `frac_wet_changed < 0.25` the weak-update fraction is 32.5 % / 19.4 % / 0.0 % across the 2016, 2018 and Ida windows, against the 53.8 % / 39.8 % / 97.5 % of pairs that changed more than 90 % of their wet pixels. The distribution is bimodal, and 0.25 sits in the gap rather than on a shoulder. Report the realised distribution per run regardless, because a case whose distribution is *not* bimodal is a case where this parameter is doing something I have not measured.

**And the name invites a scope error that would lose rainfall.** `dedupe` suggests removal. A weak-update frame must **not** be removed:

- **Motion estimate: exclude.** Do not cross-correlate a weak pair. Carry the previous smoothed displacement across the weak run, scaled by the *real* elapsed time (§5.1-R1), and flag the pair in the run provenance.
- **Forcing integration: keep, always.** The rate field still covers those 120 seconds of real time and the rain still fell. Dropping a weak frame from the accumulation deletes its contribution, and because the hourly renormalisation `K` (§2.1) would then quietly scale the remaining frames back up to the hourly total, **the event volume would still balance** — so no water-balance check would catch it, and the damage would appear only as a distorted hyetograph shape. This is the same failure mode as the hour-label error in §2.4 trap 4, arriving by a different route.
- **Display layer: keep, always.** A dropped frame is a visible stutter in the replay, and the replay is the Phase 3e exit criterion.

One frame pair in three on the 2016 Ellicott City window is a weak update, so this is not a corner case on the case the programme most wants.

---

## 6. Gauge–radar bias: measured and reported, never applied invisibly

### 6.1 The statistic

For every radar-forced run, over the model domain plus a 10 km buffer, compute and print:

- Per gauge `i`, the event-total ratio `B_i = G_i / R_i`, with `R_i` taken both as the containing pixel and as the 3×3 pixel mean. Report both; a large difference between them is itself a diagnostic of a point-to-pixel mismatch rather than a bias.
- **Aggregate multiplicative bias** `B = ΣG_i / ΣR_i` (volume-weighted).
- **Geometric mean of the per-gauge ratios and its log-space standard deviation.** Gauge/radar ratios are log-normally distributed; an arithmetic mean of ratios is the wrong statistic and will read high.
- `n`, min, max, the fraction of gauges within ±25 %, RMSE in mm, and the correlation.
- **The same set per hour, not only per event.** §7.4 shows a case where the event bias is a clean 0.83 and the hourly bias crosses 1.0 mid-event. A single event number would have hidden that.

### 6.2 Which gauges — and the independence problem

`MultiSensor_QPE_*` and `GaugeCorr_QPE_01H` already ingest hourly gauges. Scoring them against those same gauges is partly self-referential and will flatter the product.

**Specification: report two arms separately.**

- **Independent arm.** `RadarOnly_QPE_01H` and the `PrecipRate`-derived forcing against gauges MRMS did not use. This is the physically meaningful gauge–radar bias. Candidate independent networks per case: **CoCoRaHS** daily (not in the MRMS operational hourly ingest), **HCFCD FWS** — 153 gauges at 15-minute resolution over Harris County, which is the best-gauged of the six catchments, **Philadelphia Water Department** gauges for case 5, Howard County / Maryland networks for case 1, and HRSD / Hampton Roads networks for case 6.
- **Residual arm.** The gauge-merged product against the same gauges. This does not measure radar bias; it measures *whether the merge worked over this catchment*. A residual arm near 1.0 can mean the merge worked — or that no gauge influenced your catchment at all. Distinguish them with `GaugeInflIndex_01H_Pass2` where it is archived (v12 only), and with §6.3 where it is not.

The run must record, per gauge, which arm it was counted in and on what basis. "Probably not in MADIS" is not a basis; the list of gauges MRMS ingested is not public per-event, so the honest formulation is **"gauges from networks not known to be in the MRMS hourly ingest"**, stated that way.

### 6.3 MRMS's own internal disagreement — free, available for every case, and not the same thing as bias

The ratio of the gauge-merged product to the radar-only product over the catchment is MRMS's own estimate of how wrong its radar-only QPE was. It costs two hourly files per hour and is archived for every Phase 1 case back to 2015. **It is not the gauge–radar bias** — it is bounded by how many gauges MRMS had and how its merge weighted them — but it is a strong and cheap signal, and it answers the question "is the word 'gauge-corrected' doing any work over my catchment?"

I measured it for all six candidate catchment/event pairs (`assess.py`, outputs in `out/measured_*.json`); §7 reports each in place. The whole table in one place, because the spread is the point:

| Case | Window | Event-total gauge-merged / radar-only, box mean | Per-pixel range | log-SD | Hourly ratio range | Reading |
|---|---|---|---|---|---|---|
| **Ellicott City 2016** | 20Z–04Z | **0.992** | 0.987–0.997 | 0.002 | 0.95–1.02 | **The gauge correction did essentially nothing.** `GaugeCorr_QPE_01H` is radar-only in all but name over this catchment. |
| **Ellicott City 2018** | 16Z–02Z | **1.005** | 0.935–1.103 | 0.043 | 0.92–1.06 | Same: 0.5 %. No independent gauge constraint over the Tiber catchment in either storm. *(Window extended to 02:00Z in revision 2; was 1.008 over 16Z–23Z.)* |
| **Harvey / Brays Bayou** | 3 days | **0.827** | 0.729–0.945 | 0.036 | **0.07–2.50** | A 17 % reduction, near-uniform in space — exactly the smooth multiplicative field §2.1 step 5 assumes. **Sign flips mid-event** (below 1 on 26–27 Aug, above 1 on the 28th). |
| **Matthew / Norfolk** | 8–9 Oct | **0.798** | 0.670–0.872 | 0.059 | **0.009–1.46** | A 20 % reduction that brings the field inside the observed gauge range (§7.6). Contains the pathological 0.009 hour that justifies the §2.1 clip. |
| **Matthew / Charleston** | 7–8 Oct | **1.240** | 1.152–1.386 | 0.046 | 0.24–3.94 | **Opposite sign**: the radar-only field is 24 % *low*, consistent with a 1621 m beam centre overshooting (§3, §7.6). |
| **Ida / Philadelphia** | 18Z–12Z | **0.599** | 0.528–0.691 | 0.065 | 0.25–1.80 | **A 40 % reduction** — the largest in the set, and the one that creates case 5's pre-registration blocker (§7.5). |

Four readings:

- **The spread runs from 0.60 to 1.24, in both directions.** Choosing "the gauge-corrected product" rather than "the radar-only product" as the forcing is a decision worth up to 40 % of the event volume, and its sign is not predictable from the storm type.
- **The two near-1.0 cases are not successes, they are absences.** A ratio of 0.992 with a log-SD of 0.002 does not mean the radar was right; it means no gauge influenced the field. Distinguishing "merge worked" from "no gauges" is what gate G4 is for.
- **Spatial structure is small in every case** (log-SD 0.002–0.065): the correction really is a smooth multiplicative field, which validates §2.1 step 5's 5 km smoothing and makes the unsmoothed per-pixel ratio an unnecessary source of 1 km noise.
- **Hourly structure is not small in any case.** Event ratios of 0.80 and 0.83 conceal hourly ratios from 0.009 to 2.5. §6.1's requirement to report per hour is not bureaucratic.

And the limit of this statistic, stated plainly: **it is MRMS disagreeing with itself, not with the ground.** It is bounded by how many gauges MRMS had and how its merge weighted them. It cannot tell you which arm is right. For that you need §6.2's independent arm, which is the longest-lead-time task in this document (§10, item 4).

### 6.4 Reporting rules

1. **No correction is ever applied on the basis of the measured bias.** The `K` field of §2.1 is a renormalisation to a *published MRMS product*, declared and reported; it is not a bias correction fitted to gauges. Fitting the forcing to gauges and then verifying against the same catchment is circular.
2. Every radar-forced run prints, in the same provenance block that already labels the drainage tiers: product name and version, pass, archive source, frame count requested / decoded / missing, the no-data flag, the `K` statistics, the duplicate-frame fraction, the motion-estimate residual distribution, and both bias arms with `n` and spread.
3. **Labelling thresholds**, applied to the independent arm:

| \|B − 1\| | Label |
|---|---|
| ≤ 0.15 | Rainfall bias within the product's expected range. Hindcast interpretable. |
| 0.15 – 0.35 | **Reported prominently.** The hindcast remains valid but the rainfall error must be carried explicitly in the error budget and must appear in the abstract of any result. |
| > 0.35 | **The hindcast cannot separate solver error from forcing error.** Say so. Report it as a rainfall-forcing result, not a solver-validation result. |

4. If `n < 3` independent gauges, there is no bias measurement — say "not measurable" rather than quoting a one-gauge ratio.

### 6.5 Bias is an event-level quantity, not an hourly one — and the sensitivity run that shows it

New in revision 2, in answer to review item 3. The reviewer observed that Charleston's hourly gauge-merged / radar-only ratio swings **0.243 → 3.934** between consecutive hours and that Norfolk shows an hour at **0.009**, and read that as a timing offset rather than real bias. That reading is largely right, it is testable, and the test splits the two cases apart. `review_followups.py`.

**Test 1 — does the spread collapse under aggregation?** If the swing is rainfall being redistributed between adjacent hours, lengthening the accumulation window should collapse the ratio's spread while leaving its centre alone. If it were real bias varying in time, the spread would persist.

Where the accumulation blocks *start* is arbitrary, and it turns out to matter, so the figures below are the **mean log-SD over every block phase** with the phase range beside it. My first pass quoted phase 0 only and that flattered the result — see the caveat after the table.

| Accumulation window | Norfolk log-SD, mean over phases (range) | Charleston log-SD, mean over phases (range) | Ellicott City 2016 **control** |
|---|---|---|---|
| 1 h | **1.145** | **0.700** | 0.028 |
| 2 h | 0.317 (0.242–0.392) | 0.632 (0.574–0.690) | 0.018 (0.005–0.032) |
| 3 h | 0.263 (0.242–0.291) | 0.543 (0.383–0.708) | 0.013 (0.003–0.030) |
| 6 h | 0.224 (0.169–0.299) | 0.409 (**0.210–0.790**) | — |
| 12 h | **0.139** (0.003–0.285) | **0.132** (0.017–0.258) | — |

It collapses — Norfolk by a factor of 8 in log-SD from 1 h to 12 h, Charleston by a factor of 5 — while the median ratio barely moves (Norfolk 0.909 → 0.808; Charleston 1.532 → 1.254). Ellicott City 2016 is the control and behaves as a control should: where the gauge correction is doing nothing at all (ratio 0.992), the hourly ratio is already stable at log-SD 0.028 and there is nothing for aggregation to fix. **So the hourly ratio is not an estimate of bias. It is an estimate of bias plus an hour-scale redistribution term that dominates it.**

**One caveat I found by checking my own result, and it weakens the clean version of this claim.** The collapse is **not monotone in Charleston and is phase-dependent**. At a 6-hour window, one block phase gives log-SD 0.210 and another gives **0.790 — higher than the 1-hour value of 0.700**. My first table quoted phase 0 at every window, which happened to be the most favourable phase for Charleston (0.210 at 6 h), and so presented a tidier collapse than the data supports. Norfolk's collapse is robust to phase; Charleston's is only clearly established at the 12-hour window. The specification below is unaffected, because it keys on the 1 h and 12 h figures where both cases agree, but a reader should know that the intermediate windows for Charleston are noisy and that the tidiness of a single-phase table was an artefact of my choice of phase.

**Test 2 — is there a net timing offset?** Lagged Pearson correlation of the two hourly series:

| Case | Best lag of the gauge-merged product | r at best lag | r at lag 0 | Reading |
|---|---|---|---|---|
| **Norfolk** | **0 h** | 0.893 | 0.893 | No net offset. The 0.009 hour is an isolated single-hour merge or gauge-QC artefact, not a shift. |
| **Charleston** | **−1 h (gauge product one hour late)** | 0.778 | 0.540 | A genuine one-hour offset, confirming the reviewer's hypothesis for this case. |
| Ellicott City 2016 (control) | 0 h | 0.9993 | 0.9993 | As expected where the correction is inert. |

So the reviewer is right about Charleston and right for a different reason about Norfolk. A one-hour offset in an hourly gauge merge has an obvious candidate mechanism — an hourly gauge network reporting on standard rather than daylight time is exactly one hour — but I am recording that as a hypothesis, not a finding, because I did not look at the gauge metadata.

**How strongly to take the Charleston lag.** The series is 36 hours with 18 of them wet, so r = 0.778 at −1 h against 0.540 at 0 h rests on about 30 paired points and I have not tested the difference formally. Treat it as **indicated, not established** — enough to justify not trusting an hourly `K` on this catchment, not enough to assert a clock error in the gauge ingest. Norfolk's lag-0 result is the stronger of the two because it is the null and it is what you would expect.

**Does the offset threaten the case-6 recommendation?** No, and this is the number that matters. Recomputing the event-level ratio with the gauge series shifted:

| Case | Event ratio at lag 0 | at lag −1 h | at lag −2 h |
|---|---|---|---|
| Norfolk | 0.798 | **0.797** | 0.794 |
| Charleston | 1.240 | **1.240** | 1.240 |

The event-level ratio is invariant to the shift to within 0.5 %. **The case-6 recommendation rests on the event-level ratios — Norfolk 0.798 against Charleston 1.240 — and those are lag-invariant**, so §7.6's geometry argument (radar-only runs high where the beam is low and low where the beam is high) is unaffected by the timing artefact. It would have been affected had it rested on any individual hour, and it does not.

**The sensitivity run the reviewer asked for.** Arm A applies a per-hour `K`; arm B applies a single event-level `K`:

| | Norfolk arm A (hourly `K`) | Norfolk arm B (event `K`) | Charleston arm A | Charleston arm B | EC 2016 arm A | EC 2016 arm B |
|---|---|---|---|---|---|---|
| `K` | 0.008 – 1.462 | **0.798** | 0.243 – 3.934 | **1.240** | 0.949 – 1.018 | 0.992 |
| Event total, mm | 227.81 | 227.81 | 203.81 | 203.81 | 147.75 | 147.75 |
| Peak hour, mm | 33.01 | 30.56 | 35.13 | 33.75 | 71.29 | 69.50 |
| Peak hour vs radar-only | −13.8 % | −20.2 % | +29.1 % | +24.0 % | +1.8 % | −0.8 % |
| Worst hour-to-hour `K` jump | **0.94** | 0 | **3.69** | 0 | 0.07 | 0 |

Both arms reproduce the event total exactly, by construction. They differ by only **4–7 % on the peak hour**. But arm A buys that similarity by injecting hour-to-hour multiplier jumps of 0.94 and 3.69 into the hyetograph — a near-total deletion of one Norfolk hour and a near-quadrupling of one Charleston hour — which are artefacts of the merge's timing, not features of the weather.

**Specification, replacing the per-hour `K` default in §2.1 step 4 for cases where this test fails:**

1. Run the aggregation-stability test per case before choosing. Report the 1 h and 12 h log-SD, **averaged over all block phases**, not for one arbitrary phase.
2. If the 1 h log-SD exceeds **0.35** while the 12 h log-SD is below it — true for both coastal cases (1.145 → 0.139 and 0.700 → 0.132) and false for Ellicott City (0.028) — **use a single event-level `K`** and say so in the provenance. The per-hour field is not estimable on that case.
3. Where per-hour `K` is used, the §2.1 clip to [0.5, 2.0] and the reported clipped fraction remain mandatory; they are what caught the 0.009 hour in the first place.
4. Report both arms' peak-hour figures in the pre-registration. A 4–7 % spread on peak hour is small enough that the choice is not load-bearing, and saying so is more useful than implying precision.

This supersedes nothing in §6.1–6.4, which concern bias against *independent gauges*. The ratio discussed here is between two MRMS products and is a diagnostic (§6.3), not a bias measurement.

---

## 7. Per-case assessment

All measurements below are over a 6 × 6 pixel box (≈ 36 km²) for Ellicott City, 11 × 13 (≈ 150 km²) for Meyerland and the coastal cases, and 10 × 12 (≈ 120 km²) for Center City Philadelphia, each containing the catchment of interest. Box corners are in the JSON outputs. A box rather than a delineated watershed is deliberate: the delineation is the H&H Engineer's, and a box is honest about the fact that at these ranges the radar sample is comparable to the catchment anyway (§3).

### 7.1 Case 1 — Ellicott City, MD

**The catchment.** Tiber Branch, 3.7 mi² = **9.6 km²** (2,368 acres), Hudson/Tiber/New Cut branches converging through Main Street into the Patapsco. About 3.1 km across.

**Coverage.** KLWX Sterling at **67.2 km**, azimuth 061°, beam centre **850 m** above the catchment, beam bottom 308 m, sampling volume **1.08 km wide × 1.08 km deep**. No terrain intersects a beam already 308 m up across the Piedmont; KLWX's blocked sector is west-north-west toward the Blue Ridge, not north-east. Melting layer near 4–4.5 km in late July and late May against a beam top of 1.4 km MSL, so **no bright-band risk at the lowest tilt**. TBWI (BWI TDWR) at 24.3 km would give a 0.23 km sample 163 m up, but it is C-band and its contribution to the QPE is unconfirmed (§3, §10 item 1) — assume it contributes nothing.

Note what the geometry means before any product question: the radar's sampling volume cross-section is roughly a ninth of the catchment area. **Spatialising rainfall here buys correct intensity and timing, not resolved structure** — there is little structure a 1.08 km sample can resolve across 3.1 km.

**Availability.** MTArchive only (not on NODD). 2016: 6 fields, no `RadarQualityIndex`, 719/720 frames on 30 July with the single gap at 00:06Z — outside the flood window — and 720/720 on 31 July. 2018: 7 fields including RQI, 720/720. **No `MergedReflectivityQCComposite` for either**, but `SeamlessHSR` is present on both dates and is the replay layer for this case (§8.1.1) — native GRIB2 dBZ at 0.1 dBZ resolution, not a rate layer as the first revision concluded.

**Measured — 30 July 2016**, 22:00Z–02:00Z, 121/121 frames decoded:

| | |
|---|---|
| Peak box-mean rate | **105.2 mm/h** (23:38Z) |
| Peak pixel rate | **152.3 mm/h**; p99 144.8, p99.9 152.3 — a broad top, **no cap plateau** |
| Accumulation integrated from the 2-min rates | box mean 148.7 mm, wettest pixel **168.8 mm**, driest 127.9 mm |
| `RadarOnly_QPE_01H` event total | box mean 148.9 mm, wettest pixel **168.8 mm** |
| Reported | **6.60 in = 167.6 mm in 2 hours** at Ellicott City |
| `PrecipFlag` | 46.4 % tropical convective, 31.5 % tropical stratiform, **10.4 % hail**, 7.7 % warm stratiform, 4.0 % no precip |
| Rate-cap saturation | **7.8 % of wet pixel-frames at exactly 53.8 mm/h** (the hail cap) |
| Gauge-merged / radar-only | **0.992**, log-SD 0.002 |

Essentially all of that 148.9 mm falls in 23Z–01Z (25.5 + 70.1 + 47.5 mm box-mean), so the comparison is fair: **the radar-only product puts 168.8 mm at its wettest pixel over the same two hours in which the gauge recorded 167.6 mm.** That is better agreement than I expected and it should be said plainly. The storm is representable.

Two qualifications, both measured. **The hail flag fired on 10.4 % of pixel-frames and clamped 7.8 % of wet pixel-frames to 53.8 mm/h**, a factor of ~2.8 below the surrounding core rates — so the *peak instantaneous intensity* is biased low in the cores even though the two-hour volume is right. And **the gauge correction did nothing** (0.992), so `GaugeCorr_QPE_01H` carries no independent information here and the field's absolute scale rests entirely on the radar.

**Verdict 1a: GO, conditional on** reporting the clamped fraction in the pre-registration as a known downward bias on sub-hourly peak intensity, and on establishing an independent gauge arm (§6.2) before the run — because at present this rainfall field has no verified absolute scale at all.

**Measured — 27 May 2018**, **19:00Z–23:30Z, 136/136 frames decoded.** Re-run over the whole storm in revision 2 at the reviewer's instruction (review item 1), replacing revision 1's 17:00Z–21:30Z window. **The reviewer's diagnosis was exactly right and the old window was badly placed:** the hourly products put 42.56 mm in 21:00–22:00Z and 15.38 mm in 22:00–23:00Z, so revision 1's census stopped 90 minutes before the storm did and every number keyed to it covered roughly two-thirds of the event. The corrected window is 98.7 % wet (4,831 of 4,896 pixel-frames) against 64.8 % before.

| | Revision 2, **19:00–23:30Z** | Revision 1, 17:00–21:30Z |
|---|---|---|
| Peak box-mean rate | 61.2 mm/h | 61.2 mm/h |
| Peak pixel rate | **exactly 103.8 mm/h**, never exceeded in **4,831 wet pixel-frames**; p99 94.1, p99.9 103.8 | exactly 103.8, never exceeded in 3,174 wet |
| Accumulation integrated from the 2-min rates | box mean **116.4 mm**, wettest pixel **169.3 mm**, driest 89.7 mm | box mean 78.7, wettest 119.2 |
| `RadarOnly_QPE_01H` event total (16:00Z–02:00Z) | box mean **118.8 mm**, wettest pixel **172.2 mm** | box mean 113.9, wettest 166.6 |
| Reported | **8.40 in = 213.4 mm** at Ellicott City (NWS); 10.38 in at Catonsville | — |
| `PrecipFlag` | **47.0 % convective**, 30.3 % warm stratiform, **20.9 % hail**, 1.9 % no precip, **0 % tropical** | 22.2 % convective, 17.4 % hail, 36.0 % no precip |
| Rate-cap saturation | **15.5 % of wet pixel-frames at exactly 53.8 mm/h** (748 counts), plus 0.44 % at exactly 103.8 | 18.6 % at 53.8 |
| Gauge-merged / radar-only | **1.005**, per-pixel geometric mean 1.003, log-SD 0.043 | 1.008 |

**The conclusion survives the rerun, and the central evidence is stronger.** The two heaviest hours of the storm are now inside the censused window and **the rate field still reaches exactly 103.8 mm/h and still never exceeds it** — now across 4,831 wet pixel-frames rather than 3,174, in a window that is almost entirely raining. A ceiling that holds when you add the peak of the storm to the sample is a ceiling. The hail-cap plateau is still there at 15.5 % of wet pixel-frames, and the absolute count rose from 591 to 748; the percentage fell only because the fuller window contains more moderate-rain pixels to divide by. And the `PrecipFlag` contrast with 2016 sharpens: this storm is **47 % convective, 21 % hail and 0 % tropical**, against 2016's 78 % tropical over the same box.

**Two numbers do change, and both in the direction that weakens my case slightly.** The deficit against the reported depth narrows: the wettest-pixel event total is **172.2 mm against a reported 213.4 mm, which is 19.3 % low**, not the 22 % revision 1 quoted from the truncated window. And the rate-integrated wettest pixel is 169.3 mm, 20.6 % low. So the honest figure is **about a fifth low, not about a quarter.**

That does not change the verdict, and here is why I think it should not. The disqualifying fact was never the size of the deficit; it is that **the observed two-hour mean intensity, 213.4 mm / 2 h = 106.7 mm/h, exceeds the 103.8 mm/h ceiling the product is measurably enforcing.** The product cannot represent this storm's *average* intensity over its two worst hours, let alone its peak, and that is a statement about the ceiling and the gauge record, not about the census window. Unlike a bias it is not correctable: 15.5 % of wet pixel-frames are pinned at 53.8 mm/h and the whole field is ceilinged at 103.8, so the shape is wrong as well as the volume, and the §2.1 renormalisation cannot repair it because `GaugeCorr_QPE_01H` over this catchment is itself radar-only (1.005, log-SD 0.043) and inherits the same clamp.

**Verdict 1b: NO-GO as a pre-registered solver validation.** A hindcast of 27 May 2018 on radar rainfall would under-predict, the under-prediction would be dominated by a rainfall ceiling we can measure in advance, and the pre-registration would be burnt on a known-wrong input — the exact failure mode SPA-93 exists to prevent.

**But run it anyway, as the other kind of experiment, and say so in advance.** The pair is a natural experiment the programme would be foolish to waste: same catchment, same model, same radar geometry, two storms of comparable depth 22 months apart, one represented by an uncapped tropical Z–R and one hard-clamped by the convective and hail caps. Pre-register 2016 as the validation case and 2018 as a **rainfall-forcing sensitivity case** with its rainfall scaled to the gauge total and labelled as a derived, scaled field (§8.3). If the solver does well on 2016 and badly on uncorrected 2018, the cap is the named prime suspect and that prediction is on the record beforehand.

### 7.2 Case 2 — Bellinge, Denmark

Short, because the answer is clean.

**No MRMS.** MRMS is CONUS plus partial southern Canada and northern Mexico. Denmark is outside it entirely. The relevant national radar is DMI's C-band at Virring, **~80 km away, 5-minute**, available in the dataset from 2017.

**The dataset already ships better rainfall than any radar can give at this scale.** 1.72 km² catchment (0.55 km² paved); **two permanent tipping-bucket gauges, 1-minute resolution, in and just outside the catchment on opposite sides**, with more than ten years of record, plus a third temporary gauge for one year; and X-band radar from 2012 at 1-minute and ~925 m cells.

The arithmetic settles it. **1.72 km² is under two MRMS-scale pixels and about two X-band cells.** Two 1-minute gauges on opposite sides of a 1.3 km-wide catchment sample it more finely in time than the C-band (5 min) and comparably in space to the X-band, and the spatial variability of rainfall over 1.72 km² in a temperate maritime climate is small against gauge–radar bias.

**Verdict 2: NO-GO on radar, and the supplied rainfall is the better forcing. Force Bellinge from the gauges.** Use the supplied X-band only as a consistency check on gauge catch — wind undercatch, a blocked funnel, a stuck bucket — reported as a ratio and never applied.

There is a second reason this is the right answer. Bellinge is the case the repository itself names to settle the Davis pipe disagreement (−16 % pumped volume, ~21,000 m³ residual street ponding). **It is the one Phase 1 case where rainfall is not the limiting uncertainty**, which is exactly what you want when the question under test is the sewer. Putting radar on it would add an error term to the one experiment that currently does not have it.

### 7.3 Case 3 — EA Tests 8A/8B (Glasgow)

Confirmed no-op, as the ticket expected. Rainfall in 8A/8B is **specified by the test definition and uniform in space**. There is no observation to estimate, no product to select, no bias to measure and no advection to correct.

Two things I will add, because they are the only ways this case can go wrong from my side:

- **8A/8B exercise the rain-on-grid numerics and say nothing whatever about the rainfall input.** A pass on 8A/8B must not be cited, in the validation report or anywhere else, as evidence about FloodSim's rainfall. It is evidence about the solver's handling of a rainfall field it was handed. Those are different claims and the first is the one the programme is short of.
- **No radar layer may render on these runs** (§8.1). A synthetic benchmark displayed under a radar legend is a misrepresentation regardless of pixel accuracy, and this is the easiest place in the programme to make that mistake by accident, because the replay layer will be on by default once it exists.

**Verdict 3: NOT APPLICABLE.** Nothing required from this role.

### 7.4 Case 4 — Meyerland / Brays Bayou, Houston — Harvey 2017

**Coverage — the best in the set.** KHGX League City at **43.5 km**, azimuth 302°, beam centre **501 m** above the catchment, beam bottom 150 m, sample **0.70 km × 0.70 km**. Flat coastal plain, no blockage. Melting layer ~5 km against a beam top of 0.9 km MSL: no bright band. THOU (Hobby TDWR) at 27.9 km and TIAH at 44.0 km are both nearby but discounted (§3). Partial beam filling is negligible at 43 km with a 0.70 km sample.

**Availability.** MTArchive, 7 fields including `RadarQualityIndex`, **720/720 frames on both 26 and 27 August**. No `MergedReflectivityQCComposite`, but `SeamlessHSR` is present and is this case's replay layer (§8.1.1, §8.1.2) — native GRIB2 dBZ, not the rate layer the first revision concluded.

**Measured**, 26–28 August 2017, hourly over a 150 km² box:

| | |
|---|---|
| `RadarOnly_QPE_01H` 3-day total | box mean **787.6 mm**, wettest pixel 946.9 mm |
| `GaugeCorr_QPE_01H` 3-day total | box mean **650.9 mm**, wettest pixel 753.1 mm |
| Ratio gauge-merged / radar-only | **0.827**, per-pixel geometric mean 0.828, log-SD 0.036, range 0.729–0.945 |
| Hourly ratio | **0.07 to 2.50**, and it **changes sign mid-event**: predominantly below 1 on 26–27 August, predominantly above 1 on the 28th |

So the two MRMS products disagree by **21 %** over this catchment (787.6 / 650.9), spatially almost uniformly, and the direction of the disagreement reverses partway through. This is the measured justification for §6.1's requirement to report bias **per hour**: a single event figure of 0.827 would have concealed a mid-event sign change that a five-day hindcast's hydrograph will feel.

**Failure modes in play.** Tropical maritime drop-size distribution, which is what the tropical Z–R exists for and which MRMS did select (§7.1's 2016 flags show the same classifier choosing tropical in a tropical airmass); pre-v12 single-pol only, which Martinaitis et al. (2021) find carries distinct biases against CoCoRaHS that the later dual-pol approach mitigates; bias drift over a five-day event, measured above; and the one that is specific to this case — **the gauge network itself was flooding**, which degrades the gauge-merged arm exactly when it matters most. Martinaitis et al. report under 10 % of hourly gauge reports failing MRMS QC *before* Harvey's landfall, which is the easy part of the event.

**Gate G3 has now been run for this case, and it passes decisively.** The first revision flagged this as the most important unrun census in the document, because the peak hour of 68.4 mm/h as a box mean implied pixel rates above 100 mm/h and therefore put the pre-v12 convective ceiling of 103.8 mm/h in play. Measured over the 150 km² box, **27 August 09:00Z–13:00Z, 121/121 frames decoded**:

| | |
|---|---|
| Peak box-mean rate | **130.7 mm/h** |
| Peak pixel rate | **189.4 mm/h**; p99 **173.7**, p99.9 182.7 |
| Accumulation integrated from the 2-min rates | box mean 165.7 mm, wettest pixel 226.6 mm, driest 100.0 mm |
| Rate-cap saturation | **none.** The most repeated value above 40 mm/h is 171.7 mm/h at **0.355 %** of 14,097 wet pixel-frames; the next are 169.5 (0.333 %), 154.0 (0.277 %), 160.6 (0.262 %). A flat, diffuse top with no plateau at any value |
| `PrecipFlag` | **59.1 % tropical convective**, 30.0 % tropical stratiform, 7.7 % warm stratiform, 3.2 % no precip, **0.06 % convective**, **0 % hail** |

**The field reaches 189.4 mm/h — 82 % above the 103.8 mm/h convective ceiling that clamps case 1b — and shows no clamping anywhere.** The reason is in the flag histogram: MRMS classified this storm as **89 % tropical** and only 0.06 % convective, and the tropical relation is not subject to the convective cap. There is no hail flag at all, so the 53.8 mm/h hail cap that clips 15.5 % of case 1b's wet pixel-frames and 7.8 % of case 1a's never engages here.

This is now the strongest quantitative confirmation in the document of the mechanism §10 item 2 proposes, because it is a third independent case: tropical classification → no cap → rates far above 103.8 (Harvey 189.4, Ellicott City 2016 152.3); convective and hail classification → hard clamp (Ellicott City 2018, pinned at exactly 103.8 and 53.8). Harvey is the cleanest of the three because its tropical fraction is the highest and its measured peak the furthest above the convective ceiling.

**Verdict 4: GO — and now measured on the dimension that was argued.** Force from `PrecipRate` at 2-minute cadence per §2.1; normalise to `GaugeCorr_QPE_01H`; report bias hourly and state the 0.827 product disagreement in the pre-registration as a declared forcing uncertainty. **Do not be tempted to force this case from the hourly product** just because the event is long — Brays Bayou responds in hours, and §4.1's measured **−38.9 %** peak-intensity loss for this very catchment applies.

This is also the best-gauged catchment in the set for §6.2's independent arm: the Harris County Flood Warning System runs **153 gauges at 15-minute resolution** over the county.

### 7.5 Case 5 — Philadelphia — Ida, 1–2 September 2021

**Coverage.** KDIX Mount Holly at **63.9 km**, azimuth 270°, beam centre **851 m** above the city, bottom 335 m, sample **1.03 km**. Flat coastal plain, no blockage. Melting layer ~4.5 km in early September against a beam top of 1.4 km MSL: no bright band. TPHL (Philadelphia TDWR) sits **7.8 km** from Center City — a 0.07 km sample 99 m above the ground, which would be transformative if it entered the QPE; discounted per §3 until confirmed.

**Availability — the best in the set.** This is the only Phase 1 case inside the NODD archive, so the **full diagnostic product set** is available: `RadarQualityIndex`, `GaugeInflIndex_01H_Pass2`, `SeamlessHSRHeight`, `BrightBandTopHeight`/`BottomHeight`, `SyntheticPrecipRateID`, `Model_0degC_Height`, **and** `MergedReflectivityQCComposite` — so case 5 is the only one that can have a **column-maximum** dBZ replay layer (§8.1). It is *not* the only one that can have a dBZ layer at all: that claim appeared in the first revision, was corrected once in Addendum A, and is now settled in §8.1.1 — `SeamlessHSR` is native GRIB2 and present on every pre-2020 case date, so cases 1a, 4 and 6 get a reflectivity replay too. What is unique to case 5 is the *column-maximum* product and the `SeamlessHSRHeight` companion field that lets the legend state the sampling height rather than merely warn that it varies. MTArchive carries 15 fields but **`MultiSensor_QPE_01H_Pass1` is not among them** — Pass 2 only; use NODD if Pass 1 is wanted. 718/720 frames on each day; the gaps (04:24Z and 14:24Z on the 1st, 08:24Z and 10:24Z on the 2nd) all fall outside the 00:00–08:00Z 2 September rainfall window, except 08:24Z which is just after the rain ended.

**MRMS v12 — and this is what makes the case viable.** Observed rates of 3–5 in/h (76–127 mm/h) sit inside the v12 dual-pol ceilings (R(A) 200 mm/h, R(K_DP) 150 mm/h).

**The census window is corrected in revision 2, and it moves these numbers a long way.** Revision 1 measured 23:00Z–04:00Z. But the hourly products are stamped with the **end** of their accumulation window (§2.4 trap 4), so Ida's peak hour is the file stamped `23:00Z`, which is the accumulation for **22:00–23:00Z** — an hour that began *before* revision 1's rate census did. The census therefore missed the storm's heaviest hour entirely. I found this while fixing review item 1 and it is the same class of defect: a truncated window. Re-censused **21:00Z–01:00Z, 121/121 frames**:

| | Revision 2, **21:00–01:00Z** | Revision 1, 23:00–04:00Z |
|---|---|---|
| Peak box-mean rate | **96.0 mm/h** | 39.6 mm/h |
| Peak pixel rate | **161.4 mm/h**; p99 118.8, p99.9 138.1 | 121.7; p99 81.3, p99.9 105.5 |
| Accumulation from the 2-min rates | box mean **79.6 mm**, wettest pixel **102.1 mm** | box mean 30.0, wettest 46.9 |
| Rate-cap saturation | **none** — most-repeated value above 40 mm/h occurs 10 times in **12,601** wet pixel-frames (**0.079 %**) | none (0.047 %) |
| `PrecipFlag` | 40.3 % tropical stratiform, 23.4 % warm stratiform, **19.7 % tropical convective**, 3.3 % convective, **0.04 % hail**, 13.3 % no precip | 46.4 % warm strat, 33.7 % trop strat, 4.9 % trop conv, 0.5 % conv |

**The verdict is unaffected and the central claim is stronger.** Compare case 1b's single value accounting for 15.5 % of wet pixel-frames: **there is still no saturation signature in Ida at all** — the most-repeated high value appears 10 times in 12,601 wet pixel-frames — and the peak is now **161.4 mm/h**, a real estimate rather than a ceiling, sitting comfortably inside the R(A) ceiling of 200 mm/h. The counterfactual is sharper than revision 1 could state it: MRMS classified this storm as 64 % tropical and 23 % warm stratiform, and the pre-v12 **stratiform** cap was 48.6 mm/h, so **a pre-v12 Ida would have been clamped at roughly a third of its measured peak.** The dual-pol algorithm is the whole reason this case is usable, and that is now measured against a peak of 161.4 rather than 121.7.

An independent check that the corrected window is right: the 2-minute rates integrate to **79.6 mm** box-mean over 21:00–01:00Z, and the four hourly files covering exactly those hours sum to **79.0 mm** — agreement to 0.7 %, which is the §2.4 trap 4 cross-validation holding on a third case.

**And this case is the worst in the set for hourly forcing, by a wide margin.** Its peak hour is 39.5 mm as a box mean while its peak two minutes run at 96.0 mm/h, so hourly forcing would lose **−58.9 %** of the peak catchment intensity here against −30 % to −39 % elsewhere (§4.1). The rain arrived in bursts inside an otherwise moderate hour. For a combined-sewer and inlet case that is precisely the signal under test, so **forcing case 5 from an hourly product would remove the phenomenon the case exists to examine.**

**And here is the blocker.** Measured over the same box, 18:00Z 1 September to 12:00Z 2 September:

| | |
|---|---|
| `RadarOnly_QPE_01H` event total | box mean **101.4 mm**, wettest pixel 130.6 mm |
| `MultiSensor_QPE_01H_Pass2` event total | box mean **60.7 mm**, wettest pixel 87.3 mm |
| Ratio Pass 2 / radar-only | **0.599**, per-pixel geometric mean 0.596, log-SD 0.065, range 0.528–0.691 |
| Reported | 4–6 in = **102–152 mm** in 12 hours in parts of the city |

The two candidate normalisers differ by **40 %** over the catchment, and the radar-only arm (101–131 mm) is the one consistent with the reported 4–6 in, while the gauge-merged arm (61–87 mm = 2.4–3.4 in) falls **below** the reported range. I will not adjudicate that from product ratios: plausible readings include a genuine dual-pol wet bias in warm rain that the merge corrected, and tipping-bucket undercatch at 76–127 mm/h rates in high wind dragging the merge down. Both are real effects and only gauges can separate them.

What matters for the ticket is that the §2.1 recipe makes Pass 2 the normaliser by default, and **that default would reduce this storm by 40 %.** Under §6.4's thresholds a 40 % forcing ambiguity is in the band where a hindcast cannot separate solver error from forcing error.

**Verdict 5: GO on coverage, product availability and rate fidelity — the strongest case in the set on all three — with one blocking pre-registration item:** the choice of hourly normaliser must be settled against independent gauges (PWD network, CoCoRaHS, PHL ASOS with an explicit undercatch note) **before** the run, and the pre-registration must state which arm was chosen, by how much it differs from the other, and on what evidence. This is a half-day of data work, not a research project, and it must not be skipped because the rest of the case looks so good.

Two scope notes. The Schuylkill basin extends more than 100 km north-west of the city, so **the river boundary condition must remain a gauged USGS inflow and must not be derived from the radar field** over the model domain — the radar field is the local rain-on-grid forcing only. And the combined-sewer and inlet physics this case exists to test are short-response and local, which is where §5.3's 7.9 % peak 2-minute single-pixel benefit from advection correction is worth the most.

### 7.6 Case 6 — recommendation: Norfolk / Hampton Roads, Hurricane Matthew, 8–9 October 2016

**The recommendation, and why it beats the alternatives on radar grounds.**

| Candidate | Beam geometry | Measured gauge-merged / radar-only | Verdict |
|---|---|---|---|
| **Norfolk / Hampton Roads, Matthew 2016** | KAKQ **65.1 km**, beam centre **869 m**, sample 1.05 km | **0.798**, and the corrected field lands inside the observed gauge range | **Recommended** |
| Charleston, Matthew 2016 | KCLX **105.0 km**, beam centre **1621 m**, sample 1.69 km | **1.240** — radar-only 24 % *low* | Rejected: beam height |
| Charleston, October 2015 SC flood | as above | — | Rejected: as above, **and `PrecipFlag` is not archived for 2015-10-03** (5 fields), so gate G3 cannot be run |
| Florence 2018 | adequate (KLTX/KMHX) | not measured | Rejected: event shape, see below |
| Ian 2022, Fort Myers | KTBW ~129 km, KAMX ~180 km | not measured | Rejected: worse geometry than Charleston, and the Fort Myers water-level record is incomplete through the peak surge |

**Coverage.** KAKQ Wakefield at **65.1 km**, azimuth 103°, beam centre **869 m** above the city, bottom 343 m, sample **1.05 km**. Flat coastal plain, no terrain blockage. Melting layer ~4.5 km in early October against a 1.4 km beam top: no bright band. **But no redundancy** — the next radars are KDOX at 232.5 km and KMHX at 236.2 km, both sampling above 5 km, which is useless for QPE. A KAKQ outage or a clear-air VCP during the event would hit the whole case with no fallback, which is gate G6.

**Availability.** MTArchive, 6 fields, **720/720 frames on both 8 and 9 October** — complete. **No `RadarQualityIndex` for 2016**, so the coverage statement rests on the computed geometry plus a modern RQI sample over the same catchment. No `MergedReflectivityQCComposite`, but `SeamlessHSR` is present and is this case's replay layer (§8.1.1, §8.1.2) — native GRIB2 dBZ, not the rate layer the first revision concluded. For this case in particular the §8.1.2 no-coverage requirement is not academic: §3 records no radar redundancy within 232 km, so a KAKQ outage would blank the catchment, and the replay must draw that as a blank rather than as clear sky.

**Measured**, 8–9 October 2016, hourly over a 150 km² box centred on Hampton Roads:

| | |
|---|---|
| `RadarOnly_QPE_01H` event total | box mean **285.4 mm** (11.2 in), wettest pixel 336.6 mm (13.3 in) |
| `GaugeCorr_QPE_01H` event total | box mean **227.8 mm** (8.97 in), wettest pixel 280.4 mm (11.0 in) |
| Ratio | **0.798**, geometric mean 0.798, log-SD 0.059, range 0.670–0.872 |
| Reported | Norfolk **7.44 in** on 8 October (wettest October day on record), Norfolk International **10 in** for the storm, **6–11 in** across south-east Virginia |
| Hourly ratio | 0.009 to 1.46, sign flip overnight on the 9th |

The gauge-merged field (8.97 in box mean, **11.0 in at the wettest pixel**) sits inside the reported 6–11 in range at its top end; the radar-only field (11.2–13.3 in) sits above it. **So here the gauge correction is doing real work and moving the field toward the observations** — the opposite situation to case 5, and a point in this case's favour.

**Gate G3 has now been run for this case too, and it passes — this was the last unrun gate in the document.** Revision 1 could only argue it: the peak hour over the box is 38.3 mm/h as a box mean, well below the convective ceiling, so the pre-v12 limitation that disqualifies case 1b *ought* to be harmless here. An expectation is not a census, and now there is one. Measured over the 150 km² box, **8 October 20:00Z–23:30Z, 106/106 frames decoded**:

| | |
|---|---|
| Peak box-mean rate | **69.2 mm/h** — 1.8× the 38.3 mm/h hourly box mean, which is the §4.1 effect again |
| Peak pixel rate | **180.9 mm/h**; p99 **120.0**, p99.9 153.4 |
| Accumulation integrated from the 2-min rates | box mean **111.7 mm**, wettest pixel **150.1 mm**, driest 66.7 mm |
| Rate-cap saturation | **none.** The most repeated value above 40 mm/h is 46.0 mm/h at **0.393 %** of 17,808 wet pixel-frames, and the next four are 0.39, 0.37, 0.37 and 0.36 % — a flat, diffuse distribution with no plateau at any value |
| `PrecipFlag` | **75.2 % tropical convective, 24.2 % tropical stratiform** — 99.4 % tropical — 0.4 % warm stratiform, **0.15 % hail**, 0.06 % convective |

**The field reaches 180.9 mm/h, 74 % above the 103.8 mm/h ceiling that clamps case 1b, with no clamping anywhere**, and the reason is the same as at Meyerland: MRMS classified this storm as **99.4 % tropical** — the most tropical of the four cases measured — with hail firing on 0.15 % of pixel-frames against case 1b's 20.9 %. The window covers the two heaviest hours of the event (the files stamped 22:00Z and 23:00Z, 38.29 and 34.97 mm box-mean) with margin either side, and it cross-validates: the rates integrate to 111.7 mm against about 110 mm from the hourly files over the same span.

Narrowed from the 6-hour window originally planned to 3.5 hours to stay inside the per-host transfer cap (§11.1) — recorded here rather than done silently. The narrowing does not weaken the result: a ceiling that is exceeded is exceeded, and 180.9 mm/h exceeds it in the hours that matter.

**This makes the cap mechanism a four-case comparison**, which is the strongest form the argument has taken. **Tropical classification → no cap:** Matthew 180.9 mm/h at 99.4 % tropical, Harvey 189.4 at 89 %, Ellicott City 2016 152.3 at 78 %. **Convective-and-hail classification → hard clamp:** Ellicott City 2018, pinned at exactly 103.8 and 53.8, 0 % tropical. The three tropical cases span 152–189 mm/h with no common ceiling among them, which also disposes of the possibility raised in §8.1.1 that the tropical branch carries its own ceiling near 152 mm/h.

**Why it is genuinely compound, which is the point of case 6.** Norfolk took 7.44 in in a calendar day while Sewells Point peaked at **7.9 ft MLLW, a ~5 ft surge, 3.10 ft above MHHW**. Rain and water level peak together, so the case tests the *coincidence* rather than two phenomena in sequence. CO-OPS Sewells Point (8638610) is a long-record gauge, and Hampton Roads is unusually well instrumented for water levels.

**Why Charleston loses, with the measurement.** The geometry says KCLX's lowest beam centre is 1621 m above the Charleston peninsula against KAKQ's 869 m above Norfolk — nearly double, in a 1.69 km sample instead of 1.05 km — and predicts overshooting of shallow coastal rain and therefore radar under-estimation. The data, in the **same storm**, 290 km apart: Norfolk's radar-only field is 25 % **high** relative to gauge-merged, Charleston's is 24 % **low**. That is consistent with the geometry prediction, with the right sign, and it is the cleanest single argument in this document for siting a radar-forced hindcast where the beam is low.

**Why Florence 2018 loses.** Not on radar — the archive and the geometry are both adequate. On event shape: Florence's flooding is multi-day river routing over the Lumber, Cape Fear and Pee Dee, and at most points the surge peak and the rainfall peak are separated by days. That tests the tide boundary and the rainfall field *independently*, which is the one thing case 6 exists not to do. If the board wants a larger event than Matthew, Florence is the fallback and this reasoning should be revisited rather than inherited.

**Verdict 6: GO — recommend Norfolk / Hampton Roads, Hurricane Matthew, 8–9 October 2016. Now measured on every dimension this role owns**, the rate-cap census included, subject to gate G6 (confirm KAKQ availability and VCP through the event, because there is no second radar) and to the standing caveat that RQI is not archived for 2016. My verdict covers rainfall only; whether FloodSim's tide boundary, DEM and verification data support a Hampton Roads domain is the H&H Engineer's and Validation Lead's call.

---

## 8. What the legends are allowed to claim

Three distinct layers get confused with each other, and the third one is the one nobody has named yet.

### 8.1 The reflectivity (dBZ) layer — display only

**May claim:** the exact product name (`MRMS MergedReflectivityQCComposite`), "column-maximum quality-controlled radar reflectivity", units **dBZ**, the frame's valid time in **UTC**, and the frame age relative to the solver clock.

**Must carry:** the words **"observation — display only; not the model forcing"**, in the legend itself and not in a caption that can be cropped off.

**May not:**
- show any axis, tick or annotation in mm/h, in/h, or any rainfall unit;
- be called rainfall, rain rate, precipitation, or "radar rainfall";
- offer a dBZ→mm/h conversion anywhere on screen. MRMS chooses among six Z–R relations plus two dual-polarimetric relations per pixel per frame; a single Marshall–Palmer conversion in the UI would contradict the forcing the model actually used, in a figure that puts them side by side;
- be the source of any number quoted in a report;
- appear at all on a run whose rainfall came from somewhere else. **Cases 2 and 3 must render no radar layer** — a synthetic or gauge-forced run under a radar legend is a misrepresentation even if every pixel is accurate;
- imply 2-minute independent observation. The 2-minute timestamp is a publication time; §5.5 measures the effective refresh. If the legend shows a cadence at all it must say "mosaic published every 2 min".

#### 8.1.1 The pre-2020 replay layer — `SeamlessHSR`, and this supersedes two earlier answers

This has now changed twice and the third answer is the right one. The first revision said cases 1, 4 and 6 can have **no** dBZ layer, because `MergedReflectivityQCComposite` is absent from the pre-2020 archive. Addendum A corrected that to IEM's `mrms_lcref` palette raster. **Review item 6 asked why neither of us had looked at `SeamlessHSR`, and the answer is that we should have: it is better than both.** Measured by `seamless_hsr_probe.py` on 2026-11-01:

| | `SeamlessHSR` (recommended) | IEM `mrms_lcref` (withdrawn) |
|---|---|---|
| Format | **Native NCEP GRIB2**, same reader as the forcing | 8-bit palette PNG, third-party |
| Precision | **0.1 dBZ**, 16-bit | 0.5 dBZ, 8-bit |
| Range | −999 (no data) to +5554.5; no ceiling | −32 to +95 dBZ |
| Low-end visibility | full field | **indices 0–85 render pure black: everything ≤ +10.5 dBZ invisible** |
| Valid time | GRIB2 §1, exact | filename slot, ±60 s |
| Availability on case dates | **48/48 probed frames on every pre-2020 case date**, every even minute, 10/10 consecutive | 720/720 |
| Provenance | NCEP, same custody chain as the QPE | IEM, separate credit required |
| Cost | ~1.0–1.4 MB/frame (≈1 GB for a full replay day) | far smaller |

`MergedReflectivityQCComposite`, `MergedReflectivityQC` and `MergedBaseReflectivityQC` all return **404** on 2016-07-30, so `SeamlessHSR` is not merely preferable pre-2020 — it is the only native reflectivity there is.

**And it has a property the other two do not, which is the real reason to prefer it.** `SeamlessHSR` is the seamless hybrid-scan reflectivity that MRMS itself converts to a rain rate, so the dBZ on screen and the mm/h in the solver are the same observation rather than two different pictures. `hsr_zr_consistency.py` tests that rather than asserting it, by pushing `SeamlessHSR` through the *published* per-class Z–R relations and comparing with `PrecipRate` at the same pixel and time, classified by `PrecipFlag`:

- **Tropical-convective pixels** (`PrecipFlag` 96, published `Z = 250 R^1.2`): predicted / actual rate geometric mean **1.05**, log-SD 0.099. The published relation reproduces the product's own rate to about 5 %.
- **Hail-flagged pixels** (`PrecipFlag` 7, published `Z = 300 R^1.4`): predicted / actual **1.357 geometric mean, minimum 0.999, maximum 2.095**. The reflectivity implies up to 2.1× more rain than the product reports and *never less*.

**The minimum of 0.999 is the informative number, and it is not a coincidence.** The least-clamped hail pixel in the sample sits at **48.2 dBZ**, where `Z = 300 R^1.4` gives **47.2 mm/h against a reported 47.2** — exact to the product's 0.1 mm/h quantum. The most-clamped sits at **53.5 dBZ**, where the same relation gives **112.7 mm/h against a reported 53.8**. So the data says, in one line: **hail-flagged pixels follow the published convective Z–R exactly until the implied rate reaches 53.8 mm/h, and are then held there.** The clamp is the *only* departure from the relation, and its value is 53.8.

That is an independent confirmation of the hail rate cap, from reflectivity and a published relation rather than from a histogram of repeated values — two unrelated routes to the same number, and this one pins down the mechanism rather than just the value.

**Two honest limits on this test.** It is **n = 36 pixels on a single frame** (31 hail, 5 tropical), so the tropical agreement is indicative rather than established; gate G3 should widen it per case. And the tropical class has a visible outlier: its brightest pixel, 51.4 dBZ, implies 192.8 mm/h against a reported 152.3, a ratio of 1.27, which on its own would look like a tropical ceiling near 152 mm/h. **It is not one, and the reason is cases 4 and 6** — Harvey's field is 89 % tropical-flagged and reaches **189.4 mm/h** (§7.4) and Matthew's is 99.4 % tropical and reaches **180.9 mm/h** (§7.6), both well past any 152 mm/h ceiling, and the three tropical cases share no common maximum. So the outlier is more likely scatter from dual-pol blending or imperfect co-location between the hybrid-scan pixel and the rate pixel than a cap. Recorded because it points at §10 item 2's open question — whether the tropical branch carries a formal ceiling at all — and because a reader who computed the ratio themselves would otherwise reasonably wonder. It also means **the replay layer will visibly disagree with the forcing layer exactly where the cap bites**, which a reviewer may well notice and ask about. That is a feature, and §8.3's cap sentence is what answers it.

**Legend consequences.** `SeamlessHSR` is a *hybrid-scan* field: the beam elevation contributing each pixel varies with range and blockage, so the sampling height is not constant across the image.

**May claim:** `MRMS SeamlessHSR`, "seamless hybrid-scan radar reflectivity", units dBZ, the GRIB2 valid time in UTC, and NCEP provenance.

**May not claim:** "column-maximum" — that wording is licensed only for `MergedReflectivityQCComposite`, i.e. case 5 only. Nor may it imply a constant sampling height; where `SeamlessHSRHeight` is archived (v12 cases) the legend may state the height, and where it is not, the legend says the height varies with range.

#### 8.1.2 The reflectivity layer has three display states, not two — and this is the display-side twin of the −3.0 trap

SPA-94's M16 reports two negative sentinels in `SeamlessHSR` rather than the one §2.4 lists. That is a claim about what the display layer may say, which is this role's, so it is measured here rather than taken on trust. `hsr_sentinel_census.py` runs entirely off frames already in the local cache and issues **no HTTP requests**, so this measurement cost zero bytes against the §11.1 ledger. Frame 2016-07-30 23:52Z, three windows:

| Window | Pixels | `SeamlessHSR` negatives found | No coverage | No echo | Valid dBZ |
|---|---|---|---|---|---|
| G2b no-coverage patch, 53.8–54.2 N | 1,600 | **−999.0 × 1,600** | 100 % | 0 % | 0 % |
| Tiber catchment, storm peak | 36 | none | 0 % | 0 % | 100 % (48.2–53.5 dBZ) |
| Maryland wide, 38.5–40.5 N / 78–75.5 W | 50,000 | **−99.0 × 21,393** | 0 % | **42.8 %** | 57.2 % (7.3–55.5 dBZ) |

Confirmed, and two of these are exact rather than approximate:

- **The two sentinels are real and they are different values.** `X = 0 → −999.0` is no radar coverage; `X = 9000 → −99.0` is coverage with no echo. `PrecipRate` has no equivalent distinction available to it — its floor is −3.0, so it has exactly one negative value and must express "covered and dry" as 0.0 mm/h.
- **The no-coverage masks of the two products co-register exactly.** Over the G2b patch, `SeamlessHSR` is −999.0 and `PrecipRate` is −3.0 on the same **1,600 of 1,600** pixels, with zero pixels flagged by one product and not the other. So the display layer and the forcing layer agree on where the radar was not looking, and a figure can state it once for both.
- **The no-echo mask co-registers exactly too, and this one surprised me.** Over the 50,000-pixel Maryland box the set `{SeamlessHSR = −99.0}` and the set `{PrecipRate = 0.0}` are the *same* 21,393 pixels — not 21,390, not 21,400. Every pixel the reflectivity field calls no-echo, the rate field calls zero, and conversely, with no exceptions. That is a sharper statement of §8.1.1's "it is the field `PrecipRate` is derived from" than the n = 36 Z–R test, and it comes from 50,000 pixels rather than 36.

**Legend requirement, and it is new.** The dBZ layer must render **no coverage** distinctly from **no echo**, and a run whose domain contains any no-coverage pixel must say so on screen. Specifically:

- **−999 may not be placed at the bottom of the colour ramp.** A continuous ramp that accepts −999 as its minimum paints a radar outage as the weakest possible echo, or — more likely, after clamping — as indistinguishable from clear sky. **Render no-coverage as a non-ramp fill** (hatching or a reserved neutral) with its own legend entry, as the water layers already do for nodata.
- **−99 (no echo) may render as transparent**, which is the ordinary and correct treatment, *provided* −999 does not share that treatment.
- Neither sentinel may be filled, interpolated across, or advected. §5.2's resampler must treat both as masked, not as numbers — a cubic kernel applied across a −999 boundary will smear −999 into neighbouring valid pixels and produce dBZ values that are not merely wrong but impossible.

This is the display-side twin of §2.4 trap 2. There, treating −3 as 0 mm/h turns a radar outage into a dry spell in the forcing; here, ramping −999 turns the same outage into clear sky on screen. The second one is worse in one specific way: the forcing error is caught by gate G2, and a figure has no G2.

**Note the asymmetry this creates with case 5.** `MergedReflectivityQCComposite` is a different product with its own section 5, so its sentinel values must be read from its own header rather than assumed to match — §2.4 trap 2's rule, applied to the display layer. I have not measured them, and gate **G2c** below says so rather than letting the v12 case inherit a pre-v12 measurement.

**Withdrawn:** the Addendum A recommendation of `mrms_lcref`. Its low-end black palette is a real hazard for a replay figure — absence of colour would mean absence of echo to any reader, and for everything below +10.5 dBZ that is false. Keep it only as a fallback if a `SeamlessHSR` route proves unavailable, and if it is ever used, the ±60 s timing and the IEM credit still apply.

**One qualification on that, measured, and it cuts against how hard I pressed the point.** §8.1.2's census gives the size of the black band on a real frame for the first time: over the wide Maryland box at the 2016 storm peak, only **0.34 % of the valid-echo pixels sit at or below +10.5 dBZ**. On a convective frame the palette hides almost nothing, because a convective frame has little weak echo in it. So the hazard is real but it is *not* large on the case I used it to argue about, and anyone checking the claim would have found that. Where it does bite is the opposite regime — the stratiform and light-rain hours that bracket a convective core, and Matthew's long tropical-stratiform periods (99.4 % tropical, 24.2 % of it stratiform, §7.6), where a much larger share of the field sits in the low dBZ band. `SeamlessHSR` remains the recommendation on precision, provenance, timing and co-registration, each of which is a stronger argument than the palette one; the palette objection should be read as the weakest of the five rather than the decisive one Addendum A made it.

### 8.2 The QPE layer — the published estimate

**May claim:** the exact product name *including the pass* (`MRMS MultiSensor_QPE_01H_Pass2`, `MRMS GaugeCorr_QPE_01H`, `MRMS RadarOnly_QPE_01H`, `MRMS PrecipRate`), units (mm, or mm/h for the rate), the accumulation interval with explicit start and end times in UTC, whether it is **gauge-merged** or **radar-only**, the MRMS version era (pre-v12 single-pol / v12 dual-pol), and the archive source.

**Must carry, when this layer is the forcing:** the measured gauge–radar bias from §6 with its `n` and spread, or the words "bias not measurable (n < 3)". A QPE forcing layer displayed without its bias number is not allowed on screen.

**May not:**
- be called "observed rainfall" or "measured rainfall" unqualified. It is an estimate, and for Ellicott City 2016 it is an estimate that no gauge constrained (§6.3);
- be presented as truth against which a modelled point depth is validated;
- carry a gauge-accuracy claim, or any wording implying the gauge-merged product is gauge-quality away from gauges;
- be labelled "gauge-corrected" without the measured gauge-influence statement where that word is empty — for Ellicott City the honest label is **"GaugeCorr_QPE_01H (measured gauge influence over this catchment: none; ratio to radar-only 0.992)"**.

### 8.3 The derived forcing field — a third layer, and it needs its own name

The field the solver actually consumes is not either of the above. It is `PrecipRate`, advection-corrected, integrated to the model step, and renormalised to the hourly product with a smoothed and clipped `K`. **It must be labelled as a derived product and must never be labelled "MRMS QPE".**

Minimum label: *"Derived forcing: MRMS PrecipRate (2-min), advection-corrected, renormalised to MultiSensor_QPE_01H_Pass2; K clipped [0.5, 2.0], n % clipped; frame set <hash>."*

And where the rate was clamped at a cap, the label must say so with the number: *"x % of pixel-frames at the MRMS hail rate cap (53.8 mm/h); peak intensity biased low in storm cores."* For Ellicott City 2016 that number is **10.4 % hail-flagged, 7.8 % of wet pixel-frames exactly at the cap** (§7.1). A figure of that storm without that sentence overstates what the rainfall field knows.

### 8.4 Figures containing both radar and water

- Radar above the basemap, **below** the water layer; radar semi-transparent, water opaque; two clearly separated ramps; **both legends on screen simultaneously**. If a reader cannot tell rain from flood in a screenshot, the figure is worse than no figure.
- The water layer keeps its own basis label (validated / benchmarked / screening / unvalidated) exactly as any other output. The radar layer's presence does not upgrade it, and an animation of an observation over a model output is the one place in this programme where persuasiveness most outruns evidence.
- Any exported animation carries the frame-set hash, so the claim is checkable.

---

## 9. Pre-registration gates — what must be measured before each case is committed

These are cheap and they all run off the archive. **G1, G3, G4, G7, G10 and G11 have each already changed or qualified a verdict, a number or a specification** in this document when run on part of the case set — G3 qualified case 1a and disqualified 1b and has now confirmed case 4; G10 and G11 are new in revision 2 and both came out of fixing a reviewer's finding. G2, G5, G6, G8 and G9 remain unrun by me and are the ones most likely to change a verdict next.

| Gate | Applies to | Why |
|---|---|---|
| **G1.** Frame census: requested / decoded / missing, with the missing timestamps listed, for the event window | all radar cases | Measured in §1.1. Two of the five candidate events have gaps. |
| **G2.** No-data census: any pixel-frame with value < 0 inside the domain | all radar cases | §2.4 trap 2. A single unflagged −3 is an invented dry spell. |
| **G2b.** No-coverage **positive control**: decode any frame over 53.80–54.20 N / −100.40 to −100.00 E and assert the pipeline reports *no radar coverage*, not 0 mm/h | the decoder, once — a merge gate | [Addendum A §A.5](SPA-93_addendum_A_ingestion_response.md#a5-the-no-coverage-sentinel-i-expected-the-raster-to-lose-it-and-it-does-not--but-gate-g2-now-has-a-positive-control). G2 alone passes vacuously on any window that had no outage, and a census that cannot fail is not a gate. Measured: `-3.0` on 1600/1600 pixels there. |
| **G2c.** Display-layer sentinel read-out: for whichever reflectivity product this case renders, read `R`, `E`, `D` and the negative values **out of that product's own section 5 and a real frame**, and assert the renderer maps no-coverage to a non-ramp fill | the renderer, once per display product | §8.1.2. Measured for `SeamlessHSR`: **−999.0 no coverage, −99.0 no echo**, co-registering exactly with `PrecipRate`'s −3.0 mask. **Not measured for `MergedReflectivityQCComposite`**, which case 5 renders, so case 5 must run this rather than inherit the pre-v12 answer. A ramp that accepts −999 paints an outage as clear sky, and no water-balance or forcing gate can catch a figure. |
| **G3.** `PrecipFlag` histogram and the **cap-clamped pixel-frame fraction** over the catchment | all pre-v12 cases, and case 5 via `SyntheticPrecipRateID` | §7.1. This is the gate that qualified case 1a and disqualified 1b. **Now run for all four CONUS storms** — 1a, 1b, 4 and 6 — and the only one it fails is 1b. Not available for Charleston Oct 2015 (no `PrecipFlag` archived), which is a further reason case 6 is Norfolk. |
| **G4.** `GaugeInflIndex` (v12) or the gauge-merged / radar-only ratio (all eras) over the catchment | all radar cases | §6.3. This is the gate that revealed that "gauge-corrected" means nothing over the Tiber catchment. |
| **G5.** `RadarQualityIndex` over the catchment through the event, or an explicit statement that it is not archived for this date | all radar cases | §1.1. Not archived for 2016, which affects cases 1 (2016 arm) and 6. |
| **G6.** Primary-radar availability through the event, and the VCP in use | all radar cases, **especially case 6** | §3: Norfolk has no radar redundancy within 232 km. Confirm KAKQ was up and on a precipitation VCP for 8–9 October 2016. |
| **G7.** Duplicate-frame fraction and effective refresh interval, scored on **fraction of wet pixels changed** (`dedupe.threshold` 0.25, `dedupe.wetThreshold` 1.0 mm/h) as well as bit-identity, **plus the realised distribution of the fraction** | all radar cases | §5.5.1 and §5.5.2. Sets the real advection gap and protects the motion estimator from low-information pairs. Measured for three windows; bit-identity alone understates the weak-update fraction by more than a factor of two. The distribution is reported because 0.25 sits in the gap of a bimodal distribution on all three measured windows, and a case where it is not bimodal is a case where this parameter is untested. |
| **G8.** T3 frame-holdout score, advected vs in-place, on this event's own data | all radar cases | §5.4. The per-case number that justifies the advection module on that case. |
| **G9.** Independent-gauge list with `n`, and the §6.4 label it earns | all radar cases | §6.2. Where `n < 3`, the pre-registration must say the rainfall has no verified absolute scale. |
| **G10.** Hourly-product **alignment assertion**: integrate `PrecipRate` over `[T−1h, T)` and confirm it reproduces the hourly file stamped `T` to within a stated tolerance | the decoder, once — a merge gate — then once per case | §2.4 trap 4. The hourly products are stamped with the **end** of their accumulation window. A one-hour alignment error moves rainfall between hours while leaving the event total exact, so no water-balance check will catch it. Measured at 0.07 mm mean absolute error over four Ida hours and 1.40 mm over three Ellicott City 2016 hours. |
| **G11.** Bias **estimability** test: ratio spread at 1 h against 12 h aggregation, plus the lagged cross-correlation | all radar cases that will be renormalised | §6.5. Decides whether `K` may be applied per hour or must be a single event-level scalar. Both coastal Matthew catchments fail the 1 h test (log-SD 1.145 and 0.700); Ellicott City 2016 passes it. Run before choosing, not after. |

---

## 10. What I could not establish

Reported as open rather than guessed:

1. **Whether TDWR contributes to the MRMS QPE hybrid scan.** The reflectivity mosaic ingests 15–19 TDWRs; I could not confirm from published documentation that they enter the QPE. This is worth a definite answer because TBWI (24.3 km from Ellicott City) and TPHL (7.8 km from Center City) would change the geometry materially — though C-band attenuation in >100 mm/h cores limits the gain even if they do. Treated as "not contributing" throughout.
2. **Why the 2016 Ellicott City field exceeded 103.8 mm/h and the 2018 field did not.** My reading is the precipitation classification: 2016 was flagged 78 % tropical and the tropical relation is not subject to the 103.8 mm/h convective cap, while 2018 was flagged convective and hail and clamped at exactly 103.8 and 53.8 mm/h. What I have **not** confirmed from documentation is whether the tropical branch is formally uncapped or carries a higher regional ceiling; Zhang et al. (2016) list caps for stratiform, convective and hail but not for tropical. The mechanism still deserves a citation rather than my inference.

   **Revision 2 adds two independent lines of evidence, both of which support it.** Harvey (§7.4) is a third case and the cleanest: 89 % tropical, 0 % hail, peak **189.4 mm/h** with no plateau — 82 % above the convective ceiling, uncapped. And `hsr_zr_consistency.py` (§8.1.1) attacks it from reflectivity instead of from rate histograms: pushing `SeamlessHSR` dBZ through the *published* per-class Z–R relations reproduces `PrecipRate` to 5 % on tropical-flagged pixels, while on hail-flagged pixels it predicts up to **2.1× more rain than the product reports and never less**, with the reported rate topping out at exactly 53.8 mm/h. Two unrelated methods now put the hail cap at the same number. The tropical branch's formal ceiling remains uncited, but "the tropical branch is not subject to the convective cap" is no longer resting on one box and one event.

   A related caveat on case 1b's verdict: it rests on the measured observation that the 2018 field never exceeds 103.8 mm/h — now across **4,831 wet pixel-frames over the whole storm** (§7.1, re-run in revision 2) — while the 2016 field in the same box reaches 152.3 and Harvey reaches 189.4. That is strong evidence of a ceiling, and the revision-2 rerun strengthened it by adding the storm's two heaviest hours to the sample without the ceiling moving. But it is still evidence from one box and two events of one classification. If the Geospatial Engineer's wider fetch finds pre-v12 **convective**-flagged rates above 103.8 mm/h anywhere, the 1b verdict should be revisited — the 19.3 % shortfall against the reported depth would remain, but the structural argument would weaken to an empirical one.
3. **Primary-radar availability and VCP through each event.** Gate G6; needs the NEXRAD archive or the ROC record, which I did not query.
4. **Per-event independent gauge inventories.** Gate G9. I identified the candidate networks (§6.2) but did not pull station lists or data; that is a pre-registration task per case and it is the one with the longest lead time, because the HCFCD, PWD and HRSD archives are not all one-click downloads.
5. **Which gauges MRMS actually ingested** for any given event. Not published per event, which is why §6.2 phrases the independent arm as "networks not known to be in the MRMS hourly ingest" rather than claiming independence.
6. ~~**The rate-cap census (G3) for cases 4 and 6.**~~ **Closed for both in revision 2.** Harvey ran to 121/121 frames, peak pixel **189.4 mm/h**, no plateau, 89 % tropical, 0 % hail (§7.4). Matthew ran to 106/106 frames, peak pixel **180.9 mm/h**, no plateau, **99.4 % tropical**, 0.15 % hail (§7.6). Both pass; both verdicts are now measured rather than argued on this dimension. **There is no remaining unrun gate that I am able to run from the archive** — G2, G5, G6, G8 and G9 need either the decoder, the NEXRAD/ROC record or gauge data, and are listed above and below as such. Transfer accounting is in §11.1.

---

## 11. Reproducing everything in this document

Everything quoted here was measured in this repository, not cited. Python 3, numpy only (`geometry.py` and `archive_probe.py` need no third-party packages at all); no credentials; no paid service.

```
research/radar_qpe/
  SPA-93_radar_coverage_and_qpe_assessment.md   this document
  mrms_read.py        minimal MRMS GRIB2 reader (grid template 0, PNG template 5.41),
                      window-subsetting.  Assessment only -- not the pipeline.
  archive_probe.py    what exists, where, for the event dates      -> out/archive_probe.json
  geometry.py         range/azimuth/beam height per case           -> out/beam_geometry.{json,txt}
  advection_test.py   the four acceptance tests of section 5.4     -> out/advection.txt
  refresh_probe.py    effective refresh interval of PrecipRate     -> out/measured_refresh.json
  assess.py           per-case rate, flag and bias measurements    -> out/measured_<case>.json
```

Revision 2 adds five more, behind the review items in §12:

```
research/radar_qpe/
  fetch_budget.py           per-host transfer cap, enforced in code   -> fetch_ledger.json
  seamless_hsr_probe.py     SeamlessHSR availability and GRIB2         -> out/measured_seamless_hsr.json
                            packing; the R/E/D table of section 2.4
  hsr_zr_consistency.py     SeamlessHSR dBZ through the published      -> out/measured_hsr_zr.json
                            Z-R relations vs PrecipRate, by PrecipFlag
  hour_label_test.py        which end of its window an hourly QPE      -> out/measured_hour_label.json
                            file is stamped with
  review_followups.py       peak attenuation on real data; bias        -> out/measured_review_followups.json
                            estimability vs aggregation window
  partial_census.py         rate-cap census over cached frames only,   -> out/measured_partial_<label>.json
                            issuing no requests, cached fraction stated
```

### 11.1 Transfer accounting, and a cap enforced in code

Review item 7 recorded that the first pass pulled on the order of **1.1 GB** from `mesonet.agron.iastate.edu` before that host began throttling, which is too much to take from a third-party academic mirror run as a courtesy, and asked for requests to be capped and for the ticket to be consulted before exceeding 1 GB from any one host.

That is now enforced rather than intended. `fetch_budget.py` keeps a per-host ledger of bytes and request counts that persists across runs, and `mrms_read.fetch` calls `check()` **before** issuing any request and `charge()` only on bytes that actually crossed the wire — cache hits are free. The default cap is **700 MB per host**, deliberately below the 1 GB figure, overridable only by setting `MRMS_HOST_BUDGET_MB` explicitly. Over the cap a script raises `BudgetExceeded` and fails loudly and partially rather than quietly continuing to pull.

Two consequences visible in this revision. The Matthew rate census was **narrowed** from 20:00–02:00Z to 20:00–23:30Z to stay inside the cap, which is a deliberate reduction in scope recorded here rather than a silent one; it still covers the two heaviest hours with margin. And the `SeamlessHSR` availability census samples every 30 minutes across each case date rather than all 720 frames, because an availability question does not need every frame and a reflectivity product costs ~1.2 MB a frame.

The ledger for this revision's run is committed as `out/fetch_ledger.json`: **448.3 MB over 754 requests from `mtarchive.geol.iastate.edu`**, 64 % of the 700 MB cap and 45 % of the 1 GB line above which the reviewer asked us to come back to the ticket.

**One thing the byte cap does not catch, and what to do about it.** Partway through the Matthew census MTArchive began throttling hard — roughly **one request a minute against the nineteen a minute it had been serving**. A byte budget does not see that, because the bytes are arriving, just slowly. The correct response to a host that has slowed down is to slow down with it rather than to parallelise around it, so the census was left to run at the host's pace and `partial_census.py` was written to answer the cap question from frames already in cache, issuing no requests at all. The throttle eased and the full census completed, so the partial was not needed in the end — but the script stays in the repository, because the situation will recur and the alternative to having it is pressure to ask harder at exactly the wrong moment. One number worth passing to the Geospatial Engineer for capacity planning: a `SeamlessHSR` replay of a single full day is **720 frames × ~1.2 MB ≈ 860 MB**, so a replay layer is not a free addition to the ingestion budget and should be fetched for the event window only.

Addendum A adds six more; its §A.12 lists them and how to run them.

```
research/radar_qpe/
  SPA-93_addendum_A_ingestion_response.md       response to the SPA-94 ingestion findings
  frame_identity_probe.py   repeated window max vs repeated frame  -> out/measured_frame_identity.json
  update_census.py          wet pixels changed per frame pair      -> out/measured_update_census.json
  iem_raster_probe.py       IEM raster headers, palettes, ramps    -> out/measured_iem_raster.json
  iem_lut_probe.py          IEM documented index -> value lookups  -> out/measured_iem_lut.json
  iem_lcref_census.py       lcref/a2m file counts per case date    -> out/measured_lcref_census.json
  nodata_probe.py           no-coverage sentinel on both routes    -> out/measured_nodata.json
  hsr_sentinel_census.py    dBZ no-coverage vs no-echo, co-reg     -> out/measured_hsr_sentinels.json
```

`hsr_sentinel_census.py` is cache-only by construction — it resolves its three frames from `$MRMS_CACHE` and raises rather than fetching if one is absent, so it adds nothing to the §11.1 ledger. Revision 3's measurements cost **0 bytes**; the ledger total stands unchanged at 448.3 MB over 754 requests.

```
python archive_probe.py > out/archive_probe.json
python geometry.py
python advection_test.py
OUTDIR=out python refresh_probe.py
OUTDIR=out python assess.py ec2016     # also: ec2018 harvey ida norfolk
```

`assess.py` and `refresh_probe.py` download from the IEM MTArchive and cache to `$MRMS_CACHE`; the full set used here is about 1.1 GB of `.grib2.gz`, not committed. `advection_test.py`, `geometry.py` and `archive_probe.py` are self-contained.

A note on reproducibility that belongs to Phase 3e rather than to me, and that I want on the record anyway: the snapshot-and-hash rule in the plan is what keeps a radar-forced run bit-identically rerunnable, and **MTArchive is a third-party archive with its own retention policy.** IEM already cut its rolling cache from a long window to 30 days in August 2026. The frames consumed by a Phase 1 hindcast must be snapshotted into the run archive at the time of the run, because there is no guarantee the source is still there when the result is challenged.

---

## 12. Revision 2 — index of the review items, and what each one turned up

The seven changes requested in review of revision 1, where each is answered, and what it cost or changed. Four of the seven changed a number; two changed a specification; one changed a recommendation.

| # | Requested | Where answered | What actually happened |
|---|---|---|---|
| **1** | Rerun the 2018 census over the whole storm (~19:00–23:30Z); the 17:00–21:30Z window truncated it | §7.1 | **The reviewer's diagnosis was exactly right** — the old window stopped 90 minutes before the storm did. Rerun at 136/136 frames over a window that is 98.7 % wet instead of 64.8 %. **The no-go holds and the cap evidence is stronger** (still exactly 103.8 mm/h, never exceeded, now across 4,831 wet pixel-frames). Two numbers moved against me: the deficit is **19.3 %, not 22 %**, and the hail plateau 15.5 %, not 18.6 %. |
| **2** | Bring PR #8 up to date with the 22:10 comment — `mrms_lcref`, the corrected duplicate test, the `a2m` tier, the finished censuses | §5.5.1, §7.4, §7.6, §8.1.1, Addendum A §A.7, §A.11 | Done, and three of those findings moved further: the finished update census **corrected my own refresh figure** (§5.5.1, 2.96 min not 2.34, one weak pair in three not one in seven), `mrms_lcref` is itself superseded by `SeamlessHSR` (§8.1.1), and both `<!-- PENDING -->` placeholders in Addendum A are now filled with measured results. |
| **3** | Charleston swings 0.24 → 3.9 and Norfolk shows 0.009; add an event-level-`K` sensitivity run and say which result the recommendation rests on | §6.5, new gate **G11** | **Confirmed for Charleston, refuted for Norfolk.** Charleston has a genuine 1-hour lag (correlation peaks at −1 h); Norfolk has none (peaks at 0 h) and its 0.009 is a single-hour artefact. The ratio's log-SD collapses 1.145 → 0.139 and 0.700 → 0.132 from 1 h to 12 h. The recommendation rests on the **event-level** ratios, which are lag-invariant to 0.5 %. Checking my own result also turned up a caveat I'd missed: the collapse is **phase-dependent**, and my first table quoted the one favourable block phase for Charleston. Corrected to phase-averaged figures in place. |
| **4** | The −83.9 % figure is synthetic; lead with the real ~−33 % | §4.1, §4.2, §0 item 1, §2.5 | **Correct, and the figure is withdrawn.** Real: −33.4 % (EC 2016), −38.9 % (Harvey). The synthetic table is kept in §4.2 explicitly labelled an upper bound. The "factor of six" line is gone. |
| **5** | Text errors: "floor of −30" should be −3.0; −999 cannot be represented | §2.4 traps 1–2, README | **Both correct, and the second is more interesting than stated.** −999 cannot be encoded in `PrecipRate` (floor −3.0) but **is** the no-data value in `SeamlessHSR` (`R = −9990`, `D = 1`). The sentinel set is per-product, so a single global no-data rule is wrong in both directions. |
| **6** | Assess `SeamlessHSR` as the pre-2020 replay layer | §8.1.1, §7.1, §7.5 | **Accepted — it is better than both prior answers.** Native GRIB2, 0.1 dBZ, 48/48 frames on every case date, and measurably the reflectivity `PrecipRate` is derived from (5 % agreement via the published Z–R on tropical pixels). `mrms_lcref` is withdrawn. Its hail-pixel disagreement also independently re-confirmed the 53.8 mm/h cap. |
| **7** | Cap requests; ask before pulling >1 GB from any one host | §11.1, `fetch_budget.py` | Enforced in code at **700 MB per host**, checked before each request, ledger persisted and committed. This revision used **448.3 MB over 754 requests** of it and never came near the 1 GB line. The Matthew census was **narrowed** to stay inside the cap, recorded in §7.6 rather than done silently; and when MTArchive began throttling mid-census (~1 request/min against 19), the response was to slow down and add `partial_census.py` — a census over cached frames only, issuing no requests — rather than to parallelise harder. |

Two things I was asked for and did not do, stated plainly. I did **not** raise the cap to finish the Matthew census over its original 6-hour window — I narrowed the window instead, which is the reviewer's instruction followed rather than circumvented, and §7.6 says which hours are covered. And I did not pursue the Charleston one-hour lag to its mechanism; I have a plausible candidate (an hourly gauge network reporting on standard rather than daylight time) and no evidence for it, so it is a hypothesis in §6.5 and not a finding.

---

## 13. Revision 3 — the SPA-94 reconciliation, item by item

SPA-94's revision-2 comment (2 November 2026, 02:07Z) reported three measurements and two smaller items against this document, and said none of them changes a verdict. **That is correct — none does.** What they changed:

| Their item | Status here | What it changed |
|---|---|---|
| **1.** `SeamlessHSR` gives cases 1, 4 and 6 a dBZ replay | **Already accepted in revision 2** (§8.1.1, review item 6), reached independently — but **they are right that §1.1 still carried the false premise** and, worse, that Addendum A §A.1's per-case table still named the withdrawn `mrms_lcref`. Both corrected. | **Answer to their question: no, do not default those three to `@forcing`.** Cases 1a, 1b, 4 and 6 render `mrms_seamless_hsr`; case 5 renders `mrms_merged_reflectivity_qc_composite`; cases 2 and 3 render `none`. Legend must say "hybrid scan", never "column-maximum" — which they had already inferred correctly. |
| **1b.** Their two sentinels, `−999.0` / `−99.0` | **Confirmed by measurement, §8.1.2**, and extended | **The one new specification in this revision.** The no-echo set is pixel-identical to `PrecipRate == 0` (21,393 / 21,393), the no-coverage masks co-register exactly (1,600 / 1,600), and a new **legend requirement** forbids rendering −999 on the colour ramp. New gate **G2c**, which case 5 must run because its display product is a different product with its own header. |
| **2.** Archived hourly products are clock-hourly, 24 files/day | **Confirmed and useful** — §2.1 step 3 needs no reconstruction from running sums | Added to §2.4 trap 4 with a warning: **file spacing fixes the grid, not the offset.** M14 alone would license the start-of-window reading, which trap 4 measures wrong by 6.91 mm against 0.07 mm. The two facts must travel together, and their §4.6 implements steps 1–7 as written in **revision 1**, which predates trap 4. |
| **3.** The v12 switch cannot be keyed on availability | **Agrees with §2.3**, which was already keyed on the declared date | Their M15 supplies the measured reason — both families present on 2020-10-13 and 2020-10-14 — so §2.3 now states it as measured rather than as a preference. No Phase 1 case sits on the boundary. |
| **4.** §2.4 trap 2's floor is exactly −3.0, coinciding with the no-coverage sentinel | **Already corrected in revision 2** (review item 5), and they confirm the per-product sentinel rule | Nothing further; §8.1.2 now applies the same rule to the display layer, which is where it had not been applied. |
| **5.** `dedupe.threshold` has no default and is mine to set | **Set, §5.5.2** | `dedupe.threshold = 0.25`, `dedupe.wetThreshold = 1.0 mm/h`, with the metric defined to match the measurement that justifies it — and an explicit scope rule, because **the parameter's name invites dropping weak frames from the forcing integration, which would distort the hyetograph while leaving the event volume exact.** Gate and forcing paths are now separated in writing. |

**One thing I would flag back.** Their §4.6 implements this document's §2.1 steps 1–7 "verbatim", and the version it implements is revision 1's, which did not contain the end-of-window finding. Revision 2's step 4 does. If that implementation pairs `Q_hourly(x, hour)` with the rate frames from `T` forward, every `K` is shifted by one hour — and gate **G10** exists precisely because the resulting error leaves event volume exact and so passes a water-balance check. Worth checking against revision 2's step 4 before anything is run, not after.

---

## 14. Sources

Verified during this assessment.

- [NOAA MRMS on the AWS Open Data Registry](https://registry.opendata.aws/noaa-mrms-pds/) — and the bucket itself, enumerated: every CONUS product's earliest partition is 2020-10-14
- [IEM MRMS archives](https://mesonet.agron.iastate.edu/archive/mrms.php) — MTArchive back to October 2014; rolling real-time cache cut to 30 days in August 2026
- [Operational MRMS GRIB2 product tables, NSSL](https://nssl.noaa.gov/projects/mrms/operational/tables.php) — `PrecipRate` is "Radar Precipitation Rate", mm/h, 2-minute, centre 209 / subcentre 6 / parameter 1
- [MRMS v12.0 operational at the NWS, 14 October 2020](https://inside.nssl.noaa.gov/mrms/2020/10/mrms-v12-0-operational-at-the-nws/) — dual-pol synthetic radar QPE, multi-sensor QPE
- [Timeline of MRMS builds, NSSL](https://inside.nssl.noaa.gov/mrms/build_timeline/) — v12.0 2020-10-14; v12.1 2021-02-24; v12.2 2022-04-22
- [MRMS SCN v12.1 upgrade supplemental](https://www.nco.ncep.noaa.gov/pmb/changes/MRMS_SCN_v12.1_Upgrade_Supplemental.pdf) — Pass 1 latency 60→20 min, Pass 2 120→60 min
- [Service Change Notice 25-46, MRMS v12.3](https://www.weather.gov/media/notification/pdf_2025/scn25-46_MRMS_v12.3.pdf)
- [Zhang et al. 2016, *MRMS QPE: Initial Operating Capabilities*, BAMS 97, 621–637](https://journals.ametsoc.org/view/journals/bams/97/4/bams-d-14-00174.1.xml) — six Z–R relations; stratiform cap 48.6 mm/h, convective 103.8 mm/h, hail 53.8 mm/h
- [Surface Precipitation Rate (SPR) v12.2, NWS WDTD](https://vlab.noaa.gov/web/wdtd/-/surface-precipitation-rate-spr-1) — v12 dual-pol: R(A) capped 200 mm/h, R(K_DP) 150 mm/h, convective/hail 5.9 in/h
- [Radar Quality Index (RQI), NWS WDTD](https://vlab.noaa.gov/web/wdtd/-/radar-quality-index-rqi-) — `RQI = RQI_blk × RQI_hgt`, 0–1; blockage and beam height relative to the freezing level and bright-band thickness
- [QPE mosaic process, NWS WDTD](https://vlab.noaa.gov/web/wdtd/-/qpe-mosaic-process) — distance/height/RQI-weighted mosaic, RQI ≥ 0.9 first threshold
- [Multi-Sensor QPE, NWS WDTD](https://vlab.noaa.gov/web/wdtd/-/multi-sensor-qpe) and [Radar QPE with gauge bias correction](https://vlab.noaa.gov/web/wdtd/-/qpe-w-gauge-bias-correcti-1) — from v12 the gauge-bias-corrected radar QPE is an input to Multi-Sensor QPE, not a standalone product
- [Zhang et al. 2016 (JHM 18, 1327), *A Physically Based Two-Dimensional Seamless Reflectivity Mosaic for Radar QPE in MRMS*](https://journals.ametsoc.org/view/journals/hydr/18/5/jhm-d-16-0197_1.xml) — SHSR construction
- [Martinaitis et al. 2021, *The Historic Rainfalls of Hurricanes Harvey and Florence: A Perspective from MRMS*, JHM 22, 3](https://journals.ametsoc.org/view/journals/hydr/22/3/JHM-D-20-0199.1.xml) — distinct biases in the two radar-only QPEs against CoCoRaHS, mitigated by the dual-pol synthetic approach; <10 % of hourly gauge reports failed MRMS QC before Harvey's landfall
- [MYRORSS](https://ams.confex.com/ams/37RADAR/webprogram/Handout/Paper275486/205_ortega_et_al_myrorss.pdf) — WSR-88D archive through the MRMS framework, 2000–2011, reflectivity-derived
- [WSR-88D site coordinates (NAD83)](https://apollo.nvu.vsc.edu/classes/remote/lecture_notes/radar/88d/88D_locations.html) — KLWX, KDIX, KAKQ, KHGX, KCLX, KDOX, KCCX, KMHX, KRAX
- [NCEI Terminal Doppler Weather Radar](https://www.ncei.noaa.gov/products/radar/terminal-doppler-weather-radar) and [NWS TDWR site list](https://www.weather.gov/media/tg/tdwr-radar-list.pdf) — 45 US TDWRs, ~5-minute products; TBWI, TPHL, THOU, TIAH coordinates
- [Nielsen et al. 2021, *The Bellinge data set*, ESSD 13, 4779](https://essd.copernicus.org/articles/13/4779/2021/) — 1.72 km² (0.55 km² paved); two permanent 1-minute tipping-bucket gauges in and just outside the catchment on opposite sides, plus a 1-year temporary gauge; X-band radar from 2012 at 1-minute and ~925 m cells; DMI C-band at Virring ~80 km away, 5-minute, from 2017; 2010–2020
- [Bellinge radar data, DTU Figshare](https://data.dtu.dk/articles/dataset/Radar_data_etc_/12513236)
- [Howard County, *2016 Ellicott City Flood Case Study*](https://www.howardcountymd.gov/sites/default/files/2021-08/2016%20Ellicott%20City%20Case%20Study%204.15.17.pdf) and [Plumtree & Tiber watersheds](https://www.howardcountymd.gov/public-works/plumtree-tiber-watersheds) — Tiber Branch watershed 3.7 mi² (2,368 acres), Hudson/Tiber/New Cut branches; 6.60 in in 2 hours on 30 July 2016
- [2018 Central Maryland flood](https://en.wikipedia.org/wiki/2018_Central_Maryland_Flood) — ~8 in in 2 hours, 27 May 2018
- [Harris County Flood Warning System](https://www.harriscountyfws.org/FAQs) and [HCFCD Storm Center](https://www.hcfcd.org/Resources/Storm-Center) — 153 gauges, historical 15-minute precipitation
- [Hong et al. 2021, *Performance of MRMS under extreme events in Harris County, Texas*, J. Hydrology 598](https://ui.adsabs.harvard.edu/abs/2021JHyd..59826385H/abstract) — R² 0.78 at 15 min / 15 km; underestimates high rates, overestimates light rain
- [USGS SIR 2023–5086, *Peak streamflows and flooding in Pennsylvania from the remnants of Hurricane Ida, 1–2 September 2021*](https://pubs.usgs.gov/publication/sir20235086/full)
- [NHC Tropical Cyclone Report, Hurricane Matthew (AL142016)](https://www.nhc.noaa.gov/data/tcr/AL142016_Matthew.pdf) and [Virginia DLS, Hurricane Matthew impacts](https://dls.virginia.gov/groups/flooding/impacts101716.pdf) — Norfolk 7.44 in on 8 October 2016 (wettest October day on record), 6–11 in across south-east Virginia, Sewells Point peak 7.9 ft MLLW
- [NHC Tropical Cyclone Report, Hurricane Harvey (AL092017)](https://www.nhc.noaa.gov/data/tcr/AL092017_Harvey.pdf)
