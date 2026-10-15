# Follow-up task: weapon assets, accessories and polish

You are continuing the weapon/attachment system already built in this repo. Reuse it; do not
redesign it. Run `pnpm -r typecheck` and `npx vitest run` before and after, and report what you
changed and how you verified it (in-game where possible).

## Architecture you must follow
- **Data (shared):** `packages/shared/src/attachments.ts`.
  - Holds `ATTACHMENTS` (slot, magnification, reticle, modifiers) and `WEAPON_ATTACHMENTS` (per-gun compatibility).
  - Holds `ATTACHMENT_ORDER`, which defines the snapshot byte: append only, at most 15 entries.
  - Attachments are ordinary items (category `attachment`) in `items.ts`, sold in `shop.ts` under the `attachments` category.
  - Installed attachments live on the gun item as `PlacedItem.attachments`.
- **Inventory rules:** `InventoryModel.attach` / `detach` in `packages/shared/src/inventory.ts`, which the server runs through inventory ops `attach` / `detach`. Never add a second path that edits `attachments`.
- **Visuals:** `apps/web/src/game/render/weapons.ts`.
  - The `WEAPON_SPECS` entry of each gun gives `sight` (rear/front iron-sight tops), `rail` (optic base) and `muzzle`, all in model pixels. For GLBs these are in the file's own units.
  - The entry of each attachment gives `barrel` (toward target), `up`, `grip` (mount point), `eye` (optics) or `tip` (muzzle devices), and `length` in metres.
  - `dressWeapon()` mounts attachments for both the first-person and third-person views.
- **Aiming:** `viewmodel.ts` lines the sight line up with the eye. `weapon-mechanics.ts` drives the slide, bolt and magazine animations. The HUD reticles are in `components/ScopeOverlay.tsx`.
- **Tests that must stay green:** `apps/web/src/game/render/weapons-attachments.test.ts` checks every gun's sights, every mount and the ADS alignment. `packages/shared/src/attachments.test.ts` checks the inventory rules.

## Tasks (lower priority)
1. **Accessory models.**
   - Replace the generated placeholders in `models/accessorys/` (`scope-2x/4x/8x/10x`, `suppressor-pistol/rifle`) with proper Blockbench models.
   - Keep each file's mount point and axis, or update its `WEAPON_SPECS` entry to match.
   - Add a holographic sight (new `ATTACHMENTS` entry, `reticle: 'dot'`) if wanted.
2. **Melee models.** Replace `placeholder-machete/bat/crowbar.bbmodel` with real models. The spec entries are in `weapons.ts`.
3. **Tune the GLB guns** (Vector, P90, SCAR-L, Uzi).
   - Their grip, support, eject and sight points were estimated from geometry profiles.
   - Check them in game (first person, third person, ADS) and adjust the numbers.
   - The P90's sight sits in its integrated optic.
4. **Missing animations.** These guns have no reload clip and rely on the procedural fallback: Desert Eagle, Kar98k, Mini-14, SCAR-H and all GLBs. Author reload, fire and bolt clips where the art allows, and name the groups `magazine`, `slide` and `bolt` so `WeaponMechanics` picks them up.
5. **Stat tuning.** Balance the new guns (`packages/shared/src/weapons.ts`) and the attachment modifiers against real fights. Keep reloads at about 2.2–2.6 s.
6. **Shop previews.** In the shop's attachment detail, show the selected attachment mounted on a gun the player owns (`ModelPreview` already accepts `attachments`).
7. **Tutorial art.** Turn the night-vision pictogram (`NightVisionGuide` in `AttachmentPanel.tsx`, `NightVisionHint` in `ScopeOverlay.tsx`) into proper illustrations. Add one for "Alt / right-click a gun opens attachments".

Do not change the protocol layout, `ATTACHMENT_ORDER` positions, or the server attach/detach rules without updating the tests and bumping `PROTOCOL_VERSION`.

## Status (done in the follow-up pass)
- [x] 1. Accessory models regenerated with detail (rings, turrets, bells, glass, bands); holographic sight added (`holo_sight`, ring-and-dot reticle).
- [x] 2. Melee models: `machete`, `baseball-bat`, `crowbar` replace the placeholders.
- [x] 3. GLB guns re-measured from geometry profiles (grip, support, sights, rail); still worth an in-game look.
- [x] 4. Reload clips authored for Desert Eagle, Kar98k, Mini-14, SCAR-H (magazine / bolt / charging handle groups). GLB guns keep the procedural fallback (their parts are unnamed).
- [x] 5. Stats tuned from a DPS / time-to-kill table (Vector, P90, Uzi, SCAR-H toned down).
- [x] 6. Shop attachment detail previews the attachment mounted on a gun you carry (or a sample gun).
- [x] 7. Picture guides: `components/WeaponGuides.tsx` (Alt / right-click → attachments; night vision), shown in the shop, the inventory and the attachment screen.
