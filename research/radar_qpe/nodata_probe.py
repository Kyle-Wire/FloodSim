"""Does the no-radar-coverage sentinel survive each route?

Two things are tested over a patch of the MRMS CONUS grid that no WSR-88D can
see (central Canada, ~54 N, inside the 55 N grid edge but far outside radar
coverage):

1. GRIB2 `PrecipRate`: does it actually carry MRMS's -3 "no coverage" code?
   Section 2.4 of the assessment identified this trap from the encoding without
   ever observing one, because every case window was inside coverage.  This is
   gate G2 run somewhere it should fire.

2. IEM's `mrms_a2m` 8-bit raster: index 0 is documented as 0 mm and index 255 as
   "Missing", so the raster has one code for two meanings.  If a no-coverage
   pixel comes back as index 0, the format itself converts a radar outage into a
   dry pixel, and the raster can never be a forcing route.

Chosen at a northern latitude deliberately: the PNG rows are unfiltered from the
top, so a patch near the grid's north edge costs ~110 scanlines instead of 3000.

Writes out/measured_nodata.json.
"""
import gzip, json, os, struct, sys, urllib.request, zlib
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mrms_read as M

UA = {"User-Agent": "floodsim-radar-assessment"}
STAMP = "20160730-220000"
IEM_STAMP = "201607302200"

# Two patches: one with no radar coverage, one over Maryland as a control.
PATCHES = {
    "central_canada_no_coverage": (53.80, 54.20, -100.40, -100.00),
    "maryland_control": (39.20, 39.40, -76.90, -76.70),
}


def png_index_rows(b, row_lo, row_hi):
    """Palette indices for rows row_lo..row_hi-1 of an 8-bit indexed PNG."""
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    p, idat, w, h, bd, ct, plte = 8, b"", None, None, None, None, None
    while p < len(b):
        ln = struct.unpack(">I", b[p:p + 4])[0]
        typ = b[p + 4:p + 8]
        pay = b[p + 8:p + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", pay[:10])
        elif typ == b"PLTE":
            plte = pay
        elif typ == b"IDAT":
            idat += pay
        elif typ == b"IEND":
            break
        p += 12 + ln
    assert (bd, ct) == (8, 3), (bd, ct)
    d = zlib.decompress(idat)
    stride = w
    prev = np.zeros(stride, dtype=np.uint8)
    rows = []
    for j in range(row_hi):
        off = j * (stride + 1)
        ft = d[off]
        cur = np.frombuffer(d, np.uint8, count=stride, offset=off + 1).copy()
        if ft == 0:
            pass
        elif ft == 2:
            cur += prev
        elif ft == 1:
            for i in range(1, stride):
                cur[i] = (int(cur[i]) + int(cur[i - 1])) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = int(cur[i - 1]) if i else 0
                cur[i] = (int(cur[i]) + ((left + int(prev[i])) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = int(cur[i - 1]) if i else 0
                bb = int(prev[i])
                c = int(prev[i - 1]) if i else 0
                pp = a + bb - c
                pa, pb, pc = abs(pp - a), abs(pp - bb), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (bb if pb <= pc else c)
                cur[i] = (int(cur[i]) + pr) & 0xFF
        else:
            raise ValueError(ft)
        prev = cur
        if j >= row_lo:
            rows.append(cur)
    return np.vstack(rows), w, h, plte


def main():
    out = {"grib2": {}, "iem_a2m": {}, "palette": {}}

    grib = M.fetch("https://mtarchive.geol.iastate.edu/2016/07/30/mrms/ncep/"
                   "PrecipRate/PrecipRate_00.00_%s.grib2.gz" % STAMP)
    for name, box in PATCHES.items():
        v, la, lo = M.read_window(grib, *box)
        u, c = np.unique(np.round(v, 1), return_counts=True)
        out["grib2"][name] = {
            "shape": list(v.shape), "min": float(v.min()), "max": float(v.max()),
            "distinct_values": {str(float(a)): int(b) for a, b in zip(u, c)}
            if len(u) <= 12 else "%d distinct" % len(u),
            "pct_negative": round(100.0 * float((v < 0).mean()), 1),
        }

    url = ("https://mesonet.agron.iastate.edu/archive/data/2016/07/30/GIS/mrms/"
           "a2m_%s.png" % IEM_STAMP)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        body = r.read()
    # world file: 0.01 deg, origin -130.0 / 55.0, so row = (55 - lat)/0.01
    lat0, lon0, dd = 55.0, -130.0, 0.01
    need_hi = max(int(round((lat0 - b[0]) / dd)) for b in PATCHES.values()) + 1
    idx, w, h, plte = png_index_rows(body, 0, need_hi)
    for name, box in PATCHES.items():
        j0 = int(round((lat0 - box[1]) / dd))
        j1 = int(round((lat0 - box[0]) / dd))
        i0 = int(round((box[2] - lon0) / dd))
        i1 = int(round((box[3] - lon0) / dd))
        blk = idx[j0:j1, i0:i1]
        u, c = np.unique(blk, return_counts=True)
        out["iem_a2m"][name] = {
            "shape": list(blk.shape),
            "index_counts": {int(a): int(b) for a, b in zip(u, c)}
            if len(u) <= 12 else "%d distinct indices, min %d max %d"
            % (len(u), int(blk.min()), int(blk.max())),
            "pct_index_0": round(100.0 * float((blk == 0).mean()), 1),
            "pct_index_255": round(100.0 * float((blk == 255).mean()), 1),
        }

    cols = [tuple(plte[3 * i:3 * i + 3]) for i in range(len(plte) // 3)]
    out["palette"]["a2m"] = {
        "entries": len(cols), "distinct": len({*cols}),
        "index_0_rgb": list(cols[0]), "index_255_rgb": list(cols[255]),
    }
    out["source"] = {"grib2": grib, "raster": url}
    with open(os.path.join(os.environ["OUTDIR"], "measured_nodata.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps(out, indent=1))


main()
