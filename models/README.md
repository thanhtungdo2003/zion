# Game models

- `characters`: playable character rigs.
- `mobs`: zombies, monsters and animals.
- `weapons`: firearms, grenades and dedicated melee weapons.
- `tools`: tools which may also be used as weapons.
- `materias`: building materials and decoration (existing directory spelling retained).
- `dists`: world objects with special functions, such as lamps, storage crates, ammo stations and damaging wire.

Edit source models here. Run `pnpm assets:build` to publish them; do not maintain copies in `apps/web/public` manually. Registration alone does not implement an object's interaction. See `docs/camp/README.md` for the current gameplay scope.
