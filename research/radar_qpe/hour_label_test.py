"""Which end of its accumulation window is an MRMS hourly QPE file stamped with?

Found while fixing review item 1. The Ida hourly file stamped 2021-09-01T23:00Z
carries 39.46 mm over the Philadelphia box, but the 2-minute PrecipRate frames
from 23:00Z to 00:00Z integrate to about 15 mm -- and the file stamped 00:00Z
carries 15.07 mm. That is the signature of an end-of-window stamp, and if it is
real then every comparison in the first revision that aligned an hourly product
to the *start* of its hour was out by one hour.

Test it where there is overlapping data: integrate the 2-minute rate series over
[T-1h, T] and over [T, T+1h] and see which reproduces the hourly file stamped T.
No fetching -- runs off the cached JSON.
"""
import json, os
import numpy as np

OUT = os.environ.get("OUTDIR", "out")


def load(n):
    with open(os.path.join(OUT, n)) as f:
        return json.load(f)


def integrate(series, t0, t1):
    """mm accumulated by trapezoid on the 2-min box-mean rate over [t0, t1)."""
    sel = [s for s in series if t0 <= s["t"] < t1]
    if not sel:
        return None, 0
    return float(np.sum([s["mean"] for s in sel]) * (2.0 / 60.0)), len(sel)


def test(label, fn, rate_key, hourly_key):
    d = load(fn)
    s = d[rate_key]["rate_series"]
    rows = []
    for h in d[hourly_key]["hours"]:
        if h.get("missing"):
            continue
        T = h["t"].replace("Z", ":00Z") if len(h["t"]) == 17 else h["t"]
        # build the two candidate windows as plain string compares on ISO stamps
        hh = int(h["t"][11:13]); day = h["t"][:10]
        def stamp(d_, hr):
            return f"{d_}T{hr:02d}:00:00Z"
        # previous hour
        import datetime as dt
        t = dt.datetime.strptime(h["t"], "%Y-%m-%dT%H:%MZ")
        prev = (t - dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        here = t.strftime("%Y-%m-%dT%H:%M:%SZ")
        nxt = (t + dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        a, na = integrate(s, prev, here)     # [T-1h, T)  -> end-of-window stamp
        b, nb = integrate(s, here, nxt)      # [T, T+1h)  -> start-of-window stamp
        if na < 28 and nb < 28:
            continue
        rows.append({
            "hourly_file_stamp": h["t"],
            "hourly_file_mm": h["radar_only_mean_mm"],
            "rate_integral_prev_hour_mm": round(a, 2) if a is not None else None,
            "n_frames_prev": na,
            "rate_integral_next_hour_mm": round(b, 2) if b is not None else None,
            "n_frames_next": nb,
        })
    # score the two hypotheses on the hours where both windows are fully covered
    full = [r for r in rows if r["n_frames_prev"] >= 29 and r["n_frames_next"] >= 29]
    out = {"case": label, "rows": rows}
    if full:
        ea = np.array([abs(r["rate_integral_prev_hour_mm"] - r["hourly_file_mm"]) for r in full])
        eb = np.array([abs(r["rate_integral_next_hour_mm"] - r["hourly_file_mm"]) for r in full])
        out["hours_fully_covered_both_ways"] = len(full)
        out["mean_abs_error_mm"] = {
            "end_of_window_stamp": round(float(ea.mean()), 2),
            "start_of_window_stamp": round(float(eb.mean()), 2)}
        out["verdict"] = ("end-of-window" if ea.mean() < eb.mean() else "start-of-window")
    return out


def main():
    res = []
    for args in [("Ellicott City 2016", "measured_ec2016.json",
                  "ellicott_city_2016_rate", "ellicott_city_2016_hourly"),
                 ("Ida / Philadelphia 2021", "measured_ida.json",
                  "ida_philadelphia_rate", "ida_philadelphia_hourly")]:
        try:
            res.append(test(*args))
        except FileNotFoundError:
            pass
    with open(os.path.join(OUT, "measured_hour_label.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


main()
