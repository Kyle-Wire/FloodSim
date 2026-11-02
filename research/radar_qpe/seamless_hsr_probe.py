"""SPA-93 review items 5 and 6.

Item 6: assess ``SeamlessHSR`` as the pre-2020 reflectivity replay layer. It is
native NCEP GRIB2 (so no palette quantisation and no third-party raster), it
appears in every pre-2020 MTArchive tree, and neither this assessment nor the
SPA-94 ingestion design proposed it. The question is not only whether it decodes
but *what it is a picture of*, because that determines the legend.

Item 5: the document and README state the PrecipRate no-data floor. Rather than
quote it, read R / E / D / nbits out of section 5 of a real message and compute
the minimum representable value, which settles whether -999 can be encoded at
all.

Writes out/measured_seamless_hsr.json.
"""
import json, os, sys, gzip
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import urllib.error
import numpy as np
import mrms_read as M
import fetch_budget

BASE = "https://mtarchive.geol.iastate.edu"
OUT = os.environ.get("OUTDIR", "out")

# One catchment box per pre-2020 case, from assess.py.
BOXES = {
    "ellicott_city_2016": ((39.255, 39.315, -76.845, -76.785), datetime(2016, 7, 30, 23, 52)),
    "ellicott_city_2018": ((39.255, 39.315, -76.845, -76.785), datetime(2018, 5, 27, 21, 0)),
    "harvey_brays_2017": ((29.63, 29.73, -95.52, -95.40), datetime(2017, 8, 27, 10, 0)),
    "matthew_norfolk_2016": ((36.80, 36.92, -76.36, -76.22), datetime(2016, 10, 8, 22, 0)),
}


def url(prod, t):
    return (f"{BASE}/{t:%Y/%m/%d}/mrms/ncep/{prod}/"
            f"{prod}_00.00_{t:%Y%m%d-%H%M%S}.grib2.gz")


def packing(path):
    """R, E, D, nbits and the implied representable range from GRIB2 section 5."""
    with gzip.open(path, "rb") as f:
        raw = f.read()
    sec = M._sections(raw)
    s5 = sec[5]
    import struct
    R = struct.unpack(">f", s5[11:15])[0]
    E = M._s(s5[15:17]); D = M._s(s5[17:19]); nbits = s5[19]
    lo = (R + 0 * 2.0 ** E) / 10.0 ** D
    hi = (R + ((1 << nbits) - 1) * 2.0 ** E) / 10.0 ** D
    return {"R": R, "E": E, "D": D, "nbits": nbits,
            "min_representable": round(lo, 4), "max_representable": round(hi, 4),
            "step": round((2.0 ** E) / (10.0 ** D), 4)}


def availability(prod, day, every_min=2):
    """How many of the day's expected frames respond to a range request."""
    ok, miss, first_bytes = 0, [], None
    t = datetime(day.year, day.month, day.day)
    # sample every 30 min across the day rather than all 720 -- cheap census
    while t < datetime(day.year, day.month, day.day) + timedelta(days=1):
        u = url(prod, t)
        try:
            fetch_budget.check(u)
            import urllib.request
            req = urllib.request.Request(u, method="HEAD",
                                         headers={"User-Agent": "floodsim-radar-assessment"})
            with urllib.request.urlopen(req, timeout=60) as r:
                n = int(r.headers.get("Content-Length") or 0)
            ok += 1
            if first_bytes is None:
                first_bytes = n
        except Exception:
            miss.append(t.strftime("%H:%M"))
        t += timedelta(minutes=30)
    return {"frames_probed": ok + len(miss), "frames_present": ok,
            "missing": miss, "bytes_per_frame": first_bytes}


def cadence(prod, day, start_h=22, n=10):
    """Confirm the publication cadence by walking consecutive even minutes."""
    t = datetime(day.year, day.month, day.day, start_h, 0)
    found = []
    for k in range(n):
        u = url(prod, t)
        try:
            import urllib.request
            fetch_budget.check(u)
            req = urllib.request.Request(u, method="HEAD",
                                         headers={"User-Agent": "floodsim-radar-assessment"})
            with urllib.request.urlopen(req, timeout=60) as r:
                found.append({"t": t.strftime("%H:%M:%S"),
                              "bytes": int(r.headers.get("Content-Length") or 0)})
        except Exception as e:
            found.append({"t": t.strftime("%H:%M:%S"), "err": type(e).__name__})
        t += timedelta(minutes=2)
    return found


def field_stats(prod, t, box):
    p = M.fetch(url(prod, t))
    v, la, lo = M.read_window(p, *box)
    a = v.ravel()
    neg = {str(round(float(x), 3)): int((a == x).sum())
           for x in np.unique(a[a < 0])}
    pos = a[a > -90]
    return {
        "valid_time_requested": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "grid_shape": list(v.shape),
        "packing": packing(p),
        "negative_value_histogram": neg,
        "min": round(float(pos.min()), 2), "max": round(float(pos.max()), 2),
        "mean": round(float(pos.mean()), 2),
        "n_pixels": int(a.size),
        "file_bytes": os.path.getsize(p),
    }


def main():
    res = {"host": BASE, "note": "SPA-93 review items 5 and 6"}

    # --- item 6: does SeamlessHSR exist, at what cadence, and what does it hold?
    res["seamless_hsr"] = {}
    for name, (box, t) in BOXES.items():
        day = t.date()
        entry = {}
        try:
            entry["field"] = field_stats("SeamlessHSR", t, box)
        except Exception as e:
            entry["field_error"] = f"{type(e).__name__}: {e}"
        entry["day_availability"] = availability("SeamlessHSR",
                                                 datetime(day.year, day.month, day.day))
        res["seamless_hsr"][name] = entry

    res["seamless_hsr_cadence_2016_07_30"] = cadence("SeamlessHSR",
                                                     datetime(2016, 7, 30), 23, 10)

    # --- the companion products, for the legend comparison
    t = datetime(2016, 7, 30, 23, 52)
    box = BOXES["ellicott_city_2016"][0]
    for prod in ("PrecipRate", "PrecipFlag"):
        try:
            res[f"{prod}_packing_2016"] = field_stats(prod, t, box)
        except Exception as e:
            res[f"{prod}_packing_2016"] = {"error": f"{type(e).__name__}: {e}"}

    # Is the 2020+ column-max composite really absent pre-2020?
    res["composite_pre2020_check"] = {}
    for prod in ("MergedReflectivityQCComposite", "MergedReflectivityQC",
                 "SeamlessHSR", "MergedBaseReflectivityQC"):
        u = url(prod, datetime(2016, 7, 30, 23, 52))
        try:
            import urllib.request
            fetch_budget.check(u)
            req = urllib.request.Request(u, method="HEAD",
                                         headers={"User-Agent": "floodsim-radar-assessment"})
            with urllib.request.urlopen(req, timeout=60) as r:
                res["composite_pre2020_check"][prod] = {
                    "present": True, "bytes": int(r.headers.get("Content-Length") or 0)}
        except urllib.error.HTTPError as e:
            res["composite_pre2020_check"][prod] = {"present": False, "http": e.code}
        except Exception as e:
            res["composite_pre2020_check"][prod] = {"present": False,
                                                    "err": type(e).__name__}

    res["fetch_ledger"] = fetch_budget.report()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "measured_seamless_hsr.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


main()
