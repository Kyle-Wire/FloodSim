# Addendum A — response to the Phase 3e ingestion findings

**Task:** SPA-93 · Radar & Precipitation (QPE) Specialist · **Date:** 1 November 2026
**Responds to:** SPA-94 ingestion design findings (PR #5), comment of 2026-11-01T21:01Z
**Status:** amends the main assessment. Where this addendum and the main document disagree, **this document is correct** and the main document carries a pointer at the affected section.

SPA-94 measured the live archives rather than quoting documentation, and asked for a product-and-pass answer plus a decision on three interface shapes. This is that answer. Everything below is measured in this repository on 2026-11-01; the new scripts are listed in §A.12.

Two of SPA-94's eight points change my specification, one of them in a way that corrects an over-general claim I made to the board. One of them corrects a measurement of my own that was answering the wrong question. The remaining five confirm the main document from an independent direction, and I say which, because "confirmed" is only worth reading when it was capable of coming out the other way.

| SPA-94 point | Disposition |
|---|---|
| 1. NODD bucket begins 2020-10-14 | **Independently confirmed** (§1.1 of the main document, 13 products probed). No change. |
| 2. mtarchive is a true mirror back to 2015 | **Confirmed**, and this addendum adds a second, stronger form of the check (§A.2). |
| 3. No `MultiSensor_QPE_*` pre-v12; `GaugeCorr_QPE_01H` instead | **Already honoured** — the main document is version-keyed on 2020-10-14 throughout. §A.1 removes the remaining inference with an explicit per-case product table. |
| 4. `mrms_lcref` raster exists for the pre-v12 cases | **This corrects me.** I told the board no dBZ replay was possible for cases 1, 4 and 6. It is. §A.3. |
| 5. `mrms_a2m` raster is lossy — 0.6 mm/h quantum, 152.4 mm/h ceiling, "marginal, not proven broken" | Arithmetic confirmed from IEM's own lookup table. On case 1a it is **more** marginal than the cited window showed, and separately I expected it to lose the no-coverage sentinel and **it does not**. §A.4, §A.5. |
| 6a. Repeated window maxima imply a 4–6 min volume scan | **The inference does not hold — and my own test was the wrong test, and the intuition behind SPA-94's was right.** §A.7. |
| 6b. Valid times are not on a regular grid for every product | **Confirmed**, and it generates a requirement neither document had: the display and forcing layers are not co-timed. §A.6. |
| 7. Three interface shapes offered for change | One change requested, and it matters. §A.9, §A.10. |
| 8. Factor of 8 in rain rate inside a 7 km × 6 km box | **Reproduced exactly**, and §A.8 gives the accumulated counterpart, which is a factor of 1.3 — the contrast is the point. |

---

## A.1 Product and pass selection, per case, with nothing left to infer

SPA-94 asked whether my specification names a product that cannot be honoured pre-v12. It does not: §2.1 step 4, §2.2, §2.3 and §1.2 of the main document are keyed on the 2020-10-14 switch and name `GaugeCorr_QPE_01H` for the pre-v12 era throughout. But the specification expressed that as a rule to be applied rather than as a per-case answer, and a rule is a thing that can be applied wrongly. So here is the answer evaluated for all six cases.

| # | Case | Date | Era | **Forcing** | **Hourly normaliser** | **Bias denominator** | **`displayProduct`** | Archive host |
|---|------|------|-----|-------------|----------------------|----------------------|----------------------|--------------|
| 1a | Ellicott City | 2016-07-30/31 | pre-v12 | `PrecipRate_00.00` | `GaugeCorr_QPE_01H` | `RadarOnly_QPE_01H` | `iem_mrms_lcref` | MTArchive |
| 1b | Ellicott City | 2018-05-27 | pre-v12 | *not forced from radar* — see §7.1 | — | `RadarOnly_QPE_01H` (for the record) | `iem_mrms_lcref` | MTArchive |
| 2 | Bellinge | — | n/a | supplied gauges | — | — | **`none`** | — |
| 3 | EA 8A/8B | — | n/a | specified uniform | — | — | **`none`** | — |
| 4 | Meyerland / Brays | 2017-08-26/27 | pre-v12 | `PrecipRate_00.00` | `GaugeCorr_QPE_01H` | `RadarOnly_QPE_01H` | `iem_mrms_lcref` | MTArchive |
| 5 | Philadelphia / Ida | 2021-09-01/02 | **v12** | `PrecipRate_00.00` | `MultiSensor_QPE_01H_Pass2` | `RadarOnly_QPE_01H` | `mrms_merged_reflectivity_qc_composite` | NODD |
| 6 | Norfolk / Matthew | 2016-10-08/09 | pre-v12 | `PrecipRate_00.00` | `GaugeCorr_QPE_01H` | `RadarOnly_QPE_01H` | `iem_mrms_lcref` | MTArchive |

`MultiSensor_QPE_01H_Pass1` appears nowhere in this table. It is legal only as a recorded fallback for a single missing Pass 2 hour on case 5 (main document §2.1 step 6), and never as a hindcast normaliser.

Case 1b keeps a display product and a bias denominator because the main document recommends running it as a **rainfall-forcing sensitivity case with its rainfall scaled to the gauge total and labelled as derived** (§7.1). That run is not radar-forced, so §8.1's prohibition applies: it must not render a radar layer as though the radar drove it. The honest arrangement is a derived-forcing label under §8.3 with the reflectivity layer available for context and explicitly marked as not the forcing — and if that is too fine a distinction to hold in the UI, then `none` is the right value and the figure loses nothing that matters.

## A.2 The archive window, and a check that two readers agree

SPA-94's point 1 matches my §1.1 independently: separate probes, separate code, same answer, 2020-10-14 for every CONUS product. Their sha256 check on one file fetched from both hosts settles content fidelity for that file.

I can add a check with more reach, because it compares *decoders* rather than *bytes*. SPA-94 reported a 7×7 window census over Ellicott City at 2016-07-30 23:52 UTC: rate from **18.6 to 148.6 mm/h, mean 63.6**. My reader, written independently, over a 7×7 window centred on the same town, on the same frame, returns **18.6, 148.6 and 63.6**. Two independently written GRIB2 section-7 PNG-template decoders agreeing to the last represented decimal on a 16-bit packed field means the numbers in both documents are decoder-independent. That is worth more than a byte comparison, because a byte comparison cannot catch a scaling error that both parties would make.

It also resolves an apparent conflict before anyone has to chase it. SPA-94 reports a measured peak of 148.6 mm/h; the main document reports 152.3 mm/h for the same storm. **Both are right.** 152.3 is the peak over the Tiber catchment box, which sits 2–4 km north-west of the town centre; it is outside SPA-94's 7×7 window. Measured in the same run: at 23:52 the 7×7 maximum is 148.6 and the catchment maximum is 152.3, and the field maximum over a 31×31 window is also 152.3, at 39.31 N / −76.83 W. Nothing is in dispute and the larger number is the one that matters for §A.4.

## A.3 The display layer — I was wrong, and the correction is good news

> **Superseded by main document [§8.1.1](SPA-93_radar_coverage_and_qpe_assessment.md#811-the-pre-2020-replay-layer--seamlesshsr-and-this-supersedes-two-earlier-answers) (revision 2).** This section's conclusion — that the pre-2020 replay layer should be IEM's `mrms_lcref` raster — is **withdrawn**. Review item 6 pointed out that neither this addendum nor SPA-94 had looked at **`SeamlessHSR`**, which is native NCEP GRIB2, 0.1 dBZ, present on every pre-2020 case date at 2-minute cadence, and measurably the reflectivity `PrecipRate` is derived from. It is better than `mrms_lcref` on precision, provenance, timing and — decisively — on the low end, since `lcref`'s palette renders everything at or below +10.5 dBZ as pure black. The availability census below stands as measured and `mrms_lcref` survives only as a fallback. **The reasoning in this section is still worth reading**, because the part of it that was right — that a dBZ replay *is* possible for cases 1a, 4 and 6, against the main document's original claim — is what prompted looking for a better route.

**What I said.** Main document §1.1 and §8.1: `MergedReflectivityQCComposite` is absent from the archive before October 2020, therefore "for cases 1, 4 and 6 there is no dBZ layer available at all", and in my completion comment, "only Ida can have a genuine dBZ replay".

**What is true.** That was a correct statement about the NCEP GRIB2 tree and an incorrect statement about the archive. IEM renders its own reflectivity raster, and it goes back further than the case set does. Measured — file counts from the IEM GIS archive directory listings (`iem_lcref_census.py`):

| Case date | `lcref` files | All even minutes | `a2m` files |
|---|---|---|---|
| 2016-07-30 | **720 / 720** | yes | 719 |
| 2016-07-31 | **720 / 720** | yes | 720 |
| 2016-10-08 | **720 / 720** | yes | 720 |
| 2016-10-09 | **720 / 720** | yes | 720 |
| 2017-08-26 | **720 / 720** | yes | 720 |
| 2017-08-27 | **720 / 720** | yes | 720 |
| 2018-05-27 | **720 / 720** | yes | 720 |
| 2021-09-01 | **720 / 720** | yes | 718 |
| 2021-09-02 | **720 / 720** | yes | 718 |
| **2014-11-01** (archive day one) | **720 / 720** | yes | 720 |

So the dBZ replay layer is available at full 2-minute cadence for every Phase 1 radar case and for every case-6 candidate back to the first day of the MRMS archive. **Cases 1a, 4 and 6 can have a reflectivity replay.** I withdraw the pessimistic statement in my completion comment.

**And the `a2m` column is an independent corroboration of something else.** 719 on 2016-07-30 and 718 on both Ida days are exactly the gaps §1.1 reports for `PrecipRate` on those dates from a different host in a different format. The gaps are in MRMS, not in a route. **But `lcref` is 720 on those same days** — the reflectivity mosaic was produced for frames where the rate product was not. That is a second reason the two layers cannot be paired by frame index (§A.6).

**What the raster is, measured and sourced.** IEM documents its index semantics at `GIS/rasters.php?rid=N`; `iem_lut_probe.py` enumerates them and `iem_raster_probe.py` parses the PNG itself.

| | `mrms_lcref` (rid 4) | `mrms_a2m` (rid 3) |
|---|---|---|
| Raster | 7000 × 3500, 8-bit **palette-indexed** | 7000 × 3500, 8-bit palette-indexed |
| Grid | `.wld` = 0.01°, origin −130.0 / 55.0 | identical |
| Index 0 | **−32 dBZ** | 0 mm |
| Step per index | **0.5 dBZ, uniform** | 0.02 mm, uniform |
| Index 254 | **+95 dBZ** | 5.08 mm |
| Index 255 | **Missing** (RGB 144,144,144) | Missing |
| Palette distinct colours | **142 of 256** | 252 of 256 |
| Flat ramp | indices **0–85 all pure black** | index 0 only |

The grid is the MRMS grid at the MRMS resolution, so the display layer registers pixel-for-pixel with the forcing field with no reprojection. For a dBZ display layer 0.5 dBZ is ample and +95 dBZ is above anything meteorological, so unlike `a2m` the reflectivity raster has **no ceiling problem and no quantisation problem**.

**Decision.** `displayProduct` takes exactly the three values SPA-94 built, and the per-case assignment is the last column of §A.1:

- `mrms_merged_reflectivity_qc_composite` — case 5 only. The only case whose era has it.
- `iem_mrms_lcref` — cases 1a, 4, 6 (and 1b if that run renders a context layer at all, §A.1).
- `none` — cases 2 and 3, mandatory, per §8.2 of the main document.

**Three amendments to §8.1 that follow from the product actually being a different product.**

1. **`lcref` is *lowest-elevation* composite reflectivity, not column-maximum.** §8.1 licenses the legend to say "column-maximum quality-controlled radar reflectivity". That wording is correct for `MergedReflectivityQCComposite` and **wrong for `lcref`**, which samples the lowest unblocked tilt rather than the column maximum. Those are different fields with different vertical sampling, and labelling one with the other's words is precisely the conflation §8 exists to prevent. The legend for cases 1a/4/6 must say **"lowest-elevation composite reflectivity"**; "column-maximum" is reserved for case 5.
2. **The layer is blind below +10.5 dBZ, and the legend may not let absence of colour mean absence of echo.** Palette indices 0–85 are all RGB (0,0,0) — that is every value from −32 dBZ to **+10.5 dBZ** rendered as pure black. Light rain sits in that band. A reviewer reading unpainted area as "no echo" would be reading a palette decision as an observation.
3. **Read the palette index, never the rendered colour.** The index carries 0.5 dBZ; the rendered RGB does not invert uniquely (141 distinct colours across the 169 visible indices). Any pipeline that samples the PNG's RGB and inverts a ramp will be wrong somewhere and will not know where.

**And the provenance is weaker than the GRIB2 route, in a way the legend must carry.** `lcref` is a rendered raster, not an NCEP GRIB2 message. There is no section 1, so **the valid time comes from the filename**, which lands exactly on even minutes — while SPA-94 measured the v12-era reflectivity GRIB2 valid times at ~40 s past the even minute, irregularly spaced 122–159 s. Either IEM relabels the frame to its processing slot or the pre-v12 product was timed differently, and **from the raster alone the pipeline cannot tell which.** So: on the raster route the legend may state the frame time only to the nearest minute and must not imply second-level precision; the source credit is **IEM**, not NCEP; and there is no companion quality field, so no RQI or `PrecipFlag` statement may be attached to this layer. Where a precise valid time matters, the rate layer's GRIB2 section 1 is the authority.

## A.4 The `a2m` raster is never a forcing route — and on case 1a it is one index step from truncating the peak

SPA-94's arithmetic is confirmed from IEM's own table: 0.02 mm per index over a 2-minute accumulation is **0.6 mm/h per step**, and index 254 = 5.08 mm is a hard **152.4 mm/h ceiling**, with index 255 meaning Missing rather than a higher value.

Their honesty about the direction of the result is right and I will match it: the figure they measured, 148.6 mm/h, is 97.5 % of the ceiling and does not exceed it. But 148.6 is the 7×7 town-centre window, and **the catchment peak in the same storm is 152.3 mm/h — 99.93 % of the ceiling, one quantisation step below it** (§A.2). In the main document's census that value is the p99.9 *and* the maximum of 4,186 wet pixel-frames, so the storm's peak pixel-frames are sitting on the last representable index. On the one Phase 1 case the raster would most plausibly be reached for, it is within a single index of truncating the event peak, and a reader could not tell truncation from a cap because index 255 means Missing.

**Specification: `iem_mrms_a2m` has no role in Phase 1 at all, and the registry gives it tier `prohibited`.** Not "display only", not "fallback": prohibited.

- As **forcing** it is disqualified twice over — the 0.6 mm/h quantum against the GRIB2's 0.1, and the ceiling one step above the measured peak.
- As a **display rate layer** it is pointless, because `PrecipRate` GRIB2 is already being fetched for the forcing on every radar case and is strictly better in every respect. A second, worse copy of a field we already have earns nothing and creates a route by which the worse copy can reach a figure.
- SPA-94's rule — use the raster "only where no GRIB2 route covers the date" — is correct in spirit and should not be the implementation, because **for every Phase 1 case a GRIB2 route does cover the date**, so the condition is never true, and a condition that is never true is untested. The first time an MTArchive fetch returns 404 under a retry budget, a "fallback where GRIB2 is unavailable" rule silently becomes a forcing route. A `prohibited` tier cannot do that.

If a future case genuinely has no GRIB2 route, that is a new pre-registration decision with this number in front of it, not a fallback.

## A.5 The no-coverage sentinel: I expected the raster to lose it, and it does not — but gate G2 now has a positive control

Main document §2.4 trap 2 states that MRMS encodes −3 for "no radar coverage", that treating it as 0 mm/h turns a radar outage into a dry spell, and — reported as such — that this was "a trap identified from the encoding, not one I tripped", because every case window was inside coverage.

I expected the `a2m` raster to make it worse: index 0 is documented as exactly 0 mm, so I predicted a no-coverage pixel would arrive as index 0 and the format itself would bake the bug in. **Measured, and that prediction is wrong.** `nodata_probe.py` samples a patch of the MRMS grid that no WSR-88D can see — 53.80–54.20 N, −100.40 to −100.00 E, central Canada, inside the 55 N grid edge and far outside coverage — on the 2016-07-30 22:00 UTC frame, with a Maryland patch as a control:

| Route | No-coverage patch | Maryland control |
|---|---|---|
| GRIB2 `PrecipRate` | **−3.0 on 1600 / 1600 pixels**, one distinct value, 100 % negative | 0.0 to 71.7 mm/h, 77 distinct values, 0 % negative |
| IEM `a2m` raster | **index 255 ("Missing") on 1600 / 1600**, 0 % index 0 | 37 distinct indices 0–119, 10.2 % index 0, 0 % index 255 |

So the raster preserves invalidity. What it loses is *which* invalidity: MRMS's −3 (no coverage) and −999 (missing) both collapse to index 255, so the raster can say "not a valid value" but not "the radar could not see this". The `a2m` disqualification in §A.4 rests on the ceiling and the quantum, not on this.

**The more useful result is that trap 2 is now observed rather than inferred, and that makes gate G2 testable.** §9's G2 as written is a census — scan the domain for values below zero — which can only pass vacuously on a case window that has no outage. A census that cannot fail is not a gate.

**Add G2b, and make it a merge gate on the decoder alongside T1.** Decode any single `PrecipRate` frame over the window 53.80–54.20 N / −100.40 to −100.00 E and assert that the pipeline reports *no radar coverage* over the whole patch and **not** 0 mm/h, and that the patch does not contribute 0 mm to any accumulation. It runs offline from one cached frame, takes a second, needs no event data, and it is the test that would catch the single most dangerous decoding bug available here. The same patch gives the raster route its own assertion: index 255 must not become 0 mm.

## A.6 Valid times — R1 confirmed, and the display and forcing layers are not co-timed

SPA-94's point 6b confirms §5.1-R1 from a second direction: R1 already requires the motion estimator to publish the gap in seconds it actually used and forbids assuming 120 s, and their measurement of reflectivity frames spaced 122–159 s is exactly the condition R1 exists for. Their design reading each frame's valid time from GRIB2 section 1 and imposing no cadence-alignment rule is the right call and I would not change it.

It also generates a requirement that neither document had. If `PrecipRate` lands on even minutes and the reflectivity product lands ~40 s later at irregular spacing, then **the display layer and the forcing layer are not co-timed**, and pairing them by frame index misplaces the drawn storm relative to the applied rain by up to the offset. At 15 m/s — the ticket's own cell speed — a 40 s offset is **0.6 km** and an 80 s worst case is **1.2 km**. On a 5 km domain that is 12–24 % of the domain width: the replay would show the cell displaced from the rain that is actually falling on the model, consistently, and it would look like a model error. §A.3 adds a second mechanism on the same theme — `lcref` has 720 frames on days where `a2m` and `PrecipRate` have 718 or 719, so an index-based pairing does not merely offset, it **drifts** once a gap is passed.

Requirements:

- **R7. Every layer carries its own valid time, from its own source.** GRIB2 section 1 where there is one; the filename, labelled as a processing slot accurate to ±60 s, for the IEM raster route (§A.3). No layer may ever be labelled with another layer's timestamp, and no layer may be paired with another by frame index.
- **R8. Each layer is interpolated to the solver clock independently**, by the §5.2 method or by nearest-frame, and the choice is recorded per layer. A display layer advected to the solver instant is a *derived* field and §8.3's labelling rule applies to it too — which §8.1 did not say, because §8.1 assumed the display layer was shown as published.
- **R9. `advect.at` must accept any gridded field**, not only the forcing field, so that R8 can be satisfied with the same code and the same motion estimate rather than a second ad-hoc path in the UI.

## A.7 Frames are not duplicated — and SPA-94's intuition was better than my measurement

This is the substantive disagreement and it ends with a correction to my own §5.5.

**The inference as stated does not hold.** SPA-94 read repeated 7×7 window maxima across frame pairs as evidence of a 4–6 minute volume scan behind the 2-minute publication cadence. `frame_identity_probe.py` decodes the exact frames cited and compares the fields at three window sizes.

The window maxima reproduce exactly — 127.8 mm/h at 22:36 and 22:38 (and at 22:40, a third frame SPA-94 did not list), 133.6 at 22:44 and 22:46, 135.6 at 23:24 through 23:30. But:

| Pair | 7×7 bit-identical | 7×7 wet pixels changed | 31×31 field max moved |
|---|---|---|---|
| 22:34 → 22:36 | no | 98 % | 3.34 km |
| 22:36 → 22:38 | no | 93.9 % | 0 km |
| 22:38 → 22:40 | no | 100 % | 12.37 km |
| 22:44 → 22:46 | no | 10.2 % | 0 km |
| 23:24 → 23:26 | no | 2.0 % | 0 km |
| 23:26 → 23:28 | no | 100 % | 1.41 km |
| 23:28 → 23:30 | no | 2.0 % | 1.41 km |

**Not one of the seven pairs is bit-identical, at any window size.** A repeated window maximum is a core holding its peak value while the field moves underneath it — which is what a convective core crossing a 7-pixel window does — and the field maximum over a wider window moves by up to 12.4 km across the same frames. So duplicated frames are not what that observation shows, and an estimator must not be designed around the belief that they are.

**But my own test was answering a different question than the one I used it for, and SPA-94 was pointing at something real.** `refresh_probe.py` asked whether consecutive frames are *bit-identical*, found 5–15 %, and I concluded in §5.5 that "the 2-minute cadence is substantially real". Byte-equality is far too strict a proxy for "carries new information": a single pixel moving 0.1 mm/h makes a frame non-identical while 98 % of the field is stale. Look at the middle column above. Three of the seven pairs changed 94–100 % of their wet pixels; **four changed 2–10 %**, with an RMS difference over the 7×7 of 0.52 mm/h on 22:44 → 22:46 and 3.81 on 23:28 → 23:30. New information arrives in bursts on roughly alternate frames, and **none of those pairs would have been counted as a duplicate by my test.**

So neither "the frames are duplicated" nor "the 2-minute cadence is real" is the right description. The right statistic is the fraction of wet pixels that change between consecutive frames, and `update_census.py` measures it over whole event windows rather than seven hand-picked pairs.

**It finished, and it moves my own headline number.** Scored on the fraction of wet pixels changed, with a low-information threshold of 0.25:

| Window | Pairs | Bit-identical | **Weak updates (`f` < 0.25)** | Pairs > 90 % changed | Longest weak run | **Implied new-observation interval** |
|---|---|---|---|---|---|---|
| Ellicott City 2016, 22:00Z–02:00Z | 117 | 17 (14.5 %) | **32.5 %** | 53.8 % | 1 | **2.96 min** |
| Ellicott City 2018, 17:30Z–21:00Z | 93 | 5 (5.4 %) | **19.4 %** | 39.8 % | 2 | **2.48 min** |
| Ida / Philadelphia, 00:00Z–04:00Z | 118 | 0 (0.0 %) | **0.0 %** | 97.5 % | 0 | **2.00 min** |

The `f` distribution over Ellicott City 2016 is strongly bimodal, exactly as the seven hand-picked pairs suggested: median 0.917, mean 0.619, p10 **0.0**, p90 **1.0**. Frames mostly either refresh almost completely or barely at all.

**So §5.5's "effective refresh 2.0–2.3 minutes" was wrong, and wrong in the direction that flattered my conclusion.** The honest range is **2.0–3.0 min**, and the weak-update fraction for 2016 is **32.5 %, not the 14.5 % byte-equality found** — one pair in three rather than one in seven. SPA-94's intuition was closer to right than my refutation allowed. The 4–6 minute volume-scan hypothesis is still refuted and advection correction still ranks third (main document §5.5.1 records that decision, which I owed the board from this census), but the guard specified below is load-bearing rather than precautionary, and the era dependence is sharp: **32.5 % in 2016, 19.4 % in 2018, 0.0 % in 2021.** The pre-v12 cases need the guard and the v12 case does not — which is inconvenient, because the pre-v12 cases are also the ones with the rate caps.

**The requirement in §5.5 must be broadened, and it is broadened because of SPA-94's observation.** §5.5 specified: detect duplicate frames, exclude them from the motion estimate, carry the previous displacement across the duplicate run using real elapsed time. That guard keys on byte-equality and would have caught **none** of the four weak-update pairs above — yet those are the pairs on which cross-correlation is least able to see motion, because almost nothing in the field has moved to correlate against.

**Specification, replacing §5.5's last paragraph.** Per frame pair, compute `f` = the fraction of pixels wet in either frame whose value changed. If `f < 0.25`, the pair is a **low-information pair**: exclude it from the motion estimate, carry the smoothed previous displacement across it using the real elapsed time from R1, and set the `lowInformation` flag in the provenance for that pair. Report the distribution of `f` per run. Byte-equality remains a special case of this test, not a separate one.

## A.8 Spatial variability — reproduced, and the accumulated counterpart is the useful contrast

SPA-94's point 8: over a 7×7 window at 2016-07-30 23:52 UTC the rate runs 18.6 to 148.6 mm/h, mean 63.6 — a factor of 8 inside a 7 km × 6 km box, which is what the current single-point forcing in `src/history.js` averages away. Reproduced exactly (§A.2).

The number worth putting beside it is the **accumulated** spread over the same catchment across the whole event, from the main document's census: 127.9 mm at the driest pixel, 148.7 mm box mean, **168.8 mm at the wettest — a factor of 1.32**, not 8.

Both numbers are real and the contrast is the point. The instantaneous field varies by a factor of 8 because a 1-pixel-wide core is crossing the box; the event accumulation varies by only a third, because the core sweeps most of the box in turn. For a 9 km² catchment, that is the same conclusion §4 reached from the opposite direction: **the single-point forcing's error is modest on event volume and enormous on instantaneous intensity**, and a programme that checks its rainfall by comparing event depths will see nothing wrong. It is a further argument for spatialising the rainfall, and it is not an argument that spatialising it will change the water balance much. On case 5's inlet-scale questions, where the response time is minutes rather than tens of minutes, the factor of 8 is the one that governs.

## A.9 The interface shapes — one change requested, and it is the one that matters

SPA-94 offered to change any of the three operator interfaces rather than have the method bent to fit them. One change, then two sets of constraints.

### The change: split `bias` in two, and delete the method that must never be called

`bias.measure` / `bias.apply` as a single operator conflates two things the main document deliberately keeps apart, and the conflation is exactly the failure mode §6 exists to prevent.

1. **The renormalisation field `K`** (§2.1 steps 4–7) is QPE-internal: the ratio of MRMS's own hourly product to the integral of MRMS's own rate product. It **is** applied, after Gaussian smoothing at 5 km σ and clipping to [0.5, 2.0], with its mean, spatial SD, min, max and clipped fraction recorded per hour.
2. **The gauge–radar bias** (§6) is measured against gauges *not* known to be in the MRMS hourly ingest. It is reported on **every** radar-forced run, with its `n` and spread, and it is **never applied**. That is not a default I am setting; it is the specification, and §8.2 forbids a QPE forcing layer from appearing on screen without it.

An interface with one `bias` noun and an `apply` verb invites someone to apply the second one, in good faith, six months from now, in a hotfix. **Request: two interfaces.**

- `renormalise.field(rateSeries, hourlyProduct, …) → K` and `renormalise.apply(series, K) → series`, with the smoothing σ, the clip bounds and the reported statistics as required arguments.
- `biasReport.measure(field, gauges, …) → BiasReport`, **with no `apply` method on the interface at all.**

Make the forbidden operation unsayable rather than merely forbidden in a document. If the two must share an implementation, share it below the interface, not at it.

`BiasReport` must carry: `n` gauges, the statistic (§6.1), its spread, the gauge network names, whether each network is known-independent of the MRMS ingest, and the §6.4 label earned — including the literal `"bias not measurable (n < 3)"` as a representable value rather than a null.

### `advect` — the shape fits; six constraints on what it returns

`advect.motion` / `advect.at` is the right decomposition for the semi-Lagrangian method in §5.2. Constraints:

- `motion(k, k+1)` returns `(u, v)` in m/s **and** `gapSeconds` actually used (R1), **and** the correlation peak value (R3), **and** `lowInformation` (§A.7), **and** the one-frame-ahead residual as a percentage of frame peak (R4). Not a bare vector — every one of those four is a gate or a report in §5, and a vector-only return makes them unimplementable above the interface.
- `at(t)` must **refuse** `t` later than the newest observed frame (R5, board decision), as an error and not a clamp.
- `at(t)` must accept **any** gridded field, not only the forcing field (R9, §A.6).
- The resampler is **cubic Catmull–Rom clamped at zero** (§5.2). If it is a parameter at all, bilinear must be reachable only from the T2 control path, because its only purpose is to be the control that the cubic is scored against.
- Motion must be estimated over the **±75 km halo** (R2), which means the fetch footprint is larger than the model domain — an ingestion consequence, not just an algorithm one.
- T1, the integer-shift sign assertion, is a merge gate (§5.4). It catches the bug that made my own first implementation worse than doing nothing while every aggregate metric merely looked disappointing.

### `displayProduct` — three legal values is right

Three values, assigned per case in §A.1, with two additions: the chosen value must appear in the exported figure's provenance string, because the legend **wording** now differs between the values (§A.3 — lowest-elevation versus column-maximum), and `none` must be a value the renderer honours by drawing no radar layer at all rather than drawing an empty one with a legend.

## A.10 The `RadarProduct` registry, filled in

SPA-94's registry fields: id, pass, rate-vs-accumulation, units, accumulation window, no-data sentinels, data tier, legend wording, QPE caveats. One row per product, for the products Phase 1 needs. `era` is a field I am adding, because the version-aware product map keyed on 2020-10-14 (§2.3) has to live somewhere and the registry is where it belongs.

**Tiers.** `forcing` — may drive the solver. `normaliser` — may scale the forcing, never drive it. `bias_denominator` — fetched on every radar run, never applied. `diagnostic` — recorded, never forces, never scales. `display` — may be drawn, may not be the source of any quoted number. `prohibited` — must not be fetched for a Phase 1 run.

---

**`mrms_precip_rate`** · `PrecipRate_00.00`
- era: all (2014-11-01 →) · pass: n/a · **rate**, mm/h · window: instantaneous, published every 2 min · tier: **`forcing`**
- sentinels: `-3` = no radar coverage. With R = −30.0, E = 0, D = 1, 16-bit the **floor is −3.0 mm/h** (R/10^D, not R), so `-999` **cannot be encoded at all** for this product and a decoder testing for it is testing for something impossible. `SeamlessHSR` is the opposite case: R = −9990.0, D = 1, floor −999.0. **Sentinel lists are per-product** (§2.4 traps 1–2). **Any** negative value inside the domain flags the run (§2.4, §A.5)
- legend: *"MRMS PrecipRate — radar-only precipitation rate, mm/h, valid HH:MM:SS UTC"*
- caveats: radar-only, no gauge constraint. Pre-v12 caps — stratiform 48.6, convective **103.8**, hail **53.8** mm/h; the tropical relation reaches at least 152.3 mm/h (measured). v12+ — R(A) 200, R(K_DP) 150 mm/h. The cap-clamped pixel-frame fraction (G3) must accompany any peak-intensity claim

**`mrms_radaronly_qpe_01h`** · `RadarOnly_QPE_01H`
- era: all · pass: n/a · **accumulation**, mm · window: 1 h, explicit start and end UTC · tier: **`bias_denominator`**
- sentinels: as above
- legend: *"MRMS RadarOnly_QPE_01H — radar-only hourly accumulation, mm"*
- caveats: the gauge-independent arm of §6. Fetched on every radar-forced run; **never** the forcing (measured **−33.4 %** on peak catchment intensity for the real 2016 storm, −38.9 % for Harvey, §4.1 — the −83.9 % originally quoted here came from a synthetic cell and is withdrawn in revision 2) and never the normaliser. The file stamped `T` is the accumulation for `[T−1h, T)` — see §2.4 trap 4; a decoder that reads it as `[T, T+1h)` mis-times every hyetograph

**`mrms_gaugecorr_qpe_01h`** · `GaugeCorr_QPE_01H`
- era: **pre-v12 only**, < 2020-10-14 · pass: n/a · **accumulation**, mm · window: 1 h · tier: **`normaliser`**
- legend: *"MRMS GaugeCorr_QPE_01H — gauge-merged hourly accumulation, mm"* — and may **not** carry the word "gauge-corrected" without the measured gauge-influence statement (G4). Over the Tiber catchment the honest label is *"measured gauge influence over this catchment: none; ratio to radar-only 0.992"*
- caveats: "gauge-merged" is not "gauge-quality". Measured ratio to radar-only over the catchment: 0.992 / 1.008 / 0.827 / 0.798 / 1.240 across the case set — up to 40 %, in both directions, sign not predictable from storm type. Where the ratio is ≈1 the product is radar-only in all but name and inherits the same rate caps, which is why renormalisation cannot repair case 1b

**`mrms_multisensor_qpe_01h_pass2`** · `MultiSensor_QPE_01H_Pass2`
- era: **v12+ only**, ≥ 2020-10-14 · **pass: 2** · **accumulation**, mm · window: 1 h · tier: **`normaliser`**
- legend: as above with the pass named explicitly
- caveats: as above. Over Center City during Ida the ratio to radar-only is **0.599** — which normaliser forces the run is a pre-registration decision against independent gauges (case 5's blocker), not an implementation default

**`mrms_multisensor_qpe_01h_pass1`** · `MultiSensor_QPE_01H_Pass1`
- era: v12+ · **pass: 1** · accumulation, mm · 1 h · tier: **`normaliser`, fallback only**
- caveats: legal only as a recorded per-hour fallback where Pass 2 is missing (§2.1 step 6). **Never** a hindcast normaliser in its own right. Latency is irrelevant to a hindcast, which is the only thing Pass 1 buys

**`mrms_precip_flag`** · `PrecipFlag_00.00`
- era: all, **but not archived on every date** — absent 2014-11-01 and 2015-10-03 · categorical, no units · 2 min · tier: **`diagnostic`**
- sentinels: `-3` = no coverage
- legend: may name the dominant class; may **not** be rendered as rainfall or coloured on a rainfall ramp
- caveats: gate G3. Which of the six Z–R relations applied per pixel — the field that separates case 1a from case 1b (78 % tropical versus convective-and-hail) and the reason that distinction is checkable before pre-registration

**`mrms_radar_quality_index`** · `RadarQualityIndex_00.00`
- era: archived from 2017; **absent for 2016** · dimensionless 0–1 · 2 min · tier: **`diagnostic`**
- caveats: gate G5. `RQI = RQI_blk × RQI_hgt`. Not retrievable for cases 1a and 6, whose coverage statements therefore rest on computed geometry plus a modern-date RQI sample over the same catchment — which the pre-registration must say in place

**`mrms_merged_reflectivity_qc_composite`** · `MergedReflectivityQCComposite_00.50`
- era: **in the archive from 2020-10-14 only** · dBZ · instantaneous, ~2 min, **valid times ~40 s past the even minute, spacing 122–159 s** (SPA-94) · tier: **`display`**
- legend: *"MRMS MergedReflectivityQCComposite — column-maximum quality-controlled radar reflectivity, dBZ, valid HH:MM:SS UTC"* **+ "observation — display only; not the model forcing"**
- caveats: case 5 only. §8.1 applies in full — no rainfall units, no dBZ→mm/h conversion on screen, not the source of any quoted number. Not co-timed with `PrecipRate` (§A.6)

**`mrms_seamless_hsr`** · `SeamlessHSR_00.00` — **the pre-2020 display layer; added in revision 2**
- era: **all** (48/48 probed frames present on every pre-2020 case date; every even minute, 10/10 consecutive) · dBZ · 2 min, GRIB2 section-1 valid time · tier: **`display`**
- encoding: native NCEP GRIB2, grid template 0, data template 5.41, **R = −9990.0, E = 0, D = 1, 16-bit** → step **0.1 dBZ**, floor **−999.0** (which *is* this product's no-data value, unlike `PrecipRate` — §2.4 trap 2), no practical ceiling. ~1.0–1.4 MB per frame
- legend: *"MRMS SeamlessHSR — seamless hybrid-scan radar reflectivity, dBZ, valid HH:MM:SS UTC"* **+ "observation — display only; not the model forcing"**
- caveats: cases 1a, 1b, 4, 6. **Hybrid-scan, not column-maximum** — the contributing beam elevation varies with range and blockage, so §8.1's "column-maximum" wording is invalid here and the legend may not imply a constant sampling height. Where `SeamlessHSRHeight` is archived (v12) the legend may state the height; where it is not, it says the height varies. **This is measurably the reflectivity `PrecipRate` is derived from** — through the published per-class Z–R it reproduces `PrecipRate` to 5 % on tropical-flagged pixels — which means it will visibly disagree with the forcing layer exactly where a rate cap binds, and §8.3's cap sentence is what answers that. Main document §8.1.1
- capacity note: a full replay day is 720 × ~1.2 MB ≈ **860 MB**. Fetch the event window, not the day

**`iem_mrms_lcref`** · IEM raster `lcref_YYYYMMDDHHMM.png` — **superseded by `mrms_seamless_hsr`; fallback only**
- era: all (720/720 on every case date, and on 2014-11-01) · dBZ · 2 min, filename on even minutes · tier: **`display`** (fallback)
- encoding: 8-bit palette index; index 0 = −32 dBZ, **0.5 dBZ per index**, index 254 = +95 dBZ, index 255 = Missing. Grid identical to the GRIB2 grid (0.01°, origin −130.0 / 55.0). **Read the index, never the rendered RGB** (141 distinct colours over 169 visible indices)
- legend: *"MRMS lowest-elevation composite reflectivity, dBZ, ≈HH:MM UTC — source: Iowa Environmental Mesonet raster"* **+ "observation — display only; not the model forcing"**
- caveats: **use `mrms_seamless_hsr` above instead; this entry survives only as a fallback if a `SeamlessHSR` route proves unavailable.** Its low-end black palette is a real hazard for a replay figure. Otherwise: **lowest-elevation**, not column-maximum — §8.1's "column-maximum" wording is invalid here. **Indices 0–85 render as pure black, so everything at or below +10.5 dBZ is invisible** and absence of colour is not absence of echo. Valid time is a processing slot good to ±60 s, not a GRIB2 section-1 time. No companion quality field, so no RQI or `PrecipFlag` statement may be attached. Frame counts differ from the rate product on gap days, so never pair by index (§A.6)

**`iem_mrms_a2m`** · IEM raster `a2m_YYYYMMDDHHMM.png`
- era: all · mm per 2 min · tier: **`prohibited`**
- encoding: index 0 = 0 mm, 0.02 mm per index (**0.6 mm/h**), index 254 = 5.08 mm (**152.4 mm/h ceiling**), index 255 = Missing
- caveats: **must not be fetched for a Phase 1 run.** The measured case-1a catchment peak of 152.3 mm/h is 99.93 % of the ceiling — one index step below truncation — and index 255 means Missing, so truncation would be indistinguishable from a cap. The quantum is 6× the GRIB2's. As a display rate layer it is a strictly worse copy of a field already fetched. §A.4

## A.11 Harvey rate-cap census (gate G3) — it finished, and it passes

This was the census left fetching when this addendum was first pushed. It completed: **121/121 frames**, 27 August 2017 09:00Z–13:00Z, over the 150 km² Brays Bayou box. Full detail in main document [§7.4](SPA-93_radar_coverage_and_qpe_assessment.md#74-case-4--meyerland--brays-bayou-houston--harvey-2017); the result in brief:

| | |
|---|---|
| Peak box-mean rate | **130.7 mm/h** |
| Peak pixel rate | **189.4 mm/h**; p99 173.7, p99.9 182.7 |
| Accumulation from the 2-min rates | box mean 165.7 mm, wettest pixel 226.6 mm |
| Rate-cap saturation | **none.** Most repeated value above 40 mm/h is 171.7 mm/h at **0.355 %** of 14,097 wet pixel-frames — a diffuse top, no plateau |
| `PrecipFlag` | **59.1 % tropical convective, 30.0 % tropical stratiform**, 7.7 % warm stratiform, 0.06 % convective, **0 % hail** |

**The field runs 82 % above the 103.8 mm/h convective ceiling that clamps case 1b, with no clamping at any value.** The mechanism is the classification: 89 % tropical, 0.06 % convective, no hail. So gate G3 passes for case 4, the verdict is now measured on the dimension §7.4 previously argued, and main document §10 item 6 closes for this case.

This also makes the cap argument a three-case comparison rather than a two-case one: tropical → uncapped (Harvey 189.4, Ellicott City 2016 152.3); convective and hail → hard clamp (Ellicott City 2018, pinned at exactly 103.8 and 53.8).

## A.12 Scripts added by this addendum

```
research/radar_qpe/
  frame_identity_probe.py   repeated window max vs repeated frame        -> out/measured_frame_identity.json
  update_census.py          fraction of wet pixels changed per pair      -> out/measured_update_census.json
  iem_raster_probe.py       IEM raster headers, palettes, colour ramps   -> out/measured_iem_raster.json
  iem_lut_probe.py          IEM documented index -> value lookups        -> out/measured_iem_lut.json
  iem_lcref_census.py       lcref/a2m file counts per case date          -> out/measured_lcref_census.json
  nodata_probe.py           no-coverage sentinel on both routes          -> out/measured_nodata.json
```

```
OUTDIR=out python iem_raster_probe.py
OUTDIR=out python iem_lut_probe.py
OUTDIR=out python iem_lcref_census.py
OUTDIR=out MRMS_CACHE=... python nodata_probe.py
OUTDIR=out MRMS_CACHE=... python frame_identity_probe.py
OUTDIR=out MRMS_CACHE=... python update_census.py ec2016 ec2018 ida
```

Python 3 with numpy; no credentials, no paid service, nothing under `src/`.

Revision 2 adds five more — `fetch_budget.py`, `seamless_hsr_probe.py`, `hsr_zr_consistency.py`, `hour_label_test.py` and `review_followups.py` — listed with their outputs and invocations in main document §11, and the per-host transfer cap they all now respect in §11.1. Run them with `python -P` so the interpreter does not put the working directory on `sys.path`; downloaded archive files are cached in `$MRMS_CACHE`, which is deliberately not the directory the scripts live in.

## A.13 What this addendum does not change

The six verdicts stand: 1a conditional go, **1b no-go as a solver validation**, 2 no-go on radar and force from the supplied gauges, 3 confirmed no-op, 4 go, 5 go with the normaliser blocker, 6 Norfolk/Matthew recommended. Nothing in the ingestion findings touches the rate-cap argument that decides case 1, the gauge-influence argument that decides how any of them is labelled, or the §4 cadence result that is the largest number in the assessment.

The §9 gates stand, with **G2b** added (§A.5). No Phase 1 case should be pre-registered until the gates have been run on that case.

> **Revision 2 note.** The verdicts still stand after the review of revision 1, but two of this addendum's own conclusions do not: §A.3's recommendation of `mrms_lcref` is superseded by `SeamlessHSR` (main document §8.1.1), and §A.7's duplicate-frame finding is extended by the completed update census (main document §5.5.1), which puts the Ellicott City 2016 weak-update fraction at 32.5 % and the effective new-observation interval at 2.96 min. The §4 cadence result referred to above also moved: the honest peak-attenuation figure is **−33.4 %** on real data, not the −83.9 % from a synthetic cell (main document §4.1). Gates **G10** and **G11** are added. See main document §12 for the full index.
