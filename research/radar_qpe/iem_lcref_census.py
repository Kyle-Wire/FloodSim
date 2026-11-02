"""Is IEM's lcref raster present, at 2-minute cadence, on every case date?

SPA-94 confirmed `mrms_lcref` for 2016-07-30.  I over-generalised from the NCEP
GRIB2 tree once already (asserting no dBZ layer exists for the pre-v12 cases),
so this counts the actual files per day for every case date before the display
layer is specified.

Writes out/measured_lcref_census.json.
"""
import json, os, re, urllib.error, urllib.request

UA = {"User-Agent": "floodsim-radar-assessment"}
DATES = {
    "ellicott_city_2016": ["2016/07/30", "2016/07/31"],
    "matthew_norfolk_2016": ["2016/10/08", "2016/10/09"],
    "harvey_brays_2017": ["2017/08/26", "2017/08/27"],
    "ellicott_city_2018": ["2018/05/27"],
    "ida_philadelphia_2021": ["2021/09/01", "2021/09/02"],
    "archive_day_one": ["2014/11/01"],
}
PNG = re.compile(r"(lcref|a2m)_(\d{12})\.png")


def listing(day):
    url = "https://mesonet.agron.iastate.edu/archive/data/%s/GIS/mrms/" % day
    try:
        with urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=180) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code}
    found = {}
    for prod, stamp in PNG.findall(body):
        found.setdefault(prod, set()).add(stamp)
    out = {"url": url, "status": 200}
    for prod, stamps in sorted(found.items()):
        s = sorted(stamps)
        mins = sorted({int(x[10:12]) for x in s})
        out[prod] = {
            "files": len(s), "first": s[0] if s else None, "last": s[-1] if s else None,
            "expected_2min": 720,
            "pct_of_720": round(100.0 * len(s) / 720.0, 1),
            "minute_values_present": mins if len(mins) <= 31 else "%d distinct" % len(mins),
            "all_even_minutes": all(m % 2 == 0 for m in mins),
        }
    for prod in ("lcref", "a2m"):
        out.setdefault(prod, {"files": 0})
    return out


def main():
    res = {}
    for case, days in DATES.items():
        res[case] = {}
        for d in days:
            res[case][d] = listing(d)
            r = res[case][d]
            print(case, d, "lcref=%s a2m=%s" % (r.get("lcref", {}).get("files"),
                                                r.get("a2m", {}).get("files")), flush=True)
    with open(os.path.join(os.environ["OUTDIR"], "measured_lcref_census.json"), "w") as f:
        json.dump(res, f, indent=1)


main()
