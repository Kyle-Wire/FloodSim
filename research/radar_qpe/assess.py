"""SPA-93 radar coverage / QPE assessment measurements against the IEM MTArchive.

Writes one JSON per case. No pipeline code: one-off assessment only.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mrms_read as M

BASE = "https://mtarchive.geol.iastate.edu"

FLAGS = {0: "no precip", 1: "warm stratiform", 3: "snow", 4: "snow",
         5: "reserved", 6: "convective", 7: "hail", 10: "cool stratiform",
         91: "tropical stratiform", 96: "tropical convective", -3: "no coverage"}


def url(prod, t, every2min):
    stamp = t.strftime("%Y%m%d-%H%M%S")
    return f"{BASE}/{t:%Y/%m/%d}/mrms/ncep/{prod}/{prod}_00.00_{stamp}.grib2.gz"


def grab(args):
    prod, t, box = args
    try:
        p = M.fetch(url(prod, t, True))
        v, la, lo = M.read_window(p, *box)
        return t, v
    except Exception as e:
        return t, None


def series(prod, t0, t1, step_min, box, workers=6):
    times = []
    t = t0
    while t <= t1:
        times.append(t); t += timedelta(minutes=step_min)
    out = {}
    with ThreadPoolExecutor(workers) as ex:
        for t, v in ex.map(grab, [(prod, t, box) for t in times]):
            out[t] = v
    return [(t, out[t]) for t in times]


def stats(v):
    m = np.where(v >= 0, v, np.nan)
    return dict(mean=float(np.nanmean(m)), max=float(np.nanmax(m)),
                n=int(np.isfinite(m).sum()))


def plateau(vals, topn=8):
    """Exact repeated values near the top of the distribution = saturation."""
    a = np.concatenate([x.ravel() for x in vals])
    a = a[a > 0]
    u, c = np.unique(np.round(a, 1), return_counts=True)
    order = np.argsort(-c)
    tot = a.size
    hi = u >= np.percentile(a, 99.0)
    rows = [{"value_mm_h": float(u[i]), "count": int(c[i]),
             "pct_of_wet_pixels": round(100.0 * c[i] / tot, 3)}
            for i in np.argsort(-c) if u[i] >= 40.0][:topn]
    return {"n_wet_pixel_frames": int(tot),
            "p99_mm_h": float(np.percentile(a, 99)),
            "p999_mm_h": float(np.percentile(a, 99.9)),
            "max_mm_h": float(a.max()),
            "top_repeated_values_ge_40": rows}


def run_rate_case(name, box, t0, t1, out):
    print(f"[{name}] PrecipRate {t0}..{t1}", flush=True)
    s = time.time()
    rate = series("PrecipRate", t0, t1, 2, box)
    print(f"[{name}] rate frames ok={sum(1 for _,v in rate if v is not None)}/{len(rate)} in {time.time()-s:.0f}s", flush=True)
    flag = series("PrecipFlag", t0, t1, 2, box)
    print(f"[{name}] flag frames ok={sum(1 for _,v in flag if v is not None)}/{len(flag)}", flush=True)

    good = [(t, v) for t, v in rate if v is not None]
    ts = [{"t": t.strftime("%Y-%m-%dT%H:%M:%SZ"), **stats(v)} for t, v in good]
    # accumulation from the 2-min rate frames (trapezoid on 2 min)
    arr = np.stack([np.where(v >= 0, v, 0.0) for _, v in good])
    acc = arr.sum(axis=0) * (2.0 / 60.0)      # mm
    fh = {}
    for t, v in flag:
        if v is None:
            continue
        u, c = np.unique(np.round(v).astype(int), return_counts=True)
        for k, n in zip(u, c):
            fh[int(k)] = fh.get(int(k), 0) + int(n)
    tot = sum(fh.values()) or 1
    out[name] = {
        "box": box,
        "window": [t0.strftime("%Y-%m-%dT%H:%MZ"), t1.strftime("%Y-%m-%dT%H:%MZ")],
        "frames_requested": len(rate), "frames_decoded": len(good),
        "grid_shape": list(good[0][1].shape),
        "rate_series": ts,
        "peak_box_mean_rate_mm_h": max(x["mean"] for x in ts),
        "peak_pixel_rate_mm_h": max(x["max"] for x in ts),
        "accum_from_rate_mm": {"box_mean": float(acc.mean()),
                               "box_max_pixel": float(acc.max()),
                               "box_min_pixel": float(acc.min())},
        "saturation": plateau([v for _, v in good]),
        "precip_flag_histogram_pct": {f"{k} ({FLAGS.get(k, '?')})": round(100.0 * n / tot, 2)
                                      for k, n in sorted(fh.items(), key=lambda kv: -kv[1])},
    }
    print(json.dumps(out[name]["saturation"], indent=1), flush=True)


def run_hourly_case(name, box, t0, t1, radar_prod, gauge_prod, out):
    print(f"[{name}] hourly {radar_prod} vs {gauge_prod} {t0}..{t1}", flush=True)
    r = series(radar_prod, t0, t1, 60, box, workers=4)
    g = series(gauge_prod, t0, t1, 60, box, workers=4)
    gmap = dict(g)
    rows, rsum, gsum = [], None, None
    for t, rv in r:
        gv = gmap.get(t)
        if rv is None or gv is None:
            rows.append({"t": t.strftime("%Y-%m-%dT%H:%MZ"), "missing": True})
            continue
        rm = np.where(rv >= 0, rv, 0.0); gm = np.where(gv >= 0, gv, 0.0)
        rsum = rm if rsum is None else rsum + rm
        gsum = gm if gsum is None else gsum + gm
        rows.append({"t": t.strftime("%Y-%m-%dT%H:%MZ"),
                     "radar_only_mean_mm": round(float(rm.mean()), 2),
                     "gauge_adj_mean_mm": round(float(gm.mean()), 2),
                     "ratio": round(float(gm.mean() / rm.mean()), 3) if rm.mean() > 0.2 else None})
    res = {"box": box,
           "window": [t0.strftime("%Y-%m-%dT%H:%MZ"), t1.strftime("%Y-%m-%dT%H:%MZ")],
           "radar_product": radar_prod, "gauge_product": gauge_prod, "hours": rows}
    if rsum is not None:
        res["event_total_radar_only_mean_mm"] = round(float(rsum.mean()), 2)
        res["event_total_gauge_adj_mean_mm"] = round(float(gsum.mean()), 2)
        res["event_total_ratio_gauge_over_radar"] = round(float(gsum.mean() / rsum.mean()), 3)
        res["event_total_radar_only_max_pixel_mm"] = round(float(rsum.max()), 2)
        res["event_total_gauge_adj_max_pixel_mm"] = round(float(gsum.max()), 2)
        pr = rsum.ravel(); pg = gsum.ravel()
        ok = pr > 1.0
        if ok.sum() > 3:
            lr = np.log(pg[ok] / pr[ok])
            res["per_pixel_ratio_geomean"] = round(float(np.exp(lr.mean())), 3)
            res["per_pixel_ratio_log_sd"] = round(float(lr.std()), 3)
            res["per_pixel_ratio_min"] = round(float(np.exp(lr.min())), 3)
            res["per_pixel_ratio_max"] = round(float(np.exp(lr.max())), 3)
    out[name] = res
    print(json.dumps({k: v for k, v in res.items() if k != "hours"}, indent=1), flush=True)


def U(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc).replace(tzinfo=None)


CASES = {
    # name: bbox lat_lo, lat_hi, lon_lo, lon_hi
    "ellicott_city_tiber": (39.255, 39.315, -76.845, -76.785),
    "brays_bayou_meyerland": (29.63, 29.73, -95.52, -95.40),
    "philadelphia_center": (39.91, 40.01, -75.23, -75.11),
    "norfolk_hampton_roads": (36.80, 36.92, -76.36, -76.22),
    "charleston_peninsula": (32.73, 32.85, -80.02, -79.88),
}


WHICH = ("ec2016", "ec2018", "harvey", "harvey_rate", "ida", "norfolk", "matthew_rate")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in WHICH:
        print("usage: OUTDIR=out MRMS_CACHE=... python assess.py {%s}" % "|".join(WHICH))
        raise SystemExit(2)
    which = sys.argv[1]
    out = {}
    if which == "ec2016":
        run_rate_case("ellicott_city_2016_rate", CASES["ellicott_city_tiber"],
                      U(2016, 7, 30, 22, 0), U(2016, 7, 31, 2, 0), out)
        run_hourly_case("ellicott_city_2016_hourly", CASES["ellicott_city_tiber"],
                        U(2016, 7, 30, 20, 0), U(2016, 7, 31, 4, 0),
                        "RadarOnly_QPE_01H", "GaugeCorr_QPE_01H", out)
    elif which == "ec2018":
        run_rate_case("ellicott_city_2018_rate", CASES["ellicott_city_tiber"],
                      U(2018, 5, 27, 17, 0), U(2018, 5, 27, 21, 30), out)
        run_hourly_case("ellicott_city_2018_hourly", CASES["ellicott_city_tiber"],
                        U(2018, 5, 27, 16, 0), U(2018, 5, 27, 23, 0),
                        "RadarOnly_QPE_01H", "GaugeCorr_QPE_01H", out)
    elif which == "harvey_rate":
        run_rate_case("harvey_brays_rate", CASES["brays_bayou_meyerland"],
                      U(2017, 8, 27, 9, 0), U(2017, 8, 27, 13, 0), out)
    elif which == "matthew_rate":
        run_rate_case("matthew_norfolk_rate", CASES["norfolk_hampton_roads"],
                      U(2016, 10, 8, 20, 0), U(2016, 10, 9, 2, 0), out)
    elif which == "harvey":
        run_hourly_case("harvey_brays_hourly", CASES["brays_bayou_meyerland"],
                        U(2017, 8, 26, 0, 0), U(2017, 8, 28, 23, 0),
                        "RadarOnly_QPE_01H", "GaugeCorr_QPE_01H", out)
    elif which == "ida":
        run_rate_case("ida_philadelphia_rate", CASES["philadelphia_center"],
                      U(2021, 9, 1, 23, 0), U(2021, 9, 2, 4, 0), out)
        run_hourly_case("ida_philadelphia_hourly", CASES["philadelphia_center"],
                        U(2021, 9, 1, 18, 0), U(2021, 9, 2, 12, 0),
                        "RadarOnly_QPE_01H", "MultiSensor_QPE_01H_Pass2", out)
    elif which == "norfolk":
        run_hourly_case("matthew_norfolk_hourly", CASES["norfolk_hampton_roads"],
                        U(2016, 10, 8, 12, 0), U(2016, 10, 9, 23, 0),
                        "RadarOnly_QPE_01H", "GaugeCorr_QPE_01H", out)
        run_hourly_case("matthew_charleston_hourly", CASES["charleston_peninsula"],
                        U(2016, 10, 7, 12, 0), U(2016, 10, 8, 23, 0),
                        "RadarOnly_QPE_01H", "GaugeCorr_QPE_01H", out)
    with open(os.path.join(os.environ["OUTDIR"], f"measured_{which}.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("WROTE", which, flush=True)


main()
