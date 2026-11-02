"""SPA-93 review items 3 and 4. Pure re-analysis of out/measured_*.json -- no fetching.

Item 4: the "-83.9 % / factor of six" peak-attenuation figure in the first
revision came from a synthetic single cell. Recompute it from the real 2-minute
series for every case we have one for, so the document can lead with the
measured number and label the synthetic one as synthetic.

Item 3: Charleston's hourly gauge-corrected / radar-only ratio swings 0.24 ->
3.9 between consecutive hours and Norfolk shows 0.009. The reviewer reads that
as a timing offset rather than real bias. Two tests:

  (a) stability vs aggregation window -- if the swing is redistribution in time,
      the ratio's spread collapses as the accumulation window lengthens while
      the central value stays put;
  (b) lagged cross-correlation of the two hourly series -- a genuine timing
      offset peaks at a non-zero lag.

Then the sensitivity run the reviewer asked for: hourly-K bias correction
against a single event-level K, and what each does to the hyetograph.
"""
import json, os, sys
import numpy as np

OUT = os.environ.get("OUTDIR", "out")


def load(name):
    with open(os.path.join(OUT, name)) as f:
        return json.load(f)


def rolling_peak(series, minutes):
    """Peak box-mean rate over a centred rolling window of `minutes`, mm/h."""
    r = np.array([s["mean"] for s in series], dtype=float)
    k = max(1, int(round(minutes / 2.0)))          # frames per window at 2 min
    if k > len(r):
        return None
    c = np.convolve(r, np.ones(k) / k, mode="valid")
    return float(c.max())


# ---------------------------------------------------------------- item 4
def item4():
    cases = [
        ("Ellicott City 2016", "measured_ec2016.json",
         "ellicott_city_2016_rate", "ellicott_city_2016_hourly"),
        ("Harvey / Brays Bayou 2017", "measured_harvey_rate.json",
         "harvey_brays_rate", None),
        ("Ida / Philadelphia 2021", "measured_ida.json",
         "ida_philadelphia_rate", "ida_philadelphia_hourly"),
    ]
    rows = []
    for label, fn, rk, hk in cases:
        try:
            d = load(fn)
        except FileNotFoundError:
            continue
        rate = d[rk]
        s = rate["rate_series"]
        peaks = {f"peak_{m}min_box_mean_mm_h": rolling_peak(s, m)
                 for m in (2, 10, 30, 60)}
        row = {"case": label, "frames": len(s),
               "window": rate["window"],
               **{k: (round(v, 2) if v else v) for k, v in peaks.items()},
               "peak_pixel_2min_mm_h": rate["peak_pixel_rate_mm_h"]}
        # The hourly product's own peak hour, i.e. what hourly forcing would give.
        if hk:
            hrs = [h for h in load(fn)[hk]["hours"] if not h.get("missing")]
            ph = max((h["radar_only_mean_mm"] for h in hrs), default=None)
            row["peak_hour_radar_only_mm_h"] = ph
        else:
            row["peak_hour_radar_only_mm_h"] = peaks["peak_60min_box_mean_mm_h"]
            row["peak_hour_source"] = "60-min rolling mean of the 2-min series (no hourly pull for this case)"
        p2 = peaks["peak_2min_box_mean_mm_h"]
        p10 = peaks["peak_10min_box_mean_mm_h"]
        ph = row["peak_hour_radar_only_mm_h"]
        if ph:
            row["hourly_forcing_error_vs_2min_pct"] = round(100.0 * (ph - p2) / p2, 1)
            row["hourly_forcing_error_vs_10min_pct"] = round(100.0 * (ph - p10) / p10, 1)
            row["hourly_forcing_error_vs_peak_pixel_pct"] = round(
                100.0 * (ph - row["peak_pixel_2min_mm_h"]) / row["peak_pixel_2min_mm_h"], 1)
        rows.append(row)
    return rows


# ---------------------------------------------------------------- item 3
def hourly_arrays(entry):
    hrs = [h for h in entry["hours"] if not h.get("missing")]
    r = np.array([h["radar_only_mean_mm"] for h in hrs], float)
    g = np.array([h["gauge_adj_mean_mm"] for h in hrs], float)
    t = [h["t"] for h in hrs]
    return t, r, g


def aggregation_stability(r, g, windows=(1, 2, 3, 6, 12)):
    """Ratio spread as a function of accumulation window length."""
    out = []
    for w in windows:
        n = (len(r) // w) * w
        rr = r[:n].reshape(-1, w).sum(axis=1)
        gg = g[:n].reshape(-1, w).sum(axis=1)
        m = rr > 2.0                     # only blocks with real rain
        if m.sum() < 2:
            out.append({"window_h": w, "blocks": int(m.sum())})
            continue
        ratio = gg[m] / rr[m]
        out.append({"window_h": w, "blocks": int(m.sum()),
                    "ratio_min": round(float(ratio.min()), 3),
                    "ratio_max": round(float(ratio.max()), 3),
                    "ratio_median": round(float(np.median(ratio)), 3),
                    "ratio_spread_max_over_min": round(float(ratio.max() / ratio.min()), 2),
                    "log_sd": round(float(np.log(ratio).std()), 3)})
    return out


def lag_correlation(r, g, max_lag=4):
    """Correlation of the two hourly series against integer-hour lag of g."""
    rows = []
    for L in range(-max_lag, max_lag + 1):
        if L >= 0:
            a, b = r[L:], g[:len(g) - L] if L else g
        else:
            a, b = r[:len(r) + L], g[-L:]
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]
        if n < 6 or a.std() == 0 or b.std() == 0:
            continue
        rows.append({"lag_h_of_gauge_product": L,
                     "pearson_r": round(float(np.corrcoef(a, b)[0, 1]), 4)})
    best = max(rows, key=lambda x: x["pearson_r"])
    return {"by_lag": rows, "best_lag_h": best["lag_h_of_gauge_product"],
            "best_r": best["pearson_r"]}


def k_sensitivity(r, g):
    """Arm A: per-hour K. Arm B: one event-level K. What each does to the hyetograph."""
    tot_r, tot_g = r.sum(), g.sum()
    K_event = tot_g / tot_r
    with np.errstate(divide="ignore", invalid="ignore"):
        K_hour = np.where(r > 0.2, g / r, np.nan)
    arm_a = g.copy()                       # per-hour K reproduces the gauge product
    arm_b = r * K_event
    wet = r > 2.0
    return {
        "K_event": round(float(K_event), 3),
        "K_hourly_over_wet_hours": {
            "n": int(np.isfinite(K_hour[wet]).sum()),
            "min": round(float(np.nanmin(K_hour[wet])), 3),
            "max": round(float(np.nanmax(K_hour[wet])), 3),
            "median": round(float(np.nanmedian(K_hour[wet])), 3),
            "spread_max_over_min": round(float(np.nanmax(K_hour[wet]) / max(np.nanmin(K_hour[wet]), 1e-9)), 1),
        },
        "event_total_mm": {"radar_only": round(float(tot_r), 2),
                           "arm_A_hourly_K": round(float(arm_a.sum()), 2),
                           "arm_B_event_K": round(float(arm_b.sum()), 2)},
        "peak_hour_mm": {"radar_only": round(float(r.max()), 2),
                         "arm_A_hourly_K": round(float(arm_a.max()), 2),
                         "arm_B_event_K": round(float(arm_b.max()), 2)},
        "peak_hour_shift_vs_radar": {
            "arm_A_hourly_K_pct": round(100.0 * (arm_a.max() - r.max()) / r.max(), 1),
            "arm_B_event_K_pct": round(100.0 * (arm_b.max() - r.max()) / r.max(), 1)},
        "max_hour_to_hour_K_jump": round(float(np.nanmax(np.abs(np.diff(K_hour[wet])))), 2),
    }


def item3():
    d = load("measured_norfolk.json")
    res = {}
    for key, label in [("matthew_norfolk_hourly", "Matthew / Norfolk"),
                       ("matthew_charleston_hourly", "Matthew / Charleston")]:
        t, r, g = hourly_arrays(d[key])
        res[label] = {
            "hours": len(r),
            "event_ratio_gauge_over_radar": round(float(g.sum() / r.sum()), 3),
            "per_pixel_log_sd_from_census": d[key].get("per_pixel_ratio_log_sd"),
            "aggregation_stability": aggregation_stability(r, g),
            "lag_correlation": lag_correlation(r, g),
            "k_sensitivity": k_sensitivity(r, g),
        }
    # Ellicott City 2016 as the control: a case where the hourly ratio is stable.
    d16 = load("measured_ec2016.json")
    t, r, g = hourly_arrays(d16["ellicott_city_2016_hourly"])
    res["Ellicott City 2016 (control)"] = {
        "hours": len(r),
        "event_ratio_gauge_over_radar": round(float(g.sum() / r.sum()), 3),
        "aggregation_stability": aggregation_stability(r, g),
        "lag_correlation": lag_correlation(r, g),
        "k_sensitivity": k_sensitivity(r, g),
    }
    return res


def main():
    res = {"item4_peak_attenuation_real_data": item4(),
           "item3_bias_timing_vs_magnitude": item3()}
    with open(os.path.join(OUT, "measured_review_followups.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


main()
