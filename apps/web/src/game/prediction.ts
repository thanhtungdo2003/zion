import { Buttons, EntityFlags, TICK_DT, type InputMessage, type SelfState } from '@zion/shared';
import {
  CharacterController,
  stepAirborne,
  copyCharacterState,
  createCharacterState,
  type CharacterInput,
  type CharacterState,
  type CollisionWorld,
} from '@zion/physics';

interface PendingInput {
  seq: number;
  input: CharacterInput;
}

const MAX_PENDING = 120;
/** Corrections larger than this snap instantly instead of being smoothed. */
const SNAP_DISTANCE = 4;

/**
 * Client-side prediction with server reconciliation. The client runs the same deterministic
 * CharacterController as the server on the same collision data, so in the common case the
 * server's acknowledged state + replay of unacknowledged inputs lands exactly where we already
 * are. Any residual error is blended out visually over a few frames, never by teleporting.
 */
export class LocalPlayer {
  riding = false;
  readonly state: CharacterState;
  readonly prev: CharacterState;
  private readonly controller: CharacterController;
  private readonly pending: PendingInput[] = [];
  private readonly replayScratch = createCharacterState(0, 0, 0);
  private seq = 0;
  /** Visual correction offset, decays to zero. */
  readonly correction = { x: 0, y: 0, z: 0 };
  health = 100;
  lastButtons = 0;
  dead = false;
  lastServer: SelfState | null = null;
  reconcileError = 0;

  constructor(private readonly world: CollisionWorld, x: number, y: number, z: number) {
    this.state = createCharacterState(x, y, z);
    this.prev = createCharacterState(x, y, z);
    this.controller = new CharacterController(world);
  }

  get ready(): boolean {
    return this.controller.canSimulateAt(this.state.x, this.state.z);
  }

  /** Advances prediction by one fixed tick and returns the message to send. */
  /** Armour and held-weapon movement multiplier (mirrors the server's). */
  speedMul = 1;

  step(mx: number, mz: number, yaw: number, pitch: number, buttons: number, renderTime: number | undefined, weapon = 0): InputMessage {
    const pressedJump = !!(buttons & Buttons.Jump) && !(this.lastButtons & Buttons.Jump);
    this.lastButtons = buttons;
    copyCharacterState(this.state, this.prev);
    const input: CharacterInput = {
      mx,
      mz,
      yaw,
      jump: this.state.flight ? pressedJump : (buttons & Buttons.Jump) !== 0,
      sprint: (buttons & Buttons.Sprint) !== 0,
      roll: (buttons & Buttons.Roll) !== 0,
      prone: (buttons & Buttons.Prone) !== 0,
      speedMul: this.speedMul * (buttons & Buttons.Aim ? .65 : 1),
    };
    this.seq++;
    if (!this.dead) {
      this.simulate(input);
      this.pending.push({ seq: this.seq, input });
      if (this.pending.length > MAX_PENDING) this.pending.shift();
    }
    const msg: InputMessage = { t: 'in', s: this.seq, mx, mz, yaw, pitch, b: buttons };
    if (weapon) msg.w = weapon;
    if ((buttons & Buttons.Attack) !== 0 && renderTime !== undefined) msg.rt = Math.max(0, renderTime);
    return msg;
  }

  reconcile(server: SelfState, ackSeq: number): void {
    this.lastServer = server;
    this.health = server.health;
    this.dead = (server.flags & EntityFlags.Dead) !== 0;
    while (this.pending.length > 0 && this.pending[0]!.seq <= ackSeq) this.pending.shift();

    const before = copyCharacterState(this.state, this.replayScratch);
    const s = this.state;
    s.x = server.x;
    s.y = server.y;
    s.z = server.z;
    s.vx = server.vx;
    s.vy = server.vy;
    s.vz = server.vz;
    s.grounded = (server.flags & EntityFlags.Grounded) !== 0;
    s.swimming = (server.flags & EntityFlags.Swimming) !== 0;
    s.prone = (server.flags & EntityFlags.Prone) !== 0;
    s.climbing = (server.flags & EntityFlags.Climbing) !== 0;
    s.flight = server.flags & EntityFlags.InPlane ? 1 : server.flags & EntityFlags.Freefall ? 2 : server.flags & EntityFlags.Parachute ? 3 : 0;
    s.stuckTicks = server.stuckTicks;
    s.rollTicks = server.rollTicks;
    s.rollCooldown = server.rollCooldown;
    s.rollYaw = server.rollYaw;
    if (!this.dead) for (const p of this.pending) this.simulate(p.input);

    const ex = before.x - s.x;
    const ey = before.y - s.y;
    const ez = before.z - s.z;
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
    this.reconcileError = err;
    if (err > SNAP_DISTANCE) {
      this.correction.x = this.correction.y = this.correction.z = 0;
      copyCharacterState(s, this.prev);
    } else if (err > 1e-4) {
      // Both interpolation endpoints must move with the corrected simulation. Otherwise the
      // visual offset compensates only `state`, and each snapshot jolts the rendered position
      // by the un-interpolated part of the correction, even during ordinary running.
      this.prev.x -= ex;
      this.prev.y -= ey;
      this.prev.z -= ez;
      this.correction.x += ex;
      this.correction.y += ey;
      this.correction.z += ez;
    }
  }

  /** Hard reset (respawn/teleport). */
  teleport(x: number, y: number, z: number): void {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.prone = false;
    s.flight = 0;
    copyCharacterState(s, this.prev);
    this.pending.length = 0;
    this.correction.x = this.correction.y = this.correction.z = 0;
  }

  private simulate(input: CharacterInput): void {
    if (this.riding) return;
    if (this.state.flight === 1) { if (input.jump) this.state.flight = 2; else { this.state.x += this.state.vx * TICK_DT; this.state.z += this.state.vz * TICK_DT; } }
    else if (this.state.flight) stepAirborne(this.state, input, this.world, TICK_DT);
    else this.controller.step(this.state, input, TICK_DT);
  }

  decayCorrection(dt: number): void {
    const k = Math.exp(-dt * 12);
    this.correction.x *= k;
    this.correction.y *= k;
    this.correction.z *= k;
  }
}
