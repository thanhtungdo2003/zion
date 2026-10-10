import { SharedChests } from './chests';
import { CHEST_ASSETS, CHEST_REACH, chestKey } from '@zion/shared';
import { Livestock } from './livestock';
import { BaseLife, type AnimalRecord, type LifeWorld } from './base-life';
import { DEFAULT_BASE_LIFE, planCooking, gunBlocksSprint, type CookingBatch } from '@zion/shared';
import { DEFAULT_CONTENT, InventoryModel, isStash, NPC_ID_BASE, objectiveText, type GameContent } from '@zion/shared';
import { QuestEngine, type QuestEvent } from './quests';
import {
  Buttons,
  CHUNK_SIZE,
  Surface,
  ENTITY_INTEREST_RADIUS_CHUNKS,
  FIRE_TOLERANCE_MS,
  GRENADE_GRAVITY,
  throwSpeed,
  lobSpeed,
  weaponSpec,
  buyPrice,
  sellPrice,
  MERCHANT_REACH,
  MERCHANT_ID,
  NURSE_ID,
  NURSE_HEAL_PRICE,
  vendorOf,
  STARTING_ZCOIN,
  ZOMBIE_COIN_DROP_CHANCE,
  COIN_DROP_LIFETIME_MS,
  COIN_PICKUP_REACH,
  ZOMBIE_COIN_DROP_MIN,
  ITEMS,
  WEAPON_BY_ITEM,
  CAMP_CACHE_STOCK,
  CACHE_DRAWS_PER_DAY,
  defaultLoadout,
  maxCount,
  armorProtection,
  armorSpeedFactor,
  packArmor,
  MEDKIT_USE_MS,
  DEV_COIN_GRANT,
  ZOMBIE_COIN_DROP_MAX,
  type GunSpec,
  type MeleeSpec,
  type ProjectileSpec,
  MUZZLE_HEIGHT,
  WEAPON_SPECS,
  WeaponId,
  EntityFlags,
  EntityKind,
  PLAYER_MAX_HEALTH,
  RESPAWN_DELAY_MS,
  SNAPSHOT_INTERVAL_TICKS,
  TICK_DT,
  TICK_RATE,
  encodeSnapshot,
  type ClientMessage,
  type EntityState,
  type InputMessage,
  type InvMessage,
  propTransform,
  type ServerJsonMessage,
  type WorldInfo,
  isZombieId,
} from '@zion/shared';
import {
  CharacterController,
  CollisionWorld,
  DEFAULT_CHARACTER,
  Mask,
  ZONE_DAMAGE_MULTIPLIER,
  makeRayHit,
  stepProjectile,
  type ProjectileState,
  type StepInfo,
} from '@zion/physics';
import { CAMP_ASSET, type AssetRegistry } from '@zion/assets';
import type { AppConfig } from '../config';
import type { Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { AuditLog } from '../repositories/audit';
import type { PlayerStateRepository } from '../repositories/player-states';
import type { WorldRepository } from '../repositories/worlds';
import type { WorldService } from '../world/world-service';
import { sanitizeChat, type SuspicionKind } from './anticheat';
import { ChunkStreamer } from './chunk-streamer';
import { MELEE, aimDirection, castCombatRay, resolveBladeSweep, resolveMelee, spreadDirection, type Combatant } from './combat';
import { touchesBarbedWire, WIRE_DAMAGE, WIRE_INTERVAL_MS } from './hazards';
import { Zombie, ZombieDirector } from './zombies';
import { CampGuardDirector } from './camp-guards';
import { CampNpc } from './merchant';
import { NPC_STALLS, STRUCTURE_KINDS, allStructures, type CampNpcLayout, type CampPart, type StructureKind } from '@zion/worldgen';
import { GUARD_POSTS } from './camp-guards';
import { CAMP_HALF_SIZE } from '@zion/worldgen';
import { InterestGrid } from './interest';
import { PhysicsChunkManager } from './physics-manager';
import { Player } from './player';
import { CloseCode, type ClientSession } from './session';
import { SpawnService, type ValidatedPosition } from './spawn';
import { VegetationDamage } from './vegetation';

const TICK_MS = 1000 / TICK_RATE;
/** Dropped items vanish after this long; pick-up reach; ammo cache reach. */
const GROUND_ITEM_LIFETIME_MS = 60_000;
const GROUND_PICKUP_REACH = 2.6;
const STATION_REACH = 4.2;
/** Reviving a downed player: how far apart (server positions) the two may be. */
const REVIVE_REACH = 3.2;
/** Melee wind-up: blades land as the slash trail appears; fists a little sooner. */
const BLADE_HIT_DELAY_MS = 200;
const FIST_HIT_DELAY_MS = 150;
const MAX_INPUTS_PER_TICK = 3;
const MAX_QUEUED_INPUTS = 16;
/** Ticks without input before the server simulates a neutral (gravity-only) step. */
const STARVE_TICKS = 4;
const PERSIST_INTERVAL_MS = 30_000;
const PHYSICS_UPDATE_TICKS = 10;
const STUCK_TICKS_LIMIT = 45;
const MAX_PLAYERS = 256;
/** Largest horizontal displacement one controller step can legitimately produce. */
const MAX_STEP_DISTANCE = DEFAULT_CHARACTER.sprintSpeed * TICK_DT * 3 + 0.5;

export interface GameServerDeps {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  audit: AuditLog;
  world: WorldService;
  registry: AssetRegistry;
  playerStates: PlayerStateRepository;
  worlds: WorldRepository;
  worldId: string;
  initialWorldTimeMs: number;
}

/**
 * Authoritative simulation. Runs a fixed 30 Hz tick: consumes validated client inputs under a
 * real-time budget, integrates movement with the shared character controller against the server
 * collision world, resolves combat, streams chunks and sends interest-filtered snapshots.
 */
export class GameServer {
  private readonly vegetation: VegetationDamage;
  private readonly vegetationView = new WeakMap<Player, { cx: number; cz: number; revisions: Map<number, number> }>();
  lifeWorld: LifeWorld = { plots: {}, nextGrowth: 0 };
  private life = new BaseLife(DEFAULT_BASE_LIFE);
  private lifeBusy = false;
  private readonly chests: SharedChests;
  private animals = new Map<string, Livestock>();
  private plotLocks = new Map<string, number>();
  content: GameContent = structuredClone(DEFAULT_CONTENT);
  private quests = new QuestEngine(this.content);
  private readonly questNpcs = new Map<string, CampNpc>();
  private readonly npcFireAt = new Map<string, number>();
  private readonly npcRounds: Array<{ id: number; source: number; s: ProjectileState; damage: number; radius: number; gravity: number; kind: 'grenade40' | 'rocket'; expires: number }> = [];
  private readonly speechAt = new Map<string, number>();
  readonly collision: CollisionWorld;
  readonly controller: CharacterController;
  readonly physics: PhysicsChunkManager;
  readonly spawns: SpawnService;
  private readonly players = new Map<number, Player>();
  private readonly byAccount = new Map<string, Player>();
  private readonly grid = new InterestGrid<Player>();
  private readonly joining = new Map<number, [number, number]>();
  private readonly respawning = new Set<number>();
  private readonly log: Logger;
  private readonly epoch = performance.now();
  private readonly stepInfo: StepInfo = { frozen: false, hitWall: false, jumped: false, steppedUp: false, reverted: false };
  private readonly scratch: Player[] = [];
  private readonly grenades: Array<{ id: number; ownerId: number; s: ProjectileState; explodeAt: number }> = [];
  private nextGrenadeId = 1;
  readonly zombies: ZombieDirector;
  readonly guards: CampGuardDirector;
  readonly merchant: CampNpc;
  readonly nurse: CampNpc;
  /** Launcher rounds in flight (40 mm grenades, rockets, bolts). */
  private readonly rounds: Array<{ id: number; owner: Player; w: number; spec: ProjectileSpec; damage: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; dieAt: number }> = [];
  private readonly activeScratch: Player[] = [];
  private readonly blastHit = makeRayHit();
  /** ZCoin lying on the ground, waiting to be picked up. */
  /** Items players dropped on the ground (visible to everyone, pick-up by anyone). */
  private readonly groundItems = new Map<number, { itemId: string; count?: number; mag?: number; issued?: boolean; x: number; y: number; z: number; expiresAt: number; livestock?: boolean; quest?: string }>();
  private nextGroundId = 1;
  private readonly coinDrops = new Map<number, { x: number; y: number; z: number; amount: number; expiresAt: number }>();
  private nextCoinId = 1;
  private nextEntityId = 1;
  private tick = 0;
  private worldTimeMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastLoop = 0;
  private accumulator = 0;
  private lastPersist = Date.now();
  private persisting: Promise<void> | null = null;

  constructor(private readonly deps: GameServerDeps) {
    this.chests = new SharedChests({
      near: (p, id) => this.chestNear(p, id),
      load: (id) => deps.playerStates.loadChest(id),
      commit: (id, data, p, inventory) => deps.playerStates.saveChestAndPlayer(id, data, p ? { accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory, journal: structuredClone(p.journal), life: structuredClone(p.life) } : undefined),
      sync: (p) => { p.reloadAt = 0; this.syncLoadout(p); this.sendInv(p); },
      finish: (p) => this.finishQuestMutation(p),
      error: (err) => this.log.error({ err }, 'shared chest transaction failed'),
    }, () => this.serverTime, () => Math.floor(this.worldTimeMs / this.dayLengthMs));
    this.log = deps.logger.child({ module: 'game' });
    const gen = deps.world.generator;
    this.collision = new CollisionWorld({ worldSize: gen.worldSize, seaLevel: gen.seaLevel });
    this.vegetation = new VegetationDamage({
      ground: (x, z) => {
        const y = this.collision.terrainHeight(x, z);
        if (!Number.isFinite(y) || y < this.collision.waterLevel(x, z) + 0.15) return NaN;
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const chunk = deps.world.peek(cx, cz, 0)?.data ?? deps.world.peek(cx, cz, 1)?.data;
        if (chunk) {
          const step = 1 << chunk.lod;
          const i = Math.min(chunk.verts - 1, Math.round((x - cx * CHUNK_SIZE) / step));
          const j = Math.min(chunk.verts - 1, Math.round((z - cz * CHUNK_SIZE) / step));
          const surface = chunk.surface[j * chunk.verts + i];
          if (surface === Surface.Snow || surface === Surface.Rock || surface === Surface.Sandstone || surface === Surface.Seabed) return NaN;
        }
        return y;
      },
      visible: (ox, oy, oz, x, y, z) => {
        const d = Math.hypot(x - ox, y - oy, z - oz);
        return d < 0.05 || !this.collision.raycast(ox, oy, oz, (x - ox) / d, (y - oy) / d, (z - oz) / d,
          Math.max(0, d - 0.1), Mask.LineOfSight, this.blastHit);
      },
    });
    this.controller = new CharacterController(this.collision);
    this.physics = new PhysicsChunkManager(deps.world, this.collision, deps.registry, this.log);
    this.spawns = new SpawnService(gen, this.collision, this.controller, this.physics);
    this.zombies = new ZombieDirector(this.collision, this.spawns, {
      attackPlayer: (z, p, dmg, now) => this.damage(z.id, p, dmg, 'bite', p.state.x, p.state.y + 1.2, p.state.z, now),
    });
    this.guards = new CampGuardDirector(gen.camp, this.collision, {
      shot: (message) => this.broadcastAt(message.ox, message.oz, message),
      hit: (guard, zombie, damage, zone, x, y, z, dx, dz, now) =>
        this.hitZombie(null, zombie, damage, zone, x, y, z, dx, dz, 1.2, now, guard.id),
    });
    this.merchant = new CampNpc(MERCHANT_ID, EntityKind.Merchant, gen.camp, NPC_STALLS.merchant, this.collision);
    this.nurse = new CampNpc(NURSE_ID, EntityKind.Nurse, gen.camp, NPC_STALLS.nurse, this.collision);
    this.worldTimeMs = deps.initialWorldTimeMs;
    this.applyContent(this.content);
  }

  applyContent(content: GameContent): void {
    this.content = structuredClone(content);
    // Add the chef's new stock to worlds with an older saved Camp Studio catalogue.
    if (this.content.baseLife && this.content.npcs.some((n) => n.id === 'chef') &&
        !this.content.baseLife.trades.some((t) => t.npc === 'chef' && t.item === 'coal_carton')) {
      this.content.baseLife.trades.push(structuredClone(DEFAULT_BASE_LIFE.trades.find((t) => t.id === 'chef_coal_carton')!));
    }
    this.life = new BaseLife(this.content.baseLife ?? DEFAULT_BASE_LIFE);
    this.configureAnimals();
    this.quests = new QuestEngine(this.content);
    this.questNpcs.clear();
    this.content.npcs.forEach((n, i) => this.questNpcs.set(n.id, new CampNpc(0xf0000200 + i, EntityKind.QuestNpc, this.deps.world.generator.camp, n, this.collision, { weapon: n.weapon, patrol: n.patrolRadius })));
    for (const p of this.players.values()) this.sendQuests(p);
  }

  private resolveQuestLocations(p: Player): void {
    for (const q of this.content.quests) {
      const r = p.journal[q.id];
      const o = q.objectives[r?.stage ?? -1];
      if (!r || r.status !== 'active' || r.location || (o?.type !== 'visit' && o?.type !== 'retrieve')) continue;
      const configured = this.life.config.locations?.find((l) => l.id === o.location);
      if (configured) { r.location = { x: configured.x, z: configured.z, radius: configured.radius }; continue; }
      const camp = this.deps.world.generator.camp;
      let best = Infinity;
      for (const loc of allStructures(this.deps.world.generator)) {
        if (loc.kind !== o.structure || (camp && Math.hypot(loc.x - camp.x, loc.z - camp.z) < CAMP_HALF_SIZE + loc.radius)) continue;
        const d = Math.hypot(loc.x - p.state.x, loc.z - p.state.z);
        if (d < best) { best = d; r.location = { x: loc.x, z: loc.z, radius: loc.radius }; }
      }
    }
  }

  /** Scatters this player's missing quest items at random spots inside the quest area. */
  private placeQuestDrops(p: Player): void {
    for (const q of this.content.quests) {
      const r = p.journal[q.id];
      if (!r?.location || r.drops?.length) continue;
      const n = this.quests.missingDrops(p, q.id);
      if (!n) continue;
      const { x, z, radius } = r.location;
      r.drops = Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * Math.max(2, radius * 0.6);
        return { x: +(x + Math.cos(a) * d).toFixed(2), z: +(z + Math.sin(a) * d).toFixed(2) };
      });
      p.dirty = true;
    }
  }

  async resetPlayerProgress(accountId?: string): Promise<void> {
    const players = [...this.players.values()].filter((p) => !accountId || p.accountId === accountId);
    if (players.some((p) => p.questBusy)) throw new Error('Player transaction in progress; retry shortly');
    for (const p of players) p.questBusy = true;
    try {
      await this.deps.playerStates.resetQuestJournals(accountId);
      for (const p of players) { p.journal = {}; p.questEvents = []; this.sendQuests(p); }
    } finally { for (const p of players) p.questBusy = false; }
  }

  private sendQuests(p: Player): void {
    this.quests.reset(p, Date.now());
    this.resolveQuestLocations(p);
    this.placeQuestDrops(p);
    p.session.sendJson({ t: 'questNpcs', npcs: this.content.npcs.map((n) => {
      const entity = this.questNpcs.get(n.id)!;
      return { id: entity.id, key: n.id, name: n.name, model: n.model, x: entity.x, y: entity.y, z: entity.z };
    }) });
    p.session.sendJson({ t: 'quests', entries: this.content.quests.filter((q) => q.enabled).map((q) => {
      const r = p.journal[q.id];
      const o = q.objectives[r?.stage ?? 0];
      return { id: q.id, npc: q.npc, title: q.title, description: q.description, kind: q.kind, dialogue: q.dialogue, rewards: q.rewards, allowCancel: q.allowCancel !== false, locked: q.prereq.some((id) => p.journal[id]?.status !== 'claimed'), stage: r?.stage ?? 0, stages: q.objectives.length, goal: o && 'count' in o ? o.count : 1, objective: o ? objectiveText(o) : '', status: r?.status ?? 'available', progress: r?.progress ?? 0, ...(r?.status === 'active' && o?.type === 'retrieve' ? { retrievalItem: o.item, retrievalModel: this.life.config.itemModels?.[o.item] } : {}), ...(r?.location ? { target: r.location } : {}), ...(r?.status === 'active' && r.drops?.length ? { drops: r.drops } : {}) };
    }) });
  }

  private async onQuest(p: Player, msg: Extract<ClientMessage, { t: 'quest' }>): Promise<void> {
    if (p.dead || p.questBusy) return;
    if (msg.op === 'list') { this.sendQuests(p); return; }
    const def = this.content.quests.find((q) => q.id === msg.quest && q.npc === msg.npc);
    const npc = this.content.npcs.find((n) => n.id === msg.npc);
    const camp = this.deps.world.generator.camp;
    if (!def || !npc || !camp) return;
    const entity = this.questNpcs.get(npc.id);
    // Cancelling works from anywhere (quest tracker); accepting / handing in needs the NPC.
    if (msg.op !== 'retrieve' && msg.op !== 'cancel' && (!entity?.inReach(p, npc.interactRange) || Math.abs(p.state.y - entity.y) > 4)) return;
    if (msg.op === 'retrieve' && Math.abs(p.state.y - this.deps.world.generator.heightAt(p.state.x, p.state.z)) > 3) return;
    const copy = { journal: structuredClone(p.journal), coins: p.coins, inv: new InventoryModel(p.inv.toJSON()) };
    const now = Date.now();
    const changed = msg.op === 'accept' ? this.quests.accept(copy, def.id, now)
      : msg.op === 'cancel' ? this.quests.cancel(copy, def.id)
      : msg.op === 'retrieve' ? this.quests.retrieve(copy, def.id, msg.index ?? 0, p.state.x, p.state.z, now)
      : this.quests.turnIn(copy, def.id, now);
    if (!changed) {
      if (msg.op === 'retrieve') p.session.sendJson({ t: 'error', code: 'invalid_message', message: 'Inventory full', fatal: false });
      return;
    }
    p.questBusy = true;
    try {
      // Commit journal, inventory and wallet in ONE database statement before acknowledging.
      await this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.health, coins: copy.coins, inventory: copy.inv.toJSON(), journal: copy.journal, life: structuredClone(p.life) }]);
      const stashed = copy.inv.items.filter((i) => isStash(i.container)).length - p.inv.items.filter((i) => isStash(i.container)).length;
      if (stashed > 0) this.reply(p, `Ba lô đầy: ${stashed} phần thưởng đã được gửi vào kho cá nhân ở căn cứ.`);
      p.journal = copy.journal;
      p.coins = copy.coins;
      p.inv.load(copy.inv.toJSON());
      p.dirty = true;
      this.sendInv(p);
      p.session.sendJson({ t: 'wallet', coins: p.coins });
      this.sendQuests(p);
      if (msg.op === 'retrieve') return;
      const line = msg.op === 'accept' ? def.dialogue.accept : p.journal[def.id]?.status === 'claimed' ? def.dialogue.complete : def.dialogue.progress;
      if (entity) p.session.sendJson({ t: 'speech', npc: entity.id, text: line, duration: npc.bubbleMs, x: entity.x, y: entity.y, z: entity.z });
    } catch (err) { this.log.error({ err, accountId: p.accountId }, 'quest transaction failed'); }
    finally { this.finishQuestMutation(p); }
  }

  private readonly pendingSaves = new Map<string, Promise<void>>();

  /** Test helpers (free coins, clock jumps, teleports) only outside production. */
  private get devTools(): boolean {
    return this.deps.config.NODE_ENV !== 'production';
  }

  /** Camp NPCs that are not soldiers: they keep a shotgun out of sight and only fire back. */
  private peacefulNpcs(): CampNpc[] {
    const out: CampNpc[] = [this.merchant, this.nurse];
    for (const def of this.content.npcs) {
      const npc = this.questNpcs.get(def.id);
      if (npc && !def.combat?.enabled && !/soldier/.test(def.model)) out.push(npc);
    }
    return out.filter((n) => n.active);
  }

  /** First peaceful NPC whose body (a 0.45 m upright cylinder) the ray crosses before `maxT`. */
  private npcOnRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): { npc: CampNpc; t: number } | null {
    let best: { npc: CampNpc; t: number } | null = null;
    const h = Math.hypot(dx, dz);
    if (h < 1e-6) return null;
    for (const npc of this.peacefulNpcs()) {
      // Closest approach in the ground plane.
      const t = ((npc.x - ox) * dx + (npc.z - oz) * dz) / (h * h);
      if (t <= 0 || t >= (best?.t ?? maxT)) continue;
      const px = ox + dx * t - npc.x, pz = oz + dz * t - npc.z;
      const y = oy + dy * t;
      if (px * px + pz * pz > 0.45 * 0.45 || y < npc.y || y > npc.y + 1.9) continue;
      best = { npc, t };
    }
    return best;
  }

  private provokeNpc(npc: CampNpc, p: Player, now: number): void {
    if (p.dead) return;
    if (npc.aggro?.fired) return;
    npc.aggro = { target: p, until: now + 15_000 };
    npc.fireAt = Math.max(npc.fireAt, now + 900);
    if (now >= npc.sayAt) {
      npc.sayAt = now + 5000;
      this.broadcastAt(npc.x, npc.z, { t: 'speech', npc: npc.id, text: 'Muốn solo?', duration: 2500, x: npc.x, y: npc.y, z: npc.z });
    }
  }

  /** Provoked NPCs fire their shotgun at the attacker (line of sight, within range). */
  private stepNpcRetaliation(now: number): void {
    const spec = WEAPON_SPECS[WeaponId.Shotgun];
    if (spec.kind !== 'gun') return;
    for (const npc of [this.merchant, this.nurse, ...this.questNpcs.values()]) {
      const a = npc.aggro;
      if (!a) continue;
      const t = a.target;
      const dist = Math.hypot(t.state.x - npc.x, t.state.z - npc.z);
      if (now >= a.until || t.dead || this.players.get(t.id) !== t || dist > 40) { npc.aggro = null; continue; }
      if (a.fired || now < npc.fireAt || dist > spec.range) continue;
      const ox = npc.x, oy = npc.y + MUZZLE_HEIGHT, oz = npc.z;
      const tx = t.state.x - ox, ty = t.state.y + 1.0 - oy, tz = t.state.z - oz;
      const len = Math.hypot(tx, ty, tz) || 1;
      if (this.collision.raycast(ox, oy, oz, tx / len, ty / len, tz / len, len, Mask.LineOfSight, this.blastHit)) continue;
      // One warning shot's worth of buckshot, then the shotgun goes away again.
      a.fired = true;
      // Keep the shotgun out a moment so everyone sees who fired.
      a.until = now + 3000;
      const ends: number[] = [];
      let hits = 0;
      for (let i = 0; i < spec.pellets; i++) {
        const [dx, dy, dz] = spreadDirection(tx / len, ty / len, tz / len, spec.spread, Math.random);
        // Pellet hits the target if it passes within its body radius.
        const along = (tx * dx + ty * dy + tz * dz);
        const miss = Math.hypot(tx - dx * along, ty - dy * along, tz - dz * along);
        const end = miss < 0.45 ? along : spec.range;
        if (miss < 0.45) hits++;
        ends.push(+(ox + dx * end).toFixed(2), +(oy + dy * end).toFixed(2), +(oz + dz * end).toFixed(2));
      }
      this.broadcastAt(ox, oz, { t: 'shot', shooterId: npc.id, w: WeaponId.Shotgun, ox, oy, oz, ends });
      // A warning blast: 1–2 damage, but it throws the attacker back.
      if (hits) {
        this.damage(npc.id, t, hits > 4 ? 2 : 1, 'torso', t.state.x, t.state.y + 1, t.state.z, now);
        this.knockback(t, tx, tz, now);
      }
    }
  }

  private stepNpcCombat(now: number): void {
    for (const def of this.content.npcs) {
      const npc = this.questNpcs.get(def.id);
      const combat = def.combat;
      const weapon = weaponSpec(def.weapon);
      if (!npc?.active || !combat?.enabled || weapon?.kind !== 'gun' || !weapon.projectile?.lob || now < (this.npcFireAt.get(def.id) ?? 0)) continue;
      const projectile = weapon.projectile;
      const lob = projectile.lob!;
      const target = this.zombies.near(npc.x, npc.z, combat.range).filter((z) => !z.dead && !this.spawns.inSafeZone(z.state.x, z.state.z)).sort((a, b) => Math.hypot(a.state.x - npc.x, a.state.z - npc.z) - Math.hypot(b.state.x - npc.x, b.state.z - npc.z))[0];
      if (!target) continue;
      const dx = target.state.x - npc.x, dz = target.state.z - npc.z, distance = Math.hypot(dx, dz);
      if (distance < (projectile.blast?.radius ?? 4) + 2 || distance > lob.maxRange) continue;
      const fx = dx / distance, fz = dz / distance;
      const speed = lobSpeed(lob.elevation, lob.maxRange, distance - 0.7, target.state.y - npc.y - MUZZLE_HEIGHT, projectile.gravity);
      const horizontal = Math.cos(lob.elevation) * speed;
      const state = { x: npc.x + fx * 0.7, y: npc.y + MUZZLE_HEIGHT, z: npc.z + fz * 0.7, vx: fx * horizontal, vy: Math.sin(lob.elevation) * speed, vz: fz * horizontal, resting: false };
      const id = this.nextGrenadeId++;
      this.npcRounds.push({ id, source: npc.id, s: state, damage: projectile.blast?.damage ?? weapon.damage, radius: projectile.blast?.radius ?? 4, gravity: projectile.gravity, kind: projectile.kind === 'rocket' ? 'rocket' : 'grenade40', expires: now + projectile.maxFlightSec * 1000 });
      this.npcFireAt.set(def.id, now + combat.fireIntervalMs);
      npc.yaw = Math.atan2(-dx, -dz);
      this.broadcastAt(npc.x, npc.z, { t: 'proj', id, ownerId: npc.id, w: def.weapon, kind: projectile.kind, x: state.x, y: state.y, z: state.z, vx: state.vx, vy: state.vy, vz: state.vz, gravity: projectile.gravity });
    }
    for (let i = this.npcRounds.length - 1; i >= 0; i--) {
      const round = this.npcRounds[i]!;
      stepProjectile(round.s, this.collision, round.gravity, TICK_DT);
      const s = round.s;
      const contact = this.zombies.near(s.x, s.z, 1.2).some((z) => !z.dead && Math.hypot(z.state.x - s.x, z.state.y + 0.7 - s.y, z.state.z - s.z) < 1.2);
      if (!s.resting && !contact && now < round.expires) continue;
      this.npcRounds.splice(i, 1);
      this.broadcastAt(s.x, s.z, { t: 'projEnd', id: round.id, x: s.x, y: s.y, z: s.z, hit: contact });
      this.broadcastAt(s.x, s.z, { t: 'explosion', id: round.id, x: s.x, y: s.y, z: s.z, radius: round.radius, kind: round.kind });
      this.vegetation.explode(s.x, s.y, s.z, round.radius, now);
      for (const zombie of this.zombies.near(s.x, s.z, round.radius)) {
        if (zombie.dead) continue;
        const dx = zombie.state.x - s.x, dz = zombie.state.z - s.z;
        const distance = Math.hypot(dx, zombie.state.y + 0.7 - s.y, dz);
        if (distance < round.radius) this.hitZombie(null, zombie, Math.round(round.damage * (1 - distance / round.radius)), 'torso', zombie.state.x, zombie.state.y + 0.7, zombie.state.z, dx, dz, 4, now, round.source);
      }
    }
  }

  private finishQuestMutation(p: Player): void {
    p.questBusy = false;
    for (const deferred of p.afterQuest.splice(0)) deferred();
    if (!p.session.open || p.onLeaveSaved) void this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life) }]).catch((err: unknown) => this.log.error({ err }, 'post-disconnect transaction save failed')).finally(() => { p.onLeaveSaved?.(); p.onLeaveSaved = null; });
  }

  private queueQuestEvent(p: Player, event: QuestEvent): void {
    p.questEvents.push(event);
    if (!p.questBusy) void this.flushQuestEvents(p);
  }

  private async flushQuestEvents(p: Player): Promise<void> {
    if (p.questBusy || !p.questEvents.length) return;
    const events = p.questEvents.splice(0);
    const owner = { journal: structuredClone(p.journal), coins: p.coins, inv: new InventoryModel(p.inv.toJSON()) };
    let changed = false;
    for (const event of events) changed = this.quests.event(owner, event, Date.now()) || changed;
    if (!changed) return;
    p.questBusy = true;
    try {
      await this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: owner.journal, life: structuredClone(p.life) }]);
      p.journal = owner.journal;
      p.dirty = true;
      this.sendQuests(p);
    } catch (err) {
      p.questEvents.unshift(...events);
      this.log.error({ err }, 'quest progress persistence failed');
      return;
    } finally { this.finishQuestMutation(p); }
    // Drain events generated by the remainder of a shotgun/blast in the same simulation turn.
    if (p.questEvents.length) void this.flushQuestEvents(p);
  }

  private configureAnimals(): void {
    const camp = this.deps.world.generator.camp;
    if (!camp) return;
    this.lifeWorld.animals ??= {};
    this.animals.clear();
    this.wild.clear();
    const keep: Record<string, AnimalRecord> = {};
    (this.life.config.animals ?? []).forEach((def, i) => {
      // The entity id encodes the animal type (×16) so clients pick its model.
      for (let n = 0; n < (def.count ?? 1); n++) {
        const key = `${def.id}_${n}`;
        const fresh = !this.lifeWorld.animals![key];
        const record = this.lifeWorld.animals![key] ?? { health: def.health, x: camp.x + def.x, y: camp.y, z: camp.z + def.z, loot: 0 };
        keep[key] = record;
        const animal = new Livestock(0xe0000100 + i * 16 + n, def, camp, record, this.collision);
        if (fresh) animal.respawn();
        this.animals.set(key, animal);
      }
    });
    this.lifeWorld.animals = keep;
  }

  /** Wild sheep and boars roaming the map (never persisted, never respawned where they died). */
  private readonly wild = new Map<Livestock, string>();
  private wildSerial = 1;

  private removeWild(animal: Livestock): void {
    const key = this.wild.get(animal);
    this.wild.delete(animal);
    if (key) this.animals.delete(key);
  }

  /**
   * Keeps a few wild animals around each player: new ones appear 50–120 m away (outside the camp,
   * on dry land), and ones nobody is near any more wander off (are removed).
   */
  private stepWildlife(now: number): void {
    const defs = this.life.config.animals ?? [];
    if (!defs.length) return;
    const gen = this.deps.world.generator;
    for (const [animal] of this.wild) {
      if (animal.dead) continue;
      let near = false;
      for (const p of this.players.values()) if (Math.hypot(p.state.x - animal.state.x, p.state.z - animal.state.z) < 240) { near = true; break; }
      if (!near) this.removeWild(animal);
    }
    for (const p of this.players.values()) {
      if (p.dead || !p.active || this.wild.size >= 48) continue;
      let around = 0;
      for (const [animal] of this.wild) if (Math.hypot(p.state.x - animal.state.x, p.state.z - animal.state.z) < 160) around++;
      if (around >= 4 || Math.random() > 0.5) continue;
      const a = Math.random() * Math.PI * 2;
      const d = 50 + Math.random() * 70;
      const x = p.state.x + Math.cos(a) * d;
      const z = p.state.z + Math.sin(a) * d;
      const y = gen.heightAt(x, z);
      if (!Number.isFinite(y) || y < gen.seaLevel + 0.6 || this.spawns.inSafeZone(x, z)) continue;
      const type = Math.floor(Math.random() * Math.min(defs.length, 16));
      const base = defs[type]!;
      // A wild copy: no pen, a wide grazing area around where it appeared, no respawn.
      const def = { ...base, x, z, pen: undefined, wanderRadius: 14, count: 1 };
      const serial = this.wildSerial++ % 0xffff || this.wildSerial++;
      const record = { health: def.health, x, y, z, loot: 0 };
      const animal = new Livestock(0xe0000100 + (serial << 8) + (type << 4), def, { x: 0, y, z: 0 } as NonNullable<typeof gen.camp>, record, this.collision);
      const key = `wild_${serial}`;
      this.animals.set(key, animal);
      this.wild.set(animal, key);
    }
    void now;
  }

  private hitAnimal(attacker: Player, animal: Livestock, damage: number, now: number, x = animal.state.x, y = animal.state.y + 0.5, z = animal.state.z): void {
    if (this.lifeBusy || animal.dead) return;
    animal.hit(damage, attacker, now);
    this.broadcastAt(animal.state.x, animal.state.z, { t: 'hit', attackerId: attacker.id, targetId: animal.id, damage, zone: 'torso', x, y, z });
    if (!animal.dead) return;
    this.dropAnimalLoot(animal);
    for (const p of this.players.values()) this.sendLife(p);
  }

  private cancelLifeAction(p: Player): void {
    if (p.lifeAction?.kind === 'plant' || p.lifeAction?.kind === 'harvest') this.plotLocks.delete(p.lifeAction.target);
    p.lifeAction = null;
    this.sendLife(p);
  }

  private sendLife(p: Player): void {
    const camp = this.deps.world.generator.camp;
    const config = this.life.config;
    const objects: Array<{ id: string; model: string; x: number; y: number; z: number }> = [];
    if (camp) {
      for (const item of [...config.plots, ...config.stations, ...(config.decorations ?? [])]) objects.push({ id: item.id, model: item.model, x: camp.x + item.x, y: camp.y, z: camp.z + item.z });
      for (const plot of config.plots) {
        const state = this.lifeWorld.plots[plot.id];
        const crop = config.crops.find((c) => c.id === state?.crop);
        const model = crop?.stages[state?.stage ?? -1];
        if (model) objects.push({ id: `${plot.id}_crop`, model, x: camp.x + plot.x, y: camp.y + 0.15, z: camp.z + plot.z });
      }
    }
    for (const [id, animal] of this.animals) {
      const model = config.itemModels?.[animal.def.lootItem];
      if (animal.record.loot > 0 && model) objects.push({ id: `loot_${id}`, model, x: animal.state.x + 0.5, y: animal.state.y, z: animal.state.z });
    }
    // The (large) config only when it is new to this player; world state on every change.
    const withConfig = p.lifeConfig !== config;
    p.lifeConfig = config;
    p.session.sendJson({ t: 'baseLife', ...(withConfig ? { config } : {}), objects, plots: this.lifeWorld.plots, animalLoot: [...this.animals].filter(([, a]) => a.record.loot > 0).map(([id, a]) => ({ id, item: a.def.lootItem, quantity: a.record.loot, x: a.state.x, y: a.state.y, z: a.state.z })), ...this.lifeStats(p) });
  }

  /** Per-player stamina / timed action (small; sent every second). */
  private lifeStats(p: Player): { stamina: number; capacity: number; action: { end: number; kind: string; ms: number } | null } {
    return { stamina: p.life.stamina, capacity: p.life.capacity, action: p.lifeAction ? { end: p.lifeAction.end, kind: p.lifeAction.kind, ms: p.lifeAction.ms } : null };
  }

  private async onLife(p: Player, msg: Extract<ClientMessage, { t: 'life' }>): Promise<void> {
    if (p.dead || p.questBusy || p.lifeAction || this.lifeBusy) return;
    if (msg.op === 'plant' || msg.op === 'cook' || msg.op === 'harvest') {
      const spot = (msg.op === 'cook' ? this.life.config.stations : this.life.config.plots).find((s) => s.id === msg.target);
      const camp = this.deps.world.generator.camp;
      if (!spot || !camp || Math.abs(p.state.y - camp.y) > 3 || Math.hypot(p.state.x - camp.x - spot.x, p.state.z - camp.z - spot.z) > this.life.config.interactionRange) return;
      if (msg.op === 'plant' && (this.lifeWorld.plots[spot.id] || this.plotLocks.has(spot.id))) return;
      if (msg.op === 'harvest') {
        // Timed dig: only a ripe crop nobody else is busy with.
        const state = this.lifeWorld.plots[spot.id];
        const crop = this.life.config.crops.find((c) => c.id === state?.crop);
        if (!crop || !state || state.stage < crop.stages.length - 1 || this.plotLocks.has(spot.id)) return;
        this.plotLocks.set(spot.id, p.id);
        const ms = this.life.config.harvestMs ?? 3000;
        p.lifeAction = { kind: 'harvest', target: msg.target, choice: crop.id, x: p.state.x, z: p.state.z, end: Date.now() + ms, ms };
        this.sendLife(p);
        return;
      }
      if (msg.op === 'cook') {
        const batch = planCooking(this.life.config, p.inv.items);
        if (!batch) return;
        p.lifeAction = { kind: 'cook', target: msg.target, choice: '', x: p.state.x, z: p.state.z,
          end: Date.now() + batch.durationMs, ms: batch.durationMs, cookBatch: batch };
        this.sendLife(p);
        return;
      }
      const crop = this.life.config.crops.find((c) => c.id === msg.choice);
      const item = crop?.item;
      if (!item || !p.inv.countOf(item)) return;
      if (msg.op === 'plant') this.plotLocks.set(spot.id, p.id);
      const ms = this.life.config.plantingMs;
      p.lifeAction = { kind: 'plant', target: msg.target, choice: msg.choice!, x: p.state.x, z: p.state.z, end: Date.now() + ms, ms };
      this.sendLife(p);
      return;
    }
    await this.commitLife(p, msg, false);
  }

  private async commitLife(p: Player, msg: Extract<ClientMessage, { t: 'life' }>, timed: boolean, cooking?: CookingBatch): Promise<void> {
    if (p.dead || p.questBusy || this.lifeBusy) return;
    const camp = this.deps.world.generator.camp;
    if (!camp) return;
    const world = structuredClone(this.lifeWorld);
    const owner = { inv: new InventoryModel(p.inv.toJSON()), coins: p.coins, life: structuredClone(p.life), journal: structuredClone(p.journal) };
    const close = (spot: { x: number; z: number } | undefined, range: number) => spot && Math.abs(p.state.y - camp.y) <= 3 && Math.hypot(p.state.x - camp.x - spot.x, p.state.z - camp.z - spot.z) <= range;
    let ok = false;
    let event: { type: 'plant' | 'harvest' | 'cook' | 'collect'; target: string; quantity: number } | null = null;
    const cookingEvents: Array<{ type: 'cook'; target: string; quantity: number }> = [];
    if (msg.op === 'plant' && timed && close(this.life.config.plots.find((s) => s.id === msg.target), this.life.config.interactionRange)) {
      ok = this.life.plant(world, owner, msg.target, msg.choice ?? '');
      if (ok) event = { type: 'plant', target: msg.choice!, quantity: 1 };
    } else if (msg.op === 'harvest' && timed && close(this.life.config.plots.find((s) => s.id === msg.target), this.life.config.interactionRange)) {
      const result = this.life.harvest(world, owner, msg.target);
      ok = !!result;
      if (!result) p.session.sendJson({ t: 'error', code: 'invalid_message', message: 'Inventory full', fatal: false });
      if (result) event = { type: 'harvest', target: result.item, quantity: result.quantity };
    } else if (msg.op === 'cook' && timed && cooking && close(this.life.config.stations.find((s) => s.id === msg.target), this.life.config.interactionRange)) {
      const result = this.life.cook(owner, cooking);
      ok = !!result;
      if (result) for (const item of result) cookingEvents.push({ type: 'cook', target: item.item, quantity: item.quantity });
    } else if (msg.op === 'buy' || msg.op === 'sell') {
      const trade = this.life.config.trades.find((t) => t.id === msg.target);
      const npc = this.content.npcs.find((n) => n.id === trade?.npc);
      if (npc && this.questNpcs.get(npc.id)?.inReach(p, npc.interactRange)) ok = this.life.trade(owner, msg.target, msg.op, Date.now());
    } else if (msg.op === 'loot') {
      const animal = this.animals.get(msg.target);
      const record = world.animals?.[msg.target];
      if (animal && record && record.health <= 0 && record.loot > 0 && Math.abs(p.state.y - record.y) < 3 && Math.hypot(p.state.x - record.x, p.state.z - record.z) <= this.life.config.interactionRange) {
        ok = true;
        for (let i = 0; i < record.loot; i++) if (!owner.inv.add(animal.def.lootItem)) { ok = false; break; }
        if (ok) { event = { type: 'collect', target: animal.def.lootItem, quantity: record.loot }; record.loot = 0; }
      }
    } else if (msg.op === 'eat') ok = this.life.eat(owner, msg.uid ?? -1);
    if (!ok) return;
    if (event) this.quests.event(owner, event, Date.now());
    for (const cooked of cookingEvents) this.quests.event(owner, cooked, Date.now());
    p.questBusy = true;
    this.lifeBusy = true;
    try {
      await this.deps.playerStates.saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.health, coins: owner.coins, inventory: owner.inv.toJSON(), journal: owner.journal, life: owner.life }], world);
      this.lifeWorld = world;
      for (const [id, animal] of this.animals) {
        if (this.wild.has(animal)) continue;
        const updated = world.animals?.[id];
        if (updated) { Object.assign(animal.record, updated); world.animals![id] = animal.record; }
      }
      p.life = owner.life;
      p.journal = owner.journal;
      p.coins = owner.coins;
      p.inv.load(owner.inv.toJSON());
      p.dirty = true;
      this.sendInv(p);
      this.sendQuests(p);
      p.session.sendJson({ t: 'wallet', coins: p.coins });
      for (const player of this.players.values()) this.sendLife(player);
    } catch (err) { this.log.error({ err }, 'base life transaction failed'); }
    finally { this.lifeBusy = false; this.finishQuestMutation(p); }
  }

  /* ------------------------------------ clock ------------------------------------------- */

  /** Monotonic server time in ms (snapshot timeline, lag compensation). */
  get serverTime(): number {
    return performance.now() - this.epoch;
  }

  get dayLengthMs(): number {
    return this.deps.config.DAY_LENGTH_MINUTES * 60_000;
  }

  timeOfDay(): number {
    const t = this.worldTimeMs / this.dayLengthMs + 0.3;
    return t - Math.floor(t);
  }

  worldInfo(): WorldInfo {
    const gen = this.deps.world.generator;
    return {
      worldId: this.deps.worldId,
      sizeChunks: gen.config.sizeChunks,
      chunkSize: CHUNK_SIZE,
      seaLevel: gen.seaLevel,
      generatorVersion: gen.config.generatorVersion,
      dayLengthSec: this.dayLengthMs / 1000,
      cosmeticSeed: gen.cosmeticSeed,
      camp: gen.camp ? { x: gen.camp.x, z: gen.camp.z, halfSize: CAMP_HALF_SIZE } : null,
    };
  }

  get playerCount(): number {
    return this.players.size;
  }

  get tickCount(): number {
    return this.tick;
  }

  /* ---------------------------------- lifecycle ------------------------------------------ */

  start(): void {
    if (this.timer) return;
    this.lastLoop = performance.now();
    const loop = () => {
      const now = performance.now();
      this.accumulator += now - this.lastLoop;
      this.lastLoop = now;
      let steps = 0;
      while (this.accumulator >= TICK_MS && steps < 4) {
        this.step();
        this.accumulator -= TICK_MS;
        steps++;
      }
      if (this.accumulator >= TICK_MS) {
        // Hopelessly behind (e.g. GC pause or debugger): drop the backlog instead of spiralling.
        this.log.warn({ behindMs: Math.round(this.accumulator) }, 'simulation falling behind; skipping ticks');
        this.accumulator = 0;
      }
      const elapsed = performance.now() - now;
      this.timer = setTimeout(loop, Math.max(1, TICK_MS - this.accumulator - elapsed));
    };
    this.timer = setTimeout(loop, TICK_MS);
    this.log.info({ tickRate: TICK_RATE, spawnCandidates: this.spawns.candidateCount }, 'simulation started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const p of [...this.players.values()]) {
      p.session.sendError('kicked', 'server is shutting down', true);
      this.leave(p.session, 'shutdown');
      p.session.close(CloseCode.GoingAway, 'server shutdown');
    }
    if (this.persisting) await this.persisting;
    await this.persistAll(true);
  }

  /* ------------------------------------ join/leave --------------------------------------- */

  async join(session: ClientSession): Promise<void> {
    const acc = session.account;
    if (!acc) throw new Error('join without account');
    if (this.players.size + this.joining.size >= MAX_PLAYERS) {
      session.sendError('server_full', 'server is full', true);
      session.close(CloseCode.ServerFull, 'server full');
      return;
    }
    const existing = this.byAccount.get(acc.accountId);
    if (existing) {
      existing.session.sendError('duplicate_session', 'you logged in from another location', true);
      this.leave(existing.session, 'duplicate_session');
      existing.session.close(CloseCode.DuplicateSession, 'duplicate session');
    }

    await this.pendingSaves.get(acc.accountId);
    const saved = await this.deps.playerStates.load(acc.accountId);
    let pos: ValidatedPosition | null = null;
    let health = PLAYER_MAX_HEALTH;
    const pin = saved ? ([Math.floor(saved.x / CHUNK_SIZE), Math.floor(saved.z / CHUNK_SIZE)] as [number, number]) : null;
    if (pin) this.joining.set(session.id, pin);
    try {
      if (saved && saved.health > 0 && this.collision.inBounds(saved.x, saved.z)) {
        pos = await this.spawns.validateLoaded(saved.x, saved.z);
        if (pos) health = saved.health;
        else this.log.info({ accountId: acc.accountId }, 'saved position invalid; respawning');
      }
      pos ??= await this.spawns.pickSpawn();
    } finally {
      this.joining.delete(session.id);
    }
    if (!session.open) return;
    if (this.byAccount.has(acc.accountId)) {
      session.sendError('duplicate_session', 'already connected', true);
      session.close(CloseCode.DuplicateSession, 'duplicate session');
      return;
    }

    const player = new Player(this.nextEntityId++, acc.accountId, acc.username, session, pos.x, pos.y, pos.z);
    player.yaw = saved?.yaw ?? 0;
    player.health = health;
    player.coins = Math.max(0, Math.round(saved?.coins ?? STARTING_ZCOIN));
    player.life = saved?.life?.quotas ? saved.life : this.life.initial();
    player.life.capacity = Math.min(this.life.config.stamina.maximum, Math.max(this.life.config.stamina.minimumCapacity, player.life.capacity));
    player.life.stamina = Math.max(0, Math.min(player.life.capacity, player.life.stamina));
    player.journal = saved?.journal ?? {};
    this.quests.reset(player, Date.now());
    player.inv.load(saved?.inventory ?? defaultLoadout());
    this.syncLoadout(player);
    player.state.grounded = true;
    player.streamer = new ChunkStreamer(session, this.deps.world, this.deps.world.generator.config.sizeChunks, this.deps.metrics);
    player.streamer.setCenter(player.chunkX, player.chunkZ);
    player.history.push(this.serverTime, pos.x, pos.y, pos.z, player.yaw);
    player.active = true;
    session.player = player;
    session.state = 'playing';
    this.players.set(player.id, player);
    this.byAccount.set(acc.accountId, player);
    this.grid.update(player);
    this.deps.metrics.players = this.players.size;

    session.sendJson({
      t: 'welcome',
      playerId: player.id,
      username: player.username,
      world: this.worldInfo(),
      tickRate: TICK_RATE,
      serverTime: this.serverTime,
      spawn: { x: pos.x, y: pos.y, z: pos.z, yaw: player.yaw },
    });
    session.sendJson({ t: 'wallet', coins: player.coins });
    this.syncVegetation(player);
    this.sendInv(player);
    this.sendQuests(player);
    this.sendLife(player);
    session.sendJson({ t: 'ground', items: [...this.groundItems].map(([id, g]) => ({ id, itemId: g.itemId, count: g.count, x: g.x, y: g.y, z: g.z })) });
    session.sendJson(this.npcList());
    session.sendJson({ t: 'coins', drops: [...this.coinDrops].map(([id, c]) => ({ id, x: c.x, y: c.y, z: c.z, amount: c.amount })) });
    this.broadcastPlayerList();
    this.deps.audit.record({ event: 'player.join', accountId: acc.accountId, ip: session.ip, details: { x: Math.round(pos.x), z: Math.round(pos.z) } });
  }

  leave(session: ClientSession, reason: string): void {
    const p = session.player;
    if (!p) return;
    session.player = null;
    if (this.players.get(p.id) !== p) return;
    if (p.lifeAction?.kind === 'plant') this.plotLocks.delete(p.lifeAction.target);
    p.lifeAction = null;
    p.active = false;
    this.players.delete(p.id);
    if (this.byAccount.get(p.accountId) === p) this.byAccount.delete(p.accountId);
    this.grid.remove(p);
    this.deps.metrics.players = this.players.size;
    // The final save is tracked per account: a re-login waits for it before loading, so it can
    // never start from a stale row (no rollback / duplication by quick reconnects).
    const saved = p.questBusy
      ? new Promise<void>((resolve) => { p.onLeaveSaved = resolve; })
      : this.deps.playerStates
        .saveMany([{ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life) }])
        .catch((err: unknown) => this.log.error({ err, accountId: p.accountId }, 'failed to save player on leave'));
    const tracked: Promise<void> = Promise.race([saved.then(() => undefined), new Promise<void>((r) => setTimeout(r, 10_000))]).finally(() => {
      if (this.pendingSaves.get(p.accountId) === tracked) this.pendingSaves.delete(p.accountId);
    });
    this.pendingSaves.set(p.accountId, tracked);
    for (const key of this.speechAt.keys()) if (key.startsWith(`${p.id}:`)) this.speechAt.delete(key);
    this.broadcastPlayerList();
    this.log.info({ playerId: p.id, reason }, 'player left');
  }

  /* ------------------------------------ messages ----------------------------------------- */

  handleMessage(session: ClientSession, msg: ClientMessage): void {
    const p = session.player;
    if (!p || p.questBusy) return;
    switch (msg.t) {
      case 'life':
        void this.onLife(p, msg);
        return;
      case 'quest':
        void this.onQuest(p, msg);
        return;
      case 'in':
        this.onInput(p, msg);
        return;
      case 'ping':
        if (session.pingBucket.take()) session.sendJson({ t: 'pong', id: msg.id, ct: msg.ct, st: this.serverTime });
        return;
      case 'chat':
        this.onChat(p, msg.text);
        return;
      case 'respawn':
        this.onRespawn(p);
        return;
      case 'inv':
        this.onInventory(p, msg);
        return;
      case 'reload':
        this.onReload(p);
        return;
      case 'distress': {
        // Call for help: everyone within 300 m sees where the downed player lies.
        const now = Date.now();
        if (!p.downed || now - p.distressAt < 10_000) return;
        p.distressAt = now;
        const text = JSON.stringify({ t: 'distress', playerId: p.id, name: p.username, x: p.state.x, z: p.state.z });
        for (const o of this.players.values()) if (o !== p && Math.hypot(o.state.x - p.state.x, o.state.z - p.state.z) < 300) o.session.sendText(text);
        this.reply(p, 'Đã gửi tín hiệu cấp cứu tới người chơi gần đây.');
        return;
      }
      case 'giveup':
        if (p.downed) this.killPlayer(p, null, this.serverTime);
        return;
      case 'revive': {
        const t = this.players.get(msg.id);
        if (!t || t === p || !t.downed || p.dead || p.downed) return;
        // Client and server positions differ by up to a tick of movement plus interpolation delay.
        if (Math.hypot(p.state.x - t.state.x, p.state.z - t.state.z) > REVIVE_REACH) { this.reply(p, 'Lại gần hơn để cấp cứu.'); return; }
        p.reviving = { target: t, until: this.serverTime + 5000, x: p.state.x, z: p.state.z };
        p.session.sendJson({ t: 'reviving', target: t.id, durationMs: 5000 });
        return;
      }
      case 'devcoins':
        // Testing aid (like 'settime'): free ZCoin. Never in production.
        if (!this.devTools) { this.flag(p, 'invalid_message', { reason: 'devcoins' }); return; }
        this.addCoins(p, DEV_COIN_GRANT);
        return;
      case 'heal':
        this.onHeal(p, msg.uid);
        return;
      case 'pickcoin':
        this.onPickupCoin(p, msg.id);
        return;
      case 'nurseheal':
        this.onNurseHeal(p, msg.req);
        return;
      case 'buy':
        this.onBuy(p, msg.req, msg.item);
        return;
      case 'sell':
        this.onSell(p, msg.req, msg.uid);
        return;
      case 'settime': {
        // Testing aid: jump the shared world clock (keeps the day count). Never in production.
        if (!this.devTools) { this.flag(p, 'invalid_message', { reason: 'settime' }); return; }
        const day = Math.floor(this.worldTimeMs / this.dayLengthMs);
        const frac = (((msg.tod - 0.3) % 1) + 1) % 1;
        this.worldTimeMs = (day + frac) * this.dayLengthMs;
        return;
      }
      case 'auth':
        if (session.strike()) this.flag(p, 'invalid_message', { reason: 'auth after join' });
        return;
    }
  }

  private onInput(p: Player, msg: InputMessage): void {
    if (msg.s <= p.lastReceivedSeq) {
      this.flag(p, 'sequence_replay', { seq: msg.s, last: p.lastReceivedSeq });
      return;
    }
    if (p.lastReceivedSeq >= 0 && msg.s > p.lastReceivedSeq + 1) this.flag(p, 'sequence_gap', { gap: msg.s - p.lastReceivedSeq });
    p.lastReceivedSeq = msg.s;
    if (p.inputs.length >= MAX_QUEUED_INPUTS) {
      p.inputs.shift();
      this.flag(p, 'input_overflow');
    }
    p.inputs.push(msg);
  }

  private onChat(p: Player, raw: string): void {
    const s = p.session;
    if (!s.chatBucket.take()) {
      this.flag(p, 'chat_spam');
      s.sendError('rate_limited', 'you are sending messages too quickly', false);
      return;
    }
    const text = sanitizeChat(raw);
    if (!text) return;
    // Slash commands are handled here and never broadcast.
    if (text.startsWith('/')) {
      this.onCommand(p, text.slice(1).trim());
      return;
    }
    const now = Date.now();
    if (text === s.lastChat && now - s.lastChatAt < 15_000) {
      this.flag(p, 'chat_spam', { reason: 'duplicate' });
      return;
    }
    s.lastChat = text;
    s.lastChatAt = now;
    this.broadcast({ t: 'chat', from: p.username, fromId: p.id, text });
  }

  /** Replies to one player only, as a greyed system line in their chat. */
  private reply(p: Player, text: string): void {
    p.session.sendJson({ t: 'chat', from: 'ZION', fromId: 0, text, system: true });
  }

  private onCommand(p: Player, line: string): void {
    const [cmd = '', ...args] = line.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'locate':
      case 'tp':
        if (!this.devTools) { this.reply(p, `Unknown command /${cmd}. Type /help`); return; }
        this.cmdLocate(p, args[0]);
        return;
      case 'down':
        // Test aid: drop to the ground (knocked down) right away.
        if (!this.devTools) { this.reply(p, 'Unknown command /down. Type /help'); return; }
        if (!p.dead && !p.downed) { p.health = 0; this.knockDown(p, this.serverTime); }
        return;
      case 'kill':
        // Respawn command (stuck somewhere): dies on the spot.
        if (!p.dead) this.damage(null, p, 10_000, 'suicide', p.state.x, p.state.y + 1, p.state.z, this.serverTime);
        return;
      case 'npc': {
        if (!this.devTools) { this.reply(p, 'Unknown command /npc. Type /help'); return; }
        const def = this.content.npcs.find((n) => n.id === args[0]?.toLowerCase());
        const e = def && this.questNpcs.get(def.id);
        if (!e || p.dead) { this.reply(p, `Usage: /npc <${this.content.npcs.map((n) => n.id).join('|')}>`); return; }
        void this.spawns.validateLoaded(e.x + 2, e.z + 1).then((pos) => {
          if (!pos || this.players.get(p.id) !== p || p.dead) return;
          this.teleport(p, pos);
          p.session.sendJson({ t: 'respawn', playerId: p.id, x: pos.x, y: pos.y, z: pos.z });
        });
        return;
      }
      case 'help':
      case '':
        this.reply(p, 'Commands: /npc <id> — go to a quest NPC; /locate <type> — teleport to the nearest structure. Types: ' + STRUCTURE_KINDS.join(', '));
        return;
      default:
        this.reply(p, `Unknown command /${cmd}. Type /help`);
    }
  }

  /** /locate <type>: teleport next to the nearest abandoned structure of that type. */
  private cmdLocate(p: Player, arg: string | undefined): void {
    const alias: Record<string, StructureKind> = {
      house: 'house_small', small: 'house_small', house_small: 'house_small', nha: 'house_small',
      large: 'house_large', house_large: 'house_large', big: 'house_large',
      camp: 'ruined_camp', ruined_camp: 'ruined_camp', trai: 'ruined_camp',
      factory: 'factory', xuong: 'factory', workshop: 'factory',
      power: 'power_plant', plant: 'power_plant', power_plant: 'power_plant',
      town: 'town', village: 'town', thitran: 'town',
    };
    const kind = arg ? alias[arg.toLowerCase()] : undefined;
    if (!kind) {
      this.reply(p, `Usage: /locate <type>. Types: ${STRUCTURE_KINDS.join(', ')}`);
      return;
    }
    if (p.dead) {
      this.reply(p, 'You are dead.');
      return;
    }
    const sx = p.state.x;
    const sz = p.state.z;
    let best: { x: number; z: number; radius: number } | null = null;
    let bd = Infinity;
    for (const s of allStructures(this.deps.world.generator)) {
      if (s.kind !== kind) continue;
      const d = Math.hypot(s.x - sx, s.z - sz);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) {
      this.reply(p, `No ${kind} exists in this world.`);
      return;
    }
    const dist = Math.round(bd);
    const target = best;
    // Land just outside its edge, on the side facing where the player came from.
    const ang = Math.atan2(sz - target.z, sx - target.x);
    const off = target.radius + 4;
    const tx = target.x + Math.cos(ang) * off;
    const tz = target.z + Math.sin(ang) * off;
    this.reply(p, `Nearest ${kind}: ${dist} m away. Teleporting…`);
    // Try the near side first, then all around the edge, then the middle.
    const tryAll = async () => {
      const spots: Array<[number, number]> = [[tx, tz]];
      for (const extra of [4, 9]) for (let k = 0; k < 8; k++) {
        const a = ang + (k * Math.PI) / 4;
        spots.push([target.x + Math.cos(a) * (target.radius + extra), target.z + Math.sin(a) * (target.radius + extra)]);
      }
      spots.push([target.x, target.z]);
      for (const [x, z] of spots) {
        const pos = await this.spawns.validateLoaded(x, z);
        if (pos) return pos;
      }
      return null;
    };
    void tryAll()
      .then((pos) => {
        if (!pos || this.players.get(p.id) !== p || p.dead) {
          this.reply(p, 'Could not find a safe spot there.');
          return;
        }
        this.teleport(p, pos);
        p.session.sendJson({ t: 'respawn', playerId: p.id, x: pos.x, y: pos.y, z: pos.z });
        this.reply(p, `Teleported to the ${kind} (${dist} m).`);
      })
      .catch((err: unknown) => this.log.error({ err }, 'locate teleport failed'));
  }

  private onRespawn(p: Player): void {
    if (!p.dead || this.respawning.has(p.id)) return;
    if (this.serverTime - p.deadAt < RESPAWN_DELAY_MS) return;
    this.respawning.add(p.id);
    this.spawns
      .pickSpawn()
      .then((pos) => {
        if (!this.players.has(p.id)) return;
        this.teleport(p, pos);
        p.health = PLAYER_MAX_HEALTH;
        p.dead = false;
        p.killerId = null;
        this.broadcastNear(p, { t: 'respawn', playerId: p.id, x: pos.x, y: pos.y, z: pos.z });
        p.session.sendJson({ t: 'respawn', playerId: p.id, x: pos.x, y: pos.y, z: pos.z });
      })
      .catch((err: unknown) => this.log.error({ err }, 'respawn failed'))
      .finally(() => this.respawning.delete(p.id));
  }

  private flag(p: Player, kind: SuspicionKind, detail?: Record<string, unknown>): void {
    this.deps.metrics.anticheatFlags++;
    if (!p.suspicion.add(kind, detail)) return;
    this.deps.metrics.kicks++;
    this.deps.audit.record({
      event: 'anticheat.kick',
      accountId: p.accountId,
      ip: p.session.ip,
      severity: 'critical',
      details: { kind, recent: p.suspicion.recent.slice(-10) },
    });
    p.session.sendError('kicked', 'disconnected by anti-cheat', true);
    this.leave(p.session, `anticheat:${kind}`);
    p.session.close(CloseCode.Kicked, 'kicked');
  }

  /* ------------------------------------ simulation --------------------------------------- */

  private step(): void {
    const t0 = performance.now();
    this.tick++;
    this.worldTimeMs += TICK_MS;
    const now = this.serverTime;
    this.chests.step();

    if (!this.lifeBusy && this.life.growth(this.lifeWorld, Date.now())) {
      for (const p of this.players.values()) this.sendLife(p);
    }
    for (const p of this.players.values()) {
      if (!p.active || p.questBusy) continue;
      if (p.questEvents.length) { void this.flushQuestEvents(p); if (p.questBusy) continue; }
      if (p.dead) {
        // Dead players' inputs are acknowledged but ignored.
        const last = p.inputs[p.inputs.length - 1];
        if (last) p.lastProcessedSeq = last.s;
        p.inputs.length = 0;
        continue;
      }
      if (p.lifeAction && Math.hypot(p.state.x - p.lifeAction.x, p.state.z - p.lifeAction.z) > 0.05) this.cancelLifeAction(p);
      if (p.lifeAction && Date.now() >= p.lifeAction.end && !this.lifeBusy) {
        const a = p.lifeAction;
        p.lifeAction = null;
        if (a.kind === 'plant' || a.kind === 'harvest') this.plotLocks.delete(a.target);
        void this.commitLife(p, { t: 'life', op: a.kind, target: a.target, choice: a.choice }, true, a.cookBatch);
      }
      if (p.questBusy) continue;
      if (!(p.lastButtons & Buttons.Sprint)) this.life.rest(p.life, TICK_DT);
      if (this.tick % TICK_RATE === 0) p.session.sendJson({ t: 'baseLife', ...this.lifeStats(p) });
      p.budget.earn();
      let processed = 0;
      while (p.inputs.length > 0 && processed < MAX_INPUTS_PER_TICK && p.budget.tryConsume()) {
        this.applyInput(p, p.inputs.shift()!, now);
        processed++;
      }
      if (processed === 0) {
        if (++p.starvedTicks > STARVE_TICKS) this.coast(p);
      } else {
        p.starvedTicks = 0;
      }
      if (now >= p.wireReadyAt && touchesBarbedWire(this.collision, p.state)) {
        p.wireReadyAt = now + WIRE_INTERVAL_MS;
        this.damage(null, p, WIRE_DAMAGE, 'barbed_wire', p.state.x, p.state.y + 0.8, p.state.z, now);
      }
      if (this.tick % TICK_RATE === 0) {
        this.resolveQuestLocations(p);
        this.queueQuestEvent(p, { type: 'visit', x: p.state.x, z: p.state.z });
      }
      p.history.push(now, p.state.x, p.state.y, p.state.z, p.yaw);
      this.grid.update(p);
      p.streamer.setCenter(p.chunkX, p.chunkZ);
    }

    if (this.tick % PHYSICS_UPDATE_TICKS === 0) {
      const centers: Array<[number, number]> = [];
      for (const p of this.players.values()) centers.push([p.chunkX, p.chunkZ]);
      for (const c of this.joining.values()) centers.push(c);
      this.physics.update(centers);
    }

    this.stepGrenades(now);
    this.activeScratch.length = 0;
    for (const p of this.players.values()) if (p.active) this.activeScratch.push(p);
    this.zombies.step(this.activeScratch, now, this.timeOfDay());
    this.guards.step(this.zombies.zombies.values(), this.activeScratch, now);
    // Announce the stalls to everyone once each NPC has been placed.
    if (!this.lifeBusy) for (const animal of this.animals.values()) {
      if (animal.dead && now - (animal.record.diedAt ?? 0) >= (animal.def.respawnMs ?? 10_000)) {
        if (this.wild.has(animal)) this.removeWild(animal);
        else animal.respawn();
        for (const p of this.players.values()) this.sendLife(p);
      }
    }
    if (this.tick % (TICK_RATE * 4) === 0) this.stepWildlife(now);
    if (!this.lifeBusy) for (const animal of this.animals.values()) animal.step(now, (target, amount) => {
      // Livestock retaliation uses the same server damage path as hostile creatures.
      this.damage(null, target, amount, 'bite', target.state.x, target.state.y + 0.5, target.state.z, now);
    });
    for (const [key, entity] of this.questNpcs) {
      const placed = entity.step(this.activeScratch, TICK_DT);
      const def = this.content.npcs.find((n) => n.id === key)!;
      if (placed) for (const p of this.players.values()) this.sendQuests(p);
      if (this.tick % TICK_RATE !== 0) continue;
      for (const p of this.activeScratch) {
        const cooldownKey = `${p.id}:${key}`;
        if (p.dead || !entity.inReach(p, def.greetRange) || now < (this.speechAt.get(cooldownKey) ?? 0)) continue;
        const ambient = def.ambient.length > 0 && Math.random() < 0.35;
        const pool = ambient ? def.ambient : def.greetings;
        if (!pool.length) continue;
        this.speechAt.set(cooldownKey, now + def.cooldownMs);
        const speech = { t: 'speech' as const, npc: entity.id, text: pool[Math.floor(Math.random() * pool.length)]!, duration: def.bubbleMs, x: entity.x, y: entity.y, z: entity.z };
        if (ambient && def.ambientPublic) this.broadcastAt(entity.x, entity.z, speech);
        else p.session.sendJson(speech);
      }
    }
    if (this.merchant.step(this.activeScratch, TICK_DT) || this.nurse.step(this.activeScratch, TICK_DT)) this.broadcast(this.npcList());
    this.stepNpcCombat(now);
    this.stepNpcRetaliation(now);
    this.stepDowned(now);
    this.stepRounds(now);
    this.stepStrikes(now);
    this.stepReloads(now);
    this.stepBurning(now);
    if (this.tick % TICK_RATE === 0) this.vegetation.step(now, 1, this.deps.config.RANDOM_TICK_SPEED);
    for (const p of this.players.values()) if (p.active) this.syncVegetation(p);
    this.collectCoins();
    if (this.tick % TICK_RATE === 0) {
      this.expireCoins(now);
      this.expireGroundItems(now);
    }
    for (const z of this.zombies.zombies.values()) {
      if (!z.dead && now >= z.wireReadyAt && touchesBarbedWire(this.collision, z.state)) {
        z.wireReadyAt = now + WIRE_INTERVAL_MS;
        this.hitZombie(null, z, WIRE_DAMAGE, 'barbed_wire', z.state.x, z.state.y + 0.8, z.state.z, 0, 0, 0, now);
      }
    }
    for (const p of this.players.values()) p.streamer.update();
    if (this.tick % SNAPSHOT_INTERVAL_TICKS === 0) this.sendSnapshots(now);

    if (Date.now() - this.lastPersist > PERSIST_INTERVAL_MS && !this.persisting) {
      this.lastPersist = Date.now();
      this.persisting = this.persistAll(false).finally(() => {
        this.persisting = null;
      });
    }
    this.deps.metrics.recordTick(performance.now() - t0, TICK_MS);
  }

  private applyInput(p: Player, input: InputMessage, now: number): void {
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    // What is in hand / on the back comes from the server's inventory, not the client's claim.
    const held = p.inv.equippedItem();
    p.weapon = held ? (WEAPON_BY_ITEM[held.itemId] ?? 0) : 0;
    const s = p.state;
    const px = s.x;
    const pz = s.z;
    let buttons = input.b;
    // Downed: can't do anything but lie there (and call for help).
    if (p.downed) { input = { ...input, mx: 0, mz: 0 }; buttons = 0; }
    if (p.reloadUid || gunBlocksSprint(p.weapon, (buttons & Buttons.Attack) !== 0, now, p.fireReadyAt)) buttons &= ~Buttons.Sprint;
    // Exhausted (under 10% stamina): no sprinting, no rolling.
    if (p.life.stamina < this.life.config.stamina.maximum * 0.1) buttons &= ~(Buttons.Sprint | Buttons.Roll);
    // Staggered by a hit: no steering until it lands.
    if (now < p.stunUntil) { input = { ...input, mx: 0, mz: 0 }; buttons &= ~(Buttons.Sprint | Buttons.Roll | Buttons.Jump); }
    if ((buttons & Buttons.Sprint) && (input.mx || input.mz) && !this.life.spend(p.life, this.life.config.stamina.sprintPerSecond * TICK_DT)) buttons &= ~Buttons.Sprint;
    if ((buttons & Buttons.Roll) && p.state.rollTicks === 0 && p.state.rollCooldown === 0 && p.state.grounded && !this.life.spend(p.life, this.life.config.stamina.roll)) buttons &= ~Buttons.Roll;
    input = { ...input, b: buttons };
    p.lastButtons = buttons;
    const wasRolling = p.state.rollTicks > 0;
    const info = this.controller.step(
      s,
      { mx: input.mx, mz: input.mz, yaw: input.yaw, jump: (input.b & Buttons.Jump) !== 0, sprint: (input.b & Buttons.Sprint) !== 0, roll: (input.b & Buttons.Roll) !== 0, speedMul: p.speedMul },
      TICK_DT,
      this.stepInfo,
    );
    if (!wasRolling && p.state.rollTicks > 0) p.state.rollCooldown = Math.round(this.life.config.stamina.rollCooldown / TICK_DT);
    p.frozenTicks = info.frozen ? p.frozenTicks + 1 : 0;
    const dx = s.x - px;
    const dz = s.z - pz;
    if (dx * dx + dz * dz > MAX_STEP_DISTANCE * MAX_STEP_DISTANCE) {
      this.flag(p, 'movement_anomaly', { d: Math.sqrt(dx * dx + dz * dz) });
    }
    if (dx !== 0 || dz !== 0) p.dirty = true;
    if (s.stuckTicks > STUCK_TICKS_LIMIT) this.unstick(p);
    if ((input.b & Buttons.Attack) !== 0) {
      const spec = weaponSpec(p.weapon);
      if (spec?.kind === 'gun') {
        // No shooting while airborne (jumping/falling).
        if (p.state.grounded || p.state.swimming) {
          if (spec.fire === 'projectile') this.tryLaunch(p, spec, now, input.td);
          else if (spec.fire === 'flame') this.tryFlame(p, spec, now);
          else this.tryShoot(p, now, input.rt);
        }
      }
      else if (spec?.kind === 'throw') this.tryThrow(p, now, input.td);
      else this.tryAttack(p, now, input.rt, spec?.kind === 'melee' ? spec : undefined);
    }
    p.lastProcessedSeq = input.s;
  }

  /** Neutral step when a client's inputs stall (keeps gravity/water physics authoritative). */
  private coast(p: Player): void {
    this.controller.step(p.state, { mx: 0, mz: 0, yaw: p.yaw, jump: false, sprint: false }, TICK_DT, this.stepInfo);
  }

  private teleport(p: Player, pos: ValidatedPosition): void {
    const s = p.state;
    s.x = pos.x;
    s.y = pos.y;
    s.z = pos.z;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.grounded = true;
    s.stuckTicks = 0;
    s.rollTicks = 0;
    p.inputs.length = 0;
    p.history.clear();
    p.history.push(this.serverTime, s.x, s.y, s.z, p.yaw);
    p.dirty = true;
    this.grid.update(p);
    p.streamer.setCenter(p.chunkX, p.chunkZ);
  }

  private unstick(p: Player): void {
    const pos = this.spawns.validateAt(p.state.x, p.state.z);
    this.deps.audit.record({
      event: 'player.unstuck',
      accountId: p.accountId,
      severity: 'warn',
      details: { x: p.state.x, y: p.state.y, z: p.state.z, resolved: !!pos },
    });
    if (pos) this.teleport(p, pos);
    else {
      p.state.stuckTicks = 0;
      this.spawns.pickSpawn().then((sp) => this.teleport(p, sp)).catch((err: unknown) => this.log.error({ err }, 'unstick failed'));
    }
  }

  private tryAttack(p: Player, now: number, renderTime: number | undefined, blade?: MeleeSpec): void {
    if (now < p.attackReadyAt - FIRE_TOLERANCE_MS) return;
    if (!this.life.spend(p.life, this.life.config.stamina.attack)) return;
    p.attackReadyAt = now + (blade?.cooldownMs ?? MELEE.cooldownMs);
    p.attackingUntil = now + (blade?.swingMs ?? MELEE.swingMs);
    if (renderTime !== undefined && (renderTime > now + 1000 || renderTime < now - 2000)) {
      this.flag(p, 'rewind_out_of_window', { delta: Math.round(now - renderTime) });
    }
    // Like a zombie's bite, the blow lands after its wind-up, judged on where everyone is then.
    p.strike = { at: now + (blade ? BLADE_HIT_DELAY_MS : FIST_HIT_DELAY_MS), blade, rewind: renderTime === undefined ? undefined : now - renderTime };
  }

  /** Resolves pending melee blows whose wind-up has elapsed (only if the attacker still lives). */
  private stepStrikes(now: number): void {
    for (const p of this.activeScratch) {
      const st = p.strike;
      if (!st || now < st.at) continue;
      p.strike = null;
      if (p.dead || p.questBusy) continue;
      this.resolveStrike(p, now, st.rewind === undefined ? undefined : now - st.rewind, st.blade);
    }
  }

  private resolveStrike(p: Player, now: number, renderTime: number | undefined, blade?: MeleeSpec): void {
    const range = blade?.range ?? MELEE.range;
    const candidates: Combatant[] = [...this.grid.query(p.chunkX, p.chunkZ, 1, this.scratch), ...this.zombies.near(p.state.x, p.state.z, range + 2), ...this.animals.values()];
    {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const npc = this.peacefulNpcs().find((n) => {
        const dx = n.x - p.state.x, dz = n.z - p.state.z, d = Math.hypot(dx, dz);
        return d <= range + 0.4 && (dx * fx + dz * fz) / (d || 1) > 0.5;
      });
      if (npc) { this.provokeNpc(npc, p, now); return; }
    }
    // Blades cut whoever is right in front (wide wedge); fists still need to be aimed.
    const res = blade
      ? resolveBladeSweep(p, candidates, this.collision, now, renderTime, { range, damage: blade.damage, halfAngle: 1.05 })
      : resolveMelee(p, candidates, this.collision, now, renderTime);
    if (!res) return;
    this.hitTarget(p, res.target, res.damage, blade && res.zone === 'torso' ? 'slash' : res.zone, res.x, res.y, res.z, -Math.sin(p.yaw), -Math.cos(p.yaw), blade ? 4 : 2.5, now);
  }

  /** Routes a hit to a player or a zombie. */
  private hitTarget(attacker: Player, target: Combatant, amount: number, zone: string, x: number, y: number, z: number, dirX: number, dirZ: number, impulse: number, now: number): void {
    if (target instanceof Zombie) this.hitZombie(attacker, target, amount, zone, x, y, z, dirX, dirZ, impulse, now);
    else if (target instanceof Livestock) this.hitAnimal(attacker, target, amount, now, x, y, z);
    else {
      const t = target as Player;
      this.damage(attacker.id, t, amount, zone, x, y, z, now);
      if (amount > 0 && !this.spawns.inSafeZone(t.state.x, t.state.z)) this.knockback(t, dirX, dirZ, now);
    }
  }

  /** Shot: thrown off the feet away from the shooter (brief stagger, no steering mid-air). */
  private knockback(t: Player, dirX: number, dirZ: number, now: number): void {
    if (t.dead) return;
    const l = Math.hypot(dirX, dirZ) || 1;
    t.state.vx = (dirX / l) * 6;
    t.state.vz = (dirZ / l) * 6;
    t.state.vy = Math.max(t.state.vy, 3.5);
    t.state.grounded = false;
    t.stunUntil = now + 550;
    t.dirty = true;
  }

  private hitZombie(attacker: Player | null, zb: Zombie, amount: number, zone: string, x: number, y: number, z: number, dirX: number, dirZ: number, impulse: number, now: number, sourceId = attacker?.id ?? 0): void {
    const res = this.zombies.hit(zb, zone, amount, dirX, dirZ, impulse, now, attacker);
    const len = Math.hypot(dirX, dirZ) || 1;
    const msgHit = {
      t: 'hit' as const,
      attackerId: sourceId,
      targetId: zb.id,
      zone,
      damage: Math.round(amount),
      x,
      y,
      z,
      kx: +(dirX / len).toFixed(3),
      kz: +(dirZ / len).toFixed(3),
      force: +impulse.toFixed(2),
    };
    this.broadcastAt(zb.state.x, zb.state.z, msgHit);
    if (res.killed) {
      if (attacker) this.queueQuestEvent(attacker, { type: 'kill', target: 'zombie' });
      this.broadcastAt(zb.state.x, zb.state.z, { t: 'death', playerId: zb.id, killerId: sourceId || null });
      // Some zombies drop a ZCoin where they fell; whoever picks it up gets it.
      if (Math.random() < ZOMBIE_COIN_DROP_CHANCE) this.dropCoin(zb.state.x, zb.state.y, zb.state.z, now);
    }
  }

  private broadcastAt(x: number, z: number, msg: ServerJsonMessage): void {
    const near = this.grid.query(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), ENTITY_INTEREST_RADIUS_CHUNKS, []);
    if (!near.length) return;
    const text = JSON.stringify(msg);
    for (const p of near) p.session.sendText(text);
  }

  private damage(attackerId: number | null, t: Player, amount: number, zone: string, x: number, y: number, z: number, now: number): void {
    if (t.dead || amount <= 0) return;
    if (t.questBusy) { t.afterQuest.push(() => this.damage(attackerId, t, amount, zone, x, y, z, now)); return; }
    if (t.downed) {
      // Hitting someone who is down drains what is left of their bleed-out.
      t.bleed -= amount;
      this.broadcastNear(t, { t: 'hit', attackerId: attackerId ?? 0, targetId: t.id, zone, damage: amount, x, y, z });
      if (t.bleed <= 0 || zone === 'suicide') this.killPlayer(t, attackerId, now);
      return;
    }
    // Safe zone: no player-caused damage (guns, melee, grenades) to players inside the camp.
    // (Camp NPCs firing back at whoever shot them are the exception.)
    if (attackerId !== null && !isZombieId(attackerId) && attackerId < NPC_ID_BASE && this.spawns.inSafeZone(t.state.x, t.state.z)) return;
    // Worn armour soaks up part of every hit and wears down by what it absorbed.
    const prot = armorProtection(t.armor);
    if (prot > 0) {
      const absorbed = amount * prot;
      amount = Math.max(1, Math.round(amount - absorbed));
      const broke = t.inv.wearArmor(absorbed).length > 0;
      if (broke) this.syncLoadout(t);
      t.dirty = true;
      t.session.sendJson({ t: 'armorHit', absorbed: Math.round(absorbed * 10) / 10, broke });
      this.sendInv(t);
    }
    t.health = Math.max(0, t.health - amount);
    t.dirty = true;
    this.broadcastNear(t, { t: 'hit', attackerId: attackerId ?? 0, targetId: t.id, zone, damage: amount, x, y, z });
    if (t.health <= 0) {
      if (zone === 'suicide') this.killPlayer(t, attackerId, now);
      else this.knockDown(t, now);
    }
  }

  /** Out of health: down on the ground, bleeding out (100 over 60 s) until revived or dead. */
  private knockDown(t: Player, now: number): void {
    t.downed = true;
    t.bleed = 100;
    t.distressAt = 0;
    t.reviving = null;
    this.cancelLifeAction(t);
    t.state.vx = 0;
    t.state.vz = 0;
    t.dirty = true;
    void now;
  }

  /** Final death. Active quests are lost, and so are the quest items being carried. */
  private killPlayer(t: Player, attackerId: number | null, now: number): void {
    t.downed = false;
    t.bleed = 0;
    t.reviving = null;
    t.health = 0;
    t.dead = true;
    this.cancelLifeAction(t);
    t.deadAt = now;
    t.killerId = attackerId;
    t.inputs.length = 0;
    t.state.vx = 0;
    t.state.vz = 0;
    let lost = false;
    for (const run of Object.values(t.journal)) {
      if (run.status !== 'active' && run.status !== 'ready') continue;
      run.status = 'cancelled';
      run.cargo = {};
      delete run.location;
      delete run.drops;
      lost = true;
    }
    for (const it of t.inv.items.filter((i) => i.quest)) { t.inv.remove(it.uid); lost = true; }
    if (lost) {
      this.syncLoadout(t);
      this.sendInv(t);
      this.sendQuests(t);
    }
    t.dirty = true;
    for (const p of this.players.values()) if (p.reviving?.target === t) { p.reviving = null; p.session.sendJson({ t: 'reviving', target: 0, durationMs: 0 }); }
    this.broadcastNear(t, { t: 'death', playerId: t.id, killerId: attackerId });
  }

  /** Bleeding out, and revives in progress. */
  private stepDowned(now: number): void {
    for (const p of this.players.values()) {
      if (p.downed) {
        p.bleed -= (100 / 60) * TICK_DT;
        if (p.bleed <= 0) this.killPlayer(p, null, now);
      }
      const r = p.reviving;
      if (!r) continue;
      const t = r.target;
      const ok = !p.dead && !p.downed && t.downed && this.players.get(t.id) === t
        && Math.hypot(p.state.x - t.state.x, p.state.z - t.state.z) <= REVIVE_REACH
        && Math.hypot(p.state.x - r.x, p.state.z - r.z) <= 1.0;
      if (!ok) {
        if (!p.dead && !p.downed && t.downed) this.reply(p, 'Cấp cứu bị gián đoạn: đứng yên cạnh đồng đội trong 5 giây.');
        p.reviving = null;
        p.session.sendJson({ t: 'reviving', target: 0, durationMs: 0 });
        continue;
      }
      if (now < r.until) continue;
      p.reviving = null;
      p.session.sendJson({ t: 'reviving', target: 0, durationMs: 0 });
      t.downed = false;
      t.bleed = 0;
      t.health = 30;
      t.dirty = true;
      this.reply(t, `${p.username} đã cứu bạn dậy!`);
    }
  }

  /** Hitscan gun: fire rate and spread are enforced here; the client only says "trigger down". */
  private tryShoot(p: Player, now: number, renderTime: number | undefined): void {
    const spec = WEAPON_SPECS[p.weapon as Exclude<WeaponId, 0>];
    if (spec?.kind !== 'gun' || now < p.fireReadyAt - FIRE_TOLERANCE_MS) return;
    if (p.life.stamina < this.life.config.stamina.attack || !this.useRound(p)) return;
    this.life.spend(p.life, this.life.config.stamina.attack);
    p.fireReadyAt = Math.max(now, p.fireReadyAt) + spec.fireMs;
    const s = p.state;
    const ox = s.x;
    const oy = s.y + MUZZLE_HEIGHT;
    const oz = s.z;
    const [ax, ay, az] = aimDirection(p.yaw, p.pitch);
    const candidates: Combatant[] = [
      ...this.grid.query(p.chunkX, p.chunkZ, Math.ceil(spec.range / CHUNK_SIZE), this.scratch),
      ...this.zombies.near(ox, oz, spec.range + 2),
      ...this.animals.values(),
    ];
    const ends: number[] = [];
    const damageBy = new Map<Combatant, { dmg: number; zone: string; x: number; y: number; z: number; pellets: number }>();
    for (let i = 0; i < spec.pellets; i++) {
      const [dx, dy, dz] = spreadDirection(ax, ay, az, spec.spread, Math.random);
      const r = castCombatRay(p, candidates, this.collision, now, renderTime, ox, oy, oz, dx, dy, dz, spec.range);
      const npcHit = this.npcOnRay(ox, oy, oz, dx, dy, dz, r.t);
      if (npcHit) {
        this.provokeNpc(npcHit.npc, p, now);
        ends.push(+(ox + dx * npcHit.t).toFixed(2), +(oy + dy * npcHit.t).toFixed(2), +(oz + dz * npcHit.t).toFixed(2));
        continue;
      }
      const x = ox + dx * r.t;
      const y = oy + dy * r.t;
      const z = oz + dz * r.t;
      ends.push(+x.toFixed(2), +y.toFixed(2), +z.toFixed(2));
      if (r.target && r.zone) {
        const prev = damageBy.get(r.target);
        const dmg = spec.damage * ZONE_DAMAGE_MULTIPLIER[r.zone];
        // A headshot pellet wins over body hits for the reported zone.
        const zone = prev && prev.zone === 'head' ? 'head' : r.zone;
        damageBy.set(r.target, { dmg: (prev?.dmg ?? 0) + dmg, zone, x, y, z, pellets: (prev?.pellets ?? 0) + 1 });
      }
    }
    this.broadcastNear(p, { t: 'shot', shooterId: p.id, w: p.weapon, ox, oy, oz, ends });
    for (const [t, d] of damageBy) this.hitTarget(p, t, Math.round(d.dmg), d.zone, d.x, d.y, d.z, ax, az, d.pellets * spec.damage * 0.12, now);
    this.zombies.alert(ox, oz, 45, now);
  }

  private tryThrow(p: Player, now: number, targetDist?: number): void {
    const spec = WEAPON_SPECS[WeaponId.Grenade];
    if (spec.kind !== 'throw' || now < p.throwReadyAt || p.life.stamina < this.life.config.stamina.attack) return;
    if (p.inv.equippedItem()?.itemId !== 'grenade') return;
    p.inv.consumeEquipped();
    this.syncLoadout(p);
    this.sendInv(p);
    this.life.spend(p.life, this.life.config.stamina.attack);
    p.throwReadyAt = now + spec.cooldownMs;
    p.attackingUntil = now + 400;
    const s = p.state;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const ox = s.x + fx * 0.4;
    const oy = s.y + 1.6;
    const oz = s.z + fz * 0.4;
    // Aimed throw: speed chosen so the grenade lands at the requested distance.
    let speed = spec.speed;
    let carry = 0.5;
    if (targetDist !== undefined) {
      const d = Math.min(targetDist, spec.maxRange);
      const ground = this.collision.terrainHeight(s.x + fx * d, s.z + fz * d);
      speed = throwSpeed(spec, Math.max(0, d - 0.4), (Number.isFinite(ground) ? ground : s.y) - oy);
      carry = 0;
    }
    const h = Math.cos(spec.elevation) * speed;
    const g = {
      id: this.nextGrenadeId++,
      ownerId: p.id,
      s: { x: ox, y: oy, z: oz, vx: fx * h + s.vx * carry, vy: Math.sin(spec.elevation) * speed, vz: fz * h + s.vz * carry, resting: false },
      explodeAt: now + spec.fuseMs,
    };
    this.grenades.push(g);
    this.broadcastNear(p, { t: 'grenade', id: g.id, ownerId: p.id, ...pick(g.s), fuseMs: spec.fuseMs });
  }

  private stepGrenades(now: number): void {
    const spec = WEAPON_SPECS[WeaponId.Grenade];
    if (spec.kind !== 'throw') return;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!;
      stepProjectile(g.s, this.collision, GRENADE_GRAVITY, TICK_DT);
      if (now < g.explodeAt) continue;
      this.grenades.splice(i, 1);
      this.explode(g.id, g.s.x, g.s.y, g.s.z, spec.radius, spec.damage, this.players.get(g.ownerId) ?? null, 'grenade', now);
    }
  }

  /** Blast damage with linear falloff; cover blocks it for players. */
  private explode(id: number, x: number, y: number, z: number, radius: number, damage: number, owner: Player | null, kind: 'grenade' | 'grenade40' | 'rocket', now: number): void {
    this.vegetation.explode(x, y, z, radius, now);
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const near = this.grid.query(cx, cz, ENTITY_INTEREST_RADIUS_CHUNKS, []);
    for (const o of near) o.session.sendJson({ t: 'explosion', id, x, y, z, radius, kind });
    this.zombies.alert(x, z, 60, now);
    for (const zb of this.zombies.near(x, z, radius)) {
      if (zb.dead) continue;
      const tx = zb.state.x - x;
      const tz = zb.state.z - z;
      const d = Math.hypot(tx, zb.state.y + 0.6 - (y + 0.3), tz);
      if (d >= radius) continue;
      const k = 1 - d / radius;
      zb.state.vy += 4 * k;
      this.hitZombie(owner, zb, Math.round(damage * k), 'torso', zb.state.x, zb.state.y + 0.8, zb.state.z, tx, tz, 9 * k, now);
    }
    for (const t of this.grid.query(cx, cz, 1, this.scratch)) {
      if (!t.active || t.dead) continue;
      const tx = t.state.x - x;
      const ty = t.state.y + 0.9 - (y + 0.3);
      const tz = t.state.z - z;
      const d = Math.hypot(tx, ty, tz);
      if (d >= radius) continue;
      if (d > 0.3 && this.collision.raycast(x, y + 0.3, z, tx / d, ty / d, tz / d, d, Mask.LineOfSight, this.blastHit)) continue;
      this.damage(owner?.id ?? null, t, Math.round(damage * (1 - d / radius)), 'blast', t.state.x, t.state.y + 0.9, t.state.z, now);
    }
    if (owner) for (const npc of this.peacefulNpcs()) if (Math.hypot(npc.x - x, npc.z - z) < radius) this.provokeNpc(npc, owner, now);
    // Livestock caught in the blast (credited to the thrower).
    if (owner) for (const animal of this.animals.values()) {
      if (animal.dead) continue;
      const d = Math.hypot(animal.state.x - x, animal.state.y + 0.5 - (y + 0.3), animal.state.z - z);
      if (d >= radius) continue;
      this.hitAnimal(owner, animal, Math.round(damage * (1 - d / radius)), now);
    }
  }

  /** Launcher: spawns a server-simulated round (lobbed 40 mm grenade, rocket or bolt). */
  private tryLaunch(p: Player, spec: GunSpec, now: number, targetDist?: number): void {
    const proj = spec.projectile;
    if (!proj || now < p.fireReadyAt - FIRE_TOLERANCE_MS) return;
    if (p.life.stamina < this.life.config.stamina.attack || !this.useRound(p)) return;
    this.life.spend(p.life, this.life.config.stamina.attack);
    p.fireReadyAt = Math.max(now, p.fireReadyAt) + spec.fireMs;
    const s = p.state;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const x = s.x + fx * 0.7;
    const y = s.y + MUZZLE_HEIGHT;
    const z = s.z + fz * 0.7;
    let vx: number;
    let vy: number;
    let vz: number;
    if (proj.lob) {
      // Lobbed high so it comes down on the cursor.
      const d = Math.min(targetDist ?? proj.lob.maxRange * 0.5, proj.lob.maxRange);
      const ground = this.collision.terrainHeight(s.x + fx * d, s.z + fz * d);
      const speed = lobSpeed(proj.lob.elevation, proj.lob.maxRange, Math.max(0.5, d - 0.7), (Number.isFinite(ground) ? ground : s.y) - y, proj.gravity);
      const h = Math.cos(proj.lob.elevation) * speed;
      vx = fx * h;
      vy = Math.sin(proj.lob.elevation) * speed;
      vz = fz * h;
    } else {
      const [ax, ay, az] = aimDirection(p.yaw, p.pitch);
      const [dx, dy, dz] = spreadDirection(ax, ay, az, spec.spread, Math.random);
      vx = dx * proj.speed;
      vy = dy * proj.speed;
      vz = dz * proj.speed;
    }
    const id = this.nextGrenadeId++;
    this.rounds.push({ id, owner: p, w: p.weapon, spec: proj, damage: spec.damage, x, y, z, vx, vy, vz, dieAt: now + proj.maxFlightSec * 1000 });
    this.broadcastNear(p, { t: 'proj', id, ownerId: p.id, w: p.weapon, kind: proj.kind, x, y, z, vx, vy, vz, gravity: proj.gravity });
    this.zombies.alert(x, z, proj.kind === 'bolt' ? 12 : 40, now);
  }

  /** Moves rounds along their arcs; the first body, wall or ground they touch stops them. */
  private stepRounds(now: number): void {
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i]!;
      r.vy -= r.spec.gravity * TICK_DT;
      const sx = r.vx * TICK_DT;
      const sy = r.vy * TICK_DT;
      const sz = r.vz * TICK_DT;
      const len = Math.hypot(sx, sy, sz) || 1e-6;
      const candidates: Combatant[] = [
        ...this.grid.query(Math.floor(r.x / CHUNK_SIZE), Math.floor(r.z / CHUNK_SIZE), 1, this.scratch),
        ...this.zombies.near(r.x, r.z, len + 3),
        ...this.animals.values(),
      ];
      const hit = castCombatRay(r.owner, candidates, this.collision, now, undefined, r.x, r.y, r.z, sx / len, sy / len, sz / len, len);
      const npcHit = this.npcOnRay(r.x, r.y, r.z, sx / len, sy / len, sz / len, hit.t);
      if (npcHit && this.players.get(r.owner.id) === r.owner) this.provokeNpc(npcHit.npc, r.owner, now);
      let t = hit.target || hit.t < len - 1e-4 ? hit.t : len;
      let stopped = !!hit.target || hit.t < len - 1e-4;
      const nx = r.x + (sx / len) * t;
      const ny = r.y + (sy / len) * t;
      const nz = r.z + (sz / len) * t;
      const ground = this.collision.terrainHeight(nx, nz);
      if (Number.isFinite(ground) && ny <= ground) {
        stopped = true;
        t = Math.max(0, t - 0.05);
      }
      r.x = nx;
      r.y = Number.isFinite(ground) ? Math.max(ny, ground + 0.05) : ny;
      r.z = nz;
      const expired = now >= r.dieAt;
      if (!stopped && !expired) continue;
      this.rounds.splice(i, 1);
      const owner = this.players.get(r.owner.id) === r.owner ? r.owner : null;
      this.broadcastAt(r.x, r.z, { t: 'projEnd', id: r.id, x: r.x, y: r.y, z: r.z, hit: !!hit.target });
      if (r.spec.blast) {
        this.explode(r.id, r.x, r.y, r.z, r.spec.blast.radius, r.spec.blast.damage, owner, r.spec.kind === 'rocket' ? 'rocket' : 'grenade40', now);
      } else if (hit.target && hit.zone && owner) {
        const k = Math.hypot(r.vx, r.vz) || 1;
        this.hitTarget(owner, hit.target, Math.round(r.damage * ZONE_DAMAGE_MULTIPLIER[hit.zone]), hit.zone, r.x, r.y, r.z, r.vx / k, r.vz / k, 3, now);
      }
    }
  }

  /** Flamethrower: a short cone of fire; zombies caught in it keep burning for a while. */
  private tryFlame(p: Player, spec: GunSpec, now: number): void {
    if (now < p.fireReadyAt - FIRE_TOLERANCE_MS) return;
    if (p.life.stamina < this.life.config.stamina.attack || !this.useRound(p)) return;
    this.life.spend(p.life, this.life.config.stamina.attack);
    p.fireReadyAt = Math.max(now, p.fireReadyAt) + spec.fireMs;
    const s = p.state;
    const ox = s.x;
    const oy = s.y + MUZZLE_HEIGHT;
    const oz = s.z;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const inCone = (x: number, y: number, z: number): boolean => {
      const dx = x - ox;
      const dz = z - oz;
      const d = Math.hypot(dx, dz);
      if (d > spec.range || d < 0.05) return d < 0.05;
      const cos = (dx * fx + dz * fz) / d;
      if (cos < Math.cos(spec.spread + Math.atan(0.45 / d))) return false;
      const dy = y - oy;
      const l = Math.hypot(dx, dy, dz);
      return !this.collision.raycast(ox, oy, oz, dx / l, dy / l, dz / l, l, Mask.LineOfSight, this.blastHit);
    };
    this.vegetation.burn(ox, oy, oz, fx, fz, spec.range, spec.spread, spec.burn?.seconds ?? 4, now);
    for (const zb of this.zombies.near(ox, oz, spec.range + 1)) {
      if (zb.dead || !inCone(zb.state.x, zb.state.y + 1, zb.state.z)) continue;
      this.hitZombie(p, zb, spec.damage, 'fire', zb.state.x, zb.state.y + 1, zb.state.z, fx, fz, 0.4, now);
      if (spec.burn) {
        zb.burnUntil = now + spec.burn.seconds * 1000;
        zb.burnBy = p;
        zb.burnDps = spec.burn.dps;
        if (zb.burnAt < now) zb.burnAt = now + 500;
      }
    }
    for (const t of this.grid.query(p.chunkX, p.chunkZ, 1, this.scratch)) {
      if (t === p || !t.active || t.dead || !inCone(t.state.x, t.state.y + 1, t.state.z)) continue;
      this.damage(p.id, t, spec.damage, 'fire', t.state.x, t.state.y + 1, t.state.z, now);
    }
    this.broadcastNear(p, { t: 'shot', shooterId: p.id, w: p.weapon, ox, oy, oz, ends: [] });
    this.zombies.alert(ox, oz, 20, now);
  }

  private syncVegetation(p: Player): void {
    let view = this.vegetationView.get(p);
    const reset = !view || view.cx !== p.chunkX || view.cz !== p.chunkZ;
    if (!view) {
      view = { cx: p.chunkX, cz: p.chunkZ, revisions: new Map() };
      this.vegetationView.set(p, view);
    }
    view.cx = p.chunkX;
    view.cz = p.chunkZ;
    const message = this.vegetation.sync(p.chunkX, p.chunkZ, 3, view.revisions, reset);
    if (message) p.session.sendJson(message);
  }

  /** Afterburn ticks for zombies set on fire. */
  private stepBurning(now: number): void {
    for (const zb of this.zombies.zombies.values()) {
      if (zb.dead || zb.burnUntil <= now || now < zb.burnAt) continue;
      zb.burnAt = now + 500;
      const owner = zb.burnBy && this.players.get(zb.burnBy.id) === zb.burnBy ? zb.burnBy : null;
      this.hitZombie(owner, zb, Math.max(1, Math.round(zb.burnDps * 0.5)), 'fire', zb.state.x, zb.state.y + 1, zb.state.z, 0, 0, 0, now);
    }
  }

  /* ------------------------------------ ZCoin trade ------------------------------------- */

  private addCoins(p: Player, amount: number, extra?: { req: number; ok: boolean; reason?: 'funds' | 'range' | 'item' | 'room' }): void {
    p.coins = Math.max(0, p.coins + amount);
    p.dirty = true;
    p.session.sendJson({ t: 'wallet', coins: p.coins, ...extra });
  }

  /* ------------------------------------ inventory --------------------------------------- */

  /** Sends the player their own inventory (never anyone else's). */
  private sendInv(p: Player): void {
    const d = p.inv.toJSON();
    p.session.sendJson({ t: 'inv', items: d.items, equipped: d.equipped, cacheLeft: this.cacheLeft(p) });
  }

  /** Re-derives what the inventory implies: worn armour (and its weight), the gun on the back. */
  private syncLoadout(p: Player): void {
    p.armor = p.inv.worn();
    p.speedMul = armorSpeedFactor(p.armor);
    const back = p.inv.backItem();
    p.backWeapon = back ? (WEAPON_BY_ITEM[back.itemId] ?? 0) : 0;
    p.dirty = true;
  }

  /** Takes one round from the magazine of the gun in hand; false if it is empty or reloading. */
  private useRound(p: Player): boolean {
    const gun = p.inv.equippedItem();
    if (!gun || p.reloadAt || (gun.mag ?? 0) <= 0) return false;
    gun.mag = (gun.mag ?? 0) - 1;
    p.dirty = true;
    return true;
  }

  /** Reload: after (most of) the gun's reload time, rounds move from boxes into the magazine. */
  private onReload(p: Player): void {
    const gun = p.inv.equippedItem();
    const spec = gun ? weaponSpec(WEAPON_BY_ITEM[gun.itemId] ?? 0) : undefined;
    if (!gun || spec?.kind !== 'gun' || p.reloadAt || p.dead) return;
    if ((gun.mag ?? 0) >= spec.magazine || p.inv.ammoFor(gun.itemId) <= 0) return;
    p.reloadUid = gun.uid;
    // Lenient: clients time reloads to their sound, so the server only enforces half the time.
    p.reloadAt = this.serverTime + spec.reloadMs * 0.5;
  }

  private stepReloads(now: number): void {
    for (const p of this.activeScratch) {
      if (p.questBusy || !p.reloadAt || now < p.reloadAt) continue;
      p.reloadAt = 0;
      const gun = p.inv.equippedItem();
      const spec = gun ? weaponSpec(WEAPON_BY_ITEM[gun.itemId] ?? 0) : undefined;
      // Swapping weapons cancels the reload.
      if (!gun || gun.uid !== p.reloadUid || spec?.kind !== 'gun') continue;
      gun.mag = (gun.mag ?? 0) + p.inv.takeAmmo(gun.itemId, spec.magazine - (gun.mag ?? 0));
      p.dirty = true;
      this.sendInv(p);
    }
  }

  private onInventory(p: Player, msg: InvMessage): void {
    if (p.dead && msg.op !== 'move' && msg.op !== 'equip') return;
    switch (msg.op) {
      case 'chestOpen': case 'chestClose': case 'chestSearch': case 'chestPut': case 'chestTake':
        void this.chests.handle(p, msg); return;
    }
    let changed = false;
    switch (msg.op) {
      case 'move': {
        // Storage pages can only be touched at the camp warehouse.
        const from = p.inv.get(msg.uid)?.container;
        if ((isStash(msg.c) || (from && isStash(from))) && !this.atStorage(p)) break;
        changed = p.inv.move(msg.uid, msg.c, msg.x, msg.y, msg.r);
        break;
      }
      case 'equip':
        changed = p.inv.equip(msg.uid);
        if (changed) p.reloadAt = 0;
        break;
      case 'drop': {
        const at = p.inv.get(msg.uid)?.container;
        if (at && isStash(at) && !this.atStorage(p)) break;
        const it = p.inv.remove(msg.uid);
        if (it) {
          this.dropGroundItem(p, it);
          changed = true;
        }
        break;
      }
      case 'pickup': {
        const g = this.groundItems.get(msg.id);
        if (!g || Math.hypot(p.state.x - g.x, p.state.z - g.z) > GROUND_PICKUP_REACH || Math.abs(p.state.y - g.y) > 2.5) break;
        const added = p.inv.add(g.itemId, g.count, g.issued);
        if (!added) {
          p.session.sendJson({ t: 'error', code: 'invalid_message', message: 'Inventory full', fatal: false });
          break;
        }
        if (g.mag !== undefined) added.mag = g.mag;
        if (g.quest) added.quest = g.quest;
        if (g.livestock) this.queueQuestEvent(p, { type: 'collect', target: g.itemId, quantity: g.count ?? 1 });
        this.groundItems.delete(msg.id);
        this.broadcast({ t: 'groundGone', id: msg.id });
        changed = true;
        break;
      }
      case 'cache': {
        // Free kit, rationed: CACHE_DRAWS_PER_DAY draws per player per world day.
        const kind = this.cacheNear(p);
        const stock: readonly string[] = kind === 'camp' ? CAMP_CACHE_STOCK : [];
        if (!stock.includes(msg.item)) { this.reply(p, 'Hãy đứng cạnh kho đạn để lấy đồ.'); break; }
        const day = Math.floor(this.worldTimeMs / this.dayLengthMs);
        const q = p.life.quotas.ammo_cache;
        const used = q && q.start === day ? q.used : 0;
        if (used >= CACHE_DRAWS_PER_DAY) { this.reply(p, `Kho đạn: hết lượt hôm nay (${CACHE_DRAWS_PER_DAY}/${CACHE_DRAWS_PER_DAY}). Quay lại vào ngày mới.`); break; }
        if (!p.inv.add(msg.item, undefined, true)) { this.reply(p, 'Túi đồ đầy.'); break; }
        p.life.quotas.ammo_cache = { start: day, used: used + 1, blockedUntil: 0 };
        changed = true;
        break;
      }
    }
    if (changed) this.syncLoadout(p);
    // Always answer with the true state, so a rejected move snaps back on the client.
    this.sendInv(p);
  }

  private chestNear(p: Player, id: string): { field: boolean } | null {
    if (!p.active || p.dead || p.downed) return null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const chunk = this.deps.world.peek(p.chunkX + dx, p.chunkZ + dz, 0)?.data;
      if (!chunk) continue;
      for (const prop of chunk.props) {
        if (!CHEST_ASSETS.has(prop.asset)) continue;
        const t = propTransform(chunk, prop);
        if (chestKey(prop.asset, t.x, t.y, t.z) !== id || Math.hypot(t.x - p.state.x, t.z - p.state.z) > CHEST_REACH || Math.abs(t.y - p.state.y) > 2.5) continue;
        const camp = this.deps.world.generator.camp;
        const field = !(camp && Math.max(Math.abs(t.x - camp.x), Math.abs(t.z - camp.z)) <= CAMP_HALF_SIZE + 4);
        if (!field && prop.asset === CAMP_ASSET['zion-ammo-cache-station']) continue;
        return { field };
      }
    }
    return null;
  }

  private cacheLeft(p: Player): number {
    const q = p.life?.quotas.ammo_cache;
    const day = Math.floor(this.worldTimeMs / this.dayLengthMs);
    return CACHE_DRAWS_PER_DAY - (q && q.start === day ? q.used : 0);
  }

  /** Is the player next to an ammo cache station, and is it the camp's (ammo only) or a field one? */
  private cacheNear(p: Player): 'camp' | 'field' | null {
    const id = CAMP_ASSET['zion-ammo-cache-station'];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const rec = this.deps.world.peek(p.chunkX + dx, p.chunkZ + dz, 0);
      if (!rec) continue;
      for (const prop of rec.data.props) {
        if (prop.asset !== id) continue;
        const t = propTransform(rec.data, prop);
        if (Math.hypot(t.x - p.state.x, t.z - p.state.z) > STATION_REACH) continue;
        const camp = this.deps.world.generator.camp;
        return camp && Math.max(Math.abs(t.x - camp.x), Math.abs(t.z - camp.z)) <= CAMP_HALF_SIZE + 4 ? 'camp' : 'field';
      }
    }
    return null;
  }

  /** Standing in the camp warehouse (personal storage reachable). */
  private atStorage(p: Player): boolean {
    const camp = this.deps.world.generator.camp;
    const s = this.life.config.storage;
    return !!camp && !!s && !p.dead && Math.abs(p.state.y - camp.y) < 4 && Math.hypot(p.state.x - camp.x - s.x, p.state.z - camp.z - s.z) <= s.radius;
  }

  private dropGroundItem(p: Player, it: { itemId: string; count?: number; mag?: number; issued?: boolean; quest?: string }): void {
    const id = this.nextGroundId++;
    const a = p.yaw + (Math.random() - 0.5) * 0.8;
    const d = 0.9 + Math.random() * 0.5;
    const x = p.state.x - Math.sin(a) * d;
    const z = p.state.z - Math.cos(a) * d;
    const ground = this.collision.terrainHeight(x, z);
    const y = Number.isFinite(ground) && Math.abs(ground - p.state.y) < 1.5 ? ground : p.state.y;
    const g = { itemId: it.itemId, count: it.count, mag: it.mag, issued: it.issued, quest: it.quest, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), expiresAt: this.serverTime + GROUND_ITEM_LIFETIME_MS };
    this.groundItems.set(id, g);
    this.broadcast({ t: 'ground', items: [{ id, itemId: g.itemId, count: g.count, x: g.x, y: g.y, z: g.z }] });
  }

  /** A slain animal's meat: real ground items around the body (picked up with E, outlive the respawn). */
  private dropAnimalLoot(animal: Livestock): void {
    const n = animal.record.loot;
    animal.record.loot = 0;
    const items: Array<{ id: number; itemId: string; x: number; y: number; z: number }> = [];
    for (let i = 0; i < n; i++) {
      const id = this.nextGroundId++;
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.6;
      const d = 0.35 + Math.random() * 0.45;
      const x = animal.state.x + Math.cos(a) * d;
      const z = animal.state.z + Math.sin(a) * d;
      const ground = this.collision.terrainHeight(x, z);
      const y = Number.isFinite(ground) && Math.abs(ground - animal.state.y) < 1.5 ? ground : animal.state.y;
      const g = { itemId: animal.def.lootItem, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), expiresAt: this.serverTime + GROUND_ITEM_LIFETIME_MS, livestock: true };
      this.groundItems.set(id, g);
      items.push({ id, itemId: g.itemId, x: g.x, y: g.y, z: g.z });
    }
    if (items.length) this.broadcast({ t: 'ground', items });
  }

  private expireGroundItems(now: number): void {
    for (const [id, g] of this.groundItems) {
      if (now < g.expiresAt) continue;
      this.groundItems.delete(id);
      this.broadcast({ t: 'groundGone', id });
    }
  }

  /** First aid kit applied: uses one charge of that kit and heals fully, at most once per MEDKIT_USE_MS. */
  private onHeal(p: Player, uid: number): void {
    const now = this.serverTime;
    const kit = p.inv.carriedItem(uid);
    if (p.dead || p.downed || now < p.healReadyAt || kit?.itemId !== 'medkit' || p.health >= PLAYER_MAX_HEALTH) return;
    p.inv.useCharge(uid);
    p.healReadyAt = now + MEDKIT_USE_MS - 300;
    p.health = PLAYER_MAX_HEALTH;
    p.dirty = true;
    this.sendInv(p);
  }

  private dropCoin(x: number, y: number, z: number, now: number): void {
    const id = this.nextCoinId++;
    const ground = this.collision.terrainHeight(x, z);
    const c = { x: +x.toFixed(2), y: +(Number.isFinite(ground) ? Math.max(ground, y) : y).toFixed(2), z: +z.toFixed(2), amount: ZOMBIE_COIN_DROP_MIN + Math.floor(Math.random() * (ZOMBIE_COIN_DROP_MAX - ZOMBIE_COIN_DROP_MIN + 1)), expiresAt: now + COIN_DROP_LIFETIME_MS };
    this.coinDrops.set(id, c);
    this.broadcast({ t: 'coins', drops: [{ id, x: c.x, y: c.y, z: c.z, amount: c.amount }] });
  }

  private onPickupCoin(p: Player, id: number): void {
    const c = this.coinDrops.get(id);
    if (!c || p.dead || Math.hypot(p.state.x - c.x, p.state.z - c.z) > COIN_PICKUP_REACH + 0.8) return;
    this.coinDrops.delete(id);
    this.broadcast({ t: 'coinGone', id });
    this.addCoins(p, c.amount);
  }

  /** Coins are picked up automatically by the first living player to walk over them. */
  private collectCoins(): void {
    if (this.coinDrops.size === 0) return;
    for (const [id, c] of this.coinDrops) {
      for (const p of this.activeScratch) {
        if (p.dead || Math.abs(p.state.y - c.y) > 2.5 || Math.hypot(p.state.x - c.x, p.state.z - c.z) > COIN_PICKUP_REACH) continue;
        this.onPickupCoin(p, id);
        break;
      }
    }
  }

  private expireCoins(now: number): void {
    for (const [id, c] of this.coinDrops) {
      if (now < c.expiresAt) continue;
      this.coinDrops.delete(id);
      this.broadcast({ t: 'coinGone', id });
    }
  }

  /** Camp Studio: swap the camp layout live (null = default) and stream the changed chunks. */
  /** Camp Studio: move the merchant, medic and gate guards (null = default spots). */
  applyCampNpcs(npcs: CampNpcLayout | null): void {
    this.merchant.setStall(npcs?.merchant ?? NPC_STALLS.merchant);
    this.nurse.setStall(npcs?.nurse ?? NPC_STALLS.nurse);
    this.guards.setPosts(npcs?.guards ?? GUARD_POSTS);
  }

  applyCampLayout(parts: readonly CampPart[] | null): void {
    const chunks = this.deps.world.setCampLayout(parts);
    for (const [cx, cz] of chunks) this.physics.reload(cx, cz);
    for (const p of this.players.values()) p.streamer.invalidate(chunks);
  }

  private npcList(): ServerJsonMessage {
    const npcs: Array<{ id: number; role: 'merchant' | 'nurse'; x: number; z: number }> = [];
    if (this.merchant.active) npcs.push({ id: this.merchant.id, role: 'merchant', x: this.merchant.x, z: this.merchant.z });
    if (this.nurse.active) npcs.push({ id: this.nurse.id, role: 'nurse', x: this.nurse.x, z: this.nurse.z });
    return { t: 'npcs', npcs };
  }

  /** The field medic heals to full for a fee. */
  private onNurseHeal(p: Player, req: number): void {
    if (p.dead || !this.nurse.inReach(p, MERCHANT_REACH + 1)) return this.addCoins(p, 0, { req, ok: false, reason: 'range' });
    if (p.health >= PLAYER_MAX_HEALTH) return this.addCoins(p, 0, { req, ok: false, reason: 'item' });
    if (p.coins < NURSE_HEAL_PRICE) return this.addCoins(p, 0, { req, ok: false, reason: 'funds' });
    p.health = PLAYER_MAX_HEALTH;
    this.addCoins(p, -NURSE_HEAL_PRICE, { req, ok: true });
  }

  private onBuy(p: Player, req: number, item: string): void {
    const price = buyPrice(item);
    if (price === null) return this.addCoins(p, 0, { req, ok: false, reason: 'item' });
    const vendor = vendorOf(item) === 'medic' ? this.nurse : this.merchant;
    if (p.dead || !vendor.inReach(p, MERCHANT_REACH + 1)) return this.addCoins(p, 0, { req, ok: false, reason: 'range' });
    if (p.coins < price) return this.addCoins(p, 0, { req, ok: false, reason: 'funds' });
    if (!p.inv.add(item)) return this.addCoins(p, 0, { req, ok: false, reason: 'room' });
    this.syncLoadout(p);
    this.addCoins(p, -price, { req, ok: true });
    this.sendInv(p);
    this.deps.audit.record({ event: 'shop.buy', accountId: p.accountId, details: { item, price, coins: p.coins } });
  }

  private onSell(p: Player, req: number, uid: number): void {
    const it = p.inv.carriedItem(uid);
    const def = it ? ITEMS[it.itemId] : undefined;
    const max = def ? maxCount(def) : undefined;
    const price = it && def && !it.issued && !it.quest ? sellPrice(it.itemId, max ? (it.count ?? max) / max : 1) : 0;
    if (!it || price <= 0) return this.addCoins(p, 0, { req, ok: false, reason: 'item' });
    if (p.dead || !(this.merchant.inReach(p, MERCHANT_REACH + 1) || this.nurse.inReach(p, MERCHANT_REACH + 1))) return this.addCoins(p, 0, { req, ok: false, reason: 'range' });
    const item = it.itemId;
    p.inv.remove(uid);
    this.syncLoadout(p);
    this.addCoins(p, price, { req, ok: true });
    this.sendInv(p);
    this.deps.audit.record({ event: 'shop.sell', accountId: p.accountId, details: { item, price, coins: p.coins } });
  }

  private sendSnapshots(now: number): void {
    const tod = this.timeOfDay();
    for (const p of this.players.values()) {
      if (!p.active || p.questBusy) continue;
      const near = this.grid.query(p.chunkX, p.chunkZ, ENTITY_INTEREST_RADIUS_CHUNKS, this.scratch);
      const entities: EntityState[] = [];
      for (const o of near) {
        if (o === p || !o.active) continue;
        entities.push({
          id: o.id,
          kind: EntityKind.Player,
          x: o.state.x,
          y: o.state.y,
          z: o.state.z,
          yaw: o.yaw,
          pitch: o.pitch,
          flags: this.flagsOf(o, now),
          health: o.downed ? Math.ceil(o.bleed) : o.health,
          weapon: o.weapon,
          back: o.backWeapon,
          armor: packArmor(o.armor),
        });
      }
      this.guards.entitiesFor(p, entities);
      for (const [key, entity] of this.questNpcs) {
        const start = entities.length;
        entity.entitiesFor(p, entities);
        if (entities.length > start) entities[start]!.weapon = this.content.npcs.find((n) => n.id === key)?.weapon ?? 0;
      }
      this.merchant.entitiesFor(p, entities);
      this.nurse.entitiesFor(p, entities);
      this.zombies.entitiesFor(p, now, entities);
      for (const animal of this.animals.values()) if (animal.visible(p)) entities.push(animal.entity(now));
      const s = p.state;
      const frame = encodeSnapshot({
        tick: this.tick,
        serverTime: now,
        timeOfDay: tod,
        ackSeq: p.lastProcessedSeq,
        self: { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, flags: this.flagsOf(p, now), health: p.downed ? Math.max(1, Math.ceil(p.bleed)) : p.health, stuckTicks: s.stuckTicks, rollTicks: s.rollTicks, rollCooldown: s.rollCooldown, rollYaw: s.rollYaw },
        entities,
      });
      p.session.sendBinary(frame, true);
    }
  }

  private flagsOf(p: Player, now: number): number {
    let f = 0;
    if (p.state.grounded) f |= EntityFlags.Grounded;
    if (p.state.swimming) f |= EntityFlags.Swimming;
    if (p.dead) f |= EntityFlags.Dead;
    if ((p.lastButtons & Buttons.Sprint) !== 0) f |= EntityFlags.Sprinting;
    if (now < p.attackingUntil) f |= EntityFlags.Attacking;
    if (p.state.rollTicks > 0) f |= EntityFlags.Rolling;
    if (p.inv.hasFlashlight()) f |= EntityFlags.Flashlight;
    if (p.state.climbing) f |= EntityFlags.Climbing;
    if (p.downed) f |= EntityFlags.Downed;
    return f;
  }

  /* ------------------------------------ broadcast ---------------------------------------- */

  private broadcast(msg: ServerJsonMessage): void {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) p.session.sendText(text);
  }

  private broadcastNear(center: Player, msg: ServerJsonMessage): void {
    for (const p of this.grid.query(center.chunkX, center.chunkZ, ENTITY_INTEREST_RADIUS_CHUNKS, [])) p.session.sendJson(msg);
  }

  private broadcastPlayerList(): void {
    const players = [...this.players.values()].map((p) => ({ id: p.id, name: p.username }));
    this.broadcast({ t: 'players', players });
  }

  /* ------------------------------------ persistence -------------------------------------- */

  private async persistAll(all: boolean): Promise<void> {
    const batch = [];
    for (const p of this.players.values()) {
      if (p.questBusy || (!all && !p.dirty)) continue;
      p.dirty = false;
      batch.push({ accountId: p.accountId, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, health: p.dead ? 0 : p.health, coins: p.coins, inventory: p.inv.toJSON(), journal: structuredClone(p.journal), life: structuredClone(p.life) });
    }
    try {
      await this.deps.playerStates.saveMany(batch, this.lifeBusy ? undefined : this.lifeWorld);
      await this.deps.worlds.saveTime(this.deps.worldId, this.worldTimeMs);
    } catch (err) {
      this.log.error({ err }, 'persistence failed');
    }
  }
}

function pick(s: ProjectileState): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  return { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
}
