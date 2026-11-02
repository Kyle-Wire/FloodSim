# research/radar_qpe

Working files behind **SPA-93 — radar coverage and QPE product assessment for the
six Phase 1 hindcast cases**. The document is
[`SPA-93_radar_coverage_and_qpe_assessment.md`](SPA-93_radar_coverage_and_qpe_assessment.md);
everything it quotes was measured by the scripts here.

This directory is **assessment, not pipeline.** `mrms_read.py` exists so that the
numbers in the document could be measured against the actual archive rather than
cited; the MRMS ingestion path, the GRIB2 decoder and the replay overlay belong
to the Geospatial Engineer's ticket. Nothing here is imported by `src/`.

| File | What it does | Output |
|---|---|---|
| `archive_probe.py` | Enumerates the NOAA Open Data bucket and the IEM MTArchive; reports which MRMS fields exist on each Phase 1 event date and which 2-minute `PrecipRate` frames are missing | `out/archive_probe.json` |
| `geometry.py` | Range, azimuth and beam height from each candidate WSR-88D and TDWR to each catchment, under the 4/3 effective-earth refraction model | `out/beam_geometry.{json,txt}` |
| `advection_test.py` | The four acceptance tests the advection-correction module has to pass, with the naive controls reported beside the method under test | `out/advection.txt` |
| `refresh_probe.py` | How often `PrecipRate` actually changes over a catchment window, versus the 2-minute publication cadence | `out/measured_refresh.json` |
| `assess.py` | Per-case 2-minute rate series, `PrecipFlag` histogram, rate-cap saturation census, and the gauge-merged / radar-only ratio | `out/measured_<case>.json` |
| `mrms_read.py` | Minimal MRMS GRIB2 reader: grid template 0, data template 5.41 (PNG-packed), window subsetting | — |
| `fetch_budget.py` | Per-host transfer cap, enforced before each request; persistent byte and request ledger | `fetch_ledger.json` |
| `seamless_hsr_probe.py` | `SeamlessHSR` availability and cadence on the pre-2020 case dates, and the GRIB2 `R`/`E`/`D` packing table behind the no-data sentinels | `out/measured_seamless_hsr.json` |
| `hsr_zr_consistency.py` | Pushes `SeamlessHSR` dBZ through the published per-class Z–R relations and compares with `PrecipRate` at the same pixel, classified by `PrecipFlag` | `out/measured_hsr_zr.json` |
| `hour_label_test.py` | Which end of its accumulation window an hourly QPE file is stamped with | `out/measured_hour_label.json` |
| `review_followups.py` | Peak-intensity attenuation from hourly forcing on real storms; bias estimability vs aggregation window; hourly-`K` against event-`K` sensitivity | `out/measured_review_followups.json` |
| `partial_census.py` | Rate-cap census over **only the frames already in `$MRMS_CACHE`**, issuing no requests, with the cached fraction reported. For when a host starts throttling and the right answer is to stop asking rather than ask harder | `out/measured_partial_<label>.json` |

## Running

`geometry.py` and `archive_probe.py` need only the standard library.
`advection_test.py`, `refresh_probe.py` and `assess.py` need numpy.

```sh
python archive_probe.py > out/archive_probe.json
python geometry.py                      # add --json for the machine-readable form
python advection_test.py                # add --json likewise
OUTDIR=out MRMS_CACHE=/tmp/mrms python refresh_probe.py
OUTDIR=out MRMS_CACHE=/tmp/mrms python assess.py ec2016
#   ec2018 | ec2018_full | harvey | harvey_rate | ida | ida_full | norfolk | matthew_rate
OUTDIR=out MRMS_CACHE=/tmp/mrms python seamless_hsr_probe.py
OUTDIR=out MRMS_CACHE=/tmp/mrms python hsr_zr_consistency.py   # --fetch for more frames
OUTDIR=out python hour_label_test.py        # cached JSON only, no network
OUTDIR=out python review_followups.py       # cached JSON only, no network
```

`assess.py`, `refresh_probe.py` and the two `*_hsr*` probes fetch `.grib2.gz`
from the IEM MTArchive and cache them in `$MRMS_CACHE`. The full set behind the
document is well over 1 GB and is deliberately not committed; `out/` holds the
derived JSON instead. `hour_label_test.py` and `review_followups.py` re-analyse
`out/measured_*.json` and touch the network not at all.

Note that the scripts cache into `$MRMS_CACHE` and are run from this directory,
so downloaded archive files never share a directory with the code that reads
them. Run them with `python -P` (or `-I` if numpy is on the system path) so the
interpreter does not add the working directory to `sys.path`.

## Four things to know before reusing `mrms_read.py`

- **Negative values are not zero, and the sentinel set is per-product.** Measured
  out of section 5 of real messages by `seamless_hsr_probe.py`: `PrecipRate` has
  `R = −30.0, D = 1`, so its floor is **−3.0 mm/h** and −999 *cannot be encoded
  at all*; `SeamlessHSR` has `R = −9990.0, D = 1`, so −999.0 **is** its no-data
  value. A single global no-data rule is wrong in both directions. Treating −3 as
  0 mm/h turns a radar outage into a dry spell.
- **The hourly accumulation products are stamped with the END of their
  accumulation window.** `RadarOnly_QPE_01H_00.00_20210902-000000` is the
  accumulation for 23:00–00:00Z. Verified by `hour_label_test.py`: the
  end-of-window reading reproduces the hourly file to 0.07 mm over four Ida
  hours, the start-of-window reading is out by 6.91 mm. Getting this backwards
  mis-times every hyetograph while leaving event volume exact, so no
  water-balance check will catch it.
- **PNG unfiltering is sequential over scanlines**, so a small window still costs
  every row above it. A Maryland window is ~45 % of the 3500-row CONUS grid and
  takes a few seconds per frame.
- **There is a per-host transfer cap and it is enforced in code.**
  `fetch_budget.py` charges every byte that crosses the wire to a persistent
  per-host ledger and raises `BudgetExceeded` past `MRMS_HOST_BUDGET_MB`
  (default 700 MB). These are third-party academic mirrors run as a courtesy;
  the first pass of this assessment pulled ~1.1 GB from one of them before it
  began throttling, which is why the cap now lives in code rather than in
  intent. Do not raise it without asking on SPA-93 first.
