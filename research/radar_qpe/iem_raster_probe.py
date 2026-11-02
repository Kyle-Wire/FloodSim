"""What is actually in IEM's MRMS reflectivity raster, and what may its legend claim?

SPA-94 reports that IEM's `mrms_lcref` raster is present for 2016-07-30 and is a
candidate dBZ display layer for the three pre-v12 cases, for which
`MergedReflectivityQCComposite` is not in the archive at all.  Before specifying
it as the display source I need its quantisation and its index semantics, because
those are what the legend is allowed to claim.

Probes candidate URLs, then parses the PNG header, palette and transparency
chunks directly (no image library, no credentials).

Writes out/measured_iem_raster.json.
"""
import json, os, struct, urllib.error, urllib.request
from collections import OrderedDict

UA = {"User-Agent": "floodsim-radar-assessment"}
STAMP = "201607302200"
DAY = "2016/07/30"

CANDIDATES = OrderedDict([
    ("lcref_gis_archive", f"https://mesonet.agron.iastate.edu/archive/data/{DAY}/GIS/mrms/lcref_{STAMP}.png"),
    ("lcref_wld", f"https://mesonet.agron.iastate.edu/archive/data/{DAY}/GIS/mrms/lcref_{STAMP}.wld"),
    ("a2m_gis_archive", f"https://mesonet.agron.iastate.edu/archive/data/{DAY}/GIS/mrms/a2m_{STAMP}.png"),
    ("a2m_wld", f"https://mesonet.agron.iastate.edu/archive/data/{DAY}/GIS/mrms/a2m_{STAMP}.wld"),
    ("p24h_gis_archive", f"https://mesonet.agron.iastate.edu/archive/data/{DAY}/GIS/mrms/p24h_{STAMP}.png"),
])


def get(url, head=False):
    req = urllib.request.Request(url, headers=UA, method="HEAD" if head else "GET")
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status, dict(r.headers), (b"" if head else r.read())


def chunks(b):
    assert b[:8] == b"\x89PNG\r\n\x1a\n", b[:8]
    p, out = 8, []
    while p < len(b):
        ln = struct.unpack(">I", b[p:p + 4])[0]
        typ = b[p + 4:p + 8]
        out.append((typ.decode("ascii", "replace"), b[p + 8:p + 8 + ln]))
        p += 12 + ln
        if typ == b"IEND":
            break
    return out


def describe_png(b):
    cs = chunks(b)
    d = {"bytes": len(b), "chunks": [t for t, _ in cs]}
    for t, payload in cs:
        if t == "IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", payload[:13])
            d.update(width=w, height=h, bit_depth=bd, colour_type=ct, interlace=il,
                     colour_type_name={0: "greyscale", 2: "truecolour", 3: "indexed",
                                       4: "grey+alpha", 6: "truecolour+alpha"}.get(ct, "?"))
        elif t == "PLTE":
            n = len(payload) // 3
            d["palette_entries"] = n
            d["palette_first_8"] = [list(payload[3 * i:3 * i + 3]) for i in range(min(8, n))]
            d["palette_last_8"] = [list(payload[3 * i:3 * i + 3]) for i in range(max(0, n - 8), n)]
            # how many palette entries are actually distinct colours?
            cols = {tuple(payload[3 * i:3 * i + 3]) for i in range(n)}
            d["palette_distinct_colours"] = len(cols)
        elif t == "tRNS":
            d["trns_len"] = len(payload)
            d["trns_zero_alpha_indices"] = [i for i, a in enumerate(payload) if a == 0]
    for t, payload in cs:
        if t == "PLTE":
            d["ramp"] = ramp(payload)
    return d


def ramp(payload):
    """Where the colour ramp is flat: consecutive indices sharing one colour.

    The index carries the documented physical step (0.5 dBZ for lcref), but a
    reader that inverts the *rendered colour* instead of taking the palette
    index can only recover the value where the ramp is injective.  This is the
    difference between what the file encodes and what a legend may claim is
    visually distinguishable.
    """
    cols = [tuple(payload[3 * i:3 * i + 3]) for i in range(len(payload) // 3)]
    runs, cur = [], 1
    for a, b in zip(cols, cols[1:]):
        if a == b:
            cur += 1
        else:
            runs.append(cur); cur = 1
    runs.append(cur)
    black = [i for i, c in enumerate(cols) if c == (0, 0, 0)]
    return {"longest_flat_run_indices": max(runs),
            "n_flat_segments_longer_than_1": sum(1 for r in runs if r > 1),
            "n_black_indices": len(black),
            "black_index_max": (max(black) if black else None),
            "distinct_colours_above_black": len({*cols[(max(black) + 1) if black else 0:255]})}


def main():
    res = {"probed": {}}
    for name, url in CANDIDATES.items():
        try:
            st, hdr, body = get(url)
            rec = {"url": url, "status": st,
                   "content_type": hdr.get("Content-Type"),
                   "content_length": hdr.get("Content-Length"),
                   "last_modified": hdr.get("Last-Modified")}
            if url.endswith(".png"):
                rec["png"] = describe_png(body)
            else:
                rec["body"] = body.decode("ascii", "replace").strip().splitlines()
            res["probed"][name] = rec
            print(name, "OK", rec.get("content_length"), flush=True)
        except urllib.error.HTTPError as e:
            res["probed"][name] = {"url": url, "status": e.code, "error": str(e)}
            print(name, "HTTP", e.code, flush=True)
        except Exception as e:
            res["probed"][name] = {"url": url, "error": repr(e)}
            print(name, "ERR", repr(e), flush=True)

    with open(os.path.join(os.environ["OUTDIR"], "measured_iem_raster.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res, indent=1))


main()
