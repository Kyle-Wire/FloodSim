"""SeamlessHSR negative-value census: is "no echo" a different value from "no coverage"?

SPA-94's M16 reports two sentinels for ``SeamlessHSR`` -- X=0 -> -999.0 (no
coverage) and X=9000 -> -99.0 (no echo). ``PrecipRate`` has only one negative
value available to it (-3.0, its floor), so if the reflectivity layer really
carries two, the display layer can distinguish "the radar saw nothing" from
"no radar looked", and the legend question is whether it must.

That is a display-layer claim, so it is checked here rather than taken on
trust. Everything runs off frames already in the local cache, so this issues
no HTTP requests and charges nothing to the transfer ledger.

Writes out/measured_hsr_sentinels.json.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import mrms_read as M

OUT = os.environ.get("OUTDIR", "out")
CACHE = os.environ.get("MRMS_CACHE", ".")
STAMP = "20160730-235200"

WINDOWS = {
    # Gate G2b's known no-coverage patch: central Manitoba, inside the grid,
    # outside the WSR-88D network.
    "no_coverage_patch": (53.80, 54.20, -100.40, -100.00),
    # The Tiber catchment at the 2016 storm peak.
    "ellicott_city_catchment": (39.255, 39.315, -76.845, -76.785),
    # Wide Maryland box: storm core, surrounding dry-but-covered air, and the
    # Atlantic. This is the window that decides whether the three states are
    # separable in practice or only in principle.
    "maryland_wide": (38.50, 40.50, -78.00, -75.50),
}


def cached(prod):
    p = os.path.join(CACHE, f"{prod}_00.00_{STAMP}.grib2.gz")
    if not os.path.exists(p):
        raise SystemExit(f"not cached, and this script may not fetch: {p}")
    return p


def negatives(vals):
    """Every distinct negative value in the window, with counts."""
    neg = vals[vals < 0]
    uniq, cnt = np.unique(np.round(neg, 1), return_counts=True)
    return {f"{u:.1f}": int(c) for u, c in zip(uniq, cnt)}


def main():
    os.makedirs(OUT, exist_ok=True)
    hsr_path, rate_path = cached("SeamlessHSR"), cached("PrecipRate")
    res = {"frame": STAMP, "fetched_bytes": 0, "windows": {}}

    for name, box in WINDOWS.items():
        lat_lo, lat_hi, lon_lo, lon_hi = box
        hsr, _, _ = M.read_window(hsr_path, lat_lo, lat_hi, lon_lo, lon_hi)
        rate, _, _ = M.read_window(rate_path, lat_lo, lat_hi, lon_lo, lon_hi)
        assert hsr.shape == rate.shape, (hsr.shape, rate.shape)
        n = hsr.size

        no_cov = np.isclose(hsr, -999.0)
        no_echo = np.isclose(hsr, -99.0)
        valid = ~(no_cov | no_echo)
        rate_nocov = np.isclose(rate, -3.0)
        rate_dry = np.isclose(rate, 0.0)

        w = {
            "pixels": int(n),
            "hsr_negatives": negatives(hsr),
            "rate_negatives": negatives(rate),
            "hsr_no_coverage_pct": round(100.0 * no_cov.sum() / n, 3),
            "hsr_no_echo_pct": round(100.0 * no_echo.sum() / n, 3),
            "hsr_valid_pct": round(100.0 * valid.sum() / n, 3),
            # Co-registration of the two layers' no-coverage masks.
            "nocov_agree": int((no_cov & rate_nocov).sum()),
            "nocov_hsr_only": int((no_cov & ~rate_nocov).sum()),
            "nocov_rate_only": int((rate_nocov & ~no_cov).sum()),
            # The display-layer question: where the rate field says "covered
            # and dry", what does the reflectivity field say?
            "rate_dry_pixels": int(rate_dry.sum()),
            "rate_dry_and_hsr_no_echo": int((rate_dry & no_echo).sum()),
            "rate_dry_and_hsr_valid": int((rate_dry & valid).sum()),
            "rate_dry_and_hsr_no_coverage": int((rate_dry & no_cov).sum()),
        }
        if valid.any():
            w["hsr_valid_min_dbz"] = round(float(hsr[valid].min()), 2)
            w["hsr_valid_max_dbz"] = round(float(hsr[valid].max()), 2)
            # How much of the valid field would be invisible under the IEM
            # palette's black floor, for comparison with Addendum A A.2.
            w["hsr_valid_pct_below_10p5_dbz"] = round(
                100.0 * float((hsr[valid] <= 10.5).sum()) / int(valid.sum()), 2)
        res["windows"][name] = w
        print(f"\n{name}: {n} px")
        for k, v in w.items():
            print(f"  {k}: {v}")

    with open(os.path.join(OUT, "measured_hsr_sentinels.json"), "w") as f:
        json.dump(res, f, indent=2)
    print(f"\nwrote {OUT}/measured_hsr_sentinels.json")


if __name__ == "__main__":
    main()
