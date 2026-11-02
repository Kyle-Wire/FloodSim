"""Minimal reader for NCEP MRMS GRIB2 (grid template 0, data template 5.41 = PNG).

Decodes only the rows needed to cover a requested lat/lon window, so a small
catchment window costs a fraction of a full-CONUS decode.
"""
import gzip, io, os, struct, urllib.request, zlib
import numpy as np
import fetch_budget

CACHE = os.environ.get("MRMS_CACHE", ".")


def _u(b):
    n = 0
    for c in b:
        n = (n << 8) | c
    return n


def _s(b):
    v = _u(b)
    hi = 1 << (8 * len(b) - 1)
    return -(v & (hi - 1)) if v & hi else v


def fetch(url, timeout=180):
    name = os.path.join(CACHE, url.rsplit("/", 1)[-1])
    if not os.path.exists(name):
        fetch_budget.check(url)
        req = urllib.request.Request(url, headers={"User-Agent": "floodsim-radar-assessment"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        fetch_budget.charge(url, len(body))
        with open(name + ".part", "wb") as f:
            f.write(body)
        os.replace(name + ".part", name)
    return name


def _sections(raw):
    assert raw[0:4] == b"GRIB"
    out = {}
    p = 16
    while p < len(raw) - 4:
        if raw[p:p+4] == b"7777":
            break
        ln = _u(raw[p:p+4]); num = raw[p+4]
        out.setdefault(num, raw[p:p+ln])
        p += ln
    return out


def _png_rows(idat, width, height, bitdepth, row_lo, row_hi):
    """Unfilter PNG scanlines row_lo..row_hi-1 of a greyscale image."""
    bpp = bitdepth // 8
    stride = width * bpp
    d = zlib.decompress(idat)
    assert len(d) == (stride + 1) * height, (len(d), (stride + 1) * height)
    prev = np.zeros(stride, dtype=np.uint8)
    rows = []
    for j in range(row_hi):
        off = j * (stride + 1)
        ft = d[off]
        cur = np.frombuffer(d, dtype=np.uint8, count=stride, offset=off + 1).copy()
        if ft == 0:
            pass
        elif ft == 2:
            cur += prev
        elif ft == 1:
            for i in range(bpp, stride):
                cur[i] = (int(cur[i]) + int(cur[i - bpp])) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = int(cur[i - bpp]) if i >= bpp else 0
                cur[i] = (int(cur[i]) + ((left + int(prev[i])) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = int(cur[i - bpp]) if i >= bpp else 0
                b = int(prev[i])
                c = int(prev[i - bpp]) if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[i] = (int(cur[i]) + pr) & 0xFF
        else:
            raise ValueError("filter %d" % ft)
        prev = cur
        if j >= row_lo:
            rows.append(cur)
    arr = np.vstack(rows)
    if bpp == 2:
        return (arr[:, 0::2].astype(np.uint32) << 8) | arr[:, 1::2]
    return arr.astype(np.uint32)


def read_window(path, lat_lo, lat_hi, lon_lo, lon_hi):
    """Return (values, lats, lons). values are physical units, NaN where missing."""
    with gzip.open(path, "rb") as f:
        raw = f.read()
    sec = _sections(raw)
    s3, s5, s7 = sec[3], sec[5], sec[7]
    assert _u(s3[12:14]) == 0, "grid template"
    ni, nj = _u(s3[30:34]), _u(s3[34:38])
    la1 = _u(s3[46:50]) / 1e6
    lo1 = _u(s3[50:54]) / 1e6
    di = _u(s3[63:67]) / 1e6
    dj = _u(s3[67:71]) / 1e6
    assert _u(s5[9:11]) == 41, "data template"
    R = struct.unpack(">f", s5[11:15])[0]
    E = _s(s5[15:17]); D = _s(s5[17:19]); nbits = s5[19]

    lons_all = (lo1 + di * np.arange(ni) + 180.0) % 360.0 - 180.0
    lats_all = la1 - dj * np.arange(nj)          # north -> south

    jsel = np.where((lats_all >= lat_lo) & (lats_all <= lat_hi))[0]
    isel = np.where((lons_all >= lon_lo) & (lons_all <= lon_hi))[0]
    assert len(jsel) and len(isel), "window outside grid"

    png = s7[5:]
    assert png[1:4] == b"PNG", png[:8]
    idat = b""
    q = 8
    while q < len(png):
        ln = _u(png[q:q+4]); typ = png[q+4:q+8]
        if typ == b"IDAT":
            idat += png[q+8:q+8+ln]
        elif typ == b"IHDR":
            w = _u(png[q+8:q+12]); h = _u(png[q+12:q+16]); bd = png[q+16]
        elif typ == b"IEND":
            break
        q += 12 + ln
    assert (w, h) == (ni, nj), (w, h, ni, nj)
    assert bd == nbits, (bd, nbits)

    block = _png_rows(idat, w, h, bd, int(jsel[0]), int(jsel[-1]) + 1)
    X = block[:, isel].astype(np.float64)
    vals = (R + X * (2.0 ** E)) / (10.0 ** D)
    return vals, lats_all[jsel], lons_all[isel]
