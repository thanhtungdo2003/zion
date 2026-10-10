import type { ChestStateMessage } from '../chests';
import type { BaseLifeConfig } from '../base-life';
import { BinaryReadError, BinaryReader, BinaryWriter } from '../binary';
import type { WorldInfo } from '../world';

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
  t: 'chat';
  from: string;
  fromId: number;
  text: string;
  /** A server reply (command output), shown greyed out without a sender. */
  system?: boolean;
}

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
}

export interface ExplosionEvent {
  t: 'explosion';
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** What blew up (sound/visual flavour); hand grenade when omitted. */
  kind?: 'grenade' | 'grenade40' | 'rocket';
}

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
  kind: 'grenade40' | 'rocket' | 'bolt';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
}

/** A round stopped: it hit something (`hit` = a body) at (x,y,z). Explosives also send 'explosion'. */
export interface ProjectileEndEvent {
  t: 'projEnd';
  id: number;
  x: number;
  y: number;
  z: number;
  hit: boolean;
}

/** Where the camp's service NPCs stand (for the minimap and the edge-of-screen guides). */
export interface NpcListEvent {
  t: 'npcs';
  npcs: Array<{ id: number; role: 'merchant' | 'nurse'; x: number; z: number }>;
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
  items: Array<{ uid: number; itemId: string; container: string; x: number; y: number; rotated: boolean; count?: number; mag?: number; issued?: boolean }>;
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
  players: Array<{ id: number; name: string }>;
}

export interface QuestStateMessage {
  t: 'quests';
  entries: Array<{ id: string; npc: string; title: string; description: string; kind: 'daily' | 'long'; dialogue: { offer: string; accept: string; progress: string; complete: string }; rewards: { coins: number; items: Array<{ item: string; count: number }> }; allowCancel: boolean; locked: boolean; stage: number; stages: number; goal: number; objective: string; status: string; progress: number; retrievalItem?: string; retrievalModel?: string; target?: { x: number; z: number; radius: number }; /** Quest items lying in the world for this player (exact spots). */ drops?: Array<{ x: number; z: number }> }>;
}

export interface QuestNpcMessage { t: 'questNpcs'; npcs: Array<{ id: number; key: string; name: string; model: string; x: number; y: number; z: number }> }
export interface SpeechMessage { t: 'speech'; npc: number; text: string; duration: number; x: number; y: number; z: number }
/** Base life state; `config` / world parts are omitted when unchanged (merge into the last one). */
export interface BaseLifeMessage { t: 'baseLife'; objects?: Array<{ id: string; model: string; x: number; y: number; z: number }>; config?: BaseLifeConfig; plots?: Record<string, { crop: string; stage: number }>; animalLoot?: Array<{ id: string; item: string; quantity: number; x: number; y: number; z: number }>; stamina: number; capacity: number; action: { end: number; kind: string; ms: number } | null }
/** A downed player called for help (sent to everyone nearby). */
export interface DistressMessage { t: 'distress'; playerId: number; name: string; x: number; z: number }
/** Reviving someone: done at `until` (ms, server clock); target 0 = cancelled / finished. */
export interface RevivingMessage { t: 'reviving'; target: number; durationMs: number }
export type ServerJsonMessage =
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
  | HitEvent
  | ShotEvent
  | GrenadeEvent
  | ExplosionEvent
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
  w.u16(me.flags).u8(me.health).u8(Math.min(255, me.stuckTicks));
  w.u8(Math.min(255, me.rollTicks)).u8(Math.min(255, me.rollCooldown)).f32(me.rollYaw);
  const count = Math.min(s.entities.length, MAX_SNAPSHOT_ENTITIES);
  w.u16(count);
  for (let i = 0; i < count; i++) {
    const e = s.entities[i]!;
    w.u32(e.id).u8(e.kind).f32(e.x).f32(e.y).f32(e.z);
    w.i16(quantAngle(e.yaw)).i16(quantAngle(e.pitch));
    w.u16(e.flags).u8(e.health).u8(e.weapon).u8(e.back ?? 0).u32(e.armor ?? 0);
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
    flags: r.u16(),
    health: r.u8(),
    stuckTicks: r.u8(),
    rollTicks: r.u8(),
    rollCooldown: r.u8(),
    rollYaw: r.f32(),
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
      flags: r.u16(),
      health: r.u8(),
      weapon: r.u8(),
      back: r.u8(),
      armor: r.u32(),
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
