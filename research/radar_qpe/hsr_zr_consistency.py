"""Is SeamlessHSR the reflectivity that PrecipRate is computed from?

Review item 6 asks whether SeamlessHSR is a better pre-2020 replay layer than
IEM's mrms_lcref raster. The strongest argument for it would be that it is the
*same* field MRMS converts to a rain rate, so that the dBZ a reviewer sees and
the mm/h the solver consumes are physically the same observation. That is an
argument worth checking rather than asserting.

Test: over a catchment window, take coincident SeamlessHSR (dBZ) and PrecipRate
(mm/h) frames, segregate by PrecipFlag, and see whether each class follows a
single Z = a R^b law with the published MRMS coefficients. If PrecipRate were
derived from some other reflectivity field, the scatter would not collapse onto
the per-class relations.

Published MRMS Z-R relations (Zhang et al. 2016, Table 1):
  warm stratiform / cool stratiform : Z = 200 R^1.6
  convective                        : Z = 300 R^1.4
  tropical stratiform / convective  : Z = 250 R^1.2
  hail                              : Z = 300 R^1.4 with the rate capped

Runs off the cache only -- pass --fetch to pull additional coincident frames.
"""
import json, os, sys
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mrms_read as M

BASE = "https://mtarchive.geol.iastate.edu"
OUT = os.environ.get("OUTDIR", "out")

ZR = {
    1:  ("warm stratiform", 200.0, 1.6),
    10: ("cool stratiform", 200.0, 1.6),
    6:  ("convective", 300.0, 1.4),
    7:  ("hail", 300.0, 1.4),
    91: ("tropical stratiform", 250.0, 1.2),
    96: ("tropical convective", 250.0, 1.2),
}


def url(prod, t):
    return (f"{BASE}/{t:%Y/%m/%d}/mrms/ncep/{prod}/"
            f"{prod}_00.00_{t:%Y%m%d-%H%M%S}.grib2.gz")


def triple(t, box, allow_fetch):
    """(hsr, rate, flag) over box at time t, or None if any is uncached."""
    vals = {}
    for prod in ("SeamlessHSR", "PrecipRate", "PrecipFlag"):
        u = url(prod, t)
        cached = os.path.join(M.CACHE, u.rsplit("/", 1)[-1])
        if not os.path.exists(cached) and not allow_fetch:
            return None
        try:
            vals[prod] = M.read_window(M.fetch(u), *box)[0]
        except Exception:
            return None
    return vals["SeamlessHSR"], vals["PrecipRate"], vals["PrecipFlag"]


def main():
    allow_fetch = "--fetch" in sys.argv
    box = (39.255, 39.315, -76.845, -76.785)
    times = [datetime(2016, 7, 30, 23, 52)]
    if allow_fetch:
        t = datetime(2016, 7, 30, 23, 0)
        times = [t + timedelta(minutes=2 * k) for k in range(31)]

    rows, used = [], []
    for t in times:
        tr = triple(t, box, allow_fetch)
        if tr is None:
            continue
        hsr, rate, flag = tr
        used.append(t.strftime("%H:%M"))
        f = np.round(flag).astype(int).ravel()
        z_dbz = hsr.ravel()
        r = rate.ravel()
        ok = (r > 0.5) & (z_dbz > -90) & (z_dbz > 0)
        for i in np.where(ok)[0]:
            rows.append((int(f[i]), float(z_dbz[i]), float(r[i])))

    res = {"frames_used": used, "n_points": len(rows),
           "box": list(box),
           "note": "Z from SeamlessHSR dBZ, R from PrecipRate, class from PrecipFlag"}
    by = {}
    for fl, dbz, r in rows:
        by.setdefault(fl, []).append((dbz, r))
    cls = {}
    for fl, pts in sorted(by.items()):
        dbz = np.array([p[0] for p in pts]); r = np.array([p[1] for p in pts])
        Z = 10.0 ** (dbz / 10.0)
        name, a, b = ZR.get(fl, (f"flag {fl}", None, None))
        e = {"class": name, "n": len(pts),
             "dbz_range": [round(float(dbz.min()), 1), round(float(dbz.max()), 1)],
             "rate_range_mm_h": [round(float(r.min()), 1), round(float(r.max()), 1)]}
        if a and len(pts) >= 3:
            # Predicted rate from the published relation for this class.
            r_pred = (Z / a) ** (1.0 / b)
            ratio = r_pred / r
            e["published_relation"] = f"Z = {a:.0f} R^{b}"
            e["predicted_over_actual_rate"] = {
                "geomean": round(float(np.exp(np.log(ratio).mean())), 3),
                "log_sd": round(float(np.log(ratio).std()), 3),
                "min": round(float(ratio.min()), 3),
                "max": round(float(ratio.max()), 3)}
            # Fit the exponent actually implied by the data, for comparison.
            if len(pts) >= 6 and r.std() > 0:
                slope, icpt = np.polyfit(np.log(r), np.log(Z), 1)
                e["fitted_relation"] = {"a": round(float(np.exp(icpt)), 1),
                                        "b": round(float(slope), 3),
                                        "r2": round(float(np.corrcoef(np.log(r), np.log(Z))[0, 1] ** 2), 4)}
        cls[str(fl)] = e
    res["by_precip_flag"] = cls
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "measured_hsr_zr.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


main()
