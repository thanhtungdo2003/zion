# Urban generation (World Studio settlements)

The settlement generator (`packages/worldgen/src/editor/settlement/`) has a third street layout, **urban**, next to `grid` and `organic`. It is selected per region in the editor ("Bố cục đường › Đô thị") and by four new presets: `vn-town`, `planned-city`, `mixed-city` and `abandoned-city`. The Auto map template now uses `mixed-city` for cities and `vn-town` for towns. Saved maps keep loading as before: every new document field is optional, and a region is only rebuilt when it is regenerated.

## Pipeline (`urban.ts`, wired into `generateSettlement`)

1. **Tensor field** (`urbanField`). Each basis field is stored as (cos 2θ, sin 2θ) and weighted by exp(−decay·d²/size²). The field adds up:
   - the planning pattern:
     - **planned**: a city grid, plus a second turned neighbourhood grid;
     - **vietnamese**: a radial field round the market plus a loose grid;
     - **mixed**: a strong grid core with a radial periphery;
   - the region's edges (streets run along them);
   - the incoming roads (the highway becomes the main street);
   - the **terrain**: on slopes the major direction follows the contour lines and the minor one climbs straight up;
   - low-frequency noise for irregular towns.
2. **Streets** (`traceStreets`). Streamlines are traced with RK4 integration, flipping each sample's sign to keep the direction consistent. Roads come in classes:

   | Class | Kind | Separation (dsep) |
   |---|---|---|
   | arterials | `main` | ≈ 2.2–2.6 × block |
   | collectors | `secondary` | ≈ 0.66–1.05 × block |
   | lanes (hẻm/ngõ, Vietnamese and mixed only) | `alley`, dead-ends allowed | — |

   - **Seeds:** points along existing streets, so every street starts at a junction and the network grows outward. Arterials start at the entry points of the outside roads and at the centre.
   - **Stopping rules:** a line stops at the region edge, at water, on impassable grade, or within dtest of a parallel street.
   - **Joining:** loose ends snap onto the nearest street ahead.
   - **Cleanup:** lines are simplified (Ramer–Douglas–Peucker). The existing joiner then links stray pieces and adds the connector to the outside network.
3. **Parcels** (`frontageParcels`). Both sides of every street get frontage lots, higher classes first so corner lots go to them.
   - **Depth:** a lot reaches halfway to the street behind, or to the edge, water or a cliff.
   - **Vietnamese frontages:** tube houses (nhà ống), 4.5–9 m wide and 14–24 m deep.
   - **Planned frontages:** regular plots with sidewalks.
   - **Wide plots:** occasional wide plots are kept for public buildings.
   - **Blocks:** each run of lots along one street side forms a block.
4. **Districts** (`planDistricts`). Seeds are spread by best-candidate sampling. Each seed gets a class by rule:
   - commercial: the core;
   - industrial: the edge, near the way out or the water, on flat ground;
   - military: its zoning share;
   - park: in planned towns;
   - residential: everywhere else.

   Lots join their nearest seed by a noise-perturbed distance, which gives organic district borders. Along main streets, lots become shop-houses. Public services go on wide plots, spaced apart: market, clinic, schools (one per ~30 ha), and an office or a temple/pagoda.
5. **Decay** (`conditionField`). A smooth noise field, raised by the decay setting, so whole streets decay together:
   - **abandoned:** the abandoned model pool, overgrown yards and weeds;
   - **ruined:** kit buildings become gutted shells (`recipe.ruin`, open upper floors) surrounded by rubble and dead trees.

   Lanes and side streets in decayed quarters get bushes and saplings breaking through their edges.
6. Buildings, fences, trees and clutter reuse the existing stages. Tube houses and public buildings use kit recipes (`urbanBuildingOptions`), so a city stays a small document.

Regenerating one settlement (or one layer of it: roads / buildings / props) only touches that region, and hand-edited items are kept.

## Research (sources and licences)

All sources were read only; no code was copied. Only the ideas below were adapted.

| Source | Licence | Used |
|---|---|---|
| TheJanusStream/symbios-tensor (Rust) | MIT | Terrain-derived tensor field (contour = major direction), grid/radial basis fields, streamline tracing with sign alignment, RDP simplification. |
| boozegar/procedural-citygraph (Python) | MIT | Hierarchy by pass (arterial → collector → local); the rule that every parcel fronts a street; best-candidate placement of centres. |
| Grzybojad/ProceduralCityGeneration (C++/UE) | MIT | Local constraints for agent-grown roads: snap ends to the network, join instead of leaving stubs. |
| tolyy/unity-chunked-bsp-city-generator (C#) | MIT | Deterministic per-area seeding (we use named streams per stage). |
| JoeMulc/Procedural-City-Gen (C++/UE) | **none** (all rights reserved) | Nothing taken beyond general ideas found elsewhere too. |
| Beneš, Wilkie, Křivánek, "Procedural Modelling of Urban Road Networks", CGF 2014 | paper | Major roads grow from the connections to neighbouring settlements (our arterials start at the incoming roads). |
| Chen et al. 2008, "Interactive Procedural Street Modeling"; Vanegas et al. 2012, "Procedural Generation of Parcels in Urban Modeling" | papers | Tensor-field streets with separation distances; street-front parcel subdivision. |

## Validation

- **Tests:** `packages/worldgen/src/editor/editor.test.ts` › "urban layout". They cover:
  - determinism;
  - a connected network with a road hierarchy;
  - lane presence by pattern;
  - street access;
  - tube-house dimensions;
  - district coherence (>70% of lots agree with their district);
  - public services;
  - ruins and spatially coherent decay;
  - the time budget;
  - document schema round-trip.
- **Preview and benchmark:** `pnpm --filter @zion/worldgen exec tsx scripts/urban-preview.ts <outDir> <seeds> [presets]`. It writes a top-down PNG per settlement and a timing/count report.
- **Typical run** (1 km hills terrain, ~650 m wide region, Windows laptop):

  | Preset | Time | Lots | Buildings | Stored result |
  |---|---|---|---|---|
  | vn-town | 0.5–0.65 s | ~450 | ~250 | 0.8–1.4 MB |
  | planned-city | 0.6 s | ~200 | ~140 | 0.8–1.4 MB |
  | mixed / abandoned city | 0.7–0.9 s | ~570 | ~300 | 0.8–1.4 MB |

  No errors (overlaps, buildings on roads or water) across 3 seeds × 4 presets.

## Limitations

- Blocks are the runs of frontage lots, not planar faces of the street graph. Deep block interiors stay as yards or green land instead of being subdivided by OBB splits.
- Hierarchy comes from the tracing pass, not from a traffic simulation or betweenness ranking.
- Streets do not get fillets or grade smoothing beyond the existing passability test and region grading.
- Rendering, LOD, collision and chunk streaming are unchanged: kit buildings are still expanded from their recipes by the existing code, and published maps are streamed by the existing chunk system. The generator only keeps its output bounded (recipes instead of parts, simplified street polylines, the building and prop caps).
