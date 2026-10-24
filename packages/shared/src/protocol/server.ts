import type { ChestStateMessage } from '../chests';
import type { BattleState, GameMode } from '../battle-royale';
import type { InfectionState } from '../infection';
import type { BaseLifeConfig } from '../base-life';
import { BinaryReadError, BinaryReader, BinaryWriter } from '../binary';
import type { WorldInfo } from '../world';
import type { TeamStateMessage } from '../teams';
import type { TutorialStateMessage } from '../tutorial';
import type { Attachments } from '../attachments';
import type { BlueprintProgress, OreKind, StructureState, SupplyMessage } from '../building';
import type { VehiclesMessage } from '../vehicles';
import type { RankTitle, RankUpdate } from '../ranks';
import type { Appearance } from '../appearance';

/* ------------------------------------------------------------------------------------------ */
/* JSON (text frame) messages — infrequent control/event traffic.                              */
/* ------------------------------------------------------------------------------------------ */

export type ErrorCode =
  | 'protocol_version'
  | 'auth_failed'
  | 'auth_timeout'
  | 'rate_limited'
  | 'invalid_message'
  | 'server_full'
  | 'duplicate_session'
  | 'kicked'
  | 'banned'
  | 'internal';

export interface WelcomeMessage {
  mode?: GameMode;
  t: 'welcome';
  playerId: number;
  username: string;
  world: WorldInfo;
  tickRate: number;
  serverTime: number;
  spawn: { x: number; y: number; z: number; yaw: number };
}

export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  message: string;
  fatal: boolean;
}

export interface PongMessage {
  t: 'pong';
  id: number;
  ct: number;
  st: number;
}

export interface ChatBroadcast {
  rank?: RankTitle;
  announcement?: boolean;
  t: 'chat';
  from: string;
  fromId: number;
  text: string;
  channel?: 'world' | 'team';
  /** A server reply (command output), shown greyed out without a sender. */
  system?: boolean;
}
export interface DoorStateEvent { t: 'door'; id: number; x: number; y: number; z: number; yaw: number; open: boolean }
export interface LootCratesEvent { t: 'lootCrates'; crates: { id: string; x: number; y: number; z: number }[] }

export interface HitEvent {
  t: 'hit';
  attackerId: number;
  targetId: number;
  zone: string;
  damage: number;
  x: number;
  y: number;
  z: number;
  /** Push direction (unit, horizontal) and strength of the hit, when it moves the target. */
  kx?: number;
  kz?: number;
  force?: number;
}

/** A gun was fired; `ends` are the server-resolved pellet end points (flattened xyz). */
export interface ShotEvent {
  t: 'shot';
  shooterId: number;
  w: number;
  ox: number;
  oy: number;
  oz: number;
  ends: number[];
  /** Fired through a suppressor: quieter, no muzzle flash. */
  sup?: 1;
}

/** A grenade left someone's hand; clients replay its flight with the shared projectile step. */
export interface GrenadeEvent {
  t: 'grenade';
  id: number;
  ownerId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuseMs: number;
  /** Which grenade (model); the frag grenade when omitted. */
  w?: number;
}

export interface ExplosionEvent {
  t: 'explosion';
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** What blew up (sound/visual flavour); hand grenade when omitted. */
  kind?: 'grenade' | 'grenade40' | 'rocket' | 'flash' | 'smoke';
}

/** A stun grenade went off near you: blinded and deafened for `ms`, scaled by `strength` (0…1). */
export interface FlashbangEvent { t: 'flashbang'; strength: number; ms: number }
/** A smoke screen: a cloud of `radius` at (x, y, z) for `ms` from now. */
export interface SmokeEvent { t: 'smoke'; id: number; x: number; y: number; z: number; radius: number; ms: number }

export interface C4Pose {
  id: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  stuck: boolean;
}
/** Complete interest-filtered set, including charges already placed before a player arrived. */
export interface C4StateEvent { t: 'c4'; charges: C4Pose[]; }

/** Damaged 1 m ground-cover cells; local x/z, ground height, server-clock fire expiry. */
export type VegetationCell = [lx: number, lz: number, y: number, burnUntil: number];
export interface VegetationMessage {
  t: 'vegetation';
  /** Replace all cached damage when entering a new streaming region. */
  reset: boolean;
  /** Each listed chunk replaces its damage map; an empty list restores all its cover. */
  chunks: Array<{ cx: number; cz: number; cells: VegetationCell[] }>;
}

/** A launcher round (40 mm grenade, rocket, crossbow bolt) left the muzzle. */
export interface ProjectileEvent {
  t: 'proj';
  id: number;
  ownerId: number;
  /** WeaponId that fired it. */
  w: number;
  kind: 'grenade40' | 'rocket' | 'bolt' | 'bullet';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag?: number;
  maxFlightSec?: number;
}

/** A round stopped: it hit something (`hit` = a body) at (x,y,z). Explosives also send 'explosion'. */
export interface ProjectileEndEvent {
  t: 'projEnd';
  id: number;
  x: number;
  y: number;
  z: number;
  hit: boolean;
  /** False for range/lifetime expiry, which should not create an impact in mid-air. */
  impact?: boolean;
  /** World surface hit; only these impacts receive a bullet-hole texture overlay. */
  normal?: [number, number, number];
}

/** Where the camp's service NPCs stand (for the minimap and the edge-of-screen guides). */
export interface NpcListEvent {
  t: 'npcs';
  npcs: Array<{ id: number; role: 'merchant' | 'nurse' | 'architect'; x: number; z: number }>;
}

/** ZCoin lying on the ground (`coins` = every drop the player can see, sent on join). */
export interface CoinDropEvent {
  t: 'coins';
  /** `amount` = ZCoin in the pile. */
  drops: Array<{ id: number; x: number; y: number; z: number; amount: number }>;
}

/** A dropped coin was picked up or expired. */
export interface CoinGoneEvent {
  t: 'coinGone';
  id: number;
}

/** Armour soaked up `absorbed` damage: the client wears its pieces down by that much. */
export interface ArmorHitEvent {
  t: 'armorHit';
  absorbed: number;
  /** A worn piece broke on this hit. */
  broke?: boolean;
}

/** The player's own inventory (only ever sent to that player). */
export interface InventoryEvent {
  t: 'inv';
  items: Array<{ uid: number; itemId: string; container: string; x: number; y: number; rotated: boolean; count?: number; mag?: number; issued?: boolean; attachments?: Attachments }>;
  equipped: number | null;
  /** Ammo-cache draws left this world day. */
  cacheLeft?: number;
}

/** Items lying on the ground (dropped by players); `items` adds or refreshes. */
export interface GroundItemsEvent {
  t: 'ground';
  items: Array<{ id: number; itemId: string; count?: number; x: number; y: number; z: number }>;
}

export interface GroundGoneEvent {
  t: 'groundGone';
  id: number;
}

/** The player's ZCoin balance, plus the trade that changed it (if any). */
export interface WalletEvent {
  t: 'wallet';
  coins: number;
  /** Echo of the client's trade request id and its outcome. */
  req?: number;
  /** Transaction outcome; successful NPC trades also set this without a request id. */
  ok?: boolean;
  reason?: 'funds' | 'range' | 'item' | 'room';
}

export interface DeathEvent {
  t: 'death';
  playerId: number;
  killerId: number | null;
}

export interface RespawnEvent {
  t: 'respawn';
  playerId: number;
  x: number;
  y: number;
  z: number;
}

export interface PlayerInfoEvent {
  t: 'players';
  /** Scoreboard: kills and deaths this match/session, out of the fight, infected, a bot. */
  /** `look`: the survivor's chosen appearance (absent: never chosen, or a bot). */
  players: Array<{ id: number; name: string; rank?: RankTitle; pvp?: boolean; kills?: number; deaths?: number; dead?: boolean; zombie?: boolean; bot?: boolean; look?: Appearance }>;
}

export interface QuestStateMessage {
  t: 'quests';
  entries: Array<{ team?: boolean; id: string; npc: string; title: string; description: string; kind: 'daily' | 'long'; dialogue: { offer: string; accept: string; progress: string; complete: string }; rewards: { coins: number; items: Array<{ item: string; count: number }> }; allowCancel: boolean; locked: boolean; stage: number; stages: number; goal: number; objective: string; status: string; progress: number; retrievalItem?: string; retrievalModel?: string; target?: { x: number; z: number; radius: number }; /** Quest items lying in the world for this player (exact spots). */ drops?: Array<{ x: number; z: number }> }>;
}

export interface QuestNpcMessage { t: 'questNpcs'; npcs: Array<{ id: number; key: string; name: string; model: string; x: number; y: number; z: number }> }
export interface SpeechMessage { t: 'speech'; npc: number; text: string; duration: number; x: number; y: number; z: number }
/** Base life state; `config` / world parts are omitted when unchanged (merge into the last one). */
export interface BaseLifeMessage { t: 'baseLife'; objects?: Array<{ id: string; model: string; x: number; y: number; z: number; cooking?: boolean; expiresAt?: number }>; config?: BaseLifeConfig; plots?: Record<string, { crop: string; stage: number }>; animalLoot?: Array<{ id: string; item: string; quantity: number; x: number; y: number; z: number }>; stamina: number; capacity: number; action: { end: number; kind: string; ms: number } | null }
/** A downed player called for help (sent to everyone nearby). */
export interface DistressMessage { t: 'distress'; playerId: number; name: string; x: number; z: number }
/** Reviving someone: done at `until` (ms, server clock); target 0 = cancelled / finished. */
export interface RevivingMessage { t: 'reviving'; target: number; durationMs: number }
/** Felled trees: props hidden (felled or growing back) and trunks lying on the ground. */
export interface TreesMessage {
  t: 'trees';
  removed: string[];
  trunks: Array<{ key: string; asset: number; x: number; y: number; z: number; scale: number; rotY: number; dir: number; logs: number; at: number }>;
  /** Rocks worked out (no more ore until they recover). */
  spent: string[];
}
/** You (infected) were shot: pushed back by (vx, vz) m/s and slowed to `factor` for `ms`. */
export interface StaggerEvent { t: 'stagger'; vx: number; vz: number; factor: number; ms: number }
/** A light prop knocked away (vehicle, bullet, blast): its model flies off as debris. */
export interface KnockEvent {
  t: 'knock';
  key: string; asset: number; x: number; y: number; z: number; rotY: number; scale: number;
  vx: number; vy: number; vz: number;
  /** A small tree: it falls over instead of flying. */
  tree: boolean;
}
/** Every prop currently knocked down (join, and whenever some stand again). */
export interface KnockedMessage { t: 'knocked'; keys: string[] }
/** Player structures: the full list (join), one changed, or one gone. */
export interface StructuresMessage { t: 'structures'; list: StructureState[] }
export interface StructureMessage { t: 'structure'; s: StructureState; hit?: { piece: number; x: number; y: number; z: number; broke: boolean } }
export interface StructureGoneMessage { t: 'structureGone'; id: number }
/** The architect's ledger: what this player has handed in towards each blueprint. */
export interface BlueprintsMessage { t: 'blueprints'; progress: BlueprintProgress[]; ready?: string }
/** An axe bit into a tree / a pickaxe into a rock (chips and sound). */
export interface ChopEvent { t: 'chop'; x: number; y: number; z: number; kind: 'wood' | OreKind }
export type ServerJsonMessage =
  | ChopEvent
  | KnockEvent
  | StaggerEvent
  | KnockedMessage
  | TreesMessage
  | StructuresMessage
  | StructureMessage
  | StructureGoneMessage
  | BlueprintsMessage
  | SupplyMessage
  | VehiclesMessage
  | BattleState
  | InfectionState
  | { t: 'pvp'; enabled: boolean; remainingMs: number }
  | RankUpdate
  | TutorialStateMessage
  | TeamStateMessage
  | VegetationMessage
  | ChestStateMessage
  | DistressMessage
  | RevivingMessage
  | BaseLifeMessage
  | QuestNpcMessage
  | SpeechMessage
  | QuestStateMessage
  | WelcomeMessage
  | ErrorMessage
  | PongMessage
  | ChatBroadcast
  | DoorStateEvent
  | LootCratesEvent
  | HitEvent
  | ShotEvent
  | GrenadeEvent
  | C4StateEvent
  | ExplosionEvent
  | FlashbangEvent
  | SmokeEvent
  | ProjectileEvent
  | ProjectileEndEvent
  | WalletEvent
  | ArmorHitEvent
  | InventoryEvent
  | GroundItemsEvent
  | GroundGoneEvent
  | CoinDropEvent
  | NpcListEvent
  | CoinGoneEvent
  | DeathEvent
  | RespawnEvent
  | PlayerInfoEvent;

/* ------------------------------------------------------------------------------------------ */
/* Binary messages — high-frequency state and bulk world data.                                 */
/* ------------------------------------------------------------------------------------------ */

export enum BinaryMessageType {
  Snapshot = 1,
  Chunk = 2,
  ChunkUnload = 3,
}

export enum EntityKind {
  QuestNpc = 9,
  Animal = 10,
  Player = 1,
  Zombie = 2,
  Guard = 3,
  Merchant = 4,
  Nurse = 5,
  Architect = 11,
}

export const EntityFlags = {
  Grounded: 1 << 0,
  Swimming: 1 << 1,
  Dead: 1 << 2,
  Sprinting: 1 << 3,
  Attacking: 1 << 4,
  Rolling: 1 << 5,
  /** Holding a flashlight in the off hand (clients light it at night). */
  Flashlight: 1 << 6,
  /** On a ladder. */
  Climbing: 1 << 7,
  /** Knocked down (health gone): bleeding out until revived or dead; `health` carries the bleed. */
  Downed: 1 << 8,
  /** Zombie leap in progress. */
  Leaping: 1 << 9,
  /** Performing CPR on a downed teammate. */
  Reviving: 1 << 10,
  Prone: 1 << 11,
  Aiming: 1 << 12,
  InPlane: 1 << 13,
  Freefall: 1 << 14,
  Parachute: 1 << 15,
  /** Thrown by a vehicle: limp ragdoll, no control until it wears off. */
  Knocked: 1 << 16,
  /** Applying a first aid kit. */
  Healing: 1 << 17,
  LeanLeft: 1 << 18,
  LeanRight: 1 << 19,
  Crouching: 1 << 20,
  /** Climbing over a ledge (mantle). */
  Mantling: 1 << 21,
  /** Holding a blueprint up (placing a structure). */
  Planning: 1 << 22,
  /** A badly hurt zombie standing still and screaming before it charges. */
  Screaming: 1 << 23,
} as const;

export interface SelfState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  flags: number;
  health: number;
  stuckTicks: number;
  rollTicks: number;
  rollCooldown: number;
  rollYaw: number;
  /** Remaining ticks of a blade finisher's lunge. */
  lungeTicks?: number;
}

export interface EntityState {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  health: number;
  /** WeaponId in hand (players) or packed limbs + variant (zombies, see `Limb` and `zombieVariant`). */
  weapon: number;
  /** Weapon slung on the back (players only; 0 = none). */
  back?: number;
  /** Worn armour, packed (see `packArmor`; players only; 0 = none). */
  armor?: number;
  /** Attachments on the gun in hand, packed (see `packAttachments`; 0 = none). */
  att?: number;
  /** More carried gear, packed (see `packGear`): second/third back gun, holster, belt. */
  gear?: number;
  /** Backpack worn (1) or not (0). */
  pack?: number;
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  timeOfDay: number;
  ackSeq: number;
  self: SelfState;
  entities: EntityState[];
}

const ANGLE_SCALE = 32767 / Math.PI;
export const MAX_SNAPSHOT_ENTITIES = 256;

function quantAngle(a: number): number {
  return Math.max(-32767, Math.min(32767, Math.round(a * ANGLE_SCALE)));
}

export function encodeSnapshot(s: Snapshot, w = new BinaryWriter(64 + s.entities.length * 28)): Uint8Array {
  w.u8(BinaryMessageType.Snapshot);
  w.u32(s.tick);
  w.f64(s.serverTime);
  w.f32(s.timeOfDay);
  w.u32(s.ackSeq);
  const me = s.self;
  // Self state is sent at full float precision: client-side reconciliation replays inputs from it.
  w.f32(me.x).f32(me.y).f32(me.z).f32(me.vx).f32(me.vy).f32(me.vz);
  w.u32(me.flags).u8(me.health).u8(Math.min(255, me.stuckTicks));
  w.u8(Math.min(255, me.rollTicks)).u8(Math.min(255, me.rollCooldown)).f32(me.rollYaw).u8(Math.min(255, me.lungeTicks ?? 0));
  const count = Math.min(s.entities.length, MAX_SNAPSHOT_ENTITIES);
  w.u16(count);
  for (let i = 0; i < count; i++) {
    const e = s.entities[i]!;
    w.u32(e.id).u8(e.kind).f32(e.x).f32(e.y).f32(e.z);
    w.i16(quantAngle(e.yaw)).i16(quantAngle(e.pitch));
    w.u32(e.flags).u8(e.health).u8(e.weapon).u8(e.back ?? 0).u32(e.armor ?? 0).u8(e.att ?? 0).u32(e.gear ?? 0).u8(e.pack ?? 0);
  }
  return w.finish();
}

export function decodeSnapshot(data: Uint8Array): Snapshot {
  const r = new BinaryReader(data);
  if (r.u8() !== BinaryMessageType.Snapshot) throw new BinaryReadError('not a snapshot');
  const tick = r.u32();
  const serverTime = r.f64();
  const timeOfDay = r.f32();
  const ackSeq = r.u32();
  const self: SelfState = {
    x: r.f32(),
    y: r.f32(),
    z: r.f32(),
    vx: r.f32(),
    vy: r.f32(),
    vz: r.f32(),
    flags: r.u32(),
    health: r.u8(),
    stuckTicks: r.u8(),
    rollTicks: r.u8(),
    rollCooldown: r.u8(),
    rollYaw: r.f32(),
    lungeTicks: r.u8(),
  };
  const count = r.u16();
  if (count > MAX_SNAPSHOT_ENTITIES) throw new BinaryReadError('too many entities');
  const entities: EntityState[] = new Array<EntityState>(count);
  for (let i = 0; i < count; i++) {
    entities[i] = {
      id: r.u32(),
      kind: r.u8() as EntityKind,
      x: r.f32(),
      y: r.f32(),
      z: r.f32(),
      yaw: r.i16() / ANGLE_SCALE,
      pitch: r.i16() / ANGLE_SCALE,
      flags: r.u32(),
      health: r.u8(),
      weapon: r.u8(),
      back: r.u8(),
      armor: r.u32(),
      att: r.u8(),
      gear: r.u32(),
      pack: r.u8(),
    };
  }
  return { tick, serverTime, timeOfDay, ackSeq, self, entities };
}

export interface ChunkMessageHeader {
  cx: number;
  cz: number;
  lod: number;
  /** Monotonic per-connection stream sequence; lets the client order async decodes vs unloads. */
  seq: number;
}

export const CHUNK_HEADER_BYTES = 10;

/** Builds a chunk frame: header + already-deflated chunk body. */
export function encodeChunkMessage(h: ChunkMessageHeader, compressedBody: Uint8Array): Uint8Array {
  const out = new Uint8Array(CHUNK_HEADER_BYTES + compressedBody.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, BinaryMessageType.Chunk);
  v.setUint8(1, h.lod);
  v.setInt16(2, h.cx, true);
  v.setInt16(4, h.cz, true);
  v.setUint32(6, h.seq >>> 0, true);
  out.set(compressedBody, CHUNK_HEADER_BYTES);
  return out;
}

export function decodeChunkMessage(data: Uint8Array): { header: ChunkMessageHeader; body: Uint8Array } {
  if (data.length < CHUNK_HEADER_BYTES) throw new BinaryReadError('chunk frame too short');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint8(0) !== BinaryMessageType.Chunk) throw new BinaryReadError('not a chunk frame');
  return {
    header: { lod: v.getUint8(1), cx: v.getInt16(2, true), cz: v.getInt16(4, true), seq: v.getUint32(6, true) },
    body: data.subarray(CHUNK_HEADER_BYTES),
  };
}

export function encodeChunkUnload(seq: number, chunks: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const w = new BinaryWriter(8 + chunks.length * 4);
  w.u8(BinaryMessageType.ChunkUnload).u32(seq).u16(chunks.length);
  for (const [cx, cz] of chunks) w.i16(cx).i16(cz);
  return w.finish();
}

export function decodeChunkUnload(data: Uint8Array): { seq: number; chunks: Array<[number, number]> } {
  const r = new BinaryReader(data);
  if (r.u8() !== BinaryMessageType.ChunkUnload) throw new BinaryReadError('not an unload frame');
  const seq = r.u32();
  const n = r.u16();
  const chunks: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) chunks.push([r.i16(), r.i16()]);
  return { seq, chunks };
}
