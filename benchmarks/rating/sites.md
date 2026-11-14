# RT-1 sites (registered 14 Nov 2026; see REGISTRATION.md)

Screening: `screen.mjs`, output `candidates.json`. 21 of about 350 gauges in the eight regions meet README rules 1–4.
Rules 5 (no controlling structure) and 6 (no major tributary between the inflow edge and the gauge):
`check-sites.mjs`, output `structures.json`. It lists OpenStreetMap features within 40 m of the NHD main stem, 2 km
upstream and 5 km downstream (USGS NLDI). Run 14 Nov 2026, 14:22 EST, against overpass-api.de.

Ranking: max direct Q / Q2, then count. At most two per region.

## Limits of the check

- **OpenStreetMap only.** The USACE National Inventory of Dams and the USGS station descriptions have not been read
  yet. A missing feature in OSM is not proof there is none.
- **Tributary size is not known.** OSM does not say how big a joining stream is. Where a join falls inside the planned
  1 km upstream domain it is listed for a look at the map. Joins named like the main stem ("North River" on North River)
  are split or braided ways of the main stem, not tributaries.
- **Short lines.** At some sites the NLDI line ends before 5 km: at a lake or confluence, or where its points jump by
  more than 500 m. Those are noted below. A short line means the check there is incomplete, not clean.
- **Beyond 5 km downstream nothing is checked.** On flat Iowa rivers 5 × depth / slope can exceed 5 km. The
  boundary row (README) is what catches a downstream control outside the window.

## Picks

| Region | Site | Name | Reach | Class (bridge, distance from the gauge point) | What the check found | Open points |
|---|---|---|---|---|---|---|
| IA | 05470000 | South Skunk River near Ames | 4.17 | bridge section (W Riverside Rd, 28 m) | two weirs at +5.3 km; small unnamed joins at −0.66 and +2.65 km | Does the +5.3 km weir reach the gauge at low flow? The boundary row decides; low flow is unscored anyway |
| IA | 05486000 | North River near Norwalk | 3.33 | bridge section (County Rd R57, 33 m) | nothing on the main stem; unnamed join at −1.2 km | line ends at +4.8 km |
| CO | 06709530 | Plum Creek at Titan Rd near Louviers | 2.17 | bridge section (W Titan Rd, 22 m) | a 9 m culvert tagged "Plum Creek", intermittent, at +3.5 km: a side channel under a road, not the main channel, which is a wide sandy bed here; unnamed join at −0.27 km | upstream line only 0.57 km long |
| CO | 06730200 | Boulder Creek at N 75th St | 1.08 | bridge section (N 75th St, 12 m) | Boulder Feeder Ditch joins at −0.78 km; a split of Boulder Creek at −0.47 km | downstream line only 0.79 km: incomplete. Inflow edge placed below the ditch. The NHD line runs more than 40 m from the bridge, so the line and the channel differ here |
| PA/NJ | 01481000 | Brandywine Creek at Chadds Ford | 1.82 | bridge section (disused bridge, 40 m) | weir at −0.42 km (upstream: not a control on the gauge, but inside a 1 km domain); Harvey Run joins at +26 m | the inflow edge must sit below the weir, so the upstream length is about 0.4 km, short of the 1 km rule |
| PA/NJ | 01467081 | S Br Pennsauken Creek at Cherry Hill | 2.05 | bridge section (West Mill Rd, 0 m) | nine main-stem culverts upstream from −1.9 km; the culverts flagged near +0.5 km are on two small tributaries from the south, joining at about +0.2 and +0.45 km. The named main stem runs on without a tunnel tag. No dam or weir within 2 km (OSM); a swamp lies to the south-west | cleared for rule 5 from the OSM geometry, not imagery. Two small joins inside the downstream reach |
| TX | 08183978 | Cibolo Creek at Specht Rd | 1.62 | bridge section (Specht Rd, +99 m) | Kelly Creek joins at −0.65 km; low-water crossing at −2.3 km | Kelly Creek is inside the 1 km domain (rule 6), unless the edge goes below it (0.6 km upstream). Weakest reference: 12 direct measurements, 1 Good |
| NC | 0214645022 | Briar Creek above Colony Rd | 0.84 | bridge section (service road, 0 m) | main-stem culverts at −0.32 and −1.1 km; a branch joins at −0.30 km | inflow edge must go below −0.32 km: upstream length about 0.3 km, short of the 1 km rule |

## Passed over or excluded

| Site | Name | Reach | Decision | Reason from the check |
|---|---|---|---|---|
| 05470500 | Ioway Creek at Ames | 5.78 | **excluded** | weir at the gauge (0 m): rule 5 |
| 05485640 | Fourmile Creek at Des Moines | 4.55 | passed over | the line ends 1.3 km downstream at the Des Moines River: backwater from the main river |
| 06710605 | Bear Creek above Bear Creek Lake | 2.64 | **excluded** | the line ends at the lake 1.65 km downstream: reservoir control, rule 5 |
| 05471200 | Indian Creek near Mingo | 2.45 | first IA reserve | bridge section (SH 117); Wolf Creek joins at −1.3 km; downstream line only 0.65 km, incomplete |
| 05485605 | Fourmile Creek near Ankeny | 2.20 | IA reserve | many unnamed joins upstream; one at −87 m |
| 05484800 | Walnut Creek at Des Moines | 2.16 | IA reserve | Blue Creek at −1.9 km; 63rd St bridge at −0.3 km |
| 05481950 | Beaver Creek near Grimes | 1.91 | IA reserve | unnamed culvert at −54 m |
| 06719505 | Clear Creek at Golden | 1.56 | **excluded** | rapids (kayak drops) through the gauge; weirs from +1.5 km: rule 5 |
| 01467150 | Cooper River at Haddonfield | 1.46 | **excluded** | Evans Pond Dam −0.26 km, Wallworth Lake Dam +0.45 km: rule 5 |
| 06724970 | Left Hand Creek at Hover Rd | 0.92 | first CO reserve | bridge section; nothing else, but the line is only ±1.2 km |
| 08168932, 08168913 | Comal River near Landa Lake | 0.84 | **excluded** | spring-fed; weir at −0.18 km, dam at −9 km, Landa Lake: rule 5 |
| 08170500 | San Marcos River at San Marcos | 0.59 | **excluded** | Aquarena Dam −0.12 km, Rio Vista Dam +1.6 km: rule 5 |

Oregon, Georgia and WV/VA: no eligible site. Their high-flow measurements are Poor-rated.

## Dam inventory and gauge position (14 Nov 2026)

- **NID** (USACE National Inventory of Dams, HIFLD layer, dams within 150 m of the line): nothing on any pick or
  reserve. It confirms Evans Pond Dam (Cooper), Landa Park Lake Dam (Comal), and Aquarena and Rio Vista dams (San
  Marcos). It adds Hopkins Lake Dam (Cooper, +1.0 km).
- **Every pick is a bridge section.** Each gauge point is 12–41 m from the named road bridge, so the open-reach class
  (README) has no site. The bridge-section results are the whole of RT-1 as it stands.
- **Position.** USGS gives these gauges horizontal accuracies from ±0.01 s to ±1 min (Boulder, Left Hand). Each sits
  at its named bridge, though, so the bridge fixes the position better than the code. The model is read in a ±50 m
  window along the channel around the bridge, replacing the README's ±1 s.
- **Datum.** Every pick is NAVD88 by survey-grade GNSS, accuracy 0.05–0.18 ft.
- **Station descriptions** (the USGS manuscript: gage type, control, datum history) are not in the Water Data API,
  and the annual-report PDFs at wdr.water.usgs.gov return 404. Not read.

## Short upstream reaches (decided 14 Nov 2026)

Brandywine (weir −0.42 km), Cibolo (Kelly Creek −0.65 km) and Briar (culvert −0.32 km) keep their place. The inflow
edge goes just below the structure or join. The README inflow row (level changes < 0.02 m when the edge moves 100 m)
decides whether that length is enough, else the site is Insufficient.

## Registration

Fixed on 14 Nov 2026 with the README thresholds: see `REGISTRATION.md`. No site is added or dropped after a result
is seen.
