# Character weapons and carry hooks

The survivor uses the supplied FBX recordings, retargeted from Mixamo's rest pose to the existing Rigify skeleton. Bone lengths and skin bindings are preserved. Animation extras store the original filename and SHA256 so the imported source can be verified.

| Source | Runtime clip | Use |
| --- | --- | --- |
| Rifle Idle.fbx | rifle_idle | Standing with a rifle |
| Rifle Aiming Idle.fbx | rifle_aim_idle | Stationary standing aim |
| Rifle Run.fbx | rifle_run | Moving rifle aim |
| Reloading.fbx | rifle_reload | Non-looping rifle reload, timed to gameplay reload duration |
| Fast Run.fbx | fast_run | Running without a rifle |
| Sprint Forward.fbx | rifle_sprint_forward | Forward rifle locomotion |
| Sprint Backward.fbx | rifle_sprint_backward | Backward rifle locomotion |
| Rifle Start Run.fbx | rifle_start_run | Forward departure, played once |
| Run Left.fbx / Run Right.fbx | run_left / run_right | Standing lateral locomotion |
| Rifle Kneel Idle.fbx | rifle_kneel_idle | Stationary kneeling |
| Crouch Walking.fbx | crouch_forward | Forward crouch locomotion |
| Walk Crouching Backward.fbx | crouch_backward | Backward crouch locomotion |
| Walk Crouching Left.fbx / Walk Crouching Right.fbx | crouch_left / crouch_right | Lateral crouch locomotion |
| Prone Firing Rifle.fbx | prone_rifle | Prone firing; held at frame zero between shots |
| Prone Forward.fbx | prone_forward | Crawl; reversed for backward movement |
| Prone Left Turn.fbx | prone_turn_left / prone_turn_right | Crawl turns; right derived by reflection |
| Stand To Crouch.fbx | stand_to_crouch | Standing ↔ crouching |
| Crouch To Prone.fbx | crouch_to_prone | Crouching ↔ prone |

The old file named `rifle_aim_walk.fbx` was actually Rifle Start Run. It is no longer imported or played as a looping aim animation. Forward departure completes its one-shot before switching to locomotion. Forward aiming uses Rifle Run directly. Side/back aim combines directional legs with the Rifle Run upper-body recording in world space. It never applies standing aiming locals on top of a tilted locomotion pelvis.

Posture changes follow two reversible recorded edges. Standing ↔ prone chains both edges; reversing an unfinished action reuses its current source time. Crossfades retain all contributing clip weights across interruptions. Recorded hip height replaces the old procedural lowering so crouch/prone height is not applied twice. The idle kneeling pose and crouch walking pose are separate source recordings, blended on departure/arrival.

Leg locomotion is a separate fast blend (36/s) starting on the first displaced frame, including slow movement. Its time advances by distance from the first step and retains stride phase across direction changes. Start Run only prepares the torso while the legs already run. Beginning movement cancels a stationary posture transition and selects the corresponding crouch/crawl steps immediately; it never waits for the transition recording to finish while physics moves the player.

While aiming at rest, the character root follows camera heading smoothly, with residual yaw and bounded elevation shared through the spine. Prone turns are played according to actual root turn direction/rate. Their baked heading is removed using the horizontal hip-to-chest axis (the prone pelvis forward axis is nearly vertical); gameplay owns the final heading. The derived right turn swaps anatomical sides and reflects rest-relative world rotations, preserving Rigify's asymmetric bind pose.

Rifle aim preserves recorded neck rotations instead of replacing them with an upright rest pose. A small forward torso lean and chin tuck bring the head down. A cached mesh ray measures the stock comb behind the firing grip; a bounded, smoothed rigid weapon translation seats it against the posed cheek, with both hands re-solved on the authored grip points. Arm reach constraints take precedence over head contact. Missing stocks retain the recorded pose. Run `inspect-character-rig.mjs --aim` to inspect both aim clips and report cheek-to-stock clearance.

A held rifle follows the animated firing hand, using the supplied aiming pose as the binding reference. Aiming rotates the arm about its shoulder while preserving its recorded elbow/wrist pose. The support hand reaches the authored handguard point. If necessary, the rigid gun and grip pair move into both arms' reachable space without stretching bones. The model's `zion_weapon` grip, support, axes and muzzle metadata take precedence over fallback weapon tables. Finger contact uses cached cross-sections measured from the actual weapon triangles, including irregular handle shapes, in both first and third person.

The support hand follows its recorded floor brace during posture changes and crawling, then returns to the weapon grip. Reloading retains the magazine reach, while climbing, mantling, healing, reviving, planning, swimming and driving put the weapon away so the hands can interact.

Rifle reload uses `Reloading.fbx` as an upper-body action layer over the current legs and posture. Its time scales to the weapon's reload duration and its weight fades at both ends. The gun follows the recorded firing hand while the support hand is released from the handguard. In first person, the source support wrist and elbow are mapped relative to the firing grip; the existing gun and magazine effects remain. Weapon changes and incompatible interactions cancel this layer. Other weapon classes retain their procedural reload.

First-person and behind-character mouse-look views align the standing moving root to camera heading from the first displaced frame. A smooth anatomical pelvis/chest correction removes baked sideways heading from the source recordings while preserving lean and roll. Strafing clips still select from camera-relative movement. Stationary aim continues to turn the body smoothly.

First-person rifle grip orientation comes from the supplied aiming recording. The support wrist guides its elbow plane, preserving bone lengths and the measured handguard contact. For recorded third-person arms, wrist alignment can refine the authored elbow pole by at most 0.35 radians. It cannot replace the recording's bend plane with a flipped wrist-derived plane.

Body sockets are named `carry-hook-back_right`, `carry-hook-back_left`, `carry-hook-hip_right`, `carry-hook-hip_left` and `carry-hook-chest` (label: **Móc đeo**). Survivor back/chest sockets follow `spine_003`; hip sockets follow `spine`. The reserve weapon uses the right socket and temporarily stowed gear uses the left socket. The chest socket is available for future equipment.

Both character and first-person models expose `weaponBore(origin, direction)`. Inputs sample this after the frame's animation, hand placement and camera updates. The optional `bore` input carries a muzzle offset relative to the character's feet and a unit direction. The server bounds reach, normalizes the direction and sweeps between the body and muzzle to keep shots on the player's side of cover. Bullets, bolts, rockets and flame use this origin and axis; normal weapon dispersion and subsequent gravity still apply. Inputs without a bore retain the previous server-derived origin for compatibility.

Regression coverage checks aiming across multiple walking strides, animated muzzle flight, firing against cover, first-person camera/recoil transforms, carry hooks and interaction stowing. The mesh asset and existing appearance controls are retained.

To rebuild animation assets, run these commands from the repository root:

```powershell
node apps/web/scripts/add-character-anims.mjs
packages/assets/node_modules/.bin/tsx.cmd --tsconfig apps/web/tsconfig.json apps/web/scripts/prepare-character-skin.mjs
pnpm assets:build
```

Run the skin preparation after regenerating the base character as well. It stores fitted top weights and body coverage masks inside the GLB; production loading reads the baked data instead of repeating triangle searches. Repeating skin preparation produces the same GLB hash and retains all 24 animation clips and source provenance.

For visual inspection without WebGL, run `tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/inspect-character-rig.mjs --postures`, followed by `python apps/web/scripts/render-rig.py` and `python apps/web/scripts/render-rig.py --hands`. This evaluates actual skinned vertices and weapon transforms for aim, running, strafing, kneeling and prone/crawl states. Omit `--postures` for the original six standing/locomotion poses. Images and mesh data are written to the ignored `.tmp-rig/` folder. These static renders supplement automated regression checks; they do not replace an interactive playtest.

Use `--reload` with both inspector and renderer for five source reload phases; use `--first-person` with both for the actual first-person rifle, hands and reload pose. Inspector `--diagnose` reports pelvis/chest headings and first-person wrist swing.

Grounded locomotion has no persistent world-space foot anchors. The animation clock follows measured displacement divided by the recording's stride; phase survives gait changes. Terrain nonpenetration is separate from gait timing. Slow/forward/backward/diagonal/lateral/sprint/crouch regressions verify fixed bone lengths and continuity through acceleration, deceleration and teleportation. See [locomotion research](locomotion.md).

Held firearms use the ready upper-body pose without requiring ADS, including armed jumps. World-space upper-pose smoothing and a gradual support-hand release keep transitions continuous. Contact IK transports the recorded upper/lower arm frames using shortest-arc swings instead of constructing absolute hinge frames. The upper arm receives no extra axial roll. Wrist twist is decomposed around the forearm's local Y axis, bounded to 1.6 radians and shared across its two deform bones. The actual first-person rifle is checked through hip fire, aim, running and recoil for support wrist bend and handguard contact.

Running pivots the lowered weapon at its recorded firing grip instead of rotating the entire arm behind the chest. Stock seating fades out during low ready. Both hands are then solved on the rigid gun's grips. A regression checks that the support elbow stays outside a conservative chest cross-section through multiple sprint strides and turns.

During the middle of rifle reload, the actual weapon magazine is hidden and a shared-resource copy follows the posed left palm. It blends back into the gun at insertion. Completion, interruption, weapon changes and disposal restore the original magazine and remove the carried copy.

Supplied zombie GLBs are prepared with `node apps/web/scripts/prepare-zombies.mjs`, then deployed with `pnpm assets:build`. Outputs contain no animation clips. All ten Polyart skins, Hunter and dog use the common distance-driven `CreatureLocomotion` solver. Rig aliases include hands, feet, hips and numbered spine variants. Stable entity IDs select arm styles; injury affects reach and body height. The dog's front and rear legs use a quadrupedal gait, and neither server nor renderer equips it with armour or a bucket. Skeletons are independent; geometry and materials are shared. Limb removal and ragdolls retain the final pose. Source hashes and provenance remain in each GLB; originals remain excluded from the public manifest.

## Shoulder deformation and garment binding

The previous solver replaced recorded arm roll with an absolute hinge basis. A positionally correct wrist could therefore produce a half-turn at the upper arm, collapsing skin blended across the shoulder. The revised solver applies corrections to the reference pose, retaining its roll. Bone length/contact assertions alone did not expose this problem; the regression now measures excess upper-arm axial rotation against minimal transport of the source pose.

The close-fitting top also had different skin weights from the adjacent body. `SkinSurface` transfers body influences using nearest triangle barycentric coordinates, keeps four influences, normalizes them, and preserves the garment's original geometry and clearance. Coverage uses garment triangles rather than vertex proximity so large triangles do not leave freckles of skin exposed. Facing, signed depth, boundary rejection and one-ring erosion retain exposed skin at garment edges. Packed weights sum to 255. Baked and freshly prepared coverage are compared in regression tests.

## Sources consulted

- [Mixamo](https://www.mixamo.com/): the supplied Rifle Idle, Rifle Aiming Idle, Rifle Run, Reloading and directional/posture FBX recordings remain the motion sources. Their filename/hash provenance is embedded in the GLB. No new authenticated Mixamo download was made.
- [ozz-animation two-bone IK implementation](https://github.com/guillaumeblanc/ozz-animation/blob/master/src/animation/runtime/ik_two_bone_job.cc) and [sample](https://github.com/guillaumeblanc/ozz-animation/blob/master/samples/two_bone_ik/sample_two_bone_ik.cc): reference-pose corrections, explicit bend axis/pole and fixed segment reach informed the arm solver.
- [Three.js SkeletonUtils](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/utils/SkeletonUtils.js): reference transforms and per-bone retargeting offsets informed the separation between source animation and contact correction.
- [Epic Two Bone IK](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-blueprint-two-bone-ik-in-unreal-engine): separate end-effector and joint targets, twist handling and disabled stretching informed the constraints.
- Distance-driven locomotion sources and their implementation limits are documented in [locomotion.md](locomotion.md).

## Render evidence

[Before/after shoulder comparison](character-rig/evidence/shoulder-before-after.png) uses the actual skinned model and weapon in WebGL with identical cameras. [Rifle, ADS, reload and first-person views](character-rig/evidence/rifle-and-reload.png) show the resulting contact poses. [Sprint and crawl](character-rig/evidence/sprint-and-crawl.png) show the final lowered carry and prone pose. The isolated browser review covered idle, ADS, sprint, crouch, prone, crawl and reload with no JavaScript exceptions. These images document sampled poses; they do not establish final quality for every item, terrain or camera angle. The source garment boundary still has some visible jaggedness.

## Recorded pose layer (2026-10 rewrite)

The skinned survivor no longer follows the block gameplay rig when a clip covers the whole body. `HumanBody.poseMocap` blends the recordings per bone in local space: whole-body crossfade, then the leg layer, then the upper-body overlay and action (reload). Keys are interpolated with Catmull-Rom (30 fps source; linear keys put a velocity kink at every key). While aiming on the move, the hip bounce is damped to 40% (`MocapPose.bob`).

Weapon control belongs to the body:
1. `rifleFit` calibrates each gun once from `rifle_aim_idle`: the grip sits in the firing palm, the bore runs from the firing palm towards the support palm, then swings about the grip so the stock comb (measured from the mesh) points at the recorded firing cheek.
2. Every frame the gun is `firingHand × inHand`. It never moves on its own.
3. To aim, the chest (spine_001..003) turns so the bore meets the camera direction; at low ready only the head turn is shared.
4. For ADS, the firing arm brings the gun in until the stock meets the cheek (≤14 cm), the lower neck settles the rest and the skull looks along the sights.
5. The support hand reaches its recorded grip on the handguard by two-bone IK (`placeHand`), keeping the recorded elbow plane. A wrist bent past 30° turns about the palm contact.

First person uses the same calibration: both arms come from the rifle aiming recording, the arm rig is moved rigidly so the recorded firing hand meets the view's gun, and the support hand is IK'd onto the handguard. Pistols, blades and interaction poses keep the procedural path.

Removed: partial chest following (35%) under recorded arms, cheek seating by moving the gun, `fitHeldGrips`, `turnArm` and re-gripping the firing hand on a gun that was positioned separately. These were the cause of twisted shoulders and arms pulling against each other.

Inspection without WebGL: `node apps/web/scripts/render-raw-clips.mjs clip@time ...` plays the GLB clips with a plain AnimationMixer, then run `python apps/web/scripts/render-raw.py` (add `.tmp-rig/poses.json out.png --neg` to render the inspector's poses).

### In-match stance, transitions, look-around, grenades (2026-10-23)

- In a match the rifle is always carried ready (lobby keeps the relaxed `rifle_idle`): the firing arm brings the gun to belly height with the stock against the right ribs and the bore on the aim. ADS shoulders it; sprint lowers it. Third person shots wait until the bore is within 4° of the aim (`Avatar.gunReady`); a held trigger stops the sprint so the gun comes up first.
- Transitions use critically damped springs (ADS, low carry, ready, lean) and eased crossfades (base and upper-body layers, 0.32 s for the upper body), so no change starts with a jump. Upper-body overlays crossfade as a layer list (`MocapPose.uppers`).
- Moving forward leans the chest by speed and acceleration; Start Run is no longer played (it opens leaning back).
- Looking around: head and neck follow the camera with a ~0.1 s lag, the chest takes about 30%, and the feet turn past 55°.
- First person: shoulders stay anchored out of view; both hands are placed on the gun by IK with the recorded elbow planes (the arm mesh's cut edge never enters the view).
- Grenades and small items: carried in the right palm in front of the chest; overhand throw with wind-up, release and follow-through, and the item leaves the hand at the release point.
- `node apps/web/scripts/inspect-carry.mjs` (via tsx) renders the grenade and ready poses for `render-raw.py`.

### Movement facing, melee combo, punches, climbing (2026-10-23)

| Source | Clip | Use |
| --- | --- | --- |
| Left Turn.fbx / Right Turn.fbx | turn_left / turn_right | Feet stepping while turning on the spot (leg layer, paced by turn rate; heading removed using the pelvis forward axis). Frame 0 of turn_left is the neutral stance for empty hands and melee weapons. |
| Climbing Up Wall.fbx / Climbing Down Wall.fbx | climb_up / climb_down | Ladder cycles paced by vertical speed; climb_up also covers the reach-and-pull part of a mantle. |
| Braced Hang To Crouch.fbx | hang_to_crouch | Getting up onto a ledge (second part of a mantle). Climb clips' recorded hip lift is ignored; the physics lifts the body. |
| Punching.fbx / Punching (1).fbx / Right Hook.fbx | punch_1 / punch_2 / punch_hook | Unarmed attacks, in turn. |
| Stable Sword Outward Slash.fbx | sword_slash | Blade combo step 1. |
| Thrust Slash.fbx | sword_thrust_slash | Combo step 2 (thrust, 0.3–1.2 s) and step 3 (slash, 1.2–2.4 s). |
| comboslash.fbx | sword_combo | Combo step 4: lunging finisher. |

- Moving freely (not aiming, attacking or swinging), the body turns into its direction of travel; only the head follows the camera (±55°). Aiming keeps the body on the camera and uses the directional/backpedal recordings.
- Strides are scaled by `HUMAN_SCALE` (they were measured on the source-sized skeleton), slowing cadence by 27%. Gun sprinting damps pelvis sway and bounce; empty-hand running damps arm swing (towards each clip's mean pose).
- Ready-stance gun: higher and further out (stock anchor 9 cm up, 13 cm forward of the lower ribs).
- One-handed blades (`BLADE_COMBO_WEAPONS`: katana, machete) cut a four-step combo defined in `@zion/shared` (`BLADE_COMBO`, `nextBladeStep`, `bladeStepTiming`), counted identically by server, client controller and remote avatars. Swings within 0.9 s of the previous cooldown continue the combo. The finisher deals 2.2× damage in a 1.7 rad half-angle wedge with +1.2 m reach and doubled decapitation chance, and lunges ~2.9 m via the shared physics (`Buttons.Lunge`, `lungeTicks` in the self snapshot; the server accepts the bit only for the finisher). No sprinting during any melee swing (client and server).
- Melee weapons sit in the recorded right hand with a diagonal sword grip (pommel at the heel of the palm, blade past the thumb, tilted 0.7 rad towards the forearm); the left arm is fully recorded.
- `node apps/web/scripts/inspect-moves.mjs [labels…]` (via tsx) renders these moves for `render-raw.py --neg [--big]`.

### Backpedal, attack facing, standing turns, recorded lunge (2026-10-23, revision)

- Moving away from the view backpedals with the backward recordings; only forward/sideways travel turns the body (`facesTravel`: travel ahead of the view > −0.35).
- Attacking (shoot, swing, throw; local trigger intent before the server echo) squares the body to the mouse at 12 rad/s.
- Standing still the head turns first; past 30° the feet step the body round in one smooth turn (up to 4.5 rad/s) until within 8°. The turn clips are paced by a smoothed turn rate, no per-frame toggling.
- Ready carry (not sighting): stock tucked into the armpit, gun at chest height, bore along the aim.
- The finisher's lunge replays the recorded comboslash travel tick for tick (`lungeProfile`, 2.85 m over 1.3 s; the cut lands at 0.62 s). The finisher plays at the recording's own speed so body motion and animation coincide. Combo hits and the lunge accept 160 ms of timing tolerance on the server (network jitter between consecutive clicks).
