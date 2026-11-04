# Forest Hills, Queens: reference flood maps

Flood maps for the *Forest Hills, Queens NY* example (box −73.870, 40.702 to −73.828, 40.748), clipped from public
data, to load with Calibrate → *Import flood map* (`src/floodmaps.js`). docs/METHODS.md §5.9–5.10 has the results.

| File | What | Source |
|---|---|---|
| `usgs-ida-forest-hills.geojson` | Peak depth after Ida (1 Sept 2021) at 13 surveyed high-water marks: each mark's level less the lidar ground within 250 m of it. `depth_m`: the centre of a 0.25 ft band (m); features with `mask: true`: the 250 m mapping buffers, outside which the map says nothing. | U.S. Geological Survey, Capurso, W.D., and others, 2023, doi:10.5066/P9JF4OWB (Inundation_Map_Data feature service). Public domain. |
| `dep-moderate-current-forest-hills.geojson` | NYC DEP Stormwater Flood Map, Moderate Flood (2.13 in/hr), current sea level. `Flooding_Category` 1: 4 in to 1 ft; 2: 1 ft and over. | NYC Department of Environmental Protection, NYC Stormwater Flood Maps, NYC Open Data 9i7c-xyvv. NYC Terms of Use. |
| `dep-extreme-2080-forest-hills.geojson` | The same for the Extreme Flood (3.66 in/hr) with 2080 sea level rise (the box is inland: the sea level does not reach it). | As above. |

How they were made:

- **USGS.** The service's depth layers are the depth raster turned into pixel squares, one feature per depth value
  (about 50 MB and 500,000 squares a mark), too much to fetch in the app. Each mapped mark's layer was downloaded
  whole, its squares merged into 0.25 ft bands and simplified to 0.75 m, parts and holes under 2 m² dropped
  (GeoPandas / Shapely), and the 250 m buffers of the mapped marks added as masks. Against the squares, each mark's
  flooded area is within 1–6 % (22.3 ha in all) and its mean depth within 1 cm. One mark's map, NYQUE31290 (6 m²),
  drops out. Two marks in the box (NYQUE31276, NYQUE31277) have buffers but no depth layer.
  The maps are made from the marks, so a score against them is not independent of the marks' own.
- **DEP.** The citywide file geodatabases (NYC Open Data, *NYC Stormwater Flood Maps*), category 3 (future high tides)
  dropped, clipped to the box, reprojected to WGS 84, coordinates to 1e-7°. DEP made them with InfoWorks ICM (1D
  sewers, 2D surface) for a design storm whose hyetograph it does not publish, and kept patches of 0.25 acre and over:
  the scoring drops model patches under that size too. They are another model's answer, not observations.
