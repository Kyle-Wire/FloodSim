"""How often does MRMS PrecipRate actually change over a small domain?

The product is published every 2 minutes, but the radar input behind it is a
WSR-88D volume scan (VCP 12 ~ 4.2 min, VCP 212 ~ 4.5 min, VCP 21 ~ 6 min), so a
given pixel can only carry new information once per volume.  This measures the
fraction of consecutive 2-minute frames that are bit-identical over a catchment
window, and the distribution of the resulting effective refresh interval.
"""
import json, os, sys
from datetime import datetime, timedelta
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mrms_read as M

BASE = "https://mtarchive.geol.iastate.edu"


def series(t0, t1, box):
    out = []
    t = t0
    while t <= t1:
        u = ("%s/%s/mrms/ncep/PrecipRate/PrecipRate_00.00_%s.grib2.gz"
             % (BASE, t.strftime("%Y/%m/%d"), t.strftime("%Y%m%d-%H%M%S")))
        try:
            v, _, _ = M.read_window(M.fetch(u), *box)
            out.append((t, v))
        except Exception as e:
            out.append((t, None))
        t += timedelta(minutes=2)
    return out


def run(label, t0, t1, box, wet_only=True):
    s = series(t0, t1, box)
    ok = [(t, v) for t, v in s if v is not None]
    pairs = dup = 0
    runs, cur = [], 1
    for (t0_, a), (t1_, b) in zip(ok, ok[1:]):
        if (t1_ - t0_) != timedelta(minutes=2):
            continue
        if wet_only and max(float(np.nanmax(np.where(a >= 0, a, np.nan))),
                            float(np.nanmax(np.where(b >= 0, b, np.nan)))) < 1.0:
            continue
        pairs += 1
        if np.array_equal(a, b):
            dup += 1
            cur += 1
        else:
            runs.append(cur); cur = 1
    runs.append(cur)
    u, c = np.unique(np.array(runs), return_counts=True)
    return {
        "label": label,
        "window": [t0.strftime("%Y-%m-%dT%H:%MZ"), t1.strftime("%Y-%m-%dT%H:%MZ")],
        "box": box,
        "frames": len(ok),
        "consecutive_pairs_scored": pairs,
        "pairs_bit_identical": dup,
        "pct_identical": round(100.0 * dup / max(1, pairs), 1),
        "mean_frames_per_distinct_field": round(float(np.mean(runs)), 2),
        "mean_effective_refresh_min": round(2.0 * float(np.mean(runs)), 2),
        "run_length_histogram_frames": {int(k): int(n) for k, n in zip(u, c)},
    }


def U(*a):
    return datetime(*a)


CASES = [
    ("Ellicott City 2016", U(2016, 7, 30, 22, 0), U(2016, 7, 31, 2, 0),
     (39.255, 39.315, -76.845, -76.785)),
    ("Ellicott City 2018", U(2018, 5, 27, 17, 30), U(2018, 5, 27, 21, 0),
     (39.255, 39.315, -76.845, -76.785)),
    ("Ida / Philadelphia", U(2021, 9, 2, 0, 0), U(2021, 9, 2, 4, 0),
     (39.91, 40.01, -75.23, -75.11)),
    ("Harvey / Brays Bayou", U(2017, 8, 27, 9, 0), U(2017, 8, 27, 13, 0),
     (29.63, 29.73, -95.52, -95.40)),
    ("Matthew / Hampton Roads", U(2016, 10, 9, 0, 0), U(2016, 10, 9, 4, 0),
     (36.80, 36.92, -76.36, -76.22)),
]

if __name__ == "__main__":
    # Written after every case so a partial run still leaves a usable record.
    out = os.path.join(os.environ["OUTDIR"], "measured_refresh.json")
    res = []
    for c in CASES:
        r = run(*c)
        res.append(r)
        print(json.dumps(r), flush=True)
        with open(out, "w") as f:
            json.dump(res, f, indent=1)
