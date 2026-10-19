# Ground materials

Photographed ground layers for the terrain shader (`src/game/render/ground-textures.ts`), all CC0 from
[Poly Haven](https://polyhaven.com) (free for any use, including commercial games):

| Layer | Poly Haven texture |
|---|---|
| forest | forest_leaves_02 |
| meadow | forrest_ground_01 |
| mud | brown_mud_leaves_01 |
| sand | coast_sand_01 |
| cracked | mud_cracked_dry_03 |
| gravel | rocky_trail |
| rock | rock_ground |
| asphalt | asphalt_02 |
| concrete | cracked_concrete |
| dirt | mud_forest |
| snow | snow_02 |
| dry | grass_ground |

Packed from the 1k JPGs: `<size>/<layer>-a.webp` is the albedo divided by its mean colour (×0.5, so the
palette tint stays the base), `<size>/<layer>-n.webp` holds normal X/Y (OpenGL) and roughness, and
`h/<layer>-h.png` the height (256 px, stretched to full range) for height-based blending.
`layers.json` lists the source of each layer and its mean colour.
