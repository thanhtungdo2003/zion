# Engine architecture, physics audit and status

This document is the audit and architecture report required by `big-cooking.md` (sections 13–15).
It records what ZION already had, what this pass built, and what is still open. Measured numbers
come from the commands listed under [Tests and benchmark](#tests-and-benchmark); nothing is claimed
without one.

## 1. Current architecture

ZION is a pnpm monorepo. The server is authoritative; the browser and the Electron desktop shell
run the same web client.

| Module | Where | Responsibility |
|---|---|---|
| Core loop | `apps/server/src/game/game-server.ts` | 30 Hz fixed tick with an accumulator (at most 4 catch-up ticks, then the backlog is dropped), snapshots every 2 ticks, interest management by chunk grid. |
| Collision & queries | `packages/physics` (`world.ts`, `shapes.ts`, `geometry.ts`, `spatial-hash.ts`, `hit-mesh.ts`) | Own `CollisionWorld`: heightfield terrain per chunk, sphere/capsule/box (yaw or full basis) colliders in a spatial hash, layers + masks, raycast, shape sweeps, overlap queries. Model-triangle solids for uploaded maps and per-prop hit meshes, so shots pass real gaps. |
| Character controller | `packages/physics/src/character.ts` | Capsule controller shared by server and client prediction (step-up, slopes, crouch/prone, mantle, roll, swim, ladder). |
| Hit regions | `packages/physics/src/hitbox.ts` | Per-zone capsules separate from the movement capsule, posed from the authoritative or lag-compensated transform. |
| Vehicles | `packages/physics/src/jolt-vehicles.ts` | Jolt Physics (WASM) rigid bodies with a wheeled `VehicleConstraint`: engine, gearbox, differentials, anti-roll bars, friction-curve tyres, cylinder-cast wheel contacts, linear-cast CCD. An arcade fallback (`vehicles.ts`) can be switched on live from the Studio. |
| Projectiles | `packages/physics/src/projectile.ts`, `apps/server/src/game/ballistics*` | Hitscan with lag compensation; slow rounds and grenades simulated against the same `CollisionWorld`. |
| Rendering | `apps/web/src/game/render/*` | three.js WebGL2: PBR (`MeshStandardMaterial`), sun shadow maps by quality, GTAO + bloom + sun shafts in the optional shader pack, LOD terrain, instanced vegetation, sky with separate cloud layer. |
| Animation | `human-rig.ts`, `avatars.ts`, `locomotion.ts`, `fp-hands.ts`, `creature-locomotion.ts` | Mocap clips with distance-driven gait phase, blend layers, two-bone IK on weapon grips, procedural zombie locomotion, Verlet ragdolls on death. |
| Networking | `packages/shared/src/protocol`, `apps/web/src/game/net`, `prediction.ts`, `interpolation.ts` | Binary snapshots, JSON events, client prediction + reconciliation of the local player, timeline playback of remote entities and vehicles. |
| Profiling | F3 panel (`frame-profiler.ts`), server `/metrics` | Frame update/render/GPU time, draw calls, TPS; server tick avg/p99/max and overruns. |

## 2. What already existed

- **Physics engine:** Jolt Physics 1.1 (WASM) for vehicles only. Everything else (players, zombies,
  grenades, props) used the custom `CollisionWorld`.
- **Vehicle physics (section 7 of the brief):** already a real rigid-body model. Mass, low centre of
  mass, spring-damper suspension with travel, longitudinal/lateral tyre friction, weight transfer,
  roll from torque, wheel contact loss, flipping, vehicle-vs-vehicle collision, CCD. No rotation is
  reset while simulating; the only reset is the fall-through guard (a body more than 1.5 m under the
  terrain is put back on it).
- **Visual vs collision geometry (section 4):** separate per asset (`colliders` in the asset schema),
  hit meshes for shots, model-triangle solids for uploaded maps, vehicle colliders built from parts
  (pillars, sills, roof) rather than one box.
- **Knocked props:** removed from the collision world and thrown on each client as cosmetic debris
  with a hand-written integrator (`render/debris.ts`): no mass, no server state, every client saw a
  different flight.
- **Weapon reload jolt:** one spring with the same constants and kicks for every gun
  (`viewmodel.ts`), i.e. exactly the "fixed random value for every weapon" the brief rules out.

## 3. Reused unchanged

`CollisionWorld`, the character controller, hit meshes and hitboxes, the Jolt vehicle model, the
fixed server tick, snapshot interpolation, the render pipeline and its quality settings. None of
them needed replacing; the brief's rule against rewrites without a measured reason applies.

## 4. Built in this pass

### 4.1 Free rigid bodies (sections 3, 6.2, 7.3, 8, 10)

- `packages/physics/src/rigid-body.ts`: surface materials (friction, restitution, density), physics
  proxies built from an asset's own colliders (each collider one convex part, at most 8, else one
  bounding box), mass/volume/inertia helpers, pose maths, collider tags for dynamic bodies.
- `JoltVehicles` now also owns free dynamic bodies in the same Jolt system as the vehicles:
  compound proxy shapes, mass with shape-derived inertia, material friction/restitution, linear
  damping as air drag only, linear-cast CCD, sleeping/waking (Jolt's), a budget of
  `MAX_FREE_BODIES` (96), fall-through and water-drag guards, and per-step statistics.
- Mirrored static colliders that leave the `CollisionWorld` (a knocked prop, a rebuilt chunk) are now
  dropped from Jolt in the same step instead of lingering for the 3 s grace period, which had left
  invisible obstacles in front of vehicles.
- Server `FreeBodies` (`apps/server/src/game/free-bodies.ts`): a knocked light prop becomes a body
  where it stood, with a per-asset mass and material table (`PROP_PHYSICS` in `prop-knock.ts`).
  - Vehicles shove it through Jolt contact by mass and closing speed (no scripted fling).
  - A bullet applies its momentum (scaled 2.5× for readability) at the hit point, so off-centre hits
    spin it; a blast applies an impulse on its real mass.
  - Walkers push it with a soft contact at hip height (tall things tip over).
  - Its proxy stands in the `CollisionWorld` on the new `Layer.Dynamic`: shots (`Mask.Weapon`) and
    placement meet it, walking does not (walkers push instead of being stopped).
- Networking: `BodiesMessage` sends `[id, asset, scale, x, y, z, qx, qy, qz, qw, asleep]` rows at 15 Hz
  for awake bodies only, once more on falling asleep, and in full to a joining player. Sleeping
  bodies cost no bandwidth. Clients play them back 110 ms in the past with interpolation and no
  extrapolation (`render/free-bodies.ts`), so a body never visibly passes through a wall.
- Past the body budget, the old cosmetic debris path is kept as the fallback.

### 4.2 Weapon physical response (section 5)

`apps/web/src/game/weapon-dynamics.ts` replaces the shared reload spring. The held gun is a rigid
body (its real `WEAPON_SPECS` weight, rod-like inertia by class, centre of mass ahead of the grip)
held by the arms as linear and angular spring-dampers of fixed stiffness:

- Reload sounds map to hand actions (`magOut`, `magIn`, `rack`, `release`), each an impulse at the
  point where the hand acts (magwell, charging handle on its actual side).
- Response is `Δv = J/m`, `Δω = I⁻¹ (r × J)`: a pistol jumps, a 15 kg machine gun barely moves and
  swings slower, a side handle twists the gun.
- Fixed 240 Hz substeps (identical result at 30/60/144 fps), damping ratio 0.45 (one overshoot),
  hard limits (3.5 cm, 0.12 rad) so the hands never leave the grips. The viewmodel applies the
  motion pivoted at the grip, turning about the centre of mass.

### 4.3 Debugging and profiling (sections 4.3, 11)

- **F4 collision view** (`render/collider-debug.ts`): every collider within 28 m as wireframe,
  coloured by layer (static, vegetation, model-triangle solids, free bodies), deep overlaps between
  different owners in red, vehicles' centre of mass, velocity and suspension, and the aim ray with
  the first hit point and its surface normal. Rebuilt at 4 Hz, capped at 24k segments.
- **Server `/metrics`:** `physics_step_ms`, `physics_substeps`, `physics_active_bodies`,
  `physics_bodies`, `physics_live_vehicles`, `physics_mirrored_colliders`, `physics_free_bodies`,
  `physics_free_bodies_awake`, and counters of shot, push and blast impulses.

## 5. Technology choices

| Area | Choice | Reason |
|---|---|---|
| Physics | Keep Jolt (WASM) and extend it to free bodies | Already integrated, proven by the vehicle tests, deterministic enough for a server-authoritative model, CCD and sleeping built in. Rapier or cannon-es would add a second solver without a measured benefit. |
| Collision queries | Keep `CollisionWorld` | Character controller, hitboxes, lag compensation and hit meshes depend on it; it runs on server and client without WASM. Jolt mirrors only what is near awake bodies. |
| Animation | Mocap + IK + spring-damper layers | Section 5 asks for physics only where it means something; the gun is a rigid body, bones stay animation/IK driven. |
| Rendering | three.js WebGL2 | See section 9 below on ray tracing. |

## 6. Risks

- **Server CPU:** one Jolt system per game server. The budget and sleeping bound it (see the
  benchmark); vehicles and bodies share one step.
- **Bandwidth:** only awake bodies are sent, at 15 Hz, about 90 bytes per row in JSON. A blast that
  wakes 30 bodies costs about 40 kB/s per nearby player while they move; a binary encoding is the
  next step if that shows up in `/metrics`.
- **Consistency:** clients never simulate bodies, so there is no divergence to reconcile; the price
  is 110 ms of playback delay on bodies.
- **Platform:** `@zion/physics` and `@zion/shared` contain no DOM or Node-only APIs; Jolt loads lazily
  in browsers. The desktop app is the same web build in Electron.

## 7. Roadmap and status

| Phase | Status |
|---|---|
| 1. Audit | Done (this document). |
| 2. Architecture | Done for physics; module table above. |
| 3. Physics foundation | Done: fixed timestep (30 Hz tick, 60 Hz Jolt substeps), rigid bodies, materials, CCD, sleeping, debug view, metrics. Kinematic bodies are supported by Jolt but not used yet. |
| 4. Geometry pipeline | Partial: proxies come from asset colliders with per-asset overrides; the F4 view finds overlaps. No offline validator yet for "gap in the visual mesh but blocked by a collider". |
| 5. Character & weapon interaction | Partial: reload response is physical. Recoil keeps its existing spring (`first-person-recoil.ts`); no partial ragdoll on hits. |
| 6. Vehicle physics | Already done before this pass; tests unchanged and passing. |
| 7. Ballistics & world interaction | Done for props: shots and blasts move bodies through the same collision world. Material penetration rules are not modelled. |
| 8. Multiplayer integration | Done for bodies (server authority, interest, sleep-aware deltas, playback). |
| 9. Rendering & ray tracing | Evaluated, not implemented (section 9). |
| 10. Optimization & release | Benchmark and metrics in place; no long soak test run. |

## 8. Tests and benchmark

Default tests are small and bounded (a few bodies, at most four simulated seconds, no rendering):

```sh
npx vitest run packages/physics/src/rigid-body.test.ts      # fall & sleep, mass, off-centre torque, friction, CCD, stacking, budget
npx vitest run apps/server/src/game/free-bodies.test.ts     # sign knocked down by a round, walker push, car shoving a drum, restore
npx vitest run apps/web/src/game/weapon-dynamics.test.ts    # mass-dependent jolt, side handle twist, damping, fps independence, grip limits
npx vitest run packages/physics/src/jolt-vehicles.test.ts   # vehicle regression
```

The load test is opt-in, single-worker, stops early on a time or heap limit:

```sh
ZION_BENCH=1 npx vitest run packages/physics/src/rigid-body.bench.test.ts --maxWorkers=1
```

Result on the development machine (Intel i5-1240P, 8 GB RAM, about 2 GB free during the run),
crates dropped in a heap, 30 Hz ticks of two 60 Hz substeps, 120 ticks at most:

| Bodies | Avg ms per awake tick | Worst ms | Ticks until all asleep | JS heap |
|---|---|---|---|---|
| 8 | 0.27 | 3.65 | 50 | 31 MB |
| 24 | 0.35 | 0.90 | 50 | 32 MB |
| 48 | 0.56 | 1.29 | 54 | 34 MB |
| 96 | 1.21 | 2.49 | 63 | 39 MB |

The 33 ms tick budget leaves ample room at the 96-body cap. The 8-body worst case is the first
step (WASM warm-up). WASM memory is not part of the JS heap figure.

## 9. Rendering and ray tracing

- **Web:** WebGL2 has no ray-tracing API. Hardware ray tracing in browsers would need WebGPU plus
  compute-shader BVH traversal, which three.js's WebGPU renderer does not provide for a scene of this
  size at playable frame rates on integrated GPUs. The game uses screen-space techniques instead:
  GTAO ambient occlusion, sun shafts and bloom in the optional shader pack, with shadow maps by
  quality. All of them can be turned off and none is required for lighting or materials to work.
- **Desktop:** the desktop app is Electron running the same WebGL client, so DXR or Vulkan ray
  tracing is not reachable without a native renderer. That would be a separate engine, and the brief
  rules out a rewrite without a benchmark that justifies it.
- **Decision:** no ray-tracing mode is implemented. Rendering quality stays independent of physics
  quality: lowering graphics never changes collision accuracy.

## 10. Adding a physical prop

1. Give the asset honest `colliders` in its definition (`packages/assets/src/*`): each collider
   becomes one convex part of the dynamic proxy (at most 8).
2. Add it to `PROP_PHYSICS` in `apps/server/src/game/prop-knock.ts` with its material and real mass in
   kg. Use `proxy` to replace the colliders when the motion depends on the true shape (round things
   roll: use a cylinder) and `extra` to add parts the static colliders omit (a sign's plate).
3. Check it in game with F4: the orange wireframe must match the model at rest and in motion.
4. Add a case to `free-bodies.test.ts` if it behaves differently from the existing ones.

Body materials are named in `SURFACE_MATERIALS` (`packages/physics/src/rigid-body.ts`, density for
the mass). How they grip is set by the surface material system below.

### 10.1 Surface materials and contact friction

`packages/physics/src/surfaces.ts` defines every physical material, ground and things alike:
concrete, asphalt, dirt, mud, grass, sand, gravel, rock, ice, snow, wet ground (standing water),
wood, metal, sheet metal, plastic, rubber and glass. Each has a static friction coefficient, a
kinetic (sliding) coefficient, rolling resistance, restitution and a sound family.

- **Terrain** carries its surface per vertex (`Heightfield.surface`, from the chunk's `surface`
  layer). `terrainMaterial()` maps the world's surface types to physical materials; standing water
  turns ground into `wet` (snow into `ice`, soft ground into `mud`). The Jolt height field gets one
  Jolt material per surface present and a material index per cell.
- **Bodies** are made of one material each: free props from their `RigidBodyDef`, vehicle hulls
  `metal`, mirrored static colliders `concrete` (capsules, i.e. trunks and posts, `wood`).
- **Contacts** (`ContactListenerJS` in `JoltVehicles`): on every contact added or persisted, the two
  materials and the sliding speed at the contact point give the friction, static while the
  surfaces stick (under 5 cm/s) and kinetic once they slide (over 10 cm/s), blended in between.
  Restitution is the geometric mean, so a dead surface deadens any contact. Pairs that do not follow
  the general rule (tyres above all) are listed in `PAIRS`.
- **Tyres** (`VehicleConstraintCallbacksJS.GetCombinedFriction`): Jolt's own rule against the ground
  is scaled by rubber's grip on that material relative to grass, the ground the handling was tuned
  on (asphalt up to a third more, mud less than half, ice about a tenth). Rolling resistance adds the
  difference to grass, so sand and mud bog a vehicle down. `wheelSurfaces(id)` tells what each tyre
  stands on.
- **Heavy vehicles:** wheel inertia scales with the vehicle's mass and wheel size.

`packages/physics/src/surfaces.test.ts` covers the pair table, a crate sliding on grass against
ice, static friction holding a crate on a 20° rock slope that it slides down on ice, and a car
pulling away on asphalt against mud.

### 10.2 Vehicle ride, hulls and weapon mounts

- **Suspension.** Stiff anti-roll bars were what threw vehicles over. With one wheel unloaded over
  a bump, the bar levered the other side up until the body rolled off: a jeep rolled 90° driving
  straight across gentle 8° undulations, and a tank bucked off its corner wheels.
  - Wheeled vehicles now have a light bar (mass · 0.5, at most 900) and a 1.8 Hz spring damped at 0.8.
  - Tracked hulls have no bar, and a stiff, critically damped 2.4 Hz spring (torsion bars).
- **Tracks.** Tanks use Jolt's `TrackedVehicleController`.
  - Road wheels run along the hull: the four corners (indices 0–3, as for any vehicle), then
    pairs between them.
  - The tracks skid-steer: the inside track slows when turning on the move, and runs backwards
    when turning on the spot with no throttle.
  - Engine torque is about twice a wheeled vehicle's for its weight, enough to skid both tracks
    round.
- **Hulls fitted to the model.** `apps/web/scripts/vehicle-hulls.mjs` builds each vehicle's
  hull from its prepared model and writes `packages/physics/src/vehicle-hulls.gen.ts`:
  - It voxelises the model (wheels, rotors and gun barrels left out) and fills the inside of
    closed shells.
  - It merges the solid cells into at most 64 boxes, at the finest cell size that fits.

  The Jolt chassis is that compound, cut at the underside's clearance. The centre of mass stays low
  on the centre line, under the origin, as the handling was tuned. Armour also uses the boxes as
  its combat and line-of-sight colliders, and `vehicleHitBounds` bounds them for shells. Cars keep
  their hand-made colliders with open windows. Rerun the script whenever a vehicle model changes.
- **Weapon mounts** (`packages/shared/src/vehicle-mounts.ts`). Each tank turret and roof gun is
  declared in `VEHICLE_MOUNTS`:
  - its traverse axis;
  - its trunnion;
  - its traverse and elevation rates;
  - which of the model's triangles turn with it.

  How the aim flows:
  - The server keeps each seat's actual aim in `VehicleState.aim`, relative to the hull.
  - It slews the mount towards its rider's aim, or a bot's target, at the mount's rate.
  - It fires from `weaponMuzzle`: the muzzle where the barrel really points, and along it.
  - Bots fire once the gun is laid on the target.
  - The browser cuts the turret, barrel and roof gun out of the hull mesh (`render/vehicle-mounts.ts`)
    and turns them by the same aim. A model with no gun at a mount gets a generic machine gun.
- **Crew.**
  - A tank's commander sits inside the hull, out of sight. The view is the gunner's sight on the
    turret: the mouse aims, a ring marks where the gun points while the turret catches up, the
    right button magnifies, the left fires the gun, and Space fires the coaxial.
  - The roof gunner stands in the hatch, half out, and turns with the gun.
  - Seated riders sit on the cushion measured on the model (`render/seat-fit.ts`, a vertical ray
    through each seat). Their feet are kept off the floor under them: the human rig's `floor`
    draws the knee up instead of letting a foot sink into the vehicle.

`packages/physics/src/vehicle-ride.test.ts` drives a jeep and a tank across undulations and turns
a tank on the spot. `packages/shared/src/vehicle-mounts.test.ts` covers traverse rates, the muzzle
following the turret, and a roof gun and its gunner riding round with it.

### 10.3 Vehicles over the network (hybrid physics)

The audit found the following:
- **Server:** Jolt at a fixed 30 Hz tick with 2 substeps; catch-up is limited to 4 ticks, then
  dropped (no spiral of death).
- **Client:** no vehicle physics at all. Every vehicle, ours included, was drawn from
  interpolated snapshots 70–105 ms in the past, so a driver saw a wall hit a round trip late.
- **Snapshots:** every vehicle in a 420 m radius was sent in full at 15/30 Hz, parked ones
  included.
- **Driver input:** inputs were applied up to three per tick, with no acknowledgement.

What runs where now:
- **Server: authority.** Inputs are validated (clamped axes, no positions accepted). The server
  steps the vehicles on Jolt, applying one driver input per tick (a backlog two at a time), and
  decides impacts, damage and destruction. Jolt sleeps idle bodies, and only the ground round awake
  bodies is mirrored. Snapshots carry, for each vehicle:
  - position, heading, pitch and roll;
  - speed, slip, climb and the three body rates;
  - suspension, health, rotor, weapons and aim.

  To the driver they also carry `ack`, the last input applied.
- **Delta snapshots.** A vehicle is sent in full only when its state changed since that player
  last got it (one serialisation per vehicle per tick; parked vehicles every 2 s; anything we
  ride, always). `ids` lists everything in interest, and a snapshot with nothing new is not sent.
  Stale snapshots (older `time`) are ignored. `/metrics` reports snapshots, entries sent, entries
  skipped and build time.
- **Client: prediction of the vehicle we drive** (`apps/web/src/game/vehicle-prediction.ts`).
  - **Each fixed tick:** our input steps a local `JoltVehicles` over the client's own collision
    world. Terrain, statics and the other vehicles where they are shown count as obstacles. The
    vehicle accelerates, hits, bounces and slows at once; the camera shakes on a crash.
  - **Reconciliation:** each snapshot is compared with what we predicted after the acknowledged
    input. A small difference is left alone. Otherwise the server's state is taken, with our wheel
    spin and engine rpm at that input standing in for the server's, the inputs it has not applied
    are replayed, and the visual jump is eased out. Beyond 6 m it is a teleport and is taken as it is.
  - The predicted pose is drawn between the last two ticks at any frame rate. Health, crew and
    weapons stay the server's.
- **Other vehicles:** snapshot interpolation with cubic Hermite through each snapshot's
  velocity. A vehicle silent while parked holds still until its next snapshot. Extrapolation is
  limited to 180 ms.
- **Collisions between players' vehicles.** Each driver's client predicts its own vehicle against
  the other as an obstacle. The server's single simulation decides the outcome, and both clients
  converge on it through reconciliation and interpolation. Damage is applied once, by the server.
- **Profiling.** The F3 panel shows the prediction: ticks, last error, corrections, inputs
  replayed and step time. The server's `/metrics` reports the physics step and snapshot counters.

`apps/web/src/game/vehicle-prediction.test.ts` runs a server and a client over a lagged link:
- the client drives at once while the server has not yet seen an input;
- it agrees with the server within centimetres;
- it meets a wall before the server does, and never goes through;
- it converges smoothly when the server alone knew of a shove.

Not done yet: aircraft are not predicted (they keep their own flight model until it moves onto
Jolt), the snapshots stay JSON (no binary packing), and there is no packet-loss soak test.

## 11. Known limits and next steps

- Bodies are not in the client's `CollisionWorld`, so client-side tracers and bullet holes can pass
  through a moving body that the server hits. The fix is to install the proxy on the client from the
  same table. That needs the table moved into a shared package.
- Walkers are not blocked by bodies, only push them. A body heavier than about 80 kg would need a
  blocking contact in the character controller.
- No buoyancy: bodies sink slowly in water and settle on the bed.
- Recoil still uses the existing first-person spring rather than `WeaponDynamics`.
- The legacy (arcade) vehicle model does not update vehicle bodies in Jolt, so free bodies collide
  with stale vehicle positions while it is selected.
- Not run in this pass: a desktop build, a full web production build, and multi-player load.
- The character controller is still our own capsule solver, not a Jolt body: walkers do not slip
  on ice or mud yet. The surface table is ready for it (`terrainMaterial`, `contactFriction`).
