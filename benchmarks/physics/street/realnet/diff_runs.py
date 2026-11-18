"""Where two filed runs of the same case differ: the maximum water surface cell by cell (grids/max_wse.f32, 1 m),
grouped into patches of cells that moved by more than a threshold, and each scored high-water mark and gauge with
its change and the nearest patch. Read-only: it writes nothing.

Usage: python -I diff_runs.py <run dir A> <run dir B> [--cm 1] [--top 12]
"""
import json, sys
from pathlib import Path
import numpy as np
from pyproj import Transformer
from scipy import ndimage

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = lambda k, d: float(sys.argv[sys.argv.index('--' + k) + 1]) if '--' + k in sys.argv else d
A, B = Path(args[0]), Path(args[1])
thr, top = opt('cm', 1.0) / 100, int(opt('top', 12))


def grid(run, name):
    h = dict(l.split() for l in (run / 'grids' / f'{name}.hdr').read_text().split('\n') if l.strip())
    nx, ny = int(h['ncols']), int(h['nrows'])
    a = np.fromfile(run / 'grids' / f'{name}.f32', dtype='<f4').reshape(ny, nx)
    return a, float(h['xllcorner']), float(h['yllcorner']), float(h['cellsize'])


sa = json.loads((A / 'summary.json').read_text(encoding='utf8'))
sb = json.loads((B / 'summary.json').read_text(encoding='utf8'))
wa, x0, y0, c = grid(A, 'max_wse')
wb, *_ = grid(B, 'max_wse')
ny, nx = wa.shape
to_xy = Transformer.from_crs(4326, sa['grid']['epsg'], always_xy=True)
to_ll = Transformer.from_crs(sa['grid']['epsg'], 4326, always_xy=True)
wetA, wetB = wa > -9000, wb > -9000
d = np.where(wetA & wetB, wb - wa, np.nan)
print(f'A {A.parent.parent.name}/{A.name} ({sa["commit"]})\nB {B.parent.parent.name}/{B.name} ({sb["commit"]})')
print(f'cells wet in both {np.count_nonzero(wetA & wetB):,}; wet in A only {np.count_nonzero(wetA & ~wetB):,}; in B only {np.count_nonzero(wetB & ~wetA):,}')
big = np.abs(np.nan_to_num(d)) > thr
print(f'cells whose maximum level moved more than {thr * 100:.0f} cm: {np.count_nonzero(big):,} '
      f'(raised {np.count_nonzero(np.nan_to_num(d) > thr):,}, lowered {np.count_nonzero(np.nan_to_num(d) < -thr):,})')
lab, n = ndimage.label(ndimage.binary_dilation(big, iterations=3))  # cells within 3 m of each other: one patch
lab = np.where(big, lab, 0)
patches = []
for i, sl in enumerate(ndimage.find_objects(lab), start=1):
    if sl is None: continue
    m = lab[sl] == i; dd = d[sl][m]
    r, q = np.nonzero(m); r = r + sl[0].start; q = q + sl[1].start
    x, y = x0 + (q.mean() + 0.5) * c, y0 + (ny - r.mean() - 0.5) * c
    patches.append(dict(n=int(m.sum()), mean=float(np.mean(dd)), lo=float(np.min(dd)), hi=float(np.max(dd)), x=x, y=y, ll=to_ll.transform(x, y)))
patches.sort(key=lambda p: -p['n'])
print(f'{len(patches)} patches; the largest {top}:')
for p in patches[:top]:
    print(f'  {p["n"]:7,} m²  mean {p["mean"] * 100:+6.1f} cm  ({p["lo"] * 100:+.1f} to {p["hi"] * 100:+.1f})  at {p["ll"][1]:.5f}, {p["ll"][0]:.5f}')


def near(lon, lat):
    x, y = to_xy.transform(lon, lat)
    best = min(patches, key=lambda p: (p['x'] - x) ** 2 + (p['y'] - y) ** 2) if patches else None
    q, r = int((x - x0) / c), int(ny - (y - y0) / c)
    here = d[r, q] if 0 <= r < ny and 0 <= q < nx else np.nan
    return here, best, (((best['x'] - x) ** 2 + (best['y'] - y) ** 2) ** 0.5 if best else None)


# the ground: bed = maximum level − maximum depth where both runs were wet (a change of terrain conditioning shows here;
# a change of exchange rule cannot)
da, *_ = grid(A, 'max_depth'); db, *_ = grid(B, 'max_depth')
bed = np.where(wetA & wetB, (wb - db) - (wa - da), np.nan)
moved = np.abs(np.nan_to_num(bed)) > 0.005
bl, bn = ndimage.label(ndimage.binary_dilation(moved, iterations=3)); bl = np.where(moved, bl, 0)
beds = []
for i, sl in enumerate(ndimage.find_objects(bl), start=1):
    if sl is None: continue
    m = bl[sl] == i; r, q = np.nonzero(m); r = r + sl[0].start; q = q + sl[1].start
    x, y = x0 + (q.mean() + 0.5) * c, y0 + (ny - r.mean() - 0.5) * c
    beds.append(dict(n=int(m.sum()), lo=float(np.nanmin(bed[sl][m])), hi=float(np.nanmax(bed[sl][m])), x=x, y=y, ll=to_ll.transform(x, y), rr=r, qq=q))
beds.sort(key=lambda p: -p['n'])
print(f'ground changed (more than 5 mm) under {np.count_nonzero(moved):,} wet cells, in {len(beds)} patches' + (':' if beds else ''))
for p in beds[:top]:
    print(f'  {p["n"]:7,} m²  {p["lo"] * 100:+.1f} to {p["hi"] * 100:+.1f} cm  at {p["ll"][1]:.5f}, {p["ll"][0]:.5f}')


def ground_dist(lon, lat):
    if not beds: return None
    x, y = to_xy.transform(lon, lat)
    return min(float(np.min(np.hypot(x0 + (p['qq'] + 0.5) * c - x, y0 + (ny - p['rr'] - 0.5) * c - y))) for p in beds)


pa = {p['name']: p for p in (sa['validation'].get('hwm') or {}).get('points', [])}
pb = {p['name']: p for p in (sb['validation'].get('hwm') or {}).get('points', [])}
rows = []
for k, p in pa.items():
    q = pb.get(k)
    if not q or not isinstance(p.get('model'), (int, float)) or not isinstance(q.get('model'), (int, float)): continue
    rows.append((k, p, q))
if rows:
    print('marks whose level moved 5 mm or more (model level B − A; nearest patch):')
    for k, p, q in rows:
        dm = q['model'] - p['model']
        if abs(dm) < 0.005: continue
        here, best, dist = near(p['lon'], p['lat'])
        gd = ground_dist(p['lon'], p['lat'])
        print((f'  {k:24s} {dm * 100:+5.1f} cm   patch {best["n"]:,} m² mean {best["mean"] * 100:+.1f} cm, {dist:.0f} m away' if best else f'  {k} {dm * 100:+.1f} cm')
              + (f'; nearest changed ground {gd:,.0f} m' if gd is not None else '; no ground changed'))
for ga in sa['validation'].get('gauges') or []:
    gb = next((g for g in sb['validation'].get('gauges') or [] if g['site'] == ga['site']), None)
    if not (ga.get('score') and gb and gb.get('score')): continue
    va, vb = ga['score']['model']['v'], gb['score']['model']['v']
    # the level series filed with the gauge (about one sample a minute), and its 10-minute running mean
    def smooth(g):
        pts = [p for p in g['model'] if p[0] is not None and p[1] is not None]
        t, v = np.array([p[0] for p in pts]) / 1e3, np.array([p[1] for p in pts])
        return max(np.mean(v[(t >= s - 300) & (t <= s + 300)]) for s in t)
    sa_, sb_ = smooth(ga), smooth(gb)
    gx = sa.get('site')
    print(f'gauge {ga["site"]}: peak {va:.3f} → {vb:.3f} m ({(vb - va) * 100:+.1f} cm); 10-min mean peak {sa_:.3f} → {sb_:.3f} m ({(sb_ - sa_) * 100:+.1f} cm)'
          + (f'; nearest changed ground {ground_dist(*gx):,.0f} m from the site point' if gx and beds else ''))
for la in sa.get('controlLines') or []:
    lb = next((l for l in sb.get('controlLines') or [] if l['id'] == la['id']), None)
    if lb: print(f'control line {la["name"][:50]}: peak {la["peak"]:.3f} → {lb["peak"]:.3f} m³/s ({(lb["peak"] / la["peak"] - 1) * 100:+.1f} %), '
                  f'volume {la["volume"]:,.0f} → {lb["volume"]:,.0f} m³ ({(lb["volume"] / la["volume"] - 1) * 100:+.2f} %)')
