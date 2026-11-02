"""Beam geometry for the SPA-93 radar coverage assessment. Pure stdlib.

Range/azimuth on a spherical earth; beam height under the standard 4/3
effective-earth refraction model,

    h(r, th) = sqrt(r^2 + (k a)^2 + 2 r (k a) sin th) - k a + h_feed

with k a = 4/3 * 6371 km.  The 4/3 model assumes a standard atmosphere; a
nocturnal surface inversion super-refracts and lowers the beam, and a dry
elevated layer sub-refracts and raises it, so treat these as nominal.
"""
import json, math, sys

A_E = 4.0 / 3.0 * 6371.0        # km, effective earth radius
BW = 0.925                      # deg, WSR-88D half-power beamwidth
BW_TDWR = 0.55                  # deg, TDWR beamwidth

# Verified from the NCEI/NWS WSR-88D site coordinate table (NAD83).
# elev_m = ground elevation, tower_m = antenna tower height.
RADARS = {
    "KLWX": dict(name="Sterling VA (Washington/Baltimore)", lat=38.9753, lon=-77.4778, elev_m=82.9, tower_m=25, kind="WSR-88D"),
    "KDIX": dict(name="Mount Holly NJ (Philadelphia)",      lat=39.9469, lon=-74.4108, elev_m=45.4, tower_m=20, kind="WSR-88D"),
    "KAKQ": dict(name="Wakefield VA (Norfolk/Richmond)",    lat=36.9839, lon=-77.0072, elev_m=34.1, tower_m=20, kind="WSR-88D"),
    "KHGX": dict(name="League City TX (Houston/Galveston)", lat=29.4719, lon=-95.0792, elev_m=5.5,  tower_m=20, kind="WSR-88D"),
    "KCLX": dict(name="Grays SC (Charleston)",              lat=32.6556, lon=-81.0422, elev_m=29.6, tower_m=30, kind="WSR-88D"),
    "KDOX": dict(name="Dover AFB DE",                       lat=38.8256, lon=-75.4400, elev_m=15.2, tower_m=9,  kind="WSR-88D"),
    "KCCX": dict(name="State College PA",                   lat=40.9231, lon=-78.0036, elev_m=733.0, tower_m=20, kind="WSR-88D"),
    "KMHX": dict(name="Newport/Morehead City NC",           lat=34.7761, lon=-76.8762, elev_m=9.4,  tower_m=9,  kind="WSR-88D"),
    "KRAX": dict(name="Clayton NC (Raleigh/Durham)",        lat=35.6656, lon=-78.4897, elev_m=106.7, tower_m=20, kind="WSR-88D"),
    "TBWI": dict(name="Baltimore-Washington Intl TDWR",     lat=39.090,  lon=-76.630,  elev_m=90.5, tower_m=20, kind="TDWR"),
    "TPHL": dict(name="Philadelphia TDWR",                  lat=39.949,  lon=-75.069,  elev_m=46.6, tower_m=20, kind="TDWR"),
    "THOU": dict(name="Houston Hobby TDWR",                 lat=29.516,  lon=-95.242,  elev_m=35.7, tower_m=20, kind="TDWR"),
    "TIAH": dict(name="Houston Intercontinental TDWR",      lat=30.065,  lon=-95.567,  elev_m=77.1, tower_m=20, kind="TDWR"),
}

# Catchment centroids and ground elevations for the Phase 1 cases.
SITES = {
    "Ellicott City MD (Tiber/Hudson outlet, Main St)": dict(lat=39.2673, lon=-76.7958, ground_m=110,
        radars=["KLWX", "TBWI", "KDOX", "KCCX"]),
    "Meyerland / Brays Bayou, Houston TX":            dict(lat=29.6800, lon=-95.4600, ground_m=15,
        radars=["KHGX", "THOU", "TIAH"]),
    "Philadelphia PA (Center City / South St)":       dict(lat=39.9430, lon=-75.1600, ground_m=12,
        radars=["KDIX", "TPHL"]),
    "Norfolk VA (Hampton Roads, Sewells Point)":      dict(lat=36.8470, lon=-76.2950, ground_m=3,
        radars=["KAKQ", "KDOX", "KMHX"]),
    "Charleston SC (peninsula, Battery)":             dict(lat=32.7800, lon=-79.9300, ground_m=3,
        radars=["KCLX", "KMHX"]),
}


def great_circle(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    d = math.acos(min(1.0, math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)))
    rng = 6371.0 * d
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return rng, (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def beam_height_km(r_km, elev_deg, feed_km):
    t = math.radians(elev_deg)
    return math.sqrt(r_km ** 2 + A_E ** 2 + 2.0 * r_km * A_E * math.sin(t)) - A_E + feed_km


def rows():
    out = []
    for site, s in SITES.items():
        for rid in s["radars"]:
            R = RADARS[rid]
            rng, az = great_circle(R["lat"], R["lon"], s["lat"], s["lon"])
            feed = (R["elev_m"] + R["tower_m"]) / 1000.0
            bw = BW_TDWR if R["kind"] == "TDWR" else BW
            tilt = 0.5 if R["kind"] == "WSR-88D" else 0.3
            c = beam_height_km(rng, tilt, feed)
            lo = beam_height_km(rng, tilt - bw / 2.0, feed)
            hi = beam_height_km(rng, tilt + bw / 2.0, feed)
            out.append(dict(
                site=site, radar=rid, radar_name=R["name"], kind=R["kind"],
                range_km=round(rng, 1), azimuth_from_radar_deg=round(az, 0),
                lowest_tilt_deg=tilt, beamwidth_deg=bw,
                feedhorn_m_msl=round(feed * 1000.0, 0),
                beam_centre_km_msl=round(c, 2),
                beam_bottom_km_msl=round(lo, 2),
                beam_top_km_msl=round(hi, 2),
                beam_centre_m_above_catchment=round(c * 1000.0 - s["ground_m"], 0),
                beam_bottom_m_above_catchment=round(lo * 1000.0 - s["ground_m"], 0),
                sample_width_km=round(rng * math.radians(bw), 2),
                sample_depth_km=round((hi - lo), 2),
                sample_footprint_km2=round(rng * math.radians(bw) * 0.25, 2),  # 250 m gate
            ))
    return out


if __name__ == "__main__":
    data = rows()
    if "--json" in sys.argv:
        print(json.dumps(data, indent=1))
    else:
        hdr = ("site", "radar", "rng km", "az", "tilt", "beam c km", "beam btm km",
               "c m AGC", "btm m AGC", "width km", "depth km")
        print(("%-46s %-6s %7s %4s %5s %10s %12s %9s %10s %9s %9s") % hdr)
        for r in data:
            print("%-46s %-6s %7.1f %4.0f %5.2f %10.2f %12.2f %9.0f %10.0f %9.2f %9.2f" % (
                r["site"], r["radar"], r["range_km"], r["azimuth_from_radar_deg"],
                r["lowest_tilt_deg"], r["beam_centre_km_msl"], r["beam_bottom_km_msl"],
                r["beam_centre_m_above_catchment"], r["beam_bottom_m_above_catchment"],
                r["sample_width_km"], r["sample_depth_km"]))
