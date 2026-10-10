# Graphics lifetime and movement stalls

The progressive slowdown was investigated as a client resource problem. These fixes do not depend on latency or server tick rate.

## Confirmed defects

- Prop batches attached their instance-specific `aFade` buffer to the asset library's shared geometry. Growing a batch replaced that attribute without releasing the old GPU buffer. Each batch now owns its geometry and releases geometry and instance buffers on replacement, unload and teardown. Empty batches are removed.
- Missing prop models registered a completion callback for every prop on every rebuild. Requests are now deduplicated per asset, and late completions cannot dirty a disposed renderer.
- Coin drops and fallback projectiles allocated geometry/materials per instance without releasing them. These resources now belong to reusable templates. Grenades have an expiry fallback for missing end events.
- Particle, bullet and several session-owned resources were only detached from the scene. Teardown now releases their buffers/materials/textures, removes inventory subscriptions, disposes avatars and previews, and guards late asset/decode results. Shared avatar/armor templates are not disposed when individual clones disappear.
- Inventory previews, guide portraits and menu stages disposed renderers without explicitly releasing their WebGL contexts. All now release their contexts, including repeated mounts and asynchronous model loads finishing after closure. Guide textures and owned menu models are also released.
- Vegetation could build six chunks per update, with two updates in one frame. It now builds nearest-first, at most one chunk per frame, sharing the terrain build deadline. Collision checks for the visual vision overlay run at 20 Hz and are skipped in first person; gameplay visibility checks remain current. Prop occlusion reuses hidden flags and collider lists.

The former four-second automatic page reload after WebGL context loss has been removed. Rendering pauses until restoration, while the existing CPU scene remains available for resource reupload. A failed restoration presents a return-to-menu message instead of refreshing the page.

## Validation

- 252 Vitest tests passed, including 500 prop load/unload cycles, batch capacity growth, late asset completion, shared-resource ownership, repeated preview teardown, projectile expiry and vegetation scheduling.
- TypeScript checks passed across the workspace; ESLint passed for the changed files.
- A temporary Edge headless WebGL harness ran on Intel Iris Xe through ANGLE / Direct3D 11. Over 500 cycles, each creating a batch, growing it and removing it, retained GPU geometries returned to zero after every cycle. Thirty preview open/close cycles caused zero unexpected main-context losses. Forced context loss/restoration successfully reuploaded and rendered geometry.

These checks exercise the identified leaks and restoration mechanism. They are not a full multiplayer session lasting hours, nor verification on every mobile GPU. F3 exposes geometry/texture counts and JS heap usage for follow-up profiling: compare the same location after warming assets, travelling, returning, and opening/closing panels repeatedly. Counts should settle rather than grow on every repeat.
