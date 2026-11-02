"""How much new information does each 2-minute PrecipRate frame actually carry?

`refresh_probe.py` asked whether consecutive frames are *bit-identical* and found
only 5-15 % were, concluding the 2-minute cadence was substantially real.  That
test is too strict to answer the question it was used for: one pixel changing by
0.1 mm/h makes a frame "not identical" while 98 % of the field is stale.

SPA-94 observed repeated window maxima across frame pairs and inferred a 4-6
minute volume scan behind the 2-minute publication cadence.  Neither statement is
the right one.  This measures the statistic that actually matters to an
advection scheme: the fraction of *wet* pixels whose value changes between
consecutive frames, and the distribution of that fraction over a whole event
window.

Writes out/measured_update_census.json.
"""
import json, os, sys
from datetime import datetime, timedelta
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mrms_read as M

BASE = "https://mtarchive.geol.iastate.edu"
WET = 1.0          # mm/h; below this a pixel is not usefully "raining"
WEAK = 0.25        # a pair with < 25 % of wet pixels changed is a weak update


def rate_url(t):
    return ("%s/%s/mrms/ncep/PrecipRate/PrecipRate_00.00_%s.grib2.gz"
            % (BASE, t.strftime("%Y/%m/%d"), t.strftime("%Y%m%d-%H%M%S")))


def run(label, t0, t1, box):
    frames, t = [], t0
    while t <= t1:
        try:
            v, _, _ = M.read_window(M.fetch(rate_url(t)), *box)
            frames.append((t, np.where(v >= 0, v, np.nan)))
        except Exception as e:
            frames.append((t, None))
            print("  miss", t, repr(e)[:60], flush=True)
        t += timedelta(minutes=2)

    rows = []
    for (ta, a), (tb, b) in zip(frames, frames[1:]):
        if a is None or b is None or (tb - ta) != timedelta(minutes=2):
            continue
        wet = (a >= WET) | (b >= WET)
        n = int(wet.sum())
        if n == 0:
            continue
        chg = (a != b) & wet
        rows.append({
            "pair": "%s->%s" % (ta.strftime("%H:%M"), tb.strftime("%H:%M")),
            "n_wet": n,
            "frac_wet_changed": round(float(chg.sum()) / n, 3),
            "bit_identical": bool(np.array_equal(np.nan_to_num(a, nan=-9),
                                                 np.nan_to_num(b, nan=-9))),
            "rms_diff_over_wet": round(float(np.sqrt(np.nanmean((a - b)[wet] ** 2))), 2),
            "peak_mm_h": round(float(max(np.nanmax(a), np.nanmax(b))), 1),
        })

    f = np.array([r["frac_wet_changed"] for r in rows])
    weak = f < WEAK
    # Longest run of consecutive weak-update pairs, and the implied gap between
    # genuinely new observations.
    runs, cur = [], 0
    for w in weak:
        if w:
            cur += 1
        else:
            runs.append(cur); cur = 0
    runs.append(cur)
    return {
        "label": label,
        "window": [t0.strftime("%Y-%m-%dT%H:%MZ"), t1.strftime("%Y-%m-%dT%H:%MZ")],
        "box": box, "wet_threshold_mm_h": WET, "weak_update_threshold": WEAK,
        "pairs_scored": len(rows),
        "pairs_bit_identical": int(sum(r["bit_identical"] for r in rows)),
        "frac_wet_changed": {
            "mean": round(float(f.mean()), 3), "median": round(float(np.median(f)), 3),
            "p10": round(float(np.percentile(f, 10)), 3),
            "p90": round(float(np.percentile(f, 90)), 3),
            "min": round(float(f.min()), 3), "max": round(float(f.max()), 3),
        },
        "pct_pairs_weak_update": round(100.0 * float(weak.mean()), 1),
        "pct_pairs_over_90pct_changed": round(100.0 * float((f > 0.9).mean()), 1),
        "max_consecutive_weak_pairs": int(max(runs)),
        "implied_new_observation_interval_min":
            round(2.0 * len(rows) / max(1, int((~weak).sum())), 2),
        "pairs": rows,
    }


def U(*a):
    return datetime(*a)


CASES = {
    "ec2016": ("Ellicott City 2016", U(2016, 7, 30, 22, 0), U(2016, 7, 31, 2, 0),
               (39.255, 39.315, -76.845, -76.785)),
    "ec2018": ("Ellicott City 2018", U(2018, 5, 27, 17, 30), U(2018, 5, 27, 21, 0),
               (39.255, 39.315, -76.845, -76.785)),
    "ida": ("Ida / Philadelphia", U(2021, 9, 2, 0, 0), U(2021, 9, 2, 4, 0),
            (39.91, 40.01, -75.23, -75.11)),
}

if __name__ == "__main__":
    out = os.path.join(os.environ["OUTDIR"], "measured_update_census.json")
    prev = {}
    if os.path.exists(out):
        prev = {r["key"]: r for r in json.load(open(out))}
    for key in (sys.argv[1:] or list(CASES)):
        r = run(*CASES[key]); r["key"] = key
        prev[key] = r
        print(json.dumps({k: v for k, v in r.items() if k != "pairs"}, indent=1), flush=True)
        with open(out, "w") as f:
            json.dump(list(prev.values()), f, indent=1)
