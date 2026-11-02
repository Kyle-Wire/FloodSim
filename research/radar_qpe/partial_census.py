"""Rate-cap census over whatever frames are already cached. Issues no requests.

The Matthew (case 6) census is gate G3's last unrun arm. MTArchive began
throttling hard partway through it -- about one request a minute against the 19
a minute it had been serving -- and SPA-93 review item 7 is explicit that these
are courtesy hosts and that the right response to a slow host is to stop asking,
not to ask harder.

A cap question does not need every frame to be partly answerable. If the field
exceeds the suspected ceiling anywhere in the frames we already have, the
ceiling is not binding and the question is settled in the affirmative. If it
does not, the result is suggestive and the census is still owed. So this reads
only files already in $MRMS_CACHE, reports how many of the requested frames
that is, and refuses to pretend to be a complete census.

Usage:
  OUTDIR=out MRMS_CACHE=... python -P partial_census.py <label> <lat_lo> <lat_hi>
      <lon_lo> <lon_hi> <YYYYmmdd-HHMMSS> <YYYYmmdd-HHMMSS>
"""
import json, os, sys
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mrms_read as M

OUT = os.environ.get("OUTDIR", "out")
FLAGS = {0: "no precip", 1: "warm stratiform", 3: "snow", 4: "snow",
         6: "convective", 7: "hail", 10: "cool stratiform",
         91: "tropical stratiform", 96: "tropical convective", -3: "no coverage"}


def cached(prod, t):
    name = f"{prod}_00.00_{t:%Y%m%d-%H%M%S}.grib2.gz"
    p = os.path.join(M.CACHE, name)
    return p if os.path.exists(p) else None


def main():
    label = sys.argv[1]
    box = tuple(float(x) for x in sys.argv[2:6])
    t0 = datetime.strptime(sys.argv[6], "%Y%m%d-%H%M%S")
    t1 = datetime.strptime(sys.argv[7], "%Y%m%d-%H%M%S")

    times, t = [], t0
    while t <= t1:
        times.append(t); t += timedelta(minutes=2)

    rates, flags, used = [], [], []
    for t in times:
        p = cached("PrecipRate", t)
        if not p:
            continue
        try:
            v, _, _ = M.read_window(p, *box)
        except Exception:
            continue
        rates.append(v); used.append(t.strftime("%H:%M"))
        q = cached("PrecipFlag", t)
        if q:
            try:
                flags.append(M.read_window(q, *box)[0])
            except Exception:
                pass

    if not rates:
        print("no cached frames"); raise SystemExit(1)

    a = np.concatenate([x.ravel() for x in rates])
    wet = a[a > 0]
    u, c = np.unique(np.round(wet, 1), return_counts=True)
    top = [{"value_mm_h": float(u[i]), "count": int(c[i]),
            "pct_of_wet_pixels": round(100.0 * c[i] / wet.size, 3)}
           for i in np.argsort(-c) if u[i] >= 40.0][:8]
    series = [{"t": ts, "mean": float(np.where(v >= 0, v, np.nan).mean()),
               "max": float(v.max())} for ts, v in zip(used, rates)]
    fh = {}
    for v in flags:
        uu, cc = np.unique(np.round(v).astype(int), return_counts=True)
        for k, n in zip(uu, cc):
            fh[int(k)] = fh.get(int(k), 0) + int(n)
    tot = sum(fh.values()) or 1

    res = {
        "label": label,
        "status": "PARTIAL -- cached frames only, no requests issued",
        "box": list(box),
        "window": [t0.strftime("%Y-%m-%dT%H:%MZ"), t1.strftime("%Y-%m-%dT%H:%MZ")],
        "frames_in_window": len(times),
        "frames_available_in_cache": len(rates),
        "coverage_pct": round(100.0 * len(rates) / len(times), 1),
        "flag_frames_available": len(flags),
        "grid_shape": list(rates[0].shape),
        "peak_box_mean_rate_mm_h": max(s["mean"] for s in series),
        "peak_pixel_rate_mm_h": max(s["max"] for s in series),
        "n_wet_pixel_frames": int(wet.size),
        "p99_mm_h": float(np.percentile(wet, 99)),
        "p999_mm_h": float(np.percentile(wet, 99.9)),
        "top_repeated_values_ge_40": top,
        "precip_flag_histogram_pct": {f"{k} ({FLAGS.get(k, '?')})": round(100.0 * n / tot, 2)
                                      for k, n in sorted(fh.items(), key=lambda kv: -kv[1])},
        "frames_used": used,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"measured_partial_{label}.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "frames_used"}, indent=1))


main()
