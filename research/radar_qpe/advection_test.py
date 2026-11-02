"""Advection-correction acceptance test for radar rainfall forcing (SPA-93).

A translating Gaussian rain cell on a 1 km grid is sampled at a chosen frame
cadence and reconstructed at the model forcing step three ways:

  HOLD  piecewise-constant: hold each frame until the next one arrives
  LIN   linear blend of the two bracketing frames, interpolated *in place*
  ADV   semi-Lagrangian: forward-advect frame k and backward-advect frame k+1
        to the target time along an estimated motion vector, then blend

Truth is the analytic field, so every error below is exact, not relative to a
reference implementation.  The integrator is checked against the closed-form
accumulation on the track line,  A = R0 * sigma * sqrt(2 pi) / V.

The test answers four separate questions, because they have different answers:

  Q1  does advection correction change catchment accumulation and peak
      catchment-average intensity, given 2-minute rate frames?
  Q2  does it change the instantaneous field -- peak rate and placement?
  Q3  does the native cadence of the forcing product matter?
  Q4  how accurate must the motion estimate be to deliver Q2?

HOLD and LIN are the controls.  A test that the controls also pass has no
power over the thing it claims to test, so control errors are always reported
next to ADV's.

Requires numpy.  Run:  python advection_test.py [--json]
"""
import json, math, sys
import numpy as np

DX = 1.0            # km, radar pixel
DT_FORCE = 5.0      # s, model forcing step
R0 = 100.0          # mm/h peak rate
XMIN, XMAX = -40.0, 110.0
YMIN, YMAX = -20.0, 20.0
X0 = -25.0          # cell starts here
CATCH_CENTRE = 40.0


def grid():
    x = np.arange(XMIN, XMAX + DX, DX)
    y = np.arange(YMIN, YMAX + DX, DX)
    return x, y, *np.meshgrid(x, y, indexing="xy")


X_AX, Y_AX, XG, YG = grid()


def cell(t, sigma, u, v):
    cx, cy = X0 + u * t / 1000.0, v * t / 1000.0
    return R0 * np.exp(-((XG - cx) ** 2 + (YG - cy) ** 2) / (2.0 * sigma ** 2))


def shift(F, dx_km, dy_km):
    """Bilinear sample of F at (x - dx, y - dy); zero outside the grid."""
    ny, nx = F.shape
    gx, gy = -dx_km / DX, -dy_km / DX
    i0, j0 = math.floor(gx), math.floor(gy)
    fx, fy = gx - i0, gy - j0
    out = np.zeros_like(F)
    for di, dj, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                      (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        if w == 0.0:
            continue
        si, sj = i0 + di, j0 + dj
        # out[i] = F[i + si]
        out[max(0, -sj):min(ny, ny - sj), max(0, -si):min(nx, nx - si)] += \
            w * F[max(0, sj):min(ny, ny + sj), max(0, si):min(nx, nx + si)]
    return out


def _cr(f):
    """Catmull-Rom cubic convolution weights for offset f in [0,1)."""
    return (-0.5 * f ** 3 + f ** 2 - 0.5 * f,
            1.5 * f ** 3 - 2.5 * f ** 2 + 1.0,
            -1.5 * f ** 3 + 2.0 * f ** 2 + 0.5 * f,
            0.5 * f ** 3 - 0.5 * f ** 2)


def shift_cubic(F, dx_km, dy_km):
    """Separable Catmull-Rom sample of F at (x - dx, y - dy); zero outside."""
    ny, nx = F.shape
    gx, gy = -dx_km / DX, -dy_km / DX
    i0, j0 = math.floor(gx), math.floor(gy)
    wx = _cr(gx - i0)
    wy = _cr(gy - j0)
    out = np.zeros_like(F)
    for a in range(4):
        for b in range(4):
            w = wy[b] * wx[a]
            if w == 0.0:
                continue
            si, sj = i0 + a - 1, j0 + b - 1
            out[max(0, -sj):min(ny, ny - sj), max(0, -si):min(nx, nx - si)] += \
                w * F[max(0, sj):min(ny, ny + sj), max(0, si):min(nx, nx + si)]
    return np.maximum(out, 0.0)


def catchment_mask(side_km):
    jc = np.abs(Y_AX) <= side_km / 2.0
    ic = np.abs(X_AX - CATCH_CENTRE) <= side_km / 2.0
    return np.outer(jc, ic)


M_SMALL = catchment_mask(1.0)     # ~1 km^2
M_MED = catchment_mask(3.0)       # ~9 km^2, Tiber Branch scale
M_BIG = catchment_mask(9.0)       # ~81 km^2


def run(sigma=1.5, speed=15.0, bearing=0.0, dt_frame=120.0,
        est_speed=None, est_bearing=None, accum_product=False):
    """accum_product=True models a product that reports the mean rate over the
    preceding dt_frame (RadarOnly_QPE_15M, *_01H) rather than a snapshot rate."""
    th = math.radians(bearing)
    u, v = speed * math.cos(th), speed * math.sin(th)
    es = speed if est_speed is None else est_speed
    eb = bearing if est_bearing is None else est_bearing
    eth = math.radians(eb)
    eu, ev = es * math.cos(eth), es * math.sin(eth)

    t_end = (XMAX - X0 + 30.0) * 1000.0 / speed
    nfr = int(t_end // dt_frame) + 2

    if accum_product:
        sub = max(1, int(dt_frame / 20.0))
        frames = []
        for k in range(nfr + 1):
            acc = np.zeros_like(XG)
            for m in range(sub):
                acc += cell(k * dt_frame - dt_frame * (m + 0.5) / sub, sigma, u, v)
            frames.append(acc / sub)
    else:
        frames = [cell(k * dt_frame, sigma, u, v) for k in range(nfr + 1)]

    names = ("TRUTH", "HOLD", "LIN", "ADV", "ADV3")
    acc = {n: np.zeros_like(XG) for n in names}
    cmz = {n: {"s": [], "m": [], "b": []} for n in names}
    pkr = {n: 0.0 for n in names}
    fld_sse = {n: 0.0 for n in names}
    fld_n = 0
    cx_err = {n: 0.0 for n in names}
    cx_n = 0
    mid = {n: {"sse": 0.0, "pk": 0.0, "argmax": 0.0, "n": 0} for n in names}

    nsteps = int((nfr - 1) * dt_frame / DT_FORCE)
    for s in range(nsteps):
        t = s * DT_FORCE
        k = int(t // dt_frame)
        w = (t - k * dt_frame) / dt_frame
        f0, f1 = frames[k], frames[k + 1]
        dt0 = t - k * dt_frame
        dt1 = (k + 1) * dt_frame - t
        F = {
            "TRUTH": cell(t, sigma, u, v),
            "HOLD": f0,
            "LIN": (1 - w) * f0 + w * f1,
            "ADV": ((1 - w) * shift(f0, eu * dt0 / 1000.0, ev * dt0 / 1000.0)
                    + w * shift(f1, -eu * dt1 / 1000.0, -ev * dt1 / 1000.0)),
            "ADV3": ((1 - w) * shift_cubic(f0, eu * dt0 / 1000.0, ev * dt0 / 1000.0)
                     + w * shift_cubic(f1, -eu * dt1 / 1000.0, -ev * dt1 / 1000.0)),
        }
        if F["TRUTH"].max() > 1.0 and abs(w - 0.5) < DT_FORCE / dt_frame:
            tt0 = F["TRUTH"]
            ta = int(np.argmax(tt0))
            for n in names:
                mid[n]["sse"] += float(np.mean((F[n] - tt0) ** 2))
                mid[n]["pk"] += float(F[n].max()) / float(tt0.max())
                na = int(np.argmax(F[n]))
                mid[n]["argmax"] += math.hypot(
                    (na % tt0.shape[1] - ta % tt0.shape[1]) * DX,
                    (na // tt0.shape[1] - ta // tt0.shape[1]) * DX)
                mid[n]["n"] += 1
        for n in names:
            acc[n] += F[n] * (DT_FORCE / 3600.0)
            cmz[n]["s"].append(float(F[n][M_SMALL].mean()))
            cmz[n]["m"].append(float(F[n][M_MED].mean()))
            cmz[n]["b"].append(float(F[n][M_BIG].mean()))
            pkr[n] = max(pkr[n], float(F[n].max()))
        tt = F["TRUTH"]
        if tt.max() > 1.0:
            fld_n += 1
            wsum = tt.sum()
            cxt = float((XG * tt).sum() / wsum)
            for n in names:
                fld_sse[n] += float(np.mean((F[n] - tt) ** 2))
                ws = F[n].sum()
                if ws > 0:
                    cx_err[n] += abs(float((XG * F[n]).sum() / ws) - cxt)
            cx_n += 1

    def win(c, secs):
        k = max(1, int(secs / DT_FORCE))
        return float(np.convolve(np.asarray(c), np.ones(k) / k, mode="valid").max())

    res = {"sigma_km": sigma, "speed_m_s": speed, "bearing_deg": bearing,
           "dt_frame_s": dt_frame, "accum_product": accum_product,
           "est_speed_m_s": es, "est_bearing_deg": eb,
           "frame_displacement_km": round(speed * dt_frame / 1000.0, 2),
           "pulse_sigma_s": round(sigma * 1000.0 / speed, 1),
           "analytic_track_accum_mm": round(R0 * sigma * math.sqrt(2 * math.pi) / (speed * 3.6), 4)}
    for n in names:
        res[n] = {
            "peak_pixel_accum_mm": round(float(acc[n].max()), 4),
            "catch9_accum_mm": round(float(acc[n][M_MED].mean()), 4),
            "peak_pixel_rate_mm_h": round(pkr[n], 2),
            "peak_catch1_2min_mm_h": round(win(cmz[n]["s"], 120), 2),
            "peak_catch9_2min_mm_h": round(win(cmz[n]["m"], 120), 2),
            "peak_catch9_10min_mm_h": round(win(cmz[n]["m"], 600), 2),
            "peak_catch81_30min_mm_h": round(win(cmz[n]["b"], 1800), 2),
            "domain_total_mm_km2": round(float(acc[n].sum()) * DX * DX, 2),
            "field_rmse_mm_h": round(math.sqrt(fld_sse[n] / max(1, fld_n)), 3),
            "centroid_abs_err_km": round(cx_err[n] / max(1, cx_n), 3),
            "midframe_field_rmse_mm_h": round(math.sqrt(mid[n]["sse"] / max(1, mid[n]["n"])), 3),
            "midframe_peak_ratio": round(mid[n]["pk"] / max(1, mid[n]["n"]), 4),
            "midframe_argmax_err_km": round(mid[n]["argmax"] / max(1, mid[n]["n"]), 3),
        }
    for n in ("HOLD", "LIN", "ADV", "ADV3"):
        res[n + "_err_pct"] = {}
        for k2, tv in res["TRUTH"].items():
            res[n + "_err_pct"][k2] = (None if tv == 0 else
                                       round(100.0 * (res[n][k2] - tv) / tv, 2))
    return res


COLS = [("peak_pixel_accum_mm", "pk acc"),
        ("catch9_accum_mm", "9km2 acc"),
        ("peak_catch9_10min_mm_h", "9km2 10min"),
        ("peak_catch1_2min_mm_h", "1km2 2min"),
        ("peak_pixel_rate_mm_h", "inst pk rate")]


def table(title, rows, note=""):
    print("\n== " + title)
    if note:
        print("   " + note)
    head = "%-30s" % "case"
    for _, lbl in COLS:
        head += " | %s" % lbl.center(31)
    print(head)
    print("%-30s" % "" + ("".join(" | %7s %7s %7s %7s" % ("HOLD%", "LIN%", "ADV%", "ADV3%")
                                  for _ in COLS)))
    for r in rows:
        line = "%-30s" % r["_lbl"]
        for key, _ in COLS:
            line += " | %7.1f %7.1f %7.1f %7.1f" % (
                r["HOLD_err_pct"][key], r["LIN_err_pct"][key],
                r["ADV_err_pct"][key], r["ADV3_err_pct"][key])
        print(line)


def selftest():
    """Guards on the resampler itself.  A sign error here silently makes the
    advected field worse than no correction at all, which is how this test was
    first written."""
    ok = True
    F = np.zeros_like(XG); F[10, 20] = 1.0
    for fn, nm in ((shift, "bilinear"), (shift_cubic, "cubic")):
        G = fn(F, 3.0, 2.0)                       # move content +3 km in x, +2 in y
        j, i = np.unravel_index(int(np.argmax(G)), G.shape)
        good = (i == 23 and j == 12)
        ok &= good
        print("  %-9s integer shift (+3,+2) -> (%d,%d) expected (23,12)  %s"
              % (nm, i, j, "PASS" if good else "FAIL"))
    ramp = XG.copy()
    G = shift(ramp, 0.5, 0.0)[5:-5, 5:-5]
    err = float(np.abs(G - (ramp - 0.5)[5:-5, 5:-5]).max())
    print("  bilinear is exact on a linear ramp: max err %.2e  %s"
          % (err, "PASS" if err < 1e-9 else "FAIL"))
    ok &= err < 1e-9
    # one-frame-ahead residual: advect frame k by the full frame interval and
    # compare against the observed frame k+1.  This is the test that works on
    # real data, where there is no truth field.
    print("  one-frame-ahead residual (the real-data test), V=15 m/s, dt=2 min:")
    for sg in (0.75, 1.5, 3.0):
        f0 = cell(0.0, sg, 15.0, 0.0)
        f1 = cell(120.0, sg, 15.0, 0.0)
        for fn, nm in ((shift, "bilinear"), (shift_cubic, "cubic")):
            p = fn(f0, 15.0 * 120.0 / 1000.0, 0.0)
            rm = float(np.sqrt(np.mean((p - f1) ** 2)))
            nrm = 100.0 * rm / float(f1.max())
            print("    sigma=%.2f km  %-9s RMSE %7.3f mm/h  (%.2f %% of peak)"
                  % (sg, nm, rm, nrm))
    return ok


def main():
    out = {}
    print("== Resampler self-test")
    selftest()

    out["q1_cell_size"] = []
    for sg in (0.75, 1.0, 1.5, 2.0, 3.0, 5.0):
        r = run(sigma=sg); r["_lbl"] = "sigma=%.2f km, V=15, dt=2min" % sg
        out["q1_cell_size"].append(r)

    out["q1_speed"] = []
    for sp in (5.0, 10.0, 15.0, 20.0, 25.0):
        r = run(speed=sp); r["_lbl"] = "V=%.0f m/s (d=%.1f km), sig=1.5" % (sp, sp * 0.12)
        out["q1_speed"].append(r)

    out["q3_cadence"] = []
    for dt, ap in ((120.0, False), (300.0, False), (300.0, True),
                   (900.0, True), (3600.0, True)):
        r = run(sigma=1.5, dt_frame=dt, accum_product=ap)
        r["_lbl"] = "cadence %.0f min%s" % (dt / 60.0, " (accum)" if ap else " (rate)")
        out["q3_cadence"].append(r)

    out["q4_motion_error"] = []
    for es, eb in ((15.0, 0.0), (16.5, 0.0), (18.0, 0.0), (22.5, 0.0), (12.0, 0.0),
                   (15.0, 5.0), (15.0, 10.0), (15.0, 20.0), (15.0, 45.0)):
        r = run(est_speed=es, est_bearing=eb)
        r["_lbl"] = "est V=%.1f m/s, bearing %+.0f deg" % (es, eb)
        out["q4_motion_error"].append(r)

    if "--json" in sys.argv:
        print(json.dumps(out, indent=1))
        return

    print("== Integrator check (analytic vs simulated TRUTH peak-pixel accumulation)")
    print("%-34s %12s %12s %8s" % ("case", "analytic mm", "simulated", "diff %"))
    for r in out["q1_cell_size"] + out["q1_speed"]:
        a, s = r["analytic_track_accum_mm"], r["TRUTH"]["peak_pixel_accum_mm"]
        print("%-34s %12.4f %12.4f %8.3f" % (r["_lbl"], a, s, 100 * (s - a) / a))

    table("Q1  accumulation and catchment intensity, 2-minute rate frames",
          out["q1_cell_size"], "signed error vs analytic truth, per cent")
    table("Q1  same, speed sweep", out["q1_speed"])
    table("Q3  cadence of the forcing product", out["q3_cadence"],
          "'accum' = product reports the mean rate over the preceding interval")
    table("Q4  sensitivity of ADV to motion-estimate error (truth V=15, bearing 0)",
          out["q4_motion_error"])

    print("\n== Q2  instantaneous field at the mid-frame instant (the worst case),")
    print("      2-minute frames, V 15 m/s.  peak ratio = reconstructed/true peak;")
    print("      argmax err = distance from the true field maximum to the reconstructed one.")
    print("%-10s %-6s %15s %13s %15s %14s" % ("sigma km", "method", "midframe RMSE",
                                              "peak ratio", "argmax err km", "time-avg RMSE"))
    for r in out["q1_cell_size"]:
        for n in ("HOLD", "LIN", "ADV", "ADV3"):
            print("%-10.2f %-6s %15.3f %13.4f %15.3f %14.3f" % (
                r["sigma_km"], n, r[n]["midframe_field_rmse_mm_h"],
                r[n]["midframe_peak_ratio"], r[n]["midframe_argmax_err_km"],
                r[n]["field_rmse_mm_h"]))


main()
