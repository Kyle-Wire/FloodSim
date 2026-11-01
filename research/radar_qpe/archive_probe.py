"""Probe what MRMS products actually exist, where, for the Phase 1 event dates.

Two independent sources are checked:
  * the NOAA Open Data (NODD) bucket  s3://noaa-mrms-pds  (anonymous HTTP list)
  * the Iowa Environmental Mesonet MTArchive  https://mtarchive.geol.iastate.edu

For each event date it reports the MRMS fields present and, for PrecipRate, the
exact 2-minute frames missing.  Pure stdlib; no credentials.

    python archive_probe.py > out/archive_probe.json
"""
import json, re, sys, urllib.request
from datetime import timedelta

NODD = "https://noaa-mrms-pds.s3.amazonaws.com/"
MT = "https://mtarchive.geol.iastate.edu"

EVENT_DATES = {
    "20160730": "Ellicott City 2016 (flood peak 2016-07-30 23:30Z - 07-31 01:30Z)",
    "20160731": "Ellicott City 2016, second UTC day",
    "20180527": "Ellicott City 2018 (flood 2018-05-27 18:00-21:00Z)",
    "20170826": "Harvey over Brays Bayou, day 1",
    "20170827": "Harvey over Brays Bayou, day 2",
    "20210901": "Ida over Philadelphia, first UTC day",
    "20210902": "Ida over Philadelphia, flood peak",
    "20161008": "Matthew over Hampton Roads, day 1",
    "20161009": "Matthew over Hampton Roads, day 2",
    "20151003": "October 2015 South Carolina flood, Charleston",
    "20141101": "first day of the public MRMS archive",
}

NODD_PRODUCTS = [
    "PrecipRate_00.00", "PrecipFlag_00.00", "RadarOnly_QPE_01H_00.00",
    "RadarOnly_QPE_15M_00.00", "MultiSensor_QPE_01H_Pass1_00.00",
    "MultiSensor_QPE_01H_Pass2_00.00", "MergedReflectivityQCComposite_00.50",
    "RadarQualityIndex_00.00", "SeamlessHSRHeight_00.00",
    "BrightBandTopHeight_00.00", "GaugeInflIndex_01H_Pass2_00.00",
    "Model_0degC_Height_00.50", "SyntheticPrecipRateID_00.00",
]


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "floodsim-radar-assessment"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def nodd_first_date(product):
    """Earliest YYYYMMDD partition present for a CONUS product."""
    body = get(NODD + "?list-type=2&delimiter=/&prefix=CONUS/%s/" % product)
    d = sorted(set(re.findall(r"<Prefix>CONUS/%s/(\d{8})/</Prefix>" % re.escape(product), body)))
    return {"first_partition": d[0] if d else None, "n_listed_first_page": len(d)}


def mt_fields(date):
    u = "%s/%s/%s/%s/mrms/ncep/" % (MT, date[:4], date[4:6], date[6:8])
    try:
        body = get(u)
    except Exception as e:
        return {"url": u, "error": str(e)}
    f = sorted(set(re.findall(r'href="([A-Za-z0-9_]+)/"', body)))
    return {"url": u, "fields": f, "n_fields": len(f)}


def mt_preciprate_gaps(date):
    u = "%s/%s/%s/%s/mrms/ncep/PrecipRate/" % (MT, date[:4], date[4:6], date[6:8])
    try:
        body = get(u)
    except Exception as e:
        return {"error": str(e)}
    have = set(re.findall(r"PrecipRate_00\.00_%s-(\d{6})\.grib2\.gz" % date, body))
    missing = []
    for m in range(0, 1440, 2):
        t = "%02d%02d00" % (m // 60, m % 60)
        if t not in have:
            missing.append(t)
    return {"frames_present": len(have), "frames_expected": 720,
            "missing_frames_utc": missing}


def main():
    out = {"nodd_bucket": NODD, "mtarchive": MT,
           "nodd_product_first_partition": {}, "mtarchive_by_date": {}}
    for p in NODD_PRODUCTS:
        try:
            out["nodd_product_first_partition"][p] = nodd_first_date(p)
        except Exception as e:
            out["nodd_product_first_partition"][p] = {"error": str(e)}
        print("nodd", p, out["nodd_product_first_partition"][p], file=sys.stderr)
    for d, label in EVENT_DATES.items():
        r = {"label": label}
        r.update(mt_fields(d))
        if "PrecipRate" in r.get("fields", []):
            r["precip_rate"] = mt_preciprate_gaps(d)
        out["mtarchive_by_date"][d] = r
        print("mt", d, r.get("n_fields"), file=sys.stderr)
    json.dump(out, sys.stdout, indent=1)


main()
