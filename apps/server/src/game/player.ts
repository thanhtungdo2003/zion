import type { Appearance, SuspendedZombie } from '@zion/shared';
import type { LifePlayer, TimedAction } from './base-life';
import type { TutorialId } from '@zion/shared';
import type { QuestEvent, QuestJournal } from './quests';
import { CHUNK_SIZE, leanOf, InventoryModel, NO_ARMOR, PLAYER_MAX_HEALTH, STARTING_ZCOIN, type ArmorLoadout, type InputMessage, type MeleeSpec } from '@zion/shared';
import { humanoidRig, PRONE_RIG, SEATED_RIG, createCharacterState, type CharacterState } from '@zion/physics';
import { InputBudget, SuspicionTracker } from './anticheat';
import type { ChunkStreamer } from './chunk-streamer';
import type { ClientSession } from './session';

export interface PoseSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  prone?: boolean;
  seated?: boolean;
  crouched?: boolean;
  lean?: number;
}

const HISTORY = 48; // > 1.5 s at 30 Hz

/** Ring buffer of past poses for lag-compensated hit detection. */
export class PoseHistory {
  private readonly buf: PoseSample[] = Array.from({ length: HISTORY }, () => ({ t: -Infinity, x: 0, y: 0, z: 0, yaw: 0 }));
  private head = 0;
  private count = 0;

  push(t: number, x: number, y: number, z: number, yaw: number, prone = false, seated = false, crouched = false, lean = 0): void {
    const s = this.buf[this.head]!;
    s.t = t;
    s.x = x;
    s.y = y;
    s.z = z;
    s.yaw = yaw;
    s.prone = prone;
    s.seated = seated;
    s.crouched = crouched;
    s.lean = lean;
    this.head = (this.head + 1) % HISTORY;
    this.count = Math.min(HISTORY, this.count + 1);
  }

  clear(): void {
    this.count = 0;
  }

  /** Interpolated pose at time t (clamped to the recorded range). */
  sample(t: number, out: PoseSample): boolean {
    if (this.count === 0) return false;
    let newer: PoseSample | null = null;
    for (let i = 1; i <= this.count; i++) {
      const s = this.buf[(this.head - i + HISTORY) % HISTORY]!;
      if (s.t <= t) {
        if (!newer) {
          Object.assign(out, s);
          return true;
        }
        const span = newer.t - s.t;
        const a = span > 0 ? (t - s.t) / span : 0;
        out.t = t;
        out.x = s.x + (newer.x - s.x) * a;
        out.y = s.y + (newer.y - s.y) * a;
        out.z = s.z + (newer.z - s.z) * a;
        let dy = newer.yaw - s.yaw;
        if (dy > Math.PI) dy -= Math.PI * 2;
        else if (dy < -Math.PI) dy += Math.PI * 2;
        out.yaw = s.yaw + dy * a;
        out.prone = s.prone;
        out.seated = s.seated;
        out.crouched = s.crouched;
        out.lean = s.lean;
        return true;
      }
      newer = s;
    }
    Object.assign(out, newer!);
    return true;
  }
}

export class Player {
  vehicleId = 0;
  /** Seat in that vehicle: 0 driving, 1… passenger. */
  vehicleSeat = 0;
  /** Battle royale: automatic jump point on the plane's path. */
  jumpPoint: { x: number; z: number } | null = null;
  pvpEnabled = false;
  pvpUntil = 0;
  pvpLastSecond = 0;
  rank = { step: 0, tier: 0, stars: 1, title: 'Tân Binh I' };
  /** The character look chosen in the creator (null: never chosen). */
  look: Appearance | null = null;
  suspendedZombies: SuspendedZombie[] = [];
  nextEncounterRestoreAt = 0;
  readonly state: CharacterState;
  get rig() { return this.vehicleId ? SEATED_RIG : this.state.prone ? PRONE_RIG : humanoidRig(!!this.state.crouched, leanOf(this.lastButtons)); }
  rigAt(pose: PoseSample) { return pose.seated ? SEATED_RIG : pose.prone ? PRONE_RIG : humanoidRig(!!pose.crouched, pose.lean ?? 0); }
  yaw = 0;
  pitch = 0;
  aiming = false;
  aimStartedAt = 0;
  gunHeat = 0;
  lastGunShotAt = -Infinity;
  health = PLAYER_MAX_HEALTH;
  /** ZCoin balance (server-authoritative). */
  coins = STARTING_ZCOIN;
  journal: QuestJournal = {};
  questBusy = false;
  questEvents: QuestEvent[] = [];
  afterQuest: Array<() => void> = [];
  /** Left mid-transaction: called once the final save has landed. */
  onLeaveSaved: (() => void) | null = null;
  /** Knocked back by a shot: movement input ignored until then (ms). */
  stunUntil = 0;
  /** Run over: flying limp, no control until then. */
  knockedUntil = 0;
  /** Bandaging (client-reported, cosmetic: drives the animation others see). */
  bandaging = false;
  /** Aims through the first-person camera (eye-level sight line): shots are zeroed to it. */
  eyeAim = false;
  /** Knocked down: bleeding out (bleed 100 → 0) until revived or dead. */
  downed = false;
  bleed = 0;
  distressAt = 0;
  /** Reviving a downed player: done at `until` if both stay put. */
  reviving: { target: Player; until: number; x: number; z: number } | null = null;
  /** Base-life config last sent to this client (sent again only when it changes). */
  lifeConfig: object | null = null;
  life!: LifePlayer;
  lifeAction: TimedAction | null = null;
  tutorialActive: { id: TutorialId; until: number } | null = null;
  /** Earliest server time the next first aid kit may heal. */
  healReadyAt = 0;
  wireReadyAt = 0;
  dead = false;
  deadAt = 0;
  killerId: number | null = null;
  /** Who knocked this player down (credited if they bleed out). */
  downedBy: number | null = null;
  /** Battle royale spectating a teammate after death: streaming and interest follow this point. */
  viewFrom: { x: number; z: number } | null = null;
  /** Spawned and inside loaded physics. */
  active = false;

  readonly inputs: InputMessage[] = [];
  lastReceivedSeq = -1;
  lastProcessedSeq = 0;
  lastButtons = 0;
  starvedTicks = 0;
  readonly budget = new InputBudget();
  readonly suspicion = new SuspicionTracker();
  readonly history = new PoseHistory();
  attackReadyAt = 0;
  /** Blade combo: the step of the last swing (−1 none) and when that swing could be followed. */
  bladeStep = -1;
  /** Long or heavy swings so far (they alternate recorded swings). */
  meleeSwings = 0;
  bladeReadyAt = 0;
  /** WeaponId currently in hand (client-declared loadout; rules enforced server-side). */
  weapon = 0;
  /** WeaponId slung on the back (cosmetic, shown to others). */
  backWeapon = 0;
  /** Other carried gear for the character model (see packGear) and whether a backpack is worn. */
  gearPacked = 0;
  packWorn = 0;
  /** Armour the client reports wearing (wire ids per slot) and its movement multiplier. */
  armor: ArmorLoadout = { ...NO_ARMOR };
  speedMul = 1;
  /** Infected hit by a bullet: slowed to `slowFactor` until `slowUntil` (server time). */
  slowUntil = 0;
  /** Who killed this player last (battle royale: a solo player watches them after dying). */
  killedBy: number | null = null;
  /** Battle royale / infection: joined the server but still loading; enters the match on 'ready'. */
  /** Fixed maps: joined but the client is still loading the map; inputs are ignored until 'ready'. */
  awaitingReady = false;
  pendingMatch: { squad?: { id: string; name: string; size: number }; since: number } | null = null;
  slowFactor = 1;
  /** The player's inventory: owned and validated by the server. */
  readonly inv = new InventoryModel();
  /** Reload in progress: the gun (uid) and when its magazine fills. */
  reloadUid = 0;
  reloadAt = 0;
  cancelReload(): void {
    this.reloadUid = 0;
    this.reloadAt = 0;
  }
  fireReadyAt = 0;
  throwReadyAt = 0;
  attackingUntil = 0;
  /** Melee blow in its wind-up: lands at `at` (lag compensation kept as an offset). */
  strike: { at: number; blade?: MeleeSpec; rewind?: number } | null = null;
  dirty = true;
  frozenTicks = 0;

  streamer!: ChunkStreamer;

  constructor(
    readonly id: number,
    readonly accountId: string,
    readonly username: string,
    readonly session: ClientSession,
    x: number,
    y: number,
    z: number,
  ) {
    this.state = createCharacterState(x, y, z);
  }

  x(): number {
    return this.state.x;
  }

  z(): number {
    return this.state.z;
  }

  get viewX(): number { return this.viewFrom?.x ?? this.state.x; }
  get viewZ(): number { return this.viewFrom?.z ?? this.state.z; }

  get chunkX(): number {
    return Math.floor(this.viewX / CHUNK_SIZE);
  }

  get chunkZ(): number {
    return Math.floor(this.viewZ / CHUNK_SIZE);
  }
}
