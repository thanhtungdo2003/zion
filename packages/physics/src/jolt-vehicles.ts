import type initJolt from 'jolt-physics';
import { VEHICLES, CHUNK_SIZE, createVehicleMotion, type VehicleState } from '@zion/shared';
import { Layer } from './layers';
import { damageVehicle } from './vehicles';
import type { Collider } from './shapes';
import type { CollisionWorld } from './world';
import type { Heightfield } from './heightfield';

/**
 * Vehicle simulation on Jolt Physics (WASM). Each vehicle is a Jolt rigid body with a
 * wheeled VehicleConstraint (engine, gearbox, differentials, anti-roll bars, friction-curve tyres,
 * cylinder-cast wheel contacts). Jolt does not own the world: terrain chunks and static colliders
 * of our CollisionWorld are mirrored into it on demand around vehicles that are awake.
 */
type JoltModule = Awaited<ReturnType<typeof initJolt>>;
let Jolt!: JoltModule;
let loading: Promise<void> | null = null;
/**
 * Loads the Jolt WASM module once (the server awaits it at start-up; browsers load it lazily,
 * when the player first drives, so it never weighs on the initial page load).
 */
export function loadJolt(): Promise<void> {
  return loading ??= import('jolt-physics').then(async (module) => {
    Jolt = await module.default();
    vec = new Jolt.Vec3(); rvec = new Jolt.RVec3(); quat = new Jolt.Quat();
  });
}
export function joltLoaded(): boolean { return !!vec; }
type Body = InstanceType<JoltModule['Body']>;
type BodyID = InstanceType<JoltModule['BodyID']>;

const LAYER_STATIC = 0, LAYER_MOVING = 1;
/** Jolt's HeightFieldShapeConstantValues::cNoCollisionValue (FLT_MAX). */
const NO_COLLISION = 3.4028234663852886e38;
const GRAVITY = 9.81;
/** Mirrored geometry nobody needed for this long is dropped (ms). */
const MIRROR_GRACE = 3000;

interface Car {
  body: Body;
  id: BodyID;
  constraint: InstanceType<JoltModule['VehicleConstraint']>;
  controller: InstanceType<JoltModule['WheeledVehicleController']>;
  listener: InstanceType<JoltModule['VehicleConstraintStepListener']>;
  /** What we last wrote to the VehicleState, to detect outside edits (reset, shoves). */
  synced: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; speed: number; lateral: number; vy: number };
  velocity: [number, number, number];
}
export interface VehicleInput { throttle: number; steer: number }

let vec!: InstanceType<JoltModule['Vec3']>, rvec!: InstanceType<JoltModule['RVec3']>, quat!: InstanceType<JoltModule['Quat']>;
const v3 = (x: number, y: number, z: number) => { vec.Set(x, y, z); return vec; };
const rv3 = (x: number, y: number, z: number) => { rvec.Set(x, y, z); return rvec; };
const q4 = (x: number, y: number, z: number, w: number) => { quat.Set(x, y, z, w); return quat; };
/** Jolt returns BodyIDs in reused scratch memory; keep our own copy. */
const keep = (id: BodyID): BodyID => new Jolt.BodyID(id.GetIndexAndSequenceNumber());

/** YXZ yaw/pitch/roll (the shared vehicle convention) → quaternion. */
function eulerQuat(yaw: number, pitch: number, roll: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2), cz = Math.cos(roll / 2), sz = Math.sin(roll / 2);
  // qY * qX
  const ax = cy * sx, ay = sy * cx, az = -sy * sx, aw = cy * cx;
  // (qY*qX) * qZ
  return [ax * cz + ay * sz, ay * cz - ax * sz, aw * sz + az * cz, aw * cz - az * sz];
}
/** Quaternion → column-major rotation basis. */
function quatBasis(x: number, y: number, z: number, w: number): number[] {
  return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}
/** Column-major rotation basis → quaternion. */
function basisQuat(m: readonly number[]): [number, number, number, number] {
  const m00 = m[0]!, m10 = m[1]!, m20 = m[2]!, m01 = m[3]!, m11 = m[4]!, m21 = m[5]!, m02 = m[6]!, m12 = m[7]!, m22 = m[8]!, t = m00 + m11 + m22;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

export class JoltVehicles {
  private readonly jolt: InstanceType<JoltModule['JoltInterface']>;
  private readonly system: InstanceType<JoltModule['PhysicsSystem']>;
  private readonly bodies: InstanceType<JoltModule['BodyInterface']>;
  private readonly cars = new Map<number, Car>();
  private readonly statics = new Map<Collider, { id: BodyID; seen: number }>();
  private readonly terrain = new Map<Heightfield, { id: BodyID; seen: number }>();
  private readonly buffer: Collider[] = [];

  constructor(private readonly world: CollisionWorld) {
    const settings = new Jolt.JoltSettings();
    settings.mMaxBodies = 8192; settings.mMaxBodyPairs = 8192; settings.mMaxContactConstraints = 4096;
    const pairs = new Jolt.ObjectLayerPairFilterTable(2);
    pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING); pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
    const broad = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
    broad.MapObjectToBroadPhaseLayer(LAYER_STATIC, new Jolt.BroadPhaseLayer(0));
    broad.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1));
    settings.mObjectLayerPairFilter = pairs; settings.mBroadPhaseLayerInterface = broad;
    settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairs, 2);
    this.jolt = new Jolt.JoltInterface(settings);
    Jolt.destroy(settings);
    this.system = this.jolt.GetPhysicsSystem();
    this.bodies = this.system.GetBodyInterface();
    this.system.SetGravity(v3(0, -GRAVITY, 0));
  }

  has(id: number): boolean { return this.cars.has(id); }

  add(v: VehicleState): void {
    if (this.cars.has(v.id)) return;
    const def = VEHICLES[v.kind], m = v.motion ??= createVehicleMotion(v.kind);
    // Chassis: a box from just above the axles to the roofline, centre of mass at `com`.
    const bottom = Math.max(.2, def.wheelRadius * .85), top = def.height * (def.quad ? .72 : .9), cy = (bottom + top) / 2;
    const box = new Jolt.BoxShapeSettings(v3(def.halfX, (top - bottom) / 2, def.halfZ), .05);
    const placed = new Jolt.RotatedTranslatedShapeSettings(v3(0, cy, 0), q4(0, 0, 0, 1), box);
    // Mass sits low in the chassis (engine, frame, axles), around wheel-hub height: a low
    // centre of mass keeps hard cornering and bumps from tipping the vehicle over.
    const comY = Math.max(.15, def.wheelRadius * .55);
    const shape = new Jolt.OffsetCenterOfMassShapeSettings(v3(0, comY - cy, 0), placed).Create().Get();
    const [qx, qy, qz, qw] = eulerQuat(v.yaw, m.pitch, m.roll);
    const settings = new Jolt.BodyCreationSettings(shape, rv3(v.x, v.y, v.z), q4(qx, qy, qz, qw), Jolt.EMotionType_Dynamic, LAYER_MOVING);
    settings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    settings.mMassPropertiesOverride.mMass = def.mass;
    settings.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    settings.mFriction = .4; settings.mRestitution = .15;
    settings.mMaxLinearVelocity = 80;
    settings.mUserData = v.id;
    const body = this.bodies.CreateBody(settings);
    Jolt.destroy(settings);
    // Start awake so the springs settle to their real rest length before anyone gets in;
    // otherwise the first throttle input lifts the parked body a few centimetres (a visible hop).
    this.bodies.AddBody(keep(body.GetID()), Jolt.EActivation_Activate);

    const vehicle = new Jolt.VehicleConstraintSettings();
    vehicle.mUp = v3(0, 1, 0); vehicle.mForward = new Jolt.Vec3(0, 0, -1);
    const sag = GRAVITY / (2 * Math.PI * 1.5) ** 2;
    vehicle.mWheels.clear();
    for (let wheel = 0; wheel < 4; wheel++) {
      const w = new Jolt.WheelSettingsWV();
      const x = wheel % 2 === 0 ? -def.wheelX : def.wheelX, z = wheel < 2 ? def.frontZ : def.rearZ;
      // Mounted so the loaded spring sits at `spring`, the tyre touching the body origin's plane.
      w.mPosition = new Jolt.Vec3(x, def.wheelRadius + def.spring, z);
      w.mWheelForward = new Jolt.Vec3(0, 0, -1);
      w.mSuspensionMinLength = .04; w.mSuspensionMaxLength = def.spring + sag;
      w.mSuspensionSpring.mFrequency = 1.5; w.mSuspensionSpring.mDamping = .5;
      w.mRadius = def.wheelRadius; w.mWidth = def.quad ? .22 : .2;
      w.mMaxSteerAngle = wheel < 2 ? def.turn * .75 : 0;
      w.mMaxHandBrakeTorque = wheel < 2 ? 0 : 4000;
      vehicle.mWheels.push_back(w);
    }
    const controller = new Jolt.WheeledVehicleControllerSettings();
    // Ordinary road gearing; torque so first gear gives about the vehicle's nominal acceleration.
    // Top speed is governed in step(), not by the rev limiter.
    const diff = 3.42;
    controller.mEngine.mMaxTorque = def.mass * def.acceleration * def.wheelRadius / (2.66 * diff) * 1.6;
    controller.mEngine.mMaxRPM = 6000;
    controller.mDifferentials.clear();
    for (const [left, right] of [[0, 1], [2, 3]] as const) {
      const d = new Jolt.VehicleDifferentialSettings();
      d.mLeftWheel = left; d.mRightWheel = right; d.mDifferentialRatio = diff; d.mEngineTorqueRatio = .5;
      controller.mDifferentials.push_back(d);
    }
    vehicle.mController = controller;
    vehicle.mAntiRollBars.clear();
    for (const [left, right] of [[0, 1], [2, 3]] as const) {
      const bar = new Jolt.VehicleAntiRollBar();
      bar.mLeftWheel = left; bar.mRightWheel = right; bar.mStiffness = def.mass * 3;
      vehicle.mAntiRollBars.push_back(bar);
    }
    const constraint = new Jolt.VehicleConstraint(body, vehicle);
    constraint.SetVehicleCollisionTester(new Jolt.VehicleCollisionTesterCastCylinder(LAYER_MOVING, .05));
    this.system.AddConstraint(constraint);
    const listener = new Jolt.VehicleConstraintStepListener(constraint);
    this.system.AddStepListener(listener);
    const wheeled = Jolt.castObject(constraint.GetController(), Jolt.WheeledVehicleController);
    const car: Car = { body, id: keep(body.GetID()), constraint, controller: wheeled, listener, synced: { x: NaN, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, lateral: 0, vy: 0 }, velocity: [0, 0, 0] };
    this.cars.set(v.id, car);
    this.pushState(v, car);
  }

  /** Writes a VehicleState into Jolt when something outside the simulation changed it. */
  private pushState(v: VehicleState, car: Car): void {
    const m = v.motion ??= createVehicleMotion(v.kind), s = car.synced, lateral = m.lateral ?? 0;
    const moved = Math.abs(v.x - s.x) + Math.abs(v.y - s.y) + Math.abs(v.z - s.z) + Math.abs(v.yaw - s.yaw) + Math.abs(m.pitch - s.pitch) + Math.abs(m.roll - s.roll) > 1e-4 || s.x !== s.x;
    const pushed = Math.abs(v.speed - s.speed) + Math.abs(lateral - s.lateral) + Math.abs(m.vy - s.vy) > 1e-4;
    if (moved) {
      const [qx, qy, qz, qw] = eulerQuat(v.yaw, m.pitch, m.roll);
      this.bodies.SetPositionAndRotation(car.id, rv3(v.x, v.y, v.z), q4(qx, qy, qz, qw), Jolt.EActivation_DontActivate);
    }
    if (moved || pushed) {
      const vx = -Math.sin(v.yaw) * v.speed + Math.cos(v.yaw) * lateral, vz = -Math.cos(v.yaw) * v.speed - Math.sin(v.yaw) * lateral;
      this.bodies.SetLinearVelocity(car.id, v3(vx, m.vy, vz));
      // Small nudges (prediction corrections) keep the spin; teleports (resets) stop it.
      if (moved && Math.hypot(v.x - s.x, v.z - s.z) > 2) this.bodies.SetAngularVelocity(car.id, v3(0, 0, 0));
      car.velocity = [vx, m.vy, vz];
      if (pushed && Math.hypot(vx, m.vy, vz) > .05) this.bodies.ActivateBody(car.id);
    }
  }

  /** Mirrors terrain and static colliders around one point into Jolt. False if not streamed in. */
  private mirror(x: number, z: number, radius: number, now: number): boolean {
    const w = this.world, edge = w.worldSize - .01;
    const x0 = Math.max(0, x - radius), z0 = Math.max(0, z - radius), x1 = Math.min(edge, x + radius), z1 = Math.min(edge, z + radius);
    if (!w.isAreaLoaded(x0, z0, x1, z1)) return false;
    for (let cx = Math.floor((x - radius) / CHUNK_SIZE); cx <= Math.floor((x + radius) / CHUNK_SIZE); cx++)
      for (let cz = Math.floor((z - radius) / CHUNK_SIZE); cz <= Math.floor((z + radius) / CHUNK_SIZE); cz++) {
        const hf = w.terrainChunk(cx, cz);
        if (!hf) continue;
        const known = this.terrain.get(hf);
        if (known) known.seen = now; else this.terrain.set(hf, { id: this.addTerrain(hf), seen: now });
      }
    const n = w.queryAABB({ minX: x - radius, minY: -1e4, minZ: z - radius, maxX: x + radius, maxY: 1e4, maxZ: z + radius }, Layer.Static, this.buffer);
    for (let i = 0; i < n; i++) {
      const c = this.buffer[i]!;
      // Vehicles are Jolt bodies themselves; their CollisionWorld boxes are only for LOS/players.
      if (c.tag > 50000 && c.tag < 60000) continue;
      const known = this.statics.get(c);
      if (known) { known.seen = now; continue; }
      const id = this.addStatic(c);
      if (id) this.statics.set(c, { id, seen: now });
    }
    return true;
  }

  private addTerrain(hf: Heightfield): BodyID {
    const n = hf.verts, padded = n + (n % 2);
    const settings = new Jolt.HeightFieldShapeSettings();
    settings.mOffset = new Jolt.Vec3(0, 0, 0); settings.mScale = new Jolt.Vec3(hf.cellSize, 1, hf.cellSize);
    settings.mSampleCount = padded; settings.mBlockSize = 2;
    settings.mHeightSamples.reserve(padded * padded);
    for (let j = 0; j < padded; j++) for (let i = 0; i < padded; i++)
      settings.mHeightSamples.push_back(i < n && j < n ? hf.heights[j * n + i]! : NO_COLLISION);
    const shape = settings.Create().Get();
    const body = new Jolt.BodyCreationSettings(shape, rv3(hf.originX, 0, hf.originZ), q4(0, 0, 0, 1), Jolt.EMotionType_Static, LAYER_STATIC);
    body.mFriction = .9;
    const id = keep(this.bodies.CreateAndAddBody(body, Jolt.EActivation_DontActivate));
    Jolt.destroy(body); Jolt.destroy(settings);
    return id;
  }

  private addStatic(c: Collider): BodyID | null {
    const s = c.shape;
    let shape: InstanceType<JoltModule['Shape']>, x: number, y: number, z: number, q: [number, number, number, number] = [0, 0, 0, 1];
    if (s.type === 'box') {
      const cr = Math.min(.05, s.hx, s.hy, s.hz) * .9;
      shape = new Jolt.BoxShape(v3(s.hx, s.hy, s.hz), cr);
      x = s.cx; y = s.cy; z = s.cz;
      q = s.basis ? basisQuat(s.basis) : [0, Math.sin(s.yaw / 2), 0, Math.cos(s.yaw / 2)];
    } else if (s.type === 'sphere') {
      shape = new Jolt.SphereShape(s.r); x = s.cx; y = s.cy; z = s.cz;
    } else {
      const dx = s.bx - s.ax, dy = s.by - s.ay, dz = s.bz - s.az, len = Math.hypot(dx, dy, dz);
      x = (s.ax + s.bx) / 2; y = (s.ay + s.by) / 2; z = (s.az + s.bz) / 2;
      if (len < 1e-4) shape = new Jolt.SphereShape(s.r);
      else {
        shape = new Jolt.CapsuleShape(len / 2, s.r);
        // Rotate the capsule's +Y axis onto the segment.
        const ux = dx / len, uy = dy / len, uz = dz / len, ax = uz, az = -ux, sin = Math.hypot(ax, az);
        if (sin > 1e-6) { const angle = Math.atan2(sin, uy), h = Math.sin(angle / 2) / sin; q = [ax * h, 0, az * h, Math.cos(angle / 2)]; }
        else if (uy < 0) q = [1, 0, 0, 0];
      }
    }
    if (!Number.isFinite(x + y + z)) return null;
    const body = new Jolt.BodyCreationSettings(shape, rv3(x, y, z), q4(...q), Jolt.EMotionType_Static, LAYER_STATIC);
    body.mFriction = .6; body.mRestitution = .1;
    const id = keep(this.bodies.CreateAndAddBody(body, Jolt.EActivation_DontActivate));
    Jolt.destroy(body);
    return id;
  }

  private expire(now: number): void {
    for (const [key, entry] of this.statics) if (now - entry.seen > MIRROR_GRACE) { this.bodies.RemoveBody(entry.id); this.bodies.DestroyBody(entry.id); this.statics.delete(key); }
    for (const [key, entry] of this.terrain) if (now - entry.seen > MIRROR_GRACE) { this.bodies.RemoveBody(entry.id); this.bodies.DestroyBody(entry.id); this.terrain.delete(key); }
  }

  /**
   * Advances every vehicle by dt. `input` is undefined for unattended vehicles (handbrake on).
   * Returns the hardest impact (m/s velocity change) each vehicle took this step.
   */
  step(vehicles: Iterable<VehicleState>, input: (v: VehicleState) => VehicleInput | undefined, dt: number, now: number): Map<number, number> {
    const impacts = new Map<number, number>(), live: Array<[VehicleState, Car]> = [];
    for (const v of vehicles) {
      const car = this.cars.get(v.id);
      if (!car) continue;
      this.pushState(v, car);
      const m = v.motion!, control = v.health > 0 && !v.exploded ? input(v) : undefined;
      const throttle = control?.throttle ?? 0, steer = control?.steer ?? 0;
      const forward = car.velocity[0] * -Math.sin(v.yaw) + car.velocity[2] * -Math.cos(v.yaw);
      m.steer += (steer - m.steer) * (1 - Math.exp(-dt * 8));
      // Pressing against the direction of travel brakes first, then engages reverse.
      const braking = throttle !== 0 && Math.sign(throttle) !== Math.sign(forward) && Math.abs(forward) > 1;
      v.braking = throttle < -.1 && forward >= 8;
      const top = throttle > 0 ? VEHICLES[v.kind].maxSpeed : VEHICLES[v.kind].maxSpeed * .32;
      const governed = throttle * Math.max(0, Math.min(1, (top - Math.abs(forward)) / 3));
      car.controller.SetDriverInput(braking ? 0 : governed, m.steer / (1 + Math.abs(forward) / 25), braking ? Math.abs(throttle) : 0, control ? 0 : 1);
      if (control && (throttle || steer)) this.bodies.ActivateBody(car.id);
      const awake = this.bodies.IsActive(car.id);
      if (!awake) continue;
      const reach = 16 + Math.hypot(...car.velocity) * .8;
      if (!this.mirror(v.x, v.z, reach, now)) {
        // Unstreamed ground: hold the vehicle where it is until the world loads around it.
        this.bodies.SetLinearVelocity(car.id, v3(0, 0, 0)); this.bodies.SetAngularVelocity(car.id, v3(0, 0, 0));
        this.bodies.DeactivateBody(car.id);
        continue;
      }
      live.push([v, car]);
    }
    this.expire(now);
    if (live.length) this.jolt.Step(dt, Math.max(1, Math.ceil(dt * 60)));
    for (const [v, car] of live) impacts.set(v.id, this.pull(v, car, dt, now));
    return impacts;
  }

  /** Reads the Jolt body back into the compact network VehicleState. */
  private pull(v: VehicleState, car: Car, dt: number, now: number): number {
    const def = VEHICLES[v.kind], m = v.motion!;
    const p = this.bodies.GetPosition(car.id), x = p.GetX(), y = p.GetY(), z = p.GetZ();
    const r = this.bodies.GetRotation(car.id), b = quatBasis(r.GetX(), r.GetY(), r.GetZ(), r.GetW());
    const lv = this.bodies.GetLinearVelocity(car.id), vel: [number, number, number] = [lv.GetX(), lv.GetY(), lv.GetZ()];
    const av = this.bodies.GetAngularVelocity(car.id), w = [av.GetX(), av.GetY(), av.GetZ()] as const;
    v.x = x; v.y = y; v.z = z;
    m.pitch = Math.asin(Math.max(-1, Math.min(1, -b[7]!)));
    if (Math.abs(b[7]!) < .9999) { v.yaw = Math.atan2(b[6]!, b[8]!); m.roll = Math.atan2(b[1]!, b[4]!); }
    else { v.yaw = Math.atan2(-b[2]!, b[0]!); m.roll = 0; }
    v.speed = -Math.sin(v.yaw) * vel[0] - Math.cos(v.yaw) * vel[2];
    m.lateral = Math.cos(v.yaw) * vel[0] - Math.sin(v.yaw) * vel[2];
    m.vy = vel[1];
    m.pitchVelocity = w[0] * b[0]! + w[1] * b[1]! + w[2] * b[2]!;
    m.yawVelocity = w[0] * b[3]! + w[1] * b[4]! + w[2] * b[5]!;
    m.rollVelocity = w[0] * b[6]! + w[1] * b[7]! + w[2] * b[8]!;
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      const wheel = car.constraint.GetWheel(i);
      if (wheel.HasContact()) contacts++;
      m.suspension[i] = Math.max(0, Math.min(def.spring + .2, wheel.GetSuspensionLength()));
    }
    m.grounded = contacts > 0;
    // Impact: the velocity change that gravity, engine and tyres cannot explain.
    const dv = Math.hypot(vel[0] - car.velocity[0], vel[1] - car.velocity[1] + GRAVITY * dt, vel[2] - car.velocity[2]);
    car.velocity = vel;
    const impact = dv > 4 ? dv : 0;
    if (impact) damageVehicle(v, Math.max(0, impact - 7) ** 2 * .6 * def.mass / 1000, now);
    if (impact >= 2 && !(v.impact && now - v.impact.time < 400 && v.impact.speed > impact)) v.impact = { time: now, speed: impact };
    // Sea water: drag and a little buoyancy so a car ditched in the sea settles instead of sinking fast.
    if (y < this.world.seaLevel) {
      const k = Math.exp(-dt * 2.5);
      this.bodies.SetLinearVelocity(car.id, v3(vel[0] * k, vel[1] * k + 3 * dt, vel[2] * k));
    }
    // Never let a missed contact drop a vehicle out of the world.
    const ground = this.world.terrainHeight(x, z);
    if (Number.isFinite(ground) && y < ground - 1.5) {
      v.y = ground + .5;
      const [qx, qy, qz, qw] = eulerQuat(v.yaw, 0, 0);
      this.bodies.SetPositionAndRotation(car.id, rv3(v.x, v.y, v.z), q4(qx, qy, qz, qw), Jolt.EActivation_Activate);
      this.bodies.SetLinearVelocity(car.id, v3(0, 0, 0));
      m.pitch = m.roll = 0; v.speed = m.lateral = m.vy = 0;
    }
    const s = car.synced;
    s.x = v.x; s.y = v.y; s.z = v.z; s.yaw = v.yaw; s.pitch = m.pitch; s.roll = m.roll; s.speed = v.speed; s.lateral = m.lateral; s.vy = m.vy;
    return impact;
  }

  dispose(): void {
    for (const car of this.cars.values()) {
      this.system.RemoveStepListener(car.listener); this.system.RemoveConstraint(car.constraint);
      this.bodies.RemoveBody(car.id); this.bodies.DestroyBody(car.id);
    }
    this.cars.clear();
    for (const e of [...this.statics.values(), ...this.terrain.values()]) { this.bodies.RemoveBody(e.id); this.bodies.DestroyBody(e.id); }
    this.statics.clear(); this.terrain.clear();
    Jolt.destroy(this.jolt);
  }
}
