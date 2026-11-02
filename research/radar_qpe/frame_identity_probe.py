"""Does a repeated window maximum mean a repeated frame?

SPA-94 observed that the maximum of a 7x7 MRMS window over Ellicott City
repeats across consecutive 2-minute frames (22:36/22:38 both 127.8 mm/h,
22:44/22:46 both 133.6, 23:24..23:30 all 135.6) and read that as evidence of a
4-6 minute volume scan behind a 2-minute publication cadence.

A repeated window maximum and a repeated field are different claims.  A single
convective core translating across a small window can hold its peak value for
several frames while every pixel in the field changes.  This decides which it
is, on the exact frames cited, by comparing the fields themselves at three
window sizes and tracking where the maximum sits.

Writes out/measured_frame_identity.json.
"""
import json, os, sys
from datetime import datetime, timedelta
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mrms_read as M

BASE = "https://mtarchive.geol.iastate.edu"

# Ellicott City town centre, the centre of SPA-94's 7x7 window.
EC_LAT, EC_LON = 39.2673, -76.7983
# Three nested windows, all decoded from one fetch per frame.
WIDE = (EC_LAT - 0.15, EC_LAT + 0.15, EC_LON - 0.15, EC_LON + 0.15)   # ~31 x 31
W7 = (EC_LAT - 0.035, EC_LAT + 0.035, EC_LON - 0.035, EC_LON + 0.035)  # 7 x 7
TIBER = (39.255, 39.315, -76.845, -76.785)                             # 6 x 6, my box

# The frames SPA-94 cited, in the order they cited them, plus 23:52 (the frame
# they quoted a full window census for -- an independent-reader cross-check).
TIMES = ["22:34", "22:36", "22:38", "22:40",
         "22:44", "22:46",
         "23:24", "23:26", "23:28", "23:30",
         "23:52"]
DAY = datetime(2016, 7, 30)


def rate_url(t):
    return ("%s/%s/mrms/ncep/PrecipRate/PrecipRate_00.00_%s.grib2.gz"
            % (BASE, t.strftime("%Y/%m/%d"), t.strftime("%Y%m%d-%H%M%S")))


def sub(vals, lats, lons, box):
    js = np.where((lats >= box[0]) & (lats <= box[1]))[0]
    isx = np.where((lons >= box[2]) & (lons <= box[3]))[0]
    return vals[np.ix_(js, isx)], lats[js], lons[isx]


def argmax_latlon(v, lats, lons):
    j, i = np.unravel_index(int(np.nanargmax(v)), v.shape)
    return float(lats[j]), float(lons[i]), float(v[j, i])


def km(dlat, dlon, lat):
    return (111.32 * dlat, 111.32 * np.cos(np.radians(lat)) * dlon)


def main():
    out = os.path.join(os.environ["OUTDIR"], "measured_frame_identity.json")
    frames = {}
    for hm in TIMES:
        h, mi = (int(x) for x in hm.split(":"))
        t = DAY + timedelta(hours=h, minutes=mi)
        v, la, lo = M.read_window(M.fetch(rate_url(t)), *WIDE)
        frames[hm] = (t, v, la, lo)
        print("fetched", hm, v.shape, flush=True)

    per_frame, pairs = [], []
    for hm in TIMES:
        t, v, la, lo = frames[hm]
        w7, la7, lo7 = sub(v, la, lo, W7)
        tb, latb, lotb = sub(v, la, lo, TIBER)
        mlat, mlon, mval = argmax_latlon(np.where(v >= 0, v, np.nan), la, lo)
        per_frame.append({
            "t": hm,
            "w7x7_max_mm_h": round(float(np.nanmax(np.where(w7 >= 0, w7, np.nan))), 1),
            "w7x7_min_mm_h": round(float(np.nanmin(np.where(w7 >= 0, w7, np.nan))), 1),
            "w7x7_mean_mm_h": round(float(np.nanmean(np.where(w7 >= 0, w7, np.nan))), 1),
            "tiber_max_mm_h": round(float(np.nanmax(np.where(tb >= 0, tb, np.nan))), 1),
            "wide_max_mm_h": round(mval, 1),
            "wide_argmax_lat": round(mlat, 3), "wide_argmax_lon": round(mlon, 3),
            "n_distinct_values_wide": int(np.unique(v).size),
        })

    for a, b in zip(TIMES, TIMES[1:]):
        ta, va, la, lo = frames[a]
        tb_, vb, _, _ = frames[b]
        gap = (tb_ - ta).total_seconds()
        if gap > 150:            # not a consecutive pair (22:40 -> 22:44 etc.)
            continue
        row = {"pair": "%s -> %s" % (a, b), "gap_s": gap}
        for nm, box in (("w7x7", W7), ("tiber", TIBER), ("wide_31x31", WIDE)):
            sa, _, _ = sub(va, la, lo, box)
            sb, _, _ = sub(vb, la, lo, box)
            d = sa - sb
            wet = (sa > 0) | (sb > 0)
            row[nm] = {
                "bit_identical": bool(np.array_equal(sa, sb)),
                "pct_pixels_changed": round(100.0 * float((d != 0).mean()), 1),
                "rms_diff_mm_h": round(float(np.sqrt((d ** 2).mean())), 2),
                "max_abs_diff_mm_h": round(float(np.abs(d).max()), 1),
                "mean_abs_diff_over_wet_mm_h": (
                    round(float(np.abs(d)[wet].mean()), 2) if wet.any() else None),
            }
        # where did the field maximum go?
        ala, alo, _ = argmax_latlon(np.where(va >= 0, va, np.nan), la, lo)
        bla, blo, _ = argmax_latlon(np.where(vb >= 0, vb, np.nan), la, lo)
        dy, dx = km(bla - ala, blo - alo, EC_LAT)
        row["wide_argmax_shift_km"] = {"north": round(dy, 2), "east": round(dx, 2),
                                       "dist": round(float(np.hypot(dx, dy)), 2)}
        pairs.append(row)

    res = {"source": BASE, "product": "PrecipRate_00.00", "date": "2016-07-30",
           "windows": {"w7x7": W7, "tiber": TIBER, "wide_31x31": WIDE},
           "per_frame": per_frame, "consecutive_pairs": pairs}
    with open(out, "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


main()
