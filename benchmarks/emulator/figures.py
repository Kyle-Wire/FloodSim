"""Figures for the emulator cascade on the backyard block: python benchmarks/emulator/figures.py <outDir> <figDir>
Reads cascade.json, map_*.json and sweep.json written by validate.mjs and sweep.mjs. Needs numpy and matplotlib."""
import json, sys, os, glob
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm
out, fd = sys.argv[1:3]; os.makedirs(fd, exist_ok=True)
INK, MUTED, SURF, BLUE, ORANGE, RED = "#1f1f1e", "#6b6b68", "#fcfcfb", "#2a78d6", "#eb6834", "#e34948"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "figure.facecolor": SURF, "axes.facecolor": SURF, "axes.edgecolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED, "axes.labelcolor": INK})
SEQ = LinearSegmentedColormap.from_list("s", ["#fcfcfb", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])
DIV = LinearSegmentedColormap.from_list("d", ["#1c5cab", "#86b6ef", "#f0efec", "#ec8f86", "#c22f2e"])
C = json.load(open(f"{out}/cascade.json")); IN = 0.0254
def clean(ax):
    for sp in ("top", "right"): ax.spines[sp].set_visible(False)

# 1. maps: the worst test point, truth / emulator / error / calibrated 2 sigma
mp = sorted(glob.glob(f"{out}/map_*.json"))
m = max((json.load(open(p)) for p in mp), key=lambda d: np.nanmax(np.abs(np.array(d["emu"], float) - np.array(d["truth"], float))))
nx, ny = m["nx"], m["ny"]; A = lambda k: np.array(m[k], float).reshape(ny, nx)
house = A("house") > 0; lot = A("lot")
fig, axs = plt.subplots(1, 4, figsize=(14, 4.2))
panels = [("Full flood model", A("truth"), SEQ, (0, 0.3)), ("Emulator (3 ms)", A("emu"), SEQ, (0, 0.3)), ("Emulator minus model", A("emu") - A("truth"), DIV, (-0.02, 0.02)), ("Emulator's own ±2σ (calibrated)", A("sd"), SEQ, (0, 0.03))]
for ax, (t, f, cm, (lo, hi)) in zip(axs, panels):
    f = np.ma.masked_where(house | ~np.isfinite(f), f)
    im = ax.imshow(f, origin="lower", cmap=cm, vmin=lo, vmax=hi) if cm is SEQ else ax.imshow(f, origin="lower", cmap=cm, norm=TwoSlopeNorm(0, lo, hi))
    ax.imshow(np.ma.masked_where(~house, house), origin="lower", cmap=LinearSegmentedColormap.from_list("h", ["#3b423e", "#3b423e"]))
    ax.contour(lot == 1, levels=[0.5], colors=[RED], linewidths=1.2, linestyles="--")
    ax.set_title(t, loc="left", fontsize=10, color=INK); ax.set_xticks([]); ax.set_yticks([])
    cb = fig.colorbar(im, ax=ax, shrink=0.75, pad=0.02); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8)
    cb.set_label("m", fontsize=8)
v = m["values"]
fig.suptitle(f"Hardest of 40 unseen settings: {v['ari']:.0f}-yr storm, neighbour fill {v['raise']*100:.0f} cm, French drain {v['french']*100:.0f} %, rain garden {v['garden']*100:.0f} cm deep, barrel {v['barrel']:.0f} L. Worst cell {np.nanmax(np.abs(A('emu')-A('truth')))*100:.1f} cm. Your lot dashed red.", x=0.01, ha="left", fontsize=10, color=INK)
fig.tight_layout(); fig.savefig(f"{fd}/01_maps_hardest.png", dpi=160); plt.close(fig)

# 2. scalars: emulator vs model at the 40 unseen settings
R = C["rows"]
fig, axs = plt.subplots(1, 2, figsize=(11, 4.6))
for ax, (kp, kt, name, scale, unit) in zip(axs, [("wallPred", "wallTrue", "Water against the back wall", 100, "cm"), ("volPred", "volTrue", "Water standing in the back yard", 1, "m³")]):
    x = np.array([r[kt] for r in R]) * scale; y = np.array([r[kp] for r in R]) * scale
    lo, hi = min(x.min(), y.min()), max(x.max(), y.max()); pad = 0.05 * (hi - lo)
    ax.plot([lo - pad, hi + pad], [lo - pad, hi + pad], color=MUTED, lw=1, ls="--")
    ax.scatter(x, y, s=46, color=BLUE, edgecolor=SURF, linewidth=1.5, zorder=3)
    ax.set_xlabel(f"full flood model ({unit})"); ax.set_ylabel(f"emulator ({unit})"); clean(ax)
    ax.set_title(f"{name}\nworst miss {np.abs(y-x).max():.2f} {unit} over 40 unseen settings", loc="left", fontsize=10, color=INK)
fig.tight_layout(); fig.savefig(f"{fd}/02_scalars.png", dpi=160); plt.close(fig)

# 3. does the error estimate know when it is wrong? worst error on the lot vs calibrated 2 sigma
fig, ax = plt.subplots(figsize=(7.2, 4.8))
sd2 = np.array([r["sd2"] for r in R]) * 100; err = np.array([r["err"]["maxAbs"] for r in R]) * 100; solver = np.array([r["route"] == "solver" for r in R])
ax.plot([0, max(sd2.max(), err.max()) * 1.1], [0, max(sd2.max(), err.max()) * 1.1], color=MUTED, lw=1, ls="--")
ax.text(sd2.max() * 0.62, sd2.max() * 0.7, "error = estimate", color=MUTED, fontsize=8, rotation=33)
ax.axvline(C["tol"]["depth"] * 100, color=ORANGE, lw=1.4); ax.text(C["tol"]["depth"] * 100 * 1.02, err.max() * 1.02, "tolerance: beyond it, run the full model", color=INK, fontsize=8)
ax.scatter(sd2[~solver], err[~solver], s=46, color=BLUE, edgecolor=SURF, linewidth=1.5, label="emulator answers", zorder=3)
ax.scatter(sd2[solver], err[solver], s=60, color=ORANGE, marker="D", edgecolor=SURF, linewidth=1.5, label="sent to the full model", zorder=3)
ax.set_xlabel("emulator's calibrated ±2σ, worst cell on your lot (cm)"); ax.set_ylabel("actual worst error on your lot (cm)"); clean(ax)
ax.legend(frameon=False, loc="upper left")
ax.set_title("The error estimate stays above the real error at every unseen setting", loc="left", fontsize=10, color=INK)
fig.tight_layout(); fig.savefig(f"{fd}/03_error_vs_estimate.png", dpi=160); plt.close(fig)

# 4. the homeowner question: how much do the fixes change things? emulator vs paired solver runs
P = C.get("pairs", [])
if P:
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.4))
    for ax, (k, name, sc, unit) in zip(axs, [("wall", "Change in water at the back wall", 100, "cm"), ("vol", "Change in water standing in the yard", 1, "m³")]):
        xs = np.arange(len(P)); s = np.array([p[k]["solver"] for p in P]) * sc; e = np.array([p[k]["emulator"] for p in P]) * sc; eb = np.array([p[k]["sd2"] for p in P]) * sc
        ax.bar(xs - 0.2, s, 0.38, color=MUTED, label="full model (paired runs)"); ax.bar(xs + 0.2, e, 0.38, color=BLUE, label="emulator", yerr=eb, ecolor=INK, capsize=2)
        ax.axhline(0, color=MUTED, lw=0.8); ax.set_xticks(xs); ax.set_xticklabels([p["of"] for p in P], fontsize=8); ax.set_ylabel(unit); clean(ax)
        ax.set_title(f"{name}\nfixes on vs off, same storm; worst miss {np.abs(e-s).max():.2f} {unit}", loc="left", fontsize=10, color=INK)
    axs[0].legend(frameon=False, loc="lower left")
    fig.tight_layout(); fig.savefig(f"{fd}/04_fix_effects.png", dpi=160); plt.close(fig)

# 5. how many full runs does it need? (sweep)
if os.path.exists(f"{out}/sweep.json"):
    S = json.load(open(f"{out}/sweep.json")); ns = sorted({r["n"] for r in S}); tols = sorted({r["tol"] for r in S})
    fig, axs = plt.subplots(1, 2, figsize=(11.5, 4.3)); cols = [BLUE, ORANGE, "#1baf7a"]
    for c, t in zip(cols, tols):
        rr = [next(r for r in S if r["n"] == n and r["tol"] == t) for n in ns]
        axs[0].plot(ns, [100 * r["solverShare"] for r in rr], "-o", color=c, lw=2, ms=6, label=f"tolerance {t*100:.0f} cm")
    axs[0].set_xlabel("full-model runs the emulator trained on"); axs[0].set_ylabel("% of requests sent to the full model"); axs[0].legend(frameon=False); clean(axs[0])
    axs[0].set_title("Fewer requests need the full model as it learns", loc="left", fontsize=10, color=INK)
    rr = [next(r for r in S if r["n"] == n and r["tol"] == tols[-1]) for n in ns]
    axs[1].plot(ns, [100 * r["emuMaxWorst"] for r in rr], "-o", color=MUTED, lw=2, ms=6, label="emulator alone, worst of 40")
    for c, t in zip(cols, tols):
        r2 = [next(r for r in S if r["n"] == n and r["tol"] == t) for n in ns]
        axs[1].plot(ns, [100 * r["cascadeWorst"] if r["solverShare"] < 1 else np.nan for r in r2], "-o", color=c, lw=2, ms=6, label=f"cascade, tolerance {t*100:.0f} cm")
    axs[1].set_xlabel("full-model runs the emulator trained on"); axs[1].set_ylabel("worst error on your lot (cm)"); axs[1].legend(frameon=False, fontsize=8); clean(axs[1])
    axs[1].set_title("Emulator answers that got through (gaps: all sent to the model).\nFrom 40 runs up they stay inside the tolerance; at 24 runs one missed (3.4 cm vs 3)", loc="left", fontsize=10, color=INK)
    fig.tight_layout(); fig.savefig(f"{fd}/05_runs_needed.png", dpi=160); plt.close(fig)
print("ok")
