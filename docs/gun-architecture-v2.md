# Task: Rebuild the FPS Weapon, Aiming, Animation & Attachment System

## 1. Audit First
Inspect the existing game architecture, weapon rendering, inventory, shop, input handling, animation pipeline, and all weapon/accessory assets before making changes. Identify reusable systems and dependencies. Preserve existing gameplay functionality and avoid unnecessary rewrites.

Primary weapon model to revise:
`D:\MyProjects\dayz\models\weapons\ak47-rifle.bbmodel`

New weapon assets:
- `D:\MyProjects\dayz\models\weapons\desert-eagle.bbmodel`
- `D:\MyProjects\dayz\models\weapons\fn_scar_free.glb`
- `D:\MyProjects\dayz\models\weapons\kar98k-rifle.bbmodel`
- `D:\MyProjects\dayz\models\weapons\kriss_vector_ver2.0.glb`
- `D:\MyProjects\dayz\models\weapons\lowpoly_uzi_imi.glb`
- `D:\MyProjects\dayz\models\weapons\mini-14-rifle.bbmodel`
- `D:\MyProjects\dayz\models\weapons\p90_free.glb`
- `D:\MyProjects\dayz\models\weapons\scar-h-rifle.bbmodel`

Accessory assets directory:
`D:\MyProjects\dayz\models\accessorys`

Discover any additional unfinished weapon models in the project and include them in the implementation.

## 2. Rebuild Weapon Models & First-Person Aiming
Redesign the existing weapon models and animations for a polished, modern FPS experience while preserving their distinctive silhouettes and voxel/low-poly art style.

- Remove permanently embedded scopes and detachable optics from base weapon models. Every newly purchased weapon starts without attachments.
- Keep iron sights and front sights on weapons that use them by default.
- Model detachable optics, suppressors, and other accessories as separate assets in the accessory directory.
- Establish correct weapon grip, camera alignment, sight height, eye position, and aiming transforms.
- When aiming down sights (ADS), smoothly raise and align the weapon so the selected sight's reticle or front sight is precisely centered and aligned with the player's viewpoint.
- Weapons without optics must support accurate iron-sight aiming.
- Prevent visible sight misalignment, excessive clipping, camera obstruction, and inconsistent aiming between weapons.

## 3. Weapon Attachment System
Build a data-driven attachment system with weapon-specific compatibility rules.

- Support optics, suppressors, and other appropriate attachments.
- Define attachment slots, compatibility, stat modifiers, mounting positions, and transforms per weapon.
- Attachments must appear in the correct physical position on the weapon model.
- Incompatible attachments must be rejected.
- Support removing, replacing, and inspecting attachments without duplicating or losing inventory items.

### Controls and interface
- Press configurable `Alt` while holding a weapon to open its dedicated attachment interface.
- Right-click a weapon in the inventory to open the same interface.
- Display the weapon model in the center with clearly identifiable attachment slots surrounding it.
- Allow players to install, remove, and preview compatible accessories.
- Provide visual feedback for occupied slots, incompatible accessories, and stat changes.
- Integrate an attachment category into the shop, including weapon-specific accessory compatibility.
- Add a **View Attachments** action to weapon shop listings so players can preview compatible accessories before purchasing.
- Keep the default weapon configuration attachment-free unless explicitly defined otherwise.

## 4. Optics & Reticle Behavior
Implement distinct aiming behavior based on the equipped optic.

- **Iron sights:** use the weapon's physical front and rear sights. Align the front sight with the center aiming point.
- **Red Dot / Holographic Sight:** render a custom, crisp red reticle directly through the optic window. Do not bake the reticle into the 3D texture. Calibrate it to the actual aiming ray and camera.
- **Magnified scopes (2x, 4x, 6x, 8x, 10x):** implement appropriate magnification, a circular scoped view, and a calibrated reticle with graduated markings. Support scope-specific zoom levels and sensible sensitivity scaling.
- Ensure that aiming ray, reticle position, weapon orientation, bullet trajectory, and hit detection remain consistent. Avoid fake zoom effects that do not correspond to actual aiming behavior.

## 5. Night Vision Scope
Implement a new weapon-mounted Night Vision Scope using the accessory assets directory.

- Default state: a functional 6x magnified scope.
- Toggle night vision using `M` by default, with configurable mouse wheel up/down bindings if compatible with existing controls.
- In night vision mode, apply a green-tinted scoped view and enhance the visibility of players, NPCs, and mobs inside the optic.
- Keep the effect confined to the scope view, with appropriate masking, brightness, contrast, and visibility falloff.
- Switching night vision on/off must preserve the scope's magnification, aiming alignment, and normal rendering outside the optic.
- Avoid making targets visible through walls or revealing entities that should remain occluded.
- Add visual, image-based instructions showing how to activate night vision and switch modes. Do not rely on text-only tutorials.

## 6. Weapon Animations
Implement or improve first-person weapon animations where supported by the source assets and existing animation pipeline.

- **Firing:** recoil, muzzle response, weapon kick, and recovery.
- **Reloading:** magazine removal/insertion or the appropriate weapon-specific reload sequence, with synchronized ammunition state.
- **Additional animations:** bolt cycling, charging handles, slide movement, and other mechanisms when appropriate and feasible.
- Support smooth transitions between idle, aiming, firing, and reloading.
- Prevent animation conflicts, incorrect magazine states, and firing during prohibited reload phases.

If a model has no usable animation, create a suitable animation when practical; otherwise use a clean procedural fallback rather than blocking the entire implementation. Never claim an animation is complete unless it actually works in-game.

## 7. Integrate New Weapons & Balance
Import and configure every listed weapon, plus any additional unfinished weapon assets discovered during the audit.

- Validate file formats, model scale, orientation, materials, textures, pivots, and import compatibility.
- Configure weapon categories, damage, fire rate, recoil, accuracy, magazine capacity, reload duration, range, and attachment compatibility.
- Preserve meaningful distinctions between pistols, SMGs, assault rifles, battle rifles, and bolt-action rifles.
- Balance weapons against the existing game economy and combat pacing instead of assigning arbitrary identical stats.
- Ensure every weapon can be equipped, fired, reloaded, aimed, purchased, and inspected through the existing game systems.

## 8. Validation & Deliverables
Test the complete workflow in the actual game, not just in a model viewer.

Verify:
- Every weapon loads without asset or console errors.
- Iron sights, red-dot reticles, and magnified scopes align correctly.
- Bullet trajectories match the aiming point at the weapon's intended zeroing distance.
- Attachments can be purchased, equipped, removed, and persisted correctly.
- Shop previews reflect actual compatible attachments.
- Night vision toggles correctly without affecting unrelated rendering.
- Firing and reloading animations remain synchronized with gameplay state.
- Existing inventory, shooting, multiplayer synchronization, and shop functionality remain intact.

Fix regressions introduced by the implementation. Run the available automated tests and perform practical in-game verification. Report completed features, unresolved limitations, and test results honestly.

## 9. Delegate Secondary Tasks
After the core architecture, aiming system, attachment framework, and night vision scope are implemented and validated, create a separate concise task prompt for another AI agent to handle lower-priority work, such as importing remaining assets, creating accessory models, tuning individual weapon stats, improving shop previews, and adding visual tutorial illustrations.

The secondary agent must follow the established architecture, reuse existing systems, avoid conflicting edits, and report its changes and validation results.

**Priority order:** existing-system audit → aiming and camera alignment → attachment architecture → optics and reticles → weapon animations → night vision → new weapon integration and balance → shop UI → secondary task delegation.

Work incrementally, verify each major subsystem, and prioritize functional, maintainable gameplay systems over superficial visual changes.