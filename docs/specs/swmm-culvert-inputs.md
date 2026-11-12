# Native SWMM culvert inputs: Stage A, translation (11 Nov 2026)

What FloodSim writes to SWMM for a conduit when native sections are turned on, why each choice was made, and how it was
checked. This is Milestone 2, Stage A: getting the translation right. Stage B, the benchmarks, has started; its
SWMM-alone results are in §7 and `benchmarks/culvert/README.md`. No Charlotte run has been made.

**Off by default.** `realNetwork(..., { nativeSections: true | {config} })`. The app does not pass the option. With it off,
no pipe carries a native section and the `.inp` is byte-identical to HEAD. That was checked on Charlotte's cached records,
with and without endwalls and inlets.

## 1. Data flow

Source record → canonical conduit (`src/assets.js`: `fromLinked`, `fromDrawn`, `fromOSM`) → network (`realNetwork`,
which finds culvert chains) → `swmmSection` (`src/swmm-xsect.js`) → `toINP` (`[XSECTIONS]`, `[LOSSES]`, `[CURVES]`,
`[CONDUITS]` roughness and offsets).

Each network pipe with a native section carries `p.xs = { shape, g, barrels, culvert, curve, loss, prov, approx, area,
open }`.
- `prov` says where the shape, n, entrance, culvert code and losses came from.
- `approx` lists every place where the SWMM input is not the conduit as recorded.
- `net.culverts` lists the culvert chains.
- `net.stats.native` counts the sections, custom shapes, filled barrels, codes, losses, material roughness,
  approximations and refusals.

## 2. Shapes (checked against SWMM 5.2.4's source, `vendor/swmm/src/solver/xsect.c`)

| Canonical | SWMM | Note |
|---|---|---|
| circle | `CIRCULAR` D | |
| box | `RECT_CLOSED` rise, span | No span: square, flagged |
| h-/v-ellipse the source **names** as ASTM C507 (`section.standard`), of one of its sizes, not metal or plastic, no sediment | `HORIZ_ELLIPSE` / `VERT_ELLIPSE` rise, span, standard size code (1–23): **qualified** | SWMM's tabulated area and hydraulic radius for that size (e.g. 38 × 60 in, code 9, 12.90 ft², 3.7 % more than a true ellipse of those axes; its part-full tables are not an ellipse, T2). Matched to within `ellipseStdTolIn` (0.5 in) on both axes. `designation` keeps the source's standard and the solver section. **Changed 11 Nov 2026 (T2 decision):** dimensions alone no longer select a code, and an unknown material is no longer assumed concrete C507 |
| any other h-/v-ellipse (rise and span only, a size C507 does not have, metal or plastic, or silted) | `CUSTOM` exact ellipse | 41 cosine-spaced points; SWMM's area is within 0.1 % of exact (T2: normal depth within 0.15 %, full-barrel friction +0.28 % of a true ellipse). Rise and span that match a C507 size are flagged **ambiguous profile**. The Edwards Branch crossing (96 × 144 in) is one. SWMM's non-standard ellipse (area 1.2692 · minor², right only at a major/minor ratio of about 1.616) is no longer written; Stage A used it within 5 % of the true area (`ellipseTol`, removed) |
| arch | `ARCH` rise, span | SWMM's corrugated pipe-arch profile. A record gives no arch geometry, so this is an assumption, flagged always. Spans outside 1.3–1.8 × the rise are flagged again (Sheffield Dr: 3.5) |
| unknown, or an ellipse of unknown orientation | `CIRCULAR` of the rise (legacy) | Flagged |
| no size, filled by the network (rule 2) | the filled size | Flagged with where it came from |

## 3. Sediment (a scenario value)

Given per asset id (`nativeSections.sediment: { P_11292: 2.2 }`), by a function, or from `condition.sediment`.

- **Circle:** `CUSTOM`, cut exactly at the fill (`circleSediment: 'cut'`, the default since Stage B change 2).
  `circleSediment: 'filled'` writes SWMM's `FILLED_CIRCULAR` (diameter, fill depth) instead. B6 shows it carries 3–6 %
  more flow than the true silted section at the same depth, so it is no longer the default.
- **Box:** a box of the open height (exact).
- **Ellipse and arch:** `CUSTOM`, cut at the sediment and drawn from the same geometry. The arch uses SWMM's own
  `W_Arch` profile.

The conduit's invert sits on the fill. How it gets there differs by form:
- **Cut box and CUSTOM sections:** FloodSim raises both offsets by the fill depth.
- **FILLED_CIRCULAR:** SWMM raises the offsets by the fill itself (`link.c`, `conduit_validate`: `offset += yBot`), so
  FloodSim writes them unraised. `swmmSection` returns `sediment` (the depth) and `offsetRise` (what the network adds:
  0 for FILLED_CIRCULAR).

A barrel filled to its crown is refused; a blocked crossing is a scenario of its own.

**Stage B correction (11 Nov 2026), made and tested on its own.**
- **The fault:** Stage A raised a FILLED_CIRCULAR conduit's offsets as well, so SWMM put its invert twice the fill above
  the bed. In SWMM, a trickle through a 1.2 m pipe with 0.3 m of fill pooled 0.606 m deep with the double raise and
  0.306 m without.
- **Found by** reading `link.c` while designing Stage B. The Stage A area checks could not see it, because the area is
  right either way.
- **New test:** `tests/run-xsect-tests.mjs` runs that trickle in SWMM for each sediment form (filled circle, cut box,
  cut ellipse) and checks the pool sits just above the fill.
- **Scope:** nothing else in the translation changed. B6 confirms the invert in flowing water.

**Stage B change 2 (11 Nov 2026), made and tested on its own: the silted circle is cut.**
- **Why:** in B6 the cut CUSTOM circle's normal depth is within 1 mm of Manning on exact geometry (conveyance within
  0.14 %). FILLED_CIRCULAR is +10 to +31 mm deep in the same runs (conveyance +3.0 to +5.6 %).
- **Continuity:** the same for both forms (−0.9 to −1.3 % in a 24-length silted chain). It comes from the conduit
  offsets, which every sediment form needs, not from either section.
- **Tests:** `run-xsect-tests` (the cut default, the `'filled'` option, the effective invert of both); B6-1 against
  B6-1x.
- Charlotte's cached records have no sediment, so its `.inp` is unchanged.

## 4. Roughness

1. The record's own n.
2. Otherwise the material table: concrete 0.013, corrugated metal 0.024, plastic 0.012 (flagged: smooth and corrugated
   walls differ, 0.009–0.024), clay 0.013, brick 0.015, iron 0.013. Configurable per project.
3. Otherwise the network's default n.

**Fix made here:** a drawn pipe carries the drawer's default n (0.013) in its properties, and the canonical record used
to read it as user-stated. That would have blocked the material table for drawn pipes. A value equal to the drawer's
default is now `prov 'default'`. The legacy field keeps it, so default runs are unchanged. The cross-source test found
this.

## 5. Culverts: inlet control and losses

**Where.** SWMM applies inlet control at a conduit's upstream node (`culvert.c`, `dwflow.c`: only while the barrel is not
full). So a code on an interior length would put a false inlet inside the barrel.
- A culvert chain starts at a culvert entrance: a pipe head at a placed endwall or flared end with no arriving pipe
  and no grate, or an opened head.
- It runs on through nodes where one length of the same section leaves. Laterals may join there, as a catch basin
  entering the culvert does.
- A fork or a change of section ends it.
- The code and the entrance loss go on the first length. The exit loss goes on the last, and only when the chain ends
  at a real outfall: an edge outfall is a cut, not an outlet.

**Codes** (SWMM's 57-row table, rows checked against `culvert.c`; mitered codes 5/37/46 get SWMM's slope correction):

| Barrel | Codes |
|---|---|
| Concrete pipe | 1 square edge with headwall, 2 groove with headwall, 3 groove projecting |
| CMP | 4 headwall, 5 mitered, 6 projecting; 7 beveled ring |
| Concrete box | 9 wingwalls 30–75°, 10 headwall (90° flare), 11 straight sides; 15 beveled |
| Metal box | 27 / 29 |
| Ellipse | horizontal 30–32, vertical 33–35 |
| Metal arch | 45 / 46 / 47 |

No code exists for a corrugated metal ellipse. The concrete ellipse code is used, and flagged (Edwards Branch). Unknown
material takes concrete codes, and metal for an arch, flagged.

**Entrance type.** From the joined structure record at the entrance: Endwall → headwall, FES → end section, plus mitered,
projecting, beveled and wingwall. Otherwise the project default (`headwall`), marked `default`.

**Losses.**
- Entrance: HDS-5 Ke by barrel family and entrance:
  - square-edge headwall 0.5;
  - groove end 0.2;
  - projecting CMP 0.9;
  - mitered 0.7;
  - end section 0.5;
  - beveled 0.2;
  - box wingwalls 0.4.
- Exit: 1.0, configurable.
- Interior lengths: none.

**Open question for Stage B: the exit loss.** HDS-5's outlet control counts the full velocity head as lost at the
outlet. In FloodSim, the outfall's discharge goes onto a 2D cell without its momentum. That loss may therefore already
happen, and an exit loss of 1.0 could count it twice. Benchmark A–C at known tailwaters decides between 1.0 and 0.

**The surface exchange.** A culvert entrance takes surface water through a weir and orifice on the barrel. With native
sections on, that uses the barrel's real open area and span: the Edwards ellipse is 7.0 m², where the legacy
circle-of-rise gave 4.7 m². Whether this exchange stacks a second control on SWMM's inlet control is Stage B's first
question.

## 6. Verification (Stage A)

`tests/run-xsect-tests.mjs`: 68 checks, all pass. That is Stage A's 61, plus seven added in Stage B:
- the section count;
- effective-invert runs for the filled circle, the cut circle, the box and the ellipse;
- the cut-circle default and the `'filled'` option;
- the standard-size ellipse (38 × 60 in, code 9, 12.90 ft²) and a non-standard one drawn as a true ellipse.

Full CPU suite: 47 of 47.
- Shapes, roughness, codes, losses and sediment, as above.
- **Units:** 96 × 144 in from a Charlotte-style layer gives 2.4384 × 3.6576 m.
- **One culvert, three sources** (city layer, OSM tags, drawer): the same canonical record, and the same SWMM section,
  curve, code, losses and n as written to the `.inp`. A box from the city layer and from the drawer: also the same.
  - Through the network: the same pipes from the city layer and from the drawer give identical `[XSECTIONS]`,
    `[LOSSES]`, `[CURVES]` and roughness.
  - OSM culverts do not reach SWMM today; they go to `culvertFlow` (audit §2). They are checked at the translation
    level only.
- **The network:**
  - a two-length crossing is one culvert, with the code on its entrance length and the exit loss on its last;
  - the storm sewer stays round, with n from its material;
  - nodes, offsets and the pipe list are unchanged;
  - sediment by asset id raises the offsets.
- **SWMM reads it:** the native `.inp` opens without an input error. SWMM's own Cross Section Summary gives full area
  and full depth within 1 % of the intended values for:
  - circle, box and native ellipse;
  - custom ellipse, empty and at 1.0 and 2.2 m of sediment;
  - filled circle;
  - native arch.

**On Charlotte's cached records** (scratchpad regression, synthetic ground):
- **The count, in full:** 623 network pipes = 595 native sections + 0 refused + 28 links with no source record (placed
  outfall links and restored pipes).
  - Of the 595, 582 have a recorded size. The other 13 have a size the network filled from their neighbours (rule 2;
    `stats.native.sizeFilled`).
  - Stage A first refused those 13 ("no rise"), so its first report read **582 opened + 13 refused**. That is the same
    595, not a different set: after the fix they open at the filled size, flagged.
  - The test output states the same identity for its network, and the regression prints it for Charlotte.
- **Sections:** 595 native sections:
  - 571 circular, 17 box, 4 arch, 3 custom ellipses;
  - n from material on 585; 41 approximations flagged (21 plastic walls, 4 arches, 3 ellipses, 13 filled sizes);
  - SWMM opens the whole input.
- **Culverts:** 8 chains with codes.
- **The Edwards crossing:**
  - with `barrelRuns` off it is still two outfalls back to back, so it has no entrance and gets no code;
  - with `barrelRuns` on it is one culvert, east endwall to west endwall: code 30 on the entrance length (flagged:
    concrete ellipse code for a CMP), the exit loss on the last, all three lengths a custom 96 × 144 in ellipse at
    n 0.024.

**So native culvert inputs depend on the topology fix:** C2 (barrels) has to come before C1 (shape) at Charlotte.

## 7. Stage B (started 11 Nov 2026): `benchmarks/culvert/`

SWMM-alone benchmarks against an independent HDS-5 implementation. Results and the open decisions are in
`benchmarks/culvert/README.md`.
The first round's results are kept read-only in `results/baseline-2026-11-11/`. `run-all.mjs` re-runs everything and
fingerprints the translation, the engine, the definitions and the results in `results/MANIFEST.json`.

- **B2 outlet control: closed, qualified.** EXTRAN: 96 of 96 within max(5 mm, 1 %), both directions, three loss
  settings. Production's SLOT surcharge reads 3–6 % low. The pass does not cover SLOT.
- **B6 sediment: qualified.** The cut circle, box and ellipse are within 1–15 mm of normal depth. FILLED_CIRCULAR
  carries 3–6 % too much flow (hence change 2). Continuity is −0.7 to −1.3 % in deep silted chains, from offsets.
- **B1 inlet control: open.**
  - **Ellipse:** fixed by change 3. The standard size now matches in the submerged zone.
  - **Losses:** entrance + exit is the only setting that gets outlet control right. The +0.16 m is a SLOT × both-losses
    interaction on large barrels, so loss placement is unchanged.
  - **Mitered slope term:** −7 S against HDS-5's +0.7 S, i.e. +6.3 S · D. Accepted provisionally and documented.
  - **Low-flow head (up to ±0.07 m):** open and structural. It does not depend on the timestep, the outfall or the
    damping. Confirming it needs an instrumented SWMM build.
- **B7 control-regime transitions (new): open.**
  - On a mild barrel the transition is continuous.
  - On a steep barrel with the outlet submerged, SWMM switches inlet control off (`dwflow.c`, `isFull`). The headwater
    steps about 0.3 m and oscillates.
- **The coupled benchmarks (B3, B4, B5) have not started.** B1 and B7 gate them.
- **Stage A is fingerprinted but not frozen**, while B1 and B7 are open.

**Round 2 (11 Nov 2026).** The scoring was repaired, with no change to the translation:
- B1 classifies its zones from HDS-5 alone;
- B7 scores error, excursion, tailwater, energy, mass and the regime threshold;
- B1-4's reference uses the same standard-pipe geometry SWMM is given.

Two findings bear on this translation:
- **Several lengths (B8-M).** The same culvert written as 3 or 6 conduits, with the code on the first, reads 0.27–0.28 m
  lower at a submerged inlet with a free outfall than as one conduit.
  - SWMM surcharges the chain's interior junctions above the crown, where the flow should be part full and
    supercritical. That makes the first length full, so its code goes inert (`dwflow.c`, `isFull`).
  - The chain gives the same headwater with or without the code.
  - At low flow the result depends on the first conduit's length.

  The network writes multi-record crossings exactly this way.
- **Standard ellipse codes (B1-4).** SWMM's tabulated profile for standard elliptical pipe is not self-consistent: its
  area table implies a width up to 1.27 × the span. Inlet control on the standard code is irregular at part depth. The
  same axes drawn as a true ellipse match HDS-5 from Q/AD^0.5 = 1 upward. The failing rows carry the low-flow signature
  (SWMM's equation at its reported pool head gives 11–17 % less than Q), so this evidence is weaker than T1's.

Neither has been acted on; both are decisions. See `benchmarks/culvert/README.md`, round 2.

**Round 3 (11 Nov 2026).** One translation change, T1, made on its own and tested:
- **What it does.** A culvert chain's source records become one SWMM conduit per continuous physical barrel
  (`network-real.js` `mergeBarrels`; `nativeSections.mergeBarrels`, default on).
- **What it keeps.**
  - Every source record is kept on the conduit (`records`: pipe, asset, length, inverts). The canonical records are
    untouched.
  - A node is kept, with its reason recorded, if it is a lateral or fork, an outfall or edge, another entrance, a
    surface connection, a change of section or material, or an invert off the run's straight line by more than
    0.25 × rise.
  - Twin barrels stay one conduit with barrels = 2.
- **Tests.** 1, 3 and 6 records of one barrel write the same SWMM input and give the same headwater.
- **The Edwards crossing is not merged by these rules:** a grate at J373, and a lateral and a grate at J121.
- **SWMM alone on its geometry (B9):**
  - as one conduit, it is within 16 mm of HDS-5;
  - as three, it is 0.36 m low at Q/AD^0.5 = 4.
- **T2 is investigated, not changed.** The code-9 tables are inconsistent (an independent calculation: +3.7 % full
  area against a true ellipse, part-depth area −7 to +7 %). The custom curve is within 0.15 %.
- **B7-S is documented as an unsupported regime, with a proposed flag** (benchmark side only).

See `benchmarks/culvert/README.md`, round 3.

**Stage A closure (11 Nov 2026).** Three changes, none to hydraulics:
- **Invert trust.** The record count is no longer evidence. Units come, per record or layer, from the record's own
  declaration, the user's `invertUnits`, or the layer's cover evidence. Every end carries its trust (`prov.invTrust`).
- **Merged records keep their provenance:** line, nodes, invert trust, and why each joint was merged.
- **The T2 ellipse rule** (table in §2): SWMM's size code only for a source that names ASTM C507.

Charlotte's generated input is byte-identical in all four configurations. See `benchmarks/culvert/README.md`,
"Stage A closure".

## 8. Not done (later)

- **Coupled benchmarks B3–B5** and the two dedicated experiments (exit loss, stacked control), once B1 is settled.
- **App wiring:** a project setting for `nativeSections` and the sediment scenario, so runs record it in the forcing
  fingerprint.
- **Drawn and OSM culverts through SWMM** instead of `culvertFlow`.
- **Report:** `net.culverts`, `p.xs.prov` and `approx` in the H&H Report drawer.
