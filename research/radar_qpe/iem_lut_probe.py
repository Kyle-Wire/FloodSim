"""Pull IEM's documented index -> physical value lookup for its MRMS rasters.

The display-layer decision for the three pre-v12 cases rests on what IEM's
8-bit raster can represent, and the legend may only quote a dBZ number if the
index semantics are sourced rather than assumed.  IEM documents them at
GIS/rasters.php?rid=N; this enumerates the rids and records each table.

Writes out/measured_iem_lut.json.
"""
import html, json, os, re, urllib.error, urllib.request

UA = {"User-Agent": "floodsim-radar-assessment"}
ROW = re.compile(
    r"<tr[^>]*>\s*<td[^>]*>\s*(\d+)\s*</td>\s*<td[^>]*>(.*?)</td>", re.S | re.I)
TITLE = re.compile(r"<h3[^>]*>(.*?)</h3>|<title[^>]*>(.*?)</title>", re.S | re.I)


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s)).strip()


def table(body):
    out = {}
    for idx, val in ROW.findall(body):
        v = strip(val)
        if idx not in out:
            out[int(idx)] = v
    return out


def main():
    res = {}
    for rid in range(1, 13):
        url = "https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=%d" % rid
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(url, headers=UA), timeout=120) as r:
                body = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            res[rid] = {"url": url, "status": e.code}
            continue
        m = TITLE.search(body)
        t = strip(m.group(1) or m.group(2)) if m else None
        lut = table(body)
        ks = sorted(lut)
        # step between consecutive numeric entries, to see whether it is uniform
        steps = set()
        nums = {}
        for k in ks:
            try:
                nums[k] = float(re.sub(r"[^0-9.\-]", "", lut[k]) or "nan")
            except ValueError:
                pass
        for a, b in zip(ks, ks[1:]):
            if a in nums and b in nums and b == a + 1:
                d = round(nums[b] - nums[a], 4)
                if d == d:
                    steps.add(d)
        res[rid] = {
            "url": url, "title": t, "n_rows": len(lut),
            "first_6": {k: lut[k] for k in ks[:6]},
            "last_6": {k: lut[k] for k in ks[-6:]},
            "distinct_consecutive_steps": sorted(steps)[:12],
            "n_distinct_steps": len(steps),
        }
        print(rid, t, "rows=%d" % len(lut), "steps=%s" % sorted(steps)[:6], flush=True)

    with open(os.path.join(os.environ["OUTDIR"], "measured_iem_lut.json"), "w") as f:
        json.dump(res, f, indent=1)


main()
