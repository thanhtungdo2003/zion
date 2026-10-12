# Terrain generation v3

Version 3 reduces the mountain ridge contribution by 58% and adds seeded dirt routes from the camp's southern gate to reachable settlements. Roads favour contours, round bends, and grade their bed to a maximum longitudinal slope of approximately 24%. Building foundations retain priority over road grading.

The carriageway is 4.8 metres wide, with two-metre grassy shoulders, faded wheel tracks, and moss. Trees, rocks and ammo caches leave the road clear. Exposed sections receive wooden fences or occasional corrugated metal barriers. Separate islands remain unconnected.

## Applying the update

Run `pnpm db:migrate` with the server's database configuration, then restart the server and update the web client together. Migration `016_terrain_roads.sql` upgrades existing version 2 worlds to version 3 while retaining their seed and player data. Terrain changes; joining players use the existing position validation. New worlds default to version 3. Version 1 and 2 generation remain available for explicit legacy configurations.

The shared protocol is now version 18 because the terrain surface palette has new values.

## Preview and checks

Run `pnpm world:preview --seed zion-alpha --size 128 --mpp 4`. The preview overlays road centre lines and reports the number of routes and connected settlements. PNG output is ignored by Git.

Road tests cover connectivity, grades, transverse roadbed continuity, surface types, fences, streamed terrain heights, reduced mountain relief and legacy generation.
