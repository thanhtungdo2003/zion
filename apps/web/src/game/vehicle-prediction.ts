import { TICK_DT, createVehicleMotion, type VehicleState } from '@zion/shared';
import { JoltVehicles, joltLoaded, loadJolt, type CollisionWorld } from '@zion/physics';

interface Sample { time: number; x: number; y: number; z: number; yaw: number }

const copy = (v: VehicleState): VehicleState => {
  const motion = v.motion ?? createVehicleMotion(v.kind);
  return { ...v, motion: { ...motion, suspension: [...motion.suspension] } };
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Beyond this disagreement (m) the server state is adopted outright instead of blended. */
const SNAP_DISTANCE = 6;
/** Share of the remaining correction applied per fixed step. */
const CORRECTION_RATE = .18;

/**
 * Client-side prediction for the vehicle the local player drives, as shooters do for player
 * movement: the same Jolt vehicle model runs in the browser on the same fixed tick and the same
 * inputs that go to the server, so the car answers the controls immediately. The server stays
 * authoritative: each snapshot is compared with where we predicted the car to be at that moment
 * (the server applies our inputs one network trip late) and the difference is folded back in
 * gradually, or snapped when it is large.
 */
export class VehiclePrediction {
  private sim: JoltVehicles | null = null;
  private state: VehicleState | null = null;
  private previous: VehicleState | null = null;
  private history: Sample[] = [];
  private correction = { x: 0, y: 0, z: 0, yaw: 0 };
  private loading = false;

  constructor(private readonly world: CollisionWorld) {}

  /** Id of the predicted vehicle, if any. */
  get id(): number | null { return this.state?.id ?? null; }

  /** Starts (or keeps) predicting `server`, the authoritative state of our vehicle. */
  begin(server: VehicleState): void {
    if (this.state?.id === server.id) return;
    this.end();
    if (!joltLoaded()) {
      if (!this.loading) { this.loading = true; void loadJolt().finally(() => { this.loading = false; }); }
      return;
    }
    this.sim = new JoltVehicles(this.world);
    this.state = copy(server); this.previous = copy(server);
    this.sim.add(this.state);
  }

  end(): void {
    this.sim?.dispose(); this.sim = null;
    this.state = this.previous = null; this.history = [];
    this.correction = { x: 0, y: 0, z: 0, yaw: 0 };
  }

  /** One fixed tick with the controls just sent to the server; `now` is the server-clock time. */
  step(throttle: number, steer: number, now: number): void {
    const sim = this.sim, v = this.state;
    if (!sim || !v) return;
    this.previous = copy(v);
    // Fold part of the pending correction into the simulated body.
    const k = CORRECTION_RATE, c = this.correction;
    if (c.x || c.z || c.y || c.yaw) {
      v.x += c.x * k; v.y += c.y * k; v.z += c.z * k; v.yaw += c.yaw * k;
      c.x *= 1 - k; c.y *= 1 - k; c.z *= 1 - k; c.yaw *= 1 - k;
      if (Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z) < .005 && Math.abs(c.yaw) < .001) this.correction = { x: 0, y: 0, z: 0, yaw: 0 };
    }
    sim.step([v], () => ({ throttle, steer }), TICK_DT, now);
    this.history.push({ time: now, x: v.x, y: v.y, z: v.z, yaw: v.yaw });
    if (this.history.length > 90) this.history.shift();
  }

  /**
   * Reconciles with an authoritative snapshot taken at server time `time`. Our inputs reach the
   * server about half a round trip late, so it is compared with our prediction from then.
   */
  reconcile(server: VehicleState, time: number, oneWayMs: number): void {
    const v = this.state;
    if (!v || server.id !== v.id) return;
    // Health, explosions and the like are always the server's.
    v.health = server.health; v.explodeAt = server.explodeAt; v.exploded = server.exploded; v.driver = server.driver;
    const then = this.sample(time - oneWayMs);
    if (!then) return;
    const dx = server.x - then.x, dy = server.y - then.y, dz = server.z - then.z;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) {
      // Too far apart (a crash we did not predict, a reset): adopt the server state.
      Object.assign(v, copy(server)); this.previous = copy(server);
      this.history = []; this.correction = { x: 0, y: 0, z: 0, yaw: 0 };
      return;
    }
    this.correction = { x: dx, y: dy, z: dz, yaw: Math.atan2(Math.sin(server.yaw - then.yaw), Math.cos(server.yaw - then.yaw)) };
  }

  /** Smooth render pose between the last two fixed ticks. */
  pose(alpha: number): VehicleState | null {
    const a = this.previous, b = this.state;
    if (!a || !b) return null;
    const p = copy(b), m = p.motion!, am = a.motion!, bm = b.motion!;
    p.x = lerp(a.x, b.x, alpha); p.y = lerp(a.y, b.y, alpha); p.z = lerp(a.z, b.z, alpha);
    p.yaw = angle(a.yaw, b.yaw, alpha); p.speed = lerp(a.speed, b.speed, alpha);
    m.pitch = lerp(am.pitch, bm.pitch, alpha); m.roll = lerp(am.roll, bm.roll, alpha);
    m.suspension = m.suspension.map((_, i) => lerp(am.suspension[i]!, bm.suspension[i]!, alpha)) as typeof m.suspension;
    return p;
  }

  private sample(time: number): Sample | null {
    const h = this.history;
    if (!h.length || time < h[0]!.time) return null;
    for (let i = h.length - 1; i >= 0; i--) {
      const a = h[i]!;
      if (a.time > time) continue;
      const b = h[i + 1];
      if (!b) return a;
      const t = (time - a.time) / (b.time - a.time || 1);
      return { time, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), yaw: angle(a.yaw, b.yaw, t) };
    }
    return null;
  }
}
