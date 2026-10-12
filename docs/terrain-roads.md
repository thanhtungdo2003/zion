# Terrain generation v4

Version 3 reduces the mountain ridge contribution by 58% and adds seeded dirt routes from the camp's southern gate to reachable settlements. Version 4 extends this network with alternate routes and straight shore-to-shore bridges up to 512 metres long. Roads favour contours, round bends, and grade their bed to a maximum longitudinal slope of approximately 24%. Building foundations retain priority over road grading.

The carriageway is 4.8 metres wide, with two-metre grassy shoulders, faded wheel tracks, and moss. Trees, rocks and ammo caches leave the road clear. Exposed sections receive wooden fences or occasional corrugated metal barriers. Reachable islands are connected where the crossing budget and shore ramp clearance permit.

Large bridges have a 16-metre deck with eight metres of unobstructed two-way roadway, faded centre markings, mossy shoulders, railings and stacked red steel piers. Short bridges have a six-metre deck and a four-metre clear corridor, with seeded wood, stone or asphalt construction. Crossing footprints reserve enough space for their shoulders and refuge bays, so separate bridges do not intersect. Bridge surfaces use static colliders; riverbeds and water remain below, with dry abutments eased into the road. Tile overlap prevents tiny gaps after network quantization.

Some long bridges have an eight-metre-wide side refuge bay. Tents, crates, barrels and full-size tanks or buses stay in these bays. Small wrecks and motorcycles can park on the regular shoulders. These vehicles are scenery; driving controls are not part of this update.

Vehicle proportions are corrected in asset metre space, including their collision volumes:

| Vehicle | Approximate dimensions |
| --- | --- |
| Motorcycle | 2.15 m long, 0.85 m wide, 1.25 m high |
| Wrecked car | 4.5 m long, 1.8 m body width (2.4 m including open doors), 1.75 m high including bent panels |
| School bus | 10.5 m long, 2.5 m wide, 3.2 m high |
| Tank | 9 m long including barrel, 4.2 m wide, 3.6 m high including equipment |

The school bus is authored along X; its placements turn it to align with the road. Tank proportions also update existing camp-kit placements.

## Applying the update

Run `pnpm assets:build`, then `pnpm db:migrate` with the server's database configuration, and restart the server and update the web client together. Migration `016_terrain_roads.sql` upgrades version 2 worlds to version 3; `017_bridge_network.sql` upgrades version 3 to version 4 while retaining their seed and player data. Terrain changes; joining players use the existing position validation. New worlds default to version 4. Versions 1, 2 and 3 generation remain available for explicit legacy configurations, though the updated tank visual/collision dimensions apply globally.

The shared protocol is now version 19 to require the updated asset and collision definitions on both client and server.

## Preview and checks

Run `pnpm world:preview --seed zion-alpha --size 128 --mpp 4`. The preview overlays road centre lines and reports the number of routes and connected settlements. PNG output is ignored by Git.

Road tests cover connectivity, actual loops, grades, transverse roadbed continuity, surface types, fences, streamed terrain heights, reduced mountain relief and legacy generation. Bridge tests cover water preservation, deck clearance, chunk seams, protected traffic corridors and two-way navigation through the abutments. Vehicle tests load the real model geometry and compare dimensions with collision bounds.
