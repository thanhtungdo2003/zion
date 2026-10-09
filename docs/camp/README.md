# Forward Garrison

A roughly 100 x 100 metre first-spawn compound assembled from 769 instances of the supplied models. The editable scene is `forward-garrison.bbmodel`; `preview.html` is an offline 3D viewer with orbit, zoom, roof visibility and night lighting controls. The scene is an authoring reference; the game streams individual instances rather than loading this large scene as one asset.

## Layout and gameplay

- Outer barbed wire, inner iron palisade, patrol lane, southern checkpoint and four sandbag positions.
- Six tents, stone command post, supply warehouse, workshop, ammunition bays and solar power yard.
- Lamps illuminate the nearest surroundings at night. The game limits real lights to six near the player.
- New players spawn in the central avenue at camp-relative `(0, 23)` after server collision validation. Respawns use the same compound; valid saved positions remain intact.
- Zombies cannot spawn inside a square extending 62 metres from the camp centre (12 metres beyond the wire). The exclusion is checked after spawn-position nudging. Existing zombies can approach from outside.
- Wire hurts players and zombies for 10 HP per 750 ms of contact. Corners and overlapping fence segments do not multiply damage. Death goes through the existing server combat events.
- Brutes have 240 HP and move at 0.75 m/s while wandering, 1.25 m/s while chasing. Gaunt zombies retain normal zombie rules. Brutes survive weak headshots; normal zombies retain their existing headshot behaviour.
- Crates and ammo stations are placed as authored assets. Shared container inventory, ammo stock and their interaction UI are not implemented by this change. The current game inventory is client-local; those interactions need a separate server inventory implementation.

## Terrain and existing worlds

Generator v2 deterministically selects dry terrain, flattens the entire 108 x 108 metre foundation and blends it into the surrounding terrain over 18 metres. Natural props are excluded within 60 metres of the centre. Tiny islands can use a raised foundation when a sufficiently large dry site is unavailable.

Migration `002_spawn_camp.sql` upgrades existing v1 world records to v2 on the next normal server migration/start. This changes terrain in the selected camp footprint. It does not delete player records or reset the world clock. The v1 generator remains available for compatibility tests. All server workers use the same site selection and streamed chunks.

## Model categories

The project's existing spelling `models/materias` is retained. Root-level character, zombie and weapon models move into `characters`, `mobs` and `weapons`. `dists` contains functional world objects; `tools` contains tools. `pnpm assets:build` validates both `assets/source` and `models`, creates the hashed manifest and publishes categorized character/weapon URLs. Runtime loading now supports Blockbench box UVs as well as per-face UVs.

## Validation

Run `pnpm assets:build`, `pnpm camp:verify`, `pnpm typecheck`, `pnpm lint` and `pnpm test` before starting the game.

Verified in the staging workspace: web/server TypeScript, lint on changed TypeScript files, 41-model manifest generation, geometry creation for 29 static assets and all three zombie rigs, and the camp integration checks (nine seed/size combinations, flat dry foundation, collision-free spawn/entrance/building interiors, zombie spawn exclusion, deterministic chunk/LOD ownership and rotated barbed-wire contact).

The full Vitest run and headless browser preview could not start under the session sandbox (`spawn EPERM` / Windows access denied). Texture decoding, visual appearance and a live multiplayer session still need in-game verification. No database or source files on drive D were modified by this session.
