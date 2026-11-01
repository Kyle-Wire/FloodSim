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

## Running

`geometry.py` and `archive_probe.py` need only the standard library.
`advection_test.py`, `refresh_probe.py` and `assess.py` need numpy.

```sh
python archive_probe.py > out/archive_probe.json
python geometry.py                      # add --json for the machine-readable form
python advection_test.py                # add --json likewise
OUTDIR=out MRMS_CACHE=/tmp/mrms python refresh_probe.py
OUTDIR=out MRMS_CACHE=/tmp/mrms python assess.py ec2016   # ec2018 | harvey | ida | norfolk
```

`assess.py` and `refresh_probe.py` fetch `.grib2.gz` from the IEM MTArchive and
cache them in `$MRMS_CACHE`. The full set behind the document is about 1.1 GB and
is deliberately not committed; `out/` holds the derived JSON instead.

## Two things to know before reusing `mrms_read.py`

- **Negative values are not zero.** MRMS encodes −3 for "no radar coverage" and
  −999 for missing. Treating −3 as 0 mm/h turns a radar outage into a dry spell.
- **PNG unfiltering is sequential over scanlines**, so a small window still costs
  every row above it. A Maryland window is ~45 % of the 3500-row CONUS grid and
  takes a few seconds per frame.
