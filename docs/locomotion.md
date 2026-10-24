# Locomotion and interaction implementation

## References and choices

- [Epic: Distance Matching](https://dev.epicgames.com/documentation/en-us/unreal-engine/distance-matching-in-unreal-engine): drive animation from displacement rather than an unrelated fixed playback rate. Player recordings advance by `distance / stride * duration`; zombie gait phase advances by `distance / stride * 2π`. This borrows the distance-driven principle; it is not Unreal's curve-based Distance Matching implementation.
- [Epic: Pose Warping](https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine): separate direction, stride and terrain adaptation. Player recordings select forward/backward/lateral gaits and retain normalized phase while blending. Zombies adjust step reach and lift with speed and solve fixed-length limb chains in actor space, supporting both centimetre and metre skeletons.
- [Daniel Holden: Spring-It-On](https://theorangeduck.com/page/spring-roll-call): exponential damping avoids frame-rate-dependent transition weights. Zombie movement, running, injury posture and look use `1 - exp(-rate * dt)`. This implementation uses exponential dampers, not a velocity-carrying second-order spring.

These sources describe established real-time animation techniques. They do not establish that procedural motion alone matches a particular shipped FPS. There is no motion-matching database or newly captured performance in this change.

## Player

Foot locks have been removed. Ground clearance remains separate from motion phase; a foot cannot remain attached to an old world position during acceleration. Bone lengths are unchanged. Directional recordings remain the main body motion, with weapon grip IK layered above them.

`Prone Forward.fbx` matches the supplied file in Downloads by SHA-256. Its 2.333-second loop uses the calibrated 1.15 m/s crawl speed (about 2.683 m per loop), rather than the small source root drift. Prone motion uses one whole-body timeline instead of independently clocked legs. Floor correction is damped to avoid sudden pelvis jumps.

Running lowers the rifle. Aiming and firing block sprinting through the existing client/server weapon gate. ADS alone controls cheek placement and head tuck; hip fire uses the chest/armpit target. Hands still follow authored item grip points and reachable two-bone chains. During reload the actual magazine is copied into the left palm, then blends back into its socket; cancellation restores visibility.

## Zombies

All 12 exported GLBs have zero clips. Loading no longer needs source animations to establish bounds, and runtime no longer creates an AnimationMixer. Bind skeletons are fitted once, with numbered spine/pelvis aliases resolved across every skin.

`CreatureLocomotion` resets bind transforms before each pose, then applies distance-driven steps, hip motion, torso counterrotation, head tracking and fixed-length IK. Swing trajectories preserve endpoint velocity when changing between stance and swing. There are no world-space contact anchors. Teleports skip gait phase advancement. Attack poses overlay the arms and torso while legs keep stepping.

Stable entity IDs select both-arm, left-arm, right-arm and lower-carry styles. A removed arm reduces reach; missing legs lower the pelvis and tilt the torso with damping. The dog uses opposite front/rear leg phases and leap tuck. Dog armour and buckets are rejected during spawning and rendering. Ragdolls start from the final posed skeleton.

## Verification and remaining visual work

Regression checks cover all skins moving their actual torso/legs during attacks, fixed bone lengths, finite transforms, independent skeletons, 30/60 fps timing, teleport recovery, dismemberment and dog equipment. Player checks cover acceleration, slow steps, strafing, sprinting, crouching, prone playback, weapon grips and reload magazines.

Numerical and geometry checks are supplemented by actual WebGL renders of idle, ADS, sprint, crouch, prone, crawl and reload, including first-person hands. The sprint review exposed support-arm penetration missed by contact checks; low ready now pivots at the firing grip, with a separate elbow/chest-clearance regression. See [render evidence and IK sources](character-weapon-rig.md#render-evidence). Perceived weight on uneven terrain and every weapon/item combination still require broader gameplay review.

## Optics

The approved 4X asset is retained. `node apps/web/scripts/normalize-optics.mjs` repairs the remaining 2X, 8X, night-vision 6X and PGO-7 tube sections to concentric regular octagons, with explicit atlas faces and four-bar octagonal lenses. Existing mounts and atlases remain in use.

10X is rebuilt as a fixed-power 10x50 from the approved 4X construction, with a longer body and larger objective. It uses the same attachment metadata, +Z authoring axis, rail pivot, ocular lens group and rendering path. Magnification remains the shared gameplay 10X definition. Geometry tests check atlas bounds, ocular/eye alignment and a clear axial ray through all six optics. Run `pnpm assets:build` after regenerating models.
