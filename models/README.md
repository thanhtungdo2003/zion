# Game models

- `characters`: playable character rigs. `zion-survivor.glb` (the player's skinned survivor with its garments and hairstyle on one skeleton) is built from a ModelGen batch: `node apps/web/scripts/prepare-character.mjs <batch dir with manifest.json>`.
- `mobs`: zombies, monsters and animals.
- `weapons`: firearms, grenades and dedicated melee weapons.
- `accessorys`: weapon attachments (existing directory spelling retained). `scope-4x32.bbmodel` comes from ModelGen Gun Studio's `4x32-fixed-power-riflescope-with-picatinny-one-piece-mount` project at 320 px/m. Round sections retain exact subpixel panel geometry and integer per-face texture UVs; regenerate with the corrected `src/gun/geometry.ts` and `src/gun/export-bbmodel.ts` in `D:/AEMINE_PROJECT/model-generator`.
- `tools`: tools which may also be used as weapons.
- `materias`: building materials and decoration (existing directory spelling retained).
- `dists`: world objects with special functions, such as lamps, storage crates, ammo stations and damaging wire.

Edit source models here. Run `pnpm assets:build` to publish them; do not maintain copies in `apps/web/public` manually. Registration alone does not implement an object's interaction. See `docs/camp/README.md` for the current gameplay scope.
