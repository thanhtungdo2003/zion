# Ground materials

Photographed ground layers for the terrain shader (`src/game/render/ground-textures.ts`), all CC0 from
[Poly Haven](https://polyhaven.com) (free for any use, including commercial games):

| Layer | Poly Haven texture |
|---|---|
| forest | forest_leaves_02 |
| meadow | forrest_ground_01 |
| mud | brown_mud_leaves_01 |
| sand | fine_sand_material (Sketchfab GLB, packed by `scripts/pack-ground-layer.py`) |
| cracked | mud_cracked_dry_03 |
| gravel | rocky_trail |
| rock | rock_material (Sketchfab GLB: solid cracked rock face) |
| asphalt | asphalt_02 |
| concrete | cracked_concrete |
| dirt | mud_forest |
| snow | snow_02 |
| dry | grass_ground |
| moss | stone_oxy_moss_water_01 (Sketchfab GLB: mossy stone; a 13th texture layer stored in its own colour, grown by the shader on damp, sheltered rock) |

Packed from the 1k JPGs: `<size>/<layer>-a.webp` is the albedo divided by its mean colour (×0.5, so the
palette tint stays the base), `<size>/<layer>-n.webp` holds normal X/Y (OpenGL) and roughness, and
`h/<layer>-h.png` the height (256 px, stretched to full range) for height-based blending.
`layers.json` lists the source of each layer and its mean colour.

The Sketchfab layers come from GLB materials (sources in `models/sources/ground/`); `scripts/pack-ground-layer.py`
writes their albedo / normal+roughness / height files. Check each one's licence before release (CC-BY needs credit here).
