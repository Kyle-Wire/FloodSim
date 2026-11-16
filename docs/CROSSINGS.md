# Stream crossings: how FloodSim represents water passing under roads

A stream that meets a road goes under it, through a culvert or under a bridge. The lidar FloodSim builds its ground
from keeps the road fill and does not show the opening, so on the raw ground every such stream is dammed. This
document says what the standard programs and specifications do about that, what FloodSim does, and where FloodSim's
choices are its own. Sources were read on 16 Nov 2026. A claim marked *(excerpt)* was seen in a search excerpt, not
in the full page.

## What the lidar gives

USGS Lidar Base Specification 2025 rev. A, *DEM Surface Treatments*
(<https://www.usgs.gov/ngp-standards-and-specifications/lidar-base-specification-digital-elevation-model-surface>):

- Bridge decks are removed from the bare-earth DEM.
- At a culvert the stream channel stops and the roadway over it stays.
- A structure that cannot be told apart is treated as a culvert.

The specification's glossary separates three surfaces. *Hydro-flattened* (what 3DEP delivers): water surfaces made
flat for appearance, not for hydraulics. *Hydro-enforced*: ground removed at bridges and culverts so water passes.
*Hydro-conditioned*: sinks removed so flow is continuous. FloodSim starts from the first and has to make the second.

## What the standard programs do

| Program | Culverts | Bridges | Water over the road | Source |
|---|---|---|---|---|
| HEC-RAS 2D 6.x | A structure line inside the 2D area; flow computed separately and linked between the cells either side. FHWA inlet-control equations. Inverts cannot be below the cells they join | Modelled in the 2D area through the same editor, low flow to pressure flow | Weir equation, or the 2D equations where the structure is low or drowned | [2D User's Manual, Hydraulic Structures Inside of 2D Flow Areas](https://www.hec.usace.army.mil/confluence/rasdocs/r2dum/latest/development-of-a-2d-or-combined-1d-2d-model/hydraulic-structures-inside-of-2d-flow-areas); [Hydraulic Reference Manual, Computing Inlet Control Headwater](https://www.hec.usace.army.mil/confluence/rasdocs/ras1dtechref/latest/modeling-culverts/culvert-hydraulics/computing-inlet-control-headwater) |
| TUFLOW | 1D culvert elements joined to 2D cells (SX); the cells must be below the invert and at least as wide as the barrel | Layered flow constrictions; the fill is cut from the ground first *(excerpt)* | In 2D once the deck overtops | [Manual 2026.3, ch. 10](https://docs.tuflow.com/classic-hpc/manual/2026.3/08-Linked-1D2D-Models.html); [wiki, 2D Hydraulic Structures](https://wiki.tuflow.com/TUFLOW_2D_Hydraulic_Structures) |
| MIKE+ 2D | Short: a head-loss structure across cell faces. Long: two linked sources. Entrance, exit and friction losses | | A separate weir at the same place | [MIKE+ 2026, 2D Culverts](https://docs.mike-plus.dhigroup.com/en/2026/2DOverland/2DOverland_HydraulicModelling/2D_Culverts/) |
| InfoWorks ICM | Culvert inlet and outlet links with FHWA HDS-5 coefficients *(excerpt)* | Bridge linear structure (2D) *(excerpt)* | In the 2D mesh | [Culvert Inlets](https://help2.innovyze.com/infoworksicm/Content/HTML/ICM_ILCM/Culvert_Inlets.htm) |
| EPA SWMM 5 | Conduit with a culvert code: FHWA HDS-5 inlet control | | ROADWAY weir | [SWMM 5.1 User's Manual, App. A.10](https://www.epa.gov/sites/default/files/2019-02/documents/epaswmm5_1_manual_master_8-2-15.pdf) |

The common ground: **the fill stays in the terrain, the culvert is a 1D link through it with FHWA HDS-5 hydraulics,
and water over the road is carried by the 2D solver or a weir.**

Where no structure is known, terrain-conditioning practice cuts the fill:

- USGS hydro-enforcement finds the depression behind road fill and cuts the fill to drain it
  ([Poppenga et al., Fact Sheet 2014-3051](https://pubs.usgs.gov/fs/2014/3051/)).
- WhiteboxTools' least-cost breaching and its stream-burning-at-roads tool do the same along the stream; the maximum
  width is left to the user ([manual, Hydrological Analysis](https://jblindsay.github.io/wbt_book/available_tools/hydrological_analysis.html)).
- NOAA's national inundation mapping burns the stream network into the terrain and treats mapped OpenStreetMap
  bridges separately ([NOAA-OWP inundation-mapping wiki, 06](https://github.com/NOAA-OWP/inundation-mapping/wiki/06.-Impacts-on-Bridges-and-Roads)).

FEMA ([General Hydraulics Considerations, Nov 2022, §3.3](https://www.fema.gov/sites/default/files/documents/fema_general-hydraulics-guidance_112022.pdf);
[2D Analysis guidance, Nov 2023](https://transportation.ky.gov/Highway-Design/Drainage%20Manual/FEMA%20-%20Hydraulics%20Two-Dimensional%20Analyses%20Guidance%20-%20Nov%202023.pdf)):
base-level studies typically run without structure dimensions; enhanced studies must use surveyed, measured or
as-built data; the source of every structure, and how each is modelled, must be recorded.

**Two things have no published standard.** No source gives a default size for a culvert whose size is unknown, and
none gives a maximum fill length for automatic cutting. Any number for either is a stated assumption.

## What FloodSim does

| Crossing | Treatment | Standing |
|---|---|---|
| Culvert with a known size (drawn or linked by the user, or mapped with `diameter` / `width`) | The fill stays. A link between the lowest ground at each end (`src/channels.js` `culvertLinks`), flow by FHWA HDS-5: inlet control with the Table A.3 entrance coefficients, outlet control with entrance, friction and exit losses (`src/culvert.js`). Circular or box, any number of barrels, an invert at each end | Matches HEC-RAS, TUFLOW, MIKE, ICM and SWMM |
| Culvert mapped without a size | The same link, with a barrel assumed from the waterway class (river 3.0 m, canal 2.5 m, stream 1.2 m, brook 1.0 m, ditch 0.6 m), a concrete pipe with a square-edged headwall | **FloodSim's assumption; no standard exists.** Each one is listed with the depth of fill over it (`src/crossings.js`) and warned about before a run |
| Mapped bridge | A rise the ground still has under a mapped bridge is cut to the stream's grade, to 80 m along the stream and 8 m high | Follows the lidar specification (decks removed) and TUFLOW's practice. Deck and pier losses are not modelled |
| Road across a mapped stream with nothing mapped | Treated as an opening and cut to grade, 3 m wide: to 30 m along the stream, or to 60 m where the fill closes the valley, and to 4 m high | Hydro-enforcement as USGS and WhiteboxTools do it. An open cut passes more than the real culvert would, so this is a screening treatment. **The limits are FloodSim's** |
| Anything still closed after that | Left as the terrain has it, and **reported**: where, how deep the water must pond to pass, whether a road is on it | FEMA's rule: an unknown structure is documented, not guessed silently |
| Water over the road | The 2D solver, over the fill that is still in the terrain | Matches HEC-RAS's 2D option and TUFLOW. HEC-RAS advises its weir equation for a high structure; FloodSim has no roadway weir |

Mapped ways that continue into each other are walked as one stream. A crossing is often mapped as its own short way
lying on top of the fill, so no single way rises and falls across it.

## What changed on 16 Nov 2026, and why

- **Culvert hydraulics.** Before, a culvert passed critical flow at two-thirds of the headwater through the full
  barrel area, with no entrance contraction. At a headwater of one diameter that is within 4 % of HDS-5. At three
  diameters it passed 7.0 m³/s through a 1.2 m pipe where HDS-5 gives 5.2: a third too much, on the side of
  under-predicting flooding behind a culvert. `tests/run-culvert-tests.mjs` checks the new routine against the
  separate HDS-5 reference written for the culvert benchmarks (`benchmarks/culvert/hds5.mjs`).
- **Whole streams.** The cutter walked each OpenStreetMap way on its own and missed every crossing mapped as a
  separate way. South Branch Pennsauken Creek's RT-1 runs pooled 4 m deep behind such a fill 70 m above the gauge.
- **Bridges.** Roads on bridges were dropped when the map was read, so the cutter could not tell a bridge from a
  ridge. They are kept now.
- **Road fills 30–60 m long.** A two-lane road crossed at an angle is 35–40 m of fill along the stream. Fourmile
  Creek and Pennsauken both had one left in place by the 30 m limit.
- **The check.** `src/crossings.js` lists what is still closed and every culvert whose size is assumed. The app
  warns when it conditions the terrain; `npm run crossings -- "<project>"` prints the list without a run.

## Open

- **Unknown culvert sizes.** The class default dams a large stream (Briar Creek: a 1.2 m barrel assumed under 8.4 m
  of fill, on a creek carrying 55 m³/s). The defensible replacement is a size from a stated design flow: FEMA notes
  that many culverts and bridges are designed to pass the 10 % annual-chance flood (General Hydraulics Considerations,
  §9), and `src/streamstats.js` already gives that flow where a drainage area is known. Not built.
- **Roadway weir.** For a high fill HEC-RAS advises a weir equation over the 2D equations. Not built; the solver
  carries overtopping as shallow flow over the 1 m ground.
- **Bridge losses.** Piers, abutments and pressure flow under a deck are not modelled.
- **RT-1.** These changes alter the conditioned terrain and the culvert flow, so the RT-1 reaches run after them are
  a new configuration under that test's rules.
