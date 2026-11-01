# Radar rainfall as a field: ingestion, the forcing fingerprint, and the replay view

Status: **design only, nothing built.** Phase 3e.1 and 3e.2 of the FloodSim programme ([SPA-94](/SPA/issues/SPA-94)).
Written against `origin/main` at `c178700`. Every number in § *Measurements* was taken on 2026-11-01 against the live
public archives with the probe scripts listed there; nothing in this document is estimated unless it says so.

The companion document is [SPA-93](/SPA/issues/SPA-93), the Radar Specialist's product and QPE assessment. **They own
whether the rainfall numbers are right; this document owns getting them in, out and on screen.** Every choice that is
theirs appears here as a named parameter with a defined interface and no default value — see § 7.

## Goal

Rainfall today is one number per time step for the whole domain. `src/history.js` fetches IEM Reanalysis precipitation
at a single point, times it inside each hour from one ASOS gauge, and emits a scalar `depth[]`/`intensity[]` with the
same shape as an Atlas 14 design storm (`seriesStorm`, `src/history.js:177`), "so the run loop treats both alike". The
program already drinks from a gauge-corrected radar product and then discards everything that made it radar.

This design makes rainfall a field in space and time, keeps it at radar resolution, and — the part that has to be right
from the first commit — keeps the forcing fingerprint and the bit-identical rerun guarantee intact while doing it.

**How much this matters, measured.** In a 7 × 7 MRMS window over Ellicott City at 2016-07-30 23:52 UTC the rain rate
ran from 18.6 to 148.6 mm/hr — a factor of 8 inside a 7 km × 6 km box, mean 63.6 mm/hr. FloodSim would currently apply
one number to that. The window max over the 90 frames from 21:00 to 23:58 UTC ran from 9.0 to 148.6 mm/hr.

## What this plugs into

| Thing | Where | Why it matters here |
|---|---|---|
| Scalar hyetograph lookup | `rainAt(storm, t) → { mmhr, until }`, `src/storm.js:155` | The one function the run loop asks for rain. `until` already guarantees a step never straddles a block change. |
| The run loop's rain step | `app/map.js:1305-1306` | `s.rainRate = rr.mmhr * MMHR; tEnd = Math.min(tEnd, rr.until)`. The radar field hooks in here and nowhere else. |
| Per-cell rain multiplier | `RF` buffer, `src/solver-gpu.js:53`, kernel `src/kernels.wgsl.js:433` | The rain source is already `P.rain * RF[c] * dt` — a scalar times a per-cell factor. The socket exists. |
| Mid-run field switching | `setRainField`, `src/solver-gpu.js:417`; roof stages, `app/map.js:1295-1303` | Already switches the field on a 10 s quantum. Radar follows the same discipline. |
| Rain book | `vol.rain += rainRate * dt * rainArea`, `src/solver-gpu.js:545` | `rainArea = Σ_c RF_c·dx²`. A spatial field breaks this unless § 4.4 is implemented. |
| Step quantum | `STEP_QUANTUM = 10`, `app/map.js:1283` | "Steps are cut only at multiples of 10 s of simulated time and at the storm's own stop times, never at a wall-clock time." Frame boundaries are storm stop times. |
| Forcing fingerprint | `FORCING_PARTS`, `fingerprint`, `comparable`, `src/compare.js:36-65` | 12 parts, hashed with FNV-1a over a stable stringify. |
| Run archive | `runFiles()`, `app/map.js:2478-2520`; `summary.json` `files` manifest | Where the snapshot goes. |
| Proxy allowlist + disk cache | `ALLOW`, `proxy()`, `server/server.mjs:19-89` | 21 hosts, https only, `x-floodsim` header required, sha1-keyed disk cache. |
| Overlay layer order | `setCanvasLayer`, `app/map.js:276`; depth overlay inserted before `area-line`, `app/map.js:626` | The radar layer inserts before `ov-depth`, which puts it underneath. |
| Depth colour ramp | `RAMPS.depth`, `app/map.js:1766` | `#beecff → #60bce8 → #1f78c4 → #1540a0 → #28146e`. The ramp radar must not collide with. |

Nothing in `src/solver-gpu.js`'s flux scheme, time stepping, limiter or boundary conditions changes. One source term
changes form; see § 4.3 and the approval item in § 8.

---

## 1. Ingestion

### 1.1 Sources, and the archive window is not what the plan assumes

Three routes reach MRMS. All were probed on 2026-11-01; the windows below are measured, not quoted.

| Route | Host | Format | Window (measured) | Fidelity |
|---|---|---|---|---|
| **NODD** | `noaa-mrms-pds.s3.amazonaws.com` | GRIB2, 16-bit, §5 template 41 | **2020-10-14 → today** | native: 0.1 mm/hr steps, no ceiling |
| **mtarchive** | `mtarchive.geol.iastate.edu` | the same GRIB2 bytes | **≤ 2015-01-01 → today** | native |
| **IEM raster** | `mesonet.agron.iastate.edu` *(already allowlisted)* | 8-bit palette PNG + `.wld` | ≥ 2016 (probed) | **quantised: 0.6 mm/hr steps, ceiling 152.4 mm/hr** |

> **Finding that changes other people's work.** [SPA-93](/SPA/issues/SPA-93) records as established that "the public
> MRMS archive begins 1 November 2014". That is true of the MRMS *system* but **not of the `noaa-mrms-pds` bucket**:
> every CONUS product prefix probed — `PrecipRate_00.00`, `MultiSensor_QPE_01H_Pass2_00.00`, `RadarOnly_QPE_01H_00.00`,
> `MergedReflectivityQCComposite_00.50`, `PrecipFlag_00.00` — has day prefixes beginning `20201014` and none earlier.
> Of the six Phase 1 hindcast cases, Ellicott City (2016 and 2018) and Harvey (2017) are **outside the NODD window**.
> They are inside the mtarchive window, so the cases are not lost, but the route that reaches them is a university
> mirror rather than NOAA's own distribution, and that belongs in SPA-93's go/no-go reasoning rather than being
> discovered during implementation.

The mirror is a true mirror, verified: `PrecipRate_00.00_20261031-120000.grib2.gz` fetched from both hosts gave 664 810
bytes with identical sha256 on the gzip **and** on the inflated GRIB2. Content fidelity is therefore not at issue; the
difference is custody, and § 5 records which host served each frame.

**Source resolution rule.** For a requested product and valid time: NODD if the date is ≥ 2020-10-14, else mtarchive;
mtarchive is also the retry mirror when NODD returns 404 or 5xx for a frame inside its window. The IEM raster route is
**never** the forcing source when a GRIB2 route covers the date, and is labelled a lower data tier whenever it is used
at all (§ 5.2).

**Why the IEM raster is a last resort, measured.** IEM's `mrms_a2m` (documented as "NCEP MRMS 2 minute interval
precipitation accumulation", mm) is a 7000 × 3500 8-bit **palette-indexed** PNG: index 0 → 0.00 mm, 0.02 mm per index
step, index 254 → 5.08 mm, index 255 → missing. That is a quantum of 0.02 mm per 2 min (**0.6 mm/hr**) and a hard
ceiling of 5.08 mm per 2 min (**152.4 mm/hr**). The measured Ellicott City peak of 148.6 mm/hr is **97.5 % of that
ceiling.** It does not clip this case — reported as measured, not as the worse result I expected — but it has
essentially no headroom, and the native GRIB2 route resolves the same value to 0.1 mm/hr with no ceiling at all. The
accompanying `.wld` world file (`0.01 / 0 / 0 / -0.01 / -130.0 / 55.0`) independently confirms the CONUS grid in § 1.3.

### 1.2 The proxy: one allowlist entry, one mirror entry, no server changes

Add to `ALLOW` in `server/server.mjs:19`:

```js
'noaa-mrms-pds.s3.amazonaws.com', // NOAA MRMS via NOAA Open Data Dissemination (radar rainfall frames, 2020-10-14 →)
'mtarchive.geol.iastate.edu',     // Iowa State mtarchive: the same NCEP MRMS GRIB2 before the NODD window
```

That is the whole server diff. Everything else the existing proxy already does correctly for this source:

- **Caching.** Archive objects are immutable, so the existing sha1-of-`method + url + body` disk cache in `.cache/` is
  exactly right and needs no revalidation logic. Only `r.ok` responses are cached (`server/server.mjs:83`), so a 404
  for a missing frame is not cached as data.
- **Retries.** Three attempts with backoff on 429/5xx/transport (`server/server.mjs:73-80`) is adequate.
- **Listing.** Frame discovery uses `?list-type=2&prefix=…` on the same host, GET, already allowlisted. For mtarchive
  it is an Apache directory index on the same host.
- **Decoding stays in the browser**, like every other source (`src/ingest.js`, `src/history.js`, `src/infra.js`). The
  server remains a dumb caching proxy. This is a deliberate choice: it keeps the one security-sensitive file unchanged.

Two things deliberately **not** added, with reasons:

- **No HTTP range requests.** A frame is 0.7–1.0 MB. The PNG payload in §7 is a single deflate stream, so reaching a
  given row still requires the stream from its start; and the measurement in § 1.5 shows stopping early saves nothing.
  `tools/zip-range.mjs` exists for a different problem; do not reach for it here.
- **No cache eviction and no rate limiter.** A 6-hour event is ~184 MB in `.cache/` (measured, § 1.5). `.cache/` is
  gitignored and already grows this way for DEM and NLCD tiles. Adding an eviction policy is new capability this ticket
  does not name. Document the figure in the README limitations list instead.

Fetch concurrency belongs in `src/radar.js`, not the server: a bounded pool of 6 in-flight requests, which is how
`fetchHourly` already fans out (`src/history.js:119`).

### 1.3 The GRIB2 that MRMS actually emits

Three real frames were decoded (mtarchive PrecipRate 2016-07-30 22:00Z, NODD PrecipRate 2026-11-01 00:00Z, NODD
MultiSensor_QPE_01H_Pass2 2026-11-01 00:00Z). All three are structurally identical:

| Section | Measured |
|---|---|
| §3 grid | template **0** (lat/lon), `shapeOfTheEarth` **2**, `ni` 7000, `nj` 3500, first point (54.995, 230.005) = 54.995 N 129.995 W, last (20.005001, 299.994998) = 20.005 N 60.005 W, `di` = `dj` = 0.01°, `scanMode` 0x00 |
| §4 product | template **0**; PrecipRate = category 6 number 1; MultiSensor_QPE_01H = category 6 number 37 |
| §5 data rep. | `nValues` 24 500 000, template **41 (PNG)**, R = −30, E = 0, D = 1, **16 bits** |
| §6 bitmap | indicator 255 — no bitmap |
| §7 data | PNG 7000 × 3500, **16-bit greyscale** (colour type 0), inflates to 46.73 MB, PNG row filter types 0–4 all present |

Consequences the implementer needs:

- **Value law.** `value = (R + X·2^E) / 10^D = (X − 300) / 10`. Resolution 0.1 (mm/hr for PrecipRate, mm for the
  accumulations). `X = 0 → −3.0` and `X = 290 → −1.0` are MRMS's no-coverage and missing sentinels; **any negative
  decoded value is "no data", never zero rain.** Treating −3 as rain would inject −3 mm/hr over every pixel outside
  radar coverage. This is the single most likely implementation bug in the whole pipeline; § 9 tests for it.
- **`scanMode` 0x00** means +i then −j: row 0 is the northernmost. That is the same convention as FloodSim's own grids
  ("row-major, row 0 = north", `src/compare.js:12`), so no flip.
- **Required decode path.** gunzip → walk sections 0–8 → read §3 and §5 → inflate the §7 PNG IDAT → undo PNG row
  filtering (sequential: filter types 2/3/4 reference the previous row, so rows cannot be decoded out of order) → read
  big-endian 16-bit samples → apply the value law → clip to the subset (§ 2).
- **Assert, do not assume.** On the first frame of a run, record `gridTemplate`, `shapeOfTheEarth`, `ni`, `nj`, the
  corner coordinates, `di`, `dj`, `scanMode`, `dataTemplate`, `R`, `E`, `D`, `bits` into the manifest; on every
  subsequent frame, assert they match and **refuse the run** on a mismatch rather than silently reinterpreting bytes. A
  product family switching packing template mid-archive is a real hazard and a cheap one to catch.

### 1.4 Named dependency and licence — flagged for review

MRMS needs template 5.41 (PNG), and that is where the obvious candidates fall over.

**The constraint this is judged against.** `LICENSE` at the repo root (added on main in #1, `c178700`) makes FloodSim
proprietary: "the proprietary and confidential property of SPARC Labs LLC … No licence to use, copy, modify, publish or
distribute the Software is granted". It also says "Third-party software and data retain their own licences and terms".
So a bundled component must be redistributable inside a proprietary binary — which is what `dist/floodsim.html` is.

| Candidate | Licence | Verdict |
|---|---|---|
| **ecCodes** (ECMWF) | **Apache-2.0** | Compatible with proprietary distribution (permissive; obligations are attribution/NOTICE retention). Complete and correct; PNG packing needs the optional libpng build. C with CMake and a large runtime `definitions/` tree. |
| NCEPLIBS-g2c (NOAA-EMC) | US Dept. of Commerce "as is" statement, **no SPDX identifier** | Supports PNG; the reference NCEP decoder. The terms are not a standard licence, so bundling it into a proprietary product needs a written determination first. |
| wgrib2 (NOAA/CPC) | mixed public-domain **and GPL** components | **Rejected on licence grounds.** Distributing GPL code inside `dist/floodsim.html` would require releasing the derivative work under the GPL, which directly contradicts `LICENSE`. Not a posture question — an incompatibility. |
| `grib2-simple` (npm) | MIT | Rejected on capability: author states it "only covers the functionality that is needed to parse grib2 files provided by the open data project of DWD". |
| `vgrib2` (npm) | MIT | Rejected on capability: its own table matrix marks everything past Table 5.1 as not implemented. No 5.41. |

**Recommendation, for approval:** take **ecCodes 2.x (Apache-2.0)** as the named dependency, but use it as the
**conformance oracle**, not as a shipped runtime component — and write the decode path as a narrow in-repo module
`src/grib2.js` restricted to the three templates MRMS emits (3.0, 5.0, 5.41).

The reasoning, stated plainly so the approver can overrule it:

- The decode path needed is ~250 lines: a section walk, the §5 value law, and a PNG inflate-and-unfilter. Node has
  `zlib`; browsers have `DecompressionStream('gzip')` and `DecompressionStream('deflate')`. **Zero new runtime
  dependencies** — important for an app that ships as a single self-contained `dist/floodsim.html` (`app/build.mjs`).
- The alternative is a wasm build of ecCodes, following the `vendor/swmm` → `vendor/swmm-wasm` precedent
  (`tools/build-swmm.mjs`). SWMM is a fair precedent for *vendoring C*, but SWMM is one self-contained solver; ecCodes
  needs its `definitions/` tree mounted in a virtual filesystem at runtime, and the result would be a multi-megabyte
  wasm module to read one packing template. That is a poor trade and an unbounded build task.
- The risk of a hand-written decoder is silent misdecoding. That risk is retired by using ecCodes as the oracle:
  generate `tests/fixtures/radar/` from a pinned set of frames with `grib_get_data`, commit the expected values, and
  make `npm run test:radar` assert the in-repo decoder reproduces them exactly. The oracle is a developer tool, never
  shipped, never a dependency of the app.
- Under the proprietary `LICENSE`, this path adds **no new bundled third-party component at all**, so it creates no new
  redistribution obligation on `dist/floodsim.html`. The ecCodes-wasm alternative would add one (satisfiable, Apache-2.0,
  but it has to be satisfied).

**Approval needed on:** (a) narrow in-repo decoder vs vendored ecCodes-wasm; (b) ecCodes Apache-2.0 as a developer-only
conformance oracle, never bundled; (c) confirmation that neither path implies any edit to `LICENSE` — wgrib2 is rejected
precisely so that question never arises.

### 1.5 Measured budget

Node 24.16.0 on the development machine, 10 mtarchive PrecipRate frames (2016-07-30 23:00–23:18Z, mean object 1048 kB):

| Step | ms per frame |
|---|---|
| cold fetch over the public internet | 249 |
| gunzip | 2.6 |
| inflate the PNG IDAT, all 3500 rows | 28 |
| inflate stopping at the last row needed (row 1577 for 39.27° N) | **28 — no saving** |
| undo PNG row filtering up to that row | 52 |
| **decode total, excluding fetch** | **83** |

A 6-hour event at 2-minute cadence is 180 frames: **15.0 s of decode and 184 MB downloaded**, once, cached on disk
thereafter. That is a pre-run step, not a per-step cost.

**Reported negative result:** the obvious optimisation — stop inflating once the rows covering the domain have arrived —
**saved nothing measurable** (28 ms either way; the inflate stream delivers in large chunks). Do not implement it. The
browser path uses `DecompressionStream` rather than `node:zlib` and is **not yet measured**; measure it before trusting
the 83 ms figure in the app.

---

## 2. Resolution, and the trap

MRMS pixels are 0.01°. At 39.27° N that is **1113 m north–south and 861 m east–west**. The model grid is 1 m. One radar
pixel covers of order 10⁶ model cells.

> **The field is stored, cached, archived, hashed, interpolated and drawn at radar resolution. It is never expanded
> onto the model grid — not in memory, not on disk, not on the GPU.**

A 5 km × 5 km domain at 39° N spans 5.8 pixel columns and 4.5 pixel rows: **6 × 5 = 30 pixels**, plus a 1-pixel halo for
bilinear interpolation and whatever halo the advection displacement requires (§ 7, parameter `advect`), so of order
8 × 7 = 56 values per frame. 180 frames of that is 40 kB.

Expanding to the model grid instead would be 25 million floats per frame — 100 MB per frame, 18 GB for the event — and
would also force a 25 MB GPU buffer upload every time the field changed. **It is a few lines to write and it makes the
feature unusable.** Say no to it here so nobody adds it later by accident:

- `RadarField` holds `Float32Array(nxr·nyr)` per frame and the subset geotransform. There is no model-grid variant of
  the type, and no function in `src/radar.js` returns a model-grid array.
- The GPU gets a `RAD` storage buffer of `nxr·nyr` floats (§ 4.3), not a per-cell buffer. Interpolation happens in the
  kernel, per cell, per step, from those few dozen values.
- `npm run test:radar` includes `radar/no-model-grid-expansion`: assert that no array produced by `src/radar.js` has
  length ≥ `nx·ny` of the model grid. Crude, and it is exactly the regression worth catching mechanically.

### 2.1 Cell → pixel mapping, and the datum question

The model grid is WGS84 / UTM in true metres (`src/geo.js`, sub-millimetre inside a zone). The radar grid is plate
carrée, so `lon/lat → pixel` is exact and trivial: `u = (lon − lon₁)/di`, `v = (lat₁ − lat)/dj`. The only hard part is
that the kernel cannot run the Transverse Mercator series per cell per step.

**Mapping.** Fit a biquadratic in the padded cell indices — `[1, x, y, x², xy, y²]` per axis, 12 coefficients total — by
least squares against exact `fromUTM` evaluations on an 11 × 11 sample over the domain. Carry the 12 coefficients in
the uniform block; the kernel spends 12 multiply-adds per cell. Then measure the max residual against exact `fromUTM`
on a 33 × 33 check set, **gate the run at 0.01 radar pixels (≈ 9 m)**, record the achieved residual in the provenance
block, and fall back to a per-run precomputed per-pixel-corner table if a domain ever fails the gate. The gate value is
chosen to sit an order of magnitude below the datum uncertainty below; the achieved residual is to be reported, not
assumed.

**Datum, measured.** §3 declares `shapeOfTheEarth = 2`: the IAU 1965 spheroid, a = 6 378 160 m, 1/f = 297. FloodSim's
UTM is WGS84. Reading MRMS latitudes as WGS84 geodetic without conversion displaces a point by:

| latitude | Δlatitude | metres |
|---|---|---|
| 25° N | −2.251″ | −69.1 |
| 39.2673° N (Ellicott City) | −2.877″ | **−88.4** |
| 48° N | −2.918″ | −89.6 |

(computed geocentric, zero translation and rotation, since GRIB2 declares no datum shift.) That is 0.08 of a radar
pixel — but **88 one-metre model cells.**

This is genuinely ambiguous and the document should not pretend otherwise. Mainstream readers (GDAL-based pipelines,
HEC-HMS MRMS import, `pysteps`) treat NWS plate-carrée coordinates as EPSG:4326 and apply no shift; the declared code
may well be a legacy artefact of NCEP's template defaults rather than an assertion about geodesy. So:

- **Default: apply no datum shift**, matching every mainstream reader.
- **Record** the declared `shapeOfTheEarth`, the chosen interpretation, and the magnitude of the alternative (the table
  above, evaluated at the domain's own latitude) in the provenance block of every run.
- **Expose** it as a named setting `datumInterpretation: 'as-wgs84' | 'iau1965-to-wgs84'` so the sensitivity can be
  measured by a paired run rather than argued about. Because it changes the forcing, it is inside the fingerprint
  (§ 3.3), so the two interpretations are two different runs and cannot be silently compared.

---

## 3. Frame storage, the snapshot, and the merge gate

Radar is the first forcing source that arrives from a stream rather than a fixed table. A stream is the natural way to
destroy the one property that makes FloodSim a screening instrument: paired runs under an enforced identical forcing
fingerprint, steps cut only on 10 s quanta, control-line flux books verified to 9e-9 (`README.md:144`), reruns giving
Δ = 0 exactly.

### 3.1 The structural move: turn the stream back into a table before the run starts

> **A radar-forced run resolves and materialises every frame it will consume *before the first solver step*. There is
> no network access during the solve.**

This is the decision everything else in this section follows from. Concretely:

```js
// src/radar.js
const rf = await RadarForcing.resolve({ product, pass, t0, t1, bbox, source, advect, bias, datumInterpretation });
const storm = rf.seal();   // → a frozen storm object with .radar, usable by rainAt(); the ONLY way to get one
```

- `resolve()` lists, fetches, decodes and clips every frame covering `[t0, t1]` plus the halo frames the interpolator
  needs at both ends, then verifies completeness against the product's declared cadence.
- `seal()` freezes the frames, computes the manifest and its hash, and returns the storm object. It throws if any
  frame is missing, if any header assertion failed, or if a gap policy (§ 4.5) was not resolved.
- A storm object carrying `radar` without `radar.sealed === true` is rejected by `ensureSolver()` (`app/map.js:1150`).
  There is no code path from a live fetch into a running solver.

Once the frames are a frozen table, the existing guarantees hold unchanged: the step set is a deterministic function of
the manifest, so the rerun gives Δ = 0 for the same reason it does today.

### 3.2 The snapshot

A radar-forced run's archive folder (`runs/<stamp>/`, `app/map.js:2514`) gains:

```
rain/frames.json       the manifest (below)
rain/frames.f32        the decoded, clipped subset: float32 LE, one band per frame, bands in manifest order
rain/frames.hdr        ESRI-style header for one band (the existing gridHeader() convention, src/compare.js:80)
rain/display.f32       the display product's frames, same layout, when a display layer was used (not forcing)
rain/display.json      its manifest
```

`frames.json` per frame: `validUTC`, `source` (`nodd` | `mtarchive` | `iem`), the exact bucket key or URL, `fetchedUTC`,
upstream `etag` and `contentLength`, **`sha256Raw`** of the `.grib2.gz` bytes as received, and **`sha256Values`** of the
decoded clipped band. Plus, once for the set: product and pass identifiers, the §3/§5 header assertions, the subset
geotransform (`lon1`, `lat1`, `di`, `dj`, `nxr`, `nyr`), the halo widths, the bias and advection parameter blocks, the
datum interpretation, the biquadratic residual, and the gap record.

**Size.** The decoded subset is what the solver consumed: 56 floats × 180 frames = 40 kB. A 50 km domain would be
~1.8 MB. The archive stays small enough to live in a project folder and be attached to a report.

**The one interpretation choice in this design, flagged for the approver.** "The exact frames it consumed" is read as
**the decoded, clipped subset** — because that is what the solver saw; the CONUS field was never consumed. The identity
of the original objects is preserved by `sha256Raw`, so the chain from NOAA's bytes to the model's values is auditable
end to end, and the originals remain in `.cache/`. An opt-in `radar.archiveRaw: true` additionally copies the
`.grib2.gz` originals into `rain/raw/` for an audit-grade archive, at 184 MB for a 6-hour event. If the approver reads
the rule as requiring the originals unconditionally, that flag becomes the default and the size note moves to the
README; nothing else in the design changes.

### 3.3 Hashing into the forcing fingerprint

**Hash `sha256Values`, not `sha256Raw`.** The two GRIB2 routes are byte-identical today (measured, § 1.1), but
byte-identity across mirrors is an observed property, not a guarantee; a re-gzipped mirror would change a raw-byte
fingerprint without changing a single rainfall value, and would then refuse a legitimate paired comparison. The decoded
values are what the solver consumed and what must be identical for two runs to be comparable.

**Where in the fingerprint.** Fold the radar manifest into the existing **`storm`** part rather than adding a 13th part
to `FORCING_PARTS`:

```js
// forcingRecord(), app/map.js:1367 — the storm part gains, only for a radar-forced run:
radar: { product, pass, datumInterpretation, grid: { lon1, lat1, di, dj, nxr, nyr },
         advect: <the parameter block>, bias: <the parameter block>,
         frames: [{ validUTC, sha256Values }, …], manifestSha256 }
```

Why not a new part: `fingerprint()` hashes the `parts` object (`src/compare.js:51-55`), so adding a key changes the
top-level hash of **every** run, past and future. Every saved run becomes incomparable with every new one and every
baseline cache entry misses. Folding into `storm` leaves non-radar runs bit-for-bit unchanged (their storm record gains
nothing), while a radar run's `storm` hash necessarily differs from a gauge run's — which is correct, because they are
different forcing. The refusal message stays useful by extending the *label* at `src/compare.js:37`, which is not
hashed:

```js
storm: 'storm (depth, duration, pattern, the historic event and its rain source, or the radar product, pass and frames)',
```

**What must *not* be hashed:** the display product's frames. The display layer does not affect results. Hashing it
would make a cosmetic choice block a valid paired comparison — a run with the replay layer on would refuse to compare
against the same run with it off. `rain/display.json` carries its own hash so the archive is self-verifying, outside
the fingerprint input.

### 3.4 The merge gate

This is a gate, not a follow-up ticket.

**The check:** `npm run test:radar` → `tests/run-radar-tests.mjs`, following the `check(name, ok)` → `process.exit(fails ? 1 : 0)`
discipline of the other 22 suites, registered in the same CI job list as `test:compare` and `test:window`, and added to
the branch's **required status checks** under the name `test:radar`.

**The rule:** *a pull request that touches `src/radar.js`, `src/grib2.js`, the `FORCING_PARTS` / `fingerprint` /
`comparable` block in `src/compare.js`, `forcingRecord()` or `runFiles()` in `app/map.js`, or the rain source term in
`src/kernels.wgsl.js` does not merge unless `test:radar` passes.*

The named assertions inside it, each of which must fail the build:

| Check | What it asserts |
|---|---|
| `radar/seal-before-run` | A storm whose `radar` is not sealed is rejected before the first step. An unsealed or partially resolved frame set cannot reach a solver. |
| `radar/manifest-covers-every-consumed-frame` | Every frame index the interpolator touches over `[0, tStop]` appears in the manifest, and the manifest has no frame the run cannot consume. Set equality, both directions. |
| `radar/snapshot-round-trip` | Save, reload from `rain/` alone with the network disabled, and get byte-identical `frames.f32` and an identical `forcingHash`. |
| `radar/fingerprint-sensitivity` | Changing one frame value by one float32 LSB, dropping one frame, reordering frames, or changing the product/pass/datum string each changes `forcingHash`; and `comparable()` refuses two runs whose radar manifests differ, naming the storm part. |
| `radar/no-model-grid-expansion` | No array returned by `src/radar.js` has length ≥ the model grid's `nx·ny` (§ 2). |
| `radar/uniform-field-is-the-scalar-path` | With a radar field that is uniformly 1.0, every output is **bit-identical** to the existing scalar path. The exact null. |
| `radar/books-close-on-the-frame-accumulations` | The solver's `vol.rain` equals Σ over frames of (pixel depth × pixel weight) to 1e-12 relative (§ 4.4). |
| `radar/negative-is-no-data` | A frame containing the −3.0 and −1.0 sentinels contributes zero rain and zero area, never negative rain (§ 1.3). |
| `radar/decoder-matches-eccodes` | `src/grib2.js` reproduces the committed ecCodes fixture values exactly for the pinned frames (§ 1.4). |

Plus, in the GPU browser suite (`tests/gpu-browser.html`, since Node's GPU runner crashes on this machine's driver):

| Check | What it asserts |
|---|---|
| `radar/replay-delta-zero` | A radar-forced run rerun from its own archive gives Δ = 0 exactly, at any batch size — the radar analogue of the existing rerun check. |
| `radar/display-and-forcing-share-motion` | The display layer's sampled field at time *t* is produced by the same `fieldAt(t)` call the forcing used (§ 6.2). |

---

## 4. Cadence and interpolation

### 4.1 Do not assume a cadence — read the valid times

Measured on NODD, 2026-11-01:

- `PrecipRate_00.00` valid times are exactly on even minutes: `00:00:00`, `00:02:00`, `00:04:00`, …
- `MergedReflectivityQCComposite_00.50` valid times are `00:00:40`, `00:02:39`, `00:04:39`, `00:06:41`, `00:08:39`,
  `00:10:39`, `00:12:41`, `00:14:41` — about 2 minutes apart, offset ~40 s, and **irregularly spaced** (122–159 s).

So **no alignment invariant.** An earlier draft of this design required the frame cadence to be an integer multiple of
`STEP_QUANTUM`; that rule would have rejected the reflectivity composite outright, and it is unnecessary. The frame
valid times come from §1 of each frame, go into the manifest, and therefore into the fingerprint — which makes the step
boundaries a deterministic function of the forcing, which is all determinism requires.

The existing contract already covers it: *"steps are cut only at multiples of `STEP_QUANTUM` s of simulated time (and at
the storm's own stop times …), never at a wall-clock time"* (`app/map.js:1279`). **Frame valid times are storm stop
times.** No new mechanism.

### 4.2 The interpolator, and what `rainAt` becomes

`rainAt(storm, t)` (`src/storm.js:155`) gains a radar branch and keeps its contract:

```js
rainAt(storm, t) → { mmhr, radar: Float32Array | null, until }
```

- `mmhr` — the reference scalar: the pixel-weighted mean over the domain at time *t* (§ 4.4). For a scalar storm,
  unchanged, with `radar: null`.
- `radar` — the field at time *t*, `nxr·nyr` values, each a dimensionless multiplier relative to `mmhr`.
- `until` — the next instant the field changes: `min(next frame valid time, next field-update instant)`. The run loop's
  existing `tEnd = Math.min(tEnd, rr.until)` then guarantees no step straddles a field change, exactly as it does for
  hyetograph blocks today.

**Field-update instants** are multiples of `radarStep` (default `STEP_QUANTUM` = 10 s) from the run start, plus every
frame valid time. Between two frames at 2-minute spacing that is 12 field updates. The field is piecewise-constant on
those intervals, which is what makes the rain integral exact (§ 4.4).

**Between frames** the field is `advect(frameA, frameB, w)` where `w = (t − tA)/(tB − tA)` and `advect` is the operator
[SPA-93](/SPA/issues/SPA-93) specifies (§ 7). When no advection operator is supplied, the fallback is the
weight-blend-in-place `(1−w)·A + w·B`, **and which one was used is recorded in the manifest and in every output's
provenance**, because it changes the answer materially — a cell moving at 15 m/s travels 1.8 km between frames, more
than a pixel, and blending in place smears it and under-predicts peak intensity along its track.

**Observation for SPA-93, not a design decision:** consecutive PrecipRate frames are often not independent. In the
measured Ellicott City sequence the 7 × 7 window max repeats across frame pairs — 22:36 and 22:38 both 127.8, 22:44 and
22:46 both 133.6, 23:24 through 23:30 all 135.6 — consistent with a ~4–6 minute volume-scan update behind a 2-minute
product cadence. Whatever advection estimator is chosen will see duplicated frames, and should not interpret a zero
displacement between a duplicated pair as a stationary storm.

### 4.3 The source term on the GPU

Today (`src/kernels.wgsl.js:433`): `let r = P.rain * RF[c] * dt;`

Proposed: `let r = P.rain * RF[c] * radarAt(c) * dt;` where `radarAt(c)` bilinearly samples a new `RAD` storage buffer
of `nxr·nyr` floats using the biquadratic cell → pixel map from the uniform block (§ 2.1). Tile activation
(`src/kernels.wgsl.js:500`) becomes `P.rain * RF[c] * radarAt(c) > 0.0`, which keeps the tiled solver bit-identical to
the untiled one and makes tiles activate only where it is actually raining.

Three properties this must have, and they are the tests in § 3.4:

1. **Exact null when radar is off.** `radarAt` returns the literal `1.0` under a `P.radarOn` flag, so the off path
   introduces no new arithmetic and every existing result is bit-identical.
2. **Per-update upload is tens of floats, not millions.** 56 floats ≈ 224 bytes per field update, 12 updates per frame.
   Compare the alternative of folding radar into `RF` and calling `setRainField` (`src/solver-gpu.js:417`), which
   rewrites the whole padded grid: 25 MB per update at 1 m, 2160 updates for a 6-hour event — tens of GB of PCIe
   traffic. That alternative is also precisely the model-grid expansion § 2 forbids.
3. **Composes with roof routing rather than replacing it.** `RF` keeps carrying roof routing and green-roof/cistern
   stages; radar is a separate multiplicative factor. Nothing about `setRainField` or `roofHoldStages`
   (`app/map.js:1132`) changes.

**This is a change to a source term, not to the numerics.** The flux scheme, wave speeds, CFL, draining limiter,
friction, boundary conditions and time stepping are untouched. It is nonetheless a change to `src/kernels.wgsl.js`, so
§ 8 flags it for the solver owner's review before implementation.

### 4.4 Keeping the rain book exact

`vol.rain += rainRate · Δt · rainArea` with `rainArea = Σ_c RF_c·dx²` (`src/solver-gpu.js:545`, `:118`) is wrong the
moment rain varies in space: the true volume is `Σ_c rainRate · RF_c · RAD(c) · dx² · Δt`.

Bilinear sampling is a **linear** operator, so this reduction can be done on the radar grid:

```
rainWeights[p] = Σ_{c : rain-receiving}  RF_c · b_p(c) · dx²        (one O(N) pass, per run and per RF change)
rainAreaEff(t) = Σ_p rainWeights[p] · RAD_p(t)                       (≈ 56 multiply-adds per field update)
vol.rain      += rainRate · Δt · rainAreaEff
```

`b_p(c)` is the bilinear weight pixel *p* contributes to cell *c*; the weights depend only on geometry and `RF`, so
they are computed once — the same cost as one existing `setRainField` call — and recomputed only when `RF` changes
(a roof stage). Every field update is then a handful of arithmetic. The books stay closed to round-off, and
`radar/books-close-on-the-frame-accumulations` asserts it at 1e-12 relative.

**Choice of the reference scalar.** `mmhr` is the `rainWeights`-weighted mean of the field, so `RAD` is O(1) and the
dimensionless multiplier reads naturally in the UI and in `hyetograph.csv`. Any other reference works arithmetically;
this one keeps the exported hyetograph meaning "the domain-average rain rate", which is what a reviewer expects.

**Accumulation products vs rate products.** This is a units trap, and it is a geospatial-engineering concern rather
than a product choice. A *rate* product (PrecipRate, mm/hr) is an instantaneous value and interpolates as a rate. An
*accumulation* product (`MultiSensor_QPE_01H`, mm over the preceding hour) is **not** a rate and must not be
interpolated as one: successive frames overlap by 58 of their 60 minutes, so differencing consecutive frames, not
interpolating them, is the only way to recover an increment. `RadarProduct` therefore declares
`kind: 'rate' | 'accumulation'` and `accumulationWindowS`, and the design refuses an accumulation product whose window
is not a multiple of its cadence. Which product is used is SPA-93's call (§ 7); handling both correctly is this
design's obligation. For an accumulation product the 12 sub-frame rates are renormalised so their sum reproduces the
frame's increment exactly — which is the other half of why the books close.

**Documented limitation.** Green roofs and cisterns currently fill on `s.vol.rain / s.rainArea`
(`app/map.js:1296`) — the area-mean rain depth. Under a spatial field, a roof under the convective core fills before
one 3 km away, and the area-mean trigger fires at neither time. The chosen behaviour is to **keep the area-mean
trigger** and record in the run summary that roof retention stages fired on the domain-average depth. Per-roof local
triggering is new capability and out of scope for 3e; it is named here so it is a known approximation rather than a
surprise.

### 4.5 Missing frames

The archive can have holes, and a hole must never be papered over silently. Policy, recorded in the manifest and
reported in the provenance block:

- A gap of **one** frame: the interpolator already brackets across it (the valid times are explicit), so the run
  proceeds and the gap is recorded and shown.
- A gap of **more than one** frame, or any gap at all when `radar.strictFrames` is set: `seal()` throws and names the
  missing valid times. The user chooses a different window, product, or source — the program does not choose for them.
- `dataCoverage` = frames present / frames expected goes in the provenance block and on every output that depends on
  the forcing.

Measured, for calibration of expectations: the Ellicott City window 2016-07-30 21:00–23:58 UTC returned **90 of 90**
PrecipRate frames from mtarchive. No gap was observed in the probed windows, so the policy above is written against a
hazard rather than against a measured failure.

---

## 5. Provenance

### 5.1 What every radar-forced run records

In `summary.json`, alongside the existing `storm`, `drainage`, `greenInfrastructure` and `calibration` blocks
(`app/map.js:2490-2512`), and in `stormMeta()` (`app/map.js:705`) so it flows into the H&H report and every export:

```
rainfall.radar = {
  product, pass, kind, accumulationWindowS,        // what, per § 7
  source, sourceHost, window: [t0, t1],            // where it came from
  frames: n, dataCoverage, gaps: [...],            // completeness, § 4.5
  latencyS: { min, median, max },                  // per frame: fetchedUTC − validUTC
  bias: { method, value, gauges: [...], measuredUTC },   // SPA-93's method and ITS result, § 7
  advect: { method, params, ... },                 // SPA-93's operator and ITS parameters, § 7
  grid: { lon1, lat1, di, dj, nxr, nyr, pixelM: [dxM, dyM] },
  datumInterpretation, datumOffsetM,               // § 2.1, the number at this domain's latitude
  mapResidualPx,                                   // § 2.1, achieved biquadratic residual
  interpolation: { radarStepS, mode },             // 'advected' | 'blend-in-place'
  tier, manifestSha256,                            // § 5.2
  attribution: '...'                               // § 5.3
}
```

**Latency** is `fetchedUTC − validUTC` per frame, summarised. For an archive replay it is years and meaningless as a
timeliness measure, but it is exactly what distinguishes an archive replay from a near-real-time pull, which is why it
is recorded rather than computed on the fly.

### 5.2 A rainfall data tier, labelled like the drainage tiers

FloodSim already stamps a data tier on every drainage output — `tier 1` for real pipes, `tier 2` for a synthetic
network, `tier 3` for a lumped rate, rendered as a pill (`drainLabel()`, `app/map.js:959-970`). Rainfall gets the same
treatment: a `tier` and a one-line label on the run summary, the report methods note, and every exported figure caption.

**The tier value is a declared property of the product registry entry, not a judgement this design makes.** The
registry is the table SPA-93 fills in (§ 7); this design provides the field, the pill, and the plumbing. Today's
behaviour — a single-point IEM Reanalysis series timed by one ASOS gauge — is a radar tier value in that same registry,
so the label is honest about what the program does now as well as what it will do.

### 5.3 NOAA's terms, which bind the labels

NODD's terms of use: *"NOAA data disseminated through NODD are open to the public and can be used as desired. NOAA
requests attribution for the use or dissemination of unaltered NOAA data. However, it is not permissible to state or
imply endorsement by or affiliation with NOAA. If you modify NOAA data, you may not state or imply that it is original,
unaltered NOAA data."*

Three concrete obligations:

1. **Attribute.** Every output depending on radar rainfall carries the product, the source, and the retrieval date —
   e.g. "NOAA MRMS `MultiSensor_QPE_01H_Pass2`, via NOAA Open Data Dissemination, retrieved 2026-11-01". For the
   mtarchive route, name Iowa State University's mtarchive as the host of the NCEP product.
2. **Say when it is modified.** Bias correction, advection correction and interpolation are all modifications. A
   bias-corrected field must never be labelled as the raw NOAA product; the label carries the bias method and value.
3. **No implied endorsement.** No wording that suggests NOAA endorses FloodSim or its results.

This is the same discipline the repo already applies to its other sources — "Label the source and vintage of every
dataset on the outputs that depend on it" — with a licence term behind it, and it is the mechanism by which FloodSim
honours its own `LICENSE`'s clause that "third-party software and data retain their own licences and terms". The
proprietary licence on FloodSim does not reach NOAA's data; the attribution runs with the data onto every output.

---

## 6. The replay view — design sketch

Reflectivity (or the forcing field) over the satellite basemap, on the solver clock, scrubbable, with the time cursor
shared with the hydrographs. Sketch only; the implementation is a later ticket.

### 6.1 Layer order and the colour collision

The constraint the ticket asks to settle now. The arrangement that stays readable:

```
satellite basemap
  ov-radar      ← inserted before ov-depth, so it draws underneath;  translucent, 0.55
  ov-depth      ← the existing water overlay, opaque (its own slider, S.opacity)
  area-line, buildings, network, vectors
```

Mechanically this is `setCanvasLayer('radar', canvases.radar, corners, 'ov-depth', …)` — the existing helper
(`app/map.js:276`) already inserts a canvas raster layer before a named layer, which is exactly the primitive needed.

**The ramps, chosen by measurement rather than taste.** The water depth ramp is blue → indigo
(`#beecff → #60bce8 → #1f78c4 → #1540a0 → #28146e`, `app/map.js:1766`). The familiar NWS reflectivity ramp is a rainbow
whose low end is blue-green, so it collides with shallow water at exactly the values a reviewer most needs to separate.
Radar therefore gets a **single-hue sequential orange ramp** — the second sequential context takes the next categorical
hue, per the house data-viz method, and a sequential ramp is one hue light → dark, never a rainbow:

```
#f7b267 → #f0872c → #dd5b14 → #b43a08 → #7a2708      (no echo = fully transparent, not a pale colour)
```

Measured with the palette validator:

- chroma floor **PASS** (all five steps ≥ 0.1, so no step reads grey against imagery); lightness monotone decreasing,
  0.814 → 0.724 → … → 0.396.
- **Worst cross-ramp pair against the depth ramp: `#beecff` ↔ `#f7b267`, ΔE 20.2 normal vision / 18.2 under CVD
  simulation** — above the ≥ 15 normal-vision floor and well above the ≥ 8 CVD target. Shallow water and light rain are
  reliably distinguishable, including for colour-vision-deficient readers.
- A near-white radar low end was **rejected on measurement**: `#ffe9d6` against `#beecff` measures ΔE 9.3, below the
  floor. Hence "no echo" is encoded as *transparency*, and the lowest visible radar step already carries chroma.

Two further rules that fall out:

- **Both legends on screen whenever both layers are on**, each with its own units. If a reviewer cannot tell rain from
  flood in a screenshot, the figure is worse than no figure.
- **The radar layer is available only with the depth / max-depth water view.** The speed, force, d·v and arrival views
  are themselves warm ramps (`app/map.js:1768-1775`) and would collide with orange. Selecting one of those hides the
  radar layer and the toggle says why. Simpler and more honest than a third hue family.
- **Drawn at native pixel size with `raster-resampling: 'nearest'`** (already the default in `setCanvasLayer`). Blocky
  1 km pixels tell the viewer the truth about the data's resolution. A smoothed option may exist; blocky is the default.

### 6.2 What the picture is allowed to claim, and the motion field

- The display layer source is a named parameter `displayProduct` (§ 7) with three legal values: a reflectivity
  composite, the forcing field itself, or none. **Default: the forcing field**, because it is always available, always
  co-timed with the forcing, and is the honest answer to "what is driving the model". Reflectivity is the "what the
  storm looked like" view, selected where SPA-93's registry says a composite exists for the case.
- **Measured constraint on the reflectivity option:** mtarchive's 2016-07-30 MRMS tree contains
  `GaugeCorr_QPE_01H`, `PrecipFlag`, `PrecipRate`, `RadarOnly_QPE_01H`, `RadarOnly_QPE_24H` and `SeamlessHSR` — **no
  reflectivity composite**. For pre-2020 cases the reflectivity option means IEM's `mrms_lcref` raster (8-bit, dBZ,
  2-minute), labelled at its own tier, or it means no reflectivity layer. That is a fact SPA-93 needs for cases 1 and 4.
- **Legend wording is taken from the registry entry**, not written here: SPA-93 states what a dBZ legend and a QPE
  legend may each claim, and the view renders that string. Reflectivity is not rainfall, and the legend must not let a
  viewer read it as rainfall.
- **The display and the forcing share one motion field.** Both call the same `fieldAt(t)` — the same frames, the same
  advection operator, the same parameters — differing only in which product's frame array they index. A second
  interpolation path for the display is forbidden, and `radar/display-and-forcing-share-motion` tests it. Otherwise the
  storm appears to sit still on screen while the model responds to it moving, and the picture visibly contradicts the
  physics.
- Because the display product's valid times are irregular and offset (§ 4.1), the display samples at *its own* frames'
  valid times, interpolated by the same operator to the solver clock. The scrub bar is on the solver clock; the time
  cursor is shared with the hydrographs, as the existing frame playback already is (`run.frames`, `$('frameEvery')`).

---

## 7. The interfaces SPA-93 plugs into

Every row is a named parameter with a defined interface and **no default chosen here**. A run cannot start with any of
them unset; there is no silent fallback that would amount to making the choice on their behalf. The registry below is
the handoff artefact: SPA-93 fills in the rows, this design consumes them unchanged.

```js
// src/radar.js — the registry SPA-93 populates; one entry per product the programme may use
RadarProduct = {
  id,                      // 'MultiSensor_QPE_01H_Pass2_00.00' etc. — THEIR choice, per case
  pass,                    // pass identifier where the product family has passes — THEIR choice
  kind,                    // 'rate' | 'accumulation'   (units semantics, § 4.4)
  unit,                    // 'mm/hr' | 'mm'
  accumulationWindowS,     // null for a rate product
  cadenceS,                // nominal only; actual valid times are read from §1 of each frame
  noDataValues,            // the sentinels for this product (−3.0, −1.0 for the QPE family)
  tier,                    // the rainfall data tier and its one-line label (§ 5.2) — THEIR judgement
  legend,                  // what this layer's legend may and may not claim (§ 6.2) — THEIR wording
  qpeNotes,                // bright band, beam blockage, hail cap, season/range caveats — THEIR text
}

// the three operators, supplied by them, called by this design
bias   = { method, measure(frames, gauges, window) → { value, gauges, measuredUTC }, apply(field, value) → field }
advect = { method, params, motion(frameA, frameB) → motionField, at(frameA, frameB, w, motionField) → field }
            // halo width in pixels is derived from the motion field; § 2 sizes the subset from it
displayProduct = RadarProduct['reflectivity composite'] | '@forcing' | null
```

Explicitly **not decided in this document**, and not defaulted: which QPE product; which pass; Z-R versus
dual-polarisation QPE; bright-band, beam-blockage and hail-cap handling; the bias-correction method; the
advection-correction algorithm; the per-case go/no-go. Those are [SPA-93](/SPA/issues/SPA-93)'s.

**Decided here, because they are geometry, I/O and reproducibility:** the GRIB2 decode path; the source resolution rule
and the allowlist entries; the subset geometry, the cell→pixel map and its residual gate; the datum interpretation
setting; the snapshot format and what enters the fingerprint; the merge gate; the interpolation *mechanism* (as opposed
to the advection *algorithm*); the units handling for rate vs accumulation products; the rain-book reduction; the gap
policy; the layer order and the colour ramps.

---

## 8. Decisions this design needs before implementation

1. **GRIB2 dependency and licence** (§ 1.4). Recommended: narrow in-repo `src/grib2.js` with **ecCodes 2.x
   (Apache-2.0)** as a developer-only conformance oracle, bundling nothing new. **wgrib2 rejected**: its GPL components
   are incompatible with the proprietary `LICENSE` once `dist/floodsim.html` is distributed. The alternative is a
   vendored ecCodes-wasm build following the `vendor/swmm` precedent, at materially higher build cost and with an
   attribution obligation to satisfy. No edit to `LICENSE` is proposed on any path.
2. **The snapshot scope** (§ 3.2). "The exact frames it consumed" is read as the decoded clipped subset (40 kB per
   event), with `sha256Raw` of the originals preserving the audit chain and `radar.archiveRaw` as an opt-in for the
   full 184 MB. Confirm that reading, or make `archiveRaw` the default.
3. **The kernel source-term change** (§ 4.3). `P.rain * RF[c]` becomes `P.rain * RF[c] * radarAt(c)`. It touches
   `src/kernels.wgsl.js`, so it needs the solver owner's review even though the flux scheme, time stepping and limiter
   are untouched and the uniform-field case is a bit-identical exact null.
4. **The datum interpretation** (§ 2.1). Default "treat as WGS84, record the 88 m alternative" — the mainstream
   reading, but it is a real 88 metres at Ellicott City and it is inside the fingerprint, so it should be an explicit
   decision rather than my default.
5. **The archive-window finding** (§ 1.1) needs to reach [SPA-93](/SPA/issues/SPA-93) before their per-case verdicts
   are written: NODD begins 2020-10-14, so Ellicott City 2016/2018 and Harvey 2017 are reachable only through the Iowa
   State mirror, and pre-2020 there is no `MultiSensor_QPE_*` family and no reflectivity composite in that tree.

---

## 9. Tests (matching the existing suites)

Node: `tests/run-radar-tests.mjs`, `npm run test:radar`. The § 3.4 gate checks, plus:

- `src/grib2.js` against the committed ecCodes fixtures: the three templates, the value law, the sentinels, every PNG
  row filter type (0–4 all occur in real frames), and a truncated/corrupt frame rejected rather than misread.
- Section-header assertion: a frame whose §3 or §5 differs from the pinned header refuses the run.
- The subset geometry: the pixel rectangle covering a known domain, at a known latitude, with known halos; the
  biquadratic residual under the gate; the datum offset table reproduced at three latitudes.
- Rate vs accumulation: an accumulation product's sub-frame rates sum exactly to the frame increment; a rate product
  interpolates as a rate; an accumulation product whose window is not a multiple of its cadence is refused.
- The gap policy: a one-frame hole proceeds and is recorded; a two-frame hole throws and names the missing times.
- `rainAt` contract: `until` never lets a step straddle a frame boundary or a field-update instant, for a regular
  cadence and for the measured irregular reflectivity valid times.

GPU browser suite (`tests/gpu-browser.html`): `radar/replay-delta-zero`,
`radar/display-and-forcing-share-motion`, the uniform-field exact null end to end, and the rain book closing to 1e-12
on a synthetic field with a known pixel-weighted total.

App check: Ellicott City 2016-07-30 22:00–00:00 UTC on a 5 km domain, as a paired run against the same event forced by
today's single-point series — the comparison that shows what making rainfall a field actually changes. Both runs under
the enforced identical fingerprint on everything but the storm part.

---

## 10. Phasing, and what is out of scope

1. **3e.1 Forcing.** `src/grib2.js`, `src/radar.js`, the two allowlist entries, the snapshot, the fingerprint fold-in,
   the merge gate, the kernel source term, the rain-book reduction. The gate ships in the same pull request as the first
   line of radar code — not after it.
2. **3e.2 Replay view.** The radar canvas layer, the two ramps and legends, the scrub bar and the shared time cursor.

Out of scope, named so it stays out: live mode (internal and demonstration-only this year by board decision, and a
later phase); the QPE product, bias method and advection algorithm ([SPA-93](/SPA/issues/SPA-93)); nowcasting or any
extrapolation past the newest frame; per-roof local retention triggering (§ 4.4); areal reduction factors; cache
eviction; the rest of Phase 3c interop (GeoTIFF, LandXML, DXF, HEC-RAS geometry).

---

## Measurements

Taken 2026-11-01 against the live public archives. Each figure above traces to one of these; the probe scripts are
small and were run from a scratch directory outside the repository, with downloaded bytes kept in their own directory.

| # | What was measured | Result |
|---|---|---|
| M1 | `noaa-mrms-pds` top-level prefixes | `ALASKA/ ANC/ CARIB/ CONUS/ CONUS_5KM/ ConvectProb/ GUAM/ HAWAII/ ProbSevere/ unsupported/`; 243 product prefixes under `CONUS/` |
| M2 | First and last day prefix, 5 CONUS products | all `20201014 .. 20261101`; `GaugeCorr_QPE_01H` absent from NODD CONUS |
| M3 | Object sizes, 2026-11-01 00:00Z (gz) | PrecipRate 824 kB · MultiSensor_QPE_01H_Pass2 702 kB · RadarOnly_QPE_01H 817 kB · MergedReflectivityQCComposite 2092 kB · PrecipFlag 231 kB |
| M4 | mtarchive coverage | `PrecipRate` present for 2015-01-01, 2016-07-30, 2017-08-27, 2018-05-27, 2021-09-01, 2026-10-31; 2016-07-30 tree has no `MultiSensor_QPE_*` and no reflectivity composite |
| M5 | NODD vs mtarchive, same frame | `PrecipRate_00.00_20261031-120000.grib2.gz`: 664 810 B both, identical sha256 of gz **and** of the inflated GRIB2 |
| M6 | GRIB2 structure, 3 frames | §3 template 0, shape 2, 7000 × 3500, (54.995, −129.995) → (20.005, −60.005), 0.01°, scanMode 0x00; §5 template **41**, R −30, E 0, D 1, 16 bits; §6 indicator 255; §7 PNG 16-bit greyscale, 46.73 MB inflated, row filters 0–4 |
| M7 | Decode budget, 10 frames, Node 24.16.0 | fetch 249 ms · gunzip 2.6 ms · inflate 28 ms · inflate-to-row **28 ms (no saving)** · unfilter 52 ms · **decode 83 ms/frame** → 180 frames = 15.0 s, 184 MB |
| M8 | 7 × 7 window at Ellicott City, 2016-07-30 | 90/90 frames 21:00–23:58Z present; window max 9.0 → 148.6 mm/hr; at 23:52Z the window ran 18.6 → 148.6, mean 63.6 |
| M9 | IEM `mrms_a2m` raster | 7000 × 3500, 8-bit palette (PLTE 256 entries); `.wld` = `0.01 / 0 / 0 / −0.01 / −130.0 / 55.0`; 0.02 mm per index, 254 → 5.08 mm, 255 → missing ⇒ **0.6 mm/hr quantum, 152.4 mm/hr ceiling**; measured peak is 97.5 % of it |
| M10 | Valid-time phase and spacing | PrecipRate exactly on even minutes; MergedReflectivityQCComposite `00:00:40, 00:02:39, 00:04:39, 00:06:41, 00:08:39, …` — offset ~40 s, spacing 122–159 s |
| M11 | IAU-1965 → WGS84 geodetic latitude | −2.251″ / −69.1 m at 25° N · −2.877″ / **−88.4 m** at 39.2673° N · −2.918″ / −89.6 m at 48° N |
| M12 | Palette validation | radar ramp chroma floor PASS, lightness monotone 0.814 → 0.396; worst cross-ramp pair `#beecff` ↔ `#f7b267` **ΔE 20.2 normal / 18.2 CVD**; rejected near-white `#ffe9d6` ↔ `#beecff` ΔE 9.3 |

Sources consulted: the AWS open-data registry entry for `noaa-mrms-pds` (bucket, region, cadence, terms of use), the
NCEP GRIB2 documentation for data representation template 5.41, IEM's GIS raster documentation (`rasters.php?rid=3`
for `mrms_a2m`, `rid=4` for `mrms_lcref`), and the licence statements for ecCodes, NCEPLIBS-g2c, wgrib2, `grib2-simple`
and `vgrib2`.
