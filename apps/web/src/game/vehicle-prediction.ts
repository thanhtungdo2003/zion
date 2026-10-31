import { JoltVehicles, joltLoaded, loadJolt, type CollisionWorld, type VehicleDrivetrain } from '@zion/physics';
import { TICK_DT, createVehicleMotion, isAircraft, type VehicleState } from '@zion/shared';

/**
 * Client-side prediction of the vehicle we drive, on the same Jolt vehicle model the server runs.
 *
 * Every fixed tick our input is applied here at once (the vehicle answers, hits walls, bounces
 * and slows on this screen without waiting for the server) and remembered with its sequence
 * number. The server steps the vehicle with one of our inputs per tick and tells us the last one
 * it applied (`ack`); its snapshot is compared with what we predicted after that same input:
 * - close enough: nothing happens;
 * - off: the vehicle is put into the server's state and the inputs it has not applied yet are
 *   replayed on top, and the jump between the old and new prediction is eased out on screen
 *   (never a snap for a small error, never a constant pull back to an old position);
 * - far off (a teleport, a respawn): taken as it is.
 * Damage, destruction and everything the vehicle carries stay the server's: only the motion is
 * predicted. Other vehicles are shown from interpolated snapshots (VehicleTimeline).
 */
interface Step { seq: number; throttle: number; steer: number; state: VehicleState; drive: VehicleDrivetrain | null }

const clone = (v: VehicleState): VehicleState => {
  const m = v.motion ?? createVehicleMotion(v.kind);
  return { ...v, motion: { ...m, suspension: [...m.suspension] } };
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * Within these the prediction stands: metres, radians, m/s. The body's height and tilt on its
 * springs differ a little between two simulations of the same drive; correcting each such
 * difference put the body back on its springs to settle again, and the ride bounced (more so as
 * the server lagged): the track over the ground and the heading are what must agree closely.
 */
const TOLERANCE = { position: .2, height: .35, heading: .05, tilt: .15, velocity: .8 };
/** Beyond this the server moved the vehicle (teleport, reset): no easing. */
const SNAP_DISTANCE = 6;
const HISTORY = 120;

export interface PredictionStats { steps: number; reconciles: number; replayed: number; error: number; maxError: number; ms: number }

export class VehiclePredictor {
  private sim: JoltVehicles | null = null;
  private v: VehicleState | null = null;
  private prev: VehicleState | null = null;
  private server: VehicleState | null = null;
  private readonly history: Step[] = [];
  private readonly offset = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  readonly stats: PredictionStats = { steps: 0, reconciles: 0, replayed: 0, error: 0, maxError: 0, ms: 0 };

  constructor(private readonly world: CollisionWorld) {}

  get id(): number | null { return this.v?.id ?? null; }

  /** Predicts `v` (the vehicle we drive) from now on; false while it cannot (Jolt still loading, an aircraft, a wreck). */
  follow(v: VehicleState | undefined): boolean {
    if (!v || isAircraft(v.kind) || v.health <= 0 || v.exploded) { this.stop(); return false; }
    if (!joltLoaded()) { void loadJolt(); return false; }
    if (this.v?.id !== v.id) {
      this.stop();
      this.sim = new JoltVehicles(this.world);
      this.v = clone(v); this.server = clone(v);
      this.sim.add(this.v); this.sim.restore(this.v);
    }
    return true;
  }

  stop(): void {
    this.sim?.dispose();
    this.sim = null; this.v = null; this.prev = null; this.server = null; this.history.length = 0;
    for (const k of Object.keys(this.offset) as Array<keyof typeof this.offset>) this.offset[k] = 0;
  }

  /** One fixed tick with our input `seq`; returns the impact (m/s) the vehicle took, for local effects. */
  step(seq: number, throttle: number, steer: number, now: number): number {
    const sim = this.sim, v = this.v;
    if (!sim || !v) return 0;
    const t0 = performance.now();
    this.prev = clone(v);
    const impact = sim.step([v], () => ({ throttle, steer }), TICK_DT, now).get(v.id) ?? 0;
    this.history.push({ seq, throttle, steer, state: clone(v), drive: sim.saveDrivetrain(v.id) });
    if (this.history.length > HISTORY) this.history.shift();
    this.stats.steps++; this.stats.ms = performance.now() - t0;
    return impact;
  }

  /** The server's state of our vehicle after it applied our input `ack`. */
  reconcile(server: VehicleState, ack: number | undefined, now: number): void {
    const sim = this.sim, v = this.v;
    if (!sim || !v || server.id !== v.id) return;
    this.server = clone(server);
    // What changes the handling is the server's: flat tyres, wrecks.
    v.flats = server.flats; v.health = server.health; v.exploded = server.exploded;
    if (ack === undefined) return;
    const at = this.history.findIndex((h) => h.seq === ack);
    if (at < 0) {
      // Older than anything we remember, or ahead of it: only a large gap is worth acting on.
      if (Math.hypot(server.x - v.x, server.y - v.y, server.z - v.z) > SNAP_DISTANCE) this.reset(server);
      return;
    }
    const predicted = this.history[at]!.state, predictedDrive = this.history[at]!.drive, pending = this.history.slice(at + 1);
    this.history.splice(0, at + 1);
    const pm = predicted.motion!, sm = server.motion ?? createVehicleMotion(server.kind);
    const position = Math.hypot(server.x - predicted.x, server.y - predicted.y, server.z - predicted.z);
    const track = Math.hypot(server.x - predicted.x, server.z - predicted.z), height = Math.abs(server.y - predicted.y);
    const heading = Math.abs(wrap(server.yaw - predicted.yaw)), tilt = Math.max(Math.abs(sm.pitch - pm.pitch), Math.abs(sm.roll - pm.roll));
    const velocity = Math.hypot(server.speed - predicted.speed, (sm.lateral ?? 0) - (pm.lateral ?? 0));
    this.stats.error = position; this.stats.maxError = Math.max(this.stats.maxError * .995, position);
    if (track < TOLERANCE.position && height < TOLERANCE.height && heading < TOLERANCE.heading && tilt < TOLERANCE.tilt && velocity < TOLERANCE.velocity) return;
    if (position > SNAP_DISTANCE) { this.reset(server); return; }
    // Re-simulate from the server's state with the inputs it has not seen yet.
    // The server does not send its wheels' spin or the engine's rpm: ours at that input stand in.
    const before = clone(v);
    Object.assign(v, physics(server)); sim.restore(v);
    if (predictedDrive) sim.restoreDrivetrain(v.id, predictedDrive);
    // (`pending` are the entries still in the history: re-stepped in place.)
    for (const h of pending) { sim.step([v], () => ({ throttle: h.throttle, steer: h.steer }), TICK_DT, now); h.state = clone(v); h.drive = sim.saveDrivetrain(v.id); }
    this.stats.reconciles++; this.stats.replayed += pending.length;
    // Shown where it was, eased to the corrected prediction.
    const o = this.offset, bm = before.motion!, vm = v.motion!;
    o.x += before.x - v.x; o.y += before.y - v.y; o.z += before.z - v.z;
    o.yaw += wrap(before.yaw - v.yaw); o.pitch += bm.pitch - vm.pitch; o.roll += bm.roll - vm.roll;
    if (this.prev) { this.prev = clone(this.prev); Object.assign(this.prev, { x: this.prev.x - (before.x - v.x), y: this.prev.y - (before.y - v.y), z: this.prev.z - (before.z - v.z) }); }
  }

  private reset(server: VehicleState): void {
    if (!this.sim || !this.v) return;
    Object.assign(this.v, physics(server)); this.sim.restore(this.v);
    this.prev = null; this.history.length = 0;
    for (const k of Object.keys(this.offset) as Array<keyof typeof this.offset>) this.offset[k] = 0;
  }

  /**
   * What to draw: between the last two predicted ticks (`alpha` of the way, for frame rates above
   * the tick rate), plus the easing correction; the rest (health, crew, weapons) from the server.
   */
  pose(alpha: number, dt: number): VehicleState | null {
    const v = this.v, server = this.server;
    if (!v || !server) return null;
    const k = Math.exp(-dt * 8), o = this.offset;
    for (const key of Object.keys(o) as Array<keyof typeof o>) o[key] *= k;
    const a = this.prev ?? v, t = Math.max(0, Math.min(1, alpha));
    const out = { ...clone(server), ...physics(v) } as VehicleState;
    const m = out.motion!, am = a.motion!, vm = v.motion!;
    out.x = a.x + (v.x - a.x) * t + o.x; out.y = a.y + (v.y - a.y) * t + o.y; out.z = a.z + (v.z - a.z) * t + o.z;
    out.yaw = a.yaw + wrap(v.yaw - a.yaw) * t + o.yaw;
    m.pitch = am.pitch + (vm.pitch - am.pitch) * t + o.pitch; m.roll = am.roll + (vm.roll - am.roll) * t + o.roll;
    // Our own crash sounds come from our own prediction, at once.
    out.impact = v.impact;
    return out;
  }
}

/** The motion part of a vehicle state (what prediction owns). */
function physics(v: VehicleState): Pick<VehicleState, 'x' | 'y' | 'z' | 'yaw' | 'speed' | 'motion'> {
  const m = v.motion ?? createVehicleMotion(v.kind);
  return { x: v.x, y: v.y, z: v.z, yaw: v.yaw, speed: v.speed, motion: { ...m, suspension: [...m.suspension] } };
}
