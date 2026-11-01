# Phase 3a: NOAA Atlas 15 ingestion, Bulletin 17C, and the design-storm method

Status: **specification only — no code in this change.** Every `file:line` reference below was read against `main` at
`2fa1b85`. `main` has since taken one commit (`c178700`, adding a LICENSE and a `package.json` license field) which
touches no hydrology file, so the references hold.

Scope: design-storm hydrology and gauged-river flood frequency. Out of scope and deliberately untouched here:
spatial radar rainfall (Phase 3e), the per-jurisdiction criteria matrix (SPA-95), and solver numerics.

Nothing in this document is a certified, sealed or PE-reviewed output, and nothing here authorises calling a
FloodSim result one. It is preparation for the licensed engineer who reviews and signs.

---

## 0. Three findings that change this ticket

The ticket asked me to confirm Atlas 15's status because better information changes the internal ordering. It does —
and two other things surfaced that change it more.

**1. Atlas 15 is roughly a year later than the ticket assumes.** The ticket's understanding was "publication expected
2026–2027 and non-CONUS in 2027". NOAA's own schedule page says CONUS *published* estimates are available for use
**no earlier than September 2027**, and non-CONUS **no earlier than September 2028**. As of today (1 November 2026)
there is no public CONUS Atlas 15 dataset; the only public Atlas 15 data is still the Montana pilot from September
2024. Details and sources in §1.

Consequence: Atlas 15 ingestion cannot be built against real national data in this work cycle, and an Atlas 15 number
cannot go into a submittal before late 2027 at the very earliest — later in practice, because publication by NOAA does
not itself change any jurisdiction's criteria. The *interface* work is still worth doing early; the *ingestion* work
has nothing to ingest.

**2. The USGS endpoints the gauged-flow path depends on are being switched off in early 2027, with degradation
starting this month.** All three endpoints in `src/inflow.js` are on the decommission list:

| `src/inflow.js` | Legacy endpoint | Dies | Replacement (verified live) |
|---|---|---|---|
| `findGauges()` :21 | `waterservices.usgs.gov/nwis/site` | WaterServices: **22 February 2027** | `api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations` |
| `gaugeFlows()` :32 | `waterservices.usgs.gov/nwis/iv` | WaterServices: **22 February 2027** | `.../collections/continuous` |
| `annualPeaks()` :40 | `nwis.waterdata.usgs.gov/nwis/peak` | NWISWeb: **by March 2027** | `.../collections/peaks` |

Two precision notes on that table, because the dates are doing work. The 22 February 2027 date is USGS's announced
WaterServices decommission date and covers the first two rows directly. The peak file is served from NWISWeb
(`nwis.waterdata.usgs.gov`), which USGS is retiring on a parallel track — reported as decommissioned by March 2027,
with the final migration campaign running November 2026 to February 2027. I did not find a single primary page giving
one date for both, so treat the peak endpoint as dying in the same window rather than on a date certain. The
replacement path is given above as `v0`, which is the version I queried successfully on 1 November 2026; a `v1` path
is referenced in third-party migration notes. **Confirm the version path at implementation time.**

This is not an aside. `annualPeaks()` is the exact function Bulletin 17C work has to rewrite, and the replacement
`peaks` collection has a *different and better* schema for 17C purposes (§5.2) — it carries the historic-peak
"peak since" field that EMA perception thresholds need. So the 17C work and the migration are the same work, and the
migration has a hard external deadline inside the ticket's horizon. Doing 17C first means writing that fetch once
instead of twice.

I have not treated the migration as licence to do it — it is adjacent work this ticket does not name. §9 asks for a
decision on whether it folds into the 17C ticket or gets its own.

**3. Areal reduction factors have almost no purchase on FloodSim as it is built.** `MAX_FINE` at `app/map.js:56` caps
a model at 3000 × 3000 m of 1 m cells — 9 km², or 3.5 mi². Published fixed-area ARFs at that size are about 0.95–0.99
depending on duration, so the correction is at most a few per cent of the design depth at the largest model FloodSim
will build, and ~1.00 at the typical site. The one place large catchments do appear — the upstream basins behind
`src/inflow.js` — is driven by *gauged peak flows*, not a design storm, so an ARF does not apply there either.

Consequence: item E is real engineering practice but it is the lowest-value item in this ticket for this codebase, and
it is the one item that makes the design storm *smaller*. §7 specifies it as asked and recommends it go last.

---

## 1. Atlas 15: what is actually available, as of 1 November 2026

### 1.1 Schedule

From NOAA's Atlas 15 information page (`water.noaa.gov/about/atlas15`), quoted:

| Area | Preliminary (peer review) | Published (available for use) |
|---|---|---|
| Montana pilot | Released **26 September 2024**; public review period **closed** | n/a — pilot, not for design |
| CONUS (lower 48) | "No earlier than September 2026" | "**No earlier than September 2027**" |
| Alaska, Hawaii, territories | "No earlier than September 2027" | "**No earlier than September 2028**" |

Atlas 14 remains the current authoritative standard. NOAA's HDSC FAQ still describes Atlas 14 as the de-facto national
standard endorsed by the Federal Advisory Committee on Water Information, with Volume 12 (Montana, Idaho, Wyoming,
2024) the most recent volume. Atlas 15 supersedes Atlas 14 **on publication**, not before.

### 1.2 Is preliminary CONUS data available right now?

**No public CONUS dataset that I can find.** What I can state with confidence, and the limits of it:

- The controlling NOAA page reads as a forward-looking schedule ("no earlier than September 2026") and links no CONUS
  data. Its only data links are the Atlas 14 PFDS and the (closed) Montana pilot.
- A document `noaa_atlas15_peer_review_questions_conus.pdf` exists on `weather.gov`, titled "**[DRAFT] Peer Review
  Plan: Preliminary NA15 Estimates (CONUS)**". A draft peer-review *plan* is consistent with the CONUS review being
  imminent or newly opened; it is not evidence that estimates are published.
- Secondary sources are stale and inconsistent with each other. Several still repeat the older "published for CONUS in
  2026, rest of country 2027" line, which traces to NOAA's October 2024 news release and is superseded by the
  schedule page above. One industry summary dated September 2026 states the CONUS draft goes out "for public comment
  in September, 2026" with "a final product anticipated to be provided in 2027".

So: **the earliest date on which an Atlas 15 number could legitimately appear in a FloodSim submittal is late 2027,**
and the honest status line for the product today is "Atlas 15 not yet published; Atlas 14 is the standard."

What would change this answer: a CONUS data or viewer link appearing on `water.noaa.gov/about/atlas15`, or the
peer-review plan losing its `[DRAFT]` marking with an announced review window. **Re-check that page before the
implementation ticket for item A is scheduled** — this is the one input in this spec with a short shelf life.

### 1.3 What Atlas 15 is, from the pilot

The pilot is the only concrete Atlas 15 artefact and is therefore the only honest basis for an ingestion design.

- **Two volumes.** Volume 1 is current-condition precipitation frequency that accounts for *trends in the historical
  observations* — nonstationary GEV with a warming covariate, rather than Atlas 14's stationary fit. Volume 2 is
  model-based estimates projected to 2100, produced as adjustment factors applied to Volume 1.
- **Volume 2 has two query modes.** A scenario mode (SSP2-4.5 and SSP5-8.5) and a **global-warming-level index mode**
  (2.5 °C and 3.0 °C above a late-19th-century baseline). The warming-level mode is the more useful of the two for our
  users: it lets a planner ask "what does this look like at 3 °C" without the report having to commit to an emissions
  scenario and a date.
- **Pilot coverage: durations 1 hour to 10 days, AEPs 50% to 1%.** Note both ends. There is **no sub-hourly duration**
  and **nothing rarer than 1% AEP** in the pilot. §3.3 explains why both matter a lot to FloodSim.
- Estimates carry 10% and 90% confidence bounds; the pilot's Montana results showed increases of 4–6% at 2.5 °C and
  6–9% at 3.0 °C for the 24-hour 1% AEP depth at seven test locations.
- Documentation: NOAA Atlas 15 Pilot Technical Report, version 1.1.p, 25 March 2025.
- Pilot viewer: `water.noaa.gov/precip-frequency/atlas15/pilot` (I got a 404 on a direct fetch; it is referenced from
  the information page and from third-party write-ups). AMS-based raster products for Atlas 15 are reported to be in
  **Zarr** format.

**I could not confirm the national release's access route, point-query API, duration set, or AEP set, because NOAA has
not published them.** That is a fact about the world, not a gap in the research, and §3 is written so that the work
which depends on it is isolated from the work which does not.

---

## 2. What FloodSim implements today

The hydrology path, so each item below can name what it changes.

**The DDF table.** `fetchAtlas14(lon, lat, fetcher)` (`src/storm.js:34`) hits the PFDS CGI endpoint for metric
partial-duration-series *depths* and `parsePFDS()` (:16) scrapes the JavaScript-ish response into:

```
pf = { median, upper, lower,   // [duration][ari] tables, mm; upper/lower are the 90% bounds
       lat, lon, region, volume, version, series, units }
```

indexed by the module constants `A14_DURATIONS` (19 rows, **5 min to 60 days**) and `A14_ARI` (10 columns,
**1 to 1000 yr, partial-duration**) at `src/storm.js:12-13`.

**Four consumers of `pf`.**

1. `hyetograph()` (`src/storm.js:71`) — the design storm. Alternating block, with a genuinely good property: block
   increments are taken from the DDF curve and placed in duration order outward from the peak, so **every contiguous
   window of *k* blocks around the peak holds exactly the Atlas 14 depth for *k*·Δt**. The storm is DDF-consistent at
   every sub-duration, not just at the total.
2. `ddf()` (`src/storm.js:48`) in `src/drainage.js:212` — rational-method intensity at each pipe's time of
   concentration, for the synthesised storm-sewer network (`designARI: 10` default, `src/drainage.js:27`).
3. `returnPeriod()` (`src/history.js:218`, importing `A14_ARI`/`A14_DURATIONS`) — ranks an observed historic storm
   against the site table.
4. `recordStorm()` / `fitGEV()` (`src/storm.js:109-141`) — the fallback where Atlas 14 has no estimates (western
   Washington and Oregon): GEV by L-moments on the site's own annual maxima, shaped by its wettest recorded 24 hours.
   `pdsToAms()` (:123) is the Langbein PDS↔AMS converter; it already exists and item A needs it.

**The climate path today** is a single unvalidated number: `app/map.html:441` is a 0–50% slider labelled "Climate
uplift on depths", read at `app/map.js:690,692` and passed to `hyetograph({ factor })`, which multiplies every depth.
No source, no validation, no provenance beyond the percentage itself. The ticket is right that this is not defensible
in a submittal.

**Provenance choke points — where a source label has to appear.** These are the two functions to change, and they are
the reason "labelled on every output" is cheap:

- `stormLabel(st)` (`app/map.js:694`) — the human string. Feeds the Storm drawer line, the hyetograph's `aria-label`
  (:868) and each saved run's label (:1419).
- `stormMeta(st)` (`app/map.js:705`) — the machine record. Feeds the run record (:1367), `summary.json` (:1976) and
  the report data block (:2493). Already emits `source: 'NOAA Atlas 14 (PFDS, partial-duration series)'` plus
  `volume`, `version`, `region`, `siteLonLat`, `ari`, `estimate`, `climateFactor`.

**The gauged-river path.** `annualPeaks(site, fetcher)` (`src/inflow.js:39`) pulls the NWIS RDB peak file and keeps
only `{ year, q }`, dropping every qualification code and every row without a numeric `peak_va`. `lp3(peaks, T)` (:59)
fits log-Pearson III by method of moments on log₁₀ flows with **station skew only** and the Wilson–Hilferty frequency
factor, requiring n ≥ 10. The module header (:5-6) is already honest that this is Bulletin 17B and that "17C's EMA
adds regional skew and low-outlier tests, so treat these as planning numbers". Called from `app/map.js:2254`, shaped
by `designHydrograph()` into an NRCS gamma unit hydrograph.

---

## 3. Item A — Atlas 15 ingestion behind the same interface, both sources side by side

### 3.1 What it changes

The one thing worth building *now*, before Atlas 15 data exists, is the **interface**: make the precipitation-frequency
source an explicit, tagged, self-describing object instead of an implicit Atlas 14 table that four call sites index by
module-level constants. Every item in this ticket depends on that, and it is testable today against Atlas 14 alone.

The part that must wait is the Atlas 15 *fetcher*, because NOAA has published no national access route (§1.2).

### 3.2 The interface

Replace the bare `pf` object and the exported `A14_DURATIONS` / `A14_ARI` constants with a source contract. `ddf()`
stays the single accessor — it already is the interface; it just needs to stop assuming whose table it holds.

```js
// src/storm.js
/**
 * A precipitation-frequency source. `ddf()` is the only way the rest of FloodSim reads one.
 *   standard   'atlas14' | 'atlas15'
 *   volumeTag  'v1' | 'v2' for Atlas 15; null for Atlas 14
 *   series     'pds' | 'ams'  — Atlas 14 PFDS is 'pds'; Atlas 15 is 'ams'
 *   frequency  'ari' (years, partial-duration) | 'aep' (annual exceedance probability)
 *   durations  minutes, ascending
 *   levels     the native frequency axis: ARIs in years, or AEPs as fractions
 *   median/upper/lower  [duration][level] depth tables, mm
 *   label      a short human string for stormLabel()
 *   cite       { volume, version, region, lat, lon, retrieved, ... } for stormMeta()
 */
```

Three rules make the two standards substitutable:

1. **`ddf(src, ari, tMin, which)` keeps its signature and keeps taking an ARI in years**, because that is the unit the
   UI, the drainage design storm and every jurisdiction's criteria are written in. Internally it converts the
   requested ARI to the source's native frequency axis: identity for Atlas 14 (`series: 'pds'`, `frequency: 'ari'`),
   and for an AMS/AEP source `aep = 1 / pdsToAms(ari)`. `pdsToAms()` already exists at `src/storm.js:123`.
   This conversion is **not** cosmetic: 50% AEP is the 2-year annual-maximum event, which is about the 1.44-year
   partial-duration event. Getting it wrong silently biases every frequent-storm result, which is exactly the range
   water-quality and channel-protection detention criteria live in.
2. **Out-of-range is an error, never an extrapolation.** `ddf()` already throws outside 1–1000 yr. It must now throw
   against `src.durations` and `src.levels` rather than module constants, with the standard named in the message.
3. **The source is carried on the storm object**, not looked up from a module global. `hyetograph()` already returns
   its inputs on the result; add the source's `cite` block so `stormMeta()` reads it off the storm instead of off
   `model.atlas14` (`app/map.js:712`).

Fetchers become `fetchAtlas14(lon, lat, fetcher)` (rewrap the existing parse; no behaviour change) and
`fetchAtlas15(lon, lat, fetcher, { volume })` — **stubbed, throwing "NOAA Atlas 15 is not published for this location
yet", until NOAA publishes an access route.** Writing the stub is the point: it fixes the seam, and it makes the
"no Atlas 15 here" path the one that is exercised and tested from day one, which is the path that will be live for
every user for at least the next year.

**Side by side.** A source selector in the Storm drawer alongside the existing `a14Btn` / `hist` / `const` buttons
(`app/map.html:422`), listing only sources that resolved at the site. When both resolve, both are fetched on build
(`app/map.js:558-575` already does this concurrently for Atlas 14) and either can drive a run; the selected one is
named on the run.

### 3.3 Two mismatches the implementation must not paper over

**Sub-hourly durations.** FloodSim's table starts at 5 minutes and `src/drainage.js:212` evaluates intensity at each
pipe's time of concentration — minutes, for small urban catchments. The Atlas 15 pilot starts at **1 hour**. If the
national release keeps that floor, an Atlas 15-only site **cannot size a storm sewer** and cannot build a 5-minute
hyetograph block. The interface must therefore let a run draw sub-hourly depths from Atlas 14 while drawing longer
durations from Atlas 15 — and if it does, **that mixture must be named in `stormMeta()`**, because a reviewer who
sees "Atlas 15" on a pipe-sizing table is entitled to know the sub-hourly intensities did not come from it. Do not
interpolate Atlas 15 below its published floor.

**Rarity.** The pilot stops at 1% AEP. FloodSim's table goes to 1000 yr and the emulator sweeps return period
continuously (`app/emulator-ui.js:92`). A 500-yr request against an Atlas 15 source that stops at 1% must throw, not
extrapolate.

### 3.4 Files

`src/storm.js` (the contract, `ddf()`, both fetchers), `src/history.js:218-226` (stop importing the module constants;
read `src.durations`/`src.levels`), `src/drainage.js:212` (pass the source through), `app/map.js:558-592` (fetch and
select), `:682-732` (`stormBase`, `stormLabel`, `stormMeta`, `updateStorm`), `app/map.html:422,456` (selector),
`server/server.mjs:26` (allow-list the Atlas 15 host when it is known).

### 3.5 Acceptance test — `tests/run-storm-tests.mjs`, `npm run test:storm`

1. **Atlas 14 refactor is a no-op.** For a vendored PFDS fixture, `ddf()` through the new contract reproduces the
   current `ddf()` to within floating-point equality at every table duration × every table ARI. This is the test that
   makes the refactor safe; it must be written before the refactor.
2. **Nested-depth property survives.** For the fixture, every contiguous *k*-block window of a `hyetograph()` result
   around the peak equals `ddf(src, ari, k·Δt)` to 1e-9 — the property `src/storm.js:6-7` claims. Assert it now, so
   items A and D cannot quietly break it.
3. **PDS↔AMS conversion is exercised with a known value.** A synthetic AMS/AEP source whose table is constructed so
   the answer is analytic: request 100-yr, assert the 1% AEP column is read; request 2-yr, assert the conversion
   lands between the 50% and 20% AEP columns and *not* on 50%. A test that only checks the 100-yr case will pass with
   the conversion deleted.
4. **Range violations throw, naming the standard.** 500-yr against a source topping out at 1% AEP; 5-minute against a
   source whose floor is 1 hour. Assert the error text names Atlas 15 and the limit.
5. **Labelling is total.** Enumerate every source/pattern combination; assert `stormMeta().source` is non-empty and
   contains the standard name, and that `stormLabel()` does too. This is the test that keeps the label from being
   dropped by a later edit.
6. **Mixed-source runs are self-describing.** A run that draws sub-hourly from Atlas 14 and 24-hour from Atlas 15
   produces a `stormMeta()` naming both, with the duration split.

### 3.6 What a reviewer would ask

- *Which atlas, which volume, which version, retrieved when, at what coordinates?* — `cite` must carry all five.
  Atlas 14 answers this today via `volume`/`version`; Atlas 15 is versioned and will be revised, so `retrieved` is
  not optional.
- *Partial-duration or annual-maximum series?* — the single most common reason two engineers get different depths at
  the same site. Must be on the face of the output, not inferred.
- *Is this the published Atlas 15 or the preliminary peer-review release?* — these are different numbers and only one
  is usable. If FloodSim ever ingests a preliminary release it must refuse to label it as anything but preliminary,
  and the report module should treat it the way it treats the depth multiplier: a flagged non-standard input.
- *Has my jurisdiction adopted Atlas 15?* — FloodSim cannot answer this and should not imply it can. The honest
  output names the atlas and leaves adoption to the criteria matrix (SPA-95).

---

## 4. Item B — Volume 2 future conditions replaces the depth multiplier

### 4.1 Recommendation: retain the multiplier as a labelled override; demote it, do not delete it

The ticket asks whether the multiplier is deprecated, retained as a labelled override, or removed. **Retained as a
labelled override, and demoted from being the climate path.** Reasons, in order of weight:

1. Atlas 15 Volume 2 will not exist outside CONUS until 2028 at the earliest, and will not exist anywhere in published
   form until late 2027. Removing the multiplier now removes the only future-conditions capability the product has,
   for at least a year, and replaces it with nothing.
2. Some jurisdictions *mandate* a specific uplift. An engineer told to apply +20% by local criteria needs to apply
   +20%, and must be able to show that number came from the criteria and not from a model. That is a legitimate use
   and it is an override, not an estimate.
3. Atlas 14-only and site-record sites (`recordStorm()`, western Washington and Oregon) have no Volume 2 path at all.

What changes is its *status*, and that is mostly a labelling and defaults job:

- Rename it away from "Climate uplift on depths" (`app/map.html:441`), which reads like a sourced climate adjustment.
  It is a user-entered multiplier. Name it that.
- It must appear in `stormMeta()` as an explicitly unsourced override with a required free-text provenance field —
  if an engineer applies +20% they must be able to type "Anytown Code §4.3.2" next to it, and that string must reach
  `summary.json` and the report.
- Default stays 1.0, and when a Volume 2 source is available at the site the multiplier control is secondary to it.
  Applying both at once must be possible (a jurisdiction may require an uplift *on top of* a projected depth) but must
  be loudly labelled, because it is double-counting unless the criteria say otherwise.

### 4.2 The Volume 2 path

Volume 2 is not a separate atlas; it is adjustment factors on Volume 1 (§1.3). So it is a *source variant*, which the
§3.2 contract already expresses: `{ standard: 'atlas15', volumeTag: 'v2', ... }` plus a `projection` block:

```js
projection: {
  mode: 'warming' | 'scenario',
  warmingC: 2.5 | 3.0,                    // mode 'warming'
  scenario: 'ssp245' | 'ssp585',          // mode 'scenario'
  horizon: <year>,                        // mode 'scenario'
  baseline: 'late-19th-century',
}
```

Surface **warming-level mode as the primary control** and scenario mode as the alternative. The warming-level framing
is the one a planner can tie to a design life without the report committing to an emissions trajectory, and it is how
the pilot presents its headline numbers. Carry the 10%/90% bounds through `which: 'upper' | 'lower'`, which `ddf()`
already supports.

Three constraints:

- **Volume 2 depths never silently replace Volume 1 depths.** A run is against Volume 1 or Volume 2, named either way.
- **A Volume 2 run is a planning run, not a design run**, unless the governing criteria say otherwise. The report
  module must say so. This is the single most likely way FloodSim gets misused: a projected depth presented as the
  code-required design storm.
- Volume 2 does not change Volume 1's confidence bounds; do not combine the projection interval with the
  Volume 1 interval into one number.

### 4.3 Files

`app/map.html:441` (relabel, add provenance field), `app/map.js:690,692` (`factor` and its provenance),
`:705-715` (`stormMeta`), `:694-704` (`stormLabel`), `src/storm.js` (`projection` on the source contract;
`hyetograph()` already threads `factor` and needs no numeric change), `src/report.js` (the planning-vs-design
statement).

### 4.4 Acceptance test — extends `tests/run-storm-tests.mjs`

1. **`factor` arithmetic is unchanged** by the relabelling: `hyetograph({ factor: 1.2 })` gives 1.2× every block depth
   and the nested-depth property still holds (every window scales by the same factor).
2. **An override with no provenance string is refused**, or reaches the report flagged as unsourced — assert whichever
   is chosen, and assert `summary.json` carries the string when given.
3. **Volume 1 and Volume 2 are distinguishable in the machine record** for otherwise identical runs: differing
   `volumeTag` and a populated `projection`.
4. **Multiplier and Volume 2 together** produce a `stormMeta()` carrying both and a label saying both applied.
5. **A Volume 2 run is marked as projected** in the report data block.

### 4.5 What a reviewer would ask

- *Where does this number come from?* — the question the current slider cannot answer. The provenance field is the
  whole point.
- *Which scenario or warming level, and to what year?* — must be on the hydrograph and in the table, not in a setting.
- *Is this the design storm my code requires, or a sensitivity study?* — see the constraint above.
- *Why is the projected depth only 6% higher?* — a real question, and the honest answer is that the Montana pilot
  found 4–9% for the 24-hour 1% AEP. Users who expect dramatic numbers from a climate projection will suspect a bug.
  Worth a note in the report text.

---

## 5. Item C — Bulletin 17C (EMA with regional skew) alongside the 17B fit

The only item in this ticket that is fully implementable today, against a published federal standard, with a published
gold-standard test. It is also the item with an external deadline (§0.2).

### 5.1 What 17C changes relative to the 17B fit in `lp3()`

Bulletin 17C (England et al., 2018, USGS Techniques and Methods 4-B5) replaces 17B's method of moments plus a
sequence of adjustments with the **Expected Moments Algorithm**, which takes non-standard, censored and historical
data all at once rather than as successive corrections. Concretely, against `src/inflow.js:59-65`:

| | 17B — `lp3()` today | 17C |
|---|---|---|
| Fit | Method of moments on log₁₀ peaks | EMA; every annual peak is a **flow interval**, not a point |
| Low outliers | none | Multiple Grubbs–Beck test → PILF threshold → censor as `[0, threshold)` |
| Historical peaks | dropped | perception thresholds per water year |
| Skew | station only | station skew weighted with **regional** skew |
| Confidence limits | none | from the EMA variance of the fitted quantiles |

### 5.2 The data route — this is where the work actually is

`annualPeaks()` keeps `{ year, q }` and throws away everything EMA needs. The new `peaks` collection
(`api.waterdata.usgs.gov/ogcapi/v0/collections/peaks`) is live; I queried it directly. Schema, from the live service:

```
monitoring_location_id  "USGS-01589000"
parameter_code          "00060"          ← MUST filter: the collection also carries 00065 (stage)
value                   "7590"           (string, for precision)
unit_of_measure         "ft^3/s"
time                    "1950-09-10"
water_year, year, month, day, time_of_day
peak_since              integer | null   ← the historic-peak "peak since year N" field EMA needs
qualifier               array of names | null
```

Two schema facts the implementation must plan around:

**The single-letter `peak_cd` codes are gone, replaced by a named `qualifier` vocabulary.** Sampling a long record
with historic peaks (USGS-01570500, Susquehanna at Harrisburg) returned these qualifier strings:
`HISTORIC`, `MAXDAILYMEAN`, `NOTMAXGH`, `BACKWATER`, `GHNOTASSCPKQ`. The legacy code table gives the semantics to map
onto — the codes that matter for EMA are:

| Legacy code | Meaning | EMA treatment |
|---|---|---|
| 7 (`HISTORIC`) | discharge is an historic peak | perception threshold over the historic period; use `peak_since` for its span |
| 8 | discharge actually greater than indicated value | right-censored: interval `[value, ∞)` |
| 4 | discharge less than indicated value, which is minimum recordable discharge | left-censored: interval `[0, value]` |
| 1 (`MAXDAILYMEAN`) | discharge is a maximum daily average | low-biased; flag, and treat as a lower bound |
| 2 | discharge is an estimate | keep as a point value; flag in provenance |
| 3, 5, 6 (`REGULATED`) | dam failure / regulation / diversion | **not a homogeneous record** — exclude or require an explicit user decision, do not censor |
| C | record affected by urbanisation, mining, agriculture, channelisation | same: a homogeneity question, surfaced not silently handled |
| A, B | year / month / day of occurrence unknown or not exact | keeps the peak; affects dating only |

**The first implementation step is to enumerate the live `qualifier` vocabulary** rather than trust the five strings I
observed or the legacy table's one-to-one correspondence. I confirmed `REGULATED` on one record and the five above on
another; the full vocabulary is not documented anywhere I could find. Build the map from observation, assert on it,
and **fail loudly on an unrecognised qualifier** rather than defaulting it into the systematic record — a silently
mishandled regulated peak is exactly the error that makes a design flow indefensible.

**Gage height and gage-height codes are absent from the new collection.** The legacy RDB carried `gage_ht` /
`gage_ht_cd`. If stage-based perception thresholds are wanted later, that is a separate data source. For this ticket,
thresholds come from discharge qualifiers and `peak_since` only — say so in the output.

### 5.3 Regional skew — the specification decision, and my recommendation

**There is no national regional-skew dataset to ship.** 17B's Plate I national skew map is superseded, and 17C does
not replace it with another map: it points to published regional studies, which are per-region Bayesian weighted /
generalised least squares (B-WLS/B-GLS) analyses published as USGS Scientific Investigations Reports, indexed from
the USGS StreamStats "Flood Frequency Reports" page. Coverage is uneven and each study has its own applicability
boundary.

Three options, and what I recommend:

| Option | Verdict |
|---|---|
| Digitise 17B Plate I as a national skew grid | **No.** It is superseded; shipping it would put a 1982 number behind a "Bulletin 17C" label, which is worse than having no regional skew. |
| User supplies regional skew + its MSE from the applicable published study, cited | **Yes — the primary path.** This is what PeakFQ requires of its users, so it matches what the reviewing engineer already expects to supply and defend. |
| EMA with station skew only, no regional weighting | **Yes — as the labelled fallback**, and it is still a real improvement over `lp3()`: MGBT low-outlier censoring, interval data, historic peaks and confidence limits all apply without any regional skew. |

So: two 17C modes, both honestly labelled.

- `17C-EMA, regional skew <value>, MSE <value>, source "<citation>"` — the defensible mode. The citation string is
  **required**, not optional, and reaches `summary.json` and the hydrograph label.
- `17C-EMA, station skew only (no regional weighting)` — the default when no regional skew is supplied, carrying that
  phrase verbatim onto every output so nobody mistakes it for a complete 17C analysis.

The weighting itself is 17C's inverse-MSE combination of station and regional skew. Both the formula and the EMA
station-skew MSE must be taken from 17C directly at implementation time; do not reuse 17B's MSE expression, which is
one of the things 17C changes.

### 5.4 Keeping 17B

Keep `lp3()` and keep it reachable. It is the right thing to show next to a 17C result during the transition, it is
the reduction test (§5.5), and some older local criteria still name 17B. Name the method on every hydrograph:
`'Bulletin 17B (LP3, method of moments, station skew)'` or the 17C strings above. That string belongs in the same
place the storm's source goes — on the run record and in the report — and in the hydrograph legend, since a
hydrograph plot is the thing that gets printed and detached from its metadata.

### 5.5 Acceptance test — `tests/run-freq-tests.mjs`, `npm run test:freq`

This item has a published gold standard and the test should use it.

1. **Bulletin 17C worked examples.** 17C's Appendix 10 publishes Examples 3–7 with results computed by PeakFQ v7.1.
   Vendor those input datasets as fixtures under `tests/fixtures/` and assert FloodSim's quantiles match the published
   values. State the tolerance in the test and **report the achieved agreement, including for any example that misses
   it** — a documented 3% disagreement on one example is worth far more than a tolerance widened until everything
   passes. These examples are the reason this item can be defended at all.
2. **Reduction to 17B.** On a record with no PILFs, no censored or historic peaks and no regional skew supplied, EMA
   must reproduce `lp3()` to a stated tolerance. This is the test that catches an EMA implementation that is wrong in
   the ordinary case.
3. **MGBT identifies a planted PILF.** Take a clean record, replace the smallest peaks with values well below the
   population, assert MGBT flags them, assert they are censored as `[0, threshold)`, and assert the 1% quantile moves
   in the direction 17C predicts (low outliers inflate the fitted upper tail when left uncensored).
4. **A historic peak outside the systematic record raises the 1% quantile** when admitted with a perception threshold,
   and the result is insensitive to the threshold's exact value within a plausible band — a sensitivity assertion, not
   just a point assertion.
5. **Regional skew weighting moves the answer the right way and reduces correctly**: with `MSE_regional → ∞` the
   weighted skew → station skew; with `MSE_station → ∞` it → regional skew. Two limits, both cheap, both catch an
   inverted weight.
6. **Qualifier handling is explicit.** A fixture containing `REGULATED` must not silently enter the systematic record;
   an unrecognised qualifier string must throw.
7. **The method name reaches the outputs.** Assert the 17B, 17C-with-regional-skew and 17C-station-skew-only strings
   each appear in the run record and the hydrograph label for the corresponding run.
8. **Live smoke test, behind the existing `--live` convention.** The current `tests/run-inflow-tests.mjs:52-54`
   already pulls real peaks for USGS 01589000 and prints Q10/Q100 against the largest recorded peak. Keep that shape
   against the new endpoint and add the 17C numbers beside the 17B ones.

### 5.6 What a reviewer would ask

- *17B or 17C?* — the first question, and today the output does not say.
- *What regional skew, and from which report?* — the citation is the answer. "Station skew only" is an acceptable
  answer if it is *stated*; it is not acceptable as a silent default behind a "17C" label.
- *What did the low-outlier test remove, and what was the threshold?* — PILF censoring changes the answer materially
  and must be reported: the threshold, the count, and which years.
- *What is in the record — regulated years, estimates, historic peaks?* — needs a per-year disposition table, not a
  count. This is the deliverable that makes the flow defensible, and it is cheap once the qualifiers are parsed.
- *What are the confidence limits on the 1% flow?* — 17C provides them; `lp3()` does not. Report them.
- *How long is the record, and is extrapolating to 1% from it reasonable?* — `lp3()` requires n ≥ 10 and should keep
  a floor; `recordStorm()`'s existing caution (`app/map.js:723`, "return periods beyond ~2× the record length are
  extrapolation") is the right instinct and should apply here too.
- *Is the basin homogeneous over the record?* — FloodSim cannot answer this. It can surface the `C` / urbanisation and
  regulation qualifiers that bear on it, and should.

---

## 6. Item D — Atlas 14/15 temporal distributions and NRCS curves as alternatives to alternating block

### 6.1 What it changes, and an honest statement of what it buys

Start from what the current method already does, because it is better than "alternating block" sounds. The
`hyetograph()` construction (`src/storm.js:78-88`) makes a storm whose every sub-duration window matches the site DDF.
NRCS's own guidance — National Engineering Handbook Part 630 Chapter 4 (210-630-H, Amendment 88, August 2019) —
says the **recommended method for a rainfall distribution is site-by-site, with a unique distribution for each return
period**, built from the ratios of shorter-duration to 24-hour rainfall at that site, tabulated at 0.1-hour (6-minute)
increments. The same chapter concludes outright that the ratios embedded in the legacy NRCS Type I, IA, II and III
distributions "are not consistent with ratios developed from NOAA Atlas 14 rainfall values", and that regional
distributions covering large areas can over- or under-estimate peak discharge relative to a site-specific one.

So FloodSim's existing storm already satisfies the constraint NRCS considers most important, and it is built the way
NRCS says to build one. **What this item adds is a different *arrangement* of the same sub-duration depths, not a
better depth.** That is a real difference — peak flow, time to peak and detention volume all respond to where the
intensity sits in the storm — but it should be specified and sold as what it is: a method-sensitivity capability and a
submittal-conformance capability, not an accuracy improvement.

### 6.2 The three alternatives to add

**(a) Atlas 14 temporal distributions.** Published at `hdsc.nws.noaa.gov/pfds/pfds_temporal.html` for 6-, 12-, 24- and
96-hour durations, as four **precipitation cases** (by which quartile of the duration holds the greatest share of the
total), each given as a family of cumulative curves by decile of cases, in comma-delimited files per Atlas 14 volume
and per temporal-distribution area, with area boundaries as shapefiles (`shapefiles/Vol<N>_Temporals_Shapefiles.zip`;
none for Volume 5, Pacific Islands).

The access consequence matters: **these are not available from the PFDS point query.** Selecting the right curve needs
the temporal-area polygon for the site, so this is a vendored-static-data decision, not a fetch: bundle the CSVs and
area polygons for the volumes we support, versioned, with the Atlas 14 volume and version recorded in `cite`. §9 asks
for a decision on bundling.

**(b) NRCS distributions.** Offer the NRCS regional distributions where they exist — NEH 630 Ch 4 records them for
California, Nevada, the Midwest states, the Southeast states, the Ohio Valley and neighbouring states, and New York
and New England — and the legacy Type I/IA/II/III elsewhere, with ordinates from the WinTR-20 / WinTR-55
documentation. Label a legacy-type storm as legacy and carry NEH 630 Ch 4's own finding about Atlas 14 inconsistency
into the report note. Montana is a documented special case: the state selects its distribution from the ratio of
6-hour to 24-hour depths rather than from a map.

**(c) Keep alternating block as the default.** It is DDF-consistent at every sub-duration, it needs no extra data, it
works at every site including the site-record fallback, and it is defensible on NEH 630 Ch 4's own terms. Changing the
default is not in this ticket.

**Atlas 15 temporal distributions:** the national release is reported to include areal reduction, storm duration and
spatial rainfall pattern products, but nothing is published, so no interface can be specified. The `pattern` selector
should be built as an open list so an Atlas 15 pattern source can be added without another refactor.

### 6.3 Files

`src/storm.js` — `hyetograph()` gains `pattern: 'block' | 'uniform' | 'a14temporal' | 'nrcs'` (the plumbing already
exists: `app/map.js:691` splits `pattern:peak`, and `stormMeta()` records `pattern` and `peakPosition`), plus a
`temporal.js`-style table reader; `tests/fixtures/` for the vendored curves; `app/map.html` (the pattern select);
`app/map.js:694-715` (label and meta must name the distribution, its case/decile and the source volume).

### 6.4 Acceptance test — extends `tests/run-storm-tests.mjs`

1. **Mass balance and monotonicity, every pattern.** Block depths sum to the total DDF depth to 1e-9; the cumulative
   curve is non-decreasing; no negative blocks. Cheap, and it catches most table-reading errors.
2. **Alternating block's nested-depth property is unaffected** by adding the new patterns (re-assert §3.5.2).
3. **A vendored Atlas 14 temporal curve is reproduced exactly** from the bundled CSV for a named volume, area, duration
   and case — a fixture-round-trip test, so a data-file update that changes numbers fails loudly.
4. **Legacy NRCS Type II reproduces published ordinates** at 0.1-hour increments to the published precision.
5. **Method sensitivity is measured, not assumed.** Run one storm total through all available patterns on a fixed small
   model and record peak flow at a control line. Assert only that the spread is reported — and **publish the measured
   spread in the implementation PR**. If alternating block and the Atlas 14 temporal curve agree to 2% on peak flow,
   that is the honest finding and it should be recorded as an argument against prioritising this item further.
6. **The distribution is named on the output**, including case and decile where applicable.

### 6.5 What a reviewer would ask

- *Which temporal distribution, and why this one?* — and for an Atlas 14 temporal curve, *which case and which
  decile?* Those choices move peak flow substantially and a bare "Atlas 14 temporal" does not identify a curve.
- *Does my jurisdiction require a particular distribution?* — many do (commonly NRCS Type II or a state curve). This
  is a criteria-matrix question (SPA-95); FloodSim's job is to offer the required one and name it.
- *Is the storm consistent with the DDF at the durations that matter?* — alternating block answers yes by
  construction; a prescribed regional curve does not necessarily, and the report should say which was used.
- *Where is the peak?* — `peakPosition` is already recorded for block storms; keep that for all patterns.

---

## 7. Item E — Areal reduction factors

### 7.1 Specified as asked, recommended last, with the reason quantified

The method to name is the **fixed-area depth–area reduction curves** of U.S. Weather Bureau Technical Paper 29 (1958)
and TP-40, which are the curves still in general use and the ones HEC-HMS's frequency storm applies. NOAA's HDSC FAQ
confirms both the need and the vacuum: point estimates "cannot be used in many applications that require areal
estimates", TP-29 is "still commonly used", and NOAA's own ARF tool work has been "put on hold for the foreseeable
future". NEH 630 Ch 4 likewise defers areal reduction to "various NOAA documents". So there is no current federal ARF
product; naming TP-29/TP-40 and its vintage is the honest choice, with Atlas 15 noted as the expected successor.

Then the measurement that should decide the priority. `MAX_FINE` (`app/map.js:56`) is 3000 × 3000 one-metre cells:
**9 km², 3.5 mi², at the absolute largest model FloodSim will build in a browser.** My read of the published TP-40
depth–area curves puts the factor at that area at roughly 0.95–0.97 for a 1-hour storm and about 0.99 for 24 hours,
approaching 1.00 at typical site scale: a correction of a few per cent at the maximum, and nothing at the median case.

To be explicit about the standing of those two numbers — they are my reading of the published figure, not a digitised
measurement, and they are the numbers this item's priority rests on. §7.3.4 is the test that establishes them properly.
If digitisation shows the correction is materially larger than this at 9 km², the ordering in §8 should change and the
measurement should be reported as the reason.

And it does not help the one place catchments are large. Upstream basins enter through `src/inflow.js` as **gauged
peak flows** fitted by frequency analysis — not as a design storm over an area — so there is no point depth for an ARF
to reduce. The drainage-area-ratio transfer at `src/inflow.js:158` is the analogous correction on that path and
already exists.

### 7.2 If built

- A single function in `src/storm.js`, `arf(areaKm2, durationMin, { method: 'tp40' })`, returning a factor and its
  provenance, applied as a multiplier on the total depth where `hyetograph()` already applies `factor`.
- **Off by default**, and never defaulted on. This item *reduces* the design storm, which in an off-site
  adverse-impact screening is the direction that favours the applicant. It must be a deliberate, labelled, justified
  choice.
- **Hard-refuse outside the published curves' range** (TP-40's are drawn for roughly 30 minutes to 24 hours and up to
  about 400 mi²) rather than extrapolating. Digitise from the published figure at implementation time and vendor the
  digitised table as a fixture so it can be checked against the source.
- Report the factor, the area, the duration and the method as separate fields — never fold it into the depth.

### 7.3 Acceptance test

1. **Digitised curves match the published figure** at a set of read-off points, to a stated tolerance, with the
   digitisation vendored.
2. **ARF → 1 as area → 0**, monotonically decreasing in area and increasing in duration.
3. **Out-of-range throws** on both area and duration.
4. **Measure and publish the effect at FloodSim's maximum domain.** Compute the factor at 9 km² for 1-, 6- and
   24-hour storms and record the numbers in the implementation PR. If they come out as §7.1 predicts, that is the
   measurement that justifies this item staying at the bottom of the list, and it should be reported either way.
5. **Off by default** — assert a default run's `stormMeta()` has no ARF applied.

### 7.4 What a reviewer would ask

- *Which ARF method, and is it the one my criteria require?* — many jurisdictions prohibit ARF below a threshold area
  or mandate a specific method.
- *Why is the design storm smaller than the point estimate?* — the question this feature exists to answer, and it
  needs the factor, area, duration and method on the face of the output.
- *Is a 1958 depth–area curve appropriate here?* — a fair challenge, with no better federal answer available today.
  Say so rather than implying currency.

---

## 8. Recommended order of work

Ordered by what is buildable, what is defensible, and what has a deadline — not by what the ticket lists first.

**1. Item C, Bulletin 17C, together with the USGS endpoint migration.** First for four independent reasons that point
the same way: it is the only item whose standard is published and whose data exists today; it has a **hard external
deadline of 22 February 2027** with degradation already beginning; the function it has to rewrite is the function the
deadline kills, so doing both at once costs less than doing either alone; and it has a published gold-standard
acceptance test (17C Appendix 10 Examples 3–7 against PeakFQ v7.1), which is a stronger validation basis than anything
else in this ticket. It is also the item that most directly serves the two target workflows: a gauged design flow an
engineer has to defend.

**2. Item A's interface, without the Atlas 15 fetcher.** The source contract (§3.2) is testable today against Atlas 14
alone, the no-op refactor test (§3.5.1) makes it safe, and every later item is cheaper behind it. Items B and D both
need it. Build the seam now; leave `fetchAtlas15()` a throwing stub.

**3. Item B's labelling half.** Renaming the multiplier, requiring a provenance string, and getting it into
`summary.json` and the report costs little and removes a live defensibility problem *now* — the multiplier is in the
product today with no source behind it. The Volume 2 half waits on data with item A's fetcher.

**4. Item A's Atlas 15 fetcher and item B's Volume 2 source — on publication, not before.** Gated on §1.2's re-check.
Nothing to ingest until NOAA publishes, and the preliminary peer-review release is not a design input.

**5. Item D, temporal distributions.** After the interface, and with its own measurement first: run the §6.4.5
sensitivity before building the full feature. FloodSim's current storm already satisfies NRCS's site-specific
consistency criterion, so the case for this item rests on submittal conformance (a jurisdiction requiring a named
curve) rather than accuracy — and that is properly a criteria-matrix question. If the measured spread is small, say so
and let the ordering follow the measurement.

**6. Item E, areal reduction factors.** Last. §7.1 quantifies why: a few per cent at the largest model FloodSim can
build, nothing at typical scale, no applicability to the one path with large catchments, no current federal method,
and the only item here that makes the design storm smaller.

On the programme's standing position that FloodSim already has more physics than its validation record can defend:
items C and A improve the defensibility of numbers the product already produces, which is the opposite of adding
capability. Items D and E add capability. That is a second, independent reason for this ordering, and a reason to hold
items D and E until their measurements (§6.4.5, §7.3.4) justify them.

---

## 9. Decisions I need before the implementation tickets

Flagged rather than assumed. None of these block the specification; each shapes an implementation ticket.

1. **Does the USGS endpoint migration fold into the 17C ticket, or get its own?** It is adjacent work this ticket does
   not name, and the ground rules say to ask rather than improvise. My recommendation is to fold it in, because the
   migration and 17C rewrite the same function and the 17C data requirements determine what the new fetcher must
   request. It also has a deadline that does not wait for ticket hygiene.
2. **Regional skew: confirm the user-supplied-plus-citation path (§5.3).** It puts a required input in front of the
   engineer rather than guessing a defensible default. I believe that is correct for a submittal tool, but it is a
   product decision as much as a technical one.
3. **Vendoring static data.** Item D needs Atlas 14 temporal CSVs and temporal-area shapefiles bundled; item E needs
   a digitised TP-40 table; item C needs the 17C Appendix 10 example datasets as fixtures. All are public-domain
   federal data. Confirm bundling versioned copies in the repo is acceptable and where they should live.
4. **Sub-hourly durations under Atlas 15 (§3.3).** If the national release keeps the pilot's 1-hour floor, should a
   mixed-source storm be allowed at all, or should Atlas 15 sites simply refuse to size storm sewers? I have specified
   mixed-source-with-labelling as the more useful behaviour, but refusing is the more conservative one.
5. **Who re-checks the Atlas 15 schedule, and when?** §1.2 is the one input here with a short shelf life. It should be
   re-read immediately before item A step 4 is scheduled, and I would not trust this document's §1 after about
   February 2027.

---

## 10. Sources

Atlas 15 status and method:
- NOAA Atlas 15 information page (schedule, volumes, pilot) — https://water.noaa.gov/about/atlas15
- NOAA Atlas 15 Pilot viewer — https://water.noaa.gov/precip-frequency/atlas15/pilot
- NOAA Atlas 15 Pilot Technical Report (v1.1.p, 25 March 2025) — https://www.weather.gov/media/owp/precip-frequency/noaa_atlas15_pilot_technical_report.pdf
- "[DRAFT] Peer Review Plan: Preliminary NA15 Estimates (CONUS)" — https://www.weather.gov/media/owp/precip-frequency/noaa_atlas15_peer_review_questions_conus.pdf
- NOAA news release, update to U.S. precipitation frequency standards (2024; superseded schedule) — https://www.noaa.gov/news-release/update-to-us-precipitation-frequency-standards-now-accounts-for-climate-trends
- ASCE CACC, "Atlas 15 Volumes 1 and 2 Montana Pilot Summary" (9 Sept 2026) — https://collaborate.asce.org/blogs/committee-on-adaptation-to-a-changing-climate/2026/09/09/atlas-15-volumes-1-and-2-montana-pilot-summary
- ASFPM, Atlas 15 pilot dataset released for review — https://www.floods.org/annual-legislative-activities/atlas-14/noaa-atlas15-extreme-precipitation-pilot-dataset-released-for-review/
- CivilGEO, "NOAA Atlas 14 to Atlas 15: Rainfall Data in Transition" — https://www.civilgeo.com/rainfall-data-in-transition-noaa-atlas-14-to-atlas-15/

Atlas 14 products:
- HDSC FAQs (Atlas 14 currency, ARF status, access routes) — https://www.weather.gov/owp/hdsc_faqs
- PFDS temporal distributions — https://hdsc.nws.noaa.gov/pfds/pfds_temporal.html

Flood frequency:
- England, J.F., Cohn, T.A., Faber, B.A., Stedinger, J.R., Thomas, W.O. Jr., Veilleux, A.G., Kiang, J.E., and Mason,
  R.R., 2018, *Guidelines for determining flood flow frequency — Bulletin 17C*: USGS Techniques and Methods, book 4,
  chap. B5 — https://pubs.usgs.gov/tm/04/b05/tm4b5.pdf (worked Examples 3–7 in Appendix 10, computed with PeakFQ v7.1)
- HEC-SSP, "Bulletin 17B vs. Bulletin 17C" — https://www.hec.usace.army.mil/confluence/sspdocs/sspum/2.3/bulletin-17-analysis/bulletin-17b-vs-bulletin-17c
- MGBT (multiple Grubbs–Beck low-outlier test) — https://cran.r-project.org/web/packages/MGBT/MGBT.pdf
- USGS StreamStats flood-frequency reports (regional skew studies index) — https://www.usgs.gov/streamstats/science/flood-frequency-reports

USGS data routes:
- USGS Water Data APIs, OGC API collections (`peaks`, `monitoring-locations`, `continuous`) — https://api.waterdata.usgs.gov/ogcapi/v0/collections
  (`peaks` schema and `qualifier` vocabulary in §5.2 read directly from this service on 1 November 2026)
- "WaterServices APIs will be decommissioned early 2027" — https://waterdata.usgs.gov/blog/api-waterservices-decom/
- Peak discharge and gage height qualification codes (legacy `peak_cd` table) — https://pubs.usgs.gov/wdr/2005/wdr-il-05/misc/peakcods.htm

Rainfall distributions:
- NRCS, Title 210 National Engineering Handbook Part 630 Chapter 4, "Storm Rainfall Depth and Distribution"
  (210-630-H, Amendment 88, August 2019) — https://directives.nrcs.usda.gov/sites/default/files2/1712930592/29495.pdf
