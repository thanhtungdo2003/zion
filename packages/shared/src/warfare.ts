import { z } from 'zod';
import { ITEMS, ammoItemFor, maxCount } from './items';
import { CONTAINERS, canPlace, magazineOf, type ContainerId, type InventoryData, type PlacedItem } from './inventory';
import { type VehicleKind } from './vehicles';

/**
 * Warfare: a large-scale two-sided ticket battle (Ravenfield / Delta Force style). Two sides
 * (`blue`, `red`) fight over capture zones; every death costs the dying side one ticket, and the
 * side holding more zones bleeds the other's tickets. A side at 0 tickets loses.
 *
 * Everything tunable lives in one validated config (`warfareConfigSchema`): an invalid or missing
 * value falls back to the safe default, never to something that could crash or hang a match.
 */

export type WarfareSide = 'blue' | 'red';
export const WARFARE_SIDES: readonly WarfareSide[] = ['blue', 'red'];
export const otherSide = (s: WarfareSide): WarfareSide => (s === 'blue' ? 'red' : 'blue');

/* ------------------------------------------------------------------ map modes */

/**
 * The game modes a World Studio map can be published for. A map is offered only in the modes it
 * is published for (a battlefield need not be a battle royale map). A new mode joins here.
 */
export const WORLD_MAP_MODES = [
  { id: 'battle-royale', name: 'Battle Royale', hint: 'Bản đồ xuất hiện trong mục Bản đồ của Battle Royale' },
  { id: 'warfare', name: 'Chiến trường', hint: 'Bản đồ xuất hiện trong chế độ Chiến trường (cần bố cục chiến trường hợp lệ)' },
] as const;
export type WorldMapMode = (typeof WORLD_MAP_MODES)[number]['id'];
export const WORLD_MAP_MODE_IDS = WORLD_MAP_MODES.map((m) => m.id) as [WorldMapMode, ...WorldMapMode[]];
export const worldMapModesSchema = z.array(z.enum(WORLD_MAP_MODE_IDS)).min(1).max(WORLD_MAP_MODES.length);

/* ------------------------------------------------------------------ config */

/** The game's own jeep and quad bike: the vehicles bots and players drive on the battlefield. */
export const WARFARE_VEHICLE_KINDS = ['jeep', 'quad', 'marauder', 't80u', 't90a', 't62a', 'tank', 'mi17', 'z10', 'tiger'] as const satisfies readonly VehicleKind[];

export const warfareConfigSchema = z.object({
  /** Tickets each side starts with. */
  tickets: z.number().int().min(10).max(5000).catch(300),
  /** Hard cap on deployed combatants (humans + bots, both sides). */
  maxActive: z.number().int().min(4).max(50).catch(50),
  /** Seconds between death and the earliest redeploy. */
  respawnSeconds: z.number().min(1).max(60).catch(7),
  /** Bots a single player may have following them. */
  followerCap: z.number().int().min(0).max(12).catch(6),
  /** Bots in one AI squad. */
  squadSize: z.number().int().min(2).max(8).catch(5),
  /** Max humans in one player squad. */
  playerSquadSize: z.number().int().min(1).max(8).catch(4),
  /** Seconds one uncontested capturer needs to flip a neutral zone (twice that from enemy). */
  captureSeconds: z.number().min(2).max(120).catch(12),
  /** Extra capture speed per additional capturer (diminishing, capped at ×3). */
  captureBonusPerUnit: z.number().min(0).max(1).catch(.25),
  /** Tickets bled per second for each zone of difference, ... */
  bleedPerZone: z.number().min(0).max(5).catch(.2),
  /** ... never more than this per second. */
  bleedMaxPerSecond: z.number().min(0).max(10).catch(1),
  /** A lead of fewer zones than this bleeds nothing (losing one zone never decides a match). */
  bleedMinLead: z.number().int().min(1).max(10).catch(2),
  /** Seconds from match start before bleed begins (lets both sides reach the first zones). */
  bleedGraceSeconds: z.number().min(0).max(600).catch(60),
  /** Match time limit in minutes (0 = unlimited); on timeout the side with more tickets wins. */
  timeLimitMinutes: z.number().min(0).max(180).catch(30),
  /** Optional extra win: hold every zone this many seconds (0 = off; tickets always decide too). */
  allZonesSeconds: z.number().int().min(0).max(600).catch(0),
  /** Fill each side up to its share of the active cap with bots. */
  botFill: z.boolean().catch(true),
  /** Where units may deploy: any held zone, only the zone nearest the front, or the base only. */
  spawnRule: z.enum(['any-held', 'front', 'base-only']).catch('any-held'),
  /** Seconds of pre-match countdown once the first human joins. */
  countdownSeconds: z.number().int().min(0).max(120).catch(10),
  /** Seconds the result screen stays up before the room closes. */
  overSeconds: z.number().int().min(3).max(120).catch(15),
  /** Seconds an empty (no humans) match lingers before it is torn down. */
  emptyGraceSeconds: z.number().int().min(5).max(600).catch(30),
  /** Radius (m) around a player in which G recruits idle allied bots. */
  recruitRadius: z.number().min(5).max(80).catch(25),
  /** Seconds a spawn point is blocked after someone spawned on it (no stacked spawns). */
  spawnCooldownSeconds: z.number().min(0).max(30).catch(2),
  /** Min distance (m) between an enemy and a zone for it to be a valid deploy point. */
  spawnSafeRadius: z.number().min(0).max(100).catch(18),
  /** Vehicle pool per side. */
  vehicles: z.object({
    enabled: z.boolean().catch(true),
    /** Seconds after a wreck is cleaned up before its slot spawns a replacement. */
    cooldownSeconds: z.number().min(5).max(600).catch(45),
    /** Seconds a destroyed vehicle stays as a wreck before cleanup. */
    wreckSeconds: z.number().min(2).max(300).catch(20),
    /** Seconds an abandoned (never-entered or left) vehicle may idle far from base before cleanup. */
    abandonSeconds: z.number().min(30).max(1800).catch(240),
    /** Max simultaneously alive vehicles per side. */
    maxPerSide: z.number().int().min(0).max(12).catch(4),
  }).strict().catch({ enabled: true, cooldownSeconds: 45, wreckSeconds: 20, abandonSeconds: 240, maxPerSide: 4 }),
}).strip();
export type WarfareConfig = z.infer<typeof warfareConfigSchema>;

export const WARFARE_DEFAULTS: WarfareConfig = Object.freeze(warfareConfigSchema.parse({})) as WarfareConfig;

/** Parse an untrusted config; every bad/missing field falls back to its default (never throws). */
export function parseWarfareConfig(raw: unknown): WarfareConfig {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const r = warfareConfigSchema.safeParse(obj);
  return r.success ? r.data : { ...WARFARE_DEFAULTS, vehicles: { ...WARFARE_DEFAULTS.vehicles } };
}

/* ------------------------------------------------------------------ layout */

const coord = z.number().finite().min(-400).max(400);
const wfPoint = z.object({ x: coord, z: coord, y: z.number().finite().min(-50).max(300).optional() }).strict();
export type WarfarePoint = z.infer<typeof wfPoint>;

export const WARFARE_POINT_KINDS = ['cover', 'overwatch', 'sniper', 'defend'] as const;
export type WarfarePointKind = (typeof WARFARE_POINT_KINDS)[number];

export const warfareZoneSchema = z.object({
  id: z.string().min(1).max(24).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(32),
  x: coord,
  z: coord,
  y: z.number().finite().min(-50).max(300).optional(),
  radius: z.number().min(4).max(60),
  /** Who holds it at match start (null = neutral). */
  owner: z.enum(['blue', 'red']).nullable().default(null),
  /** Deploy points of the side holding it (empty: round the centre, clear of the capture ring). */
  spawns: z.array(wfPoint).max(8).default([]),
  /** Tactical spots for the AI: cover, lookouts, sniper nests, defensive positions. */
  points: z.array(wfPoint.extend({ kind: z.enum(WARFARE_POINT_KINDS) })).max(16).default([]),
  /** Neighbouring zones (attack routes); empty: the nearest zones count as neighbours. */
  links: z.array(z.string().max(24)).max(8).default([]),
  /** Weight for the AI commander (1 = normal; a key position is worth more). */
  value: z.number().min(.2).max(5).default(1),
}).strict();
export type WarfareZone = z.infer<typeof warfareZoneSchema>;

export const warfareVehicleSpawnSchema = z.object({
  side: z.enum(['blue', 'red']),
  kind: z.enum(WARFARE_VEHICLE_KINDS),
  x: coord,
  z: coord,
  y: z.number().finite().min(-50).max(300).optional(),
  yaw: z.number().finite().default(0),
}).strict();
export type WarfareVehicleSpawn = z.infer<typeof warfareVehicleSpawnSchema>;

/** The Warfare part of a Studio map: zones, the two main bases and vehicle slots. */
export const warfareLayoutSchema = z.object({
  /** The admin turned Warfare on for this map (it is listed in the Warfare map picker). */
  enabled: z.boolean().default(false),
  /**
   * The battlefield on a large world (World Studio maps): its centre in world metres and half its
   * width. Every other coordinate of the layout is relative to this centre. Absent on the walled
   * Studio maps, whose centre and size are the map's own.
   */
  area: z.object({ x: z.number().finite().min(0).max(8256), z: z.number().finite().min(0).max(8256), half: z.number().min(30).max(400) }).strict().optional(),
  zones: z.array(warfareZoneSchema).max(16).default([]),
  /** Main base of each side: always a deploy point, never capturable. */
  bases: z.object({ blue: wfPoint, red: wfPoint }).strict().optional(),
  vehicleSpawns: z.array(warfareVehicleSpawnSchema).max(32).default([]),
  /** Per-map config overrides (validated field by field). */
  config: z.record(z.unknown()).optional(),
}).strict();
export type WarfareLayout = z.infer<typeof warfareLayoutSchema>;

/** Problems that make a layout unplayable (empty = OK). */
export function validateWarfareLayout(layout: WarfareLayout, mapHalf = 400): string[] {
  const errs: string[] = [];
  const half = layout.area?.half ?? mapHalf;
  const ids = new Set<string>();
  const inside = (p: { x: number; z: number }) => Math.abs(p.x) <= half && Math.abs(p.z) <= half;
  for (const zn of layout.zones) {
    if (ids.has(zn.id)) errs.push(`zone id "${zn.id}" is duplicated`);
    ids.add(zn.id);
    if (!inside(zn)) errs.push(`zone "${zn.id}" is outside the map`);
    for (const p of [...zn.spawns, ...zn.points]) if (!inside(p)) errs.push(`zone "${zn.id}" has a point outside the map`);
  }
  for (const zn of layout.zones) for (const l of zn.links) if (!ids.has(l) || l === zn.id) errs.push(`zone "${zn.id}" links to unknown zone "${l}"`);
  if (layout.bases) for (const zn of layout.zones) for (const s of WARFARE_SIDES) {
    if (Math.hypot(zn.x - layout.bases[s].x, zn.z - layout.bases[s].z) < zn.radius + 6) errs.push(`zone "${zn.id}" overlaps the ${s} base`);
  }
  if (!layout.zones.length) errs.push('no capture zones');
  if (!layout.bases) errs.push('missing main bases');
  else {
    for (const s of WARFARE_SIDES) if (!inside(layout.bases[s])) errs.push(`${s} base is outside the map`);
    if (Math.hypot(layout.bases.blue.x - layout.bases.red.x, layout.bases.blue.z - layout.bases.red.z) < 40) errs.push('bases are closer than 40 m');
  }
  for (const v of layout.vehicleSpawns) if (!inside(v)) errs.push(`${v.side} ${v.kind} spawn is outside the map`);
  return errs;
}

/** A playable default layout for a map without one: bases on opposite edges, zones between. */
export function autoWarfareLayout(half: number, zoneCount = 5): WarfareLayout {
  const edge = Math.max(20, half - 18);
  const n = Math.max(1, Math.min(9, zoneCount));
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India'];
  const zones: WarfareZone[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? .5 : i / (n - 1);
    const r = Math.min(14, Math.max(6, half / 12)), span = Math.max(0, edge - r - 8);
    const x = Math.round((-span + t * span * 2) * 10) / 10;
    const zz = Math.round(Math.sin(t * Math.PI * 2) * half * .35 * 10) / 10 + 0;
    zones.push({ id: names[i]!.toLowerCase(), name: names[i]!, x, z: zz, radius: r, owner: null, spawns: [], points: [], links: [], value: 1 });
  }
  return {
    enabled: true,
    zones,
    bases: { blue: { x: -edge, z: 0 }, red: { x: edge, z: 0 } },
    vehicleSpawns: [
      { side: 'blue', kind: 'jeep', x: -edge + 6, z: 8, yaw: Math.PI / 2 },
      { side: 'blue', kind: 'quad', x: -edge + 6, z: -8, yaw: Math.PI / 2 },
      { side: 'red', kind: 'jeep', x: edge - 6, z: 8, yaw: -Math.PI / 2 },
      { side: 'red', kind: 'quad', x: edge - 6, z: -8, yaw: -Math.PI / 2 },
    ],
  };
}

/** Layout to actually play: the map's own if valid, else the auto layout. */
export function resolveWarfareLayout(layout: WarfareLayout | undefined, mapHalf: number): { layout: WarfareLayout; auto: boolean; errors: string[] } {
  const half = layout?.area?.half ?? mapHalf;
  const auto = (): WarfareLayout => ({ ...autoWarfareLayout(half), ...(layout?.area ? { area: layout.area } : {}), ...(layout?.config ? { config: layout.config } : {}) });
  if (layout) {
    const parsed = warfareLayoutSchema.safeParse(layout);
    if (parsed.success) {
      const errors = validateWarfareLayout(parsed.data, half);
      if (!errors.length) return { layout: parsed.data, auto: false, errors };
      return { layout: auto(), auto: true, errors };
    }
    return { layout: auto(), auto: true, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  return { layout: auto(), auto: true, errors: [] };
}

/* ------------------------------------------------------------------ tickets */

/**
 * Ticket accounting. Every deduction carries a key (e.g. `death:<unitId>:<life>`) and a key is
 * only ever charged once, so a death reported twice can never cost two tickets.
 */
export class TicketLedger {
  readonly tickets: Record<WarfareSide, number>;
  private readonly charged = new Set<string>();
  private bleedAcc: Record<WarfareSide, number> = { blue: 0, red: 0 };
  running = false;

  constructor(readonly start: number) {
    this.tickets = { blue: start, red: start };
  }

  /** Charge one ticket for `key` (idempotent). Returns whether it was charged. */
  death(side: WarfareSide, key: string): boolean {
    if (!this.running || this.charged.has(key)) return false;
    this.charged.add(key);
    this.tickets[side] = Math.max(0, this.tickets[side] - 1);
    return true;
  }

  /** Bleed for `dt` seconds given the zones each side holds. Only while running; capped. */
  bleed(held: Record<WarfareSide, number>, dt: number, perZone: number, maxPerSecond: number, minLead = 1): void {
    if (!this.running || dt <= 0) return;
    const diff = held.blue - held.red;
    if (Math.abs(diff) < Math.max(1, minLead)) return;
    const loser: WarfareSide = diff > 0 ? 'red' : 'blue';
    const rate = Math.min(maxPerSecond, Math.abs(diff) * perZone);
    this.bleedAcc[loser] += rate * Math.min(dt, 5);
    const whole = Math.floor(this.bleedAcc[loser] + 1e-9);
    if (whole > 0) {
      this.bleedAcc[loser] -= whole;
      this.tickets[loser] = Math.max(0, this.tickets[loser] - whole);
    }
  }

  canRespawn(side: WarfareSide): boolean {
    return this.tickets[side] > 0;
  }

  /** The losing side if one is out of tickets. */
  loser(): WarfareSide | null {
    if (this.tickets.blue <= 0 && this.tickets.red <= 0) return 'blue';
    if (this.tickets.blue <= 0) return 'blue';
    if (this.tickets.red <= 0) return 'red';
    return null;
  }
}

/** Tickets per second `side` is losing to bleed with these holdings (for the HUD). */
export function bleedRate(held: Record<WarfareSide, number>, side: WarfareSide, cfg: Pick<WarfareConfig, 'bleedPerZone' | 'bleedMaxPerSecond' | 'bleedMinLead'>): number {
  const lead = held[otherSide(side)] - held[side];
  if (lead < Math.max(1, cfg.bleedMinLead)) return 0;
  return Math.min(cfg.bleedMaxPerSecond, lead * cfg.bleedPerZone);
}

/* ------------------------------------------------------------------ zones */

export interface ZoneState {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  owner: WarfareSide | null;
  /** −1 (fully red) … +1 (fully blue). Ownership flips at ±1; 0 is neutral. */
  progress: number;
  contested: boolean;
}

/** Capture logic for all zones. */
export class ZoneCapture {
  readonly zones: ZoneState[];

  constructor(layout: readonly Pick<WarfareZone, 'id' | 'name' | 'x' | 'z' | 'radius' | 'owner'>[]) {
    this.zones = layout.map((z) => ({ id: z.id, name: z.name, x: z.x, z: z.z, radius: z.radius, owner: z.owner, progress: z.owner === 'blue' ? 1 : z.owner === 'red' ? -1 : 0, contested: false }));
  }

  /** Who stands in which zone. */
  presence(units: Iterable<{ side: WarfareSide; x: number; z: number }>): Map<string, Record<WarfareSide, number>> {
    const out = new Map<string, Record<WarfareSide, number>>();
    for (const zn of this.zones) out.set(zn.id, { blue: 0, red: 0 });
    for (const u of units) {
      for (const zn of this.zones) {
        if ((u.x - zn.x) ** 2 + (u.z - zn.z) ** 2 <= zn.radius ** 2) out.get(zn.id)![u.side]++;
      }
    }
    return out;
  }

  /** Advance capture by `dt` s. Returns the zones that changed owner this step. */
  step(presence: Map<string, Record<WarfareSide, number>>, dt: number, captureSeconds: number, bonusPerUnit: number): { zone: ZoneState; from: WarfareSide | null; to: WarfareSide | null }[] {
    const flips: { zone: ZoneState; from: WarfareSide | null; to: WarfareSide | null }[] = [];
    for (const zn of this.zones) {
      const p = presence.get(zn.id) ?? { blue: 0, red: 0 };
      zn.contested = p.blue > 0 && p.red > 0;
      const net = p.blue - p.red;
      if (!net) continue;
      const side: WarfareSide = net > 0 ? 'blue' : 'red';
      const sign = net > 0 ? 1 : -1;
      const mult = Math.min(3, 1 + (Math.abs(net) - 1) * bonusPerUnit);
      const before = zn.owner;
      zn.progress = Math.max(-1, Math.min(1, zn.progress + sign * (dt / captureSeconds) * mult));
      if (zn.owner && zn.owner !== side && Math.sign(zn.progress) !== (zn.owner === 'blue' ? 1 : -1)) zn.owner = null;
      if (Math.abs(zn.progress) >= 1) zn.owner = side;
      if (zn.owner !== before) flips.push({ zone: zn, from: before, to: zn.owner });
    }
    return flips;
  }

  held(): Record<WarfareSide, number> {
    const out = { blue: 0, red: 0 };
    for (const z of this.zones) if (z.owner) out[z.owner]++;
    return out;
  }
}

/* ------------------------------------------------------------------ allocation */

/**
 * How the active-unit budget splits: each side gets half, humans count against their side, bots
 * fill the rest. Humans are never refused (they are capped by the room's player limit instead);
 * bots shrink to keep the total ≤ max.
 */
export function sideCaps(humans: Record<WarfareSide, number>, max: number): Record<WarfareSide, { humans: number; bots: number }> {
  const per = Math.floor(max / 2);
  const out = {} as Record<WarfareSide, { humans: number; bots: number }>;
  let spare = max - per * 2;
  for (const s of WARFARE_SIDES) {
    const h = Math.min(humans[s], per);
    out[s] = { humans: h, bots: per - h };
  }
  // Humans over half the budget borrow from the other side's bots.
  for (const s of WARFARE_SIDES) {
    let over = humans[s] - per;
    if (over <= 0) continue;
    const o = otherSide(s);
    const take = Math.min(over, out[o].bots + spare);
    const fromSpare = Math.min(take, spare);
    spare -= fromSpare;
    out[o].bots -= take - fromSpare;
    out[s].humans += take;
    over -= take;
  }
  return out;
}

/** Side for a joining human: the one with fewer humans (blue on a tie). */
export function pickSide(humans: Record<WarfareSide, number>): WarfareSide {
  return humans.red < humans.blue ? 'red' : 'blue';
}

/**
 * Respawn bookkeeping: one pending entry per unit, released no earlier than its time, only while
 * its side has tickets and the active cap has room.
 */
export class RespawnQueue<K = number> {
  private readonly pending = new Map<K, { side: WarfareSide; at: number }>();

  get size(): number {
    return this.pending.size;
  }

  has(id: K): boolean {
    return this.pending.has(id);
  }

  /** Queue `id` (a second call for a queued id is ignored). */
  add(id: K, side: WarfareSide, at: number): boolean {
    if (this.pending.has(id)) return false;
    this.pending.set(id, { side, at });
    return true;
  }

  remove(id: K): void {
    this.pending.delete(id);
  }

  readyAt(id: K): number | undefined {
    return this.pending.get(id)?.at;
  }

  /** Pop the entries that may respawn now, oldest first, within `room` free slots. */
  release(now: number, room: number, hasTickets: (s: WarfareSide) => boolean, filter: (id: K) => boolean = () => true): { id: K; side: WarfareSide }[] {
    const out: { id: K; side: WarfareSide }[] = [];
    const due = [...this.pending].filter(([id, e]) => e.at <= now && filter(id)).sort((a, b) => a[1].at - b[1].at);
    for (const [id, e] of due) {
      if (out.length >= room) break;
      if (!hasTickets(e.side)) continue;
      this.pending.delete(id);
      out.push({ id, side: e.side });
    }
    return out;
  }
}

/** Respawn timing: never instant, never sooner than the configured delay. */
export function respawnAt(diedAt: number, cfg: Pick<WarfareConfig, 'respawnSeconds'>): number {
  return diedAt + Math.max(1, cfg.respawnSeconds) * 1000;
}

/* ------------------------------------------------------------------ squads & orders */

export type WarfareOrderKind = 'follow' | 'hold' | 'move' | 'attack' | 'defend' | 'regroup';
export const WARFARE_ORDERS: readonly WarfareOrderKind[] = ['follow', 'hold', 'move', 'attack', 'defend', 'regroup'];
export const warfareOrderSchema = z.object({
  kind: z.enum(['follow', 'hold', 'move', 'attack', 'defend', 'regroup']),
  x: z.number().finite().min(-100_000).max(100_000).optional(),
  z: z.number().finite().min(-100_000).max(100_000).optional(),
  zone: z.string().max(24).optional(),
}).strict();
export type WarfareOrder = z.infer<typeof warfareOrderSchema>;

export type WarfareEmote = 'point' | 'wave' | 'salute' | 'halt';
export const WARFARE_EMOTES: readonly WarfareEmote[] = ['point', 'wave', 'salute', 'halt'];

/**
 * What an emote means to nearby recruited bots:
 * - point → move to (or attack, if an enemy is near it) where the player aims
 * - wave → follow me / regroup on me
 * - halt → hold position
 * - salute → acknowledgement only (no behaviour change)
 */
export function emoteOrder(emote: WarfareEmote, aim: { x: number; z: number } | null, enemyNearAim: boolean): WarfareOrder | null {
  switch (emote) {
    case 'point':
      return aim ? { kind: enemyNearAim ? 'attack' : 'move', x: aim.x, z: aim.z } : null;
    case 'wave':
      return { kind: 'regroup' };
    case 'halt':
      return { kind: 'hold' };
    default:
      return null;
  }
}

/** Slot offsets (m, in the leader's frame: x right, z back) for a wedge formation. */
export function formationSlot(index: number): { x: number; z: number } {
  const row = Math.floor(index / 2) + 1;
  const side = index % 2 === 0 ? -1 : 1;
  return { x: side * row * 2.4, z: row * 2.2 };
}

/** Player squads: up to `size` humans, the first member leads. */
export class SquadBook {
  private nextId = 1;
  readonly squads = new Map<number, { id: number; side: WarfareSide; members: number[] }>();
  private readonly of = new Map<number, number>();

  constructor(readonly size: number) {}

  squadOf(player: number): { id: number; side: WarfareSide; members: number[] } | undefined {
    const id = this.of.get(player);
    return id === undefined ? undefined : this.squads.get(id);
  }

  create(player: number, side: WarfareSide): number {
    this.leave(player);
    const id = this.nextId++;
    this.squads.set(id, { id, side, members: [player] });
    this.of.set(player, id);
    return id;
  }

  /** Join squad `id` (same side, room left). */
  join(player: number, side: WarfareSide, id: number): boolean {
    const sq = this.squads.get(id);
    if (!sq || sq.side !== side || sq.members.length >= this.size || sq.members.includes(player)) return false;
    this.leave(player);
    sq.members.push(player);
    this.of.set(player, id);
    return true;
  }

  leave(player: number): void {
    const id = this.of.get(player);
    if (id === undefined) return;
    this.of.delete(player);
    const sq = this.squads.get(id);
    if (!sq) return;
    sq.members = sq.members.filter((m) => m !== player);
    if (!sq.members.length) this.squads.delete(id);
  }

  leader(player: number): number | undefined {
    return this.squadOf(player)?.members[0];
  }
}

/** Pick up to `room` recruitable bots nearest to the player (same side, alive, idle). */
export function pickRecruits<T extends { id: number; x: number; z: number }>(from: { x: number; z: number }, candidates: readonly T[], radius: number, room: number): T[] {
  if (room <= 0) return [];
  return candidates
    .map((c) => ({ c, d: (c.x - from.x) ** 2 + (c.z - from.z) ** 2 }))
    .filter((e) => e.d <= radius * radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, room)
    .map((e) => e.c);
}

/* ------------------------------------------------------------------ loadouts */

export type WarfareClass = 'assault' | 'medic' | 'engineer' | 'support' | 'recon';
export const WARFARE_CLASSES: readonly WarfareClass[] = ['assault', 'medic', 'engineer', 'support', 'recon'];

/**
 * What each class may carry. Everything is a real item of the game's inventory; it is placed with
 * the inventory's own grid rules (`canPlace`), so a loadout can never hold more than fits.
 * - `primary`: the main gun (rifles and shotguns go in the primary slot, machine guns and the
 *   Barrett in the heavy slot, SMGs in the secondary slot);
 * - `secondary`: a sidearm (only when the main gun leaves the secondary slot free);
 * - `heavy`: a launcher in the heavy slot (engineers);
 * - `gadgets`: grenades and charges, at most `maxGadgets`, in the grenade belt.
 */
export interface WarfareKit {
  id: WarfareClass;
  name: string;
  role: string;
  primary: readonly string[];
  secondary: readonly string[];
  heavy: readonly string[];
  gadgets: readonly string[];
  maxGadgets: number;
  head: string;
  chest: string;
  ears?: string;
  /** Medkits carried. */
  medkits: number;
  /** Magazines of ammunition for each gun. */
  mags: { primary: number; secondary: number; heavy: number };
}

export const WARFARE_KITS: Record<WarfareClass, WarfareKit> = {
  assault: { id: 'assault', name: 'Xung kích', role: 'Súng trường tấn công, lựu đạn, giáp vừa', primary: ['ak47', 'm4a1', 'scar_l', 'aug', 'm16', 'beryl', 'm762', 'scar_h'], secondary: ['gl18', 'deagle', 'revolver'], heavy: [], gadgets: ['grenade', 'smoke_grenade', 'flashbang'], maxGadgets: 3, head: 'helmet_t1', chest: 'vest_t1', medkits: 1, mags: { primary: 4, secondary: 2, heavy: 0 } },
  medic: { id: 'medic', name: 'Cứu thương', role: 'Tiểu liên, nhiều hộp cứu thương, khói che', primary: ['mp5', 'vector', 'uzi', 'p90', 'mini14'], secondary: ['gl18'], heavy: [], gadgets: ['smoke_grenade', 'flashbang'], maxGadgets: 3, head: 'helmet_t1', chest: 'vest_t1', medkits: 4, mags: { primary: 4, secondary: 2, heavy: 0 } },
  engineer: { id: 'engineer', name: 'Công binh', role: 'Shotgun, súng chống xe, C4', primary: ['shotgun', 'saiga12', 'double_barrel'], secondary: ['gl18', 'uzi'], heavy: ['rocket_launcher', 'grenade_launcher', 'm79'], gadgets: ['c4', 'grenade'], maxGadgets: 2, head: 'helmet_t1', chest: 'vest_t2', medkits: 1, mags: { primary: 3, secondary: 2, heavy: 3 } },
  support: { id: 'support', name: 'Hỏa lực', role: 'Súng máy, giáp nặng, yểm trợ', primary: ['pkm'], secondary: ['gl18', 'deagle', 'uzi'], heavy: [], gadgets: ['grenade', 'smoke_grenade'], maxGadgets: 2, head: 'helmet_t2', chest: 'vest_plate', medkits: 1, mags: { primary: 3, secondary: 2, heavy: 0 } },
  recon: { id: 'recon', name: 'Trinh sát', role: 'Súng bắn tỉa, tai nghe, nhẹ', primary: ['svd', 'awm', 'kar98k', 'remington700', 'barrett'], secondary: ['uzi', 'gl18', 'vector'], heavy: [], gadgets: ['smoke_grenade', 'flashbang'], maxGadgets: 2, head: 'helmet_t1', chest: 'vest_t1', ears: 'headset_comms', medkits: 1, mags: { primary: 4, secondary: 2, heavy: 0 } },
};

export const isWarfareClass = (v: unknown): v is WarfareClass => typeof v === 'string' && (WARFARE_CLASSES as readonly string[]).includes(v);

const itemIdSchema = z.string().regex(/^[a-z0-9_]{1,40}$/);
/** A player's picks inside a class (each checked against the class's lists). */
export const warfareLoadoutSchema = z.object({
  primary: itemIdSchema.optional(),
  secondary: itemIdSchema.nullable().optional(),
  heavy: itemIdSchema.nullable().optional(),
  gadgets: z.array(itemIdSchema).max(4).optional(),
}).strict();
export type WarfareLoadout = z.infer<typeof warfareLoadoutSchema>;
export interface WarfareLoadoutChoice { primary: string; secondary: string | null; heavy: string | null; gadgets: string[] }

/** A valid choice for `cls`: anything not on the class's lists falls back to the class default. */
export function sanitizeWarfareLoadout(cls: WarfareClass, pick: WarfareLoadout | undefined): WarfareLoadoutChoice {
  const k = WARFARE_KITS[cls] ?? WARFARE_KITS.assault;
  const primary = pick?.primary && k.primary.includes(pick.primary) ? pick.primary : k.primary[0]!;
  const cat = ITEMS[primary]?.category;
  const usesSecondary = cat === 'smg' || cat === 'pistol';
  const secondary = usesSecondary || pick?.secondary === null ? null : pick?.secondary && k.secondary.includes(pick.secondary) ? pick.secondary : k.secondary[0] ?? null;
  const heavy = !k.heavy.length || pick?.heavy === null ? null : pick?.heavy && k.heavy.includes(pick.heavy) ? pick.heavy : k.heavy[0]!;
  const gadgets = (pick?.gadgets ?? k.gadgets.slice(0, k.maxGadgets)).filter((g) => k.gadgets.includes(g)).slice(0, k.maxGadgets);
  return { primary, secondary, heavy, gadgets };
}

/** Where a gun goes on the body. */
function gunSlot(itemId: string, taken: ReadonlySet<ContainerId>): ContainerId | null {
  const cat = ITEMS[itemId]?.category;
  if (cat === 'heavy') return taken.has('heavy') ? null : 'heavy';
  if (cat === 'rifle' || cat === 'shotgun') return !taken.has('primary') ? 'primary' : !taken.has('heavy') ? 'heavy' : null;
  if (cat === 'smg' || cat === 'pistol') return taken.has('secondary') ? null : 'secondary';
  return null;
}

/**
 * The full inventory for a class and the player's picks. Items go where the inventory grid takes
 * them; anything that does not fit is left out (never an over-full or invented inventory).
 */
export function warfareInventory(cls: WarfareClass, pick?: WarfareLoadout): InventoryData {
  const k = WARFARE_KITS[cls] ?? WARFARE_KITS.assault;
  const choice = sanitizeWarfareLoadout(k.id, pick);
  const items: PlacedItem[] = [];
  const put = (itemId: string, container: ContainerId, count?: number): PlacedItem | null => {
    const def = ITEMS[itemId];
    if (!def) return null;
    const c = CONTAINERS[container];
    for (let y = 0; y < c.rows; y++) for (let x = 0; x < c.cols; x++) for (const rotated of c.rotatable ? [false, true] : [false]) {
      if (!canPlace(items, container, itemId, x, y, rotated)) continue;
      const item: PlacedItem = { uid: items.length + 1, itemId, container, x, y, rotated, issued: true };
      const max = maxCount(def);
      if (max) item.count = Math.min(max, count ?? max);
      const mag = magazineOf(itemId);
      if (mag !== undefined) item.mag = mag;
      items.push(item);
      return item;
    }
    return null;
  };
  const taken = new Set<ContainerId>();
  const guns: { id: string; mags: number }[] = [];
  for (const [id, mags] of [[choice.primary, k.mags.primary], [choice.heavy, k.mags.heavy], [choice.secondary, k.mags.secondary]] as const) {
    if (!id) continue;
    const slot = gunSlot(id, taken);
    if (!slot || !put(id, slot)) continue;
    taken.add(slot);
    guns.push({ id, mags });
  }
  put(k.head, 'armor_head'); put(k.chest, 'armor_chest');
  if (k.ears) put(k.ears, 'armor_ears');
  for (const g of choice.gadgets) put(g, 'grenades');
  // Ammunition: whole magazines' worth for each gun, in boxes, then the medkits.
  for (const g of guns) {
    const ammo = ammoItemFor(g.id), def = ammo ? ITEMS[ammo] : undefined;
    if (!ammo || !def) continue;
    const per = maxCount(def) ?? 1;
    let rounds = (magazineOf(g.id) ?? 1) * g.mags;
    while (rounds > 0) { const n = Math.min(per, rounds); if (!put(ammo, 'backpack', n)) break; rounds -= n; }
  }
  for (let i = 0; i < k.medkits; i++) put('medkit', 'backpack');
  const first = items.find((i) => i.container === 'primary' || i.container === 'heavy') ?? items.find((i) => i.container === 'secondary');
  return { items, equipped: first?.uid ?? null };
}

/** A bot's class, deterministic from its id so a side gets a mix. */
export function botWarfareClass(id: number): WarfareClass {
  const mix: WarfareClass[] = ['assault', 'assault', 'medic', 'support', 'assault', 'engineer', 'recon', 'assault'];
  return mix[Math.abs(id) % mix.length]!;
}

/* ------------------------------------------------------------------ vehicles */

export type VehicleSlotState = 'available' | 'spawned' | 'active' | 'damaged' | 'destroyed' | 'wreck' | 'cleanup' | 'cooldown';

/**
 * One vehicle spawn slot's lifecycle:
 * available → spawned → active ⇄ damaged → destroyed → wreck → cleanup → cooldown → available.
 * The slot is locked (cannot spawn) from `spawned` until its cooldown ends, so a replacement only
 * ever appears after the previous wreck was cleaned up — never two vehicles from one slot.
 */
export class VehicleSlot {
  state: VehicleSlotState = 'available';
  vehicleId: number | null = null;
  private until = 0;
  private lastUsed = 0;

  constructor(readonly index: number, readonly spawn: WarfareVehicleSpawn) {}

  get locked(): boolean {
    return this.state !== 'available';
  }

  /** Bind a freshly spawned vehicle (only from `available`). */
  spawned(vehicleId: number, now: number): boolean {
    if (this.state !== 'available') return false;
    this.state = 'spawned';
    this.vehicleId = vehicleId;
    this.lastUsed = now;
    return true;
  }

  /** Someone is driving / riding it. */
  used(now: number): void {
    this.lastUsed = now;
    if (this.state === 'spawned') this.state = 'active';
  }

  damaged(health: number, maxHealth: number): void {
    if ((this.state === 'active' || this.state === 'spawned') && health < maxHealth * .5) this.state = 'damaged';
  }

  /** The vehicle blew up: it stays as a wreck for `wreckSeconds`. */
  destroyed(now: number, wreckSeconds: number): boolean {
    if (this.state === 'available' || this.state === 'destroyed' || this.state === 'wreck' || this.state === 'cleanup' || this.state === 'cooldown') return false;
    this.state = 'wreck';
    this.until = now + wreckSeconds * 1000;
    return true;
  }

  /**
   * Advance timers. Returns `'cleanup'` when the caller must remove the vehicle entity now (wreck
   * expired, or abandoned too long), `'ready'` when the slot can spawn again.
   */
  tick(now: number, cfg: WarfareConfig['vehicles'], occupied: boolean): 'cleanup' | 'ready' | null {
    if (occupied) this.used(now);
    if (this.state === 'wreck' && now >= this.until) {
      this.state = 'cleanup';
      return 'cleanup';
    }
    if ((this.state === 'spawned' || this.state === 'active' || this.state === 'damaged') && !occupied && now - this.lastUsed > cfg.abandonSeconds * 1000) {
      this.state = 'cleanup';
      return 'cleanup';
    }
    if (this.state === 'cooldown' && now >= this.until) {
      this.state = 'available';
      return 'ready';
    }
    return null;
  }

  /** The caller removed the entity: start the cooldown before a replacement. */
  cleaned(now: number, cooldownSeconds: number): void {
    if (this.state !== 'cleanup') return;
    this.state = 'cooldown';
    this.vehicleId = null;
    this.until = now + cooldownSeconds * 1000;
  }
}

/* ------------------------------------------------------------------ wire */

export type WarfarePhase = 'lobby' | 'countdown' | 'fighting' | 'over';

export interface WarfareUnitInfo {
  id: number;
  name: string;
  side: WarfareSide;
  bot: boolean;
  alive: boolean;
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  cls: WarfareClass;
  /** Player squad id (humans), or the AI squad id prefixed `ai` (bots). */
  squad?: number;
  /** The player this bot follows (recruited with G). */
  leader?: number;
  /** World position and heading (allies only; enemies are not sent). */
  x?: number;
  z?: number;
  yaw?: number;
  /** Leads others (an AI squad's leader, or a player): drawn on the map with a heading arrow. */
  lead?: boolean;
}

/** A deploy point the receiving player may pick (a held zone or the main base). */
export interface WarfareDeployPoint { id: string; name: string; x: number; z: number; safe: boolean; kind: 'base' | 'zone' | 'squad' }

/** Server → client: the Warfare scoreboard and match state (sent ~1/s and on changes). */
export interface WarfareStateMessage {
  t: 'warfare';
  map: { id: string; name: string };
  phase: WarfarePhase;
  endsAt: number;
  msLeft: number;
  you: {
    side: WarfareSide;
    cls: WarfareClass;
    squad: number | null;
    /** Bots following you (ids) and their standing order. */
    followers: number[];
    order: WarfareOrderKind | null;
    /** ms until you may deploy (0 = now), null while alive on the field. */
    respawnIn: number | null;
    /** Your chosen deploy point (null = automatic) and whether you asked to deploy. */
    spawn: string | null;
    ready: boolean;
    /** Why you are still waiting (no tickets, field full, no safe point). */
    waiting?: string;
  } | null;
  tickets: Record<WarfareSide, number>;
  startTickets: number;
  /** Tickets lost per second right now (bleed), per side. */
  bleed: Record<WarfareSide, number>;
  zones: { id: string; name: string; x: number; z: number; radius: number; owner: WarfareSide | null; progress: number; contested: boolean; presence: Record<WarfareSide, number> }[];
  bases: Record<WarfareSide, { x: number; z: number }>;
  /** Where the receiving player may deploy. */
  deploy: WarfareDeployPoint[];
  active: number;
  maxActive: number;
  /** Units waiting to deploy (dead, queued). */
  queued: number;
  units: WarfareUnitInfo[];
  squads: { id: number; side: WarfareSide; members: number[] }[];
  /** What each of your side's AI squads is doing (for the tactical map). */
  tasks: { squad: number; kind: 'attack' | 'defend' | 'scout' | 'reinforce'; zone: string; size: number }[];
  /**
   * Vehicles on the map: crewed by your side, by the enemy (only when one of yours sees it), or
   * empty (`crew` null). Wrecks are left out.
   */
  vehicles: { id: number; kind: string; crew: WarfareSide | null; x: number; z: number; yaw: number; air: boolean }[];
  result?: { winner: WarfareSide; reason: 'tickets' | 'time' | 'forfeit' | 'objectives'; ticketsUsed: Record<WarfareSide, number>; captures: Record<WarfareSide, number> };
}

/** Server → nearby clients: someone made a hand signal (played on their avatar). */
export interface WarfareGestureMessage { t: 'wfGesture'; id: number; kind: WarfareEmote; yaw: number }

export const WARFARE_MAX_ROOMS = 12;
